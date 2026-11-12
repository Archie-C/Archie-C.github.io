export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatTime = seconds => { const s=Math.max(0,Math.floor(seconds||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
export const minutes = seconds => Math.ceil(Math.max(0,seconds||0)/60);
export const percent = value => `${Math.round(Math.max(0,Math.min(1,Number(value)||0))*100)}%`;
export const activeItem = data => data?.session?.items?.find(q=>q.state==='active');
export const selectedChapters = data => data.chapters.filter(c=>data.enrolments.includes(c.book_id));
export const chapterProgress = (data,id) => data.progress.find(p=>p.chapter_id===id);
export const usedSeconds = session => (session?.check_seconds||0)+(session?.items||[]).reduce((n,q)=>n+(q.active_seconds||0),0);
export function relevantExams(data) {
  const specs=new Set(data.books.filter(b=>data.enrolments.includes(b.id)).map(b=>b.specification_id));
  return data.exams.filter(e=>{const p=data.papers.find(p=>p.id===e.paper_id);return p&&specs.has(p.specification_id)&&(!p.option_book_id||data.enrolments.includes(p.option_book_id));});
}
export function daysUntil(date,today) { return Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000); }
export function safeURL(value) {
  if (typeof value!=='string'||/[\u0000-\u0020\\]/.test(value)) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (/^(?!\/\/)(?:\/?[a-z0-9_.-]+)+(?:\/[a-z0-9_.-]+)*(?:[?#][^\s]*)?$/i.test(value)) return value;
  return null;
}
export function renderMarkdown(element,text) {
  if (!globalThis.marked || !globalThis.DOMPurify) {element.textContent=text;return;}
  const math=[];
  const protectedText=String(text||'').replace(/\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\\n])+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, expression=>{
    const token=`REVISIONMATHTOKEN${math.length}END`;math.push(expression);return token;
  });
  const renderer=new globalThis.marked.Renderer();
  renderer.html=({text})=>escapeHTML(text);
  let html=globalThis.marked.parse(protectedText,{renderer,breaks:false,gfm:true});
  html=html.replace(/REVISIONMATHTOKEN(\d+)END/g,(_,i)=>escapeHTML(math[Number(i)]||''));
  element.innerHTML=globalThis.DOMPurify.sanitize(html,{
    ALLOWED_TAGS:['p','br','em','strong','del','blockquote','ul','ol','li','pre','code','a','img','hr','table','thead','tbody','tr','th','td','h1','h2','h3','h4'],
    ALLOWED_ATTR:['href','src','alt','title','start'],ALLOW_DATA_ATTR:false
  });
  for(const el of element.querySelectorAll('[src],[href]')) {
    const attr=el.hasAttribute('src')?'src':'href';
    if(!safeURL(el.getAttribute(attr))) el.removeAttribute(attr);
    if(el.tagName==='IMG') {el.loading='lazy'; if(!el.alt) el.alt='Question diagram';}
  }
  if(globalThis.renderMathInElement) globalThis.renderMathInElement(element,{
    delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],
    throwOnError:false,trust:false,strict:'warn'
  });
}
