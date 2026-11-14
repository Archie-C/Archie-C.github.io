const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createDatabase,fixtureBank,uid}=require('./database.cjs');
const removed=['source','source_reference','licence','reviewed_by','_source'];
function assertNoMetadata(value){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    assert.ok(!removed.includes(key),`Removed metadata remains: ${key}`);
    assertNoMetadata(child);
  }
}
async function run(){
  const db=await createDatabase({removeQuestionMetadata:false});
  const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/revision/10-question-metadata.sql'),'utf8');
  const admin=async(action,payload)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');
    try{return (await db.query('select public.revision_admin_api($1,$2) data',[action,payload])).rows[0].data;}
    finally{await db.exec('reset role');}
  };
  const snapshot=async()=>{
    const tables=['revision_questions','revision_question_subtopics','revision_attempts','revision_progress','revision_sessions','revision_queue'];
    const data={};
    for(const table of tables)data[table]=(await db.query(`select coalesce(jsonb_agg(v order by v::text),'[]') data from (select to_jsonb(t)-'source' v from public.${table} t) rows`)).rows[0].data;
    data.solutions=(await db.query("select jsonb_agg(to_jsonb(s) order by question_id,question_version) data from revision_private.solutions s")).rows[0].data;
    return data;
  };
  try{
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    const legacySource={title:'Legacy source to remove',licence:'Legacy licence to remove',reviewed_by:'Legacy reviewer',url:'https://example.test/question'};
    const bank=fixtureBank();bank.questions=bank.questions.map(q=>({...q,source:legacySource}));
    await db.query('select revision_private.import_questions($1)',[bank]);
    const question=bank.questions[0],topic=question.subtopic_ids[0];
    const row={question_id:question.id,topic_codes:topic,question:'Updated $2x=6$.',answer:'$x=3$.',difficulty:'1',estimated_minutes:'2',marks:'2',
      source:legacySource.title,source_reference:'Legacy reference',licence:legacySource.licence,reviewed_by:legacySource.reviewed_by,status:'verified'};
    const plan=await admin('preview',{type:'questions',rows:[row]});assert.equal(plan.valid,true);
    const request={type:'questions',rows:[row],token:plan.token,request_id:randomUUID(),source:'Legacy top-level metadata'};
    const imported=await admin('import',request);assert.equal(imported.updated,1);
    const invalid={...row,question_id:'legacy-invalid-question',difficulty:'8'};
    const badPlan=await admin('preview',{type:'questions',rows:[invalid]});
    assert.equal((await admin('import',{type:'questions',rows:[invalid],token:badPlan.token,request_id:randomUUID()})).failed,1);
    // Retain real historical references and learned state across the schema change.
    const session=randomUUID(),completed=randomUUID(),active=randomUUID();
    await db.query('insert into public.revision_profiles(user_id) values($1)',[uid]);
    await db.query('insert into public.revision_progress(user_id,chapter_id,confidence,alpha,beta,attempts) select $1,chapter_id,3,7,4,1 from public.revision_subtopics where id=$2',[uid,topic]);
    await db.query('insert into public.revision_sessions(id,user_id,local_date,target_seconds) values($1,$2,current_date,600)',[session,uid]);
    await db.query("insert into public.revision_queue(id,session_id,position,question_id,question_version,estimated_seconds,reason,state) values($1,$2,1,$3,1,120,'test','completed'),($4,$2,2,$5,1,120,'test','active')",[completed,session,question.id,active,bank.questions[1].id]);
    await db.query('insert into public.revision_attempts(user_id,queue_id,session_id,question_id,question_version,ease,correctness,active_seconds,local_date,idempotency_key) values($1,$2,$3,$4,1,3,4,120,current_date,$5)',[uid,completed,session,question.id,randomUUID()]);
    const before=await snapshot();
    const auditBefore=(await db.query('select id,admin_id,created_at,result from revision_private.admin_imports order by id')).rows;
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual(await snapshot(),before,'Versions, solutions, topics, active work, attempts and learned state survive');
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='revision_questions' and column_name='source'")).rows[0].n,0,'The column is removed from storage');
    assert.deepEqual((await db.query('select id,admin_id,created_at,result from revision_private.admin_imports order by id')).rows,auditBefore,'Audit identities, timestamps and results survive');
    const audits=(await db.query("select payload,changes from revision_private.admin_imports where import_type='questions'")).rows;
    assertNoMetadata(audits);
    assert.deepEqual(await admin('import',request),imported,'An older lost-response request still replays safely');
    assertNoMetadata(await admin('record',{type:'questions',id:question.id}));
    assertNoMetadata(await admin('list',{type:'questions'}));
    const next={...row,question_id:'metadata-free-question',source:'Discard this',licence:'Discard this too'};
    const nextPlan=await admin('preview',{type:'questions',rows:[next]});assert.equal(nextPlan.valid,true);assertNoMetadata(nextPlan);
    const nextRequest={type:'questions',rows:[next],token:nextPlan.token,request_id:randomUUID(),licence:'Discard top-level too'};
    assert.equal((await admin('import',nextRequest)).inserted,1);
    assertNoMetadata((await db.query('select payload,changes from revision_private.admin_imports where id=$1',[nextRequest.request_id])).rows);
    const direct={...question,id:'direct-without-metadata'};delete direct.source;
    assert.equal((await db.query('select revision_private.import_questions($1) n',[{schema_version:1,questions:[direct]}])).rows[0].n,1,'Owner imports need no metadata');
    assert.equal((await db.query('select revision_private.import_questions($1) n',[{schema_version:1,questions:[{...direct,source:legacySource}]}])).rows[0].n,0,'Legacy metadata is ignored on reimport');
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select revision_private.strip_question_metadata('{}')"),/permission denied/);
    await db.exec('reset role');
    const {importTypes,readImport,toCSV}=await import('../admin-import.mjs');
    assert.ok(importTypes.questions.columns.every(key=>!removed.includes(key)));
    assertNoMetadata(readImport('questions',toCSV([Object.keys(row),Object.values(row)])));
    console.log('Question metadata removal: upgrade/rerun, physical column removal, successful/failed audit cleanup, legacy replay, metadata-free imports, permissions and preserved student history passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
