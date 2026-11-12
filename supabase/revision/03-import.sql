begin;
-- Administrator-only, atomic import. Never grant schema usage or this function to browsers.
create or replace function revision_private.import_questions(document jsonb) returns integer
language plpgsql set search_path='' as $$
declare q jsonb; a jsonb; old public.revision_questions%rowtype; qid text; v integer; st text;
  tags text[]; counter integer:=0; old_solution text; reviewer text;
begin
  if document->>'schema_version' is distinct from '1' or jsonb_typeof(document->'questions') is distinct from 'array' then
    raise exception 'Expected schema_version 1 and a questions array'; end if;
  for q in select value from jsonb_array_elements(document->'questions') loop
    qid:=q->>'id'; v:=(q->>'version')::integer; st:=q->>'review_status';
    if qid is null or qid !~ '^[a-z0-9][a-z0-9_-]{2,119}$' or v is null or v<1 then raise exception 'Invalid question id/version'; end if;
    if st is null or st not in ('draft','verified') then raise exception 'Invalid review_status for %',qid; end if;
    if coalesce(length(trim(q->>'prompt_md')),0)=0 or coalesce(length(trim(q->>'solution_md')),0)=0 then
      raise exception 'Prompt and solution required for %',qid; end if;
    if jsonb_typeof(q->'subtopic_ids') is distinct from 'array' or jsonb_array_length(q->'subtopic_ids')=0 then
      raise exception 'Subtopics required for %',qid; end if;
    select array_agg(distinct value order by value) into tags from jsonb_array_elements_text(q->'subtopic_ids');
    if exists(select 1 from unnest(tags) t where not exists(select 1 from public.revision_subtopics where id=t)) then
      raise exception 'Unknown subtopic for %',qid; end if;
    if jsonb_typeof(q->'source') is distinct from 'object' or coalesce(length(q->'source'->>'licence'),0)=0
      or coalesce(length(q->'source'->>'title'),0)=0 then raise exception 'Source title/licence required for %',qid; end if;
    reviewer:=q->'source'->>'reviewed_by';
    if st='verified' and coalesce(length(trim(reviewer)),0)=0 then raise exception 'Reviewed questions need reviewed_by for %',qid; end if;
    if jsonb_typeof(coalesce(q->'assets','[]'))<>'array' then raise exception 'Assets must be an array'; end if;
    for a in select value from jsonb_array_elements(coalesce(q->'assets','[]')) loop
      if coalesce(length(a->>'alt'),0)=0 or coalesce(a->>'url','') !~ '^(https://[^ ]+|/[^/ ][^ ]*|[a-zA-Z0-9][a-zA-Z0-9_./-]*)$' then
        raise exception 'Assets require an HTTPS/relative URL and alternative text'; end if;
    end loop;
    select * into old from public.revision_questions where id=qid and version=v;
    if found then
      select solution_md into old_solution from revision_private.solutions where question_id=qid and question_version=v;
      if old.prompt_md is distinct from q->>'prompt_md' or old_solution is distinct from q->>'solution_md'
        or old.difficulty is distinct from (q->>'difficulty')::integer
        or old.estimated_seconds is distinct from (q->>'estimated_seconds')::integer
        or old.total_marks is distinct from (q->>'total_marks')::integer
        or (old.source-'reviewed_by') is distinct from ((q->'source')-'reviewed_by')
        or (old.status<>'draft' and old.source is distinct from q->'source')
        or old.assets is distinct from coalesce(q->'assets','[]')
        or tags is distinct from (select array_agg(subtopic_id order by subtopic_id) from public.revision_question_subtopics where question_id=qid and question_version=v)
        then raise exception 'Question versions are immutable: increment version for %',qid; end if;
      -- A reviewed, identical draft may be promoted; archived versions stay archived on reimport.
      if old.status='draft' and st='verified' then
        if exists(select 1 from public.revision_questions where id=qid and version>v) then
          raise exception 'Cannot publish an older draft for %; publish the latest version',qid; end if;
        update public.revision_questions set status='archived' where id=qid and status='verified';
        update public.revision_questions set status='verified',source=q->'source' where id=qid and version=v;
      end if;
      continue;
    end if;
    if exists(select 1 from public.revision_questions where id=qid and version>=v) then raise exception 'Version must increase for %',qid; end if;
    if st='verified' then update public.revision_questions set status='archived' where id=qid and status='verified'; end if;
    insert into public.revision_questions(id,version,prompt_md,difficulty,estimated_seconds,total_marks,assets,source,status)
      values(qid,v,q->>'prompt_md',(q->>'difficulty')::integer,(q->>'estimated_seconds')::integer,
        (q->>'total_marks')::integer,coalesce(q->'assets','[]'),q->'source',st);
    insert into revision_private.solutions values(qid,v,q->>'solution_md');
    insert into public.revision_question_subtopics select qid,v,t from unnest(tags) t;
    counter:=counter+1;
  end loop;
  return counter;
end $$;
revoke all on function revision_private.import_questions(jsonb) from public,anon,authenticated;
commit;
