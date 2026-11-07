// secrets: the platform keys the admin writes from «الإعدادات › الربط بالمنصات» live in Vault (0056 app_secret_*) and win over
// the Supabase secrets of the same name (phase 11 decision 9). vaultEnv overlays them on the function's env in one RPC
// (app_secret_env maps the stored JSON onto WOO_URL / WOO_CK / … / ANTHROPIC_API_KEY / OPENAI_API_KEY / …); a database that
// has no Vault, no row or an error leaves the env as it came — a secret never stops a function from starting. withVault wraps
// a function's deps for the serve() entry; the tests pass their deps straight to the handler and are not touched.

export async function vaultEnv(db, env) {
  try {
    const { data, error } = await db.rpc('app_secret_env');
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return env;
    const out = { ...env };
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && v.trim()) out[k] = v;
    return out;
  } catch {
    return env;
  }
}

export async function withVault(deps) {
  return { ...deps, env: await vaultEnv(deps.db, deps.env) };
}

// The JSON of one named key (an object), or null when missing / unparsable / Vault absent. service_role only.
export async function secretOf(db, name) {
  try {
    const { data, error } = await db.rpc('app_secret_get', { p_name: name });
    if (error || typeof data !== 'string' || !data) return null;
    const v = JSON.parse(data);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Writes the JSON of one named key (null removes it). Returns { ok } or { ok: false, error } with the SQLSTATE-ish code only.
export async function secretSet(db, name, value) {
  const { error } = await db.rpc('app_secret_set', { p_name: name, p_value: value == null ? null : JSON.stringify(value) });
  if (!error) return { ok: true };
  return { ok: false, error: error.code === '0A000' ? 'no_vault' : error.code === '22023' ? 'unknown_secret' : 'db' };
}

// What a secret's status may show: which fields are set and the last 4 characters of each secret one (never a value).
export const tailOf = (v) => { const s = String(v ?? ''); return s.length >= 8 ? '••••' + s.slice(-4) : s ? '••••' : ''; };
