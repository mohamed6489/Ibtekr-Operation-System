// Server activity log: log(action, detail) → rpc log_activity, only while signed in. Returns a promise; callers fire and forget.
// Only actions starting with one of LOGGED_PREFIXES reach the server: the other pages still act on sample data, and their
// events must not land in activity_log under the real user. Each phase that wires a page to real data adds its prefix here
// (e.g. 'orders.' with the orders phase). The in-memory store.activity (14-kit.js) keeps every event as before.
(function () {
  'use strict';
  const LOGGED_PREFIXES = ['auth.'];
  const forwarded = (action) => LOGGED_PREFIXES.some((p) => String(action || '').startsWith(p));
  function log(action, detail) {
    const c = window.IBSupabase.client;
    if (!forwarded(action) || !c || !window.IBAuth || !window.IBAuth.session()) return Promise.resolve();
    return c.rpc('log_activity', { action, entity: null, entity_id: null, old_value: null, new_value: detail === undefined ? null : detail }).then(() => {});
  }
  window.IBActivity = { log, LOGGED_PREFIXES };
})();
