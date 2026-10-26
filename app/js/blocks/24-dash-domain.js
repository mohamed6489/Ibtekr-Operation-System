
/* Ibtekr — dashboard rules (owner 22 Oct; Figma «لوحة التحكم» 526:35690). Pure, no DOM. UMD. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrDash = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ROLES = Object.freeze(['أدمن', 'عمليات', 'خدمة العملاء', 'حسابات', 'متابعة الموردين', 'مشاهد']);
  const CARD = Object.freeze({
    kpis: 'المؤشرات', daily: 'يومي', need: 'محتاج منك دلوقتي', weeks: 'الأوردرات آخر 5 أسابيع', health: 'صحة العمليات النهارده',
    confirm: 'حالة التأكيد', followCustomers: 'عملاء محتاجين متابعة', stockToday: 'المخزن النهارده', money: 'الفلوس', expByType: 'مصروفات الشهر حسب النوع',
    vendors: 'الموردين المحتاجين متابعة', statements: 'كشوف حساب الموردين', team: 'الفريق دلوقتي', system: 'تنبيهات النظام', activity: 'آخر نشاط',
  });
  const LOCKED = new Set(['need']);
  const BY_ROLE = Object.freeze({
    'أدمن': ['kpis', 'daily', 'need', 'weeks', 'health', 'money', 'vendors', 'team', 'system', 'activity'],
    'عمليات': ['kpis', 'daily', 'need', 'weeks', 'health', 'stockToday', 'vendors', 'team', 'activity'],
    'خدمة العملاء': ['kpis', 'daily', 'need', 'confirm', 'followCustomers', 'weeks', 'activity'],
    'حسابات': ['kpis', 'daily', 'need', 'expByType', 'money', 'statements', 'activity'],
    'متابعة الموردين': ['kpis', 'daily', 'need', 'vendors', 'statements', 'activity'],
    'مشاهد': ['kpis', 'daily', 'need', 'activity'],
  });
  const KPIS = Object.freeze({
    'أدمن': ['sales', 'net', 'open', 'late', 'actual'],
    'عمليات': ['open', 'ready', 'consLate', 'returns', 'late'],
    'خدمة العملاء': ['convWaiting', 'firstReply', 'unconf', 'lateOrders', 'rating'],
    'حسابات': ['expenses', 'actual', 'vendorBal', 'deposits', 'payroll'],
    'متابعة الموردين': ['vendorsLate', 'vendorsRisk', 'subsUnnotified', 'contracts', 'nextStatement'],
    'مشاهد': ['myTasks', 'mentions', 'photo'],
  });
  const MONEY_KPIS = Object.freeze(['sales', 'net', 'actual', 'expenses', 'vendorBal', 'deposits', 'payroll']);
  const roleOf = (r) => (BY_ROLE[r] ? r : 'مشاهد');
  const cardsFor = (role) => BY_ROLE[roleOf(role)].map((id) => ({ id, label: CARD[id], locked: LOCKED.has(id) }));
  const kpisFor = (role) => KPIS[roleOf(role)].slice();
  // saved prefs {order, hidden}: keeps the saved order, drops cards the role can't see, appends new ones; locked cards never hide
  function layout(role, prefs) {
    const all = cardsFor(role); const p = prefs || {}; const ids = all.map((c) => c.id);
    const order = (p.order || []).filter((id) => ids.includes(id)); ids.forEach((id) => { if (!order.includes(id)) order.push(id); });
    const hidden = new Set(p.hidden || []);
    return order.map((id) => { const c = all.find((x) => x.id === id); return Object.assign({}, c, { hidden: !c.locked && hidden.has(id) }); });
  }
  const RANK = { error: 0, orange: 1, warning: 2 };
  // bell sections (already filtered by role) → the most urgent received items
  function topNeed(sections, n) {
    const items = [];
    (sections || []).forEach((s) => { const all = (s.tabs || []).find((t) => t[0] === 'all'); (all ? all[2] : []).forEach((it, i) => { if (!it.muted) items.push(Object.assign({}, it, { section: s.label, _i: items.length + i })); }); });
    const sorted = items.map((x, i) => [x, i]).sort((a, b) => ((RANK[a[0].tone] ?? 3) - (RANK[b[0].tone] ?? 3)) || a[1] - b[1]).map((x) => x[0]);
    return { items: sorted.slice(0, n || 5), total: items.length };
  }
  const DONE = new Set(['مكتمل', 'ملغي', 'استرجاع', 'فشل']);
  function health(rows) {
    const open = (rows || []).filter((r) => !DONE.has(r.status)); const n = open.length;
    const c = (f) => open.filter(f).length;
    const mk = (key, label, count, tone) => ({ key, label, count, tone, pct: n ? count / n : 0 });
    return { open: n, rows: [mk('progress', 'قيد التنفيذ', c((r) => r.status === 'جاري التنفيذ'), 'brand'), mk('shipping', 'قيد الشحن', c((r) => r.status === 'قيد الشحن' || r.status === 'جاهز للشحن'), 'gold'),
      mk('unconf', 'غير مؤكد', c((r) => r.confirm === 'غير مؤكد'), 'goldlight'), mk('risk', 'قابل للتأخير', c((r) => r.delivery === 'risk'), 'neutral'), mk('late', 'متأخر', c((r) => r.delivery === 'late'), 'neutral')] };
  }
  const greeting = (min) => (min < 12 * 60 ? 'صباح الخير' : 'مساء الخير');
  function countDelta(cur, prev, good) { const d = cur - prev; return { text: (d > 0 ? '+' : '') + d, tone: d === 0 ? 'neutral' : ((d > 0) === (good === 'up') ? 'positive' : 'negative') }; }
  const countIn = (orders, r) => (orders || []).filter((o) => o.date >= r.from && o.date <= r.to).length;
  const QA = [
    ['expense', '+ مصروف', 'wallet', ['أدمن', 'حسابات']], ['vendorMove', '+ حركة لمورد', 'wallet', ['أدمن', 'حسابات', 'متابعة الموردين']], ['vendor', '+ مبتكر جديد', 'users', ['أدمن', 'متابعة الموردين']],
    ['ticket', '+ تذكرة', 'ticket', ['أدمن', 'عمليات', 'خدمة العملاء', 'حسابات', 'متابعة الموردين']], ['vendorReport', 'تقرير مورد…', 'chart', ['أدمن', 'حسابات', 'متابعة الموردين']],
    ['clock', 'بدء / إنهاء الدوام', 'clock', ROLES], ['leave', 'طلب إجازة', 'cal', ROLES], ['notifs', 'فتح الإشعارات', 'bell', ROLES]];
  const quickActions = (role) => QA.filter((a) => a[3].includes(roleOf(role))).map(([id, label, icon]) => ({ id, label, icon }));
  // next send date for «أيام محددة من الشهر» (1–28 + 'last'); today counts
  function nextMonthDay(today, days) {
    if (!days || !days.length) return null; const [y, m, d] = today.split('-').map(Number); const pad = (n) => String(n).padStart(2, '0');
    for (let k = 0; k < 2; k++) { const yy = y + Math.floor((m - 1 + k) / 12), mm = ((m - 1 + k) % 12) + 1; const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const list = days.map((x) => (x === 'last' ? last : Math.min(Number(x), last))).sort((a, b) => a - b); const hit = list.find((x) => k > 0 || x >= d); if (hit) return yy + '-' + pad(mm) + '-' + pad(hit); }
    return null;
  }
  // Figma widths on a 12-column grid; rows keep the saved order and never leave holes
  const SPAN = { daily: 4, need: 8, weeks: 7, health: 5, team: 4, system: 4, activity: 4 };
  function packRows(ids) {
    const out = []; let row = [];
    const close = () => { if (!row.length) return; const used = row.reduce((t, x) => t + x[1], 0); row[row.length - 1][1] += 12 - used; out.push(...row); row = []; };
    (ids || []).forEach((id) => { const w = SPAN[id] || 6; const used = row.reduce((t, x) => t + x[1], 0); if (used + w > 12) close(); row.push([id, w]); });
    close(); return out;
  }
  return Object.freeze({ packRows, nextMonthDay, ROLES, CARD, MONEY_KPIS, cardsFor, kpisFor, layout, topNeed, health, greeting, countDelta, countIn, quickActions, roleOf });
});

