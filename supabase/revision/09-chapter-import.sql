-- Apply after 08-options.sql. Existing chapter and student history is retained.
begin;
create or replace function revision_private.admin_plan(kind text, rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; n jsonb; old jsonb; effects jsonb; result jsonb:='[]'; seen text[]:='{}'; natural_seen text[]:='{}';
  key text; natural_key text; op text; tags text[]; required text[]; col text; err text; line integer:=0;
  year integer; matches integer; resolved text; seconds numeric; assets jsonb; inferred_spec text; inferred_book text;
begin
  if kind in ('option_groups','options') then return revision_private.admin_option_plan(kind,rows); end if;
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
        when 'chapters' then array['number','title']
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
        -- Retain existing parents; infer new ones from a complete specification ID.
        if coalesce(btrim(r->>'book_id'),'')='' then
          if old is not null then
            inferred_book:=old->>'book_id';
          else
            select count(*),min(s.id) into matches,inferred_spec
            from public.revision_specifications s
            where position('-'||lower(s.id)||'-' in '-'||lower(key)||'-')>0;
            if matches<>1 then
              raise exception 'Chapter ID must contain exactly one existing specification ID, or supply book_id';
            end if;
            select count(*),min(b.id) into matches,inferred_book from public.revision_books b
              where b.specification_id=inferred_spec and b.required;
            if matches<>1 then
              inferred_book:='chapter-default-'||md5(inferred_spec);
              if exists(select 1 from public.revision_books b where b.id=inferred_book
                        and (b.specification_id<>inferred_spec or not b.required)) then
                raise exception 'Automatic chapter book ID conflicts with an existing book';
              end if;
              if not exists(select 1 from public.revision_books b where b.id=inferred_book) then
                effects:=effects||jsonb_build_array(jsonb_build_object('create_book',inferred_book,'specification_id',inferred_spec));
              end if;
            end if;
          end if;
          r:=jsonb_set(r,'{book_id}',to_jsonb(inferred_book),true);
        elsif not exists(select 1 from public.revision_books where id=r->>'book_id') then
          raise exception 'Unknown book_id';
        end if;
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
        select effects || coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'version',q.version,'before',q.status,'after','archived') order by q.id,q.version),'[]')
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
  if kind in ('option_groups','options') then perform revision_private.admin_option_apply(kind,change);return; end if;
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
    insert into public.revision_books(id,specification_id,title,required,sort_order)
      select e->>'create_book',e->>'specification_id','Chapters',true,0
      from jsonb_array_elements(change->'effects') e where e ? 'create_book'
      on conflict(id) do nothing;
    insert into public.revision_enrolments(user_id,book_id)
      select se.user_id,e->>'create_book'
      from jsonb_array_elements(change->'effects') e
      join public.revision_specification_enrolments se on se.specification_id=e->>'specification_id'
      where e ? 'create_book' on conflict do nothing;
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
