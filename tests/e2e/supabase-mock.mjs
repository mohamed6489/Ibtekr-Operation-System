// Test-only stand-in for the Supabase project: answers exactly the auth / PostgREST calls supabase-js 2.118
// makes for the login flow and the dashboard, with the three dev users of tools/seed-dev-users.sql (+ M03, a mock-only 2FA user).
// Strict like the real thing: apikey required, PostgREST bearer must be the anon key or a token issued here,
// `select` columns checked against supabase/migrations (0001, 0002, 0006), RLS of each emulated table. Not a product feature.
// Spec files call installSupabaseMock(page) unless E2E_SUPABASE_LIVE=1: then installLiveConfig(page) points the app at the
// staging project in E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY (never at whatever app/config.js holds), or skips without them.
export const SUPABASE_URL = 'https://fsynculhaupcktzkfkdd.supabase.co';
export const LIVE = process.env.E2E_SUPABASE_LIVE === '1';
const LIVE_URL = process.env.E2E_SUPABASE_URL || ''; const LIVE_KEY = process.env.E2E_SUPABASE_ANON_KEY || '';
export const LIVE_MISSING = LIVE && !(LIVE_URL && LIVE_KEY) ? 'E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY (staging project) not set' : '';
export async function installLiveConfig(page) {
  await page.addInitScript(([url, key]) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: key }; }, [LIVE_URL, LIVE_KEY]);
}
export const DEV_PW = 'IbtekrDev-2026'; // same as tools/seed-dev-users.sql
export const TOTP_CODE = '123456'; // the code M03's mocked authenticator accepts
const ANON_KEY = 'mock-anon-key';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-10-22T00:00:00Z';
export const USERS = [
  { id: ADMIN, member_code: 'M01', name: 'صفوت كمال', email: 'admin.dev@ibtekr.local', phone: '01000000001', role_id: 'admin', title: 'المؤسس والمدير العام', dept: 'الإدارة', manager_id: null, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000002', member_code: 'M02', name: 'سارة أحمد', email: 'ops.dev@ibtekr.local', phone: '01000000002', role_id: 'ops', title: 'مديرة العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000003', member_code: 'M03', name: 'محمد علي', email: 'twofa.dev@ibtekr.local', phone: '01000000003', role_id: 'ops', title: 'العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: true, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000099', member_code: 'M99', name: 'مشاهد تجريبي', email: 'viewer.dev@ibtekr.local', phone: '01000000099', role_id: 'viewer', title: 'مشاهد', dept: 'الإدارة', manager_id: ADMIN, status: 'suspended', twofa: false, custom_perms: {}, created_at: T0 },
];
const ROLES = [
  { id: 'admin', name: 'أدمن', description: 'كل الصلاحيات — المالك والمديرين', is_system: true, permissions: { 'settings.view': 'F' }, sort: 1 },
  { id: 'ops', name: 'عمليات', description: 'الأوردرات والمخزن والتجميع والشحن', is_system: true, permissions: { 'settings.view': 'P' }, sort: 2 },
  { id: 'viewer', name: 'مشاهد', description: 'عرض بس من غير تعديل', is_system: true, permissions: { 'settings.view': 'N' }, sort: 6 },
];
const COLUMNS = { // supabase/migrations/0001_identity.sql, 0002_system.sql (activity_log), 0006_dashboard.sql (user_prefs)
  profiles: ['id', 'member_code', 'name', 'email', 'phone', 'role_id', 'title', 'dept', 'manager_id', 'status', 'twofa', 'custom_perms', 'created_at'],
  roles: ['id', 'name', 'description', 'is_system', 'permissions', 'sort'],
  user_prefs: ['user_id', 'key', 'data', 'updated_at'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
};
// has_perm('settings.view') of 0001: 'N' for a profile that is not active
const viewPerm = (u) => (u.status === 'active' ? ROLES.find((r) => r.id === u.role_id).permissions['settings.view'] : 'N');
const EMBEDS = { activity_log: { actor: 'profiles' } }; // FKs a select may embed (0002: activity_log.actor → profiles = USERS)
// a PostgREST `select` → { pick(row) } projecting a row to it, or { bad: 'table.column' }; embeds as alias:table(cols) along EMBEDS
function readSelect(table, select) {
  const parts = [];
  for (const c of (select || '*').match(/[^,(]+(\([^)]*\))?/g).map((x) => x.trim())) {
    const e = /^(\w+):(\w+)\(([^)]*)\)$/.exec(c);
    if (e) {
      const sub = e[3].split(',').map((x) => x.trim()); const miss = sub.find((x) => !(COLUMNS[e[2]] || []).includes(x));
      if ((EMBEDS[table] || {})[e[1]] !== e[2] || miss) return { bad: miss ? e[2] + '.' + miss : table + '.' + c };
      parts.push((r) => [[e[1], r[e[1]] == null ? null : Object.fromEntries(sub.map((x) => [x, (USERS.find((p) => p.id === r[e[1]]) || {})[x] ?? null]))]]);
    } else if (c === '*') parts.push((r) => Object.entries(r));
    else if (COLUMNS[table].includes(c)) parts.push((r) => [[c, r[c] ?? null]]);
    else return { bad: table + '.' + c };
  }
  return { pick: (r) => Object.fromEntries(parts.flatMap((p) => p(r))) };
}
const NOT_FILTERS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
// the horizontal filters of a PostgREST request (only eq. is emulated) → { match(row) } | { bad: 'param=value' }
function readFilters(params) {
  const f = [...params].filter(([k]) => !NOT_FILTERS.has(k)); const bad = f.find(([, v]) => !v.startsWith('eq.'));
  return bad ? { bad: bad.join('=') } : { match: (r) => f.every(([k, v]) => String(r[k]) === v.slice(3)) };
}
const factorsOf = (u) => (u.twofa ? [{ id: 'f-' + u.member_code, friendly_name: 'Authenticator', factor_type: 'totp', status: 'verified', created_at: T0, updated_at: T0 }] : []);
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const authUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors: factorsOf(u), created_at: T0 });
const claims = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return null; } };

export async function installSupabaseMock(page) {
  const issued = new Set(); const refresh = new Map(); let n = 0;
  // logoutScopes: the ?scope= of each /logout; afterLogout: requests that reached the origin after the first logout;
  // activityDelayMs: hold every log_activity call that long (a stalled network); recovers: emails sent a reset link;
  // lookups: the ident of each email_for_identifier call. activity: each log_activity body; activityRows: the activity_log
  // table it fills ({ id, at, actor, action, new_value }; a spec may seed older rows); prefs: the user_prefs table
  // ({ user_id, key, data }); prefsDown: every user_prefs write answers 503 (the server is unreachable).
  const mock = { rateLimited: false, logouts: 0, logoutScopes: [], afterLogout: 0, activityDelayMs: 0, activity: [], activityRows: [], prefs: [], prefsDown: false, userUpdates: [], recovers: [], lookups: [], requests: [], unhandled: [] };
  let activityId = 0;
  const session = (u, aal = 'aal1') => {
    const iat = Math.floor(Date.now() / 1000); n += 1;
    const access_token = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: iat }], iat, exp: iat + 3600, session_id: 's-' + u.id, n }), 'mock'].join('.');
    const refresh_token = 'rt-' + n; issued.add(access_token); refresh.set(refresh_token, { u, aal });
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: iat + 3600, refresh_token, user: authUser(u) };
  };
  // URL fragment of a password-recovery link for `email`, as GoTrue's implicit flow puts it on the redirect.
  mock.recoveryFragment = (email) => { const s = session(USERS.find((u) => u.email === email)); return new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: '3600', refresh_token: s.refresh_token, token_type: 'bearer', type: 'recovery' }).toString(); };
  // mock.attach(otherPage): a second tab of the same context answered by this same mock (same sessions, same counters)
  const attach = async (p) => {
  await p.addInitScript(([url, key]) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, realtime: false }; }, [SUPABASE_URL, ANON_KEY]); // no Realtime socket to mock
  await p.route(SUPABASE_URL + '/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method(); const hd = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': hd['access-control-request-headers'] || '*', 'access-control-expose-headers': 'x-supabase-api-version' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify(body) });
    const empty = (status) => route.fulfill({ status, headers: cors });
    const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
    if (method === 'OPTIONS') return empty(204);
    if (mock.logouts > 0) mock.afterLogout += 1;
    mock.requests.push(method + ' ' + path);
    if (hd.apikey !== ANON_KEY) return json(401, { message: 'No API key found in request' });
    const bearer = (hd.authorization || '').replace(/^Bearer /, '');
    const tokenUser = () => (issued.has(bearer) ? USERS.find((u) => u.id === claims(bearer).sub) || null : null);
    const aal = () => (issued.has(bearer) ? claims(bearer).aal : null);

    if (path.startsWith('/auth/v1/')) {
      if (method === 'POST' && path === '/auth/v1/token') {
        const b = body();
        if (url.searchParams.get('grant_type') === 'refresh_token') { const r = refresh.get(b.refresh_token); return r ? json(200, session(r.u, r.aal)) : json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }); }
        const u = USERS.find((x) => x.email === b.email && b.password === DEV_PW);
        return u ? json(200, session(u)) : json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
      }
      if (method === 'POST' && path === '/auth/v1/recover') { mock.recovers.push(body().email); return json(200, {}); } // answers the same for unknown emails
      const u = tokenUser();
      if (!u) return json(401, { code: 'bad_jwt', message: 'invalid JWT' });
      if (method === 'GET' && path === '/auth/v1/user') return json(200, authUser(u));
      if (method === 'PUT' && path === '/auth/v1/user') { mock.userUpdates.push({ email: u.email, ...body() }); return json(200, authUser(u)); }
      if (method === 'POST' && path === '/auth/v1/logout') { // GoTrue: local = this session, others = every other one, global = all
        const scope = url.searchParams.get('scope') || 'global'; mock.logouts += 1; mock.logoutScopes.push(scope);
        for (const t of [...issued]) { const mine = claims(t).sub === u.id; if (scope === 'local' ? t === bearer : scope === 'others' ? mine && t !== bearer : mine) issued.delete(t); }
        return empty(204);
      }
      const f = /^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/.exec(path);
      if (method === 'POST' && f && factorsOf(u).some((x) => x.id === f[1])) {
        if (f[2] === 'challenge') return json(200, { id: 'ch-' + f[1], type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
        const b = body();
        if (b.challenge_id !== 'ch-' + f[1] || b.code !== TOTP_CODE) return json(422, { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' });
        return json(200, session(u, 'aal2'));
      }
    }

    if (path.startsWith('/rest/v1/')) {
      if (bearer !== ANON_KEY && !issued.has(bearer)) return json(401, { code: 'PGRST301', message: 'JWT could not be decoded', details: null, hint: null });
      const u = tokenUser();
      if (method === 'POST' && path === '/rest/v1/rpc/email_for_identifier') {
        if (mock.rateLimited) return json(400, { code: 'P0001', details: null, hint: null, message: 'rate_limited' });
        mock.lookups.push(String(body().ident || ''));
        const d = String(body().ident || '').replace(/[\s-]/g, ''); // phone-only, like 0001_identity.sql: anything else → no rows
        const x = /^[0-9]{11}$/.test(d) ? USERS.find((y) => y.phone === d) : null;
        return json(200, x ? [{ email: x.email, status: x.status }] : []);
      }
      if (!u) return json(401, { code: '42501', message: 'permission denied', details: null, hint: null }); // anon: no grants below
      const table = /^\/rest\/v1\/(profiles|roles)$/.exec(path);
      if (method === 'GET' && table) {
        const cols = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim());
        const bad = cols.find((c) => c !== '*' && !COLUMNS[table[1]].includes(c));
        if (bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${table[1]}.${bad} does not exist` });
        // RLS profiles_select: own row, or every row with settings.view (active profile); roles: everyone signed in.
        const perm = ROLES.find((r) => r.id === u.role_id).permissions['settings.view'];
        const rows = table[1] === 'roles' ? ROLES : u.status === 'active' && perm !== 'N' ? USERS : [u];
        return json(200, cols.includes('*') ? rows : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))));
      }
      // read at sign-in since phase 1 (IBDirectory.load → IBAlerts): empty until the alerts are emulated
      if (method === 'GET' && /^\/rest\/v1\/(alerts|alert_reads)$/.test(path)) return json(200, []);
      const emulated = /^\/rest\/v1\/(user_prefs|activity_log)$/.exec(path);
      if (emulated && (emulated[1] === 'user_prefs' ? ['GET', 'POST', 'DELETE'] : ['GET']).includes(method)) {
        const t = emulated[1]; const f = readFilters(url.searchParams); const sel = readSelect(t, url.searchParams.get('select'));
        if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'mock: only eq. filters are emulated, got ' + f.bad });
        if (method === 'GET' && sel.bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${sel.bad} does not exist` });
        if (t === 'activity_log') { // RLS activity_log_select (0006): an active user's own rows; every row with settings.view
          const [col, dir] = (url.searchParams.get('order') || 'id.asc').split('.'); const limit = Number(url.searchParams.get('limit')) || Infinity;
          const rows = mock.activityRows.filter((r) => (viewPerm(u) !== 'N' || (u.status === 'active' && r.actor === u.id)) && f.match(r));
          rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
          return json(200, rows.slice(0, limit).map(sel.pick));
        }
        // RLS user_prefs_owner (0006): the active owner only, every operation
        const own = (r) => r.user_id === u.id && u.status === 'active' && f.match(r);
        if (method === 'GET') return json(200, mock.prefs.filter(own).map(sel.pick));
        if (mock.prefsDown) return json(503, { code: 'PGRST000', details: null, hint: null, message: 'mock: user_prefs is down' });
        if (method === 'DELETE') { for (let i = mock.prefs.length - 1; i >= 0; i -= 1) if (own(mock.prefs[i])) mock.prefs.splice(i, 1); return empty(204); }
        const rows = [].concat(body()); const merge = /resolution=merge-duplicates/.test(hd.prefer || ''); // upsert on (user_id, key)
        if (rows.some((r) => r.user_id !== u.id || u.status !== 'active')) return json(401, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "user_prefs"' });
        if (!merge && rows.some((r) => mock.prefs.some((x) => x.user_id === r.user_id && x.key === r.key))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "user_prefs_pkey"' });
        for (const r of rows) { const i = mock.prefs.findIndex((x) => x.user_id === r.user_id && x.key === r.key); const row = { user_id: r.user_id, key: r.key, data: r.data ?? {} }; if (i >= 0) mock.prefs[i] = row; else mock.prefs.push(row); }
        return json(201, []);
      }
      if (method === 'POST' && path === '/rest/v1/rpc/log_activity') {
        if (mock.activityDelayMs) await new Promise((r) => setTimeout(r, mock.activityDelayMs));
        const b = body(); mock.activity.push({ ...b, aal: aal() });
        activityId += 1; mock.activityRows.push({ id: activityId, at: new Date().toISOString(), actor: u.id, action: b.action, new_value: b.new_value ?? null }); // actor / at / id: the server's (0002 trigger)
        return empty(204).catch(() => {}); // the page may be gone after a long delay
      }
    }
    mock.unhandled.push(method + ' ' + path);
    return json(404, { message: 'not mocked: ' + method + ' ' + path });
  });
  };
  mock.attach = attach;
  await attach(page);
  return mock;
}
