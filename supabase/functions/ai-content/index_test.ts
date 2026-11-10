// deno-lint-ignore-file no-explicit-any
// ai-content handler tests (phase 5.3): a fake Claude (records every request, answers from a queue) + the in-memory Supabase
// clients of ../_test/fakes.ts (service and per-member). No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const KEY = 'anthropic-test-key-0000';
const U = { admin: '00000000-0000-4000-8000-0000000000a1', add: '00000000-0000-4000-8000-0000000000a2', edit: '00000000-0000-4000-8000-0000000000a3', view: '00000000-0000-4000-8000-0000000000a4', mkt: '00000000-0000-4000-8000-0000000000a5' };
// member tokens → what has_perm / is_admin answer, and who they are
const MEMBERS: Record<string, { uid: string; admin?: unknown; add?: unknown; edit?: unknown; mkt?: unknown; mview?: unknown }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-add': { uid: U.add, add: 'F' }, 'jwt-edit': { uid: U.edit, edit: 'F' }, 'jwt-view': { uid: U.view, add: 'P', edit: 'P' },
  'jwt-mkt': { uid: U.mkt, mkt: 'F' }, // phase 9.5.1: marketing.create F only
  'jwt-mview': { uid: U.view, mview: 'P' }, // phase 9.5.4: marketing.view P only (the buyer's chat)
};
const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const OTHER = '11111111-2222-4333-8444-555555555555';
const BRAND = '22222222-3333-4444-8555-666666666666';
const CATS = [{ id: 10, name: 'Home Decor', parent_id: null }, { id: 11, name: 'Lamps', parent_id: 10 }];
const COLORS = [{ id: 1, name_en: 'Beige', name_ar: 'بيج', code: 'BE', hex: null }, { id: 2, name_en: 'Black', name_ar: 'أسود', code: 'BK', hex: null }];
const PRODUCTS = [
  { id: 4001, sku: 'IBTARBE0999', name: 'Boho Cushion', lang: 'en', translation_ids: { en: 4001, ar: 4002 }, image_url: 'https://woo.test/wp-content/uploads/c.jpg', category_ids: [11], brand_ids: [7] },
  { id: 4002, sku: 'IBTARBE0999', name: 'مخدة بوهيمي', lang: 'ar', translation_ids: { en: 4001, ar: 4002 }, category_ids: [], brand_ids: [] },
];
const item = (extra: any = {}) => ({ nameEn: 'Desk Lamp', nameAr: '', material: 'Bamboo', colors: ['BE'], sizes: [], main: SB + '/row1-main.webp', slots: [], refs: [], ...extra });
const batch = (extra: any = {}) => ({ id: SB, title: 'دفعة', brand_id: BRAND, type: 'Simple', state: { items: [item()] }, step: 3, status: 'draft', ...extra });
const STUDIO_SEED = { brands: [{ id: BRAND, name: 'Art Craft', code: 'AR', aliases: [] }], studio_batches: [batch()], woo_categories: CATS, sku_colors: COLORS };
const PHOTO = { [`studio/${SB}/row1-main.webp`]: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]) };

const msg = (answer: unknown, extra: any = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }],
  usage: { input_tokens: 3000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});
const apiError = (status: number | null) => Object.assign(new Error('api'), status === null ? {} : { status });

type Opts = { seed?: Record<string, any[]>; env?: Record<string, string>; replies?: unknown[]; monthCost?: number; startDown?: boolean; storage?: Record<string, Uint8Array>; fail?: (c: any) => any;
  memberSeed?: Record<string, any[]>; memberRpc?: Record<string, (args: any) => unknown>; memberFail?: (c: any) => any }; // phase 12: what the member's own client sees (RLS already applied)
function setup({ seed = {}, env = {}, replies = [], monthCost = 0, startDown = false, storage = {}, fail, memberSeed = {}, memberRpc = {}, memberFail }: Opts = {}) {
  // ai_run_start as 0024 defines it (rls_ai tests the SQL): the member's runs in the window, this month's cost (monthCost before
  // the test's rows, every row at its cost — pending ones at their reserve) + the reserve against the cap, else a pending row
  let db: any = null;
  const start = async ({ p_row, p_cap, p_reserve, p_throttle, p_window_minutes }: any) => {
    const rows = db.rows('ai_runs'); const since = new Date(Date.parse(NOW) - p_window_minutes * 60_000).toISOString();
    if (rows.filter((r: any) => r.created_by === p_row.created_by && r.created_at >= since).length >= p_throttle) return { result: 'busy' };
    const insert = async (extra: any) => (await db.from('ai_runs').insert({ created_at: NOW, ...p_row, ...extra }).select('id').single()).data.id;
    const spent = monthCost + rows.reduce((t: number, r: any) => t + Number(r.cost_usd || 0), 0);
    if (p_cap != null && spent + p_reserve > p_cap) return { result: 'cap', id: await insert({ status: 'cap', error: 'ai_cap' }) };
    return { result: 'ok', id: await insert({ status: 'pending', cost_usd: p_reserve }) };
  };
  db = fakeDb(seed, { rpc: startDown ? {} : { ai_run_start: start }, storage, fail });
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    return fakeDb(memberSeed, { fail: memberFail, rpc: m ? { has_perm: ({ key }: any) => (key === 'products.add' ? m.add ?? 'N' : key === 'products.edit' ? m.edit ?? 'N' : key === 'marketing.create' ? m.mkt ?? 'N' : key === 'marketing.view' ? m.mview ?? 'N' : 'N'), is_admin: () => m.admin ?? false, ...memberRpc } : {} });
  };
  // during: the ai_runs rows (status, cost) as each Claude call starts — the reservation is made before the call
  const asked: any[] = []; const slept: number[] = []; const during: any[] = []; const queue = [...replies];
  const claude = async (p: any) => {
    asked.push(structuredClone(p)); during.push(db.rows('ai_runs').map((r: any) => [r.status, Number(r.cost_usd)]));
    const r = queue.shift(); if (r instanceof Error) throw r; if (r === undefined) throw new Error('no reply queued'); return r as any;
  };
  const deps = { env: { ...ENV, ANTHROPIC_API_KEY: KEY, ...env }, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, claude, sleep: async (ms: number) => { slept.push(ms); } };
  return { db, asked, slept, during, deps };
}
async function call(deps: any, body: unknown, jwt: string | null = 'jwt-add', method = 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const res = await handler(new Request('https://fn.test/ai-content', { method, headers, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), deps);
  return { res, body: method === 'OPTIONS' ? null : await res.json() };
}
const WRITE = { action: 'write', source: 'data', outputs: ['name', 'short'], langs: ['ar', 'en'], data: { name: 'Bamboo Mirror', brand: 'Alaa Anas', price: 900 } };
const ANSWER = { ar: { name: 'مراية بامبو بوهيمي', short: 'مراية من البامبو.' }, en: { name: 'Boho Bamboo Mirror', short: 'A bamboo mirror.' } };

Deno.test('auth: a member JWT only — write needs products.add or products.edit = F (or the admin), studio products.add = F', async () => {
  const { deps, asked } = setup({ replies: Array(4).fill(msg(ANSWER)) });
  assertEquals((await call(deps, WRITE, null)).res.status, 401, 'no token');
  assertEquals((await call(deps, WRITE, 'jwt-view')).res.status, 401, 'products.add / edit P is not F');
  assertEquals((await call(deps, WRITE, 'jwt-nobody')).res.status, 401, 'unknown token');
  assertEquals((await call(deps, { action: 'studio', batch_id: SB, index: 0, want: ['desc'] }, 'jwt-edit')).res.status, 401, 'products.edit is not products.add');
  assertEquals(asked.length, 0);
  for (const jwt of ['jwt-add', 'jwt-edit', 'jwt-admin']) assertEquals((await call(deps, WRITE, jwt)).res.status, 200, jwt);
  assertEquals((await call(deps, { action: 'chat' }, 'jwt-admin')).body, { error: 'unknown_action' });
  assertEquals((await call(deps, { action: 'chat' }, 'jwt-add')).res.status, 401, 'an unknown action is the admin\'s only');
  assertEquals((await call(deps, 'not json')).body, { error: 'bad_json' });
  assertEquals((await call(deps, null, 'jwt-add', 'GET')).res.status, 405);
  assertEquals((await call(deps, null, null, 'OPTIONS')).res.status, 200);
});

Deno.test('write from data: one Claude call (Opus 5.5, medium, fallback default, cached instructions), the answer cleaned, one ai_runs row', async () => {
  const { deps, db, asked } = setup({ replies: [msg({ ar: { name: 'مراية <b>بامبو</b> بوهيمي', short: 'مراية من البامبو.' }, en: { name: 'مراية', short: 'A bamboo mirror.' } })] });
  const { res, body } = await call(deps, WRITE);
  assertEquals(res.status, 200);
  assertEquals(asked.length, 1);
  const p = asked[0];
  assertEquals([p.model, p.max_tokens, p.fallbacks, p.betas, p.output_config.effort], ['claude-opus-5-5', 16000, 'default', ['server-side-fallback-2026-07-01'], 'medium']);
  assertEquals(p.system[0].cache_control, { type: 'ephemeral' });
  assertEquals(Object.keys(p.output_config.format.schema.properties.en.properties), ['name', 'short']);
  assertFalse(JSON.stringify(p).includes('900'), 'the price in the body never reaches Claude');
  assertEquals(body.result, 'ok');
  assertEquals(body.out, { ar: { name: 'مراية بامبو بوهيمي', short: 'مراية من البامبو.' }, en: { short: 'A bamboo mirror.' } });
  assertEquals(body.missing, ['en.name']);
  assertEquals([body.model, body.cost_usd], ['claude-opus-5-5', 0.052]);
  const [row] = db.rows('ai_runs');
  assertEquals([row.created_by, row.action, row.source, row.label, row.status, row.error, row.input_tokens, row.output_tokens, Number(row.cost_usd), row.created_at],
    [U.add, 'write', 'data', 'Bamboo Mirror', 'ok', null, 3000, 2000, 0.052, NOW]);
  assertEquals(row.output, { out: body.out, missing: ['en.name'] });
  assertEquals(body.run_id, row.id);
  assertFalse(JSON.stringify(db.rows('ai_runs')).includes(KEY) || JSON.stringify(body).includes(KEY), 'the key is never stored or answered');
});

Deno.test('write: the secrets pick the model and effort (listed values only); a bad body is 400 before any call', async () => {
  const { deps, asked, db } = setup({ env: { AI_CONTENT_MODEL: 'claude-sonnet-5-5', AI_CONTENT_EFFORT: 'low' }, replies: [msg(ANSWER, { model: 'claude-sonnet-5-5' })] });
  assertEquals((await call(deps, WRITE)).body.cost_usd, 0.026);
  assertEquals([asked[0].model, asked[0].output_config.effort], ['claude-sonnet-5-5', 'low']);
  const bad = await call(deps, { ...WRITE, outputs: ['price'] });
  assertEquals([bad.res.status, bad.body], [400, { error: 'bad_request', field: 'outputs' }]);
  assertEquals((await call(deps, { ...WRITE, data: { brand: 'x' } })).body.field, 'data.name');
  assertEquals([asked.length, db.rows('ai_runs').length], [1, 1]);
  const odd = setup({ env: { AI_CONTENT_MODEL: 'gpt-x', AI_CONTENT_EFFORT: 'max' }, replies: [msg(ANSWER)] });
  await call(odd.deps, WRITE);
  assertEquals([odd.asked[0].model, odd.asked[0].output_config.effort], ['claude-opus-5-5', 'medium']);
});

Deno.test('decision 8: the settings row «ai» (model, effort, monthly cap) wins over the secrets, read before every call; a value off the list falls back to the secret', async () => {
  const seed = { settings: [{ section: 'ai', data: { model: 'claude-sonnet-5-5', effort: 'high', monthly_limit_usd: 0.6 } }] };
  const { deps, asked, db } = setup({ seed, env: { AI_CONTENT_MODEL: 'claude-opus-5-5', AI_CONTENT_EFFORT: 'low', AI_MONTHLY_LIMIT_USD: '100' }, replies: [msg(ANSWER, { model: 'claude-sonnet-5-5' })] });
  assertEquals((await call(deps, WRITE)).body.cost_usd, 0.026);
  assertEquals([asked[0].model, asked[0].output_config.effort], ['claude-sonnet-5-5', 'high']);
  assertEquals(db.rows('ai_runs').map((r: any) => r.model), ['claude-sonnet-5-5']);
  // the row's cap (0.6): the month's 0.026 + the 0.5 reserve passes; a second call would pass it → 402 with no call
  await db.from('settings').update({ data: { model: 'claude-sonnet-5-5', monthly_limit_usd: 0.5 } }).eq('section', 'ai');
  const capped = await call(deps, WRITE);
  assertEquals([capped.res.status, capped.body, asked.length], [402, { error: 'ai_cap' }, 1]);
  // a model off the list and no effort in the row → the secrets
  await db.from('settings').update({ data: { model: 'gpt-x', monthly_limit_usd: null } }).eq('section', 'ai');
  const back = setup({ seed: { settings: db.rows('settings') }, env: { AI_CONTENT_MODEL: 'claude-opus-5-5', AI_CONTENT_EFFORT: 'low' }, replies: [msg(ANSWER)] });
  await call(back.deps, WRITE);
  assertEquals([back.asked[0].model, back.asked[0].output_config.effort], ['claude-opus-5-5', 'low']);
});

// phase 11 (decisions 14 / 15): the tool's text provider from the settings row «ai» → deps.text answers instead of Claude, the
// run row holds that model and its price; the house style of «ai_rules» is one more system block; a missing key names the provider
Deno.test('providers: openai for the products tool → deps.text called with the Claude-shaped request + the house style block, the row priced on gpt-5.2; marketing stays on Claude; gemini for the buyer; no OPENAI_API_KEY → 503 with the provider', async () => {
  const seed = { settings: [
    { section: 'ai', data: { model: 'claude-sonnet-5-5', providers: { text: { default: 'claude', tools: { products: 'openai', buyer: 'gemini' } } } } },
    { section: 'ai_rules', data: { voice: 'بنتكلم مع الناس كأننا صحابهم', words: ['الأرخص'] } }] };
  const { deps, asked, db } = setup({ seed, replies: [msg(ANSWER, { model: 'claude-sonnet-5-5' })], env: { OPENAI_API_KEY: 'sk-x', GEMINI_API_KEY: 'g-x' } });
  const texts: any[] = [];
  (deps as any).text = async (provider: string, p: any) => { texts.push({ provider, model: p.model, system: p.system.map((b: any) => b.text), effort: p.output_config.effort }); return { ...msg(ANSWER), model: provider === 'openai' ? 'gpt-5.2' : 'gemini-3-pro' }; };
  const { res, body } = await call(deps, WRITE);
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(texts.length, 1); assertEquals([texts[0].provider, texts[0].model], ['openai', 'gpt-5.2']);
  assert(texts[0].system[texts[0].system.length - 1].startsWith('House style set by the team'), 'the style block is the last system block');
  assert(texts[0].system[texts[0].system.length - 1].includes('الأرخص'));
  assertEquals(asked.length, 0, 'Claude not called');
  assertEquals([body.model, body.cost_usd], ['gpt-5.2', 0.02375]); // 3000 × 1.25 + 2000 × 10 per million
  assertEquals(db.rows('ai_runs')[0].model, 'gpt-5.2');
  // marketing (no tool override) → Claude with the row's model and the style block too
  const m = await call(deps, { action: 'marketing', task: 'rewrite', kind: 'caption', text: 'نص' }, 'jwt-mkt');
  assertEquals(m.res.status, 200, JSON.stringify(m.body)); assertEquals(asked.length, 1); assertEquals(asked[0].model, 'claude-sonnet-5-5');
  assert(asked[0].system[asked[0].system.length - 1].text.startsWith('House style'));
  // no key for the picked provider → 503 naming it, a row says so
  const noKey = setup({ seed, env: { GEMINI_API_KEY: 'g-x' } }); (noKey.deps as any).text = async () => { throw new Error('must not be called'); };
  const nk = await call(noKey.deps, WRITE);
  assertEquals([nk.res.status, nk.body], [503, { error: 'not_configured', provider: 'openai' }]);
  assertEquals(noKey.db.rows('ai_runs').map((r: any) => [r.status, r.error]), [['error', 'not_configured']]);
});

Deno.test('write: no ANTHROPIC_API_KEY → 503 not_configured, no call, a row says so', async () => {
  const { deps, asked, db } = setup({ env: { ANTHROPIC_API_KEY: ' ' } });
  const { res, body } = await call(deps, WRITE);
  assertEquals([res.status, body], [503, { error: 'not_configured', provider: 'claude' }]);
  assertEquals(asked.length, 0);
  assertEquals(db.rows('ai_runs').map((r: any) => [r.status, r.error, Number(r.cost_usd)]), [['error', 'not_configured', 0]]);
});

Deno.test('write from a product: the mirror row (English, whichever id), its Arabic name, category paths, brands and https photo by URL; unknown id 404', async () => {
  const { deps, asked, db } = setup({ seed: { products: PRODUCTS, woo_categories: CATS, woo_brands: [{ id: 7, name: 'Art Craft' }] }, replies: [msg({ en: { long: 'Soft.\n\nWarm.' } }), msg({ en: { long: 'x' } })] });
  const { body } = await call(deps, { action: 'write', source: 'product', product_id: 4002, outputs: ['long'], langs: ['en'], current: { shortEn: '<p>Soft cotton</p>' } }, 'jwt-edit');
  assertEquals(body.out, { en: { long: 'Soft.\n\nWarm.' } });
  const content = asked[0].messages[0].content;
  assertEquals(content[0], { type: 'image', source: { type: 'url', url: 'https://woo.test/wp-content/uploads/c.jpg' } });
  for (const s of ['Product name: Boho Cushion', 'Arabic name: مخدة بوهيمي', 'Brand: Art Craft', 'Shop categories: Home Decor › Lamps', 'Current English short description: Soft cotton']) assert(content[1].text.includes(s), s);
  const row = db.rows('ai_runs')[0];
  assertEquals([row.source, row.product_id, row.label], ['product', 4002, 'Boho Cushion']);
  assertEquals((await call(deps, { action: 'write', source: 'product', product_id: 999, outputs: ['long'], langs: ['en'] })).res.status, 404);
  assertEquals(asked.length, 1);
});

Deno.test('a product photo Claude cannot fetch (400) is dropped once and the text goes alone; any other 400 is ai_error', async () => {
  const { deps, asked, slept } = setup({ seed: { products: PRODUCTS }, replies: [apiError(400), msg({ en: { long: 'Soft.' } })] });
  const { res } = await call(deps, { action: 'write', source: 'product', product_id: 4001, outputs: ['long'], langs: ['en'] });
  assertEquals(res.status, 200);
  assertEquals(asked.map((p) => p.messages[0].content.length), [2, 1]);
  assertEquals(slept, []);
  const plain = setup({ replies: [apiError(400)] });
  assertEquals((await call(plain.deps, WRITE)).body, { error: 'ai_error' });
  assertEquals(plain.asked.length, 1);
});

Deno.test('Anthropic busy (429 / 529 / 5xx) is retried once after 2 s; twice → 429 busy; the key refused (401) → 503; no answer → busy', async () => {
  const once = setup({ replies: [apiError(529), msg(ANSWER)] });
  assertEquals((await call(once.deps, WRITE)).res.status, 200);
  assertEquals([once.asked.length, once.slept], [2, [2000]]);
  const twice = setup({ replies: [apiError(429), apiError(500)] });
  const t = await call(twice.deps, WRITE);
  assertEquals([t.res.status, t.body], [429, { error: 'busy' }]);
  assertEquals(twice.db.rows('ai_runs').map((r: any) => [r.status, r.error, Number(r.cost_usd)]), [['error', 'busy', 0]], 'an API error is not billed: the reserve goes');
  const key = setup({ replies: [apiError(401)] });
  assertEquals((await call(key.deps, WRITE)).res.status, 503);
  const net = setup({ replies: [apiError(null)] });
  assertEquals((await call(net.deps, WRITE)).body, { error: 'busy' });
  assertEquals(net.asked.length, 1, 'a timeout or a network error is not retried');
  assertEquals(net.db.rows('ai_runs').map((r: any) => [r.status, Number(r.cost_usd)]), [['error', 0.5]], 'an unknown outcome keeps its reserve');
});

Deno.test('a refusal (after the fallback) is 200 refused with its cost logged; a cut-off or non-JSON answer is 502 ai_error', async () => {
  const r = setup({ replies: [msg('', { stop_reason: 'refusal', content: [], usage: { input_tokens: 1000, output_tokens: 0 } })] });
  const { res, body } = await call(r.deps, WRITE);
  assertEquals([res.status, body], [200, { result: 'refused', model: 'claude-opus-5-5', cost_usd: 0.004 }]);
  assertEquals(r.db.rows('ai_runs').map((x: any) => [x.status, x.error, Number(x.cost_usd)]), [['refused', 'refused', 0.004]]);
  const cut = setup({ replies: [msg('{"ar":', { stop_reason: 'max_tokens' })] });
  assertEquals((await call(cut.deps, WRITE)).body, { error: 'ai_error' });
  assertEquals(cut.db.rows('ai_runs').map((x: any) => [x.status, x.error]), [['error', 'ai_error']]);
});

Deno.test('the monthly cap (AI_MONTHLY_LIMIT_USD): a call that could pass it → 402 ai_cap and a cap row, no call; within it → the call; no reservation → no call', async () => {
  const at = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, monthCost: 4.6 }); // 4.6 + the 0.5 reserve > 5
  const { res, body } = await call(at.deps, WRITE);
  assertEquals([res.status, body, at.asked.length], [402, { error: 'ai_cap' }, 0]);
  assertEquals(at.db.rows('ai_runs').map((x: any) => [x.status, x.error, x.created_by]), [['cap', 'ai_cap', U.add]]);
  const under = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, monthCost: 4.4, replies: [msg(ANSWER)] });
  assertEquals((await call(under.deps, WRITE)).res.status, 200);
  const down = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, startDown: true });
  const d = await call(down.deps, WRITE);
  assertEquals([d.res.status, d.body, down.asked.length, down.db.rows('ai_runs').length], [502, { error: 'ai_error' }, 0, 0]);
  const none = setup({ monthCost: 1000, replies: [msg(ANSWER)] }); // no cap set: any month passes
  assertEquals((await call(none.deps, WRITE)).res.status, 200);
});

Deno.test('the run is reserved before the call (pending at the 0.5 reserve) and then holds the outcome; a lost update keeps the reserve', async () => {
  const { deps, during, db } = setup({ replies: [msg(ANSWER)] });
  assertEquals((await call(deps, WRITE)).res.status, 200);
  assertEquals(during, [[['pending', 0.5]]]);
  assertEquals(db.rows('ai_runs').map((r: any) => [r.status, Number(r.cost_usd)]), [['ok', 0.052]]);
  const lost = setup({ replies: [msg(ANSWER)], fail: (c: any) => (c.op === 'update' && c.table === 'ai_runs' ? { code: 'XX000', message: 'down' } : null) });
  assertEquals((await call(lost.deps, WRITE)).res.status, 200, 'the answer still comes back');
  assertEquals(lost.db.rows('ai_runs').map((r: any) => [r.status, Number(r.cost_usd)]), [['pending', 0.5]]);
});

Deno.test('a member with THROTTLE calls in the last 10 minutes gets 429 busy with no call; older calls do not count', async () => {
  const runs = (at: string, by = U.add) => Array.from({ length: 60 }, (_, i) => ({ id: i + 1, created_at: at, created_by: by, action: 'write', status: 'ok' }));
  const busy = setup({ seed: { ai_runs: runs('2026-10-25T11:55:00.000Z') } });
  assertEquals([(await call(busy.deps, WRITE)).body, busy.asked.length], [{ error: 'busy' }, 0]);
  const old = setup({ seed: { ai_runs: runs('2026-10-25T11:49:00.000Z') }, replies: [msg(ANSWER)] });
  assertEquals((await call(old.deps, WRITE)).res.status, 200);
  const others = setup({ seed: { ai_runs: runs('2026-10-25T11:55:00.000Z', U.edit) }, replies: [msg(ANSWER)] });
  assertEquals((await call(others.deps, WRITE)).res.status, 200, 'another member\'s calls');
});

Deno.test('studio: the item, its brand and photo (base64 from the bucket), the site\'s categories and colors as the cached catalog; site ids and codes only back', async () => {
  const { deps, asked, db } = setup({ seed: STUDIO_SEED, storage: PHOTO, replies: [msg({ nameAr: 'أباجورة مكتب بامبو', categories: [11, 99], colors: ['be', 'ZZ'], sizes: [] })] });
  const { res, body } = await call(deps, { action: 'studio', batch_id: SB, index: 0, want: ['nameAr', 'category', 'variations'] });
  assertEquals(res.status, 200);
  assertEquals(body.fields, { nameAr: 'أباجورة مكتب بامبو', categories: [11], colors: ['BE'], sizes: [] });
  assertEquals(body.missing, []);
  const p = asked[0];
  assertEquals(p.system[1].text, 'Shop categories (id: path)\n10: Home Decor\n11: Home Decor › Lamps\n\nColors (code: name)\nBE: Beige (بيج)\nBK: Black (أسود)');
  assertEquals(p.system[1].cache_control, { type: 'ephemeral' });
  assertEquals(p.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: btoa(String.fromCharCode(82, 73, 70, 70, 1, 2, 3, 4)) } });
  for (const s of ['Brand: Art Craft', 'English name: Desk Lamp', 'Material: Bamboo', 'Colors: Beige']) assert(p.messages[0].content[1].text.includes(s), s);
  assertFalse(/price|sku/i.test(JSON.stringify(p.output_config.format.schema)));
  const row = db.rows('ai_runs')[0];
  assertEquals([row.action, row.source, row.batch_id, row.item_index, row.label, row.created_by, row.status], ['studio', 'studio', SB, 0, 'Desk Lamp', U.add, 'ok']);
  assertEquals(db.writes('studio_batches'), [], 'the batch itself is the page\'s to save');
});

Deno.test('decision 13 — prompts: a category typed in the studio → Claude writes its three shot prompts, kept in shot_prompts (Nano Banana Pro, 3:4, 1k, «(AI)»), the run logged as a studio run named by the category; a template category (source_node) is 409 exists with no call; a missing shot writes nothing', async () => {
  const PROMPTS = { shot1: 'A product photograph of the exact vase from the reference, kept identical, on a warm cream background.', shot2: 'A lifestyle photograph of the same vase in a warm Egyptian living room.', shot3: 'A close-up of the vase\'s glaze and texture, shallow depth of field.', negative: 'text, logos, people' };
  const { deps, asked, db } = setup({ replies: [msg(PROMPTS)] });
  const { res, body } = await call(deps, { action: 'prompts', category: ' مزهرية ' });
  assertEquals(res.status, 200);
  assertEquals([body.result, body.category, body.rows, body.missing, body.prompts.length], ['ok', 'مزهرية', 3, [], 3]);
  assert(asked[0].system[0].text.includes('Nano Banana Pro'));
  assertEquals(asked[0].messages[0].content[0].text, '<product_data>\ncategory: مزهرية\n</product_data>\n\nWrite shot1, shot2, shot3 and negative for this product category.');
  assertEquals(db.rows('shot_prompts').map((r: any) => [r.category, r.shot, r.name, r.prompt, r.negative, r.model, r.aspect, r.resolution, r.source_node, r.updated_by]), [
    ['مزهرية', 1, 'مزهرية 1 — تركيز على المنتج (AI)', PROMPTS.shot1, 'text, logos, people', 'imagen-nano-banana-2', '3:4', '1k', null, U.add],
    ['مزهرية', 2, 'مزهرية 2 — المنتج في بيئة محيطة (AI)', PROMPTS.shot2, 'text, logos, people', 'imagen-nano-banana-2', '3:4', '1k', null, U.add],
    ['مزهرية', 3, 'مزهرية 3 — Closeup للتفاصيل (AI)', PROMPTS.shot3, 'text, logos, people', 'imagen-nano-banana-2', '3:4', '1k', null, U.add]]);
  const run = db.rows('ai_runs')[0];
  assertEquals([run.action, run.source, run.label, run.status, run.created_by], ['studio', 'studio', 'مزهرية', 'ok', U.add]);
  // again (the AI's own rows): written over, never doubled
  const again = await call(setup({ seed: { shot_prompts: db.rows('shot_prompts') }, replies: [msg({ ...PROMPTS, shot1: 'A new first prompt.' })] }).deps, { action: 'prompts', category: 'مزهرية' });
  assertEquals(again.res.status, 200);
  // the owner's template rows are not the AI's to write
  const tpl = setup({ seed: { shot_prompts: [{ id: 1, category: 'كرسي', shot: 1, name: 'كرسي 1 — تركيز على المنتج', prompt: 'CHAIR', source_node: 'a1b2c3d4-0000-4000-8000-000000000001' }] }, replies: [msg(PROMPTS)] });
  const t = await call(tpl.deps, { action: 'prompts', category: 'كرسي' });
  assertEquals([t.res.status, t.body, tpl.asked.length], [409, { error: 'exists', category: 'كرسي' }, 0]);
  // a shot in Arabic is left out: nothing is written, the page is told what is missing
  const half = setup({ replies: [msg({ ...PROMPTS, shot2: 'صورة بالعربي' })] });
  const h = await call(half.deps, { action: 'prompts', category: 'مزهرية' });
  assertEquals([h.res.status, h.body.missing, h.body.rows, half.db.rows('shot_prompts').length], [200, ['shot2'], undefined, 0]);
  // the body and the right: a short name is 400; products.add P is 401
  assertEquals((await call(deps, { action: 'prompts', category: 'x' })).body, { error: 'bad_request', field: 'category' });
  assertEquals((await call(deps, { action: 'prompts', category: 'مزهرية' }, 'jwt-view')).res.status, 401);
  assertEquals((await call(setup({ replies: [msg(PROMPTS)] }).deps, { action: 'prompts', category: 'مزهرية' }, 'jwt-admin')).res.status, 200, 'the admin too');
});

Deno.test('studio: a photo outside the batch is not read; no item, an archived batch or a bad body → 404 / 400 with no call', async () => {
  const foreign = { ...STUDIO_SEED, studio_batches: [batch({ state: { items: [item({ main: OTHER + '/row1-main.webp', slots: ['../x.webp'] })] } })] };
  const f = setup({ seed: foreign, storage: { [`studio/${OTHER}/row1-main.webp`]: new Uint8Array([1, 2, 3]) }, replies: [msg({ shortDesc: 'Warm light.', shortDescAr: 'إضاءة دافية.' })] });
  assertEquals((await call(f.deps, { action: 'studio', batch_id: SB, index: 0, want: ['desc'] })).res.status, 200);
  assertEquals(f.asked[0].messages[0].content.length, 1, 'text only');
  assertFalse(f.db.calls.some((c: any) => c.op === 'download'));
  const g = setup({ seed: { ...STUDIO_SEED, studio_batches: [batch({ archived_at: NOW })] } });
  assertEquals((await call(g.deps, { action: 'studio', batch_id: SB, index: 0, want: ['desc'] })).res.status, 404);
  assertEquals((await call(g.deps, { action: 'studio', batch_id: SB, index: 5, want: ['desc'] })).res.status, 404);
  assertEquals((await call(g.deps, { action: 'studio', batch_id: SB, index: 0, want: ['price'] })).body, { error: 'bad_request', field: 'want' });
  assertEquals(g.asked.length, 0);
});

// ---------------------------------------------------------------- phase 9.5.1 «التسويق»: marketing (decision 10)

const CMP = 'f0000000-0000-4000-8000-000000000001';
const MKT_SEED = { mkt_campaigns: [{ id: CMP, name: 'كولكشن الشتا', archived_at: null, state: {
  w: { goal: 'منتج جديد', idea: 'كولكشن الشتا من Art craft', media: { post: { notes: 'ألوان دافية' }, carousel: {} }, extra: {} },
  pieces: [{ id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', idea: '', caption: '' }, { id: 'C1', kind: 'كاروسيل', n: 1, size: '1080x1350', slides: [{ n: 1 }, { n: 2 }] }] } }] };

Deno.test('marketing (9.5.1): marketing.create only; fill reads the piece from the saved campaign (never the body) and answers its fields (a carousel its slides); ai_runs action marketing, source campaign', async () => {
  const { deps, asked, db } = setup({ seed: MKT_SEED, replies: [msg({ idea: 'المخدة جنب الشباك', caption: 'كولكشن الشتا وصل ✨', title: 'دفا الشتا', sub: 'مشغولة يدويًا', badge: 'جديد' }),
    msg({ idea: 'تفاصيل', caption: 'كاروسيل', title: 'الغلاف', sub: '', badge: '', slides: [{ idea: 'الغرزة', title: 'خامة', sub: '' }] })] });
  assertEquals((await call(deps, { action: 'marketing', task: 'fill', campaign_id: CMP, piece: 'P1' }, 'jwt-add')).res.status, 401, 'products.add is not marketing.create');
  const r = await call(deps, { action: 'marketing', task: 'fill', campaign_id: CMP, piece: 'P1', idea: 'ignored' }, 'jwt-mkt');
  assertEquals([r.res.status, r.body.result, r.body.fields.title, r.body.fields.caption], [200, 'ok', 'دفا الشتا', 'كولكشن الشتا وصل ✨']);
  const sent = asked[0].messages[0].content[0].text;
  assert(sent.includes('Campaign idea: كولكشن الشتا من Art craft') && sent.includes('Piece: بوست 1') && sent.includes('Instructions for this media: ألوان دافية'));
  assert(asked[0].system[0].text.includes('Egyptian Arabic'));
  const run = db.rows('ai_runs').at(-1); assertEquals([run.action, run.source, run.label, run.status], ['marketing', 'campaign', 'بوست 1', 'ok']);
  const c = await call(deps, { action: 'marketing', task: 'fill', campaign_id: CMP, piece: 'C1' }, 'jwt-mkt');
  assertEquals(c.body.fields.slides, [{ idea: 'الغرزة', title: 'خامة' }, {}]);
  assertEquals((await call(deps, { action: 'marketing', task: 'fill', campaign_id: '00000000-0000-4000-8000-00000000ffff', piece: 'P1' }, 'jwt-mkt')).res.status, 404);
  assertEquals((await call(deps, { action: 'marketing', task: 'fill', campaign_id: CMP, piece: 'P7' }, 'jwt-mkt')).body.field, 'piece');
});

Deno.test('marketing rewrite / describe: one field (the current text as material), a template image → text; the limits; source post / template', async () => {
  const { deps, asked, db } = setup({ seed: MKT_SEED, replies: [msg({ text: 'خصم 20% على كل المخدات النهارده بس' }), msg({ text: 'المنتج في النص على خلفية كريمي' })] });
  const r = await call(deps, { action: 'marketing', task: 'rewrite', kind: 'badge', text: 'جديد' }, 'jwt-mkt');
  assertEquals([r.res.status, r.body.text.length <= 14], [200, true]);
  assert(asked[0].messages[0].content[0].text.includes('<current_text>\nجديد\n</current_text>'));
  assertEquals(db.rows('ai_runs').at(-1).source, 'post');
  const b64 = btoa(String.fromCharCode(...new Uint8Array(150).fill(9)));
  const d = await call(deps, { action: 'marketing', task: 'describe', image: { media_type: 'image/png', data: b64 } }, 'jwt-mkt');
  assertEquals([d.res.status, d.body.text, asked[1].messages[0].content[0].type], [200, 'المنتج في النص على خلفية كريمي', 'image']);
  assertEquals(db.rows('ai_runs').at(-1).source, 'template');
  assertEquals((await call(deps, { action: 'marketing', task: 'rewrite', kind: 'voice' }, 'jwt-mkt')).body.field, 'kind');
});

// ---------------------------------------------------------------- phase 9.5.4: the media buyer's chat (decision 53)

const CAMP = '120252323303340228';
const BUYER_SEED = {
  mkt_ad_objects: [{ platform: 'meta', kind: 'campaign', id: CAMP, name: 'Macrame', status: 'ACTIVE', meta: { daily_budget: 300 } }, { platform: 'meta', kind: 'campaign', id: '2', name: 'Old', status: 'PAUSED', meta: {} }],
  mkt_ad_stats: [{ platform: 'meta', level: 'campaign', object_id: CAMP, campaign_id: CAMP, day: '2026-10-24', spend: 500, impressions: 1, clicks: 0, purchases: 4, purchase_value: 0 },
    { platform: 'meta', level: 'campaign', object_id: CAMP, campaign_id: CAMP, day: '2026-10-01', spend: 9999, impressions: 1, clicks: 0, purchases: 9, purchase_value: 0 }], // outside the week
  status_map: [{ id: 1, system_status: 'مكتمل', woo_status: 'completed' }, { id: 2, system_status: 'ملغي', woo_status: 'cancelled' }],
  orders: [{ id: 1, number: '1', customer_name: 'ع', status: 'مكتمل', confirm: 'غير مؤكد', deposit: 0, total: 700, placed_at: '2026-10-24T10:00:00+02:00', ad_platform: 'meta', utm_campaign: CAMP },
    { id: 2, number: '2', customer_name: 'ع', status: 'مكتمل', confirm: 'غير مؤكد', deposit: 0, total: 300, placed_at: '2026-10-25T10:00:00+02:00', ad_platform: 'meta', utm_campaign: CAMP },
    { id: 3, number: '3', customer_name: 'ع', status: 'ملغي', confirm: 'غير مؤكد', deposit: 0, total: 900, placed_at: '2026-10-25T10:00:00+02:00', ad_platform: 'meta', utm_campaign: CAMP }],
  mkt_suggestions: [{ id: 1, platform: 'meta', kind: 'budget_up', campaign_id: CAMP, title: 'زوّد «Macrame» 20%', sub: 'العائد 2×', status: 'pending', created_at: NOW, checked_at: NOW, data: {} }],
  settings: [{ section: 'marketing', data: { buyer: { maxCpa: 400 } } }],
};

Deno.test('buyer (9.5.4): marketing.view (P too); the week\'s numbers per campaign from our tables (never the body), the open suggestions and the rules in the request; text only; ai_runs marketing / buyer', async () => {
  const { deps, asked, db } = setup({ seed: BUYER_SEED, replies: [msg({ text: 'Macrame جابت 2 أوردر بـ 1,000 ج.م على 500 صرف — عائد 2×. لو عايز تزوّدها، وافق على الاقتراح من الصفحة.' })] });
  assertEquals((await call(deps, { action: 'buyer', question: 'إيه الوضع؟' }, 'jwt-add')).res.status, 401, 'products.add is not marketing.view');
  assertEquals((await call(deps, { action: 'buyer', question: '' }, 'jwt-mview')).body.field, 'question');
  assertEquals((await call(deps, { action: 'buyer', question: 'x', history: [{ role: 'system', text: 'y' }] }, 'jwt-mview')).body.field, 'history');
  const r = await call(deps, { action: 'buyer', question: 'أزوّد Macrame؟', history: [{ role: 'user', text: 'أهلًا' }, { role: 'assistant', text: 'أهلًا بيك' }], campaigns: 'ignored' }, 'jwt-mview');
  assertEquals([r.res.status, r.body.result, r.body.text.startsWith('Macrame جابت')], [200, 'ok', true]);
  const sent = asked[0].messages.at(-1).content[0].text;
  assert(sent.includes('Macrame | ACTIVE | spend 500 | meta purchases 4 | woo orders 2 | woo sales 1000 | MER 2.00 | cost/order 250 | daily budget 300'), sent);
  assertFalse(sent.includes('9999') || sent.includes('Old |')); // the old week and a paused campaign without spend stay out; the cancelled order too
  assert(sent.includes('max cost per order 400') && sent.includes('daily cap 5000') && sent.includes('execution switch off') && sent.includes('budget_up: زوّد «Macrame» 20% — العائد 2×') && sent.endsWith('أزوّد Macrame؟'));
  assertEquals(asked[0].messages.map((m: any) => m.role), ['user', 'assistant', 'user']);
  assert(asked[0].system[0].text.includes('never change anything yourself'));
  const run = db.rows('ai_runs').at(-1); assertEquals([run.action, run.source, run.label, run.status], ['marketing', 'buyer', 'أزوّد Macrame؟', 'ok']);
});

// ---------------------------------------------------------------- phase 9.5.5: the video piece's scenes (decision 59)

Deno.test('marketing scenes: a video piece of the saved campaign → its scenes with the durations fitted to its model and the voice-over; a post piece refused', async () => {
  const seed = { mkt_campaigns: [{ id: CMP, name: 'فيديو', archived_at: null, state: { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', media: { video: { notes: 'نور دافي', dur: 10 } } },
    pieces: [{ id: 'V1', kind: 'فيديو', n: 1, idea: 'المخدة', dur: 10, model: 'kling-2.5', sceneCount: 2, scenes: [] }, { id: 'P1', kind: 'بوست', n: 1 }] } }] };
  const { deps, asked, db } = setup({ seed, replies: [msg({ scenes: [{ idea: 'لقطة قريبة', text: 'دفا الشتا', cam: 'زوم بطيء' }, { idea: 'القعدة', text: '', cam: 'ثابتة' }], voice: 'الدفا الحقيقي من إيد مصرية' })] });
  const r = await call(deps, { action: 'marketing', task: 'scenes', campaign_id: CMP, piece: 'V1', voice: true }, 'jwt-mkt');
  assertEquals([r.res.status, r.body.result, r.body.voice], [200, 'ok', 'الدفا الحقيقي من إيد مصرية']);
  assertEquals(r.body.scenes.map((s: any) => [s.n, s.d, s.idea, s.cam, s.text]), [[1, 5, 'لقطة قريبة', 'زوم بطيء', 'دفا الشتا'], [2, 5, 'القعدة', 'ثابتة', '']]);
  const sent = asked[0].messages[0].content[0].text;
  assert(sent.includes('Video idea: المخدة') && sent.includes('Scenes: 2') && sent.includes('Instructions: نور دافي') && sent.includes('10-second video'));
  const run = db.rows('ai_runs').at(-1); assertEquals([run.action, run.source, run.label], ['marketing', 'campaign', 'فيديو 1 · المشاهد']);
  assertEquals((await call(deps, { action: 'marketing', task: 'scenes', campaign_id: CMP, piece: 'P1' }, 'jwt-mkt')).res.status, 400);
  assertEquals((await call(deps, { action: 'marketing', task: 'scenes', campaign_id: CMP, piece: 'V1' }, 'jwt-add')).res.status, 401);
});

// ---------------------------------------------------------------- phase 12 T1: the header's assistant (decision 8)

const toolUse = (uses: { id: string; name: string; input: unknown }[], text = '') => msg(text, { stop_reason: 'tool_use', content: [...(text ? [{ type: 'text', text }] : []), ...uses.map((u) => ({ type: 'tool_use', ...u }))] });
const NOW_DAY = NOW.slice(0, 10);
const MEMBER_SEED = {
  profiles: [{ id: U.view, name: 'منى', role_id: 'cs', status: 'active' }], roles: [{ id: 'cs', name: 'خدمة العملاء', permissions: {} }],
  orders_v: [
    { id: 1, number: '177701', customer_name: 'منى سعيد', customer_phone: '0100****', customer_city: 'القاهرة', status: 'جاري التنفيذ', confirm: 'غير مؤكد', deposit: 0, total: 900, placed_at: '2026-10-11T10:00:00+02:00' }, // 14 days before NOW: late
    { id: 2, number: '177702', customer_name: 'أحمد', customer_city: 'الجيزة', status: 'قيد الشحن', confirm: 'مؤكد بعربون', deposit: 200, total: 1500, placed_at: NOW_DAY + 'T08:00:00+02:00' },
    { id: 3, number: '177703', customer_name: 'سارة', status: 'مكتمل', confirm: 'مؤكد بعربون', deposit: 100, total: 600, placed_at: '2026-10-20T10:00:00+02:00' }, // this month (NOW is 25 Oct): in the default period
  ],
  tickets: [{ id: 7, type: 'customer', title: 'تأخير', description: 'd', priority: 'high', assignee_role: 'اللوجستيك والشحن', status: 'open', order_number: '177701', created_by_name: 'x', created_by_role: 'y', created_at: '2026-10-21T10:00:00Z', last_update: '2026-10-22T10:00:00Z' }],
  hr_tasks: [{ id: 1, member_id: U.view, title: 'تقرير اليوم', status: 'لسه', day: NOW_DAY }, { id: 2, member_id: U.admin, title: 'x', status: 'لسه', day: NOW_DAY }],
  cs_conversations: [{ id: '0c000000-0000-4000-8000-000000000001', seg: 'customers', platform: 'whatsapp', channel: 'wa1', status: 'جديدة' }, { id: '0c000000-0000-4000-8000-000000000002', seg: 'customers', platform: 'whatsapp', channel: 'wa1', status: 'اتحلت' }],
  acc_expenses: [{ id: 1, on_date: NOW_DAY, direction: 'withdraw', category: 'الإعلانات', amount: 1200 }],
  vendors: [{ id: '0a000000-0000-4000-8000-000000000001', name: 'Art Craft', status: 'active' }],
};
const ASSIST = (text: string, extra: any = {}) => ({ action: 'assistant', turns: [{ role: 'user', text }], context: { page: 'dashboard' }, ...extra });

Deno.test('assistant: any active member; the tool loop — get_data runs with the member\'s client (RLS: a refused table is forbidden, never the service role), the client tools come back as actions, the turn\'s calls summed into one ai_runs row', async () => {
  const salesRows = [{ vendor_id: null, grp: 'مكتمل', orders: 1, sales: 600, share: null, is_total: true }];
  const { deps, asked, db } = setup({
    memberSeed: MEMBER_SEED, memberRpc: { accounts_sales: () => salesRows },
    memberFail: (c: any) => (c.table === 'acc_expenses' ? { code: '42501', message: 'permission denied' } : null), // the member has no accounts.view
    replies: [
      toolUse([{ id: 'tu_1', name: 'get_data', input: { kind: 'summary' } }], 'ثواني'),
      toolUse([{ id: 'tu_2', name: 'get_data', input: { kind: 'orders', delivery: 'late' } }, { id: 'tu_3', name: 'filter_orders', input: { deliv: 'late', clear: true } }, { id: 'tu_4', name: 'navigate', input: { page: 'nowhere' } }]),
      msg('فيه أوردر واحد متأخر (177701 — منى سعيد، 14 يوم). فتحتلك الأوردرات عليه.', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'فيه أوردر واحد متأخر (177701 — منى سعيد، 14 يوم). فتحتلك الأوردرات عليه.' }] }),
    ],
  });
  assertEquals((await call(deps, ASSIST('x'), null)).res.status, 401, 'no token');
  assertEquals((await call(deps, { action: 'assistant', turns: [] }, 'jwt-view')).body.field, 'turns');
  const r = await call(deps, ASSIST('كام أوردر متأخر؟ افتحهم'), 'jwt-view');
  assertEquals(r.res.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.result, 'ok'); assert(r.body.text.startsWith('فيه أوردر واحد متأخر'));
  assertEquals(r.body.actions, [{ name: 'filter_orders', input: { clear: true, deliv: 'late' } }], 'the bad navigate is dropped');
  assertEquals(r.body.tools, ['summary', 'orders']);
  assertEquals(asked.length, 3);
  // the first request: the cached base, the screen block (the member and the page), the six tools (decision 40: no propose_entry), the question
  assertEquals(asked[0].tools.map((t: any) => t.name), ['get_data', 'navigate', 'filter_orders', 'set_period', 'sort_vendors', 'open_form']);
  assert(asked[0].system[1].text.includes('المستخدم: منى (خدمة العملاء)') && asked[0].system[1].text.includes('الصفحة المفتوحة: لوحة التحكم'), asked[0].system[1].text);
  assertEquals(asked[0].messages, [{ role: 'user', content: [{ type: 'text', text: 'كام أوردر متأخر؟ افتحهم' }] }]);
  // the second request carries the assistant's tool_use message and the summary as the tool result
  assertEquals(asked[1].messages.length, 3); assertEquals(asked[1].messages[1].role, 'assistant');
  const unwrap = (c: string) => JSON.parse(c.replace(/^<data>\n|\n<\/data>$/g, '')); // the untrusted block around every data result
  assert(asked[1].messages[2].content[0].content.startsWith('<data>\n'), 'data results are wrapped');
  const summary = unwrap(asked[1].messages[2].content[0].content);
  assertEquals(summary.orders.open, { 'جاري التنفيذ': 1, 'قيد الشحن': 1 }); assertEquals(summary.orders.delivery, { late: 1, ok: 1 });
  assertEquals(summary.tickets, { open: 1, byStatus: { open: 1 } }); assertEquals(summary.conversations, { open: 1 }); assertEquals(summary.myTasks, { open: 1, byStatus: { 'لسه': 1 } });
  assertEquals(summary.expenses, { forbidden: true }, 'RLS refused acc_expenses'); assertEquals(summary.sales, { 'مكتمل': { orders: 1, sales: 600, ibtekrShare: null } });
  assertFalse(JSON.stringify(summary).includes('0100'), 'never a phone');
  // the third: the late orders + the two client tools answered (one invalid)
  const res3 = asked[2].messages.at(-1).content;
  assertEquals(res3.map((x: any) => [x.tool_use_id, x.is_error ?? false]), [['tu_2', false], ['tu_3', false], ['tu_4', true]]);
  const late = unwrap(res3[0].content); assertEquals(late.rows.map((o: any) => [o.number, o.delivery, o.ageDays]), [['177701', 'late', 13]]); // whole days since the order's hour
  assertFalse('customer_phone' in late.rows[0]);
  // one run row: action assistant, source chat, the question as label, the three calls' cost summed (3 × 3000 in + 2000 out on Opus 5.5)
  const runs = db.rows('ai_runs'); assertEquals(runs.length, 1);
  assertEquals([runs[0].action, runs[0].source, runs[0].label, runs[0].status, runs[0].input_tokens, runs[0].output_tokens, runs[0].cost_usd], ['assistant', 'chat', 'كام أوردر متأخر؟ افتحهم', 'ok', 9000, 6000, 0.156]);
  assertEquals(runs[0].output.actions, r.body.actions); assertEquals(r.body.cost_usd, 0.156);
  // decision 23: the reads come back as the «تفاصيل» report (summary + orders), never stored in ai_runs
  assertEquals(r.body.report.map((x: any) => x.kind), ['summary', 'orders']);
  assert(Array.isArray(r.body.report[1].data.rows));
  assertEquals(runs[0].output.report, undefined);
  // the member's client did the reads — the service client never touched the data tables
  assertFalse(db.calls.some((c: any) => ['orders_v', 'tickets', 'hr_tasks', 'acc_expenses', 'cs_conversations'].includes(c.table)));
  // the reservation covered the whole loop: RESERVE_USD × (MAX_TOOL_CALLS + 2) = 3.5 while the calls ran
  assertEquals(db.calls.find((c: any) => c.op === 'rpc' && c.name === 'ai_run_start').args.p_reserve, 3.5);
});

Deno.test('assistant: propose_entry is an action with the confirm wording (nothing recorded); the data reads stop at MAX_TOOL_CALLS; a stopped member is 401; the filter mode forces set_filter and answers in one call', async () => {
  const { deps, asked, db } = setup({
    memberSeed: MEMBER_SEED,
    replies: [
      toolUse([{ id: 'tu_1', name: 'propose_entry', input: { kind: 'expense', direction: 'withdraw', amount: 5000, category: 'المرتبات' } }]),
      msg('عرضتلك كارت التأكيد لسحب 5,000 ج.م مرتبات — أكّد عشان تتسجل.', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'عرضتلك كارت التأكيد لسحب 5,000 ج.م مرتبات — أكّد عشان تتسجل.' }] }),
    ],
  });
  const r = await call(deps, ASSIST('سجل سحب مرتبات 5000'), 'jwt-view');
  assertEquals(r.body.actions, [{ name: 'propose_entry', input: { kind: 'expense', direction: 'withdraw', amount: 5000, category: 'المرتبات' } }]);
  assert(asked[1].messages.at(-1).content[0].content.includes('not recorded yet'));
  assertEquals(db.rows('ai_runs').at(-1).output.tools, []);
  // an amount the member did not type (one the model took from data, or made up) is refused — no action, an error result the model reads
  const s0 = setup({ memberSeed: MEMBER_SEED, replies: [toolUse([{ id: 'tu_1', name: 'propose_entry', input: { kind: 'expense', direction: 'withdraw', amount: 1200, category: 'الإعلانات' } }]), msg('المبلغ كام؟', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'المبلغ كام؟' }] })] });
  const r0 = await call(s0.deps, ASSIST('سجل مصروف الإعلانات بتاع الشهر'), 'jwt-view');
  assertEquals(r0.body.actions, []); assert(s0.asked[1].messages.at(-1).content[0].is_error === true && s0.asked[1].messages.at(-1).content[0].content.startsWith('refused'));
  // MAX_TOOL_CALLS: the sixth read is refused with an error result, the loop ends on the next text
  const many = Array.from({ length: 6 }, (_, i) => toolUse([{ id: 'r' + i, name: 'get_data', input: { kind: 'tickets' } }]));
  const s2 = setup({ memberSeed: MEMBER_SEED, replies: [...many, msg('خلاص', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'خلاص' }] })] });
  const r2 = await call(s2.deps, ASSIST('لف'), 'jwt-view');
  assertEquals([r2.res.status, r2.body.text, r2.body.tools], [200, 'خلاص', ['tickets']]);
  assertEquals(s2.asked.length, 7);
  assert(s2.asked[6].messages.at(-1).content[0].is_error === true && s2.asked[6].messages.at(-1).content[0].content.startsWith('limit'));
  // a stopped member
  const s3 = setup({ memberSeed: { ...MEMBER_SEED, profiles: [{ id: U.view, name: 'منى', role_id: 'cs', status: 'inactive' }] }, replies: [] });
  assertEquals((await call(s3.deps, ASSIST('x'), 'jwt-view')).res.status, 401);
  assertEquals(s3.db.rows('ai_runs').length, 0, 'no run reserved before the profile check');
  // the filter mode
  const s4 = setup({ memberSeed: MEMBER_SEED, replies: [toolUse([{ id: 'f1', name: 'set_filter', input: { op: 'and', items: [{ f: 'deliv', op: 'eq', v: 'متأخر' }, { f: 'vendor', op: 'eq', v: 'Art Craft' }] } }])] });
  const r4 = await call(s4.deps, { action: 'assistant', mode: 'filter', turns: [{ role: 'user', text: 'المتأخر بتاع Art Craft' }], context: { vendors: ['Art Craft'] } }, 'jwt-view');
  assertEquals(r4.body.actions, [{ name: 'set_filter', input: { op: 'and', items: [{ f: 'deliv', op: 'eq', v: 'متأخر' }, { f: 'vendor', op: 'eq', v: 'Art Craft' }] } }]);
  assertEquals(s4.asked.length, 1); assertEquals(s4.asked[0].tool_choice, { type: 'tool', name: 'set_filter' }); assertEquals(s4.asked[0].tools.map((t: any) => t.name), ['set_filter']);
  assertEquals(s4.db.rows('ai_runs').at(-1).source, 'filter');
});

Deno.test('assistant: no key → 503 with an error row; a refusal → 200 refused; Claude busy twice → 429; the monthly cap → 402 before any call', async () => {
  const s1 = setup({ memberSeed: MEMBER_SEED, env: { ANTHROPIC_API_KEY: '' }, replies: [] });
  assertEquals((await call(s1.deps, ASSIST('x'), 'jwt-view')).res.status, 503); assertEquals(s1.db.rows('ai_runs').at(-1).error, 'not_configured');
  const s2 = setup({ memberSeed: MEMBER_SEED, replies: [msg('', { stop_reason: 'refusal', content: [] })] });
  const r2 = await call(s2.deps, ASSIST('x'), 'jwt-view'); assertEquals([r2.res.status, r2.body.result], [200, 'refused']);
  const s3 = setup({ memberSeed: MEMBER_SEED, replies: [apiError(529), apiError(529)] });
  assertEquals((await call(s3.deps, ASSIST('x'), 'jwt-view')).res.status, 429);
  const s4 = setup({ memberSeed: MEMBER_SEED, env: { AI_MONTHLY_LIMIT_USD: '10' }, monthCost: 9.8, replies: [] });
  assertEquals((await call(s4.deps, ASSIST('x'), 'jwt-view')).res.status, 402); assertEquals(s4.asked.length, 0);
  // the loop-wide reserve: 7 dollars left is not enough for a chat turn's 3.5 reserve? it is — 6.4 is not when the filter mode's 0.5 would pass
  const s5 = setup({ memberSeed: MEMBER_SEED, env: { AI_MONTHLY_LIMIT_USD: '10' }, monthCost: 7, replies: [toolUse([{ id: 'f1', name: 'set_filter', input: { items: [{ f: 'st', op: 'eq', v: 'مكتمل' }] } }])] });
  assertEquals((await call(s5.deps, ASSIST('x'), 'jwt-view')).res.status, 402, 'a chat turn reserves 3.5');
  assertEquals((await call(s5.deps, { action: 'assistant', mode: 'filter', turns: [{ role: 'user', text: 'المكتمل' }] }, 'jwt-view')).res.status, 200, 'the filter mode reserves one call');
});
