# UI kit · Personal website

A pixel-fidelity recreation of how Archie's personal homepage should
look. Asymmetric: narrow left rail (~200 px) of nav, wide right column
of content. Reading-room atmosphere — paper background, mono headlines,
sentence-case nav.

Open `index.html` for the working demo. The page is interactive:
clicking a nav item swaps the content column in place.

## Components

| File | What it is |
| --- | --- |
| `Nav.jsx` | Left rail — wordmark + sections + footer note |
| `Hero.jsx` | Front-door hero — name, one-line bio, current focus |
| `WritingList.jsx` | Year-grouped list of posts, dense |
| `PaperList.jsx` | Paper entries with authors, venue, link row |
| `Footer.jsx` | Bottom strip — last edited, repo link, ©︎ |

## Signature moves

- 200-px left rail; content column max 720 px (still inside the global
  `--page-max`).
- All headings in JetBrains Mono. All body in Inter.
- Hover on a nav item: background fades to `--bg-2`. The active item
  has a 2-px terracotta indicator on the left edge.
- "Now" line on the homepage is set in serif italic — the only place
  serif appears on this surface.
