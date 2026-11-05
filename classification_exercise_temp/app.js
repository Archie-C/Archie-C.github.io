'use strict';
// Geometry is a display transform only; centre of mass comes from the adapter.
const $ = id => document.getElementById(id);
const canvas=$('scene'), ctx=canvas.getContext('2d');
const stateKeys=['x','y','vx','vy','theta','omega','fuel','thrust','gimbal'];
let record=null, liveRecord=null, view=null, replayMode=false, replayFollowsLive=false, playing=false, frame=0, lastFrame=0, seq=0;
let camera={x:0,y:25,scale:5,auto:true}, dragging=null, connected=false, sending=false, desired=null;
let lastPacket=-1, liveId=null, liveArrival=0, renderWindow=null, lag=0, replayClock=0, polling=false, resetting=false, generation=0, actionsConfig=null, localNotice='', visualQuality=1, slowFrames=0, fastFrames=0, lastPaint=0;
const fmt=(n,d=2)=>Number(n).toFixed(d);
function bodyPoint(point,s,c){const x=point[0]-c[0], y=point[1]-c[1], a=s.theta;return [s.x+x*Math.cos(a)-y*Math.sin(a),s.y+x*Math.sin(a)+y*Math.cos(a)];}
function thrustDirection(theta,gimbal){return [-Math.sin(theta+gimbal),Math.cos(theta+gimbal)];}
function nozzleDirection(theta,gimbal){return [Math.sin(theta+gimbal),-Math.cos(theta+gimbal)];}
function terrainHeight(terrain,x){
 if(x<=terrain[0][0])return terrain[0][1];
 for(let i=1;i<terrain.length;i++){let a=terrain[i-1],b=terrain[i];if(x<=b[0])return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);}
 return terrain.at(-1)[1];
}
function screen(point){return [canvas.clientWidth/2+(point[0]-camera.x)*camera.scale,canvas.clientHeight/2-(point[1]-camera.y)*camera.scale];}
// Use the engine's clearance and a conservative bound on rigid-body motion to
// avoid interpolating a pose that might cross the piecewise-linear terrain.
function interpolationSafe(a,b,p){
 if(a.contact||b.contact||!Number.isFinite(a.diagnostics?.clearance)||!Number.isFinite(b.diagnostics?.clearance))return false;
 if(a.command.throttle!==b.command.throttle||a.command.gimbal!==b.command.gimbal||a.command.action!==b.command.action)return false;
 let slope=0;for(let i=1;i<p.terrain.length;i++)slope=Math.max(slope,Math.abs((p.terrain[i][1]-p.terrain[i-1][1])/(p.terrain[i][0]-p.terrain[i-1][0])));
 let radius=0;for(const q of [...p.hull,...p.feet])for(const c of [a.centre,b.centre])radius=Math.max(radius,Math.hypot(q[0]-c[0],q[1]-c[1]));
 const motion=Math.hypot(b.state.x-a.state.x,b.state.y-a.state.y)+radius*Math.abs(b.state.theta-a.state.theta)+Math.hypot(b.centre[0]-a.centre[0],b.centre[1]-a.centre[1]);
 return Math.min(a.diagnostics.clearance,b.diagnostics.clearance)>(1+slope)*motion;
}
function snapshotAt(snapshots,t,p){
 let lo=0,hi=snapshots.length-1;while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(snapshots[mid].time<=t)lo=mid;else hi=mid-1;}
 const a=snapshots[lo],b=snapshots[lo+1];
 if(!b||t<=a.time||b.time<=a.time||!interpolationSafe(a,b,p))return a;
 const u=Math.max(0,Math.min(1,(t-a.time)/(b.time-a.time))),state={};
 // theta is integrated as an unwrapped angle by the physics engine.
 for(const k of stateKeys)state[k]=a.state[k]+(b.state[k]-a.state[k])*u;
 return {...a,time:t,state,centre:a.centre.map((v,i)=>v+(b.centre[i]-v)*u),interpolated:true};
}
function allNumbersFinite(value){if(typeof value==='number')return Number.isFinite(value);if(value&&typeof value==='object')return Object.values(value).every(allNumbersFinite);return true;}
function validPacket(p,id){return p && allNumbersFinite(p) && p.run_id===id && Number.isInteger(p.sequence) && p.sequence>=0 && Number.isFinite(p.time) && p.time>=0 && p.state && stateKeys.every(k=>Number.isFinite(p.state[k])) && Array.isArray(p.centre) && p.centre.length===2 && p.centre.every(Number.isFinite) && p.command && Number.isFinite(p.command.throttle) && p.command.throttle>=0 && p.command.throttle<=1 && Number.isFinite(p.command.gimbal) && Math.abs(p.command.gimbal)<=1 && (p.command.action===null || (Number.isInteger(p.command.action) && p.command.action>=0 && p.command.action<=9)) && (!p.contact || (Array.isArray(p.contact.point) && p.contact.point.length===2 && p.contact.point.every(Number.isFinite))) && (!p.diagnostics || ['wind','thrust_vector','aero_force','centre_of_pressure'].every(k=>p.diagnostics[k]===undefined||p.diagnostics[k]===null||(Array.isArray(p.diagnostics[k])&&p.diagnostics[k].length===2&&p.diagnostics[k].every(Number.isFinite)))); }
function validate(r){
 // JSON cannot represent IEEE NaN or Infinity by design, but very large numeric
 // literals parse to Infinity. Reject them anywhere before using an imported run.
 let seen=0;
 function finiteTree(value,depth=0){
  if(++seen>3000000||depth>32)throw Error('Recording is too complex');
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Recording contains a non-finite value');
  if(value && typeof value==='object')for(const v of Object.values(value))finiteTree(v,depth+1);
 }
 finiteTree(r);
 if(!r||r.schema!=='rocket-run-v1'||!r.config||r.config.schema!==r.schema||typeof r.config.run_id!=='string'||!r.config.run_id||typeof r.config.physics_config!=='string'||typeof r.config.units!=='string'||!r.config.parameters||!Array.isArray(r.snapshots)||!r.snapshots.length||!Array.isArray(r.commands)||!['ready','running','paused','contact','completed','error'].includes(r.status))throw Error('Unsupported or incomplete rocket-run-v1 recording');
 const config=r.config,p=config.parameters,initial=config.initial_state;
 if(!initial||!stateKeys.every(k=>Number.isFinite(initial[k])))throw Error('Invalid initial state');
 if(!Array.isArray(config.actions)||config.actions.length!==10||!config.actions.every(c=>c&&Number.isFinite(c.throttle)&&c.throttle>=0&&c.throttle<=1&&Number.isFinite(c.gimbal)&&Math.abs(c.gimbal)<=1))throw Error('Invalid discrete-action mapping');
 if(!['hull','feet','terrain','engine'].every(k=>Array.isArray(p[k]))||p.hull.length<3||p.terrain.length<1||![...p.hull,...p.feet,...p.terrain,p.engine].every(x=>Array.isArray(x)&&x.length===2&&x.every(Number.isFinite)))throw Error('Invalid geometry');
 if(p.terrain.some((q,i)=>i>0&&q[0]<=p.terrain[i-1][0])||!['length','max_thrust','timestep','control_interval','event_tolerance'].every(k=>Number.isFinite(p[k])&&p[k]>0))throw Error('Invalid terrain or numerical settings');
 let time=-1,sequence=-1;
 for(const packet of r.snapshots){
  if(!validPacket(packet,config.run_id)||packet.sequence<=sequence||packet.time<time)throw Error('Invalid or out-of-order state packet');
  const d=packet.diagnostics;
  if(d!==undefined&&(!d||typeof d!=='object'||['wind','thrust_vector','aero_force','centre_of_pressure'].some(k=>d[k]!==undefined&&d[k]!==null&&(!Array.isArray(d[k])||d[k].length!==2||!d[k].every(Number.isFinite)))))throw Error('Invalid diagnostics');
  time=packet.time;sequence=packet.sequence;
 }
 let commandSequence=-1,commandTime=-1;
 for(const command of [...r.commands,...(r.pending_commands||[])]){
  if(!command||!Number.isInteger(command.command_sequence)||command.command_sequence<=commandSequence||!Number.isFinite(command.effective_time)||command.effective_time<commandTime||!Number.isFinite(command.throttle)||command.throttle<0||command.throttle>1||!Number.isFinite(command.gimbal)||Math.abs(command.gimbal)>1||!(command.action===null||Number.isInteger(command.action)&&command.action>=0&&command.action<=9))throw Error('Invalid command history');
  commandSequence=command.command_sequence;commandTime=command.effective_time;
 }
 if(r.terminal&&((r.terminal.run_id!==undefined&&r.terminal.run_id!==config.run_id)||!['contact','completed','error'].includes(r.terminal.type)||!Number.isFinite(r.terminal.time)||typeof r.terminal.reason!=='string'||r.terminal.type==='contact'&&(!Array.isArray(r.terminal.point)||r.terminal.point.length!==2||!r.terminal.point.every(Number.isFinite))))throw Error('Invalid terminal event');
 if(['contact','completed','error'].includes(r.status)&&(!r.terminal||r.terminal.type!==r.status))throw Error('Terminal status and event disagree');
 if(r.terminal?.type==='contact'){
  const last=r.snapshots.at(-1),event=r.terminal;
  if(!last.contact||last.time!==event.time||last.contact.time!==event.time||event.point.some((v,i)=>v!==last.contact.point[i])||!event.state||!stateKeys.every(k=>event.state[k]===last.state[k]))throw Error('Terminal contact does not match the final snapshot');
 }
 return r;
}
async function post(path,data={}){let res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let json=await res.json();if(!res.ok)throw Error(json.error||'Request failed');return json;}
function notice(s){localNotice=s||'';$('message').textContent=localNotice;}
function statusNotice(s){$('message').textContent=localNotice||(s||'');}
async function poll(){
 if(polling||resetting)return;
 polling=true;const pollGeneration=generation;
 try{
  const cursor=liveRecord ? `?run_id=${encodeURIComponent(liveRecord.config.run_id)}&after=${lastPacket}` : '';
  const response=await fetch('/api/run'+cursor,{cache:'no-store'});
  const data=await response.json();
  if(pollGeneration!==generation)return;
  if(!response.ok)throw Error(data.error||'Server returned '+response.status);
  let incoming=data.record;
  const fresh=!liveRecord, previousNewest=liveRecord?.snapshots.at(-1);
  if(!liveRecord){
   validate(incoming);
   liveRecord=incoming;liveId=incoming.config.run_id;
  }else{
   if(incoming.config?.run_id!==liveId || incoming.schema!=='rocket-run-v1' || !Array.isArray(incoming.snapshots))throw Error('Unknown run or invalid snapshot batch');
   let previous=liveRecord.snapshots.at(-1);
   validate({...incoming,snapshots:[previous,...incoming.snapshots]});
   for(const packet of incoming.snapshots){
    if(!validPacket(packet,liveId)||packet.sequence!==previous.sequence+1||packet.time<previous.time)throw Error('Stale or out-of-order state packet');
    previous=packet;
   }
   for(const packet of incoming.snapshots)liveRecord.snapshots.push(packet);
   for(const key of ['commands','pending_commands','terminal','status','error'])liveRecord[key]=incoming[key];
  }
  const newest=liveRecord.snapshots.at(-1);
  if(newest.sequence>lastPacket){
   const now=performance.now();
   if(previousNewest && incoming.status==='running' && !newest.contact){
    renderWindow={from:previousNewest.time,to:newest.time,start:now,duration:Math.max(1,Math.min(500,now-liveArrival||200))};
   }else renderWindow=null;
   liveArrival=now;
  }
  lastPacket=newest.sequence;connected=true;lag=data.lag;
  const accepted=[...liveRecord.commands,...(liveRecord.pending_commands||[])].at(-1);
  if(accepted){seq=Math.max(seq,accepted.command_sequence);$('accepted').textContent=`Accepted #${accepted.command_sequence}: throttle ${fmt(accepted.throttle)}, gimbal ${fmt(accepted.gimbal)}${accepted.action===null?'':`, action ${accepted.action}`} · effective ${fmt(accepted.effective_time,3)} s`;}
  if(fresh){
   const current=accepted||newest.command;
   $('throttle').value=current.throttle;$('gimbal').value=current.gimbal;
   $('throttleout').textContent=fmt(current.throttle);$('gimbalout').textContent=fmt(current.gimbal);
   $('mode').value=current.action===null?'manual':'discrete';
   $('manual').hidden=current.action!==null;$('discrete').hidden=current.action===null;
  }
  if(!replayMode){record=liveRecord;frame=record.snapshots.length-1;view=newest;updateUI();if(fresh&&accepted?.action!==null&&accepted?.action!==undefined)$('action').value=accepted.action;}
  else if(replayFollowsLive&&record.config.run_id===liveId){
   for(let i=record.snapshots.length;i<liveRecord.snapshots.length;i++)record.snapshots.push(liveRecord.snapshots[i]);
   for(const key of ['commands','pending_commands','terminal','status','error'])record[key]=liveRecord[key];
   if(liveRecord.status!=='running')replayFollowsLive=false;
   updateUI();
  }
  if(liveRecord.error)statusNotice(liveRecord.error);else if(lag>.2)statusNotice('Simulation is '+fmt(lag)+' s behind requested speed; no steps are skipped.');else statusNotice('');
 }catch(e){connected=false;playing=false;statusNotice('Connection or packet error: '+e.message+'. Flight pauses when the heartbeat is lost.');if(record)updateUI();$('status').textContent='Disconnected';}
 finally{polling=false;}
}
function setRecord(r){validate(r);enterReplay();replayFollowsLive=false;record=r;frame=0;view=record.snapshots[0];replayMode=true;playing=false;updateUI();}
async function control(operation,extra={}){try{if(!liveId)throw Error('No live connection');await post('/api/control',{run_id:liveId,operation,...extra});notice('');await poll();}catch(e){notice(e.message);}}
async function sendDesired(){if(sending||!desired||!liveId)return;if(!connected||replayMode){desired=null;notice('Command not sent: return to a connected live session.');return;}sending=true;const request=desired;desired=null;try{let ack=await post('/api/command',{run_id:liveId,command_sequence:++seq,...request});$('accepted').textContent=`Accepted #${ack.command_sequence}: throttle ${fmt(ack.throttle)}, gimbal ${fmt(ack.gimbal)}${ack.action===null?'':`, action ${ack.action}`} · effective ${fmt(ack.effective_time,3)} s`;notice('');}catch(e){notice('Command rejected: '+e.message);}finally{sending=false;if(desired)setTimeout(sendDesired,220);}}
function queueManual(){ $('throttleout').textContent=fmt(+$('throttle').value);$('gimbalout').textContent=fmt(+$('gimbal').value);desired={throttle:+$('throttle').value,gimbal:+$('gimbal').value};sendDesired();}
$('throttle').oninput=$('gimbal').oninput=queueManual;
$('mode').onchange=()=>{$('manual').hidden=$('mode').value!=='manual';$('discrete').hidden=$('mode').value!=='discrete';};
$('sendaction').onclick=()=>{desired={action:+$('action').value};sendDesired();};
$('start').onclick=()=>control('start');$('pause').onclick=()=>control('pause');$('speed').onchange=()=>control('speed',{speed:+$('speed').value});
$('reset').onclick=async()=>{if(resetting)return;resetting=true;generation++;try{const r=await post('/api/reset');notice('');liveId=r.config.run_id;liveRecord=null;lastPacket=-1;renderWindow=null;seq=0;desired=null;replayMode=false;playing=false;$('throttle').value=0;$('gimbal').value=0;$('throttleout').textContent='0.00';$('gimbalout').textContent='0.00';$('accepted').textContent='Accepted: engine off';}catch(e){notice(e.message);}finally{resetting=false;poll();}};
function enterReplay(){if(!replayMode && record){replayFollowsLive=record.status==='running';if(replayFollowsLive)control('pause');record={...record,snapshots:record.snapshots.slice(),commands:record.commands.slice()};}replayMode=true;}
$('timeline').oninput=()=>{enterReplay();playing=false;frame=+$('timeline').value;view=record.snapshots[frame];updateUI();};
function seekTime(t){if(!record)return;let lo=0,hi=record.snapshots.length-1;while(lo<hi){let mid=Math.floor((lo+hi+1)/2);if(record.snapshots[mid].time<=t)lo=mid;else hi=mid-1;}seek(lo);}
$('backtime').onclick=()=>seekTime(view.time-1);$('forwardtime').onclick=()=>seekTime(view.time+1);
$('begin').onclick=()=>seek(0);$('back').onclick=()=>seek(frame-1);$('forward').onclick=()=>seek(frame+1);$('terminal').onclick=()=>seek(record.snapshots.length-1);
$('replay').onclick=()=>{if(!record)return;if(!replayMode){enterReplay();frame=0;} if(frame>=record.snapshots.length-1)frame=0;playing=!playing;lastFrame=0;view=record.snapshots[frame];replayClock=view.time;updateUI();};
$('live').onclick=()=>{replayMode=false;replayFollowsLive=false;playing=false;if(liveRecord){record=liveRecord;frame=record.snapshots.length-1;view=record.snapshots[frame];updateUI();}poll();};
function seek(i){if(!record)return;enterReplay();playing=false;frame=Math.max(0,Math.min(record.snapshots.length-1,i));view=record.snapshots[frame];updateUI();}
$('export').onclick=()=>{if(!record)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'}));a.download='rocket-'+record.config.run_id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('import').onchange=async e=>{try{let f=e.target.files[0];if(!f)return;if(f.size>64*1024*1024)throw Error('File exceeds 64 MB limit');setRecord(JSON.parse(await f.text()));notice('Recording imported for read-only replay.');}catch(err){notice('Import error: '+err.message);}e.target.value='';};
function metric(label,value){return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;}
function updateUI(){if(!record||!view)return;let s=view.state,d=view.diagnostics||{}, c=view.command, end=record.snapshots.at(-1), p=record.config.parameters;
 $('status').textContent=replayMode?'Replay':record.status;$('clock').textContent='T + '+fmt(view.time)+' s';$('timeline').max=record.snapshots.length-1;$('timeline').value=frame;$('replaytime').textContent=fmt(view.time)+' / '+fmt(end.time)+' s';$('replay').textContent=playing?'Pause replay':'Play replay';
 $('telemetry').innerHTML=metric('Position x / y',`${fmt(s.x)} / ${fmt(s.y)} m`)+metric('Velocity x / y',`${fmt(s.vx)} / ${fmt(s.vy)} m/s`)+metric('Speed',`${fmt(Math.hypot(s.vx,s.vy))} m/s`)+metric('Angle θ',`${fmt(s.theta*180/Math.PI)}°`)+metric('Angular rate',`${fmt(s.omega*180/Math.PI)} °/s`)+metric('Fuel',`${fmt(s.fuel)} kg`)+metric('Actual thrust',`${fmt(s.thrust)} N`)+metric('Actual gimbal',`${fmt(s.gimbal*180/Math.PI)}°`)+metric('Command',`${fmt(c.throttle)} / ${fmt(c.gimbal)}${c.action===null?'':` · action ${c.action}`}`)+metric('Mass (derived)',d.mass!==undefined?`${fmt(d.mass)} kg`:'not available')+metric('Inertia (derived)',d.inertia!==undefined?`${fmt(d.inertia)} kg m²`:'not available')+metric('Airspeed (derived)',d.airspeed!==undefined?`${fmt(d.airspeed)} m/s`:'not available')+metric('Body centre of mass (derived)',`${fmt(view.centre[0])} / ${fmt(view.centre[1])} m`)+metric('Wind (derived)',Array.isArray(d.wind)?`${fmt(d.wind[0])} / ${fmt(d.wind[1])} m/s`:'not available')+metric('Aerodynamic torque (derived)',d.aero_torque!==undefined?`${fmt(d.aero_torque)} N m`:'not available')+metric('Aerodynamic force (derived)',Array.isArray(d.aero_force)?`${fmt(d.aero_force[0])} / ${fmt(d.aero_force[1])} N`:'not available');
 let initial=record.config.initial_state, event=record.terminal; $('notes').textContent='';for(const text of [record.config.parameter_status,`Initial: x ${fmt(initial.x)} m, y ${fmt(initial.y)} m, vx ${fmt(initial.vx)} m/s, vy ${fmt(initial.vy)} m/s, θ ${fmt(initial.theta)} rad, ω ${fmt(initial.omega)} rad/s, fuel ${fmt(initial.fuel)} kg, thrust ${fmt(initial.thrust)} N, gimbal ${fmt(initial.gimbal)} rad.`,event?`${event.reason}; t = ${event.time} s${event.point?`; contact = (${event.point[0]}, ${event.point[1]}) m`:''}`:`Run status: ${record.status}`,`Control interval: ${p.control_interval} s; physics step: ${p.timestep} s.`, `Configuration: ${record.config.physics_config}`]){const el=document.createElement('p');el.textContent=text;$('notes').appendChild(el);}
 const mapping=JSON.stringify(record.config.actions);
 if(actionsConfig!==mapping){let selected=$('action').value;$('action').textContent='';record.config.actions.forEach((a,i)=>{let o=document.createElement('option');o.value=i;o.textContent=`${i}: ${i===0?'off':['low','medium','high'][Math.floor((i-1)/3)]+' / '+['left','centre','right'][(i-1)%3]} (${a.throttle}, ${a.gimbal})`;$('action').appendChild(o);});if(selected)$('action').value=selected;actionsConfig=mapping;}
 const canCommand=!replayMode&&connected&&['ready','running','paused'].includes(record.status);
 for(const id of ['mode','throttle','gimbal','action','sendaction','speed'])$(id).disabled=!canCommand;
 $('start').disabled=replayMode||!connected||!['ready','paused'].includes(record.status);$('pause').disabled=replayMode||!connected||record.status!=='running';} 
function line(a,b,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...screen(a));ctx.lineTo(...screen(b));ctx.stroke();}
function dot(a,color,r=4){ctx.fillStyle=color;ctx.beginPath();ctx.arc(...screen(a),r,0,Math.PI*2);ctx.fill();}
function draw(){let w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);if(!view||!record)return;
 let s=view.state,p=record.config.parameters,c=view.centre;
 if(camera.auto){let targetX=s.x/2,targetY=(s.y+2)/2, scale=Math.max(1,Math.min(20,Math.min(w/Math.max(40,Math.abs(s.x)+30),h/Math.max(25,Math.abs(s.y)+15))));const blend=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?1:.06;camera.x+=(targetX-camera.x)*blend;camera.y+=(targetY-camera.y)*blend;camera.scale+=(scale-camera.scale)*blend;}
 const guideStep=Math.pow(10,Math.ceil(Math.log10(Math.max(1,50/camera.scale))));
 const bottom=camera.y-h/(2*camera.scale),top=camera.y+h/(2*camera.scale);
 ctx.font='10px system-ui';ctx.fillStyle='#78918a';ctx.strokeStyle='#89a69a1a';ctx.lineWidth=1;
 for(let altitude=Math.ceil(bottom/guideStep)*guideStep;altitude<=top;altitude+=guideStep){let y=screen([0,altitude])[1];ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();ctx.fillText(`${altitude} m`,8,y-4);}
 let left=camera.x-w/(2*camera.scale),right=camera.x+w/(2*camera.scale),terrain=p.terrain;let points=[[left,terrainHeight(terrain,left)],...terrain.filter(q=>q[0]>left&&q[0]<right),[right,terrainHeight(terrain,right)]];ctx.fillStyle='#253c35';ctx.beginPath();ctx.moveTo(...screen([left,camera.y-h/camera.scale]));for(let pt of points)ctx.lineTo(...screen(pt));ctx.lineTo(...screen([right,camera.y-h/camera.scale]));ctx.closePath();ctx.fill();for(let i=1;i<points.length;i++)line(points[i-1],points[i],'#84a693',2);
 if($('trail').checked){let snaps=record.snapshots,endIndex=replayMode?frame:snaps.length-1,stride=Math.max(1,Math.ceil(endIndex/1000));ctx.beginPath();for(let i=0;i<=endIndex;i+=stride){let q=screen([snaps[i].state.x,snaps[i].state.y]);if(i===0)ctx.moveTo(...q);else ctx.lineTo(...q);}ctx.strokeStyle='#77b5a277';ctx.lineWidth=1;ctx.stroke();}
 const bp=q=>bodyPoint(q,s,c), engine=bp(p.engine);
 function rocket(){
  const hull=p.hull.map(bp);
  if(s.thrust>0){
   const v=thrustDirection(s.theta,s.gimbal),length=Math.min(5,.7+4*s.thrust/p.max_thrust),reduced=!visualQuality||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   ctx.save();if(!reduced){ctx.shadowColor='#ffad66';ctx.shadowBlur=12;}line(engine,[engine[0]-v[0]*length,engine[1]-v[1]*length],'#ffad66',Math.max(2,camera.scale*.35));
   if(!reduced){for(let i=0;i<8;i++){const seed=Math.sin((view.sequence+1)*12.9898+i*78.233)*43758.5453,noise=seed-Math.floor(seed),along=length*(.25+.9*(i+noise)/8),side=(noise-.5)*.45;ctx.globalAlpha=.65*(1-i/10);dot([engine[0]-v[0]*along+v[1]*side,engine[1]-v[1]*along-v[0]*side],'#ffca87',Math.max(1,Math.min(3,camera.scale*.08)));}}
   ctx.restore();
  }
  ctx.beginPath();hull.forEach((q,i)=>{let z=screen(q);i?ctx.lineTo(...z):ctx.moveTo(...z);});ctx.closePath();ctx.fillStyle='#e9eee5';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#9db6ae';ctx.stroke();
  for(const foot of p.feet){line(bp([foot[0]*.35,0]),bp(foot),'#c1d1c4',2);dot(bp(foot),'#dce8dc',2.5);}
  const n=nozzleDirection(s.theta,s.gimbal);line(engine,[engine[0]+n[0]*.7,engine[1]+n[1]*.7],'#e6b78b',Math.max(2,camera.scale*.3));
 }
 rocket();
 if($('axes').checked){line([s.x,s.y],bp([c[0]+2,c[1]]),'#eebc78',2);line([s.x,s.y],bp([c[0],c[1]+2]),'#b2e68a',2);}
 if($('centres').checked)dot([s.x,s.y],'#ffdc85');
 let d=view.diagnostics||{}, origin=[s.x,s.y];
 if($('pressure').checked&&Array.isArray(d.centre_of_pressure)){let q=bp(d.centre_of_pressure);dot(q,'#e884a1');ctx.fillStyle='#e884a1';ctx.font='11px system-ui';let v=screen(q);ctx.fillText('CP',v[0]+6,v[1]-5);}
 if($('velocityVector').checked)line(origin,[s.x+s.vx,s.y+s.vy],'#82c8f4',2);
 if($('thrustVector').checked&&d.thrust_vector)line(engine,[engine[0]+d.thrust_vector[0]/10,engine[1]+d.thrust_vector[1]/10],'#ffad66',2);
 if($('aeroVector').checked&&d.aero_force)line(origin,[s.x+d.aero_force[0]/10,s.y+d.aero_force[1]/10],'#e884a1',2);
 if($('velocityVector').checked||$('thrustVector').checked||$('aeroVector').checked){ctx.fillStyle='#d1e2dc';ctx.font='11px system-ui';ctx.fillText('Blue velocity · orange thrust · pink aerodynamic force',14,22);}
 // A separately scaled detail keeps a distant vehicle legible without changing
 // the world camera or implying that the vehicle is larger in the scene.
 if(camera.scale*p.length<36 && w>300 && h>250){
  const x=w-138,y=12,iw=124,ih=130;ctx.save();ctx.fillStyle='#172b32ee';ctx.strokeStyle='#6e8780';ctx.lineWidth=1;ctx.fillRect(x,y,iw,ih);ctx.strokeRect(x,y,iw,ih);ctx.beginPath();ctx.rect(x,y,iw,ih);ctx.clip();
  const saved=camera, scale=Math.min(20,72/p.length);camera={x:s.x-(x+iw/2-w/2)/scale,y:s.y+(y+ih/2-h/2)/scale,scale,auto:false};rocket();camera=saved;ctx.fillStyle='#d1e2dc';ctx.font='10px system-ui';ctx.fillText('VEHICLE DETAIL',x+8,y+15);ctx.fillText('separate scale',x+8,y+ih-8);ctx.restore();
 }
 if(view.contact&&$('contactMarker').checked)dot(view.contact.point,'#ffcf78',5);ctx.fillStyle='#b9ccc3';ctx.font='12px system-ui';let scaleLength=10*camera.scale;ctx.fillRect(16,h-35,scaleLength,2);ctx.fillText('10 m',16,h-40);
}
$('camera').onclick=()=>{camera.auto=true;};canvas.onpointerdown=e=>{dragging=[e.clientX,e.clientY];camera.auto=false;canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!dragging)return;camera.x-=(e.clientX-dragging[0])/camera.scale;camera.y+=(e.clientY-dragging[1])/camera.scale;dragging=[e.clientX,e.clientY];};canvas.onpointerup=canvas.onpointercancel=()=>{dragging=null;};canvas.onwheel=e=>{e.preventDefault();camera.auto=false;const rect=canvas.getBoundingClientRect(),px=e.clientX-rect.left-canvas.clientWidth/2,py=e.clientY-rect.top-canvas.clientHeight/2;const x=camera.x+px/camera.scale,y=camera.y-py/camera.scale;camera.scale=Math.max(.2,Math.min(100,camera.scale*Math.exp(-e.deltaY*.001)));camera.x=x-px/camera.scale;camera.y=y+py/camera.scale;};
function updateVisualQuality(interval){
 if(interval>28){slowFrames++;fastFrames=0;if(slowFrames>=6)visualQuality=0;}
 else if(interval<=20){fastFrames++;slowFrames=0;if(fastFrames>=120)visualQuality=1;}
 else {slowFrames=0;fastFrames=0;}
}
function animate(now){if(lastPaint)updateVisualQuality(now-lastPaint);lastPaint=now;if(playing&&record){if(lastFrame){replayClock+=(now-lastFrame)/1000*(+$('replayspeed').value);while(frame+1<record.snapshots.length&&record.snapshots[frame+1].time<=replayClock)frame++;view=record.snapshots[frame];if(frame===record.snapshots.length-1)playing=false;updateUI();}lastFrame=now;}else lastFrame=0;if(!replayMode&&record&&record.status==='running'&&renderWindow){const u=Math.max(0,Math.min(1,(now-renderWindow.start)/renderWindow.duration));view=snapshotAt(record.snapshots,renderWindow.from+(renderWindow.to-renderWindow.from)*u,record.config.parameters);}draw();requestAnimationFrame(animate);}
// Shortcuts apply only while the flight canvas has focus; form controls keep
// their native keyboard behavior. Steering is momentary and released on blur.
const steeringKeys=new Set();
function releaseSteering(){if(!steeringKeys.size)return;steeringKeys.clear();$('gimbal').value=0;queueManual();}
canvas.addEventListener('keydown',event=>{
 if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))return;
 event.preventDefault();
 if(!record||replayMode||!connected||!['ready','running','paused'].includes(record.status))return;
 if(event.key===' '){if(!event.repeat)control(record.status==='running'?'pause':'start');return;}
 if($('mode').value!=='manual')return;
 if(event.key==='ArrowUp'||event.key==='ArrowDown'){
  const direction=event.key==='ArrowUp'?1:-1;
  $('throttle').value=Math.max(0,Math.min(1,+$('throttle').value+direction*.05));queueManual();
 }else if(!event.repeat){
  steeringKeys.add(event.key);$('gimbal').value=steeringKeys.has('ArrowLeft')===steeringKeys.has('ArrowRight')?0:steeringKeys.has('ArrowLeft')?1:-1;queueManual();
 }
});
window.addEventListener('keyup',event=>{
 if(!steeringKeys.has(event.key))return;
 event.preventDefault();steeringKeys.delete(event.key);
 $('gimbal').value=steeringKeys.has('ArrowLeft')===steeringKeys.has('ArrowRight')?0:steeringKeys.has('ArrowLeft')?1:-1;queueManual();
});
canvas.addEventListener('blur',releaseSteering);window.addEventListener('blur',releaseSteering);
window.addEventListener('pagehide',()=>{if(liveId && liveRecord && liveRecord.status==='running')navigator.sendBeacon('/api/control',new Blob([JSON.stringify({run_id:liveId,operation:'pause'})],{type:'application/json'}));});
poll();setInterval(poll,200);requestAnimationFrame(animate);
