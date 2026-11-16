-- Apply after 11-question-coverage.sql. Scheduler performance only: no table or data changes,
-- same API contract and the same question choices. Rerunnable.
--
-- 1. build_queue scores the candidate pool once per rebuild (was once per queue slot, up to 40x).
-- 2. candidates starts from the student's rated chapters, evaluates syllabus options once per
--    subtopic (not once per question-subtopic row) and scores each chapter once.
-- 3. snapshot evaluates syllabus options once per subtopic for bank counts and selections.
-- 4. Indexes for option-target and paper-chapter lookups by content.
begin;

create index if not exists revision_option_target_books on public.revision_option_targets(book_id) where book_id is not null;
create index if not exists revision_option_target_chapters on public.revision_option_targets(chapter_id) where chapter_id is not null;
create index if not exists revision_option_target_topics on public.revision_option_targets(subtopic_id) where subtopic_id is not null;
create index if not exists revision_paper_chapter_lookup on public.revision_paper_chapters(chapter_id);

create or replace function revision_private.candidates(u uuid, sid uuid)
returns table(qid text, qversion integer, seconds integer, chapter text, subject text, priority numeric, diagnostic boolean, fresh boolean, difficulty_gap numeric)
language sql stable set search_path='' as $$
 with d as materialized (
   select revision_private.today(u) as today, pr.timezone, pr.exam_year from public.revision_profiles pr where pr.user_id=u
 ), ok_topics as materialized (
   -- Subtopics the student can be scheduled on: enrolled book, rated chapter, selected by options.
   select t.id, t.chapter_id, sp.subject_id
   from public.revision_progress p
   join public.revision_chapters c on c.id=p.chapter_id
   join public.revision_enrolments en on en.user_id=u and en.book_id=c.book_id
   join public.revision_books b on b.id=c.book_id
   join public.revision_specifications sp on sp.id=b.specification_id
   join public.revision_subtopics t on t.chapter_id=c.id
   where p.user_id=u and p.confidence is not null and revision_private.topic_selected(u,t.id)
 ), chapter_score as materialized (
   -- Every scoring term depends only on the chapter, so compute it once per chapter.
   select p.chapter_id, p.alpha/(p.alpha+p.beta) as ability,
     0.30*(1-p.alpha/(p.alpha+p.beta))
       +0.25*least(1,12*p.alpha*p.beta/((p.alpha+p.beta)^2*(p.alpha+p.beta+1)))
       +0.30*case when p.last_attempt_at is null then 1 else
         least(1, greatest(0,d.today-(p.last_attempt_at at time zone d.timezone)::date)::numeric /
           greatest(1,p.next_review-(p.last_attempt_at at time zone d.timezone)::date)) end
       +0.15*coalesce((select least(1,30.0/greatest(1,min(ex.exam_date)-d.today))
         from public.revision_exams ex join public.revision_paper_chapters pc on pc.paper_id=ex.paper_id
         where pc.chapter_id=p.chapter_id and ex.exam_date>=d.today
           and extract(year from ex.exam_date)=d.exam_year),0) as score
   from public.revision_progress p cross join d
   where p.user_id=u and p.confidence is not null
 ), user_attempts as materialized (
   select a.question_id, a.question_version, a.correctness, a.local_date, a.active_seconds
   from public.revision_attempts a where a.user_id=u
 ), evidence as materialized (
   select t.chapter_id, count(distinct a.question_id) as distinct_questions
   from user_attempts a
   join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
   join public.revision_subtopics t on t.id=x.subtopic_id
   group by t.chapter_id
 ), attempted_topics as materialized (
   select distinct x.subtopic_id
   from user_attempts a
   join public.revision_question_subtopics x on (x.question_id,x.question_version)=(a.question_id,a.question_version)
 ), attempt_stats as materialized (
   select a.question_id, avg(a.active_seconds) filter(where a.active_seconds>0) as avg_seconds,
     bool_or(a.correctness>=2 or a.local_date>=(select today from d)) as retired
   from user_attempts a group by a.question_id
 ), pool as materialized (
   -- Only questions touching at least one schedulable subtopic (uses the subtopic index).
   select distinct x.question_id, x.question_version
   from ok_topics o join public.revision_question_subtopics x on x.subtopic_id=o.id
 ), eligible as (
   select q.id, q.version, q.difficulty, q.estimated_seconds,
     min(o.chapter_id) as primary_chapter, min(o.subject_id) as primary_subject,
     bool_or(coalesce(e.distinct_questions,0)<3) as is_diagnostic,
     avg(cs.ability) as ability, avg(cs.score) as score,
     -- Prefer questions adding subtopic coverage during diagnostic assessment.
     count(distinct x.subtopic_id) filter(where seen.subtopic_id is null) as new_skills
   from pool
   join public.revision_questions q on (q.id,q.version)=(pool.question_id,pool.question_version) and q.status='verified'
   join public.revision_question_subtopics x on (x.question_id,x.question_version)=(q.id,q.version)
   left join ok_topics o on o.id=x.subtopic_id
   left join chapter_score cs on cs.chapter_id=o.chapter_id
   left join evidence e on e.chapter_id=o.chapter_id
   left join attempted_topics seen on seen.subtopic_id=x.subtopic_id
   where not exists(select 1 from attempt_stats s where s.question_id=q.id and s.retired)
     and not exists(select 1 from public.revision_queue k where k.session_id=sid and k.question_id=q.id)
   group by q.id,q.version,q.difficulty,q.estimated_seconds
   -- Every tagged subtopic must be schedulable.
   having bool_and(o.id is not null)
 )
 select e.id,e.version,
   greatest(15,round(coalesce(s.avg_seconds,e.estimated_seconds))::integer),
   e.primary_chapter,e.primary_subject,e.score+case when e.is_diagnostic then 1+least(e.new_skills,5)*0.01 else 0 end,
   e.is_diagnostic, s.question_id is null,
   abs(e.difficulty-(1+4*e.ability))
 from eligible e left join attempt_stats s on s.question_id=e.id
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
  if budget is null or budget<=0 then return; end if;
  select coalesce(max(position),0) into pos from public.revision_queue where session_id=sid;
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
  -- Nothing the loop does changes a candidate's score, so score the pool once and pick from it.
  drop table if exists pg_temp.revision_candidates;
  create temporary table revision_candidates on commit drop as select * from revision_private.candidates(u,sid);
  while budget>0 and loops<40 loop
    select * into chosen from pg_temp.revision_candidates a
      order by
        (a.seconds<=budget) desc,
        case when a.seconds>budget then a.seconds end,
        -- Relax diversity only if no alternative can fill this slot.
        (case when last_ch=prev_ch and a.chapter=last_ch then 1 else 0 end
         +case when last_su=prev_su and a.subject=last_su then 1 else 0 end),
        a.fresh desc, a.priority desc, a.difficulty_gap, a.seconds, a.qid
      limit 1;
    exit when not found;
    delete from pg_temp.revision_candidates where qid=chosen.qid;
    pos:=pos+1; loops:=loops+1;
    insert into public.revision_queue(session_id,position,question_id,question_version,estimated_seconds,reason)
      values(sid,pos,chosen.qid,chosen.qversion,chosen.seconds,
        case when chosen.diagnostic then 'Initial assessment · new skills first' else 'Weakness, uncertainty, retention and exam priority' end);
    budget:=budget-chosen.seconds;
    prev_ch:=last_ch; prev_su:=last_su; last_ch:=chosen.chapter; last_su:=chosen.subject;
  end loop;
  drop table if exists pg_temp.revision_candidates;
end $$;

create or replace function revision_private.snapshot(u uuid, sid uuid default null) returns jsonb
language sql stable set search_path='' as $$
 with sel as materialized (
   select t.id from public.revision_subtopics t where revision_private.topic_selected(u,t.id)
 )
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
   -- Same rule as revision_private.chapter_selected, reusing the selected subtopic set.
   'selected_chapter_ids',(select coalesce(jsonb_agg(c.id),'[]') from public.revision_chapters c
     where not c.archived and revision_private.content_selected(u,c.book_id,c.id)
       and (not exists(select 1 from public.revision_subtopics t where t.chapter_id=c.id)
         or exists(select 1 from public.revision_subtopics t join sel on sel.id=t.id where t.chapter_id=c.id))),
   'selected_subtopic_ids',(select coalesce(jsonb_agg(t.id),'[]') from public.revision_subtopics t where t.id in (select id from sel)),
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
       join public.revision_subtopics t on t.id=x.subtopic_id where a.user_id=u and t.chapter_id=p.chapter_id and t.id in (select id from sel)),
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
   -- A question counts only when every tagged subtopic is selected; start from selected subtopics.
   'bank_counts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (
     select z.chapter_id,count(*) as questions,sum(z.estimated_seconds) as seconds from (
       select distinct t.chapter_id,q.id,q.estimated_seconds
       from sel join public.revision_question_subtopics x on x.subtopic_id=sel.id
       join public.revision_subtopics t on t.id=x.subtopic_id
       join public.revision_questions q on (q.id,q.version)=(x.question_id,x.question_version)
       where q.status='verified' and not exists(select 1 from public.revision_question_subtopics other
         where (other.question_id,other.question_version)=(q.id,q.version)
           and not exists(select 1 from sel s2 where s2.id=other.subtopic_id))) z group by z.chapter_id) a)
 )
$$;

revoke all on all functions in schema revision_private from public,anon,authenticated;
commit;
