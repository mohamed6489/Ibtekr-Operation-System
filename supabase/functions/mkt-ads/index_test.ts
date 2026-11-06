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
  const ins = calls.filter((c) => c.path === 'act_1122334455/insights');
  assertEquals(ins.map((c) => [c.query.level, c.query.after ?? null]), [['campaign', null], ['campaign', 'p2'], ['ad', null], ['ad', 'p2']]);
  assertEquals(JSON.parse(ins[0].query.time_range), { since: '2026-07-28', until: '2026-10-25' });
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
  assertEquals([acct.name, acct.meta.synced_at, acct.meta.checked_at, acct.meta.error], ['Ibtekr Club', '2026-10-24T10:00:00.000Z', NOW, 'token']);
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
  assertEquals((await call(none.deps, { action: 'status' }, 'jwt-view')).body, { configured: false, account: null, synced_at: null, checked_at: null, error: null });
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
