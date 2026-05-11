# Fonts

The design system uses three families, all open-source. By default they
load via Google Fonts CDN (see `@import` at the top of
`../colors_and_type.css`):

| Role | Family | Notes |
| --- | --- | --- |
| Display & headlines | **JetBrains Mono** | Variable, 400–700, italic. Use 500–700 for headings. |
| Body | **Inter** | Variable, 400–700. `font-feature-settings: 'ss01', 'cv11'` for the alt-1 and curved-l alternates. |
| Long-form reading & math | **Source Serif 4** | Variable, optical-size axis 8–60. |

## Self-hosting

For production or offline use, replace the `@import` in
`colors_and_type.css` with a self-hosted `@font-face` block. Download
the .woff2 files from:

- https://fonts.google.com/specimen/JetBrains+Mono
- https://fonts.google.com/specimen/Inter
- https://fonts.google.com/specimen/Source+Serif+4

…and drop them next to this README. A minimal `@font-face` set looks
like:

```css
@font-face {
  font-family: 'JetBrains Mono';
  src: url('JetBrainsMono-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('Inter-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Source Serif 4';
  src: url('SourceSerif4-Variable.woff2') format('woff2-variations');
  font-weight: 200 900;
  font-style: normal;
  font-display: swap;
}
```

## Substitution flag

These three fonts were chosen by me (the assistant). The brief asked for
**mono headlines + sans body** and explicitly excluded Comic Sans, but
otherwise left the choice open. If Archie has personal favourites
(Berkeley Mono, Söhne, Tiempos, Fraunces, IBM Plex, etc.), swap them in
at the `--font-mono / --font-sans / --font-serif` tokens in
`colors_and_type.css` — the rest of the system will follow.
