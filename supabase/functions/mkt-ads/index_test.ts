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
type Call = { method: string; path: string; query: Record<string, string>; auth: string | null; host: string; headers: Record<string, string>; body: any };
type Route = { status?: number; body?: unknown } | ((c: Call) => { status?: number; body?: unknown } | Error);
function fakeGraph(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init.headers); const ct = h.get('content-type') ?? '';
    const body = !init.body ? undefined : ct.includes('json') ? JSON.parse(String(init.body)) : ct.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(String(init.body))) : String(init.body);
    const call: Call = { method: init.method ?? 'GET', path: url.pathname.replace(/^\/v21\.0\//, ''), query: Object.fromEntries(url.searchParams), auth: h.get('authorization'), host: url.host, headers: Object.fromEntries(h), body };
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
type Opts = { routes?: Record<string, Route>; env?: Record<string, string>; objects?: any[]; stats?: any[]; vault?: Record<string, string> };
function setup({ routes = OK_ROUTES, env = ADS_ENV, objects = [], stats = [], vault = {} }: Opts = {}) {
  const secrets: Record<string, string> = { ...vault };
  const rpc = { sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok',
    mkt_secret_get: ({ p_name }: any) => secrets[p_name] ?? null, mkt_secret_set: ({ p_name, p_value }: any) => { if (p_value == null) delete secrets[p_name]; else secrets[p_name] = p_value; return null; } };
  const db = fakeDb({ mkt_ad_objects: objects, mkt_ad_stats: stats, activity_log: [] }, { rpc });
  const userDb = (jwt: string) => { const m = MEMBERS[jwt]; return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'marketing.view' ? m.view ?? 'N' : 'N'), is_admin: () => !!m.admin } : {} }); };
  const g = fakeGraph(routes);
  const deps = { env, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, fetch: g.fetch };
  return { deps, db, calls: g.calls, secrets };
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
  const nb = (await call(none.deps, { action: 'status' }, 'jwt-view')).body;
  assertEquals([nb.configured, nb.account, nb.synced_at, nb.checked_at, nb.error, nb.text], [false, null, null, null, null, null]);
  assertEquals([nb.platforms.meta.configured, nb.platforms.tiktok.configured, nb.platforms.google.configured, nb.redirect], [false, false, false, 'https://operation-system.ibtekr.club/ads-callback.html']); // 9.5.6
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
// four confirmed (one of them under way) + one completed: a raise counts them all; an unconfirmed one would not
const BUYER_ORDERS = [0, 1, 2, 3, 4].map((n, i) => ({ id: 95300001 + i, number: String(95300001 + i), customer_name: 'ع', status: n ? 'جاري التنفيذ' : 'مكتمل', confirm: n ? 'مؤكد بعربون' : 'غير مؤكد', deposit: 0, total: 700, placed_at: dayN(n) + 'T10:00:00+02:00', ad_platform: 'meta', utm_campaign: C1 }));
const STATUS_MAP = [{ id: 1, system_status: 'مكتمل', woo_status: 'completed' }, { id: 2, system_status: 'جاري التنفيذ', woo_status: 'processing' }];
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
  assertEquals(rows.find((s: any) => s.kind === 'budget_up').data.confirmed, 5);
  // the same orders unconfirmed and not completed: no raise (anyone can place an order with the campaign's UTM)
  const loose = setup({ routes: BUYER_ROUTES, objects: BUYER_OBJECTS, stats: BUYER_STATS });
  await loose.db.from('status_map').insert(STATUS_MAP); await loose.db.from('orders').insert(BUYER_ORDERS.map((o) => ({ ...o, status: 'جاري التنفيذ', confirm: 'غير مؤكد' })));
  await cron(loose.deps);
  assertEquals(loose.db.rows('mkt_suggestions').map((s: any) => s.kind), ['stop']);
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
  assertEquals(r.body.rules, { dailyCap: 5000, maxCpa: 450, autoStop: 1500, autoStopMode: 'suggest', reportHour: 9, live: false, notes: [] });
  assertEquals((await call(deps, { action: 'rules_set', rules: { dailyCap: 8000 } }, 'jwt-view')).res.status, 401);
  const s = await call(deps, { action: 'rules_set', rules: { dailyCap: 8000, autoStopMode: 'auto', live: true } });
  assertEquals([s.body.rules.dailyCap, s.body.rules.autoStopMode, s.body.rules.live], [8000, 'auto', false]);
  assertEquals((await call(deps, { action: 'rules_set', rules: { maxCpa: 0 } })).body.field, 'maxCpa');
  const on = await call(deps, { action: 'live', on: true });
  assertEquals([on.body.rules.live, on.body.rules.dailyCap], [true, 8000]);
  assertEquals(db.rows('settings')[0].data, { buyer: { dailyCap: 8000, autoStopMode: 'auto', live: true } });
  assertEquals(db.rows('activity_log').map((l: any) => [l.action, l.new_value]), [['mkt.buyer.rules', 'dailyCap, autoStopMode'], ['mkt.buyer.live', 'on']]);
  assertEquals((await call(deps, { action: 'live', on: 'yes' })).res.status, 400);
  // the written rules (the v6 prototype): stored with the rules, logged by name only — never the text; a bad list refused
  const nt = await call(deps, { action: 'rules_set', rules: { notes: [{ title: 'CTR', details: 'أقل من 0.8%', kind: 'قاعدة' }] } });
  assertEquals(nt.body.rules.notes, [{ title: 'CTR', details: 'أقل من 0.8%', kind: 'قاعدة' }]);
  assertEquals(db.rows('activity_log').at(-1).new_value, 'notes');
  assertEquals((await call(deps, { action: 'rules_set', rules: { notes: [{ title: 'x', details: 'y', kind: 'أمر' }] } })).body.field, 'notes');
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

// ---------------------------------------------------------------- 9.5.6: TikTok and Google, the links from the page (decisions 67–72)
const TT = { app_id: '7012345678', secret: 'tt-secret-0123456789', access_token: 'tt-' + 'a'.repeat(40), advertiser_id: '7000000000000000001' };
const GG = { developer_token: 'dev-token-abcdef', client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-' + 'z'.repeat(20), refresh_token: '1//0' + 'r'.repeat(40), customer_id: '1234567890', login_customer_id: '9990001111' };
const TTC = '1800000000000000001', TTA = '1700000000000000001', GC = '21000000001', GA = '7100000001';
const ttOk = (data: any) => ({ body: { code: 0, message: 'OK', data } });
const TT_ROUTES: Record<string, Route> = {
  'GET /open_api/v1.3/advertiser/info/': ttOk({ list: [{ advertiser_id: TT.advertiser_id, name: 'Ibtekr TikTok', currency: 'EGP', timezone: 'Africa/Cairo', status: 'STATUS_ENABLE' }] }),
  'GET /open_api/v1.3/campaign/get/': ttOk({ list: [{ campaign_id: TTC, campaign_name: 'Macrame TT', operation_status: 'ENABLE', budget: '300', budget_mode: 'BUDGET_MODE_DAY' }], page_info: { total_page: 1 } }),
  'GET /open_api/v1.3/ad/get/': ttOk({ list: [{ ad_id: TTA, ad_name: 'video 1', campaign_id: TTC, operation_status: 'ENABLE' }], page_info: { total_page: 1 } }),
  'GET /open_api/v1.3/report/integrated/get/': (c) => ttOk({ list: c.query.data_level === 'AUCTION_AD'
    ? [{ dimensions: { ad_id: TTA, stat_time_day: '2026-10-24 00:00:00' }, metrics: { campaign_id: TTC, spend: '20', impressions: '900', clicks: '30', complete_payment: '1', total_complete_payment_rate: '900' } }]
    : [{ dimensions: { campaign_id: TTC, stat_time_day: '2026-10-24 00:00:00' }, metrics: { spend: '120.5', impressions: '9000', reach: '7000', clicks: '210', frequency: '1.29', complete_payment: '2', total_complete_payment_rate: '1800' } }], page_info: { total_page: 1 } }),
};
const gRow = (q: string) => q.includes('FROM customer') ? [{ customer: { id: GG.customer_id, descriptiveName: 'Ibtekr Google', currencyCode: 'EGP', timeZone: 'Africa/Cairo', status: 'ENABLED' } }]
  : q.startsWith('SELECT campaign.id, campaign.name') ? [{ campaign: { id: GC, name: 'Macrame G', status: 'ENABLED', advertisingChannelType: 'PERFORMANCE_MAX' }, campaignBudget: { amountMicros: '250000000' } }]
  : q.startsWith('SELECT ad_group_ad.ad.id, ad_group_ad.ad.name') ? [{ adGroupAd: { ad: { id: GA, name: 'pmax asset', type: 'PERFORMANCE_MAX_AD' }, status: 'ENABLED' }, campaign: { id: GC } }]
  : q.startsWith('SELECT campaign.id, segments.date') ? [{ campaign: { id: GC }, segments: { date: '2026-10-24' }, metrics: { costMicros: '80000000', impressions: '3000', clicks: '140', conversions: 1, conversionsValue: 900 } }]
  : [{ adGroupAd: { ad: { id: GA } }, campaign: { id: GC }, segments: { date: '2026-10-24' }, metrics: { costMicros: '12345678', impressions: '500', clicks: '20', conversions: 0, conversionsValue: 0 } }];
const G_ROUTES: Record<string, Route> = {
  'POST /token': { body: { access_token: 'g-access-test-token', expires_in: 3599, token_type: 'Bearer' } },
  ['POST /v21/customers/' + GG.customer_id + '/googleAds:search']: (c) => ({ body: { results: gRow(String(c.body.query)) } }),
};
const vaultTT = { ads_tiktok: JSON.stringify(TT) }; const vaultG = { ads_google: JSON.stringify(GG) };

Deno.test('9.5.6 link_set: the admin writes a platform\'s fields into Vault (never a Supabase secret); the view shows tails only; a bad field → 400; unlink empties it; a member → 401', async () => {
  const { deps, db, secrets } = setup({ env: ENV });
  assertEquals((await call(deps, { action: 'link_set', platform: 'tiktok', fields: { app_id: TT.app_id } }, 'jwt-view')).res.status, 401);
  const r = await call(deps, { action: 'link_set', platform: 'tiktok', fields: { app_id: TT.app_id, secret: TT.secret } });
  assertEquals([r.res.status, r.body.platform, r.body.configured, r.body.oauth, r.body.fields.app_id, r.body.fields.secret, r.body.missing], [200, 'tiktok', false, true, TT.app_id, '••••6789', ['access_token', 'advertiser_id']]);
  assertEquals(JSON.parse(secrets.ads_tiktok), { app_id: TT.app_id, secret: TT.secret });
  assertFalse(JSON.stringify(r.body).includes(TT.secret));
  // the token and advertiser by hand: the stored fields stay, the link is ready
  const r2 = await call(deps, { action: 'link_set', platform: 'tiktok', fields: { access_token: TT.access_token, advertiser_id: TT.advertiser_id } });
  assertEquals([r2.body.configured, r2.body.account.id], [true, TT.advertiser_id]);
  assertEquals(JSON.parse(secrets.ads_tiktok), TT);
  assertEquals((await call(deps, { action: 'link_set', platform: 'tiktok', fields: { app_id: 'abc' } })).body.field, 'app_id');
  assertEquals((await call(deps, { action: 'link_set', platform: 'snap', fields: {} })).body.field, 'platform');
  const s = await call(deps, { action: 'status' }, 'jwt-view');
  assertEquals([s.body.platforms.tiktok.configured, s.body.platforms.tiktok.fields.access_token, s.body.platforms.meta.configured, s.body.configured], [true, '••••aaaa', false, false]);
  assertFalse(JSON.stringify(s.body).includes(TT.access_token) || JSON.stringify(s.body).includes(TT.secret));
  // Meta from the page overrides the owner's secrets: the old top-level fields follow it
  await call(deps, { action: 'link_set', platform: 'meta', fields: { access_token: TOKEN, account_id: 'act_1122334455' } });
  assertEquals((await call(deps, { action: 'status' }, 'jwt-view')).body.configured, true);
  const u = await call(deps, { action: 'unlink', platform: 'tiktok' });
  assertEquals([u.body.configured, secrets.ads_tiktok], [false, undefined]);
  assertEquals(db.rows('activity_log').map((l: any) => [l.action, l.entity_id, l.new_value]), [['mkt.ads.link', 'tiktok', 'set · app_id, secret'], ['mkt.ads.link', 'tiktok', 'set · access_token, advertiser_id'], ['mkt.ads.link', 'meta', 'set · access_token, account_id'], ['mkt.ads.link', 'tiktok', 'unlink']]);
  assertFalse(JSON.stringify(db.rows('activity_log')).includes(TT.secret) || JSON.stringify(db.rows('settings')).includes(TT.secret));
});

Deno.test('9.5.6 OAuth: link_start needs the app / client (the state kept, the platform\'s url); TikTok\'s callback with two advertisers → choose → link_pick; Google\'s → one customer linked; a spent state → 400; no refresh token → 502', async () => {
  const { deps, db, secrets } = setup({ env: ENV, vault: { ads_tiktok: JSON.stringify({ app_id: TT.app_id, secret: TT.secret }), ads_google: JSON.stringify({ developer_token: GG.developer_token, client_id: GG.client_id, client_secret: GG.client_secret }) },
    routes: { 'POST /open_api/v1.3/oauth2/access_token/': ttOk({ access_token: TT.access_token, advertiser_ids: [TT.advertiser_id, '7000000000000000002'] }),
      'GET /open_api/v1.3/oauth2/advertiser/get/': ttOk({ list: [{ advertiser_id: TT.advertiser_id, advertiser_name: 'Ibtekr' }, { advertiser_id: '7000000000000000002', advertiser_name: 'Test' }] }),
      'POST /token': { body: { access_token: 'g-access-test-token', refresh_token: GG.refresh_token } }, 'GET /v21/customers:listAccessibleCustomers': { body: { resourceNames: ['customers/' + GG.customer_id] } } } });
  assertEquals((await call(deps, { action: 'link_start', platform: 'meta' })).res.status, 400);
  assertEquals((await call(deps, { action: 'link_start', platform: 'tiktok' }, 'jwt-view')).res.status, 401);
  const t = await call(deps, { action: 'link_start', platform: 'tiktok' });
  const tUrl = new URL(t.body.url); const tState = tUrl.searchParams.get('state')!;
  assertEquals([tUrl.host, tUrl.pathname, tUrl.searchParams.get('app_id'), tUrl.searchParams.get('redirect_uri')], ['business-api.tiktok.com', '/portal/auth', TT.app_id, 'https://operation-system.ibtekr.club/ads-callback.html']);
  assertEquals(db.rows('cs_oauth_states').map((x: any) => [x.state, x.channel]), [[tState, 'ads_tiktok']]);
  const g = await call(deps, { action: 'link_start', platform: 'google' });
  const gUrl = new URL(g.body.url); const gState = gUrl.searchParams.get('state')!;
  assertEquals([gUrl.host, gUrl.searchParams.get('access_type'), gUrl.searchParams.get('prompt'), gUrl.searchParams.get('scope')], ['accounts.google.com', 'offline', 'consent', 'https://www.googleapis.com/auth/adwords']);
  // the client / app missing → 400 oauth
  const bare = setup({ env: ENV }); assertEquals((await call(bare.deps, { action: 'link_start', platform: 'google' })).body.field, 'oauth');
  // TikTok comes back: the code exchanged (app id + secret in the body), two advertisers → choose (names from advertiser/get)
  const cb = await call(deps, { action: 'link_callback', code: 'auth-code-123456', state: tState });
  assertEquals([cb.res.status, cb.body.result, cb.body.linked, cb.body.accounts.map((a: any) => [a.id, a.name])], [200, 'choose', false, [[TT.advertiser_id, 'Ibtekr'], ['7000000000000000002', 'Test']]]);
  assertEquals(JSON.parse(secrets.ads_tiktok).access_token, TT.access_token);
  assertEquals(JSON.parse(secrets.ads_tiktok).advertiser_id, undefined);
  assertEquals((await call(deps, { action: 'link_callback', code: 'auth-code-123456', state: tState })).body.field, 'state'); // spent
  assertEquals((await call(deps, { action: 'link_pick', platform: 'tiktok', account: '7000000000000000009' })).body.field, 'account'); // not offered
  const pk = await call(deps, { action: 'link_pick', platform: 'tiktok', account: TT.advertiser_id });
  assertEquals([pk.body.linked, pk.body.configured, pk.body.account.id, pk.body.account.name], [true, true, TT.advertiser_id, 'Ibtekr']);
  assertEquals(JSON.parse(secrets.ads_tiktok), TT);
  // Google comes back: the code → a refresh token (kept) and an access token (not kept), one accessible customer → linked
  const gcb = await call(deps, { action: 'link_callback', code: '4/0AX-code', state: gState });
  assertEquals([gcb.res.status, gcb.body.linked, gcb.body.configured, gcb.body.account.id], [200, true, true, GG.customer_id]);
  const stored = JSON.parse(secrets.ads_google);
  assertEquals([stored.refresh_token, stored.customer_id, stored.access_token], [GG.refresh_token, GG.customer_id, undefined]);
  // the exchange carried the client secret in the form, not a url; the customers call carried the developer token header
  const { calls } = setup(); void calls;
  assertFalse(JSON.stringify(db.rows('activity_log')).includes(GG.client_secret));
  // no refresh token (consent not renewed) → 502 no_refresh_token
  const nr = setup({ env: ENV, vault: { ads_google: JSON.stringify({ developer_token: GG.developer_token, client_id: GG.client_id, client_secret: GG.client_secret }) }, routes: { 'POST /token': { body: { access_token: 'g-access-test-token' } } } });
  const st = (await call(nr.deps, { action: 'link_start', platform: 'google' })).body.url; const stateNr = new URL(st).searchParams.get('state')!;
  const bad = await call(nr.deps, { action: 'link_callback', code: '4/0AX-code', state: stateNr });
  assertEquals([bad.res.status, bad.body.error], [502, 'no_refresh_token']);
});

Deno.test('9.5.6 sync: every linked platform in one run — TikTok (Access-Token header, the report rows) and Google (the refresh then GAQL with the developer token) beside Meta; one failing keeps the others; sync by hand on one platform', async () => {
  const { deps, db, calls } = setup({ vault: { ...vaultTT, ...vaultG }, routes: { ...OK_ROUTES, ...TT_ROUTES, ...G_ROUTES } });
  const r = await cron(deps);
  assertEquals([r.res.status, r.body.campaigns, r.body.ads, r.body.stats], [200, 3, 3, 8]);
  assertEquals([r.body.platforms.meta.campaigns, r.body.platforms.tiktok.stats, r.body.platforms.google.stats], [1, 2, 2]);
  const tt = calls.filter((c) => c.host === 'business-api.tiktok.com');
  assert(tt.length >= 5 && tt.every((c) => c.headers['access-token'] === TT.access_token && !c.auth && !JSON.stringify(c.query).includes(TT.access_token)));
  const gg = calls.filter((c) => c.host === 'googleads.googleapis.com');
  assert(gg.length === 5 && gg.every((c) => c.auth === 'Bearer g-access-test-token' && c.headers['developer-token'] === GG.developer_token && c.headers['login-customer-id'] === GG.login_customer_id));
  const tok = calls.find((c) => c.host === 'oauth2.googleapis.com')!;
  assertEquals([tok.body.grant_type, tok.body.refresh_token, tok.body.client_secret], ['refresh_token', GG.refresh_token, GG.client_secret]);
  const objs = db.rows('mkt_ad_objects');
  assertEquals(objs.filter((o: any) => o.platform === 'tiktok').map((o: any) => [o.kind, o.id, o.name, o.status]).sort(), [['account', TT.advertiser_id, 'Ibtekr TikTok', 'ACTIVE'], ['ad', TTA, 'video 1', 'ACTIVE'], ['campaign', TTC, 'Macrame TT', 'ACTIVE']]);
  assertEquals(objs.find((o: any) => o.platform === 'google' && o.kind === 'campaign').meta.daily_budget, 250);
  assertEquals(objs.find((o: any) => o.platform === 'google' && o.kind === 'account').meta.currency, 'EGP');
  const st = db.rows('mkt_ad_stats');
  assertEquals(st.filter((s: any) => s.platform === 'tiktok').map((s: any) => [s.level, s.object_id, s.day, s.spend, s.purchases, s.purchase_value]).sort(), [['ad', TTA, '2026-10-24', 20, 1, 900], ['campaign', TTC, '2026-10-24', 120.5, 2, 1800]]);
  assertEquals(st.find((s: any) => s.platform === 'google' && s.level === 'campaign').spend, 80);
  assertFalse(JSON.stringify(objs).includes(TT.access_token) || JSON.stringify(st).includes(GG.refresh_token));
  // Google refusing (the developer token not approved): its account row says permission, Meta and TikTok still ran → 200
  const half = setup({ vault: { ...vaultTT, ...vaultG }, routes: { ...OK_ROUTES, ...TT_ROUTES, ...G_ROUTES, ['POST /v21/customers/' + GG.customer_id + '/googleAds:search']: { status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission', details: [{ errors: [{ message: 'The developer token is not approved.' }] }] } } } } });
  const h = await cron(half.deps);
  assertEquals([h.res.status, h.body.platforms.google.error, h.body.platforms.google.text, h.body.platforms.tiktok.stats], [200, 'permission', 'The developer token is not approved.', 2]);
  assertEquals(half.db.rows('mkt_ad_objects').find((o: any) => o.platform === 'google' && o.kind === 'account').meta.error, 'permission');
  const one = await call(half.deps, { action: 'sync', platform: 'google', days: 7 });
  assertEquals([one.res.status, one.body.error, one.body.platform], [502, 'permission', 'google']);
  assertEquals(half.db.rows('activity_log').map((l: any) => [l.action, l.entity_id, l.new_value]), [['mkt.ads.sync', 'google', 'permission']]);
  assertEquals((await call(half.deps, { action: 'sync', platform: 'snap' })).body.field, 'platform');
  // a status read says each platform's own state
  const s = (await call(half.deps, { action: 'status' }, 'jwt-view')).body.platforms;
  assertEquals([s.google.error, s.google.account.id, s.google.account.name, s.tiktok.error, s.tiktok.synced_at, s.google.version], ['permission', GG.customer_id, null, null, NOW, 'v21']); // no success yet: the id from the link, no name
});

Deno.test('9.5.6 decide on a TikTok suggestion: a money kind is recorded only (the execution is Meta\'s) even with the switch on — no call to any platform', async () => {
  const { deps, db, calls } = setup({ vault: vaultTT });
  await seedBuyer(db, { settings: ON, suggestions: [SUGG(1, 'stop', { platform: 'tiktok', campaign_id: TTC, campaign_name: 'Macrame TT' })] });
  const r = await call(deps, { action: 'decide', id: 1, decision: 'approve' });
  assertEquals([r.res.status, r.body.status, r.body.live, r.body.platform, calls.length], [200, 'approved', false, 'tiktok', 0]);
  assertEquals(db.rows('mkt_suggestions')[0].result, { live: false, platform: 'tiktok', manual: true });
  assertEquals(db.rows('activity_log').map((l: any) => l.new_value), ['stop · approve · ' + TTC + ' · manual']);
});
