-- Delete ALL submission runs across ALL exercises. This is irreversible after commit.
-- Paste this entire file into the Supabase SQL Editor and run as the project owner.
-- Pause submissions and stop the Modal worker before running; resume them afterwards.
-- Clears uploading, queued, running, completed and failed submissions, their scores,
-- replay manifests, cached results, leaderboard selections and rate-limit events.
-- Keeps participant identities/names, exercise settings, tables, functions and policies.
-- Uploaded models, weights and replay files remain in the private model-artifacts
-- bucket. To remove those too, delete its contents through Supabase Storage's
-- dashboard or API; keep the bucket and do not delete storage.objects rows with SQL.

begin;

truncate table
 public.model_leaderboard,
 public.model_submissions,
 public.model_rate_events;

commit;
