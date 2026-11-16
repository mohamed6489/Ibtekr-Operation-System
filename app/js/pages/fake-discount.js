// «الخصم الوهمي» بالشرايح (the owner 15 Nov — docs/superpowers/plans/2026-11-15-fake-discount.md: «نحط ف الاعدادات حاجة لحساب الخصم
// الوهمي الافتراضي و اعدل رينج النسبة او الرقم … و اقدر اضيف ارقام زي منا ما عايز و اختار كلمة فيما فوق ف اخر واحدة … كمان اقدر اعدلها
// من خطوة … الاسعار»). Not a block. One popup for the tiers, used by the settings card (block 17) and by the studio's prices step
// (products-flow.js), and the default rule every price is worked out with:
//   IBFakeDiscount.rule()            the default tiers (IBSettings.fakeRule — the row «makers», key `fake`), or null
//   IBFakeDiscount.lines(rule)       [['من 0 لـ 1,000', '+ 500 ج.م'], …]
//   IBFakeDiscount.text(rule)        one line of them («…» for the old sale + 15–30%)
//   IBFakeDiscount.editor({ title, rule, note, asDefault, onSave(rule | null, { asDefault }) })
// The rules themselves are the products domain's (PD.fakeRule / fakeRegular / fakeLines).
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Button } = U;
  const PD = () => window.IbtekrProducts; const SET = () => window.IBSettings;
  const n0 = (x) => { const n = Number(x); return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(x); };
  const OLD = 'سعر البيع + 15–30% عشوائي لأقرب 10';
  // Before 0106 the tiers reach nobody through settings_public: the admin has them in his own settings rows, which load with the
  // settings page only — so they are read once here (and the products page drawn again when they turn out to be different).
  let asked = false;
  const rule = () => {
    const S0 = SET(); if (!S0 || !S0.fakeRule) return null;
    if (!asked && S0.ensure && S0.can && S0.can().admin && S0.data && !S0.data.loaded) {
      asked = true; const before = JSON.stringify(S0.fakeRule());
      Promise.resolve(S0.ensure()).then(() => { const P0 = window.IBPages; if (JSON.stringify(S0.fakeRule()) !== before && P0 && P0.current === 'products' && !document.querySelector('.modal[role=dialog]')) P0.render('products'); }).catch(() => {});
    }
    return S0.fakeRule();
  };
  const addText = (t) => '+ ' + n0(t.value) + (t.type === 'percent' ? '%' : ' ج.م');
  const rangeText = (l) => (l.to === null ? 'من ' + n0(l.from) + ' فيما فوق' : 'من ' + n0(l.from) + ' لـ ' + n0(l.to));
  const lines = (r) => PD().fakeLines(r).map((l) => [rangeText(l), addText(l)]);
  const text = (r) => { const L = lines(r); return L.length ? L.map((x) => x[0] + ': ' + x[1]).join(' · ') : OLD; };
  const num = (v) => { const s = String(v == null ? '' : v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, '').trim(); return s === '' ? NaN : Number(s); };

  function editor(opts) {
    const o = opts || {}; const P = PD(); let seq = 0;
    const start = P.fakeRule(o.rule); const rows = []; const values = { sample: '1200', asDefault: false };
    const push = (t) => { const k = 'r' + (++seq); rows.push({ k, open: t.to === null }); values['to_' + k] = t.to === null ? '' : String(t.to); values['val_' + k] = t.value === '' ? '' : String(t.value); values['type_' + k] = t.type; return k; };
    (start ? start.tiers : [{ to: null, type: 'amount', value: '' }]).forEach(push);
    const collect = (f) => ({ tiers: rows.map((r) => ({ to: r.open ? null : num(f['to_' + r.k]), type: f['type_' + r.k] === 'percent' ? 'percent' : 'amount', value: num(f['val_' + r.k]) })) });
    // a tier starts after the highest «لحد» above it (a wrong one under a bigger one does not pull the rest back)
    const fromOf = (f, i) => { let top = 0; for (let j = 0; j < i; j += 1) { const t = num(f['to_' + rows[j].k]); if (Number.isFinite(t) && t > top) top = t; } return top > 0 ? Math.floor(top) + 1 : 0; };
    // the owner 16 Nov («لو كتبت مثلا من 1000 في خانة الي هيبقي لازم اعلي من اللي قبليه في عمود من»): a tier's «لحد» is bigger
    // than its own «من» — said under the field while it is typed, and «حفظ» stops on it
    const toErr = (f, i) => { const r = rows[i]; if (!r || r.open) return ''; const t = num(f['to_' + r.k]); if (!Number.isFinite(t)) return ''; const from = fromOf(f, i);
      return t <= from ? 'لازم يبقى أكبر من ' + n0(from) : ''; };
    const validate = (f) => {
      const er = {};
      rows.forEach((r, i) => {
        const type = f['type_' + r.k] === 'percent' ? 'percent' : 'amount'; const v = num(f['val_' + r.k]);
        if (!Number.isFinite(v) || v <= 0) er['val_' + r.k] = 'اكتب الزيادة (أكبر من صفر)';
        else if (v > (type === 'percent' ? P.FAKE_PERCENT_MAX : P.FAKE_AMOUNT_MAX)) er['val_' + r.k] = type === 'percent' ? 'النسبة لحد ' + n0(P.FAKE_PERCENT_MAX) + '%' : 'الرقم لحد ' + n0(P.FAKE_AMOUNT_MAX);
        if (r.open) { if (i !== rows.length - 1) er['to_' + r.k] = '«فيما فوق» لآخر شريحة بس'; return; }
        const t = num(f['to_' + r.k]);
        if (!Number.isFinite(t) || t <= 0) er['to_' + r.k] = 'اكتب آخر سعر في الشريحة';
        else if (toErr(f, i)) er['to_' + r.k] = toErr(f, i);
      });
      return er;
    };
    let refs = []; let sampleEl = null;
    const sampleText = (f) => {
      const s = num(f.sample); if (!Number.isFinite(s) || s <= 0) return 'اكتب سعر بيع تجرّب بيه.';
      if (!rows.length) return 'من غير شرايح: ' + OLD + '.';
      if (Object.keys(validate(f)).length) return 'كمّل الشرايح الأول.';
      const reg = P.fakeRegular(s, collect(f));
      return reg == null ? 'السعر ده أعلى من آخر شريحة — هيتحسب بالطريقة القديمة (' + OLD + ').' : 'سعر البيع ' + n0(s) + ' ← قبل الخصم ' + n0(reg) + ' ج.م';
    };
    // a field that was marked wrong is drawn again on its first keystroke (K.form clears the error) — the typing goes on in the new one
    const typed = (el, id, f, set) => { set(id, el.value); if (el.isConnected) { refresh(f); return; } const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (_) { /* not a text field */ } } };
    const refresh = (f) => {
      refs.forEach((ref, i) => { if (ref) ref.textContent = n0(fromOf(f, i)); });
      // every «لحد» checked again — a change up the list moves the «من» under it
      rows.forEach((r, i) => { const el = document.getElementById('to_' + r.k); const msg = document.querySelector('[data-fk-err="to:' + (i + 1) + '"]'); if (!el || !msg) return;
        const m = toErr(f, i) || (el.value.trim() === '' ? msg.dataset.blank || '' : ''); msg.textContent = m; msg.hidden = !m; el.classList.toggle('err', !!m); el.setAttribute('aria-invalid', m ? 'true' : 'false'); });
      if (sampleEl) sampleEl.textContent = sampleText(f);
    };
    K.form({ title: o.title || 'الخصم الوهمي', wide: 'mid', values, submitLabel: o.submitLabel || 'حفظ',
      note: o.note ? U.InlineNote({ children: o.note }) : null,
      validate,
      fields: (f, e, set, draw) => {
        refs = [];
        const inp = (r, key, lab, i, ph) => { const id = key + '_' + r.k; const live = key === 'to'; const msg = e[id] || (live ? toErr(f, i) : '');
          return h('span', { class: 'fk-cell' }, h('input', { type: 'text', class: 'input' + (msg ? ' err' : ''), id, dir: 'ltr', inputmode: 'decimal', value: f[id] || '', placeholder: ph, 'aria-label': lab + ' — الشريحة ' + (i + 1),
            'aria-invalid': msg ? 'true' : null, 'aria-describedby': live || msg ? 'err_' + id : null, 'data-fk': key + ':' + (i + 1), onInput: (ev) => typed(ev.target, id, f, set) }),
            live || msg ? h('span', { class: 't-small err-text', id: 'err_' + id, role: live ? 'status' : null, 'data-fk-err': key + ':' + (i + 1), 'data-blank': live && e[id] && !toErr(f, i) ? e[id] : null, hidden: msg ? null : '' }, msg) : null); };
        const typeBtn = (r, i, val, lab) => { const on = (f['type_' + r.k] === 'percent' ? 'percent' : 'amount') === val;
          return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-fk': 'type:' + (i + 1) + ':' + val, 'aria-label': (val === 'percent' ? 'نسبة' : 'رقم بالجنيه') + ' — الشريحة ' + (i + 1), onClick: () => { set('type_' + r.k, val); draw(); } }, lab); };
        const list = rows.map((r, i) => {
          const last = i === rows.length - 1; const from = h('b', { class: 'num', 'data-fk-from': String(i + 1) }, n0(fromOf(f, i))); refs.push(from);
          const openBox = last ? h('label', { class: 'fk-open' + (r.open ? ' on' : '') }, h('input', { type: 'checkbox', checked: r.open ? '' : null, 'data-fk': 'open', onChange: (ev) => { r.open = ev.target.checked; if (r.open) set('to_' + r.k, ''); draw(); } }), h('span', r.open ? { 'data-fk-open-text': '' } : null, 'فيما فوق')) : null;
          return h('div', { class: 'fk-row', role: 'listitem', 'data-fk-row': String(i + 1) },
            h('span', { class: 'fk-idx num' }, String(i + 1)),
            h('span', { class: 'fk-from' }, h('small', { class: 'fk-lab' }, 'من'), from),
            h('span', { class: 'fk-to' }, h('small', { class: 'fk-lab' }, 'لحد'), r.open ? null : inp(r, 'to', 'آخر سعر بيع في الشريحة', i, 'مثلًا 1000'), openBox),
            h('span', { class: 'fk-add' }, h('small', { class: 'fk-lab' }, 'نزوّد'), inp(r, 'val', 'الزيادة', i, 'مثلًا 500')),
            h('span', { class: 'fk-type', role: 'group', 'aria-label': 'نوع الزيادة' }, typeBtn(r, i, 'amount', 'ج.م'), typeBtn(r, i, 'percent', '%')),
            h('span', { class: 'fk-del' }, U.IconButton({ icon: 'trash', label: 'شيل الشريحة ' + (i + 1), attrs: { 'data-fk-del': String(i + 1) }, onClick: () => { rows.splice(i, 1).forEach((x) => { delete f['to_' + x.k]; delete f['val_' + x.k]; delete f['type_' + x.k]; }); draw(); } })));
        });
        const add = () => { const lastRow = rows[rows.length - 1]; const wasOpen = !!(lastRow && lastRow.open); if (wasOpen) lastRow.open = false;
          const k = 'r' + (++seq); rows.push({ k, open: wasOpen || !rows.length ? true : false }); f['to_' + k] = ''; f['val_' + k] = ''; f['type_' + k] = lastRow ? (f['type_' + lastRow.k] || 'amount') : 'amount'; draw(); };
        sampleEl = h('span', { 'data-fk-sample': '' }, sampleText(f));
        return [
          h('p', { class: 't-small help', style: 'margin:0' }, '«قبل الخصم» = سعر البيع + زيادة شريحته. الرقم بيتزود زي ما هو، والنسبة بتتقرّب لفوق لأقرب 10. السعر اللي مالوش شريحة بيتحسب بالطريقة القديمة (' + OLD + ').'),
          rows.length ? h('div', { class: 'fk-table' }, h('div', { class: 'fk-head', 'aria-hidden': 'true' }, h('span', null, '#'), h('span', null, 'من'), h('span', null, 'لحد'), h('span', null, 'نزوّد'), h('span', null, 'النوع'), h('span', null, '')),
            h('div', { class: 'fk-list', role: 'list', 'aria-label': 'شرايح الخصم الوهمي', 'data-fk-list': '' }, list)) : h('p', { class: 't-small', 'data-fk-empty': '' }, 'مفيش شرايح — «قبل الخصم» هيتحسب بالطريقة القديمة (' + OLD + ').'),
          rows.length < P.FAKE_MAX ? h('div', null, Button({ type: 'text', size: 'sm', icon: 'plus', label: 'إضافة شريحة', attrs: { 'data-fk-add': '' }, onClick: add })) : null,
          h('div', { class: 'fk-sample' }, h('label', { for: 'fk-sample', class: 't-small' }, 'جرّب بسعر بيع'), h('input', { type: 'text', class: 'input', id: 'fk-sample', dir: 'ltr', inputmode: 'decimal', value: f.sample || '', 'data-fk': 'sample', onInput: (ev) => { set('sample', ev.target.value); refresh(f); } }), h('b', null, sampleEl)),
          o.asDefault ? h('label', { class: 'fk-default' }, h('input', { type: 'checkbox', checked: f.asDefault ? '' : null, 'data-fk': 'asDefault', onChange: (ev) => set('asDefault', ev.target.checked) }), h('span', null, 'احفظها كافتراضي في الإعدادات كمان')) : null,
        ];
      },
      submit: (f) => { const clean = rows.length ? P.fakeRule(collect(f)) : null; if (o.onSave) return o.onSave(clean, { asDefault: !!f.asDefault }); return undefined; } });
  }

  window.IBFakeDiscount = { rule, lines, text, editor, OLD };
})();
