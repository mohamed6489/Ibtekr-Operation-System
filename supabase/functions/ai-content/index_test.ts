// deno-lint-ignore-file no-explicit-any
// ai-content handler tests (phase 5.3): a fake Claude (records every request, answers from a queue) + the in-memory Supabase
// clients of ../_test/fakes.ts (service and per-member). No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const KEY = 'anthropic-test-key-0000';
const U = { admin: '00000000-0000-4000-8000-0000000000a1', add: '00000000-0000-4000-8000-0000000000a2', edit: '00000000-0000-4000-8000-0000000000a3', view: '00000000-0000-4000-8000-0000000000a4' };
// member tokens → what has_perm / is_admin answer, and who they are
const MEMBERS: Record<string, { uid: string; admin?: unknown; add?: unknown; edit?: unknown }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-add': { uid: U.add, add: 'F' }, 'jwt-edit': { uid: U.edit, edit: 'F' }, 'jwt-view': { uid: U.view, add: 'P', edit: 'P' },
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

type Opts = { seed?: Record<string, any[]>; env?: Record<string, string>; replies?: unknown[]; monthCost?: number | null; storage?: Record<string, Uint8Array> };
function setup({ seed = {}, env = {}, replies = [], monthCost = 0, storage = {} }: Opts = {}) {
  const db = fakeDb(seed, { rpc: monthCost === null ? {} : { ai_month_cost: () => monthCost }, storage });
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'products.add' ? m.add ?? 'N' : key === 'products.edit' ? m.edit ?? 'N' : 'N'), is_admin: () => m.admin ?? false } : {} });
  };
  const asked: any[] = []; const slept: number[] = []; const queue = [...replies];
  const claude = async (p: any) => { asked.push(structuredClone(p)); const r = queue.shift(); if (r instanceof Error) throw r; if (r === undefined) throw new Error('no reply queued'); return r as any; };
  const deps = { env: { ...ENV, ANTHROPIC_API_KEY: KEY, ...env }, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, claude, sleep: async (ms: number) => { slept.push(ms); } };
  return { db, asked, slept, deps };
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

Deno.test('write: no ANTHROPIC_API_KEY → 503 not_configured, no call, a row says so', async () => {
  const { deps, asked, db } = setup({ env: { ANTHROPIC_API_KEY: ' ' } });
  const { res, body } = await call(deps, WRITE);
  assertEquals([res.status, body], [503, { error: 'not_configured' }]);
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
  assertEquals(twice.db.rows('ai_runs').map((r: any) => [r.status, r.error]), [['error', 'busy']]);
  const key = setup({ replies: [apiError(401)] });
  assertEquals((await call(key.deps, WRITE)).res.status, 503);
  const net = setup({ replies: [apiError(null)] });
  assertEquals((await call(net.deps, WRITE)).body, { error: 'busy' });
  assertEquals(net.asked.length, 1, 'a timeout or a network error is not retried');
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

Deno.test('the monthly cap (AI_MONTHLY_LIMIT_USD): reached → 402 ai_cap and a cap row, no call; under it → the call; unreadable → no call', async () => {
  const at = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, monthCost: 5 });
  const { res, body } = await call(at.deps, WRITE);
  assertEquals([res.status, body, at.asked.length], [402, { error: 'ai_cap' }, 0]);
  assertEquals(at.db.rows('ai_runs').map((x: any) => [x.status, x.error]), [['cap', 'ai_cap']]);
  const under = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, monthCost: 4.99, replies: [msg(ANSWER)] });
  assertEquals((await call(under.deps, WRITE)).res.status, 200);
  const unknown = setup({ env: { AI_MONTHLY_LIMIT_USD: '5' }, monthCost: null });
  assertEquals([(await call(unknown.deps, WRITE)).res.status, unknown.asked.length], [502, 0]);
  const none = setup({ monthCost: null, replies: [msg(ANSWER)] }); // no cap set: the month is not even read
  assertEquals((await call(none.deps, WRITE)).res.status, 200);
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
