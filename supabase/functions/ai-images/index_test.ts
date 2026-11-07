// deno-lint-ignore-file no-explicit-any
// ai-images handler tests (phase 5.4): a fake provider (records every request, answers from a queue) + the in-memory Supabase
// clients of ../_test/fakes.ts (service and per-member, with the storage fakes). No network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { FRAME_NOTE } from '../_shared/magnific-bridge.js';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';
import { ProviderError, aspectOf, magnific, shape } from './providers/magnific.ts';
import { BridgeError, magnificMcp, sseMessages } from './providers/magnific-mcp.ts';

const KEY = 'magnific-test-key-0000';
const U = { admin: '00000000-0000-4000-8000-0000000000b1', add: '00000000-0000-4000-8000-0000000000b2', edit: '00000000-0000-4000-8000-0000000000b3', view: '00000000-0000-4000-8000-0000000000b4', mkt: '00000000-0000-4000-8000-0000000000b5' };
const MEMBERS: Record<string, { uid: string; admin?: unknown; add?: unknown; edit?: unknown; mkt?: unknown }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-add': { uid: U.add, add: 'F' }, 'jwt-edit': { uid: U.edit, edit: 'F' }, 'jwt-view': { uid: U.view, add: 'P', edit: 'P' },
  'jwt-mkt': { uid: U.mkt, mkt: 'F' }, // phase 9.5.1: marketing.create F only
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

type Opts = { seed?: Record<string, any[]>; env?: Record<string, string>; replies?: unknown[]; startDown?: boolean; storage?: Record<string, Uint8Array>; fail?: (c: any) => any; photo?: Uint8Array | null; vault?: Record<string, string | null>; bridge?: any };
function setup({ seed = SEED, env = {}, replies = [], startDown = false, storage = { ...FILES }, fail, photo = PNG, vault, bridge }: Opts = {}) {
  let db: any = null;
  // 0029: the Vault doors of the bridge (service_role) over an in-memory map — the two names only, null removes
  const vaultRpc: Record<string, (args: any) => unknown> = vault ? {
    magnific_secret_get: ({ p_name }: any) => { if (!['magnific_mcp_client', 'magnific_mcp_tokens'].includes(p_name)) throw new Error('unknown secret'); return vault[p_name] ?? null; },
    magnific_secret_set: ({ p_name, p_value }: any) => { if (!['magnific_mcp_client', 'magnific_mcp_tokens'].includes(p_name)) throw new Error('unknown secret'); if (p_value === null) delete vault[p_name]; else vault[p_name] = p_value; return null; },
  } : {};
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
  db = fakeDb(seed, { rpc: startDown ? {} : { ai_image_run_start: start, ...vaultRpc }, storage, fail });
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'products.add' ? m.add ?? 'N' : key === 'products.edit' ? m.edit ?? 'N' : key === 'marketing.create' ? m.mkt ?? 'N' : 'N'), is_admin: () => m.admin ?? false } : {} });
  };
  const asked: any[] = []; const queue = [...replies]; const during: any[] = [];
  const answer = async (kind: string, p: any) => {
    asked.push({ kind, ...structuredClone({ ...p, references: undefined, image: undefined }), refs: (p.references ?? (p.image ? [p.image] : [])).map((r: any) => [r.mime, r.bytes.length]), refUrls: (p.references ?? (p.image ? [p.image] : [])).map((r: any) => r.url ?? null) });
    during.push(db.rows('ai_runs').map((r: any) => [r.status, Number(r.credits), Number(r.cost_usd)]));
    const r = queue.shift(); if (r instanceof Error) throw r; if (r === undefined) throw new Error('no reply queued'); return r as any;
  };
  const provider = { generate: (p: any) => answer('generate', p), edit: (p: any) => answer('edit', p), probe: async () => { const r = queue.shift(); if (r instanceof Error) throw r; return r as any; } };
  const fetched: string[] = []; const fetchInits: any[] = [];
  const fetchFn = (async (url: string, init: any = {}) => { fetched.push(url); fetchInits.push(init); return photo && !/\/gone\b/.test(url) ? new Response(photo as BlobPart, { status: 200, headers: { "content-type": /\.png(\?|$)/.test(url.split('?')[0]) ? "image/png" : "image/jpeg" } }) : new Response("nope", { status: 404 }); }) as any;
  const deps = { env: { ...ENV, MAGNIFIC_API_KEY: KEY, ...env }, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, provider, fetch: fetchFn, bridge };
  return { db, asked, during, deps, storage, fetched, fetchInits };
}
// decision 11: a fake of the Magnific MCP layer — records every call; the tools answer from `tools` (a function a name)
function fakeBridge(tools: Record<string, (args: any) => unknown> = {}, extra: Partial<Record<'refresh' | 'exchangeCode', (...a: any[]) => any>> = {}) {
  const calls: any[] = [];
  const TOKENS = { access_token: 'at-1', refresh_token: 'rt-1', expires_at: '2026-11-02T00:00:00.000Z', account: 'owner@ibtekr.club' };
  const bridge = {
    calls,
    pkce: async () => ({ verifier: 'v'.repeat(64), challenge: 'challenge-1' }),
    authUrl: async (clientId: string, redirectUri: string, state: string, challenge: string) => { calls.push({ op: 'authUrl', clientId, redirectUri, state, challenge }); return `https://auth.test/auth?client_id=${clientId}&state=${state}&code_challenge=${challenge}&redirect_uri=${encodeURIComponent(redirectUri)}`; },
    exchangeCode: async (clientId: string, redirectUri: string, code: string, verifier: string) => { calls.push({ op: 'exchangeCode', clientId, redirectUri, code, verifier }); return extra.exchangeCode ? extra.exchangeCode() : { ...TOKENS }; },
    refresh: async (clientId: string, tokens: any) => { calls.push({ op: 'refresh', clientId, had: tokens.refresh_token }); return extra.refresh ? extra.refresh() : { ...TOKENS, access_token: 'at-2', refresh_token: 'rt-2' }; },
    callTool: async (accessToken: string, name: string, args: any) => { calls.push({ op: 'tool', accessToken, name, args: structuredClone(args) }); const fn = tools[name]; if (!fn) throw new BridgeError('mcp_error', null, 'unknown tool ' + name); return fn(args); },
  };
  return bridge;
}
const LINKED = { magnific_mcp_client: JSON.stringify({ client_id: 'client-1' }), magnific_mcp_tokens: JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_at: '2026-11-02T00:00:00.000Z', account: 'owner@ibtekr.club' }) };
const PROJECT = 'f3b8e918-1fac-49a7-9196-8d22ca637a8e';
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
  assert(asked[0].refUrls.every((u: string) => /^https:\/\/signed\.test\/studio\//.test(u)), 'the references go with signed links of the bucket');
  assertEquals(asked[0].refs, [['image/webp', 8], ['image/webp', 8]], 'the main photo and the reference of this batch; other/x.webp never read');
  assert(asked[0].prompt.includes('Kilim Pouf, made of Cotton, Boho style by the handmade brand Art Craft') && asked[0].prompt.includes('studio background'), asked[0].prompt);
  assertEquals(during[0], [['pending', 75, 0.15]], 'the planned credits are held while the call runs');
  const run = db.rows('ai_runs')[0];
  assertEquals([run.action, run.source, run.label, run.batch_id, run.item_index, run.model, run.status, run.credits, Number(run.cost_usd), run.output], ['image', 'studio', 'Kilim Pouf', SB, 0, 'seedream-5-pro', 'ok', 75, 0.15, { paths: [body.path], bucket: 'studio', provider: 'magnific' }]);
  assertFalse(JSON.stringify(db.rows('ai_runs')).includes('studio background'), 'no prompt in the row');
  assertEquals(db.rows('studio_batches')[0].state, batch().state, 'the batch is not written');
});

// phase 11 (decisions 14 / 15): the tool's provider from the settings row «ai» — a direct provider (openai / gemini) answers instead
// of Magnific, its cost in USD on the content cap (ai_run_start) at 0 credits; the image style of «ai_rules» rides the prompt
Deno.test('providers: settings pick openai for the studio → deps.providers.openai answers, the run row holds USD at 0 credits (the content cap), the style suffix rides the prompt; gemini for the tool; Magnific stays for the campaign; a direct key missing → 503 with the provider', async () => {
  const seed = { ...SEED, settings: [
    { section: 'ai', data: { providers: { image: { default: 'magnific', tools: { studio: 'openai', tool: 'gemini' }, models: { gemini: 'gemini-2.5-flash-image' } } }, monthly_limit_usd: 0.5 } },
    { section: 'ai_rules', data: { style: 'هاندميد دافي', imgNo: ['نصوص مكتوبة'] } }] };
  const direct: any[] = [];
  const mk = (name: string) => ({ generate: async (p: any) => { direct.push({ name, model: p.model, prompt: p.prompt, refs: p.references.length, w: p.width, h: p.height }); return { images: [img()], credits: null }; }, edit: async (p: any) => { direct.push({ name, edit: p.op }); return { images: [img()], credits: null }; }, probe: async () => ({}) });
  const { deps, asked, db } = setup({ seed, replies: [{ images: [img()], credits: 75 }], env: { OPENAI_API_KEY: 'sk-x', GEMINI_API_KEY: 'g-x' } });
  // ai_run_start of the content cap (0024): the reserve against the month's USD
  let spent = 0;
  (deps.db as any).rpc = ((orig) => async (name: string, args: any) => {
    if (name !== 'ai_run_start') return orig(name, args);
    if (args.p_cap != null && spent + args.p_reserve > args.p_cap) { const { data } = await db.from('ai_runs').insert({ created_at: NOW, ...args.p_row, status: 'cap', error: 'ai_cap', credits: 0, cost_usd: 0 }).select('id').single(); return { data: { result: 'cap', id: data.id }, error: null }; }
    spent += args.p_reserve; const { data } = await db.from('ai_runs').insert({ created_at: NOW, ...args.p_row, status: 'pending', credits: 0, cost_usd: args.p_reserve }).select('id').single(); return { data: { result: 'ok', id: data.id }, error: null };
  })((deps.db as any).rpc.bind(deps.db));
  (deps as any).providers = { openai: mk('openai'), gemini: mk('gemini') };
  const g = await call(deps, GEN);
  assertEquals([g.res.status, g.body.provider, g.body.model, g.body.credits, g.body.cost_usd], [200, 'openai', 'gpt-image-2', 0, 0.17], JSON.stringify(g.body));
  assertEquals(direct.length, 1); assertEquals([direct[0].name, direct[0].model, direct[0].refs, direct[0].w, direct[0].h], ['openai', 'gpt-image-2', 2, 700, 800]);
  assert(direct[0].prompt.endsWith(' Style: هاندميد دافي. Never: نصوص مكتوبة'), direct[0].prompt.slice(-80));
  assertEquals(asked.length, 0, 'Magnific not called');
  const run = db.rows('ai_runs').find((r: any) => r.source === 'studio');
  assertEquals([run.model, run.status, Number(run.credits), Number(run.cost_usd), run.output.provider], ['gpt-image-2', 'ok', 0, 0.17, 'openai']);
  // the tool on gemini with the row's model
  const t = await call(deps, { action: 'create', source: 'text', prompt: 'A kilim pouf', shape: 'studio', count: 1 }, 'jwt-add');
  assertEquals([t.res.status, t.body.provider, t.body.model], [200, 'gemini', 'gemini-2.5-flash-image'], JSON.stringify(t.body));
  assertEquals(direct[1].name, 'gemini');
  // the USD cap of the content settings (0.5): 0.17 + 0.04 held, a third gpt-image call (0.17) still passes, then the cap refuses
  const c3 = await call(deps, GEN); assertEquals(c3.res.status, 200);
  const c4 = await call(deps, GEN); assertEquals([c4.res.status, c4.body], [402, { error: 'ai_cap' }]);
  // a direct provider without its key → 503 with the provider named; Magnific (the campaign default) still answers
  const noKey = setup({ seed, replies: [], env: { GEMINI_API_KEY: 'g-x' } }); (noKey.deps as any).providers = { openai: mk('openai'), gemini: mk('gemini') };
  (noKey.deps.db as any).rpc = ((orig) => async (name: string, args: any) => (name === 'ai_run_start' ? { data: { result: 'ok', id: (await db.from('ai_runs').insert({ created_at: NOW, ...args.p_row, status: 'pending' }).select('id').single()).data.id }, error: null } : orig(name, args)))((noKey.deps.db as any).rpc.bind(noKey.deps.db));
  const nk = await call(noKey.deps, GEN);
  assertEquals([nk.res.status, nk.body], [503, { error: 'not_configured', configured: false, provider: 'openai' }]);
});

Deno.test('generate: a color slot adds the color\'s photo and name; the listed model and a social size; the provider\'s silence on credits = the estimate', async () => {
  const { deps, asked, db } = setup({ replies: [{ images: [img(WEBP, 'image/webp')], credits: null }] });
  const { body } = await call(deps, { ...GEN, slot: 'color:BK', model: 'seedream-5-lite', size: '1080x1080' });
  assertEquals([body.credits, body.model], [50, 'seedream-5-lite']);
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
  const r = await call(deps, { action: 'create', source: 'text', shape: 'home', prompt: 'a macrame bag', count: 3, size: '1080x1350', model: 'seedream-5-lite' }, 'jwt-edit');
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

Deno.test('create shape size (decision 15, the images tool): the product\'s photo as the reference, the dimension-drawing words with its numbers (the largest size drawn, the rest in the table), the run labelled «— المقاس»; letters alone → 400 sizes', async () => {
  const { deps, asked, db } = setup({ replies: [{ images: [img()], credits: 75 }] });
  const r = await call(deps, { action: 'create', source: 'image', shape: 'size', product_id: 4001, sizes: ['40×50', '60×90 cm', 'M'], prompt: 'show the strap' }, 'jwt-edit');
  assertEquals([r.res.status, r.body.result, r.body.paths.length, asked[0].refs], [200, 'ok', 1, [['image/jpeg', 11]]]);
  assert(asked[0].prompt.startsWith('A clean technical line-drawing') && asked[0].prompt.includes('"90 CM"') && asked[0].prompt.includes('"60 CM"') && asked[0].prompt.includes('40 × 50 cm') && asked[0].prompt.endsWith('show the strap'), asked[0].prompt);
  assertEquals([db.rows('ai_runs')[0].label, db.rows('ai_runs')[0].product_id], ['Boho Cushion — المقاس', 4001]);
  assertEquals((await call(deps, { action: 'create', source: 'image', shape: 'size', product_id: 4001, sizes: ['M'] }, 'jwt-edit')).body.field, 'sizes');
  assertEquals((await call(deps, { action: 'create', source: 'text', shape: 'size', prompt: 'x', sizes: ['40×50'] }, 'jwt-edit')).body.field, 'source');
});

Deno.test('webp (decision 7): the browser\'s WebP of a result replaces the original under the same name — a tool path in the member\'s own folder (the admin any), a studio path with products.add and its batch; the run row\'s path renamed; RIFF/WEBP bytes only; no credits', async () => {
  const WEBP_FULL = new Uint8Array([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3, 4]);
  const b64 = btoa(String.fromCharCode(...WEBP_FULL));
  const { deps, db, storage } = setup({ replies: [{ images: [img()], credits: 75 }, { images: [img()], credits: 50 }] });
  // a tool result (png) of jwt-add, then its WebP
  const made = await call(deps, { action: 'create', source: 'text', shape: 'home', prompt: 'a bag', model: 'seedream-5-lite' });
  const original = made.body.path as string; assert(original.endsWith('-1.png'), original);
  const runs = db.rows('ai_runs').length;
  const r = await call(deps, { action: 'webp', bucket: 'ai-images', path: original, run_id: made.body.run_id, image: { data: b64 } });
  const target = original.replace(/\.png$/, '.webp');
  assertEquals([r.res.status, r.body], [200, { result: 'ok', bucket: 'ai-images', path: target }]);
  assertEquals([storage['ai-images/' + original], Array.from(storage['ai-images/' + target])], [undefined, Array.from(WEBP_FULL)], 'the WebP under the same name, the original gone');
  assertEquals(db.calls.filter((c: any) => c.op === 'upload').at(-1).args, { path: target, contentType: 'image/webp', upsert: true });
  assertEquals([db.row('ai_runs', made.body.run_id).output.paths, db.rows('ai_runs').length], [[target], runs], 'the row renamed, no new row');
  // not the member's folder (jwt-edit on jwt-add's path), nor products.view; a missing original 404; bytes that are not WebP 400
  assertEquals((await call(deps, { action: 'webp', bucket: 'ai-images', path: target, image: { data: b64 } }, 'jwt-edit')).res.status, 401);
  assertEquals((await call(deps, { action: 'webp', bucket: 'ai-images', path: target, image: { data: b64 } }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'webp', bucket: 'ai-images', path: U.add + '/nothing.png', image: { data: b64 } })).res.status, 404);
  assertEquals((await call(deps, { action: 'webp', bucket: 'ai-images', path: target, image: { data: btoa('not an image at all!') } })).body.field, 'image');
  assertEquals((await call(deps, { action: 'webp', bucket: 'other', path: target, image: { data: b64 } })).body.field, 'bucket');
  assertEquals((await call(deps, { action: 'webp', bucket: 'ai-images', path: '../x.png', image: { data: b64 } })).body.field, 'path');
  // the admin may convert another member's result; a studio path needs products.add and an existing batch; jwt-edit cannot
  const again = await call(deps, { action: 'webp', bucket: 'ai-images', path: target, image: { data: b64 } }, 'jwt-admin');
  assertEquals([again.res.status, again.body.path], [200, target], 'already WebP: rewritten in place (upsert), nothing removed');
  const st = await call(deps, { action: 'webp', bucket: 'studio', path: SB + '/gen-0-0-old.png', image: { data: b64 } });
  assertEquals([st.res.status, st.body.path, storage[`studio/${SB}/gen-0-0-old.png`]], [200, SB + '/gen-0-0-old.webp', undefined]);
  // decision 14: a result the batch points at (a slot) follows the rename in the batch's state
  const slotted = setup({ seed: { studio_batches: [batch({ state: { items: [item({ slots: [SB + '/row1-main.webp', SB + '/gen-0-imp-s-1.png'] })], imgCount: 4 } })] }, storage: { [`studio/${SB}/gen-0-imp-s-1.png`]: new Uint8Array([1, 2, 3]) } });
  const sl = await call(slotted.deps, { action: 'webp', bucket: 'studio', path: SB + '/gen-0-imp-s-1.png', image: { data: b64 } });
  assertEquals(sl.res.status, 200);
  assertEquals(slotted.db.row('studio_batches', SB).state.items[0].slots, [SB + '/row1-main.webp', SB + '/gen-0-imp-s-1.webp'], 'the slot renamed with the object');
  assertEquals(slotted.db.row('studio_batches', SB).state.imgCount, 4, 'the rest of the state as it was');
  assertEquals(slotted.db.writes('studio_batches').length, 1, 'one write for the rename; a path nobody points at writes nothing');
  assertEquals((await call(deps, { action: 'webp', bucket: 'studio', path: SB + '/gen-0-0-old.webp', image: { data: b64 } }, 'jwt-edit')).res.status, 401);
  assertEquals((await call(deps, { action: 'webp', bucket: 'studio', path: 'ffffffff-1d2c-4a8b-9e3f-1234567890ab/gen-0-0-old.png', image: { data: b64 } })).res.status, 404);
  assertFalse(db.rows('ai_runs').some((x: any) => x.action === 'image' && x.credits === 0 && x.status === 'ok'), 'nothing charged for a conversion');
});

Deno.test('import (decision 8): a queued Magnific set — the row\'s owner (or the admin) with the tool permission; links fetched from allowed hosts only, no redirects; stored under the importing member; one ai_runs row (source import, 0 credits); the row ok / partial / error with aligned paths; a partial set is finished next time; ok → 409', async () => {
  const CDN = 'https://pikaso.cdnpk.net/private/production/1/';
  const rows = [
    { id: 1, created_by: U.add, source: 'magnific', folder: 'ابتكر', label: 'Boho Cushion', product_id: 4001, urls: [CDN + 'a.jpg?token=exp=1~hmac=x', CDN + 'b.png?token=t', 'https://evil.test/c.jpg', CDN + 'gone.jpg'], refs: ['A', 'B', 'C', 'D'], status: 'pending', paths: null },
    { id: 2, created_by: U.edit, source: 'magnific', folder: 'ابتكر', label: 'Mug', product_id: null, urls: [CDN + 'm.jpg'], refs: ['M'], status: 'pending', paths: null },
    { id: 3, created_by: U.add, source: 'magnific', folder: null, label: null, product_id: null, urls: [CDN + 'z.jpg'], refs: ['Z'], status: 'ok', paths: [U.add + '/imp-old-1.jpg'] },
  ];
  const { deps, db, storage, fetched, fetchInits } = setup({ seed: { ...SEED, image_imports: rows } });
  assertEquals((await call(deps, { action: 'import', id: 1 }, 'jwt-view')).res.status, 401, 'the tool permission');
  assertEquals((await call(deps, { action: 'import', id: 1 }, 'jwt-edit')).res.status, 401, 'another member\'s row');
  assertEquals((await call(deps, { action: 'import', id: 9 })).res.status, 404);
  assertEquals((await call(deps, { action: 'import', id: 'x' })).body.field, 'id');
  assertEquals((await call(deps, { action: 'import', id: 3 })).res.status, 409, 'already imported');
  const r = await call(deps, { action: 'import', id: 1 });
  assertEquals([r.res.status, r.body.result, r.body.bucket, r.body.imported, r.body.failed, r.body.status, r.body.credits], [200, 'ok', 'ai-images', 2, 2, 'partial', 0]);
  assertEquals(r.body.paths.map((p: string) => p.replace(/imp-[a-z0-9]+-/, 'imp-S-')), [U.add + '/imp-S-1.jpg', U.add + '/imp-S-2.png'], 'the type from the answer, numbered by the link\'s place');
  assertEquals(fetched, [CDN + 'a.jpg?token=exp=1~hmac=x', CDN + 'b.png?token=t', CDN + 'gone.jpg'], 'evil.test never asked; the 404 counted as failed');
  assert(fetchInits.every((i: any) => i.redirect === 'error'));
  assertEquals(Object.keys(storage).filter((k) => k.startsWith('ai-images/')).length, 2);
  const run = db.rows('ai_runs').at(-1);
  assertEquals([run.action, run.source, run.label, run.product_id, run.credits, run.status, run.output.import_id, run.output.failed, run.output.paths.length], ['image', 'import', 'Boho Cushion', 4001, 0, 'ok', 1, 2, 2]);
  const row = db.row('image_imports', 1);
  assertEquals([row.status, row.paths.length, row.paths[2], row.paths[3], row.run_id, row.done_at], ['partial', 4, null, null, run.id, null]);
  // the next call finishes the partial set: the stored links are not fetched again, the bad host stays null, the 404 is retried
  const before = fetched.length;
  const r2 = await call(deps, { action: 'import', id: 1 });
  assertEquals([r2.res.status, r2.body.imported, r2.body.failed, r2.body.status, fetched.slice(before)], [200, 2, 2, 'partial', [CDN + 'gone.jpg']]);
  // the admin may import another member's row — stored under the admin
  const r3 = await call(deps, { action: 'import', id: 2 }, 'jwt-admin');
  assertEquals([r3.res.status, r3.body.status, r3.body.paths[0].startsWith(U.admin + '/imp-')], [200, 'ok', true]);
  assertEquals([db.row('image_imports', 2).status, typeof db.row('image_imports', 2).done_at], ['ok', 'string']);
  // every link failing → 502, the row error, the run row error
  const bad = setup({ seed: { ...SEED, image_imports: [{ id: 5, created_by: U.add, source: 'magnific', urls: ['https://evil.test/a.jpg'], status: 'pending' }] } });
  const r4 = await call(bad.deps, { action: 'import', id: 5 });
  assertEquals([r4.res.status, r4.body.error, bad.db.row('image_imports', 5).status, bad.db.row('image_imports', 5).error, bad.db.rows('ai_runs').at(-1).error], [502, 'ai_error', 'error', 'import_failed', 'import_failed']);
  assertFalse(JSON.stringify(bad.db.rows('ai_runs')).includes('evil.test'), 'no link in a run row');
});

Deno.test('import target studio (decision 9): the queued items become a studio batch of the importing member — the brand and maker named, the type, colors by code (unknown ones kept in unknownColors), Variable → colors × sizes, the photos under the batch in bucket studio (main / ref by their place), step 2; a retry finishes the photos on the same batch; products.add only', async () => {
  const CDN = 'https://pikaso.cdnpk.net/private/production/1/';
  const VENDOR = '33333333-4444-4555-8666-777777777777';
  const items = [
    { nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 350, colors: ['Beige', 'Black', 'Teal'], sizes: ['45×45', '50×50'], material: 'Cotton', style: 'Boho', weight: '0.4', stock: 3, images: [0, 1] },
    { nameEn: 'Stripe Pillow', nameAr: 'مخدة مخططة', vendorPrice: '280', colors: ['Beige'], sizes: [], images: [2, 3] },
  ];
  const rows = [{ id: 11, created_by: U.add, source: 'magnific', folder: 'ابتكر', label: 'دفعة Art Craft', urls: [CDN + 'a.jpg', CDN + 'b.png', CDN + 'gone.jpg', CDN + 'd.jpg'], refs: ['A', 'B', 'C', 'D'], status: 'pending', paths: null,
    target: 'studio', items, brand_id: BRAND, vendor_id: VENDOR, batch_type: 'Variable', batch_id: null }];
  const seed = { ...SEED, image_imports: rows, vendors: [{ id: VENDOR, woo_vendor_id: 7, name: 'Art Craft Store', status: 'active' }] };
  const { deps, db, storage, fetched } = setup({ seed });
  assertEquals((await call(deps, { action: 'import', id: 11 }, 'jwt-edit')).res.status, 401, 'products.edit alone makes no studio batch');
  const r = await call(deps, { action: 'import', id: 11 });
  assertEquals([r.res.status, r.body.target, r.body.bucket, r.body.imported, r.body.failed, r.body.status, r.body.items, r.body.credits], [200, 'studio', 'studio', 3, 1, 'partial', 2, 0]);
  const batch = db.rows('studio_batches').find((b: any) => b.id === r.body.batch_id);
  assert(batch, 'a batch was made');
  assertEquals([batch.title, batch.brand_id, batch.vendor_id, batch.type, batch.step, batch.status, batch.created_by], ['دفعة Art Craft — Variable · ' + NOW.slice(0, 10), BRAND, VENDOR, 'Variable', 2, 'draft', U.add]);
  const st = batch.state;
  assertEquals([st.type, st.brandId, st.brandName, st.vendorId, st.vendorName, st.imgCount, st.imported], ['Variable', BRAND, 'Art Craft', VENDOR, 'Art Craft Store', 4, { import_id: 11, source: 'magnific' }]);
  const [a, b] = st.items;
  assertEquals([a.nameEn, a.nameAr, a.vendorPrice, a.colors, a.unknownColors, a.sizes, a.material, a.style, a.weight, a.stock, a.onDemand, a.categories, a.slots, a.colorImages, a.sheetVariations], ['Boho Cushion', 'مخدة بوهيمي', 350, ['BE', 'BK'], ['Teal'], ['45×45', '50×50'], 'Cotton', 'Boho', '0.4', 3, false, [], [], {}, null]);
  assertEquals(a.variations.map((v: any) => [v.color, v.size, v.vendorPrice]), [['BE', '45×45', 350], ['BE', '50×50', 350], ['BK', '45×45', 350], ['BK', '50×50', 350]]);
  assert(a.main.startsWith(batch.id + '/row1-main-') && a.main.endsWith('.jpg') && a.refs.length === 1 && a.refs[0].startsWith(batch.id + '/row2-ref-') && a.refs[0].endsWith('.png'), JSON.stringify([a.main, a.refs]));
  assertEquals([b.nameEn, b.vendorPrice, b.colors, b.sizes, b.main, b.refs.length, b.variations.map((v: any) => [v.color, v.size])], ['Stripe Pillow', 280, ['BE'], [], null, 1, [['BE', null]]], 'the third link (404) was its main: none yet, the fourth is its reference');
  assertEquals(Object.keys(storage).filter((k) => k.startsWith('studio/' + batch.id + '/')).length, 3);
  const row = db.row('image_imports', 11);
  assertEquals([row.status, row.batch_id, row.paths[2], typeof row.run_id], ['partial', batch.id, null, 'number']);
  assertEquals([db.rows('ai_runs').at(-1).source, db.rows('ai_runs').at(-1).batch_id, db.rows('ai_runs').at(-1).credits, db.rows('ai_runs').at(-1).output.items], ['import', batch.id, 0, 2]);
  // the owner edits nothing; the retry fetches the missing link only, keeps the batch and fills the item's main photo
  const before = fetched.length;
  const r2 = await call(deps, { action: 'import', id: 11 });
  assertEquals([r2.res.status, r2.body.batch_id, r2.body.status, fetched.slice(before)], [200, batch.id, 'partial', [CDN + 'gone.jpg']]);
  assertEquals(db.rows('studio_batches').length, SEED.studio_batches.length + 1, 'no second batch');
  // a Simple set keeps the first color and size and makes no variations; no brand / maker → blank names, the title from the folder
  const simple = setup({ seed: { ...SEED, image_imports: [{ id: 12, created_by: U.admin, source: 'magnific', folder: 'ابتكر', label: null, urls: [CDN + 'x.jpg'], status: 'pending', target: 'studio', items: [{ nameEn: 'Mug', nameAr: 'مج', vendorPrice: 120, colors: ['Black', 'Beige'], sizes: ['S', 'M'], images: [0] }], batch_type: 'Simple' }] } });
  const r3 = await call(simple.deps, { action: 'import', id: 12 }, 'jwt-admin');
  const b3 = simple.db.rows('studio_batches').find((x: any) => x.id === r3.body.batch_id);
  assertEquals([r3.body.status, b3.title, b3.type, b3.brand_id, b3.state.brandName, b3.state.items[0].colors, b3.state.items[0].sizes, b3.state.items[0].variations, b3.state.items[0].main !== null], ['ok', 'ابتكر — Simple · ' + NOW.slice(0, 10), 'Simple', null, '', ['BK'], ['S'], [], true]);
  assertEquals(simple.db.row('image_imports', 12).status, 'ok');
});

Deno.test('share (decision 10 b): a batch\'s product photos become image_shares rows — a week\'s signed link, the product\'s name as the file name, pending; a photo already shared is skipped; products.add and the member\'s own batch; the chosen indexes only', async () => {
  const st = { items: [item({ nameEn: 'Kilim Pouf', main: SB + '/row1-main.webp' }), item({ nameEn: '', nameAr: '../مج: "x"/y\\z', main: SB + '/black.webp' }), item({ nameEn: 'No photo', main: null })] };
  const { deps, db } = setup({ seed: { ...SEED, studio_batches: [batch({ state: st, created_by: U.add })] } });
  assertEquals((await call(deps, { action: 'share', batch_id: SB }, 'jwt-edit')).res.status, 401);
  assertEquals((await call(deps, { action: 'share', batch_id: 'nope' })).body.field, 'batch_id');
  assertEquals((await call(deps, { action: 'share', batch_id: 'ffffffff-1d2c-4a8b-9e3f-1234567890ab' })).res.status, 404);
  const r = await call(deps, { action: 'share', batch_id: SB });
  assertEquals([r.res.status, r.body.shared, r.body.skipped], [200, 2, 1], 'the item without a photo is skipped');
  const rows = db.rows('image_shares');
  assertEquals(rows.map((x: any) => [x.created_by, x.batch_id, x.item_index, x.name, x.path, x.status, x.creation_ref]), [[U.add, SB, 0, 'Kilim Pouf.webp', SB + '/row1-main.webp', 'pending', null], [U.add, SB, 1, '. مج x y z.webp', SB + '/black.webp', 'pending', null]], 'the file name is a strict one: no path parts, quotes or colons');
  assert(rows[0].url.startsWith('https://signed.test/studio/') && Date.parse(rows[0].expires_at) - Date.parse(NOW) === 7 * 24 * 3600 * 1000, 'a week');
  assertEquals(db.calls.filter((c: any) => c.op === 'sign').map((c: any) => c.args.seconds), [604800, 604800]);
  // again: nothing new (already shared); the chosen indexes only on a fresh batch
  const r2 = await call(deps, { action: 'share', batch_id: SB });
  assertEquals([r2.body.shared, r2.body.skipped, db.rows('image_shares').length], [0, 3, 2]);
  const fresh = setup({ seed: { ...SEED, studio_batches: [batch({ state: st })] } });
  assertEquals((await call(fresh.deps, { action: 'share', batch_id: SB, indexes: [1] })).body, { result: 'ok', batch_id: SB, shared: 1, skipped: 0 });
});

Deno.test('import target batch (decision 10 c): the site\'s results land in the product\'s empty slots of the batch they were made for (in order, past imgCount kept); a partial set is finished next time without doubling; products.add and the member\'s own batch', async () => {
  const CDN = 'https://pikaso.cdnpk.net/private/production/1/';
  const st = { imgCount: 4, items: [item({ nameEn: 'Kilim Pouf', main: SB + '/row1-main.webp', slots: [SB + '/row1-main.webp'] }), item({ nameEn: 'Mug', main: SB + '/black.webp', slots: [] })] };
  const rows = [{ id: 21, created_by: U.add, source: 'magnific', folder: 'ابتكر', label: 'نتائج Magnific', urls: [CDN + 'a.jpg', CDN + 'b.png', CDN + 'gone.jpg', CDN + 'd.jpg'], refs: ['A', 'B', 'C', 'D'], status: 'pending', paths: null, target: 'batch', items: [{ index: 0, images: [0, 1, 2] }, { index: 1, images: [3] }, { index: 7, images: [0] }], batch_id: SB }];
  const { deps, db, fetched } = setup({ seed: { ...SEED, studio_batches: [batch({ state: st, created_by: U.add })], image_imports: rows } });
  assertEquals((await call(deps, { action: 'import', id: 21 }, 'jwt-edit')).res.status, 401);
  const r = await call(deps, { action: 'import', id: 21 });
  assertEquals([r.res.status, r.body.target, r.body.batch_id, r.body.imported, r.body.failed, r.body.status, r.body.placed], [200, 'batch', SB, 3, 1, 'partial', 3]);
  const items = db.row('studio_batches', SB).state.items;
  assertEquals(items[0].slots.length, 3); assertEquals(items[0].slots[0], SB + '/row1-main.webp', 'the filled slot stays');
  assert(items[0].slots[1].startsWith(SB + '/gen-0-imp-') && items[0].slots[1].endsWith('-1.jpg') && items[0].slots[2].endsWith('-2.png'));
  assert(items[1].slots[0].startsWith(SB + '/gen-1-imp-') && items[1].slots[0].endsWith('-4.jpg'));
  assertEquals(db.row('image_imports', 21).status, 'partial');
  assertEquals([db.rows('ai_runs').at(-1).source, db.rows('ai_runs').at(-1).batch_id, db.rows('ai_runs').at(-1).output.placed], ['import', SB, 3]);
  // the retry: the missing link only, placed once
  const before = fetched.length;
  const r2 = await call(deps, { action: 'import', id: 21 });
  assertEquals([r2.body.status, r2.body.placed, fetched.slice(before)], ['partial', 0, [CDN + 'gone.jpg']]);
  assertEquals(db.row('studio_batches', SB).state.items[0].slots.length, 3, 'nothing doubled');
});

Deno.test('probe: the admin only; the shape of the provider\'s account answer (keys and types, no values); no key → 503', async () => {
  const { deps } = setup({ replies: [{ credits: 756, plan: { name: 'Premium+' }, list: [1, 2] }] });
  const { res, body } = await call(deps, { action: 'probe' }, 'jwt-admin');
  assertEquals([res.status, body.provider, body.shape, body.models[0]], [200, 'magnific', { credits: 'number', plan: { name: 'string' }, list: { array: 'number' } }, 'seedream-5-pro']);
  // the outcome is a row for the diagnosis (T2): configured, the provider's status, the shape — 0 credits
  const row = deps.db.rows('ai_runs').at(-1);
  assertEquals([row.label, row.status, row.credits, row.output], ['probe', 'ok', 0, { probe: true, configured: true, status: 200, shape: body.shape }]);
  const nokey = setup({ env: { MAGNIFIC_API_KEY: '' } });
  assertEquals((await call(nokey.deps, { action: 'probe' }, 'jwt-admin')).res.status, 503);
  assertEquals([nokey.db.rows('ai_runs').at(-1).error, nokey.db.rows('ai_runs').at(-1).output.configured], ['not_configured', false]);
  const refused = setup({ replies: [new ProviderError('not_configured', 401)] });
  const r4 = await call(refused.deps, { action: 'probe' }, 'jwt-admin');
  assertEquals([r4.res.status, r4.body.status, refused.db.rows('ai_runs').at(-1).output], [503, 401, { probe: true, configured: true, status: 401, detail: null }]);
  assertFalse(JSON.stringify(body).includes('756'));
  const nk = setup({ env: { MAGNIFIC_API_KEY: '' } });
  assertEquals((await call(nk.deps, { action: 'probe' }, 'jwt-admin')).res.status, 503);
});

Deno.test('the Magnific layer (pinned T2): x-magnific-api-key, Seedream text route or -edit route with base64 references + aspect_ratio / resolution, one task an image polled at route/{task_id} until COMPLETED, data.generated downloaded; FAILED → ai_error or refused; 401/403 → not_configured, 429/5xx → busy; the cutout is synchronous on image_url; the upscaler route; no key → no request', async () => {
  const calls: { url: string; method: string; body: any; key: string }[] = [];
  const polls: Record<string, number> = {};
  const fetchFn = (async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, key: init.headers?.['x-magnific-api-key'] ?? '' });
    const m = /^https:\/\/api\.test\/v1\/ai(\/.+?)(?:\/(t\d))?$/.exec(url);
    if (m && init.method === 'POST' && m[1] === '/beta/remove-background') return Response.json({ original: 'https://cdn.test/o.png', high_resolution: 'https://cdn.test/hr.png', url: 'https://cdn.test/u.png' });
    if (m && init.method === 'POST') return Response.json({ data: { task_id: 't' + calls.filter((c) => c.method === 'POST').length, status: 'CREATED', generated: [] } });
    if (m && m[2]) { polls[m[2]] = (polls[m[2]] ?? 0) + 1; return Response.json({ data: { task_id: m[2], status: polls[m[2]] < 2 ? 'IN_PROGRESS' : 'COMPLETED', generated: polls[m[2]] < 2 ? [] : ['https://cdn.test/' + m[2] + '.png'] } }); }
    if (url.startsWith('https://cdn.test/')) return new Response(PNG as BlobPart, { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('?', { status: 404 });
  }) as any;
  const slept: number[] = [];
  const p = magnific({ MAGNIFIC_API_KEY: KEY, MAGNIFIC_API_URL: 'https://api.test/v1/ai/' }, fetchFn, async (ms) => { slept.push(ms); });
  // words → the text route, two images = two tasks
  const t2 = await p.generate({ model: 'seedream-5-pro', prompt: 'x', width: 1080, height: 1920, count: 2, references: [] });
  assertEquals([t2.credits, t2.images.length, t2.images[0].mime], [null, 2, 'image/png']);
  const posts = calls.filter((c) => c.method === 'POST');
  assertEquals(posts.map((c) => c.url), ['https://api.test/v1/ai/text-to-image/seedream-v5-pro', 'https://api.test/v1/ai/text-to-image/seedream-v5-pro']);
  assertEquals(posts[0].body, { prompt: 'x', aspect_ratio: 'social_story_9_16', resolution: '2k' }); assertEquals(posts[0].key, KEY);
  assert(calls.some((c) => c.url === 'https://api.test/v1/ai/text-to-image/seedream-v5-pro/t1' && c.method === 'GET'), 'polled at the route');
  assertEquals(slept, [2500, 2500, 2500, 2500]);
  // a reference → the -edit route with raw base64, the product ratio
  calls.length = 0;
  const i2i = await p.generate({ model: 'seedream-5-pro', prompt: 'y', width: 700, height: 800, count: 1, references: [{ bytes: WEBP, mime: 'image/webp' }, { bytes: PNG, mime: 'image/png', url: 'https://signed.test/studio/b.png?token=t' }] });
  assertEquals(i2i.images.length, 1);
  assertEquals(calls[0].url, 'https://api.test/v1/ai/text-to-image/seedream-v5-pro-edit');
  assertEquals(calls[0].body, { prompt: 'y', reference_images: [btoa(String.fromCharCode(...WEBP)), 'https://signed.test/studio/b.png?token=t'], aspect_ratio: 'portrait_2_3', resolution: '1.5k' }, 'a signed link goes as it is, bytes as base64');
  // Gemini: one route for both, no ratio fields
  calls.length = 0;
  await p.generate({ model: 'gemini-2-5-flash', prompt: 'z', width: 1080, height: 1080, count: 1, references: [{ bytes: PNG, mime: 'image/png' }] });
  assertEquals([calls[0].url, Object.keys(calls[0].body)], ['https://api.test/v1/ai/gemini-2-5-flash-image-preview', ['prompt', 'reference_images']]);
  // the edits: a cutout on the signed URL (synchronous, high_resolution first), the upscaler route, an instruction on the edit route
  calls.length = 0;
  const cut = await p.edit({ model: 'seedream-5-pro', op: 'remove_bg', prompt: '', image: { bytes: PNG, mime: 'image/png' }, imageUrl: 'https://signed.test/studio/a.webp?token=t', options: { bg: 'transparent' } });
  assertEquals([calls[0].url, calls[0].body, calls[1].url, cut.images.length], ['https://api.test/v1/ai/beta/remove-background', { image_url: 'https://signed.test/studio/a.webp?token=t' }, 'https://cdn.test/hr.png', 1]);
  calls.length = 0;
  await p.edit({ model: 'seedream-5-pro', op: 'upscale', prompt: '', image: { bytes: PNG, mime: 'image/png' }, options: { scale: 4 } });
  assertEquals([calls[0].url, calls[0].body.scale_factor, typeof calls[0].body.image], ['https://api.test/v1/ai/image-upscaler', '4x', 'string']);
  calls.length = 0;
  await p.edit({ model: 'seedream-5-lite', op: 'instruction', prompt: 'lighter', image: { bytes: PNG, mime: 'image/png' }, options: {} });
  assertEquals(calls[0].url, 'https://api.test/v1/ai/text-to-image/seedream-v5-lite-edit');
  try { await p.edit({ model: 'seedream-5-pro', op: 'remove_bg', prompt: '', image: { bytes: PNG, mime: 'image/png' }, imageUrl: null, options: {} }); assert(false); } catch (e) { assertEquals((e as ProviderError).kind, 'ai_error'); }
  // the statuses
  let lastErr: ProviderError | null = null;
  const status = async (code: number, body: any = {}) => { try { await magnific({ MAGNIFIC_API_KEY: KEY }, (async () => Response.json(body, { status: code })) as any).generate({ model: 'seedream-5-pro', prompt: 'x', width: 1, height: 1, count: 1, references: [] }); return 'ok'; } catch (e) { lastErr = e as ProviderError; return (e as ProviderError).kind; } };
  assertEquals(await status(401), 'not_configured'); assertEquals(await status(403), 'not_configured'); assertEquals(await status(429), 'busy'); assertEquals(await status(500), 'busy');
  assertEquals(await status(422, { message: 'invalid' }), 'refused'); assertEquals(await status(400, { message: 'bad' }), 'ai_error');
  assertEquals(await status(402, { message: 'Insufficient credits' }), 'ai_error'); assertEquals([lastErr!.status, lastErr!.detail], [402, 'message :: Insufficient credits | Insufficient credits'], 'the provider\'s words on a 402 reach the row');
  assertEquals(await status(200, { data: { status: 'FAILED', error: 'content policy violation' } }), 'refused');
  assertEquals(await status(200, { data: { status: 'FAILED', error: 'oops' } }), 'ai_error');
  assertEquals(lastErr!.detail, 'data / data:status,error :: oops | FAILED', 'the failure keeps a safe word for the diagnosis row');
  assertEquals(await status(200, { data: { status: 'COMPLETED', generated: [] } }), 'ai_error');
  assertEquals(lastErr!.detail, 'no image: data / data:status,generated :: COMPLETED');
  assertEquals(await status(400, { message: 'bad: ' + 'A'.repeat(500) }), 'ai_error');
  assertEquals([lastErr!.status, lastErr!.detail], [400, 'message :: bad: <b64> | bad: <b64>'], 'long base64 never lands in the detail');
  let hit = false;
  try { await magnific({}, (async () => { hit = true; return Response.json({}); }) as any).probe(); } catch (e) { assertEquals((e as ProviderError).kind, 'not_configured'); }
  assertFalse(hit);
  assertEquals(aspectOf(1080, 1080), 'square_1_1'); assertEquals(aspectOf(1200, 630), 'widescreen_16_9'); assertEquals(aspectOf(1080, 1350), 'portrait_2_3');
  assertEquals(shape({ a: 1, b: 'x', c: { d: [1], e: { f: 1 } }, g: [] }), { a: 'number', b: 'string', c: { d: 'array', e: 'object' }, g: { array: 'empty' } });
});

// ---------------------------------------------------------------- decision 11: the bridge (the system as the site's MCP client)

Deno.test('bridge_status / bridge_link / bridge_callback / bridge_unlink: the tool\'s members see linked only, the admin the account; the sign-in url carries the client, the redirect, a state kept with its verifier (ten minutes, spent once); the code becomes the tokens in Vault; unlink removes them', async () => {
  const vault: Record<string, string | null> = { magnific_mcp_client: LINKED.magnific_mcp_client };
  const bridge = fakeBridge();
  const { deps, db } = setup({ vault, bridge });
  assertEquals((await call(deps, { action: 'bridge_status' }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'bridge_status' }, 'jwt-add')).body, { result: 'ok', linked: false, project: PROJECT });
  assertEquals((await call(deps, { action: 'bridge_status' }, 'jwt-admin')).body, { result: 'ok', linked: false, project: PROJECT, account: null, configured: true, redirect: 'https://operation-system.ibtekr.club/magnific-callback.html' });
  assertEquals((await call(deps, { action: 'bridge_link' }, 'jwt-add')).res.status, 401);
  const link = await call(deps, { action: 'bridge_link' }, 'jwt-admin');
  assertEquals(link.res.status, 200);
  const state = db.rows('magnific_oauth_states')[0];
  assertEquals([state.verifier, state.created_by, state.used_at], ['v'.repeat(64), U.admin, null]);
  assert(/^[A-Za-z0-9_-]{43}$/.test(state.state), 'a random url-safe state');
  assertEquals(link.body.url, `https://auth.test/auth?client_id=client-1&state=${state.state}&code_challenge=challenge-1&redirect_uri=${encodeURIComponent('https://operation-system.ibtekr.club/magnific-callback.html')}`);
  // the callback: a wrong state, then the right one (spent), then the same again
  assertEquals((await call(deps, { action: 'bridge_callback', code: 'code-12345678', state: 'x'.repeat(40) }, 'jwt-admin')).body, { error: 'bad_request', field: 'state' });
  assertEquals((await call(deps, { action: 'bridge_callback', code: 'bad code', state: state.state }, 'jwt-admin')).body, { error: 'bad_request', field: 'code' });
  const cb = await call(deps, { action: 'bridge_callback', code: 'code-12345678', state: state.state }, 'jwt-admin');
  assertEquals(cb.body, { result: 'ok', linked: true, account: 'owner@ibtekr.club' });
  assertEquals(bridge.calls.at(-1), { op: 'exchangeCode', clientId: 'client-1', redirectUri: 'https://operation-system.ibtekr.club/magnific-callback.html', code: 'code-12345678', verifier: 'v'.repeat(64) });
  assertEquals(JSON.parse(vault.magnific_mcp_tokens!).access_token, 'at-1');
  assertEquals(db.rows('magnific_oauth_states')[0].used_at, NOW);
  assertEquals((await call(deps, { action: 'bridge_callback', code: 'code-12345678', state: state.state }, 'jwt-admin')).body, { error: 'bad_request', field: 'state' }, 'a state is spent once');
  assertEquals((await call(deps, { action: 'bridge_status' }, 'jwt-admin')).body.account, 'owner@ibtekr.club');
  assertEquals((await call(deps, { action: 'bridge_status' }, 'jwt-add')).body, { result: 'ok', linked: true, project: PROJECT }, 'a member never sees the account');
  // an old state is refused
  await db.from('magnific_oauth_states').insert({ state: 'o'.repeat(43), verifier: 'v'.repeat(64), created_by: U.admin, created_at: '2026-10-25T11:00:00.000Z' });
  assertEquals((await call(deps, { action: 'bridge_callback', code: 'code-12345678', state: 'o'.repeat(43) }, 'jwt-admin')).body, { error: 'bad_request', field: 'state' });
  // a refused code
  const refusing = fakeBridge({}, { exchangeCode: () => { throw new BridgeError('refused', 400, 'invalid_grant'); } });
  const d2 = setup({ vault: { magnific_mcp_client: LINKED.magnific_mcp_client }, bridge: refusing });
  const l2 = await call(d2.deps, { action: 'bridge_link' }, 'jwt-admin');
  assertEquals((await call(d2.deps, { action: 'bridge_callback', code: 'code-12345678', state: new URL(l2.body.url).searchParams.get('state') }, 'jwt-admin')).body, { error: 'refused', status: 400, detail: 'invalid_grant' });
  // unlink; no client registered → not_configured
  assertEquals((await call(deps, { action: 'bridge_unlink' }, 'jwt-add')).res.status, 401);
  assertEquals((await call(deps, { action: 'bridge_unlink' }, 'jwt-admin')).body, { result: 'ok', linked: false });
  assertEquals(vault.magnific_mcp_tokens, undefined);
  const d3 = setup({ vault: {}, bridge: fakeBridge() });
  assertEquals((await call(d3.deps, { action: 'bridge_link' }, 'jwt-admin')).body, { error: 'not_configured', configured: false });
  assertEquals((await call(d3.deps, { action: 'bridge_status' }, 'jwt-admin')).body.configured, false);
});

Deno.test('bridge_upload: not linked → 503 not_linked; linked → each product photo not sent yet goes up now (a ten-minute link, the product\'s name, the project) and gets a sent row with the creation\'s identifier; a failed one an error row; again → skipped; an ending token is refreshed first; the account refusing the refresh unlinks', async () => {
  const vault: Record<string, string | null> = { ...LINKED };
  let n = 0;
  const bridge = fakeBridge({ creations_upload_image: ({ fileName }: any) => { n++; if (/Pouf/.test(fileName) && n === 2) throw new BridgeError('mcp_error', null, 'upload failed'); return { identifier: 'NEW' + n, url: 'https://pikaso.cdnpk.net/p/' + n + '.jpg' }; } });
  const seed = { ...SEED, studio_batches: [batch({ created_by: U.add, state: { items: [item(), item({ nameEn: 'Clay Mug', main: SB + '/row2-main.webp', refs: [] }), item({ nameEn: 'No photo', main: null })] } })] };
  const storage = { ...FILES, [`studio/${SB}/row2-main.webp`]: WEBP };
  const nl = setup({ vault: { magnific_mcp_client: LINKED.magnific_mcp_client }, bridge, seed, storage });
  assertEquals((await call(nl.deps, { action: 'bridge_upload', batch_id: SB })).body, { error: 'not_linked', status: null, detail: null });
  assertEquals(nl.db.rows('image_shares').length, 0);
  const { deps, db } = setup({ vault, bridge, seed, storage });
  assertEquals((await call(deps, { action: 'bridge_upload', batch_id: SB }, 'jwt-edit')).res.status, 401);
  assertEquals((await call(deps, { action: 'bridge_upload', batch_id: SB }, 'jwt-view')).res.status, 401);
  assertEquals((await call(deps, { action: 'bridge_upload', batch_id: 'nope' })).body.field, 'batch_id');
  const r = await call(deps, { action: 'bridge_upload', batch_id: SB });
  assertEquals(r.body, { result: 'ok', batch_id: SB, uploaded: 2, failed: 0, skipped: 1, stopped: null });
  const tools = bridge.calls.filter((c) => c.op === 'tool');
  assertEquals(tools.map((c) => [c.accessToken, c.name, c.args.fileName, c.args.folderReference]), [['at-1', 'creations_upload_image', 'Kilim Pouf.webp', PROJECT], ['at-1', 'creations_upload_image', 'Clay Mug.webp', PROJECT]]);
  assertEquals(tools[0].args.url, `https://signed.test/studio/${SB}/row1-main.webp?token=t`);
  const rows = db.rows('image_shares');
  assertEquals(rows.map((x: any) => [x.item_index, x.name, x.status, x.creation_ref, x.sent_at, x.created_by]), [[0, 'Kilim Pouf.webp', 'sent', 'NEW1', NOW, U.add], [1, 'Clay Mug.webp', 'sent', 'NEW2', NOW, U.add]]);
  assertEquals(Date.parse(rows[0].expires_at) - Date.parse(NOW), 600_000, 'a ten-minute link');
  assertEquals(db.calls.filter((c: any) => c.op === 'sign').map((c: any) => c.args.seconds), [600, 600]);
  // again: nothing new; the chosen index of a fresh batch, whose upload fails → an error row
  assertEquals((await call(deps, { action: 'bridge_upload', batch_id: SB })).body, { result: 'ok', batch_id: SB, uploaded: 0, failed: 0, skipped: 3, stopped: null });
  n = 1;
  const fresh = setup({ vault: { ...LINKED }, bridge, seed, storage });
  assertEquals((await call(fresh.deps, { action: 'bridge_upload', batch_id: SB, indexes: [0] })).body, { result: 'ok', batch_id: SB, uploaded: 0, failed: 1, skipped: 0, stopped: null });
  assertEquals(fresh.db.rows('image_shares').map((x: any) => [x.status, x.error, x.creation_ref]), [['error', 'mcp_error: upload failed', null]]);
  assertEquals((await call(fresh.deps, { action: 'bridge_upload', batch_id: SB, indexes: [0] })).body.uploaded, 1, 'a failed photo is tried again');
  // the token ends within a minute → refreshed first, the new set replaces the secret; a refused refresh → unlinked
  const ending = { ...LINKED, magnific_mcp_tokens: JSON.stringify({ access_token: 'at-old', refresh_token: 'rt-1', expires_at: '2026-10-25T12:00:30.000Z', account: 'owner@ibtekr.club' }) };
  const v2: Record<string, string | null> = { ...ending }; const b2 = fakeBridge({ creations_upload_image: () => ({ identifier: 'X1' }) });
  const e2 = setup({ vault: v2, bridge: b2, seed, storage });
  assertEquals((await call(e2.deps, { action: 'bridge_upload', batch_id: SB, indexes: [1] })).body.uploaded, 1);
  assertEquals(b2.calls.map((c) => c.op), ['refresh', 'tool']);
  assertEquals([b2.calls[0].had, b2.calls[1].accessToken, JSON.parse(v2.magnific_mcp_tokens!).refresh_token, JSON.parse(v2.magnific_mcp_tokens!).account], ['rt-1', 'at-2', 'rt-2', 'owner@ibtekr.club']);
  const v3: Record<string, string | null> = { ...ending }; const b3 = fakeBridge({}, { refresh: () => { throw new BridgeError('refused', 400, 'invalid_grant'); } });
  const e3 = setup({ vault: v3, bridge: b3, seed, storage });
  assertEquals((await call(e3.deps, { action: 'bridge_upload', batch_id: SB })).body.error, 'not_linked');
  assertEquals(v3.magnific_mcp_tokens, undefined, 'a dead refresh token unlinks the account');
  // the server busy mid-way: the rows so far stay, the answer says so
  let k = 0; const b4 = fakeBridge({ creations_upload_image: () => { k++; if (k === 2) throw new BridgeError('busy', 503); return { identifier: 'B' + k }; } });
  const e4 = setup({ vault: { ...LINKED }, bridge: b4, seed, storage });
  assertEquals((await call(e4.deps, { action: 'bridge_upload', batch_id: SB })).body, { result: 'ok', batch_id: SB, uploaded: 1, failed: 0, skipped: 0, stopped: 'busy' });
});

Deno.test('bridge_fetch: no sent photo → nothing; the project\'s new creations (not uploads, not sources, not imported) matched by lineage, then family, then name → one image_imports row of target batch imported into the product slots now; a second call finds nothing new; an unmatched result is counted', async () => {
  const FAM1 = 'fam-0001', FAM2 = 'fam-0002';
  const search = (page: number) => ({ from: 'project-root', items: page === 1 ? [
    { identifier: 'SRC1', name: 'Kilim Pouf', family: FAM1, tool: 'upload', url: 'https://pikaso.cdnpk.net/p/src1.jpg' },
    { identifier: 'SRC2', name: 'Clay Mug', family: FAM2, tool: 'upload', url: 'https://pikaso.cdnpk.net/p/src2.jpg' },
    { identifier: 'R1', name: 'Kilim Pouf', family: 'other', tool: 'imagen-nano-banana-2', url: 'https://pikaso.cdnpk.net/p/r1.png' },
    { identifier: 'R2', name: 'untitled', family: FAM2, tool: 'imagen-nano-banana-2', url: 'https://pikaso.cdnpk.net/p/r2.png' },
  ] : [
    { identifier: 'R3', name: 'Clay Mug on a shelf', family: '', tool: 'seedream-5-pro', url: 'https://pikaso.cdnpk.net/p/r3.png' },
    { identifier: 'R4', name: 'a lamp', family: '', tool: 'seedream-5-pro', url: 'https://pikaso.cdnpk.net/p/r4.png', metadata: { prompt: 'a lamp' } },
    { identifier: 'R5', name: 'elsewhere', family: FAM1, tool: 'seedream-5-pro', url: 'https://elsewhere.test/r5.png' },
  ], pagination: { currentPage: page, lastPage: 2 } });
  const bridge = fakeBridge({
    creations_search: ({ page }: any) => search(page),
    creations_lineage: ({ creationIdentifier }: any) => ({ data: { root: creationIdentifier, nodes: creationIdentifier === 'R1' ? [{ identifier: 'R1' }, { identifier: 'SRC1' }] : [{ identifier: creationIdentifier }], edges: [] } }),
  });
  const items = [item({ slots: [SB + '/gen-0-0-old.png'] }), item({ nameEn: 'Clay Mug', main: SB + '/row2-main.webp', refs: [], slots: [] })];
  const seed = { ...SEED, studio_batches: [batch({ created_by: U.add, state: { items, imgCount: 4 } })],
    image_shares: [{ id: 1, created_by: U.add, batch_id: SB, item_index: 0, name: 'Kilim Pouf.webp', path: SB + '/row1-main.webp', url: 'https://s/1', expires_at: NOW, status: 'sent', creation_ref: 'SRC1', sent_at: NOW },
      { id: 2, created_by: U.add, batch_id: SB, item_index: 1, name: 'Clay Mug.webp', path: SB + '/row2-main.webp', url: 'https://s/2', expires_at: NOW, status: 'sent', creation_ref: 'SRC2', sent_at: NOW },
      { id: 3, created_by: U.add, batch_id: SB, item_index: 1, name: 'x.webp', path: SB + '/x.webp', url: 'https://s/3', expires_at: NOW, status: 'error', creation_ref: null }] };
  const none = setup({ vault: { ...LINKED }, bridge, seed: { ...seed, image_shares: [] } });
  assertEquals((await call(none.deps, { action: 'bridge_fetch', batch_id: SB })).body, { result: 'ok', batch_id: SB, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok' });
  assertEquals(bridge.calls.length, 0, 'no call to the site without a sent photo');
  const { deps, db, fetched } = setup({ vault: { ...LINKED }, bridge, seed });
  assertEquals((await call(deps, { action: 'bridge_fetch', batch_id: SB }, 'jwt-edit')).res.status, 401);
  const r = await call(deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals(r.res.status, 200);
  assertEquals([r.body.result, r.body.target, r.body.found, r.body.unmatched, r.body.placed, r.body.imported, r.body.failed, r.body.status], ['ok', 'batch', 4, 1, 3, 3, 0, 'ok'], 'R5 (a link off the allowed hosts) is neither found nor fetched');
  const names = bridge.calls.filter((c) => c.op === 'tool').map((c) => c.name + (c.args.page ? ' p' + c.args.page : c.args.creationIdentifier ? ' ' + c.args.creationIdentifier : ''));
  assertEquals(names, ['creations_search p1', 'creations_search p2', 'creations_lineage R1', 'creations_lineage R2', 'creations_lineage R3', 'creations_lineage R4'], 'the families came with the search: no creations_get');
  assertEquals(bridge.calls[0].args, { from: 'project-root', reference: PROJECT, fileType: 'image', full: true, perPage: 50, page: 1 });
  const imp = db.rows('image_imports')[0];
  assertEquals([imp.created_by, imp.source, imp.folder, imp.label, imp.target, imp.batch_id, imp.status], [U.add, 'magnific', 'ابتكر', 'نتائج Magnific — دفعة', 'batch', SB, 'ok']);
  assertEquals([imp.urls, imp.refs, imp.items], [['https://pikaso.cdnpk.net/p/r1.png', 'https://pikaso.cdnpk.net/p/r2.png', 'https://pikaso.cdnpk.net/p/r3.png'], ['R1', 'R2', 'R3'], [{ index: 0, images: [0] }, { index: 1, images: [1, 2] }]]);
  const state = db.rows('studio_batches')[0].state;
  assertEquals(state.items[0].slots.length, 2); assertEquals(state.items[1].slots.length, 2);
  assert(state.items[0].slots[0] === SB + '/gen-0-0-old.png' && /gen-0-imp-.*-1\.png$/.test(state.items[0].slots[1]), 'the pouf keeps its old slot, gets R1 next');
  assert(/gen-1-imp-.*-2\.png$/.test(state.items[1].slots[0]) && /gen-1-imp-.*-3\.png$/.test(state.items[1].slots[1]), 'the mug gets R2 and R3');
  assertEquals(fetched.filter((u) => /pikaso/.test(u)).length, 3);
  assertEquals(db.rows('ai_runs').map((x: any) => [x.source, x.credits, x.output.placed]), [['import', 0, 3]]);
  // again: the imported refs are known → nothing new (R4 still unmatched, R5 still off-host)
  bridge.calls.length = 0;
  const r2 = await call(deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals([r2.body.found, r2.body.placed, r2.body.unmatched, db.rows('image_imports').length], [1, 0, 1, 1]);
  assertEquals(bridge.calls.filter((c) => c.op === 'tool' && c.name === 'creations_lineage').length, 1, 'R4 only');
});

Deno.test('magnificMcp (the real layer against a fake fetch): discovery, PKCE, the sign-in url, the code exchange + userinfo, the refresh, and a tools/call over a JSON or an SSE answer with the session header; the statuses', async () => {
  const calls: any[] = [];
  const answers: Record<string, (init: any) => Response> = {
    'https://auth.test/realms/mcp/.well-known/openid-configuration': () => Response.json({ authorization_endpoint: 'https://auth.test/realms/mcp/auth', token_endpoint: 'https://auth.test/realms/mcp/token', userinfo_endpoint: 'https://auth.test/realms/mcp/userinfo' }),
    'https://auth.test/realms/mcp/token': (init) => { const f = new URLSearchParams(init.body); return f.get('grant_type') === 'refresh_token' ? Response.json({ access_token: 'at-2', expires_in: 300 }) : f.get('code') === 'bad' ? Response.json({ error: 'invalid_grant', error_description: 'Code not valid' }, { status: 400 }) : Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 }); },
    'https://auth.test/realms/mcp/userinfo': () => Response.json({ sub: 'u1', email: 'owner@ibtekr.club' }),
  };
  let sse = false; let fail: number | null = null;
  const fetchFn = (async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : null });
    if (answers[url]) return answers[url](init);
    if (url === 'https://mcp.test/') {
      if (fail) return new Response('{}', { status: fail });
      const msg = JSON.parse(init.body);
      if (msg.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'magnific' } } }, { headers: { 'mcp-session-id': 'sess-1' } });
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = msg.params.name === 'creations_upload_image' ? { content: [{ type: 'text', text: 'identifier: NEW9\nurl: "https://pikaso.cdnpk.net/x.jpg?token=a~b"' }] } : msg.params.name === 'bad' ? { isError: true, content: [{ type: 'text', text: 'Folder not found' }] } : { structuredContent: { items: [{ identifier: 'A' }] }, content: [] };
      const body = { jsonrpc: '2.0', id: msg.id, result };
      return sse ? new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(body);
    }
    return new Response('nope', { status: 404 });
  }) as any;
  const m = magnificMcp({ MAGNIFIC_MCP_URL: 'https://mcp.test', MAGNIFIC_AUTH_URL: 'https://auth.test/realms/mcp' }, fetchFn);
  const { verifier, challenge } = await m.pkce();
  assert(verifier.length === 64 && /^[A-Za-z0-9_-]+$/.test(verifier) && /^[A-Za-z0-9_-]{43}$/.test(challenge));
  const url = new URL(await m.authUrl('client-1', 'https://ops.test/cb.html', 'state-1', challenge));
  assertEquals([url.origin + url.pathname, url.searchParams.get('response_type'), url.searchParams.get('client_id'), url.searchParams.get('redirect_uri'), url.searchParams.get('code_challenge_method'), url.searchParams.get('code_challenge'), url.searchParams.get('resource')],
    ['https://auth.test/realms/mcp/auth', 'code', 'client-1', 'https://ops.test/cb.html', 'S256', challenge, 'https://mcp.test']);
  assert(url.searchParams.get('scope')!.includes('offline_access') && url.searchParams.get('scope')!.includes('mcp:custom-audience'));
  const t = await m.exchangeCode('client-1', 'https://ops.test/cb.html', 'code-1', verifier);
  assertEquals([t.access_token, t.refresh_token, t.account, Date.parse(t.expires_at) > Date.now() + 1000 * 1700], ['at-1', 'rt-1', 'owner@ibtekr.club', true]);
  const form = new URLSearchParams(calls.find((c) => c.url.endsWith('/token')).body);
  assertEquals([form.get('grant_type'), form.get('code_verifier'), form.get('client_id'), form.get('redirect_uri')], ['authorization_code', verifier, 'client-1', 'https://ops.test/cb.html']);
  const t2 = await m.refresh('client-1', t);
  assertEquals([t2.access_token, t2.refresh_token, t2.account], ['at-2', 'rt-1', 'owner@ibtekr.club'], 'a refresh without a new refresh token keeps the old one and the account');
  try { await m.exchangeCode('client-1', 'https://ops.test/cb.html', 'bad', verifier); assert(false); } catch (e) { assertEquals([(e as BridgeError).kind, (e as BridgeError).status, (e as BridgeError).detail], ['refused', 400, 'error,error_description :: invalid_grant | Code not valid']); }
  // a tool call: initialize (no session) → initialized (the session header) → tools/call; JSON and SSE answers alike; the text read as data
  calls.length = 0;
  const up = await m.callTool('at-1', 'creations_upload_image', { url: 'https://s/1', fileName: 'a.jpg', folderReference: 'f' });
  assertEquals(up, { identifier: 'NEW9', url: 'https://pikaso.cdnpk.net/x.jpg?token=a~b' });
  assertEquals(calls.map((c) => [c.body?.method, c.headers['Mcp-Session-Id'] ?? null, c.headers.Authorization, c.headers['MCP-Protocol-Version']]), [['initialize', null, 'Bearer at-1', '2025-06-18'], ['notifications/initialized', 'sess-1', 'Bearer at-1', '2025-06-18'], ['tools/call', 'sess-1', 'Bearer at-1', '2025-06-18']]);
  assertEquals(calls[2].body.params, { name: 'creations_upload_image', arguments: { url: 'https://s/1', fileName: 'a.jpg', folderReference: 'f' } });
  sse = true;
  assertEquals(await m.callTool('at-1', 'creations_search', {}), { items: [{ identifier: 'A' }] }, 'structuredContent first, over SSE');
  try { await m.callTool('at-1', 'bad', {}); assert(false); } catch (e) { assertEquals([(e as BridgeError).kind, (e as BridgeError).detail], ['mcp_error', 'Folder not found']); }
  fail = 401; try { await m.callTool('at-1', 'x', {}); assert(false); } catch (e) { assertEquals((e as BridgeError).kind, 'not_linked'); }
  fail = 503; try { await m.callTool('at-1', 'x', {}); assert(false); } catch (e) { assertEquals((e as BridgeError).kind, 'busy'); }
  assertEquals(sseMessages('event: message\ndata: {"id":1}\n\ndata: not json\n\ndata: {"id":2,\ndata: "x":1}\n\n'), [{ id: 1 }, { id: 2, x: 1 }]);
  let touched = false;
  try { await magnificMcp({ MAGNIFIC_AUTH_URL: 'https://auth.test/realms/mcp' }, (async () => { touched = true; throw new Error('down'); }) as any).authUrl('c', 'r', 's', 'ch'); assert(false); } catch (e) { assertEquals((e as BridgeError).kind, 'busy'); }
  assert(touched);
});

// ---------------------------------------------------------------- decision 12: one Space, a flow a batch, the category prompts

const NID = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const TEMPLATE = 'a24c0027-cdcc-461c-bc94-74a2a275c599';
function flowBridge(extra: Record<string, (args: any) => unknown> = {}) {
  let nodeSeq = 100; const spaces: any[] = []; const pages: any[] = []; const created: any[] = []; const connections: any[] = [];
  const outputs: Record<string, string[]> = {}; // out node id → the creation ids the site produced
  const tools: Record<string, (args: any) => unknown> = {
    spaces_state: ({ spaceId, pageId }: any) => spaceId === TEMPLATE ? (pageId ? { board: { uuid: TEMPLATE }, nodes: [] } : {
      board: { uuid: TEMPLATE, elementsCount: 5 }, pages: [{ id: '1', name: 'Home' }, { id: 'p2', name: 'Decor' }],
      nodes: [
        { id: NID(1), type: 'image-generator', name: 'كرسي 1 — تركيز على المنتج', x: 0, y: 0, pageId: '1' },
        { id: NID(2), type: 'image-generator', name: 'كرسي 2 — المنتج في بيئة محيطة', x: 0, y: 600, pageId: '1' },
        { id: NID(3), type: 'image-generator', name: 'كرسي 3 — Closeup للتفاصيل #2', x: 0, y: 1200, pageId: '1' },
        { id: NID(4), type: 'image-generator', name: 'مرآة 1 — تركيز على المنتج', x: 0, y: 0, pageId: 'p2' },
        { id: NID(5), type: 'list', name: 'قائمة', x: 0, y: 0, pageId: '1' }],
    }) : { board: { uuid: spaceId }, nodes: [] },
    spaces_get_nodes: ({ nodeIds }: any) => ({ nodes: [], nodeData: nodeIds.flatMap((id: string) => id === NID(1) ? [{ elementId: id, key: 'prompt', value: 'CHAIR FOCUS' }, { elementId: id, key: 'mode', value: 'imagen-nano-banana-2' }, { elementId: id, key: 'aspectRatio', value: '3:4' }, { elementId: id, key: 'resolution', value: '1k' }, { elementId: id, key: 'negativePrompt', value: 'people, text' }]
      : id === NID(2) ? [{ elementId: id, key: 'prompt', value: 'CHAIR ENV' }] : id === NID(3) ? [{ elementId: id, key: 'prompt', value: 'CHAIR DETAIL' }] : id === NID(4) ? [{ elementId: id, key: 'prompt', value: 'MIRROR FOCUS' }]
      : outputs[id] ? [{ elementId: id, key: 'itemType', value: 'image' }, { elementId: id, key: 'items', value: JSON.stringify(outputs[id].map((c) => ({ type: 'image', creationIdentifier: c }))) }] : []) }),
    spaces_create: ({ name, projectReference }: any) => { const id = 'a3000000-0000-4000-8000-' + String(spaces.length + 1).padStart(12, '0'); spaces.push({ id, name, projectReference }); return { space: { id, name, webUrl: 'https://www.magnific.com/app/spaces/' + id + '?utm_source=mcp' } }; },
    spaces_create_page: ({ spaceId, name }: any) => { const id = 'page-' + (pages.length + 1); pages.push({ spaceId, name, id }); return { pageId: id }; },
    spaces_create_node: ({ spaceId, pageId, nodes }: any) => { const results = nodes.map((n: any) => { const nodeId = NID(++nodeSeq); created.push({ spaceId, pageId, ...n, nodeId }); return { ok: true, nodeId, nodeType: n.nodeType, ref: n.ref }; }); return { ok: true, results }; },
    spaces_add_connection: ({ spaceId, connections: cs }: any) => { connections.push(...cs.map((c: any) => ({ spaceId, ...c }))); return { ok: true, results: cs.map((_: any, i: number) => ({ index: i, ok: true, connectionId: 'conn-' + i })) }; },
    creations_get: ({ identifiers }: any) => ({ creations: identifiers.map((id: string) => ({ identifier: id, url: id === 'OFF' ? 'https://elsewhere.test/x.png' : 'https://pikaso.cdnpk.net/p/' + id + '.png' })) }),
    ...extra,
  };
  const bridge = fakeBridge(tools);
  return { bridge, spaces, pages, created, connections, outputs };
}

Deno.test('bridge_prompts_sync (the admin): the owner\'s template read, its generators\' prompts fetched in batches, one shot_prompts row a category and shot; again → the same rows updated; settings «magnific» remembers the template', async () => {
  const { bridge } = flowBridge();
  const { deps, db } = setup({ vault: { ...LINKED }, bridge });
  assertEquals((await call(deps, { action: 'bridge_prompts_sync' }, 'jwt-add')).res.status, 401);
  const r = await call(deps, { action: 'bridge_prompts_sync' }, 'jwt-admin');
  assertEquals(r.body, { result: 'ok', template_space: TEMPLATE, categories: 2, rows: 4 });
  const tools = bridge.calls.filter((c) => c.op === 'tool').map((c) => c.name);
  assertEquals(tools, ['spaces_state', 'spaces_get_nodes'], 'the board in one read (its nodes came whole), one batch of generators');
  assertEquals(bridge.calls.find((c) => c.name === 'spaces_get_nodes')!.args.nodeIds, [NID(1), NID(2), NID(3), NID(4)]);
  const rows = db.rows('shot_prompts').map((x: any) => [x.category, x.shot, x.name, x.prompt, x.negative, x.model, x.aspect, x.resolution, x.source_node, x.updated_by]);
  assertEquals(rows, [['كرسي', 1, 'كرسي 1 — تركيز على المنتج', 'CHAIR FOCUS', 'people, text', 'imagen-nano-banana-2', '3:4', '1k', NID(1), U.admin], ['كرسي', 2, 'كرسي 2 — المنتج في بيئة محيطة', 'CHAIR ENV', null, null, null, null, NID(2), U.admin], ['كرسي', 3, 'كرسي 3 — Closeup للتفاصيل', 'CHAIR DETAIL', null, null, null, null, NID(3), U.admin], ['مرآة', 1, 'مرآة 1 — تركيز على المنتج', 'MIRROR FOCUS', null, null, null, null, NID(4), U.admin]]);
  assertEquals(db.rows('settings').find((s: any) => s.section === 'magnific').data.template_space, TEMPLATE);
  await call(deps, { action: 'bridge_prompts_sync' }, 'jwt-admin');
  assertEquals(db.rows('shot_prompts').length, 4, 'a second sync updates, never doubles');
  // another template id → read instead; a board with no generators → nothing written
  const r2 = await call(deps, { action: 'bridge_prompts_sync', template_space: 'b24c0027-cdcc-461c-bc94-74a2a275c599' }, 'jwt-admin');
  assertEquals(r2.body, { result: 'ok', template_space: 'b24c0027-cdcc-461c-bc94-74a2a275c599', categories: 0, rows: 0 });
});

Deno.test('bridge_flow (products.add): the one Space made once and kept in settings, a page a category made once, the batch\'s flow (the sent photos as the list in product order, three generators with the category rows — or the generic words —, three output lists, six connections), the node ids kept on the batch; nothing sent → 409', async () => {
  const F = flowBridge();
  const items = [item(), item({ nameEn: 'Clay Mug', main: SB + '/row2-main.webp', refs: [] }), item({ nameEn: 'No photo', main: null })];
  const seed = { ...SEED, studio_batches: [batch({ created_by: U.add, state: { items } })],
    shot_prompts: [{ id: 1, category: 'كرسي', shot: 1, name: 'كرسي 1 — تركيز على المنتج', prompt: 'CHAIR FOCUS', negative: 'people', model: 'imagen-nano-banana-2', aspect: '3:4', resolution: '2k' }, { id: 2, category: 'كرسي', shot: 2, name: 'كرسي 2 — المنتج في بيئة محيطة', prompt: 'CHAIR ENV', negative: null, model: null, aspect: null, resolution: null }],
    image_shares: [{ id: 1, created_by: U.add, batch_id: SB, item_index: 0, name: 'Kilim Pouf.webp', path: SB + '/row1-main.webp', url: 'https://s/1', expires_at: NOW, status: 'sent', creation_ref: 'UP1', sent_at: NOW },
      { id: 2, created_by: U.add, batch_id: SB, item_index: 1, name: 'Clay Mug.webp', path: SB + '/row2-main.webp', url: 'https://s/2', expires_at: NOW, status: 'sent', creation_ref: 'UP2', sent_at: NOW }] };
  const none = setup({ vault: { ...LINKED }, bridge: F.bridge, seed: { ...seed, image_shares: [] } });
  assertEquals((await call(none.deps, { action: 'bridge_flow', batch_id: SB, category: 'كرسي' })).body, { error: 'nothing_sent' });
  const { deps, db } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed });
  assertEquals((await call(deps, { action: 'bridge_flow', batch_id: SB, category: 'كرسي' }, 'jwt-edit')).res.status, 401);
  assertEquals((await call(deps, { action: 'bridge_flow', batch_id: SB }, 'jwt-add')).body.field, 'category');
  const r = await call(deps, { action: 'bridge_flow', batch_id: SB, category: 'كرسي' });
  assertEquals(r.res.status, 200);
  assertEquals([r.body.result, r.body.photos, r.body.category, r.body.prompts, r.body.page_id, r.body.url], ['ok', 2, 'كرسي', 2, 'page-1', 'https://www.magnific.com/app/spaces/' + F.spaces[0].id]);
  assertEquals(F.spaces.map((s) => [s.name, s.projectReference]), [['استوديو ابتكر', PROJECT]]);
  assertEquals(F.pages.map((p) => [p.spaceId, p.name]), [[F.spaces[0].id, 'كرسي']]);
  // decision 15: each product with a numeric size (both carry 50×50) gets a size generator — its photo as a creation node, its own output list
  assertEquals(F.created.map((n) => [n.pageId, n.nodeType, n.ref]), [['page-1', 'panel', 'panel'], ['page-1', 'list', 'list'], ['page-1', 'image-generator', 'gen1'], ['page-1', 'list', 'out1'], ['page-1', 'image-generator', 'gen2'], ['page-1', 'list', 'out2'], ['page-1', 'image-generator', 'gen3'], ['page-1', 'list', 'out3'],
    ['page-1', 'creation', 'src4_0'], ['page-1', 'image-generator', 'gen4_0'], ['page-1', 'list', 'out4_0'], ['page-1', 'creation', 'src4_1'], ['page-1', 'image-generator', 'gen4_1'], ['page-1', 'list', 'out4_1']]);
  assertEquals(F.created[1].data, { itemType: 'image', mode: 'replace', items: [{ type: 'image', creationIdentifier: 'UP1' }, { type: 'image', creationIdentifier: 'UP2' }] }, 'the photos in product order, the product without a photo left out');
  assertEquals([F.created[2].data.prompt, F.created[2].data.negativePrompt, F.created[2].data.resolution, F.created[4].data.prompt, F.created[6].data.prompt.startsWith('A close-up detail photograph')], ['CHAIR FOCUS ' + FRAME_NOTE, 'people', '2k', 'CHAIR ENV ' + FRAME_NOTE, true]);
  assertEquals([F.created[8].data, F.created[9].data.prompt.includes('"50 CM"'), F.created[9].data.mode], [{ creationIdentifier: 'UP1' }, true, 'imagen-nano-banana-2']);
  assertEquals(F.connections.length, 10);
  assertEquals(F.connections[0], { spaceId: F.spaces[0].id, sourceElementId: F.created[1].nodeId, sourcePort: 'output-images', targetElementId: F.created[2].nodeId, targetPort: 'reference', dataType: 'image', pageId: 'page-1' });
  assertEquals([F.connections[6].sourceElementId, F.connections[6].sourcePort, F.connections[6].targetElementId], [F.created[8].nodeId, 'output', F.created[9].nodeId], 'the creation feeds its generator directly');
  assertEquals(F.created[11].data, { creationIdentifier: 'UP2' });
  assertEquals(r.body.sizes, 2);
  const flow = db.rows('studio_batches')[0].state.flow;
  assertEquals([flow.space_id, flow.page_id, flow.category, flow.order, flow.gens.map((g: any) => [g.shot, g.id, g.out, g.index])], [F.spaces[0].id, 'page-1', 'كرسي', [0, 1], [[1, F.created[2].nodeId, F.created[3].nodeId, undefined], [2, F.created[4].nodeId, F.created[5].nodeId, undefined], [3, F.created[6].nodeId, F.created[7].nodeId, undefined], [4, F.created[9].nodeId, F.created[10].nodeId, 0], [4, F.created[12].nodeId, F.created[13].nodeId, 1]]]);
  const cfg = db.rows('settings').find((s: any) => s.section === 'magnific').data;
  assertEquals([cfg.space_id, cfg.pages], [F.spaces[0].id, { 'كرسي': 'page-1' }]);
  assertEquals(cfg.flows[SB].gens, flow.gens, 'the server keeps its own record of the flow (the fetch trusts this one, not the batch state)');
  // a second batch of another category: the same Space, a new page; the same category again: the same page
  const second = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ac';
  await db.from('studio_batches').insert({ id: second, title: 'مرايات', type: 'Simple', state: { items: [item()] }, step: 6, status: 'draft', created_by: U.add });
  await db.from('image_shares').insert({ created_by: U.add, batch_id: second, item_index: 0, name: 'M.webp', path: second + '/row1-main.webp', url: 'https://s/3', expires_at: NOW, status: 'sent', creation_ref: 'UP3', sent_at: NOW });
  const r2 = await call(deps, { action: 'bridge_flow', batch_id: second, category: 'مرآة' });
  assertEquals([r2.body.page_id, r2.body.prompts, F.spaces.length, F.pages.length], ['page-2', 0, 1, 2]);
  assert(F.created.at(-9)!.data.prompt.startsWith('A professional product photograph'), 'no rows for the category: the generic words (8 nodes + the one product\'s 3 size nodes)');
  const r3 = await call(deps, { action: 'bridge_flow', batch_id: SB, category: 'كرسي' });
  assertEquals([r3.body.page_id, F.pages.length], ['page-1', 2]);
});

Deno.test('bridge_fetch on a batch with a flow: the output lists read in order → shot s of photo k lands in slot s−1 of product order[k]; a second call finds nothing new; a link off the allowed hosts fails without stopping the rest', async () => {
  const F = flowBridge();
  // decision 15: a size generator of the second product (index 1) — its results go to that product's slot 3, whatever their place
  const gens = [{ shot: 1, id: NID(201), out: NID(301) }, { shot: 2, id: NID(202), out: NID(302) }, { shot: 3, id: NID(203), out: NID(303) }, { shot: 4, index: 1, id: NID(204), out: NID(304) }];
  F.outputs[NID(301)] = ['R11', 'R12']; F.outputs[NID(302)] = ['R21', 'OFF']; F.outputs[NID(303)] = ['R31']; F.outputs[NID(304)] = ['S41']; // shot 3 of the second photo not made yet
  const items = [item({ slots: [] }), item({ nameEn: 'Clay Mug', main: SB + '/row2-main.webp', refs: [], slots: [SB + '/own.png'] })];
  const flow = { space_id: 'a3000000-0000-4000-8000-000000000001', url: 'https://www.magnific.com/app/spaces/x', page_id: 'page-1', category: 'كرسي', panel: NID(100), list: NID(101), gens, order: [0, 1], made_at: NOW };
  const seed = { ...SEED, studio_batches: [batch({ created_by: U.add, state: { items, imgCount: 4, flow } })], settings: [{ section: 'magnific', data: { space_id: flow.space_id, pages: { 'كرسي': 'page-1' }, flows: { [SB]: flow } } }] };
  // a flow only in the member-writable batch state (another Space's ids) is never read: the lineage path runs instead
  const forged = setup({ vault: { ...LINKED }, bridge: flowBridge().bridge, seed: { ...seed, settings: [{ section: 'magnific', data: { space_id: 'a3000000-0000-4000-8000-000000000009', flows: {} } }] } });
  const rf = await call(forged.deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals([rf.body.flow, rf.body.found], [undefined, 0], 'the forged flow is ignored');
  const { deps, db } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed });
  const r = await call(deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals([r.res.status, r.body.result, r.body.flow, r.body.found, r.body.offhost, r.body.placed, r.body.imported, r.body.failed, r.body.status], [200, 'ok', true, 5, 1, 5, 5, 0, 'ok'], 'OFF is dropped before the row (never fetched), counted as offhost');
  assertEquals(F.bridge.calls.filter((c) => c.op === 'tool').map((c) => c.name), ['spaces_get_nodes', 'creations_get']);
  assertEquals(F.bridge.calls[0].args, { spaceId: flow.space_id, nodeIds: [NID(301), NID(302), NID(303), NID(304)] });
  const imp = db.rows('image_imports')[0];
  assertEquals([imp.refs, imp.items], [['R11', 'R12', 'R21', 'R31', 'S41'], [{ index: 0, images: [0, 2, 3], slots: [0, 1, 2] }, { index: 1, images: [1, 4], slots: [0, 3] }]]);
  const st = db.rows('studio_batches')[0].state.items;
  assert(/imp-.*-1\.png$/.test(st[0].slots[0]) && /imp-.*-3\.png$/.test(st[0].slots[1]) && /imp-.*-4\.png$/.test(st[0].slots[2]), 'the pouf: shot 1 → slot 0, shot 2 → slot 1, shot 3 → slot 2');
  assertEquals(st[1].slots[0], SB + '/own.png', 'a filled slot is never overwritten');
  assert(/imp-.*-2\.png$/.test(st[1].slots[1]), 'the mug\'s shot 1 takes the next empty slot');
  assert(/imp-.*-5\.png$/.test(st[1].slots[3]), 'the mug\'s size drawing (decision 15) → slot 3');
  // again: nothing new; then the site finishes the missing shot → one more
  const r2 = await call(deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals([r2.body.found, r2.body.placed, db.rows('image_imports').length], [0, 0, 1]);
  F.outputs[NID(303)].push('R32');
  const r3 = await call(deps, { action: 'bridge_fetch', batch_id: SB });
  assertEquals([r3.body.found, r3.body.placed, db.rows('image_imports').length], [1, 1, 2]);
  assert(/imp-.*-1\.png$/.test(db.rows('studio_batches')[0].state.items[1].slots[2]), 'the mug\'s shot 3 → slot 2');
});

// ---------------------------------------------------------------- phase 9.5.1 «التسويق»: campaign / campaign_edit (decisions 8–9)

const CMP = 'f0000000-0000-4000-8000-000000000001'; const CMP_OLD = 'f0000000-0000-4000-8000-000000000002'; const TPL = 'f1000000-0000-4000-8000-000000000001';
const cstate = () => ({
  w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', media: { post: { notes: 'ألوان دافية', use: [{ t: 'file', path: CMP + '/up-logo.png' }], ref: [{ t: 'tpl', tpl: TPL }] }, carousel: { use: [], ref: [] } }, extra: {} },
  pieces: [{ id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', idea: 'المخدة على كنبة', title: 'دفا الشتا', use: [{ t: 'product', id: 4001 }], ref: [], img: CMP + '/gen-P1-old.png' },
    { id: 'C1', kind: 'كاروسيل', n: 1, size: '1080x1080', slides: [{ n: 1, idea: 'الغرزة' }], img: null }],
});
const MKT_SEED = { ...SEED, mkt_campaigns: [{ id: CMP, name: 'كولكشن الشتا', state: cstate(), archived_at: null }, { id: CMP_OLD, name: 'قديمة', state: cstate(), archived_at: '2026-11-01T00:00:00Z' }],
  mkt_templates: [{ id: TPL, kind: 'post', image: 'templates/t1.png', descr: 'المنتج في النص', deleted_at: null }] };
const MKT_FILES = { ...FILES, [`marketing/${CMP}/up-logo.png`]: PNG, ['marketing/templates/t1.png']: PNG, [`marketing/${CMP}/gen-P1-old.png`]: PNG };

Deno.test('campaign (9.5.1): marketing.create only; the piece read from the saved state → its prompt with the Arabic text, the refs in order (the product, the upload, the template), the image in bucket marketing under the campaign; ai_runs source campaign', async () => {
  const { deps, asked, storage, db, fetched } = setup({ seed: MKT_SEED, storage: { ...MKT_FILES }, replies: [{ images: [img()], credits: 60 }, { images: [img(new Uint8Array([255, 216, 255, 1]), 'image/jpeg')], credits: null }] });
  assertEquals((await call(deps, { action: 'campaign', campaign_id: CMP, piece: 'P1' }, 'jwt-add')).res.status, 401, 'products.add is not marketing.create');
  const r = await call(deps, { action: 'campaign', campaign_id: CMP, piece: 'P1', model: 'gpt-image-2' }, 'jwt-mkt');
  assertEquals([r.res.status, r.body.result, r.body.bucket, r.body.credits], [200, 'ok', 'marketing', 60]);
  assert(r.body.path.startsWith(CMP + '/gen-P1-') && r.body.path.endsWith('.png'), r.body.path);
  assert(storage['marketing/' + r.body.path], 'stored under the campaign');
  assertEquals([asked[0].width, asked[0].height, asked[0].refs.length, asked[0].model], [1080, 1350, 3, 'gpt-image-2']);
  for (const bit of ['«دفا الشتا»', '«المنتج في النص»', 'The first 2 reference images', '«ألوان دافية»']) assert(asked[0].prompt.includes(bit), bit);
  assert(fetched.some((u) => u.endsWith('/c.jpg')), 'the product photo fetched from the site');
  const run = db.rows('ai_runs').at(-1); assertEquals([run.action, run.source, run.label, run.status, run.credits], ['image', 'campaign', 'بوست 1', 'ok', 60]);
  // a carousel slide at the piece's size; a JPEG stays JPEG (Instagram takes no WebP)
  const sl = await call(deps, { action: 'campaign', campaign_id: CMP, piece: 'C1', slide: 0 }, 'jwt-mkt');
  assertEquals([sl.res.status, asked[1].width, asked[1].height], [200, 1080, 1080]);
  assert(sl.body.path.includes('/gen-C1-s1-') && sl.body.path.endsWith('.jpg'), sl.body.path);
  assertEquals((await call(deps, { action: 'campaign', campaign_id: CMP_OLD, piece: 'P1' }, 'jwt-mkt')).res.status, 404, 'an archived campaign');
  assertEquals((await call(deps, { action: 'campaign', campaign_id: CMP, piece: 'P9' }, 'jwt-mkt')).body.field, 'piece');
  assertEquals((await call(deps, { action: 'campaign', campaign_id: CMP, piece: 'C1', slide: 4 }, 'jwt-mkt')).body.field, 'piece', 'no such slide');
  assertEquals((await call(deps, { action: 'campaign', campaign_id: 'nope', piece: 'P1' }, 'jwt-mkt')).body.field, 'campaign_id');
});

Deno.test('campaign_edit (decision 9): the piece\'s current image edited by the pins and the note → a new edit- path; no image yet → 400 image; nothing asked → 400 note', async () => {
  const { deps, asked, db } = setup({ seed: MKT_SEED, storage: { ...MKT_FILES }, replies: [{ images: [img()], credits: 75 }] });
  const r = await call(deps, { action: 'campaign_edit', campaign_id: CMP, piece: 'P1', note: 'أدفى', pins: [{ x: 10, y: 80, text: 'الخلفية فاتحة' }] }, 'jwt-mkt');
  assertEquals([r.res.status, asked[0].kind, asked[0].op, asked[0].refs.length], [200, 'edit', 'instruction', 1]);
  assert(r.body.path.startsWith(CMP + '/edit-P1-'), r.body.path);
  assert(asked[0].prompt.includes('at about 10% from the left and 80% from the top: الخلفية فاتحة') && asked[0].prompt.includes('General change: أدفى.'));
  assertEquals(db.rows('ai_runs').at(-1).label, 'بوست 1 · تعديل');
  assertEquals((await call(deps, { action: 'campaign_edit', campaign_id: CMP, piece: 'C1', note: 'x' }, 'jwt-mkt')).body.field, 'image');
  assertEquals((await call(deps, { action: 'campaign_edit', campaign_id: CMP, piece: 'P1' }, 'jwt-mkt')).body.field, 'note');
});

// ---------------------------------------------------------------- phase 9.5.5: the video through the bridge (decisions 57–64)
const VID_SEED = { ...SEED, mkt_campaigns: [{ id: CMP, name: 'فيديو الشتا', archived_at: null, state: { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', media: { video: { notes: 'نور عصاري', use: [], ref: [] } } },
  pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', model: 'seedance-2.5', dur: 10, method: 'separate', sceneCount: 2, idea: 'المخدة في القعدة',
    scenes: [{ n: 1, d: 5, idea: 'لقطة قريبة', cam: 'زوم بطيء', img: CMP + '/gen-V1-s1-a.png' }, { n: 2, d: 5, idea: 'القعدة', cam: 'ثابتة', img: CMP + '/gen-V1-s2-a.png' }] }, { id: 'P1', kind: 'بوست', n: 1 }] } }], mkt_video_jobs: [] };
const VID_FILES = { ['marketing/' + CMP + '/gen-V1-s1-a.png']: PNG, ['marketing/' + CMP + '/gen-V1-s2-a.png']: PNG, ['marketing/' + CMP + '/vid-V1-up1-x.mp3']: new Uint8Array([73, 68, 51, 4]) };
function videoBridge(state: { done?: Set<string>; failed?: Set<string> } = {}) {
  const done = state.done ?? new Set<string>(); const failed = state.failed ?? new Set<string>(); let n = 0;
  const tools: Record<string, (a: any) => unknown> = {
    creations_upload_image: (a) => ({ identifier: 'up-' + a.fileName.replace(/\W/g, '') }),
    video_generate: () => ({ creations: [{ identifier: 'clip-' + (++n) }] }),
    audio_tts: () => ({ identifier: 'vo-' + (++n) }),
    audio_music_generate: () => ({ creation: { identifier: 'mu-' + (++n) } }),
    creations_request_upload: () => ({ url: 'https://put.test/tmp/1', path: 'tmp/1' }),
    creations_finalize_upload: () => ({ identifier: 'upl-' + (++n) }),
    video_concatenate: () => ({ identifier: 'cut-' + (++n) }),
    video_audio_mix: () => ({ identifier: 'mix-' + (++n) }),
    creations_wait: (a) => ({ creations: a.identifiers.map((id: string) => ({ identifier: id, status: done.has(id) ? 'completed' : failed.has(id) ? 'failed' : 'in_progress', url: done.has(id) ? 'https://pikaso.cdnpk.net/v/' + id + (id.startsWith('vo') || id.startsWith('mu') ? '.mp3' : '.mp4') : null })) }),
  };
  const bridge = fakeBridge(tools); return { bridge, done, failed, tools };
}
const vcall = (deps: any, action: string, extra: any = {}) => call(deps, { action, campaign_id: CMP, piece: 'V1', ...extra }, 'jwt-mkt');

Deno.test('video_clip (marketing.create, the bridge linked): the scene\'s key frame uploaded by a signed link, video_generate with the model\'s slug / ratio / seconds / ambient audio, a running job without credits; chained = one multi-shot call; the limits', async () => {
  const F = videoBridge(); const { deps, db, storage } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed: structuredClone(VID_SEED), storage: { ...VID_FILES } });
  assertEquals((await call(deps, { action: 'video_clip', campaign_id: CMP, piece: 'V1', scene: 0 }, 'jwt-add')).res.status, 401);
  const r = await vcall(deps, 'video_clip', { scene: 1 });
  assertEquals([r.res.status, r.body.result, r.body.job.kind, r.body.job.scene, r.body.job.status, r.body.job.ref], [200, 'ok', 'clip', 1, 'running', 'clip-1']);
  const up = F.bridge.calls.find((c: any) => c.name === 'creations_upload_image'); assert(up.args.url.startsWith('https://signed.test/marketing/' + CMP + '/gen-V1-s2-a.png'));
  const g = F.bridge.calls.find((c: any) => c.name === 'video_generate').args;
  assertEquals([g.slug, g.duration, g.aspectRatio, g.resolution, g.withSoundEffects, g.noMusic, g.keyframes.start.url, g.folderReference], ['bytedance-seedance-pro-2.5', 5, '9:16', '1080p', true, true, 'up-scene2png', PROJECT]);
  assert(g.prompt.includes('«القعدة»') && g.prompt.includes('«نور عصاري»') && g.prompt.includes('static camera'));
  const run = db.rows('ai_runs').at(-1); assertEquals([run.action, run.source, run.label, run.status, Number(run.credits)], ['image', 'video', 'فيديو 1 · المشهد 2', 'ok', 0]);
  assertEquals(db.rows('mkt_video_jobs')[0].data.frame, 'up-scene2png');
  assertEquals((await vcall(deps, 'video_clip', { scene: 5 })).body.field, 'scene');
  assertEquals((await vcall(deps, 'video_clip', { scene: 0, piece: 'P1' })).body.field, 'piece');
  // chained: one call with the shots, the first frame a reference
  const seed2: any = structuredClone(VID_SEED); seed2.mkt_campaigns[0].state.pieces[0].method = 'chained';
  const F2 = videoBridge(); const d2 = setup({ vault: { ...LINKED }, bridge: F2.bridge, seed: seed2, storage: { ...VID_FILES } });
  const c = await vcall(d2.deps, 'video_clip');
  assertEquals([c.res.status, c.body.job.scene, c.body.job.data.method], [200, null, 'chained']);
  const g2 = F2.bridge.calls.find((x: any) => x.name === 'video_generate').args;
  assertEquals([g2.multi_prompt.length, g2.duration, g2.references[0].url, g2.prompt], [2, 10, 'up-scene1png', undefined]);
  // no bridge linked → 503; a scene without an image → 400 image
  const none = setup({ vault: {}, bridge: videoBridge().bridge, seed: structuredClone(VID_SEED), storage: { ...VID_FILES } });
  assertEquals((await vcall(none.deps, 'video_clip', { scene: 0 })).res.status, 503);
  const seed3: any = structuredClone(VID_SEED); delete seed3.mkt_campaigns[0].state.pieces[0].scenes[0].img;
  assertEquals((await vcall(setup({ vault: { ...LINKED }, bridge: videoBridge().bridge, seed: seed3, storage: { ...VID_FILES } }).deps, 'video_clip', { scene: 0 })).body.field, 'image');
  assert(!JSON.stringify(storage).includes('at-1'));
});

Deno.test('video_voice / video_music / video_upload: the catalog voice on ElevenLabs v3, Lyria 3 with the type, a member\'s audio file PUT then finalized as a done upload job; the open-jobs cap', async () => {
  const F = videoBridge(); const { deps, db, fetchInits, fetched } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed: structuredClone(VID_SEED), storage: { ...VID_FILES } });
  const v = await vcall(deps, 'video_voice', { voice: 'm-eg-1', text: 'الدفا الحقيقي من إيد صانعة مصرية' });
  assertEquals([v.res.status, v.body.job.kind, v.body.job.ref, v.body.job.data], [200, 'voice', 'vo-1', { voice: 'm-eg-1', chars: 32 }]);
  const t = F.bridge.calls.find((c: any) => c.name === 'audio_tts').args; assertEquals([t.voiceId, t.model, t.text], [1171, 'eleven_v3', 'الدفا الحقيقي من إيد صانعة مصرية']);
  assertEquals((await vcall(deps, 'video_voice', { voice: 'x', text: 'y' })).body.field, 'voice');
  const m = await vcall(deps, 'video_music', { type: 'شرقي حديث' });
  assertEquals([m.res.status, m.body.job.kind, m.body.job.ref], [200, 'music', 'mu-2']);
  assert(F.bridge.calls.find((c: any) => c.name === 'audio_music_generate').args.prompt.includes('oud'));
  const u = await vcall(deps, 'video_upload', { path: CMP + '/vid-V1-up1-x.mp3', role: 'music' });
  assertEquals([u.res.status, u.body.job.kind, u.body.job.status, u.body.job.ref, u.body.job.data.role, u.body.job.path], [200, 'upload', 'done', 'upl-3', 'music', CMP + '/vid-V1-up1-x.mp3']);
  assertEquals(fetched.at(-1), 'https://put.test/tmp/1'); assertEquals(fetchInits.at(-1).method, 'PUT'); assertEquals(fetchInits.at(-1).headers['Content-Type'], 'audio/mpeg');
  assertEquals(F.bridge.calls.find((c: any) => c.name === 'creations_finalize_upload').args.path, 'tmp/1');
  assertEquals((await vcall(deps, 'video_upload', { path: CMP + '/gen-V1-s1-a.png', role: 'music' })).body.field, 'path');
  // the cap: six open jobs a piece
  for (let i = 0; i < 4; i++) await vcall(deps, 'video_music', { type: 'مبهجة' });
  assertEquals(db.rows('mkt_video_jobs').filter((j: any) => j.status === 'running').length, 6);
  assertEquals((await vcall(deps, 'video_clip', { scene: 0 })).res.status, 409);
  assertEquals(db.rows('ai_runs').filter((r: any) => r.source === 'video').length, 7);
});

// phase 11 (decision 15): the voice on ElevenLabs direct and the clips on Veo when the settings say so — the files kept in bucket marketing
// and put onto Magnific (when linked) so the assembly still works; the USD cost on the run row; a missing key names the provider
Deno.test('providers: voice on ElevenLabs direct → MP3 kept + uploaded to Magnific as a done voice job at its USD; a Veo clip → an operation on a running job, video_poll finishes it (download, keep, upload) or fails it; missing keys → 503 with the provider', async () => {
  const F = videoBridge();
  const seed: any = structuredClone(VID_SEED); seed.settings = [{ section: 'ai', data: { providers: { voice: { default: 'elevenlabs' }, video: { default: 'veo', models: { veo: 'veo-3.1-fast-generate-preview' } } } } }];
  const { deps, db, storage, fetched } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed, storage: { ...VID_FILES }, env: { ELEVENLABS_API_KEY: 'el-x', GEMINI_API_KEY: 'g-x' } });
  // the direct providers reserve USD on the content cap (ai_run_start of 0024) — the fake answers ok and keeps the reserve on the row
  const reserves: number[] = [];
  const usdStart = (d: any) => ((orig) => async (name: string, args: any) => { if (name !== 'ai_run_start') return orig(name, args); reserves.push(args.p_reserve); const { data } = await d.from('ai_runs').insert({ created_at: NOW, ...args.p_row, status: 'pending', credits: 0, cost_usd: args.p_reserve }).select('id').single(); return { data: { result: 'ok', id: data.id }, error: null }; })(d.rpc.bind(d));
  (deps.db as any).rpc = usdStart(deps.db);
  const tts: any[] = []; (deps as any).tts = async (r: any) => { tts.push(r); return { bytes: new Uint8Array(200).fill(7), mime: 'audio/mpeg' }; };
  const veo: any[] = []; const ops: Record<string, any> = {};
  (deps as any).veo = { start: async (r: any) => { veo.push({ model: r.model, prompt: r.prompt, image: r.image ? r.image.bytes.length : null, aspect: r.aspect, seconds: r.seconds }); const op = 'models/veo/operations/op' + (veo.length); ops[op] = { done: false }; return op; },
    poll: async (op: string) => ops[op] ?? { done: true, error: 'gone' }, download: async (uri: string) => { fetched.push(uri); return { bytes: new Uint8Array(500).fill(1), mime: 'video/mp4' }; } };
  const v = await vcall(deps, 'video_voice', { voice: 'm-eg-1', text: 'الدفا الحقيقي' });
  assertEquals([v.res.status, v.body.job.kind, v.body.job.status, v.body.job.ref, v.body.job.data.provider], [200, 'voice', 'done', 'upl-1', 'elevenlabs'], JSON.stringify(v.body));
  assertEquals(tts, [{ text: 'الدفا الحقيقي', voiceId: null, model: 'eleven_v3' }]);
  assert(/^.*\/vid-V1-vo-[0-9a-z]+\.mp3$/.test(v.body.job.path), v.body.job.path); assertEquals(storage['marketing/' + v.body.job.path].length, 200);
  assertEquals(F.bridge.calls.filter((c: any) => c.name === 'creations_finalize_upload').length, 1, 'onto Magnific for the assembly');
  assertEquals(F.bridge.calls.filter((c: any) => c.name === 'audio_tts').length, 0, 'the bridge\'s TTS not called');
  assertEquals(Number(db.rows('ai_runs').at(-1).cost_usd), 0.0039); // 13 characters × $0.30 / 1000
  assertEquals(reserves, [0.0039], 'reserved on the content cap before the call');
  // a Veo clip: the scene's key frame, the aspect of the piece, the seconds nearest Veo's; a running job with the operation
  const c = await vcall(deps, 'video_clip', { scene: 1 });
  assertEquals([c.res.status, c.body.job.kind, c.body.job.status, c.body.job.ref, c.body.job.data.provider, c.body.job.data.duration], [200, 'clip', 'running', null, 'veo', 4], JSON.stringify(c.body));
  assertEquals([veo[0].model, veo[0].image, veo[0].aspect, veo[0].seconds], ['veo-3.1-fast-generate-preview', PNG.length, '9:16', 4]); assert(veo[0].prompt.includes('القعدة') && veo[0].prompt.includes('camera: ثابتة'));
  assertEquals(F.bridge.calls.filter((c: any) => c.name === 'video_generate').length, 0);
  assertEquals((await vcall(deps, 'video_clip', { scene: 0, piece: 'V1' })).res.status, 200);
  let p = await vcall(deps, 'video_poll');
  assertEquals([p.res.status, p.body.open], [200, 2], 'still running');
  ops['models/veo/operations/op1'] = { done: true, uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media' };
  ops['models/veo/operations/op2'] = { done: true, error: 'filtered' };
  p = await vcall(deps, 'video_poll');
  const J = db.rows('mkt_video_jobs').filter((j: any) => j.kind === 'clip');
  assertEquals(J.map((j: any) => [j.scene, j.status, j.error]), [[1, 'done', null], [0, 'failed', 'filtered']]);
  assert(/\/vid-V1-s2-[0-9a-z]+\.mp4$/.test(J[0].path), J[0].path); assertEquals(J[0].creation_ref, 'upl-2', 'the finished clip onto Magnific too'); assertEquals(J[0].bytes, 500);
  assertEquals(p.body.open, 0);
  // no keys → 503 naming the provider, no job
  const nk = setup({ vault: { ...LINKED }, bridge: videoBridge().bridge, seed: structuredClone(seed), storage: { ...VID_FILES } }); (nk.deps as any).tts = async () => { throw new Error('no'); }; (nk.deps as any).veo = (deps as any).veo; (nk.deps.db as any).rpc = usdStart(nk.deps.db);
  assertEquals((await vcall(nk.deps, 'video_voice', { voice: 'm-eg-1', text: 'x' })).body, { error: 'not_configured', configured: false, provider: 'elevenlabs' });
  assertEquals((await vcall(nk.deps, 'video_clip', { scene: 0 })).body, { error: 'not_configured', configured: false, provider: 'veo' });
  assertEquals(nk.db.rows('mkt_video_jobs').length, 0);
});

// phase 11 (decision 4): Higgsfield through its MCP server linked from the settings (Vault mcp_higgsfield: url + token) — the key frame
// uploaded (media_upload → PUT → media_confirm), generate_video, then jobs_wait in video_poll; the finished clip kept and put onto Magnific
Deno.test('providers: video on Higgsfield (MCP) → media_upload / PUT / media_confirm / generate_video with the mapped model, a running job with the Higgsfield job id; video_poll reads jobs_wait, downloads the finished clip and keeps it; a failed one is marked; no link → 503', async () => {
  const F = videoBridge();
  const seed: any = structuredClone(VID_SEED); seed.settings = [{ section: 'ai', data: { providers: { video: { default: 'higgsfield' } } } }];
  const { deps, db, storage, fetched } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed, storage: { ...VID_FILES }, photo: new Uint8Array(300).fill(2) });
  const vaultApp: Record<string, string> = { mcp_higgsfield: JSON.stringify({ url: 'https://mcp.higgsfield.ai/mcp', token: 'hf-tok' }) };
  (deps.db as any).rpc = ((orig) => async (name: string, args: any) => (name === 'app_secret_get' ? { data: vaultApp[args.p_name] ?? null, error: null } : orig(name, args)))((deps.db as any).rpc.bind(deps.db));
  const mcpCalls: any[] = []; const states: Record<string, any> = {};
  (deps as any).mcp = (url: string, token: string | null) => ({ listTools: async () => [], callTool: async (name: string, args: any) => { mcpCalls.push({ url, token, name, args });
    if (name === 'media_upload') return { upload_url: 'https://put.higgsfield.test/u1', media_id: 'm-1' };
    if (name === 'media_confirm') return { ok: true };
    if (name === 'generate_video') return { jobs: [{ job_id: 'hfj-' + (mcpCalls.filter((c) => c.name === 'generate_video').length) }] };
    if (name === 'jobs_wait') return { jobs: args.jobs.map((j: any) => ({ job_id: j.job_id, ...(states[j.job_id] ?? { status: 'in_progress' }) })) };
    throw new Error('unknown ' + name); } });
  const c = await vcall(deps, 'video_clip', { scene: 0 });
  assertEquals([c.res.status, c.body.job.kind, c.body.job.status, c.body.job.data.provider, c.body.job.data.hf_job, c.body.job.data.model], [200, 'clip', 'running', 'higgsfield', 'hfj-1', 'seedance_2_5'], JSON.stringify(c.body));
  assertEquals(mcpCalls.map((x) => x.name), ['media_upload', 'media_confirm', 'generate_video']);
  assertEquals([mcpCalls[0].url, mcpCalls[0].token], ['https://mcp.higgsfield.ai/mcp', 'hf-tok']);
  assertEquals(mcpCalls[2].args.params.medias, [{ value: 'm-1', role: 'image' }]); assertEquals(mcpCalls[2].args.params.aspect_ratio, '9:16'); assertEquals(mcpCalls[2].args.params.duration, 5);
  assertEquals(fetched.filter((u) => u === 'https://put.higgsfield.test/u1').length, 1, 'the key frame PUT');
  assertEquals(F.bridge.calls.filter((x: any) => x.name === 'video_generate').length, 0);
  await vcall(deps, 'video_clip', { scene: 1 });
  let p = await vcall(deps, 'video_poll'); assertEquals(p.body.open, 2);
  assertEquals(mcpCalls.at(-1).name, 'jobs_wait'); assertEquals(mcpCalls.at(-1).args.jobs.map((j: any) => j.job_id), ['hfj-1', 'hfj-2']);
  states['hfj-1'] = { status: 'completed', result_url: 'https://cdn.higgsfield.test/v/1.mp4' }; states['hfj-2'] = { status: 'failed' };
  p = await vcall(deps, 'video_poll');
  const J = db.rows('mkt_video_jobs').filter((j: any) => j.kind === 'clip');
  assertEquals(J.map((j: any) => [j.scene, j.status, j.error]), [[0, 'done', null], [1, 'failed', 'failed']]);
  assert(/\/vid-V1-s1-[0-9a-z]+\.mp4$/.test(J[0].path), J[0].path); assertEquals(storage['marketing/' + J[0].path].length, 300); assertEquals(J[0].creation_ref, 'upl-1');
  assertEquals(p.body.open, 0);
  delete vaultApp.mcp_higgsfield;
  assertEquals((await vcall(deps, 'video_clip', { scene: 0 })).body, { error: 'not_configured', configured: false, provider: 'higgsfield' });
});

Deno.test('video_poll: the open jobs asked at once; a done one downloaded into bucket marketing (an allowed host, mp4 / mp3 by kind), a failed one marked; then video_assemble: the cut, the voice mix, the music mix one after the other as each finishes; the final', async () => {
  const F = videoBridge(); const { deps, db, storage, fetched } = setup({ vault: { ...LINKED }, bridge: F.bridge, seed: structuredClone(VID_SEED), storage: { ...VID_FILES } });
  await vcall(deps, 'video_clip', { scene: 0 }); await vcall(deps, 'video_clip', { scene: 1 }); await vcall(deps, 'video_voice', { voice: 'f-ar-1', text: 'أهلًا' }); await vcall(deps, 'video_music', { type: 'سينمائي' });
  assertEquals((await vcall(deps, 'video_assemble')).res.status, 409, 'open jobs still running');
  let p = await vcall(deps, 'video_poll');
  assertEquals([p.res.status, p.body.open, p.body.final], [200, 4, null]);
  assertEquals(F.bridge.calls.filter((c: any) => c.name === 'creations_wait').at(-1).args.identifiers, ['clip-1', 'clip-2', 'vo-3', 'mu-4']);
  F.done.add('clip-1'); F.done.add('vo-3'); F.failed.add('mu-4');
  p = await vcall(deps, 'video_poll');
  const J = db.rows('mkt_video_jobs');
  assertEquals(J.map((j: any) => [j.creation_ref, j.status]), [['clip-1', 'done'], ['clip-2', 'running'], ['vo-3', 'done'], ['mu-4', 'failed']]);
  assert(J[0].path.startsWith(CMP + '/vid-V1-s1-') && J[0].path.endsWith('.mp4') && storage['marketing/' + J[0].path], 'the clip stored');
  assert(J[2].path.endsWith('.mp3') && J[0].url === 'https://pikaso.cdnpk.net/v/clip-1.mp4' && J[3].error === 'failed');
  assert(fetched.includes('https://pikaso.cdnpk.net/v/clip-1.mp4'));
  assertEquals(p.body.jobs.map((j: any) => j.url), [undefined, undefined, undefined, undefined], 'the link never reaches the page');
  assertEquals((await vcall(deps, 'video_assemble')).res.status, 409, 'clip-2 still running');
  F.done.add('clip-2'); await vcall(deps, 'video_poll');
  // the assembly: two clips → concatenate first; the chain then voice (music failed → none)
  const a = await vcall(deps, 'video_assemble');
  assertEquals([a.res.status, a.body.job.kind, a.body.job.ref, a.body.job.data.chain, a.body.job.data.step, a.body.job.data.final], [200, 'assemble', 'cut-5', ['concat', 'voice'], 0, false]);
  assertEquals(F.bridge.calls.find((c: any) => c.name === 'video_concatenate').args.creationIdentifiers, ['clip-1', 'clip-2']);
  F.done.add('cut-5'); p = await vcall(deps, 'video_poll');
  const mix = F.bridge.calls.find((c: any) => c.name === 'video_audio_mix').args;
  assertEquals([mix.creationIdentifier, mix.audioCreationIdentifier, mix.audioVolume, mix.videoVolume], ['cut-5', 'vo-3', 100, 60]);
  assertEquals([p.body.open, p.body.final], [1, null]);
  const last = db.rows('mkt_video_jobs').at(-1); assertEquals([last.kind, last.creation_ref, last.data.role, last.data.final], ['mix', 'mix-6', 'voice', true]);
  F.done.add('mix-6'); p = await vcall(deps, 'video_poll');
  assertEquals([p.body.open, p.body.final.kind, p.body.final.ref, p.body.final.path.startsWith(CMP + '/vid-V1-mix-')], [0, 'mix', 'mix-6', true]);
  // one clip and no audio: the clip is the video at once
  const seed1: any = structuredClone(VID_SEED); seed1.mkt_campaigns[0].state.pieces[0].scenes.pop();
  const G = videoBridge(); const one = setup({ vault: { ...LINKED }, bridge: G.bridge, seed: seed1, storage: { ...VID_FILES } });
  await vcall(one.deps, 'video_clip', { scene: 0 }); G.done.add('clip-1'); await vcall(one.deps, 'video_poll');
  const a1 = await vcall(one.deps, 'video_assemble');
  assertEquals([a1.body.job.kind, a1.body.job.status, a1.body.job.ref, a1.body.job.data.final, !!a1.body.job.path], ['mix', 'done', 'clip-1', true, true]);
  assertEquals((await vcall(one.deps, 'video_poll')).body.final.ref, 'clip-1');
});
