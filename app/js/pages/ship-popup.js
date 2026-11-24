/* Ibtekr — «تم الشحن» (the meeting of 23 Nov [#15], docs/superpowers/plans/2026-11-23-meeting.md phase 2.7). Not a block.
   A product set «تم الشحن للمخزن» asks how it went to the warehouse; a product set «تم الشحن للعميل» or the whole order set «قيد الشحن»
   asks how it goes to the customer (Safwat 23 Nov: «الشحن زي ما قلت»). Nothing is written on the site.
   · to the warehouse: بوسطة (the pickup's amount asked every time — Safwat 23 Nov — on the maker as «مواصلات») · توصيلة (the app typed,
     «أوبر» by default, and its amount — on the maker as «مواصلات», the rule of the transport moves) · المبتكر جابه بنفسه · مندوبنا;
   · to the customer: بوسطة (recorded; the waybill by its own button, never by itself) · توصيلة (the app, the amount, who pays: the company
     → an «المصروفات» expense «مواصلات — أوردر IB-…» (Safwat 23 Nov), the customer → on the order as his shipping charges, the system's only).
   Every money row asks its account (0143 — the rule of every popup that moves money) and is written through IBAccounts first; then the
   shipment through IBOrders.addShipment (order_shipment_add — the order's timeline), logged order.shipment. */
(function () {
  'use strict';
  const K = () => window.IBKit; const U = () => window.IBUI;
  const RIDE_APP = 'أوبر';
  const WH = [['bosta', 'بوسطة'], ['ride', 'توصيلة'], ['maker', 'المبتكر جابه بنفسه'], ['courier', 'مندوبنا']];
  const CU = [['bosta', 'بوسطة'], ['ride', 'توصيلة']];
  const PAYERS = [['company', 'الشركة'], ['customer', 'العميل']];
  const accounts = () => { const D = window.IbtekrDomain; return D && D.ACCOUNTS ? D.ACCOUNTS.slice() : ['حساب البنك', 'حساب بوسطة']; };
  const today = () => (window.IBOrders && window.IBOrders.today ? window.IBOrders.today() : new Date().toISOString().slice(0, 10));
  const canMoney = () => { const D = window.IBDirectory; return !!(D && D.perm && D.perm('accounts.add') === 'F'); };
  const money = (f) => (f.leg === 'warehouse' && (f.method === 'bosta' || f.method === 'ride')) || (f.leg === 'customer' && f.method === 'ride' && f.payer === 'company');
  const asking = new Set(); const queue = []; let open = false; // the bulk «قيد الشحن» asks order by order, one popup at a time

  // the pure rules — the shapes order_shipment_add accepts (tests/domain/ship-popup.test.mjs)
  function validate(f) {
    const e = {}; const amt = Number(String(f.amount || '').replace(/[^\d.]/g, ''));
    if (!f.method) e.method = 'اختار الطريقة';
    if (f.method === 'ride') {
      const app = String(f.app || '').trim();
      if (!app) e.app = 'اكتب اسم التطبيق'; else if (app.length > 40 || /[<>]/.test(app)) e.app = 'اسم التطبيق 40 حرف بالكتير من غير < >';
      if (!(amt > 0)) e.amount = 'اكتب القيمة';
      if (f.leg === 'customer' && !['company', 'customer'].includes(f.payer)) e.payer = 'مين دافع؟';
    }
    if (f.leg === 'warehouse' && f.method === 'bosta' && !(amt > 0)) e.amount = 'اكتب مبلغ البيك أب';
    if (money(f) && !f.account) e.account = 'اختار الحساب';
    return e;
  }
  const amountOf = (f) => Number(String(f.amount || '').replace(/[^\d.]/g, '')) || null;

  async function save(info, f) {
    const A = window.IBAccounts; const O = window.IBOrders; const o = info.order; const s = info.line || {};
    const amt = amountOf(f); let vendorMoveId = null; let expenseId = null;
    if (money(f)) {
      if (!canMoney()) return { ok: false, msg: 'تسجيل الفلوس محتاج صلاحية «إضافة» في الحسابات — اطلبها من الأدمن' };
      if (!A || !A.add) return { ok: false, msg: 'الحسابات مش متحمّلة — جرّب تاني' };
      if (f.leg === 'warehouse') {
        if (!s.vendorId) return { ok: false, msg: 'المنتج ده مالوش مبتكر — مش هقدر أخصم المواصلات' };
        const r = await A.add('vendorMoves', { vendorId: s.vendorId, date: today(), direction: 'withdraw', type: 'مواصلات', amount: amt, account: f.account,
          note: (f.method === 'bosta' ? 'بيك أب بوسطة' : 'توصيلة ' + String(f.app).trim()) + ' للمخزن — أوردر IB-' + o.id + (s.sid ? ' · #' + s.sid : '') }, { dupOk: true });
        if (!r.ok) return { ok: false, msg: 'المواصلات ماتسجلتش على المبتكر' + (r.reason === 'forbidden' ? ' — مش مسموح لك' : '') };
        vendorMoveId = r.rec && r.rec.id;
      } else {
        const r = await A.add('expenses', { date: today(), direction: 'withdraw', category: 'المصروفات', details: 'مواصلات — أوردر IB-' + o.id, amount: amt, account: f.account,
          beneficiaryName: String(f.app).trim(), beneficiaryIsOther: true, note: 'توصيل للعميل' }, { dupOk: true });
        if (!r.ok) return { ok: false, msg: 'المصروف ماتسجلش' + (r.reason === 'forbidden' ? ' — مش مسموح لك' : '') };
        expenseId = r.rec && r.rec.id;
      }
    }
    if (!O || !O.addShipment) return { ok: false, msg: 'الأوردرات مش متحمّلة — جرّب تاني' };
    const r = await O.addShipment(o.id, { leg: f.leg, method: f.method, itemId: s.itemId || null, app: f.method === 'ride' ? String(f.app).trim() : null,
      amount: f.method === 'ride' || (f.leg === 'warehouse' && f.method === 'bosta') ? amt : null, payer: f.leg === 'customer' && f.method === 'ride' ? f.payer : null, vendorMoveId, expenseId });
    if (!r.ok) return { ok: false, msg: r.reason === 'forbidden' ? 'مش مسموح لك تسجّل الشحن' : r.reason === 'invalid' ? 'البيانات ناقصة' : 'الشحن ماتسجلش — جرّب تاني' };
    return { ok: true };
  }

  // info: { leg: 'warehouse' | 'customer', order: { id, name, trk }, line: { itemId, vendorId, vendor, prod, sid } | null, onDone }
  function ask(info) {
    const k = info.leg + ':' + info.order.id + ':' + ((info.line && info.line.itemId) || '');
    if (asking.has(k) || !K() || !K().form) return; asking.add(k);
    if (open) { queue.push(info); return; }
    show(info, k);
  }
  function show(info, k) {
    open = true;
    const wh = info.leg === 'warehouse'; const s = info.line || {};
    const sub = wh ? 'IB-' + info.order.id + (s.prod ? ' · ' + s.prod : '') + (s.vendor ? ' · ' + s.vendor : '') : 'IB-' + info.order.id + (info.order.name ? ' · ' + info.order.name : '');
    K().form({ title: wh ? 'اتشحن للمخزن — إزاي؟' : 'اتشحن للعميل — إزاي؟', wide: true,
      values: { leg: info.leg, method: '', app: RIDE_APP, amount: '', payer: '', account: '' },
      onClose: () => { asking.delete(k); open = false; const n = queue.shift(); if (n) setTimeout(() => show(n, n.leg + ':' + n.order.id + ':' + ((n.line && n.line.itemId) || '')), 0); },
      note: U().InlineNote({ children: sub + ' — بيتسجل في تايملاين الأوردر وسجل النشاط، والموقع مابيتغيّرش.' }),
      fields: (f, e, set) => {
        const out = [K().Radios({ label: 'الطريقة', required: true, name: 'ship-method', options: (wh ? WH : CU).map(([value, label]) => ({ value, label })), value: f.method, error: e.method,
          onChange: (v) => { set('method', v, true); if (v === 'bosta' && wh && !f.account) set('account', 'حساب بوسطة', true); } })];
        if (f.method === 'ride') {
          out.push(K().field.text('app', 'اسم التطبيق', f, e, set, { required: true, help: 'أوبر، إن درايف أو غيره' }));
          out.push(K().field.text('amount', 'القيمة (ج.م)', f, e, set, { required: true, inputmode: 'decimal' }));
          if (!wh) out.push(K().Radios({ label: 'مين دافع؟', required: true, name: 'ship-payer', options: PAYERS.map(([value, label]) => ({ value, label })), value: f.payer, error: e.payer, onChange: (v) => set('payer', v, true) }));
        }
        if (wh && f.method === 'bosta') out.push(K().field.text('amount', 'مبلغ البيك أب (ج.م)', f, e, set, { required: true, inputmode: 'decimal' }));
        if (money(f)) out.push(K().field.select('account', 'من حساب', accounts(), f, e, set, { required: true }));
        const why = wh && (f.method === 'bosta' || f.method === 'ride') ? 'القيمة بتتخصم من المبتكر كـ«مواصلات».'
          : !wh && f.method === 'ride' && f.payer === 'company' ? 'بتتسجل مصروف «المصروفات» — مواصلات الأوردر.'
            : !wh && f.method === 'ride' && f.payer === 'customer' ? 'بتتسجل على الأوردر في السيستم بس كمصاريف شحن على العميل — الأوردر على الموقع مابيتغيّرش.'
              : !wh && f.method === 'bosta' ? 'بيتسجل بس — البوليصة بزرار «اطبع البوليصة».' : null;
        if (why) out.push(U().h('p', { class: 't-small help', style: 'margin:0', 'data-ship-why': '' }, why));
        if (!wh && f.method === 'bosta' && window.IBBosta && window.IBBosta.print) out.push(U().Button({ label: 'اطبع البوليصة', icon: 'file', attrs: { 'data-ship-awb': '' }, onClick: () => window.IBBosta.print({ ids: [Number(info.order.id)] }) }));
        return out;
      },
      validate,
      submitLabel: 'سجّل الشحن', cancelLabel: 'ليس الآن',
      submit: (f, m) => {
        if (m._busy) return false; m._busy = true;
        const b = K().busy ? K().busy('بنسجّل الشحن…') : null;
        save(info, f).then((r) => {
          m._busy = false;
          if (!r.ok) { if (b) b.fail(r.msg); else K().toast(r.msg, 'error'); return; }
          if (b) b.done('اتسجل الشحن'); m.close(); if (info.onDone) info.onDone();
        });
        return false;
      } });
  }
  window.IBShip = { ask, validate, money, RIDE_APP };
})();
