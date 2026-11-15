import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// Phase 9 (docs/superpowers/plans/2026-11-05-phase-9-reports.md, decision 5): block 04 = the v2 reports domain verbatim — the
// orders / makers / accounts reports of before + the products, stock, customer-service and tickets reports the reports page reads.
const R = loadUmd(new URL('../../app/js/blocks/04-reports-domain.js', import.meta.url));
const json = (x) => JSON.parse(JSON.stringify(x));
const TODAY = '2026-11-05';
const row = (id, ageDays, status, items, extra) => ({ id, ageDays, status, total: 100, delivery: 'ok', confirm: 'مؤكد', customer: 'ع' + id, vendors: ['HANDS'], items, ...extra });

test('the v2 exports: the reports the page reads are all there', () => {
  ['ordersReport', 'vendorsReport', 'accountsReport', 'topProducts', 'outOfStock', 'categoriesRank', 'staffReport', 'campaignsReport', 'campaignsInRange', 'inventoryReport', 'csReport', 'ticketsReport', 'previousRange', 'compareLine', 'delta']
    .forEach((k) => assert.equal(typeof R[k], 'function', k));
});

test('the period: an order is in the range by its age from today; the previous range is the same length right before', () => {
  const rows = [row(1, 0, 'مكتمل', []), row(2, 10, 'مكتمل', []), row(3, 40, 'مكتمل', [])];
  assert.deepEqual(R.filterRange(rows, { from: '2026-10-07', to: TODAY }, TODAY).map((r) => r.id), [1, 2]);
  assert.deepEqual(json(R.previousRange({ from: '2026-10-07', to: '2026-11-05' })), { from: '2026-09-07', to: '2026-10-06' });
  assert.equal(R.delta(12, 10, 'up', 5).text, '+20%');
  assert.equal(R.delta(12, 2, 'up', 5).text, '—'); // too few to compare
});

// comments decision 14 (the owner 15 Nov): «مقارنة بفترة سابقة» with the member's own comparison period
test('the comparison period: the member\'s own «من» / «إلى» when both are dates in order, else the same length right before; the orders report compares against it', () => {
  const rg = { from: '2026-10-07', to: '2026-11-05' };
  assert.deepEqual(json(R.previousRange({ ...rg, cfrom: '2026-01-01', cto: '2026-01-31' })), { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(json(R.previousRange({ ...rg, cfrom: '2026-02-10', cto: '2026-02-01' })), { from: '2026-09-07', to: '2026-10-06' }); // out of order → the default
  assert.deepEqual(json(R.previousRange({ ...rg, cfrom: '2026-01-01' })), { from: '2026-09-07', to: '2026-10-06' }); // half a period → the default
  assert.deepEqual(json(R.previousRange({ ...rg, cfrom: 'x', cto: 'y' })), { from: '2026-09-07', to: '2026-10-06' });
  // the orders report's «قبل»: the orders of the typed period, not of the 30 days before
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, 280 + i, 'مكتمل', [])).concat([row(50, 1, 'مكتمل', []), row(51, 40, 'مكتمل', [])]);
  const own = R.ordersReport(rows, { ...rg, cfrom: '2026-01-01', cto: '2026-02-15' }, TODAY);
  assert.equal(own.count, 1); assert.equal(own.prev.count, 12);
  assert.equal(R.ordersReport(rows, rg, TODAY).prev.count, 1);
});

test('compareLine: the change between the two periods — the direction, the percent, and the tone by which way is good news', () => {
  assert.deepEqual(json(R.compareLine(9000, 8000, 'down')), { diff: 1000, pct: 13, dir: 'up', tone: 'negative', text: '+13%' }); // an expense that grew
  assert.deepEqual(json(R.compareLine(1800, 2500, 'down')), { diff: -700, pct: -28, dir: 'down', tone: 'positive', text: '−28%' });
  assert.deepEqual(json(R.compareLine(1800, 2500, 'up')), { diff: -700, pct: -28, dir: 'down', tone: 'negative', text: '−28%' });
  assert.equal(R.compareLine(5, 5, 'up').text, 'زي ما هو'); assert.equal(R.compareLine(5, 5, 'up').tone, 'neutral');
  assert.equal(R.compareLine(5, 0, 'up').text, 'جديد'); assert.equal(R.compareLine(5, 0, 'up').pct, null); // nothing to divide by
  assert.equal(R.compareLine(0, 5, 'up').text, '−100%');
  assert.equal(R.compareLine(120, 100, null).tone, 'neutral'); // neither way is good news (a count of moves)
  assert.equal(R.compareLine(-13518.45, -13250, 'up').text, '−2%'); // a loss that grew: against the size of the old figure
  assert.equal(R.compareLine(1000.2, 1000, 'up').text, '+أقل من 1%');
  // a figure that is itself a percentage: the change in points
  assert.equal(R.compareLine(66.7, 50, 'up', true).text, '+16.7 نقطة'); assert.equal(R.compareLine(40, 50, 'up', true).tone, 'negative');
});

test('topProducts: the pieces sold in the period by product, cancelled / returned left out, merged by name', () => {
  const rows = [
    row(1, 1, 'مكتمل', [{ prod: 'سلة  كروشيه', qty: 2, tot: 400, sku: 'S1', vendor: 'HANDS' }, { prod: 'فازة', qty: 1, tot: 300, sku: 'S2', vendor: 'Art' }]),
    row(2, 2, 'جاري التنفيذ', [{ prod: 'سلة كروشيه', qty: 1, tot: 200, sku: 'S1', vendor: 'HANDS' }]),
    row(3, 3, 'ملغي', [{ prod: 'فازة', qty: 5, tot: 1500, sku: 'S2', vendor: 'Art' }]),
    row(4, 90, 'مكتمل', [{ prod: 'فازة', qty: 9, tot: 2700, sku: 'S2', vendor: 'Art' }])];
  const t = R.topProducts(rows, { from: '2026-10-07', to: TODAY }, TODAY);
  assert.deepEqual(t.top.map((x) => [x.rank, x.name, x.qty, x.revenue, x.orders]), [[1, 'سلة كروشيه', 3, 600, 2], [2, 'فازة', 1, 300, 1]]);
  assert.deepEqual([t.distinct, t.qty, t.revenue, t.orders], [2, 4, 900, 2]);
});

test('outOfStock and categoriesRank: a whole product or a single variation; «حسب الطلب» is never out; same-name categories merged', () => {
  const out = R.outOfStock([{ name: 'A', sku: 'A', stock: 0, vars: [] }, { name: 'B', sku: 'B', stock: 0, onDemand: true, vars: [] },
    { name: 'C', sku: 'C', vars: [{ label: 'أحمر', sku: 'C-R', stock: 0 }, { label: 'أزرق', sku: 'C-B', stock: 3 }] }, { name: 'D', vars: [{ label: 'x', stock: 0 }] }]);
  assert.deepEqual(out.map((x) => [x.name, x.kind]), [['A', 'المنتج كله'], ['D', 'المنتج كله'], ['C', 'تركيبة']]);
  const cats = R.categoriesRank([{ name: 'Decor', sold: 10, revenue: 100 }, { name: 'decor ', sold: 5, revenue: 50 }, { name: 'Home', sold: 5, revenue: 80 }]);
  assert.deepEqual(cats.map((c) => [c.rank, c.name, c.sold, c.share]), [[1, 'Decor', 15, 0.75], [2, 'Home', 5, 0.25]]);
});

test('inventoryReport: pieces, value, returns waiting, the moves of the period, by reason and status', () => {
  const rep = R.inventoryReport([{ name: 'سلة', reason: 'تجميع أوردر', status: 'وصل المخزن', onHand: 2, available: 0, cost: 100 }, { name: 'فازة', reason: 'متاح للبيع', status: 'متاح', onHand: 1, available: 1, cost: 300 }],
    [{ status: 'بانتظار الفحص' }, { status: 'اتفحص — سليم' }], [{}, {}, {}]);
  assert.deepEqual([rep.pieces, rep.value, rep.waiting, rep.moves, rep.returns], [2, 500, 1, 3, 2]);
  assert.deepEqual(rep.rows.map((x) => x.name), ['فازة', 'سلة']); // by cost
  assert.deepEqual(json(rep.byReason).map((x) => x.label).sort(), ['تجميع أوردر', 'متاح للبيع']);
});

test('csReport: customers\' open conversations (makers\' left out), waiting for us, past the reply target, customers needing follow-up, the top buyers', () => {
  const rep = R.csReport([{ seg: 'customers', status: 'جديدة', waiting: 20, assignee: 'سارة' }, { seg: 'comments', status: 'مستنية ردنا', waiting: 5 }, { seg: 'vendors', status: 'جديدة', waiting: 90 }, { seg: 'customers', status: 'مستنية العميل', assignee: 'سارة' }],
    [{ name: 'هالة', orders: 3, total: 3000 }, { name: 'منى', orders: 1, total: 500, lateOpen: 1 }, { name: 'lead', orders: 0, total: 0, openComplaints: 1 }], 15);
  assert.deepEqual([rep.open, rep.waitingUs, rep.late, rep.problems, rep.customers], [3, 2, 1, 2, 3]);
  assert.deepEqual(rep.top.map((x) => [x.rank, x.name, x.avg]), [[1, 'هالة', 1000], [2, 'منى', 500]]);
  assert.deepEqual(json(rep.byAgent), [{ label: 'سارة', count: 2 }]);
});

test('ticketsReport: open (not resolved / closed), urgent, by type / role / status', () => {
  const rep = R.ticketsReport([{ id: 'TKT-0001', type: 'مشكلة عميل', priority: 'عاجل', status: 'open', role: 'الحسابات' }, { id: 'TKT-0002', type: 'تعليق داخلي', priority: 'عادي', status: 'resolved', role: 'الحسابات' }, { id: 'TKT-0003', type: 'مشكلة عميل', priority: 'عادي', status: 'closed', role: 'خدمة العملاء' }]);
  assert.deepEqual([rep.total, rep.open, rep.urgent], [3, 1, 1]);
  assert.deepEqual(json(rep.byRole), [{ label: 'الحسابات', count: 2 }, { label: 'خدمة العملاء', count: 1 }]);
  assert.deepEqual(rep.rows.map((x) => x.id), ['TKT-0001']);
});

test('the makers wording: «العرابين المدفوعة للمبتكرين» in the accounts potential', () => {
  const rep = R.accountsReport({ expenses: { 'المصروفات': 40 }, sales: [{ label: 'مكتمل', sales: 1000, share: 300, orders: 4 }], accounts: { 'البنك': 500 }, inProgressShare: 10, deposits: 5 });
  assert.deepEqual([rep.net, rep.actual, rep.potential], [260, 500, 515]);
  assert.ok(json(rep.potentialParts).some((p) => p[0] === 'عرابين مدفوعة للمبتكرين' && p[1] === 5));
});

// docs/superpowers/plans/2026-11-14-settings-lists.md decision 4: the weekly buckets start on the settings' week start
test('settings lists: the weekly buckets follow the week start (Saturday by default)', () => {
  const prev = globalThis.IBSettings;
  try {
    assert.equal(R.weeklyBuckets('2026-11-01', '2026-11-20')[0].from, '2026-10-31'); // Saturday
    globalThis.IBSettings = { weekStart: () => 0 };
    assert.deepEqual(R.weeklyBuckets('2026-11-01', '2026-11-20').map((b) => b.from), ['2026-11-01', '2026-11-08', '2026-11-15']);
    globalThis.IBSettings = { weekStart: () => 1 };
    assert.equal(R.weeklyBuckets('2026-11-01', '2026-11-20')[0].from, '2026-10-26');
    globalThis.IBSettings = { weekStart: () => 3 }; // not a choice → Saturday
    assert.equal(R.weeklyBuckets('2026-11-01', '2026-11-20')[0].from, '2026-10-31');
  } finally { if (prev === undefined) delete globalThis.IBSettings; else globalThis.IBSettings = prev; }
});
