// ai-content: the AI content of phase 5.3 (docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md), deployed with
// verify_jwt false; it authenticates here — a member's Authorization: Bearer <jwt> only, never a sync secret: the AI runs at a
// person's request (decision 3). Body { action, ...args }:
//   'write'  (the content tool; the admin or products.add = F or products.edit = F) { source: data | image | product, outputs,
//            langs, tone?, data?, current?, image?, product_id? } → { result: 'ok', out: { ar?, en? }, missing, model, cost_usd,
//            run_id }. For a product, its row, Arabic name, category paths, brands and main image come from the mirror (never
//            from the body); the page sends the product's current texts as `current`.
//   'studio' (the studio; the admin or products.add = F) { batch_id, index, want } → { result: 'ok', fields, missing, model,
//            cost_usd, run_id }: the item, its brand and photo (bucket studio), the site's categories and sku_colors read here.
// Both only suggest: nothing is written to the site or the batch (the page saves through product_save / IBStudio.save).
// A request declined by the model's safety classifiers runs again on Anthropic's recommended model in the same call
// (fallbacks: "default"); still declined → 200 { result: 'refused' }. Every call is reserved first (ai_run_start: the member's
// throttle and the monthly cap in one locked step, a pending ai_runs row) and that row then holds its outcome (service role:
// the cleaned output and an error code only — never a prompt, an image or the key). Errors: 400 bad_request { field },
// 401 unauthorized, 404 not_found, 402 ai_cap (AI_MONTHLY_LIMIT_USD would be passed this Cairo month), 429 busy (Anthropic's
// rate limit or overload, a timeout, or THROTTLE calls of the member in 10 minutes),
// 503 not_configured (no ANTHROPIC_API_KEY — the owner sets it in the Edge Functions' secrets — or the key refused),
// 502 ai_error (no usable answer). One quick retry for a 429 / 5xx; a product photo Claude could not fetch is dropped once.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { aiConfig, categoryLines, cleanStudio, cleanWrite, costOf, line, parseStudio, parseWrite, readAnswer, studioRequest, usageOf, writeRequest } from '../_shared/ai-content.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  claude: (params: Json) => Promise<Json>; sleep?: (ms: number) => Promise<void>;
};

const ACTIONS = ['write', 'studio'];
const STUDIO_BUCKET = 'studio';
const THROTTLE = 60; // calls of one member in THROTTLE_MINUTES (the studio fills a batch one item at a time)
const THROTTLE_MINUTES = 10;
// the most one call can cost (16k output tokens and the prompt on the dearest fallback model): held while the call runs
const RESERVE_USD = 0.5;
const RETRY_WITHIN_MS = 20_000;
const MAX_PHOTO_BYTES = 3_750_000; // a base64 image stays under Claude's 5 MB
const PRODUCT_COLS = 'id, sku, name, lang, translation_ids, image_url, category_ids, brand_ids';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const config = (env: Deps['env']) => aiConfig({ model: env.AI_CONTENT_MODEL?.trim(), effort: env.AI_CONTENT_EFFORT?.trim(), cap: env.AI_MONTHLY_LIMIT_USD?.trim() });
const modelId = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60) : '') || null;

// ---------------------------------------------------------------- auth

async function authorize(req: Request, deps: Deps, action: string): Promise<string | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && data === 'F'; };
  const admin = async () => { const { data, error } = await member.rpc('is_admin'); return !error && data === true; };
  const ok = action === 'write' ? (await admin()) || (await perm('products.add')) || (await perm('products.edit'))
    : action === 'studio' ? (await admin()) || (await perm('products.add'))
    : await admin();
  return ok ? await deps.userId(jwt) : null;
}

// ---------------------------------------------------------------- Claude

type Asked = { msg: Json } | { error: 'busy' | 'not_configured' | 'ai_error'; status: number | null };
const urlImage = (p: Json) => (p.messages?.[0]?.content ?? []).some((b: Json) => b?.type === 'image' && b.source?.type === 'url');
const withoutUrlImage = (p: Json) => ({ ...p, messages: [{ ...p.messages[0], content: p.messages[0].content.filter((b: Json) => !(b?.type === 'image' && b.source?.type === 'url')) }] });

async function ask(deps: Deps, params: Json): Promise<Asked> {
  const started = Date.now();
  let p = params; let retried = false; let dropped = false;
  for (;;) {
    try {
      return { msg: await deps.claude(p) };
    } catch (e) {
      const status = typeof (e as Json)?.status === 'number' ? (e as Json).status as number : null;
      if (status === 401 || status === 403) return { error: 'not_configured', status };
      // the product photo is fetched by Anthropic from the site; one it cannot read is a 400 — the text alone goes once more
      if (status === 400 && !dropped && urlImage(p)) { p = withoutUrlImage(p); dropped = true; continue; }
      const transient = status === 429 || (status !== null && status >= 500);
      if (transient && !retried && Date.now() - started < RETRY_WITHIN_MS) { retried = true; await (deps.sleep ?? wait)(2000); continue; }
      return { error: transient || status === null ? 'busy' : 'ai_error', status };
    }
  }
}

// ---------------------------------------------------------------- the run (ai_runs)

// The reservation (decision 3, security review 29 Oct): ai_run_start throttles the member and checks the monthly cap in one
// locked step on the server, and leaves a pending row at RESERVE_USD that the call's outcome then replaces. Parallel calls
// cannot pass the cap or the throttle together; a reservation that cannot be made means no call (fail closed); a call whose
// outcome is unknown (a timeout, the network) keeps its reserve, so the cap still counts it.
async function startRun(deps: Deps, row: Json, cap: number | null) {
  const { data, error } = await deps.db.rpc('ai_run_start', { p_row: row, p_cap: cap, p_reserve: RESERVE_USD, p_throttle: THROTTLE, p_window_minutes: THROTTLE_MINUTES });
  if (error || !isObj(data)) return { result: 'error' as const };
  const id = Number(data.id);
  if (data.result === 'ok' && Number.isInteger(id)) return { result: 'ok' as const, id };
  return { result: data.result === 'busy' ? 'busy' as const : data.result === 'cap' ? 'cap' as const : 'error' as const };
}
async function finishRun(deps: Deps, id: number, row: Json) {
  const { error } = await deps.db.from('ai_runs').update(row).eq('id', id);
  if (error) console.error('ai_runs update failed', error.code ?? ''); // the row keeps its reserve: the cap still counts it
}

// The common path of both actions: the reservation, the key, the call, the answer, the row.
async function runAi(deps: Deps, base: Json, params: Json, clean: (answer: Json) => Json): Promise<Response> {
  const cfg = config(deps.env);
  const run = await startRun(deps, { ...base, model: cfg.model }, cfg.cap);
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  if (!deps.env.ANTHROPIC_API_KEY?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', cost_usd: 0 }); return json(503, { error: 'not_configured' }); }
  const asked = await ask(deps, params);
  if ('error' in asked) {
    await finishRun(deps, run.id, { status: 'error', error: asked.error, cost_usd: asked.status === null ? RESERVE_USD : 0 });
    return json(asked.error === 'not_configured' ? 503 : asked.error === 'busy' ? 429 : 502, { error: asked.error });
  }
  const msg = asked.msg;
  const model = modelId(msg.model) ?? cfg.model;
  const u = usageOf(msg.usage); const cost = costOf(model, msg.usage);
  const spent = { model, input_tokens: u.input, output_tokens: u.output, cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite, cost_usd: cost };
  const answer = readAnswer(msg);
  if (answer.status === 'refused') { await finishRun(deps, run.id, { ...spent, status: 'refused', error: 'refused' }); return json(200, { result: 'refused', model, cost_usd: cost }); }
  if (answer.status !== 'ok') { await finishRun(deps, run.id, { ...spent, status: 'error', error: 'ai_error' }); return json(502, { error: 'ai_error' }); }
  const out = clean(answer.json);
  await finishRun(deps, run.id, { ...spent, status: 'ok', output: out });
  return json(200, { result: 'ok', ...out, model, cost_usd: cost, run_id: run.id });
}

// ---------------------------------------------------------------- write (the content tool)

// The mirror's product (the English row, whichever id came) with its Arabic name, category paths, brands and main image.
async function readProduct(db: Db, id: number) {
  const one = async (pid: number) => (await db.from('products').select(PRODUCT_COLS).eq('id', pid).maybeSingle()).data as Json | null;
  const row = await one(id);
  if (!row) return null;
  const t = isObj(row.translation_ids) ? row.translation_ids : {};
  const other = (k: string) => { const n = Number(t[k]); return Number.isInteger(n) && n > 0 && n !== Number(row.id) ? n : null; };
  let en: Json = row; let nameAr = '';
  if (row.lang === 'ar') { nameAr = row.name ?? ''; const e = other('en'); if (e) en = (await one(e)) ?? row; }
  else { const a = other('ar'); if (a) nameAr = (await one(a))?.name ?? ''; }
  const catIds = (Array.isArray(en.category_ids) ? en.category_ids : []).map(Number);
  const brandIds = (Array.isArray(en.brand_ids) ? en.brand_ids : []).map(Number);
  let categories: string[] = [];
  if (catIds.length) {
    const { data } = await db.from('woo_categories').select('id, name, parent_id').range(0, 4999);
    const paths = new Map(categoryLines(data ?? []).map((l: string) => { const i = l.indexOf(': '); return [Number(l.slice(0, i)), l.slice(i + 2)]; }));
    categories = catIds.map((c: number) => paths.get(c)).filter((x: unknown): x is string => typeof x === 'string');
  }
  let brands: string[] = [];
  if (brandIds.length) brands = ((await db.from('woo_brands').select('id, name').in('id', brandIds)).data ?? []).map((b: Json) => b.name).filter(Boolean);
  return { name: en.name ?? '', nameAr, categories, brands, imageUrl: en.image_url ?? null };
}

async function write(deps: Deps, uid: string, args: Json) {
  const parsed = parseWrite(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req;
  const product = req.source === 'product' ? await readProduct(deps.db, req.productId) : null;
  if (req.source === 'product' && !product) return json(404, { error: 'not_found' });
  const label = line(product?.name || req.data.name || req.current.nameEn || req.current.nameAr || (req.source === 'image' ? 'صورة' : ''), 200) || null;
  const cfg = config(deps.env);
  const base = { created_by: uid, action: 'write', source: req.source, label, product_id: req.productId };
  return await runAi(deps, base, writeRequest(req, { model: cfg.model, effort: cfg.effort, product }),
    (answer) => cleanWrite(answer, req.outputs, req.langs));
}

// ---------------------------------------------------------------- studio

function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// The item's photo for Claude: the first image slot, else the photo it came in with, else its first reference; a path of
// this batch only (the bucket's own layout), at most MAX_PHOTO_BYTES. None readable → no photo.
async function itemPhoto(db: Db, batchId: string, item: Json) {
  const pathRe = new RegExp('^' + batchId + '/[A-Za-z0-9._-]{1,120}\\.(webp|png|jpe?g)$', 'i');
  const path = [Array.isArray(item.slots) ? item.slots[0] : null, item.main, Array.isArray(item.refs) ? item.refs[0] : null]
    .find((p) => typeof p === 'string' && pathRe.test(p)) as string | undefined;
  if (!path) return null;
  const { data, error } = await db.storage.from(STUDIO_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  const ext = path.split('.').pop()!.toLowerCase();
  return { media_type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', data: base64(bytes) };
}

async function studio(deps: Deps, uid: string, args: Json) {
  const parsed = parseStudio(args);
  if ('error' in parsed) return json(400, parsed);
  const { batchId, index, want } = parsed.req;
  const { data: batch } = await deps.db.from('studio_batches').select('id, brand_id, state, archived_at').eq('id', batchId).maybeSingle();
  const items = isObj(batch?.state) && Array.isArray(batch.state.items) ? batch.state.items : [];
  const item = batch && !batch.archived_at ? items[index] : null;
  if (!isObj(item)) return json(404, { error: 'not_found' });
  const brand = batch.brand_id ? ((await deps.db.from('brands').select('name').eq('id', batch.brand_id).maybeSingle()).data?.name ?? '') : '';
  const cats = (await deps.db.from('woo_categories').select('id, name, parent_id').range(0, 4999)).data ?? [];
  const colors = (await deps.db.from('sku_colors').select('code, name_en, name_ar').range(0, 999)).data ?? [];
  const image = await itemPhoto(deps.db, batchId, item);
  const cfg = config(deps.env);
  const label = line(item.nameEn || item.nameAr || '', 200) || '#' + (index + 1);
  const base = { created_by: uid, action: 'studio', source: 'studio', label, batch_id: batchId, item_index: index };
  const sets = { categoryIds: new Set(cats.map((c: Json) => Number(c.id))), colorCodes: new Set(colors.map((c: Json) => c.code)) };
  return await runAi(deps, base, studioRequest(item, { model: cfg.model, effort: cfg.effort, want, brand, cats, colors, image }),
    (answer) => cleanStudio(answer, want, sets));
}

// ---------------------------------------------------------------- handler

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(body) ? body : {};
  const action = typeof args.action === 'string' ? args.action : '';
  const uid = await authorize(req, deps, action);
  if (!uid) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    return action === 'write' ? await write(deps, uid, args) : await studio(deps, uid, args);
  } catch (e) {
    console.error('ai-content failed', e instanceof Error ? e.name : typeof e);
    return json(500, { error: 'failed' });
  }
}

// ---------------------------------------------------------------- runtime wiring

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
let service: Db = null;
let anthropic: Anthropic | null = null;
let anthropicKey = '';
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    claude: async (params) => {
      const key = (env.ANTHROPIC_API_KEY ?? '').trim();
      if (!anthropic || anthropicKey !== key) { anthropic = new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 0 }); anthropicKey = key; }
      // deno-lint-ignore no-explicit-any
      return await anthropic.beta.messages.create(params as any) as unknown as Json;
    },
  };
}

// Serve only as the entry point (the Supabase Edge Runtime defines EdgeRuntime); importing the module (tests) does not.
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
