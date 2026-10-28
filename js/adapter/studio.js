// Studio (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md): the product studio's data — studio_batches (a batch's
// state: its products, settings and image paths; read and written with products.add = F), sku_colors (the colors list, decision 3),
// sku_serial (the site-wide serial, decision 2: sku_serial_take reserves numbers right before an upload), the private bucket `studio`
// (images until the upload, decision 6), woo-sync studio_upload / category_create (decisions 7 / 8 — the server checks
// products.add and WOO_PUSH_ENABLED) and studio_sheet (decision 13: a Google Sheets link, read by the server). Every write returns a Promise of { ok, … } and never throws; reason 'forbidden' / 'invalid' /
// 'network' / 'push_disabled'. Every upload the site took is logged through IBActivity.log as product.create (ids and SKUs only).
(function () {
  'use strict';
  const BUCKET = 'studio';
  const COLS = 'id, title, brand_id, vendor_id, type, step, status, result, updated_at, archived_at';
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:studio', { detail: detail || {} })));
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const can = () => perm('products.add') === 'F';

  let st = 'idle'; let gen = 0;
  let batches = []; let colors = []; let nextSerial = null;
  const urls = new Map(); // path → { url, at }

  async function load() {
    const cl = c(); if (!cl) return;
    if (!can()) { st = 'ready'; emit(); return; }
    const g = ++gen; st = 'loading'; emit();
    try {
      const [b, k, s] = await Promise.all([
        cl.from('studio_batches').select(COLS).is('archived_at', null).order('updated_at', { ascending: false }).limit(100),
        cl.from('sku_colors').select('id, name_en, name_ar, code, hex').order('name_en', { ascending: true }),
        cl.from('sku_serial').select('next').eq('id', 1).maybeSingle(),
      ]);
      if (g !== gen) return;
      if (b.error || k.error) throw b.error || k.error;
      batches = b.data || []; colors = k.data || []; nextSerial = s && s.data ? Number(s.data.next) : null;
      st = 'ready';
    } catch (e) { if (g === gen) st = 'error'; }
    if (g === gen) emit();
  }
  const ensure = () => { if (st === 'idle' || st === 'error') load(); };

  async function open(id) {
    const cl = c(); if (!cl) return null;
    try { const { data, error } = await cl.from('studio_batches').select(COLS + ', state').eq('id', id).maybeSingle(); return error ? null : data; } catch (e) { return null; }
  }
  async function create(row) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('studio_batches').insert({ title: row.title, brand_id: row.brand_id || null, vendor_id: row.vendor_id || null, type: row.type, state: row.state || {}, step: row.step || 1 }).select(COLS).single();
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'invalid' };
      batches = [data].concat(batches.filter((b) => b.id !== data.id)); emit({ id: data.id });
      return { ok: true, id: data.id };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function save(id, patch) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const allowed = {}; ['title', 'brand_id', 'vendor_id', 'type', 'state', 'step'].forEach((k) => { if (patch[k] !== undefined) allowed[k] = patch[k]; });
    try {
      const { data, error } = await cl.from('studio_batches').update(allowed).eq('id', id).select(COLS).maybeSingle();
      if (error || !data) return { ok: false, reason: error && error.code === '42501' ? 'forbidden' : 'network' };
      batches = batches.map((b) => (b.id === id ? data : b)); emit({ id });
      return { ok: true, row: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function archive(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { error } = await cl.from('studio_batches').update({ archived_at: new Date().toISOString() }).eq('id', id);
      if (error) return { ok: false, reason: 'network' };
      batches = batches.filter((b) => b.id !== id); emit({ id });
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- colors (decision 3) ----------
  async function addColor(row) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('sku_colors').insert({ name_en: row.name_en, name_ar: row.name_ar, code: row.code, hex: row.hex || null }).select('id, name_en, name_ar, code, hex').single();
      if (error) return { ok: false, reason: error.code === '23505' ? 'taken' : error.code === '42501' ? 'forbidden' : 'invalid' };
      colors = colors.concat(data).sort((a, b) => a.name_en.localeCompare(b.name_en)); emit({ colors: true });
      quiet(() => window.IBActivity && window.IBActivity.log('product.color.add', data.name_en + ' · ' + data.code, { entity: 'sku_colors', entity_id: String(data.id) }));
      return { ok: true, color: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- the serial (decision 2) ----------
  async function takeSerials(n) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.rpc('sku_serial_take', { n });
      if (error || !Number.isInteger(Number(data))) return { ok: false, reason: error && error.code === '42501' ? 'forbidden' : 'network' };
      nextSerial = Number(data) + n; return { ok: true, first: Number(data) };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- images (decision 6): WebP in the browser, the private bucket until the upload ----------
  // a File → a WebP Blob (longest side ≤ 2000 px, quality 0.9); null when the browser cannot read it
  function toWebp(file, max) {
    return new Promise((resolve) => {
      const url = quiet(() => URL.createObjectURL(file)); if (!url) return resolve(null);
      const im = new Image();
      im.onload = () => {
        try {
          const m = max || 2000; const k = Math.min(1, m / Math.max(im.naturalWidth, im.naturalHeight));
          const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          cv.toBlob((b) => { URL.revokeObjectURL(url); resolve(b); }, 'image/webp', 0.9);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  const safe = (s) => String(s || 'img').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'img';
  // file → { ok, path } at studio/<batch>/<name>.webp
  async function uploadImage(batchId, file, name) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const blob = await toWebp(file); if (!blob) return { ok: false, reason: 'not_image' };
    const path = batchId + '/' + safe(name) + '-' + Date.now().toString(36) + '.webp';
    try {
      const { error } = await cl.storage.from(BUCKET).upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (error) return { ok: false, reason: 'network' };
      return { ok: true, path };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function removeImage(path) { const cl = c(); if (!cl) return; quiet(() => cl.storage.from(BUCKET).remove([path])); urls.delete(path); }
  // a signed URL for a thumbnail (an hour; cached 50 minutes); null while it loads (ib:studio { url } when it lands)
  function imageUrl(path) {
    if (!path) return null;
    const hit = urls.get(path);
    if (hit && hit.url && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
    if (hit && hit.loading) return null;
    const cl = c(); if (!cl) return null;
    urls.set(path, { loading: true, at: Date.now() });
    Promise.resolve(cl.storage.from(BUCKET).createSignedUrl(path, 3600)).then(({ data }) => {
      const u = data && typeof data.signedUrl === 'string' && data.signedUrl.startsWith('https://') ? data.signedUrl : null;
      urls.set(path, { url: u, at: Date.now() }); emit({ url: path });
    }, () => urls.delete(path));
    return null;
  }

  // ---------- woo-sync (decisions 7 / 8) ----------
  async function invoke(body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.functions.invoke('woo-sync', { body });
      if (error || !data) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        return { ok: false, reason: s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'missing' : 'network', field: b && b.field ? String(b.field) : null };
      }
      return { ok: true, body: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // one batch item to the site → { ok, result: 'ok' | 'error' | 'skipped', item: { productId, arId, sku, author, variations, error, … }, reason }
  async function upload(batchId, index) {
    const r = await invoke({ action: 'studio_upload', batch_id: batchId, index });
    if (!r.ok) return r;
    if (r.body.result === 'skipped') return { ok: true, result: 'skipped', reason: r.body.reason || 'push_disabled' };
    const item = r.body.item || {};
    if (item.productId) quiet(() => window.IBActivity && window.IBActivity.log('product.create', '#' + item.productId + (item.arId ? ' #' + item.arId : '') + ' · ' + (item.sku || ''), { entity: 'products', entity_id: String(item.productId) }));
    if (item.productId && window.IBProducts && window.IBProducts.refresh) quiet(() => window.IBProducts.refresh([item.productId].concat(item.arId ? [item.arId] : [])));
    return { ok: true, result: r.body.result, item };
  }
  async function createCategory(row) {
    const r = await invoke({ action: 'category_create', name_en: row.name_en, name_ar: row.name_ar || null, parent: row.parent || 0 });
    if (!r.ok) return r;
    if (r.body.result !== 'ok') return { ok: false, reason: r.body.reason || r.body.result };
    quiet(() => window.IBProducts && window.IBProducts.addCategory && window.IBProducts.addCategory({ id: r.body.id, name: row.name_en, parent_id: row.parent || null }));
    quiet(() => window.IBActivity && window.IBActivity.log('product.category.create', '#' + r.body.id + ' · ' + row.name_en, { entity: 'woo_categories', entity_id: String(r.body.id) }));
    return { ok: true, id: r.body.id };
  }

  // a Google Sheets link (decision 13: published to the web, or shared with anyone) → { ok, csv }: read by woo-sync, never by
  // the browser (Google answers its CSV with no CORS); reason 'bad_link' / 'not_published' / 'too_big' / 'unreachable' / …
  async function readSheetLink(url) {
    const r = await invoke({ action: 'studio_sheet', url: String(url == null ? '' : url).trim().slice(0, 2000) });
    if (!r.ok) return { ok: false, reason: r.reason === 'invalid' ? 'bad_link' : r.reason };
    if (r.body.result !== 'ok' || typeof r.body.csv !== 'string') return { ok: false, reason: r.body.reason || 'unreachable' };
    return { ok: true, csv: r.body.csv };
  }

  function clear() { gen++; st = 'idle'; batches = []; colors = []; nextSerial = null; urls.clear(); }

  window.IBStudio = {
    load, ensure, clear, state: () => st, can, BUCKET,
    batches: () => batches.slice(), colors: () => colors.slice(), nextSerial: () => nextSerial,
    open, create, save, archive, addColor, takeSerials, toWebp, uploadImage, removeImage, imageUrl, upload, createCategory, readSheetLink,
  };
})();
