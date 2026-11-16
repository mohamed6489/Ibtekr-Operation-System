// share-mail — «مشاركة» › «إيميل» sent by the system (the owner 16 Nov: «الايميل يتبعت من السيستم و برضو يبقي في field محطوط فيه
// ايميل الفيندور default اللي هيتبعتله و كمان اقدر اغيره بايميل تاني»). Deployed with verify_jwt false; it authenticates each request
// itself — an active member's JWT (the share popup is on pages the member already sees; the file is made in the member's browser from
// what the member sees).
//   POST { to, subject, text, file?: { name, kind: 'xlsx' | 'pdf', data: base64 } }
//        → one mail through Resend (Vault app_resend of 0056 → RESEND_API_KEY) from the system's sender, to one address, the file
//          attached, reply-to the member's own email; { ok: true }
// The checks: one address (a plain email), the subject ≤ 150 and the text ≤ 4000 characters without < >, the file ≤ 8 MB and of
// its kind by its first bytes (an Excel = a zip «PK», a PDF «%PDF»), its name a plain file name of that kind; 30 mails a member
// an hour (counted on activity_log share.email). No Resend = 503 not_configured; Resend refuses = 502 refused.
// activity_log: share.email with the file's kind only — never the address, the subject, the text or the file.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { withVault } from '../_shared/secrets.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; db: Db; now: () => string; userId?: (jwt: string) => Promise<string | null>; fetch?: typeof fetch };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,180}\.[a-z]{2,24}$/i;
export const MAX_FILE = 8 * 1024 * 1024;
export const PER_HOUR = 30;
const KINDS: Record<string, { ext: string; mime: string; magic: number[] }> = {
  xlsx: { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [0x50, 0x4b] },
  pdf: { ext: '.pdf', mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
};
const errText = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
// one line / a text with its lines: no control characters, no < >
const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const body = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ').replace(/[ \t]+/g, ' ').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** the request as sent → the mail, or the field that is wrong */
export function mailInput(args: Json): { ok: true; v: { to: string; subject: string; text: string; file: { name: string; kind: string; data: string } | null } } | { ok: false; field: string } {
  const to = typeof args.to === 'string' ? args.to.trim().toLowerCase() : '';
  if (to.length > 254 || !EMAIL.test(to)) return { ok: false, field: 'to' };
  const subject = line(args.subject, 150);
  if (subject.length < 2) return { ok: false, field: 'subject' };
  if (typeof args.text === 'string' && args.text.length > 8000) return { ok: false, field: 'text' };
  const text = body(args.text, 4000);
  let file = null;
  if (args.file != null) {
    const f = args.file; if (!isObj(f)) return { ok: false, field: 'file' };
    const k = KINDS[String(f.kind)]; if (!k) return { ok: false, field: 'file' };
    const base = line(f.name, 120).replace(/[\\/:*?"|]+/g, ' ').replace(/\.(xlsx|pdf)$/i, '').trim() || 'تقرير';
    if (typeof f.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data) || f.data.length > Math.ceil(MAX_FILE / 3) * 4) return { ok: false, field: 'file' };
    let head: Uint8Array;
    try { head = Uint8Array.from(atob(f.data.slice(0, 12)), (c) => c.charCodeAt(0)); } catch { return { ok: false, field: 'file' }; }
    if (!k.magic.every((b, i) => head[i] === b)) return { ok: false, field: 'file' };
    file = { name: base + k.ext, kind: String(f.kind), data: f.data };
  }
  return { ok: true, v: { to, subject, text, file } };
}
/** the mail's html: the text with its lines, escaped, and the system's signature */
export const mailHtml = (subject: string, text: string, from: string) => '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2937"><h2 style="font-size:18px;margin:0 0 8px">' + esc(subject) + '</h2>'
  + (text ? '<p style="margin:0 0 16px;white-space:pre-line">' + esc(text) + '</p>' : '') + '<p style="color:#6b7280;font-size:13px;margin:0">' + esc(from || 'فريق إبتكر كلوب') + ' · إبتكر كلوب</p></div>';

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  const uid = jwt && deps.userId ? await deps.userId(jwt) : null;
  if (!uid) return json(401, { error: 'unauthorized' });
  let args: Json;
  try { args = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!isObj(args)) return json(400, { error: 'bad_json' });
  try {
    const { data: me, error } = await deps.db.from('profiles').select('id, name, email, status').eq('id', uid).maybeSingle();
    if (error) throw new Error('profiles: ' + error.message);
    if (!me || me.status !== 'active') return json(401, { error: 'unauthorized' });
    const input = mailInput(args);
    if (!input.ok) return json(400, { error: 'invalid', field: input.field });
    const key = (deps.env.RESEND_API_KEY ?? '').trim();
    if (!key) return json(503, { error: 'not_configured' });
    const since = new Date(Date.parse(deps.now()) - 3_600_000).toISOString();
    const { data: sent, error: cErr } = await deps.db.from('activity_log').select('id').eq('actor', uid).eq('action', 'share.email').gte('at', since);
    if (cErr) throw new Error('activity_log: ' + cErr.message);
    if ((sent ?? []).length >= PER_HOUR) return json(429, { error: 'too_many' });
    const v = input.v; const reply = typeof me.email === 'string' && EMAIL.test(me.email) ? me.email : null;
    const mail: Json = { from: (deps.env.RESEND_FROM ?? '').trim() || 'alerts@ibtekr.club', to: [v.to], subject: v.subject, html: mailHtml(v.subject, v.text, line(me.name, 80)), text: v.text || v.subject };
    if (reply) mail.reply_to = reply;
    if (v.file) mail.attachments = [{ filename: v.file.name, content: v.file.data }];
    let ok = false;
    try {
      const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(mail), signal: AbortSignal.timeout(25_000) });
      ok = res.ok;
    } catch { ok = false; }
    if (!ok) return json(502, { error: 'refused' });
    try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: uid, action: 'share.email', entity: 'share', entity_id: v.file ? v.file.kind : 'text', new_value: null }); } catch { /* never blocks */ }
    return json(200, { ok: true });
  } catch (e) {
    console.error('share-mail: ' + errText(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return { env, db: service, now: () => new Date().toISOString(), userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; } };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await withVault(realDeps())));
