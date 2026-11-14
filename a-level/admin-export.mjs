import {importTypes,toCSV} from './admin-import.mjs';

export const topicExportColumns=[...importTypes.topics.columns,
  'chapter_number','chapter_title','chapter_archived','book_id','book_title',
  'specification_id','specification_code','specification_title','subject_id','subject_name','exam_board'];

export function topicExportRows(catalogue,filters={}){
  const index=key=>new Map((catalogue[key]||[]).map(row=>[row.id,row]));
  const chapters=index('chapters'),books=index('books'),specifications=index('specifications'),subjects=index('subjects');
  const search=String(filters.search||'').trim().toLocaleLowerCase();
  const status=filters.status||'active';
  return (catalogue.topics||[]).map(topic=>{
    const chapter=chapters.get(topic.chapter_id),book=books.get(chapter?.book_id),
      specification=specifications.get(book?.specification_id),subject=subjects.get(specification?.subject_id);
    return {...topic,chapter_number:chapter?.number??'',chapter_title:chapter?.title||'',chapter_archived:Boolean(chapter?.archived),
      book_id:book?.id||'',book_title:book?.title||'',specification_id:specification?.id||'',
      specification_code:specification?.code||'',specification_title:specification?.title||'',
      subject_id:subject?.id||'',subject_name:subject?.name||'',exam_board:subject?.board||''};
  }).filter(row=>(!filters.subject||row.subject_id===filters.subject)
    &&(!filters.specification||row.specification_id===filters.specification)
    &&(!filters.chapter||row.chapter_id===filters.chapter)
    &&(status==='all'||(status==='archived'?row.archived||row.chapter_archived:!row.archived&&!row.chapter_archived))
    &&(!search||Object.values(row).some(value=>String(value??'').toLocaleLowerCase().includes(search))))
    .sort((a,b)=>String(filters.sort==='title'?a.title:a.id).localeCompare(String(filters.sort==='title'?b.title:b.id),undefined,{numeric:true})||a.id.localeCompare(b.id));
}

export const topicsToCSV=rows=>toCSV([topicExportColumns,...rows.map(row=>topicExportColumns.map(key=>row[key]??''))]);
