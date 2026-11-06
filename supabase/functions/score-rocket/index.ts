import { score } from './score.mjs';

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'};
const reply = (body: object, status = 200) => Response.json(body, {status, headers: cors});

type Submission = {base: string; key: string; browser_id: string; name: string;
  task_name: string; dataset_id: string; predictions: number[];
  metrics: {accuracy: number; macro_f1: number; sample_count: number};
  landing: {flight_set: string; successful_runs: number; total_runs: number; score: number | null; scored_contacts: number}};

async function saveSubmission(data: Submission): Promise<Response> {
  const {base, key, browser_id, name, task_name, dataset_id, predictions, metrics, landing} = data;
  const target = new URL('/rest/v1/global_submissions', base);
  const response = await fetch(target, {method:'POST', headers:{apikey:key, Authorization:`Bearer ${key}`,
    'Content-Type':'application/json', Prefer:'return=minimal'},
    body:JSON.stringify({browser_id, task_name, name, predictions, metrics:{...metrics, dataset_id, flight_set:landing.flight_set, score:landing.score,
      landing_success_pct:100 * landing.successful_runs / landing.total_runs,
      successful_landings:landing.successful_runs, total_landings:landing.total_runs,
      scored_contacts:landing.scored_contacts}})});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (error.code === '23505') return reply({error:'The database currently permits only one submission per browser and task.'}, 409);
    throw new Error('Could not save submission');
  }
  return reply({...metrics, saved:true, flight_set:'test-v1', message:'Submission saved.'});
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (request.method === 'GET') {
    try {
      const base = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!base || !key) throw new Error('Server credentials not configured');
      const params = new URL(request.url).searchParams;
      const offsetValue = params.get('offset') ?? '0';
      const metric = params.get('metric') ?? 'score';
      if (!/^\d+$/.test(offsetValue) || Number(offsetValue) > 1000000) return reply({error:'Invalid offset'}, 400);
      if (!['score', 'landing_success_pct', 'macro_f1', 'accuracy'].includes(metric)) return reply({error:'Invalid metric'}, 400);
      const query = new URL('/rest/v1/rpc/rocket_best_submissions', base);
      const result = await fetch(query, {method:'POST', headers:{apikey:key, Authorization:`Bearer ${key}`,
        'Content-Type':'application/json'}, body:JSON.stringify({p_metric:metric, p_offset:Number(offsetValue), p_limit:500})});
      if (!result.ok) throw new Error('Could not load leaderboard');
      const leaderboard = await result.json();
      if (!Array.isArray(leaderboard)) throw new Error('Invalid leaderboard data');
      return reply({leaderboard, metric, grouping:'best-per-browser-v1'});
    } catch (error) {
      console.error('Rocket leaderboard error:', error);
      return reply({error:'Could not load leaderboard'}, 500);
    }
  }
  if (request.method !== 'POST') return reply({error: 'Method not allowed'}, 405);
  try {
    const {dataset_id, predictions, browser_id, name, task_name, landing} = await request.json();
    if (typeof dataset_id !== 'string' || !/^[a-f0-9]{64}$/.test(dataset_id) ||
        !Array.isArray(predictions) || predictions.length === 0 || predictions.length > 100000 ||
        predictions.some((x: unknown) => !Number.isInteger(x) || (x as number) < 0 || (x as number) > 9)) {
      return reply({error: 'Invalid dataset or predictions'}, 400);
    }
    const submission = browser_id !== undefined || name !== undefined || task_name !== undefined;
    if (submission && (typeof browser_id !== 'string' || !browser_id.trim() || browser_id.length > 100 ||
        typeof name !== 'string' || !name.trim() || name.length > 50 || task_name !== 'rocket')) {
      return reply({error: 'Invalid leaderboard submission'}, 400);
    }
    if (submission && (!landing || typeof landing !== 'object' || landing.flight_set !== 'test-v1' ||
        !Number.isInteger(landing.total_runs) || landing.total_runs !== 10 ||
        !Number.isInteger(landing.successful_runs) || landing.successful_runs < 0 || landing.successful_runs > landing.total_runs ||
        !Number.isInteger(landing.scored_contacts) || landing.scored_contacts < 0 || landing.scored_contacts > landing.total_runs ||
        (landing.scored_contacts === 0 ? landing.score !== null :
          typeof landing.score !== 'number' || !Number.isFinite(landing.score) || landing.score < 0 || landing.score > 100))) {
      return reply({error: 'Invalid landing results'}, 400);
    }
    const base = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) throw new Error('Server credentials not configured');
    const rows = [];
    // PostgREST often caps responses at 1,000 rows: fetch every page in order.
    for (let offset = 0; offset <= predictions.length; offset += 1000) {
      const query = new URL('/rest/v1/rocket_test_labels', base);
      query.search = new URLSearchParams({select: 'row_index,action', dataset_id: `eq.${dataset_id}`,
        order: 'row_index.asc', offset: String(offset), limit: '1000'}).toString();
      const response = await fetch(query, {headers: {apikey: key, Authorization: `Bearer ${key}`}});
      if (!response.ok) throw new Error('Could not read test labels');
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('Invalid label data');
      rows.push(...page);
      if (page.length < 1000 || rows.length > predictions.length) break;
    }
    if (rows.length !== predictions.length) return reply({error: 'Test dataset not configured or prediction count does not match'}, 400);
    const metrics = score(predictions, rows);
    if (!submission) return reply(metrics);
    return await saveSubmission({base, key, browser_id, name: name.trim(), task_name, dataset_id, predictions, metrics, landing});
  } catch (error) {
    console.error('Rocket score error:', error);
    return reply({error: 'Could not score or save this submission'}, 500);
  }
});
