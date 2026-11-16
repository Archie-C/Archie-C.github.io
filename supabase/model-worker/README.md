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

   Link the CLI to the intended project first, or pass `--project-ref YOUR_PROJECT_REF`. If not already deployed, also deploy `model-worker` with `supabase functions deploy model-worker --no-verify-jwt`. Existing installations do **not** need SQL changes for this switch; new installations still need `setup.sql`. Test with a controlled submission after both deployments.

Each successful queue operation sends a background notification; an HTTP failure or a missing or invalid trigger configuration is logged without undoing the queued submission. There is no scheduled recovery: failed notifications and expired claims require another notification or an operator to invoke the deployed `consume_queue` function. Each invocation handles one job and claims the next eligible submission, not necessarily the submission that caused the notification. Repeated manual invocations may be needed for a backlog. Only one consumer container is allowed. Expired running jobs become eligible after their lease expires (900 seconds by default). The initial Sandbox image build downloads CPU PyTorch and can take time. A job has a 1,800-second deadline and a Sandbox has a 1,860-second maximum lifetime. If heartbeat renewal fails, the worker stops the job and discards its result. Sandbox creation, execution and endpoint invocations incur Modal charges. Set account spending controls and monitor usage before opening the anonymous submission endpoint.

To invoke the deployed consumer manually, authenticate the Modal CLI for the correct workspace and environment, then run:

```sh
python -c "import modal; modal.Function.from_name('rocket-model-worker', 'consume_queue').remote()"
```

This waits for one claim to finish and can consume a real claim attempt. Use the Modal dashboard or `modal app logs rocket-model-worker` to inspect logs. Stop the deployed app in the Modal dashboard or with `modal app stop rocket-model-worker`; redeploy after changes. Notifications and manual invocations against a live queue claim real jobs. Sandboxes are terminated on completion or cancellation; their hard lifetime also bounds abandoned instances after a sudden worker failure. The old Docker worker files are retained for local development but are not used by the Modal deployment.

Modal references: [Sandboxes](https://modal.com/docs/guide/sandboxes), [filesystem access](https://modal.com/docs/guide/sandbox-files), [Web Functions](https://modal.com/docs/guide/webhooks), and [Secrets](https://modal.com/docs/guide/secrets).

## Evaluation scenarios and scoring

Each submission runs 14 closed-loop flights: the four public calibrated scenarios in `rocket_calibration.py` and ten deterministic held-out flights derived from `MODEL_PRIVATE_SEED`. The held-out set has two cases each for descent, mid-flight, approach, recovery and crosswind; the initial states, actuator conditions and wind vary. They are sampled using the feasibility checks in `rocket_sampling.py`, which do not guarantee that a landing is possible for every controller. The same seed, sampler and dependencies give all participants the same private cases. Each flight runs up to 30 simulated seconds.

The evaluator uses only the existing `touchdown-v1.0` first-contact landing score and success result; it does not compare actions or predictions to an expert. An unsuccessful flight scores zero. `score` is the arithmetic mean across all 14 flights, and `landing_success_pct` is the percentage of successful flights. The evaluator version is `rocket-worker-v2`; the test-set version includes a short hash of the seed so a changed seed produces a distinct version. The model receives its current observations and can infer information about each held-out flight. Repeated submissions and aggregate scores can also reveal information about the set; the private cases are not a cryptographic secret from an adversarial participant.

**Leaderboard transition:** Scores from the previous four-flight `public-scenarios-v1` benchmark are not directly comparable to the 14-flight benchmark. Existing published entries remain visible and the leaderboard currently does not separate versions. Before opening the updated benchmark, decide whether to unpublish or reset old results, or keep the leaderboard closed until all relevant models have been re-evaluated. Changing the seed, sampler, physics, dependencies or scoring similarly requires a new comparison policy. Do not rotate the seed mid-leaderboard without planning the transition.

## Deployment check

The local unit tests mock the gateway and execution; they cannot validate Modal, the deployed Edge Function, Storage, or real queue concurrency. Before opening submissions, use a controlled submission and confirm it queues, is claimed, completes, displays privately, and is published only when requested. Also test bad weights, invalid output, a slow model, interruption and lease expiry. The example architecture is under `submission-example`; generate matching safetensors weights. Watch Modal logs and billing during the test. Verify that a normal submission starts after its notification, then test manual recovery with an intentionally unavailable trigger and after a lease expires. Check Supabase Edge Function logs for notification failures and Modal logs for consumer errors.
