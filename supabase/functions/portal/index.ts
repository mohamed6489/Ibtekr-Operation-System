// portal: the maker portal's one door (phase 13 T4, docs/superpowers/plans/2026-11-09-phase-13-leftovers.md decision 10). The maker is
// not a Supabase Auth user: this function (service_role) checks the sign-in through the 0065 definer functions, signs its own HS256
// token (12 hours, the Vault secret app_portal_jwt) and answers the maker's own view — every query filtered by the token's vendor id,
// never a customer's phone, never another maker. Deployed with verify_jwt false; the token travels in the header x-portal-token.
//   POST { action: 'login', user, password }            → { ok, token, must_change, name } | 401 { error: wrong | locked, until? } (unknown / disabled / no-password all read wrong)
//   POST { action: 'set_password', password }           (a «first» token: the first sign-in only) → { ok, token }
//   POST { action: 'change_password', current, password } (token) → { ok, token } | 401 { error: wrong | locked }
//   POST { action: 'reset_request', user }              → { ok, mode: 'email' | 'team' } whatever the user (nothing says whether it exists)
//   POST { action: 'reset', token, password }           → { ok, token, name } | 404 { error: 'reset_invalid' }
//   POST { action: 'me' | 'orders' | 'account' }        (token) → the maker's data
//   POST { action: 'bank_request', note? }              (token) → { ok, id, existing? }: a ticket for the accounts role, one open at a time
// activity_log rows come from the database functions (portal.login / locked / password / reset…) and here portal.bank_request —
// the maker's uuid only. The e-mail of a reset goes through Resend (the Vault key app_resend of 0056) when it is set; else the
// answer says «كلّم فريق إبتكر» (mode team).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { withVault } from '../_shared/secrets.js';
import { emailHtml } from '../_shared/notify.js';
import { PORTAL_ACTOR, bankNote, loginInput, makerLedger, makerLines, maskedBank, passwordIssues, resetEmail, resetLink, resetTokenOk, tokenClaims } from '../_shared/portal.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; db: Db; now: () => string; fetch?: typeof fetch };
type Who = { vendor: string; scope: 'first' | 'full' };

const ACTIONS = ['login', 'set_password', 'change_password', 'reset_request', 'reset', 'me', 'orders', 'account', 'bank_request'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-portal-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errText = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const ORDERS_DAYS_MS = 90 * 86400000;

// ---------------------------------------------------------------- the token (HS256, WebCrypto)
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));
const fromB64url = (s: string) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function hmacKey(secret: string, usage: KeyUsage) { return await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]); }
export async function signToken(secret: string, claims: Json): Promise<string> {
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' }) + '.' + b64urlJson(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(head)));
  return head + '.' + b64url(sig);
}
export async function verifyToken(secret: string, token: string, nowSec: number): Promise<Json | null> {
  const parts = String(token ?? '').split('.'); if (parts.length !== 3) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64url(parts[2]), enc.encode(parts[0] + '.' + parts[1])); } catch { return null; }
  if (!ok) return null;
  let claims: unknown; try { claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { return null; }
  if (!isObj(claims) || typeof claims.sub !== 'string' || !UUID.test(claims.sub) || typeof claims.exp !== 'number' || claims.exp <= nowSec) return null;
  return claims;
}
let secretCache: { value: string; at: number } | null = null;
async function jwtSecret(deps: Deps): Promise<string | null> {
  if (secretCache && Date.now() - secretCache.at < 600_000) return secretCache.value;
  const { data, error } = await deps.db.rpc('portal_jwt_secret');
  if (error || typeof data !== 'string' || data.length < 32) return null;
  secretCache = { value: data, at: Date.now() };
  return data;
}
const nowSec = (deps: Deps) => Math.floor(Date.parse(deps.now()) / 1000);
async function whoOf(req: Request, deps: Deps): Promise<Who | null> {
  const tok = req.headers.get('x-portal-token') ?? ''; if (!tok) return null;
  const secret = await jwtSecret(deps); if (!secret) return null;
  const c = await verifyToken(secret, tok, nowSec(deps)); if (!c) return null;
  const vendor = String(c.sub).toLowerCase();
  // the login row on every call: a disabled login or a password changed after the token was made ends the session (security review)
  const [{ data: l }, { data: v }] = await Promise.all([
    deps.db.from('vendor_logins').select('vendor_id, status, password_set_at').eq('vendor_id', vendor).maybeSingle(),
    deps.db.from('vendors').select('id, status').eq('id', vendor).maybeSingle(),
  ]);
  if (!isObj(l) || l.status === 'disabled' || !isObj(v) || v.status === 'inactive') return null; // a disabled login or a maker taken off the site: no session
  const setAt = Date.parse(String(l.password_set_at ?? '')); const iat = typeof c.iat === 'number' ? c.iat * 1000 : 0;
  if (Number.isFinite(setAt) && setAt - iat > 5000) return null; // a token from before the last password change (5 s of slack for the one made right after it)
  return { vendor, scope: c.scope === 'first' ? 'first' : 'full' };
}
async function tokenFor(deps: Deps, vendor: string, scope: 'first' | 'full'): Promise<string | null> {
  const secret = await jwtSecret(deps); if (!secret) return null;
  return await signToken(secret, tokenClaims(vendor, scope, nowSec(deps)));
}
const rpcCode = (error: Json | null) => String(error?.code ?? '');

// ---------------------------------------------------------------- the actions
async function vendorName(deps: Deps, id: string): Promise<string> {
  const { data } = await deps.db.from('vendors').select('id, name').eq('id', id).maybeSingle();
  return isObj(data) ? String(data.name ?? '') : '';
}

async function login(deps: Deps, args: Json) {
  const inp = loginInput(args); if ('error' in inp) return json(400, inp);
  const { data, error } = await deps.db.rpc('vendor_login_check', { p_user: inp.user, p_password: inp.password });
  if (error) return json(rpcCode(error) === '0A000' ? 503 : 500, { error: rpcCode(error) === '0A000' ? 'not_configured' : 'failed' });
  if (!isObj(data) || data.ok !== true) {
    const raw = isObj(data) && typeof data.reason === 'string' ? data.reason : 'wrong';
    // security review: an unknown user, a wrong password, a disabled login and a login without a password all read «wrong» — nothing
    // in the answer says whether the account exists; only the lock (after five wrong tries on a real login) is named, so the maker
    // knows to wait or reset
    const reason = raw === 'locked' ? 'locked' : 'wrong';
    return json(401, { error: reason, ...(reason === 'locked' && data?.until ? { until: String(data.until) } : {}) });
  }
  const vendor = String(data.vendor_id).toLowerCase(); const must = data.must_change === true;
  const token = await tokenFor(deps, vendor, must ? 'first' : 'full'); if (!token) return json(503, { error: 'not_configured' });
  return json(200, { ok: true, token, must_change: must, name: await vendorName(deps, vendor) });
}

async function setOwn(deps: Deps, vendor: string, password: unknown) {
  const issues = passwordIssues(password);
  if (issues.length) return { res: json(400, { error: 'weak_password', issues }) };
  const { error } = await deps.db.rpc('vendor_login_set_own', { p_vendor: vendor, p_password: password });
  if (error) {
    const code = rpcCode(error);
    return { res: json(code === '0A000' ? 503 : code === '22023' ? 400 : code === '42501' ? 401 : code === 'P0002' ? 404 : 500, { error: code === '0A000' ? 'not_configured' : code === '22023' ? 'weak_password' : code === '42501' ? 'disabled' : code === 'P0002' ? 'not_found' : 'failed' }) };
  }
  return { res: null };
}
async function setPassword(deps: Deps, who: Who, args: Json) {
  const r = await setOwn(deps, who.vendor, args.password); if (r.res) return r.res;
  const token = await tokenFor(deps, who.vendor, 'full'); if (!token) return json(503, { error: 'not_configured' });
  return json(200, { ok: true, token });
}
async function changePassword(deps: Deps, who: Who, args: Json) {
  if (typeof args.current !== 'string' || !args.current || args.current.length > 128) return json(400, { error: 'bad_request', field: 'current' });
  const { data: l } = await deps.db.from('vendor_logins').select('vendor_id, username').eq('vendor_id', who.vendor).maybeSingle();
  if (!isObj(l)) return json(404, { error: 'not_found' });
  const { data, error } = await deps.db.rpc('vendor_login_check', { p_user: String(l.username), p_password: args.current });
  if (error) return json(rpcCode(error) === '0A000' ? 503 : 500, { error: rpcCode(error) === '0A000' ? 'not_configured' : 'failed' });
  if (!isObj(data) || data.ok !== true) return json(401, { error: isObj(data) && typeof data.reason === 'string' ? data.reason : 'wrong' });
  return await setPassword(deps, who, args);
}

async function sendResetMail(deps: Deps, to: string, name: string, token: string): Promise<boolean> {
  const key = (deps.env.RESEND_API_KEY ?? '').trim(); if (!key) return false;
  const m = resetEmail(name, resetLink(deps.env.PORTAL_URL, token));
  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: (deps.env.RESEND_FROM ?? '').trim() || 'alerts@ibtekr.club', to: [to], subject: m.subject, html: emailHtml(m.subject, m.body, 'فريق إبتكر كلوب') }), signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch { return false; }
}
async function resetRequest(deps: Deps, args: Json) {
  const user = typeof args.user === 'string' ? args.user.trim().toLowerCase() : '';
  if (!user || user.length > 160) return json(400, { error: 'bad_request', field: 'user' });
  const mode = (deps.env.RESEND_API_KEY ?? '').trim() ? 'email' : 'team';
  const { data, error } = await deps.db.rpc('vendor_login_reset_create', { p_user: user });
  if (error) return json(500, { error: 'failed' });
  // the same answer whether or not the login exists; the mail goes out only when it does and Resend is set
  if (isObj(data) && typeof data.token === 'string' && typeof data.email === 'string' && mode === 'email') {
    const p = sendResetMail(deps, data.email, String(data.name ?? ''), data.token).catch(() => false);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p); else await p;
  }
  return json(200, { ok: true, mode });
}
async function reset(deps: Deps, args: Json) {
  if (!resetTokenOk(args.token)) return json(404, { error: 'reset_invalid' });
  const issues = passwordIssues(args.password); if (issues.length) return json(400, { error: 'weak_password', issues });
  const { data, error } = await deps.db.rpc('vendor_login_reset_use', { p_token: args.token, p_password: args.password });
  if (error) { const code = rpcCode(error); return json(code === 'P0002' ? 404 : code === '0A000' ? 503 : code === '22023' ? 400 : code === '42501' ? 401 : 500, { error: code === 'P0002' ? 'reset_invalid' : code === '0A000' ? 'not_configured' : code === '22023' ? 'weak_password' : code === '42501' ? 'disabled' : 'failed' }); }
  const vendor = String(data ?? '').toLowerCase(); if (!UUID.test(vendor)) return json(500, { error: 'failed' });
  const token = await tokenFor(deps, vendor, 'full'); if (!token) return json(503, { error: 'not_configured' });
  return json(200, { ok: true, token, name: await vendorName(deps, vendor) });
}

async function me(deps: Deps, who: Who) {
  const [{ data: v }, { data: l }, { data: b }, { data: own }, { data: store }] = await Promise.all([
    deps.db.from('vendors').select('id, name, phone, email, status').eq('id', who.vendor).maybeSingle(),
    deps.db.from('vendor_logins').select('vendor_id, username, email, must_change, own_password, last_login_at').eq('vendor_id', who.vendor).maybeSingle(),
    deps.db.from('vendor_bank').select('vendor_id, method, holder, bank_name, iban, account_number, wallet').eq('vendor_id', who.vendor).maybeSingle(),
    deps.db.from('brand_owners').select('brand_id, vendor_id, since').eq('vendor_id', who.vendor),
    deps.db.from('brands').select('id, name, store_vendor_id').eq('store_vendor_id', who.vendor),
  ]);
  if (!isObj(v)) return json(404, { error: 'not_found' });
  const ids = new Set<string>((Array.isArray(own) ? own : []).map((o: Json) => String(o.brand_id)));
  const named = new Map<string, string>();
  for (const b2 of Array.isArray(store) ? store : []) named.set(String(b2.id), String(b2.name ?? ''));
  const missing = [...ids].filter((id) => !named.has(id));
  if (missing.length) { const { data: more } = await deps.db.from('brands').select('id, name').in('id', missing); for (const b2 of Array.isArray(more) ? more : []) named.set(String(b2.id), String(b2.name ?? '')); }
  return json(200, { result: 'ok', v: { id: v.id, name: v.name ?? '', phone: v.phone ?? null, email: (isObj(l) ? l.email : null) ?? v.email ?? null, status: v.status ?? 'active' },
    login: isObj(l) ? { username: l.username, ownPassword: l.own_password === true, mustChange: l.must_change === true, lastLoginAt: l.last_login_at ?? null } : null,
    brands: [...named.values()].filter(Boolean).map((name) => ({ name })), bank: maskedBank(b) });
}

async function orders(deps: Deps, who: Who) {
  const since = new Date(Date.parse(deps.now()) - ORDERS_DAYS_MS).toISOString();
  const { data: subs } = await deps.db.from('sub_orders').select('id, order_id, vendor_id, woo_order_id, woo_status').eq('vendor_id', who.vendor);
  const { data: items } = await deps.db.from('order_items').select('id, order_id, sub_order_id, product_id, name, qty, total, status, expected_at, removed').eq('vendor_id', who.vendor);
  const orderIds = [...new Set([...(Array.isArray(subs) ? subs : []), ...(Array.isArray(items) ? items : [])].map((r: Json) => r.order_id).filter((x) => x != null))];
  const ords: Json[] = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data } = await deps.db.from('orders').select('id, number, status, confirm, confirm_at, placed_at, deleted_at').in('id', orderIds.slice(i, i + 100)).gte('placed_at', since);
    for (const o of Array.isArray(data) ? data : []) ords.push(o);
  }
  // phase 13 decision 52: the making days — the products' own over the maker's «مدة التجهيز»
  const pids = [...new Set((Array.isArray(items) ? items : []).map((it: Json) => it.product_id).filter((x) => x != null))];
  const leads = new Map<string, number>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await deps.db.from('product_lead_days').select('product_id, days').in('product_id', pids.slice(i, i + 200)); for (const x of Array.isArray(data) ? data : []) leads.set(String(x.product_id), Number(x.days)); }
  const { data: me } = await deps.db.from('vendors').select('lead_days').eq('id', who.vendor).maybeSingle();
  const rows = makerLines({ items: Array.isArray(items) ? items : [], orders: ords.filter((o: Json) => !o.deleted_at), subs: Array.isArray(subs) ? subs : [], now: deps.now(), leads, makerLead: me ? me.lead_days : null });
  return json(200, { result: 'ok', rows, since: since.slice(0, 10) });
}

async function account(deps: Deps, who: Who) {
  const [{ data: bal }, { data: moves }, { data: wds }] = await Promise.all([
    deps.db.from('dokan_balances').select('vendor_id, balance, synced_at').eq('vendor_id', who.vendor).maybeSingle(),
    deps.db.from('acc_vendor_moves').select('id, direction, kind, kind_name, amount, on_date, voided_at').eq('vendor_id', who.vendor).is('voided_at', null),
    deps.db.from('dokan_withdrawals').select('id, amount, status, method, requested_at').eq('vendor_id', who.vendor).order('requested_at', { ascending: false }).limit(3),
  ]);
  const ledger = makerLedger({ balance: isObj(bal) ? bal.balance : null, moves: Array.isArray(moves) ? moves : [] });
  return json(200, { result: 'ok', ledger, synced_at: isObj(bal) ? bal.synced_at ?? null : null, dokan: isObj(bal),
    withdrawals: (Array.isArray(wds) ? wds : []).map((w: Json) => ({ id: w.id, amount: Number(w.amount) || 0, status: String(w.status ?? ''), method: w.method ?? null, at: w.requested_at ?? null })) });
}

const OPEN_TICKET = ['open', 'in_progress', 'waiting'];
async function bankRequest(deps: Deps, who: Who, args: Json) {
  const name = await vendorName(deps, who.vendor); if (!name) return json(404, { error: 'not_found' });
  const { data: open } = await deps.db.from('tickets').select('id, status, created_by_role').eq('vendor_id', who.vendor).eq('created_by_role', PORTAL_ACTOR.role).in('status', OPEN_TICKET);
  const live = (Array.isArray(open) ? open : []).find((t: Json) => OPEN_TICKET.includes(String(t.status)));
  if (live) return json(200, { ok: true, id: Number(live.id), existing: true });
  const note = bankNote(args.note);
  const description = ('المبتكر «' + name + '» طلب من بوابة المبتكر تعديل / تسجيل حسابه البنكي. الحسابات تتواصل معاه وتتأكد من البيانات قبل أي تغيير.' + (note ? '\n\nملاحظته: ' + note : '')).slice(0, 5000);
  const row = { type: 'vendor', title: ('طلب تعديل الحساب البنكي — ' + name).slice(0, 80), description, priority: 'normal', assignee_role: 'الحسابات', vendor_id: who.vendor, vendor: name.slice(0, 80),
    created_by: null, created_by_name: PORTAL_ACTOR.name, created_by_role: PORTAL_ACTOR.role, status: 'open', created_at: deps.now(), last_update: deps.now() };
  const { data, error } = await deps.db.from('tickets').insert(row).select('id').single();
  if (error || !isObj(data)) return json(500, { error: 'failed' });
  await deps.db.from('ticket_events').insert([
    { ticket_id: data.id, kind: 'event', actor: null, actor_name: PORTAL_ACTOR.name, actor_role: PORTAL_ACTOR.role, text: PORTAL_ACTOR.name + ' فتحت التذكرة وعيّنتها لدور «الحسابات»', at: deps.now() },
    { ticket_id: data.id, kind: 'message', actor: null, actor_name: PORTAL_ACTOR.name, actor_role: PORTAL_ACTOR.role, text: description, at: deps.now() },
  ]);
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: null, action: 'portal.bank_request', entity: 'vendor', entity_id: who.vendor, new_value: String(data.id) }); } catch { /* never blocks */ }
  return json(200, { ok: true, id: Number(data.id) });
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let args: Json;
  try { args = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!isObj(args)) return json(400, { error: 'bad_json' });
  const action = String(args.action ?? '');
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'login') return await login(deps, args);
    if (action === 'reset_request') return await resetRequest(deps, args);
    if (action === 'reset') return await reset(deps, args);
    const who = await whoOf(req, deps);
    if (!who) return json(401, { error: 'unauthorized' });
    // set_password belongs to the first sign-in only (a «first» token); a signed-in maker changes it through change_password with the current one
    if (action === 'set_password') return who.scope === 'first' ? await setPassword(deps, who, args) : json(401, { error: 'use_change_password' });
    if (who.scope !== 'full') return json(401, { error: 'must_change' }); // the first sign-in: the password first, everything else after
    if (action === 'change_password') return await changePassword(deps, who, args);
    if (action === 'me') return await me(deps, who);
    if (action === 'orders') return await orders(deps, who);
    if (action === 'account') return await account(deps, who);
    return await bankRequest(deps, who, args);
  } catch (e) {
    console.error('portal ' + action + ': ' + errText(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
async function realDeps(): Promise<Deps> {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return await withVault({ env, db: service, now: () => new Date().toISOString() });
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await realDeps()));
