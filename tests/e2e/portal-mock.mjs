// Phase 13 T4 (0065): the Edge Function `portal` emulated for supabase-mock.mjs (not a test file itself). portalRoute(c) answers
// POST /functions/v1/portal (or returns null) the way the real function does on the mock's own rows: the sign-in against
// mock.vendorLogins + mock.vault (5 wrong tries lock the login 15 minutes, a login without a secret → nopw, a disabled one →
// disabled), the first sign-in's forced password (a «first» token opens set_password only), the maker's own view filtered by his
// vendor id (orders / sub_orders / order_items of the orders seed, the Dokan balance and moves of mock.acc, his brands, his bank
// masked), the bank request as a ticket for «الحسابات» opened by «بوابة المبتكر» (one open at a time), the reset request and the
// reset by token. Tokens are plain «pt.<scope>.<vendor id>» strings the page keeps in sessionStorage — the real ones are signed JWTs.
// Every call lands in mock.portal.calls ({ action, user?, vendor?, result }); the mails Resend would send in mock.portal.mails
// (to + the link, never a password). mock.portal.resend says whether the server has a Resend key (default true).
import { makerLedger, makerLines, maskedBank, passwordIssues } from '../../supabase/functions/_shared/portal.js';

export function portalState() {
  return { calls: [], mails: [], resets: [], resend: true, nextTicket: 9000 };
}

export function portalRoute(c) {
  const { method, path, hd, json, mock } = c; const P = mock.portal; if (!P) return null;
  if (!(method === 'POST' && path === '/functions/v1/portal')) return null;
  const b = c.body() || {}; const action = String(b.action || ''); const now = new Date().toISOString();
  const rec = { action, result: 'ok' }; P.calls.push(rec);
  const fail = (status, error, extra) => { rec.result = error; return json(status, Object.assign({ error }, extra || {})); };
  const findLogin = (user) => { const u = String(user || '').trim().toLowerCase(); return u ? mock.vendorLogins.find((l) => l.username.toLowerCase() === u || String(l.email || '').toLowerCase() === u) || null : null; };
  const vendorOf = (id) => mock.vendors.find((v) => v.id === id) || null;
  const tokenOf = (scope, vendor) => 'pt.' + scope + '.' + vendor;
  const who = () => { const m = /^pt\.(first|full)\.([0-9a-f-]{36})$/.exec(String(hd['x-portal-token'] || '')); const v = m && vendorOf(m[2]); const l = m && mock.vendorLogins.find((x) => x.vendor_id === m[2]); return v && l && v.status !== 'inactive' && l.status !== 'disabled' ? { scope: m[1], vendor: m[2] } : null; };
  const check = (login, password) => {
    if (!login) return { ok: false, reason: 'wrong' };
    const v = vendorOf(login.vendor_id);
    if (login.status === 'disabled' || (v && v.status === 'inactive')) return { ok: false, reason: 'disabled' };
    if (login.locked_until && login.locked_until > now) return { ok: false, reason: 'locked', until: login.locked_until };
    if (!login.secret_id) return { ok: false, reason: 'nopw' };
    if (mock.vault.get(login.secret_id) !== password) {
      login.fails = (login.fails || 0) + 1;
      if (login.fails >= 5) { login.fails = 0; login.locked_until = new Date(Date.now() + 15 * 60000).toISOString(); return { ok: false, reason: 'locked', until: login.locked_until }; }
      return { ok: false, reason: 'wrong', left: 5 - login.fails };
    }
    login.fails = 0; login.locked_until = null; login.last_login_at = now;
    return { ok: true };
  };
  const setOwn = (login, password) => { if (!login.secret_id) { login.secret_id = 'c0000000-0000-4000-8000-00000000p' + String(mock.vault.size + 1).padStart(3, '0'); } mock.vault.set(login.secret_id, password); Object.assign(login, { password_set_at: now, must_change: false, own_password: true, status: 'active', fails: 0, locked_until: null, updated_at: now }); };

  if (action === 'login') {
    const user = String(b.user || '').trim().toLowerCase(); rec.user = user;
    if (!user || typeof b.password !== 'string' || !b.password) return fail(400, 'bad_request');
    const login = findLogin(user); const r = check(login, b.password);
    if (!r.ok) return fail(401, r.reason === 'locked' ? 'locked' : 'wrong', r.reason === 'locked' ? { until: r.until } : {}); // like the server: unknown / disabled / no-password all read «wrong»; the lock is named
    rec.vendor = login.vendor_id; const v = vendorOf(login.vendor_id);
    return json(200, { ok: true, token: tokenOf(login.must_change ? 'first' : 'full', login.vendor_id), must_change: !!login.must_change, name: v ? v.name : '' });
  }
  if (action === 'reset_request') {
    const user = String(b.user || '').trim().toLowerCase(); rec.user = user; if (!user) return fail(400, 'bad_request');
    const login = findLogin(user); const mode = P.resend ? 'email' : 'team';
    if (login && login.status !== 'disabled') {
      const token = (P.resets.length + 1).toString(16).padStart(64, 'a'); P.resets.forEach((r) => { if (r.vendor === login.vendor_id) r.used = true; }); P.resets.push({ vendor: login.vendor_id, token, used: false, at: now });
      if (mode === 'email') P.mails.push({ to: login.email, link: 'http://localhost:4173/portal.html#portal-reset/' + token });
    }
    return json(200, { ok: true, mode });
  }
  if (action === 'reset') {
    if (!/^[0-9a-f]{64}$/.test(String(b.token || ''))) return fail(404, 'reset_invalid');
    const iss = passwordIssues(b.password); if (iss.length) return fail(400, 'weak_password', { issues: iss });
    const r = P.resets.find((x) => x.token === b.token && !x.used); if (!r) return fail(404, 'reset_invalid');
    r.used = true; const login = mock.vendorLogins.find((l) => l.vendor_id === r.vendor); setOwn(login, b.password); rec.vendor = r.vendor;
    const v = vendorOf(r.vendor); return json(200, { ok: true, token: tokenOf('full', r.vendor), name: v ? v.name : '' });
  }
  const me = who(); if (!me) return fail(401, 'unauthorized');
  rec.vendor = me.vendor; const login = mock.vendorLogins.find((l) => l.vendor_id === me.vendor); const v = vendorOf(me.vendor);
  if (action === 'set_password') {
    if (me.scope !== 'first') return fail(401, 'use_change_password');
    const iss = passwordIssues(b.password); if (iss.length) return fail(400, 'weak_password', { issues: iss });
    if (!login) return fail(404, 'not_found'); setOwn(login, b.password);
    return json(200, { ok: true, token: tokenOf('full', me.vendor) });
  }
  if (me.scope !== 'full') return fail(401, 'must_change');
  if (action === 'change_password') {
    const r = check(login, String(b.current || '')); if (!r.ok) return fail(401, r.reason);
    const iss = passwordIssues(b.password); if (iss.length) return fail(400, 'weak_password', { issues: iss });
    setOwn(login, b.password); return json(200, { ok: true, token: tokenOf('full', me.vendor) });
  }
  if (action === 'me') {
    const bank = (mock.vendorBank || []).find((x) => x.vendor_id === me.vendor) || null;
    const owned = new Set((mock.brandOwners || []).filter((o) => o.vendor_id === me.vendor).map((o) => o.brand_id));
    const brands = (mock.brands || []).filter((x) => x.store_vendor_id === me.vendor || owned.has(x.id)).map((x) => ({ name: x.name }));
    return json(200, { result: 'ok', v: { id: v.id, name: v.name, phone: v.phone || null, email: (login && login.email) || v.email || null, status: v.status }, login: login ? { username: login.username, ownPassword: !!login.own_password, mustChange: !!login.must_change, lastLoginAt: login.last_login_at || null } : null, brands, bank: maskedBank(bank) });
  }
  if (action === 'orders') {
    const subs = mock.subOrders.filter((s) => s.vendor_id === me.vendor); const items = mock.orderItems.filter((i) => i.vendor_id === me.vendor);
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const ids = new Set([...subs, ...items].map((r) => r.order_id)); const orders = mock.orders.filter((o) => ids.has(o.id) && !o.deleted_at && o.placed_at >= since);
    const lead = (mock.productLeads || []).reduce((m, x) => m.set(String(x.product_id), Number(x.days)), new Map()); // decision 52
    return json(200, { result: 'ok', rows: makerLines({ items, orders, subs, now, leads: lead, makerLead: v.lead_days }), since: since.slice(0, 10) });
  }
  if (action === 'account') {
    const bal = (mock.acc.dokan_balances || []).find((x) => x.vendor_id === me.vendor) || null; const moves = (mock.acc.acc_vendor_moves || []).filter((m) => m.vendor_id === me.vendor && !m.voided_at);
    const wds = (mock.acc.dokan_withdrawals || []).filter((w) => w.vendor_id === me.vendor).sort((a, z) => (a.requested_at < z.requested_at ? 1 : -1)).slice(0, 3);
    // 0078: the latest settlement's carry; an approved request shows what it transferred (cash)
    const sets = (mock.acc.acc_vendor_settlements || []).filter((x) => x.vendor_id === me.vendor).sort((a, z) => z.id - a.id); const cashOf = new Map(sets.map((x) => [Number(x.withdraw_id), Number(x.cash)]));
    return json(200, { result: 'ok', ledger: makerLedger({ balance: bal ? bal.balance : null, moves, carry: sets.length ? sets[0].carry_out : 0 }), synced_at: bal ? bal.synced_at : null, dokan: !!bal,
      withdrawals: wds.map((w) => ({ id: w.id, amount: Number(w.amount) || 0, status: w.status, method: w.method || null, at: w.requested_at || null, cash: cashOf.has(Number(w.id)) ? cashOf.get(Number(w.id)) : null })) });
  }
  if (action === 'bank_request') {
    const live = mock.tickets.find((t) => t.vendor_id === me.vendor && t.created_by_role === 'بوابة المبتكر' && ['open', 'in_progress', 'waiting'].includes(t.status));
    if (live) return json(200, { ok: true, id: live.id, existing: true });
    const id = Math.max(P.nextTicket, mock.tickets.reduce((m, t) => Math.max(m, t.id), 0) + 1); P.nextTicket = id + 1;
    const description = 'المبتكر «' + v.name + '» طلب من بوابة المبتكر تعديل / تسجيل حسابه البنكي. الحسابات تتواصل معاه وتتأكد من البيانات قبل أي تغيير.';
    mock.tickets.push({ id, type: 'vendor', title: 'طلب تعديل الحساب البنكي — ' + v.name, description, priority: 'normal', assignee_role: 'الحسابات', order_number: null, order_id: null, customer: null, cs_customer_id: null, cs_conversation_id: null, vendor_id: me.vendor, vendor: v.name, reason: null, follow_up: null, attachments: [], status: 'open',
      created_by: null, created_by_name: 'بوابة المبتكر', created_by_role: 'بوابة المبتكر', created_at: now, last_update: now, reopen_count: 0, resolution_outcome: null, resolution_note: null, resolved_by: null, resolved_by_name: null, resolved_at: null, closed_by: null, closed_by_name: null, closed_at: null });
    mock.ticketEvents.push({ id: mock.ticketEvents.reduce((m, e) => Math.max(m, e.id), 0) + 1, ticket_id: id, kind: 'event', at: now, actor: null, actor_name: 'بوابة المبتكر', actor_role: 'بوابة المبتكر', text: 'بوابة المبتكر فتحت التذكرة وعيّنتها لدور «الحسابات»', old_value: null, new_value: null, attachments: [] });
    mock.activityRows.push({ id: mock.activityRows.length + 1, at: now, actor: null, action: 'portal.bank_request', entity: 'vendor', entity_id: me.vendor, new_value: String(id) });
    return json(200, { ok: true, id });
  }
  return fail(400, 'unknown_action');
}
