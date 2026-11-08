// deno-lint-ignore-file no-explicit-any
// The auto-reply engine's database side (phase 6.5, decisions 6–12 of docs/superpowers/plans/2026-11-08-phase-6-5-autoreply.md).
// Shared by the cs-auto function (the cron tick, the admin's run / status) and the inbound paths of cs-channel / cs-whatsapp
// (a customer's first message, a message outside the hours), so every automatic send goes through one place:
//   the settings «cs».auto (live off = every rule is recorded skipped/off, nothing is sent) → the enabled rules → the events out of
//   our tables → the pure engine (_shared/cs-auto.js) decides → a cs_messages row of kind `auto` (queued → sent / failed, the
//   template name in meta.tpl) sent on the conversation's channel: WhatsApp 1 by the Cloud API (free text inside the 24-hour window,
//   the approved Meta template outside it), Messenger / Instagram inside the window, WhatsApp 2 left queued for the bridge;
//   a hold (hours / delay / the daily cap / the per-tick pace) keeps the row with no delivery and meta.due_at until its time;
//   «ticket» opens a ticket for خدمة العملاء as the server; «assign» / «tag» touch the conversation; the run log (cs_auto_runs,
//   one live row a rule × entity) is what makes a rule fire once. Nothing here logs a phone, a token or a message's text.
import { CART_STATUSES, CHANNEL_LABEL, STATUS_CODES, VIRTUAL_STATUS, afterHoursEntity, cairoClock, cartEvents, decide, digits, entityFor, failCode, firstEntity, inHours, orderEvents, paceGap, ruleFires, sendMode, settingsOf, silentFollowups, statusTo, subEvents, templateBody, transferEvents, varsFor, DAY, HOUR } from './cs-auto.js';
import { sentIdOf, textBody, waIdOfPhone, waPath, graphErrorCode } from './cs-whatsapp.js';
import { graphPath, sendBody } from './cs-channel.js';

type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; db: any; now: () => string; fetch?: typeof fetch; rand?: () => number; sleep?: (ms: number) => Promise<void> };
type Settings = ReturnType<typeof settingsOf>;
type Links = { wa: { token: string; phone_id: string } | null; page: { id: string; token: string } | null };
type Target = { channel: string; convId: string; externalId: string | null; phone: string | null; customerId: string | null; lastInAt: string | null };
type Ev = Json;

const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const rows = (r: { data?: unknown }) => (Array.isArray(r?.data) ? r.data as Json[] : []);
const LIMIT = 2000;
export const MAX_SENDS_PER_TICK = 8; // the random 20–60 s gaps must fit the function's run
const GRAPH_MS = 15_000;
export const AUTO_ACTOR = { name: 'الرد الآلي', role: 'النظام' };
const CHAT = ['wa1', 'wa2', 'messenger', 'instagram'];
export const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);

class GraphError extends Error { constructor(public code: string) { super(code); this.name = 'GraphError'; } }
async function graphPost(deps: Deps, url: string, token: string, body: Json): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  let res: Response;
  try { res = await f(url, { method: 'POST', headers: { accept: 'application/json', authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null; try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(String(graphErrorCode(out) ?? res.status));
  return isObj(out) ? out : {};
}

// ---------------------------------------------------------------- the settings and the links
export async function autoSettings(deps: Deps): Promise<{ settings: Settings; riskFrom: number; lateFrom: number }> {
  const st = rows(await deps.db.from('settings').select('section, data').in('section', ['cs', 'makers']));
  const cs = st.find((r) => r.section === 'cs'); const mk = st.find((r) => r.section === 'makers');
  const settings = settingsOf(isObj(cs?.data) ? cs.data.auto : null);
  return { settings, riskFrom: Number(isObj(mk?.data) ? mk.data.risk_day : 0) || 9, lateFrom: Number(isObj(mk?.data) ? mk.data.late_day : 0) || 12 };
}
async function secretJson(deps: Deps, name: string): Promise<Json | null> {
  try { const { data, error } = await deps.db.rpc('cs_secret_get', { p_name: name }); if (error || typeof data !== 'string' || !data) return null; const j = JSON.parse(data); return isObj(j) ? j : null; } catch { return null; }
}
export async function linksOf(deps: Deps): Promise<Links> {
  const [wa, pages] = await Promise.all([secretJson(deps, 'meta_wa'), secretJson(deps, 'meta_pages')]);
  const page = pages && isObj(pages.page) && typeof pages.page.token === 'string' && typeof pages.page.id === 'string' ? { id: String(pages.page.id), token: String(pages.page.token) } : null;
  return { wa: wa && typeof wa.token === 'string' && typeof wa.phone_id === 'string' ? { token: wa.token, phone_id: wa.phone_id } : null, page };
}

// ---------------------------------------------------------------- the send (one path for every channel)
type Sent = { status: 'sent' | 'queued' | 'failed'; code?: string; messageId: string | null };
// the message row first (kind auto; a hold keeps delivery null + meta.due_at), then the channel
export async function sendAuto(deps: Deps, links: Links, t: Target, plan: { text: string; mode: string; params: string[]; template: Json | null; ruleId: string; dueAt?: string | null }, settings: Settings): Promise<Sent> {
  const now = deps.now();
  const meta: Json = { auto: true, rule_id: plan.ruleId, tpl: plan.template?.name ?? null, mode: plan.mode, params: plan.params, ...(plan.dueAt ? { due_at: plan.dueAt } : {}) };
  const { data: m, error } = await deps.db.from('cs_messages').insert({ conversation_id: t.convId, kind: 'auto', text: plan.text, author: null, delivery: plan.dueAt ? null : 'queued', meta, created_at: now }).select('id').single();
  if (error || !isObj(m)) throw new Error('cs_messages: ' + (error?.code ?? 'insert'));
  const id = String(m.id);
  if (plan.dueAt) return { status: 'queued', messageId: id };
  return await deliver(deps, links, t, id, plan, settings);
}
// the channel call for a queued auto row (a fresh one, or a held one whose time came)
async function deliver(deps: Deps, links: Links, t: Target, id: string, plan: { text: string; mode: string; params: string[]; template: Json | null }, settings: Settings): Promise<Sent> {
  const fail = async (code: string): Promise<Sent> => { await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { auto: true, rule_id: (plan as any).ruleId ?? null, tpl: plan.template?.name ?? null, mode: plan.mode, error: code } }).eq('id', id); return { status: 'failed', code, messageId: id }; };
  if (t.channel === 'wa2') return { status: 'queued', messageId: id }; // the bridge (cs-wa outbox) sends the queued rows of WhatsApp 2
  try {
    let externalId: string | null = null;
    if (t.channel === 'wa1') {
      if (!links.wa) return await fail('not_linked');
      const waId = t.phone ? waIdOfPhone(t.phone) : null; if (!waId) return await fail('no_phone');
      const body = plan.mode === 'template' && plan.template?.wa_template ? templateBody(waId, plan.template.wa_template, settings.waLang, plan.params) : textBody(waId, plan.text);
      externalId = sentIdOf(await graphPost(deps, waPath.send(links.wa.phone_id), links.wa.token, body));
    } else if (t.channel === 'messenger' || t.channel === 'instagram') {
      if (!links.page) return await fail('not_linked');
      if (!t.externalId) return await fail('no_contact');
      const out = await graphPost(deps, graphPath.send(), links.page.token, sendBody(t.externalId, plan.text));
      externalId = typeof out.message_id === 'string' ? out.message_id.slice(0, 1000) : null;
    } else return await fail('channel');
    const { error } = await deps.db.from('cs_messages').update({ delivery: 'sent', external_id: externalId }).eq('id', id);
    if (error && error.code !== '23505') throw new Error('cs_messages: ' + error.code);
    await deps.db.from('cs_conversations').update({ last_out_at: deps.now(), updated_at: deps.now() }).eq('id', t.convId);
    return { status: 'sent', messageId: id };
  } catch (e) {
    if (e instanceof GraphError) return await fail(e.code);
    throw e;
  }
}

// ---------------------------------------------------------------- the people and their conversations
async function customersByPhone(deps: Deps, phones: string[]): Promise<Map<string, Json>> {
  const keys = [...new Set(phones.map(digits).filter(Boolean))]; const out = new Map<string, Json>();
  for (let i = 0; i < keys.length; i += 200) {
    for (const c of rows(await deps.db.from('cs_customers').select('id, phone, name, consent, auto_consent, blocked_at, merged_into').in('phone', keys.slice(i, i + 200)))) out.set(String(c.phone), c);
  }
  return out;
}
const custCtx = (c: Json | null) => (c ? { blocked: !!c.blocked_at, merged: !!c.merged_into, autoConsent: c.auto_consent !== false, consent: c.consent !== false } : { blocked: false, merged: false, autoConsent: true, consent: true });
// the conversation an automatic customer message goes on: WhatsApp 1 first (the number), else the latest chat channel; none → a new wa1 one when the customer has a phone
async function customerTarget(deps: Deps, customer: Json | null, phone: string | null, make: boolean): Promise<Target | null> {
  const cid = customer ? String(customer.id) : null;
  if (cid) {
    const list = rows(await deps.db.from('cs_conversations').select('id, channel, external_id, last_in_at, updated_at').eq('customer_id', cid).in('channel', CHAT).limit(20))
      .sort((a, b) => (a.channel === 'wa1' ? -1 : b.channel === 'wa1' ? 1 : String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))));
    const c = list[0];
    if (c) return { channel: String(c.channel), convId: String(c.id), externalId: c.external_id ? String(c.external_id) : null, phone: phone ?? (customer?.phone ? String(customer.phone) : null), customerId: cid, lastInAt: c.last_in_at ?? null };
  }
  const p = phone ?? (customer?.phone ? String(customer.phone) : null);
  if (!make || !p || !cid) return null;
  const { data: found } = await deps.db.from('cs_conversations').select('id, last_in_at').eq('channel', 'wa1').eq('external_id', p).maybeSingle();
  if (isObj(found)) return { channel: 'wa1', convId: String(found.id), externalId: p, phone: p, customerId: cid, lastInAt: found.last_in_at ?? null };
  const { data: made, error } = await deps.db.from('cs_conversations').insert({ seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: cid, external_id: p, status: 'مستنية العميل', created_by: null, created_at: deps.now(), updated_at: deps.now() }).select('id').single();
  if (error || !isObj(made)) throw new Error('cs_conversations: ' + (error?.code ?? 'insert'));
  return { channel: 'wa1', convId: String(made.id), externalId: p, phone: p, customerId: cid, lastInAt: null };
}
async function vendorTarget(deps: Deps, vendor: Json, make: boolean): Promise<Target | null> {
  const { data: found } = await deps.db.from('cs_conversations').select('id, external_id, last_in_at').eq('channel', 'wa2').eq('vendor_id', vendor.id).limit(1);
  const c = Array.isArray(found) ? found[0] : null; const phone = vendor.phone ? digits(vendor.phone) : null;
  if (isObj(c)) return { channel: 'wa2', convId: String(c.id), externalId: c.external_id ? String(c.external_id) : phone, phone, customerId: null, lastInAt: c.last_in_at ?? null };
  if (!make || !phone) return null;
  const { data: made, error } = await deps.db.from('cs_conversations').insert({ seg: 'vendors', platform: 'whatsapp', channel: 'wa2', vendor_id: vendor.id, external_id: phone, status: 'مستنية العميل', created_by: null, created_at: deps.now(), updated_at: deps.now() }).select('id').single();
  if (error || !isObj(made)) throw new Error('cs_conversations: ' + (error?.code ?? 'insert'));
  return { channel: 'wa2', convId: String(made.id), externalId: phone, phone, customerId: null, lastInAt: null };
}
// the tracking link of a Bosta waybill (the order line's waybill json) — the first line with one
const trackingOf = (items: Json[]) => { for (const it of items) { const w = it.waybill; if (!isObj(w)) continue; const u = typeof w.tracking_url === 'string' ? w.tracking_url : typeof w.url === 'string' ? w.url : null; if (u && /^https:\/\//.test(u)) return u; const n = w.tracking_number ?? w.number ?? w.id; if (n) return 'https://bosta.co/tracking-shipment/?track_num=' + encodeURIComponent(String(n)); } return ''; };
const arDay = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(t)) : ''; };
const payLabel = (o: Json) => (/cod|cash|كاش|نقد/i.test(String(o.payment_method ?? '') + ' ' + String(o.payment_title ?? '')) ? 'كاش' : 'أونلاين');

// ---------------------------------------------------------------- the tickets the engine opens (as the server)
export async function openTicket(deps: Deps, t: { title: string; description: string; orderNumber?: string | null; orderId?: number | null; customerName?: string | null; customerId?: string | null; convId?: string | null }): Promise<number | null> {
  const row = { type: 'customer', title: t.title.slice(0, 80), description: t.description.slice(0, 5000), priority: 'normal', assignee_role: 'خدمة العملاء', order_number: t.orderNumber ? String(t.orderNumber).slice(0, 20) : null,
    order_id: t.orderId ?? null, customer: t.customerName ? String(t.customerName).slice(0, 80) : null, cs_customer_id: t.customerId ?? null, cs_conversation_id: t.convId ?? null,
    created_by: null, created_by_name: AUTO_ACTOR.name, created_by_role: AUTO_ACTOR.role, status: 'open', created_at: deps.now(), last_update: deps.now() };
  const { data, error } = await deps.db.from('tickets').insert(row).select('id').single();
  if (error || !isObj(data)) throw new Error('tickets: ' + (error?.code ?? 'insert'));
  await deps.db.from('ticket_events').insert([
    { ticket_id: data.id, kind: 'event', actor: null, actor_name: AUTO_ACTOR.name, actor_role: AUTO_ACTOR.role, text: AUTO_ACTOR.name + ' فتح التذكرة وعيّنها لدور «خدمة العملاء»', at: deps.now() },
    { ticket_id: data.id, kind: 'message', actor: null, actor_name: AUTO_ACTOR.name, actor_role: AUTO_ACTOR.role, text: t.description.slice(0, 7000), at: deps.now() },
  ]);
  return Number(data.id);
}

// ---------------------------------------------------------------- the run log
async function runRow(deps: Deps, r: Json): Promise<boolean> {
  const { error } = await deps.db.from('cs_auto_runs').insert({ ...r, at: deps.now() });
  if (!error) return true;
  if (error.code === '23505') return false; // the same rule on the same entity already has a live row
  throw new Error('cs_auto_runs: ' + (error.code ?? 'insert'));
}
async function sentToday(deps: Deps, nowMs: number): Promise<Record<string, number>> {
  const c = cairoClock(nowMs); const [y, m, d] = c.day.split('-').map(Number); const start = new Date(Date.UTC(y, m - 1, d) - c.offset).toISOString();
  const out: Record<string, number> = { wa1: 0, wa2: 0, messenger: 0, instagram: 0 };
  for (const r of rows(await deps.db.from('cs_auto_runs').select('code').eq('result', 'sent').gte('at', start).limit(5000))) { const ch = String(r.code ?? '').split(':')[0]; if (ch in out) out[ch]++; }
  return out;
}
const capOf = (settings: Settings, channel: string) => (channel === 'wa1' ? settings.daily.wa1 : channel === 'wa2' ? settings.daily.wa2 : 100_000);

// ---------------------------------------------------------------- the tick
export type TickResult = { result: string; at: string; since: string; live: boolean; events: number; sent: number; held: number; skipped: number; failed: number; tickets: number; assigned: number; tagged: number; due: number; silent: number; by: Record<string, number>; preview?: Json[] };
export async function tick(deps: Deps, opts: { dry?: boolean } = {}): Promise<TickResult> {
  const now = deps.now(); const nowMs = Date.parse(now);
  const { settings, riskFrom, lateFrom } = await autoSettings(deps);
  const { data: last } = await deps.db.from('sync_state').select('value').eq('key', 'cs-auto').maybeSingle();
  const since = isObj(last?.value) && typeof last.value.at === 'string' ? last.value.at : new Date(nowMs - 6 * HOUR).toISOString();
  const rules = rows(await deps.db.from('cs_auto_rules').select('*').eq('enabled', true).limit(500));
  const n: TickResult = { result: opts.dry ? 'dry' : 'ok', at: now, since, live: settings.live, events: 0, sent: 0, held: 0, skipped: 0, failed: 0, tickets: 0, assigned: 0, tagged: 0, due: 0, silent: 0, by: {} };
  const preview: Json[] = [];
  const has = (ev: string) => rules.some((r) => r.event === ev);
  const tplIds = [...new Set(rules.map((r) => r.template_id).filter(Boolean))];
  const templates = new Map<string, Json>(); for (const t of tplIds.length ? rows(await deps.db.from('cs_templates').select('*').in('id', tplIds)) : []) templates.set(String(t.id), t);
  const links = settings.live && !opts.dry ? await linksOf(deps) : { wa: null, page: null };
  // the events
  const events: Ev[] = []; const today = cairoClock(nowMs).day;
  const ORDER_COLS = 'id, number, customer_name, customer_phone, status, payment_method, payment_title, total, placed_at, updated_at, deleted_at';
  if (has('status') || has('cart')) {
    const byId = new Map<string, Json>();
    const add = (list: Json[]) => { for (const o of list) byId.set(String(o.id), o); };
    if (has('status')) add(rows(await deps.db.from('orders').select(ORDER_COLS).gte('updated_at', since).is('deleted_at', null).limit(LIMIT)));
    if (rules.some((r) => r.event === 'status' && VIRTUAL_STATUS.includes(statusTo(r.event_to)))) add(rows(await deps.db.from('orders').select(ORDER_COLS).eq('status', 'جاري التنفيذ').is('deleted_at', null).limit(LIMIT)));
    if (has('status')) events.push(...orderEvents([...byId.values()], { sinceIso: since, today, riskFrom, lateFrom } as any));
    if (has('cart')) { const recent = rows(await deps.db.from('orders').select(ORDER_COLS).gte('placed_at', new Date(nowMs - 7 * DAY).toISOString()).is('deleted_at', null).limit(LIMIT)); events.push(...cartEvents(recent, { nowMs, afterMin: settings.cart.afterMin } as any)); }
  }
  if (has('sub')) events.push(...subEvents(rows(await deps.db.from('sub_orders').select('id, order_id, vendor_id, woo_order_id, woo_status, total, updated_at').gte('updated_at', since).limit(LIMIT)), since));
  if (has('transfer')) events.push(...transferEvents(rows(await deps.db.from('dokan_withdrawals').select('id, vendor_id, amount, status, synced_at').eq('status', 'approved').gte('synced_at', since).limit(LIMIT)), since));
  // the pairs (rule × entity) without a live run row
  const pairs: { rule: Json; ev: Ev; entity: string }[] = [];
  for (const ev of events) for (const rule of rules) if (rule.event === ev.type) pairs.push({ rule, ev, entity: entityFor(rule, ev) });
  const entities = [...new Set(pairs.map((p) => p.entity))]; const live = new Set<string>();
  for (let i = 0; i < entities.length; i += 200) for (const r of rows(await deps.db.from('cs_auto_runs').select('rule_id, entity, result').in('entity', entities.slice(i, i + 200)).limit(5000))) if (r.result !== 'failed') live.add(r.rule_id + '|' + r.entity);
  const todo = pairs.filter((p) => !live.has(p.rule.id + '|' + p.entity));
  // the context: customers, lines, open tickets, makers
  const orderIds = [...new Set(todo.map((p) => p.ev.order?.id).filter((x) => x != null))];
  const customers = await customersByPhone(deps, todo.map((p) => p.ev.order?.customer_phone).filter(Boolean));
  const items = new Map<string, Json[]>(); for (let i = 0; i < orderIds.length; i += 200) for (const it of rows(await deps.db.from('order_items').select('id, order_id, vendor_id, name, status, expected_at, waybill').in('order_id', orderIds.slice(i, i + 200)).eq('removed', false).limit(10_000))) { const k = String(it.order_id); items.set(k, [...(items.get(k) ?? []), it]); }
  const openTickets = new Set<string>(); for (let i = 0; i < orderIds.length; i += 200) for (const t of rows(await deps.db.from('tickets').select('order_id').in('order_id', orderIds.slice(i, i + 200)).in('status', ['open', 'in_progress', 'waiting']).limit(5000))) openTickets.add(String(t.order_id));
  const vendorIds = [...new Set([...todo.map((p) => p.ev.vendorId), ...[...items.values()].flat().map((it) => it.vendor_id)].filter(Boolean).map(String))];
  const vendors = new Map<string, Json>(); for (let i = 0; i < vendorIds.length; i += 200) for (const v of rows(await deps.db.from('vendors').select('id, name, phone, lead_days').in('id', vendorIds.slice(i, i + 200)))) vendors.set(String(v.id), v);
  const members = new Map<string, string>(); // role → a member of it (the first active) for «assign»
  for (const m of rows(await deps.db.from('profiles').select('id, role_id').eq('status', 'active').limit(500))) if (m.role_id && !members.has(String(m.role_id))) members.set(String(m.role_id), String(m.id));
  const today$ = await sentToday(deps, nowMs); let sendsLeft = MAX_SENDS_PER_TICK; let ruleRuns: Record<string, number> = {};
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (const { rule, ev, entity } of todo) {
    const o = isObj(ev.order) ? ev.order : null; const lines = o ? items.get(String(o.id)) ?? [] : [];
    const vendor = ev.vendorId ? vendors.get(String(ev.vendorId)) ?? null : lines[0]?.vendor_id ? vendors.get(String(lines[0].vendor_id)) ?? null : null;
    const customer = o ? customers.get(digits(o.customer_phone)) ?? null : null;
    const target = ev.type === 'sub' || ev.type === 'transfer' ? (vendor ? await vendorTarget(deps, vendor, false) : null) : await customerTarget(deps, customer, o ? digits(o.customer_phone) || null : null, false);
    const condCtx: Json = { 'القناة': target ? CHANNEL_LABEL[target.channel as keyof typeof CHANNEL_LABEL] ?? target.channel : 'واتساب 1', 'الدفع': o ? payLabel(o) : '', 'الحالة': ev.to ?? '', 'الإجمالي': o ? Number(o.total) || 0 : 0,
      'عمر_الأوردر': ev.age ?? 0, 'المبتكر': vendor?.name ?? '', consents: customer ? [...(customer.auto_consent !== false ? ['auto'] : []), ...(customer.consent !== false ? ['marketing'] : [])] : ['auto', 'marketing'], has: o && openTickets.has(String(o.id)) ? ['تذكرة مفتوحة'] : [] };
    if (!ruleFires(rule, ev, condCtx)) continue;
    n.events++; n.by[ev.type] = (n.by[ev.type] || 0) + 1;
    const template = rule.template_id ? templates.get(String(rule.template_id)) ?? null : null;
    const expected = lines.map((it) => it.expected_at).filter(Boolean).sort()[0] ?? null;
    const shipDate = expected ? arDay(expected) : o && vendor ? arDay(new Date(Date.parse(o.placed_at) + (Number(vendor.lead_days) || 7) * DAY).toISOString()) : '';
    const vars = varsFor(ev, { customerName: customer?.name ?? o?.customer_name, trackingUrl: trackingOf(lines), shipDate, vendorName: vendor?.name ?? '', productName: lines[0]?.name ?? '', deliveryDate: shipDate,
      orderNumbers: o?.number ? String(o.number) : '', cartUrl: (deps.env.WOO_URL ?? '').replace(/\/$/, '') ? (deps.env.WOO_URL ?? '').replace(/\/$/, '') + '/checkout/' : '' });
    const ctx = { channel: target?.channel ?? (customer?.phone || o?.customer_phone ? 'wa1' : null), lastInAt: target?.lastInAt ?? null, customer: custCtx(customer), vars, sentToday: today$[target?.channel ?? 'wa1'] ?? 0, cap: capOf(settings, target?.channel ?? 'wa1') };
    let d: any = decide({ rule, template, ev, ctx, settings, nowMs });
    if (d.result === 'sent' && sendsLeft <= 0) d = { ...d, result: 'held', code: 'pace', dueAt: now };
    const base: Json = { rule_id: rule.id, entity, customer_id: customer?.id ?? null, conversation_id: target?.convId ?? null };
    if (opts.dry) { preview.push({ rule: rule.name, entity, result: d.result, code: d.code ?? null }); (n as any)[d.result === 'ticket' ? 'tickets' : d.result] = ((n as any)[d.result === 'ticket' ? 'tickets' : d.result] || 0) + 1; continue; }
    if (d.result === 'skipped') { await runRow(deps, { ...base, result: 'skipped', code: d.code }); n.skipped++; continue; }
    if (d.result === 'ticket') {
      if (!(await runRow(deps, { ...base, result: 'ticket', code: null }))) continue;
      await openTicket(deps, { title: ('قاعدة «' + rule.name + '» — ' + (o ? 'أوردر ' + o.number : entity)).slice(0, 80), description: 'الرد الآلي فتح التذكرة دي من قاعدة «' + rule.name + '»' + (ev.to ? ' لما الأوردر بقى «' + ev.to + '»' : '') + '.', orderNumber: o?.number, orderId: o?.id ?? null, customerName: customer?.name ?? o?.customer_name, customerId: customer?.id ?? null, convId: target?.convId ?? null });
      n.tickets++; ruleRuns[rule.id] = (ruleRuns[rule.id] || 0) + 1; continue;
    }
    if (d.result === 'assigned' || d.result === 'tagged') {
      if (!target) { await runRow(deps, { ...base, result: 'skipped', code: 'no_conversation' }); n.skipped++; continue; }
      if (!(await runRow(deps, { ...base, result: d.result, code: null }))) continue;
      if (d.result === 'assigned') { const uid = members.get(String(rule.role_id)); if (uid) await deps.db.from('cs_conversations').update({ assignee: uid, updated_at: now }).eq('id', target.convId); n.assigned++; }
      else { const { data: c } = await deps.db.from('cs_conversations').select('tags').eq('id', target.convId).maybeSingle(); const tags = isObj(c) && Array.isArray(c.tags) ? c.tags : []; if (!tags.includes(rule.tag)) await deps.db.from('cs_conversations').update({ tags: [...tags, rule.tag].slice(0, 20), updated_at: now }).eq('id', target.convId); n.tagged++; }
      ruleRuns[rule.id] = (ruleRuns[rule.id] || 0) + 1; continue;
    }
    // a send (now or held): the conversation is made when the customer / maker has a number and none exists yet
    const t = target ?? (ev.type === 'sub' || ev.type === 'transfer' ? (vendor ? await vendorTarget(deps, vendor, true) : null) : await customerTarget(deps, customer, o ? digits(o.customer_phone) || null : null, true));
    if (!t) { await runRow(deps, { ...base, result: 'skipped', code: 'no_channel' }); n.skipped++; continue; }
    const plan = { text: d.text as string, mode: d.mode as string, params: (d as any).params ?? [], template, ruleId: String(rule.id), dueAt: d.result === 'held' ? d.dueAt : null };
    const r = await sendAuto(deps, links, t, plan, settings);
    const code = d.result === 'held' ? d.code : r.status === 'failed' ? r.code ?? 'failed' : t.channel + ':' + plan.mode;
    const result = d.result === 'held' ? 'held' : r.status === 'failed' ? 'failed' : 'sent';
    if (!(await runRow(deps, { ...base, conversation_id: t.convId, message_id: r.messageId, result, code, due_at: d.result === 'held' ? d.dueAt : null }))) continue;
    (n as any)[result]++; ruleRuns[rule.id] = (ruleRuns[rule.id] || 0) + 1;
    if (result === 'sent') { today$[t.channel] = (today$[t.channel] ?? 0) + 1; if (t.channel !== 'wa2') { sendsLeft--; await sleep(paceGap(settings, (deps.rand ?? Math.random)())); } }
  }
  if (!opts.dry) {
    n.due = await sendDue(deps, settings, links, nowMs, today$, sendsLeft, sleep);
    n.silent = await silentTickets(deps, nowMs);
    for (const [id, k] of Object.entries(ruleRuns)) { const r = rules.find((x) => String(x.id) === id); if (r) await deps.db.from('cs_auto_rules').update({ runs: (Number(r.runs) || 0) + k, last_run_at: now }).eq('id', id); }
    ruleRuns = {};
    const { result: _r, preview: _p, ...value } = { ...n } as any;
    await deps.db.from('sync_state').upsert({ key: 'cs-auto', value, updated_at: now }, { onConflict: 'key' });
  } else n.preview = preview.slice(0, 50);
  return n;
}
// the held rows whose time came: live still on, the hours open, the cap not reached → the channel call (the message row waits with meta.due_at)
async function sendDue(deps: Deps, settings: Settings, links: Links, nowMs: number, today$: Record<string, number>, sendsLeft: number, sleep: (ms: number) => Promise<void>): Promise<number> {
  if (!settings.live) return 0;
  const due = rows(await deps.db.from('cs_auto_runs').select('id, rule_id, entity, conversation_id, message_id, code').eq('result', 'held').lte('due_at', deps.now()).order('due_at').limit(20));
  let done = 0;
  for (const r of due) {
    if (!r.message_id || !r.conversation_id) { await deps.db.from('cs_auto_runs').update({ result: 'skipped', code: 'lost' }).eq('id', r.id); continue; }
    const { data: m } = await deps.db.from('cs_messages').select('id, text, meta').eq('id', r.message_id).maybeSingle();
    const { data: c } = await deps.db.from('cs_conversations').select('id, channel, external_id, customer_id, vendor_id, last_in_at').eq('id', r.conversation_id).maybeSingle();
    if (!isObj(m) || !isObj(c)) { await deps.db.from('cs_auto_runs').update({ result: 'skipped', code: 'lost' }).eq('id', r.id); continue; }
    const channel = String(c.channel); const cap = capOf(settings, channel);
    if (!inHours(settings, nowMs) && r.code !== 'delay') continue; // still outside the hours: wait
    if ((today$[channel] ?? 0) >= cap) { await deps.db.from('cs_auto_runs').update({ due_at: new Date(nowMs + DAY).toISOString(), code: 'cap' }).eq('id', r.id); continue; }
    if (sendsLeft <= 0 && channel !== 'wa2') break;
    const meta = isObj(m.meta) ? m.meta : {}; const tplId = typeof meta.rule_id === 'string' ? meta.rule_id : null;
    let template: Json | null = null; if (meta.tpl) { const { data: rule } = await deps.db.from('cs_auto_rules').select('template_id').eq('id', tplId).maybeSingle(); if (isObj(rule) && rule.template_id) { const { data: t } = await deps.db.from('cs_templates').select('*').eq('id', rule.template_id).maybeSingle(); template = isObj(t) ? t : null; } }
    let phone: string | null = c.external_id && /^\d{6,15}$/.test(String(c.external_id)) ? String(c.external_id) : null;
    if (!phone && c.customer_id) { const { data: cu } = await deps.db.from('cs_customers').select('phone').eq('id', c.customer_id).maybeSingle(); phone = isObj(cu) && cu.phone ? String(cu.phone) : null; }
    if (!phone && c.vendor_id) { const { data: v } = await deps.db.from('vendors').select('phone').eq('id', c.vendor_id).maybeSingle(); phone = isObj(v) && v.phone ? digits(v.phone) : null; }
    const mode = sendMode({ channel, lastInAt: c.last_in_at ?? null, template, nowMs });
    if (!mode) { await deps.db.from('cs_auto_runs').update({ result: 'skipped', code: 'window' }).eq('id', r.id); await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { ...meta, error: 'window' } }).eq('id', m.id); continue; }
    await deps.db.from('cs_messages').update({ delivery: 'queued', meta: { ...meta, mode, due_at: null } }).eq('id', m.id);
    const t: Target = { channel, convId: String(c.id), externalId: c.external_id ? String(c.external_id) : null, phone, customerId: c.customer_id ? String(c.customer_id) : null, lastInAt: c.last_in_at ?? null };
    const out = await deliver(deps, links, t, String(m.id), { text: String(m.text), mode, params: Array.isArray(meta.params) ? meta.params : [], template }, settings);
    await deps.db.from('cs_auto_runs').update({ result: out.status === 'failed' ? 'failed' : 'sent', code: out.status === 'failed' ? out.code ?? 'failed' : channel + ':' + mode, due_at: null }).eq('id', r.id);
    if (out.status !== 'failed') { done++; today$[channel] = (today$[channel] ?? 0) + 1; if (channel !== 'wa2') { sendsLeft--; await sleep(paceGap(settings, (deps.rand ?? Math.random)())); } }
  }
  return done;
}
// «no answer in 24 hours → a ticket» (decision 7)
async function silentTickets(deps: Deps, nowMs: number): Promise<number> {
  const rules = rows(await deps.db.from('cs_auto_rules').select('id, name, ticket_if_silent').eq('ticket_if_silent', true).limit(200));
  if (!rules.length) return 0;
  const byId: Record<string, Json> = Object.fromEntries(rules.map((r) => [String(r.id), r]));
  const runs = rows(await deps.db.from('cs_auto_runs').select('id, rule_id, entity, customer_id, conversation_id, result, at').in('rule_id', rules.map((r) => r.id)).eq('result', 'sent').gte('at', new Date(nowMs - 3 * DAY).toISOString()).lte('at', new Date(nowMs - DAY).toISOString()).limit(500));
  const convIds = [...new Set(runs.map((r) => r.conversation_id).filter(Boolean))];
  const convs: Record<string, Json> = {}; for (let i = 0; i < convIds.length; i += 200) for (const c of rows(await deps.db.from('cs_conversations').select('id, last_in_at, customer_id').in('id', convIds.slice(i, i + 200)))) convs[String(c.id)] = c;
  let made = 0;
  for (const f of silentFollowups(runs, byId, convs, nowMs)) {
    if (!(await runRow(deps, { rule_id: f.rule.id, entity: f.entity, customer_id: f.run.customer_id ?? null, conversation_id: f.run.conversation_id, result: 'ticket', code: 'silent' }))) continue;
    const order = /^order:(\d+)/.exec(String(f.run.entity))?.[1] ?? null;
    let customerName: string | null = null; if (f.run.customer_id) { const { data: cu } = await deps.db.from('cs_customers').select('name').eq('id', f.run.customer_id).maybeSingle(); customerName = isObj(cu) ? String(cu.name) : null; }
    await openTicket(deps, { title: ('مردّش في 24 ساعة — ' + (order ? 'أوردر ' + order : 'محادثة')).slice(0, 80), description: 'الرد الآلي بعت رسالة قاعدة «' + f.rule.name + '» من 24 ساعة ومفيش رد من العميل.', orderId: order ? Number(order) : null, customerName, customerId: f.run.customer_id ?? null, convId: f.run.conversation_id });
    made++;
  }
  return made;
}

// ---------------------------------------------------------------- the inbound hooks (cs-channel / cs-whatsapp call this after an `in` row)
export type Inbound = { conversationId: string; customerId: string | null; channel: string; fresh: boolean };
// a first message on a new conversation → the «first» rules; a message outside the hours → the «afterhours» rules (once a night a conversation)
export async function onInbound(deps: Deps, ev: Inbound): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  if (!CHAT.includes(ev.channel) || ev.channel === 'wa2') return out;
  const { settings } = await autoSettings(deps); if (!settings.live) return out;
  const now = deps.now(); const nowMs = Date.parse(now); const outside = !inHours(settings, nowMs);
  const rules = rows(await deps.db.from('cs_auto_rules').select('*').eq('enabled', true).in('event', ['first', 'afterhours']).limit(100))
    .filter((r) => (r.event === 'first' && ev.fresh) || (r.event === 'afterhours' && outside));
  if (!rules.length) return out;
  const links = await linksOf(deps);
  const { data: conv } = await deps.db.from('cs_conversations').select('id, channel, external_id, customer_id, last_in_at').eq('id', ev.conversationId).maybeSingle();
  if (!isObj(conv)) return out;
  const customer = conv.customer_id ? (await deps.db.from('cs_customers').select('id, phone, name, consent, auto_consent, blocked_at, merged_into').eq('id', conv.customer_id).maybeSingle()).data : null;
  const phone = conv.external_id && /^\d{6,15}$/.test(String(conv.external_id)) ? String(conv.external_id) : isObj(customer) && customer.phone ? String(customer.phone) : null;
  const t: Target = { channel: String(conv.channel), convId: String(conv.id), externalId: conv.external_id ? String(conv.external_id) : null, phone, customerId: conv.customer_id ? String(conv.customer_id) : null, lastInAt: conv.last_in_at ?? now };
  const today$ = await sentToday(deps, nowMs); const replySettings = { ...settings, hours: { from: 0, to: 24 } }; // a reply goes now, whatever the hours
  for (const rule of rules) {
    const entity = rule.event === 'first' ? firstEntity(conv.id) : afterHoursEntity(conv.id, cairoClock(nowMs).day);
    const template = rule.template_id ? (await deps.db.from('cs_templates').select('*').eq('id', rule.template_id).maybeSingle()).data ?? null : rule.event === 'afterhours' ? { id: null, name: 'خارج المواعيد', lib: 'customers', active: true, body: settings.afterHoursText, wa_template: null, wa_vars: [] } : null;
    const vars = varsFor({ type: rule.event }, { customerName: isObj(customer) ? customer.name : null });
    const d: any = decide({ rule: { ...rule, delay_min: 0 }, template, ev: { type: rule.event, entity }, ctx: { channel: t.channel, lastInAt: t.lastInAt, customer: custCtx(isObj(customer) ? customer : null), vars, sentToday: today$[t.channel] ?? 0, cap: capOf(settings, t.channel) }, settings: replySettings, nowMs });
    const base = { rule_id: rule.id, entity, customer_id: t.customerId, conversation_id: t.convId };
    if (d.result !== 'sent') { if (await runRow(deps, { ...base, result: d.result === 'held' ? 'skipped' : d.result, code: d.code ?? null })) out.skipped++; continue; }
    const { data: had } = await deps.db.from('cs_auto_runs').select('id').eq('rule_id', rule.id).eq('entity', entity).neq('result', 'failed').limit(1);
    if (Array.isArray(had) && had.length) continue;
    const r = await sendAuto(deps, links, t, { text: d.text as string, mode: d.mode as string, params: (d as any).params ?? [], template, ruleId: String(rule.id) }, settings);
    if (await runRow(deps, { ...base, message_id: r.messageId, result: r.status === 'failed' ? 'failed' : 'sent', code: r.status === 'failed' ? r.code ?? 'failed' : t.channel + ':' + d.mode })) { if (r.status !== 'failed') { out.sent++; today$[t.channel] = (today$[t.channel] ?? 0) + 1; } }
    await deps.db.from('cs_auto_rules').update({ runs: (Number(rule.runs) || 0) + 1, last_run_at: now }).eq('id', rule.id);
  }
  return out;
}
// the inbound hook never breaks a webhook: errors become a code on the console only
export async function inboundSafe(deps: Deps, ev: Inbound): Promise<void> {
  try { await onInbound(deps, ev); } catch (e) { console.error('cs-auto inbound: ' + quiet(e)); }
}
export const STATUS_LIST = STATUS_CODES; export const CART = CART_STATUSES;
