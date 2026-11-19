# Rocket model evaluation on Modal

When a participant queues a submission, the Supabase `model-submissions` Edge Function notifies an authenticated Modal endpoint. The endpoint starts a background Modal Function, which claims jobs through the existing `model-worker` Edge Function and runs the trusted rocket simulator. For each claim it creates a separate Modal Sandbox for the submitted Python and weights. The Sandbox has network access blocked, a 1 CPU / 1 GiB limit and a hard lifetime; it receives neither the gateway token nor the simulator files. Its output is validated by the trusted simulator. No server or Docker installation is required.

## Setup

1. Set up the database, submission function and worker gateway as described in [the submission service README](../model-submissions/README.md). Deploy the `model-worker` Edge Function with `--no-verify-jwt` and configure its `MODEL_WORKER_TOKEN` to a random 64-character hexadecimal secret. Keep this token private.
2. Install Python 3.11 and the Modal client on your own computer, authenticate with Modal, and install local test dependencies:

   ```sh
   python -m venv .venv
   # Activate .venv using the command for your operating system.
   python -m pip install modal==1.6.4 numpy==1.26.4
   modal token new
   ```

3. In the Modal dashboard create a Secret named `rocket-model-worker` with three keys. Set `MODEL_WORKER_URL` to `https://YOUR-PROJECT.supabase.co/functions/v1/model-worker` and `MODEL_WORKER_TOKEN` to the same token configured on the Edge Function. Add `MODEL_PRIVATE_SEED` as a third key: generate a fresh random 64-character hexadecimal value with `python -c "import secrets; print(secrets.token_hex(32))"` and paste it into the Modal Secret. Keep the same seed for the whole leaderboard, keep it out of source control and the browser, and store a secure backup. The worker validates it before claiming jobs. Do not add the token to this repository or the browser. The Supabase service-role key is not required by Modal.
4. From the repository root, run tests and deploy Modal:

   ```sh
   python -m unittest discover -s supabase/model-worker -p 'test_*.py' -v
   modal deploy supabase/model-worker/modal_app.py
   ```

   Copy the HTTPS URL of the deployed `notify_queued` web function from the deployment output or Modal dashboard. It ends in `.modal.run`.

5. Create a [Modal proxy token](https://modal.com/docs/guide/webhook-proxy-auth) in the Modal dashboard or CLI. In the Supabase dashboard, open your project?s **Edge Function Secrets** and add:

   | Secret | Value |
   | --- | --- |
   | `MODEL_MODAL_TRIGGER_URL` | The `notify_queued` HTTPS URL from step 4 |
   | `MODEL_MODAL_PROXY_KEY` | The Modal proxy token ID |
   | `MODEL_MODAL_PROXY_SECRET` | The Modal proxy token secret |

   These are server-side secrets for `model-submissions`; do not place them in the website or repository. Keep `MODEL_SITE_ORIGIN` and the existing `MODEL_WORKER_TOKEN` configured. The Modal proxy token is separate from `MODEL_WORKER_TOKEN`.

6. Redeploy the updated submission function from the repository root:

   ```sh
   supabase functions deploy model-submissions --no-verify-jwt
   ```

   Link the CLI to the intended project first, or pass `--project-ref YOUR_PROJECT_REF`. Existing installations must reapply `setup.sql` for the result-cache function and index, then deploy the `model-worker` gateway before the updated Modal app. Follow the deployment check below and test with a controlled submission after deployment.

Each successful queue operation sends a background notification; an HTTP failure or a missing or invalid trigger configuration is logged without undoing the queued submission. There is no scheduled recovery: failed notifications and expired claims require another notification or an operator to invoke the deployed `consume_queue` function. Each invocation handles one job and claims the next eligible submission, not necessarily the submission that caused the notification. Repeated manual invocations may be needed for a backlog. Only one consumer container is allowed. Expired running jobs become eligible after their lease expires (900 seconds by default). The initial Sandbox image build downloads CPU PyTorch and can take time. A job has a 1,800-second deadline and a Sandbox has a 1,860-second maximum lifetime. If heartbeat renewal fails, the worker stops the job and discards its result. Sandbox creation, execution and endpoint invocations incur Modal charges. Set account spending controls and monitor usage before opening the anonymous submission endpoint.

To invoke the deployed consumer manually, authenticate the Modal CLI for the correct workspace and environment, then run:

```sh
python -c "import modal; modal.Function.from_name('rocket-model-worker', 'consume_queue').remote()"
```

This waits for one claim to finish and can consume a real claim attempt. Use the Modal dashboard or `modal app logs rocket-model-worker` to inspect logs. Stop the deployed app in the Modal dashboard or with `modal app stop rocket-model-worker`; redeploy after changes. Notifications and manual invocations against a live queue claim real jobs. Sandboxes are terminated on completion or cancellation; their hard lifetime also bounds abandoned instances after a sudden worker failure. The old Docker worker files are retained for local development but are not used by the Modal deployment.

Modal references: [Sandboxes](https://modal.com/docs/guide/sandboxes), [filesystem access](https://modal.com/docs/guide/sandbox-files), [Web Functions](https://modal.com/docs/guide/webhooks), and [Secrets](https://modal.com/docs/guide/secrets).

## Evaluation scenarios and scoring

Each submission runs ten deterministic held-out flights derived from `MODEL_PRIVATE_SEED`. The four public calibrated starting scenarios are excluded from evaluation. The held-out set has two cases each for descent, mid-flight, approach, recovery and crosswind; the initial states, actuator conditions and wind vary. They are sampled using the feasibility checks in `rocket_sampling.py`, which do not guarantee a successful landing. The same seed, sampler and dependencies give all participants the same private cases. Each flight runs up to 30 simulated seconds. The standalone Docker evaluator uses the same benchmark.

The evaluator uses the existing `touchdown-v1.0` first-contact landing score and success result; it does not compare actions or predictions to an expert. An unsuccessful flight scores zero. `score` is the arithmetic mean across all ten held-out flights, and `landing_success_pct` is the percentage of successful flights. The evaluator version is `rocket-worker-v4`; the test-set version is `landing-private-10-v4-<fingerprint>`. The fingerprint covers the private seed, evaluator and simulator sources, configured inference images and dependencies, backend, and the worker Python/NumPy versions.

Active flights advance together at control boundaries. Their observations are sent to the sandbox in one batch of shape `(N, 12)`, with `1 <= N <= 10`; the model must return `(N, 2)`. Completed flights leave subsequent batches. The sandbox loads the model once, sets Python/PyTorch random seeds to zero, and runs in evaluation/inference mode. Physics, contact detection and scoring remain in the trusted process.

Grading uses `record=False`: per-step replay snapshots, visualisation diagnostics, policy provenance and decision recordings are skipped. The notebook simulator keeps recording enabled by default. Only aggregate metrics leave the evaluator. It returns an empty public replay manifest and does not write or upload held-out recordings or individual flight results. The public scenarios remain available for local notebook experiments, including JSON replay export. Historical public recordings remain accessible through the existing owner-only replay API.

**Leaderboard transition:** Scores from the previous four-public-plus-ten-private benchmark are not directly comparable to the ten-private-flight benchmark. Existing published entries are not automatically recalculated or removed, and the leaderboard does not separate versions. Re-evaluate models under the same benchmark before comparing their scores. Keep the seed fixed for a leaderboard; changes to the seed, sampler, physics, dependencies or scoring need a deliberate version transition.

## Reusing successful evaluations

After downloading and verifying both artifacts, the worker calls the worker gateway's `reuse` action before starting the evaluator or a model sandbox. A database lookup matches the participant, exercise, source SHA-256, weights SHA-256, evaluator version and test-set fingerprint. Only completed successful evaluations can be reused. Cache hits finish the current valid claim with copied metrics and no replays; stale claims cannot complete. No scores are shared between participants, and publishing remains a separate action.

The cache lives in the submission database and survives worker cold starts. Verified artifact hashes are populated when upload metadata was missing. Source/runtime/seed changes invalidate reuse through the benchmark fingerprint. A hit's duration records its current processing time, not the duration of the original model run; cache provenance is kept in private evaluation metadata. Identical files are expected to define reproducible evaluation behaviour. Failed and in-progress attempts are never reused.

## Deployment check

Apply the rerunnable `supabase/model-submissions/setup.sql` as the project owner first. It adds a partial cache index and a service-role-only `model_reuse_result` function. Then run the checks and deploy the gateway before the Modal app:

```sh
python -m unittest discover -s supabase/model-worker -p 'test_*.py' -v
npm --prefix a-level/tests run test:model-submissions
supabase functions deploy model-worker --no-verify-jwt
modal deploy supabase/model-worker/modal_app.py
```

Keep the existing Modal notification URL, proxy secrets and private seed. No schedule, new secret or Modal Volume is required. Docker users must rebuild the sandbox image because the inference protocol now accepts batches; use the same image identifier configured on the worker. Resource requests, concurrency and timeouts are unchanged.

The tests exercise the real simulator, sandbox protocol in local subprocesses, cache SQL and the gateway, while mocking the Modal execution boundary. They do not exercise a deployed queue or live sandbox. After deployment, use a controlled submission to confirm completion, then resubmit identical files from the same browser: the repeat should complete without creating another model sandbox. Verify that different files or a different benchmark do trigger evaluation. Existing entries and historical recordings are preserved.
