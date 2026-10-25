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
  const toAlert = (r, read) => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, entity: r.entity, entityId: r.entity_id, read: !!read });
  const list = () => (items ? items.slice() : []);
  const unread = () => (items ? items.filter((a) => !a.read).length : 0);
  async function load() {
    const cl = c(); const id = uid();
    if (!cl || !id) return;
    try {
      const a = await cl.from('alerts').select('id, at, kind, title, body, entity, entity_id').order('at', { ascending: false }).limit(LIMIT);
      if (a.error) return;
      const rows = a.data || []; const ids = rows.map((x) => x.id);
      const r = ids.length ? await cl.from('alert_reads').select('alert_id').eq('user_id', id).in('alert_id', ids) : { data: [] }; // no alerts: no marks to ask for
      if (r.error) return;
      const read = new Set((r.data || []).map((x) => x.alert_id));
      items = rows.map((x) => toAlert(x, read.has(x.id)));
      notify(); // the bell was drawn before the alerts arrived
    } catch (e) { /* offline: no server section */ }
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
  const clear = () => { items = null; };
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
  window.IBAlerts = { load, list, unread, markRead, markAllRead, subscribe, unsubscribe, clear, section, toneOf, relTime };
})();
