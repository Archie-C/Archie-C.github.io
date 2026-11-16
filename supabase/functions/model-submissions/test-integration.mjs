// Gateway + database integration fixture. Storage HTTP is modelled in-process;
// no student Python is executed and no live Supabase project is contacted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../a-level/tests/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();let handler;
try {
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security;`);
 const sql=(await readFile(new URL('../../model-submissions/setup.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
 await db.exec(sql);
 globalThis.EdgeRuntime={waitUntil:promise=>{void promise;}};
 globalThis.Deno={env:{get:key=>({MODEL_SITE_ORIGIN:'https://site.example',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server-secret'})[key]},serve:fn=>{handler=fn;}};
 const objects=new Map();
 globalThis.fetch=async(input,options)=>{
  const url=new URL(input);assert.equal(options.headers.apikey,'server-secret');
  if(url.pathname.startsWith('/rest/v1/rpc/')) {
   const fn=url.pathname.split('/').pop();assert.match(fn,/^model_[a-z_]+$/);
   const data=JSON.parse(options.body),args=Object.values(data), placeholders=args.map((_,i)=>`$${i+1}`).join(',');
   try {const result=await db.query(`select public.${fn}(${placeholders}) as value`,args);const value=result.rows[0].value;return value===null?Response.json(null):Response.json(value);}
   catch(error){return Response.json({message:error.message},{status:400});}
  }
  if(url.pathname.startsWith('/storage/v1/object/model-artifacts/')) {
   assert.equal(options.headers['x-upsert'],'false');const name=decodeURIComponent(url.pathname.slice('/storage/v1/object/model-artifacts/'.length));
   if(objects.has(name)) return Response.json({error:'exists'},{status:409});
   objects.set(name,new Uint8Array(options.body));await db.query("insert into storage.objects(bucket_id,name,metadata) values('model-artifacts',$1,$2)",[name,{size:options.body.byteLength}]);return Response.json({ok:true});
  }
  if(url.pathname.startsWith('/storage/v1/object/authenticated/model-artifacts/')) {
   const path=decodeURIComponent(url.pathname.slice('/storage/v1/object/authenticated/model-artifacts/'.length));
   return objects.has(path)?new Response(objects.get(path)):new Response(null,{status:404});
  }
  throw Error(`Unexpected backend path ${url.pathname}`);
 };
 await import('./index.ts');
 const invoke=(action,{cookie,method='GET',body,file,id,exercise}={})=>{const url=new URL('https://db.example/functions/v1/model-submissions');url.searchParams.set('action',action);if(exercise!==undefined)url.searchParams.set('exercise',exercise);if(id)url.searchParams.set('id',id);const headers={origin:'https://site.example'};if(cookie)headers.cookie=cookie;if(file)headers['x-model-file']=file;if(body!==undefined&&!file)headers['content-type']='application/json';return handler(new Request(url,{method,headers,body}));};
 const browser=async()=>{const r=await invoke('dashboard');assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const a=await browser(),b=await browser();assert.notEqual(a,b);
 let r=await invoke('create',{cookie:a,method:'POST',body:'{}'});assert.equal(r.status,200);const id=(await r.json()).id;
 const post=(action,cookie,data,exercise)=>invoke(action,{cookie,exercise,method:'POST',body:JSON.stringify(data)});
 r=await post('queue',a,{id});assert.equal(r.status,409);assert.match((await r.json()).error,/Both valid files/);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'model.py',body:'x'.repeat(131073)});assert.equal(r.status,413);assert.equal(objects.size,0);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'../model.py',body:'bad name'});assert.equal(r.status,400);assert.equal(objects.size,0);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'model.py',body:'model content'});assert.equal(r.status,200);
 r=await post('queue',a,{id});assert.equal(r.status,409);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'model.py',body:'replacement'});assert.equal(r.status,409);
 r=await post('create',b,{});assert.equal(r.status,200);
 r=await invoke('upload',{cookie:b,method:'POST',id,file:'weights.safetensors',body:'other browser'});assert.equal(r.status,409);
 r=await post('queue',b,{id});assert.equal(r.status,409);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'weights.safetensors',body:'weights'});assert.equal(r.status,200);
 r=await post('queue',a,{id});assert.equal(r.status,200);
 r=await invoke('upload',{cookie:a,method:'POST',id,file:'model.py',body:'late overwrite'});assert.equal(r.status,409);
 const claim=(await db.query("select model_claim('nn-rocket') as value")).rows[0].value;assert.equal(claim.submission_id,id);assert.equal(claim.model_sha256,createHash('sha256').update('model content').digest('hex'));assert.equal(claim.weights_sha256,createHash('sha256').update('weights').digest('hex'));
 assert.equal((await db.query("select model_claim('nn-rocket') as value")).rows[0].value,null);assert.equal((await db.query("select model_record_upload(participant_id,id,'model.py',$1) value from model_submissions where id=$2",['a'.repeat(64),id])).rows[0].value,false);
 const replayPath=(await db.query('select model_worker_replay($1,$2,0) path',[id,claim.claim_token])).rows[0].path;
 const replay={schema:'rocket-run-v1',config:{scenario:'demo_descent'},snapshots:[{time:0}]};
 const replayBytes=new TextEncoder().encode(JSON.stringify(replay));objects.set(replayPath,replayBytes);
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('model-artifacts',$1,$2)",[replayPath,{size:replayBytes.length}]);
 assert.equal((await db.query('select model_finish($1,$2,$3,$4,$5,$6,$7,$8) as value',[id,claim.claim_token,{score:42},123,'fixture','test',null,{public_replays:[{run_id:0,scenario:'demo_descent',score:42,success:true,duration:0}]}])).rows[0].value,true);
 const getReplay=(cookie,exercise='nn-rocket',run='0')=>handler(new Request(`https://db.example/functions/v1/model-submissions?action=replay&exercise=${exercise}&id=${id}&run=${run}`,{headers:{origin:'https://site.example',cookie}}));
 r=await getReplay(a);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),replay);
 assert.equal((await getReplay(b)).status,404);assert.equal((await getReplay(a,'another-exercise')).status,404);
 assert.equal((await getReplay(a,'nn-rocket','../0')).status,400);assert.equal((await getReplay(a,'nn-rocket','1')).status,404);
 const dashboard=async(cookie,exercise)=>(await (await invoke('dashboard',{cookie,exercise})).json());
 assert.equal((await dashboard(a)).submissions[0].metrics.score,42);assert.equal((await dashboard(b)).submissions.some(s=>s.id===id),false);
 assert.equal((await post('publish',b,{id})).status,409);assert.equal((await post('publish',a,{id})).status,200);
 const other=await dashboard(b);assert.equal(other.leaderboard[0].score,42);assert.equal(other.leaderboard[0].is_current,false);assert.equal(other.submissions.some(s=>s.id===id),false);
 assert.equal((await post('publish',b,{id:null})).status,200);assert.equal((await dashboard(a)).leaderboard[0].is_current,true);
 assert.equal((await post('publish',a,{id:null})).status,200);assert.equal((await dashboard(b)).leaderboard.length,0);
 // The same participant can work across exercises, but cannot publish an attempt under another exercise.
 await db.exec("delete from model_rate_events; insert into model_exercises(id,primary_metric,higher_is_better,model_max_bytes,weights_max_bytes,concurrent_limit) values('second-practical','loss',false,131072,20971520,2)");
 assert.equal((await dashboard(a,'second-practical')).submissions.length,0);assert.equal((await dashboard(a,'second-practical')).config.primary_metric,'loss');
 assert.equal((await post('publish',a,{id},'second-practical')).status,409);
 const secondResponse=await post('create',a,{},'second-practical');assert.equal(secondResponse.status,200);const second=(await secondResponse.json()).id;
 for(const file of ['model.py','weights.safetensors'])assert.equal((await invoke('upload',{cookie:a,exercise:'second-practical',method:'POST',id:second,file,body:'data'})).status,200);
 assert.equal((await post('queue',a,{id:second},'second-practical')).status,200);
 const job=(await db.query("select model_claim('second-practical') value")).rows[0].value;assert.equal(job.submission_id,second);
 assert.equal((await db.query('select model_finish($1,$2,$3,$4,$5,$6,$7) value',[second,job.claim_token,{loss:0.3},10,'v',null,null])).rows[0].value,true);
 assert.equal((await post('publish',a,{id:second},'second-practical')).status,200);
 assert.equal((await dashboard(a,'second-practical')).leaderboard[0].score,0.3);assert.equal((await dashboard(a)).leaderboard.length,0);
 assert.equal((await dashboard(a)).submissions.some(s=>s.id===second),false);assert.equal((await dashboard(a,'second-practical')).submissions.some(s=>s.id===id),false);
 assert.equal((await invoke('dashboard',{cookie:a,exercise:'../invalid'})).status,400);
 console.log('Model submissions gateway/database integration tests passed');
} finally {await db.close();}
