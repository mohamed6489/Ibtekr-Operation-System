
/* Orders ↔ inventory hub hooks used by the orders page (orders_src.html): return popups (mandatory reason + date + impact),
   «تجميع في المخزن» popup, consolidation state, and stock side effects. Figma: orders page 1:9061 (385:21259, 385:21407, 391:21871).
   Phase 7 T5 (plan decisions 1 a and 2): on real data the side effects are written through IBInventory — a consolidation of the picked lines
   (order_items ids), the lot + first move of a sub-order arriving or returned to the warehouse, «جاهز يطلع كامل» on the lots — and
   the hub reloads from the server; a consolidation's sub is [sid, maker, status, product, item id]. */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h } = U; const S = K.store;
  const inv = () => window.IBPages.all().inventory.api;
  const rerenderInv = () => { if (window.IBPages.current === 'inventory') window.IBPages.render('inventory'); document.dispatchEvent(new CustomEvent('ib:notify')); };
  const cons = (orderId) => S.consolidations.find((c) => String(c.order) === String(orderId)) || null;
  const A = () => window.IBInventory || null;
  const live = () => !!(A() && window.IBSupabase && window.IBSupabase.client);
  const TODAY = () => (A() && A().today()) || K.TODAY;
  // the owner 11 Nov («تاريخ الالغاء المفروض يبقي default اليوم اللي هلغي بيه»): a popup's date starts on the real day in Cairo — K.TODAY
  // is the prototype's fixed demo day (21 Oct), and the inventory adapter (TODAY()) is not always loaded on the orders page
  const DAY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const reload = () => { if (live()) A().load().then(rerenderInv); };
  const told = (p, okMsg) => Promise.resolve(p).then((r) => { if (r && r.ok) { if (okMsg) K.toast(okMsg, 'success'); } else K.toast(r && r.reason === 'forbidden' ? 'المخزن ماتحدّثش — الصلاحية دي مش عندك' : 'المخزن ماتحدّثش — جرّب تاني', 'error'); reload(); return r || { ok: false }; });

  // phase 12 T3 (decision 10): the reasons of the settings page («القوائم والحالات») when saved, else block 12's defaults
  const reasonsOf = (k) => { const S0 = window.IBSettings; const L = S0 && S0.lists ? S0.lists() : null; return L && Array.isArray(L[k]) && L[k].length ? L[k] : (k === 'cancel' ? O.CANCEL_REASONS : O.RETURN_REASONS); };
  function returnPopup(info, ok) {
    const toStock = info.status === 'مرتجع للمخزن'; const RR = reasonsOf('returns');
    K.form({ title: info.status + ' — فرعي #' + info.sid, values: { date: DAY() },
      note: U.InlineNote({ children: info.prod + ' · ' + info.vendor + ' · IB-' + info.order + ' · ' + K.money(info.tot) + ' ج.م' }),
      fields: (f, e, set) => [K.field.select('reason', 'سبب المرتجع', RR, f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, K.field.date('date', 'تاريخ المرتجع', f, e, set, { required: true }),
        U.InlineNote({ kind: 'warning', children: toStock ? 'الأثر: القطعة هتتسجل في المخزن «مرتجع — بانتظار الفحص»' + (S.invSettings.returnsInspect ? ' (لازم تتفحص خلال ' + S.invSettings.returnsInspect + ' ساعة)' : '') + ' وقيمتها تتشال من مبيعات الأوردر لحد قرار الفحص.' : 'الأثر: حصة المبتكر في الفرعي ده بس هتتلغي (' + K.money(info.tot) + ' ج.م) والقطعة هترجع للمبتكر مباشرة — باقي الأوردر زي ما هو.' }),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const err = O.validateReturn({ reason: f.reason, other: f.other }, RR); const e = {}; if (err) e[err === 'اكتب السبب' ? 'other' : 'reason'] = err; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitType: toStock ? 'primary' : 'danger', submitLabel: 'تسجيل ' + info.status,
      submit: (f) => {
        const reason = f.reason === 'أخرى' ? 'أخرى: ' + f.other.trim() : f.reason;
        const key = live() ? A().newKey() : 'L-R-' + info.sid + '-' + Date.now();
        if (toStock && live()) told(A().addLot({ key, sku: info.sku || 'SUB-' + info.sid, name: info.prod, vendor: info.vendor, reason: 'مرتجع', status: 'بانتظار الفحص', ref: '#' + info.sid, order: info.order, sub: info.sid, itemId: info.itemId, since: f.date, loc: 'R', cost: inv().lineCost ? inv().lineCost(info.itemId, info.tot) : info.tot, mode: 'أمانة', note: reason },
          { type: 'in', qty: info.qty || 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#' + info.sid, note: 'بانتظار الفحص' }));
        if (toStock) { S.stock.unshift({ key, sku: info.sku || 'SUB-' + info.sid, name: info.prod, vendor: info.vendor, reason: 'مرتجع', status: 'بانتظار الفحص', ref: '#' + info.sid, order: info.order, since: f.date, loc: 'R-02', cost: info.tot, mode: 'أمانة' });
          S.ledger.unshift({ at: f.date + ' ' + K.clockNow(), key, type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#' + info.sid, by: K.member(K.ME).name, note: 'بانتظار الفحص' }); K.notify({ title: 'مرتجع وصل المخزن — ' + info.prod, link: '#inventory-returns' }); }
        S.returns.unshift({ name: info.prod, vendor: info.vendor, mode: 'أمانة', sub: '#' + info.sid, type: info.status, reason, at: K.dshort(f.date), status: toStock ? 'بانتظار الفحص' : 'اتسلم للمبتكر', effect: toStock ? '+ 1 بعد الفحص' : 'نصيب ' + info.vendor + ' اتلغى', key: toStock ? key : null });
        K.logEvent('suborder.' + (toStock ? 'returnToStock' : 'returnToVendor'), '#' + info.sid + ' · ' + reason);
        ok({ reason, date: f.date, note: f.note || '' }); K.toast('اتسجل ' + info.status, 'success'); rerenderInv();
      } });
  }
  // Main order → «استرجاع» or «ملغي» (owner 22 Oct): reason popup (reason + date + note), «تأكيد» / «ليس الآن».
  // The reasons feed the «أوردرات ملغية» report.
  function orderReasonPopup(info, ok, closed) {
    const cancel = info.kind === 'ملغي'; const word = cancel ? 'الإلغاء' : 'الاسترجاع'; const RS = reasonsOf(cancel ? 'cancel' : 'returns');
    K.form({ title: (cancel ? 'إلغاء' : 'استرجاع') + ' — IB-' + info.order, values: { date: DAY() }, onClose: closed,
      note: U.InlineNote({ children: info.name + ' · IB-' + info.order + ' · ' + K.money(info.tot) + ' ج.م · ' + info.subs + ' أوردر فرعي · الحالة الحالية «' + (info.from || '—') + '»' }),
      fields: (f, e, set) => [K.field.select('reason', 'سبب ' + word, RS, f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, K.field.date('date', 'تاريخ ' + word, f, e, set, { required: true }),
        U.InlineNote({ kind: 'warning', children: cancel ? 'الأثر: الأوردر هيتقفل كـ «ملغي» وقيمته (' + K.money(info.tot) + ' ج.م) مش هتتحسب في المبيعات. السبب بيظهر في تقارير الأوردرات › أوردرات ملغية.' : 'الأثر: الأوردر هيتقفل كـ «استرجاع» وقيمته (' + K.money(info.tot) + ' ج.م) تتشال من المبيعات. الأوردرات الفرعية اللي هترجع للمخزن أو للمبتكر تتسجل من حالة كل فرعي.' }),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const err = cancel ? O.validateCancel({ reason: f.reason, other: f.other }, RS) : O.validateReturn({ reason: f.reason, other: f.other }, RS); const e = {}; if (err) e[err === 'اكتب السبب' ? 'other' : 'reason'] = err === 'اختار سبب المرتجع' ? 'اختار سبب الاسترجاع' : err; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitType: 'danger', submitLabel: 'تأكيد', cancelLabel: 'ليس الآن',
      submit: (f) => { const reason = f.reason === 'أخرى' ? 'أخرى: ' + f.other.trim() : f.reason; K.logEvent(cancel ? 'order.cancel' : 'order.refund', 'IB-' + info.order + ' · ' + reason); ok({ reason, date: f.date, note: f.note || '' }); K.toast('IB-' + info.order + (cancel ? ' اتلغى — ' : ' اتسجل استرجاع — ') + reason, 'success'); document.dispatchEvent(new CustomEvent('ib:notify')); } });
  }
  const orderReturnPopup = (info, ok, closed) => orderReasonPopup(Object.assign({ kind: 'استرجاع' }, info), ok, closed);
  function subChanged(orderId, sid, v, sub, opts) {
    const c = cons(orderId); if (!c) { rerenderInv(); return; }
    const row = c.subs.find((x) => String(x[0]) === String(sid)); if (!row) return;
    const was = row[2]; row[2] = v;
    const ready = O.consolidation(c.subs.map((x) => x[2])).ready;
    if (v === 'وصل المخزن' && was !== v && !(opts && opts.stockAdded) && live()) told(A().addLot({ key: A().newKey(), sku: sub.sku || 'SUB-' + sid, name: sub.prod, vendor: sub.vendor, reason: 'تجميع أوردر', status: ready ? 'جاهز يطلع كامل' : 'وصل المخزن', ref: 'IB-' + orderId, sub: sid, itemId: sub.itemId || row[4], order: orderId, since: TODAY(), loc: c.zone, cost: inv().lineCost ? inv().lineCost(sub.itemId || row[4], sub.tot) : sub.tot },
      { type: 'in', qty: sub.qty || 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-' + orderId + ' · #' + sid, note: 'وصل من ' + sub.vendor }));
    else if (v === 'وصل المخزن' && was !== v && !(opts && opts.stockAdded)) { const key = 'L-' + orderId + '-' + sid + '-' + Date.now(); S.stock.unshift({ key, sku: sub.sku || 'SUB-' + sid, name: sub.prod, vendor: sub.vendor, reason: 'تجميع أوردر', status: 'وصل المخزن', ref: 'IB-' + orderId, sub: sid, order: orderId, since: DAY(), loc: c.zone, cost: sub.tot });
      S.ledger.unshift({ at: DAY() + ' ' + K.clockNow(), key, type: 'in', qty: sub.qty || 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-' + orderId + ' · #' + sid, by: K.member(K.ME).name, note: 'وصل من ' + sub.vendor }); }
    if (ready) { S.stock.forEach((x) => { if (String(x.order) === String(orderId) && x.reason === 'تجميع أوردر' && x.status !== 'جاهز يطلع كامل') { x.status = 'جاهز يطلع كامل'; if (live()) told(A().updateLot(x.key, { status: 'جاهز يطلع كامل' }, 'inventory.status')); } }); K.notify({ title: 'IB-' + orderId + ' جاهز يطلع كامل من المخزن', link: '#inventory-consolidate' }); }
    rerenderInv();
  }
  // «تجميع في المخزن» popup: choose sub-orders + zone
  function consPopup(o) {
    const used = S.consolidations.map((c) => c.zone); const free = ['T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06'].filter((z) => !used.includes(z));
    const pk = (s) => s.itemId || s.sid; const pick = {}; o.subs.forEach((s) => { pick[pk(s)] = !s.pulled && s.ss !== 'تم الشحن للعميل'; });
    K.form({ title: 'تجميع في المخزن — IB-' + o.id, values: { zone: free[0] || '' }, note: U.InlineNote({ children: 'الفرعيات المختارة هتتشحن من المبتكرين للمخزن وتطلع للعميل في شحنة واحدة. تنبيه لو التجميع عدّى ' + S.invSettings.consolidationAlert + ' أيام.' }),
      fields: (f, e, set, draw) => [h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'الفرعيات اللي هتتجمع *'), ...o.subs.map((s) => K.Checkbox({ label: '#' + s.sid + ' · ' + s.prod + ' — ' + (s.pulled ? 'مخزن ابتكر' : s.vendor) + (s.ss ? ' (' + s.ss + ')' : ''), checked: pick[pk(s)], disabled: s.pulled, onChange: (v) => { pick[pk(s)] = v; draw(); } })), e.subs ? h('div', { class: 'err-msg', role: 'alert' }, e.subs) : null),
        K.field.select('zone', 'منطقة التجميع', free.length ? free : ['T-07'], f, e, set, { required: true })],
      validate: (f) => { const n = Object.values(pick).filter(Boolean).length; const e = {}; if (n < 2) e.subs = 'اختار فرعيين على الأقل — التجميع لأكتر من مبتكر'; if (!f.zone) e.zone = 'اختار المنطقة'; return e; },
      submitLabel: 'ابدأ التجميع', submit: (f) => { const subs = o.subs.filter((s) => pick[pk(s)]).map((s) => [s.sid, s.vendor, s.ss === 'وصل المخزن' ? 'وصل المخزن' : s.ss || 'قيد التنفيذ', s.prod, s.itemId]);
        if (live()) told(A().consolidate(o.id, subs.map((x) => x[4]), f.zone)).then((r) => { if (r.ok) reload(); });
        S.consolidations.unshift({ order: o.id, customer: o.name, subs, since: DAY(), zone: f.zone, by: K.member(K.ME).name }); K.logEvent('order.consolidate', 'IB-' + o.id + ' · ' + subs.length + ' فرعي · ' + f.zone); K.toast('IB-' + o.id + ' بيتجمع في المخزن (' + f.zone + ')', 'success'); window.OrdersSetSub && window.OrdersSetSub('__redraw__', null); rerenderInv(); } });
  }
  // «وصل المخزن» on a sub-order → choose the storage reason (owner 22 Oct). The stock row is added by the popup.
  const arrivalPopup = (info, ok) => inv().arrival(Object.assign({ inConsolidation: !!cons(info.order) }, info), ok);
  // Main order → «مكتمل» (owner 27 Oct — phase 3.6, decision 4): الموظف يقيّم العميل — رضا · أخلاق (نجوم 1–5) + ملاحظة.
  // ok({ sat, manners, note }) — block 29 writes it with the status (IBOrders.setOrderStatus → order_complete: التقييم و«مكتمل» مع بعض).
  // «ليس الآن» = الحالة ما تتغيرش.
  function ratePopup(info, ok, closed) { // closed(): the popup went away, saved or «ليس الآن» (decision 53 — the bulk «مكتمل» asks order by order)
    const CS = window.IbtekrCS; const KEYS = CS.RATE_KEYS;
    K.form({ title: 'قيّم العميل — IB-' + info.order, values: { sat: 0, manners: 0, note: '' }, onClose: closed,
      note: U.InlineNote({ children: info.name + (info.phone ? ' · ' + info.phone : '') + ' · IB-' + info.order + ' · ' + K.money(info.tot) + ' ج.م · الأوردر هيتقفل «مكتمل» بعد التقييم.' }),
      fields: (f, e, set) => KEYS.map(([k, l]) => K.StarPicker({ id: 'rt-' + k, label: l, required: true, value: f[k], error: e[k], onChange: (n) => set(k, n, true) }))
        .concat([K.field.area('note', 'ملاحظة على العميل', f, e, set, { placeholder: 'اختياري — مثلاً: ذوق جداً، أو كان متعصب من التأخير' }),
          h('p', { class: 't-small help', style: 'margin:0' }, 'التقييم بيتسجل على الأوردر، وهيظهر في ملف العميل لما صفحة «خدمة العملاء» تشتغل.')]),
      validate: (f) => { const e = CS.validateTeamRating({ sat: f.sat, manners: f.manners }); if ((f.note || '').trim().length > 500) e.note = 'الملاحظة 500 حرف بالكتير'; return e; },
      submitLabel: 'احفظ التقييم وقفّل الأوردر', cancelLabel: 'ليس الآن',
      submit: (f) => { ok({ sat: f.sat, manners: f.manners, note: (f.note || '').trim() }); } });
  }
  // the hub loaded or changed: the orders page redraws its «في المخزن» chips and consolidation bars (phase 7)
  document.addEventListener('ib:inventory', () => { if (window.OrdersSetSub) window.OrdersSetSub('__redraw__', null); });
  document.addEventListener('ib:tickets', () => { if (window.OrdersSetSub) window.OrdersSetSub('__redraw__', null); }); // phase 8: the open-ticket count on the orders
  window.IBOrdersOps = { cons, returnPopup, orderReturnPopup, orderReasonPopup, ratePopup, subChanged, arrivalPopup, consolidate: consPopup,
    shipall: (o) => { const c = cons(o.id); if (c) inv().shipAll(c); },
    uncons: (o) => { const c = cons(o.id); if (c) inv().cancelCons(c); },
    // phase 7 decision 9 (owner, 4 Nov): the order's status saved as «قيد الشحن» / «مكتمل» = it left — its gathered pieces leave the hub
    orderShipped: (orderId, status) => inv().shipOut(orderId, status),
    // phase 7 decision 10 (d): a «متاح للبيع» piece of this SKU in the hub, and taking it for a line (with the team's confirmation)
    hubHas: (sku, qty) => !!(inv().hubLot && inv().hubLot(sku, qty)),
    pullPopup: (info, ok) => inv().pullPopup(info, ok) };
})();

