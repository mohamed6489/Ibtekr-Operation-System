// IBLost — the meeting of 23 Nov #39 (docs/superpowers/plans/2026-11-23-meeting.md, phase 6; Safwat 24 Nov): «فقد».
// A lost return is an inventory lot «مرتجع» with the status «مفقود» and its value in `cost` (0154). This reads them (the maker's
// «مفقودات» tab, the column in the makers' accounts — shown only, they change no balance) and the accounts' «مفقودات» (acc_bad_debts), and
// writes the decision on a lost piece through acc_bad_debt_add only: a deposit to the maker («إيداع» on his account) or a write-off.
(function () {
  'use strict';
  const LOT_COLS = 'id, sku, name, vendor_id, order_id, item_id, ref, cost, note, since, created_at';
  const DEBT_COLS = 'id, lot_id, vendor_id, kind, amount, reason, note, on_date, vendor_move_id, created_by, created_at';
  const REASONS = ['فقد المنتج', 'تلف المنتج في المخزن', 'أخرى'];
  const KIND_LABEL = { deposit: 'مفقود محسوب', writeoff: 'مفقود غير محسوب' }; // Safwat 24 Nov: «مفقودات» — on the maker's account = «محسوب», kept as lost = «غير محسوب»
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const perm = (k) => { const D = window.IBDirectory; return (D && D.perm ? quiet(() => D.perm(k)) : null) || 'N'; };
  const emit = () => quiet(() => document.dispatchEvent(new CustomEvent('ib:lost')));

  let st = 'idle'; let gen = 0; let pending = null;
  const data = { lots: [], debts: [] };
  const toLot = (r) => ({ id: r.id, sku: r.sku || '', name: r.name || '', vendorId: r.vendor_id || null, order: r.order_id != null ? String(r.order_id) : '',
    itemId: r.item_id != null ? String(r.item_id) : '', ref: r.ref || '', value: num(r.cost), note: r.note || '', day: String(r.since || r.created_at || '').slice(0, 10) });
  const toDebt = (r) => ({ id: r.id, lotId: r.lot_id || null, vendorId: r.vendor_id || null, kind: r.kind, kindLabel: KIND_LABEL[r.kind] || r.kind, amount: num(r.amount),
    reason: r.reason, note: r.note || '', day: String(r.on_date || '').slice(0, 10), moveId: r.vendor_move_id || null, by: r.created_by || null, at: r.created_at || '' });

  // the lots need inventory.view, the bad debts accounts.view (the RLS of each table); a member with neither reads nothing
  async function load(opts) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    const g = ++gen; if (!(opts && opts.quiet)) st = 'loading';
    try {
      const [lots, debts] = await Promise.all([
        perm('inventory.view') !== 'N' ? cl.from('inv_lots').select(LOT_COLS).eq('status', 'مفقود').order('created_at', { ascending: false }).limit(2000) : { data: [] },
        perm('accounts.view') !== 'N' ? cl.from('acc_bad_debts').select(DEBT_COLS).order('created_at', { ascending: false }).limit(2000) : { data: [] }]);
      if (lots.error || debts.error) throw lots.error || debts.error;
      if (g !== gen) return { ok: false, reason: 'stale' };
      data.lots = (lots.data || []).map(toLot); data.debts = (debts.data || []).map(toDebt); st = 'ready'; emit();
      return { ok: true };
    } catch (e) { if (g === gen && st !== 'ready') st = 'error'; emit(); return { ok: false, reason: 'network' }; }
  }
  const ensure = () => { if (st === 'idle') { pending = pending || load().finally(() => { pending = null; }); } return pending || Promise.resolve({ ok: st === 'ready' }); };
  const decisionOf = (lotId) => data.debts.find((d) => d.lotId === lotId) || null;
  const lots = () => data.lots.map((l) => Object.assign({}, l, { decision: decisionOf(l.id) }));
  const forVendor = (vid) => lots().filter((l) => String(l.vendorId) === String(vid));
  const totalOf = (vid) => data.lots.filter((l) => String(l.vendorId) === String(vid)).reduce((s, l) => s + l.value, 0);
  const countOf = (vid) => data.lots.filter((l) => String(l.vendorId) === String(vid)).length;
  const can = () => perm('accounts.add') === 'F';

  const FIELD = { amount: 'amount', reason: 'reason', note: 'note', kind: 'kind', decided: 'decided', lot: 'lot', vendor: 'vendor' };
  // the decision: { kind: deposit | writeoff, amount, reason, note } → { ok, id } | { ok: false, reason, field }
  async function decide(lotId, d) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can()) return { ok: false, reason: 'forbidden' };
    const amount = num(d && d.amount); const why = d && d.reason; const note = String((d && d.note) || '').trim();
    if (!(d && (d.kind === 'deposit' || d.kind === 'writeoff'))) return { ok: false, reason: 'invalid', field: 'kind' };
    if (!(amount > 0)) return { ok: false, reason: 'invalid', field: 'amount' };
    if (!REASONS.includes(why)) return { ok: false, reason: 'invalid', field: 'reason' };
    if (why === 'أخرى' && !note) return { ok: false, reason: 'invalid', field: 'note' };
    if (/[<>]/.test(note) || note.length > 300) return { ok: false, reason: 'invalid', field: 'note' };
    const { data: id, error } = await cl.rpc('acc_bad_debt_add', { p_lot: lotId, p_kind: d.kind, p_amount: amount, p_reason: why, p_note: note || null });
    if (error) {
      const m = /invalid: (\w+)/.exec(String(error.message || ''));
      return { ok: false, reason: error.code === '42501' ? 'forbidden' : m ? 'invalid' : 'network', field: m ? (FIELD[m[1]] || m[1]) : undefined };
    }
    const A = window.IBActivity; if (A && A.log) quiet(() => A.log('accounts.bad_debt', JSON.stringify({ id, kind: d.kind })));
    await load({ quiet: true });
    const Ac = window.IBAccounts; if (d.kind === 'deposit' && Ac && Ac.load) quiet(() => Ac.load({ quiet: true })); // the maker's «إيداع» moves his net
    return { ok: true, id };
  }
  function clear() { gen++; st = 'idle'; data.lots = []; data.debts = []; }

  // the live signal: a new lost lot (inventory) or a decision (accounts) reads again — once something has read it
  const L = window.IBLive; if (L && L.on) { L.on('inventory', () => (st === 'idle' ? null : load({ quiet: true }))); L.on('accounts', () => (st === 'idle' ? null : load({ quiet: true }))); }
  window.IBLost = { load, ensure, clear, state: () => st, lots, debts: () => data.debts.slice(), forVendor, totalOf, countOf, decisionOf, decide, can, REASONS, KIND_LABEL };
})();
