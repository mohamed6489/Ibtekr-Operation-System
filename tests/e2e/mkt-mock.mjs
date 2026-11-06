// Phase 9.5.1 (0049): the marketing tables, RPCs and the bucket «marketing», emulated for supabase-mock.mjs (not a test file itself).
// mktState(opts) seeds the rows as the database holds them (opts.mktCampaigns / mktPosts / mktTemplates / mktObjects — path → { type };
// opts.mktCap = the month's image credit cap of the settings row «ai» (null = none), opts.mktUsed = the team's credits this month);
// mktRoute(c) answers a request of those paths (or returns null): RLS as 0049 reads it (marketing.view ≠ N reads; marketing.create F
// writes the campaigns and templates by their granted columns and uploads into an open campaign's folder or templates/; the log's
// rows only through mkt_schedule / mkt_post_act with marketing.publish F and the day / hour rules on Cairo's clock). The AI actions
// (ai-images campaign / campaign_edit, ai-content marketing) are answered here too (mktAi). Every RPC / function call lands in
// mkt.calls, every write the client sent in mkt.writes ({ table, op, ...columns }).
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const cairo = (d = new Date()) => { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
export const mktToday = () => cairo().day;
export const mktAddDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const MKT_ID = (n) => 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0'); // the n-th campaign (seeded 1–9, inserted from 101)
export const MKT_TPL = (n) => 'f1000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const COLS = {
  mkt_campaigns: ['id', 'name', 'goal', 'step', 'state', 'scheduled_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'archived_at', 'archived_by'],
  mkt_posts: ['id', 'campaign_id', 'piece', 'kind', 'name', 'caption', 'caption_orig', 'tags', 'images', 'platform', 'day', 'time', 'how', 'status', 'was_live', 'post_url', 'published_at', 'published_by', 'deleted_at', 'deleted_by', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  mkt_templates: ['id', 'name', 'kind', 'image', 'descr', 'used', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by'],
};
const KEY = { mkt_campaigns: 'campaigns', mkt_posts: 'posts', mkt_templates: 'templates' };
const GRANT = { mkt_campaigns: { insert: ['name', 'goal', 'step', 'state'], update: ['name', 'goal', 'step', 'state', 'archived_at'] },
  mkt_templates: { insert: ['name', 'kind', 'image', 'descr'], update: ['name', 'kind', 'image', 'descr', 'deleted_at'] } };
const GOALS = ['منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم'];
const KINDS = ['بوست', 'كاروسيل', 'ريل', 'ستوري'];
const PLATFORMS = ['انستجرام', 'فيسبوك', 'تيك توك'];
const MIME = ['image/png', 'image/jpeg', 'image/webp'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const line = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0001-\u0009\u000b-\u001f\u007f]/g, ' ').trim();

export function mktState(opts = {}) {
  const now = new Date().toISOString();
  return {
    campaigns: (opts.mktCampaigns || []).map((x) => ({ goal: null, step: 1, state: {}, scheduled_at: null, created_by: null, created_at: now, updated_by: null, updated_at: now, archived_at: null, archived_by: null, ...x })),
    posts: (opts.mktPosts || []).map((x, i) => ({ id: i + 1, campaign_id: null, piece: null, caption: '', caption_orig: x.caption || '', tags: '', images: [], how: 'download', status: 'مجدول', was_live: false, post_url: null,
      published_at: null, published_by: null, deleted_at: null, deleted_by: null, created_by: null, created_at: now, updated_by: null, updated_at: now, ...x })),
    templates: (opts.mktTemplates || []).map((x) => ({ image: null, descr: '', used: 0, created_by: null, created_at: now, updated_by: null, updated_at: now, deleted_at: null, deleted_by: null, ...x })),
    objects: new Map(Object.entries(opts.mktObjects || {})),
    cap: opts.mktCap === undefined ? 5000 : opts.mktCap, used: Number(opts.mktUsed) || 0,
    calls: [], writes: [], seq: 1000, ncamp: 100, ntpl: 100, signed: 0, down: false,
    imgFail: null, aiFail: null, aiAnswer: null, // a spec's knobs: imgFail / aiFail = 'ai_cap' | 'busy' | 'not_configured' | 'ai_error' | 'refused'
  };
}

export function mktRoute(c) {
  const { method, path, url, hd, u, hasPerm, isAdmin, json, mock, route } = c; const H = mock.mkt; if (!H) return null;
  const rest = /^\/rest\/v1\/(mkt_[a-z]+)$/.exec(path); const rpc = /^\/rest\/v1\/rpc\/(mkt_[a-z_]+)$/.exec(path);
  const sto = /^\/storage\/v1\/object\/(sign\/)?marketing\/(.+)$/.exec(path);
  const fn = method === 'POST' && (path === '/functions/v1/ai-images' || path === '/functions/v1/ai-content');
  if (!(rest && COLS[rest[1]]) && !rpc && !sto && !fn) return null;
  // a signed URL opened with no key (an <img>): any token the mock signed opens the object
  if (sto && sto[1] && method === 'GET') { const obj = H.objects.get(decodeURIComponent(sto[2])); return obj ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': obj.type || 'image/png' }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
  if (fn) { const b = c.body(); if (path === '/functions/v1/ai-images' ? !['campaign', 'campaign_edit'].includes(b.action) : b.action !== 'marketing') return null; return mktAi(c, b); }
  const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
  if (!u) return sto ? json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' }) : refuse(401, '42501', 'permission denied');
  const view = hasPerm(u, 'marketing.view') !== 'N'; const create = hasPerm(u, 'marketing.create') === 'F'; const publish = hasPerm(u, 'marketing.publish') === 'F';
  const now = new Date().toISOString(); const { day: today, hm } = cairo();
  const open = (id) => H.campaigns.find((x) => x.id === id && !x.archived_at) || null;

  // ---------- Storage, bucket «marketing» ----------
  if (sto) {
    const key = decodeURIComponent(sto[2]);
    if (method === 'POST' && sto[1]) {
      if (!view || !H.objects.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
      H.signed += 1; return json(200, { signedURL: '/object/sign/marketing/' + key + '?token=mk-' + H.signed });
    }
    if (method === 'GET') { // download (authenticated)
      const obj = view && H.objects.get(key); if (!obj) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': obj.type || 'image/png' }, body: PNG_1PX });
    }
    if (method === 'POST') {
      const folder = key.split('/')[0];
      if (!create || !(folder === 'templates' || open(folder))) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      let type = hd['content-type'] || ''; let bytes = route.request().postDataBuffer() || Buffer.alloc(0);
      if (/^multipart\/form-data/.test(type)) { const raw = bytes.toString('latin1'); const m = /Content-Type:\s*([^\r\n]+)\r\n\r\n/i.exec(raw); type = m ? m[1].trim() : ''; if (m) { const start = m.index + m[0].length; const end = raw.indexOf('\r\n--', start); bytes = bytes.subarray(start, end < 0 ? undefined : end); } }
      if (!MIME.includes(type)) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + type + ' is not supported' });
      if (bytes.length > 15728640) return json(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (H.objects.has(key)) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      H.objects.set(key, { type, size: bytes.length, by: u.id }); H.writes.push({ table: 'storage:marketing', op: 'upload', path: key });
      return json(200, { Key: 'marketing/' + key, Id: 'obj-mk-' + H.objects.size });
    }
    return json(405, { statusCode: '405', error: 'method not allowed' });
  }

  // ---------- the RPCs ----------
  if (rpc) {
    const b = c.body(); const name = rpc[1]; H.calls.push({ rpc: name, by: u.id, ...b });
    const bad = (field) => refuse(400, '22023', 'invalid: ' + field);
    if (name === 'mkt_credits') return json(200, create ? { cap: H.cap, used: H.used } : null);
    if (name === 'mkt_template_used') {
      if (!create) return refuse(403, '42501', 'not allowed');
      const t = H.templates.find((x) => x.id === b.p_id && !x.deleted_at); if (!t) return refuse(404, 'P0002', 'not found');
      t.used += 1; return json(200, t.used);
    }
    if (name === 'mkt_schedule') {
      if (!publish) return refuse(403, '42501', 'not allowed');
      const camp = open(b.p_campaign); if (!camp) return refuse(404, 'P0002', 'not found');
      const items = b.p_items; if (!Array.isArray(items) || !items.length || items.length > 100) return bad('items');
      const keys = []; const plan = [];
      for (const it of items) {
        if (!it || typeof it !== 'object') return bad('items');
        if (!/^[A-Z][0-9]{1,2}$/.test(String(it.piece || ''))) return bad('piece');
        if (!KINDS.includes(it.kind)) return bad('kind');
        const cap = lines(it.caption); if (cap.length > 2200) return bad('caption');
        const tags = line(it.tags, 1000); if (tags.length > 300) return bad('tags');
        const imgs = Array.isArray(it.images) ? it.images : []; if (imgs.length > 11 || imgs.some((p) => !new RegExp('^' + camp.id + '/[A-Za-z0-9._-]{1,120}$').test(String(p)))) return bad('images');
        if (!PLATFORMS.includes(it.platform)) return bad('platform');
        const d = String(it.day || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || d > mktAddDays(today, 365)) return bad('day');
        if (!HM.test(String(it.time || '')) || (d === today && it.time <= hm)) return bad('time');
        const k = it.piece + '|' + it.platform; if (keys.includes(k)) return bad('items'); keys.push(k);
        plan.push({ piece: it.piece, kind: it.kind, name: line(it.name, 200) || it.kind, caption: cap, tags, images: imgs.slice(), platform: it.platform, day: d, time: it.time });
      }
      for (const p of plan) {
        const ex = H.posts.find((x) => x.campaign_id === camp.id && x.piece === p.piece && x.platform === p.platform && x.status !== 'اتحذف');
        if (ex) { if (['مجدول', 'فشل'].includes(ex.status)) Object.assign(ex, p, { caption_orig: p.caption, status: 'مجدول', updated_by: u.id, updated_at: now }); }
        else { H.seq += 1; H.posts.push({ id: H.seq, campaign_id: camp.id, ...p, caption_orig: p.caption, how: 'download', status: 'مجدول', was_live: false, post_url: null, published_at: null, published_by: null, deleted_at: null, deleted_by: null, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now }); }
      }
      H.posts.filter((x) => x.campaign_id === camp.id && ['مجدول', 'فشل'].includes(x.status) && !keys.includes(x.piece + '|' + x.platform)).forEach((x) => Object.assign(x, { status: 'اتحذف', deleted_at: now, deleted_by: u.id, updated_at: now }));
      Object.assign(camp, { scheduled_at: now, step: 4, updated_at: now, updated_by: u.id });
      H.writes.push({ table: 'mkt_posts', op: 'schedule', campaign: camp.id, items: plan.length });
      return json(200, H.posts.filter((x) => x.campaign_id === camp.id && ['مجدول', 'فشل'].includes(x.status)).length);
    }
    if (name === 'mkt_post_act') {
      const a = b.p_args && typeof b.p_args === 'object' ? b.p_args : {};
      if (!publish) return refuse(403, '42501', 'not allowed');
      const x = H.posts.find((p) => p.id === Number(b.p_id)); if (!x) return refuse(404, 'P0002', 'not found');
      const waiting = ['مجدول', 'فشل'].includes(x.status);
      if (b.p_action === 'move') {
        if (!waiting) return bad('status');
        const d = String(a.day || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || d > mktAddDays(today, 365)) return bad('day');
        if (!HM.test(String(a.time || '')) || (d === today && a.time <= hm)) return bad('time');
        if (d === x.day && a.time === x.time) return bad('same');
        Object.assign(x, { day: d, time: a.time, status: 'مجدول', updated_by: u.id, updated_at: now }); H.writes.push({ table: 'mkt_posts', op: 'move', id: x.id, day: d, time: a.time }); return json(200, 'مجدول');
      }
      if (b.p_action === 'caption') {
        if (!waiting) return bad('status'); const t = lines(a.text); if (t.length > 2200) return bad('caption');
        Object.assign(x, { caption: t, updated_by: u.id, updated_at: now }); H.writes.push({ table: 'mkt_posts', op: 'caption', id: x.id }); return json(200, x.status);
      }
      if (b.p_action === 'published') {
        if (!waiting) return bad('status'); const link = String(a.url || '').trim() || null;
        if (link && (!/^https:\/\/[^\s<>"]+$/.test(link) || link.length > 500)) return bad('url');
        Object.assign(x, { status: 'اتنشر', published_at: now, published_by: u.id, post_url: link, updated_by: u.id, updated_at: now }); H.writes.push({ table: 'mkt_posts', op: 'published', id: x.id }); return json(200, 'اتنشر');
      }
      if (b.p_action === 'delete') {
        if (!(waiting || x.status === 'اتنشر')) return bad('status');
        Object.assign(x, { was_live: x.status === 'اتنشر', status: 'اتحذف', deleted_at: now, deleted_by: u.id, updated_by: u.id, updated_at: now }); H.writes.push({ table: 'mkt_posts', op: 'delete', id: x.id }); return json(200, 'اتحذف');
      }
      return bad('action');
    }
    return refuse(404, 'PGRST202', 'Could not find the function public.' + name);
  }

  // ---------- the tables ----------
  const t = rest[1]; const key = KEY[t];
  const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
  const params = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k));
  const test = ([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v === 'is.null' ? (r) => r[k] == null
    : /^in\.\(.*\)$/.test(v) ? ((set) => (r) => set.includes(String(r[k])))(v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1'))) : null);
  const fns = params.map(test); if (fns.some((x) => !x)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + t + ': ' + params.map((p) => p.join('=')).join('&'));
  const match = (r) => fns.every((x) => x(r));
  const sel = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim()); const miss = sel.find((x) => x !== '*' && !COLS[t].includes(x));
  if (miss) return refuse(400, '42703', 'column ' + t + '.' + miss + ' does not exist');
  const pick = (r) => (sel.includes('*') ? { ...r } : Object.fromEntries(sel.map((x) => [x, r[x] === undefined ? null : r[x]])));
  const answer = (list) => (single ? (list.length ? json(200, pick(list[0])) : refuse(406, 'PGRST116', 'no rows')) : json(200, list.map(pick)));
  if (method === 'GET') {
    if (!view) return json(200, []);
    let list = H[key].filter(match);
    const ord = url.searchParams.get('order'); if (ord) { const [col, dir] = ord.split('.'); list = list.slice().sort((a, b2) => (a[col] < b2[col] ? -1 : a[col] > b2[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const lim = Number(url.searchParams.get('limit')); if (lim > 0) list = list.slice(0, lim);
    return answer(list);
  }
  if (H.down) return json(503, { message: 'mock: marketing down' });
  if (t === 'mkt_posts') return refuse(403, '42501', 'permission denied for table mkt_posts');
  const b = c.body(); const list = [].concat(b);
  const g = GRANT[t];
  if (method === 'POST') {
    if (list.some((r) => Object.keys(r || {}).some((k) => !g.insert.includes(k)))) return refuse(403, '42501', 'permission denied for table ' + t);
    if (!create) return refuse(403, '42501', 'new row violates row-level security policy for table "' + t + '"');
    const made = [];
    for (const r of list) {
      if (t === 'mkt_campaigns') {
        if (r.goal != null && !GOALS.includes(r.goal)) return refuse(400, '23514', 'mkt_campaigns_goal_check');
        if (r.step != null && !(r.step >= 1 && r.step <= 4)) return refuse(400, '23514', 'mkt_campaigns_step_check');
        H.ncamp += 1; const rec = { id: MKT_ID(H.ncamp), name: r.name || 'كامبين من غير اسم', goal: r.goal || null, step: r.step || 1, state: r.state || {}, scheduled_at: null, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now, archived_at: null, archived_by: null };
        H.campaigns.push(rec); made.push(rec);
      } else {
        if (!['post', 'carousel', 'video'].includes(r.kind)) return refuse(400, '23514', 'mkt_templates_kind_check');
        if (r.image != null && !/^templates\/[A-Za-z0-9._-]{1,120}$/.test(r.image)) return refuse(400, '23514', 'mkt_templates_image_check');
        H.ntpl += 1; const rec = { id: MKT_TPL(H.ntpl), name: r.name, kind: r.kind, image: r.image || null, descr: r.descr || '', used: 0, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now, deleted_at: null, deleted_by: null };
        H.templates.push(rec); made.push(rec);
      }
      H.writes.push({ table: t, op: 'insert', ...r });
    }
    return single ? json(201, pick(made[0])) : json(201, made.map(pick));
  }
  if (method === 'PATCH') {
    if (Object.keys(b || {}).some((k) => !g.update.includes(k))) return refuse(403, '42501', 'permission denied for table ' + t);
    if (!create) return json(200, []);
    const rows = H[key].filter((r) => match(r) && !(t === 'mkt_campaigns' ? r.archived_at : r.deleted_at));
    for (const r of rows) {
      if (t === 'mkt_campaigns' && b.step != null && !(b.step >= 1 && b.step <= 4)) return refuse(400, '23514', 'mkt_campaigns_step_check');
      Object.assign(r, b, { updated_by: u.id, updated_at: now });
      if (t === 'mkt_campaigns' && b.archived_at) Object.assign(r, { archived_at: now, archived_by: u.id });
      if (t === 'mkt_templates' && b.deleted_at) Object.assign(r, { deleted_at: now, deleted_by: u.id });
      H.writes.push({ table: t, op: 'update', id: r.id, ...Object.fromEntries(Object.keys(b).map((k) => [k, k === 'state' ? '…' : b[k]])) });
    }
    return answer(rows);
  }
  return refuse(405, '42501', 'method not allowed');
}

// the AI actions of the marketing page (T4 fills the answers with the server's own checks)
function mktAi(c, b) {
  const { u, json, mock } = c; const H = mock.mkt;
  H.calls.push({ fn: b.action === 'marketing' ? 'ai-content' : 'ai-images', action: b.action, task: b.task, by: u ? u.id : null, piece: b.piece, slide: b.slide, kind: b.kind });
  return json(501, { error: 'not_implemented' });
}
