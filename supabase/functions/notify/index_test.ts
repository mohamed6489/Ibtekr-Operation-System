// deno-lint-ignore-file no-explicit-any
// notify handler tests (phase 11, decision 16): the cron with the sync secret only (or the admin by hand); the live tables become
// items → alerts rows per receiving role / the manager, alert_state remembered, nothing twice in a tick; the e-mail (Resend, the
// Vault key) and the WhatsApp template (the linked number) go to the active members with a contact and are logged as counts and
// codes only; the quiet hours hold them; a dry run writes nothing; status shows the channels' readiness. No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
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
function setup(opts: { seed?: any; now?: string; wa?: boolean; resend?: boolean; graphStatus?: number; rpc?: Record<string, (a: any) => unknown> } = {}) {
  const graph: any[] = []; const mails: any[] = [];
  const db = fakeDb(opts.seed ?? SEED(), { rpc: {
    sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok',
    cs_secret_get: ({ p_name }: any) => (opts.wa !== false && p_name === 'meta_wa' ? JSON.stringify({ token: 'wa-token-1', waba_id: '1', phone_id: '555' }) : null),
    app_secret_env: () => (opts.resend !== false ? { RESEND_API_KEY: RESEND, RESEND_FROM: 'alerts@ibtekr.club' } : {}),
    ...(opts.rpc ?? {}),
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
  assertEquals([st.body.last, st.body.channels], [null, ['bell', 'email', 'whatsapp']]); // the seed's settings turn both switches on
});

// the notifications' new structure (Safwat 24 Nov — 0157): the admin's rules under the sub-sections → the bell's rows
const SEC_MAIN = '00000000-0000-4000-8000-0000000005a1'; const SEC_SUB = '00000000-0000-4000-8000-0000000005a2'; const SEC_SUB2 = '00000000-0000-4000-8000-0000000005a3';
const rule = (id: string, x: any) => ({ id, section_id: SEC_SUB, name: 'تنبيه', sub: null, param: null, at: '09:00', repeat: '24h', days: [], show: 'until_state', hours: 0, roles: ['admin', 'cs'], channels: ['bell'], template: null, active: true, last_run: null, updated_at: '2026-11-01T00:00:00Z', ...x });
function withRules(rules: any[], more: (s: any) => void = () => {}, rpc?: Record<string, (a: any) => unknown>) {
  const seed: any = SEED();
  seed.notif_sections = [{ id: SEC_MAIN, parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: SEC_SUB, parent_id: SEC_MAIN, name: 'غير مؤكدة', sort: 0 }, { id: SEC_SUB2, parent_id: SEC_MAIN, name: 'جديد', sort: 1 }];
  seed.notif_rules = rules; seed.alerts = []; seed.alert_reads = []; more(seed);
  return setup({ seed, rpc });
}

Deno.test('rules: a «state» rule (an unconfirmed order) → a row per member of its roles who sees orders, under its sub-section; renewed by its repeat; hidden once the order leaves the state', async () => {
  const s = withRules([rule('r-unconf', { name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد', template: '{الرقم} لسه ما اتأكدش — {التفاصيل}' })]);
  const r = await cron(s.deps); assertEquals(r.res.status, 200, JSON.stringify(r.body));
  let A = s.db.rows('alerts');
  assertEquals(A.map((a: any) => a.user_id).sort(), [ADMIN, CS].sort(), 'the admin and the cs member (ops is not in the rule; the suspended member never)');
  const a0 = A[0]; assertEquals([a0.rule_id, a0.section_id, a0.entity_id, a0.entity, a0.hide_at, a0.kind], ['r-unconf', SEC_SUB, 'o:1002', 'orders/1002', null, 'rule:orders.confirm']);
  assert(/IB-1002 لسه ما اتأكدش — غير مؤكد · عمره 2 يوم/.test(a0.body), a0.body); assertEquals(a0.title, 'أوردر غير مؤكد — IB-1002');
  // the customer service card (Safwat 25 Nov — bell-redesign decision 17): the customer, the order's status, delay and sub-orders — never a phone
  assertEquals([a0.meta.g, a0.meta.gid, typeof a0.meta.ost, a0.meta.dl, typeof a0.meta.subs, Array.isArray(a0.meta.lm)], ['customer', '1002', 'string', 'ok', 'number', true]); assert(!/\d{8,}/.test(JSON.stringify(a0.meta)), 'no phone in the meta');
  assertEquals(s.db.rows('notif_rules')[0].last_run, NOW);
  // 15 minutes later: not due again (24h) — nothing written
  await cron({ ...s.deps, now: () => '2026-11-08T08:15:00.000Z' }); assertEquals(s.db.rows('alerts').length, 2);
  // the next day: renewed (the old rows replaced — the green dot again)
  await cron({ ...s.deps, now: () => '2026-11-09T08:00:00.000Z' }); A = s.db.rows('alerts');
  const live = A.filter((a: any) => !a.hide_at);
  assertEquals([A.length, live.length, live.every((a: any) => a.at === '2026-11-09T08:00:00.000Z')], [4, 2, true], 'the old rows hidden (never deleted), two new ones');
  // the order confirmed → hidden by «حتى تغيير الوضع» (0 hours = now)
  await s.db.from('orders').update({ confirm: 'مؤكد بعربون' }).eq('id', 1002);
  await cron({ ...s.deps, now: () => '2026-11-09T08:30:00.000Z' });
  assertEquals(s.db.rows('alerts').filter((a: any) => a.at === '2026-11-09T08:00:00.000Z').map((a: any) => a.hide_at), ['2026-11-09T08:30:00.000Z', '2026-11-09T08:30:00.000Z']);
});

Deno.test('rules: an «event» rule (a new order) runs every tick from its time, once per order; «حتى التحوّل لمقروء» hides after the read + its hours; a fixed time is set at writing', async () => {
  const s = withRules([rule('r-new', { section_id: SEC_SUB2, name: 'أوردر جديد', element: 'orders', type: 'update', state: 'new', at: '00:00', show: 'until_read', hours: 2, last_run: '2026-11-08T07:30:00.000Z' }),
    rule('r-fixed', { section_id: SEC_SUB2, name: 'أوردر جديد ثابت', element: 'orders', type: 'update', state: 'new', at: '00:00', show: 'fixed', hours: 12, roles: ['admin'], last_run: '2026-11-08T07:30:00.000Z' })],
    (seed) => { seed.orders.push({ id: 1010, number: '1010', customer_name: 'جديدة', status: 'جاري التنفيذ', confirm: 'غير مؤكد', placed_at: '2026-11-08T07:50:00Z', created_at: '2026-11-08T07:50:00Z' }); });
  await cron(s.deps);
  const A = s.db.rows('alerts'); const news = A.filter((a: any) => a.rule_id === 'r-new');
  assertEquals(news.map((a: any) => [a.entity_id, a.hide_at]), [['onew:1010', null], ['onew:1010', null]]);
  assertEquals(A.filter((a: any) => a.rule_id === 'r-fixed').map((a: any) => [a.user_id, a.hide_at]), [[ADMIN, '2026-11-08T20:00:00.000Z']]);
  await cron({ ...s.deps, now: () => '2026-11-08T08:15:00.000Z' }); assertEquals(s.db.rows('alerts').length, 3, 'never twice');
  // the cs member reads it → hidden two hours after the read
  const mine = news.find((a: any) => a.user_id === CS); await s.db.from('alert_reads').insert({ alert_id: mine.id, user_id: CS, read_at: '2026-11-08T08:20:00.000Z' });
  await cron({ ...s.deps, now: () => '2026-11-08T08:30:00.000Z' });
  assertEquals(s.db.rows('alerts').find((a: any) => a.id === mine.id).hide_at, '2026-11-08T10:20:00.000Z');
});

Deno.test('rules: an inactive rule hides its rows; a deleted rule\'s rows leave the bell; a request reaches its own team only; the daily report is per member and the dry run writes nothing', async () => {
  const s = withRules([rule('r-tk', { name: 'طلبات جديدة', element: 'tickets', type: 'type', state: 'new', at: '00:00', show: 'until_read', hours: 6, roles: ['admin', 'cs', 'ops', 'accounts'], last_run: '2026-11-08T07:00:00.000Z' }),
    rule('r-day', { name: 'ملخص اليوم', element: 'daily', type: 'summary', state: 'day', show: 'fixed', hours: 24, roles: ['admin', 'cs', 'ops'] })],
    (seed) => { seed.tickets[0].created_at = '2026-11-08T07:30:00.000Z'; seed.alerts = [{ id: 900, rule_id: null, section_id: SEC_SUB, entity_id: 'x', user_id: CS, at: '2026-11-01T00:00:00Z', hide_at: null, kind: 'rule:orders.confirm', title: 'قديم' }]; });
  const dry = await call(s.deps, { action: 'tick', dry: true }); assertEquals(dry.body.result, 'dry'); assert(dry.body.written > 0); assertEquals(s.db.rows('alerts').length, 1, 'the dry run writes nothing');
  await cron(s.deps);
  const A = s.db.rows('alerts');
  assertEquals(A.filter((a: any) => a.rule_id === 'r-tk').map((a: any) => a.user_id).sort(), [ADMIN, CS].sort(), 'a request of «خدمة العملاء» reaches its team (and the admin), not ops');
  const day = A.filter((a: any) => a.rule_id === 'r-day'); assertEquals(day.map((a: any) => a.user_id).sort(), [ADMIN, CS, OPS].sort());
  const cs = day.find((a: any) => a.user_id === CS); const ops = day.find((a: any) => a.user_id === OPS);
  assert(/محادثة|أوردر مفتوح/.test(cs.body) && /أوردر مفتوح/.test(ops.body) && !/محادثة/.test(ops.body), cs.body + ' | ' + ops.body);
  assertEquals(A.find((a: any) => a.id === 900).hide_at, NOW, 'a deleted rule\'s row leaves the bell');
  await s.db.from('notif_rules').update({ active: false }).eq('id', 'r-tk');
  await cron({ ...s.deps, now: () => '2026-11-08T08:15:00.000Z' });
  assertEquals(s.db.rows('alerts').filter((a: any) => a.rule_id === 'r-tk').every((a: any) => a.hide_at === '2026-11-08T08:15:00.000Z'), true, 'off → hidden');
  // no phone or address in any row
  const txt = JSON.stringify(s.db.rows('alerts')); assert(!txt.includes('0100000000') && !txt.includes('@x.test'));
});

Deno.test('rules (security review): a member with the element\'s page partly (hr.view P) gets the team alerts that name him only; the admin all; payroll needs the salaries', async () => {
  const s = withRules([rule('r-out', { name: 'لم يسجل انصراف', element: 'team', type: 'status', state: 'no_out', roles: ['admin', 'ops'] }),
    rule('r-pay', { name: 'المرتبات', element: 'accounts', type: 'payroll', state: 'due', show: 'fixed', hours: 48, roles: ['admin', 'accounts'], param: 30 })],
    (seed) => { seed.roles.find((r: any) => r.id === 'ops').permissions['hr.view'] = 'P'; seed.roles.find((r: any) => r.id === 'accounts').permissions['accounts.view'] = 'F';
      seed.profiles.push({ id: '00000000-0000-4000-8000-0000000000a5', name: 'منى', email: 'acc@x.test', phone: null, role_id: 'accounts', status: 'active' });
      seed.hr_attendance = [{ id: 1, member_id: OPS, day: '2026-11-07', in_at: '2026-11-07T07:00:00Z', out_at: null }, { id: 2, member_id: CS, day: '2026-11-07', in_at: '2026-11-07T07:00:00Z', out_at: null }]; });
  await cron(s.deps);
  const A = s.db.rows('alerts'); const to = (rid: string) => A.filter((a: any) => a.rule_id === rid).map((a: any) => a.user_id + '|' + a.entity_id).sort();
  assertEquals(to('r-out'), [ADMIN + '|noout:1', ADMIN + '|noout:2', OPS + '|noout:1'].sort(), 'ops sees his own session only');
  assertEquals(to('r-pay').map((x: string) => x.split('|')[0]), [ADMIN], 'the accounts member without sensitive.salaries gets no payroll reminder');
});

Deno.test('rules (security review): an assistant\'s note reaches only the members who see that assistant — no element page lets the rest in (the operations assistant\'s own type — the bell\'s redesign)', async () => {
  const s = withRules([rule('r-ai', { name: 'تنبيهات المساعدين', element: 'ai', type: 'stock', state: 'summary', at: '00:00', show: 'until_read', hours: 6, roles: ['admin', 'cs', 'ops'], last_run: '2026-11-08T07:00:00.000Z' })],
    (seed) => { seed.ai_agents = [{ id: 'stock', name: 'التشغيل الذكي', perm: 'inventory.view' }]; seed.ai_agent_notes = [{ id: 7, agent: 'stock', kind: 'report', title: 'ملخص التشغيل', body: '', ref: 'team:x', created_at: '2026-11-08T07:30:00.000Z' }]; });
  await cron(s.deps);
  assertEquals(s.db.rows('alerts').map((a: any) => a.user_id).sort(), [ADMIN, OPS].sort(), 'cs has no inventory.view: no note');
});

Deno.test('rules: before 0157 (no rules table) the tick still runs the rest and says so', async () => {
  const { deps } = setup(); const r = await cron(deps); assertEquals(r.res.status, 200, JSON.stringify(r.body));
  assert(['no_rules'].includes(r.body.notif.skipped) || r.body.notif.rules === 0, JSON.stringify(r.body.notif));
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
  // (the assistants' own rules write theirs too — 0150, tested below)
  assertEquals(notes.filter((n) => !String(n.p_ref).startsWith('rule:')).map((n) => [n.p_agent, n.p_kind, n.p_ref, n.p_link]), [['cs', 'report', 'team:2026-11-08', 'tickets'], ['cs', 'alert', 'late:2026-11-08', 'tickets']]);
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
  assertEquals(clears.filter((c) => c.p_prefix !== 'rule:').map((c) => c.p_prefix), ['dev:']); // the rules clear theirs apart (0150)
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

// decision 11 (the owner 22 Nov — «المبرمج علي حسب الشركات المتركبة هيبعت لو في موديلات جديدة»): the other linked text companies —
// the first read of a company is its baseline (nothing said), a model that comes after it is a note; an unlinked one is not asked
Deno.test('the developer\'s check: OpenAI\'s and Gemini\'s served models — the first read is kept as the baseline, a later new text model is a note, a level\'s model gone is a problem, a failed read keeps the notes, an unlinked company is not asked', async () => {
  const mk = (env: Record<string, string>, lists: Record<string, () => Promise<string[]>>, state: any[] = []) => {
    const seed = SEED(); (seed as any).ai_agents = [{ id: 'dev', name: 'المبرمج الذكي', role: null }];
    (seed as any).ai_agent_notes = [{ agent: 'dev', ref: 'dev:model:new:openai:gpt-old' }]; (seed as any).sync_state = state;
    const notes: any[] = []; const clears: any[] = []; const asked: string[][] = [];
    const { deps, db } = setup({ seed });
    const rpc = deps.db.rpc.bind(deps.db);
    (deps.db as any).rpc = (name: string, args: any) => {
      if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); }
      if (name === 'ai_agent_note_clear') { clears.push(args); return Promise.resolve({ data: 0, error: null }); }
      if (name === 'dev_cron_health') return Promise.resolve({ data: { jobs: [], http: { failed: 0 } }, error: null });
      if (name === 'app_secret_env') return Promise.resolve({ data: env, error: null });
      return rpc(name, args);
    };
    (deps as any).models = async () => ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
    (deps as any).otherModels = (p: string, k: string) => { asked.push([p, k]); return lists[p](); };
    const dev = () => notes.filter((x) => x.p_agent === 'dev').map((x) => [x.p_kind, x.p_ref]);
    return { deps, db, notes, clears, asked, dev };
  };
  const OPENAI = ['gpt-5.2', 'gpt-5.2-mini', 'gpt-image-2', 'text-embedding-3-large', 'whisper-1'];
  // the first read: nothing said, the text ids kept; Gemini has no key and is not asked
  const a = mk({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-open' }, { openai: async () => OPENAI });
  await cron(a.deps);
  assertEquals(a.asked, [['openai', 'sk-open']]); assertEquals(a.dev(), []);
  assertEquals(a.db.rows('sync_state').find((r: any) => r.key === 'dev_models').value, { openai: ['gpt-5.2', 'gpt-5.2-mini'] });
  assertEquals(a.clears[0].p_keep, [], 'the old note of a model that is in no list goes');
  // a later day: a new text model is a note (a media model is not), and the light level's model is gone
  const kept = [{ key: 'dev_models', value: { openai: ['gpt-5.2', 'gpt-5.2-mini'] } }];
  const b = mk({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-open', GEMINI_API_KEY: 'g-key' }, { openai: async () => ['gpt-5.2', 'gpt-6', 'gpt-image-3'], gemini: async () => ['models/gemini-3-pro', 'models/gemini-3-flash', 'models/veo-3.1-generate-preview'] }, kept);
  await cron(b.deps);
  assertEquals(b.dev(), [['problem', 'dev:model:gone:openai:gpt-5.2-mini'], ['update', 'dev:model:new:openai:gpt-6']]);
  assertFalse(JSON.stringify(b.notes).includes('sk-open') || JSON.stringify(b.notes).includes('g-key'), 'no key in a note');
  assert(b.notes.find((x) => x.p_ref === 'dev:model:new:openai:gpt-6').p_body.includes('للجلسة:'));
  assertEquals(b.db.rows('sync_state').find((r: any) => r.key === 'dev_models').value, { openai: ['gpt-5.2', 'gpt-5.2-mini'], gemini: ['gemini-3-pro', 'gemini-3-flash'] }, 'the baseline stays; Gemini\'s first read joins it');
  // the read failed: nothing said, and the company's notes stay
  const c = mk({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-open' }, { openai: async () => { throw new Error('network'); } }, kept);
  const rc = await cron(c.deps);
  assertEquals(c.dev(), []); assertEquals(c.clears[0].p_keep, ['dev:model:new:openai:gpt-old']);
  assertEquals((rc.body as any).dev.unread_sources, ['dev:model:new:openai:', 'dev:model:gone:openai:']);
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

// the owner 22 Nov — the assistants' own rules (0150): the numbers counted from the live tables, a note per rule that holds, the note of
// a rule that stopped holding cleared, the numbers kept for the chats; the admin's card reads them live and writes nothing
function rulesSetup(seed: any) {
  const notes: any[] = []; const clears: any[] = [];
  const s = setup({ seed });
  const rpc = s.deps.db.rpc.bind(s.deps.db);
  (s.deps.db as any).rpc = (name: string, args: any) => {
    if (name === 'ai_agent_note_add') { notes.push(args); return Promise.resolve({ data: notes.length, error: null }); }
    if (name === 'ai_agent_note_clear') { clears.push(args); return Promise.resolve({ data: 0, error: null }); }
    if (name === 'ai_agent_bankless') return Promise.resolve({ data: 1, error: null });
    return rpc(name, args);
  };
  return { ...s, notes, clears };
}
const AGENTS = [{ id: 'manager', name: 'المدير العام', sees: ['orders', 'tickets'], role: 'أدمن' }, { id: 'stock', name: 'التشغيل الذكي', sees: ['orders', 'inventory'], role: 'عمليات' },
  { id: 'makers', name: 'خدمة المبتكرين الذكية', sees: ['vendors'], role: 'متابعة المبتكرين' }, { id: 'hr', name: 'الموارد البشرية الذكية', sees: ['hr'], role: '' },
  { id: 'old', name: 'قديم', sees: ['orders'], role: '', archived_at: '2026-11-01T00:00:00Z' }];
Deno.test('0150 the assistants\' rules: the shipped rules on the live numbers → a note per rule that holds, the rest cleared, the numbers kept with each number\'s permission', async () => {
  const seed = SEED(); (seed as any).ai_agents = AGENTS; (seed as any).ai_agent_state = [];
  (seed as any).settings.push({ section: 'ai', data: {} });
  const { deps, db, notes, clears } = rulesSetup(seed);
  const { body } = await cron(deps);
  const rule = notes.filter((n) => String(n.p_ref).startsWith('rule:'));
  // order 1001 is late (14 days against 7), 1002 is open without a confirmation (1 < 3: its rule does not hold), the urgent request is
  // open, one maker has a late line and one has no bank account, one HR request waits
  assertEquals(rule.map((n) => [n.p_agent, n.p_kind, n.p_ref]).sort(), [
    ['hr', 'alert', 'rule:hr:hr_requests_pending'], ['makers', 'alert', 'rule:makers:makers_no_bank'], ['makers', 'problem', 'rule:makers:makers_late'],
    ['manager', 'problem', 'rule:manager:tickets_urgent'], ['stock', 'problem', 'rule:stock:orders_late']].sort());
  assertEquals(rule.find((n) => n.p_ref === 'rule:stock:orders_late').p_title, 'أوردرات متأخرة: 1');
  assert(rule.every((n) => n.p_link === null && /^القاعدة: /.test(n.p_body)));
  // each note is seen with its number's page in full (0150 ai_agent_note_sees)
  assertEquals(rule.map((n) => [n.p_ref, n.p_perm]).sort(), [['rule:hr:hr_requests_pending', 'hr.view'], ['rule:makers:makers_late', 'vendors.view'], ['rule:makers:makers_no_bank', 'vendors.view'], ['rule:manager:tickets_urgent', 'tickets.view'], ['rule:stock:orders_late', 'orders.view']]);
  // every live assistant's old rule notes are cleared but its own that hold (the archived one is not touched)
  const cl = clears.filter((c) => c.p_prefix === 'rule:');
  assertEquals(cl.map((c) => c.p_agent).sort(), ['hr', 'makers', 'manager', 'stock']);
  assertEquals(cl.find((c) => c.p_agent === 'makers').p_keep.sort(), ['rule:makers:makers_late', 'rule:makers:makers_no_bank']);
  // the returns were read (none waits) — its rule's note is not kept; the conversations' table is not in this seed's reach of «stock»
  assertEquals(cl.find((c) => c.p_agent === 'stock').p_keep, ['rule:stock:orders_late']);
  assertEquals(body.rules.notes, 5);
  // the numbers kept for the chats: one row, each number with the permission behind it; nothing of the archived assistant
  const st = db.rows('ai_agent_state'); assertEquals(st.length, 1); assertEquals(st[0].id, true);
  const A = st[0].facts.agents; assertEquals(Object.keys(A).sort(), ['hr', 'makers', 'manager', 'stock']);
  const late = A.stock.metrics.find((m: any) => m.key === 'orders_late');
  assertEquals([late.now, late.perm, late.rule], [1, 'orders.view', 'أوردرات متأخرة — 1 أو أكتر']);
  assertEquals(A.manager.metrics.find((m: any) => m.key === 'tickets_urgent').perm, 'tickets.view');
  assertEquals(A.hr.metrics.map((m: any) => m.perm), ['hr.view', 'hr.view']);
});

Deno.test('0150 the assistants\' rules: the admin\'s own limits rule; a rule switched off or deleted says nothing; a seller without makers counts none of them', async () => {
  const seed = SEED(); (seed as any).ai_agents = AGENTS; (seed as any).ai_agent_state = [];
  (seed as any).settings.push({ section: 'ai', data: { agents: {
    manager: { rules: [{ id: 'orders_unconfirmed', metric: 'orders_unconfirmed', op: 'gte', value: 1, kind: 'idea', on: true }, { id: 'tickets_urgent', metric: 'tickets_urgent', op: 'gte', value: 1, kind: 'problem', on: false }] },
    stock: { rules: [] } } } });
  (seed as any).settings.push({ section: 'store', data: { mode: 'single' } });
  const { deps, notes } = rulesSetup(seed);
  await cron(deps);
  assertEquals(notes.filter((n) => String(n.p_ref).startsWith('rule:')).map((n) => [n.p_agent, n.p_kind, n.p_ref, n.p_title]).sort(),
    [['hr', 'alert', 'rule:hr:hr_requests_pending', 'طلبات موارد بشرية مستنية قرار: 1'], ['manager', 'idea', 'rule:manager:orders_unconfirmed', 'أوردرات مفتوحة مستنية تأكيد: 1']]);
});

Deno.test('0150 the assistants\' rules: the admin\'s card (action rules) — live numbers, which rule holds, nothing written; a member is refused; no registry = off', async () => {
  const seed = SEED(); (seed as any).ai_agents = AGENTS; (seed as any).ai_agent_state = []; (seed as any).settings.push({ section: 'ai', data: {} });
  const { deps, db, notes } = rulesSetup(seed);
  const { res, body } = await call(deps, { action: 'rules' });
  assertEquals(res.status, 200); assertEquals(body.on, true);
  const late = body.agents.stock.rules.find((r: any) => r.metric === 'orders_late');
  assertEquals([late.now, late.firing, late.text], [1, true, 'أوردرات متأخرة — 1 أو أكتر']);
  assertEquals(body.agents.stock.own, false);
  assertEquals(body.agents.manager.rules.find((r: any) => r.metric === 'orders_unconfirmed').firing, false);
  assert(body.agents.old, 'the archived assistant is on the card too (its rules can still be read)');
  assertEquals(notes.length, 0); assertEquals(db.rows('ai_agent_state').length, 0); assertEquals(db.rows('alerts').length, 0);
  assertEquals((await call(deps, { action: 'rules' }, 'jwt-member')).res.status, 401);
  const none = rulesSetup(SEED());
  assertEquals((await call(none.deps, { action: 'rules' })).body, { result: 'ok', at: NOW, on: false, agents: {} });
});

Deno.test('phase 9 (the old orders\' import): an order placed before LIVE_FROM raises no rule — not unconfirmed, not «new» though its row was just written', async () => {
  const s = withRules([rule('r-unconf', { name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد' }),
    rule('r-new', { section_id: SEC_SUB2, name: 'أوردر جديد', element: 'orders', type: 'update', state: 'new', at: '00:00', show: 'until_read', hours: 2, last_run: '2026-11-08T07:30:00.000Z' })],
    (seed) => { seed.orders.push({ id: 501, number: '501', customer_name: 'قديمة', status: 'جاري التنفيذ', confirm: 'غير مؤكد', placed_at: '2026-03-02T10:00:00Z', created_at: '2026-11-08T07:50:00Z' }); });
  await cron(s.deps);
  const ents = s.db.rows('alerts').map((a: any) => a.entity_id);
  assert(ents.includes('o:1002'), 'the live unconfirmed order still raises its row');
  assertFalse(ents.some((e: string) => /501/.test(e)), ents.join(','));
});

Deno.test('outbound (Safwat 24 Nov): a rule naming e-mail sends each member one Resend message while the e-mail switch is on; WhatsApp waits for its switch; counts only in sync_state; a dry tick sends nothing', async () => {
  const s = withRules([rule('r-unconf', { name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد', channels: ['bell', 'email', 'whatsapp'] })],
    (seed) => { seed.settings[0].data.channels = { email: true, whatsapp: false }; });
  const d = await call(s.deps, { action: 'tick', dry: true }); assertEquals(d.body.out, 2, 'the dry tick counts the two messages');
  assertEquals([s.mails.length, s.graph.length], [0, 0], 'a dry tick sends nothing');
  const r = await cron(s.deps); assertEquals(r.res.status, 200, JSON.stringify(r.body));
  assertEquals(s.mails.map((m: any) => m.body.to[0]).sort(), ['admin@x.test', 'cs@x.test']);
  assert(/IB-1002/.test(s.mails[0].body.subject), s.mails[0].body.subject);
  assertEquals(s.graph.length, 0, 'WhatsApp waits for its switch');
  const st = s.db.row('sync_state', 'notify', 'key').value;
  assertEquals(st.notif.sent, { email: 2, whatsapp: 0, failed: 0, no_contact: 0, not_linked: 0 });
  assertFalse(JSON.stringify(st).includes('@x.test'), 'no address stored');
});

// the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): the new alerts and what the bell draws by —
// the level and who the alert is about (alerts.meta), never a phone or a text
Deno.test('the bell\'s redesign: a withdrawal waiting two days and a lost piece carry their maker; an account under zero; meta = level + owner + counts', async () => {
  const s = withRules([
    rule('r-wd', { name: 'طلب سحب مستني', element: 'makers', type: 'accounts', state: 'withdraw_wait', param: 2, at: '00:00', roles: ['admin'] }),
    rule('r-neg', { name: 'حساب بالسالب', element: 'accounts', type: 'real', state: 'negative', at: '00:00', roles: ['admin'] }),
    rule('r-lost', { name: 'قطعة مفقودة', element: 'inventory', type: 'lost', state: 'new', at: '00:00', show: 'fixed', hours: 72, roles: ['admin'], last_run: '2026-11-08T07:00:00.000Z' })],
  (seed) => {
    const V = seed.vendors[0].id;
    seed.dokan_withdrawals = [{ id: 1, woo_vendor_id: 7, vendor_id: V, amount: 900, status: 'pending', requested_at: '2026-11-05T08:00:00Z', synced_at: '2026-11-05T08:00:00Z' },
      { id: 2, woo_vendor_id: 7, vendor_id: V, amount: 100, status: 'pending', requested_at: '2026-11-08T06:00:00Z', synced_at: '2026-11-08T06:00:00Z' }];
    seed.acc_account_moves = [{ id: 'm1', account: 'كاش', on_date: '2026-11-08', direction: 'withdraw', amount: 300, created_at: '2026-11-08T07:00:00Z', voided_at: null },
      { id: 'm2', account: 'بنك', on_date: '2026-11-08', direction: 'deposit', amount: 300, created_at: '2026-11-08T07:00:00Z', voided_at: null }];
    seed.inv_lots = [{ id: 'l1', reason: 'مرتجع', status: 'مفقود', sku: 'IBT-1', name: 'كوباية', vendor_id: V, ref: 'IB-77', updated_at: '2026-11-08T07:30:00Z' }];
  });
  await cron(s.deps);
  const A = s.db.rows('alerts');
  const wd = A.filter((a: any) => a.rule_id === 'r-wd'); assertEquals(wd.length, 1, 'only the one waiting more than two days');
  const { v: wv, ...wm } = wd[0].meta; assertEquals(wm, { lv: 'important', g: 'vendor', gid: s.db.rows('vendors')[0].id, gname: 'آرت كرافت', sk: 'withdraw_wait', sm: '900 ج.م · مستني من 3 يوم' }); assert(wv && typeof wv.d === 'string', 'the template\'s own variables (meta.v)');
  assert(String(wd[0].body).includes('مستني من 3 يوم'), wd[0].body);
  const neg = A.filter((a: any) => a.rule_id === 'r-neg'); assertEquals(neg.map((a: any) => a.entity_id), ['neg:كاش']); assertEquals(neg[0].meta.lv, 'critical'); assertEquals(Object.keys(neg[0].meta).sort(), ['lv', 'v']);
  const lost = A.find((a: any) => a.rule_id === 'r-lost'); assertEquals(lost.meta.g, 'vendor'); assertEquals(lost.meta.lv, 'critical'); assertEquals(lost.hide_at, '2026-11-11T08:00:00.000Z');
  for (const a of A) assertFalse(/0109/.test(JSON.stringify(a)), 'no phone in an alert');
});

Deno.test('0162 several elements in one alert: «فردي» writes each part\'s own alerts apart (x1|…); «تقرير» writes one alert per member with every part\'s things in meta.items, renewed on the next run', async () => {
  const both = [{ element: 'accounts', type: 'real', state: 'negative' }];
  const s = withRules([
    rule('r-one', { name: 'الشغل المتأخر', element: 'makers', type: 'accounts', state: 'withdraw_wait', param: 2, at: '00:00', roles: ['admin'], mode: 'single', conds: both }),
    rule('r-rep', { name: 'تقرير المتأخر', element: 'makers', type: 'accounts', state: 'withdraw_wait', param: 2, at: '00:00', roles: ['admin'], mode: 'report', conds: both })],
  (seed) => {
    const V = seed.vendors[0].id;
    seed.dokan_withdrawals = [{ id: 1, woo_vendor_id: 7, vendor_id: V, amount: 900, status: 'pending', requested_at: '2026-11-05T08:00:00Z', synced_at: '2026-11-05T08:00:00Z' }];
    seed.acc_account_moves = [{ id: 'm1', account: 'كاش', on_date: '2026-11-08', direction: 'withdraw', amount: 300, created_at: '2026-11-08T07:00:00Z', voided_at: null }];
  });
  await cron(s.deps);
  const A = s.db.rows('alerts');
  const one = A.filter((a: any) => a.rule_id === 'r-one');
  assert(one.some((a: any) => a.entity_id === 'x1|neg:كاش'), 'the extra part keys its alert x1|');
  assert(one.some((a: any) => !String(a.entity_id).startsWith('x')), 'the rule\'s own part as before');
  const rep = A.filter((a: any) => a.rule_id === 'r-rep');
  assertEquals(rep.length, 1, 'one alert for the admin');
  assertEquals(rep[0].entity_id, 'report'); assertEquals(rep[0].kind, 'rule:report');
  assertEquals(rep[0].meta.report, true); assertEquals(rep[0].meta.n, 2); assertEquals(rep[0].meta.lv, 'critical', 'the highest level of its parts');
  assertEquals(rep[0].meta.items.map((x: any) => x.p).sort(), ['الحسابات › حساب بالسالب', 'المبتكرين › طلب سحب مستني'].sort());
  assert(String(rep[0].title).startsWith('تقرير المتأخر — 2'), rep[0].title);
  for (const a of A) assertFalse(/0109/.test(JSON.stringify(a)), 'no phone in an alert');
});

Deno.test('Safwat 25 Nov — the maker\'s card: a maker\'s late alert carries his late sub-orders\' numbers (the sub-order\'s on the site, else the order\'s), the state key and his counts — never a phone', async () => {
  const s = withRules([rule('r-mk', { name: 'أوردر فرعي متأخر', element: 'makers', type: 'making', state: 'late', at: '00:00', roles: ['admin'] })], (seed) => {
    const V = seed.vendors[0].id;
    const ord = (id: number) => ({ id, number: String(id), customer_name: 'عميل', status: 'جاري التنفيذ', woo_status: 'processing', confirm: 'مؤكد بدون عربون', confirm_at: '2026-10-01T10:00:00Z', placed_at: '2026-10-01T09:00:00Z', created_at: '2026-10-01T09:00:00Z' });
    seed.orders.push(ord(2101), ord(2102));
    seed.sub_orders = (seed.sub_orders || []).concat([{ id: 'sa1', order_id: 2101, vendor_id: V, woo_order_id: 9101, woo_status: 'processing' }]);
    const it = (id: number, order: number, so: string | null, qty = 1) => ({ id, order_id: order, sub_order_id: so, vendor_id: V, name: 'منتج', qty, status: 'جاري التنفيذ', pulled: false, removed: false });
    seed.order_items.push(it(3101, 2101, 'sa1', 2), it(3102, 2101, 'sa1'), it(3103, 2102, null));
  });
  await cron(s.deps);
  const a = s.db.rows('alerts').find((x: any) => x.rule_id === 'r-mk');
  assert(a, 'a late maker alert');
  assertEquals([a.meta.g, a.meta.st, a.meta.sk, a.meta.n, a.meta.pcs], ['vendor', 'late', 'late', 2, 4]);
  assertEquals([...a.meta.nums].sort(), ['2102', '9101'], 'the sub-order\'s number on the site, else the order\'s — one each');
  assertFalse(/0109/.test(JSON.stringify(a)), 'no phone in an alert');
});

Deno.test('Safwat 24 Nov: a line whose sub-order the site closed (shipped / completed), pulled from the hub or «ملغي» is never late — the orders page\'s own rule; an open one still is', async () => {
  const s = withRules([rule('r-subs', { name: 'أوردر فرعي متأخر', element: 'subs', type: 'delay', state: 'late', at: '00:00', roles: ['admin'] })], (seed) => {
    const V = seed.vendors[0].id;
    const ord = (id: number, woo: string) => ({ id, number: String(id), customer_name: 'عميل', status: 'قيد الشحن', woo_status: woo, confirm: 'مؤكد بدون عربون', confirm_at: '2026-10-01T10:00:00Z', placed_at: '2026-10-01T09:00:00Z', created_at: '2026-10-01T09:00:00Z' });
    seed.orders.push(ord(2001, 'processing'), ord(2002, 'processing'), ord(2003, 'processing'), ord(2004, 'processing'));
    seed.sub_orders = (seed.sub_orders || []).concat([{ id: 'so1', order_id: 2001, vendor_id: V, woo_order_id: 9001, woo_status: 'completed' }, { id: 'so2', order_id: 2002, vendor_id: V, woo_order_id: 9002, woo_status: 'processing' },
      { id: 'so3', order_id: 2003, vendor_id: V, woo_order_id: 9003, woo_status: 'processing' }, { id: 'so4', order_id: 2004, vendor_id: V, woo_order_id: 9004, woo_status: 'processing' }]);
    const it = (id: number, order: number, so: string, extra: any = {}) => ({ id, order_id: order, sub_order_id: so, vendor_id: V, name: 'منتج', qty: 1, status: 'جاري التنفيذ', pulled: false, removed: false, ...extra });
    seed.order_items.push(it(3001, 2001, 'so1'), it(3002, 2002, 'so2'), it(3003, 2003, 'so3', { pulled: true }), it(3004, 2004, 'so4', { status: 'ملغي' }));
  });
  await cron(s.deps);
  const ids = s.db.rows('alerts').filter((a: any) => a.rule_id === 'r-subs').map((a: any) => String(a.entity_id).split(':')[1]);
  assert(ids.includes('2002'), 'the open sub-order is late: ' + ids.join(','));
  for (const n of ['2001', '2003', '2004']) assertFalse(ids.includes(n), n + ' is closed / pulled / cancelled');
});

// Safwat 28 Nov — «الأعطال» (an event: told even if it is gone) and «مساحة التخزين» (the project's space against the Free plan)
Deno.test('faults and storage (0173): the screen\'s errors, the site\'s sync, a failed job, a failed send and AI call since the last run, one alert each with its count; the space over 80% of the plan; names and counts only', async () => {
  const LAST = '2026-11-08T07:45:00.000Z';
  const s = withRules([
    rule('r-fault', { name: 'وجود عطل', element: 'faults', type: 'fault', state: 'found', at: '00:00', show: 'fixed', hours: 72, roles: ['admin'], last_run: LAST }),
    rule('r-space', { name: 'التخزين امتلأ', element: 'storage', type: 'space', state: 'full', param: 80, at: '00:00', roles: ['admin'] })],
  (seed) => {
    seed.activity_log = [{ id: 1, at: '2026-11-08T07:50:00Z', actor: OPS, action: 'app.crash', entity: 'app', new_value: { kind: 'error' } },
      { id: 2, at: '2026-11-08T07:55:00Z', actor: OPS, action: 'app.crash', entity: 'app', new_value: { kind: 'blank' } },
      { id: 3, at: '2026-11-08T07:00:00Z', actor: CS, action: 'app.crash', entity: 'app', new_value: { kind: 'error' } }]; // before the last run
    seed.woo_sync_log = [{ id: 7, at: '2026-11-08T07:50:00Z', kind: 'cron', direction: 'in', entity: 'orders', result: 'error' }, { id: 8, at: '2026-11-08T07:51:00Z', kind: 'cron', direction: 'in', entity: 'orders', result: 'ok' }];
    seed.cs_messages = [{ id: 'm9', conversation_id: 'c1', delivery: 'failed', created_at: '2026-11-08T07:52:00Z', meta: {} }];
    seed.ai_runs = [{ id: 'a1', status: 'error', created_at: '2026-11-08T07:53:00Z' }, { id: 'a2', status: 'ok', created_at: '2026-11-08T07:53:00Z' }];
  }, {
    dev_cron_health: () => ({ jobs: [{ name: 'woo-sync-orders', runs: 4, failed: 2, last_failed_at: '2026-11-08T07:58:00+00:00', msg: 'x' }, { name: 'old-job', runs: 1, failed: 1, last_failed_at: '2026-11-08T07:10:00+00:00' }], http: { failed: 0 } }),
    storage_usage: () => ({ db_bytes: 450 * 1048576, files_bytes: 100 * 1048576, files: 49 }),
  });
  const r = await cron(s.deps); assertEquals(r.res.status, 200, JSON.stringify(r.body));
  const A = s.db.rows('alerts');
  const F = A.filter((a: any) => a.rule_id === 'r-fault').map((a: any) => a.entity_id).sort();
  assertEquals(F.length, 5, F.join(','));
  assert(F.some((e: string) => e === 'fault:crash:1'), 'the two screen errors since the last run — one alert'); assert(F.some((e: string) => e.startsWith('fault:cron:woo-sync-orders')), 'the job that failed since');
  assertFalse(F.some((e: string) => /old-job/.test(e)), 'a job that failed before the last run is not told again');
  const crash = A.find((a: any) => a.entity_id === 'fault:crash:1'); assert(/2 خطأ على الشاشة عند علي/.test(String(crash.body)), crash.body); assertEquals(crash.meta.lv, 'critical');
  const sp = A.filter((a: any) => a.rule_id === 'r-space'); assertEquals(sp.map((a: any) => a.entity_id), ['storage:db'], 'the database at 90%, the files at 10%');
  assert(/450 ميجا من 500 ميجا \(90%\)/.test(String(sp[0].body)), sp[0].body);
  // the limits from the settings (a paid plan): under the bar = the state left → hidden
  await s.db.from('settings').insert({ section: 'system', data: { storage: { db_mb: 8192, files_mb: 102400 } } });
  await cron({ ...s.deps, now: () => '2026-11-09T08:00:00.000Z' });
  assert(s.db.rows('alerts').filter((a: any) => a.rule_id === 'r-space').every((a: any) => a.hide_at), 'under 80% of the paid plan: the alert leaves the bell');
});
