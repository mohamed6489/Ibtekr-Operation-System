// Server activity log: log(action, detail) → rpc log_activity, only while signed in. Returns a promise; callers fire and forget.
// Only actions starting with one of LOGGED_PREFIXES, or named exactly in LOGGED_ACTIONS, reach the server: the other pages
// still act on sample data, and their events must not land in activity_log under the real user. Each phase that wires a page
// to real data adds its prefix or its actions here (phase 2: 'profile.2fa.', the real 2FA enrolment of «ملفي» through IBAuth —
// the rest of «ملفي» is still sample data; and the six actions IBOrders logs after a write the server took — by name, not
// 'order.' / 'suborder.': block 22's demo events share those prefixes (order.consolidate, order.cancel with its free-text
// reason, …) and are logged before any server write; phase 3: 'vendor.', the events IBVendors logs after a write the server
// took — block 28's own vendor.* entries go to its in-memory event log only, never through here). log's optional third argument
// { entity, entity_id } fills the row's entity columns (IBVendors: entity 'vendor', the vendor's uuid, so a vendor's drawer can
// read its own history). The in-memory store.activity (14-kit.js) keeps every event as before.
// recent(limit) reads the newest rows RLS lets this user see (own rows; every row with settings.view) with the actor's name
// embedded; refresh() keeps the newest 25 for the dashboard's «آخر نشاط» card (cached(), null until the first refresh) and
// dispatches ib:activity; the card shows 5 after its own-actions filter (a viewer with settings.view reads everyone's rows).
// A forwarded log refreshes once the server took it, except auth.signout (the page reloads next: no GET inside the 3 s
// sign-out window). Read errors give [] and are never thrown.
(function () {
  'use strict';
  const LOGGED_PREFIXES = ['auth.', 'dashboard.', 'profile.2fa.', 'vendor.', 'accounts.']; // accounts.: phase 4 (accounts.js)
  const LOGGED_ACTIONS = ['order.status', 'order.confirm', 'order.patch', 'suborder.status', 'suborder.waybill', 'suborder.pulled', 'order.rating']; // orders.js
  let rows = null;
  const forwarded = (action) => { const a = String(action || ''); return LOGGED_ACTIONS.includes(a) || LOGGED_PREFIXES.some((p) => a.startsWith(p)); };
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
  function log(action, detail, meta) {
    const c = client();
    if (!forwarded(action) || !c || !signedIn()) return Promise.resolve();
    const entity = meta && meta.entity ? String(meta.entity) : null; const entityId = meta && meta.entity_id != null ? String(meta.entity_id) : null;
    return c.rpc('log_activity', { action, entity, entity_id: entityId, old_value: null, new_value: detail === undefined ? null : detail })
      .then((res) => ((res && res.error) || action === 'auth.signout' ? undefined : refresh()));
  }
  window.IBActivity = { log, LOGGED_PREFIXES, LOGGED_ACTIONS, recent, cached: () => rows, refresh, clear: () => { rows = null; } };
})();
