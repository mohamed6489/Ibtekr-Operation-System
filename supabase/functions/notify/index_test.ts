// deno-lint-ignore-file no-explicit-any
// notify handler tests (phase 11, decision 16): the cron with the sync secret only (or the admin by hand); the live tables become
// items → alerts rows per receiving role / the manager, alert_state remembered, nothing twice in a tick; the e-mail (Resend, the
// Vault key) and the WhatsApp template (the linked number) go to the active members with a contact and are logged as counts and
// codes only; the quiet hours hold them; a dry run writes nothing; status shows the channels' readiness. No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler, payrollDue } from './index.ts';
import { fakeDb } from '../_test/fakes.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000a1'; const CS = '00000000-0000-4000-8000-0000000000a2'; const OPS = '00000000-0000-4000-8000-0000000000a3'; const VF = '00000000-0000-4000-8000-0000000000a4';
const VENDOR = '00000000-0000-4000-8000-00000000000v'.replace('v', '7');
// Sunday 8 Nov 2026, 10:00 Cairo (08:00Z)
const NOW = '2026-11-08T08:00:00.000Z';
const RESEND = 're_test_' + 'k'.repeat(20);
const SEED = () => ({
  roles: [{ id: 'admin', name: 'أدمن', permissions: {}, sort: 1 }, { id: 'ops', name: 'عمليات', permissions: { 'orders.view': 'F', 'vendors.view': 'F', 'inventory.view': 'F', 'tickets.view': 'F' }, sort: 2 },
    { id: 'cs', name: 'خدمة العملاء', permissions: { 'orders.view': 'F', 'cs.view': 'F', 'tickets.view': 'F' }, sort: 3 }, { id: 'accounts', name: 'حسابات', permissions: { 'accounts.view': 'F', 'tickets.view': 'P' }, sort: 4 },
    { id: 'vendors_followup', name: 'متابعة المبتكرين', permissions: { 'orders.view': 'F', 'vendors.view': 'F', 'tickets.view': 'P' }, sort: 5 }, { id: 'viewer', name: 'مشاهد', permissions: {}, sort: 6 }],
  profiles: [{ id: ADMIN, name: 'أدمن', email: 'admin@x.test', phone: '01000000001', role_id: 'admin', status: 'active' }, { id: CS, name: 'سارة', email: 'cs@x.test', phone: '01000000002', role_id: 'cs', status: 'active' },
    { id: OPS, name: 'علي', email: 'ops@x.test', phone: null, role_id: 'ops', status: 'active', manager_id: ADMIN }, { id: VF, name: 'نور', email: 'vf@x.test', phone: '01000000004', role_id: 'vendors_followup', status: 'suspended' }],
  status_map: [{ id: 1, system_status: 'جاري التنفيذ', woo_status: 'processing' }, { id: 2, system_status: 'معلّق', woo_status: 'on-hold' }],
  vendors: [{ id: VENDOR, woo_vendor_id: 7, name: 'آرت كرافت', phone: '01099999999', status: 'active', contract: { expires: '2026-11-20' } }],
  orders: [{ id: 1001, number: '1001', customer_name: 'منى', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', placed_at: '2026-10-25T10:00:00Z' }, // 14 days → late
    { id: 1002, number: '1002', customer_name: 'هدى', status: 'جاري التنفيذ', confirm: 'غير مؤكد', placed_at: '2026-11-06T10:00:00Z' }, // unconfirmed, 2 days
    { id: 1003, number: '1003', customer_name: 'قديم', status: 'مكتمل', confirm: 'مؤكد بعربون', placed_at: '2026-10-01T10:00:00Z' }],
  order_items: [{ id: 1, order_id: 1001, vendor_id: VENDOR, name: 'ترابيزة', status: 'قيد التنفيذ' }, { id: 2, order_id: 1002, vendor_id: VENDOR, name: 'كرسي', status: 'جاهز للشحن من المبتكر للعميل', ready_at: '2026-11-06T08:00:00Z' }],
  tickets: [{ id: 5, type: 'customer', title: 'شكوى تأخير', description: 'x', priority: 'urgent', assignee_role: 'خدمة العملاء', status: 'open', created_by_name: 'أدمن', created_by_role: 'admin', created_at: NOW, last_update: NOW }],
  hr_requests: [{ id: 9, member_id: OPS, type: 'إجازة', from_day: '2026-11-12', to_day: '2026-11-13', status: 'جديد' }],
  acc_expenses: [{ id: '00000000-0000-4000-8000-0000000000e1', on_date: '2026-10-01', direction: 'withdraw', category: 'الاشتراكات', amount: 100, sub_name: 'Canva', sub_ends: '2026-11-05' }],
  settings: [{ section: 'notif', data: { channels: { email: true, whatsapp: true }, quiet: { days: 'الجمعة', hours: 'من 11:00 م إلى 9:00 ص', waMax: 'رسالتان في اليوم' }, whatsappTemplate: 'ibtekr_alert', accAlerts: { payDay: 25, lead: 3 } } }],
});
function setup(opts: { seed?: any; now?: string; wa?: boolean; resend?: boolean; graphStatus?: number } = {}) {
  const graph: any[] = []; const mails: any[] = [];
  const db = fakeDb(opts.seed ?? SEED(), { rpc: {
    sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok',
    cs_secret_get: ({ p_name }: any) => (opts.wa !== false && p_name === 'meta_wa' ? JSON.stringify({ token: 'wa-token-1', waba_id: '1', phone_id: '555' }) : null),
    app_secret_env: () => (opts.resend !== false ? { RESEND_API_KEY: RESEND, RESEND_FROM: 'alerts@ibtekr.club' } : {}),
  } });
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null; const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    if (url.startsWith('https://api.resend.com/emails')) { mails.push({ headers, body }); return new Response('{"id":"m1"}', { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (url.startsWith('https://graph.facebook.com/')) { graph.push({ url, headers, body }); return new Response(opts.graphStatus && opts.graphStatus !== 200 ? '{"error":{"code":131047}}' : '{"messages":[{"id":"wamid.1"}]}', { status: opts.graphStatus ?? 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 404 });
  };
  const userDb = (jwt: string) => fakeDb({}, { rpc: { is_admin: () => jwt === 'jwt-admin' } });
  const deps = { env: { SUPABASE_URL: 'https://x' }, db, now: () => opts.now ?? NOW, fetch: fetchFn as unknown as typeof fetch, userDb, userId: async (jwt: string) => (jwt === 'jwt-admin' ? ADMIN : jwt === 'jwt-member' ? CS : null) };
  return { db, deps, graph, mails };
}
async function cron(deps: any, secret = 'sync-secret-ok', body: any = { action: 'tick' }) {
  const res = await handler(new Request('http://x/notify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': secret }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
async function call(deps: any, body: any, jwt = 'jwt-admin') {
  const res = await handler(new Request('http://x/notify', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}

Deno.test('auth: the cron needs the sync secret and the tick action only; members are refused; the admin may tick / status', async () => {
  const { deps } = setup();
  assertEquals((await cron(deps, 'wrong')).res.status, 401); assertEquals((await cron(deps, 'sync-secret-ok', { action: 'status' })).res.status, 401);
  assertEquals((await call(deps, { action: 'tick' }, 'jwt-member')).res.status, 401); assertEquals((await call(deps, { action: 'tick' }, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, { action: 'drop' })).res.status, 400);
  const st = await call(deps, { action: 'status' }); assertEquals(st.res.status, 200);
  assertEquals([st.body.last, st.body.email, st.body.whatsapp], [null, { ready: true, from: 'alerts@ibtekr.club' }, { ready: true, template: 'ibtekr_alert' }]);
});

Deno.test('tick: the live tables → alerts per receiving role (and the manager), the state remembered, the channels sent and logged as counts; nothing twice; the memory of the run', async () => {
  const { db, deps, graph, mails } = setup();
  const { res, body } = await cron(deps);
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.by, { 'customers.late': 1, 'customers.unconf': 1, 'delivery.waybills': 1, 'delivery.late': 1, 'delivery.daily': 1, 'vendors.late': 1, 'vendors.daily': 1, 'vendors.weekly': 1, 'vendors.contract': 1, 'accounts.vendors': 1, 'accounts.subs_expired': 1, 'tasks.urgent': 1, 'team.req': 1 }, 'the sources found');
  const A = db.rows('alerts'); const by = (k: string) => A.filter((a: any) => a.source_key === k).map((a: any) => a.role_id ?? a.user_id).sort();
  assertEquals(by('customers.late'), ['admin', 'cs', 'ops']); assertEquals(by('vendors.late'), ['admin', 'ops', 'vendors_followup']);
  assertEquals(by('team.req'), [ADMIN, 'admin', 'ops'].sort(), 'the matrix + the member\'s manager as a user');
  assertEquals(by('accounts.subs_expired'), ['accounts', 'admin']); assertEquals(by('vendors.contract'), ['admin']);
  assertEquals(by('accounts.vendors'), [], 'the statements go out on their days of the month only (16 / last)');
  const late = A.find((a: any) => a.source_key === 'customers.late' && a.role_id === 'cs');
  assertEquals([late.kind, late.title, late.entity, late.entity_id], ['customers', 'IB-1001 · منى', 'orders', '1001']); assert(/عدّى مدة التصنيع \(7 يوم\)/.test(late.body)); // decision 52: confirmed without a date = from the order date; owner batch 2 decision 17: past the longest making days (the default 7)
  assertEquals(A.every((a: any) => a.at === NOW && a.source_key), true);
  // the memory: a row per (source × entity × target), count 1
  const S = db.rows('alert_state'); assertEquals(S.length, A.filter((a: any) => !String(a.source_key).startsWith('digest:')).length, 'a state row per alert (the digests keep none)'); assertEquals(S.every((s: any) => s.sent_count === 1 && s.last_sent_at === NOW), true);
  // e-mail: «عقد مبتكر بينتهي» is system + e-mail to the admin; the subscriptions too (admin + accounts, no accounts member); Resend called with the Vault key
  assert(mails.length >= 2, 'mails: ' + mails.length); assertEquals(mails[0].headers.Authorization, 'Bearer ' + RESEND); assertEquals(mails[0].body.from, 'alerts@ibtekr.club');
  assertEquals(mails.every((m) => m.body.to.length === 1 && /@x\.test$/.test(m.body.to[0]) && m.body.html.includes('dir="rtl"')), true);
  // WhatsApp: the late order (system + WhatsApp) → the admin and the cs member (ops has no phone); the maker's daily (vendor WhatsApp) → the maker; the template
  const wa = graph.map((g) => g.body); assertEquals(graph.every((g) => g.url === 'https://graph.facebook.com/v25.0/555/messages' && g.headers.authorization === 'Bearer wa-token-1'), true);
  assertEquals(wa.every((b) => b.type === 'template' && b.template.name === 'ibtekr_alert' && b.template.language.code === 'ar' && b.template.components[0].parameters.length === 1), true);
  assert(wa.some((b) => b.to === '201099999999' && /المتابعة اليومية/.test(b.template.components[0].parameters[0].text)), 'the maker on WhatsApp');
  assert(wa.some((b) => b.to === '201000000002' && /IB-1001/.test(b.template.components[0].parameters[0].text)), 'the cs member');
  assertEquals(wa.filter((b) => b.to === '201000000002').length <= 2, true, 'the cap of two a day');
  // the log carries counts and codes only
  const logs = S.flatMap((s: any) => s.channel_log); assert(logs.length > 0);
  assertEquals(logs.every((l: any) => ['sent', 'held', 'capped', 'no_contact', 'failed', 'not_linked'].includes(l.status) && /^(m:|v:)/.test(l.to)), true);
  const txt = JSON.stringify(S) + JSON.stringify(A) + JSON.stringify(body); assert(!txt.includes('0100000000') && !txt.includes('01099999999') && !txt.includes('@x.test') && !txt.includes(RESEND) && !txt.includes('wa-token'), 'no phone, address, key or token anywhere');
  assertEquals(body.sent.email, mails.length); assertEquals(body.sent.whatsapp, graph.length);
  assertEquals(db.rows('sync_state').find((r: any) => r.key === 'notify').value.alerts, S.length); assertEquals(A.length - S.length, body.digests, 'the digests of the hour (admin, cs, ops) are alerts rows too');
  // the same tick 15 minutes later: nothing new
  const again = await cron({ ...deps, now: () => '2026-11-08T08:15:00.000Z' });
  assertEquals([again.body.alerts, again.body.external, db.rows('alerts').length], [0, 0, A.length]);
  // the admin's dry run writes nothing and sends nothing
  const dry = await call({ ...deps, now: () => '2026-11-09T08:00:00.000Z' }, { action: 'tick', dry: true });
  assertEquals(dry.body.result, 'dry'); assert(dry.body.alerts > 0, 'the daily repeats would go out tomorrow'); assertEquals(db.rows('alerts').length, A.length); assertEquals(mails.length + graph.length, body.sent.email + body.sent.whatsapp);
});

Deno.test('the quiet hours hold the external channels (logged «held»), the bell rows still go out; no WhatsApp link → «not_linked»; a refused Graph call → failed with its code', async () => {
  const night = setup({ now: '2026-11-08T21:30:00.000Z' }); // 23:30 Cairo
  const r1 = await cron(night.deps); assert(r1.body.alerts > 0); assertEquals(night.graph.length + night.mails.length, 0);
  const held = night.db.rows('alert_state').flatMap((s: any) => s.channel_log); assert(held.length > 0); assertEquals(held.filter((l: any) => l.status !== 'held' && l.status !== 'no_contact'), []);
  const none = setup({ wa: false, resend: false }); const r2 = await cron(none.deps); assertEquals(r2.body.sent.whatsapp + r2.body.sent.email, 0); assert(r2.body.sent.not_linked > 0);
  assertEquals(none.db.rows('alert_state').flatMap((s: any) => s.channel_log).filter((l: any) => l.ch === 'whatsapp' && !['not_linked', 'no_contact', 'capped'].includes(l.status)), [], 'the cap of two a day counts the attempts too');
  const st = await call(none.deps, { action: 'status' }); assertEquals([st.body.email.ready, st.body.whatsapp.ready], [false, false]);
  const bad = setup({ graphStatus: 400 }); await cron(bad.deps);
  const failed = bad.db.rows('alert_state').flatMap((s: any) => s.channel_log).filter((l: any) => l.ch === 'whatsapp' && l.status === 'failed'); assert(failed.length > 0); assertEquals(failed[0].code, 'graph_131047');
});

Deno.test('the stock alerts by the days of the settings page «المخزن» (B6): a consolidation late, a photo piece too long, a return waiting too long; the old *Days spellings still read; the defaults 5 / 14 / 7', async () => {
  // 8 Nov (Cairo): c1 open 4 days, c2 1 day; l1 photo 7 days; l2 return 3 days, l3 return 9 days, l4 return inspected, l5 return closed
  const stock = (seed: any, data?: any) => {
    seed.inv_consolidations = [{ id: 'c1', order_id: 1001, since: '2026-11-04T09:00:00Z', status: 'open' }, { id: 'c2', order_id: 1002, since: '2026-11-07T09:00:00Z', status: 'open' }, { id: 'c3', order_id: 1003, since: '2026-10-01T09:00:00Z', status: 'shipped' }];
    seed.inv_lots = [{ id: 'l1', reason: 'تصوير', sku: 'IBTAR0999', name: 'فازة', since: '2026-11-01', condition: null, closed_at: null },
      { id: 'l2', reason: 'مرتجع', sku: 'IBTAR1000', name: 'كرسي', since: '2026-11-05', condition: null, closed_at: null },
      { id: 'l3', reason: 'مرتجع', sku: 'IBTAR1001', name: 'ترابيزة', since: '2026-10-30', condition: null, closed_at: null },
      { id: 'l4', reason: 'مرتجع', sku: 'IBTAR1002', name: 'مخدة', since: '2026-10-01', condition: 'سليم', closed_at: null },
      { id: 'l5', reason: 'مرتجع', sku: 'IBTAR1003', name: 'لمبة', since: '2026-10-01', condition: null, closed_at: '2026-10-05T10:00:00Z' }];
    if (data) seed.settings.push({ section: 'inventory', data });
    return seed;
  };
  const run = async (data?: any) => { const a = setup({ seed: stock(SEED(), data) }); const r = await cron(a.deps); return { by: r.body.by, A: a.db.rows('alerts') }; };
  // the settings page's keys
  const s = await run({ firstWarehouse: false, consolidationAlert: 3, photoMax: 7, returnWait: 5, returnDefault: 'يرجع للمبتكر' });
  assertEquals([s.by['stock.cons'], s.by['stock.photo'], s.by['stock.ret']], [1, 1, 1]);
  const ids = (A: any[], k: string) => [...new Set(A.filter((x: any) => x.source_key === k).map((x: any) => x.entity_id))];
  assertEquals([ids(s.A, 'stock.cons'), ids(s.A, 'stock.photo'), ids(s.A, 'stock.ret')], [['c1'], ['l1'], ['l3']], 'c2 (1 day), l2 (3 days), the inspected and the closed ones: nothing');
  const ret = s.A.find((x: any) => x.source_key === 'stock.ret'); assertEquals([ret.entity, ret.title], ['inventory', 'مرتجع ترابيزة']); assert(/9 يوم/.test(ret.body), ret.body);
  assertEquals(s.A.filter((x: any) => x.source_key === 'stock.ret').map((x: any) => x.role_id).sort(), ['admin', 'ops'], 'the matrix of the type');
  // the old spellings (before B6) still read
  const o = await run({ consolidationAlertDays: 3, photoMaxDays: 7, returnWaitDays: 10 });
  assertEquals([o.by['stock.cons'], o.by['stock.photo'], o.by['stock.ret']], [1, 1, undefined]);
  // no row (or junk) → 5 / 14 / 7: only the return of 9 days
  for (const d of [undefined, { consolidationAlert: 0, photoMax: 'x', returnWait: 500 }]) {
    const n = await run(d); assertEquals([n.by['stock.cons'], n.by['stock.photo'], n.by['stock.ret']], [undefined, undefined, 1], JSON.stringify(d));
  }
});

Deno.test('the payroll before its pay day (accAlerts.payDay / lead), unless the sheet is paid; payrollDue', async () => {
  assertEquals(payrollDue('2026-11-08', 25), { date: '2026-11-25', daysLeft: 17, month: '2026-11' });
  assertEquals(payrollDue('2026-11-26', 25), { date: '2026-12-25', daysLeft: 29, month: '2026-12' });
  assertEquals(payrollDue('2026-11-08', 1), { date: '2026-12-01', daysLeft: 23, month: '2026-11' });
  const seed = SEED(); seed.settings[0].data.accAlerts = { payDay: 10, lead: 3 }; // 8 Nov → pay day in 2 days
  const a = setup({ seed }); const r = await cron(a.deps); assertEquals(r.body.by['accounts.payroll'], 1);
  assertEquals(a.db.rows('alerts').filter((x: any) => x.source_key === 'accounts.payroll').map((x: any) => x.role_id).sort(), ['accounts', 'admin']);
  const seed2 = SEED(); seed2.settings[0].data.accAlerts = { payDay: 10, lead: 3 }; (seed2 as any).hr_payroll = [{ month: '2026-11-01', status: 'مدفوع' }];
  const b = setup({ seed: seed2 }); const r2 = await cron(b.deps); assertEquals(r2.body.by['accounts.payroll'], undefined, 'paid → no alert');
  // data-real decision 9: after «امسح كل حاجة» only the admin is left — no staff on the payroll = no reminder; the admin with a salary = staff
  const seed3 = SEED(); seed3.settings[0].data.accAlerts = { payDay: 10, lead: 3 }; seed3.profiles = seed3.profiles.filter((p: any) => p.role_id === 'admin');
  const c = setup({ seed: seed3 }); const r3 = await cron(c.deps); assertEquals(r3.body.by['accounts.payroll'], undefined, 'no staff → no alert');
  const seed4 = SEED(); seed4.settings[0].data.accAlerts = { payDay: 10, lead: 3 }; seed4.profiles = seed4.profiles.filter((p: any) => p.role_id === 'admin');
  (seed4 as any).hr_pay = [{ member_id: seed4.profiles[0].id, salary: 9000 }];
  const d = setup({ seed: seed4 }); const r4 = await cron(d.deps); assertEquals(r4.body.by['accounts.payroll'], 1, 'the admin with a salary → the reminder');
});

// agents-brain decision 10: each team's assistant writes its team a daily summary and a late alert in the bell (ai_agent_note_add)
Deno.test('the team assistants: from 9:00 Cairo a summary and an alert for the team with open work; nothing for a team with none', async () => {
  const seed = SEED(); (seed as any).ai_agents = [{ id: 'cs', name: 'خدمة العملاء الذكية', role: 'خدمة العملاء' }, { id: 'hr', name: 'الموارد البشرية الذكية', role: 'الموارد البشرية' }];
  const notes: any[] = [];
  const { deps } = setup({ seed });
  const rpc = deps.db.rpc.bind(deps.db);
  (deps.db as any).rpc = (name: string, args: any) => { if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); } return rpc(name, args); };
  const { body } = await cron(deps);
  assertEquals(body.team, 2);
  assertEquals(notes.map((n) => [n.p_agent, n.p_kind, n.p_ref, n.p_link]), [['cs', 'report', 'team:2026-11-08', 'tickets'], ['cs', 'alert', 'late:2026-11-08', 'tickets']]);
  assert(/TKT-0005/.test(notes[1].p_body));
});

// agents-brain decision 7 / T7: the customer-service assistant writes a ready reply for a conversation waiting past the SLA (sla_late_min)
Deno.test('the ready reply: a customer conversation waiting past the SLA gets a cs note with the reply and its link; none within it', async () => {
  const seed = SEED(); (seed as any).ai_agents = [{ id: 'cs', name: 'خدمة العملاء الذكية', role: null }];
  (seed as any).cs_customers = [{ id: '00000000-0000-4000-8000-0000000000c1', name: 'منى أحمد', tags: [], consent: true, auto_consent: true, created_from: 'manual' }];
  (seed as any).cs_conversations = [
    { id: '00000000-0000-4000-8000-000000000001', seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: '00000000-0000-4000-8000-0000000000c1', handle: 'منى', status: 'مستنية ردنا', waiting_since: '2026-11-08T06:30:00.000Z', tags: [], unread: 1 },
    { id: '00000000-0000-4000-8000-000000000002', seg: 'customers', platform: 'messenger', channel: 'messenger', handle: 'عميل ماسنجر', status: 'مستنية ردنا', waiting_since: '2026-11-08T07:40:00.000Z', tags: [], unread: 1 },
  ];
  const notes: any[] = [];
  const { deps } = setup({ seed });
  const rpc = deps.db.rpc.bind(deps.db);
  (deps.db as any).rpc = (name: string, args: any) => { if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); } return rpc(name, args); };
  const { body } = await cron(deps);
  assertEquals(body.ready, 1);
  const n = notes.find((x) => x.p_ref?.startsWith('cs-late:'));
  assertEquals([n.p_agent, n.p_kind, n.p_link], ['cs', 'alert', 'cs/00000000-0000-4000-8000-000000000001']);
  assert(/الرد المقترح:\nأهلًا يا منى/.test(n.p_body));
});

// agents-brain decision 5, «طريقة أ»: the developer's daily check — a note per problem from the screen's errors and the failed sync, once a
// day from 9 Cairo; a second tick the same day does nothing; the refs not written this run are cleared
Deno.test('the developer\'s check: a note per problem with «للجلسة:», once a day, and the clear keeps what it wrote', async () => {
  const seed = SEED(); (seed as any).ai_agents = [{ id: 'dev', name: 'المبرمج الذكي', role: null }];
  (seed as any).activity_log = [{ at: '2026-11-08T06:00:00.000Z', actor: 'm1', action: 'app.crash', new_value: { kind: 'TypeError', at: 'orders.js:40:2' } }];
  (seed as any).woo_sync_log = [1, 2, 3].map((i) => ({ at: '2026-11-08T0' + i + ':00:00.000Z', kind: 'cron', direction: 'in', entity: 'order', action: 'sync', result: 'error', detail: { error: 'HTTP 503' } }));
  const notes: any[] = []; const clears: any[] = [];
  const { deps } = setup({ seed });
  const rpc = deps.db.rpc.bind(deps.db);
  (deps.db as any).rpc = (name: string, args: any) => {
    if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); }
    if (name === 'ai_agent_note_clear') { clears.push(args); return Promise.resolve({ data: 0, error: null }); }
    if (name === 'dev_cron_health') return Promise.resolve({ data: { jobs: [], http: { failed: 0 } }, error: null });
    return rpc(name, args);
  };
  const { body } = await cron(deps);
  const dev = notes.filter((x) => x.p_agent === 'dev');
  assertEquals(dev.length, 2);
  assert(dev.every((x) => /\nللجلسة:\n/.test(x.p_body) && x.p_link === null));
  assert(dev.some((x) => x.p_ref.startsWith('dev:crash:')) && dev.some((x) => x.p_ref.startsWith('dev:sync:')));
  assertEquals(clears.length, 1); assertEquals(clears[0].p_prefix, 'dev:');
  assertEquals((body as any).dev.notes, 2);
  // the same day again: nothing
  notes.length = 0;
  const again = await cron(deps);
  assertEquals(notes.filter((x) => x.p_agent === 'dev').length, 0);
  assertEquals((again.body as any).dev, undefined);
});

// the owner 22 Nov (model routing): the same check reads the models Anthropic serves the linked key — a new one is a note for the
// session; the key goes to the reader alone; a read that failed keeps yesterday's «dev:model:» notes; no key = nothing asked
Deno.test('the developer\'s check: Claude\'s served models against the system\'s list — a new model is a note, a failed read keeps the notes, no key asks nothing', async () => {
  const mk = (models: ((key: string) => Promise<string[]>) | undefined, key = 'sk-ant-test') => {
    const seed = SEED(); (seed as any).ai_agents = [{ id: 'dev', name: 'المبرمج الذكي', role: null }];
    (seed as any).ai_agent_notes = [{ agent: 'dev', ref: 'dev:model:new:claude-old-news' }];
    const notes: any[] = []; const clears: any[] = []; const keys: string[] = [];
    const { deps } = setup({ seed });
    const rpc = deps.db.rpc.bind(deps.db);
    (deps.db as any).rpc = (name: string, args: any) => {
      if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); }
      if (name === 'ai_agent_note_clear') { clears.push(args); return Promise.resolve({ data: 0, error: null }); }
      if (name === 'dev_cron_health') return Promise.resolve({ data: { jobs: [], http: { failed: 0 } }, error: null });
      if (name === 'app_secret_env') return Promise.resolve({ data: key ? { ANTHROPIC_API_KEY: key } : {}, error: null });
      return rpc(name, args);
    };
    if (models) (deps as any).models = (k: string) => { keys.push(k); return models(k); };
    return { deps, notes, clears, keys };
  };
  const a = mk(async () => ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-6']);
  await cron(a.deps);
  const dev = a.notes.filter((x) => x.p_agent === 'dev');
  assertEquals(dev.map((x) => [x.p_kind, x.p_ref]), [['update', 'dev:model:new:claude-opus-6']]);
  assertEquals(a.keys, ['sk-ant-test']); assertFalse(JSON.stringify(a.notes).includes('sk-ant-test'), 'the key never reaches a note');
  assertEquals(a.clears[0].p_keep, ['dev:model:new:claude-opus-6'], 'yesterday\'s note about another model is cleared');
  // the read failed: nothing written about models, and the note already there stays
  const b = mk(async () => { throw new Error('network'); });
  const rb = await cron(b.deps);
  assertEquals(b.notes.filter((x) => x.p_agent === 'dev').length, 0); assertEquals(b.clears[0].p_keep, ['dev:model:new:claude-old-news']);
  assertEquals((rb.body as any).dev.unread_sources, ['dev:model:']);
  // Claude is not linked: Anthropic is not asked, and the old note goes
  const c = mk(async () => ['claude-opus-6'], '');
  await cron(c.deps);
  assertEquals([c.keys.length, c.notes.filter((x) => x.p_agent === 'dev').length, c.clears[0].p_keep], [0, 0, []]);
});

Deno.test('the owner 18 Nov — the clean-up every 48 hours (0132): the files through Storage first, then the rows whose files went; not again before 48 hours', async () => {
  const { db, deps } = setup();
  (db as any).storage = (() => { const store = new Set(['studio/b1/a.webp', 'ai-images/m1/x.webp', 'marketing/agents/m1/c9/img.png']); const calls: any[] = [];
    return { calls, from: (bucket: string) => ({ remove: async (paths: string[]) => { calls.push([bucket, paths]); if (bucket === 'studio') return { data: null, error: { message: 'down' } }; paths.forEach((p) => store.delete(bucket + '/' + p)); return { data: paths.map((name) => ({ name })), error: null }; } }) }; })();
  const cleaned: any[] = [];
  const rpc = db.rpc.bind(db);
  (db as any).rpc = (name: string, args: any) => {
    if (name === 'cleanup_plan') return Promise.resolve({ data: { studio: [{ id: 'b1', files: ['b1/a.webp'] }], images: ['m1/x.webp'], jobs: [{ id: 7, file: null }], chats: [{ id: 'c9', files: ['agents/m1/c9/img.png'] }] }, error: null });
    if (name === 'data_cleanup') { cleaned.push(args); return Promise.resolve({ data: { sync_log: 3, alerts: 1 }, error: null }); }
    return rpc(name, args);
  };
  const { body } = await cron(deps);
  assertEquals(cleaned, [{ p_studio: [], p_jobs: [7], p_chats: ['c9'] }], 'the batch whose file would not delete waits for the next run');
  assertEquals((body as any).clean.files, 2); assertEquals((body as any).clean.files_failed, 1); assertEquals((body as any).clean.rows, { sync_log: 3, alerts: 1 });
  assertEquals(db.row('sync_state', 'cleanup', 'key').value.more, false);
  const again = await cron(deps);
  assertEquals(cleaned.length, 1, 'not again before 48 hours');
  assertEquals((again.body as any).clean, undefined);
});

Deno.test('the clean-up before 0132 (no plan function) is nothing and never fails the tick', async () => {
  const { db, deps } = setup();
  const rpc = db.rpc.bind(db);
  (db as any).rpc = (name: string, args: any) => (name === 'cleanup_plan' ? Promise.resolve({ data: null, error: { code: 'PGRST202' } }) : rpc(name, args));
  const { res, body } = await cron(deps);
  assertEquals(res.status, 200); assertEquals((body as any).clean, undefined);
});
