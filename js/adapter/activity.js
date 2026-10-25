// Server activity log: log(action, detail) → rpc log_activity, only while signed in. Returns a promise; callers fire and forget.
// Only actions starting with one of LOGGED_PREFIXES reach the server: the other pages still act on sample data, and their
// events must not land in activity_log under the real user. Each phase that wires a page to real data adds its prefix here
// (phase 2: 'order.' and 'suborder.', the orders page's writes through IBOrders). The in-memory store.activity (14-kit.js)
// keeps every event as before.
// recent(limit) reads the newest rows RLS lets this user see (own rows; every row with settings.view) with the actor's name
// embedded; refresh() keeps the newest 25 for the dashboard's «آخر نشاط» card (cached(), null until the first refresh) and
// dispatches ib:activity; the card shows 5 after its own-actions filter (a viewer with settings.view reads everyone's rows).
// A forwarded log refreshes once the server took it, except auth.signout (the page reloads next: no GET inside the 3 s
// sign-out window). Read errors give [] and are never thrown.
(function () {
  'use strict';
  const LOGGED_PREFIXES = ['auth.', 'dashboard.', 'order.', 'suborder.'];
  let rows = null;
  const forwarded = (action) => LOGGED_PREFIXES.some((p) => String(action || '').startsWith(p));
  const client = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const signedIn = () => !!(window.IBAuth && window.IBAuth.session());
  const toRow = (r) => ({ id: r.id, at: r.at, actor: (r.actor && r.actor.name) || '—', action: r.action,
    detail: typeof r.new_value === 'string' ? r.new_value : r.new_value == null ? '' : JSON.stringify(r.new_value) });
  // null on a failed read, so refresh() can keep what it has
  async function read(limit) {
    const c = client(); if (!c || !signedIn()) return null;
    try {
      const { data, error } = await c.from('activity_log').select('id, at, action, new_value, actor:profiles(name)').order('at', { ascending: false }).limit(limit);
      return error ? null : (data || []).map(toRow);
    } catch (e) { return null; }
  }
  async function recent(limit = 5) { return (await read(limit)) || []; }
  async function refresh() {
    if (!client() || !signedIn()) return;
    const r = await read(25);
    rows = r || rows || [];
    try { document.dispatchEvent(new Event('ib:activity')); } catch (e) { /* a bad listener must not fail the log */ }
  }
  function log(action, detail) {
    const c = client();
    if (!forwarded(action) || !c || !signedIn()) return Promise.resolve();
    return c.rpc('log_activity', { action, entity: null, entity_id: null, old_value: null, new_value: detail === undefined ? null : detail })
      .then((res) => ((res && res.error) || action === 'auth.signout' ? undefined : refresh()));
  }
  window.IBActivity = { log, LOGGED_PREFIXES, recent, cached: () => rows, refresh, clear: () => { rows = null; } };
})();
