// The owner 17 Nov — research from strong sources for every assistant, Meta's live numbers for the media buyer: what the first answer may
// ask for, cleaned; the research call; Meta's insights URL and rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEED_SCHEMA, cleanNeed, liveAdsBlock, liveAdsRows, liveAdsUrl, needRule, researchBlock, researchOut, researchRequest } from '../../supabase/functions/_shared/agent-need.js';

test('need: research for anyone (3 at most), ads for the buyer only and clamped', () => {
  assert.equal(cleanNeed({ need: { research: [] } }, 'dev'), null);
  assert.deepEqual(cleanNeed({ need: { research: ['a', 'b', 'c', 'd'] } }, 'dev').research, ['a', 'b', 'c']);
  assert.equal(cleanNeed({ need: { research: [], ads: { level: 'ad', days: '7', breakdown: 'age', campaign_id: '' } } }, 'dev'), null);
  assert.deepEqual(cleanNeed({ need: { research: [], ads: { level: 'adset', days: '500', breakdown: 'zodiac', campaign_id: '12x' } } }, 'buyer').ads, { level: 'adset', days: 90, breakdown: '', campaignId: '' });
  assert.deepEqual(Object.keys(NEED_SCHEMA('buyer').properties), ['research', 'ads']);
  assert.deepEqual(Object.keys(NEED_SCHEMA('cs').properties), ['research']);
  assert.match(needRule('buyer'), /need\.ads/); assert.doesNotMatch(needRule('cs'), /need\.ads/);
});

test('research: the web search tool, the brief with its sources; nothing found = the assistant says so', () => {
  const p = researchRequest(['meta reels length'], { model: 'm', effort: 'low', today: '2026-11-17T10:00:00Z' });
  assert.equal(p.tools[0].type, 'web_search_20260209'); assert.match(p.system[0].text, /three independent strong sources/);
  const r = researchOut([{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'A' }] }, { type: 'text', text: 'finding <x>' }]);
  assert.deepEqual(r.sources, [{ url: 'https://example.com/a', title: 'A' }]); assert.equal(r.text, 'finding  x');
  assert.match(researchBlock(r), /<research>[\s\S]*https:\/\/example.com\/a/);
  assert.match(researchBlock({ text: '', sources: [] }), /found nothing usable/);
});

test('live ads: the insights URL (level, days, breakdown, campaign) and short rows with Meta\'s purchases', () => {
  const u = liveAdsUrl('123', { level: 'ad', days: 7, breakdown: 'placement', campaignId: '' }, '2026-11-17');
  assert.match(u, /\/act_123\/insights\?level=ad&time_range=/); assert.match(decodeURIComponent(u), /"since":"2026-11-11","until":"2026-11-17"/); assert.match(decodeURIComponent(u), /breakdowns=publisher_platform,platform_position/);
  assert.match(liveAdsUrl('123', { level: 'campaign', days: 1, breakdown: '', campaignId: '999' }, '2026-11-17'), /\/999\/insights\?level=campaign/);
  const rows = liveAdsRows({ data: [{ ad_name: 'Lamp', campaign_name: 'C', publisher_platform: 'instagram', platform_position: 'reels', spend: '100', actions: [{ action_type: 'purchase', value: '2' }], action_values: [{ action_type: 'purchase', value: '400' }] }] }, { level: 'ad', breakdown: 'placement' });
  assert.deepEqual([rows[0].name, rows[0].by, rows[0].purchases, rows[0].roas], ['Lamp', 'instagram / reels', 2, 4]);
  assert.match(liveAdsBlock(rows, { level: 'ad', days: 7, breakdown: 'placement', campaignId: '' }), /Lamp \| C \| instagram \/ reels \| 100/);
  assert.match(liveAdsBlock(null, { level: 'ad', days: 7, breakdown: '', campaignId: '' }), /did not answer/);
});
