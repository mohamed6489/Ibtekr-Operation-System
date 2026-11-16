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
  const LOGGED_PREFIXES = ['auth.', 'dashboard.', 'profile.2fa.', 'vendor.', 'accounts.', 'product.', 'cs.', 'inventory.', 'ticket.', 'hr.', 'mkt.', 'settings.', 'assistant.']; // accounts.: phase 4 (accounts.js); product.: phase 5 (products.js); cs.: phase 6 (cs.js); inventory.: phase 7 (inventory.js); ticket.: phase 8 (tickets.js); hr.: phase 10 (hr.js — the HR page on IBHR); mkt.: phase 9.5.1 (marketing.js); settings.: phase 11 (settings.js); assistant.: phase 12 (ai.js — the header's assistant: action names and data kinds, never a text)
  const LOGGED_ACTIONS = ['order.status', 'order.confirm', 'order.patch', 'suborder.status', 'suborder.waybill', 'suborder.pulled', 'order.rating', 'order.delete', 'suborder.delete', 'order.line_delete', 'order.line_qty', 'order.line_add', 'suborder.site_status', 'profile.password', 'profile.edit']; // orders.js; «ملفي» › تغيير كلمة المرور / تعديل بياناتي (phase 10: the member's name only)
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
  // The movement logs' period (comments decisions 26, 27 and 80 — the owner 15 Nov: «اي سجل حركات لازم يبقي فيه ال فلتر التاريخ الكبير»): a
  // period is whole days in Cairo — dayBounds gives the instants it covers for a server read (the zone's own offset on each day,
  // so summer time is right), cairoDay the day a stamp falls on, and inPeriod whether a stamp is inside a period (none = every day).
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const CAIRO = { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const cairoOffset = (day) => { const d = new Date(day + 'T12:00:00Z'); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const n = (t) => Number((p.find((x) => x.type === t) || {}).value) || 0; return (n('hour') % 24) * 60 + n('minute') - 720; }; // minutes ahead of UTC that day
  const instant = (day, h, m, s, ms) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m, s, ms) - cairoOffset(day) * 60000).toISOString();
  const dayBounds = (from, to) => ({ gte: ISO_DAY.test(String(from || '')) ? instant(from, 0, 0, 0, 0) : null, lte: ISO_DAY.test(String(to || '')) ? instant(to, 23, 59, 59, 999) : null });
  const cairoDay = (at) => { const s0 = String(at == null ? '' : at); if (!s0) return ''; if (s0.indexOf('T') < 0) return s0.slice(0, 10); const d = new Date(s0); return isNaN(d) ? s0.slice(0, 10) : new Intl.DateTimeFormat('en-CA', CAIRO).format(d); };
  const inPeriod = (range, at) => { if (!range || !ISO_DAY.test(String(range.from || '')) || !ISO_DAY.test(String(range.to || ''))) return true; const d = cairoDay(at); return !!d && d >= range.from && d <= range.to; };
  window.IBActivity = { log, LOGGED_PREFIXES, LOGGED_ACTIONS, recent, cached: () => rows, refresh, clear: () => { rows = null; }, dayBounds, cairoDay, inPeriod };
})();
