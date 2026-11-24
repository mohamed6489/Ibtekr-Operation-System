/* Ibtekr — an alert in «تقرير» mode opened from the bell (Safwat 24 Nov — «جدول واحد بكل الحاجات»; docs/superpowers/plans/
   2026-11-24-bell-redesign.md decision 8, 0162). Not a block: block 28's treeOpen hands it any alert whose meta says `report`. One table
   with every thing the rule's elements found for this member (meta.items — the server wrote only what his pages let him see): the
   element, the line, its owner; a chip per element filters it; a row opens its thing (an order, a conversation …) through the bell's own
   opener; «مشاركة» sends the table (IBShare). Names and lines only — no phone, no address. */
(function () {
  'use strict';
  const U = () => window.IBUI; const h = (...a) => U().h(...a);
  const itemsOf = (a) => (a && a.meta && Array.isArray(a.meta.items) ? a.meta.items : []);
  function open(a, opener) {
    const items = itemsOf(a); const total = Number(a.meta && a.meta.n) || items.length;
    const parts = [...new Set(items.map((x) => x.p))];
    const st = { part: null }; let m = null;
    const title = String(a.title || 'تقرير').replace(/\s*—\s*\d+$/, '');
    const shown = () => items.filter((x) => !st.part || x.p === st.part);
    const box = h('div', { class: 'ar-body', 'data-alert-report': '' });
    const go = (x) => { if (!x.e || typeof opener !== 'function') return; if (opener({ entity: x.e, entityId: null }) !== false && m) m.close(); };
    const draw = () => {
      const rows = shown();
      box.replaceChildren(
        h('p', { class: 't-small muted', style: 'margin:0 0 10px' }, String(a.body || '')),
        parts.length > 1 ? h('div', { class: 'chips ar-parts', role: 'group', 'aria-label': 'العنصر' },
          [[null, 'الكل', items.length]].concat(parts.map((p) => [p, p, items.filter((x) => x.p === p).length])).map(([k, l, n]) =>
            h('button', { type: 'button', class: 'chip' + (st.part === k ? ' on' : ''), 'aria-pressed': String(st.part === k), 'data-ar-part': k || '', onClick: () => { st.part = k; draw(); } }, l + ' (' + n + ')'))) : null,
        rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl ar-tbl' },
          h('thead', null, h('tr', null, h('th', null, 'العنصر'), h('th', null, 'التنبيه'), h('th', null, 'التفاصيل'), h('th', null, 'صاحبه'))),
          h('tbody', null, rows.map((x) => h('tr', { class: x.e ? 'ar-go' : '', 'data-ar-row': '', tabindex: x.e ? '0' : false, title: x.e ? 'افتح' : false,
            onClick: () => go(x), onKeydown: (e) => { if (e.key === 'Enter') go(x); } },
            h('td', null, x.p), h('td', null, h('b', null, x.t)), h('td', null, x.b || '—'), h('td', null, x.g || '—')))))) : h('p', { class: 'muted' }, 'مفيش حاجة في العنصر ده.'),
        total > items.length ? h('p', { class: 't-small muted', style: 'margin:8px 0 0' }, 'ظاهر أول ' + items.length + ' من ' + total + '.') : null);
    };
    draw();
    const spec = () => ({ title, sub: String(a.body || ''), name: title, headers: ['العنصر', 'التنبيه', 'التفاصيل', 'صاحبه'], rows: shown().map((x) => [x.p, x.t, x.b || '', x.g || '']) });
    m = U().Modal({ title: title + ' (' + total + ')', body: [box], share: false,
      footer: [U().Button({ type: 'primary', icon: 'share', label: 'مشاركة', disabled: !items.length, attrs: { 'data-share': '' }, onClick: () => window.IBShare && window.IBShare.open(spec()) }),
        U().Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })] });
    m.el.classList.add('wide');
    return m;
  }
  window.IBAlertReport = { open, itemsOf };
})();
