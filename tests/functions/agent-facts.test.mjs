// The numbers the assistants' rules watch (the owner 22 Nov — 0150): counted from the system's rows by one pure rule, the same for the
// scheduled check (notify) and the tests' stand-in. A part that was not read leaves its numbers unread (null), never zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_CLOSED, countFacts, singleOf } from '../../supabase/functions/_shared/agent-facts.js';
import { METRICS, permOf } from '../../supabase/functions/_shared/agent-rules.js';

const TODAY = '2026-11-22'; const NOW = Date.parse('2026-11-22T10:00:00Z');
const base = () => ({
  delay: {},
  orders: [
    { id: 1, status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', confirm_at: '2026-11-01', placed_at: '2026-10-30T10:00:00Z' }, // 21 days against 7: late
    { id: 2, status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', confirm_at: '2026-11-16', placed_at: '2026-11-15T10:00:00Z' }, // 6 of 7: at risk
    { id: 3, status: 'قيد الانتظار', confirm: 'غير مؤكد', confirm_at: null, placed_at: '2026-11-20T10:00:00Z' }, // open, not confirmed: no delay
    { id: 4, status: 'مكتمل', confirm: 'مؤكد بعربون', confirm_at: '2026-10-01', placed_at: '2026-10-01T10:00:00Z' }, // over
    { id: 5, status: 'قيد الشحن', confirm: 'مؤكد بعربون', confirm_at: '2026-10-01', placed_at: '2026-10-01T10:00:00Z' }, // on its way: no delay
  ],
  items: [
    { order_id: 1, vendor_id: 'v1', product_id: 10, status: 'قيد التنفيذ', removed: false, expected_at: null },
    { order_id: 1, vendor_id: 'v2', product_id: 11, status: 'ملغي', removed: false, expected_at: null }, // a cancelled product counts for nothing
    { order_id: 2, vendor_id: 'v1', product_id: 12, status: 'قيد التنفيذ', removed: false, expected_at: null },
    { order_id: 5, vendor_id: 'v3', product_id: 13, status: 'قيد التنفيذ', removed: false, expected_at: null },
  ],
  vendors: [{ id: 'v1', status: 'active', lead_days: 7 }, { id: 'v2', status: 'active', lead_days: 7 }, { id: 'v3', status: 'active', lead_days: 7 }],
  productLead: {}, bankless: 2,
  lots: [{ reason: 'مرتجع', status: 'بانتظار الفحص', closed_at: null }, { reason: 'مرتجع', status: 'متاح', closed_at: null }, { reason: 'مرتجع', status: 'بانتظار الفحص', closed_at: '2026-11-01' }],
  tickets: [{ status: 'open', priority: 'urgent', follow_up: '2026-11-20', assignee_role: 'التصميم' }, { status: 'waiting', priority: 'normal', follow_up: '2026-11-25', assignee_role: 'التصميم' },
    { status: 'closed', priority: 'urgent', follow_up: '2026-11-01', assignee_role: 'التصميم' }],
  designRole: 'التصميم',
  convs: [{ seg: 'customers', status: 'مستنية ردنا', waiting_since: '2026-11-22T08:30:00Z' }, { seg: 'customers', status: 'مستنية ردنا', waiting_since: '2026-11-22T09:45:00Z' },
    { seg: 'comments', status: 'مستنية ردنا', waiting_since: '2026-11-20T08:00:00Z' }],
  withdrawals: [{ status: 'pending' }, { status: 'approved' }],
  subs: [{ sub_ends: '2026-11-25', voided_at: null }, { sub_ends: '2026-12-30', voided_at: null }, { sub_ends: '2026-11-23', voided_at: '2026-11-01' }, { sub_ends: '2026-11-01', voided_at: null }],
  hrRequests: [{ status: 'جديد' }, { status: 'قيد المراجعة' }, { status: 'موافق' }], overtime: [{ status: 'مستني' }, { status: 'اتضاف' }],
  suggestions: [{ status: 'pending' }, { status: 'approved' }],
  adStats: [{ level: 'campaign', day: '2026-11-22', spend: 1000.4 }, { level: 'campaign', day: '2026-11-16', spend: 500 }, { level: 'campaign', day: '2026-11-15', spend: 9000 }, { level: 'ad', day: '2026-11-22', spend: 700 }],
  posts: [{ status: 'فشل', deleted_at: null }, { status: 'فشل', deleted_at: '2026-11-20' }, { status: 'اتنشر', deleted_at: null }],
  checks: [{ kind: 'pagespeed', data: { score: 41 } }, { kind: 'wp_updates', data: { updates: 3 } }],
});

test('every metric of the rules is counted from the rows — one key each, none missing', () => {
  const f = countFacts(base(), TODAY, NOW);
  assert.deepEqual(Object.keys(f).sort(), Object.keys(METRICS).sort());
  assert.deepEqual(f, { orders_unconfirmed: 1, orders_late: 1, orders_risk: 1, makers_late: 1, makers_no_bank: 2, returns_waiting: 1, tickets_urgent: 1, tickets_overdue: 1,
    design_requests: 2, cs_waiting: 2, cs_waiting_minutes: 90, withdraw_pending: 1, sub_days_left: 3, hr_requests_pending: 2, overtime_pending: 1, ads_suggestions: 1,
    ads_spend_week: 1500, posts_failed: 1, site_speed: 41, site_updates: 3 });
});

test('a product\'s own making days rule over the maker\'s; the settings\' delay rules are used', () => {
  const d = base(); d.productLead = { 10: 30 }; // order 1's only open product needs 30 days: 21 days in is neither late nor at risk
  let f = countFacts(d, TODAY, NOW); assert.deepEqual([f.orders_late, f.orders_risk, f.makers_late], [0, 1, 0]);
  const e = base(); e.delay = { start: 'order', lead: 7, orderRisk: 2, subRisk: 2 }; // from the order's own date: 3 is two days old, not late
  f = countFacts(e, TODAY, NOW); assert.equal(f.orders_late, 1); assert.equal(f.orders_unconfirmed, 1);
});

test('a part that was not read leaves its numbers unread (null) — a rule on it keeps its note', () => {
  const f = countFacts({ orders: null, tickets: null, convs: null, lots: null, withdrawals: null, hrRequests: null, overtime: null, suggestions: null, adStats: null, posts: null, checks: null, bankless: null }, TODAY, NOW);
  for (const k of Object.keys(METRICS)) assert.equal(f[k], null, k);
  const g = countFacts({ ...base(), items: null }, TODAY, NOW); // the orders answered, their products did not: the count of the open ones stands, the delay is unread
  assert.deepEqual([g.orders_unconfirmed, g.orders_late, g.orders_risk, g.makers_late], [1, null, null, null]);
  assert.equal(countFacts({ ...base(), checks: [] }, TODAY, NOW).site_speed, null); // no check kept yet
  assert.equal(countFacts({ ...base(), subs: [] }, TODAY, NOW).sub_days_left, null); // no subscription ahead
  assert.equal(countFacts({ ...base(), designRole: '' }, TODAY, NOW).design_requests, 0);
  assert.equal(countFacts({ ...base(), convs: [] }, TODAY, NOW).cs_waiting_minutes, 0);
});

test('the closed order statuses; a seller without makers', () => {
  assert.deepEqual(ORDER_CLOSED, ['مكتمل', 'ملغي', 'استرجاع', 'فشل']);
  assert.equal(singleOf({}), false); assert.equal(singleOf(null), false); assert.equal(singleOf({ platform: 'woo' }), false);
  assert.equal(singleOf({ mode: 'single' }), true); assert.equal(singleOf({ dokan: false }), true); assert.equal(singleOf({ platform: 'shopify' }), true);
});

test('every metric names the page permission a member needs to be told its number (security review 22 Nov)', () => {
  for (const k of Object.keys(METRICS)) assert.match(permOf(k), /^[a-z_]+\.view$/, k);
  assert.equal(permOf('orders_late'), 'orders.view'); assert.equal(permOf('withdraw_pending'), 'accounts.view'); assert.equal(permOf('cs_waiting'), 'cs.view');
  assert.equal(permOf('site_speed'), 'marketing.view'); assert.equal(permOf('makers_no_bank'), 'vendors.view'); assert.equal(permOf('nope'), '');
});
