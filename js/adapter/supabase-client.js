// The one Supabase client (UMD global `supabase` from js/vendor/supabase.js), or null when config.js has no anon key.
// Session storage follows «افتكرني على الجهاز ده»: localStorage['ib.remember'] = '0' → sessionStorage (this tab only),
// otherwise localStorage. Reads look in both, so a session saved either way is found on load.
// `recoveryHint`: the fragment looks like a recovery link (type=recovery AND access_token), read before the client clears it.
// Only a hint: IBAuth treats the load as a recovery when supabase-js confirms it with PASSWORD_RECOVERY.
(function () {
  'use strict';
  const cfg = window.IB_CONFIG || {};
  const ok = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  const quiet = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const target = () => (quiet(() => localStorage.getItem('ib.remember'), null) === '0' ? sessionStorage : localStorage);
  const storage = {
    getItem: (k) => quiet(() => sessionStorage.getItem(k) ?? localStorage.getItem(k), null),
    setItem: (k, v) => quiet(() => { const t = target(); (t === localStorage ? sessionStorage : localStorage).removeItem(k); t.setItem(k, v); }),
    removeItem: (k) => quiet(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
  };
  const frag = location.hash; const recoveryHint = /(^|[#&])type=recovery(&|$)/.test(frag) && /(^|[#&])access_token=/.test(frag);
  // checker(): a throwaway client for «تغيير كلمة المرور» (IBAuth.changePassword) — it checks the current password and keeps no session
  // (nothing stored, nothing refreshed), so the member's own session is never replaced
  const checker = () => (ok ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ib-password-check' } }) : null);
  // the owner 15 Nov («اي اكشن في السيستم يتعمله loading»): every request of the client passes IBBusy.fetch (busy.js, loaded after this
  // file — looked up at call time), which shows the running pill for the ones the member started; without it, the plain fetch
  const viaBusy = (input, init) => { const B = window.IBBusy; return B && typeof B.fetch === 'function' ? B.fetch(input, init) : fetch(input, init); };
  window.IBSupabase = { client: ok ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { storage }, global: { fetch: viaBusy } }) : null, recoveryHint, checker };
})();
