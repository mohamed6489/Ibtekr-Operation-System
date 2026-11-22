/* Ibtekr — errors on the screen (the owner 17 Nov). Not a block; loaded right after the loader in index.html.
   1) «السيستم مره واحده وانا برفع صورة بيجيب صفحة فاضية … عايز لو ده حصل يطلع زرار اعمل رفريش»: when nothing of the app is painted any
      more — the screen's centre and edges all land on the page itself — for two checks in a row (≈ 3 s), a card says the page stopped,
      with «اعمل رفريش».
   2) «لو حصل ايرور في اي حاجة يطلعلي بوباب بالغلط عشان ابعتهولك تصلحوا»: any uncaught error or rejected promise shows a popup with the
      error (its text, where in our files, the page, the time) and «نسخ الخطأ», «اعمل رفريش», «إغلاق». The popup sits at the bottom and
      blocks nothing; one card holds up to 5 errors; the same error twice shows once. Noise the browser makes on its own (ResizeObserver,
      a cross-origin «Script error.», an aborted request, a browser extension) is skipped.
   The card lives on <body>, so an empty #root cannot take it with it. Each error is also logged once as `app.crash` — its kind and
   file:line only, never its text (the text stays on the member's screen for them to send). The boot cover and a hidden tab are never
   «blank». */
(function () {
  'use strict';
  const MAX = 5;
  const errs = []; const seen = new Set(); let misses = 0; let card = null; let blankShown = false; let logs = 0;
  const frames = (err) => (String((err && err.stack) || '').match(/\/[\w.-]+\.js:\d+:\d+/g) || []).map((s) => s.slice(1)).slice(0, 3);
  const NOISE = /ResizeObserver loop|^Script error\.?$|AbortError|The (user|operation) aborted|signal is aborted/i;
  function note(err, msg, at) {
    const name = String((err && err.name) || 'Error').slice(0, 40);
    const text = String(msg != null ? msg : (err && err.message) || err || '').slice(0, 400);
    const stack = String((err && err.stack) || '');
    if (NOISE.test(text) || NOISE.test(name) || /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)) return;
    const fr = frames(err); const where = fr[0] || at || '';
    const sig = name + '|' + text + '|' + where; if (seen.has(sig)) return; seen.add(sig);
    const e = { name, text, where, frames: fr.length ? fr : (at ? [at] : []), page: String(location.hash || '#').slice(0, 80), at: new Date().toISOString() };
    if (errs.length < MAX) errs.push(e);
    log(e); render(); setTimeout(check, 400);
  }
  /* The owner 22 Nov («الصفحة فضيت» from one member's machine that the tests could not repeat): the screen and the page's state at
     that moment, as numbers and our own class names only — the window, the pointer (a mouse or a finger: the phone / tablet layer of
     css/mobile.css and js/pages/mobile.js turns on by them), the scroll, what #root holds and how its parts are painted, what lies at
     the screen's centre, and the open popups. It goes into the copied report and into the log, so the next report names the cause.
     Never any text of the page. */
  function shape() {
    const s = {};
    try {
      const mm = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
      const cls = (n) => (n ? String(n.tagName || '').toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList && n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : '') : '-').slice(0, 40);
      const px = (v) => Math.round(Number(v) || 0);
      s.vw = px(window.innerWidth); s.vh = px(window.innerHeight); s.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
      s.ptr = mm('(pointer:coarse)') ? 'coarse' : mm('(pointer:fine)') ? 'fine' : 'none'; s.any = mm('(any-pointer:coarse)') ? 'coarse' : 'fine'; s.hov = mm('(hover:hover)') ? 1 : 0;
      s.tp = px(navigator.maxTouchPoints); s.lay = s.vw < 768 ? 'phone' : s.vw < 1024 ? 'tablet' : 'desk';
      const de = document.documentElement; const b = document.body; const sc = document.scrollingElement || de;
      s.sy = px(window.scrollY); s.st = px(sc && sc.scrollTop); s.sh = px(sc && sc.scrollHeight); s.bt = px(b && b.scrollTop); s.bh = px(b && b.scrollHeight);
      s.ov = [getComputedStyle(de).overflowY, b ? getComputedStyle(b).overflowY : '-', b ? getComputedStyle(b).position : '-'].join('/');
      const root = document.getElementById('root');
      if (root) {
        const r = root.getBoundingClientRect(); s.gate = root.hidden ? 1 : 0; s.rk = root.childElementCount; s.rt = px(r.top); s.rh = px(r.height);
        const rs = getComputedStyle(root); s.rs = [rs.display, rs.visibility, rs.opacity].join('/');
        s.kids = [...root.children].slice(0, 4).map((k) => { const kr = k.getBoundingClientRect(); const ks = getComputedStyle(k);
          return [cls(k), ks.display, ks.visibility, ks.opacity, px(kr.top), px(kr.left), px(kr.width), px(kr.height), k.childElementCount].join(' '); });
        const main = root.querySelector('main'); if (main) { const mr = main.getBoundingClientRect(); s.main = [px(mr.top), px(mr.height), main.childElementCount, getComputedStyle(main).display].join(' '); }
      }
      s.hit = cls(document.elementFromPoint(s.vw / 2, s.vh / 2));
      s.pops = document.querySelectorAll('.scrim, [data-m-portal], .menu.floating, #mpop, #dpop, .fb').length;
      s.boot = document.getElementById('ib-boot') ? 1 : 0; s.age = Math.round((window.performance && performance.now ? performance.now() : 0) / 1000); // seconds since the page loaded
      try { s.busy = window.IBKit && typeof window.IBKit.busyCount === 'function' ? window.IBKit.busyCount() : -1; } catch (x) { s.busy = -1; }
    } catch (x) { s.err = 1; }
    return s;
  }
  const shapeText = (s) => ['الشاشة ' + s.vw + '×' + s.vh + ' (' + s.lay + ', dpr ' + s.dpr + ') · المؤشر ' + s.ptr + ' / ' + s.any + ' · hover ' + s.hov + ' · لمس ' + s.tp,
    'التمرير y ' + s.sy + ' · ' + s.st + '/' + s.sh + ' · body ' + s.bt + '/' + s.bh + ' · overflow ' + s.ov,
    'root ' + s.rk + ' عنصر · top ' + s.rt + ' · h ' + s.rh + ' · ' + s.rs + (s.main ? ' · main ' + s.main : ''),
    ...(s.kids || []).map((k) => '  ' + k), 'في النص: ' + s.hit + ' · بوب أب ' + s.pops + ' · boot ' + s.boot + ' · busy ' + s.busy + ' · gate ' + s.gate + ' · ' + s.age + ' ث'].join('\n');
  let shot = null; // the state when the page was first seen blank (the copy comes later, after the card is drawn)
  function log(e) {
    if (logs >= MAX || !window.IBActivity || typeof window.IBActivity.log !== 'function') return; logs += 1;
    try { window.IBActivity.log('app.crash', { kind: e ? e.name : 'blank', at: e ? e.where : '', d: shot || shape() }); } catch (x) { /* the log must never throw here */ }
  }
  window.addEventListener('error', (ev) => { if (ev && ev.target && ev.target !== window) return; /* a missing image is no crash */
    note(ev && ev.error, ev && ev.message, ev && ev.filename ? String(ev.filename).split('/').pop() + ':' + ev.lineno + ':' + ev.colno : ''); });
  window.addEventListener('unhandledrejection', (ev) => { const r = ev && ev.reason; note(r && typeof r === 'object' ? r : null, r && typeof r === 'object' ? undefined : String(r)); });

  function blank() {
    if (document.hidden || document.getElementById('ib-boot')) return false;
    const root = document.getElementById('root'); if (!root) return false;
    const w = window.innerWidth, hgt = window.innerHeight; if (w < 80 || hgt < 80) return false;
    const pts = [[w / 2, hgt / 2], [w - 48, hgt / 2], [48, hgt / 2], [w / 2, 48], [w / 2, hgt - 48], [w - 48, 48]];
    return pts.every(([x, y]) => { const el = document.elementFromPoint(x, y); return !el || el === document.documentElement || el === document.body || el === root || (card && card.contains(el)); });
  }
  // the text the member copies and sends: what happened, where in our files, on which page and when — nothing else of the page
  function report() {
    const lines = ['نظام إبتكر — خطأ', 'الصفحة: ' + String(location.hash || '#').slice(0, 80), 'الوقت: ' + new Date().toISOString()];
    if (blankShown) lines.push('الصفحة فضيت (مفيش حاجة ظاهرة)');
    errs.forEach((e, i) => { lines.push('', (errs.length > 1 ? (i + 1) + ') ' : '') + e.name + ': ' + e.text); if (e.frames.length) lines.push('المكان: ' + e.frames.join(' ← ')); lines.push('في صفحة: ' + e.page + ' · ' + e.at); });
    lines.push('', 'حالة الصفحة' + (blankShown ? ' (لما فضيت)' : '') + ':', shapeText(shot || shape()));
    lines.push('', 'المتصفح: ' + String(navigator.userAgent || '').slice(0, 160));
    return lines.join('\n');
  }
  function el(tag, attrs, text) { const n = document.createElement(tag); Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k])); if (text != null) n.textContent = text; return n; }
  function render() {
    if (!errs.length && !blankShown) return;
    if (!card) { card = el('div', { class: 'ib-crash', role: 'alertdialog', 'aria-live': 'assertive', 'data-crash': '' }); document.body.appendChild(card); }
    card.classList.toggle('blank', blankShown);
    card.replaceChildren();
    card.append(el('b', null, blankShown ? 'الصفحة وقفت' : 'حصل خطأ في السيستم'),
      el('p', null, blankShown ? 'حصلت مشكلة والصفحة مابقتش ظاهرة. انسخ الخطأ وابعته عشان يتصلّح، وبعدين اعمل رفريش — اللي اتحفظ قبل كده موجود.'
        : 'انسخ الخطأ ده وابعته عشان يتصلّح. ممكن تكمّل شغلك، ولو حاجة مش شغّالة اعمل رفريش.'));
    const box = el('pre', { class: 'ib-crash-err', 'data-crash-text': '', dir: 'ltr' }, errs.length ? errs.map((e) => e.name + ': ' + e.text + (e.where ? '\n  @ ' + e.where : '')).join('\n') : 'مفيش خطأ ظاهر — الصفحة فضيت.');
    const acts = el('div', { class: 'ib-crash-acts' });
    const copy = el('button', { type: 'button', class: 'btn btn-default', 'data-crash-copy': '' }, 'نسخ الخطأ');
    copy.addEventListener('click', async () => {
      const t = report(); let ok = false;
      try { await navigator.clipboard.writeText(t); ok = true; } catch (x) {
        try { const ta = el('textarea', { readonly: '' }); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (y) { ok = false; }
      }
      copy.textContent = ok ? 'اتنسخ ✓' : 'انسخه من المربع'; if (!ok) { const r = document.createRange(); r.selectNodeContents(box); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    const reload = el('button', { type: 'button', class: 'btn ' + (blankShown ? 'btn-primary' : 'btn-default'), 'data-crash-reload': '' }, 'اعمل رفريش');
    reload.addEventListener('click', () => { window.location.reload(); });
    acts.append(copy, reload);
    if (!blankShown) { const close = el('button', { type: 'button', class: 'btn btn-ghost', 'data-crash-close': '' }, 'إغلاق'); close.addEventListener('click', () => { card.remove(); card = null; errs.length = 0; }); acts.append(close); }
    card.append(box, acts);
    if (blankShown) { try { reload.focus(); } catch (x) { /* no focus is fine */ } }
  }
  function check() {
    if (blankShown) return;
    if (blank()) { misses += 1; if (misses >= 2) { shot = shape(); blankShown = true; if (!errs.length) log(null); render(); } } else misses = 0;
  }
  setInterval(check, 1500);
  window.IBCrashGuard = { check, blank, report, shape, errors: () => errs.slice() };
})();
