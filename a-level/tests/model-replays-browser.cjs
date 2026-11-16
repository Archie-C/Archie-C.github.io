const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

(async()=>{
 const executablePath=process.env.MODEL_TEST_BROWSER || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 const browser=await chromium.launch({headless:true,executablePath});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>{if(errors.length<20)errors.push(error.message);});
  const topics=path.resolve(__dirname,'../../courses/deep-learning-aau/topics');
  const recording=JSON.parse(fs.readFileSync(path.join(topics,'02-classification/exercises/practical-exercise/expert_replays/run_0.json'),'utf8'));
  let replayReads=0,deny=false;
  await page.route('**/functions/v1/model-submissions**',async route=>{
   const action=new URL(route.request().url()).searchParams.get('action');
   const headers={'access-control-allow-origin':'null','access-control-allow-credentials':'true'};
   if(action==='replay'){
    replayReads++;
    return route.fulfill({status:deny?404:200,headers,contentType:'application/json',body:JSON.stringify(deny?{error:'Recording unavailable'}:recording)});
   }
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({identity_new:false,name:'Pilot',config:{primary_metric:'score'},leaderboard:[],submissions:[{
    id:'22222222-2222-4222-8222-222222222222',status:'completed',metrics:{score:82},created_at:'2026-11-01T12:00:00Z',
    runs:[{run_id:0,scenario:'demo_descent',score:90,success:true,duration:1,replay_available:true}]
   }]})});
  });
  await page.goto(pathToFileURL(path.join(topics,'03-neural-networks/exercises/practical-exercise/index.html')).href);
  await page.locator('.model-attempt summary').click();
  assert.equal(replayReads,0,'Recordings are fetched only on demand');
  await page.getByRole('button',{name:'View flight',exact:true}).click();
  await page.locator('#replay-view').waitFor({state:'visible'});
  assert.equal(replayReads,1);
  await page.locator('#replay').click();
  await page.waitForFunction(()=>!document.querySelector('#replaytime').textContent.startsWith('0.00 /'));
  await page.locator('#replay').click();
  await page.locator('#terminal').click();
  assert.equal(await page.locator('#timeline').inputValue(),String(recording.snapshots.length-1));
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download JSON',exact:true}).click();
  const download=await downloadEvent;
  assert.equal(fs.readFileSync(await download.path(),'utf8'),JSON.stringify(recording));
  assert.match(download.suggestedFilename(),/run-0\.json$/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#model-flight').screenshot({path:path.join(os.tmpdir(),'model-replay-preview.png')});
  deny=true;
  await page.getByRole('button',{name:'View flight',exact:true}).click();
  await page.locator('#model-message').filter({hasText:'Recording unavailable'}).waitFor();
  await page.route('**/functions/v1/score-rocket**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"leaderboard":[]}'}));
  await page.goto(pathToFileURL(path.join(topics,'02-classification/exercises/practical-exercise/index.html')).href);
  await page.locator('#import').setInputFiles(path.join(topics,'02-classification/exercises/practical-exercise/expert_replays/run_0.json'));
  await page.locator('#replay-view').waitFor({state:'visible'});
  await page.locator('#terminal').click();
  assert.equal(await page.locator('#timeline').inputValue(),String(recording.snapshots.length-1));
  assert.deepEqual(errors,[]);
  console.log('Lazy owner replay loading, playback, JSON download, errors, mobile layout and shared classification viewer passed');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
