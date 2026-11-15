const assert=require('node:assert/strict');
const {createDatabase,uid}=require('./database.cjs');

async function run(){
  const {subtopicCoverage,coverageTarget,coverageView}=await import('../admin-coverage.mjs');
  const db=await createDatabase();
  const rpc=async(role='authenticated',id=uid)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
    await db.exec(`set role ${role}`);
    try{return (await db.query('select public.revision_admin_coverage() data')).rows[0].data;}
    finally{await db.exec('reset role');}
  };
  try{
    await assert.rejects(rpc('anon',''),/permission denied/);
    await assert.rejects(rpc(),/ADMIN_REQUIRED/);
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    const empty=await rpc();assert.equal(empty.length,558);
    assert.ok(empty.every(t=>t.verified===0&&t.drafts===0),'Zero-question subtopics are included');
    const catalogue=(await db.query("select public.revision_admin_api('catalogue') data")).rows[0].data;
    const [a,b]=catalogue.topics,other=catalogue.topics.find(t=>t.chapter_id!==a.chapter_id);
    const base={prompt_md:'A question',solution_md:'An answer',difficulty:2,estimated_seconds:120,total_marks:2};
    const question=(id,version,status,tags=[a.id])=>({...base,id,version,review_status:status,subtopic_ids:tags});
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[
      question('coverage-live',1,'verified'),question('coverage-live',2,'verified'),
      question('coverage-replacement',1,'verified'),question('coverage-replacement',2,'draft',[b.id]),question('coverage-replacement',3,'draft'),
      question('coverage-draft',1,'draft'),question('coverage-draft',2,'draft'),
      question('coverage-withdrawn',1,'verified'),question('coverage-archived',1,'verified'),
      question('coverage-cross',1,'verified',[a.id,other.id])
    ]}]);
    await db.exec("update public.revision_questions set status='withdrawn' where id='coverage-withdrawn'; update public.revision_questions set status='archived' where id='coverage-archived';");
    let counts=await rpc();assert.equal(counts.find(t=>t.id===a.id).verified,3,'Versions do not multiply published questions');
    await db.query('update public.revision_subtopics set archived=true where id=$1',[other.id]);
    counts=await rpc();assert.deepEqual(counts.find(t=>t.id===a.id),{id:a.id,verified:2,drafts:2},'Latest drafts and still-published versions counted independently; inactive cross-tags excluded');
    assert.equal(counts.find(t=>t.id===b.id).drafts,0,'Superseded draft tags do not count');
    assert.ok(!counts.some(t=>t.id===other.id),'Archived subtopics excluded');
    catalogue.topics.find(t=>t.id===other.id).archived=true;
    const selection={chapter:a.chapter_id};
    let data=subtopicCoverage(catalogue,counts,selection,2);
    assert.equal(data.ready,1);assert.equal(data.total,catalogue.topics.filter(t=>t.chapter_id===a.chapter_id).length);
    assert.equal(data.needsMore,data.total-1);assert.equal(data.rows.at(-1).id,a.id,'Largest gaps come first');
    assert.ok(subtopicCoverage(catalogue,counts,{...selection,coverage:'needs-more'},2).visible.every(t=>t.gap>0));
    assert.ok(subtopicCoverage(catalogue,counts,{...selection,coverage:'empty'},2).visible.every(t=>t.verified===0));
    assert.equal(subtopicCoverage(catalogue,counts,{...selection,coverage:'ready'},3).visible.length,0,'Target changes recompute coverage');
    assert.equal(subtopicCoverage(catalogue,counts,{search:a.id},2).total,1);
    assert.equal(subtopicCoverage(catalogue,counts,{subject:'missing'},2).total,0);
    assert.equal(subtopicCoverage(catalogue,counts,{search:'no-match'},2).total,0);
    for(const value of [0,-1,101,'bad',2.5])assert.equal(coverageTarget(value),5);
    assert.equal(coverageTarget('12'),12);
    catalogue.topics.find(t=>t.id===a.id).title='<script>alert(1)</script>';
    const html=coverageView(catalogue,counts,{search:a.id},2);
    assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
    await db.query('update public.revision_chapters set archived=true where id=$1',[a.chapter_id]);
    assert.ok(!(await rpc()).some(t=>t.id===a.id),'Archived chapters excluded');
    await db.query('select revision_private.set_admin($1,false)',[uid]);
    await assert.rejects(rpc(),/ADMIN_REQUIRED/);
    console.log('Coverage checks: authorization, zero counts, unique questions, version history, latest drafts, archived links, target/gap filters, search and escaping passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
