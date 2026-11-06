-- Run once in the Supabase SQL editor, then deploy the updated score-rocket
-- Edge Function. The function returns only public leaderboard fields.
begin;
create or replace function public.rocket_best_submissions(
  p_metric text,
  p_offset integer,
  p_limit integer
)
returns table (name text, metrics jsonb, created_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with eligible as (
    select s.id, s.browser_id, s.name, s.metrics, s.created_at,
      case when jsonb_typeof(s.metrics -> p_metric) = 'number'
           then (s.metrics ->> p_metric)::numeric end as metric_value
    from public.global_submissions as s
    where s.task_name = 'rocket'
      and s.metrics ->> 'flight_set' = 'test-v1'
      and s.browser_id is not null and s.browser_id <> ''
      and p_metric in ('score', 'landing_success_pct', 'macro_f1', 'accuracy')
  ), ranked as (
    select e.*,
      row_number() over (
        partition by e.browser_id
        order by e.metric_value desc, e.created_at desc nulls last, e.id desc
      ) as browser_rank
    from eligible as e
    where e.metric_value is not null
  )
  select r.name, r.metrics, r.created_at
  from ranked as r
  where r.browser_rank = 1
  order by r.metric_value desc, r.created_at desc nulls last, r.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 0), 0), 500);
$$;
revoke all on function public.rocket_best_submissions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rocket_best_submissions(text, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;
