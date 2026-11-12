// Team tickets «تذاكر الفريق» (phase 8, 0045, docs/superpowers/plans/2026-11-05-phase-8-tickets.md). load() reads the tickets the
// member sees (RLS: tickets.view F = all, P = their role's + the ones they opened) and the recent timeline, in the v2 domain's shapes
// (block 05 createStore), so the page (block 28) reads them through a store with the same names:
//   all() / get(id) / events(id)   id = 'TKT-0001' (the identity number padded); a ticket { id, dbId, type, title, description, priority,
//                                  assigneeRole, orderId (the typed number), orderDbId, customer, csCustomerId, csConversationId, vendor,
//                                  vendorId, reason, followUp, attachments, status, createdBy { name, role, uid }, createdAt, lastUpdate,
//                                  reopenCount, resolution { outcome, note, by, at } | null, closedBy, closedAt }; an event
//                                  { id, kind: 'message' | 'event', at, author / actor { name, role }, actorUid, text, oldValue, newValue, attachments }
// Every write goes through the RPCs (ticket_create / ticket_act — the server applies the domain's rules) and returns a Promise of
// { ok, reason?, message? } that never throws (reason 'forbidden' 42501, 'invalid' 22xxx with the field, 'notfound' P0002,
// 'network'); each one the server took is logged as ticket.<x> through IBActivity (the ticket number, statuses, roles and counts —
// never a message's text). The member's ticket roles mirror 0045's ticket_role_labels (canWork / canClose for the buttons; the
// server decides). Files (decision 2): upload(file) into the bucket «tickets» under the member's own folder, fileUrl(path) a short
// signed link. Live (decision 9): the private broadcast «tickets» / «changed» → one load() a moment later, plus a check every 30 s.
(function () {
  'use strict';
  const COLS = 'id, type, kind, project, title, description, priority, assignee_role, order_number, order_id, customer, cs_customer_id, cs_conversation_id, vendor_id, vendor, reason, follow_up, attachments, status, created_by, created_by_name, created_by_role, created_at, last_update, reopen_count, resolution_outcome, resolution_note, resolved_by_name, resolved_at, closed_by_name, closed_at';
  const EV_COLS = 'id, ticket_id, kind, at, actor, actor_name, actor_role, text, old_value, new_value, attachments';
  const LIMIT = 2000; const EV_LIMIT = 5000; const EV_DAYS = 30;
  const BUCKET = 'tickets'; const MAX_FILES = 10; const MAX_BYTES = 10 * 1024 * 1024;
  const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
  const ROLE_LABELS = { admin: ['مدير النظام'], cs: ['خدمة العملاء'], vendors_followup: ['متابعة المبتكرين'], accounts: ['الحسابات'], ops: ['اللوجستيك والشحن', 'المحتوى والتصوير'] };
  const OPEN = new Set(['open', 'in_progress', 'waiting']);
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const myUid = () => { const m = me(); return (m && m.id) || null; };
  const isAdmin = () => !!(me() && me().role_id === 'admin' && perm('tickets.view') === 'F');
  const can = () => ({ view: perm('tickets.view') !== 'N', manage: perm('tickets.manage') === 'F', admin: isAdmin() });
  // 0081 (the owner 12 Nov): the old system roles keep their labels; any other role answers to its name; my roles = the main + the extras
  const dirRoles = () => (window.IBDirectory && window.IBDirectory.roles ? quiet(() => window.IBDirectory.roles()) || [] : []);
  const labelsOf = (rid) => { if (ROLE_LABELS[rid]) return ROLE_LABELS[rid].slice(); if (!rid || rid === 'viewer') return []; const r = dirRoles().find((x) => x.id === rid && !x.hidden); return r ? [r.name] : []; };
  const myRoles = () => { const m = me(); if (!m || m.status === 'suspended') return []; return [...new Set([m.role_id].concat(Array.isArray(m.extra_roles) ? m.extra_roles : []).flatMap(labelsOf))]; };
  const actor = () => { const m = me() || {}; const roles = window.IBDirectory && window.IBDirectory.roles ? quiet(() => window.IBDirectory.roles()) : null;
    return { name: m.name || '—', role: labelsOf(m.role_id)[0] || (roles && roles[m.role_id] && roles[m.role_id].name) || 'عضو', uid: m.id || null }; };
  const canWork = (t) => !!t && can().manage && (isAdmin() || myRoles().includes(t.assigneeRole));
  const canClose = (t) => !!t && can().manage && (isAdmin() || (!!t.createdBy && !!t.createdBy.uid && t.createdBy.uid === myUid()));
  const isMine = (t) => !!t && myRoles().includes(t.assigneeRole);
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' ? 'notfound' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fieldOf = (err) => { const m = /invalid: (\w+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };
  const MESSAGES = { forbidden: 'مفيش صلاحية للإجراء ده', notfound: 'التذكرة مش موجودة أو مش متاحة ليك', network: 'تعذّر الاتصال — جرّب تاني', invalid: 'راجع البيانات' };
  const FIELD_MESSAGES = { closed: 'التذكرة مغلقة — أعد فتحها الأول', status: 'الحالة دي مش متاحة للتذكرة دي', outcome: 'اختار نتيجة الحل', reason: 'اكتب السبب', text: 'اكتب الرد',
    attachments: 'المرفقات: صور أو PDF، لحد ' + MAX_FILES + ' ملفات و10 ميجا للملف', followUp: 'اكتب التاريخ بالشكل يوم/شهر/سنة', orderId: 'اكتب رقم الأوردر', vendor: 'اختار المبتكر', title: 'العنوان أقصاه 80 حرف' };
  const fail = (err) => { const reason = reasonOf(err); const field = reason === 'invalid' ? fieldOf(err) : null; return { ok: false, reason, field, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] }; };
  const log = (action, detail, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log(action, detail, { entity: 'ticket', entity_id: id || null })); };
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:tickets', { detail: detail || {} })));

  const tid = (n) => 'TKT-' + String(n).padStart(4, '0');
  const dbIdOf = (id) => { const s = String(id == null ? '' : id); const m = /^TKT-(\d+)$/.exec(s); return m ? Number(m[1]) : /^\d+$/.test(s) ? Number(s) : null; };
  const files = (a) => (Array.isArray(a) ? a.filter((f) => f && typeof f.path === 'string').map((f) => ({ path: f.path, name: f.name || f.path.replace(/^.*\//, ''), type: f.type || '', size: Number(f.size) || 0 })) : []);
  const toTicket = (r) => ({ id: tid(r.id), dbId: Number(r.id), type: r.type, kind: r.kind || null, project: r.project || null, title: r.title, description: r.description, priority: r.priority, assigneeRole: r.assignee_role,
    orderId: r.order_number || null, orderDbId: r.order_id != null ? Number(r.order_id) : null, customer: r.customer || null, csCustomerId: r.cs_customer_id || null, csConversationId: r.cs_conversation_id || null,
    vendor: r.vendor || null, vendorId: r.vendor_id || null, reason: r.reason || null, followUp: r.follow_up || null, attachments: files(r.attachments), status: r.status,
    createdBy: { name: r.created_by_name, role: r.created_by_role, uid: r.created_by || null }, createdAt: r.created_at, lastUpdate: r.last_update, reopenCount: Number(r.reopen_count) || 0,
    resolution: r.resolution_outcome ? { outcome: r.resolution_outcome, note: r.resolution_note || '', by: r.resolved_by_name || '', at: r.resolved_at } : null, closedBy: r.closed_by_name || null, closedAt: r.closed_at || null });
  const toEvent = (e) => { const who = { name: e.actor_name, role: e.actor_role };
    return e.kind === 'message' ? { id: Number(e.id), kind: 'message', at: e.at, author: who, actorUid: e.actor || null, text: e.text, attachments: files(e.attachments) }
      : { id: Number(e.id), kind: 'event', at: e.at, text: e.text, actor: who, actorUid: e.actor || null, oldValue: e.old_value == null ? null : e.old_value, newValue: e.new_value == null ? null : e.new_value }; };

  let st = 'idle'; let gen = 0;
  const data = { tickets: [], events: new Map(), full: new Set() }; // events: dbId → [event] (oldest first); full: the tickets whose whole timeline is loaded
  async function rows(q) { const { data: d, error } = await q; if (error) throw error; return Array.isArray(d) ? d : []; }
  const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id);
  function putEvents(list, ids) {
    const fresh = new Map(); list.forEach((e) => { const k = Number(e.ticket_id); if (!fresh.has(k)) fresh.set(k, []); fresh.get(k).push(toEvent(e)); });
    (ids || [...fresh.keys()]).forEach((k) => { data.events.set(k, (fresh.get(k) || []).sort(byAt)); });
  }
  async function load() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().view) { data.tickets = []; data.events.clear(); data.full.clear(); st = 'ready'; emit(); return { ok: true }; }
    const g = ++gen; st = 'loading';
    try {
      const since = new Date(Date.now() - EV_DAYS * 86400000).toISOString();
      const [ts, evs] = await Promise.all([
        rows(cl.from('tickets').select(COLS).order('last_update', { ascending: false }).limit(LIMIT)),
        rows(cl.from('ticket_events').select(EV_COLS).gte('at', since).order('at', { ascending: true }).limit(EV_LIMIT)),
      ]);
      if (g !== gen) return { ok: false, reason: 'stale' };
      data.tickets = ts.map(toTicket);
      const keep = new Set(data.tickets.map((t) => t.dbId));
      // a ticket whose whole timeline was opened keeps it; the rest take the recent window
      const recent = new Map(); evs.forEach((e) => { const k = Number(e.ticket_id); if (!recent.has(k)) recent.set(k, []); recent.get(k).push(e); });
      for (const k of [...data.events.keys()]) if (!keep.has(k)) { data.events.delete(k); data.full.delete(k); }
      keep.forEach((k) => { if (!data.full.has(k)) data.events.set(k, (recent.get(k) || []).map(toEvent).sort(byAt)); else if (recent.has(k)) mergeEvents(k, recent.get(k)); });
      ensureSeen(); st = 'ready'; emit(); subscribe();
      if (!rolesFor) { rolesFor = g; loadRoles(g); } // once a session — never in the 30 s check
      return { ok: true };
    } catch (e) { if (g === gen) st = 'error'; emit(); return fail(e); }
  }
  // the roles a request may go to (0081 ticket_roles(): the six old labels + every other role by its name) → the domain's list
  let rolesFor = 0;
  async function loadRoles(g) {
    const cl = c(); if (!cl || !window.IbtekrTickets || !window.IbtekrTickets.setRoles) return;
    try { const r = await cl.rpc('ticket_roles'); if (g !== gen) return; if (!r.error && Array.isArray(r.data)) { window.IbtekrTickets.setRoles(r.data.map((x) => x && x.label)); emit(); } else rolesFor = 0; } catch (e) { if (g === gen) rolesFor = 0; /* the six stay; the next load asks again */ }
  }
  function mergeEvents(k, list) { const have = data.events.get(k) || []; const ids = new Set(have.map((x) => x.id)); list.forEach((e) => { if (!ids.has(Number(e.id))) have.push(toEvent(e)); }); data.events.set(k, have.sort(byAt)); }
  // the whole timeline of one ticket (the drawer opens it); older than the recent window when the ticket is old
  async function loadEvents(id) {
    const cl = c(); const k = dbIdOf(id); if (!cl || k == null) return { ok: false, reason: 'invalid' };
    try { const list = await rows(cl.from('ticket_events').select(EV_COLS).eq('ticket_id', k).order('at', { ascending: true })); putEvents(list, [k]); data.full.add(k); emit({ id: tid(k) }); return { ok: true }; }
    catch (e) { return fail(e); }
  }
  // one ticket + its timeline again after a write
  async function refresh(k) {
    const cl = c(); if (!cl) return;
    try {
      const [t, evs] = await Promise.all([rows(cl.from('tickets').select(COLS).eq('id', k)), rows(cl.from('ticket_events').select(EV_COLS).eq('ticket_id', k).order('at', { ascending: true }))]);
      const i = data.tickets.findIndex((x) => x.dbId === k);
      if (!t.length) { if (i >= 0) data.tickets.splice(i, 1); data.events.delete(k); data.full.delete(k); }
      else { const nt = toTicket(t[0]); if (i >= 0) data.tickets[i] = nt; else data.tickets.unshift(nt); putEvents(evs, [k]); data.full.add(k); }
    } catch (e) { /* the next load() picks it up */ }
    emit({ id: tid(k) });
  }
  function clear() { gen += 1; rolesFor = 0; unsubscribe(); data.tickets = []; data.events.clear(); data.full.clear(); memSince = null; st = 'idle'; if (window.IbtekrTickets && window.IbtekrTickets.setRoles) window.IbtekrTickets.setRoles([]); }

  // ---------- the store the page reads (block 05's createStore names) ----------
  const copy = (t) => (t ? Object.assign({}, t, { createdBy: Object.assign({}, t.createdBy), resolution: t.resolution ? Object.assign({}, t.resolution) : null, attachments: t.attachments.slice() }) : null);
  const all = () => data.tickets.map(copy);
  const get = (id) => copy(data.tickets.find((t) => t.dbId === dbIdOf(id)) || null);
  const events = (id) => (data.events.get(dbIdOf(id)) || []).slice();
  const openOnes = (fn) => data.tickets.filter((t) => OPEN.has(t.status) && fn(t)).map(copy);
  const forOrder = (num) => { const s = String(num == null ? '' : num).trim(); return s ? openOnes((t) => t.orderId === s || (t.orderDbId != null && String(t.orderDbId) === s)) : []; };
  const forVendor = (vid) => (vid ? openOnes((t) => t.vendorId === vid) : []);
  const forCustomer = (cid, any) => (cid ? (any ? data.tickets.filter((t) => t.csCustomerId === cid).map(copy) : openOnes((t) => t.csCustomerId === cid)) : []);
  const forConversation = (vid, any) => (vid ? (any ? data.tickets.filter((t) => t.csConversationId === vid).map(copy) : openOnes((t) => t.csConversationId === vid)) : []);

  // ---------- the bell (decisions 7 + 9) ----------
  // what reaches the member: a new ticket for their role, a reply / a change by someone else on a ticket they opened or their role
  // owns — after the last one they saw (user_prefs «tickets.seen» = { since, ids: { dbId: last event id } }; the first time = from now,
  // so the history does not flood the bell). Opening a ticket marks it seen. Overdue / reopened stay tasks until they are handled.
  const SEEN = 'tickets.seen';
  const prefs = () => window.IBPrefs || null;
  // the baseline lives in memory from the first load and is saved with the first item that reaches the bell (no write per sign-in)
  let memSince = null;
  const saved = () => { const v = prefs() && prefs().get ? prefs().get(SEEN) : null; return v && typeof v === 'object' && v.ids && v.since ? v : null; };
  const seenState = () => saved() || (memSince ? { since: memSince, ids: {} } : null);
  function ensureSeen() { if (!saved() && !memSince) memSince = new Date().toISOString(); }
  const relevant = (t) => isMine(t) || (!!t.createdBy.uid && t.createdBy.uid === myUid());
  function bell() {
    const uid = myUid(); const seen = seenState(); if (!uid || !seen || !can().view) return [];
    const out = [];
    for (const t of data.tickets) {
      if (!relevant(t)) continue;
      const evs = data.events.get(t.dbId) || []; const last = Number(seen.ids[t.dbId]) || 0;
      const fresh = evs.filter((e) => e.id > last && e.at > seen.since && e.actorUid !== uid); if (!fresh.length) continue;
      const isNew = !last && isMine(t) && t.createdBy.uid !== uid && t.createdAt > seen.since;
      const e = fresh[fresh.length - 1];
      const sub = isNew ? 'تذكرة جديدة لدور «' + t.assigneeRole + '» من ' + t.createdBy.name
        : e.kind === 'message' ? 'رد من ' + e.author.name + ': ' + String(e.text || '').slice(0, 60) : e.text;
      out.push({ id: t.id, kind: isNew ? 'new' : 'update', title: t.id + ' — ' + t.title, sub, prio: t.priority, at: e.at, count: fresh.length });
    }
    if (out.length && !saved() && prefs() && prefs().set) quiet(() => prefs().set(SEEN, { since: seen.since, ids: {} }));
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  function markSeen(id) {
    const k = dbIdOf(id); const seen = seenState(); if (k == null || !seen || !prefs()) return;
    const evs = data.events.get(k) || []; const last = evs.reduce((m, e) => Math.max(m, e.id), 0);
    if (!last || (Number(seen.ids[k]) || 0) >= last) return;
    const keep = new Set(data.tickets.map((t) => String(t.dbId)));
    const ids = {}; Object.keys(seen.ids).forEach((x) => { if (keep.has(x)) ids[x] = seen.ids[x]; }); ids[k] = last;
    quiet(() => prefs().set(SEEN, { since: seen.since, ids }));
    quiet(() => document.dispatchEvent(new CustomEvent('ib:notify')));
  }

  // ---------- writes ----------
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const vendorIdOf = (name) => { const V = window.IBVendors && window.IBVendors.store; const v = name && V && V.findByName ? quiet(() => V.findByName(name)) : null; return v ? v.id : null; };
  async function create(f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().manage) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const input = { type: f.type, title: f.title, description: f.description, priority: f.priority, assigneeRole: f.assigneeRole, reason: f.reason || null,
      followUp: f.followUp || null, attachments: files(f.attachments).slice(0, MAX_FILES) };
    if (f.type === 'customer' || (f.orderId && clean(f.orderId, 20))) input.orderId = clean(f.orderId, 20);
    if (f.customer) input.customer = clean(f.customer, 80);
    if (f.type === 'vendor') input.vendorId = f.vendorId || vendorIdOf(f.vendor);
    if (f.csConversationId) input.csConversationId = f.csConversationId;
    if (f.csCustomerId) input.csCustomerId = f.csCustomerId;
    try {
      const { data: n, error } = await cl.rpc('ticket_create', { p_input: input }); if (error) return fail(error);
      const k = Number(n); log('ticket.create', tid(k) + ' · ' + f.type + ' · ' + f.assigneeRole + (input.attachments.length ? ' · ' + input.attachments.length + ' مرفق' : ''), tid(k));
      await refresh(k); return { ok: true, id: tid(k) };
    } catch (e) { return { ok: false, reason: 'network', message: MESSAGES.network }; }
  }
  // 0082 (the owner 12 Nov — «تقديم طلب» beside each assistant in التسويق): a request to the human designer / developer / media buyer =
  // a team request of that kind, to the kind's role unless another was picked; «طلبات الفريق» works it, التسويق lists it
  const REQ_KINDS = ['design', 'dev', 'media'];
  async function createRequest(kind, f) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!REQ_KINDS.includes(kind)) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    if (!can().manage) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const input = { title: f.title, description: f.description, priority: f.priority || 'normal', followUp: f.followUp || null, attachments: files(f.attachments).slice(0, MAX_FILES) };
    if (f.assigneeRole) input.assigneeRole = f.assigneeRole;
    try {
      const { data: n, error } = await cl.rpc('ticket_request_create', { p_kind: kind, p_project: clean(f.project, 60) || null, p_input: input }); if (error) return fail(error);
      const k = Number(n); log('ticket.create', tid(k) + ' · ' + kind + (f.assigneeRole ? ' · ' + f.assigneeRole : '') + (input.attachments.length ? ' · ' + input.attachments.length + ' مرفق' : ''), tid(k));
      await refresh(k); return { ok: true, id: tid(k) };
    } catch (e) { return { ok: false, reason: 'network', message: MESSAGES.network }; }
  }
  const requests = (kind) => data.tickets.filter((t) => t.kind && (!kind || t.kind === kind));
  async function act(id, action, args, detail) {
    const cl = c(); const k = dbIdOf(id); if (!cl) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (k == null) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
    if (!can().manage) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    try {
      const { error } = await cl.rpc('ticket_act', { p_id: k, p_action: action, p_args: args || {} }); if (error) return fail(error);
      log('ticket.' + action, tid(k) + (detail ? ' · ' + detail : ''), tid(k)); await refresh(k); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network', message: MESSAGES.network }; }
  }
  const statusOf = (id) => (get(id) || {}).status || '';
  const setStatus = (id, status) => act(id, 'set_status', { status }, statusOf(id) + ' → ' + status);
  const resolve = (id, f) => act(id, 'resolve', { outcome: (f && f.outcome) || '', note: (f && f.note) || '' }, (f && f.outcome) || '');
  const close = (id) => act(id, 'close', {}, statusOf(id) + ' → closed');
  const reopen = (id, f) => act(id, 'reopen', { reason: (f && f.reason) || '' }, '×' + (((get(id) || {}).reopenCount || 0) + 1));
  function update(id, patch) {
    const args = {}; ['assigneeRole', 'priority', 'followUp'].forEach((k) => { if (patch && patch[k] !== undefined) args[k] = patch[k] == null ? '' : patch[k]; });
    return act(id, 'update', args, Object.keys(args).map((k) => k + (k === 'followUp' ? '' : '=' + args[k])).join(', '));
  }
  const reply = (id, text, attachments) => { const a = files(attachments).slice(0, MAX_FILES); return act(id, 'reply', { text, attachments: a }, a.length ? a.length + ' مرفق' : ''); };

  // ---------- files (decision 2) ----------
  const safeName = (n) => { const base = String(n || 'file').replace(/^.*[\\/]/, ''); const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(base) || [])[1] || '';
    const stem = base.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'file'; return ext ? stem + '.' + ext.toLowerCase() : stem; };
  const rand = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10));
  function checkFile(file) {
    if (!file || typeof file.size !== 'number') return 'invalid';
    if (!MIME.includes(file.type)) return 'type';
    if (file.size > MAX_BYTES) return 'size';
    return null;
  }
  async function upload(file) {
    const cl = c(); const uid = myUid(); if (!cl || !uid) return { ok: false, reason: 'network', message: MESSAGES.network };
    if (!can().manage) return { ok: false, reason: 'forbidden', message: MESSAGES.forbidden };
    const bad = checkFile(file); if (bad) return { ok: false, reason: 'invalid', field: bad, message: bad === 'size' ? 'الملف أكبر من 10 ميجا' : 'المرفقات صور (PNG / JPG / WebP / GIF) أو PDF بس' };
    const path = uid + '/' + rand() + '-' + safeName(file.name);
    try {
      const { error } = await cl.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (error) return { ok: false, reason: 'network', message: 'تعذّر رفع الملف — جرّب تاني' };
      return { ok: true, file: { path, name: clean(file.name, 120) || path.replace(/^.*\//, ''), type: file.type, size: file.size } };
    } catch (e) { return { ok: false, reason: 'network', message: 'تعذّر رفع الملف — جرّب تاني' }; }
  }
  const urls = new Map(); // path → { url, until }
  async function fileUrl(path) {
    const cl = c(); if (!cl || !path) return null;
    const hit = urls.get(path); if (hit && hit.until > Date.now()) return hit.url;
    try { const { data: d, error } = await cl.storage.from(BUCKET).createSignedUrl(path, 600); if (error || !d || !d.signedUrl) return null; urls.set(path, { url: d.signedUrl, until: Date.now() + 540000 }); return d.signedUrl; }
    catch (e) { return null; }
  }

  // ---------- live (decision 9) ----------
  let live = null; let poll = null; let timer = null; let lastLive = 0; const POLL_MS = 30000;
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {}; if (!cl || !myUid() || cfg.realtime === false) return;
    if (!live) {
      try {
        live = cl.channel('tickets', { config: { private: true } }).on('broadcast', { event: 'changed' }, onLive) // 0045: members with tickets.view only, nobody sends
          .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { const dead = live; live = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); } });
      } catch (e) { live = null; }
    }
    if (!poll && typeof setInterval === 'function') poll = setInterval(() => { check(); }, POLL_MS);
  }
  function onLive() { if (timer) clearTimeout(timer); const wait = Math.max(250, lastLive + 1500 - Date.now()); timer = setTimeout(() => { timer = null; if (st === 'ready') { lastLive = Date.now(); load(); } }, wait); }
  // the safety net: the newest last_update the member sees, newer than what is loaded → one load()
  async function check() {
    if (st !== 'ready' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false;
    const cl = c(); if (!cl) return false;
    if (!live) subscribe();
    try {
      const { data: r, error } = await cl.from('tickets').select('last_update').order('last_update', { ascending: false }).limit(1);
      if (error || !r || !r.length) return false;
      const latest = Date.parse(r[0].last_update); const mine = data.tickets.reduce((m, t) => Math.max(m, Date.parse(t.lastUpdate || '') || 0), 0);
      if (!(latest > mine)) return false;
      await load(); return true;
    } catch (e) { return false; }
  }
  function unsubscribe() {
    const lv = live; live = null; if (timer) { clearTimeout(timer); timer = null; } if (poll) { clearInterval(poll); poll = null; }
    if (lv && c()) { try { Promise.resolve(c().removeChannel(lv)).catch(() => {}); } catch (e) { /* already closed */ } }
  }

  // the ticket roles of a member's role (the owner 11 Nov — «مين اكتر حد عنده شغل» on the overview)
  const rolesOf = (roleId) => labelsOf(roleId);
  window.IBTickets = { load, clear, loadEvents, subscribe, unsubscribe, check, state: () => st, can, myRoles, rolesOf, actor, canWork, canClose, canReopen: canClose, isMine,
    all, get, events, bell, markSeen, forOrder, forVendor, forCustomer, forConversation, create, createRequest, requests, REQ_KINDS, setStatus, resolve, close, reopen, update, reply, upload, fileUrl, checkFile,
    MAX_FILES, MAX_BYTES, MIME, tid, dbIdOf, _test: { toTicket, toEvent, safeName, files, fail } };
})();
