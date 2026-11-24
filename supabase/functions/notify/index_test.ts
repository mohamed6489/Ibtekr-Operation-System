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
  assertEquals([st.body.last, st.body.channels], [null, ['bell']]);
});

// the notifications' new structure (Safwat 24 Nov — 0157): the admin's rules under the sub-sections → the bell's rows
const SEC_MAIN = '00000000-0000-4000-8000-0000000005a1'; const SEC_SUB = '00000000-0000-4000-8000-0000000005a2'; const SEC_SUB2 = '00000000-0000-4000-8000-0000000005a3';
const rule = (id: string, x: any) => ({ id, section_id: SEC_SUB, name: 'تنبيه', sub: null, param: null, at: '09:00', repeat: '24h', days: [], show: 'until_state', hours: 0, roles: ['admin', 'cs'], channels: ['bell'], template: null, active: true, last_run: null, updated_at: '2026-11-01T00:00:00Z', ...x });
function withRules(rules: any[], more: (s: any) => void = () => {}) {
  const seed: any = SEED();
  seed.notif_sections = [{ id: SEC_MAIN, parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: SEC_SUB, parent_id: SEC_MAIN, name: 'غير مؤكدة', sort: 0 }, { id: SEC_SUB2, parent_id: SEC_MAIN, name: 'جديد', sort: 1 }];
  seed.notif_rules = rules; seed.alerts = []; seed.alert_reads = []; more(seed);
  return setup({ seed });
}

Deno.test('rules: a «state» rule (an unconfirmed order) → a row per member of its roles who sees orders, under its sub-section; renewed by its repeat; hidden once the order leaves the state', async () => {
  const s = withRules([rule('r-unconf', { name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد', template: '{الرقم} لسه ما اتأكدش — {التفاصيل}' })]);
  const r = await cron(s.deps); assertEquals(r.res.status, 200, JSON.stringify(r.body));
  let A = s.db.rows('alerts');
  assertEquals(A.map((a: any) => a.user_id).sort(), [ADMIN, CS].sort(), 'the admin and the cs member (ops is not in the rule; the suspended member never)');
  const a0 = A[0]; assertEquals([a0.rule_id, a0.section_id, a0.entity_id, a0.entity, a0.hide_at, a0.kind], ['r-unconf', SEC_SUB, 'o:1002', 'orders/1002', null, 'rule:orders.confirm']);
  assert(/IB-1002 لسه ما اتأكدش — غير مؤكد · عمره 2 يوم/.test(a0.body), a0.body); assertEquals(a0.title, 'أوردر غير مؤكد — IB-1002');
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

Deno.test('rules (security review): an assistant\'s note reaches only the members who see that assistant — no element page lets the rest in', async () => {
  const s = withRules([rule('r-ai', { name: 'تنبيهات المساعدين', element: 'ai', type: 'any', state: 'notes', at: '00:00', show: 'until_read', hours: 6, roles: ['admin', 'cs', 'ops'], last_run: '2026-11-08T07:00:00.000Z' })],
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
