import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  accountOf, path, nextOf, windowOf, purchasesOf, statRowOf, objectRowOf, accountRowOf, SYNC_DAYS, MAX_DAYS, PURCHASE_TYPES,
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
    { platform: 'meta', kind: 'campaign', id: '1202', parent_id: '11', name: 'Macrame — Retargeting', status: 'ACTIVE', thumb: null, meta: { objective: 'OUTCOME_SALES' } });
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
