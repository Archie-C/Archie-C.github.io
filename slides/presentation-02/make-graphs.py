"""Generate the illustrative written-answer graphs as standalone SVGs."""
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from scipy.optimize import minimize_scalar, minimize

OUT = Path(__file__).resolve().parent / 'assets'
OUT.mkdir(exist_ok=True)
INK, MUTED, PURPLE, GRID = '#15120B', '#6B6149', '#6B2C5C', '#DCD2BC'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 17,
                     'text.color': INK, 'axes.labelcolor': INK,
                     'xtick.color': MUTED, 'ytick.color': MUTED,
                     'svg.fonttype': 'none', 'svg.hashsalt': 'classification-q3'})


def axes(ylabel, ylim):
    fig, ax = plt.subplots(figsize=(11, 4.2), layout='constrained')
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')
    ax.set(xlim=(0, 6), ylim=ylim, xlabel='Scaling factor c', ylabel=ylabel)
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines[['left', 'bottom']].set_color(MUTED)
    ax.grid(axis='y', color=GRID, linewidth=1)
    ax.set_axisbelow(True)
    return fig, ax


# A concrete two-dimensional separator: z = x₂ − x₁.
fig, ax = plt.subplots(figsize=(11, 4.2), layout='constrained')
fig.patch.set_alpha(0)
ax.set_facecolor('none')
line_x = np.linspace(-2.7, 2.7, 100)
ax.fill_between(line_x, line_x, 3, color=PURPLE, alpha=.07)
ax.fill_between(line_x, -3, line_x, color=INK, alpha=.035)
ax.plot(line_x, line_x, color=PURPLE, linewidth=3, label='Decision boundary: z = 0')
class1 = np.array([[-2, .1], [-1.2, 1.1], [-.4, 1.6], [.4, 2.2], [1.1, 2.5]])
class0 = np.array([[-1.7, -2.5], [-.9, -1.7], [0, -1], [.9, -.7], [1.8, .5]])
assert np.all(class1[:, 1] - class1[:, 0] > 0)
assert np.all(class0[:, 1] - class0[:, 0] < 0)
ax.scatter(class1[:, 0], class1[:, 1], s=90, color=PURPLE, marker='o', label='Class 1: z > 0', zorder=3)
ax.scatter(class0[:, 0], class0[:, 1], s=90, color=INK, marker='x', linewidths=2.5, label='Class 0: z < 0', zorder=3)
ax.set(xlim=(-2.7, 2.7), ylim=(-3, 3), xlabel='Feature x₁', ylabel='Feature x₂')
ax.spines[['top', 'right']].set_visible(False)
ax.spines[['left', 'bottom']].set_color(MUTED)
ax.set_xticks([-2, -1, 0, 1, 2])
ax.set_yticks([-2, -1, 0, 1, 2])
ax.legend(frameon=True, facecolor='#F6F1E7', edgecolor='none', loc='lower right', fontsize=15)
fig.savefig(OUT / 'linear-separator.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

# Question 1: the normal vector and a parallel intercept shift.
fig, ax = plt.subplots(figsize=(11, 4.2), layout='constrained')
fig.patch.set_alpha(0)
ax.set_facecolor('none')
x = np.linspace(-4.5, 4.5, 100)
ax.fill_between(x, -2, (2*x-1)/3, color=PURPLE, alpha=.10)
ax.plot(x, (2*x-1)/3, color=PURPLE, linewidth=3, label='b = −1 (original)')
ax.plot(x, (2*x+2)/3, color=INK, linestyle='--', linewidth=2.5, label='b = +2')
start = np.array([1., 1/3])
normal = np.array([2., -3.])
tangent = np.array([3., 2.])
end = start + .3*normal
# Label the vector without a second, non-normal leader arrow.
ax.text(*(end + np.array([.15, -.10])), 'w = (2, −3)', fontsize=15, color=PURPLE)
ax.annotate('', xy=end, xytext=start,
            arrowprops=dict(arrowstyle='->', lw=2.5, color=PURPLE))
corner = start + .20*np.array([tangent, tangent+normal, normal])/np.sqrt(13)
ax.plot(corner[:, 0], corner[:, 1], color=PURPLE, linewidth=1.5)
shift = -3*normal/13
ax.annotate('', xy=start+shift, xytext=start, arrowprops=dict(arrowstyle='->', lw=2, color=INK))
ax.text(-4.2, -1.7, 'Class A: score > 0', color=PURPLE)
ax.text(-4.2, 2.0, 'Increasing b expands class A', fontsize=16)
ax.set(xlabel='Feature x₁', ylabel='Feature x₂', xlim=(-4.5, 4.5), ylim=(-2, 2.5))
# Equal data-unit scales preserve the right angle in the exported drawing.
ax.set_aspect('equal', adjustable='box')
ax.legend(loc='lower right', frameon=False, fontsize=14)
ax.spines[['top', 'right']].set_visible(False)
fig.savefig(OUT / 'boundary-shift.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

# Solve the actual one-dimensional regularisation counterexample.
sample_x, labels = np.array([-1., 1., 1.]), np.array([0., 1., 1.])
penalty_strength = .1
def objective(parameters):
    w, b = parameters
    z = w*sample_x+b
    error = 1/(1+np.exp(-z))-labels
    return (np.mean(np.logaddexp(0, z)-labels*z)+penalty_strength*w*w/2,
            np.array([np.mean(error*sample_x)+penalty_strength*w, error.mean()]))
fit = minimize(objective, [1., 0.], jac=True, method='BFGS', options={'gtol': 1e-10})
w, b = fit.x
boundary = -b/w
fig, ax = plt.subplots(figsize=(11, 3.7), layout='constrained')
fig.patch.set_alpha(0)
ax.set_facecolor('none')
ax.axhline(0, color=MUTED)
ax.scatter([-1], [0], color=INK, marker='x', s=140, linewidths=3, label='Class 0: one observation')
ax.scatter([1, 1], [-.13, .13], color=PURPLE, s=100, label='Class 1: two observations')
ax.axvline(0, color=INK, linestyle='--', label='Original boundary: 0')
ax.axvline(boundary, color=PURPLE, linewidth=3, label=f'Regularised boundary: {boundary:.3f}')
ax.set(xlim=(-1.6, 1.6), ylim=(-.7, 1.2), xlabel='Input x', yticks=[])
ax.text(-1.5, .85, f'λ = 0.1: fitted w = {w:.3f}, b = {b:.3f}', fontsize=17)
ax.text(.65, -.5, 'Same x; shown apart for visibility', fontsize=12)
ax.legend(loc='upper right', frameon=False, fontsize=13)
ax.spines[['top', 'right', 'left']].set_visible(False)
fig.savefig(OUT / 'regularised-boundary.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

# Show how scaling changes the sigmoid as a function of the original score.
z = np.linspace(-4, 4, 801)
fig, ax = plt.subplots(figsize=(11, 4.2), layout='constrained')
fig.patch.set_alpha(0)
ax.set_facecolor('none')
for scale, color, style in [(1, INK, '--'), (3, PURPLE, '-'), (10, '#A67012', ':')]:
    ax.plot(z, 1/(1+np.exp(-scale*z)), color=color, linestyle=style,
            linewidth=3, label=f'c = {scale}')
ax.axvline(0, color=MUTED, linewidth=1, linestyle=':')
ax.axhline(.5, color=MUTED, linewidth=1, linestyle=':')
ax.scatter([0], [.5], color=PURPLE, s=45, zorder=5)
ax.set(xlabel='Original score z', ylabel='Probability of class 1',
       xlim=(-4, 4), ylim=(-.04, 1.04), yticks=[0, .25, .5, .75, 1])
ax.spines[['top', 'right']].set_visible(False)
ax.spines[['left', 'bottom']].set_color(MUTED)
ax.grid(axis='y', color=GRID, linewidth=1)
ax.set_axisbelow(True)
ax.legend(frameon=False, loc='upper left', fontsize=16)
fig.savefig(OUT / 'scaled-sigmoid.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

c = np.linspace(0, 6, 301)
fig, ax = axes('Probability of class 1', (-.04, 1.04))
ax.plot(c, 1/(1+np.exp(-c)), color=PURPLE, linewidth=3.5, label='Positive example: z = 1')
ax.plot(c, 1/(1+np.exp(c)), color=INK, linewidth=3, linestyle='--', label='Negative example: z = −1')
ax.axhline(.5, color=MUTED, linewidth=1, linestyle=':')
ax.set_yticks([0, .25, .5, .75, 1])
ax.legend(frameon=False, loc='center right', fontsize=16)
fig.savefig(OUT / 'probabilities.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

margins = np.array([.5, 1., 2.])
loss = np.logaddexp(0, -c[:, None]*margins).mean(axis=1)
fig, ax = axes('Mean cross-entropy', (0, .76))
ax.plot(c, loss, color=PURPLE, linewidth=3.5)
ax.annotate('Approaches 0', (5.2, loss[260]), xytext=(3.3, .23), color=PURPLE,
            arrowprops=dict(arrowstyle='->', color=PURPLE, lw=1.5))
fig.savefig(OUT / 'cross-entropy.svg', transparent=True, metadata={'Date': None})
plt.close(fig)

penalty = .05*c*c
objective = loss + penalty
optimum = minimize_scalar(lambda t: np.logaddexp(0, -t*margins).mean() + .05*t*t,
                          bounds=(0, 6), method='bounded')
fig, ax = axes('Loss / penalty', (0, 2.0))
ax.plot(c, objective, color=PURPLE, linewidth=3.5, label='Total objective')
ax.plot(c, loss, color=INK, linewidth=2.5, linestyle='--', label='Cross-entropy')
ax.plot(c, penalty, color=MUTED, linewidth=2.5, linestyle=':', label='L2 penalty')
ax.scatter([optimum.x], [optimum.fun], s=70, color=PURPLE, zorder=5)
ax.annotate('Finite minimum', (optimum.x, optimum.fun), xytext=(2.6, .88), color=PURPLE,
            arrowprops=dict(arrowstyle='->', color=PURPLE, lw=1.5))
ax.legend(frameon=False, loc='upper left', fontsize=15)
fig.savefig(OUT / 'regularisation.svg', transparent=True, metadata={'Date': None})
plt.close(fig)
