"""Local, single-session rocket simulator and versioned HTTP API (Python 3.10+)."""
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import rocket_physics
import rocket_calibration as calibration
import rocket_scoring
from rocket_physics import Command, Parameters, State, clearance, discrete_command, forces, mass_properties, simulate, step

ROOT = Path(__file__).resolve().parent
SCHEMA = 'rocket-run-v1'
# Complete recordings are retained; stop before these bounds would be exceeded.
MAX_SNAPSHOTS = 20000
MAX_COMMANDS = 20000


def scenario(name='demo_descent'):
    return calibration.configuration(name)


def contact_quality(contact, p):
    """Classify first contact only; no stability or impact model is implied."""
    return ('candidate safe first contact' if rocket_scoring.score_contact(contact, p)['success']
            else 'contact outside envelope')

def state_packet(run, t, state, command, sequence, contact=None):
    mass, centre, inertia = mass_properties(state.fuel, run.p)
    thrust, drag, lift, tt, at, damping = forces(t, state, run.p)
    wind = run.p.wind(state.y, t)
    air = (state.vx - wind[0], state.vy - wind[1])
    speed = math.hypot(*air)
    alpha = None
    if speed:
        tail = (math.sin(state.theta), -math.cos(state.theta))
        alpha = math.atan2(tail[0]*air[1] - tail[1]*air[0], tail[0]*air[0] + tail[1]*air[1])
        cp = run.p.centre_of_pressure(alpha)
    else:
        cp = None  # Angle of attack (and thus pressure centre) is undefined.
    violations = []
    if not 0 <= state.y <= 1000: violations.append('altitude')
    if speed > 130: violations.append('airspeed')
    if alpha is not None and abs(alpha) > math.radians(35): violations.append('angle of attack')
    run.envelope_left = run.envelope_left or bool(violations)
    return dict(run_id=run.id, sequence=sequence, time=t, state=asdict(state),
                command=command, centre=centre, diagnostics=dict(mass=mass, inertia=inertia,
                thrust_vector=thrust, aero_force=[drag[0]+lift[0], drag[1]+lift[1]],
                aero_torque=at, wind=wind, airspeed=speed, angle_of_attack=alpha, envelope_violations=violations, envelope_left=run.envelope_left, centre_of_pressure=cp, clearance=clearance(state, run.p)[0]),
                contact=asdict(contact) if contact else None)


class Run:
    def __init__(self, scenario_name='demo_descent'):
        self.scenario_name = scenario_name
        self.p, self.initial = scenario() if scenario_name == 'demo_descent' else scenario(scenario_name)
        self.envelope_left = False
        self.id = uuid.uuid4().hex
        self.status = 'ready'
        self.t = 0.0
        self.state = self.initial
        self.command = dict(throttle=0., gimbal=0., action=None)
        self.pending = []
        self.commands = []
        self.event = None
        self.error = None
        self.speed = 1.
        self.credit = 0.
        self.last_wall = time.monotonic()
        self.tick = 0
        numeric = {k:v for k,v in asdict(self.p).items() if not callable(v)}
        meta = calibration.metadata(scenario_name)
        engine_hash = hashlib.sha256(Path(rocket_physics.__file__).read_bytes()).hexdigest()
        definition = dict(parameters=numeric, **meta, physics_engine_sha256=engine_hash)
        identity = hashlib.sha256(json.dumps(definition, sort_keys=True).encode()).hexdigest()
        self.config = dict(schema=SCHEMA, run_id=self.id, physics_config=calibration.NAME+':'+identity,
            parameter_status='Falcon 9–inspired engineering model (not flight-certified).',
            parameters=numeric, **meta, scoring=asdict(rocket_scoring.CONFIG), physics_engine_sha256=engine_hash,
            units='SI; angles in radians', recording_limits=dict(snapshots=MAX_SNAPSHOTS, commands=MAX_COMMANDS), initial_state=asdict(self.initial),
            actions=[asdict(discrete_command(i, self.p)) for i in range(10)])
        self.snapshots = [state_packet(self, 0, self.state, self.command.copy(), 0)]

    def record(self, after=None):
        # Sequences start at zero and are contiguous, so the cursor is also an index.
        start = 0 if after is None else after + 1
        return dict(schema=SCHEMA, config=self.config, snapshots=self.snapshots[start:],
                    commands=self.commands.copy(), pending_commands=self.pending.copy(),
                    terminal=self.event, status=self.status, error=self.error)

    def queue(self, payload):
        if self.status not in ('ready', 'running', 'paused'):
            raise ValueError('flight has ended; reset before commanding')
        seq = payload.get('command_sequence')
        if type(seq) is not int or seq < 0 or (self.commands and seq <= self.commands[-1]['command_sequence']):
            raise ValueError('command sequence must increase')
        if self.pending and seq <= self.pending[-1]['command_sequence']:
            raise ValueError('command sequence must increase')
        if 'action' in payload:
            action = payload['action']
            cmd = discrete_command(action, self.p)
        else:
            action = None
            a, b = payload.get('throttle'), payload.get('gimbal')
            if type(a) not in (int, float) or type(b) not in (int, float):
                raise ValueError('throttle and gimbal must be numbers')
            try:
                cmd = Command(a, b)
            except OverflowError as exc:
                raise ValueError('command must be finite and normalized') from exc
        # Boundaries are in simulation time, independent of browser paint rate.
        boundary = math.ceil((self.t - 1e-10) / self.p.control_interval) * self.p.control_interval
        if 'effective_time' in payload:
            requested = payload['effective_time']
            if type(requested) not in (int, float):
                raise ValueError('effective_time must be a finite control boundary')
            try:
                quotient = requested / self.p.control_interval
                if not math.isfinite(quotient): raise ValueError('non-finite boundary')
                nearest = round(quotient) * self.p.control_interval
            except OverflowError as exc:
                raise ValueError('effective_time must be a finite control boundary') from exc
            if requested < self.t - 1e-10 or requested < 0 or abs(requested-nearest) > 1e-9:
                raise ValueError('effective_time must be a future control boundary')
            boundary = nearest
        if self.pending and boundary < self.pending[-1]['effective_time'] - 1e-10:
            raise ValueError('commands must be scheduled in boundary order')
        if len(self.commands) + len(self.pending) >= MAX_COMMANDS:
            raise ValueError('command recording limit reached; reset to begin a new flight')
        if len(self.pending) >= 128:
            raise ValueError('too many commands are awaiting a control boundary')
        item = dict(command_sequence=seq, effective_time=boundary, throttle=cmd.throttle,
                    gimbal=cmd.gimbal, action=action)
        self.pending.append(item)
        return dict(run_id=self.id, **item)

    def advance(self):
        # Reserve space for both an optional command-boundary frame and the
        # next physics frame. Never discard a state that has been integrated.
        if len(self.snapshots) >= MAX_SNAPSHOTS - 1:
            self.status = 'completed'
            self.event = dict(run_id=self.id, type='completed', time=self.t, reason='recording capacity reached', scoring=rocket_scoring.score_contact(None, self.p))
            return
        applied = False
        while self.pending and self.pending[0]['effective_time'] <= self.t + 1e-10:
            item = self.pending.pop(0)
            self.command = {k:item[k] for k in ('throttle', 'gimbal', 'action')}
            self.commands.append(item)
            applied = True
        if applied:
            # Preserve the exact command transition even when it shares the
            # timestamp and physical pose of the preceding integration frame.
            self.tick += 1
            self.snapshots.append(state_packet(self, self.t, self.state, self.command.copy(), self.tick))
        h = min(self.p.timestep, (math.floor((self.t+1e-10)/self.p.control_interval)+1)*self.p.control_interval-self.t)
        self.state, contact = step(self.t, self.state, Command(self.command['throttle'], self.command['gimbal']), self.p, h)
        self.t = contact.time if contact else self.t + h
        self.tick += 1
        self.snapshots.append(state_packet(self, self.t, self.state, self.command.copy(), self.tick, contact))
        if contact:
            self.status = 'contact'
            self.event = dict(run_id=self.id, type='contact', time=contact.time, point=contact.point, state=asdict(contact.state), reason='first ground contact', quality=contact_quality(contact, self.p), scoring=rocket_scoring.score_contact(contact, self.p))

    def wall_tick(self, now):
        elapsed = max(0., now-self.last_wall)
        self.last_wall = now
        if self.status != 'running':
            return
        self.credit += elapsed*self.speed
        # Retain debt and expose it; never skip integration steps.
        count = 0
        try:
            while self.credit >= self.p.timestep and self.status == 'running' and count < 25:
                before = self.t
                self.advance()
                self.credit -= self.t-before
                count += 1
        except Exception as exc:
            self.status = 'error'
            self.error = f'Physics error ({type(exc).__name__}): {exc}'
            self.event = dict(run_id=self.id, type='error', time=self.t, reason=self.error, scoring=rocket_scoring.score_contact(None, self.p))


lock = threading.RLock()
run = Run()
last_client = time.monotonic()


def worker():
    global last_client
    while True:
        time.sleep(.01)
        with lock:
            now = time.monotonic()
            if run.status == 'running' and now-last_client > 2:
                run.status = 'paused'
                run.error = 'Connection lost: flight paused after missing heartbeat.'
            run.wall_tick(now)


class Handler(BaseHTTPRequestHandler):
    def reply(self, data, status=200):
        raw = json.dumps(data, allow_nan=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        global last_client
        url = urlsplit(self.path)
        path = url.path
        if path == '/api/run':
            try:
                query = parse_qs(url.query, keep_blank_values=True)
                if set(query) - {'run_id', 'after'} or any(len(v) != 1 for v in query.values()):
                    raise ValueError('invalid snapshot cursor')
                after = None
                with lock:
                    if query:
                        if set(query) != {'run_id', 'after'} or query['run_id'][0] != run.id:
                            raise ValueError('unknown run_id')
                        cursor = query['after'][0]
                        if not cursor.isascii() or not cursor.isdecimal():
                            raise ValueError('invalid snapshot cursor')
                        after = int(cursor)
                        if after >= len(run.snapshots):
                            raise ValueError('snapshot cursor is ahead of the run')
                    last_client = time.monotonic()
                    result = dict(record=run.record(after), lag=run.credit)
                self.reply(result)
            except ValueError as exc:
                self.reply(dict(error=str(exc)), 400)
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8'), '/design-system.css': ('../design_system/colors_and_type.css', 'text/css; charset=utf-8')}
        if path not in files:
            self.send_error(404); return
        name, content_type = files[path]
        data = (ROOT/name).read_bytes()
        self.send_response(200); self.send_header('Content-Type', content_type); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        global run, last_client
        try:
            length = int(self.headers.get('Content-Length', '0'))
            limit = 256 * 1024 if self.path == '/api/controller' else 16384
            if length < 0 or length > limit: raise ValueError('invalid request size')
            if self.path == '/api/controller':
                host = self.headers.get('Host', '')
                port = self.server.server_address[1]
                if (host not in (f'127.0.0.1:{port}', f'localhost:{port}') or
                        self.headers.get('Origin') != f'http://{host}' or
                        self.headers.get_content_type() != 'application/json'):
                    raise ValueError('controller requests must come from the local simulator page')
            data = json.loads(self.rfile.read(length) or b'{}', parse_constant=lambda x: (_ for _ in ()).throw(ValueError('non-finite JSON')))
            if not isinstance(data, dict): raise ValueError('object required')
            if self.path == '/api/controller':
                source = data.get('source')
                if not isinstance(source, str) or not source.strip() or len(source.encode('utf-8')) > 128 * 1024:
                    raise ValueError('controller source must be a nonempty Python file under 128 KB')
                self.reply(run_controller(source))
                return
            if self.path == '/api/offline':
                actions = data.get('actions')
                if not isinstance(actions, list) or len(actions) > 10000:
                    raise ValueError('actions must be a list of at most 10000 entries')
                with lock:
                    if data.get('run_id') != run.id: raise ValueError('unknown run_id')
                    last_client = time.monotonic()
                    for action in actions: discrete_command(action, run.p)
                    scenario_name = run.scenario_name
                # Generation is independent; it must not hold the live worker lock.
                self.reply(offline(actions, scenario_name))
                return
            with lock:
                last_client = time.monotonic()
                if self.path == '/api/reset':
                    run = Run(data.get('scenario', run.scenario_name)); self.reply(run.record()); return
                if data.get('run_id') != run.id: raise ValueError('unknown run_id')
                if self.path == '/api/command':
                    self.reply(run.queue(data)); return
                if self.path == '/api/control':
                    op = data.get('operation')
                    if op == 'start' and run.status in ('ready', 'paused'):
                        run.status = 'running'; run.error = None; run.last_wall = time.monotonic(); run.credit = 0
                    elif op == 'pause' and run.status == 'running':
                        run.status = 'paused'; run.credit = 0
                    elif op == 'speed' and type(data.get('speed')) in (int, float) and data['speed'] in (.25, .5, 1, 2, 5):
                        run.speed = data['speed']
                    else: raise ValueError('invalid operation for current session')
                    self.reply(dict(status=run.status, speed=run.speed)); return
                raise ValueError('unknown endpoint')
        except (ValueError, TypeError, OverflowError, json.JSONDecodeError) as exc:
            self.reply(dict(error=str(exc)), 400)

    def log_message(self, format, *args):
        pass


def offline(actions, scenario_name='demo_descent', initial_override=None):
    """Generate a complete predetermined discrete-action recording with simulate()."""
    r = Run(scenario_name)
    if initial_override is not None:
        r.initial = r.state = initial_override
        r.config['initial_state'] = asdict(initial_override)
        r.snapshots = [state_packet(r, 0, initial_override, r.command.copy(), 0)]
    per_action = math.ceil(r.p.control_interval / r.p.timestep) + 2
    if len(actions) * per_action + 1 > MAX_SNAPSHOTS:
        raise ValueError('action sequence exceeds recording capacity')
    current_action = -1
    for t, s, contact in simulate(r.initial, actions, r.p):
        if t == 0 and contact is None: continue
        i = min(len(actions)-1, max(0, math.ceil((t-1e-10)/r.p.control_interval)-1))
        cmd = discrete_command(actions[i], r.p)
        command = dict(throttle=cmd.throttle, gimbal=cmd.gimbal, action=actions[i])
        if i != current_action:
            previous = r.snapshots[-1]
            transition_time = previous['time']
            previous_state = State(**previous['state'])
            r.commands.append(dict(command_sequence=i, effective_time=transition_time, **command))
            r.snapshots.append(state_packet(r, transition_time, previous_state, command.copy(), len(r.snapshots)))
            current_action = i
        r.snapshots.append(state_packet(r, t, s, command.copy(), len(r.snapshots), contact))
        if contact:
            r.event = dict(run_id=r.id, type='contact', time=contact.time, point=contact.point, state=asdict(contact.state), reason='first ground contact', quality=contact_quality(contact, r.p), scoring=rocket_scoring.score_contact(contact, r.p))
    r.status = 'contact' if r.event else 'completed'
    if not r.event: r.event = dict(run_id=r.id, type='completed', time=r.snapshots[-1]['time'], reason='action sequence exhausted', scoring=rocket_scoring.score_contact(None, r.p))
    return r.record()


def run_controller(source):
    """Run user-selected, trusted Python in a separate process (not a sandbox)."""
    with tempfile.TemporaryDirectory(prefix='rocket-controller-') as directory:
        source_path = Path(directory) / 'controller.py'
        result_path = Path(directory) / 'result.json'
        source_path.write_text(source, encoding='utf-8')
        env = dict(os.environ, OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1')
        try:
            completed = subprocess.run(
                [sys.executable, str(ROOT / 'run_uploaded_controller.py'), str(source_path),
                 str(result_path)], cwd=ROOT, env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('training or simulation exceeded 120 seconds') from exc
        if not result_path.is_file():
            raise ValueError(f'controller process failed (exit code {completed.returncode})')
        result = json.loads(result_path.read_text(encoding='utf-8'))
        if 'error' in result:
            raise ValueError(result['error'])
        return result


if __name__ == '__main__':
    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    print('Rocket simulator: http://127.0.0.1:8765', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
