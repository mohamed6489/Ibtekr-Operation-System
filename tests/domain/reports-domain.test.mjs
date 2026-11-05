import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// Phase 9 (docs/superpowers/plans/2026-11-05-phase-9-reports.md, decision 5): block 04 = the v2 reports domain verbatim — the
// orders / makers / accounts reports of before + the products, stock, customer-service and tickets reports the reports page reads.
const R = loadUmd(new URL('../../app/js/blocks/04-reports-domain.js', import.meta.url));
const json = (x) => JSON.parse(JSON.stringify(x));
const TODAY = '2026-11-05';
const row = (id, ageDays, status, items, extra) => ({ id, ageDays, status, total: 100, delivery: 'ok', confirm: 'مؤكد', customer: 'ع' + id, vendors: ['HANDS'], items, ...extra });

test('the v2 exports: the reports the page reads are all there', () => {
  ['ordersReport', 'vendorsReport', 'accountsReport', 'topProducts', 'outOfStock', 'categoriesRank', 'staffReport', 'campaignsReport', 'campaignsInRange', 'inventoryReport', 'csReport', 'ticketsReport', 'previousRange', 'delta']
    .forEach((k) => assert.equal(typeof R[k], 'function', k));
});

test('the period: an order is in the range by its age from today; the previous range is the same length right before', () => {
  const rows = [row(1, 0, 'مكتمل', []), row(2, 10, 'مكتمل', []), row(3, 40, 'مكتمل', [])];
  assert.deepEqual(R.filterRange(rows, { from: '2026-10-07', to: TODAY }, TODAY).map((r) => r.id), [1, 2]);
  assert.deepEqual(json(R.previousRange({ from: '2026-10-07', to: '2026-11-05' })), { from: '2026-09-07', to: '2026-10-06' });
  assert.equal(R.delta(12, 10, 'up', 5).text, '+20%');
  assert.equal(R.delta(12, 2, 'up', 5).text, '—'); // too few to compare
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
