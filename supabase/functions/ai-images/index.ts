// ai-images: product images with the AI (phase 5.4, docs/superpowers/plans/2026-10-31-phase-5-4-images.md), deployed with
// verify_jwt false; it authenticates here — a member's Authorization: Bearer <jwt> only, never a sync secret. The provider is
// Magnific's API (providers/magnific.ts, the only file with its HTTP shape; secret MAGNIFIC_API_KEY — without it 503
// not_configured, no call). Body { action, ...args }:
//   'generate' (the studio; the admin or products.add = F) { batch_id, index, slot: 0..5 | 'color:XX', model?, size? } → the slot
//              image made from the item's reference photos (main + refs, bucket studio) and the slot's prompt (slotPrompt), saved in
//              bucket studio under the batch → { result: 'ok', path, credits, model, run_id }. The batch itself is not written (the
//              page puts the path in the slot and saves, like 5.3's suggestions).
//   'edit'     (a studio image: products.add = F; a site product's image: products.edit = F; the admin both) { batch_id?, index?,
//              path | product_id, op: instruction | remove_bg | upscale | relight, prompt?, model?, options? } → a new image: a studio
//              path goes next to its batch, a product's image to bucket ai-images under the member → { result: 'ok', bucket, path, … }.
//   'create'   (the images tool; the admin or products.add / products.edit = F) { source: text | image, prompt?, shape, size, count,
//              model?, image? | product_id? } → 1–4 images in bucket ai-images under the member → { result: 'ok', bucket, paths, … }.
//   'probe'    (the admin) → the shape (keys only) of the provider's account answer, for T2.
// Every call is reserved first, in one locked step in the database (ai_image_run_start, 0025: the member's throttle; the images'
// monthly cap in credits — settings «ai».image_monthly_credits against this Cairo month's image rows, pending ones at their planned
// credits — over it → 402 ai_cap and a cap row; else a pending row holding the planned credits), and the row then holds the
// outcome: action 'image', the model, the credits the provider said (else the listed estimate), cost_usd = the estimate, an error
// code only — never a prompt, an image or the key. A product's photo is fetched from the site's host only (WOO_URL, plus the
// hosts in IMAGE_HOSTS), without following redirects, within a size and a time limit. Errors: 400 bad_request
// { field }, 401 unauthorized, 404 not_found, 402 ai_cap, 429 busy (the provider's limit or a timeout, or THROTTLE calls of the member
// in 10 minutes), 503 not_configured, 502 ai_error (no usable image), 200 { result: 'refused' } when the provider refused the content.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  MODEL_IDS, PROVIDER, creditsFor, editPrompt, extOf, imageSettings, line, parseCreate, parseEdit, parseGenerate, shapePrompt, slotPrompt, studioEditPath,
  studioGenPath, studioPathOk, toolPath, usdOf,
} from '../_shared/ai-images.js';
import { magnific, ProviderError, shape, type Provider, type Ref } from './providers/magnific.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  provider: Provider; fetch?: typeof fetch;
};

const ACTIONS = ['generate', 'edit', 'create', 'probe'];
const STUDIO_BUCKET = 'studio';
const TOOL_BUCKET = 'ai-images';
const THROTTLE = 60;
const THROTTLE_MINUTES = 10;
const MAX_REFS = 4;
const MAX_REF_BYTES = 12_000_000;
const FETCH_MS = 20_000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const stamp = (deps: Deps) => deps.now().replace(/[^0-9]/g, '').slice(2, 14) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------- auth

type Who = { uid: string; admin: boolean; add: boolean; edit: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && data === 'F'; };
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  return { uid, admin, add: admin || (await perm('products.add')), edit: admin || (await perm('products.edit')) };
}

// ---------------------------------------------------------------- settings, the cap, the run

async function settingsOf(deps: Deps) {
  const { data, error } = await deps.db.from('settings').select('data').eq('section', 'ai').maybeSingle();
  return imageSettings(!error && isObj(data) && isObj(data.data) ? data.data : null, deps.env);
}
// the reservation (0025 ai_image_run_start): the throttle, the credit cap and the pending row in one locked step — the cap is never
// checked here and reserved there, so two parallel calls cannot both pass it
async function startRun(deps: Deps, row: Json, credits: number, capCredits: number | null) {
  const { data, error } = await deps.db.rpc('ai_image_run_start', { p_row: row, p_cap_credits: capCredits, p_credits: credits, p_cost: usdOf(credits), p_throttle: THROTTLE, p_window_minutes: THROTTLE_MINUTES });
  if (error || !isObj(data)) return { result: 'error' as const };
  const id = Number(data.id);
  if (data.result === 'ok' && Number.isInteger(id)) return { result: 'ok' as const, id };
  return { result: data.result === 'busy' ? 'busy' as const : data.result === 'cap' ? 'cap' as const : 'error' as const };
}
async function finishRun(deps: Deps, id: number, row: Json) {
  const { error } = await deps.db.from('ai_runs').update(row).eq('id', id);
  if (error) console.error('ai_runs update failed', error.code ?? '');
}

type Stored = { bucket: string; path: string }[];
// The common path of the three actions: the cap, the reservation, the key, the provider, the files, the row.
async function runImages(deps: Deps, base: Json, model: string, count: number, work: () => Promise<{ images: { bytes: Uint8Array; mime: string }[]; credits: number | null }>, store: (img: { bytes: Uint8Array; mime: string }, n: number) => Promise<{ bucket: string; path: string } | null>): Promise<Response> {
  const planned = creditsFor(model, count);
  const cfg = await settingsOf(deps);
  // the planned credits are held on the pending row (the cap counts them while the call runs)
  const run = await startRun(deps, { ...base, model }, planned, cfg.monthlyCredits);
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  if (!deps.env.MAGNIFIC_API_KEY?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', credits: 0, cost_usd: 0 }); return json(503, { error: 'not_configured' }); }
  let out: { images: { bytes: Uint8Array; mime: string }[]; credits: number | null };
  try { out = await work(); } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'ai_error';
    // a lost answer (busy after a timeout) keeps its planned credits; a refusal or a clear error costs nothing here
    const credits = kind === 'busy' ? planned : 0;
    await finishRun(deps, run.id, { status: kind === 'refused' ? 'refused' : 'error', error: kind, credits, cost_usd: usdOf(credits) });
    if (kind === 'refused') return json(200, { result: 'refused', model, credits: 0, run_id: run.id });
    return json(kind === 'not_configured' ? 503 : kind === 'busy' ? 429 : 502, { error: kind });
  }
  const stored: Stored = [];
  for (let n = 0; n < out.images.length && n < count; n++) { const s = await store(out.images[n], n + 1); if (s) stored.push(s); }
  const credits = out.credits ?? planned;
  if (!stored.length) { await finishRun(deps, run.id, { status: 'error', error: 'ai_error', credits, cost_usd: usdOf(credits) }); return json(502, { error: 'ai_error' }); }
  await finishRun(deps, run.id, { status: 'ok', credits, cost_usd: usdOf(credits), output: { paths: stored.map((s) => s.path), bucket: stored[0].bucket } });
  return json(200, { result: 'ok', bucket: stored[0].bucket, path: stored[0].path, paths: stored.map((s) => s.path), credits, model, run_id: run.id });
}

// ---------------------------------------------------------------- files

async function download(db: Db, bucket: string, path: string): Promise<Ref | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REF_BYTES) return null;
  const ext = path.split('.').pop()!.toLowerCase();
  return { bytes, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}
async function upload(db: Db, bucket: string, path: string, img: { bytes: Uint8Array; mime: string }) {
  const { error } = await db.storage.from(bucket).upload(path, img.bytes, { contentType: img.mime, upsert: false });
  return error ? null : { bucket, path };
}
// the hosts a product photo may be fetched from: the site's (WOO_URL) and the ones listed in IMAGE_HOSTS (a CDN), exact names
function photoHosts(env: Deps['env']) {
  const hosts = new Set<string>();
  try { if (env.WOO_URL) hosts.add(new URL(env.WOO_URL).hostname.toLowerCase()); } catch { /* no site host */ }
  for (const h of (env.IMAGE_HOSTS ?? '').split(',')) { const x = h.trim().toLowerCase(); if (/^[a-z0-9.-]+$/.test(x)) hosts.add(x); }
  return hosts;
}
// a product's main image from the mirror, fetched by the server: https on an allowed host only, no redirects, a size and a time limit
async function productPhoto(deps: Deps, productId: number): Promise<Ref | null> {
  const { data } = await deps.db.from('products').select('id, image_url').eq('id', productId).maybeSingle();
  let url: URL | null = null;
  try { url = isObj(data) && typeof data.image_url === 'string' ? new URL(data.image_url) : null; } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.username || url.password || !photoHosts(deps.env).has(url.hostname.toLowerCase())) return null;
  try {
    const r = await (deps.fetch ?? fetch)(url.href, { redirect: 'error', signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) return null;
    const declared = Number(r.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REF_BYTES) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REF_BYTES) return null;
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { bytes, mime: ct === 'image/png' || ct === 'image/webp' ? ct : 'image/jpeg' };
  } catch { return null; }
}
const fromB64 = (image: { media_type: string; data: string }): Ref => ({ bytes: Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0)), mime: image.media_type });

// ---------------------------------------------------------------- generate (a studio slot)

async function readBatchItem(deps: Deps, batchId: string, index: number) {
  const { data: batch } = await deps.db.from('studio_batches').select('id, brand_id, state, archived_at').eq('id', batchId).maybeSingle();
  const items = isObj(batch?.state) && Array.isArray(batch.state.items) ? batch.state.items : [];
  const item = batch && !batch.archived_at ? items[index] : null;
  if (!isObj(item)) return null;
  const brand = batch.brand_id ? ((await deps.db.from('brands').select('name').eq('id', batch.brand_id).maybeSingle()).data?.name ?? '') : '';
  return { item, brand };
}
// the item's reference photos: its main photo first, then its references and the color's photo — this batch's paths only
async function itemRefs(deps: Deps, batchId: string, item: Json, slot: number | { color: string }) {
  const paths = [item.main, ...(Array.isArray(item.refs) ? item.refs : []), isObj(slot) && isObj(item.colorImages) ? item.colorImages[slot.color] : null]
    .filter((p): p is string => typeof p === 'string' && studioPathOk(batchId, p));
  const refs: Ref[] = [];
  for (const p of [...new Set(paths)].slice(0, MAX_REFS)) { const r = await download(deps.db, STUDIO_BUCKET, p); if (r) refs.push(r); }
  return refs;
}

async function generate(deps: Deps, who: Who, args: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const parsed = parseGenerate(args);
  if ('error' in parsed) return json(400, parsed);
  const { batchId, index, slot, model, size } = parsed.req;
  const read = await readBatchItem(deps, batchId, index);
  if (!read) return json(404, { error: 'not_found' });
  const refs = await itemRefs(deps, batchId, read.item, slot);
  if (!refs.length) return json(400, { error: 'bad_request', field: 'reference' });
  let colorName = '';
  if (isObj(slot)) colorName = ((await deps.db.from('sku_colors').select('name_en').eq('code', slot.color).maybeSingle()).data?.name_en ?? '') as string;
  const prompt = slotPrompt(read.item, slot, { brand: read.brand, colorName });
  const label = line(read.item.nameEn || read.item.nameAr || '', 200) || '#' + (index + 1);
  const base = { created_by: who.uid, action: 'image', source: 'studio', label, batch_id: batchId, item_index: index };
  const st = stamp(deps);
  return await runImages(deps, base, model, 1,
    () => deps.provider.generate({ model, prompt, width: size.w, height: size.h, count: 1, references: refs }),
    (img) => upload(deps.db, STUDIO_BUCKET, studioGenPath(batchId, index, slot, st, extOf(img.mime)), img));
}

// ---------------------------------------------------------------- edit (a studio image or a product's image)

async function edit(deps: Deps, who: Who, args: Json) {
  const parsed = parseEdit(args);
  if ('error' in parsed) return json(400, parsed);
  const { batchId, path, productId, op, prompt, model, options } = parsed.req;
  let image: Ref | null = null; let base: Json; let where: (img: { bytes: Uint8Array; mime: string }, n: number) => Promise<{ bucket: string; path: string } | null>;
  if (path) {
    if (!who.add) return json(401, { error: 'unauthorized' });
    if (!batchId || !studioPathOk(batchId, path)) return json(400, { error: 'bad_request', field: 'path' });
    const index = Number.isInteger(args.index) && args.index >= 0 && args.index <= 999 ? args.index : 0;
    const read = await readBatchItem(deps, batchId, index);
    if (!read) return json(404, { error: 'not_found' });
    image = await download(deps.db, STUDIO_BUCKET, path);
    const label = line(read.item.nameEn || read.item.nameAr || '', 200) || '#' + (index + 1);
    base = { created_by: who.uid, action: 'image', source: 'edit', label, batch_id: batchId, item_index: index };
    const st = stamp(deps);
    where = (img) => upload(deps.db, STUDIO_BUCKET, studioEditPath(batchId, index, st, extOf(img.mime)), img);
  } else {
    if (!who.edit) return json(401, { error: 'unauthorized' });
    image = await productPhoto(deps, productId as number);
    const { data: p } = await deps.db.from('products').select('id, name').eq('id', productId).maybeSingle();
    if (!p) return json(404, { error: 'not_found' });
    base = { created_by: who.uid, action: 'image', source: 'edit', label: line(p.name ?? '', 200) || '#' + productId, product_id: productId };
    const st = stamp(deps);
    where = (img, n) => upload(deps.db, TOOL_BUCKET, toolPath(who.uid, st, n, extOf(img.mime)), img);
  }
  if (!image) return json(404, { error: 'not_found' });
  const ref = image;
  return await runImages(deps, base, model, 1,
    () => deps.provider.edit({ model, op, prompt: editPrompt(op, prompt, options), image: ref, options }),
    (img, n) => where(img, n));
}

// ---------------------------------------------------------------- create (the images tool)

async function create(deps: Deps, who: Who, args: Json) {
  if (!who.add && !who.edit) return json(401, { error: 'unauthorized' });
  const parsed = parseCreate(args);
  if ('error' in parsed) return json(400, parsed);
  const { source, prompt, shape, size, count, model, image, productId } = parsed.req;
  const refs: Ref[] = [];
  let subject = '';
  if (source === 'image') {
    if (image) refs.push(fromB64(image));
    else if (productId) {
      const { data: p } = await deps.db.from('products').select('id, name').eq('id', productId).maybeSingle();
      if (!p) return json(404, { error: 'not_found' });
      subject = p.name ?? '';
      const ref = await productPhoto(deps, productId); if (ref) refs.push(ref);
    }
    if (!refs.length) return json(400, { error: 'bad_request', field: 'image' });
  }
  const full = shapePrompt(shape, subject, prompt);
  const label = line(subject || prompt, 200) || 'صورة';
  const base = { created_by: who.uid, action: 'image', source: 'tool', label, product_id: productId };
  const st = stamp(deps);
  return await runImages(deps, base, model, count,
    () => deps.provider.generate({ model, prompt: full, width: size.w, height: size.h, count, references: refs }),
    (img, n) => upload(deps.db, TOOL_BUCKET, toolPath(who.uid, st, n, extOf(img.mime)), img));
}

// ---------------------------------------------------------------- handler

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(body) ? body : {};
  const action = typeof args.action === 'string' ? args.action : '';
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'generate') return await generate(deps, who, args);
    if (action === 'edit') return await edit(deps, who, args);
    if (action === 'create') return await create(deps, who, args);
    if (!who.admin) return json(401, { error: 'unauthorized' });
    // the probe's outcome is kept as an ai_runs row (label 'probe', 0 credits: configured = the key is set, status = the
    // provider's HTTP status, shape = keys and types only) so the T2 diagnosis can be read from the database — never the key
    const configured = !!deps.env.MAGNIFIC_API_KEY?.trim();
    const record = (status: 'ok' | 'error', error: string | null, output: Json) =>
      deps.db.from('ai_runs').insert({ created_by: who.uid, action: 'image', source: 'tool', label: 'probe', status, error, credits: 0, cost_usd: 0, output: { probe: true, configured, ...output } });
    if (!configured) { await record('error', 'not_configured', { status: null }); return json(503, { error: 'not_configured' }); }
    // the shape only (keys and types, no values) of the provider's account answer — enough to pin the layer in T2, nothing to leak
    try { const sh = shape(await deps.provider.probe()); await record('ok', null, { status: 200, shape: sh }); return json(200, { result: 'ok', provider: PROVIDER, shape: sh, models: MODEL_IDS }); }
    catch (e) { const kind = e instanceof ProviderError ? e.kind : 'ai_error'; const status = e instanceof ProviderError ? e.status : null; await record('error', kind, { status }); return json(kind === 'not_configured' ? 503 : kind === 'busy' ? 429 : 502, { error: kind, status }); }
  } catch (e) {
    console.error('ai-images failed', e instanceof Error ? e.name : typeof e);
    return json(500, { error: 'failed' });
  }
}

// ---------------------------------------------------------------- runtime wiring

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    provider: magnific(env),
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
