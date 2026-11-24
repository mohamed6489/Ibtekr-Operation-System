import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Safwat 24 Nov — the media buyer's reading of the ads (docs/superpowers/plans/2026-11-24-buyer-brain.md decision 1): the page's file
// and the server's are the same, the verdicts, the ranking and the system's answers.
const page = new URL('../../app/js/pages/ads-insight.js', import.meta.url); const server = new URL('../../supabase/functions/_shared/ads-insight.js', import.meta.url);
const G = {}; G.globalThis = G; runInNewContext(readFileSync(page, 'utf8'), G); const I = G.IBAdsInsight;
const J = (x) => JSON.parse(JSON.stringify(x));

const DAYS = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
function fixture() {
  const objects = [{ kind: 'campaign', id: '1', name: 'Spring', status: 'ACTIVE' }, { kind: 'campaign', id: '2', name: 'Lamps', status: 'ACTIVE' }, { kind: 'campaign', id: '3', name: 'New', status: 'ACTIVE' },
    { kind: 'ad', id: '11', parent_id: '1', name: 'Video A' }, { kind: 'ad', id: '12', parent_id: '1', name: 'Photo B' }, { kind: 'ad', id: '13', parent_id: '1', name: 'Reel C' }, { kind: 'ad', id: '21', parent_id: '2', name: 'Video D' }];
  const stats = [];
  DAYS.forEach((day, i) => {
    stats.push({ level: 'campaign', object_id: '1', campaign_id: '1', day, spend: 300, impressions: 15000, clicks: 300, frequency: 1.5, purchases: 3, purchase_value: 2000 });
    stats.push({ level: 'campaign', object_id: '2', campaign_id: '2', day, spend: 150, impressions: 8000, clicks: 100, frequency: 2, purchases: 0, purchase_value: 0 });
    stats.push({ level: 'campaign', object_id: '3', campaign_id: '3', day, spend: 20, impressions: 1000, clicks: 10, frequency: 1, purchases: 0, purchase_value: 0 });
    stats.push({ level: 'ad', object_id: '11', campaign_id: '1', day, spend: 150, impressions: 6000, clicks: 150, frequency: 1.4, purchases: 2, purchase_value: 1500 });
    stats.push({ level: 'ad', object_id: '12', campaign_id: '1', day, spend: 60, impressions: 4000, clicks: i < 3 ? 120 : 40, frequency: 2, purchases: 1, purchase_value: 500 });
    stats.push({ level: 'ad', object_id: '13', campaign_id: '1', day, spend: 90, impressions: 5000, clicks: 30, frequency: 4.6, purchases: 0, purchase_value: 0 });
    stats.push({ level: 'ad', object_id: '21', campaign_id: '2', day, spend: 150, impressions: 8000, clicks: 100, frequency: 2, purchases: 0, purchase_value: 0 });
  });
  stats.push({ level: 'campaign', object_id: '1', campaign_id: '1', day: '2026-11-01', spend: 9999, impressions: 1, clicks: 0 }); // outside the period
  return { objects, stats, orders: [{ campaign: '1', ad: '', orders: 12, sales: 9000 }, { campaign: '1x', ad: '', orders: 1, sales: 100 }], from: DAYS[0], to: DAYS[6] };
}

test('the page and the server run the same file', () => {
  assert.equal(readFileSync(page, 'utf8'), readFileSync(server, 'utf8'));
});

test('the totals, the real ROAS from the shop\'s orders and Meta\'s, the period only', () => {
  const x = I.build(fixture());
  assert.equal(x.days, 7);
  assert.equal(x.totals.spend, 7 * 470); // the 1 Nov row is outside
  const s = x.campaigns.find((c) => c.id === '1');
  assert.equal(s.orders, 13); // «1x» = campaign 1 (the leading digits of utm_campaign)
  assert.equal(s.sales, 9100); assert.equal(s.roas, 4.33); assert.equal(s.metaRoas, 6.67); assert.equal(s.cpa, 161.54);
  assert.equal(s.ctr, 2); assert.equal(s.cpm, 20); assert.equal(s.frequency, 1.5);
});

test('the verdicts: learning under the minimum, losing with no purchase, fatigued, winning', () => {
  const x = I.build(fixture()); const v = (id) => [...x.campaigns, ...x.ads].find((y) => y.id === id).verdict;
  assert.equal(v('3'), 'learning'); // 140 EGP
  assert.equal(v('2'), 'lose'); // 1,050 EGP, no purchase
  assert.equal(v('21'), 'lose'); // losing comes before fatigued
  assert.equal(v('13'), 'lose'); // 630 EGP, no purchase, ROAS 0 < 1 (before its frequency 4.6)
  assert.equal(v('12'), 'tired'); // the CTR fell 60% (2.5% the first four days, 1% the last three)
  assert.equal(v('1'), 'win'); assert.equal(v('11'), 'win');
});

test('the best campaign, the top creatives (Meta\'s ROAS without utm_content, the shop\'s with it), what to stop, what is tired', () => {
  const x = I.build(fixture());
  assert.equal(x.best.id, '1'); assert.equal(x.realAds, false);
  assert.deepEqual(J(x.top.map((a) => a.id)), ['11']); // the tired and the losing never rank
  assert.deepEqual(J(x.stop.map((a) => a.id)), ['2', '21', '13']); // most spend first
  assert.deepEqual(J(x.tired.map((a) => a.id)), ['12']);
  const f = fixture(); f.orders.push({ campaign: '1', ad: '12', orders: 5, sales: 4000 });
  const y = I.build(f); assert.equal(y.realAds, true); assert.equal(y.ads.find((a) => a.id === '12').roas, 9.52);
});

test('the question: which answer, which period; a why or writing stays a model\'s', () => {
  assert.equal(I.intent('ايه احسن كامبين شغاله دلوقتي'), 'best_campaign');
  assert.equal(I.intent('احسن كريتيف عندي ايه'), 'best_creative');
  assert.equal(I.intent('اوقف انهي حمله'), 'stop');
  assert.equal(I.intent('اقفل حمله المكرميه'), null); // an instruction about one campaign: the model's, with its confirm card (ش45)
  assert.equal(I.intent('الاعلانات اللي الناس زهقت منها'), 'tired');
  assert.equal(I.intent('الحملات عامله ايه'), 'performance');
  assert.equal(I.intent('which campaign is the best'), 'best_campaign');
  assert.equal(I.intent('ليه الاعلان ده باع'), null);
  assert.equal(I.intent('اكتبلي اعلان لاحسن منتج'), null);
  assert.equal(I.intent('اقوي اعلانات المنافسين'), null);
  assert.equal(I.days('احسن كامبين'), 7); assert.equal(I.days('في اخر 30 يوم'), 30); assert.equal(I.days('الشهر ده'), 'month');
});

test('the system\'s answers name the numbers; the outside model\'s block carries the rows and the rules', () => {
  const x = I.build(fixture());
  const best = I.answer('best_campaign', x); assert.match(best, /Spring/); assert.match(best, /العائد الحقيقي 4\.33×/); assert.match(best, /كسبان/);
  assert.match(I.answer('best_creative', x), /Video A[\s\S]*utm_content/);
  assert.match(I.answer('stop', x), /Lamps[\s\S]*بيخسر[\s\S]*بموافقتك/);
  assert.match(I.answer('tired', x), /Photo B[\s\S]*الـ CTR نزل 60%/);
  assert.match(I.answer('performance', x, true), /real ROAS/);
  assert.match(I.answer('best_campaign', I.build({ objects: [], stats: [], orders: [], from: DAYS[0], to: DAYS[6] })), /مفيش صرف/);
  const b = I.block(x); assert.match(b, /Campaigns:\nname \| status/); assert.match(b, /Spring \| ACTIVE \| 2100/); assert.match(b, /Verdict rules \(in this order\)/);
});
