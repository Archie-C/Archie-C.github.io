"""Worked projection figures and force schematics for the practical slides.

Called by prepare-walkthrough.py. All model samples use the actual feature
helpers; the longer contact illustration is explicitly separate from them.
"""
import numpy as np


def force_schematic(kind):
    opening = '''<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="360" viewBox="0 0 1100 360" role="img" aria-labelledby="title desc">
<title id="title">%s</title><desc id="desc">%s</desc>
<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#6B2C5C"/></marker><marker id="dark" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#15120B"/></marker></defs>
<g font-family="sans-serif" font-size="22" fill="#15120B">
<path d="M400 315 L400 85 L425 30 L450 85 L450 315 Z" fill="#6B2C5C" fill-opacity=".08" stroke="#6B2C5C" stroke-width="3"/>
<path d="M400 315 L382 333 M450 315 L468 333" stroke="#15120B" stroke-width="3"/>
<circle cx="425" cy="200" r="7"/>
<path d="M425 200 L485 200" stroke="#15120B" stroke-width="2"/><text x="500" y="205">Centre of mass</text>
'''
    titles = {
        'constant-velocity': ('Constant-velocity approximation', 'Vertical and angular velocity stay constant; forces and torques are omitted.'),
        'gravity': ('Gravity projection', 'Gravity acts downward through the centre of mass; no torque is included.'),
        'drag': ('Gravity and drag projection', 'Drag acts at a pressure point away from the centre of mass and can produce torque; gravity acts through the centre.'),
    }
    svg = opening % titles[kind]
    if kind == 'constant-velocity':
        svg += '''<path d="M285 160 L285 290" stroke="#6B2C5C" stroke-width="4" marker-end="url(#arrow)"/>
<text x="75" y="125">Vertical velocity</text><text x="75" y="153" font-size="18" fill="#6B6149">Constant in this example</text>
<path d="M365 94 C335 25 505 10 495 93" fill="none" stroke="#6B2C5C" stroke-width="3" marker-end="url(#arrow)"/>
<text x="550" y="75">Angular velocity stays constant</text>
<text x="550" y="108" font-size="18" fill="#6B6149">The tilt can still change</text>
<text x="550" y="275">a = 0, α = 0</text>
<text x="550" y="308" font-size="18" fill="#6B6149">Forces omitted from this projection</text>'''
    else:
        svg += '''<path d="M425 200 L425 285" stroke="#15120B" stroke-width="3" marker-end="url(#dark)"/>
<text x="550" y="282">Gravity: mg downward</text><text x="550" y="313" font-size="18" fill="#6B6149">Acts through centre of mass</text>'''
        if kind == 'gravity':
            svg += '''<text x="550" y="78">Vertical acceleration: −g</text>
<text x="550" y="113">Angular acceleration: 0</text>
<text x="70" y="110" font-size="18" fill="#6B6149">Drag and thrust omitted</text>'''
        else:
            svg += '''<circle cx="425" cy="112" r="5" fill="#6B2C5C"/>
<path d="M425 112 L270 112" stroke="#6B2C5C" stroke-width="4" marker-end="url(#arrow)"/>
<text x="60" y="57">Aerodynamic drag</text><text x="60" y="85" font-size="18" fill="#6B6149">Applied at pressure point</text>
<path d="M473 192 L473 118" stroke="#6B2C5C" stroke-width="2" marker-end="url(#arrow)"/>
<text x="500" y="120">Lever arm r</text><text x="500" y="150" font-size="18" fill="#6B6149">From centre of mass to pressure point</text>
<text x="70" y="280" font-size="18" fill="#6B6149">Engine thrust omitted</text>'''
    return svg + '<text x="720" y="345" font-size="16" fill="#6B6149">Schematic; arrows are illustrative</text></g></svg>\n'


def build_figures(out, data, controller, figure, save):
    for kind in ['constant-velocity', 'gravity', 'drag']:
        (out / f'forces-{kind}.svg').write_text(force_schematic(kind), encoding='utf-8')

    # Continue the simple equations to contact for an illustration. The feature
    # helper stops after 3 s; its actual samples are marked separately below.
    observation = np.array([[-10, 100, 3, -20, .10, -.02, 10000, 0, 0, 0, 0, 1.225]])
    fuel = observation[0, 6]
    centre = (28000*23 + fuel*(5 + 39*fuel/411000/2))/(28000+fuel)
    points = np.array([[-1.83,1.60],[1.83,1.60],[1.83,43.60],
                       [1.65,45.20],[1.65,48.768],[-1.65,48.768],
                       [-1.65,45.20],[-1.83,43.60],[-9,0],[9,0]])

    def clearance(t):
        h, theta = 100-20*t, .10-.02*t
        return h + np.min(np.sin(theta)*points[:, 0] + np.cos(theta)*(points[:, 1]-centre))

    lo, hi = 0., 5.
    for _ in range(60):
        mid = (lo+hi)/2
        if clearance(mid) > 0:
            lo = mid
        else:
            hi = mid
    contact = (lo+hi)/2
    assert 3 < contact < 5
    contact_values = {'time': contact, 'x': -10+3*contact, 'h': 100-20*contact,
                      'theta': .10-.02*contact, 'vx': 3, 'vy': -20, 'omega': -.02}
    data['constant_velocity_contact_illustration'] = {
        'observation': observation[0].tolist(), 'contact': contact_values,
        'note': 'Illustration extends to contact; trained features sample only up to 3 s.'}
    fig, axs = figure(1, 2, 4)
    ax, angle_ax = axs[0]
    for start, stop, style in [(0, 3, '-'), (3, contact, '--')]:
        t = np.linspace(start, stop, 100)
        ax.plot(-10+3*t, 100-20*t, color='#6B2C5C', linestyle=style, linewidth=2.5)
        angle_ax.plot(t, np.degrees(.10-.02*t), color='#6B2C5C', linestyle=style, linewidth=2.5)
    samples = controller('04_constant_velocity')._basis(observation)[0, 12:].reshape(3, 4)
    for t, values in zip([1, 2, 3], samples):
        ax.scatter(-10+3*t, values[0], color='#6B2C5C', s=55, zorder=4)
        ax.annotate(f'{t} s', (-10+3*t, values[0]), xytext=(9, 4), textcoords='offset points', fontsize=12)
        angle_ax.scatter(t, np.degrees(values[2]), color='#6B2C5C', s=55, zorder=4)
    ax.axhline(0, color='#6B6149', linewidth=1)
    ax.scatter(contact_values['x'], contact_values['h'], s=90, marker='x', color='#15120B', zorder=5)
    ax.annotate(f'Contact at {contact:.2f} s\nCOM x = {contact_values["x"]:.1f} m\nCOM height = {contact_values["h"]:.1f} m',
                (contact_values['x'], contact_values['h']), xytext=(12, 35), textcoords='offset points', fontsize=12)
    ax.set(xlabel='Horizontal position x (m)', ylabel='COM height h (m)', xlim=(-13, 15), ylim=(-5, 110))
    angle_ax.scatter(contact, np.degrees(contact_values['theta']), s=90, marker='x', color='#15120B', zorder=5)
    angle_ax.text(.04, .04, f'At contact: tilt = {np.degrees(contact_values["theta"]):.2f}°\n'
                  'vₓ = 3 m/s, vᵧ = −20 m/s\nω = −0.02 rad/s',
                  transform=angle_ax.transAxes, fontsize=12, bbox={'facecolor': '#F6F0E2', 'edgecolor': 'none', 'pad': 6})
    angle_ax.set(xlabel='Projection time (s)', ylabel='Tilt angle (degrees)', xlim=(0, 4.4), ylim=(0, 6.5))
    save(fig, 'constant-velocity-contact.svg')

    # Compare exactly the values constructed by the gravity and drag helpers.
    observation = np.array([[0, 300, 15, -60, .35, -.03, 10000, 0, 0, 0, 0, 1.225]])
    projections = {name: controller(name)._basis(observation)[0, 12:].reshape(3, 4)
                   for name in ['05_gravity', '06_drag']}
    data['drag_projection_example'] = {'observation': observation[0].tolist(), 'horizons': [1, 2, 3],
                                     'features': {n: v.tolist() for n, v in projections.items()}}
    fig, axs = figure(1, 2, 4)
    for name, label, color in [('05_gravity', 'Gravity', '#6B6149'),
                               ('06_drag', 'Gravity + drag', '#6B2C5C')]:
        v = projections[name]
        axs[0, 0].plot([0, 1, 2, 3], [300, *v[:, 0]], 'o-', color=color, label=label, linewidth=2.5)
        axs[0, 1].plot([0, 1, 2, 3], np.degrees([.35, *v[:, 2]]), 'o-', color=color, label=label, linewidth=2.5)
    for ax in axs.flat:
        ax.set(xlabel='Projection horizon (s)', xticks=[0, 1, 2, 3])
        ax.legend(frameon=False, fontsize=12)
    axs[0, 0].set_ylabel('Projected COM height (m)')
    axs[0, 1].set_ylabel('Projected tilt (degrees)')
    save(fig, 'drag-projection.svg')
