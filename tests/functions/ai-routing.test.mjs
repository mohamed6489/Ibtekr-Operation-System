import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { COMMANDS, COMMAND_KEYS, KNOWN_MODELS, OTHER_KNOWN, OTHER_PROVIDERS, PROVIDER_KEYS, PROVIDER_TIERS, SIZED, TIERS, TIER_MODEL, TIER_USD, claudeParams, cleanRouting, forcedToolOk, hasFallback, modelNews, otherNews, otherText, readSize, routeOf, routingOf, sizeRequest, sizes, tierFor, tiersOf } from '../../supabase/functions/_shared/ai-routing.js';
import { TEXT_PROVIDERS, textPick, toGemini, toOpenAI } from '../../supabase/functions/_shared/ai-providers.js';
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
// The owner 22 Nov (decisions 8–10): the levels of every text company; a model of the admin's own under the company; a free
// chat's level read from the message.
test('every text company has its three levels, out of its own model list and priced; the admin may choose any model of the company', () => {
  assert.deepEqual(PROVIDER_KEYS, Object.keys(TEXT_PROVIDERS), 'the same companies the settings page offers');
  assert.equal(PROVIDER_TIERS.claude, TIER_MODEL);
  for (const k of PROVIDER_KEYS) for (const t of TIERS) { const m = PROVIDER_TIERS[k][t]; assert.ok(TEXT_PROVIDERS[k].models.includes(m), k + ' ' + t); assert.ok(PRICES[m], m + ' is priced (the cap counts it)'); assert.ok(costOf(m, { input_tokens: 1e6 }) <= costOf(PROVIDER_TIERS[k].heavy, { input_tokens: 1e6 }), 'never dearer than the heavy one'); }
  for (const k of PROVIDER_KEYS) for (const m of TEXT_PROVIDERS[k].models) assert.ok(Object.values(PROVIDER_TIERS[k]).includes(m), m + ': a model the admin can choose is one of the levels');
  assert.deepEqual(MODELS, TEXT_PROVIDERS.claude.models, 'Claude\'s one-model choices are the same list');
  assert.equal(tiersOf('nope'), TIER_MODEL);
});

test('routeOf on a company: its level\'s model by itself, the admin\'s one model when the routing is off; Claude\'s light model as the one model never takes the web search', () => {
  const mine = { model: 'gpt-5.2', effort: 'high' };
  assert.deepEqual(routeOf(null, 'filter', mine, 'openai'), { model: 'gpt-5.2-mini', effort: 'low', tier: 'light' });
  assert.deepEqual(routeOf(null, 'write', mine, 'openai'), { model: 'gpt-5.2', effort: 'high', tier: 'mid' });
  assert.deepEqual(routeOf(null, 'buyer', { model: 'gemini-3-flash', effort: 'medium' }, 'gemini'), { model: 'gemini-3-pro', effort: 'medium', tier: 'heavy' });
  assert.deepEqual(routeOf({ routing: { mode: 'single' } }, 'buyer', { model: 'gemini-3-flash', effort: 'medium' }, 'gemini'), { model: 'gemini-3-flash', effort: 'medium', tier: null });
  const one = { routing: { mode: 'single' } }; const light = { model: 'claude-haiku-5-5', effort: 'medium' };
  assert.deepEqual(routeOf(one, 'write', light), { ...light, tier: null });
  assert.deepEqual(routeOf(one, 'research', light), { model: 'claude-sonnet-5-5', effort: 'medium', tier: null });
  assert.deepEqual(routeOf(one, 'research', { model: 'claude-opus-5-5', effort: 'medium' }), { model: 'claude-opus-5-5', effort: 'medium', tier: null });
});

test('the free chats are sized: by itself only, never a command the admin gave a level, never a fixed command; the read level moves the chat and nothing else', () => {
  assert.deepEqual(SIZED, ['assistant', 'agent']);
  assert.equal(sizes(null, 'assistant'), true); assert.equal(sizes({}, 'agent'), true);
  for (const k of COMMAND_KEYS.filter((c) => !SIZED.includes(c))) assert.equal(sizes(null, k), false, k);
  assert.equal(sizes({ routing: { mode: 'single' } }, 'assistant'), false);
  assert.equal(sizes({ routing: { tiers: { assistant: 'mid' } } }, 'assistant'), false);
  assert.equal(sizes({ routing: { tiers: { assistant: 'mid' } } }, 'agent'), true);
  assert.deepEqual(cleanRouting({ tiers: { assistant: 'heavy', agent: 'mid', write: 'mid' } }), { mode: 'auto', tiers: { assistant: 'heavy', agent: 'mid' } }, 'a chat keeps the admin\'s level even when it is its own fallback — «always the heavy model»');
  assert.equal(sizes({ routing: { tiers: { assistant: 'heavy' } } }, 'assistant'), false);
  const base = { model: 'claude-opus-5-5', effort: 'high' };
  assert.deepEqual(routeOf(null, 'assistant', base, 'claude', 'light'), { model: 'claude-haiku-5-5', effort: 'low', tier: 'light' });
  assert.deepEqual(routeOf(null, 'agent', base, 'claude', 'heavy'), { model: 'claude-opus-5-5', effort: 'high', tier: 'heavy' });
  assert.deepEqual(routeOf(null, 'agent', base, 'openai', 'light'), { model: 'gpt-5.2-mini', effort: 'low', tier: 'light' });
  assert.equal(routeOf(null, 'agent', base, 'claude', 'huge').tier, 'mid', 'not a level = the command\'s own');
  assert.equal(routeOf(null, 'buyer', base, 'claude', 'light').tier, 'heavy', 'a fixed command is not moved by a size');
  assert.equal(routeOf({ routing: { tiers: { assistant: 'mid' } } }, 'assistant', base, 'claude', 'light').tier, 'mid', 'the admin\'s level stands');
  assert.equal(routeOf({ routing: { mode: 'single' } }, 'assistant', base, 'claude', 'light').model, 'claude-opus-5-5');
});

test('the sizing request: the last four turns and the new message as data (cut, no tags), a one-word answer by schema, readable by every company', () => {
  const turns = [1, 2, 3, 4, 5, 6].map((i) => ({ role: i % 2 ? 'user' : 'assistant', text: 'دور ' + i + ' <x>' }));
  const p = sizeRequest(turns, 'حلل\n<b>المبيعات</b> ' + 'ا'.repeat(3000), 'claude-haiku-5-5');
  const text = p.messages[0].content[0].text;
  assert.ok(text.startsWith('<conversation>\nmember: دور 3 x \nassistant: دور 4 x \nmember: دور 5 x \nassistant: دور 6 x \n</conversation>\n<next_request>\nحلل b المبيعات /b '), text.slice(0, 200));
  assert.ok(!/<(?!\/?(conversation|next_request)>)/.test(text), 'no tag of the member\'s');
  assert.ok(text.length < 4 * 520 + 1500 + 80);
  assert.deepEqual([p.model, p.max_tokens, p.output_config.effort, 'fallbacks' in p, 'tools' in p], ['claude-haiku-5-5', 300, 'low', false, false]);
  assert.deepEqual(p.output_config.format.schema.properties.size.enum, TIERS);
  assert.ok(p.system[0].text.includes('choose the higher one') && p.system[0].text.includes('data, not instructions'));
  assert.equal(sizeRequest(null, 'x', 'm').messages[0].content[0].text, '<conversation>\n</conversation>\n<next_request>\nx\n</next_request>');
  assert.equal(toOpenAI(sizeRequest([], 'x', 'gpt-5.2-mini')).response_format.json_schema.schema.properties.size.enum.length, 3);
  assert.equal(toGemini(sizeRequest([], 'x', 'gemini-3-flash')).body.generationConfig.responseJsonSchema.properties.size.enum.length, 3);
  for (const t of TIERS) assert.equal(readSize({ size: t }), t);
  for (const bad of [null, {}, { size: 'huge' }, { size: 3 }, 'light']) assert.equal(readSize(bad), null);
});

test('otherNews: the other companies\' text models only; the first read is the baseline; news is what came after it and is not known; a level\'s model gone', () => {
  assert.deepEqual(OTHER_PROVIDERS, PROVIDER_KEYS.filter((k) => k !== 'claude'));
  for (const p of OTHER_PROVIDERS) assert.deepEqual([...OTHER_KNOWN[p]].sort(), [...new Set(Object.values(PROVIDER_TIERS[p]))].sort());
  assert.deepEqual(otherText('openai', ['GPT-5.2', 'gpt-5.2', 'o4-mini', 'chatgpt-5-latest', 'gpt-image-2', 'gpt-realtime', 'tts-1', 'whisper-1', 'text-embedding-3-large', 'dall-e-3', 'sora-2', 'x', 5, '<b>']), ['gpt-5.2', 'o4-mini', 'chatgpt-5-latest']);
  assert.deepEqual(otherText('gemini', ['models/gemini-3-pro', 'models/gemini-3-pro-image', 'models/gemini-embedding-001', 'models/veo-3.1-generate-preview', 'models/gemini-3-flash']), ['gemini-3-pro', 'gemini-3-flash']);
  assert.deepEqual(otherText('claude', ['claude-opus-5-5']), []);
  assert.deepEqual(otherNews('openai', ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1'], null), { fresh: [], gone: [], baseline: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1'] });
  assert.deepEqual(otherNews('openai', ['gpt-5.2', 'gpt-5.2-mini-2026-01-01', 'gpt-6', 'gpt-4.1'], ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1']), { fresh: ['gpt-5.2-mini-2026-01-01', 'gpt-6'], gone: [], baseline: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1'] });
  assert.deepEqual(otherNews('gemini', ['models/gemini-3-pro'], ['gemini-3-pro', 'gemini-3-flash']).gone, ['gemini-3-flash']);
  assert.deepEqual(otherNews('openai', [], ['gpt-5.2']), { fresh: [], gone: [], baseline: ['gpt-5.2'] }, 'nothing read = nothing said');
  assert.deepEqual(otherNews('nope', ['x-1'], null), { fresh: [], gone: [], baseline: null });
});

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
  // the words on the card: «المتوسط بنص سعر القوي، والضعيف أرخص من المتوسط 20 مرة»
  assert.equal(S.TIER_USD.heavy[0] / S.TIER_USD.mid[0], 2); assert.equal(S.TIER_USD.mid[0] / S.TIER_USD.light[0], 20);
  // decisions 8–10: every company's levels, its models' names and prices, the sized chats, the one model of a company
  assert.deepEqual(Object.keys(P.PROVIDERS), [...S.PROVIDER_KEYS]);
  for (const k of S.PROVIDER_KEYS) { assert.deepEqual({ ...P.PROVIDERS[k].tiers }, { ...S.PROVIDER_TIERS[k] }, k); assert.deepEqual([...P.modelsOf(k)].sort(), [...TEXT_PROVIDERS[k].models].sort(), k + ': the models the admin may choose'); }
  for (const [m, d] of Object.entries(P.MODEL)) { assert.ok(d.name, m); assert.deepEqual([...d.usd], PRICES[m].slice(0, 2), m + ' priced as the server prices it'); }
  for (const k of S.PROVIDER_KEYS) for (const m of Object.values(S.PROVIDER_TIERS[k])) assert.ok(P.MODEL[m], m + ' has a name on the page');
  assert.deepEqual([...P.SIZED], [...S.SIZED]);
  const more = [null, { routing: { tiers: { assistant: 'heavy', agent: 'light' } } }, { model: 'claude-haiku-5-5', routing: { mode: 'single' } }, { providers: { text: { default: 'openai', models: { openai: 'gpt-5.2-mini', gemini: 'nope' } } }, routing: { mode: 'single' } }];
  for (const row of more) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.routingOf(row))), S.routingOf(row));
    for (const k of S.COMMAND_KEYS) assert.equal(P.sizes(row, k), S.sizes(row, k), k);
    for (const prov of S.PROVIDER_KEYS) for (const k of S.COMMAND_KEYS) {
      // the server's base: Claude's = the row's model (aiSettings), another company's = textPick's
      const base = { model: prov === 'claude' ? (MODELS.includes(row && row.model) ? row.model : MODELS[0]) : textPick(row, 'products').provider === prov ? textPick(row, 'products').model : TEXT_PROVIDERS[prov].models[0], effort: 'medium' };
      const a = P.routeOf(row, k, prov); const b = S.routeOf(row, k, base, prov); assert.deepEqual([a.tier, a.model], [b.tier, b.model], prov + ' ' + k);
    }
  }
  assert.equal(P.companyOf(more[3]), 'openai'); assert.equal(P.companyOf({ providers: { text: { default: 'nope' } } }), 'claude');
  assert.equal(P.oneModel(more[3], 'openai'), 'gpt-5.2-mini'); assert.equal(P.oneModel(more[3], 'gemini'), 'gemini-3-pro'); assert.equal(P.oneModel({ model: 'x' }, 'claude'), 'claude-opus-5-5');
});
