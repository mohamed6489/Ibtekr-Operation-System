// «التسويق» (phase 9.5.1, 0049, docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md). Loaded when the page opens (ensure()):
// the campaigns (the list's columns — a campaign's whole state only when it is opened), the schedule / publishing log (mkt_posts),
// the design templates and the wallet (mkt_credits), in the page's shapes (the v5's):
//   campaigns() [{ id, name, goal, step, scheduledAt, createdAt, updatedAt }] — not archived, the newest change first
//   posts()     [{ id, campaignId, piece, name, kind, pl, day, time, how, src: 'system' | 'platform', camp, status, caption, capOrig, tags,
//                  images, img, thumb, externalId, wasLive, url, publishedAt, delAt, views, reach, likes, comments, shares, saves, eng,
//                  statsAt, error, busy }]   (9.5.2: the platform's own posts, the numbers, a failure's code, a row being published)
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
// 9.5.2 (decisions 29–39): the publishing through the Edge Function mkt-publish — connection() (the link's state and the switch,
// a minute's cache), setAutopublish(on) (the admin), publishNow(id), deleteLive(id) (its activity_log rows are the server's) — and
// preparePublish(cid, items): the JPEG copies (<campaign>/pub-….jpg, Instagram's ratio with white margins) of the images of the
// items to publish, made in the browser before «تأكيد النشر».
(function () {
  'use strict';
  const CAMP_COLS = 'id, name, goal, step, scheduled_at, created_by, created_at, updated_at, archived_at';
  const OPEN_COLS = CAMP_COLS + ', state';
  const POST_COLS = 'id, campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, was_live, post_url, published_at, published_by, deleted_at, created_at, updated_at, '
    + 'src, external_id, thumb, thumb_path, views, reach, likes, comments, shares, saves, eng, stats_at, error, claimed_at'; // thumb_path: 0156
  const BUSY_MS = 5 * 60 * 1000; // a row the server claimed in the last five minutes is being published (0051 mkt_busy)
  const TPL_COLS = 'id, name, kind, image, descr, used, created_at, updated_at, deleted_at';
  const LIMIT = 500; const POST_LIMIT = 3000;
  const BUCKET = 'marketing'; const MAX_BYTES = 15 * 1024 * 1024; const MIME = ['image/png', 'image/jpeg', 'image/webp'];
  const SIGN_SECONDS = 600;
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const myUid = () => { const m = me(); return (m && m.id) || null; };
  const isAdmin = () => { const m = me(); return !!m && m.role_id === 'admin' && m.status === 'active'; };
  const can = () => ({ view: perm('marketing.view') !== 'N', create: perm('marketing.create') === 'F', publish: perm('marketing.publish') === 'F' });
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' || code === 'PGRST116' ? 'notfound' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fieldOf = (err) => { const m = /invalid: (\w+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };
  const MESSAGES = { stale: 'حد تاني عدّل الكامبين دي من شوية — تعديلاتك من ساعتها مااتحفظتش لسه', forbidden: 'مفيش صلاحية للإجراء ده', notfound: 'مش موجود أو اتحذف', network: 'تعذّر الاتصال — جرّب تاني', invalid: 'البيانات مش مظبوطة — راجعها' };
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
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const toPost = (r, names) => ({ id: Number(r.id), campaignId: r.campaign_id || null, piece: r.piece || null, name: r.name, kind: r.kind, pl: r.platform, day: r.day, time: r.time, how: r.how,
    src: r.src === 'platform' ? 'platform' : 'system', camp: (r.campaign_id && names.get(r.campaign_id)) || '—', status: r.status, caption: r.caption || '', capOrig: r.caption_orig || '', tags: r.tags || '',
    images: Array.isArray(r.images) ? r.images.filter((p) => typeof p === 'string') : [], img: (Array.isArray(r.images) ? r.images : []).find((p) => typeof p === 'string' && !/\.mp4$/i.test(p)) || null,
    video: (Array.isArray(r.images) ? r.images : []).find((p) => typeof p === 'string' && /\.mp4$/i.test(p)) || null, // 9.5.5: a reel's file
    thumb: typeof r.thumb === 'string' && /^https:\/\//.test(r.thumb) ? r.thumb : null, externalId: r.external_id || null,
    // the meeting of 23 Nov phase 8 (0156): the server's copy of the platform's picture in the bucket (Meta's link dies in days)
    thumbPath: typeof r.thumb_path === 'string' && /^platform\/(fb|ig)\/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$/.test(r.thumb_path) ? r.thumb_path : null,
    wasLive: !!r.was_live, url: typeof r.post_url === 'string' && /^https:\/\//.test(r.post_url) ? r.post_url : null, publishedAt: r.published_at || null, delAt: cairoDay(r.deleted_at), updatedAt: r.updated_at,
    views: num(r.views), reach: num(r.reach), likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), saves: num(r.saves), eng: num(r.eng),
    statsAt: r.stats_at || null, error: r.error || null, busy: !!r.claimed_at && Date.now() - Date.parse(r.claimed_at) < BUSY_MS });
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
      const camp = toCampaign(r); if (r.updated_at) seenC.set(camp.id, r.updated_at); data.campaigns = [camp].concat(data.campaigns.filter((x) => x.id !== camp.id)); emit();
      log('campaign.add', camp.goal || '', camp.id); return { ok: true, id: camp.id, campaign: camp };
    } catch (e) { return fail(e); }
  }
  async function open(id) {
    const cl = c(); if (!cl || !id) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: r, error } = await cl.from('mkt_campaigns').select(OPEN_COLS).eq('id', id).maybeSingle();
      if (error) return fail(error); if (!r || r.archived_at) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      if (r.updated_at) seenC.set(id, r.updated_at);
      return { ok: true, campaign: Object.assign(toCampaign(r), { state: r.state && typeof r.state === 'object' ? r.state : {} }) };
    } catch (e) { return fail(e); }
  }
  const chains = new Map(); // campaign id → its last save (the saves of a campaign go one after the other, the newest last)
  // «لسه زي ما أنا شايفه» (live-sync plan decision 6): campaign id → the stamp (updated_at) of the row the wizard was opened on / last
  // saved. A save is written only while the row still carries it; a teammate's save in between → 'stale' (nothing written) and an
  // `ib:marketing` event { stale: id, by } — the page asks: open theirs, or save mine over it (save(id, f, { force: true })).
  // A stamp moved by the server (Magnific results placed on the saved campaign keep the last saver) or by me elsewhere is mine:
  // the save goes on the new stamp. The autosave of a stale campaign stops writing until the member chooses.
  const seenC = new Map(); const staleC = new Set();
  const pend = new Map();   // campaign id → { timer, get } of saveSoon
  async function doSave(id, f, opts) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    const patch = fieldsOf(f); if (!Object.keys(patch).length) return { ok: true };
    const force = !!(opts && opts.force);
    if (force) staleC.delete(id); else if (staleC.has(id)) { quiet(() => document.dispatchEvent(new CustomEvent('ib:marketing', { detail: { stale: id, by: staleC.by && staleC.by[id] } }))); return { ok: false, reason: 'stale', message: MESSAGES.stale }; }
    try {
      const write = (stamp) => { let q = cl.from('mkt_campaigns').update(patch).eq('id', id); if (stamp) q = q.eq('updated_at', stamp); return q.select(CAMP_COLS); };
      let { data: r, error } = await write(force ? null : seenC.get(id));
      if (error) return fail(error);
      if ((!Array.isArray(r) || !r.length) && !force && seenC.has(id)) {
        const { data: now } = await cl.from('mkt_campaigns').select('id, updated_at, updated_by, archived_at').eq('id', id).maybeSingle();
        if (!now || now.archived_at) return { ok: false, reason: 'notfound', message: 'الكامبين دي اتحذفت أو مش متاحة' };
        if (now.updated_by && now.updated_by !== myUid()) {
          staleC.add(id); staleC.by = Object.assign(staleC.by || {}, { [id]: now.updated_by }); quiet(() => document.dispatchEvent(new CustomEvent('ib:marketing', { detail: { stale: id, by: now.updated_by } })));
          return { ok: false, reason: 'stale', message: MESSAGES.stale, by: now.updated_by };
        }
        ({ data: r, error } = await write(now.updated_at)); if (error) return fail(error);
      }
      if (!Array.isArray(r) || !r.length) return { ok: false, reason: 'notfound', message: 'الكامبين دي اتحذفت أو مش متاحة' };
      if (r[0].updated_at) seenC.set(id, r[0].updated_at);
      const camp = toCampaign(r[0]); const i = data.campaigns.findIndex((x) => x.id === id);
      const before = i >= 0 ? data.campaigns[i] : null;
      if (i >= 0) data.campaigns[i] = camp; else data.campaigns.unshift(camp);
      data.campaigns.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      if (before && before.name !== camp.name) reshape();
      if (before && before.step !== camp.step) log('campaign.step', before.step + ' → ' + camp.step, id);
      return { ok: true, campaign: camp };
    } catch (e) { return fail(e); }
  }
  // the member opened the teammate's copy: no stale mark, no pending autosave of the old one (open() takes the new stamp)
  function forget(id) { staleC.delete(id); const p = pend.get(id); if (p && p.timer) clearTimeout(p.timer); pend.delete(id); }
  function save(id, f, opts) {
    if (!can().create) return Promise.resolve({ ok: false, reason: 'forbidden', message: MESSAGES.forbidden });
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(() => doSave(id, f, opts), () => doSave(id, f, opts));
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
  async function url(path, fresh) {
    const cl = c(); if (!cl || !path) return null;
    const hit = urls.get(path); if (!fresh && hit && hit.until > Date.now()) return hit.url;
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
      const q = () => cl.from('products').select('id, name, sku, image_url, lang');
      const { data: r, error } = k.sku ? await q().eq('sku', k.sku).limit(1) : await q().in('permalink', k.permalinks).limit(1);
      if (error) return fail(error);
      let p = Array.isArray(r) && r[0];
      // not the exact link (another host — the live site against the staging mirror): the product path (/product/<slug>) on any host,
      // the English row first (the mirror holds the Arabic translation too)
      for (const path of (!p && k.paths) || []) {
        const like = '%' + path.replace(/[\\%_]/g, (c) => '\\' + c);
        const { data: r2, error: e2 } = await q().like('permalink', like + '/').limit(4);
        if (e2) return fail(e2);
        const rows = Array.isArray(r2) ? r2 : []; p = rows.find((x) => x.lang !== 'ar') || rows[0];
        if (p) break;
      }
      if (!p) return no;
      return { ok: true, product: { id: Number(p.id), name: p.name || p.sku || '#' + p.id, sku: p.sku || '', image: p.image_url || null } };
    } catch (e) { return fail(e); }
  }

  // any other public link (the owner 15 Nov — «السيستم مش قابل اي لينكات»): the server (ai-images ref_link) fetches its image — the
  // link itself or the picture its page names (a Pinterest pin …) — under the SSRF rules and keeps it in the campaign's folder
  const REF_MESSAGES = { url: 'اللينك لازم يبدأ بـ https:// ويكون لموقع عام', blocked: 'اللينك ده مش مسموح — نزّل الصورة وارفعها',
    not_image: 'مالقيناش صورة في اللينك ده — نزّل الصورة وارفعها', too_big: 'الصورة اللي في اللينك أكبر من 12 ميجا', unreachable: 'الموقع ده ماردش — جرّب تاني أو نزّل الصورة وارفعها' };
  async function refLink(campaignId, link) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!campaignId) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    const u = String(link == null ? '' : link).trim();
    if (!/^https:\/\/[^\s]+$/i.test(u) || u.length > 2000) return { ok: false, reason: 'invalid', field: 'url', message: REF_MESSAGES.url };
    const r = await invoke('ai-images', { action: 'ref_link', campaign_id: campaignId, url: u });
    if (!r.ok) {
      const k = r.field === 'url' ? 'url' : r.code && REF_MESSAGES[r.code] ? r.code : null;
      return Object.assign(r, { message: k ? REF_MESSAGES[k] : r.reason === 'notfound' ? 'الكامبين دي اتمسحت — افتحها من «آخر الشغل»' : r.reason === 'forbidden' ? MESSAGES.forbidden : REF_MESSAGES.unreachable });
    }
    const b = r.body || {};
    if (typeof b.path !== 'string' || b.path.indexOf(campaignId + '/') !== 0) return { ok: false, reason: 'network', message: REF_MESSAGES.unreachable };
    return { ok: true, path: b.path, name: clean(b.name, 120) || 'لينك' };
  }

  // ---------- the AI (decisions 8–10) ----------
  async function invoke(fn, body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: d, error } = await cl.functions.invoke(fn, { body });
      if (error || !d) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const reason = s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'notfound' : s === 402 ? 'ai_cap' : s === 429 ? 'busy' : s === 503 ? 'not_configured' : s === 502 ? 'ai_error' : s === 409 ? 'conflict' : 'network';
        return { ok: false, reason, field: b && b.field ? String(b.field) : null, status: b && Number.isInteger(b.status) ? b.status : null, configured: b && typeof b.configured === 'boolean' ? b.configured : null,
          code: b && typeof b.error === 'string' ? b.error.slice(0, 60) : null, text: b && typeof b.text === 'string' ? b.text.slice(0, 200) : null };
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
  // ---------- the campaign's images on Magnific (comments decision 52 — the owner 15 Nov: «عايز ابعت الصور لmagnific او ابعت الprompt
  // اللي يتعملي بيه صورة … و كمان زرار استلم بيه الصور من magnific») ----------
  // The server (ai-images bridge_campaign) builds one flow on the linked account's Space: a generator an image of the campaign with
  // the very prompt the credits path sends and its reference photos; generating there is the account's own, no credit of ours.
  // bridge_campaign_fetch brings the newest result of each generator into the campaign's folder — the page puts it on the piece.
  const MG_MESSAGES = { not_linked: 'حساب Magnific مش مربوط — الأدمن بيربطه من «الإعدادات › الربط بالمنصات»', nothing: 'مفيش قطع صور تتبعت — كمّل «التفاصيل» الأول (والفيديو محتاج «توليد المشاهد»)',
    no_flow: 'ابعت القطع لـ Magnific الأول', busy: 'Magnific مشغول دلوقتي — استنى دقيقة وجرّب تاني', refused: 'Magnific رفض الطلب — جرّب تاني', mcp_error: 'Magnific ماردش زي المتوقع — جرّب تاني' };
  const mgMessage = (r) => (r.reason === 'forbidden' ? MESSAGES.forbidden : r.reason === 'notfound' ? 'الكامبين دي اتمسحت — افتحها من «آخر الشغل»' : r.reason === 'network' ? 'تعذّر الاتصال — جرّب تاني'
    : (r.code && MG_MESSAGES[r.code]) || (r.reason === 'not_configured' ? MG_MESSAGES.not_linked : r.reason === 'busy' ? MG_MESSAGES.busy : MG_MESSAGES.mcp_error));
  const httpsOf = (v) => (typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v) ? v : null);
  async function magnificStatus() {
    const r = await invoke('ai-images', { action: 'bridge_status' });
    return r.ok ? { ok: true, linked: !!(r.body && r.body.linked) } : { ok: false, linked: false };
  }
  // Safwat 24 Nov: the generators run on the site at once unless opts.run === false (the member runs them by hand); a send again
  // replaces the campaign's panel; the link opens the Space on it
  async function magnificSend(cid, opts) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!cid) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    await flush(cid); // the server reads the pieces as saved
    const r = await invoke('ai-images', { action: 'bridge_campaign', campaign_id: cid, run: !(opts && opts.run === false) });
    if (!r.ok) return Object.assign(r, { message: mgMessage(r) });
    const b = r.body || {}; const n = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    log('magnific.send', n(b.targets) + ' images · ' + n(b.uploaded) + ' photos', cid);
    return { ok: true, url: httpsOf(b.url), targets: n(b.targets), ran: n(b.ran), refs: n(b.refs), uploaded: n(b.uploaded), left: n(b.left) };
  }
  async function magnificFetch(cid) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!cid) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    await flush(cid);
    const r = await invoke('ai-images', { action: 'bridge_campaign_fetch', campaign_id: cid });
    if (!r.ok) return Object.assign(r, { message: mgMessage(r) });
    const b = r.body || {}; const n = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    // a path of this campaign's own folder only, on a piece named like one
    const placed = (Array.isArray(b.placed) ? b.placed : []).filter((x) => x && typeof x.piece === 'string' && /^[A-Z][0-9]{1,2}$/.test(x.piece) && typeof x.path === 'string' && x.path.indexOf(cid + '/') === 0 && (x.slide == null || Number.isInteger(x.slide)))
      .map((x) => ({ piece: x.piece, slide: x.slide == null ? null : x.slide, path: x.path }));
    log('magnific.fetch', placed.length + ' images', cid);
    return { ok: true, placed, found: n(b.found), failed: n(b.failed), offhost: n(b.offhost) };
  }
  const edit = (cid, a) => { const x = a || {}; const pins = (Array.isArray(x.pins) ? x.pins : []).filter((p) => p && String(p.text || '').trim()).slice(0, 10)
    .map((p) => ({ x: Math.max(0, Math.min(100, Math.round(Number(p.x) || 0))), y: Math.max(0, Math.min(100, Math.round(Number(p.y) || 0))), text: clean(p.text, 200) }));
    return imageCall('campaign_edit', cid, x, { note: clean(x.note, 500), pins }); };
  // the AI writing (decision 10): fill (a piece's fields) · rewrite (one field) · describe (a template's image)
  async function write(cid, a) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const x = a || {}; if (cid) await flush(cid);
    const body = { action: 'marketing', task: x.task, campaign_id: cid || undefined, piece: x.piece || undefined, slide: x.slide == null ? undefined : Number(x.slide), kind: x.kind || undefined,
      text: typeof x.text === 'string' ? x.text.slice(0, 3000) : undefined, image: x.image || undefined, voice: x.task === 'scenes' ? x.voice === true : undefined,
      notes: clean(x.notes, 500) || undefined }; // the member's instructions from the popup (IBAIAsk, the owner 15 Nov) — never logged
    const r = await invoke('ai-content', body);
    if (!r.ok) return Object.assign(r, { message: aiMessage(r, 'text') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    log('ai.' + (x.task || 'write'), x.kind || where(x), cid || null);
    return { ok: true, fields: b.fields && typeof b.fields === 'object' ? b.fields : null, text: typeof b.text === 'string' ? b.text : null,
      scenes: Array.isArray(b.scenes) ? b.scenes : null, voice: x.task === 'scenes' && typeof b.voice === 'string' ? b.voice : null };
  }

  // ---------- the video (9.5.5, decisions 57–64): the bridge's jobs through ai-images; the page polls while a piece has open jobs ----------
  const VIDEO_WHY = { not_linked: 'اربط حساب Magnific الأول من «إعدادات الصور» في المنتجات', busy_piece: 'فيه مهام لسه شغالة على الفيديو ده — استنى تخلص', clips: 'ولّد كل المشاهد الأول',
    image: 'ولّد صورة المشهد الأول', scenes: 'وزّع المشاهد الأول', scene: 'المشهد ده مش موجود', piece: 'القطعة دي مش فيديو — احفظ وجرّب تاني', text: 'اكتب نص الفويس أوفر', voice: 'اختار الصوت', type: 'اختار نوع الموسيقى', path: 'الملف مش مرفوع', role: 'نوع الملف مش معروف' };
  const videoMessage = (r) => (r.reason === 'not_configured' ? (r.code === 'not_linked' ? VIDEO_WHY.not_linked : 'الجسر لـ Magnific مش متوصّل') : r.reason === 'conflict' ? (VIDEO_WHY[r.code] || 'الفيديو مشغول دلوقتي — جرّب كمان شوية')
    : r.reason === 'invalid' ? (VIDEO_WHY[r.field] || MESSAGES.invalid) : r.reason === 'busy' ? 'طلبات كتير في وقت قصير — استنى دقيقة وجرّب تاني' : r.reason === 'forbidden' ? MESSAGES.forbidden : r.reason === 'notfound' ? MESSAGES.notfound : r.reason === 'ai_error' ? 'Magnific ماردش — جرّب تاني' : MESSAGES.network);
  const toJob = (j) => (j && typeof j === 'object' ? { id: Number(j.id), kind: String(j.kind || ''), scene: j.scene == null ? null : Number(j.scene), status: String(j.status || ''), ref: j.ref || null, path: typeof j.path === 'string' ? j.path : null, bytes: j.bytes == null ? null : Number(j.bytes), error: j.error || null, data: j.data && typeof j.data === 'object' ? j.data : {}, createdAt: j.createdAt || null, doneAt: j.doneAt || null } : null);
  async function videoCall(action, cid, piece, extra, logAs) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!cid) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    await flush(cid);
    const r = await invoke('ai-images', Object.assign({ action, campaign_id: cid, piece }, extra || {}));
    if (!r.ok) { if (logAs) log('video.' + logAs, piece + ' · ' + (r.code || r.reason), cid); return Object.assign(r, { message: videoMessage(r) }); }
    const b = r.body || {};
    if (logAs) log('video.' + logAs, piece + (extra && extra.scene != null ? ' · s' + (extra.scene + 1) : '') + (b.job && b.job.kind ? ' · ' + b.job.kind : ''), cid);
    return { ok: true, job: toJob(b.job), jobs: Array.isArray(b.jobs) ? b.jobs.map(toJob).filter(Boolean) : null, open: Number(b.open) || 0, final: toJob(b.final) };
  }
  const videoClip = (cid, piece, scene) => videoCall('video_clip', cid, piece, scene == null ? {} : { scene: Number(scene) }, 'clip');
  const videoVoice = (cid, piece, a) => videoCall('video_voice', cid, piece, { voice: (a || {}).voice, text: clean((a || {}).text, 1500) }, 'voice');
  const videoMusic = (cid, piece, type) => videoCall('video_music', cid, piece, { type }, 'music');
  const videoAssemble = (cid, piece) => videoCall('video_assemble', cid, piece, {}, 'assemble');
  const videoPoll = (cid, piece) => videoCall('video_poll', cid, piece, {}, null);
  // a member's own audio (voice-over or music) into the campaign's folder, then onto Magnific as a done upload job
  const AUDIO_MIME = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
  const MAX_AUDIO = 50 * 1024 * 1024;
  async function videoUpload(cid, piece, file, role) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!cid) return { ok: false, reason: 'invalid', message: 'احفظ الكامبين الأول' };
    if (!file || typeof file.size !== 'number' || !AUDIO_MIME[file.type]) return { ok: false, reason: 'invalid', field: 'type', message: 'ارفع ملف صوت (MP3 / M4A / WAV)' };
    if (file.size > MAX_AUDIO) return { ok: false, reason: 'invalid', field: 'size', message: 'الملف أكبر من 50 ميجا' };
    const put1 = await put(cid + '/vid-' + piece + '-up' + Math.floor(Math.random() * 90 + 10) + '-' + rand() + '.' + AUDIO_MIME[file.type], file, file.name);
    if (!put1.ok) return put1;
    return videoCall('video_upload', cid, piece, { path: put1.path, role }, 'upload');
  }
  // the scenes written by Claude (decision 59) — the campaign's own AI budget, no credit
  async function videoScenes(cid, piece, voice, notes) { const r = await write(cid, { task: 'scenes', piece, voice: voice === true, notes }); return r.ok ? { ok: true, scenes: r.scenes || [], voice: r.voice || '' } : r; }

  // ---------- the schedule and the log (decisions 14–16) ----------
  // opts.keep (0122, the owner 17 Nov — «تأكيد النشر» schedules the picked pieces only): the other pieces' rows stay as they are
  async function schedule(cid, items, opts) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().publish) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    await flush(cid);
    try {
      const args = { p_campaign: cid, p_items: items }; if (opts && opts.keep) args.p_keep = true;
      const { data: n, error } = await cl.rpc('mkt_schedule', args); if (error) return fail(error);
      const pls = [...new Set((items || []).map((x) => x.platform))].join(', ');
      const pub = (items || []).filter((x) => x.how === 'publish').length;
      log('campaign.schedule', (items || []).length + ' posts · ' + pls + (pub ? ' · ' + pub + ' publish' : ''), cid);
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
        if (action === 'move') Object.assign(p, { day: args.day, time: args.time, status: p.status === 'متوقف' ? 'متوقف' : 'مجدول' });
        else if (action === 'pause') Object.assign(p, { status: 'متوقف' });
        else if (action === 'resume') Object.assign(p, { status: 'مجدول', error: null });
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
  // the owner 17 Nov (0122): «وقف نشر» — stays in the plan, never published until «كمّل النشر» (its time must still be ahead)
  const pause = (id) => postAct(id, 'pause', {});
  const resume = (id) => postAct(id, 'resume', {});

  // ---------- publishing (9.5.2, decisions 29–39) ----------
  let conn = null; let connAt = 0; const CONN_MS = 60000;
  const plat = (x) => ({ linked: !!(x && x.linked), name: x && typeof x.name === 'string' ? x.name : null, publish: !!(x && x.publish), insights: !!(x && x.insights) });
  // the link's state and the switch (mkt-publish status): { autopublish, facebook, instagram, missing, valid, configured }
  async function connection(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && conn && Date.now() - connAt < CONN_MS) return { ok: true, conn };
    const r = await invoke('mkt-publish', { action: 'status' });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : 'تعذّر قراية حالة الربط — جرّب تاني' });
    const b = r.body || {};
    conn = { autopublish: b.autopublish === true, facebook: plat(b.facebook), instagram: plat(b.instagram), missing: Array.isArray(b.missing) ? b.missing.filter((x) => typeof x === 'string') : null,
      valid: typeof b.valid === 'boolean' ? b.valid : null, configured: b.configured !== false };
    connAt = Date.now(); emit(); return { ok: true, conn };
  }
  const connNow = () => conn;
  const W = () => window.IbtekrCampWiz || {};
  const PUB_MESSAGES = { status: 'البوست ده مش مستني النشر', off: 'النشر التلقائي متوقف — الأدمن يشغّله من كارت الربط', busy: 'البوست بيتنشر دلوقتي — استنى دقيقة', not_linked: 'الصفحة مش مربوطة' };
  function pubMessage(r) {
    if (r.code && PUB_MESSAGES[r.code]) return PUB_MESSAGES[r.code];
    if (r.code && W().pubError) return W().pubError(r.code);
    return r.reason === 'forbidden' ? MESSAGES.forbidden : r.reason === 'notfound' ? MESSAGES.notfound : MESSAGES.network;
  }
  // the switch (decision 31): the admin
  async function setAutopublish(on) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-publish', { action: 'autopublish', on: !!on });
    if (!r.ok) return Object.assign(r, { message: pubMessage(r) });
    if (conn) conn.autopublish = !!on; emit(); return { ok: true, autopublish: !!on };
  }
  // «انشر دلوقتي» (decision 35): { ok, url } · { ok, pending } (Instagram still preparing) · { ok: false, code, message }
  async function publishNow(id) {
    if (!can().publish) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-publish', { action: 'publish_now', id: Number(id) });
    if (!r.ok) { await load(); return Object.assign(r, { message: pubMessage(r) }); }
    const b = r.body || {};
    await load();
    return b.result === 'pending' ? { ok: true, pending: true } : { ok: true, url: typeof b.url === 'string' ? b.url : null };
  }
  // «احذف البوست» for a live post with its platform id: removed on the platform, then «اتحذف»
  async function deleteLive(id) {
    if (!can().publish) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-publish', { action: 'delete', id: Number(id) });
    if (!r.ok) return Object.assign(r, { message: pubMessage(r) });
    const p = getPost(id); if (p) Object.assign(p, { status: 'اتحذف', wasLive: true, delAt: cairoDay(new Date().toISOString()) });
    emit(); await load(); return { ok: true };
  }
  // the JPEG copies (decision 33): every image of an item to publish on Facebook / Instagram as <campaign>/pub-….jpg (0.92, the long
  // side ≤ 2160; Instagram's feed ratio with white margins up to 10%) — one copy per image and margin; a JPEG that fits as it is stays
  async function decode(b) {
    if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(b); } catch (e) { /* the <img> way */ } }
    return new Promise((res) => { const u = URL.createObjectURL(b); const im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); res(null); }; im.src = u; });
  }
  async function jpegOf(cid, path, img, pad) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight; const s = W().jpegSize(w, h, pad);
    if (!pad && s.k === 1 && W().isJpeg(path)) return { ok: true, path };
    const cv = document.createElement('canvas'); cv.width = s.w; cv.height = s.h;
    const g = cv.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, s.w, s.h);
    const dw = Math.round(w * s.k), dh = Math.round(h * s.k); g.drawImage(img, Math.round((s.w - dw) / 2), Math.round((s.h - dh) / 2), dw, dh);
    const out = await new Promise((res) => { try { cv.toBlob(res, 'image/jpeg', 0.92); } catch (e) { res(null); } });
    if (!out) return { ok: false, why: 'المتصفح ماقدرش يجهّز الصورة' };
    const r = await put(cid + '/pub-' + rand() + '.jpg', new File([out], 'pub.jpg', { type: 'image/jpeg' }), 'pub.jpg');
    return r.ok ? { ok: true, path: r.path } : { ok: false, why: r.message };
  }
  async function preparePublish(cid, items, onStep) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden, items: items || [] };
    const decoded = new Map(); const copies = new Map(); const problems = []; const out = [];
    const total = (items || []).filter((it) => it.how === 'publish').reduce((s, it) => s + (it.images || []).length, 0); let n = 0;
    for (const it of items || []) {
      if (it.how !== 'publish' || it.kind === 'ريل') { out.push(it); continue; } // a reel goes as its MP4 (9.5.5) — no copies
      const ig = it.platform === 'انستجرام'; const imgs = [];
      for (const p of it.images || []) {
        if (!decoded.has(p)) { const b = await blob(p); decoded.set(p, b.ok ? await decode(b.blob) : null); }
        const img = decoded.get(p); n += 1; if (onStep) quiet(() => onStep(n, total));
        if (!img) { problems.push({ piece: it.piece, platform: it.platform, why: 'صورة القطعة مش موجودة أو مااتقريتش' }); break; }
        const fit = ig ? W().igFit(img.width || img.naturalWidth, img.height || img.naturalHeight, it.kind) : { ok: true, pad: null };
        if (!fit.ok) { problems.push({ piece: it.piece, platform: it.platform, why: fit.why }); break; }
        const key = p + '|' + (fit.pad ? fit.pad.w + 'x' + fit.pad.h : '-');
        if (!copies.has(key)) copies.set(key, await jpegOf(cid, p, img, fit.pad));
        const c2 = copies.get(key); if (!c2.ok) { problems.push({ piece: it.piece, platform: it.platform, why: c2.why }); break; }
        imgs.push(c2.path);
      }
      out.push(imgs.length === (it.images || []).length ? Object.assign({}, it, { images: imgs }) : it);
    }
    return problems.length ? { ok: false, problems, items: out, message: problems.map((x) => x.piece + ' · ' + x.platform + ': ' + x.why).join(' — ') } : { ok: true, items: out };
  }

  // ---------- the ads numbers (9.5.3, decisions 43–46): Meta's own numbers (mkt-ads) next to WooCommerce's ad orders ----------
  const AD_NAMES = { meta: 'ميتا', tiktok: 'تيك توك', google: 'جوجل' };
  const ADS_PLATFORMS = ['meta', 'tiktok', 'google'];
  // our codes in words, per platform (9.5.6: the platform's own words — the function sends them cleaned, 200 characters — are added for a code we have no message for)
  const ADS_MESSAGES = (n) => ({ not_configured: 'مفيش منصة إعلانات مربوطة — الأدمن يربط الحسابات من «حالة الربط»',
    token: 'مفتاح إعلانات ' + n + ' انتهى أو اتلغى — الأدمن يربط الحساب تاني من «حالة الربط»', permission: 'المفتاح مالوش صلاحية قراية حساب الإعلانات على ' + n,
    rate: n + ' بتقول استنى شوية — المزامنة الجاية هتكمّل', timeout: n + ' ماردتش في الوقت — المزامنة الجاية هتكمّل', no_vault: 'الـ Vault مش متاح على السيرفر — مش هينفع نحفظ بيانات الربط',
    no_refresh_token: 'جوجل ماادّاش مفتاح تجديد — شيل التطبيق من حساب جوجل واربط تاني', no_account: 'الحساب اللي سجّلت بيه مالوش حساب إعلانات', no_token: n + ' مارجّعتش توكن — جرّب الربط تاني' });
  const adsWhy = (code, text, platform) => { const n = AD_NAMES[platform] || 'ميتا'; const M = ADS_MESSAGES(n); return code ? (M[code] || n + ' رفضت (' + String(code).slice(0, 40) + ')') + (!M[code] && typeof text === 'string' && text ? ' — ' + text.slice(0, 200) : '') : null; };
  let ads = null; let adsAt = 0; const adsCache = new Map(); const ADS_MS = 60000;
  const str = (v) => (typeof v === 'string' ? v : null);
  const toAccount = (a) => (a && typeof a === 'object' ? { id: a.id == null ? null : String(a.id), name: str(a.name), currency: str(a.currency), status: str(a.status) } : null);
  // one platform of the status: never a secret (the server sends a tail); configured = a run can read it
  const toPlatform = (k, p) => { const x = p && typeof p === 'object' ? p : {}; const fields = {}; if (x.fields && typeof x.fields === 'object') for (const [a, b] of Object.entries(x.fields)) if (typeof b === 'string') fields[a] = b;
    return { key: k, name: AD_NAMES[k], configured: x.configured === true, oauth: x.oauth === true, fields, missing: Array.isArray(x.missing) ? x.missing.filter((m) => typeof m === 'string') : [], account: toAccount(x.account),
      syncedAt: str(x.synced_at), checkedAt: str(x.checked_at), error: str(x.error), why: adsWhy(str(x.error), x.text, k), linkedAt: str(x.linked_at), version: str(x.version),
      candidates: Array.isArray(x.candidates) ? x.candidates.filter((c) => c && typeof c === 'object' && c.id != null).map((c) => ({ id: String(c.id), name: str(c.name) })) : null }; };
  // the ads links (mkt-ads status): Meta's old fields + platforms { meta, tiktok, google } (9.5.6) + the redirect the owner registers on the apps
  async function adsStatus(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && ads && Date.now() - adsAt < CONN_MS) return { ok: true, ads };
    const r = await invoke('mkt-ads', { action: 'status' });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : 'تعذّر قراية حالة الإعلانات — جرّب تاني' });
    const b = r.body || {}; const P = b.platforms && typeof b.platforms === 'object' ? b.platforms : {};
    const platforms = {}; for (const k of ADS_PLATFORMS) platforms[k] = toPlatform(k, P[k]);
    const m = platforms.meta; const legacy = !P.meta; // a server before 9.5.6: Meta's fields at the top only
    if (legacy) Object.assign(m, { configured: b.configured === true, account: toAccount(b.account), syncedAt: str(b.synced_at), checkedAt: str(b.checked_at), error: str(b.error), why: adsWhy(str(b.error), b.text, 'meta') });
    const linked = ADS_PLATFORMS.filter((k) => platforms[k].configured);
    ads = { configured: linked.length > 0, account: m.account, syncedAt: m.syncedAt, checkedAt: m.checkedAt, error: m.error, why: m.why, platforms, linked, redirect: str(b.redirect),
      anyError: ADS_PLATFORMS.find((k) => platforms[k].configured && platforms[k].error) || null };
    adsAt = Date.now(); emit(); return { ok: true, ads };
  }
  const adsNow = () => ads;
  // «مزامنة دلوقتي» (the admin): the last 3 days (or `days`) read from every linked platform (or one) now
  async function adsSync(days, platform) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-ads', Object.assign({ action: 'sync' }, days ? { days: Number(days) } : {}, platform ? { platform } : {}));
    adsCache.clear(); await adsStatus(true);
    if (!r.ok) return Object.assign(r, { message: r.reason === 'not_configured' ? ADS_MESSAGES('').not_configured : r.reason === 'forbidden' ? MESSAGES.forbidden : adsWhy(r.code, r.text, (r.body && r.body.platform) || platform || 'meta') || MESSAGES.network });
    const b = r.body || {}; return { ok: true, days: Number(b.days) || 0, campaigns: Number(b.campaigns) || 0, ads: Number(b.ads) || 0, stats: Number(b.stats) || 0, platforms: b.platforms && typeof b.platforms === 'object' ? b.platforms : {} };
  }
  // 9.5.6 (decisions 67 / 68): the admin's link of a platform — the fields into Vault, the OAuth start / pick, the unlink; the status is reread after each
  const LINK_WHY = { platform: 'المنصة مش معروفة', oauth: 'بيانات التطبيق ناقصة — اكتب App ID والـ Secret (أو Client ID والـ Secret والـ developer token) الأول', fields: 'مفيش حاجة اتكتبت', account: 'الحساب ده مش من اللي المنصة عرضتهم', state: 'انتهت صلاحية الربط (10 دقايق) — جرّب تاني', code: 'الكود مش مظبوط' };
  const linkFail = (r, platform) => Object.assign(r, { message: r.reason === 'forbidden' ? 'الأدمن بس يقدر يربط حسابات الإعلانات' : r.reason === 'invalid' ? (LINK_WHY[r.field] || 'الخانة «' + (r.field || '') + '» مش مظبوطة') : r.reason === 'not_configured' ? adsWhy(r.code || 'no_vault', null, platform) : adsWhy(r.code, r.text, platform) || MESSAGES.network });
  async function adsLinkSet(platform, fields) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'الأدمن بس يقدر يربط حسابات الإعلانات' };
    const r = await invoke('mkt-ads', { action: 'link_set', platform, fields: fields && typeof fields === 'object' ? fields : {} });
    if (!r.ok) return linkFail(r, platform);
    adsCache.clear(); await adsStatus(true); log('ads.link', platform + ' · set', null);
    return { ok: true, platform: toPlatform(platform, r.body) };
  }
  async function adsLinkStart(platform) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'الأدمن بس يقدر يربط حسابات الإعلانات' };
    const r = await invoke('mkt-ads', { action: 'link_start', platform });
    if (!r.ok) return linkFail(r, platform);
    const u = r.body && typeof r.body.url === 'string' && /^https:\/\//.test(r.body.url) ? r.body.url : null;
    return u ? { ok: true, url: u } : { ok: false, reason: 'network', message: MESSAGES.network };
  }
  async function adsLinkPick(platform, account) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'الأدمن بس يقدر يربط حسابات الإعلانات' };
    const r = await invoke('mkt-ads', { action: 'link_pick', platform, account: String(account || '') });
    if (!r.ok) return linkFail(r, platform);
    adsCache.clear(); await adsStatus(true); return { ok: true, platform: toPlatform(platform, r.body) };
  }
  async function adsUnlink(platform) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'الأدمن بس يقدر يربط حسابات الإعلانات' };
    const r = await invoke('mkt-ads', { action: 'unlink', platform });
    if (!r.ok) return linkFail(r, platform);
    adsCache.clear(); await adsStatus(true); log('ads.link', platform + ' · unlink', null);
    return { ok: true, platform: toPlatform(platform, r.body) };
  }
  // every row of a read, a thousand at a time (the API's page)
  async function allRows(make) {
    const out = [];
    for (let i = 0; i < 50; i += 1) {
      const { data: d, error } = await make().range(i * 1000, i * 1000 + 999);
      if (error) throw error;
      const rows = Array.isArray(d) ? d : []; out.push(...rows); if (rows.length < 1000) break;
    }
    return out;
  }
  const n0x = (v) => (v == null || v === '' ? null : Number(v));
  const OBJ_COLS = 'platform, kind, id, parent_id, name, status, thumb, thumb_path, meta, updated_at'; // thumb_path: 0156
  const STAT_COLS = 'level, object_id, campaign_id, day, spend, impressions, reach, clicks, link_clicks, frequency, purchases, purchase_value';
  // a period's numbers + the 5 weeks before its end (the trend), at most 400 days: Meta's objects and daily numbers and the ad orders
  async function adsData(range) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const day = /^\d{4}-\d{2}-\d{2}$/; const to = range && range.to; const f0 = range && range.from;
    if (!day.test(String(to)) || !day.test(String(f0)) || f0 > to) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    const addD = W().addD; let from = [f0, addD(to, -34)].sort()[0]; if (from < addD(to, -400)) from = addD(to, -400);
    const key = from + '|' + to; const hit = adsCache.get(key); if (hit && Date.now() - hit.at < ADS_MS) return hit.r;
    try {
      const [objects, stats, orders] = await Promise.all([
        allRows(() => cl.from('mkt_ad_objects').select(OBJ_COLS).order('id')),
        allRows(() => cl.from('mkt_ad_stats').select('platform, ' + STAT_COLS).gte('day', from).lte('day', to).order('day')),
        allRows(() => cl.rpc('mkt_ads_orders', { p_from: from, p_to: to })),
      ]);
      const r = { ok: true, from, to,
        objects: objects.map((o) => ({ platform: o.platform || 'meta', kind: o.kind, id: String(o.id), parent_id: o.parent_id || null, name: o.name || null, status: o.status || null,
          thumb: typeof o.thumb === 'string' && /^https:\/\//.test(o.thumb) ? o.thumb : null, thumbPath: typeof o.thumb_path === 'string' && /^ads\/[a-z]{1,20}\/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$/.test(o.thumb_path) ? o.thumb_path : null, meta: o.meta && typeof o.meta === 'object' ? o.meta : {}, updatedAt: o.updated_at || null })),
        stats: stats.map((s) => ({ platform: s.platform || 'meta', level: s.level, object_id: String(s.object_id), campaign_id: String(s.campaign_id), day: s.day, spend: n0x(s.spend) || 0, impressions: n0x(s.impressions) || 0,
          reach: n0x(s.reach), clicks: n0x(s.clicks) || 0, link_clicks: n0x(s.link_clicks), frequency: n0x(s.frequency), purchases: n0x(s.purchases) || 0, purchase_value: n0x(s.purchase_value) || 0 })),
        orders: orders.map((o) => ({ day: o.day, platform: o.platform, source: o.source || '', campaign: o.campaign || '', grp: o.grp, orders: n0x(o.orders) || 0, sales: n0x(o.sales) || 0, share: n0x(o.share) })) };
      adsCache.set(key, { at: Date.now(), r }); return r;
    } catch (e) { return fail(e); }
  }

  // the newest ads read already in memory (the names of the campaigns for the buyer's confirm card — ش45); null before any read
  const adsDataNow = () => { let best = null; for (const v of adsCache.values()) if (!best || v.at > best.at) best = v; return best ? best.r : null; };

  // ---------- the media buyer (phase 9.5.4, decisions 49–56) ----------
  // the suggestions the server wrote after each sync, the admin's decisions through mkt-ads (the switch off = recorded only),
  // the rules and the execution switch, the designer / developer requests, and the buyer's chat (text only — nothing runs from it)
  const SUGG_COLS = 'id, platform, kind, campaign_id, campaign_name, ad_id, title, sub, why, impact, pct, data, status, created_at, checked_at, decided_by, decided_at, value, note, result, error';
  const SUGG_KINDS = ['stop', 'budget_down', 'budget_up', 'creative', 'tracking']; const SUGG_STATUS = ['pending', 'approved', 'edited', 'rejected', 'done', 'failed', 'expired'];
  const SUGG_MS = 60000; let sugg = null; let suggAt = 0;
  const toSuggestion = (r) => ({ id: Number(r.id), platform: ['meta', 'tiktok', 'google'].includes(r.platform) ? r.platform : 'meta', kind: SUGG_KINDS.includes(r.kind) ? r.kind : 'tracking', campaign_id: String(r.campaign_id || ''), campaign_name: r.campaign_name || null, ad_id: r.ad_id == null ? null : String(r.ad_id),
    title: r.title || '', sub: r.sub || '', why: r.why || '', impact: r.impact || '', pct: r.pct == null ? null : Number(r.pct), data: r.data && typeof r.data === 'object' ? r.data : {},
    status: SUGG_STATUS.includes(r.status) ? r.status : 'pending', createdAt: r.created_at || null, checkedAt: r.checked_at || null, decidedBy: r.decided_by || null, decidedAt: r.decided_at || null,
    value: r.value == null ? null : Number(r.value), note: r.note || '', result: r.result && typeof r.result === 'object' ? r.result : null, error: r.error || null });
  // the open suggestions + the decided ones of the last 30 days (newest first), cached a minute
  async function suggestions(force) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && sugg && Date.now() - suggAt < SUGG_MS) return { ok: true, items: sugg };
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: r, error } = await cl.from('mkt_suggestions').select(SUGG_COLS).or('status.eq.pending,created_at.gte.' + since).order('created_at', { ascending: false }).limit(500);
      if (error) return fail(error);
      sugg = (Array.isArray(r) ? r : []).map(toSuggestion); suggAt = Date.now(); return { ok: true, items: sugg };
    } catch (e) { return fail(e); }
  }
  const suggNow = () => sugg || [];
  const DECIDE_MESSAGES = { step: 'الخطوة أكبر من 30% — الحد الأقصى في المرة الواحدة', cap: 'التغيير ده هيعدّي السقف اليومي للحساب — زوّد السقف في «القواعد والحدود» أو قلّل النسبة', no_daily_budget: 'الحملة مالهاش ميزانية يومية (لا هي ولا مجموعاتها الشغالة) — غيّرها من مدير إعلانات ميتا',
    decided: 'الاقتراح ده اتقرر فيه قبل كده', value: 'النسبة لازم تبقى بنفس اتجاه الاقتراح (زيادة أو تقليل) ومن غير ما تعدّي 30%' };
  // ارفض / وافق ونفّذ / عدّل ونفّذ (the admin): value = the edited step, note = why
  async function decide(id, decision, a) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const x = a || {}; const body = { action: 'decide', id: Number(id), decision: String(decision || '') };
    if (x.value != null && x.value !== '') body.value = Number(x.value);
    if (x.note) body.note = clean(x.note, 300);
    const r = await invoke('mkt-ads', body);
    sugg = null; suggAt = 0;
    if (!r.ok) {
      const code = r.code || null;
      const message = r.reason === 'forbidden' ? MESSAGES.forbidden : r.reason === 'notfound' ? MESSAGES.notfound : r.reason === 'conflict' ? (DECIDE_MESSAGES[code] || DECIDE_MESSAGES.decided)
        : r.reason === 'invalid' ? (r.field === 'value' ? DECIDE_MESSAGES.value : MESSAGES.invalid) : r.reason === 'not_configured' ? ADS_MESSAGES.not_configured : adsWhy(code, r.text) || MESSAGES.network;
      log('buyer.decide', body.decision + ' · ' + (r.reason === 'conflict' ? code || 'conflict' : r.reason), id);
      return Object.assign(r, { message });
    }
    const b = r.body || {}; const status = typeof b.status === 'string' ? b.status : 'done';
    log('buyer.decide', body.decision + ' · ' + status + (b.live === false ? ' · live_off' : ''), id);
    return { ok: true, status, live: b.live !== false, before: b.before == null ? null : Number(b.before), after: b.after == null ? null : Number(b.after), updates: b.updates == null ? null : Number(b.updates), request: b.request === true,
      message: status === 'rejected' ? 'اترفض' : b.live === false ? 'اتسجلت الموافقة — مفتاح التنفيذ مقفول، فمفيش حاجة اتغيّرت على ميتا' : b.request ? 'اتبعت للديزاينر كطلب جديد' : b.after != null ? 'اتنفّذ على ميتا — الميزانية بقت ' + Number(b.after) + ' ج.م/يوم' : 'اتنفّذ على ميتا' };
  }
  // ش45 decision 5: open / close a Meta campaign from the buyer's confirm card — the admin or marketing.publish = F, the switch on (the server
  // checks it all); the log carries the campaign id and the action only
  const CAMPAIGN_MESSAGES = { live_off: 'مفتاح التنفيذ على ميتا مقفول — الأدمن يشغّله من «القواعد والحدود»', not_linked: 'حساب إعلانات ميتا مش مربوط', not_found: 'الحملة دي مش في أرقام ميتا اللي عندنا — اعمل مزامنة الأول' };
  async function campaignSet(id, on) {
    if (!(isAdmin() || can().publish)) return { ok: false, reason: 'forbidden', message: 'فتح وقفل الحملات محتاج «التسويق: نشر»' };
    const cid = String(id == null ? '' : id); if (!/^[0-9]{1,30}$/.test(cid)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    const status = on ? 'ACTIVE' : 'PAUSED';
    const r = await invoke('mkt-ads', { action: 'campaign_set', campaign_id: cid, status });
    if (!r.ok) {
      const code = r.code || (r.reason === 'notfound' ? 'not_found' : null);
      log('buyer.campaign', (on ? 'resume' : 'pause') + ' · ' + (code || r.reason), cid);
      return Object.assign(r, { message: r.reason === 'forbidden' ? 'فتح وقفل الحملات محتاج «التسويق: نشر»' : CAMPAIGN_MESSAGES[code] || adsWhy(code, r.text) || MESSAGES.network });
    }
    const b = r.body || {};
    log('buyer.campaign', (on ? 'resume' : 'pause') + ' · ' + (b.result === 'same' ? 'same' : 'ok'), cid);
    adsCache.clear(); emit();
    return { ok: true, same: b.result === 'same', status, message: b.result === 'same' ? (on ? 'الحملة شغّالة أصلًا' : 'الحملة واقفة أصلًا') : on ? 'اتفتحت الحملة على ميتا' : 'اتقفلت الحملة على ميتا' };
  }
  // the rules and limits (marketing.view reads; the admin writes the numbers and the switch)
  const RULE_KEYS = ['dailyCap', 'maxCpa', 'autoStop', 'autoStopMode', 'reportHour', 'live'];
  const toRules = (r) => { const x = r && typeof r === 'object' ? r : {}; return { dailyCap: Number(x.dailyCap) || 0, maxCpa: Number(x.maxCpa) || 0, autoStop: Number(x.autoStop) || 0, autoStopMode: x.autoStopMode === 'auto' ? 'auto' : 'suggest', reportHour: Number.isInteger(x.reportHour) ? x.reportHour : 9, live: x.live === true,
    notes: (Array.isArray(x.notes) ? x.notes : []).filter((n) => n && typeof n.title === 'string' && typeof n.details === 'string').map((n) => ({ title: n.title, details: n.details, kind: n.kind || 'قاعدة' })) }; }; // the admin's written rules (the v6 prototype)
  let rulesCache = null; let rulesAt = 0;
  async function rules(force) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && rulesCache && Date.now() - rulesAt < SUGG_MS) return { ok: true, rules: rulesCache };
    try {
      const { data: r, error } = await cl.rpc('mkt_buyer_rules'); if (error) return fail(error);
      rulesCache = toRules(r); rulesAt = Date.now(); return { ok: true, rules: rulesCache };
    } catch (e) { return fail(e); }
  }
  const rulesNow = () => rulesCache;
  async function rulesSet(patch) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const x = patch && typeof patch === 'object' ? patch : {}; const body = {};
    for (const k of RULE_KEYS) if (k !== 'live' && x[k] !== undefined) body[k] = k === 'autoStopMode' ? x[k] : Number(x[k]);
    if (Array.isArray(x.notes)) body.notes = x.notes.slice(0, 20).map((n) => ({ title: String((n && n.title) || ''), details: String((n && n.details) || ''), kind: String((n && n.kind) || '') })); // the written rules — the whole list
    const r = await invoke('mkt-ads', { action: 'rules_set', rules: body });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : r.reason === 'invalid' ? 'القيمة مش مظبوطة' + (r.field ? ' (' + r.field + ')' : '') : MESSAGES.network });
    rulesCache = toRules(r.body && r.body.rules); rulesAt = Date.now(); emit();
    return { ok: true, rules: rulesCache };
  }
  async function setLive(on) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-ads', { action: 'live', on: on === true });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : MESSAGES.network });
    rulesCache = toRules(r.body && r.body.rules); rulesAt = Date.now(); emit();
    return { ok: true, rules: rulesCache };
  }
  // 0082 (the owner 12 Nov — «تقديم طلب» beside each assistant): a request to the human designer / developer / media buyer is a team
  // request (a ticket of a kind) — one source with «طلبات الفريق», where its role works it (status, replies, timeline); mkt_requests
  // keeps its history only (moved over once). The page lists them by the assistant: designer ← design, dev ← dev, buyer ← media.
  const TK = () => window.IBTickets;
  const KIND_OF = { designer: 'design', dev: 'dev', buyer: 'media' }; const AGENT_OF = { design: 'designer', dev: 'dev', media: 'buyer' };
  // 0120: any other assistant's requests carry its own id as the kind (tickets.kind)
  const kindOf = (a) => KIND_OF[a] || (AGENT_RE.test(String(a || '')) ? String(a) : null);
  const REQ_ST = { open: 'جديد', in_progress: 'بيتعمل', waiting: 'مستني رد', resolved: 'خلص', closed: 'اتقفل' };
  const toRequest = (t) => ({ id: t.id, ticket: t.id, kind: AGENT_OF[t.kind] || t.kind || 'designer', title: t.title || '', details: t.description || '', project: t.project || '', status: t.status, statusLabel: REQ_ST[t.status] || t.status,
    open: ['open', 'in_progress', 'waiting'].includes(t.status), priority: t.priority, assigneeRole: t.assigneeRole, by: (t.createdBy && t.createdBy.name) || null, byRole: (t.createdBy && t.createdBy.role) || null,
    createdAt: t.createdAt || null, updatedAt: t.lastUpdate || null, doneAt: (t.resolution && t.resolution.at) || t.closedAt || null, attachments: t.attachments || [], mine: !!(t.createdBy && t.createdBy.uid) && t.createdBy.uid === myUid() });
  const reqsNow = () => { const T = TK(); return T && T.requests ? T.requests().map(toRequest) : []; };
  async function requests(force) {
    const T = TK(); if (!T || !T.requests) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (force || T.state() !== 'ready') { const r = await T.load(); if (r && !r.ok && r.reason !== 'stale' && T.state() !== 'ready') return { ok: false, reason: r.reason || 'network', message: MESSAGES.network }; }
    return { ok: true, items: reqsNow() };
  }
  // the popup's fields → ticket_request_create (tickets.manage F — the server's rule); the kind's role unless another was picked
  async function addRequest(f) {
    const T = TK(); const x = f || {}; if (!T || !T.createRequest) return { ok: false, reason: 'network', message: MESSAGES.network };
    const kind = kindOf(x.kind); if (!kind) return { ok: false, reason: 'invalid', field: 'kind', message: MESSAGES.invalid };
    const title = clean(x.title, 80); if (!title) return { ok: false, reason: 'invalid', field: 'title', message: 'اكتب عنوان الطلب' };
    const description = String(x.details == null ? '' : x.details).replace(/\r\n?/g, '\n').trim().slice(0, 5000) || title;
    const r = await T.createRequest(kind, { title, description, project: clean(x.project, 60), priority: x.priority || 'normal', followUp: x.followUp || null, attachments: x.attachments || [], assigneeRole: x.assigneeRole || null });
    if (!r.ok) return r;
    log('request.add', kind, r.id); emit();
    const t = T.get(r.id); return { ok: true, id: r.id, request: t ? toRequest(t) : null };
  }
  // the buyer's chat: the question + the last turns → text; the server reads the numbers itself; nothing is executed here
  async function buyerChat(question, history) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const q = String(question == null ? '' : question).trim().slice(0, 1000); if (!q) return { ok: false, reason: 'invalid', field: 'question', message: 'اكتب سؤالك الأول' };
    const H = (Array.isArray(history) ? history : []).filter((h) => h && (h.role === 'user' || h.role === 'assistant') && String(h.text || '').trim()).slice(-6).map((h) => ({ role: h.role, text: String(h.text).trim().slice(0, 1000) }));
    const r = await invoke('ai-content', { action: 'buyer', question: q, history: H });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'invalid' ? 'اكتب سؤالك الأول' : aiMessage(r, 'text') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    log('buyer.chat', '', null);
    return { ok: true, text: typeof b.text === 'string' ? b.text : '' };
  }

  // ---------- «آخر التريندات» (comments decision 69): the designer's trends — rows the server found on the web (ai-content
  // `trends`: Claude's web search), read from mkt_trends newest first; the page never writes a row. Before 0109 is applied the
  // table is not there: the list is empty and `ready` is false. The log carries the count only.
  const noTable = (err) => !!err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache/i.test(String(err.message || '')));
  let trendRows = null; let trendsAt = 0; let trendsReady = true;
  const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'web'];
  const cnt = (v) => (v !== '' && num(v) != null && num(v) >= 0 ? num(v) : null);
  const toTrend = (r) => ({ id: r.id, batch: r.batch || null, title: clean(r.title, 160), summary: clean(r.summary, 600), source: clean(r.source, 80) || '—', url: /^https:\/\/[^\s<>"]+$/.test(String(r.url || '')) ? String(r.url) : '',
    kind: r.kind === 'video' ? 'video' : 'image', at: r.found_at || null,
    // ش39 (0118): the post's platform, the tag it came from, its picture (a path in the bucket — signed by trendThumbs), author and numbers
    platform: PLATFORMS.includes(r.platform) ? r.platform : 'web', tag: clean(r.tag, 40), thumb: /^trends\/[0-9]{4}-[0-9]{2}\/[0-9]+\.(png|jpg|webp)$/.test(String(r.thumb || '')) ? r.thumb : null,
    author: clean(r.author, 80), views: cnt(r.views), likes: cnt(r.likes), comments: cnt(r.comments), postedAt: r.posted_at || null });
  const TREND_COLS = 'id, batch, title, summary, source, url, kind, found_at';
  const TREND_COLS2 = TREND_COLS + ', platform, tag, thumb, author, views, likes, comments, posted_at';
  const noColumn = (err) => !!err && (err.code === '42703' || /column .* does not exist/i.test(String(err.message || '')));
  async function trends(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && trendRows && Date.now() - trendsAt < 60000) return { ok: true, items: trendRows, ready: trendsReady };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const q = (cols) => cl.from('mkt_trends').select(cols).order('found_at', { ascending: false }).order('id', { ascending: true }).limit(120);
      let { data: d, error } = await q(TREND_COLS2);
      if (error && noColumn(error)) ({ data: d, error } = await q(TREND_COLS)); // before 0118: the rows as they were
      if (error) { if (!noTable(error)) return fail(error); trendRows = []; trendsReady = false; trendsAt = Date.now(); return { ok: true, items: trendRows, ready: false }; }
      trendRows = (d || []).map(toTrend).filter((x) => x.title && x.url); trendsReady = true; trendsAt = Date.now();
      return { ok: true, items: trendRows, ready: true };
    } catch (e) { return fail(null); }
  }
  const trendsNow = () => trendRows;
  const trendsReadyNow = () => trendsReady;
  const TREND_MESSAGES = { not_ready: 'القسم ده مستني تحديث قاعدة البيانات — هيشتغل بعد التحديث الجاي', no_search: 'Claude ماعرفش يبحث على الويب دلوقتي — اتأكد إن البحث على الويب متفعّل على حساب الـ API، وجرّب تاني' };
  async function trendsRefresh(focus) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'تحديث التريندات محتاج «التسويق: إنشاء»' };
    const f = clean(focus, 200); if (/[<>]/.test(f)) return { ok: false, reason: 'invalid', field: 'focus', message: 'من غير < أو >' };
    const r = await invoke('ai-content', { action: 'trends', focus: f });
    if (!r.ok) return Object.assign(r, { message: (r.code && TREND_MESSAGES[r.code]) || aiMessage(r, 'text') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    let n = Number(b.count) || 0; let ig = null;
    // ش39: with the team's tags, Instagram's official hashtag search too (mkt-publish), then the pictures of the new rows (ai-images)
    if (b.tags) {
      const g = await invoke('mkt-publish', { action: 'trends_ig' });
      const gb = (g.ok && g.body) || {};
      ig = g.ok ? (gb.result === 'ok' ? { count: Number(gb.count) || 0 } : { off: gb.result === 'unavailable' ? (gb.code === 'token' ? 'token' : 'permission') : gb.result === 'not_linked' ? 'not_linked' : null }) : { off: 'failed' };
      n += ig.count || 0;
    }
    await trendThumbsFetch();
    log('trends.refresh', String(n), null);
    await trends(true); emit();
    return { ok: true, count: n, ig };
  }
  // the pictures of the rows that have none yet (12 a call on the server; three calls at most here)
  async function trendThumbsFetch() {
    for (let i = 0; i < 3; i += 1) {
      const t = await invoke('ai-images', { action: 'trend_thumbs' });
      if (!t.ok || !t.body || !(Number(t.body.tried) >= 12)) break;
    }
  }
  // the owner 17 Nov («البوستات الصور مش ظاهرة»): rows still without a picture get theirs when the grid opens too — not only after
  // «حدّث التريندات» (once a session, marketing.create; the server tries each row twice) — then the list again
  let thumbsFilled = false;
  async function trendThumbsFill() {
    if (thumbsFilled || !can().create || !(trendRows || []).some((x) => !x.thumb)) return { ok: true, changed: false };
    thumbsFilled = true; await trendThumbsFetch(); await trends(true); emit();
    return { ok: true, changed: true };
  }
  // the signed links of the trends' pictures (an hour), cached by path
  const thumbUrl = new Map();
  async function trendThumbs(paths) {
    const want = [...new Set((paths || []).filter((p) => p && !thumbUrl.has(p)))];
    const cl = c(); if (want.length && cl) {
      try {
        const { data } = await cl.storage.from(BUCKET).createSignedUrls(want, 3600);
        (data || []).forEach((x) => { if (x && x.path && x.signedUrl) thumbUrl.set(x.path, x.signedUrl); });
      } catch (e) { /* the tiles stay without a picture */ }
    }
    return Object.fromEntries((paths || []).filter((p) => thumbUrl.has(p)).map((p) => [p, thumbUrl.get(p)]));
  }
  const trendThumbNow = (p) => thumbUrl.get(p) || null;

  // ---------- the designer's trend tags and sites (ش39, 0118 — the admin writes them in «الإعدادات › … › المصمم الاصطناعي»)
  let trendCfg = null;
  const TAG_RE = /^[A-Za-z0-9_\u0621-\u064A\u0660-\u0669\u0671-\u06D3]{1,40}$/;
  const HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
  const tagOf = (v) => String(v || '').trim().replace(/^#+/, '').replace(/\s+/g, '_').toLowerCase();
  const hostOf = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  async function trendSettings(force) {
    if (!force && trendCfg) return { ok: true, ...trendCfg };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.rpc('mkt_trend_settings');
      if (error) { if (/function .* does not exist|PGRST202/i.test(String(error.message || '') + (error.code || ''))) { trendCfg = { tags: [], sources: [], adTags: [], ready: false }; return { ok: true, ...trendCfg }; } return fail(error); }
      const o = d && typeof d === 'object' ? d : {};
      trendCfg = { tags: (Array.isArray(o.tags) ? o.tags : []).filter((t) => typeof t === 'string'), sources: (Array.isArray(o.sources) ? o.sources : []).filter((t) => typeof t === 'string'), adTags: (Array.isArray(o.adTags) ? o.adTags : []).filter((t) => typeof t === 'string'), ready: true };
      return { ok: true, ...trendCfg };
    } catch (e) { return fail(null); }
  }
  const trendSettingsNow = () => trendCfg;
  // ش44: the media buyer's ad tags — words Meta's Ad Library is searched for (a search, so spaces stay); the admin only (0118 mkt_ad_tags_set)
  async function adTagsSet(tags) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'تاجز الإعلانات للأدمن بس' };
    const T = [...new Set((tags || []).map((v) => String(v || '').trim().replace(/^#+/, '').replace(/\s+/g, ' ')).filter(Boolean))];
    if (T.length > 30) return { ok: false, reason: 'invalid', field: 'tags', message: 'لحد 30 تاج' };
    const bad = T.find((t) => t.length > 40 || /[<>]/.test(t)); if (bad) return { ok: false, reason: 'invalid', field: 'tags', message: '«' + bad.slice(0, 40) + '» — التاج لحد 40 حرف ومن غير < >' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.rpc('mkt_ad_tags_set', { p_tags: T });
      if (error) return fail(error);
      trendCfg = Object.assign({ tags: [], sources: [], ready: true }, trendCfg || {}, { adTags: Array.isArray(d) ? d : T });
      log('ads.tags', String(T.length), null);
      return { ok: true, adTags: trendCfg.adTags };
    } catch (e) { return fail(null); }
  }
  async function trendSettingsSet(tags, sources) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'إعدادات التريندات للأدمن بس' };
    const T = [...new Set((tags || []).map(tagOf).filter(Boolean))]; const S = [...new Set((sources || []).map(hostOf).filter(Boolean))];
    if (T.length > 30) return { ok: false, reason: 'invalid', field: 'tags', message: 'لحد 30 تاج' };
    const badT = T.find((t) => !TAG_RE.test(t)); if (badT) return { ok: false, reason: 'invalid', field: 'tags', message: '«' + badT + '» — التاج كلمة واحدة (حروف وأرقام و _)، لحد 40 حرف' };
    if (S.length > 15) return { ok: false, reason: 'invalid', field: 'sources', message: 'لحد 15 موقع' };
    const badS = S.find((h) => !HOST_RE.test(h) || h.length > 100); if (badS) return { ok: false, reason: 'invalid', field: 'sources', message: '«' + badS + '» — اكتب اسم الموقع بس (مثلاً later.com)' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.rpc('mkt_trend_settings_set', { p_tags: T, p_sources: S });
      if (error) return fail(error);
      trendCfg = { tags: (d && d.tags) || T, sources: (d && d.sources) || S, adTags: (trendCfg && trendCfg.adTags) || [], ready: true };
      log('trends.settings', String(T.length), null);
      return { ok: true, ...trendCfg };
    } catch (e) { return fail(null); }
  }

  // ---------- «إعلانات المنافسين» (comments decision 70): the media buyer's competitors — a list the team keeps (0109: added,
  // edited and archived with marketing.create, read with marketing.view); their ads are opened in Meta's Ad Library by the page
  // (no ad is pulled or stored — the library's API gives commercial ads for the EU / UK only). The log carries the row's id.
  let compRows = null; let compAt = 0; let compReady = true;
  const toCompetitor = (r) => ({ id: r.id, name: clean(r.name, 80), pageId: /^[0-9]{5,20}$/.test(String(r.page_id || '')) ? String(r.page_id) : '', pageUrl: /^https:\/\/[^\s<>"]+$/.test(String(r.page_url || '')) ? String(r.page_url) : '',
    keyword: clean(r.keyword, 80), note: clean(r.note, 300), at: r.created_at || null,
    // 0160 (buyer-brain decision 5): the server's research brief and its sources (https only)
    brief: r.brief && typeof r.brief === 'object' && typeof r.brief.text === 'string' ? { text: r.brief.text.slice(0, 5000), sources: (Array.isArray(r.brief.sources) ? r.brief.sources : []).filter((x) => x && /^https:\/\/[^\s<>"]+$/.test(String(x.url || ''))).slice(0, 12).map((x) => ({ url: String(x.url), title: clean(x.title, 120) || String(x.url) })) } : null,
    briefAt: r.brief_at || null });
  async function competitors(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && compRows && Date.now() - compAt < 60000) return { ok: true, items: compRows, ready: compReady };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const read = (cols) => cl.from('mkt_competitors').select(cols).is('archived_at', null).order('created_at', { ascending: false }).limit(100);
      let { data: d, error } = await read('id, name, page_id, page_url, keyword, note, created_at, brief, brief_at');
      if (error && !noTable(error)) ({ data: d, error } = await read('id, name, page_id, page_url, keyword, note, created_at')); // before 0160
      if (error) { if (!noTable(error)) return fail(error); compRows = []; compReady = false; compAt = Date.now(); return { ok: true, items: compRows, ready: false }; }
      compRows = (d || []).map(toCompetitor).filter((x) => x.name); compReady = true; compAt = Date.now();
      return { ok: true, items: compRows, ready: true };
    } catch (e) { return fail(null); }
  }
  const competitorsNow = () => compRows;
  const competitorsReadyNow = () => compReady;
  const COMP_MESSAGES = { name: 'اكتب اسم المنافس (لحد 80 حرف)', page: 'اكتب لينك صفحة الفيسبوك أو الإنستجرام، أو رقم الصفحة (أرقام بس)', keyword: 'كلمة البحث لحد 80 حرف', note: 'الملاحظة لحد 300 حرف', text: 'من غير < أو >' };
  // id null = a new competitor; else the row's fields are replaced
  async function competitorSave(id, f) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'إضافة المنافسين محتاجة «التسويق: إنشاء»' };
    const W2 = window.IbtekrCampWiz; const v = W2 && W2.competitorRow ? W2.competitorRow(f) : { error: 'name' };
    if (v.error) return { ok: false, reason: 'invalid', field: v.error === 'text' ? 'name' : v.error, message: COMP_MESSAGES[v.error] };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const q = id == null ? cl.from('mkt_competitors').insert(v.row) : cl.from('mkt_competitors').update(v.row).eq('id', id);
      const { data: d, error } = await q.select('id').maybeSingle();
      if (error) return noTable(error) ? { ok: false, reason: 'not_ready', message: TREND_MESSAGES.not_ready } : fail(error);
      if (!d) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
      log(id == null ? 'competitor.add' : 'competitor.edit', '', d.id);
      await competitors(true); emit();
      return { ok: true, id: d.id };
    } catch (e) { return fail(null); }
  }
  // buyer-brain decision 5 (Safwat 24 Nov): «حلّل المنافس» — ai-content competitor_brief researches it on the web and writes the brief
  // with its sources on the row (the server's key); the log carries the competitor's number only
  async function competitorBrief(id) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'تحليل المنافس محتاج «التسويق: إنشاء»' };
    const r = await invoke('ai-content', { action: 'competitor_brief', id: Number(id) });
    if (!r.ok) return Object.assign(r, { message: r.code === 'not_found' ? 'المنافس ده اتشال من القايمة' : (r.code && TREND_MESSAGES[r.code]) || aiMessage(r, 'text') });
    log('competitor.brief', '', Number(id));
    await competitors(true); emit();
    return { ok: true };
  }
  async function competitorArchive(id) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.from('mkt_competitors').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id').maybeSingle();
      if (error) return fail(error);
      if (!d) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
      log('competitor.remove', '', id);
      await competitors(true); emit();
      return { ok: true };
    } catch (e) { return fail(null); }
  }

  // ---------- the developer's section (comments decision 71): the site's WordPress / plugin updates (the one row the server keeps —
  // woo-sync `wp_updates` reads WooCommerce's own system status: names and versions only), the subscriptions the accounts page
  // holds (read under its own RLS — accounts.view), and the AI credits of the month. The log carries the number of updates only.
  let siteRow; let siteAt = 0; let siteReady = true; // siteRow: undefined = not read yet, null = never checked
  const toSite = (r) => (r && r.data && typeof r.data === 'object' ? { data: r.data, at: r.checked_at || null } : null);
  async function siteCheck(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && siteRow !== undefined && Date.now() - siteAt < 60000) return { ok: true, check: siteRow, ready: siteReady };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.from('site_checks').select('kind, data, checked_at').eq('kind', 'wp_updates').maybeSingle();
      if (error) { if (!noTable(error)) return fail(error); siteRow = null; siteReady = false; siteAt = Date.now(); return { ok: true, check: null, ready: false }; }
      siteRow = toSite(d); siteReady = true; siteAt = Date.now();
      return { ok: true, check: siteRow, ready: true };
    } catch (e) { return fail(null); }
  }
  const siteCheckNow = () => siteRow;
  const siteReadyNow = () => siteReady;
  const SITE_MESSAGES = { config: 'مفاتيح الموقع (WooCommerce) مش متظبطة — من الإعدادات › الربط بالمنصات', woocommerce_rest_cannot_view: 'مفتاح ووكومرس مالوش صلاحية يقرا تقرير حالة الموقع — لازم يكون مفتاح أدمن',
    rest_no_route: 'الموقع مافيهوش تقرير حالة ووكومرس (نسخة قديمة؟)' };
  async function siteCheckRun() {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'فحص الموقع محتاج «التسويق: إنشاء»' };
    const r = await invoke('woo-sync', { action: 'wp_updates' });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : 'الموقع ماردش — جرّب تاني' });
    const b = r.body || {};
    if (b.result !== 'ok' || !b.data) { const code = typeof b.reason === 'string' ? b.reason.slice(0, 60) : ''; return { ok: false, reason: 'site', code, message: SITE_MESSAGES[code] || 'الموقع رفض الفحص' + (code ? ' (' + code + ')' : '') + ' — جرّب تاني' }; }
    siteRow = { data: b.data, at: b.checked_at || new Date().toISOString() }; siteAt = Date.now();
    log('site.check', String(Number(b.data.updates) || 0), null); emit();
    return { ok: true, check: siteRow, stored: b.stored !== false };
  }
  // ش45 decision 1: the site's speed (Google PageSpeed — the one row the server keeps; woo-sync `site_speed` reads it, read only). The
  // log carries the lowest mobile score only.
  let speedRow; let speedAt = 0; // undefined = not read yet, null = never checked
  async function siteSpeed(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && speedRow !== undefined && Date.now() - speedAt < 60000) return { ok: true, check: speedRow };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.from('site_checks').select('kind, data, checked_at').eq('kind', 'pagespeed').maybeSingle();
      if (error) { if (!noTable(error)) return fail(error); speedRow = null; speedAt = Date.now(); return { ok: true, check: null }; }
      speedRow = toSite(d); speedAt = Date.now();
      return { ok: true, check: speedRow };
    } catch (e) { return fail(null); }
  }
  const siteSpeedNow = () => speedRow;
  const SPEED_MESSAGES = { config: 'لينك الموقع (WooCommerce) مش متظبط — من الإعدادات › الربط بالمنصات', http_429: 'جوجل وقف الفحص شوية (حد الاستخدام) — جرّب بعد شوية',
    timeout: 'الفحص طوّل أكتر من اللازم — جرّب تاني', network: 'جوجل ماردش — جرّب تاني' };
  async function siteSpeedRun() {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'فحص سرعة الموقع محتاج «التسويق: إنشاء»' };
    const r = await invoke('woo-sync', { action: 'site_speed' });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'forbidden' ? MESSAGES.forbidden : 'الفحص ماخلصش — جرّب تاني' });
    const b = r.body || {};
    if (b.result !== 'ok' || !b.data) { const code = typeof b.reason === 'string' ? b.reason.slice(0, 40) : ''; return { ok: false, reason: 'site', code, message: SPEED_MESSAGES[code] || 'الفحص ماخلصش' + (code ? ' (' + code + ')' : '') + ' — جرّب تاني' }; }
    speedRow = { data: b.data, at: b.checked_at || new Date().toISOString() }; speedAt = Date.now();
    log('site.speed', String(b.data.score == null ? '' : Number(b.data.score)), null); emit();
    return { ok: true, check: speedRow, stored: b.stored !== false };
  }
  // the owner 17 Nov — «الميديا باير يقدر يبص علي البيكسل و لو في حاجة محتاجة تتصلح يقدر يساعدني نصلحها»: the last pixel check (site_checks
  // 'pixel', 0126) and «افحص دلوقتي» = mkt-ads `pixel` (read only on Meta and the site); the log carries the count of issues only
  let pixelRow; let pixelAt = 0;
  async function pixel(force) {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    if (!force && pixelRow !== undefined && Date.now() - pixelAt < 60000) return { ok: true, check: pixelRow };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.from('site_checks').select('kind, data, checked_at').eq('kind', 'pixel').maybeSingle();
      if (error) { if (!noTable(error)) return fail(error); pixelRow = null; pixelAt = Date.now(); return { ok: true, check: null }; }
      pixelRow = toSite(d); pixelAt = Date.now();
      return { ok: true, check: pixelRow };
    } catch (e) { return fail(null); }
  }
  const pixelNow = () => pixelRow;
  const PIXEL_MESSAGES = { not_configured: 'حساب إعلانات ميتا مش مربوط — اربطه من الإعدادات › الربط بالمنصات', permission: 'التوكن بتاع ميتا مالوش صلاحية على البيكسل — محتاج ads_read على حساب الإعلانات',
    token: 'توكن ميتا انتهى أو اتلغى — اربط الحساب تاني من الإعدادات', rate: 'ميتا وقفت الطلبات شوية — جرّب بعد دقايق', timeout: 'ميتا طوّلت — جرّب تاني' };
  async function pixelRun() {
    if (!can().view) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const r = await invoke('mkt-ads', { action: 'pixel' });
    const b = r.body || {};
    if (!r.ok || !b.report) { const code = String((r.ok ? b.error : r.code || r.reason) || '').slice(0, 40); return { ok: false, reason: 'pixel', code, message: PIXEL_MESSAGES[code] || 'الفحص ماخلصش' + (code ? ' (' + code + ')' : '') + ' — جرّب تاني' }; }
    pixelRow = { data: b.report, at: b.checked_at || new Date().toISOString() }; pixelAt = Date.now();
    emit(); // the server logs mkt.ads.pixel
    return { ok: true, check: pixelRow };
  }
  // the subscriptions of the accounts page (the latest payment of each name): null when the member does not see the accounts
  let subRows; let subsAt = 0;
  const dayNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  async function siteSubs(force) {
    const D = window.IBDirectory; const see = !!D && (D.perm ? D.perm('accounts.view') !== 'N' : false);
    if (!see) { subRows = null; return { ok: true, items: null }; }
    if (!force && subRows !== undefined && Date.now() - subsAt < 60000) return { ok: true, items: subRows };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.from('acc_expenses').select('id, on_date, direction, category, amount, sub_name, sub_ends, sub_alerts, sub_note').eq('category', 'الاشتراكات').is('voided_at', null).limit(1000);
      if (error) return fail(error);
      const last = new Map();
      for (const r of d || []) { if (r.category !== 'الاشتراكات' || r.direction === 'deposit' || !r.sub_name || !r.sub_ends) continue;
        const k = String(r.sub_name).trim().toLowerCase(); const o = last.get(k); if (!o || String(r.sub_ends) > String(o.sub_ends)) last.set(k, r); }
      const Dm = window.IbtekrDomain;
      const list = [...last.values()].map((r) => ({ subName: clean(r.sub_name, 80), subEnds: String(r.sub_ends).slice(0, 10), amount: Number(r.amount) || 0, subAlerts: Array.isArray(r.sub_alerts) ? r.sub_alerts : [], subNote: clean(r.sub_note, 200) }));
      subRows = Dm && Dm.subsDue ? Dm.subsDue(list, dayNow()) : []; subsAt = Date.now();
      return { ok: true, items: subRows };
    } catch (e) { return fail(null); }
  }
  const siteSubsNow = () => subRows;
  // the month's AI spend against its cap (the admin's numbers — ai_month_cost and the settings row «ai»); null for anyone else
  let spendRow; let spendAt = 0;
  async function aiSpend(force) {
    if (!isAdmin()) { spendRow = null; return { ok: true, spend: null }; }
    if (!force && spendRow !== undefined && Date.now() - spendAt < 60000) return { ok: true, spend: spendRow };
    const A = window.IBAI; if (!A || !A.monthSpend) { spendRow = null; return { ok: true, spend: null }; }
    try {
      const [m, st] = await Promise.all([A.monthSpend(), A.settings ? A.settings() : Promise.resolve(null)]);
      const cap = st && st.ok && st.cap != null ? Number(st.cap) : null;
      spendRow = m && m.ok ? { used: Number(m.total) || 0, runs: Number(m.runs) || 0, cap: Number.isFinite(cap) && cap > 0 ? cap : null } : null; spendAt = Date.now();
      return { ok: true, spend: spendRow };
    } catch (e) { spendRow = null; return { ok: true, spend: null }; }
  }
  const aiSpendNow = () => spendRow;

  // ---------- 0084: the assistants' chats like Claude's (the owner 12 Nov — decisions 5 and 6) ----------
  // the member's own chats only (RLS); the server writes the turns (ai-content agent) and the designer's picture (ai-images
  // agent_image); the member renames and deletes; the assistants' settings (intro, instructions, quick suggestions) are the admin's.
  // The log carries the assistant and the chat's id only — never a question, an answer, a title or a prompt.
  const AGENT_KEYS = ['buyer', 'designer', 'dev'];
  const AGENT_RE = /^[a-z][a-z0-9_]{1,30}$/;
  const CHAT_COLS = 'id, agent, title, created_at, updated_at';
  const TURN_COLS = 'id, role, text, images, created_at, source, shared';
  const SHARE_KINDS = ['orders', 'sales', 'vendors', 'customers', 'tickets', 'tasks', 'expenses', 'inventory', 'hr', 'ads', 'site']; // what an assistant's outside answer may be given, by kind (ads / site: the buyer's numbers and the developer's site checks)
  const kindsOf = (l) => (Array.isArray(l) ? l : []).filter((k, i, a2) => SHARE_KINDS.includes(k) && a2.indexOf(k) === i);
  const toChat = (r) => ({ id: r.id, agent: r.agent, title: clean(r.title, 80) || 'شات جديد', createdAt: r.created_at || null, updatedAt: r.updated_at || r.created_at || null });
  const toTurn = (r) => ({ id: Number(r.id), role: r.role === 'user' ? 'user' : 'assistant', text: typeof r.text === 'string' ? r.text : '',
    images: (Array.isArray(r.images) ? r.images : []).filter((x) => typeof x === 'string' && /^agents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$/.test(x)), at: r.created_at || null,
    // the owner 22 Nov: where an answer came from — the system itself or the outside company — and the data kinds that company was given
    src: r.source === 'system' ? 'system' : ['claude', 'openai', 'gemini'].includes(r.source) ? r.source : '', shared: kindsOf(r.shared) });
  async function agentChats(agent) {
    if (!AGENT_RE.test(String(agent || ''))) return { ok: false, reason: 'invalid', field: 'agent', message: MESSAGES.invalid };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.from('mkt_agent_chats').select(CHAT_COLS).eq('agent', agent).order('updated_at', { ascending: false }).limit(50);
      if (error) return fail(error); return { ok: true, items: (d || []).map(toChat) }; }
    catch (e) { return fail(null); }
  }
  async function agentTurns(chatId) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.from('mkt_agent_messages').select(TURN_COLS).eq('chat_id', chatId).order('id', { ascending: true }).limit(300);
      if (error) return fail(error); return { ok: true, items: (d || []).map(toTurn) }; }
    catch (e) { return fail(null); }
  }
  // a question → the server's answer, written in the chat (made on the first message, named by it)
  // the owner 17 Nov: files with the message (IBChatFiles.read — images / PDFs as base64, sheets and text as text; 4 at most)
  // the owner 22 Nov — the system first: the numbers each assistant this member sees watches now (ai_agent_facts), what its chat answers
  // from with no model; and the system's own answer kept in the member's chat (mkt_agent_system_turn — text only, marked the system's)
  async function agentFacts() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try { const { data: d, error } = await cl.rpc('ai_agent_facts', {}); if (error || !d || typeof d !== 'object' || !d.agents) return { ok: false, reason: 'unavailable' }; return { ok: true, data: d }; } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function agentLocal(agent, chatId, question, answer) {
    if (!AGENT_RE.test(String(agent || ''))) return { ok: false, reason: 'invalid', field: 'agent', message: MESSAGES.invalid };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.rpc('mkt_agent_system_turn', { p_agent: agent, p_chat: chatId || null, p_question: String(question || '').trim().slice(0, 1000), p_answer: String(answer || '').trim().slice(0, 2000) });
      if (error || !d || !d.chat) return fail(error); log('agent.system', agent, d.chat.id); return { ok: true, chat: toChat(d.chat), turns: (Array.isArray(d.turns) ? d.turns : []).map(toTurn) }; }
    catch (e) { return fail(null); }
  }
  // o: { provider — the outside company the member agreed to for this message, share — the data kinds approved for it (none = the message
  // alone) }; the server answers `need` (the kinds it wants, nothing written) for the page to ask about
  async function agentAsk(agent, chatId, question, files, o) {
    if (!AGENT_RE.test(String(agent || ''))) return { ok: false, reason: 'invalid', field: 'agent', message: MESSAGES.invalid };
    const fs = (Array.isArray(files) ? files : []).slice(0, 4).map((f) => ({ name: String(f.name || '').slice(0, 120), kind: f.kind, data: f.data || undefined, text: f.text || undefined, note: f.note || '' }));
    const q = String(question == null ? '' : question).trim().slice(0, 1000); if (!q && !fs.length) return { ok: false, reason: 'invalid', field: 'question', message: 'اكتب رسالتك الأول' };
    const opt = o && typeof o === 'object' ? o : null; const share = opt ? kindsOf(opt.share) : null; const provider = opt && ['claude', 'openai', 'gemini'].includes(opt.provider) ? opt.provider : null;
    const body = Object.assign({ action: 'agent', agent, chat_id: chatId || null, question: q }, fs.length ? { files: fs } : {}, provider ? { provider } : {}, share ? { share } : {});
    const r = await invoke('ai-content', body);
    if (!r.ok) return Object.assign(r, { message: r.reason === 'notfound' ? 'الشات ده اتمسح أو مش بتاعك (أو المساعد اتأرشف) — افتح شات جديد' : r.reason === 'unauthorized' || r.reason === 'forbidden' ? 'المساعد ده مش متاح لدورك'
      : r.reason === 'invalid' ? (r.field === 'files' ? 'ملف من الملفات مش مقبول (الصور لحد 5 ميجا، الـ PDF لحد 8، والمجموع لحد 12)' : 'اكتب رسالتك الأول') : aiMessage(r, 'text') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    const need = kindsOf(b.need_data).filter((k) => !(share || []).includes(k));
    if (need.length) { log('agent.chat', agent + ' · asks for: ' + need.join(', '), chatId || null); return { ok: true, need, turns: [] }; } // nothing was read or written: the page asks the member
    const chat = b.chat && b.chat.id ? toChat(b.chat) : null;
    log('agent.chat', agent, chat ? chat.id : null);
    const shared = kindsOf(b.shared).filter((k) => (share || []).includes(k)); if (provider && shared.length) log('agent.share', agent + ' · ' + provider + ' · ' + shared.join(', '), chat ? chat.id : null); // the company and the kinds only
    // owner batch 14 Nov decision 14: a job for a person comes back as a ready request (title + details) — the page offers «قدّم الطلب ده»
    const rq = b.request && typeof b.request === 'object' && typeof b.request.title === 'string' && b.request.title.trim() ? { title: b.request.title.trim().slice(0, 80), details: typeof b.request.details === 'string' ? b.request.details.slice(0, 1500) : '' } : null;
    // ش45 decision 4: the designer's filled campaign (the page clamps it with IbtekrCampWiz.draftOf before opening it)
    const cp = (agent === 'designer' || agent === 'buyer') && b.campaign && typeof b.campaign === 'object' && !Array.isArray(b.campaign) ? b.campaign : null;
    // ش45 decision 5: the buyer's pause / resume proposal — a confirm card on the page, nothing runs from the chat
    const ca = agent === 'buyer' && b.campaignAction && /^[0-9]{1,30}$/.test(String(b.campaignAction.campaignId || '')) && ['pause', 'resume'].includes(b.campaignAction.action) ? { campaignId: String(b.campaignAction.campaignId), action: b.campaignAction.action } : null;
    // the owner 18 Nov («يجيبولي الاختيارات جوا الشات يعني اوافق او ارفض»): the buyer's open suggestions to decide in the chat (approve / reject by id)
    const dc = agent === 'buyer' && Array.isArray(b.decisions) ? b.decisions.filter((x) => x && /^[0-9]{1,12}$/.test(String(x.id)) && ['approve', 'reject'].includes(x.decision)).slice(0, 5).map((x) => ({ id: Number(x.id), decision: x.decision })) : [];
    // the owner 17 Nov («لما اسأل علي حاجة مش بتاعت اللي بكلمه يقوله هبعتك للمصمم … و يبعتني ليه بالبرومت و ادوس علي ارسال»): a question
    // for another assistant of the team comes back as a handoff — the page offers «روح لـ…» (that assistant's chat, the question in its box)
    const hd = b.handoff && typeof b.handoff === 'object' && AGENT_RE.test(String(b.handoff.agent || '')) && b.handoff.agent !== agent && typeof b.handoff.question === 'string' && b.handoff.question.trim()
      ? { agent: String(b.handoff.agent), question: b.handoff.question.trim().slice(0, 1000) } : null;
    // agents-brain T3: the system's popups filled by the answer (the header assistant's forms) and a page it points at — the page opens
    // them only on the member's click; the popup is the confirmation
    const fm = (Array.isArray(b.forms) ? b.forms : []).filter((f) => f && typeof f.form === 'string' && /^[a-z_]{2,30}$/.test(f.form) && f.values && typeof f.values === 'object' && !Array.isArray(f.values)).slice(0, 3)
      .map((f) => ({ form: f.form, values: Object.fromEntries(Object.entries(f.values).filter(([k, v]) => /^[A-Za-z]{1,20}$/.test(k) && v != null).map(([k, v]) => [k, String(v).slice(0, 1000)])) }));
    const pg = b.page && typeof b.page === 'object' && /^[a-z]{2,20}$/.test(String(b.page.page || '')) ? { page: String(b.page.page), tab: typeof b.page.tab === 'string' ? b.page.tab.slice(0, 40) : '' } : null;
    // the owner 18 Nov: the answer's choices (buttons in the chat) or fields (a popup the member fills) — the server cleaned them (cleanAsk)
    const ak = b.ask && typeof b.ask === 'object' ? b.ask : null;
    const ask = ak ? { question: String(ak.question || '').slice(0, 200), options: (Array.isArray(ak.options) ? ak.options : []).map((o) => String(o).slice(0, 60)).filter(Boolean).slice(0, 6),
      fields: (Array.isArray(ak.fields) ? ak.fields : []).filter((f) => f && f.label).map((f) => ({ label: String(f.label).slice(0, 60), kind: ['text', 'long', 'number', 'date'].includes(f.kind) ? f.kind : 'text' })).slice(0, 8) } : null;
    return { ok: true, ask: ask && (ask.options.length >= 2 || ask.fields.length) ? ask : null, text: typeof b.text === 'string' ? b.text : '', imagePrompt: typeof b.imagePrompt === 'string' ? b.imagePrompt : '', request: rq, campaign: cp, campaignAction: ca, decisions: dc, handoff: hd, forms: fm, page: pg, plan: Array.isArray(b.plan) ? b.plan.slice(0, 10) : [], sources: Array.isArray(b.sources) ? b.sources.slice(0, 12) : [], chat, turns: (Array.isArray(b.turns) ? b.turns : []).map(toTurn) };
  }
  // the designer's picture from the prompt of its answer (the image credits) — the turn comes back with the image's path
  async function agentImage(chatId, prompt) {
    if (!can().create) return { ok: false, reason: 'forbidden', message: 'توليد الصور محتاج «التسويق: إنشاء»' };
    const p = String(prompt == null ? '' : prompt).trim().slice(0, 1000); if (!p || !chatId) return { ok: false, reason: 'invalid', field: 'prompt', message: MESSAGES.invalid };
    const r = await invoke('ai-images', { action: 'agent_image', chat_id: chatId, prompt: p });
    if (!r.ok) return Object.assign(r, { message: r.reason === 'notfound' ? 'الشات ده اتمسح أو مش بتاعك' : aiMessage(r, 'image') });
    const b = r.body || {};
    if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'image') };
    log('agent.image', 'designer · ' + (Number(b.credits) || 0), chatId);
    emit();
    return { ok: true, turn: b.turn ? toTurn(b.turn) : null, credits: Number(b.credits) || 0 };
  }
  async function agentRename(id, title) {
    const t = clean(title, 80); if (!t) return { ok: false, reason: 'invalid', field: 'title', message: 'اكتب اسم للشات' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.from('mkt_agent_chats').update({ title: t }).eq('id', id).select(CHAT_COLS).maybeSingle();
      if (error) return fail(error); if (!d) return { ok: false, reason: 'notfound', message: MESSAGES.notfound };
      log('agent.rename', d.agent, id); return { ok: true, chat: toChat(d) }; }
    catch (e) { return fail(null); }
  }
  async function agentDelete(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { error } = await cl.rpc('mkt_agent_chat_delete', { p_id: id }); if (error) return fail(error); log('agent.delete', '', id); return { ok: true }; }
    catch (e) { return fail(null); }
  }
  let agentCfg = null; let agentCfgAt = 0;
  const cfgOf = (x) => { const o = x && typeof x === 'object' ? x : {}; return { intro: typeof o.intro === 'string' ? o.intro : '', instructions: typeof o.instructions === 'string' ? o.instructions : '',
    suggestions: Array.isArray(o.suggestions) ? o.suggestions.filter((v) => typeof v === 'string' && v.trim()).slice(0, 8) : null,
    rules: kbOf(o.rules), skills: kbOf(o.skills) }; }; // ش40 (0118)
  // ---------- the assistants' rules and skills (ش40, 0118): named sections of { title, text } — the admin writes them in the settings,
  // the server puts them in the assistant's prompt. The checks are 0118's (and _shared/agent-kb.js's kbCheck).
  const KB = { sections: 12, items: 30, name: 60, title: 80, text: 1500, total: 20000 };
  const kbId = (v, d) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(v || '')) ? String(v) : d);
  function kbOf(v) {
    return (Array.isArray(v) ? v : []).filter((g) => g && typeof g === 'object' && typeof g.name === 'string' && g.name.trim()).slice(0, KB.sections).map((g, gi) => ({
      id: kbId(g.id, 'g' + (gi + 1)), name: g.name.trim().slice(0, KB.name),
      items: (Array.isArray(g.items) ? g.items : []).filter((it) => it && typeof it.title === 'string' && it.title.trim()).slice(0, KB.items)
        .map((it, ii) => ({ id: kbId(it.id, 'i' + (gi + 1) + '_' + (ii + 1)), title: it.title.trim().slice(0, KB.title), text: typeof it.text === 'string' ? it.text : '' })) }));
  }
  function kbCheck(groups) {
    if (!Array.isArray(groups) || groups.length > KB.sections) return { field: 'groups', message: 'لحد ' + KB.sections + ' قسم' };
    let total = 0;
    for (const g of groups) {
      const n = String(g.name || '').trim();
      if (!n || n.length > KB.name || /[<>]/.test(n)) return { field: 'name', message: 'اسم القسم لحد ' + KB.name + ' حرف ومن غير < >' };
      const items = Array.isArray(g.items) ? g.items : []; if (items.length > KB.items) return { field: 'items', message: 'لحد ' + KB.items + ' في القسم الواحد' };
      total += n.length;
      for (const it of items) {
        const t = String(it.title || '').trim(); const x = String(it.text || '').replace(/\r\n?/g, '\n').trim();
        if (!t || t.length > KB.title || /[<>]/.test(t)) return { field: 'title', message: 'العنوان لحد ' + KB.title + ' حرف ومن غير < >' };
        if (x.length > KB.text || /[<>]/.test(x)) return { field: 'text', message: 'التفاصيل لحد ' + KB.text + ' حرف ومن غير < >' };
        total += t.length + x.length;
      }
    }
    if (total > KB.total) return { field: 'size', message: 'الكلام كله أكتر من ' + KB.total + ' حرف — قصّر شوية' };
    return null;
  }
  async function agentKbSet(agent, kind, groups) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'قواعد المساعدين وسكيلزهم للأدمن بس' };
    if (!AGENT_KEYS.includes(agent) || !['rules', 'skills'].includes(kind)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    const bad = kbCheck(groups); if (bad) return { ok: false, reason: 'invalid', ...bad };
    const body = groups.map((g) => ({ id: g.id, name: String(g.name).trim(), items: (g.items || []).map((it) => ({ id: it.id, title: String(it.title).trim(), text: String(it.text || '').replace(/\r\n?/g, '\n').trim() })) }));
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: d, error } = await cl.rpc('mkt_agent_kb_set', { p_agent: agent, p_kind: kind, p_groups: body });
      if (error) return fail(error);
      const saved = kbOf(d);
      if (agentCfg && agentCfg[agent]) agentCfg[agent] = Object.assign({}, agentCfg[agent], { [kind]: saved });
      log('agent.kb', agent + ' · ' + kind, null);
      return { ok: true, groups: saved };
    } catch (e) { return fail(null); }
  }
  async function agentSettings(force) {
    if (!force && agentCfg && Date.now() - agentCfgAt < 60000) return { ok: true, agents: agentCfg };
    // 0120: the registry's intro / instructions / suggestions (every assistant the member sees); before 0120 the old marketing row
    const reg = await agents(!!force);
    if (reg.ok && !reg.legacy) { agentCfg = Object.fromEntries(reg.items.map((a) => [a.id, cfgOf(a)])); agentCfgAt = Date.now(); return { ok: true, agents: agentCfg }; }
    if (!can().view && !isAdmin()) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.rpc('mkt_agent_settings'); if (error) return fail(error);
      const o = d && typeof d === 'object' ? d : {}; agentCfg = { buyer: cfgOf(o.buyer), designer: cfgOf(o.designer), dev: cfgOf(o.dev) }; agentCfgAt = Date.now();
      return { ok: true, agents: agentCfg }; }
    catch (e) { return fail(null); }
  }
  const agentSettingsNow = () => agentCfg;
  async function agentSettingsSet(agent, cfg) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'إعدادات المساعدين للأدمن بس' };
    if (!AGENT_RE.test(String(agent || ''))) return { ok: false, reason: 'invalid', field: 'agent', message: MESSAGES.invalid };
    if (!REG.legacy && REG.items) { // 0120: the registry row
      const r = await agentSave(Object.assign({ id: agent }, cfg && typeof cfg === 'object' ? { intro: cfg.intro, instructions: cfg.instructions, suggestions: cfg.suggestions } : {}));
      if (!r.ok) return r; const a = (REG.items || []).find((x) => x.id === agent); if (agentCfg && a) agentCfg[agent] = cfgOf(a); return { ok: true, cfg: a ? cfgOf(a) : null };
    }
    if (!AGENT_KEYS.includes(agent)) return { ok: false, reason: 'invalid', field: 'agent', message: MESSAGES.invalid };
    const x = cfg && typeof cfg === 'object' ? cfg : {}; const body = {};
    if (x.intro !== undefined) body.intro = String(x.intro || '').trim();
    if (x.instructions !== undefined) body.instructions = String(x.instructions || '').replace(/\r\n?/g, '\n').trim();
    if (x.suggestions !== undefined) body.suggestions = (Array.isArray(x.suggestions) ? x.suggestions : []).map((v) => clean(v, 80)).filter(Boolean);
    const bad = body.intro && body.intro.length > 600 ? 'intro' : body.instructions && body.instructions.length > 4000 ? 'instructions' : body.suggestions && body.suggestions.length > 8 ? 'suggestions'
      : /[<>]/.test([body.intro, body.instructions].concat(body.suggestions || []).join(' ')) ? 'text' : null;
    if (bad) return { ok: false, reason: 'invalid', field: bad, message: { intro: 'التعريف لحد 600 حرف', instructions: 'التعليمات لحد 4000 حرف', suggestions: 'لحد 8 اقتراحات', text: 'من غير < أو >' }[bad] };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { data: d, error } = await cl.rpc('mkt_agent_settings_set', { p_agent: agent, p_cfg: body }); if (error) return fail(error);
      if (agentCfg) agentCfg[agent] = cfgOf(d); log('agent.settings', agent + ' · ' + Object.keys(body).join(', '), null); return { ok: true, cfg: cfgOf(d) }; }
    catch (e) { return fail(null); }
  }

  // ---------- «الذكاء الاصطناعي» (0120, docs/superpowers/plans/2026-11-17-ai-page.md): the assistants' registry and their one list of
  // rules and skills. The registry is what the member sees (ai_agents_list — by each assistant's page permission, the admin all and the
  // archived); before 0120 the three of marketing stand alone (legacy: marketing.view). The log carries ids, keys and counts only.
  const AGENT_PERMS = [['marketing.view', 'التسويق'], ['inventory.view', 'المخزون'], ['cs.view', 'خدمة العملاء'], ['vendors.view', 'المبتكرين'], ['accounts.view', 'الحسابات'], ['hr.view', 'الموارد البشرية'], ['orders.view', 'الأوردرات'], ['products.view', 'المنتجات'], ['tickets.view', 'طلبات الفريق'], ['reports.view', 'التقارير']];
  const AGENT_SEES = [['orders', 'الأوردرات'], ['vendors', 'المبتكرين'], ['customers', 'العملاء'], ['tickets', 'طلبات الفريق'], ['tasks', 'المهام'], ['expenses', 'المصروفات'], ['sales', 'المبيعات'], ['inventory', 'المخزن'], ['hr', 'الحضور وطلبات الموارد البشرية']];
  const LEGACY_AGENTS = [{ id: 'buyer', name: 'الميديا باير الذكي', icon: 'chart', perm: 'marketing.view', sees: [], role: 'ميديا باير', builtin: true },
    { id: 'designer', name: 'الديزاينر الذكي', icon: 'image', perm: 'marketing.view', sees: [], role: 'ديزاينر', builtin: true },
    { id: 'dev', name: 'المبرمج الذكي', icon: 'code', perm: 'marketing.view', sees: [], role: 'مبرمج', builtin: true }];
  const REG = { items: null, at: 0, legacy: false, loading: null };
  const toAgent = (a) => ({ id: String(a.id), name: clean(a.name, 40) || String(a.id), icon: /^[A-Za-z]{2,20}$/.test(String(a.icon || '')) ? a.icon : 'sparkle', perm: a.perm || 'marketing.view',
    sees: Array.isArray(a.sees) ? a.sees.filter((k) => AGENT_SEES.some(([v]) => v === k)) : [], role: typeof a.role === 'string' ? a.role : null, about: typeof a.about === 'string' ? a.about : '',
    intro: typeof a.intro === 'string' ? a.intro : '', instructions: typeof a.instructions === 'string' ? a.instructions : '',
    suggestions: Array.isArray(a.suggestions) ? a.suggestions.filter((v) => typeof v === 'string' && v.trim()).slice(0, 8) : [], builtin: !!a.builtin, archived: !!a.archived, sort: Number(a.sort) || 0 });
  const legacyOf = () => (can().view || isAdmin() ? LEGACY_AGENTS.map((a) => toAgent(a)) : []);
  async function agents(force) {
    if (!force && REG.items && Date.now() - REG.at < 60000) return { ok: true, items: REG.items, legacy: REG.legacy };
    if (REG.loading) return REG.loading;
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    REG.loading = (async () => {
      try {
        const { data: d, error } = await cl.rpc('ai_agents_list');
        if (error) { if (/ai_agents_list|function|schema cache/i.test(String(error.message || '')) || String(error.code) === 'PGRST202' || String(error.code) === '42883') { REG.items = legacyOf(); REG.legacy = true; REG.at = Date.now(); emit(); return { ok: true, items: REG.items, legacy: true }; } return fail(error); }
        if (!Array.isArray(d)) { REG.items = legacyOf(); REG.legacy = true; REG.at = Date.now(); emit(); return { ok: true, items: REG.items, legacy: true }; } // the server always answers a list
        REG.items = d.map(toAgent); REG.legacy = false; REG.at = Date.now(); emit();
        return { ok: true, items: REG.items, legacy: false };
      } catch (e) { return fail(null); } finally { REG.loading = null; }
    })();
    return REG.loading;
  }
  const agentsNow = () => REG.items;
  const agentOf = (id) => (REG.items || []).find((a) => a.id === id) || null;
  const NEED_0120 = { ok: false, reason: 'invalid', message: 'المساعدين الجداد محتاجين تحديث قاعدة البيانات (0120) — كلّم المبرمج' };
  // p: { id?, name, icon, perm, sees, role, about, intro, instructions, suggestions } — the admin; a builtin keeps its permission and its data
  async function agentSave(p) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'المساعدين للأدمن بس' };
    if (REG.legacy) return NEED_0120;
    const x = p && typeof p === 'object' ? p : {}; const body = {};
    if (x.id) body.id = String(x.id);
    if (x.name !== undefined) { const n = clean(x.name, 40); if (n.length < 2 || /[<>]/.test(String(x.name))) return { ok: false, reason: 'invalid', field: 'name', message: 'الاسم من 2 لـ 40 حرف ومن غير < >' }; body.name = n; }
    if (x.icon !== undefined) body.icon = String(x.icon || 'sparkle');
    if (x.perm !== undefined) { if (!AGENT_PERMS.some(([v]) => v === x.perm)) return { ok: false, reason: 'invalid', field: 'perm', message: 'اختار الصفحة اللي بتفتحه' }; body.perm = x.perm; }
    if (x.sees !== undefined) body.sees = (Array.isArray(x.sees) ? x.sees : []).filter((k) => AGENT_SEES.some(([v]) => v === k));
    if (x.role !== undefined) body.role = x.role ? clean(x.role, 60) : '';
    for (const [k, max] of [['about', 300], ['intro', 600], ['instructions', 4000]]) if (x[k] !== undefined) {
      const v = String(x[k] || '').replace(/\r\n?/g, '\n').trim(); if (v.length > max || /[<>]/.test(v)) return { ok: false, reason: 'invalid', field: k, message: 'لحد ' + max + ' حرف ومن غير < >' }; body[k] = v; }
    if (x.suggestions !== undefined) { const L = (Array.isArray(x.suggestions) ? x.suggestions : []).map((v) => clean(v, 80)).filter(Boolean); if (L.length > 8) return { ok: false, reason: 'invalid', field: 'suggestions', message: 'لحد 8 اقتراحات' }; body.suggestions = L; }
    if (!body.id && (!body.name || !body.perm)) return { ok: false, reason: 'invalid', field: body.name ? 'perm' : 'name', message: body.name ? 'اختار الصفحة اللي بتفتحه' : 'اكتب اسم المساعد' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data: id, error } = await cl.rpc('ai_agent_save', { p: body }); if (error) return fail(error);
      log('agent.save', Object.keys(body).filter((k) => k !== 'id').sort().join(', '), id);
      await agents(true); agentCfg = REG.items && !REG.legacy ? Object.fromEntries(REG.items.map((a) => [a.id, cfgOf(a)])) : null; agentCfgAt = Date.now(); return { ok: true, id };
    } catch (e) { return fail(null); }
  }
  async function agentArchive(id, on) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'المساعدين للأدمن بس' };
    if (REG.legacy) return NEED_0120;
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { error } = await cl.rpc('ai_agent_archive', { p_id: String(id), p_on: on !== false }); if (error) return fail(error); log(on !== false ? 'agent.archive' : 'agent.restore', '', id); await agents(true); return { ok: true }; }
    catch (e) { return fail(null); }
  }
  async function agentOrder(ids) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'المساعدين للأدمن بس' };
    if (REG.legacy) return NEED_0120;
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { error } = await cl.rpc('ai_agent_order', { p_ids: (ids || []).map(String) }); if (error) return fail(error); log('agent.order', String((ids || []).length), null); await agents(true); return { ok: true }; }
    catch (e) { return fail(null); }
  }
  // the rules and skills, one list each — [{ id, kind, section, title, text, agents: [id…] (empty = all) }]; before 0120 the old sections, read only
  let KBL = null;
  async function kbList(force) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'قواعد المساعدين وسكيلزهم للأدمن بس' };
    if (!force && KBL) return { ok: true, items: KBL, legacy: REG.legacy };
    await agents(false);
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      if (REG.legacy) {
        const { data: d, error } = await cl.rpc('mkt_agent_settings'); if (error) return fail(error);
        const o = d && typeof d === 'object' ? d : {}; const out = [];
        for (const a of AGENT_KEYS) for (const kind of ['rules', 'skills']) for (const g of kbOf(o[a] && o[a][kind])) for (const it of g.items) out.push({ id: a + kind + it.id, kind, section: g.name, title: it.title, text: it.text, agents: [a] });
        KBL = out; return { ok: true, items: KBL, legacy: true };
      }
      const { data: d, error } = await cl.rpc('ai_agent_kb_list'); if (error) return fail(error);
      KBL = (Array.isArray(d) ? d : []).map((x) => ({ id: String(x.id), kind: x.kind === 'skills' ? 'skills' : 'rules', section: String(x.section || ''), title: String(x.title || ''), text: typeof x.text === 'string' ? x.text : '', agents: Array.isArray(x.agents) ? x.agents.map(String) : [],
        key: typeof x.key === 'string' && x.key ? x.key : null, changed: x.changed === true })); // 0125: a system default (its key) and whether the admin changed it
      return { ok: true, items: KBL, legacy: false };
    } catch (e) { return fail(null); }
  }
  const kbListNow = () => KBL;
  // a kind's whole list in its order (0120 ai_agent_kb_set — 0125: 300 items, 80000 characters, a default's key kept; the checks are the server's too)
  async function kbSetAll(kind, items) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'قواعد المساعدين وسكيلزهم للأدمن بس' };
    if (REG.legacy) return NEED_0120;
    if (!['rules', 'skills'].includes(kind)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    const L = Array.isArray(items) ? items : []; if (L.length > 300) return { ok: false, reason: 'invalid', field: 'items', message: 'لحد 300 بند' };
    let total = 0; const body = [];
    for (const it of L) {
      const sec = clean(it.section, 60); const t = clean(it.title, 80); const x = String(it.text || '').replace(/\r\n?/g, '\n').trim();
      if (!sec || /[<>]/.test(String(it.section))) return { ok: false, reason: 'invalid', field: 'section', message: 'اسم القسم لحد 60 حرف ومن غير < >' };
      if (!t || /[<>]/.test(String(it.title))) return { ok: false, reason: 'invalid', field: 'title', message: 'العنوان لحد 80 حرف ومن غير < >' };
      if (x.length > 1500 || /[<>]/.test(x)) return { ok: false, reason: 'invalid', field: 'text', message: 'التفاصيل لحد 1500 حرف ومن غير < >' };
      total += sec.length + t.length + x.length; body.push(Object.assign({ section: sec, title: t, text: x, agents: (Array.isArray(it.agents) ? it.agents : []).filter((a) => AGENT_RE.test(String(a))) },
        typeof it.key === 'string' && /^[a-z0-9_.-]{2,60}$/.test(it.key) ? { key: it.key } : {}));
    }
    if (total > 80000) return { ok: false, reason: 'invalid', field: 'size', message: 'الكلام كله أكتر من 80000 حرف — قصّر شوية' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try { const { error } = await cl.rpc('ai_agent_kb_set', { p_kind: kind, p_items: body }); if (error) return fail(error); log('agent.kb', kind + ' · ' + body.length, null); await kbList(true); return { ok: true }; }
    catch (e) { return fail(null); }
  }

  // the owner 17 Nov («لو انا بضيف اسكيلز او قواعد اقدر اعيد كتابتها بالذكاء الاصطناعي»): one rule / skill rewritten by the AI — ai-content
  // action «kb» (the admin) → { title, text } for the form; nothing is saved until the admin presses «احفظ»
  async function kbRewrite(item, notes) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'قواعد المساعدين وسكيلزهم للأدمن بس' };
    const it = item || {}; if (!['rules', 'skills'].includes(it.kind)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    if (!String(it.title || '').trim() && !String(it.text || '').trim()) return { ok: false, reason: 'invalid', field: 'text', message: 'اكتب العنوان أو التفاصيل الأول' };
    const r = await invoke('ai-content', { action: 'kb', kind: it.kind, section: String(it.section || '').slice(0, 60), title: String(it.title || '').slice(0, 80), text: String(it.text || '').slice(0, 1500),
      agents: (Array.isArray(it.agents) ? it.agents : []).map((a) => String(a).slice(0, 40)).slice(0, 12), notes: String(notes || '').slice(0, 500) });
    if (!r.ok) return Object.assign(r, { message: aiMessage(r, 'text') });
    const b = r.body || {}; if (b.result === 'refused') return { ok: false, reason: 'refused', message: aiMessage({ reason: 'refused' }, 'text') };
    const title = typeof b.title === 'string' ? b.title.replace(/[<>]/g, '').trim().slice(0, 80) : ''; const text = typeof b.text === 'string' ? b.text.replace(/[<>]/g, '').trim().slice(0, 1500) : '';
    if (!title && !text) return { ok: false, reason: 'invalid', message: 'الـ AI مارجّعش حاجة — جرّب تاني' };
    log('agent.kb.ai', it.kind, null); return { ok: true, title, text };
  }
  // 0125 «رجّع الافتراضي»: keys = the defaults to bring back (null = all of the kind; dropAdded = the admin's own rows of the kind go too)
  async function kbReset(kind, keys, dropAdded) {
    if (!isAdmin()) return { ok: false, reason: 'forbidden', message: 'قواعد المساعدين وسكيلزهم للأدمن بس' };
    if (REG.legacy) return NEED_0120;
    if (!['rules', 'skills'].includes(kind)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    const K2 = keys == null ? null : (Array.isArray(keys) ? keys : []).filter((k) => /^[a-z0-9_.-]{2,60}$/.test(String(k)));
    if (K2 && !K2.length) return { ok: false, reason: 'invalid', message: 'مفيش حاجة افتراضية في اللي اخترته' };
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    try {
      const { data, error } = await cl.rpc('ai_agent_kb_reset', { p_kind: kind, p_keys: K2, p_drop_added: K2 == null && !!dropAdded });
      if (error) return error.code === 'PGRST202' ? { ok: false, reason: 'invalid', message: 'محتاج تحديث الداتا بيز (0125) الأول' } : fail(error);
      log('agent.kb.reset', kind + ' · ' + (K2 ? K2.length : 'all'), null); await kbList(true); return { ok: true, n: Number(data) || 0 };
    } catch (e) { return fail(null); }
  }

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
  function clear() { gen += 1; unsubscribe(); pend.forEach((p) => { if (p.timer) clearTimeout(p.timer); }); pend.clear(); chains.clear(); seenC.clear(); staleC.clear(); urls.clear(); data.campaigns = []; data.posts = []; data.templates = []; data.credits = null; conn = null; connAt = 0; ads = null; adsAt = 0; adsCache.clear(); sugg = null; suggAt = 0; rulesCache = null; rulesAt = 0; st = 'idle'; }

  window.IBMarketing = { load, ensure, clear, state: () => st, can, campaigns, posts, templates, getPost, wallet, credits, open, create, save, saveSoon, flush, forget, archive,
    upload, uploadTemplate, url, cachedUrl, blob, product, refLink, checkFile, generate, magnificStatus, magnificSend, magnificFetch, edit, write, schedule, move, caption, published, remove, pause, resume,
    videoClip, videoVoice, videoMusic, videoAssemble, videoPoll, videoUpload, videoScenes,
    connection, connNow, setAutopublish, publishNow, deleteLive, preparePublish,
    adsStatus, adsNow, adsSync, adsData, adsLinkSet, adsLinkStart, adsLinkPick, adsUnlink, adsWhy,
    suggestions, suggNow, decide, campaignSet, adsDataNow, rules, rulesNow, rulesSet, setLive, requests, reqsNow, addRequest, REQ_KIND: KIND_OF, buyerChat,
    agentChats, agentTurns, agentAsk, agentFacts, agentLocal, agentImage, agentRename, agentDelete, agentSettings, agentSettingsNow, agentSettingsSet, AGENT_KEYS,
    agents, agentsNow, agentOf, agentSave, agentArchive, agentOrder, kbList, kbListNow, kbSetAll, kbReset, kbRewrite, AGENT_PERMS, AGENT_SEES,
    trends, trendsNow, trendsReadyNow, trendsRefresh, trendThumbsFill, trendThumbs, trendThumbNow, trendSettings, trendSettingsNow, trendSettingsSet, adTagsSet, agentKbSet, KB, competitors, competitorsNow, competitorsReadyNow, competitorSave, competitorArchive, competitorBrief,
    siteCheck, siteCheckNow, siteReadyNow, siteCheckRun, siteSpeed, siteSpeedNow, siteSpeedRun, pixel, pixelNow, pixelRun, siteSubs, siteSubsNow, aiSpend, aiSpendNow,
    addTemplate, editTemplate, removeTemplate, templateUsed, subscribe, unsubscribe, check, MAX_BYTES, MIME, BUCKET,
    _test: { toCampaign, toPost, toTemplate, fail, aiMessage, fieldsOf, tplRow, pubMessage, toSuggestion, toRequest, toRules, toChat, toTurn } };
})();
