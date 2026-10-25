// Member directory: profiles + roles (RLS decides which rows) → IBKit.store.members in the prototype's member shape.
// load() is where a session's data is loaded (gate and sign-in both call it): after the members, an active member's
// preferences, server alerts, recent activity and orders follow (each failure is ignored: none of them may fail the
// sign-in), then the Realtime alerts and orders subscriptions. clear() is where it is all forgotten again (IBAuth.signOut calls it).
(function () {
  'use strict';
  let meRow = null;
  const toMember = (p, roleName, codeOf) => ({ id: p.member_code, name: p.name, role: roleName[p.role_id] || '', title: p.title || '', dept: p.dept || '', manager: codeOf[p.manager_id] || '', phone: p.phone || '', email: p.email, status: p.status, twofa: !!p.twofa,
    salary: 0, holdback: 0, allow: 0, leave: 0, used: 0, shift: ['09:00', '17:00'] }); // HR numbers arrive with the HR phase
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  async function load() {
    const c = window.IBSupabase.client; const s = window.IBAuth.session();
    if (!c || !s) throw new Error('IBDirectory.load: not signed in');
    const [p, r] = await Promise.all([c.from('profiles').select('id, member_code, name, email, phone, role_id, title, dept, manager_id, status, twofa'), c.from('roles').select('id, name')]);
    if (p.error || r.error) throw p.error || r.error;
    const roleName = Object.fromEntries(r.data.map((x) => [x.id, x.name]));
    const codeOf = Object.fromEntries(p.data.map((x) => [x.id, x.member_code]));
    meRow = p.data.find((x) => x.id === s.user.id) || null;
    const K = window.IBKit; const list = K.store.members; // same array: other blocks hold a reference to it
    list.length = 0; list.push(...p.data.map((x) => toMember(x, roleName, codeOf)));
    if (meRow) K.setMe(meRow.member_code);
    document.dispatchEvent(new Event('ib:directory'));
    // only for an active member (K.ME is theirs now); a suspended or missing profile is signed out by the caller
    if (!meRow || meRow.status !== 'active') return;
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders;
    await Promise.allSettled([P && P.load(), A && A.load(), L && L.refresh && L.refresh(), Or && Or.load()]);
    if (A) quiet(() => A.subscribe());
    if (Or) quiet(() => Or.subscribe());
  }
  // sign-out: the members (same array, emptied), the signed-in row and every session store hanging off them
  function clear() {
    const K = window.IBKit; if (K && K.store && K.store.members) K.store.members.length = 0;
    meRow = null;
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders;
    if (P) quiet(() => P.clear());
    if (A) { quiet(() => A.unsubscribe()); quiet(() => A.clear()); }
    if (L && L.clear) quiet(() => L.clear());
    if (Or) quiet(() => Or.clear()); // unsubscribes too
  }
  window.IBDirectory = { load, clear, me: () => meRow, members: () => window.IBKit.store.members };
})();
