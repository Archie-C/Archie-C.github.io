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
  await waitFor(()=>evaluate("document.getElementById('status')?.textContent==='ready'"),'ready');
  const screenshot=async name=>{const {data}=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(os.tmpdir(),name),Buffer.from(data,'base64'));};
  await screenshot('rocket-desktop.png');
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
  let end=await evaluate('record.snapshots.length-1');assert.ok(end>2);
  assert.equal(await evaluate(`(()=>{const saved=JSON.parse(JSON.stringify(record));setRecord(saved);return record.snapshots.length})()`),end+1);
  assert.equal(await evaluate(`(()=>{let before=record;try{setRecord({schema:'bad'})}catch(_){}return before===record})()`),true);

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
  await call('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:2,mobile:false});
  await sleep(300);assert.equal(await evaluate('canvas.width'),await evaluate('Math.round(canvas.clientWidth*devicePixelRatio)'));
  assert.ok(await evaluate('canvas.clientWidth>400 && canvas.clientHeight>300'));
  await screenshot('rocket-hidpi.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(300);assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),'mobile horizontal overflow');
  await screenshot('rocket-mobile.png');
  console.log('Chrome verified commands, live/pause, replay, contact, responsive layout and high DPI. Screenshots: '+os.tmpdir());
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(socket)socket.close();if(chrome)chrome.kill();});
