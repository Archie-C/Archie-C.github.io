// Runs the same student journey against the pre-12 scheduler and 12-queue-performance.sql
// on a large seeded bank, asserting identical choices and reporting timings.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'a-level/catalogue.json')));
const uid='00000000-0000-4000-8000-000000000001';
const QUESTIONS=Number(process.env.QUESTIONS||3000);
const BASE=['01-schema.sql','02-functions.sql','03-import.sql','04-catalogue.sql','06-admin.sql','07-exam-catalogue.sql',
  '08-options.sql','09-chapter-import.sql','10-question-metadata.sql','11-question-coverage.sql'];

function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const books=['maths-pure-mathematics-year-1','maths-applied-mathematics-year-1','further-maths-core-pure-mathematics-1',
  'further-maths-decision-mathematics-1','further-maths-further-mechanics-1'];

function bank() {
  const r=rng(7),pick=a=>a[Math.floor(r()*a.length)];
  // Include unselected books so eligibility filtering is exercised.
  const chapters=catalogue.chapters.filter(c=>books.includes(c.book_id)||['maths-pure-mathematics-year-2','further-maths-further-statistics-1'].includes(c.book_id));
  const topicsOf=id=>catalogue.subtopics.filter(t=>t.chapter_id===id).map(t=>t.id);
  const withTopics=chapters.filter(c=>topicsOf(c.id).length);
  const questions=[];
  for(let i=0;i<QUESTIONS;i++) {
    const c=pick(withTopics),tags=new Set([pick(topicsOf(c.id))]);
    if(r()<0.4) tags.add(pick(topicsOf(c.id)));
    if(r()<0.15) tags.add(pick(topicsOf(pick(withTopics).id)));
    questions.push({id:`perf-${i}`,version:1,prompt_md:`Question ${i}`,solution_md:`Solution ${i}`,difficulty:1+Math.floor(r()*5),
      estimated_seconds:60+Math.floor(r()*12)*60,total_marks:1+Math.floor(r()*6),review_status:r()<0.9?'verified':'draft',subtopic_ids:[...tags]});
  }
  return questions;
}

async function database(optimised) {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values ('${uid}');`);
  for(const file of [...BASE,...(optimised?['12-queue-performance.sql','12-queue-performance.sql']:[])])
    await db.exec(fs.readFileSync(path.join(root,'supabase/revision',file),'utf8'));
  const questions=bank();
  for(let i=0;i<questions.length;i+=500)
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:questions.slice(i,i+500)}]);
  // Exams near today exercise the exam-proximity term.
  await db.exec(`insert into public.revision_exams(paper_id,exam_date,source_url)
    select p.id,current_date+10+row_number() over(order by p.id)::int,'https://example.com' from public.revision_papers p`);
  await db.exec(`update public.revision_exams set exam_date=current_date+5 where exam_date<current_date`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec('set role authenticated');
  return db;
}

async function journey(db) {
  const r=rng(11),times={};let n=0;
  const id=()=>`00000000-0000-4000-9000-${String(++n).padStart(12,'0')}`;
  const api=async(action,payload={})=>{
    const t=performance.now();
    const data=(await db.query('select public.revision_api($1,$2) data',[action,payload])).rows[0].data;
    (times[action]??=[]).push(performance.now()-t);return data;
  };
  const steps=[];
  const exec=async sql=>{await db.exec('reset role');const rows=(await db.query(sql)).rows;await db.exec('set role authenticated');return rows;};
  const record=async(label,data)=>{
    const sid=data.session?.id;
    const cands=sid?await exec(`select * from revision_private.candidates('${uid}','${sid}') order by qid`):[];
    steps.push({label,items:data.session?.items.map(i=>[i.position,i.question_id,i.estimated_seconds,i.reason,i.state]),
      candidates:cands.map(c=>[c.qid,c.qversion,c.seconds,c.chapter,c.subject,String(c.priority),c.diagnostic,c.fresh,String(c.difficulty_gap)]),
      ...(data.bank_counts?{bank:[...data.bank_counts].sort((a,b)=>a.chapter_id.localeCompare(b.chapter_id)),
        chapters:[...data.selected_chapter_ids].sort(),topics:[...data.selected_subtopic_ids].sort(),
        progress:data.progress.map(p=>[p.chapter_id,p.assessed_subtopics,p.distinct_questions]).sort()}:{})});
  };
  await api('bootstrap',{timezone:'Europe/London'});
  let data=await api('settings',{request_id:id(),books,daily_minutes:90,exam_year:new Date().getFullYear(),timezone:'Europe/London'});
  await record('settings',data);
  const ratings=data.selected_chapter_ids.map(c=>({chapter_id:c,confidence:r()<0.1?null:1+Math.floor(r()*5)}));
  data=await api('confidence',{request_id:id(),ratings});await record('confidence',data);
  data={...data,...await api('start',{request_id:id()})};await record('start',data);
  for(let i=0;i<12;i++) {
    const s=data.session,item=s.items.find(x=>x.state==='queued');if(!item) break;
    const v=()=>({session_id:s.id,request_id:id()});
    data={...data,...await api('activate',{...v(),expected_version:data.session.version,item_id:item.id})};
    data={...data,...await api('reveal',{...v(),expected_version:data.session.version,item_id:item.id,active_seconds:30+Math.floor(r()*300),ease:1+Math.floor(r()*5)})};
    const active=data.session.items.find(x=>x.id===item.id);
    data=await api('complete',{...v(),expected_version:data.session.version,item_id:item.id,active_seconds:active.active_seconds+5,correctness:1+Math.floor(r()*5)});
    await record(`complete ${i}`,data);
  }
  data={...data,...await api('refresh',{session_id:data.session.id,expected_version:data.session.version,request_id:id(),continue:true})};
  await record('refresh',data);
  return {steps,times};
}

(async()=>{
  const results=[];
  for(const optimised of [false,true]) {
    const db=await database(optimised);
    try {results.push(await journey(db));} finally {await db.close();}
  }
  const [legacy,fast]=results;
  assert.equal(fast.steps.length,legacy.steps.length);
  for(let i=0;i<legacy.steps.length;i++) assert.deepEqual(fast.steps[i],legacy.steps[i],`Step ${legacy.steps[i].label} differs`);
  assert.ok(legacy.steps.find(s=>s.label==='start').items.length>=5,'Journey schedules questions');
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`${QUESTIONS} questions, identical results across ${legacy.steps.length} steps.`);
  for(const action of Object.keys(legacy.times)) console.log(`  ${action.padEnd(10)} legacy ${avg(legacy.times[action]).toFixed(0).padStart(6)} ms   optimised ${avg(fast.times[action]).toFixed(0).padStart(6)} ms`);
})().catch(error=>{console.error(error);process.exit(1);});
