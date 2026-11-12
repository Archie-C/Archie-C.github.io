-- Run in the Supabase SQL Editor, as project administrator. Rerunnable, no data drops.
begin;
create schema if not exists revision_private;
revoke all on schema revision_private from public, anon, authenticated;

create table if not exists public.revision_subjects (
  id text primary key, name text not null, board text not null
);
create table if not exists public.revision_specifications (
  id text primary key, subject_id text not null references public.revision_subjects,
  code text not null, title text not null, source_url text not null
);
create table if not exists public.revision_books (
  id text primary key, specification_id text not null references public.revision_specifications,
  title text not null, required boolean not null default false,
  option_family text, option_level integer check (option_level in (1,2)), sort_order integer not null
);
create table if not exists public.revision_chapters (
  id text primary key, book_id text not null references public.revision_books,
  number integer not null, title text not null, description_md text, example_md text,
  reminder_reviewed boolean not null default false, unique(book_id, number)
);
create table if not exists public.revision_subtopics (
  id text primary key, chapter_id text not null references public.revision_chapters,
  number text not null, title text not null, page_start integer not null,
  page_count integer not null, length_rating integer not null check(length_rating between 1 and 5),
  difficulty_rating integer not null check(difficulty_rating between 1 and 5),
  strand text not null, unique(chapter_id, number)
);
create table if not exists public.revision_papers (
  id text primary key, specification_id text not null references public.revision_specifications,
  title text not null, option_book_id text references public.revision_books
);
create table if not exists public.revision_paper_chapters (
  paper_id text references public.revision_papers, chapter_id text references public.revision_chapters,
  primary key(paper_id, chapter_id)
);
create table if not exists public.revision_exams (
  id uuid primary key default gen_random_uuid(), paper_id text not null references public.revision_papers,
  exam_date date not null, provisional boolean not null default true, source_url text not null,
  label text not null default '', unique(paper_id, exam_date)
);
create table if not exists public.revision_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  daily_minutes integer not null default 60 check(daily_minutes between 5 and 480),
  timezone text not null default 'UTC', exam_year integer not null default extract(year from now()),
  onboarded boolean not null default false, last_syllabus_check timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.revision_enrolments (
  user_id uuid references public.revision_profiles on delete cascade,
  book_id text references public.revision_books, primary key(user_id, book_id)
);
create table if not exists public.revision_progress (
  user_id uuid references public.revision_profiles on delete cascade,
  chapter_id text references public.revision_chapters,
  confidence integer check(confidence between 1 and 5),
  prior_alpha numeric not null default 1 check(prior_alpha > 0), prior_beta numeric not null default 1 check(prior_beta > 0),
  alpha numeric not null default 1 check(alpha > 0), beta numeric not null default 1 check(beta > 0),
  attempts integer not null default 0, review_step integer not null default 0 check(review_step between 0 and 5),
  next_review date, last_attempt_at timestamptz,
  primary key(user_id, chapter_id)
);
create table if not exists public.revision_questions (
  id text not null, version integer not null check(version > 0), prompt_md text not null,
  difficulty integer not null check(difficulty between 1 and 5),
  estimated_seconds integer not null check(estimated_seconds between 15 and 7200),
  total_marks integer check(total_marks > 0), assets jsonb not null default '[]',
  source jsonb not null, status text not null check(status in ('draft','verified','archived','withdrawn')),
  created_at timestamptz not null default now(), primary key(id, version)
);
create unique index if not exists revision_one_live_question on public.revision_questions(id) where status = 'verified';
create table if not exists revision_private.solutions (
  question_id text, question_version integer, solution_md text not null,
  primary key(question_id, question_version),
  foreign key(question_id, question_version) references public.revision_questions(id,version)
);
create table if not exists public.revision_question_subtopics (
  question_id text, question_version integer, subtopic_id text references public.revision_subtopics,
  primary key(question_id, question_version, subtopic_id),
  foreign key(question_id, question_version) references public.revision_questions(id,version)
);
create table if not exists public.revision_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.revision_profiles on delete cascade,
  local_date date not null, target_seconds integer not null, version integer not null default 1,
  status text not null default 'open' check(status in ('open','finished')),
  check_seconds integer not null default 0 check(check_seconds between 0 and 1800),
  created_at timestamptz not null default now(), unique(user_id, local_date)
);
create table if not exists public.revision_queue (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.revision_sessions on delete cascade,
  position integer not null, question_id text not null, question_version integer not null,
  estimated_seconds integer not null, reason text not null,
  state text not null default 'queued' check(state in ('queued','active','completed')),
  ease integer check(ease between 1 and 5), revealed_at timestamptz,
  draft_correctness integer check(draft_correctness between 1 and 5), draft_marks integer check(draft_marks>=0),
  active_seconds integer not null default 0 check(active_seconds between 0 and 86400),
  paused boolean not null default false,
  foreign key(question_id,question_version) references public.revision_questions(id,version),
  unique(session_id, question_id), unique(session_id, position)
);
create unique index if not exists revision_one_active_item on public.revision_queue(session_id) where state = 'active';
create table if not exists public.revision_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.revision_profiles on delete cascade,
  queue_id uuid not null unique references public.revision_queue,
  session_id uuid not null references public.revision_sessions,
  question_id text not null, question_version integer not null,
  ease integer not null check(ease between 1 and 5), correctness integer not null check(correctness between 1 and 5),
  active_seconds integer not null check(active_seconds between 0 and 86400),
  earned_marks integer check(earned_marks >= 0), total_marks integer,
  completed_at timestamptz not null default now(), local_date date not null,
  idempotency_key uuid not null, unique(user_id, idempotency_key),
  model_version text not null default 'beta-v1',
  foreign key(question_id,question_version) references public.revision_questions(id,version),
  check(earned_marks is null or (total_marks is not null and earned_marks <= total_marks))
);
create index if not exists revision_attempt_history on public.revision_attempts(user_id,question_id,completed_at desc);
create index if not exists revision_attempt_sessions on public.revision_attempts(session_id);
create index if not exists revision_question_chapters on public.revision_question_subtopics(subtopic_id);
create index if not exists revision_session_owner on public.revision_sessions(user_id,local_date);

-- Immutable replay receipts cover every mutating RPC, not just attempt completion.
create table if not exists revision_private.receipts (
  user_id uuid references auth.users on delete cascade, request_id uuid,
  action text not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(user_id,request_id)
);

-- Explicit grants: catalogue is read-only; all student mutations go through the API.
do $$
declare t text;
begin
  foreach t in array array['subjects','specifications','books','chapters','subtopics','papers','paper_chapters','exams',
    'profiles','enrolments','progress','questions','question_subtopics','sessions','queue','attempts'] loop
    execute format('alter table public.revision_%I enable row level security',t);
    execute format('revoke all on public.revision_%I from public, anon, authenticated',t);
    execute format('grant select on public.revision_%I to authenticated',t);
  end loop;
  foreach t in array array['subjects','specifications','books','chapters','subtopics','papers','paper_chapters','exams'] loop
    execute format('drop policy if exists revision_read on public.revision_%I',t);
    execute format('create policy revision_read on public.revision_%I for select to authenticated using ((select auth.uid()) is not null)',t);
  end loop;
  foreach t in array array['profiles','enrolments','progress','sessions','attempts'] loop
    execute format('drop policy if exists revision_own on public.revision_%I',t);
    execute format('create policy revision_own on public.revision_%I for select to authenticated using (user_id = (select auth.uid()))',t);
  end loop;
end $$;
drop policy if exists revision_own on public.revision_queue;
create policy revision_own on public.revision_queue for select to authenticated using (
  exists(select 1 from public.revision_sessions s where s.id=session_id and s.user_id=(select auth.uid()))
);
drop policy if exists revision_read on public.revision_questions;
create policy revision_read on public.revision_questions for select to authenticated using(status='verified');
drop policy if exists revision_read on public.revision_question_subtopics;
create policy revision_read on public.revision_question_subtopics for select to authenticated using(
  exists(select 1 from public.revision_questions q where q.id=question_id and q.version=question_version and q.status='verified')
);
commit;
