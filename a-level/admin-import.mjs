// RFC 4180 state machine: commas and line endings inside quotes are content.
// Backslashes are never escape characters, so LaTeX survives unchanged.
export function parseCSV(input) {
  const text=String(input).replace(/^\uFEFF/,'');
  if(text.length>2_000_000)throw new Error('CSV exceeds the 2 MB limit.');
  const rows=[];let row=[],field='',quoted=false,closed=false,line=1,start=1;
  const endField=()=>{row.push(field);field='';closed=false;};
  const endRow=()=>{endField();if(row.some(v=>v.trim()))rows.push({line:start,values:row});row=[];start=line+1;};
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) {
      if(ch==='"') {if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}
      else {field+=ch;if(ch==='\n')line++;}
    } else if(ch==='"') {
      if(field||closed)throw new Error(`Unexpected quote on line ${line}.`);
      quoted=true;
    } else if(ch===',')endField();
    else if(ch==='\n'||ch==='\r') {if(ch==='\r'&&text[i+1]==='\n')i++;endRow();line++;}
    else {if(closed)throw new Error(`Unexpected text after closing quote on line ${line}.`);field+=ch;}
  }
  if(quoted)throw new Error(`Unclosed quoted field starting at row ${start}.`);
  if(field||row.length||closed)endRow();
  if(rows.length<2)throw new Error('Include a header and at least one data row.');
  const headers=rows.shift().values.map(h=>h.trim());
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('Column names must be nonempty and unique.');
  if(rows.length>500)throw new Error('Import up to 500 records at a time.');
  return {headers,rows:rows.map(r=>{
    if(r.values.length!==headers.length)throw new Error(`Line ${r.line}: expected ${headers.length} fields, found ${r.values.length}.`);
    return {line:r.line,...Object.fromEntries(headers.map((h,i)=>[h,r.values[i]]))};
  })};
}

export const importTypes={
  questions:{label:'Questions',key:'question_id',required:['question_id','topic_codes','question','answer','difficulty','estimated_minutes'],columns:['question_id','topic_codes','question','answer','difficulty','estimated_minutes','marks','status','assets_json']},
  exams:{label:'Exam dates',key:'exam_id',required:['exam_id','exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status'],columns:['exam_id','exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status','source_url','label','subject_id','subject_name','specification_title']},
  subjects:{label:'Subjects & boards',key:'id',required:['id','name','board'],columns:['id','name','board']},
  specifications:{label:'Specifications',key:'id',required:['id','subject_id','code','title'],columns:['id','subject_id','code','title','source_url']},
  books:{label:'Books / modules',key:'id',required:['id','specification_id','title','required','sort_order'],columns:['id','specification_id','title','required','option_family','option_level','sort_order']},
  chapters:{label:'Chapters & examples',key:'id',required:['id','number','title'],columns:['id','book_id','number','title','description_md','example_md','reminder_reviewed','archived']},
  topics:{label:'Subtopics',key:'id',required:['id','chapter_id','number','title','difficulty_rating','length_rating'],columns:['id','chapter_id','number','title','page_start','page_count','length_rating','difficulty_rating','strand','archived']},
  papers:{label:'Papers & chapter mappings',key:'id',required:['id','specification_id','title'],columns:['id','specification_id','title','option_book_id','chapter_ids']},
  option_groups:{label:'Option groups',key:'id',required:['id','specification_id','title','min_choices','max_choices'],columns:['id','specification_id','title','min_choices','max_choices','archived']},
  options:{label:'Option choices',key:'id',required:['id','group_id','title'],columns:['id','group_id','title','book_ids','chapter_ids','topic_codes','requires_option_id','archived']}
};
export function readImport(type,text) {
  const spec=importTypes[type];if(!spec)throw new Error('Unknown import type.');
  const result=parseCSV(text);
  // Discard removed question metadata from older CSVs before any preview/storage.
  if(type==='questions'){
    const removed=['source','source_reference','licence','reviewed_by','_source'];
    result.headers=result.headers.filter(key=>!removed.includes(key));
    for(const row of result.rows)for(const key of removed)delete row[key];
  }
  const missing=spec.required.filter(h=>!result.headers.includes(h));
  if(missing.length)throw new Error(`Missing columns: ${missing.join(', ')}.`);
  const unknown=result.headers.filter(h=>!spec.columns.includes(h));
  if(unknown.length)throw new Error(`Unknown columns: ${unknown.join(', ')}. Use the template for this import type.`);
  return result.rows;
}
export const toCSV=rows=>rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n')+'\r\n';
