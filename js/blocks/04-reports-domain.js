
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
      potentialParts: dist([['الحساب الفعلي', actual], ['حصة إبتكر من أوردرات التنفيذ', inProgressShare || 0], ['عرابين مدفوعة للموردين', deposits || 0]], potential) };
  }

  function toCsv(headers, rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  }

  return Object.freeze({ cancelReasons, NO_REASON, orderDate, filterRange, previousRange, weeklyBuckets, delta, ordersReport, vendorsReport, accountsReport, toCsv, OPEN_STATUSES });
});

