import {RevisionBackend,Outbox} from './api.mjs';
import {timezoneGroups} from './timezones.mjs';
import {optionRequirement,validateOptionSelection} from './options.mjs';
import {escapeHTML as h,formatTime,minutes,percent,activeItem,selectedChapters,selectedSubtopics,chapterProgress,usedSeconds,relevantExams,daysUntil,renderMarkdown,safeURL} from './model.mjs';
import {questionCard,renderQuestionCards,renderQuestionMarkdown} from './question-view.mjs';

const main=document.querySelector('#content');
const notice=document.querySelector('#notice');
const connection=document.querySelector('#connection');
const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const easeLabels=["Couldn't attempt",'Very difficult','Moderate','Easy','Effortless'];
const correctnessLabels=['None correct','A little correct','About half','Mostly correct','Completely correct'];
let backend,user,data,outbox,draft,weekly,busy=false,wakeLock=null,lastTick=performance.now(),checkpointAt=0;
let view=location.hash.slice(1)||'today',searchFilter='',uncoveredOnly=false;
const chapterTitle=id=>data?.chapters.find(c=>c.id===id)?.title||'Chapter';
const chapterBook=id=>data?.books.find(b=>b.id===data.chapters.find(c=>c.id===id)?.book_id)?.title||'';
const title=(eyebrow,heading,intro='')=>`<div class="eyebrow">${h(eyebrow)}</div><h1>${h(heading)}</h1>${intro?`<p class="intro">${h(intro)}</p>`:''}`;
const button=(label,action,kind='')=>`<button type="button" data-action="${action}" class="${kind}" ${busy?'disabled':''}>${h(label)}</button>`;
function message(text,error=false) {
  const recovery=notice.querySelector('[data-recovery]');
  notice.textContent=text;notice.classList.toggle('error',error);
  if(error&&outbox?.blocked&&recovery)notice.append(' ',recovery);
}
function errorMessage(error) {
  const messages={SESSION_CONFLICT:'This session changed in another tab. Review the latest saved session before continuing.',
    INVALID_FURTHER_OPTIONS:'Choose two different level 1 options, or a matching level 1 and level 2 pair.',
    QUESTION_NO_LONGER_ELIGIBLE:'This question is no longer eligible. Refresh your queue to choose another.',
    AUTH_REQUIRED:'Your sign-in expired. Sign in again to sync the work saved on this device.',
    INVALID_TIMEZONE:'Choose a timezone from the list. For the UK, select United Kingdom — London (GMT / BST).',
    CHECK_NOT_DUE:'Your weekly syllabus check has already been recorded.',
    SELECT_SUBJECTS:'Select at least one subject.',EASE_REQUIRED:'Choose how easy the question felt before revealing the solution.'};
  const key=Object.keys(messages).find(k=>error.message?.includes(k));
  if(key) return messages[key];
  if(!navigator.onLine||/fetch|network|Failed to fetch/i.test(error.message)) return 'You are offline. Your question draft is saved on this device and will sync when you reconnect.';
  return error.message||'The request could not be saved. Your local draft is preserved.';
}
function syncStatus(count=outbox?.entries.length||0,blocked=outbox?.blocked) {
  connection.textContent=!user?'Private revision space':blocked?'Save needs attention':count?`${count} save${count===1?'':'s'} pending`:navigator.onLine?'All changes saved':'Offline · saved on this device';
  if(blocked) {
    message(errorMessage(blocked),true);
    if(notice.querySelector('[data-recovery]'))return;
    const recover=document.createElement('button');recover.textContent='Review latest saved session';recover.className='text-button';
    recover.dataset.recovery='';
    recover.addEventListener('click',()=>run(async()=>{
      pause();const sessionId=outbox.entries.find(e=>e.payload.session_id)?.payload.session_id;
      data=await backend.call('bootstrap',{timezone,...(sessionId?{session_id:sessionId}:{})});
      if(data.session?.status==='open')data={...data,...await backend.call('refresh',{session_id:data.session.id,expected_version:data.session.version,request_id:crypto.randomUUID()})};
      if(!data.syllabus_check_due&&outbox.blocked?.message.includes('CHECK_NOT_DUE'))outbox.entries=outbox.entries.filter(e=>e.action!=='syllabus_check');
      outbox.rebase(data.session);await flush();syncDraft();message('Latest session loaded. Check your ratings and resume when ready.');
    }));notice.append(' ',recover);
  }
}
function draftKey(itemId) {return `ac-revision-draft:${user.id}:${itemId}`;}
function persistDraft() {
  if(!draft||!user)return;
  try {localStorage.setItem(draftKey(draft.item_id),JSON.stringify(draft));}
  catch {draft.paused=true;message('This browser cannot save your draft. Keep this page open and enable browser storage before continuing.',true);}
}
function syncDraft() {
  const item=activeItem(data);
  if(!item) {draft=null;return;}
  if(draft?.item_id===item.id) {
    draft.active_seconds=Math.max(draft.active_seconds,item.active_seconds);
    if(item.revealed_at)draft.ease=item.ease;
    return;
  }
  let saved;
  try {saved=JSON.parse(localStorage.getItem(draftKey(item.id))||'null');}catch {saved=null;}
  draft={item_id:item.id,session_id:data.session.id,active_seconds:Math.max(saved?.active_seconds||0,item.active_seconds),
    ease:item.revealed_at?item.ease:(saved?.ease||item.ease),correctness:saved?.correctness||item.draft_correctness||null,
    earned_marks:saved?.earned_marks??item.draft_marks??null,paused:true};
  persistDraft();
}
async function flush() {
  if(!outbox||!navigator.onLine)return;
  if(outbox.blocked)throw outbox.blocked;
  await outbox.flush(sid=>data?.session?.id===sid?data.session.version:null);syncStatus();
}
async function mutate(action,payload={}) {
  if(outbox.blocked)throw outbox.blocked;
  if(!navigator.onLine&&!['checkpoint','complete'].includes(action))throw new Error('Offline: reconnect to save these changes.');
  outbox.enqueue(action,payload);await flush();return data;
}
async function sessionAction(action,payload={}) {return mutate(action,{session_id:data.session.id,...payload});}
async function checkpoint() {
  if(!draft||!outbox||outbox.blocked)return;
  persistDraft();
  const item=activeItem(data),validMarks=Number.isInteger(draft.earned_marks)&&draft.earned_marks>=0&&draft.earned_marks<=item?.total_marks;
  try {
    await sessionAction('checkpoint',{item_id:draft.item_id,active_seconds:Math.floor(draft.active_seconds),ease:draft.ease,paused:draft.paused,
      draft_correctness:item?.revealed_at?draft.correctness:null,draft_marks:item?.revealed_at&&validMarks?draft.earned_marks:null});
  }catch(error){if(outbox.blocked){pause();render();}throw error;}
}
async function wake() {
  try {if('wakeLock' in navigator&&!document.hidden&&!draft?.paused&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');}catch {/* Optional browser capability. */}
}
function pause() {
  if(draft){draft.paused=true;persistDraft();}
  if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
}
async function run(task) {
  if(busy)return;busy=true;
  const origin=document.activeElement,chapterFocus=origin?.dataset.confidence,confidenceValue=origin?.dataset.confidenceValue,buttonFocus=origin?.tagName==='BUTTON';
  for(const el of main.querySelectorAll('button'))el.disabled=true;
  try {await task();}
  catch(error){message(errorMessage(error),true);syncStatus();}
  finally {
    busy=false;render();
    if(chapterFocus)main.querySelector(`[data-confidence="${CSS.escape(chapterFocus)}"][data-confidence-value="${CSS.escape(confidenceValue)}"]`)?.focus();
    else if(buttonFocus)main.focus();
  }
}
function go(next) {location.hash=next;if(view===next)render();}
function attachMarkdown() {
  for(const el of main.querySelectorAll('[data-markdown]'))renderMarkdown(el,el.dataset.markdown);
}
function queueRows(items,limit=6) {
  return items.slice(0,limit).map((q,i)=>`<div class="list-row"><span class="number">${String(i+1).padStart(2,'0')}</span><div class="grow"><h3>${h(q.chapter_ids.map(chapterTitle).join(' / '))}</h3><small>${h(q.reason)}</small></div><span class="duration">≈ ${minutes(q.estimated_seconds)} min</span></div>`).join('');
}
function renderSetup() {
  main.innerHTML=title('A-level / Revision','A place to build your confidence.','Your revision space will be ready once its private database is configured.')+
    `<div class="card login"><h2>Connect your revision space</h2><p class="muted section">The frontend is installed. Follow the browser setup guide to create the Supabase tables, import your questions and add your public project configuration.</p><div class="actions"><a class="button" href="docs/setup.md">Open the setup guide ↗</a><a href="docs/README.md">Requirements and documentation</a></div></div><p class="muted section">Your password and student records belong in Supabase. Only the project URL and publishable key belong in the website configuration.</p>`;
  connection.textContent='Setup required';
}
function renderLogin() {
  main.innerHTML=title('A-level / Revision','Your revision')+
    `<form id="login" class="card login"><h2>Welcome back</h2><p class="muted section">Sign in with the account provided by your administrator.</p><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required minlength="6"></label><button type="submit" ${busy?'disabled':''}>Sign in →</button><p class="muted section">Accounts are created privately. There is no public registration.</p></form>`;
  document.querySelector('#login').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.target);run(async()=>{
    const {data:auth,error}=await backend.client.auth.signInWithPassword({email:form.get('email'),password:form.get('password')});
    if(error)throw error;await signedIn(auth.user);message('');
  });});
}
function renderToday() {
  const selected=selectedChapters(data),covered=selected.filter(c=>chapterProgress(data,c.id)?.confidence),session=data.session;
  const item=activeItem(data),todayHistory=data.history.find(d=>d.local_date===data.today);
  const seconds=(todayHistory?.seconds||0)+(data.today_check_seconds||0)+(draft?.active_seconds||0);
  const due=data.syllabus_check_due;
  const queue=session?.items.filter(q=>q.state==='queued')||[];
  const exam=relevantExams(data).find(e=>daysUntil(e.exam_date,data.today)>=0);
  main.innerHTML=title(new Date(`${data.today}T12:00:00`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}),"Today's revision")+
    `<div class="stats"><div class="stat"><strong>${minutes(seconds)}<small> / ${data.profile.daily_minutes} min</small></strong><span>Time spent today</span></div><div class="stat"><strong>${covered.length}<small> / ${selected.length}</small></strong><span>Chapters covered</span></div><div class="stat"><strong>${todayHistory?.questions||0}</strong><span>Questions completed</span></div></div>`+
    `<div class="split"><section><div class="section-head"><h2>${item?'Pick up where you left off':'Your next step'}</h2></div><div class="card">${item?'<span class="tag">Question in progress</span>':seconds>=data.profile.daily_minutes*60?'<span class="tag">Daily target reached</span>':''}<h2 class="section">${item?h(chapterTitle(item.chapter_ids[0])):seconds>=data.profile.daily_minutes*60?'A good place to finish.':`Daily target: ${data.profile.daily_minutes} minutes`}</h2><p class="muted section">${item?'Your question and ratings are saved. Resume whenever you are ready.':covered.length?'The queue balances initial assessment, weaker chapters, retention and upcoming exams.':'Mark the chapters you have already learned before starting your first question.'}</p><div class="actions">${item?button('Resume question →','resume'):covered.length?button(seconds>=data.profile.daily_minutes*60?'Continue voluntarily →':'Start revision →',seconds>=data.profile.daily_minutes*60?'continue':'start'):'<a class="button" href="#topics">Review your syllabus →</a>'}</div><div class="progress-track" role="progressbar" aria-label="Daily revision time" aria-valuemin="0" aria-valuemax="${data.profile.daily_minutes*60}" aria-valuenow="${Math.min(Math.floor(seconds),data.profile.daily_minutes*60)}"><div class="progress-fill" style="--value:${percent(seconds/(data.profile.daily_minutes*60))}"></div></div></div></section><section><div class="section-head"><h2>Ahead of you</h2></div><div class="card">${exam?`<span class="eyebrow">Next exam</span><h3 class="section">${h(data.papers.find(p=>p.id===exam.paper_id)?.title)}</h3><p class="section">${daysUntil(exam.exam_date,data.today)} days <span class="tag">${exam.provisional?'Provisional':'Confirmed'}</span></p><a href="#exams">See exam preparation →</a>`:'<h3>Your exam dates</h3><p class="muted section">No upcoming dates are recorded for your chosen exam year. Your administrator can add confirmed or provisional dates.</p><a href="#settings">Check your exam year →</a>'}</div></section></div>`+
    (due?`<div class="callout"><h3>A quick syllabus check</h3><p class="section">Learned anything new this week? Review your uncovered chapters. The time counts towards today’s target.</p>${button(weekly?'Continue syllabus check →':'Review uncovered chapters →','weekly','secondary')}</div>`:'')+
    (queue.length?`<section class="section"><div class="section-head"><h2>Your suggested queue</h2><span class="muted">≈ ${minutes(queue.reduce((n,q)=>n+q.estimated_seconds,0))} min remaining</span></div>${queueRows(queue)}${queue.length>6?`<p class="muted section">${queue.length-6} more questions. The queue adapts as you practise.</p>`:''}</section>`:covered.length?'<div class="section"><p class="muted">Your queue is built when you start. If the bank has no eligible questions, you will see which content needs adding.</p></div>':'');
}
function renderSettings() {
  const first=!data.profile.onboarded;
  const available=data.specifications.filter(sp=>data.books.some(b=>b.specification_id===sp.id));
  const selected=new Set(data.selected_specifications||data.books.filter(b=>data.enrolments.includes(b.id)).map(b=>b.specification_id));
  if(first&&!selected.size&&available.some(s=>s.id==='edexcel-9ma0'))selected.add('edexcel-9ma0');
  const chosen=new Set(data.selected_options||[]);
  const year=first?new Date().getFullYear()+(new Date().getMonth()>=7?1:0):data.profile.exam_year;
  const selectedTimezone=first?timezone:data.profile.timezone;
  const timezoneHTML=timezoneGroups(selectedTimezone,timezone).map(group=>`<optgroup label="${h(group.label)}">${group.options.map(option=>`<option value="${h(option.value)}" ${option.value===selectedTimezone?'selected':''}>${h(option.label)}</option>`).join('')}</optgroup>`).join('');
  const subjects=available.map(sp=>{
    const subject=data.subjects.find(s=>s.id===sp.subject_id);
    const groups=(data.option_groups||[]).filter(g=>g.specification_id===sp.id&&!g.archived);
    return `<section><label class="checkbox"><input type="checkbox" name="specification" value="${h(sp.id)}" ${selected.has(sp.id)?'checked':''}> ${h(subject?.board)} · ${h(subject?.name||sp.title)} · ${h(sp.code)}</label>${groups.map(g=>{
      const choices=(data.options||[]).filter(o=>o.group_id===g.id&&!o.archived);
      return `<fieldset data-spec-options="${h(sp.id)}" data-option-group="${h(g.id)}" ${selected.has(sp.id)?'':'hidden disabled'}><legend>${h(g.title)}</legend><p class="muted">${h(optionRequirement(g))}. <span data-option-count></span></p>${choices.map(o=>{
        const prerequisite=data.options.find(p=>p.id===o.requires_option_id);
        return `<label class="checkbox"><input data-option type="${g.max_choices===1?'radio':'checkbox'}" name="options:${h(g.id)}" value="${h(o.id)}" ${chosen.has(o.id)?'checked':''} ${g.max_choices===0?'disabled':''}> ${h(o.title)}${prerequisite?` <small>(requires ${h(prerequisite.title)})</small>`:''}</label>`;
      }).join('')}${g.min_choices===0&&g.max_choices===1?`<label class="checkbox"><input data-option-none type="radio" name="options:${h(g.id)}" value="" ${choices.some(o=>chosen.has(o.id))?'':'checked'}> None</label>`:''}${!choices.length?'<p class="muted">Options have not been added yet.</p>':''}</fieldset>`;
    }).join('')}</section>`;
  }).join('');
  main.innerHTML=title(first?'Getting started':'Your preferences',first?'Make this your revision space.':'Settings','Choose your subjects, optional content and time target. Changes update future questions while keeping your practice history.')+
    `<form id="settings-form"><fieldset><legend>Your subjects</legend>${subjects||'<p class="muted">Your administrator has not added any revision books yet.</p>'}</fieldset><div class="form-grid"><label class="field">Daily revision target (minutes)<input name="daily_minutes" type="number" min="5" max="480" step="1" value="${data.profile.daily_minutes}" required></label><label class="field">Exam year<input name="exam_year" type="number" min="2020" max="2100" value="${year}" required></label></div><label class="field"><span id="timezone-label">Timezone</span><select name="timezone" aria-labelledby="timezone-label" aria-describedby="timezone-help" required>${timezoneHTML}</select><span class="muted" id="timezone-help">For the UK, choose United Kingdom — London (GMT / BST). Clocks change automatically. Your timezone sets daily targets and review dates.</span></label><div class="actions"><button type="submit">${first?'Save and review your syllabus →':'Save settings'}</button></div></form>`;
  const form=document.querySelector('#settings-form');
  const refreshChoices=()=>{
    const specs=[...form.querySelectorAll('[name=specification]:checked')].map(c=>c.value);
    for(const group of form.querySelectorAll('[data-spec-options]')){
      group.hidden=group.disabled=!specs.includes(group.dataset.specOptions);
      group.querySelector('[data-option-count]').textContent=`${group.querySelectorAll('[data-option]:checked:not(:disabled)').length} selected.`;
    }
  };
  form.addEventListener('change',refreshChoices);refreshChoices();
  form.addEventListener('submit',event=>{
    event.preventDefault();const f=new FormData(form);
    const specifications=f.getAll('specification'),option_ids=[...form.querySelectorAll('[data-option]:checked')].filter(c=>!c.disabled&&!c.closest('fieldset').disabled).map(c=>c.value);
    const problem=validateOptionSelection(data,specifications,option_ids);
    if(problem){message(problem,true);return;}
    run(async()=>{
      const payload={specifications,option_ids,daily_minutes:Number(f.get('daily_minutes')),exam_year:Number(f.get('exam_year')),timezone:f.get('timezone').trim(),request_id:crypto.randomUUID()};
      await flush();data=await backend.call('settings',payload);message('Your settings are saved.');if(first)go('topics');
    });
  });
}
function renderTopics() {
  const chapters=selectedChapters(data);
  const filtered=chapters.filter(c=>(!uncoveredOnly||!chapterProgress(data,c.id)?.confidence)&&(`${c.title} ${chapterBook(c.id)}`.toLowerCase().includes(searchFilter.toLowerCase())));
  main.innerHTML=title(weekly?'Weekly syllabus check':'Your syllabus',weekly?'What have you learned this week?':'Your chapters','Rate your confidence in each chapter from 1 to 5. Leave chapters blank until you have learned them; they will stay out of your question queue.')+
    (weekly?`<div class="callout">Syllabus check time: <strong id="weekly-time">${formatTime(weekly.seconds)}</strong>. Rate newly covered chapters, then ${button('Finish syllabus check','finish-weekly','secondary')}</div>`:'')+
    `<div class="filters"><input id="topic-search" type="search" aria-label="Search chapters" placeholder="Find a chapter…" value="${h(searchFilter)}"><label class="checkbox"><input id="uncovered-filter" type="checkbox" ${uncoveredOnly?'checked':''}> Uncovered only</label></div><p class="muted">${filtered.length} chapters shown · confidence is your self-assessment, separate from demonstrated proficiency.</p><div id="chapter-list">${filtered.map(c=>{
      const p=chapterProgress(data,c.id),subtopics=selectedSubtopics(data).filter(t=>t.chapter_id===c.id);
      return `<article class="topic-row"><div><div class="meta">${h(chapterBook(c.id))} · Chapter ${c.number}</div><h3>${h(c.title)}</h3><details><summary>About this chapter</summary><div class="reminder">${c.reminder_reviewed&&c.description_md?`<div data-markdown="${h(c.description_md)}"></div>`:'<p class="muted">A reviewed chapter description has not been added yet.</p>'}<ul>${subtopics.map(t=>`<li>${h(t.number)} · ${h(t.title)}</li>`).join('')}</ul>${c.reminder_reviewed&&c.example_md?`<div data-markdown="${h(c.example_md)}"></div>`:'<p class="muted">A reviewed worked example has not been added yet.</p>'}</div></details></div><div class="confidence"><div class="confidence-label">Confidence</div><div class="confidence-buttons" role="group" aria-label="Confidence: ${h(c.title)}">${['Very low','Low','Moderate','High','Very high'].map((label,i)=>`<button type="button" data-confidence="${h(c.id)}" data-confidence-value="${i+1}" aria-label="${i+1} · ${label}" aria-pressed="${p?.confidence===i+1}">${i+1}</button>`).join('')}</div>${p?.confidence?`<button type="button" class="text-button confidence-clear" data-confidence="${h(c.id)}" data-confidence-value="" aria-label="Mark ${h(c.title)} as not yet covered">Mark as not yet covered</button>`:'<span class="confidence-status">Not yet covered</span>'}</div></article>`;
    }).join('')||'<p class="empty">No chapters match these filters.</p>'}</div>`;
  document.querySelector('#uncovered-filter').addEventListener('change',e=>{uncoveredOnly=e.target.checked;render();});
  document.querySelector('#topic-search').addEventListener('input',e=>{
    searchFilter=e.target.value;const position=e.target.selectionStart;render();const field=document.querySelector('#topic-search');field.focus();field.setSelectionRange(position,position);
  });
  for(const control of main.querySelectorAll('[data-confidence]'))control.addEventListener('click',()=>run(async()=>{
    await flush();data=await backend.call('confidence',{request_id:crypto.randomUUID(),ratings:[{chapter_id:control.dataset.confidence,confidence:control.dataset.confidenceValue?Number(control.dataset.confidenceValue):null}]});
    message('Chapter confidence saved. Your next questions have been updated.');
  }));
}
function rating(name,legend,labels,value,locked=false) {
  return `<fieldset class="rating"><legend>${h(legend)}</legend>${labels.map((label,i)=>`<label><input type="radio" name="${name}" value="${i+1}" ${value===i+1?'checked':''} ${locked?'disabled':''}><span class="choice"><strong>${i+1}</strong>${h(label)}</span></label>`).join('')}</fieldset>`;
}
function renderPractice() {
  const s=data.session;
  if(!s){go('today');return;}
  syncDraft();const item=activeItem(data),queued=s.items.filter(q=>q.state==='queued');
  const used=usedSeconds(s),reached=used>=s.target_seconds;
  if(!item) {
    const covered=selectedChapters(data).filter(c=>chapterProgress(data,c.id)?.confidence);
    const missing=covered.filter(c=>!data.bank_counts.find(b=>b.chapter_id===c.id)?.questions);
    main.innerHTML=title('Your practice session',reached?'Your daily target is reached.':queued.length?'Ready for your next question?':'No eligible questions right now.',reached?'Finish here, or continue voluntarily if you have time.':queued.length?'Work on paper, then compare your answer with the worked solution.':'The system keeps uncovered chapters out of revision and avoids questions you have already answered partly or fully correctly.')+
      `<div class="card"><h2>${formatTime(used)} <span class="muted">of ${minutes(s.target_seconds)} minutes</span></h2><div class="actions">${queued.length?button('Begin next question →','next'):reached?button('Continue voluntarily →','continue'):button('Refresh available questions','refresh','secondary')}${button('Finish session','finish','secondary')}</div></div>`+
      (queued.length&&!reached&&queued[0].estimated_seconds>s.target_seconds-used?`<p class="muted section">The next question is estimated at ${minutes(queued[0].estimated_seconds)} minutes, longer than your remaining ${minutes(s.target_seconds-used)} minutes. You can finish here or begin it if you have time.</p>`:'')+
      (missing.length?`<div class="callout"><h3>Some covered chapters need questions</h3><p class="section">${missing.length} covered chapters have no verified questions. Your administrator can import questions for ${h(missing.slice(0,3).map(c=>c.title).join(', '))}${missing.length>3?' and other chapters':''}.</p></div>`:'')+
      (!queued.length&&!reached&&!missing.length?'<p class="muted section">Available questions may be retired, attempted today, or linked to an uncovered chapter. Import new questions assessing the same skills. Completely incorrect questions become reusable on a later day.</p>':'')+
      (queued.length?`<section class="section"><h2>Coming up</h2>${queueRows(queued,40)}</section>`:'');
    return;
  }
  const completionPending=outbox.entries.some(e=>e.action==='complete'&&e.payload.item_id===item.id);
  main.innerHTML=title('Question practice',item.chapter_ids.map(chapterTitle).join(' / '),'Take your time. Your place is saved as you work.')+
    (s.local_date!==data.today?`<p class="muted">Resuming the session from ${h(s.local_date)}. Questions completed now count towards today’s history.</p>`:'')+
    `<div class="timerbar"><div><strong id="question-time">${formatTime(draft.active_seconds)}</strong><small>On this question</small></div><div><strong id="session-time">${formatTime(used-item.active_seconds+draft.active_seconds)}</strong><small>Session target: ${minutes(s.target_seconds)} min</small></div>${button(draft.paused?'Resume timer':'Pause','toggle-pause','secondary')}</div>`+
    questionCard(item,true)+
    `<form id="assessment"><section class="section">${rating('ease','Before the solution: how easy did this feel?',easeLabels,draft.ease,Boolean(item.revealed_at))}${item.revealed_at?'<p class="muted">Your ease rating was recorded before revealing the solution.</p>':button('Reveal worked solution →','reveal')}</section>`+
    (item.revealed_at?`<section class="solution"><h2>Worked solution</h2><div id="solution-text" class="question-content section"></div>${rating('correctness','Compare your work: how much was correct?',correctnessLabels,draft.correctness,completionPending)}${item.total_marks?`<label class="field">Marks earned (optional, out of ${item.total_marks})<input name="earned_marks" type="number" min="0" max="${item.total_marks}" step="1" value="${draft.earned_marks??''}" ${completionPending?'disabled':''}></label>`:''}<div class="actions">${completionPending?`<p>Attempt waiting to sync.</p>${button('Retry pending saves','retry','secondary')}`:'<button type="submit">Save attempt and continue →</button>'}</div></section>`:'')+`</form><p class="muted section">The timer pauses when you leave this tab or this question. You will never be stopped midway through a question.</p>`;
  renderQuestionCards(main);
  if(item.revealed_at)renderQuestionMarkdown(document.querySelector('#solution-text'),item.solution_md);
  const form=document.querySelector('#assessment');
  form.addEventListener('input',e=>{
    if(e.target.name==='ease')draft.ease=Number(e.target.value);
    if(e.target.name==='correctness')draft.correctness=Number(e.target.value);
    if(e.target.name==='earned_marks')draft.earned_marks=e.target.value===''?null:Number(e.target.value);
    persistDraft();
    checkpoint().catch(error=>message(errorMessage(error),Boolean(outbox.blocked)));
  });
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    if(!draft.correctness)throw new Error('Choose how much of your answer was correct.');
    pause();const savedItem=draft.item_id;
    await sessionAction('complete',{item_id:savedItem,active_seconds:Math.floor(draft.active_seconds),ease:draft.ease,
      correctness:draft.correctness,earned_marks:draft.earned_marks});
    if(!outbox.entries.length){localStorage.removeItem(draftKey(savedItem));draft=null;message('Attempt saved. Your remaining queue has been updated.');}
    else message('Attempt saved on this device. Reconnect to sync it and load your next question.');
  });});
}
function histogram(values) {
  const max=Math.max(1,...values);
  return `<div class="histogram" aria-hidden="true">${values.map((n,i)=>`<div style="--value:${Math.max(4,n/max*80)}%"><span>${i+1}</span></div>`).join('')}</div><div class="distribution">${values.map((n,i)=>`${i+1}: ${n}`).join(' · ')}</div>`;
}
function renderProgress() {
  const chapters=selectedChapters(data),measured=chapters.map(c=>({...c,p:chapterProgress(data,c.id)})).filter(c=>c.p?.attempts);
  const ranked=[...measured].sort((a,b)=>a.p.proficiency-b.p.proficiency);
  const totalSubtopics=selectedSubtopics(data).filter(t=>chapters.some(c=>c.id===t.chapter_id)).length;
  const assessed=measured.reduce((n,c)=>n+c.p.assessed_subtopics,0);
  main.innerHTML=title('Learning progress','Your progress')+
    `<div class="stats"><div class="stat"><strong>${data.totals.questions}</strong><span>Questions completed</span></div><div class="stat"><strong>${minutes(data.totals.seconds)} min</strong><span>Question practice time</span></div><div class="stat"><strong>${assessed}<small> / ${totalSubtopics}</small></strong><span>Subtopics assessed</span></div></div>`+
    (measured.length?`<div class="split"><div class="card"><h3>Needs more practice</h3><p class="section">${h(ranked[0].title)}</p><p class="muted">Estimate ${percent(ranked[0].p.proficiency)} · ${ranked[0].p.distinct_questions} different questions</p></div><div class="card"><h3>Strongest current estimate</h3><p class="section">${h(ranked.at(-1).title)}</p><p class="muted">Estimate ${percent(ranked.at(-1).p.proficiency)} · uncertainty still matters.</p></div></div>`:'')+
    `<section class="section"><h2>Practice over time</h2>${data.history.length?`<div class="spark" role="img" aria-label="Question practice minutes by day; exact values follow">${data.history.map(d=>`<span style="--value:${Math.max(3,d.seconds/Math.max(1,...data.history.map(d=>d.seconds))*100)}%" title="${h(d.local_date)}: ${minutes(d.seconds)} min"></span>`).join('')}</div><details><summary>Daily totals</summary>${data.history.map(d=>`<p class="muted">${h(d.local_date)} · ${d.questions} questions · ${minutes(d.seconds)} min · correctness ${percent(d.correctness)}</p>`).join('')}</details>`:'<p class="muted section">Your daily question history will appear here.</p>'}</section>`+
    `<section class="section"><h2>Chapter evidence</h2>${chapters.map(c=>{
      const p=chapterProgress(data,c.id),n=selectedSubtopics(data).filter(t=>t.chapter_id===c.id).length;
      return `<details class="section card"><summary>${h(c.title)} · ${p?.attempts?`estimate ${percent(p.proficiency)}`:'not assessed'}</summary><p class="muted section">${h(chapterBook(c.id))} · Self-reported confidence: ${p?.confidence?`${p.confidence} / 5`:'not covered'}</p>${p?.attempts?`<p>Estimated proficiency: ${percent(p.proficiency)}. Uncertainty (standard deviation): ${Math.round(Math.sqrt(p.variance)*100)} percentage points.</p><p class="muted">${p.distinct_questions} different questions · ${p.practice_days} practice days · ${p.assessed_subtopics} / ${n} subtopics assessed · next retention check ${h(p.next_review)}</p><div class="split"><div><h3>Correctness</h3>${histogram(p.correctness_distribution)}</div><div><h3>Perceived ease</h3>${histogram(p.ease_distribution)}</div></div>`:'<p class="muted">No demonstrated evidence yet. Your confidence provides a low-certainty starting point.</p>'}</details>`;
    }).join('')}</section>`;
}
function renderExams() {
  const exams=[...relevantExams(data)].sort((a,b)=>a.exam_date.localeCompare(b.exam_date)||(a.start_time||'').localeCompare(b.start_time||''));
  const nextDate=exams.find(exam=>daysUntil(exam.exam_date,data.today)>=0)?.exam_date;
  main.innerHTML=title('Exam preparation','Your exams')+
    (!exams.length?`<div class="card"><h2>No exam dates recorded</h2><p class="section">There are no dates for your selected papers in ${data.profile.exam_year}. Ask your administrator to add them with a source link. Estimates must be marked provisional.</p><a href="#settings">Check subjects and exam year →</a></div>`:exams.map(exam=>{
      const paper=data.papers.find(p=>p.id===exam.paper_id),days=daysUntil(exam.exam_date,data.today);
      const date=new Date(`${exam.exam_date}T12:00:00Z`),format=options=>new Intl.DateTimeFormat('en-GB',{...options,timeZone:'UTC'}).format(date);
      const countdown=days<0?'Past exam':days===0?'Today':days===1?'Tomorrow':`${days} days away`;
      const time=exam.start_time?exam.start_time.slice(0,5):null;
      const duration=exam.duration_minutes?`${Math.floor(exam.duration_minutes/60)?`${Math.floor(exam.duration_minutes/60)} hr`:''}${exam.duration_minutes%60?`${exam.duration_minutes>=60?' ':''}${exam.duration_minutes%60} min`:''}`:null;
      return `<article class="exam-row${exam.exam_date===nextDate?' exam-next':''}"><time class="exam-date" datetime="${h(exam.exam_date)}" aria-label="${h(format({weekday:'long',day:'numeric',month:'long',year:'numeric'}))}"><span>${h(format({month:'short'}))}</span><strong>${h(format({day:'numeric'}))}</strong><small>${h(format({weekday:'short'}))}</small></time><div class="exam-details"><div class="exam-heading"><h2>${h(paper.title)}</h2><span class="tag">${exam.provisional?'Provisional':'Confirmed'}</span></div><p class="exam-meta">${time?`<span>Starts ${h(time)}</span>`:''}${duration?`<span>${h(duration)}</span>`:''}${exam.label?`<span>${h(exam.label)}</span>`:''}</p>${safeURL(exam.source_url)?`<a class="exam-source" href="${h(safeURL(exam.source_url))}" rel="noopener noreferrer">Timetable source ↗</a>`:''}</div><div class="exam-countdown">${exam.exam_date===nextDate?'<span>Next exam</span>':''}<strong>${h(countdown)}</strong></div></article>`;
    }).join(''));
}
function render() {
  document.querySelector('#sign-out').hidden=!user;
  for(const a of document.querySelectorAll('[data-view]')){const current=a.dataset.view===view;a.classList.toggle('active',current);if(current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  if(!backend?.configured){renderSetup();return;}
  if(!user){renderLogin();return;}
  if(!data){main.innerHTML='<p>Loading your private revision data…</p>';return;}
  syncDraft();
  if(!data.profile.onboarded)renderSettings();
  else if(view==='topics')renderTopics();
  else if(view==='settings')renderSettings();
  else if(view==='progress')renderProgress();
  else if(view==='exams')renderExams();
  else if(view==='practice')renderPractice();
  else renderToday();
  attachMarkdown();
}
const actions={
  async reload(){location.reload();},
  async retry(){await flush();syncDraft();message(outbox.entries.length?'Your work is still waiting to sync.':'Your saved work has synced.');},
  async start(){await mutate('start');go('practice');},
  async continue(){await mutate('start',{continue:true});go('practice');},
  async refresh(){await sessionAction('refresh');message('Available questions refreshed.');},
  async resume(){go('practice');},
  async next(){const q=data.session.items.find(q=>q.state==='queued');if(!q)return;await sessionAction('activate',{item_id:q.id});syncDraft();draft.paused=false;persistDraft();await wake();},
  async reveal(){if(!draft?.ease)throw new Error('Choose how easy the question felt before revealing the solution.');await checkpoint();await sessionAction('reveal',{item_id:draft.item_id,active_seconds:Math.floor(draft.active_seconds),ease:draft.ease});},
  async 'toggle-pause'(){if(draft.paused){draft.paused=false;persistDraft();await wake();}else{pause();}await checkpoint();},
  async finish(){await sessionAction('finish');message('Session finished. Your progress is saved.');go('today');},
  async weekly(){weekly=weekly||{seconds:0};localStorage.setItem(`ac-revision-weekly:${user.id}`,JSON.stringify(weekly));uncoveredOnly=true;go('topics');},
  async 'finish-weekly'(){await mutate('syllabus_check',{active_seconds:Math.min(1800,Math.floor(weekly.seconds))});weekly=null;localStorage.removeItem(`ac-revision-weekly:${user.id}`);uncoveredOnly=false;message('Syllabus check recorded. Its time counts towards today’s revision.');go('today');}
};
main.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(control&&!control.disabled)run(()=>actions[control.dataset.action]());});
window.addEventListener('hashchange',()=>{
  if(view==='practice'&&draft){pause();checkpoint().catch(error=>message(errorMessage(error),true));}
  view=location.hash.slice(1)||'today';render();main.focus();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();checkpoint().catch(()=>{});}lastTick=performance.now();if(view==='practice')render();});
window.addEventListener('pagehide',()=>{pause();persistDraft();if(weekly&&user)localStorage.setItem(`ac-revision-weekly:${user.id}`,JSON.stringify(weekly));});
window.addEventListener('online',()=>{syncStatus();flush().then(()=>{if(user&&data){syncDraft();if(view==='practice'||view==='today')render();}}).catch(error=>message(errorMessage(error),true));});
window.addEventListener('offline',()=>{syncStatus();message('You are offline. Your question draft stays on this device until it can sync.');});
window.addEventListener('storage',event=>{if(user&&event.key===outbox?.key){pause();message('Another tab changed saved revision work. Use one tab at a time; reload this tab before continuing.',true);}});
document.querySelector('#sign-out').addEventListener('click',()=>run(async()=>{
  pause();await checkpoint();await flush();
  if(outbox.entries.length)throw new Error('Reconnect and sync pending work before signing out.');
  if(draft)localStorage.removeItem(draftKey(draft.item_id));
  const {error}=await backend.client.auth.signOut();if(error)throw error;
  user=null;data=null;draft=null;weekly=null;outbox=null;message('Signed out.');syncStatus();
}));
setInterval(()=>{
  const now=performance.now(),delta=Math.min(2,(now-lastTick)/1000);lastTick=now;
  if(!document.hidden&&draft&&!draft.paused&&view==='practice'){
    draft.active_seconds=Math.min(86400,draft.active_seconds+delta);persistDraft();
    const time=document.querySelector('#question-time'),total=document.querySelector('#session-time');
    if(time)time.textContent=formatTime(draft.active_seconds);
    if(total)total.textContent=formatTime(usedSeconds(data.session)-activeItem(data).active_seconds+draft.active_seconds);
    if(now-checkpointAt>=15000&&!busy){checkpointAt=now;checkpoint().catch(error=>{if(outbox.blocked)pause();message(errorMessage(error),Boolean(outbox.blocked));});}
  }
  if(!document.hidden&&weekly&&view==='topics'){
    weekly.seconds=Math.min(1800,weekly.seconds+delta);localStorage.setItem(`ac-revision-weekly:${user.id}`,JSON.stringify(weekly));
    const time=document.querySelector('#weekly-time');if(time)time.textContent=formatTime(weekly.seconds);
  }
},1000);

async function signedIn(authUser) {
  user=authUser;data=null;
  // Older installations still work before the optional admin migration is applied.
  backend.client.rpc('revision_is_admin').then(({data:isAdmin})=>{
    document.querySelector('#admin-link').hidden=!(isAdmin===true&&user?.id===authUser.id);
  }).catch(()=>{});
  outbox=new Outbox(user.id,async(action,payload)=>{
    const response=await backend.call(action,payload);data={...data,...response};
  },syncStatus);
  data=await backend.call('bootstrap',{timezone});
  try{weekly=JSON.parse(localStorage.getItem(`ac-revision-weekly:${user.id}`)||'null');}catch{weekly=null;}
  syncDraft();syncStatus();render();await flush();syncStatus();render();
}
async function init() {
  try {
    backend=new RevisionBackend();if(!backend.configured){render();return;}
    connection.textContent='Checking saved sign-in…';
    // Resolve initial Auth recovery before registering callbacks that share its lock.
    const {data:auth,error}=await backend.getSession();if(error)throw error;
    backend.client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT') {pause();user=null;data=null;draft=null;outbox=null;document.querySelector('#admin-link').hidden=true;render();syncStatus();}
      // Avoid Supabase auth callbacks awaiting another SDK call while its auth lock is held.
      if(event==='TOKEN_REFRESHED'&&session)setTimeout(()=>flush().catch(()=>{}),0);
    });
    if(auth.session){connection.textContent='Loading revision data…';await signedIn(auth.session.user);}else{render();syncStatus();}
  }catch(error){
    message(errorMessage(error),true);
    if(data){render();syncStatus();}
    else {
      connection.textContent='Connection needs attention';
      main.innerHTML=title('Connection needs attention','Your revision space could not load.',errorMessage(error))+
        '<p class="muted">Close other revision/admin tabs and reload this page. Locally saved drafts and pending attempts have been preserved.</p><button type="button" data-action="reload">Retry connection</button>';
    }
  }
}
init();
