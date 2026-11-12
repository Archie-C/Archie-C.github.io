const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'a-level/catalogue.json')));
const uid='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const {randomUUID}=require('node:crypto');

async function createDatabase() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values ('${uid}'),('${other}');`);
  for(const file of ['01-schema.sql','02-functions.sql','03-import.sql','04-catalogue.sql']) {
    const sql=fs.readFileSync(path.join(root,'supabase/revision',file),'utf8');
    await db.exec(sql);await db.exec(sql);
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/revision/05-verification.sql'),'utf8'));
  return db;
}
function fixtureBank() {
  const cs=catalogue.chapters.filter(c=>c.book_id==='maths-pure-mathematics-year-1');
  const tags=id=>catalogue.subtopics.filter(t=>t.chapter_id===id).map(t=>t.id);
  const base={version:1,prompt_md:'Find $x$ when $2x=6$.',solution_md:'Divide by two: $x=3$.',difficulty:1,estimated_seconds:120,total_marks:2,
    assets:[{url:'/a-level/tests/fixtures/diagram.svg',alt:'A test coordinate diagram',caption:'Integration fixture only'}],source:{title:'Original integration test',licence:'CC0',reviewed_by:'Test fixture'},review_status:'verified'};
  const questions=[];
  for(let i=0;i<6;i++) questions.push({...base,id:`fixture-algebra-${i}`,subtopic_ids:[tags(cs[0].id)[i%tags(cs[0].id).length]]});
  for(let i=0;i<4;i++) questions.push({...base,id:`fixture-quadratics-${i}`,subtopic_ids:[tags(cs[1].id)[i%tags(cs[1].id).length]]});
  questions.push({...base,id:'fixture-mixed',subtopic_ids:[tags(cs[0].id)[0],tags(cs[1].id)[0]]});
  questions.push({...base,id:'fixture-uncovered',subtopic_ids:[tags(cs[2].id)[0]]});
  questions.push({...base,id:'fixture-draft',subtopic_ids:[tags(cs[0].id)[0]],review_status:'draft'});
  return {schema_version:1,questions};
}

async function run() {
  const db=await createDatabase();
  try {
    assert.equal((await db.query('select count(*)::int n from public.revision_chapters')).rows[0].n,118);
    assert.equal((await db.query('select count(*)::int n from public.revision_subtopics')).rows[0].n,558);
    const regenerated=JSON.parse(require('node:child_process').execFileSync('python',['-c',"import runpy,json; print(json.dumps(runpy.run_path('a-level/tools/generate_catalogue.py')['build']()))"],{cwd:root,encoding:'utf8'}));
    assert.deepEqual(regenerated,catalogue,'Generated JSON matches both authoritative CSVs');
    const bank=fixtureBank();
    await db.query('select revision_private.import_questions($1)',[bank]);
    await db.query('select revision_private.import_questions($1)',[bank]);
    await assert.rejects(db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[{...bank.questions[0],prompt_md:'Changed'}]}]),/immutable/);
    await assert.rejects(db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[{...bank.questions[0],id:'unknown-tag',subtopic_ids:['missing']}]}]),/Unknown subtopic/);
    const invalidAsset={...bank.questions[0],id:'unsafe-asset',assets:[{url:'javascript:alert(1)',alt:'Bad'}]};
    await assert.rejects(db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[invalidAsset]}]),/Assets require/);
    async function identity(id=uid,role='authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
      await db.exec(`set role ${role}`);
    }
    await identity();
    const api=async(action,payload={})=>(await db.query('select public.revision_api($1,$2) data',[action,payload])).rows[0].data;
    const mutate=(action,payload={})=>api(action,{...payload,request_id:randomUUID()});
    let data=await api('bootstrap',{timezone:'Europe/Vienna'});
    assert.equal(data.profile.daily_minutes,60);assert.equal(data.profile.onboarded,false);
    await assert.rejects(db.query('select * from revision_private.solutions'),/permission denied/);
    await assert.rejects(db.query("update public.revision_progress set alpha=99"),/permission denied/);
    await assert.rejects(db.query('select revision_private.import_questions($1)',[bank]),/permission denied/);
    assert.equal((await db.query("select count(*)::int n from public.revision_questions where status='draft'")).rows[0].n,0);
    data=await mutate('settings',{books:['maths-pure-mathematics-year-1'],daily_minutes:10,exam_year:2027,timezone:'Europe/Vienna'});
    assert.equal(data.enrolments.length,4);
    await assert.rejects(mutate('settings',{books:['further-maths-core-pure-mathematics-1']}),/INVALID_FURTHER_OPTIONS/);
    assert.equal((await api('bootstrap')).enrolments.length,4,'Failed settings rollback');
    const chapters=catalogue.chapters.filter(c=>c.book_id==='maths-pure-mathematics-year-1');
    const ratings=chapters.slice(0,2).map(c=>({chapter_id:c.id,confidence:3}));
    data=await mutate('confidence',{ratings});
    assert.equal(data.progress[0].alpha,1);assert.equal(data.progress[0].beta,1);
    data=await mutate('start');
    assert.ok(data.session.items.length>=5);
    assert.ok(!data.session.items.some(i=>i.question_id==='fixture-uncovered'||i.question_id==='fixture-draft'));
    assert.ok(data.session.items.every(i=>i.solution_md===null));
    const sid=data.session.id;
    const change=async(action,payload={})=>{
      data=await mutate(action,{session_id:sid,expected_version:data.session.version,...payload});return data;
    };
    await assert.rejects(mutate('activate',{session_id:sid,expected_version:999,item_id:data.session.items[0].id}),/SESSION_CONFLICT/);
    await change('activate',{item_id:data.session.items.find(i=>i.chapter_ids.length===1).id});
    let item=data.session.items.find(i=>i.state==='active');
    await assert.rejects(change('reveal',{item_id:item.id,active_seconds:15}),/EASE_REQUIRED/);
    await assert.rejects(change('complete',{item_id:item.id,active_seconds:15,correctness:5}),/REVEAL_REQUIRED/);
    await change('checkpoint',{item_id:item.id,active_seconds:30,ease:4});
    await change('reveal',{item_id:item.id,active_seconds:35,ease:4});
    assert.match(data.session.items.find(i=>i.id===item.id).solution_md,/Divide/);
    await assert.rejects(change('checkpoint',{item_id:item.id,active_seconds:40,ease:3}),/EASE_LOCKED/);
    await assert.rejects(change('checkpoint',{item_id:item.id,active_seconds:1}),/INVALID_DURATION/);
    await change('checkpoint',{item_id:item.id,active_seconds:35,draft_correctness:4,draft_marks:1});
    assert.equal(data.session.items.find(i=>i.id===item.id).draft_correctness,4);
    await assert.rejects(change('checkpoint',{item_id:item.id,active_seconds:35,draft_marks:3}),/INVALID_MARKS/);
    const request={session_id:sid,expected_version:data.session.version,item_id:item.id,active_seconds:120,correctness:5,earned_marks:2,request_id:randomUUID()};
    data=await api('complete',request);
    const replay=await api('complete',request);assert.deepEqual(replay,data);
    await assert.rejects(api('complete',{...request,correctness:1}),/IDEMPOTENCY_CONFLICT/);
    assert.equal(data.totals.questions,1);
    assert.equal(data.progress.find(p=>p.chapter_id===item.chapter_ids[0]).alpha,2);
    const after=await mutate('confidence',{ratings:[{chapter_id:item.chapter_ids[0],confidence:1}]});
    assert.equal(after.progress.find(p=>p.chapter_id===item.chapter_ids[0]).alpha,2,'Re-rating preserves evidence');
    data=after;
    // A partly correct attempt retires this stable question ID, including future versions.
    assert.ok(!data.session.items.some(i=>i.question_id===item.question_id&&i.state==='queued'));
    // Multi-chapter evidence totals exactly one, independent of the number of subtopic tags.
    const mixed=data.session.items.find(i=>i.question_id==='fixture-mixed');
    if(!mixed) {await change('refresh');}
    const mix=data.session.items.find(i=>i.question_id==='fixture-mixed');
    assert.ok(mix,'Mixed covered question is eligible');
    await change('activate',{item_id:mix.id});
    await change('reveal',{item_id:mix.id,active_seconds:10,ease:2});
    const before=(await api('bootstrap')).progress.reduce((n,p)=>n+Number(p.alpha)+Number(p.beta),0);
    await change('complete',{item_id:mix.id,active_seconds:45,correctness:1});
    const afterEvidence=data.progress.reduce((n,p)=>n+Number(p.alpha)+Number(p.beta),0);
    assert.ok(Math.abs(afterEvidence-before-1)<1e-9);
    assert.ok(!data.session.items.some(i=>i.question_id==='fixture-mixed'&&i.state==='queued'),'No same-day incorrect retry');
    // Blank confidence removes queued content without deleting accumulated evidence.
    data=await mutate('confidence',{ratings:[{chapter_id:chapters[0].id,confidence:null}]});
    assert.ok(!data.session.items.some(i=>i.state==='queued'&&i.chapter_ids.includes(chapters[0].id)));
    assert.ok(data.progress.find(p=>p.chapter_id===chapters[0].id).attempts>0);
    await identity(other);
    await api('bootstrap');
    assert.equal((await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.revision_queue')).rows[0].n,0);
    await assert.rejects(mutate('refresh',{session_id:sid,expected_version:data.session.version}),/SESSION_NOT_FOUND/);
    await identity(null,'anon');
    await assert.rejects(api('bootstrap'),/permission denied/);
    await assert.rejects(db.query('select * from public.revision_profiles'),/permission denied/);
    await identity();
    data=await mutate('syllabus_check',{active_seconds:120});
    assert.equal(data.session.check_seconds,120);
    await assert.rejects(mutate('syllabus_check',{active_seconds:120}),/CHECK_NOT_DUE/);
    // Retired IDs stay retired after publishing a corrected question version.
    await db.exec('reset role');
    const replacement={...bank.questions.find(q=>q.id===item.question_id),version:2,solution_md:'A reviewed correction: $x=3$.'};
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[replacement]}]);
    assert.equal((await db.query('select status from public.revision_questions where id=$1 and version=1',[item.question_id])).rows[0].status,'archived');
    assert.equal((await db.query('select question_version from public.revision_attempts where question_id=$1',[item.question_id])).rows[0].question_version,1);
    await identity();
    data=await api('bootstrap');
    // API refresh, not helper access, is the student's supported path.
    data=await mutate('refresh',{session_id:sid,expected_version:data.session.version});
    assert.ok(!data.session.items.some(q=>q.state==='queued'&&q.question_id===item.question_id));
    await scheduleScenarios(db,bank);
    console.log('Database integration: catalogue, imports, learning transactions, idempotency, concurrency and RLS passed.');
  } finally {await db.close();}
}
async function scheduleScenarios(db,bank) {
  await db.exec('reset role');
  const student=randomUUID();await db.query('insert into auth.users values ($1)',[student]);
  const long={...bank.questions.find(q=>q.id==='fixture-mixed'),id:'fixture-long',estimated_seconds:7200};
  await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[long]}]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[student]);await db.exec('set role authenticated');
  let current=(await db.query("select public.revision_api('bootstrap','{}') d")).rows[0].d;
  const call=async(action,payload={})=>{
    const response=(await db.query('select public.revision_api($1,$2) d',[action,{request_id:randomUUID(),...payload}])).rows[0].d;
    current={...current,...response};return current;
  };
  await call('settings',{books:['maths-pure-mathematics-year-1'],daily_minutes:5});
  const chapters=catalogue.chapters.filter(c=>c.book_id==='maths-pure-mathematics-year-1').slice(0,2);
  await call('confidence',{ratings:chapters.map(c=>({chapter_id:c.id,confidence:3}))});
  await call('start');
  assert.ok(!current.session.items.some(q=>q.question_id==='fixture-long'),'Long priority questions cannot displace fitting questions');
  assert.ok(current.session.items.reduce((n,q)=>n+q.estimated_seconds,0)<=420,'Overrun is limited to a shortest available question');
  const q=current.session.items.find(q=>q.chapter_ids.length===1),chapter=q.chapter_ids[0];
  const original=bank.questions.find(x=>x.id===q.question_id);
  async function questionAction(action,payload={}) {return call(action,{session_id:current.session.id,expected_version:current.session.version,item_id:q.id,...payload});}
  await questionAction('activate');await questionAction('reveal',{ease:1,active_seconds:20});
  await questionAction('complete',{correctness:1,active_seconds:150});
  await call('finish',{session_id:current.session.id,expected_version:current.session.version});
  await db.exec('reset role');
  await db.query('update public.revision_sessions set local_date=local_date-1 where user_id=$1',[student]);
  await db.query("update public.revision_attempts set local_date=local_date-1,completed_at=completed_at-interval '1 day' where user_id=$1",[student]);
  await db.query("update public.revision_progress set last_attempt_at=last_attempt_at-interval '1 day',review_step=1 where user_id=$1 and chapter_id=$2",[student,chapter]);
  await db.query("update public.revision_questions set status='withdrawn' where status='verified' and id<>$1",[q.question_id]);
  await db.exec('set role authenticated');
  await call('start');
  assert.equal(current.session.items[0].question_id,q.question_id,'Completely incorrect questions return on a later day in a new session');
  assert.equal(current.session.items[0].estimated_seconds,150,'Observed durations refine estimates');
  q.id=current.session.items[0].id;
  await questionAction('activate');await questionAction('reveal',{ease:5,active_seconds:30});
  await questionAction('complete',{correctness:5,active_seconds:150});
  let progress=current.progress.find(p=>p.chapter_id===chapter);
  assert.equal(progress.review_step,2);
  assert.equal(Math.round((Date.parse(progress.next_review)-Date.parse(current.today))/86400000),7);
  // Further success on the same day must not jump the interval again.
  const another=bank.questions.find(x=>x.id!==q.question_id&&x.subtopic_ids[0]===original.subtopic_ids[0]);
  await db.exec('reset role');
  await db.query("update public.revision_questions set status='verified' where id=$1 and version=(select max(version) from public.revision_questions where id=$1)",[another.id]);
  await db.exec('set role authenticated');
  await call('refresh',{session_id:current.session.id,expected_version:current.session.version});
  const next=current.session.items.find(i=>i.state==='queued');assert.ok(next);q.id=next.id;
  await questionAction('activate');await questionAction('reveal',{ease:5,active_seconds:20});await questionAction('complete',{correctness:5,active_seconds:120});
  progress=current.progress.find(p=>p.chapter_id===chapter);assert.equal(progress.review_step,2);
  console.log('Scheduler scenarios: time fitting, later-day reuse, observed durations and retention boundaries passed.');
}
if(require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={createDatabase,fixtureBank,uid};
