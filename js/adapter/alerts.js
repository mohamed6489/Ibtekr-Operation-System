// Server alerts for the bell's «النظام» section: alerts (RLS: addressed to this user or their role, active profile only)
// joined with this user's alert_reads, newest first: the marks are asked for the loaded ids only (in.(…), so at most LIMIT
// rows however long the read history; PostgREST cuts a response at max_rows). alert_reads is the single per-user read
// state; it is granted select + insert only, so a mark is an insert and a duplicate (23505: read on another device) counts as done.
// markRead/markAllRead change the cache first, then write; failures answer { ok:false } and are never thrown. Marking an
// alert the cache already has as read is a no-op ({ ok:true }, no request, no ib:notify).
// subscribe() adds Realtime inserts (skipped with IB_CONFIG.realtime === false). Every change dispatches ib:notify,
// which refreshes the bell (block 28). alerts.entity is the app hash an alert opens (e.g. 'settings-integrations').
(function () {
  'use strict';
  const LIMIT = 200;
  let items = null; let channel = null; // items: Alert[] once load() succeeded, null before
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const uid = () => { const s = window.IBAuth && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const notify = () => { document.dispatchEvent(new Event('ib:notify')); };
  const done = (error) => !error || error.code === '23505';
  const toAlert = (r, read) => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, entity: r.entity, entityId: r.entity_id, ruleId: r.rule_id || null, sectionId: r.section_id || null, read: !!read });
  const list = () => (items ? items.slice() : []);
  const unread = () => (items ? items.filter((a) => !a.read).length : 0);
  // 0157 — the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md): the bell is the
  // settings' tree — the main sections (its groups) and their sub-sections (the filters) as the admin built them, and every alert
  // under its rule's sub-section; an alert whose «تفاصيل الظهور» passed (hide_at) is gone. Before 0157 the columns are missing and
  // the old select runs (tree stays null — block 28 keeps its old groups).
  let tree = null; // { mains: [{ id, name, icon, subs: [{ id, name, elements: [] }] }] }
  async function loadTree(cl) {
    try {
      const [s, r] = await Promise.all([cl.from('notif_sections').select('id, parent_id, name, icon, sort').order('sort', { ascending: true }).limit(500),
        cl.from('notif_rules').select('id, section_id, element, active').limit(1000)]);
      if (s.error || r.error) { tree = null; return; }
      const all = s.data || []; const rules = r.data || [];
      tree = { mains: all.filter((x) => !x.parent_id).map((m) => ({ id: m.id, name: m.name, icon: m.icon || null,
        subs: all.filter((x) => x.parent_id === m.id).map((x) => ({ id: x.id, name: x.name, elements: [...new Set(rules.filter((y) => y.section_id === x.id).map((y) => y.element))] })) })) };
    } catch (e) { tree = null; }
  }
  async function load() {
    const cl = c(); const id = uid();
    if (!cl || !id) return;
    try {
      const nowIso = new Date().toISOString();
      let a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id, rule_id, section_id, hide_at').or('hide_at.is.null,hide_at.gt.' + nowIso).order('at', { ascending: false }).limit(LIMIT);
      if (a.error) { tree = null; a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id').order('at', { ascending: false }).limit(LIMIT); } else await loadTree(cl);
      if (a.error) return;
      const rows = a.data || []; const ids = rows.map((x) => x.id);
      const r = ids.length ? await cl.from('alert_reads').select('alert_id').eq('user_id', id).in('alert_id', ids) : { data: [] }; // no alerts: no marks to ask for
      if (r.error) return;
      const read = new Set((r.data || []).map((x) => x.alert_id));
      items = rows.map((x) => toAlert(x, read.has(x.id)));
      await loadNotes(cl, id);
      notify(); // the bell was drawn before the alerts arrived
    } catch (e) { /* offline: no server section */ }
  }
  // 0124 — the assistants' notes (docs/superpowers/plans/2026-11-17-agents-brain.md decision 1): the ones the member sees (RLS: his
  // assistants, the last 30 days) with his own read marks; before 0124 the table is missing and the section stays away
  let notes = null;
  async function loadNotes(cl, id) {
    try {
      const n = await cl.from('ai_agent_notes').select('id, agent, kind, title, body, link, created_at').order('created_at', { ascending: false }).limit(100);
      if (n.error) { notes = null; return; }
      const ids = (n.data || []).map((x) => x.id);
      const r = ids.length ? await cl.from('ai_agent_note_reads').select('note_id').eq('member_id', id).in('note_id', ids) : { data: [] };
      const read = new Set(((r && r.data) || []).map((x) => x.note_id));
      notes = (n.data || []).map((x) => ({ id: x.id, agent: x.agent, kind: x.kind, title: x.title, body: x.body || '', link: x.link || null, at: x.created_at, read: read.has(x.id) }));
    } catch (e) { notes = null; }
  }
  const noteList = () => (notes ? notes.slice() : []);
  async function noteRead(ids) {
    const cl = c(); const L = (ids || []).filter((i) => notes && notes.some((n) => n.id === i && !n.read)); if (!cl || !L.length) return { ok: true };
    notes.forEach((n) => { if (L.includes(n.id)) n.read = true; }); notify();
    try { const { error } = await cl.rpc('ai_agent_note_read', { p_ids: L }); return { ok: !error }; } catch (e) { return { ok: false }; }
  }
  // the click: the member's chat for the note (made on the server once) → «الذكاء الاصطناعي» on that assistant and that chat
  // agents-brain decision 7 (T7): a note with the action ready — «cs/<conversation>» — opens that conversation with the assistant's
  // reply in the box (the text after «الرد المقترح:» in its body); a member presses «ابعت». A conversation answered since = no reply put in.
  const DRAFT_MARK = 'الرد المقترح:';
  const draftOf = (body) => { const i = String(body || '').indexOf(DRAFT_MARK); return i < 0 ? '' : String(body).slice(i + DRAFT_MARK.length).trim(); };
  function openPlace(n) {
    const m = /^cs\/([0-9a-f-]{36})$/i.exec(n.link || ''); if (!m) return false;
    const P = window.IBPages && window.IBPages.all && window.IBPages.all().cs; const S = P && P.api && P.api.data;
    const conv = S && Array.isArray(S.convs) ? S.convs.find((x) => x.id === m[1]) : null;
    const draft = conv && conv.status === 'مستنية ردنا' ? draftOf(n.body) : '';
    if (P && P.api && P.api.openConversation && P.api.openConversation(m[1], draft) !== false) return true;
    window.location.hash = 'cs-inbox'; return true;
  }
  async function noteOpen(id) {
    const cl = c(); const n = notes && notes.find((x) => x.id === id); if (!cl || !n) return { ok: false };
    if (openPlace(n)) { noteRead([id]); return { ok: true, place: n.link }; }
    n.read = true; notify();
    try {
      const { data, error } = await cl.rpc('ai_agent_note_open', { p_id: id });
      if (error || !data) { window.location.hash = 'ai-' + n.agent; return { ok: false }; }
      if (typeof window.IBAiOpen === 'function') window.IBAiOpen(n.agent, data); else window.location.hash = 'ai-' + n.agent;
      return { ok: true, chat: data };
    } catch (e) { window.location.hash = 'ai-' + n.agent; return { ok: false }; }
  }
  const NOTE_KIND = { problem: ['مشكلة', 'error', 'alert'], idea: ['اقتراح', 'info', 'sparkle'], update: ['تحديث', 'neutral', 'bell'], report: ['تقرير', 'brand', 'chart'], alert: ['تنبيه', 'warning', 'bell'] };
  function agentSection() {
    if (!notes || !notes.length) return null; // nothing from the assistants yet: no empty section in the bell
    const M = window.IBMarketing; const nameOf = (a) => { const r = M && M.agentOf ? M.agentOf(a) : null; return (r && r.name) || a; };
    const all = notes.map((n) => { const k = NOTE_KIND[n.kind] || NOTE_KIND.update;
      return { key: 'an:' + n.id, title: n.title, sub: nameOf(n.agent) + ' · ' + k[0], meta: relTime(n.at, Date.now()), tone: k[1], icon: k[2], muted: n.read, run: () => { noteOpen(n.id); } }; });
    const unreadN = all.filter((x) => !x.muted).length;
    return { id: 'agents', label: 'المساعدين', icon: 'sparkle', unit: 'تنبيه', received: unreadN, all: () => noteRead(notes.filter((n) => !n.read).map((n) => n.id)), allLabel: 'تعليم الكل كمقروء',
      empty: 'المساعدين مابعتوش حاجة لسه.', tabs: [['all', 'الكل', all], ['unread', 'غير مقروء', all.filter((x) => !x.muted)], ['problem', 'مشاكل', all.filter((x, i) => notes[i].kind === 'problem')], ['read', 'مقروء', all.filter((x) => x.muted)]] };
  }
  async function write(build) {
    const cl = c(); const id = uid();
    if (!cl || !id) return { ok: false };
    try { const { error } = await build(cl.from('alert_reads'), id); return { ok: done(error) }; } catch (e) { return { ok: false }; }
  }
  async function markRead(id) {
    const a = items && items.find((x) => x.id === id);
    if (a && a.read) return { ok: true }; // already read: nothing to write, nothing to redraw
    if (a) a.read = true;
    const r = await write((q, user) => q.insert({ alert_id: id, user_id: user }));
    notify(); return r;
  }
  // no UPDATE grant on alert_reads: never a merging upsert; ignore-duplicates = insert … on conflict do nothing
  async function markAllRead() {
    const open = items ? items.filter((a) => !a.read) : [];
    if (!open.length) return { ok: true };
    open.forEach((a) => { a.read = true; });
    const r = await write((q, user) => q.upsert(open.map((a) => ({ alert_id: a.id, user_id: user })), { onConflict: 'alert_id,user_id', ignoreDuplicates: true }));
    notify(); return r;
  }
  function onInsert(p) {
    const row = p && p.new;
    if (!items || !row || items.some((a) => a.id === row.id)) return;
    items.unshift(toAlert(row, false)); if (items.length > LIMIT) items.length = LIMIT;
    notify();
  }
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {};
    if (channel || !cl || !uid() || cfg.realtime === false) return;
    try { channel = cl.channel('alerts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, onInsert).subscribe(); } catch (e) { channel = null; /* no live updates; load() still works */ }
  }
  function unsubscribe() {
    const ch = channel; channel = null;
    if (ch && c()) { try { Promise.resolve(c().removeChannel(ch)).catch(() => {}); } catch (e) { /* already closed */ } }
  }
  const clear = () => { items = null; notes = null; tree = null; };
  const toneOf = (kind) => { const k = String(kind || ''); return /fail|error|down|late|overdue/i.test(k) ? 'error' : /\.(ok|done|success|info)$/i.test(k) ? 'info' : 'warning'; };
  function relTime(iso, nowMs) {
    const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
    const min = Math.floor((nowMs - t) / 60000);
    if (min < 1) return 'دلوقتي';
    if (min < 60) return 'منذ ' + min + ' دقيقة';
    const hr = Math.floor(min / 60);
    if (hr < 24) return 'منذ ' + hr + ' ساعة';
    if (hr < 48) return 'أمس';
    return 'منذ ' + Math.floor(hr / 24) + ' أيام';
  }
  // the bell section, same shape as block 28's: read alerts are muted, so the badge and topNeed skip them
  const HASH = /^[a-z][a-z0-9-]*(\/[\w-]+)?$/;
  function item(a) {
    const tone = toneOf(a.kind);
    return { key: 'sa:' + a.id, title: a.title, sub: a.body || '', meta: relTime(a.at, Date.now()), tone, icon: tone === 'error' ? 'alert' : tone === 'info' ? 'check' : 'bell', muted: a.read,
      run: () => { markRead(a.id); if (a.entity && HASH.test(a.entity)) window.location.hash = a.entity; } };
  }
  function section() {
    if (!items) return null;
    const all = items.map(item);
    return { id: 'server', label: 'النظام', icon: 'bell', unit: 'تنبيه', received: unread(), all: () => markAllRead(), allLabel: 'تعليم الكل كمقروء', empty: 'مفيش تنبيهات من السيستم.',
      tabs: [['all', 'الكل', all], ['unread', 'غير مقروء', all.filter((x) => !x.muted)], ['read', 'مقروء', all.filter((x) => x.muted)]] };
  }
  // the bell's groups from the tree: a main section = a group; its tabs = «الكل», one per sub-section, and «غير مقروء» / «مقروء»;
  // an alert written straight by a database function (no rule) sits under the first sub-section whose rules are of its element
  // (IBNotifCatalog.elementOfKind), else under the first group. open(a) = what the click does (block 28: the order's popup, the
  // conversation, the request …). sort: 'new' (default) | 'old'. The green dot = unread; read = muted.
  function treeSections(open, sort) {
    if (!tree || !tree.mains.length || !items) return null;
    const C = window.IBNotifCatalog; const subOf = new Map(); tree.mains.forEach((m) => m.subs.forEach((x) => subOf.set(x.id, m.id)));
    const placeOf = (a) => {
      if (a.sectionId && subOf.has(a.sectionId)) return a.sectionId;
      const el = C && C.elementOfKind ? C.elementOfKind(a.kind) : null;
      for (const m of tree.mains) for (const x of m.subs) if (el && x.elements.includes(el)) return x.id;
      return null; // the first group's «الكل»
    };
    const placed = items.map((a) => ({ a, sub: placeOf(a) }));
    const ord = (L) => L.slice().sort((x, y) => (sort === 'old' ? 1 : -1) * (Date.parse(x.a.at) - Date.parse(y.a.at)));
    const asItem = ({ a }) => { const tone = toneOf(a.kind); return { key: 'sa:' + a.id, title: a.title, sub: a.body || '', meta: relTime(a.at, Date.now()), tone, icon: tone === 'error' ? 'alert' : 'bell', muted: a.read, fresh: !a.read,
      run: () => { markRead(a.id); if (typeof open === 'function' && open(a) !== false) return; if (a.entity && HASH.test(a.entity)) window.location.hash = a.entity; } }; };
    return tree.mains.map((m, i) => {
      const subIds = new Set(m.subs.map((x) => x.id));
      const mine = ord(placed.filter((p) => (p.sub ? subIds.has(p.sub) : i === 0)));
      const all = mine.map(asItem);
      const tabs = [['all', 'الكل', all]].concat(m.subs.map((x) => ['s:' + x.id, x.name, mine.filter((p) => p.sub === x.id).map(asItem)]),
        [['unread', 'غير مقروء', all.filter((x) => !x.muted)], ['read', 'مقروء', all.filter((x) => x.muted)]]);
      return { id: 'n:' + m.id, label: m.name, icon: m.icon || 'bell', unit: 'تنبيه', received: all.filter((x) => !x.muted).length, all: () => markMany(mine.map((p) => p.a.id)), allLabel: 'تعليم القسم كمقروء',
        empty: 'مفيش تنبيهات هنا دلوقتي.', tabs, tree: true };
    });
  }
  async function markMany(ids) {
    const open = items ? items.filter((a) => ids.includes(a.id) && !a.read) : [];
    if (!open.length) return { ok: true };
    open.forEach((a) => { a.read = true; });
    const r = await write((q, user) => q.upsert(open.map((a) => ({ alert_id: a.id, user_id: user })), { onConflict: 'alert_id,user_id', ignoreDuplicates: true }));
    notify(); return r;
  }
  // an assistant's note written into the bell by a rule (entity_id «note:<id>»): its chat, as the old section did
  async function openNote(noteId, agent, link) {
    const cl = c(); if (!cl) return false;
    const n = { id: noteId, agent, link, body: '' }; if (link && openPlace(n)) return true;
    try { const { data, error } = await cl.rpc('ai_agent_note_open', { p_id: noteId }); if (error || !data) { window.location.hash = 'ai-' + agent; return true; }
      if (typeof window.IBAiOpen === 'function') window.IBAiOpen(agent, data); else window.location.hash = 'ai-' + agent; return true; } catch (e) { window.location.hash = 'ai-' + agent; return true; }
  }
  const hasTree = () => !!(tree && tree.mains.length);
  window.IBAlerts = { load, treeSections, hasTree, markMany, openNote, list, unread, markRead, markAllRead, subscribe, unsubscribe, clear, section, toneOf, relTime, noteList, noteRead, noteOpen, agentSection, draftOf };
})();
