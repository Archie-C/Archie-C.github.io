"""Event-triggered queue consumer and isolated inference image on Modal."""
from pathlib import Path, PurePosixPath
import os
import sys

import modal

REMOTE_ROOT = PurePosixPath("/opt/rocket-repo")
REMOTE_WORKER = REMOTE_ROOT / "supabase/model-worker"
REMOTE_PRACTICAL = REMOTE_ROOT / "courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise"
app = modal.App("rocket-model-worker")

# Modal imports this module from /root in each Function container, including the
# lightweight web endpoint, which does not contain the repository. Only build
# image recipes where the repository exists: on the deployment machine and in
# the evaluator subprocess, which runs from the worker image's copied checkout.
if modal.is_local():
    ROOT = Path(__file__).resolve().parents[2]
    WORKER = ROOT / "supabase/model-worker"
    PRACTICAL = ROOT / "courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise"
    sandbox_image = (modal.Image.debian_slim(python_version="3.11")
        .run_commands("pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1")
        .pip_install("safetensors==0.4.5")
        .add_local_file(WORKER / "sandbox.py", "/opt/worker/sandbox.py", copy=True))
    worker_image = modal.Image.debian_slim(python_version="3.11").pip_install("numpy==1.26.4", "modal==1.6.4")
    for filename in ("worker.py", "evaluate.py", "modal_app.py", "sandbox.py", "private_cases.py", "Dockerfile"):
        worker_image = worker_image.add_local_file(WORKER / filename, str(REMOTE_WORKER / filename), copy=True)
    for filename in ("rocket_closed_loop.py", "rocket_runtime.py", "rocket_physics.py",
                     "rocket_scoring.py", "rocket_wind.py", "rocket_calibration.py", "rocket_sampling.py"):
        worker_image = worker_image.add_local_file(PRACTICAL / filename, str(REMOTE_PRACTICAL / filename), copy=True)
else:
    # The images are already selected when the deployed Functions start.
    sandbox_image = None
    worker_image = modal.Image.debian_slim(python_version="3.11")



@app.function(image=worker_image, secrets=[modal.Secret.from_name("rocket-model-worker")],
              timeout=1920, max_containers=1)
def consume_queue():
    # Import in the container, where the trusted simulator dependencies exist.
    sys.path.insert(0, str(REMOTE_WORKER))
    import worker
    os.environ["MODEL_BACKEND"] = "modal"
    worker.test_version(os.environ.get("MODEL_PRIVATE_SEED", ""))
    api = worker.API(os.environ.get("MODEL_WORKER_URL", ""), os.environ.get("MODEL_WORKER_TOKEN", ""))
    claim = api.json("claim", {"exercise": "nn-rocket"}).get("claim")
    if claim:
        worker.run_job(api, claim, 1800)


# Proxy authentication is enforced by Modal before this endpoint runs.
# The request carries no job data or Supabase credentials.
@app.function(image=modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]"), timeout=60)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def notify_queued():
    consume_queue.spawn()
    return {"accepted": True}
