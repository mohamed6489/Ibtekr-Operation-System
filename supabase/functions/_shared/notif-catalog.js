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
  // the built-in assistants that write to their team (ai_agents — 0120 / 0128); the three marketing ones keep their own types
  const AGENTS = [['manager', 'المدير العام'], ['stock', 'التشغيل الذكي'], ['cs', 'خدمة العملاء الذكية'], ['makers', 'خدمة المبتكرين الذكية'], ['accountant', 'المحاسب الذكي'],
    ['hr', 'الموارد البشرية الذكية'], ['content', 'المحتوى الذكي']];
  const ELEMENTS = [
    // the meeting's text: «تقرير المهام هتبقي التقارير اليومية» — one summary a day of what is open for the recipient's role
    { id: 'daily', label: 'التقارير اليومية', perm: null, types: [
      { id: 'summary', label: 'ملخص', kind: 'due', states: [S('day', 'ملخص اليوم', { level: 'info' })] }] },
    { id: 'custody', label: 'عهدة التشغيل', perm: 'accounts.view', types: [
      { id: 'balance', label: 'الرصيد', states: [S('deposit', 'إيداع', { kind: 'event' }), S('withdraw', 'سحب', { kind: 'event' }), S('low', 'العهدة قربت تخلص', { kind: 'state', level: 'critical', param: { key: 'floor', label: 'أقل من (ج.م)', def: 200 } })] }] },
    { id: 'team', label: 'أعضاء الفريق', perm: 'hr.view', types: [
      { id: 'status', label: 'حالة', states: [S('eval_due', 'التقييم الشهري', { kind: 'due', param: { key: 'days', label: 'قبلها بكام يوم', def: 2 } }), S('no_in', 'لم يسجل حضور', { kind: 'state', param: { key: 'late_min', label: 'بعد ميعاده بكام دقيقة', def: 60 } }),
        S('ot_start', 'بدء وقت إضافي', { kind: 'event' }), S('no_out', 'لم يسجل انصراف', { kind: 'state' })] },
      { id: 'update', label: 'تحديث', states: [S('clock_in', 'تسجيل الحضور', { kind: 'event' }), S('clock_out', 'تسجيل الانصراف', { kind: 'event' }), S('req_leave', 'طلب إجازة', { kind: 'event' }), S('req_advance', 'طلب سلفة', { kind: 'event' }),
        S('req_rest', 'طلب فترة راحة', { kind: 'event' }), S('req_special', 'طلب خاص', { kind: 'event' }), S('req_ot', 'طلب وقت إضافي', { kind: 'event' })] }] },
    { id: 'orders', label: 'الأوردرات الرئيسية', perm: 'orders.view', types: [
      { id: 'confirm', label: 'حالة التأكيد', dyn: 'confirm', kind: 'state', states: [S('مؤكد بعربون', 'مؤكد بعربون'), S('غير مؤكد', 'غير مؤكد')] },
      { id: 'status', label: 'حالة الأوردر', dyn: 'order', kind: 'state', states: [S('جاري التنفيذ', 'جاري التنفيذ'), S('معلّق', 'معلّق'), S('جاهز للشحن', 'جاهز للشحن')] },
      { id: 'delay', label: 'حالة التأخير', kind: 'state', states: [S('late', 'متأخر', { level: 'critical' }), S('ok', 'غير متأخر', { level: 'info' }), S('risk', 'قابل للتأخير')] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('new', 'أوردر جديد'), S('edit', 'تعديل أوردر'), S('delete', 'حذف أوردر')] },
      // the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md decision 5)
      { id: 'shipping', label: 'الشحن', kind: 'state', states: [S('no_bosta', 'جاهز للشحن ومااتبعتش لبوسطة', { param: { key: 'days', label: 'بعد كام يوم', def: 1 } }),
        S('cod_error', 'تحصيل بوسطة مااتحدثش', { level: 'critical' })] }] },
    { id: 'subs', label: 'الأوردرات الفرعية', perm: 'orders.view', types: [
      { id: 'status', label: 'حالة الأوردر الفرعي', dyn: 'sub', kind: 'state', states: [S('مؤكد', 'مؤكد'), S('جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المبتكر للعميل'), S('جاهز للشحن من المبتكر للمخزن', 'جاهز للشحن من المبتكر للمخزن')] },
      { id: 'delay', label: 'حالة التأخير', kind: 'state', states: [S('late', 'متأخر', { level: 'critical' }), S('ok', 'غير متأخر', { level: 'info' }), S('risk', 'قابل للتأخير')] },
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
      { id: 'real', label: 'الحساب الفعلي', kind: 'event', states: [S('deposit', 'إيداع'), S('withdraw', 'سحب'), S('negative', 'حساب بالسالب', { kind: 'state', level: 'critical' })] },
      // the meeting's text: «الحركة المالية ملخص الاجراءات» — the day's deposits and withdrawals in one line
      { id: 'summary', label: 'الحركة المالية', kind: 'due', states: [S('day', 'ملخص اليوم', { level: 'info' })] }] },
    { id: 'tickets', label: 'طلبات الفريق', perm: 'tickets.view', types: [
      { id: 'type', label: 'نوع الطلب', dyn: 'ticket', states: [S('new', 'طلبات جديدة', { kind: 'event', level: 'important' }), S('late', 'طلبات متأخرة', { kind: 'state', level: 'critical' })] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('edit', 'تعديل طلب'), S('in_progress', 'جاري العمل'), S('waiting', 'في انتظار الرد'), S('resolved', 'تم الحل')] }] },
    { id: 'messages', label: 'الرسايل', perm: 'cs.view', types: [
      { id: 'customers', label: 'رسايل العملاء', states: [S('new', 'رسايل جديدة', { kind: 'event', level: 'important' }), S('waiting', 'في انتظار الرد', { kind: 'state' }), S('late', 'رسايل متأخرة', { kind: 'state', level: 'critical' })] },
      { id: 'vendors', label: 'رسايل المبتكرين', states: [S('new', 'رسايل جديدة', { kind: 'event', level: 'important' }), S('late', 'رسايل متأخرة', { kind: 'state', level: 'critical' })] },
      { id: 'comments', label: 'السوشيال ميديا', states: [S('new', 'تعليقات جديدة', { kind: 'event' }), S('late', 'تعليقات متأخرة', { kind: 'state' })] },
      { id: 'ratings', label: 'تقييم العملاء', kind: 'event', states: [S('low', 'تقييم عميل واطي', { level: 'critical', param: { key: 'stars', label: 'لحد كام نجمة', def: 2 } })] }] },
    // perm null: each assistant's alert names the members who see that assistant (ai_agents.perm) — notify/rules.ts
    { id: 'ai', label: 'الذكاء الاصطناعي', perm: null, types: [
      // the trends from free sources (Safwat 28 Nov — «في الجرس تنبيهات الترندات بتيجي في المساعدين»): the media buyer's too
      { id: 'buyer', label: 'الميديا باير', kind: 'event', states: [S('campaigns', 'أداء الحملات'), S('pixel', 'حالة البيكسل'), S('post', 'نشر بوست'), S('trends', 'آخر التريندات')] },
      { id: 'designer', label: 'الديزاينر', kind: 'event', states: [S('trends', 'آخر التريندات'), S('campaign', 'بناء حملة')] },
      { id: 'dev', label: 'المبرمج', kind: 'event', states: [S('wp', 'تحديثات ووردبريس'), S('api', 'مشاكل API'), S('speed', 'كفاءة أداء النظام')] },
      // the meeting's text: «لكل مساعد ذكاء اصطناعي التنبيهات اللي تناسب دوره بنفس الطريقة» — whatever the other assistants (the
      // operations', the customer service's, the makers', the accountant, HR's, the content's and the admin's own) tell their team —
      // their daily summary, what is late, their own rules — reaches the members who see that assistant
      // the bell's redesign decision 4: each built-in assistant its own type — its team's daily summary (ref «team:»), the work late at
      // its team (« late:» / «cs-late:»), and its own rules («rule:»); «باقي المساعدين» = the assistants the admin added
      ...AGENTS.map(([id, label]) => ({ id, label, kind: 'event', states: [S('summary', 'ملخص الفريق اليومي', { level: 'info' }), S('late', 'الشغل المتأخر عند الفريق', { level: 'important' }), S('rules', 'قواعد المساعد', { level: 'important' })] })),
      { id: 'any', label: 'باقي المساعدين', kind: 'event', states: [S('notes', 'تنبيهات المساعد')] }] },
    { id: 'makers', label: 'المبتكرين', perm: 'vendors.view', types: [
      { id: 'making', label: 'حالة التصنيع', states: [S('late', 'أوردرات متأخرة', { kind: 'state', level: 'critical' }), S('risk', 'أوردرات قابلة للتأخير', { kind: 'state' }), S('confirmed', 'أوردرات مؤكدة جديدة', { kind: 'event' }), S('cancelled', 'أوردرات ملغية', { kind: 'event' })] },
      { id: 'accounts', label: 'حسابات المبتكر', kind: 'event', states: [S('withdraw', 'طلب سحب', { level: 'important' }), S('settle', 'تقفيل الحسابات'),
        S('withdraw_wait', 'طلب سحب مستني', { kind: 'state', param: { key: 'days', label: 'بقاله أكتر من كام يوم', def: 2 } })] },
      { id: 'update', label: 'تحديث', kind: 'event', states: [S('add', 'إضافة مبتكر'), S('delete', 'حذف مبتكر'), S('edit', 'تعديل بيانات'), S('brand', 'إضافة براند'), S('move', 'نقل منتجات'), S('status', 'حالة المبتكر')] }] },
    // the bell's redesign decision 5: the stock's own alerts and the admin's links
    { id: 'inventory', label: 'المخزن', perm: 'inventory.view', types: [
      { id: 'consolidation', label: 'التجميع', kind: 'state', states: [S('late', 'تجميع أوردر عدّى مدته', { level: 'critical', param: { key: 'days', label: 'بعد كام يوم', def: 5 } })] },
      { id: 'lost', label: 'المفقودات', kind: 'event', states: [S('new', 'قطعة اتعلّمت مفقود', { level: 'critical' })] }] },
    { id: 'system', label: 'السيستم', perm: 'settings.view', types: [
      { id: 'links', label: 'الربط بالمنصات', kind: 'state', states: [S('down', 'ربط منصة وقف', { level: 'critical' })] }] },
    // Safwat 28 Nov — each its own element: «لو في مشكلة او اي خطأ حصل يعرفني انو حصل حتي لو اتحل» (an event — told once, even if it
    // is gone by the next tick) and «لو المساحة دي قربت تتملي يبعت تنبيه» (the Supabase project's database and files against the plan's
    // limits — the system lives there; Hostinger only serves the page's own files). perm null: the rule's roles (the admin's and the
    // developer's by default — 0173)
    { id: 'faults', label: 'الأعطال', perm: null, types: [
      { id: 'fault', label: 'الأعطال', kind: 'event', states: [S('found', 'وجود عطل', { level: 'critical' })] }] },
    { id: 'storage', label: 'مساحة التخزين', perm: null, types: [
      { id: 'space', label: 'المساحة', kind: 'state', states: [S('full', 'التخزين امتلأ', { level: 'critical', param: { key: 'pct', label: 'لما توصل كام %', def: 80 } })] }] },
  ];
  const REPEATS = [['once', 'غير متكرر'], ['24h', 'كل 24 ساعة'], ['48h', 'كل 48 ساعة'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا'], ['days', 'أيام محددة من الشهر']];
  const SHOWS = [['fixed', 'مدة محددة'], ['until_state', 'حتى تغيير الوضع'], ['until_read', 'حتى التحوّل لمقروء']];
  const SHOW_HOURS = { fixed: [12, 24, 48, 72, 168], until_state: [0, 4, 6], until_read: [2, 4, 6] };
  const CHANNELS = [['bell', 'الجرس'], ['email', 'إيميل'], ['whatsapp', 'واتساب']];
  // the bell's redesign decision 1: how much an alert matters — the bell's order (critical first) and how long it stays (showOf)
  // the four levels, highest first (Safwat 24 Nov — «حرج و تحتيها مهم و تحتيها عادي و تحتيها للمعرفة … المستخدم يقدر يختار»): a rule's own `level`
  // (picked in its form) wins over its state's default
  const LEVELS = [['critical', 'حرج'], ['important', 'مهم'], ['normal', 'عادي'], ['info', 'للمعرفة']];
  const LV_RANK = { critical: 0, important: 1, normal: 2, info: 3 };
  const INFO_MAX_H = 24; // an «info» alert leaves the bell 24 hours after it was written, read or not
  // several elements in one alert (Safwat 24 Nov — the bell's redesign decision 8, 0162): the rule's own element › type › state + up
  // to CONDS_MAX more (`conds`), and `mode`: «فردي» an alert per thing (each element's own, as before) · «تقرير» one alert per member and
  // run that holds them all, opened in the bell as one table
  const CONDS_MAX = 5;
  const MODES = [['single', 'فردي — تنبيه لكل حاجة'], ['report', 'تقرير — تنبيه واحد بكل الحاجات']];
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
    if (r.mode != null && !MODES.some(([k]) => k === r.mode)) return 'اختار طريقة التنبيه (فردي / تقرير)';
    const cs = r.conds == null ? [] : r.conds; if (!Array.isArray(cs) || cs.length > CONDS_MAX) return 'لحد ' + CONDS_MAX + ' عناصر زيادة في التنبيه';
    for (let i = 0; i < cs.length; i++) { const x = cs[i] || {}; const n = ' (العنصر ' + (i + 2) + ')';
      if (!el(x.element)) return 'اختار العنصر' + n; if (!typeOf(x.element, x.type)) return 'اختار نوع التنبيه' + n; if (!stateOf(x.element, x.type, x.state, lists)) return 'اختار الوضع' + n; }
    return null;
  }
  // the rule's parts: its own element › type › state, then each extra one as the same rule on that element (`part` 0 … n)
  function partsOf(rule) {
    if (!rule) return [];
    const cs = Array.isArray(rule.conds) ? rule.conds : [];
    return [Object.assign({}, rule, { part: 0 })].concat(cs.map((c, i) => Object.assign({}, rule, { element: c.element, type: c.type, state: c.state, sub: c.sub == null ? null : c.sub, param: c.param == null ? null : c.param, part: i + 1 })));
  }
  // a part's name in a report's table: «العنصر › الوضع»
  function partLabel(part, lists) { const e = el(part.element); const s = stateOf(part.element, part.type, part.state, lists); return (e ? e.label : part.element) + ' › ' + (s ? s.label : part.state); }
  // the message: the template's {الاسم} / {الرقم} / {الوضع} / {التفاصيل} filled, else the rule's name and the entity's line; an order's
  // alert (customer service — Safwat 25 Nov) also fills {العميل} / {التليفون} / {حالة_الأوردر} / {المتابعة} / {الأوردرات_الفرعية} /
  // {المبتكر_المتأخر} / {المبتكر_القابل_للتأخير}. The template is the card (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي
  // ظاهر عشان المستخدم لو عايز يعدل يقدر يعدل»): a line per line of the template, a part per « · »; the bell draws {التليفون} with
  // «نسخ» / WhatsApp, {المتابعة} as the red / yellow chip, a part with the status or the sub-orders as a chip, the rest as small text.
  // A part whose variables all came out empty goes with its words. The server has no phone: {التليفون} is empty there (never stored).
  // {المبتكرين} on a line by itself = a row per maker in the order: his name, his pieces and his products' status, red / yellow when
  // late / about to be (Safwat 25 Nov — «عدد الاوردرات الفرعية و كل فيندور قداموا عدد القطع و حالة التسليم»); in a text (the email) one
  // line «الاسم: N قطع (الحالة)». {العميل} = the customer's name, bold at the card's head.
  const VARS = ['الاسم', 'الرقم', 'الوضع', 'التفاصيل', 'العميل', 'التليفون', 'حالة_الأوردر', 'المتابعة', 'الأوردرات_الفرعية', 'المبتكرين', 'المبتكر_المتأخر', 'المبتكر_القابل_للتأخير'];
  // a maker's alert (Safwat 25 Nov — the maker's card): his name, the pieces, a short line of the state (an amount, a wait) and the
  // sub-order numbers; his phone is {التليفون} — read on the page under the member's own rights, never in the alert
  const MAKER_ONLY = ['المبتكر', 'القطع', 'الملخص', 'أرقام_الأوردرات'];
  const VAR_RE = /\{(الاسم|الرقم|الوضع|التفاصيل|العميل|التليفون|حالة_الأوردر|المتابعة|الأوردرات_الفرعية|المبتكرين|المبتكر_المتأخر|المبتكر_القابل_للتأخير|المبتكر|القطع|الملخص|أرقام_الأوردرات)\}/g;
  // the order alert's template when the admin wrote none — the card as it shows (0170 writes it on the order rules): the customer's
  // name and phone, the follow-up and the sub-orders, a row per maker (Safwat 25 Nov — «شيل حالة الاوردر الرئيسي»)
  const ORDER_TPL = '{العميل} · {التليفون}\n{المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\n{المبتكرين}';
  // every alert of the makers' element has one card (Safwat 25 Nov — «الكارت ثابت و الحالات بس اللي تتغير»): the maker and his phone ·
  // the state, his sub-orders and pieces (or the amount) · the sub-orders' numbers to copy
  const MAKER_TPL = '{المبتكر} · {التليفون}\n{الوضع} · {الأوردرات_الفرعية} أوردر فرعي · {القطع} · {الملخص}\n{أرقام_الأوردرات}';
  const NUMS_MAX = 30;
  /** A maker alert's sub-order numbers (meta.nums — the engine writes them): digits only, at most NUMS_MAX. */
  const numsOf = (L) => (Array.isArray(L) ? L.map((x) => String(x == null ? '' : x).replace(/[^\d]/g, '').slice(0, 12)).filter(Boolean).slice(0, NUMS_MAX) : []);
  // the state's tone on the card: late red, about to be yellow, confirmed / settled green, the rest neutral — with its word, never the colour alone
  const SK_TONE = { late: 'late', risk: 'risk', confirmed: 'ok', settle: 'ok', withdraw: 'risk', withdraw_wait: 'risk', cancelled: 'off', delete: 'late' };
  /** The maker card's variables from an alert's meta (and the phone the page read). _nums / _st = the numbers and the state as items. */
  function makerVars(meta, phone) {
    const m = meta || {}; const v = m.v && typeof m.v === 'object' ? m.v : {}; const nums = numsOf(m.nums);
    const st = m.st === 'late' || m.st === 'risk' ? m.st : ''; const tone = st || SK_TONE[m.sk] || '';
    const word = String(v.s || DL_WORD[st] || '');
    return { 'المبتكر': String(m.gname || v.n || ''), 'التليفون': phone ? String(phone) : '',
      'الأوردرات_الفرعية': Number(m.n) > 0 ? String(Math.round(Number(m.n))) : '', 'القطع': Number(m.pcs) > 0 ? pcsWord(m.pcs) : '',
      'الملخص': String(m.sm || '').replace(/[<>]/g, '').slice(0, 80), 'أرقام_الأوردرات': nums.join('، '), 'الوضع': word,
      _nums: nums.map((n) => ({ n, d: tone })), _st: word ? [{ t: word, d: tone }] : [] };
  }
  const followOf = (dl) => (dl === 'late' || dl === 'risk' ? 'محتاج متابعة' : '');
  const list = (L) => (Array.isArray(L) ? L.map(String).filter(Boolean).join('، ') : '');
  const DL_WORD = { late: 'متأخر', risk: 'قابل للتأخير' };
  /** «قطعة» / «قطعتين» / «N قطع» / «N قطعة» — the pieces in Arabic. */
  const pcsWord = (n) => { const k = Math.max(0, Math.round(Number(n) || 0)); return k === 1 ? 'قطعة' : k === 2 ? 'قطعتين' : k >= 3 && k <= 10 ? k + ' قطع' : k + ' قطعة'; };
  // the makers' rows: [{ n: name, p: pieces, s: their products' status, d: late | risk | ok }] — at most 8, names and counts only
  const makersOf = (L) => (Array.isArray(L) ? L.filter((x) => x && x.n).slice(0, 8).map((x) => ({ n: String(x.n).slice(0, 40), p: Number(x.p) > 0 ? Number(x.p) : 0, s: String(x.s || '').slice(0, 40), d: x.d === 'late' || x.d === 'risk' ? x.d : 'ok' })) : []);
  const makersText = (L) => L.map((x) => x.n + ': ' + pcsWord(x.p) + (x.s || DL_WORD[x.d] ? ' (' + [DL_WORD[x.d], x.s].filter(Boolean).join(' · ') + ')' : '')).join('، ');
  // the variables of an order's facts: from the entity on the server (o), from the alert's meta on the page (ost / dl / subs / lm / rm)
  function orderVars(f, phone) {
    const x = f || {};
    return { 'العميل': x.customer ? String(x.customer) : '', 'التليفون': phone ? String(phone) : '', 'حالة_الأوردر': x.status ? String(x.status) : '', 'المتابعة': followOf(x.dl),
      'الأوردرات_الفرعية': x.subs != null && Number.isFinite(Number(x.subs)) ? String(x.subs) : '', 'المبتكرين': makersText(makersOf(x.mk)), 'المبتكر_المتأخر': list(x.late), 'المبتكر_القابل_للتأخير': list(x.risk), _mk: makersOf(x.mk) };
  }
  const metaFacts = (m) => (m && m.ost != null ? { customer: m.gname, status: m.ost, dl: m.dl, subs: m.subs, mk: m.mk, late: m.lm, risk: m.rm } : null);
  // a part's look in the card: phone (with «نسخ» / WhatsApp) · makers (a row each) · name (bold) · follow (red / yellow) · subs (a chip
  // with a box) · chip · details (the entity's line, its « · » pieces apart) · text
  const partKind = (part) => { const t = part.trim();
    return /\{التليفون\}/.test(part) ? 'phone' : t === '{المبتكرين}' ? 'makers' : t === '{أرقام_الأوردرات}' ? 'nums' : t === '{الوضع}' ? 'state'
      : /\{(العميل|المبتكر)\}/.test(part) ? 'name' : t === '{المتابعة}' ? 'follow'
      : /\{الأوردرات_الفرعية\}/.test(part) ? 'subs' : /\{(حالة_الأوردر|الوضع|الرقم|القطع|الملخص)\}/.test(part) ? 'chip' : t === '{التفاصيل}' ? 'details' : 'text'; };
  // every alert's variables on the page (Safwat 25 Nov — «قوالب الرسايل كلها تشتغل بنفس الطريقة»): the entity's own from meta.v (name ·
  // ref · state · line — the engine writes them), an order's facts from the meta, the phone read on the page; an older alert = its body
  function alertVars(meta, body, phone) {
    const m = meta || {}; const v = m.v && typeof m.v === 'object' ? m.v : null;
    return Object.assign({ 'الاسم': v ? String(v.n || '') : '', 'الرقم': v ? String(v.r || '') : '', 'الوضع': v ? String(v.s || '') : '', 'التفاصيل': v ? String(v.d || '') : String(body || '') },
      orderVars(metaFacts(m), phone), m.g === 'vendor' ? makerVars(m, phone) : null);
  }
  // the form's sample alert (its preview): an order's facts for an order rule, else a plain entity
  const SAMPLE_ORDER = { customer: 'منى أحمد', status: 'جاري التنفيذ', dl: 'late', subs: 2, late: ['Art Craft'], risk: ['sala'],
    mk: [{ n: 'Art Craft', p: 3, s: 'جاري التنفيذ', d: 'late' }, { n: 'sala', p: 1, s: 'جاهز للشحن من المبتكر للمخزن', d: 'risk' }] };
  // a maker rule's sample: Art Craft, his three late sub-orders and their numbers (his state is the rule's own)
  const SAMPLE_MAKER = (st, word) => ({ g: 'vendor', gname: 'Art Craft', n: st === 'late' || st === 'risk' || !st ? 3 : 1, pcs: 5, st: st === 'late' || st === 'risk' ? st : undefined, sk: st,
    nums: st === 'late' || st === 'risk' || !st ? ['4512', '4520', '4533'] : ['4512'], v: { n: 'Art Craft', s: word } });
  function sampleVars(rule, stateLabel) {
    const order = isOrderRule(rule); const maker = isMakerRule(rule);
    return Object.assign({ 'الاسم': order ? 'منى أحمد' : maker ? 'Art Craft' : 'مثال', 'الرقم': 'IB-1001', 'الوضع': String(stateLabel || 'الوضع'), 'التفاصيل': 'تفاصيل التنبيه زي ما السيستم بيكتبها' },
      orderVars(order ? SAMPLE_ORDER : null, order ? '01012345678' : ''),
      maker ? makerVars(SAMPLE_MAKER(rule.state, String(stateLabel || 'الوضع')), '01012345678') : null);
  }
  // the rules whose alerts carry an order's facts (customer service): their variables and their default card
  const isOrderRule = (r) => !!r && r.element === 'orders' && ['confirm', 'delay', 'status'].includes(r.type);
  // every rule of the makers' element: the maker's card (Safwat 25 Nov)
  const isMakerRule = (r) => !!r && r.element === 'makers';
  const BASE_VARS = ['الاسم', 'الرقم', 'الوضع', 'التفاصيل'];
  const MAKER_VARS = BASE_VARS.concat(['المبتكر', 'التليفون', 'الأوردرات_الفرعية'], MAKER_ONLY.slice(1));
  const varsOf = (r) => (isOrderRule(r) ? VARS : isMakerRule(r) ? MAKER_VARS : BASE_VARS);
  /** The template the card is drawn from: the admin's, else the order card for an order rule, the maker's card for a maker rule, else the entity's line. */
  const templateOf = (r) => (r && typeof r.template === 'string' && r.template.trim() ? r.template : isOrderRule(r) ? ORDER_TPL : isMakerRule(r) ? MAKER_TPL : '{التفاصيل}');
  /** The template's lines as the card draws them: [[{ kind, text, items? }]] — the empty ones left out; a makers part has its rows. */
  function cardLines(tpl, v) {
    const out = [];
    for (const line of String(tpl || '').split(/\r?\n/)) {
      const parts = [];
      for (const part of line.split(' · ')) {
        const ks = [...part.matchAll(VAR_RE)].map((m) => m[1]); if (ks.length && ks.every((k) => !v[k])) continue;
        const text = part.replace(VAR_RE, (_, k) => v[k] || '').replace(/[<>]/g, '').trim(); if (!text) continue;
        // {الوضع} with its tone on a maker's card (v._st); on any other card it stays the plain chip it was
        const kind = partKind(part) === 'state' && !(v._st && v._st.length) ? 'chip' : partKind(part);
        parts.push(kind === 'makers' ? { kind, text, items: v._mk || [] } : kind === 'nums' ? { kind, text, items: v._nums || [] } : kind === 'state' ? { kind, text, items: v._st } : { kind, text });
      }
      if (parts.length) out.push(parts);
    }
    return out;
  }
  function render(rule, ent) {
    const o = ent && ent.o && typeof ent.o === 'object' ? ent.o : null;
    const v = Object.assign({ 'الاسم': ent && ent.name ? String(ent.name) : '', 'الرقم': ent && ent.ref ? String(ent.ref) : '', 'الوضع': ent && ent.state ? String(ent.state) : '', 'التفاصيل': ent && ent.line ? String(ent.line) : '' },
      orderVars(o ? Object.assign({ customer: ent && ent.group && ent.group.g === 'customer' ? ent.group.name : '' }, o) : null, ''),
      ent && ent.group && ent.group.g === 'vendor' ? makerVars({ g: 'vendor', gname: ent.group.name, n: ent.n, pcs: ent.pcs, st: ent.st, sm: ent.sm, nums: ent.nums, v: { n: ent.name, s: ent.state } }, '') : null);
    const tpl = String(rule && rule.template ? rule.template : '').trim();
    const body = tpl ? cardLines(tpl, v).map((L) => L.map((p) => p.text).join(' · ')).join('\n') : v['التفاصيل'];
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
  // a rule's level: its state's own, else «important» for a state / a due date and «info» for an event (a `dyn` state: by its type)
  function levelOf(rule) {
    if (rule && LV_RANK[rule.level] != null) return rule.level;
    const t = rule ? typeOf(rule.element, rule.type) : null; const s = t ? t.states.find((x) => x.id === rule.state) : null;
    if (s && s.level) return s.level;
    return kindOf(rule) === 'event' ? 'info' : 'important';
  }
  // the «تفاصيل الظهور» a level asks for (a new rule's default; 0161 set the old rules to it): critical and important stay till the
  // state changes — a critical event a fixed 72 hours (reading it does not hide it), an important one till read + 6 hours; info goes
  // 2 hours after it is read (and INFO_MAX_H at the latest)
  // a rule's level with all its parts: the highest of them (a report that holds a critical part is critical)
  function levelOfAll(rule) { if (rule && LV_RANK[rule.level] != null) return rule.level; return partsOf(rule).map(levelOf).sort((a, b) => LV_RANK[a] - LV_RANK[b])[0] || levelOf(rule); }
  function showOf(level, kind) {
    if (level === 'critical') return kind === 'state' ? { show: 'until_state', hours: 0 } : { show: 'fixed', hours: 72 };
    if (level === 'important') return kind === 'state' ? { show: 'until_state', hours: 0 } : kind === 'due' ? { show: 'fixed', hours: 48 } : { show: 'until_read', hours: 6 };
    if (level === 'normal') return kind === 'state' ? { show: 'until_state', hours: 0 } : kind === 'due' ? { show: 'fixed', hours: 24 } : { show: 'until_read', hours: 2 };
    return { show: 'until_read', hours: 2 };
  }
  const api = { VARS, BASE_VARS, MAKER_VARS, ORDER_TPL, MAKER_TPL, NUMS_MAX, numsOf, makerVars, isMakerRule, followOf, pcsWord, makersOf, DL_WORD, orderVars, metaFacts, cardLines, alertVars, sampleVars, isOrderRule, varsOf, templateOf, ELEMENTS, AGENTS, LEVELS, LV_RANK, INFO_MAX_H, CONDS_MAX, MODES, partsOf, partLabel, levelOfAll, REPEATS, SHOWS, SHOW_HOURS, CHANNELS, LIVE_CHANNELS, el, typeOf, statesOf, stateOf, ruleError, render, due, runs, kindOf, levelOf, showOf, elementOfKind };
  root.IBNotifCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
