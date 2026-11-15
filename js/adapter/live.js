// Live sync for every account (the owner 15 Nov — docs/superpowers/plans/2026-11-15-live-sync.md decision 2: «الويبسايت يبقي synced عند
// كل الاكونتات … لازم اعمل reload عشان اشوفها»). The database broadcasts «changed» on the private channel «sync» after any write to the
// orders, the accounts, the makers, the inventory, the products, the studio, the settings, the team or the alerts (0104): the group's
// name — and for orders the changed order ids — never a row. Here: one subscription, and each group is read again by its own adapter,
// quietly (no «loading» flash; a failed read keeps what is shown).
//
// - Signals are gathered: one read 0.6 s after the last signal, and at least one every 4 s while they keep coming.
// - What is on the screen is what is in memory: while a popup, a menu or a drawer is open, while the member types in a field, or while
//   the tab is hidden, the read waits — so a save compares what the member was looking at with what is in the database (decision 3).
//   A page with unsaved changes on it (the settings' save bar) holds the settings alone.
// - After the line was down (or the tab was away for 2 minutes) every group is read once: nothing missed stays missed.
// Customer service, the team requests, HR and marketing keep their own channels. Without a socket (IB_CONFIG.realtime === false — the
// tests' stand-in) nothing is subscribed; signal() plays one by hand.
(function () {
  'use strict';
  const QUIET_MS = 600; const MAX_MS = 4000; const RETRY_MS = 700; const AWAY_MS = 120000; const WATCH_MS = 20000; const MANY = 8;
  const DOWN = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'];
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const uid = () => { const s = window.IBAuth && window.IBAuth.session && quiet(() => window.IBAuth.session()); return (s && s.user && s.user.id) || null; };
  const ready = (A) => !!(A && A.state && A.state() === 'ready');
  const doc = () => (typeof document === 'undefined' ? null : document);

  // ---------- what each group reads again ----------
  const soft = { quiet: true };
  const readers = {
    // a few orders: each one alone (the page redraws its card); a burst (a sync) or no list: the whole list, quietly
    orders: (ids) => {
      const O = window.IBOrders; if (!ready(O)) return null;
      const A = window.IBAccounts; if (A && A.refreshSales) quiet(() => A.refreshSales()); // the period's sales follow the orders
      return ids && ids.length && ids.length <= MANY && O.refetch ? Promise.all(ids.map((id) => O.refetch(String(id)))) : O.load(soft);
    },
    accounts: () => { const A = window.IBAccounts; return ready(A) ? A.load(soft) : null; },
    vendors: () => { const V = window.IBVendors; return ready(V) ? V.load(soft) : null; },
    inventory: () => { const I = window.IBInventory; return ready(I) ? I.load(soft) : null; },
    products: () => { const P = window.IBProducts; return ready(P) ? P.load(soft) : null; },
    studio: () => { const S = window.IBStudio; return ready(S) ? S.load(soft) : null; },
    settings: () => {
      const S = window.IBSettings; if (!S) return null; const Q = window.IBQuick;
      return Promise.all([S.loadPublic && S.loadPublic(), S.data && S.data.loaded && S.load ? S.load() : null, Q && Q.refresh ? quiet(() => Q.refresh()) : null]);
    },
    team: () => { const D = window.IBDirectory; return D && D.me && D.me() && D.refresh ? D.refresh() : null; },
    alerts: () => { const A = window.IBAlerts; return A && A.load ? A.load() : null; },
  };
  const extra = new Map(); // group → [fn] (a page's own reader — on())
  function on(group, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!extra.has(group)) extra.set(group, []);
    extra.get(group).push(fn);
    return () => { const l = extra.get(group) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  }
  const known = (group) => Object.prototype.hasOwnProperty.call(readers, group) || extra.has(group);

  // ---------- when a read waits ----------
  const OPEN = '.scrim, .menu, [role="menu"], [role="dialog"]:not(.ai-panel)'; // a popup / a drawer, a menu, a dialog (the assistant's panel may stay open all day)
  const UNSAVED = '.save-bar, [data-set-dirty]:not([hidden]), [data-unsaved]';
  const SHADOW = '#orders, [data-live-root]'; // pages drawn inside a shadow root (the orders page): their popups and fields are looked at too
  const seen = (el) => !el.hidden && (!el.getClientRects || el.getClientRects().length > 0);
  const roots = () => { const d = doc(); if (!d || !d.querySelectorAll) return []; const out = [d]; Array.prototype.forEach.call(d.querySelectorAll(SHADOW), (h) => { if (h.shadowRoot && h.shadowRoot.querySelectorAll) out.push(h.shadowRoot); }); return out; };
  const any = (sel) => roots().some((r) => Array.prototype.some.call(r.querySelectorAll(sel), seen));
  const active = () => { const d = doc(); let a = d && d.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a || null; };
  const isSearch = (a) => a.type === 'search' || a.id === 'gq' || (a.getAttribute && (a.getAttribute('role') === 'searchbox' || a.hasAttribute('data-fm-q'))) || !!(a.closest && a.closest('[data-tq-row]')) || /بحث|ابحث|دوّر/.test(a.placeholder || '');
  let lastKey = 0; let lastFocus = 0; const SELECT_MS = 8000;
  function typing() {
    const d = doc(); const a = active(); if (!a || a === d.body) return false;
    // a dropdown just opened: the list under the member's hand is not redrawn while they choose (it keeps the focus afterwards, so
    // only for a few seconds)
    if (a.tagName === 'SELECT') return Date.now() - lastFocus < SELECT_MS;
    const field = a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color|image)$/i.test(a.type || 'text'));
    if (!field) return false;
    return isSearch(a) ? Date.now() - lastKey < 1500 : true; // a search box holds only while its keys are being pressed
  }
  const hidden = () => { const d = doc(); return !!d && d.visibilityState === 'hidden'; };
  const held = () => hidden() || any(OPEN) || typing();
  const holds = { settings: [() => any(UNSAVED)] };
  function holdWhile(group, fn) { if (typeof fn !== 'function') return; if (!holds[group]) holds[group] = []; holds[group].push(fn); }
  const groupHeld = (group) => (holds[group] || []).some((fn) => !!quiet(fn));

  // ---------- gather, wait, read ----------
  const pending = new Map(); // group → null (all of it) | Set of ids
  let timer = null; let since = 0; let running = false;
  function mark(group, ids) {
    if (!known(group)) return;
    const had = pending.get(group);
    if (ids && ids.length && !(pending.has(group) && had === null)) { const s = had || new Set(); ids.forEach((x) => s.add(String(x))); pending.set(group, s); }
    else pending.set(group, null);
    plan();
  }
  function plan(wait) {
    if (!pending.size) { since = 0; return; }
    const now = Date.now(); if (!since) since = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, wait != null ? wait : Math.max(0, Math.min(QUIET_MS, since + MAX_MS - now)));
  }
  const emit = (group, ids) => { const d = doc(); if (d && typeof CustomEvent === 'function') quiet(() => d.dispatchEvent(new CustomEvent('ib:live', { detail: { group, ids: ids || null } }))); };
  async function read(group, ids) {
    const list = (Object.prototype.hasOwnProperty.call(readers, group) ? [readers[group]] : []).concat(extra.get(group) || []);
    for (const fn of list) { try { await fn(ids); } catch (e) { /* the next signal or load brings it */ } }
    emit(group, ids);
  }
  async function flush() {
    timer = null;
    if (!pending.size) { since = 0; return; }
    if (hidden()) return;                                   // read when the tab is looked at again (onVisible)
    if (running || held()) { plan(RETRY_MS); return; }
    const batch = []; pending.forEach((ids, group) => { if (!groupHeld(group)) batch.push([group, ids ? Array.from(ids) : null]); });
    batch.forEach(([group]) => pending.delete(group));
    since = 0; running = true;
    try { await Promise.all(batch.map(([group, ids]) => read(group, ids))); } finally { running = false; }
    if (pending.size) plan(batch.length ? undefined : RETRY_MS); // new signals, or a group still held
  }
  const all = () => { Object.keys(readers).concat(Array.from(extra.keys())).forEach((g) => { pending.set(g, null); }); plan(); };

  // ---------- the line ----------
  let channel = null; let down = false; let watch = null; let wired = false; let hiddenAt = 0; let fails = 0; let nextTry = 0;
  function onSignal(msg) {
    const p = (msg && msg.payload) || msg || {}; const t = typeof p.t === 'string' ? p.t : ''; if (!t) return;
    mark(t, Array.isArray(p.ids) ? p.ids.filter((x) => x != null) : null);
  }
  function drop() { const dead = channel; channel = null; const cl = c(); if (dead && cl) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); }
  function connect() {
    const cl = c(); const cfg = window.IB_CONFIG || {};
    if (channel || !cl || !uid() || cfg.realtime === false) return;
    try {
      const mine = cl.channel('sync', { config: { private: true } }).on('broadcast', { event: 'changed' }, onSignal); // 0104: active members receive, nobody sends
      channel = mine;
      mine.subscribe((status) => {
        if (channel !== mine) return;
        if (status === 'SUBSCRIBED') { fails = 0; if (down) { down = false; all(); } } // back after a cut: whatever was missed
        // the watch opens a new one: the first cut at its next look, then each failed try waits twice as long, up to 5 minutes (a
        // project without 0104 refuses the join)
        else if (DOWN.includes(status)) { down = true; drop(); fails = Math.min(fails + 1, 6); nextTry = Date.now() + (fails > 1 ? Math.min(WATCH_MS * Math.pow(2, fails - 2), 300000) : 0); }
      });
    } catch (e) { channel = null; }
  }
  function onVisible() {
    const d = doc(); if (!d) return;
    if (d.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
    if (away > AWAY_MS && uid()) all(); else plan(0);
  }
  function wire() {
    if (wired) return; wired = true; const d = doc();
    if (d && d.addEventListener) {
      d.addEventListener('visibilitychange', onVisible);
      d.addEventListener('keydown', () => { lastKey = Date.now(); }, true);
      d.addEventListener('focusin', () => { lastFocus = Date.now(); }, true);
      d.addEventListener('focusout', () => { if (pending.size) plan(120); }, true); // the field was left: do not wait for the retry
    }
    if (typeof window.addEventListener === 'function') window.addEventListener('online', () => { if (uid()) { down = true; drop(); fails = 0; nextTry = 0; connect(); all(); } });
  }
  function subscribe() {
    wire(); connect();
    const cfg = window.IB_CONFIG || {};
    if (!watch && cfg.realtime !== false && typeof setInterval === 'function') watch = setInterval(() => { if (!channel && uid() && Date.now() >= nextTry) connect(); }, WATCH_MS);
  }
  function unsubscribe() { drop(); down = false; fails = 0; nextTry = 0; if (watch) { clearInterval(watch); watch = null; } }
  function clear() { unsubscribe(); pending.clear(); since = 0; if (timer) { clearTimeout(timer); timer = null; } }

  window.IBLive = { subscribe, unsubscribe, clear, on, holdWhile, signal: onSignal, refresh: all, held, connected: () => !!channel && !down,
    _test: { pending: () => new Map(pending), flush, typing, groupHeld, QUIET_MS, MAX_MS } };
})();
