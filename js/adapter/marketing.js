// «التسويق» (phase 9.5.1, 0049, docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md). Loaded when the page opens (ensure()):
// the campaigns (the list's columns — a campaign's whole state only when it is opened), the schedule / publishing log (mkt_posts),
// the design templates and the wallet (mkt_credits), in the page's shapes (the v5's):
//   campaigns() [{ id, name, goal, step, scheduledAt, createdAt, updatedAt }] — not archived, the newest change first
//   posts()     [{ id, campaignId, piece, name, kind, pl, day, time, src: 'system', camp, status, caption, capOrig, tags, images, img,
//                  wasLive, url, publishedAt, delAt }]
//   templates() [{ id, name, kind, img, desc, used, at }]
//   wallet()    { cap, used, balance } | null (balance null = no cap)
// Writes: the campaign row (create / save — saveSoon + flush, one after the other — / archive: name, goal, step, state), the files
// (upload into the campaign's folder or templates/, signed links, the bytes for the ZIP), the schedule and the log's actions
// (mkt_schedule / mkt_post_act — the server's rules), the templates (insert / update / «حذف» = deleted_at, mkt_template_used), a
// pasted product link (the products mirror by permalink or SKU), and the AI through the two Edge Functions: ai-images campaign /
// campaign_edit (credits) and ai-content marketing (the monthly AI budget). Every write returns { ok, reason, field, message } and
// never throws; activity_log mkt.* carries ids, counts, kinds, platforms and statuses only — never an idea, a caption, a prompt,
// a note or a template's description (decision 19). Live: the private broadcast «marketing» / «changed» → one load() a moment
// later, plus a check every minute while the page is open.
(function () {
  'use strict';
  const CAMP_COLS = 'id, name, goal, step, scheduled_at, created_by, created_at, updated_at, archived_at';
  const OPEN_COLS = CAMP_COLS + ', state';
  const POST_COLS = 'id, campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, was_live, post_url, published_at, published_by, deleted_at, created_at, updated_at';
  const TPL_COLS = 'id, name, kind, image, descr, used, created_at, updated_at, deleted_at';
  const LIMIT = 500; const POST_LIMIT = 3000;
  const BUCKET = 'marketing'; const MAX_BYTES = 15 * 1024 * 1024; const MIME = ['image/png', 'image/jpeg', 'image/webp'];
  const SIGN_SECONDS = 600;
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const myUid = () => { const m = me(); return (m && m.id) || null; };
  const can = () => ({ view: perm('marketing.view') !== 'N', create: perm('marketing.create') === 'F', publish: perm('marketing.publish') === 'F' });
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' || code === 'PGRST116' ? 'notfound' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fieldOf = (err) => { const m = /invalid: (\w+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };
  const MESSAGES = { forbidden: 'مفيش صلاحية للإجراء ده', notfound: 'مش موجود أو اتحذف', network: 'تعذّر الاتصال — جرّب تاني', invalid: 'البيانات مش مظبوطة — راجعها' };
  const FIELD_MESSAGES = { day: 'اليوم ده فات أو بعيد أوي — اختار من النهارده لحد سنة', time: 'الساعة دي فاتت — اختار ساعة جاية', same: 'ده نفس الميعاد الحالي',
    status: 'الإجراء ده مش متاح للبوست في حالته دي', caption: 'الكابشن أطول من 2200 حرف', url: 'اللينك لازم يبدأ بـ https://', images: 'الصور لازم تكون من الكامبين دي',
    platform: 'المنصة مش معروفة', items: 'مفيش قطع تتجدول، أو فيه قطعة مكررة على نفس المنصة', piece: 'في قطعة من غير رقم', kind: 'نوع قطعة مش معروف', tags: 'التاجات أطول من 300 حرف' };
  const fail = (err) => { const reason = reasonOf(err); const field = reason === 'invalid' ? fieldOf(err) : null; return { ok: false, reason, field, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] }; };
  const log = (action, detail, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log('mkt.' + action, detail || '', { entity: 'marketing', entity_id: id == null ? null : String(id) })); };
  const emit = () => quiet(() => document.dispatchEvent(new CustomEvent('ib:marketing')));
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const fmt = quiet(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }));
  const cairoDay = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; return fmt ? fmt.format(d) : d.toISOString().slice(0, 10); };

  // ---------- the shapes ----------
  const toCampaign = (r) => ({ id: r.id, name: r.name, goal: r.goal || null, step: Number(r.step) || 1, scheduledAt: r.scheduled_at || null, createdBy: r.created_by || null,
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at || null });
  const toPost = (r, names) => ({ id: Number(r.id), campaignId: r.campaign_id || null, piece: r.piece || null, name: r.name, kind: r.kind, pl: r.platform, day: r.day, time: r.time, how: r.how,
    src: 'system', camp: (r.campaign_id && names.get(r.campaign_id)) || '—', status: r.status, caption: r.caption || '', capOrig: r.caption_orig || '', tags: r.tags || '',
    images: Array.isArray(r.images) ? r.images.filter((p) => typeof p === 'string') : [], img: Array.isArray(r.images) && typeof r.images[0] === 'string' ? r.images[0] : null,
    wasLive: !!r.was_live, url: r.post_url || null, publishedAt: r.published_at || null, delAt: cairoDay(r.deleted_at), updatedAt: r.updated_at });
  const toTemplate = (r) => ({ id: r.id, name: r.name, kind: r.kind, img: r.image || null, desc: r.descr || '', used: Number(r.used) || 0, at: cairoDay(r.updated_at || r.created_at) || '', deleted: !!r.deleted_at });

  let st = 'idle'; let gen = 0;
  const data = { campaigns: [], posts: [], templates: [], credits: null };
  const names = () => new Map(data.campaigns.map((x) => [x.id, x.name]));
  const reshape = () => { const n = names(); data.posts = data.posts.map((p) => Object.assign(p, { camp: (p.campaignId && n.get(p.campaignId)) || '—' })); };
  async function rows(q) { const { data: d, error } = await q; if (error) throw error; return Array.isArray(d) ? d : []; }
  async function load() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().view) { data.campaigns = []; data.posts = []; data.templates = []; data.credits = null; st = 'ready'; emit(); return { ok: true }; }
    const g = ++gen; st = st === 'ready' ? 'ready' : 'loading';
    try {
      const [cs, ps, ts] = await Promise.all([
        rows(cl.from('mkt_campaigns').select(CAMP_COLS).order('updated_at', { ascending: false }).limit(LIMIT)),
        rows(cl.from('mkt_posts').select(POST_COLS).order('day', { ascending: false }).limit(POST_LIMIT)),
        rows(cl.from('mkt_templates').select(TPL_COLS).is('deleted_at', null).order('created_at', { ascending: false }).limit(LIMIT)),
      ]);
      if (g !== gen) return { ok: false, reason: 'stale' };
      data.campaigns = cs.map(toCampaign); const n = names();
      data.posts = ps.map((r) => toPost(r, n)); data.templates = ts.map(toTemplate);
      st = 'ready';
      if (can().create) await credits(true);
      emit(); return { ok: true };
    } catch (e) { if (g === gen && st === 'loading') st = 'idle'; return fail(e); }
  }
  // the page's first open: one load and the live line
  async function ensure() { if (st === 'idle') { const r = await load(); subscribe(); return r; } return { ok: true }; }
  const campaigns = () => data.campaigns.filter((x) => !x.archivedAt);
  const posts = () => data.posts;
  const templates = () => data.templates.filter((x) => !x.deleted);
  const getPost = (id) => data.posts.find((p) => p.id === Number(id)) || null;

  // ---------- the wallet (decision 11) ----------
  async function credits(silent) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: w, error } = await cl.rpc('mkt_credits'); if (error) return fail(error);
      data.credits = w && typeof w === 'object' ? { cap: Number.isFinite(Number(w.cap)) && w.cap != null ? Number(w.cap) : null, used: Number(w.used) || 0 } : null;
      if (!silent) emit(); return { ok: true };
    } catch (e) { return fail(e); }
  }
  const wallet = () => (data.credits ? { cap: data.credits.cap, used: data.credits.used, balance: data.credits.cap == null ? null : Math.max(0, data.credits.cap - data.credits.used) } : null);

  // ---------- the campaigns ----------
  const fieldsOf = (f) => { const o = {}; const x = f || {};
    if (x.name !== undefined) o.name = clean(x.name, 120) || 'كامبين من غير اسم';
    if (x.goal !== undefined) o.goal = x.goal || null;
    if (x.step !== undefined) o.step = Math.max(1, Math.min(4, Math.round(Number(x.step) || 1)));
    if (x.state !== undefined) o.state = x.state && typeof x.state === 'object' ? JSON.parse(JSON.stringify(x.state)) : {};
    return o; };
  async function create(f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    try {
      const { data: r, error } = await cl.from('mkt_campaigns').insert(fieldsOf(Object.assign({ step: 1, state: {} }, f))).select(CAMP_COLS).single();
      if (error || !r) return fail(error);
      const camp = toCampaign(r); data.campaigns = [camp].concat(data.campaigns.filter((x) => x.id !== camp.id)); emit();
      log('campaign.add', camp.goal || '', camp.id); return { ok: true, id: camp.id, campaign: camp };
    } catch (e) { return fail(e); }
  }
  async function open(id) {
    const cl = c(); if (!cl || !id) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: r, error } = await cl.from('mkt_campaigns').select(OPEN_COLS).eq('id', id).maybeSingle();
      if (error) return fail(error); if (!r || r.archived_at) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      return { ok: true, campaign: Object.assign(toCampaign(r), { state: r.state && typeof r.state === 'object' ? r.state : {} }) };
    } catch (e) { return fail(e); }
  }
  const chains = new Map(); // campaign id → its last save (the saves of a campaign go one after the other, the newest last)
  const pend = new Map();   // campaign id → { timer, get } of saveSoon
  async function doSave(id, f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    const patch = fieldsOf(f); if (!Object.keys(patch).length) return { ok: true };
    try {
      const { data: r, error } = await cl.from('mkt_campaigns').update(patch).eq('id', id).select(CAMP_COLS);
      if (error) return fail(error);
      if (!Array.isArray(r) || !r.length) return { ok: false, reason: 'notfound', message: 'الكامبين دي اتحذفت أو مش متاحة' };
      const camp = toCampaign(r[0]); const i = data.campaigns.findIndex((x) => x.id === id);
      const before = i >= 0 ? data.campaigns[i] : null;
      if (i >= 0) data.campaigns[i] = camp; else data.campaigns.unshift(camp);
      data.campaigns.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      if (before && before.name !== camp.name) reshape();
      if (before && before.step !== camp.step) log('campaign.step', before.step + ' → ' + camp.step, id);
      return { ok: true, campaign: camp };
    } catch (e) { return fail(e); }
  }
  function save(id, f) {
    if (!can().create) return Promise.resolve({ ok: false, reason: 'forbidden', message: MESSAGES.forbidden });
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(() => doSave(id, f), () => doSave(id, f));
    chains.set(id, next.catch(() => null)); return next;
  }
  // the wizard's autosave: the last get() wins after ms of quiet; flush(id) saves it now (before an AI call reads the state)
  function saveSoon(id, get, ms) {
    if (!id || typeof get !== 'function') return;
    const p = pend.get(id) || {}; if (p.timer) clearTimeout(p.timer); p.get = get;
    p.timer = setTimeout(() => { flush(id); }, ms == null ? 1500 : ms); pend.set(id, p);
  }
  async function flush(id) {
    const p = pend.get(id);
    if (p) { if (p.timer) clearTimeout(p.timer); pend.delete(id); const f = quiet(() => p.get()); if (f) return save(id, f); }
    return chains.get(id) ? (await chains.get(id)) || { ok: true } : { ok: true };
  }
  async function archive(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const p = pend.get(id); if (p && p.timer) clearTimeout(p.timer); pend.delete(id);
    try {
      const { data: r, error } = await cl.from('mkt_campaigns').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error) return fail(error); if (!Array.isArray(r) || !r.length) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      data.campaigns = data.campaigns.filter((x) => x.id !== id); emit();
      log('campaign.archive', '', id); return { ok: true };
    } catch (e) { return fail(e); }
  }

  // ---------- the files ----------
  const rand = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(16).slice(2, 14));
  const extOf = (type) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');
  function checkFile(file) {
    if (!file || typeof file.size !== 'number') return 'invalid';
    if (!MIME.includes(file.type)) return 'type';
    if (file.size > MAX_BYTES) return 'size';
    return null;
  }
  const fileMessage = (bad) => (bad === 'size' ? 'الصورة أكبر من 15 ميجا' : 'ارفع صورة (PNG / JPG / WebP)');
  async function put(path, file, name) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { error } = await cl.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) return { ok: false, reason: 'network', message: 'تعذّر رفع الصورة — جرّب تاني' };
      return { ok: true, path, name: clean(name, 120) || path.replace(/^.*\//, '') };
    } catch (e) { return { ok: false, reason: 'network', message: 'تعذّر رفع الصورة — جرّب تاني' }; }
  }
  async function upload(campaignId, file) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!campaignId) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    const bad = checkFile(file); if (bad) return { ok: false, reason: 'invalid', field: bad, message: fileMessage(bad) };
    return put(campaignId + '/up-' + rand() + '.' + extOf(file.type), file, file.name);
  }
  async function uploadTemplate(file) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const bad = checkFile(file); if (bad) return { ok: false, reason: 'invalid', field: bad, message: fileMessage(bad) };
    return put('templates/' + rand() + '.' + extOf(file.type), file, file.name);
  }
  const urls = new Map(); // path → { url, until }
  async function url(path) {
    const cl = c(); if (!cl || !path) return null;
    const hit = urls.get(path); if (hit && hit.until > Date.now()) return hit.url;
    try { const { data: d, error } = await cl.storage.from(BUCKET).createSignedUrl(path, SIGN_SECONDS); if (error || !d || !d.signedUrl) return null; urls.set(path, { url: d.signedUrl, until: Date.now() + (SIGN_SECONDS - 60) * 1000 }); return d.signedUrl; }
    catch (e) { return null; }
  }
  const cachedUrl = (path) => { const hit = path && urls.get(path); return hit && hit.until > Date.now() ? hit.url : null; };
  async function blob(path) {
    const cl = c(); if (!cl || !path) return { ok: false, reason: 'network' };
    try { const { data: d, error } = await cl.storage.from(BUCKET).download(path); if (error || !d) return { ok: false, reason: 'network' }; return { ok: true, blob: d }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // a pasted product link of the site or its SKU (decision 13) → the product of the mirror
  async function product(text) {
    const W = window.IbtekrCampWiz; const k = W && W.linkKeys ? W.linkKeys(text) : null;
    const no = { ok: false, reason: 'invalid', field: 'link', message: 'اللينك ده مش لمنتج على الموقع — ارفع الصورة بدل اللينك' };
    if (!k) return no;
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const q = cl.from('products').select('id, name, sku, image_url');
      const { data: r, error } = k.sku ? await q.eq('sku', k.sku).limit(1) : await q.in('permalink', k.permalinks).limit(1);
      if (error) return fail(error);
      const p = Array.isArray(r) && r[0]; if (!p) return no;
      return { ok: true, product: { id: Number(p.id), name: p.name || p.sku || '#' + p.id, sku: p.sku || '', image: p.image_url || null } };
    } catch (e) { return fail(e); }
  }

  // ---------- the AI (decisions 8–10) ----------
  async function invoke(fn, body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: d, error } = await cl.functions.invoke(fn, { body });
      if (error || !d) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const reason = s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'notfound' : s === 402 ? 'ai_cap' : s === 429 ? 'busy' : s === 503 ? 'not_configured' : s === 502 ? 'ai_error' : 'network';
        return { ok: false, reason, field: b && b.field ? String(b.field) : null, status: b && Number.isInteger(b.status) ? b.status : null, configured: b && typeof b.configured === 'boolean' ? b.configured : null };
      }
      return { ok: true, body: d };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const AI_FIELDS = { piece: 'القطعة دي مش موجودة في الكامبين — احفظ وجرّب تاني', image: 'القطعة لسه مالهاش صورة', text: 'اكتب الكلام الأول', kind: 'نوع الخانة مش معروف',
    model: 'الموديل مش متاح', size: 'المقاس مش متاح', pins: 'التعليقات كتير أو فاضية', note: 'اكتب التعديل الأول', reference: 'المرجعيات مش متاحة' };
  function aiMessage(r, kind) {
    if (r.reason === 'ai_cap') return kind === 'image' ? 'رصيد كريدت الصور للشهر ده خلص — الأدمن بيزوّد السقف من «إعدادات الصور»' : 'سقف الـ AI الشهري للكتابة خلص — الأدمن بيزوّده من «إعدادات الـ AI»';
    if (r.reason === 'busy') return 'طلبات كتير في وقت قصير — استنى دقيقة وجرّب تاني';
    if (r.reason === 'not_configured') {
      if (kind === 'image') { const w = window.IBImages && window.IBImages.why ? quiet(() => window.IBImages.why(r)) : ''; return w || 'الـ AI للصور لسه مش متوصّل'; }
      return 'الـ AI للكتابة لسه مش متوصّل — السر ANTHROPIC_API_KEY مش موجود في أسرار السيرفر';
    }
    if (r.reason === 'refused') return 'الموديل رفض الطلب — غيّر الكلام وجرّب تاني';
    if (r.reason === 'forbidden') return MESSAGES.forbidden;
    if (r.reason === 'notfound') return 'الكامبين أو القطعة مش موجودة — احفظ وجرّب تاني';
    if (r.reason === 'invalid') return (r.field && AI_FIELDS[r.field]) || MESSAGES.invalid;
    if (r.reason === 'ai_error' && kind === 'image' && window.IBImages && window.IBImages.why) { const w = quiet(() => window.IBImages.why(r)); if (w) return w; }
    return 'الـ AI ماردش — جرّب تاني';
  }
  const where = (a) => String(a.piece || '') + (a.slide == null ? '' : a.slide < 0 ? '·cover' : '·' + (Number(a.slide) + 1));
  async function imageCall(action, cid, a, extra) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    await flush(cid);
    const r = await invoke('ai-images', Object.assign({ action, campaign_id: cid, piece: a.piece, slide: a.slide == null ? null : Number(a.slide), model: a.model, size: a.size || undefined }, extra || {}));
    if (!r.ok) return Object.assign(r, { message: aiMessage(r, 'image') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'image') };
    const path = typeof b.path === 'string' ? b.path : null; if (!path) return { ok: false, reason: 'ai_error', message: aiMessage({ reason: 'ai_error' }, 'image') };
    const n = Number(b.credits) || 0;
    if (data.credits) data.credits.used += n;
    log(action === 'campaign' ? 'ai.image' : 'ai.edit', where(a) + ' · ' + n + ' credits', cid);
    quiet(() => credits(true));
    return { ok: true, path, credits: n, model: typeof b.model === 'string' ? b.model : a.model };
  }
  const generate = (cid, a) => imageCall('campaign', cid, a || {});
  const edit = (cid, a) => { const x = a || {}; const pins = (Array.isArray(x.pins) ? x.pins : []).filter((p) => p && String(p.text || '').trim()).slice(0, 10)
    .map((p) => ({ x: Math.max(0, Math.min(100, Math.round(Number(p.x) || 0))), y: Math.max(0, Math.min(100, Math.round(Number(p.y) || 0))), text: clean(p.text, 200) }));
    return imageCall('campaign_edit', cid, x, { note: clean(x.note, 500), pins }); };
  // the AI writing (decision 10): fill (a piece's fields) · rewrite (one field) · describe (a template's image)
  async function write(cid, a) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const x = a || {}; if (cid) await flush(cid);
    const body = { action: 'marketing', task: x.task, campaign_id: cid || undefined, piece: x.piece || undefined, slide: x.slide == null ? undefined : Number(x.slide), kind: x.kind || undefined,
      text: typeof x.text === 'string' ? x.text.slice(0, 3000) : undefined, image: x.image || undefined };
    const r = await invoke('ai-content', body);
    if (!r.ok) return Object.assign(r, { message: aiMessage(r, 'text') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    log('ai.' + (x.task || 'write'), x.kind || where(x), cid || null);
    return { ok: true, fields: b.fields && typeof b.fields === 'object' ? b.fields : null, text: typeof b.text === 'string' ? b.text : null };
  }

  // ---------- the schedule and the log (decisions 14–16) ----------
  async function schedule(cid, items) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().publish) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    await flush(cid);
    try {
      const { data: n, error } = await cl.rpc('mkt_schedule', { p_campaign: cid, p_items: items }); if (error) return fail(error);
      const pls = [...new Set((items || []).map((x) => x.platform))].join(', ');
      log('campaign.schedule', (items || []).length + ' posts · ' + pls, cid);
      await load(); return { ok: true, waiting: Number(n) || 0 };
    } catch (e) { return fail(e); }
  }
  async function postAct(id, action, args, detail) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().publish) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const p = getPost(id);
    try {
      const { data: s, error } = await cl.rpc('mkt_post_act', { p_id: Number(id), p_action: action, p_args: args || {} }); if (error) return fail(error);
      if (p) {
        if (action === 'move') Object.assign(p, { day: args.day, time: args.time, status: 'مجدول' });
        else if (action === 'caption') p.caption = String(args.text || '');
        else if (action === 'published') Object.assign(p, { status: 'اتنشر', url: args.url || null, publishedAt: new Date().toISOString() });
        else if (action === 'delete') Object.assign(p, { status: 'اتحذف', wasLive: p.status === 'اتنشر', delAt: cairoDay(new Date().toISOString()) });
      }
      log('post.' + action, '#' + id + (p ? ' · ' + p.pl : '') + (detail ? ' · ' + detail : ''), id);
      emit(); return { ok: true, status: typeof s === 'string' ? s : (p && p.status) || '' };
    } catch (e) { return fail(e); }
  }
  const move = (id, day, time) => postAct(id, 'move', { day, time }, day + ' ' + time);
  const caption = (id, text) => postAct(id, 'caption', { text: String(text == null ? '' : text).slice(0, 2200) });
  const published = (id, link) => postAct(id, 'published', { url: link ? String(link).trim() : '' });
  const remove = (id) => { const p = getPost(id); return postAct(id, 'delete', {}, p ? p.status : ''); };

  // ---------- the templates (decision 17) ----------
  const tplRow = (f) => { const o = {}; const x = f || {};
    if (x.name !== undefined) o.name = clean(x.name, 80);
    if (x.kind !== undefined) o.kind = ['post', 'carousel', 'video'].includes(x.kind) ? x.kind : 'post';
    if (x.img !== undefined) o.image = x.img || null;
    if (x.desc !== undefined) o.descr = String(x.desc == null ? '' : x.desc).replace(/\r\n?/g, '\n').trim().slice(0, 1000);
    return o; };
  async function addTemplate(f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    try {
      const { data: r, error } = await cl.from('mkt_templates').insert(tplRow(f)).select(TPL_COLS).single(); if (error || !r) return fail(error);
      const t = toTemplate(r); data.templates = [t].concat(data.templates.filter((x) => x.id !== t.id)); emit();
      log('template.add', t.kind, t.id); return { ok: true, template: t };
    } catch (e) { return fail(e); }
  }
  async function editTemplate(id, f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    try {
      const { data: r, error } = await cl.from('mkt_templates').update(tplRow(f)).eq('id', id).select(TPL_COLS); if (error) return fail(error);
      if (!Array.isArray(r) || !r.length) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      const t = toTemplate(r[0]); data.templates = data.templates.map((x) => (x.id === id ? t : x)); emit();
      log('template.edit', t.kind, id); return { ok: true, template: t };
    } catch (e) { return fail(e); }
  }
  async function removeTemplate(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    try {
      const { data: r, error } = await cl.from('mkt_templates').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id'); if (error) return fail(error);
      if (!Array.isArray(r) || !r.length) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      data.templates = data.templates.filter((x) => x.id !== id); emit();
      log('template.delete', '', id); return { ok: true };
    } catch (e) { return fail(e); }
  }
  async function templateUsed(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: n, error } = await cl.rpc('mkt_template_used', { p_id: id }); if (error) return fail(error);
      const t = data.templates.find((x) => x.id === id); if (t) t.used = Number(n) || t.used + 1;
      return { ok: true, used: Number(n) || 0 };
    } catch (e) { return fail(e); }
  }

  // ---------- live ----------
  let live = null; let poll = null; let timer = null; const POLL_MS = 60000;
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {}; if (!cl || !myUid() || cfg.realtime === false) return;
    if (!live) {
      try {
        live = cl.channel('marketing', { config: { private: true } }).on('broadcast', { event: 'changed' }, onLive) // 0049: marketing.view only, nobody sends
          .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { const dead = live; live = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); } });
      } catch (e) { live = null; }
    }
    if (!poll && typeof setInterval === 'function') poll = setInterval(() => { check(); }, POLL_MS);
  }
  function onLive() { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; if (st === 'ready') load(); }, 1500); }
  // the safety net: a newer change than the loaded ones → one load()
  async function check() {
    if (st !== 'ready' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false;
    const cl = c(); if (!cl) return false;
    if (!live) subscribe();
    try {
      const [a, b] = await Promise.all([cl.from('mkt_posts').select('updated_at').order('updated_at', { ascending: false }).limit(1), cl.from('mkt_campaigns').select('updated_at').order('updated_at', { ascending: false }).limit(1)]);
      if (a.error || b.error) return false;
      const latest = Math.max(...[a.data, b.data].map((r) => (r && r[0] ? Date.parse(r[0].updated_at) || 0 : 0)));
      const mine = Math.max(0, ...data.posts.map((p) => Date.parse(p.updatedAt || '') || 0), ...data.campaigns.map((x) => Date.parse(x.updatedAt || '') || 0));
      if (!(latest > mine)) return false;
      await load(); return true;
    } catch (e) { return false; }
  }
  function unsubscribe() {
    const lv = live; live = null; if (timer) { clearTimeout(timer); timer = null; } if (poll) { clearInterval(poll); poll = null; }
    if (lv && c()) { try { Promise.resolve(c().removeChannel(lv)).catch(() => {}); } catch (e) { /* already closed */ } }
  }
  // the sign-out wipe
  function clear() { gen += 1; unsubscribe(); pend.forEach((p) => { if (p.timer) clearTimeout(p.timer); }); pend.clear(); chains.clear(); urls.clear(); data.campaigns = []; data.posts = []; data.templates = []; data.credits = null; st = 'idle'; }

  window.IBMarketing = { load, ensure, clear, state: () => st, can, campaigns, posts, templates, getPost, wallet, credits, open, create, save, saveSoon, flush, archive,
    upload, uploadTemplate, url, cachedUrl, blob, product, checkFile, generate, edit, write, schedule, move, caption, published, remove,
    addTemplate, editTemplate, removeTemplate, templateUsed, subscribe, unsubscribe, check, MAX_BYTES, MIME, BUCKET,
    _test: { toCampaign, toPost, toTemplate, fail, aiMessage, fieldsOf, tplRow } };
})();
