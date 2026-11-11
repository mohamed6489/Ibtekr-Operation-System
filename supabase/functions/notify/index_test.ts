// deno-lint-ignore-file no-explicit-any
// notify handler tests (phase 11, decision 16): the cron with the sync secret only (or the admin by hand); the live tables become
// items → alerts rows per receiving role / the manager, alert_state remembered, nothing twice in a tick; the e-mail (Resend, the
// Vault key) and the WhatsApp template (the linked number) go to the active members with a contact and are logged as counts and
// codes only; the quiet hours hold them; a dry run writes nothing; status shows the channels' readiness. No network.
import { assert, assertEquals } from 'jsr:@std/assert@1';
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
  assertEquals([late.kind, late.title, late.entity, late.entity_id], ['customers', 'IB-1001 · منى', 'orders', '1001']); assert(/14 يوم من التأكيد/.test(late.body)); // decision 52: confirmed without a date = from the order date
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
});
