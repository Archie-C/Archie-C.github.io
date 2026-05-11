---
name: archie-carpenter-design
description: Use this skill to generate well-branded interfaces and assets for Archie Carpenter (a.c) — a researcher and teacher in machine learning and mathematics. Covers personal website, blog, research paper landing pages, course / lecture notes, and conference slide templates. Includes typography, three palette options (Paper / Slate / Mono), a full token system, KaTeX + code-block treatment, and pixel-fidelity UI-kit components.
user-invocable: true
---

# archie-carpenter-design

Read `README.md` for the brand kernel, content fundamentals, visual
foundations, and iconography rules — then explore the other files
listed in the README index. The system is text-first, mono-headlined,
warm-paper-grounded, no-emoji, no-orange. Purple is the accent.

## When invoked

If creating visual artifacts (slides, mocks, throwaway prototypes,
landing pages, social cards) — copy the assets you need out of this
folder and produce static HTML files for the user to view. Always
import `colors_and_type.css` and pick a palette via
`<html data-palette="paper|slate|mono">`. Use the four UI kits in
`ui_kits/` as the source of truth for component patterns; copy and
adapt them rather than inventing from scratch.

If working on production code — read `colors_and_type.css` for the full
token surface, copy fonts per `fonts/README.md`, follow the content
rules in `README.md`'s Content Fundamentals section, and treat the UI
kits as reference implementations (cosmetic only — wire them up
properly in your stack).

If the user invokes this skill without any other guidance, ask them
what they want to build or design, ask a small handful of focused
questions (audience, surface, length, math/code density), and act as
an expert designer who outputs HTML artifacts or production code,
depending on the need. Default to the **Paper** palette unless they
ask otherwise.

## Hard rules

- No emoji, anywhere.
- No orange. Purple (`#5B2A86`) is the single accent on the Paper palette.
- Sentence case for everything — including buttons and nav.
- First person ("I research…"), never the royal "we".
- Headlines in JetBrains Mono. Body in Inter. Long-form / quotes / math in Source Serif 4.
- Never invent new logos — the lettering `a.c` set in JetBrains Mono is the only mark.
- KaTeX-render all math. Real Unicode for inline glyphs (`→ · § ≈ †`), not ASCII or emoji.
- Don't use the words: innovative, cutting-edge, leverage, synergy, transformative,
  revolutionise, passionate, ground-breaking, AI-powered, world-class, thought leader.

## File map

See `README.md`'s Index section for the full layout. Highlights:

- `colors_and_type.css` — all tokens. Import this first.
- `assets/` — logo, favicon, paper noise.
- `ui_kits/{website,blog,paper,course}/index.html` — pixel-fidelity reference surfaces.
- `slides/index.html` — 1280×720 slide templates (title, section, content, math, comparison, quote, end).
- `preview/` — the cards visible in the Design System tab.
