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
//   'webp'     (decision 7: every result ends as WebP — the browser re-encodes it, this function's CPU budget being too small for
//              a 2K image) { bucket: studio | ai-images, path, run_id?, image: { data: base64 WebP } } → the WebP stored under the
//              same name with .webp (upsert), the original removed, the run row's path renamed → { result: 'ok', bucket, path }.
//              A studio path needs products.add and its batch; a tool path the member's own folder (the admin any). No credits.
//   'import'   (decision 8: a set made on the Magnific site, queued in image_imports by a Claude session through the Magnific MCP)
//              { id } → the row's links (https on IMPORT_HOSTS — pikaso.cdnpk.net by default — no redirects, a size and time
//              limit) fetched and stored under the importing member in bucket ai-images, one ai_runs row (source 'import', 0
//              credits), the queue row ok / partial / error with the paths → { result: 'ok', bucket, paths, imported, failed }.
//              The row's owner or the admin; a partial set is finished on the next call, an ok one answers 409 done.
//              target 'studio' (decision 9) makes a studio batch of the queued items; target 'batch' (decision 10 c) puts the
//              images into the product slots of an existing batch (items: [{ index, images }]).
//   'share'    (decision 10 b: «ابعت الصور لـ Magnific», products.add) { batch_id, indexes? } → one image_shares row per product
//              photo not shared yet (a signed link of a week, the product's name as the file name) for the bridge to upload to the
//              site's project → { result: 'ok', shared, skipped }.
//   'bridge_*' (decision 11: the system itself as the Magnific site's MCP client — providers/magnific-mcp.ts; the OAuth client and
//              the linked account's tokens in Vault through 0029's magnific_secret_get / set): bridge_status (the tool's members:
//              linked?; the admin also the account, configured, redirect), bridge_link (the admin → the sign-in url; the PKCE state
//              kept ten minutes in magnific_oauth_states), bridge_callback { code, state } (the admin, from app/magnific-callback.html
//              → the tokens into Vault), bridge_unlink (the admin), bridge_upload { batch_id, indexes? } (products.add: the batch's
//              product photos up to the project now — creations_upload_image with the product's name — image_shares rows sent /
//              error → { uploaded, failed, skipped }; 503 not_linked when no account is linked), bridge_fetch { batch_id }
//              (products.add: the project's new results matched to the sent photos by lineage / family / name → one image_imports
//              row of target batch → importBatch in the same call → its answer + found, unmatched, import_id).
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
import { BridgeError, magnificMcp, randomText, type Bridge, type Tokens } from './providers/magnific-mcp.ts';
import { REF, creationsOf, familyOf, flowNodes, importShape, lastPageOf, lineageIds, listIdsOf, matchResults, nodeDataOf, nodesOf, templatePrompts, uploadedId, urlsById } from '../_shared/magnific-bridge.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  provider: Provider; fetch?: typeof fetch;
  bridge?: Bridge; // decision 11: the Magnific site's MCP (OAuth + tools) — the system's own client
};

const ACTIONS = ['generate', 'edit', 'create', 'probe', 'webp', 'import', 'share', 'bridge_status', 'bridge_link', 'bridge_callback', 'bridge_unlink', 'bridge_upload', 'bridge_fetch', 'bridge_prompts_sync', 'bridge_flow'];
const SHARE_SECONDS = 7 * 24 * 3600; // a shared photo's link lives a week (the bridge uploads it to the site within that)
const MAX_WEBP_B64 = 14_000_000; // ≈ 10 MB of WebP
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
  // the two faces of not_configured, told apart for the admin: the secret is not set (configured false) / the provider refused the key (status)
  if (!deps.env.MAGNIFIC_API_KEY?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', credits: 0, cost_usd: 0, output: { configured: false } }); return json(503, { error: 'not_configured', configured: false }); }
  let out: { images: { bytes: Uint8Array; mime: string }[]; credits: number | null };
  try { out = await work(); } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'ai_error';
    // a lost answer (busy after a timeout) keeps its planned credits; a refusal or a clear error costs nothing here
    const credits = kind === 'busy' ? planned : 0;
    const status = e instanceof ProviderError ? e.status : null;
    const detail = e instanceof ProviderError ? e.detail : e instanceof Error ? line(e.name + ': ' + e.message, 200) : null;
    await finishRun(deps, run.id, { status: kind === 'refused' ? 'refused' : 'error', error: kind, credits, cost_usd: usdOf(credits), output: { configured: true, status, detail } });
    if (kind === 'refused') return json(200, { result: 'refused', model, credits: 0, run_id: run.id });
    return json(kind === 'not_configured' ? 503 : kind === 'busy' ? 429 : 502, { error: kind, configured: true, status });
  }
  const stored: Stored = [];
  for (let n = 0; n < out.images.length && n < count; n++) { const s = await store(out.images[n], n + 1); if (s) stored.push(s); }
  const credits = out.credits ?? planned;
  if (!stored.length) { await finishRun(deps, run.id, { status: 'error', error: 'ai_error', credits, cost_usd: usdOf(credits) }); return json(502, { error: 'ai_error' }); }
  await finishRun(deps, run.id, { status: 'ok', credits, cost_usd: usdOf(credits), output: { paths: stored.map((s) => s.path), bucket: stored[0].bucket } });
  return json(200, { result: 'ok', bucket: stored[0].bucket, path: stored[0].path, paths: stored.map((s) => s.path), credits, model, run_id: run.id });
}

// ---------------------------------------------------------------- files

const SIGN_SECONDS = 600;
// an image of a bucket as the provider's reference: its bytes and a signed https link good for ten minutes (the provider fetches
// the original by the link; the bytes stay the fallback)
async function download(db: Db, bucket: string, path: string): Promise<Ref | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REF_BYTES) return null;
  const ext = path.split('.').pop()!.toLowerCase();
  const { data: sg } = await db.storage.from(bucket).createSignedUrl(path, SIGN_SECONDS);
  const url = typeof sg?.signedUrl === 'string' && /^https:\/\//.test(sg.signedUrl) ? sg.signedUrl : null;
  return { bytes, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', url };
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
    return { bytes, mime: ct === 'image/png' || ct === 'image/webp' ? ct : 'image/jpeg', url: url.href };
  } catch { return null; }
}
// the tool's photo (base64 from the browser): kept in the member's folder as the source and signed, so the provider gets a link
async function storedPhoto(deps: Deps, uid: string, image: { media_type: string; data: string }, st: string): Promise<Ref> {
  const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
  const path = `${uid}/src-${st}.${extOf(image.media_type)}`;
  const up = await upload(deps.db, TOOL_BUCKET, path, { bytes, mime: image.media_type });
  const { data: sg } = up ? await deps.db.storage.from(TOOL_BUCKET).createSignedUrl(path, SIGN_SECONDS) : { data: null };
  return { bytes, mime: image.media_type, url: typeof sg?.signedUrl === 'string' && /^https:\/\//.test(sg.signedUrl) ? sg.signedUrl : null };
}

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
  let image: Ref | null = null; let imageUrl: string | null = null; let base: Json; let where: (img: { bytes: Uint8Array; mime: string }, n: number) => Promise<{ bucket: string; path: string } | null>;
  if (path) {
    if (!who.add) return json(401, { error: 'unauthorized' });
    if (!batchId || !studioPathOk(batchId, path)) return json(400, { error: 'bad_request', field: 'path' });
    const index = Number.isInteger(args.index) && args.index >= 0 && args.index <= 999 ? args.index : 0;
    const read = await readBatchItem(deps, batchId, index);
    if (!read) return json(404, { error: 'not_found' });
    image = await download(deps.db, STUDIO_BUCKET, path);
    // the background cutout takes a URL: a signed one of the bucket, good for ten minutes
    if (op === 'remove_bg') { const { data: sg } = await deps.db.storage.from(STUDIO_BUCKET).createSignedUrl(path, 600); imageUrl = typeof sg?.signedUrl === 'string' ? sg.signedUrl : null; }
    const label = line(read.item.nameEn || read.item.nameAr || '', 200) || '#' + (index + 1);
    base = { created_by: who.uid, action: 'image', source: 'edit', label, batch_id: batchId, item_index: index };
    const st = stamp(deps);
    where = (img) => upload(deps.db, STUDIO_BUCKET, studioEditPath(batchId, index, st, extOf(img.mime)), img);
  } else {
    if (!who.edit) return json(401, { error: 'unauthorized' });
    image = await productPhoto(deps, productId as number);
    const { data: p } = await deps.db.from('products').select('id, name, image_url').eq('id', productId).maybeSingle();
    if (!p) return json(404, { error: 'not_found' });
    imageUrl = image && typeof p.image_url === 'string' ? p.image_url : null; // the mirror's https photo (productPhoto checked its host)
    base = { created_by: who.uid, action: 'image', source: 'edit', label: line(p.name ?? '', 200) || '#' + productId, product_id: productId };
    const st = stamp(deps);
    where = (img, n) => upload(deps.db, TOOL_BUCKET, toolPath(who.uid, st, n, extOf(img.mime)), img);
  }
  if (!image) return json(404, { error: 'not_found' });
  const ref = image;
  return await runImages(deps, base, model, 1,
    () => deps.provider.edit({ model, op, prompt: editPrompt(op, prompt, options), image: ref, imageUrl, options }),
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
  const st = stamp(deps);
  if (source === 'image') {
    if (image) refs.push(await storedPhoto(deps, who.uid, image, st));
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
  return await runImages(deps, base, model, count,
    () => deps.provider.generate({ model, prompt: full, width: size.w, height: size.h, count, references: refs }),
    (img, n) => upload(deps.db, TOOL_BUCKET, toolPath(who.uid, st, n, extOf(img.mime)), img));
}

// ---------------------------------------------------------------- webp (the browser's re-encoding of a result)

const isWebp = (b: Uint8Array) => b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
async function webp(deps: Deps, who: Who, args: Json) {
  const bucket = args.bucket === STUDIO_BUCKET ? STUDIO_BUCKET : args.bucket === TOOL_BUCKET ? TOOL_BUCKET : null;
  if (!bucket) return json(400, { error: 'bad_request', field: 'bucket' });
  const path = typeof args.path === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,120}\.(webp|png|jpe?g)$/i.test(args.path) ? args.path : null;
  if (!path) return json(400, { error: 'bad_request', field: 'path' });
  const data = isObj(args.image) && typeof args.image.data === 'string' && args.image.data.length && args.image.data.length <= MAX_WEBP_B64 && /^[A-Za-z0-9+/]+=*$/.test(args.image.data) ? args.image.data : null;
  if (!data) return json(400, { error: 'bad_request', field: 'image' });
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { return json(400, { error: 'bad_request', field: 'image' }); }
  if (!isWebp(bytes)) return json(400, { error: 'bad_request', field: 'image' });
  // whose: a studio path → products.add and an open batch of that id; a tool path → the member's own folder (the admin any)
  if (bucket === STUDIO_BUCKET) {
    if (!who.add) return json(401, { error: 'unauthorized' });
    const batchId = path.split('/')[0];
    if (!studioPathOk(batchId, path)) return json(400, { error: 'bad_request', field: 'path' });
    const { data: batch } = await deps.db.from('studio_batches').select('id, archived_at').eq('id', batchId).maybeSingle();
    if (!batch || batch.archived_at) return json(404, { error: 'not_found' });
  } else {
    if (!who.add && !who.edit) return json(401, { error: 'unauthorized' });
    if (!who.admin && !path.startsWith(who.uid + '/')) return json(401, { error: 'unauthorized' });
  }
  const { data: original, error: dlErr } = await deps.db.storage.from(bucket).download(path);
  if (dlErr || !original) return json(404, { error: 'not_found' });
  const target = path.replace(/\.[a-z]+$/i, '.webp');
  const { error: upErr } = await deps.db.storage.from(bucket).upload(target, bytes, { contentType: 'image/webp', upsert: true });
  if (upErr) return json(502, { error: 'failed' });
  if (target !== path) await deps.db.storage.from(bucket).remove([path]);
  // the run row (the member's own, or any for the admin) keeps the new name in its paths
  const runId = Number(args.run_id);
  if (Number.isInteger(runId) && runId > 0) {
    const { data: row } = await deps.db.from('ai_runs').select('id, created_by, output').eq('id', runId).maybeSingle();
    if (isObj(row) && (who.admin || row.created_by === who.uid) && isObj(row.output) && Array.isArray(row.output.paths) && row.output.paths.includes(path)) {
      await deps.db.from('ai_runs').update({ output: { ...row.output, paths: row.output.paths.map((p: unknown) => (p === path ? target : p)) } }).eq('id', runId);
    }
  }
  return json(200, { result: 'ok', bucket, path: target });
}

// ---------------------------------------------------------------- import (decision 8: a queued set from the Magnific site)

const IMPORT_HOSTS_DEFAULT = ['pikaso.cdnpk.net']; // where the Magnific site's library links live (the MCP's creations_get urls)
const MAX_IMPORT = 50;
function importHosts(env: Deps['env']) {
  const hosts = new Set<string>(IMPORT_HOSTS_DEFAULT);
  for (const h of (env.IMPORT_HOSTS ?? '').split(',')) { const x = h.trim().toLowerCase(); if (/^[a-z0-9.-]+$/.test(x)) hosts.add(x); }
  return hosts;
}
// one link of the set: https on an allowed host, no credentials, no redirects, a size and a time limit, an image type → bytes + mime
async function importOne(deps: Deps, raw: unknown): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let url: URL | null = null;
  try { url = typeof raw === 'string' ? new URL(raw) : null; } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.username || url.password || !importHosts(deps.env).has(url.hostname.toLowerCase())) return null;
  try {
    const r = await (deps.fetch ?? fetch)(url.href, { redirect: 'error', signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) return null;
    const declared = Number(r.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REF_BYTES) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REF_BYTES) return null;
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const mime = ct === 'image/png' || ct === 'image/webp' || ct === 'image/jpeg' ? ct : /\.png(\?|$)/i.test(url.pathname) ? 'image/png' : /\.webp(\?|$)/i.test(url.pathname) ? 'image/webp' : 'image/jpeg';
    return { bytes, mime };
  } catch { return null; }
}
// decision 9: the queued items (what the bridge read from the creations' names) as studio items — the shape the studio page
// keeps in studio_batches.state.items (applySheet / syncVariations in products-studio.js): colors by code from sku_colors
// (unknown names wait in unknownColors for «+ لون جديد»), Variable → colors × sizes, the images by their place in urls
type ColorRow = { code: string; name_en: string; name_ar: string | null };
function studioItems(items: unknown[], paths: (string | null)[], type: string, colorRows: ColorRow[], old: Json[]) {
  const byName = (n: string) => { const k = n.trim().toLowerCase(); return colorRows.find((c) => c.name_en.toLowerCase() === k || String(c.name_ar ?? '').trim() === n.trim()) ?? null; };
  const text = (v: unknown, max: number) => (typeof v === 'string' ? line(v, max) : '');
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => line(x, max)).slice(0, 30) : []);
  return items.slice(0, 100).map((raw, i) => {
    const it: Json = isObj(raw) ? raw : {};
    const prev: Json = isObj(old[i]) ? old[i] : {};
    const names = list(it.colors, 60); const found = names.map((n) => byName(n));
    let colors = found.filter((c): c is ColorRow => !!c).map((c) => c.code); const unknownColors = names.filter((_, k) => !found[k]);
    let sizes = list(it.sizes, 30);
    if (type !== 'Variable') { colors = colors.slice(0, 1); sizes = sizes.slice(0, 1); }
    const price = Number(it.vendorPrice); const vendorPrice = Number.isFinite(price) && price > 0 ? price : null;
    const stockN = Number(it.stock); const stock = Number.isInteger(stockN) && stockN >= 0 ? stockN : null;
    const idx = Array.isArray(it.images) ? it.images.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < paths.length) : [];
    const mainPath = idx.length ? paths[idx[0]] : null; const refPaths = idx.slice(1).map((n) => paths[n]).filter((p): p is string => !!p); // by their place: a failed main stays empty for the retry
    const variations: Json[] = [];
    if (type === 'Variable') { for (const c of colors.length ? colors : [null]) for (const s of sizes.length ? sizes : [null]) { if (c === null && s === null) continue; variations.push({ color: c, size: s, vendorPrice, stock: null, onDemand: false }); } }
    return {
      key: typeof prev.key === 'string' ? prev.key : 'imp' + i + '-' + Math.random().toString(36).slice(2, 8), row: null, nameEn: text(it.nameEn, 200), nameAr: text(it.nameAr, 200), vendorPrice, colors, unknownColors, sizes,
      material: text(it.material, 80), style: text(it.style, 80), weight: text(it.weight, 20), stock, onDemand: false, shortDesc: text(it.shortDesc, 500), shortDescAr: text(it.shortDescAr, 500),
      categories: Array.isArray(prev.categories) ? prev.categories : [], main: typeof prev.main === 'string' ? prev.main : mainPath, refs: Array.isArray(prev.refs) && prev.refs.length ? prev.refs : refPaths,
      slots: Array.isArray(prev.slots) ? prev.slots : [], colorImages: isObj(prev.colorImages) ? prev.colorImages : {}, variations: Array.isArray(prev.variations) && prev.variations.length ? prev.variations : variations, sheetVariations: null,
    };
  });
}
async function importSet(deps: Deps, who: Who, args: Json) {
  if (!who.add && !who.edit) return json(401, { error: 'unauthorized' });
  const id = Number(args.id);
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request', field: 'id' });
  const { data: row } = await deps.db.from('image_imports').select('id, created_by, source, folder, label, product_id, urls, status, paths, target, items, brand_id, vendor_id, batch_type, batch_id').eq('id', id).maybeSingle();
  if (!isObj(row)) return json(404, { error: 'not_found' });
  if (!who.admin && row.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  if (row.status === 'ok') return json(409, { error: 'done' });
  if (row.target === 'studio') return await importStudio(deps, who, row);
  if (row.target === 'batch') return await importBatch(deps, who, row);
  const urls: unknown[] = Array.isArray(row.urls) ? row.urls.slice(0, MAX_IMPORT) : [];
  const paths: (string | null)[] = Array.isArray(row.paths) ? row.paths.map((p: unknown) => (typeof p === 'string' ? p : null)) : [];
  const st = stamp(deps);
  let stored = 0;
  // the links without a stored path yet (a partial set is finished, not redone), each under the importing member
  for (let i = 0; i < urls.length; i++) {
    if (paths[i]) { stored++; continue; }
    const img = await importOne(deps, urls[i]);
    const up = img ? await upload(deps.db, TOOL_BUCKET, toolPath(who.uid, 'imp-' + st, i + 1, extOf(img.mime)), img) : null;
    paths[i] = up ? up.path : null;
    if (up) stored++;
  }
  const status = stored === urls.length ? 'ok' : stored ? 'partial' : 'error';
  const label = line(typeof row.label === 'string' ? row.label : '', 200) || (typeof row.folder === 'string' ? line(row.folder, 200) : '') || 'وارد';
  const done = paths.filter((p): p is string => !!p);
  const { data: run } = await deps.db.from('ai_runs').insert({ created_by: who.uid, action: 'image', source: 'import', label, product_id: row.product_id ?? null, model: null, status: stored ? 'ok' : 'error', error: stored ? null : 'import_failed', credits: 0, cost_usd: 0, output: { paths: done, bucket: TOOL_BUCKET, import_id: id, failed: urls.length - stored } }).select('id').single();
  const runId = isObj(run) && Number.isInteger(Number(run.id)) ? Number(run.id) : null;
  await deps.db.from('image_imports').update({ status, paths, error: stored ? null : 'import_failed', run_id: runId, done_at: status === 'ok' ? deps.now() : null }).eq('id', id);
  if (!stored) return json(502, { error: 'ai_error' });
  return json(200, { result: 'ok', target: 'tool', bucket: TOOL_BUCKET, path: done[0], paths: done, credits: 0, model: '', run_id: runId, imported: stored, failed: urls.length - stored, status });
}
// decision 9: the set becomes a studio batch (products.add): the brand / maker / type as queued, the images as the items' photos
// in bucket studio under the batch, step 2 («الاستلام») for the owner to review; a retry finishes the missing photos on the same batch
async function importStudio(deps: Deps, who: Who, row: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const urls: unknown[] = Array.isArray(row.urls) ? row.urls.slice(0, MAX_IMPORT) : [];
  const paths: (string | null)[] = Array.isArray(row.paths) ? row.paths.map((p: unknown) => (typeof p === 'string' ? p : null)) : [];
  const type = row.batch_type === 'Variable' ? 'Variable' : 'Simple';
  const brand = typeof row.brand_id === 'string' ? (await deps.db.from('brands').select('id, name').eq('id', row.brand_id).maybeSingle()).data : null;
  const vendor = typeof row.vendor_id === 'string' ? (await deps.db.from('vendors').select('id, name').eq('id', row.vendor_id).maybeSingle()).data : null;
  const brandName = isObj(brand) && typeof brand.name === 'string' ? brand.name : '';
  const vendorName = isObj(vendor) && typeof vendor.name === 'string' ? vendor.name : '';
  // the batch: the one of an earlier (partial) run, else a new one of the importing member
  let batchId = typeof row.batch_id === 'string' ? row.batch_id : null; let oldItems: Json[] = [];
  if (batchId) {
    const { data: b } = await deps.db.from('studio_batches').select('id, state, archived_at').eq('id', batchId).maybeSingle();
    if (isObj(b) && !b.archived_at) oldItems = isObj(b.state) && Array.isArray(b.state.items) ? b.state.items : []; else batchId = null;
  }
  if (!batchId) {
    const title = line((typeof row.label === 'string' && row.label.trim()) || (typeof row.folder === 'string' && row.folder.trim()) || brandName || 'Magnific', 80) + ' — ' + type + ' · ' + deps.now().slice(0, 10);
    const fresh = crypto.randomUUID();
    const { error: mkErr } = await deps.db.from('studio_batches').insert({ id: fresh, title, brand_id: isObj(brand) ? brand.id : null, vendor_id: isObj(vendor) ? vendor.id : null, type, state: {}, step: 2, status: 'draft', created_by: who.uid });
    if (mkErr) return json(502, { error: 'failed' });
    batchId = fresh;
  }
  const st = stamp(deps);
  let stored = 0;
  const items: unknown[] = Array.isArray(row.items) ? row.items : [];
  const firstOf = new Set(items.map((it) => (isObj(it) && Array.isArray(it.images) ? it.images[0] : null)));
  for (let i = 0; i < urls.length; i++) {
    if (paths[i]) { stored++; continue; }
    const img = await importOne(deps, urls[i]);
    const up = img ? await upload(deps.db, STUDIO_BUCKET, `${batchId}/row${i + 1}-${firstOf.has(i) ? 'main' : 'ref'}-${st}.${extOf(img.mime)}`, img) : null;
    paths[i] = up ? up.path : null;
    if (up) stored++;
  }
  const { data: colorRows } = await deps.db.from('sku_colors').select('code, name_en, name_ar');
  const state = { v: 1, type, vary: ['color'], brandId: isObj(brand) ? brand.id : null, brandName, vendorId: isObj(vendor) ? vendor.id : null, vendorName, rate: null, fee: null, sheet: null, imgCount: 4,
    items: studioItems(items, paths, type, Array.isArray(colorRows) ? colorRows : [], oldItems), imported: { import_id: row.id, source: row.source ?? 'magnific' } };
  await deps.db.from('studio_batches').update({ state, type, brand_id: state.brandId, vendor_id: state.vendorId }).eq('id', batchId);
  const status = stored === urls.length ? 'ok' : stored ? 'partial' : 'error';
  const label = line(typeof row.label === 'string' ? row.label : '', 200) || (typeof row.folder === 'string' ? line(row.folder, 200) : '') || 'وارد';
  const done = paths.filter((p): p is string => !!p);
  const { data: run } = await deps.db.from('ai_runs').insert({ created_by: who.uid, action: 'image', source: 'import', label, batch_id: batchId, model: null, status: stored ? 'ok' : 'error', error: stored ? null : 'import_failed', credits: 0, cost_usd: 0, output: { paths: done, bucket: STUDIO_BUCKET, import_id: row.id, failed: urls.length - stored, items: items.length } }).select('id').single();
  const runId = isObj(run) && Number.isInteger(Number(run.id)) ? Number(run.id) : null;
  await deps.db.from('image_imports').update({ status, paths, batch_id: batchId, error: stored ? null : 'import_failed', run_id: runId, done_at: status === 'ok' ? deps.now() : null }).eq('id', row.id);
  if (!stored) return json(502, { error: 'ai_error' });
  return json(200, { result: 'ok', target: 'studio', bucket: STUDIO_BUCKET, batch_id: batchId, path: done[0], paths: done, credits: 0, model: '', run_id: runId, imported: stored, failed: urls.length - stored, status, items: items.length });
}

// decision 10 (c): the site's results back into the batch they were made for — each queued item names the product (index) and
// its images (places in urls); the images land in the product's empty slots in order (past imgCount they stay saved for a bigger
// count), never over a slot already filled; the batch must be open and the member's own (the admin any)
async function importBatch(deps: Deps, who: Who, row: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const batchId = typeof row.batch_id === 'string' ? row.batch_id : null;
  if (!batchId) return json(400, { error: 'bad_request', field: 'batch_id' });
  const { data: batch } = await deps.db.from('studio_batches').select('id, state, archived_at, created_by').eq('id', batchId).maybeSingle();
  if (!isObj(batch) || batch.archived_at) return json(404, { error: 'not_found' });
  if (!who.admin && batch.created_by && batch.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  const state: Json = isObj(batch.state) ? batch.state : {};
  const items: Json[] = Array.isArray(state.items) ? state.items : [];
  const urls: unknown[] = Array.isArray(row.urls) ? row.urls.slice(0, MAX_IMPORT) : [];
  const paths: (string | null)[] = Array.isArray(row.paths) ? row.paths.map((p: unknown) => (typeof p === 'string' ? p : null)) : [];
  const queued: Json[] = Array.isArray(row.items) ? row.items.filter(isObj) : [];
  const st = stamp(deps);
  let stored = 0; let placed = 0;
  for (const q of queued) {
    const index = Number(q.index); const it = Number.isInteger(index) ? items[index] : null;
    if (!isObj(it)) continue;
    const idx = Array.isArray(q.images) ? q.images.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < urls.length) : [];
    // decision 12: a flow's results name their slot (shot 1 → slot 0 …); an image without one takes the first empty slot
    const wanted: (number | null)[] = Array.isArray(q.slots) ? q.slots.map((s: unknown) => (Number.isInteger(s) && (s as number) >= 0 && (s as number) < 6 ? s as number : null)) : [];
    if (!Array.isArray(it.slots)) it.slots = [];
    for (let j = 0; j < idx.length; j++) {
      const n = idx[j];
      if (!paths[n]) {
        const img = await importOne(deps, urls[n]);
        const up = img ? await upload(deps.db, STUDIO_BUCKET, `${batchId}/gen-${index}-imp-${st}-${n + 1}.${extOf(img.mime)}`, img) : null;
        paths[n] = up ? up.path : null;
        if (!up) continue;
        stored++;
      } else stored++;
      if (it.slots.includes(paths[n])) continue; // placed on an earlier (partial) run
      const want = wanted[j];
      let k = want !== null && want !== undefined && !it.slots[want] ? want : 0;
      if (k === 0 && !(want !== null && want !== undefined && !it.slots[want])) { while (k < it.slots.length && it.slots[k]) k++; }
      it.slots[k] = paths[n]; placed++;
    }
  }
  await deps.db.from('studio_batches').update({ state: { ...state, items } }).eq('id', batchId);
  const status = stored === urls.length ? 'ok' : stored ? 'partial' : 'error';
  const label = line(typeof row.label === 'string' ? row.label : '', 200) || 'وارد';
  const done = paths.filter((p): p is string => !!p);
  const { data: run } = await deps.db.from('ai_runs').insert({ created_by: who.uid, action: 'image', source: 'import', label, batch_id: batchId, model: null, status: stored ? 'ok' : 'error', error: stored ? null : 'import_failed', credits: 0, cost_usd: 0, output: { paths: done, bucket: STUDIO_BUCKET, import_id: row.id, failed: urls.length - stored, placed } }).select('id').single();
  const runId = isObj(run) && Number.isInteger(Number(run.id)) ? Number(run.id) : null;
  await deps.db.from('image_imports').update({ status, paths, error: stored ? null : 'import_failed', run_id: runId, done_at: status === 'ok' ? deps.now() : null }).eq('id', row.id);
  if (!stored) return json(502, { error: 'ai_error' });
  return json(200, { result: 'ok', target: 'batch', bucket: STUDIO_BUCKET, batch_id: batchId, path: done[0], paths: done, credits: 0, model: '', run_id: runId, imported: stored, failed: urls.length - stored, status, placed });
}

// ---------------------------------------------------------------- share (decision 10 b: the batch's product photos to the Magnific site)

async function share(deps: Deps, who: Who, args: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const batchId = typeof args.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(args.batch_id) ? args.batch_id : null;
  if (!batchId) return json(400, { error: 'bad_request', field: 'batch_id' });
  const { data: batch } = await deps.db.from('studio_batches').select('id, state, archived_at, created_by').eq('id', batchId).maybeSingle();
  if (!isObj(batch) || batch.archived_at) return json(404, { error: 'not_found' });
  if (!who.admin && batch.created_by && batch.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  const items: Json[] = isObj(batch.state) && Array.isArray(batch.state.items) ? batch.state.items : [];
  const only = Array.isArray(args.indexes) ? new Set(args.indexes.filter((n: unknown) => Number.isInteger(n))) : null;
  const { data: had } = await deps.db.from('image_shares').select('path, status').eq('batch_id', batchId);
  const shared = new Set((Array.isArray(had) ? had : []).filter((r: Json) => r.status !== 'error').map((r: Json) => r.path));
  let made = 0, skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; if (!isObj(it) || (only && !only.has(i))) continue;
    const path = typeof it.main === 'string' && studioPathOk(batchId, it.main) ? it.main : null;
    if (!path || shared.has(path)) { skipped++; continue; }
    const { data: sg } = await deps.db.storage.from(STUDIO_BUCKET).createSignedUrl(path, SHARE_SECONDS);
    const url = typeof sg?.signedUrl === 'string' && /^https:\/\//.test(sg.signedUrl) ? sg.signedUrl : null;
    if (!url) { skipped++; continue; }
    // the file name the bridge gives the site: the product's name as a strict file name (letters, digits, space . _ -; no path parts)
    const stem = String(it.nameEn || it.nameAr || '').replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '');
    const name = (stem || 'product-' + (i + 1)) + '.' + (/^(jpe?g|png|webp)$/i.test(path.split('.').pop() ?? '') ? path.split('.').pop() : 'jpg');
    const { error } = await deps.db.from('image_shares').insert({ created_by: who.uid, batch_id: batchId, item_index: i, item_key: typeof it.key === 'string' ? it.key.slice(0, 60) : null, name, path, url, expires_at: new Date(Date.parse(deps.now()) + SHARE_SECONDS * 1000).toISOString(), status: 'pending' });
    if (error) { skipped++; continue; }
    made++;
  }
  return json(200, { result: 'ok', batch_id: batchId, shared: made, skipped });
}

// ---------------------------------------------------------------- the bridge (decision 11: the system as the Magnific site's MCP client)
// The two secrets live in Vault behind magnific_secret_get / magnific_secret_set (0029, service_role only): magnific_mcp_client
// ({ client_id, … } — the OAuth client the system registered at auth.magnific.com) and magnific_mcp_tokens (the linked account's
// access + refresh tokens, their expiry and the account's email). They are read into memory here and go nowhere else.

const PROJECT_REF_DEFAULT = 'f3b8e918-1fac-49a7-9196-8d22ca637a8e'; // the Magnific project «ابتكر» (MAGNIFIC_PROJECT_REF moves it)
const REDIRECT_DEFAULT = 'https://operation-system.ibtekr.club/magnific-callback.html'; // the redirect URI the client registered
const STATE_MINUTES = 10;
const UPLOAD_LINK_SECONDS = 600;
const SEARCH_PAGE = 50;
const MAX_LINEAGE = 40; // lineage calls a fetch at most (the rest match by family / name)
const projectRef = (env: Deps['env']) => { const v = (env.MAGNIFIC_PROJECT_REF ?? '').trim(); return /^[0-9a-f-]{36}$/i.test(v) ? v : PROJECT_REF_DEFAULT; };
const redirectUri = (env: Deps['env']) => { const v = (env.MAGNIFIC_REDIRECT_URI ?? '').trim(); return /^https:\/\/[^\s]+$/.test(v) ? v : REDIRECT_DEFAULT; };

async function secretGet(deps: Deps, name: string): Promise<Json | null> {
  const { data, error } = await deps.db.rpc('magnific_secret_get', { p_name: name });
  if (error || typeof data !== 'string' || !data) return null;
  try { const j = JSON.parse(data); return isObj(j) ? j : null; } catch { return null; }
}
async function secretSet(deps: Deps, name: string, value: Json | null) {
  const { error } = await deps.db.rpc('magnific_secret_set', { p_name: name, p_value: value === null ? null : JSON.stringify(value) });
  if (error) throw new BridgeError('mcp_error', null, 'vault');
}
const clientOf = async (deps: Deps) => { const c = await secretGet(deps, 'magnific_mcp_client'); return c && typeof c.client_id === 'string' && c.client_id ? { clientId: c.client_id } : null; };
const tokensOf = async (deps: Deps): Promise<Tokens | null> => {
  const t = await secretGet(deps, 'magnific_mcp_tokens');
  return t && typeof t.access_token === 'string' && typeof t.expires_at === 'string' ? { access_token: t.access_token, refresh_token: typeof t.refresh_token === 'string' ? t.refresh_token : null, expires_at: t.expires_at, account: typeof t.account === 'string' ? t.account : null } : null;
};
// the access token of the linked account, refreshed first when it ends within a minute (the refreshed set replaces the secret)
async function accessToken(deps: Deps): Promise<string> {
  const bridge = deps.bridge; if (!bridge) throw new BridgeError('mcp_error', null, 'no bridge');
  const tokens = await tokensOf(deps);
  if (!tokens) throw new BridgeError('not_linked');
  if (Date.parse(tokens.expires_at) - Date.parse(deps.now()) > 60_000) return tokens.access_token;
  const client = await clientOf(deps); if (!client) throw new BridgeError('not_linked');
  let fresh: Tokens;
  try { fresh = await bridge.refresh(client.clientId, tokens); }
  catch (e) { if (e instanceof BridgeError && e.kind === 'refused') { await secretSet(deps, 'magnific_mcp_tokens', null); throw new BridgeError('not_linked', e.status, e.detail); } throw e; }
  await secretSet(deps, 'magnific_mcp_tokens', fresh);
  return fresh.access_token;
}
const bridgeFail = (e: unknown) => {
  if (e instanceof BridgeError) return json(e.kind === 'not_linked' ? 503 : e.kind === 'busy' ? 429 : e.kind === 'refused' ? 400 : 502, { error: e.kind, status: e.status, detail: e.detail });
  throw e;
};

async function bridgeStatus(deps: Deps, who: Who) {
  if (!who.add && !who.edit) return json(401, { error: 'unauthorized' });
  const tokens = await tokensOf(deps);
  const out: Json = { result: 'ok', linked: !!tokens, project: projectRef(deps.env) };
  if (who.admin) { out.account = tokens?.account ?? null; out.configured = !!(await clientOf(deps)); out.redirect = redirectUri(deps.env); }
  return json(200, out);
}
// the sign-in link for the admin: a state + PKCE verifier kept ten minutes (service_role's table), the provider's authorization URL
async function bridgeLink(deps: Deps, who: Who) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const client = await clientOf(deps); if (!client) return json(503, { error: 'not_configured', configured: false });
  const { verifier, challenge } = await bridge.pkce();
  const state = randomText();
  const { error } = await deps.db.from('magnific_oauth_states').insert({ state, verifier, created_by: who.uid, created_at: deps.now() });
  if (error) return json(500, { error: 'failed' });
  try { return json(200, { result: 'ok', url: await bridge.authUrl(client.clientId, redirectUri(deps.env), state, challenge) }); } catch (e) { return bridgeFail(e); }
}
// the callback page's code + state → the tokens into Vault (the state row is spent either way)
async function bridgeCallback(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const code = typeof args.code === 'string' && /^[A-Za-z0-9._~-]{8,2048}$/.test(args.code) ? args.code : null;
  const state = typeof args.state === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(args.state) ? args.state : null;
  if (!code) return json(400, { error: 'bad_request', field: 'code' });
  if (!state) return json(400, { error: 'bad_request', field: 'state' });
  const { data: found } = await deps.db.from('magnific_oauth_states').select('state, verifier, created_by, created_at, used_at').eq('state', state).maybeSingle();
  const row = isObj(found) ? { verifier: String(found.verifier ?? ''), createdAt: String(found.created_at ?? ''), used: !!found.used_at } : null;
  if (row && !row.used) await deps.db.from('magnific_oauth_states').update({ used_at: deps.now() }).eq('state', state); // spent, whatever follows
  if (!row || row.used || Date.parse(deps.now()) - Date.parse(row.createdAt) > STATE_MINUTES * 60_000) return json(400, { error: 'bad_request', field: 'state' });
  const client = await clientOf(deps); if (!client) return json(503, { error: 'not_configured', configured: false });
  try {
    const tokens = await bridge.exchangeCode(client.clientId, redirectUri(deps.env), code, row.verifier);
    await secretSet(deps, 'magnific_mcp_tokens', tokens);
    return json(200, { result: 'ok', linked: true, account: tokens.account });
  } catch (e) { return bridgeFail(e); }
}
async function bridgeUnlink(deps: Deps, who: Who) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  try { await secretSet(deps, 'magnific_mcp_tokens', null); } catch (e) { return bridgeFail(e); }
  return json(200, { result: 'ok', linked: false });
}
// the batch's product photos (main, not sent yet) up to the project now: a short signed link each → creations_upload_image with
// the product's name as the file name → an image_shares row sent (with the creation's identifier) or error
async function bridgeUpload(deps: Deps, who: Who, args: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const batchId = typeof args.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(args.batch_id) ? args.batch_id : null;
  if (!batchId) return json(400, { error: 'bad_request', field: 'batch_id' });
  const { data: batch } = await deps.db.from('studio_batches').select('id, state, archived_at, created_by').eq('id', batchId).maybeSingle();
  if (!isObj(batch) || batch.archived_at) return json(404, { error: 'not_found' });
  if (!who.admin && batch.created_by && batch.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  let token: string;
  try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  const items: Json[] = isObj(batch.state) && Array.isArray(batch.state.items) ? batch.state.items : [];
  const only = Array.isArray(args.indexes) ? new Set(args.indexes.filter((n: unknown) => Number.isInteger(n))) : null;
  const { data: had } = await deps.db.from('image_shares').select('path, status').eq('batch_id', batchId);
  const sent = new Set((Array.isArray(had) ? had : []).filter((r: Json) => r.status === 'sent').map((r: Json) => r.path));
  let uploaded = 0, failed = 0, skipped = 0; let stop: Response | null = null;
  for (let i = 0; i < items.length && !stop; i++) {
    const it = items[i]; if (!isObj(it) || (only && !only.has(i))) continue;
    const path = typeof it.main === 'string' && studioPathOk(batchId, it.main) ? it.main : null;
    if (!path || sent.has(path)) { skipped++; continue; }
    const { data: sg } = await deps.db.storage.from(STUDIO_BUCKET).createSignedUrl(path, UPLOAD_LINK_SECONDS);
    const url = typeof sg?.signedUrl === 'string' && /^https:\/\//.test(sg.signedUrl) ? sg.signedUrl : null;
    if (!url) { skipped++; continue; }
    const stem = String(it.nameEn || it.nameAr || '').replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '');
    const name = (stem || 'product-' + (i + 1)) + '.' + (/^(jpe?g|png|webp)$/i.test(path.split('.').pop() ?? '') ? path.split('.').pop() : 'jpg');
    const row: Json = { created_by: who.uid, batch_id: batchId, item_index: i, item_key: typeof it.key === 'string' ? it.key.slice(0, 60) : null, name, path, url, expires_at: new Date(Date.parse(deps.now()) + UPLOAD_LINK_SECONDS * 1000).toISOString() };
    try {
      const id = uploadedId(await bridge.callTool(token, 'creations_upload_image', { url, fileName: name, folderReference: projectRef(deps.env) }));
      if (!id) throw new BridgeError('mcp_error', null, 'no identifier');
      await deps.db.from('image_shares').insert({ ...row, status: 'sent', creation_ref: id, sent_at: deps.now() });
      uploaded++;
    } catch (e) {
      if (!(e instanceof BridgeError)) throw e;
      if (e.kind === 'not_linked' || e.kind === 'busy') { stop = bridgeFail(e); break; } // the account or the server: nothing more this call
      await deps.db.from('image_shares').insert({ ...row, status: 'error', error: (e.kind + (e.detail ? ': ' + e.detail : '')).slice(0, 200) });
      failed++;
    }
  }
  if (stop && !uploaded && !failed) return stop;
  return json(200, { result: 'ok', batch_id: batchId, uploaded, failed, skipped, stopped: stop ? (await stop.json()).error : null });
}
// ---- decision 12: one Space «استوديو ابتكر», a flow a batch; the prompts a category from the owner's template Space

const TEMPLATE_SPACE_DEFAULT = 'a24c0027-cdcc-461c-bc94-74a2a275c599'; // the owner's «product excution template» (MAGNIFIC_TEMPLATE_SPACE moves it)
const STUDIO_SPACE_NAME = 'استوديو ابتكر';
const templateSpace = (env: Deps['env'], row: Json) => { const v = String(row.template_space ?? env.MAGNIFIC_TEMPLATE_SPACE ?? '').trim(); return /^[0-9a-f-]{36}$/i.test(v) ? v : TEMPLATE_SPACE_DEFAULT; };
async function magnificSettings(deps: Deps): Promise<Json> {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'magnific').maybeSingle();
  return isObj(data) && isObj(data.data) ? data.data : {};
}
async function saveMagnificSettings(deps: Deps, patch: Json) {
  const cur = await magnificSettings(deps);
  const { error } = await deps.db.from('settings').upsert({ section: 'magnific', data: { ...cur, ...patch } }, { onConflict: 'section' });
  if (error) throw new BridgeError('mcp_error', null, 'settings');
}
// the admin: the owner's template Space read page by page (spaces_state is one answer a page), its generators' prompts fetched in
// batches of 50 (spaces_get_nodes) → shot_prompts upserted (category + shot) → { categories, rows }
async function bridgePromptsSync(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  let token: string;
  try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  const cfg = await magnificSettings(deps);
  const spaceId = typeof args.template_space === 'string' && /^[0-9a-f-]{36}$/i.test(args.template_space) ? args.template_space : templateSpace(deps.env, cfg);
  try {
    const board = await bridge.callTool(token, 'spaces_state', { spaceId });
    const pages = (Array.isArray((board as Json)?.pages) ? (board as Json).pages : []).map((p: Json) => String(p?.id ?? '')).filter(Boolean);
    let nodes = nodesOf(board);
    if (!nodes.length && pages.length) for (const pageId of pages) nodes.push(...nodesOf(await bridge.callTool(token, 'spaces_state', { spaceId, pageId })));
    nodes = nodes.filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i);
    const gens = nodes.filter((n) => n.type === 'image-generator').map((n) => n.id);
    const nodeData: Json = {};
    for (let i = 0; i < gens.length; i += 50) Object.assign(nodeData, nodeDataOf(await bridge.callTool(token, 'spaces_get_nodes', { spaceId, nodeIds: gens.slice(i, i + 50) })));
    const rows = templatePrompts(nodes, nodeData);
    if (!rows.length) return json(200, { result: 'ok', template_space: spaceId, categories: 0, rows: 0 });
    const { error } = await deps.db.from('shot_prompts').upsert(rows.map((r) => ({ category: r.category, shot: r.shot, name: r.name, prompt: r.prompt, negative: r.negative, model: r.model, aspect: r.aspect, resolution: r.resolution, source_node: r.node, updated_by: who.uid, updated_at: deps.now() })), { onConflict: 'category,shot' });
    if (error) return json(500, { error: 'failed' });
    await saveMagnificSettings(deps, { template_space: spaceId, prompts_synced_at: deps.now() });
    return json(200, { result: 'ok', template_space: spaceId, categories: new Set(rows.map((r) => r.category)).size, rows: rows.length });
  } catch (e) { return bridgeFail(e); }
}
// the batch's flow inside the one Space (made on the first call, kept in settings «magnific»; a page a category): the sent photos as
// the input list, three generators with the category's prompts, three output lists; the node ids kept on the batch for the fetch
async function bridgeFlow(deps: Deps, who: Who, args: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const batchId = typeof args.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(args.batch_id) ? args.batch_id : null;
  if (!batchId) return json(400, { error: 'bad_request', field: 'batch_id' });
  const category = line(typeof args.category === 'string' ? args.category : '', 80);
  if (!category) return json(400, { error: 'bad_request', field: 'category' });
  const { data: batch } = await deps.db.from('studio_batches').select('id, title, state, archived_at, created_by').eq('id', batchId).maybeSingle();
  if (!isObj(batch) || batch.archived_at) return json(404, { error: 'not_found' });
  if (!who.admin && batch.created_by && batch.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  const state: Json = isObj(batch.state) ? batch.state : {};
  const items: Json[] = Array.isArray(state.items) ? state.items : [];
  const { data: shares } = await deps.db.from('image_shares').select('item_index, creation_ref, status, path').eq('batch_id', batchId);
  // one photo a product: the latest sent share of each item (the product's main photo)
  const byIndex = new Map<number, string>();
  for (const s of Array.isArray(shares) ? shares : []) if (s.status === 'sent' && typeof s.creation_ref === 'string' && REF.test(s.creation_ref)) byIndex.set(Number(s.item_index), s.creation_ref);
  const order = items.map((_, i) => i).filter((i) => byIndex.has(i));
  if (!order.length) return json(409, { error: 'nothing_sent' });
  const { data: promptRows } = await deps.db.from('shot_prompts').select('category, shot, name, prompt, negative, model, aspect, resolution').eq('category', category);
  let token: string;
  try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  try {
    const cfg = await magnificSettings(deps);
    let spaceId = typeof cfg.space_id === 'string' && /^[0-9a-f-]{36}$/i.test(cfg.space_id) ? cfg.space_id : null;
    let spaceUrl = typeof cfg.space_url === 'string' && /^https:\/\//.test(cfg.space_url) ? cfg.space_url : null;
    if (!spaceId) {
      const made = await bridge.callTool(token, 'spaces_create', { name: STUDIO_SPACE_NAME, description: 'فلو لكل دفعة من استوديو المنتجات — بيتعمل من نظام ابتكر', projectReference: projectRef(deps.env) }) as Json;
      const sp = isObj(made?.space) ? made.space : made;
      spaceId = typeof sp?.id === 'string' && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
      spaceUrl = typeof sp?.webUrl === 'string' && /^https:\/\//.test(sp.webUrl) ? sp.webUrl.split('?')[0] : null;
      if (!spaceId) throw new BridgeError('mcp_error', null, 'no space id');
      await saveMagnificSettings(deps, { space_id: spaceId, space_url: spaceUrl, pages: {} });
    }
    const pages: Json = isObj(cfg.pages) ? { ...cfg.pages } : {};
    let pageId = typeof pages[category] === 'string' ? pages[category] : null;
    if (!pageId) {
      const made = await bridge.callTool(token, 'spaces_create_page', { spaceId, name: category }) as Json;
      const pid = made?.pageId ?? made?.page?.id ?? made?.id;
      pageId = typeof pid === 'string' && pid ? pid : typeof pid === 'number' ? String(pid) : null;
      if (!pageId) throw new BridgeError('mcp_error', null, 'no page id');
      pages[category] = pageId;
      await saveMagnificSettings(deps, { pages });
    }
    const title = line(String(batch.title ?? ''), 80) + ' · ' + deps.now().slice(0, 10);
    const plan = flowNodes({ title, category, photos: order.map((i) => byIndex.get(i) as string), prompts: Array.isArray(promptRows) ? promptRows : [] });
    const created = await bridge.callTool(token, 'spaces_create_node', { spaceId, pageId, nodes: plan.nodes }) as Json;
    const results: Json[] = Array.isArray(created?.results) ? created.results : [];
    const idOf: Record<string, string> = {};
    for (const r of results) if (isObj(r) && r.ok !== false && typeof r.ref === 'string' && typeof r.nodeId === 'string') idOf[r.ref] = r.nodeId;
    const missing = plan.nodes.map((n) => n.ref).filter((ref) => !idOf[ref]);
    if (missing.length) throw new BridgeError('mcp_error', null, 'nodes not created: ' + missing.join(','));
    await bridge.callTool(token, 'spaces_add_connection', { spaceId, connections: plan.connections.map((c) => ({ sourceElementId: idOf[c.from], sourcePort: c.fromPort, targetElementId: idOf[c.to], targetPort: c.toPort, dataType: 'image', pageId })) });
    const flow = { space_id: spaceId, url: spaceUrl, page_id: pageId, category, panel: idOf.panel, list: idOf.list, gens: [1, 2, 3].map((s) => ({ shot: s, id: idOf['gen' + s], out: idOf['out' + s] })), order, made_at: deps.now() };
    await deps.db.from('studio_batches').update({ state: { ...state, flow } }).eq('id', batchId);
    return json(200, { result: 'ok', batch_id: batchId, url: spaceUrl, space_id: spaceId, page_id: pageId, photos: order.length, category, prompts: Array.isArray(promptRows) ? promptRows.length : 0 });
  } catch (e) { return bridgeFail(e); }
}
// the flow's output lists read in order (shot s, item k → product order[k], slot s−1) → one image_imports row → importBatch
async function fetchFromFlow(deps: Deps, who: Who, batch: Json, flow: Json, known: Set<string>, token: string) {
  const bridge = deps.bridge!;
  const gens: Json[] = Array.isArray(flow.gens) ? flow.gens.filter(isObj) : [];
  const order: number[] = Array.isArray(flow.order) ? flow.order.filter((n: unknown): n is number => Number.isInteger(n)) : [];
  const outIds = gens.map((g) => g.out).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
  if (!outIds.length || !order.length) return json(200, { result: 'ok', batch_id: batch.id, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok', flow: true });
  const nodeData = nodeDataOf(await bridge.callTool(token, 'spaces_get_nodes', { spaceId: flow.space_id, nodeIds: outIds }));
  const picks: { id: string; index: number; slot: number }[] = [];
  for (const g of gens) {
    const ids = listIdsOf(nodeData, String(g.out)); const shot = Number(g.shot);
    ids.forEach((id, k) => { if (k < order.length && !known.has(id)) picks.push({ id, index: order[k], slot: shot - 1 }); });
  }
  const fresh = picks.filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i).slice(0, 50);
  if (!fresh.length) return json(200, { result: 'ok', batch_id: batch.id, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok', flow: true });
  const urls: Record<string, string> = urlsById(await bridge.callTool(token, 'creations_get', { identifiers: fresh.map((p) => p.id) })) as Record<string, string>;
  const hosts = importHosts(deps.env);
  const onHost = (u: string | undefined) => { try { return !!u && hosts.has(new URL(u).hostname.toLowerCase()); } catch { return false; } };
  const ready = fresh.filter((p) => onHost(urls[p.id]));
  if (!ready.length) return json(200, { result: 'ok', batch_id: batch.id, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, offhost: fresh.length, status: 'ok', flow: true });
  const byIndex = new Map<number, { images: number[]; slots: number[] }>();
  ready.forEach((p, n) => { if (!byIndex.has(p.index)) byIndex.set(p.index, { images: [], slots: [] }); byIndex.get(p.index)!.images.push(n); byIndex.get(p.index)!.slots.push(p.slot); });
  const label = line('نتائج Magnific — ' + String(batch.title ?? ''), 200);
  const { data: row, error } = await deps.db.from('image_imports').insert({ created_at: deps.now(), created_by: who.uid, source: 'magnific', folder: 'ابتكر', label, urls: ready.map((p) => urls[p.id]), refs: ready.map((p) => p.id), status: 'pending', target: 'batch', batch_id: batch.id, items: [...byIndex.entries()].map(([index, v]) => ({ index, images: v.images, slots: v.slots })) }).select('id, created_by, source, folder, label, product_id, urls, status, paths, target, items, brand_id, vendor_id, batch_type, batch_id').single();
  if (error || !isObj(row)) return json(500, { error: 'failed' });
  const res = await importBatch(deps, who, row);
  const body = await res.json();
  return json(res.status, { ...body, found: ready.length, unmatched: 0, offhost: fresh.length - ready.length, import_id: row.id, flow: true });
}

// the project's results back into the batch: a batch with a flow (decision 12) reads its output lists in order; else every creation
// of the project that is not an upload, not a source and not imported yet, matched to the photo it came from (lineage → family →
// name) → one image_imports row (target batch) → importBatch now
async function bridgeFetch(deps: Deps, who: Who, args: Json) {
  if (!who.add) return json(401, { error: 'unauthorized' });
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const batchId = typeof args.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(args.batch_id) ? args.batch_id : null;
  if (!batchId) return json(400, { error: 'bad_request', field: 'batch_id' });
  const { data: batch } = await deps.db.from('studio_batches').select('id, title, state, archived_at, created_by').eq('id', batchId).maybeSingle();
  if (!isObj(batch) || batch.archived_at) return json(404, { error: 'not_found' });
  if (!who.admin && batch.created_by && batch.created_by !== who.uid) return json(401, { error: 'unauthorized' });
  const flow = isObj(batch.state) && isObj(batch.state.flow) && typeof batch.state.flow.space_id === 'string' ? batch.state.flow : null;
  if (flow) {
    const { data: past } = await deps.db.from('image_imports').select('refs').eq('batch_id', batchId);
    const known = new Set<string>();
    for (const r of Array.isArray(past) ? past : []) if (Array.isArray(r.refs)) for (const x of r.refs) if (typeof x === 'string') known.add(x);
    let token: string;
    try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
    try { return await fetchFromFlow(deps, who, batch, flow, known, token); } catch (e) { return bridgeFail(e); }
  }
  const { data: shares } = await deps.db.from('image_shares').select('item_index, creation_ref, name, status').eq('batch_id', batchId);
  const sources = (Array.isArray(shares) ? shares : []).filter((s: Json) => s.status === 'sent' && typeof s.creation_ref === 'string' && REF.test(s.creation_ref)).map((s: Json) => ({ ref: s.creation_ref as string, index: Number(s.item_index), name: String(s.name ?? ''), family: '' }));
  if (!sources.length) return json(200, { result: 'ok', batch_id: batchId, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok' });
  const { data: past } = await deps.db.from('image_imports').select('refs').eq('batch_id', batchId);
  const known = new Set<string>(sources.map((s) => s.ref));
  for (const r of Array.isArray(past) ? past : []) if (Array.isArray(r.refs)) for (const x of r.refs) if (typeof x === 'string') known.add(x);
  let token: string;
  try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  try {
    const project = projectRef(deps.env);
    type Creation = { id: string; name: string; family: string; tool: string; url: string | null; prompt: string };
    const results: Creation[] = [];
    for (let page = 1, last = 1; page <= last && page <= 20; page++) {
      const data = await bridge.callTool(token, 'creations_search', { from: 'project-root', reference: project, fileType: 'image', full: true, perPage: SEARCH_PAGE, page });
      results.push(...(creationsOf(data) as Creation[]));
      last = lastPageOf(data);
      if (results.length >= 400) break;
    }
    const hosts = importHosts(deps.env);
    const onHost = (u: string | null) => { try { return !!u && hosts.has(new URL(u).hostname.toLowerCase()); } catch { return false; } };
    const fresh = results.filter((r) => !known.has(r.id) && r.tool !== 'upload' && onHost(r.url)); // a link off the allowed hosts is never fetched
    // the sources' families (for results whose lineage the server does not tell), then each result's lineage
    for (const s of sources) { const hit = results.find((r) => r.id === s.ref); if (hit) s.family = hit.family; }
    for (const s of sources) if (!s.family) { try { s.family = familyOf(await bridge.callTool(token, 'creations_get', { creationIdentifier: s.ref })); } catch (e) { if (!(e instanceof BridgeError) || e.kind !== 'mcp_error') throw e; } }
    const lineages: Record<string, string[]> = {};
    for (const r of fresh.slice(0, MAX_LINEAGE)) { try { lineages[r.id] = lineageIds(await bridge.callTool(token, 'creations_lineage', { creationIdentifier: r.id })); } catch (e) { if (!(e instanceof BridgeError) || e.kind !== 'mcp_error') throw e; } }
    const { matched, unmatched } = matchResults(sources, fresh, lineages);
    if (!matched.length) return json(200, { result: 'ok', batch_id: batchId, found: fresh.length, placed: 0, unmatched: unmatched.length, imported: 0, failed: 0, status: 'ok' });
    const shapeOf = importShape(matched);
    const label = line('نتائج Magnific — ' + String(batch.title ?? ''), 200);
    const { data: row, error } = await deps.db.from('image_imports').insert({ created_at: deps.now(), created_by: who.uid, source: 'magnific', folder: 'ابتكر', label, urls: shapeOf.urls, refs: shapeOf.refs, status: 'pending', target: 'batch', batch_id: batchId, items: shapeOf.items }).select('id, created_by, source, folder, label, product_id, urls, status, paths, target, items, brand_id, vendor_id, batch_type, batch_id').single();
    if (error || !isObj(row)) return json(500, { error: 'failed' });
    const res = await importBatch(deps, who, row);
    const body = await res.json();
    return json(res.status, { ...body, found: fresh.length, unmatched: unmatched.length, import_id: row.id });
  } catch (e) { return bridgeFail(e); }
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
    if (action === 'webp') return await webp(deps, who, args);
    if (action === 'import') return await importSet(deps, who, args);
    if (action === 'share') return await share(deps, who, args);
    if (action === 'bridge_status') return await bridgeStatus(deps, who);
    if (action === 'bridge_link') return await bridgeLink(deps, who);
    if (action === 'bridge_callback') return await bridgeCallback(deps, who, args);
    if (action === 'bridge_unlink') return await bridgeUnlink(deps, who);
    if (action === 'bridge_upload') return await bridgeUpload(deps, who, args);
    if (action === 'bridge_fetch') return await bridgeFetch(deps, who, args);
    if (action === 'bridge_prompts_sync') return await bridgePromptsSync(deps, who, args);
    if (action === 'bridge_flow') return await bridgeFlow(deps, who, args);
    if (!who.admin) return json(401, { error: 'unauthorized' });
    // the probe's outcome is kept as an ai_runs row (label 'probe', 0 credits: configured = the key is set, status = the
    // provider's HTTP status, shape = keys and types only) so the T2 diagnosis can be read from the database — never the key
    const configured = !!deps.env.MAGNIFIC_API_KEY?.trim();
    const record = (status: 'ok' | 'error', error: string | null, output: Json) =>
      deps.db.from('ai_runs').insert({ created_by: who.uid, action: 'image', source: 'tool', label: 'probe', status, error, credits: 0, cost_usd: 0, output: { probe: true, configured, ...output } });
    if (!configured) { await record('error', 'not_configured', { status: null }); return json(503, { error: 'not_configured', configured: false }); }
    // the shape only (keys and types, no values) of the provider's account answer — enough to pin the layer in T2, nothing to leak
    try { const sh = shape(await deps.provider.probe()); await record('ok', null, { status: 200, shape: sh }); return json(200, { result: 'ok', provider: PROVIDER, shape: sh, models: MODEL_IDS }); }
    catch (e) { const kind = e instanceof ProviderError ? e.kind : 'ai_error'; const status = e instanceof ProviderError ? e.status : null; await record('error', kind, { status, detail: e instanceof ProviderError ? e.detail : null }); return json(kind === 'not_configured' ? 503 : kind === 'busy' ? 429 : 502, { error: kind, configured: true, status }); }
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
    bridge: magnificMcp(env),
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
