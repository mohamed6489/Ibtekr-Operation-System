/* Ibtekr — «فقد» (the meeting of 23 Nov #39, docs/superpowers/plans/2026-11-23-meeting.md phase 6; Safwat 24 Nov). Not a block.
   A lost return is recorded «مرتجع» with the status «فقد» and its value (the orders page's return popup or «فحص مرتجع» in the hub). The
   maker's «مفقود» tab and the column in the makers' accounts show them — shown only: they change neither the maker's balance nor ours.
   «فقد» opens the decision: «حوّلها لحساب المبتكر» (an «إيداع» on his account — «مفقود محسوب») or «حوّلها مفقودات» (recorded only, no
   account moves — «مفقود غير محسوب»), with the amount and the reason (فقد المنتج · تلف المنتج في المخزن · أخرى + text); both go in
   «مفقودات» (the accounts' tab; Safwat 24 Nov — first called «ديون معدومة»), through IBLost. */
(function () {
  'use strict';
  const K = () => window.IBKit; const U = () => window.IBUI; const L = () => window.IBLost;
  const h = (...a) => window.IBUI.h(...a);
  const num = (v) => Number(String(v == null ? '' : v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, ''));
  const money = (v) => (K() && K().money ? K().money(v) : String(v));
  const KINDS = [['deposit', 'حوّلها لحساب المبتكر'], ['writeoff', 'حوّلها مفقودات']]; // Safwat 24 Nov: «مفقود محسوب» / «مفقود غير محسوب»

  // the pure rules — the shapes acc_bad_debt_add accepts (tests/domain/lost-ui.test.mjs)
  function validate(f, reasons) {
    const e = {}; const note = String(f.note || '').trim();
    if (!f.kind) e.kind = 'اختار تحوّلها فين';
    if (!(num(f.amount) > 0)) e.amount = 'اكتب المبلغ';
    if (!(reasons || []).includes(f.reason)) e.reason = 'اختار السبب';
    if (f.reason === 'أخرى' && !note) e.note = 'اكتب السبب';
    if (note.length > 300 || /[<>]/.test(note)) e.note = 'السبب 300 حرف بالكتير من غير < >';
    return e;
  }

  // the decision on a lost piece ({ id, name, value, vendorName, order }) → done(true) after it is written
  function decide(lot, vendorName, done) {
    const A = L(); if (!A || !A.can()) { K().toast('القرار للحسابات بس (إضافة في الحسابات)', 'error'); return; }
    const KK = K(); const UU = U(); const err = (m) => h('div', { class: 'err-msg', role: 'alert' }, m);
    KK.form({ title: 'فقد — ' + lot.name, values: { kind: '', amount: String(Math.round(lot.value || 0)), reason: 'فقد المنتج', note: '' },
      note: UU.InlineNote({ children: (vendorName || '') + (lot.order ? ' · IB-' + lot.order : '') + ' · قيمة المنتج ' + money(lot.value) + ' ج.م' }),
      fields: (f, e, set) => [
        KK.Radios({ label: 'القرار *', value: f.kind, onChange: (v) => set('kind', v, true), options: KINDS.map(([v, label]) => ({ value: v, label,
          hint: v === 'deposit' ? 'المبلغ بيتضاف لحساب المبتكر (إيداع) والقطعة بتبقى «مفقود محسوب»' : 'بتفضل في مفقودات المبتكر «مفقود غير محسوب» — مفيش فلوس بتتحرك' })) }), e.kind ? err(e.kind) : null,
        KK.field.text('amount', 'المبلغ (ج.م)', f, e, set, { required: true, inputmode: 'decimal' }),
        KK.Radios({ label: 'السبب *', value: f.reason, onChange: (v) => set('reason', v, true), options: A.REASONS.map((r) => ({ value: r, label: r })) }), e.reason ? err(e.reason) : null,
        KK.field.area('note', f.reason === 'أخرى' ? 'اكتب السبب' : 'ملاحظة', f, e, set, { required: f.reason === 'أخرى', placeholder: f.reason === 'أخرى' ? '' : 'اختياري' })],
      validate: (f) => validate(f, A.REASONS), submitLabel: 'سجّل',
      submit: (f, m) => {
        m._busy = true;
        A.decide(lot.id, { kind: f.kind, amount: num(f.amount), reason: f.reason, note: f.note }).then((r) => {
          m._busy = false;
          if (r.ok) { m.close(); KK.toast(f.kind === 'deposit' ? 'اتحوّلت لحساب ' + (vendorName || 'المبتكر') + ' (' + money(num(f.amount)) + ' ج.م) — مفقود محسوب' : 'اتسجلت مفقود غير محسوب (' + money(num(f.amount)) + ' ج.م)', 'success'); if (done) done(true); return; }
          KK.toast(r.reason === 'forbidden' ? 'الصلاحية دي مش عندك' : r.field === 'decided' ? 'القطعة دي اتاخد فيها قرار قبل كده' : r.reason === 'invalid' ? 'راجع البيانات' : 'ماتسجلش — جرّب تاني', 'error');
          if (r.field === 'decided' && done) { m.close(); done(false); }
        });
        return false;
      } });
  }

  // the decision's cell: «مفقود محسوب · 300» / «مفقود غير محسوب · 300», else «فقد» (a button for a member who may decide)
  function decisionCell(lot, vendorName, done) {
    const d = lot.decision;
    if (d) return h('span', { class: 'tg tg-' + (d.kind === 'deposit' ? 'gold' : 'neutral'), 'data-lost-decision': d.kind }, (d.kind === 'deposit' ? 'مفقود محسوب · ' : 'مفقود غير محسوب · ') + money(d.amount));
    return L() && L().can() ? h('button', { type: 'button', class: 'tg tg-error lost-btn', 'data-lost-decide': lot.id, title: 'حوّلها لحساب المبتكر أو مفقودات', onClick: () => decide(lot, vendorName, done) }, 'فقد')
      : h('span', { class: 'tg tg-error', 'data-lost-open': lot.id }, 'فقد');
  }

  // the maker's «مفقود» tab: his lost pieces, the total, the note that it moves no balance
  function vendorSection(v, redraw) {
    const A = L(); if (!A) return null;
    if (A.state() === 'idle') A.ensure().then(redraw);
    const rows = A.forVendor(v.id); const UU = U();
    const total = rows.reduce((s, l) => s + l.value, 0);
    const day = (d) => (d ? d.split('-').reverse().join('/') : '—');
    return h('div', { class: 'drawer-b', 'data-lost-tab': '' },
      h('section', { class: 'sec' }, h('div', { class: 'head' }, h('h3', { class: 't-label' }, 'مفقودات'), h('span', { class: 't-small', 'data-lost-total': '' }, rows.length + ' قطعة · ' + money(total) + ' ج.م')),
        A.state() === 'loading' ? UU.InlineNote({ children: 'بنحمّل…' })
          : rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'mini-table lost-table' },
            h('thead', null, h('tr', null, ['المنتج', 'الأوردر', 'القيمة', 'التاريخ', 'القرار'].map((x) => h('th', { scope: 'col' }, x)))),
            h('tbody', null, ...rows.map((l) => h('tr', { 'data-lost': l.id }, h('td', { dir: 'auto' }, l.name), h('td', null, l.order ? 'IB-' + l.order : (l.ref || '—')),
              h('td', null, money(l.value)), h('td', null, day(l.day)), h('td', null, decisionCell(l, v.name, redraw)))))))
            : UU.InlineNote({ children: 'مفيش مفقودات للمبتكر ده.' }),
        UU.InlineNote({ children: 'للعرض بس — المفقودات مابتغيّرش رصيد المبتكر ولا حساب إبتكر. «فقد» بيفتح القرار: «حوّلها لحساب المبتكر» (إيداع — مفقود محسوب) أو «حوّلها مفقودات» (مفقود غير محسوب)، وبيتسجل في «الحسابات › مفقودات».' })));
  }

  window.IBLostUI = { decide, decisionCell, vendorSection, validate, KINDS };
})();
