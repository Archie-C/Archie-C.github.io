'use strict';
// Geometry is a display transform only; centre of mass comes from the adapter.
const $ = id => document.getElementById(id);
const canvas=$('scene'), ctx=canvas.getContext('2d');
const stateKeys=['x','y','vx','vy','theta','omega','fuel','thrust','gimbal'];
let record=null, liveRecord=null, view=null, replayMode=false, replayFollowsLive=false, playing=false, frame=0, lastFrame=0, seq=0;
let camera={x:0,y:25,scale:5,auto:true}, dragging=null, connected=false, sending=false, desired=null;
let lastPacket=-1, liveId=null, liveArrival=0, renderWindow=null, lag=0, replayClock=0, polling=false, resetting=false, generation=0, actionsConfig=null, localNotice='', replayTransition=null, visualQuality=1, slowFrames=0, fastFrames=0, lastPaint=0;
const fmt=(n,d=2)=>Number(n).toFixed(d);
function bodyPoint(point,s,c){const x=point[0]-c[0], y=point[1]-c[1], a=s.theta;return [s.x+x*Math.cos(a)-y*Math.sin(a),s.y+x*Math.sin(a)+y*Math.cos(a)];}
function rocketCamera(s,centre,parameters,width,height){
 const points=[...parameters.hull,...parameters.feet].map(point=>bodyPoint(point,s,centre));
 const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
 const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
 const scale=Math.min(20,width/Math.max(1,(right-left)*1.5),height/Math.max(1,(top-bottom)*1.5));
 return {x:(left+right)/2,y:(bottom+top)/2,scale,auto:true};
}
function thrustDirection(theta,gimbal){return [-Math.sin(theta+gimbal),Math.cos(theta+gimbal)];}
function thrustDisplayVector(vector,maxThrust,rocketLength){
 const magnitude=Math.hypot(...vector);
 if(magnitude===0)return [0,0];
 const length=rocketLength*Math.min(1,magnitude/maxThrust);
 return vector.map(component=>component/magnitude*length);
}
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
let worker=null, requestId=0, cancelEvaluation=null;
function evaluateController(source, weights, weightsName){return new Promise((resolve,reject)=>{
 const id=++requestId;
 worker=new Worker('./rocket-worker.js');
 cancelEvaluation=()=>{worker.terminate();worker=null;cancelEvaluation=null;reject(Error('Evaluation cancelled.'));};
 worker.onmessage=({data})=>{
  if(data.id!==id)return;
  if(data.progress){$('controller-status').textContent=data.progress;return;}
  worker.terminate();worker=null;cancelEvaluation=null;
  if(data.error)reject(Error(data.error));else resolve(data.result);
 };
 worker.onerror=event=>{worker.terminate();worker=null;cancelEvaluation=null;reject(Error(event.message || 'Python worker failed'));};
 worker.postMessage({id,source,weights,weightsName},weights ? [weights] : []);
});}
function notice(s){localNotice=s||'';$('message').textContent=localNotice;}
function showReplay(loaded){$('replay-empty').hidden=loaded;$('replay-view').hidden=!loaded;$('clock').hidden=!loaded;}
async function setRecord(r){validate(r);if(!await enterReplay())return false;replayFollowsLive=false;record=r;frame=0;view=record.snapshots[0];replayMode=true;playing=false;showReplay(true);updateUI();return true;}
async function enterReplay(){replayMode=true;return true;}
$('timeline').oninput=async()=>{const index=+$('timeline').value;if(!await enterReplay())return;playing=false;frame=Math.min(index,record.snapshots.length-1);view=record.snapshots[frame];updateUI();};
function seekTime(t){if(!record||!view)return;let lo=0,hi=record.snapshots.length-1;while(lo<hi){let mid=Math.floor((lo+hi+1)/2);if(record.snapshots[mid].time<=t)lo=mid;else hi=mid-1;}seek(lo);}
$('backtime').onclick=()=>{if(view)seekTime(view.time-1);};$('forwardtime').onclick=()=>{if(view)seekTime(view.time+1);};
$('begin').onclick=()=>seek(0);$('back').onclick=()=>seek(frame-1);$('forward').onclick=()=>seek(frame+1);$('terminal').onclick=()=>{if(record)seek(record.snapshots.length-1);};
$('replay').onclick=async()=>{if(!record)return;if(!replayMode){if(!await enterReplay())return;frame=0;} if(frame>=record.snapshots.length-1)frame=0;playing=!playing;lastFrame=0;view=record.snapshots[frame];replayClock=view.time;updateUI();};
$('live').onclick=()=>{record=null;view=null;playing=false;replayMode=false;showReplay(false);notice('');};
async function seek(i){if(!record||!await enterReplay())return;playing=false;frame=Math.max(0,Math.min(record.snapshots.length-1,i));view=record.snapshots[frame];updateUI();}
$('export').onclick=()=>{if(!record)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'}));a.download='rocket-'+record.config.run_id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('import').onchange=async e=>{try{let f=e.target.files[0];if(!f)return;if(f.size>64*1024*1024)throw Error('File exceeds 64 MB limit');if(await setRecord(JSON.parse(await f.text())))notice('Recording imported for read-only replay.');}catch(err){notice('Import error: '+err.message);}e.target.value='';};
let selectedController=null, selectedWeights=null;
function selectController(file){
 if(!file)return;
 if(!file.name.toLowerCase().endsWith('.py') || !file.size || file.size>128*1024){
  $('controller-status').textContent='Choose a nonempty .py file no larger than 128 KB.';return;
 }
 selectedController=file;$('upload-filename').textContent=file.name;$('upload-meta').hidden=false;$('controller-status').textContent='';
}
function selectWeights(file){
 if(!file)return;
 if(!file.size || file.size>20*1024*1024){
  $('controller-status').textContent='Choose a nonempty weights file no larger than 20 MB.';return;
 }
 selectedWeights=file;$('weights-filename').textContent=file.name;$('weights-meta').hidden=false;
 $('controller-run').textContent='Evaluate saved model';$('controller-status').textContent='';
}
function bindUpload(zoneId, inputId, select){
 const zone=$(zoneId), input=$(inputId);
 zone.onclick=()=>input.click();
 zone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragover');};
 zone.ondragleave=()=>zone.classList.remove('dragover');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragover');select(e.dataTransfer.files[0]);};
 input.onchange=()=>select(input.files[0]);
}
bindUpload('upload-zone','controller-file',selectController);
bindUpload('weights-zone','weights-file',selectWeights);
$('upload-clear').onclick=()=>{selectedController=null;$('controller-file').value='';$('upload-meta').hidden=true;};
$('weights-clear').onclick=()=>{selectedWeights=null;$('weights-file').value='';$('weights-meta').hidden=true;$('controller-run').textContent='Evaluate controller';};

function renderFlightSet(flightSet, label, bodyId, summaryId, limits) {
 const s=flightSet.summary;
 $(summaryId).textContent=`${s.successful_runs} / ${s.total_runs} successful (${fmt(100*s.success_rate,0)}%) · Mean score: ${s.mean_diagnostic_score===null?'—':fmt(s.mean_diagnostic_score,1)+' / 100'} (${s.scored_contacts} contacts)`;
 const body=$(bodyId);body.replaceChildren();
 flightSet.runs.forEach((run,i)=>{
  const row=document.createElement('tr'), score=run.scoring, m=run.metrics, l=limits;
  const degrees=n=>n*180/Math.PI, measurement=(n,limit)=>`${fmt(n)} / ${fmt(limit)}`;
  const atContact=score.contact_time!==null;
  const values=[
   [run.description ? `${run.run_id} · ${run.description}` : run.run_id], [score.success?'Success':atContact?'Unsuccessful':`No contact (${run.termination_reason})`],
   [run.diagnostic_score===null?'—':fmt(run.diagnostic_score,1)],
   [measurement(m.vy,l.vy),m.vy>=-l.vy&&m.vy<=0],
   [measurement(m.vx,l.vx),Math.abs(m.vx)<=l.vx],
   [measurement(degrees(m.theta),l.theta),Math.abs(degrees(m.theta))<=l.theta],
   [measurement(degrees(m.omega),l.omega),Math.abs(degrees(m.omega))<=l.omega],
   [fmt(m.midpoint_offset)], [fmt(run.duration)]
  ];
  for(const [value,inRange] of values){
   const cell=document.createElement('td');cell.textContent=value;
   if(atContact&&inRange!==undefined){
    cell.className=inRange?'in-range':'out-of-range';
    cell.title=inRange?'In range':'Out of range';
    cell.setAttribute('aria-label',`${value}: ${cell.title}`);
   }
   row.appendChild(cell);
  }
  const cell=document.createElement('td');
  if(i<flightSet.replays.length){const button=document.createElement('button');button.type='button';button.textContent='View flight';button.onclick=async()=>{if(await setRecord(flightSet.replays[i])){notice(`${label} run ${run.run_id} loaded. Use Play replay to watch it.`);$('scene').scrollIntoView({behavior:'smooth',block:'center'});}};cell.appendChild(button);}
  else cell.textContent='—';row.appendChild(cell);
  body.appendChild(row);
 });
}
function showControllerResults(result){
 renderFlightSet(result.validation,'Validation','result-rows','result-summary',result.limits);
 $('controller-results').hidden=false;
}

$('controller-cancel').onclick=()=>cancelEvaluation?.();
$('controller-form').onsubmit=async e=>{
 e.preventDefault();const file=selectedController, status=$('controller-status'), button=$('controller-run');
 if(!file){status.textContent='Choose a Python controller file first.';return;}
 const weights=selectedWeights;
 if(weights && (!weights.size || weights.size>20*1024*1024)){status.textContent='Choose a nonempty weights file no larger than 20 MB.';return;}
 button.disabled=true;$('controller-cancel').hidden=false;$('controller-results').hidden=true;status.textContent='Evaluating validation flights…';
 try{
  const result=await evaluateController(await file.text(), weights ? await weights.arrayBuffer() : null, weights?.name);
  showControllerResults(result);status.textContent='Evaluation complete. Select View flight to inspect a validation run.';
 }catch(err){status.textContent='Controller error: '+err.message;}
 finally{button.disabled=false;$('controller-cancel').hidden=true;}
};
function updateUI(){
 if(!record||!view)return;
 const end=record.snapshots.at(-1);
 $('clock').textContent=fmt(view.time)+' s';
 $('timeline').max=record.snapshots.length-1;
 $('timeline').value=frame;
 $('replaytime').textContent=fmt(view.time)+' / '+fmt(end.time)+' s';
 $('replay').textContent=playing?'Pause replay':'Play replay';
}
function line(a,b,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...screen(a));ctx.lineTo(...screen(b));ctx.stroke();}
function dot(a,color,r=4){ctx.fillStyle=color;ctx.beginPath();ctx.arc(...screen(a),r,0,Math.PI*2);ctx.fill();}
function draw(){let w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);if(!view||!record)return;
 let s=view.state,p=record.config.parameters,c=view.centre;
 if(camera.auto)camera=rocketCamera(s,c,p,w,h);
 const guideStep=Math.pow(10,Math.ceil(Math.log10(Math.max(1,50/camera.scale))));
 const bottom=camera.y-h/(2*camera.scale),top=camera.y+h/(2*camera.scale);
 ctx.font='10px JetBrains Mono, monospace';ctx.fillStyle='#6B6149';ctx.strokeStyle='#DCD2BC80';ctx.lineWidth=1;
 for(let altitude=Math.ceil(bottom/guideStep)*guideStep;altitude<=top;altitude+=guideStep){let y=screen([0,altitude])[1];ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();ctx.fillText(`${altitude} m`,8,y-4);}
 let left=camera.x-w/(2*camera.scale),right=camera.x+w/(2*camera.scale),terrain=p.terrain;let points=[[left,terrainHeight(terrain,left)],...terrain.filter(q=>q[0]>left&&q[0]<right),[right,terrainHeight(terrain,right)]];ctx.fillStyle='#DCD2BC';ctx.beginPath();ctx.moveTo(...screen([left,camera.y-h/camera.scale]));for(let pt of points)ctx.lineTo(...screen(pt));ctx.lineTo(...screen([right,camera.y-h/camera.scale]));ctx.closePath();ctx.fill();for(let i=1;i<points.length;i++)line(points[i-1],points[i],'#A09373',2);
 // Materials are painted on the same terrain used for collision, using recorded boundaries.
 // Background-only coastal vegetation and a proposed-size service pedestal.
 if(record.config.pad){for(const x of [-145,-120,-100,-80,82,103,126,150]){if(x>=left-4&&x<=right+4){const y=terrainHeight(terrain,x);line([x-2,y],[x,y+1.2],'#A09373',2);line([x,y+1.2],[x+2,y],'#A09373',2);}}const x=75,y=terrainHeight(terrain,x),a=screen([x,y+9.144]),b=screen([x+9.144,y]);ctx.fillStyle='#A09373';ctx.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
 if(record.config.pad){const edge=record.config.pad.concrete_edge, outer=record.config.pad.apron_edge; for(const [a,b,color] of [[-outer,-edge,'#A09373'],[-edge,edge,'#ECE6D6'],[edge,outer,'#A09373']]){let l=Math.max(left,a),r=Math.min(right,b);if(l<r)line([l,terrainHeight(terrain,l)],[r,terrainHeight(terrain,r)],color,6);}if(left<0&&right>0){line([-2,0],[2,0],'#6B2C5C',3);line([0,0],[0,1.2],'#6B2C5C',2);}}
 if($('trail').checked){let snaps=record.snapshots,endIndex=replayMode?frame:snaps.length-1,stride=Math.max(1,Math.ceil(endIndex/1000));ctx.beginPath();for(let i=0;i<=endIndex;i+=stride){let q=screen([snaps[i].state.x,snaps[i].state.y]);if(i===0)ctx.moveTo(...q);else ctx.lineTo(...q);}ctx.strokeStyle='#6B2C5C88';ctx.lineWidth=1;ctx.stroke();}
 const bp=q=>bodyPoint(q,s,c), engine=bp(p.engine);
 function rocket(){
  const hull=p.hull.map(bp);
  if(s.thrust>0){
   const v=thrustDirection(s.theta,s.gimbal),length=Math.min(5,.7+4*s.thrust/p.max_thrust),reduced=!visualQuality||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   ctx.save();line(engine,[engine[0]-v[0]*length,engine[1]-v[1]*length],'#6B2C5C',Math.max(2,camera.scale*.35));
   if(!reduced){for(let i=0;i<8;i++){const seed=Math.sin((view.sequence+1)*12.9898+i*78.233)*43758.5453,noise=seed-Math.floor(seed),along=length*(.25+.9*(i+noise)/8),side=(noise-.5)*.45;ctx.globalAlpha=.65*(1-i/10);dot([engine[0]-v[0]*along+v[1]*side,engine[1]-v[1]*along-v[0]*side],'#A76A98',Math.max(1,Math.min(3,camera.scale*.08)));}}
   ctx.restore();
  }
  ctx.beginPath();hull.forEach((q,i)=>{let z=screen(q);i?ctx.lineTo(...z):ctx.moveTo(...z);});ctx.closePath();ctx.fillStyle='#F6F1E7';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#3D362A';ctx.stroke();
  for(const foot of p.feet){line(bp([foot[0]*.35,0]),bp(foot),'#3D362A',Math.max(1,Math.min(2,camera.scale*.2)));}
  const n=nozzleDirection(s.theta,s.gimbal);line(engine,[engine[0]+n[0]*.7,engine[1]+n[1]*.7],'#6B2C5C',Math.max(2,camera.scale*.3));
 }
 rocket();
 let d=view.diagnostics||{}, origin=[s.x,s.y];
 if($('velocityVector').checked)line(origin,[s.x+s.vx,s.y+s.vy],'#2C4A7A',2);
 if($('thrustVector').checked&&d.thrust_vector){const vector=thrustDisplayVector(d.thrust_vector,p.max_thrust,p.length);line(engine,[engine[0]+vector[0],engine[1]+vector[1]],'#6B2C5C',2);}
 if($('velocityVector').checked||$('thrustVector').checked){ctx.fillStyle='#3D362A';ctx.font='11px JetBrains Mono, monospace';ctx.fillText('Blue velocity · purple thrust',14,22);}
 // A separately scaled detail keeps a distant vehicle legible without changing
 // the world camera or implying that the vehicle is larger in the scene.
 if(camera.scale*p.length<36 && w>300 && h>250){
  const x=w-138,y=12,iw=124,ih=130;ctx.save();ctx.fillStyle='#F6F1E7ee';ctx.strokeStyle='#A09373';ctx.lineWidth=1;ctx.fillRect(x,y,iw,ih);ctx.strokeRect(x,y,iw,ih);ctx.beginPath();ctx.rect(x,y,iw,ih);ctx.clip();
  const saved=camera, scale=Math.min(20,72/p.length);camera={x:s.x-(x+iw/2-w/2)/scale,y:s.y+(y+ih/2-h/2)/scale,scale,auto:false};rocket();camera=saved;ctx.fillStyle='#3D362A';ctx.font='10px JetBrains Mono, monospace';ctx.fillText('Vehicle detail',x+8,y+15);ctx.fillText('separate scale',x+8,y+ih-8);ctx.restore();
 }
 if(view.contact&&$('contactMarker').checked)dot(view.contact.point,'#A82A20',5);ctx.fillStyle='#3D362A';ctx.font='12px JetBrains Mono, monospace';let scaleMetres=Math.pow(10,Math.floor(Math.log10(100/camera.scale))),scaleLength=scaleMetres*camera.scale;ctx.fillRect(16,h-35,scaleLength,2);ctx.fillText(`${scaleMetres} m`,16,h-40);
}
$('camera').onclick=()=>{camera.auto=true;};canvas.onpointerdown=e=>{dragging=[e.clientX,e.clientY];camera.auto=false;canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!dragging)return;camera.x-=(e.clientX-dragging[0])/camera.scale;camera.y+=(e.clientY-dragging[1])/camera.scale;dragging=[e.clientX,e.clientY];};canvas.onpointerup=canvas.onpointercancel=()=>{dragging=null;};canvas.onwheel=e=>{e.preventDefault();camera.auto=false;const rect=canvas.getBoundingClientRect(),px=e.clientX-rect.left-canvas.clientWidth/2,py=e.clientY-rect.top-canvas.clientHeight/2;const x=camera.x+px/camera.scale,y=camera.y-py/camera.scale;camera.scale=Math.max(.2,Math.min(100,camera.scale*Math.exp(-e.deltaY*.001)));camera.x=x-px/camera.scale;camera.y=y+py/camera.scale;};
function updateVisualQuality(interval){
 if(interval>28){slowFrames++;fastFrames=0;if(slowFrames>=6)visualQuality=0;}
 else if(interval<=20){fastFrames++;slowFrames=0;if(fastFrames>=120)visualQuality=1;}
 else {slowFrames=0;fastFrames=0;}
}
function animate(now){if(lastPaint)updateVisualQuality(now-lastPaint);lastPaint=now;if(playing&&record){if(lastFrame){replayClock+=(now-lastFrame)/1000*(+$('replayspeed').value);while(frame+1<record.snapshots.length&&record.snapshots[frame+1].time<=replayClock)frame++;view=record.snapshots[frame];if(frame===record.snapshots.length-1)playing=false;updateUI();}lastFrame=now;}else lastFrame=0;if(!$('replay-view').hidden)draw();requestAnimationFrame(animate);}
requestAnimationFrame(animate);
