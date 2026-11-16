import {escapeHTML as h,renderMarkdown,safeURL} from './model.mjs';

// Question assets are relative to the student page, including in /admin/ previews.
const contentBase=new URL('./',import.meta.url);
export function questionCard(item,studentIds=false){
  return `<article class="card"><div class="question-head"><span class="tag">Difficulty ${h(item.difficulty)} / 5</span> ${item.total_marks?`<span class="tag">${h(item.total_marks)} marks</span>`:''}</div><div ${studentIds?'id="question-text" ':''}class="question-content" data-question-prompt="${h(item.prompt_md)}"></div><div ${studentIds?'id="question-assets" ':''}class="question-content" data-question-assets="${h(JSON.stringify(item.assets||[]))}"></div></article>`;
}
export function workedSolution(text,studentIds=false){
  return `<section class="solution"><h2>Worked solution</h2><div ${studentIds?'id="solution-text" ':''}class="question-content section" data-question-solution="${h(text)}"></div></section>`;
}
export function renderQuestionMarkdown(element,text){renderMarkdown(element,text,contentBase);}
export function renderQuestionCards(root){
  for(const el of root.querySelectorAll('[data-question-prompt],[data-question-solution]'))
    renderQuestionMarkdown(el,el.dataset.questionPrompt??el.dataset.questionSolution);
  for(const el of root.querySelectorAll('[data-question-assets]')){
    el.replaceChildren();
    for(const asset of JSON.parse(el.dataset.questionAssets)){
      if(!asset||typeof asset!=='object')continue;
      const url=safeURL(asset.url);if(!url)continue;
      let resolved;try{resolved=new URL(url,contentBase).href;}catch{continue;}
      const figure=document.createElement('figure'),img=document.createElement('img');
      img.src=resolved;img.alt=asset.alt;img.loading='lazy';figure.append(img);
      if(asset.caption){const caption=document.createElement('figcaption');caption.textContent=asset.caption;figure.append(caption);}
      el.append(figure);
    }
  }
}
