import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { COMMANDS, COMMAND_KEYS, KNOWN_MODELS, TIERS, TIER_MODEL, TIER_USD, claudeParams, cleanRouting, forcedToolOk, hasFallback, modelNews, routeOf, routingOf, tierFor } from '../../supabase/functions/_shared/ai-routing.js';
import { MODELS, PRICES, costOf } from '../../supabase/functions/_shared/ai-content.js';

// The owner 22 Nov (docs/superpowers/plans/2026-11-22-model-routing.md): which Claude model runs which command.

test('the levels: one current model each, known, priced the same in ai-content; every command has a level', () => {
  assert.deepEqual(TIERS, ['light', 'mid', 'heavy']);
  assert.deepEqual(TIER_MODEL, { light: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5', heavy: 'claude-opus-5-5' });
  for (const t of TIERS) { assert.ok(KNOWN_MODELS.includes(TIER_MODEL[t])); assert.deepEqual(PRICES[TIER_MODEL[t]].slice(0, 2), TIER_USD[t], t + ' priced the same'); }
  for (const m of MODELS) assert.ok(Object.values(TIER_MODEL).includes(m), 'the one-model choices are routed models too');
  assert.equal(COMMAND_KEYS.length, 14);
  for (const k of COMMAND_KEYS) { assert.ok(TIERS.includes(COMMANDS[k].tier), k); if (COMMANDS[k].min) assert.ok(TIERS.indexOf(COMMANDS[k].tier) >= TIERS.indexOf(COMMANDS[k].min), k + ': the recommendation is not under the lowest'); }
  assert.ok(TIER_USD.light[0] < TIER_USD.mid[0] && TIER_USD.mid[0] < TIER_USD.heavy[0], 'light is the cheapest, heavy the dearest');
});

test('routeOf: by itself with no row; light = low effort, the others the admin\'s; an unknown command or one model for everything = the admin\'s model', () => {
  const base = { model: 'claude-opus-5-5', effort: 'high' };
  assert.deepEqual(routeOf(null, 'filter', base), { model: 'claude-haiku-5-5', effort: 'low', tier: 'light' });
  assert.deepEqual(routeOf({}, 'write', base), { model: 'claude-sonnet-5-5', effort: 'high', tier: 'mid' });
  assert.deepEqual(routeOf({ routing: 'x' }, 'assistant', base), { model: 'claude-opus-5-5', effort: 'high', tier: 'heavy' });
  assert.deepEqual(routeOf({ routing: { tiers: { write: 'heavy', filter: 'mid' } } }, 'write', base), { model: 'claude-opus-5-5', effort: 'high', tier: 'heavy' });
  assert.deepEqual(routeOf({ routing: { tiers: { filter: 'mid' } } }, 'filter', base), { model: 'claude-sonnet-5-5', effort: 'high', tier: 'mid' });
  assert.deepEqual(routeOf({ routing: { mode: 'single', tiers: { write: 'light' } } }, 'write', { model: 'claude-sonnet-5-5', effort: 'low' }), { model: 'claude-sonnet-5-5', effort: 'low', tier: null });
  assert.deepEqual(routeOf(null, 'nope', base), { ...base, tier: null });
  assert.deepEqual(routeOf(null, 'write', null), { model: 'claude-sonnet-5-5', effort: 'medium', tier: 'mid' });
});

test('the row is cleaned: only known commands and levels, only what differs from the recommendation, never under a command\'s lowest level', () => {
  assert.deepEqual(routingOf(null), { mode: 'auto', tiers: {} });
  assert.deepEqual(cleanRouting({ mode: 'SINGLE', tiers: [] }), { mode: 'auto', tiers: {} });
  assert.deepEqual(cleanRouting({ mode: 'single', tiers: { write: 'heavy', filter: 'light', studio: 'huge', nope: 'mid', research: 'light', __proto__: { x: 1 } } }), { mode: 'single', tiers: { write: 'heavy' } });
  assert.equal(tierFor('research', 'light'), 'mid', 'the web search is not on the light model');
  assert.equal(tierFor('research', 'mid'), 'mid'); assert.equal(tierFor('research'), 'heavy'); assert.equal(tierFor('nope', 'light'), 'mid');
  assert.deepEqual(routeOf({ routing: { tiers: { research: 'light' } } }, 'research', { model: 'x', effort: 'medium' }).model, 'claude-opus-5-5', 'a level under the lowest is not kept — the recommendation runs');
});

test('the request as its model takes it: no fallback parameter on the light model; a forced tool call only there', () => {
  const p = { model: 'claude-haiku-5-5', max_tokens: 10, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', messages: [] };
  assert.deepEqual(claudeParams(p), { model: 'claude-haiku-5-5', max_tokens: 10, messages: [] });
  assert.deepEqual(claudeParams({ ...p, betas: ['server-side-fallback-2026-07-01', 'other-beta'] }).betas, ['other-beta']);
  const o = { ...p, model: 'claude-opus-5-5' }; assert.equal(claudeParams(o), o, 'the other models keep it');
  const bare = { model: 'claude-haiku-5-5', messages: [] }; assert.equal(claudeParams(bare), bare);
  assert.equal(p.fallbacks, 'default', 'the caller\'s object is not changed');
  assert.deepEqual([hasFallback('claude-haiku-5-5'), hasFallback('claude-haiku-5-5-20261001'), hasFallback('claude-sonnet-5-5'), hasFallback('')], [false, false, true, true]);
  assert.deepEqual([forcedToolOk('claude-haiku-5-5'), forcedToolOk('claude-opus-5-5'), forcedToolOk('claude-sonnet-5-5'), forcedToolOk(null)], [true, false, false, false]);
});

test('the light model\'s two rate cards and the mid model\'s cache read', () => {
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 3000, output_tokens: 2000 }), 0.0013); // 3000 × 0.10 + 2000 × 0.50 per million
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1000 }), 0.0105, 'exactly 100K is still the short card');
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 60_000, cache_read_input_tokens: 50_000, output_tokens: 1000 }), 0.035, 'a longer prompt (cached part counted): 60K × 0.50 + 50K × 0.05 + 1K × 2.50');
  assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 0 }), 0.1);
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 3000, output_tokens: 2000 }), 0.052);
});

test('modelNews: a served model this system does not know is news; a routed model that is no longer served is too; nothing read = nothing said', () => {
  assert.deepEqual(modelNews(KNOWN_MODELS), { fresh: [], gone: [] });
  assert.deepEqual(modelNews([...KNOWN_MODELS, 'claude-opus-5-5-20260901', 'gpt-5', 42, 'CLAUDE-OPUS-6', 'claude-opus-6', 'claude-opus-5-6']), { fresh: ['claude-opus-6', 'claude-opus-5-6'], gone: [] });
  assert.deepEqual(modelNews(['claude-opus-5-5', 'claude-sonnet-5-5-20260815', 'claude-haiku-6']), { fresh: ['claude-haiku-6'], gone: ['claude-haiku-5-5'] });
  assert.deepEqual(modelNews([]), { fresh: [], gone: [] }); assert.deepEqual(modelNews(null), { fresh: [], gone: [] });
});

// the settings card's copy of the table (app/js/pages/ai-routing.js) is the server's — levels, models, prices, commands, lowest levels
test('the page\'s table is the server\'s: the same levels, models, prices, commands and lowest levels, and the same routing of a row', async () => {
  const S = await import('../../supabase/functions/_shared/ai-routing.js');
  const window = { IBUI: { h() {}, Button() {} }, IBKit: {} };
  vm.runInNewContext(readFileSync(new URL('../../app/js/pages/ai-routing.js', import.meta.url), 'utf8'), { window, document: {}, Date, Promise, Number, String, Object, Math, Array });
  const P = window.IBAIRouting;
  assert.equal(P.LIST_DATE, S.LIST_DATE);
  assert.deepEqual([...P.TIERS], [...S.TIERS]);
  for (const t of S.TIERS) { assert.equal(P.TIER[t].model, S.TIER_MODEL[t], t); assert.deepEqual([...P.TIER[t].usd], [...S.TIER_USD[t]], t); assert.ok(P.TIER[t].label && P.TIER[t].when && P.TIER[t].name); }
  assert.deepEqual(Object.keys(P.COMMANDS), [...S.COMMAND_KEYS]);
  for (const k of S.COMMAND_KEYS) { assert.equal(P.COMMANDS[k].tier, S.COMMANDS[k].tier, k); assert.equal(P.COMMANDS[k].min, S.COMMANDS[k].min, k); assert.ok(P.COMMANDS[k].label && P.COMMANDS[k].why, k + ' says what it is and why'); }
  const rows = [null, {}, { routing: { tiers: { write: 'heavy', research: 'light', filter: 'mid', nope: 'mid' } } }, { model: 'claude-sonnet-5-5', routing: { mode: 'single', tiers: { write: 'light' } } }];
  for (const row of rows) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.routingOf(row))), S.routingOf(row));
    for (const k of [...S.COMMAND_KEYS, 'nope']) { const a = P.routeOf(row, k); const b = S.routeOf(row, k, { model: (row && row.model) || 'claude-opus-5-5', effort: 'medium' }); assert.deepEqual([a.tier, a.model], [b.tier, b.model], k); }
  }
  // the words on the card: «المتوسط بنص سعر التقيل، والخفيف أرخص من المتوسط 20 مرة»
  assert.equal(S.TIER_USD.heavy[0] / S.TIER_USD.mid[0], 2); assert.equal(S.TIER_USD.mid[0] / S.TIER_USD.light[0], 20);
});
