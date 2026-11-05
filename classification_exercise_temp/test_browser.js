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
  await waitFor(()=>evaluate("record && view"),'initial flight');
  assert.equal(await evaluate('document.title'), 'Practical Exercise 2 - Rocket Control');
  assert.equal(await evaluate("$('clock').textContent"), '0.00 s');
  for (const id of ['axes','centres','pressure','aeroVector','telemetry','notes','start']) {
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}` + ')'), null, `${id} should be absent`);
  }
  await evaluate("$('begin').click()");
  await waitFor(()=>evaluate('replayMode'), 'replay mode');
  assert.equal(await evaluate('frame'), 0);
  await evaluate("$('live').click()");
  assert.equal(await evaluate('replayMode'), false);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(300);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'), 'mobile horizontal overflow');
  console.log('Chrome verified the simplified renderer and replay controls.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(socket)socket.close();if(chrome)chrome.kill();});
