import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const require=createRequire(new URL('../../a-level/tests/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;`);
 const setup=(await readFile(new URL('./setup.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
 await db.exec(setup);
 await db.exec(setup); // The deployment script remains safe to reapply.
 const owner=(await db.query('select model_identity($1) id',['a'.repeat(64)])).rows[0].id;
 const other=(await db.query('select model_identity($1) id',['b'.repeat(64)])).rows[0].id;
 await db.exec("insert into model_exercises select 'other-exercise',primary_metric,higher_is_better,secondary_metrics,model_max_bytes,weights_max_bytes,concurrent_limit,deadline,leaderboard_visible,max_attempts,lease_seconds from model_exercises where id='nn-rocket'");
 const modelHash='1'.repeat(64),weightsHash='2'.repeat(64);
 async function submission(values={}) {
  const v={owner,exercise:'nn-rocket',status:'running',modelHash,weightsHash,result:null,error:null,...values};
  const id=crypto.randomUUID(),claim=crypto.randomUUID();
  await db.query(`insert into model_submissions(id,participant_id,exercise_id,status,model_path,weights_path,
   model_sha256,weights_sha256,claim_token,lease_until,result,error_category,evaluator_version,test_set_version,evaluated_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '15 minutes',$10,$11,'worker-v4','tests-v4',now())`,
   [id,v.owner,v.exercise,v.status,`${id}/model.py`,`${id}/weights.safetensors`,v.modelHash,v.weightsHash,claim,v.result,v.error]);
  return {id,claim,...v};
 }
 async function reuse(target,versions={},hashes={}) {
  return (await db.query('select model_reuse_result($1,$2,$3,$4,$5,$6,$7) reused',
   [target.id,target.claim,hashes.model??target.modelHash??modelHash,hashes.weights??target.weightsHash??weightsHash,
    versions.evaluator??'worker-v4',versions.tests??'tests-v4',123])).rows[0].reused;
 }
 const source=await submission({status:'completed',result:{score:81.25,landing_success_pct:80}});
 await db.query("select model_publish($1,'nn-rocket',$2)",[owner,source.id]);
 const target=await submission({modelHash:null,weightsHash:null});
 assert.equal(await reuse(target),true);
 const saved=(await db.query('select * from model_submissions where id=$1',[target.id])).rows[0];
 assert.equal(saved.status,'completed');assert.deepEqual(saved.result,source.result);
 assert.equal(saved.duration_ms,123);assert.equal(saved.model_sha256,modelHash);assert.equal(saved.weights_sha256,weightsHash);
 assert.equal(saved.claim_token,null);assert.equal(saved.lease_until,null);assert.deepEqual(saved.replay_manifest,[]);
 assert.deepEqual(saved.evaluation_metadata,{cache_hit:true,cache_source_submission:source.id,public_replays:[]});
 const dashboard=(await db.query("select model_dashboard($1,'nn-rocket') data",[owner])).rows[0].data;
 assert.equal(dashboard.submissions.find(s=>s.id===source.id).selected,true);
 assert.equal(dashboard.submissions.find(s=>s.id===target.id).selected,false);
 assert.ok(!JSON.stringify(dashboard).includes('cache_source_submission'));
 assert.equal(await reuse(target),false,'A completed claim cannot be reused again');
 for(const [values,versions] of [
  [{owner:other},{}],[{exercise:'other-exercise'},{}],
  [{modelHash:'3'.repeat(64)},{}],[{weightsHash:'3'.repeat(64)},{}],
  [{},{evaluator:'worker-v5'}],[{},{tests:'different-seed-or-physics'}],
 ]) {
  const miss=await submission(values);
  assert.equal(await reuse(miss,versions),false);
  assert.equal((await db.query('select status from model_submissions where id=$1',[miss.id])).rows[0].status,'running');
 }
 const failedHash='4'.repeat(64);
 await submission({status:'failed',modelHash:failedHash,error:'runtime'});
 assert.equal(await reuse(await submission({modelHash:failedHash})),false,'Failures are not cached');
 await submission({status:'running',modelHash:'5'.repeat(64)});
 assert.equal(await reuse(await submission({modelHash:'5'.repeat(64)})),false,'In-progress results are not cached');
 const stale=await submission();
 assert.equal(await reuse({...stale,claim:crypto.randomUUID()}),false);
 await db.query("update model_submissions set lease_until=now()-interval '1 second' where id=$1",[stale.id]);
 assert.equal(await reuse(stale),false,'Expired claims cannot complete from cache');
 const mismatch=await submission();
 await assert.rejects(reuse(mismatch,{}, {model:'f'.repeat(64)}),/Artifact digest mismatch/);
 await assert.rejects(reuse(mismatch,{}, {model:'invalid'}),/Invalid cache request/);
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(reuse(mismatch),/permission denied/);
  await db.exec('reset role');
 }
 console.log('Result cache: artifact/version/owner/exercise isolation, success-only reuse, stale claims, private metadata and permissions passed');
} finally {await db.close();}
