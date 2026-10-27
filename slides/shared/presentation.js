/* All eight decks share the same 16:9 canvas and PDF settings. */
Reveal.initialize({
  width: 1280,
  height: 720,
  margin: 0.04,
  center: false,
  hash: true,
  controlsTutorial: false,
  slideNumber: "c/t",
  transition: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "none"
    : "fade",
  transitionSpeed: "fast",
  backgroundTransition: "none",
  pdfMaxPagesPerSlide: 1,
  pdfSeparateFragments: false,
  katex: { version: "0.16.9" },
  plugins: [RevealNotes, RevealMath.KaTeX],
});
