-- Apply after 12-queue-performance.sql. Deletes replay receipts older than 30 days. Rerunnable.
--
-- Receipts only make retries of lost responses safe; attempts and progress are separate tables
-- and are never touched. A retry older than the retention window is not replayed: session
-- actions fail their expected_version check (the original commit already bumped it) and
-- revision_attempts.idempotency_key still prevents a duplicate attempt.
begin;

create index if not exists revision_receipt_age on revision_private.receipts(created_at);

-- Each new receipt removes whichever receipts have just aged out, for all users.
create or replace function revision_private.prune_receipts() returns trigger
language plpgsql set search_path='' as $$
begin
  delete from revision_private.receipts where created_at<now()-interval '30 days';
  return null;
end $$;

drop trigger if exists revision_prune_receipts on revision_private.receipts;
create trigger revision_prune_receipts after insert on revision_private.receipts
  for each statement execute function revision_private.prune_receipts();

-- One-off cleanup of the existing backlog.
delete from revision_private.receipts where created_at<now()-interval '30 days';

revoke all on function revision_private.prune_receipts() from public,anon,authenticated;
commit;
