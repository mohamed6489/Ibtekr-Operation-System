// Member directory: profiles + roles (RLS decides which rows) → IBKit.store.members in the prototype's member shape.
// load() is where a session's data is loaded (gate and sign-in both call it): after the members, an active member's
// preferences, server alerts, recent activity, orders and vendors follow (each failure is ignored: none of them may fail the
// sign-in), then the Realtime alerts and orders subscriptions. clear() is where it is all forgotten again (IBAuth.signOut calls it).
// perm(key) is has_perm's rule on the loaded rows (0001): an active admin → 'F'; else my profile's custom_perms[key] when the key
// is there (even 'N'), else my role's permissions[key], else 'N'. The screens hide what it refuses; the server is the judge.
(function () {
  'use strict';
  let meRow = null; let rolesById = {};
  const toMember = (p, roleName, codeOf) => ({ id: p.member_code, uid: p.id, name: p.name, role: roleName[p.role_id] || '', title: p.title || '', dept: p.dept || '', manager: codeOf[p.manager_id] || '', phone: p.phone || '', email: p.email, status: p.status, twofa: !!p.twofa,
    salary: 0, holdback: 0, allow: 0, leave: 0, used: 0, shift: ['09:00', '17:00'] }); // HR numbers arrive with the HR phase
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  async function load() {
    const c = window.IBSupabase.client; const s = window.IBAuth.session();
    if (!c || !s) throw new Error('IBDirectory.load: not signed in');
    const [p, r] = await Promise.all([c.from('profiles').select('id, member_code, name, email, phone, role_id, title, dept, manager_id, status, twofa, custom_perms'), c.from('roles').select('id, name, permissions')]);
    if (p.error || r.error) throw p.error || r.error;
    const roleName = Object.fromEntries(r.data.map((x) => [x.id, x.name])); rolesById = Object.fromEntries(r.data.map((x) => [x.id, x]));
    const codeOf = Object.fromEntries(p.data.map((x) => [x.id, x.member_code]));
    meRow = p.data.find((x) => x.id === s.user.id) || null;
    const K = window.IBKit; const list = K.store.members; // same array: other blocks hold a reference to it
    list.length = 0; list.push(...p.data.map((x) => toMember(x, roleName, codeOf)));
    if (meRow) K.setMe(meRow.member_code);
    document.dispatchEvent(new Event('ib:directory'));
    // only for an active member (K.ME is theirs now); a suspended or missing profile is signed out by the caller
    if (!meRow || meRow.status !== 'active') return;
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders, V = window.IBVendors, Ac = window.IBAccounts;
    await Promise.allSettled([P && P.load(), A && A.load(), L && L.refresh && L.refresh(), Or && Or.load(), V && V.load()]);
    if (Ac) await Promise.allSettled([Ac.load()]); // phase 4: after the makers (the moves carry their names)
    if (A) quiet(() => A.subscribe());
    if (Or) quiet(() => Or.subscribe());
  }
  // sign-out: the members (same array, emptied), the signed-in row and every session store hanging off them
  function clear() {
    const K = window.IBKit; if (K && K.store && K.store.members) K.store.members.length = 0;
    meRow = null; rolesById = {};
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders, V = window.IBVendors, Ac = window.IBAccounts;
    if (P) quiet(() => P.clear());
    if (Ac) quiet(() => Ac.clear());
    if (window.IBProducts) quiet(() => window.IBProducts.clear()); // phase 5: loaded by the products page, forgotten here
    if (A) { quiet(() => A.unsubscribe()); quiet(() => A.clear()); }
    if (L && L.clear) quiet(() => L.clear());
    if (Or) quiet(() => Or.clear()); // unsubscribes too
    if (V) quiet(() => V.clear());
  }
  // has_perm(key) on the loaded rows → 'F' | 'P' | 'N' (see the header)
  function perm(key) {
    if (!meRow || meRow.status !== 'active') return 'N';
    if (meRow.twofa && window.IBAuth && window.IBAuth.needsTotp && window.IBAuth.needsTotp()) return 'N'; // 0008: an enrolled member below aal2 has nothing
    if (meRow.role_id === 'admin') return 'F';
    const cp = meRow.custom_perms && typeof meRow.custom_perms === 'object' ? meRow.custom_perms : {};
    if (Object.prototype.hasOwnProperty.call(cp, key)) return cp[key] || 'N';
    const r = rolesById[meRow.role_id]; const p = r && r.permissions && typeof r.permissions === 'object' ? r.permissions[key] : null;
    return p || 'N';
  }
  window.IBDirectory = { load, clear, perm, me: () => meRow, members: () => window.IBKit.store.members };
})();
