"""Trusted physics driver; submitted models run in an isolated sandbox."""
import json
import math
import os
import queue
import threading
import selectors
import subprocess
import sys
import time
from pathlib import Path

PRACTICAL = Path(__file__).resolve().parents[2] / 'courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise'
sys.path.insert(0, str(PRACTICAL))
import numpy as np

from rocket_closed_loop import evaluate_closed_loop_batch
from rocket_physics import Command
from private_cases import private_flights

class EvaluationError(Exception):
    def __init__(self, category):
        self.category = category
        super().__init__(category)

class ModalModel:
    def __init__(self, directory, name):
        import modal
        from modal_app import sandbox_image
        from modal.stream_type import StreamType
        self.sandbox = None
        self.buffer = b''
        self.chunks = queue.Queue(maxsize=4)
        try:
            app = modal.App.lookup('rocket-model-worker')
            self.sandbox = modal.Sandbox.create(app=app, name=name, image=sandbox_image,
                timeout=1860, cpu=(1, 1), memory=(1024, 1024), block_network=True)
            for file in ('model.py', 'weights.safetensors'):
                self.sandbox.filesystem.copy_from_local(str(Path(directory) / file), '/submission/' + file)
            self.process = self.sandbox.exec('python', '-I', '-u', '/opt/worker/sandbox.py',
                                             stderr=StreamType.DEVNULL, text=False, timeout=1840)
            def collect():
                try:
                    for chunk in self.process.stdout:
                        self.chunks.put(chunk)
                finally:
                    self.chunks.put(None)
            threading.Thread(target=collect, daemon=True).start()
            if self.read(60).get('ready') is not True:
                raise EvaluationError('model_loading')
        except BaseException:
            if self.sandbox is not None:
                self.sandbox.terminate()
            raise

    def read(self, timeout):
        deadline = time.monotonic() + timeout
        while b'\n' not in self.buffer:
            try:
                chunk = self.chunks.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise EvaluationError('timeout')
            if chunk is None:
                raise EvaluationError('runtime')
            self.buffer += chunk
            if len(self.buffer) > 16384:
                raise EvaluationError('invalid_shape')
        line, self.buffer = self.buffer.split(b'\n', 1)
        try:
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeDecodeError):
            raise EvaluationError('invalid_shape')

    def predict_batch(self, obs):
        try:
            self.process.stdin.write((json.dumps(obs.tolist()) + '\n').encode())
            self.process.stdin.drain()
            response = self.read(float(os.getenv('MODEL_INFERENCE_TIMEOUT', '5')))
        except (BrokenPipeError, OSError):
            raise EvaluationError('runtime')
        return validate_batch_response(response, len(obs))

    def predict(self, obs):
        return self.predict_batch(np.asarray(obs).reshape(1, 12))[0]

    def close(self):
        self.sandbox.terminate()


def validate_batch_response(response, batch_size):
    if 'error' in response:
        raise EvaluationError(response['error'] if response['error'] in ('model_loading', 'invalid_shape', 'runtime') else 'runtime')
    value = response.get('output')
    if not isinstance(value, list) or len(value) != batch_size:
        raise EvaluationError('invalid_shape')
    commands = []
    for row in value:
        if not isinstance(row, list) or len(row) != 2:
            raise EvaluationError('invalid_shape')
        a, b = row
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in row):
            raise EvaluationError('invalid_shape')
        if not 0 <= a <= 1 or not -1 <= b <= 1:
            raise EvaluationError('invalid_shape')
        commands.append(Command(a, b))
    return commands


def validate_response(response):
    return validate_batch_response(response, 1)[0]

class Model:
    def __init__(self, directory, name):
        self.name = name
        self.buffer = b''
        self.process = subprocess.Popen([
            'docker', 'run', '--rm', '-i', '--name', name,
            '--network=none', '--read-only', '--cap-drop=ALL',
            '--pull=never',
            '--security-opt=no-new-privileges', '--pids-limit=64',
            '--memory=' + os.getenv('MODEL_CONTAINER_MEMORY', '1g'),
            '--cpus=' + os.getenv('MODEL_CONTAINER_CPUS', '1'),
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '--mount', 'type=bind,src=' + str(Path(directory).resolve()) + ',dst=/submission,readonly',
            os.getenv('MODEL_CONTAINER_IMAGE', 'rocket-model-sandbox:1')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        response = self.read(60)
        if response.get('ready') is not True:
            raise EvaluationError('model_loading')

    def read(self, timeout):
        deadline = time.monotonic() + timeout
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                raise EvaluationError('timeout')
            chunk = os.read(self.process.stdout.fileno(), 4096)
            if not chunk:
                raise EvaluationError('runtime')
            self.buffer += chunk
            if len(self.buffer) > 16384:
                raise EvaluationError('invalid_shape')
        line, self.buffer = self.buffer.split(b'\n', 1)
        try:
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeDecodeError):
            raise EvaluationError('invalid_shape')

    def predict_batch(self, obs):
        try:
            self.process.stdin.write((json.dumps(obs.tolist()) + '\n').encode())
            response = self.read(float(os.getenv('MODEL_INFERENCE_TIMEOUT', '5')))
        except (BrokenPipeError, OSError):
            raise EvaluationError('runtime')
        return validate_batch_response(response, len(obs))

    def predict(self, obs):
        return self.predict_batch(np.asarray(obs).reshape(1, 12))[0]

    def close(self):
        subprocess.run(['docker', 'rm', '-f', self.name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        self.process.wait(timeout=15)

def main():
    directory, name = sys.argv[1:3]
    model = None
    try:
        flights = list(private_flights(os.environ.get('MODEL_PRIVATE_SEED', '')))
        if not flights:
            raise EvaluationError('infrastructure')
        model = (ModalModel if os.getenv('MODEL_BACKEND') == 'modal' else Model)(directory, name)
        flight_configs = [dict(initial_state=case.initial, parameters=parameters,
                               scenario_id=case.scenario, constant_wind=case.constant_wind,
                               wind_profile=case.gusts) for parameters, case in flights]
        results = evaluate_closed_loop_batch(model.predict_batch, flight_configs, record=False)
        if any(result['status'] == 'error' for result in results):
            raise EvaluationError('evaluation')
        scores = [result['scoring'] for result in results]
        # Only aggregate metrics leave the evaluator; held-out recordings stay private.
        print(json.dumps({'metrics': {'score': sum(x['score'] for x in scores) / len(scores),
              'landing_success_pct': 100 * sum(bool(x['success']) for x in scores) / len(scores)},
              'public_replays': []}))
    except EvaluationError as exc:
        print(json.dumps({'error_category': exc.category}))
    except Exception:
        print(json.dumps({'error_category': 'infrastructure'}))
    finally:
        if model is not None:
            model.close()

if __name__ == '__main__':
    main()
