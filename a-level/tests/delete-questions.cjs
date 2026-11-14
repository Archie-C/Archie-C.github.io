const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createDatabase,fixtureBank,uid}=require('./database.cjs');

async function run(){
  const db=await createDatabase();
  const sql=fs.readFileSync(path.resolve(__dirname,'../../supabase/revision/maintenance/delete-all-questions.sql'),'utf8');
  const count=async table=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
  const rows=async table=>(await db.query(`select coalesce(jsonb_agg(v order by v::text),'[]') data from (select to_jsonb(t) v from ${table} t) records`)).rows[0].data;
  try{
    const bank=fixtureBank(),question=bank.questions[0],other=bank.questions[1];
    await db.query('select revision_private.import_questions($1)',[bank]);
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[{...question,version:2}]}]);
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    await db.query('insert into public.revision_profiles(user_id) values($1)',[uid]);
    const chapter=(await db.query('select chapter_id from public.revision_subtopics where id=$1',[question.subtopic_ids[0]])).rows[0].chapter_id;
    await db.query('insert into public.revision_progress(user_id,chapter_id,confidence,prior_alpha,prior_beta,alpha,beta,attempts,review_step,next_review,last_attempt_at) values($1,$2,3,2,3,7,4,1,2,current_date+7,now())',[uid,chapter]);
    const session=randomUUID(),completed=randomUUID(),active=randomUUID(),receipt=randomUUID();
    await db.query('insert into public.revision_sessions(id,user_id,local_date,target_seconds,check_seconds) values($1,$2,current_date,600,120)',[session,uid]);
    await db.query("insert into public.revision_queue(id,session_id,position,question_id,question_version,estimated_seconds,reason,state) values($1,$2,1,$3,1,120,'test','completed'),($4,$2,2,$5,1,120,'test','active')",[completed,session,question.id,active,other.id]);
    await db.query('insert into public.revision_attempts(user_id,queue_id,session_id,question_id,question_version,ease,correctness,active_seconds,local_date,idempotency_key) values($1,$2,$3,$4,1,3,4,120,current_date,$5)',[uid,completed,session,question.id,randomUUID()]);
    await db.query("insert into revision_private.receipts(user_id,request_id,action,payload,result) values($1,$2,'activate','{}',$3)",[uid,receipt,{session:{prompt_md:question.prompt_md}}]);
    for(const type of ['questions','chapters'])await db.query('insert into revision_private.admin_imports(id,admin_id,import_type,payload,result,changes) values($1,$2,$3,$4,$5,$6)',[randomUUID(),uid,type,{rows:[]},{inserted:1},type==='questions'?[{after:{question:question.prompt_md,answer:question.solution_md}}]:[]]);
    const tableNames=['public.revision_questions','revision_private.solutions','public.revision_question_subtopics','public.revision_queue','public.revision_attempts','public.revision_sessions','public.revision_progress','revision_private.receipts','revision_private.admin_imports'];
    const before=await Promise.all(tableNames.map(rows));
    await assert.rejects(db.exec(sql),/Deletion stopped: 1 student attempt/);
    await db.exec('rollback');
    assert.deepEqual(await Promise.all(tableNames.map(rows)),before,'Default guard leaves all data intact');
    const protectedTables=['auth.users','revision_private.admins','public.revision_profiles','public.revision_enrolments',
      'public.revision_subjects','public.revision_specifications','public.revision_books','public.revision_chapters','public.revision_subtopics',
      'public.revision_exams','public.revision_option_groups','public.revision_options','public.revision_option_targets',
      'public.revision_specification_enrolments','public.revision_option_selections'];
    const protectedBefore=await Promise.all(protectedTables.map(rows));
    assert.ok(sql.includes('delete_attempt_history boolean := false;'));
    await db.exec(sql.replace('delete_attempt_history boolean := false;','delete_attempt_history boolean := true;'));
    for(const table of ['public.revision_questions','revision_private.solutions','public.revision_question_subtopics','public.revision_queue','public.revision_attempts','revision_private.receipts'])assert.equal(await count(table),0,table);
    assert.deepEqual(await Promise.all(protectedTables.map(rows)),protectedBefore,'Accounts, catalogue, selections and settings remain unchanged');
    const progress=(await rows('public.revision_progress'))[0];
    assert.equal(progress.confidence,3);assert.equal(Number(progress.alpha),2);assert.equal(Number(progress.beta),3);
    assert.equal(progress.attempts,0);assert.equal(progress.review_step,0);assert.equal(progress.next_review,null);assert.equal(progress.last_attempt_at,null);
    const retainedSession=(await rows('public.revision_sessions'))[0];
    assert.equal(retainedSession.version,2);assert.equal(retainedSession.check_seconds,120);assert.equal(retainedSession.target_seconds,600);
    assert.equal(await count('revision_private.admin_imports'),1);assert.equal((await rows('revision_private.admin_imports'))[0].import_type,'chapters');
    await db.exec(sql); // Empty-bank rerun succeeds with the safe default.
    assert.equal((await rows('public.revision_sessions'))[0].version,2,'Rerun does not change unrelated sessions');
    assert.equal((await db.query('select revision_private.import_questions($1) n',[bank])).rows[0].n,bank.questions.length,'The deleted IDs can be imported again');
    // The default also handles a nonempty bank with active work but no attempts.
    await db.query("insert into public.revision_queue(session_id,position,question_id,question_version,estimated_seconds,reason,state) values($1,1,$2,1,120,'test','active')",[session,question.id]);
    await db.exec(sql);
    assert.equal(await count('public.revision_questions'),0);assert.equal(await count('public.revision_queue'),0);
    assert.equal((await rows('public.revision_sessions'))[0].version,3);
    console.log('Question deletion: default attempt guard, atomic rollback, opt-in history reset, all-version/content/cache cleanup, preserved catalogue/accounts/confidence, active queues, rerun and reimport passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
