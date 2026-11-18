/* Optional audit: ?check-layout checks every slide after fonts, images and maths. */
(() => {
  if (!new URLSearchParams(location.search).has('check-layout')) return;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  async function audit() {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
    // The KaTeX plugin loads its dependency asynchronously after Reveal is ready.
    for (let i = 0; i < 200 && !document.querySelector('.katex'); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await document.fonts.ready;
    const saved = Reveal.getIndices();
    const transition = Reveal.getConfig().transition;
    Reveal.configure({transition: 'none'});
    const report = [];
    for (const [index, slide] of Reveal.getSlides().entries()) {
      Reveal.slide(index);
      await frame(); await frame();
      const bounds = slide.getBoundingClientRect();
      const scale = bounds.width / 1280;
      const css = getComputedStyle(slide);
      const right = bounds.right - parseFloat(css.paddingRight) * scale;
      const bottom = bounds.bottom - parseFloat(css.paddingBottom) * scale;
      const issues = [];
      for (const el of slide.querySelectorAll('h1,h2,h3,p,li,table,figure,pre,.equation,.q3-math,.flow,.columns,.katex-html')) {
        if (el.closest('aside') || !el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        if (r.right > right + 2 || r.bottom > bottom + 2 || el.scrollWidth > el.clientWidth + 3) {
          issues.push({element: el.tagName, text: el.textContent.trim().slice(0, 90),
            rightOverflow: Math.max(0, (r.right-right)/scale), bottomOverflow: Math.max(0, (r.bottom-bottom)/scale),
            scrollOverflow: el.scrollWidth-el.clientWidth});
        }
      }
      report.push({slide: index + 1, id: slide.id, title: slide.querySelector('h2,h1')?.textContent, issues});
    }
    Reveal.slide(saved.h, saved.v);
    Reveal.configure({transition});
    window.slideLayoutReport = report;
    const banner = document.createElement('div');
    banner.className = 'layout-status';
    banner.textContent = `${report.length} slides checked; ${report.filter(r => r.issues.length).length} with overflow. See window.slideLayoutReport.`;
    document.body.append(banner);
    console.table(report.filter(r => r.issues.length));
  }
  if (Reveal.isReady()) audit(); else Reveal.on('ready', audit);
})();
