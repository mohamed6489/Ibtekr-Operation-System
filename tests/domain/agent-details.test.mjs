// «افتح التفاصيل» under an assistant's number (app/js/pages/agent-details.js — chat-flows phase 2): the rows behind each metric by
// the same rule the server counts it (_shared/agent-facts.js), from the rows the member's pages hold — nothing of its own.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const D = loadUmd(new URL('../../app/js/pages/agent-details.js', import.meta.url));
const src = {
  today: '2026-11-25',
  orders: [{ id: 1, customer: 'هدى', status: 'جاري التنفيذ', confirm: 'غير مؤكد', ageDays: 3, total: 900, delivery: 'ok' },
    { id: 2, customer: 'منى', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', ageDays: 12, total: 1500, delivery: 'late' },
    { id: 3, customer: 'سارة', status: 'مكتمل', confirm: 'غير مؤكد', ageDays: 20, total: 400, delivery: 'late' },
    { id: 4, customer: 'ليلى', status: 'معلّق', confirm: 'في انتظار الرد', ageDays: 5, total: 300, delivery: 'risk' }],
  tickets: [{ id: 'TKT-0001', title: 'عاجل', priority: 'urgent', status: 'open', followUp: '2026-11-20', assigneeRole: 'الإدارة' }, { id: 'TKT-0002', title: 'خلص', priority: 'urgent', status: 'closed' }],
  convs: [{ seg: 'customers', status: 'مستنية ردنا', handle: 'أ', platform: 'whatsapp', waiting: 10 }, { seg: 'customers', status: 'مستنية ردنا', handle: 'ب', platform: 'messenger', waiting: 90 }, { seg: 'comments', status: 'مستنية ردنا', handle: 'ج', waiting: 5 }],
  withdrawals: [{ id: 7, vendorId: 'v1', amount: 1200, status: 'pending', at: '2026-11-24T10:00:00Z' }, { id: 6, vendorId: 'v1', amount: 50, status: 'approved' }], vendorName: (id) => (id === 'v1' ? 'Glody' : ''),
  expenses: [{ subName: 'Canva', subEnds: '2026-11-30' }, { subName: 'قديم', subEnds: '2026-10-01' }, { subName: 'ملغي', subEnds: '2026-12-01', voided: true }],
  hrRequests: [{ member: 'M02', type: 'إجازة', from: '2026-11-26', to: '2026-11-27', status: 'جديد' }, { member: 'M02', type: 'سلفة', status: 'اتوافق' }], memberName: (c) => (c === 'M02' ? 'أحمد' : ''),
  overtime: [{ member: 'M02', date: '2026-11-24', minutes: 75, status: 'مستني' }],
  returns: [{ name: 'كرسي', vendor: 'Glody', sku: 'IBT1', sub: '#55', at: '24/11', status: 'بانتظار الفحص' }, { name: 'ترابيزة', status: 'اتفحص — سليم' }],
  lateVendors: [{ vendor: 'Glody', count: 2 }],
};
const ids = (r) => r.rows.map((x) => x[0]);

test('orders: unconfirmed = open and not «مؤكد…» (the server\'s isConfirmed); late / at risk by the order\'s delay; the oldest first', () => {
  assert.deepEqual(ids(D.rowsOf('orders_unconfirmed', src)), ['#4', '#1']);
  assert.deepEqual(ids(D.rowsOf('orders_late', src)), ['#2']); assert.deepEqual(ids(D.rowsOf('orders_risk', src)), ['#4']);
  assert.deepEqual(D.rowsOf('orders_late', src).headers, ['رقم الأوردر', 'العميل', 'الحالة', 'التأكيد', 'عمره (يوم)', 'الإجمالي']);
});
test('requests, conversations, withdrawals, subscriptions, HR and returns — each by its metric\'s rule', () => {
  assert.deepEqual(ids(D.rowsOf('tickets_urgent', src)), ['TKT-0001']); assert.deepEqual(ids(D.rowsOf('tickets_overdue', src)), ['TKT-0001']);
  assert.deepEqual(D.rowsOf('cs_waiting', src).rows, [['ب', 'messenger', 90, ''], ['أ', 'whatsapp', 10, '']]); // customers only, the longest wait first
  assert.deepEqual(D.rowsOf('cs_waiting_minutes', src).rows.length, 2);
  assert.deepEqual(D.rowsOf('withdraw_pending', src).rows, [['#7', 'Glody', 1200, '2026-11-24']]);
  assert.deepEqual(D.rowsOf('sub_days_left', src).rows, [['Canva', '2026-11-30', 5]]);
  assert.deepEqual(D.rowsOf('hr_requests_pending', src).rows, [['أحمد', 'إجازة', '2026-11-26', '2026-11-27', 'جديد']]);
  assert.deepEqual(D.rowsOf('overtime_pending', src).rows, [['أحمد', '2026-11-24', 75]]);
  assert.deepEqual(D.rowsOf('returns_waiting', src).rows, [['كرسي', 'Glody', 'IBT1', '#55', '24/11']]);
  assert.deepEqual(D.rowsOf('makers_late', src).rows, [['Glody', 2]]);
});
test('nothing read = no rows (never an error); a metric with no list = the page\'s link only', () => {
  assert.deepEqual(D.rowsOf('orders_late', {}).rows, []); assert.equal(D.rowsOf('site_speed', src), null);
  assert.equal(D.has('site_speed'), false); assert.equal(D.has('makers_no_bank'), false); // the bank accounts are never listed here
  assert.deepEqual(D.go('makers_no_bank'), { hash: 'makers', label: 'المبتكرين' }); assert.equal(D.go('site_speed'), null);
});
test('every metric the server counts is known here (a list or a page) — a new metric gets its place', async () => {
  const { METRICS } = await import('../../supabase/functions/_shared/agent-rules.js');
  const missing = Object.keys(METRICS).filter((k) => !D.has(k) && !D.go(k) && !['site_speed', 'site_updates'].includes(k));
  assert.deepEqual(missing, []);
  for (const k of Object.keys(D._test.READ)) assert.ok(METRICS[k], k + ' is a metric of agent-rules.js');
});
