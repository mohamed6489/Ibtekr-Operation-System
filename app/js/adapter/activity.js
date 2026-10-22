// Server activity log: log(action, detail) → rpc log_activity, only while signed in. Returns a promise; callers fire and forget.
(function () {
  'use strict';
  function log(action, detail) {
    const c = window.IBSupabase.client;
    if (!c || !window.IBAuth || !window.IBAuth.session()) return Promise.resolve();
    return c.rpc('log_activity', { action, entity: null, entity_id: null, old_value: null, new_value: detail === undefined ? null : detail }).then(() => {});
  }
  window.IBActivity = { log };
})();
