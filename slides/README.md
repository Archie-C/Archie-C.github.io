# Presentations

The completed regression exercise deck is edited in `presentation-01/`.
`presentation-02/` through `presentation-08/` are intro-only templates and are
not listed in the course navigation. Keep source decks directly inside
`slides/` so relative asset paths continue to work.

## Course access and standalone HTML

The [regression slides page](../courses/deep-learning-aau/topics/01-regression/slides/)
links to the completed presentation, section jumps, PDF printing, and an HTML
download. It is linked from the course syllabus, regression topic, notes,
exercises, and written answers.

Generate its [standalone HTML](../courses/deep-learning-aau/topics/01-regression/slides/regression-exercises.html)
after editing the source deck, shared styles/scripts, or walkthrough data:

```bash
python3 slides/export-standalone.py
python3 slides/export-standalone.py --check
```

The export embeds local CSS, JavaScript, the favicon, and chart data. Scripts
retain their execution order, and charts read the embedded JSON when present.
The HTML opens directly from disk without an HTTP server. reveal.js, Chart.js,
KaTeX, and web fonts still load from their existing CDNs, so internet access is
required. Hosted course links stay relative. Downloaded files link back to
`https://archie-c.github.io/`; pass `--site-url` to export for a different
website base URL. Edit the source rather than the export.

The presentation's navigation links back to course slides, exercises, and
written answers. The “Jump to” menu opens each written question or the practical
walkthrough. Navigation is hidden in PDF exports.

## Shared design

- `shared/theme.css` imports the website's `design_system/colors_and_type.css`
  using `../../design_system/colors_and_type.css` relative to the stylesheet,
  then adds presentation typography and layouts.
- `shared/presentation.js` configures a 1280 × 720 canvas, keyboard navigation,
  speaker notes, KaTeX maths, and PDF export behaviour.
- Each deck selects the website's Paper palette with `data-palette="paper"`.
  Colours and fonts follow changes to the shared design system automatically.

reveal.js 5.2.1 and its plugins load from jsDelivr. Fonts load through the
existing design system, and KaTeX loads from its CDN. An internet connection
is required for a fresh load; there is no npm install or build step.

## Preview

Run from the repository root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/slides/presentation-01/> and substitute `02`–`08`
for the other presentations. Use the arrow keys to navigate, `F` for
fullscreen, `Esc` for the overview, and `S` for speaker notes.

## Edit a presentation

Edit its `index.html`: replace the title, subtitle, and presenter text.
Add one sibling `<section>` inside `.slides` for each new slide:

```html
<section aria-labelledby="question-title">
  <h2 id="question-title">An opening question</h2>
  <p>Add the idea you want to explain.</p>
  <aside class="notes">Notes for the presenter.</aside>
</section>
```

Use `$...$` for inline maths and `$$...$$` for display maths. Put images next
to the deck or in a new `assets/` subfolder and reference them with relative
paths.

## Written answers in presentation-01

The question section follows the [regression exercise answers](../courses/deep-learning-aau/topics/01-regression/exercises/answers/).
The former `presentation-01/exercise_answers/index.html` URL redirects there.
It includes the scalar least-squares derivation, both matrix OLS derivations,
the extrapolation and survey limitations, and all six practical fixes.
Jump to the questions with `#/question-one`, `#/question-two`, or
`#/question-three`. Additional explanation is included in speaker notes.

The slides use five-decimal coefficients for the age–exercise example to
match the written calculation. For ridge, both squared terms carry a factor
of one-half so the gradient and inverse formula use the same definition of
the regularisation parameter.

## Regression walkthrough in presentation-01

The 31 practical walkthrough slides follow the question answers. Jump straight
to them at
<http://127.0.0.1:8000/slides/presentation-01/#/regression-walkthrough>.
The notebook's fuller explanations are included as speaker notes (`S`).

`presentation-01/walkthrough.js` draws the plots with Chart.js and an SVG
correlation matrix. Hover over chart points and model bars for values.
Scatterplots use a fixed sample of up to 2,500 training observations; residual
plots use up to 2,000 training observations. Model errors, searches and binned
means use the full notebook splits. The summary and final removal comparison
use logarithmic MSE axes so the final improvements remain visible.

Comparison figures stay together: all seven original feature plots, all six
highly correlated pairs, all six scaled differences, the three interaction
diagnostics, both delay-search curves, both delay residuals, and all seven
regional feature diagnostics. Target and residual scales are shared where the
quantities are comparable. The binned residual panel explicitly labels its
zoomed vertical scale.

The delay explanation includes an input matrix aligned with its target, a
coloured numerical example, the 13-column design matrix and a validation-boundary
example. These tables are native HTML; their values come from the notebook's
worked example. The scale comparison shows both tuned scales alongside every
matched square-and-region branch. The notebook's 44 recorded candidates remain
in the exported data, with 14 main experiments shown on the summary slide.

The CSV and downloadable notebook remain in `presentation-01/exercise_answers/`.
After editing the notebook or CSV, regenerate the chart data with the same
Python environment used for the notebook:

```bash
python slides/presentation-01/prepare-walkthrough.py
```

This runs the notebook's code without changing the notebook and updates
`presentation-01/assets/regression-walkthrough.json`. Python fits the models;
JavaScript renders the resulting data. The deck needs no Python at viewing time.
Wait for the charts to load before printing.

Plots resize to the space between their headings and captions. Six-panel and
eight-panel grids use smaller axis labels and fixed grid tracks; the three
observation-order plots share one slide.

To check every slide's bounds in the browser, including all fragments, open
<http://127.0.0.1:8000/slides/presentation-01/?check-layout>.
The status banner reports slides that overflow and chart areas that need more
space. Detailed measurements, including text overflow and every chart's drawing
area, are available as `window.slideLayoutReport` in the browser console. The
regular presentation has no audit banner.

## Export a PDF

1. Open the deck in Chrome or Chromium with `?print-pdf` before any hash:
   <http://127.0.0.1:8000/slides/presentation-01/?print-pdf>.
2. Wait for fonts and maths to finish rendering, then open Print.
3. Choose **Save as PDF**, **Landscape**, **Margins: None**, and enable
   **Background graphics**. Disable browser headers and footers.

The shared settings produce one page per slide, with incremental content
fully visible. See the [reveal.js PDF guide](https://revealjs.com/pdf-export/).

## Branch workflow

The completed HTML export lives with the regression course materials. Include
the generated file when publishing the course, and regenerate it after source
changes. Only completed decks should be added to the course navigation; the
remaining numbered source folders are templates.
