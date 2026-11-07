// deno-lint-ignore-file no-explicit-any
// mkt-ads handler tests (phase 9.5.3): read-only Meta Ads numbers — the cron's auth, the first run (90 days) and the next ones (3),
// the pages followed, the rows written (objects + daily stats per campaign and per ad), a failure kept on the account row with the
// last success, the status and the admin's sync by hand (logged with counts only), the token in the header only. No network: a fake
// fetch routes «METHOD path» of graph.facebook.com; the database is ../_test/fakes.ts.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const TOKEN = 'EAAG' + 'x'.repeat(40);
const ADS_ENV = { ...ENV, META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: 'act_1122334455' };
const U = { admin: '00000000-0000-4000-8000-0000000052d1', view: '00000000-0000-4000-8000-0000000052d2', none: '00000000-0000-4000-8000-0000000052d3' };
const MEMBERS: Record<string, { uid: string; admin?: boolean; view?: string }> = { 'jwt-admin': { uid: U.admin, admin: true }, 'jwt-view': { uid: U.view, view: 'F' }, 'jwt-none': { uid: U.none, view: 'N' } };
const C1 = '120252323303340228';
type Call = { method: string; path: string; query: Record<string, string>; auth: string | null };
type Route = { status?: number; body?: unknown } | ((c: Call) => { status?: number; body?: unknown } | Error);
function fakeGraph(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init.headers);
    const call: Call = { method: init.method ?? 'GET', path: url.pathname.replace(/^\/v21\.0\//, ''), query: Object.fromEntries(url.searchParams), auth: h.get('authorization') };
    calls.push(call);
    const r = routes[`${call.method} ${call.path}`]; const reply = typeof r === 'function' ? r(call) : r;
    if (reply instanceof Error) throw reply;
    if (!reply) return new Response(JSON.stringify({ error: { message: 'no route', code: 100 } }), { status: 404 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const insight = (level: string, day: string, extra: Record<string, any> = {}) => ({ campaign_id: C1, campaign_name: 'Macrame', ...(level === 'ad' ? { ad_id: '1206', ad_name: 'carousel' } : {}),
  spend: '400.5', impressions: '9000', reach: '7000', clicks: '200', inline_link_clicks: '150', frequency: '1.28', actions: [{ action_type: 'omni_purchase', value: '3' }], action_values: [{ action_type: 'omni_purchase', value: '3600' }], date_start: day, date_stop: day, ...extra });
const OK_ROUTES: Record<string, Route> = {
  'GET act_1122334455': { body: { id: 'act_1122334455', name: 'Ibtekr Club', currency: 'EGP', timezone_name: 'Africa/Cairo', account_status: 1 } },
  'GET act_1122334455/campaigns': { body: { data: [{ id: C1, name: 'Macrame', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES' }] } },
  'GET act_1122334455/ads': { body: { data: [{ id: '1206', name: 'carousel', campaign_id: C1, effective_status: 'ACTIVE', creative: { id: '9', thumbnail_url: 'https://scontent.example/t.jpg' } }] } },
  'GET act_1122334455/insights': (c) => c.query.after === 'p2'
    ? { body: { data: [insight(c.query.level, '2026-10-24')] } }
    : { body: { data: [insight(c.query.level, '2026-10-25')], paging: { next: 'https://graph.facebook.com/v21.0/act_1122334455/insights?level=' + c.query.level + '&after=p2' } } },
};
type Opts = { routes?: Record<string, Route>; env?: Record<string, string>; objects?: any[]; stats?: any[] };
function setup({ routes = OK_ROUTES, env = ADS_ENV, objects = [], stats = [] }: Opts = {}) {
  const rpc = { sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok' };
  const db = fakeDb({ mkt_ad_objects: objects, mkt_ad_stats: stats, activity_log: [] }, { rpc });
  const userDb = (jwt: string) => { const m = MEMBERS[jwt]; return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'marketing.view' ? m.view ?? 'N' : 'N'), is_admin: () => !!m.admin } : {} }); };
  const g = fakeGraph(routes);
  const deps = { env, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, fetch: g.fetch };
  return { deps, db, calls: g.calls };
}
const req = (body: unknown, headers: Record<string, string>) => new Request('http://local/mkt-ads', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const cron = async (deps: any, secret = 'sync-secret-ok') => { const res = await handler(req({ action: 'sync' }, { 'x-sync-secret': secret }), deps); return { res, body: await res.json() }; };
const call = async (deps: any, body: unknown, jwt = 'jwt-admin') => { const res = await handler(req(body, { authorization: 'Bearer ' + jwt }), deps); return { res, body: await res.json() }; };

Deno.test('the cron: the sync secret only, «sync» only; without the owner\'s token and account: not_configured', async () => {
  const { deps } = setup();
  assertEquals((await cron(deps, 'nope')).res.status, 401);
  assertEquals((await handler(req({ action: 'status' }, { 'x-sync-secret': 'sync-secret-ok' }), deps)).status, 401);
  const none = setup({ env: ENV });
  const r = await cron(none.deps);
  assertEquals([r.res.status, r.body.error], [503, 'not_configured']);
  assertEquals(none.calls.length, 0);
});

Deno.test('the first run: 90 days, the pages followed, the objects and the daily numbers per campaign and per ad; the token in the header only', async () => {
  const { deps, db, calls } = setup();
  const r = await cron(deps);
  assertEquals([r.res.status, r.body.days, r.body.since, r.body.until, r.body.campaigns, r.body.ads, r.body.stats], [200, 90, '2026-07-28', '2026-10-25', 1, 1, 4]);
  // the insights a week at a time (13 weeks for 90 days), each level, each page followed
  const ins = calls.filter((c) => c.path === 'act_1122334455/insights');
  assertEquals(ins.slice(0, 4).map((c) => [c.query.level, c.query.after ?? null]), [['campaign', null], ['campaign', 'p2'], ['ad', null], ['ad', 'p2']]);
  assertEquals(ins.length, 13 * 4);
  assertEquals(JSON.parse(ins[0].query.time_range), { since: '2026-07-28', until: '2026-08-03' });
  const firsts = ins.filter((c) => !c.query.after); // a page's own link carries no time_range of ours
  assertEquals(JSON.parse(firsts[firsts.length - 1].query.time_range), { since: '2026-10-20', until: '2026-10-25' });
  assert(firsts.every((c) => c.query.limit === '100'));
  assert(calls.every((c) => c.auth === 'Bearer ' + TOKEN && !JSON.stringify(c.query).includes(TOKEN)));
  const stats = db.rows('mkt_ad_stats');
  assertEquals(stats.map((s: any) => [s.level, s.object_id, s.day, s.spend, s.purchases, s.purchase_value]).sort(), [
    ['ad', '1206', '2026-10-24', 400.5, 3, 3600], ['ad', '1206', '2026-10-25', 400.5, 3, 3600], ['campaign', C1, '2026-10-24', 400.5, 3, 3600], ['campaign', C1, '2026-10-25', 400.5, 3, 3600]]);
  const objs = db.rows('mkt_ad_objects');
  const acct = objs.find((o: any) => o.kind === 'account');
  assertEquals([acct.id, acct.name, acct.status, acct.meta.currency, acct.meta.synced_at, acct.meta.error], ['1122334455', 'Ibtekr Club', 'ACTIVE', 'EGP', NOW, null]);
  assertEquals(objs.find((o: any) => o.kind === 'ad').thumb, 'https://scontent.example/t.jpg');
  assertFalse(JSON.stringify(objs).includes(TOKEN) || JSON.stringify(stats).includes(TOKEN));
  // the next run: 3 days, the same rows updated (no duplicates)
  const r2 = await cron(deps);
  assertEquals([r2.body.days, r2.body.since], [3, '2026-10-23']);
  assertEquals(db.rows('mkt_ad_stats').length, 4);
});

Deno.test('a failure: our code on the account row, the last success and the numbers kept; Meta\'s timeout = timeout', async () => {
  const prev = { platform: 'meta', kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE', thumb: null, meta: { currency: 'EGP', synced_at: '2026-10-24T10:00:00.000Z', checked_at: '2026-10-24T10:00:00.000Z', error: null } };
  const kept = { platform: 'meta', level: 'campaign', object_id: C1, campaign_id: C1, day: '2026-10-24', spend: 100, impressions: 1, clicks: 0, purchases: 0, purchase_value: 0 };
  const { deps, db } = setup({ objects: [prev], stats: [kept], routes: { ...OK_ROUTES, 'GET act_1122334455/campaigns': { status: 400, body: { error: { code: 190, message: 'expired' } } } } });
  const r = await cron(deps);
  assertEquals([r.res.status, r.body.error], [502, 'token']);
  const acct = db.rows('mkt_ad_objects').find((o: any) => o.kind === 'account');
  assertEquals([acct.name, acct.meta.synced_at, acct.meta.checked_at, acct.meta.error, acct.meta.error_text], ['Ibtekr Club', '2026-10-24T10:00:00.000Z', NOW, 'token', 'expired']);
  assertEquals(r.body.text, 'expired'); // Meta's words reach the admin; a status read says them too
  assertEquals((await call(deps, { action: 'status' }, 'jwt-view')).body.text, 'expired');
  assertEquals(db.rows('mkt_ad_stats').length, 1);
  const t = setup({ routes: { ...OK_ROUTES, 'GET act_1122334455': () => Object.assign(new Error('aborted'), { name: 'AbortError' }) } });
  assertEquals((await cron(t.deps)).body.error, 'timeout');
});

Deno.test('status: marketing.view; the account, the last success and error — never the token; none → 401', async () => {
  const { deps } = setup();
  await cron(deps);
  const s = await call(deps, { action: 'status' }, 'jwt-view');
  assertEquals([s.res.status, s.body.configured, s.body.account.name, s.body.account.currency, s.body.synced_at, s.body.error], [200, true, 'Ibtekr Club', 'EGP', NOW, null]);
  assertFalse(JSON.stringify(s.body).includes(TOKEN));
  assertEquals((await call(deps, { action: 'status' }, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, { action: 'status' }, 'jwt-unknown')).res.status, 401);
  const none = setup({ env: ENV });
  assertEquals((await call(none.deps, { action: 'status' }, 'jwt-view')).body, { configured: false, account: null, synced_at: null, checked_at: null, error: null, text: null });
});

Deno.test('sync by hand: the admin only, 1–400 days, logged with counts only', async () => {
  const { deps, db } = setup();
  assertEquals((await call(deps, { action: 'sync' }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'sync', days: 0 })).res.status, 400);
  assertEquals((await call(deps, { action: 'sync', days: 401 })).res.status, 400);
  const r = await call(deps, { action: 'sync', days: 7 });
  assertEquals([r.res.status, r.body.days, r.body.since], [200, 7, '2026-10-19']);
  const log = db.rows('activity_log');
  assertEquals(log.map((l: any) => [l.action, l.actor, l.entity, l.new_value]), [['mkt.ads.sync', U.admin, 'mkt_ads', '7 · 1 · 1 · 4']]);
  assertEquals((await call(deps, { action: 'other' })).res.status, 400);
});

// ---------------------------------------------------------------- 9.5.4: the media buyer (decisions 49–52)
const C2 = '120251977233530228';
const dayN = (n: number) => new Date(Date.parse('2026-10-25T00:00:00Z') - n * 86400_000).toISOString().slice(0, 10);
const campStat = (id: string, n: number, spend: number, purchases = 0) => ({ platform: 'meta', level: 'campaign', object_id: id, campaign_id: id, day: dayN(n), spend, impressions: 1000, clicks: 10, purchases, purchase_value: 0 });
const BUYER_OBJECTS = [
  { platform: 'meta', kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE', meta: { currency: 'EGP' } },
  { platform: 'meta', kind: 'campaign', id: C1, name: 'Macrame', status: 'ACTIVE', meta: { daily_budget: 300 } },
  { platform: 'meta', kind: 'campaign', id: C2, name: 'Lamps', status: 'ACTIVE', meta: {} },
];
// Lamps: 2,000 in 5 days without an order → stop; Macrame: 5 orders of 700 on 700 spent → MER 5 → scale
const BUYER_STATS = [...[0, 1, 2, 3, 4].map((n) => campStat(C2, n, 400, 2)), ...[0, 1, 2, 3, 4, 5, 6].map((n) => campStat(C1, n, 100, 1))];
const BUYER_ORDERS = [0, 1, 2, 3, 4].map((n, i) => ({ id: 95300001 + i, number: String(95300001 + i), customer_name: 'ع', status: 'مكتمل', confirm: 'غير مؤكد', deposit: 0, total: 700, placed_at: dayN(n) + 'T10:00:00+02:00', ad_platform: 'meta', utm_campaign: C1 }));
const STATUS_MAP = [{ id: 1, system_status: 'مكتمل', woo_status: 'completed' }];
// the sync of these tests brings the two campaigns and no insights, so the seeded numbers are the numbers
const BUYER_ROUTES: Record<string, Route> = { ...OK_ROUTES,
  'GET act_1122334455/campaigns': { body: { data: [{ id: C1, name: 'Macrame', effective_status: 'ACTIVE', daily_budget: '30000' }, { id: C2, name: 'Lamps', effective_status: 'ACTIVE' }] } },
  'GET act_1122334455/insights': { body: { data: [] } } };
// the fake keeps rows the function inserted; seed the rest the same way
async function seedBuyer(db: any, extra: { settings?: any[]; suggestions?: any[] } = {}) {
  await db.from('status_map').insert(STATUS_MAP); // the orders' status is a foreign key of it
  const { error } = await db.from('orders').insert(BUYER_ORDERS);
  if (error) throw new Error('seed orders ' + JSON.stringify(error));
  if (extra.settings?.length) await db.from('settings').insert(extra.settings);
  if (extra.suggestions?.length) await db.from('mkt_suggestions').insert(extra.suggestions);
}

Deno.test('suggest (after a sync): stop for a campaign spending without orders, scale for a high real return; again → the open rows kept (no doubles), one gone expires', async () => {
  const { deps, db } = setup({ routes: BUYER_ROUTES, objects: BUYER_OBJECTS, stats: BUYER_STATS });
  await seedBuyer(db);
  const r = await cron(deps);
  assertEquals([r.res.status, r.body.suggestions], [200, 2]);
  const rows = db.rows('mkt_suggestions');
  assertEquals(rows.map((s: any) => [s.kind, s.campaign_id, s.status, s.pct]).sort(), [['budget_up', C1, 'pending', 20], ['stop', C2, 'pending', null]]);
  assert(rows.find((s: any) => s.kind === 'stop').title.includes('Lamps') && rows.find((s: any) => s.kind === 'stop').data.orders5 === 0);
  // the next sync: the same two, refreshed, not doubled
  await cron(deps);
  assertEquals(db.rows('mkt_suggestions').length, 2);
  // Lamps paused on Meta (the sync writes the objects): its stop expires
  const paused = setup({ objects: BUYER_OBJECTS, stats: BUYER_STATS, routes: { ...BUYER_ROUTES, 'GET act_1122334455/campaigns': { body: { data: [{ id: C1, name: 'Macrame', effective_status: 'ACTIVE', daily_budget: '30000' }, { id: C2, name: 'Lamps', effective_status: 'PAUSED' }] } } } });
  await seedBuyer(paused.db, { suggestions: rows });
  await cron(paused.deps);
  assertEquals(paused.db.rows('mkt_suggestions').find((s: any) => s.kind === 'stop').status, 'expired');
  // no token: the suggestions still come from the stored numbers? no — a sync needs the token; nothing is written
  assertEquals((await cron(setup({ env: ENV }).deps)).res.status, 503);
});

Deno.test('rules: marketing.view reads the defaults; the admin sets the numbers (logged, never live through rules_set) and the switch (logged)', async () => {
  const { deps, db } = setup();
  const r = await call(deps, { action: 'rules' }, 'jwt-view');
  assertEquals(r.body.rules, { dailyCap: 5000, maxCpa: 450, autoStop: 1500, autoStopMode: 'suggest', reportHour: 9, live: false });
  assertEquals((await call(deps, { action: 'rules_set', rules: { dailyCap: 8000 } }, 'jwt-view')).res.status, 401);
  const s = await call(deps, { action: 'rules_set', rules: { dailyCap: 8000, autoStopMode: 'auto', live: true } });
  assertEquals([s.body.rules.dailyCap, s.body.rules.autoStopMode, s.body.rules.live], [8000, 'auto', false]);
  assertEquals((await call(deps, { action: 'rules_set', rules: { maxCpa: 0 } })).body.field, 'maxCpa');
  const on = await call(deps, { action: 'live', on: true });
  assertEquals([on.body.rules.live, on.body.rules.dailyCap], [true, 8000]);
  assertEquals(db.rows('settings')[0].data, { buyer: { dailyCap: 8000, autoStopMode: 'auto', live: true } });
  assertEquals(db.rows('activity_log').map((l: any) => [l.action, l.new_value]), [['mkt.buyer.rules', 'dailyCap, autoStopMode'], ['mkt.buyer.live', 'on']]);
  assertEquals((await call(deps, { action: 'live', on: 'yes' })).res.status, 400);
});

const SUGG = (id: number, kind: string, extra: any = {}) => ({ id, platform: 'meta', kind, campaign_id: C1, campaign_name: 'Macrame', title: kind === 'creative' ? 'إعلان «carousel» الناس زهقت منه' : 'زوّد «Macrame» 20%', pct: kind === 'budget_up' ? 20 : kind === 'budget_down' ? -30 : null, data: {}, status: 'pending', created_at: NOW, checked_at: NOW, ...extra });
const ON = [{ section: 'marketing', data: { buyer: { live: true, dailyCap: 5000 } } }];

Deno.test('decide: the admin only; reject; the switch off → the decision kept with no call; stop → PAUSED on the campaign\'s node; decided twice → 409', async () => {
  const { deps, db, calls } = setup({ routes: { ...OK_ROUTES, ['POST ' + C1]: { body: { success: true } } } });
  await seedBuyer(db, { suggestions: [SUGG(1, 'stop'), SUGG(2, 'stop', { id: 2 }), SUGG(3, 'stop', { id: 3 })] });
  assertEquals((await call(deps, { action: 'decide', id: 1, decision: 'approve' }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'decide', id: 1, decision: 'reject', note: 'سيبها' })).body.status, 'rejected');
  assertEquals(db.rows('mkt_suggestions')[0].note, 'سيبها');
  const off = await call(deps, { action: 'decide', id: 2, decision: 'approve' });
  assertEquals([off.body.status, off.body.live, calls.filter((c) => c.method === 'POST').length], ['approved', false, 0]);
  await db.from('settings').insert(ON);
  const on = await call(deps, { action: 'decide', id: 3, decision: 'approve' });
  assertEquals([on.res.status, on.body.status, on.body.status_], [200, 'done', undefined]);
  const p = calls.find((c) => c.method === 'POST')!;
  assertEquals([p.path, p.auth], [C1, 'Bearer ' + TOKEN]);
  assertEquals(db.rows('mkt_suggestions')[2].result, { status: 'PAUSED' });
  assertEquals((await call(deps, { action: 'decide', id: 3, decision: 'approve' })).res.status, 409);
  assertEquals(db.rows('activity_log').map((l: any) => l.new_value), ['stop · reject · ' + C1, 'stop · approve · ' + C1 + ' · live_off', 'stop · approve · ' + C1 + ' · ok']);
  assertFalse(JSON.stringify(db.rows('activity_log')).includes('300'));
});

Deno.test('decide a budget: the campaign\'s own daily budget (CBO) by the step, edited to another step, the cap and the 30% ceiling refused, the ad sets when the campaign has none', async () => {
  const routes = { ...OK_ROUTES,
    ['GET ' + C1]: { body: { id: C1, daily_budget: '30000', effective_status: 'ACTIVE' } },
    ['GET ' + C1 + '/adsets']: { body: { data: [{ id: '700', daily_budget: '10000', effective_status: 'ACTIVE' }, { id: '701', daily_budget: '5000', effective_status: 'PAUSED' }] } },
    'GET act_1122334455/adsets': { body: { data: [{ id: '900', campaign_id: '999', daily_budget: '100000', effective_status: 'ACTIVE' }] } },
    ['POST ' + C1]: { body: { success: true } }, 'POST 700': { body: { success: true } } };
  const { deps, db, calls } = setup({ routes });
  await seedBuyer(db, { settings: ON, suggestions: [SUGG(1, 'budget_up'), SUGG(2, 'budget_up', { id: 2 }), SUGG(3, 'budget_up', { id: 3 }), SUGG(4, 'budget_down', { id: 4 })] });
  const r = await call(deps, { action: 'decide', id: 1, decision: 'approve' });
  assertEquals([r.res.status, r.body.status, r.body.before, r.body.after], [200, 'done', 300, 360]);
  const posts = () => calls.filter((c) => c.method === 'POST');
  assertEquals(posts().length, 1);
  // the body carries the new budget in minor units
  const e = await call(deps, { action: 'decide', id: 2, decision: 'edit', value: 10 });
  assertEquals([e.body.status, e.body.after, db.rows('mkt_suggestions')[1].value], ['done', 330, 10]);
  assertEquals((await call(deps, { action: 'decide', id: 3, decision: 'edit', value: -10 })).body.field, 'value'); // a raise edited into a cut
  assertEquals((await call(deps, { action: 'decide', id: 3, decision: 'edit', value: 40 })).body.error, 'step');
  assertEquals(db.rows('mkt_suggestions')[2].status, 'failed');
  // the cap: the rest of the account spends 1,000 a day (the other ad set); a cap of 1,300 refuses 360
  const capped = setup({ routes }); await seedBuyer(capped.db, { settings: [{ section: 'marketing', data: { buyer: { live: true, dailyCap: 1300 } } }], suggestions: [SUGG(5, 'budget_up', { id: 5 })] });
  const c = await call(capped.deps, { action: 'decide', id: 5, decision: 'approve' });
  assertEquals([c.res.status, c.body.error, c.body.cap], [409, 'cap', 1300]);
  // no CBO: the active ad set's budget moves (−30%)
  const noCbo = setup({ routes: { ...routes, ['GET ' + C1]: { body: { id: C1, effective_status: 'ACTIVE' } } } });
  await seedBuyer(noCbo.db, { settings: ON, suggestions: [SUGG(6, 'budget_down', { id: 6 })] });
  const d = await call(noCbo.deps, { action: 'decide', id: 6, decision: 'approve' });
  assertEquals([d.body.status, d.body.before, d.body.after, d.body.updates], ['done', 100, 70, 1]);
  assertEquals(noCbo.calls.filter((x) => x.method === 'POST').map((x) => x.path), ['700']);
});

Deno.test('decide creative → a designer request and done; tracking → reviewed; Meta refusing a write → failed with our code', async () => {
  const { deps, db } = setup({ routes: { ...OK_ROUTES, ['POST ' + C1]: { status: 400, body: { error: { code: 190, message: 'expired' } } } } });
  await seedBuyer(db, { settings: ON, suggestions: [SUGG(1, 'creative', { ad_id: '1206' }), SUGG(2, 'tracking', { id: 2, title: 'فرق كبير في أرقام «Macrame»' }), SUGG(3, 'stop', { id: 3 })] });
  const c = await call(deps, { action: 'decide', id: 1, decision: 'approve', note: 'فيديو قصير' });
  assertEquals([c.body.status, c.body.request], ['done', true]);
  const rq = db.rows('mkt_requests')[0];
  assertEquals([rq.kind, rq.title, rq.project, rq.status, rq.created_by], ['designer', 'نسخة جديدة لإعلان «carousel»', 'Macrame', 'جديد', U.admin]);
  assertEquals((await call(deps, { action: 'decide', id: 2, decision: 'approve' })).body.status, 'done');
  const f = await call(deps, { action: 'decide', id: 3, decision: 'approve' });
  assertEquals([f.res.status, f.body.error, db.rows('mkt_suggestions')[2].status, db.rows('mkt_suggestions')[2].error], [502, 'token', 'failed', 'token']);
  assertEquals((await call(deps, { action: 'decide', id: 2, decision: 'edit', value: 5 })).res.status, 409);
});

Deno.test('report (the cron): at the rule\'s Cairo hour only, once a day — yesterday\'s spend and orders and the open suggestions to the admin and ops bells', async () => {
  const { deps, db } = setup({ stats: [campStat(C1, 1, 1234.5, 3), campStat(C2, 1, 100)] });
  await seedBuyer(db, { suggestions: [SUGG(1, 'stop')], settings: [{ section: 'marketing', data: { buyer: { reportHour: 15 } } }] }); // NOW is 12:00Z = 15:00 Cairo (October: UTC+3)
  const r = await handler(req({ action: 'report' }, { 'x-sync-secret': 'sync-secret-ok' }), deps);
  assertEquals([r.status, (await r.json()).day], [200, dayN(1)]);
  const a = db.rows('alerts');
  assertEquals(a.map((x: any) => [x.role_id, x.kind, x.entity, x.entity_id]), [['admin', 'marketing', 'marketing-ai', 'report:2026-10-25'], ['ops', 'marketing', 'marketing-ai', 'report:2026-10-25']]);
  assertEquals(a[0].body, 'الصرف إمبارح 1,335 ج.م · 1 أوردر من الإعلانات (700 ج.م) · العائد الحقيقي 0.52× · 1 اقتراح مستني موافقتك');
  assertEquals((await (await handler(req({ action: 'report' }, { 'x-sync-secret': 'sync-secret-ok' }), deps)).json()).reason, 'sent');
  const early = setup(); await seedBuyer(early.db);
  assertEquals((await (await handler(req({ action: 'report' }, { 'x-sync-secret': 'sync-secret-ok' }), early.deps)).json()).reason, 'hour');
  assertEquals((await handler(req({ action: 'report' }, { authorization: 'Bearer jwt-admin' }), deps)).status, 400); // a member's action it is not
});
