// Who is online (phase 12 T5, docs/superpowers/plans/2026-11-08-phase-12-followups.md decisions 5 and 12): one private Realtime
// Presence channel «presence» (0061) every active member joins with the sign-in (IBDirectory.load → join) and leaves with the
// sign-out (clear → leave). Each tab tracks { uid, at } — nothing else travels — and reads who else is there; online() is the
// set of member uids present, isOnline(uid) answers for one. The dashboard's «الفريق دلوقتي» (block 25) shows the dot and the
// inbox (IBCS.agents) uses it for «متاح» and the round-robin. Without a socket (IB_CONFIG.realtime === false — the mock) or
// before the channel is up, only the signed-in member counts online, and ready() says the channel is live. ib:presence on change.
(function () {
  'use strict';
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const myUid = () => { const s = window.IBAuth && window.IBAuth.session ? window.IBAuth.session() : null; return s && s.user ? s.user.id : null; };
  let channel = null; let live = false; let set = new Set();
  const emit = () => { if (typeof document !== 'undefined') quiet(() => document.dispatchEvent(new CustomEvent('ib:presence', { detail: { online: online() } }))); };
  const uidOk = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  function sync() {
    const st = channel && typeof channel.presenceState === 'function' ? quiet(() => channel.presenceState()) : null;
    // a key counts only when every payload tracked under it names the same uid (a tab tracking { uid } under another member's key
    // is dropped); the key itself is the client's choice, so the set is a hint for the dot and the inbox's suggestion — an
    // assignment is still the member's to change, and nothing here grants anything
    const obj = st && typeof st === 'object' ? st : {};
    const next = new Set(Object.keys(obj).filter((k) => uidOk(k) && Array.isArray(obj[k]) && obj[k].length > 0 && obj[k].every((p) => p && p.uid === k)));
    const me = myUid(); if (me) next.add(me);
    set = next; emit();
  }
  function join() {
    const cl = c(); const me = myUid(); const cfg = window.IB_CONFIG || {};
    if (!me) return;
    if (!cl || cfg.realtime === false) { set = new Set([me]); live = false; emit(); return; }
    if (channel) return;
    set = new Set([me]); emit();
    try {
      const ch = cl.channel('presence', { config: { private: true, presence: { key: me } } });
      channel = ch.on('presence', { event: 'sync' }, sync).subscribe((status) => {
        if (status === 'SUBSCRIBED') { live = true; quiet(() => Promise.resolve(ch.track({ uid: me, at: new Date().toISOString() })).catch(() => {})); sync(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { live = false; const dead = channel; channel = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); set = new Set([me]); emit(); }
      });
    } catch (e) { channel = null; live = false; }
  }
  function leave() {
    const cl = c(); const dead = channel; channel = null; live = false; set = new Set();
    if (dead) { quiet(() => Promise.resolve(dead.untrack && dead.untrack()).catch(() => {})); if (cl) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); }
    emit();
  }
  const online = () => [...set];
  const isOnline = (uid) => set.has(uid);
  window.IBPresence = { join, leave, online, isOnline, ready: () => live, count: () => set.size };
})();
