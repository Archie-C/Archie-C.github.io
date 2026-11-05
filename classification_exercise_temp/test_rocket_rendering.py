import unittest
from unittest.mock import patch

from rocket_physics import Command, discrete_command, simulate
from rocket_server import Run, offline
from test_rocket_physics import parameters, state


class AdapterTests(unittest.TestCase):
    def test_mapping_and_boundaries(self):
        r = Run()
        for action in range(10):
            ack = r.queue({'command_sequence': action, 'action': action})
            self.assertEqual((ack['throttle'], ack['gimbal']), (discrete_command(action, r.p).throttle, discrete_command(action, r.p).gimbal))
            self.assertGreaterEqual(ack['effective_time'] + 1e-9, r.t)
            while r.pending:
                r.advance()
        with self.assertRaises(ValueError): r.queue({'command_sequence': 10, 'action': 10})
        with self.assertRaises(ValueError): r.queue({'command_sequence': 10, 'throttle': float('nan'), 'gimbal': 0})

    def test_multiple_commands_at_same_boundary(self):
        r = Run()
        acknowledgements = [r.queue({'command_sequence': i, 'throttle': i / 10, 'gimbal': 0}) for i in range(1, 4)]
        self.assertEqual([a['effective_time'] for a in acknowledgements], [0, 0, 0])
        self.assertEqual(len(r.record()['pending_commands']), 3)
        r.advance()
        self.assertFalse(r.pending)
        self.assertEqual(r.command['throttle'], .3)
        self.assertEqual([c['command_sequence'] for c in r.commands], [1, 2, 3])
        self.assertEqual(r.snapshots[-1]['command']['throttle'], .3)

    def test_scheduled_controls_reproduce_across_speeds(self):
        def paced(speed):
            r = Run()
            for i, action in enumerate([1, 5, 0, 9, 0]):
                ack = r.queue({'command_sequence': i, 'action': action, 'effective_time': i * r.p.control_interval})
                self.assertAlmostEqual(ack['effective_time'], i * r.p.control_interval)
            r.status = 'running'; r.speed = speed
            while r.status == 'running': r.wall_tick(r.last_wall + .02 / speed)
            return ([(p['time'], p['state'], p['command']) for p in r.snapshots], r.commands, {k:v for k,v in r.event.items() if k!='run_id'})
        self.assertEqual(paced(.25), paced(1))
        self.assertEqual(paced(1), paced(5))
        r = Run()
        for invalid in (-1, .11, float('inf'), 10**400, True):
            with self.assertRaises(ValueError):
                r.queue({'command_sequence': 1, 'action': 1, 'effective_time': invalid})

    def test_recording_bounds_stop_without_discarding_frames(self):
        r = Run(); r.status = 'running'
        with patch('rocket_server.MAX_SNAPSHOTS', 5):
            r.wall_tick(r.last_wall + 1)
        self.assertEqual(r.status, 'completed')
        self.assertEqual(r.event['reason'], 'recording capacity reached')
        self.assertEqual(r.event['time'], r.snapshots[-1]['time'])
        self.assertLessEqual(len(r.snapshots), 5)
        with patch('rocket_server.MAX_COMMANDS', 1):
            r = Run(); r.queue({'command_sequence': 0, 'action': 1})
            with self.assertRaises(ValueError): r.queue({'command_sequence': 1, 'action': 2})
        with patch('rocket_server.MAX_SNAPSHOTS', 20):
            with self.assertRaises(ValueError): offline([0, 1])

    def test_physics_exception_becomes_inspectable_error(self):
        r = Run(); r.status = 'running'
        with patch('rocket_server.step', side_effect=ArithmeticError('test failure')):
            r.wall_tick(r.last_wall + .1)
        self.assertEqual(r.status, 'error')
        self.assertIn('test failure', r.error)
        self.assertEqual(r.event['type'], 'error')
        self.assertEqual(len(r.snapshots), 1)

    def test_pause_and_pacing(self):
        outputs = []
        for speed in (.25, 1, 5):
            r = Run(); r.queue({'command_sequence': 1, 'throttle': .3, 'gimbal': .2})
            r.status = 'running'; r.speed = speed
            while r.t < 1-1e-8:
                r.wall_tick(r.last_wall + .02/speed)
            r.status = 'paused'; before = (r.t, r.state, len(r.snapshots))
            r.wall_tick(r.last_wall + .2)
            self.assertEqual(before, (r.t, r.state, len(r.snapshots)))
            outputs.append([p for p in r.snapshots if p['time'] <= 1 + 1e-8])
        # Ignore run identities; physics and simulation times remain identical.
        self.assertEqual([[ (p['time'], p['state']) for p in o] for o in outputs][0], [(p['time'], p['state']) for p in outputs[1]])
        self.assertEqual([(p['time'], p['state']) for p in outputs[0]], [(p['time'], p['state']) for p in outputs[2]])

    def test_long_wall_stall_keeps_simulation_debt(self):
        r = Run(); r.status = 'running'; r.speed = 1
        r.wall_tick(r.last_wall + 2)
        self.assertGreater(r.credit, 1.4)
        self.assertAlmostEqual(r.t + r.credit, 2, places=8)

    def test_record_read_is_pure_and_offline_matches_simulate(self):
        r = Run(); actions = [1, 5, 0, 9]
        with patch('rocket_server.step', side_effect=AssertionError('unexpected step')):
            self.assertEqual(r.record()['snapshots'], r.record()['snapshots'])
        recording = offline(actions)
        expected = list(simulate(r.initial, actions, r.p))
        simulated = iter(expected)
        current = next(simulated, None)
        for packet in recording['snapshots']:
            if current and packet['time'] == current[0] and tuple(packet['state'].values()) == current[1].values():
                current = next(simulated, None)
        self.assertIsNone(current, 'all simulate() states must be retained')
        self.assertEqual(recording['snapshots'][1]['time'], 0)
        self.assertEqual(recording['snapshots'][1]['command']['action'], 1)
        for command in recording['commands']:
            frames = [p for p in recording['snapshots'] if p['time'] == command['effective_time']]
            self.assertEqual(frames[-1]['command']['action'], command['action'])
        self.assertEqual(recording['terminal']['reason'], 'action sequence exhausted')

    def test_command_schedule_is_independent_of_snapshot_consumption(self):
        def flight(reads_per_step):
            r = Run()
            for sequence, action in enumerate([1, 5, 0, 9, 0]):
                r.queue({'command_sequence': sequence, 'action': action})
                boundary = (sequence + 1) * r.p.control_interval
                while r.t < boundary - 1e-10:
                    for _ in range(reads_per_step): r.record(after=r.tick)
                    r.advance()
            while r.status != 'contact':
                for _ in range(reads_per_step): r.record(after=r.tick)
                r.advance()
            return ([(p['time'], p['state'], p['command']) for p in r.snapshots], r.commands, {k:v for k,v in r.event.items() if k!='run_id'})
        self.assertEqual(flight(1), flight(2))
        self.assertEqual(flight(2), flight(4))

    def test_incremental_record_is_complete_and_does_not_alias_lists(self):
        r = Run()
        first = r.record()
        for _ in range(12): r.advance()
        delta = r.record(after=0)
        self.assertEqual(len(first['snapshots']), 1)
        self.assertEqual(first['snapshots'] + delta['snapshots'], r.record()['snapshots'])
        self.assertEqual(r.record(after=12)['snapshots'], [])

    def test_grazing_terrain_contact_is_recorded_at_engine_pose(self):
        p = parameters(gravity=lambda y: 0, feet=(),
            hull=((-0.1, 0), (0.1, 0), (0.1, 1), (-0.1, 1)),
            terrain=((-10, 0), (-0.1, 0), (0, 1), (0.1, 0), (10, 0)))
        initial = state(x=-4, y=2, vx=20, fuel=0)
        with patch('rocket_server.scenario', return_value=(p, initial)):
            recording = offline([0, 0])
        event = recording['terminal']; final = recording['snapshots'][-1]
        self.assertEqual(recording['status'], 'contact')
        self.assertAlmostEqual(event['time'], .195, places=8)
        self.assertEqual(event['point'], final['contact']['point'])
        self.assertEqual(event['state'], final['state'])
        self.assertGreaterEqual(final['diagnostics']['clearance'], 0)

    def test_contact_terminates_and_matches_snapshot(self):
        r = Run(); r.status = 'running'
        while r.status == 'running': r.advance()
        self.assertEqual(r.status, 'contact')
        last = r.snapshots[-1]
        self.assertEqual(r.event['run_id'], r.id)
        self.assertEqual(last['time'], r.event['time'])
        self.assertEqual(last['state'], r.event['state'])
        self.assertEqual(last['contact']['point'], r.event['point'])
        self.assertEqual([p['sequence'] for p in r.snapshots], list(range(len(r.snapshots))))

    def test_unique_reset_and_command_validation(self):
        a, b = Run(), Run()
        self.assertNotEqual(a.id, b.id)
        self.assertEqual(a.initial, b.initial)
        self.assertEqual(a.config['physics_config'], b.config['physics_config'])
        self.assertEqual(a.config['environment']['lift_coefficient'], '-0.60*sin(2*alpha)')
        self.assertEqual(len(a.config['physics_engine_sha256']), 64)
        for payload in ({'command_sequence': 1, 'action': True}, {'command_sequence': 1, 'throttle': True, 'gimbal': 0}, {'command_sequence': 1, 'throttle': 2, 'gimbal': 0}, {'command_sequence': 1, 'throttle': 10**400, 'gimbal': 0}):
            with self.assertRaises(ValueError): a.queue(payload)


if __name__ == '__main__': unittest.main()
