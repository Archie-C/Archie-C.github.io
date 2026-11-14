import {escapeHTML as h} from './model.mjs';
import {hierarchyFilters} from './admin-filters.mjs';
import {topicExportRows} from './admin-export.mjs';

export const coveragePageSize=12;
export const coverageTarget=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=100?Number(value):5;

export function subtopicCoverage(catalogue,counts,filters={},target=5){
  target=coverageTarget(target);
  const index=new Map(counts.map(row=>[row.id,row]));
  const rows=topicExportRows(catalogue,{...filters,status:'active'}).map(topic=>{
    const {verified=0,drafts=0}=index.get(topic.id)||{};
    return {...topic,verified,drafts,gap:Math.max(0,target-verified),
      coverage:verified===0?'empty':verified<target?'needs-more':'ready'};
  }).sort((a,b)=>a.verified-b.verified||a.chapter_id.localeCompare(b.chapter_id,undefined,{numeric:true})
    ||String(a.number).localeCompare(String(b.number),undefined,{numeric:true})||a.id.localeCompare(b.id));
  return {rows,visible:rows.filter(row=>!filters.coverage||(filters.coverage==='needs-more'?row.gap>0:row.coverage===filters.coverage)),
    total:rows.length,empty:rows.filter(row=>row.coverage==='empty').length,
    needsMore:rows.filter(row=>row.gap>0).length,ready:rows.filter(row=>row.coverage==='ready').length};
}

function select(name,label,options,value){
  return `<label class="field">${h(label)}<select name="${name}" aria-label="${h(label)}">${options.map(([id,title])=>
    `<option value="${h(id)}" ${String(value||'')===String(id)?'selected':''}>${h(title)}</option>`).join('')}</select></label>`;
}

export function coverageView(catalogue,counts,filters={},target=5,page=0,busy=false){
  const disabled=busy?'disabled':'',scope=hierarchyFilters(catalogue,filters),data=subtopicCoverage(catalogue,counts,scope.values,target);
  const shown=data.visible.slice(page*coveragePageSize,(page+1)*coveragePageSize);
  const percent=data.total?Math.round(data.ready/data.total*100):0;
  return `<section class="coverage-overview" aria-label="Coverage overview">
    <div class="coverage-overview-heading"><div><span class="eyebrow">QUESTION BANK HEALTH</span><h2>Make every subtopic count.</h2></div>
      <p>Working target <strong>${target}</strong> verified questions per subtopic</p></div>
    <div class="coverage-stats">
      <div><strong>${data.total}</strong><span>Active subtopics</span></div>
      <div class="coverage-priority"><strong>${data.needsMore}</strong><span>Need more questions <small>${data.empty} with none ready</small></span></div>
      <div><strong>${data.ready}</strong><span>At target <small>${percent}% of this selection</small></span></div>
    </div>
    <div class="coverage-overall-track" aria-hidden="true"><span style="width:${percent}%"></span></div>
  </section>
  <form id="filters" class="filters coverage-filters">
    ${select('subject','Subject',[['','All subjects'],...(catalogue.subjects||[]).map(s=>[s.id,s.name])],filters.subject)}
    ${select('specification','Specification',[['','All specifications'],...scope.specifications.map(s=>[s.id,s.title])],filters.specification)}
    ${select('chapter','Chapter',[['','All chapters'],...scope.chapters.map(c=>[c.id,`${c.number} · ${c.title}`])],filters.chapter)}
    <label class="field">Find a subtopic<input name="search" type="search" value="${h(filters.search||'')}" placeholder="Title, chapter or subtopic ID"></label>
    <label class="field">Question target<input name="target" type="number" min="1" max="100" step="1" required value="${target}" aria-describedby="coverage-help"></label>
    <input name="coverage" type="hidden" value="${h(filters.coverage||'')}">
    <button type="submit" ${disabled}>Apply filters</button>
  </form>
  <p id="coverage-help" class="muted coverage-help">Only verified questions available for practice count towards the target. Drafts are shown separately. Archived subtopics are excluded.</p>
  <div class="coverage-toolbar"><div class="coverage-tabs" role="group" aria-label="Filter by coverage">
    ${[['','All',data.total],['needs-more','Below target',data.needsMore],['empty','No questions',data.empty],['ready','At target',data.ready]].map(([value,label,count])=>
      `<button type="button" data-coverage-status="${value}" aria-pressed="${(filters.coverage||'')===value}" ${disabled}>${label}<span>${count}</span></button>`).join('')}
    </div><span class="muted">Fewest questions first</span></div>
  ${shown.length?`<section class="coverage-grid" aria-label="Subtopic question counts">${shown.map(topic=>`<article class="coverage-card coverage-${topic.coverage}">
    <div class="coverage-card-top"><span class="coverage-context">${h(topic.subject_name)} · ${h(topic.specification_code)}</span><span class="coverage-badge">${topic.coverage==='empty'?'No questions':topic.gap?'Below target':'At target'}</span></div>
    <p class="coverage-chapter">${h(topic.chapter_number)} · ${h(topic.chapter_title)}</p>
    <h3>${h(topic.number)} · ${h(topic.title)}</h3>
    <div class="coverage-quantity"><strong>${topic.verified}</strong><span>verified <span>/ ${target} target</span></span></div>
    <progress value="${Math.min(target,topic.verified)}" max="${target}" aria-label="Verified question target for ${h(topic.title)}">${topic.verified} / ${target}</progress>
    <div class="coverage-card-meta"><span>${topic.gap?`${topic.gap} more to reach target`:'Target reached'}</span><span>${topic.drafts?`${topic.drafts} draft${topic.drafts===1?'':'s'}`:'No drafts'}</span></div>
    <div class="coverage-card-foot"><code title="${h(topic.id)}">${h(topic.id)}</code><button type="button" class="text-button" data-coverage-topic="${h(topic.id)}" aria-label="View questions for ${h(topic.title)}" ${disabled}>View questions <span aria-hidden="true">↗</span></button></div>
  </article>`).join('')}</section>`:`<div class="card empty"><h2>${data.total?'No subtopics in this group':'No active subtopics found'}</h2><p>${data.total?'Choose another coverage group to see more subtopics.':'Try a different search or broaden the subject, specification or chapter filters.'}</p></div>`}
  <div class="pager"><span>${data.visible.length?`${page*coveragePageSize+1}–${Math.min((page+1)*coveragePageSize,data.visible.length)} of ${data.visible.length} subtopics`:'0 subtopics'}</span><div class="actions">
    <button type="button" class="secondary" data-action="coverage-prev" ${busy||page===0?'disabled':''}>Previous</button>
    <button type="button" class="secondary" data-action="coverage-next" ${busy||(page+1)*coveragePageSize>=data.visible.length?'disabled':''}>Next</button>
  </div></div>`;
}
