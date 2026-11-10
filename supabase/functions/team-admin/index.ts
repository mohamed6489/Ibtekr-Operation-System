// team-admin: «إضافة عضو» from the HR page — phase 10, decisions 5 / 6 / 13 of docs/superpowers/plans/2026-11-05-phase-10-hr.md
// (the owner, 5 Nov: the button creates the login too; the temporary password shows once and is never stored). Deployed with
// verify_jwt false; it authenticates each request itself — the admin only (is_admin through the caller's own JWT):
//   POST { action: 'member_create', name, email, phone?, role, title?, dept?, manager_id?, shift_start?, shift_end?, hire_date? }
//        → an Auth user (the email confirmed) with a temporary password + the profiles row (active, the next member code «Mnn»)
//          + hr_members → { ok, id, member_code, password }. The password is in this answer only: no table, no log, no Vault.
//          A taken email / phone → 409 { error: 'exists', field }; a failure after the Auth user → that user is removed again.
//   POST { action: 'member_password', member_id } → a new temporary password for that member (same rule; not the caller's own).
//   Phase 13 decision 14 (the owner, 10 Nov — «عايز أبعتله إيميل يعمل هو الباسورد»): when Resend is set (Vault app_resend of 0056 →
//   RESEND_API_KEY / RESEND_FROM) member_create mails the member a set-your-password link instead (a Supabase recovery link made with
//   generateLink — never sent by Supabase's own mailer — pointing at APP_URL, where the app's reset form takes it: single use, the
//   Auth OTP expiry) and answers { ok, id, member_code, mailed: true, email } with no password; without Resend, or when the mail
//   fails, the temporary password comes back as before (mailed: false). POST { action: 'member_invite', member_id } sends that
//   link again (the admin; not the caller's own) → { ok, mailed }. The link itself is never stored or logged.
//   Phase 13 decision 15 (the owner, 10 Nov — «زودلي زرار لمسح الـ user نهائي»): POST { action: 'member_delete', member_id } → the RPC
//   member_delete of 0066 (service_role; never the caller's own account): a member with any trace in a non-cascading table is
//   refused 409 { error: 'has_records', table }, the last active admin 409 { error: 'last_admin' }; a traceless one goes from
//   auth.users (profiles and the member's own rows cascade) → { ok, id, name }.
// activity_log: hr.member.create / hr.member.password / hr.member.invite / hr.member.delete with the member id and name only (no password,
// no email, no phone, no link).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { withVault } from '../_shared/secrets.js';
import { emailHtml } from '../_shared/notify.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type AuthAdmin = {
  create: (email: string, password: string, name: string) => Promise<{ id?: string; error?: string }>;
  setPassword: (id: string, password: string) => Promise<string | null>; // null = ok, else an error code
  remove: (id: string) => Promise<void>;
  setLink?: (email: string, redirectTo: string) => Promise<{ link?: string; error?: string }>; // a set-your-password (recovery) link, not sent by Supabase
};
export type Deps = { env: Record<string, string | undefined>; db: Db; now: () => string; userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>; auth?: AuthAdmin;
  fetch?: typeof fetch };

const ACTIONS = ['member_create', 'member_password', 'member_invite', 'member_delete'];
export const DEFAULT_APP_URL = 'https://operation-system.ibtekr.club/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,180}\.[a-z]{2,24}$/i;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const errText = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

// a temporary password: 12 characters, a letter and a digit at least, no look-alikes; crypto.getRandomValues with rejection sampling
export function tempPassword(length = 12): string {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', N = '23456789', A = L + N;
  const pick = (n: number) => { const b = new Uint32Array(1); const lim = 0x100000000 - (0x100000000 % n); do { crypto.getRandomValues(b); } while (b[0] >= lim); return b[0] % n; };
  const out = [L[pick(L.length)], N[pick(N.length)]];
  while (out.length < length) out.push(A[pick(A.length)]);
  for (let i = out.length - 1; i > 0; i -= 1) { const j = pick(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

async function adminOf(req: Request, deps: Deps): Promise<string | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const { data, error } = await deps.userDb(jwt).rpc('is_admin');
  if (error || data !== true) return null;
  return await deps.userId(jwt);
}
async function logActivity(deps: Deps, actor: string, action: string, id: string, name: string) {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor, action, entity: 'profile', entity_id: id, new_value: name }); } catch { /* never blocks */ }
}
async function nextCode(deps: Deps): Promise<string> {
  const { data } = await deps.db.from('profiles').select('member_code');
  const max = (data ?? []).map((r: Json) => /^M(\d{1,4})$/.exec(String(r.member_code ?? ''))?.[1]).filter(Boolean).map(Number).reduce((a: number, b: number) => Math.max(a, b), 0);
  return 'M' + String(max + 1).padStart(2, '0');
}

/** the set-your-password mail (decision 14): the member's name and the link only — no password, no code */
export function inviteEmail(name: string, link: string): { subject: string; body: string } {
  const who = clean(name, 80) || 'زميلنا';
  return { subject: 'حسابك على نظام إبتكر — اعمل الباسورد بتاعك', body: 'أهلاً ' + who + '،\nاتعملك حساب على نظام تشغيل إبتكر. افتح اللينك ده واختار الباسورد بتاعك، وبعدها ادخل بإيميلك:\n' + link + '\n\nاللينك بيشتغل مرة واحدة ولمدة محدودة — لو خلص، اطلب من الأدمن يبعته تاني.' };
}
const resendKey = (deps: Deps) => (deps.env.RESEND_API_KEY ?? '').trim();
// the set-your-password link, mailed through Resend: true when it went; false when Resend is not set, the link failed or Resend refused
async function sendInvite(deps: Deps, email: string, name: string): Promise<boolean> {
  const key = resendKey(deps); if (!key || !deps.auth?.setLink) return false;
  const redirectTo = (deps.env.APP_URL ?? '').trim() || DEFAULT_APP_URL;
  const made = await deps.auth.setLink(email, redirectTo);
  if (!made.link) return false;
  const m = inviteEmail(name, made.link);
  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: (deps.env.RESEND_FROM ?? '').trim() || 'alerts@ibtekr.club', to: [email], subject: m.subject, html: emailHtml(m.subject, m.body, 'فريق إبتكر كلوب') }), signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch { return false; }
}

// the member as typed → the row, or the field that is wrong
export function memberInput(args: Json): { ok: true; v: Json } | { ok: false; field: string } {
  const name = clean(args.name, 80);
  if (name.length < 2) return { ok: false, field: 'name' };
  const email = clean(args.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, field: 'email' };
  const phone = latinDigits(clean(args.phone, 20)).replace(/[\s-]/g, '');
  if (phone && !/^01[0125][0-9]{8}$/.test(phone)) return { ok: false, field: 'phone' };
  const role = clean(args.role, 40);
  if (!/^[a-z_]{2,40}$/.test(role)) return { ok: false, field: 'role' };
  const manager = clean(args.manager_id, 40);
  if (manager && !UUID.test(manager)) return { ok: false, field: 'manager_id' };
  const start = clean(args.shift_start, 5) || '09:00', end = clean(args.shift_end, 5) || '17:00';
  if (!TIME.test(start) || !TIME.test(end)) return { ok: false, field: 'shift' };
  const hire = clean(args.hire_date, 10);
  if (hire && (!DAY.test(hire) || Number.isNaN(Date.parse(hire + 'T00:00:00Z')))) return { ok: false, field: 'hire_date' };
  return { ok: true, v: { name, email, phone: phone || null, role, title: clean(args.title, 60) || null, dept: clean(args.dept, 40) || null, manager: manager || null, start, end, hire: hire || null } };
}

async function memberCreate(deps: Deps, admin: string, args: Json) {
  const r = memberInput(args);
  if (!r.ok) return json(400, { error: 'invalid', field: r.field });
  const v = r.v;
  const { data: role } = await deps.db.from('roles').select('id').eq('id', v.role).maybeSingle();
  if (!role) return json(400, { error: 'invalid', field: 'role' });
  if (v.manager) {
    const { data: mgr } = await deps.db.from('profiles').select('id, status').eq('id', v.manager).maybeSingle();
    if (!mgr || mgr.status !== 'active') return json(400, { error: 'invalid', field: 'manager_id' });
  }
  const { data: sameEmail } = await deps.db.from('profiles').select('id').eq('email', v.email).maybeSingle();
  if (sameEmail) return json(409, { error: 'exists', field: 'email' });
  if (v.phone) {
    const { data: samePhone } = await deps.db.from('profiles').select('id').eq('phone', v.phone).maybeSingle();
    if (samePhone) return json(409, { error: 'exists', field: 'phone' });
  }
  if (!deps.auth) return json(500, { error: 'failed' });
  const password = tempPassword();
  const made = await deps.auth.create(v.email, password, v.name);
  if (!made.id) return json(made.error === 'exists' ? 409 : 502, { error: made.error === 'exists' ? 'exists' : 'auth_failed', field: made.error === 'exists' ? 'email' : undefined });
  const code = await nextCode(deps);
  const { error: pErr } = await deps.db.from('profiles').insert({ id: made.id, member_code: code, name: v.name, email: v.email, phone: v.phone, role_id: v.role,
    title: v.title, dept: v.dept, manager_id: v.manager, status: 'active' });
  if (pErr) { await deps.auth.remove(made.id); return json(pErr.code === '23505' ? 409 : 500, { error: pErr.code === '23505' ? 'exists' : 'failed' }); }
  await deps.db.from('hr_members').insert({ member_id: made.id, shift_start: v.start, shift_end: v.end, hire_date: v.hire });
  await logActivity(deps, admin, 'hr.member.create', made.id, v.name);
  const mailed = await sendInvite(deps, v.email, v.name); // decision 14: the mail when Resend is set; the password only when it is not
  if (mailed) { await logActivity(deps, admin, 'hr.member.invite', made.id, v.name); return json(200, { ok: true, id: made.id, member_code: code, mailed: true, email: v.email }); }
  return json(200, { ok: true, id: made.id, member_code: code, mailed: false, password });
}

async function memberInvite(deps: Deps, admin: string, args: Json) {
  const id = typeof args.member_id === 'string' && UUID.test(args.member_id) ? args.member_id.toLowerCase() : null;
  if (!id) return json(400, { error: 'invalid', field: 'member_id' });
  if (id === admin) return json(400, { error: 'invalid', field: 'member_id' });
  const { data: p } = await deps.db.from('profiles').select('id, name, email, status').eq('id', id).maybeSingle();
  if (!p) return json(404, { error: 'not_found' });
  if (p.status !== 'active') return json(409, { error: 'inactive' });
  if (!resendKey(deps)) return json(503, { error: 'not_configured' });
  const mailed = await sendInvite(deps, String(p.email ?? '').toLowerCase(), String(p.name ?? ''));
  if (!mailed) return json(502, { error: 'mail_failed' });
  await logActivity(deps, admin, 'hr.member.invite', id, p.name);
  return json(200, { ok: true, id, mailed: true });
}

async function memberPassword(deps: Deps, admin: string, args: Json) {
  const id = typeof args.member_id === 'string' && UUID.test(args.member_id) ? args.member_id.toLowerCase() : null;
  if (!id) return json(400, { error: 'invalid', field: 'member_id' });
  if (id === admin) return json(400, { error: 'invalid', field: 'member_id' }); // one's own password: «ملفي» › «الحساب والأمان»
  const { data: p } = await deps.db.from('profiles').select('id, name').eq('id', id).maybeSingle();
  if (!p) return json(404, { error: 'not_found' });
  if (!deps.auth) return json(500, { error: 'failed' });
  const password = tempPassword();
  const err = await deps.auth.setPassword(id, password);
  if (err) return json(502, { error: 'auth_failed' });
  await logActivity(deps, admin, 'hr.member.password', id, p.name);
  return json(200, { ok: true, id, password });
}

async function memberDelete(deps: Deps, admin: string, args: Json) {
  const id = typeof args.member_id === 'string' && UUID.test(args.member_id) ? args.member_id.toLowerCase() : null;
  if (!id) return json(400, { error: 'invalid', field: 'member_id' });
  if (id === admin) return json(400, { error: 'invalid', field: 'member_id' });
  const { data, error } = await deps.db.rpc('member_delete', { p_member: id, p_actor: admin });
  if (error) {
    const code = String(error.code ?? ''); const msg = String(error.message ?? '');
    if (code === 'P0002') return json(404, { error: 'not_found' });
    if (code === '23503') return json(409, { error: 'has_records', table: String(error.hint ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 60) || null });
    if (code === '22023') return json(409, { error: msg === 'last_admin' ? 'last_admin' : 'invalid' });
    return json(500, { error: 'failed' });
  }
  return json(200, { ok: true, id, name: typeof data?.name === 'string' ? data.name : '' }); // the RPC wrote hr.member.delete itself
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let args: Json;
  try { args = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!isObj(args)) return json(400, { error: 'bad_json' });
  const admin = await adminOf(req, deps);
  if (!admin) return json(401, { error: 'unauthorized' });
  const action = String(args.action ?? '');
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'member_create') return await memberCreate(deps, admin, args);
    if (action === 'member_invite') return await memberInvite(deps, admin, args);
    if (action === 'member_delete') return await memberDelete(deps, admin, args);
    return await memberPassword(deps, admin, args);
  } catch (e) {
    console.error('team-admin ' + action + ': ' + errText(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    auth: {
      create: async (email, password, name) => {
        const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
        if (error) return { error: /already|registered|exists/i.test(error.message ?? '') ? 'exists' : 'failed' };
        return { id: data?.user?.id };
      },
      setPassword: async (id, password) => { const { error } = await service.auth.admin.updateUserById(id, { password }); return error ? 'failed' : null; },
      remove: async (id) => { try { await service.auth.admin.deleteUser(id); } catch { /* best effort */ } },
      setLink: async (email, redirectTo) => { // a recovery link made here and mailed by us — Supabase's mailer never sends it
        const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
        const link = data?.properties?.action_link;
        return error || typeof link !== 'string' || !link ? { error: 'failed' } : { link };
      },
    },
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await withVault(realDeps())));
