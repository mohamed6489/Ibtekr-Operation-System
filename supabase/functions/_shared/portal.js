// The maker portal (phase 13 T4, docs/superpowers/plans/2026-11-09-phase-13-leftovers.md decision 10): the pure part of the Edge
// Function `portal` — the request shapes, the password rules (the server's copy of block 06's passwordIssues), the maker's order
// lines with the delay rule of block 29 (late after 11 days, at risk from 9 to 11) on the order's age, the account figures («الصافي»:
// Dokan's balance − deposits − transport ± the other moves), the masked bank account, the reset e-mail. No I/O; tested from node
// (tests/functions/portal.test.mjs). Nothing here ever carries a customer's phone or another maker's data: the function filters by
// the token's vendor id before anything reaches these helpers.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const TOKEN_TTL_S = 12 * 3600; // a portal token lives 12 hours
export const RESET_TTL_MIN = 30;
export const ORDERS_DAYS = 90; // the lines the maker sees: orders placed in the last 90 days
export const LOCK_TRIES = 5;
export const LOCK_MINUTES = 15;
export const DONE_STATUSES = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
export const OPEN_SUB = ['processing', 'pending', 'on-hold']; // block 29's OPEN: a sub-order still running
export const PORTAL_ACTOR = { name: 'بوابة المبتكر', role: 'بوابة المبتكر' };
export const DEFAULT_PORTAL_URL = 'https://operation-system.ibtekr.club/portal.html';

/** the password rules of block 06 (passwordIssues), in the same words */
export function passwordIssues(p) {
  const s = String(p ?? ''); const out = [];
  if (s.length < 8) out.push('8 حروف على الأقل');
  if (!/[A-Za-z]/.test(s)) out.push('حرف إنجليزي');
  if (!/[0-9]/.test(s)) out.push('رقم');
  if (/[\s ]/.test(s)) out.push('من غير مسافات');
  if (s.length > 128) out.push('أقصى طول 128 حرف');
  return out;
}

/** { user, password } → trimmed, lower-cased user; { error, field } when a part is missing or absurd */
export function loginInput(args) {
  const a = isObj(args) ? args : {};
  const user = typeof a.user === 'string' ? a.user.trim().toLowerCase() : '';
  if (!user || user.length > 160) return { error: 'bad_request', field: 'user' };
  const password = typeof a.password === 'string' ? a.password : '';
  if (!password || password.length > 128) return { error: 'bad_request', field: 'password' };
  return { user, password };
}

/** whole days between the order's placing and now (never negative) */
export function ageDays(placedAt, nowIso) {
  const a = Date.parse(placedAt ?? ''), b = Date.parse(nowIso ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}
/** block 29's rule on an open line: late after 11 days, at risk from 9 to 11, else ok; a closed line is never late */
export function deliveryState(age, open) {
  if (!open) return 'ok';
  if (age > 11) return 'late';
  if (age >= 9) return 'risk';
  return 'ok';
}

/** the maker's lines: his order_items joined to their order and sub-order — no customer field is read or passed on */
export function makerLines({ items, orders, subs, now }) {
  const byOrder = new Map((orders ?? []).filter(isObj).map((o) => [String(o.id), o]));
  const bySub = new Map((subs ?? []).filter(isObj).map((s) => [String(s.id), s]));
  const out = [];
  for (const it of items ?? []) {
    if (!isObj(it) || it.removed) continue;
    const o = byOrder.get(String(it.order_id)); if (!o || o.deleted_at) continue;
    const s = it.sub_order_id != null ? bySub.get(String(it.sub_order_id)) : null;
    const done = DONE_STATUSES.includes(String(o.status ?? ''));
    const open = !done && (s ? OPEN_SUB.includes(String(s.woo_status ?? '')) : true);
    const age = ageDays(o.placed_at, now);
    out.push({ order: String(o.number ?? o.id), n: s && s.woo_order_id != null ? String(s.woo_order_id) : null, prod: String(it.name ?? ''), qty: num(it.qty) || 1, total: round2(num(it.total)),
      ss: String(it.status ?? ''), exp: it.expected_at ? String(it.expected_at).slice(0, 10) : null, open, status: String(o.status ?? ''), delivery: deliveryState(age, open), age, placed: String(o.placed_at ?? '').slice(0, 10) });
  }
  return out.sort((a, b) => (a.placed < b.placed ? 1 : a.placed > b.placed ? -1 : 0));
}

/** «الصافي» of the accounts page for one maker: Dokan's balance − deposits («عربون») − transport («مواصلات») ± the other moves */
export function makerLedger({ balance, moves }) {
  let deposits = 0, transport = 0, other = 0;
  for (const m of moves ?? []) {
    if (!isObj(m) || m.voided_at) continue;
    const a = num(m.amount); if (a <= 0) continue;
    const withdraw = m.direction === 'withdraw';
    if (m.kind === 'عربون') deposits += withdraw ? a : -a; // a deposit paid ahead lowers what he is owed; a returned one gives it back
    else if (m.kind === 'مواصلات') transport += withdraw ? a : -a;
    else other += withdraw ? -a : a;
  }
  const dokan = round2(num(balance));
  const net = round2(dokan - deposits - transport + other);
  return { dokan, deposits: round2(deposits), transport: round2(transport), other: round2(other), net, status: net > 0 ? 'ليك' : net < 0 ? 'عليك' : 'متصفّي' };
}

/** the last 4 of a number, the rest hidden (block 06's mask) */
export function maskTail(v) {
  const s = String(v ?? '').replace(/\s/g, ''); if (!s) return null;
  return (s.length > 8 ? '•••• •••• •••• ' : '•••• ') + s.slice(-4);
}
/** the bank account as the maker may see it: the method and the holder in clear, every number masked */
export function maskedBank(b) {
  if (!isObj(b)) return null;
  return { method: String(b.method ?? 'bank'), holder: b.holder ?? null, bankName: b.bank_name ?? null, iban: maskTail(b.iban), account: maskTail(b.account_number), wallet: maskTail(b.wallet) };
}

/** the note of a bank request, cleaned and capped */
export const bankNote = (v) => clean(v, 500);

/** the reset link the e-mail carries (the token in the hash: never sent to the server as a query string) */
export function resetLink(portalUrl, token) {
  const base = String(portalUrl ?? '').trim() || DEFAULT_PORTAL_URL;
  return base.split('#')[0] + '#portal-reset/' + token;
}
/** the reset e-mail: a subject and a plain body — no username, no password, the link only */
export function resetEmail(name, link) {
  const who = clean(name, 80) || 'مبتكر إبتكر';
  return { subject: 'استرجاع باسورد بوابة المبتكر — إبتكر', body: 'أهلاً ' + who + '،\nطلبت استرجاع الباسورد بتاع بوابة المبتكر. افتح اللينك ده خلال ' + RESET_TTL_MIN + ' دقيقة واختار باسورد جديد:\n' + link + '\n\nلو مش انت اللي طلبت، تجاهل الرسالة — الباسورد الحالي زي ما هو.' };
}

/** the token's claims */
export function tokenClaims(vendorId, scope, nowSec) {
  const iat = Math.floor(nowSec);
  return { sub: String(vendorId), scope: scope === 'first' ? 'first' : 'full', iat, exp: iat + TOKEN_TTL_S };
}
/** a reset token as the database makes it: 64 hex characters */
export const resetTokenOk = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);
