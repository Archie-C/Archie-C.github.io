"""Serializable, deterministic gust fields for expert-data generation."""
import math


def gust_field(profile):
    keys = {'base_x', 'base_y', 'amplitude_x', 'amplitude_y', 'period', 'phase', 'shear'}
    if (not isinstance(profile, dict) or set(profile) != keys
            or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in profile.values())
            or profile['period'] <= 0 or profile['amplitude_x'] < 0 or profile['amplitude_y'] < 0):
        raise ValueError('invalid smooth-gust wind profile')
    values = dict(profile)

    def wind(height, time):
        angle = 2*math.pi*time/values['period'] + values['phase']
        shear = values['shear'] * (1-math.exp(-max(height, 0.)/300))
        return (values['base_x'] + values['amplitude_x']*math.sin(angle) + shear,
                values['base_y'] + values['amplitude_y']*math.sin(.7*angle+.4))
    return wind
