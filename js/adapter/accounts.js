// Accounts (phase 4): the team's three ledgers (acc_expenses, acc_vendor_moves, acc_account_moves — 0019), the read-only Dokan
// mirrors (dokan_balances, dokan_withdrawals — written by woo-sync part `accounts`), the sales of our own orders (rpc
// accounts_sales) and the maker's Dokan statement on demand (woo-sync action `statement`, never stored).
// The ledgers are handed to block 28 in the prototype's shapes (toExpense / toVendorMove / toAccountMove, pure):
//   expenses     { id, date, direction, category, beneficiaryName, beneficiaryIsOther, amount, note, subName, subIsOther,
//                  subEnds, subAlerts, subNote, createdBy (a name), createdById }
//   vendorMoves  { id, date, direction, type, typeName, vendor (the maker's name), vendorId, amount, note, createdBy, createdById }
//   accountMoves { id, date, direction, account, amount, note, createdBy, createdById }
// Voided rows are not handed out (the server keeps them). load() runs with the sign-in (IBDirectory.load) and after every
// write the server took; state() is 'idle' | 'loading' | 'ready' | 'error'; every change dispatches ib:accounts.
// Writes: add(kind, value) inserts (created_by is the server's: auth.uid()), update(kind, id, value) sends the changed columns,
// remove(kind, id) is the void of decision 2 (voided_at; the guard stamps it) — each returns a Promise of { ok, rec?, reason }
// and never throws; reason 'forbidden' (42501), 'invalid' (22xxx / 23xxx), 'network'. Every write the server took is logged
// through IBActivity.log as accounts.<kind>[.edit|.void] with the kind, the amount and the date only (no beneficiary, no note;
// no amount for «المرتبات» — activity_log is readable with settings.view, wider than the payroll's accounts.view = F).
// can(): { view, add, approve } from IBDirectory.perm; canEdit(rec) = own row with add F, or approve F.
// sales(from, to): the cached rows of accounts_sales for that range, or null while they load (one request per range; the answer
// dispatches ib:accounts). statement(vendorId, from, to): a Promise of { ok, rows, reason }.
(function () {
  'use strict';
  const KINDS = {
    expenses: { table: 'acc_expenses', cols: 'id, on_date, direction, category, beneficiary, beneficiary_other, amount, note, sub_name, sub_is_other, sub_ends, sub_alerts, sub_note, created_by, created_at', log: 'accounts.expense' },
    vendorMoves: { table: 'acc_vendor_moves', cols: 'id, vendor_id, on_date, direction, kind, kind_name, amount, note, created_by, created_at', log: 'accounts.vendor_move' },
    accountMoves: { table: 'acc_account_moves', cols: 'id, account, on_date, direction, amount, note, created_by, created_at', log: 'accounts.account_move' },
  };
  const SUBS = 'الاشتراكات';
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const day = (v) => (typeof v === 'string' ? v.slice(0, 10) : '');

  let st = 'idle';
  const data = { expenses: [], vendorMoves: [], accountMoves: [], balances: [], withdrawals: [] };
  const salesCache = new Map(); // 'from|to' → rows | 'loading' | 'error'
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:accounts', { detail: detail || {} })));

  // ---------- who: profile uuid → name, maker uuid ↔ name ----------
  function nameOf(uid) {
    const K = window.IBKit; const m = K && K.store && (K.store.members || []).find((x) => x.uid === uid);
    return m ? m.name : '—';
  }
  function vendorName(id) { const V = window.IBVendors; const v = V && V.store && V.store.get ? quiet(() => V.store.get(id)) : null; return v ? v.name : '—'; }
  function vendorIdOf(name) { const V = window.IBVendors; const v = V && V.store ? quiet(() => V.store.findByName(name)) : null; return v ? v.id : null; }

  // ---------- rows → the prototype's shapes (pure but for the two name lookups) ----------
  const toExpense = (r) => ({ id: r.id, date: day(r.on_date), direction: r.direction, category: r.category, beneficiaryName: r.beneficiary || '', beneficiaryIsOther: !!r.beneficiary_other,
    amount: num(r.amount), note: r.note || '', subName: r.sub_name || '', subIsOther: !!r.sub_is_other, subEnds: r.sub_ends ? day(r.sub_ends) : '', subAlerts: Array.isArray(r.sub_alerts) ? r.sub_alerts.slice() : [],
    subNote: r.sub_note || '', createdById: r.created_by || null, createdBy: nameOf(r.created_by), createdAt: r.created_at || '' });
  const toVendorMove = (r) => ({ id: r.id, date: day(r.on_date), direction: r.direction, type: r.kind, typeName: r.kind === 'أخرى' ? (r.kind_name || '') : r.kind, vendorId: r.vendor_id, vendor: vendorName(r.vendor_id),
    amount: num(r.amount), note: r.note || '', createdById: r.created_by || null, createdBy: nameOf(r.created_by), createdAt: r.created_at || '' });
  const toAccountMove = (r) => ({ id: r.id, date: day(r.on_date), direction: r.direction, account: r.account, amount: num(r.amount), note: r.note || '',
    createdById: r.created_by || null, createdBy: nameOf(r.created_by), createdAt: r.created_at || '' });
  const TO = { expenses: toExpense, vendorMoves: toVendorMove, accountMoves: toAccountMove };

  // the prototype's value (D.validate* .value) → the table's columns
  function toColumns(kind, v) {
    if (kind === 'expenses') {
      const sub = v.category === SUBS;
      return { on_date: v.date, direction: v.direction || 'withdraw', category: v.category, beneficiary: v.beneficiaryName || null, beneficiary_other: !!v.beneficiaryIsOther, amount: v.amount,
        note: v.note || null, sub_name: sub ? v.subName || null : null, sub_is_other: sub ? !!v.subIsOther : false, sub_ends: sub ? v.subEnds || null : null,
        sub_alerts: sub ? (v.subAlerts || []).slice() : [], sub_note: sub ? v.subNote || null : null };
    }
    if (kind === 'vendorMoves') return { vendor_id: v.vendorId || vendorIdOf(v.vendor), on_date: v.date, direction: v.direction, kind: v.type, kind_name: v.type === 'أخرى' ? v.typeName || null : null, amount: v.amount, note: v.note || null };
    return { account: v.account, on_date: v.date, direction: v.direction, amount: v.amount, note: v.note || null };
  }

  async function load() {
    const cl = c(); if (!cl) return;
    if (perm('accounts.view') === 'N') { st = 'ready'; emit(); return; }
    st = 'loading'; emit();
    try {
      const reads = Object.entries(KINDS).map(([, k]) => cl.from(k.table).select(k.cols).is('voided_at', null).order('on_date', { ascending: false }).range(0, 9999));
      reads.push(cl.from('dokan_balances').select('vendor_id, woo_vendor_id, balance, earning, sales, orders, synced_at'));
      reads.push(cl.from('dokan_withdrawals').select('id, woo_vendor_id, vendor_id, amount, charge, receivable, status, method, requested_at, synced_at').order('id', { ascending: false }).range(0, 9999));
      const res = await Promise.all(reads);
      const bad = res.find((r) => r.error); if (bad) throw bad.error;
      Object.keys(KINDS).forEach((kind, i) => { data[kind] = (res[i].data || []).map(TO[kind]); });
      data.balances = (res[3].data || []).map((r) => ({ vendorId: r.vendor_id, store: r.woo_vendor_id, balance: numOrNull(r.balance), earning: numOrNull(r.earning), sales: numOrNull(r.sales), orders: r.orders, syncedAt: r.synced_at }));
      data.withdrawals = (res[4].data || []).map((r) => ({ id: r.id, store: r.woo_vendor_id, vendorId: r.vendor_id, amount: num(r.amount), charge: num(r.charge), receivable: num(r.receivable), status: r.status, method: r.method || '', at: r.requested_at || '', syncedAt: r.synced_at }));
      salesCache.clear();
      st = 'ready';
    } catch (e) { st = 'error'; }
    emit();
  }

  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const can = () => ({ view: perm('accounts.view'), add: perm('accounts.add') === 'F', approve: perm('accounts.approve') === 'F' });
  const myUid = () => { const s = window.IBAuth && window.IBAuth.session && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const canEdit = (rec) => !!rec && (can().approve || (can().add && rec.createdById && rec.createdById === myUid()));
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  function logged(kind, suffix, v) {
    const L = window.IBActivity; if (!L || !L.log) return;
    // «المرتبات» without its amount: activity_log is read with settings.view, wider than accounts.view = F (security review)
    const detail = [v.category || v.type || v.account || '', v.direction === 'deposit' ? 'إيداع' : 'سحب', v.category === 'المرتبات' ? null : v.amount, v.date].filter((x) => x !== '' && x != null).join(' · ');
    quiet(() => L.log(KINDS[kind].log + suffix, detail, { entity: KINDS[kind].table, entity_id: v.id }));
  }

  async function add(kind, value) {
    const cl = c(); if (!cl || !KINDS[kind]) return { ok: false, reason: 'network' };
    try {
      const { data: rows, error } = await cl.from(KINDS[kind].table).insert(toColumns(kind, value)).select(KINDS[kind].cols);
      if (error) return { ok: false, reason: reasonOf(error) };
      const rec = TO[kind]((rows || [])[0] || {});
      data[kind] = [rec, ...data[kind]]; logged(kind, '', { ...value, id: rec.id }); emit({ kind, id: rec.id });
      return { ok: true, rec };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function update(kind, id, value) {
    const cl = c(); if (!cl || !KINDS[kind]) return { ok: false, reason: 'network' };
    try {
      const { data: rows, error } = await cl.from(KINDS[kind].table).update(toColumns(kind, value)).eq('id', id).select(KINDS[kind].cols);
      if (error) return { ok: false, reason: reasonOf(error) };
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      const rec = TO[kind](rows[0]);
      data[kind] = data[kind].map((r) => (r.id === id ? rec : r)); logged(kind, '.edit', { ...value, id }); emit({ kind, id });
      return { ok: true, rec };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function remove(kind, id) {
    const cl = c(); if (!cl || !KINDS[kind]) return { ok: false, reason: 'network' };
    const old = data[kind].find((r) => r.id === id);
    try {
      const { data: rows, error } = await cl.from(KINDS[kind].table).update({ voided_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error) return { ok: false, reason: reasonOf(error) };
      if (!rows || !rows.length) return { ok: false, reason: 'forbidden' };
      data[kind] = data[kind].filter((r) => r.id !== id); if (old) logged(kind, '.void', old); emit({ kind, id });
      return { ok: true, rec: old };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }

  function sales(from, to) {
    const key = from + '|' + to; const hit = salesCache.get(key);
    if (Array.isArray(hit)) return hit;
    if (hit === 'loading' || hit === 'error') return null;
    const cl = c(); if (!cl || perm('accounts.view') === 'N') return null;
    salesCache.set(key, 'loading');
    Promise.resolve(cl.rpc('accounts_sales', { p_from: from, p_to: to })).then(({ data: rows, error }) => {
      salesCache.set(key, error ? 'error' : (rows || []).map((r) => ({ vendorId: r.vendor_id, group: r.grp, orders: Number(r.orders) || 0, sales: num(r.sales), share: num(r.share), isTotal: !!r.is_total })));
      emit({ sales: key });
    }, () => { salesCache.set(key, 'error'); emit({ sales: key }); });
    return null;
  }
  const salesFailed = (from, to) => salesCache.get(from + '|' + to) === 'error';

  async function statement(vendorId, from, to) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network', rows: [] };
    try {
      const { data: body, error } = await cl.functions.invoke('woo-sync', { body: { action: 'statement', vendor_id: vendorId, from, to } });
      if (error || !body) return { ok: false, reason: 'network', rows: [] };
      return { ok: true, rows: Array.isArray(body.rows) ? body.rows : [], noStore: body.result === 'no_store', done: body.done !== false };
    } catch (e) { return { ok: false, reason: 'network', rows: [] }; }
  }

  function clear() { st = 'idle'; Object.keys(data).forEach((k) => { data[k] = []; }); salesCache.clear(); }

  window.IBAccounts = { load, clear, state: () => st, rows: (kind) => data[kind].slice(), balances: () => data.balances.slice(), withdrawals: () => data.withdrawals.slice(),
    add, update, remove, sales, salesFailed, statement, can, canEdit, toExpense, toVendorMove, toAccountMove, toColumns, KINDS };
})();
