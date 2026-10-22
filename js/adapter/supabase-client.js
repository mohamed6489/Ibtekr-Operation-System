// The one Supabase client (UMD global `supabase` from js/vendor/supabase.js), or null when config.js has no anon key.
(function () {
  'use strict';
  const cfg = window.IB_CONFIG || {};
  const ok = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  window.IBSupabase = { client: ok ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null };
})();
