# Presentations

Eight small reveal.js decks, each starting with one editable intro slide.
Folders are numbered `presentation-01` through `presentation-08`; rename them
as titles are decided. Keep them directly inside `slides/` so relative asset
paths continue to work.

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

The question section follows `presentation-01/exercise_answers/index.html`.
It includes the scalar least-squares derivation, both matrix OLS derivations,
the extrapolation and survey limitations, and all six practical fixes.
Jump to the questions with `#/question-one`, `#/question-two`, or
`#/question-three`. Additional explanation is included in speaker notes.

The slides use five-decimal coefficients for the age–exercise example to
match the written calculation. For ridge, both squared terms carry a factor
of one-half so the gradient and inverse formula use the same definition of
the regularisation parameter.

## Regression walkthrough in presentation-01

The 30 practical walkthrough slides follow the question answers. Jump straight
to them at
<http://127.0.0.1:8000/slides/presentation-01/#/regression-walkthrough>.
The notebook's fuller explanations are included as speaker notes (`S`).

`presentation-01/walkthrough.js` draws the plots with Chart.js and an SVG
correlation matrix. Hover over chart points and model bars for values.
Scatterplots use a fixed sample of 2,500 observations; residual plots use up to
2,000 training observations. Model errors, searches and binned residual means
are calculated using the full notebook splits. The model comparison chart
uses a logarithmic MSE axis so the final improvements remain visible.

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

Plots resize to the space between their headings and captions. Feature plots
share a slide in pairs, and each observation-order plot has its own slide.

To check every slide's bounds in the browser, including all fragments, open
<http://127.0.0.1:8000/slides/presentation-01/?check-layout>.
The status banner reports any slides that overflow. Detailed measurements,
including each chart's drawing area, are available as `window.slideLayoutReport`
in the browser console. The regular presentation has no audit banner.

## Export a PDF

1. Open the deck in Chrome or Chromium with `?print-pdf` before any hash:
   <http://127.0.0.1:8000/slides/presentation-01/?print-pdf>.
2. Wait for fonts and maths to finish rendering, then open Print.
3. Choose **Save as PDF**, **Landscape**, **Margins: None**, and enable
   **Background graphics**. Disable browser headers and footers.

The shared settings produce one page per slide, with incremental content
fully visible. See the [reveal.js PDF guide](https://revealjs.com/pdf-export/).

## Branch workflow

Keep these decks on the `slides` branch and merge `main` into it when you
want updated website assets. They stay off Pages while Pages publishes only
`main`; this folder does not itself enforce deployment exclusions. Decks
pushed to a public repository remain readable through GitHub.
