const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createDatabase,uid}=require('./database.cjs');

async function run(){
  const db=await createDatabase();
  const call=async(action,payload={})=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');
    try{return (await db.query('select public.revision_admin_api($1,$2) data',[action,payload])).rows[0].data;}
    finally{await db.exec('reset role');}
  };
  const preview=rows=>call('preview',{type:'exams',rows});
  const confirm=(rows,plan)=>call('import',{type:'exams',rows,token:plan.token,request_id:randomUUID()});
  const commit=async rows=>{const plan=await preview(rows);assert.equal(plan.valid,true,JSON.stringify(plan));const result=await confirm(rows,plan);assert.equal(result.failed,0,JSON.stringify(result));return result;};
  const counts=async()=>(await db.query(`select
    (select count(*)::int from public.revision_subjects) subjects,
    (select count(*)::int from public.revision_specifications) specifications,
    (select count(*)::int from public.revision_papers) papers,
    (select count(*)::int from public.revision_exams) exams,
    (select count(*)::int from public.revision_paper_chapters) mappings,
    (select count(*)::int from public.revision_chapters) chapters,
    (select count(*)::int from public.revision_subtopics) topics,
    (select count(*)::int from revision_private.exam_paper_codes) aliases`)).rows[0];
  try{
    await db.query('select revision_private.set_admin($1,true)',[uid]);
    const base=await counts();
    const first={exam_id:'physics-2027-1',exam_board:'Edexcel',specification:'9PH0',paper_code:'9PH0-01',paper_name:'Advanced Physics I',exam_date:'2027-06-01',start_time:'09:00',duration_minutes:'105',status:'confirmed',subject_id:'edexcel-physics',subject_name:'Physics',specification_title:'A-level Physics'};
    const second={...first,exam_id:'physics-2027-2',paper_code:'9PH0-02',paper_name:'Advanced Physics II',exam_date:'2027-06-02'};
    const rows=[first,second],plan=await preview(rows);
    assert.equal(plan.valid,true,JSON.stringify(plan));
    assert.deepEqual(plan.rows.map(r=>r.catalogue_changes.length),[3,1],'Only first row creates shared parents');
    assert.deepEqual(await counts(),base,'Preview never writes parents or exams');
    const payload={type:'exams',rows,token:plan.token,request_id:randomUUID()};
    const imported=await call('import',payload);assert.equal(imported.inserted,2);assert.equal(imported.failed,0,JSON.stringify(imported));
    assert.deepEqual(await call('import',payload),imported,'Lost response replay also preserves parent identities');
    let state=await counts();assert.equal(state.subjects,base.subjects+1);assert.equal(state.specifications,base.specifications+1);assert.equal(state.papers,base.papers+2);
    assert.equal(state.mappings,base.mappings);assert.equal(state.chapters,base.chapters);assert.equal(state.topics,base.topics);
    assert.equal((await commit(rows)).skipped,2,'Uppercase official codes are idempotent');
    assert.deepEqual(await counts(),state);
    const spec=(await db.query("select * from public.revision_specifications where id='edexcel-9ph0'")).rows[0];
    assert.equal(spec.subject_id,'edexcel-physics');assert.equal(spec.title,'A-level Physics');assert.equal(spec.code,'9PH0');
    assert.equal((await commit([{...first,specification:'edexcel-9ph0',paper_name:'ADVANCED PHYSICS I'}])).skipped,1,'Existing names are retained');
    const history=await call('history_detail',{id:imported.id});assert.equal(history.changes[0].catalogue_changes.length,3);
    assert.equal(history.changes[0].catalogue_changes[0].after.name,'Physics');

    // A code-only CSV needs no subject/topic metadata and can share a subject explicitly.
    await commit([{...first,exam_id:'physics-as-2027',specification:'8PH0',paper_code:'8ph0-01',specification_title:'AS Physics'}]);
    assert.equal((await db.query("select subject_id from public.revision_specifications where id='edexcel-8ph0'")).rows[0].subject_id,'edexcel-physics');
    const simple={exam_id:'unknown-2027',exam_board:'OCR',specification:'H999',paper_code:'01',paper_name:'New paper',exam_date:'2027-06-03',start_time:'13:30',duration_minutes:'90',status:'estimated'};
    await commit([simple]);
    assert.equal((await db.query("select name from public.revision_subjects where id='ocr-h999'")).rows[0].name,'H999','No subject name is guessed');
    assert.equal((await commit([simple])).skipped,1);
    const collision={...simple,exam_id:'other-2027',specification:'H998'};await commit([collision]);
    assert.equal((await db.query("select paper_id from public.revision_exams where external_id='other-2027'")).rows[0].paper_id,'ocr-h998-01');
    assert.equal((await commit([collision])).skipped,1,'Scoped-code aliases do not duplicate papers');

    // Existing Further Maths option mappings stay connected to the same book/chapters.
    const option={...simple,exam_id:'further-option-2027',exam_board:'Edexcel',specification:'edexcel-9fm0',paper_code:'9fm0-3b',paper_name:'Further Statistics 1'};
    const mappings=(await db.query('select * from public.revision_paper_chapters order by paper_id,chapter_id')).rows;
    const optionPlan=await preview([option]);assert.equal(optionPlan.valid,true);
    assert.equal(optionPlan.rows[0].after.paper_code,'9fm0-option-further-statistics-1');
    assert.deepEqual(optionPlan.rows[0].catalogue_changes.map(c=>c.entity),['paper_codes']);
    await commit([option]);assert.equal((await commit([option])).skipped,1);
    assert.deepEqual((await db.query('select * from public.revision_paper_chapters order by paper_id,chapter_id')).rows,mappings);
    assert.equal((await preview([option,{...option,exam_id:'duplicate-option-2027',paper_code:'9fm0-option-further-statistics-1'}])).valid,false);
    const variants=[{...simple,exam_id:'history-a-2027',specification:'H123',paper_code:'h123-1a',paper_name:'Depth Study'},
      {...simple,exam_id:'history-b-2027',specification:'H123',paper_code:'h123-1b',paper_name:'Depth Study'}];
    await commit(variants);assert.equal((await commit(variants)).skipped,2,'Identical titles never merge distinct variants');

    // Validation and unexpected execution failures must leave no new parent records.
    const unknown={...simple,exam_id:'rollback-2027',specification:'H997',paper_code:'h997-01'};
    const before=await counts(),invalid=[unknown,{...unknown,exam_id:'bad-date-2027',paper_code:'h997-02',exam_date:'2027-02-30'}];
    const invalidPlan=await preview(invalid);assert.equal(invalidPlan.valid,false);
    assert.equal((await confirm(invalid,invalidPlan)).failed,2);assert.deepEqual(await counts(),before);
    const conflict=[{...unknown,subject_name:'First name'},{...unknown,exam_id:'conflict-2028',exam_date:'2028-06-03',subject_name:'Different name'}];
    assert.match((await preview(conflict)).rows[1].error,/Conflicting subject_name/);
    await db.exec("create function revision_private.fail_exam_test() returns trigger language plpgsql as $$ begin if new.external_id='execution-failure-2027' then raise exception 'Simulated exam storage failure'; end if; return new; end $$; create trigger exam_test_failure before insert on public.revision_exams for each row execute function revision_private.fail_exam_test();");
    const fail=[unknown,{...unknown,exam_id:'execution-failure-2027',paper_code:'h997-02'}],failPlan=await preview(fail);
    assert.equal(failPlan.valid,true);const failed=await confirm(fail,failPlan);assert.equal(failed.failed,2);assert.match(failed.error,/Simulated/);
    assert.deepEqual(await counts(),before,'All subjects, specs, papers and exams roll back');
    assert.equal((await call('history_detail',{id:failed.id})).changes[0].catalogue_changes.length,3);
    await db.exec('drop trigger exam_test_failure on public.revision_exams; drop function revision_private.fail_exam_test();');

    const changed={...first,exam_date:'2027-06-04'},stale=await preview([changed]);
    await db.exec("update public.revision_papers set title='Reviewed physics title' where id='9ph0-01'");
    assert.match((await confirm([changed],stale)).error,/PREVIEW_STALE/,'Reference metadata is part of the preview token');
    assert.equal((await preview([{...first,exam_board:'OCR'}])).valid,false);
    assert.equal((await preview([{...first,subject_id:'some-other-subject'}])).valid,false);
    const long={...simple,exam_id:'long-2027',specification:'X'.repeat(120),paper_code:'x-long-01'};await commit([long]);assert.equal((await commit([long])).skipped,1);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from revision_private.exam_paper_codes'),/permission denied/);await db.exec('reset role');
    await db.query('select revision_private.set_admin($1,false)',[uid]);
    await assert.rejects(preview([unknown]),/ADMIN_REQUIRED/);
    console.log('Timetable-first imports: missing parents, preview/audit, optional metadata, repeats, official aliases, variants, permissions, stale previews and complete rollback passed.');
  }finally{await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
