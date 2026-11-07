// deno-lint-ignore-file no-explicit-any
// settings-admin handler tests (phase 11, decisions 2 / 9 / 10 / 12): the admin only; a key saved to Vault and probed, its tail
// only in the answer and the field names only in the log; the site's keys tested first and saved only with confirm; a test and an
// unlink; a member suspended through the RPC and banned. The fake database of ../_test/fakes.ts plays Vault with an rpc map; a
// fake fetch answers the probes; no network.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000a1'; const MEMBER = '00000000-0000-4000-8000-0000000000a2';
type Route = { status?: number; body?: unknown };
function setup(opts: { routes?: Record<string, Route | ((init: RequestInit) => Route)>; vault?: Record<string, string>; rpcFail?: { code: string; message: string } } = {}) {
  const vault: Record<string, string> = { ...(opts.vault ?? {}) };
  const db = fakeDb({ settings: [{ section: 'integrations', data: {} }], profiles: [{ id: ADMIN, name: 'أدمن', email: 'a@x.test', phone: '01000000001', role_id: 'admin', status: 'active' }] }, {
    rpc: {
      app_secret_get: (a: any) => vault[a.p_name] ?? null,
      app_secret_set: (a: any) => { if (a.p_value === null) delete vault[a.p_name]; else vault[a.p_name] = a.p_value; return null; },
    },
  });
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    calls.push({ url, method: String(init.method ?? 'GET'), headers });
    const key = Object.keys(opts.routes ?? {}).find((k) => url.startsWith(k));
    const r = key ? (typeof opts.routes![key] === 'function' ? (opts.routes![key] as any)(init) : opts.routes![key]) : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  const rpcCalls: any[] = []; const bans: any[] = [];
  const userDb = (jwt: string) => fakeDb({}, { rpc: { is_admin: () => jwt === 'jwt-admin', member_status_set: (a: any) => { rpcCalls.push(a); if (opts.rpcFail) throw Object.assign(new Error(opts.rpcFail.message), { code: opts.rpcFail.code }); return null; } } });
  // the fake rpc throws → mimic PostgREST's { error }
  const userDbSafe = (jwt: string) => { const d = userDb(jwt); const rpc = d.rpc; d.rpc = async (n: string, a: unknown) => { try { return await rpc(n, a); } catch (e: any) { return { data: null, error: { code: e.code, message: e.message } }; } }; return d; };
  const deps = { env: { ...ENV }, db, fetch: fetchFn as unknown as typeof fetch, now: () => NOW, userDb: userDbSafe, userId: async (jwt: string) => (jwt === 'jwt-admin' ? ADMIN : jwt === 'jwt-member' ? MEMBER : null),
    auth: { ban: async (id: string, on: boolean) => { bans.push({ id, on }); return null; } } };
  return { db, deps, vault, calls, rpcCalls, bans };
}
async function call(deps: any, body: any, jwt = 'jwt-admin') {
  const res = await handler(new Request('http://x/settings-admin', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
const OPENAI_KEY = 'sk-test-' + 'a'.repeat(24) + 'z9';

Deno.test('the admin only: no token, a member, an unknown action', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { action: 'status' }, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, { action: 'status' }, 'jwt-member')).res.status, 401);
  assertEquals((await call(deps, { action: 'drop' })).res.status, 400);
});

Deno.test('secret_set: the key to Vault, the probe, the tail in the answer, the field names in the log; status lists it; unlink removes it', async () => {
  const { db, deps, vault, calls } = setup({ routes: { 'https://api.openai.com/v1/models': { status: 200, body: { data: [{ id: 'gpt-5.2' }, { id: 'gpt-5.2-mini' }] } } } });
  const { res, body } = await call(deps, { action: 'secret_set', name: 'openai', fields: { key: OPENAI_KEY } });
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(JSON.parse(vault.openai), { key: OPENAI_KEY });
  assertEquals(body.link.fields.key, '••••' + OPENAI_KEY.slice(-4)); assertEquals(body.link.ready, true); assertEquals(body.link.linked_by, ADMIN);
  assertEquals([body.test.ok, body.test.account], [true, '2 موديل متاح']);
  assertEquals(calls.length, 1); assertEquals(calls[0].headers.Authorization, 'Bearer ' + OPENAI_KEY);
  const txt = JSON.stringify(body) + JSON.stringify(db.rows('activity_log')) + JSON.stringify(db.rows('settings'));
  assert(!txt.includes(OPENAI_KEY), 'the key is nowhere but Vault');
  assertEquals(db.rows('activity_log').map((r: any) => [r.action, r.entity_id, r.new_value]), [['settings.integration.set', 'openai', { keys: ['key'], test: 'ok' }]]);
  const st = await call(deps, { action: 'status' });
  assertEquals(Object.keys(st.body.links), ['openai']); assertEquals(st.body.links.openai.test.ok, true); assert(st.body.cards.some((c: any) => c.id === 'openai' && c.used));
  // a bad key shape is refused before Vault; an unknown name too
  assertEquals((await call(deps, { action: 'secret_set', name: 'openai', fields: { key: 'short' } })).body, { error: 'invalid', field: 'key' });
  assertEquals((await call(deps, { action: 'secret_set', name: 'sync_secret', fields: { key: 'x' } })).res.status, 400);
  assertEquals((await call(deps, { action: 'secret_set', name: 'woo', fields: {} })).res.status, 400, 'the site goes through woo_set');
  // unlink
  assertEquals((await call(deps, { action: 'secret_unlink', name: 'openai' })).body, { result: 'unlinked' });
  assertEquals(vault.openai, undefined);
  assertEquals(Object.keys((await call(deps, { action: 'status' })).body.links), []);
});

Deno.test('a probe that fails keeps the key and says why; a platform without a probe is saved untested; a stored secret left empty stays', async () => {
  const { deps, vault } = setup({ routes: { 'https://api.resend.com/domains': { status: 401, body: { message: 'bad key' } } } });
  const r1 = await call(deps, { action: 'secret_set', name: 'resend', fields: { key: 're_' + 'k'.repeat(20), from: 'alerts@ibtekr.club' } });
  assertEquals([r1.res.status, r1.body.test.ok, r1.body.test.error], [200, false, 'unauthorized']); assertEquals(JSON.parse(vault.resend).from, 'alerts@ibtekr.club');
  const r2 = await call(deps, { action: 'secret_set', name: 'resend', fields: { key: '', from: 'x@ibtekr.club' } });
  assertEquals(r2.body, { error: 'missing', field: 'key' }, 'emptying the key empties a required field'); assertEquals(JSON.parse(vault.resend).from, 'alerts@ibtekr.club', 'nothing changed');
  const r3 = await call(deps, { action: 'secret_set', name: 'resend', fields: { from: 'x@ibtekr.club' } });
  assertEquals(JSON.parse(vault.resend), { key: 're_' + 'k'.repeat(20), from: 'x@ibtekr.club' }, 'the omitted key stays');
  const h = await call(deps, { action: 'secret_set', name: 'higgsfield', fields: { key: 'hf-' + 'q'.repeat(12) } });
  assertEquals([h.res.status, h.body.test, h.body.link.ready], [200, null, true]);
  const m = await call(deps, { action: 'secret_set', name: 'mcp_higgsfield', fields: { url: 'https://mcp.higgsfield.ai/', name: 'Higgsfield MCP' } });
  assertEquals([m.res.status, m.body.link.fields.url, m.body.link.ready], [200, 'https://mcp.higgsfield.ai', true]);
  assertEquals((await call(deps, { action: 'secret_test', name: 'gemini' })).res.status, 404);
});

Deno.test('woo_set: the store and the media user probed first; without confirm nothing is saved; a failed probe saves nothing; confirm saves and logs the url only', async () => {
  const CK = 'ck_' + 'a'.repeat(40), CS = 'cs_' + 'b'.repeat(40);
  const routes = {
    'https://ibtekr.club/wp-json/wc/v3/system_status': (init: RequestInit) => ((init.headers as any).Authorization === 'Basic ' + btoa(CK + ':' + CS) ? { status: 200, body: { environment: { site_url: 'https://ibtekr.club', version: '9.4.1' }, settings: { currency: 'EGP' } } } : { status: 401, body: {} }),
    'https://ibtekr.club/wp-json/wp/v2/users/me': { status: 200, body: { name: 'ops', roles: ['administrator'] } },
  };
  const { db, deps, vault, calls } = setup({ routes });
  const fields = { url: 'https://ibtekr.club/', ck: CK, cs: CS, wp_user: 'ops', wp_app_password: 'abcd efgh ijkl mnop qrst', push: true };
  const t = await call(deps, { action: 'woo_set', fields });
  assertEquals(t.res.status, 200, JSON.stringify(t.body));
  assertEquals([t.body.result, t.body.account, t.body.url], ['tested', 'https://ibtekr.club · WooCommerce 9.4.1 · EGP · ops · administrator', 'https://ibtekr.club']);
  assertEquals(vault.woo, undefined, 'nothing saved without confirm'); assertEquals(calls.length, 2);
  const bad = await call(deps, { action: 'woo_set', fields: { ...fields, cs: 'cs_' + 'x'.repeat(40) }, confirm: true });
  assertEquals([bad.res.status, bad.body.error, bad.body.step, bad.body.code], [502, 'test_failed', 'store', 'unauthorized']); assertEquals(vault.woo, undefined);
  const ok = await call(deps, { action: 'woo_set', fields, confirm: true });
  assertEquals([ok.res.status, ok.body.result, ok.body.link.ready, ok.body.link.fields.ck, ok.body.link.fields.push], [200, 'saved', true, '••••aaaa', true]);
  assertEquals(JSON.parse(vault.woo), { url: 'https://ibtekr.club', ck: CK, cs: CS, wp_user: 'ops', wp_app_password: 'abcd efgh ijkl mnop qrst', push: true });
  const logs = db.rows('activity_log').filter((r: any) => r.action === 'settings.integration.woo');
  assertEquals(logs.map((r: any) => r.new_value.result), ['test_failed', 'saved']);
  assertEquals(logs[1].new_value, { result: 'saved', url: 'https://ibtekr.club', keys: ['url', 'ck', 'cs', 'wp_user', 'wp_app_password', 'push'], push: true });
  assert(!JSON.stringify(db.rows('activity_log')).includes(CK) && !JSON.stringify(ok.body).includes(CS), 'no key anywhere');
  assertEquals((await call(deps, { action: 'woo_set', fields: { url: 'http://ibtekr.club', ck: CK, cs: CS } })).body, { error: 'invalid', field: 'url' });
});

Deno.test('member_status: the RPC with the caller\'s JWT, then the ban; the RPC\'s refusals come back in words', async () => {
  const { deps, rpcCalls, bans } = setup();
  const r = await call(deps, { action: 'member_status', member_id: MEMBER, status: 'suspended', reason: ' تأخير <متكرر> ' });
  assertEquals(r.body, { ok: true, status: 'suspended', auth: 'applied' });
  assertEquals(rpcCalls, [{ p_member: MEMBER, p_status: 'suspended', p_reason: 'تأخير  متكرر' }]); assertEquals(bans, [{ id: MEMBER, on: true }]);
  const back = await call(deps, { action: 'member_status', member_id: MEMBER, status: 'active' });
  assertEquals(back.body.ok, true); assertEquals(bans[1], { id: MEMBER, on: false });
  assertEquals((await call(deps, { action: 'member_status', member_id: 'nope', status: 'active' })).body, { error: 'invalid', field: 'member_id' });
  const last = setup({ rpcFail: { code: '22023', message: 'last admin' } });
  assertEquals((await call(last.deps, { action: 'member_status', member_id: MEMBER, status: 'suspended', reason: 'x' })).body, { error: 'last_admin', field: null });
  assertEquals(last.bans, [], 'no ban when the RPC refused');
  const self = setup({ rpcFail: { code: '22023', message: 'invalid: self' } });
  assertEquals((await call(self.deps, { action: 'member_status', member_id: ADMIN, status: 'suspended', reason: 'x' })).body, { error: 'invalid', field: 'self' });
});
