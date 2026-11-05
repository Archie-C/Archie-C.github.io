// Optional end-to-end browser check. Start rocket_server.py first and set
// CHROME_PATH to a Chrome/Chromium executable. No third-party packages needed.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chromePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'chromium');
const root = process.env.ROCKET_URL || 'http://127.0.0.1:8765';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rocket-chrome-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, socket;
async function waitFor(fn, label, timeout=10000) {
  const end = Date.now()+timeout;
  let last;
  while (Date.now()<end) { try { last=await fn(); if(last)return last; } catch (_) {} await sleep(100); }
  throw Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)}`);
}
(async () => {
  chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-extensions','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  const portFile=path.join(profile,'DevToolsActivePort');
  const port=await waitFor(()=>fs.existsSync(portFile)&&fs.readFileSync(portFile,'utf8').split('\n')[0], 'Chrome debugging port');
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(root)}`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id && pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  try{await waitFor(()=>evaluate("document.getElementById('status')?.textContent==='ready'"),'ready');}catch(error){console.error('Page state:',await evaluate("({url:location.href,status:document.getElementById('status')?.textContent,message:document.getElementById('message')?.textContent,title:document.title})"));throw error;}
  const screenshot=async name=>{const {data}=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(os.tmpdir(),name),Buffer.from(data,'base64'));};
  await screenshot('rocket-desktop.png');
  // Exercise actual pointer input rather than setting control values in script.
  async function pointerClick(selector, fraction=.5){
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width*${fraction},y:r.top+r.height/2}})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  }
  await pointerClick('#throttle',.2);
  const slider=await evaluate(`(()=>{const r=$('throttle').getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:slider.left+(slider.right-slider.left)*.2,y:slider.y});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:slider.left+(slider.right-slider.left)*.2,y:slider.y,button:'left',buttons:1,clickCount:1});
  for(const fraction of [.3,.4,.6,.8]){
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:slider.left+(slider.right-slider.left)*fraction,y:slider.y,button:'left',buttons:1});
    await sleep(250);
  }
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:slider.left+(slider.right-slider.left)*.8,y:slider.y,button:'left',buttons:0,clickCount:1});
  await waitFor(()=>evaluate("+$('throttle').value>.7 && liveRecord.pending_commands.some(c=>c.throttle>.7)"),'pointer throttle');
  await pointerClick('#gimbal',.8);
  await waitFor(()=>evaluate("+$('gimbal').value>.4 && liveRecord.pending_commands.some(c=>c.gimbal>.4)"),'pointer gimbal');
  await pointerClick('#start');
  await waitFor(()=>evaluate("record.status==='running' && view.state.thrust>0 && view.state.gimbal>0"),'pointer start and actuators');
  // Real keyboard events must work after a button click, without canvas focus.
  await evaluate("$('pause').focus()");
  const beforeKeyThrottle=await evaluate("+$('throttle').value");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  assert.ok(await evaluate("+$('throttle').value")>beforeKeyThrottle,'ArrowUp must adjust throttle after button focus');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal 1.00')"),'keyboard gimbal after button focus');
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal 0.00')"),'keyboard gimbal release');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor(()=>evaluate("record.status==='paused'"),'space pauses after button focus');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor(()=>evaluate("record.status==='running'"),'space resumes');
  await evaluate("$('throttle').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal -1.00')"),'keyboard gimbal while slider is focused');
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal 0.00')"),'slider-focused steering release');
  assert.equal(await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});$('speed').dispatchEvent(e);return e.defaultPrevented})()`),false,'select menus retain their arrow keys');
  await pointerClick('#throttle',.25);await pointerClick('#gimbal',.2);
  await waitFor(()=>evaluate("record.status==='running' && liveRecord.snapshots.at(-1).command.throttle<.35 && liveRecord.snapshots.at(-1).command.gimbal<-.4 && liveRecord.snapshots.at(-1).state.gimbal<0"),'live pointer commands and actuator response');
  await pointerClick('#pause');
  await waitFor(()=>evaluate("record.status==='paused'"),'pointer pause');
  const pointerRun=await evaluate('liveId');await pointerClick('#reset');
  await waitFor(()=>evaluate(`liveId!==${JSON.stringify(pointerRun)} && record?.status==='ready'`),'pointer reset');
  const initialCamera=await evaluate('({...camera})');
  const zoomPixels=await evaluate(`(()=>{const q=screen([view.state.x,view.state.y]),r=canvas.getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+q[0],clientY:r.top+q[1],deltaY:-350,cancelable:true}));return {before:q,after:screen([view.state.x,view.state.y])}})()`);
  assert.ok(await evaluate('camera.scale')>initialCamera.scale,'wheel must zoom');
  assert.ok(Math.abs(zoomPixels.before[0]-zoomPixels.after[0])<1 && Math.abs(zoomPixels.before[1]-zoomPixels.after[1])<1,'zoom should preserve the point under the pointer');
  await screenshot('rocket-zoom.png');
  await evaluate(`canvas.setPointerCapture=()=>{};canvas.onpointerdown({clientX:50,clientY:50,pointerId:1});canvas.onpointermove({clientX:75,clientY:60});canvas.onpointerup()`);
  assert.notEqual(await evaluate('camera.x'),initialCamera.x,'drag must pan');
  await evaluate("$('camera').click()");assert.equal(await evaluate('camera.auto'),true);
  await evaluate("desired={throttle:3,gimbal:0};sendDesired()");
  await waitFor(()=>evaluate("$('message').textContent.includes('Command rejected')"),'invalid-command error');
  await sleep(500);assert.ok(await evaluate("$('message').textContent.includes('Command rejected')"),'error must remain inspectable');
  assert.equal(await evaluate(`canvas.focus(); const keyEvent=new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}); canvas.dispatchEvent(keyEvent); keyEvent.defaultPrevented`),true);
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal 1.00')"),'keyboard steering');
  await evaluate("canvas.blur()");
  await waitFor(()=>evaluate("$('accepted').textContent.includes('gimbal 0.00')"),'steering release on blur');
  await evaluate(`$('throttle').value='.3';$('throttle').dispatchEvent(new Event('input'));$('throttle').value='.6';$('throttle').dispatchEvent(new Event('input'));`);
  await waitFor(()=>evaluate("$('accepted').textContent.includes('0.60')"),'last command acknowledgement');
  await evaluate("$('start').click()");
  await waitFor(()=>evaluate("record.status==='running' && view.time>.4"),'live stepping');
  assert.ok(await evaluate('view.state.thrust>0 && view.state.thrust<record.config.parameters.max_thrust'));
  await evaluate("$('pause').click()");
  await waitFor(()=>evaluate("record.status==='paused'"),'pause');
  let t=await evaluate('view.time');await sleep(500);assert.equal(await evaluate('view.time'),t,'pause must freeze simulation');
  await call('Page.reload');
  await waitFor(()=>evaluate("record?.status==='paused' && $('throttle').value==='0.6'"),'reconnected control state');
  // Entering replay during flight captures the final acknowledged pause frame.
  await evaluate("$('start').click()");
  await waitFor(()=>evaluate("record.status==='running'"),'resume before replay');
  await evaluate("$('begin').click()");
  await waitFor(()=>evaluate("replayMode && record.status==='paused' && !replayFollowsLive"),'replay pause');
  assert.equal(await evaluate('record.snapshots.length'),await evaluate('liveRecord.snapshots.length'));
  assert.equal(await evaluate("$('controlLive').hidden"),false);
  await evaluate("$('controlLive').click();$('start').click()");
  await waitFor(()=>evaluate("record.status==='running'"),'resume before disconnect');
  // A lost transport must visibly disconnect, then resume into a paused run.
  await evaluate("window.savedFetch=window.fetch;window.fetch=()=>Promise.reject(new Error('test disconnect'))");
  await waitFor(()=>evaluate("$('status').textContent==='Disconnected'"),'disconnect notice');
  await sleep(2500);
  await evaluate("window.fetch=window.savedFetch");
  await waitFor(()=>evaluate("record.status==='paused' && $('message').textContent.includes('Connection lost')"),'heartbeat pause');
  let end=await evaluate('record.snapshots.length-1');assert.ok(end>2);
  assert.equal(await evaluate(`(async()=>{const saved=JSON.parse(JSON.stringify(record));await setRecord(saved);return record.snapshots.length})()`),end+1);
  assert.equal(await evaluate(`(async()=>{let before=record;try{await setRecord({schema:'bad'})}catch(_){}return before===record})()`),true);

  await evaluate("$('begin').click()");assert.equal(await evaluate('view.time'),0);
  await evaluate("$('forward').click()");assert.equal(await evaluate('view.time'),0);assert.equal(await evaluate('view.command.throttle'),.6);
  await evaluate("$('forward').click()");assert.ok(await evaluate('view.time>0'));
  await evaluate("$('terminal').click()");assert.equal(await evaluate('frame'),end);
  await evaluate("$('back').click();$('forward').click()");assert.equal(await evaluate('frame'),end);
  await evaluate("$('live').click();$('speed').value='5';$('speed').dispatchEvent(new Event('change'));");
  await sleep(300);await evaluate("$('start').click()");
  // The selected throttle may lift the rocket, so command off to ensure contact.
  await evaluate("$('throttle').value='0';$('throttle').dispatchEvent(new Event('input'));");
  await waitFor(()=>evaluate("record.status==='contact'"),'contact',20000);
  assert.equal(await evaluate('view.time'),await evaluate('record.terminal.time'));
  assert.deepEqual(await evaluate('view.state'),await evaluate('record.terminal.state'));
  await screenshot('rocket-contact.png');
  assert.equal(await evaluate(`(async()=>{const indexes=[0,Math.floor(record.snapshots.length/3),record.snapshots.length-1,1,Math.floor(record.snapshots.length/2),record.snapshots.length-1];const before=JSON.stringify(record);for(const i of indexes){await seek(i);const p=record.snapshots[i];if(view!==p||!$('telemetry').textContent.includes(fmt(p.state.x))||view.command.throttle!==p.command.throttle)return false;}return JSON.stringify(record)===before})()`),true,'replay seek must preserve exact snapshots and commands');
  await call('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:2,mobile:false});
  await sleep(300);assert.equal(await evaluate('canvas.width'),await evaluate('Math.round(canvas.clientWidth*devicePixelRatio)'));
  assert.ok(await evaluate('canvas.clientWidth>400 && canvas.clientHeight>300'));
  await screenshot('rocket-hidpi.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(300);assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),'mobile horizontal overflow');
  await screenshot('rocket-mobile.png');
  // Exercise seeking and bounded trail drawing with a substantial recording.
  const longLoad=await evaluate(`(async()=>{const source=record;const base=source.snapshots[0];const frames=Array.from({length:20000},(_,i)=>({...base,sequence:i,time:i*.02}));const long={...source,status:'paused',terminal:null,commands:[],pending_commands:[],snapshots:frames};const started=performance.now();await setRecord(long);await seek(19999);return performance.now()-started})()`);
  assert.equal(await evaluate('frame'),19999);
  assert.equal(await evaluate('record.snapshots.length'),20000);
  const frameTimes=await evaluate(`new Promise(resolve=>{let times=[],last=0;function tick(t){if(last)times.push(t-last);last=t;if(times.length===30)resolve(times);else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`);
  const median=frameTimes.slice().sort((a,b)=>a-b)[15];
  assert.ok(median<80,`long-recording median frame interval: ${median} ms`);
  console.log(`20,000-frame recording loaded in ${longLoad.toFixed(0)} ms; median frame interval ${median.toFixed(1)} ms`);
  // Replay a pre-scheduled flight while the browser paints at different rates.
  // Paint scheduling is replaced only in the page; the Python stepper is unchanged.
  let baseline;
  for(const fps of [30,60,120]){
    const previous=await evaluate('liveId');
    await evaluate(`window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),${1000/fps});$('reset').click()`);
    await waitFor(()=>evaluate(`liveId!==${JSON.stringify(previous)} && record?.status==='ready'`),'fresh flight');
    await evaluate(`(async()=>{for(const [i,action] of [1,5,0,9,0].entries())await post('/api/command',{run_id:liveId,command_sequence:i+1,action,effective_time:i*.2});await post('/api/control',{run_id:liveId,operation:'speed',speed:5});await post('/api/control',{run_id:liveId,operation:'start'});})()`);
    await waitFor(()=>evaluate("liveRecord.status==='contact'"),`contact at ${fps} fps`,20000);
    const flight=await evaluate(`({states:liveRecord.snapshots.map(p=>({time:p.time,state:p.state,command:p.command})),event:{time:liveRecord.terminal.time,point:liveRecord.terminal.point,state:liveRecord.terminal.state}})`);
    if(baseline)assert.deepEqual(flight,baseline,`trajectory changed at ${fps} fps`);else baseline=flight;
  }
  console.log('Scheduled flight matched exactly at 30, 60 and 120 paint callbacks per second.');
  const oldId=await evaluate('record.config.run_id');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate("$('start').scrollIntoView({block:'center'})");
  assert.equal(await evaluate("$('start').textContent"),'New flight');
  assert.equal(await evaluate("$('start').disabled"),false);
  await pointerClick('#start');
  await waitFor(()=>evaluate(`record?.config.run_id!==${JSON.stringify(oldId)} && record.status==='ready'`),'new flight after contact');
  assert.equal(await evaluate('view.time'),0);assert.equal(await evaluate('record.snapshots.length'),1);
  assert.equal(await evaluate("$('throttle').disabled"),false);
  console.log('Chrome verified commands, live/pause, replay, contact, responsive layout and high DPI. Screenshots: '+os.tmpdir());
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(socket)socket.close();if(chrome)chrome.kill();});
