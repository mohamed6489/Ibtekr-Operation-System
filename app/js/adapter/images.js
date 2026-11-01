// Product images with the AI (phase 5.4, docs/superpowers/plans/2026-10-31-phase-5-4-images.md): the ai-images Edge Function
// (Magnific — the server checks products.add / products.edit, the key, the member's throttle and the images' monthly credit cap,
// and stores every result in a bucket: the studio's under its batch in `studio`, the tool's under the member in `ai-images`),
// the buckets' signed URLs / downloads / deletes, the member's image runs in ai_runs («سجل الصور»), and the image settings of the
// settings row «ai» (decision 3: image_model / image_monthly_credits — read by every member of the tool, written by the admin,
// merged into the row so the content settings of 5.3 stay). Nothing here writes the site: the studio saves its batch through
// IBStudio.save, the tool uploads to a product through IBProducts (woo-sync product_images_add, T8). Every result is re-encoded here
// as WebP (decision 7: a canvas, quality 0.85) and handed back to the server (action webp — the same name with .webp, the original
// removed); a browser that cannot write WebP keeps the result as the provider made it. Every call returns a Promise
// of { ok, … } and never throws; reason 'forbidden' / 'invalid' (+ field) / 'missing' / 'not_configured' / 'ai_cap' / 'busy' /
// 'ai_error' / 'network'. Each answer is logged through IBActivity.log as product.ai.image (the source, the slot or op, the model,
// the credits and the ids — never a prompt, a path or an image).
(function () {
  'use strict';
  const FN = 'ai-images';
  const STUDIO_BUCKET = 'studio', TOOL_BUCKET = 'ai-images';
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:images', { detail: detail || {} })));
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const isAdmin = () => { const D = window.IBDirectory; const me = D && D.me && D.me(); return !!me && me.role_id === 'admin' && me.status === 'active'; };
  const myId = () => { const D = window.IBDirectory; const me = D && D.me && D.me(); return me && me.id ? String(me.id) : null; };
  // the server's rule: a studio slot or a studio edit needs products.add = F, a site product's edit products.edit = F, the tool either;
  // the settings the admin
  const can = () => ({ studio: perm('products.add') === 'F', edit: perm('products.edit') === 'F', tool: perm('products.add') === 'F' || perm('products.edit') === 'F', settings: isAdmin() });

  // the models (the server's IMG_MODELS in _shared/ai-images.js — the id is the provider's slug, credits = one image), the sizes and
  // the shapes, for the pages' selects and confirmations
  const MODELS = [
    { id: 'seedream-5-pro', name: 'Seedream 5 Pro', credits: 75, def: true, note: 'الافتراضي — منتجات وتعديل بالمرجعية (2K)' },
    { id: 'seedream-5-lite', name: 'Seedream 5 Lite', credits: 50, note: 'أرخص وأسرع — نفس الطريقة' },
    { id: 'gemini-2-5-flash', name: 'Google Gemini 2.5 Flash (Nano Banana)', credits: 20, note: 'سريع ورخيص — للتجارب والتعديلات البسيطة' },
    { id: 'gpt-image-2', name: 'GPT Image 2', credits: 60, note: 'بوستات فيها كلام وتصميمات' },
  ];
  const DEFAULT_MODEL = MODELS.find((m) => m.def).id;
  const SIZES = [
    { id: '700x800', label: 'صورة منتج 700×800' }, { id: '1080x1350', label: 'بوست 4:5 — 1080×1350' }, { id: '1080x1080', label: 'مربع 1080×1080' },
    { id: '1080x1920', label: 'ستوري 9:16 — 1080×1920' }, { id: '1200x630', label: 'لينك مشاركة 1200×630' }, { id: '1640x624', label: 'غلاف فيسبوك 1640×624' },
    { id: '1080x1920t', label: 'تيك توك 1080×1920' }, { id: '1000x1500', label: 'بنترست 1000×1500' }, { id: '1600x900', label: 'بانر 16:9 — 1600×900' },
    { id: '1200x627', label: 'لينكدإن 1200×627' }, { id: '1280x720', label: 'يوتيوب 1280×720' }, { id: 'custom', label: 'مقاس مخصص' },
  ];
  const SHAPES = [{ id: 'studio', label: 'استوديو' }, { id: 'home', label: 'في البيت' }, { id: 'detail', label: 'تفاصيل' }, { id: 'hand', label: 'إيد الصانع' }, { id: 'custom', label: 'مخصص' }];
  const EDIT_OPS = [{ id: 'instruction', label: 'عدّل بالوصف' }, { id: 'remove_bg', label: 'شيل الخلفية' }, { id: 'upscale', label: 'حسّن وكبّر' }, { id: 'relight', label: 'إضاءة تانية' }];
  const CREDIT_USD = 0.002;
  const MAX_COUNT = 4;
  const WEBP_QUALITY = 0.85; // decision 7: every result ends as WebP, re-encoded here (the browser) — the server's CPU budget is too small
  const MAX_WEBP_B64 = 14000000; // the server's MAX_WEBP_B64
  const MAX_IMAGE_B64 = 2000000; // the server's MAX_IMAGE_B64
  const MAX_PHOTO = 1600; // the reference photo of the tool at most this on the longest side
  const modelOf = (id) => MODELS.find((m) => m.id === id) || null;
  const credits = (model, count) => (modelOf(model) || modelOf(DEFAULT_MODEL)).credits * (Number.isInteger(count) && count > 0 ? count : 1);
  const usd = (n) => Math.round((Number(n) || 0) * CREDIT_USD * 1000) / 1000;
  let last = null; // the last settings read

  async function invoke(body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.functions.invoke(FN, { body });
      if (error || !data) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        // decision 11: the bridge's 503 not_linked (no Magnific account linked) and its 400 refused (the sign-in code refused) are told apart from the others
        const reason = b && b.error === 'not_linked' ? 'not_linked' : b && b.error === 'refused' ? 'refused' : s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'missing' : s === 402 ? 'ai_cap' : s === 409 ? 'done' : s === 429 ? 'busy' : s === 503 ? 'not_configured' : s === 502 ? 'ai_error' : 'network';
        return { ok: false, reason, field: b && b.field ? String(b.field) : null, status: b && Number.isInteger(b.status) ? b.status : null, configured: b && typeof b.configured === 'boolean' ? b.configured : null };
      }
      return { ok: true, body: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the words of a refusal for the pages (not_configured told apart: the secret missing on the server / the provider refusing the key)
  const why = (r) => {
    if (!r || r.ok) return '';
    if (r.reason === 'not_configured') return r.configured === false ? 'الـ AI للصور لسه مش متوصّل — السر MAGNIFIC_API_KEY مش موجود في أسرار السيرفر (Supabase › Edge Functions › Secrets)' : 'Magnific رفض المفتاح' + (r.status ? ' (HTTP ' + r.status + ')' : '') + ' — المفتاح نفسه أو شكل الـ API محتاج يتظبط';
    if (r.reason === 'ai_error' && r.status === 402) return 'رصيد كريدت Magnific API خلص أو الموديل ده مش متاح في الباقة (HTTP 402) — اشحن الرصيد من لوحة Magnific API أو جرّب موديل تاني';
    if (r.reason === 'not_linked') return 'حساب Magnific مش مربوط بالسيستم — الأدمن بيربطه من «إعدادات الصور»';
    return '';
  };
  const log = (detail, entity, id) => quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log('product.ai.image', detail, { entity, entity_id: id == null ? null : String(id) }));
  const answer = (b) => ({ ok: true, result: b.result === 'refused' ? 'refused' : 'ok', bucket: typeof b.bucket === 'string' ? b.bucket : null, path: typeof b.path === 'string' ? b.path : null,
    paths: Array.isArray(b.paths) ? b.paths.filter((p) => typeof p === 'string') : (typeof b.path === 'string' ? [b.path] : []), credits: Number(b.credits) || 0, model: typeof b.model === 'string' ? b.model : '', runId: b.run_id || null });
  const slotArg = (slot) => (slot && typeof slot === 'object' && slot.color ? 'color:' + String(slot.color).toUpperCase() : Number(slot));
  const slotWord = (slot) => (slot && typeof slot === 'object' && slot.color ? 'color ' + String(slot.color).toUpperCase() : 'slot ' + (Number(slot) + 1));
  const sizeArgs = (opts) => { const o = opts || {}; const out = {}; if (o.size) out.size = o.size; if (o.size === 'custom') { out.width = Number(o.width); out.height = Number(o.height); } return out; };
  const tail = (r) => (r.result === 'refused' ? ['refused'] : [r.credits + ' credits']);

  // ---------- WebP (decision 7) ----------
  // the browser can re-encode: a canvas and an Image (not in node), and the canvas writes WebP (Safari writes PNG instead → the
  // result stays as the provider made it)
  const canWebp = () => typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof Image === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  // a result's bytes → a WebP Blob (quality WEBP_QUALITY), or null when the browser cannot
  function toWebp(blob) {
    return new Promise((resolve) => {
      const url = quiet(() => URL.createObjectURL(blob)); if (!url) return resolve(null);
      const done = (v) => { quiet(() => URL.revokeObjectURL(url)); resolve(v); };
      const im = new Image();
      im.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = im.naturalWidth || im.width; cv.height = im.naturalHeight || im.height;
          if (!cv.width || !cv.height) return done(null);
          cv.getContext('2d').drawImage(im, 0, 0);
          cv.toBlob((out) => done(out && out.type === 'image/webp' ? out : null), 'image/webp', WEBP_QUALITY);
        } catch (e) { done(null); }
      };
      im.onerror = () => done(null);
      im.src = url;
    });
  }
  const base64Of = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  // one result → its WebP under the same name on the server (the original removed, the run row renamed) → { ok, path }; a path
  // already .webp stays; any failure leaves the original in place (the caller keeps the path it had)
  async function webp(bucket, path, runId) {
    if (!path || /\.webp$/i.test(path)) return { ok: true, path };
    if (!canWebp()) return { ok: false, reason: 'unsupported' };
    const d = await download(bucket, path); if (!d.ok) return d;
    const out = await toWebp(d.blob); if (!out) return { ok: false, reason: 'unsupported' };
    const data = await base64Of(out); if (data.length > MAX_WEBP_B64) return { ok: false, reason: 'invalid', field: 'image' };
    const r = await invoke({ action: 'webp', bucket, path, run_id: runId || undefined, image: { data } });
    if (!r.ok) return r;
    urls.delete(bucket + '/' + path);
    return { ok: true, path: typeof r.body.path === 'string' ? r.body.path : path };
  }
  // every path of an answer → WebP where it can be; the ones that cannot stay as they came
  async function webpAll(out) {
    if (!out.ok || out.result !== 'ok' || !out.paths.length) return out;
    const paths = out.paths.slice();
    for (let i = 0; i < paths.length; i++) { const r = await webp(out.bucket || TOOL_BUCKET, paths[i], out.runId); if (r.ok && r.path) paths[i] = r.path; }
    out.paths = paths; out.path = paths[0] || out.path;
    return out;
  }

  // the studio: one slot (0..5 or { color: 'BK' }) of a batch item (the server reads the saved batch, so it is saved first) → the
  // new image's path in bucket studio (the page puts it in the slot and saves)
  async function generate(batchId, index, slot, opts) {
    const o = opts || {};
    const r = await invoke(Object.assign({ action: 'generate', batch_id: batchId, index, slot: slotArg(slot), model: o.model || undefined }, sizeArgs(o)));
    if (!r.ok) return r;
    const out = await webpAll(answer(r.body));
    log(['studio', '#' + (index + 1), slotWord(slot), out.model].concat(tail(out)).join(' · '), 'studio_batches', batchId);
    return out;
  }
  // an edit: { batchId, index, path } (a studio image → next to its batch) or { productId } (the site product's photo → bucket
  // ai-images); op instruction (needs words) / remove_bg ({ bg }) / upscale ({ scale }) / relight
  async function edit(target, op, opts) {
    const t = target || {}; const o = opts || {};
    const body = { action: 'edit', op, prompt: o.prompt || undefined, model: o.model || undefined, options: o.options || undefined };
    if (t.path) { body.batch_id = t.batchId; body.index = t.index; body.path = t.path; } else body.product_id = Number(t.productId);
    const r = await invoke(body);
    if (!r.ok) return r;
    const out = await webpAll(answer(r.body));
    if (t.path) log(['edit', '#' + (Number(t.index) + 1), op, out.model].concat(tail(out)).join(' · '), 'studio_batches', t.batchId);
    else log(['edit', '#' + t.productId, op, out.model].concat(tail(out)).join(' · '), 'products', t.productId);
    return out;
  }
  // the images tool: { source: 'text' | 'image', prompt, shape, size, width, height, count, model, image?, productId? } → 1–4 paths
  // in bucket ai-images under the member
  async function create(req) {
    const q = req || {};
    const body = Object.assign({ action: 'create', source: q.source, shape: q.shape, prompt: q.prompt || undefined, count: q.count || 1, model: q.model || undefined }, sizeArgs(q));
    if (q.image) body.image = { media_type: q.image.media_type, data: q.image.data };
    if (q.productId) body.product_id = Number(q.productId);
    const r = await invoke(body);
    if (!r.ok) return r;
    const out = await webpAll(answer(r.body));
    log(['tool', q.source, q.shape, out.paths.length + ' images', out.model].concat(q.productId ? ['#' + q.productId] : [], tail(out)).join(' · '), 'products', q.productId || null);
    return out;
  }
  // ---------- decision 8: the Magnific import queue (image_imports — a Claude session queues sets made on the site) ----------
  // the member's queued sets (the admin's every member's) still to import: pending / partial / error, newest first
  async function imports() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('image_imports').select('id, created_at, created_by, source, folder, label, product_id, urls, status, paths, error, target, items, batch_type, batch_id')
        .in('status', ['pending', 'partial', 'error']).order('created_at', { ascending: false }).limit(50);
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      return { ok: true, rows: (data || []).map((x) => ({ id: x.id, at: x.created_at, by: x.created_by || null, source: x.source || 'magnific', folder: x.folder || '', label: x.label || '', productId: x.product_id || null,
        count: Array.isArray(x.urls) ? x.urls.length : 0, done: Array.isArray(x.paths) ? x.paths.filter((p) => typeof p === 'string').length : 0, status: x.status || 'pending', error: x.error || null,
        target: x.target === 'studio' || x.target === 'batch' ? x.target : 'tool', items: Array.isArray(x.items) ? x.items.length : 0, batchType: x.batch_type === 'Variable' ? 'Variable' : 'Simple', batchId: x.batch_id || null })) };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // one queued set → the server fetches its links (0 credits): target tool → the member's folder, WebP where the browser can,
  // like create's answer; target studio (decision 9) → a studio batch with the photos as they came (the studio's references stay
  // JPG / PNG for the provider) + batchId; both + imported / failed / status; reason 'done' when the set was imported before
  async function importRun(id) {
    const r = await invoke({ action: 'import', id: Number(id) });
    if (!r.ok) return r;
    const studio = r.body.target === 'studio' || r.body.target === 'batch'; // both keep the photos as they came (the studio's references)
    const out = studio ? answer(r.body) : await webpAll(answer(r.body));
    out.target = r.body.target === 'batch' ? 'batch' : studio ? 'studio' : 'tool'; out.batchId = studio && typeof r.body.batch_id === 'string' ? r.body.batch_id : null; out.items = Number(r.body.items) || 0; out.placed = Number(r.body.placed) || 0;
    out.imported = Number(r.body.imported) || 0; out.failed = Number(r.body.failed) || 0; out.status = typeof r.body.status === 'string' ? r.body.status : 'ok';
    log(['import', '#' + Number(id), out.target, out.imported + ' images'].concat(out.failed ? [out.failed + ' failed'] : [], out.target === 'studio' ? [out.items + ' items'] : out.target === 'batch' ? [out.placed + ' placed'] : []).join(' · '), studio ? 'studio_batches' : 'image_imports', studio ? out.batchId : id);
    return out;
  }
  // ---------- decision 10 (b): the batch's product photos to the Magnific site ----------
  // the server signs each product photo not shared yet (a week) into image_shares, for the bridge to upload to the site's project
  async function share(batchId, indexes) {
    const r = await invoke({ action: 'share', batch_id: batchId, indexes: Array.isArray(indexes) ? indexes : undefined });
    if (!r.ok) return r;
    const out = { ok: true, shared: Number(r.body.shared) || 0, skipped: Number(r.body.skipped) || 0 };
    log(['share', out.shared + ' photos', out.skipped + ' skipped'].join(' · '), 'studio_batches', batchId);
    return out;
  }
  // the batch's shares: each photo's state (pending = waiting for the bridge, sent = on the site)
  async function shares(batchId) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('image_shares').select('id, item_index, name, path, status, creation_ref, created_at, sent_at').eq('batch_id', batchId).order('created_at', { ascending: false }).limit(500);
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      const rows = (data || []).map((x) => ({ id: x.id, index: x.item_index, name: x.name || '', path: x.path || '', status: x.status || 'pending', ref: x.creation_ref || null, at: x.created_at, sentAt: x.sent_at || null }));
      return { ok: true, rows, pending: rows.filter((x) => x.status === 'pending').length, sent: rows.filter((x) => x.status === 'sent').length, failed: rows.filter((x) => x.status === 'error').length };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // ---------- decision 11: the bridge — the system as the Magnific site's MCP client (no Claude session) ----------
  // linked? (the admin also the account, configured = the OAuth client registered, redirect = the callback page's address)
  async function bridgeStatus() {
    const r = await invoke({ action: 'bridge_status' });
    if (!r.ok) return r;
    return { ok: true, linked: !!r.body.linked, account: typeof r.body.account === 'string' ? r.body.account : null, configured: r.body.configured !== false, redirect: typeof r.body.redirect === 'string' ? r.body.redirect : null, project: typeof r.body.project === 'string' ? r.body.project : null };
  }
  // the admin: the sign-in link (the page sends the browser there; Magnific comes back to app/magnific-callback.html)
  async function bridgeLink() {
    if (!can().settings) return { ok: false, reason: 'forbidden' };
    const r = await invoke({ action: 'bridge_link' });
    if (!r.ok) return r;
    const url = typeof r.body.url === 'string' && /^https:\/\//.test(r.body.url) ? r.body.url : null;
    if (!url) return { ok: false, reason: 'network' };
    quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log('product.ai.bridge.link', 'start', { entity: 'settings', entity_id: 'magnific' }));
    return { ok: true, url };
  }
  // the callback page: the code + state → the account's tokens into Vault (the server); logged with the account's name only
  async function bridgeCallback(code, state) {
    const r = await invoke({ action: 'bridge_callback', code: String(code || ''), state: String(state || '') });
    if (!r.ok) return r;
    const out = { ok: true, linked: !!r.body.linked, account: typeof r.body.account === 'string' ? r.body.account : null };
    quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log('product.ai.bridge.link', 'linked' + (out.account ? ' · ' + out.account : ''), { entity: 'settings', entity_id: 'magnific' }));
    return out;
  }
  async function bridgeUnlink() {
    if (!can().settings) return { ok: false, reason: 'forbidden' };
    const r = await invoke({ action: 'bridge_unlink' });
    if (!r.ok) return r;
    quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log('product.ai.bridge.link', 'unlinked', { entity: 'settings', entity_id: 'magnific' }));
    return { ok: true, linked: false };
  }
  // the batch's product photos up to the project now (the server: a short link each, creations_upload_image, image_shares sent /
  // error); reason 'not_linked' when no account is linked — the page then falls back to the queue (share)
  async function bridgeUpload(batchId, indexes) {
    const r = await invoke({ action: 'bridge_upload', batch_id: batchId, indexes: Array.isArray(indexes) ? indexes : undefined });
    if (!r.ok) return r;
    const out = { ok: true, uploaded: Number(r.body.uploaded) || 0, failed: Number(r.body.failed) || 0, skipped: Number(r.body.skipped) || 0, stopped: typeof r.body.stopped === 'string' ? r.body.stopped : null };
    log(['bridge upload', out.uploaded + ' photos'].concat(out.failed ? [out.failed + ' failed'] : [], out.skipped ? [out.skipped + ' skipped'] : [], out.stopped ? [out.stopped] : []).join(' · '), 'studio_batches', batchId);
    return out;
  }
  // the project's new results into the batch's product slots now (the server matches each to its photo and imports in one call)
  async function bridgeFetch(batchId) {
    const r = await invoke({ action: 'bridge_fetch', batch_id: batchId });
    if (!r.ok) return r;
    const out = { ok: true, found: Number(r.body.found) || 0, placed: Number(r.body.placed) || 0, unmatched: Number(r.body.unmatched) || 0, imported: Number(r.body.imported) || 0, failed: Number(r.body.failed) || 0, status: typeof r.body.status === 'string' ? r.body.status : 'ok', importId: Number.isInteger(r.body.import_id) ? r.body.import_id : null };
    log(['bridge fetch', out.found + ' found', out.placed + ' placed'].concat(out.unmatched ? [out.unmatched + ' unmatched'] : [], out.failed ? [out.failed + ' failed'] : []).join(' · '), 'studio_batches', batchId);
    return out;
  }
  // the admin: the shape (keys only) of the provider's account answer, to pin the API layer (T2)
  async function probe() {
    const r = await invoke({ action: 'probe' });
    if (!r.ok) return r;
    return { ok: true, provider: r.body.provider || '', shape: r.body.shape && typeof r.body.shape === 'object' ? r.body.shape : {}, models: Array.isArray(r.body.models) ? r.body.models : [] };
  }

  // ---------- the buckets ----------
  const urls = new Map(); // bucket/path → { url, at } | { loading, at }
  // a signed URL (an hour; cached 50 minutes); null while it loads (ib:images { url: path } when it lands)
  function imageUrl(bucket, path) {
    if (!path) return null;
    const key = bucket + '/' + path;
    const hit = urls.get(key);
    if (hit && hit.url && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
    if (hit && hit.loading) return null;
    const cl = c(); if (!cl) return null;
    urls.set(key, { loading: true, at: Date.now() });
    Promise.resolve(cl.storage.from(bucket).createSignedUrl(path, 3600)).then(({ data }) => {
      const u = data && typeof data.signedUrl === 'string' && data.signedUrl.startsWith('https://') ? data.signedUrl : null;
      urls.set(key, { url: u, at: Date.now() }); emit({ url: path, bucket });
    }, () => urls.delete(key));
    return null;
  }
  // the bytes of an image (for a download or an upload to the site) → { ok, blob }
  async function download(bucket, path) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.storage.from(bucket).download(path);
      if (error || !data) return { ok: false, reason: error && /not.?found/i.test(error.message || '') ? 'missing' : 'network' };
      return { ok: true, blob: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the member deletes their own results in bucket ai-images (their folder only — the policy says so, and so does this)
  async function remove(paths) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const me = myId(); const list = [].concat(paths || []).filter((p) => typeof p === 'string' && me && p.startsWith(me + '/'));
    if (!list.length) return { ok: false, reason: 'forbidden' };
    try {
      const { error } = await cl.storage.from(TOOL_BUCKET).remove(list);
      if (error) return { ok: false, reason: 'network' };
      list.forEach((p) => urls.delete(TOOL_BUCKET + '/' + p));
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // «سجل الصور»: the member's good image runs, newest first (the admin's every member's)
  async function history(limit) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('ai_runs').select('id, created_at, created_by, source, label, product_id, batch_id, item_index, model, credits, cost_usd, output')
        .eq('action', 'image').eq('status', 'ok').order('created_at', { ascending: false }).limit(limit || 30);
      if (error) return { ok: false, reason: 'network' };
      return { ok: true, rows: (data || []).map((x) => ({ id: x.id, at: x.created_at, by: x.created_by || null, source: x.source || '', label: x.label || '', productId: x.product_id || null, batchId: x.batch_id || null,
        index: Number.isInteger(x.item_index) ? x.item_index : null, model: x.model || '', credits: Number(x.credits) || 0, cost: Number(x.cost_usd) || 0,
        bucket: x.output && typeof x.output.bucket === 'string' ? x.output.bucket : TOOL_BUCKET, paths: x.output && Array.isArray(x.output.paths) ? x.output.paths.filter((p) => typeof p === 'string') : [] })) };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- the settings row «ai» (decision 3): image_model / image_monthly_credits ----------
  const readRow = async (cl) => { const { data, error } = await cl.from('settings').select('data').eq('section', 'ai').maybeSingle(); return { error, d: data && data.data && typeof data.data === 'object' ? data.data : {} }; };
  async function settings() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { error, d } = await readRow(cl);
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      const cap = Number(d.image_monthly_credits);
      last = { model: modelOf(d.image_model) ? d.image_model : DEFAULT_MODEL, monthlyCredits: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null, fromRow: ['image_model', 'image_monthly_credits'].filter((k) => d[k] != null && d[k] !== '') };
      return Object.assign({ ok: true }, last);
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the admin saves { model, monthlyCredits } (a positive whole number of credits, or null = the secret's cap if any, else none); the
  // row's other keys (the content settings) stay; logged as product.ai.image.settings
  async function saveSettings({ model, monthlyCredits }) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().settings) return { ok: false, reason: 'forbidden' };
    if (!modelOf(model)) return { ok: false, reason: 'invalid', field: 'model' };
    const n = monthlyCredits == null || monthlyCredits === '' ? null : Number(monthlyCredits);
    if (n !== null && !(Number.isInteger(n) && n > 0 && n <= 10000000)) return { ok: false, reason: 'invalid', field: 'monthlyCredits' };
    try {
      const { error: e1, d } = await readRow(cl);
      if (e1) return { ok: false, reason: e1.code === '42501' ? 'forbidden' : 'network' };
      const { error } = await cl.from('settings').upsert({ section: 'ai', data: Object.assign({}, d, { image_model: model, image_monthly_credits: n }) }, { onConflict: 'section' });
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      last = { model, monthlyCredits: n, fromRow: ['image_model'].concat(n !== null ? ['image_monthly_credits'] : []) };
      quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log('product.ai.image.settings', [model, n !== null ? n + ' credits' : 'no cap'].join(' · '), { entity: 'settings', entity_id: 'ai' }));
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // this Cairo month: the credits (ai_month_credits — the member's own image runs, the admin's every member's) and the runs by source
  const cairoMonth = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(iso)); } catch (e) { return String(iso).slice(0, 7); } };
  async function monthCredits() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: total, error } = await cl.rpc('ai_month_credits');
      if (error) return { ok: false, reason: 'network' };
      const now = new Date(); const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3 * 3600 * 1000).toISOString();
      const { data: rows, error: e2 } = await cl.from('ai_runs').select('source, status, credits, created_at').eq('action', 'image').gte('created_at', since).limit(2000);
      if (e2) return { ok: false, reason: 'network' };
      const month = cairoMonth(now.toISOString());
      const mine = (rows || []).filter((r) => cairoMonth(r.created_at) === month && r.status !== 'cap');
      const by = (s) => { const L = mine.filter((r) => r.source === s); return { runs: L.length, credits: L.reduce((t, r) => t + (Number(r.credits) || 0), 0) }; };
      return { ok: true, total: Number(total) || 0, usd: usd(total), runs: mine.length, studio: by('studio'), tool: by('tool'), edit: by('edit') };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // a photo File → { media_type: 'image/jpeg', data (base64), preview (data URL) } at most MAX_PHOTO px on the longest side and
  // within the server's size, or null when the browser cannot read it
  function photoOf(file) {
    return new Promise((resolve) => {
      const url = quiet(() => URL.createObjectURL(file)); if (!url) return resolve(null);
      const im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, MAX_PHOTO / Math.max(im.naturalWidth, im.naturalHeight));
          const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height);
          const d = cv.toDataURL('image/jpeg', 0.9); URL.revokeObjectURL(url);
          const b64 = d.slice(d.indexOf(',') + 1);
          resolve(b64 && b64.length <= MAX_IMAGE_B64 ? { media_type: 'image/jpeg', data: b64, preview: d } : null);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }

  window.IBImages = {
    can, generate, edit, create, probe, webp, imports, importRun, share, shares, bridgeStatus, bridgeLink, bridgeCallback, bridgeUnlink, bridgeUpload, bridgeFetch, imageUrl, download, remove, history, settings, saveSettings, monthCredits, photoOf, why,
    credits, usd, modelOf, estModel: () => (last && last.model) || DEFAULT_MODEL,
    MODELS, DEFAULT_MODEL, SIZES, SHAPES, EDIT_OPS, MAX_COUNT, CREDIT_USD, STUDIO_BUCKET, TOOL_BUCKET,
  };
})();
