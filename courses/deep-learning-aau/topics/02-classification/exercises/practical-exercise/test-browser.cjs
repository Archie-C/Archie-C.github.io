// Browser smoke test: serve the repository root, install Playwright separately,
// then run `node test-browser.cjs` from this directory. ROOT_URL can override
// the default URL. This test executes a tiny controller with the real dataset,
// simulator, worker, and Pyodide; it does not write leaderboard submissions.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');

const url = process.env.ROOT_URL || 'http://127.0.0.1:8000/courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise/';
const source = `class Controller:\n    def fit(self, X, y):\n        self.action = int(y[0])\n    def load(self, path):\n        with open(path, 'rb') as file:\n            if file.read() != b'rocket-weights':\n                raise ValueError('bad weights')\n        self.action = 1\n    def predict_action(self, observation):\n        return self.action\n`;

(async () => {
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const submissions = [], leaderboardMetrics = [];
    await page.route('**/functions/v1/score-rocket**', async route => {
      if (route.request().method() === 'GET') {
        const metric = new URL(route.request().url()).searchParams.get('metric');
        leaderboardMetrics.push(metric);
        const scoreBest = {name:'Pilot A score', created_at:'2026-11-06T10:00:00Z', metrics:{flight_set:'test-v1', score:80, landing_success_pct:50, macro_f1:0.5, accuracy:0.7}};
        const successBest = {name:'Pilot A success', created_at:'2026-11-06T11:00:00Z', metrics:{flight_set:'test-v1', score:70, landing_success_pct:90, macro_f1:0.6, accuracy:0.8}};
        const other = {name:'Pilot B', created_at:'2026-11-06T10:30:00Z', metrics:{flight_set:'test-v1', score:75, landing_success_pct:70, macro_f1:0.4, accuracy:0.6}};
        const leaderboard = metric === 'landing_success_pct' ? [successBest, other] : [scoreBest, other];
        await route.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'},
          body: JSON.stringify({leaderboard, metric, grouping:'best-per-browser-v1'})});
        return;
      }
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({status: 204, headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type'}});
        return;
      }
      const payload = route.request().postDataJSON();
      submissions.push(payload);
      if (submissions.length === 2) {
        await route.fulfill({status: 503, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Unavailable'});
        return;
      }
      await route.fulfill({status: 200, contentType: 'application/json',
        headers: {'Access-Control-Allow-Origin': '*'},
        body: JSON.stringify({accuracy: 0.5, macro_f1: 0.25, sample_count: payload.predictions.length, ...(payload.browser_id ? {saved:true, flight_set:'test-v1', message:'Submission saved.'} : {})})});
    });
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.waitForFunction(() => document.querySelector('#leaderboard-body').textContent.includes('Pilot A score'));
    assert.match(await page.locator('#leaderboard-body tr').first().innerText(), /Pilot A score/);
    assert.equal(await page.locator('#leaderboard-body tr').count(), 2);
    await page.locator('#leaderboard-order').selectOption('landing_success_pct');
    await page.waitForFunction(() => document.querySelector('#leaderboard-body').textContent.includes('Pilot A success'));
    assert.match(await page.locator('#leaderboard-body tr').first().innerText(), /Pilot A success/);
    assert.equal(await page.locator('#leaderboard-body tr').count(), 2);
    assert.deepEqual(leaderboardMetrics.slice(0,2), ['score','landing_success_pct']);
    // A dropped file must be used even though it was not selected in the input.
    await page.evaluate(source => {
      const data = new DataTransfer();
      data.items.add(new File([source], 'controller.py', {type: 'text/x-python'}));
      document.querySelector('#upload-zone').dispatchEvent(new DragEvent('drop', {dataTransfer:data, bubbles:true}));
    }, source);
    assert.equal(await page.locator('#upload-filename').innerText(), 'controller.py');
    await page.locator('#controller-run').click();
    await page.waitForFunction(() => /Evaluation complete|Controller error/.test(document.querySelector('#controller-status').textContent), null, {timeout: 180000});
    assert.match(await page.locator('#controller-status').textContent(), /Evaluation complete/);
    assert.equal(await page.locator('#result-rows tr').count(), 10);
    assert.equal(await page.locator('#test-result-rows').count(), 0);
    assert.equal(await page.locator('#test-results').isVisible(), false);
    assert.equal(await page.locator('#leaderboard-form').isVisible(), true);
    assert.equal(submissions.length, 0); // Evaluation alone must not submit or score.
    await page.locator('#student-name').fill('Test handle');
    await page.locator('#leaderboard-submit').click();
    await page.waitForFunction(() => document.querySelector('#leaderboard-submit-status').textContent.includes('Submission saved.'));
    assert.equal(await page.locator('#test-results').isVisible(), true);
    assert.match(await page.locator('#classification-summary').innerText(), /Action accuracy: 50.0%/);
    assert.match(submissions[0].dataset_id, /^[a-f0-9]{64}$/);
    assert.equal(submissions[0].predictions.length, 1342);
    assert.equal(submissions[0].name, 'Test handle');
    assert.equal(submissions[0].task_name, 'rocket');
    assert.ok(submissions[0].browser_id);
    assert.equal(submissions[0].landing.flight_set, 'test-v1');
    assert.equal(submissions[0].landing.total_runs, 10);
    const testSummary = await page.locator('#test-result-summary').innerText();
    assert.equal(submissions[0].landing.successful_runs, Number(testSummary.split(' / ')[0]));
    if (submissions[0].landing.score !== null) {
      assert.ok(Math.abs(submissions[0].landing.score - Number(testSummary.match(/Mean score: ([\d.]+)/)[1])) < 0.051);
    }
    assert.ok(submissions[0].landing.successful_runs >= 0);
    assert.ok(submissions[0].landing.score === null || (submissions[0].landing.score >= 0 && submissions[0].landing.score <= 100));
    await page.evaluate(() => showSubmittedTestResults(
      {sample_count:1, overlapping_observations:null},
      {successful_runs:0, total_runs:10, score:null, scored_contacts:0},
      {sample_count:1, accuracy:0, macro_f1:0}));
    assert.equal(await page.locator('#classification-overlap').isVisible(), false);
    await page.locator('#result-rows button').first().click();
    assert.equal(await page.locator('#replay-view').isVisible(), true);
    const initialValidationX = await page.evaluate(() => record.config.initial_state.x);
    const expectedValidationX = await page.evaluate(async () => {
      const lines = (await (await fetch('./validation_runs.csv')).text()).trim().split('\n');
      const header = lines[0].split(','), row = lines[1].split(',');
      return Number(row[header.indexOf('x')]);
    });
    assert.equal(initialValidationX, expectedValidationX);
    await page.locator('#replay').click();
    await page.waitForTimeout(500);
    assert.notEqual((await page.locator('#replaytime').textContent()).split(' / ')[0], '0.00');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
    assert.match(download.suggestedFilename(), /^rocket-.*\.json$/);
    await page.locator('#import').setInputFiles(path.join(__dirname, 'expert_replays/run_0.json'));
    await page.waitForFunction(() => /imported/i.test(document.querySelector('#message').textContent));
    await page.locator('#weights-file').setInputFiles({name: 'browse.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('rocket-weights')});
    assert.equal(await page.locator('#weights-filename').innerText(), 'browse.bin');
    await page.locator('#weights-clear').click();
    assert.equal(await page.locator('#weights-meta').isVisible(), false);
    assert.equal(await page.locator('#controller-run').innerText(), 'Train and evaluate');
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['rocket-weights'], 'dropped.bin', {type:'application/octet-stream'}));
      document.querySelector('#weights-zone').dispatchEvent(new DragEvent('drop', {dataTransfer:data, bubbles:true}));
    });
    assert.equal(await page.locator('#weights-filename').innerText(), 'dropped.bin');
    assert.equal(await page.locator('#controller-run').innerText(), 'Evaluate saved model');
    await page.locator('#controller-run').click();
    await page.waitForFunction(() => /Evaluation complete|Controller error/.test(document.querySelector('#controller-status').textContent), null, {timeout: 180000});
    assert.match(await page.locator('#controller-status').textContent(), /Evaluation complete/);
    assert.equal(await page.locator('#result-rows tr').count(), 10);
    assert.equal(await page.locator('#test-results').isVisible(), false);
    assert.equal(submissions.length, 1);
    await page.locator('#leaderboard-submit').click();
    await page.waitForFunction(() => document.querySelector('#leaderboard-submit-status').textContent.includes('Submission failed'));
    assert.equal(await page.locator('#test-results').isVisible(), false);
    await page.locator('#controller-run').click();
    await page.locator('#controller-cancel').click();
    await page.waitForFunction(() => document.querySelector('#controller-status').textContent.includes('cancelled'));
    assert.deepEqual(errors, []);
    console.log('Browser worker, training, saved weights, replay, import/export, cancellation and mobile layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
