// notify — the rules of the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md, 0157).
// Every tick (15 minutes) runs the admin's rules (notif_rules) that are due: each names an element › a type › a state of the catalogue
// (_shared/notif-catalog.js); `entities()` below reads what is in that state now (a «state»), what happened since the rule's last run
// (an «event»), or the date coming (a «due»), and _shared/notif-engine.js writes the `alerts` rows for the rule's roles and hides the
// old ones by the rule's «تفاصيل الظهور». The bell draws the sections from notif_sections. The channels: the bell only for now — a rule
// that names e-mail / WhatsApp writes the bell row and nothing else (Safwat 24 Nov). Nothing here logs a phone, an address or a text.
import { catalogue as CAT, hidePlan, permOf, runsNow, writePlan } from '../_shared/notif-engine.js';
import { delayRules, leadBy, lineDelayOf, lineElapsed, orderDelayOf, orderElapsed } from '../_shared/delay.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Ent = { id: string; name?: string; ref?: string; state?: string; line?: string; entity?: string; users?: string[]; perm?: [string, string]; per?: Json };
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

// ---------------------------------------------------------------- the orders and their lines (the delay — the settings' rules)

type OrdersRead = { O: Json[]; lines: Json[]; V: Map<string, Json>; orderState: Map<string, string>; lineState: Map<string, string> };
async function ordersRead(db: Db, w: World, ctx: Ctx): Promise<OrdersRead> {
  const today = ctx.cairo.day; const DR = delayRules((w.settings.makers ?? {}).delay);
  const [o, v] = await Promise.all([
    db.from('orders').select('id, number, customer_name, status, status_custom, confirm, confirm_at, placed_at').in('status', OPEN_ORDER).is('deleted_at', null).limit(LIMIT),
    db.from('vendors').select('id, name, lead_days, status').limit(LIMIT),
  ]);
  const O = rows(o); const V = new Map(rows(v).map((x) => [String(x.id), x]));
  const lines: Json[] = [];
  for (let i = 0; i < O.length; i += 300) lines.push(...rows(await db.from('order_items').select('id, order_id, vendor_id, product_id, name, status, expected_at').in('order_id', O.slice(i, i + 300).map((x) => x.id)).eq('removed', false).limit(10_000)));
  const pids = [...new Set(lines.map((x) => x.product_id).filter((x) => x != null))];
  const PL = new Map<string, number>(); for (let i = 0; i < pids.length; i += 500) for (const x of rows(await db.from('product_lead_days').select('product_id, days').in('product_id', pids.slice(i, i + 500)))) PL.set(String(x.product_id), Number(x.days));
  const orderState = new Map<string, string>(); const lineState = new Map<string, string>();
  for (const ord of O) {
    const ov = { confirm: ord.confirm, confirmAt: ord.confirm_at, placedAt: ord.placed_at };
    const mine = lines.filter((x) => String(x.order_id) === String(ord.id));
    const leadOf = (it: Json) => { const vd = it.vendor_id ? V.get(String(it.vendor_id)) : null; return leadBy(it.product_id != null ? PL.get(String(it.product_id)) : null, vd ? vd.lead_days : null, DR); };
    const open = mine.filter((x) => x.vendor_id && !ITEM_DONE.includes(String(x.status)));
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
          .map((a) => ({ id: 'noout:' + a.id, name: nameOf(w, a.member_id), state: 'لم يسجل انصراف', line: nameOf(w, a.member_id) + ' مسجّلش انصراف يوم ' + String(a.day), entity: 'hr-team' }));
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
          out.push({ id: 'noin:' + m.id + ':' + today, name: String(m.name), state: 'لم يسجل حضور', line: String(m.name) + ' مسجّلش حضور لحد دلوقتي (ميعاده ' + from(m) + ')', entity: 'hr-team' });
        }
        return out;
      }
      if (st === 'ot_start') {
        return rows(await db.from('hr_attendance').select('id, member_id, ot_from').gte('ot_from', since).limit(200))
          .map((a) => ({ id: 'ot:' + a.id, name: nameOf(w, a.member_id), state: 'بدأ وقت إضافي', line: nameOf(w, a.member_id) + ' خلص ساعات العمل وبدأ وقت إضافي', entity: 'hr-team' }));
      }
      return [];
    }
    case 'team.update': {
      if (st === 'clock_in' || st === 'clock_out') {
        const col = st === 'clock_in' ? 'in_at' : 'out_at';
        return rows(await db.from('hr_attendance').select('id, member_id, in_at, out_at').gte(col, since).limit(300))
          .map((a) => ({ id: st + ':' + a.id, name: nameOf(w, a.member_id), state: st === 'clock_in' ? 'سجّل حضور' : 'سجّل انصراف', line: nameOf(w, a.member_id) + (st === 'clock_in' ? ' سجّل حضور' : ' سجّل انصراف'), entity: 'hr-team' }));
      }
      if (st === 'req_ot') {
        return rows(await db.from('hr_overtime').select('id, member_id, day, minutes, kind, created_at').gte('created_at', since).limit(200))
          .map((o) => ({ id: 'reqot:' + o.id, name: nameOf(w, o.member_id), state: 'طلب وقت إضافي', line: nameOf(w, o.member_id) + ' — ' + (o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي') + ' يوم ' + String(o.day), entity: 'hr' }));
      }
      const types = rows(await db.from('hr_leave_types').select('name').limit(100)).map((t) => String(t.name));
      const pick = (t: string) => st === 'req_leave' ? types.includes(t) : st === 'req_advance' ? t === 'سُلفة' : st === 'req_rest' ? t === 'فترة راحة' : !types.includes(t) && t !== 'سُلفة' && t !== 'فترة راحة';
      return rows(await db.from('hr_requests').select('id, member_id, type, from_day, to_day, created_at').gte('created_at', since).limit(300)).filter((r) => pick(String(r.type)))
        .map((r) => ({ id: 'req:' + r.id, name: nameOf(w, r.member_id), state: String(r.type), line: nameOf(w, r.member_id) + ' طلب ' + String(r.type) + (r.from_day ? ' — ' + String(r.from_day) + (r.to_day && r.to_day !== r.from_day ? ' → ' + String(r.to_day) : '') : ''), entity: 'tickets' }));
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
      if (st === 'new') return rows(await db.from('orders').select('id, number, customer_name, created_at, deleted_at').gte('created_at', since).is('deleted_at', null).limit(300))
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
        line: (g.vendor ? String(g.vendor.name) : 'مبتكر') + ' · ' + g.lines.length + ' منتج · ' + st, entity: 'orders/' + String(g.order.number ?? g.order.id) }));
    }
    case 'subs.delay': {
      const r = await orders(db, w, ctx);
      return [...subsOf(r, (it) => r.lineState.get(String(it.id)) === st).entries()].map(([k, g]) => ({ id: 's:' + k, name: g.vendor ? String(g.vendor.name) : 'مبتكر', ref: ref(g.order), state: DELAY_WORD[st],
        line: 'أوردر فرعي ' + DELAY_WORD[st] + ' · ' + (g.vendor ? String(g.vendor.name) : 'مبتكر') + ' · ' + g.lines.length + ' منتج', entity: 'orders/' + String(g.order.number ?? g.order.id) }));
    }
    case 'subs.update': {
      if (st === 'new') {
        const fresh = rows(await db.from('orders').select('id, number, created_at').gte('created_at', since).is('deleted_at', null).limit(300)); if (!fresh.length) return [];
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
        return [{ id: 'payroll:' + date.slice(0, 7), name: 'المرتبات', ref: date, state: 'قبل يوم الصرف', line: 'يوم الصرف ' + date + ' — فاضل ' + left + ' يوم', entity: 'hr-payroll' }];
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
        .map((x) => ({ id: 'exp:' + x.id, name: String(x.category), ref: '', state: st === 'deposit' ? 'إيداع' : 'سحب', line: String(x.category) + ' · ' + (st === 'deposit' ? 'إيداع ' : 'سحب ') + money(Number(x.amount)) + (x.sub_name ? ' · ' + String(x.sub_name) : x.beneficiary ? ' · ' + String(x.beneficiary).slice(0, 40) : ''), entity: 'accounts' }));
    }
    case 'accounts.makers': {
      if (st === 'close_due') {
        const end = monthEnd(today); const left = daysBetween(today, end);
        return left <= (P ?? 2) ? [{ id: 'close:' + today.slice(0, 7), name: 'حسابات المبتكرين', ref: end, state: 'قبل التقفيل', line: 'تقفيل حسابات المبتكرين يوم ' + end + (left ? ' — فاضل ' + left + ' يوم' : ' — النهارده'), entity: 'accounts-makers' }] : [];
      }
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      return rows(await db.from('acc_vendor_moves').select('id, vendor_id, direction, kind, kind_name, amount, created_at').eq('direction', st).is('voided_at', null).gte('created_at', since).limit(300))
        .map((x) => ({ id: 'vmove:' + x.id, name: vs.get(String(x.vendor_id)) ?? 'مبتكر', state: st === 'deposit' ? 'إيداع' : 'سحب', line: (vs.get(String(x.vendor_id)) ?? 'مبتكر') + ' · ' + String(x.kind_name ?? x.kind) + ' ' + money(Number(x.amount)), entity: 'accounts-makers' }));
    }
    case 'accounts.real': {
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
        .map((t) => ({ id: 't:' + t.id, name: String(t.title ?? '').slice(0, 80), ref: 'TKT-' + String(t.id).padStart(4, '0'), state: 'طلب جديد', line: 'طلب جديد لـ ' + String(t.assignee_role) + ': ' + String(t.title ?? '').slice(0, 80), entity: 'tickets/TKT-' + String(t.id).padStart(4, '0'), users: users(t) }));
      const stale = new Date(ctx.nowMs - 48 * 3600_000).toISOString();
      return rows(await db.from('tickets').select('id, type, title, assignee_role, assignee_member, created_by, status, follow_up, last_update').in('status', ['open', 'in_progress', 'waiting']).limit(LIMIT)).filter(pick)
        .filter((t) => (typeof t.follow_up === 'string' && t.follow_up.slice(0, 10) < today) || (t.last_update && String(t.last_update) < stale))
        .map((t) => ({ id: 'tl:' + t.id, name: String(t.title ?? '').slice(0, 80), ref: 'TKT-' + String(t.id).padStart(4, '0'), state: 'حالته ماتغيّرتش', line: 'طلب حالته ماتغيّرتش: ' + String(t.title ?? '').slice(0, 80), entity: 'tickets/TKT-' + String(t.id).padStart(4, '0'), users: users(t) }));
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
          users: [...new Set(teamMembers(w, t.assignee_role).concat(t.assignee_member ? [String(t.assignee_member)] : [], t.created_by ? [String(t.created_by)] : []))].filter((u) => u !== String(e.actor)) } as Ent; })
        .filter(Boolean) as Ent[];
    }
    // ---- the messages
    case 'messages.customers': case 'messages.vendors': case 'messages.comments': {
      const seg = ty; const sla = Number((w.settings.cs ?? {}).sla_late_min) || 60;
      // a conversation with an assignee reaches him and the members who see all the conversations (cs.view F)
      const scope = (c: Json): Partial<Ent> => (c.assignee ? { users: w.members.filter((m) => String(m.id) === String(c.assignee) || permOf(m, w.roles, 'cs.view') === 'F').map((m) => String(m.id)) } : { perm: ['cs.view', 'F'] });
      const who = (c: Json) => String(c.handle ?? (seg === 'vendors' ? 'مبتكر' : 'عميل')).slice(0, 60);
      if (st === 'new') {
        const msgs = rows(await db.from('cs_messages').select('id, conversation_id, kind, created_at').eq('kind', 'in').gte('created_at', since).limit(1000)); if (!msgs.length) return [];
        const convs = rows(await db.from('cs_conversations').select('id, seg, handle, platform, assignee').in('id', [...new Set(msgs.map((m) => m.conversation_id))]).eq('seg', seg).limit(500));
        return convs.map((c) => { const mine = msgs.filter((m) => String(m.conversation_id) === String(c.id)); const last = mine[mine.length - 1];
          return { id: 'cin:' + c.id + ':' + last.id, name: who(c), state: 'رسالة جديدة', line: who(c) + ' · ' + mine.length + ' رسالة جديدة · ' + String(c.platform), entity: 'cs/' + c.id, ...scope(c) } as Ent; });
      }
      const convs = rows(await db.from('cs_conversations').select('id, seg, handle, platform, assignee, waiting_since, status').eq('seg', seg).eq('status', 'مستنية ردنا').limit(LIMIT));
      return convs.map((c) => ({ c, min: Math.max(0, Math.round((ctx.nowMs - Date.parse(String(c.waiting_since ?? ctx.now))) / 60_000)) }))
        .filter((x) => st === 'waiting' || x.min >= sla)
        .map(({ c, min }) => ({ id: 'cw:' + c.id, name: who(c), state: st === 'waiting' ? 'مستني ردنا' : 'متأخر عن الرد', line: who(c) + ' مستني ردنا من ' + min + ' دقيقة · ' + String(c.platform), entity: 'cs/' + c.id, ...scope(c) } as Ent));
    }
    // ---- the assistants (their notes reach the members who see that assistant — ai_agents.perm)
    case 'ai.buyer': case 'ai.designer': case 'ai.dev': case 'ai.any': {
      const agents = rows(await db.from('ai_agents').select('id, name, perm').limit(100)); const agentPerm = (id: string) => { const a = agents.find((x) => x.id === id); return a && typeof a.perm === 'string' ? a.perm : 'marketing.view'; };
      const agentName = (id: string) => { const a = agents.find((x) => x.id === id); return a ? String(a.name) : id; };
      const notes = async (agent: string | null, test: (n: Json) => boolean) => {
        let q = db.from('ai_agent_notes').select('id, agent, kind, title, body, ref, link, created_at').gte('created_at', since); if (agent) q = q.eq('agent', agent);
        return rows(await q.limit(300)).filter(test).map((n) => ({ id: 'note:' + n.id, name: agentName(String(n.agent)), state: String(n.kind), line: String(n.title), entity: n.link ? String(n.link) : 'ai-' + String(n.agent), perm: [agentPerm(String(n.agent)), 'P'] as [string, string] }));
      };
      if (ty === 'any') return notes(null, () => true);
      if (ty === 'dev') return notes('dev', (n) => st === 'wp' ? /^dev:wp:/.test(String(n.ref)) : st === 'speed' ? /^dev:speed:/.test(String(n.ref)) : /^dev:/.test(String(n.ref)) && !/^dev:(wp|speed):/.test(String(n.ref)));
      if (ty === 'buyer' && st === 'pixel') return notes('buyer', (n) => /^pixel:/.test(String(n.ref)));
      if (ty === 'buyer' && st === 'campaigns') return rows(await db.from('mkt_suggestions').select('id, platform, kind, campaign_name, title, status, created_at').gte('created_at', since).limit(200))
        .map((s) => ({ id: 'sg:' + s.id, name: String(s.campaign_name ?? 'حملة'), state: String(s.kind), line: String(s.title ?? s.kind) + ' — ' + String(s.campaign_name ?? ''), entity: 'ai-buyer' }));
      if (ty === 'buyer' && st === 'post') return rows(await db.from('mkt_posts').select('id, name, platform, kind, published_at').gte('published_at', since).limit(200))
        .map((p) => ({ id: 'post:' + p.id, name: String(p.name ?? 'بوست'), state: 'اتنشر', line: 'اتنشر ' + String(p.kind ?? 'بوست') + ' على ' + String(p.platform) + ' — ' + String(p.name ?? '').slice(0, 60), entity: 'marketing-log' }));
      if (ty === 'designer' && st === 'trends') {
        const tr = rows(await db.from('mkt_trends').select('id, batch, title, found_at').gte('found_at', since).limit(300)); if (!tr.length) return [];
        const batches = new Map<string, Json[]>(); for (const t of tr) { const k = String(t.batch ?? t.id); const l = batches.get(k) ?? []; l.push(t); batches.set(k, l); }
        return [...batches.entries()].map(([k, l]) => ({ id: 'tr:' + k, name: 'آخر التريندات', state: 'تريندات جديدة', line: l.length + ' تريند جديد — ' + String(l[0].title ?? '').slice(0, 60), entity: 'ai-designer' }));
      }
      if (ty === 'designer' && st === 'campaign') return rows(await db.from('mkt_campaigns').select('id, name, created_at, archived_at').gte('created_at', since).is('archived_at', null).limit(200))
        .map((c) => ({ id: 'camp:' + c.id, name: String(c.name ?? 'كامبين'), state: 'كامبين جديدة', line: 'كامبين جديدة: ' + String(c.name ?? '').slice(0, 80), entity: 'marketing' }));
      return [];
    }
    // ---- the makers
    case 'makers.making': {
      if (st === 'late' || st === 'risk') {
        const r = await orders(db, w, ctx); const per = new Map<string, Set<string>>();
        for (const it of r.lines) { if (r.lineState.get(String(it.id)) !== st || !it.vendor_id) continue; const s = per.get(String(it.vendor_id)) ?? new Set(); s.add(String(it.order_id)); per.set(String(it.vendor_id), s); }
        return [...per.entries()].map(([vid, s]) => { const v = r.V.get(vid); const n = v ? String(v.name) : 'مبتكر';
          return { id: 'mk:' + st + ':' + vid, name: n, state: DELAY_WORD[st], line: n + ' · ' + s.size + ' أوردر ' + (st === 'late' ? 'متأخر' : 'قابل للتأخير'), entity: 'makers' }; });
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
        out.push({ id: 'mk:' + st + ':' + k, name: n, ref: 'IB-' + String(l.entity_id), state: st === 'confirmed' ? 'أوردر مؤكد' : 'أوردر ملغي', line: n + ' · ' + (st === 'confirmed' ? 'اتأكد' : 'اتلغى') + ' أوردر IB-' + String(l.entity_id), entity: 'orders/' + String(l.entity_id) });
      }
      return out;
    }
    case 'makers.accounts': {
      const vs = new Map(rows(await db.from('vendors').select('id, name').limit(LIMIT)).map((v) => [String(v.id), String(v.name)]));
      if (st === 'withdraw') return rows(await db.from('dokan_withdrawals').select('id, vendor_id, amount, status, requested_at, synced_at').eq('status', 'pending').gte('synced_at', since).limit(200))
        .map((x) => ({ id: 'wd:' + x.id, name: vs.get(String(x.vendor_id)) ?? 'مبتكر', state: 'طلب سحب', line: (vs.get(String(x.vendor_id)) ?? 'مبتكر') + ' طلب سحب ' + money(Number(x.amount)), entity: 'accounts-makers' }));
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

export async function runRules(db: Db, ctx: Ctx, opts: { dry?: boolean } = {}): Promise<Json> {
  ordersMemo = null;
  const rl = await db.from('notif_rules').select('id, section_id, name, element, type, state, sub, param, at, repeat, days, show, hours, roles, channels, template, active, last_run, updated_at').limit(500);
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
      const kind = CAT.kindOf(rule); const mine = shown.filter((a) => a.rule_id === rule.id);
      const due = runsNow(rule, ctx.cairo);
      const since = rule.last_run ?? new Date(Math.max(Date.parse(rule.updated_at ?? ctx.now), ctx.nowMs - 20 * 60_000)).toISOString();
      const needState = rule.active !== false && kind === 'state' && (due || (rule.show === 'until_state' && mine.length > 0));
      const ents = due || needState ? await entities(db, w, ctx, rule, since) : null;
      if (due && ents) {
        const existing = rows(await db.from('alerts').select('id, entity_id, user_id, hide_at').eq('rule_id', rule.id).in('entity_id', ents.map((e) => e.id).slice(0, 500)).limit(20_000));
        const plan = writePlan({ rule, ents, existing, members: w.members, roles: w.roles, now: ctx.now, lineFor: rule.element === 'daily' ? (e: Ent, m: Json) => dailyLine(e, m, w) : undefined });
        inserts.push(...plan.inserts); retired.push(...plan.retire); ranIds.push(rule.id); sum.ran++; sum.replaced += plan.retire.length;
      }
      const inState = kind === 'state' && ents ? new Set(ents.map((e) => e.id)) : null;
      hides.push(...hidePlan({ rule, alerts: mine.filter((a) => !retired.includes(a.id)), inState, reads, now: ctx.now }));
    } catch (e) { sum.failed++; console.error('notify rule ' + String(rule.id).slice(0, 8) + ': ' + String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 120)); }
  }
  // the alerts of a rule the admin deleted keep their sub-section and lose the rule: they leave the bell
  const orphans = rows(await db.from('alerts').select('id').is('rule_id', null).not('section_id', 'is', null).is('hide_at', null).limit(5000));
  hides.push(...orphans.map((a) => ({ id: a.id, hide_at: ctx.now })));
  hides.push(...retired.map((id) => ({ id, hide_at: ctx.now })));
  sum.written = inserts.length; sum.hidden = hides.length;
  if (opts.dry) return { ...sum, preview: inserts.slice(0, 50).map((a) => ({ title: a.title, to: a.user_id, rule: a.rule_id })) };
  for (let i = 0; i < inserts.length; i += 500) { const { error } = await db.from('alerts').insert(inserts.slice(i, i + 500)); if (error) throw new Error('db alerts ' + (error.code ?? '')); }
  const byTime = new Map<string, number[]>(); for (const h of hides) { const l = byTime.get(h.hide_at) ?? []; l.push(h.id); byTime.set(h.hide_at, l); }
  for (const [at, list] of byTime) for (let i = 0; i < list.length; i += 500) await db.from('alerts').update({ hide_at: at }).in('id', list.slice(i, i + 500));
  if (ranIds.length) await db.from('notif_rules').update({ last_run: ctx.now }).in('id', ranIds);
  return sum;
}
