// Optional local SQL integration check; install @electric-sql/pglite separately.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.global_submissions (
        id bigint primary key, browser_id text, name text, task_name text,
        metrics jsonb, created_at timestamptz
      );
    `);
    await db.exec(readFileSync(join(__dirname, 'leaderboard.sql'), 'utf8'));
    const examples = [
      [1,'a','A score','rocket',{flight_set:'test-v1',score:90,accuracy:0.4,macro_f1:0.1,landing_success_pct:20},'2026-01-01'],
      [2,'a','A accuracy','rocket',{flight_set:'test-v1',score:70,accuracy:0.9,macro_f1:0.8,landing_success_pct:80},'2026-01-02'],
      [3,'b','B old','rocket',{flight_set:'test-v1',score:80,accuracy:0.8,macro_f1:0.4,landing_success_pct:30},'2026-01-01'],
      [4,'b','B recent','rocket',{flight_set:'test-v1',score:80,accuracy:0.8,macro_f1:0.3,landing_success_pct:30},'2026-01-02'],
      [5,'c','No score','rocket',{flight_set:'test-v1',score:null,accuracy:0.2},'2026-01-03'],
      [6,'d','String score','rocket',{flight_set:'test-v1',score:'999',accuracy:0.1},'2026-01-03'],
      [7,'e','Old validation','rocket',{score:999,accuracy:1},'2026-01-03'],
      [8,'f','Other task','classification',{flight_set:'test-v1',score:999,accuracy:1},'2026-01-03'],
    ];
    for (const [id, browser, name, task, metrics, time] of examples) {
      await db.query('insert into public.global_submissions values ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)',
        [id,browser,name,task,JSON.stringify(metrics),time]);
    }
    async function names(metric, offset=0, limit=500) {
      const result = await db.query('select * from public.rocket_best_submissions($1,$2,$3)', [metric,offset,limit]);
      return result.rows.map(row => row.name);
    }
    assert.deepEqual(await names('score'), ['A score','B recent']);
    assert.deepEqual(await names('accuracy'), ['A accuracy','B recent','No score','String score']);
    assert.deepEqual(await names('landing_success_pct'), ['A accuracy','B recent']);
    assert.deepEqual(await names('score',0,1), ['A score']);
    assert.deepEqual(await names('score',1,1), ['B recent']);
    assert.deepEqual(await names('not-a-metric'), []);
    const access = await db.query("select has_function_privilege('anon', 'public.rocket_best_submissions(text,integer,integer)', 'execute') as anon_access, has_function_privilege('authenticated', 'public.rocket_best_submissions(text,integer,integer)', 'execute') as auth_access, has_function_privilege('service_role', 'public.rocket_best_submissions(text,integer,integer)', 'execute') as service_access");
    assert.deepEqual(access.rows[0], {anon_access:false, auth_access:false, service_access:true});
    console.log('PostgreSQL best-per-browser, metric filtering, tie-breaking, paging and permissions passed');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
