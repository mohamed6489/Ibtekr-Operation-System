import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// vendors.js against a stub IBSupabase (+ block 06 for the prototype's validation, as the browser has it): vendors +
// vendor_rates + vendor_bank → the prototype's vendor shape (toVendor, pure); write-through store (named columns, no .select()
// on an update, .select('id') on an insert; 42501 → the old value back + ib:vendors { reason }); the share / balance math of
// decision 4 / 5 (lineShare, stats); the contract upload path; findByName on aliases; vendor.* events with the vendor as entity.
// Phase 3.1 (decision 10): the login shape from vendor_logins (no secret_id), the create sequence with { vendor, missing }, setLogin /
// setLoginStatus / setLoginPassword / revealPassword / usernameTaken / canLogin / missing, the status «في إجازة»; the password
// reaches the RPC and nothing else.
// Phase 3.2 (decisions 3 / 4): the brands tables → `brands` / `brandsEver` on the vendor, addBrand / updateBrand / setBrandRate /
// transferBrand / returnBrand (local refusals first, the server's codes mapped to the same messages, two events on a transfer),
// ownerAt / storeOwnerAt / rateFor / brandByName / namesOf, the attribution and the rate in stats / lineShare — unchanged without a transfer.
const src = readFileSync(new URL('../../app/js/adapter/vendors.js', import.meta.url), 'utf8');
const domain = readFileSync(new URL('../../app/js/blocks/06-vendors-domain.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const TODAY_LOCAL = '2026-10-25'; // the adapter's clock in these tests (NOW below)
const rpcCalls = (calls, fn) => calls.filter((c) => c.op === 'rpc' && c.args[0] === fn).map((c) => c.args[1]);
const V1 = 'a0000000-0000-4000-8000-000000000001', V2 = 'a0000000-0000-4000-8000-000000000002', V3 = 'a0000000-0000-4000-8000-000000000003';
const T0 = '2026-10-20T08:00:00+00:00'; const IBAN = 'EG38000300010000000000000482'; // a fake IBAN
const row = (o) => ({ woo_vendor_id: null, aliases: [], phone: null, email: null, status: 'active', raw: null, created_at: T0, updated_at: T0, legal_name: null, category: null, alt_phone: null, address: null, instagram: null, store_url: null, lead_days: 7, deposit_policy: null, notes: null, joined_at: null, contract: null, opening_balance: 0, ...o });
const CONTRACT = { path: V2 + '/1700000000000-antikiano.pdf', file_name: 'antikiano.pdf', size: 980000, expires: '2026-11-15', uploaded_by: 'منى حسن', uploaded_at: T0 };
const VENDORS = [
  row({ id: V2, woo_vendor_id: 44, name: 'Antikiano', category: 'إكسسوارات ومجوهرات', phone: '01000000001', contract: CONTRACT }),
  row({ id: V1, woo_vendor_id: 2376, name: 'Art Craft', aliases: ['ArtCraft', 'آرت كرافت'], phone: '01000000003', category: 'فنون ولوحات', raw: { id: 2376, shop_url: 'https://ibtekr.club/store/art-craft/' }, joined_at: '2026-03-01', notes: 'الشحن على المبتكر' }),
  row({ id: V3, woo_vendor_id: 2047, name: 'Bian eg', status: 'inactive', opening_balance: '150.00' }),
];
const RATES = [{ id: 1, vendor_id: V1, rate: '35.00', since: '2026-03-01', set_by: 'صفوت كمال', created_at: T0 }, { id: 2, vendor_id: V2, rate: 40, since: '2026-03-01', set_by: 'صفوت كمال', created_at: T0 },
  { id: 3, vendor_id: V2, rate: 45, since: '2026-10-01', set_by: 'صفوت كمال', created_at: T0 }, { id: 4, vendor_id: V2, rate: 50, since: '2027-01-01', set_by: 'صفوت كمال', created_at: T0 }];
const BANK = [{ vendor_id: V3, method: 'bank', bank_name: 'البنك الأهلي المصري', holder: 'Bian Egypt', iban: IBAN, wallet: null, updated_by: 'منى حسن', updated_at: T0 }];
// vendor_logins as the client reads it (no secret_id): Antikiano with a temporary password set, Bian eg a legacy link-mode row (the DB still
// allows the value; the app writes temp only since 26 Oct) and disabled
const LOGINS = [{ vendor_id: V2, username: 'antikiano', email: 'antikiano.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: T0, created_by: 'صفوت كمال', created_at: T0, updated_at: T0 },
  { vendor_id: V3, username: 'bian.eg', email: 'bian.dev@ibtekr.local', pw_mode: 'link', status: 'disabled', must_change: true, invite_sent_at: null, password_set_at: null, created_by: 'صفوت كمال', created_at: T0, updated_at: T0 }];
const NEW = 'a0000000-0000-4000-8000-000000000009';
// 0013: the automatic brand of each maker (its store tied, the maker the origin, owned since joined_at) and a hand-added one for Art Craft
const B1 = 'd0000000-0000-4000-8000-000000000001', B2 = 'd0000000-0000-4000-8000-000000000002', B3 = 'd0000000-0000-4000-8000-000000000003', B4 = 'd0000000-0000-4000-8000-000000000004', NEWB = 'd0000000-0000-4000-8000-000000000009';
const brandRow = (o) => ({ aliases: [], store_vendor_id: null, created_by: 'system', created_at: T0, updated_at: T0, ...o });
const BRANDS = [brandRow({ id: B2, name: 'Antikiano', code: 'A', aliases: ['Antikiano store'], store_vendor_id: V2, origin_vendor_id: V2 }), brandRow({ id: B1, name: 'Art Craft', code: 'A', aliases: ['ArtCraft', 'آرت كرافت'], store_vendor_id: V1, origin_vendor_id: V1 }),
  brandRow({ id: B3, name: 'Bian eg', code: 'B', store_vendor_id: V3, origin_vendor_id: V3 }), brandRow({ id: B4, name: 'Wood & Rope', code: 'W', aliases: ['W&R'], origin_vendor_id: V1, created_by: 'صفوت كمال' })];
const ownerRow = (id, brand_id, vendor_id, since, more = {}) => ({ id, brand_id, vendor_id, since, return_on: null, reason: null, set_by: 'system', created_at: T0, ...more });
const OWNERS = [ownerRow(1, B1, V1, '2026-03-01'), ownerRow(2, B2, V2, '2026-03-01'), ownerRow(3, B3, V3, '2026-03-01'), ownerRow(4, B4, V1, '2026-09-01', { set_by: 'صفوت كمال' })];
// Antikiano's brand with Bian eg from 18 October, temporarily (back on 20 November)
const TRANSFER = ownerRow(5, B2, V3, '2026-10-18', { return_on: '2026-11-20', reason: 'إجازة', set_by: 'صفوت كمال' });
const BASE = { name: 'zaan', category: 'هدايا', phone: '01000000009', rate: '40', leadDays: '7', status: 'active', aliases: '', email: 'zaan.dev@ibtekr.local' };
const TEST_PW = 'Test1234'; // the fake test password
const ok = (data) => ({ data, error: null });
const denied = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
const seed = () => ({ vendors: ok(VENDORS), vendor_rates: ok(RATES), vendor_bank: ok(BANK), vendor_logins: ok(LOGINS), activity_log: ok([]), brands: ok(BRANDS), brand_owners: ok(OWNERS), brand_rates: ok([]), vendor_category_rates: ok([]), woo_categories: ok(CATEGORIES), 'fn:woo-sync': PUSH_OK });
const B1_SHAPE = { id: B1, name: 'Art Craft', code: 'A', aliases: ['ArtCraft', 'آرت كرافت'], since: '2026-03-01', returnOn: null, temp: false, rate: null, store: V1, origin: V1, owner: V1, lastSince: '2026-03-01', back: V1 };
const B4_SHAPE = { id: B4, name: 'Wood & Rope', code: 'W', aliases: ['W&R'], since: '2026-09-01', returnOn: null, temp: false, rate: null, store: null, origin: V1, owner: V1, lastSince: '2026-09-01', back: V1 };
// phase 3.3 (0014): the empty synced shapes, the site's categories, Art Craft's category rates and a push_vendor answer
const EMPTY_PARTS = { street_1: '', street_2: '', city: '', state: '', zip: '', country: '' };
const EMPTY_SOCIAL = { fb: '', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' };
const CATEGORIES = [{ id: 22, name: 'هدايا', slug: 'gifts', parent_id: 0, updated_at: T0 }, { id: 15, name: 'ديكور', slug: 'decor', parent_id: 0, updated_at: T0 }];
const CAT_RATES = [{ id: 1, vendor_id: V1, woo_category_id: 15, rate: '30.00', flat: '0.00', since: '2026-03-01', set_by: 'الموقع', created_at: T0 }, { id: 2, vendor_id: V1, woo_category_id: 22, rate: 25, flat: null, since: '2026-10-01', set_by: 'صفوت كمال', created_at: T0 },
  { id: 3, vendor_id: V1, woo_category_id: 22, rate: null, flat: null, since: '2026-10-20', set_by: 'صفوت كمال', created_at: T0 }, { id: 4, vendor_id: V1, woo_category_id: 15, rate: 33, flat: 5, since: '2027-01-01', set_by: 'صفوت كمال', created_at: T0 }];
const PUSH_OK = (opts) => ({ data: { action: 'push_vendor', result: 'ok', fields: opts.body.fields, accepted: opts.body.fields, refused: [], dropped: [], counts: { pushed: 1 } }, error: null });
const invokes = (calls) => calls.filter((c) => c.op === 'invoke').map((c) => c.args);
const NOW = new Date(2026, 9, 25, 12, 0).getTime(); // the adapter's clock: local 2026-10-25
const clockAt = (t) => class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
const OPS = { 'vendors.view': 'F', 'vendors.edit': 'P', 'vendors.toggle': 'N', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' };
const ACCOUNTS = { 'vendors.view': 'F', 'vendors.edit': 'N', 'sensitive.vendor_bank': 'F', 'sensitive.commission': 'N' };
function load({ responses = seed(), admin = true, perms = OPS, signedIn = true, orders = null, app = null } = {}) {
  const stub = stubClient({ responses }); const events = []; const logs = []; const storage = [];
  stub.client.storage = { from: (bucket) => ({
    upload: async (path, body, opts) => { storage.push(plain({ op: 'upload', bucket, path, bytes: body.byteLength, opts })); const r = responses['storage:upload']; return (typeof r === 'function' ? r(path) : r) || ok({ path, id: 'obj-1', fullPath: bucket + '/' + path }); },
    createSignedUrl: async (path, seconds) => { storage.push({ op: 'sign', bucket, path, seconds }); return responses['storage:sign'] || ok({ signedUrl: 'https://proj.supabase.co/storage/v1/object/sign/' + bucket + '/' + path + '?token=t' }); } }) };
  const me = { id: 'u1', role_id: admin ? 'admin' : 'ops', status: 'active', name: admin ? 'صفوت كمال' : 'سارة أحمد' };
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => (signedIn ? { user: { id: 'u1' } } : null) },
    IBDirectory: { perm: (k) => (admin ? 'F' : perms[k] || 'N'), me: () => me },
    IBKit: { ME: 'M02', member: () => ({ id: 'M02', name: me.name, role: admin ? 'أدمن' : 'عمليات' }) },
    IBActivity: { log: (action, detail, meta) => { logs.push(plain([action, detail, meta])); return Promise.resolve(); } },
    IBOrders: { data: () => orders, load: () => { logs.push(['orders.load']); return Promise.resolve(); } } };
  if (app) window.OrdersApp = app;
  const ctx = { window, document: { dispatchEvent(e) { events.push(plain({ type: e.type, detail: e.detail })); } }, Event, URL, Date: clockAt(NOW) }; // URL: block 06 / the adapter judge the https links with it, as the browser does
  runInNewContext(domain, ctx); window.IbtekrVendors = ctx.IbtekrVendors; // block 06 (UMD, pure)
  runInNewContext(src, ctx);
  return { V: window.IBVendors, S: window.IBVendors.store, calls: stub.calls, responses: stub.responses, storage, events, logs, window };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); }; // the write, its log and the reload
const selectOf = (calls, table) => opsOf(calls, table).filter((c) => c.op === 'select').map((c) => c.args[0]);
const writesOf = (calls, table) => opsOf(calls, table).filter((c) => ['insert', 'update', 'delete', 'eq', 'select'].includes(c.op));

test('load names every column (no *, no commission_pct), reads the rates and the bank rows, builds the prototype shape', async () => {
  const { V, S, calls, events } = load();
  assert.equal(V.state(), 'idle');
  await V.load();
  assert.equal(V.state(), 'ready');
  assert.deepEqual(events.map((e) => e.detail.state), ['loading', 'ready']);
  for (const t of ['vendors', 'vendor_rates', 'vendor_bank', 'vendor_logins']) for (const s of selectOf(calls, t)) { assert.doesNotMatch(s, /\*/, t); assert.doesNotMatch(s, /commission_pct/, t); assert.doesNotMatch(s, /secret_id/, t); }
  assert.match(selectOf(calls, 'vendor_logins')[0], /^vendor_id, username, email, pw_mode, status, must_change, invite_sent_at, password_set_at, created_by, created_at, updated_at$/);
  assert.match(selectOf(calls, 'vendors')[0], /\bcontract\b.*\bopening_balance\b/);
  assert.deepEqual(opsOf(calls, 'vendors').filter((c) => c.op === 'range'), [{ op: 'range', args: [0, 999] }]);
  assert.deepEqual(plain(S.get(V1)), { id: V1, name: 'Art Craft', legalName: null, category: 'فنون ولوحات', aliases: ['ArtCraft', 'آرت كرافت'], status: 'active', phone: '01000000003', altPhone: null, email: null, address: null, instagram: null, storeUrl: null,
    contactName: null, addressParts: EMPTY_PARTS, social: EMPTY_SOCIAL, logoUrl: null, bannerUrl: null, wooPaymentMethods: [], wooSyncedAt: null, pushPending: [], categoryRates: [], rateFlat: null, // phase 3.3: no synced data on this row
    rate: 35, rateSince: '2026-03-01', rateHistory: [{ rate: 35, flat: null, since: '2026-03-01', by: 'صفوت كمال' }], ratesVisible: true, leadDays: 7, depositPolicy: null, notes: 'الشحن على المبتكر', logoLetter: 'A', joinedAt: '2026-03-01',
    contract: null, bank: null, login: null, openingBalance: 0, wooVendorId: 2376, shopUrl: 'https://ibtekr.club/store/art-craft/', createdAt: T0, lastUpdate: T0, brands: [B1_SHAPE, B4_SHAPE], brandsEver: [] });
  assert.match(selectOf(calls, 'vendors')[0], /\bcontact_name, address_parts, social, logo_url, banner_url, woo_payment_methods, push_pending, woo_synced_at$/); // 0014: by name, never woo_snapshot
  assert.doesNotMatch(selectOf(calls, 'vendors')[0], /woo_snapshot/);
  assert.equal(selectOf(calls, 'vendor_rates')[0], 'id, vendor_id, rate, flat, since, set_by, created_at');
  assert.equal(selectOf(calls, 'vendor_category_rates')[0], 'id, vendor_id, woo_category_id, rate, flat, since, set_by, created_at');
  assert.equal(selectOf(calls, 'woo_categories')[0], 'id, name, slug, parent_id, updated_at');
  for (const t of ['brands', 'brand_owners', 'brand_rates']) for (const s of selectOf(calls, t)) assert.doesNotMatch(s, /\*/, t); // phase 3.2: column lists
  assert.equal(selectOf(calls, 'brands')[0], 'id, name, code, aliases, store_vendor_id, origin_vendor_id, created_by, created_at, updated_at');
  assert.equal(selectOf(calls, 'brand_owners')[0], 'id, brand_id, vendor_id, since, return_on, reason, set_by, created_at');
  assert.equal(selectOf(calls, 'brand_rates')[0], 'id, brand_id, rate, since, set_by, created_at');
  const a = S.get(V2);
  assert.deepEqual(plain([a.rate, a.rateSince, a.rateHistory.map((x) => x.rate)]), [45, '2026-10-01', [40, 45, 50]]); // the effective one today; a future row waits
  assert.deepEqual(plain(a.login), { username: 'antikiano', email: 'antikiano.dev@ibtekr.local', pwMode: 'temp', status: 'invited', mustChange: true, passwordSetAt: T0, inviteSentAt: null, hasPassword: true });
  assert.deepEqual(plain([S.get(V3).login.status, S.get(V3).login.hasPassword, S.get(V3).login.pwMode]), ['disabled', false, 'link']);
  assert.deepEqual(plain(a.contract), { fileName: 'antikiano.pdf', size: 980000, expires: '2026-11-15', uploadedBy: 'منى حسن', uploadedAt: T0, path: CONTRACT.path });
  assert.equal(a.joinedAt, '2026-10-20'); // no joined_at: the created_at date
  const b = S.get(V3);
  assert.deepEqual(plain([b.status, b.openingBalance, b.rate, b.rateHistory, b.bank]), ['inactive', 150, null, [], { method: 'bank', bankName: 'البنك الأهلي المصري', holder: 'Bian Egypt', iban: IBAN, wallet: null }]);
  assert.deepEqual(plain(S.all().map((v) => v.name)), ['Antikiano', 'Art Craft', 'Bian eg']);
  assert.deepEqual(V.data().ratesVisible, true);
});

test('rates refused (42501) or empty, bank empty → not visible / null, state ready (no error); without sensitive.commission the rates stay hidden', async () => {
  const r = load({ responses: { ...seed(), vendor_rates: denied(), vendor_bank: ok([]) } });
  await r.V.load();
  assert.equal(r.V.state(), 'ready');
  assert.deepEqual(plain([r.S.get(V1).rate, r.S.get(V1).rateHistory, r.S.get(V1).ratesVisible, r.S.get(V3).bank, r.V.data().ratesVisible]), [null, [], false, null, false]);
  const e = load({ responses: { ...seed(), vendor_rates: ok([]) } });
  await e.V.load();
  assert.deepEqual([e.S.get(V1).rate, e.S.get(V1).ratesVisible, e.V.data().ratesVisible], [null, true, true]); // admin, no rate yet: visible, «—»
  const ops = load({ admin: false });
  await ops.V.load();
  assert.deepEqual(plain([ops.S.get(V1).rate, ops.S.get(V1).rateHistory, ops.S.get(V1).ratesVisible]), [null, [], false]);
  const down = load({ responses: { ...seed(), vendors: { data: null, error: { code: 'PGRST000' } } } });
  await down.V.load();
  assert.equal(down.V.state(), 'error');
  assert.equal(down.V.data(), null);
});

test('toVendor (pure): aliases as text, defaults, a contract without a file name is none, a date column stays as is', () => {
  const { V } = load();
  const v = V.toVendor({ id: 'x', name: ' Zaan ', aliases: 'zana، Zaan ', status: 'weird', lead_days: null, joined_at: '2026-02-28', contract: { path: 'p' } }, [], null, { ratesVisible: true, today: '2026-10-25' });
  assert.deepEqual(plain([v.name, v.aliases, v.status, v.leadDays, v.joinedAt, v.contract, v.logoLetter, v.rate, v.rateHistory]), ['Zaan', ['zana', 'Zaan'], 'active', 7, '2026-02-28', null, 'Z', null, []]);
  const w = V.toVendor({ id: 'x', name: 'A', created_at: '2026-10-20T23:30:00+03:00' }, [{ vendor_id: 'x', rate: 30, since: '2026-11-01' }], null, { ratesVisible: true, today: '2026-10-25' });
  assert.deepEqual(plain([w.rate, w.rateSince, w.joinedAt]), [30, '2026-11-01', '2026-10-20']); // only a future rate: it is the one shown (prototype's rateAt)
});

test('lineShare (decision 4): total − (total × rate / 100 + fee); no rate → our rate on the order date when visible, else the full total marked noRate', () => {
  const { V } = load();
  const v = { ratesVisible: true, rate: 35, rateHistory: [{ rate: 30, since: '2026-01-01' }, { rate: 35, since: '2026-06-01' }] };
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: 35, fee: 0 }, v, '2026-10-19')), { share: 650, noRate: false });
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: 35, fee: 10 }, v, '2026-10-19')), { share: 640, noRate: false });
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: 40, fee: 10 }, v, '2026-10-19')), { share: 590, noRate: false });
  assert.deepEqual(plain(V.lineShare({ tot: '1000', rate: '35.00', fee: null }, v, '2026-10-19')), { share: 650, noRate: false });
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: null, fee: null }, v, '2026-10-19')), { share: 650, noRate: false }); // 35% since June
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: null, fee: null }, v, '2026-03-01')), { share: 700, noRate: false }); // 30% then
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: null, fee: null }, { ratesVisible: false, rate: null, rateHistory: [] }, '2026-10-19')), { share: 1000, noRate: true });
  assert.deepEqual(plain(V.lineShare({ tot: 1000 }, { ratesVisible: true, rate: null, rateHistory: [] }, '2026-10-19')), { share: 1000, noRate: true }); // visible but no rate yet
});

test('stats (decision 4 + 5): per vendor the orders (with his sales / share), open / late / lastAge, earned on the completed ones, pending on the open ones, noRate, balance = opening + earned, by status', async () => {
  const orders = [
    { id: '181668', st: 'مكتمل', date: '2026-10-19', subs: [{ vendor: 'Art Craft', tot: 1002, rate: 35, fee: 0 }, { vendor: 'Antikiano', tot: 2539, rate: 40, fee: 10 }] },
    { id: '180686', st: 'جاري التنفيذ', date: '2026-10-17', subs: [{ vendor: 'Art Craft', tot: 1002, rate: null, fee: null }] },
    { id: '180656', st: 'ملغي', date: '2026-10-15', subs: [{ vendor: 'Antikiano', tot: 899, rate: null, fee: null }] },
  ];
  const rows = [{ id: '181668', customer: 'سلوى', status: 'مكتمل', ageDays: 6, total: 3541, delivery: 'ok', vendors: ['Art Craft', 'Antikiano'] }, { id: '180686', customer: 'هدير', status: 'جاري التنفيذ', ageDays: 8, total: 1002, delivery: 'risk', vendors: ['Art Craft'] }, { id: '180656', customer: 'x', status: 'ملغي', ageDays: 10, total: 899, delivery: 'late', vendors: ['Antikiano'] }];
  const app = { query: () => ({ rows }) };
  const { V } = load({ orders: { orders }, app });
  await V.load();
  const st = plain(V.stats());
  const art = st[V1];
  assert.deepEqual(art.orders.map((o) => [o.id, o.sales, o.share]), [['181668', 1002, 651.3], ['180686', 1002, 651.3]]); // the open line has no rate: ours (35%) on its date
  assert.deepEqual({ open: art.open, late: art.late, lastAge: art.lastAge, sales: art.sales, earned: art.earned, ibtekrShare: art.ibtekrShare, pending: art.pending, pendingSales: art.pendingSales, noRate: art.noRate, balance: art.balance, openingBalance: art.openingBalance, deposits: art.deposits, transport: art.transport, tickets: art.tickets, seed: art.seed },
    { open: 1, late: 1, lastAge: 6, sales: 1002, earned: 651.3, ibtekrShare: 350.7, pending: 651.3, pendingSales: 1002, noRate: 0, balance: 651.3, openingBalance: 0, deposits: 0, transport: { total: 0, trips: 0, last: null }, tickets: [], seed: null });
  assert.deepEqual(art.byStatus, { c: [1, 1002, 651.3], p: [1, 1002, 651.3], x: [0, 0, 0] });
  const an = st[V2];
  assert.deepEqual([an.earned, an.pending, an.open, an.late, an.byStatus.x], [1513.4, 0, 0, 0, [1, 899, 494.45]]); // 2539 − (1015.6 + 10); the cancelled line: 45% since October
  assert.deepEqual([st[V3].orders, st[V3].balance, st[V3].lastAge], [[], 150, null]); // the opening balance alone
  const ops = load({ admin: false, orders: { orders }, app });
  await ops.V.load();
  const o = plain(ops.V.stats())[V1];
  assert.deepEqual([o.earned, o.pending, o.noRate, o.orders[1].share], [651.3, 1002, 1, 1002]); // the rates are hidden: the open line counts in full and is marked
});

test('safeName: [A-Za-z0-9._-] kept, the rest _, never empty or dot-led, at most 100 chars (the tail keeps the extension)', () => {
  const { V } = load();
  assert.equal(V.safeName('عقد بيان 2026.pdf'), '_'.repeat(9) + '2026.pdf'); // every Arabic letter and space → _
  assert.equal(V.safeName('Bian eg/contract (1).PDF'), 'Bian_eg_contract__1_.PDF');
  assert.equal(V.safeName('.hidden.pdf'), 'hidden.pdf');
  assert.equal(V.safeName(''), 'file');
  assert.equal(V.safeName('a'.repeat(120) + '.pdf').length, 100);
  assert.match(V.safeName('a'.repeat(120) + '.pdf'), /\.pdf$/);
});

test('findByName: the name or an alias, case / digits / separators normalised; unknown → null', async () => {
  const { S } = load();
  const { V, S: S2 } = load(); await V.load();
  assert.equal(S2.findByName('artcraft').id, V1);
  assert.equal(S2.findByName(' ART  CRAFT ').id, V1);
  assert.equal(S2.findByName('Art-Craft').id, V1);
  assert.equal(S2.findByName('آرت كرافت').id, V1);
  assert.equal(S2.findByName('bian_eg').id, V3);
  assert.equal(S2.findByName('nobody'), null);
  assert.equal(S2.findByName(''), null);
  assert.equal(S.findByName('Art Craft'), null); // nothing loaded
});

test('update: the local copy changes first, then one PATCH of the changed columns only (snake_case, no .select()), then the log with the vendor as entity and a reload', async () => {
  const { V, S, calls, logs, events } = load({ admin: false });
  await V.load(); calls.length = 0; events.length = 0;
  const out = S.update(V1, { phone: '٠١٠٠٠٠٠٠٠٠٩', email: ' new@ibtekr.local ', notes: 'الشحن على المبتكر', altPhone: '' }, S.actor());
  assert.deepEqual([out.phone, out.email, S.get(V1).phone], ['01000000009', 'new@ibtekr.local', '01000000009']); // at once
  assert.deepEqual(events[0], { type: 'ib:vendors', detail: { id: V1, changed: ['phone', 'email'] } }); // notes / altPhone unchanged: not sent
  await settle();
  const w = writesOf(calls, 'vendors');
  assert.deepEqual(w.slice(0, 2), [{ op: 'update', args: [{ phone: '01000000009', email: 'new@ibtekr.local' }] }, { op: 'eq', args: ['id', V1] }]);
  assert.notEqual(w[2] && w[2].args[0], 'id'); // no returning row: the next select is the reload's column list
  assert.deepEqual(logs, [['vendor.update', 'phone, email', { entity: 'vendor', entity_id: V1 }]]);
  assert.ok(events.some((e) => e.detail.written), 'announced after the reload');
  assert.equal(S.get(V1).phone, '01000000003'); // the stub's vendors answer is the seed: the reload is the server's truth
});

test('update refused (42501): the old value comes back, ib:vendors says forbidden, nothing logged; any other failure says network', async () => {
  const { V, S, responses, logs, events } = load({ admin: false });
  await V.load(); events.length = 0;
  responses.vendors = (ops) => (ops.some((c) => c.op === 'update') ? denied() : ok(VENDORS));
  S.update(V1, { name: 'Art Craft Studio' }, S.actor());
  assert.equal(S.get(V1).name, 'Art Craft Studio');
  await settle();
  assert.equal(S.get(V1).name, 'Art Craft');
  assert.deepEqual(events.filter((e) => e.detail.reason), [{ type: 'ib:vendors', detail: { id: V1, reason: 'forbidden' } }]);
  assert.deepEqual(logs, []);
  responses.vendors = (ops) => (ops.some((c) => c.op === 'update') ? { data: null, error: { code: 'PGRST000', message: 'down' } } : ok(VENDORS));
  S.update(V1, { phone: '01000000008' }, S.actor());
  await settle();
  assert.deepEqual([S.get(V1).phone, events.filter((e) => e.detail.reason).pop().detail.reason], ['01000000003', 'network']);
});

test('update validates like the prototype (the patched fields only) and throws before any write; a status change logs vendor.status; a rename reloads the orders', async () => {
  const { V, S, calls, logs } = load();
  await V.load(); calls.length = 0;
  assert.throws(() => S.update(V1, { phone: '123' }, S.actor()), /invalid vendor: phone/);
  assert.throws(() => S.update(V1, { category: 'غير موجودة' }, S.actor()), /invalid vendor: category/);
  assert.throws(() => S.update(V1, { joinedAt: '2026-13-01' }, S.actor()), /joinedAt/);
  assert.deepEqual(writesOf(calls, 'vendors'), []);
  S.update(V3, { status: 'active', phone: '01000000005' }, S.actor()); // Bian eg has no phone / category: only the patched fields are checked
  await settle();
  assert.deepEqual(logs.filter((l) => l[0] !== 'orders.load'), [['vendor.status', 'active', { entity: 'vendor', entity_id: V3 }], ['vendor.update', 'phone', { entity: 'vendor', entity_id: V3 }]]);
  logs.length = 0; calls.length = 0;
  S.update(V1, { name: 'Art Craft Studio', aliases: 'ArtCraft، Art Craft' }, S.actor());
  assert.deepEqual(plain([S.get(V1).logoLetter, S.get(V1).aliases]), ['A', ['ArtCraft', 'Art Craft']]);
  await settle();
  assert.ok(logs.some((l) => l[0] === 'orders.load'), 'IBOrders.load after a rename (the orders carry vendors.name)');
  assert.deepEqual(writesOf(calls, 'vendors').find((c) => c.op === 'update').args[0], { name: 'Art Craft Studio', aliases: ['ArtCraft', 'Art Craft'] });
});

test('canEdit / canBank / canToggle / canRate follow IBDirectory.perm; a write without the permission throws before anything is sent', async () => {
  const ops = load({ admin: false });
  await ops.V.load(); ops.calls.length = 0;
  assert.deepEqual([ops.S.canEdit(), ops.S.canBank(), ops.S.canToggle(), ops.S.canRate()], [true, false, false, false]);
  assert.throws(() => ops.S.setRate(V1, 30, '2026-11-01', ops.S.actor()), /مش من صلاحياتك/);
  assert.throws(() => ops.S.setBank(V1, { method: 'bank' }, ops.S.actor()), /مش من صلاحياتك/);
  assert.throws(() => ops.S.reveal(V3, 'iban', ops.S.actor()), /مش من صلاحياتك/);
  assert.throws(() => ops.S.remove(V1, ops.S.actor()), /مش من صلاحياتك/);
  assert.throws(() => ops.S.update(V1, { status: 'inactive' }, ops.S.actor()), /مش من صلاحياتك/); // the guard's rule 1, locally too
  assert.equal(ops.S.get(V1).status, 'active');
  assert.deepEqual(plain(await ops.V.contractUrl(V3)), { ok: false, reason: 'forbidden' }); // the Storage policies need the key: no request
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
  const acc = load({ admin: false, perms: ACCOUNTS });
  await acc.V.load();
  assert.deepEqual([acc.S.canEdit(), acc.S.canBank(), acc.S.canToggle(), acc.S.canRate()], [false, true, false, false]);
  assert.throws(() => acc.S.update(V1, { phone: '01000000009' }, acc.S.actor()), /مش من صلاحياتك/);
  const admin = load();
  await admin.V.load();
  assert.deepEqual([admin.S.canEdit(), admin.S.canBank(), admin.S.canToggle(), admin.S.canRate()], [true, true, true, true]);
  assert.deepEqual(plain(admin.S.actor()), { name: 'صفوت كمال', role: 'أدمن' });
});

test('setRate (decision 12): no date — the rate applies from today, a second change the same day replaces the day\'s row; one vendor_rate_set call each, the event carries the rate', async () => {
  const { V, S, calls, logs } = load();
  await V.load(); calls.length = 0;
  S.setRate(V1, '٤٠', '2026-11-01', S.actor()); // the old `since` argument is ignored
  assert.deepEqual(plain([S.get(V1).rate, S.get(V1).rateSince, S.get(V1).rateHistory.map((x) => x.rate + '@' + x.since)]), [40, TODAY_LOCAL, ['35@2026-03-01', '40@' + TODAY_LOCAL]]);
  S.setRate(V1, 45, null, S.actor());
  assert.deepEqual(plain([S.get(V1).rate, S.get(V1).rateHistory.map((x) => x.rate + '@' + x.since)]), [45, ['35@2026-03-01', '45@' + TODAY_LOCAL]]); // replaced, not refused
  await settle();
  assert.deepEqual(plain(rpcCalls(calls, 'vendor_rate_set')), [{ p_vendor: V1, p_rate: 40, p_flat: null }, { p_vendor: V1, p_rate: 45, p_flat: null }]);
  assert.deepEqual(opsOf(calls, 'vendor_rates').filter((c) => c.op === 'insert'), []); // never a direct insert
  assert.deepEqual(logs.filter((l) => l[0] === 'vendor.rate'), [['vendor.rate', '40%', { entity: 'vendor', entity_id: V1 }], ['vendor.rate', '45%', { entity: 'vendor', entity_id: V1 }]]);
  assert.throws(() => S.setRate(V1, 70, null, S.actor()), /rate out of range/);
});

test('setRate: the server refusing vendor_rate_set (42501) puts the history back and says why — nothing else is touched', async () => {
  const { V, S, responses, events } = load();
  await V.load();
  responses['rpc:vendor_rate_set'] = () => ({ data: null, error: { code: '42501', message: 'sensitive.commission = F is required to set a maker rate' } });
  S.setRate(V1, 42, null, S.actor());
  await settle();
  assert.deepEqual(plain(S.get(V1).rateHistory.map((x) => x.rate + '@' + x.since)), ['35@2026-03-01']);
  assert.deepEqual(events.filter((e) => e.detail && e.detail.reason).map((e) => e.detail.reason), ['forbidden']);
});

test('setBank: an insert for the first row, an update (vendor_id) after; the event names the method only — never the IBAN', async () => {
  const { V, S, calls, logs } = load({ admin: false, perms: ACCOUNTS });
  await V.load(); calls.length = 0;
  S.setBank(V1, { method: 'instapay', bankName: ' بنك مصر ', holder: 'Art Craft', iban: 'EG38 0003 0001 0000 0000 0000 0482', wallet: '٠١٠٠٠٠٠٠٠٠٣' }, S.actor());
  assert.deepEqual(plain(S.get(V1).bank), { method: 'instapay', bankName: 'بنك مصر', holder: 'Art Craft', iban: IBAN, wallet: '01000000003' });
  S.setBank(V3, { method: 'cash' }, S.actor());
  await settle();
  const w = opsOf(calls, 'vendor_bank').filter((c) => ['insert', 'update', 'eq'].includes(c.op));
  assert.equal(w[0].op, 'insert'); assert.deepEqual({ ...w[0].args[0], updated_at: 'x' }, { vendor_id: V1, method: 'instapay', bank_name: 'بنك مصر', holder: 'Art Craft', iban: IBAN, wallet: '01000000003', updated_by: 'سارة أحمد', updated_at: 'x' });
  assert.equal(w[1].op, 'update'); assert.deepEqual([w[1].args[0].method, w[1].args[0].vendor_id, w[2]], ['cash', undefined, { op: 'eq', args: ['vendor_id', V3] }]);
  assert.deepEqual(logs, [['vendor.bank', 'instapay', { entity: 'vendor', entity_id: V1 }], ['vendor.bank', 'cash', { entity: 'vendor', entity_id: V3 }]]);
  assert.doesNotMatch(JSON.stringify(logs), /0482/);
});

test('reveal: the value behind the mask, logged once per field until the drawer loads its events again; null without a value', async () => {
  const { V, S, logs } = load({ admin: false, perms: ACCOUNTS });
  await V.load();
  assert.equal(S.reveal(V3, 'iban', S.actor()), IBAN);
  assert.equal(S.reveal(V3, 'iban', S.actor()), IBAN); // a redraw
  assert.equal(S.reveal(V3, 'wallet', S.actor()), null);
  assert.equal(S.reveal(V1, 'iban', S.actor()), null);
  await settle();
  assert.deepEqual(logs, [['vendor.reveal', 'IBAN', { entity: 'vendor', entity_id: V3 }]]);
  await V.loadEvents(V3);
  S.reveal(V3, 'iban', S.actor());
  await settle();
  assert.equal(logs.length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /0482/);
});

test('setContract: type and size checked locally, the upload at <uuid>/<ms>-<safe name> (upsert false, the file\'s mime), then vendors.contract; a refused upload puts the old card back', async () => {
  const { V, S, calls, storage, logs, events, responses } = load({ admin: false, perms: ACCOUNTS });
  await V.load(); calls.length = 0;
  const file = (fileName, size) => ({ fileName, size, expires: '2027-10-01', file: { arrayBuffer: async () => new ArrayBuffer(size) } });
  assert.throws(() => S.setContract(V1, file('virus.exe', 100), S.actor()), /PDF/);
  assert.throws(() => S.setContract(V1, file('big.pdf', 10 * 1024 * 1024 + 1), S.actor()), /PDF/);
  assert.throws(() => S.setContract(V1, { fileName: '', size: 0 }, S.actor()), /اختار ملف العقد/);
  assert.throws(() => S.setContract(V1, { ...file('ok.pdf', 10), expires: '2026-02-30' }, S.actor()), /expires invalid/);
  assert.deepEqual(storage, []);
  S.setContract(V1, file('عقد Art Craft 2026.pdf', 2 * 1048576), S.actor());
  const c = S.get(V1).contract;
  assert.deepEqual([c.fileName, c.size, c.expires, c.uploadedBy, c.path], ['عقد Art Craft 2026.pdf', 2097152, '2027-10-01', 'سارة أحمد', null]); // at once, the file not up yet
  await settle();
  assert.equal(storage.length, 1);
  assert.match(storage[0].path, new RegExp('^' + V1 + '/' + NOW + '-____Art_Craft_2026\\.pdf$')); // «عقد » → ____
  assert.deepEqual([storage[0].bucket, storage[0].bytes, storage[0].opts], ['vendor-contracts', 2097152, { contentType: 'application/pdf', upsert: false }]);
  const up = writesOf(calls, 'vendors').find((x) => x.op === 'update').args[0];
  assert.deepEqual(up, { contract: { path: storage[0].path, file_name: 'عقد Art Craft 2026.pdf', size: 2097152, expires: '2027-10-01', uploaded_by: 'سارة أحمد', uploaded_at: new Date(NOW).toISOString() } });
  assert.deepEqual(logs, [['vendor.contract', 'PDF · 2.0 ميجا · حتى 2027-10-01', { entity: 'vendor', entity_id: V1 }]]);
  // the stored contract keeps its file; only the expiry changes → no upload, one update
  calls.length = 0; storage.length = 0; events.length = 0;
  S.setContract(V2, { fileName: 'antikiano.pdf', size: 980000, expires: '2027-01-01' }, S.actor());
  await settle();
  assert.deepEqual(storage, []);
  assert.deepEqual(writesOf(calls, 'vendors').find((x) => x.op === 'update').args[0].contract, { ...CONTRACT, expires: '2027-01-01' });
  // refused by storage (no sensitive.vendor_bank on the server): the card is back as it was
  responses['storage:upload'] = { data: null, error: { status: 403, statusCode: '403', message: 'new row violates row-level security policy' } };
  S.setContract(V1, file('again.png', 1000), S.actor());
  assert.equal(S.get(V1).contract.fileName, 'again.png');
  await settle();
  assert.equal(S.get(V1).contract, null);
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail), [{ id: V1, reason: 'forbidden' }]);
  responses['storage:upload'] = { data: null, error: { status: 413, statusCode: '413', message: 'too large' } };
  S.setContract(V1, file('again.jpg', 1000), S.actor()); await settle();
  assert.equal(events.filter((e) => e.detail.reason).pop().detail.reason, 'too_large');
});

test('contractUrl: a 60 s signed URL of the stored file; none without a stored file; the storage refusal is the reason', async () => {
  const { V, storage, responses } = load({ admin: false, perms: ACCOUNTS });
  await V.load();
  assert.deepEqual(plain(await V.contractUrl(V2)), { ok: true, url: 'https://proj.supabase.co/storage/v1/object/sign/vendor-contracts/' + CONTRACT.path + '?token=t' });
  assert.deepEqual(storage, [{ op: 'sign', bucket: 'vendor-contracts', path: CONTRACT.path, seconds: 60 }]);
  assert.deepEqual(plain(await V.contractUrl(V1)), { ok: false, reason: 'network' });
  responses['storage:sign'] = { data: null, error: { status: 400, statusCode: '403', message: 'Unauthorized' } };
  assert.deepEqual(plain(await V.contractUrl(V2)), { ok: false, reason: 'forbidden' });
});

test('remove (admin): the row goes locally, DELETE … select(id) confirms it; no row deleted → forbidden and the vendor is back; 23503 (orders) → in_use and back', async () => {
  const { V, S, calls, responses, logs, events } = load();
  await V.load(); calls.length = 0;
  responses.vendors = (ops) => (ops.some((c) => c.op === 'delete') ? ok([{ id: V3 }]) : ok(VENDORS.filter((v) => v.id !== V3)));
  assert.equal(S.remove(V3, S.actor()), true);
  assert.equal(S.get(V3), null);
  await settle();
  assert.deepEqual(writesOf(calls, 'vendors').slice(0, 3), [{ op: 'delete', args: [] }, { op: 'eq', args: ['id', V3] }, { op: 'select', args: ['id'] }]);
  assert.deepEqual(logs, [['vendor.remove', 'Bian eg', { entity: 'vendor', entity_id: V3 }]]);
  assert.equal(S.get(V3), null);
  responses.vendors = (ops) => (ops.some((c) => c.op === 'delete') ? ok([]) : ok(VENDORS)); // RLS: not admin on the server
  await V.load(); events.length = 0;
  S.remove(V1, S.actor()); await settle();
  assert.deepEqual([S.get(V1).name, events.filter((e) => e.detail.reason).map((e) => e.detail.reason)], ['Art Craft', ['forbidden']]);
  responses.vendors = (ops) => (ops.some((c) => c.op === 'delete') ? { data: null, error: { code: '23503', message: 'violates foreign key constraint' } } : ok(VENDORS));
  events.length = 0; S.remove(V1, S.actor()); await settle();
  assert.deepEqual([S.get(V1).name, events.filter((e) => e.detail.reason).map((e) => e.detail.reason)], ['Art Craft', ['in_use']]);
  assert.deepEqual(logs.length, 1);
});

test('create: one insert of the granted columns with .select(\'id\'), the first rate when the caller may set rates, a reload, the vendor back; refused → rejects with the message', async () => {
  const { V, S, calls, responses, logs } = load();
  await V.load(); calls.length = 0;
  const NEW = 'a0000000-0000-4000-8000-000000000009';
  responses.vendors = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS.concat([row({ id: NEW, name: 'zaan', category: 'هدايا', phone: '01000000009' })])));
  const input = { name: ' zaan ', category: 'هدايا', phone: '01000000009', rate: '40', leadDays: '7', status: 'active', aliases: 'zana، Zaan', legalName: '', email: '', address: '', instagram: '', storeUrl: '', depositPolicy: '', notes: '' };
  await assert.rejects(() => S.create({ ...input, phone: 'x' }, S.actor()), /invalid vendor: phone/);
  assert.deepEqual(writesOf(calls, 'vendors'), []);
  const { vendor: v, missing } = await S.create(input, S.actor());
  assert.deepEqual(plain([v.id, v.name, S.get(NEW).name, missing]), [NEW, 'zaan', 'zaan', []]);
  assert.deepEqual(opsOf(calls, 'vendor_logins').filter((c) => c.op === 'insert'), []); // no login asked: none written
  const ins = writesOf(calls, 'vendors');
  assert.deepEqual(ins[0], { op: 'insert', args: [{ name: 'zaan', category: 'هدايا', phone: '01000000009', status: 'active', lead_days: 7, aliases: ['zana', 'Zaan'], joined_at: '2026-10-25' }] });
  assert.deepEqual(ins[1], { op: 'select', args: ['id'] });
  assert.deepEqual(opsOf(calls, 'vendor_rates').filter((c) => c.op === 'insert').map((c) => c.args[0]), [{ vendor_id: NEW, rate: 40, since: '2026-10-25', set_by: 'صفوت كمال' }]);
  assert.deepEqual(logs, [['vendor.create', 'zaan', { entity: 'vendor', entity_id: NEW }], ['vendor.rate', '40% من 2026-10-25', { entity: 'vendor', entity_id: NEW }]]);
  responses.vendors = (ops) => (ops.some((c) => c.op === 'insert') ? denied() : ok(VENDORS));
  await assert.rejects(() => S.create(input, S.actor()), /مش من صلاحياتك/);
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  await assert.rejects(() => ops.S.create(input, ops.S.actor()), /مش من صلاحياتك/); // vendors_insert needs vendors.edit = F: refused before any request
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
  const vf = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } }); await vf.V.load(); vf.calls.length = 0;
  vf.responses.vendors = (o) => (o.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS));
  await vf.S.create(input, vf.S.actor());
  assert.deepEqual(writesOf(vf.calls, 'vendors')[0].op, 'insert');
  assert.deepEqual(opsOf(vf.calls, 'vendor_rates').filter((c) => c.op === 'insert'), []); // no sensitive.commission: the rate is not sent
});

test('loadEvents / events: that vendor\'s activity_log (entity vendor, newest 50) kept oldest first, with the actor\'s text', async () => {
  const rows = [{ id: 2, at: '2026-10-21T10:00:00+00:00', action: 'vendor.reveal', new_value: 'IBAN', actor: { name: 'منى حسن' } }, { id: 1, at: '2026-10-20T10:00:00+00:00', action: 'vendor.update', new_value: 'phone', actor: { name: 'سارة أحمد' } }];
  const { V, S, calls } = load({ responses: { ...seed(), activity_log: ok(rows) } });
  await V.load(); calls.length = 0;
  assert.deepEqual(plain(S.events(V1)), []);
  const ev = await V.loadEvents(V1);
  assert.deepEqual(opsOf(calls, 'activity_log'), [{ op: 'select', args: ['id, at, action, new_value, actor:profiles(name)'] }, { op: 'eq', args: ['entity', 'vendor'] }, { op: 'eq', args: ['entity_id', V1] }, { op: 'order', args: ['at', { ascending: false }] }, { op: 'limit', args: [50] }]);
  assert.deepEqual(plain(ev.map((e) => [e.at, e.text, e.actor.name])), [['2026-10-20T10:00:00+00:00', 'سارة أحمد عدّل بيانات المبتكر (phone)', 'سارة أحمد'], ['2026-10-21T10:00:00+00:00', 'منى حسن أظهر (IBAN)', 'منى حسن']]);
  assert.deepEqual(plain(S.events(V1)), plain(ev));
});

test('clear forgets everything (state idle); nothing is read or written while signed out', async () => {
  const { V, S, calls } = load();
  await V.load();
  V.clear();
  assert.deepEqual(plain([V.state(), S.all(), V.data()]), ['idle', [], null]);
  const out = load({ signedIn: false });
  await out.V.load();
  assert.deepEqual([out.V.state(), plain(out.calls)], ['idle', []]);
});

test('vendor_logins refused or empty → login null, state ready; a leave row reads as leave, an unknown status as active; toLogin defaults', async () => {
  const r = load({ responses: { ...seed(), vendor_logins: denied() } });
  await r.V.load();
  assert.deepEqual([r.V.state(), r.S.get(V2).login], ['ready', null]);
  const { V } = load();
  assert.equal(V.toVendor({ id: 'x', name: 'A', status: 'leave' }, [], null, { ratesVisible: true, today: '2026-10-25' }).status, 'leave');
  assert.equal(V.toVendor({ id: 'x', name: 'A', status: 'inactive' }, [], null, {}).status, 'inactive');
  assert.equal(V.toVendor({ id: 'x', name: 'A', status: 'vacation' }, [], null, {}).status, 'active');
  assert.deepEqual(plain(V.toVendor({ id: 'x', name: 'A' }, [], null, { login: { vendor_id: 'x', username: 'a.b', email: null, pw_mode: 'weird', status: 'nonsense', must_change: false, password_set_at: null } }).login), { username: 'a.b', email: null, pwMode: 'link', status: 'invited', mustChange: false, passwordSetAt: null, inviteSentAt: null, hasPassword: false });
  // «في إجازة» is a status change like any other: one PATCH, logged vendor.status (the admin may toggle)
  const a = load(); await a.V.load(); a.calls.length = 0;
  a.S.update(V1, { status: 'leave' }, a.S.actor()); await settle();
  assert.deepEqual(writesOf(a.calls, 'vendors').slice(0, 2), [{ op: 'update', args: [{ status: 'leave' }] }, { op: 'eq', args: ['id', V1] }]);
  assert.deepEqual(a.logs.filter((l) => l[0] === 'vendor.status'), [['vendor.status', 'leave', { entity: 'vendor', entity_id: V1 }]]);
});

test('create with a login and a bank: vendors → vendor_rates → vendor_logins → rpc (the temporary password) → vendor_bank, every step logged; { vendor, missing: [] }', async () => {
  const { V, S, calls, responses, logs } = load();
  await V.load(); calls.length = 0;
  const newLogin = { vendor_id: NEW, username: 'zaan', email: 'zaan.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: T0, created_by: 'صفوت كمال', created_at: T0, updated_at: T0 };
  responses.vendors = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS.concat([row({ id: NEW, name: 'zaan', category: 'هدايا', phone: '01000000009', email: 'zaan.dev@ibtekr.local' })])));
  responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'insert') ? ok([]) : ok(LOGINS.concat([newLogin])));
  responses['rpc:vendor_login_set_password'] = ok(T0);
  const out = await S.create({ ...BASE, login: { username: ' Zaan ', password: TEST_PW }, bank: { method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: 'eg38 0003 0001 0000 0000 0000 0482 1', wallet: '' } }, S.actor());
  assert.deepEqual(plain([out.vendor.id, out.missing, out.reasons]), [NEW, [], {}]);
  assert.deepEqual(calls.filter((c) => ['insert', 'rpc'].includes(c.op)).map((c) => c.table || c.op), ['vendors', 'vendor_rates', 'vendor_logins', 'rpc', 'vendor_bank']);
  assert.deepEqual(opsOf(calls, 'vendor_logins').find((c) => c.op === 'insert').args[0], { vendor_id: NEW, username: 'zaan', email: 'zaan.dev@ibtekr.local', pw_mode: 'temp', created_by: 'صفوت كمال' }); // created_by: the member's name (review A); pw_mode temp always (26 Oct)
  const b = opsOf(calls, 'vendor_bank').find((c) => c.op === 'insert').args[0];
  assert.deepEqual({ ...b, updated_at: 'x' }, { vendor_id: NEW, method: 'bank', bank_name: 'بنك مصر', holder: 'Zaan', iban: 'EG380003000100000000000004821', wallet: null, updated_by: 'صفوت كمال', updated_at: 'x' }); // the IBAN upper-cased
  assert.deepEqual(logs.map((l) => l[0]), ['vendor.create', 'vendor.rate', 'vendor.login', 'vendor.bank']);
  assert.deepEqual(plain(out.vendor.login), { username: 'zaan', email: 'zaan.dev@ibtekr.local', pwMode: 'temp', status: 'invited', mustChange: true, passwordSetAt: T0, inviteSentAt: null, hasPassword: true });
  // a login without a password is refused before any write (no invite link since 26 Oct)
  calls.length = 0;
  await assert.rejects(() => S.create({ ...BASE, login: { username: 'zaan', pwMode: 'link', password: '' } }, S.actor()), /invalid login: password/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  // a cash bank row carries no numbers; a bank the caller may not see is not sent (ops with vendors.edit = F)
  const vf = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } }); await vf.V.load(); vf.calls.length = 0;
  vf.responses.vendors = (o) => (o.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS));
  const o2 = await vf.S.create({ ...BASE, bank: { method: 'cash' } }, vf.S.actor());
  assert.deepEqual([plain(o2.missing), opsOf(vf.calls, 'vendor_bank').filter((c) => c.op === 'insert')], [[], []]);
});

test('create with a temporary password: the rpc right after the login insert; the password is in no other call, no log, no event, not kept; a weak one or a bad login is refused before any write', async () => {
  const { V, S, calls, responses, logs, events } = load();
  await V.load(); calls.length = 0; events.length = 0;
  responses.vendors = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS));
  responses['rpc:vendor_login_set_password'] = ok(T0);
  await assert.rejects(() => S.create({ ...BASE, login: { username: 'zaan', pwMode: 'temp', password: 'weak' } }, S.actor()), /invalid login: password/);
  await assert.rejects(() => S.create({ ...BASE, login: { username: 'zaan', pwMode: 'temp', password: 'Test1234' + 'x'.repeat(121) } }, S.actor()), /أطول من 128 حرف/);
  await assert.rejects(() => S.create({ ...BASE, login: { username: 'Za', password: TEST_PW } }, S.actor()), /invalid login: username/);
  await assert.rejects(() => S.create({ ...BASE, email: '', login: { username: 'zaan', password: TEST_PW } }, S.actor()), /invalid login: email/);
  await assert.rejects(() => S.create({ ...BASE, bank: { method: 'bank', holder: '', bankName: '', iban: '' } }, S.actor()), /invalid bank: holder,bankName,iban/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  const out = await S.create({ ...BASE, login: { username: 'zaan', pwMode: 'temp', password: TEST_PW } }, S.actor());
  assert.deepEqual(plain([out.vendor.id, out.missing]), [NEW, []]);
  assert.deepEqual(calls.filter((c) => c.op === 'rpc'), [{ op: 'rpc', args: ['vendor_login_set_password', { p_vendor: NEW, p_password: TEST_PW }] }]);
  assert.equal(opsOf(calls, 'vendor_logins').find((c) => c.op === 'insert').args[0].pw_mode, 'temp');
  assert.doesNotMatch(JSON.stringify(calls.filter((c) => c.op !== 'rpc')), new RegExp(TEST_PW));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(TEST_PW));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(TEST_PW));
  assert.doesNotMatch(JSON.stringify(plain([S.all(), out])), new RegExp(TEST_PW));
  assert.deepEqual(logs.map((l) => l[0]), ['vendor.create', 'vendor.rate', 'vendor.login']); // the password's event is the server's
});

test('create: a refused rate / login (23505 → duplicate_username) / password (0A000) / bank step leaves the vendor and names it in missing; a known duplicate username is refused locally', async () => {
  const { V, S, calls, responses, logs } = load();
  await V.load(); calls.length = 0;
  responses.vendors = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEW }) : ok(VENDORS));
  await assert.rejects(() => S.create({ ...BASE, login: { username: 'Antikiano', password: TEST_PW } }, S.actor()), /اسم المستخدم ده مستخدم قبل كده/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "vendor_logins_username_key"' } } : ok(LOGINS));
  responses.vendor_bank = (ops) => (ops.some((c) => c.op === 'insert') ? denied() : ok(BANK));
  const out = await S.create({ ...BASE, login: { username: 'zaan', pwMode: 'temp', password: TEST_PW }, bank: { method: 'cash' } }, S.actor());
  assert.deepEqual(plain([out.vendor.id, out.missing, out.reasons]), [NEW, ['login', 'bank'], { login: 'duplicate_username', bank: 'forbidden' }]);
  assert.deepEqual(calls.filter((c) => c.op === 'rpc'), []); // no password without a login row
  assert.deepEqual(logs.map((l) => l[0]), ['vendor.create', 'vendor.rate']);
  // the password step alone refused (no Vault on that server): the login row stays, the password is what is missing
  calls.length = 0; logs.length = 0; responses.vendor_logins = ok(LOGINS); responses.vendor_bank = ok(BANK);
  responses['rpc:vendor_login_set_password'] = { data: null, error: { code: '0A000', message: 'vault is not available' } };
  const o2 = await S.create({ ...BASE, login: { username: 'zaan', pwMode: 'temp', password: TEST_PW } }, S.actor());
  assert.deepEqual(plain([o2.missing, o2.reasons]), [['password'], { password: 'no_vault' }]);
  assert.match(V.MESSAGES.no_vault, /Vault/);
  assert.deepEqual(logs.map((l) => l[0]), ['vendor.create', 'vendor.rate', 'vendor.login']);
  // the first rate refused: named too, nothing else touched
  calls.length = 0; delete responses['rpc:vendor_login_set_password'];
  responses.vendor_rates = (ops) => (ops.some((c) => c.op === 'insert') ? denied() : ok(RATES));
  const o3 = await S.create(BASE, S.actor());
  assert.deepEqual(plain([o3.vendor.id, o3.missing, o3.reasons]), [NEW, ['rate'], { rate: 'forbidden' }]);
});

test('addLogin (the drawer, a maker without a row): the insert (vendor_id, username, email, pw_mode temp, created_by = the member\'s name) then the rpc with the password; validated locally before any write; a duplicate refused locally and by 23505; a refused password leaves the row and is what is missing', async () => {
  const { V, S, calls, responses, logs, events } = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } });
  await V.load(); calls.length = 0;
  await assert.rejects(() => S.addLogin(V1, { username: 'ab', email: 'x', password: TEST_PW }, S.actor()), /invalid login: username,email/);
  await assert.rejects(() => S.addLogin(V1, { username: 'art.craft', email: 'art.dev@ibtekr.local', password: 'weak' }, S.actor()), /invalid login: password/);
  await assert.rejects(() => S.addLogin(V1, { username: 'art.craft', email: 'art.dev@ibtekr.local', password: TEST_PW + 'x'.repeat(121) }, S.actor()), /أطول من 128 حرف/);
  await assert.rejects(() => S.addLogin(V1, { username: 'Antikiano', email: 'a@b.co', password: TEST_PW }, S.actor()), /اسم المستخدم ده مستخدم قبل كده/);
  await assert.rejects(() => S.addLogin(V2, { username: 'antikiano', email: 'a@b.co', password: TEST_PW }, S.actor()), /عنده بيانات دخول/); // a row exists: setLogin's job
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  const newLogin = { vendor_id: V1, username: 'art.craft', email: 'art.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: T0, created_by: 'سارة أحمد', created_at: T0, updated_at: T0 };
  responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'insert') ? ok([]) : ok(LOGINS.concat([newLogin])));
  responses['rpc:vendor_login_set_password'] = ok(T0);
  const out = await S.addLogin(V1, { username: ' Art.Craft ', email: ' art.dev@ibtekr.local ', password: TEST_PW }, S.actor());
  assert.deepEqual(plain([out.missing, out.reasons, out.vendor.login]), [[], {}, { username: 'art.craft', email: 'art.dev@ibtekr.local', pwMode: 'temp', status: 'invited', mustChange: true, passwordSetAt: T0, inviteSentAt: null, hasPassword: true }]);
  assert.deepEqual(calls.filter((c) => ['insert', 'rpc'].includes(c.op)).map((c) => (c.op === 'rpc' ? c.args : c.args[0])), [{ vendor_id: V1, username: 'art.craft', email: 'art.dev@ibtekr.local', pw_mode: 'temp', created_by: 'سارة أحمد' }, ['vendor_login_set_password', { p_vendor: V1, p_password: TEST_PW }]]);
  assert.deepEqual(logs, [['vendor.login', 'username, email', { entity: 'vendor', entity_id: V1 }]]);
  assert.ok(!JSON.stringify([logs, events.map((e) => e.detail)]).includes(TEST_PW));
  // 23505 from the server (taken meanwhile): rejects with the message, no rpc; a server without Vault: the row stays, the password is what is missing
  calls.length = 0; logs.length = 0; responses.vendor_logins = ok(LOGINS); await V.load(); // V1 without a row again
  responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "vendor_logins_username_key"' } } : ok(LOGINS));
  await assert.rejects(() => S.addLogin(V1, { username: 'art.craft', email: 'art.dev@ibtekr.local', password: TEST_PW }, S.actor()), /اسم المستخدم ده مستخدم قبل كده/);
  assert.deepEqual(calls.filter((c) => c.op === 'rpc'), []);
  calls.length = 0; responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'insert') ? ok([]) : ok(LOGINS.concat([{ ...newLogin, password_set_at: null }])));
  responses['rpc:vendor_login_set_password'] = { data: null, error: { code: '0A000', message: 'vault is not available' } };
  const o2 = await S.addLogin(V1, { username: 'art.craft', email: 'art.dev@ibtekr.local', password: TEST_PW }, S.actor());
  assert.deepEqual(plain([o2.missing, o2.reasons, o2.vendor.login.hasPassword]), [['password'], { password: 'no_vault' }, false]);
  assert.deepEqual(logs, [['vendor.login', 'username, email', { entity: 'vendor', entity_id: V1 }]]);
});

test('setLogin: the changed columns of an existing row (a PATCH, no .select()); a maker without a row → no_login (addLogin is the way); validated locally; a duplicate refused locally; 23505 → duplicate_username and the row back', async () => {
  const { V, S, calls, responses, logs, events } = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } });
  await V.load(); calls.length = 0;
  assert.throws(() => S.setLogin(V1, { username: 'art.craft', email: 'art.dev@ibtekr.local' }, S.actor()), /اعمل اسم مستخدم الأول/); // no row (no_login)
  assert.throws(() => S.setLogin(V2, { username: 'ab', email: 'x' }, S.actor()), /invalid login: username,email/);
  assert.throws(() => S.setLogin(V2, { username: 'Bian.eg', email: 'a@b.co' }, S.actor()), /اسم المستخدم ده مستخدم قبل كده/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  // an existing row: the e-mail alone changes → one PATCH of email (no .select())
  calls.length = 0; logs.length = 0;
  S.setLogin(V2, { username: 'antikiano', email: 'new.dev@ibtekr.local' }, S.actor());
  await settle();
  assert.deepEqual(opsOf(calls, 'vendor_logins').filter((c) => ['update', 'eq', 'insert'].includes(c.op)), [{ op: 'update', args: [{ email: 'new.dev@ibtekr.local' }] }, { op: 'eq', args: ['vendor_id', V2] }]);
  assert.deepEqual(logs, [['vendor.login', 'email', { entity: 'vendor', entity_id: V2 }]]);
  calls.length = 0; S.setLogin(V2, { username: 'antikiano', email: 'antikiano.dev@ibtekr.local' }, S.actor()); await settle(); // nothing changed: nothing sent
  assert.deepEqual(opsOf(calls, 'vendor_logins').filter((c) => c.op === 'update'), []);
  // 23505 from the server (taken meanwhile): the old username back, the reason duplicate_username
  events.length = 0;
  responses.vendor_logins = (ops) => (ops.some((c) => c.op === 'update') ? { data: null, error: { code: '23505', message: 'duplicate key' } } : ok(LOGINS));
  S.setLogin(V2, { username: 'taken.name', email: 'antikiano.dev@ibtekr.local' }, S.actor());
  assert.equal(S.get(V2).login.username, 'taken.name');
  await settle();
  assert.equal(S.get(V2).login.username, 'antikiano');
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail.reason), ['duplicate_username']);
  assert.equal(V.MESSAGES.duplicate_username, 'اسم المستخدم ده مستخدم قبل كده');
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0; // vendors.edit = P: refused before any request
  assert.throws(() => ops.S.setLogin(V1, { username: 'art.craft', email: 'a@b.co' }, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
});

test('setLoginStatus: invited / disabled only, one PATCH of status, logged vendor.login.status; refused without a login row or the permission', async () => {
  const { S, V, calls, logs } = load();
  await V.load(); calls.length = 0;
  assert.throws(() => S.setLoginStatus(V2, 'active', S.actor()), /bad status/);
  assert.throws(() => S.setLoginStatus(V1, 'disabled', S.actor()), /اعمل اسم مستخدم الأول/);
  S.setLoginStatus(V2, 'disabled', S.actor());
  assert.equal(S.get(V2).login.status, 'disabled');
  await settle();
  assert.deepEqual(opsOf(calls, 'vendor_logins').filter((c) => ['update', 'eq'].includes(c.op)), [{ op: 'update', args: [{ status: 'disabled' }] }, { op: 'eq', args: ['vendor_id', V2] }]);
  assert.deepEqual(logs, [['vendor.login.status', 'disabled', { entity: 'vendor', entity_id: V2 }]]);
  calls.length = 0; S.setLoginStatus(V3, 'disabled', S.actor()); await settle(); // already disabled: nothing sent
  assert.deepEqual(opsOf(calls, 'vendor_logins').filter((c) => c.op === 'update'), []);
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  assert.throws(() => ops.S.setLoginStatus(V2, 'disabled', ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
});

test('setLoginPassword / revealPassword: the two RPCs; the password in the rpc only, never kept, nothing logged here (the server logs); refused → the reason\'s message; ops refused before any request', async () => {
  const { V, S, calls, responses, logs, events } = load();
  await V.load(); calls.length = 0;
  await assert.rejects(() => S.setLoginPassword(V1, TEST_PW, S.actor()), /اعمل اسم مستخدم الأول/);
  await assert.rejects(() => S.setLoginPassword(V2, 'short', S.actor()), /الباسورد لازم: 8 حروف على الأقل، رقم/);
  await assert.rejects(() => S.setLoginPassword(V2, 'Test1234' + 'x'.repeat(121), S.actor()), /أطول من 128 حرف/); // the server's cap, checked first
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  responses['rpc:vendor_login_set_password'] = ok('2026-10-25T10:00:00+00:00');
  assert.equal(await S.setLoginPassword(V2, TEST_PW, S.actor()), '2026-10-25T10:00:00+00:00');
  assert.deepEqual(calls.filter((c) => c.op === 'rpc'), [{ op: 'rpc', args: ['vendor_login_set_password', { p_vendor: V2, p_password: TEST_PW }] }]);
  assert.doesNotMatch(JSON.stringify(calls.filter((c) => c.op !== 'rpc')), new RegExp(TEST_PW));
  assert.deepEqual(logs, []); assert.doesNotMatch(JSON.stringify(events), new RegExp(TEST_PW));
  assert.ok(events.some((e) => e.detail.written), 'reloaded after the rpc');
  assert.doesNotMatch(JSON.stringify(plain(S.all())), new RegExp(TEST_PW));
  calls.length = 0;
  responses['rpc:vendor_login_reveal'] = ok(TEST_PW);
  assert.equal(await S.revealPassword(V2, S.actor()), TEST_PW);
  assert.deepEqual(calls.filter((c) => c.op === 'rpc'), [{ op: 'rpc', args: ['vendor_login_reveal', { p_vendor: V2 }] }]);
  assert.equal(await S.revealPassword(V3, S.actor()), null); // no temporary password set: no request
  assert.equal(calls.filter((c) => c.op === 'rpc').length, 1);
  assert.deepEqual(logs, []); assert.doesNotMatch(JSON.stringify(plain(S.all())), new RegExp(TEST_PW));
  responses['rpc:vendor_login_set_password'] = { data: null, error: { code: '22023', message: 'weak password' } };
  await assert.rejects(() => S.setLoginPassword(V2, TEST_PW, S.actor()), /الباسورد لازم/);
  responses['rpc:vendor_login_set_password'] = { data: null, error: { code: '0A000', message: 'vault is not available' } };
  await assert.rejects(() => S.setLoginPassword(V2, TEST_PW, S.actor()), /Vault/);
  responses['rpc:vendor_login_reveal'] = { data: null, error: { code: '42501', message: 'permission denied' } };
  await assert.rejects(() => S.revealPassword(V2, S.actor()), /مش من صلاحياتك/);
  responses['rpc:vendor_login_reveal'] = { data: null, error: { code: 'P0002', message: 'vendor login not found' } }; // the row went meanwhile
  await assert.rejects(() => S.revealPassword(V2, S.actor()), /اعمل اسم مستخدم الأول/);
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  await assert.rejects(() => ops.S.setLoginPassword(V2, TEST_PW, ops.S.actor()), /مش من صلاحياتك/);
  await assert.rejects(() => ops.S.revealPassword(V2, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
});

test('canLogin (admin or vendors.edit = F), usernameTaken (case-insensitive, exceptId), missing (login / e-mail / bank — the bank only when the caller sees bank rows)', async () => {
  const admin = load(); await admin.V.load();
  assert.equal(admin.S.canLogin(), true);
  assert.deepEqual([admin.S.usernameTaken('ANTIKIANO'), admin.S.usernameTaken('antikiano', V2), admin.S.usernameTaken('bian.eg', V2), admin.S.usernameTaken(''), admin.S.usernameTaken('nobody')], [true, false, true, false, false]);
  assert.deepEqual(plain([admin.S.missing(V1), admin.S.missing(V2), admin.S.missing(V3)]), [['بيانات الدخول', 'الإيميل', 'الحساب البنكي'], ['الحساب البنكي'], []]);
  const ops = load({ admin: false }); await ops.V.load();
  assert.deepEqual(plain([ops.S.canLogin(), ops.S.missing(V1)]), [false, ['بيانات الدخول', 'الإيميل']]); // no sensitive.vendor_bank: the bank is not judged
  const vf = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } }); await vf.V.load();
  assert.equal(vf.S.canLogin(), true);
  const acc = load({ admin: false, perms: ACCOUNTS }); await acc.V.load();
  assert.deepEqual(plain([acc.S.canLogin(), acc.S.missing(V2)]), [false, ['الحساب البنكي']]);
});

// ---------- phase 3.2: the brands ----------
test('brands: the shape on each maker (held today / held before), the rates only with sensitive.commission (no request without it), a refused read is no error', async () => {
  const { V, S, calls } = load({ responses: { ...seed(), brand_owners: ok(OWNERS.concat([TRANSFER])), brand_rates: ok([{ id: 1, brand_id: B2, rate: 30, since: '2026-10-01', set_by: 'منى حسن', created_at: T0 }, { id: 2, brand_id: B2, rate: null, since: '2027-01-01', set_by: 'منى حسن', created_at: T0 }]) } });
  await V.load();
  assert.deepEqual(plain(S.get(V3).brands), [{ id: B2, name: 'Antikiano', code: 'A', aliases: ['Antikiano store'], since: '2026-10-18', returnOn: '2026-11-20', temp: true, rate: 30, store: V2, origin: V2, owner: V3, lastSince: '2026-10-18', back: V2 },
    { id: B3, name: 'Bian eg', code: 'B', aliases: [], since: '2026-03-01', returnOn: null, temp: false, rate: null, store: V3, origin: V3, owner: V3, lastSince: '2026-03-01', back: V3 }]);
  assert.deepEqual(plain(S.get(V2).brands), []);
  assert.deepEqual(plain(S.get(V2).brandsEver), [{ id: B2, name: 'Antikiano', code: 'A', aliases: ['Antikiano store'], since: '2026-10-18', returnOn: '2026-11-20', temp: true, rate: 30, store: V2, origin: V2, owner: V3, lastSince: '2026-10-18', back: V2, until: '2026-10-18', now: 'Bian eg' }]);
  assert.deepEqual(plain([S.ownerAt(B2, '2026-10-17'), S.ownerAt(B2, '2026-10-18'), S.ownerAt(B2), S.ownerAt(B2, '2025-01-01'), S.ownerAt('nope')]), [V2, V3, V3, V2, null]); // before the history: the first owner
  assert.deepEqual(plain([S.storeOwnerAt(V2, '2026-10-17'), S.storeOwnerAt(V2, '2026-10-19'), S.storeOwnerAt(V1, '2026-10-19'), S.storeOwnerAt('no-store', '2026-10-19')]), [V2, V3, V1, 'no-store']);
  assert.deepEqual(plain(S.namesOf(V3)), ['Bian eg', 'Antikiano', 'Antikiano store']); // his own, then the brand he holds
  assert.deepEqual(plain(S.namesOf(V1)), ['Art Craft', 'ArtCraft', 'آرت كرافت', 'Wood & Rope', 'W&R']);
  assert.deepEqual(plain([S.brandByName('antikiano store').id, S.brandByName(' W&R ').id, S.brandByName('nobody'), S.brandByName('')]), [B2, B4, null, null]);
  assert.deepEqual(plain(V.data().brands.map((b) => b.name)), ['Antikiano', 'Art Craft', 'Bian eg', 'Wood & Rope']);
  // rateFor: the special rate in force beats the owner's; null from 2027 → the owner's rate that day; a store without a brand: its own rate
  assert.deepEqual([S.rateFor(V2, '2026-10-19'), S.rateFor(V2, '2026-09-30'), S.rateFor(V2, '2027-01-05'), S.rateFor(V1, '2026-10-19'), S.rateFor(V3, '2026-10-19'), S.rateFor('no-store', '2026-10-19')], [30, 40, null, 35, null, null]); // 2026-09-30: before the first special row → Antikiano's own rate that day (review I1); 2027: Bian eg has no rate
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: null, fee: null, vendorId: V2 }, S.get(V3), '2026-10-19')), { share: 700, noRate: false });
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: null, fee: null, vendorId: V2 }, S.get(V3), '2027-01-05')), { share: 1000, noRate: true }); // no special rate any more, the holder has none
  assert.deepEqual(plain(V.lineShare({ tot: 1000, rate: 40, fee: 10, vendorId: V2 }, S.get(V3), '2026-10-19')), { share: 590, noRate: false }); // the website's rate on the line wins
  const ops = load({ admin: false, responses: { ...seed(), brand_rates: ok([{ id: 1, brand_id: B2, rate: 30, since: '2026-10-01' }]) } });
  await ops.V.load();
  assert.deepEqual(selectOf(ops.calls, 'brand_rates'), []); // no sensitive.commission: not asked
  assert.deepEqual(plain([ops.S.get(V2).brands[0].rate, ops.S.rateFor(V2, '2026-10-19')]), [null, null]);
  const refused = load({ responses: { ...seed(), brand_rates: denied() } });
  await refused.V.load();
  assert.deepEqual([refused.V.state(), refused.S.get(V2).brands[0].rate, refused.S.rateFor(V2, '2026-10-19')], ['ready', null, 45]); // the brand rates unknown: the owner's rate
  const noBrands = load({ responses: { ...seed(), brands: denied(), brand_owners: denied() } });
  await noBrands.V.load();
  assert.deepEqual([noBrands.V.state(), plain(noBrands.S.get(V1).brands), noBrands.S.storeOwnerAt(V2, '2026-10-19')], ['ready', [], V2]);
});

test('addBrand: brands (insert + select id) → brand_owners (since = the maker\'s joining date) → brand_rates (a special rate, canRate); logged; local refusals before any request; a later step refused is named in missing', async () => {
  const { V, S, calls, responses, logs } = load();
  await V.load(); calls.length = 0;
  await assert.rejects(() => S.addBrand(V1, { name: '', code: '', aliases: '', rate: '' }, S.actor()), /invalid brand: name/);
  await assert.rejects(() => S.addBrand(V1, { name: 'Zaan', code: 'ZAAN' }, S.actor()), /invalid brand: code/);
  await assert.rejects(() => S.addBrand(V1, { name: 'Zaan', rate: '70' }, S.actor()), /invalid brand: rate/);
  await assert.rejects(() => S.addBrand(V1, { name: ' antikiano ' }, S.actor()), /فيه براند بنفس الاسم/);
  await assert.rejects(() => S.addBrand(V1, { name: 'w&r' }, S.actor()), /فيه براند بنفس الاسم/); // an alias too
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  responses.brands = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEWB }) : ok(BRANDS.concat([brandRow({ id: NEWB, name: 'Zaan', code: 'Z', aliases: ['zana'], origin_vendor_id: V1, created_by: 'صفوت كمال' })])));
  responses.brand_owners = (ops) => (ops.some((c) => c.op === 'insert') ? ok([]) : ok(OWNERS.concat([ownerRow(9, NEWB, V1, '2026-03-01', { set_by: 'صفوت كمال' })])));
  const out = await S.addBrand(V1, { name: ' Zaan ', code: ' z ', aliases: 'zana', rate: '٣٠' }, S.actor());
  assert.deepEqual(plain([out.missing, out.reasons, out.brand.name, out.brand.code, out.brand.owner, out.brand.since]), [[], {}, 'Zaan', 'Z', V1, '2026-03-01']);
  assert.deepEqual(calls.filter((c) => c.op === 'insert').map((c) => [c.table, c.args[0]]), [['brands', { name: 'Zaan', code: 'Z', aliases: ['zana'], origin_vendor_id: V1, created_by: 'صفوت كمال' }], ['brand_owners', { brand_id: NEWB, vendor_id: V1, since: '2026-03-01', set_by: 'صفوت كمال' }], ['brand_rates', { brand_id: NEWB, rate: 30, since: '2026-03-01', set_by: 'صفوت كمال' }]]);
  assert.deepEqual(opsOf(calls, 'brands').slice(0, 3).map((c) => c.op), ['insert', 'select', 'single']);
  assert.deepEqual(logs, [['vendor.brand', 'add: Zaan', { entity: 'vendor', entity_id: V1 }], ['vendor.brand.rate', 'Zaan: 30% من 2026-03-01', { entity: 'vendor', entity_id: V1 }]]);
  assert.deepEqual(plain(S.get(V1).brands.map((b) => b.name)), ['Art Craft', 'Wood & Rope', 'Zaan']);
  // the code suggested from the name when blank; no rate → no brand_rates row; a given since
  calls.length = 0; logs.length = 0;
  await S.addBrand(V2, { name: 'مبتكر جديد', aliases: '', rate: '', since: '2026-10-01' }, S.actor());
  assert.deepEqual(calls.filter((c) => c.op === 'insert').map((c) => [c.table, c.args[0].code || c.args[0].since]), [['brands', 'X'], ['brand_owners', '2026-10-01']]);
  // the server's 23505 on the name index → the message; nothing else written
  calls.length = 0;
  responses.brands = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brands_name_key"' } } : ok(BRANDS));
  await assert.rejects(() => S.addBrand(V1, { name: 'Taken meanwhile' }, S.actor()), /فيه براند بنفس الاسم/);
  assert.deepEqual(calls.filter((c) => c.op === 'insert').map((c) => c.table), ['brands']);
  // the owner row refused after the brand's insert: named in missing, the brand stays
  calls.length = 0; logs.length = 0;
  responses.brands = (ops) => (ops.some((c) => c.op === 'insert') ? ok({ id: NEWB }) : ok(BRANDS));
  responses.brand_owners = (ops) => (ops.some((c) => c.op === 'insert') ? denied() : ok(OWNERS));
  const o2 = await S.addBrand(V1, { name: 'Zaan 2', rate: '' }, S.actor());
  assert.deepEqual(plain([o2.missing, o2.reasons]), [['owner'], { owner: 'forbidden' }]);
  assert.equal(V.MESSAGES.brand_exists, 'فيه براند بنفس الاسم — اختار اسم تاني');
  // ops (vendors.edit = P) and accounts: refused before any request; vendors.edit = F may
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  await assert.rejects(() => ops.S.addBrand(V1, { name: 'Zaan' }, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual([ops.S.canBrands(), ops.calls.filter((c) => c.op !== 'from')], [false, []]);
  const vf = load({ admin: false, perms: { ...OPS, 'vendors.edit': 'F' } }); await vf.V.load();
  assert.equal(vf.S.canBrands(), true);
  vf.calls.length = 0; vf.responses.brands = (o) => (o.some((c) => c.op === 'insert') ? ok({ id: NEWB }) : ok(BRANDS));
  await vf.S.addBrand(V1, { name: 'Zaan', rate: '30' }, vf.S.actor());
  assert.deepEqual(vf.calls.filter((c) => c.op === 'insert').map((c) => c.table), ['brands', 'brand_owners']); // no sensitive.commission: the rate is not sent
});

test('updateBrand: name / code / aliases, the changed columns only (a PATCH, no .select()), logged on the owner today; a taken name refused locally; 42501 puts the brand back', async () => {
  const { V, S, calls, logs, events, responses } = load();
  await V.load(); calls.length = 0; events.length = 0;
  assert.throws(() => S.updateBrand(B1, { name: '' }, S.actor()), /invalid brand: name/);
  assert.throws(() => S.updateBrand(B1, { name: 'Antikiano Store' }, S.actor()), /فيه براند بنفس الاسم/);
  assert.throws(() => S.updateBrand('nope', { name: 'x' }, S.actor()), /brand not found/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  assert.deepEqual(plain(S.updateBrand(B1, { name: 'Art Craft', code: 'A', aliases: 'ArtCraft، آرت كرافت' }, S.actor())), B1_SHAPE); // nothing changed: nothing sent
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  const out = S.updateBrand(B1, { name: ' Art Craft Studio ', code: 'ac', aliases: 'ArtCraft، آرت كرافت' }, S.actor());
  assert.deepEqual(plain([out.name, out.code, S.get(V1).brands[0].name]), ['Art Craft Studio', 'AC', 'Art Craft Studio']); // at once
  assert.deepEqual(events[0], { type: 'ib:vendors', detail: { id: V1, changed: ['brands'] } });
  await settle();
  assert.deepEqual(writesOf(calls, 'brands').slice(0, 2), [{ op: 'update', args: [{ name: 'Art Craft Studio', code: 'AC' }] }, { op: 'eq', args: ['id', B1] }]);
  assert.notEqual(writesOf(calls, 'brands')[2] && writesOf(calls, 'brands')[2].args[0], 'id');
  assert.deepEqual(logs, [['vendor.brand', 'update: Art Craft Studio (name, code)', { entity: 'vendor', entity_id: V1 }]]);
  assert.equal(S.get(V1).brands[0].name, 'Art Craft'); // the reload: the stub serves the seed
  calls.length = 0; logs.length = 0; events.length = 0;
  responses.brands = (ops) => (ops.some((c) => c.op === 'update') ? denied() : ok(BRANDS));
  S.updateBrand(B1, { aliases: 'AC' }, S.actor());
  assert.deepEqual(plain(S.get(V1).brands[0].aliases), ['AC']);
  await settle();
  assert.deepEqual(plain([S.get(V1).brands[0].aliases, events.filter((e) => e.detail.reason).map((e) => e.detail), logs]), [['ArtCraft', 'آرت كرافت'], [{ id: V1, reason: 'forbidden' }], []]);
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  assert.throws(() => ops.S.updateBrand(B1, { name: 'x' }, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
});

test('setBrandRate: a dated row (null = no special rate), one insert into brand_rates, logged on the owner with the rate and date; the same date refused locally; sensitive.commission required', async () => {
  const { V, S, calls, logs, responses, events } = load();
  await V.load(); calls.length = 0;
  assert.throws(() => S.setBrandRate(B2, 70, '2026-11-01', S.actor()), /rate out of range/);
  assert.throws(() => S.setBrandRate(B2, 30, '2026-11-31', S.actor()), /since required/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  const out = S.setBrandRate(B2, '٣٠', '2026-10-01', S.actor());
  assert.deepEqual([out.rate, S.get(V2).brands[0].rate, S.rateFor(V2, '2026-10-19')], [30, 30, 30]); // at once
  assert.throws(() => S.setBrandRate(B2, 35, '2026-10-01', S.actor()), /فيه نسبة متسجلة بنفس تاريخ السريان/);
  S.setBrandRate(B2, '', '2026-12-01', S.actor()); // none from December
  assert.deepEqual([S.rateFor(V2, '2026-12-05'), S.rateFor(V2, '2026-11-05')], [45, 30]);
  await settle();
  assert.deepEqual(opsOf(calls, 'brand_rates').filter((c) => c.op === 'insert').map((c) => c.args[0]), [{ brand_id: B2, rate: 30, since: '2026-10-01', set_by: 'صفوت كمال' }, { brand_id: B2, rate: null, since: '2026-12-01', set_by: 'صفوت كمال' }]);
  assert.deepEqual(opsOf(calls, 'brand_rates').filter((c) => c.op === 'select' && c.args[0] === 'id'), []);
  assert.deepEqual(logs, [['vendor.brand.rate', 'Antikiano: 30% من 2026-10-01', { entity: 'vendor', entity_id: V2 }], ['vendor.brand.rate', 'Antikiano: — من 2026-12-01', { entity: 'vendor', entity_id: V2 }]]);
  events.length = 0;
  responses.brand_rates = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brand_rates_brand_id_since_key"' } } : ok([]));
  S.setBrandRate(B2, 20, '2026-10-05', S.actor()); await settle();
  assert.deepEqual([S.get(V2).brands[0].rate, events.filter((e) => e.detail.reason).map((e) => e.detail.reason)], [null, ['duplicate']]);
  const acc = load({ admin: false, perms: ACCOUNTS }); await acc.V.load(); acc.calls.length = 0;
  assert.throws(() => acc.S.setBrandRate(B2, 30, '2026-10-01', acc.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(acc.calls.filter((c) => c.op !== 'from'), []);
});

test('transferBrand: the local rules first (the same maker, a date before the last transfer, a return date not after the start — no request), then one brand_owners insert and two events (one per maker); the server\'s 22023 puts the history back', async () => {
  const { V, S, calls, logs, events, responses } = load({ responses: { ...seed(), brand_owners: ok(OWNERS.concat([TRANSFER])) } });
  await V.load(); calls.length = 0;
  assert.throws(() => S.transferBrand(B2, V3, { since: '2026-10-25' }, S.actor()), /البراند أصلًا عند المبتكر ده/);
  assert.throws(() => S.transferBrand(B2, V1, { since: '2026-10-10' }, S.actor()), /قبل آخر نقل للبراند \(2026-10-18\)/);
  assert.throws(() => S.transferBrand(B2, V1, { since: '2026-10-25', returnOn: '2026-10-25' }, S.actor()), /تاريخ الرجوع لازم يكون بعد تاريخ البداية/);
  assert.throws(() => S.transferBrand(B2, V1, { since: 'x' }, S.actor()), /اكتب تاريخ البداية/);
  assert.throws(() => S.transferBrand(B2, 'nobody', { since: '2026-10-25' }, S.actor()), /vendor not found/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  events.length = 0;
  const out = S.transferBrand(B1, V2, { since: '2026-10-20', returnOn: '2026-11-20', reason: ' إجازة ' }, S.actor());
  assert.deepEqual(plain([out.owner, out.since, out.returnOn, out.temp, S.get(V2).brands.map((b) => b.name), S.get(V1).brands.map((b) => b.name), S.get(V1).brandsEver.map((b) => [b.name, b.until, b.now])]), [V2, '2026-10-20', '2026-11-20', true, ['Art Craft'], ['Wood & Rope'], [['Art Craft', '2026-10-20', 'Antikiano']]]); // at once
  assert.deepEqual(events.slice(0, 2).map((e) => e.detail), [{ id: V1, changed: ['brands'] }, { id: V2, changed: ['brands'] }]);
  await settle();
  assert.deepEqual(opsOf(calls, 'brand_owners').filter((c) => c.op === 'insert').map((c) => c.args[0]), [{ brand_id: B1, vendor_id: V2, since: '2026-10-20', return_on: '2026-11-20', reason: 'إجازة', set_by: 'صفوت كمال' }]);
  assert.deepEqual(logs, [['vendor.brand.transfer', 'Art Craft → Antikiano من 2026-10-20 لحد 2026-11-20', { entity: 'vendor', entity_id: V1 }], ['vendor.brand.transfer', 'Art Craft → Antikiano من 2026-10-20 لحد 2026-11-20', { entity: 'vendor', entity_id: V2 }]]);
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.id), [V1, V2]);
  // the same day as the last transfer is refused locally (review I2); the day after passes — a permanent move has no «لحد»
  calls.length = 0; logs.length = 0;
  assert.throws(() => S.transferBrand(B2, V1, { since: '2026-10-18' }, S.actor()), /بنفس التاريخ \(2026-10-18\)/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  S.transferBrand(B2, V1, { since: '2026-10-19' }, S.actor()); await settle();
  assert.deepEqual(opsOf(calls, 'brand_owners').find((c) => c.op === 'insert').args[0], { brand_id: B2, vendor_id: V1, since: '2026-10-19', return_on: null, reason: null, set_by: 'صفوت كمال' });
  assert.equal(logs[0][1], 'Antikiano → Art Craft من 2026-10-19');
  // 22023 from the server (a row written meanwhile): the history back, the reason by its message
  events.length = 0; logs.length = 0;
  responses.brand_owners = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '22023', message: 'since before the last transfer' } } : ok(OWNERS.concat([TRANSFER])));
  S.transferBrand(B2, V1, { since: '2026-10-25' }, S.actor());
  assert.equal(S.get(V1).brands.some((b) => b.id === B2), true);
  await settle();
  assert.deepEqual([S.get(V1).brands.some((b) => b.id === B2), S.get(V3).brands.some((b) => b.id === B2), events.filter((e) => e.detail.reason).map((e) => e.detail.reason), logs], [false, true, ['brand_since_before'], []]);
  responses.brand_owners = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '22023', message: 'same vendor' } } : ok(OWNERS.concat([TRANSFER])));
  events.length = 0; S.transferBrand(B2, V1, { since: '2026-10-25' }, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail.reason), ['brand_same_vendor']);
  responses.brand_owners = (ops) => (ops.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brand_owners_brand_id_since_key"' } } : ok(OWNERS.concat([TRANSFER])));
  events.length = 0; S.transferBrand(B2, V1, { since: '2026-10-19' }, S.actor()); await settle(); // a row that landed meanwhile: the server's unique key
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail.reason), ['brand_same_date']); // the unique (brand_id, since) key, not a rates duplicate (review I2)
  assert.match(V.MESSAGES.brand_same_date, /بنفس التاريخ/);
  assert.deepEqual([V.MESSAGES.brand_since_before, V.MESSAGES.brand_same_vendor], ['التاريخ ده قبل آخر نقل للبراند — اختار تاريخ بعده', 'البراند أصلًا عند المبتكر ده']);
  const ops = load({ admin: false }); await ops.V.load(); ops.calls.length = 0;
  assert.throws(() => ops.S.transferBrand(B1, V2, { since: '2026-10-25' }, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(ops.calls.filter((c) => c.op !== 'from'), []);
});

test('returnBrand: to the maker before the temporary transfer (else the origin), a new row with the reason «رجوع لصاحبه», two vendor.brand.return events; refused when the brand is already there', async () => {
  const { V, S, calls, logs } = load({ responses: { ...seed(), brand_owners: ok(OWNERS.concat([TRANSFER])) } });
  await V.load(); calls.length = 0;
  assert.throws(() => S.returnBrand(B1, { since: '2026-10-25' }, S.actor()), /البراند أصلًا عند صاحبه/);
  assert.throws(() => S.returnBrand(B2, { since: '2026-10-10' }, S.actor()), /قبل آخر نقل/);
  assert.deepEqual(calls.filter((c) => c.op !== 'from'), []);
  const out = S.returnBrand(B2, { since: '2026-10-25' }, S.actor());
  assert.deepEqual([out.owner, out.temp, out.since], [V2, false, '2026-10-25']);
  await settle();
  assert.deepEqual(opsOf(calls, 'brand_owners').find((c) => c.op === 'insert').args[0], { brand_id: B2, vendor_id: V2, since: '2026-10-25', return_on: null, reason: 'رجوع لصاحبه', set_by: 'صفوت كمال' });
  assert.deepEqual(logs, [['vendor.brand.return', 'Antikiano → Antikiano من 2026-10-25', { entity: 'vendor', entity_id: V3 }], ['vendor.brand.return', 'Antikiano → Antikiano من 2026-10-25', { entity: 'vendor', entity_id: V2 }]]);
  // a permanent chain V2 → V3 → V1: the return goes to the origin (V2), not to V3
  const chain = load({ responses: { ...seed(), brand_owners: ok(OWNERS.concat([ownerRow(5, B2, V3, '2026-10-01'), ownerRow(6, B2, V1, '2026-10-10')])) } });
  await chain.V.load(); chain.calls.length = 0;
  chain.S.returnBrand(B2, { since: '2026-10-25' }, chain.S.actor()); await settle();
  assert.equal(opsOf(chain.calls, 'brand_owners').find((c) => c.op === 'insert').args[0].vendor_id, V2);
  // a temporary one in the middle of a chain goes back one step
  const mid = load({ responses: { ...seed(), brand_owners: ok(OWNERS.concat([ownerRow(5, B2, V3, '2026-10-01'), ownerRow(6, B2, V1, '2026-10-10', { return_on: '2026-12-01' })])) } });
  await mid.V.load(); mid.calls.length = 0;
  mid.S.returnBrand(B2, {}, mid.S.actor()); await settle();
  assert.deepEqual([opsOf(mid.calls, 'brand_owners').find((c) => c.op === 'insert').args[0].vendor_id, opsOf(mid.calls, 'brand_owners').find((c) => c.op === 'insert').args[0].since], [V3, '2026-10-25']); // today
});

test('stats with the store uuids (decision 4): without a transfer the numbers are those of phase 3; with Antikiano\'s brand at Bian eg from 18 October his store\'s later orders are Bian eg\'s and the earlier stay his; a special rate changes the share of a line without a website rate', async () => {
  const orders = [
    { id: '181668', st: 'مكتمل', date: '2026-10-19', subs: [{ vendor: 'Art Craft', vendorId: V1, tot: 1002, rate: 35, fee: 0 }, { vendor: 'Antikiano', vendorId: V2, tot: 2539, rate: 40, fee: 10 }] },
    { id: '180686', st: 'جاري التنفيذ', date: '2026-10-17', subs: [{ vendor: 'Art Craft', vendorId: V1, tot: 1002, rate: null, fee: null }] },
    { id: '180656', st: 'ملغي', date: '2026-10-15', subs: [{ vendor: 'Antikiano', vendorId: V2, tot: 899, rate: null, fee: null }] },
  ];
  const rows = [{ id: '181668', customer: 'سلوى', status: 'مكتمل', ageDays: 6, total: 3541, delivery: 'ok', vendors: ['Art Craft', 'Antikiano'] }, { id: '180686', customer: 'هدير', status: 'جاري التنفيذ', ageDays: 8, total: 1002, delivery: 'risk', vendors: ['Art Craft'] }, { id: '180656', customer: 'x', status: 'ملغي', ageDays: 10, total: 899, delivery: 'late', vendors: ['Antikiano'] }];
  const app = { query: () => ({ rows }) };
  const pick = (x) => ({ ids: x.orders.map((o) => o.id), open: x.open, late: x.late, lastAge: x.lastAge, sales: x.sales, earned: x.earned, ibtekrShare: x.ibtekrShare, pending: x.pending, pendingSales: x.pendingSales, noRate: x.noRate, balance: x.balance, byStatus: x.byStatus });
  const same = load({ orders: { orders }, app }); await same.V.load();
  const st0 = plain(same.V.stats());
  assert.deepEqual(pick(st0[V1]), { ids: ['181668', '180686'], open: 1, late: 1, lastAge: 6, sales: 1002, earned: 651.3, ibtekrShare: 350.7, pending: 651.3, pendingSales: 1002, noRate: 0, balance: 651.3, byStatus: { c: [1, 1002, 651.3], p: [1, 1002, 651.3], x: [0, 0, 0] } }); // the phase-3 expectations
  assert.deepEqual(pick(st0[V2]), { ids: ['181668', '180656'], open: 0, late: 0, lastAge: 6, sales: 2539, earned: 1513.4, ibtekrShare: 1025.6, pending: 0, pendingSales: 0, noRate: 0, balance: 1513.4, byStatus: { c: [1, 2539, 1513.4], p: [0, 0, 0], x: [1, 899, 494.45] } });
  assert.deepEqual([st0[V3].orders, st0[V3].balance], [[], 150]);
  // the transfer: 181668 (19 October) is Bian eg's with the website's rate on the line; 180656 (15 October) stays Antikiano's
  const moved = load({ orders: { orders }, app, responses: { ...seed(), brand_owners: ok(OWNERS.concat([TRANSFER])) } }); await moved.V.load();
  const st1 = plain(moved.V.stats());
  assert.deepEqual([st1[V2].orders.map((o) => o.id), st1[V2].earned, st1[V2].byStatus.x, st1[V2].balance], [['180656'], 0, [1, 899, 494.45], 0]);
  assert.deepEqual([st1[V3].orders.map((o) => [o.id, o.sales, o.share]), st1[V3].earned, st1[V3].balance, st1[V3].lastAge], [[['181668', 2539, 1513.4]], 1513.4, 1663.4, 6]); // opening 150 + earned
  assert.deepEqual(pick(st1[V1]), pick(st0[V1])); // Art Craft untouched
  // a special rate on Antikiano's brand (30% from 1 October): the cancelled line (no website rate) is shared at 30%, the completed one keeps the line's own rate
  const special = load({ orders: { orders }, app, responses: { ...seed(), brand_rates: ok([{ id: 1, brand_id: B2, rate: 30, since: '2026-10-01' }]) } }); await special.V.load();
  const st2 = plain(special.V.stats());
  assert.deepEqual([st2[V2].byStatus.x, st2[V2].earned], [[1, 899, 629.3], 1513.4]);
  // a sub without a store uuid (not on the live data): the old match by name
  const named = load({ orders: { orders: orders.map((o) => ({ ...o, subs: o.subs.map(({ vendorId, ...s }) => s) })) }, app, responses: { ...seed(), brand_owners: ok(OWNERS.concat([TRANSFER])) } }); await named.V.load();
  assert.deepEqual(pick(plain(named.V.stats())[V2]), pick(st0[V2]));
});

test('remove: 23503 from vendors_brands_guard_delete (the maker holds or held another maker\'s brand) → has_brands and the vendor is back; the orders\' 23503 still reads in_use', async () => {
  const { V, S, responses, events } = load();
  await V.load();
  responses.vendors = (ops) => (ops.some((c) => c.op === 'delete') ? { data: null, error: { code: '23503', message: 'the maker holds or held a brand of another maker (brand_owners_vendor_id_fkey): transfer or return it first' } } : ok(VENDORS));
  events.length = 0; S.remove(V3, S.actor()); await settle();
  assert.deepEqual([S.get(V3).name, events.filter((e) => e.detail.reason).map((e) => e.detail.reason)], ['Bian eg', ['has_brands']]);
  assert.equal(V.MESSAGES.has_brands, 'ماينفعش يتمسح — عليه براندات (ماسك أو كان ماسك براند مبتكر تاني): انقلها أو رجّعها الأول');
  responses.vendors = (ops) => (ops.some((c) => c.op === 'delete') ? { data: null, error: { code: '23503', message: 'update or delete on table "vendors" violates foreign key constraint "order_items_vendor_id_fkey" on table "order_items"' } } : ok(VENDORS));
  events.length = 0; S.remove(V3, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail.reason), ['in_use']);
});

test('loadEvents: the brand events read as sentences', async () => {
  const rows = [{ id: 1, at: '2026-10-20T10:00:00+00:00', action: 'vendor.brand', new_value: 'add: Zaan', actor: { name: 'صفوت كمال' } }, { id: 2, at: '2026-10-21T10:00:00+00:00', action: 'vendor.brand', new_value: 'update: Zaan (name, code)', actor: { name: 'صفوت كمال' } },
    { id: 3, at: '2026-10-22T10:00:00+00:00', action: 'vendor.brand.rate', new_value: 'Zaan: 30% من 2026-10-01', actor: { name: 'منى حسن' } }, { id: 4, at: '2026-10-23T10:00:00+00:00', action: 'vendor.brand.transfer', new_value: 'Zaan → Antikiano من 2026-10-20 لحد 2026-11-20', actor: { name: 'هدى سمير' } },
    { id: 5, at: '2026-10-24T10:00:00+00:00', action: 'vendor.brand.return', new_value: 'Zaan → Art Craft من 2026-10-24', actor: { name: 'هدى سمير' } }];
  const { V } = load({ responses: { ...seed(), activity_log: ok(rows.slice().reverse()) } }); // the server answers newest first
  await V.load();
  const ev = await V.loadEvents(V1);
  assert.deepEqual(plain(ev.map((e) => e.text)), ['صفوت كمال أضاف البراند Zaan', 'صفوت كمال عدّل البراند Zaan (name, code)', 'منى حسن حدّد النسبة الخاصة للبراند (Zaan: 30% من 2026-10-01)', 'هدى سمير نقل البراند (Zaan → Antikiano من 2026-10-20 لحد 2026-11-20)', 'هدى سمير رجّع البراند لصاحبه (Zaan → Art Craft من 2026-10-24)']);
});

// Phase 3.3 (decision 5): the synced store data on the vendor shape, the contact write with its derived columns and the push to the
// site through woo-sync push_vendor (the member's client, the field names only), every answer of the contract, the rate's flat fee,
// the per-category commission, the site's categories, the sync rows' texts.
const SYNCED = row({ id: V1, woo_vendor_id: 2376, name: 'Art Craft', phone: '01000000003', category: 'فنون ولوحات', contact_name: 'منى عادل', address: '12 شارع المعز، القاهرة، الجمالية',
  address_parts: { street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' }, instagram: 'https://www.instagram.com/artcraft.dev',
  social: { fb: 'https://www.facebook.com/artcraft.dev', instagram: 'https://www.instagram.com/artcraft.dev', twitter: 'javascript:alert(1)', youtube: 'http://youtube.com/a', threads: 'https://www.threads.net/@a"><img src=x>' },
  logo_url: 'https://ibtekr.stage.test/wp-content/uploads/artcraft.png', banner_url: 'http://ibtekr.stage.test/banner.png', woo_payment_methods: ['bank', 'paypal'], push_pending: ['phone', 'bogus'], woo_synced_at: '2026-10-25T07:00:00+00:00' });
const syncedSeed = () => ({ ...seed(), vendors: ok([SYNCED, VENDORS[0], VENDORS[2]]), vendor_rates: ok(RATES.concat([{ id: 9, vendor_id: V1, rate: 38, flat: '10.00', since: '2026-10-10', set_by: 'الموقع', created_at: T0 }])), vendor_category_rates: ok(CAT_RATES) });

test('toVendor (3.3): the synced columns read by name — the parts and the links always whole (https:// or nothing), the mirrors https:// or null, the pending names filtered, the flat fee with the rate', async () => {
  const { V, S } = load({ responses: syncedSeed() });
  await V.load();
  const v = S.get(V1);
  assert.deepEqual(plain([v.contactName, v.address, v.addressParts]), ['منى عادل', '12 شارع المعز، القاهرة، الجمالية', { street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' }]);
  assert.deepEqual(plain(v.social), { fb: 'https://www.facebook.com/artcraft.dev', instagram: 'https://www.instagram.com/artcraft.dev', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: 'https://www.threads.net/@a"><img src=x>', flickr: '' });
  assert.deepEqual(plain([v.logoUrl, v.bannerUrl, v.wooPaymentMethods, v.pushPending, v.wooSyncedAt]), ['https://ibtekr.stage.test/wp-content/uploads/artcraft.png', null, ['bank', 'paypal'], ['phone'], '2026-10-25T07:00:00+00:00']);
  assert.deepEqual(plain([v.rate, v.rateFlat, v.rateSince, v.rateHistory]), [38, 10, '2026-10-10', [{ rate: 35, flat: null, since: '2026-03-01', by: 'صفوت كمال' }, { rate: 38, flat: 10, since: '2026-10-10', by: 'الموقع' }]]);
  // the category rates in force on 2026-10-25: category 15 at 30% (the 2027 row waits), category 22 removed on 20 October (a null row)
  assert.deepEqual(plain(v.categoryRates), [{ wooCategoryId: 15, name: 'ديكور', rate: 30, flat: 0, since: '2026-03-01' }]);
  assert.deepEqual(plain(V.categories()), [{ id: 15, name: 'ديكور', slug: 'decor', parentId: 0 }, { id: 22, name: 'هدايا', slug: 'gifts', parentId: 0 }]); // by name
  const ops = load({ admin: false, responses: syncedSeed() });
  await ops.V.load();
  assert.deepEqual(plain([ops.S.get(V1).categoryRates, ops.S.get(V1).rateFlat, ops.S.get(V1).contactName]), [[], null, 'منى عادل']); // no sensitive.commission: no category rates (and no request for them), the contact data for everyone
  assert.deepEqual(opsOf(ops.calls, 'vendor_category_rates'), []);
  const noCats = load({ responses: { ...syncedSeed(), woo_categories: denied() } });
  await noCats.V.load();
  assert.deepEqual([noCats.V.state(), noCats.S.get(V1).categoryRates[0].name], ['ready', '#15']); // the names refused: the id shows
});

test('update (3.3): the contact popup writes contact_name / address_parts / social with the derived address + instagram, then push_vendor names the synced fields; the reload carries the answer', async () => {
  const { V, S, calls, logs, events } = load();
  await V.load(); calls.length = 0; events.length = 0;
  S.update(V1, { contactName: ' منى عادل ', addressParts: { street_1: '12 شارع المعز', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'eg' }, social: { fb: 'https://www.facebook.com/artcraft.dev', instagram: 'https://www.instagram.com/artcraft.dev' }, phone: '01000000003' }, S.actor());
  const v = S.get(V1);
  assert.deepEqual(plain([v.contactName, v.address, v.instagram, v.addressParts.country]), ['منى عادل', '12 شارع المعز، القاهرة، الجمالية', 'https://www.instagram.com/artcraft.dev', 'EG']); // at once, the derived columns with their source
  assert.deepEqual(events[0].detail, { id: V1, changed: ['contactName', 'addressParts', 'social'] }); // the phone unchanged: not sent
  await settle();
  const w = writesOf(calls, 'vendors');
  assert.deepEqual(w[0], { op: 'update', args: [{ contact_name: 'منى عادل', address_parts: { street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' }, social: { fb: 'https://www.facebook.com/artcraft.dev', instagram: 'https://www.instagram.com/artcraft.dev', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' }, address: '12 شارع المعز، القاهرة، الجمالية', instagram: 'https://www.instagram.com/artcraft.dev' }] });
  assert.deepEqual(invokes(calls), [['woo-sync', { body: { action: 'push_vendor', vendor_id: V1, fields: ['contact_name', 'address_parts', 'social'] } }]]); // after the row, the names only
  assert.ok(calls.findIndex((c) => c.op === 'invoke') > calls.findIndex((c) => c.op === 'update'), 'the row first');
  assert.deepEqual(logs, [['vendor.update', 'contactName, addressParts, social', { entity: 'vendor', entity_id: V1 }]]);
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'ok', fields: ['contact_name', 'address_parts', 'social'], accepted: ['contact_name', 'address_parts', 'social'], refused: [], dropped: [], held: [] }]);
  // a status change pushes status; a notes change pushes nothing; the parts cleared on a synced row → address null with them
  calls.length = 0; events.length = 0;
  S.update(V1, { status: 'leave', notes: 'x' }, S.actor());
  await settle();
  assert.deepEqual(writesOf(calls, 'vendors')[0].args[0], { status: 'leave', notes: 'x' });
  assert.deepEqual(invokes(calls)[0][1].body.fields, ['status']);
  calls.length = 0;
  S.update(V1, { notes: 'y', leadDays: 9 }, S.actor());
  await settle();
  assert.deepEqual(invokes(calls), []);
  const sy = load({ responses: syncedSeed() });
  await sy.V.load(); sy.calls.length = 0;
  sy.S.update(V1, { addressParts: {}, social: {} }, sy.S.actor());
  assert.deepEqual([sy.S.get(V1).address, sy.S.get(V1).instagram], [null, null]);
  await settle();
  assert.deepEqual(writesOf(sy.calls, 'vendors')[0].args[0], { address_parts: EMPTY_PARTS, social: EMPTY_SOCIAL, address: null, instagram: null });
  assert.deepEqual(invokes(sy.calls)[0][1].body.fields, ['address_parts', 'social']);
  // an invalid link or part is refused before any write, like the popup
  assert.throws(() => S.update(V1, { social: { fb: 'http://f.com/a' } }, S.actor()), /invalid vendor: social/);
  assert.throws(() => S.update(V1, { addressParts: { country: 'Egypt' } }, S.actor()), /invalid vendor: addressParts/);
  assert.throws(() => S.update(V1, { contactName: 'a'.repeat(121) }, S.actor()), /invalid vendor: contactName/);
});

test('pushVendor answers (3.3): skipped reasons pass through, 502 / 500 / network are errors (the fields wait in push_pending), 401 is forbidden; no request without the permission or without a store; a refused row write pushes nothing', async () => {
  const { V, S, calls, responses, events } = load();
  await V.load();
  for (const [i, reason] of ['push_disabled', 'no_store', 'placeholder'].entries()) {
    responses['fn:woo-sync'] = () => ({ data: { action: 'push_vendor', result: 'skipped', reason, fields: ['phone'], counts: { pushed: 0 } }, error: null });
    events.length = 0; S.update(V1, { phone: '0100000000' + (5 + i) }, S.actor()); await settle(); // a phone the seed does not have
    assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'skipped', reason, fields: ['phone'] }], reason);
  }
  // review I-1: a failure that never reached the site (500 / 404 / 401 / 403 of the function, the network) queues the fields through the
  // RPC vendor_push_pending (pending: true when it answered); a 502 is the function's own answer — the fields already wait (pending true)
  // unless its body says pending:false (the site's final refusal: woo_refused, nothing queued)
  const rpcs = () => calls.filter((c) => c.op === 'rpc').map((c) => c.args);
  for (const [status, want, queued] of [[502, 'woo_error', 0], [500, 'failed', 1], [404, 'failed', 1], [401, 'forbidden', 1], [403, 'forbidden', 1]]) {
    responses['fn:woo-sync'] = () => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status } } });
    events.length = 0; calls.length = 0; S.update(V1, { phone: '01000000009' }, S.actor()); await settle();
    assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'error', reason: want, status, fields: ['phone'], pending: true }], String(status));
    assert.deepEqual(rpcs(), Array(queued).fill(['vendor_push_pending', { p_vendor: V1, p_fields: ['phone'] }]), 'queued ' + status);
  }
  responses['fn:woo-sync'] = () => ({ data: null, error: { name: 'FunctionsHttpError', message: 'non-2xx', context: { status: 502, json: async () => ({ error: 'woo_error', fields: ['phone'], pending: false }) } } });
  events.length = 0; calls.length = 0; S.update(V1, { phone: '01000000009' }, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'error', reason: 'woo_refused', status: 502, fields: ['phone'], pending: false }]);
  assert.deepEqual(rpcs(), [], 'a final refusal queues nothing');
  responses['fn:woo-sync'] = () => { throw new Error('offline'); };
  events.length = 0; calls.length = 0; S.update(V1, { phone: '01000000009' }, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'error', reason: 'network', fields: ['phone'], pending: true }]);
  assert.deepEqual(rpcs(), [['vendor_push_pending', { p_vendor: V1, p_fields: ['phone'] }]]);
  // the queue refused too (the session expired, say) → pending false: the screen says the fields will not go by themselves
  responses['rpc:vendor_push_pending'] = () => ({ data: null, error: { code: '42501', message: 'vendors.edit = F (or P for the contact fields) is required to queue a push to the site' } });
  events.length = 0; S.update(V1, { phone: '01000000009' }, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'error', reason: 'network', fields: ['phone'], pending: false }]);
  delete responses['rpc:vendor_push_pending'];
  assert.equal(V.MESSAGES.push_failed, 'اتحفظ في السيستم، ومابعتش للموقع — هيتبعت مع المزامنة الجاية');
  assert.equal(V.MESSAGES.push_lost, 'اتحفظ في السيستم، ومابعتش للموقع — ومش هيتبعت لوحده: افتح التعديل واحفظ تاني');
  assert.equal(V.MESSAGES.push_refused, 'اتحفظ في السيستم بس — الموقع رفض التعديل ده، راجع القيم');
  // a maker without a store: saved, nothing sent (the server would say no_store)
  const ns = load({ responses: { ...seed(), vendors: ok([VENDORS[0], VENDORS[1], row({ id: V3, name: 'Bian eg', phone: '01000000000' })]) } });
  await ns.V.load(); ns.calls.length = 0; ns.events.length = 0;
  ns.S.update(V3, { phone: '01000000009' }, ns.S.actor()); await settle();
  assert.deepEqual(invokes(ns.calls), []);
  assert.deepEqual(ns.events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'skipped', reason: 'no_store', fields: ['phone'] }]);
  // the row refused: no push
  responses['fn:woo-sync'] = PUSH_OK; responses.vendors = (ops) => (ops.some((c) => c.op === 'update') ? denied() : ok(VENDORS)); calls.length = 0;
  S.update(V1, { phone: '01000000008' }, S.actor()); await settle();
  assert.deepEqual(invokes(calls), []);
  // ops (vendors.edit = P): the contact fields it may edit are pushed (the server's rule, canPush(fields)); name / status / a rate are not
  const ops = load({ admin: false });
  await ops.V.load(); ops.responses['fn:woo-sync'] = PUSH_OK; ops.calls.length = 0; ops.events.length = 0;
  ops.S.update(V1, { phone: '01000000009' }, ops.S.actor()); await settle();
  assert.deepEqual(invokes(ops.calls).map((a) => a[1].body.fields), [['phone']]);
  assert.deepEqual(ops.events.filter((e) => e.detail.written).map((e) => e.detail.push), [{ result: 'ok', fields: ['phone'], accepted: ['phone'], refused: [], dropped: [], held: [] }]);
  assert.deepEqual([ops.S.canPush(['phone', 'social']), ops.S.canPush(['name']), ops.S.canPush(['phone', 'status']), ops.S.canPush(), S.canPush()], [true, false, false, false, true]);
  assert.deepEqual(plain(await ops.S.pushVendor(V1, ['status'])), { result: 'skipped', reason: 'no_permission', fields: ['status'] });
  const vf = load({ admin: false, perms: { 'vendors.view': 'F', 'vendors.edit': 'F', 'sensitive.commission': 'N' } }); // vendors follow-up: may push the contact, not the rate
  await vf.V.load();
  assert.deepEqual(plain([await vf.S.pushVendor(V1, ['phone']), await vf.S.pushVendor(V1, ['rate']), await vf.S.pushVendor(V1, ['bogus'])]), [{ result: 'ok', fields: ['phone'], accepted: ['phone'], refused: [], dropped: [], held: [] }, { result: 'skipped', reason: 'no_permission', fields: ['rate'] }, { result: 'skipped', reason: 'no_fields', fields: [] }]);
});

test('setRate (3.3): an optional flat fee in the call (null without one), shown as rateFlat, in the event; the new rate is pushed as [rate]', async () => {
  const { V, S, calls, logs, events } = load();
  await V.load(); calls.length = 0; events.length = 0;
  S.setRate(V1, 40, null, S.actor(), { flat: '١٠' });
  assert.deepEqual(plain([S.get(V1).rate, S.get(V1).rateFlat, S.get(V1).rateHistory.map((x) => x.rate + '@' + x.since + '+' + x.flat)]), [40, 10, ['35@2026-03-01+null', '40@' + TODAY_LOCAL + '+10']]);
  await settle();
  assert.deepEqual(plain(rpcCalls(calls, 'vendor_rate_set')), [{ p_vendor: V1, p_rate: 40, p_flat: 10 }]);
  assert.deepEqual(invokes(calls), [['woo-sync', { body: { action: 'push_vendor', vendor_id: V1, fields: ['rate'] } }]]);
  assert.deepEqual(logs, [['vendor.rate', '40% + 10 ج.م', { entity: 'vendor', entity_id: V1 }]]);
  assert.deepEqual(events.filter((e) => e.detail.written).map((e) => e.detail.push.result), ['ok']);
  calls.length = 0;
  S.setRate(V1, 42, null, S.actor(), { flat: '' }); await settle();
  assert.deepEqual(plain(rpcCalls(calls, 'vendor_rate_set')), [{ p_vendor: V1, p_rate: 42, p_flat: null }]);
  assert.throws(() => S.setRate(V1, 42, null, S.actor(), { flat: '-1' }), /flat out of range/);
});

test('setCategoryRate (3.3 + decision 12): no date — one vendor_category_rate_set call (rate null = back to the maker\'s rate), a same-day change replaces the day\'s row, logged with the category name, pushed as [category_rates]; sensitive.commission required', async () => {
  const { V, S, calls, logs, events, responses } = load({ responses: syncedSeed() });
  await V.load(); calls.length = 0; events.length = 0;
  S.setCategoryRate(V1, '٢٢', { rate: '35', flat: '' }, '2026-10-25', S.actor());
  assert.deepEqual(plain(S.get(V1).categoryRates), [{ wooCategoryId: 15, name: 'ديكور', rate: 30, flat: 0, since: '2026-03-01' }, { wooCategoryId: 22, name: 'هدايا', rate: 35, flat: null, since: TODAY_LOCAL }]); // at once
  assert.deepEqual(events[0].detail, { id: V1, changed: ['categoryRates'] });
  S.setCategoryRate(V1, 22, { rate: '20' }, null, S.actor());
  assert.deepEqual(plain(S.get(V1).categoryRates.filter((x) => x.wooCategoryId === 22).map((x) => x.rate)), [20]); // replaced the same day
  await settle();
  assert.deepEqual(plain(rpcCalls(calls, 'vendor_category_rate_set')), [{ p_vendor: V1, p_category: 22, p_rate: 35, p_flat: null }, { p_vendor: V1, p_category: 22, p_rate: 20, p_flat: null }]);
  assert.deepEqual(opsOf(calls, 'vendor_category_rates').filter((c) => c.op === 'insert'), []);
  assert.deepEqual(invokes(calls).map((a) => a[1].body.fields), [['category_rates'], ['category_rates']]);
  assert.deepEqual(logs, [['vendor.category_rate', 'هدايا: 35%', { entity: 'vendor', entity_id: V1 }], ['vendor.category_rate', 'هدايا: 20%', { entity: 'vendor', entity_id: V1 }]]);
  calls.length = 0; logs.length = 0;
  S.setCategoryRate(V1, 15, { rate: '', flat: '7' }, null, S.actor()); await settle(); // back to the maker's rate from today, a flat fee kept for display
  assert.deepEqual(plain(rpcCalls(calls, 'vendor_category_rate_set')), [{ p_vendor: V1, p_category: 15, p_rate: null, p_flat: 7 }]);
  assert.deepEqual(logs, [['vendor.category_rate', 'ديكور: — + 7 ج.م', { entity: 'vendor', entity_id: V1 }]]);
  calls.length = 0;
  assert.throws(() => S.setCategoryRate(V1, 99, { rate: 30 }, null, S.actor()), /اختار فئة من فئات الموقع/);
  assert.throws(() => S.setCategoryRate(V1, 15, { rate: 70 }, null, S.actor()), /invalid category rate: rate/);
  assert.deepEqual(rpcCalls(calls, 'vendor_category_rate_set'), []);
  responses['rpc:vendor_category_rate_set'] = () => ({ data: null, error: { code: '42501', message: 'sensitive.commission = F is required to set a category rate' } });
  events.length = 0; S.setCategoryRate(V1, 22, { rate: 20 }, null, S.actor()); await settle();
  assert.deepEqual(events.filter((e) => e.detail.reason).map((e) => e.detail.reason), ['forbidden']);
  assert.deepEqual(plain(S.get(V1).categoryRates.map((x) => x.wooCategoryId)), [15]); // back
  const ops = load({ admin: false, responses: syncedSeed() });
  await ops.V.load(); ops.calls.length = 0;
  assert.throws(() => ops.S.setCategoryRate(V1, 22, { rate: 20 }, null, ops.S.actor()), /مش من صلاحياتك/);
  assert.deepEqual(rpcCalls(ops.calls, 'vendor_category_rate_set'), []);
});

test('loadEvents (3.3): the server\'s vendor.sync / vendor.sync.conflict rows (actor null) read in the site\'s voice with the Arabic field labels', async () => {
  const rows = [{ id: 1, at: '2026-10-25T07:00:00+00:00', action: 'vendor.sync', new_value: 'phone, address_parts, category_rates', actor: null }, { id: 2, at: '2026-10-25T07:15:00+00:00', action: 'vendor.sync.conflict', new_value: 'name', actor: null },
    { id: 3, at: '2026-10-25T07:30:00+00:00', action: 'vendor.sync', new_value: 'bogus', actor: null }, { id: 4, at: '2026-10-25T07:45:00+00:00', action: 'vendor.category_rate', new_value: 'هدايا: 35% من 2026-10-25', actor: { name: 'صفوت كمال' } }];
  const { V } = load({ responses: { ...seed(), activity_log: ok(rows.slice().reverse()) } });
  await V.load();
  const ev = await V.loadEvents(V1);
  assert.deepEqual(plain(ev.map((e) => [e.text, e.actor.name])), [['اتعدل من الموقع: التليفون، العنوان، عمولة الفئات', 'الموقع'], ['تعارض — الموقع كسب في: الاسم', 'الموقع'], ['اتعدل من الموقع: bogus', 'الموقع'], ['صفوت كمال حدّد عمولة الفئة (هدايا: 35% من 2026-10-25)', 'صفوت كمال']]);
  assert.equal(V.toEvent({ id: 5, at: 'x', action: 'vendor.sync', new_value: '', actor: null }).text, 'اتعدل من الموقع: —');
  // security review: a vendor.sync* row WITH an actor (a member logged the action himself) is never dressed as the site — his name, the generic wording
  const forged = V.toEvent({ id: 6, at: 'x', action: 'vendor.sync', new_value: 'phone', actor: { name: 'سارة أحمد' } });
  assert.deepEqual(plain([forged.text, forged.actor.name]), ['سارة أحمد vendor.sync (phone)', 'سارة أحمد']);
  assert.deepEqual(plain(V.toEvent({ id: 7, at: 'x', action: 'vendor.sync.conflict', new_value: 'name', actor: { name: 'سارة أحمد' } }).text), 'سارة أحمد vendor.sync.conflict (name)');
  // review I-3: the site's final refusal of a pending push reads in the site's voice too
  const refused = V.toEvent({ id: 8, at: 'x', action: 'vendor.sync.refused', new_value: 'phone, social', actor: null });
  assert.deepEqual(plain([refused.text, refused.actor.name]), ['الموقع رفض التعديل في: التليفون، السوشيال', 'الموقع']);
  assert.equal(V.toEvent({ id: 8, at: 'x', action: 'vendor.sync', new_value: 'phone' }).actor.name, 'الموقع'); // no actor key at all: the server's
});
