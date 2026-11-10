// ai-content: the AI content of phase 5.3 (docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md), deployed with
// verify_jwt false; it authenticates here — a member's Authorization: Bearer <jwt> only, never a sync secret: the AI runs at a
// person's request (decision 3). Body { action, ...args }:
//   'write'  (the content tool; the admin or products.add = F or products.edit = F) { source: data | image | product, outputs,
//            langs, tone?, data?, current?, image?, product_id? } → { result: 'ok', out: { ar?, en? }, missing, model, cost_usd,
//            run_id }. For a product, its row, Arabic name, category paths, brands and main image come from the mirror (never
//            from the body); the page sends the product's current texts as `current`.
//   'studio' (the studio; the admin or products.add = F) { batch_id, index, want } → { result: 'ok', fields, missing, model,
//            cost_usd, run_id }: the item, its brand and photo (bucket studio), the site's categories and sku_colors read here.
//   'marketing' (phase 9.5.1 «التسويق», decision 10; the admin or marketing.create = F) { task: fill | rewrite | describe, campaign_id?,
//            piece?, slide?, kind?, text?, image? } → fill: { result: 'ok', fields } (a campaign piece's fields — and a carousel's
//            slides — from its campaign read here, never from the body); rewrite: { result: 'ok', text } (one field again: the
//            general idea, an image's idea, a caption, a headline, a subheadline, a badge, the media's notes); describe: { text } (a
//            design template's description from its image). Egyptian Arabic; ai_runs action 'marketing' (source campaign /
//            post / template) on the same monthly cap — no Magnific credits.
//   'assistant' (phase 12 T1, decision 8; any signed-in member) { mode: chat | filter, turns, context } → { result: 'ok', text,
//            actions, tools, model, cost_usd, run_id }: the header's assistant. Claude runs a tool loop on the server: `get_data`
//            reads our tables with the member's own JWT client (RLS and has_perm decide what they see — never the service role),
//            the client tools (navigate / filter_orders / set_period / sort_vendors / propose_entry, set_filter in the filter
//            mode) come back as `actions` for the page to execute with its own functions (a money entry is only a confirm card
//            there). At most MAX_TOOL_CALLS data reads a turn; the turn's calls are summed into one ai_runs row (action
//            'assistant', source chat / filter, label = the question). Claude only (tool use), the «buyer» text tool's model.
// All only suggest: nothing is written to the site, the batch or the campaign (the page saves through product_save / IBStudio.save /
// IBMarketing.save).
// A request declined by the model's safety classifiers runs again on Anthropic's recommended model in the same call
// (fallbacks: "default"); still declined → 200 { result: 'refused' }. Every call is reserved first (ai_run_start: the member's
// throttle and the monthly cap in one locked step, a pending ai_runs row) and that row then holds its outcome (service role:
// the cleaned output and an error code only — never a prompt, an image or the key). Errors: 400 bad_request { field },
// 401 unauthorized, 404 not_found, 402 ai_cap (AI_MONTHLY_LIMIT_USD would be passed this Cairo month), 429 busy (Anthropic's
// rate limit or overload, a timeout, or THROTTLE calls of the member in 10 minutes),
// 503 not_configured (no ANTHROPIC_API_KEY — the owner sets it in the Edge Functions' secrets — or the key refused),
// 502 ai_error (no usable answer). One quick retry for a 429 / 5xx; a product photo Claude could not fetch is dropped once.
// The model, the effort and the monthly cap (decision 8): the settings row «ai» (the admin changes it from the content tool) wins,
// the secrets AI_CONTENT_MODEL / AI_CONTENT_EFFORT / AI_MONTHLY_LIMIT_USD are the fallback, then the defaults — read before every call.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { aiSettings, categoryLines, cleanPrompts, cleanStudio, cleanWrite, costOf, line, parsePrompts, parseStudio, parseWrite, promptsRequest, readAnswer, shotPromptRows, studioRequest, usageOf, writeRequest } from '../_shared/ai-content.js';
import { vaultEnv } from '../_shared/secrets.js';
import { buyerRequest, campaignTarget, cleanBuyer, cleanMarketing, marketingRequest, parseBuyer, parseMarketing } from '../_shared/marketing.js';
import { SUGGEST_DAYS, buyerRules, windowOf } from '../_shared/mkt-ads.js';
import { cleanScenes, scenesRequest } from '../_shared/mkt-video.js';
import { TEXT_PROVIDERS, TEXT_TOOL_OF, houseStyle, textPick } from '../_shared/ai-providers.js';
import { MAX_TOOL_CALLS, amountsIn, reportOf, assistantMessage, assistantRequest, cleanAction, cleanAnswer, customersData, dataQuery, expensesData, ordersData, parseAssistant, readTurn, salesData, summaryData, tasksData, ticketsData, toolResults, vendorsData } from '../_shared/ai-assistant.js';
import { completeText } from './providers/text.ts';
import { cairoParts } from '../_shared/mkt-publish.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  claude: (params: Json) => Promise<Json>; sleep?: (ms: number) => Promise<void>;
  text?: (provider: string, params: Json) => Promise<Json>; // phase 11: OpenAI / Gemini (the Claude dep stays the Claude path)
};

const ACTIONS = ['write', 'studio', 'prompts', 'marketing', 'buyer', 'assistant'];
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
type Cfg = { model: string; effort: string; cap: number | null; provider: string; style: string };
// the settings row «ai» over the secrets (decision 8); a row that cannot be read = the secrets alone. Phase 11 (decisions 14 / 15):
// the provider and model of the action's tool from the row's `providers`, and the house style of the row «ai_rules» as one more
// system block (the products section, or the marketing «post» section for the marketing calls).
async function configOf(deps: Deps, action = 'write'): Promise<Cfg> {
  const { data, error } = await deps.db.from('settings').select('section, data').in('section', ['ai', 'ai_rules']);
  const rows: Json[] = !error && Array.isArray(data) ? data : [];
  const ai = rows.find((r) => r.section === 'ai')?.data; const rules = rows.find((r) => r.section === 'ai_rules')?.data;
  const base = aiSettings(isObj(ai) ? ai : null, deps.env);
  const pick = textPick(isObj(ai) ? ai : null, (TEXT_TOOL_OF as Record<string, string>)[action] ?? 'products');
  const style = action === 'buyer' || action === 'prompts' || action === 'assistant' ? '' : houseStyle(isObj(rules) ? rules : null, action === 'marketing' || action === 'scenes' ? 'post' : 'products');
  if (action === 'assistant') return { ...base, provider: 'claude', style }; // the tool loop is Claude's (the other text providers answer text only)
  return { ...base, provider: pick.provider, model: pick.provider === 'claude' ? base.model : pick.model, style };
}
const modelId = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60) : '') || null;

// ---------------------------------------------------------------- auth

const jwtOf = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
async function authorize(req: Request, deps: Deps, action: string): Promise<string | null> {
  const jwt = jwtOf(req);
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string, any = false) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && (data === 'F' || (any && data === 'P')); };
  const admin = async () => { const { data, error } = await member.rpc('is_admin'); return !error && data === true; };
  const ok = action === 'write' ? (await admin()) || (await perm('products.add')) || (await perm('products.edit'))
    : action === 'studio' || action === 'prompts' ? (await admin()) || (await perm('products.add'))
    : action === 'marketing' ? (await admin()) || (await perm('marketing.create'))
    : action === 'buyer' ? (await admin()) || (await perm('marketing.view', true))
    : action === 'assistant' ? true // any signed-in member: the data they read is theirs by RLS, the actions run on their screen
    : await admin();
  return ok ? await deps.userId(jwt) : null;
}

// ---------------------------------------------------------------- Claude

type Asked = { msg: Json } | { error: 'busy' | 'not_configured' | 'ai_error'; status: number | null };
const urlImage = (p: Json) => (p.messages?.[0]?.content ?? []).some((b: Json) => b?.type === 'image' && b.source?.type === 'url');
const withoutUrlImage = (p: Json) => ({ ...p, messages: [{ ...p.messages[0], content: p.messages[0].content.filter((b: Json) => !(b?.type === 'image' && b.source?.type === 'url')) }] });

async function ask(deps: Deps, params: Json, provider = 'claude'): Promise<Asked> {
  const started = Date.now();
  let p = params; let retried = false; let dropped = false;
  for (;;) {
    try {
      if (provider !== 'claude') { if (!deps.text) return { error: 'not_configured', status: null }; return { msg: await deps.text(provider, p) }; }
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
async function startRun(deps: Deps, row: Json, cap: number | null, reserve = RESERVE_USD) {
  const { data, error } = await deps.db.rpc('ai_run_start', { p_row: row, p_cap: cap, p_reserve: reserve, p_throttle: THROTTLE, p_window_minutes: THROTTLE_MINUTES });
  if (error || !isObj(data)) return { result: 'error' as const };
  const id = Number(data.id);
  if (data.result === 'ok' && Number.isInteger(id)) return { result: 'ok' as const, id };
  return { result: data.result === 'busy' ? 'busy' as const : data.result === 'cap' ? 'cap' as const : 'error' as const };
}
async function finishRun(deps: Deps, id: number, row: Json) {
  const { error } = await deps.db.from('ai_runs').update(row).eq('id', id);
  if (error) console.error('ai_runs update failed', error.code ?? ''); // the row keeps its reserve: the cap still counts it
}

// The common path of the actions: the reservation, the key, the call, the answer, the row; `save` (the prompts) writes the
// cleaned answer where it lives and may refuse (false → 500 failed; the run row keeps the answer and its cost).
async function runAi(deps: Deps, base: Json, cfg: Cfg, params: Json, clean: (answer: Json) => Json, save?: (out: Json) => Promise<boolean>): Promise<Response> {
  const run = await startRun(deps, { ...base, model: cfg.model }, cfg.cap); // the model id names the provider
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  const envKey = TEXT_PROVIDERS[cfg.provider as keyof typeof TEXT_PROVIDERS]?.env ?? 'ANTHROPIC_API_KEY';
  if (!deps.env[envKey]?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', cost_usd: 0 }); return json(503, { error: 'not_configured', provider: cfg.provider }); }
  if (cfg.style) params = { ...params, model: cfg.model, system: [...(Array.isArray(params.system) ? params.system : []), { type: 'text', text: cfg.style }] };
  else if (params.model !== cfg.model) params = { ...params, model: cfg.model };
  const asked = await ask(deps, params, cfg.provider);
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
  if (save && !(await save(out))) return json(500, { error: 'failed' });
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
  const cfg = await configOf(deps, 'write');
  const base = { created_by: uid, action: 'write', source: req.source, label, product_id: req.productId };
  return await runAi(deps, base, cfg, writeRequest(req, { model: cfg.model, effort: cfg.effort, product }),
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
  const cfg = await configOf(deps, 'studio');
  const label = line(item.nameEn || item.nameAr || '', 200) || '#' + (index + 1);
  const base = { created_by: uid, action: 'studio', source: 'studio', label, batch_id: batchId, item_index: index };
  const sets = { categoryIds: new Set(cats.map((c: Json) => Number(c.id))), colorCodes: new Set(colors.map((c: Json) => c.code)) };
  return await runAi(deps, base, cfg, studioRequest(item, { model: cfg.model, effort: cfg.effort, want, brand, cats, colors, image }),
    (answer) => cleanStudio(answer, want, sets));
}

// ---------------------------------------------------------------- prompts (decision 13: a category typed in the studio)

// The three shot prompts of a category that has none in the owner's template, written by Claude and kept in shot_prompts
// (upsert on category + shot) so the flow and every later batch of the category use them. The template's own rows
// (source_node set — bridge_prompts_sync) are never overwritten: 409 exists. An AI-written category can be written again.
async function prompts(deps: Deps, uid: string, args: Json) {
  const parsed = parsePrompts(args);
  if ('error' in parsed) return json(400, parsed);
  const { category } = parsed.req;
  const { data: rows } = await deps.db.from('shot_prompts').select('shot, source_node').eq('category', category);
  if ((Array.isArray(rows) ? rows : []).some((r: Json) => typeof r.source_node === 'string' && r.source_node)) return json(409, { error: 'exists', category });
  const cfg = await configOf(deps, 'prompts');
  const base = { created_by: uid, action: 'studio', source: 'studio', label: category };
  return await runAi(deps, base, cfg, promptsRequest(category, { model: cfg.model, effort: cfg.effort }), (answer) => cleanPrompts(answer), async (out) => {
    const list = Array.isArray(out.prompts) ? out.prompts : [];
    if (list.length < 3) return true; // a missing shot: nothing written — the page says what is missing
    const { error } = await deps.db.from('shot_prompts').upsert(shotPromptRows(category, list, uid, deps.now()), { onConflict: 'category,shot' });
    if (error) { console.error('shot_prompts upsert failed', error.code ?? ''); return false; }
    out.category = category; out.rows = list.length;
    return true;
  });
}

// ---------------------------------------------------------------- marketing (phase 9.5.1, decision 10)

async function marketing(deps: Deps, uid: string, args: Json) {
  const parsed = parseMarketing(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req;
  let target: Json | null = null;
  if (req.campaignId) {
    const { data: c } = await deps.db.from('mkt_campaigns').select('id, state, archived_at').eq('id', req.campaignId).maybeSingle();
    if (!isObj(c) || c.archived_at) return json(404, { error: 'not_found' });
    if (req.task === 'scenes') { // 9.5.5 decision 59: the video piece's scenes and voice-over, the durations fitted to its model
      const st = isObj(c.state) ? c.state : {}; const p = (Array.isArray(st.pieces) ? st.pieces : []).find((x: Json) => isObj(x) && x.id === req.piece && x.kind === 'فيديو');
      if (!p) return json(400, { error: 'bad_request', field: 'piece' });
      const w = isObj(st.w) ? st.w : {}; const media = isObj(w.media) && isObj(w.media.video) ? w.media.video : {};
      const n = Number.isInteger(p.sceneCount) ? p.sceneCount : 3; const dur = Number(p.dur) || Number(media.dur) || 15; const model = typeof p.model === 'string' ? p.model : 'seedance-2.5';
      const cfg = await configOf(deps, 'scenes');
      const base = { created_by: uid, action: 'marketing', source: 'campaign', label: line('فيديو ' + (p.n ?? '') + ' · المشاهد', 200) };
      return await runAi(deps, base, cfg, scenesRequest({ model: cfg.model, effort: cfg.effort, w, piece: p, n, dur, notes: media.notes, voice: req.voice }), (answer) => cleanScenes(answer, { n, dur, model }));
    }
    if (req.piece) { target = campaignTarget(c.state, req.piece, req.slide); if (!target) return json(400, { error: 'bad_request', field: 'piece' }); }
    else target = campaignTarget({ ...(isObj(c.state) ? c.state : {}), pieces: [{ id: 'P0', kind: 'بوست', n: 0 }] }, 'P0', null);
  }
  const cfg = await configOf(deps, 'marketing');
  const base = { created_by: uid, action: 'marketing', source: req.task === 'describe' ? 'template' : req.campaignId ? 'campaign' : 'post', label: line(target && req.piece ? target.label : req.task, 200) };
  return await runAi(deps, base, cfg, marketingRequest(req, { model: cfg.model, effort: cfg.effort, target }), (answer) => cleanMarketing(answer, req, target));
}

// ---------------------------------------------------------------- the media buyer's chat (phase 9.5.4, decision 53)

// the last 7 days per campaign (Meta's numbers beside the orders that carry the campaign's UTM), the open suggestions and the rules —
// read here, never from the body; the answer is text only: nothing is executed from the chat
async function buyer(deps: Deps, uid: string, args: Json) {
  const parsed = parseBuyer(args);
  if ('error' in parsed) return json(400, parsed);
  const at = deps.now(); const today = cairoParts(Date.parse(at)).day; const since = windowOf(Date.parse(at), SUGGEST_DAYS).since;
  const [{ data: objects }, { data: stats }, { data: orders }, { data: sugg }, { data: set }] = await Promise.all([
    deps.db.from('mkt_ad_objects').select('id, name, status, meta').eq('platform', 'meta').eq('kind', 'campaign').limit(2000),
    deps.db.from('mkt_ad_stats').select('object_id, spend, purchases').eq('platform', 'meta').eq('level', 'campaign').gte('day', since).limit(20000),
    deps.db.from('orders').select('utm_campaign, status, total, deleted_at').eq('ad_platform', 'meta').gte('placed_at', since + 'T00:00:00+02:00').limit(5000),
    deps.db.from('mkt_suggestions').select('kind, title, sub').eq('status', 'pending').limit(50),
    deps.db.from('settings').select('data').eq('section', 'marketing').maybeSingle(),
  ]);
  const camps: Record<string, Json> = {};
  for (const o of Array.isArray(objects) ? objects : []) camps[o.id] = { name: o.name || '#' + o.id, status: o.status, spend: 0, purchases: 0, orders: 0, sales: 0, daily_budget: isObj(o.meta) ? o.meta.daily_budget ?? null : null };
  for (const s of Array.isArray(stats) ? stats : []) { const c = camps[s.object_id]; if (c) { c.spend += Number(s.spend) || 0; c.purchases += Number(s.purchases) || 0; } }
  for (const o of Array.isArray(orders) ? orders : []) {
    const c = camps[o.utm_campaign]; if (!c || o.deleted_at || ['ملغي', 'استرجاع', 'فشل'].includes(String(o.status))) continue;
    c.orders += 1; c.sales += Number(o.total) || 0;
  }
  const campaigns = Object.values(camps).filter((c) => c.spend > 0 || c.orders > 0 || c.status === 'ACTIVE').sort((a, b) => b.spend - a.spend);
  const rules = buyerRules(isObj(set) && isObj(set.data) ? set.data.buyer : null);
  const cfg = await configOf(deps, 'buyer');
  const base = { created_by: uid, action: 'marketing', source: 'buyer', label: line(parsed.req.question, 200) };
  return await runAi(deps, base, cfg, buyerRequest(parsed.req, { model: cfg.model, effort: cfg.effort, data: { today, rules, campaigns, suggestions: Array.isArray(sugg) ? sugg : [] } }), cleanBuyer);
}

// ---------------------------------------------------------------- the header's assistant (phase 12 T1, decision 8)

type DQ = ReturnType<typeof dataQuery> & { kind: string; q: string; status: string; from: string; to: string; limit: number; all: boolean };
const ORDER_COLS = 'id, number, customer_name, customer_city, status, confirm, deposit, total, placed_at';
const FORBIDDEN = { forbidden: true };
// One get_data read with the member's client: a refused table or RPC (RLS, has_perm) is { forbidden: true } for the model, never a throw.
async function readData(member: Db, uid: string, dq: DQ, today: string): Promise<Json> {
  const rows = async (q: Promise<{ data: unknown; error: unknown }>) => { const { data, error } = await q; return error ? null : (Array.isArray(data) ? data : []); };
  const orders = async () => { const r = await rows(member.from('orders_v').select(ORDER_COLS).gte('placed_at', dq.from + 'T00:00:00+02:00').order('placed_at', { ascending: false }).limit(2000)); return r ? ordersData(r, dq, today) : FORBIDDEN; };
  const tickets = async () => { const r = await rows(member.from('tickets').select('id, type, title, priority, assignee_role, status, order_number, vendor, customer, reason, follow_up, created_at, last_update').order('last_update', { ascending: false }).limit(500)); return r ? ticketsData(r, dq) : FORBIDDEN; };
  const tasks = async () => { const r = await rows(member.from('hr_tasks').select('id, member_id, title, status, day, until, deleted_at').is('deleted_at', null).limit(500)); return r ? tasksData(r, dq, uid) : FORBIDDEN; };
  const expenses = async () => { const r = await rows(member.from('acc_expenses').select('id, on_date, direction, category, beneficiary, amount, sub_name, voided_at').is('voided_at', null).gte('on_date', dq.from).limit(2000)); return r ? expensesData(r, dq) : FORBIDDEN; };
  const sales = async () => {
    const r = await rows(member.rpc('accounts_sales', { p_from: dq.from, p_to: dq.to })); if (!r) return FORBIDDEN;
    const ids = [...new Set(r.map((x: Json) => x.vendor_id).filter(Boolean))].slice(0, 200);
    const vs = ids.length ? await rows(member.from('vendors').select('id, name').in('id', ids)) : [];
    return salesData(r, Object.fromEntries((vs ?? []).map((v: Json) => [v.id, v.name])), dq);
  };
  switch (dq.kind) {
    case 'orders': return await orders();
    case 'vendors': { const r = await rows(member.from('vendors').select('id, name, status, category, lead_days, joined_at').limit(1000)); return r ? vendorsData(r, dq) : FORBIDDEN; }
    case 'customers': { const r = await rows(member.rpc('cs_customers_list')); return r ? customersData(r, dq) : FORBIDDEN; }
    case 'tickets': return await tickets();
    case 'tasks': return await tasks();
    case 'expenses': return await expenses();
    case 'sales': return await sales();
    default: {
      const conv = await rows(member.from('cs_conversations').select('id, status').neq('status', 'اتحلت').limit(2000));
      const [o, t, k, e, s] = await Promise.all([orders(), tickets(), tasks(), expenses(), sales()]);
      return summaryData({ orders: o, tickets: t, tasks: k, expenses: e, sales: s, conversations: conv ? { open: conv.length } : FORBIDDEN }, dq);
    }
  }
}

async function assistant(deps: Deps, uid: string, args: Json, jwt: string) {
  const parsed = parseAssistant(args);
  if ('error' in parsed) return json(400, parsed);
  const req = parsed.req;
  if (!deps.userDb) return json(401, { error: 'unauthorized' });
  const member = deps.userDb(jwt);
  const today = cairoParts(Date.parse(deps.now())).day;
  const { data: me } = await member.from('profiles').select('name, role_id, status').eq('id', uid).maybeSingle();
  if (!isObj(me) || me.status !== 'active') return json(401, { error: 'unauthorized' }); // a stopped member (or one 2FA still gates) sees no profile
  const actor = String(me.name ?? ''); const roleRow = me.role_id ? (await member.from('roles').select('name').eq('id', me.role_id).maybeSingle()).data : null;
  const role = isObj(roleRow) ? String(roleRow.name ?? '') : '';
  const cfg = await configOf(deps, 'assistant');
  const base = { created_by: uid, action: 'assistant', source: req.mode, label: line(req.question, 200) };
  // the reservation covers the whole loop (security review: one turn is up to MAX_TOOL_CALLS + 2 Claude calls), and the loop stops
  // on the cap once the calls made have spent it
  const reserve = req.mode === 'filter' ? RESERVE_USD : RESERVE_USD * (MAX_TOOL_CALLS + 2);
  const run = await startRun(deps, { ...base, model: cfg.model }, cfg.cap, reserve);
  if (run.result === 'busy') return json(429, { error: 'busy' });
  if (run.result === 'cap') return json(402, { error: 'ai_cap' });
  if (run.result !== 'ok') return json(502, { error: 'ai_error' });
  if (!deps.env.ANTHROPIC_API_KEY?.trim()) { await finishRun(deps, run.id, { status: 'error', error: 'not_configured', cost_usd: 0 }); return json(503, { error: 'not_configured', provider: 'claude' }); }
  const params = assistantRequest(req, { model: cfg.model, effort: cfg.effort, today, actor, role });
  const spent = { model: cfg.model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };
  const actions: Json[] = []; const tools: string[] = []; let text = ''; let reads = 0; const got: Json[] = []; // got: the reads for the «تفاصيل» report (decision 23)
  const typedAmounts = amountsIn(req.question); // propose_entry only for an amount the member typed (never one read from data)
  for (let step = 0; step <= MAX_TOOL_CALLS + 1; step++) {
    if (step > 0 && spent.cost_usd >= reserve) { await finishRun(deps, run.id, { ...spent, status: 'cap', error: 'ai_cap' }); return json(402, { error: 'ai_cap' }); }
    const asked = await ask(deps, params, 'claude');
    if ('error' in asked) {
      await finishRun(deps, run.id, { ...spent, status: 'error', error: asked.error, cost_usd: spent.cost_usd + (asked.status === null ? RESERVE_USD : 0) });
      return json(asked.error === 'not_configured' ? 503 : asked.error === 'busy' ? 429 : 502, { error: asked.error });
    }
    const msg = asked.msg; const u = usageOf(msg.usage);
    spent.model = modelId(msg.model) ?? cfg.model; spent.input_tokens += u.input; spent.output_tokens += u.output; spent.cache_read_tokens += u.cacheRead; spent.cache_write_tokens += u.cacheWrite;
    spent.cost_usd = Math.round((spent.cost_usd + costOf(spent.model, msg.usage)) * 1e6) / 1e6;
    const turn = readTurn(msg);
    if (turn.stop === 'refused') { await finishRun(deps, run.id, { ...spent, status: 'refused', error: 'refused' }); return json(200, { result: 'refused', model: spent.model, cost_usd: spent.cost_usd }); }
    if (turn.stop === 'error') { await finishRun(deps, run.id, { ...spent, status: 'error', error: 'ai_error' }); return json(502, { error: 'ai_error' }); }
    if (turn.text) text = turn.text;
    if (turn.stop === 'end') break;
    const results: Json[] = [];
    for (const use of turn.uses) {
      if (use.name === 'get_data') {
        if (reads >= MAX_TOOL_CALLS) { results.push({ id: use.id, content: 'limit: no more data reads this turn — answer with what you have', error: true }); continue; }
        const dq = dataQuery(use.input, { today, period: req.context.period });
        if ('error' in dq) { results.push({ id: use.id, content: dq.error, error: true }); continue; }
        reads++; tools.push(dq.kind);
        const data = await readData(member, uid, dq as DQ, today); got.push({ kind: dq.kind, data });
        results.push({ id: use.id, content: data });
      } else {
        const act = cleanAction(use.name, use.input);
        if (act && use.name === 'propose_entry' && !typedAmounts.includes(Number((act.input as Json).amount))) { results.push({ id: use.id, content: 'refused: the amount is not in the user\'s own message — ask them for it', error: true }); continue; }
        if (act) { actions.push(act); results.push({ id: use.id, content: use.name === 'propose_entry' ? 'the confirm card will be shown to the user after your answer — not recorded yet' : 'will run on the user\'s screen after your answer' }); }
        else results.push({ id: use.id, content: 'invalid input for ' + line(use.name, 40), error: true });
      }
    }
    params.messages = [...params.messages, assistantMessage(msg), toolResults(results)];
    if (req.mode === 'filter') break; // one tool call is the whole answer
    if (step === MAX_TOOL_CALLS + 1 && !text) text = 'وصلت لحد القراءات في الرد ده — اسألني تاني بسؤال أضيق.';
  }
  const out = cleanAnswer(text, actions, tools);
  await finishRun(deps, run.id, { ...spent, status: 'ok', output: out }); // the report is not stored — the page only
  return json(200, { result: 'ok', ...out, report: reportOf(got), model: spent.model, cost_usd: spent.cost_usd, run_id: run.id });
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
    return action === 'write' ? await write(deps, uid, args) : action === 'prompts' ? await prompts(deps, uid, args) : action === 'marketing' ? await marketing(deps, uid, args) : action === 'buyer' ? await buyer(deps, uid, args)
      : action === 'assistant' ? await assistant(deps, uid, args, jwtOf(req)) : await studio(deps, uid, args);
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
async function realDeps(): Promise<Deps> {
  const raw = Deno.env.toObject();
  service ??= createClient(raw.SUPABASE_URL ?? '', raw.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  const env = await vaultEnv(service, raw); // the keys written from the settings page win over the Supabase secrets (0056)
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
    text: (provider, params) => completeText(provider, env, params, globalThis.fetch),
    claude: async (params) => {
      const key = (env.ANTHROPIC_API_KEY ?? '').trim();
      if (!anthropic || anthropicKey !== key) { anthropic = new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 0 }); anthropicKey = key; }
      // deno-lint-ignore no-explicit-any
      return await anthropic.beta.messages.create(params as any) as unknown as Json;
    },
  };
}

// Serve only as the entry point (the Supabase Edge Runtime defines EdgeRuntime); importing the module (tests) does not.
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await realDeps()));
