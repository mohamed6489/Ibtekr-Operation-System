// settings-admin: the admin's door of «الإعدادات › الربط بالمنصات» and the team's status (phase 11, decisions 9 / 10 / 12 / 19 of
// docs/superpowers/plans/2026-11-07-phase-11-settings.md). Deployed with verify_jwt false; it authenticates each request itself —
// the admin only (is_admin through the caller's own JWT). Every platform key lives in Vault (0056 app_secret_*), is written from
// here only, and leaves the server as its last 4 characters at most.
//   POST { action: 'status' } → every known link: the fields (a secret as its tail), ready, linked_at / linked_by, the last test;
//        plus the cards catalogue (which platforms the system uses).
//   POST { action: 'secret_set', name, fields } → merge over what is stored (a given value replaces, '' removes, omitted stays),
//        save to Vault, then the platform's probe when it has one → { link, test }.
//   POST { action: 'woo_set', fields, confirm? } → the site's keys (decision 2): the probe FIRST and it must pass; without confirm
//        true the answer is { result: 'tested', account } and nothing is saved; with it the keys are saved (and used by every
//        function from the next call — Vault wins over the Supabase secrets).
//   POST { action: 'secret_test', name } → the probe on what is stored. POST { action: 'secret_unlink', name } → removed.
//   POST { action: 'member_status', member_id, status, reason? } → member_status_set (the caller's JWT: the RPC's own guards) +
//        the Auth user banned / unbanned.
// activity_log: settings.integration.* with the name and the field names only; settings.member.* by the RPC. No value, no URL
// with a key, no token in any answer or log.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { secretOf, secretSet } from '../_shared/secrets.js';
import { CARDS, SECRET_NAMES, fieldsOf, nameOk, parseSecret, probeCode, probesOf, secretPublic } from '../_shared/settings-link.js';
import { McpError, mcpClient, type McpClient } from '../_shared/mcp-client.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; fetch: typeof fetch; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  auth?: { ban: (id: string, on: boolean) => Promise<string | null> }; // null = ok
  mcp?: (url: string, token: string | null) => McpClient; // decision 4: an MCP server's probe = initialize + tools/list
};

const ACTIONS = ['status', 'secret_set', 'woo_set', 'secret_test', 'secret_unlink', 'member_status'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROBE_MS = 15_000;
const errText = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);

async function adminOf(req: Request, deps: Deps): Promise<{ id: string; jwt: string } | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const { data, error } = await deps.userDb(jwt).rpc('is_admin');
  if (error || data !== true) return null;
  const id = await deps.userId(jwt);
  return id ? { id, jwt } : null;
}
async function log(deps: Deps, actor: string, action: string, name: string, value: Json | null) {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor, action, entity: 'integration', entity_id: name, new_value: value }); } catch { /* never blocks */ }
}

// the non-secret meta of the links lives in settings «integrations» → { meta: { <name>: { linked_at, linked_by, test } } }
async function metaAll(deps: Deps): Promise<Json> {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'integrations').maybeSingle();
  const m = data?.data?.meta;
  return isObj(m) ? m : {};
}
async function metaPut(deps: Deps, name: string, patch: Json | null) {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'integrations').maybeSingle();
  const cur = isObj(data?.data) ? data.data : {};
  const meta = isObj(cur.meta) ? { ...cur.meta } : {};
  if (patch === null) delete meta[name]; else meta[name] = { ...(isObj(meta[name]) ? meta[name] : {}), ...patch };
  const next = { ...cur, meta };
  if (data) await deps.db.from('settings').update({ data: next }).eq('section', 'integrations');
  else await deps.db.from('settings').insert({ section: 'integrations', data: next });
}

// the one cheap read (or two for WooCommerce) that proves a key works; never a write, never the URL with a key in an error
type Probe = { ok: boolean; at: string; latency_ms: number; account?: string; error?: string; step?: string; tools?: string[] };
async function runProbes(deps: Deps, name: string, link: Json): Promise<Probe | null> {
  if (name.startsWith('mcp_')) return await mcpProbe(deps, link);
  const probes = probesOf(name, link) as Array<{ id: string; method: string; url: string; headers: Record<string, string>; ok: (s: number, b: unknown) => { account: string } | null }> | null;
  if (!probes) return null;
  const started = Date.now(); const accounts: string[] = [];
  for (const p of probes) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), PROBE_MS);
    let res: Response;
    try { res = await deps.fetch(p.url, { method: p.method, headers: p.headers, signal: ctl.signal }); } catch (e) { clearTimeout(t); return { ok: false, at: deps.now(), latency_ms: Date.now() - started, error: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network', step: p.id }; }
    clearTimeout(t);
    let body: unknown = null; try { body = await res.json(); } catch { body = null; }
    const got = p.ok(res.status, body);
    if (!got) return { ok: false, at: deps.now(), latency_ms: Date.now() - started, error: probeCode(res.status), step: p.id };
    accounts.push(got.account);
  }
  return { ok: true, at: deps.now(), latency_ms: Date.now() - started, account: accounts.filter(Boolean).join(' · ') };
}

// an MCP server: initialize + tools/list → the tools it offers (their names kept in the test for the page's MCP section)
async function mcpProbe(deps: Deps, link: Json): Promise<Probe> {
  const started = Date.now();
  if (!deps.mcp || typeof link.url !== 'string') return { ok: false, at: deps.now(), latency_ms: 0, error: 'untested' };
  try {
    const tools = await deps.mcp(link.url, typeof link.token === 'string' ? link.token : null).listTools();
    return { ok: true, at: deps.now(), latency_ms: Date.now() - started, account: tools.length + ' أدوات', ...(tools.length ? { tools: tools.slice(0, 40).map((t) => t.name) } : {}) } as Probe;
  } catch (e) {
    const k = e instanceof McpError ? (e.kind === 'not_linked' ? 'unauthorized' : e.kind === 'busy' ? 'provider' : 'refused') : 'network';
    return { ok: false, at: deps.now(), latency_ms: Date.now() - started, error: k, step: 'mcp' };
  }
}

async function status(deps: Deps) {
  const meta = await metaAll(deps);
  const names = [...new Set([...SECRET_NAMES, ...Object.keys(meta).filter((n) => nameOk(n))])];
  const links: Json = {};
  for (const n of names) {
    const stored = await secretOf(deps.db, n);
    if (!stored && !meta[n]) continue;
    links[n] = secretPublic(n, stored, meta[n]);
  }
  return json(200, { links, cards: CARDS, now: deps.now() });
}

async function secretSetAction(deps: Deps, admin: string, args: Json) {
  const name = String(args.name ?? '');
  if (!nameOk(name) || !fieldsOf(name)) return json(400, { error: 'unknown_secret' });
  if (name === 'woo') return json(400, { error: 'invalid', field: 'name' }); // the site's keys go through woo_set (the probe first)
  const stored = await secretOf(deps.db, name);
  const parsed = parseSecret(name, args.fields, stored) as { link?: Json; error?: string; field?: string };
  if (parsed.error) return json(400, { error: parsed.error, field: parsed.field });
  const link = parsed.link as Json;
  const saved = await secretSet(deps.db, name, link);
  if (!saved.ok) return json(saved.error === 'no_vault' ? 503 : 500, { error: saved.error });
  const test = await runProbes(deps, name, link);
  await metaPut(deps, name, { linked_at: deps.now(), linked_by: admin, ...(test ? { test } : {}) });
  await log(deps, admin, 'settings.integration.set', name, { keys: Object.keys(isObj(args.fields) ? args.fields : {}), test: test ? (test.ok ? 'ok' : test.error) : 'untested' });
  const meta = await metaAll(deps);
  return json(200, { link: secretPublic(name, link, meta[name]), test });
}

async function wooSet(deps: Deps, admin: string, args: Json) {
  const stored = await secretOf(deps.db, 'woo');
  const parsed = parseSecret('woo', args.fields, stored) as { link?: Json; error?: string; field?: string };
  if (parsed.error) return json(400, { error: parsed.error, field: parsed.field });
  const link = parsed.link as Json;
  const test = await runProbes(deps, 'woo', link);
  if (!test || !test.ok) {
    await log(deps, admin, 'settings.integration.woo', 'woo', { result: 'test_failed', error: test?.error ?? 'untested', step: test?.step ?? null });
    return json(502, { error: 'test_failed', step: test?.step ?? null, code: test?.error ?? 'untested' });
  }
  await log(deps, admin, 'settings.integration.woo', 'woo', { result: args.confirm === true ? 'test_ok' : 'tested', url: link.url }); // every probe is logged with its host
  if (args.confirm !== true) return json(200, { result: 'tested', account: test.account, latency_ms: test.latency_ms, url: link.url });
  const saved = await secretSet(deps.db, 'woo', link);
  if (!saved.ok) return json(saved.error === 'no_vault' ? 503 : 500, { error: saved.error });
  await metaPut(deps, 'woo', { linked_at: deps.now(), linked_by: admin, test });
  await log(deps, admin, 'settings.integration.woo', 'woo', { result: 'saved', url: link.url, keys: Object.keys(isObj(args.fields) ? args.fields : {}), push: link.push === true });
  const meta = await metaAll(deps);
  return json(200, { result: 'saved', link: secretPublic('woo', link, meta.woo), test });
}

async function secretTest(deps: Deps, admin: string, args: Json) {
  const name = String(args.name ?? '');
  if (!nameOk(name) || !fieldsOf(name)) return json(400, { error: 'unknown_secret' });
  const stored = await secretOf(deps.db, name);
  if (!stored) return json(404, { error: 'not_linked' });
  const test = await runProbes(deps, name, stored);
  if (test) await metaPut(deps, name, { test });
  await log(deps, admin, 'settings.integration.test', name, { result: test ? (test.ok ? 'ok' : test.error) : 'untested' });
  return json(200, { test });
}

async function secretUnlink(deps: Deps, admin: string, args: Json) {
  const name = String(args.name ?? '');
  if (!nameOk(name) || !fieldsOf(name)) return json(400, { error: 'unknown_secret' });
  const r = await secretSet(deps.db, name, null);
  if (!r.ok) return json(r.error === 'no_vault' ? 503 : 500, { error: r.error });
  await metaPut(deps, name, null);
  await log(deps, admin, 'settings.integration.unlink', name, null);
  return json(200, { result: 'unlinked' });
}

async function memberStatus(deps: Deps, who: { id: string; jwt: string }, args: Json) {
  const id = typeof args.member_id === 'string' && UUID.test(args.member_id) ? args.member_id.toLowerCase() : null;
  const st = args.status === 'suspended' ? 'suspended' : args.status === 'active' ? 'active' : null;
  if (!id) return json(400, { error: 'invalid', field: 'member_id' });
  if (!st) return json(400, { error: 'invalid', field: 'status' });
  const reason = typeof args.reason === 'string' ? args.reason.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 300) : '';
  const { error } = await deps.userDb!(who.jwt).rpc('member_status_set', { p_member: id, p_status: st, p_reason: reason || null });
  if (error) {
    const msg = String(error.message ?? '');
    if (error.code === '42501') return json(403, { error: 'unauthorized' });
    if (error.code === 'P0002') return json(404, { error: 'not_found' });
    if (error.code === '22023') return json(400, { error: /last admin/.test(msg) ? 'last_admin' : 'invalid', field: /invalid: (\w+)/.exec(msg)?.[1] ?? null });
    return json(500, { error: 'failed' });
  }
  const banErr = deps.auth ? await deps.auth.ban(id, st === 'suspended') : 'no_auth';
  return json(200, { ok: true, status: st, auth: banErr ? 'not_applied' : 'applied' });
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let args: Json;
  try { args = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!isObj(args)) return json(400, { error: 'bad_json' });
  const who = await adminOf(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  const action = String(args.action ?? '');
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'status') return await status(deps);
    if (action === 'secret_set') return await secretSetAction(deps, who.id, args);
    if (action === 'woo_set') return await wooSet(deps, who.id, args);
    if (action === 'secret_test') return await secretTest(deps, who.id, args);
    if (action === 'secret_unlink') return await secretUnlink(deps, who.id, args);
    return await memberStatus(deps, who, args);
  } catch (e) {
    console.error('settings-admin ' + action + ': ' + errText(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, fetch: globalThis.fetch, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    mcp: (url, token) => mcpClient(url, token, globalThis.fetch),
    auth: { ban: async (id, on) => { const { error } = await service.auth.admin.updateUserById(id, { ban_duration: on ? '876000h' : 'none' }); return error ? 'failed' : null; } },
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
