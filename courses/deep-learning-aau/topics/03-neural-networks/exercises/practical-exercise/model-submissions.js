'use strict';
(() => {
 const endpoint=document.querySelector('meta[name="model-submission-endpoint"]')?.content || 'https://sjoybqjjvhafnsobouzl.supabase.co/functions/v1/model-submissions';
 const exercise=document.querySelector('meta[name="model-submission-exercise"]')?.content || 'nn-rocket';
 const $=id=>document.getElementById(id), form=$('model-form'), message=$('model-message'), history=$('model-history'), board=$('model-leaderboard'), progress=$('model-progress');
 let config=null, busy=false, timer=null, lastData=null, paused=false;
 const viewer=window.createRocketReplayViewer($('model-flight'));
 let replayRequest=0;
 const errors={upload_error:'The upload did not finish. Please submit again.',model_loading:'The evaluator could not load the model.',invalid_shape:'The model returned an invalid input or output shape.',runtime:'The model raised an exception during evaluation.',timeout:'The evaluation exceeded its time limit.',resource_limit:'The evaluation exceeded its resource limit.',evaluation:'The evaluator could not complete this evaluation.',infrastructure:'The evaluation worker was interrupted. Please submit again.'};
 const errorDetails={missing_entrypoint:'model.py must define create_model().',incompatible_weights:'The saved weights do not match the model architecture.',dependency_missing:'The model uses a dependency unavailable to the evaluator.',input_shape:'The model could not accept the expected input shape.',output_shape:'The model returned an output with the wrong shape.',non_finite:'The model returned a non-finite value.',out_of_range:'The model returned a control value outside the permitted range.',controller_exception:'The model raised an exception during evaluation.',time_limit:'The evaluation exceeded its time limit.',memory_limit:'The evaluation exceeded its memory limit.',evaluation_failed:'The evaluator could not complete this evaluation.',worker_interrupted:'The evaluation worker was interrupted. Please submit again.'};
 const time=v=>v ? new Date(v).toLocaleString() : '—';
 const duration=ms=>Number.isFinite(ms) ? `${(Math.max(0,ms)/1000).toFixed(1)} s` : '—';
 const span=(start,end)=>start ? duration((end ? Date.parse(end):Date.now())-Date.parse(start)) : '—';
 const queueWait=s=>s.queued_at && Number.isFinite(s.queue_wait_ms) ? duration(s.queue_wait_ms+(s.status==='queued' ? Math.max(0,Date.now()-Date.parse(s.queued_at)) : 0)) : 'unavailable';
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
 async function api(action,body,params={}) {
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),30000);
  try {
   const query=new URLSearchParams({action,exercise,...params});
   const r=await fetch(`${endpoint}?${query}`,{method:body===undefined?'GET':'POST',credentials:'include',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await r.json().catch(()=>({}));if(!r.ok){const error=Error(data.error || 'The submission service is unavailable.');error.status=r.status;throw error;}return data;
  } catch(error) {if(controller.signal.aborted)throw Error('Request timed out. Check your connection.');throw error;}
  finally{clearTimeout(deadline);}
 }
 function upload(id,file,loaded,total) { return new Promise((resolve,reject)=>{
  const x=new XMLHttpRequest(); x.open('POST',`${endpoint}?action=upload&id=${encodeURIComponent(id)}&exercise=${encodeURIComponent(exercise)}`); x.withCredentials=true; x.timeout=140000; x.setRequestHeader('X-Model-File',file.name); x.setRequestHeader('Content-Type','application/octet-stream');
  x.upload.onprogress=e=>{ if(e.lengthComputable) progress.value=Math.round((loaded+e.loaded)/total*100); };
  x.onload=()=>{if(x.status>=200&&x.status<300)resolve();else {let result={};try{result=JSON.parse(x.responseText);}catch(_){} reject(Error(result.error||'Upload failed.'));}};
  x.onerror=()=>reject(Error('Upload interrupted. Check your connection and cookies.')); x.ontimeout=()=>reject(Error('Upload timed out. Check your connection and try again.')); x.send(file);
 }); }
 function render(data) {
  config=data.config; lastData=data;
  if(document.activeElement!==$('model-name')) $('model-name').value=data.name || '';
  const active=document.activeElement, focusedRun=active?.closest('.model-attempt');
  const focusState=focusedRun ? {id:focusedRun.dataset.id, summary:active.tagName==='SUMMARY', label:active.tagName==='BUTTON'?active.textContent:null} : null;
  const opened=new Set(Array.from(history.querySelectorAll('details[open]'),e=>e.dataset.id)); history.replaceChildren();
  $('model-run-count').textContent=data.submissions.length ? `${data.submissions.length} ${data.submissions.length===1?'run':'runs'}` : '';
  if(!data.submissions.length) {const empty=text('p','No attempts yet.');empty.className='model-empty';history.append(empty);}
  for(const [index,s] of data.submissions.entries()) {
   const details=document.createElement('details');details.className='model-attempt';details.dataset.id=s.id;details.open=opened.has(s.id);
   const score=s.metrics && s.metrics[config.primary_metric];
   const labels={uploading:'Uploading',queued:'Queued',running:'Running',completed:'Completed',failed:'Failed'};
   const summary=document.createElement('summary');summary.className='run-summary';
   const identity=document.createElement('span');identity.className='run-identity';
   const title=text('span',`Run ${String(data.submissions.length-index).padStart(2,'0')}`);title.className='run-title';
   const date=text('span',time(s.created_at));date.className='run-date';identity.append(title,date);
   const overview=document.createElement('span');overview.className='run-overview';
   if(typeof score==='number' && Number.isFinite(score)){const value=text('span',`${Number(score.toFixed(2))}`);value.className='run-score';const group=document.createElement('span');group.className='run-score-group';group.append(text('span','Score'),value);overview.append(group);}
   const badge=text('span',labels[s.status]||'Unknown');badge.className=`run-status status-${Object.hasOwn(labels,s.status)?s.status:'unknown'}`;overview.append(badge);
   if(s.selected){const published=text('span','Published');published.className='run-published';overview.append(published);}
   const arrow=text('span','+');arrow.className='run-toggle';arrow.setAttribute('aria-hidden','true');overview.append(arrow);
   summary.append(identity,overview);details.append(summary);
   const content=document.createElement('div');content.className='run-content';details.append(content);
   const timing=document.createElement('div');timing.className='run-timing';
   for(const [label,value] of [['Queue wait',queueWait(s)],[s.status==='running'?'Running elapsed':'Execution',s.status==='running'?span(s.started_at,null):duration(s.duration_ms)],['Total',span(s.created_at,s.completed_at)]]){timing.append(text('p',`${label}: ${value}`));}
   content.append(timing);
   if(s.metrics && typeof s.metrics==='object') {
    const metrics=document.createElement('dl');metrics.className='run-metrics';
    for(const [key,value] of Object.entries(s.metrics)){if(typeof value!=='number'||!Number.isFinite(value))continue;const item=document.createElement('div');const label=key==='landing_success_pct'?'Landing success':key===config.primary_metric?'Score':key.replaceAll('_',' ');item.append(text('dt',label),text('dd',`${Number(value.toFixed(2))}${key==='landing_success_pct'?'%':''}`));metrics.append(item);}
    if(metrics.children.length)content.append(metrics);
   }
   if(s.error_category){const error=text('p',errorDetails[s.error_detail_code]||errors[s.error_category]||'Evaluation failed.');error.className='run-error';content.append(error);}
   if(s.status==='completed') {
    const flights=document.createElement('div');flights.className='run-flights';
    if(!s.runs?.length)flights.append(text('p','No flight recordings are available for this attempt.'));
    else {
     flights.append(text('p','Public flights only. Overall metrics also include held-out tests.'));
     for(const run of s.runs) {
      if(!run.replay_available)continue;
      const row=document.createElement('div');row.className='run-flight';
      row.append(text('span',`${run.scenario.replaceAll('_',' ')} · ${Number(run.score.toFixed(2))} / 100 · ${run.success?'Success':'Unsuccessful'}`));
      for(const download of [false,true]) {
       const button=text('button',download?'Download JSON':'View flight');button.type='button';
       button.onclick=async()=>{button.disabled=true;const request=download?null:++replayRequest;
        try {
         const recording=await api('replay',undefined,{id:s.id,run:String(run.run_id)});
         if(download) {
          const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(recording)],{type:'application/json'}));
          link.href=url;link.download=`rocket-${s.id}-run-${run.run_id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
         } else if(request===replayRequest) {
          await viewer.load(recording);$('model-flight').scrollIntoView({behavior:'smooth',block:'start'});
          $('message').textContent=`${run.scenario.replaceAll('_',' ')} loaded. Use Play replay to watch it.`;
         }
        } catch(error){message.textContent=error.message;}finally{button.disabled=false;}
       };
       row.append(button);
      }
      flights.append(row);
     }
    }
    content.append(flights);
   }
   const identifier=text('p',`Attempt ${s.id}`);identifier.className='run-id';content.append(identifier);
   if(s.status==='uploading') {
    const retry=text('button','Retry queueing');retry.type='button';retry.className='model-retry';retry.disabled=busy;retry.onclick=async()=>{retry.disabled=true;try{await api('queue',{id:s.id});await refresh();message.textContent='Your attempt is queued.';}catch(e){const data=await refresh();const attempt=data?.submissions.find(item=>item.id===s.id);if(attempt && (['queued','running','completed'].includes(attempt.status) || (attempt.status==='failed' && attempt.error_category!=='upload_error')))message.textContent=`Upload completed; evaluation is ${attempt.status}.`;else if(!data)message.textContent='Queue confirmation was lost. Check your history when the connection returns.';else message.textContent=e.message;}finally{retry.disabled=false;}};content.append(retry);
    const cancel=text('button','Cancel incomplete upload');cancel.type='button';cancel.className='model-retry';cancel.disabled=busy;cancel.onclick=async()=>{cancel.disabled=true;try{await api('abort',{id:s.id});const data=await refresh();const current=data?.submissions.find(item=>item.id===s.id);message.textContent=current?.status==='failed' && current.error_category==='upload_error'?'Incomplete upload cancelled.':`Attempt status: ${current?.status || 'unavailable'}.`;}catch(e){await refresh();message.textContent=e.message;}finally{cancel.disabled=false;}};content.append(' ',cancel);
   }
   if(s.status==='completed' && s.metrics && typeof s.metrics[config.primary_metric]==='number') {
    const button=text('button',s.selected?'Remove from leaderboard':'Publish this attempt');button.type='button';button.onclick=async()=>{button.disabled=true;try{await api('publish',{id:s.selected?null:s.id});await refresh();message.textContent=s.selected?'Entry removed.':'Attempt published.';}catch(e){message.textContent=e.message;}finally{button.disabled=false;}};content.append(button);
   }
   history.append(details);
  }
  if(focusState){const run=Array.from(history.querySelectorAll('.model-attempt')).find(item=>item.dataset.id===focusState.id);const target=focusState.summary?run?.querySelector('summary'):Array.from(run?.querySelectorAll('button')||[]).find(button=>button.textContent===focusState.label);target?.focus({preventScroll:true});}
  board.replaceChildren();
  if(!data.leaderboard.length){const row=board.insertRow(),cell=row.insertCell();cell.colSpan=5;cell.textContent='No published attempts yet.';}
  data.leaderboard.forEach((entry,i)=>{const row=board.insertRow();if(entry.is_current)row.className='own';[i+1,entry.name+(entry.is_current?' (you)':''),String(entry.score)+Object.entries(entry.metrics||{}).map(([key,value])=>` | ${key}: ${value}`).join(''),duration(entry.duration_ms),time(entry.created_at)].forEach(v=>{row.insertCell().textContent=String(v);});});
 }
 async function refresh(){try{let data=await api('dashboard'); if(data.identity_new){data=await api('dashboard'); if(data.identity_new) { render(data); config=null; history.replaceChildren(text('p','Enable cookies to see your submissions.')); message.textContent='Browser cookies are blocked. Enable cross-site cookies to submit and manage attempts.'; return; }} if(!data.config)throw Error('This exercise is not configured.');render(data);if(!busy)message.textContent='';return data;}catch(e){message.textContent=`${e.message} Retrying automatically.`;return null;}finally{clearTimeout(timer);if(!paused)timer=setTimeout(refresh,10000);}}
 for(const input of [$('model-python'),$('model-weights')]) {const zone=input.closest('.model-drop'); ['dragenter','dragover'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add('dragover');}));['dragleave','drop'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove('dragover');}));zone.addEventListener('drop',e=>{if(e.dataTransfer.files.length)input.files=e.dataTransfer.files;});}
 form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;
  const model=$('model-python').files[0],weights=$('model-weights').files[0];
  if(!config){message.textContent='The submission service is unavailable.';return;}
  if(!model||model.name!=='model.py'||!weights||weights.name!=='weights.safetensors'){message.textContent='Choose files named exactly model.py and weights.safetensors.';return;}
  if(!model.size||model.size>config.model_max_bytes||!weights.size||weights.size>config.weights_max_bytes){message.textContent=`Files must be non-empty and no larger than ${config.model_max_bytes} and ${config.weights_max_bytes} bytes respectively.`;return;}
  busy=true;form.querySelector('button').disabled=true;progress.hidden=false;progress.value=0;message.textContent='Uploading files…';let id,queueAttempted=false;
  try {const created=await api('create',{});id=created.id;await upload(id,model,0,model.size+weights.size);await upload(id,weights,model.size,model.size+weights.size);queueAttempted=true;await api('queue',{id});form.reset();await refresh();message.textContent='Upload complete. Your attempt is queued.';}
  catch(error){
   if(id && !queueAttempted)try{await api('abort',{id});}catch(_){}
   const data=await refresh();const attempt=data?.submissions.find(s=>s.id===id);
   if(queueAttempted && attempt && (['queued','running','completed'].includes(attempt.status) || (attempt.status==='failed' && attempt.error_category!=='upload_error'))) {form.reset();message.textContent=`Upload completed; evaluation is ${attempt.status}.`;}
   else if(queueAttempted && !data) message.textContent='Queue confirmation was lost. Check your history when the connection returns.';
   else if(queueAttempted && attempt?.status==='uploading' && error.status>=400 && error.status<500) message.textContent=error.message;
   else if(queueAttempted && attempt?.status==='uploading') message.textContent='Queue confirmation was lost. Open the attempt below to retry queueing.';
   else message.textContent=error.message;
  }
  finally{busy=false;form.querySelector('button').disabled=false;progress.hidden=true;history.querySelectorAll('.model-retry').forEach(button=>{button.disabled=false;});}
 });
 $('model-name-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('name',{name:$('model-name').value});await refresh();message.textContent='Display name saved.';}catch(error){message.textContent=error.message;}});
 window.addEventListener('pagehide',()=>{paused=true;clearTimeout(timer);});window.addEventListener('pageshow',e=>{paused=false;if(e.persisted)refresh();});
 refresh();
})();
