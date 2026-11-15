// «دودة اللوجو» — the system's preloader (the owner 15 Nov — docs/superpowers/plans/2026-11-15-preloader.md: «عايزك تعملي preloader لاي
// loading يحصل في السيستم … و عايز احول اللوجو … لدودة راسها النقطة الخضراء المنفصلة تلف كانيميشن حول اللوجو»). Not a block.
//
// The logo is already a ring round a square track: the green square (the head) in the top-left corner and the two gold pieces
// behind it, with three gaps. Here the same shapes are dashes of one stroke on that track (its centre line, 4.75 thick), so moving
// the dashes along the track makes the logo crawl round itself, the green head first — and at rest it is the logo, to the pixel:
//   the track's centre line: the square 9.375 … 22.625 (side 13.25, round = 53), starting on the left edge under the head
//   the head  = 4.75 of it (the corner cell 7 … 11.75)        the gaps = 2.375 each
//   the body  = 13.75 (the top bar and down the right side) and 27.375 (the rest of the right side, the bottom, up the left side)
// The path goes round twice so no dash is ever cut at the path's own start, and the logo's one round corner (bottom-left, outside)
// is a clip — whatever passes there is rounded the same way. The motion itself is CSS (app.css, .ib-worm).
//   IBLoader.mark(size)        the animated mark (an <svg>), `size` px square
//   IBLoader.row(text, size)   the mark with a line of text beside it
//   a note that says «بنحمّل…» (the kit's InlineNote, the portal's line) gets the mark by itself — see watchNotes below
//   IBLoader.bootDone()        takes the first-paint cover (#ib-boot in index.html) off — done by itself when the sign-in screen
//                              or the app shows; a safety timer never leaves it up
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TRACK = 'M9.375 11.75V9.375H22.625V22.625H9.375V9.375H22.625V22.625H9.375V11.75';
  const CLIP = 'M7 7H25V25H9.81C8.26 25 7 23.74 7 22.19Z';
  let seq = 0;
  function el(name, attrs, kids) {
    const n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }
  function mark(size) {
    const px = Math.max(12, Number(size) || 32); const id = 'ibw' + (++seq);
    return el('svg', { class: 'ib-worm', viewBox: '0 0 32 32', width: px, height: px, 'aria-hidden': 'true', focusable: 'false' }, [
      el('rect', { class: 'w-tile', width: 32, height: 32, rx: 6 }),
      el('clipPath', { id }, [el('path', { d: CLIP })]),
      el('g', { 'clip-path': 'url(#' + id + ')' }, [el('path', { class: 'w-body', d: TRACK }), el('path', { class: 'w-head', d: TRACK })]),
    ]);
  }
  function row(text, size) {
    const s = document.createElement('span'); s.className = 'ib-loading'; s.setAttribute('role', 'status');
    s.appendChild(mark(size || 24));
    if (text) { const t = document.createElement('span'); t.textContent = String(text); s.appendChild(t); }
    return s;
  }

  // the first-paint cover: off as soon as there is something to look at — the sign-in screen (#login) or the app (#root shown again
  // after the gate hid it). Its fade never keeps a click away (pointer-events off at once).
  const BOOT_MAX_MS = 15000;
  function bootDone() {
    const b = document.getElementById('ib-boot'); if (!b || b.dataset.out) return;
    b.dataset.out = '1'; b.classList.add('out'); setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
  }
  function watchBoot() {
    const b = document.getElementById('ib-boot'); if (!b || typeof MutationObserver !== 'function') { bootDone(); return; }
    const root = document.getElementById('root'); let wasHidden = !!(root && root.hidden);
    const ready = () => { const lg = document.getElementById('login'); return !!(lg && !lg.hidden) || !!(root && wasHidden && !root.hidden); };
    const mo = new MutationObserver(() => { if (root && root.hidden) wasHidden = true; if (ready()) { mo.disconnect(); bootDone(); } });
    mo.observe(document.body, { childList: true });
    if (root) mo.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    setTimeout(() => { mo.disconnect(); bootDone(); }, BOOT_MAX_MS);
  }
  // A page's own «بنحمّل…» note gets the mark beside it. The notes are drawn by many pages (the kit's InlineNote, the portal's
  // loading line), so they are found as they are added — a short text that starts with «بنحمّل», dressed once.
  const NOTES = '.note, .pt-loading'; const LOADING = /^\s*بنحمّل/;
  function dress(n) {
    if (!n || !n.classList || n.classList.contains('is-loading')) return;
    const t = n.textContent || ''; if (t.length > 90 || !LOADING.test(t)) return;
    n.classList.add('is-loading'); n.insertBefore(mark(22), n.firstChild);
  }
  function watchNotes() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver((list) => {
      for (const m of list) for (const a of m.addedNodes) {
        if (!a || a.nodeType !== 1 || !a.matches) continue;
        if (a.matches(NOTES)) dress(a);
        const inside = a.querySelectorAll ? a.querySelectorAll(NOTES) : []; for (const n of inside) dress(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (typeof document !== 'undefined' && document.body) { watchBoot(); watchNotes(); }

  window.IBLoader = { mark, row, bootDone, dress, TRACK, CLIP };
})();
