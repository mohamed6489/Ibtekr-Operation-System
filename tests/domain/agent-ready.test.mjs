// «طلبات جاهزة» / «تقارير جاهزة» in an assistant's chat (app/js/pages/agent-ready.js — chat-flows phase 3, 0171): a report lists the
// member's own rows of each element › type › state by the same rule as «افتح التفاصيل»; a request carries its name and elements.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const D = loadUmd(new URL('../../app/js/pages/agent-details.js', import.meta.url));
const C = loadUmd(new URL('../../app/js/pages/notif-catalog.js', import.meta.url));
globalThis.IBAgentDetails = D; globalThis.IBNotifCatalog = C;
const R = loadUmd(new URL('../../app/js/pages/agent-ready.js', import.meta.url));
const src = {
  today: '2026-11-25',
  orders: [{ id: 1, customer: 'هدى', status: 'جاري التنفيذ', confirm: 'غير مؤكد', ageDays: 3, total: 900, delivery: 'ok' },
    { id: 2, customer: 'منى', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', ageDays: 12, total: 1500, delivery: 'late' },
    { id: 3, customer: 'سارة', status: 'مكتمل', confirm: 'غير مؤكد', ageDays: 20, total: 400, delivery: 'late' },
    { id: 4, customer: 'ليلى', status: 'معلّق', confirm: 'في انتظار الرد', ageDays: 5, total: 300, delivery: 'risk' }],
  convs: [{ seg: 'customers', status: 'مستنية ردنا', handle: 'أ', platform: 'whatsapp', waiting: 10 }, { seg: 'customers', status: 'مستنية ردنا', handle: 'ب', platform: 'messenger', waiting: 90 }],
  lateVendors: [{ vendor: 'Glody', count: 2 }],
};
const ids = (r) => r.rows.map((x) => x[0]);
const P = (element, type, state) => ({ element, type, state });

test('orders: the delay states, a confirmation and a status from the system\'s own lists', () => {
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'delay', 'late'), src)), ['#2']);
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'delay', 'risk'), src)), ['#4']);
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'delay', 'ok'), src)), ['#1']); // open, not late nor at risk
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'confirm', 'غير مؤكد'), src)), ['#4', '#1']); // open and not «مؤكد…», as the server counts
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'confirm', 'مؤكد بعربون'), src)), ['#2']);
  assert.deepEqual(ids(R.rowsOfPart(P('orders', 'status', 'مكتمل'), src)), ['#3']); // a status: closed ones too
});
test('messages and makers reuse the details popup\'s lists; «متأخرة» = waiting an hour or more', () => {
  assert.deepEqual(ids(R.rowsOfPart(P('messages', 'customers', 'waiting'), src)), ['ب', 'أ']);
  assert.deepEqual(ids(R.rowsOfPart(P('messages', 'customers', 'late'), src)), ['ب']);
  assert.deepEqual(R.rowsOfPart(P('makers', 'making', 'late'), src).rows, [['Glody', 2]]);
});
test('only a state with a list can be a report; an event cannot', () => {
  assert.equal(R.reportable('orders', 'delay', 'late'), true); assert.equal(R.reportable('orders', 'status', 'أي حالة'), true);
  assert.equal(R.reportable('orders', 'update', 'new'), false); assert.equal(R.rowsOfPart(P('orders', 'update', 'new'), src), null);
  // every reader names an element and a type of the catalog (a key that drifts from the catalog is caught here)
  for (const k of Object.keys(R._test.READERS)) { const [e, t, s] = k.split('.'); assert.ok(C.typeOf(e, t), k); if (s !== '*') assert.ok(C.stateOf(e, t, s, {}), k); }
});
test('a ready request carries its name and its elements by the catalog\'s names', () => {
  const pre = R.requestPre({ name: 'متابعة أوردر متأخر', parts: [P('orders', 'delay', 'late'), P('messages', 'customers', 'waiting')] }, {});
  assert.equal(pre.title, 'متابعة أوردر متأخر');
  assert.equal(pre.details, 'العناصر:\n• الأوردرات الرئيسية › حالة التأخير › متأخر\n• الرسايل › رسايل العملاء › في انتظار الرد');
});
