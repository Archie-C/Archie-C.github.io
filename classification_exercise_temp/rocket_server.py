"""Local, single-session rocket simulator and versioned HTTP API (Python 3.10+)."""
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import math
import threading
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import rocket_physics
from rocket_physics import Command, Parameters, State, clearance, discrete_command, forces, mass_properties, simulate, step

ROOT = Path(__file__).resolve().parent
SCHEMA = 'rocket-run-v1'


def scenario():
    # Illustrative, deliberately uncalibrated parameters; not flight hardware.
    p = Parameters(dry_mass=10, dry_centroid=(0, 1), dry_inertia=8,
        fuel_capacity=10, tank_bottom=0, tank_height=2, tank_radius=.5,
        engine=(0, 0), hull=((-0.5, 0), (0.5, 0), (0.5, 2.3), (0, 3), (-0.5, 2.3)),
        feet=((-1, -0.5), (1, -0.5)), area=1, length=3,
        min_thrust=0, max_thrust=200, isp=40, g0=9.81,
        thrust_tau=.5, thrust_rate=1000, gimbal_max=.3, gimbal_tau=.5,
        gimbal_rate=2, cmq=1, speed_epsilon=.01, throttle_levels=(.2, .5, 1),
        control_interval=.2, timestep=.02, event_tolerance=1e-9,
        gravity=lambda y: 9.81, density=lambda y: .02, wind=lambda y, t: (0, 0),
        drag_coefficient=lambda a: 1, lift_coefficient=math.sin,
        centre_of_pressure=lambda a: (0, 2),
        terrain=((-100, 4), (-30, 0), (30, 0), (100, 8)))
    return p, State(0, 60, 2, -5, .08, 0, 8, 0, 0)


def state_packet(run, t, state, command, sequence, contact=None):
    mass, centre, inertia = mass_properties(state.fuel, run.p)
    thrust, drag, lift, tt, at, damping = forces(t, state, run.p)
    wind = run.p.wind(state.y, t)
    air = (state.vx - wind[0], state.vy - wind[1])
    speed = math.hypot(*air)
    if speed:
        tail = (math.sin(state.theta), -math.cos(state.theta))
        alpha = math.atan2(tail[0]*air[1] - tail[1]*air[0], tail[0]*air[0] + tail[1]*air[1])
        cp = run.p.centre_of_pressure(alpha)
    else:
        cp = None  # Angle of attack (and thus pressure centre) is undefined.
    return dict(run_id=run.id, sequence=sequence, time=t, state=asdict(state),
                command=command, centre=centre, diagnostics=dict(mass=mass, inertia=inertia,
                thrust_vector=thrust, aero_force=[drag[0]+lift[0], drag[1]+lift[1]],
                aero_torque=at, wind=wind, airspeed=speed, centre_of_pressure=cp, clearance=clearance(state, run.p)[0]),
                contact=asdict(contact) if contact else None)


class Run:
    def __init__(self):
        self.p, self.initial = scenario()
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
        environment = dict(gravity='9.81 m/s² constant', density='0.02 kg/m³ constant',
            wind='(0, 0) m/s', drag_coefficient='1', lift_coefficient='sin(alpha)',
            centre_of_pressure='(0, 2) m in body coordinates')
        engine_hash = hashlib.sha256(Path(rocket_physics.__file__).read_bytes()).hexdigest()
        definition = dict(parameters=numeric, environment=environment, physics_engine_sha256=engine_hash)
        identity = hashlib.sha256(json.dumps(definition, sort_keys=True).encode()).hexdigest()
        self.config = dict(schema=SCHEMA, run_id=self.id, physics_config='illustrative-v1:'+identity,
            parameter_status='Uncalibrated illustrative test parameters', parameters=numeric,
            environment=environment, physics_engine_sha256=engine_hash,
            units='SI; angles in radians', initial_state=asdict(self.initial),
            actions=[asdict(discrete_command(i, self.p)) for i in range(10)], pad=None)
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
        if len(self.pending) >= 128:
            raise ValueError('too many commands are awaiting a control boundary')
        item = dict(command_sequence=seq, effective_time=boundary, throttle=cmd.throttle,
                    gimbal=cmd.gimbal, action=action)
        self.pending.append(item)
        return dict(run_id=self.id, **item)

    def advance(self):
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
            self.event = dict(run_id=self.id, type='contact', time=contact.time, point=contact.point, state=asdict(contact.state), reason='first ground contact')

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
            self.event = dict(run_id=self.id, type='error', time=self.t, reason=self.error)


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
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
        if path not in files:
            self.send_error(404); return
        name, content_type = files[path]
        data = (ROOT/name).read_bytes()
        self.send_response(200); self.send_header('Content-Type', content_type); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        global run, last_client
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 16384: raise ValueError('invalid request size')
            data = json.loads(self.rfile.read(length) or b'{}', parse_constant=lambda x: (_ for _ in ()).throw(ValueError('non-finite JSON')))
            if not isinstance(data, dict): raise ValueError('object required')
            if self.path == '/api/offline':
                actions = data.get('actions')
                if not isinstance(actions, list) or len(actions) > 10000:
                    raise ValueError('actions must be a list of at most 10000 entries')
                with lock:
                    if data.get('run_id') != run.id: raise ValueError('unknown run_id')
                    last_client = time.monotonic()
                    for action in actions: discrete_command(action, run.p)
                # Generation is independent; it must not hold the live worker lock.
                self.reply(offline(actions))
                return
            with lock:
                last_client = time.monotonic()
                if self.path == '/api/reset':
                    run = Run(); self.reply(run.record()); return
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


def offline(actions):
    """Generate a complete predetermined discrete-action recording with simulate()."""
    r = Run()
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
            r.event = dict(run_id=r.id, type='contact', time=contact.time, point=contact.point, state=asdict(contact.state), reason='first ground contact')
    r.status = 'contact' if r.event else 'completed'
    if not r.event: r.event = dict(run_id=r.id, type='completed', time=r.snapshots[-1]['time'], reason='action sequence exhausted')
    return r.record()


if __name__ == '__main__':
    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    print('Rocket simulator: http://127.0.0.1:8765', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
