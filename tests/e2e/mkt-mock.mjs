// Phase 9.5.1 (0049): the marketing tables, RPCs and the bucket «marketing», emulated for supabase-mock.mjs (not a test file itself).
// mktState(opts) seeds the rows as the database holds them (opts.mktCampaigns / mktPosts / mktTemplates / mktObjects — path → { type };
// opts.mktCap = the month's image credit cap of the settings row «ai» (null = none), opts.mktUsed = the team's credits this month);
// mktRoute(c) answers a request of those paths (or returns null): RLS as 0049 reads it (marketing.view ≠ N reads; marketing.create F
// writes the campaigns and templates by their granted columns and uploads into an open campaign's folder or templates/; the log's
// rows only through mkt_schedule / mkt_post_act with marketing.publish F and the day / hour rules on Cairo's clock). The AI actions
// (ai-images campaign / campaign_edit, ai-content marketing) are answered here too (mktAi). Every RPC / function call lands in
// mkt.calls, every write the client sent in mkt.writes ({ table, op, ...columns }).
import { campaignGenPath, campaignPathOk, campaignTarget, cleanBuyer, cleanMarketing, parseBuyer, parseCampaign, parseCampaignEdit, parseMarketing } from '../../supabase/functions/_shared/marketing.js';
import { BUYER_DEFAULTS, MAX_STEP, budgetPlan, rulesPatch } from '../../supabase/functions/_shared/mkt-ads.js';
import { MAX_OPEN_JOBS, cleanScenes, jobView, mixPlan, nextMix, parseVideo, videoPath } from '../../supabase/functions/_shared/mkt-video.js';
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
  // 0053 (9.5.4): the buyer's suggestions (the server's rows, read with marketing.view) and the designer / developer requests
  mkt_suggestions: ['id', 'platform', 'kind', 'campaign_id', 'campaign_name', 'ad_id', 'title', 'sub', 'why', 'impact', 'pct', 'data', 'status', 'created_at', 'checked_at', 'decided_by', 'decided_at', 'value', 'note', 'result', 'error'],
  mkt_requests: ['id', 'kind', 'title', 'details', 'project', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at', 'done_at'],
  // 0054 (9.5.5): the video jobs — the server's rows, read without the Magnific link
  mkt_video_jobs: ['id', 'campaign_id', 'piece', 'kind', 'scene', 'creation_ref', 'status', 'path', 'bytes', 'duration', 'error', 'data', 'created_by', 'created_at', 'updated_at', 'done_at'],
};
const KEY = { mkt_campaigns: 'campaigns', mkt_posts: 'posts', mkt_templates: 'templates', mkt_ad_objects: 'adObjects', mkt_ad_stats: 'adStats', mkt_suggestions: 'suggestions', mkt_requests: 'requests', mkt_video_jobs: 'videoJobs' };
const GRANT = { mkt_campaigns: { insert: ['name', 'goal', 'step', 'state'], update: ['name', 'goal', 'step', 'state', 'archived_at'] },
  mkt_templates: { insert: ['name', 'kind', 'image', 'descr'], update: ['name', 'kind', 'image', 'descr', 'deleted_at'] },
  mkt_requests: { insert: ['kind', 'title', 'details', 'project'], update: ['title', 'details', 'project', 'status'] } };
const REQ_STATUS = ['جديد', 'بيتعمل', 'جاهز للمراجعة', 'خلص'];
const GOALS = ['منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم'];
const KINDS = ['بوست', 'كاروسيل', 'ريل', 'ستوري'];
const PLATFORMS = ['انستجرام', 'فيسبوك', 'تيك توك'];
const MIME = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav']; // 0054: video and audio too
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
    // 9.5.4: the buyer's suggestions and the requests as the database holds them, the rules (settings «marketing».buyer over the defaults),
    // the knobs decideFail = our code Meta's write answers with (502), buyerFail / buyerAnswer for the chat, accountDaily = the rest of the account's daily budgets
    suggestions: (opts.mktSuggestions || []).map((x, i) => ({ id: i + 1, platform: 'meta', campaign_name: null, ad_id: null, sub: null, why: null, impact: null, pct: null, data: {}, status: 'pending', created_at: now, checked_at: now, decided_by: null, decided_at: null, value: null, note: null, result: null, error: null, ...x })),
    requests: (opts.mktRequests || []).map((x, i) => ({ id: i + 1, details: null, project: null, status: 'جديد', created_by: null, created_at: now, updated_by: null, updated_at: now, done_at: null, ...x })),
    rules: { ...BUYER_DEFAULTS, ...(opts.mktRules || {}) }, accountDaily: opts.mktAccountDaily == null ? 1000 : Number(opts.mktAccountDaily),
    // 9.5.5: the video jobs (the bridge's work, finished a poll later), the bridge linked (mktBridge false = not linked), videoDelay = polls a job takes
    videoJobs: (opts.mktVideoJobs || []).map((x, i) => ({ id: i + 1, scene: null, creation_ref: null, status: 'queued', url: null, path: null, bytes: null, duration: null, error: null, data: {}, created_by: null, created_at: now, updated_at: now, done_at: null, polls: 0, ...x })),
    bridge: opts.mktBridge !== false, videoDelay: opts.mktVideoDelay == null ? 1 : Number(opts.mktVideoDelay), videoFail: opts.mktVideoFail || null,
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
  if (fn) { const b = c.body(); if (path === '/functions/v1/ai-images' ? !(['campaign', 'campaign_edit'].includes(b.action) || /^video_/.test(String(b.action))) : !['marketing', 'buyer'].includes(b.action)) return null; return mktAi(c, b); }
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
    if (name === 'mkt_buyer_rules') return view ? json(200, { ...H.rules }) : refuse(403, '42501', 'marketing.view is needed');
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
          if (!['انستجرام', 'فيسبوك'].includes(it.platform) || !['بوست', 'كاروسيل', 'ستوري', 'ريل'].includes(it.kind)) return bad('how');
          if (it.kind === 'ريل') { if (!imgs.length || !/\.mp4$/i.test(imgs[0])) return bad('images'); } // 9.5.5 (0054): the MP4 first
          else {
            if (!imgs.length || imgs.length > 10 || (it.kind === 'كاروسيل' ? imgs.length < 2 : imgs.length !== 1)) return bad('images');
            if (it.platform === 'انستجرام' && imgs.some((x) => !/\.jpe?g$/i.test(x))) return bad('images');
          }
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
    : /^in\.\(.*\)$/.test(v) ? ((set) => (r) => set.includes(String(r[k])))(v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1')))
    : k === 'or' && /^\(.*\)$/.test(v) ? ((alts) => (alts.every((x) => x) ? (r) => alts.some((x) => x(r)) : null))(v.slice(1, -1).split(',').map((x) => { const m = /^([a-z_]+)\.(.+)$/.exec(x); return m ? test([m[1], m[2]]) : null; })) : null);
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
  if (t === 'mkt_posts' || t === 'mkt_ad_objects' || t === 'mkt_ad_stats' || t === 'mkt_suggestions' || t === 'mkt_video_jobs') return refuse(403, '42501', 'permission denied for table ' + t);
  if (t === 'mkt_requests') return mktRequests(c, method, [].concat(c.body()), match, answer, refuse);
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
  H.calls.push({ fn: b.action === 'marketing' || b.action === 'buyer' ? 'ai-content' : 'ai-images', action: b.action, task: b.task || null, by: u ? u.id : null, piece: b.piece || null, slide: b.slide == null ? null : b.slide, scene: b.scene == null ? null : b.scene, kind: b.kind || null, model: b.model || null, pins: Array.isArray(b.pins) ? b.pins.length : 0 });
  if (b.action === 'buyer') { // the buyer's chat: marketing.view (P too); the numbers come from the server, the answer is text only
    if (!u || !(isAdmin(u) || hasPerm(u, 'marketing.view') !== 'N')) return json(401, { error: 'unauthorized' });
    const p = parseBuyer(b); if ('error' in p) return json(400, p);
    if (H.buyerFail) return H.buyerFail === 'refused' ? json(200, { result: 'refused', model: 'mock' }) : json(H.buyerFail === 'ai_cap' ? 402 : H.buyerFail === 'busy' ? 429 : H.buyerFail === 'not_configured' ? 503 : 502, { error: H.buyerFail });
    const answer = H.buyerAnswer ? H.buyerAnswer(p.req) : { text: 'سؤالك: ' + p.req.question + '\nالأرقام من آخر 7 أيام على ' + H.adObjects.filter((o) => o.kind === 'campaign').length + ' حملة. أنا ببص بس — التنفيذ من الاقتراحات بموافقتك.' };
    H.seq += 1; return json(200, { result: 'ok', ...cleanBuyer(answer), model: 'claude-opus-5-5', cost_usd: 0.003, run_id: H.seq });
  }
  if (!u || !(isAdmin(u) || hasPerm(u, 'marketing.create') === 'F')) return json(401, { error: 'unauthorized' });
  const failWith = (k) => (k === 'refused' ? json(200, { result: 'refused', model: 'mock' }) : json(k === 'ai_cap' ? 402 : k === 'busy' ? 429 : k === 'not_configured' ? 503 : 502, { error: k, configured: k === 'not_configured' ? false : undefined }));
  const campaign = (id) => H.campaigns.find((x) => x.id === id && !x.archived_at) || null;
  if (b.action === 'marketing') {
    const p = parseMarketing(b); if ('error' in p) return json(400, p);
    if (p.req.task === 'scenes') { // 9.5.5 decision 59: the video piece's scenes (the durations from the piece and its model) — before the image target (the function's order)
      const camp = campaign(p.req.campaignId); if (!camp) return json(404, { error: 'not_found' });
      const vp = (camp.state.pieces || []).find((x) => x && x.id === p.req.piece && x.kind === 'فيديو');
      if (!vp) return json(400, { error: 'bad_request', field: 'piece' });
      if (H.aiFail) return failWith(H.aiFail);
      const n = Number.isInteger(vp.sceneCount) ? vp.sceneCount : 3;
      const raw = H.scenesAnswer ? H.scenesAnswer(vp) : { scenes: Array.from({ length: n }, (_, i) => ({ idea: ['لقطة قريبة على نقشة المنتج', 'إيد الصانعة وهي بتشتغل', 'القعدة كاملة بنور العصاري', 'تفاصيل الخامة', 'اللوجو على خلفية كريم'][i % 5], text: ['دفا الشتا', 'مشغولة يدويًا', '', 'Art craft', 'ibtekr.club'][i % 5], cam: ['زوم بطيء', 'ثابتة', 'تحريك يمين', 'ماكرو', 'ثابتة'][i % 5] })), voice: p.req.voice ? 'الدفا الحقيقي من إيد صانعة مصرية — اطلب قطعتك من إبتكر.' : '' };
      H.seq += 1; return json(200, { result: 'ok', ...cleanScenes(raw, { n, dur: Number(vp.dur) || 15, model: vp.model }), model: 'claude-opus-5-5', cost_usd: 0.004, run_id: H.seq });
    }
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
  if (/^video_/.test(String(b.action))) return mktVideo(c, b, campaign);
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

// 9.5.4: mkt_requests as 0053's policies and guard see them — insert with marketing.create (the author and «جديد» from the server),
// the status by the admin only (done_at follows «خلص»), the text by the admin or its author while «جديد»
function mktRequests(c, method, list, match, answer, refuse) {
  const { u, hasPerm, isAdmin, mock } = c; const H = mock.mkt; const now = new Date().toISOString();
  const admin = isAdmin(u); const create = hasPerm(u, 'marketing.create') === 'F'; const g = GRANT.mkt_requests;
  if (method === 'POST') {
    if (list.some((r) => Object.keys(r || {}).some((k) => !g.insert.includes(k)))) return refuse(403, '42501', 'permission denied for table mkt_requests');
    if (!create) return refuse(403, '42501', 'new row violates row-level security policy for table "mkt_requests"');
    const made = [];
    for (const r of list) {
      if (!['designer', 'dev'].includes(r.kind) || !line(r.title, 160) || line(r.title, 161).length > 160) return refuse(400, '23514', 'new row for relation "mkt_requests" violates check constraint');
      const row = { id: H.requests.reduce((m, x) => Math.max(m, x.id), 0) + 1, kind: r.kind, title: line(r.title, 160), details: r.details == null ? null : lines(r.details).slice(0, 2000), project: r.project == null ? null : line(r.project, 60),
        status: 'جديد', created_by: u.id, created_at: now, updated_by: u.id, updated_at: now, done_at: null };
      H.requests.push(row); made.push(row); H.writes.push({ table: 'mkt_requests', op: 'insert', id: row.id, kind: row.kind });
    }
    return answer(made);
  }
  if (method === 'PATCH') {
    const b = list[0] || {};
    if (Object.keys(b).some((k) => !g.update.includes(k))) return refuse(403, '42501', 'permission denied for table mkt_requests');
    const rows = H.requests.filter(match).filter((r) => admin || (r.created_by === u.id && create));
    for (const r of rows) {
      if (b.status !== undefined && b.status !== r.status && !admin) return refuse(403, '42501', 'the admin changes a request status');
      if (b.status !== undefined && !REQ_STATUS.includes(b.status)) return refuse(400, '23514', 'check constraint');
      const text = ['title', 'details', 'project'].some((k) => b[k] !== undefined && b[k] !== r[k]);
      if (text && !(admin || (r.created_by === u.id && r.status === 'جديد'))) return refuse(403, '42501', 'the author edits a new request only');
      if (b.title !== undefined && !line(b.title, 160)) return refuse(400, '23514', 'check constraint');
      Object.assign(r, b, { updated_by: u.id, updated_at: now });
      if (b.status !== undefined) r.done_at = b.status === 'خلص' ? (r.done_at || now) : null;
      H.writes.push({ table: 'mkt_requests', op: 'update', id: r.id, ...Object.fromEntries(Object.keys(b).map((k) => [k, k === 'status' ? b[k] : '…'])) });
    }
    return answer(rows);
  }
  return refuse(405, '42501', 'method not allowed');
}

// 9.5.3: mkt-ads — status (marketing.view) and the admin's sync by hand; the knob adsFail answers a sync with our code (502)
function mktAds(c, b) {
  const { u, hasPerm, isAdmin, json, mock } = c; const H = mock.mkt;
  H.calls.push({ fn: 'mkt-ads', action: b.action || null, by: u ? u.id : null, days: b.days == null ? null : b.days });
  if (!u) return json(401, { error: 'unauthorized' });
  const admin = isAdmin(u); const view = admin || hasPerm(u, 'marketing.view') !== 'N';
  if (b.action === 'status') return view ? json(200, H.ads) : json(401, { error: 'unauthorized' });
  if (b.action === 'rules') return view ? json(200, { result: 'ok', rules: { ...H.rules } }) : json(401, { error: 'unauthorized' });
  if (!['sync', 'rules_set', 'live', 'decide'].includes(b.action)) return json(400, { error: 'unknown_action' });
  if (!admin) return json(401, { error: 'unauthorized' });
  if (b.action === 'rules_set') { // the numbers and the modes only — never live
    const p = rulesPatch(b.rules); if ('error' in p) return json(400, p);
    Object.assign(H.rules, p.patch); H.writes.push({ table: 'settings', op: 'buyer_rules', keys: Object.keys(p.patch) }); return json(200, { result: 'ok', rules: { ...H.rules } });
  }
  if (b.action === 'live') {
    if (typeof b.on !== 'boolean') return json(400, { error: 'bad_request', field: 'on' });
    H.rules.live = b.on; H.writes.push({ table: 'settings', op: 'buyer_live', on: b.on }); return json(200, { result: 'ok', rules: { ...H.rules } });
  }
  if (b.action === 'decide') return mktDecide(c, b);
  if (!H.ads.configured) return json(503, { error: 'not_configured', configured: false });
  const now = new Date().toISOString();
  if (H.adsFail) { Object.assign(H.ads, { checked_at: now, error: H.adsFail }); return json(502, { error: H.adsFail }); }
  Object.assign(H.ads, { synced_at: now, checked_at: now, error: null });
  return json(200, { result: 'ok', days: Number(b.days) || 3, campaigns: H.adObjects.filter((o) => o.kind === 'campaign').length, ads: H.adObjects.filter((o) => o.kind === 'ad').length, stats: H.adStats.length });
}

// 9.5.4: the admin's decision on a suggestion as mkt-ads makes it — reject; creative → a designer request; tracking → reviewed;
// the money kinds: the switch off = recorded only; on = «PAUSED» or the budget by the step (≤ 30%, the daily cap over the rest of
// the account = H.accountDaily) — the knob decideFail answers Meta's write with our code
function mktDecide(c, b) {
  const { u, json, mock } = c; const H = mock.mkt; const now = new Date().toISOString();
  const s = H.suggestions.find((x) => x.id === Number(b.id)); if (!s) return json(404, { error: 'not_found' });
  if (!['approve', 'edit', 'reject'].includes(b.decision)) return json(400, { error: 'bad_request', field: 'decision' });
  if (s.status !== 'pending') return json(409, { error: 'decided' });
  const note = b.note == null ? null : line(b.note, 300) || null;
  const base = { decided_by: u.id, decided_at: now, note };
  const done = (patch, body) => { Object.assign(s, base, patch); H.writes.push({ table: 'mkt_suggestions', op: 'decide', id: s.id, decision: b.decision, status: s.status }); return json(200, { result: 'ok', status: s.status, ...body }); };
  if (b.decision === 'reject') return done({ status: 'rejected' }, {});
  if (s.kind === 'creative') {
    const id = H.requests.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    H.requests.push({ id, kind: 'designer', title: 'نسخة جديدة لإعلان «' + String(s.title || '').replace(/^إعلان «|» الناس زهقت منه$/g, '') + '»', details: 'الميديا باير: ' + (s.title || '') + (note ? ' — ' + note : ''), project: s.campaign_name, status: 'جديد', created_by: u.id, created_at: now, updated_by: u.id, updated_at: now, done_at: null });
    return done({ status: 'done', result: { request: true } }, { request: true });
  }
  if (s.kind === 'tracking') return done({ status: 'done', result: { reviewed: true } }, {});
  let pct = s.pct;
  if (s.kind !== 'stop') {
    if (b.decision === 'edit') { pct = Number(b.value); if (!Number.isInteger(pct) || !pct || Math.sign(pct) !== Math.sign(s.pct || 0) || Math.abs(pct) > MAX_STEP) return json(400, { error: 'bad_request', field: 'value' }); }
    else if (b.value != null) return json(400, { error: 'bad_request', field: 'value' });
  }
  if (!H.rules.live) return done({ status: b.decision === 'edit' ? 'edited' : 'approved', value: b.decision === 'edit' ? pct : null, result: { live: false } }, { live: false });
  if (H.decideFail) { Object.assign(s, base, { status: 'failed', error: H.decideFail }); H.writes.push({ table: 'mkt_suggestions', op: 'decide', id: s.id, decision: b.decision, status: 'failed' }); return json(502, { error: H.decideFail }); }
  if (s.kind === 'stop') { const camp = H.adObjects.find((o) => o.kind === 'campaign' && o.id === s.campaign_id); if (camp) camp.status = 'PAUSED'; return done({ status: 'done', result: { status: 'PAUSED' } }, { status: 'done' }); }
  const budget = Number(s.data && s.data.daily_budget) || 0;
  const plan = budgetPlan({ campaign: { id: s.campaign_id, daily_budget: budget ? Math.round(budget * 100) : null }, adsets: [] }, pct, H.rules, H.accountDaily);
  if ('error' in plan) { Object.assign(s, base, { status: 'failed', value: pct, error: plan.error, result: plan }); H.writes.push({ table: 'mkt_suggestions', op: 'decide', id: s.id, decision: b.decision, status: 'failed' }); return json(409, { error: plan.error, max: plan.max ?? null, cap: plan.cap ?? null, after: plan.after ?? null }); }
  const camp = H.adObjects.find((o) => o.kind === 'campaign' && o.id === s.campaign_id); if (camp) camp.meta = { ...camp.meta, daily_budget: plan.after };
  return done({ status: 'done', value: pct, result: plan }, { before: plan.before, after: plan.after, updates: plan.updates.length });
}

// 9.5.5: the video through the bridge as ai-images runs it (decisions 58–61) — a job a call, finished after videoDelay polls, the
// results as objects in bucket marketing (vid-<piece>-<part>-mk<n>.mp4 / .mp3), the assembly chain (cut → voice → music) going on
// by itself in video_poll; the link never reaches the page. Knobs: mktBridge false (not linked), mktVideoDelay, mktVideoFail (a kind
// whose next job fails).
function mktVideo(c, b, campaign) {
  const { u, json, mock } = c; const H = mock.mkt; const now = new Date().toISOString();
  const action = String(b.action).replace('video_', '');
  const p = parseVideo(action, b); if ('error' in p) return json(400, p);
  const camp = campaign(p.req.campaignId); if (!camp) return json(404, { error: 'not_found' });
  const piece = (camp.state.pieces || []).find((x) => x && x.id === p.req.piece && x.kind === 'فيديو'); if (!piece) return json(400, { error: 'bad_request', field: 'piece' });
  if (!H.bridge) return json(503, { error: 'not_linked', status: 401 });
  const jobs = () => H.videoJobs.filter((j) => j.campaign_id === camp.id && j.piece === piece.id);
  const open = () => jobs().filter((j) => j.status === 'queued' || j.status === 'running');
  const add = (row) => { const j = { id: H.videoJobs.reduce((m, x) => Math.max(m, x.id), 0) + 1, campaign_id: camp.id, piece: piece.id, scene: null, creation_ref: null, status: 'running', url: null, path: null, bytes: null, duration: null, error: null, data: {}, created_by: u.id, created_at: now, updated_at: now, done_at: null, polls: 0, ...row }; H.videoJobs.push(j); H.writes.push({ table: 'mkt_video_jobs', op: 'insert', id: j.id, kind: j.kind, scene: j.scene }); return j; };
  const ref = (k) => k + '-' + (++H.seq);
  const view = (j) => jobView(j);
  const scenes = Array.isArray(piece.scenes) ? piece.scenes : [];
  if (action === 'clip') {
    const chained = piece.method === 'chained' && piece.model !== 'kling-2.5';
    if (!scenes.length) return json(400, { error: 'bad_request', field: 'scenes' });
    if (!chained && (p.req.scene == null || !scenes[p.req.scene])) return json(400, { error: 'bad_request', field: 'scene' });
    if (open().length >= MAX_OPEN_JOBS) return json(409, { error: 'busy_piece', open: open().length });
    const frame = chained ? scenes[0] : scenes[p.req.scene]; if (!campaignPathOk(camp.id, frame.img)) return json(400, { error: 'bad_request', field: 'image' });
    return json(200, { result: 'ok', job: view(add({ kind: 'clip', scene: chained ? null : p.req.scene, creation_ref: ref('clip'), data: { model: piece.model || 'seedance-2.5', duration: chained ? scenes.reduce((a, s) => a + (s.d || 0), 0) : frame.d, method: chained ? 'chained' : 'separate' } })) });
  }
  if (action === 'voice' || action === 'music') {
    if (open().length >= MAX_OPEN_JOBS) return json(409, { error: 'busy_piece', open: open().length });
    return json(200, { result: 'ok', job: view(add({ kind: action, creation_ref: ref(action === 'voice' ? 'vo' : 'mu'), data: action === 'voice' ? { voice: p.req.voice, chars: p.req.text.length } : { type: p.req.type } })) });
  }
  if (action === 'upload') {
    if (!H.objects.has(p.req.path)) return json(400, { error: 'bad_request', field: 'path' });
    return json(200, { result: 'ok', job: view(add({ kind: 'upload', creation_ref: ref('upl'), status: 'done', path: p.req.path, bytes: (H.objects.get(p.req.path) || {}).size || 0, done_at: now, data: { role: p.req.role } })) });
  }
  if (action === 'assemble') {
    if (open().length) return json(409, { error: 'busy_piece', open: open().length });
    const plan = mixPlan(jobs(), scenes, piece.method); if ('error' in plan) return json(409, { error: 'clips' });
    const chain = plan.steps; const first = chain[0];
    let j;
    if (first === 'concat') j = add({ kind: 'assemble', creation_ref: ref('cut'), data: { chain, step: 0, plan, final: chain.length === 1 } });
    else if (first) { const nx = nextMix(['cut', ...chain], 0, plan); j = add({ kind: 'mix', creation_ref: ref('mix'), data: { chain: ['cut', ...chain], step: 1, plan, role: nx.role, final: chain.length === 1 } }); }
    else { const src = jobs().find((x) => x.creation_ref === plan.clips[0] && x.status === 'done'); j = add({ kind: 'mix', creation_ref: plan.clips[0], status: 'done', path: src ? src.path : null, bytes: src ? src.bytes : null, done_at: now, data: { chain: [], step: 0, plan, final: true } }); }
    return json(200, { result: 'ok', job: view(j) });
  }
  // poll
  const partOf = (j) => (j.kind === 'clip' ? (j.scene == null ? 'all' : 's' + (j.scene + 1)) : j.kind === 'voice' ? 'vo' : j.kind === 'music' ? 'mu' : j.kind === 'assemble' ? 'cut' : 'mix');
  for (const j of open()) {
    j.polls += 1; if (j.polls < H.videoDelay) continue;
    if (H.videoFail && H.videoFail === j.kind) { Object.assign(j, { status: 'failed', error: 'failed', updated_at: now }); H.videoFail = null; continue; }
    const ext = j.kind === 'voice' || j.kind === 'music' ? 'mp3' : 'mp4'; H.seq += 1;
    const path = videoPath(camp.id, piece.id, partOf(j), 'mk' + H.seq, ext);
    H.objects.set(path, { type: ext === 'mp4' ? 'video/mp4' : 'audio/mpeg', size: 4096, by: u.id });
    Object.assign(j, { status: 'done', url: 'https://pikaso.cdnpk.net/v/' + j.creation_ref + '.' + ext, path, bytes: 4096, done_at: now, updated_at: now });
    const d = j.data || {};
    if ((j.kind === 'assemble' || j.kind === 'mix') && Array.isArray(d.chain) && d.plan) {
      const nx = nextMix(d.chain, Number(d.step) || 0, d.plan);
      if (nx) add({ kind: 'mix', creation_ref: ref('mix'), data: { chain: d.chain, step: nx.step, plan: d.plan, role: nx.role, final: nx.step === d.chain.length - 1 } });
    }
  }
  const all = jobs(); const final = all.filter((j) => j.status === 'done' && (j.kind === 'mix' || j.kind === 'assemble') && j.data && j.data.final === true).pop() || null;
  return json(200, { result: 'ok', jobs: all.map(view), open: open().length, final: final ? view(final) : null });
}
