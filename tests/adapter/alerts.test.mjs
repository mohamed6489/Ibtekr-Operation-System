import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// alerts.js against a stub IBSupabase: alerts (RLS-filtered) + this user's alert_reads → the bell's «النظام» section.
const src = readFileSync(new URL('../../app/js/adapter/alerts.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const A2 = { id: 2, at: '2026-10-25T09:00:00Z', kind: 'woo.sync.failed', title: 'فشل المزامنة', body: null, entity: 'settings-integrations', entity_id: null };
const A1 = { id: 1, at: '2026-10-25T08:00:00Z', kind: 'system.backup.off', title: 'النسخ الاحتياطي متوقف', body: 'آخر نسخة من 3 أيام', entity: 'settings-data', entity_id: null };
const loaded = () => ({ alerts: { data: [A2, A1], error: null }, alert_reads: { data: [{ alert_id: 1 }], error: null } });
function load({ responses = loaded(), client = true, channelThrows = false, config } = {}) {
  const stub = stubClient({ responses, channelThrows }); const events = [];
  const window = { IBSupabase: { client: client ? stub.client : null }, IBAuth: { session: () => ({ user: { id: 'u2' } }) }, IBKit: { ME: 'M02', store: { dashPrefs: {}, members: [] }, setMe() {} } };
  if (config) window.IB_CONFIG = config;
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, Event });
  return { A: window.IBAlerts, window, calls: stub.calls, responses: stub.responses, emit: stub.emit, events };
}
const has = (calls, c) => calls.some((x) => JSON.stringify(x) === JSON.stringify(c));

test('load merges reads', async () => {
  const { A, calls } = load();
  await A.load();
  assert.deepEqual(opsOf(calls, 'alerts'), [{ op: 'select', args: ['id, at, kind, title, body, entity, entity_id'] }, { op: 'order', args: ['at', { ascending: false }] }, { op: 'limit', args: [200] }]);
  assert.deepEqual(opsOf(calls, 'alert_reads'), [{ op: 'select', args: ['alert_id'] }, { op: 'eq', args: ['user_id', 'u2'] }]);
  assert.equal(A.list()[0].id, 2);
  assert.equal(A.list()[1].read, true);
  assert.equal(A.unread(), 1);
  assert.deepEqual(plain(A.list()[0]), { id: 2, at: '2026-10-25T09:00:00Z', kind: 'woo.sync.failed', title: 'فشل المزامنة', body: null, entity: 'settings-integrations', entityId: null, read: false });
});

test('markRead inserts and updates the cache first', async () => {
  const { A, calls, events } = load();
  await A.load(); events.length = 0; calls.length = 0;
  const pending = A.markRead(2);
  assert.equal(A.unread(), 0); // before the request resolves
  assert.deepEqual(plain(await pending), { ok: true });
  assert.ok(has(calls, { table: 'alert_reads', op: 'insert', args: [{ alert_id: 2, user_id: 'u2' }] }));
  assert.ok(events.includes('ib:notify'));
});

test('duplicate read (23505) is ok', async () => {
  const { A, responses } = load();
  await A.load();
  responses.alert_reads = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "alert_reads_pkey"' } };
  assert.deepEqual(plain(await A.markRead(2)), { ok: true });
});

test('any other write error → { ok:false }, no throw, the mark stays on this device', async () => {
  const { A, responses } = load();
  await A.load();
  responses.alert_reads = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
  assert.deepEqual(plain(await A.markRead(2)), { ok: false });
  assert.equal(A.unread(), 0);
});

test('markAllRead marks only the unread ids, ignoring duplicates (alert_reads has no UPDATE grant)', async () => {
  const { A, calls, events } = load();
  await A.load(); events.length = 0; calls.length = 0;
  const pending = A.markAllRead();
  assert.equal(A.unread(), 0);
  assert.deepEqual(plain(await pending), { ok: true });
  assert.deepEqual(opsOf(calls, 'alert_reads'), [{ op: 'upsert', args: [[{ alert_id: 2, user_id: 'u2' }], { onConflict: 'alert_id,user_id', ignoreDuplicates: true }] }]);
  assert.ok(events.includes('ib:notify'));
  calls.length = 0;
  assert.deepEqual(plain(await A.markAllRead()), { ok: true }); // nothing unread: no request
  assert.deepEqual(calls, []);
});

test('section: unread counted, read muted, error ranks first', async () => {
  const { A } = load();
  await A.load();
  const s = A.section(); const all = s.tabs[0][2];
  assert.equal(s.received, 1);
  assert.equal(all[1].muted, true);
  assert.equal(all[0].tone, 'error');
  assert.equal(all[0].icon, 'alert');
  assert.deepEqual(plain({ id: s.id, label: s.label, icon: s.icon, unit: s.unit, allLabel: s.allLabel, empty: s.empty }), { id: 'server', label: 'النظام', icon: 'bell', unit: 'تنبيه', allLabel: 'تعليم الكل كمقروء', empty: 'مفيش تنبيهات من السيستم.' });
  assert.deepEqual(plain(s.tabs.map((t) => [t[0], t[1], t[2].map((it) => it.key)])), [['all', 'الكل', ['sa:2', 'sa:1']], ['unread', 'غير مقروء', ['sa:2']], ['read', 'مقروء', ['sa:1']]]);
  assert.deepEqual(plain({ title: all[0].title, sub: all[0].sub, muted: all[0].muted }), { title: 'فشل المزامنة', sub: '', muted: false });
  assert.deepEqual(plain({ sub: all[1].sub, tone: all[1].tone, icon: all[1].icon }), { sub: 'آخر نسخة من 3 أيام', tone: 'warning', icon: 'bell' });
  assert.equal(typeof all[0].meta, 'string');
});

test('run marks read and navigates to the entity hash', async () => {
  const { A, window, calls } = load();
  await A.load();
  window.location = { hash: '' };
  A.section().tabs[0][2][0].run();
  assert.equal(window.location.hash, 'settings-integrations');
  assert.equal(A.unread(), 0);
  assert.ok(has(calls, { table: 'alert_reads', op: 'insert', args: [{ alert_id: 2, user_id: 'u2' }] }));
});

test('run does not navigate to an entity that is not an app hash', async () => {
  const { A, window } = load({ responses: { alerts: { data: [{ ...A2, entity: 'javascript:alert(1)' }, { ...A1, entity: 'https://evil.example/x' }], error: null }, alert_reads: { data: [], error: null } } });
  await A.load();
  window.location = { hash: 'dashboard' };
  A.section().tabs[0][2].forEach((it) => it.run());
  assert.equal(window.location.hash, 'dashboard');
  assert.equal(A.unread(), 0);
});

test('toneOf', async () => {
  const { A } = load();
  assert.equal(A.toneOf('woo.sync.failed'), 'error');
  assert.equal(A.toneOf('vendor.late'), 'error');
  assert.equal(A.toneOf('backup.ok'), 'info');
  assert.equal(A.toneOf('system.backup.off'), 'warning');
});

test('relTime', async () => {
  const { A } = load();
  const now = Date.parse('2026-10-25T12:00:00Z'); const ago = (ms) => new Date(now - ms).toISOString();
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  assert.equal(A.relTime(ago(30e3), now), 'دلوقتي');
  assert.equal(A.relTime(ago(5 * MIN), now), 'منذ 5 دقيقة');
  assert.equal(A.relTime(ago(3 * HOUR), now), 'منذ 3 ساعة');
  assert.equal(A.relTime(ago(30 * HOUR), now), 'أمس');
  assert.equal(A.relTime(ago(4 * DAY), now), 'منذ 4 أيام');
});

test('subscribe swallows a throwing channel and load still works', async () => {
  const { A, calls } = load({ channelThrows: true });
  assert.doesNotThrow(() => A.subscribe());
  assert.ok(calls.some((c) => c.op === 'channel'));
  await A.load();
  assert.equal(A.list().length, 2);
});

test('realtime:false → no channel call', async () => {
  const { A, calls } = load({ config: { realtime: false } });
  await A.load();
  A.subscribe();
  assert.equal(calls.some((c) => c.op === 'channel'), false);
});

test('a Realtime insert lands first in the cache and dispatches ib:notify; unsubscribe removes the channel', async () => {
  const { A, calls, emit, events } = load();
  await A.load(); A.subscribe(); events.length = 0;
  assert.ok(has(calls, { op: 'channel', args: ['alerts'] }));
  assert.ok(has(calls, { op: 'on', args: ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }] }));
  const row = { id: 3, at: '2026-10-25T10:00:00Z', kind: 'stock.cons.late', title: 'تجميع متأخر', body: null, role_id: 'ops', user_id: null, entity: 'inventory-consolidate', entity_id: null, read_at: null };
  emit(row); emit(row); // the same row twice (reconnect) is kept once
  assert.deepEqual(A.list().map((a) => a.id), [3, 2, 1]);
  assert.equal(A.unread(), 2);
  assert.ok(events.includes('ib:notify'));
  A.unsubscribe();
  assert.ok(calls.some((c) => c.op === 'removeChannel'));
});

test('section() is null before load', async () => {
  const { A } = load();
  assert.equal(A.section(), null);
  assert.deepEqual(plain(A.list()), []);
  assert.equal(A.unread(), 0);
});

test('clear forgets the alerts; a failed load leaves section() null', async () => {
  const { A, responses } = load();
  await A.load();
  A.clear();
  assert.equal(A.section(), null);
  responses.alerts = { data: null, error: { message: 'x' } };
  await A.load();
  assert.equal(A.section(), null);
});

test('no client: load, subscribe and markRead never throw', async () => {
  const { A, calls } = load({ client: false });
  await A.load();
  assert.doesNotThrow(() => A.subscribe());
  assert.equal(A.section(), null);
  assert.deepEqual(plain(await A.markRead(2)), { ok: false });
  assert.deepEqual(calls, []);
});
