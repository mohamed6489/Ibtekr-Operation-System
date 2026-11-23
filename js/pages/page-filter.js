/* A list filtered by words (the owner 22 Nov — «الفلتر بالكلام علي الداتا عيزو يبقا من ضمن السيستم»). Not a block.
   The system's own engine (system-brain.js) names the list and the words; this opens the list's tab and works its own filter —
   the kit's «فلتر» every table has — as a member would: the choices the words name are ticked (IBBrain.pickOptions on the
   labels the menu shows) and «اعرض N» pressed; the words that are no choice go in the table's «بحث». No model behind it.
     IBPageFilter.run({ hash, tab, name, words }) → Promise<{ ok, text, picked: [{ group, label }], searched, count }> */
(function () {
  'use strict';
  const EN = window.IB_LANG === 'en'; const tx = (ar, en) => (EN ? en : ar);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (e) => !!(e && e.offsetParent);
  const main = () => document.querySelector('main.content:not([hidden])') || document;
  async function until(fn, ms) { const end = Date.now() + (ms || 4000); for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await wait(80); } }
  // the text as the page shows it (the English demo shows a label in English and keeps the app's own words underneath)
  const shown = (el) => { const T = window.IBT; try { return T && T.shown ? String(T.shown(el)) : el.textContent; } catch (e) { return el.textContent; } };
  const press = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  async function run(L) {
    const B = window.IBBrain; if (!B || !L || !L.hash) return { ok: false, text: tx('ماقدرتش أفتح القايمة دي.', 'Could not open this list.') };
    if (window.location.hash !== '#' + L.hash) window.location.hash = L.hash;
    await wait(250);
    if (L.tab) { const t = await until(() => [...main().querySelectorAll('[role=tab]')].find((x) => vis(x) && x.textContent.replace(/\d+/g, '').trim() === L.tab)); if (t && t.getAttribute('aria-selected') !== 'true') { press(t); await wait(250); } }
    const btn = await until(() => [...main().querySelectorAll('[data-fm-btn]')].find(vis), 5000);
    const name = EN && L.en ? L.en : L.name; const picked = []; let rest = (L.words || []).slice(); let count = '';
    if (btn) {
      press(btn); const menu = await until(() => document.querySelector('[data-fm-menu]'), 1500);
      if (menu) {
        const clear = menu.querySelector('[data-fm-clear]'); if (clear) press(clear);
        const opts = [...menu.querySelectorAll('[data-fm]')].map((el) => { const sec = el.closest('[data-fm-key]'); const tab = sec ? menu.querySelector('[data-fm-tab="' + CSS.escape(sec.getAttribute('data-fm-key')) + '"] .fm-tl') : null;
          const lab = el.querySelector('.mp-l') || el; return { el, label: shown(lab).replace(/^-+\s*/, '').trim(), own: lab.textContent.replace(/^-+\s*/, '').trim(), group: tab ? shown(tab).trim() : '' }; });
        let got = B.pickOptions(L.words, opts); if (!got.picks.length) got = B.pickOptions(L.words, opts.map((o) => ({ label: o.own, group: o.group }))); // the app's own words, when the shown ones name nothing
        rest = got.rest;
        got.picks.forEach((i) => { press(opts[i].el); picked.push({ group: opts[i].group, label: opts[i].label }); });
        const apply = menu.querySelector('[data-fm-apply]'); count = apply ? shown(apply).replace(/^(اعرض|Show)\s*/, '').trim() : ''; if (apply) press(apply); await wait(250);
      }
    }
    // the words no choice took: the table's own search (inside what the filter left)
    let searched = ''; let rows = null;
    if (rest.length) {
      const tq = await until(() => [...main().querySelectorAll('[data-tq-btn]')].find(vis), picked.length ? 800 : 3000);
      if (tq) { if (![...main().querySelectorAll('[data-tq-row] input')].some(vis)) press(tq); const inp = await until(() => [...main().querySelectorAll('[data-tq-row] input')].find(vis), 1200);
        if (inp) { searched = rest.join(' '); inp.value = searched; inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(600);
          // the table may be drawn again after the search: the rows are counted where the search row is now
          const now = [...main().querySelectorAll('[data-tq-row] input')].find(vis) || inp; const card = now.closest('.card') || main(); rows = [...card.querySelectorAll('tbody tr')].filter(vis).length; } }
    }
    if (!picked.length && !searched) return { ok: false, picked, searched, count, text: tx('فتحت ', 'Opened ') + name + tx('، بس مالقيتش في الفلتر اختيار بالكلام ده: ', ', but found no filter choice for: ') + (L.words || []).join(' ') + '.' };
    const parts = picked.map((p) => (p.group ? p.group + ' = ' : '') + p.label);
    const text = tx('فلترت ', 'Filtered ') + name + (parts.length ? ': ' + parts.join(tx('، ', ', ')) : '') + (searched ? (parts.length ? tx('، وبحثت عن «', ', and searched for “') : tx(': بحثت عن «', ': searched for “')) + searched + tx('»', '”') : '')
      + ' — ' + (searched ? rows + tx(' صف', ' rows') : count) + '.';
    return { ok: true, text, picked, searched, count: searched ? String(rows) : count };
  }
  window.IBPageFilter = { run };
})();
