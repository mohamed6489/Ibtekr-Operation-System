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
//   'campaign' (phase 9.5.1 «التسويق», decision 8; the admin or marketing.create = F) { campaign_id, piece, slide: null | -1 (a
//              carousel's cover) | 0..9, model?, size? } → one image of a campaign's piece, its prompt built here from the piece's
//              fields in mkt_campaigns.state (the goal, the idea, the scene, the Arabic text written into the image, the media's
//              notes, the templates' descriptions — _shared/marketing.js), its references the campaign's uploads, the site's product
//              photos and the templates' images (bucket marketing, 4 at most) → saved in bucket marketing under the campaign as
//              the provider made it (PNG / JPEG — Instagram takes no WebP) → { result: 'ok', bucket, path, credits, model, run_id }.
//              The campaign itself is not written (the page puts the path in the piece and saves). ai_runs source 'campaign'.
//   'campaign_edit' (decision 9; the same) { campaign_id, piece, slide, model?, note?, pins: [{ x, y, text }] } → the target's
//              current image edited by the instruction (the pins at their places, the general change) → a new path, same way.
//   'agent_image' (0084 — the owner 12 Nov, decision 6; the admin or marketing.create = F) { chat_id, prompt, size?, model? } → the
//              designer assistant's picture: the member's own designer chat (another's / a deleted one = 404), one image from the
//              prompt on the images' credit cap, stored under agents/<member>/<chat>/ in the bucket marketing (read by its member
//              only — 0084) and written into the chat as the assistant's turn → { result: 'ok', path, turn, credits, run_id }.
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
  MODEL_IDS, PROVIDER, creditsFor, editPrompt, extOf, imageSettings, line, parseCreate, parseEdit, parseGenerate, shapePrompt, sizeOf, slotPrompt, studioEditPath,
  renameInState, studioGenPath, studioPathOk, toolPath, usdOf,
} from '../_shared/ai-images.js';
import { magnific, ProviderError, shape, type Provider, type Ref } from './providers/magnific.ts';
import { openaiImage } from './providers/openai-image.ts';
import { geminiImage } from './providers/gemini-image.ts';
import { IMAGE_PROVIDERS, IMAGE_USD, VEO_USD_PER_SECOND, VOICE_USD_PER_1K, imagePick, imageStyle, providersOf, videoPick, voicePick } from '../_shared/ai-providers.js';
import { elevenTts } from './providers/elevenlabs.ts';
import { veoAspect, veoDownload, veoPoll, veoSeconds, veoStart } from './providers/veo.ts';
import { McpError, findKey, mcpClient, type McpClient } from '../_shared/mcp-client.ts';
import { secretOf } from '../_shared/secrets.js';
import { aiSettings } from '../_shared/ai-content.js';
import { vaultEnv } from '../_shared/secrets.js';
import { BridgeError, magnificMcp, randomText, type Bridge, type Tokens } from './providers/magnific-mcp.ts';
import { REF, creationsOf, familyOf, flowNodes, importShape, lastPageOf, lineageIds, listIdsOf, matchResults, nodeDataOf, nodesOf, templatePrompts, uploadedId, urlsById } from '../_shared/magnific-bridge.js';
import { DEFAULT_SIZE, agentImagePath, campaignGenPath, campaignPathOk, campaignPrompt, campaignRefs, campaignTarget, parseAgentImage, parseCampaign, parseCampaignEdit, pinsPrompt } from '../_shared/marketing.js';
import { MAX_OPEN_JOBS, MAX_VIDEO_BYTES, MEDIA_EXT, chainedArgs, clipArgs, jobView, mixPlan, modelOf as videoModelOf, musicArgs, nextMix, parseVideo, queuedIds, ttsArgs, videoPath, videoPathOk, waitOf } from '../_shared/mkt-video.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  provider: Provider; fetch?: typeof fetch;
  bridge?: Bridge; // decision 11: the Magnific site's MCP (OAuth + tools) — the system's own client
  providers?: Record<string, Provider>; // phase 11: the direct image providers (openai / gemini) beside Magnific
  tts?: (req: { text: string; voiceId: string | null; model: string | null }) => Promise<{ bytes: Uint8Array; mime: string }>; // phase 11: ElevenLabs direct
  mcp?: (url: string, token: string | null) => McpClient; // phase 11 (decision 4): a linked MCP server — Higgsfield's video tools
  veo?: { start: (req: { model: string; prompt: string; image: { bytes: Uint8Array; mime: string } | null; aspect: string; seconds: number }) => Promise<string>; poll: (op: string) => Promise<{ done: boolean; uri?: string; error?: string }>; download: (uri: string) => Promise<{ bytes: Uint8Array; mime: string }> }; // phase 11: Veo direct
};

const ACTIONS = ['generate', 'edit', 'create', 'probe', 'webp', 'import', 'share', 'bridge_status', 'bridge_link', 'bridge_callback', 'bridge_unlink', 'bridge_upload', 'bridge_fetch', 'bridge_prompts_sync', 'bridge_flow', 'campaign', 'campaign_edit', 'agent_image',
  'video_clip', 'video_voice', 'video_music', 'video_upload', 'video_assemble', 'video_poll']; // 9.5.5 (decisions 57–64)
const SHARE_SECONDS = 7 * 24 * 3600; // a shared photo's link lives a week (the bridge uploads it to the site within that)
const MAX_WEBP_B64 = 14_000_000; // ≈ 10 MB of WebP
const STUDIO_BUCKET = 'studio';
const TOOL_BUCKET = 'ai-images';
const MKT_BUCKET = 'marketing'; // phase 9.5.1: the campaigns' images (0049)
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

type Who = { uid: string; admin: boolean; add: boolean; edit: boolean; mkt: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && data === 'F'; };
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  return { uid, admin, add: admin || (await perm('products.add')), edit: admin || (await perm('products.edit')), mkt: admin || (await perm('marketing.create')) };
}

// ---------------------------------------------------------------- settings, the cap, the run

// the settings row «ai» (the image model and the credit cap of 5.4; the providers of phase 11) and «ai_rules» (the image style)
type ImgCfg = { model: string; monthlyCredits: number | null; ai: Json | null; rules: Json | null; usdCap: number | null };
async function settingsOf(deps: Deps): Promise<ImgCfg> {
  const { data, error } = await deps.db.from('settings').select('section, data').in('section', ['ai', 'ai_rules']);
  const rows: Json[] = !error && Array.isArray(data) ? data : [];
  const ai = rows.find((r) => r.section === 'ai')?.data; const rules = rows.find((r) => r.section === 'ai_rules')?.data;
  const aiRow = isObj(ai) ? ai : null;
  return { ...imageSettings(aiRow, deps.env), ai: aiRow, rules: isObj(rules) ? rules : null, usdCap: aiSettings(aiRow, deps.env).cap };
}
// a direct provider's run (USD on the content cap, 0025's ai_run_start): the same locked reservation as ai-content
async function startRunUsd(deps: Deps, row: Json, usd: number, cap: number | null) {
  const { data, error } = await deps.db.rpc('ai_run_start', { p_row: row, p_cap: cap, p_reserve: usd, p_throttle: THROTTLE, p_window_minutes: THROTTLE_MINUTES });
  if (error || !isObj(data)) return { result: 'error' as const };
  const id = Number(data.id);
  if (data.result === 'ok' && Number.isInteger(id)) return { result: 'ok' as const, id };
  return { result: data.result === 'busy' ? 'busy' as const : data.result === 'cap' ? 'cap' as const : 'error' as const };
}
const styleOf = (rules: Json | null, section: string) => { const t = imageStyle(rules, section); return t ? ' ' + t : ''; };
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
type Work = (prov: Provider, model: string, style: string) => Promise<{ images: { bytes: Uint8Array; mime: string }[]; credits: number | null }>;
// The common path of the image actions: the cap, the reservation, the key, the provider, the files, the row. Phase 11 (decision 15):
// the tool's provider from the settings — Magnific as before (credits), or a direct provider (openai / gemini) whose cost is USD on the
// content cap; the image style of the settings (decision 14) is handed to the caller's prompt.
async function runImages(deps: Deps, base: Json, model: string, count: number, work: Work, store: (img: { bytes: Uint8Array; mime: string }, n: number) => Promise<{ bucket: string; path: string } | null>, tool = 'studio', section = 'products'): Promise<Response> {
  const cfg = await settingsOf(deps);
  const pick = imagePick(cfg.ai, tool);
  const direct = pick.provider !== 'magnific';
  const prov = direct ? deps.providers?.[pick.provider] : deps.provider;
  if (direct) model = pick.model;
  const style = styleOf(cfg.rules, section);
  const planned = direct ? 0 : creditsFor(model, count);
  const usd = direct ? Math.round(((IMAGE_USD as Record<string, number>)[model] ?? 0.2) * Math.max(1, count) * 1e6) / 1e6 : 0;
  // the planned credits (or USD) are held on the pending row (the cap counts them while the call runs)
  const run = direct ? await startRunUsd(deps, { ...base, model }, usd, cfg.usdCap) : await startRun(deps, { ...base, model }, planned, cfg.monthlyCredits);
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  // the two faces of not_configured, told apart for the admin: the secret is not set (configured false) / the provider refused the key (status)
  const envKey = (IMAGE_PROVIDERS as Record<string, { env: string }>)[pick.provider]?.env ?? 'MAGNIFIC_API_KEY';
  if (!prov || !deps.env[envKey]?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', credits: 0, cost_usd: 0, output: { configured: false, provider: pick.provider } }); return json(503, { error: 'not_configured', configured: false, provider: pick.provider }); }
  let out: { images: { bytes: Uint8Array; mime: string }[]; credits: number | null };
  try { out = await work(prov, model, style); } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'ai_error';
    // a lost answer (busy after a timeout) keeps its planned credits; a refusal or a clear error costs nothing here
    const credits = kind === 'busy' ? planned : 0; const cost = kind === 'busy' && direct ? usd : usdOf(credits);
    const status = e instanceof ProviderError ? e.status : null;
    const detail = e instanceof ProviderError ? e.detail : e instanceof Error ? line(e.name + ': ' + e.message, 200) : null;
    await finishRun(deps, run.id, { status: kind === 'refused' ? 'refused' : 'error', error: kind, credits, cost_usd: cost, output: { configured: true, status, detail, provider: pick.provider } });
    if (kind === 'refused') return json(200, { result: 'refused', model, credits: 0, run_id: run.id, provider: pick.provider });
    return json(kind === 'not_configured' ? 503 : kind === 'busy' ? 429 : 502, { error: kind, configured: true, status, provider: pick.provider });
  }
  const stored: Stored = [];
  for (let n = 0; n < out.images.length && n < count; n++) { const s = await store(out.images[n], n + 1); if (s) stored.push(s); }
  const credits = direct ? 0 : (out.credits ?? planned); const cost = direct ? usd : usdOf(credits);
  if (!stored.length) { await finishRun(deps, run.id, { status: 'error', error: 'ai_error', credits, cost_usd: cost }); return json(502, { error: 'ai_error', provider: pick.provider }); }
  await finishRun(deps, run.id, { status: 'ok', credits, cost_usd: cost, output: { paths: stored.map((s) => s.path), bucket: stored[0].bucket, provider: pick.provider } });
  return json(200, { result: 'ok', bucket: stored[0].bucket, path: stored[0].path, paths: stored.map((s) => s.path), credits, cost_usd: cost, model, provider: pick.provider, run_id: run.id });
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
    (prov, m, style) => prov.generate({ model: m, prompt: prompt + style, width: size.w, height: size.h, count: 1, references: refs }),
    (img) => upload(deps.db, STUDIO_BUCKET, studioGenPath(batchId, index, slot, st, extOf(img.mime)), img), 'studio', 'products');
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
    (prov, m) => prov.edit({ model: m, op, prompt: editPrompt(op, prompt, options), image: ref, imageUrl, options }),
    (img, n) => where(img, n));
}

// ---------------------------------------------------------------- create (the images tool)

async function create(deps: Deps, who: Who, args: Json) {
  if (!who.add && !who.edit) return json(401, { error: 'unauthorized' });
  const parsed = parseCreate(args);
  if ('error' in parsed) return json(400, parsed);
  const { source, prompt, shape, size, count, model, image, productId, sizes } = parsed.req;
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
  const full = shapePrompt(shape, subject, prompt, { sizes });
  if (!full) return json(400, { error: 'bad_request', field: 'sizes' });
  const label = line((subject || prompt) + (shape === 'size' ? ' — المقاس' : ''), 200) || 'صورة';
  const base = { created_by: who.uid, action: 'image', source: 'tool', label, product_id: productId };
  return await runImages(deps, base, model, count,
    (prov, m, style) => prov.generate({ model: m, prompt: full + style, width: size.w, height: size.h, count, references: refs }),
    (img, n) => upload(deps.db, TOOL_BUCKET, toolPath(who.uid, st, n, extOf(img.mime)), img), 'tool', 'products');
}

// ---------------------------------------------------------------- campaign / campaign_edit (phase 9.5.1, decisions 8–9)

// the campaign (open, not archived) whose piece is asked — its state as the page saved it (the page flushes its edits first)
async function readCampaign(deps: Deps, id: string) {
  const { data } = await deps.db.from('mkt_campaigns').select('id, name, state, archived_at').eq('id', id).maybeSingle();
  return isObj(data) && !data.archived_at ? data : null;
}
// the references the server can load, in their order: the photos to feature first (the campaign's uploads, the site's product
// photos), then the examples (uploaded examples, the templates' images — and the templates' descriptions for the prompt)
async function campaignInputs(deps: Deps, campaignId: string, t: Json) {
  const r = campaignRefs(t, campaignId); const refs: Ref[] = []; const templates: Json[] = [];
  let useCount = 0; let styleCount = 0;
  for (const x of r.use) {
    const ref = x.path ? await download(deps.db, MKT_BUCKET, x.path) : x.product ? await productPhoto(deps, x.product) : null;
    if (ref && refs.length < MAX_REFS) { refs.push(ref); useCount += 1; }
  }
  for (const x of r.style) {
    let ref: Ref | null = null;
    if (x.path) ref = await download(deps.db, MKT_BUCKET, x.path);
    else if (x.tpl) {
      const { data: tp } = await deps.db.from('mkt_templates').select('id, kind, image, descr, deleted_at').eq('id', x.tpl).maybeSingle();
      if (isObj(tp) && !tp.deleted_at) {
        if (typeof tp.descr === 'string' && tp.descr.trim()) templates.push({ kind: tp.kind, descr: tp.descr });
        if (typeof tp.image === 'string' && /^templates\/[A-Za-z0-9._-]{1,120}$/.test(tp.image)) ref = await download(deps.db, MKT_BUCKET, tp.image);
      }
    }
    if (ref && refs.length < MAX_REFS) { refs.push(ref); styleCount += 1; }
  }
  return { refs, useCount, styleCount, templates };
}
async function campaignTargetOf(deps: Deps, req: Json): Promise<{ error: Response } | { t: Json }> {
  const c = await readCampaign(deps, req.campaignId); if (!c) return { error: json(404, { error: 'not_found' }) };
  const t = campaignTarget(c.state, req.piece, req.slide); if (!t) return { error: json(400, { error: 'bad_request', field: 'piece' }) };
  return { t };
}
async function campaign(deps: Deps, who: Who, args: Json) {
  if (!who.mkt) return json(401, { error: 'unauthorized' });
  const parsed = parseCampaign(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req; const got = await campaignTargetOf(deps, req); if ('error' in got) return got.error;
  const t = got.t as Json;
  const size = req.size ?? sizeOf(t.size ?? '') ?? sizeOf(DEFAULT_SIZE)!;
  const inp = await campaignInputs(deps, req.campaignId, t);
  const prompt = campaignPrompt(t, inp);
  const base = { created_by: who.uid, action: 'image', source: 'campaign', label: t.label };
  const st = stamp(deps);
  return await runImages(deps, base, req.model, 1,
    (prov, m, style) => prov.generate({ model: m, prompt: prompt + style, width: size.w, height: size.h, count: 1, references: inp.refs }),
    (img) => upload(deps.db, MKT_BUCKET, campaignGenPath(req.campaignId, req.piece, req.slide, st, extOf(img.mime), false), img), 'campaign', 'post');
}
async function campaignEdit(deps: Deps, who: Who, args: Json) {
  if (!who.mkt) return json(401, { error: 'unauthorized' });
  const parsed = parseCampaignEdit(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req; const got = await campaignTargetOf(deps, req); if ('error' in got) return got.error;
  const t = got.t as Json;
  const path = campaignPathOk(req.campaignId, t.target.img) ? t.target.img as string : null;
  if (!path) return json(400, { error: 'bad_request', field: 'image' });
  const image = await download(deps.db, MKT_BUCKET, path);
  if (!image) return json(404, { error: 'not_found' });
  const prompt = pinsPrompt(req.note, req.pins);
  const base = { created_by: who.uid, action: 'image', source: 'campaign', label: line(t.label + ' · تعديل', 200) };
  const st = stamp(deps);
  return await runImages(deps, base, req.model, 1,
    (prov, m) => prov.edit({ model: m, op: 'instruction', prompt, image, imageUrl: null, options: {} }),
    (img) => upload(deps.db, MKT_BUCKET, campaignGenPath(req.campaignId, req.piece, req.slide, st, extOf(img.mime), true), img), 'campaign', 'post');
}

// ---------------------------------------------------------------- agent_image (0084 — the designer assistant's picture, decision 6)

async function agentImage(deps: Deps, who: Who, args: Json) {
  if (!who.mkt) return json(401, { error: 'unauthorized' });
  const parsed = parseAgentImage(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req;
  const { data: chat } = await deps.db.from('mkt_agent_chats').select('id, member_id, agent, deleted_at').eq('id', req.chatId).maybeSingle();
  if (!isObj(chat) || chat.member_id !== who.uid || chat.agent !== 'designer' || chat.deleted_at) return json(404, { error: 'not_found' });
  const base = { created_by: who.uid, action: 'image', source: 'agent', label: line(req.prompt, 200) };
  const st = stamp(deps);
  const res = await runImages(deps, base, req.model, 1,
    (prov, m, style) => prov.generate({ model: m, prompt: req.prompt + style, width: req.size.w, height: req.size.h, count: 1, references: [] }),
    (img) => upload(deps.db, MKT_BUCKET, agentImagePath(who.uid, req.chatId, st, extOf(img.mime)), img), 'campaign', 'post');
  if (res.status !== 200) return res;
  const body = await res.json();
  if (body.result !== 'ok') return json(200, body);
  const now = deps.now();
  const { data: turn, error } = await deps.db.from('mkt_agent_messages').insert({ chat_id: req.chatId, role: 'assistant', text: '', images: [body.path], run_id: body.run_id, created_at: now })
    .select('id, role, text, images, created_at').single();
  if (error || !isObj(turn)) return json(500, { error: 'failed' });
  await deps.db.from('mkt_agent_chats').update({ updated_at: now }).eq('id', req.chatId);
  return json(200, { ...body, turn });
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
  // decision 14: a studio result renamed → the batch's state points at the new name (slots / main / refs / color images)
  if (bucket === STUDIO_BUCKET && target !== path) {
    const batchId = path.split('/')[0];
    const { data: b } = await deps.db.from('studio_batches').select('id, state').eq('id', batchId).maybeSingle();
    const r = renameInState(isObj(b) ? b.state : null, path, target);
    if (r.changed) await deps.db.from('studio_batches').update({ state: r.state }).eq('id', batchId);
  }
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
    // decision 15: the size drawing a product (its own numbers) — the item's sizes as the studio keeps them (strings)
    const sizes = order.map((i) => (Array.isArray(items[i]?.sizes) ? items[i].sizes.filter((s: unknown) => typeof s === 'string') : []));
    const plan = flowNodes({ title, category, photos: order.map((i) => byIndex.get(i) as string), prompts: Array.isArray(promptRows) ? promptRows : [], sizes });
    const created = await bridge.callTool(token, 'spaces_create_node', { spaceId, pageId, nodes: plan.nodes }) as Json;
    const results: Json[] = Array.isArray(created?.results) ? created.results : [];
    const idOf: Record<string, string> = {};
    for (const r of results) if (isObj(r) && r.ok !== false && typeof r.ref === 'string' && typeof r.nodeId === 'string') idOf[r.ref] = r.nodeId;
    const missing = plan.nodes.map((n) => n.ref).filter((ref) => !idOf[ref]);
    if (missing.length) throw new BridgeError('mcp_error', null, 'nodes not created: ' + missing.join(','));
    await bridge.callTool(token, 'spaces_add_connection', { spaceId, connections: plan.connections.map((c) => ({ sourceElementId: idOf[c.from], sourcePort: c.fromPort, targetElementId: idOf[c.to], targetPort: c.toPort, dataType: 'image', pageId })) });
    // the three shots read the list (shot s, item k → product order[k]); a size generator carries its product (index) — its output goes to slot 3
    const gens: Json[] = [1, 2, 3].map((s) => ({ shot: s, id: idOf['gen' + s], out: idOf['out' + s] }));
    for (const g of plan.sizeGens) gens.push({ shot: 4, index: order[g.k], id: idOf[g.gen], out: idOf[g.out] });
    const flow = { space_id: spaceId, url: spaceUrl, page_id: pageId, category, panel: idOf.panel, list: idOf.list, gens, order, made_at: deps.now() };
    // the record the fetch trusts lives with the server (settings «magnific».flows — members cannot write it); the batch keeps a copy for the page
    const latest = await magnificSettings(deps);
    await saveMagnificSettings(deps, { flows: { ...(isObj(latest.flows) ? latest.flows : {}), [batchId]: flow } });
    await deps.db.from('studio_batches').update({ state: { ...state, flow } }).eq('id', batchId);
    return json(200, { result: 'ok', batch_id: batchId, url: spaceUrl, space_id: spaceId, page_id: pageId, photos: order.length, sizes: plan.sizeGens.length, category, prompts: Array.isArray(promptRows) ? promptRows.length : 0 });
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
    // a size generator (decision 15) is one product's: every new result of it → that product, slot 3
    if (Number.isInteger(g.index)) { ids.forEach((id) => { if (!known.has(id)) picks.push({ id, index: Number(g.index), slot: 3 }); }); continue; }
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
  // the flow of this batch as the server recorded it (never the member-writable batch.state): its Space must be ours
  const cfg = await magnificSettings(deps);
  const recorded = isObj(cfg.flows) && isObj(cfg.flows[batchId]) ? cfg.flows[batchId] : null;
  const flow = recorded && typeof recorded.space_id === 'string' && recorded.space_id === cfg.space_id ? recorded : null;
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
    if (action === 'campaign') return await campaign(deps, who, args);
    if (action === 'campaign_edit') return await campaignEdit(deps, who, args);
    if (action === 'agent_image') return await agentImage(deps, who, args);
    if (action === 'video_clip') return await videoClip(deps, who, args);
    if (action === 'video_voice') return await videoVoice(deps, who, args);
    if (action === 'video_music') return await videoMusic(deps, who, args);
    if (action === 'video_upload') return await videoUpload(deps, who, args);
    if (action === 'video_assemble') return await videoAssemble(deps, who, args);
    if (action === 'video_poll') return await videoPoll(deps, who, args);
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

// ---------------------------------------------------------------- the video (phase 9.5.5, decisions 57–64) — through the bridge, asynchronous
// jobs in mkt_video_jobs: a clip a scene (or one multi-shot call), the voice-over, the music, an upload, the cut and the mixes; the
// page polls (video_poll) and the finished results land in bucket marketing. The bridge account pays — credits 0 here.

const VIDEO_WAIT_SECONDS = 20;
const JOB_COLS = 'id, campaign_id, piece, kind, scene, creation_ref, status, url, path, bytes, duration, error, data, created_by, created_at, updated_at, done_at';
const videoLabel = (p: Json, what: string) => line('فيديو ' + (p.n ?? '') + ' · ' + what, 200);
async function videoPiece(deps: Deps, who: Who, action: string, args: Json): Promise<{ error: Response } | { req: Json; c: Json; p: Json; w: Json }> {
  if (!who.mkt) return { error: json(401, { error: 'unauthorized' }) };
  const parsed = parseVideo(action, args); if ('error' in parsed) return { error: json(400, parsed) };
  const c = await readCampaign(deps, parsed.req.campaignId); if (!c) return { error: json(404, { error: 'not_found' }) };
  const st = isObj(c.state) ? c.state : {}; const p = (Array.isArray(st.pieces) ? st.pieces : []).find((x: Json) => isObj(x) && x.id === parsed.req.piece && x.kind === 'فيديو');
  if (!p) return { error: json(400, { error: 'bad_request', field: 'piece' }) };
  return { req: parsed.req, c, p, w: isObj(st.w) ? st.w : {} };
}
async function videoJobs(deps: Deps, campaignId: string, piece: string): Promise<Json[]> {
  const { data } = await deps.db.from('mkt_video_jobs').select(JOB_COLS).eq('campaign_id', campaignId).eq('piece', piece).order('created_at', { ascending: true }).limit(200);
  return Array.isArray(data) ? data.filter(isObj) : [];
}
const openJobs = (jobs: Json[]) => jobs.filter((j) => j.status === 'queued' || j.status === 'running');
async function newJob(deps: Deps, who: Who, req: Json, row: Json): Promise<Json | null> {
  const { data, error } = await deps.db.from('mkt_video_jobs').insert({ campaign_id: req.campaignId, piece: req.piece, status: 'running', created_by: who.uid, created_at: deps.now(), updated_at: deps.now(), ...row }).select(JOB_COLS).single();
  return error || !isObj(data) ? null : data;
}
// a run row a generation call (decision 64): the throttle applies, no credits
// a direct provider's run (usd > 0) is reserved in USD against the content cap first (security review: no paid call outside the cap)
async function videoRun(deps: Deps, who: Who, label: string, work: () => Promise<Json>, usd = 0, usdCap: number | null = null): Promise<Response> {
  const row = { created_by: who.uid, action: 'image', source: 'video', label };
  const run = usd > 0 ? await startRunUsd(deps, row, usd, usdCap) : await startRun(deps, row, 0, null);
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  try {
    const out = await work();
    await finishRun(deps, run.id, { status: 'ok', credits: 0, cost_usd: usd, output: out });
    return json(200, { result: 'ok', ...out });
  } catch (e) {
    if (e instanceof BridgeError) { await finishRun(deps, run.id, { status: 'error', error: e.kind, credits: 0, cost_usd: 0 }); return bridgeFail(e); }
    if (e instanceof McpError) { await finishRun(deps, run.id, { status: 'error', error: e.kind, credits: 0, cost_usd: 0, output: { status: e.status, detail: e.detail } }); return json(e.kind === 'not_linked' ? 503 : e.kind === 'busy' ? 429 : 502, { error: e.kind, status: e.status, detail: e.detail, provider: 'higgsfield' }); }
    if (e instanceof ProviderError) { await finishRun(deps, run.id, { status: 'error', error: e.kind, credits: 0, cost_usd: 0, output: { status: e.status, detail: e.detail } }); return json(e.kind === 'not_configured' ? 503 : e.kind === 'busy' ? 429 : e.kind === 'refused' ? 200 : 502, e.kind === 'refused' ? { result: 'refused' } : { error: e.kind, status: e.status }); }
    await finishRun(deps, run.id, { status: 'error', error: 'failed', credits: 0, cost_usd: 0 }); throw e;
  }
}
// a campaign image (a scene's key frame) onto Magnific by a signed link → its creation identifier
async function keyframeRef(deps: Deps, token: string, campaignId: string, path: string, name: string): Promise<string | null> {
  if (!campaignPathOk(campaignId, path)) return null;
  const { data: sg } = await deps.db.storage.from(MKT_BUCKET).createSignedUrl(path, UPLOAD_LINK_SECONDS);
  const url = typeof sg?.signedUrl === 'string' && /^https:\/\//.test(sg.signedUrl) ? sg.signedUrl : null; if (!url) return null;
  return uploadedId(await deps.bridge!.callTool(token, 'creations_upload_image', { url, fileName: name, folderReference: projectRef(deps.env) }));
}
const firstId = (data: Json, what: string) => { const ids = queuedIds(data); if (!ids.length) throw new BridgeError('mcp_error', null, what + ': no identifier'); return ids[0]; };

async function videoClip(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'clip', args); if ('error' in got) return got.error;
  const { req, p, w } = got; const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const scenes: Json[] = Array.isArray(p.scenes) ? p.scenes.filter(isObj) : []; if (!scenes.length) return json(400, { error: 'bad_request', field: 'scenes' });
  const model: Json = videoModelOf(typeof p.model === 'string' ? p.model : '') ?? {}; const chained = p.method === 'chained' && model.multishot === true;
  if (!chained && (req.scene == null || !scenes[req.scene])) return json(400, { error: 'bad_request', field: 'scene' });
  const jobs = await videoJobs(deps, req.campaignId, req.piece); if (openJobs(jobs).length >= MAX_OPEN_JOBS) return json(409, { error: 'busy_piece', open: openJobs(jobs).length });
  const media = isObj(w.media) && isObj(w.media.video) ? w.media.video : {};
  const frame = chained ? scenes[0] : scenes[req.scene]; const img = typeof frame.img === 'string' ? frame.img : null;
  if (!img) return json(400, { error: 'bad_request', field: 'image' });
  const cfg = await settingsOf(deps); const vd = videoPick(cfg.ai);
  if (vd.provider === 'veo') { // phase 11 (decision 15): Google Veo with the Gemini key — a scene at a time (no multi-shot), the operation kept on the job and finished by video_poll
    if (!deps.veo || !deps.env.GEMINI_API_KEY?.trim()) return json(503, { error: 'not_configured', configured: false, provider: 'veo' });
    if (chained) return json(400, { error: 'bad_request', field: 'method' });
    const sc = scenes[req.scene]; const seconds = veoSeconds(Number(sc.d) || 5);
    const usd = Math.round(((VEO_USD_PER_SECOND as Record<string, number>)[vd.model as string] ?? 0.4) * seconds * 1e6) / 1e6;
    const key = campaignPathOk(req.campaignId, img) ? await download(deps.db, MKT_BUCKET, img) : null;
    const prompt = line([sc.idea, sc.cam ? 'camera: ' + sc.cam : '', sc.text ? 'on-screen text: ' + sc.text : '', media.notes].filter(Boolean).join('. '), 1500);
    return await videoRun(deps, who, videoLabel(p, 'المشهد ' + (req.scene + 1)), async () => {
      const op = await deps.veo!.start({ model: vd.model as string, prompt, image: key ? { bytes: key.bytes, mime: key.mime } : null, aspect: String(p.size ?? '9:16'), seconds });
      const job = await newJob(deps, who, req, { kind: 'clip', scene: req.scene, creation_ref: null, data: { model: vd.model, provider: 'veo', veo_op: op, duration: seconds, ratio: veoAspect(String(p.size ?? '9:16')) } });
      if (!job) throw new Error('db mkt_video_jobs');
      return { job: jobView(job) };
    }, usd, cfg.usdCap);
  }
  if (vd.provider === 'higgsfield') { // phase 11 (decisions 4 / 15): Higgsfield's MCP server linked from the settings (mcp_higgsfield: url + token) — a scene at a time
    const link = await secretOf(deps.db, 'mcp_higgsfield') as Json | null;
    if (!deps.mcp || !link || typeof link.url !== 'string') return json(503, { error: 'not_configured', configured: false, provider: 'higgsfield' });
    if (chained) return json(400, { error: 'bad_request', field: 'method' });
    const sc = scenes[req.scene]; const seconds = Math.max(4, Math.min(15, Math.round(Number(sc.d) || 5)));
    const hfModel = HF_MODEL[String(p.model)] ?? (vd.model as string);
    const key = campaignPathOk(req.campaignId, img) ? await download(deps.db, MKT_BUCKET, img) : null;
    const prompt = line([sc.idea, sc.cam ? 'camera: ' + sc.cam : '', sc.text ? 'on-screen text: ' + sc.text : '', media.notes].filter(Boolean).join('. '), 1500);
    const client = deps.mcp(link.url, typeof link.token === 'string' ? link.token : null);
    return await videoRun(deps, who, videoLabel(p, 'المشهد ' + (req.scene + 1)), async () => {
      let mediaId: string | null = null;
      if (key) {
        const up = await client.callTool('media_upload', { file_name: 'scene-' + (req.scene + 1) + '.' + img.split('.').pop(), content_type: key.mime, type: 'image' });
        const putUrl = findKey(up, ['upload_url', 'uploadUrl', 'presigned_url', 'url']); const id = findKey(up, ['media_id', 'mediaId', 'id']);
        let put: URL | null = null; try { put = typeof putUrl === 'string' ? new URL(putUrl) : null; } catch { put = null; }
        if (!put || !mcpHostOk(deps, link.url, put) || typeof id !== 'string') throw new McpError('mcp_error', null, 'media_upload');
        const r = await (deps.fetch ?? fetch)(put.href, { method: 'PUT', headers: { 'Content-Type': key.mime }, body: key.bytes as BodyInit, redirect: 'error', signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new McpError('mcp_error', r.status, 'upload put');
        await client.callTool('media_confirm', { media_id: id });
        mediaId = id;
      }
      const gen = await client.callTool('generate_video', { params: { model: hfModel, prompt, aspect_ratio: String(p.size === '4:5' ? '9:16' : p.size ?? '9:16'), duration: seconds, ...(mediaId ? { medias: [{ value: mediaId, role: 'image' }] } : {}) } });
      const jobId = findKey(gen, ['job_id', 'jobId', 'id']);
      if (typeof jobId !== 'string') throw new McpError('mcp_error', null, 'generate_video');
      const job = await newJob(deps, who, req, { kind: 'clip', scene: req.scene, creation_ref: null, data: { model: hfModel, provider: 'higgsfield', hf_job: jobId, duration: seconds, ratio: String(p.size ?? '9:16') } });
      if (!job) throw new Error('db mkt_video_jobs');
      return { job: jobView(job) };
    });
  }
  let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  return await videoRun(deps, who, videoLabel(p, chained ? 'المشاهد' : 'المشهد ' + (req.scene + 1)), async () => {
    const ref = await keyframeRef(deps, token, req.campaignId, img, 'scene-' + (chained ? 1 : req.scene + 1) + '.' + img.split('.').pop());
    if (!ref) throw new BridgeError('mcp_error', null, 'key frame upload');
    const common = { model: model.id, size: p.size, res: p.res, piece: p, w, notes: media.notes, imageRef: ref, folder: projectRef(deps.env) };
    const a: Json | null = chained ? chainedArgs({ ...common, scenes }) : clipArgs({ ...common, scene: scenes[req.scene] });
    if (!a) throw new BridgeError('mcp_error', null, 'no shots');
    const id = firstId((await bridge.callTool(token, 'video_generate', a)) as Json, 'video_generate');
    const job = await newJob(deps, who, req, { kind: 'clip', scene: chained ? null : req.scene, creation_ref: ref === id ? null : id, data: { model: model.id, duration: a.duration, ratio: a.aspectRatio, resolution: a.resolution, method: chained ? 'chained' : 'separate', frame: ref } });
    if (!job) throw new Error('db mkt_video_jobs');
    return { job: jobView(job) };
  });
}
async function videoVoice(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'voice', args); if ('error' in got) return got.error;
  const { req, p } = got;
  const jobs = await videoJobs(deps, req.campaignId, req.piece); if (openJobs(jobs).length >= MAX_OPEN_JOBS) return json(409, { error: 'busy_piece', open: openJobs(jobs).length });
  const cfg = await settingsOf(deps); const vp = voicePick(cfg.ai);
  if (vp.provider === 'elevenlabs') { // phase 11 (decision 15): the admin's own ElevenLabs key — the MP3 kept here and, when the bridge is linked, on Magnific for the assembly
    if (!deps.tts || !deps.env.ELEVENLABS_API_KEY?.trim()) return json(503, { error: 'not_configured', configured: false, provider: 'elevenlabs' });
    const P = providersOf(cfg.ai); const map = isObj(P.voice) && isObj((cfg.ai as Json)?.providers?.voice?.elevenVoices) ? (cfg.ai as Json).providers.voice.elevenVoices : {};
    const voiceId = typeof map[req.voice] === 'string' ? map[req.voice] : null;
    const usd = Math.round(req.text.length / 1000 * VOICE_USD_PER_1K * 1e6) / 1e6;
    return await videoRun(deps, who, videoLabel(p, 'الفويس أوفر'), async () => {
      const audio = await deps.tts!({ text: req.text, voiceId, model: vp.model });
      const kept = await keepDirectMedia(deps, req.campaignId, req.piece, 'vo', audio, 'mp3');
      const job = await newJob(deps, who, req, { kind: 'voice', creation_ref: kept.creation_ref, status: 'done', path: kept.path, bytes: kept.bytes, done_at: deps.now(), data: { voice: req.voice, chars: req.text.length, provider: 'elevenlabs' } });
      if (!job) throw new Error('db mkt_video_jobs');
      return { job: jobView(job) };
    }, usd, cfg.usdCap);
  }
  const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  return await videoRun(deps, who, videoLabel(p, 'الفويس أوفر'), async () => {
    const id = firstId((await bridge.callTool(token, 'audio_tts', ttsArgs({ text: req.text, voice: req.voice, folder: projectRef(deps.env) }) as Json)) as Json, 'audio_tts');
    const job = await newJob(deps, who, req, { kind: 'voice', creation_ref: id, data: { voice: req.voice, chars: req.text.length } });
    if (!job) throw new Error('db mkt_video_jobs');
    return { job: jobView(job) };
  });
}
async function videoMusic(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'music', args); if ('error' in got) return got.error;
  const { req, p } = got; const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const jobs = await videoJobs(deps, req.campaignId, req.piece); if (openJobs(jobs).length >= MAX_OPEN_JOBS) return json(409, { error: 'busy_piece', open: openJobs(jobs).length });
  let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  return await videoRun(deps, who, videoLabel(p, 'الموسيقى'), async () => {
    const id = firstId((await bridge.callTool(token, 'audio_music_generate', musicArgs({ type: req.type, folder: projectRef(deps.env) }))) as Json, 'audio_music_generate');
    const job = await newJob(deps, who, req, { kind: 'music', creation_ref: id, data: { type: req.type } });
    if (!job) throw new Error('db mkt_video_jobs');
    return { job: jobView(job) };
  });
}
// a member's own audio file (bucket marketing) onto Magnific: request_upload → PUT the bytes → finalize → a done job of kind upload
async function videoUpload(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'upload', args); if ('error' in got) return got.error;
  const { req, p } = got; const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const { data: file, error } = await deps.db.storage.from(MKT_BUCKET).download(req.path);
  if (error || !file) return json(400, { error: 'bad_request', field: 'path' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = req.path.split('.').pop()!.toLowerCase(); const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4' : 'video/mp4';
  if (!bytes.length || bytes.length > 50_000_000) return json(400, { error: 'bad_request', field: 'path' });
  let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  return await videoRun(deps, who, videoLabel(p, req.role === 'voice' ? 'ملف الصوت' : 'ملف الموسيقى'), async () => {
    const id = await bridgeUploadBytes(deps, token, bytes, mime, (req.role === 'voice' ? 'voice' : 'music') + '-' + req.piece + '.' + ext);
    const job = await newJob(deps, who, req, { kind: 'upload', creation_ref: id, status: 'done', path: req.path, bytes: bytes.length, done_at: deps.now(), data: { role: req.role } });
    if (!job) throw new Error('db mkt_video_jobs');
    return { job: jobView(job) };
  });
}
// bytes onto Magnific as a creation (request_upload → PUT → finalize) → its identifier; the assembly (concatenate / mix) works on creations
async function bridgeUploadBytes(deps: Deps, token: string, bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
  const bridge = deps.bridge!;
  const up = (await bridge.callTool(token, 'creations_request_upload', { mimeType: mime })) as Json;
  const putUrl = isObj(up) ? (typeof up.url === 'string' ? up.url : typeof up.uploadUrl === 'string' ? up.uploadUrl : Array.isArray(up.uploads) && isObj(up.uploads[0]) ? up.uploads[0].url : null) : null;
  const tmp = isObj(up) ? (typeof up.path === 'string' ? up.path : Array.isArray(up.uploads) && isObj(up.uploads[0]) ? up.uploads[0].path : null) : null;
  if (typeof putUrl !== 'string' || !/^https:\/\//.test(putUrl) || typeof tmp !== 'string') throw new BridgeError('mcp_error', null, 'request_upload');
  const r = await (deps.fetch ?? fetch)(putUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes as BodyInit, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new BridgeError('mcp_error', r.status, 'upload put');
  return firstId((await bridge.callTool(token, 'creations_finalize_upload', { path: tmp, fileName, folderReference: projectRef(deps.env), visible: false })) as Json, 'finalize_upload');
}
// the page's video model ids → Higgsfield's MCP model ids
const HF_MODEL: Record<string, string> = { 'seedance-2.5': 'seedance_2_5', 'seedance-2.0': 'seedance_2_5', 'kling-2.5': 'kling3_0', 'minimax-h3': 'minimax_h3' };
// the hosts a linked MCP server's links may point at (an upload PUT, a finished clip): the server's own registrable domain (its
// sub-hosts included), the import hosts, and VIDEO_HOSTS — never any https host the answer names (security review: SSRF)
function mcpHostOk(deps: Deps, linkUrl: string, url: URL): boolean {
  let link: URL | null = null; try { link = new URL(linkUrl); } catch { link = null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !/^[a-z0-9.-]+$/.test(host)) return false;
  const allowed = importHosts(deps.env);
  for (const h of (deps.env.VIDEO_HOSTS ?? '').split(',')) { const x = h.trim().toLowerCase(); if (/^[a-z0-9.-]+$/.test(x)) allowed.add(x); }
  if (allowed.has(host)) return true;
  if (!link) return false;
  const apex = link.hostname.toLowerCase().split('.').slice(-2).join('.');
  return apex.includes('.') && (host === apex || host.endsWith('.' + apex));
}
// a finished video from a provider's https link (an allowed host, no redirects, within the size limit) → bytes
async function fetchMedia(deps: Deps, linkUrl: string, url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let u: URL | null = null; try { u = new URL(url); } catch { u = null; }
  if (!u || !mcpHostOk(deps, linkUrl, u)) return null;
  try {
    const r = await (deps.fetch ?? fetch)(u.href, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return null;
    const declared = Number(r.headers.get('content-length')); if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) return null;
    const bytes = new Uint8Array(await r.arrayBuffer()); if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) return null;
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { bytes, mime: ct.startsWith('video/') ? ct : 'video/mp4' };
  } catch { return null; }
}
// a direct provider's result into bucket marketing, and onto Magnific too when the account is linked (so the assembly can use it)
async function keepDirectMedia(deps: Deps, campaignId: string, piece: string, part: string, media: { bytes: Uint8Array; mime: string }, ext: string): Promise<{ path: string | null; bytes: number; creation_ref: string | null }> {
  const path = videoPath(campaignId, piece, part, stamp(deps), ext);
  const { error } = await deps.db.storage.from(MKT_BUCKET).upload(path, media.bytes, { contentType: media.mime, upsert: false });
  let creation: string | null = null;
  if (deps.bridge) { try { const token = await accessToken(deps); creation = await bridgeUploadBytes(deps, token, media.bytes, media.mime, part + '-' + piece + '.' + ext); } catch { creation = null; } }
  return { path: error ? null : path, bytes: media.bytes.length, creation_ref: creation };
}
// the cut (several clips) then the mixes one after the other, each started when the one before is done (video_poll)
async function videoAssemble(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'assemble', args); if ('error' in got) return got.error;
  const { req, p } = got; const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  const jobs = await videoJobs(deps, req.campaignId, req.piece);
  if (openJobs(jobs).length) return json(409, { error: 'busy_piece', open: openJobs(jobs).length });
  const plan = mixPlan(jobs, Array.isArray(p.scenes) ? p.scenes : [], p.method);
  if ('error' in plan) return json(409, { error: 'clips' });
  let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
  return await videoRun(deps, who, videoLabel(p, 'التجميع'), async () => {
    const chain = plan.steps; const first = chain[0];
    let job: Json | null;
    if (first === 'concat') {
      const id = firstId((await bridge.callTool(token, 'video_concatenate', { creationIdentifiers: plan.clips, name: 'ibtekr-' + req.piece, folderReference: projectRef(deps.env) })) as Json, 'video_concatenate');
      job = await newJob(deps, who, req, { kind: 'assemble', creation_ref: id, data: { chain, step: 0, plan, final: chain.length === 1 } });
    } else if (first) {
      const nx = nextMix(['cut', ...chain], 0, plan)!;
      const id = firstId((await bridge.callTool(token, 'video_audio_mix', { creationIdentifier: plan.clips[0], audioCreationIdentifier: nx.audio, audioVolume: nx.audioVolume, videoVolume: nx.videoVolume, folderReference: projectRef(deps.env) })) as Json, 'video_audio_mix');
      job = await newJob(deps, who, req, { kind: 'mix', creation_ref: id, data: { chain: ['cut', ...chain], step: 1, plan, role: nx.role, final: chain.length === 1 } });
    } else { // one clip, no audio: it is the video
      const src = jobs.find((j) => j.creation_ref === plan.clips[0] && j.status === 'done');
      job = await newJob(deps, who, req, { kind: 'mix', creation_ref: plan.clips[0], status: 'done', path: src?.path ?? null, bytes: src?.bytes ?? null, done_at: deps.now(), data: { chain: [], step: 0, plan, final: true } });
    }
    if (!job) throw new Error('db mkt_video_jobs');
    return { job: jobView(job) };
  });
}
// a finished creation's media into bucket marketing (an allowed host, a size cap, mp4 / audio) → { path, bytes } | null (kept by its link)
async function storeMedia(deps: Deps, url: string, path: string): Promise<{ path: string; bytes: number } | null> {
  let u: URL | null = null; try { u = new URL(url); } catch { u = null; }
  if (!u || u.protocol !== 'https:' || u.username || u.password || !importHosts(deps.env).has(u.hostname.toLowerCase())) return null;
  try {
    const r = await (deps.fetch ?? fetch)(u.href, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return null;
    const declared = Number(r.headers.get('content-length')); if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) return null;
    const bytes = new Uint8Array(await r.arrayBuffer()); if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) return null;
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = path.split('.').pop()!; const mime = (MEDIA_EXT as Record<string, string>)[ct] ? ct : ext === 'mp4' ? 'video/mp4' : 'audio/mpeg';
    const { error } = await deps.db.storage.from(MKT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    return error ? null : { path, bytes: bytes.length };
  } catch { return null; }
}
const partOf = (j: Json) => (j.kind === 'clip' ? (j.scene == null ? 'all' : 's' + (Number(j.scene) + 1)) : j.kind === 'voice' ? 'vo' : j.kind === 'music' ? 'mu' : j.kind === 'assemble' ? 'cut' : 'mix');
async function videoPoll(deps: Deps, who: Who, args: Json) {
  const got = await videoPiece(deps, who, 'poll', args); if ('error' in got) return got.error;
  const { req } = got; const bridge = deps.bridge; if (!bridge) return json(503, { error: 'not_configured', configured: false });
  let jobs = await videoJobs(deps, req.campaignId, req.piece);
  // phase 11: the Veo clips (no creation yet) — the operation polled, the finished video kept here and put onto Magnific for the assembly
  for (const j of openJobs(jobs).filter((x) => isObj(x.data) && typeof x.data.veo_op === 'string').slice(0, 4)) {
    if (!deps.veo) break;
    try {
      const st = await deps.veo.poll(j.data.veo_op);
      if (!st.done) continue;
      if (st.error || !st.uri) { await deps.db.from('mkt_video_jobs').update({ status: 'failed', error: st.error ?? 'failed', updated_at: deps.now() }).eq('id', j.id); continue; }
      const media = await deps.veo.download(st.uri);
      const kept = await keepDirectMedia(deps, req.campaignId, req.piece, partOf(j), media, 'mp4');
      await deps.db.from('mkt_video_jobs').update({ status: 'done', creation_ref: kept.creation_ref, path: kept.path, bytes: kept.bytes, done_at: deps.now(), updated_at: deps.now() }).eq('id', j.id);
    } catch (e) {
      if (e instanceof ProviderError && e.kind !== 'busy') await deps.db.from('mkt_video_jobs').update({ status: 'failed', error: e.kind, updated_at: deps.now() }).eq('id', j.id);
    }
  }
  // the Higgsfield clips: jobs_wait (a snapshot) → a terminal job's url downloaded, kept here and put onto Magnific for the assembly
  const hf = openJobs(jobs).filter((x) => isObj(x.data) && typeof x.data.hf_job === 'string').slice(0, 8);
  if (hf.length && deps.mcp) {
    const link = await secretOf(deps.db, 'mcp_higgsfield') as Json | null;
    if (link && typeof link.url === 'string') {
      try {
        const client = deps.mcp(link.url, typeof link.token === 'string' ? link.token : null);
        const out = await client.callTool('jobs_wait', { jobs: hf.map((j, i) => ({ index: i, job_id: j.data.hf_job })), timeout_seconds: 0 });
        const items: Json[] = (Array.isArray(out) ? out : Array.isArray((out as Json)?.jobs) ? (out as Json).jobs : Array.isArray((out as Json)?.results) ? (out as Json).results : []).filter(isObj);
        for (const j of hf) {
          const it = items.find((x) => x.job_id === j.data.hf_job || x.jobId === j.data.hf_job || x.id === j.data.hf_job) ?? items[hf.indexOf(j)];
          if (!it) continue;
          const st = String(findKey(it, ['status', 'state']) ?? '').toLowerCase();
          if (!/^(completed|succeeded|success|done|finished|failed|error|cancelled|canceled)$/.test(st)) continue;
          const url = findKey(it, ['result_url', 'video_url', 'url', 'output_url']);
          if (/fail|error|cancel/.test(st) || typeof url !== 'string' || !/^https:\/\//.test(url)) { await deps.db.from('mkt_video_jobs').update({ status: 'failed', error: /fail|error|cancel/.test(st) ? st : 'no video', updated_at: deps.now() }).eq('id', j.id); continue; }
          const media = await fetchMedia(deps, link.url, url);
          if (!media) { await deps.db.from('mkt_video_jobs').update({ status: 'failed', error: 'download', updated_at: deps.now() }).eq('id', j.id); continue; }
          const kept = await keepDirectMedia(deps, req.campaignId, req.piece, partOf(j), media, 'mp4');
          await deps.db.from('mkt_video_jobs').update({ status: 'done', creation_ref: kept.creation_ref, path: kept.path, bytes: kept.bytes, done_at: deps.now(), updated_at: deps.now() }).eq('id', j.id);
        }
      } catch (e) { if (!(e instanceof McpError)) throw e; /* the next poll asks again */ }
    }
  }
  jobs = await videoJobs(deps, req.campaignId, req.piece);
  const open = openJobs(jobs).filter((j) => typeof j.creation_ref === 'string').slice(0, 8);
  if (open.length) {
    let token: string; try { token = await accessToken(deps); } catch (e) { return bridgeFail(e); }
    let states: Json[] = [];
    try { states = waitOf((await bridge.callTool(token, 'creations_wait', { identifiers: open.map((j) => j.creation_ref), timeoutSeconds: VIDEO_WAIT_SECONDS })) as Json); } catch (e) { return bridgeFail(e); }
    const byId = new Map(states.map((s) => [s.id, s]));
    for (const j of open) {
      const s = byId.get(j.creation_ref); if (!s || s.status === 'running') continue;
      if (s.status === 'failed') { await deps.db.from('mkt_video_jobs').update({ status: 'failed', error: s.error ?? 'failed', updated_at: deps.now() }).eq('id', j.id); continue; }
      let url = s.url;
      if (!url) { try { const got2 = (await bridge.callTool(token, 'creations_get', { creationIdentifier: j.creation_ref })) as Json; url = isObj(got2) ? (typeof got2.url === 'string' ? got2.url : null) : null; } catch { url = null; } }
      const ext = j.kind === 'voice' || j.kind === 'music' ? 'mp3' : 'mp4';
      const stored = url ? await storeMedia(deps, url, videoPath(req.campaignId, req.piece, partOf(j), stamp(deps), ext)) : null;
      await deps.db.from('mkt_video_jobs').update({ status: 'done', url: url ?? null, path: stored?.path ?? null, bytes: stored?.bytes ?? null, done_at: deps.now(), updated_at: deps.now() }).eq('id', j.id);
      // the assembly chain goes on: the next mix over this result
      const d = isObj(j.data) ? j.data : {};
      if ((j.kind === 'assemble' || j.kind === 'mix') && Array.isArray(d.chain) && isObj(d.plan)) {
        const nx = nextMix(d.chain, Number(d.step) || 0, d.plan);
        if (nx) {
          try {
            const id = firstId((await bridge.callTool(token, 'video_audio_mix', { creationIdentifier: j.creation_ref, audioCreationIdentifier: nx.audio, audioVolume: nx.audioVolume, videoVolume: nx.videoVolume, folderReference: projectRef(deps.env) })) as Json, 'video_audio_mix');
            await newJob(deps, who, req, { kind: 'mix', creation_ref: id, data: { chain: d.chain, step: nx.step, plan: d.plan, role: nx.role, final: nx.step === d.chain.length - 1 } });
          } catch (e) {
            if (!(e instanceof BridgeError)) throw e;
            await newJob(deps, who, req, { kind: 'mix', status: 'failed', error: e.kind, data: { chain: d.chain, step: nx.step, plan: d.plan, role: nx.role } });
          }
        }
      }
    }
    jobs = await videoJobs(deps, req.campaignId, req.piece);
  }
  const final = jobs.filter((j) => j.status === 'done' && (j.kind === 'mix' || j.kind === 'assemble') && isObj(j.data) && j.data.final === true).pop() ?? null;
  return json(200, { result: 'ok', jobs: jobs.map(jobView), open: openJobs(jobs).length, final: final ? jobView(final) : null });
}

// ---------------------------------------------------------------- runtime wiring

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
let service: Db = null;
async function realDeps(): Promise<Deps> {
  const raw = Deno.env.toObject();
  service ??= createClient(raw.SUPABASE_URL ?? '', raw.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  const env = await vaultEnv(service, raw); // the keys written from the settings page win over the Supabase secrets (0056)
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    provider: magnific(env),
    providers: { openai: openaiImage(env), gemini: geminiImage(env) },
    tts: (r) => elevenTts(env, r),
    mcp: (url, token) => mcpClient(url, token, globalThis.fetch),
    veo: { start: (r) => veoStart(env, r), poll: (op) => veoPoll(env, op), download: (uri) => veoDownload(env, uri) },
    bridge: magnificMcp(env),
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await realDeps()));
