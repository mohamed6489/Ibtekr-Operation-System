import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// inventory.js (phase 7) against a stub IBSupabase: the lots, moves, open consolidations with their lines, counts, places and the
// settings row → the v2 shapes on IBKit.store; the writes (a lot + its first move, a move, a lot's patch, a consolidation and its
// close, a count and its lines, the approval RPC, the settings), the permissions and the activity rows. B6: the settings are five
// (the auto-pull switch, three alerts in days, the return default), no «+ مكان», no site quantity from here.
const src = readFileSync(new URL('../../app/js/adapter/inventory.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const ok = (data) => ({ data, error: null });
const ME = 'u1'; const V1 = 'a0000000-0000-4000-8000-000000000001';
const L1 = 'b0000000-0000-4000-8000-000000000001'; const L2 = 'b0000000-0000-4000-8000-000000000002'; const L3 = 'b0000000-0000-4000-8000-000000000003';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const LOTS = [
  { id: L1, reason: 'تجميع أوردر', status: 'وصل المخزن', sku: 'IBT-CB', name: 'سلة كروشيه', vendor_id: V1, order_id: 180662, item_id: 5001, ref: 'IB-180662', loc: 'T', mode: 'أمانة', cost: '260', since: '2026-11-01', created_by: ME },
  { id: L2, reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-MD', name: 'مكرمية', vendor_id: V1, order_id: null, item_id: null, ref: null, loc: 'A', mode: 'ملك ابتكر', cost: '420', since: '2026-10-12', created_by: ME },
  { id: L3, reason: 'مرتجع', status: 'بانتظار الفحص', sku: 'IBT-PD', name: 'برواز', vendor_id: V1, order_id: null, item_id: 5002, ref: '#5002', loc: 'R', mode: 'أمانة', cost: '450', condition: 'عيب بسيط', condition_note: 'خدش', note: 'العميل رفض الاستلام', since: '2026-11-03', created_by: ME },
];
const MOVES = [
  { id: 3, lot_id: L3, type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#5002', note: null, by: ME, at: '2026-11-03T10:00:00Z' },
  { id: 2, lot_id: L2, type: 'in', qty: 2, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: null, note: null, by: ME, at: '2026-10-12T10:00:00Z' },
  { id: 1, lot_id: L1, type: 'in', qty: 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-180662', note: null, by: null, at: '2026-11-01T09:30:00Z' },
];
const BASE = { 'inventory.view': 'F', 'inventory.edit': 'F', 'inventory.approve': 'N' };
function load({ responses = {}, perms = BASE, admin = false } = {}) {
  const stub = stubClient({ responses: { inv_lots: ok(LOTS), inv_moves: ok(MOVES), inv_consolidations: ok([{ id: C1, order_id: 180662, zone: 'T', status: 'open', since: '2026-11-01', created_by: ME }]),
    inv_consolidation_items: ok([{ consolidation_id: C1, item_id: 5001 }, { consolidation_id: C1, item_id: 5003 }]),
    order_items: ok([{ id: 5001, order_id: 180662, sub_order_id: 77, name: 'سلة كروشيه', sku: 'IBT-CB', qty: 1, total: 260, vendor_id: V1, status: 'وصل المخزن' }, { id: 5003, order_id: 180662, name: 'فازة', sku: 'IBT-VZ', qty: 1, total: 300, vendor_id: V1, status: 'قيد التنفيذ' }]),
    sub_orders: ok([{ id: 77, woo_order_id: 180700 }]), orders_v: ok([{ id: 180662, customer_name: 'منى' }]), inv_counts: ok([{ id: 4, zone: 'رف A', status: 'open', started_by: ME, started_at: '2026-11-04T08:00:00Z' }]),
    inv_count_lines: ok([{ count_id: 4, lot_id: L2, system: 2, counted: 1, note: 'ناقصة' }]), inv_locations: ok([{ code: 'A', label: 'رف A', kind: 'rack' }, { code: 'R', label: 'المرتجعات', kind: 'zone' }, { code: 'T', label: 'منطقة التجميع', kind: 'zone' }]),
    settings: ok({ data: { firstWarehouse: true, photoMax: 21, junk: 1 } }), ...responses } });
  const events = []; const logs = []; const KS = { store: {}, dshort: (d) => d, money: (n) => String(n) };
  const window = { IBSupabase: { client: stub.client }, IBDirectory: { perm: (k) => perms[k] || 'N', me: () => ({ id: ME, role_id: admin ? 'admin' : 'ops' }), members: () => [{ uid: ME, name: 'سارة أحمد' }] },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBVendors: { store: { get: (id) => (id === V1 ? { id: V1, name: 'HANDS' } : null), findByName: (n) => (n === 'HANDS' ? { id: V1 } : null) } },
    IBKit: KS, IbtekrOps: { countDiff: (l) => ({ items: l.filter((x) => x.counted !== x.system).length, value: 0 }) }, crypto: { randomUUID: () => 'd0000000-0000-4000-8000-000000000009' } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, CustomEvent: class { constructor(t) { this.type = t; } }, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, Intl, Error });
  return { I: window.IBInventory, S: KS.store, stub, events, logs };
}
const inserted = (stub, table) => opsOf(stub.calls, table).filter((c) => c.op === 'insert').map((c) => c.args[0]);

test('load: the lots, moves (newest first, Cairo time), returns, the open consolidation with its lines (the sub-order number as the orders page shows it — its Dokan order, else the order — and the line id), the open count, places, settings', async () => {
  const { I, S, events } = load();
  eq((await I.load()).ok, true);
  eq(S.stock.map((x) => [x.key, x.vendor, x.mode, x.order, x.sub, x.itemId, x.loc]), [[L1, 'HANDS', 'أمانة', '180662', '180700', '5001', 'T'], [L2, 'HANDS', 'ملك', null, '', null, 'A'], [L3, 'HANDS', 'أمانة', null, '5002', '5002', 'R']]);
  eq(S.ledger.map((m) => [m.key, m.at, m.by]), [[L3, '2026-11-03 12:00', 'سارة أحمد'], [L2, '2026-10-12 13:00', 'سارة أحمد'], [L1, '2026-11-01 11:30', 'السيستم']]);
  eq(S.returns.map((r) => [r.key, r.status, r.reason, r.condition, r.effect]), [[L3, 'بانتظار الفحص', 'العميل رفض الاستلام', 'عيب بسيط', '+ 1 بعد الفحص']]);
  eq(S.consolidations, [{ id: C1, order: '180662', customer: 'منى', since: '2026-11-01', zone: 'T', by: 'سارة أحمد', subs: [['180700', 'HANDS', 'وصل المخزن', 'سلة كروشيه', '5001'], ['180662', 'HANDS', 'قيد التنفيذ', 'فازة', '5003']] }]);
  eq([S.count.id, S.count.dbId, S.count.lines[0].counted, S.count.lines[0].name], ['CNT-04', 4, '1', 'مكرمية']);
  eq(S.racks.map((r) => r.code), ['A', 'R', 'T']);
  eq(S.invSettings, { firstWarehouse: true, consolidationAlert: 5, photoMax: 21, returnWait: 7, returnDefault: 'يرجع للمبتكر' }, 'the defaults ∪ the known keys of the row (junk dropped)');
  assert(events.includes('ib:inventory'));
});

test('without inventory.view nothing is read and the hub is empty', async () => {
  const { I, S, stub } = load({ perms: {} });
  eq((await I.load()).ok, true);
  eq([S.stock.length, S.ledger.length, S.count], [0, 0, null]);
  eq(opsOf(stub.calls, 'inv_lots').length, 0);
});

test('a received lot: the uuid the page gave (or a new one), the maker by name, the place code, the owner mode; then its first move; logged without notes', async () => {
  const { I, stub, logs } = load(); await I.load();
  const lot = { key: 'L-123', sku: ' IBT-NEW ', name: 'شنطة', vendor: 'HANDS', reason: 'متاح للبيع', status: 'متاح', loc: 'A-02', mode: 'ملك', since: '2026-11-04', note: 'سر' };
  const r = await I.addLot(lot, { type: 'in', qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: '—' });
  eq([r.ok, lot.key], [true, 'd0000000-0000-4000-8000-000000000009']);
  eq(inserted(stub, 'inv_lots')[0], { id: 'd0000000-0000-4000-8000-000000000009', reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-NEW', name: 'شنطة', vendor_id: V1, order_id: null, item_id: null, ref: null, loc: 'A', mode: 'ملك ابتكر', cost: 0, condition: null, condition_note: null, note: 'سر', since: '2026-11-04' });
  eq(inserted(stub, 'inv_moves')[0], { lot_id: 'd0000000-0000-4000-8000-000000000009', type: 'in', qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: null, note: null });
  eq(logs.map((l) => l[0]), ['inventory.receive']);
  assert(!JSON.stringify(logs).includes('سر'));
});

test('permissions: a viewer cannot write; ops cannot adjust (approve); a lot patch maps its fields; a count is approved by the RPC', async () => {
  const v = load({ perms: { 'inventory.view': 'F' } }); await v.I.load();
  eq((await v.I.addMove({ key: L2, type: 'in', qty: 1 })).reason, 'forbidden');
  const o = load(); await o.I.load();
  eq((await o.I.addMove({ key: L2, type: 'adjust', qty: -1 })).reason, 'forbidden');
  eq((await o.I.addMove({ key: 'not-a-uuid', type: 'in', qty: 1 })).reason, 'invalid');
  const u = load({ responses: { inv_lots: (q) => (q.some((x) => x.op === 'update') ? ok([{ id: L3 }]) : ok(LOTS)) } }); await u.I.load();
  eq((await u.I.updateLot(L3, { status: 'متاح', reason: 'متاح للبيع', loc: 'رف A', mode: 'أمانة', bogus: 1 }, 'inventory.inspect')).ok, true);
  eq(opsOf(u.stub.calls, 'inv_lots').find((c) => c.op === 'update').args[0], { status: 'متاح', reason: 'متاح للبيع', loc: 'A', mode: 'أمانة' });
  eq(u.logs.at(-1)[0], 'inventory.inspect');
  const a = load({ perms: { ...BASE, 'inventory.approve': 'F' }, responses: { 'rpc:inv_count_approve': ok(2) } }); await a.I.load();
  eq(await a.I.approveCount(4), { ok: true, adjusted: 2 });
  eq(opsOf(a.stub.calls).find((c) => c.op === 'rpc').args, ['inv_count_approve', { p_id: 4 }]);
});

test('a consolidation of an order\'s lines, then its close; a count with its lines (system is the server\'s); no «+ مكان» any more', async () => {
  const { I, stub } = load({ responses: { inv_consolidations: (q) => (q.some((x) => x.op === 'update') ? ok([{ id: C1 }]) : ok([])), inv_counts: (q) => (q.some((x) => x.op === 'insert') ? ok({ id: 9 }) : ok([])) } }); await I.load();
  eq((await I.consolidate(180700, ['7001', '7002', 'x'], 'T-01')).ok, true);
  eq(inserted(stub, 'inv_consolidations')[0], { id: 'd0000000-0000-4000-8000-000000000009', order_id: 180700, zone: 'T' });
  eq(inserted(stub, 'inv_consolidation_items')[0], [{ consolidation_id: 'd0000000-0000-4000-8000-000000000009', item_id: 7001 }, { consolidation_id: 'd0000000-0000-4000-8000-000000000009', item_id: 7002 }]);
  eq((await I.closeConsolidation(C1, 'shipped', 'Bosta')).ok, true);
  eq((await I.closeConsolidation(C1, 'open')).reason, 'invalid');
  eq((await I.startCount('رف A', [L1, L2, 'bad'])).id, 9);
  eq(inserted(stub, 'inv_count_lines')[0], [{ count_id: 9, lot_id: L1, system: 0 }, { count_id: 9, lot_id: L2, system: 0 }]);
  eq((await I.countLine(9, L1, '-1')).reason, 'invalid');
  eq([I.addLocation, I.pushSite], [undefined, undefined]);
  eq(I.PLACES, [['T', 'تجميع'], ['R', 'مرتجعات'], ['P', 'تصوير']]);
});

test('B6 settings: five keys only — the admin saves a clean merge (days 1–90 whole, the switch a boolean, the return default one of two); the old keys dropped; loadSettings reads the row alone', async () => {
  const { I } = load(); await I.load();
  eq((await I.saveSettings({ photoMax: 10 })).reason, 'forbidden', 'the admin only');
  const ad = load({ admin: true, responses: { settings: ok({ data: { firstWarehouse: true, photoMax: 21, wooSync: true, zone: 'T — منطقة التجميع', reserveAt: 'تأكيد الأوردر' } }) } }); await ad.I.load();
  for (const bad of [{}, { wooSync: true, junk: 1 }, { photoMax: 0 }, { returnWait: 91 }, { consolidationAlert: 2.5 }, { photoMax: 'x' }, { returnDefault: 'يتباع' }, { firstWarehouse: 'yes' }]) eq((await ad.I.saveSettings(bad)).reason, 'invalid', JSON.stringify(bad));
  eq(opsOf(ad.stub.calls, 'settings').filter((c) => c.op === 'upsert').length, 0, 'nothing written for a refused patch');
  eq((await ad.I.saveSettings({ photoMax: 10, returnWait: '8', returnDefault: 'يستنى أوردر', wooSync: true, junk: 1 })).ok, true);
  const up = opsOf(ad.stub.calls, 'settings').find((c) => c.op === 'upsert').args[0];
  eq(up, { section: 'inventory', data: { firstWarehouse: true, consolidationAlert: 5, photoMax: 10, returnWait: 8, returnDefault: 'يستنى أوردر' } }, 'the old row\'s keys (wooSync, zone, …) are gone');
  eq([ad.S.invSettings.returnWait, ad.I.settings().returnDefault], [8, 'يستنى أوردر']);
  eq(ad.logs.at(-1).slice(0, 2), ['inventory.settings', 'photoMax, returnWait, returnDefault']);
  const fresh = load({ responses: { settings: ok({ data: { consolidationAlert: 3, returnWait: 500, returnDefault: 'يستنى أوردر' } }) } });
  eq(await fresh.I.loadSettings(), { firstWarehouse: false, consolidationAlert: 3, photoMax: 14, returnWait: 7, returnDefault: 'يستنى أوردر' });
  eq(opsOf(fresh.stub.calls, 'inv_lots').length, 0, 'the row alone, not the hub');
});

test('a lot from the orders page: item_id is the line\'s id (itemId), never the sub-order number it shows (sub)', () => {
  const { I } = load();
  const row = I._test.lotRow({ key: 'x', reason: 'مرتجع', status: 'بانتظار الفحص', name: 'برواز', sub: '180700', itemId: '5002', order: '180662', since: '2026-11-04' });
  eq([row.item_id, row.order_id], [5002, 180662]);
  eq(I._test.lotRow({ key: 'x', reason: 'مرتجع', status: 'بانتظار الفحص', name: 'برواز', sub: '180700' }).item_id, null);
});

test('no site quantity from the inventory any more (B6): a move or a new «ملك ابتكر» lot never calls woo-sync, even with the old wooSync on the row', async () => {
  const on = load({ perms: { ...BASE, 'products.edit': 'F' }, responses: { settings: ok({ data: { wooSync: true } }) } });
  await on.I.load();
  eq((await on.I.addMove({ key: L2, type: 'out', qty: 1 })).ok, true); // L2: مكرمية, ملك ابتكر
  eq((await on.I.addLot({ key: 'x', reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-NEW', name: 'شنطة', vendor: 'HANDS', mode: 'ملك', loc: 'A' }, { type: 'in', qty: 2 })).ok, true);
  await new Promise((r) => setTimeout(r, 0));
  eq(on.stub.calls.filter((c) => c.op === 'invoke').length, 0);
});
