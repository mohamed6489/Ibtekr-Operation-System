// The auto-reply engine's pure part (phase 6.5, docs/superpowers/plans/2026-11-08-phase-6-5-autoreply.md decisions 6–12): the
// sending settings over their defaults, Cairo's clock and the sending hours, the events out of our tables (an order's status, the
// at-risk / late order, the abandoned checkout, a new sub-order, an approved transfer) → the rules that fire → what to do with
// each (send now / hold for the hours or the cap / skip with a code), the template variables, the WhatsApp text-or-template
// choice by the 24-hour window, and the «no answer in 24 hours → a ticket» follow-ups. No I/O, no logging; the function
// (cs-auto/index.ts) reads the tables and writes the rows. Nothing here ever holds a phone number for longer than a call.
import { normPhone } from './cs-wa.js';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def; };
export const MIN = 60_000; export const HOUR = 3_600_000; export const DAY = 24 * HOUR;
export const WINDOW_MS = DAY; // Meta's customer-service window: free text within 24 hours of the customer's last message

// ---------------------------------------------------------------- the settings (settings «cs».auto over the defaults — decision 6)
export const AFTER_HOURS_TEXT = 'شكرًا لرسالتك 🙏 مواعيد الرد من 9 ص لـ 10 م — هنرد عليك أول ما نفتح.';
export const DEFAULTS = Object.freeze({ live: false, hours: { from: 9, to: 22 }, delayMin: 20, delayMax: 60, daily: { wa1: 250, wa2: 150 }, afterHoursText: AFTER_HOURS_TEXT, cart: { afterMin: 60 }, waLang: 'ar' });
export function settingsOf(raw) {
  const x = isObj(raw) ? raw : {}; const h = isObj(x.hours) ? x.hours : {}; const d = isObj(x.daily) ? x.daily : {}; const c = isObj(x.cart) ? x.cart : {};
  const from = num(h.from, 9, 0, 23); let to = num(h.to, 22, 0, 24); if (to === from) to = from + 24 > 24 ? 24 : 24;
  const delayMin = num(x.delayMin, 20, 20, 600); const delayMax = Math.max(delayMin, num(x.delayMax, 60, 20, 3600));
  return { live: x.live === true, hours: { from, to }, delayMin, delayMax, daily: { wa1: num(d.wa1, 250, 1, 100000), wa2: num(d.wa2, 150, 1, 100000) },
    afterHoursText: typeof x.afterHoursText === 'string' && x.afterHoursText.trim() ? x.afterHoursText.trim().slice(0, 1024) : AFTER_HOURS_TEXT,
    cart: { afterMin: num(c.afterMin, 60, 5, 10080) }, waLang: typeof x.waLang === 'string' && /^[a-z]{2}(_[A-Z]{2})?$/.test(x.waLang) ? x.waLang : 'ar' };
}

// ---------------------------------------------------------------- Cairo's clock and the sending hours
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function cairoClock(nowMs) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  const day = p.year + '-' + p.month + '-' + p.day; const hour = Number(p.hour) % 24; const minute = Number(p.minute);
  const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, minute) - Math.floor(nowMs / MIN) * MIN; // Cairo − UTC, in ms
  return { day, hour, minute, offset };
}
export const inHours = (settings, nowMs) => { const { hour } = cairoClock(nowMs); const { from, to } = settings.hours; return from < to ? hour >= from && hour < to : hour >= from || hour < to; };
// the next moment the hours open (today's «from» when it is still ahead, else tomorrow's)
export function nextOpenAt(settings, nowMs) {
  const c = cairoClock(nowMs); const [y, m, d] = c.day.split('-').map(Number);
  let open = Date.UTC(y, m - 1, d, settings.hours.from, 0) - c.offset;
  if (open <= nowMs) open += DAY;
  return new Date(open).toISOString();
}
export const windowOpen = (lastInAt, nowMs) => { const t = lastInAt ? Date.parse(lastInAt) : NaN; return Number.isFinite(t) && nowMs - t < WINDOW_MS && nowMs >= t - MIN; };

// ---------------------------------------------------------------- the events (our tables → what happened)
// the prototype's status labels → the system's; two are computed from the order's age (block 25 / the notify engine: risk 9–11, late 12+)
export const STATUS_ALIAS = { 'قيد التنفيذ': 'جاري التنفيذ', 'تم الشحن': 'قيد الشحن', 'معلق': 'معلّق' };
export const VIRTUAL_STATUS = ['قابل للتأخير', 'متأخر'];
export const STATUS_CODES = ['جاري التنفيذ', 'معلّق', 'جاهز للشحن', 'قيد الشحن', 'مكتمل', 'ملغي', 'استرجاع', 'فشل', 'قيد الانتظار', 'قابل للتأخير', 'متأخر'];
export const statusTo = (label) => STATUS_ALIAS[String(label ?? '').trim()] ?? String(label ?? '').trim();
const statusCode = (s) => { const i = STATUS_CODES.indexOf(s); return i < 0 ? 'x' : 's' + i; };
const dayOf = (iso) => String(iso ?? '').slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const after = (iso, sinceIso) => !sinceIso || (typeof iso === 'string' && iso > sinceIso);
export const CART_STATUSES = ['قيد الانتظار', 'فشل'];
export const digits = (v) => (v == null ? '' : normPhone(v) || String(v).replace(/\D/g, '')); // the same key as cs_customers.phone

// orders changed since the last tick → a status event each (entity order:<id>, suffix the status code so a rule that is not
// «once» fires again on the next status); every open in-progress order → the at-risk / late virtual status by its age
export function orderEvents(orders, { sinceIso, today, riskFrom = 9, lateFrom = 12 } = {}) {
  const out = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!isObj(o) || o.deleted_at) continue;
    const st = String(o.status ?? '');
    if (after(o.updated_at, sinceIso) && st && !CART_STATUSES.includes(st)) out.push({ type: 'status', to: st, entity: 'order:' + o.id, suffix: statusCode(st), order: o });
    if (st === 'جاري التنفيذ' && today && o.placed_at) {
      const age = daysBetween(dayOf(o.placed_at), today);
      if (age >= lateFrom) out.push({ type: 'status', to: 'متأخر', entity: 'order:' + o.id, suffix: 'late', order: o, age });
      else if (age >= riskFrom) out.push({ type: 'status', to: 'قابل للتأخير', entity: 'order:' + o.id, suffix: 'risk', order: o, age });
    }
  }
  return out;
}
// the abandoned checkout (decision 12): an order that stopped at payment (pending / failed on the site) older than afterMin,
// with no later order from the same number
export function cartEvents(orders, { nowMs, afterMin = 60 } = {}) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => isObj(o) && !o.deleted_at);
  const laterBy = new Map(); // phone digits → latest placed_at of a non-cart order
  for (const o of list) { const st = String(o.status ?? ''); if (CART_STATUSES.includes(st)) continue; const k = digits(o.customer_phone); if (!k) continue; const t = Date.parse(o.placed_at); if (Number.isFinite(t) && t > (laterBy.get(k) ?? -1)) laterBy.set(k, t); }
  const out = [];
  for (const o of list) {
    const st = String(o.status ?? ''); if (!CART_STATUSES.includes(st)) continue;
    const t = Date.parse(o.placed_at); if (!Number.isFinite(t) || nowMs - t < afterMin * MIN) continue;
    const k = digits(o.customer_phone); if (k && (laterBy.get(k) ?? -1) > t) continue;
    out.push({ type: 'cart', entity: 'cart:' + o.id, order: o });
  }
  return out;
}
export const subEvents = (subs, sinceIso) => (Array.isArray(subs) ? subs : []).filter((s) => isObj(s) && s.vendor_id && after(s.updated_at, sinceIso)).map((s) => ({ type: 'sub', entity: 'sub:' + s.id, sub: s, vendorId: String(s.vendor_id) }));
export const transferEvents = (ws, sinceIso) => (Array.isArray(ws) ? ws : []).filter((w) => isObj(w) && w.vendor_id && w.status === 'approved' && after(w.synced_at, sinceIso)).map((w) => ({ type: 'transfer', entity: 'transfer:' + w.id, withdrawal: w, vendorId: String(w.vendor_id) }));

// ---------------------------------------------------------------- the rules
export const CHANNEL_LABEL = { wa1: 'واتساب 1', wa2: 'واتساب 2', messenger: 'ماسنجر', instagram: 'إنستجرام' };
export const CONSENT_LABEL = { 'الرد الآلي': 'auto', 'التسويق': 'marketing', 'العروض': 'marketing' };
// a condition [field, op, value] against the event's context (the caller fills the fields it knows; an unknown op never passes)
export function condOk(cond, ctx) {
  if (!Array.isArray(cond) || cond.length !== 3) return false;
  const [field, op, value] = cond.map((x) => String(x ?? '').trim()); const c = isObj(ctx) ? ctx : {}; const v = c[field];
  switch (op) {
    case '=': return String(v ?? '') === value;
    case '!=': return String(v ?? '') !== value;
    case 'أكبر من أو يساوي': return Number(v) >= Number(value);
    case 'أكبر من': return Number(v) > Number(value);
    case 'أقل من أو يساوي': return Number(v) <= Number(value);
    case 'أقل من': return Number(v) < Number(value);
    case 'يحتوي': return String(v ?? '').includes(value);
    case 'موافق على': return Array.isArray(c.consents) && c.consents.includes(CONSENT_LABEL[value] ?? value);
    case 'فيه': return Array.isArray(c.has) && c.has.includes(value);
    case 'مفيهوش': return !(Array.isArray(c.has) && c.has.includes(value));
    default: return false;
  }
}
export function ruleFires(rule, ev, ctx) {
  if (!isObj(rule) || !rule.enabled || !isObj(ev) || rule.event !== ev.type) return false;
  if (ev.type === 'status' && statusTo(rule.event_to) !== ev.to) return false;
  const conds = Array.isArray(rule.conds) ? rule.conds : [];
  return conds.every((c) => condOk(c, ctx));
}
// the run-log entity of a rule on an event: «once» rules key on the entity itself, the others on the entity + what changed
export const entityFor = (rule, ev) => (rule.once || !ev.suffix ? ev.entity : ev.entity + '-' + ev.suffix);

// ---------------------------------------------------------------- the text
export const VAR = /\{([^{}]+)\}/g;
export function templateVars(text) { const out = []; String(text ?? '').replace(VAR, (_, k) => { if (!out.includes(k)) out.push(k); return _; }); return out; }
export function fill(text, vars) {
  const missing = []; const v = isObj(vars) ? vars : {};
  const t = String(text ?? '').replace(VAR, (m, k) => { const x = v[k]; if (x == null || x === '') { if (!missing.includes(k)) missing.push(k); return m; } return String(x); });
  return { text: t, missing };
}
export const money = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString('en-US') + ' ج.م' : '');
export const arDate = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(t)) : ''; };
// the variables of an event out of what the function loaded (decision 10): a missing one leaves the text unsent
export function varsFor(ev, ctx = {}) {
  const o = isObj(ev.order) ? ev.order : {}; const s = isObj(ev.sub) ? ev.sub : {}; const w = isObj(ev.withdrawal) ? ev.withdrawal : {};
  const first = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';
  return {
    'اسم_العميل': first(ctx.customerName ?? o.customer_name), 'رقم_الأوردر': o.number ? String(o.number) : '', 'الإجمالي': money(o.total),
    'رابط_التتبع': ctx.trackingUrl ?? '', 'ميعاد_الشحن': ctx.shipDate ?? '', 'اسم_المبتكر': ctx.vendorName ?? '',
    'رقم_الأوردر_الفرعي': s.woo_order_id ? String(s.woo_order_id) : '', 'المنتج': ctx.productName ?? '', 'ميعاد_التسليم': ctx.deliveryDate ?? '',
    'المبلغ': money(w.amount), 'أرقام_الأوردرات': ctx.orderNumbers ?? '', 'رابط_السلة': ctx.cartUrl ?? '', 'كود_الخصم': '', 'لينك_الدفع': '',
  };
}
export const withOptOut = (t) => (/إيقاف/.test(t) ? t : String(t).trim() + '\n\nاكتب «إيقاف» لو مش عايز رسايل عروض.');

// ---------------------------------------------------------------- how a WhatsApp / Messenger send goes out
// wa1 (Meta Cloud API): free text inside the 24-hour window, else the approved template (owner's decision 1); Messenger /
// Instagram: inside the window only (decision 4); wa2 (the bridge): the bridge sends whatever is queued
export function sendMode({ channel, lastInAt, template, nowMs }) {
  if (channel === 'wa2') return 'text';
  if (windowOpen(lastInAt, nowMs)) return 'text';
  if (channel === 'wa1' && isObj(template) && typeof template.wa_template === 'string' && template.wa_template) return 'template';
  return null;
}
export const templateBody = (waId, name, lang, params) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'template',
  template: { name, language: { code: lang || 'ar' }, components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text).slice(0, 1024) })) }] : [] } });
export const paceGap = (settings, rand = Math.random()) => Math.round((settings.delayMin + (settings.delayMax - settings.delayMin) * Math.min(1, Math.max(0, rand))) * 1000);
export const dueAfter = (rule, settings, nowMs) => { const t = nowMs + Math.max(0, Number(rule.delay_min) || 0) * MIN; return inHours(settings, t) ? new Date(t).toISOString() : nextOpenAt(settings, t); };

// what to do for a rule that fired on an event: the row of cs_auto_runs to write (and the text / mode when it sends)
// ctx: { channel, lastInAt, customer: { blocked, merged, autoConsent, consent }, vars, sentToday, cap }
export function decide({ rule, template, ev, ctx, settings, nowMs }) {
  const skip = (code) => ({ result: 'skipped', code });
  if (!settings.live) return skip('off');
  if (rule.action === 'ticket') return { result: 'ticket', code: null };
  if (rule.action === 'assign') return rule.role_id ? { result: 'assigned', code: null } : skip('no_role');
  if (rule.action === 'tag') return rule.tag ? { result: 'tagged', code: null } : skip('no_tag');
  if (!isObj(template)) return skip('no_template');
  if (!template.active) return skip('inactive');
  const c = isObj(ctx.customer) ? ctx.customer : {};
  if (c.blocked) return skip('blocked');
  if (c.merged) return skip('merged');
  if (template.lib === 'vendors' ? ctx.channel !== 'wa2' : ctx.channel === 'wa2') return skip('channel');
  if (template.lib === 'customers' && c.autoConsent === false) return skip('consent');
  if (ev.type === 'cart' && c.consent === false) return skip('consent'); // a cart message is marketing: the marketing consent too
  if (!ctx.channel) return skip('no_channel');
  const filled = fill(template.body, ctx.vars);
  if (filled.missing.length) return skip('missing_var');
  const mode = sendMode({ channel: ctx.channel, lastInAt: ctx.lastInAt, template, nowMs });
  if (!mode) return skip('window');
  const text = ev.type === 'cart' ? withOptOut(filled.text) : filled.text;
  const due = dueAfter(rule, settings, nowMs);
  if (Number(ctx.sentToday) >= Number(ctx.cap)) return { result: 'held', code: 'cap', dueAt: nextOpenAt(settings, nowMs), text, mode };
  if (Date.parse(due) > nowMs + MIN) return { result: 'held', code: Number(rule.delay_min) > 0 ? 'delay' : 'hours', dueAt: due, text, mode };
  return { result: 'sent', code: mode, text, mode, params: mode === 'template' ? (Array.isArray(template.wa_vars) ? template.wa_vars : []).map((k) => (ctx.vars ?? {})[k] ?? '') : [] };
}
// the «no answer in 24 hours → a ticket» follow-ups (decision 7): a sent run older than a day whose conversation got no message in after it
export function silentFollowups(runs, rulesById, convsById, nowMs) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!isObj(r) || r.result !== 'sent' || !r.conversation_id) continue;
    const rule = rulesById[String(r.rule_id)]; if (!rule || !rule.ticket_if_silent) continue;
    const at = Date.parse(r.at); if (!Number.isFinite(at) || nowMs - at < DAY) continue;
    const conv = convsById[String(r.conversation_id)]; const lastIn = conv && conv.last_in_at ? Date.parse(conv.last_in_at) : NaN;
    if (Number.isFinite(lastIn) && lastIn > at) continue;
    out.push({ run: r, rule, entity: String(r.entity) + '-silent' });
  }
  return out;
}
export const afterHoursEntity = (convId, day) => 'conv:' + String(convId) + '-' + String(day).replace(/-/g, '');
export const firstEntity = (convId) => 'conv:' + String(convId);
// a run-log code out of a Graph / network failure (codes only — never a text)
export const failCode = (e) => String((e && (e.code || e.name)) || 'failed').replace(/[^a-z0-9_:-]/gi, '').toLowerCase().slice(0, 40) || 'failed';
