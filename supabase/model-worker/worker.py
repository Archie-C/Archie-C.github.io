"""Single-job queue worker. Run only on a dedicated, trusted Linux host."""
import argparse
import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from private_cases import test_version

ROOT = Path(__file__).resolve().parent
LOG = logging.getLogger('model-worker')
STOP = threading.Event()

class APIError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class API:
    def __init__(self, url, token):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != 'https' or not parts.netloc or parts.query or parts.fragment:
            raise ValueError('MODEL_WORKER_URL must be an HTTPS function URL without a query')
        if not re.fullmatch(r'[0-9a-fA-F]{64}', token):
            raise ValueError('MODEL_WORKER_TOKEN must contain 64 hexadecimal characters')
        self.url, self.token = url, token
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, action, body, limit=32768):
        request = urllib.request.Request(self.url + '?action=' + action,
            data=json.dumps(body, allow_nan=False).encode(), method='POST',
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=15) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise APIError('response exceeds limit')
                return data
        except (OSError, urllib.error.URLError) as exc:
            raise APIError('worker gateway unavailable') from exc

    def json(self, action, body):
        try:
            value = json.loads(self.call(action, body))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeDecodeError) as exc:
            raise APIError('invalid gateway response') from exc

def run_job(api, claim, timeout):
    version = test_version(os.environ.get('MODEL_PRIVATE_SEED', ''))
    identity = {'submission_id': claim['submission_id'], 'claim_token': claim['claim_token']}
    deadline = datetime.datetime.fromisoformat(claim['lease_until'].replace('Z', '+00:00')).timestamp()
    lease_window = max(0.0, deadline - time.time())
    lost = threading.Event()
    done = threading.Event()
    start = time.monotonic()
    name = 'rocket-job-' + uuid.uuid4().hex
    process = None

    def heartbeat():
        nonlocal deadline
        while not done.is_set():
            remaining = deadline - time.time()
            if remaining <= 5:
                lost.set()
                return
            if done.wait(max(0.1, min(30.0, remaining / 3))):
                return
            try:
                if api.json('heartbeat', identity).get('accepted') is not True:
                    lost.set()
                    return
                # The gateway does not return the new deadline; the configured
                # lease length is not known. Renew at the same safe interval.
                deadline = time.time() + lease_window
            except APIError:
                lost.set()
                return

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='rocket-artifacts-') as directory:
            os.chmod(directory, 0o755)
            for file, digest, limit in (('model.py', 'model_sha256', 131072), ('weights.safetensors', 'weights_sha256', 20971520)):
                data = api.call('artifact', dict(identity, file=file), limit)
                expected = claim.get(digest)
                if expected is not None and hashlib.sha256(data).hexdigest() != expected.lower():
                    raise APIError('artifact digest mismatch')
                path = Path(directory) / file
                path.write_bytes(data)
                path.chmod(0o644)
                if lost.is_set() or STOP.is_set():
                    return
            process = subprocess.Popen([sys.executable, str(ROOT / 'evaluate.py'), directory, name],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            while process.poll() is None:
                if lost.is_set() or STOP.is_set():
                    return
                if time.monotonic() - start > timeout:
                    result = {'error_category': 'timeout'}
                    break
                time.sleep(0.2)
            else:
                output, _ = process.communicate(timeout=5)
                if len(output) > 32768 or process.returncode != 0:
                    result = {'error_category': 'infrastructure'}
                else:
                    try:
                        result = json.loads(output)
                    except ValueError:
                        result = {'error_category': 'infrastructure'}
            if lost.is_set() or STOP.is_set():
                return
            body = dict(identity, metrics=result.get('metrics'),
                        error_category=result.get('error_category'),
                        duration_ms=min(86400000, int((time.monotonic() - start) * 1000)),
                        evaluator_version='rocket-worker-v2', test_set_version=version, metadata={})
            if body['metrics'] is None and body['error_category'] is None:
                body['error_category'] = 'infrastructure'
            if api.json('finish', body).get('accepted') is True:
                LOG.info('Finished submission %s', identity['submission_id'])
            else:
                LOG.warning('Finish rejected for submission %s', identity['submission_id'])
    finally:
        done.set()
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        try:
            if os.getenv('MODEL_BACKEND') == 'modal':
                import modal
                try:
                    modal.Sandbox.from_name('rocket-model-worker', name).terminate()
                except modal.exception.NotFoundError:
                    pass
            else:
                subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15, check=False)
        except Exception:
            LOG.error('Could not clean up evaluation container %s', name)
        thread.join(timeout=16)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--poll', type=float, default=10)
    parser.add_argument('--timeout', type=float, default=600)
    args = parser.parse_args()
    if args.poll <= 0 or not 0 < args.timeout <= 86400:
        parser.error('poll and timeout must be positive; timeout must not exceed 86400 seconds')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    test_version(os.environ.get('MODEL_PRIVATE_SEED', ''))
    api = API(os.environ.get('MODEL_WORKER_URL', ''), os.environ.get('MODEL_WORKER_TOKEN', ''))
    try:
        subprocess.run(['docker', 'image', 'inspect', os.getenv('MODEL_CONTAINER_IMAGE', 'rocket-model-sandbox:1')],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        raise SystemExit('Docker is unavailable or the sandbox image has not been built')
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: STOP.set())
    LOG.info('Worker started')
    while not STOP.is_set():
        try:
            claim = api.json('claim', {'exercise': 'nn-rocket'}).get('claim')
            if claim:
                LOG.info('Claimed submission %s', claim.get('submission_id'))
                run_job(api, claim, args.timeout)
                continue
        except (APIError, KeyError, TypeError, ValueError, OSError):
            LOG.exception('Worker operation failed; job will be retried after lease expiry')
        STOP.wait(args.poll)

if __name__ == '__main__':
    main()
