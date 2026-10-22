
/* Orders ↔ inventory hub hooks used by the orders page (orders_src.html): return popups (mandatory reason + date + impact),
   «تجميع في المخزن» popup, consolidation state, and stock side effects. Figma: orders page 1:9061 (385:21259, 385:21407, 391:21871). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h } = U; const S = K.store;
  const inv = () => window.IBPages.all().inventory.api;
  const rerenderInv = () => { if (window.IBPages.current === 'inventory') window.IBPages.render('inventory'); document.dispatchEvent(new CustomEvent('ib:notify')); };
  const cons = (orderId) => S.consolidations.find((c) => String(c.order) === String(orderId)) || null;

  function returnPopup(info, ok) {
    const toStock = info.status === 'مرتجع للمخزن';
    K.form({ title: info.status + ' — فرعي #' + info.sid, values: { date: K.TODAY },
      note: U.InlineNote({ children: info.prod + ' · ' + info.vendor + ' · IB-' + info.order + ' · ' + K.money(info.tot) + ' ج.م' }),
      fields: (f, e, set) => [K.field.select('reason', 'سبب المرتجع', O.RETURN_REASONS, f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, K.field.date('date', 'تاريخ المرتجع', f, e, set, { required: true }),
        U.InlineNote({ kind: 'warning', children: toStock ? 'الأثر: القطعة هتتسجل في المخزن «مرتجع — بانتظار الفحص» (لازم تتفحص خلال ' + S.invSettings.returnsInspect + ' ساعة) وقيمتها تتشال من مبيعات الأوردر لحد قرار الفحص.' : 'الأثر: حصة المورد في الفرعي ده بس هتتلغي (' + K.money(info.tot) + ' ج.م) والقطعة هترجع للمورد مباشرة — باقي الأوردر زي ما هو.' }),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const err = O.validateReturn({ reason: f.reason, other: f.other }); const e = {}; if (err) e[err === 'اكتب السبب' ? 'other' : 'reason'] = err; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitType: toStock ? 'primary' : 'danger', submitLabel: 'تسجيل ' + info.status,
      submit: (f) => {
        const reason = f.reason === 'أخرى' ? 'أخرى: ' + f.other.trim() : f.reason;
        const key = 'L-R-' + info.sid + '-' + Date.now();
        if (toStock) { S.stock.unshift({ key, sku: info.sku || 'SUB-' + info.sid, name: info.prod, vendor: info.vendor, reason: 'مرتجع', status: 'بانتظار الفحص', ref: '#' + info.sid, order: info.order, since: f.date, loc: 'R-02', cost: info.tot, mode: 'أمانة' });
          S.ledger.unshift({ at: f.date + ' ' + K.clockNow(), key, type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#' + info.sid, by: K.member(K.ME).name, note: 'بانتظار الفحص' }); K.notify({ title: 'مرتجع وصل المخزن — ' + info.prod, link: '#inventory-returns' }); }
        S.returns.unshift({ name: info.prod, vendor: info.vendor, mode: 'أمانة', sub: '#' + info.sid, type: info.status, reason, at: K.dshort(f.date), status: toStock ? 'بانتظار الفحص' : 'اتسلم للمورد', effect: toStock ? '+ 1 بعد الفحص' : 'نصيب ' + info.vendor + ' اتلغى', key: toStock ? key : null });
        K.logEvent('suborder.' + (toStock ? 'returnToStock' : 'returnToVendor'), '#' + info.sid + ' · ' + reason);
        ok({ reason, date: f.date, note: f.note || '' }); K.toast('اتسجل ' + info.status, 'success'); rerenderInv();
      } });
  }
  // Main order → «استرجاع» or «ملغي» (owner 22 Oct): reason popup (reason + date + note), «تأكيد» / «ليس الآن».
  // The reasons feed the «أوردرات ملغية» report.
  function orderReasonPopup(info, ok) {
    const cancel = info.kind === 'ملغي'; const word = cancel ? 'الإلغاء' : 'الاسترجاع';
    K.form({ title: (cancel ? 'إلغاء' : 'استرجاع') + ' — IB-' + info.order, values: { date: K.TODAY },
      note: U.InlineNote({ children: info.name + ' · IB-' + info.order + ' · ' + K.money(info.tot) + ' ج.م · ' + info.subs + ' أوردر فرعي · الحالة الحالية «' + (info.from || '—') + '»' }),
      fields: (f, e, set) => [K.field.select('reason', 'سبب ' + word, cancel ? O.CANCEL_REASONS : O.RETURN_REASONS, f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, K.field.date('date', 'تاريخ ' + word, f, e, set, { required: true }),
        U.InlineNote({ kind: 'warning', children: cancel ? 'الأثر: الأوردر هيتقفل كـ «ملغي» وقيمته (' + K.money(info.tot) + ' ج.م) مش هتتحسب في المبيعات. السبب بيظهر في تقارير الأوردرات › أوردرات ملغية.' : 'الأثر: الأوردر هيتقفل كـ «استرجاع» وقيمته (' + K.money(info.tot) + ' ج.م) تتشال من المبيعات. الأوردرات الفرعية اللي هترجع للمخزن أو للمورد تتسجل من حالة كل فرعي.' }),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const err = cancel ? O.validateCancel({ reason: f.reason, other: f.other }) : O.validateReturn({ reason: f.reason, other: f.other }); const e = {}; if (err) e[err === 'اكتب السبب' ? 'other' : 'reason'] = err === 'اختار سبب المرتجع' ? 'اختار سبب الاسترجاع' : err; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitType: 'danger', submitLabel: 'تأكيد', cancelLabel: 'ليس الآن',
      submit: (f) => { const reason = f.reason === 'أخرى' ? 'أخرى: ' + f.other.trim() : f.reason; K.logEvent(cancel ? 'order.cancel' : 'order.refund', 'IB-' + info.order + ' · ' + reason); ok({ reason, date: f.date, note: f.note || '' }); K.toast('IB-' + info.order + (cancel ? ' اتلغى — ' : ' اتسجل استرجاع — ') + reason, 'success'); document.dispatchEvent(new CustomEvent('ib:notify')); } });
  }
  const orderReturnPopup = (info, ok) => orderReasonPopup(Object.assign({ kind: 'استرجاع' }, info), ok);
  function subChanged(orderId, sid, v, sub, opts) {
    const c = cons(orderId); if (!c) { rerenderInv(); return; }
    const row = c.subs.find((x) => String(x[0]) === String(sid)); if (!row) return;
    const was = row[2]; row[2] = v;
    if (v === 'وصل المخزن' && was !== v && !(opts && opts.stockAdded)) { const key = 'L-' + orderId + '-' + sid + '-' + Date.now(); S.stock.unshift({ key, sku: sub.sku || 'SUB-' + sid, name: sub.prod, vendor: sub.vendor, reason: 'تجميع أوردر', status: 'وصل المخزن', ref: 'IB-' + orderId, sub: sid, order: orderId, since: K.TODAY, loc: c.zone, cost: sub.tot });
      S.ledger.unshift({ at: K.TODAY + ' ' + K.clockNow(), key, type: 'in', qty: sub.qty || 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-' + orderId + ' · #' + sid, by: K.member(K.ME).name, note: 'وصل من ' + sub.vendor }); }
    if (O.consolidation(c.subs.map((x) => x[2])).ready) { S.stock.forEach((x) => { if (String(x.order) === String(orderId) && x.reason === 'تجميع أوردر') x.status = 'جاهز يطلع كامل'; }); K.notify({ title: 'IB-' + orderId + ' جاهز يطلع كامل من المخزن', link: '#inventory-consolidate' }); }
    rerenderInv();
  }
  // «تجميع في المخزن» popup: choose sub-orders + zone
  function consPopup(o) {
    const used = S.consolidations.map((c) => c.zone); const free = ['T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06'].filter((z) => !used.includes(z));
    const pick = {}; o.subs.forEach((s) => { pick[s.sid] = !s.pulled && s.ss !== 'تم الشحن للعميل'; });
    K.form({ title: 'تجميع في المخزن — IB-' + o.id, values: { zone: free[0] || '' }, note: U.InlineNote({ children: 'الفرعيات المختارة هتتشحن من المبتكرين للمخزن وتطلع للعميل في شحنة واحدة. تنبيه لو التجميع عدّى ' + S.invSettings.consolidationAlert + ' أيام.' }),
      fields: (f, e, set, draw) => [h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'الفرعيات اللي هتتجمع *'), ...o.subs.map((s) => K.Checkbox({ label: '#' + s.sid + ' · ' + s.prod + ' — ' + (s.pulled ? 'مخزن ابتكر' : s.vendor) + (s.ss ? ' (' + s.ss + ')' : ''), checked: pick[s.sid], disabled: s.pulled, onChange: (v) => { pick[s.sid] = v; draw(); } })), e.subs ? h('div', { class: 'err-msg', role: 'alert' }, e.subs) : null),
        K.field.select('zone', 'منطقة التجميع', free.length ? free : ['T-07'], f, e, set, { required: true })],
      validate: (f) => { const n = Object.values(pick).filter(Boolean).length; const e = {}; if (n < 2) e.subs = 'اختار فرعيين على الأقل — التجميع لأكتر من مبتكر'; if (!f.zone) e.zone = 'اختار المنطقة'; return e; },
      submitLabel: 'ابدأ التجميع', submit: (f) => { const subs = o.subs.filter((s) => pick[s.sid]).map((s) => [s.sid, s.vendor, s.ss === 'وصل المخزن' ? 'وصل المخزن' : s.ss || 'قيد التنفيذ']);
        S.consolidations.unshift({ order: o.id, customer: o.name, subs, since: K.TODAY, zone: f.zone, by: K.member(K.ME).name }); K.logEvent('order.consolidate', 'IB-' + o.id + ' · ' + subs.length + ' فرعي · ' + f.zone); K.toast('IB-' + o.id + ' بيتجمع في المخزن (' + f.zone + ')', 'success'); window.OrdersSetSub && window.OrdersSetSub('__redraw__', null); rerenderInv(); } });
  }
  // «وصل المخزن» on a sub-order → choose the storage reason (owner 22 Oct). The stock row is added by the popup.
  const arrivalPopup = (info, ok) => inv().arrival(Object.assign({ inConsolidation: !!cons(info.order) }, info), ok);
  window.IBOrdersOps = { cons, returnPopup, orderReturnPopup, orderReasonPopup, subChanged, arrivalPopup, consolidate: consPopup,
    shipall: (o) => { const c = cons(o.id); if (c) inv().shipAll(c); },
    uncons: (o) => { const c = cons(o.id); if (c) inv().cancelCons(c); } };
})();

