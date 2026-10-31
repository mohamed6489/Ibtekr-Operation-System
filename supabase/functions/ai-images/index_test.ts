// deno-lint-ignore-file no-explicit-any
// ai-images handler tests (phase 5.4): a fake provider (records every request, answers from a queue) + the in-memory Supabase
// clients of ../_test/fakes.ts (service and per-member, with the storage fakes). No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';
import { ProviderError, magnific, shape } from './providers/magnific.ts';

const KEY = 'magnific-test-key-0000';
const U = { admin: '00000000-0000-4000-8000-0000000000b1', add: '00000000-0000-4000-8000-0000000000b2', edit: '00000000-0000-4000-8000-0000000000b3', view: '00000000-0000-4000-8000-0000000000b4' };
const MEMBERS: Record<string, { uid: string; admin?: unknown; add?: unknown; edit?: unknown }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-add': { uid: U.add, add: 'F' }, 'jwt-edit': { uid: U.edit, edit: 'F' }, 'jwt-view': { uid: U.view, add: 'P', edit: 'P' },
};
const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const BRAND = '22222222-3333-4444-8555-666666666666';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const WEBP = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const item = (extra: any = {}) => ({ nameEn: 'Kilim Pouf', nameAr: 'بوف كليم', material: 'Cotton', style: 'Boho', colors: ['BE', 'BK'], sizes: ['50×50'], main: SB + '/row1-main.webp', refs: [SB + '/row1-ref.webp', 'other/x.webp'], colorImages: { BK: SB + '/black.webp' }, slots: [], ...extra });
const batch = (extra: any = {}) => ({ id: SB, title: 'دفعة', brand_id: BRAND, type: 'Variable', state: { items: [item()] }, step: 6, status: 'draft', ...extra });
const SEED = { brands: [{ id: BRAND, name: 'Art Craft', code: 'AR', aliases: [] }], studio_batches: [batch()], sku_colors: [{ id: 1, name_en: 'Beige', name_ar: 'بيج', code: 'BE', hex: null }, { id: 2, name_en: 'Black', name_ar: 'أسود', code: 'BK', hex: null }],
  products: [{ id: 4001, sku: 'IBTARBE0999', name: 'Boho Cushion', lang: 'en', image_url: 'https://woo.test/wp-content/uploads/c.jpg' }, { id: 4002, sku: 'X', name: 'No photo', lang: 'en', image_url: null }] };
const FILES = { [`studio/${SB}/row1-main.webp`]: WEBP, [`studio/${SB}/row1-ref.webp`]: WEBP, [`studio/${SB}/black.webp`]: WEBP, [`studio/${SB}/gen-0-0-old.png`]: PNG };
const img = (bytes = PNG, mime = 'image/png') => ({ bytes, mime });

type Opts = { seed?: Record<string, any[]>; env?: Record<string, string>; replies?: unknown[]; startDown?: boolean; storage?: Record<string, Uint8Array>; fail?: (c: any) => any; photo?: Uint8Array | null };
function setup({ seed = SEED, env = {}, replies = [], startDown = false, storage = { ...FILES }, fail, photo = PNG }: Opts = {}) {
  let db: any = null;
  // ai_image_run_start as 0025 defines it: the throttle, then this Cairo month's image credits (pending rows included) + the planned
  // credits against the cap → a cap row, else a pending row holding the credits and the estimate
  const cairoMonth = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(iso));
  const start = async ({ p_row, p_cap_credits, p_credits, p_cost, p_throttle, p_window_minutes }: any) => {
    const rows = db.rows('ai_runs'); const since = new Date(Date.parse(NOW) - p_window_minutes * 60_000).toISOString();
    if (rows.filter((r: any) => r.created_by === p_row.created_by && r.created_at >= since).length >= p_throttle) return { result: 'busy' };
    const spent = rows.filter((r: any) => r.action === 'image' && cairoMonth(r.created_at) === cairoMonth(NOW)).reduce((t: number, r: any) => t + Number(r.credits || 0), 0);
    if (p_cap_credits != null && spent + p_credits > p_cap_credits) {
      const { data } = await db.from('ai_runs').insert({ created_at: NOW, ...p_row, action: 'image', status: 'cap', error: 'ai_cap', credits: 0, cost_usd: 0 }).select('id').single();
      return { result: 'cap', id: data.id };
    }
    const { data } = await db.from('ai_runs').insert({ created_at: NOW, ...p_row, action: 'image', status: 'pending', credits: p_credits, cost_usd: p_cost }).select('id').single();
    return { result: 'ok', id: data.id };
  };
  db = fakeDb(seed, { rpc: startDown ? {} : { ai_image_run_start: start }, storage, fail });
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'products.add' ? m.add ?? 'N' : key === 'products.edit' ? m.edit ?? 'N' : 'N'), is_admin: () => m.admin ?? false } : {} });
  };
  const asked: any[] = []; const queue = [...replies]; const during: any[] = [];
  const answer = async (kind: string, p: any) => {
    asked.push({ kind, ...structuredClone({ ...p, references: undefined, image: undefined }), refs: (p.references ?? (p.image ? [p.image] : [])).map((r: any) => [r.mime, r.bytes.length]) });
    during.push(db.rows('ai_runs').map((r: any) => [r.status, Number(r.credits), Number(r.cost_usd)]));
    const r = queue.shift(); if (r instanceof Error) throw r; if (r === undefined) throw new Error('no reply queued'); return r as any;
  };
  const provider = { generate: (p: any) => answer('generate', p), edit: (p: any) => answer('edit', p), probe: async () => { const r = queue.shift(); if (r instanceof Error) throw r; return r as any; } };
  const fetched: string[] = []; const fetchInits: any[] = [];
  const fetchFn = (async (url: string, init: any = {}) => { fetched.push(url); fetchInits.push(init); return photo ? new Response(photo as BlobPart, { status: 200, headers: { "content-type": "image/jpeg" } }) : new Response("nope", { status: 404 }); }) as any;
  const deps = { env: { ...ENV, MAGNIFIC_API_KEY: KEY, ...env }, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, provider, fetch: fetchFn };
  return { db, asked, during, deps, storage, fetched, fetchInits };
}
async function call(deps: any, body: unknown, jwt: string | null = 'jwt-add') {
  const res = await handler(new Request('http://x/ai-images', { method: 'POST', headers: { 'content-type': 'application/json', ...(jwt ? { authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
const GEN = { action: 'generate', batch_id: SB, index: 0, slot: 0 };

Deno.test('auth: a member JWT only; generate needs products.add = F (or the admin), create products.add or products.edit, probe the admin', async () => {
  const { deps } = setup({ replies: [{ images: [img()], credits: 75 }] });
  assertEquals((await call(deps, GEN, null)).res.status, 401);
  assertEquals((await call(deps, GEN, 'jwt-nobody')).res.status, 401);
  assertEquals((await call(deps, GEN, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, GEN, 'jwt-edit')).res.status, 401, 'products.edit alone does not generate studio slots');
  assertEquals((await call(deps, { action: 'create', source: 'text', shape: 'studio', prompt: 'a mug' }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'probe' }, 'jwt-add')).res.status, 401);
  assertEquals((await call(deps, { action: 'dance' }, 'jwt-add')).body.error, 'unknown_action');
  assertEquals((await call(deps, GEN, 'jwt-add')).res.status, 200);
});

Deno.test('generate: the item\'s reference photos of its batch only, the slot prompt, the product size; the image saved in bucket studio under the batch; one ai_runs row with the provider\'s credits', async () => {
  const { deps, asked, db, storage, during } = setup({ replies: [{ images: [img()], credits: 75 }] });
  const { res, body } = await call(deps, GEN);
  assertEquals(res.status, 200);
  assertEquals([body.result, body.bucket, body.credits, body.model], ['ok', 'studio', 75, 'seedream-5-pro']);
  assert(/^0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab\/gen-0-0-[0-9a-z]+\.png$/.test(body.path), body.path);
  assertEquals(storage[`studio/${body.path}`], PNG, 'the image is in the bucket');
  assertEquals(asked.length, 1);
  assertEquals([asked[0].kind, asked[0].model, asked[0].width, asked[0].height, asked[0].count], ['generate', 'seedream-5-pro', 700, 800, 1]);
  assertEquals(asked[0].refs, [['image/webp', 8], ['image/webp', 8]], 'the main photo and the reference of this batch; other/x.webp never read');
  assert(asked[0].prompt.includes('Kilim Pouf, made of Cotton, Boho style by the handmade brand Art Craft') && asked[0].prompt.includes('studio background'), asked[0].prompt);
  assertEquals(during[0], [['pending', 75, 0.15]], 'the planned credits are held while the call runs');
  const run = db.rows('ai_runs')[0];
  assertEquals([run.action, run.source, run.label, run.batch_id, run.item_index, run.model, run.status, run.credits, Number(run.cost_usd), run.output], ['image', 'studio', 'Kilim Pouf', SB, 0, 'seedream-5-pro', 'ok', 75, 0.15, { paths: [body.path], bucket: 'studio' }]);
  assertFalse(JSON.stringify(db.rows('ai_runs')).includes('studio background'), 'no prompt in the row');
  assertEquals(db.rows('studio_batches')[0].state, batch().state, 'the batch is not written');
});

Deno.test('generate: a color slot adds the color\'s photo and name; the listed model and a social size; the provider\'s silence on credits = the estimate', async () => {
  const { deps, asked, db } = setup({ replies: [{ images: [img(WEBP, 'image/webp')], credits: null }] });
  const { body } = await call(deps, { ...GEN, slot: 'color:BK', model: 'imagen-nano-banana-2-1', size: '1080x1080' });
  assertEquals([body.credits, body.model], [50, 'imagen-nano-banana-2-1']);
  assert(body.path.includes('/gen-0-cBK-') && body.path.endsWith('.webp'));
  assertEquals(asked[0].refs.length, 3); assert(asked[0].prompt.includes('in Black'));
  assertEquals([asked[0].width, asked[0].height], [1080, 1080]);
  assertEquals(db.rows('ai_runs')[0].credits, 50);
});

Deno.test('generate: no item / archived / an item without a readable photo / a bad body → 404 / 400 with no call and no row', async () => {
  const { deps, asked, db } = setup({ seed: { ...SEED, studio_batches: [batch(), { ...batch({ id: '11111111-2222-4333-8444-555555555555', archived_at: NOW }) }] } });
  assertEquals((await call(deps, { ...GEN, index: 3 })).res.status, 404);
  assertEquals((await call(deps, { ...GEN, batch_id: '11111111-2222-4333-8444-555555555555' })).res.status, 404);
  assertEquals((await call(deps, { ...GEN, slot: 9 })).body.field, 'slot');
  const bare = setup({ seed: { ...SEED, studio_batches: [batch({ state: { items: [item({ main: 'other/x.webp', refs: [], colorImages: {} })] } })] } });
  assertEquals((await call(bare.deps, GEN)).body.field, 'reference');
  assertEquals(asked.length + bare.asked.length, 0); assertEquals(db.rows('ai_runs').length + bare.db.rows('ai_runs').length, 0);
});

Deno.test('no MAGNIFIC_API_KEY → 503 not_configured after the reservation, no call, the row says so at 0 credits', async () => {
  const { deps, asked, db } = setup({ env: { MAGNIFIC_API_KEY: '' } });
  const { res, body } = await call(deps, GEN);
  assertEquals([res.status, body.error, asked.length], [503, 'not_configured', 0]);
  assertEquals([db.rows('ai_runs')[0].status, db.rows('ai_runs')[0].error, db.rows('ai_runs')[0].credits, Number(db.rows('ai_runs')[0].cost_usd)], ['error', 'not_configured', 0, 0]);
});

Deno.test('the provider: busy (429 / 5xx / timeout) → 429 busy and the planned credits kept; the key refused → 503; a refusal → 200 refused at 0; no usable image → 502', async () => {
  const run = async (reply: unknown) => { const s = setup({ replies: [reply] }); const r = await call(s.deps, GEN); return { ...r, row: s.db.rows('ai_runs')[0] }; };
  const busy = await run(new ProviderError('busy', 503)); assertEquals([busy.res.status, busy.body.error, busy.row.status, busy.row.credits], [429, 'busy', 'error', 75]);
  const nk = await run(new ProviderError('not_configured', 401)); assertEquals([nk.res.status, nk.row.error, nk.row.credits], [503, 'not_configured', 0]);
  const ref = await run(new ProviderError('refused', 422)); assertEquals([ref.res.status, ref.body.result, ref.row.status, ref.row.credits], [200, 'refused', 'refused', 0]);
  const none = await run({ images: [], credits: 30 }); assertEquals([none.res.status, none.body.error, none.row.status, none.row.credits], [502, 'ai_error', 'error', 30]);
  const boom = await run(new Error('kaput')); assertEquals([boom.res.status, boom.row.error], [502, 'ai_error']);
});

Deno.test('the images\' monthly cap (settings «ai».image_monthly_credits) counts this Cairo month\'s image credits: over it → 402 ai_cap and a cap row, no call; within it → the call', async () => {
  const earlier = { created_at: NOW, created_by: U.add, action: 'image', source: 'tool', model: 'seedream-5-pro', status: 'ok', credits: 150, cost_usd: 0.3 };
  const lastMonth = { ...earlier, created_at: '2026-09-25T10:00:00.000Z', credits: 9000 };
  const writeRun = { ...earlier, action: 'write', source: 'data', credits: 0, cost_usd: 5 };
  const over = setup({ seed: { ...SEED, settings: [{ section: 'ai', data: { image_monthly_credits: 200 } }], ai_runs: [earlier, lastMonth, writeRun] }, replies: [{ images: [img()], credits: 75 }] });
  const r1 = await call(over.deps, GEN);
  assertEquals([r1.res.status, r1.body.error, over.asked.length], [402, 'ai_cap', 0]);
  assertEquals(over.db.rows('ai_runs').at(-1).status, 'cap');
  const within = setup({ seed: { ...SEED, settings: [{ section: 'ai', data: { image_monthly_credits: 300 } }], ai_runs: [earlier, lastMonth, writeRun] }, replies: [{ images: [img()], credits: 75 }] });
  assertEquals((await call(within.deps, GEN)).res.status, 200, 'last month and the content runs do not count');
  const secret = setup({ env: { IMAGE_MONTHLY_CREDITS: '70' }, replies: [{ images: [img()], credits: 75 }] });
  assertEquals((await call(secret.deps, GEN)).res.status, 402, 'the secret is the fallback cap');
});

Deno.test('a member with THROTTLE calls in the last 10 minutes gets 429 busy with no call; no reservation (the RPC missing) → no call', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ created_at: new Date(Date.parse(NOW) - i * 1000).toISOString(), created_by: U.add, action: 'image', source: 'tool', status: 'ok', credits: 1, cost_usd: 0 }));
  const t = setup({ seed: { ...SEED, ai_runs: many }, replies: [{ images: [img()], credits: 75 }] });
  assertEquals((await call(t.deps, GEN)).res.status, 429); assertEquals(t.asked.length, 0);
  const down = setup({ startDown: true, replies: [{ images: [img()], credits: 75 }] });
  assertEquals((await call(down.deps, GEN)).res.status, 502); assertEquals(down.asked.length, 0);
});

Deno.test('edit a studio image: products.add; the path of its batch only; the op prompt; the result next to the batch; an instruction needs words', async () => {
  const { deps, asked, storage } = setup({ replies: [{ images: [img()], credits: 40 }] });
  const { res, body } = await call(deps, { action: 'edit', batch_id: SB, index: 0, path: SB + '/gen-0-0-old.png', op: 'instruction', prompt: 'lighter background' });
  assertEquals([res.status, body.result, body.bucket, body.credits], [200, 'ok', 'studio', 40]);
  assert(/\/edit-0-[0-9a-z]+\.png$/.test(body.path)); assertEquals(storage[`studio/${body.path}`], PNG);
  assertEquals([asked[0].kind, asked[0].op, asked[0].refs], ['edit', 'instruction', [['image/png', 11]]]);
  assert(asked[0].prompt.includes('lighter background'));
  assertEquals((await call(deps, { action: 'edit', batch_id: SB, path: 'other/x.webp', op: 'upscale' })).body.field, 'path');
  assertEquals((await call(deps, { action: 'edit', batch_id: SB, path: SB + '/missing.png', op: 'upscale' })).res.status, 404);
  assertEquals((await call(deps, { action: 'edit', batch_id: SB, path: SB + '/gen-0-0-old.png', op: 'instruction' })).body.field, 'prompt');
  assertEquals((await call(deps, { action: 'edit', batch_id: SB, path: SB + '/gen-0-0-old.png', op: 'upscale' }, 'jwt-edit')).res.status, 401);
});

Deno.test('edit a product\'s image: products.edit; the mirror\'s https photo fetched by the server from the site\'s host only (no redirects); the result in bucket ai-images under the member; no photo → 404', async () => {
  const foreign = [{ id: 4003, sku: 'Y', name: 'Elsewhere', lang: 'en', image_url: 'https://evil.test/wp-content/uploads/c.jpg' }, { id: 4004, sku: 'Z', name: 'Plain', lang: 'en', image_url: 'http://woo.test/c.jpg' },
    { id: 4005, sku: 'W', name: 'CDN', lang: 'en', image_url: 'https://cdn.woo.test/c.jpg' }];
  const { deps, asked, storage, fetched, fetchInits, db } = setup({ seed: { ...SEED, products: [...SEED.products, ...foreign] }, env: { IMAGE_HOSTS: 'cdn.woo.test, Other.Test' }, replies: [{ images: [img(WEBP, 'image/webp')], credits: 20 }, { images: [img()], credits: 20 }] });
  const { res, body } = await call(deps, { action: 'edit', product_id: 4001, op: 'remove_bg', options: { bg: 'white' } }, 'jwt-edit');
  assertEquals([res.status, body.bucket], [200, 'ai-images']);
  assert(body.path.startsWith(U.edit + '/') && body.path.endsWith('-1.webp'), body.path);
  assertEquals(storage[`ai-images/${body.path}`], WEBP);
  assertEquals(fetched, ['https://woo.test/wp-content/uploads/c.jpg']);
  assertEquals([fetchInits[0].redirect, fetchInits[0].signal instanceof AbortSignal], ['error', true], 'no redirects, a time limit');
  assertEquals([asked[0].op, asked[0].options], ['remove_bg', { bg: 'white' }]); assert(asked[0].prompt.includes('white'));
  assertEquals((await call(deps, { action: 'edit', product_id: 4003, op: 'upscale' }, 'jwt-edit')).res.status, 404, 'another host is never fetched');
  assertEquals((await call(deps, { action: 'edit', product_id: 4004, op: 'upscale' }, 'jwt-edit')).res.status, 404, 'plain http is never fetched');
  assertEquals(fetched.length, 1);
  assertEquals((await call(deps, { action: 'edit', product_id: 4005, op: 'upscale' }, 'jwt-edit')).res.status, 200, 'a host listed in IMAGE_HOSTS is allowed');
  assertEquals(fetched.at(-1), 'https://cdn.woo.test/c.jpg');
  assertEquals([db.rows('ai_runs')[0].product_id, db.rows('ai_runs')[0].label, db.rows('ai_runs')[0].source], [4001, 'Boho Cushion', 'edit']);
  assertEquals((await call(deps, { action: 'edit', product_id: 4002, op: 'upscale' }, 'jwt-edit')).res.status, 404);
  assertEquals((await call(deps, { action: 'edit', product_id: 4001, op: 'upscale' }, 'jwt-add')).res.status, 401, 'products.add alone does not edit site products');
});

Deno.test('create (the tool): text → the shape prompt, N images at the asked size in bucket ai-images under the member, credits × N held; from a photo (base64) or a product\'s photo as the reference', async () => {
  const { deps, asked, storage, during, db } = setup({ replies: [{ images: [img(), img(WEBP, 'image/webp'), img()], credits: 160 }, { images: [img()], credits: 50 }, { images: [img()], credits: null }] });
  const r = await call(deps, { action: 'create', source: 'text', shape: 'home', prompt: 'a macrame bag', count: 3, size: '1080x1350', model: 'imagen-nano-banana-2-1' }, 'jwt-edit');
  assertEquals([r.res.status, r.body.result, r.body.bucket, r.body.paths.length, r.body.credits], [200, 'ok', 'ai-images', 3, 160]);
  assert(r.body.paths.every((p: string) => p.startsWith(U.edit + '/')) && r.body.paths[1].endsWith('-2.webp'));
  assertEquals(Object.keys(storage).filter((k) => k.startsWith('ai-images/')).length, 3);
  assertEquals([asked[0].count, asked[0].width, asked[0].height, asked[0].refs], [3, 1080, 1350, []]);
  assert(asked[0].prompt.includes('Egyptian home') && asked[0].prompt.endsWith('a macrame bag'));
  assertEquals(during[0], [['pending', 150, 0.3]], '3 × 50 held');
  const b64 = btoa(String.fromCharCode(...new Uint8Array(120).fill(7))); // valid base64 of 120 bytes (no padding), long enough for the check
  const r2 = await call(deps, { action: 'create', source: 'image', shape: 'studio', image: { media_type: 'image/png', data: b64 } }, 'jwt-add');
  assertEquals([r2.res.status, asked[1].refs.length, asked[1].refs[0][0]], [200, 1, 'image/png']);
  const r3 = await call(deps, { action: 'create', source: 'image', shape: 'detail', product_id: 4001 }, 'jwt-add');
  assertEquals([r3.res.status, asked[2].refs, r3.body.credits], [200, [['image/jpeg', 11]], 75]);
  assert(asked[2].prompt.includes('Boho Cushion'));
  assertEquals(db.rows('ai_runs').map((x: any) => [x.source, x.product_id, x.credits]), [['tool', null, 160], ['tool', null, 50], ['tool', 4001, 75]]);
  assertEquals((await call(deps, { action: 'create', source: 'image', shape: 'studio', product_id: 4002 }, 'jwt-add')).body.field, 'image', 'a product without a photo');
  assertEquals((await call(deps, { action: 'create', source: 'text', shape: 'studio', prompt: 'x', count: 5 }, 'jwt-add')).body.field, 'count');
});

Deno.test('probe: the admin only; the shape of the provider\'s account answer (keys and types, no values); no key → 503', async () => {
  const { deps } = setup({ replies: [{ credits: 756, plan: { name: 'Premium+' }, list: [1, 2] }] });
  const { res, body } = await call(deps, { action: 'probe' }, 'jwt-admin');
  assertEquals([res.status, body.provider, body.shape, body.models[0]], [200, 'magnific', { credits: 'number', plan: { name: 'string' }, list: { array: 'number' } }, 'seedream-5-pro']);
  assertFalse(JSON.stringify(body).includes('756'));
  const nk = setup({ env: { MAGNIFIC_API_KEY: '' } });
  assertEquals((await call(nk.deps, { action: 'probe' }, 'jwt-admin')).res.status, 503);
});

Deno.test('the Magnific layer: the key in the headers, a task created then polled until completed, its images downloaded; 401 → not_configured, 429 → busy, a failed task → ai_error, a safety failure → refused, no key → not_configured without a request', async () => {
  const calls: { url: string; method: string; body: any; auth: string }[] = [];
  let polls = 0;
  const fetchFn = (async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization ?? '' });
    if (url.endsWith('/images/generations')) return Response.json({ id: 't1', status: 'processing' });
    if (url.endsWith('/tasks/t1')) { polls++; return Response.json(polls < 2 ? { status: 'processing' } : { status: 'completed', images: [{ url: 'https://cdn.test/a.png' }], credits_used: 75 }); }
    if (url === 'https://cdn.test/a.png') return new Response(PNG as BlobPart, { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('?', { status: 404 });
  }) as any;
  const slept: number[] = [];
  const p = magnific({ MAGNIFIC_API_KEY: KEY, MAGNIFIC_API_URL: 'https://api.test/v1/' }, fetchFn, async (ms) => { slept.push(ms); });
  const out = await p.generate({ model: 'seedream-5-pro', prompt: 'x', width: 700, height: 800, count: 1, references: [{ bytes: WEBP, mime: 'image/webp' }] });
  assertEquals([out.credits, out.images.length, out.images[0].mime, out.images[0].bytes], [75, 1, 'image/png', PNG]);
  assertEquals(calls.map((c) => [c.method, c.url]), [['POST', 'https://api.test/v1/images/generations'], ['GET', 'https://api.test/v1/tasks/t1'], ['GET', 'https://api.test/v1/tasks/t1'], ['GET', 'https://cdn.test/a.png']]);
  assertEquals(calls[0].auth, 'Bearer ' + KEY); assertEquals(calls[0].body.width, 700); assert(calls[0].body.reference_images[0].startsWith('data:image/webp;base64,'));
  assertEquals(slept, [2500, 2500]);
  const status = async (code: number, body: any = {}) => { try { await magnific({ MAGNIFIC_API_KEY: KEY }, (async () => Response.json(body, { status: code })) as any).generate({ model: 'm', prompt: 'x', width: 1, height: 1, count: 1, references: [] }); return 'ok'; } catch (e) { return (e as ProviderError).kind; } };
  assertEquals(await status(401), 'not_configured'); assertEquals(await status(429), 'busy'); assertEquals(await status(500), 'busy');
  assertEquals(await status(200, { status: 'failed', error: 'content policy violation' }), 'refused');
  assertEquals(await status(200, { status: 'failed', error: 'oops' }), 'ai_error');
  assertEquals(await status(200, { status: 'completed', images: [] }), 'ai_error');
  let hit = false;
  try { await magnific({}, (async () => { hit = true; return Response.json({}); }) as any).probe(); } catch (e) { assertEquals((e as ProviderError).kind, 'not_configured'); }
  assertFalse(hit);
  assertEquals(shape({ a: 1, b: 'x', c: { d: [1], e: { f: 1 } }, g: [] }), { a: 'number', b: 'string', c: { d: 'array', e: 'object' }, g: { array: 'empty' } });
});
