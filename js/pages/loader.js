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

  // «الإعدادات › الهوية البصرية › شاشة التحميل / أيقونة المتصفح» (the owner 16 Nov: «اعمل ف الاعدادات مكان اعدل منه ال preloader و ال
  // fav icon»): the row «brand» keeps { loader, favicon } — settings_public() hands it to every member and the page applies it (ib:settings).
  // The last one applied is kept in this browser too, so the first-paint cover (before the sign-in) already shows it.
  //   loader: { kind: 'worm' | 'image', head, body, tile (#rrggbb — the worm's colours), speed (seconds a round, 0.8 … 4),
  //             image (a data: PNG / GIF / WebP up to 200 KB — a picture of one's own), spin (the picture turns) }
  //   favicon: a data: PNG (the page draws it 64 × 64) — none = the logo itself in the loader's colours (logoIcon)
  const DEFAULTS = { kind: 'worm', head: '#015642', body: '#C9A259', tile: '#FFF3E6', speed: 1.7, image: null, spin: false };
  const HEX = /^#[0-9a-f]{6}$/i; const IMG = /^data:image\/(png|gif|webp);base64,[A-Za-z0-9+/=]+$/; const FAV = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const MAX_IMG = 280000; const MAX_FAV = 60000; // the data: text (≈ 200 KB / 44 KB of picture)
  function clean(x) {
    const o = x && typeof x === 'object' ? x : {}; const d = DEFAULTS;
    const sp = Number(o.speed);
    const image = typeof o.image === 'string' && o.image.length <= MAX_IMG && IMG.test(o.image) ? o.image : null;
    return { kind: o.kind === 'image' && image ? 'image' : 'worm', head: HEX.test(o.head) ? o.head : d.head, body: HEX.test(o.body) ? o.body : d.body, tile: HEX.test(o.tile) ? o.tile : d.tile,
      speed: Number.isFinite(sp) && sp >= 0.8 && sp <= 4 ? Math.round(sp * 10) / 10 : d.speed, image, spin: o.spin === true };
  }
  const cleanFavicon = (u) => (typeof u === 'string' && u.length <= MAX_FAV && FAV.test(u) ? u : null);
  const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  let cfg = clean(null);
  // the worm's colours and speed are CSS variables (app.css .ib-worm); a picture of one's own replaces the drawn marks already on the page
  function apply(x, opts) {
    cfg = clean(x); const r = document.documentElement && document.documentElement.style;
    if (r) { r.setProperty('--ldr-head', cfg.head); r.setProperty('--ldr-body', cfg.body); r.setProperty('--ldr-tile', cfg.tile); r.setProperty('--ldr-speed', cfg.speed + 's'); }
    if (!(opts && opts.keep === false)) store('ib.loader', x ? cfg : null);
    // a mark already on the page that is the other kind (a drawn worm ↔ a picture), or another picture, is drawn again in its place
    if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('.ib-worm').forEach((n) => {
      const isImg = n.tagName === 'IMG'; const want = cfg.kind === 'image';
      if (isImg === want && (!want || n.getAttribute('src') === cfg.image) && (!want || n.classList.contains('spin') === cfg.spin)) return;
      const w = Number(n.getAttribute('width')) || 32; if (n.parentNode) n.parentNode.replaceChild(mark(w), n);
    });
    // the original icon follows the colours
    if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('link[data-ib-fav-logo]').forEach((l) => { l.href = logoIcon(); });
    return Object.assign({}, cfg);
  }
  // the original icon = the logo standing still in the loader's colours (an SVG we draw ourselves — no script in it)
  function logoIcon(c) {
    const x = c || cfg; const p = '<path d="' + TRACK + '" fill="none" stroke-width="4.75" stroke-linecap="square" stroke-linejoin="miter" clip-path="url(#c)" ';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><clipPath id="c"><path d="' + CLIP + '"/></clipPath>'
      + '<rect width="32" height="32" rx="6" fill="' + x.tile + '"/>'
      + p + 'stroke="' + x.body + '" stroke-dasharray="9 7.125 22.625 14.25" stroke-dashoffset="-9.5"/>'
      + p + 'stroke="' + x.head + '" stroke-dasharray=".02 52.98" stroke-dashoffset="-2.365"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function favicon(u, opts) {
    const v = cleanFavicon(u); if (typeof document === 'undefined' || !document.head) return v;
    document.querySelectorAll('link[data-ib-fav],link[data-ib-fav-logo]').forEach((l) => l.parentNode.removeChild(l));
    const l = document.createElement('link'); l.rel = 'icon';
    if (v) { l.type = 'image/png'; l.href = v; l.setAttribute('data-ib-fav', ''); } else { l.type = 'image/svg+xml'; l.href = logoIcon(); l.setAttribute('data-ib-fav-logo', ''); }
    document.head.appendChild(l);
    if (!(opts && opts.keep === false)) store('ib.favicon', v);
    return v;
  }
  // this browser's last ones, before anything else is drawn
  (function fromCache() { let c = null; try { c = JSON.parse(stored('ib.loader') || 'null'); } catch (e) { c = null; } if (c) apply(c, { keep: false }); favicon(stored('ib.favicon'), { keep: false }); })();
  // the company's, every time the public settings come (the sign-in, a save, the live sync)
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('ib:settings', () => {
    const S = window.IBSettings; const pub = S && S.public ? S.public() : null; const b = pub && pub.brand && typeof pub.brand === 'object' ? pub.brand : null; if (!b) return;
    apply(b.loader || null); favicon(b.favicon || null);
  });
  function el(name, attrs, kids) {
    const n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }
  function mark(size) {
    const px = Math.max(12, Number(size) || 32); const id = 'ibw' + (++seq);
    if (cfg.kind === 'image' && cfg.image) { const i = document.createElement('img'); i.className = 'ib-worm ib-ldr-img' + (cfg.spin ? ' spin' : ''); i.src = cfg.image; i.alt = ''; i.width = px; i.height = px; i.setAttribute('aria-hidden', 'true'); return i; }
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

  window.IBLoader = { mark, row, bootDone, dress, TRACK, CLIP, apply, favicon, logoIcon, clean, cleanFavicon, config: () => Object.assign({}, cfg), DEFAULTS };
})();
