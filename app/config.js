// Supabase project the app talks to. The key below is the PUBLIC publishable key (RLS protects the data);
// it comes from the Supabase dashboard › Settings › API Keys (or MCP get_publishable_keys) and is safe to commit.
// Empty key = not configured: sign-in says so and the rest of the app still loads.
// `||` lets a test preset window.IB_CONFIG (Playwright addInitScript).
window.IB_CONFIG = window.IB_CONFIG || {
  supabaseUrl: 'https://fsynculhaupcktzkfkdd.supabase.co',
  supabaseAnonKey: 'sb_publishable_8TQsBDV8HuarL4OCMssYkQ_PO1irwfz',
};
