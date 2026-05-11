# Archie Carpenter — Design System

A personal design system for Archie Carpenter (A.C.), a researcher and teacher in
machine learning and mathematics. The system is geared toward producing
research-oriented surfaces: a personal website, blog, paper landing pages,
course / lecture notes, and conference slides.

> "I'm Archie. I research how neural networks learn the things they learn, and
> I teach maths and ML to anyone who'll listen."

---

## Sources

This system was created from scratch — there were **no attached materials**
(no codebase, no Figma, no existing brand assets). Direction was set by a
short brief from Archie:

- Technical aesthetic — mono headlines + sans body.
- Curious, warm, first-person tone.
- No emoji. No Comic Sans.
- KaTeX-rendered math + clean code blocks should be prominent citizens.
- Reference admired: the Anthropic docs (warm paper, generous whitespace,
  careful typography, technical-but-friendly).
- Sport was deliberately left out — keep the brand academic / professional.
- "Explore a few directions" — so the palette ships with three named modes
  (Paper, Slate, Mono) so Archie can pick the one that feels right.

This file is the entry point. The full **Index** is at the bottom.

---

## Brand kernel

| Field | Value |
| --- | --- |
| Name | Archie Carpenter |
| Initials / monogram | `a.c` (lowercase, monospaced, with a deliberate period) |
| Role | ML & maths researcher · teacher · writer |
| First-person voice | yes — "I research…", not "Archie researches…" |
| Discipline | machine learning, applied maths, optimisation |
| Audience | other researchers, students, curious technical readers |

---

## Content fundamentals

How copy should sound across every surface.

### Voice — curious, warm, precise

I am explaining something I find genuinely interesting to a clever person who
just hasn't read this paper yet. Not lecturing. Not dumbing down. Not flexing.
The reader is a peer.

- **Curious over assertive.** Lead with the question, then the answer.
  "Why do wider networks generalise better than the maths suggests they should?"
  is better than "Wider networks generalise better."
- **Warm but disciplined.** No hedge-words for their own sake ("perhaps,
  arguably, one might say"). Warmth comes from rhythm and specifics, not from
  softeners.
- **Concrete over abstract.** Name the dataset. Cite the figure. Show the
  equation. Avoid "innovative", "cutting-edge", "leverage", "robust".

### Person & address

- **First person singular** everywhere I am speaking — "I find", "I built",
  "I think". Not the royal "we".
- **First person plural** only inside a paper, where it conventionally refers
  to the authors collectively.
- **Reader as "you"** in teaching / blog contexts — "you'll notice that…",
  "if you've seen the chain rule before…".

### Casing

- **Sentence case everywhere.** Titles, headings, buttons, nav items.
  "Talks and writing", not "Talks And Writing".
- **Lowercase is allowed and encouraged for the wordmark and short
  navigation labels** — it pairs with the mono typeface and reads softer.
  `a.c`, `home`, `papers`, `notes`, `talks`.
- Proper nouns keep their case. "PyTorch", "ImageNet", "ICLR".
- Acronyms in body copy are uppercase ("ML", "SGD"), not small-caps.

### Numbers, units, math

- SI units, thin space between number and unit: `12 ms`, `3.4 GB`.
- Use real math symbols, not ASCII fakes: `≈`, `→`, `×`, `²`, `½`, `–` (en
  dash for ranges), `—` (em dash for asides).
- Inline math: `$f(x) = Wx + b$` rendered with KaTeX.
- Display math gets its own line, centered, with a right-aligned equation
  number when referenced.
- Variables are italic (KaTeX default). Operator names (`sin`, `log`, `argmax`)
  are upright.

### Things I never say

- "Innovative", "cutting-edge", "world-class", "leverage", "synergy",
  "transformative", "revolutionise", "passionate about", "pushing the
  boundaries", "thought leader".
- "Ground-breaking" results. I have *results*.
- Hype words for ML in particular: "AI-powered", "neural-powered", "the
  AI revolution".

### Voice — examples

| Don't | Do |
| --- | --- |
| "Innovative research at the cutting edge of AI." | "I work on why neural networks learn what they do." |
| "We are passionate about pushing the boundaries of ML." | "I'm curious about a few specific things. Here they are." |
| "Click here to learn more." | "Read the paper" / "See the derivation". |
| "Our state-of-the-art model achieves…" | "On CIFAR-10 we hit 96.2 % — a 1.4-point gain over the baseline." |
| "Welcome to my website!" | "I'm Archie. I research and teach machine learning." |

### Emoji & decoration

**No emoji.** Anywhere. Not in headings, not in lists, not in social posts.
Decoration comes from typography, rules, and the occasional small-cap label.

Unicode glyphs that *are* allowed because they're functional, not
decorative: `→ ← ↑ ↓ · • § ¶ † ‡ ≈ ≤ ≥ ± ×`.

---

## Visual foundations

### Atmosphere

Warm, paper-like, slightly under-saturated. The background is never pure
white. The brand reads as *quiet confidence* — the visual equivalent of a
researcher who's done the work and doesn't need to shout about it.

Reference adjacency: the Anthropic docs, Distill.pub, Gwern, late-period
Edward Tufte. Generous margins, careful rules, math and code treated as
first-class content.

### Three palette directions

The system ships with **three named palettes** so Archie can pick the one
that feels right. The semantic CSS variables (`--fg`, `--bg`, `--accent`)
are the same across all three — only the values change.

| Palette | Background | Ink | Accent | Mood |
| --- | --- | --- | --- | --- |
| **Paper** (default) | `#FAF7F2` warm cream | `#1A1814` warm near-black | `#C7522A` terracotta | Anthropic-adjacent, academic warmth |
| **Slate** | `#F4F4F1` cool paper | `#15171C` blue-black | `#2A5FB0` ink blue | Cooler, more clinical, journal-feel |
| **Mono** | `#FFFFFF` true white | `#000000` true black | `#C8102E` single red | High contrast, Swiss, fewer choices |

Dark mode flips the surface to a deep warm graphite (`#14131A` for Paper,
`#0E1014` for Slate, `#000000` for Mono) and lifts the accent slightly.

### Type

- **Display & headlines — JetBrains Mono.** Variable weight, used in
  `weight 500` for headings, `weight 700` for hero headlines. Always
  set tight: `letter-spacing: -0.01em`, `line-height: 1.15`.
- **Body — Inter.** Variable, used at `weight 400` for body and `500`
  for emphasis. `line-height: 1.6` for prose; `1.5` for UI.
- **Long-form reading & quotes — Source Serif 4.** Used inside the blog,
  paper abstracts, and pull-quotes. Optical size enabled.
- **Math — KaTeX default** (Computer Modern / KaTeX_Main). Black, never
  coloured.

Type scale is a modular 1.200 (minor third), anchored at 16 px body. See
[`colors_and_type.css`](./colors_and_type.css) for the full token set and
[`preview/type-scale.html`](./preview/type-scale.html) for the specimen.

### Spacing & rhythm

A 4 px base unit. Tokens `--space-1` through `--space-12` map to
4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px. Vertical rhythm in long-form
content is one body line-height (~26 px) — paragraphs are separated by
a full line, never by an indent.

### Backgrounds

- **No gradients** as decoration. The only gradients allowed are
  *protection gradients* — a 64-px fade from `var(--bg)` at the top of a
  scroll region so sticky nav doesn't look harsh.
- **No full-bleed photography** as hero background. The brand is text-first.
  Imagery, when it appears, is a contained figure with a caption.
- **Subtle paper texture is optional** on the Paper palette — a 4-5 %
  noise layer (`background-image: url('assets/paper-noise.svg')`) on the
  body. Off by default; on for paper landing pages.
- Section breaks are a thin rule (`1px solid var(--rule)`) and one line
  of `--space-6` whitespace above and below. No decorative dividers.

### Animation

Quiet. The brand should not feel like it's selling itself.

- **Durations:** 120 ms for hover state changes, 200 ms for menu / modal
  reveals, 320 ms for page-level transitions. Nothing slower.
- **Easing:** a single `cubic-bezier(0.2, 0, 0, 1)` (sharp out, soft
  in — "tap and settle"). No bounces, no overshoots, no springy
  animations.
- **Page transitions:** a 200 ms cross-fade only. No slide, no scale.
- **Scroll-triggered animation:** off. Content is fully visible at
  load. Exception: progressive math typesetting is fine.
- `prefers-reduced-motion: reduce` zeroes every animation, including
  the cross-fade.

### Interaction states

- **Hover (links & text buttons):** the link colour darkens by ~10 %
  and an underline thickens from `1px` to `2px` (using `text-decoration-thickness`).
- **Hover (filled buttons):** the background lifts to a marginally
  lighter / darker shade; no shadow change.
- **Press (everything):** scale down to `0.98` with the easing above
  — barely perceptible, but there.
- **Focus:** a 2-px solid `var(--accent)` ring with a 2-px offset.
  Never removed.
- **Disabled:** 40 % opacity, no pointer events.

### Borders, corners, shadows

- **Corner radii are restrained.** Tokens: `--radius-0` (0 px, default
  for tables, dividers, code blocks), `--radius-sm` (4 px, fields,
  small buttons), `--radius-md` (8 px, cards), `--radius-lg` (12 px,
  modals, hero callouts). Never larger than 12 px.
- **Borders are 1 px**, in `var(--rule)`. Never thicker.
- **Shadow system is two-tier.** `--shadow-1` is a single-pixel
  hairline shadow used for sticky headers
  (`0 1px 0 var(--rule)`). `--shadow-2` is a soft drop for modals and
  popovers (`0 8px 24px -8px rgba(20, 19, 14, 0.18)`). No other shadows.
- Cards on the canvas are bordered (1 px rule), not shadowed.

### Layout

- Reading column is **64 ch** for long-form, never wider.
- Outer page max is **1180 px**. UI shells go edge-to-edge at any width.
- A 12-column grid is available for landing pages but most surfaces
  use a 2- or 3-column layout that collapses to one on mobile.
- The personal site uses an **asymmetric grid** — a narrow left
  navigation rail (`200 px`) and a wide content column. This is the
  signature layout move of the brand.

### Transparency & blur

- **No backdrop-blur on regular UI.** It is reserved for the optional
  paper-noise overlay and for image lightboxes only.
- Translucent surfaces (e.g. a sticky nav over scrolling content)
  use `var(--bg-translucent)` — the base background at 88 % opacity
  — *not* a blur.

### Imagery treatment

When photography or screenshots appear:

- **Warm side.** No cool / blue casts. Photos go through a light warm
  filter (`filter: sepia(0.04) saturate(0.95)`) so they sit on the
  paper background without fighting it.
- **No drop shadows.** Images sit in a 1-px rule frame.
- **Captions are required.** Set in Inter `0.875 rem`, `var(--fg-2)`,
  with an em-dash separating the label from the description.

---

## Iconography

The brand is **type-first**. Iconography is restrained.

- **Icon library: [Lucide](https://lucide.dev)**, loaded via CDN. Stroke
  weight `1.5`, size `16 px` inline / `20 px` standalone. Lucide's
  pen-drawn aesthetic matches the warm-academic tone better than
  Heroicons (too neutral) or Phosphor (too friendly).
- **SVGs ship inline** when they're small (single icons), or via
  `<img src="assets/icons/…">` when reused.
- **No emoji** for icons, ever (per the content fundamentals above).
- **Unicode glyphs are the preferred "icons"** for inline use: `→`
  for "next", `↗` for external links, `§` for section anchors, `†` for
  footnotes. Anchored to body type, sit on the baseline correctly,
  never visually noisy.
- **The wordmark `a.c` set in JetBrains Mono is itself the only logo.**
  Lowercase, with the period. See `assets/logo.svg` for the canonical
  lock-up.

> **Substitution flag:** Lucide is a CDN icon set chosen by me; Archie
> didn't specify one. If he prefers Heroicons, Phosphor, Tabler, or
> something custom, swap the CDN reference in `index.html`s and update
> this section.

---

## Index

The full layout of this design system:

```
.
├── README.md                  ← you are here
├── SKILL.md                   ← agent skill manifest (cross-compatible with Claude Code)
├── colors_and_type.css        ← all CSS variables (color, type, spacing, radii, shadow)
├── charts.css                 ← chart tokens (categorical / sequential / diverging palettes + chrome)
├── fonts/                     ← font loading instructions + self-host fallback
│
├── assets/
│   ├── logo.svg               ← the canonical a.c wordmark
│   ├── logo-stacked.svg       ← stacked wordmark with role
│   ├── favicon.svg            ← square favicon
│   ├── paper-noise.svg        ← optional paper texture overlay
│   └── og-card.svg            ← Open Graph / social card template
│
├── preview/                   ← Design System tab cards (registered as assets)
│   ├── type-scale.html        ← full type specimen
│   ├── type-body.html         ← body type sample
│   ├── type-mono.html         ← mono type sample
│   ├── colors-paper.html      ← Paper palette
│   ├── colors-slate.html      ← Slate palette
│   ├── colors-mono.html       ← Mono palette
│   ├── colors-semantic.html   ← semantic tokens (fg, bg, accent…)
│   ├── spacing.html           ← spacing scale
│   ├── radii-shadow.html      ← radii + shadow tokens
│   ├── buttons.html           ← button states
│   ├── fields.html            ← inputs, selects, textarea
│   ├── cards.html             ← card / callout patterns
│   ├── code-math.html         ← code block + KaTeX math
│   ├── citations.html         ← citation, footnote, paper card
│   ├── charts.html            ← chart types · scatter, line, bar, hist, area, small mults, heatmap, box, error
│   ├── logo.html              ← wordmark variations
│   └── icons.html             ← icon system sample
│
├── ui_kits/
│   ├── website/               ← personal site (homepage, about, projects)
│   │   ├── README.md
│   │   ├── index.html
│   │   ├── Nav.jsx
│   │   ├── Hero.jsx
│   │   ├── ProjectList.jsx
│   │   ├── WritingList.jsx
│   │   ├── Footer.jsx
│   │   └── tokens.css
│   ├── blog/                  ← writing / blog
│   │   ├── README.md
│   │   ├── index.html
│   │   └── components.jsx
│   ├── paper/                 ← paper landing page
│   │   ├── README.md
│   │   ├── index.html
│   │   └── components.jsx
│   └── course/                ← course / lecture notes
│       ├── README.md
│       ├── index.html
│       └── components.jsx
│
└── slides/                    ← 1280×720 slide templates
    ├── index.html             ← deck index
    ├── TitleSlide.html
    ├── SectionSlide.html
    ├── ContentSlide.html
    ├── MathSlide.html
    ├── ComparisonSlide.html
    ├── QuoteSlide.html
    ├── FigureSlide.html
    └── EndSlide.html
```
