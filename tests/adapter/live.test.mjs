import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient } from './stub-supabase.mjs';
// live.js (0104 — docs/superpowers/plans/2026-11-15-live-sync.md decision 2): one private «sync» channel; a signal names a group
// and its adapter reads again, quietly; signals are gathered; a read waits while a popup is open, a field is typed in, the tab is
// hidden or (the settings) unsaved changes are on the screen; after a cut everything is read once.
const src = readFileSync(new URL('../../app/js/adapter/live.js', import.meta.url), 'utf8');
const ME = 'a0000000-0000-4000-8000-000000000001';
// a clock the test moves: setTimeout runs when tick() passes its time
function clock() {
  let now = 1000000; let seq = 0; const jobs = new Map();
  const setT = (fn, ms) => { seq += 1; jobs.set(seq, { at: now + (ms || 0), fn }); return seq; };
  const clearT = (id) => { jobs.delete(id); };
  async function tick(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = Math.max(now, due[1].at); jobs.delete(due[0]); due[1].fn();
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    }
    now = end; for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  return { setT, clearT, tick, D, jobs };
}
function load({ realtime, session = { user: { id: ME } }, adapters = {} } = {}) {
  const stub = stubClient({}); const k = clock(); const calls = []; const events = [];
  const listeners = {}; const winListeners = {};
  const screen = { open: [], unsaved: [], hosts: [], active: null, visibility: 'visible' };
  const document = {
    get visibilityState() { return screen.visibility; }, body: { tagName: 'BODY' },
    get activeElement() { return screen.active || this.body; },
    querySelectorAll: (sel) => (/\.scrim/.test(sel) ? screen.open : /save-bar/.test(sel) ? screen.unsaved : /#orders/.test(sel) ? screen.hosts : []),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent(e) { events.push([e.type, e.detail]); },
  };
  const adapter = (name, extra) => Object.assign({ state: () => 'ready', load: (o) => { calls.push([name, 'load', o || null]); return Promise.resolve(); } }, extra);
  const window = Object.assign({ IBSupabase: { client: stub.client }, IBAuth: { session: () => session }, IB_CONFIG: realtime === false ? { realtime: false } : {},
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    IBOrders: adapter('orders', { refetch: (id) => { calls.push(['orders', 'refetch', id]); return Promise.resolve(); } }),
    IBAccounts: adapter('accounts', { refreshSales: () => { calls.push(['accounts', 'refreshSales']); } }),
    IBVendors: adapter('vendors'), IBInventory: adapter('inventory'), IBProducts: adapter('products'), IBStudio: adapter('studio'),
    IBSettings: { data: { loaded: true }, loadPublic: () => { calls.push(['settings', 'loadPublic']); return Promise.resolve(); }, load: () => { calls.push(['settings', 'load']); return Promise.resolve(); } },
    IBQuick: { refresh: () => { calls.push(['quick', 'refresh']); } },
    IBDirectory: { me: () => ({ id: ME }), refresh: () => { calls.push(['team', 'refresh']); return Promise.resolve(); } },
    IBAlerts: { load: () => { calls.push(['alerts', 'load']); return Promise.resolve(); } } }, adapters);
  runInNewContext(src, { window, document, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    Promise, Date: k.D, Map, Set, Array, Object, Number, String, Math, setTimeout: k.setT, clearTimeout: k.clearT, setInterval: (fn, ms) => k.setT(function again() { fn(); k.setT(again, ms); }, ms), clearInterval: k.clearT });
  const fire = (t, e) => (listeners[t] || []).forEach((fn) => fn(e || {}));
  return { L: window.IBLive, stub, calls, events, screen, tick: k.tick, fire, winFire: (t) => (winListeners[t] || []).forEach((fn) => fn({})), window };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const names = (calls) => plain(calls.map((c) => c.slice(0, 2).join('.')));

test('subscribe: the private channel «sync», the «changed» broadcast; once; no socket or no session → nothing; clear removes it', () => {
  const { L, stub } = load();
  L.subscribe(); L.subscribe();
  const ch = stub.calls.filter((c) => c.op === 'channel');
  assert.equal(ch.length, 1); assert.deepEqual(ch[0].args, ['sync', { config: { private: true } }]);
  assert.deepEqual(stub.calls.find((c) => c.op === 'on').args, ['broadcast', { event: 'changed' }]);
  L.clear(); assert.ok(stub.calls.some((c) => c.op === 'removeChannel'));
  const off = load({ realtime: false }); off.L.subscribe(); assert.equal(off.stub.calls.filter((c) => c.op === 'channel').length, 0);
  const none = load({ session: null }); none.L.subscribe(); assert.equal(none.stub.calls.filter((c) => c.op === 'channel').length, 0);
});

test('a signal: the group\'s adapter reads again quietly 0.6 s after the last one — once for a burst; ib:live says which group', async () => {
  const { L, stub, calls, events, tick } = load();
  L.subscribe();
  await stub.emitBroadcast('changed', { t: 'accounts', at: 'x' });
  await tick(300); assert.deepEqual(names(calls), [], 'not yet');
  await stub.emitBroadcast('changed', { t: 'accounts', at: 'y' }); await stub.emitBroadcast('changed', { t: 'vendors', at: 'y' });
  await tick(500); assert.deepEqual(names(calls), [], '0.6 s after the LAST signal');
  await tick(200);
  assert.deepEqual(names(calls).sort(), ['accounts.load', 'vendors.load']);
  assert.deepEqual(plain(calls[0][2]), { quiet: true }, 'a quiet read: no «loading» state');
  assert.deepEqual(plain(events.filter((e) => e[0] === 'ib:live').map((e) => e[1].group)).sort(), ['accounts', 'vendors']);
  await tick(5000); assert.equal(calls.length, 2, 'nothing more without a signal');
});

test('signals that keep coming: a read at least every 4 s', async () => {
  const { L, calls, tick } = load();
  for (let i = 0; i < 12; i += 1) { L.signal({ payload: { t: 'inventory' } }); await tick(400); } // 4.8 s of a signal every 0.4 s
  assert.ok(calls.length >= 1, 'read once while they still come');
  await tick(1000); assert.ok(calls.length >= 2 && calls.length <= 3);
});

test('orders: a few ids → each order alone (and the period\'s sales behind); many ids or none → the list, quietly; an unknown group is ignored', async () => {
  const { L, calls, tick } = load();
  L.signal({ payload: { t: 'orders', ids: [7, 9] } }); L.signal({ payload: { t: 'orders', ids: [9, 11] } });
  await tick(700);
  assert.deepEqual(plain(calls.filter((c) => c[1] === 'refetch').map((c) => c[2])), ['7', '9', '11'], 'the ids of the burst, once each');
  assert.ok(calls.some((c) => c[0] === 'accounts' && c[1] === 'refreshSales'));
  calls.length = 0;
  L.signal({ payload: { t: 'orders', ids: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }); await tick(700);
  assert.deepEqual(names(calls.filter((c) => c[0] === 'orders')), ['orders.load']);
  calls.length = 0;
  L.signal({ payload: { t: 'orders', ids: [5] } }); L.signal({ payload: { t: 'orders' } }); L.signal({ payload: { t: 'orders', ids: [6] } }); await tick(700);
  assert.deepEqual(names(calls.filter((c) => c[0] === 'orders')), ['orders.load'], '«all of them» wins over a list');
  calls.length = 0;
  L.signal({ payload: { t: 'nothing_like_it' } }); L.signal({ payload: {} }); L.signal(null); await tick(700);
  assert.deepEqual(names(calls), []);
});

test('each group reads its own: settings (public + the loaded page + quick actions), team, alerts, products, studio; an adapter that is not loaded is left alone', async () => {
  const { L, calls, tick } = load({ adapters: { IBProducts: { state: () => 'idle', load: () => { throw new Error('not asked for'); } } } });
  ['settings', 'team', 'alerts', 'products', 'studio'].forEach((t) => L.signal({ payload: { t } }));
  await tick(700);
  assert.deepEqual(names(calls).sort(), ['alerts.load', 'quick.refresh', 'settings.load', 'settings.loadPublic', 'studio.load', 'team.refresh']);
});

test('the read waits while a popup / a menu is open and goes when it closes; a failing reader does not stop the others', async () => {
  const { L, calls, screen, tick } = load({ adapters: { IBVendors: { state: () => 'ready', load: () => Promise.reject(new Error('down')) } } });
  screen.open = [{ hidden: false, getClientRects: () => [1] }];
  L.signal({ payload: { t: 'accounts' } }); L.signal({ payload: { t: 'vendors' } });
  await tick(5000); assert.deepEqual(names(calls), [], 'held: what is on the screen stays what is in memory');
  assert.equal(L.held(), true);
  screen.open = [{ hidden: true, getClientRects: () => [] }]; // closed (still in the page, not shown)
  await tick(800);
  assert.deepEqual(names(calls), ['accounts.load']);
});

test('typing: a field in use holds the read until it is left; a search box only while its keys are pressed; a checkbox never', async () => {
  const { L, calls, screen, tick, fire } = load();
  screen.active = { tagName: 'INPUT', type: 'text', placeholder: 'المبلغ' };
  L.subscribe(); L.signal({ payload: { t: 'accounts' } });
  await tick(3000); assert.equal(calls.length, 0, 'the member is in a field');
  screen.active = null; fire('focusout'); await tick(200);
  assert.equal(calls.length, 1, 'left the field: read at once');
  screen.active = { tagName: 'INPUT', type: 'search', placeholder: 'ابحث' }; fire('keydown');
  L.signal({ payload: { t: 'accounts' } });
  await tick(1000); assert.equal(calls.length, 1, 'keys are being pressed in the search box');
  await tick(1500); assert.equal(calls.length, 2, 'the cursor resting in a search box does not hold');
  screen.active = { tagName: 'INPUT', type: 'checkbox' }; L.signal({ payload: { t: 'accounts' } }); await tick(700);
  assert.equal(calls.length, 3);
  screen.active = { tagName: 'TEXTAREA' }; assert.equal(L.held(), true);
});

test('unsaved changes on the screen hold the settings alone; holdWhile adds a page\'s own rule', async () => {
  const { L, calls, screen, tick } = load();
  screen.unsaved = [{ hidden: false, getClientRects: () => [1] }];
  L.signal({ payload: { t: 'settings' } }); L.signal({ payload: { t: 'accounts' } });
  await tick(3000);
  assert.deepEqual(names(calls), ['accounts.load'], 'the accounts are read; the settings wait for the save / the discard');
  screen.unsaved = []; await tick(800);
  assert.ok(calls.some((c) => c[0] === 'settings' && c[1] === 'loadPublic'));
  calls.length = 0; let busy = true; L.holdWhile('vendors', () => busy);
  L.signal({ payload: { t: 'vendors' } }); await tick(2000); assert.equal(calls.length, 0);
  busy = false; await tick(800); assert.deepEqual(names(calls), ['vendors.load']);
});

test('a hidden tab reads when it is looked at again; away for more than two minutes → everything once', async () => {
  const { L, calls, screen, tick, fire } = load();
  L.subscribe();
  screen.visibility = 'hidden'; fire('visibilitychange');
  L.signal({ payload: { t: 'accounts' } }); await tick(30000);
  assert.equal(calls.length, 0, 'nobody is looking');
  screen.visibility = 'visible'; fire('visibilitychange'); await tick(50);
  assert.deepEqual(names(calls), ['accounts.load']);
  calls.length = 0;
  screen.visibility = 'hidden'; fire('visibilitychange'); await tick(121000);
  screen.visibility = 'visible'; fire('visibilitychange'); await tick(700);
  const got = names(calls);
  ['orders.load', 'accounts.load', 'vendors.load', 'inventory.load', 'products.load', 'studio.load', 'settings.loadPublic', 'team.refresh', 'alerts.load'].forEach((x) => assert.ok(got.includes(x), x));
});

test('the line drops: the channel is let go, the watch opens a new one, and once it is back everything is read once', async () => {
  const { L, stub, calls, tick } = load();
  L.subscribe(); stub.emitStatus('SUBSCRIBED'); await tick(700);
  assert.equal(calls.length, 0, 'a first connection reads nothing again');
  assert.equal(L.connected(), true);
  stub.emitStatus('CHANNEL_ERROR');
  assert.ok(stub.calls.some((c) => c.op === 'removeChannel')); assert.equal(L.connected(), false);
  await tick(20000);
  assert.equal(stub.calls.filter((c) => c.op === 'channel').length, 2, 'the watch connected again');
  stub.emitStatus('SUBSCRIBED'); await tick(700);
  assert.ok(names(calls).includes('orders.load') && names(calls).includes('accounts.load') && names(calls).includes('alerts.load'));
});

test('on(): a page\'s own reader runs after the adapter\'s; its off() removes it; refresh() reads every group', async () => {
  const { L, calls, tick } = load();
  const off = L.on('accounts', (ids) => { calls.push(['page', 'accounts', ids]); });
  L.on('reports', () => { calls.push(['page', 'reports']); });
  L.signal({ payload: { t: 'accounts' } }); L.signal({ payload: { t: 'reports' } }); await tick(700);
  assert.deepEqual(names(calls).sort(), ['accounts.load', 'page.accounts', 'page.reports']);
  off(); calls.length = 0;
  L.refresh(); await tick(700);
  assert.ok(!names(calls).includes('page.accounts') && names(calls).includes('page.reports') && names(calls).includes('vendors.load'));
});

test('a page inside a shadow root (the orders page): its open popup and its field in use hold the read too', async () => {
  const { L, calls, screen, tick } = load();
  const inner = { open: [], active: null };
  const host = { tagName: 'DIV', shadowRoot: { querySelectorAll: (sel) => (/\.scrim/.test(sel) ? inner.open : []), get activeElement() { return inner.active; } } };
  screen.hosts = [host];
  inner.open = [{ hidden: false, getClientRects: () => [1] }]; // the order's «تعديل» popup
  L.signal({ payload: { t: 'orders', ids: [5] } }); await tick(3000);
  assert.equal(calls.length, 0, 'the popup inside the shadow root holds');
  inner.open = []; screen.active = host; inner.active = { tagName: 'TEXTAREA' }; // a comment being written in a card
  await tick(3000); assert.equal(calls.length, 0, 'the field inside the shadow root holds');
  inner.active = null; await tick(800);
  assert.ok(calls.some((c) => c[1] === 'refetch' && c[2] === '5'));
});
