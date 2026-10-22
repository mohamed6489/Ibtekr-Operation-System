// Supabase project the app talks to. The anon key is public (RLS protects the data); copy it from the
// Supabase dashboard › Settings › API › "anon public" key (or MCP get_publishable_keys).
// Empty key = not configured: sign-in says so and the rest of the app still loads.
// `||` lets a test preset window.IB_CONFIG (Playwright addInitScript).
window.IB_CONFIG = window.IB_CONFIG || {
  supabaseUrl: 'https://fsynculhaupcktzkfkdd.supabase.co',
  supabaseAnonKey: '',
};
