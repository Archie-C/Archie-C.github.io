begin;

create or replace function revision_private.today(u uuid) returns date
language sql stable set search_path='' as $$
  select (now() at time zone p.timezone)::date from public.revision_profiles p where user_id=u
$$;

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
   having bool_and(en.user_id is not null and p.confidence is not null)
 )
 select e.id,e.version,
   greatest(15,round(coalesce((select avg(a.active_seconds) from public.revision_attempts a
     where a.user_id=u and a.question_id=e.id and a.active_seconds>0),e.estimated_seconds))::integer),
   e.primary_chapter,e.primary_subject,e.score+case when e.is_diagnostic then 1+least(e.new_skills,5)*0.01 else 0 end,
   e.is_diagnostic, not exists(select 1 from public.revision_attempts a where a.user_id=u and a.question_id=e.id),
   abs(e.difficulty-(1+4*e.ability))
 from eligible e
$$;

create or replace function revision_private.build_queue(u uuid, sid uuid, extra boolean default false) returns void
language plpgsql set search_path='' as $$
declare budget integer; pos integer; chosen record; last_ch text; prev_ch text; last_su text; prev_su text; loops integer:=0;
begin
  delete from public.revision_queue where session_id=sid and state='queued';
  select s.target_seconds-s.check_seconds-coalesce(sum(k.active_seconds),0) into budget
    from public.revision_sessions s left join public.revision_queue k on k.session_id=s.id
    where s.id=sid group by s.id;
  if extra and budget<=0 then budget:=900; end if;
  -- Account for the current question before planning what comes after it.
  select budget-coalesce(sum(greatest(0,estimated_seconds-active_seconds)),0) into budget
    from public.revision_queue where session_id=sid and state='active';
  select coalesce(max(position),0) into pos from public.revision_queue where session_id=sid;
  while budget>0 and loops<40 loop
    select min(t.chapter_id),min(sp.subject_id) into last_ch,last_su
      from public.revision_queue k join public.revision_question_subtopics x
        on (x.question_id,x.question_version)=(k.question_id,k.question_version)
      join public.revision_subtopics t on t.id=x.subtopic_id
      join public.revision_chapters c on c.id=t.chapter_id join public.revision_books b on b.id=c.book_id
      join public.revision_specifications sp on sp.id=b.specification_id
      where k.session_id=sid and k.position=pos;
    select min(t.chapter_id),min(sp.subject_id) into prev_ch,prev_su
      from public.revision_queue k join public.revision_question_subtopics x
        on (x.question_id,x.question_version)=(k.question_id,k.question_version)
      join public.revision_subtopics t on t.id=x.subtopic_id
      join public.revision_chapters c on c.id=t.chapter_id join public.revision_books b on b.id=c.book_id
      join public.revision_specifications sp on sp.id=b.specification_id
      where k.session_id=sid and k.position=pos-1;
    select * into chosen from revision_private.candidates(u,sid) a
      order by
        (a.seconds<=budget) desc,
        case when a.seconds>budget then a.seconds end,
        -- Relax diversity only if no alternative can fill this slot.
        (case when last_ch=prev_ch and a.chapter=last_ch then 1 else 0 end
         +case when last_su=prev_su and a.subject=last_su then 1 else 0 end),
        a.fresh desc, a.priority desc, a.difficulty_gap, a.seconds, a.qid;
    exit when not found;
    pos:=pos+1; loops:=loops+1;
    insert into public.revision_queue(session_id,position,question_id,question_version,estimated_seconds,reason)
      values(sid,pos,chosen.qid,chosen.qversion,chosen.seconds,
        case when chosen.diagnostic then 'Initial assessment · new skills first' else 'Weakness, uncertainty, retention and exam priority' end);
    budget:=budget-chosen.seconds;
  end loop;
end $$;

create or replace function revision_private.session_json(u uuid, sid uuid) returns jsonb
language sql stable set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('items',coalesce((
   select jsonb_agg(to_jsonb(k)||jsonb_build_object(
     'prompt_md',q.prompt_md,'difficulty',q.difficulty,'total_marks',q.total_marks,'assets',q.assets,
     'solution_md',case when k.revealed_at is not null then sol.solution_md else null end,
     'chapter_ids',(select jsonb_agg(distinct t.chapter_id) from public.revision_question_subtopics x
       join public.revision_subtopics t on t.id=x.subtopic_id
       where (x.question_id,x.question_version)=(q.id,q.version))) order by k.position)
   from public.revision_queue k join public.revision_questions q on (q.id,q.version)=(k.question_id,k.question_version)
   join revision_private.solutions sol on (sol.question_id,sol.question_version)=(q.id,q.version)
   where k.session_id=s.id),'[]'::jsonb))
 from public.revision_sessions s where s.id=sid and s.user_id=u
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
       join public.revision_subtopics t on t.id=x.subtopic_id where a.user_id=u and t.chapter_id=p.chapter_id),
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
       join public.revision_subtopics t on t.id=x.subtopic_id where q.status='verified') z group by z.chapter_id) a)
 )
$$;

-- One authenticated endpoint. Helpers live in an unexposed schema.
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
    if p_payload ? 'books' then
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
        where c.id=rec.value->>'chapter_id' and en.user_id=u) then raise exception 'CHAPTER_NOT_SELECTED' using errcode='22023'; end if;
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
        if item.state<>'queued' then raise exception 'ITEM_NOT_QUEUED' using errcode='22023'; end if;
        if exists(select 1 from public.revision_queue where session_id=sid and state='active') then raise exception 'QUESTION_IN_PROGRESS' using errcode='22023'; end if;
        -- Revalidate content and coverage in case settings or bank status changed since planning.
        if not exists(select 1 from public.revision_questions where id=item.question_id and version=item.question_version and status='verified')
          or exists(select 1 from public.revision_question_subtopics x join public.revision_subtopics t on t.id=x.subtopic_id
            join public.revision_chapters c on c.id=t.chapter_id
            left join public.revision_enrolments en on en.user_id=u and en.book_id=c.book_id
            left join public.revision_progress p on p.user_id=u and p.chapter_id=c.id
            where (x.question_id,x.question_version)=(item.question_id,item.question_version) and (en.user_id is null or p.confidence is null))
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
    elsif p_action='refresh' then perform revision_private.build_queue(u,sid,coalesce((p_payload->>'continue')::boolean,false));
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

revoke all on all functions in schema revision_private from public,anon,authenticated;
revoke all on function public.revision_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.revision_api(text,jsonb) to authenticated;
commit;
