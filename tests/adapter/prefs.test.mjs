import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// prefs.js against a stub IBSupabase: user_prefs read once at sign-in, written through (cache and K.store.dashPrefs first).
const src = readFileSync(new URL('../../app/js/adapter/prefs.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
function load({ responses = {}, client = true, store = { dashPrefs: {}, members: [] } } = {}) {
  const stub = stubClient({ responses }); const events = [];
  const window = { IBSupabase: { client: client ? stub.client : null }, IBAuth: { session: () => ({ user: { id: 'u2' } }) }, IBKit: { ME: 'M02', store, setMe() {} } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, Event });
  return { P: window.IBPrefs, K: window.IBKit, calls: stub.calls, responses: stub.responses, events };
}

test('load fills the cache and K.store.dashPrefs[ME]', async () => {
  const { P, K, calls } = load({ responses: { user_prefs: { data: [{ key: 'dashboard', data: { hidden: ['team'] } }], error: null } } });
  await P.load();
  assert.deepEqual(opsOf(calls, 'user_prefs'), [{ op: 'select', args: ['key, data'] }, { op: 'eq', args: ['user_id', 'u2'] }]);
  assert.deepEqual(plain(P.get('dashboard')), { hidden: ['team'] });
  assert.deepEqual(plain(K.store.dashPrefs.M02.hidden), ['team']);
  assert.equal(P.get('other'), null);
});

test('load creates K.store.dashPrefs when block 25 has not touched it yet', async () => {
  const { P, K } = load({ store: { members: [] } });
  await P.load();
  assert.deepEqual(plain(K.store.dashPrefs), { M02: {} });
});

test('set writes through before the request resolves', async () => {
  const { P, K, calls } = load();
  const pending = P.set('dashboard', { order: ['kpis'] });
  assert.deepEqual(plain(P.get('dashboard')), { order: ['kpis'] });
  assert.deepEqual(plain(K.store.dashPrefs.M02), { order: ['kpis'] });
  assert.deepEqual(opsOf(calls, 'user_prefs'), [{ op: 'upsert', args: [{ user_id: 'u2', key: 'dashboard', data: { order: ['kpis'] } }, { onConflict: 'user_id,key' }] }]);
  assert.deepEqual(plain(await pending), { ok: true });
});

test('remove deletes by user and key', async () => {
  const { P, K, calls } = load({ responses: { user_prefs: { data: [{ key: 'dashboard', data: { hidden: ['team'] } }], error: null } } });
  await P.load(); calls.length = 0;
  const pending = P.remove('dashboard');
  assert.equal(P.get('dashboard'), null);
  assert.deepEqual(plain(K.store.dashPrefs.M02), {});
  assert.deepEqual(opsOf(calls, 'user_prefs'), [{ op: 'delete', args: [] }, { op: 'match', args: [{ user_id: 'u2', key: 'dashboard' }] }]);
  assert.deepEqual(plain(await pending), { ok: true });
});

test('network error → { ok:false } and no throw', async () => {
  const { P, responses } = load();
  responses.user_prefs = { data: null, error: { message: 'x' } };
  await P.load(); // keeps the defaults, does not reject
  assert.deepEqual(plain(await P.set('dashboard', { hidden: ['money'] })), { ok: false });
  assert.deepEqual(plain(P.get('dashboard')), { hidden: ['money'] }); // still saved on this device
  assert.deepEqual(plain(await P.remove('dashboard')), { ok: false });
});

test('clear empties the cache', async () => {
  const { P, K } = load({ responses: { user_prefs: { data: [{ key: 'dashboard', data: { hidden: ['team'] } }], error: null } } });
  await P.load();
  P.clear();
  assert.equal(P.get('dashboard'), null);
  assert.equal(K.store.dashPrefs.M02, undefined);
});

test('no client: load is a no-op, writes stay on this device and answer { ok:false }', async () => {
  const { P, calls } = load({ client: false });
  await P.load();
  assert.deepEqual(plain(await P.set('dashboard', { order: ['kpis'] })), { ok: false });
  assert.deepEqual(plain(P.get('dashboard')), { order: ['kpis'] });
  assert.deepEqual(calls, []);
});
