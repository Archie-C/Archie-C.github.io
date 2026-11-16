import {RevisionBackend,withTimeout} from './api.mjs';
import {escapeHTML as h,renderMarkdown} from './model.mjs';
import {readImport,importTypes,toCSV} from './admin-import.mjs';
import {questionCard,workedSolution,renderQuestionCards} from './question-view.mjs';
import {topicExportRows,topicsToCSV} from './admin-export.mjs';
import {hierarchyFilters} from './admin-filters.mjs';
import {coverageView,coverageTarget} from './admin-coverage.mjs';

const main=document.querySelector('#content'),notice=document.querySelector('#notice'),connection=document.querySelector('#connection');
const nav=document.querySelector('#navigation'),signOut=document.querySelector('#sign-out');
const catalogueTypes=['subjects','specifications','books','chapters','topics','papers','option_groups','options'];
let backend,user,allowed=false,catalogue={},kind='questions',page=0,listing={rows:[],total:0},filters={},busy=false,epoch=0;
let mode='list',input='',filename='',rows=[],preview=null,previewPage=0,invalidOnly=false,pending=null,editing=null,summary=null;
let review=null,reviewQueue=null;
let coverage=null,target=5;
const label=()=>importTypes[kind]?.label||({students:'Students',history:'Import history',coverage:'Question coverage'}[kind]);
const heading=(title,intro='')=>`<div class="eyebrow">A-level / Administration</div><h1>${h(title)}</h1><p class="intro">${h(intro)}</p>`;
const btn=(text,action,secondary=false,disabled=false)=>`<button type="button" data-action="${action}" class="${secondary?'secondary':''}" ${busy||disabled?'disabled':''}>${h(text)}</button>`;
const field=(name,title,value='',type='text',required=false)=>`<label class="field">${h(title)}<input name="${h(name)}" type="${type}" value="${h(value)}" ${required?'required':''}></label>`;
const markdown=(text)=>`<div class="question-content" data-md="${h(text)}"></div>`;
const formatDate=v=>v?new Date(v).toLocaleString('en-GB'):'—';
function message(text,error=false){notice.textContent=text;notice.classList.toggle('error',error);}
async function call(action,payload={}) {
  const current=epoch;
  const {data,error}=await withTimeout(action==='coverage'?backend.client.rpc('revision_admin_coverage'):backend.client.rpc('revision_admin_api',{p_action:action,p_payload:payload}),
    'The Supabase request timed out. Check your connection and project status.',30000);
  if(current!==epoch)throw new Error('Account changed.');
  if(error)throw new Error(action==='coverage'&&['PGRST202','42883'].includes(error.code)?'Question coverage needs database migration 11-question-coverage.sql. Run it in the Supabase SQL Editor, then refresh coverage.':error.message);
  return data;
}
async function run(fn) {
  if(busy)return;busy=true;for(const b of main.querySelectorAll('button'))b.disabled=true;
  connection.textContent='Working…';message('');
  try{await fn();}catch(error){
    message(error.message,true);
    if(/ADMIN_REQUIRED/.test(error.message)){allowed=false;catalogue={};listing={rows:[],total:0};detail=null;resetWork();}
  }finally{busy=false;connection.textContent=allowed?'Administrator access':user?'Access restricted':'Sign in required';render();}
}
function resetWork(){mode='list';input='';filename='';rows=[];preview=null;pending=null;editing=null;summary=null;review=null;reviewQueue=null;}
async function load(){
  if(kind==='coverage'){
    coverage=null;
    const [latest,counts]=await Promise.all([call('catalogue'),call('coverage')]);
    catalogue=latest;coverage=counts;filters=hierarchyFilters(catalogue,filters).values;
  }else if(kind==='topics'){
    catalogue=await call('catalogue');filters=hierarchyFilters(catalogue,filters).values;const matching=topicExportRows(catalogue,filters);
    listing={rows:matching.slice(page*25,(page+1)*25),total:matching.length};
  }else listing=await call('list',{type:kind,limit:25,offset:page*25,...filters});
}
function downloadCSV(text,name){
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportTopics(){
  // Refresh through the guarded API: exports must reflect imported content and
  // current permission, including when this tab has been open for a long time.
  const latest=await call('catalogue'),matching=topicExportRows(latest,filters);
  if(!matching.length){message('No subtopics match these filters.');return;}
  downloadCSV('\uFEFF'+topicsToCSV(matching),'revision-topics.csv');
  message(`Exported ${matching.length} subtopics. Use the id column for question topic_codes.`);
}
function maths(){for(const el of main.querySelectorAll('[data-md]'))renderMarkdown(el,el.dataset.md);renderQuestionCards(main);}
const selectOptions=(options,value='')=>options.map(([id,text])=>`<option value="${h(id)}" ${String(value)===String(id)?'selected':''}>${h(text)}</option>`).join('');
function select(name,title,options,value='') {
  return `<label class="field">${h(title)}<select name="${name}" aria-label="${h(title)}">${selectOptions(options,value)}</select></label>`;
}
function hierarchyOptions(scope){return {
  specification:[['','All specifications'],...scope.specifications.map(s=>[s.id,s.title])],
  chapter:[['','All chapters'],...scope.chapters.map(c=>[c.id,`${c.number} · ${c.title} (${c.id})`])],
  topic:[['','All subtopics'],...scope.topics.map(t=>[t.id,`${t.number} · ${t.title}`])]
};}
function updateHierarchy(form,changed){
  const scope=hierarchyFilters(catalogue,Object.fromEntries(new FormData(form)),changed);
  for(const [name,options] of Object.entries(hierarchyOptions(scope))){
    const control=form.elements.namedItem(name);if(control)control.innerHTML=selectOptions(options,scope.values[name]);
  }
}
function pager(current,total,action) {
  return `<div class="pager"><span>${total?`${current*25+1}–${Math.min((current+1)*25,total)} of ${total}`:'0 records'}</span><div class="actions">${btn('Previous',`${action}-prev`,true,current===0)}${btn('Next',`${action}-next`,true,(current+1)*25>=total)}</div></div>`;
}
function render(){
  signOut.hidden=!user;nav.hidden=!allowed;
  for(const a of nav.querySelectorAll('a'))a.classList.toggle('active',a.hash===`#${catalogueTypes.includes(kind)?'chapters':kind}`);
  if(!backend?.configured){main.innerHTML=heading('Setup required','Configure the existing Supabase connection in a-level/config.js, then run database migration 06-admin.sql.');return;}
  if(!user){main.innerHTML=heading('Revision administration','Sign in with your existing administrator account.')+`<form id="login" class="card login"><h2>Welcome back</h2>${field('email','Email','','email',true)}${field('password','Password','','password',true)}<button type="submit" ${busy?'disabled':''}>Sign in</button></form>`;return;}
  if(!allowed){main.innerHTML=heading('Administrator access required','This account does not have permission to manage revision content or view student data.')+'<p class="muted">The project owner grants access to an existing Auth user through the Supabase SQL Editor. See a-level/docs/admin.md for setup.</p><a class="button secondary" href="../a-level/">Return to revision</a>';return;}
  main.innerHTML=heading(label(),kind==='coverage'?'Spot gaps in the question bank and see where to write next.':kind==='questions'?'Maintain reviewed questions while preserving every student attempt.':kind==='exams'?'Maintain paper dates by examination year. Changes feed the existing revision scheduler.':kind==='students'?'Read-only access to existing revision profiles, progress and recent practice.':kind==='history'?'Review confirmed imports, errors and record changes.':'Manage the existing subject → specification → book → chapter → subtopic hierarchy.')+
    (catalogueTypes.includes(kind)?`<nav class="subnav" aria-label="Content types">${catalogueTypes.map(k=>`<a href="#${k}" ${k===kind?'aria-current="page"':''}>${h(importTypes[k].label)}</a>`).join('')}</nav>`:'');
  if(kind==='coverage'){
    main.insertAdjacentHTML('beforeend',`<div class="coverage-refresh">${btn('Refresh coverage','coverage-refresh',true)}</div>`+
      (coverage===null?'<div class="card empty">Coverage is unavailable. Refresh to try again; question counts have not been loaded.</div>':coverageView(catalogue,coverage,filters,target,page,busy)));
  }else if(mode==='review')renderReview();else if(mode==='review-done')renderReviewDone();else if(mode==='input')renderInput();else if(mode==='preview')renderPreview();else if(mode==='edit')renderEdit();else if(mode==='detail')renderDetail();else if(mode==='summary')renderSummary();else renderList();
  maths();
  if(mode==='review'&&review.focus){review.focus=false;main.focus({preventScroll:true});main.scrollIntoView({block:'start'});}
}
function renderList(){
  const hierarchy=hierarchyOptions(hierarchyFilters(catalogue,filters));
  main.insertAdjacentHTML('beforeend',`<div class="section-head"><h2>${h(label())}</h2><div class="actions">${kind==='questions'?btn('Review drafts','review-drafts'):''}${kind==='topics'?btn('Export CSV','export-topics',true,!listing.total):''}${importTypes[kind]?btn('Import CSV','import',kind==='questions'):''}</div></div>${kind==='topics'?'<p class="muted">Export all matching subtopics across every page, with their IDs, chapters, books and specifications. Apply filters first to choose what to share with a question-writing agent.</p>':''}<form id="filters" class="filters"><label class="field">Search<input name="search" type="search" value="${h(filters.search||'')}" placeholder="Search ${h(label().toLowerCase())}"></label>${kind==='questions'?[
    select('subject','Subject',[['','All subjects'],...(catalogue.subjects||[]).map(s=>[s.id,s.name])],filters.subject),
    select('specification','Specification',hierarchy.specification,filters.specification),
    select('topic','Topic',hierarchy.topic,filters.topic),
    select('difficulty','Difficulty',[['','All difficulties'],...[1,2,3,4,5].map(n=>[n,n])],filters.difficulty),
    select('status','Status',[['','All statuses'],...['draft','verified','archived','withdrawn'].map(s=>[s,s])],filters.status),
    select('sort','Sort by',[['id','Identifier'],['title','Question text']],filters.sort)
  ].join(''):kind==='topics'?[
    select('subject','Subject',[['','All subjects'],...(catalogue.subjects||[]).map(s=>[s.id,s.name])],filters.subject),
    select('specification','Specification',hierarchy.specification,filters.specification),
    select('chapter','Chapter',hierarchy.chapter,filters.chapter),
    select('status','Status',[['active','Active only'],['all','All statuses'],['archived','Archived only']],filters.status||'active'),
    select('sort','Sort by',[['id','Identifier'],['title','Title / name']],filters.sort)
  ].join(''):kind==='exams'?[
    field('year','Exam year',filters.year||'','number'),
    select('specification','Specification',[['','All specifications'],...(catalogue.specifications||[]).map(s=>[s.id,s.title])],filters.specification),
    select('status','Status',[['','All statuses'],['estimated','Estimated'],['confirmed','Confirmed']],filters.status),
    select('sort','Sort by',[['id','Subject / specification / paper'],['date','Exam date']],filters.sort)
  ].join(''):select('sort','Sort by',kind==='history'?[['newest','Newest first'],['oldest','Oldest first']]:kind==='students'?[['id','Account identifier'],['activity','Recent activity']]:[['id','Identifier'],['title','Title / name']],filters.sort)}<button type="submit" ${busy?'disabled':''}>Apply filters</button></form>`);
  if(!listing.rows.length){main.insertAdjacentHTML('beforeend','<div class="card empty">No records match. Add content with a CSV import or adjust your search.</div>');}
  else{
    let headers,body;
    if(kind==='questions'){
      headers=['Question','Status / version','Difficulty / time','Performance¹','Actions'];
      body=listing.rows.map(q=>`<tr><td>${h(q.id)}<small>${h(q.prompt_md.slice(0,160))}</small></td><td><span class="tag">${h(q.status)}</span><small>Version ${q.version}</small></td><td>${q.difficulty} / 5<small>${q.estimated_seconds/60} min · ${q.total_marks??'—'} marks</small></td><td>${q.statistics.attempts} attempts<small>Correctness: ${q.statistics.mean_correctness?Number(q.statistics.mean_correctness).toFixed(2):'—'} / 5<br>Ease: ${q.statistics.mean_ease?Number(q.statistics.mean_ease).toFixed(2):'—'} / 5</small></td><td><button class="text-button" data-review="${h(q.id)}">Review question</button><br><button class="text-button" data-record="${h(q.id)}">View / edit</button></td></tr>`).join('');
    }else if(kind==='exams'){
      headers=['Subject / specification','Paper / sitting','Date / time','Status','Actions'];
      body=listing.rows.map(e=>{const spec=catalogue.specifications.find(s=>s.id===e.specification),subject=catalogue.subjects.find(s=>s.id===spec?.subject_id);return `<tr><td>${h(subject?.name)}<small>${h(spec?.title)} · ${h(e.exam_board)}</small></td><td>${h(e.paper_name)}<small>${h(e.exam_id)}</small></td><td>${h(e.exam_date)}<small>${h(e.start_time||'Time not set')} · ${h(e.duration_minutes??'—')} min</small></td><td><span class="tag">${h(e.status)}</span></td><td><button class="text-button" data-record="${h(e.exam_id)}">View / edit</button></td></tr>`;}).join('');
    }else if(kind==='students'){
      headers=['Account','Revision settings','Activity','Actions'];
      body=listing.rows.map(s=>`<tr><td>${h(s.email||s.user_id)}<small>${h(s.user_id)}</small></td><td>${h(s.daily_minutes??'Not onboarded')} min/day<small>${h(s.timezone)} · ${h(s.exam_year)}</small></td><td>${s.attempts} attempts<small>${h(formatDate(s.last_activity))}</small></td><td><button class="text-button" data-detail="${h(s.user_id)}">View progress</button></td></tr>`).join('');
    }else if(kind==='history'){
      headers=['Imported','Type / file','Administrator','Result','Actions'];
      body=listing.rows.map(r=>`<tr><td>${h(formatDate(r.created_at))}</td><td>${h(importTypes[r.import_type]?.label)}<small>${h(r.filename||'Pasted CSV / manual edit')}</small></td><td class="admin-meta">${h(r.admin_id)}</td><td>${r.result.inserted} new · ${r.result.updated} updated<small>${r.result.skipped} skipped · ${r.result.failed} failed</small>${r.result.error?`<span class="validation-error">${h(r.result.error)}</span>`:''}</td><td><button class="text-button" data-detail="${h(r.id)}">View changes</button></td></tr>`).join('');
    }else{
      headers=['Identifier','Title / name','Parent','Actions'];
      body=listing.rows.map(r=>`<tr><td>${h(r.id)}${r.archived?'<small>Archived</small>':''}</td><td>${h(r.title||r.name)}${r.reminder_reviewed?'<small>Reviewed example</small>':''}${kind==='option_groups'?`<small>Choose ${r.min_choices}?${r.max_choices}</small>`:''}</td><td>${h(r.chapter_id||r.book_id||r.specification_id||r.subject_id||r.group_id||r.board)}</td><td><button class="text-button" data-record="${h(r.id)}">View / edit</button></td></tr>`).join('');
    }
    main.insertAdjacentHTML('beforeend',table(headers,body)+(kind==='questions'?'<p class="muted">¹ Statistics combine all versions of the same question. Editing preserves past attempts and their original question versions.</p>':''));
  }
  main.insertAdjacentHTML('beforeend',pager(page,listing.total,'list'));
}
function table(headers,body){return `<div class="table-wrap" tabindex="0" aria-label="Scrollable records"><table class="admin-table"><thead><tr>${headers.map(s=>`<th scope="col">${h(s)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;}
function renderInput(){
  main.insertAdjacentHTML('beforeend',`<p class="import-steps"><strong>1 Input</strong> → 2 Parse & validate → 3 Preview → 4 Confirm → 5 Import</p><form id="csv-input" class="card"><div class="section-head"><h2>Import ${h(label().toLowerCase())}</h2>${btn('Download CSV template','template',true)}</div><label class="field">Upload a .csv file<input id="csv-file" type="file" accept=".csv,text/csv"></label><p class="muted">${h(filename||'Or paste CSV below.')} · Up to 500 rows / 2 MB.</p><label class="field">CSV content<textarea id="csv-text" name="csv" rows="12" spellcheck="false" required>${h(input)}</textarea></label><p class="muted">${kind==='questions'?'Use stable subtopic IDs separated by |. Backslashes and LaTeX are preserved. New questions default to draft. Review the question and solution before verifying.':kind==='exams'?'Missing subjects, specifications and papers are created only after you confirm the preview. Topics can be linked later. Optional subject_id, subject_name and specification_title give new records meaningful names; otherwise the specification code is used. Dates use YYYY-MM-DD; times use HH:MM.':kind==='option_groups'?'Create a group for a specification and set its minimum / maximum choices. Use 1 / 1 for exactly one option.':kind==='options'?'Import groups first. Each choice can contain book_ids, chapter_ids or topic_codes, separated by |. A prerequisite must be an existing choice in the same group.':'Import parents first. Use existing parent IDs from the corresponding content table. Updates keep student confidence and practice history.'}</p><div class="actions"><button type="submit">Parse, validate & preview</button>${btn('Cancel','cancel',true)}</div></form>`);
}
function renderPreview(){
  const all=preview.rows,counts={new:0,update:0,unchanged:0,invalid:0};for(const r of all)counts[r.operation]++;
  const visible=invalidOnly?all.filter(r=>r.operation==='invalid'):all;
  main.insertAdjacentHTML('beforeend',`<p class="import-steps">1 Input → 2 Parse & validate → <strong>3 Preview & confirm</strong> → 4 Import</p><div class="callout">${counts.new} new · ${counts.update} updates · ${counts.unchanged} unchanged · ${counts.invalid} invalid. Nothing has been imported.${counts.invalid?' Correct every invalid row before confirming.':''}</div><label class="checkbox"><input id="invalid-only" type="checkbox" ${invalidOnly?'checked':''}> Show invalid rows only</label>`+
    table(['CSV line / identifier','Proposed change','Content & validation'],visible.slice(previewPage*25,(previewPage+1)*25).map(r=>`<tr class="row-${r.operation}"><td>Line ${h(r.line)}<small>${h(r.id)}</small></td><td><span class="tag">${h(r.operation)}</span></td><td>${r.error?`<p class="validation-error">${h(r.error)}</p>`:recordMath(r.after)}${diff(r)}</td></tr>`).join(''))+pager(previewPage,visible.length,'preview')+
    `<form id="confirm"><label class="checkbox"><input name="reviewed" type="checkbox" required ${!preview.valid?'disabled':''}> I have reviewed these changes and want to import this batch.</label><div class="actions"><button type="submit" ${!preview.valid||busy?'disabled':''}>Confirm import</button>${btn('Back to input','back-input',true)}${btn('Cancel','cancel',true)}</div></form>`);
  const additions=catalogueSummary(all);
  if(additions)main.querySelector('#confirm').insertAdjacentHTML('beforebegin',`<div class="callout">On confirmation, this batch also creates ${h(additions)}. Topics can be mapped later under Papers & chapter mappings.</div>`);
}
const entityNames={subjects:'subject',specifications:'specification',papers:'paper',paper_codes:'paper-code mapping'};
function catalogueSummary(changes){
  const counts={};for(const row of changes)for(const c of row.catalogue_changes||[])counts[c.entity]=(counts[c.entity]||0)+1;
  return Object.entries(counts).map(([type,count])=>`${count} ${entityNames[type]}${count===1?'':'s'}`).join(', ');
}
function diff(r){const retirements=(r.effects||[]).filter(e=>e.question_id),books=(r.effects||[]).filter(e=>e.create_book);return `${(r.notes||[]).map(note=>`<p class="muted">${h(note)}</p>`).join('')}${r.catalogue_changes?.length?`<p>Will create: ${r.catalogue_changes.map(c=>`${h(entityNames[c.entity])} <code>${h(c.id)}</code>`).join(', ')}.</p>`:''}${books.map(b=>`<p>Will create a chapter container for specification <code>${h(b.specification_id)}</code>.</p>`).join('')}${retirements.length?`<p class="validation-error">Also retires ${retirements.length} question version(s): ${h(retirements.map(q=>`${q.question_id} v${q.version} → ${q.after}`).join(', '))}. Historical attempts remain.</p>`:''}<details class="diff"><summary>Inspect record changes</summary><h3>Before</h3><pre>${h(JSON.stringify(r.before,null,2)||'New record')}</pre><h3>After</h3><pre>${h(JSON.stringify(r.after,null,2))}</pre>${r.catalogue_changes?.length?`<h3>Related catalogue records</h3><pre>${h(JSON.stringify(r.catalogue_changes,null,2))}</pre>`:''}</details>`;}
function recordMath(record){
  if(!record)return '';
  if(kind==='questions')return questionPreview(record,true);
  if(kind==='chapters')return `<h3>${h(record.title)}</h3>${markdown(record.description_md)}${markdown(record.example_md)}`;
  if(kind==='exams')return `${h(record.paper_name)}<small>${h(record.exam_date)} ${h(record.start_time)} · ${h(record.status)}</small>`;
  return h(record.title||record.name||record.id);
}
function questionPreview(record,revealed=false){
  let assets=record.assets_json||[];
  try{if(typeof assets==='string')assets=JSON.parse(assets);if(!Array.isArray(assets))throw new Error();}
  catch{return '<p class="validation-error">Assets must be a JSON array to preview this question.</p>';}
  return `<div class="student-preview">${questionCard({prompt_md:record.question,difficulty:record.difficulty,total_marks:record.marks,assets})}${revealed?workedSolution(record.answer):''}</div>`;
}
async function openReview(id){
  const record=await call('record',{type:'questions',id});
  if(!record)throw new Error('Question no longer available.');
  editing=record;preview=null;pending=null;rows=[];
  review={focus:true,stale:false};
  mode='review';
}
async function nextReview(){
  // Verified drafts leave this result set, so keep the offset after verification.
  // Skipped drafts remain in it, so advance the offset when skipping.
  const result=await call('list',{...reviewQueue.filters,type:'questions',limit:1,offset:reviewQueue.offset});
  reviewQueue.remaining=Math.max(0,result.total-reviewQueue.offset);
  if(!result.rows.length){mode='review-done';review=null;editing=null;preview=null;return;}
  await openReview(result.rows[0].id);
}
function renderReview(){
  const canVerify=editing.status==='draft'&&!review.stale;
  const topics=(editing.topic_codes||'').split('|').map(id=>{
    const topic=catalogue.topics.find(t=>t.id===id),chapter=catalogue.chapters.find(c=>c.id===topic?.chapter_id);
    return topic?`${chapter?.title||''} / ${topic.number} ${topic.title}`:id;
  });
  main.insertAdjacentHTML('beforeend',`<div class="section-head"><div><h2>Review question</h2><p class="muted admin-meta">${h(editing.question_id)} · Version ${h(editing._version)} · ${h(editing.status)}</p></div>${btn('Back to questions','cancel',true,Boolean(pending))}</div>${reviewQueue?`<p class="muted">${reviewQueue.remaining} draft${reviewQueue.remaining===1?'':'s'} remaining · ${reviewQueue.verified} verified</p>`:''}<p class="muted">${h(topics.join(' · '))} · ${h(Number(editing.estimated_minutes))} min</p>${questionPreview(editing,true)}<form id="question-review" class="section">${!canVerify?`<p class="callout">${review.stale?'This question changed during review. Reload it and check the latest content before verifying.':editing.status==='verified'?'This question is already verified.':'Only drafts can be verified here. Use View / edit to prepare a draft.'}</p>`:''}${preview&&!preview.valid?`<p class="validation-error">${h(preview.rows[0]?.error||'Correct the question before verifying.')}</p>`:''}<p class="muted section">Verify when the question, solution and topics are correct.</p><div class="actions"><button type="submit" ${busy||!canVerify?'disabled':''}>${pending?'Retry verification':reviewQueue?'Verify & next':'Verify question'}</button>${btn('Edit question','review-edit',true,Boolean(pending))}${reviewQueue?btn('Skip','review-skip',true,Boolean(pending)):''}${review.stale?btn('Reload question','review-reload',true):''}</div></form>`);
}
function renderReviewDone(){
  main.insertAdjacentHTML('beforeend',`<div class="card"><h2>No more drafts to review</h2><p>${reviewQueue?.verified||0} question(s) verified this session. ${reviewQueue?.offset?'Skipped drafts remain unchanged.':'No further drafts match these filters.'}</p><div class="actions">${btn('Back to questions','cancel')}${btn('Review drafts again','review-drafts',true)}</div></div>`);
}
async function previewVerification(){
  const row=Object.fromEntries(importTypes.questions.columns.map(key=>{
    const value=editing[key];return [key,value==null?'':typeof value==='object'?JSON.stringify(value):String(value)];
  }));
  rows=[{...row,status:'verified',line:2}];
  preview=await call('preview',{type:'questions',rows});pending=null;
  // The token protects confirmation; this comparison also protects the time
  // spent reviewing before the preview was requested (including status changes).
  if(JSON.stringify(preview.rows[0]?.before)!==JSON.stringify(editing)){
    review.stale=true;preview=null;throw new Error('This question changed during review. Reload it and check the latest content.');
  }
}
async function confirmVerification(){
  pending??={type:'questions',rows,token:preview.token,filename:null,request_id:crypto.randomUUID()};
  let result;
  try{result=await call('import',pending);}catch(error){
    throw new Error(`${error.message} The result may be uncertain. Use Retry verification to retry the same request safely; keep this tab open.`);
  }
  pending=null;
  if(result.failed){preview=null;review.stale=/PREVIEW_STALE/.test(result.error);throw new Error(result.error||'Verification failed. No changes were applied.');}
  const id=editing.question_id;
  if(reviewQueue){reviewQueue.verified++;mode='review-done';review=null;editing=null;preview=null;await nextReview();}
  else{resetWork();await load();}
  message(`${id} verified. The change is recorded in Import history.`);
}
const titles={question_id:'Question ID',topic_codes:'Topic codes (subtopic IDs, separated by |)',question:'Question (Markdown / LaTeX)',answer:'Worked answer / mark scheme',estimated_minutes:'Estimated minutes',assets_json:'Assets (JSON)',exam_id:'Exam ID',exam_board:'Exam board',specification:'Specification ID / code',paper_code:'Paper code / ID',paper_name:'Paper name',subject_id:'Subject ID (optional for new records)',subject_name:'Subject name (optional for new records)',specification_title:'Specification title (optional for new records)',exam_date:'Exam date',start_time:'Start time (HH:MM)',duration_minutes:'Duration in minutes',source_url:'Source URL',description_md:'Description (Markdown / LaTeX)',example_md:'Representative example (Markdown / LaTeX)',reminder_reviewed:'Reminder reviewed',chapter_ids:'Chapter IDs (separated by |)',min_choices:'Minimum choices',max_choices:'Maximum choices',group_id:'Option group ID',book_ids:'Book IDs (separated by |)',requires_option_id:'Prerequisite option ID (optional)'};
function renderEdit(){
  const spec=importTypes[kind];
  main.insertAdjacentHTML('beforeend',`<form id="edit" class="card"><h2>Edit ${h(editing[spec.key])}</h2><p class="muted">${kind==='questions'?'Saving a content change creates a new immutable version. Existing attempts retain the original content and solution.':'Stable IDs and existing topic parents are preserved. Saving first opens a validated preview.'}</p><div class="form-grid">${spec.columns.map(name=>{
    const value=editing[name]??'',title=titles[name]||name.replaceAll('_',' ');
    if(['question','answer','description_md','example_md','assets_json','topic_codes','chapter_ids','book_ids'].includes(name))return `<label class="field">${h(title)}<textarea name="${name}" aria-label="${h(title)}" rows="4" ${spec.required.includes(name)?'required':''}>${h(typeof value==='object'?JSON.stringify(value):value)}</textarea></label>`;
    if(name==='status')return select(name,title,(kind==='questions'?['draft','verified','archived','withdrawn']:['estimated','confirmed']).map(s=>[s,s]),value);
    if(['required','reminder_reviewed','archived'].includes(name))return select(name,title,[['false','false'],['true','true']],value||'false');
    return `<label class="field">${h(title)}<input name="${name}" aria-label="${h(title)}" value="${h(value)}" ${name===spec.key?'readonly':''} ${spec.required.includes(name)?'required':''} type="${name==='exam_date'?'date':name==='start_time'?'time':'text'}"></label>`;
  }).join('')}</div><div id="edit-maths" class="record-preview">${recordMath(editing)}</div><div class="actions"><button type="submit">Validate & preview changes</button>${kind==='questions'&&editing.status!=='archived'?btn('Archive question','archive',true):''}${btn('Cancel','cancel',true)}</div></form>`);
}
function renderSummary(){
  main.insertAdjacentHTML('beforeend',`<div class="card"><h2>${summary.failed?'Import failed — batch rolled back':'Import complete'}</h2><p class="section">${summary.inserted} inserted · ${summary.updated} updated · ${summary.skipped} skipped · ${summary.failed} failed</p>${summary.error?`<p class="validation-error">${h(summary.error)}</p>`:''}<p class="muted">Import ID: ${h(summary.id)}. This result and its changes are available in Import history.</p><div class="actions">${btn('Back to records','cancel')}${btn('Import another CSV','import',true)}</div></div>`);
  const additions=!summary.failed&&catalogueSummary(preview?.rows||[]);
  if(additions)main.querySelector('.card').insertAdjacentHTML('beforeend',`<p class="section">Also created ${h(additions)}. Existing topic mappings were preserved.</p>`);
}
let detail;
function renderDetail(){
  if(kind==='history')main.insertAdjacentHTML('beforeend',`<p>${h(formatDate(detail.created_at))} · ${h(detail.import_type)} · ${h(detail.filename||'Pasted CSV / manual edit')}</p><p class="muted">Administrator: ${h(detail.admin_id)}</p>${detail.result.error?`<p class="validation-error">${h(detail.result.error)}</p>`:''}${(detail.changes||[]).map(r=>`<article class="card section"><h2>${h(r.id)} · ${h(r.operation)}</h2>${r.error?`<p class="validation-error">${h(r.error)}</p>`:''}${diff(r)}</article>`).join('')}<div class="actions">${btn('Back to history','cancel',true)}</div>`);
  else {
    const enrolled=(detail.enrolments||[]).map(id=>catalogue.books.find(b=>b.id===id)).filter(Boolean),specs=[...new Set(enrolled.map(b=>b.specification_id))];
    const selectedChapters=catalogue.chapters.filter(c=>detail.selected_chapter_ids?detail.selected_chapter_ids.includes(c.id):enrolled.some(b=>b.id===c.book_id)),covered=detail.progress.filter(p=>p.confidence&&selectedChapters.some(c=>c.id===p.chapter_id)).length;
    main.insertAdjacentHTML('beforeend',`<div class="card"><h2>Revision profile</h2><p>${detail.profile?`${detail.profile.daily_minutes} minutes/day · ${h(detail.profile.timezone)} · Exam year ${detail.profile.exam_year}`:'This account has not started revision.'}</p><p>Specifications: ${h(specs.map(id=>catalogue.specifications.find(s=>s.id===id)?.title||id).join(', ')||'None')}</p><p>Books: ${h(enrolled.map(b=>b.title).join(', ')||'None')}</p><p>Selected options: ${h((detail.selected_options||[]).map(id=>catalogue.options?.find(o=>o.id===id)?.title||id).join(', ')||'None')}</p><p>Syllabus coverage: ${covered} / ${selectedChapters.length} chapters marked covered.</p></div><h2 class="section">Chapter progress</h2>`+table(['Chapter','Confidence','Proficiency / uncertainty','Practice'],detail.progress.map(p=>`<tr><td>${h(catalogue.chapters.find(c=>c.id===p.chapter_id)?.title||p.chapter_id)}</td><td>${p.confidence??'Not covered'}</td><td>${(Number(p.proficiency)*100).toFixed(1)}%<small>Posterior SD: ${(Math.sqrt(Number(p.variance))*100).toFixed(1)}%</small></td><td>${p.attempts} attempts<small>${h(formatDate(p.last_attempt_at))}</small></td></tr>`).join(''))+
      '<h2 class="section">Recent revision activity</h2>'+table(['Completed','Question / version','Correctness / ease','Time'],detail.activity.map(a=>`<tr><td>${h(formatDate(a.completed_at))}</td><td>${h(a.question_id)} / ${a.question_version}</td><td>${a.correctness} / ${a.ease}</td><td>${Math.ceil(a.active_seconds/60)} min</td></tr>`).join(''))+`<div class="actions">${btn('Back to students','cancel',true)}</div>`);
  }
}
async function makePreview(newRows){rows=newRows;preview=await call('preview',{type:kind,rows});previewPage=0;invalidOnly=false;pending=null;mode='preview';}
async function action(name){
  if(name==='reload'){location.reload();}
  else if(name==='coverage-refresh'){page=0;await load();}
  else if(name==='coverage-prev'||name==='coverage-next'){page+=name.endsWith('next')?1:-1;}
  else if(name==='export-topics'){await exportTopics();}
  else if(name==='review-drafts'){
    resetWork();reviewQueue={filters:{...filters,status:'draft'},offset:0,remaining:0,verified:0};await nextReview();
  }
  else if(name==='review-edit'){review=null;reviewQueue=null;preview=null;mode='edit';}
  else if(name==='review-reload'){await openReview(editing.question_id);}
  else if(name==='review-skip'){reviewQueue.offset++;await nextReview();}
  else if(name==='import'){resetWork();mode='input';}
  else if(name==='cancel'){resetWork();await load();}
  else if(name==='back-input'){mode=editing?'edit':'input';pending=null;}
  else if(name==='template'){
    downloadCSV(toCSV([importTypes[kind].columns]),`revision-${kind}-template.csv`);
  }else if(name==='archive'){
    if(!confirm('Archive this question? It will leave future practice queues. Existing attempts and active questions are retained. Review and confirm the proposed change on the next screen.'))return;
    const form=new FormData(document.querySelector('#edit'));form.set('status','archived');await makePreview([{...Object.fromEntries(form),line:2}]);
  }else if(name.startsWith('list-')){page+=name.endsWith('next')?1:-1;await load();}
  else if(name.startsWith('preview-'))previewPage+=name.endsWith('next')?1:-1;
  else if(name==='retry')await confirmImport();
}
async function confirmImport(){
  pending??={type:kind,rows,token:preview.token,filename:filename||null,request_id:crypto.randomUUID()};
  // Keep this exact payload after a lost response; retrying does not duplicate writes.
  try{summary=await call('import',pending);}catch(error){
    mode='preview';throw new Error(`${error.message} The result may be uncertain. Confirm again to retry the same request safely; keep this tab open.`);
  }
  mode='summary';pending=null;catalogue=await call('catalogue');
}
main.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||busy)return;
  if(button.dataset.action)run(()=>action(button.dataset.action));
  else if(button.hasAttribute('data-coverage-status'))run(async()=>{filters.coverage=button.dataset.coverageStatus;page=0;});
  else if(button.dataset.coverageTopic)run(async()=>{
    const topic=button.dataset.coverageTopic;kind='questions';filters={topic};page=0;resetWork();
    history.replaceState(null,'','#questions');await load();
  });
  else if(button.dataset.review)run(async()=>{reviewQueue=null;await openReview(button.dataset.review);});
  else if(button.dataset.record)run(async()=>{editing=await call('record',{type:kind,id:button.dataset.record});if(!editing)throw new Error('Record no longer available.');mode='edit';});
  else if(button.dataset.detail)run(async()=>{detail=await call(kind==='history'?'history_detail':'student',{id:button.dataset.detail});mode='detail';});
});
main.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target;
  run(async()=>{
    // Content records have an input named "id", which shadows form.id in browsers.
    const formId=form.getAttribute('id');
    if(formId==='login'){
      const f=new FormData(form),{data,error}=await backend.client.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});
      if(error)throw error;await signedIn(data.user);
    }else if(formId==='filters'){
      const selected=Object.fromEntries(new FormData(form));
      if(kind==='coverage'){
        target=coverageTarget(selected.target);delete selected.target;
        filters=hierarchyFilters(catalogue,selected).values;page=0;
      }else{filters=['topics','questions'].includes(kind)?hierarchyFilters(catalogue,selected).values:selected;page=0;await load();}
    }
    else if(formId==='question-review'){
      if(review.stale||editing.status!=='draft')throw new Error('Reload the latest draft before verifying.');
      if(!pending){
        await previewVerification();
        if(!preview.valid)throw new Error(preview.rows[0]?.error||'Correct the question before verifying.');
      }
      await confirmVerification();
    }
    else if(formId==='csv-input'){input=form.elements.csv.value;await makePreview(readImport(kind,input));}
    else if(formId==='edit'){
      const row=Object.fromEntries(new FormData(form));
      if(['chapters','topics'].includes(kind)&&row.archived==='true'&&!editing.archived&&
        !confirm('Archive this topic and retire its linked verified questions from future practice? Historical student records remain. Review the affected questions in the preview before confirming.'))return;
      editing={...editing,...row};await makePreview([{...row,line:2}]);
    }
    else if(formId==='confirm')await confirmImport();
  });
});
main.addEventListener('input',event=>{
  if(event.target.id==='csv-text'){input=event.target.value;filename='';}
  if(event.target.closest('#edit')){
    const values=Object.fromEntries(new FormData(document.querySelector('#edit'))),el=document.querySelector('#edit-maths');el.innerHTML=recordMath(values);maths();
  }
});
main.addEventListener('change',event=>{
  if(event.target.closest('#filters')&&['topics','questions','coverage'].includes(kind)&&['subject','specification','chapter'].includes(event.target.name))
    updateHierarchy(event.target.form,event.target.name);
  if(event.target.id==='invalid-only'){invalidOnly=event.target.checked;previewPage=0;render();}
  if(event.target.id==='csv-file'){
    const file=event.target.files[0];if(!file)return;
    run(async()=>{if(!/\.csv$/i.test(file.name)||file.size>2_000_000)throw new Error('Choose a .csv file up to 2 MB.');input=await file.text();filename=file.name;});
  }
});
window.addEventListener('hashchange',()=>run(async()=>{const next=location.hash.slice(1)||'questions';if(!importTypes[next]&&!['students','history','coverage'].includes(next))return;kind=next;filters={};page=0;resetWork();if(allowed)await load();}));
signOut.addEventListener('click',()=>run(async()=>{const {error}=await backend.client.auth.signOut();if(error)throw error;clearAccount();}));
function clearAccount(){epoch++;user=null;allowed=false;catalogue={};coverage=null;listing={rows:[],total:0};detail=null;resetWork();render();}
async function signedIn(authUser){
  const current=++epoch;user=authUser;allowed=false;
  const {data,error}=await withTimeout(backend.client.rpc('revision_is_admin'),'Checking admin access in Supabase timed out. Check your connection and project status.',30000);
  if(error)throw new Error('Admin setup is unavailable. Run 06-admin.sql in this Supabase project.');
  if(current!==epoch)throw new Error('Account changed.');
  allowed=data===true;
  if(allowed){catalogue=await call('catalogue');await load();}
}
async function init(){
  try{
    backend=new RevisionBackend();const initial=location.hash.slice(1);if(importTypes[initial]||['students','history','coverage'].includes(initial))kind=initial;
    if(!backend.configured){render();return;}
    connection.textContent='Checking saved sign-in…';
    const {data,error}=await backend.getSession();if(error)throw error;
    backend.client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){clearAccount();connection.textContent='Sign in required';}
      if(event==='SIGNED_IN'&&user&&session?.user.id!==user.id){clearAccount();message('Account changed. Reload to check access for the new session.');}
    });
    if(data.session)await run(()=>signedIn(data.session.user));else{connection.textContent='Sign in required';render();}
  }catch(error){
    message(error.message,true);connection.textContent='Connection needs attention';
    main.innerHTML=heading('Your admin space could not load.',error.message)+'<p class="muted">Close other revision/admin tabs and reload. Saved revision work has been kept.</p>'+btn('Retry connection','reload');
  }
}
init();
