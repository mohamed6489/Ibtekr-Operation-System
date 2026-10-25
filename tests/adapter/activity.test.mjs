import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// activity.js against a stub IBSupabase: only auth.* / dashboard.* / profile.2fa.* actions and the six named actions of IBOrders
// reach rpc('log_activity') until a page is wired to real data; recent() reads activity_log with the actor's name embedded;
// refresh() caches it and announces ib:activity.
const src = readFileSync(new URL('../../app/js/adapter/activity.js', import.meta.url), 'utf8');
function load({ signedIn = true, rows = [] } = {}) {
  const calls = []; const events = [];
  const stub = stubClient({ responses: { activity_log: { data: rows, error: null } } });
  const client = { rpc: (fn, args) => { calls.push(JSON.parse(JSON.stringify({ fn, args }))); /* plain objects of this realm */ return Promise.resolve({ data: null, error: null }); }, from: stub.client.from };
  const window = { IBSupabase: { client }, IBAuth: { session: () => (signedIn ? { access_token: 't', user: { id: 'u2' } } : null) } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, Event });
  return { log: window.IBActivity.log, A: window.IBActivity, calls, queries: stub.calls, events };
}

test('auth.signin is sent to log_activity', async () => {
  const { log, calls } = load();
  await log('auth.signin', 'صفوت كمال');
  assert.deepEqual(calls, [{ fn: 'log_activity', args: { action: 'auth.signin', entity: null, entity_id: null, old_value: null, new_value: 'صفوت كمال' } }]);
});

test('a demo-page action (hr.payroll.approve) is not sent', async () => {
  const { log, calls } = load();
  await log('hr.payroll.approve', { month: 10 });
  await log('shift.start', 'x');
  assert.deepEqual(calls, []);
});

test('nothing is sent while signed out', async () => {
  const { log, calls } = load({ signedIn: false });
  await log('auth.signout', 'يدوي');
  assert.deepEqual(calls, []);
});

test('dashboard.customize is sent', async () => {
  const { log, calls, A } = load();
  await log('dashboard.customize', '7 كارت');
  assert.deepEqual(calls, [{ fn: 'log_activity', args: { action: 'dashboard.customize', entity: null, entity_id: null, old_value: null, new_value: '7 كارت' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(A.LOGGED_PREFIXES)), ['auth.', 'dashboard.', 'profile.2fa.']);
});

test('the orders writes IBOrders logs are sent by name; block 22\'s demo order.* / suborder.* events are not', async () => {
  const { log, calls, A } = load();
  const OWN = ['order.status', 'order.confirm', 'order.patch', 'suborder.status', 'suborder.waybill', 'suborder.pulled'];
  assert.deepEqual(JSON.parse(JSON.stringify(A.LOGGED_ACTIONS)), OWN);
  for (const a of OWN) await log(a, 'IB-181668 · #5001');
  // logged by block 22 / 29 before any server write (a free-text reason, sample stock): never reach activity_log
  for (const a of ['order.consolidate', 'order.cancel', 'order.refund', 'order.edit', 'suborder.returnToStock', 'suborder.returnToVendor', 'suborder.autoconfirm', 'suborder.arrived'])
    await log(a, 'سبب مكتوب بإيد العميل');
  await log('orders.export', 'x'); // a look-alike
  await log('order.status.extra', 'x'); // a name is matched whole, not as a prefix
  assert.deepEqual(calls.map((c) => c.args.action), OWN);
});

test('the 2FA enrolment events (profile.2fa.*) are sent; the other «ملفي» events (sample data) are not', async () => {
  const { log, calls } = load();
  await log('profile.2fa.enable', 'Authenticator');
  await log('profile.2fa.disable', 'Authenticator');
  await log('profile.edit', 'سارة أحمد');
  await log('profile.salary', 'x');
  assert.deepEqual(calls.map((c) => c.args.action), ['profile.2fa.enable', 'profile.2fa.disable']);
});

test('recent maps the embed and refresh (newest 25) dispatches ib:activity', async () => {
  const rows = [{ id: 9, at: '2026-10-25T09:00:00Z', action: 'auth.signin', new_value: 'محمد', actor: { name: 'محمد' } }, { id: 8, at: '2026-10-25T08:00:00Z', action: 'dashboard.customize', new_value: { cards: 7 }, actor: null }];
  const { A, queries, events } = load({ rows });
  assert.equal(A.cached(), null);
  await A.refresh();
  assert.deepEqual(opsOf(queries, 'activity_log'), [{ op: 'select', args: ['id, at, action, new_value, actor:profiles(name)'] }, { op: 'order', args: ['at', { ascending: false }] }, { op: 'limit', args: [25] }]);
  assert.equal(A.cached()[0].actor, 'محمد');
  assert.equal(A.cached()[1].actor, '—');
  assert.deepEqual(JSON.parse(JSON.stringify(A.cached())), [{ id: 9, at: '2026-10-25T09:00:00Z', actor: 'محمد', action: 'auth.signin', detail: 'محمد' }, { id: 8, at: '2026-10-25T08:00:00Z', actor: '—', action: 'dashboard.customize', detail: '{"cards":7}' }]);
  assert.ok(events.includes('ib:activity'));
  A.clear();
  assert.equal(A.cached(), null);
});

test('a forwarded log refreshes the cache; recent(limit) asks for that many', async () => {
  const { log, A, queries, events } = load({ rows: [{ id: 1, at: '2026-10-25T09:00:00Z', action: 'auth.signin', new_value: null, actor: { name: 'سارة أحمد' } }] });
  await log('auth.signin', 'سارة أحمد');
  assert.deepEqual(JSON.parse(JSON.stringify(A.cached())), [{ id: 1, at: '2026-10-25T09:00:00Z', actor: 'سارة أحمد', action: 'auth.signin', detail: '' }]);
  assert.ok(events.includes('ib:activity'));
  queries.length = 0;
  assert.equal((await A.recent(20)).length, 1);
  assert.ok(opsOf(queries, 'activity_log').some((q) => q.op === 'limit' && q.args[0] === 20));
});

test('signed out: recent is empty and refresh asks nothing', async () => {
  const { A, queries } = load({ signedIn: false });
  assert.deepEqual(JSON.parse(JSON.stringify(await A.recent())), []);
  await A.refresh();
  assert.equal(A.cached(), null);
  assert.deepEqual(queries, []);
});

test('auth.signout is sent, but no activity_log read follows (the page reloads next)', async () => {
  const { log, A, calls, queries, events } = load();
  await log('auth.signout', 'يدوي');
  assert.deepEqual(calls, [{ fn: 'log_activity', args: { action: 'auth.signout', entity: null, entity_id: null, old_value: null, new_value: 'يدوي' } }]);
  assert.deepEqual(queries, []);
  assert.equal(A.cached(), null);
  assert.equal(events.includes('ib:activity'), false);
});
