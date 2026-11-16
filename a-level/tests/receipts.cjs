// 13-receipt-retention.sql: old receipts are pruned, recent ones still replay, and a retry
// whose receipt has been pruned is rejected without creating a second attempt.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createDatabase,fixtureBank,uid}=require('./database.cjs');
const other='00000000-0000-4000-8000-000000000002';

(async()=>{
  const db=await createDatabase();
  try {
    await db.query('select revision_private.import_questions($1)',[fixtureBank()]);
    const asUser=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
    const asOwner=()=>db.exec('reset role');
    const api=async(action,payload={})=>{await asUser();return (await db.query('select public.revision_api($1,$2) data',[action,payload])).rows[0].data;};
    const count=async(sql,params=[])=>{await asOwner();return (await db.query(sql,params)).rows[0].n;};

    // A stale receipt belonging to an inactive user is pruned by anyone's next request.
    await asOwner();
    await db.query('insert into public.revision_profiles(user_id) values($1)',[other]);
    await db.query("insert into revision_private.receipts(user_id,request_id,action,payload,result,created_at) values($1,$2,'settings','{}','{}',now()-interval '31 days')",[other,randomUUID()]);
    await db.query("insert into revision_private.receipts(user_id,request_id,action,payload,result,created_at) values($1,$2,'settings','{}','{}',now()-interval '29 days')",[other,randomUUID()]);

    await api('bootstrap',{timezone:'Europe/London'});
    await api('settings',{request_id:randomUUID(),books:['maths-pure-mathematics-year-1'],daily_minutes:30,timezone:'Europe/London'});
    assert.equal(await count('select count(*)::int n from revision_private.receipts where user_id=$1',[other]),1,'Only the 31-day-old receipt is pruned');

    let data=await api('bootstrap');
    await api('confidence',{request_id:randomUUID(),ratings:data.selected_chapter_ids.slice(0,2).map(c=>({chapter_id:c,confidence:3}))});
    data=await api('start',{request_id:randomUUID()});
    const sid=data.session.id,item=data.session.items[0];
    data=await api('activate',{request_id:randomUUID(),session_id:sid,expected_version:data.session.version,item_id:item.id});
    data=await api('reveal',{request_id:randomUUID(),session_id:sid,expected_version:data.session.version,item_id:item.id,active_seconds:30,ease:3});
    const complete={request_id:randomUUID(),session_id:sid,expected_version:data.session.version,item_id:item.id,active_seconds:40,correctness:4};
    const first=await api('complete',complete);
    assert.deepEqual(await api('complete',complete),first,'A recent receipt still replays');

    // Age the completion receipt past the window; the next request prunes it.
    await asOwner();
    await db.query("update revision_private.receipts set created_at=now()-interval '31 days' where request_id=$1",[complete.request_id]);
    await api('refresh',{request_id:randomUUID(),session_id:sid,expected_version:first.session.version});
    assert.equal(await count('select count(*)::int n from revision_private.receipts where request_id=$1',[complete.request_id]),0);
    await assert.rejects(api('complete',complete),/SESSION_CONFLICT/,'A late retry is rejected, not re-applied');
    assert.equal(await count('select count(*)::int n from public.revision_attempts where user_id=$1',[uid]),1,'No duplicate attempt');
    console.log('Receipt retention: pruning, recent replay and late-retry safety passed.');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exit(1);});
