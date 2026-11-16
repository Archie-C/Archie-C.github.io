// Keep descendant choices inside the selected catalogue branch. A parent change
// starts a new branch while preserving search, status, difficulty and sort.
export function hierarchyFilters(catalogue,selected={},changed=''){
  const values={...selected};
  const descendants={subject:['specification','chapter','topic'],specification:['chapter','topic'],chapter:['topic']};
  const clear=parent=>{for(const key of descendants[parent]||[])if(key in values)values[key]='';};
  clear(changed);
  if(values.subject&&!(catalogue.subjects||[]).some(s=>s.id===values.subject)){values.subject='';clear('subject');}
  const specifications=(catalogue.specifications||[]).filter(s=>!values.subject||s.subject_id===values.subject);
  if(values.specification&&!specifications.some(s=>s.id===values.specification)){values.specification='';clear('specification');}
  const specificationIDs=new Set(specifications.filter(s=>!values.specification||s.id===values.specification).map(s=>s.id));
  const bookIDs=new Set((catalogue.books||[]).filter(b=>specificationIDs.has(b.specification_id)).map(b=>b.id));
  const chapters=(catalogue.chapters||[]).filter(c=>bookIDs.has(c.book_id));
  if(values.chapter&&!chapters.some(c=>c.id===values.chapter)){values.chapter='';clear('chapter');}
  const chapterIDs=new Set(chapters.filter(c=>!values.chapter||c.id===values.chapter).map(c=>c.id));
  const topics=(catalogue.topics||[]).filter(t=>chapterIDs.has(t.chapter_id));
  if(values.topic&&!topics.some(t=>t.id===values.topic))values.topic='';
  return {values,specifications,chapters,topics};
}
