-- Private model submissions. Apply in the Supabase SQL editor as the project owner.
begin;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.model_exercises (
 id text primary key, primary_metric text not null, higher_is_better boolean not null,
 secondary_metrics text[] not null default '{}', model_max_bytes integer not null check(model_max_bytes > 0),
 weights_max_bytes integer not null check(weights_max_bytes > 0), concurrent_limit integer not null check(concurrent_limit > 0),
 deadline timestamptz, leaderboard_visible boolean not null default true,
 max_attempts integer not null default 3 check(max_attempts > 0), lease_seconds integer not null default 900 check(lease_seconds >= 60)
);
insert into public.model_exercises(id,primary_metric,higher_is_better,secondary_metrics,model_max_bytes,weights_max_bytes,concurrent_limit)
values ('nn-rocket','score',true,array['landing_success_pct'],131072,20971520,2) on conflict(id) do nothing;
create table if not exists public.model_participants (
 id uuid primary key default gen_random_uuid(), secret_hash text unique not null,
 display_name text not null default 'Anonymous' check(char_length(display_name) between 1 and 40),
 created_at timestamptz not null default now(), last_activity_at timestamptz not null default now()
);
create index if not exists model_participants_created on public.model_participants(created_at);
create table if not exists public.model_submissions (
 id uuid primary key default gen_random_uuid(), participant_id uuid not null references public.model_participants(id),
 exercise_id text not null references public.model_exercises(id), status text not null default 'uploading' check(status in ('uploading','queued','running','completed','failed')),
 created_at timestamptz not null default now(), queued_at timestamptz, started_at timestamptz, completed_at timestamptz,
 model_path text not null unique, weights_path text not null unique, model_sha256 text, weights_sha256 text,
 attempt_count integer not null default 0, claim_token uuid, lease_until timestamptz,
 error_category text, result jsonb, evaluation_metadata jsonb, duration_ms bigint check(duration_ms >= 0), evaluator_version text, test_set_version text, evaluated_at timestamptz,
 unique(id,participant_id,exercise_id)
);
-- Historical running/completed jobs cannot be reconstructed across old retries.
-- Keep their queue wait unknown; new jobs and never-claimed queued jobs start at zero.
do $$ begin
 if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='model_submissions' and column_name='queue_wait_ms') then
  alter table public.model_submissions add column queue_wait_ms bigint check(queue_wait_ms >= 0);
  update public.model_submissions set queue_wait_ms=0 where status='uploading' or (status='queued' and attempt_count=0);
  alter table public.model_submissions alter column queue_wait_ms set default 0;
 end if;
end $$;
alter table public.model_submissions add column if not exists error_detail_code text;
alter table public.model_submissions add column if not exists replay_manifest jsonb not null default '[]'::jsonb;
create index if not exists model_submission_history on public.model_submissions(participant_id,exercise_id,created_at desc,id desc);
create index if not exists model_submission_queue on public.model_submissions(status,queued_at,id) where status in ('queued','running');
create table if not exists public.model_rate_events (participant_id uuid not null references public.model_participants(id), action text not null, created_at timestamptz not null default now());
create index if not exists model_rate_recent on public.model_rate_events(action,created_at);
create table if not exists public.model_leaderboard (
 participant_id uuid not null, exercise_id text not null, submission_id uuid not null, updated_at timestamptz not null default now(),
 primary key(participant_id,exercise_id), foreign key(submission_id,participant_id,exercise_id) references public.model_submissions(id,participant_id,exercise_id)
);
insert into storage.buckets(id,name,public,file_size_limit) values('model-artifacts','model-artifacts',false,20971520)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
do $$ begin
 if not coalesce((select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects'),false) then
  raise exception 'Storage object row-level security must be enabled';
 end if;
end $$;
-- Restrictive policies compose with any existing permissive storage policies.
-- The service role bypasses RLS; ordinary API roles can never read or change
-- objects in this bucket even if another policy grants broad storage access.
drop policy if exists model_artifacts_deny_clients on storage.objects;
create policy model_artifacts_deny_clients on storage.objects as restrictive for all to anon, authenticated
 using (bucket_id <> 'model-artifacts') with check (bucket_id <> 'model-artifacts');
alter table public.model_exercises enable row level security;
alter table public.model_participants enable row level security;
alter table public.model_submissions enable row level security;
alter table public.model_leaderboard enable row level security;
alter table public.model_rate_events enable row level security;
revoke all on public.model_exercises,public.model_participants,public.model_submissions,public.model_leaderboard,public.model_rate_events from public,anon,authenticated;
grant all on public.model_exercises,public.model_participants,public.model_submissions,public.model_leaderboard,public.model_rate_events to service_role;

-- All functions below are service-role-only; the Edge Function validates the cookie.
create or replace function public.model_lookup(p_hash text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 update model_participants set last_activity_at=now() where secret_hash=p_hash returning id into v_id;
 return v_id;
end $$;
create or replace function public.model_identity(p_hash text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; n integer;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid identity'; end if;
 select id into v_id from model_participants where secret_hash=p_hash;
 if v_id is not null then
  update model_participants set last_activity_at=now() where id=v_id;
  return v_id;
 end if;
 perform pg_advisory_xact_lock(18722003);
 -- Recheck after acquiring the lock: simultaneous requests can share one cookie.
 select id into v_id from model_participants where secret_hash=p_hash;
 if v_id is not null then return v_id; end if;
 select count(*) into n from model_participants where created_at>now()-interval '1 minute';
 if n>=120 then raise exception 'Please wait before submitting again'; end if;
 insert into model_participants(secret_hash) values(p_hash) returning id into v_id;
 return v_id;
end $$;

create or replace function public.model_rate(p_participant uuid,p_action text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if p_action not in ('upload','queue') then raise exception 'Invalid rate action'; end if;
 perform pg_advisory_xact_lock(18722002);
 delete from model_rate_events where created_at < now()-interval '1 day';
 select count(*) into n from model_rate_events where action=p_action and created_at>now()-interval '1 minute';
 if n>=240 then raise exception 'Please wait before submitting again'; end if;
 select count(*) into n from model_rate_events where participant_id=p_participant and action=p_action and created_at>now()-interval '1 minute';
 if n>=6 then raise exception 'Please wait before submitting again'; end if;
 insert into model_rate_events(participant_id,action) values(p_participant,p_action);
end $$;
create or replace function public.model_create(p_participant uuid,p_exercise text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c model_exercises; s uuid:=gen_random_uuid(); n integer;
begin
 perform 1 from model_participants where id=p_participant for update;
 if not found then raise exception 'Invalid participant'; end if;
 select * into c from model_exercises where id=p_exercise;
 if not found or (c.deadline is not null and now()>c.deadline) then raise exception 'Submissions are closed'; end if;
 update model_submissions set status='failed',completed_at=now(),error_category='upload_error' where participant_id=p_participant and exercise_id=p_exercise and status='uploading' and created_at < now()-interval '30 minutes';
 select count(*) into n from model_submissions where participant_id=p_participant and exercise_id=p_exercise and status in ('uploading','queued','running');
 if n>=c.concurrent_limit then raise exception 'Too many active submissions'; end if;
 perform pg_advisory_xact_lock(18722001);
 select count(*) into n from model_submissions where created_at > now()-interval '1 minute';
 if n>=120 then raise exception 'Please wait before submitting again'; end if;
 select count(*) into n from model_submissions where participant_id=p_participant and created_at > now()-interval '1 minute';
 if n>=3 then raise exception 'Please wait before submitting again'; end if;
 insert into model_submissions(id,participant_id,exercise_id,model_path,weights_path) values(s,p_participant,p_exercise,s::text||'/model.py',s::text||'/weights.safetensors');
 return jsonb_build_object('id',s,'model_max_bytes',c.model_max_bytes,'weights_max_bytes',c.weights_max_bytes);
end $$;
create or replace function public.model_upload_info(p_participant uuid,p_submission uuid,p_file text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s model_submissions; c model_exercises;
begin
 select * into s from model_submissions where id=p_submission and participant_id=p_participant and status='uploading';
 if not found or p_file not in ('model.py','weights.safetensors') then raise exception 'Upload unavailable'; end if;
 select * into c from model_exercises where id=s.exercise_id;
 return jsonb_build_object('path',case when p_file='model.py' then s.model_path else s.weights_path end,'max_bytes',case when p_file='model.py' then c.model_max_bytes else c.weights_max_bytes end);
end $$;
-- The trusted upload gateway records a digest after Storage accepts the bytes.
-- Queueing may race this optional metadata write, so a late digest is simply omitted.
create or replace function public.model_record_upload(p_participant uuid,p_submission uuid,p_file text,p_sha256 text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_file is null or p_sha256 is null or p_file not in ('model.py','weights.safetensors') or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid artifact digest'; end if;
 update model_submissions set model_sha256=case when p_file='model.py' then p_sha256 else model_sha256 end,
  weights_sha256=case when p_file='weights.safetensors' then p_sha256 else weights_sha256 end
  where id=p_submission and participant_id=p_participant and status='uploading'
  and case when p_file='model.py' then model_sha256 is null else weights_sha256 is null end;
 return found;
end $$;
create or replace function public.model_queue(p_participant uuid,p_submission uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s model_submissions; c model_exercises; a storage.objects; b storage.objects;
begin
 select * into s from model_submissions where id=p_submission and participant_id=p_participant for update;
 if not found or s.status<>'uploading' then raise exception 'Submission cannot be queued'; end if;
 select * into c from model_exercises where id=s.exercise_id;
 if c.deadline is not null and now()>c.deadline then raise exception 'Submissions are closed'; end if;
 select * into a from storage.objects where bucket_id='model-artifacts' and name=s.model_path;
 select * into b from storage.objects where bucket_id='model-artifacts' and name=s.weights_path;
 if a.id is null or b.id is null or coalesce((a.metadata->>'size')::bigint,0) not between 1 and c.model_max_bytes or coalesce((b.metadata->>'size')::bigint,0) not between 1 and c.weights_max_bytes then raise exception 'Both valid files are required'; end if;
 update model_submissions set status='queued',queued_at=now() where id=s.id;
end $$;
create or replace function public.model_abort(p_participant uuid,p_submission uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 update model_submissions set status='failed',completed_at=now(),error_category='upload_error' where id=p_submission and participant_id=p_participant and status='uploading';
$$;
create or replace function public.model_name(p_participant uuid,p_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 p_name:=btrim(p_name);
 if char_length(p_name) not between 1 and 40 or p_name ~ '[[:cntrl:]]' then raise exception 'Name must be 1 to 40 characters'; end if;
 update model_participants set display_name=p_name where id=p_participant;
end $$;
create or replace function public.model_publish(p_participant uuid,p_exercise text,p_submission uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s model_submissions; c model_exercises; v jsonb;
begin
 if p_submission is null then delete from model_leaderboard where participant_id=p_participant and exercise_id=p_exercise; return; end if;
 select * into c from model_exercises where id=p_exercise and leaderboard_visible;
 select * into s from model_submissions where id=p_submission and participant_id=p_participant and exercise_id=p_exercise and status='completed';
 v:=s.result->c.primary_metric;
 if s.id is null or jsonb_typeof(v) is distinct from 'number' then raise exception 'Only completed submissions with a score can be published'; end if;
 insert into model_leaderboard(participant_id,exercise_id,submission_id) values(p_participant,p_exercise,p_submission)
 on conflict(participant_id,exercise_id) do update set submission_id=excluded.submission_id,updated_at=now();
end $$;
create or replace function public.model_dashboard(p_participant uuid,p_exercise text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('name',(select display_name from model_participants where id=p_participant),
 'config',(select jsonb_build_object('primary_metric',primary_metric,'secondary_metrics',secondary_metrics,'higher_is_better',higher_is_better,'model_max_bytes',model_max_bytes,'weights_max_bytes',weights_max_bytes) from model_exercises where id=p_exercise),
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'created_at',s.created_at,'queued_at',s.queued_at,'started_at',s.started_at,'completed_at',s.completed_at,'duration_ms',s.duration_ms,'queue_wait_ms',s.queue_wait_ms + case when s.status='running' and s.lease_until<now() then greatest(0,(extract(epoch from (now()-s.lease_until))*1000)::bigint) else 0 end,'metrics',s.result,'runs',coalesce((select jsonb_agg((r-'path')||jsonb_build_object('replay_available',true) order by (r->>'run_id')::integer) from jsonb_array_elements(s.replay_manifest) r),'[]'::jsonb),'error_category',s.error_category,'error_detail_code',s.error_detail_code,'selected',l.submission_id=s.id) order by s.created_at desc,s.id desc) from model_submissions s left join model_leaderboard l on l.participant_id=s.participant_id and l.exercise_id=s.exercise_id where s.participant_id=p_participant and s.exercise_id=p_exercise),'[]'::jsonb),
 'leaderboard',coalesce((select jsonb_agg(x.row order by x.rn) from (select row_number() over (order by case when c.higher_is_better then -(s.result->>c.primary_metric)::numeric else (s.result->>c.primary_metric)::numeric end, s.created_at, s.id) rn,jsonb_build_object('name',p.display_name,'score',s.result->c.primary_metric,'metrics',(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(s.result) where key=any(c.secondary_metrics)),'duration_ms',s.duration_ms,'created_at',s.created_at,'is_current',l.participant_id=p_participant) row from model_leaderboard l join model_submissions s on s.id=l.submission_id join model_participants p on p.id=l.participant_id join model_exercises c on c.id=l.exercise_id where l.exercise_id=p_exercise and c.leaderboard_visible and jsonb_typeof(s.result->c.primary_metric)='number') x),'[]'::jsonb));
$$;

-- A claim token fences stale workers after a lease expires. Each claim counts as an attempt.
create or replace function public.model_claim(p_exercise text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s model_submissions; c model_exercises; token uuid:=gen_random_uuid();
begin
 select * into c from model_exercises where id=p_exercise;
 if not found then raise exception 'Unknown exercise'; end if;
 update model_submissions set status='failed',completed_at=now(),error_category='infrastructure',queue_wait_ms=queue_wait_ms+greatest(0,(extract(epoch from (now()-lease_until))*1000)::bigint),claim_token=null,lease_until=null where exercise_id=p_exercise and status='running' and lease_until<now() and attempt_count>=c.max_attempts;
 select * into s from model_submissions where exercise_id=p_exercise and (status='queued' or (status='running' and lease_until<now() and attempt_count<c.max_attempts)) order by queued_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update model_submissions set status='running',started_at=now(),queue_wait_ms=queue_wait_ms+greatest(0,(extract(epoch from (now()-case when s.status='queued' then s.queued_at else s.lease_until end))*1000)::bigint),attempt_count=attempt_count+1,claim_token=token,lease_until=now()+make_interval(secs=>c.lease_seconds) where id=s.id returning * into s;
 return jsonb_build_object('submission_id',s.id,'exercise_id',s.exercise_id,'claim_token',token,'attempt',s.attempt_count,'lease_until',s.lease_until,'bucket','model-artifacts','model_path',s.model_path,'weights_path',s.weights_path,'model_sha256',s.model_sha256,'weights_sha256',s.weights_sha256);
end $$;
-- A worker may fetch an artifact only while it owns the current, unexpired claim.
create or replace function public.model_worker_artifact(p_submission uuid,p_token uuid,p_file text) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select case p_file when 'model.py' then model_path when 'weights.safetensors' then weights_path end
 from model_submissions where id=p_submission and status='running' and claim_token=p_token and lease_until>now()
 and p_file in ('model.py','weights.safetensors');
$$;
create or replace function public.model_heartbeat(p_submission uuid,p_token uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update model_submissions s set lease_until=now()+make_interval(secs=>c.lease_seconds) from model_exercises c where s.id=p_submission and s.exercise_id=c.id and s.status='running' and s.claim_token=p_token and s.lease_until>now();
 return found;
end $$;
-- Paths are immutable per claim. An expired worker can never replace the
-- accepted attempt's recordings. The browser never supplies a storage path.
create or replace function public.model_worker_replay(p_submission uuid,p_token uuid,p_run integer) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select s.id::text||'/replays/'||s.claim_token::text||'/run-'||p_run::text||'.json'
 from model_submissions s where s.id=p_submission and s.exercise_id='nn-rocket'
 and s.status='running' and s.claim_token=p_token and s.lease_until>now() and p_run between 0 and 3;
$$;
create or replace function public.model_replay_info(p_participant uuid,p_submission uuid,p_exercise text,p_run integer) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select r->>'path' from model_submissions s cross join lateral jsonb_array_elements(s.replay_manifest) r
 where s.id=p_submission and s.participant_id=p_participant and s.exercise_id=p_exercise
 and s.status='completed' and (r->>'run_id')::integer=p_run;
$$;
create or replace function public.model_finish(p_submission uuid,p_token uuid,p_metrics jsonb,p_duration_ms bigint,p_evaluator_version text,p_test_set_version text,p_error_category text default null,p_metadata jsonb default '{}'::jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare s model_submissions; c model_exercises; runs jsonb; r jsonb; manifest jsonb:='[]'; path text; run_number integer; seen integer[]:='{}';
begin
 select * into s from model_submissions where id=p_submission and status='running' and claim_token=p_token and lease_until>now() for update;
 if not found then return false; end if;
 select * into c from model_exercises where id=s.exercise_id;
 if jsonb_typeof(p_metadata) is distinct from 'object' or pg_column_size(p_metadata)>16384 then raise exception 'Invalid metadata'; end if;
 if p_metadata ? 'public_error_code' then
  if jsonb_typeof(p_metadata->'public_error_code') is distinct from 'string' or not coalesce((p_metadata->>'public_error_code') = any(case p_error_category
   when 'model_loading' then array['missing_entrypoint','incompatible_weights','dependency_missing']
   when 'invalid_shape' then array['input_shape','output_shape','non_finite','out_of_range']
   when 'runtime' then array['controller_exception']
   when 'timeout' then array['time_limit']
   when 'resource_limit' then array['memory_limit']
   when 'evaluation' then array['evaluation_failed']
   when 'infrastructure' then array['worker_interrupted']
   else array[]::text[] end),false) then raise exception 'Invalid public error code'; end if;
 end if;
 if p_duration_ms is null or p_duration_ms<0 or p_duration_ms>86400000 or length(coalesce(p_evaluator_version,''))>100 or length(coalesce(p_test_set_version,''))>100 then raise exception 'Invalid result'; end if;
 if p_error_category is null then
  if jsonb_typeof(p_metrics) is distinct from 'object' or pg_column_size(p_metrics)>16384 or jsonb_typeof(p_metrics->c.primary_metric) is distinct from 'number' or exists (select 1 from jsonb_each(p_metrics) m where jsonb_typeof(m.value)<>'number' or length(m.key)>80) then raise exception 'Invalid metrics'; end if;
 else
  if p_error_category not in ('model_loading','invalid_shape','runtime','timeout','resource_limit','evaluation','infrastructure') then raise exception 'Invalid error category'; end if;
  p_metrics:=null;
 end if;
 runs:=coalesce(p_metadata->'public_replays','[]'::jsonb);
 if jsonb_typeof(runs) is distinct from 'array' then raise exception 'Invalid replay manifest'; end if;
 if jsonb_array_length(runs)>4 or (jsonb_array_length(runs)>0 and (s.exercise_id<>'nn-rocket' or p_error_category is not null)) then raise exception 'Invalid replay manifest'; end if;
 for r in select value from jsonb_array_elements(runs) loop
  if jsonb_typeof(r->'run_id') is distinct from 'number' or (r->>'run_id') !~ '^[0-3]$' then raise exception 'Invalid replay number'; end if;
  run_number:=(r->>'run_id')::integer;
  if run_number=any(seen) or r->>'scenario' is distinct from (array['demo_descent','centred_descent','crosswind_diagnostics','near_ground_contact'])[run_number+1]
   or jsonb_typeof(r->'score') is distinct from 'number' or jsonb_typeof(r->'success') is distinct from 'boolean'
   or jsonb_typeof(r->'duration') is distinct from 'number' then raise exception 'Invalid public replay'; end if;
  if (r->>'score')::numeric not between 0 and 100 or (r->>'duration')::numeric not between 0 and 31 then raise exception 'Invalid replay result'; end if;
  seen:=array_append(seen,run_number);
  path:=public.model_worker_replay(s.id,p_token,run_number);
  if path is null or not exists(select 1 from storage.objects o where o.bucket_id='model-artifacts' and o.name=path and (o.metadata->>'size')::bigint between 1 and 8388608) then raise exception 'Replay upload missing'; end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('run_id',run_number,'scenario',r->'scenario','score',r->'score','success',r->'success','duration',r->'duration','path',path));
 end loop;
 update model_submissions set status=case when p_error_category is null then 'completed' else 'failed' end,completed_at=now(),evaluated_at=now(),result=p_metrics,replay_manifest=manifest,duration_ms=p_duration_ms,evaluator_version=p_evaluator_version,test_set_version=p_test_set_version,error_category=p_error_category,error_detail_code=p_metadata->>'public_error_code',evaluation_metadata=p_metadata,claim_token=null,lease_until=null where id=s.id;
 return true;
end $$;
revoke all on function public.model_worker_replay(uuid,uuid,integer),public.model_replay_info(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.model_worker_replay(uuid,uuid,integer),public.model_replay_info(uuid,uuid,text,integer) to service_role;
revoke all on function public.model_lookup(text), public.model_identity(text), public.model_rate(uuid,text), public.model_create(uuid,text), public.model_upload_info(uuid,uuid,text), public.model_record_upload(uuid,uuid,text,text), public.model_queue(uuid,uuid), public.model_abort(uuid,uuid), public.model_name(uuid,text), public.model_publish(uuid,text,uuid), public.model_dashboard(uuid,text), public.model_claim(text), public.model_worker_artifact(uuid,uuid,text), public.model_heartbeat(uuid,uuid), public.model_finish(uuid,uuid,jsonb,bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.model_lookup(text), public.model_identity(text), public.model_rate(uuid,text), public.model_create(uuid,text), public.model_upload_info(uuid,uuid,text), public.model_record_upload(uuid,uuid,text,text), public.model_queue(uuid,uuid), public.model_abort(uuid,uuid), public.model_name(uuid,text), public.model_publish(uuid,text,uuid), public.model_dashboard(uuid,text), public.model_claim(text), public.model_worker_artifact(uuid,uuid,text), public.model_heartbeat(uuid,uuid), public.model_finish(uuid,uuid,jsonb,bigint,text,text,text,jsonb) to service_role;
commit;
