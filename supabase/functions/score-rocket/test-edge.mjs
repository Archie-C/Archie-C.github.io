import assert from 'node:assert/strict';
let handler;
globalThis.Deno = {serve: fn => { handler = fn; }, env: {get: key => ({
  SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-secret'
})[key]}};
const rows = Array.from({length: 1342}, (_, row_index) => ({row_index, action: row_index % 10}));
const offsets = [], saved = [], leaderboardQueries = [];
let uniqueConstraint = false;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  assert.equal(options.headers.apikey, 'test-secret');
  if (parsed.pathname.endsWith('/rpc/rocket_best_submissions')) {
    assert.equal(options.method, 'POST');
    const query = JSON.parse(options.body);
    leaderboardQueries.push(query);
    const byBrowser = new Map();
    for (const row of saved) {
      const old = byBrowser.get(row.browser_id);
      if (!old || row.metrics[query.p_metric] > old.metrics[query.p_metric]) byBrowser.set(row.browser_id, row);
    }
    const result = [...byBrowser.values()].sort((a,b) => b.metrics[query.p_metric] - a.metrics[query.p_metric]);
    return Response.json(result.slice(query.p_offset, query.p_offset + query.p_limit)
      .map(row => ({name:row.name, metrics:row.metrics, created_at:'2026-11-06T00:00:00Z'})));
  }
  if (parsed.pathname.endsWith('/global_submissions')) {
    if (options.method === 'POST') {
      if (uniqueConstraint) return Response.json({code:'23505'}, {status:409});
      saved.push(JSON.parse(options.body));
      return new Response(null, {status: 201});
    }
    throw new Error('Leaderboard must use the grouping RPC');
  }
  assert.equal(parsed.searchParams.get('dataset_id'), `eq.${'a'.repeat(64)}`);
  const offset = Number(parsed.searchParams.get('offset'));
  offsets.push(offset);
  return Response.json(rows.slice(offset, offset + 1000));
};
await import('./index.ts');
const invoke = body => handler(new Request('https://example.invalid', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
}));
const data = {dataset_id:'a'.repeat(64), predictions:rows.map(r => r.action)};
let response = await invoke(data);
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {accuracy: 1, macro_f1: 1, sample_count: 1342});
assert.equal(saved.length, 0); // Scoring alone does not post to the leaderboard.
assert.deepEqual(offsets, [0, 1000]);
const submission = {...data, browser_id:'browser-1', name:' Test handle ', task_name:'rocket',
  landing:{flight_set:'test-v1', successful_runs:7, total_runs:10, score:74.5, scored_contacts:9},
  metrics:{accuracy:0}}; // Client-supplied action metrics are ignored.
response = await invoke(submission);
assert.equal(response.status, 200);
const receipt = await response.json();
assert.equal(receipt.saved, true);
assert.equal(receipt.flight_set, 'test-v1');
assert.equal(saved[0].name, 'Test handle');
assert.equal(saved[0].task_name, 'rocket');
assert.deepEqual(saved[0].predictions, data.predictions);
assert.deepEqual(saved[0].metrics, {accuracy:1, macro_f1:1, sample_count:1342,
  dataset_id:data.dataset_id, flight_set:'test-v1', score:74.5, landing_success_pct:70,
  successful_landings:7, total_landings:10, scored_contacts:9});
assert.deepEqual(Object.keys(saved[0]).sort(), ['browser_id','metrics','name','predictions','task_name']);
response = await invoke(submission);
assert.equal(response.status, 200);
assert.equal(saved.length, 2); // Repeated attempts are inserted separately.
uniqueConstraint = true;
response = await invoke(submission);
assert.equal(response.status, 409);
assert.match((await response.json()).error, /only one submission/);
assert.equal(saved.length, 2);
uniqueConstraint = false;
response = await handler(new Request('https://example.invalid?offset=0'));
assert.equal(response.status, 200);
const publicBoard = await response.json();
assert.equal(publicBoard.leaderboard.length, 1);
assert.equal(publicBoard.metric, 'score');
assert.equal(publicBoard.grouping, 'best-per-browser-v1');
assert.deepEqual(leaderboardQueries[0], {p_metric:'score', p_offset:0, p_limit:500});
assert.equal('predictions' in publicBoard.leaderboard[0], false);
assert.equal('browser_id' in publicBoard.leaderboard[0], false);
response = await handler(new Request('https://example.invalid?metric=accuracy&offset=500'));
assert.equal(response.status, 200);
assert.deepEqual(leaderboardQueries[1], {p_metric:'accuracy', p_offset:500, p_limit:500});
response = await handler(new Request('https://example.invalid?metric=unknown'));
assert.equal(response.status, 400);
response = await handler(new Request('https://example.invalid?offset=-1'));
assert.equal(response.status, 400);
response = await invoke({...submission, landing:{...submission.landing, flight_set:'validation'}});
assert.equal(response.status, 400);
response = await invoke({...submission, landing:{flight_set:'test-v1', successful_runs:11, total_runs:10, score:80, scored_contacts:10}});
assert.equal(response.status, 400);
response = await invoke({...submission, task_name:'classification'});
assert.equal(response.status, 400);
response = await invoke({dataset_id:data.dataset_id, predictions:data.predictions.slice(0, 1000)});
assert.equal(response.status, 400); // A truncated prediction list must not score a prefix.
assert.equal(saved.length, 2);
response = await invoke({dataset_id:'invalid', predictions:[1]});
assert.equal(response.status, 400);
response = await handler(new Request('https://example.invalid', {method:'OPTIONS'}));
assert.equal(response.status, 204);
assert.equal(response.headers.get('access-control-allow-origin'), '*');
console.log('Scoring, submissions, metrics, pagination and validation checks passed');
