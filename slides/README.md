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
