// «املا التفاصيل من اللينك ده» (app/js/pages/report-ask.js — docs/superpowers/plans/2026-11-28-ask-popups.md, phase A, Safwat 28 Nov):
// a report asked of an assistant is a popup of element › type › states › items; its rows are the ready reports' readers on the member's
// own pages, the states together (a row once) and the items narrowing the sources first — none picked = all of them.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
globalThis.IBNotifCatalog = loadUmd(new URL('../../app/js/pages/notif-catalog.js', import.meta.url));
globalThis.IBAgentDetails = loadUmd(new URL('../../app/js/pages/agent-details.js', import.meta.url));
globalThis.IBAgentReady = loadUmd(new URL('../../app/js/pages/agent-ready.js', import.meta.url));
const RA = loadUmd(new URL('../../app/js/pages/report-ask.js', import.meta.url));

test('detect: «تقرير» / «تقارير» asks the popup; the sales / expenses read-outs and the quick questions stay as they are', () => {
  for (const t of ['عايز تقرير', 'اعملي تقرير بالأوردرات المتأخرة', 'تقارير المبتكرين', 'report please']) assert.equal(RA.detect(t), true, t);
  for (const t of ['تقرير المبيعات الشهر ده', 'تقرير المصروفات', 'كام أوردر متأخر؟', 'مين المتأخر', '']) assert.equal(RA.detect(t), false, t);
});

test('preOf: the element and the state said are picked when that state has a list', () => {
  assert.deepEqual(RA.preOf('تقرير الأوردرات المتأخرة').parts, [{ element: 'orders', type: 'delay', states: ['late'], items: [] }]);
  assert.deepEqual(RA.preOf('تقرير الأوردرات الفرعية القابلة للتأخير').parts[0].element, 'subs');
  assert.deepEqual(RA.preOf('تقرير المبتكرين').parts, [{ element: 'makers', type: '', states: [], items: [] }]);
  assert.deepEqual(RA.preOf('عايز تقرير').parts, []);
});

const SRC = { today: '2026-11-28',
  orders: [{ id: 1, customer: 'أ', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', ageDays: 9, total: 100, delivery: 'late', vendors: ['Art Craft'] },
    { id: 2, customer: 'ب', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', ageDays: 7, total: 200, delivery: 'risk', vendors: ['Glody'] },
    { id: 3, customer: 'ج', status: 'جاري التنفيذ', confirm: 'غير مؤكد', ageDays: 3, total: 50, delivery: 'late', vendors: ['Glody', 'Art Craft'] }],
  products: [{ name: 'Cushion', sku: 'A', cats: ['Home › Decor'], stock: 0, out: true }, { name: 'Vase', sku: 'B', cats: ['Garden'], stock: 1, out: false }],
  hrRequests: [{ member: 'M02', type: 'إجازة سنوية', from: '2026-12-01', to: '2026-12-02', status: 'جديد' }, { member: 'M03', type: 'سلفة', status: 'جديد' }],
  memberName: (c) => ({ M02: 'سارة', M03: 'كريم' })[c] || '',
  expenses: [{ category: 'الاشتراكات', subName: 'Canva', subEnds: '2027-01-01', voided: false }] };

test('rowsOf: the states together (one row once), the picked makers keep their orders only; none picked = all', () => {
  const all = RA.rowsOf({ parts: [{ element: 'orders', type: 'delay', states: ['late', 'risk'], items: [] }] }, SRC);
  assert.equal(all.length, 1); assert.deepEqual(all[0].r.rows.map((r) => r[0]).sort(), ['#1', '#2', '#3']);
  const glody = RA.rowsOf({ parts: [{ element: 'orders', type: 'delay', states: ['late'], items: ['Glody'] }] }, SRC);
  assert.deepEqual(glody[0].r.rows.map((r) => r[0]), ['#3']);
  assert.match(glody[0].label, /الأوردرات الرئيسية › حالة التأخير › متأخر/);
});

test('rowsOf: several elements; the products by their categories (a sub-category counts), the team by its members', () => {
  const r = RA.rowsOf({ parts: [{ element: 'products', type: 'stock', states: ['out', 'left1'], items: ['Home'] }, { element: 'team', type: 'update', states: ['req_leave', 'req_advance'], items: ['كريم'] }] }, SRC);
  assert.deepEqual(r[0].r.rows.map((x) => x[0]), ['Cushion']);
  assert.deepEqual(r[1].r.rows, [['كريم', 'سلفة', '', '', 'جديد']]);
  assert.match(RA.summary({ parts: [{ element: 'products', type: 'stock', states: ['out'], items: ['Home'] }] }), /^تقرير: المنتجات › حالة المنتج › الكمية نفدت — Home$/);
});

test('narrow: an element with no list keeps the sources as they are', () => {
  assert.equal(RA.narrow(SRC, 'messages', ['x']), SRC);
  assert.deepEqual(RA.narrow(SRC, 'accounts', ['المرتبات']).expenses, []);
});

// the report popup (2026-11-28-smart-actions.md — Safwat 28 Nov: «يبقا فيها فللتر … و اختيار الفترة»): the period on each row's day, a search in
// any cell, the picks of the columns that repeat, and the money totals over what is kept
test('keep / filterCols / totals: the period, the search and the columns\' picks; only repeated text columns are filters', () => {
  const r = { headers: ['رقم الأوردر', 'العميل', 'الحالة', 'المبتكرين', 'تاريخ الأوردر', 'عمره (يوم)', 'الإجمالي'], sum: [6],
    rows: [['#1', 'أ', 'جاري التنفيذ', 'Glody', '2026-11-01', 27, 100], ['#2', 'ب', 'معلّق', 'Art Craft', '2026-11-20', 8, 200], ['#3', 'ج', 'جاري التنفيذ', 'Glody', '2026-11-25', 3, 50]],
    dates: ['2026-11-01', '2026-11-20', '2026-11-25'] };
  assert.deepEqual(RA.keep(r, {}), [0, 1, 2]);
  assert.deepEqual(RA.keep(r, { range: { from: '2026-11-15', to: '2026-11-30' } }), [1, 2]);
  assert.deepEqual(RA.keep(r, { q: 'glody' }), [0, 2]); // any cell, any case
  assert.deepEqual(RA.keep(r, { picks: { 2: ['معلّق'] } }), [1]);
  assert.deepEqual(RA.keep(r, { range: { from: '2026-11-15', to: '2026-11-30' }, picks: { 3: ['Glody'] } }), [2]);
  assert.deepEqual(RA.keep(Object.assign({}, r, { dates: undefined }), { range: { from: '2026-11-15', to: '2026-11-30' } }), [0, 1, 2]); // a «now» list has no period
  // the ids, the days, the numbers and the money are not filters; a column with one value is not either
  assert.deepEqual(RA.filterCols(r).map((c) => c.label), ['الحالة', 'المبتكرين']);
  assert.deepEqual(RA.filterCols(r).find((c) => c.label === 'المبتكرين').options, ['Art Craft', 'Glody']);
  assert.deepEqual(RA.totals(r, [0, 2]), [[6, 150]]);
});
test('rowsOf carries each row\'s day and the money columns through the states together', () => {
  const S2 = Object.assign({}, SRC, { orderOf: (id) => ({ 1: { date: '2026-11-19' }, 2: { date: '2026-11-21' }, 3: { date: '2026-11-25' } })[id] || null });
  const x = RA.rowsOf({ parts: [{ element: 'orders', type: 'delay', states: ['late', 'risk'], items: [] }] }, S2)[0].r;
  assert.deepEqual(x.rows.map((r) => r[0]), ['#1', '#3', '#2']); assert.deepEqual(x.dates, ['2026-11-19', '2026-11-25', '2026-11-21']); assert.deepEqual(x.sum, [12, 13]);
});
