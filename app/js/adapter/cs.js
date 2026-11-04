// Customer service (phase 6, 0034): the CRM (cs_customers through the rpc cs_customers_list — the base table never hands a
// member the phone), the conversations and their messages (cs_conversations / cs_messages, the open ones and the last 90 days),
// the segments, the campaigns (drafts / schedules in 6.1), the channels (Messenger / Instagram through the Edge Function cs-channel
// from 6.2 — the link by the admin, the sending of an `out` row, the comment actions; WhatsApp in 6.4) and the settings row «cs». Everything is handed to block 20 in the v2 prototype's shapes, on IBCS.data (one object, same arrays — the page holds it):
//   customers  { id, name, phone (masked without sensitive.customer_phone), ig, city, province, address, address2, mood, tags,
//                consent, autoConsent, source, createdFrom, blocked, since (ISO), orders, total, lastOrderAt, lastOrderDays, refused,
//                returned, openComplaints, lateOpen, conversations, lastActive (ISO), ratingSat, ratingManners, ratingCount,
//                manualRating, ratingReason, orderList [[id, 'Processing'|'Completed'|'Cancelled', text, 'Late'|'AtRisk'|'OnTime'|null]],
//                channels [platforms of their conversations], notes [{ author, time, text }], ratings [{ chat, at, by, sat, manners, note }] }
//   convs      { id, seg, platform, channel, who (customer / maker uuid), handle, status, assigneeUid, assignee (a name or «غير معيّنة»),
//                outcome, tags, lastIn (ms), lastOut (ms), waiting (minutes since waiting_since), unread, snoozedUntil, closedAt,
//                createdAt, updatedAt, time (a clock / day label), msgs [{ id, t: kind, text, time, at, author (a name), delivery, tpl }],
//                postId + post { id, platform, caption, permalink, thumb, kind, postedAt } on a comments conversation (decision 19) }
//   segments   { id, name, minTotal, minOrders, moods, last, lastFrom, lastTo, ranges, includeUnrated, add, remove }  (the rules' shape)
//   campaigns  { id, name, segId, seg (the segment's name), channel, from (the channel's name), body, imagePath, discountCode,
//                scheduledAt, capPerDay, minDelayS, status, size, stats, sent, delivered, read, replies, orders, revenue, sub }
//   channels   { wa1: { id, name, aud, kind, status, number, cap, since, last }, … }   settings { routing, slaWarn, slaLate, hours, autoCloseDays }
// load() runs with the sign-in (IBDirectory.load) and after a Realtime change; state() 'idle' | 'loading' | 'ready' | 'error'; every
// change dispatches ib:cs. Writes return a Promise of { ok, reason?, … } and never throw: reason 'forbidden' (42501), 'invalid'
// (22xxx / 23xxx), 'notfound', 'network'. Each write the server took is logged through IBActivity.log as cs.<x> with ids, names and
// statuses only — never a message's text, a note or a phone. can(): { view, reply, manage, phone, orders, admin }.
(function () {
  'use strict';
  const CONV_COLS = 'id, seg, platform, channel, customer_id, vendor_id, handle, external_id, status, assignee, outcome, tags, last_in_at, last_out_at, waiting_since, unread, snoozed_until, closed_at, closed_by, created_by, created_at, updated_at';
  const MSG_COLS = 'id, conversation_id, kind, text, author, delivery, meta, created_at';
  const SEG_COLS = 'id, name, min_total, min_orders, moods, last_kind, last_from, last_to, ranges, include_unrated, add_ids, remove_ids, created_by, created_at, updated_at';
  const CAMP_COLS = 'id, name, segment_id, channel, body, image_path, discount_code, scheduled_at, cap_per_day, min_delay_s, status, size, stats, created_by, created_at, updated_at';
  const CHAN_COLS = 'id, name, audience, kind, status, number, cap_per_day, since, last_message_at, updated_at';
  const NOTE_COLS = 'id, customer_id, text, author, at';
  const RATING_COLS = 'id, customer_id, conversation_id, sat, manners, note, by_user, at';
  const POST_COLS = 'id, platform, caption, permalink, thumb, kind, posted_at'; // decision 19: the post a comment is on
  const CUSTOMER_EDIT = ['name', 'ig', 'city', 'province', 'address', 'address2', 'consent', 'auto_consent', 'source']; // cs.manage
  const CUSTOMER_LIGHT = ['mood', 'tags']; // cs.reply
  const STATUSES = ['جديدة', 'مستنية ردنا', 'مستنية العميل', 'مؤجلة', 'اتحلت'];
  const MOODS = ['سعيد', 'متوسط', 'متضايق'];
  const DONE = ['مكتمل']; const DEAD = ['ملغي', 'استرجاع', 'فشل'];
  const DEFAULT_SETTINGS = { routing: 'auto', slaWarn: 10, slaLate: 15, hours: 'السبت – الخميس، 10 ص – 10 م · الجمعة 2 م – 10 م', autoCloseDays: 3, live: { wa: false, campaigns: false } };
  const UNASSIGNED = 'غير معيّنة';
  const DAYS_BACK = 90; const PAGE = 1000; const CHUNK = 200;
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const ms = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const myUid = () => { const s = window.IBAuth && window.IBAuth.session && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const can = () => ({ view: perm('cs.view'), reply: perm('cs.reply') === 'F', manage: perm('cs.manage') === 'F', phone: perm('sensitive.customer_phone') === 'F', orders: perm('orders.view') !== 'N', admin: !!(me() && me().role_id === 'admin') });
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' ? 'notfound' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fail = (err) => ({ ok: false, reason: reasonOf(err) });

  let st = 'idle'; let gen = 0; let channel = null; let live = null; let timer = null; let poll = null;
  const data = { customers: [], convs: [], segments: [], campaigns: [], channels: {}, settings: Object.assign({}, DEFAULT_SETTINGS) };
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:cs', { detail: detail || {} })));

  // ---------- names ----------
  const members = () => (window.IBDirectory && window.IBDirectory.members ? window.IBDirectory.members() : []) || [];
  const nameOf = (uid) => { if (!uid) return ''; const m = members().find((x) => x.uid === uid); return m ? m.name : '—'; };
  const vendorName = (id) => { const V = window.IBVendors; const v = V && V.store && V.store.get ? quiet(() => V.store.get(id)) : null; return v ? v.name : ''; };
  // the agents of the inbox: the active members of the customer-service roles (online is not known before the HR phase — every active member counts)
  const AGENT_ROLES = ['أدمن', 'خدمة العملاء', 'عمليات', 'متابعة المبتكرين', 'متابعة الموردين']; // the role's seeded name is still «الموردين» (0003)
  const agents = () => members().filter((m) => m.status === 'active' && AGENT_ROLES.includes(m.role)).map((m) => ({ id: m.uid, code: m.id, name: m.name, role: m.role, online: true }));

  // ---------- labels (the page shows them as the prototype did) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const AR_MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function clock(t) { const d = new Date(t); const h = d.getHours(); const h12 = h % 12 || 12; return h12 + ':' + pad(d.getMinutes()) + (h < 12 ? ' ص' : ' م'); }
  // «10:42 ص» today, «أمس», else «18 أكتوبر»
  function timeLabel(t, now) {
    if (t == null) return '';
    const N = now == null ? Date.now() : now; const k = dayKey(t);
    if (k === dayKey(N)) return clock(t);
    if (k === dayKey(N - 864e5)) return 'أمس';
    const d = new Date(t); return d.getDate() + ' ' + AR_MON[d.getMonth()];
  }
  const dayLabel = (t, now) => { const N = now == null ? Date.now() : now; const k = dayKey(t); return k === dayKey(N) ? 'اليوم' : k === dayKey(N - 864e5) ? 'أمس' : new Date(t).getDate() + ' ' + AR_MON[new Date(t).getMonth()]; };
  // the messages with a { t: 'day' } row before each new day (pure; the page renders it like the prototype's separators)
  function withDays(msgs, now) {
    const out = []; let last = null;
    (msgs || []).forEach((m) => { const k = m.at ? dayKey(m.at) : null; if (k && k !== last) { out.push({ t: 'day', text: dayLabel(m.at, now) }); last = k; } out.push(m); });
    return out;
  }
  const daysSince = (iso, now) => { const t = ms(iso); return t == null ? null : Math.max(0, Math.floor(((now == null ? Date.now() : now) - t) / 864e5)); };

  // ---------- rows → the prototype's shapes (pure but for the name lookups) ----------
  function orderTuple(o, now) {
    const st = String(o.status || ''); const kind = DONE.includes(st) ? 'Completed' : DEAD.includes(st) ? 'Cancelled' : 'Processing';
    const d = daysSince(o.placed_at, now); const flag = kind !== 'Processing' ? null : d != null && d >= 11 ? 'Late' : d != null && d >= 9 ? 'AtRisk' : 'OnTime';
    const when = o.placed_at ? new Date(o.placed_at) : null;
    return [String(o.id), kind, num(o.total).toLocaleString('en-US') + ' ج.م' + (when ? ' · ' + when.getDate() + ' ' + AR_MON[when.getMonth()] : ''), flag];
  }
  function toCustomer(r, now) {
    return { id: r.id, name: r.name || '', phone: r.phone || '', ig: r.ig || '', city: r.city || '', province: r.province || '', address: r.address || '', address2: r.address2 || '',
      mood: r.mood || null, tags: Array.isArray(r.tags) ? r.tags.slice() : [], consent: r.consent !== false, autoConsent: r.auto_consent !== false, source: r.source || '', createdFrom: r.created_from || 'manual',
      blocked: !!r.blocked_at, since: r.created_at || '', orders: num(r.orders), total: num(r.total), lastOrderAt: r.last_order_at || null, lastOrderDays: daysSince(r.last_order_at, now),
      refused: num(r.refused), returned: num(r.returned), openComplaints: num(r.open_complaints), lateOpen: num(r.late_open), conversations: num(r.conversations), lastActive: r.last_active_at || r.created_at || '',
      ratingSat: r.rating_sat == null ? null : Number(r.rating_sat), ratingManners: r.rating_manners == null ? null : Number(r.rating_manners), ratingCount: num(r.rating_count),
      manualRating: r.override_stars == null ? null : Number(r.override_stars), ratingReason: r.override_reason || '',
      orderList: (Array.isArray(r.order_list) ? r.order_list : []).map((o) => orderTuple(o, now)), channels: [], notes: [], ratings: [] };
  }
  const toNote = (r) => ({ id: r.id, customerId: r.customer_id, author: nameOf(r.author), time: timeLabel(ms(r.at)), at: r.at || '', text: r.text || '' });
  const toRating = (r) => ({ id: r.id, customerId: r.customer_id, chat: r.conversation_id || null, order: '', at: (r.at || '').slice(0, 10), by: nameOf(r.by_user), sat: num(r.sat), manners: num(r.manners), note: r.note || '' });
  function toMessage(r) {
    const meta = r.meta && typeof r.meta === 'object' ? r.meta : {}; const t = ms(r.created_at);
    return { id: r.id, convId: r.conversation_id, t: r.kind, text: r.text || '', time: clock(t == null ? Date.now() : t), at: r.created_at || '', author: r.kind === 'in' ? '' : nameOf(r.author), delivery: r.delivery || null, tpl: meta.tpl || null };
  }
  // decision 19: the posts of the comments conversations (cs_posts), kept across reloads; a comments conversation's external_id is
  // «<post id>:<commenter>», so its post is the prefix
  const posts = new Map();
  const toPost = (r) => ({ id: r.id, platform: r.platform, caption: r.caption || '', permalink: /^https:\/\//.test(r.permalink || '') ? r.permalink : null, thumb: /^https:\/\//.test(r.thumb || '') ? r.thumb : null, kind: r.kind || '', postedAt: r.posted_at || null });
  const postIdOf = (r) => (r.seg === 'comments' && typeof r.external_id === 'string' && r.external_id.includes(':') ? r.external_id.split(':')[0] : null);
  async function fetchPosts(ids, g) {
    const want = [...new Set(ids.filter(Boolean))]; if (!want.length) return;
    try { (await inChunks('cs_posts', POST_COLS, 'id', want, g)).forEach((r) => posts.set(r.id, toPost(r))); } catch (e) { if (e && e.message === 'stale') throw e; /* no card: the conversation still shows */ }
  }
  function toConv(r, msgs, now) {
    const N = now == null ? Date.now() : now; const ws = ms(r.waiting_since); const last = ms(r.updated_at) || ms(r.created_at); const postId = postIdOf(r);
    return { id: r.id, seg: r.seg, platform: r.platform, channel: r.channel, who: r.seg === 'vendors' ? r.vendor_id : r.customer_id, handle: r.handle || null, externalId: r.external_id || null, postId, post: postId ? posts.get(postId) || null : null,
      status: r.status, assigneeUid: r.assignee || null, assignee: r.assignee ? nameOf(r.assignee) : UNASSIGNED, outcome: r.outcome || null, tags: Array.isArray(r.tags) ? r.tags.slice() : [],
      lastIn: ms(r.last_in_at), lastOut: ms(r.last_out_at), waiting: ws == null || r.status === 'اتحلت' ? 0 : Math.max(0, Math.floor((N - ws) / 60000)), unread: num(r.unread),
      snoozedUntil: r.snoozed_until || null, closedAt: r.closed_at || null, closedBy: r.closed_by || null, createdAt: r.created_at || '', updatedAt: r.updated_at || r.created_at || '',
      time: timeLabel(last, N), msgs: (msgs || []).map(toMessage) };
  }
  const toSegment = (r) => ({ id: r.id, name: r.name || '', minTotal: r.min_total == null ? '' : Number(r.min_total), minOrders: r.min_orders == null ? '' : Number(r.min_orders), moods: Array.isArray(r.moods) ? r.moods.slice() : [],
    last: r.last_kind || '', lastFrom: r.last_from || '', lastTo: r.last_to || '', ranges: r.ranges && typeof r.ranges === 'object' ? r.ranges : {}, includeUnrated: !!r.include_unrated,
    add: Array.isArray(r.add_ids) ? r.add_ids.slice() : [], remove: Array.isArray(r.remove_ids) ? r.remove_ids.slice() : [] });
  const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const segColumns = (s) => ({ name: String(s.name || '').trim(), min_total: numOrNull(s.minTotal), min_orders: numOrNull(s.minOrders), moods: Array.isArray(s.moods) ? s.moods.filter((m) => MOODS.includes(m)) : [],
    last_kind: s.last || null, last_from: s.last === 'range' && s.lastFrom ? s.lastFrom : null, last_to: s.last === 'range' && s.lastTo ? s.lastTo : null, ranges: s.ranges && typeof s.ranges === 'object' ? s.ranges : {},
    include_unrated: !!s.includeUnrated, add_ids: Array.isArray(s.add) ? s.add : [], remove_ids: Array.isArray(s.remove) ? s.remove : [] });
  function toCampaign(r, segs, chans, now) {
    const stats = r.stats && typeof r.stats === 'object' ? r.stats : {}; const seg = (segs || []).find((s) => s.id === r.segment_id); const ch = chans && chans[r.channel];
    const when = ms(r.scheduled_at);
    const sub = r.status === 'مسودة' ? 'مسودة' + (r.updated_at ? ' — آخر تعديل ' + timeLabel(ms(r.updated_at), now) : '') : r.status === 'مجدولة' && when != null ? 'مجدولة ' + new Date(when).getDate() + ' ' + AR_MON[new Date(when).getMonth()] + ' ' + clock(when) : r.status;
    return { id: r.id, name: r.name || '', segId: r.segment_id || null, seg: seg ? seg.name : '', channel: r.channel, from: ch ? ch.name : r.channel, body: r.body || '', imagePath: r.image_path || null, discountCode: r.discount_code || '',
      scheduledAt: r.scheduled_at || null, capPerDay: num(r.cap_per_day) || 300, minDelayS: num(r.min_delay_s) || 20, status: r.status, size: num(r.size), stats,
      sent: num(stats.sent), delivered: num(stats.delivered), read: num(stats.read), replies: num(stats.replies), orders: num(stats.orders), revenue: num(stats.revenue), sub, createdAt: r.created_at || '', updatedAt: r.updated_at || '' };
  }
  const campColumns = (k) => ({ name: String(k.name || '').trim(), segment_id: k.segId || null, channel: k.channel || 'wa1', body: k.body ? String(k.body) : null, image_path: k.imagePath || null, discount_code: k.discountCode ? String(k.discountCode).trim() : null,
    scheduled_at: k.scheduledAt || null, cap_per_day: num(k.capPerDay) || 300, min_delay_s: num(k.minDelayS) || 20, status: k.status === 'مجدولة' ? 'مجدولة' : k.status === 'متوقفة' ? 'متوقفة' : 'مسودة', size: num(k.size) });
  const toChannel = (r, now) => ({ id: r.id, name: r.name || r.id, aud: r.audience || 'customers', kind: r.kind || 'none', status: r.status || 'disconnected', number: r.number || '', cap: num(r.cap_per_day), since: r.since || null,
    last: r.last_message_at ? 'آخر رسالة: ' + timeLabel(ms(r.last_message_at), now) : r.status === 'connected' ? '' : 'مش مربوط', updatedAt: r.updated_at || null });
  function toSettings(d) {
    const x = d && typeof d === 'object' ? d : {};
    const n = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    const l = x.live && typeof x.live === 'object' ? x.live : {}; // decision 24: WhatsApp / the campaigns' sending stay «soon» until the owner opens them
    return { routing: x.routing === 'manual' ? 'manual' : 'auto', slaWarn: n(x.sla_warn, DEFAULT_SETTINGS.slaWarn), slaLate: n(x.sla_late, DEFAULT_SETTINGS.slaLate), hours: typeof x.hours === 'string' && x.hours ? x.hours : DEFAULT_SETTINGS.hours, autoCloseDays: n(x.auto_close_days, DEFAULT_SETTINGS.autoCloseDays), live: { wa: l.wa === true, campaigns: l.campaigns === true } };
  }

  // ---------- load ----------
  const stale = (g) => { if (g !== gen) throw new Error('stale'); };
  async function pages(build, g) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      if (from) stale(g);
      const { data: d, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(d || []));
      if (!d || d.length < PAGE) break;
    }
    return rows;
  }
  async function inChunks(table, cols, col, ids, g, order) {
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      stale(g);
      const q = c().from(table).select(cols).in(col, ids.slice(i, i + CHUNK));
      const { data: d, error } = await (order ? q.order(order) : q);
      if (error) throw error;
      out.push(...(d || []));
    }
    return out;
  }
  // the customers' extra rows (notes / team ratings) and the platforms of their conversations are hung on them here
  function attach(customers, notes, ratings, convs) {
    const byId = new Map(customers.map((cu) => [cu.id, cu]));
    customers.forEach((cu) => { cu.notes = []; cu.ratings = []; cu.channels = []; });
    (notes || []).forEach((r) => { const cu = byId.get(r.customer_id); if (cu) cu.notes.push(toNote(r)); });
    (ratings || []).forEach((r) => { const cu = byId.get(r.customer_id); if (cu) cu.ratings.push(toRating(r)); });
    (convs || []).forEach((v) => { if (v.seg === 'vendors' || !v.who) return; const cu = byId.get(v.who); if (cu && !cu.channels.includes(v.platform)) cu.channels.push(v.platform); });
    customers.forEach((cu) => { cu.notes.sort((a, b) => (a.at < b.at ? 1 : -1)); cu.ratings.sort((a, b) => (a.at < b.at ? 1 : -1)); });
  }
  async function load() {
    const cl = c(); if (!cl) return;
    const g = ++gen;
    if (can().view === 'N') { data.customers = []; data.convs = []; data.segments = []; data.campaigns = []; data.channels = {}; st = 'ready'; emit(); return; }
    st = 'loading'; emit();
    try {
      const sinceIso = new Date(Date.now() - DAYS_BACK * 864e5).toISOString();
      const [cu, convRows, segRows, campRows, chanRows, notes, ratings, settingsRow] = await Promise.all([
        cl.rpc('cs_customers_list'),
        pages(() => cl.from('cs_conversations').select(CONV_COLS).or('status.neq.اتحلت,updated_at.gte.' + sinceIso).order('updated_at', { ascending: false }), g),
        cl.from('cs_segments').select(SEG_COLS).order('name'),
        cl.from('cs_campaigns').select(CAMP_COLS).order('created_at', { ascending: false }),
        cl.from('cs_channels').select(CHAN_COLS),
        pages(() => cl.from('cs_customer_notes').select(NOTE_COLS).order('at', { ascending: false }), g),
        pages(() => cl.from('cs_team_ratings').select(RATING_COLS).order('at', { ascending: false }), g),
        cl.from('settings').select('data').eq('section', 'cs').maybeSingle(),
      ]);
      const bad = [cu, segRows, campRows, chanRows].find((r) => r.error); if (bad) throw bad.error;
      stale(g);
      const msgRows = convRows.length ? await inChunks('cs_messages', MSG_COLS, 'conversation_id', convRows.map((r) => r.id), g, 'created_at') : [];
      stale(g);
      await fetchPosts(convRows.map(postIdOf), g); stale(g);
      const now = Date.now(); const byConv = new Map();
      msgRows.forEach((m) => { if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []); byConv.get(m.conversation_id).push(m); });
      const customers = (cu.data || []).filter((r) => !r.merged_into).map((r) => toCustomer(r, now));
      const convs = convRows.map((r) => toConv(r, byConv.get(r.id) || [], now));
      attach(customers, notes, ratings, convs);
      const segments = (segRows.data || []).map(toSegment);
      const channels = {}; (chanRows.data || []).forEach((r) => { channels[r.id] = toChannel(r, now); });
      data.customers = customers; data.convs = convs; data.segments = segments; data.channels = channels;
      data.campaigns = (campRows.data || []).map((r) => toCampaign(r, segments, channels, now));
      data.settings = toSettings(settingsRow && !settingsRow.error && settingsRow.data ? settingsRow.data.data : null);
      st = 'ready';
    } catch (e) { if (e && e.message === 'stale') return; st = 'error'; }
    emit();
  }
  function clear() { gen += 1; unsubscribe(); posts.clear(); data.customers = []; data.convs = []; data.segments = []; data.campaigns = []; data.channels = {}; data.settings = Object.assign({}, DEFAULT_SETTINGS); st = 'idle'; }

  // ---------- lookups ----------
  const customer = (id) => data.customers.find((x) => x.id === id) || null;
  const conv = (id) => data.convs.find((x) => x.id === id) || null;
  const log = (action, detail, entity, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log(action, detail, { entity, entity_id: id })); };

  // ---------- conversations ----------
  async function refreshConv(id) {
    const cl = c(); const { data: rows, error } = await cl.from('cs_conversations').select(CONV_COLS).eq('id', id);
    if (error || !rows || !rows.length) return null;
    const { data: msgs } = await cl.from('cs_messages').select(MSG_COLS).eq('conversation_id', id).order('created_at');
    const pid = postIdOf(rows[0]); if (pid && !posts.has(pid)) await fetchPosts([pid], gen);
    const v = toConv(rows[0], msgs || [], Date.now());
    const i = data.convs.findIndex((x) => x.id === id); if (i >= 0) data.convs[i] = v; else data.convs.unshift(v);
    return v;
  }
  // a note («note»), an event («event») or an outgoing message («out» — queued; the channel sends it from 6.2) on a conversation
  async function addMessage(convId, kind, text, meta) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!['out', 'note', 'event'].includes(kind)) return { ok: false, reason: 'invalid' };
    const t = String(text == null ? '' : text).trim(); if (!t || t.length > 4000) return { ok: false, reason: 'invalid' };
    try {
      const { data: rows, error } = await cl.from('cs_messages').insert({ conversation_id: convId, kind, text: t, meta: meta && typeof meta === 'object' ? meta : {} }).select(MSG_COLS);
      if (error) return fail(error);
      const m = toMessage((rows || [])[0] || {}); const v = conv(convId);
      if (v) { v.msgs.push(m); v.updatedAt = m.at; v.time = timeLabel(ms(m.at)); if (kind === 'out') { v.lastOut = ms(m.at); v.waiting = 0; } }
      if (kind !== 'event') log(kind === 'out' ? 'cs.send' : 'cs.note', (v ? v.seg + ' · ' + v.platform : '') + (meta && meta.tpl ? ' · ' + meta.tpl : ''), 'cs_conversation', convId);
      emit({ conv: convId }); return { ok: true, msg: m };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // an outgoing message: the queued row, then — on a connected Meta channel (6.2) — cs-channel sends it and the row's delivery follows
  async function send(convId, text, opts) {
    const r = await addMessage(convId, 'out', text, opts && opts.tpl ? { tpl: opts.tpl } : {});
    if (!r.ok) return r;
    const v = conv(convId);
    if (!v || !metaChannel(v) || !metaConnected(v)) return r;
    return deliverMeta(r.msg, 'send');
  }
  const note = (convId, text) => addMessage(convId, 'note', text);
  const event = (convId, text) => addMessage(convId, 'event', text);
  async function patchConv(convId, patch, action, detail) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: rows, error } = await cl.from('cs_conversations').update(patch).eq('id', convId).select(CONV_COLS);
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      const old = conv(convId); const v = toConv(rows[0], [], Date.now()); v.msgs = old ? old.msgs : []; // the loaded messages stay
      const i = data.convs.findIndex((x) => x.id === convId); if (i >= 0) data.convs[i] = v; else data.convs.unshift(v);
      if (action) log(action, detail, 'cs_conversation', convId);
      emit({ conv: convId }); return { ok: true, conv: v };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const setStatus = (convId, status) => (STATUSES.includes(status) ? patchConv(convId, { status }, 'cs.status', status) : Promise.resolve({ ok: false, reason: 'invalid' }));
  const assign = (convId, uid) => patchConv(convId, { assignee: uid || null }, 'cs.assign', uid ? nameOf(uid) : UNASSIGNED);
  const setConvTags = (convId, tags) => patchConv(convId, { tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [] }, 'cs.tags', String((tags || []).length));
  const snooze = (convId, untilIso) => patchConv(convId, { status: 'مؤجلة', snoozed_until: untilIso || null }, 'cs.status', 'مؤجلة');
  const setUnread = (convId, n) => patchConv(convId, { unread: Math.max(0, num(n)) }, null);
  // close with an outcome; the customer's mood and the team's rating of the customer (cs_team_ratings) ride along
  async function close(convId, { outcome, mood, rating, note: text } = {}) {
    const v = conv(convId); if (!v) return { ok: false, reason: 'notfound' };
    const o = String(outcome || '').trim(); if (!o || o.length > 60) return { ok: false, reason: 'invalid', field: 'outcome' };
    const r = await patchConv(convId, { status: 'اتحلت', outcome: o }, 'cs.close', v.seg + ' · ' + o);
    if (!r.ok) return r;
    const extra = { mood: null, rating: null };
    if (v.seg !== 'vendors' && v.who) {
      if (mood && MOODS.includes(mood)) { const m = await setMood(v.who, mood); if (m.ok) extra.mood = mood; }
      if (rating && rating.sat && rating.manners) { const t = await rateCustomer(v.who, convId, rating); if (t.ok) extra.rating = t.rating; }
    }
    const ev = await event(convId, 'المحادثة اتنهت بواسطة ' + nameOf(myUid()) + ' — النتيجة: «' + o + '»' + (extra.mood ? ' · حالة العميل: ' + extra.mood : '') + (extra.rating ? ' · تقييم: رضا ' + extra.rating.sat + ' · أخلاق ' + extra.rating.manners : '') + (text ? ' · ' + String(text).trim() : ''));
    return { ok: true, conv: conv(convId), mood: extra.mood, rating: extra.rating, event: ev.ok };
  }
  // a conversation opened by hand (no channel thread yet): seg customers (customerId) or vendors (vendorId)
  async function open({ seg, platform, channel: ch, customerId, vendorId, handle, assignee }) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!['customers', 'vendors'].includes(seg)) return { ok: false, reason: 'invalid', field: 'seg' };
    const row = { seg, platform: platform || 'whatsapp', channel: ch || (seg === 'vendors' ? 'wa2' : 'wa1'), customer_id: seg === 'customers' ? customerId || null : null, vendor_id: seg === 'vendors' ? vendorId || null : null,
      handle: handle || null, status: 'مستنية العميل', assignee: assignee === undefined ? myUid() : assignee || null };
    try {
      const { data: rows, error } = await cl.from('cs_conversations').insert(row).select(CONV_COLS);
      if (error) return fail(error);
      const v = toConv((rows || [])[0] || {}, [], Date.now()); data.convs.unshift(v);
      if (v.who && v.seg === 'customers') { const cu = customer(v.who); if (cu) { cu.conversations += 1; if (!cu.channels.includes(v.platform)) cu.channels.push(v.platform); } }
      log('cs.open', seg + ' · ' + v.platform, 'cs_conversation', v.id); emit({ conv: v.id });
      return { ok: true, conv: v };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- customers ----------
  async function reloadCustomers() {
    const cl = c(); const { data: rows, error } = await cl.rpc('cs_customers_list');
    if (error) throw error;
    const now = Date.now(); const old = new Map(data.customers.map((x) => [x.id, x]));
    const list = (rows || []).filter((r) => !r.merged_into).map((r) => { const cu = toCustomer(r, now); const o = old.get(cu.id); if (o) { cu.notes = o.notes; cu.ratings = o.ratings; cu.channels = o.channels; } return cu; });
    data.customers = list;
  }
  // a lead by hand ({ name, phone?, city?, ig?, source?, … }) → the row (created_from manual) then the list again (the phone comes back as the rule shows it)
  async function addCustomer(v, from) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const name = String((v && v.name) || '').trim(); if (!name || name.length > 120) return { ok: false, reason: 'invalid', field: 'name' };
    const CS = window.IbtekrCS; const phone = v.phone ? (CS && CS.normPhone ? CS.normPhone(v.phone) : String(v.phone).replace(/\D/g, '')) : '';
    if (v.phone && !/^\d{6,15}$/.test(phone)) return { ok: false, reason: 'invalid', field: 'phone' };
    const row = { name, phone: phone || null, ig: v.ig ? String(v.ig).trim() : null, city: v.city ? String(v.city).trim() : null, province: v.province ? String(v.province).trim() : null, address: v.address ? String(v.address).trim() : null,
      address2: v.address2 ? String(v.address2).trim() : null, mood: MOODS.includes(v.mood) ? v.mood : null, tags: Array.isArray(v.tags) ? v.tags : [], consent: v.consent !== false, auto_consent: v.autoConsent !== false, source: v.source ? String(v.source).trim() : null, created_from: from === 'import' ? 'import' : 'manual' };
    try {
      const { data: rows, error } = await cl.from('cs_customers').insert(row).select('id, name');
      if (error) return Object.assign(fail(error), error.code === '23505' ? { duplicate: true } : {});
      const id = (rows || [])[0] && rows[0].id;
      await reloadCustomers();
      log(from === 'import' ? 'cs.customer.import' : 'cs.customer.add', name, 'cs_customer', id); emit({ customer: id });
      return { ok: true, id, customer: customer(id) };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // a sheet's rows ({ phone, name?, city? }) one by one: a taken phone counts as existing, a bad one as invalid
  async function importCustomers(rows) {
    const out = { ok: true, added: 0, existing: 0, invalid: 0 };
    for (const r of rows || []) {
      const res = await addCustomer(Object.assign({ source: 'استيراد شيت' }, r, { name: r.name || 'عميل' }), 'import');
      if (res.ok) out.added += 1; else if (res.duplicate) out.existing += 1; else if (res.reason === 'invalid') out.invalid += 1; else { out.ok = false; out.reason = res.reason; break; }
    }
    return out;
  }
  async function patchCustomer(id, patch, action, detail) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: rows, error } = await cl.from('cs_customers').update(patch).eq('id', id).select('id');
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      const cu = customer(id);
      if (cu) Object.keys(patch).forEach((k) => { const key = k === 'auto_consent' ? 'autoConsent' : k === 'blocked_at' ? 'blocked' : k; cu[key] = k === 'blocked_at' ? !!patch[k] : patch[k]; });
      if (action) log(action, detail, 'cs_customer', id);
      emit({ customer: id }); return { ok: true, customer: cu };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const setMood = (id, mood) => (MOODS.includes(mood) ? patchCustomer(id, { mood }, 'cs.customer.mood', mood) : Promise.resolve({ ok: false, reason: 'invalid' }));
  const setTags = (id, tags) => patchCustomer(id, { tags: Array.isArray(tags) ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 30) : [] }, 'cs.customer.tags', String((tags || []).length));
  // the profile's fields (cs.manage): name / ig / city / province / address / address2 / consent / autoConsent / source
  function updateCustomer(id, v) {
    const patch = {};
    CUSTOMER_EDIT.forEach((col) => { const key = col === 'auto_consent' ? 'autoConsent' : col; if (v && Object.prototype.hasOwnProperty.call(v, key)) patch[col] = col === 'consent' || col === 'auto_consent' ? !!v[key] : v[key] == null || v[key] === '' ? null : String(v[key]).trim(); });
    CUSTOMER_LIGHT.forEach((col) => { if (v && Object.prototype.hasOwnProperty.call(v, col)) patch[col] = v[col]; });
    if (patch.name !== undefined && !patch.name) return Promise.resolve({ ok: false, reason: 'invalid', field: 'name' });
    if (!Object.keys(patch).length) return Promise.resolve({ ok: true, customer: customer(id) });
    return patchCustomer(id, patch, 'cs.customer.edit', Object.keys(patch).join(', '));
  }
  const block = (id, on) => patchCustomer(id, { blocked_at: on === false ? null : new Date().toISOString() }, on === false ? 'cs.unblock' : 'cs.block', customer(id) ? customer(id).name : '');
  async function addNote(id, text) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const t = String(text == null ? '' : text).trim(); if (!t || t.length > 1000) return { ok: false, reason: 'invalid' };
    try {
      const { data: rows, error } = await cl.from('cs_customer_notes').insert({ customer_id: id, text: t }).select(NOTE_COLS);
      if (error) return fail(error);
      const n = toNote((rows || [])[0] || {}); const cu = customer(id); if (cu) cu.notes.unshift(n);
      log('cs.customer.note', cu ? cu.name : '', 'cs_customer', id); emit({ customer: id }); return { ok: true, note: n };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function setOverride(id, stars, reason) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const CS = window.IbtekrCS; const bad = CS && CS.validateRatingOverride ? CS.validateRatingOverride(Number(stars), reason) : (!(stars >= 1 && stars <= 5) || !String(reason || '').trim() ? 'invalid' : null);
    if (bad) return { ok: false, reason: 'invalid', message: bad };
    try {
      const { error } = await cl.from('cs_rating_overrides').insert({ customer_id: id, stars: Number(stars), reason: String(reason).trim() });
      if (error) return fail(error);
      const cu = customer(id); if (cu) { cu.manualRating = Number(stars); cu.ratingReason = String(reason).trim(); }
      log('cs.customer.rating', String(stars), 'cs_customer', id); emit({ customer: id }); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the team's rating of the customer at the end of a chat (sat / manners 1–5, a note) — averaged with the orders' ratings by the server
  async function rateCustomer(id, convId, r) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const CS = window.IbtekrCS; const errs = CS && CS.validateTeamRating ? CS.validateTeamRating(r) : {};
    if (Object.keys(errs).length) return { ok: false, reason: 'invalid', errors: errs };
    try {
      const { data: rows, error } = await cl.from('cs_team_ratings').insert({ customer_id: id, conversation_id: convId || null, sat: r.sat, manners: r.manners, note: r.note ? String(r.note).trim().slice(0, 500) : null }).select(RATING_COLS);
      if (error) return fail(error);
      const t = toRating((rows || [])[0] || {}); const cu = customer(id);
      if (cu) { cu.ratings.unshift(t); const n = cu.ratingCount; cu.ratingSat = Math.round(((cu.ratingSat || 0) * n + t.sat) / (n + 1) * 10) / 10; cu.ratingManners = Math.round(((cu.ratingManners || 0) * n + t.manners) / (n + 1) * 10) / 10; cu.ratingCount = n + 1; }
      log('cs.rating', t.sat + ' · ' + t.manners, 'cs_customer', id); emit({ customer: id }); return { ok: true, rating: t };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function merge(keepId, otherId) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { error } = await cl.rpc('cs_merge_customers', { p_keep: keepId, p_other: otherId });
      if (error) return fail(error);
      data.convs.forEach((v) => { if (v.seg !== 'vendors' && v.who === otherId) v.who = keepId; });
      await reloadCustomers();
      const notes = await cl.from('cs_customer_notes').select(NOTE_COLS).eq('customer_id', keepId).order('at', { ascending: false });
      const ratings = await cl.from('cs_team_ratings').select(RATING_COLS).eq('customer_id', keepId).order('at', { ascending: false });
      const cu = customer(keepId); if (cu) { cu.notes = (notes.data || []).map(toNote); cu.ratings = (ratings.data || []).map(toRating); cu.channels = [...new Set(data.convs.filter((v) => v.seg !== 'vendors' && v.who === keepId).map((v) => v.platform))]; }
      log('cs.merge', otherId + ' → ' + keepId, 'cs_customer', keepId); emit({ customer: keepId }); return { ok: true, customer: cu };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- segments ----------
  async function saveSegment(seg) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const CS = window.IbtekrCS; const names = data.segments.filter((s) => s.id !== seg.id).map((s) => s.name);
    const errs = CS && CS.validateSegment ? CS.validateSegment(seg, names) : (!String(seg.name || '').trim() ? { name: 'اكتب اسم الشريحة' } : {});
    if (Object.keys(errs).length) return { ok: false, reason: 'invalid', errors: errs };
    const cols = segColumns(seg);
    try {
      const q = seg.id ? cl.from('cs_segments').update(cols).eq('id', seg.id) : cl.from('cs_segments').insert(cols);
      const { data: rows, error } = await q.select(SEG_COLS);
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      const s = toSegment(rows[0]); const i = data.segments.findIndex((x) => x.id === s.id); if (i >= 0) data.segments[i] = s; else data.segments.push(s);
      data.segments.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      data.campaigns.forEach((k) => { if (k.segId === s.id) k.seg = s.name; });
      log(seg.id ? 'cs.segment.edit' : 'cs.segment.add', s.name, 'cs_segment', s.id); emit({ segment: s.id }); return { ok: true, segment: s };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function deleteSegment(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const s = data.segments.find((x) => x.id === id);
    try {
      const { data: rows, error } = await cl.from('cs_segments').delete().eq('id', id).select('id');
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      data.segments = data.segments.filter((x) => x.id !== id); data.campaigns.forEach((k) => { if (k.segId === id) { k.segId = null; k.seg = ''; } });
      log('cs.segment.delete', s ? s.name : '', 'cs_segment', id); emit({ segment: id }); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- campaigns (6.1: drafts and schedules; the sending is 6.3) ----------
  async function saveCampaign(k) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const cols = campColumns(k); if (!cols.name || cols.name.length > 120) return { ok: false, reason: 'invalid', field: 'name' };
    if (!['wa1', 'wa2', 'messenger', 'instagram'].includes(cols.channel)) return { ok: false, reason: 'invalid', field: 'channel' };
    if (cols.status === 'مجدولة' && !cols.scheduled_at) return { ok: false, reason: 'invalid', field: 'scheduledAt' };
    try {
      const q = k.id ? cl.from('cs_campaigns').update(cols).eq('id', k.id) : cl.from('cs_campaigns').insert(cols);
      const { data: rows, error } = await q.select(CAMP_COLS);
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      const r = toCampaign(rows[0], data.segments, data.channels, Date.now()); const i = data.campaigns.findIndex((x) => x.id === r.id); if (i >= 0) data.campaigns[i] = r; else data.campaigns.unshift(r);
      log(k.id ? 'cs.campaign.edit' : 'cs.campaign.add', r.name + ' · ' + r.status + ' · ' + r.size, 'cs_campaign', r.id); emit({ campaign: r.id }); return { ok: true, campaign: r };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const setCampaignStatus = (id, status) => { const k = data.campaigns.find((x) => x.id === id); return k ? saveCampaign(Object.assign({}, k, { status })) : Promise.resolve({ ok: false, reason: 'notfound' }); };
  async function deleteCampaign(id) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const k = data.campaigns.find((x) => x.id === id);
    try {
      const { data: rows, error } = await cl.from('cs_campaigns').delete().eq('id', id).select('id');
      if (error) return fail(error);
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      data.campaigns = data.campaigns.filter((x) => x.id !== id);
      log('cs.campaign.delete', k ? k.name : '', 'cs_campaign', id); emit({ campaign: id }); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- settings (the row «cs» — the admin writes it) ----------
  async function saveSettings(v) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().admin) return { ok: false, reason: 'forbidden' };
    const s = toSettings({ routing: v.routing, sla_warn: v.slaWarn, sla_late: v.slaLate, hours: v.hours, auto_close_days: v.autoCloseDays });
    if (s.slaWarn >= s.slaLate) return { ok: false, reason: 'invalid', field: 'slaLate' };
    try {
      const live = (data.settings && data.settings.live) || { wa: false, campaigns: false }; // kept: this form never opens or closes them
      const { error } = await cl.from('settings').upsert({ section: 'cs', data: { routing: s.routing, sla_warn: s.slaWarn, sla_late: s.slaLate, hours: s.hours, auto_close_days: s.autoCloseDays, live } }, { onConflict: 'section' });
      if (error) return fail(error);
      s.live = live; data.settings = s; log('cs.settings', [s.routing, s.slaWarn + '/' + s.slaLate, s.autoCloseDays].join(' · '), 'settings', 'cs'); emit({ settings: true }); return { ok: true, settings: s };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  // ---------- the Meta channel (phase 6.2): Edge Function cs-channel — the link (the admin), the sending, the comment actions ----------
  const FN = 'cs-channel';
  const META = ['messenger', 'instagram'];
  const metaChannel = (v) => !!v && META.includes(v.channel);
  const metaConnected = (v) => { const ch = data.channels[v.channel]; return !!ch && ch.status === 'connected'; };
  async function invoke(body, fn) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data: out, error } = await cl.functions.invoke(fn || FN, { body });
      if (error || !out) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const code = b && typeof b.error === 'string' ? b.error : '';
        const reason = code === 'not_linked' || code === 'not_configured' ? code : code === 'not_queued' || code === 'no_comment' || code === 'no_thread' ? 'not_queued' : /^graph_/.test(code) ? 'refused'
          : s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'notfound' : 'network';
        return { ok: false, reason, code: code || null, field: b && b.field ? String(b.field) : null, delivery: b && b.delivery ? String(b.delivery) : null };
      }
      return { ok: true, body: out };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const refusalText = (r) => (r.reason === 'not_linked' ? 'القناة مش مربوطة بالسيستم — الأدمن بيربطها من تاب «القنوات».' : r.reason === 'not_configured' ? 'تطبيق Meta لسه مش متظبط على السيرفر (الأسرار ناقصة).'
    : r.reason === 'refused' ? 'الرسالة اتحفظت بس Meta رفضتها (' + (r.code || 'graph') + ') — غالبًا عدّى 24 ساعة من آخر رسالة للعميل.' : r.reason === 'forbidden' ? 'مش مسموح — الصلاحية دي مش عندك' : 'حصلت مشكلة في الاتصال — جرّب تاني');
  // the queued row → the server sends it (a DM / a public reply on a comment / a private reply) and the local row follows its delivery
  async function deliverMeta(m, action) {
    const r = await invoke({ action, message_id: m.id });
    const v = conv(m.convId); const row = v && v.msgs.find((x) => x.id === m.id);
    if (r.ok) { if (row) row.delivery = 'sent'; emit({ conv: m.convId }); return { ok: true, msg: row || m, delivery: 'sent' }; }
    if (row && (r.delivery === 'failed' || r.reason === 'refused')) row.delivery = 'failed';
    emit({ conv: m.convId });
    return { ok: false, reason: r.reason === 'refused' || r.reason === 'not_linked' || r.reason === 'not_configured' ? 'invalid' : r.reason, code: r.code, message: refusalText(r), msg: row || m };
  }
  const toMetaChannel = (r) => { const ch = data.channels[r.id]; if (!ch) return; ch.status = r.status || ch.status; ch.number = r.number || ''; ch.since = r.since || null; ch.last = r.last_message_at ? 'آخر رسالة: ' + timeLabel(ms(r.last_message_at)) : ch.status === 'connected' ? '' : 'مش مربوط'; };
  // ---------- WhatsApp by QR + the campaigns' sending (6.3 / 6.4, decisions 21–24) ----------
  // the admin: the bridge's state per channel (+ the QR while it waits to be scanned) through cs-wa
  async function waStatus() {
    const r = await invoke({ action: 'wa_status' }, 'cs-wa'); if (!r.ok) return r;
    const b = r.body; const states = {};
    (Array.isArray(b.states) ? b.states : []).forEach((x) => { if (x && (x.channel === 'wa1' || x.channel === 'wa2')) states[x.channel] = { status: String(x.status || 'offline'), qr: typeof x.qr_svg === 'string' && /^<svg[\s>]/.test(x.qr_svg) ? x.qr_svg : null, phone: x.phone || null, updatedAt: x.updated_at || null }; });
    return { ok: true, live: { wa: !!(b.live && b.live.wa), campaigns: !!(b.live && b.live.campaigns) }, states };
  }
  async function waLogout(channel) {
    if (channel !== 'wa1' && channel !== 'wa2') return { ok: false, reason: 'invalid' };
    const r = await invoke({ action: 'wa_logout', channel }, 'cs-wa'); if (!r.ok) return r;
    log('cs.wa.logout', channel, 'cs_channel', channel); return { ok: true };
  }
  // a campaign's audience frozen and the campaign scheduled (cs_campaign_schedule — the phones and the consent are read on the server)
  async function scheduleCampaign(id, customerIds, atIso) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().manage) return { ok: false, reason: 'forbidden' };
    const ids = [...new Set((customerIds || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))))];
    if (!ids.length) return { ok: false, reason: 'invalid', field: 'audience' };
    try {
      const { data: n, error } = await cl.rpc('cs_campaign_schedule', { p_id: id, p_customers: ids, p_at: atIso || new Date().toISOString() });
      if (error) return fail(error);
      const k = (data.campaigns || []).find((x) => x.id === id); if (k) { k.status = 'مجدولة'; k.size = Number(n) || 0; k.scheduledAt = atIso || k.scheduledAt; }
      log('cs.campaign.schedule', String(n), 'cs_campaign', id); emit({ campaigns: true }); return { ok: true, size: Number(n) || 0 };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the channels' state from the server (+ the configuration for the admin: the app secrets set?, the redirect, the webhook url, the page)
  async function channelStatus() {
    const r = await invoke({ action: 'status' });
    if (!r.ok) return r;
    const b = r.body; (Array.isArray(b.channels) ? b.channels : []).forEach(toMetaChannel);
    const out = { ok: true, linked: !!b.linked, configured: b.configured !== false, verifyConfigured: b.verify_configured !== false, loginConfig: b.login_config === true, subscribedFields: Array.isArray(b.subscribed_fields) ? b.subscribed_fields : null, missingPermissions: Array.isArray(b.missing_permissions) ? b.missing_permissions : null, resubscribed: b.resubscribed === true, redirect: typeof b.redirect === 'string' ? b.redirect : null, webhookUrl: typeof b.webhook_url === 'string' ? b.webhook_url : null, page: b.page && typeof b.page === 'object' ? b.page : null };
    emit({ channels: true }); return out;
  }
  // the admin: the Facebook dialog's url (the page sends the browser there; Meta comes back to app/meta-callback.html)
  async function connectStart(id) {
    if (!can().admin) return { ok: false, reason: 'forbidden' };
    const r = await invoke({ action: 'connect_start', channel: META.includes(id) ? id : 'messenger' });
    if (!r.ok) return r;
    const url = typeof r.body.url === 'string' && /^https:\/\/www\.facebook\.com\//.test(r.body.url) ? r.body.url : null;
    if (!url) return { ok: false, reason: 'network' };
    log('cs.channel.link', 'start · ' + id, 'cs_channel', id);
    return { ok: true, url };
  }
  const linkOut = (b) => ({ ok: true, result: b.result === 'choose' ? 'choose' : 'ok', linked: !!b.linked, instagram: !!b.instagram, page: b.page && typeof b.page === 'object' ? b.page : null, pages: Array.isArray(b.pages) ? b.pages.map((p) => ({ id: String(p.id), name: String(p.name || p.id), ig: p.ig && typeof p.ig === 'object' ? p.ig : null })) : [] });
  // the callback page: the code + state → the page linked (or a list to pick from)
  async function connectCallback(code, state) {
    const r = await invoke({ action: 'connect_callback', code: String(code || ''), state: String(state || '') });
    if (!r.ok) return r;
    const out = linkOut(r.body); (Array.isArray(r.body.channels) ? r.body.channels : []).forEach(toMetaChannel);
    if (out.result === 'ok') log('cs.channel.link', 'linked' + (out.page ? ' · ' + out.page.name : ''), 'cs_channel', 'messenger');
    emit({ channels: true }); return out;
  }
  async function connectPick(pageId) {
    const r = await invoke({ action: 'connect_pick', page_id: String(pageId || '') });
    if (!r.ok) return r;
    const out = linkOut(r.body); (Array.isArray(r.body.channels) ? r.body.channels : []).forEach(toMetaChannel);
    log('cs.channel.link', 'linked' + (out.page ? ' · ' + out.page.name : ''), 'cs_channel', 'messenger'); emit({ channels: true }); return out;
  }
  async function disconnect() {
    if (!can().admin) return { ok: false, reason: 'forbidden' };
    const r = await invoke({ action: 'disconnect' });
    if (!r.ok) return r;
    (Array.isArray(r.body.channels) ? r.body.channels : []).forEach(toMetaChannel);
    log('cs.channel.link', 'unlinked', 'cs_channel', 'messenger'); emit({ channels: true }); return { ok: true, linked: false };
  }
  // a comments conversation: a private reply (a DM to the commenter) and hiding the last comment
  async function commentPrivate(convId, text) {
    const v = conv(convId); if (!v || v.seg !== 'comments') return { ok: false, reason: 'invalid' };
    const r = await addMessage(convId, 'out', text, { private: true });
    if (!r.ok) return r;
    return deliverMeta(r.msg, 'comment_private');
  }
  async function commentHide(convId) {
    const v = conv(convId); if (!v || v.seg !== 'comments') return { ok: false, reason: 'invalid' };
    const r = await invoke({ action: 'comment_hide', conversation_id: convId });
    if (!r.ok) return { ok: false, reason: r.reason === 'refused' || r.reason === 'not_linked' ? 'invalid' : r.reason, message: refusalText(r) };
    log('cs.channel.hide', v.platform, 'cs_conversation', convId);
    await refreshConv(convId); emit({ conv: convId }); return { ok: true, hidden: r.body.hidden || null };
  }

  // ---------- Realtime: a change on the conversations or the messages → one load() a moment later ----------
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {}; if (!cl || (channel && live) || !myUid() || cfg.realtime === false) return; // IB_CONFIG.realtime === false: no socket (the mock)
    if (!channel) try {
      let ch = cl.channel('cs');
      const onChange = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; load(); }, 400); };
      ['cs_conversations', 'cs_messages'].forEach((table) => ['INSERT', 'UPDATE'].forEach((ev) => { ch = ch.on('postgres_changes', { event: ev, schema: 'public', table }, onChange); }));
      // a channel that errors or times out is dropped, so the next check (below) opens a fresh one
      channel = ch.subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { const dead = channel; channel = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); } });
    } catch (e) { channel = null; }
    // the live line (0038, 4 Nov — «لحظية كأنه شات»): the database broadcasts «changed» on «cs-inbox» after every write on the
    // conversations / messages (no content in it); the page reloads through its own RLS a moment later
    if (!live) {
      try {
        live = cl.channel('cs-inbox', { config: { private: true } }).on('broadcast', { event: 'changed' }, onLive) // 0039: members with cs.view only, nobody sends
          .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { const dead = live; live = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); } });
      } catch (e) { live = null; }
    }
    // the safety net (3 Nov — a live Instagram message saved at 03:39 never reached the open page): every 10 s while the page is
    // shown, one tiny read of the newest conversation; newer than what is loaded → one load() (no redraw when nothing changed)
    if (!poll && typeof setInterval === 'function') poll = setInterval(() => { check(); }, POLL_MS);
  }
  const POLL_MS = 10000;
  // one reload per burst, and at most one every 1.5 s however many pings arrive
  let lastLive = 0;
  function onLive() { if (timer) clearTimeout(timer); const wait = Math.max(250, lastLive + 1500 - Date.now()); timer = setTimeout(() => { timer = null; if (st === 'ready') { lastLive = Date.now(); load(); } }, wait); }
  async function check() {
    if (st !== 'ready' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false;
    const cl = c(); if (!cl) return false;
    if (!channel || !live) subscribe();
    try {
      const { data: rows, error } = await cl.from('cs_conversations').select('updated_at').order('updated_at', { ascending: false }).limit(1);
      if (error || !rows || !rows.length || !rows[0].updated_at) return false;
      const latest = Date.parse(rows[0].updated_at); const mine = data.convs.reduce((m, v) => Math.max(m, Date.parse(v.updatedAt || '') || 0), 0);
      if (!(latest > mine)) return false;
      await load(); return true;
    } catch (e) { return false; }
  }
  function unsubscribe() {
    const ch = channel; channel = null; const lv = live; live = null; if (timer) { clearTimeout(timer); timer = null; } if (poll) { clearInterval(poll); poll = null; }
    [ch, lv].forEach((x) => { if (x && c()) { try { Promise.resolve(c().removeChannel(x)).catch(() => {}); } catch (e) { /* already closed */ } } });
  }

  window.IBCS = { load, clear, subscribe, unsubscribe, check, state: () => st, data, can, agents, customer, conv, withDays, timeLabel, clock,
    send, note, event, setStatus, assign, setConvTags, snooze, setUnread, close, open, refreshConv,
    addCustomer, importCustomers, updateCustomer, setMood, setTags, block, addNote, setOverride, rateCustomer, merge,
    saveSegment, deleteSegment, saveCampaign, setCampaignStatus, deleteCampaign, saveSettings,
    channelStatus, connectStart, connectCallback, connectPick, disconnect, commentPrivate, commentHide, metaChannel, metaConnected, waStatus, waLogout, scheduleCampaign,
    toCustomer, toConv, toMessage, toSegment, toCampaign, toChannel, toSettings, segColumns, campColumns, STATUSES, MOODS, UNASSIGNED, DEFAULT_SETTINGS };
})();
