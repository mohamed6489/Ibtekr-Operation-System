// Phase 9.5.1 (0049): the marketing tables, RPCs and the bucket «marketing», emulated for supabase-mock.mjs (not a test file itself).
// mktState(opts) seeds the rows as the database holds them (opts.mktCampaigns / mktPosts / mktTemplates / mktObjects — path → { type };
// opts.mktCap = the month's image credit cap of the settings row «ai» (null = none), opts.mktUsed = the team's credits this month);
// mktRoute(c) answers a request of those paths (or returns null): RLS as 0049 reads it (marketing.view ≠ N reads; marketing.create F
// writes the campaigns and templates by their granted columns and uploads into an open campaign's folder or templates/; the log's
// rows only through mkt_schedule / mkt_post_act with marketing.publish F and the day / hour rules on Cairo's clock). The AI actions
// (ai-images campaign / campaign_edit, ai-content marketing) are answered here too (mktAi). Every RPC / function call lands in
// mkt.calls, every write the client sent in mkt.writes ({ table, op, ...columns }).
import { campaignGenPath, campaignPathOk, campaignTarget, cleanMarketing, parseCampaign, parseCampaignEdit, parseMarketing } from '../../supabase/functions/_shared/marketing.js';
import { creditsFor } from '../../supabase/functions/_shared/ai-images.js';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const cairo = (d = new Date()) => { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
export const mktToday = () => cairo().day;
export const mktAddDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const MKT_ID = (n) => 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0'); // the n-th campaign (seeded 1–9, inserted from 101)
export const MKT_TPL = (n) => 'f1000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const COLS = {
  mkt_campaigns: ['id', 'name', 'goal', 'step', 'state', 'scheduled_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'archived_at', 'archived_by'],
  mkt_posts: ['id', 'campaign_id', 'piece', 'kind', 'name', 'caption', 'caption_orig', 'tags', 'images', 'platform', 'day', 'time', 'how', 'status', 'was_live', 'post_url', 'published_at', 'published_by', 'deleted_at', 'deleted_by', 'created_by', 'created_at', 'updated_by', 'updated_at',
    'src', 'external_id', 'thumb', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'eng', 'stats_at', 'error', 'attempts', 'claimed_at', 'work'],
  mkt_templates: ['id', 'name', 'kind', 'image', 'descr', 'used', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by'],
  // 0052 (9.5.3): Meta's ad objects and daily numbers — read with marketing.view, written by mkt-ads only
  mkt_ad_objects: ['platform', 'kind', 'id', 'parent_id', 'name', 'status', 'thumb', 'meta', 'updated_at'],
  mkt_ad_stats: ['platform', 'level', 'object_id', 'campaign_id', 'day', 'spend', 'impressions', 'reach', 'clicks', 'link_clicks', 'frequency', 'purchases', 'purchase_value', 'updated_at'],
};
const KEY = { mkt_campaigns: 'campaigns', mkt_posts: 'posts', mkt_templates: 'templates', mkt_ad_objects: 'adObjects', mkt_ad_stats: 'adStats' };
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
// 0051's columns as a system row starts
const POST_9_5_2 = { src: 'system', external_id: null, thumb: null, views: null, reach: null, likes: null, comments: null, shares: null, saves: null, eng: null, stats_at: null, error: null, attempts: 0, claimed_at: null, work: null };

export function mktState(opts = {}) {
  const now = new Date().toISOString();
  return {
    campaigns: (opts.mktCampaigns || []).map((x) => ({ goal: null, step: 1, state: {}, scheduled_at: null, created_by: null, created_at: now, updated_by: null, updated_at: now, archived_at: null, archived_by: null, ...x })),
    posts: (opts.mktPosts || []).map((x, i) => ({ id: i + 1, campaign_id: null, piece: null, caption: '', caption_orig: x.caption || '', tags: '', images: [], how: 'download', status: 'مجدول', was_live: false, post_url: null,
      published_at: null, published_by: null, deleted_at: null, deleted_by: null, created_by: null, created_at: now, updated_by: null, updated_at: now, ...POST_9_5_2, ...x })),
    templates: (opts.mktTemplates || []).map((x) => ({ image: null, descr: '', used: 0, created_by: null, created_at: now, updated_by: null, updated_at: now, deleted_at: null, deleted_by: null, ...x })),
    objects: new Map(Object.entries(opts.mktObjects || {})),
    cap: opts.mktCap === undefined ? 5000 : opts.mktCap, used: Number(opts.mktUsed) || 0,
    calls: [], writes: [], seq: 1000, ncamp: 100, ntpl: 100, signed: 0, down: false,
    imgFail: null, aiFail: null, aiAnswer: null, // a spec's knobs: imgFail / aiFail = 'ai_cap' | 'busy' | 'not_configured' | 'ai_error' | 'refused'
    // 9.5.2: mkt-publish's status (opts.mktConn merges over a page linked for publishing with the switch off) and the knobs
    // pubFail / delFail = a code of ours (token / permission / image …) the next publish_now / delete answers with
    conn: { autopublish: false, facebook: { linked: true, name: 'Ibtekr Club', publish: true, insights: true }, instagram: { linked: true, name: '@ibtekr.club', publish: true, insights: true }, missing: [], valid: true, configured: true, ...(opts.mktConn || {}) },
    pubFail: null, delFail: null,
    // 9.5.3: Meta's objects / daily numbers, the ad orders as mkt_ads_orders answers them (the share nulled without accounts.view),
    // mkt-ads's status (opts.mktAds merges over a linked account) and the knob adsFail = our code the next sync answers with
    adObjects: (opts.mktAdObjects || []).map((x) => ({ platform: 'meta', parent_id: null, name: null, status: null, thumb: null, meta: {}, updated_at: now, ...x })),
    adStats: (opts.mktAdStats || []).map((x) => ({ platform: 'meta', impressions: 0, reach: null, clicks: 0, link_clicks: null, frequency: null, purchases: 0, purchase_value: 0, updated_at: now, ...x })),
    adOrders: opts.mktAdOrders || [],
    ads: { configured: true, account: { name: 'Ibtekr Club', currency: 'EGP', status: 'ACTIVE' }, synced_at: now, checked_at: now, error: null, ...(opts.mktAds || {}) },
    adsFail: null,
  };
}

export function mktRoute(c) {
  const { method, path, url, hd, u, hasPerm, isAdmin, json, mock, route } = c; const H = mock.mkt; if (!H) return null;
  const rest = /^\/rest\/v1\/(mkt_[a-z_]+)$/.exec(path); const rpc = /^\/rest\/v1\/rpc\/(mkt_[a-z_]+)$/.exec(path);
  const sto = /^\/storage\/v1\/object\/(sign\/)?marketing\/(.+)$/.exec(path);
  const fn = method === 'POST' && (path === '/functions/v1/ai-images' || path === '/functions/v1/ai-content' || path === '/functions/v1/mkt-publish' || path === '/functions/v1/mkt-ads');
  if (!(rest && COLS[rest[1]]) && !rpc && !sto && !fn) return null;
  // a signed URL opened with no key (an <img>): any token the mock signed opens the object
  if (sto && sto[1] && method === 'GET') { const obj = H.objects.get(decodeURIComponent(sto[2])); return obj ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': obj.type || 'image/png' }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
  if (fn && path === '/functions/v1/mkt-publish') return mktPublish(c, c.body());
  if (fn && path === '/functions/v1/mkt-ads') return mktAds(c, c.body());
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
    if (name === 'mkt_ads_orders') {
      if (!view) return refuse(403, '42501', 'marketing.view is needed');
      const a = c.body() || {}; if (!a.p_from || !a.p_to || a.p_to < a.p_from) return refuse(400, '22023', 'the range is from <= to, at most 400 days');
      const money = isAdmin(u) || hasPerm(u, 'accounts.view') !== 'N';
      return json(200, H.adOrders.filter((r) => r.day >= a.p_from && r.day <= a.p_to).map((r) => ({ ...r, share: money ? r.share : null })));
    }
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
        const how = it.how == null ? 'download' : it.how; if (!['download', 'publish'].includes(how)) return bad('how');
        if (how === 'publish') { // 0051
          if (!['انستجرام', 'فيسبوك'].includes(it.platform) || !['بوست', 'كاروسيل', 'ستوري'].includes(it.kind)) return bad('how');
          if (!imgs.length || imgs.length > 10 || (it.kind === 'كاروسيل' ? imgs.length < 2 : imgs.length !== 1)) return bad('images');
          if (it.platform === 'انستجرام' && imgs.some((x) => !/\.jpe?g$/i.test(x))) return bad('images');
          if (it.platform === 'انستجرام' && it.kind !== 'ستوري' && cap.length + (tags ? tags.length + 2 : 0) > 2200) return bad('caption');
        }
        const k = it.piece + '|' + it.platform; if (keys.includes(k)) return bad('items'); keys.push(k);
        plan.push({ piece: it.piece, kind: it.kind, name: line(it.name, 200) || it.kind, caption: cap, tags, images: imgs.slice(), platform: it.platform, day: d, time: it.time, how });
      }
      for (const p of plan) {
        const ex = H.posts.find((x) => x.campaign_id === camp.id && x.piece === p.piece && x.platform === p.platform && x.status !== 'اتحذف');
        if (ex) { if (['مجدول', 'فشل'].includes(ex.status)) Object.assign(ex, p, { caption_orig: p.caption, status: 'مجدول', updated_by: u.id, updated_at: now }); }
        else { H.seq += 1; H.posts.push({ id: H.seq, campaign_id: camp.id, ...POST_9_5_2, ...p, caption_orig: p.caption, status: 'مجدول', was_live: false, post_url: null, published_at: null, published_by: null, deleted_at: null, deleted_by: null, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now }); }
      }
      H.posts.filter((x) => x.campaign_id === camp.id && ['مجدول', 'فشل'].includes(x.status) && !keys.includes(x.piece + '|' + x.platform)).forEach((x) => Object.assign(x, { status: 'اتحذف', deleted_at: now, deleted_by: u.id, updated_at: now }));
      Object.assign(camp, { scheduled_at: now, step: 4, updated_at: now, updated_by: u.id });
      H.writes.push({ table: 'mkt_posts', op: 'schedule', campaign: camp.id, items: plan.length, publish: plan.filter((p) => p.how === 'publish').length, images: plan.filter((p) => p.how === 'publish').flatMap((p) => p.images) });
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
  const test = ([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v.startsWith('gte.') ? (r) => String(r[k]) >= v.slice(4) : v.startsWith('lte.') ? (r) => String(r[k]) <= v.slice(4) : v === 'is.null' ? (r) => r[k] == null
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
  if (t === 'mkt_posts' || t === 'mkt_ad_objects' || t === 'mkt_ad_stats') return refuse(403, '42501', 'permission denied for table ' + t);
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

// the AI actions of the marketing page, with the server's own checks (_shared/marketing.js): ai-images campaign / campaign_edit
// (marketing.create F or the admin; the piece read from the campaign as saved; the month's cap → 402; a 1×1 PNG in the bucket) and
// ai-content marketing (fill from the saved piece, rewrite, describe — the answer H.aiAnswer(req, target) or the default below,
// cleaned by the server's own cleanMarketing). H.imgFail / H.aiFail = 'ai_cap' | 'busy' | 'not_configured' | 'ai_error' | 'refused'.
function mktAi(c, b) {
  const { u, json, hasPerm, isAdmin, mock } = c; const H = mock.mkt;
  H.calls.push({ fn: b.action === 'marketing' ? 'ai-content' : 'ai-images', action: b.action, task: b.task || null, by: u ? u.id : null, piece: b.piece || null, slide: b.slide == null ? null : b.slide, kind: b.kind || null, model: b.model || null, pins: Array.isArray(b.pins) ? b.pins.length : 0 });
  if (!u || !(isAdmin(u) || hasPerm(u, 'marketing.create') === 'F')) return json(401, { error: 'unauthorized' });
  const failWith = (k) => (k === 'refused' ? json(200, { result: 'refused', model: 'mock' }) : json(k === 'ai_cap' ? 402 : k === 'busy' ? 429 : k === 'not_configured' ? 503 : 502, { error: k, configured: k === 'not_configured' ? false : undefined }));
  const campaign = (id) => H.campaigns.find((x) => x.id === id && !x.archived_at) || null;
  if (b.action === 'marketing') {
    const p = parseMarketing(b); if ('error' in p) return json(400, p);
    let target = null;
    if (p.req.campaignId) {
      const camp = campaign(p.req.campaignId); if (!camp) return json(404, { error: 'not_found' });
      if (p.req.piece) { target = campaignTarget(camp.state, p.req.piece, p.req.slide); if (!target) return json(400, { error: 'bad_request', field: 'piece' }); }
    }
    if (H.aiFail) return failWith(H.aiFail);
    const answer = H.aiAnswer ? H.aiAnswer(p.req, target) : p.req.task === 'fill'
      ? { idea: 'لقطة لـ ' + (target ? target.label : 'القطعة') + ' في قعدة دافية', caption: 'كولكشن جديد وصل إبتكر ✨ مشغول يدويًا في مصر', title: 'دفا الشتا', sub: 'مشغولة يدويًا', badge: 'جديد',
        slides: Array.from({ length: target ? target.slides : 0 }, (_, i) => ({ idea: 'تفصيلة ' + (i + 1), title: 'شريحة ' + (i + 1), sub: '' })) }
      : p.req.task === 'describe' ? { text: 'المنتج في النص على خلفية كريمي، والعنوان فوق بالأخضر، وبادج صغير في الركن.' }
      : { text: ({ title: 'دفا الشتا بإيد مصرية', sub: 'كولكشن الشتا وصل', badge: 'جديد', caption: 'الدفا الحقيقي من إيد صانعة مصرية 🧶\nاطلب قطعتك من إبتكر' })[p.req.kind] || 'كلام جديد مكتوب بالـ AI' };
    H.seq += 1; return json(200, { result: 'ok', ...cleanMarketing(answer, p.req, target), model: 'claude-opus-5-5', cost_usd: 0.004, run_id: H.seq });
  }
  const parsed = b.action === 'campaign' ? parseCampaign(b) : parseCampaignEdit(b); if ('error' in parsed) return json(400, parsed);
  const req = parsed.req; const camp = campaign(req.campaignId); if (!camp) return json(404, { error: 'not_found' });
  const t = campaignTarget(camp.state, req.piece, req.slide); if (!t) return json(400, { error: 'bad_request', field: 'piece' });
  const edit = b.action === 'campaign_edit';
  if (edit && !campaignPathOk(camp.id, t.target.img)) return json(400, { error: 'bad_request', field: 'image' });
  const credits = creditsFor(req.model, 1);
  if (H.cap != null && H.used + credits > H.cap) return json(402, { error: 'ai_cap' });
  if (H.imgFail) return failWith(H.imgFail);
  H.seq += 1; const path = campaignGenPath(camp.id, req.piece, req.slide, 'mk' + H.seq, 'png', edit);
  H.objects.set(path, { type: 'image/png', size: 68, by: u.id }); H.used += credits;
  return json(200, { result: 'ok', bucket: 'marketing', path, paths: [path], credits, model: req.model, run_id: H.seq });
}

// 9.5.2: mkt-publish as the page sees it — status (marketing.view), autopublish (the admin), publish_now (marketing.publish F, the
// switch on, a waiting / failed system row → «اتنشر» with a platform id and link, its day and hour now; H.pubFail → 502 + «فشل»),
// delete (a live row with its platform id → «اتحذف» was_live; H.delFail → 502, the row stays live)
function mktPublish(c, b) {
  const { u, hasPerm, isAdmin, json, mock } = c; const H = mock.mkt;
  H.calls.push({ fn: 'mkt-publish', action: b.action || null, by: u ? u.id : null, id: b.id == null ? null : b.id, on: b.on == null ? null : b.on });
  if (!u) return json(401, { error: 'unauthorized' });
  const admin = isAdmin(u); const view = admin || hasPerm(u, 'marketing.view') !== 'N'; const publish = admin || hasPerm(u, 'marketing.publish') === 'F';
  const now = new Date().toISOString(); const { day, hm } = cairo();
  if (b.action === 'status') return view ? json(200, { result: 'ok', ...JSON.parse(JSON.stringify(H.conn)) }) : json(401, { error: 'unauthorized' });
  if (b.action === 'autopublish') {
    if (!admin) return json(401, { error: 'unauthorized' }); if (typeof b.on !== 'boolean') return json(400, { error: 'bad_request', field: 'on' });
    H.conn.autopublish = b.on; H.writes.push({ table: 'settings', op: 'autopublish', on: b.on }); return json(200, { result: 'ok', autopublish: b.on });
  }
  if (!publish) return json(401, { error: 'unauthorized' });
  const x = H.posts.find((p) => p.id === Number(b.id)); if (!x) return json(404, { error: 'not_found' });
  if (b.action === 'publish_now') {
    if (!H.conn.autopublish) return json(409, { error: 'off' });
    if (x.src !== 'system' || !['مجدول', 'فشل'].includes(x.status)) return json(409, { error: 'status' });
    if (H.pubFail) { Object.assign(x, { status: 'فشل', error: H.pubFail, day, time: hm, updated_at: now }); H.writes.push({ table: 'mkt_posts', op: 'publish_now', id: x.id, error: H.pubFail }); return json(502, { error: H.pubFail }); }
    const ig = x.platform === 'انستجرام'; const ext = ig ? '1789' + x.id : '111_9' + x.id;
    const link = ig ? 'https://www.instagram.com/p/mk' + x.id + '/' : 'https://www.facebook.com/111/posts/9' + x.id;
    Object.assign(x, { status: 'اتنشر', how: 'publish', external_id: ext, post_url: link, published_at: now, error: null, claimed_at: null, day, time: hm, updated_at: now });
    H.writes.push({ table: 'mkt_posts', op: 'publish_now', id: x.id }); return json(200, { result: 'ok', status: 'اتنشر', url: link });
  }
  if (b.action === 'delete') {
    if (x.status !== 'اتنشر' || !x.external_id) return json(409, { error: 'status' });
    if (H.delFail) return json(502, { error: H.delFail });
    Object.assign(x, { status: 'اتحذف', was_live: true, deleted_at: now, deleted_by: u.id, updated_at: now });
    H.writes.push({ table: 'mkt_posts', op: 'delete_live', id: x.id }); return json(200, { result: 'ok', status: 'اتحذف' });
  }
  return json(400, { error: 'unknown_action' });
}

// 9.5.3: mkt-ads — status (marketing.view) and the admin's sync by hand; the knob adsFail answers a sync with our code (502)
function mktAds(c, b) {
  const { u, hasPerm, isAdmin, json, mock } = c; const H = mock.mkt;
  H.calls.push({ fn: 'mkt-ads', action: b.action || null, by: u ? u.id : null, days: b.days == null ? null : b.days });
  if (!u) return json(401, { error: 'unauthorized' });
  const admin = isAdmin(u); const view = admin || hasPerm(u, 'marketing.view') !== 'N';
  if (b.action === 'status') return view ? json(200, H.ads) : json(401, { error: 'unauthorized' });
  if (b.action !== 'sync') return json(400, { error: 'unknown_action' });
  if (!admin) return json(401, { error: 'unauthorized' });
  if (!H.ads.configured) return json(503, { error: 'not_configured', configured: false });
  const now = new Date().toISOString();
  if (H.adsFail) { Object.assign(H.ads, { checked_at: now, error: H.adsFail }); return json(502, { error: H.adsFail }); }
  Object.assign(H.ads, { synced_at: now, checked_at: now, error: null });
  return json(200, { result: 'ok', days: Number(b.days) || 3, campaigns: H.adObjects.filter((o) => o.kind === 'campaign').length, ads: H.adObjects.filter((o) => o.kind === 'ad').length, stats: H.adStats.length });
}
