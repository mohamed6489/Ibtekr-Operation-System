// notify — the rules of the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md, 0157).
// Every tick (15 minutes) runs the admin's rules (notif_rules) that are due: each names an element › a type › a state of the catalogue
// (_shared/notif-catalog.js); `entities()` below reads what is in that state now (a «state»), what happened since the rule's last run
// (an «event»), or the date coming (a «due»), and _shared/notif-engine.js writes the `alerts` rows for the rule's roles and hides the
// old ones by the rule's «تفاصيل الظهور». The bell draws the sections from notif_sections. The channels: a rule that names e-mail /
// WhatsApp also sends its new rows to each member (outboundPlan → index.ts sendOut), while the admin's switch of the channel is on
// (Safwat 24 Nov: e-mail on, WhatsApp off until its API is turned on). Nothing here logs a phone, an address or a text.
import { catalogue as CAT, hidePlan, outboundPlan, partKey, partOfKey, permOf, reportPlan, runsNow, writePlan } from '../_shared/notif-engine.js';
import { LIVE_FROM } from '../_shared/legacy.js'; // phase 9: the imported old orders raise nothing
import { delayRules, leadBy, lineDelayOf, lineElapsed, lineIsOpen, orderDelayOf, orderElapsed } from '../_shared/delay.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
// group / n / pcs / st: who the alert is about and its counts — the bell draws and groups by them (alerts.meta — the bell's redesign)
export type Group = { g: 'vendor' | 'member' | 'agent' | 'customer'; id: string; name: string };
export type Ent = { id: string; name?: string; ref?: string; state?: string; line?: string; entity?: string; users?: string[]; only?: boolean; perm?: [string, string]; per?: Json;
  group?: Group; n?: number; pcs?: number; st?: string };
type Ctx = { now: string; nowMs: number; cairo: { day: string; time: string } };

const rows = (r: { data?: unknown }) => (Array.isArray(r?.data) ? r.data as Json[] : []);
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const D = 86400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * D).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / D);
const monthEnd = (day: string) => { const [y, m] = day.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const money = (n: number) => Math.round(n).toLocaleString('en-US') + ' ج.م';
const LIMIT = 2000;
const OPEN_ORDER = ['جاري التنفيذ', 'معلّق', 'جاهز للشحن', 'قيد الشحن'];
const ITEM_DONE = ['تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر', 'مرتجع للمورد', 'ملغي', 'اتسلم'];
const CUSTODY = 'أوبريشن'; // Safwat 24 Nov: the operations' custody = the «أوبريشن» account (0141)
const BASE_EXPENSES = ['المرتبات', 'الاشتراكات', 'الإعلانات'];

// ---------------------------------------------------------------- the people and the settings

type World = { members: Json[]; roles: Json[]; settings: Record<string, Json>; cache: Map<string, Promise<Ent[]>> };
async function world(db: Db): Promise<World> {
  const [roles, members, st] = await Promise.all([
    db.from('roles').select('id, name, permissions, level_perms').limit(200),
    db.from('profiles').select('id, name, role_id, extra_roles, level, custom_perms, manager_id, status').eq('status', 'active').limit(500),
    db.from('settings').select('section, data').in('section', ['hr', 'cs', 'makers']),
  ]);
  const settings: Record<string, Json> = {}; for (const r of rows(st)) settings[String(r.section)] = isObj(r.data) ? r.data : {};
  return { roles: rows(roles), members: rows(members), settings, cache: new Map() };
}
const rolesOfMember = (m: Json) => [m.role_id].concat(Array.isArray(m.extra_roles) ? m.extra_roles : []);
// the members of a team by its id or its current name (a request's «assignee_role» is the team's name — 0128)
function teamMembers(w: World, role: unknown): string[] {
  const r = w.roles.find((x) => x.id === role || String(x.name) === String(role)); const id = r ? r.id : null;
  return id ? w.members.filter((m) => rolesOfMember(m).includes(id)).map((m) => String(m.id)) : [];
}
const nameOf = (w: World, id: unknown) => { const m = w.members.find((x) => String(x.id) === String(id)); return m ? String(m.name) : 'عضو'; };
const mem = (w: World, id: unknown): Group => ({ g: 'member', id: String(id), name: nameOf(w, id) });
const ven = (v: Json | null | undefined, id?: unknown): Group | undefined => (v || id ? { g: 'vendor', id: String(v ? v.id : id), name: v ? String(v.name) : 'مبتكر' } : undefined);
// a team entity names the member it concerns and his manager (a partial «hr.view» sees no one else's)
const about = (w: World, id: unknown): string[] => { const m = w.members.find((x) => String(x.id) === String(id)); return [String(id)].concat(m && m.manager_id ? [String(m.manager_id)] : []); };

// ---------------------------------------------------------------- the orders and their lines (the delay — the settings' rules)

type OrdersRead = { O: Json[]; lines: Json[]; V: Map<string, Json>; orderState: Map<string, string>; lineState: Map<string, string> };
async function ordersRead(db: Db, w: World, ctx: Ctx): Promise<OrdersRead> {
  const today = ctx.cairo.day; const DR = delayRules((w.settings.makers ?? {}).delay);
  const [o, v] = await Promise.all([
    db.from('orders').select('id, number, customer_name, status, status_custom, woo_status, confirm, confirm_at, placed_at, updated_at, bosta_tracking, bosta_cod_error').in('status', OPEN_ORDER).is('deleted_at', null).gte('placed_at', LIVE_FROM).limit(LIMIT),
    db.from('vendors').select('id, name, lead_days, status').limit(LIMIT),
  ]);
  const O = rows(o); const V = new Map(rows(v).map((x) => [String(x.id), x]));
  const lines: Json[] = [];
  for (let i = 0; i < O.length; i += 300) lines.push(...rows(await db.from('order_items').select('id, order_id, sub_order_id, vendor_id, product_id, name, qty, status, expected_at, pulled').in('order_id', O.slice(i, i + 300).map((x) => x.id)).eq('removed', false).limit(10_000)));
  // the sub-orders' own status on the site — a line whose sub-order the site closed (shipped, completed …) is never late (lineIsOpen)
  const SO = new Map<string, string>(); for (let i = 0; i < O.length; i += 300) for (const x of rows(await db.from('sub_orders').select('id, woo_status').in('order_id', O.slice(i, i + 300).map((y) => y.id)).limit(10_000))) SO.set(String(x.id), String(x.woo_status ?? ''));
  const pids = [...new Set(lines.map((x) => x.product_id).filter((x) => x != null))];
  const PL = new Map<string, number>(); for (let i = 0; i < pids.length; i += 500) for (const x of rows(await db.from('product_lead_days').select('product_id, days').in('product_id', pids.slice(i, i + 500)))) PL.set(String(x.product_id), Number(x.days));
  const orderState = new Map<string, string>(); const lineState = new Map<string, string>();
  for (const ord of O) {
    const ov = { confirm: ord.confirm, confirmAt: ord.confirm_at, placedAt: ord.placed_at };
    const mine = lines.filter((x) => String(x.order_id) === String(ord.id));
    const leadOf = (it: Json) => { const vd = it.vendor_id ? V.get(String(it.vendor_id)) : null; return leadBy(it.product_id != null ? PL.get(String(it.product_id)) : null, vd ? vd.lead_days : null, DR); };
    const open = mine.filter((x) => x.vendor_id && !ITEM_DONE.includes(String(x.status)) && lineIsOpen({ siteStatus: (x.sub_order_id != null && SO.get(String(x.sub_order_id))) || ord.woo_status, pulled: x.pulled, status: x.status }));
    const maxLead = open.length ? Math.max(...open.map(leadOf)) : null;
    orderState.set(String(ord.id), orderDelayOf({ status: ord.status, elapsed: orderElapsed(ov, today, DR), maxLead }, DR) || 'ok');
    for (const it of open) lineState.set(String(it.id), lineDelayOf(lineElapsed({ notifiedAt: it.expected_at, ...ov }, today, DR), leadOf(it), true, DR, ord.status) || 'ok');
  }
  return { O, lines, V, orderState, lineState };
}
const ref = (o: Json) => 'IB-' + String(o.number ?? o.id);
const ageOf = (o: Json, today: string) => daysBetween(String(o.placed_at ?? today).slice(0, 10), today);
// a sub-order = the lines of one maker in one order
function subsOf(r: OrdersRead, pick: (it: Json) => boolean): Map<string, { order: Json; vendor: Json | null; lines: Json[] }> {
  const out = new Map<string, { order: Json; vendor: Json | null; lines: Json[] }>();
  const byId = new Map(r.O.map((x) => [String(x.id), x]));
  for (const it of r.lines) {
    if (!it.vendor_id || !pick(it)) continue; const ord = byId.get(String(it.order_id)); if (!ord) continue;
    const k = String(it.order_id) + ':' + String(it.vendor_id); const g = out.get(k) ?? { order: ord, vendor: r.V.get(String(it.vendor_id)) ?? null, lines: [] }; g.lines.push(it); out.set(k, g);
  }
  return out;
}
const DELAY_WORD: Record<string, string> = { late: 'متأخر', risk: 'قابل للتأخير', ok: 'غير متأخر' };
const pcsOf = (L: Json[]) => L.reduce((s, it) => s + (Number(it.qty) > 0 ? Number(it.qty) : 1), 0);

// ---------------------------------------------------------------- the events in the activity log since a time

async function logSince(db: Db, actions: string[], since: string): Promise<Json[]> {
  return rows(await db.from('activity_log').select('id, at, actor, action, entity, entity_id, new_value').in('action', actions).gte('at', since).order('at', { ascending: true }).limit(500));
}
const textOf = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

// ---------------------------------------------------------------- the entities of a rule

export async function entities(db: Db, w: World, ctx: Ctx, rule: Json, since: string): Promise<Ent[]> {
  const key = [rule.element, rule.type, rule.state, rule.sub ?? '', rule.param ?? '', CAT.kindOf(rule) === 'state' ? '' : since].join('|');
  const hit = w.cache.get(key); if (hit) return hit;
  const p = read(db, w, ctx, rule, since); w.cache.set(key, p); return p;
}
let ordersMemo: { at: string; p: Promise<OrdersRead> } | null = null;
const orders = (db: Db, w: World, ctx: Ctx) => { if (!ordersMemo || ordersMemo.at !== ctx.now) ordersMemo = { at: ctx.now, p: ordersRead(db, w, ctx) }; return ordersMemo.p; };

async function read(db: Db, w: World, ctx: Ctx, rule: Json, since: string): Promise<Ent[]> {
  const today = ctx.cairo.day; const el = String(rule.element); const ty = String(rule.type); const st = String(rule.state);
  const param = rule.param == null ? null : Number(rule.param);
  const def = (CAT.stateOf(el, ty, st, null) || {}).param; const P = param ?? (def ? Number(def.def) : null);
  switch (el + '.' + ty) {
    // ---- the daily report: one per day, its line per member (what he can see is open now)
    case 'daily.summary': {
      const r = await orders(db, w, ctx);
      const late = [...r.orderState.values()].filter((x) => x === 'late').length; const unconf = r.O.filter((o) => o.confirm === 'غير مؤكد').length;
      const lateLines = [...r.lineState.values()].filter((x) => x === 'late').length;
      const tk = rows(await db.from('tickets').select('id, assignee_role, status').in('status', ['open', 'in_progress', 'waiting']).limit(LIMIT));
      const conv = rows(await db.from('cs_conversations').select('id').eq('status', 'مستنية ردنا').limit(LIMIT)).length;
      return [{ id: 'daily:' + today, name: 'ملخص اليوم', ref: today, line: '', entity: 'dashboard', per: { orders: r.O.length, late, unconf, lateLines, tk, conv } }];
    }
    // ---- the operations' custody («أوبريشن»)
    case 'custody.balance': {
      if (st === 'low') {
        const mv = rows(await db.from('acc_account_moves').select('direction, amount').eq('account', CUSTODY).is('voided_at', null).limit(20_000));
        const bal = mv.reduce((s, m) => s + (m.direction === 'deposit' ? 1 : -1) * Number(m.amount || 0), 0);
        return bal < (P ?? 200) ? [{ id: 'custody:low', name: 'عهدة التشغيل', state: 'قربت تخلص', line: 'الرصيد ' + money(bal) + ' — أقل من ' + money(P ?? 200), entity: 'accounts' }] : [];
      }
      return rows(await db.from('acc_account_moves').select('id, direction, amount, note, created_at').eq('account', CUSTODY).eq('direction', st).is('voided_at', null).gte('created_at', since).limit(200))
        .map((m) => ({ id: 'custody:' + m.id, name: 'عهدة التشغيل', state: st === 'deposit' ? 'إيداع' : 'سحب', line: (st === 'deposit' ? 'إيداع ' : 'سحب ') + money(Number(m.amount)), entity: 'accounts' }));
    }
    // ---- the team
    case 'team.status': {
      if (st === 'eval_due') {
        const end = monthEnd(today); const left = daysBetween(today, end);
        return left <= (P ?? 2) ? [{ id: 'eval:' + today.slice(0, 7), name: 'التقييم الشهري', ref: today.slice(0, 7), line: left === 0 ? 'جه وقت تقييم الشهر' : 'فاضل ' + left + ' يوم على تقييم الشهر', entity: 'hr-evals' }] : [];
      }
      if (st === 'no_out') {
        const hr = w.settings.hr ?? {}; const to = /^\d{2}:\d{2}$/.test(String(hr.workTo)) ? String(hr.workTo) : '17:00';
        const lateDay = ctx.cairo.time >= addMin(to, 60);
        return rows(await db.from('hr_attendance').select('id, member_id, day, in_at, out_at').is('out_at', null).lte('day', today).limit(LIMIT))
          .filter((a) => String(a.day) < today || lateDay)
          .map((a) => ({ id: 'noout:' + a.id, name: nameOf(w, a.member_id), state: 'لم يسجل انصراف', line: nameOf(w, a.member_id) + ' مسجّلش انصراف يوم ' + String(a.day), entity: 'hr-team', users: about(w, a.member_id), group: mem(w, a.member_id) }));
      }
      if (st === 'no_in') {
        const hr = w.settings.hr ?? {}; const from = (m: Json) => scheduleFrom(hr, m) ?? (/^\d{2}:\d{2}$/.test(String(hr.workFrom)) ? String(hr.workFrom) : '09:00');
        const due = w.members.filter((m) => m.role_id !== 'admin' && ctx.cairo.time >= addMin(from(m), P ?? 60));
        if (!due.length) return [];
        const ids = due.map((m) => m.id);
        const [att, req, hol] = await Promise.all([
          db.from('hr_attendance').select('member_id').eq('day', today).in('member_id', ids).limit(LIMIT),
          db.from('hr_requests').select('member_id, from_day, to_day').eq('status', 'موافق').lte('from_day', today).gte('to_day', today).in('member_id', ids).limit(LIMIT),
          db.rpc('hr_holiday_days'),
        ]);
        if (Array.isArray(hol?.data) && hol.data.map(String).includes(today)) return [];
        const seen = new Set(rows(att).map((a) => String(a.member_id)).concat(rows(req).map((a) => String(a.member_id))));
        const out: Ent[] = [];
        for (const m of due) {
          if (seen.has(String(m.id))) continue;
          const wd = await db.rpc('hr_member_workday', { p_member: m.id, p_day: today }); if (wd?.data === false) continue;
          out.push({ id: 'noin:' + m.id + ':' + today, name: String(m.name), state: 'لم يسجل حضور', line: String(m.name) + ' مسجّلش حضور لحد دلوقتي (ميعاده ' + from(m) + ')', entity: 'hr-team', users: about(w, m.id), group: mem(w, m.id) });
        }
        return out;
      }
      if (st === 'ot_start') {
        return rows(await db.from('hr_attendance').select('id, member_id, ot_from').gte('ot_from', since).limit(200))
          .map((a) => ({ id: 'ot:' + a.id, name: nameOf(w, a.member_id), state: 'بدأ وقت إضافي', line: nameOf(w, a.member_id) + ' خلص ساعات العمل وبدأ وقت إضافي', entity: 'hr-team', users: about(w, a.member_id), group: mem(w, a.member_id) }));
      }
      return [];
    }
    case 'team.update': {
      if (st === 'clock_in' || st === 'clock_out') {
        const col = st === 'clock_in' ? 'in_at' : 'out_at';
        return rows(await db.from('hr_attendance').select('id, member_id, in_at, out_at').gte(col, since).limit(300))
          .map((a) => ({ id: st + ':' + a.id, name: nameOf(w, a.member_id), state: st === 'clock_in' ? 'سجّل حضور' : 'سجّل انصراف', line: nameOf(w, a.member_id) + (st === 'clock_in' ? ' سجّل حضور' : ' سجّل انصراف'), entity: 'hr-team', users: about(w, a.member_id), group: mem(w, a.member_id) }));
      }
      if (st === 'req_ot') {
        return rows(await db.from('hr_overtime').select('id, member_id, day, minutes, kind, created_at').gte('created_at', since).limit(200))
          .map((o) => ({ id: 'reqot:' + o.id, name: nameOf(w, o.member_id), state: 'طلب وقت إضافي', line: nameOf(w, o.member_id) + ' — ' + (o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي') + ' يوم ' + String(o.day), entity: 'hr', users: about(w, o.member_id), group: mem(w, o.member_id) }));
      }
      const types = rows(await db.from('hr_leave_types').select('name').limit(100)).map((t) => String(t.name));
      const pick = (t: string) => st === 'req_leave' ? types.includes(t) : st === 'req_advance' ? t === 'سُلفة' : st === 'req_rest' ? t === 'فترة راحة' : !types.includes(t) && t !== 'سُلفة' && t !== 'فترة راحة';
      return rows(await db.from('hr_requests').select('id, member_id, type, from_day, to_day, created_at').gte('created_at', since).limit(300)).filter((r) => pick(String(r.type)))
        .map((r) => ({ id: 'req:' + r.id, name: nameOf(w, r.member_id), state: String(r.type), line: nameOf(w, r.member_id) + ' طلب ' + String(r.type) + (r.from_day ? ' — ' + String(r.from_day) + (r.to_day && r.to_day !== r.from_day ? ' → ' + String(r.to_day) : '') : ''), entity: 'tickets', users: about(w, r.member_id), group: mem(w, r.member_id) }));
    }
    // ---- the main orders
    case 'orders.confirm': case 'orders.status': {
      const r = await orders(db, w, ctx);
      return r.O.filter((o) => ty === 'confirm' ? String(o.confirm) === st : (String(o.status) === st || String(o.status_custom ?? '') === st))
        .map((o) => ({ id: 'o:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: st, line: st + ' · عمره ' + ageOf(o, today) + ' يوم', entity: 'orders/' + String(o.number ?? o.id) }));
    }
    case 'orders.delay': {
      const r = await orders(db, w, ctx);
      return r.O.filter((o) => (r.orderState.get(String(o.id)) || 'ok') === st)
        .map((o) => ({ id: 'o:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: DELAY_WORD[st], line: 'أوردر ' + DELAY_WORD[st] + ' · ' + String(o.status), entity: 'orders/' + String(o.number ?? o.id) }));
    }
    case 'orders.update': {
      if (st === 'new') return rows(await db.from('orders').select('id, number, customer_name, created_at, deleted_at').gte('created_at', since).is('deleted_at', null).gte('placed_at', LIVE_FROM).limit(300))
        .map((o) => ({ id: 'onew:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: 'أوردر جديد', line: 'أوردر جديد ' + ref(o), entity: 'orders/' + String(o.number ?? o.id) }));
      if (st === 'delete') return rows(await db.from('orders').select('id, number, customer_name, deleted_at, delete_reason').gte('deleted_at', since).limit(300))
        .map((o) => ({ id: 'odel:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: 'اتمسح', line: 'اتمسح ' + ref(o) + (o.delete_reason ? ' — ' + String(o.delete_reason).slice(0, 80) : ''), entity: 'orders' }));
      return (await logSince(db, ['order.patch', 'order.status', 'order.confirm', 'order.edit', 'order.address'], since))
        .map((l) => ({ id: 'oedit:' + l.id, name: 'IB-' + String(l.entity_id ?? ''), ref: 'IB-' + String(l.entity_id ?? ''), state: 'تعديل', line: 'اتعدّل أوردر IB-' + String(l.entity_id ?? '') + ' بواسطة ' + nameOf(w, l.actor), entity: 'orders' }));
    }
    // ---- the sub-orders (a maker's lines in an order)
    case 'subs.status': {
      const r = await orders(db, w, ctx);
      return [...subsOf(r, (it) => String(it.status) === st).entries()].map(([k, g]) => ({ id: 's:' + k + ':' + st, name: g.vendor ? String(g.vendor.name) : 'مبتكر', ref: ref(g.order), state: st,
        line: (g.vendor ? String(g.vendor.name) : 'مبتكر') + ' · ' + g.lines.length + ' منتج · ' + st, entity: 'orders/' + String(g.order.number ?? g.order.id), group: ven(g.vendor, k.split(':')[1]), n: 1, pcs: pcsOf(g.lines) }));
    }
    case 'subs.delay': {
      const r = await orders(db, w, ctx);
      return [...subsOf(r, (it) => r.lineState.get(String(it.id)) === st).entries()].map(([k, g]) => ({ id: 's:' + k, name: g.vendor ? String(g.vendor.name) : 'مبتكر', ref: ref(g.order), state: DELAY_WORD[st],
        line: 'أوردر فرعي ' + DELAY_WORD[st] + ' · ' + (g.vendor ? String(g.vendor.name) : 'مبتكر') + ' · ' + g.lines.length + ' منتج', entity: 'orders/' + String(g.order.number ?? g.order.id), group: ven(g.vendor, k.split(':')[1]), n: 1, pcs: pcsOf(g.lines), st }));
    }
    case 'subs.update': {
      if (st === 'new') {
        const fresh = rows(await db.from('orders').select('id, number, created_at').gte('created_at', since).is('deleted_at', null).gte('placed_at', LIVE_FROM).limit(300)); if (!fresh.length) return [];
        const its = rows(await db.from('order_items').select('order_id, vendor_id').in('order_id', fresh.map((o) => o.id)).limit(3000));
        const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
        const seen = new Set<string>(); const out: Ent[] = [];
        for (const it of its) { const k = it.order_id + ':' + it.vendor_id; if (!it.vendor_id || seen.has(k)) continue; seen.add(k); const o = fresh.find((x) => String(x.id) === String(it.order_id))!;
          out.push({ id: 'snew:' + k, name: vs.get(String(it.vendor_id)) ?? 'مبتكر', ref: ref(o), state: 'أوردر فرعي جديد', line: 'أوردر فرعي جديد لـ ' + (vs.get(String(it.vendor_id)) ?? 'مبتكر') + ' في ' + ref(o), entity: 'orders/' + String(o.number ?? o.id) }); }
        return out;
      }
      const acts = st === 'delete' ? ['suborder.delete', 'order.line_delete'] : ['suborder.status', 'suborder.site_status', 'suborder.edit', 'order.line_qty', 'order.line_add'];
      return (await logSince(db, acts, since)).map((l) => ({ id: 'sact:' + l.id, name: 'IB-' + String(l.entity_id ?? ''), ref: 'IB-' + String(l.entity_id ?? ''), state: st === 'delete' ? 'حذف' : 'تعديل',
        line: (st === 'delete' ? 'اتمسح من أوردر فرعي في ' : 'اتعدّل أوردر فرعي في ') + 'IB-' + String(l.entity_id ?? '') + ' بواسطة ' + nameOf(w, l.actor), entity: 'orders' }));
    }
    // ---- the products
    case 'products.stock': {
      const ps = rows(await db.from('products').select('id, sku, name, status, lang, manage_stock, stock_quantity, stock_status').eq('status', 'publish').limit(20_000))
        .filter((p) => p.lang !== 'ar' && (p.manage_stock === true || p.stock_status === 'outofstock'));
      const q = (p: Json) => (p.stock_status === 'outofstock' && p.manage_stock !== true ? 0 : Number(p.stock_quantity ?? 0));
      const hit = ps.filter((p) => st === 'out' ? q(p) <= 0 : st === 'left1' ? q(p) === 1 : q(p) >= 2 && q(p) <= 3);
      return hit.slice(0, 200).map((p) => ({ id: 'p:' + p.id + ':' + st, name: String(p.name ?? p.sku), ref: String(p.sku ?? ''), state: (CAT.stateOf(el, ty, st, null) || {}).label,
        line: String(p.name ?? p.sku).slice(0, 80) + ' · ' + (q(p) <= 0 ? 'نفدت' : 'باقي ' + q(p)), entity: 'products' }));
    }
    case 'products.returns': {
      return rows(await db.from('inv_lots').select('id, sku, name, since, status').eq('reason', 'مرتجع').eq('status', 'بانتظار الفحص').is('closed_at', null).limit(LIMIT))
        .map((l) => ({ id: 'ret:' + l.id, name: String(l.name ?? l.sku), ref: String(l.sku ?? ''), state: 'مرتجع يحتاج فحص', line: 'مرتجع ' + String(l.name ?? l.sku).slice(0, 80) + ' مستني الفحص من ' + daysBetween(String(l.since ?? today).slice(0, 10), today) + ' يوم', entity: 'inventory' }));
    }
    case 'products.update': {
      const map: Record<string, string[]> = { trash: ['product.trash'], batch: ['product.create', 'product.duplicate'], draft: ['product.save', 'product.bulk'], edit: ['product.save', 'product.bulk', 'product.images.add'],
        move: ['product.bulk'], cat_add: ['product.category.create'], cat_delete: ['product.category.delete'], cat_edit: ['product.category.update', 'product.category.order'] };
      let L = await logSince(db, map[st] ?? [], since);
      if (st === 'move') L = L.filter((l) => /\bvendor\b/.test(textOf(l.new_value)));
      if (st === 'draft') L = L.filter((l) => /\bstatus\b/.test(textOf(l.new_value)));
      const word = (CAT.stateOf(el, ty, st, null) || {}).label;
      return L.map((l) => ({ id: 'pact:' + st + ':' + l.id, name: word, ref: String(l.entity_id ?? ''), state: word, line: word + ' — ' + textOf(l.new_value).replace(/["\\]/g, '').slice(0, 120) + ' · ' + nameOf(w, l.actor), entity: 'products' }));
    }
    // ---- the accounts
    case 'accounts.expenses': case 'accounts.payroll': case 'accounts.subs': case 'accounts.ads': {
      if (st === 'due' && ty === 'payroll') {
        const payDay = Math.min(28, Math.max(1, Number((w.settings.hr ?? {}).payDay) || 28));
        const [y, m, d] = today.split('-').map(Number); const pd = d > payDay ? new Date(Date.UTC(y, m, payDay)) : new Date(Date.UTC(y, m - 1, payDay)); const date = pd.toISOString().slice(0, 10);
        const left = daysBetween(today, date); if (left > (P ?? 2)) return [];
        const sheet = rows(await db.from('hr_payroll').select('month, status').eq('month', date.slice(0, 7) + '-01').limit(1))[0];
        if (sheet && sheet.status === 'مدفوع') return [];
        return [{ id: 'payroll:' + date.slice(0, 7), name: 'المرتبات', ref: date, state: 'قبل يوم الصرف', line: 'يوم الصرف ' + date + ' — فاضل ' + left + ' يوم', entity: 'hr-payroll', perm: ['sensitive.salaries', 'F'] }];
      }
      if (st === 'due' && ty === 'subs') {
        const subs = rows(await db.from('acc_expenses').select('id, sub_name, sub_ends').eq('category', 'الاشتراكات').is('voided_at', null).lte('sub_ends', addDays(today, P ?? 3)).gte('sub_ends', today).limit(LIMIT));
        const seen = new Set<string>(); const out: Ent[] = [];
        for (const s of subs.sort((a, b) => String(b.sub_ends).localeCompare(String(a.sub_ends)))) { const n = String(s.sub_name ?? 'اشتراك'); if (seen.has(n)) continue; seen.add(n);
          out.push({ id: 'sub:' + n + ':' + String(s.sub_ends).slice(0, 10), name: n, ref: String(s.sub_ends).slice(0, 10), state: 'قرب يتجدد', line: 'اشتراك ' + n + ' بيتجدد يوم ' + String(s.sub_ends).slice(0, 10), entity: 'accounts' }); }
        return out;
      }
      const cat = ty === 'payroll' ? 'المرتبات' : ty === 'subs' ? 'الاشتراكات' : ty === 'ads' ? 'الإعلانات' : null;
      let q = db.from('acc_expenses').select('id, category, direction, amount, beneficiary, sub_name, created_at').eq('direction', st).is('voided_at', null).gte('created_at', since);
      if (cat) q = q.eq('category', cat);
      return rows(await q.limit(300)).filter((x) => cat || !BASE_EXPENSES.includes(String(x.category)))
        .map((x) => ({ ...(ty === 'payroll' ? { perm: ['sensitive.salaries', 'F'] as [string, string] } : {}), id: 'exp:' + x.id, name: String(x.category), ref: '', state: st === 'deposit' ? 'إيداع' : 'سحب', line: String(x.category) + ' · ' + (st === 'deposit' ? 'إيداع ' : 'سحب ') + money(Number(x.amount)) + (x.sub_name ? ' · ' + String(x.sub_name) : x.beneficiary ? ' · ' + String(x.beneficiary).slice(0, 40) : ''), entity: 'accounts' }));
    }
    case 'accounts.makers': {
      if (st === 'close_due') {
        const end = monthEnd(today); const left = daysBetween(today, end);
        return left <= (P ?? 2) ? [{ id: 'close:' + today.slice(0, 7), name: 'حسابات المبتكرين', ref: end, state: 'قبل التقفيل', line: 'تقفيل حسابات المبتكرين يوم ' + end + (left ? ' — فاضل ' + left + ' يوم' : ' — النهارده'), entity: 'accounts-makers' }] : [];
      }
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      return rows(await db.from('acc_vendor_moves').select('id, vendor_id, direction, kind, kind_name, amount, created_at').eq('direction', st).is('voided_at', null).gte('created_at', since).limit(300))
        .map((x) => ({ id: 'vmove:' + x.id, name: vs.get(String(x.vendor_id)) ?? 'مبتكر', state: st === 'deposit' ? 'إيداع' : 'سحب', line: (vs.get(String(x.vendor_id)) ?? 'مبتكر') + ' · ' + String(x.kind_name ?? x.kind) + ' ' + money(Number(x.amount)), entity: 'accounts-makers',
          group: { g: 'vendor', id: String(x.vendor_id), name: vs.get(String(x.vendor_id)) ?? 'مبتكر' } as Group }));
    }
    case 'accounts.real': {
      // the bell's redesign decision 5: an account whose balance went under zero
      if (st === 'negative') {
        const mv = rows(await db.from('acc_account_moves').select('account, direction, amount').is('voided_at', null).limit(50_000)); const bal = new Map<string, number>();
        for (const m of mv) bal.set(String(m.account), (bal.get(String(m.account)) ?? 0) + (m.direction === 'deposit' ? 1 : -1) * Number(m.amount || 0));
        return [...bal.entries()].filter(([, b]) => b < 0).map(([a, b]) => ({ id: 'neg:' + a, name: a, state: 'بالسالب', line: 'حساب ' + a + ' رصيده ' + money(b), entity: 'accounts' }));
      }
      return rows(await db.from('acc_account_moves').select('id, account, direction, amount, created_at').eq('direction', st).is('voided_at', null).gte('created_at', since).limit(300))
        .map((x) => ({ id: 'amove:' + x.id, name: String(x.account), state: st === 'deposit' ? 'إيداع' : 'سحب', line: String(x.account) + ' · ' + (st === 'deposit' ? 'إيداع ' : 'سحب ') + money(Number(x.amount)), entity: 'accounts' }));
    }
    case 'accounts.summary': {
      const [ex, am] = await Promise.all([
        db.from('acc_expenses').select('direction, amount').eq('on_date', today).is('voided_at', null).limit(5000),
        db.from('acc_account_moves').select('direction, amount').eq('on_date', today).is('voided_at', null).limit(5000),
      ]);
      const all = rows(ex).concat(rows(am)); if (!all.length) return [];
      const sum = (d: string) => all.filter((x) => x.direction === d).reduce((s, x) => s + Number(x.amount || 0), 0);
      return [{ id: 'accsum:' + today, name: 'الحركة المالية', ref: today, state: 'ملخص اليوم', line: 'إيداعات ' + money(sum('deposit')) + ' · سحوبات ' + money(sum('withdraw')) + ' · ' + all.length + ' حركة', entity: 'accounts' }];
    }
    // ---- the team's requests
    case 'tickets.type': {
      const pick = (t: Json) => !rule.sub || String(t.type) === String(rule.sub);
      const users = (t: Json) => [...new Set(teamMembers(w, t.assignee_role).concat(t.assignee_member ? [String(t.assignee_member)] : [], t.created_by ? [String(t.created_by)] : []))];
      if (st === 'new') return rows(await db.from('tickets').select('id, type, title, assignee_role, assignee_member, created_by, created_at').gte('created_at', since).limit(300)).filter(pick)
        .map((t) => ({ id: 't:' + t.id, name: String(t.title ?? '').slice(0, 80), ref: 'TKT-' + String(t.id).padStart(4, '0'), state: 'طلب جديد', line: 'طلب جديد لـ ' + String(t.assignee_role) + ': ' + String(t.title ?? '').slice(0, 80), entity: 'tickets/TKT-' + String(t.id).padStart(4, '0'), users: users(t), only: true }));
      const stale = new Date(ctx.nowMs - 48 * 3600_000).toISOString();
      return rows(await db.from('tickets').select('id, type, title, assignee_role, assignee_member, created_by, status, follow_up, last_update').in('status', ['open', 'in_progress', 'waiting']).limit(LIMIT)).filter(pick)
        .filter((t) => (typeof t.follow_up === 'string' && t.follow_up.slice(0, 10) < today) || (t.last_update && String(t.last_update) < stale))
        .map((t) => ({ id: 'tl:' + t.id, name: String(t.title ?? '').slice(0, 80), ref: 'TKT-' + String(t.id).padStart(4, '0'), state: 'حالته ماتغيّرتش', line: 'طلب حالته ماتغيّرتش: ' + String(t.title ?? '').slice(0, 80), entity: 'tickets/TKT-' + String(t.id).padStart(4, '0'), users: users(t), only: true }));
    }
    case 'tickets.update': {
      const want: Record<string, (e: Json) => boolean> = { in_progress: (e) => e.new_value === 'in_progress', waiting: (e) => e.new_value === 'waiting', resolved: (e) => e.new_value === 'resolved',
        edit: (e) => e.kind === 'event' && !['open', 'in_progress', 'waiting', 'resolved', 'closed'].includes(String(e.new_value)) };
      const ev = rows(await db.from('ticket_events').select('id, ticket_id, kind, actor, new_value, at').gte('at', since).limit(500)).filter(want[st] ?? (() => false));
      if (!ev.length) return [];
      const tk = new Map(rows(await db.from('tickets').select('id, title, assignee_role, assignee_member, created_by').in('id', [...new Set(ev.map((e) => e.ticket_id))]).limit(500)).map((t) => [String(t.id), t]));
      const word = (CAT.stateOf(el, ty, st, null) || {}).label;
      return ev.map((e) => { const t = tk.get(String(e.ticket_id)); if (!t) return null; const code = 'TKT-' + String(t.id).padStart(4, '0');
        return { id: 'te:' + e.id, name: String(t.title ?? '').slice(0, 80), ref: code, state: word, line: code + ' — ' + word + ' · ' + nameOf(w, e.actor), entity: 'tickets/' + code,
          users: [...new Set(teamMembers(w, t.assignee_role).concat(t.assignee_member ? [String(t.assignee_member)] : [], t.created_by ? [String(t.created_by)] : []))].filter((u) => u !== String(e.actor)), only: true } as Ent; })
        .filter(Boolean) as Ent[];
    }
    // ---- the messages
    // the bell's redesign decision 5: a customer rated an order or a conversation P stars (2) or less — the rating's numbers only
    case 'messages.ratings': {
      const lim = P ?? 2;
      const [o, c] = await Promise.all([
        db.from('customer_ratings').select('id, order_id, sat, manners, at').gte('at', since).limit(300),
        db.from('cs_team_ratings').select('id, customer_id, conversation_id, sat, manners, at').gte('at', since).limit(300),
      ]);
      const low = (x: Json) => Math.min(Number(x.sat) || 5, Number(x.manners) || 5) <= lim;
      const ords = rows(o).filter(low); const nums = ords.length ? new Map(rows(await db.from('orders').select('id, number, customer_name').in('id', ords.map((x) => x.order_id)).limit(300)).map((x) => [String(x.id), x])) : new Map();
      return ords.map((x) => { const ord = nums.get(String(x.order_id)) as Json | undefined; const nm = String(ord?.customer_name ?? 'عميل').trim();
        return { id: 'rt:o:' + x.id, name: nm, ref: ord ? ref(ord) : '', state: 'تقييم واطي', line: nm + ' قيّم الأوردر ' + Number(x.sat) + '/5 رضا · ' + Number(x.manners) + '/5 أخلاق', entity: ord ? 'orders/' + String(ord.number ?? ord.id) : 'orders' } as Ent; })
        .concat(rows(c).filter(low).map((x) => ({ id: 'rt:c:' + x.id, name: 'عميل', state: 'تقييم واطي', line: 'تقييم محادثة ' + Number(x.sat) + '/5 رضا · ' + Number(x.manners) + '/5 أخلاق', entity: x.conversation_id ? 'cs/' + String(x.conversation_id) : 'cs-inbox',
          ...(x.conversation_id ? { group: { g: 'customer', id: String(x.conversation_id), name: 'عميل' } as Group } : {}) })));
    }
    case 'messages.customers': case 'messages.vendors': case 'messages.comments': {
      const seg = ty; const sla = Number((w.settings.cs ?? {}).sla_late_min) || 60;
      // a conversation with an assignee reaches him and the members who see all the conversations (cs.view F)
      const scope = (c: Json): Partial<Ent> => (c.assignee ? { users: w.members.filter((m) => String(m.id) === String(c.assignee) || permOf(m, w.roles, 'cs.view') === 'F').map((m) => String(m.id)) } : { perm: ['cs.view', 'F'] });
      const who = (c: Json) => String(c.handle ?? (seg === 'vendors' ? 'مبتكر' : 'عميل')).slice(0, 60);
      if (st === 'new') {
        const msgs = rows(await db.from('cs_messages').select('id, conversation_id, kind, created_at').eq('kind', 'in').gte('created_at', since).limit(1000)); if (!msgs.length) return [];
        const convs = rows(await db.from('cs_conversations').select('id, seg, handle, platform, assignee').in('id', [...new Set(msgs.map((m) => m.conversation_id))]).eq('seg', seg).limit(500));
        return convs.map((c) => { const mine = msgs.filter((m) => String(m.conversation_id) === String(c.id)); const last = mine[mine.length - 1];
          return { id: 'cin:' + c.id + ':' + last.id, name: who(c), state: 'رسالة جديدة', line: who(c) + ' · ' + mine.length + ' رسالة جديدة · ' + String(c.platform), entity: 'cs/' + c.id, ...scope(c), group: { g: 'customer', id: String(c.id), name: who(c) } } as Ent; });
      }
      const convs = rows(await db.from('cs_conversations').select('id, seg, handle, platform, assignee, waiting_since, status').eq('seg', seg).eq('status', 'مستنية ردنا').limit(LIMIT));
      return convs.map((c) => ({ c, min: Math.max(0, Math.round((ctx.nowMs - Date.parse(String(c.waiting_since ?? ctx.now))) / 60_000)) }))
        .filter((x) => st === 'waiting' || x.min >= sla)
        .map(({ c, min }) => ({ id: 'cw:' + c.id, name: who(c), state: st === 'waiting' ? 'مستني ردنا' : 'متأخر عن الرد', line: who(c) + ' مستني ردنا من ' + min + ' دقيقة · ' + String(c.platform), entity: 'cs/' + c.id, ...scope(c), group: { g: 'customer', id: String(c.id), name: who(c) } } as Ent));
    }
    // ---- the assistants (their notes reach the members who see that assistant — ai_agents.perm)
    case 'ai.buyer': case 'ai.designer': case 'ai.dev': case 'ai.any':
    case 'ai.manager': case 'ai.stock': case 'ai.cs': case 'ai.makers': case 'ai.accountant': case 'ai.hr': case 'ai.content': { // the bell's redesign decision 4
      const agents = rows(await db.from('ai_agents').select('id, name, perm').limit(100)); const agentPerm = (id: string) => { const a = agents.find((x) => x.id === id); return a && typeof a.perm === 'string' ? a.perm : 'marketing.view'; };
      const agentName = (id: string) => { const a = agents.find((x) => x.id === id); return a ? String(a.name) : id; };
      const seers = (perm: string) => w.members.filter((m) => permOf(m, w.roles, perm) !== 'N').map((m) => String(m.id)); // who sees that assistant
      const mkt = seers('marketing.view');
      const notes = async (agent: string | null, test: (n: Json) => boolean): Promise<Ent[]> => {
        let q = db.from('ai_agent_notes').select('id, agent, kind, title, body, ref, link, created_at').gte('created_at', since); if (agent) q = q.eq('agent', agent);
        return rows(await q.limit(300)).filter(test).map((n) => ({ id: 'note:' + n.id, name: agentName(String(n.agent)), state: String(n.kind), line: String(n.title), entity: n.link ? String(n.link) : 'ai-' + String(n.agent), users: seers(agentPerm(String(n.agent))),
          group: { g: 'agent', id: String(n.agent), name: agentName(String(n.agent)) } as Group }));
      };
      // the bell's redesign decision 4: a built-in assistant's own type — its team's daily summary, the work late at its team, its rules
      if (CAT.AGENTS.some(([id]: [string, string]) => id === ty)) {
        const R = String; const want = st === 'summary' ? (n: Json) => /^team:/.test(R(n.ref)) : st === 'late' ? (n: Json) => /^(late|cs-late):/.test(R(n.ref)) : (n: Json) => /^rule:/.test(R(n.ref));
        return notes(ty, want);
      }
      // the assistants the admin added (the built-in ones have their own types)
      if (ty === 'any') return notes(null, (n) => !['buyer', 'designer', 'dev'].concat(CAT.AGENTS.map(([id]: [string, string]) => id)).includes(String(n.agent)));
      if (ty === 'dev') return notes('dev', (n) => st === 'wp' ? /^dev:wp:/.test(String(n.ref)) : st === 'speed' ? /^dev:speed:/.test(String(n.ref)) : /^dev:/.test(String(n.ref)) && !/^dev:(wp|speed):/.test(String(n.ref)));
      if (ty === 'buyer' && st === 'pixel') return notes('buyer', (n) => /^pixel:/.test(String(n.ref)));
      if (ty === 'buyer' && st === 'campaigns') return (await notes('buyer', (n) => /^(daily|rule):/.test(String(n.ref)))).concat(rows(await db.from('mkt_suggestions').select('id, platform, kind, campaign_name, title, status, created_at').gte('created_at', since).limit(200))
        .map((s) => ({ id: 'sg:' + s.id, name: String(s.campaign_name ?? 'حملة'), state: String(s.kind), line: String(s.title ?? s.kind) + ' — ' + String(s.campaign_name ?? ''), entity: 'ai-buyer', users: mkt })));
      if (ty === 'buyer' && st === 'post') return rows(await db.from('mkt_posts').select('id, name, platform, kind, published_at').gte('published_at', since).limit(200))
        .map((p) => ({ id: 'post:' + p.id, name: String(p.name ?? 'بوست'), state: 'اتنشر', line: 'اتنشر ' + String(p.kind ?? 'بوست') + ' على ' + String(p.platform) + ' — ' + String(p.name ?? '').slice(0, 60), entity: 'marketing-log', users: mkt }));
      if (ty === 'designer' && st === 'trends') {
        const tr = rows(await db.from('mkt_trends').select('id, batch, title, found_at').gte('found_at', since).limit(300)); if (!tr.length) return [];
        const batches = new Map<string, Json[]>(); for (const t of tr) { const k = String(t.batch ?? t.id); const l = batches.get(k) ?? []; l.push(t); batches.set(k, l); }
        return [...batches.entries()].map(([k, l]) => ({ id: 'tr:' + k, name: 'آخر التريندات', state: 'تريندات جديدة', line: l.length + ' تريند جديد — ' + String(l[0].title ?? '').slice(0, 60), entity: 'ai-designer', users: mkt }));
      }
      if (ty === 'designer' && st === 'campaign') return rows(await db.from('mkt_campaigns').select('id, name, created_at, archived_at').gte('created_at', since).is('archived_at', null).limit(200))
        .map((c) => ({ id: 'camp:' + c.id, name: String(c.name ?? 'كامبين'), state: 'كامبين جديدة', line: 'كامبين جديدة: ' + String(c.name ?? '').slice(0, 80), entity: 'marketing', users: mkt }));
      return [];
    }
    // ---- the makers
    case 'makers.making': {
      if (st === 'late' || st === 'risk') {
        const r = await orders(db, w, ctx); const per = new Map<string, Set<string>>(); const pcs = new Map<string, number>();
        for (const it of r.lines) { if (r.lineState.get(String(it.id)) !== st || !it.vendor_id) continue; const s = per.get(String(it.vendor_id)) ?? new Set(); s.add(String(it.order_id)); per.set(String(it.vendor_id), s);
          pcs.set(String(it.vendor_id), (pcs.get(String(it.vendor_id)) ?? 0) + pcsOf([it])); }
        return [...per.entries()].map(([vid, s]) => { const v = r.V.get(vid); const n = v ? String(v.name) : 'مبتكر';
          return { id: 'mk:' + st + ':' + vid, name: n, state: DELAY_WORD[st], line: n + ' · ' + s.size + ' أوردر ' + (st === 'late' ? 'متأخر' : 'قابل للتأخير') + ' · ' + (pcs.get(vid) ?? 0) + ' قطعة', entity: 'makers',
            group: ven(v, vid), n: s.size, pcs: pcs.get(vid) ?? 0, st }; });
      }
      const acts = st === 'confirmed' ? ['order.confirm'] : ['order.cancel', 'order.status'];
      let L = await logSince(db, acts, since);
      if (st === 'cancelled') L = L.filter((l) => l.action === 'order.cancel' || /ملغي/.test(textOf(l.new_value)));
      if (st === 'confirmed') L = L.filter((l) => /مؤكد/.test(textOf(l.new_value)));
      if (!L.length) return [];
      const ids = [...new Set(L.map((l) => Number(l.entity_id)).filter((n) => Number.isFinite(n)))];
      const its = ids.length ? rows(await db.from('order_items').select('order_id, vendor_id').in('order_id', ids).limit(3000)) : [];
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      const out: Ent[] = []; const seen = new Set<string>();
      for (const l of L) for (const it of its.filter((x) => String(x.order_id) === String(l.entity_id))) {
        const k = l.id + ':' + it.vendor_id; if (!it.vendor_id || seen.has(k)) continue; seen.add(k); const n = vs.get(String(it.vendor_id)) ?? 'مبتكر';
        out.push({ id: 'mk:' + st + ':' + k, name: n, ref: 'IB-' + String(l.entity_id), state: st === 'confirmed' ? 'أوردر مؤكد' : 'أوردر ملغي', line: n + ' · ' + (st === 'confirmed' ? 'اتأكد' : 'اتلغى') + ' أوردر IB-' + String(l.entity_id), entity: 'orders/' + String(l.entity_id),
          group: { g: 'vendor', id: String(it.vendor_id), name: n } });
      }
      return out;
    }
    case 'makers.accounts': {
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      if (st === 'withdraw') return rows(await db.from('dokan_withdrawals').select('id, vendor_id, amount, status, requested_at, synced_at').eq('status', 'pending').gte('synced_at', since).limit(200))
        .map((x) => ({ id: 'wd:' + x.id, name: vs.get(String(x.vendor_id)) ?? 'مبتكر', state: 'طلب سحب', line: (vs.get(String(x.vendor_id)) ?? 'مبتكر') + ' طلب سحب ' + money(Number(x.amount)), entity: 'accounts-makers',
          group: { g: 'vendor', id: String(x.vendor_id), name: vs.get(String(x.vendor_id)) ?? 'مبتكر' } }));
      // the bell's redesign decision 5: a withdrawal request still waiting on Dokan after P days (2)
      if (st === 'withdraw_wait') {
        const limit = new Date(ctx.nowMs - (P ?? 2) * D).toISOString();
        return rows(await db.from('dokan_withdrawals').select('id, vendor_id, amount, status, requested_at').eq('status', 'pending').lte('requested_at', limit).limit(200))
          .map((x) => { const n = vs.get(String(x.vendor_id)) ?? 'مبتكر'; const d = Math.max(1, Math.floor((ctx.nowMs - Date.parse(String(x.requested_at))) / D));
            return { id: 'wdw:' + x.id, name: n, state: 'طلب سحب مستني', line: n + ' · طلب سحب ' + money(Number(x.amount)) + ' مستني من ' + d + ' يوم', entity: 'accounts-makers', group: { g: 'vendor', id: String(x.vendor_id), name: n } } as Ent; });
      }
      return rows(await db.from('acc_vendor_settlements').select('id, vendor_id, cash, created_at').gte('created_at', since).limit(200))
        .map((x) => ({ id: 'settle:' + x.id, name: vs.get(String(x.vendor_id)) ?? 'مبتكر', state: 'اتقفل حسابه', line: 'اتقفل حساب ' + (vs.get(String(x.vendor_id)) ?? 'مبتكر') + ' — اتحوّل ' + money(Number(x.cash)), entity: 'accounts-makers' }));
    }
    case 'makers.update': {
      const map: Record<string, string[]> = { add: ['vendor.create'], delete: ['vendor.delete', 'vendor.archive', 'vendor.remove'], edit: ['vendor.update', 'vendor.bank', 'vendor.contract', 'vendor.photo'],
        brand: ['vendor.brand', 'vendor.brand.site'], move: ['product.bulk'], status: ['vendor.status'] };
      let L = await logSince(db, map[st] ?? [], since);
      if (st === 'move') L = L.filter((l) => /\bvendor\b/.test(textOf(l.new_value)));
      const word = (CAT.stateOf(el, ty, st, null) || {}).label;
      return L.map((l) => ({ id: 'vact:' + st + ':' + l.id, name: word, ref: String(l.entity_id ?? ''), state: word, line: word + ' · ' + nameOf(w, l.actor), entity: st === 'move' ? 'products' : 'makers' }));
    }
    // ---- the bell's redesign decision 5 — the shipping, the stock and the links
    case 'orders.shipping': {
      const r = await orders(db, w, ctx);
      if (st === 'no_bosta') {
        const limit = new Date(ctx.nowMs - (P ?? 1) * D).toISOString();
        return r.O.filter((o) => String(o.status) === 'جاهز للشحن' && !o.bosta_tracking && String(o.updated_at ?? o.placed_at) <= limit)
          .map((o) => ({ id: 'nb:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: 'مااتبعتش لبوسطة', line: 'جاهز للشحن ومااتبعتش لبوسطة · عمره ' + ageOf(o, today) + ' يوم', entity: 'orders/' + String(o.number ?? o.id) }));
      }
      // the COD bosta refused to change (0144) — any order, open or not
      return rows(await db.from('orders').select('id, number, customer_name, bosta_tracking, bosta_cod_error').not('bosta_cod_error', 'is', null).is('deleted_at', null).gte('placed_at', LIVE_FROM).limit(300))
        .map((o) => ({ id: 'cod:' + o.id, name: String(o.customer_name ?? '').trim(), ref: ref(o), state: 'التحصيل مااتحدثش', line: 'بوسطة رفضت تعديل التحصيل · ' + String(o.bosta_tracking ?? ''), entity: 'orders/' + String(o.number ?? o.id) }));
    }
    case 'inventory.consolidation': {
      const inv = rows(await db.from('settings').select('data').eq('section', 'inventory').limit(1))[0]; const days = P ?? (Number(isObj(inv?.data) ? inv.data.consolidationAlert : null) || 5);
      const cons = rows(await db.from('inv_consolidations').select('id, order_id, since, status, closed_at').is('closed_at', null).limit(500))
        .filter((c) => daysBetween(String(c.since ?? today).slice(0, 10), today) >= days);
      if (!cons.length) return [];
      const ords = new Map(rows(await db.from('orders').select('id, number, customer_name').in('id', cons.map((c) => c.order_id)).limit(500)).map((o) => [String(o.id), o]));
      return cons.map((c) => { const o = ords.get(String(c.order_id)) as Json | undefined; const d = daysBetween(String(c.since ?? today).slice(0, 10), today);
        return { id: 'cons:' + c.id, name: String(o?.customer_name ?? '').trim(), ref: o ? ref(o) : '', state: 'عدّى مدته', line: 'تجميع ' + (o ? ref(o) : '') + ' في المخزن بقاله ' + d + ' يوم', entity: 'inventory-consolidate' } as Ent; });
    }
    case 'inventory.lost': {
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      // a lot turns «مفقود» from the return's inspection (updated_at) or is written so from the orders page (0154 — created_at only)
      const when = (l: Json) => [l.updated_at, l.created_at].filter(Boolean).map(String).sort().pop() ?? '';
      return rows(await db.from('inv_lots').select('id, sku, name, vendor_id, ref, created_at, updated_at').eq('status', 'مفقود').order('created_at', { ascending: false }).limit(500))
        .filter((l) => when(l) >= since).slice(0, 200)
        .map((l) => { const n = l.vendor_id ? vs.get(String(l.vendor_id)) ?? 'مبتكر' : null;
          return { id: 'lost:' + l.id, name: String(l.name ?? l.sku), ref: String(l.sku ?? ''), state: 'مفقود', line: 'اتعلّمت مفقود: ' + String(l.name ?? l.sku).slice(0, 80) + (l.ref ? ' · ' + String(l.ref) : ''), entity: 'inventory-returns',
            ...(n ? { group: { g: 'vendor', id: String(l.vendor_id), name: n } as Group } : {}) } as Ent; });
    }
    // a link that stopped: a channel the admin connected now in error, an ads account with an error code, or the site's sync failing
    // three times in a row in the last hour — names and codes only
    case 'system.links': {
      const out: Ent[] = [];
      // Meta refused a send in the last day because its token died (OAuth code 190): the page / WhatsApp link needs connecting again
      const dead = rows(await db.from('cs_messages').select('conversation_id, meta').eq('delivery', 'failed').gte('created_at', new Date(ctx.nowMs - D).toISOString()).limit(500))
        .filter((m) => isObj(m.meta) && /^graph_190(:|$)/.test(String(m.meta.error ?? '')));
      if (dead.length) out.push({ id: 'link:meta', name: 'Meta', state: 'وقف', line: 'ربط Meta (الصفحة أو واتساب) انتهى — اربطه تاني من الإعدادات', entity: 'settings-integrations' });
      for (const a of rows(await db.from('mkt_ad_objects').select('platform, id, name, meta').eq('kind', 'account').limit(20)))
        if (isObj(a.meta) && a.meta.error) out.push({ id: 'link:ads:' + a.platform, name: String(a.platform), state: 'وقف', line: 'حساب إعلانات ' + String(a.platform) + ' مش بيتقري (' + String(a.meta.error).slice(0, 40) + ')', entity: 'settings-integrations' });
      const last = rows(await db.from('woo_sync_log').select('result, at').eq('direction', 'in').gte('at', new Date(ctx.nowMs - 3600_000).toISOString()).order('at', { ascending: false }).limit(3));
      if (last.length === 3 && last.every((x) => String(x.result) === 'error')) out.push({ id: 'link:woo', name: 'الموقع', state: 'وقف', line: 'مزامنة الموقع فشلت 3 مرات ورا بعض في آخر ساعة', entity: 'settings-integrations' });
      return out;
    }
  }
  return [];
}
const addMin = (hhmm: string, min: number) => { const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + min; const c = Math.min(t, 23 * 60 + 59); return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0'); };
// a member's own start time: his schedule, else his primary role's (settings «hr».schedules — 0087 / 0101)
function scheduleFrom(hr: Json, m: Json): string | null {
  const s = isObj(hr.schedules) ? hr.schedules : {}; const ok = (x: unknown) => (isObj(x) && /^\d{2}:\d{2}$/.test(String(x.from)) ? String(x.from) : null);
  return ok(isObj(s.member) ? s.member[m.id] : null) ?? ok(isObj(s.role) ? s.role[m.role_id] : null);
}

// the daily report's line for one member: what his pages show open now (null = nothing for him — no alert)
function dailyLine(e: Ent, m: Json, w: World): string | null {
  const p = e.per ?? {}; const parts: string[] = [];
  if (permOf(m, w.roles, 'orders.view') !== 'N') { parts.push(p.orders + ' أوردر مفتوح'); if (p.late) parts.push(p.late + ' متأخر'); if (p.unconf) parts.push(p.unconf + ' غير مؤكد'); }
  if (permOf(m, w.roles, 'vendors.view') !== 'N' && p.lateLines) parts.push(p.lateLines + ' منتج متأخر عند المبتكرين');
  if (permOf(m, w.roles, 'cs.view') !== 'N' && p.conv) parts.push(p.conv + ' محادثة مستنية ردنا');
  if (permOf(m, w.roles, 'tickets.view') !== 'N') {
    const tk = (p.tk ?? []).filter((t: Json) => m.role_id === 'admin' || teamMembers(w, t.assignee_role).includes(String(m.id)));
    if (tk.length) parts.push(tk.length + ' طلب مفتوح');
  }
  return parts.length ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------- the tick of the rules

export async function runRules(db: Db, ctx: Ctx, opts: { dry?: boolean; gates?: { email?: boolean; whatsapp?: boolean } } = {}): Promise<Json> {
  ordersMemo = null;
  const COLS = 'id, section_id, name, element, type, state, sub, param, at, repeat, days, show, hours, roles, channels, template, active, last_run, updated_at';
  let rl = await db.from('notif_rules').select(COLS + ', mode, conds, level').limit(500); // 0165: the level the admin picked
  if (rl.error) rl = await db.from('notif_rules').select(COLS + ', mode, conds').limit(500); // before 0165
  if (rl.error) rl = await db.from('notif_rules').select(COLS).limit(500); // before 0162 (one element, «فردي»)
  if (rl.error) return { skipped: 'no_rules' }; // before 0157
  const rules = rows(rl); if (!rules.length) return { rules: 0 };
  const w = await world(db);
  const sum = { rules: rules.length, ran: 0, written: 0, replaced: 0, hidden: 0, failed: 0 };
  const ids = rules.map((r) => r.id);
  const shown = rows(await db.from('alerts').select('id, rule_id, entity_id, user_id, at, hide_at').in('rule_id', ids).is('hide_at', null).limit(20_000));
  const reads = new Map<string, string>();
  const shownIds = shown.map((a) => a.id);
  for (let i = 0; i < shownIds.length; i += 500) for (const r of rows(await db.from('alert_reads').select('alert_id, read_at').in('alert_id', shownIds.slice(i, i + 500)))) reads.set(String(r.alert_id), String(r.read_at));
  const inserts: Json[] = []; const retired: number[] = []; const hides: Json[] = []; const ranIds: string[] = [];
  for (const rule of rules) {
    try {
      const mine = shown.filter((a) => a.rule_id === rule.id);
      const due = runsNow(rule, ctx.cairo);
      const since = rule.last_run ?? new Date(Math.max(Date.parse(rule.updated_at ?? ctx.now), ctx.nowMs - 20 * 60_000)).toISOString();
      const parts: Json[] = CAT.partsOf(rule); // the rule's own element + its extra ones (0162 — Safwat 24 Nov)
      const lineOf = (p: Json) => (p.element === 'daily' ? (e: Ent, m: Json) => dailyLine(e, m, w) : undefined);
      if (rule.mode === 'report') {
        // «تقرير»: one alert per member and run with all the parts' things; the run renews it (the old one leaves the bell)
        if (due && rule.active !== false) {
          const got = []; for (const p of parts) got.push({ rule: p, ents: await entities(db, w, ctx, p, since), lineFor: lineOf(p) });
          inserts.push(...reportPlan({ rule, parts: got, members: w.members, roles: w.roles, now: ctx.now, lists: {} }));
          const old = mine.filter((a) => !a.hide_at).map((a) => a.id); retired.push(...old); ranIds.push(rule.id); sum.ran++; sum.replaced += old.length;
        }
        hides.push(...hidePlan({ rule, alerts: mine.filter((a) => !retired.includes(a.id)), inState: null, reads, now: ctx.now }));
      } else for (const p of parts) {
        // «فردي»: each part as its own rule (its kind, its entities); an extra part's entity ids carry «x<part>|»
        const kind = CAT.kindOf(p); const its = mine.filter((a) => partOfKey(a.entity_id) === p.part);
        const needState = rule.active !== false && kind === 'state' && (due || (rule.show === 'until_state' && its.length > 0));
        const raw = due || needState ? await entities(db, w, ctx, p, since) : null;
        const ents = raw ? raw.map((e) => (p.part ? { ...e, id: partKey(p.part, e.id) } : e)) : null;
        if (due && ents) {
          const existing = rows(await db.from('alerts').select('id, entity_id, user_id, hide_at').eq('rule_id', rule.id).in('entity_id', ents.map((e) => e.id).slice(0, 500)).limit(20_000));
          const plan = writePlan({ rule: p, ents, existing, members: w.members, roles: w.roles, now: ctx.now, lineFor: lineOf(p) });
          inserts.push(...plan.inserts); retired.push(...plan.retire); sum.replaced += plan.retire.length;
        }
        const inState = kind === 'state' && ents ? new Set(ents.map((e) => e.id)) : null;
        hides.push(...hidePlan({ rule: p, alerts: its.filter((a) => !retired.includes(a.id)), inState, reads, now: ctx.now }));
      }
      if (due && rule.mode !== 'report') { ranIds.push(rule.id); sum.ran++; }
    } catch (e) { sum.failed++; console.error('notify rule ' + String(rule.id).slice(0, 8) + ': ' + String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 120)); }
  }
  // the alerts of a rule the admin deleted keep their sub-section and lose the rule: they leave the bell
  const orphans = rows(await db.from('alerts').select('id').is('rule_id', null).not('section_id', 'is', null).is('hide_at', null).limit(5000));
  hides.push(...orphans.map((a) => ({ id: a.id, hide_at: ctx.now })));
  hides.push(...retired.map((id) => ({ id, hide_at: ctx.now })));
  sum.written = inserts.length; sum.hidden = hides.length;
  // the outbound channels (e-mail / WhatsApp): the messages of this tick's new rows, sent by the caller (index.ts) — never stored
  const outbound = outboundPlan({ rules, inserts, gates: opts.gates || {} });
  if (opts.dry) return { ...sum, out: outbound.length, preview: inserts.slice(0, 50).map((a) => ({ title: a.title, to: a.user_id, rule: a.rule_id })) };
  for (let i = 0; i < inserts.length; i += 500) { const { error } = await db.from('alerts').insert(inserts.slice(i, i + 500)); if (error) throw new Error('db alerts ' + (error.code ?? '')); }
  const byTime = new Map<string, number[]>(); for (const h of hides) { const l = byTime.get(h.hide_at) ?? []; l.push(h.id); byTime.set(h.hide_at, l); }
  for (const [at, list] of byTime) for (let i = 0; i < list.length; i += 500) await db.from('alerts').update({ hide_at: at }).in('id', list.slice(i, i + 500));
  if (ranIds.length) await db.from('notif_rules').update({ last_run: ctx.now }).in('id', ranIds);
  return { ...sum, outbound };
}
