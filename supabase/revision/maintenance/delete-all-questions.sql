-- ONE-OFF MAINTENANCE: run the complete file in Supabase SQL Editor as owner.
-- This is NOT an installation migration. It permanently deletes every question
-- ID/version, worked solution, question-topic link and queued/active question.
-- It also deletes question-import history and cached student RPC responses,
-- which contain copies of question content and obsolete replay results.
-- Accounts, roles, syllabus, exams, settings, selections and confidence remain.
-- Close revision/admin tabs before running, then reopen them afterwards.
-- If attempts exist, the default below aborts and rolls back every change.

begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(61934618); -- Same lock as admin imports.

-- Prevent new imports, attempts or cached responses during this transaction.
-- Explicit tables and ordered deletes avoid an unbounded TRUNCATE CASCADE.
lock table public.revision_questions, revision_private.solutions,
  public.revision_question_subtopics, public.revision_queue,
  public.revision_attempts, public.revision_sessions, public.revision_progress,
  revision_private.receipts, revision_private.admin_imports
  in access exclusive mode;

do $delete_questions$
declare
  -- Set true ONLY if you also want to erase all recorded question attempts.
  -- Their affected chapter proficiency/review schedule is then reset to the
  -- stored prior, while self-reported confidence and the prior itself remain.
  delete_attempt_history boolean := false;
  question_count bigint;
  version_count bigint;
  attempt_count bigint;
  reset_count bigint := 0;
  affected_sessions uuid[];
begin
  select count(distinct id),count(*) into question_count,version_count
    from public.revision_questions;
  select count(*) into attempt_count from public.revision_attempts;
  if attempt_count > 0 and not delete_attempt_history then
    raise exception 'Deletion stopped: % student attempt(s) reference these questions. Nothing was deleted. To erase attempts too, set delete_attempt_history := true in this file.',attempt_count;
  end if;

  select coalesce(array_agg(distinct session_id),'{}'::uuid[])
    into affected_sessions from public.revision_queue;

  if delete_attempt_history then
    update public.revision_progress p set
      alpha=p.prior_alpha,beta=p.prior_beta,attempts=0,review_step=0,
      next_review=null,last_attempt_at=null
    where exists (
      select 1 from public.revision_attempts a
      join public.revision_question_subtopics x
        on (x.question_id,x.question_version)=(a.question_id,a.question_version)
      join public.revision_subtopics t on t.id=x.subtopic_id
      where a.user_id=p.user_id and t.chapter_id=p.chapter_id
    );
    get diagnostics reset_count = row_count;
  end if;

  delete from public.revision_attempts;
  delete from public.revision_queue;
  delete from revision_private.solutions;
  delete from public.revision_question_subtopics;
  delete from public.revision_questions;

  -- Keep session settings and syllabus-check time; invalidate old item versions.
  update public.revision_sessions set version=version+1
    where id=any(affected_sessions);

  -- Even receipts for finished/empty sessions can retain old question content.
  delete from revision_private.receipts;
  -- Remove content copies AND import replay records so deleted IDs can be reused.
  delete from revision_private.admin_imports where import_type='questions';

  raise notice 'Deleted % questions (% versions), % attempts; reset % chapter progress records.',
    question_count,version_count,attempt_count,reset_count;
end $delete_questions$;

-- Every remaining count below should be zero.
select 'question_versions' as entity,count(*) as remaining from public.revision_questions
union all select 'solutions',count(*) from revision_private.solutions
union all select 'question_topic_links',count(*) from public.revision_question_subtopics
union all select 'queue_items',count(*) from public.revision_queue
union all select 'attempts',count(*) from public.revision_attempts
union all select 'cached_responses',count(*) from revision_private.receipts
union all select 'question_imports',count(*) from revision_private.admin_imports where import_type='questions';

commit;
