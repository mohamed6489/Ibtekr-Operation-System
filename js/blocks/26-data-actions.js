
/* Ibtekr ops — «الإجراءات» menu on every main page (owner 22 Oct): export in Excel / CSV / Google Sheets, import, templates.
   The sheets of each page come from window.IBData; the dialogs are the ones in الإعدادات › البيانات (settings api). */
(function () {
  'use strict';
  const U = window.IBUI; const { h, Button } = U;
  const api = () => window.IBPages.all().settings.api;
  const groups = (ids) => ids.map((id) => window.IBData && window.IBData.group(id)).filter(Boolean);
  function items(ids, first) {
    const G = groups(ids); const imp = G.filter((g) => g.apply); const o = { sheets: ids };
    const main = first && ids.includes(first) ? first : ids[0]; const mainImp = imp.some((g) => g.id === main) ? main : imp[0] && imp[0].id;
    const ex = (fmt) => () => api().exportData(main, Object.assign({ fmt }, o));
    return [
      { value: 'xlsx', label: 'تصدير Excel (‎.xlsx)', icon: 'download', run: ex('XLSX') },
      { value: 'csv', label: 'تصدير CSV', icon: 'file', run: ex('CSV') },
      { value: 'tsv', label: 'نسخ للصق في Google Sheets', icon: 'copy', run: ex('TSV') },
    ].concat(imp.length ? [
      { value: 'import', label: 'استيراد من Excel / CSV / Google Sheets', icon: 'attach', run: () => api().importData(mainImp, null, { sheets: imp.map((g) => g.id) }) },
      { value: 'tpl', label: 'قوالب الاستيراد', icon: 'sliders', run: () => api().templates(mainImp, null, { sheets: imp.map((g) => g.id) }) },
    ] : []);
  }
  // normal pages: a Button + popover menu. first = the sheet that fits the current tab
  function Menu(ids, first) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = Button({ label: 'الإجراءات', iconEnd: 'chevD', attrs: { 'aria-haspopup': 'menu', 'data-actions': ids.join(',') } });
    const pop = U.popover(wrap, trig, (close) => { const list = items(ids, typeof first === 'function' ? first() : first);
      return U.DropdownMenu({ role: 'menu', end: true, options: list.map((x) => ({ value: x.value, label: x.label, icon: x.icon })), onSelect: (v) => { close(); const it = list.find((x) => x.value === v); setTimeout(() => it && it.run()); } }); });
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  // pages in a shadow root (orders): a floating menu in the document under the given button
  let floating = null;
  function closeFloating() { if (floating) { floating.remove(); floating = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); } }
  const outside = (e) => { if (floating && !floating.contains(e.target)) closeFloating(); };
  const esc = (e) => { if (e.key === 'Escape') { closeFloating(); } };
  function openAt(btn, ids, first) {
    if (floating) { closeFloating(); return; }
    const list = items(ids, first); const r = btn.getBoundingClientRect();
    const menu = U.DropdownMenu({ role: 'menu', options: list.map((x) => ({ value: x.value, label: x.label, icon: x.icon })), onSelect: (v) => { closeFloating(); const it = list.find((x) => x.value === v); setTimeout(() => it && it.run()); } });
    menu.classList.add('float-menu'); menu.style.top = Math.round(r.bottom + 4) + 'px'; menu.style.left = Math.max(8, Math.round(r.left)) + 'px';
    document.body.append(menu); floating = menu; const f = menu.querySelector('[role=menuitem]'); if (f) f.focus();
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); });
  }
  // which sheets each page offers (first = main)
  const PAGES = { orders: ['orders', 'orderEdit', 'subEdit'], vendors: ['vendors', 'vendorSecure', 'delayRules', 'vendorMoves'], accounts: ['expenses', 'vendorMoves', 'accountMoves', 'transport'],
    inventory: ['stock'], cs: ['customers', 'templates', 'quick'], tickets: ['tickets'], hr: ['team', 'attendance', 'leaves', 'scores', 'holidays'], reports: ['orders', 'vendors', 'expenses', 'transport'] };
  window.IBDataActions = { Menu, openAt, close: closeFloating, PAGES, items };
})();

