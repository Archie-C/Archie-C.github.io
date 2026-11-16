'use strict';
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number(n).toFixed(d);
const replayViewer=window.createRocketReplayViewer(document.querySelector('.flight'));
const setRecord=r=>replayViewer.load(r);
function notice(s){$('message').textContent=s||'';}
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
$('weights-clear').onclick=()=>{selectedWeights=null;$('weights-file').value='';$('weights-meta').hidden=true;$('controller-run').textContent='Train and evaluate';};

function renderFlightSet(flightSet, label, bodyId, summaryId, limits, includeExperts) {
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
  if (includeExperts) {
   const expertCell=document.createElement('td'), expertReplay=flightSet.expert_replays?.[i];
   if(expertReplay){const button=document.createElement('button');button.type='button';button.textContent='View expert flight';button.onclick=async()=>{if(await setRecord(expertReplay)){notice(`Expert validation run ${run.run_id} loaded. Use Play replay to watch it.`);$('scene').scrollIntoView({behavior:'smooth',block:'center'});}};expertCell.appendChild(button);}
   else {expertCell.textContent='Not provided';}
   row.appendChild(expertCell);
  }
  body.appendChild(row);
 });
}
function showControllerResults(result){
 renderFlightSet(result.validation,'Validation','result-rows','result-summary',result.limits,true);
 $('controller-results').hidden=false;
}

let evaluationVersion = 0, currentClassification = null, currentLanding = null;
const scoreEndpoint = 'https://sjoybqjjvhafnsobouzl.supabase.co/functions/v1/score-rocket';
function showSubmittedTestResults(classification, landing, result) {
 const validMetrics = result.sample_count === classification.sample_count &&
  Number.isFinite(result.accuracy) && result.accuracy >= 0 && result.accuracy <= 1 &&
  Number.isFinite(result.macro_f1) && result.macro_f1 >= 0 && result.macro_f1 <= 1;
 $('classification-summary').textContent = validMetrics
  ? `Action accuracy: ${fmt(100*result.accuracy,1)}% · Macro F1: ${fmt(100*result.macro_f1,1)}% · ${result.sample_count} observations`
  : 'Action agreement results are unavailable.';
 $('classification-overlap').hidden=!classification.overlapping_observations;
 $('classification-overlap').textContent=classification.overlapping_observations
  ? `${classification.overlapping_observations} / ${classification.sample_count} test observations also occur in the training data; these results are not fully independent.` : '';
 $('test-result-summary').textContent=`${landing.successful_runs} / ${landing.total_runs} successful (${fmt(100*landing.successful_runs/landing.total_runs,0)}%) · Mean score: ${landing.score===null?'—':fmt(landing.score,1)+' / 100'} (${landing.scored_contacts} contacts)`;
 $('test-results').hidden=false;
}
function getBrowserId() {
 let id = localStorage.getItem('browser_id');
 if (!id) { id = crypto.randomUUID(); localStorage.setItem('browser_id', id); }
 return id;
}
$('leaderboard-form').onsubmit = async event => {
 event.preventDefault();
 const status = $('leaderboard-submit-status'), button = $('leaderboard-submit');
 const name = $('student-name').value.trim(), classification = currentClassification, landing = currentLanding, version = evaluationVersion;
 if (!name || name.length > 50) { status.textContent = 'Enter a name of up to 50 characters.'; return; }
 if (!classification || !landing) { status.textContent = 'Evaluate a controller first.'; return; }
 button.disabled = true; status.textContent = 'Submitting your predictions…';
 try {
  const response = await fetch(scoreEndpoint, {method:'POST', headers:{'Content-Type':'application/json'},
   body:JSON.stringify({dataset_id:classification.dataset_id, predictions:classification.predictions,
    browser_id:getBrowserId(), name, task_name:'rocket', landing})});
  const result = await response.json();
  if (version !== evaluationVersion) return;
  if (!response.ok) throw Error(result.error || 'Submission failed');
  if (result.flight_set !== 'test-v1') {
   status.textContent = 'The deployed scoring function needs updating. This submission is not marked as a test flight; update the function and submit again.';
   return;
  }
  if (result.saved !== true) throw Error(result.message || 'Submission was not saved');
  showSubmittedTestResults(classification, landing, result);
  status.textContent = result.message || 'Submission saved.';
  if (typeof window.loadRocketLeaderboard === 'function') await window.loadRocketLeaderboard();
 } catch (error) { if (version === evaluationVersion) status.textContent = 'Submission failed: ' + error.message; }
 finally { button.disabled = false; }
};
$('controller-cancel').onclick=()=>cancelEvaluation?.();
$('controller-form').onsubmit=async e=>{
 e.preventDefault();const file=selectedController, status=$('controller-status'), button=$('controller-run');
 if(!file){status.textContent='Choose a Python controller file first.';return;}
 const weights=selectedWeights;
 if(weights && (!weights.size || weights.size>20*1024*1024)){status.textContent='Choose a nonempty weights file no larger than 20 MB.';return;}
 ++evaluationVersion; currentClassification=null; currentLanding=null; $('test-results').hidden=true; $('leaderboard-submit-status').textContent='';
 button.disabled=true;$('controller-cancel').hidden=false;$('controller-results').hidden=true;status.textContent=weights?'Loading saved model and evaluating validation and test flights…':'Training controller and evaluating validation and test flights…';
 try{
  const result=await evaluateController(await file.text(), weights ? await weights.arrayBuffer() : null, weights?.name);
  currentClassification=result.classification;
  currentLanding={flight_set:'test-v1', successful_runs:result.test.summary.successful_runs, total_runs:result.test.summary.total_runs,
   score:result.test.summary.mean_diagnostic_score, scored_contacts:result.test.summary.scored_contacts};
  showControllerResults(result);status.textContent='Evaluation complete. Select View flight to inspect a validation run, or submit to see test results.';
 }catch(err){status.textContent='Controller error: '+err.message;}
 finally{button.disabled=false;$('controller-cancel').hidden=true;}
};
