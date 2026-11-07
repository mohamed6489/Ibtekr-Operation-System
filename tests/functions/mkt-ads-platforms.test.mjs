import { test } from 'node:test'; import assert from 'node:assert/strict';
import { LINK_FIELDS, PLATFORMS, SECRET_KEYS, fieldValue, parseLink, linkReady, oauthReady, linkPublic, linkAccount, tailOf } from '../../supabase/functions/_shared/mkt-ads-link.js';
import { ttPath, ttBody, ttCode, ttAnswer, ttList, ttPages, ttTokenOf, ttAdvertisersOf, ttObjectRowOf, ttStatRowOf, ttAccountRowOf, TT_MAX_PAGES } from '../../supabase/functions/_shared/mkt-ads-tiktok.js';
import { gPath, gBody, gaql, gCode, gText, gResults, gNextPage, gCustomersOf, gTokenOf, gObjectRowOf, gStatRowOf, gAccountRowOf, customerIdOf, gVersion, G_VERSION } from '../../supabase/functions/_shared/mkt-ads-google.js';
// mkt-ads's TikTok and Google parts and the links the admin writes from the page (phase 9.5.6, decisions 67–69): the fields and
// their checks, what a run needs, the safe view (a secret as its tail), the platforms' calls and their answers → our rows and codes.

const TOKEN = 'tt-' + 'x'.repeat(40);

test('parseLink: the stored fields stay unless given; a given field replaces (an empty one removes); secrets have a length; ids drop dashes and act_; unknown fields refused', () => {
  const cur = { app_id: '7012345678', secret: 'old-secret-1234567', access_token: TOKEN, advertiser_id: '7000000000000000001' };
  assert.deepEqual(parseLink('tiktok', { advertiser_id: '7000000000000000002' }, cur).link, { ...cur, advertiser_id: '7000000000000000002' });
  assert.deepEqual(parseLink('tiktok', { access_token: '' }, cur).link, { app_id: cur.app_id, secret: cur.secret, advertiser_id: cur.advertiser_id });
  assert.equal(parseLink('tiktok', { secret: 'short' }, cur).error, 'secret');
  assert.equal(parseLink('tiktok', { app_id: 'abc' }, cur).error, 'app_id');
  assert.equal(parseLink('tiktok', { nope: 'x' }, cur).error, 'nope');
  assert.equal(parseLink('snap', {}, {}).error, 'platform');
  assert.deepEqual(parseLink('meta', { access_token: 'EAAB' + 'y'.repeat(30), account_id: 'act_1122334455' }, {}).link, { access_token: 'EAAB' + 'y'.repeat(30), account_id: '1122334455' });
  assert.deepEqual(parseLink('google', { developer_token: 'dev-token-abcdef', client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-' + 'z'.repeat(20), customer_id: '123-456-7890', version: 'v22' }, {}).link,
    { developer_token: 'dev-token-abcdef', client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-' + 'z'.repeat(20), customer_id: '1234567890', version: 'v22' });
  assert.equal(parseLink('google', { version: '21' }, {}).error, 'version');
  assert.equal(fieldValue('meta', 'access_token', 'has space ' + 'x'.repeat(30)).error, 'access_token');
  assert.deepEqual(PLATFORMS, ['meta', 'tiktok', 'google']);
  assert.deepEqual(SECRET_KEYS.google, ['developer_token', 'client_secret', 'refresh_token']);
  assert.ok(Object.values(LINK_FIELDS).every((f) => Object.values(f).every((x) => typeof x.label === 'string')));
});

test('linkReady / oauthReady / linkPublic: what a run needs, what the OAuth start needs, the page sees tails only', () => {
  const g = { developer_token: 'dev-token-abcdef', client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-' + 'z'.repeat(20) };
  assert.equal(linkReady('google', g), false); assert.equal(oauthReady('google', g), true);
  assert.equal(linkReady('google', { ...g, refresh_token: '1//0' + 'r'.repeat(40), customer_id: '1234567890' }), true);
  assert.equal(linkReady('tiktok', { app_id: '7012345678', secret: 'old-secret-1234567' }), false);
  assert.equal(linkReady('tiktok', { access_token: TOKEN, advertiser_id: '7000000000000000001' }), true);
  assert.equal(linkReady('meta', { access_token: 'EAAB' + 'y'.repeat(30), account_id: '1122334455' }), true);
  const pub = linkPublic('google', { ...g, customer_id: '1234567890' });
  assert.deepEqual(pub, { platform: 'google', fields: { developer_token: '••••cdef', client_id: '123-abc.apps.googleusercontent.com', client_secret: '••••zzzz', customer_id: '1234567890' }, ready: false, oauth: true, missing: ['refresh_token'] });
  assert.equal(JSON.stringify(pub).includes('dev-token'), false);
  assert.equal(tailOf(''), null); assert.equal(linkPublic('snap', {}), null);
  assert.equal(linkAccount('tiktok', { advertiser_id: '7' }), '7'); assert.equal(linkAccount('google', { customer_id: '9' }), '9'); assert.equal(linkAccount('meta', { account_id: '1' }), '1');
});

test('TikTok: the calls (Access-Token in the header — never in a url), the answer envelope and our codes, the pages', () => {
  assert.equal(ttPath.auth('7012345678', 'https://x/ads-callback.html', 'st'), 'https://business-api.tiktok.com/portal/auth?app_id=7012345678&state=st&redirect_uri=https%3A%2F%2Fx%2Fads-callback.html');
  assert.match(ttPath.report('70', 'ad', '2026-11-01', '2026-11-03'), /data_level=AUCTION_AD&dimensions=%5B%22ad_id%22%2C%22stat_time_day%22%5D&metrics=%5B%22campaign_id%22/);
  assert.match(ttPath.report('70', 'campaign', '2026-11-01', '2026-11-03', 2), /AUCTION_CAMPAIGN.*start_date=2026-11-01&end_date=2026-11-03&page_size=1000&page=2/);
  assert.deepEqual(ttBody.token('70', 's', 'c'), { app_id: '70', secret: 's', auth_code: 'c' });
  assert.deepEqual(ttAnswer({ code: 0, message: 'OK', data: { list: [] } }), { ok: true, data: { list: [] } });
  assert.deepEqual(ttAnswer({ code: 40105, message: 'Access token is incorrect or has been revoked.' }), { ok: false, code: 'token', text: 'Access token is incorrect or has been revoked.' });
  assert.equal(ttCode(40100), 'rate'); assert.equal(ttCode(40001), 'permission'); assert.equal(ttCode(50000), 'tiktok_50000'); assert.equal(ttAnswer(null).code, 'tiktok_error');
  assert.equal(ttPages({ page_info: { total_page: 3 } }), 3); assert.equal(ttPages({ page_info: { total_page: 99 } }), TT_MAX_PAGES); assert.equal(ttPages({}), 1);
  assert.deepEqual(ttTokenOf({ access_token: TOKEN, advertiser_ids: ['7000000000000000001', 'x'] }), { token: TOKEN, advertisers: ['7000000000000000001'] });
  assert.equal(ttTokenOf({ access_token: 'short' }), null);
  assert.deepEqual(ttAdvertisersOf({ list: [{ advertiser_id: '7000000000000000001', advertiser_name: 'Ibtekr' }, { advertiser_id: 'bad' }] }), [{ id: '7000000000000000001', name: 'Ibtekr' }]);
  assert.equal(ttList({}).length, 0);
});

test('TikTok rows: a campaign (daily budget when BUDGET_MODE_DAY, ENABLE → ACTIVE), an ad, a report row a day (purchases = complete_payment), the account', () => {
  const c = ttObjectRowOf('campaign', { campaign_id: '1800000000000000001', campaign_name: 'Macrame TT', operation_status: 'ENABLE', secondary_status: 'CAMPAIGN_STATUS_ENABLE', budget: '300.00', budget_mode: 'BUDGET_MODE_DAY', objective_type: 'WEB_CONVERSIONS' });
  assert.deepEqual(c, { platform: 'tiktok', kind: 'campaign', id: '1800000000000000001', parent_id: null, name: 'Macrame TT', status: 'ACTIVE', thumb: null, meta: { objective: 'WEB_CONVERSIONS', daily_budget: 300, lifetime_budget: null, budget_mode: 'BUDGET_MODE_DAY' } });
  assert.equal(ttObjectRowOf('campaign', { campaign_id: '18', operation_status: 'DISABLE', budget: 500, budget_mode: 'BUDGET_MODE_TOTAL' }).status, 'PAUSED');
  assert.deepEqual(ttObjectRowOf('ad', { ad_id: '1700000000000000001', ad_name: 'video 1', campaign_id: '1800000000000000001', operation_status: 'ENABLE' }), { platform: 'tiktok', kind: 'ad', id: '1700000000000000001', parent_id: '1800000000000000001', name: 'video 1', status: 'ACTIVE', thumb: null, meta: {} });
  assert.equal(ttObjectRowOf('campaign', { campaign_id: 'x' }), null);
  const s = ttStatRowOf({ dimensions: { campaign_id: '1800000000000000001', stat_time_day: '2026-11-05 00:00:00' }, metrics: { spend: '120.5', impressions: '9000', reach: '7000', clicks: '210', frequency: '1.29', complete_payment: '2', total_complete_payment_rate: '1800.00' } }, 'campaign');
  assert.deepEqual(s, { platform: 'tiktok', level: 'campaign', object_id: '1800000000000000001', campaign_id: '1800000000000000001', day: '2026-11-05', spend: 120.5, impressions: 9000, reach: 7000, clicks: 210, link_clicks: null, frequency: 1.29, purchases: 2, purchase_value: 1800 });
  const a = ttStatRowOf({ dimensions: { ad_id: '1700000000000000001', stat_time_day: '2026-11-05 00:00:00' }, metrics: { campaign_id: '1800000000000000001', spend: '20' } }, 'ad');
  assert.equal(a.campaign_id, '1800000000000000001'); assert.equal(a.object_id, '1700000000000000001'); assert.equal(a.purchases, 0);
  assert.equal(ttStatRowOf({ dimensions: { ad_id: '17', stat_time_day: '2026-11-05 00:00:00' }, metrics: {} }, 'ad'), null); // an ad row needs its campaign
  const acc = ttAccountRowOf('7000000000000000001', { name: 'Ibtekr TikTok', currency: 'EGP', timezone: 'Africa/Cairo', status: 'STATUS_ENABLE' }, '2026-11-07T10:00:00Z', null, null);
  assert.deepEqual(acc, { platform: 'tiktok', kind: 'account', id: '7000000000000000001', parent_id: null, name: 'Ibtekr TikTok', status: 'ACTIVE', thumb: null, meta: { currency: 'EGP', timezone: 'Africa/Cairo', synced_at: '2026-11-07T10:00:00Z', checked_at: '2026-11-07T10:00:00Z', error: null } });
  const failed = ttAccountRowOf('7000000000000000001', null, '2026-11-07T11:00:00Z', 'token', acc);
  assert.deepEqual([failed.name, failed.meta.synced_at, failed.meta.error], ['Ibtekr TikTok', '2026-11-07T10:00:00Z', 'token']);
});

test('Google: the calls (the developer token and the bearer are headers), the GAQL, the OAuth bodies, the codes and words, the customers', () => {
  assert.equal(gPath.auth('123-abc.apps.googleusercontent.com', 'https://x/ads-callback.html', 'st'), 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123-abc.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fx%2Fads-callback.html&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fadwords&access_type=offline&prompt=consent&state=st');
  assert.equal(gPath.search('v22', '1234567890'), 'https://googleads.googleapis.com/v22/customers/1234567890/googleAds:search');
  assert.equal(gPath.search(null, '1'), 'https://googleads.googleapis.com/' + G_VERSION + '/customers/1/googleAds:search'); assert.equal(gVersion('x'), G_VERSION);
  assert.equal(gPath.accessible('v21'), 'https://googleads.googleapis.com/v21/customers:listAccessibleCustomers');
  assert.deepEqual(gBody.refresh('r', 'c', 's'), { refresh_token: 'r', client_id: 'c', client_secret: 's', grant_type: 'refresh_token' });
  assert.deepEqual(gBody.query('SELECT 1', 'p2'), { query: 'SELECT 1', pageSize: 10000, pageToken: 'p2' });
  assert.match(gaql.campaignStats('2026-11-01', '2026-11-03'), /segments\.date BETWEEN '2026-11-01' AND '2026-11-03'/);
  assert.match(gaql.adStats('2026-11-01', '2026-11-03'), /^SELECT ad_group_ad\.ad\.id, campaign\.id, segments\.date, metrics\.cost_micros/);
  assert.match(gaql.ads(), /ad_group_ad\.status != 'REMOVED'/);
  assert.equal(gCode(401, {}), 'token'); assert.equal(gCode(400, { error: 'invalid_grant' }), 'token'); assert.equal(gCode(403, { error: { status: 'PERMISSION_DENIED' } }), 'permission'); assert.equal(gCode(429, {}), 'rate'); assert.equal(gCode(500, {}), 'google_500');
  assert.equal(gText({ error: { message: 'Request contains an invalid argument.', details: [{ errors: [{ message: 'The developer token is not approved.' }] }] } }), 'The developer token is not approved.');
  assert.equal(gText({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), 'Token has been expired or revoked.');
  assert.deepEqual(gCustomersOf({ resourceNames: ['customers/1234567890', 'customers/x'] }), ['1234567890']);
  assert.deepEqual(gTokenOf({ access_token: 'ya29.a', refresh_token: '1//0' + 'r'.repeat(40) }), { access: 'ya29.a', refresh: '1//0' + 'r'.repeat(40) });
  assert.equal(gTokenOf({ access_token: 'ya29.a' }).refresh, null);
  assert.equal(customerIdOf('123-456-7890'), '1234567890'); assert.equal(customerIdOf('12a'), null);
  assert.equal(gNextPage({ nextPageToken: 'p2' }), 'p2'); assert.equal(gNextPage({}), null); assert.equal(gResults({}).length, 0);
});

test('Google rows: a campaign (the budget from micros, ENABLED → ACTIVE), an ad (a name or its type), a day row (the cost from micros, conversions = purchases), the account', () => {
  const c = gObjectRowOf('campaign', { campaign: { id: '21000000001', name: 'Macrame G', status: 'ENABLED', advertisingChannelType: 'PERFORMANCE_MAX' }, campaignBudget: { amountMicros: '250000000' } });
  assert.deepEqual(c, { platform: 'google', kind: 'campaign', id: '21000000001', parent_id: null, name: 'Macrame G', status: 'ACTIVE', thumb: null, meta: { objective: 'PERFORMANCE_MAX', daily_budget: 250, lifetime_budget: null } });
  assert.deepEqual(gObjectRowOf('ad', { adGroupAd: { ad: { id: '7100000001', type: 'RESPONSIVE_SEARCH_AD' }, status: 'PAUSED' }, campaign: { id: '21000000001' } }),
    { platform: 'google', kind: 'ad', id: '7100000001', parent_id: '21000000001', name: 'RESPONSIVE_SEARCH_AD #7100000001', status: 'PAUSED', thumb: null, meta: { type: 'RESPONSIVE_SEARCH_AD' } });
  const s = gStatRowOf({ campaign: { id: '21000000001' }, segments: { date: '2026-11-05' }, metrics: { costMicros: '80000000', impressions: '3000', clicks: '140', conversions: 1.0, conversionsValue: 900.0 } }, 'campaign');
  assert.deepEqual(s, { platform: 'google', level: 'campaign', object_id: '21000000001', campaign_id: '21000000001', day: '2026-11-05', spend: 80, impressions: 3000, reach: null, clicks: 140, link_clicks: null, frequency: null, purchases: 1, purchase_value: 900 });
  const a = gStatRowOf({ adGroupAd: { ad: { id: '7100000001' } }, campaign: { id: '21000000001' }, segments: { date: '2026-11-05' }, metrics: { costMicros: '12345678' } }, 'ad');
  assert.deepEqual([a.object_id, a.campaign_id, a.spend, a.purchases], ['7100000001', '21000000001', 12.35, 0]);
  assert.equal(gStatRowOf({ campaign: { id: '21' }, segments: { date: 'bad' }, metrics: {} }, 'campaign'), null);
  const acc = gAccountRowOf('1234567890', { customer: { id: '1234567890', descriptiveName: 'Ibtekr Google', currencyCode: 'EGP', timeZone: 'Africa/Cairo', status: 'ENABLED' } }, '2026-11-07T10:00:00Z', null, null);
  assert.deepEqual([acc.platform, acc.name, acc.status, acc.meta.currency, acc.meta.synced_at], ['google', 'Ibtekr Google', 'ACTIVE', 'EGP', '2026-11-07T10:00:00Z']);
  assert.deepEqual(gAccountRowOf('1234567890', null, '2026-11-07T11:00:00Z', 'permission', acc).meta, { currency: 'EGP', timezone: 'Africa/Cairo', synced_at: '2026-11-07T10:00:00Z', checked_at: '2026-11-07T11:00:00Z', error: 'permission' });
});
