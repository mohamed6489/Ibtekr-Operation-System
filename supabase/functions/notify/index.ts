// notify: the notifications engine (phase 11, decision 16 of docs/superpowers/plans/2026-11-07-phase-11-settings.md). Deployed with
// verify_jwt false; it authenticates each request itself.
//   POST { action: 'tick' } with X-Sync-Secret (the sync secret of 0008; cron notify-tick every 15 minutes, 0056) and no Authorization:
//     the live tables → the engine's items (the orders late / pending / unconfirmed / waiting, the makers late / at risk / their daily
//     and weekly reports / a contract ending, the payroll before its pay day, the makers' statements on their days, the subscriptions
//     ending / ended, the urgent and high tickets and the late follow-ups, the conversations waiting for us / late, a channel in
//     error, the team's requests / overtime / meetings, the stock (a consolidation / a photo lot / a return waiting), the waybills
//     needed / late / the daily summary, the company papers ending) → _shared/notify.js plan() with the settings row «notif», the
//     roles, the active members and alert_state → `alerts` rows (one per source × entity × role or member, in the bell at once),
//     alert_state upserts, the external sends (e-mail by Resend with the Vault key app_resend, WhatsApp by the linked WhatsApp 1
//     number — Vault meta_wa of cs-whatsapp — with the approved template named in the settings) and the digests. Each external
//     send is a line in alert_state.channel_log (channel, target label, status, code) — never a text, a number or an address.
//   POST { action } with a member's Authorization: Bearer <jwt>:
//     status  (the admin) → the last tick (sync_state «notify»), the channels' readiness (Resend key / WhatsApp link / template).
//     tick    (the admin, by hand) → the same as the cron; { dry: true } → the plan without any write or send (a preview).
// Nothing here logs a token, a phone number, an e-mail address or a message text.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { vaultEnv } from '../_shared/secrets.js';
import { WA_GRAPH, graphErrorCode } from '../_shared/cs-whatsapp.js';
import { cairoParts } from '../_shared/mkt-publish.js';
import { SOURCES, digestPlan, emailHtml, plan, waText } from '../_shared/notify.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string; fetch?: typeof fetch;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
};
type Item = { key: string; entityId: string; title: string; body?: string; entity?: string; own?: { manager?: string | null; member?: string | null }; vendorId?: string; vendorPhone?: string | null; expiresAt?: string | null };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const D = 86400_000; const H = 3600_000;
const rows = (r: { data?: unknown }) => (Array.isArray(r?.data) ? r.data as Json[] : []);
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * D).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / D);
const num = (n: number) => String(n);
const LIMIT = 2000;

// ---------------------------------------------------------------- the settings and the people

type Ctx = { now: string; nowMs: number; cairo: { day: string; time: string }; notif: Json; roles: Json[]; members: Json[]; settings: Record<string, Json> };
async function context(deps: Deps): Promise<Ctx> {
  const now = deps.now(); const nowMs = Date.parse(now); const cairo = cairoParts(nowMs);
  const [st, roles, members] = await Promise.all([
    deps.db.from('settings').select('section, data').in('section', ['notif', 'inventory', 'cs', 'makers']),
    deps.db.from('roles').select('id, name, permissions, sort').limit(200),
    deps.db.from('profiles').select('id, name, role_id, manager_id, status, email, phone').eq('status', 'active').limit(500),
  ]);
  const settings: Record<string, Json> = {}; for (const r of rows(st)) settings[String(r.section)] = isObj(r.data) ? r.data : {};
  return { now, nowMs, cairo, notif: settings.notif ?? {}, roles: rows(roles), members: rows(members), settings };
}

// ---------------------------------------------------------------- the sources (the live tables → items)

const OPEN_ORDER = ['جاري التنفيذ', 'معلّق', 'جاهز للشحن', 'قيد الشحن'];
const ITEM_DONE = ['تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر', 'مرتجع للمورد', 'ملغي', 'اتسلم'];
const SHIP_READY = ['جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن', 'جاهز للشحن من المورد للعميل', 'جاهز للشحن من المورد للمخزن'];
const TICKET_ROLE: Record<string, string> = { 'مدير النظام': 'admin', 'خدمة العملاء': 'cs', 'متابعة المبتكرين': 'vendors_followup', 'الحسابات': 'accounts' };
const orderAge = (placedAt: string, day: string) => daysBetween(String(placedAt).slice(0, 10), day);

export async function collect(deps: Deps, ctx: Ctx): Promise<Item[]> {
  const { cairo, nowMs, now } = ctx; const today = cairo.day; const out: Item[] = [];
  const mk = ctx.settings.makers ?? {}; const riskFrom = Number(mk.risk_day) || 9; const lateFrom = Number(mk.late_day) || 12;
  const inv = ctx.settings.inventory ?? {}; const consDays = Number(inv.consolidationAlertDays) || 5; const photoDays = Number(inv.photoMaxDays) || 14;
  const slaLate = Number((ctx.settings.cs ?? {}).sla_late_min) || 60;
  // orders (open, not removed) with their lines and makers
  const [orders, vendors] = await Promise.all([
    deps.db.from('orders').select('id, number, customer_name, status, confirm, placed_at').in('status', OPEN_ORDER).is('deleted_at', null).limit(LIMIT),
    deps.db.from('vendors').select('id, name, phone, status, contract, lead_days').limit(LIMIT),
  ]);
  const O = rows(orders); const V = new Map(rows(vendors).map((v) => [String(v.id), v]));
  const items = O.length ? rows(await deps.db.from('order_items').select('id, order_id, vendor_id, name, status, ready_at, waybill').in('order_id', O.map((o) => o.id)).eq('removed', false).limit(10_000)) : [];
  const perVendor = new Map<string, { late: Set<number>; risk: Set<number>; open: Set<number> }>();
  for (const o of O) {
    const age = orderAge(o.placed_at, today); const label = 'IB-' + (o.number ?? o.id) + ' · ' + String(o.customer_name ?? '').trim();
    if (o.status === 'معلّق') out.push({ key: 'customers.follow', entityId: String(o.id), title: label, body: 'أوردر معلّق · محتاج متابعة · عمره ' + age + ' يوم', entity: 'orders' });
    if (age >= lateFrom && o.status === 'جاري التنفيذ') out.push({ key: 'customers.late', entityId: String(o.id), title: label, body: 'أوردر متأخر · محتاج متابعة مع العميل · عمره ' + age + ' يوم', entity: 'orders' });
    if (o.confirm === 'غير مؤكد' && age >= 1) out.push({ key: 'customers.unconf', entityId: String(o.id), title: label, body: 'غير مؤكد · لسه ما اتأكدش من العميل · عمره ' + age + ' يوم', entity: 'orders' });
    if (o.confirm === 'في انتظار الرد') out.push({ key: 'customers.waiting', entityId: String(o.id), title: label, body: 'في انتظار رد العميل', entity: 'orders' });
    const lines = items.filter((it) => String(it.order_id) === String(o.id));
    for (const it of lines) {
      if (!it.vendor_id || ITEM_DONE.includes(String(it.status))) continue;
      const vid = String(it.vendor_id); const pv = perVendor.get(vid) ?? { late: new Set(), risk: new Set(), open: new Set() }; perVendor.set(vid, pv);
      if (o.status === 'جاري التنفيذ') { pv.open.add(o.id); if (age >= lateFrom) pv.late.add(o.id); else if (age >= riskFrom) pv.risk.add(o.id); }
      // delivery: a ready line without a waybill; late after 24 hours
      if (SHIP_READY.includes(String(it.status)) && !it.waybill) {
        const waited = it.ready_at ? Math.round((nowMs - Date.parse(it.ready_at)) / H) : 0; const v = V.get(vid);
        const t = 'بوليصة — IB-' + (o.number ?? o.id) + ' · ' + String(it.name ?? '').slice(0, 60); const b = (v ? String(v.name) : 'المبتكر') + ' · ' + String(it.status).replace('جاهز للشحن ', '');
        out.push({ key: 'delivery.waybills', entityId: String(it.id), title: t, body: b, entity: 'orders' });
        if (waited >= 24) out.push({ key: 'delivery.late', entityId: String(it.id), title: t, body: b + ' · مستنية ' + waited + ' ساعة', entity: 'orders' });
      }
    }
  }
  const waybills = out.filter((x) => x.key === 'delivery.waybills').length;
  if (waybills) out.push({ key: 'delivery.daily', entityId: today, title: 'ملخص التوصيل اليومي — ' + waybills + ' بوليصة', body: 'كل البوالص اللي لسه ما اتعملتش', entity: 'orders' });
  for (const [vid, pv] of perVendor) {
    const v = V.get(vid); const name = v ? String(v.name) : 'مبتكر'; const phone = v && typeof v.phone === 'string' ? v.phone : null;
    if (pv.late.size) out.push({ key: 'vendors.late', entityId: vid, title: name, body: pv.late.size + ' أوردر متأخر عن مدة التصنيع', entity: 'orders', vendorId: vid, vendorPhone: phone });
    if (pv.risk.size) out.push({ key: 'vendors.risk', entityId: vid, title: name, body: pv.risk.size + ' أوردر قابل للتأخير (' + riskFrom + '–' + (lateFrom - 1) + ' يوم)', entity: 'orders', vendorId: vid, vendorPhone: phone });
    if (pv.open.size) {
      out.push({ key: 'vendors.daily', entityId: vid, title: 'المتابعة اليومية — ' + name, body: 'متأخرة ' + pv.late.size + ' · قابلة للتأخير ' + pv.risk.size + ' · قيد التنفيذ ' + pv.open.size, entity: 'vendors', vendorId: vid, vendorPhone: phone });
      out.push({ key: 'vendors.weekly', entityId: vid, title: 'التقرير الأسبوعي — ' + name, body: 'قيد التنفيذ ' + pv.open.size + ' · متأخرة ' + pv.late.size, entity: 'vendors', vendorId: vid, vendorPhone: phone });
    }
  }
  for (const v of V.values()) { // a contract ending within 30 days (or ended)
    const exp = isObj(v.contract) && typeof v.contract.expires === 'string' ? v.contract.expires.slice(0, 10) : null;
    if (exp && v.status !== 'inactive' && daysBetween(today, exp) <= 30) out.push({ key: 'vendors.contract', entityId: String(v.id), title: 'عقد ' + String(v.name), body: daysBetween(today, exp) < 0 ? 'انتهى يوم ' + exp : 'بينتهي يوم ' + exp + ' (فاضل ' + daysBetween(today, exp) + ' يوم)', entity: 'vendors' });
  }
  // accounts: the payroll before its pay day (accAlerts.payDay / lead), the makers' statements on their days, the subscriptions
  const acc = isObj(ctx.notif.accAlerts) ? ctx.notif.accAlerts : {}; const payDay = Math.min(28, Math.max(1, Number(acc.payDay) || 1)); const lead = Math.max(0, Number(acc.lead) || 14);
  const due = payrollDue(today, payDay);
  if (due.daysLeft <= lead) {
    const sheet = rows(await deps.db.from('hr_payroll').select('month, status, total').eq('month', due.month + '-01').limit(1))[0];
    if (!sheet || sheet.status !== 'مدفوع') out.push({ key: 'accounts.payroll', entityId: due.month, title: 'مرتبات الموظفين — يوم الصرف ' + due.date, body: 'فاضل ' + due.daysLeft + ' يوم · الكشف ' + (sheet ? String(sheet.status) : 'لسه ما اتفتحش'), entity: 'hr-payroll' });
  }
  const active = [...V.values()].filter((v) => v.status === 'active');
  if (active.length) out.push({ key: 'accounts.vendors', entityId: today.slice(0, 7), title: 'كشوف حساب المبتكرين — ' + active.length + ' مبتكر', body: 'كشف الحساب في ميعاده (الرصيد والمبيعات والعرابين)', entity: 'accounts' });
  const subs = rows(await deps.db.from('acc_expenses').select('id, sub_name, sub_ends, amount').eq('category', 'الاشتراكات').is('voided_at', null).lte('sub_ends', addDays(today, Number((ctx.notif.subsAlert ?? {}).def === 'week' ? 7 : 30))).limit(LIMIT));
  const seenSub = new Set<string>();
  for (const s of subs.sort((a, b) => String(b.sub_ends).localeCompare(String(a.sub_ends)))) {
    const name = String(s.sub_name ?? 'اشتراك'); if (seenSub.has(name)) continue; seenSub.add(name); // the latest row of the subscription speaks for it
    const left = daysBetween(today, String(s.sub_ends).slice(0, 10));
    if (left < 0) out.push({ key: 'accounts.subs_expired', entityId: name, title: 'اشتراك ' + name + ' خلص', body: 'انتهى يوم ' + String(s.sub_ends).slice(0, 10) + ' من غير تجديد', entity: 'accounts' });
    else out.push({ key: 'accounts.subs', entityId: name, title: 'اشتراك ' + name + ' قرب يخلص', body: 'بينتهي يوم ' + String(s.sub_ends).slice(0, 10) + ' (فاضل ' + left + ' يوم)', entity: 'accounts' });
  }
  // tickets: urgent / high open ones to their role; a follow-up date passed
  const tickets = rows(await deps.db.from('tickets').select('id, title, priority, assignee_role, status, follow_up, created_by').in('status', ['open', 'in_progress', 'waiting']).limit(LIMIT));
  for (const t of tickets) {
    const code = 'TKT-' + String(t.id).padStart(4, '0'); const role = TICKET_ROLE[String(t.assignee_role)] ?? 'ops'; const title = code + ' — ' + String(t.title ?? '').slice(0, 80);
    if (t.priority === 'urgent' || t.priority === 'high') out.push({ key: t.priority === 'urgent' ? 'tasks.urgent' : 'tasks.high', entityId: String(t.id), title, body: (t.priority === 'urgent' ? 'عاجلة' : 'عالية') + ' · المسؤول: ' + String(t.assignee_role), entity: 'tickets', own: { member: null }, ...(role ? {} : {}) });
    if (typeof t.follow_up === 'string' && t.follow_up.slice(0, 10) < today) out.push({ key: 'tasks.late', entityId: String(t.id), title, body: 'عدّى ميعاد المتابعة ' + t.follow_up.slice(0, 10), entity: 'tickets' });
  }
  // messages: conversations waiting for us (late after the SLA minutes); channels in error
  const convs = rows(await deps.db.from('cs_conversations').select('id, handle, status, waiting_since, assignee, platform').eq('status', 'مستنية ردنا').limit(LIMIT));
  for (const c of convs) {
    const since = c.waiting_since ? Date.parse(c.waiting_since) : nowMs; const min = Math.max(0, Math.round((nowMs - since) / 60_000));
    const title = 'محادثة ' + String(c.handle ?? 'عميل').slice(0, 60) + ' · ' + String(c.platform);
    out.push({ key: 'messages.waiting', entityId: String(c.id), title, body: 'مستنية ردنا من ' + min + ' دقيقة', entity: 'cs', own: { member: typeof c.assignee === 'string' ? c.assignee : null } });
    if (min >= slaLate) out.push({ key: 'messages.late', entityId: String(c.id), title, body: 'متأخرة عن الرد · ' + min + ' دقيقة', entity: 'cs', own: { member: typeof c.assignee === 'string' ? c.assignee : null } });
  }
  for (const ch of rows(await deps.db.from('cs_channels').select('id, name, status').eq('status', 'error').limit(20))) out.push({ key: 'messages.channels', entityId: String(ch.id), title: 'قناة ' + String(ch.name) + ' — خطأ', body: 'القناة واقفة أو فيها خطأ في المزامنة', entity: 'cs-channels' });
  // the team: requests waiting, overtime waiting, meetings due (today / tomorrow)
  const memberOf = new Map(ctx.members.map((m) => [String(m.id), m]));
  const allMembers = rows(await deps.db.from('profiles').select('id, name, manager_id').limit(500)); const nameOf = (id: unknown) => { const m = allMembers.find((x) => String(x.id) === String(id)); return m ? String(m.name) : 'عضو'; }; const managerOf = (id: unknown) => { const m = allMembers.find((x) => String(x.id) === String(id)); return m && typeof m.manager_id === 'string' ? m.manager_id : null; };
  for (const r of rows(await deps.db.from('hr_requests').select('id, member_id, type, from_day, to_day, status').in('status', ['جديد', 'قيد المراجعة']).limit(LIMIT))) out.push({ key: 'team.req', entityId: String(r.id), title: String(r.type) + ' — ' + nameOf(r.member_id), body: String(r.from_day) + (r.to_day && r.to_day !== r.from_day ? ' → ' + String(r.to_day) : ''), entity: 'hr-requests', own: { manager: managerOf(r.member_id) } });
  for (const o of rows(await deps.db.from('hr_overtime').select('id, member_id, day, minutes, kind, status, created_at').eq('status', 'مستني').limit(LIMIT))) out.push({ key: 'team.ot', entityId: String(o.id), title: (o.kind === 'rest_day' ? 'شغل يوم راحة — ' : 'وقت إضافي ' + Math.round(Number(o.minutes) / 6) / 10 + ' س — ') + nameOf(o.member_id), body: 'يوم ' + String(o.day) + ' · مستني تأكيد', entity: 'hr-overtime', own: { manager: managerOf(o.member_id) } });
  for (const m of rows(await deps.db.from('hr_meetings').select('id, member_id, reason, status, day, time_text').in('status', ['مطلوب', 'اتحدد ميعاد']).limit(LIMIT))) {
    if (m.status === 'اتحدد ميعاد' && typeof m.day === 'string' && daysBetween(today, m.day.slice(0, 10)) > 1) continue;
    out.push({ key: 'team.meet', entityId: String(m.id), title: 'ميتنج 1:1 — ' + nameOf(m.member_id), body: String(m.reason ?? '').slice(0, 120) + (m.day ? ' · ' + String(m.day) + (m.time_text ? ' ' + String(m.time_text) : '') : ' · لسه ما اتحددش ميعاد'), entity: 'hr', own: { manager: managerOf(m.member_id), member: m.status === 'اتحدد ميعاد' && memberOf.has(String(m.member_id)) ? String(m.member_id) : null } });
  }
  // the stock: an open consolidation past its days, a photo lot past its days, a return without an inspection
  for (const c of rows(await deps.db.from('inv_consolidations').select('id, order_id, since, status').eq('status', 'open').limit(LIMIT))) { const d = daysBetween(String(c.since).slice(0, 10), today); if (d >= consDays) out.push({ key: 'stock.cons', entityId: String(c.id), title: 'تجميع IB-' + String(c.order_id) + ' عدّى ' + d + ' يوم', body: 'قاعد في المخزن أكتر من اللازم', entity: 'inventory' }); }
  for (const l of rows(await deps.db.from('inv_lots').select('id, reason, sku, name, since, condition').in('reason', ['تصوير', 'مرتجع']).is('closed_at', null).limit(LIMIT))) {
    const d = daysBetween(String(l.since).slice(0, 10), today);
    if (l.reason === 'تصوير' && d >= photoDays) out.push({ key: 'stock.photo', entityId: String(l.id), title: String(l.name ?? l.sku) + ' في التصوير بقاله ' + d + ' يوم', body: 'قاعدة أكتر من اللازم — يرجع للمبتكر أو يتحوّل للبيع', entity: 'inventory' });
    if (l.reason === 'مرتجع' && !l.condition) out.push({ key: 'stock.ret', entityId: String(l.id), title: 'مرتجع ' + String(l.name ?? l.sku), body: 'بانتظار الفحص من ' + d + ' يوم', entity: 'inventory' });
  }
  // the company papers ending within 30 days (or ended)
  for (const d of rows(await deps.db.from('company_docs').select('id, name, type, expires').lte('expires', addDays(today, 30)).limit(200))) { const left = daysBetween(today, String(d.expires).slice(0, 10)); out.push({ key: 'docs.expiring', entityId: String(d.id), title: String(d.name) + ' (' + String(d.type) + ')', body: left < 0 ? 'انتهت يوم ' + String(d.expires) : 'بتنتهي يوم ' + String(d.expires) + ' (فاضل ' + left + ' يوم)', entity: 'settings-docs' }); }
  void now; return out;
}
// the next pay day from today (payDay of this month, or the next), the sheet month before it
export function payrollDue(today: string, payDay: number) {
  const [y, m, d] = today.split('-').map(Number); let Y = y, M = m; if (d > payDay) { M = m + 1; if (M > 12) { M = 1; Y++; } }
  const date = Y + '-' + String(M).padStart(2, '0') + '-' + String(payDay).padStart(2, '0'); const daysLeft = daysBetween(today, date);
  const pm = payDay === 1 ? (M === 1 ? (Y - 1) + '-12' : Y + '-' + String(M - 1).padStart(2, '0')) : Y + '-' + String(M).padStart(2, '0');
  return { date, daysLeft, month: pm };
}

// ---------------------------------------------------------------- the external channels

type Wa = { token: string; phone_id: string };
async function waLink(deps: Deps): Promise<Wa | null> {
  try { const { data, error } = await deps.db.rpc('cs_secret_get', { p_name: 'meta_wa' }); if (error || typeof data !== 'string' || !data) return null; const j = JSON.parse(data); return isObj(j) && typeof j.token === 'string' && typeof j.phone_id === 'string' ? { token: j.token, phone_id: j.phone_id } : null; } catch { return null; }
}
const waId = (phone: string) => { const d = String(phone).replace(/\D/g, ''); return /^01\d{9}$/.test(d) ? '2' + d : /^20\d{10}$/.test(d) ? d : /^\d{10,15}$/.test(d) ? d : null; };
async function sendEmail(deps: Deps, env: Record<string, string | undefined>, to: string, title: string, body: string, signature: string): Promise<{ status: string; code?: string }> {
  const key = (env.RESEND_API_KEY ?? '').trim(); if (!key) return { status: 'not_linked' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: 'no_contact' };
  try {
    const res = await (deps.fetch ?? fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: (env.RESEND_FROM ?? '').trim() || 'alerts@ibtekr.club', to: [to], subject: title.slice(0, 150), html: emailHtml(title, body, signature) }), signal: AbortSignal.timeout(15_000) });
    return res.ok ? { status: 'sent' } : { status: 'failed', code: String(res.status) };
  } catch { return { status: 'failed', code: 'network' }; }
}
async function sendWa(deps: Deps, link: Wa | null, template: string, phone: string, text: string): Promise<{ status: string; code?: string }> {
  if (!link) return { status: 'not_linked' }; const to = waId(phone); if (!to) return { status: 'no_contact' };
  const body = { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }] } };
  try {
    const res = await (deps.fetch ?? fetch)(WA_GRAPH + '/' + link.phone_id + '/messages', { method: 'POST', headers: { authorization: 'Bearer ' + link.token, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'manual' });
    if (res.ok) return { status: 'sent' }; let j: unknown = null; try { j = await res.json(); } catch { j = null; } return { status: 'failed', code: String(graphErrorCode(j) ?? res.status) };
  } catch { return { status: 'failed', code: 'network' }; }
}

// ---------------------------------------------------------------- the tick

export async function tick(deps: Deps, opts: { dry?: boolean } = {}): Promise<Response> {
  const ctx = await context(deps);
  const items = await collect(deps, ctx);
  const since = new Date(ctx.nowMs - 45 * D).toISOString();
  const [stateRes, sentRes] = await Promise.all([
    deps.db.from('alert_state').select('source_key, entity_id, target, first_at, last_sent_at, sent_count, escalated_at, resolved_at, channel_log').limit(10_000),
    deps.db.from('alerts').select('id, source_key, entity_id').not('source_key', 'is', null).gte('at', since).limit(10_000),
  ]);
  const state = rows(stateRes); const recent = rows(sentRes);
  const acted = new Set<string>(); const sentToday = new Set<string>();
  const ids = recent.map((a) => a.id); const reads = ids.length ? rows(await deps.db.from('alert_reads').select('alert_id').in('alert_id', ids.slice(0, 5000))) : [];
  const readIds = new Set(reads.map((r) => String(r.alert_id)));
  for (const a of recent) { if (readIds.has(String(a.id))) acted.add(a.source_key + '|' + a.entity_id); if (String(a.source_key).startsWith('digest:') && String(a.entity_id).endsWith(':' + ctx.cairo.day)) sentToday.add(String(a.source_key)); }
  // the engine is plain JS: its rows are read loosely here
  const p = plan({ now: ctx.now, cairo: ctx.cairo, notif: ctx.notif, roles: ctx.roles, members: ctx.members, items, state, acted }) as unknown as { alerts: Json[]; state: Json[]; external: Json[]; resolved: Json[] };
  const digests = digestPlan({ now: ctx.now, notif: ctx.notif, roles: ctx.roles, members: ctx.members, cairo: ctx.cairo, items, sentToday }) as unknown as Json[];
  const summary = { at: ctx.now, items: items.length, alerts: p.alerts.length, digests: digests.length, external: p.external.length, resolved: p.resolved.length, by: countBy(items) };
  if (opts.dry) return json(200, { result: 'dry', ...summary, preview: p.alerts.slice(0, 50).map((a) => ({ source_key: a.source_key, title: a.title, to: a.role_id ?? a.user_id })) });
  // the bell rows (one insert), then the memory, then the external sends with their lines in the memory
  const alertRows = p.alerts.concat(digests.map(({ email: _e, whatsapp: _w, ...row }) => row));
  if (alertRows.length) { const { error } = await deps.db.from('alerts').insert(alertRows); if (error) throw new Error('db alerts ' + (error.code ?? '')); }
  const stateMap = new Map(p.state.map((s) => [s.source_key + '|' + s.entity_id + '|' + s.target, s]));
  const env = await vaultEnv(deps.db, deps.env); const link = p.external.some((x) => x.ch === 'whatsapp') || digests.some((d) => d.whatsapp) ? await waLink(deps) : null;
  const template = typeof ctx.notif.whatsappTemplate === 'string' && /^[a-z0-9_]{1,120}$/.test(ctx.notif.whatsappTemplate) ? ctx.notif.whatsappTemplate : 'ibtekr_alert';
  const signature = isObj(ctx.notif.quiet) && typeof ctx.notif.quiet.signature === 'string' ? ctx.notif.quiet.signature : 'فريق إبتكر كلوب';
  const sent = { email: 0, whatsapp: 0, failed: 0, not_linked: 0 };
  for (const x of p.external) {
    const r = x.ch === 'email' ? await sendEmail(deps, env, x.to.contact, x.title, x.body, signature) : await sendWa(deps, link, template, x.to.contact, waText(x.title, x.body));
    if (r.status === 'sent') sent[x.ch as 'email' | 'whatsapp']++; else if (r.status === 'not_linked') sent.not_linked++; else sent.failed++;
    const st = stateMap.get(x.key + '|' + x.entityId + '|' + x.target);
    if (st) { const log = Array.isArray(st.channel_log) ? st.channel_log.slice(-49) : []; log.push({ at: ctx.now, ch: x.ch, to: x.to.member ? 'm:' + x.to.member : 'v:' + x.to.vendor, status: r.status, ...(r.code ? { code: r.code } : {}), ...(x.escalation ? { esc: true } : {}) }); st.channel_log = log; }
  }
  // the digests' e-mails / WhatsApp go to the active members of the target (never logged beyond the counts)
  for (const d of digests) {
    const people = d.role_id ? ctx.members.filter((m) => m.role_id === d.role_id) : ctx.members.filter((m) => m.id === d.user_id);
    for (const m of people) {
      if (d.email && typeof m.email === 'string') { const r = await sendEmail(deps, env, m.email, d.title, d.body ?? '', signature); if (r.status === 'sent') sent.email++; else if (r.status === 'not_linked') sent.not_linked++; else sent.failed++; }
      if (d.whatsapp && typeof m.phone === 'string') { const r = await sendWa(deps, link, template, m.phone, waText(d.title, d.body ?? '')); if (r.status === 'sent') sent.whatsapp++; else if (r.status === 'not_linked') sent.not_linked++; else sent.failed++; }
    }
  }
  if (p.state.length) { const { error } = await deps.db.from('alert_state').upsert(p.state, { onConflict: 'source_key,entity_id,target' }); if (error) throw new Error('db alert_state ' + (error.code ?? '')); }
  const value = { ...summary, sent };
  await deps.db.from('sync_state').upsert({ key: 'notify', value, updated_at: ctx.now }, { onConflict: 'key' });
  return json(200, { result: 'ok', ...value });
}
function countBy(items: Item[]) { const g: Record<string, number> = {}; for (const it of items) g[it.key] = (g[it.key] || 0) + 1; return g; }

async function status(deps: Deps): Promise<Response> {
  const [last, link, env] = await Promise.all([deps.db.from('sync_state').select('value, updated_at').eq('key', 'notify').maybeSingle(), waLink(deps), vaultEnv(deps.db, deps.env)]);
  const { data: notif } = await deps.db.from('settings').select('data').eq('section', 'notif').maybeSingle();
  const n = isObj(notif?.data) ? notif.data : {};
  return json(200, { result: 'ok', last: isObj(last?.data) ? last.data.value ?? null : null, email: { ready: !!(env.RESEND_API_KEY ?? '').trim(), from: (env.RESEND_FROM ?? '').trim() || 'alerts@ibtekr.club' }, whatsapp: { ready: !!link, template: typeof n.whatsappTemplate === 'string' ? n.whatsappTemplate : 'ibtekr_alert' }, sources: SOURCES.map((s) => s.key) });
}

// ---------------------------------------------------------------- auth + handler

async function adminOf(req: Request, deps: Deps): Promise<string | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const { data, error } = await deps.userDb(jwt).rpc('is_admin'); if (error || data !== true) return null;
  return await deps.userId(jwt);
}
async function syncAllowed(deps: Deps, secret: string) { const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret }); return !error && data === true; }

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let parsed: unknown; try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {}; const action = typeof args.action === 'string' ? args.action : '';
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (action !== 'tick' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return await tick(deps); } catch (e) { console.error('notify tick: ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const admin = await adminOf(req, deps); if (!admin) return json(401, { error: 'unauthorized' });
  if (action !== 'tick' && action !== 'status') return json(400, { error: 'unknown_action' });
  try { return action === 'status' ? await status(deps) : await tick(deps, { dry: args.dry === true }); }
  catch (e) { console.error('notify ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(), fetch: globalThis.fetch,
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
