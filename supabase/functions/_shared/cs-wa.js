// WhatsApp 1 / 2 through the wa-bridge service (phase 6.4 decisions 21–22) and the campaigns' sending (6.3 decision 23): the pure part
// cs-wa uses — the phone of a WhatsApp id and back, the bridge's bodies checked, the campaign's text and pacing. No I/O; tested from
// node (tests/functions/cs-wa.test.mjs) and used by supabase/functions/cs-wa.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const cut = (v, n) => Array.from(String(v ?? '').replace(LONE, '')).slice(0, n).join('');
export const CHANNELS = ['wa1', 'wa2'];
export const STATES = ['offline', 'qr', 'connecting', 'connected', 'logged_out'];
export const MAX_TEXT = 4000;
export const CLAIM_MS = 2 * 60 * 1000; // an outgoing message / recipient handed to the bridge is its own for two minutes
export const STOP_RATE = 0.02; // block 19 CS.STOP_RATE — failures over 2% after STOP_MIN sends pause the campaign
export const STOP_MIN = 20;
export const OPT_OUT = 'اكتب «إيقاف» لو مش عايز رسايل عروض.'; // block 19 CS.OPT_OUT, the same words

// 0034 norm_phone / block 19 normPhone: Arabic-Indic digits → ASCII, digits only, 0020… / 20… (12 digits) → local, 1xxxxxxxxx → 01xxxxxxxxx
export function normPhone(v) {
  const AR = '٠١٢٣٤٥٦٧٨٩'; const FA = '۰۱۲۳۴۵۶۷۸۹';
  let d = String(v ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(AR.includes(c) ? AR.indexOf(c) : FA.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d[0] === '1') d = '0' + d;
  return d;
}
// a person's WhatsApp id → our phone (groups, broadcasts and status updates are not people: null)
export function phoneOfJid(jid) {
  const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid ?? ''));
  if (!m) return null;
  const p = normPhone(m[1]);
  return /^\d{6,15}$/.test(p) ? p : null;
}
// our phone → the WhatsApp id the bridge sends to (an Egyptian local 01xxxxxxxxx → 201xxxxxxxxx)
export function jidOfPhone(phone) {
  const p = normPhone(phone); if (!/^\d{6,15}$/.test(p)) return null;
  const intl = p.length === 11 && p.startsWith('01') ? '2' + p : p;
  return intl + '@s.whatsapp.net';
}

const KIND_LABEL = { image: '[صورة]', video: '[فيديو]', audio: '[رسالة صوتية]', document: '[ملف]', sticker: '[ستيكر]', location: '[موقع]', contact: '[جهة اتصال]', other: '[رسالة]' };
// the bridge's «inbound» body → a checked event, or null
export function parseInbound(b) {
  if (!isObj(b) || !CHANNELS.includes(b.channel)) return null;
  const phone = phoneOfJid(b.jid); if (!phone) return null;
  const id = str(b.id, 200); if (!/^[A-Za-z0-9_.:-]{4,200}$/.test(id)) return null;
  const kind = typeof b.kind === 'string' && KIND_LABEL[b.kind] ? b.kind : 'text';
  const t = cut(b.text, MAX_TEXT).replace(/\u0000/g, '').trim();
  const text = t || (kind !== 'text' ? KIND_LABEL[kind] : '') || '[رسالة]';
  const at = Number.isFinite(Number(b.at)) && Number(b.at) > 0 ? Number(b.at) : null;
  return { channel: b.channel, jid: String(b.jid), phone, id, fromMe: b.fromMe === true, name: cut(b.name, 120).trim() || null, kind, text, at: at == null ? null : at < 1e11 ? at * 1000 : at };
}
// the bridge's «state» body → a checked state, or null; the QR is an SVG the bridge drew — kept only when it is one, no scripts
export function parseState(b) {
  if (!isObj(b) || !CHANNELS.includes(b.channel) || !STATES.includes(b.status)) return null;
  const svg = typeof b.qr_svg === 'string' && b.qr_svg.length <= 60000 && /^<svg[\s>]/.test(b.qr_svg.trim()) && !/<script|on\w+\s*=|javascript:|<foreignObject/i.test(b.qr_svg) ? b.qr_svg.trim() : null;
  const phone = b.phone ? normPhone(b.phone) : null;
  return { channel: b.channel, status: b.status, qr_svg: b.status === 'qr' ? svg : null, phone: phone && /^\d{6,15}$/.test(phone) ? phone : null };
}
// a customer's message asking to stop the campaigns («إيقاف» / «stop»)
export const isOptOut = (text) => /^\s*(إيقاف|ايقاف|stop|unsubscribe)\s*[.!]?\s*$/i.test(String(text ?? ''));

// the campaign's text for one customer: {اسم_العميل} → the first name, {كود_الخصم} → the code; the opt-out line added when missing
export function campaignText(body, { name, code } = {}) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || '';
  const t = String(body ?? '').replace(/\{([^{}]+)\}/g, (m, k) => (k === 'اسم_العميل' ? first : k === 'كود_الخصم' ? String(code ?? '') : m)).trim();
  return /إيقاف/.test(t) ? t : t + '\n\n' + OPT_OUT;
}
// Cairo's midnight before `nowIso`, as an ISO instant (Egypt changes its offset in summer: read it, never assume +2)
export function cairoDayStart(nowIso) {
  const now = new Date(nowIso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000; // Cairo − UTC in ms
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset).toISOString();
}
// may the campaign send its next message now? (the day's cap, the pause after the last one)
export function paceOk({ sentToday, cap, lastAt, minDelayS, nowMs }) {
  if (sentToday >= cap) return { ok: false, reason: 'cap' };
  if (lastAt != null && nowMs - lastAt < minDelayS * 1000) return { ok: false, reason: 'delay', waitMs: minDelayS * 1000 - (nowMs - lastAt) };
  return { ok: true };
}
// pause the campaign when the failures run over STOP_RATE after STOP_MIN sends
export const shouldStop = ({ sent = 0, failed = 0 }) => sent + failed >= STOP_MIN && failed / (sent + failed) > STOP_RATE;
// constant-time comparison of the bridge's secret
export function sameSecret(given, want) {
  const a = String(given ?? ''); const b = String(want ?? '');
  if (!b || b.length < 32) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= b.charCodeAt(i) ^ (a.charCodeAt(i) || 0);
  return diff === 0;
}
