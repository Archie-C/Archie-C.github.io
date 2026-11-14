-- Apply after 06-admin.sql. Adds timetable-first imports without creating topics.
-- Preview is read-only; missing catalogue rows are created only on confirmation.
begin;
create table if not exists revision_private.exam_paper_codes (
  specification_id text not null references public.revision_specifications,
  code text not null, paper_id text not null references public.revision_papers,
  primary key(specification_id,code)
);
alter table revision_private.exam_paper_codes enable row level security;
revoke all on revision_private.exam_paper_codes from public,anon,authenticated;

create or replace function revision_private.exam_identifier(value text) returns text
language sql immutable set search_path='' as $$
  select case when length(value)>120 then left(value,103)||'-'||left(md5(value),16) else value end
$$;
revoke all on function revision_private.exam_identifier(text) from public,anon,authenticated;

create or replace function revision_private.admin_exam_plan(rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare catalogue jsonb; saved_catalogue jsonb; r jsonb; s jsonb; sp jsonb; p jsonb; alias_row jsonb;
  candidates jsonb; old jsonb; n jsonb; creates jsonb; notes jsonb; result jsonb:='[]';
  seen text[]:='{}'; natural_seen text[]:='{}'; key text; board text; board_slug text; spec_input text;
  spec_id text; subject_key text; code text; paper_key text; natural_key text; op text; err text;
  required text; line integer:=0; exam_year integer; matches integer;
begin
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 500 or octet_length(rows::text)>2000000 then
    raise exception 'Expected 1–500 rows, maximum 2 MB'; end if;
  select jsonb_build_object(
    'subjects',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.revision_subjects t),
    'specifications',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.revision_specifications t),
    'papers',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.revision_papers t),
    'paper_codes',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from revision_private.exam_paper_codes t)) into catalogue;
  for r in select value from jsonb_array_elements(rows) loop
    line:=line+1;key:=null;old:=null;n:=null;err:=null;creates:='[]';notes:='[]';
    s:=null;sp:=null;p:=null;alias_row:=null;saved_catalogue:=catalogue;
    begin
      if jsonb_typeof(r)<>'object' then raise exception 'Expected an object'; end if;
      key:=btrim(r->>'exam_id');
      if key is null or key !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then raise exception 'A stable exam_id (up to 120 letters, numbers, _ . : -) is required'; end if;
      if key=any(seen) then raise exception 'Duplicate identifier within this import: %',key; end if;
      seen:=array_append(seen,key);
      foreach required in array array['exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status'] loop
        if coalesce(btrim(r->>required),'')='' then raise exception 'Required field: %',required; end if;
      end loop;
      if r->>'exam_date' !~ '^\d{4}-\d{2}-\d{2}$' or extract(year from (r->>'exam_date')::date) not between 2020 and 2100 then raise exception 'Use a valid YYYY-MM-DD date, year 2020–2100'; end if;
      if r->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Use a valid 24-hour HH:MM start time'; end if;
      if (r->>'duration_minutes')::integer not between 1 and 600 then raise exception 'Duration must be 1–600 minutes'; end if;
      if r->>'status' not in ('estimated','confirmed') then raise exception 'Exam status must be estimated or confirmed'; end if;
      if coalesce(r->>'source_url','')<>'' and r->>'source_url' !~ '^https://[^[:space:]]+$' then raise exception 'Source URL must use HTTPS'; end if;
      board:=btrim(r->>'exam_board');spec_input:=btrim(r->>'specification');code:=lower(btrim(r->>'paper_code'));
      board_slug:=trim(both '-' from regexp_replace(lower(board),'[^a-z0-9]+','-','g'));
      if board_slug='' or length(board)>120 then raise exception 'Use an exam board name of up to 120 characters'; end if;
      if spec_input !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then raise exception 'Specification must be a stable ID or qualification code, up to 120 characters'; end if;
      if code !~ '^[a-z0-9][a-z0-9_.:/-]{0,119}$' then raise exception 'Paper code must use letters, numbers, _ . : / or - (up to 120 characters)'; end if;

      -- Prefer an explicit specification ID; otherwise resolve a code within its board.
      select value into sp from jsonb_array_elements(catalogue->'specifications') where value->>'id'=spec_input;
      if sp is null then
        select coalesce(jsonb_agg(x.value),'[]') into candidates from jsonb_array_elements(catalogue->'specifications') x
          join jsonb_array_elements(catalogue->'subjects') su on su.value->>'id'=x.value->>'subject_id'
          where lower(x.value->>'code')=lower(spec_input) and lower(btrim(su.value->>'board'))=lower(board);
        if jsonb_array_length(candidates)>1 then raise exception 'Ambiguous qualification code: use the specification ID'; end if;
        sp:=candidates->0;
      end if;
      if sp is null then
        spec_id:=revision_private.exam_identifier(case when lower(spec_input) like board_slug||'-%' then lower(spec_input) else board_slug||'-'||lower(spec_input) end);
        select value into sp from jsonb_array_elements(catalogue->'specifications') where value->>'id'=spec_id;
      end if;
      if sp is not null then
        select value into s from jsonb_array_elements(catalogue->'subjects') where value->>'id'=sp->>'subject_id';
        if lower(btrim(s->>'board'))<>lower(board) then raise exception 'Specification belongs to a different exam board'; end if;
        if nullif(btrim(r->>'subject_id'),'') is not null and r->>'subject_id'<>s->>'id' then raise exception 'Existing specification belongs to another subject; reparenting requires an explicit migration'; end if;
        -- Repeated descriptions in one batch must agree for newly proposed records.
        if not exists(select 1 from public.revision_subjects where id=s->>'id') and nullif(btrim(r->>'subject_name'),'') is not null and r->>'subject_name'<>s->>'name' then raise exception 'Conflicting subject_name within this import'; end if;
        if not exists(select 1 from public.revision_specifications where id=sp->>'id') and nullif(btrim(r->>'specification_title'),'') is not null and r->>'specification_title'<>sp->>'title' then raise exception 'Conflicting specification_title within this import'; end if;
      else
        subject_key:=coalesce(nullif(btrim(r->>'subject_id'),''),spec_id);
        if subject_key !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then raise exception 'subject_id must be a stable identifier, up to 120 characters'; end if;
        select value into s from jsonb_array_elements(catalogue->'subjects') where value->>'id'=subject_key;
        if s is not null then
          if lower(btrim(s->>'board'))<>lower(board) then raise exception 'Subject belongs to a different exam board'; end if;
          if not exists(select 1 from public.revision_subjects where id=s->>'id') and nullif(btrim(r->>'subject_name'),'') is not null and r->>'subject_name'<>s->>'name' then raise exception 'Conflicting subject_name within this import'; end if;
        else
          s:=jsonb_build_object('id',subject_key,'name',coalesce(nullif(btrim(r->>'subject_name'),''),nullif(btrim(r->>'specification_title'),''),spec_input),'board',board);
          catalogue:=jsonb_set(catalogue,'{subjects}',(catalogue->'subjects')||jsonb_build_array(s));
          creates:=creates||jsonb_build_array(jsonb_build_object('entity','subjects','id',subject_key,'before',null,'after',s));
        end if;
        sp:=jsonb_build_object('id',spec_id,'subject_id',s->>'id','code',case when lower(spec_input) like board_slug||'-%' then substring(spec_input from length(board_slug)+2) else spec_input end,
          'title',coalesce(nullif(btrim(r->>'specification_title'),''),spec_input),'source_url','');
        catalogue:=jsonb_set(catalogue,'{specifications}',(catalogue->'specifications')||jsonb_build_array(sp));
        creates:=creates||jsonb_build_array(jsonb_build_object('entity','specifications','id',spec_id,'before',null,'after',sp));
      end if;

      -- Codes can be aliases of existing syllabus papers, without losing topic mappings.
      select coalesce(jsonb_agg(value),'[]') into candidates from jsonb_array_elements(catalogue->'papers') where lower(value->>'id')=code and value->>'specification_id'=sp->>'id';
      if jsonb_array_length(candidates)>1 then raise exception 'Ambiguous paper code: existing paper IDs differ only in case'; end if;
      p:=candidates->0;
      select value into alias_row from jsonb_array_elements(catalogue->'paper_codes') where value->>'specification_id'=sp->>'id' and value->>'code'=code;
      if alias_row is not null then
        if p is not null and p->>'id'<>alias_row->>'paper_id' then raise exception 'Paper code conflicts with an existing paper mapping'; end if;
        select value into p from jsonb_array_elements(catalogue->'papers') where value->>'id'=alias_row->>'paper_id';
      end if;
      if p is null then
        -- Only option-book papers match by name. Different history/language variants
        -- often share a title and must retain their distinct official paper codes.
        select coalesce(jsonb_agg(value),'[]') into candidates from jsonb_array_elements(catalogue->'papers')
          where value->>'specification_id'=sp->>'id' and nullif(value->>'option_book_id','') is not null
          and lower(regexp_replace(btrim(value->>'title'),'\s+',' ','g'))=lower(regexp_replace(btrim(r->>'paper_name'),'\s+',' ','g'));
        if jsonb_array_length(candidates)>1 then raise exception 'Ambiguous optional paper title: use an existing paper ID'; end if;
        p:=candidates->0;
      end if;
      if p is null then
        paper_key:=regexp_replace(code,'[^a-z0-9_.:-]+','-','g');
        if exists(select 1 from jsonb_array_elements(catalogue->'papers') where value->>'id'=paper_key) then
          paper_key:=revision_private.exam_identifier((sp->>'id')||'-'||paper_key);
        end if;
        if exists(select 1 from jsonb_array_elements(catalogue->'papers') where value->>'id'=paper_key) then raise exception 'Paper ID collision: use a distinct paper code'; end if;
        p:=jsonb_build_object('id',paper_key,'specification_id',sp->>'id','title',btrim(r->>'paper_name'),'option_book_id',null);
        catalogue:=jsonb_set(catalogue,'{papers}',(catalogue->'papers')||jsonb_build_array(p));
        creates:=creates||jsonb_build_array(jsonb_build_object('entity','papers','id',paper_key,'before',null,'after',p));
      end if;
      if code<>p->>'id' and alias_row is null then
        alias_row:=jsonb_build_object('specification_id',sp->>'id','code',code,'paper_id',p->>'id');
        catalogue:=jsonb_set(catalogue,'{paper_codes}',(catalogue->'paper_codes')||jsonb_build_array(alias_row));
        creates:=creates||jsonb_build_array(jsonb_build_object('entity','paper_codes','id',(sp->>'id')||':'||code,'before',null,'after',alias_row));
      end if;
      if p->>'title'<>r->>'paper_name' then notes:=notes||jsonb_build_array('Using the existing paper title: '||(p->>'title')); end if;
      if p->>'id'<>r->>'paper_code' then notes:=notes||jsonb_build_array('Paper code maps to ID: '||(p->>'id')); end if;

      old:=revision_private.admin_record('exams',key);
      exam_year:=extract(year from (r->>'exam_date')::date);
      natural_key:=(p->>'id')||':'||exam_year;
      if natural_key=any(natural_seen) then raise exception 'Duplicate paper/year within this import'; end if;
      if old is null then
        select count(*) into matches from public.revision_exams where paper_id=p->>'id' and extract(year from exam_date)=exam_year;
        if matches>1 then raise exception 'Multiple sittings exist: use the exact existing exam_id'; end if;
        if matches=1 then
          select revision_private.admin_record('exams',coalesce(external_id,id::text)) into old from public.revision_exams where paper_id=p->>'id' and extract(year from exam_date)=exam_year;
          if old->>'exam_id'<>old->>'_id' then raise exception 'Paper/year already has a stable exam_id: %',old->>'exam_id'; end if;
        end if;
      elsif old->>'paper_code'<>p->>'id' or extract(year from (old->>'exam_date')::date)<>exam_year then
        raise exception 'Keep exam identity within its paper and year; use a new exam_id for another year';
      end if;
      natural_seen:=array_append(natural_seen,natural_key);
      n:=jsonb_build_object('exam_id',key,'exam_board',s->>'board','specification',sp->>'id','paper_code',p->>'id','paper_name',p->>'title',
        'exam_date',(r->>'exam_date')::date,'start_time',r->>'start_time','duration_minutes',(r->>'duration_minutes')::integer,
        'status',r->>'status','source_url',coalesce(r->>'source_url',''),'label',coalesce(r->>'label',''));
      op:=case when old is null then 'new' when (old-'_id')=n and jsonb_array_length(creates)=0 then 'unchanged' else 'update' end;
    exception when others then err:=sqlerrm;op:='invalid';catalogue:=saved_catalogue;creates:='[]'; end;
    result:=result||jsonb_build_array(jsonb_build_object('line',coalesce(r->'line',to_jsonb(line+1)),'id',key,'operation',op,'error',err,'before',old,'after',n,
      'effects','[]'::jsonb,'catalogue_changes',creates,'notes',notes,'references',jsonb_build_object('subject',s,'specification',sp,'paper',p,'alias',alias_row)));
  end loop;
  return jsonb_build_object('rows',result,'token',md5('exams'||result::text),'valid',not exists(select 1 from jsonb_array_elements(result) t where t->>'operation'='invalid'));
end $$;
revoke all on function revision_private.admin_exam_plan(jsonb) from public,anon,authenticated;

create or replace function revision_private.admin_exam_apply(change jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb; n jsonb:=change->'after'; old jsonb:=change->'before'; value jsonb;
begin
  for item in select v from jsonb_array_elements(coalesce(change->'catalogue_changes','[]')) v loop
    value:=item->'after';
    case item->>'entity'
      when 'subjects' then insert into public.revision_subjects(id,name,board) values(value->>'id',value->>'name',value->>'board');
      when 'specifications' then insert into public.revision_specifications(id,subject_id,code,title,source_url)
        values(value->>'id',value->>'subject_id',value->>'code',value->>'title',value->>'source_url');
      when 'papers' then insert into public.revision_papers(id,specification_id,title,option_book_id)
        values(value->>'id',value->>'specification_id',value->>'title',null);
      when 'paper_codes' then insert into revision_private.exam_paper_codes(specification_id,code,paper_id)
        values(value->>'specification_id',value->>'code',value->>'paper_id');
      else raise exception 'Unknown exam catalogue change';
    end case;
  end loop;
  insert into public.revision_exams(id,external_id,paper_id,exam_date,provisional,source_url,label,start_time,duration_minutes)
  values(coalesce((old->>'_id')::uuid,gen_random_uuid()),n->>'exam_id',n->>'paper_code',(n->>'exam_date')::date,n->>'status'='estimated',n->>'source_url',n->>'label',(n->>'start_time')::time,(n->>'duration_minutes')::integer)
  on conflict(id) do update set external_id=excluded.external_id,exam_date=excluded.exam_date,provisional=excluded.provisional,source_url=excluded.source_url,label=excluded.label,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes;
end $$;
revoke all on function revision_private.admin_exam_apply(jsonb) from public,anon,authenticated;

-- The following function replacements keep all non-exam imports unchanged.
create or replace function revision_private.admin_plan(kind text, rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; n jsonb; old jsonb; effects jsonb; result jsonb:='[]'; seen text[]:='{}'; natural_seen text[]:='{}';
  key text; natural_key text; op text; tags text[]; required text[]; col text; err text; line integer:=0;
  year integer; matches integer; resolved text; seconds numeric; assets jsonb;
begin
  if kind='exams' then return revision_private.admin_exam_plan(rows); end if;
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
    perform revision_private.admin_exam_apply(change);
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

commit;
