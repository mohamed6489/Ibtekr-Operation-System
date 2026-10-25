// Per-user UI preferences (user_prefs, owner-only RLS) under a short key: 'dashboard' = { order, hidden } of block 25.
// load() reads them once after the directory (IBDirectory.load) and mirrors 'dashboard' into IBKit.store.dashPrefs[ME],
// where block 25 reads it. set/remove write through: the cache and the mirror change first, then the request; a failed
// request answers { ok:false } (the change stays on this device) and nothing is ever thrown. No client / signed out → no-op.
(function () {
  'use strict';
  const cache = new Map();
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const uid = () => { const s = window.IBAuth && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const get = (key) => (cache.has(key) ? cache.get(key) : null);
  function mirror() {
    const K = window.IBKit; if (!K || !K.store) return;
    K.store.dashPrefs = K.store.dashPrefs || {};
    K.store.dashPrefs[K.ME] = get('dashboard') || {};
  }
  async function load() {
    const cl = c(); const id = uid();
    if (!cl || !id) return;
    try {
      const { data, error } = await cl.from('user_prefs').select('key, data').eq('user_id', id);
      if (error) return; // keep the defaults
      cache.clear(); (data || []).forEach((r) => { cache.set(r.key, r.data); });
      mirror();
    } catch (e) { /* offline: defaults */ }
  }
  // the request is built before the first await, so it is on its way when set()/remove() return
  async function send(key, build) {
    if (key === 'dashboard') mirror();
    const cl = c(); const id = uid();
    if (!cl || !id) return { ok: false };
    try { const { error } = await build(cl.from('user_prefs'), id); return { ok: !error }; } catch (e) { return { ok: false }; }
  }
  const set = (key, data) => { cache.set(key, data); return send(key, (q, id) => q.upsert({ user_id: id, key, data }, { onConflict: 'user_id,key' })); };
  const remove = (key) => { cache.delete(key); return send(key, (q, id) => q.delete().match({ user_id: id, key })); };
  // sign-out (IBDirectory.clear): forget this member's preferences, mirror included
  function clear() {
    cache.clear();
    const K = window.IBKit; if (K && K.store && K.store.dashPrefs) delete K.store.dashPrefs[K.ME];
  }
  window.IBPrefs = { load, get, set, remove, clear };
})();
