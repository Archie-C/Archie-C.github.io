# Rocket classification exercise

Serve the repository root over HTTP and open
`courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise/`.
For example, run `python3 -m http.server 8000` from the repository root. Opening
`index.html` directly as a file does not support the worker's fetch requests.
Pyodide and NumPy are downloaded from jsDelivr; the simulator, datasets and
recordings are static site files. Training and evaluation run in a disposable
Web Worker. Cancel stops the worker.

Upload a Python file defining `Controller.fit(X, y)` and
`Controller.predict_action(observation)`, or supply saved weights and a
`Controller.load(path)` method to skip training. Only browser-compatible Python
modules are available; the worker currently loads NumPy. The training dataset is
about 28 MB. The example defaults to 10 training epochs; its feature construction
may require substantial time and memory. Saved weights avoid downloading the
training data.

## Cloud action scoring

`X_test.csv` contains test observations plus `run_id` and `step`; it contains no
expert actions or flight outcomes. The worker predicts actions in row order,
resetting controller history at sequence boundaries. When the student submits to
the leaderboard, the page sends those predictions and the SHA-256 of the exact
test CSV to the `score-rocket` Supabase Edge Function. The function looks up
matching labels and returns accuracy and macro F1.
The browser separately simulates ten validation flights from `validation_runs.csv`
and ten test flights from the `step=0` states and winds in `X_test.csv`, with a
fresh controller for each flight. The page displays the aggregate test result
and action agreement only after a successful leaderboard submission; individual
flight results and controller/expert replays are shown only for validation. The worker sends only the test summary to the page and discards test
flight recordings. The leaderboard receives the test-flight summary, never the
validation summary. Flight results
are available even if cloud action scoring fails.

The matching upload file is `.private/rocket-test/y_test.csv` at the repository
root. It contains `dataset_id`, `row_index`, and `action`. `.private/` is ignored
by Git; do not commit or publish it. The full original dataset is backed up beside
it as `test_landings_full.csv` for the original local simulator. Git ignore does
not prevent a local HTTP server from serving the file: don't expose a server
rooted at this repository to untrusted users.

To set up scoring in Supabase:

1. Run `supabase/functions/score-rocket/setup.sql` in the Supabase SQL editor.
   It creates a labels table with row-level security and no browser access.
2. Import `.private/rocket-test/y_test.csv` into `rocket_test_labels` using the
   Supabase dashboard. Preserve all rows, `dataset_id`, and `row_index`; the
   dataset hash binds this upload to the exact public CSV. Importing another
   copy with the same dataset and row indexes conflicts with the primary key.
3. Run `supabase/functions/score-rocket/leaderboard.sql` in the SQL editor. It
   creates the database function used to select one best attempt per browser.
4. Deploy `supabase/functions/score-rocket` to the site's Supabase project as
   `score-rocket`, configured as a public function (`--no-verify-jwt` for the
   CLI). The function uses the automatically supplied `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` environment variables on the server; never put
   the service role key in the website. The public endpoint only returns scores.
5. Reload the exercise and run a controller. If scoring is unavailable or the
   uploaded labels do not match the public dataset, the page reports that while
   still showing the local flight results.

After evaluation, a student can enter a name and explicitly submit the result.
`score-rocket` inserts each attempt into `global_submissions` using its
`browser_id`, `name`, `task_name`, `predictions`, and `metrics` columns. Metrics
include cloud-computed `accuracy` and `macro_f1`, plus `score` (mean landing
score out of 100), `landing_success_pct`, landing counts, and `dataset_id`.
The landing metrics come from the browser and are not independently verified by
the server. New submissions carry `flight_set: "test-v1"`; the function and page
exclude older untagged submissions because their landing metrics came from the
validation flights. Those old rows remain in the database. Redeploy the updated
`score-rocket` function along with the updated page; older function versions do
not mark test-flight submissions. For the selected metric, the leaderboard reads
only each browser's best test submission from the database and orders those
results by that metric. Equal metric values for one browser select the newest
submission; entries with no numeric value for that metric are excluded. Browser
IDs and predictions are never returned to the page. Scores from different
dataset versions should not be treated as directly comparable.

Saving every attempt requires `global_submissions` to allow multiple rows with the
same `(browser_id, task_name)`. The earlier binary submission function's
`upsert` suggests there may be a unique constraint on those columns. Inspect it
before enabling repeated rocket submissions:

```sql
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'global_submissions';
```

Do not remove a shared constraint without updating the existing regression and
classification upsert functions that may depend on it. If it rejects a repeated
rocket submission, the page reports that the database currently permits only
one per browser and task.

**The current test observations and expert labels have previously appeared
in the Git history of this repository.** Removing the current files does not
make that historical data secret. For a genuinely new test, generate a fresh
expert dataset with a new, private seed into
`.private/rocket-test/test_landings_full.csv`, then run from the repository root:

```
python3 classification_exercise_temp/split_test_dataset.py
```

This replaces both `X_test.csv` and the private `y_test.csv` with matching files.
Upload the new labels before publishing the matching public observations. A
public scoring endpoint can also reveal information through repeated queries;
this arrangement does not provide tamper-proof or high-stakes assessment.

The original local implementation remains in `classification_exercise_temp`.
The browser adapter uses `rocket_runtime.py` and runs
`run_uploaded_controller.main` in the worker rather than a subprocess.

For an end-to-end smoke test, install Node.js and Playwright with Chromium in a
separate development environment, serve the repository root as above, then run
`node test-browser.cjs` from this directory. Set `ROOT_URL` if needed. The test
uses mocked scoring and leaderboard responses and makes no real submissions.

To enable the current-browser highlight, rerun `supabase/functions/score-rocket/leaderboard.sql` in the Supabase SQL editor and redeploy the `score-rocket` Edge Function alongside the updated page. The leaderboard response marks the matching entry without returning browser IDs.
