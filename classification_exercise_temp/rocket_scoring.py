"""Versioned first-contact scoring and reproducible evaluation summaries."""
from dataclasses import asdict, dataclass
from math import hypot, isfinite, pi

from rocket_physics import ground_height, mass_properties, relative_point


@dataclass(frozen=True)
class ScoringConfig:
    version: str = 'touchdown-v1.0'
    pad_left: float = -42.672
    pad_right: float = 42.672
    pad_height: float = 0.0
    max_descent: float = 3.0
    max_horizontal_speed: float = 1.5
    max_tilt: float = pi / 45
    max_angular_rate: float = pi / 90
    d_ref: float = 33.672
    weights: tuple = (0.30, 0.15, 0.20, 0.15, 0.20)

    def __post_init__(self):
        if not self.version or not all(isfinite(v) for v in (self.pad_left, self.pad_right, self.pad_height, self.max_descent, self.max_horizontal_speed, self.max_tilt, self.max_angular_rate, self.d_ref, *self.weights)) or self.pad_left >= self.pad_right or min(self.max_descent, self.max_horizontal_speed, self.max_tilt, self.max_angular_rate, self.d_ref) <= 0 or len(self.weights) != 5 or any(w < 0 for w in self.weights) or abs(sum(self.weights) - 1) > 1e-12:
            raise ValueError('invalid scoring configuration')
        # Version identifiers must never silently describe different rules.
        defaults = type(self).__dataclass_fields__
        if self.version == 'touchdown-v1.0' and any(getattr(self, name) != field.default for name, field in defaults.items()):
            raise ValueError('changing scoring rules requires a new version')


CONFIG = ScoringConfig()


def score_contact(contact, p, config=CONFIG):
    """Score an authoritative Contact; null diagnostics represent unavailable data."""
    result = dict(success=False, reasons=[], contact_time=None, surface=None,
                  first_geometry=None, feet=None, midpoint_offset=None,
                  vx=None, vy=None, theta=None, omega=None, foot_velocity=None,
                  errors=None, score=0.0)
    reasons = result['reasons']
    if contact is None:
        reasons.append('no contact')
        return result
    s = contact.state
    result.update(contact_time=contact.time, vx=s.vx, vy=s.vy, theta=s.theta, omega=s.omega)
    try:
        if (len(p.feet) != 2 or not all(isfinite(v) for v in (*s.values(), contact.time, *contact.point))
                or not 0 <= s.fuel <= p.fuel_capacity):
            raise ValueError('invalid contact state or feet')
        _, centre, _ = mass_properties(s.fuel, p)
        def transform(point):
            x, y = relative_point(point, centre, s.theta)
            return (s.x + x, s.y + y)
        feet = [transform(point) for point in p.feet]
        hull = [transform(point) for point in p.hull]
        if not all(isfinite(v) for point in feet + hull for v in point):
            raise ValueError('invalid transformed geometry')
        # Include terrain corners under hull edges, just as physics clearance does.
        hull_points = hull[:]
        for a, b in zip(hull, hull[1:] + hull[:1]):
            if a[0] != b[0]:
                for x, _ in p.terrain:
                    u = (x - a[0]) / (b[0] - a[0])
                    if 0 < u < 1:
                        hull_points.append((x, a[1] + u * (b[1] - a[1])))
        foot_gaps = [y - ground_height(x, p.terrain) for x, y in feet]
        hull_gap = min(y - ground_height(x, p.terrain) for x, y in hull_points)
        distances = [hypot(x-contact.point[0], y-contact.point[1]) for x, y in feet]
        first = min(range(2), key=distances.__getitem__)
        # The physics event locator stops on the safe side of contact; its
        # returned point is nonetheless exactly one of the clearance candidates.
        foot_first = distances[first] < 1e-7 and hull_gap > min(foot_gaps) + 1e-9
        result['first_geometry'] = f'foot {first + 1}' if foot_first else 'hull or invalid'
        on_pad = (config.pad_left <= contact.point[0] <= config.pad_right and
                  abs(ground_height(contact.point[0], p.terrain) - config.pad_height) < 1e-7)
        result['surface'] = 'concrete' if on_pad else 'other terrain'
        result['feet'] = feet
        result['midpoint_offset'] = (feet[0][0] + feet[1][0]) / 2 - (config.pad_left + config.pad_right) / 2
        if foot_first:
            rx, ry = feet[first][0] - s.x, feet[first][1] - s.y
            result['foot_velocity'] = (s.vx - s.omega * ry, s.vy + s.omega * rx)
        if not on_pad: reasons.append('contact outside concrete pad')
        if not foot_first: reasons.append('hull or invalid first contact')
        if not all(config.pad_left <= x <= config.pad_right for x, _ in feet): reasons.append('foot outside concrete pad')
        if not -config.max_descent <= s.vy <= 0: reasons.append('vertical velocity outside limits')
        if abs(s.vx) > config.max_horizontal_speed: reasons.append('horizontal velocity outside limits')
        if abs(s.theta) > config.max_tilt: reasons.append('tilt outside limits')
        if abs(s.omega) > config.max_angular_rate: reasons.append('angular velocity outside limits')
        errors = [min(1., abs(value) / limit) for value, limit in (
            (s.vy, config.max_descent), (s.vx, config.max_horizontal_speed),
            (s.theta, config.max_tilt), (s.omega, config.max_angular_rate),
            (result['midpoint_offset'], config.d_ref))]
        result['errors'] = dict(zip(('vertical', 'horizontal', 'tilt', 'angular_rate', 'centre'), errors))
        if not reasons:
            result['success'] = True
            result['score'] = max(0., min(100., 100 * (1 - sum(w * e * e for w, e in zip(config.weights, errors)))))
    except (ValueError, TypeError, OverflowError, IndexError):
        reasons.append('invalid geometry or contact state')
    return result


def aggregate(results):
    if not results:
        raise ValueError('evaluation requires at least one run')
    successes = [r['score'] for r in results if r['success']]
    return dict(total_runs=len(results), successful_runs=len(successes),
                success_rate=len(successes) / len(results),
                mean_successful_quality=sum(successes) / len(successes) if successes else None,
                mean_score=sum(r['score'] for r in results) / len(results))
