const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createDatabase,fixtureBank,uid}=require('./database.cjs');
const other='00000000-0000-4000-8000-000000000002';

async function run(){
  const db=await createDatabase();
  const asUser=async(id,fn)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}};
  const api=(action,payload={})=>asUser(uid,async()=>(await db.query('select public.revision_api($1,$2) data',[action,payload])).rows[0].data);
  const mutate=(action,payload={})=>api(action,{...payload,request_id:randomUUID()});
  const admin=(action,payload={})=>asUser(uid,async()=>(await db.query('select public.revision_admin_api($1,$2) data',[action,payload])).rows[0].data);
  const preview=(type,rows)=>admin('preview',{type,rows});
  const commit=async(type,rows)=>{const p=await preview(type,rows);assert.equal(p.valid,true,JSON.stringify(p));const result=await admin('import',{type,rows,token:p.token,request_id:randomUUID()});assert.equal(result.failed,0,JSON.stringify(result));return result;};
  try{
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    const bank=fixtureBank();await db.query('select revision_private.import_questions($1)',[bank]);
    const cat=await admin('catalogue'),book='maths-pure-mathematics-year-1',chapters=cat.chapters.filter(c=>c.book_id===book);
    const topicA=cat.topics.find(t=>t.chapter_id===chapters[0].id),topicB=cat.topics.filter(t=>t.chapter_id===chapters[0].id)[1];
    const group={id:'test-chapter-options',specification_id:'edexcel-9ma0',title:'Optional chapters',min_choices:1,max_choices:1,archived:false};
    const before=(await db.query('select count(*)::int n from public.revision_option_groups')).rows[0].n;
    await preview('option_groups',[group]);assert.equal((await db.query('select count(*)::int n from public.revision_option_groups')).rows[0].n,before);
    await commit('option_groups',[group]);assert.equal((await commit('option_groups',[group])).skipped,1);
    const choiceA={id:'test-choice-a',group_id:group.id,title:'Quadratics',chapter_ids:chapters[1].id};
    const choiceB={id:'test-choice-b',group_id:group.id,title:'Other chapter',chapter_ids:chapters[2].id};
    await commit('options',[choiceA,choiceB]);assert.equal((await commit('options',[choiceA,choiceB])).skipped,2);
    const topicGroup={...group,id:'test-subtopic-options',title:'Extra subtopic',min_choices:0,max_choices:1};
    await commit('option_groups',[topicGroup]);
    const topicChoices=[{id:'test-topic-a',group_id:topicGroup.id,title:'First subtopic',topic_codes:topicA.id},{id:'test-topic-b',group_id:topicGroup.id,title:'Second subtopic',topic_codes:topicB.id}];
    await commit('options',topicChoices);
    for(const row of [{...group,min_choices:2,max_choices:1},{...group,min_choices:-1},{...group,max_choices:101}])assert.equal((await preview('option_groups',[row])).valid,false);
    for(const row of [{...choiceA,chapter_ids:'missing'},{...choiceA,chapter_ids:'',topic_codes:''},{...choiceA,requires_option_id:choiceA.id},{...choiceA,requires_option_id:'missing'}])assert.equal((await preview('options',[row])).valid,false);
    const cycle=await preview('options',[{...choiceA,requires_option_id:choiceB.id},{...choiceB,requires_option_id:choiceA.id}]);assert.equal(cycle.valid,false);
    await api('bootstrap');
    const settings=ids=>mutate('settings',{specifications:['edexcel-9ma0'],option_ids:ids,daily_minutes:20});
    await assert.rejects(settings([]),/INVALID_OPTION_COUNT/);
    await assert.rejects(settings([choiceA.id,choiceB.id]),/INVALID_OPTION_COUNT/);
    await assert.rejects(settings([choiceA.id,'missing']),/UNKNOWN_OPTION/);
    await assert.rejects(settings([choiceA.id,choiceA.id]),/DUPLICATE_OPTION/);
    await assert.rejects(settings([choiceA.id,topicChoices[0].id,topicChoices[1].id]),/INVALID_OPTION_COUNT/);
    let data=await settings([choiceA.id,topicChoices[0].id]);
    assert.deepEqual(data.selected_specifications,['edexcel-9ma0']);assert.ok(data.selected_chapter_ids.includes(chapters[1].id));
    assert.ok(!data.selected_chapter_ids.includes(chapters[2].id));assert.ok(data.selected_subtopic_ids.includes(topicA.id));assert.ok(!data.selected_subtopic_ids.includes(topicB.id));
    await assert.rejects(mutate('confidence',{ratings:[{chapter_id:chapters[2].id,confidence:3}]}),/CHAPTER_NOT_SELECTED/);
    await mutate('confidence',{ratings:chapters.slice(0,2).map(c=>({chapter_id:c.id,confidence:3}))});
    data=await mutate('start');assert.ok(data.session.items.length);
    assert.ok(!data.session.items.some(q=>q.question_id==='fixture-uncovered'),'Unselected chapter is never scheduled');
    const wrongQuestions=(await db.query('select distinct question_id from public.revision_question_subtopics where subtopic_id=$1',[topicB.id])).rows.map(r=>r.question_id);
    assert.ok(data.session.items.every(q=>!wrongQuestions.includes(q.question_id)),'Unchosen subtopics, including mixed questions, are excluded');
    let item=data.session.items.find(q=>q.chapter_ids.includes(chapters[1].id));assert.ok(item);
    const session=data.session.id;
    const action=async(name,payload={})=>{const result=await mutate(name,{session_id:session,expected_version:data.session.version,...payload});data={...data,...result};return result;};
    await action('activate',{item_id:item.id});await action('reveal',{item_id:item.id,ease:3,active_seconds:10});
    await action('complete',{item_id:item.id,correctness:4,active_seconds:90});
    const progress=(await db.query('select to_jsonb(p) p from public.revision_progress p where user_id=$1 and chapter_id=$2',[uid,chapters[1].id])).rows[0].p;
    const attempts=(await db.query('select to_jsonb(a) a from public.revision_attempts a')).rows;
    data=await settings([choiceB.id]);
    assert.ok(!data.selected_chapter_ids.includes(chapters[1].id));assert.ok(!data.selected_subtopic_ids.includes(topicA.id));
    assert.deepEqual((await db.query('select to_jsonb(p) p from public.revision_progress p where user_id=$1 and chapter_id=$2',[uid,chapters[1].id])).rows[0].p,progress);
    assert.deepEqual((await db.query('select to_jsonb(a) a from public.revision_attempts a')).rows,attempts);
    await commit('option_groups',[{...group,min_choices:0,max_choices:2}]);data=await settings([]);assert.ok(!data.selected_chapter_ids.includes(chapters[2].id));
    data=await settings([choiceA.id,choiceB.id]);assert.ok(data.selected_chapter_ids.includes(chapters[1].id)&&data.selected_chapter_ids.includes(chapters[2].id));
    await commit('option_groups',[group]);await assert.rejects(mutate('start'),/INVALID_OPTION_COUNT/);data=await settings([choiceA.id]);

    // Dependencies reproduce the legacy Further Maths selection rules.
    const further=ids=>mutate('settings',{specifications:['edexcel-9fm0'],option_ids:ids});
    const first='further-maths-further-statistics-1',second='further-maths-further-statistics-2',unrelated='further-maths-decision-mathematics-1';
    await assert.rejects(further([second,unrelated]),/OPTION_PREREQUISITE_REQUIRED/);
    data=await further([first,second]);assert.equal(data.enrolments.length,4);
    data=await further([first,unrelated]);assert.equal(data.enrolments.length,4);
    await assert.rejects(further([first]),/INVALID_OPTION_COUNT/);
    await assert.rejects(settings([first]),/INVALID_OPTIONS/);
    // Simulate an existing installation's book enrolments, then run the upgrade again.
    await db.query('delete from public.revision_specification_enrolments where user_id=$1',[uid]);
    await db.query('delete from public.revision_option_selections where user_id=$1',[uid]);
    const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/revision/08-options.sql'),'utf8');await db.exec(migration);
    data=await api('bootstrap');assert.deepEqual(new Set(data.selected_options),new Set([first,unrelated]));
    await db.exec(migration);assert.deepEqual((await db.query('select to_jsonb(a) a from public.revision_attempts a')).rows,attempts);
    // Archive does not turn an optional topic into core material.
    data=await settings([choiceA.id]);await commit('options',[{...choiceA,archived:true}]);
    data=await api('bootstrap');assert.ok(!data.selected_chapter_ids.includes(chapters[1].id));await assert.rejects(mutate('start'),/INVALID_OPTIONS/);
    await asUser(other,async()=>{
      assert.equal((await db.query('select count(*)::int n from public.revision_option_selections')).rows[0].n,0);
      await assert.rejects(db.query('insert into public.revision_option_selections values($1,$2)',[other,choiceB.id]),/permission denied/);
      await assert.rejects(db.query('select revision_private.save_options($1,$2,$3)',[uid,['edexcel-9ma0'],[choiceB.id]]),/permission denied/);
      await assert.rejects(db.query("select public.revision_admin_api('preview',$1)",[{type:'option_groups',rows:[group]}]),/ADMIN_REQUIRED/);
    });
    const {validateOptionSelection}=await import('../options.mjs');
    assert.match(validateOptionSelection({option_groups:[group],options:[choiceA,choiceB]},['edexcel-9ma0'],[]),/exactly 1/);
    console.log('Options: group counts, chapter/subtopic gates, prerequisites, legacy migration, immutable history, admin CSVs, archive and student isolation passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
