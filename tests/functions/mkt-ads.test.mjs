import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  accountOf, path, nextOf, windowOf, windowChunks, CHUNK_DAYS, purchasesOf, statRowOf, objectRowOf, accountRowOf, SYNC_DAYS, MAX_DAYS, PURCHASE_TYPES,
} from '../../supabase/functions/_shared/mkt-ads.js';
// mkt-ads's pure part (phase 9.5.3, decisions 43 / 48): the Marketing API's answers → mkt_ad_objects / mkt_ad_stats rows, read-only.

test('accountOf: «act_123» or the digits; anything else null', () => {
  assert.equal(accountOf('act_1122334455'), '1122334455'); assert.equal(accountOf(' 1122334455 '), '1122334455');
  assert.equal(accountOf('act_12a'), null); assert.equal(accountOf(''), null); assert.equal(accountOf(undefined), null);
});

test('the calls: the account, its campaigns and ads, the daily insights per level; the next page from Meta only', () => {
  assert.match(path.account('11'), /\/v21\.0\/act_11\?fields=name%2Ccurrency/);
  assert.match(path.ads('11'), /\/act_11\/ads\?fields=.*creative%7Bthumbnail_url%7D/);
  const u = path.insights('11', 'ad', '2026-11-01', '2026-11-03');
  assert.match(u, /level=ad&time_increment=1&time_range=%7B%22since%22%3A%222026-11-01%22%2C%22until%22%3A%222026-11-03%22%7D/);
  assert.match(u, /fields=ad_id%2Cad_name%2Ccampaign_id/);
  assert.equal(nextOf({ paging: { next: 'https://graph.facebook.com/v21.0/act_11/insights?after=x' } }), 'https://graph.facebook.com/v21.0/act_11/insights?after=x');
  assert.equal(nextOf({ paging: { next: 'https://evil.example/x' } }), null); assert.equal(nextOf({}), null);
});

test('windowChunks: a window a week at a time, the oldest first, the last piece short; one day = one piece', () => {
  assert.deepEqual(windowChunks('2026-10-01', '2026-10-17', 7), [{ since: '2026-10-01', until: '2026-10-07' }, { since: '2026-10-08', until: '2026-10-14' }, { since: '2026-10-15', until: '2026-10-17' }]);
  assert.deepEqual(windowChunks('2026-10-05', '2026-10-05'), [{ since: '2026-10-05', until: '2026-10-05' }]);
  assert.equal(windowChunks('2026-07-28', '2026-10-25', CHUNK_DAYS).length, 13);
  assert.match(path.insights('1', 'ad', '2026-10-01', '2026-10-07'), /limit=100/);
});

test('windowOf: the last n days ending today in Cairo; 3 by default, 400 at most', () => {
  const now = Date.parse('2026-11-06T22:30:00Z'); // 00:30 on the 7th in Cairo
  assert.deepEqual(windowOf(now, 3), { since: '2026-11-05', until: '2026-11-07', days: 3 });
  assert.equal(windowOf(now).days, SYNC_DAYS); assert.equal(windowOf(now, 5000).days, MAX_DAYS); assert.equal(windowOf(now, 0).days, SYNC_DAYS);
});

test('purchasesOf: the first type present (omni › purchase › pixel) — never summed — and its value', () => {
  assert.deepEqual(PURCHASE_TYPES, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);
  const actions = [{ action_type: 'link_click', value: '40' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'purchase', value: '3' }];
  const values = [{ action_type: 'omni_purchase', value: '4200.5' }, { action_type: 'purchase', value: '4200.5' }];
  assert.deepEqual(purchasesOf(actions, values), { purchases: 3, value: 4200.5 });
  assert.deepEqual(purchasesOf([{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }], []), { purchases: 2, value: 0 });
  assert.deepEqual(purchasesOf(null, null), { purchases: 0, value: 0 });
});

test('statRowOf: a day × a campaign or an ad; the numbers as numbers (negative / text → 0 or null); nothing without ids and a day', () => {
  const x = { campaign_id: '120252323303340228', campaign_name: 'X', ad_id: '1206', spend: '800.456', impressions: '12000', reach: '9000', clicks: '300', inline_link_clicks: '210', frequency: '1.33333',
    actions: [{ action_type: 'purchase', value: '3' }], action_values: [{ action_type: 'purchase', value: '4200' }], date_start: '2026-11-02', date_stop: '2026-11-02' };
  assert.deepEqual(statRowOf(x, 'campaign'), { platform: 'meta', level: 'campaign', object_id: '120252323303340228', campaign_id: '120252323303340228', day: '2026-11-02', spend: 800.46,
    impressions: 12000, reach: 9000, clicks: 300, link_clicks: 210, frequency: 1.333, purchases: 3, purchase_value: 4200 });
  assert.equal(statRowOf(x, 'ad').object_id, '1206');
  const neg = statRowOf({ ...x, spend: '-5', reach: 'n/a', inline_link_clicks: undefined, frequency: null }, 'campaign');
  assert.deepEqual([neg.spend, neg.reach, neg.link_clicks, neg.frequency], [0, null, null, null]);
  assert.equal(statRowOf({ ...x, date_start: 'yesterday' }, 'campaign'), null);
  assert.equal(statRowOf({ ...x, ad_id: undefined }, 'ad'), null);
  assert.equal(statRowOf(x, 'adset'), null);
});

test('objectRowOf / accountRowOf: names cut and cleaned, statuses as Meta\'s words, https pictures only; a failure keeps the last success', () => {
  assert.deepEqual(objectRowOf('campaign', { id: '1202', name: ' Macrame\n— Retargeting ', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES' }, '11'),
    { platform: 'meta', kind: 'campaign', id: '1202', parent_id: '11', name: 'Macrame — Retargeting', status: 'ACTIVE', thumb: null, meta: { objective: 'OUTCOME_SALES', daily_budget: null, lifetime_budget: null } });
  assert.equal(objectRowOf('campaign', { id: '1202', daily_budget: '30000' }, null).meta.daily_budget, 300); // Meta's minor units → money
  const ad = objectRowOf('ad', { id: '1206', name: 'carousel', campaign_id: '1202', effective_status: 'PAUSED', creative: { thumbnail_url: 'https://scontent.example/t.jpg' } });
  assert.deepEqual([ad.parent_id, ad.status, ad.thumb], ['1202', 'PAUSED', 'https://scontent.example/t.jpg']);
  assert.equal(objectRowOf('ad', { id: '1', creative: { thumbnail_url: 'http://x' } }).thumb, null);
  assert.equal(objectRowOf('campaign', { id: 'x' }), null); assert.equal(objectRowOf('adset', { id: '1' }), null);
  assert.equal(objectRowOf('campaign', { id: '1', effective_status: 'bad status' }).status, null);
  const ok = accountRowOf('11', { name: 'Ibtekr Club', currency: 'EGP', timezone_name: 'Africa/Cairo', account_status: 1 }, '2026-11-06T10:00:00Z', null, null);
  assert.deepEqual([ok.name, ok.status, ok.meta.currency, ok.meta.synced_at, ok.meta.error], ['Ibtekr Club', 'ACTIVE', 'EGP', '2026-11-06T10:00:00Z', null]);
  const bad = accountRowOf('11', null, '2026-11-06T11:00:00Z', 'token', ok);
  assert.deepEqual([bad.name, bad.status, bad.meta.currency, bad.meta.synced_at, bad.meta.checked_at, bad.meta.error], ['Ibtekr Club', 'ACTIVE', 'EGP', '2026-11-06T10:00:00Z', '2026-11-06T11:00:00Z', 'token']);
  assert.equal(accountRowOf('11', { account_status: 2 }, 'x', null, null).status, 'DISABLED');
});

// ---------------------------------------------------------------- 9.5.4: the media buyer (decisions 49–52)
import { BUYER_DEFAULTS, MAX_STEP, buyerRules, rulesPatch, suggestionsOf, suggestionKey, budgetPlan, accountDaily, reportText } from '../../supabase/functions/_shared/mkt-ads.js';

test('buyerRules: the prototype\'s defaults, the admin\'s row over them, bad values back to the defaults; rulesPatch takes the numbers and modes only', () => {
  assert.deepEqual(buyerRules(null), { ...BUYER_DEFAULTS });
  assert.deepEqual(buyerRules({ dailyCap: 8000, live: true, maxCpa: -3, autoStopMode: 'auto', reportHour: 25 }), { ...BUYER_DEFAULTS, dailyCap: 8000, live: true, autoStopMode: 'auto' });
  assert.deepEqual(rulesPatch({ dailyCap: '6000', maxCpa: 500, autoStopMode: 'auto', reportHour: 8, live: true, junk: 1 }), { patch: { dailyCap: 6000, maxCpa: 500, autoStopMode: 'auto', reportHour: 8 } });
  assert.deepEqual(rulesPatch({ dailyCap: 50 }), { error: 'dailyCap' }); assert.deepEqual(rulesPatch({ autoStopMode: 'always' }), { error: 'autoStopMode' }); assert.deepEqual(rulesPatch({ reportHour: 24 }), { error: 'reportHour' });
});

const T = '2026-11-07';
const CA = '120252323303340228', CB = '120251977233530228', CC = '120251297405730228';
const OBJ = [{ kind: 'campaign', id: CA, name: 'Macrame', status: 'ACTIVE', meta: { daily_budget: 300 } }, { kind: 'campaign', id: CB, name: 'Lamps', status: 'ACTIVE', meta: {} }, { kind: 'campaign', id: CC, name: 'Rug', status: 'PAUSED', meta: {} },
  { kind: 'ad', id: '1206', parent_id: CA, name: 'carousel', status: 'ACTIVE' }, { kind: 'ad', id: '1207', parent_id: CB, name: 'video', status: 'ACTIVE' }, { kind: 'ad', id: '1208', parent_id: CB, name: 'old', status: 'PAUSED' }];
const day = (n) => new Date(Date.parse(T + 'T00:00:00Z') - n * 86400_000).toISOString().slice(0, 10);
const cs = (id, n, spend, purchases = 0) => ({ level: 'campaign', object_id: id, campaign_id: id, day: day(n), spend, purchases });
const as = (id, camp, n, impressions, clicks, frequency) => ({ level: 'ad', object_id: id, campaign_id: camp, day: day(n), impressions, link_clicks: clicks, frequency, spend: 10 });
const STATS = [
  ...[0, 1, 2, 3, 4].map((n) => cs(CB, n, 400, 2)), // Lamps: 2,000 in 5 days, 10 purchases, no order → stop (outranks tracking)
  ...[0, 1, 2, 3, 4, 5, 6].map((n) => cs(CA, n, 100, 1)), // Macrame: 700 in 7 days, 7 purchases
  cs(CC, 1, 5000), // paused: never stop
  ...[0, 1, 2, 3, 4, 5, 6].map((n) => as('1206', CA, n, 1000, 30, 1.5)), // fine
  ...[0, 1, 2, 3, 4, 5, 6].map((n) => as('1207', CB, n, 1000, 8, 4.4)), ...[7, 8, 9, 10, 11, 12, 13].map((n) => as('1207', CB, n, 1000, 20, 1.2)), // tired (4.4) and CTR fell 60%
  ...[0, 1, 2].map((n) => as('1208', CB, n, 1000, 1, 9)), // paused ad: skipped
];
const ORD = [...[0, 1, 2, 3, 4].map((n) => ({ day: day(n), campaign: CA, sold: true, sales: 700 })), { day: day(1), campaign: CA, sold: false, sales: 500 }, { day: day(10), campaign: CA, sold: true, sales: 9000 }];

test('suggestionsOf: stop (active, ≥ autoStop in 5 days, no order), scale (MER ≥ 4, ≥ 5 orders), tracking, a tired creative; the paused never; the keys', () => {
  const s = suggestionsOf({ objects: OBJ, stats: STATS, orders: ORD, today: T, rules: {} });
  assert.deepEqual(s.map((x) => x.kind + ':' + x.campaign_id + (x.ad_id ? '/' + x.ad_id : '')).sort(), ['budget_up:' + CA, 'creative:' + CB + '/1207', 'stop:' + CB].sort());
  const stop = s.find((x) => x.kind === 'stop'); assert.match(stop.title, /وقّف «Lamps»/); assert.match(stop.sub, /2,000 ج\.م/); assert.equal(stop.data.orders5, 0); assert.equal(stop.pct, null);
  const up = s.find((x) => x.kind === 'budget_up'); assert.equal(up.pct, 20); assert.equal(up.data.mer, 5); assert.equal(up.data.orders, 5); assert.equal(up.data.daily_budget, 300); assert.match(up.sub, /5\.00×/);
  const cr = s.find((x) => x.kind === 'creative'); assert.equal(cr.data.frequency, 4.4); assert.match(cr.sub, /التكرار 4\.4/); assert.equal(suggestionKey(cr), 'creative|' + CB + '|1207');
  // a 300 cost limit: Macrame's cost (700 ÷ 5 = 140) is fine; raise the spend and the cost is over → budget_down instead of up
  const dear = suggestionsOf({ objects: OBJ, stats: STATS.map((x) => (x.level === 'campaign' && x.object_id === CA ? { ...x, spend: 400 } : x)), orders: ORD, today: T, rules: {} });
  const down = dear.find((x) => x.kind === 'budget_down'); assert.equal(down.pct, -30); assert.equal(down.data.cpa, 560); assert.match(down.impact, /90 ج\.م\/يوم/);
  assert.ok(!dear.some((x) => x.kind === 'budget_up'));
  // tracking: Macrame with 7 purchases and 5 orders is not twice; with 12 purchases it is
  const tr = suggestionsOf({ objects: OBJ, stats: STATS.map((x) => (x.level === 'campaign' && x.object_id === CA ? { ...x, purchases: 2 } : x)), orders: ORD, today: T, rules: {} });
  assert.ok(tr.some((x) => x.kind === 'tracking' && x.campaign_id === CA));
  // the owner's rule: a 3,000 autoStop keeps Lamps running → a tracking row instead (10 ≥ 2 × 0)
  const soft = suggestionsOf({ objects: OBJ, stats: STATS, orders: ORD, today: T, rules: { autoStop: 3000 } });
  assert.ok(!soft.some((x) => x.kind === 'stop') && soft.some((x) => x.kind === 'tracking' && x.campaign_id === CB));
});

test('budgetPlan: the step at most 30%, Meta\'s minor units, the campaign\'s own budget or its active ad sets, the account cap; accountDaily', () => {
  assert.deepEqual(budgetPlan({ campaign: { id: CA, daily_budget: 30000 } }, 20, {}, 1000), { updates: [{ id: CA, daily_budget: 36000 }], before: 300, after: 360 });
  assert.deepEqual(budgetPlan({ campaign: { id: CA }, adsets: [{ id: 'a1', daily_budget: 10000, effective_status: 'ACTIVE' }, { id: 'a2', daily_budget: 5000, effective_status: 'PAUSED' }] }, -30, {}, 0), { updates: [{ id: 'a1', daily_budget: 7000 }], before: 100, after: 70 });
  assert.deepEqual(budgetPlan({ campaign: { id: CA, daily_budget: 30000 } }, 31, {}, 0), { error: 'step', max: MAX_STEP });
  assert.deepEqual(budgetPlan({ campaign: { id: CA, daily_budget: 30000 } }, 20, { dailyCap: 5000 }, 4700), { error: 'cap', cap: 5000, after: 5060 });
  assert.equal(budgetPlan({ campaign: { id: CA, daily_budget: 30000 } }, -30, { dailyCap: 100 }, 4700).error, undefined); // a cut never meets the cap
  assert.deepEqual(budgetPlan({ campaign: {}, adsets: [] }, 20, {}, 0), { error: 'no_daily_budget' });
  assert.equal(accountDaily([{ id: CA, daily_budget: 30000, effective_status: 'ACTIVE' }, { id: CB, daily_budget: 10000, effective_status: 'PAUSED' }], [{ campaign_id: CB, daily_budget: 20000, effective_status: 'ACTIVE' }, { campaign_id: CC, daily_budget: 5000, effective_status: 'ACTIVE' }], CB), 350);
  assert.equal(reportText({ day: '2026-11-06', spend: 1234.5, orders: 7, sales: 5600, pending: 2 }).body, 'الصرف إمبارح 1,235 ج.م · 7 أوردر من الإعلانات (5,600 ج.م) · العائد الحقيقي 4.54× · 2 اقتراح مستني موافقتك');
});
