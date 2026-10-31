// AI content (phase 5.3, docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md): the ai-content Edge Function (Claude — the
// server checks products.add / products.edit, the key, the monthly cap and the member's throttle) and the member's ai_runs (RLS:
// their own rows, the admin's all) for «سجل المحتوى». Suggestions only: nothing here writes the site (the content tool saves
// through IBProducts.save, the studio its batch through IBStudio.save). Every call returns a Promise of { ok, … } and never
// throws; reason 'forbidden' / 'invalid' (+ field) / 'missing' / 'not_configured' / 'ai_cap' / 'busy' / 'ai_error' / 'network'.
// Each answer is logged through IBActivity.log as product.ai.write / product.ai.studio (the source, the fields asked and the ids —
// never a text). Decision 8: the AI settings (the model, the effort, the monthly cap) live in public.settings section «ai» — read
// with settings.view (every member of the tool), written by the admin only (the 0002 policies) — and the server reads that row
// before every call, over the secrets; monthSpend() is this Cairo month's cost (ai_month_cost: the member's own runs, the admin's all).
(function () {
  'use strict';
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const isAdmin = () => { const D = window.IBDirectory; const me = D && D.me && D.me(); return !!me && me.role_id === 'admin' && me.status === 'active'; };
  // the server's rule (decision 7): the tool needs products.add or products.edit = F, the studio products.add = F, saving products.edit = F;
  // the settings (decision 8): the admin
  const can = () => ({ write: perm('products.add') === 'F' || perm('products.edit') === 'F', studio: perm('products.add') === 'F', save: perm('products.edit') === 'F', settings: isAdmin() });
  const MAX_PHOTO = 1568; // Claude reads a photo at this size; the server takes 2 MB of base64 at most
  // the listed models / efforts (the server's MODELS / EFFORTS in _shared/ai-content.js) with their labels, and about one product's
  // cost on each (decision 2) for the confirmations
  const MODELS = [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — أدق', cost: 0.05 }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — أرخص بالنص', cost: 0.025 }];
  const EFFORTS = [{ id: 'low', label: 'سريع — تفكير أقل' }, { id: 'medium', label: 'متوازن' }, { id: 'high', label: 'متأني — تفكير أكتر' }];
  const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', cap: null };
  const EST_COST = MODELS[0].cost;
  let last = null; // the last settings read (estCost before any read = the default model)
  const estCost = (model) => (MODELS.find((m) => m.id === (model || (last && last.model))) || MODELS[0]).cost;

  async function invoke(body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.functions.invoke('ai-content', { body });
      if (error || !data) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const reason = s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'missing' : s === 402 ? 'ai_cap' : s === 429 ? 'busy' : s === 503 ? 'not_configured' : s === 502 ? 'ai_error' : 'network';
        return { ok: false, reason, field: b && b.field ? String(b.field) : null };
      }
      return { ok: true, body: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const log = (action, detail, entity, id) => quiet(() => window.IBActivity && window.IBActivity.log && window.IBActivity.log(action, detail, { entity, entity_id: id == null ? null : String(id) }));
  const answer = (b) => ({ ok: true, result: b.result === 'refused' ? 'refused' : 'ok', missing: Array.isArray(b.missing) ? b.missing : [], model: typeof b.model === 'string' ? b.model : '', cost: Number(b.cost_usd) || 0, runId: b.run_id || null });

  // the content tool: { source: data | image | product, outputs, langs, tone, data?, current?, image?, productId? }
  // → { ok, result: 'ok' | 'refused', out: { ar?, en? }, missing, model, cost, runId }
  async function write(req) {
    const body = { action: 'write', source: req.source, outputs: req.outputs, langs: req.langs, tone: req.tone || 'warm' };
    if (req.data) body.data = req.data;
    if (req.current) body.current = req.current;
    if (req.image) body.image = { media_type: req.image.media_type, data: req.image.data };
    if (req.productId) body.product_id = Number(req.productId);
    const r = await invoke(body);
    if (!r.ok) return r;
    const out = Object.assign(answer(r.body), { out: r.body.out && typeof r.body.out === 'object' ? r.body.out : {} });
    log('product.ai.write', [req.source, req.outputs.join(', '), req.langs.join(', ')].concat(req.productId ? ['#' + req.productId] : [], out.result === 'refused' ? ['refused'] : []).join(' · '), 'products', req.productId || null);
    return out;
  }
  // the studio: one batch item (read by the server from the saved batch) → { ok, result, fields, missing, model, cost }
  async function studio(batchId, index, want) {
    const r = await invoke({ action: 'studio', batch_id: batchId, index, want });
    if (!r.ok) return r;
    const out = Object.assign(answer(r.body), { fields: r.body.fields && typeof r.body.fields === 'object' ? r.body.fields : {} });
    log('product.ai.studio', ['#' + (index + 1), want.join(', ')].concat(out.result === 'refused' ? ['refused'] : []).join(' · '), 'studio_batches', batchId);
    return out;
  }

  // «سجل المحتوى»: the last texts of the content tool, newest first
  async function history(limit) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('ai_runs').select('id, created_at, source, label, product_id, model, cost_usd, output')
        .eq('action', 'write').eq('status', 'ok').order('created_at', { ascending: false }).limit(limit || 20);
      if (error) return { ok: false, reason: 'network' };
      return { ok: true, rows: (data || []).map((x) => ({ id: x.id, at: x.created_at, source: x.source || '', label: x.label || '', productId: x.product_id || null, model: x.model || '', cost: Number(x.cost_usd) || 0,
        out: x.output && x.output.out && typeof x.output.out === 'object' ? x.output.out : {} })) };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // the settings row «ai» → { ok, model, effort, cap, fromRow } (the defaults for a missing row — the server then falls back to its
  // secrets, which the page cannot see; fromRow says which values the row holds)
  async function settings() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.from('settings').select('data').eq('section', 'ai').maybeSingle();
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      const d = data && data.data && typeof data.data === 'object' ? data.data : {};
      const cap = Number(d.monthly_limit_usd);
      last = { model: MODELS.some((m) => m.id === d.model) ? d.model : DEFAULTS.model, effort: EFFORTS.some((e) => e.id === d.effort) ? d.effort : DEFAULTS.effort,
        cap: Number.isFinite(cap) && cap > 0 ? cap : null, fromRow: Object.keys(d).filter((k) => d[k] != null && d[k] !== '') };
      return Object.assign({ ok: true }, last);
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the admin saves { model, effort, cap } (cap: a positive number of dollars, or null = the secret's cap if any, else none) → upsert
  // of the row; logged as product.ai.settings (the three values — no secret is involved)
  async function saveSettings({ model, effort, cap }) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().settings) return { ok: false, reason: 'forbidden' };
    if (!MODELS.some((m) => m.id === model)) return { ok: false, reason: 'invalid', field: 'model' };
    if (!EFFORTS.some((e) => e.id === effort)) return { ok: false, reason: 'invalid', field: 'effort' };
    const n = cap == null || cap === '' ? null : Number(cap);
    if (n !== null && !(Number.isFinite(n) && n > 0 && n <= 100000)) return { ok: false, reason: 'invalid', field: 'cap' };
    try {
      const { error } = await cl.from('settings').upsert({ section: 'ai', data: { model, effort, monthly_limit_usd: n } }, { onConflict: 'section' });
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'network' };
      last = { model, effort, cap: n, fromRow: ['model', 'effort'].concat(n !== null ? ['monthly_limit_usd'] : []) };
      log('product.ai.settings', [model, effort, n !== null ? '$' + n : 'no cap'].join(' · '), 'settings', 'ai');
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // this Cairo month: the cost (ai_month_cost — the member's own runs, the admin's every member's) and the runs by action
  const cairoMonth = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(iso)); } catch (e) { return String(iso).slice(0, 7); } };
  async function monthSpend() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: total, error } = await cl.rpc('ai_month_cost');
      if (error) return { ok: false, reason: 'network' };
      const now = new Date(); const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3 * 3600 * 1000).toISOString(); // a little before the month in Cairo
      const { data: rows, error: e2 } = await cl.from('ai_runs').select('action, status, cost_usd, created_at').gte('created_at', since).limit(2000);
      if (e2) return { ok: false, reason: 'network' };
      const month = cairoMonth(now.toISOString());
      const mine = (rows || []).filter((r) => cairoMonth(r.created_at) === month && r.status !== 'cap');
      const by = (a) => mine.filter((r) => r.action === a);
      const sum = (L) => Math.round(L.reduce((t, r) => t + (Number(r.cost_usd) || 0), 0) * 1000) / 1000;
      return { ok: true, total: Math.round((Number(total) || 0) * 1000) / 1000, runs: mine.length, write: { runs: by('write').length, cost: sum(by('write')) }, studio: { runs: by('studio').length, cost: sum(by('studio')) } };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // a photo File → { media_type: 'image/jpeg', data (base64), preview (data URL) } at most MAX_PHOTO px on the longest side, or
  // null when the browser cannot read it
  function photoOf(file) {
    return new Promise((resolve) => {
      const url = quiet(() => URL.createObjectURL(file)); if (!url) return resolve(null);
      const im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, MAX_PHOTO / Math.max(im.naturalWidth, im.naturalHeight));
          const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height);
          const d = cv.toDataURL('image/jpeg', 0.85); URL.revokeObjectURL(url);
          const b64 = d.slice(d.indexOf(',') + 1);
          resolve(b64 && b64.length <= 2000000 ? { media_type: 'image/jpeg', data: b64, preview: d } : null);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }

  window.IBAI = { can, write, studio, history, photoOf, settings, saveSettings, monthSpend, estCost, MODELS, EFFORTS, EST_COST };
})();
