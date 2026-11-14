-- Apply after 07-exam-catalogue.sql. General syllabus options; no progress/history drops.
begin;
create table if not exists public.revision_option_groups (
  id text primary key, specification_id text not null references public.revision_specifications,
  title text not null, min_choices integer not null check(min_choices between 0 and 100),
  max_choices integer not null check(max_choices between 0 and 100 and max_choices>=min_choices),
  archived boolean not null default false
);
create table if not exists public.revision_options (
  id text primary key, group_id text not null references public.revision_option_groups,
  title text not null, requires_option_id text references public.revision_options,
  archived boolean not null default false, check(requires_option_id is distinct from id)
);
create table if not exists public.revision_option_targets (
  id bigint generated always as identity primary key,
  option_id text not null references public.revision_options,
  book_id text references public.revision_books,
  chapter_id text references public.revision_chapters,
  subtopic_id text references public.revision_subtopics,
  check(num_nonnulls(book_id,chapter_id,subtopic_id)=1)
);
create unique index if not exists revision_option_book on public.revision_option_targets(option_id,book_id) where book_id is not null;
create unique index if not exists revision_option_chapter on public.revision_option_targets(option_id,chapter_id) where chapter_id is not null;
create unique index if not exists revision_option_topic on public.revision_option_targets(option_id,subtopic_id) where subtopic_id is not null;
create table if not exists public.revision_specification_enrolments (
  user_id uuid not null references public.revision_profiles on delete cascade,
  specification_id text not null references public.revision_specifications,
  primary key(user_id,specification_id)
);
create table if not exists public.revision_option_selections (
  user_id uuid not null references public.revision_profiles on delete cascade,
  option_id text not null references public.revision_options,
  primary key(user_id,option_id)
);
do $$ declare t text; begin
  foreach t in array array['option_groups','options','option_targets','specification_enrolments','option_selections'] loop
    execute format('alter table public.revision_%I enable row level security',t);
    execute format('revoke all on public.revision_%I from public,anon,authenticated',t);
    execute format('grant select on public.revision_%I to authenticated',t);
    execute format('drop policy if exists revision_read on public.revision_%I',t);
    if t in ('specification_enrolments','option_selections') then
      execute format('create policy revision_read on public.revision_%I for select to authenticated using(user_id=(select auth.uid()))',t);
    else
      execute format('create policy revision_read on public.revision_%I for select to authenticated using((select auth.uid()) is not null)',t);
    end if;
  end loop;
end $$;

-- Express the existing Further Maths routes through the same data model.
insert into public.revision_option_groups(id,specification_id,title,min_choices,max_choices)
select 'edexcel-9fm0-options',id,'Optional books',2,2 from public.revision_specifications where id='edexcel-9fm0'
on conflict(id) do nothing;
insert into public.revision_options(id,group_id,title,requires_option_id)
select b.id,'edexcel-9fm0-options',b.title,b1.id from public.revision_books b left join public.revision_books b1
  on b.option_level=2 and b1.specification_id=b.specification_id and b1.option_family=b.option_family and b1.option_level=1
where b.specification_id='edexcel-9fm0' and not b.required
on conflict(id) do nothing;
insert into public.revision_option_targets(option_id,book_id)
select b.id,b.id from public.revision_books b where b.specification_id='edexcel-9fm0' and not b.required
  and not exists(select 1 from public.revision_option_targets t where t.option_id=b.id);
insert into public.revision_option_selections
select en.user_id,o.id from public.revision_enrolments en join public.revision_options o on o.id=en.book_id
where o.group_id='edexcel-9fm0-options' and not exists(select 1 from public.revision_specification_enrolments s where s.user_id=en.user_id) on conflict do nothing;
insert into public.revision_specification_enrolments
select distinct en.user_id,b.specification_id from public.revision_enrolments en join public.revision_books b on b.id=en.book_id
where not exists(select 1 from public.revision_specification_enrolments s where s.user_id=en.user_id) on conflict do nothing;

-- Untargeted content is core. Each group that covers content must allow it.
-- An archived group/choice continues to gate its targets, preventing accidental publication as core.
create or replace function revision_private.content_selected(u uuid, book text, chapter text default null, topic text default null) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.revision_enrolments where user_id=u and book_id=book)
    and not exists(
      select 1 from public.revision_option_groups g where exists(
        select 1 from public.revision_options o join public.revision_option_targets t on t.option_id=o.id
        where o.group_id=g.id and (t.book_id=book or t.chapter_id=chapter or t.subtopic_id=topic))
      and not exists(
        select 1 from public.revision_options o join public.revision_option_targets t on t.option_id=o.id
        join public.revision_option_selections s on s.option_id=o.id and s.user_id=u
        where o.group_id=g.id and not g.archived and not o.archived
          and (t.book_id=book or t.chapter_id=chapter or t.subtopic_id=topic)))
$$;
create or replace function revision_private.topic_selected(u uuid, topic text) returns boolean
language sql stable set search_path='' as $$
  select coalesce((select not t.archived and not c.archived and revision_private.content_selected(u,c.book_id,c.id,t.id)
    from public.revision_subtopics t join public.revision_chapters c on c.id=t.chapter_id where t.id=topic),false)
$$;
create or replace function revision_private.chapter_selected(u uuid, chapter text) returns boolean
language sql stable set search_path='' as $$
  select coalesce((select not c.archived and revision_private.content_selected(u,c.book_id,c.id)
    and (not exists(select 1 from public.revision_subtopics where chapter_id=c.id)
      or exists(select 1 from public.revision_subtopics t where t.chapter_id=c.id and revision_private.topic_selected(u,t.id)))
    from public.revision_chapters c where c.id=chapter),false)
$$;
create or replace function revision_private.validate_options(u uuid) returns void
language plpgsql stable set search_path='' as $$
declare g record; chosen integer;
begin
  if exists(select 1 from public.revision_option_selections s join public.revision_options o on o.id=s.option_id
    join public.revision_option_groups grp on grp.id=o.group_id where s.user_id=u and (o.archived or grp.archived or not exists(
      select 1 from public.revision_specification_enrolments e where e.user_id=u and e.specification_id=grp.specification_id))) then
    raise exception 'INVALID_OPTIONS: review your selected subjects and options' using errcode='22023'; end if;
  for g in select gr.* from public.revision_option_groups gr join public.revision_specification_enrolments e
    on e.specification_id=gr.specification_id where e.user_id=u and not gr.archived loop
    select count(*) into chosen from public.revision_option_selections s join public.revision_options o on o.id=s.option_id
      where s.user_id=u and o.group_id=g.id and not o.archived;
    if chosen not between g.min_choices and g.max_choices then
      raise exception 'INVALID_OPTION_COUNT: % requires % to % choices (selected %)',g.title,g.min_choices,g.max_choices,chosen using errcode='22023'; end if;
  end loop;
  if exists(select 1 from public.revision_option_selections s join public.revision_options o on o.id=s.option_id
    where s.user_id=u and o.requires_option_id is not null and not exists(
      select 1 from public.revision_option_selections other where other.user_id=u and other.option_id=o.requires_option_id)) then
    raise exception 'OPTION_PREREQUISITE_REQUIRED: select the prerequisite option too' using errcode='22023'; end if;
end $$;

create or replace function revision_private.save_options(u uuid, specs text[], choices text[]) returns void
language plpgsql set search_path='' as $$
begin
  if coalesce(cardinality(specs),0)=0 then raise exception 'SELECT_SUBJECTS' using errcode='22023'; end if;
  if exists(select 1 from unnest(specs) v where v is null or not exists(select 1 from public.revision_specifications where id=v)) then
    raise exception 'UNKNOWN_SPECIFICATION' using errcode='22023'; end if;
  if exists(select 1 from unnest(choices) v where v is null or not exists(select 1 from public.revision_options where id=v)) then
    raise exception 'UNKNOWN_OPTION' using errcode='22023'; end if;
  if cardinality(choices)<>(select count(distinct v) from unnest(choices) v) then raise exception 'DUPLICATE_OPTION' using errcode='22023'; end if;
  delete from public.revision_specification_enrolments where user_id=u;
  insert into public.revision_specification_enrolments select distinct u,v from unnest(specs) v;
  delete from public.revision_option_selections where user_id=u;
  insert into public.revision_option_selections select u,v from unnest(choices) v;
  perform revision_private.validate_options(u);
  -- Existing enrolments remain the book boundary used throughout the student API.
  insert into public.revision_enrolments(user_id,book_id)
    select u,b.id from public.revision_books b where b.specification_id=any(specs) on conflict do nothing;
  delete from public.revision_enrolments en where en.user_id=u and (
    not exists(select 1 from public.revision_books b where b.id=en.book_id and b.specification_id=any(specs))
    or not revision_private.content_selected(u,en.book_id));
end $$;

create or replace function revision_private.save_legacy_options(u uuid) returns void
language plpgsql set search_path='' as $$
declare specs text[]; choices text[];
begin
  select array_agg(distinct b.specification_id) into specs from public.revision_enrolments en join public.revision_books b on b.id=en.book_id where en.user_id=u;
  select coalesce(array_agg(distinct id),'{}') into choices from (
    select o.id from public.revision_options o join public.revision_option_targets t on t.option_id=o.id
      join public.revision_enrolments en on en.book_id=t.book_id and en.user_id=u
    union select s.option_id from public.revision_option_selections s join public.revision_options o on o.id=s.option_id
      join public.revision_option_groups g on g.id=o.group_id where s.user_id=u and g.specification_id=any(specs)
      and not exists(select 1 from public.revision_option_targets t where t.option_id=o.id and t.book_id is not null)
  ) selected;
  perform revision_private.save_options(u,specs,choices);
end $$;

-- Canonical representations make mappings part of previews, concurrency tokens and audits.
create or replace function revision_private.option_record(kind text, key text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  if kind='option_groups' then select to_jsonb(g) into result from public.revision_option_groups g where id=key;
  elsif kind='options' then
    select to_jsonb(o)||jsonb_build_object(
      'book_ids',(select coalesce(string_agg(book_id,'|' order by book_id),'') from public.revision_option_targets where option_id=key),
      'chapter_ids',(select coalesce(string_agg(chapter_id,'|' order by chapter_id),'') from public.revision_option_targets where option_id=key),
      'topic_codes',(select coalesce(string_agg(subtopic_id,'|' order by subtopic_id),'') from public.revision_option_targets where option_id=key))
    into result from public.revision_options o where id=key;
  end if;
  return result;
end $$;

create or replace function revision_private.admin_option_plan(kind text, rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; old jsonb; n jsonb; result jsonb:='[]'; key text; err text; op text; spec text; g public.revision_option_groups%rowtype;
  ids text[]; books text[]; chapters text[]; topics text[]; seen text[]:='{}'; dependency text; path text[]; line integer:=0;
begin
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 500 or octet_length(rows::text)>2000000 then raise exception 'Expected 1–500 rows, maximum 2 MB'; end if;
  for r in select value from jsonb_array_elements(rows) loop
    line:=line+1;old:=null;n:=null;err:=null;key:=r->>'id';
    begin
      if key is null or key !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then raise exception 'A stable ID is required'; end if;
      if key=any(seen) then raise exception 'Duplicate identifier within this import'; end if;seen:=array_append(seen,key);
      if coalesce(btrim(r->>'title'),'')='' then raise exception 'Title is required'; end if;
      old:=revision_private.option_record(kind,key);
      if kind='option_groups' then
        if not exists(select 1 from public.revision_specifications where id=r->>'specification_id') then raise exception 'Unknown specification_id'; end if;
        if old is not null and old->>'specification_id'<>r->>'specification_id' then raise exception 'Cannot reparent an option group'; end if;
        if nullif(r->>'min_choices','') is null or nullif(r->>'max_choices','') is null or
          (r->>'min_choices')::integer not between 0 and 100 or (r->>'max_choices')::integer not between (r->>'min_choices')::integer and 100 then
          raise exception 'Use 0–100 choices with min_choices <= max_choices'; end if;
        n:=jsonb_build_object('id',key,'specification_id',r->>'specification_id','title',r->>'title',
          'min_choices',(r->>'min_choices')::integer,'max_choices',(r->>'max_choices')::integer,'archived',revision_private.admin_boolean(r->>'archived'));
      else
        select * into g from public.revision_option_groups where id=r->>'group_id';
        if not found then raise exception 'Unknown group_id; import option groups first'; end if;
        if old is not null and old->>'group_id'<>r->>'group_id' then raise exception 'Cannot reparent an option'; end if;
        spec:=g.specification_id;
        select coalesce(array_agg(distinct btrim(v) order by btrim(v)),'{}') into books from unnest(string_to_array(coalesce(r->>'book_ids',''),'|')) v where btrim(v)<>'';
        select coalesce(array_agg(distinct btrim(v) order by btrim(v)),'{}') into chapters from unnest(string_to_array(coalesce(r->>'chapter_ids',''),'|')) v where btrim(v)<>'';
        select coalesce(array_agg(distinct btrim(v) order by btrim(v)),'{}') into topics from unnest(string_to_array(coalesce(r->>'topic_codes',''),'|')) v where btrim(v)<>'';
        if cardinality(books)+cardinality(chapters)+cardinality(topics)=0 then raise exception 'An option must contain a book, chapter or subtopic'; end if;
        if exists(select 1 from unnest(books) v where not exists(select 1 from public.revision_books b where b.id=v and b.specification_id=spec))
          or exists(select 1 from unnest(chapters) v where not exists(select 1 from public.revision_chapters c join public.revision_books b on b.id=c.book_id where c.id=v and b.specification_id=spec))
          or exists(select 1 from unnest(topics) v where not exists(select 1 from public.revision_subtopics t join public.revision_chapters c on c.id=t.chapter_id join public.revision_books b on b.id=c.book_id where t.id=v and b.specification_id=spec)) then
          raise exception 'Every option target must exist in the group specification'; end if;
        dependency:=nullif(r->>'requires_option_id','');
        if dependency is not null and not exists(select 1 from public.revision_options where id=dependency and group_id=g.id) then
          raise exception 'Prerequisite must be an existing option in the same group'; end if;
        path:=array[key];
        while dependency is not null loop
          if dependency=any(path) then raise exception 'Option prerequisites cannot contain a cycle'; end if;
          path:=array_append(path,dependency);
          select case when exists(select 1 from jsonb_array_elements(rows) x where x->>'id'=dependency)
            then (select nullif(x->>'requires_option_id','') from jsonb_array_elements(rows) x where x->>'id'=dependency limit 1)
            else (select requires_option_id from public.revision_options where id=dependency) end into dependency;
        end loop;
        n:=jsonb_build_object('id',key,'group_id',r->>'group_id','title',r->>'title','requires_option_id',nullif(r->>'requires_option_id',''),
          'archived',revision_private.admin_boolean(r->>'archived'),'book_ids',array_to_string(books,'|'),'chapter_ids',array_to_string(chapters,'|'),'topic_codes',array_to_string(topics,'|'));
      end if;
      op:=case when old is null then 'new' when old=n then 'unchanged' else 'update' end;
    exception when others then err:=sqlerrm;op:='invalid';end;
    result:=result||jsonb_build_array(jsonb_build_object('line',coalesce(r->'line',to_jsonb(line+1)),'id',key,'before',old,'after',n,'operation',op,'error',err));
  end loop;
  return jsonb_build_object('rows',result,'token',md5(kind||result::text),'valid',not exists(select 1 from jsonb_array_elements(result) row_data where row_data->>'operation'='invalid'));
end $$;

create or replace function revision_private.admin_option_apply(kind text, change jsonb) returns void
language plpgsql set search_path='' as $$
declare n jsonb:=change->'after'; key text:=change->>'id';
begin
  if kind='option_groups' then
    insert into public.revision_option_groups select * from jsonb_populate_record(null::public.revision_option_groups,n)
      on conflict(id) do update set title=excluded.title,min_choices=excluded.min_choices,max_choices=excluded.max_choices,archived=excluded.archived;
  else
    insert into public.revision_options(id,group_id,title,requires_option_id,archived)
      values(key,n->>'group_id',n->>'title',n->>'requires_option_id',(n->>'archived')::boolean)
      on conflict(id) do update set title=excluded.title,requires_option_id=excluded.requires_option_id,archived=excluded.archived;
    delete from public.revision_option_targets where option_id=key;
    insert into public.revision_option_targets(option_id,book_id) select key,v from unnest(string_to_array(n->>'book_ids','|')) v where v<>'';
    insert into public.revision_option_targets(option_id,chapter_id) select key,v from unnest(string_to_array(n->>'chapter_ids','|')) v where v<>'';
    insert into public.revision_option_targets(option_id,subtopic_id) select key,v from unnest(string_to_array(n->>'topic_codes','|')) v where v<>'';
  end if;
end $$;

-- Existing APIs below retain their names, auth guards, receipts and session contracts.

create or replace function revision_private.candidates(u uuid, sid uuid)
returns table(qid text, qversion integer, seconds integer, chapter text, subject text, priority numeric, diagnostic boolean, fresh boolean, difficulty_gap numeric)
language sql stable set search_path='' as $$
 with evidence as (
   select t.chapter_id, count(distinct a.question_id) as distinct_questions
   from public.revision_attempts a
   join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
   join public.revision_subtopics t on t.id=x.subtopic_id
   where a.user_id=u group by t.chapter_id
 ), eligible as (
   select q.*, min(t.chapter_id) as primary_chapter, min(sp.subject_id) as primary_subject,
     bool_or(coalesce(e.distinct_questions,0)<3) as is_diagnostic,avg(p.alpha/(p.alpha+p.beta)) as ability,
     avg(0.30*(1-p.alpha/(p.alpha+p.beta))
       +0.25*least(1,12*p.alpha*p.beta/((p.alpha+p.beta)^2*(p.alpha+p.beta+1)))
       +0.30*case when p.last_attempt_at is null then 1 else
         least(1, greatest(0,revision_private.today(u)-(p.last_attempt_at at time zone pr.timezone)::date)::numeric /
           greatest(1,p.next_review-(p.last_attempt_at at time zone pr.timezone)::date)) end
       +0.15*coalesce((select least(1,30.0/greatest(1,min(ex.exam_date)-revision_private.today(u)))
         from public.revision_exams ex join public.revision_paper_chapters pc on pc.paper_id=ex.paper_id
         where pc.chapter_id=t.chapter_id and ex.exam_date>=revision_private.today(u)
           and extract(year from ex.exam_date)=pr.exam_year),0)) as score,
     -- Prefer questions adding subtopic coverage during diagnostic assessment.
     count(distinct t.id) filter(where not exists(
       select 1 from public.revision_attempts a join public.revision_question_subtopics z
         on (z.question_id,z.question_version)=(a.question_id,a.question_version)
       where a.user_id=u and z.subtopic_id=t.id)) as new_skills
   from public.revision_questions q
   join public.revision_question_subtopics x on (x.question_id,x.question_version)=(q.id,q.version)
   join public.revision_subtopics t on t.id=x.subtopic_id
   join public.revision_chapters c on c.id=t.chapter_id
   join public.revision_books b on b.id=c.book_id
   join public.revision_specifications sp on sp.id=b.specification_id
   join public.revision_profiles pr on pr.user_id=u
   left join public.revision_enrolments en on en.user_id=u and en.book_id=b.id
   left join public.revision_progress p on p.user_id=u and p.chapter_id=c.id
   left join evidence e on e.chapter_id=c.id
   where q.status='verified'
     and not exists(select 1 from public.revision_attempts a where a.user_id=u and a.question_id=q.id
       and (a.correctness>=2 or a.local_date>=revision_private.today(u)))
     and not exists(select 1 from public.revision_queue k where k.session_id=sid and k.question_id=q.id)
   group by q.id,q.version
   having bool_and(en.user_id is not null and p.confidence is not null and revision_private.topic_selected(u,t.id))
 )
 select e.id,e.version,
   greatest(15,round(coalesce((select avg(a.active_seconds) from public.revision_attempts a
     where a.user_id=u and a.question_id=e.id and a.active_seconds>0),e.estimated_seconds))::integer),
   e.primary_chapter,e.primary_subject,e.score+case when e.is_diagnostic then 1+least(e.new_skills,5)*0.01 else 0 end,
   e.is_diagnostic, not exists(select 1 from public.revision_attempts a where a.user_id=u and a.question_id=e.id),
   abs(e.difficulty-(1+4*e.ability))
 from eligible e
$$;

create or replace function revision_private.snapshot(u uuid, sid uuid default null) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
   'profile',(select to_jsonb(p) from public.revision_profiles p where user_id=u),
   'today',revision_private.today(u),
   'syllabus_check_due',(select last_syllabus_check is null or (last_syllabus_check at time zone timezone)::date<=revision_private.today(u)-7 from public.revision_profiles where user_id=u),
   'subjects',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_subjects t),
   'specifications',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.revision_specifications t),
   'books',(select coalesce(jsonb_agg(to_jsonb(t) order by sort_order),'[]') from public.revision_books t),
   'chapters',(select coalesce(jsonb_agg(to_jsonb(t) order by book_id,number),'[]') from public.revision_chapters t),
   'subtopics',(select coalesce(jsonb_agg(to_jsonb(t) order by chapter_id,page_start),'[]') from public.revision_subtopics t),
   'selected_specifications',(select coalesce(jsonb_agg(specification_id),'[]') from public.revision_specification_enrolments where user_id=u),
   'option_groups',(select coalesce(jsonb_agg(to_jsonb(g) order by id),'[]') from public.revision_option_groups g),
   'options',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.revision_options o),
   'option_targets',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.revision_option_targets t),
   'selected_options',(select coalesce(jsonb_agg(option_id),'[]') from public.revision_option_selections where user_id=u),
   'selected_chapter_ids',(select coalesce(jsonb_agg(id),'[]') from public.revision_chapters where revision_private.chapter_selected(u,id)),
   'selected_subtopic_ids',(select coalesce(jsonb_agg(id),'[]') from public.revision_subtopics where revision_private.topic_selected(u,id)),
   'enrolments',(select coalesce(jsonb_agg(book_id),'[]') from public.revision_enrolments where user_id=u),
   'progress',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
     'proficiency',p.alpha/(p.alpha+p.beta),
     'variance',p.alpha*p.beta/((p.alpha+p.beta)^2*(p.alpha+p.beta+1)),
     'distinct_questions',(select count(distinct a.question_id) from public.revision_attempts a
       join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
       join public.revision_subtopics t on t.id=x.subtopic_id where a.user_id=u and t.chapter_id=p.chapter_id),
     'practice_days',(select count(distinct a.local_date) from public.revision_attempts a
       join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
       join public.revision_subtopics t on t.id=x.subtopic_id where a.user_id=u and t.chapter_id=p.chapter_id),
     'assessed_subtopics',(select count(distinct x.subtopic_id) from public.revision_attempts a
       join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
       join public.revision_subtopics t on t.id=x.subtopic_id where a.user_id=u and t.chapter_id=p.chapter_id and revision_private.topic_selected(u,t.id)),
     'correctness_distribution',(select jsonb_build_array(count(*) filter(where a.correctness=1),count(*) filter(where a.correctness=2),
       count(*) filter(where a.correctness=3),count(*) filter(where a.correctness=4),count(*) filter(where a.correctness=5))
       from public.revision_attempts a where a.user_id=u and exists(select 1 from public.revision_question_subtopics x
       join public.revision_subtopics t on t.id=x.subtopic_id where (x.question_id,x.question_version)=(a.question_id,a.question_version) and t.chapter_id=p.chapter_id)),
     'ease_distribution',(select jsonb_build_array(count(*) filter(where a.ease=1),count(*) filter(where a.ease=2),
       count(*) filter(where a.ease=3),count(*) filter(where a.ease=4),count(*) filter(where a.ease=5))
       from public.revision_attempts a where a.user_id=u and exists(select 1 from public.revision_question_subtopics x
       join public.revision_subtopics t on t.id=x.subtopic_id where (x.question_id,x.question_version)=(a.question_id,a.question_version) and t.chapter_id=p.chapter_id))
     )),'[]') from public.revision_progress p where user_id=u),
   'papers',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.revision_papers p),
   'paper_chapters',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.revision_paper_chapters p),
   'exams',(select coalesce(jsonb_agg(to_jsonb(e) order by exam_date),'[]') from public.revision_exams e
     join public.revision_profiles p on p.user_id=u where extract(year from e.exam_date)=p.exam_year),
   'session',revision_private.session_json(u,coalesce(sid,(select s.id from public.revision_sessions s where user_id=u
     order by exists(select 1 from public.revision_queue k where k.session_id=s.id and k.state='active') desc,
       (status='open') desc,local_date desc limit 1))),
   'today_check_seconds',(select coalesce(sum(check_seconds),0) from public.revision_sessions where user_id=u and local_date=revision_private.today(u)),
   'history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.local_date),'[]') from (
     select local_date,count(*) as questions,sum(active_seconds) as seconds,avg((correctness-1)/4.0) as correctness
     from public.revision_attempts where user_id=u group by local_date order by local_date desc limit 90) a),
   'totals',(select jsonb_build_object('questions',count(*),'seconds',coalesce(sum(active_seconds),0)) from public.revision_attempts where user_id=u),
   'bank_counts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (
     select z.chapter_id,count(*) as questions,sum(z.estimated_seconds) as seconds from (
       select distinct t.chapter_id,q.id,q.estimated_seconds
       from public.revision_questions q join public.revision_question_subtopics x on (x.question_id,x.question_version)=(q.id,q.version)
       join public.revision_subtopics t on t.id=x.subtopic_id where q.status='verified' and not exists(select 1 from public.revision_question_subtopics other where (other.question_id,other.question_version)=(q.id,q.version) and not revision_private.topic_selected(u,other.subtopic_id))) z group by z.chapter_id) a)
 )
$$;

create or replace function public.revision_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); req uuid; receipt revision_private.receipts%rowtype;
  prof public.revision_profiles%rowtype; sess public.revision_sessions%rowtype; item public.revision_queue%rowtype;
  prior public.revision_attempts%rowtype; rec record; chosen_book text; selected text[]; score numeric; weight numeric;
  rating integer; ease_rating integer; duration integer; earned integer; item_id uuid; sid uuid; result jsonb;
  intervals integer[]:=array[1,3,7,14,30,90]; step integer; zone text;
begin
  if u is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_action is null or p_action not in ('bootstrap','settings','confidence','syllabus_check','start','refresh','activate','checkpoint','reveal','complete','finish')
    then raise exception 'UNKNOWN_ACTION' using errcode='22023'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if p_action<>'bootstrap' then
    req:=(p_payload->>'request_id')::uuid;
    if req is null then raise exception 'REQUEST_ID_REQUIRED' using errcode='22023'; end if;
    select * into receipt from revision_private.receipts where user_id=u and request_id=req;
    if found then
      if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
      return receipt.result;
    end if;
  end if;
  zone:=coalesce(p_payload->>'timezone','UTC');
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'INVALID_TIMEZONE' using errcode='22023'; end if;
  insert into public.revision_profiles(user_id,timezone) values(u,zone) on conflict(user_id) do nothing;
  select * into prof from public.revision_profiles where user_id=u;

  if p_action='bootstrap' and p_payload->>'session_id' is not null then
    sid:=(p_payload->>'session_id')::uuid;
    if not exists(select 1 from public.revision_sessions where id=sid and user_id=u) then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  end if;

  if p_action='settings' then
    if p_payload ? 'daily_minutes' and ((p_payload->>'daily_minutes')::integer not between 5 and 480 or p_payload->>'daily_minutes' is null)
      then raise exception 'INVALID_DAILY_MINUTES' using errcode='22023'; end if;
    if p_payload ? 'exam_year' and ((p_payload->>'exam_year')::integer not between 2020 and 2100 or p_payload->>'exam_year' is null)
      then raise exception 'INVALID_EXAM_YEAR' using errcode='22023'; end if;
    if p_payload ? 'specifications' or p_payload ? 'option_ids' then
      if p_payload ? 'specifications' and jsonb_typeof(p_payload->'specifications') is distinct from 'array' then raise exception 'INVALID_SPECIFICATIONS' using errcode='22023'; end if;
      if p_payload ? 'option_ids' and jsonb_typeof(p_payload->'option_ids') is distinct from 'array' then raise exception 'INVALID_OPTIONS' using errcode='22023'; end if;
      perform revision_private.save_options(u,
        case when p_payload ? 'specifications' then array(select jsonb_array_elements_text(p_payload->'specifications')) else array(select specification_id from public.revision_specification_enrolments where user_id=u) end,
        case when p_payload ? 'option_ids' then array(select jsonb_array_elements_text(p_payload->'option_ids')) else array(select option_id from public.revision_option_selections where user_id=u) end);
    elsif p_payload ? 'books' then
      if jsonb_typeof(p_payload->'books')<>'array' or jsonb_array_length(p_payload->'books')=0 then
        raise exception 'SELECT_SUBJECTS' using errcode='22023'; end if;
      select array_agg(value) into selected from jsonb_array_elements_text(p_payload->'books');
      if exists(select 1 from unnest(selected) v where not exists(select 1 from public.revision_books where id=v))
        then raise exception 'UNKNOWN_BOOK' using errcode='22023'; end if;
      -- A chosen specification always includes its core books.
      insert into public.revision_enrolments(user_id,book_id)
        select u,b.id from public.revision_books b where b.id=any(selected) or (b.required and b.specification_id in
          (select specification_id from public.revision_books where id=any(selected))) on conflict do nothing;
      delete from public.revision_enrolments en where en.user_id=u and not exists(
        select 1 from public.revision_books b where b.id=en.book_id and (b.id=any(selected) or (b.required and b.specification_id in
          (select specification_id from public.revision_books where id=any(selected)))));
      -- Pearson routes: two different level-1 options OR a matching level-1/level-2 pair.
      if exists(select 1 from public.revision_enrolments en join public.revision_books b on b.id=en.book_id
        where en.user_id=u and b.specification_id='edexcel-9fm0') then
        select count(*) as n,count(*) filter(where option_level=1) as ones,count(distinct option_family) as families into rec
          from public.revision_enrolments en join public.revision_books b on b.id=en.book_id
          where en.user_id=u and b.specification_id='edexcel-9fm0' and not b.required;
        if rec.n<>2 or not (rec.ones=2 or (rec.ones=1 and rec.families=1)) then
          raise exception 'INVALID_FURTHER_OPTIONS' using errcode='22023'; end if;
      end if;
      perform revision_private.save_legacy_options(u);
    end if;
    update public.revision_profiles set daily_minutes=coalesce((p_payload->>'daily_minutes')::integer,daily_minutes),
      timezone=case when p_payload ? 'timezone' then zone else timezone end,
      exam_year=coalesce((p_payload->>'exam_year')::integer,exam_year),onboarded=true where user_id=u;
    update public.revision_sessions set target_seconds=(select daily_minutes*60 from public.revision_profiles where user_id=u),version=version+1
      where user_id=u and status='open';
    for sid in select id from public.revision_sessions where user_id=u and status='open' loop
      perform revision_private.build_queue(u,sid);
    end loop;
  elsif p_action='confidence' then
    if jsonb_typeof(p_payload->'ratings') is distinct from 'array' then raise exception 'RATINGS_REQUIRED' using errcode='22023'; end if;
    for rec in select value from jsonb_array_elements(p_payload->'ratings') loop
      rating:=(rec.value->>'confidence')::integer;
      if rating is not null and rating not between 1 and 5 then raise exception 'INVALID_CONFIDENCE' using errcode='22023'; end if;
      if not exists(select 1 from public.revision_chapters c join public.revision_enrolments en on en.book_id=c.book_id
        where c.id=rec.value->>'chapter_id' and en.user_id=u and revision_private.chapter_selected(u,c.id)) then raise exception 'CHAPTER_NOT_SELECTED' using errcode='22023'; end if;
      insert into public.revision_progress(user_id,chapter_id,confidence,alpha,beta,prior_alpha,prior_beta)
        values(u,rec.value->>'chapter_id',rating,coalesce((rating-0.5)/5.0*2,1),coalesce((1-(rating-0.5)/5.0)*2,1),
          coalesce((rating-0.5)/5.0*2,1),coalesce((1-(rating-0.5)/5.0)*2,1))
      on conflict(user_id,chapter_id) do update set confidence=excluded.confidence,
        alpha=case when public.revision_progress.attempts=0 then excluded.alpha else public.revision_progress.alpha end,
        beta=case when public.revision_progress.attempts=0 then excluded.beta else public.revision_progress.beta end,
        prior_alpha=case when public.revision_progress.attempts=0 then excluded.prior_alpha else public.revision_progress.prior_alpha end,
        prior_beta=case when public.revision_progress.attempts=0 then excluded.prior_beta else public.revision_progress.prior_beta end;
    end loop;
    for sid in select id from public.revision_sessions where user_id=u and status='open' loop
      update public.revision_sessions set version=version+1 where id=sid;
      perform revision_private.build_queue(u,sid);
    end loop;
  elsif p_action='syllabus_check' then
    duration:=(p_payload->>'active_seconds')::integer;
    if duration is null or duration not between 0 and 1800 then raise exception 'INVALID_DURATION' using errcode='22023'; end if;
    if prof.last_syllabus_check is not null and (prof.last_syllabus_check at time zone prof.timezone)::date>revision_private.today(u)-7 then
      raise exception 'CHECK_NOT_DUE' using errcode='22023'; end if;
    insert into public.revision_sessions(user_id,local_date,target_seconds)
      values(u,revision_private.today(u),prof.daily_minutes*60) on conflict(user_id,local_date) do nothing;
    update public.revision_sessions set check_seconds=least(1800,check_seconds+duration),version=version+1
      where user_id=u and local_date=revision_private.today(u) returning id into sid;
    update public.revision_profiles set last_syllabus_check=now() where user_id=u;
    perform revision_private.build_queue(u,sid);
  elsif p_action='start' then
    perform revision_private.validate_options(u);
    if not prof.onboarded then raise exception 'ONBOARDING_REQUIRED' using errcode='22023'; end if;
    select s.* into sess from public.revision_sessions s where user_id=u and exists(
      select 1 from public.revision_queue k where k.session_id=s.id and k.state='active') order by local_date desc limit 1;
    if not found then
      update public.revision_sessions set status='finished',version=version+1 where user_id=u and local_date<revision_private.today(u) and status='open';
      insert into public.revision_sessions(user_id,local_date,target_seconds) values(u,revision_private.today(u),prof.daily_minutes*60)
        on conflict(user_id,local_date) do update set status='open',target_seconds=excluded.target_seconds,
          version=public.revision_sessions.version+1 returning * into sess;
    end if;
    sid:=sess.id;
    perform revision_private.build_queue(u,sid,coalesce((p_payload->>'continue')::boolean,false));
    update public.revision_sessions set version=version+1 where id=sid;
  elsif p_action in ('refresh','activate','checkpoint','reveal','complete','finish') then
    sid:=(p_payload->>'session_id')::uuid;
    select * into sess from public.revision_sessions where id=sid and user_id=u for update;
    if not found then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
    if p_payload->>'expected_version' is null or sess.version<>(p_payload->>'expected_version')::integer then
      raise exception 'SESSION_CONFLICT' using errcode='40001'; end if;
    if sess.status<>'open' then raise exception 'SESSION_FINISHED' using errcode='22023'; end if;
    if p_action in ('activate','checkpoint','reveal','complete') then
      item_id:=(p_payload->>'item_id')::uuid;
      select * into item from public.revision_queue where id=item_id and session_id=sid;
      if not found then raise exception 'ITEM_NOT_FOUND' using errcode='42501'; end if;
      if p_action='activate' then
        perform revision_private.validate_options(u);
        if item.state<>'queued' then raise exception 'ITEM_NOT_QUEUED' using errcode='22023'; end if;
        if exists(select 1 from public.revision_queue where session_id=sid and state='active') then raise exception 'QUESTION_IN_PROGRESS' using errcode='22023'; end if;
        -- Revalidate content and coverage in case settings or bank status changed since planning.
        if not exists(select 1 from public.revision_questions where id=item.question_id and version=item.question_version and status='verified')
          or exists(select 1 from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
            join public.revision_chapters c on c.id=t.chapter_id
            left join public.revision_enrolments en on en.user_id=u and en.book_id=c.book_id
            left join public.revision_progress p on p.user_id=u and p.chapter_id=c.id
            where (x.question_id,x.question_version)=(item.question_id,item.question_version) and (en.user_id is null or p.confidence is null or not revision_private.topic_selected(u,t.id)))
          then raise exception 'QUESTION_NO_LONGER_ELIGIBLE' using errcode='22023'; end if;
        update public.revision_queue set state='active' where id=item_id;
      else
        if item.state<>'active' then raise exception 'ITEM_NOT_ACTIVE' using errcode='22023'; end if;
        duration:=(p_payload->>'active_seconds')::integer;
        if duration is null or duration not between item.active_seconds and 86400 then raise exception 'INVALID_DURATION' using errcode='22023'; end if;
        ease_rating:=coalesce((p_payload->>'ease')::integer,item.ease);
        if ease_rating is not null and ease_rating not between 1 and 5 then raise exception 'INVALID_EASE' using errcode='22023'; end if;
        if item.revealed_at is not null and ease_rating is distinct from item.ease then raise exception 'EASE_LOCKED' using errcode='22023'; end if;
        if (p_payload->>'draft_correctness' is not null or p_payload->>'draft_marks' is not null) and item.revealed_at is null then
          raise exception 'REVEAL_REQUIRED' using errcode='22023'; end if;
        if p_payload->>'draft_marks' is not null and not exists(select 1 from public.revision_questions q
          where (q.id,q.version)=(item.question_id,item.question_version) and (p_payload->>'draft_marks')::integer between 0 and q.total_marks) then
          raise exception 'INVALID_MARKS' using errcode='22023'; end if;
        update public.revision_queue set active_seconds=duration,ease=ease_rating,
          paused=coalesce((p_payload->>'paused')::boolean,paused),
          draft_correctness=case when p_payload ? 'draft_correctness' then (p_payload->>'draft_correctness')::integer else draft_correctness end,
          draft_marks=case when p_payload ? 'draft_marks' then (p_payload->>'draft_marks')::integer else draft_marks end where id=item_id;
        if p_action='reveal' then
          if ease_rating is null then raise exception 'EASE_REQUIRED' using errcode='22023'; end if;
          update public.revision_queue set revealed_at=coalesce(revealed_at,now()) where id=item_id;
        elsif p_action='complete' then
          if item.revealed_at is null then raise exception 'REVEAL_REQUIRED' using errcode='22023'; end if;
          rating:=(p_payload->>'correctness')::integer; earned:=(p_payload->>'earned_marks')::integer;
          if rating is null or rating not between 1 and 5 then raise exception 'INVALID_CORRECTNESS' using errcode='22023'; end if;
          insert into public.revision_attempts(user_id,queue_id,session_id,question_id,question_version,ease,correctness,
            active_seconds,earned_marks,total_marks,local_date,idempotency_key)
            select u,item_id,sid,item.question_id,item.question_version,ease_rating,rating,duration,earned,q.total_marks,revision_private.today(u),req
            from public.revision_questions q where (q.id,q.version)=(item.question_id,item.question_version);
          score:=(rating-1)/4.0;
          select 1.0/count(distinct t.chapter_id) into weight from public.revision_question_subtopics x
            join public.revision_subtopics t on t.id=x.subtopic_id where (x.question_id,x.question_version)=(item.question_id,item.question_version);
          for rec in select distinct t.chapter_id from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
            where (x.question_id,x.question_version)=(item.question_id,item.question_version) loop
            select case when rating<=2 then 0 when attempts>0 and rating>=4 and ease_rating>=4
                and (last_attempt_at at time zone prof.timezone)::date<revision_private.today(u)
                then least(5,review_step+1) else review_step end
              into step from public.revision_progress where user_id=u and chapter_id=rec.chapter_id;
            update public.revision_progress set alpha=alpha+score*weight,beta=beta+(1-score)*weight,
              attempts=attempts+1,review_step=step,next_review=revision_private.today(u)+intervals[step+1],last_attempt_at=now()
              where user_id=u and chapter_id=rec.chapter_id;
          end loop;
          update public.revision_queue set state='completed',paused=true where id=item_id;
          perform revision_private.build_queue(u,sid);
        end if;
      end if;
    elsif p_action='refresh' then perform revision_private.validate_options(u);perform revision_private.build_queue(u,sid,coalesce((p_payload->>'continue')::boolean,false));
    elsif p_action='finish' then
      if exists(select 1 from public.revision_queue where session_id=sid and state='active') then raise exception 'QUESTION_IN_PROGRESS' using errcode='22023'; end if;
      update public.revision_sessions set status='finished' where id=sid;
      delete from public.revision_queue where session_id=sid and state='queued';
    end if;
    update public.revision_sessions set version=version+1 where id=sid;
  end if;
  if p_action in ('start','refresh','activate','checkpoint','reveal','finish') then
    result:=jsonb_build_object('session',revision_private.session_json(u,sid));
  else
    result:=revision_private.snapshot(u,sid);
  end if;
  if req is not null then insert into revision_private.receipts(user_id,request_id,action,payload,result) values(u,req,p_action,p_payload,result); end if;
  return result;
end $$;

create or replace function revision_private.admin_record(kind text, key text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  if kind in ('option_groups','options') then return revision_private.option_record(kind,key); end if;
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

create or replace function revision_private.admin_plan(kind text, rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; n jsonb; old jsonb; effects jsonb; result jsonb:='[]'; seen text[]:='{}'; natural_seen text[]:='{}';
  key text; natural_key text; op text; tags text[]; required text[]; col text; err text; line integer:=0;
  year integer; matches integer; resolved text; seconds numeric; assets jsonb;
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
      'papers',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_papers t),
      'option_groups',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.revision_option_groups t),
      'options',(select coalesce(jsonb_agg(revision_private.option_record('options',t.id) order by t.id),'[]') from public.revision_options t));
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
    elsif kind in ('exams','subjects','specifications','books','chapters','topics','papers','option_groups','options') then
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
    return jsonb_build_object('selected_options',(select coalesce(jsonb_agg(option_id),'[]') from public.revision_option_selections where user_id=(p_payload->>'id')::uuid),
      'selected_specifications',(select coalesce(jsonb_agg(specification_id),'[]') from public.revision_specification_enrolments where user_id=(p_payload->>'id')::uuid),
      'selected_chapter_ids',(select coalesce(jsonb_agg(id),'[]') from public.revision_chapters where revision_private.chapter_selected((p_payload->>'id')::uuid,id)),
      'profile',(select to_jsonb(p) from public.revision_profiles p where user_id=(p_payload->>'id')::uuid),
      'enrolments',(select coalesce(jsonb_agg(book_id),'[]') from public.revision_enrolments where user_id=(p_payload->>'id')::uuid),
      'progress',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('proficiency',alpha/(alpha+beta),'variance',alpha*beta/((alpha+beta)^2*(alpha+beta+1)))),'[]') from public.revision_progress p where user_id=(p_payload->>'id')::uuid),
      'activity',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select question_id,question_version,correctness,ease,active_seconds,completed_at from public.revision_attempts where user_id=(p_payload->>'id')::uuid order by completed_at desc limit 30) a));
  end if;
  raise exception 'Unknown admin action or type';
end $$;
revoke all on function public.revision_admin_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.revision_admin_api(text,jsonb) to authenticated;

revoke all on all functions in schema revision_private from public,anon,authenticated;
commit;
