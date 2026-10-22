
/* KPI details popup — pure helpers (owner, 22 Oct): every summary tile in the system has «التفاصيل» that opens a popup with its data.
   normalize(spec|fn, tile) → full spec; detailsText(spec) → share message (WhatsApp / email). UMD, tested in details.test.js. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.IbtekrDetails = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const str = (x) => (x == null ? '' : String(x)).replace(/\s+/g, ' ').trim();
  function normalize(details, tile) {
    const t = tile || {};
    const raw = typeof details === 'function' ? details() : details;
    if (!raw) return { title: t.label || '', sub: str(t.note), summary: [{ label: 'القيمة', value: str(t.value) + (t.unit ? ' ' + t.unit : '') }], headers: [], rows: [], note: '', source: '', share: true, actions: [] };
    const s = Object.assign({ title: t.label || '', sub: '', summary: [], headers: [], rows: [], note: '', source: '', actions: [], empty: 'مفيش بيانات هنا.' }, raw);
    if (s.share === undefined) s.share = true; // owner (22 Oct): every popup can be shared
    return s;
  }
  function detailsText(spec, cap) {
    const max = cap || 40; const lines = [str(spec.title)];
    if (str(spec.sub)) lines.push(str(spec.sub));
    (spec.summary || []).forEach((x) => lines.push(str(x.label) + ': ' + str(x.value)));
    const rows = spec.rows || [];
    rows.slice(0, max).forEach((r) => { const cells = r.map(str).filter((c) => c && c !== '—'); if (cells.length) lines.push('• ' + cells.join(' · ')); });
    if (rows.length > max) lines.push('و ' + (rows.length - max) + ' كمان');
    if (spec.total) { const c = spec.total.map(str).filter((x) => x && x !== '—'); if (c.length) lines.push(c.join(' · ')); }
    return lines.join('\n');
  }
  return Object.freeze({ normalize, detailsText });
});

