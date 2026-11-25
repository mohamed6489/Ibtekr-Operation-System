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
  const toAlert = (r, read) => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, entity: r.entity, entityId: r.entity_id, ruleId: r.rule_id || null, sectionId: r.section_id || null,
    meta: r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? r.meta : null, read: !!read });
  const list = () => (items ? items.slice() : []);
  const unread = () => (items ? items.filter((a) => !a.read).length : 0);
  // 0157 — the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md): the bell is the
  // settings' tree — the main sections (its groups) and their sub-sections (the filters) as the admin built them, and every alert
  // under its rule's sub-section; an alert whose «تفاصيل الظهور» passed (hide_at) is gone. Before 0157 the columns are missing and
  // the old select runs (tree stays null — block 28 keeps its old groups).
  let ruleSec = new Map(); // a working rule's id → its sub-section
  let tree = null; // { mains: [{ id, name, icon, subs: [{ id, name, elements: [] }] }] }
  async function loadTree(cl) {
    try {
      const [s, r] = await Promise.all([cl.from('notif_sections').select('id, parent_id, name, icon, sort').order('sort', { ascending: true }).limit(500),
        cl.from('notif_rules').select('id, section_id, element, active, roles').limit(1000)]);
      if (s.error || r.error) { tree = null; return; }
      const all = s.data || []; const rules = r.data || [];
      // the bell by role (Safwat 24 Nov — «تقسم التنبيهات على دور بالشكل الجديد والأقسام الفرعية تبقى جاهزة حتى لو فيها صفر»): a sub-section
      // carries the roles its working rules go to; treeSections shows a member the ones of his roles (primary + extra), the admin all
      const rolesOf = (id) => [...new Set(rules.filter((y) => y.section_id === id && y.active !== false).flatMap((y) => (Array.isArray(y.roles) ? y.roles : [])))];
      // the bell is the settings and nothing else (Safwat 25 Nov — «مش عايز اشوف في كل تاب … الا نفس العناصر و الاقسام الموجودة في
      // اعدادات التنبيهات»): an alert shows only under the sub-section of its rule, a working rule that is still there
      const subIds = new Set(all.filter((x) => x.parent_id).map((x) => x.id));
      ruleSec = new Map(rules.filter((y) => y.active !== false && subIds.has(y.section_id)).map((y) => [y.id, y.section_id]));
      tree = { mains: all.filter((x) => !x.parent_id).map((m) => ({ id: m.id, name: m.name, icon: m.icon || null,
        subs: all.filter((x) => x.parent_id === m.id).map((x) => ({ id: x.id, name: x.name, roles: rolesOf(x.id), elements: [...new Set(rules.filter((y) => y.section_id === x.id).map((y) => y.element))] })) })) };
    } catch (e) { tree = null; }
  }
  async function load() {
    const cl = c(); const id = uid();
    if (!cl || !id) return;
    try {
      const nowIso = new Date().toISOString();
      // 0161 (the bell's redesign): meta — the level and who the alert is about; before it the column is missing and the 0157 select runs
      let a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id, rule_id, section_id, hide_at, meta').or('hide_at.is.null,hide_at.gt.' + nowIso).order('at', { ascending: false }).limit(LIMIT);
      if (a.error) a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id, rule_id, section_id, hide_at').or('hide_at.is.null,hide_at.gt.' + nowIso).order('at', { ascending: false }).limit(LIMIT);
      if (a.error) { tree = null; a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id').order('at', { ascending: false }).limit(LIMIT); } else await loadTree(cl);
      if (a.error) return;
      const rows = a.data || []; const ids = rows.map((x) => x.id);
      const r = ids.length ? await cl.from('alert_reads').select('alert_id').eq('user_id', id).in('alert_id', ids) : { data: [] }; // no alerts: no marks to ask for
      if (r.error) return;
      const read = new Set((r.data || []).map((x) => x.alert_id));
      items = rows.map((x) => toAlert(x, read.has(x.id)));
      await loadPhones(cl);
      await loadNotes(cl, id);
      notify(); // the bell was drawn before the alerts arrived
    } catch (e) { /* offline: no server section */ }
  }
  // an order alert's customer (customer service — Safwat 25 Nov): his phone read from orders_v under the member's own rights — masked
  // there without sensitive.customer_phone, and then no copy / WhatsApp; never kept in the alerts. By the order's id (meta.gid).
  let phones = new Map();
  async function loadPhones(cl) {
    const ids = [...new Set((items || []).filter((a) => a.meta && a.meta.g === 'customer' && a.meta.ost != null && a.meta.gid).map((a) => String(a.meta.gid)))].slice(0, 200);
    if (!ids.length) { phones = new Map(); return; }
    try { const { data, error } = await cl.from('orders_v').select('id, customer_phone').in('id', ids);
      if (!error) phones = new Map((data || []).map((x) => [String(x.id), String(x.customer_phone || '')])); } catch (e) { /* no phones: the card without them */ }
  }
  const fullPhone = (p) => /^\d{8,15}$/.test(String(p || ''));
  const waOf = (p) => { let d = String(p || '').replace(/[^\d]/g, ''); if (/^0020/.test(d)) d = d.slice(2); if (/^01\d{9}$/.test(d)) return '2' + d; if (/^1\d{9}$/.test(d)) return '20' + d; return d; };
  // the card's lines for an order alert: the phone, the status, «محتاج متابعة», the sub-orders and the late makers
  function custOf(a) {
    const m = a.meta || {}; if (m.g !== 'customer' || m.ost == null) return null;
    const phone = phones.get(String(m.gid)) || '';
    return { name: m.gname || '', phone, dial: fullPhone(phone), wa: fullPhone(phone) ? 'https://wa.me/' + waOf(phone) : null, status: m.ost || '',
      follow: m.dl === 'late' || m.dl === 'risk', dl: m.dl || 'ok', subs: Number.isFinite(Number(m.subs)) ? Number(m.subs) : null,
      late: Array.isArray(m.lm) ? m.lm : [], risk: Array.isArray(m.rm) ? m.rm : [] };
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
  const clear = () => { items = null; notes = null; tree = null; ruleSec = new Map(); phones = new Map(); };
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
  // the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): every alert carries its level (critical
  // first, then important, then info — each by time) and who it is about (meta.g): a maker's logo, a member's first letter in a circle,
  // an assistant's icon, else its element's icon. The delay alerts of one maker in a tab are one card — the maker, «N متأخر · M قابل
  // للتأخير · P قطعة» — and its click opens his late orders (open({ vendorLate, kind }) — block 28's popup with «مشاركة»).
  const LV_RANK = { critical: 0, important: 1, normal: 2, info: 3 }; // the four levels (Safwat 24 Nov — «عادي» between «مهم» and «للمعرفة»)
  const LV_WORD = { critical: 'حرج', important: 'مهم', normal: 'عادي' };
  const EL_ICON = { daily: 'chart', custody: 'wallet', team: 'users', orders: 'package', subs: 'box', products: 'tag', inventory: 'stock', accounts: 'wallet',
    tickets: 'ticket', messages: 'msg', ai: 'sparkle', makers: 'users', system: 'gear' };
  const AGENT_ICON = { manager: 'sliders', buyer: 'chart', designer: 'image', dev: 'code', stock: 'truck', cs: 'headset', makers: 'users', accountant: 'wallet', hr: 'briefcase', content: 'image' };
  const elOf = (a) => { const m = /^rule:([a-z_]+)\./.exec(String(a.kind || '')); if (m) return m[1]; const C = window.IBNotifCatalog; return C && C.elementOfKind ? C.elementOfKind(a.kind) : null; };
  const lvOf = (a) => { const l = a.meta && a.meta.lv; return LV_RANK[l] != null ? l : toneOf(a.kind) === 'error' ? 'critical' : 'important'; };
  const firstLetter = (n) => { const t = String(n || '').replace(/^(ال)/, '').trim(); return (t.charAt(0) || '؟').toUpperCase(); };
  function avatarOf(a) {
    const m = a.meta || {};
    if (m.g === 'vendor') { const V = window.IBVendors; const v = V && V.store && V.store.get ? V.store.get(m.gid) : null;
      return v && v.logoUrl ? { img: v.logoUrl, letter: firstLetter(m.gname) } : { letter: firstLetter(m.gname), tone: 'vendor' }; }
    if (m.g === 'member') return { letter: firstLetter(m.gname), tone: 'member' };
    if (m.g === 'customer') return { letter: firstLetter(m.gname), tone: 'customer' };
    if (m.g === 'agent') { const M = window.IBMarketing; const r = M && M.agentOf ? M.agentOf(m.gid) : null; return { icon: (r && r.icon) || AGENT_ICON[m.gid] || 'sparkle', tone: 'agent' }; }
    return { icon: EL_ICON[elOf(a)] || 'bell', tone: lvOf(a) };
  }
  // readF (Safwat 24 Nov — «شيل خانة غير مقروء و مقروء … و حط مع زرار الاحدث و الاقدم معاه مقروء او غير مقروء»): 'unread' | 'read' | anything = all
  function treeSections(open, sort, readF) {
    if (!tree || !tree.mains.length || !items) return null;
    // only an alert of a working rule in the settings, under that rule's sub-section — one written with no rule (a database function's,
    // a rule deleted since) or of a rule switched off is not in the bell
    const placed = items.map((a) => ({ a, sub: a.ruleId ? ruleSec.get(a.ruleId) || null : null })).filter((p) => p.sub);
    const keep = (p) => (readF === 'unread' ? !p.a.read : readF === 'read' ? !!p.a.read : true); // the read filter beside the sort
    const time = (x) => Date.parse(x.at);
    const asItem = ({ a }) => { const tone = toneOf(a.kind); const lv = lvOf(a); return { key: 'sa:' + a.id, title: a.title, sub: a.body || '', meta: relTime(a.at, Date.now()), tone, icon: tone === 'error' ? 'alert' : 'bell', muted: a.read, fresh: !a.read,
      lv, lvWord: LV_WORD[lv] || '', av: avatarOf(a), at: a.at, cust: custOf(a),
      run: () => { markRead(a.id); if (typeof open === 'function' && open(a) !== false) return; if (a.entity && HASH.test(a.entity)) window.location.hash = a.entity; } }; };
    // one card per maker for his delay alerts (two or more — one stays a row with his logo)
    const atoms = (list) => {
      const by = new Map(); const out = [];
      for (const p of list) {
        const m = p.a.meta || {};
        if (m.g === 'vendor' && (m.st === 'late' || m.st === 'risk')) { const k = 'v:' + m.gid; if (!by.has(k)) { by.set(k, []); out.push({ k }); } by.get(k).push(p); }
        else out.push({ p });
      }
      return out.map((x) => {
        if (x.p) return asItem(x.p);
        const L = by.get(x.k); if (L.length === 1) return asItem(L[0]);
        const m = L[0].a.meta; const late = L.filter((p) => p.a.meta.st === 'late'); const risk = L.length - late.length;
        const pcs = L.reduce((s, p) => s + (Number(p.a.meta.pcs) || 0), 0); const unread = L.filter((p) => !p.a.read);
        const lv = late.length ? 'critical' : 'important'; const newest = L.reduce((b, p) => (time(p.a) > time(b.a) ? p : b), L[0]);
        const parts = [];
        if (late.length) parts.push(late.length + ' أوردر متأخر'); if (risk) parts.push(risk + ' قابل للتأخير'); if (pcs) parts.push(pcs + ' قطعة');
        return { key: 'sv:' + m.gid, title: m.gname || 'مبتكر', sub: parts.join(' · '), meta: relTime(newest.a.at, Date.now()), tone: late.length ? 'error' : 'warning', icon: 'package',
          muted: !unread.length, fresh: !!unread.length, lv, lvWord: LV_WORD[lv], av: avatarOf(L[0].a), at: newest.a.at, group: true, count: L.length,
          chips: [late.length ? [late.length + ' متأخر', 'error'] : null, risk ? [risk + ' قابل للتأخير', 'warning'] : null, pcs ? [pcs + ' قطعة', 'neutral'] : null].filter(Boolean),
          run: () => { markMany(L.map((p) => p.a.id)); if (typeof open === 'function') open({ vendorLate: m.gname, vendorId: m.gid, kind: late.length && risk ? 'all' : late.length ? 'late' : 'risk' }); } };
      });
    };
    // the unread first, always — a read one has no green dot and sits below them (Safwat 24 Nov); then critical, important, info; each by
    // time (newest or oldest first)
    const ord = (L) => L.slice().sort((x, y) => ((x.muted ? 1 : 0) - (y.muted ? 1 : 0)) || (LV_RANK[x.lv] - LV_RANK[y.lv]) || (sort === 'old' ? 1 : -1) * (Date.parse(x.at) - Date.parse(y.at)));
    // the member's sections: a sub-section whose rules go to one of his roles (or that holds an alert of his), every one for the admin;
    // a main section with none of them is out of his bell — the ones left are all there, even at zero
    const me = window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null;
    const myRoles = me ? [me.role_id].concat(Array.isArray(me.extra_roles) ? me.extra_roles : []).filter(Boolean) : null;
    const admin = !me || me.role_id === 'admin';
    const has = new Set(placed.map((p) => p.sub).filter(Boolean));
    const mineSub = (x) => admin || has.has(x.id) || (x.roles || []).some((r) => myRoles.includes(r));
    // every main section and sub-section of the settings, no more and no less (Safwat 25 Nov — «لا أزيد ولا أقل»): the admin all of them, even
    // an empty main; a member his roles' (0163)
    return tree.mains.map((m) => ({ m, subs: m.subs.filter(mineSub) })).filter((x) => admin || x.subs.length).map(({ m, subs }) => {
      const subIds = new Set(m.subs.map((x) => x.id));
      const mine = placed.filter((p) => subIds.has(p.sub));
      const shown = mine.filter(keep); const all = ord(atoms(shown)); const unreadAll = mine.filter((p) => !p.a.read);
      const tabs = [['all', 'الكل', all]].concat(subs.map((x) => ['s:' + x.id, x.name, ord(atoms(shown.filter((p) => p.sub === x.id)))]));
      const critical = unreadAll.filter((p) => lvOf(p.a) === 'critical').length;
      return { id: 'n:' + m.id, label: m.name, icon: m.icon || 'bell', unit: 'تنبيه', received: unreadAll.length, critical, all: () => markMany(mine.map((p) => p.a.id)), allLabel: 'تعليم القسم كمقروء',
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
  window.IBAlerts = { load, treeSections, avatarOf, lvOf, hasTree, markMany, openNote, list, unread, markRead, markAllRead, subscribe, unsubscribe, clear, section, toneOf, relTime, noteList, noteRead, noteOpen, agentSection, draftOf };
})();
