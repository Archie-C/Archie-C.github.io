-- Run in the Supabase SQL editor before importing the private y_test.csv.
-- No client read/write policies are granted; the Edge Function reads as service_role.
create table if not exists public.rocket_test_labels (
  dataset_id text not null check (dataset_id ~ '^[0-9a-f]{64}$'),
  row_index integer not null check (row_index >= 0),
  action smallint not null check (action between 0 and 9),
  primary key (dataset_id, row_index)
);
alter table public.rocket_test_labels enable row level security;
revoke all on table public.rocket_test_labels from public, anon, authenticated;
grant select on table public.rocket_test_labels to service_role;
