
/* Ibtekr Reports — pure computations for the Reports page. No DOM, no I/O.
   Inputs are the rows exposed by OrdersApp.query() and the accounts seed/derived values.
   UMD so the same file runs in node tests and inside the published page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrReports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const OPEN_STATUSES = new Set(['جاري التنفيذ', 'معلّق', 'قيد الشحن']);
  const STATUS_ORDER = ['جاري التنفيذ', 'مكتمل', 'قيد الشحن', 'معلّق', 'ملغي', 'مرتجع'];
  const CONFIRM_ORDER = ['مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد'];
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const toIso = (ms) => { const t = new Date(ms); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
  const addDays = (s, n) => toIso(toUtc(s) + n * DAY);
  const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const shortDate = (s) => { const [, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m - 1]; };

  // ---- period helpers ----
  const orderDate = (row, today) => addDays(today, -Number(row.ageDays || 0));
  const filterRange = (rows, range, today) => rows.filter((r) => { const d = orderDate(r, today); return d >= range.from && d <= range.to; });
  function previousRange(range) { const len = daysBetween(range.from, range.to) + 1; return { from: addDays(range.from, -len), to: addDays(range.from, -1) }; }

  // Saturday-start weekly buckets covering [from, to]
  function weeklyBuckets(from, to) {
    const satIndex = (s) => (new Date(toUtc(s)).getUTCDay() + 1) % 7; // Saturday = 0
    let start = addDays(from, -satIndex(from));
    const out = [];
    while (start <= to) {
      const end = addDays(start, 6);
      const sameMonth = start.slice(0, 7) === end.slice(0, 7);
      out.push({ from: start, to: end, label: sameMonth ? start.slice(8).replace(/^0/, '') + '–' + shortDate(end) : shortDate(start) + ' – ' + shortDate(end), count: 0, total: 0 });
      start = addDays(start, 7);
    }
    return out;
  }

  // ---- comparison ----
  // good: 'up' means an increase is good; minPrev: below it the comparison is not meaningful
  function delta(cur, prev, good, minPrev) {
    if (!(prev >= minPrev) || prev === 0) return { tone: 'neutral', text: '—', caption: 'فترة المقارنة أقل من ' + minPrev + ' أوردرات' };
    const pct = Math.round(((cur - prev) / prev) * 100);
    const text = (pct > 0 ? '+' : '') + pct + '%';
    const tone = pct === 0 ? 'neutral' : ((pct > 0) === (good === 'up') ? 'positive' : 'negative');
    return { tone, text, caption: 'عن الفترة السابقة (' + prev + ')' };
  }

  const countBy = (rows, key, order) => {
    const m = new Map(); rows.forEach((r) => m.set(r[key], (m.get(r[key]) || 0) + 1));
    return [...m.entries()].sort((a, b) => (b[1] - a[1]) || (order.indexOf(a[0]) - order.indexOf(b[0])));
  };
  const isOpen = (r) => OPEN_STATUSES.has(r.status);
  const needsAction = (r) => isOpen(r) && (r.delivery !== 'ok' || r.confirm === 'غير مؤكد' || r.confirm === 'في انتظار الرد');

  function summarize(rows) {
    const count = rows.length, total = round2(sum(rows, (r) => Number(r.total) || 0));
    const completed = rows.filter((r) => r.status === 'مكتمل').length;
    const cancelled = rows.filter((r) => r.status === 'ملغي').length;
    return { count, total, avg: count ? round2(total / count) : 0, completed, cancelled, completionRate: count ? completed / count : 0, needAction: rows.filter(needsAction).length };
  }

  // owner 22 Oct: «أوردرات ملغية» tile → report of the reasons entered when an order is cancelled
  const NO_REASON = 'غير مسجّل';
  function cancelReasons(rows) {
    const list = (rows || []).filter((r) => r.status === 'ملغي'); const m = new Map();
    list.forEach((r) => { const k = String(r.reason || '').trim() || NO_REASON; const g = m.get(k) || { reason: k, count: 0, total: 0, rows: [] }; g.count++; g.total = round2(g.total + (Number(r.total) || 0)); g.rows.push(r); m.set(k, g); });
    const byReason = [...m.values()].map((g) => Object.assign(g, { pct: list.length ? g.count / list.length : 0 }))
      .sort((a, b) => (a.reason === NO_REASON) - (b.reason === NO_REASON) || b.count - a.count || b.total - a.total);
    return { count: list.length, total: round2(sum(list, (r) => Number(r.total) || 0)), recorded: list.filter((r) => String(r.reason || '').trim()).length, byReason };
  }

  function ordersReport(allRows, range, today) {
    const rows = filterRange(allRows, range, today);
    const prevRows = filterRange(allRows, previousRange(range), today);
    const cur = summarize(rows), prev = summarize(prevRows);
    const weekly = weeklyBuckets(range.from, range.to);
    rows.forEach((r) => { const d = orderDate(r, today); const w = weekly.find((x) => d >= x.from && d <= x.to); if (w) { w.count++; w.total += Number(r.total) || 0; } });
    const byDelivery = { ok: 0, risk: 0, late: 0 }; rows.forEach((r) => { byDelivery[r.delivery] = (byDelivery[r.delivery] || 0) + 1; });
    const actionRows = rows.filter(needsAction).sort((a, b) => b.ageDays - a.ageDays || b.total - a.total);
    const MIN = 10;
    return Object.assign(cur, {
      rows, prev,
      byStatus: countBy(rows, 'status', STATUS_ORDER), byConfirm: countBy(rows, 'confirm', CONFIRM_ORDER), byDelivery, weekly, actionRows,
      deltas: { count: delta(cur.count, prev.count, 'up', MIN), avg: delta(cur.avg, prev.avg, 'up', MIN), completionRate: delta(Math.round(cur.completionRate * 100), Math.round(prev.completionRate * 100), 'up', MIN), needAction: delta(cur.needAction, prev.needAction, 'down', 3) },
    });
  }

  const pctNum = (s) => { const n = parseFloat(String(s)); return Number.isFinite(n) ? n / 100 : null; };

  function vendorsReport(allRows, range, today, seedVendors) {
    const rows = filterRange(allRows, range, today);
    const prevRows = filterRange(allRows, previousRange(range), today);
    const agg = (list) => { const m = new Map(); list.forEach((r) => (r.vendors || []).forEach((v) => { const a = m.get(v) || { orders: 0, late: 0 }; a.orders++; if (isOpen(r) && r.delivery !== 'ok') a.late++; m.set(v, a); })); return m; };
    const m = agg(rows), pm = agg(prevRows);
    const seed = new Map((seedVendors || []).map((v) => [v.name, v]));
    const names = [...new Set([...m.keys(), ...seed.keys()])];
    const tableRows = names.map((name) => { const a = m.get(name) || { orders: 0, late: 0 }; const s = seed.get(name) || {}; return { name, orders: a.orders, late: a.late, pct: s.pct || '—', share: s.c ? s.c[2] : 0, deposits: s.deposits || 0, balance: s.balance || 0 }; })
      .filter((r) => r.orders > 0 || r.deposits || r.balance || r.share).sort((a, b) => b.orders - a.orders || b.late - a.late || a.name.localeCompare(b.name));
    const pcts = (seedVendors || []).map((v) => pctNum(v.pct)).filter((x) => x != null && x < 1);
    const byOrders = [...m.entries()].map(([n, a]) => [n, a.orders]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const late = [...m.entries()].filter(([, a]) => a.late > 0).map(([n, a]) => [n, a.late]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const active = m.size, withDelay = late.length, prevActive = pm.size, prevDelay = [...pm.values()].filter((a) => a.late > 0).length;
    return { rows: tableRows, active, withDelay, avgCommission: pcts.length ? round2(sum(pcts) / pcts.length * 1000) / 1000 : 0, deposits: round2(sum(seedVendors || [], (v) => v.deposits || 0)),
      topByOrders: byOrders.slice(0, 6), topLate: late.slice(0, 6), totals: { orders: sum(tableRows, (r) => r.orders), late: sum(tableRows, (r) => r.late), share: round2(sum(tableRows, (r) => r.share)), deposits: round2(sum(tableRows, (r) => r.deposits)), balance: round2(sum(tableRows, (r) => r.balance)) },
      deltas: { active: delta(active, prevActive, 'up', 3), withDelay: delta(withDelay, prevDelay, 'down', 3) } };
  }

  function accountsReport({ expenses, sales, accounts, inProgressShare, deposits }) {
    const expensesTotal = round2(sum(Object.values(expenses || {})));
    const share = round2(sum(sales || [], (s) => s.share || 0)), salesTotal = round2(sum(sales || [], (s) => s.sales || 0)), orders = sum(sales || [], (s) => s.orders || 0);
    const actual = round2(sum(Object.values(accounts || {})));
    const potential = round2(actual + (inProgressShare || 0) + (deposits || 0));
    const dist = (entries, total) => entries.map(([k, v]) => [k, v, total ? v / total : 0]).sort((a, b) => b[1] - a[1]);
    return { expensesTotal, share, salesTotal, orders, net: round2(share - expensesTotal), actual, potential, sharePct: salesTotal ? round2(share / salesTotal * 1000) / 1000 : 0,
      expenseRows: dist(Object.entries(expenses || {}), expensesTotal),
      salesRows: (sales || []).map((s) => [s.label, s.sales, s.share]).sort((a, b) => b[1] - a[1]),
      accountRows: dist(Object.entries(accounts || {}), actual),
      potentialParts: dist([['الحساب الفعلي', actual], ['حصة إبتكر من أوردرات التنفيذ', inProgressShare || 0], ['عرابين مدفوعة للمبتكرين', deposits || 0]], potential) };
  }

  // ---- تقارير المنتجات (owner 27 Oct): الأكثر مبيعًا (أعلى 20) · المنتجات اللي نفد مخزونها · الأقسام الأكثر مبيعًا ----
  const NOT_SOLD = new Set(['ملغي', 'استرجاع', 'مرتجع']);
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function topProducts(rows, range, today, n = 20) {
    const cur = filterRange(rows, range, today).filter((r) => !NOT_SOLD.has(r.status));
    const m = new Map();
    cur.forEach((r) => (r.items || []).forEach((it) => { const name = cleanName(it.prod) || '—'; const k = name.toLowerCase();
      const x = m.get(k) || { name, skus: new Set(), vendors: new Set(), qty: 0, revenue: 0, orders: new Set() };
      x.qty += Number(it.qty) || 1; x.revenue += Number(it.tot) || 0; x.orders.add(r.id); if (it.sku) x.skus.add(it.sku); if (it.vendor) x.vendors.add(it.vendor); m.set(k, x); }));
    const all = [...m.values()].map((x) => ({ name: x.name, sku: [...x.skus][0] || '—', skuCount: x.skus.size, vendor: [...x.vendors].join('، ') || '—', qty: x.qty, revenue: round2(x.revenue), orders: x.orders.size }))
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name));
    return { top: all.slice(0, n).map((x, i) => Object.assign({ rank: i + 1 }, x)), distinct: all.length, qty: sum(all, (x) => x.qty), revenue: round2(sum(all, (x) => x.revenue)), orders: cur.length };
  }
  // products = WooCommerce mirror: { name, sku, vendor, status, stock, onDemand, sales, vars:[{label, sku, stock, onDemand}] }
  function outOfStock(products) {
    const out = [];
    (products || []).forEach((p) => {
      const vars = p.vars || [];
      if (vars.length) { const gone = vars.filter((v) => !v.onDemand && !(Number(v.stock) > 0)); if (!gone.length) return;
        if (gone.length === vars.length) out.push({ name: p.name, sku: p.sku, vendor: p.vendor, status: p.status, kind: 'المنتج كله', detail: 'كل التركيبات (' + vars.length + ')', sales: p.sales || 0 });
        else gone.forEach((v) => out.push({ name: p.name, sku: v.sku || p.sku, vendor: p.vendor, status: p.status, kind: 'تركيبة', detail: v.label, sales: p.sales || 0 }));
        return; }
      if (!p.onDemand && !(Number(p.stock) > 0)) out.push({ name: p.name, sku: p.sku, vendor: p.vendor, status: p.status, kind: 'المنتج كله', detail: '—', sales: p.sales || 0 });
    });
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'المنتج كله' ? -1 : 1) || b.sales - a.sales);
  }
  // categories = WooCommerce «Categories» report rows; same-name sub-categories under different parents are merged
  function categoriesRank(cats, n) {
    const m = new Map();
    (cats || []).forEach((c) => { const name = cleanName(c.name); const k = name.toLowerCase(); const x = m.get(k) || { name, sold: 0, revenue: 0, products: 0, orders: 0 };
      x.sold += Number(c.sold) || 0; x.revenue += Number(c.revenue) || 0; x.products += Number(c.products) || 0; x.orders += Number(c.orders) || 0; m.set(k, x); });
    const all = [...m.values()].sort((a, b) => b.sold - a.sold || b.revenue - a.revenue); const tot = sum(all, (x) => x.sold);
    return (n ? all.slice(0, n) : all).map((x, i) => Object.assign({ rank: i + 1, share: tot ? round2(x.sold / tot * 1000) / 1000 : 0 }, x));
  }
  // ---- تقرير الموظفين (owner 27 Oct): أكتر 5 عندهم مهام · أكتر 5 غياب · أسرع 5 رد · أعلى 5 تقييم ----
  const OPEN_TASK = (t) => !t.done && !['خلصت', 'اتأجلت'].includes(t.status);
  const ABSENT = /غياب|غائب|غايب/;
  function staffReport({ members, tasks, attendance, todayAbsent, resp, scores, from, to }) {
    const M = (members || []); const top = (arr, n = 5) => arr.slice(0, n).map((x, i) => Object.assign({ rank: i + 1 }, x));
    const taskRows = M.map((m) => { const L = (tasks || []).filter((t) => t.member === m.id); return { id: m.id, name: m.name, title: m.title, open: L.filter(OPEN_TASK).length, total: L.length }; })
      .filter((x) => x.open > 0).sort((a, b) => b.open - a.open || b.total - a.total);
    const absRows = M.map((m) => { const days = (attendance || []).filter((a) => a.member === m.id && ABSENT.test(a.status || '') && (!from || a.date >= from) && (!to || a.date <= to)).map((a) => a.date);
      if ((todayAbsent || []).includes(m.id)) days.push('اليوم'); return { id: m.id, name: m.name, title: m.title, days: days.length, dates: days }; })
      .filter((x) => x.days > 0).sort((a, b) => b.days - a.days);
    const respRows = M.filter((m) => resp && resp[m.id] != null).map((m) => ({ id: m.id, name: m.name, title: m.title, minutes: resp[m.id] })).sort((a, b) => a.minutes - b.minutes);
    const last = (sc) => { const ks = Object.keys(sc || {}).map(Number).sort((a, b) => a - b); return ks.length ? { month: ks[ks.length - 1], score: sc[ks[ks.length - 1]], avg: round2(sum(ks, (k) => sc[k]) / ks.length) } : null; };
    const rateRows = M.map((m) => { const l = last(scores && scores[m.id]); return l ? { id: m.id, name: m.name, title: m.title, score: l.score, month: l.month, avg: l.avg } : null; }).filter(Boolean).sort((a, b) => b.score - a.score || b.avg - a.avg);
    return { tasks: top(taskRows), absence: top(absRows), fastest: top(respRows), rating: top(rateRows), counts: { members: M.length, openTasks: sum(taskRows, (x) => x.open), absentDays: sum(absRows, (x) => x.days) } };
  }
  // ---- تقرير الحملات الإعلانية (owner 27 Oct): الحملات الشغالة · الصرف · أوردرات المنصة (ميتا…) جنب أوردرات ووكومرس (utm) · أقوى 5
  // camps rows: [name, platform, status, spend, platformPurchases, wooOrders, realRoas, cpa, decision]
  // ---- الحملات في فترة (owner 2 Nov 03:08: زرار التاريخ مكان «من غير فلتر تاريخ» — والفترة لازم تغيّر الأرقام) ----
  // c = [الاسم، المنصة، الحالة، صرف أسبوع، مشتريات المنصة في الأسبوع، أوردرات ووكومرس في الأسبوع، العائد، تكلفة الأوردر، القرار، بداية الحملة، نهايتها]
  // بيانات المثال: متوسط الأسبوع بيتوزع على أيام شغل الحملة جوه الفترة (وزن لكل يوم) — السيستم الحقيقي بيقرا الأرقام اليومية من المنصة.
  const DAY_W = [1, 0.9, 1.1, 1.05, 0.95, 1, 1]; // السبت → الجمعة · مجموعهم 7 = أسبوع كامل بيرجّع نفس رقم الأسبوع
  function campaignDays(c, range, today) {
    const from = [range.from, c[9] || range.from].sort().pop(); const to = [range.to, c[10] || today, today].sort()[0];
    const out = []; let po = 0, wo = 0;
    for (let d = from, i = 0; d <= to && i < 800; d = addDays(d, 1), i++) {
      const w = DAY_W[(new Date(toUtc(d)).getUTCDay() + 1) % 7] / 7;
      const p1 = po + (Number(c[4]) || 0) * w, w1 = wo + (Number(c[5]) || 0) * w; // تقريب تراكمي: مجموع الأيام = رقم الفترة بالظبط
      out.push({ date: d, spend: round2((Number(c[3]) || 0) * w), platformOrders: Math.round(p1) - Math.round(po), wooOrders: Math.round(w1) - Math.round(wo) });
      po = p1; wo = w1;
    }
    return out;
  }
  function campaignsInRange(camps, range, today) {
    return (camps || []).map((c) => { const days = campaignDays(c, range, today); if (!days.length) return null;
      const spend = round2(sum(days, (d) => d.spend)), woo = sum(days, (d) => d.wooOrders);
      return [c[0], c[1], c[2], spend, sum(days, (d) => d.platformOrders), woo, c[6], woo ? Math.round(spend / woo) : null, c[8], c[9] || null, c[10] || null, days]; }).filter(Boolean);
  }
  function campaignsReport(camps) {
    const all = (camps || []).map((c) => ({ name: c[0], platform: c[1], status: c[2], spend: Number(c[3]) || 0, platformOrders: Number(c[4]) || 0, wooOrders: Number(c[5]) || 0, roas: Number(c[6]) || 0, decision: c[8] || '—' }))
      .map((c) => Object.assign(c, { cpa: c.wooOrders ? round2(c.spend / c.wooOrders) : null, gap: c.platformOrders - c.wooOrders, revenue: round2(c.spend * c.roas) }));
    const live = all.filter((c) => c.status === 'شغالة');
    const tot = (L) => { const spend = sum(L, (c) => c.spend), woo = sum(L, (c) => c.wooOrders); return { spend, platformOrders: sum(L, (c) => c.platformOrders), wooOrders: woo, revenue: round2(sum(L, (c) => c.revenue)), cpa: woo ? round2(spend / woo) : null, roas: spend ? round2(sum(L, (c) => c.revenue) / spend) : 0 }; };
    const byPlatform = [...new Set(all.map((c) => c.platform))].map((p) => Object.assign({ platform: p, count: live.filter((c) => c.platform === p).length }, tot(live.filter((c) => c.platform === p)))).filter((x) => x.count);
    const top5 = all.filter((c) => c.wooOrders > 0).sort((a, b) => b.roas - a.roas || b.wooOrders - a.wooOrders || a.spend - b.spend).slice(0, 5).map((c, i) => Object.assign({ rank: i + 1 }, c));
    return { live: live.sort((a, b) => b.spend - a.spend), totals: tot(live), meta: tot(live.filter((c) => c.platform === 'ميتا')), byPlatform, top5, all };
  }
  // ---- تقارير المخزن · خدمة العملاء · التذاكر (owner 27 Oct: «صفحة تقارير في كل حتة») ----
  // stock rows: { name, vendor, reason, status, onHand, reserved, available, cost, since }
  function inventoryReport(stock, returns, ledger) {
    const S = stock || [];
    const byReason = {}; const byStatus = {};
    S.forEach((x) => { byReason[x.reason || '—'] = (byReason[x.reason || '—'] || 0) + 1; byStatus[x.status || '—'] = (byStatus[x.status || '—'] || 0) + 1; });
    const value = round2(sum(S, (x) => (Number(x.cost) || 0) * (Number(x.onHand) != null ? Number(x.onHand) || 1 : 1)));
    const R = returns || [];
    const waiting = R.filter((x) => /بانتظار/.test(x.status || '')).length;
    const moves = (ledger || []).length;
    const dist = (o) => Object.entries(o).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count);
    const rows = S.slice().sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0)).slice(0, 20)
      .map((x) => ({ name: x.name, vendor: x.vendor || '—', reason: x.reason || '—', status: x.status || '—', onHand: Number(x.onHand) || 0, available: Number(x.available) || 0, cost: Number(x.cost) || 0, since: x.since || '—' }));
    return { pieces: S.length, value, waiting, moves, byReason: dist(byReason), byStatus: dist(byStatus), rows, returns: R.length };
  }
  // convs: { seg, status, waiting, assignee }, customers: { orders, total, lateOpen, openComplaints }
  function csReport(convs, customers, slaLate) {
    const C = (convs || []).filter((c) => c.seg !== 'vendors');
    const byStatus = {}; C.forEach((c) => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
    const waitingUs = C.filter((c) => ['جديدة', 'مستنية ردنا'].includes(c.status));
    const late = waitingUs.filter((c) => (Number(c.waiting) || 0) >= (slaLate || 15));
    const byAgent = {}; C.forEach((c) => { if (c.assignee) byAgent[c.assignee] = (byAgent[c.assignee] || 0) + 1; });
    const cu = customers || [];
    const problems = cu.filter((x) => x.lateOpen || x.openComplaints);
    const top = cu.filter((x) => x.orders > 0).sort((a, b) => b.total - a.total).slice(0, 10)
      .map((x, i) => ({ rank: i + 1, name: x.name, orders: x.orders, total: x.total, avg: x.orders ? round2(x.total / x.orders) : 0 }));
    const dist = (o) => Object.entries(o).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count);
    return { open: C.length, waitingUs: waitingUs.length, late: late.length, problems: problems.length, byStatus: dist(byStatus), byAgent: dist(byAgent), top, customers: cu.length };
  }
  // tickets: { id, type, priority, status, role, title }
  function ticketsReport(tickets) {
    const T = tickets || [];
    const openT = T.filter((t) => !/اتحل|مقفول|closed|resolved/i.test(t.status || ''));
    const cnt = (f) => { const o = {}; T.forEach((t) => { const k = f(t) || '—'; o[k] = (o[k] || 0) + 1; }); return Object.entries(o).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count); };
    const urgent = openT.filter((t) => /urgent|عاجل/i.test(t.priority || ''));
    const rows = openT.slice(0, 20).map((t) => ({ id: t.id, title: t.title, type: t.type, priority: t.priority, status: t.status, role: t.role || '—' }));
    return { total: T.length, open: openT.length, urgent: urgent.length, byType: cnt((t) => t.type), byRole: cnt((t) => t.role), byStatus: cnt((t) => t.status), rows };
  }
  function toCsv(headers, rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  }

  return Object.freeze({ cancelReasons, NO_REASON, orderDate, filterRange, previousRange, weeklyBuckets, delta, ordersReport, vendorsReport, accountsReport, toCsv, OPEN_STATUSES, topProducts, outOfStock, categoriesRank, staffReport, campaignsReport, campaignDays, campaignsInRange, inventoryReport, csReport, ticketsReport });
});

