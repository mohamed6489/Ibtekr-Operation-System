// Product images with the AI (phase 5.4, docs/superpowers/plans/2026-10-31-phase-5-4-images.md) — the pure part shared by the
// ai-images Edge Function (Deno), its tests and the browser mock (node): the request checks (what a page may ask: a studio slot,
// an edit, the images tool), the prompts (built here from the product's data and the slot's role — never from free HTML), the
// sizes, the models and their credits, the paths in the buckets, and the image settings of the settings row «ai» over the secrets.
// Nothing here talks to a provider or a database.

export const PROVIDER = 'magnific';
// The models offered (plan decision 4, pinned in T2 on 31 Oct against docs.magnific.com): the id is ours, the provider's route is in
// providers/magnific.ts (ROUTES); credits = about one image at the product size from the provider's price list — the API's answers
// carry no credit figure, so these estimates are what the rows record. Nano Banana Pro waits: its reference-image shape is not
// confirmed yet.
export const IMG_MODELS = Object.freeze([
  { id: 'seedream-5-pro', name: 'Seedream 5 Pro', credits: 75, def: true, note: 'الافتراضي — منتجات وتعديل بالمرجعية (2K)' },
  { id: 'seedream-5-lite', name: 'Seedream 5 Lite', credits: 50, note: 'أرخص وأسرع — نفس الطريقة' },
  { id: 'gemini-2-5-flash', name: 'Google Gemini 2.5 Flash (Nano Banana)', credits: 20, note: 'سريع ورخيص — للتجارب والتعديلات البسيطة' },
  { id: 'gpt-image-2', name: 'GPT Image 2', credits: 60, note: 'بوستات فيها كلام وتصميمات' },
]);
export const MODEL_IDS = IMG_MODELS.map((m) => m.id);
export const DEFAULT_MODEL = IMG_MODELS.find((m) => m.def).id;
export const modelOf = (id) => IMG_MODELS.find((m) => m.id === id) || null;
export const modelCredits = (id) => (modelOf(id) || modelOf(DEFAULT_MODEL)).credits;
export const creditsFor = (id, count) => modelCredits(id) * (Number.isInteger(count) && count > 0 ? count : 1);
// a USD estimate of a credit for the shared ai_runs.cost_usd view (Premium+ ≈ $0.002 a credit); the cap counts credits
export const CREDIT_USD = 0.002;
export const usdOf = (credits) => Math.round((Number(credits) || 0) * CREDIT_USD * 1e6) / 1e6;

// The studio's slots (the page's PD.SLOTS, same order) and the images tool's shapes
export const SLOTS = ['closeup', 'environment', 'feature', 'sizes', 'extra1', 'extra2'];
export const SHAPES = ['studio', 'home', 'detail', 'hand', 'custom'];
export const EDIT_OPS = ['instruction', 'remove_bg', 'upscale', 'relight'];
export const SOURCES = ['text', 'image'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_B64 = 2_000_000;
export const MAX_COUNT = 4;
export const MAX_PROMPT = 500;
// the sizes a page may ask by id (the product size first; the social ones for the tool) and the custom bounds
export const IMG_SIZES = Object.freeze({
  '700x800': [700, 800], '1080x1350': [1080, 1350], '1080x1080': [1080, 1080], '1080x1920': [1080, 1920], '1200x630': [1200, 630],
  '1640x624': [1640, 624], '1080x1920t': [1080, 1920], '1000x1500': [1000, 1500], '1600x900': [1600, 900], '1200x627': [1200, 627], '1280x720': [1280, 720],
});
export const PRODUCT_SIZE = '700x800';
export const CUSTOM_MIN = 256, CUSTOM_MAX = 4096, MAX_RATIO = 4;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^[A-Z]{2}$/;
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const bad = (field) => ({ error: 'bad_request', field });

/** One line of plain text for a prompt: tags, `<` `>` and control characters out, spaces collapsed, at most `max`. */
export function line(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/<[^>]*>/g, ' ').replace(/\p{Cc}/gu, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '');
}

/** A size id, or a custom width × height (256–4096 px a side, at most 4:1) → { w, h, id } | null. */
export function sizeOf(size, cw, ch) {
  if (typeof size === 'string' && IMG_SIZES[size]) { const [w, h] = IMG_SIZES[size]; return { w, h, id: size }; }
  if (size !== 'custom') return null;
  const n = (v) => { const x = Number(String(v == null ? '' : v).trim()); return Number.isInteger(x) ? x : NaN; };
  const w = n(cw), h = n(ch);
  if (!(w >= CUSTOM_MIN && w <= CUSTOM_MAX && h >= CUSTOM_MIN && h <= CUSTOM_MAX)) return null;
  if (Math.max(w, h) / Math.min(w, h) > MAX_RATIO) return null;
  return { w, h, id: 'custom' };
}
const modelArg = (v) => (v == null || v === '' ? DEFAULT_MODEL : MODEL_IDS.includes(v) ? v : null);
const imageArg = (v) => {
  if (v == null) return null;
  if (!isObj(v) || !IMAGE_TYPES.includes(v.media_type) || typeof v.data !== 'string') return undefined;
  if (v.data.length < 100 || v.data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/]+=*$/.test(v.data)) return undefined;
  return { media_type: v.media_type, data: v.data };
};

/** generate { batch_id, index, slot: 0..5 | 'color:XX', model?, size? } → { req } | { error, field }. */
export function parseGenerate(b) {
  if (!isObj(b)) return bad('body');
  if (typeof b.batch_id !== 'string' || !UUID.test(b.batch_id)) return bad('batch_id');
  if (!Number.isInteger(b.index) || b.index < 0 || b.index > 999) return bad('index');
  let slot;
  if (Number.isInteger(b.slot) && b.slot >= 0 && b.slot < SLOTS.length) slot = b.slot;
  else if (typeof b.slot === 'string' && /^color:[A-Z]{2}$/.test(b.slot)) slot = { color: b.slot.slice(6) };
  else return bad('slot');
  const model = modelArg(b.model); if (!model) return bad('model');
  const size = sizeOf(b.size == null ? PRODUCT_SIZE : b.size, b.width, b.height); if (!size) return bad('size');
  return { req: { batchId: b.batch_id.toLowerCase(), index: b.index, slot, model, size } };
}

/** edit { batch_id?, path | product_id, op, prompt?, model?, options? } → { req } | { error, field }. */
export function parseEdit(b) {
  if (!isObj(b)) return bad('body');
  if (!EDIT_OPS.includes(b.op)) return bad('op');
  const batchId = b.batch_id == null ? null : typeof b.batch_id === 'string' && UUID.test(b.batch_id) ? b.batch_id.toLowerCase() : undefined;
  if (batchId === undefined) return bad('batch_id');
  const path = b.path == null ? null : typeof b.path === 'string' && b.path.length <= 200 ? b.path : undefined;
  if (path === undefined) return bad('path');
  const productId = b.product_id == null ? null : posInt(b.product_id);
  if (b.product_id != null && productId === null) return bad('product_id');
  if (!path && !productId) return bad('path');
  if (path && !batchId && !/^[0-9a-f-]{36}\//i.test(path)) return bad('batch_id'); // a studio path needs its batch
  const prompt = line(b.prompt, MAX_PROMPT);
  if (b.op === 'instruction' && !prompt) return bad('prompt');
  const model = modelArg(b.model); if (!model) return bad('model');
  const o = isObj(b.options) ? b.options : {};
  const options = {};
  if (b.op === 'remove_bg') { const bg = typeof o.bg === 'string' ? o.bg.trim() : 'transparent'; if (!(bg === 'transparent' || bg === 'white' || /^#[0-9a-f]{6}$/i.test(bg))) return bad('options.bg'); options.bg = bg.toLowerCase(); }
  if (b.op === 'upscale') { const s = o.scale == null ? 2 : o.scale; if (!(s === 2 || s === 4)) return bad('options.scale'); options.scale = s; }
  return { req: { batchId, path, productId, op: b.op, prompt, model, options } };
}

/** create { source: text | image, prompt?, shape, size, width?, height?, count, model?, image?, product_id? } → { req } | { error, field }. */
export function parseCreate(b) {
  if (!isObj(b)) return bad('body');
  if (!SOURCES.includes(b.source)) return bad('source');
  if (!SHAPES.includes(b.shape)) return bad('shape');
  const prompt = line(b.prompt, MAX_PROMPT);
  if ((b.shape === 'custom' || b.source === 'text') && !prompt) return bad('prompt');
  const size = sizeOf(b.size == null ? PRODUCT_SIZE : b.size, b.width, b.height); if (!size) return bad('size');
  const count = b.count == null ? 1 : b.count;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return bad('count');
  const model = modelArg(b.model); if (!model) return bad('model');
  const image = imageArg(b.image); if (image === undefined) return bad('image');
  const productId = b.product_id == null ? null : posInt(b.product_id);
  if (b.product_id != null && productId === null) return bad('product_id');
  if (b.source === 'image' && !image && !productId) return bad('image');
  return { req: { source: b.source, prompt, shape: b.shape, size, count, model, image, productId } };
}

// ---------------------------------------------------------------- prompts (English; the provider reads English best)

const BASE = 'Professional e-commerce product photography, photorealistic, sharp focus, true colors, no text, no watermark, no logo.';
const subjectOf = (it, ctx) => {
  const parts = [line(it.nameEn, 120), ctx && ctx.colorName ? 'in ' + line(ctx.colorName, 40) : '', it.material ? 'made of ' + line(it.material, 60) : '', it.style ? line(it.style, 40) + ' style' : ''].filter(Boolean);
  const brand = ctx && ctx.brand ? ' by the handmade brand ' + line(ctx.brand, 60) : '';
  return (parts.join(', ') || 'the handmade product') + brand;
};
/**
 * The prompt of a studio slot (plan decision 2): the reference photo carries the product itself; the words set the scene of the
 * slot — 0 close-up on a clean studio background (the site image), 1 the product in its place, 2 a detail of the craft,
 * 3 the product with its dimensions in view, extras = more angles. A color slot = the close-up in that color.
 */
export function slotPrompt(item, slot, ctx = {}) {
  const it = isObj(item) ? item : {};
  const subject = subjectOf(it, ctx);
  const sizes = Array.isArray(it.sizes) ? it.sizes.map((s) => line(String(s), 30)).filter(Boolean).join(', ') : '';
  const k = isObj(slot) ? 'color' : SLOTS[slot] || 'extra1';
  const scene = k === 'closeup' || k === 'color' ? 'Keep the exact same product from the reference photo, centered, on a clean warm cream studio background, soft natural window light, gentle shadow, portrait framing.'
    : k === 'environment' ? 'Show the exact same product from the reference photo in its natural place in a warm, modern Egyptian home interior, styled lifestyle scene, afternoon daylight, nothing covering the product.'
    : k === 'feature' ? 'A close detail shot of the exact same product from the reference photo: the material, the handmade craft and texture, shallow depth of field.'
    : k === 'sizes' ? 'The exact same product from the reference photo, full view on a plain light background, framed to show its proportions' + (sizes ? ' (' + sizes + ')' : '') + ', space around it for dimension lines.'
    : 'Another angle of the exact same product from the reference photo on a clean warm cream studio background, soft light.';
  return [BASE, subject + '.', scene].join(' ');
}
/** The images tool's prompt from its shape: a scene around the product (from its photo or its name) or the user's own words. */
export function shapePrompt(shape, subject, extra) {
  const s = line(subject, 160) || 'the handmade product';
  const more = line(extra, MAX_PROMPT);
  if (shape === 'custom') return [BASE, more].join(' ');
  const scene = shape === 'studio' ? `${s} centered on a clean warm cream studio background, soft natural window light, gentle shadow.`
    : shape === 'home' ? `${s} in its place in a warm modern Egyptian home, lifestyle scene, afternoon daylight, plants in the background.`
    : shape === 'detail' ? `A close detail shot of ${s}: the material, the handmade craft and texture, shallow depth of field.`
    : `${s} held or touched by an artisan's hands, a handmade workshop feel, warm light.`;
  return [BASE, scene, more].filter(Boolean).join(' ');
}
/** An edit's instruction for the provider (remove_bg / upscale / relight have their own routes; `instruction` is free text). */
export function editPrompt(op, prompt, options = {}) {
  if (op === 'instruction') return 'Edit the reference photo as instructed, keeping the product itself unchanged: ' + line(prompt, MAX_PROMPT);
  if (op === 'remove_bg') return options.bg === 'transparent' ? 'Cut the product out on a transparent background.' : 'Place the product on a plain ' + (options.bg === 'white' ? 'white' : options.bg) + ' background with a soft shadow.';
  if (op === 'relight') return 'Relight the product photo with soft warm natural light' + (line(prompt, 200) ? ': ' + line(prompt, 200) : '.');
  return 'Upscale the product photo ' + (options.scale || 2) + '× with more detail.';
}

// ---------------------------------------------------------------- paths

const SAFE = /^[A-Za-z0-9._-]{1,120}$/;
/** A studio image path belongs to its batch and is a plain file name with an image extension. */
export const studioPathOk = (batchId, path) => typeof path === 'string' && new RegExp('^' + batchId + '/[A-Za-z0-9._-]{1,120}\\.(webp|png|jpe?g)$', 'i').test(path);
/** Where a generated slot image goes in bucket studio: <batch>/gen-<item>-<slot>-<stamp>.<ext>. */
export const studioGenPath = (batchId, index, slot, stamp, ext) => `${batchId}/gen-${index}-${isObj(slot) ? 'c' + slot.color : slot}-${stamp}.${ext}`;
/** Where an edit of a studio image goes: <batch>/edit-<item>-<stamp>.<ext>. */
export const studioEditPath = (batchId, index, stamp, ext) => `${batchId}/edit-${index}-${stamp}.${ext}`;
/** Where the images tool's results go in bucket ai-images: <uid>/<stamp>-<n>.<ext>. */
export const toolPath = (uid, stamp, n, ext) => `${uid}/${stamp}-${n}.${ext}`;
export const extOf = (mime) => (mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp');
export const safeName = (s) => (SAFE.test(String(s || '')) ? String(s) : null);

// ---------------------------------------------------------------- settings

/**
 * The image settings of the settings row «ai» (data { image_model, image_monthly_credits }, the admin changes it — plan
 * decision 3) over the secrets MAGNIFIC_MODEL / IMAGE_MONTHLY_CREDITS, else the defaults: the default model and no cap.
 */
export function imageSettings(row, env = {}) {
  const d = isObj(row) ? row : {}; const e = isObj(env) ? env : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);
  return {
    model: MODEL_IDS.includes(str(d.image_model)) ? str(d.image_model) : MODEL_IDS.includes(str(e.MAGNIFIC_MODEL)) ? str(e.MAGNIFIC_MODEL) : DEFAULT_MODEL,
    monthlyCredits: num(d.image_monthly_credits) ?? num(e.IMAGE_MONTHLY_CREDITS),
  };
}
