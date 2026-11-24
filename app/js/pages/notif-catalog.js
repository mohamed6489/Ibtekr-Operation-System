/* Ibtekr — the notifications' catalogue (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md): every rule the admin
   builds is an element › a type › a state from this list. The same file, byte for byte, is supabase/functions/_shared/notif-catalog.js
   (the engine — tests/domain/notif-catalog.test.mjs compares them). Not a block; pure.
   · kind 'state' = the entities that are in the state now (an order «متأخر», the custody under its floor …) — one alert per entity,
     again by the rule's repeat while it stays there, hidden by the rule's «تفاصيل الظهور»;
   · kind 'event' = what happened since the engine's last run (a new order, a deposit, a request decided …) — one alert per event;
   · kind 'due'   = a date coming (the payroll two days before its day, a subscription, the evaluation) — one alert per period;
   · `dyn` = the states are the system's own list at run time: 'order' (orders' statuses), 'confirm' (the confirmation's), 'sub'
     (the product lines'), 'ticket' (the team requests' types) — `states` then holds the fallback names.
   · `perm` = what a recipient needs to see it (a role chosen in the rule gets it only for its members who have it). */
(function (root) {
  'use strict';
  const S = (id, label, extra) => Object.assign({ id, label }, extra || {});
  const ELEMENTS = [
    // the meeting's text: «تقرير المهام هتبقي التقارير اليومية» — one summary a day of what is open for the recipient's role
    { id: 'daily', label: 'التقارير اليومية', perm: null, types: [
      { id: 'summary', label: 'ملخص', kind: 'due', states: [S('day', 'ملخص اليوم')] }] },
    { id: 'custody', label: 'عهدة التشغيل', perm: 'accounts.view', types: [
      { id: 'balance', label: 'الرصيد', states: [S('deposit', 'إيداع', { kind: 'event' }), S('withdraw', 'سحب', { kind: 'event' }), S('low', 'العهدة قربت تخلص', { kind: 'state', param: { key: 'floor', label: 'أقل من (ج.م)', def: 200 } })] }] },
    { id: 'team', label: 'أعضاء الفريق', perm: 'hr.view', types: [
      { id: 'status', label: 'حالة', states: [S('eval_due', 'التقييم الشهري', { kind: 'due', param: { key: 'days', label: 'قبلها بكام يوم', def: 2 } }), S('no_in', 'لم يسجل حضور', { kind: 'state', param: { key: 'late_min', label: 'بعد ميعاده بكام دقيقة', def: 60 } }),
        S('ot_start', 'بدء وقت إضافي', { kind: 'event' }), S('no_out', 'لم يسجل انصراف', { kind: 'state' })] },
      { id: 'update', label: 'تحديث', states: [S('clock_in', 'تسجيل الحضور', { kind: 'event' }), S('clock_out', 'تسجيل الانصراف', { kind: 'event' }), S('req_leave', 'طلب إجازة', { kind: 'event' }), S('req_advance', 'طلب سلفة', { kind: 'event' }),
        S('req_rest', 'طلب فترة راحة', { kind: 'event' }), S('req_special', 'طلب خاص', { kind: 'event' }), S('req_ot', 'طلب وقت إضافي', { kind: 'event' })] }] },
    { id: 'orders', label: 'الأوردرات الرئيسية', perm: 'orders.view', types: [
      { id: 'confirm', label: 'حالة التأكيد', dyn: 'confirm', kind: 'state', states: [S('مؤكد بعربون', 'مؤكد بعربون'), S('غير مؤكد', 'غير مؤكد')] },
      { id: 'status', label: 'حالة الأوردر', dyn: 'order', kind: 'state', states: [S('جاري التنفيذ', 'جاري التنفيذ'), S('معلّق', 'معلّق'), S('جاهز للشحن', 'جاهز للشحن')] },
      { id: 'delay', label: 'حالة التأخير', kind: 'state', states: [S('late', 'متأخر'), S('ok', 'غير متأخر'), S('risk', 'قابل للتأخير')] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('new', 'أوردر جديد'), S('edit', 'تعديل أوردر'), S('delete', 'حذف أوردر')] }] },
    { id: 'subs', label: 'الأوردرات الفرعية', perm: 'orders.view', types: [
      { id: 'status', label: 'حالة الأوردر الفرعي', dyn: 'sub', kind: 'state', states: [S('مؤكد', 'مؤكد'), S('جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المبتكر للعميل'), S('جاهز للشحن من المبتكر للمخزن', 'جاهز للشحن من المبتكر للمخزن')] },
      { id: 'delay', label: 'حالة التأخير', kind: 'state', states: [S('late', 'متأخر'), S('ok', 'غير متأخر'), S('risk', 'قابل للتأخير')] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('new', 'أوردر فرعي جديد'), S('edit', 'تعديل أوردر فرعي'), S('delete', 'حذف أوردر فرعي')] }] },
    { id: 'products', label: 'المنتجات', perm: 'products.view', types: [
      { id: 'stock', label: 'حالة المنتج', kind: 'state', states: [S('out', 'الكمية نفدت'), S('left1', 'باقي 1 في المخزون'), S('left3', 'باقي 3 في المخزون')] },
      // the meeting's text («العمليات والشحن — مرتجع يحتاج فحص»): a return in the stock waiting for its inspection
      { id: 'returns', label: 'المرتجعات', kind: 'state', states: [S('wait', 'مرتجع يحتاج فحص')] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('trash', 'حذف منتج'), S('batch', 'إضافة دفعة منتجات'), S('draft', 'تحويل لمسودة'), S('edit', 'تعديل بيانات'), S('move', 'نقل منتجات'),
        S('cat_add', 'إضافة قسم جديد'), S('cat_delete', 'حذف قسم'), S('cat_edit', 'تعديل قسم')] }] },
    { id: 'accounts', label: 'الحسابات', perm: 'accounts.view', types: [
      { id: 'expenses', label: 'مصروفات', kind: 'event', states: [S('deposit', 'إيداع'), S('withdraw', 'سحب')] },
      { id: 'payroll', label: 'مرتبات', states: [S('withdraw', 'سحب', { kind: 'event' }), S('due', 'قبل يوم الصرف', { kind: 'due', param: { key: 'days', label: 'قبلها بكام يوم', def: 2 } })] },
      { id: 'subs', label: 'اشتراكات', states: [S('withdraw', 'سحب', { kind: 'event' }), S('due', 'قبل التجديد', { kind: 'due', param: { key: 'days', label: 'قبلها بكام يوم', def: 3 } })] },
      { id: 'ads', label: 'إعلانات', kind: 'event', states: [S('deposit', 'إيداع'), S('withdraw', 'سحب')] },
      { id: 'makers', label: 'حسابات المبتكرين', states: [S('deposit', 'إيداع', { kind: 'event' }), S('withdraw', 'سحب', { kind: 'event' }), S('close_due', 'قبل تقفيل الحسابات', { kind: 'due', param: { key: 'days', label: 'قبلها بكام يوم', def: 2 } })] },
      { id: 'real', label: 'الحساب الفعلي', kind: 'event', states: [S('deposit', 'إيداع'), S('withdraw', 'سحب')] },
      // the meeting's text: «الحركة المالية ملخص الاجراءات» — the day's deposits and withdrawals in one line
      { id: 'summary', label: 'الحركة المالية', kind: 'due', states: [S('day', 'ملخص اليوم')] }] },
    { id: 'tickets', label: 'طلبات الفريق', perm: 'tickets.view', types: [
      { id: 'type', label: 'نوع الطلب', dyn: 'ticket', states: [S('new', 'طلبات جديدة', { kind: 'event' }), S('late', 'طلبات متأخرة', { kind: 'state' })] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('edit', 'تعديل طلب'), S('in_progress', 'جاري العمل'), S('waiting', 'في انتظار الرد'), S('resolved', 'تم الحل')] }] },
    { id: 'messages', label: 'الرسايل', perm: 'cs.view', types: [
      { id: 'customers', label: 'رسايل العملاء', states: [S('new', 'رسايل جديدة', { kind: 'event' }), S('waiting', 'في انتظار الرد', { kind: 'state' }), S('late', 'رسايل متأخرة', { kind: 'state' })] },
      { id: 'vendors', label: 'رسايل المبتكرين', states: [S('new', 'رسايل جديدة', { kind: 'event' }), S('late', 'رسايل متأخرة', { kind: 'state' })] },
      { id: 'comments', label: 'السوشيال ميديا', states: [S('new', 'تعليقات جديدة', { kind: 'event' }), S('late', 'تعليقات متأخرة', { kind: 'state' })] }] },
    // perm null: each assistant's alert names the members who see that assistant (ai_agents.perm) — notify/rules.ts
    { id: 'ai', label: 'الذكاء الاصطناعي', perm: null, types: [
      { id: 'buyer', label: 'الميديا باير', kind: 'event', states: [S('campaigns', 'أداء الحملات'), S('pixel', 'حالة البيكسل'), S('post', 'نشر بوست')] },
      { id: 'designer', label: 'الديزاينر', kind: 'event', states: [S('trends', 'آخر التريندات'), S('campaign', 'بناء حملة')] },
      { id: 'dev', label: 'المبرمج', kind: 'event', states: [S('wp', 'تحديثات ووردبريس'), S('api', 'مشاكل API'), S('speed', 'كفاءة أداء النظام')] },
      // the meeting's text: «لكل مساعد ذكاء اصطناعي التنبيهات اللي تناسب دوره بنفس الطريقة» — whatever the other assistants (the
      // operations', the customer service's, the makers', the accountant, HR's, the content's and the admin's own) tell their team —
      // their daily summary, what is late, their own rules — reaches the members who see that assistant
      { id: 'any', label: 'باقي المساعدين', kind: 'event', states: [S('notes', 'تنبيهات المساعد')] }] },
    { id: 'makers', label: 'المبتكرين', perm: 'vendors.view', types: [
      { id: 'making', label: 'حالة التصنيع', states: [S('late', 'أوردرات متأخرة', { kind: 'state' }), S('risk', 'أوردرات قابلة للتأخير', { kind: 'state' }), S('confirmed', 'أوردرات مؤكدة جديدة', { kind: 'event' }), S('cancelled', 'أوردرات ملغية', { kind: 'event' })] },
      { id: 'accounts', label: 'حسابات المبتكر', kind: 'event', states: [S('withdraw', 'طلب سحب'), S('settle', 'تقفيل الحسابات')] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('add', 'إضافة مبتكر'), S('delete', 'حذف مبتكر'), S('edit', 'تعديل بيانات'), S('brand', 'إضافة براند'), S('move', 'نقل منتجات'), S('status', 'حالة المبتكر')] }] },
  ];
  const REPEATS = [['once', 'غير متكرر'], ['24h', 'كل 24 ساعة'], ['48h', 'كل 48 ساعة'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا'], ['days', 'أيام محددة من الشهر']];
  const SHOWS = [['fixed', 'مدة محددة'], ['until_state', 'حتى تغيير الوضع'], ['until_read', 'حتى التحوّل لمقروء']];
  const SHOW_HOURS = { fixed: [12, 24, 48, 72, 168], until_state: [0, 4, 6], until_read: [2, 4, 6] };
  const CHANNELS = [['bell', 'الجرس'], ['email', 'إيميل'], ['whatsapp', 'واتساب']];
  const LIVE_CHANNELS = ['bell', 'email', 'whatsapp']; // Safwat 24 Nov: e-mail and WhatsApp each behind its switch (settings «notif».channels)
  const el = (id) => ELEMENTS.find((e) => e.id === id) || null;
  const typeOf = (eid, tid) => { const e = el(eid); return e ? e.types.find((t) => t.id === tid) || null : null; };
  // the states of a type: the system's list for a `dyn` one (lists = { order, confirm, sub, ticket } — arrays of names)
  function statesOf(eid, tid, lists) {
    const t = typeOf(eid, tid); if (!t) return [];
    const dyn = t.dyn && lists && Array.isArray(lists[t.dyn]) && lists[t.dyn].length ? lists[t.dyn] : null;
    if (dyn && t.dyn !== 'ticket') return dyn.map((n) => S(String(n), String(n), { kind: t.kind || 'state' }));
    return t.states.map((s) => Object.assign({ kind: t.kind || 'state' }, s));
  }
  const stateOf = (eid, tid, sid, lists) => statesOf(eid, tid, lists).find((s) => s.id === sid) || null;
  // a `dyn: 'ticket'` type carries the request's type as a sub-pick (all types when empty)
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  // what is wrong with a rule (an Arabic line) or null — the same on the page and the server (notif_rule_save checks the shape again)
  function ruleError(r, lists) {
    if (!r || typeof r !== 'object') return 'تنبيه مش مظبوط';
    const name = String(r.name == null ? '' : r.name).trim(); if (!name) return 'اكتب اسم التنبيه'; if (name.length > 80 || /[<>]/.test(name)) return 'اسم التنبيه لحد 80 حرف من غير < >';
    if (!el(r.element)) return 'اختار العنصر'; if (!typeOf(r.element, r.type)) return 'اختار نوع التنبيه'; if (!stateOf(r.element, r.type, r.state, lists)) return 'اختار الوضع';
    if (!HHMM.test(String(r.at || ''))) return 'اختار الوقت';
    if (!REPEATS.some(([k]) => k === r.repeat)) return 'اختار التكرار';
    if (r.repeat === 'days' && !(Array.isArray(r.days) && r.days.length && r.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31))) return 'اختار أيام الشهر';
    if (!SHOWS.some(([k]) => k === r.show)) return 'اختار مدة الظهور'; if (!SHOW_HOURS[r.show].includes(Number(r.hours))) return 'اختار المدة';
    if (!Array.isArray(r.roles) || !r.roles.length) return 'اختار المستلم (دور واحد على الأقل)';
    if (!Array.isArray(r.channels) || !r.channels.length || r.channels.some((c) => !CHANNELS.some(([k]) => k === c))) return 'اختار قناة الإرسال';
    const tpl = String(r.template == null ? '' : r.template); if (tpl.length > 500 || /[<>]/.test(tpl)) return 'قالب الرسالة لحد 500 حرف من غير < >';
    return null;
  }
  // the message: the template's {الاسم} / {الرقم} / {الوضع} / {التفاصيل} filled, else the rule's name and the entity's line
  function render(rule, ent) {
    const v = { 'الاسم': ent && ent.name ? String(ent.name) : '', 'الرقم': ent && ent.ref ? String(ent.ref) : '', 'الوضع': ent && ent.state ? String(ent.state) : '', 'التفاصيل': ent && ent.line ? String(ent.line) : '' };
    const tpl = String(rule && rule.template ? rule.template : '').trim();
    const body = tpl ? tpl.replace(/\{(الاسم|الرقم|الوضع|التفاصيل)\}/g, (_, k) => v[k]) : v['التفاصيل'];
    return { title: String(rule && rule.name ? rule.name : '').slice(0, 120) + (v['الرقم'] ? ' — ' + v['الرقم'] : ''), body: body.replace(/[<>]/g, '').slice(0, 300) };
  }
  // is a rule due now (Cairo's day / minute): its time passed today and the repeat's gap since its last run
  function due(rule, now, last) {
    if (!rule || !HHMM.test(String(rule.at || ''))) return false;
    const day = now.day; const min = now.min; const atMin = Number(rule.at.slice(0, 2)) * 60 + Number(rule.at.slice(3));
    if (min < atMin) return false;
    const lastDay = last ? String(last).slice(0, 10) : null;
    const dd = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
    switch (rule.repeat) {
      case 'once': return !last;
      case '24h': return !lastDay || dd(day, lastDay) >= 1;
      case '48h': return !lastDay || dd(day, lastDay) >= 2;
      case 'weekly': return !lastDay || dd(day, lastDay) >= 7;
      case 'monthly': return !lastDay || lastDay.slice(0, 7) !== day.slice(0, 7);
      case 'days': return (rule.days || []).includes(Number(day.slice(8, 10))) && lastDay !== day;
      default: return false;
    }
  }
  // the alerts written straight by a database function (an overtime to decide, a request decided, a note from the manager, a
  // permission changed …) carry no rule: the bell puts each under the first sub-section that has a rule of the element its kind
  // belongs to (else under the first section's «الكل»)
  const KIND_ELEMENT = [[/^hr(\.|$)/, 'team'], [/^settings\./, 'team'], [/^ticket/, 'tickets'], [/^(marketing|mkt\.|ai\.)/, 'ai'], [/^(inventory|stock)/, 'products'],
    [/^(order|bosta)/, 'orders'], [/^(vendor|maker)/, 'makers'], [/^(accounts?|acc\.)/, 'accounts'], [/^(cs|message)/, 'messages']];
  const elementOfKind = (kind) => { const k = String(kind || ''); const hit = KIND_ELEMENT.find(([re]) => re.test(k)); return hit ? hit[1] : null; };
  // the kind of a rule's state: its own, else its type's, else «state» (a `dyn` state the fallback list does not name)
  function kindOf(rule) {
    const t = rule ? typeOf(rule.element, rule.type) : null; if (!t) return 'state';
    const s = t.states.find((x) => x.id === rule.state);
    return (s && s.kind) || t.kind || 'state';
  }
  // does the rule run on this tick: an «event» rule every tick from its time each day (on its days for «أيام محددة من الشهر»),
  // a «state» / «due» one by due() — its time and its repeat's gap
  function runs(rule, now, last) {
    if (kindOf(rule) !== 'event') return due(rule, now, last);
    if (!rule || !HHMM.test(String(rule.at || ''))) return false;
    const atMin = Number(rule.at.slice(0, 2)) * 60 + Number(rule.at.slice(3));
    if (now.min < atMin) return false;
    return rule.repeat !== 'days' || (rule.days || []).includes(Number(now.day.slice(8, 10)));
  }
  const api = { ELEMENTS, REPEATS, SHOWS, SHOW_HOURS, CHANNELS, LIVE_CHANNELS, el, typeOf, statesOf, stateOf, ruleError, render, due, runs, kindOf, elementOfKind };
  root.IBNotifCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
