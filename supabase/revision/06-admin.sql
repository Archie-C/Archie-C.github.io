-- Upgrade an existing 01–04 installation. Run as project owner in SQL Editor.
-- No destructive table changes; solutions, attempts and learned state stay intact.
begin;
create table if not exists revision_private.admins (
  user_id uuid primary key references auth.users on delete cascade,
  granted_at timestamptz not null default now()
);
create table if not exists revision_private.admin_imports (
  id uuid primary key, admin_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now(), import_type text not null,
  filename text, payload jsonb not null, result jsonb not null, changes jsonb not null
);
alter table revision_private.admins enable row level security;
alter table revision_private.admin_imports enable row level security;
revoke all on revision_private.admins,revision_private.admin_imports from public,anon,authenticated;

alter table public.revision_exams add column if not exists external_id text;
alter table public.revision_exams add column if not exists start_time time;
alter table public.revision_exams add column if not exists duration_minutes integer check(duration_minutes between 1 and 600);
create unique index if not exists revision_exam_external_id on public.revision_exams(external_id);
alter table public.revision_chapters add column if not exists archived boolean not null default false;
alter table public.revision_subtopics add column if not exists archived boolean not null default false;

create or replace function public.revision_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from revision_private.admins where user_id=(select auth.uid()))
$$;
revoke all on function public.revision_is_admin() from public,anon,authenticated;
grant execute on function public.revision_is_admin() to authenticated;

-- SQL Editor only: there is deliberately no RPC for assigning roles.
create or replace function revision_private.set_admin(target uuid, enabled boolean) returns void
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from auth.users where id=target) then raise exception 'Existing Auth user required'; end if;
  if enabled then insert into revision_private.admins(user_id) values(target) on conflict do nothing;
  else delete from revision_private.admins where user_id=target; end if;
end $$;
revoke all on function revision_private.set_admin(uuid,boolean) from public,anon,authenticated;

-- Canonical editable representation; never exposed without the admin guard.
create or replace function revision_private.admin_record(kind text, key text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  if kind='questions' then
    select jsonb_build_object('question_id',q.id,'topic_codes',
      (select string_agg(x.subtopic_id,'|' order by x.subtopic_id) from public.revision_question_subtopics x where (x.question_id,x.question_version)=(q.id,q.version)),
      'question',q.prompt_md,'answer',s.solution_md,'difficulty',q.difficulty,
      'estimated_minutes',q.estimated_seconds/60.0,'marks',q.total_marks,'source',q.source->>'title',
      'source_reference',coalesce(q.source->>'reference',''),'licence',q.source->>'licence',
      'reviewed_by',coalesce(q.source->>'reviewed_by',''),'status',q.status,'assets_json',q.assets,
      '_version',q.version,'_source',q.source)
    into result from public.revision_questions q join revision_private.solutions s on (s.question_id,s.question_version)=(q.id,q.version)
    where q.id=key order by q.version desc limit 1;
  elsif kind='exams' then
    select jsonb_build_object('exam_id',coalesce(e.external_id,e.id::text),'exam_board',su.board,'specification',sp.id,
      'paper_code',p.id,'paper_name',p.title,'exam_date',e.exam_date,'start_time',to_char(e.start_time,'HH24:MI'),
      'duration_minutes',e.duration_minutes,'status',case when e.provisional then 'estimated' else 'confirmed' end,
      'source_url',e.source_url,'label',e.label,'_id',e.id)
    into result from public.revision_exams e join public.revision_papers p on p.id=e.paper_id
    join public.revision_specifications sp on sp.id=p.specification_id join public.revision_subjects su on su.id=sp.subject_id
    where e.external_id=key or e.id::text=key;
  elsif kind='subjects' then select to_jsonb(t) into result from public.revision_subjects t where id=key;
  elsif kind='specifications' then select to_jsonb(t) into result from public.revision_specifications t where id=key;
  elsif kind='books' then select to_jsonb(t) into result from public.revision_books t where id=key;
  elsif kind='chapters' then select to_jsonb(t) into result from public.revision_chapters t where id=key;
  elsif kind='topics' then select to_jsonb(t) into result from public.revision_subtopics t where id=key;
  elsif kind='papers' then
    select to_jsonb(t)||jsonb_build_object('chapter_ids',(select coalesce(string_agg(chapter_id,'|' order by chapter_id),'') from public.revision_paper_chapters where paper_id=key))
    into result from public.revision_papers t where id=key;
  end if;
  return result;
end $$;
revoke all on function revision_private.admin_record(text,text) from public,anon,authenticated;

create or replace function revision_private.admin_boolean(value text) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if coalesce(value,'')='' then return false; end if;
  if value not in ('true','false') then raise exception 'Use true or false for boolean fields'; end if;
  return value::boolean;
end $$;
revoke all on function revision_private.admin_boolean(text) from public,anon,authenticated;

-- Same validation runs for preview AND confirmation. Each row captures its own error.
create or replace function revision_private.admin_plan(kind text, rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; n jsonb; old jsonb; effects jsonb; result jsonb:='[]'; seen text[]:='{}'; natural_seen text[]:='{}';
  key text; natural_key text; op text; tags text[]; required text[]; col text; err text; line integer:=0;
  year integer; matches integer; resolved text; seconds numeric; assets jsonb;
begin
  if kind not in ('questions','exams','subjects','specifications','books','chapters','topics','papers') or kind is null then raise exception 'Unknown import type'; end if;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 500 or octet_length(rows::text)>2000000 then
    raise exception 'Expected 1–500 rows, maximum 2 MB'; end if;
  for r in select value from jsonb_array_elements(rows) loop
    line:=line+1; key:=null; old:=null; n:=null; err:=null; effects:='[]';
    begin
      if jsonb_typeof(r)<>'object' then raise exception 'Expected an object'; end if;
      key:=btrim(r->>case kind when 'questions' then 'question_id' when 'exams' then 'exam_id' else 'id' end);
      if key is null or key !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then raise exception 'A stable identifier (up to 120 letters, numbers, _ . : -) is required'; end if;
      if key=any(seen) then raise exception 'Duplicate identifier within this import: %',key; end if;
      seen:=array_append(seen,key);
      old:=revision_private.admin_record(kind,key);
      required:=case kind
        when 'questions' then array['question','answer','topic_codes','difficulty','estimated_minutes']
        when 'exams' then array['exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status']
        when 'subjects' then array['name','board'] when 'specifications' then array['subject_id','code','title']
        when 'books' then array['specification_id','title','required','sort_order']
        when 'chapters' then array['book_id','number','title']
        when 'topics' then array['chapter_id','number','title','difficulty_rating','length_rating']
        when 'papers' then array['specification_id','title'] end;
      foreach col in array required loop
        if coalesce(btrim(r->>col),'')='' then raise exception 'Required field: %',col; end if;
      end loop;
      if kind='questions' then
        if key !~ '^[a-z0-9][a-z0-9_-]{2,119}$' then raise exception 'Question IDs require 3–120 lowercase letters, numbers, _ or -'; end if;
        select array_agg(distinct btrim(t) order by btrim(t)) into tags from unnest(string_to_array(r->>'topic_codes','|')) t;
        if exists(select 1 from unnest(tags) t where not exists(select 1 from public.revision_subtopics s join public.revision_chapters c on c.id=s.chapter_id where s.id=t
          and (r->>'status' in ('archived','withdrawn') or (not s.archived and not c.archived)))) then
          raise exception 'Unknown or archived topic code; use subtopic IDs separated by |'; end if;
        seconds:=(r->>'estimated_minutes')::numeric*60;
        if seconds<>trunc(seconds) or seconds not between 15 and 7200 then raise exception 'Estimated time must be 0.25–120 minutes, in whole seconds'; end if;
        if (r->>'difficulty')::integer not between 1 and 5 then raise exception 'Difficulty must be 1–5'; end if;
        if nullif(r->>'marks','')::integer<=0 then raise exception 'Marks must be a positive integer'; end if;
        op:=coalesce(nullif(r->>'status',''),'draft');
        if op not in ('draft','verified','archived','withdrawn') then raise exception 'Status must be draft, verified, archived or withdrawn'; end if;
        if op in ('archived','withdrawn') and old is null then raise exception 'Only existing questions can be retired'; end if;
        if op='verified' and (coalesce(btrim(r->>'reviewed_by'),'')='' or coalesce(btrim(r->>'source'),'')='' or coalesce(btrim(r->>'licence'),'')='') then
          raise exception 'Publishing requires source, licence and reviewed_by'; end if;
        assets:=coalesce(nullif(r->>'assets_json','')::jsonb,old->'assets_json','[]'::jsonb);
        if jsonb_typeof(assets)<>'array' then raise exception 'assets_json must be an array'; end if;
        if exists(select 1 from jsonb_array_elements(assets) a where coalesce(a->>'alt','')='' or coalesce(a->>'url','') !~ '^(https://[^ ]+|/[^/ ][^ ]*|[a-zA-Z0-9][a-zA-Z0-9_./-]*)$') then raise exception 'Assets require safe URLs and alternative text'; end if;
        n:=jsonb_build_object('question_id',key,'topic_codes',array_to_string(tags,'|'),'question',r->>'question','answer',r->>'answer',
          'difficulty',(r->>'difficulty')::integer,'estimated_minutes',seconds/60,'marks',nullif(r->>'marks','')::integer,
          'source',coalesce(r->>'source',''),'source_reference',coalesce(r->>'source_reference',''),'licence',coalesce(r->>'licence',''),
          'reviewed_by',coalesce(r->>'reviewed_by',''),'status',op,'assets_json',assets);
        if op in ('archived','withdrawn') and (old-'_version'-'_source'-'status') is distinct from (n-'status') then
          raise exception 'Retire questions separately from content edits'; end if;
      elsif kind='exams' then
        if r->>'exam_date' !~ '^\d{4}-\d{2}-\d{2}$' or extract(year from (r->>'exam_date')::date) not between 2020 and 2100 then raise exception 'Use a valid YYYY-MM-DD date, year 2020–2100'; end if;
        if r->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Use a valid 24-hour HH:MM start time'; end if;
        if (r->>'duration_minutes')::integer not between 1 and 600 then raise exception 'Duration must be 1–600 minutes'; end if;
        if r->>'status' not in ('estimated','confirmed') then raise exception 'Exam status must be estimated or confirmed'; end if;
        if coalesce(r->>'source_url','')<>'' and r->>'source_url' !~ '^https://[^[:space:]]+$' then raise exception 'Source URL must use HTTPS'; end if;
        resolved:=null;
        select p.id into resolved from public.revision_papers p join public.revision_specifications sp on sp.id=p.specification_id
          join public.revision_subjects su on su.id=sp.subject_id where p.id=r->>'paper_code'
          and (sp.id=r->>'specification' or sp.code=r->>'specification') and lower(su.board)=lower(r->>'exam_board');
        if resolved is null then raise exception 'Paper, specification and exam board do not match existing records'; end if;
        if (select title from public.revision_papers where id=resolved) is distinct from r->>'paper_name' then raise exception 'paper_name must match the existing paper title (edit papers separately)'; end if;
        year:=extract(year from (r->>'exam_date')::date);
        natural_key:=resolved||':'||year;
        if natural_key=any(natural_seen) then raise exception 'Duplicate paper/year within this import'; end if;
        natural_seen:=array_append(natural_seen,natural_key);
        if old is null then
          select count(*) into matches from public.revision_exams where paper_id=resolved and extract(year from exam_date)=year;
          if matches>1 then raise exception 'Multiple sittings exist: use the exact existing exam_id'; end if;
          if matches=1 then
            select revision_private.admin_record('exams',coalesce(external_id,id::text)) into old from public.revision_exams where paper_id=resolved and extract(year from exam_date)=year;
            if old->>'exam_id'<>old->>'_id' then raise exception 'Paper/year already has a stable exam_id: %',old->>'exam_id'; end if;
          end if;
        elsif old->>'paper_code'<>resolved or extract(year from (old->>'exam_date')::date)<>year then
          raise exception 'Keep exam identity within its paper and year; use a new exam_id for another year';
        end if;
        n:=jsonb_build_object('exam_id',key,'exam_board',old->>'exam_board','specification',(select specification_id from public.revision_papers where id=resolved),
          'paper_code',resolved,'paper_name',r->>'paper_name','exam_date',(r->>'exam_date')::date,'start_time',r->>'start_time',
          'duration_minutes',(r->>'duration_minutes')::integer,'status',r->>'status','source_url',coalesce(r->>'source_url',''),'label',coalesce(r->>'label',''));
        n:=jsonb_set(n,'{exam_board}',to_jsonb((select su.board from public.revision_papers p join public.revision_specifications sp on sp.id=p.specification_id join public.revision_subjects su on su.id=sp.subject_id where p.id=resolved)));
      elsif kind='subjects' then n:=jsonb_build_object('id',key,'name',r->>'name','board',r->>'board');
      elsif kind='specifications' then
        if not exists(select 1 from public.revision_subjects where id=r->>'subject_id') then raise exception 'Unknown subject_id'; end if;
        if old is not null and old->>'subject_id'<>r->>'subject_id' then raise exception 'Cannot reparent an existing specification'; end if;
        n:=jsonb_build_object('id',key,'subject_id',r->>'subject_id','code',r->>'code','title',r->>'title','source_url',coalesce(r->>'source_url',''));
      elsif kind='books' then
        if not exists(select 1 from public.revision_specifications where id=r->>'specification_id') then raise exception 'Unknown specification_id'; end if;
        if old is not null and old->>'specification_id'<>r->>'specification_id' then raise exception 'Cannot reparent an existing book'; end if;
        if nullif(r->>'option_level','')::integer not in (1,2) then raise exception 'Option level must be 1 or 2'; end if;
        n:=jsonb_build_object('id',key,'specification_id',r->>'specification_id','title',r->>'title','required',revision_private.admin_boolean(r->>'required'),
          'option_family',nullif(r->>'option_family',''),'option_level',nullif(r->>'option_level','')::integer,'sort_order',(r->>'sort_order')::integer);
      elsif kind='chapters' then
        if not exists(select 1 from public.revision_books where id=r->>'book_id') then raise exception 'Unknown book_id'; end if;
        if old is not null and (old->>'book_id'<>r->>'book_id' or (old->>'number')::integer<>(r->>'number')::integer) then raise exception 'Cannot reparent or renumber existing chapters; preserve student history'; end if;
        if (r->>'number')::integer<1 then raise exception 'Chapter number must be positive'; end if;
        if exists(select 1 from public.revision_chapters where book_id=r->>'book_id' and number=(r->>'number')::integer and id<>key) then raise exception 'Duplicate chapter number in book'; end if;
        natural_key:=(r->>'book_id')||':'||(r->>'number')::integer;
        if natural_key=any(natural_seen) then raise exception 'Duplicate chapter number in this import'; end if;
        natural_seen:=array_append(natural_seen,natural_key);
        n:=jsonb_build_object('id',key,'book_id',r->>'book_id','number',(r->>'number')::integer,'title',r->>'title',
          'description_md',nullif(r->>'description_md',''),'example_md',nullif(r->>'example_md',''),
          'reminder_reviewed',revision_private.admin_boolean(r->>'reminder_reviewed'),'archived',revision_private.admin_boolean(r->>'archived'));
      elsif kind='topics' then
        if not exists(select 1 from public.revision_chapters where id=r->>'chapter_id' and not archived) then raise exception 'Unknown or archived chapter_id'; end if;
        if old is not null and (old->>'chapter_id'<>r->>'chapter_id' or old->>'number'<>r->>'number') then raise exception 'Cannot reparent or renumber existing topics; preserve student history'; end if;
        if (r->>'difficulty_rating')::integer not between 1 and 5 or (r->>'length_rating')::integer not between 1 and 5 then raise exception 'Difficulty and length ratings must be 1–5'; end if;
        if exists(select 1 from public.revision_subtopics where chapter_id=r->>'chapter_id' and number=r->>'number' and id<>key) then raise exception 'Duplicate subtopic number in chapter'; end if;
        natural_key:=(r->>'chapter_id')||':'||(r->>'number');
        if natural_key=any(natural_seen) then raise exception 'Duplicate subtopic number in this import'; end if;
        natural_seen:=array_append(natural_seen,natural_key);
        if coalesce(nullif(r->>'page_start',''),'0')::integer<0 or coalesce(nullif(r->>'page_count',''),'0')::integer<0 then raise exception 'Page values cannot be negative'; end if;
        n:=jsonb_build_object('id',key,'chapter_id',r->>'chapter_id','number',r->>'number','title',r->>'title',
          'page_start',coalesce(nullif(r->>'page_start',''),'0')::integer,'page_count',coalesce(nullif(r->>'page_count',''),'0')::integer,
          'length_rating',(r->>'length_rating')::integer,'difficulty_rating',(r->>'difficulty_rating')::integer,
          'strand',coalesce(r->>'strand',''),'archived',revision_private.admin_boolean(r->>'archived'));
      elsif kind='papers' then
        if not exists(select 1 from public.revision_specifications where id=r->>'specification_id') then raise exception 'Unknown specification_id'; end if;
        if old is not null and old->>'specification_id'<>r->>'specification_id' then raise exception 'Cannot reparent existing papers'; end if;
        if nullif(r->>'option_book_id','') is not null and not exists(select 1 from public.revision_books where id=r->>'option_book_id' and specification_id=r->>'specification_id') then raise exception 'Option book must belong to the same specification'; end if;
        select array_agg(distinct btrim(t) order by btrim(t)) into tags from unnest(string_to_array(coalesce(r->>'chapter_ids',''),'|')) t where btrim(t)<>'';
        if exists(select 1 from unnest(tags) t where not exists(select 1 from public.revision_chapters c join public.revision_books b on b.id=c.book_id where c.id=t and b.specification_id=r->>'specification_id')) then raise exception 'Unknown chapter or chapter from another specification'; end if;
        n:=jsonb_build_object('id',key,'specification_id',r->>'specification_id','title',r->>'title','option_book_id',nullif(r->>'option_book_id',''),'chapter_ids',coalesce(array_to_string(tags,'|'),''));
      end if;
      if kind in ('chapters','topics') and (n->>'archived')::boolean then
        select coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'version',q.version,'before',q.status,'after','archived') order by q.id,q.version),'[]')
          into effects from public.revision_questions q where q.status='verified' and exists(
            select 1 from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
            where (x.question_id,x.question_version)=(q.id,q.version) and (case when kind='chapters' then t.chapter_id else t.id end)=key);
      elsif kind='questions' and n->>'status' in ('archived','withdrawn') then
        select coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'version',q.version,'before',q.status,'after',n->>'status') order by q.version),'[]')
          into effects from public.revision_questions q where q.id=key and q.version<>(old->>'_version')::integer and q.status in ('verified','draft');
      end if;
      -- Internal fields and retirement effects participate in concurrency tokens.
      op:=case when old is null then 'new' when (old-'_version'-'_source'-'_id')=n then 'unchanged' else 'update' end;
    exception when others then err:=sqlerrm;op:='invalid'; end;
    result:=result||jsonb_build_array(jsonb_build_object('line',coalesce(r->'line',to_jsonb(line+1)),'id',key,'operation',op,'error',err,'before',old,'after',n,'effects',effects));
  end loop;
  return jsonb_build_object('rows',result,'token',md5(kind||result::text),
    'valid',not exists(select 1 from jsonb_array_elements(result) t where t->>'operation'='invalid'));
end $$;
revoke all on function revision_private.admin_plan(text,jsonb) from public,anon,authenticated;

create or replace function revision_private.admin_apply(kind text, change jsonb) returns void
language plpgsql set search_path='' as $$
declare n jsonb:=change->'after'; old jsonb:=change->'before'; key text:=change->>'id'; v integer; src jsonb;
begin
  if change->>'operation'='unchanged' then return; end if;
  if kind='questions' then
    if n->>'status' in ('archived','withdrawn') then
      update public.revision_questions set status=n->>'status' where id=key and (status in ('verified','draft') or version=(old->>'_version')::integer);return;
    end if;
    v:=coalesce((old->>'_version')::integer,0)+1;
    src:=coalesce(old->'_source','{}')||jsonb_build_object('title',n->>'source','licence',n->>'licence','reference',n->>'source_reference','reviewed_by',n->>'reviewed_by');
    if n->>'status'='verified' then update public.revision_questions set status='archived' where id=key and status='verified'; end if;
    insert into public.revision_questions(id,version,prompt_md,difficulty,estimated_seconds,total_marks,source,status,assets)
      values(key,v,n->>'question',(n->>'difficulty')::integer,((n->>'estimated_minutes')::numeric*60)::integer,(n->>'marks')::integer,src,n->>'status',n->'assets_json');
    insert into revision_private.solutions values(key,v,n->>'answer');
    insert into public.revision_question_subtopics select key,v,t from unnest(string_to_array(n->>'topic_codes','|')) t;
  elsif kind='exams' then
    insert into public.revision_exams(id,external_id,paper_id,exam_date,provisional,source_url,label,start_time,duration_minutes)
    values(coalesce((old->>'_id')::uuid,gen_random_uuid()),key,n->>'paper_code',(n->>'exam_date')::date,n->>'status'='estimated',n->>'source_url',n->>'label',(n->>'start_time')::time,(n->>'duration_minutes')::integer)
    on conflict(id) do update set external_id=excluded.external_id,exam_date=excluded.exam_date,provisional=excluded.provisional,source_url=excluded.source_url,label=excluded.label,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes;
  elsif kind='subjects' then
    insert into public.revision_subjects select * from jsonb_populate_record(null::public.revision_subjects,n)
    on conflict(id) do update set name=excluded.name,board=excluded.board;
  elsif kind='specifications' then
    insert into public.revision_specifications select * from jsonb_populate_record(null::public.revision_specifications,n)
    on conflict(id) do update set code=excluded.code,title=excluded.title,source_url=excluded.source_url;
  elsif kind='books' then
    insert into public.revision_books select * from jsonb_populate_record(null::public.revision_books,n)
    on conflict(id) do update set title=excluded.title,required=excluded.required,option_family=excluded.option_family,option_level=excluded.option_level,sort_order=excluded.sort_order;
  elsif kind='chapters' then
    insert into public.revision_chapters select * from jsonb_populate_record(null::public.revision_chapters,n)
    on conflict(id) do update set title=excluded.title,description_md=excluded.description_md,example_md=excluded.example_md,reminder_reviewed=excluded.reminder_reviewed,archived=excluded.archived;
  elsif kind='topics' then
    insert into public.revision_subtopics select * from jsonb_populate_record(null::public.revision_subtopics,n)
    on conflict(id) do update set title=excluded.title,page_start=excluded.page_start,page_count=excluded.page_count,length_rating=excluded.length_rating,difficulty_rating=excluded.difficulty_rating,strand=excluded.strand,archived=excluded.archived;
  elsif kind='papers' then
    insert into public.revision_papers(id,specification_id,title,option_book_id) values(key,n->>'specification_id',n->>'title',n->>'option_book_id')
    on conflict(id) do update set title=excluded.title,option_book_id=excluded.option_book_id;
    delete from public.revision_paper_chapters where paper_id=key;
    insert into public.revision_paper_chapters select key,t from unnest(string_to_array(n->>'chapter_ids','|')) t where t<>'';
  end if;
  if kind in ('chapters','topics') and (n->>'archived')::boolean then
    update public.revision_questions q set status='archived' where q.status='verified' and exists(
      select 1 from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
      where (x.question_id,x.question_version)=(q.id,q.version) and (case when kind='chapters' then t.chapter_id else t.id end)=key);
  end if;
end $$;
revoke all on function revision_private.admin_apply(text,jsonb) from public,anon,authenticated;

-- One guarded endpoint, like the existing revision_api. Table writes remain revoked.
create or replace function public.revision_admin_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); kind text:=p_payload->>'type'; key text; plan jsonb; ch jsonb; result jsonb; prior revision_private.admin_imports%rowtype;
  rid uuid; inserted integer:=0; updated integer:=0; skipped integer:=0; failed integer:=0; err text; offst integer; lim integer; records jsonb; ordering text;
begin
  if u is null or not public.revision_is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_action='catalogue' then
    return jsonb_build_object(
      'subjects',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_subjects t),
      'specifications',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_specifications t),
      'books',(select coalesce(jsonb_agg(to_jsonb(t) order by sort_order,id),'[]') from public.revision_books t),
      'chapters',(select coalesce(jsonb_agg(to_jsonb(t) order by book_id,number),'[]') from public.revision_chapters t),
      'topics',(select coalesce(jsonb_agg(to_jsonb(t) order by chapter_id,number),'[]') from public.revision_subtopics t),
      'papers',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_papers t));
  elsif p_action='preview' then return revision_private.admin_plan(kind,p_payload->'rows');
  elsif p_action='import' then
    rid:=(p_payload->>'request_id')::uuid;
    if rid is null then raise exception 'request_id required'; end if;
    -- Serialise admin imports: versions, natural keys and preview comparisons stay atomic.
    perform pg_advisory_xact_lock(61934618);
    select * into prior from revision_private.admin_imports where id=rid;
    if found then
      if prior.admin_id is distinct from u or prior.payload is distinct from p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return prior.result;
    end if;
    plan:=revision_private.admin_plan(kind,p_payload->'rows');
    begin
      if not (plan->>'valid')::boolean then raise exception 'VALIDATION_FAILED: correct all invalid rows before importing'; end if;
      if p_payload->>'token' is distinct from plan->>'token' then raise exception 'PREVIEW_STALE: data changed; preview again before confirming'; end if;
      for ch in select value from jsonb_array_elements(plan->'rows') loop
        perform revision_private.admin_apply(kind,ch);
        case ch->>'operation' when 'new' then inserted:=inserted+1; when 'update' then updated:=updated+1; else skipped:=skipped+1; end case;
      end loop;
    exception when others then err:=sqlerrm;inserted:=0;updated:=0;skipped:=0;failed:=jsonb_array_length(p_payload->'rows'); end;
    result:=jsonb_build_object('id',rid,'inserted',inserted,'updated',updated,'skipped',skipped,'failed',failed,'error',err);
    insert into revision_private.admin_imports(id,admin_id,import_type,filename,payload,result,changes)
    values(rid,u,kind,left(p_payload->>'filename',255),p_payload,result,plan->'rows');
    return result;
  elsif p_action='record' then
    return revision_private.admin_record(kind,p_payload->>'id');
  elsif p_action='history_detail' then
    select to_jsonb(t)-'payload' into result from revision_private.admin_imports t where id=(p_payload->>'id')::uuid;return result;
  elsif p_action='list' then
    lim:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,25)));offst:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
    if kind='history' then
      select coalesce(jsonb_agg(to_jsonb(t)),'[]') into records from (
        select h.id,h.admin_id,h.created_at,h.import_type,h.filename,h.result from revision_private.admin_imports h
        where (h.import_type||' '||coalesce(h.filename,'')||' '||coalesce(h.admin_id::text,'')) ilike '%'||coalesce(p_payload->>'search','')||'%'
        order by case when p_payload->>'sort'='oldest' then h.created_at end asc,h.created_at desc,h.id limit lim offset offst) t;
      return jsonb_build_object('rows',records,'total',(select count(*) from revision_private.admin_imports h where (h.import_type||' '||coalesce(h.filename,'')||' '||coalesce(h.admin_id::text,'')) ilike '%'||coalesce(p_payload->>'search','')||'%'));
    elsif kind='students' then
      select coalesce(jsonb_agg(to_jsonb(t)),'[]') into records from (
        select a.id as user_id,to_jsonb(a)->>'email' as email,p.daily_minutes,p.timezone,p.exam_year,p.onboarded,
          (select count(*) from public.revision_attempts where user_id=a.id) as attempts,
          (select max(completed_at) from public.revision_attempts where user_id=a.id) as last_activity
        from auth.users a left join public.revision_profiles p on p.user_id=a.id
        where (coalesce(to_jsonb(a)->>'email','')||a.id::text) ilike '%'||coalesce(p_payload->>'search','')||'%'
        order by case when p_payload->>'sort'='activity' then (select max(completed_at) from public.revision_attempts where user_id=a.id) end desc nulls last,a.id limit lim offset offst) t;
      return jsonb_build_object('rows',records,'total',(select count(*) from auth.users a where (coalesce(to_jsonb(a)->>'email','')||a.id::text) ilike '%'||coalesce(p_payload->>'search','')||'%'));
    elsif kind='questions' then
      with latest as (select distinct on(id) * from public.revision_questions order by id,version desc), filtered as (
        select q.* from latest q where (q.id||' '||q.prompt_md) ilike '%'||coalesce(p_payload->>'search','')||'%'
        and (nullif(p_payload->>'difficulty','') is null or q.difficulty=(p_payload->>'difficulty')::integer)
        and (nullif(p_payload->>'status','') is null or q.status=p_payload->>'status')
        and exists(select 1 from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
          join public.revision_chapters c on c.id=t.chapter_id join public.revision_books b on b.id=c.book_id
          join public.revision_specifications s on s.id=b.specification_id
          where (x.question_id,x.question_version)=(q.id,q.version)
          and (nullif(p_payload->>'topic','') is null or t.id=p_payload->>'topic')
          and (nullif(p_payload->>'specification','') is null or s.id=p_payload->>'specification')
          and (nullif(p_payload->>'subject','') is null or s.subject_id=p_payload->>'subject'))
      ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(jsonb_agg(to_jsonb(v)),'[]')) into result from (
        select q.*, (select jsonb_build_object('attempts',count(*),'mean_correctness',avg(correctness),'mean_ease',avg(ease)) from public.revision_attempts a where a.question_id=q.id) as statistics
        from filtered q order by case when p_payload->>'sort'='title' then prompt_md else id end,id limit lim offset offst) v;
      return result;
    elsif kind in ('exams','subjects','specifications','books','chapters','topics','papers') then
      -- Relation and sort expressions are fixed allowlists; all caller values are bound.
      ordering:=case when kind='exams' and p_payload->>'sort'='date' then 'record->>''exam_date'''
        when kind='exams' then 'record->>''specification'',record->>''paper_code'',record->>''exam_date'''
        when p_payload->>'sort'='title' then 'coalesce(record->>''title'',record->>''name'')'
        when kind='chapters' then 'record->>''book_id'',(record->>''number'')::integer'
        when kind='topics' then 'record->>''chapter_id'',record->>''number''' else 'stable_id' end;
      execute format('with records as (select t.id::text stable_id,revision_private.admin_record($1,t.id::text) record from public.%I t),
        filtered as (select * from records where record::text ilike $2 and ($5='''' or left(record->>''exam_date'',4)=$5)
          and ($6='''' or record->>''status''=$6) and ($7='''' or record->>''specification''=$7))
        select jsonb_build_object(''total'',(select count(*) from filtered),''rows'',coalesce(jsonb_agg(v.record),''[]''))
        from (select record from filtered order by %s,stable_id limit $3 offset $4) v',
        case kind when 'topics' then 'revision_subtopics' else 'revision_'||kind end,ordering)
        into result using kind,'%'||coalesce(p_payload->>'search','')||'%',lim,offst,
          coalesce(p_payload->>'year',''),coalesce(p_payload->>'status',''),coalesce(p_payload->>'specification','');
      return result;
    end if;
  elsif p_action='student' then
    return jsonb_build_object('profile',(select to_jsonb(p) from public.revision_profiles p where user_id=(p_payload->>'id')::uuid),
      'enrolments',(select coalesce(jsonb_agg(book_id),'[]') from public.revision_enrolments where user_id=(p_payload->>'id')::uuid),
      'progress',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('proficiency',alpha/(alpha+beta),'variance',alpha*beta/((alpha+beta)^2*(alpha+beta+1)))),'[]') from public.revision_progress p where user_id=(p_payload->>'id')::uuid),
      'activity',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select question_id,question_version,correctness,ease,active_seconds,completed_at from public.revision_attempts where user_id=(p_payload->>'id')::uuid order by completed_at desc limit 30) a));
  end if;
  raise exception 'Unknown admin action or type';
end $$;
revoke all on function public.revision_admin_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.revision_admin_api(text,jsonb) to authenticated;
commit;
