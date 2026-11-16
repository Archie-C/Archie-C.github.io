"""Simulation recording primitives shared by browser evaluation."""
from dataclasses import asdict
from pathlib import Path
import hashlib
import json
import math
import time
import uuid

import rocket_physics
import rocket_calibration as calibration
import rocket_scoring
from rocket_physics import Command, Parameters, State, apply_actuators, clearance, discrete_command, forces, mass_properties, simulate, step

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
            self.state = apply_actuators(self.state, Command(self.command['throttle'], self.command['gimbal']), self.p)
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

