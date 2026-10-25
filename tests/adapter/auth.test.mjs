import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient } from './stub-supabase.mjs';
// auth.js against a stub IBSupabase: a SIGNED_OUT (supabase-js relays one from another tab to the listeners only) removes the
// stored session from both storages before the IBAuth.onChange listeners run, so the reload they start finds nothing to sign
// back in with — a duplicated tab (remember-me off) holds its own copy in sessionStorage.
const src = readFileSync(new URL('../../app/js/adapter/auth.js', import.meta.url), 'utf8');
function memoryStorage(state) {
  const m = new Map(); const guard = () => { if (state.blocked) throw new Error('SecurityError: storage blocked'); };
  return { getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { guard(); m.set(k, String(v)); }, removeItem: (k) => { guard(); m.delete(k); } };
}
function load() {
  const stub = stubClient(); const state = { blocked: false };
  const localStorage = memoryStorage(state); const sessionStorage = memoryStorage(state);
  const window = { IBSupabase: { client: stub.client, recoveryHint: false } };
  runInNewContext(src, { window, localStorage, sessionStorage, location: { origin: 'http://localhost:4173', pathname: '/', hash: '' }, setTimeout });
  const key = stub.client.auth.storageKey;
  localStorage.setItem(key, '{"access_token":"remembered"}'); sessionStorage.setItem(key, '{"access_token":"this-tab"}'); localStorage.setItem('ib.remember', '0');
  return { A: window.IBAuth, emitAuth: stub.emitAuth, key, localStorage, sessionStorage, state };
}

test('a SIGNED_OUT removes the stored session from both storages before the listeners run', async () => {
  const { A, emitAuth, key, localStorage, sessionStorage } = load();
  await A.ready();
  const seen = [];
  A.onChange((event) => { seen.push([event, localStorage.getItem(key), sessionStorage.getItem(key)]); });
  emitAuth('SIGNED_OUT', null);
  assert.deepEqual(seen, [['SIGNED_OUT', null, null]]);
  assert.equal(localStorage.getItem('ib.remember'), '0'); // only the session key goes
  assert.equal(A.session(), null);
});

test('any other auth event leaves the stored session alone', async () => {
  const { A, emitAuth, key, localStorage, sessionStorage } = load();
  await A.ready();
  const s = { access_token: 't2', user: { id: 'u1' } };
  emitAuth('TOKEN_REFRESHED', s);
  assert.equal(localStorage.getItem(key), '{"access_token":"remembered"}');
  assert.equal(sessionStorage.getItem(key), '{"access_token":"this-tab"}');
  assert.equal(A.session(), s);
});

test('blocked storage: the SIGNED_OUT still reaches every listener', async () => {
  const { A, emitAuth, state } = load();
  await A.ready();
  const seen = [];
  A.onChange((event) => { seen.push(event); });
  state.blocked = true;
  assert.doesNotThrow(() => emitAuth('SIGNED_OUT', null));
  assert.deepEqual(seen, ['SIGNED_OUT']);
  assert.equal(A.session(), null);
});
