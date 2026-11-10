// Member directory: profiles + roles (RLS decides which rows) → IBKit.store.members in the prototype's member shape.
// load() is where a session's data is loaded (gate and sign-in both call it; refresh() = the members alone): after the members, an active member's
// preferences, server alerts, recent activity, orders and vendors follow (each failure is ignored: none of them may fail the
// sign-in), then the Realtime alerts and orders subscriptions. clear() is where it is all forgotten again (IBAuth.signOut calls it).
// perm(key) is has_perm's rule on the loaded rows (0001): an active admin → 'F'; else my profile's custom_perms[key] when the key
// is there (even 'N'), else my role's permissions[key], else 'N'. The screens hide what it refuses; the server is the judge.
(function () {
  'use strict';
  let meRow = null; let rolesById = {};
  const toMember = (p, roleName, codeOf) => ({ id: p.member_code, uid: p.id, name: p.name, role: roleName[p.role_id] || '', title: p.title || '', dept: p.dept || '', manager: codeOf[p.manager_id] || '', customPerms: p.custom_perms && typeof p.custom_perms === 'object' ? p.custom_perms : {}, override: p.custom_perms && typeof p.custom_perms === 'object' && Object.keys(p.custom_perms).length ? Object.keys(p.custom_perms).length : null, phone: p.phone || '', email: p.email, status: p.status, twofa: !!p.twofa,
    salary: 0, holdback: 0, allow: 0, leave: 0, used: 0, shift: ['09:00', '17:00'] }); // the HR numbers: IBHR.member(code) (phase 10)
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  // the members only (the first half of load(); «إضافة عضو» calls it): same array, same objects where the member is still there
  async function refresh() {
    const c = window.IBSupabase.client; const s = window.IBAuth.session();
    if (!c || !s) throw new Error('IBDirectory.load: not signed in');
    const [p, r] = await Promise.all([c.from('profiles').select('id, member_code, name, email, phone, role_id, title, dept, manager_id, status, twofa, custom_perms'), c.from('roles').select('id, name, permissions')]);
    if (p.error || r.error) throw p.error || r.error;
    const roleName = Object.fromEntries(r.data.map((x) => [x.id, x.name])); rolesById = Object.fromEntries(r.data.map((x) => [x.id, x]));
    const codeOf = Object.fromEntries(p.data.map((x) => [x.id, x.member_code]));
    meRow = p.data.find((x) => x.id === s.user.id) || null;
    const K = window.IBKit; const list = K.store.members; // same array: other blocks hold a reference to it
    const old = new Map(list.map((m) => [m.uid, m]));
    const next = p.data.map((x) => { const m = toMember(x, roleName, codeOf); const o = old.get(x.id); return o ? Object.assign(o, m) : m; });
    list.length = 0; list.push(...next);
    if (meRow) K.setMe(meRow.member_code);
    document.dispatchEvent(new Event('ib:directory'));
  }
  async function load() {
    await refresh();
    // only for an active member (K.ME is theirs now); a suspended or missing profile is signed out by the caller
    if (!meRow || meRow.status !== 'active') return;
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders, V = window.IBVendors, Ac = window.IBAccounts, CS = window.IBCS;
    const St = window.IBSettings; // phase 11: the public settings every member needs (brand, quick actions, the bell's matrix, the security policy)
    await Promise.allSettled([P && P.load(), A && A.load(), L && L.refresh && L.refresh(), Or && Or.load(), V && V.load(), St && St.loadPublic && St.loadPublic()]);
    const Inv = window.IBInventory, Tk = window.IBTickets, HR = window.IBHR;
    if (Ac || CS || Inv || Tk || HR) await Promise.allSettled([Ac && Ac.load(), CS && CS.load(), Inv && Inv.load(), Tk && Tk.load(), HR && HR.load()]); // phase 4 / 6 / 7 / 8 / 10: after the makers (the moves, the makers' chats and the lots carry their names)
    if (A) quiet(() => A.subscribe());
    if (Or) quiet(() => Or.subscribe());
    if (CS) quiet(() => CS.subscribe());
    if (window.IBPresence) quiet(() => window.IBPresence.join()); // phase 12 T5: who is online (0061)
  }
  // sign-out: the members (same array, emptied), the signed-in row and every session store hanging off them
  function clear() {
    const K = window.IBKit; if (K && K.store && K.store.members) K.store.members.length = 0;
    meRow = null; rolesById = {};
    if (window.IBPresence) quiet(() => window.IBPresence.leave()); // phase 12 T5
    const P = window.IBPrefs, A = window.IBAlerts, L = window.IBActivity, Or = window.IBOrders, V = window.IBVendors, Ac = window.IBAccounts;
    if (P) quiet(() => P.clear());
    if (Ac) quiet(() => Ac.clear());
    if (window.IBProducts) quiet(() => window.IBProducts.clear()); // phase 5: loaded by the products page, forgotten here
    if (window.IBCS) quiet(() => window.IBCS.clear()); // phase 6 (unsubscribes too)
    if (window.IBInventory) quiet(() => window.IBInventory.clear()); // phase 7
    if (window.IBTickets) quiet(() => window.IBTickets.clear()); // phase 8 (unsubscribes too)
    if (window.IBHR) quiet(() => window.IBHR.clear()); // phase 10 (unsubscribes too)
    if (window.IBMarketing) quiet(() => window.IBMarketing.clear()); // phase 9.5 (loaded by the marketing page; unsubscribes too)
    if (window.IBSettings) quiet(() => window.IBSettings.clear()); // phase 11 (loaded by the settings page; the public part with the sign-in)
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
  // «ملفي › تعديل بياناتي» (phase 10, the owner 5 Nov): my own mobile — a member may change name / phone on their own row (RLS +
  // profiles_guard_update, 0001); an Egyptian mobile in any digits; taken by another member → 'taken' (profiles.phone is unique and the
  // sign-in by phone reads it). The number is never logged.
  async function updatePhone(phone) {
    const c = window.IBSupabase.client; if (!c || !meRow) return { ok: false, reason: 'network' };
    const O = window.IbtekrOps; const d = (O && O.toLatin ? O.toLatin(String(phone || '')) : String(phone || '')).replace(/[\s-]/g, '');
    if (!/^01[0125][0-9]{8}$/.test(d)) return { ok: false, reason: 'invalid' };
    if (d === meRow.phone) return { ok: true, same: true };
    let r; try { r = await c.from('profiles').update({ phone: d }).eq('id', meRow.id).select('id'); } catch (e) { return { ok: false, reason: 'network' }; }
    if (r.error) return { ok: false, reason: r.error.code === '23505' ? 'taken' : r.error.code === '42501' ? 'forbidden' : 'server' };
    if (!r.data || !r.data.length) return { ok: false, reason: 'forbidden' };
    try { await refresh(); } catch (e) { /* the number is saved; the copy catches up on the next load */ }
    return { ok: true };
  }
  // phase 13 decision 22: the member's own name (profiles_guard_update lets a member write name / phone on their own row) — 2..80
  // characters, spaces collapsed; the directory reloads so the header and the menus show it.
  async function updateName(name) {
    const c = window.IBSupabase.client; if (!c || !meRow) return { ok: false, reason: 'network' };
    const n = String(name == null ? '' : name).replace(/[<>]/g, '').trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 80) return { ok: false, reason: 'invalid' };
    if (n === meRow.name) return { ok: true, same: true };
    let r; try { r = await c.from('profiles').update({ name: n }).eq('id', meRow.id).select('id'); } catch (e) { return { ok: false, reason: 'network' }; }
    if (r.error) return { ok: false, reason: r.error.code === '42501' ? 'forbidden' : 'server' };
    if (!r.data || !r.data.length) return { ok: false, reason: 'forbidden' };
    try { await refresh(); } catch (e) { /* saved; the copy catches up on the next load */ }
    return { ok: true };
  }
  window.IBDirectory = { load, refresh, clear, perm, updatePhone, updateName, me: () => meRow, members: () => window.IBKit.store.members, roles: () => Object.values(rolesById) }; // roles(): the role rows the member may read (phase 6.5: the rule editor's «عيّن لدور»)
})();
