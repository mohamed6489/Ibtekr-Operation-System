import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient } from './stub-supabase.mjs';
// presence.js (phase 12 T5, 0061): one private presence channel «presence» keyed by the member's uid, { uid, at } tracked once
// subscribed, online() from the channel's state (the member always counts), ib:presence on change, nothing without a socket.
const src = readFileSync(new URL('../../app/js/adapter/presence.js', import.meta.url), 'utf8');
const ME = 'a0000000-0000-4000-8000-000000000001'; const OTHER = 'a0000000-0000-4000-8000-000000000002';
function load({ responses = {}, realtime, session = { user: { id: ME } } } = {}) {
  const stub = stubClient({ responses });
  const events = [];
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => session }, IB_CONFIG: realtime === false ? { realtime: false } : {} };
  const ctx = { window, document: { dispatchEvent(e) { events.push(e.detail ? e.detail.online.slice() : e.type); } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, Promise, Date, Set, Object, Array, String, JSON, RegExp };
  runInNewContext(src, ctx);
  return { P: window.IBPresence, stub, events };
}
const chan = (stub) => stub.calls.find((c) => c.op === 'channel');
const plain = (v) => JSON.parse(JSON.stringify(v)); // the adapter's arrays come from another realm

test('join: the private channel «presence» keyed by my uid, sync handler, subscribe; SUBSCRIBED → track { uid, at } and ready; the state gives online() (me always in); leave untracks and removes', async () => {
  const state = { [OTHER]: [{ uid: OTHER }], 'not-a-uid': [{}] };
  const { P, stub, events } = load({ responses: { 'presence:presence': () => state } });
  assert.deepEqual(plain(P.online()), []); assert.equal(P.ready(), false);
  P.join();
  assert.deepEqual(chan(stub).args, ['presence', { config: { private: true, presence: { key: ME } } }]);
  assert.deepEqual(stub.calls.find((c) => c.op === 'on').args, ['presence', { event: 'sync' }]);
  assert.deepEqual(plain(P.online()), [ME], 'before the channel answers: me alone');
  stub.emitStatus('SUBSCRIBED'); await Promise.resolve();
  assert.equal(P.ready(), true);
  const tr = stub.calls.find((c) => c.op === 'track'); assert.equal(tr.args[0].uid, ME); assert.match(tr.args[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(plain(P.online().sort()), [ME, OTHER].sort(), 'the state\'s keys that are uids, plus me'); assert.equal(P.isOnline(OTHER), true); assert.equal(P.isOnline('x'), false); assert.equal(P.count(), 2);
  assert.ok(events.some((e) => Array.isArray(e) && e.includes(OTHER)), 'ib:presence carried the list');
  P.join(); assert.equal(stub.calls.filter((c) => c.op === 'channel').length, 1, 'a second join reuses the channel');
  P.leave();
  assert.ok(stub.calls.some((c) => c.op === 'untrack') && stub.calls.some((c) => c.op === 'removeChannel'));
  assert.deepEqual(plain(P.online()), []); assert.equal(P.ready(), false);
});

test('a dropped channel (CHANNEL_ERROR) forgets the others and is rejoined on the next join; no socket (IB_CONFIG.realtime false) → me alone, no channel; no session → nothing', () => {
  const { P, stub } = load({ responses: { 'presence:presence': () => ({ [OTHER]: [{}] }) } });
  P.join(); stub.emitStatus('SUBSCRIBED'); assert.equal(P.isOnline(OTHER), true);
  stub.emitStatus('CHANNEL_ERROR'); assert.deepEqual(plain(P.online()), [ME]); assert.equal(P.ready(), false);
  P.join(); assert.equal(stub.calls.filter((c) => c.op === 'channel').length, 2, 'rejoined');
  const off = load({ realtime: false }); off.P.join();
  assert.deepEqual(plain(off.P.online()), [ME]); assert.equal(off.P.ready(), false); assert.equal(off.stub.calls.filter((c) => c.op === 'channel').length, 0);
  const none = load({ session: null }); none.P.join(); assert.deepEqual(plain(none.P.online()), []); assert.equal(none.stub.calls.length, 0);
});
