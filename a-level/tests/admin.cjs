const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createDatabase,uid}=require('./database.cjs');
const other='00000000-0000-4000-8000-000000000002';
async function run(){
  const {parseCSV,readImport,toCSV}=await import('../admin-import.mjs');
  const value='A comma, a "quote",\r\na new line and $\\frac{x}{2}$';
  assert.equal(parseCSV('\uFEFF'+toCSV([['question'],[value]])).rows[0].question,value);
  assert.equal(parseCSV('a,b\r\n1,2\r\n\r\n').rows.length,1);
  assert.equal(parseCSV('a,b\n"one\ntwo",three\nfour,five').rows[1].line,4);
  for(const text of ['a,a\n1,2','a,b\n1','a\n"unclosed','a\n"closed"x','a\nx"y'])assert.throws(()=>parseCSV(text));
  assert.throws(()=>readImport('questions','question_id\nx'),/Missing columns/);
  assert.throws(()=>readImport('subjects','id,name,board,unknown\nx,y,z,w'),/Unknown columns/);
  assert.equal(readImport('chapters','id,number,title\naqa-7408-chapter-1,1,Chapter')[0].number,'1');
  const db=await createDatabase();
  const asUser=async(id,fn)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');
    try{return await fn();}finally{await db.exec('reset role');}
  };
  const admin=(action,payload={})=>asUser(uid,async()=>(await db.query('select public.revision_admin_api($1,$2) data',[action,payload])).rows[0].data);
  const preview=(type,rows)=>admin('preview',{type,rows});
  const commit=async(type,rows)=>{const p=await preview(type,rows);assert.equal(p.valid,true,JSON.stringify(p));return admin('import',{type,rows,token:p.token,request_id:randomUUID()});};
  try{
    // No metadata or arbitrary payload can grant a role. Private functions/tables stay inaccessible.
    for(const action of ['catalogue','preview','import','record','list','student','history_detail']){
      await assert.rejects(admin(action,{type:'questions',admin:true,user_id:uid}),/ADMIN_REQUIRED/);
    }
    await asUser(uid,async()=>{
      assert.equal((await db.query('select public.revision_is_admin() yes')).rows[0].yes,false);
      await assert.rejects(db.query('insert into revision_private.admins(user_id) values($1)',[uid]),/permission denied/);
      await assert.rejects(db.query('select revision_private.set_admin($1,true)',[uid]),/permission denied/);
      await assert.rejects(db.query('select * from revision_private.solutions'),/permission denied/);
      await assert.rejects(db.query("insert into public.revision_subjects values ('unauthorized','X','X')"),/permission denied/);
    });
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    await db.exec("insert into public.revision_subjects values ('test-subject','Test','AQA'); insert into public.revision_specifications values ('aqa-7408','test-subject','7408','Physics','');");
    const inferred={id:'physics-aqa-7408-chapter-1',number:'1',title:'Physics chapter'};
    const inferredPlan=await preview('chapters',[inferred]);
    assert.equal(inferredPlan.valid,true,JSON.stringify(inferredPlan));
    assert.equal(inferredPlan.rows[0].effects[0].specification_id,'aqa-7408');
    assert.equal((await commit('chapters',[inferred])).inserted,1);
    assert.equal((await commit('chapters',[inferred])).skipped,1);
    assert.equal((await preview('chapters',[{...inferred,id:'unknown-chapter'}])).valid,false);
    await db.exec("insert into public.revision_specifications values ('aqa-7500','test-subject','7500','Test','');");
    await db.query('insert into public.revision_profiles(user_id) values($1) on conflict do nothing',[uid]);
    await db.query("insert into public.revision_specification_enrolments values ($1,'aqa-7500')",[uid]);
    const archived={id:'aqa-7500-chapter-1',number:'1',title:'Archived chapter',archived:'true'};
    assert.equal((await commit('chapters',[archived])).inserted,1);
    assert.equal((await db.query("select count(*)::int n from public.revision_enrolments e join public.revision_books b on b.id=e.book_id where e.user_id=$1 and b.specification_id='aqa-7500'",[uid])).rows[0].n,1);
    await asUser(uid,async()=>assert.equal((await db.query('select public.revision_is_admin() yes')).rows[0].yes,true));
    const cat=await admin('catalogue'),topic=cat.topics[0],chapter=cat.chapters.find(c=>c.id===topic.chapter_id);
    const q={question_id:'admin-test-question',topic_codes:topic.id,question:'Solve $2x=6$.',answer:'$x=3$.',difficulty:'2',estimated_minutes:'2.5',marks:'3',status:'verified'};
    let plan=await preview('questions',[q]);assert.equal(plan.rows[0].operation,'new');
    assert.equal((await db.query('select count(*)::int n from public.revision_questions')).rows[0].n,0,'Preview is read-only');
    const payload={type:'questions',rows:[q],token:plan.token,request_id:randomUUID(),filename:'questions.csv'};
    const result=await admin('import',payload);assert.equal(result.inserted,1);assert.deepEqual(await admin('import',payload),result,'Lost response replay');
    await assert.rejects(admin('import',{...payload,filename:'different.csv'}),/IDEMPOTENCY_CONFLICT/);
    assert.equal((await commit('questions',[q])).skipped,1,'Repeated CSV is idempotent');
    assert.equal((await preview('questions',[q,q])).valid,false);
    for(const invalid of [{...q,topic_codes:'unknown'},{...q,difficulty:'6'},{...q,estimated_minutes:'0.001'},{...q,marks:'-1'},{...q,answer:''},{...q,status:'other'},{...q,assets_json:'{}'}]){
      const p=await preview('questions',[invalid]);assert.equal(p.valid,false,JSON.stringify(invalid));assert.ok(p.rows[0].error);
    }
    const invalidRows=[{...q,question_id:'valid-first-row'},{...q,question_id:'invalid-second-row',difficulty:'0'}];
    const invalidResult=await admin('import',{type:'questions',rows:invalidRows,token:(await preview('questions',invalidRows)).token,request_id:randomUUID()});
    assert.equal(invalidResult.failed,2);assert.equal((await db.query("select count(*)::int n from public.revision_questions where id='valid-first-row'")).rows[0].n,0);
    // Seed an actual historical attempt and learned posterior, then edit content.
    await db.query('insert into public.revision_profiles(user_id) values($1)',[other]);
    await db.query('insert into public.revision_progress(user_id,chapter_id,confidence,alpha,beta,attempts) values($1,$2,3,7,4,1)',[other,chapter.id]);
    const sid=randomUUID(),queue=randomUUID();
    await db.query("insert into public.revision_sessions(id,user_id,local_date,target_seconds) values($1,$2,current_date,600)",[sid,other]);
    await db.query("insert into public.revision_queue(id,session_id,position,question_id,question_version,estimated_seconds,reason,state) values($1,$2,1,$3,1,150,'test','completed')",[queue,sid,q.question_id]);
    await db.query('insert into public.revision_attempts(user_id,queue_id,session_id,question_id,question_version,ease,correctness,active_seconds,local_date,idempotency_key) values($1,$2,$3,$4,1,3,4,120,current_date,$5)',[other,queue,sid,q.question_id,randomUUID()]);
    const progressBefore=(await db.query('select to_jsonb(p) v from public.revision_progress p')).rows[0].v;
    const changed={...q,question:'Solve $3x=12$.',answer:'$x=4$.'};
    const stale=await preview('questions',[changed]);
    assert.equal((await commit('questions',[{...q,question:'Solve $5x=15$.'}])).updated,1);
    const rejected=await admin('import',{type:'questions',rows:[changed],token:stale.token,request_id:randomUUID()});assert.match(rejected.error,/PREVIEW_STALE/);
    assert.equal((await commit('questions',[changed])).updated,1);
    assert.equal((await db.query('select question_version from public.revision_attempts')).rows[0].question_version,1);
    assert.equal((await db.query('select solution_md from revision_private.solutions where question_version=1')).rows[0].solution_md,q.answer);
    assert.deepEqual((await db.query('select to_jsonb(p) v from public.revision_progress p')).rows[0].v,progressBefore);
    assert.equal((await db.query("select count(*)::int n from public.revision_questions where status='verified'")).rows[0].n,1);
    const saved=await admin('record',{type:'questions',id:q.question_id});assert.equal(saved._version,3);
    assert.equal((await commit('questions',[{...saved,status:'archived'}])).updated,1);
    assert.equal((await db.query("select count(*)::int n from public.revision_questions where status='verified'")).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n,1);
    const draft={...q,question_id:'admin-draft-question',status:''};assert.equal((await commit('questions',[draft])).inserted,1);
    assert.equal((await db.query('select status from public.revision_questions where id=$1',[draft.question_id])).rows[0].status,'draft');
    const paper=cat.papers[0],spec=cat.specifications.find(s=>s.id===paper.specification_id),subject=cat.subjects.find(s=>s.id===spec.subject_id);
    const exam={exam_id:'test-sitting-2027',exam_board:subject.board,specification:spec.code,paper_code:paper.id,paper_name:paper.title,exam_date:'2027-06-01',start_time:'09:00',duration_minutes:'120',status:'estimated',source_url:'https://example.test/timetable'};
    assert.equal((await commit('exams',[exam])).inserted,1);
    assert.equal((await commit('exams',[exam])).skipped,1);
    const eid=(await db.query('select id from public.revision_exams')).rows[0].id;
    assert.equal((await commit('exams',[{...exam,exam_date:'2027-06-02',status:'confirmed'}])).updated,1);
    assert.equal((await db.query('select id from public.revision_exams')).rows[0].id,eid);
    assert.equal((await commit('exams',[{...exam,exam_id:'test-sitting-2028',exam_date:'2028-06-01'}])).inserted,1);
    for(const bad of [{...exam,exam_date:'2027-02-30'},{...exam,exam_date:'01/06/2027'},{...exam,start_time:'24:00'},{...exam,duration_minutes:'0'},{...exam,exam_board:'Wrong'},{...exam,specification:'missing'},{...exam,exam_id:'different-id'},{...exam,exam_date:'2029-01-01'}])assert.equal((await preview('exams',[bad])).valid,false,JSON.stringify(bad));
    assert.equal((await preview('exams',[exam,exam])).valid,false);
    const listedExams=await admin('list',{type:'exams'});assert.equal(listedExams.total,2);assert.ok(listedExams.rows.every(Boolean));
    await db.query('insert into public.revision_exams(paper_id,exam_date,source_url) values($1,$2,$3)',[paper.id,'2029-06-01','']);
    const adopt={...exam,exam_id:'adopt-2029',exam_date:'2029-06-02'};assert.equal((await commit('exams',[adopt])).updated,1);
    assert.equal((await commit('exams',[adopt])).skipped,1);
    // Natural duplicates appear in preview; unexpected execution failures roll back the whole batch.
    const newChapter={id:'test-admin-chapter',book_id:chapter.book_id,number:'999',title:'Test chapter'};
    assert.equal((await preview('chapters',[newChapter,{...newChapter,id:'test-admin-duplicate'}])).valid,false);
    await db.exec("create function revision_private.test_fail() returns trigger language plpgsql as $$ begin if new.id='test-admin-failure' then raise exception 'Simulated storage failure'; end if; return new; end $$; create trigger test_failure before insert on public.revision_chapters for each row execute function revision_private.test_fail();");
    const failRows=[newChapter,{...newChapter,id:'test-admin-failure',number:'998'}],p=await preview('chapters',failRows);
    assert.equal(p.valid,true);
    const fail=await admin('import',{type:'chapters',rows:failRows,token:p.token,request_id:randomUUID()});assert.equal(fail.failed,2);
    assert.equal((await db.query("select count(*)::int n from public.revision_chapters where id='test-admin-chapter'")).rows[0].n,0);
    await db.exec('drop trigger test_failure on public.revision_chapters; drop function revision_private.test_fail();');
    const updatedChapter={...chapter,description_md:'A reviewed description',example_md:'For example $x^2=4$.',reminder_reviewed:'true'};
    assert.equal((await commit('chapters',[updatedChapter])).updated,1);assert.equal((await commit('chapters',[updatedChapter])).skipped,1);
    assert.deepEqual((await db.query('select to_jsonb(p) v from public.revision_progress p')).rows[0].v,progressBefore);
    assert.equal((await preview('chapters',[{...updatedChapter,book_id:cat.books.find(b=>b.id!==chapter.book_id).id}])).valid,false);
    for(const type of ['subjects','specifications','books','chapters','topics','papers']){
      const list=await admin('list',{type,limit:3});assert.ok(list.rows.length);assert.ok(list.total>=list.rows.length);
      const record=list.rows[0];assert.equal((await preview(type,[record])).rows[0].operation,'unchanged',JSON.stringify({type,record}));
    }
    const retire={...q,question_id:'admin-retirement-question'};await commit('questions',[retire]);
    const archiveChapter={...updatedChapter,archived:'true'};
    const retirementPlan=await preview('chapters',[archiveChapter]);assert.equal(retirementPlan.rows[0].effects[0].question_id,retire.question_id);
    await commit('chapters',[archiveChapter]);
    assert.equal((await db.query('select status from public.revision_questions where id=$1',[retire.question_id])).rows[0].status,'archived');
    assert.equal((await preview('questions',[{...q,question_id:'reject-archived-topic'}])).valid,false);
    const retired=await admin('record',{type:'questions',id:retire.question_id});await commit('questions',[{...retired,status:'withdrawn'}]);
    assert.equal((await commit('questions',[{...retired,status:'withdrawn'}])).skipped,1);
    assert.deepEqual((await db.query('select to_jsonb(p) v from public.revision_progress p')).rows[0].v,progressBefore);
    const students=await admin('list',{type:'students'});assert.equal(students.total,2);
    const detail=await admin('student',{id:other});assert.equal(detail.activity.length,1);assert.equal(detail.progress[0].proficiency,7/11);
    const history=await admin('list',{type:'history',limit:100});assert.ok(history.rows.some(h=>h.result.failed===2));
    assert.ok((await admin('history_detail',{id:history.rows[0].id})).changes);
    await asUser(other,async()=>{
      await assert.rejects(db.query("select public.revision_admin_api('student',$1)",[{id:uid}]),/ADMIN_REQUIRED/);
      assert.equal((await db.query('select count(*)::int n from public.revision_profiles')).rows[0].n,1);
      await assert.rejects(db.query('select * from revision_private.admin_imports'),/permission denied/);
    });
    await db.exec('set role anon');
    await assert.rejects(db.query("select public.revision_admin_api('catalogue')"),/permission denied/);await db.exec('reset role');
    await db.query('select revision_private.set_admin($1,false)',[uid]);
    await assert.rejects(admin('catalogue'),/ADMIN_REQUIRED/);
    console.log('Admin checks: CSV quoting/LaTeX, row validation, permissions, immutable edits, repeat imports, stale previews, exam identity, rollback, catalogue, students and audit passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
