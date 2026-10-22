// Test-only stand-in for the Supabase project: answers exactly the auth / PostgREST calls supabase-js 2.118
// makes for the login flow, with the three dev users of tools/seed-dev-users.sql. Not a product feature.
// Spec files call installSupabaseMock(page) unless E2E_SUPABASE_LIVE=1 (then they hit the real project).
export const SUPABASE_URL = 'https://fsynculhaupcktzkfkdd.supabase.co';
export const LIVE = process.env.E2E_SUPABASE_LIVE === '1';
export const DEV_PW = 'IbtekrDev-2026'; // same as tools/seed-dev-users.sql

const ADMIN = '00000000-0000-4000-8000-000000000001';
export const USERS = [
  { id: ADMIN, member_code: 'M01', name: 'صفوت كمال', email: 'admin.dev@ibtekr.local', phone: '01000000001', role_id: 'admin', title: 'المؤسس والمدير العام', dept: 'الإدارة', manager_id: null, status: 'active', twofa: false, custom_perms: {} },
  { id: '00000000-0000-4000-8000-000000000002', member_code: 'M02', name: 'سارة أحمد', email: 'ops.dev@ibtekr.local', phone: '01000000002', role_id: 'ops', title: 'مديرة العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {} },
  { id: '00000000-0000-4000-8000-000000000099', member_code: 'M99', name: 'مشاهد تجريبي', email: 'viewer.dev@ibtekr.local', phone: '01000000099', role_id: 'viewer', title: 'مشاهد', dept: 'الإدارة', manager_id: ADMIN, status: 'suspended', twofa: false, custom_perms: {} },
];
const ROLES = [
  { id: 'admin', name: 'أدمن', description: 'كل الصلاحيات — المالك والمديرين', permissions: { 'settings.view': 'F' }, sort: 1 },
  { id: 'ops', name: 'عمليات', description: 'الأوردرات والمخزن والتجميع والشحن', permissions: { 'settings.view': 'P' }, sort: 2 },
  { id: 'viewer', name: 'مشاهد', description: 'عرض بس من غير تعديل', permissions: { 'settings.view': 'N' }, sort: 6 },
];

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (u) => { const iat = Math.floor(Date.now() / 1000); return [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: iat }], iat, exp: iat + 3600, session_id: 's-' + u.id }), 'mock'].join('.'); };
const authUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors: [], created_at: '2026-10-22T00:00:00Z' });
const session = (u) => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt-' + u.id, user: authUser(u) });
const userOfToken = (req) => { const t = (req.headers().authorization || '').replace(/^Bearer /, '').split('.')[1]; try { const sub = JSON.parse(Buffer.from(t, 'base64url').toString()).sub; return USERS.find((u) => u.id === sub) || null; } catch { return null; } };
// RLS of profiles_select: own row, or every row with settings.view (and an active profile).
const visibleProfiles = (u) => { if (!u) return []; const perm = ROLES.find((r) => r.id === u.role_id).permissions['settings.view']; return u.status === 'active' && perm !== 'N' ? USERS : [u]; };

export async function installSupabaseMock(page) {
  const mock = { rateLimited: false, logouts: 0, activity: [], unhandled: [] };
  await page.addInitScript((url) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: 'mock-anon-key' }; }, SUPABASE_URL);
  await page.route(SUPABASE_URL + '/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*', 'access-control-expose-headers': 'x-supabase-api-version' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify(body) });
    const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (method === 'POST' && path === '/auth/v1/token') {
      const b = body();
      const u = url.searchParams.get('grant_type') === 'refresh_token' ? USERS.find((x) => 'rt-' + x.id === b.refresh_token) : USERS.find((x) => x.email === b.email && b.password === DEV_PW);
      return u ? json(200, session(u)) : json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
    }
    if (method === 'GET' && path === '/auth/v1/user') { const u = userOfToken(req); return u ? json(200, authUser(u)) : json(401, { code: 'bad_jwt', message: 'invalid JWT' }); }
    if (method === 'POST' && path === '/auth/v1/logout') { mock.logouts += 1; return route.fulfill({ status: 204, headers: cors }); }
    if (method === 'POST' && path === '/rest/v1/rpc/email_for_identifier') {
      if (mock.rateLimited) return json(400, { code: 'P0001', details: null, hint: null, message: 'rate_limited' });
      const ident = String(body().ident || ''); const e = ident.trim().toLowerCase(); const d = ident.replace(/[\s-]/g, '');
      const u = USERS.find((x) => (e.includes('@') ? x.email === e : x.phone === d));
      return json(200, u ? [{ email: u.email, status: u.status }] : []);
    }
    if (method === 'GET' && path === '/rest/v1/profiles') return json(200, visibleProfiles(userOfToken(req)));
    if (method === 'GET' && path === '/rest/v1/roles') return json(200, userOfToken(req) ? ROLES : []);
    if (method === 'POST' && path === '/rest/v1/rpc/log_activity') { mock.activity.push(body()); return route.fulfill({ status: 204, headers: cors }); }
    mock.unhandled.push(method + ' ' + path);
    return json(404, { message: 'not mocked: ' + method + ' ' + path });
  });
  return mock;
}
