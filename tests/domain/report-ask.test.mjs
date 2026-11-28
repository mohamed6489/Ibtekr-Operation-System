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
  assert.deepEqual(r[1].r.rows, [['كريم', 'سلفة', '', '']]);
  assert.match(RA.summary({ parts: [{ element: 'products', type: 'stock', states: ['out'], items: ['Home'] }] }), /^تقرير: المنتجات › حالة المنتج › الكمية نفدت — Home$/);
});

test('narrow: an element with no list keeps the sources as they are', () => {
  assert.equal(RA.narrow(SRC, 'messages', ['x']), SRC);
  assert.deepEqual(RA.narrow(SRC, 'accounts', ['المرتبات']).expenses, []);
});
