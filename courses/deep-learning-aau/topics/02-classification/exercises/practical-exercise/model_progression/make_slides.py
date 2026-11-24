"""Render the classification progression deck from saved validation results."""
from html import escape
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[6]
DECK = ROOT / 'slides' / 'presentation-02' / 'index.html'
RESULTS = HERE / 'tuned_results' / 'results.json'

STEPS = [
    ('01_flight_split', 'Flight split'),
    ('02_class_weighted', 'Class weighting'),
    ('03_lbfgs', 'L-BFGS with L2'),
    ('04_constant_velocity', 'Constant velocity'),
    ('05_gravity', 'Gravity'),
    ('06_drag', 'Drag'),
    ('07_thrust', 'Thrust and gimbal'),
]
# The teaching progression requested for this deck ends at drag. Keep the
# additional experiment in the recorded summary, without adding its slides.
SLIDE_STEPS = STEPS[:6]


def result_chart(index, old_sim, new_sim):
    """Render the two landing measures on their own fixed scales."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="340" '
             'viewBox="0 0 400 340" role="img" aria-labelledby="title desc">',
             '<title id="title">Landing results before and after this change</title>',
             '<desc id="desc">Paired bars show successful landings out of ten and mean landing score out of one hundred. Before is grey; after is purple.</desc>',
             '<g font-family="sans-serif" fill="#15120B">']
    for y, color, label in [(15, '#6B6149', 'Before'), (15, '#6B2C5C', 'After')]:
        x = 28 if label == 'Before' else 215
        parts.append(f'<rect x="{x}" y="{y}" width="14" height="14" fill="{color}"/>'
                     f'<text x="{x+23}" y="{y+13}" font-size="19">{label}</text>')
    for title_y, key, label, maximum in [(75, 'successful_runs', 'Successful landings', 10),
                                         (225, 'mean_score', 'Mean landing score', 100)]:
        parts.append(f'<text x="28" y="{title_y}" font-size="20">{label}</text>')
        for j, (record, color) in enumerate([(old_sim, '#6B6149'), (new_sim, '#6B2C5C')]):
            value = record[key]
            y = title_y + 17 + j*38
            width = 252*value/maximum
            text_value = f'{value}/10' if maximum == 10 else f'{value:.1f}/100'
            parts.append(f'<rect x="28" y="{y}" width="252" height="22" fill="#DCD2BC" fill-opacity=".4"/>'
                         f'<rect x="28" y="{y}" width="{width:.3f}" height="22" fill="{color}"/>'
                         f'<text x="292" y="{y+17}" font-size="19">{text_value}</text>')
    parts.append('</g></svg>\n')
    (DECK.parent / 'assets' / f'result-{index}.svg').write_text(''.join(parts), encoding='utf-8')


def fmt(value):
    return f'{100*value:.1f}%'


def diff(after, before):
    return f'{100*(after-before):+.1f} pp'


def result_slide(index, before, after):
    old, new = before['validation_classification'], after['validation_classification']
    old_sim, new_sim = before['validation_simulations']['summary'], after['validation_simulations']['summary']
    rows = [
        ('Action accuracy', fmt(old['accuracy']), fmt(new['accuracy']), diff(new['accuracy'], old['accuracy'])),
        ('Action macro F1', fmt(old['macro_f1']), fmt(new['macro_f1']), diff(new['macro_f1'], old['macro_f1'])),
        ('Successful landings', f"{old_sim['successful_runs']}/10", f"{new_sim['successful_runs']}/10",
         f"{new_sim['successful_runs']-old_sim['successful_runs']:+d} flights"),
        ('Mean score', f"{old_sim['mean_score']:.1f}/100", f"{new_sim['mean_score']:.1f}/100",
         f"{new_sim['mean_score']-old_sim['mean_score']:+.1f} points"),
    ]
    table = ''.join('<tr>' + ''.join(f'<td>{escape(str(v))}</td>' for v in row) + '</tr>' for row in rows)
    note = ('We evaluate both controllers on the same labelled expert observations and the same ten validation initial states. '
            'Failed landings receive a score of zero. Macro F1 averages the action-level F1 scores, while landing success is measured in the simulations. '
            'Observations from the same flight are correlated, and ten flights give only a small sample of landing outcomes.')
    result_titles = tuple(title for _, title in STEPS)
    takeaways = (
        'Reusing training statistics lets the prediction depend on the current state.',
        'The landing count stays at 1/10 and mean score falls slightly. The new split assesses different flights and also changes the training rows.',
        'This example uses class weighting only. Macro F1 and landing success rise, while action accuracy falls. Balanced sampling is an alternative.',
        'Adding the projection features increases successful landings from 4/10 to 7/10.',
        'Including gravity increases successful landings from 7/10 to 8/10.',
        'Including drag increases successful landings from 8/10 to 9/10, while action accuracy and macro F1 fall slightly.',
    )
    result_chart(index, old_sim, new_sim)
    return f'''<section id="result-{index}"><p class="step-label">Step {index} · validation</p><h2>{result_titles[index-1]} results</h2>
      <div class="result-layout"><table class="results"><thead><tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>{table}</tbody></table>
      <figure><img src="./assets/result-{index}.svg" alt="Landing measures: before {old_sim['successful_runs']}/10 and {old_sim['mean_score']:.1f}/100; after {new_sim['successful_runs']}/10 and {new_sim['mean_score']:.1f}/100."/></figure></div>
      <p class="result-takeaway">{escape(takeaways[index-1])}</p>
      <p class="small">1,095 validation rows; ten starting states. Failures score 0. Values rounded; pp = percentage points.</p>
      <aside class="notes">{escape(note)}</aside></section>'''


def verify_teaching_assets():
    path = DECK.parent / 'assets/walkthrough-data.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    if data['source_results_sha256'] != hashlib.sha256(RESULTS.read_bytes()).hexdigest():
        raise ValueError('Results changed: rerun slides/presentation-02/prepare-walkthrough.py')
    for name, measured in data['models'].items():
        for filename, key in [(HERE / f'{name}.py', 'source_sha256'),
                              (HERE / 'tuned_results' / f'{name}.npz', 'weights_sha256')]:
            if hashlib.sha256(filename.read_bytes()).hexdigest() != measured[key]:
                raise ValueError(f'{filename.name} changed: regenerate teaching figures')


def main():
    data = json.loads(RESULTS.read_text(encoding='utf-8'))
    models = data['models']
    if not {step[0] for step in STEPS} <= set(models):
        raise ValueError('Run the complete tuning and validation before generating slides.')
    written_answers = (DECK.parent / 'written-answers.html').read_text(encoding='utf-8')
    practical = (DECK.parent / 'practical-walkthrough.html').read_text(encoding='utf-8')
    previous = models['01_flight_split']['original_single_observation_scaffold']
    for i, step in enumerate(SLIDE_STEPS, 1):
        marker = f'<!-- RESULT:{i} -->'
        if practical.count(marker) != 1:
            raise ValueError(f'Expected one {marker} in practical source')
        practical = practical.replace(marker, result_slide(i, previous, models[step[0]]))
        previous = models[step[0]]
    verify_teaching_assets()
    content = written_answers + '\n' + practical
    html = '''<!DOCTYPE html>
<html lang="en" data-palette="paper"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Classification exercise slides | Deep Learning</title>
<link rel="icon" href="../../design_system/assets/favicon.svg"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reset.css"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.css"/>
<link rel="stylesheet" href="../shared/theme.css"/>
<link rel="stylesheet" href="classification.css"/>
<script defer src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/notes/notes.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/math/math.js"></script>
<script defer src="../shared/presentation.js"></script>
<script defer src="classification.js"></script>
<script defer src="regularisation.js"></script></head>
<body><nav class="deck-nav" aria-label="Presentation sections"><a href="#/question-1-predictions">Written answers</a><a href="#/rocket-walkthrough">Practical exercise</a><a href="../../courses/deep-learning-aau/topics/02-classification/exercises/">Exercises &nearr;</a></nav><div class="reveal"><div class="slides">
<section class="title-slide"><p class="slide-kicker">Exercise 2 · classification</p>
<div class="title-content"><h1>Classification exercises</h1><p class="slide-subtitle">Written answers and practical exercise</p><p class="slide-presenter">Archie Carpenter</p></div>
<footer class="slide-footer"><span class="wordmark">a<span class="wordmark-dot">.</span>c</span></footer></section>
''' + content + '\n</div></div></body></html>\n'
    DECK.write_text(html, encoding='utf-8')
    print('Wrote', DECK)


if __name__ == '__main__':
    main()
