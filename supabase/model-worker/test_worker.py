import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class FakeAPI:
    def __init__(self):
        self.calls = []
    def call(self, action, body, limit=32768):
        self.calls.append((action, body))
        return b'model' if body['file'] == 'model.py' else b'weights'
    def json(self, action, body):
        self.calls.append((action, body))
        return {'accepted': True}

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(worker.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64})
        self.env.start()
        self.addCleanup(self.env.stop)
        worker.STOP.clear()
        self.claim = dict(submission_id='submission', claim_token='claim',
            lease_until=(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=900)).isoformat(),
            model_sha256=hashlib.sha256(b'model').hexdigest(),
            weights_sha256=hashlib.sha256(b'weights').hexdigest())

    def test_api_configuration(self):
        with self.assertRaises(ValueError):
            worker.API('http://example.test', 'a' * 64)
        with self.assertRaises(ValueError):
            worker.API('https://example.test', 'bad')
        worker.API('https://example.test/function', 'a' * 64)

    def test_digest_mismatch_never_evaluates_or_finishes(self):
        api = FakeAPI()
        self.claim['model_sha256'] = '0' * 64
        with mock.patch.object(worker.subprocess, 'run'), mock.patch.object(worker.subprocess, 'Popen') as spawn:
            with self.assertRaises(worker.APIError):
                worker.run_job(api, self.claim, 10)
            spawn.assert_not_called()
        self.assertFalse(any(action == 'finish' for action, _ in api.calls))

    def test_completed_job_reports_metrics_and_claim_token(self):
        api = FakeAPI()
        process = mock.Mock(returncode=0)
        process.poll.return_value = 0
        process.communicate.return_value = (json.dumps({'metrics': {'score': 75, 'landing_success_pct': 50}}).encode(), b'')
        with mock.patch.object(worker.subprocess, 'Popen', return_value=process), mock.patch.object(worker.subprocess, 'run'):
            worker.run_job(api, self.claim, 10)
        finish = [body for action, body in api.calls if action == 'finish']
        self.assertEqual(len(finish), 1)
        self.assertEqual(finish[0]['metrics']['score'], 75)
        self.assertEqual(finish[0]['claim_token'], 'claim')
        self.assertEqual(finish[0]['test_set_version'], worker.test_version('a' * 64))

    def test_expired_lease_does_not_download_or_finish(self):
        api = FakeAPI()
        self.claim['lease_until'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)).isoformat()
        with mock.patch.object(worker.subprocess, 'run'), mock.patch.object(worker.subprocess, 'Popen') as spawn:
            worker.run_job(api, self.claim, 10)
            spawn.assert_not_called()
        self.assertFalse(any(action == 'finish' for action, _ in api.calls))

    def test_timeout_reports_failure_and_stops_process(self):
        api = FakeAPI()
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(worker.subprocess, 'Popen', return_value=process), mock.patch.object(worker.subprocess, 'run'):
            worker.run_job(api, self.claim, 0.01)
        finish = [body for action, body in api.calls if action == 'finish']
        self.assertEqual(finish[0]['error_category'], 'timeout')
        process.terminate.assert_called_once()

    def test_rejected_heartbeat_stops_without_finishing(self):
        class LostAPI(FakeAPI):
            def json(self, action, body):
                self.calls.append((action, body))
                return {'accepted': False}
        api = LostAPI()
        self.claim['lease_until'] = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=6)).isoformat()
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(worker.subprocess, 'Popen', return_value=process), mock.patch.object(worker.subprocess, 'run'):
            worker.run_job(api, self.claim, 10)
        self.assertTrue(any(action == 'heartbeat' for action, _ in api.calls))
        self.assertFalse(any(action == 'finish' for action, _ in api.calls))
        process.terminate.assert_called_once()

if __name__ == '__main__':
    unittest.main()
