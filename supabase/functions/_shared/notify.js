// notify — the pure engine of the notifications (phase 11, decision 16). The settings row «notif» holds the prototype's shapes
// (the v6 settings block): the alert types `notif` ([group, [[name, duration, channels, recipients, on, count, every, at, days,
// weekday], …]]), `escalations`, `quiet`, the role matrix `alertRoles` (a code per role column: R = يستلم, S = يشوف بس, N = لا —
// block 23), `alertOverrides` (a member → a code per source), `digests`, `roleDigests`, `roleDigestAt`, `accAlerts`, `subsAlert`,
// `whatsappTemplate`. The function (notify/index.ts) reads the live tables into items; this module decides what to write:
// which (source × entity × target) rows become `alerts` rows now (first time at once, repeats by the type's count / cadence at
// its Cairo clock time), which escalate (the time passed with no action: no alert_reads row and the entity still open), which
// are resolved (gone from the items), which external sends go out (e-mail / WhatsApp by the type's channels and the member's
// contact; held in the quiet hours; WhatsApp capped per day), and the digests (a role's daily summary, the custom reports).
// Nothing here knows a phone number's text or a message's text beyond the title and body it builds; nothing is logged.

export const ROLE_ORDER = Object.freeze(['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'viewer']);
const RANK = { N: 0, P: 1, F: 2 };
const H = 3600_000; const D = 24 * H;

// a source: the bell's key, its section (the alert's kind), the v6 type row it follows, the permission its receivers need
// (the role's permissions jsonb — the admin always passes), the default matrix column string of block 23, the escalation rule name
const S = (key, kind, type, perm, def, esc = null, hash = null) => Object.freeze({ key, kind, type, perm, def, esc, hash });
export const SOURCES = Object.freeze([
  S('customers.late', 'customers', 'أوردر متأخر — محتاج متابعة مع العميل', ['orders.view', 'P'], 'RRRNSN', null, 'orders'),
  S('customers.follow', 'customers', 'أوردر معلّق — محتاج متابعة', ['orders.view', 'P'], 'RRRNNN', null, 'orders'),
  S('customers.unconf', 'customers', 'غير مؤكد من العميل', ['orders.view', 'P'], 'RRRNNN', 'غير مؤكد من العميل', 'orders'),
  S('customers.waiting', 'customers', 'في انتظار رد العميل', ['orders.view', 'P'], 'RSRNNN', null, 'orders'),
  S('vendors.late', 'vendors', 'مبتكر متأخر', ['vendors.view', 'P'], 'RRSNRN', 'مبتكر متأخر', 'orders'),
  S('vendors.risk', 'vendors', 'مبتكر قابل للتأخير (آخر 3 أيام من مدة التصنيع)', ['vendors.view', 'P'], 'RSNNRN', null, 'orders'),
  S('vendors.daily', 'vendors', 'المتابعة اليومية للمبتكر', ['vendors.view', 'P'], 'RSNNRN', null, 'vendors'),
  S('vendors.weekly', 'vendors', 'التقرير الأسبوعي للمبتكر', ['vendors.view', 'P'], 'RSNSRN', null, 'vendors'),
  S('vendors.contract', 'vendors', 'عقد مبتكر بينتهي', ['vendors.view', 'P'], 'RNNNNN', null, 'vendors'),
  S('accounts.payroll', 'accounts', 'مرتبات الموظفين — قبل يوم الصرف', ['accounts.view', 'F'], 'RNNRNN', null, 'hr-payroll'),
  S('accounts.vendors', 'accounts', 'كشف حساب المبتكرين', ['vendors.view', 'P'], 'RSNRRN', null, 'accounts'),
  S('accounts.subs', 'accounts', 'اشتراك قرب يخلص', ['accounts.view', 'P'], 'RNNRNN', null, 'accounts'),
  S('accounts.subs_expired', 'accounts', 'اشتراك خلص من غير تجديد', ['accounts.view', 'P'], 'RNNRNN', null, 'accounts'),
  S('tasks.urgent', 'tasks', 'تذكرة عاجلة / عالية', ['tickets.view', 'P'], 'RRRRRS', 'تذكرة عاجلة بدون رد', 'tickets'),
  S('tasks.high', 'tasks', 'تذكرة عاجلة / عالية', ['tickets.view', 'P'], 'RRRRRS', null, 'tickets'),
  S('tasks.late', 'tasks', 'تذكرة متأخرة عن موعد المتابعة', ['tickets.view', 'P'], 'RRRRRS', null, 'tickets'),
  S('messages.waiting', 'messages', 'رسالة مستنية ردنا', ['cs.view', 'P'], 'RSRNNN', null, 'cs'),
  S('messages.late', 'messages', 'رسالة متأخرة عن الرد', ['cs.view', 'P'], 'RRRNNN', null, 'cs'),
  S('messages.channels', 'messages', 'فشل مزامنة منصة', null, 'RRRNNN', 'فشل مزامنة منصة', 'cs-channels'),
  S('team.req', 'team', 'طلب إجازة / سُلفة / تصحيح', null, 'RRNNNN', null, 'hr-requests'),
  S('team.ot', 'team', 'وقت إضافي محتاج تأكيد', null, 'RRNNNN', 'وقت إضافي بدون تأكيد', 'hr-overtime'),
  S('team.meet', 'team', 'ميتنج فردي اتحدد', null, 'RRNNNN', null, 'hr'),
  S('stock.cons', 'stock', 'قاعدة أكتر من اللازم (تجميع / تصوير)', ['inventory.view', 'P'], 'RRNNNN', null, 'inventory'),
  S('stock.photo', 'stock', 'قاعدة أكتر من اللازم (تجميع / تصوير)', ['inventory.view', 'P'], 'RRNNNN', null, 'inventory'),
  S('stock.ret', 'stock', 'مرتجع بانتظار الفحص', ['inventory.view', 'P'], 'RRNNSN', null, 'inventory'),
  S('delivery.waybills', 'delivery', 'بوليصة بوسطة مطلوبة', ['orders.view', 'P'], 'RRNNNN', null, 'orders'),
  S('delivery.late', 'delivery', 'بوليصة متأخرة (أكتر من 24 ساعة)', ['orders.view', 'P'], 'RRNNNN', null, 'orders'),
  S('delivery.daily', 'delivery', 'ملخص التوصيل اليومي', ['orders.view', 'P'], 'RRNNNN', null, 'orders'),
  S('docs.expiring', 'docs', 'ورقة رسمية بتنتهي', null, 'RNNNNN', null, 'settings-docs'),
]);
export const sourceOf = (key) => SOURCES.find((s) => s.key === key) || null;

// the type rows: name → { on, channels, vendorWa, count, every, at, days, weekday }. DEFAULT_TYPES = the v6 prototype's rows (the
// settings page starts from them; an empty «notif» row means these); BUILT_IN = the sources the v6 has no row for. A row saved
// from the page under the same name replaces the default.
export const DEFAULT_TYPES = Object.freeze([
  ['عملاء', [['أوردر متأخر — محتاج متابعة مع العميل', 'حتى الإغلاق', 'داخل السيستم + واتساب', 'خدمة العملاء', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['أوردر معلّق — محتاج متابعة', '7 أيام', 'داخل السيستم + واتساب', 'خدمة العملاء', true, '3 مرات', 'كل 24 ساعة'], ['غير مؤكد من العميل', '3 أيام', 'داخل السيستم', 'خدمة العملاء', true], ['في انتظار رد العميل', '2 يوم', 'داخل السيستم', 'خدمة العملاء', true]]],
  ['المبتكرين', [['المتابعة اليومية للمبتكر', 'حتى الإغلاق', 'داخل السيستم + واتساب + إيميل', 'متابعة المبتكرين + المبتكر (واتساب)', true, 'لحد ما يتحل', 'كل 24 ساعة', '10:00 ص'], ['مبتكر قابل للتأخير (آخر 3 أيام من مدة التصنيع)', 'حتى الإغلاق', 'داخل السيستم', 'متابعة المبتكرين', true], ['عقد مبتكر بينتهي', '30 يوم', 'داخل السيستم + إيميل', 'أدمن', true], ['التقرير الأسبوعي للمبتكر', '7 أيام', 'داخل السيستم + واتساب', 'متابعة المبتكرين + الحسابات + المبتكر (واتساب)', true, 'مرة واحدة', 'أسبوعيًا', '10:00 ص', null, 'الأحد']]],
  ['مهام', [['تذكرة عاجلة / عالية', 'حتى الحل', 'داخل السيستم + واتساب', 'المسؤول عن التذكرة', true, 'لحد ما يتحل', 'كل 4 ساعات'], ['تذكرة متأخرة عن موعد المتابعة', 'حتى الحل', 'داخل السيستم', 'المسؤول + خدمة العملاء', true], ['مراجعة تنشيط مبتكر', 'حتى القرار', 'داخل السيستم', 'أدمن', true], ['فشل مزامنة منصة', 'حتى الإصلاح', 'داخل السيستم + إيميل', 'أدمن', true], ['ملخص يومي', '1 يوم', 'إيميل', 'الكل', true]]],
  ['الفريق', [['طلب إجازة / سُلفة / تصحيح', 'حتى القرار', 'داخل السيستم', 'المدير المباشر', true], ['وقت إضافي محتاج تأكيد', '24 ساعة ثم تصعيد', 'داخل السيستم', 'المدير المباشر ← الأدمن', true], ['ميتنج فردي اتحدد', 'حتى الميعاد', 'داخل السيستم + إيميل', 'العضو + الأدمن', true]]],
  ['الحسابات', [['مرتبات الموظفين — قبل يوم الصرف', 'حتى الدفع', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['كشف حساب المبتكرين', '7 أيام', 'داخل السيستم + واتساب', 'الحسابات + المبتكر (واتساب)', true, 'مرة واحدة', 'أيام محددة من الشهر', '12:00 ص', [16, 'last']], ['اشتراك قرب يخلص', 'حتى التجديد', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['اشتراك خلص من غير تجديد', 'حتى التجديد', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة']]],
  ['المخزن', [['اتحجزت قطعة من المخزن', '3 أيام', 'داخل السيستم', 'أدمن + مسؤول الأوردرات', true], ['قاعدة أكتر من اللازم (تجميع / تصوير)', 'حتى الإجراء', 'داخل السيستم', 'المخزن + العمليات', true], ['مرتجع بانتظار الفحص', 'حتى الفحص', 'داخل السيستم', 'المخزن', true]]],
  ['التوصيل', [['بوليصة بوسطة مطلوبة', 'حتى التنفيذ', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل', true, 'مرة واحدة', 'كل ساعة'], ['بوليصة متأخرة (أكتر من 24 ساعة)', 'حتى التنفيذ', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل + العمليات', true, 'لحد ما يتحل', 'كل 4 ساعات'], ['ملخص التوصيل اليومي', '1 يوم', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل', true, 'مرة واحدة', 'كل 24 ساعة', '9:00 ص']]],
]);
const BUILT_IN = Object.freeze({
  'مبتكر متأخر': ['حتى الإغلاق', 'داخل السيستم', 'متابعة المبتكرين', true, 'لحد ما يتحل', 'كل 24 ساعة', '10:00 ص'],
  'رسالة مستنية ردنا': ['حتى الرد', 'داخل السيستم', 'خدمة العملاء', true],
  'رسالة متأخرة عن الرد': ['حتى الرد', 'داخل السيستم', 'خدمة العملاء', true, 'لحد ما يتحل', 'كل ساعة'],
  'ورقة رسمية بتنتهي': ['30 يوم', 'داخل السيستم + إيميل', 'أدمن', true, 'لحد ما يتحل', 'كل 24 ساعة', '10:00 ص'],
});
const parts = (s) => String(s || '').split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
export function parseRule(row) {
  const [, , ch, to, on, count, every, at, days, weekday] = row;
  const c = parts(ch);
  return { on: on !== false, channels: { system: true, email: c.includes('إيميل'), whatsapp: c.includes('واتساب') }, vendorWa: parts(to).includes('المبتكر (واتساب)'),
    count: countOf(count), every: every || 'كل 24 ساعة', at: parseAt(at), days: Array.isArray(days) ? days : null, weekday: weekday || 'الأحد' };
}
export function typeRules(notif) {
  const out = new Map();
  for (const [name, row] of Object.entries(BUILT_IN)) out.set(name, parseRule([name, ...row]));
  for (const [, rows] of DEFAULT_TYPES) for (const r of rows) out.set(r[0], parseRule(r));
  for (const g of Array.isArray(notif && notif.notif) ? notif.notif : []) {
    const rows = Array.isArray(g) && Array.isArray(g[1]) ? g[1] : [];
    for (const r of rows) if (Array.isArray(r) && typeof r[0] === 'string') out.set(r[0], parseRule(r));
  }
  return out;
}
export const ruleFor = (notif, key) => { const s = sourceOf(key); return s ? typeRules(notif).get(s.type) || null : null; };
export const countOf = (c) => (!c || c === 'مرة واحدة' ? 1 : c === 'لحد ما يتحل' ? Infinity : parseInt(String(c), 10) || 1);
// '10:00 ص' / '12:00 م' → 0–23 (12:00 ص = midnight, the default)
export function parseAt(at) {
  const m = /^(\d{1,2}):(\d{2})\s*(ص|م)$/.exec(String(at || '').trim()); if (!m) return 0;
  let h = Number(m[1]) % 12; if (m[3] === 'م') h += 12; return h;
}
export const everyHours = (e) => (/^كل ساعة/.test(e || '') ? 1 : /^كل \d+ ساع/.test(e || '') ? parseInt(String(e).replace(/[^0-9]/g, ''), 10) || 24 : 24);
const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const jsDay = (name) => (WEEKDAYS.indexOf(name) + 6) % 7;
const dayOf = (iso) => new Date(Date.parse(iso + 'T00:00:00Z')).getUTCDay();
const lastOfMonth = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export function calendarDue(rule, day) {
  if (rule.every === 'أسبوعيًا') return dayOf(day) === jsDay(rule.weekday);
  if (rule.every === 'أيام محددة من الشهر') { const d = Number(day.slice(8, 10)); const L = lastOfMonth(day); return (rule.days || [16, 'last']).some((x) => (x === 'last' ? d === L : Number(x) === d || (Number(x) > L && d === L))); }
  return true;
}
const isCalendar = (rule) => rule.every === 'أسبوعيًا' || rule.every === 'أيام محددة من الشهر';
const isDaily = (rule) => rule.every === 'كل 24 ساعة' || isCalendar(rule);
const hourOf = (time) => Number(String(time || '00:00').slice(0, 2));

// Cairo's offset from UTC at this tick (ms), from the Cairo day and time the function computed for `now` — no Intl here
export const cairoOffset = (cairo, nowMs) => Math.round((Date.parse(cairo.day + 'T' + cairo.time + ':00Z') - nowMs) / 60_000) * 60_000;
// the Cairo day of an ISO instant
export const cairoDayOf = (iso, offset) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + offset).toISOString().slice(0, 10) : null; };
// should this (source × entity × target) go out now? st = its alert_state row (or null); cairo = { day, time }
export function sendDue(rule, st, cairo, nowMs) {
  if (!rule || !rule.on) return false;
  const sent = st && !st.resolved_at ? Number(st.sent_count) || 0 : 0;
  const lastDay = st && st.last_sent_at && sent ? cairoDayOf(st.last_sent_at, cairoOffset(cairo, nowMs)) : null;
  if (isCalendar(rule)) return calendarDue(rule, cairo.day) && hourOf(cairo.time) >= rule.at && lastDay !== cairo.day;
  if (sent === 0) return true;
  if (sent >= rule.count) return false;
  if (isDaily(rule)) return hourOf(cairo.time) >= rule.at && lastDay !== cairo.day;
  return nowMs - Date.parse(st.last_sent_at) >= everyHours(rule.every) * H;
}

// ---------------------------------------------------------------- who receives (block 23 on the server)

export function roleIndex(roles) {
  const out = {}; ROLE_ORDER.forEach((id, i) => { out[id] = i; });
  const custom = (roles || []).filter((r) => r && !ROLE_ORDER.includes(r.id)).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id)));
  custom.forEach((r, i) => { out[r.id] = ROLE_ORDER.length + i; });
  return out;
}
export function permOk(role, perm) {
  if (!perm) return true; if (!role) return false; if (role.id === 'admin') return true;
  const p = role.permissions && typeof role.permissions === 'object' ? role.permissions : {};
  return (RANK[p[perm[0]]] || 0) >= RANK[perm[1]];
}
// R | S | N of a role for a source: the matrix (or the block-23 default) gated by the role's permissions; the admin never N
export function accessOf(notif, roles, key, roleId, override) {
  const src = sourceOf(key); if (!src) return 'N';
  const role = (roles || []).find((r) => r.id === roleId) || null;
  if (!permOk(role, src.perm)) return 'N';
  const ci = roleIndex(roles)[roleId]; if (ci === undefined) return 'N';
  const m = notif && notif.alertRoles && typeof notif.alertRoles[key] === 'string' ? notif.alertRoles[key] : src.def;
  let c = override && override !== 'role' ? override : (m[ci] || 'N');
  if (roleId === 'admin' && c === 'N') c = 'S';
  return c === 'R' || c === 'S' ? c : 'N';
}
export const receivers = (notif, roles, key) => (roles || []).filter((r) => accessOf(notif, roles, key, r.id) === 'R').map((r) => r.id);
// the members of a role who receive the source (a member's override may add or remove them), active only, with their contacts
export function roleMembers(notif, roles, members, key, roleId) {
  const ov = notif && notif.alertOverrides && typeof notif.alertOverrides === 'object' ? notif.alertOverrides : {};
  return (members || []).filter((m) => m && m.status === 'active' && m.role_id === roleId && accessOf(notif, roles, key, roleId, ov[m.id] && ov[m.id][key]) === 'R');
}

// ---------------------------------------------------------------- the quiet hours, the WhatsApp cap, the escalations

// quiet = { days: 'الجمعة' | 'الجمعة والسبت' | 'لا يوجد', hours: 'من 11:00 م إلى 9:00 ص', waMax: 'رسالتان في اليوم' }
export function quietNow(quiet, cairo) {
  const q = quiet && typeof quiet === 'object' ? quiet : {};
  const days = q.days === 'الجمعة والسبت' ? [5, 6] : q.days === 'لا يوجد' ? [] : [5];
  if (days.includes(dayOf(cairo.day))) return true;
  const m = /من\s+(\d{1,2}:\d{2}\s*[صم])\s+إلى\s+(\d{1,2}:\d{2}\s*[صم])/.exec(String(q.hours || ''));
  const from = m ? parseAt(m[1]) : 23, to = m ? parseAt(m[2]) : 9; const h = hourOf(cairo.time);
  return from > to ? (h >= from || h < to) : (h >= from && h < to);
}
export const waCap = (waMax) => (/رسالتان|2/.test(String(waMax || 'رسالتان في اليوم')) ? 2 : /من غير|بدون/.test(String(waMax)) ? Infinity : parseInt(String(waMax).replace(/[^0-9]/g, ''), 10) || 1);
export function parseAfter(s) {
  const n = parseInt(String(s || '').replace(/[^0-9]/g, ''), 10); if (!n) return 24 * H;
  return /دقيقة|دقايق/.test(String(s)) ? n * 60_000 : /يوم/.test(String(s)) ? n * D : n * H;
}
const ESC_TO = { 'دور أدمن': 'admin', 'أدمن': 'admin', 'مدير خدمة العملاء': 'cs', 'خدمة العملاء': 'cs', 'الحسابات': 'accounts', 'العمليات': 'ops', 'متابعة المبتكرين': 'vendors_followup' };
// the escalation of a source's type: { afterMs, roles, manager, channels } or null
export function escalationFor(notif, key) {
  const src = sourceOf(key); if (!src || !src.esc) return null;
  const e = (Array.isArray(notif && notif.escalations) ? notif.escalations : []).find((x) => x && x.type === src.esc && x.on !== false); if (!e) return null;
  const to = Array.isArray(e.to) ? e.to : parts(e.to); const c = parts(e.ch);
  return { afterMs: parseAfter(e.after), roles: [...new Set(to.map((t) => ESC_TO[t]).filter(Boolean))], manager: to.includes('المدير المباشر'), channels: { system: true, email: c.includes('إيميل'), whatsapp: c.includes('واتساب') } };
}

// ---------------------------------------------------------------- the plan

const key3 = (k, e, t) => k + '|' + e + '|' + t;
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const logPush = (log, entry) => { const l = Array.isArray(log) ? log.slice(-49) : []; l.push(entry); return l; };

/** The plan of one tick.
 *  in: { now (ISO), cairo { day, time }, notif, roles [{ id, name, permissions, sort }], members [{ id, role_id, manager_id, status, email, phone }],
 *       items [{ key, entityId, title, body, own?: { manager?, member? }, vendorPhone? }], state [alert_state rows], acted: Set('key|entity') }
 *  out: { alerts: [rows], state: [upserts], external: [{ ch: 'email'|'whatsapp', to: { member? , vendor? , contact }, title, body, key, entityId, target }], resolved: [{ source_key, entity_id }] } */
// The outbound channels as a whole (owner, 8 Nov: «التنبيهات بتاعة السيستم بس»): the e-mail and WhatsApp sends — the types'
// own «إيميل / واتساب» words, the vendor WhatsApp, the escalations and the digests — go out only while notif.channels.<ch> is
// true (the two switches in «ساعات الهدوء»); missing = off. The bell rows are never affected.
export const outboundOn = (notif) => { const c = notif && notif.channels && typeof notif.channels === 'object' ? notif.channels : {}; return { email: c.email === true, whatsapp: c.whatsapp === true }; };

export function plan(input) {
  const { now, cairo, notif = {}, roles = [], members = [], items = [], state = [], acted = new Set() } = input;
  const outb = outboundOn(notif);
  const nowMs = Date.parse(now); const quiet = quietNow(notif.quiet, cairo); const cap = waCap(notif.quiet && notif.quiet.waMax);
  const stMap = new Map(state.map((s) => [key3(s.source_key, s.entity_id, s.target), s]));
  const seen = new Set(); const alerts = []; const upserts = new Map(); const external = []; const resolved = [];
  const waToday = new Map(); // target → WhatsApp sends today (the cap)
  for (const s of state) for (const e of Array.isArray(s.channel_log) ? s.channel_log : []) if (e && e.ch === 'whatsapp' && e.status === 'sent' && String(e.at || '').slice(0, 10) === cairo.day) waToday.set(e.to, (waToday.get(e.to) || 0) + 1);
  const stateOf = (k, e, t) => upserts.get(key3(k, e, t)) || stMap.get(key3(k, e, t)) || null;
  const touch = (k, e, t, patch) => { const cur = stateOf(k, e, t) || { source_key: k, entity_id: e, target: t, first_at: now, last_sent_at: null, sent_count: 0, escalated_at: null, resolved_at: null, channel_log: [] }; const next = { ...cur, ...patch }; upserts.set(key3(k, e, t), next); return next; };
  const sendOut = (ch, to, it, target, k, e, extra) => { // one external send, or its hold / cap, into the state's log
    if (!outb[ch]) return; // the channel is off as a whole: nothing goes out, nothing is logged
    const contact = ch === 'email' ? to.email : to.phone; const label = to.member ? 'm:' + to.member : to.vendor ? 'v:' + to.vendor : target;
    const log = (status) => touch(k, e, target, { channel_log: logPush((stateOf(k, e, target) || {}).channel_log, { at: now, ch, to: label, status }) });
    if (!contact) { log('no_contact'); return; }
    if (quiet) { log('held'); return; }
    if (ch === 'whatsapp') { const n = waToday.get(label) || 0; if (n >= cap) { log('capped'); return; } waToday.set(label, n + 1); }
    external.push({ ch, to: { ...to, contact }, title: it.title, body: it.body || '', key: k, entityId: e, target, ...(extra || {}) });
  };
  for (const it of items) {
    const src = sourceOf(it.key); const rule = ruleFor(notif, it.key); if (!src || !rule || !rule.on) continue;
    const e = String(it.entityId); const roleTargets = receivers(notif, roles, it.key).map((r) => 'role:' + r);
    const userTargets = []; if (it.own && it.own.manager && src.kind === 'team') userTargets.push('user:' + it.own.manager); if (it.own && it.own.member) userTargets.push('user:' + it.own.member);
    const targets = [...new Set(roleTargets.concat(userTargets))];
    for (const t of targets) {
      seen.add(key3(it.key, e, t)); const st0 = stMap.get(key3(it.key, e, t)) || null; const st = st0 && st0.resolved_at ? null : st0; // a resolved row starts over
      if (!sendDue(rule, st, cairo, nowMs)) continue;
      const row = { at: now, kind: src.kind, title: cut(it.title, 200), body: cut(it.body, 1000) || null, entity: it.entity || src.hash, entity_id: e, source_key: it.key, expires_at: it.expiresAt || null };
      if (t.startsWith('role:')) row.role_id = t.slice(5); else row.user_id = t.slice(5);
      alerts.push(row);
      const sent = (st ? Number(st.sent_count) || 0 : 0) + 1;
      touch(it.key, e, t, { first_at: st ? st.first_at : now, last_sent_at: now, sent_count: sent, resolved_at: null, escalated_at: st ? st.escalated_at : null, channel_log: st ? st.channel_log : [] });
      if (rule.channels.email || rule.channels.whatsapp) {
        const people = t.startsWith('role:') ? roleMembers(notif, roles, members, it.key, t.slice(5)) : members.filter((m) => m.id === t.slice(5) && m.status === 'active');
        for (const m of people) { if (rule.channels.email) sendOut('email', { member: m.id, email: m.email }, it, t, it.key, e); if (rule.channels.whatsapp) sendOut('whatsapp', { member: m.id, phone: m.phone }, it, t, it.key, e); }
      }
      if (rule.vendorWa && it.vendorPhone && t === targets[0]) sendOut('whatsapp', { vendor: it.vendorId || e, phone: it.vendorPhone }, it, t, it.key, e);
    }
    // the escalation: the first target's state is old enough, nobody acted, not escalated yet
    const esc = escalationFor(notif, it.key);
    if (esc && targets.length && !acted.has(it.key + '|' + e)) {
      const first = targets.map((t) => stateOf(it.key, e, t)).filter((s) => s && !s.resolved_at).sort((a, b) => Date.parse(a.first_at) - Date.parse(b.first_at))[0];
      if (first && !first.escalated_at && nowMs - Date.parse(first.first_at) >= esc.afterMs) {
        const escTargets = esc.roles.map((r) => 'role:' + r).concat(esc.manager && it.own && it.own.manager ? ['user:' + it.own.manager] : []);
        for (const t of [...new Set(escTargets)]) {
          const row = { at: now, kind: src.kind, title: cut('تصعيد: ' + it.title, 200), body: cut((it.body ? it.body + ' · ' : '') + 'من غير إجراء من ' + Math.round((nowMs - Date.parse(first.first_at)) / H) + ' ساعة', 1000), entity: it.entity || src.hash, entity_id: e, source_key: it.key + '.esc', expires_at: null };
          if (t.startsWith('role:')) row.role_id = t.slice(5); else row.user_id = t.slice(5);
          alerts.push(row);
          const people = t.startsWith('role:') ? members.filter((m) => m.status === 'active' && m.role_id === t.slice(5)) : members.filter((m) => m.id === t.slice(5) && m.status === 'active');
          for (const m of people) { if (esc.channels.email) sendOut('email', { member: m.id, email: m.email }, { title: row.title, body: row.body }, first.target, it.key, e, { escalation: true }); if (esc.channels.whatsapp) sendOut('whatsapp', { member: m.id, phone: m.phone }, { title: row.title, body: row.body }, first.target, it.key, e, { escalation: true }); }
        }
        for (const t of targets) if (stateOf(it.key, e, t)) touch(it.key, e, t, { escalated_at: now });
      }
    }
  }
  // gone from the items → resolved (the next appearance starts over)
  for (const s of state) if (!s.resolved_at && !seen.has(key3(s.source_key, s.entity_id, s.target)) && sourceOf(s.source_key)) { touch(s.source_key, s.entity_id, s.target, { resolved_at: now }); resolved.push({ source_key: s.source_key, entity_id: s.entity_id }); }
  return { alerts, state: [...upserts.values()], external, resolved };
}

// ---------------------------------------------------------------- the digests (a role's daily summary, the custom reports)

const AR_HOUR = (h) => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'ص' : 'م');
export const digestHour = (notif, roleId) => { const at = notif && notif.roleDigestAt && typeof notif.roleDigestAt === 'object' ? notif.roleDigestAt[roleId] : null; if (at) return parseAt(at); const m = /(\d{1,2}:\d{2}\s*[صم])/.exec(String(notif && notif.quiet && notif.quiet.digest || '')); return m ? parseAt(m[1]) : 9; };
/** The digests due now: in { notif, roles, members, cairo, items, sentToday: Set('digest:<id>') } → alerts rows (one per role / report target). */
export function digestPlan(input) {
  const { notif = {}, roles = [], members = [], cairo, items = [], sentToday = new Set() } = input; const out = []; const hour = hourOf(cairo.time);
  const counts = (keys) => { const g = {}; for (const it of items) if (keys.includes(it.key)) g[it.key] = (g[it.key] || 0) + 1; return g; };
  const line = (g) => Object.entries(g).map(([k, n]) => (sourceOf(k) ? sourceOf(k).type : k) + ' ' + n).join(' · ');
  const roleOn = notif.roleDigests && typeof notif.roleDigests === 'object' ? notif.roleDigests : {};
  for (const r of roles) {
    if (roleOn[r.id] === false || roleOn[r.name] === false) continue; const id = 'digest:role:' + r.id; if (sentToday.has(id) || hour < digestHour(notif, r.id) || hour >= digestHour(notif, r.id) + 3) continue;
    const keys = SOURCES.map((s) => s.key).filter((k) => accessOf(notif, roles, k, r.id) === 'R'); const g = counts(keys); const total = Object.values(g).reduce((a, b) => a + b, 0);
    if (!total || !members.some((m) => m.status === 'active' && m.role_id === r.id)) continue;
    out.push({ at: input.now, kind: 'digest', title: 'الملخص اليومي — ' + (r.name || r.id) + ' · ' + total + ' مهمة', body: cut(line(g), 1000), role_id: r.id, entity: 'notifications', entity_id: id + ':' + cairo.day, source_key: id, expires_at: null, email: true });
  }
  for (const d of Array.isArray(notif.digests) ? notif.digests : []) {
    if (!d || d.on === false || !Array.isArray(d.keys)) continue; const id = 'digest:' + String(d.id || d.name); if (sentToday.has(id)) continue;
    const at = parseAt(d.at || AR_HOUR(9)); if (hour < at || hour >= at + 3) continue;
    if (d.every === 'أسبوعيًا' && !calendarDue({ every: 'أسبوعيًا', weekday: d.weekday || 'الأحد' }, cairo.day)) continue;
    if (d.every === 'أيام محددة من الشهر' && !calendarDue({ every: 'أيام محددة من الشهر', days: d.days }, cairo.day)) continue;
    const g = counts(d.keys); const total = Object.values(g).reduce((a, b) => a + b, 0);
    for (const to of Array.isArray(d.to) ? d.to : []) {
      const role = roles.find((r) => r.name === to || r.id === to || String(r.name || '').replace(/^ال/, '') === String(to).replace(/^ال/, '')); const member = !role ? members.find((m) => m.name === to) : null;
      if (!role && !member) continue;
      const row = { at: input.now, kind: 'digest', title: cut(d.name, 200) + ' · ' + total + ' مهمة', body: cut(line(g), 1000) || 'كله تمام', entity: 'notifications', entity_id: id + ':' + cairo.day, source_key: id, expires_at: null, email: parts(d.ch).includes('إيميل'), whatsapp: parts(d.ch).includes('واتساب') };
      if (role) row.role_id = role.id; else row.user_id = member.id;
      out.push(row);
    }
  }
  const outb = outboundOn(notif); for (const r of out) { if (!outb.email) r.email = false; if (!outb.whatsapp) r.whatsapp = false; }
  return out;
}

// the text of an external send: the subject line and a short RTL body (no phone numbers, no links to secrets)
export const emailHtml = (title, body, signature) => '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2937"><h2 style="font-size:18px;margin:0 0 8px">' + esc(title) + '</h2>' + (body ? '<p style="margin:0 0 16px">' + esc(body) + '</p>' : '') + '<p style="color:#6b7280;font-size:13px;margin:0">' + esc(signature || 'فريق إبتكر كلوب') + ' · نظام التشغيل</p></div>';
export const waText = (title, body) => cut(title + (body ? ' — ' + body : ''), 900);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
