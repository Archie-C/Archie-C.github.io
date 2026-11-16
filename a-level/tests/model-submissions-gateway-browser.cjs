const {chromium}=require('playwright');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const gateway=(await import(pathToFileURL(path.resolve(__dirname,'../../supabase/model-submissions/same-origin-gateway.mjs')))).default;
 const file=path.resolve(__dirname,'../../courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise');
 let html=await readFile(path.join(file,'index.html'),'utf8');html=html.replace('<head>','<head><meta name="model-submission-endpoint" content="/api/model-submissions"><meta name="model-submission-exercise" content="second-practical">');
 const client=await readFile(path.join(file,'model-submissions.js'),'utf8');
 const replayClient=await readFile(path.resolve(file,'../../../../rocket-replay.js'),'utf8');
 const env={SITE_ORIGIN:'https://learn.example',MODEL_FUNCTION_URL:'https://db.example/functions/v1/model-submissions'};
 const cookiesSeen=[];let nextIdentity=0;
 globalThis.fetch=async(url,opts)=>{
  assert.equal(new URL(url).searchParams.get('exercise'),'second-practical');const value=opts.headers.get('cookie')||'';cookiesSeen.push(value);assert.equal(opts.headers.get('origin'),'https://learn.example');
  if(new URL(url).searchParams.get('action')==='name')return Response.json({ok:true});
  const identityCookie=value.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-model_participant='));const hasCookie=Boolean(identityCookie);const identity=hasCookie?identityCookie.slice('__Host-model_participant='.length):String(++nextIdentity).padStart(64,'0');
  const body={identity_new:!hasCookie,name:'Browser '+identity.slice(-1),config:{primary_metric:'score',model_max_bytes:131072,weights_max_bytes:20971520},submissions:[],leaderboard:[]};
  return Response.json(body,{headers:{'set-cookie':`__Host-model_participant=${identity}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=None; Partitioned`}});
 };
 const executablePath=process.env.MODEL_TEST_BROWSER||(require('node:fs').existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 const fs=require('node:fs'),os=require('node:os');const tempRoot=fs.realpathSync(os.tmpdir());
 const profileA=fs.mkdtempSync(path.join(tempRoot,'model-profile-'));const profileB=fs.mkdtempSync(path.join(tempRoot,'model-profile-'));
 let first,restored,second;
 async function install(context){await context.route('https://learn.example/**',async route=>{
  const rq=route.request(),url=new URL(rq.url());
  if(url.pathname==='/practical/')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/rocket-replay.js')return route.fulfill({contentType:'application/javascript',body:replayClient});
  if(url.pathname==='/practical/model-submissions.js')return route.fulfill({contentType:'application/javascript',body:client});
  if(url.pathname==='/api/model-submissions'){
   const init={method:rq.method(),headers:rq.headers()};const data=rq.postDataBuffer();if(data)init.body=data;
   const result=await gateway.fetch(new Request(rq.url(),init),env);
   return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});
  }
  return route.fulfill({status:200,contentType:'text/plain',body:''});
 });}
 try{
  first=await chromium.launchPersistentContext(profileA,{headless:true,executablePath});await install(first);const p=await first.newPage();await p.goto('https://learn.example/practical/',{waitUntil:'domcontentloaded'});await p.getByText('No attempts yet.').waitFor();assert.equal(await p.locator('#model-name').inputValue(),'Browser 1');await p.locator('#model-name').fill('Example');await p.getByRole('button',{name:'Save name'}).click();await p.getByText('Display name saved.').waitFor();
  await first.addCookies([{name:'restart_control',value:'fixture',url:'https://learn.example',expires:Math.floor(Date.now()/1000)+3600}]);const state=await first.storageState();const firstCookie=(await first.cookies()).find(x=>x.name==='__Host-model_participant');assert.ok(firstCookie&&firstCookie.httpOnly&&firstCookie.expires>0);await first.close();first=null;
  restored=await chromium.launchPersistentContext(profileA,{headless:true,executablePath});const persisted=await restored.cookies();if(!persisted.some(c=>c.name==='restart_control')){console.warn('SKIP browser restart persistence: the browser also lost an unrelated control cookie; testing explicit cookie restoration instead.');await restored.addCookies(state.cookies);}else assert.ok(persisted.some(c=>c.name==='__Host-model_participant' && c.value===firstCookie.value),'The participant cookie must persist across restart');await install(restored);const q=await restored.newPage();await q.goto('https://learn.example/practical/',{waitUntil:'domcontentloaded'});await q.getByText('No attempts yet.').waitFor();assert.equal(await q.locator('#model-name').inputValue(),'Browser 1');
  second=await chromium.launchPersistentContext(profileB,{headless:true,executablePath});await install(second);const t=await second.newPage();await t.goto('https://learn.example/practical/',{waitUntil:'domcontentloaded'});await t.getByText('No attempts yet.').waitFor();assert.equal(await t.locator('#model-name').inputValue(),'Browser 2');assert.notEqual((await second.cookies())[0].value,firstCookie.value);
  assert.ok(cookiesSeen.some(v=>v.includes(firstCookie.value)));
  await restored.close();restored=null;await second.close();second=null;console.log('Same-origin gateway browser identity tests passed');
 }finally{for(const context of [first,restored,second])if(context)await context.close();for(const dir of [profileA,profileB]){const resolved=fs.realpathSync(dir);if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('model-profile-'))throw Error('Unexpected temporary profile path');fs.rmSync(resolved,{recursive:true,force:true});}}
})().catch(e=>{console.error(e);process.exitCode=1;});

