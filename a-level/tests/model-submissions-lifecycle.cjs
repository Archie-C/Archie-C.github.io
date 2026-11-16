// Browser, both Edge handlers and SQL together; only Supabase HTTP/storage is simulated.
const {chromium}=require('playwright'),{PGlite}=require('@electric-sql/pglite');
const {readFile}=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let browser;
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security;`);
  const root=path.resolve(__dirname,'../..');
  await db.exec((await readFile(path.join(root,'supabase/model-submissions/setup.sql'),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;',''));
  const handlers=[],workerToken='9'.repeat(64);
  globalThis.EdgeRuntime={waitUntil:promise=>{void promise;}};
 globalThis.Deno={env:{get:key=>({MODEL_SITE_ORIGIN:'https://learn.example',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server-key',MODEL_WORKER_TOKEN:workerToken})[key]},serve:fn=>handlers.push(fn)};
  await import(pathToFileURL(path.join(root,'supabase/functions/model-submissions/index.ts')));
  await import(pathToFileURL(path.join(root,'supabase/functions/model-worker/index.ts')));
  const [student,worker]=handlers,gateway=(await import(pathToFileURL(path.join(root,'supabase/model-submissions/same-origin-gateway.mjs')))).default;
  const objects=new Map(),env={SITE_ORIGIN:'https://learn.example',MODEL_FUNCTION_URL:'https://db.example/functions/v1/model-submissions'};
  globalThis.fetch=async(input,options)=>{
   const url=new URL(input);
   if(url.pathname==='/functions/v1/model-submissions')return student(new Request(url,{...options,duplex:'half'}));
   const h=new Headers(options.headers);assert.equal(h.get('apikey'),'server-key');
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const fn=url.pathname.split('/').pop(),args=Object.values(JSON.parse(options.body));assert.match(fn,/^model_[a-z_]+$/);
    try{const result=await db.query(`select ${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) value`,args);return Response.json(result.rows[0].value);}
    catch(e){return Response.json({message:e.message},{status:400});}
   }
   const upload='/storage/v1/object/model-artifacts/',download='/storage/v1/object/authenticated/model-artifacts/';
   if(url.pathname.startsWith(upload)){
    const name=decodeURIComponent(url.pathname.slice(upload.length));if(objects.has(name))return Response.json({error:'exists'},{status:409});
    const bytes=new Uint8Array(options.body);objects.set(name,bytes);await db.query("insert into storage.objects(bucket_id,name,metadata) values('model-artifacts',$1,$2)",[name,{size:bytes.length}]);return Response.json({ok:true});
   }
   if(url.pathname.startsWith(download)){
    const name=decodeURIComponent(url.pathname.slice(download.length));return objects.has(name)?new Response(objects.get(name)):new Response(null,{status:404});
   }
   throw Error(`Unexpected URL ${url}`);
  };
  const file=path.join(root,'courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise');
  const html=(await readFile(path.join(file,'index.html'),'utf8')).replace('<head>','<head><meta name="model-submission-endpoint" content="/api/model-submissions">');
  const client=await readFile(path.join(file,'model-submissions.js'),'utf8');
 const replayClient=await readFile(path.resolve(file,'../../../../rocket-replay.js'),'utf8');
  const recording=JSON.parse(await readFile(path.join(root,'courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise/expert_replays/run_0.json'),'utf8'));
  const executablePath=process.env.MODEL_TEST_BROWSER||(require('node:fs').existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  browser=await chromium.launch({headless:true,executablePath});
  async function installRoutes(context){await context.route('https://learn.example/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/practical/')return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/rocket-replay.js')return route.fulfill({contentType:'application/javascript',body:replayClient});
  if(url.pathname==='/practical/model-submissions.js')return route.fulfill({contentType:'application/javascript',body:client});
   if(url.pathname==='/api/model-submissions'){
    const init={method:request.method(),headers:request.headers()},body=request.postDataBuffer();if(body)init.body=body;
    const response=await gateway.fetch(new Request(request.url(),init),env);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   }
   return route.fulfill({status:200,contentType:'text/plain',body:''});
  });}
  const context=await browser.newContext();await installRoutes(context);
  const page=await context.newPage();await page.goto('https://learn.example/practical/',{waitUntil:'domcontentloaded'});await page.getByText('No attempts yet.').waitFor();
  await page.locator('#model-name').fill('Student');await page.getByRole('button',{name:'Save name'}).click();await page.getByText('Display name saved.').waitFor();
  const submit=async()=>{await page.locator('#model-python').setInputFiles({name:'model.py',mimeType:'text/x-python',buffer:Buffer.from('architecture')});await page.locator('#model-weights').setInputFiles({name:'weights.safetensors',mimeType:'application/octet-stream',buffer:Buffer.from('weights')});await page.getByRole('button',{name:'Submit for evaluation'}).click();await page.getByText('Upload complete. Your attempt is queued.').waitFor();};
  const work=async(score)=>{
   const call=async(action,data)=>worker(new Request(`https://db.example/functions/v1/model-worker?action=${action}`,{method:'POST',headers:{authorization:`Bearer ${workerToken}`,'content-type':'application/json'},body:JSON.stringify(data)}));
   const claimed=await (await call('claim',{exercise:'nn-rocket'})).json(),job=claimed.claim;assert.ok(job);
   const args={submission_id:job.submission_id,claim_token:job.claim_token};assert.equal(await (await call('artifact',{...args,file:'model.py'})).text(),'architecture');assert.equal(await (await call('artifact',{...args,file:'weights.safetensors'})).text(),'weights');
   assert.equal((await (await call('replay',{...args,run_id:1,replay:recording})).json()).uploaded,true);
   assert.equal((await (await call('finish',{...args,metrics:{score},duration_ms:150,evaluator_version:'fixture',metadata:{public_replays:[{run_id:1,scenario:'centred_descent',score,success:true,duration:recording.snapshots.at(-1).time}]}})).json()).accepted,true);return job;
  };
  await submit();const first=await work(42);await page.locator('.model-attempt summary').filter({hasText:'completed'}).waitFor({timeout:20000});await page.locator('.model-attempt summary').first().click();
  await page.getByRole('button',{name:'View flight',exact:true}).click();await page.locator('#replay-view').waitFor({state:'visible'});
  await page.locator('#terminal').click();assert.equal(await page.locator('#timeline').inputValue(),String(recording.snapshots.length-1));
  await page.getByRole('button',{name:'Publish this attempt'}).click();await page.getByText('Attempt published.').waitFor();
  const other=await browser.newContext();await installRoutes(other);const otherPage=await other.newPage();await otherPage.goto('https://learn.example/practical/',{waitUntil:'domcontentloaded'});await otherPage.getByText('No attempts yet.').waitFor();assert.match(await otherPage.locator('#model-leaderboard').innerText(),/42/);await otherPage.locator('#model-name').fill('Other');await otherPage.getByRole('button',{name:'Save name'}).click();await otherPage.getByText('Display name saved.').waitFor();
  const attackStatus=await otherPage.evaluate(async id=>(await fetch('/api/model-submissions?action=publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})})).status,first.submission_id);assert.equal(attackStatus,409);assert.equal(await otherPage.locator('.model-attempt').count(),0);
  const replayAttack=await otherPage.evaluate(async id=>(await fetch(`/api/model-submissions?action=replay&exercise=nn-rocket&id=${id}&run=1`)).status,first.submission_id);assert.equal(replayAttack,404);await other.close();
  await submit();const second=await work(75);assert.notEqual(first.submission_id,second.submission_id);
  await page.locator('.model-attempt summary').filter({hasText:'completed'}).nth(1).waitFor({timeout:20000});assert.equal(await page.locator('#model-leaderboard tr').count(),1);assert.match(await page.locator('#model-leaderboard').innerText(),/42/);
  await page.locator('.model-attempt summary').first().click();await page.getByRole('button',{name:'Publish this attempt'}).click();await page.getByText('Attempt published.').waitFor();assert.match(await page.locator('#model-leaderboard').innerText(),/75/);
  const state=await context.storageState();await context.close();const restored=await browser.newContext({storageState:state});assert.ok((await restored.cookies()).some(c=>c.httpOnly&&c.name==='__Host-model_participant'));await restored.close();
  console.log('Browser-to-worker submission lifecycle test passed');
 } finally {if(browser)await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
