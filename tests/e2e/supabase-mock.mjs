// Test-only stand-in for the Supabase project: answers exactly the auth / PostgREST / Edge Function calls supabase-js 2.118
// makes for the login flow, the dashboard and the orders page, with the three dev users of tools/seed-dev-users.sql (+ M03, a
// mock-only 2FA user, and M04, a mock-only accounts user: orders.status N, sensitive.customer_phone N).
// Strict like the real thing: apikey required, PostgREST bearer must be the anon key or a token issued here,
// `select` columns checked against supabase/migrations (0001, 0002, 0006, 0007), RLS of each emulated table, the column-level
// grants and guard triggers of the orders tables (0007), woo-sync's push_status contract, the aal2 rule of has_perm and the
// 2FA RPCs (0008) with GoTrue's MFA endpoints (enroll / challenge / verify / unenroll). Not a product feature.
// Spec files call installSupabaseMock(page) unless E2E_SUPABASE_LIVE=1: then installLiveConfig(page) points the app at the
// staging project in E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY (never at whatever app/config.js holds), or skips without them.
export const SUPABASE_URL = 'https://fsynculhaupcktzkfkdd.supabase.co';
export const LIVE = process.env.E2E_SUPABASE_LIVE === '1';
const LIVE_URL = process.env.E2E_SUPABASE_URL || ''; const LIVE_KEY = process.env.E2E_SUPABASE_ANON_KEY || '';
export const LIVE_MISSING = LIVE && !(LIVE_URL && LIVE_KEY) ? 'E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY (staging project) not set' : '';
export async function installLiveConfig(page) {
  await page.addInitScript(([url, key]) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: key }; }, [LIVE_URL, LIVE_KEY]);
}
export const DEV_PW = 'IbtekrDev-2026'; // same as tools/seed-dev-users.sql
export const TOTP_CODE = '123456'; // the code every mocked authenticator accepts (M03's and any factor enrolled in a spec)
export const TOTP_SECRET = 'MOCKTOTPSECRETAAAAAAAAAA'; // the base32 key a mocked enrolment hands out (not a real secret)
// GoTrue answers the QR as raw SVG markup (supabase-js prefixes `data:image/svg+xml;utf-8,`); the '#' must survive as an <img>
export const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="#000"/></svg>';
const ANON_KEY = 'mock-anon-key';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-10-22T00:00:00Z';
export const USERS = [
  { id: ADMIN, member_code: 'M01', name: 'صفوت كمال', email: 'admin.dev@ibtekr.local', phone: '01000000001', role_id: 'admin', title: 'المؤسس والمدير العام', dept: 'الإدارة', manager_id: null, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000002', member_code: 'M02', name: 'سارة أحمد', email: 'ops.dev@ibtekr.local', phone: '01000000002', role_id: 'ops', title: 'مديرة العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000003', member_code: 'M03', name: 'محمد علي', email: 'twofa.dev@ibtekr.local', phone: '01000000003', role_id: 'ops', title: 'العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: true, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000004', member_code: 'M04', name: 'منى حسن', email: 'accounts.dev@ibtekr.local', phone: '01000000004', role_id: 'accounts', title: 'الحسابات', dept: 'الحسابات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000099', member_code: 'M99', name: 'مشاهد تجريبي', email: 'viewer.dev@ibtekr.local', phone: '01000000099', role_id: 'viewer', title: 'مشاهد', dept: 'الإدارة', manager_id: ADMIN, status: 'suspended', twofa: false, custom_perms: {}, created_at: T0 },
];
// permissions: the keys the emulated tables read, as in 0003_seed_roles.sql
const ROLES = [
  { id: 'admin', name: 'أدمن', description: 'كل الصلاحيات — المالك والمديرين', is_system: true, permissions: { 'settings.view': 'F', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'F', 'vendors.view': 'F', 'sensitive.customer_phone': 'F' }, sort: 1 },
  { id: 'ops', name: 'عمليات', description: 'الأوردرات والمخزن والتجميع والشحن', is_system: true, permissions: { 'settings.view': 'P', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'P', 'vendors.view': 'F', 'sensitive.customer_phone': 'F' }, sort: 2 },
  { id: 'accounts', name: 'حسابات', description: 'المصروفات والتحويلات وكشوف الموردين', is_system: true, permissions: { 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'F', 'sensitive.customer_phone': 'N' }, sort: 4 },
  { id: 'viewer', name: 'مشاهد', description: 'عرض بس من غير تعديل', is_system: true, permissions: { 'settings.view': 'N', 'orders.view': 'P', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'P', 'sensitive.customer_phone': 'N' }, sort: 6 },
];
const COLUMNS = { // supabase/migrations/0001_identity.sql, 0002_system.sql (activity_log, alerts, status_map), 0006_dashboard.sql (user_prefs,
  // alert_reads), 0007_orders.sql (orders_v; order_items / sub_orders: the columns granted to authenticated, i.e. all but raw)
  profiles: ['id', 'member_code', 'name', 'email', 'phone', 'role_id', 'title', 'dept', 'manager_id', 'status', 'twofa', 'custom_perms', 'created_at'],
  roles: ['id', 'name', 'description', 'is_system', 'permissions', 'sort'],
  user_prefs: ['user_id', 'key', 'data', 'updated_at'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
  alerts: ['id', 'at', 'kind', 'title', 'body', 'role_id', 'user_id', 'entity', 'entity_id', 'read_at'],
  alert_reads: ['alert_id', 'user_id', 'read_at'],
  orders_v: ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'payment_method', 'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note', 'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'synced_at', 'created_at', 'updated_at'],
  order_items: ['id', 'order_id', 'sub_order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'status', 'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'removed', 'updated_at'],
  sub_orders: ['id', 'order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'updated_at'],
  vendors: ['id', 'woo_vendor_id', 'name', 'aliases', 'phone', 'email', 'status', 'commission_pct', 'raw', 'created_at', 'updated_at'],
  products: ['id', 'sku', 'name', 'image_url', 'vendor_id', 'price', 'status', 'raw', 'updated_at'],
  status_map: ['id', 'system_status', 'woo_status', 'direction', 'sort'],
};
// the alerts table at sign-in: one for the admin role, one addressed to ops.dev (M02) only
const ALERTS = () => [
  { id: 1, at: T0, kind: 'woo.sync.failed', title: 'فشل مزامنة WooCommerce', body: 'آخر محاولة 09:00', role_id: 'admin', user_id: null, entity: 'settings-integrations', entity_id: null },
  { id: 2, at: T0, kind: 'stock.cons.late', title: 'تجميع متأخر IB-1042', body: null, role_id: null, user_id: '00000000-0000-4000-8000-000000000002', entity: 'inventory-consolidate', entity_id: null },
];
// has_perm('settings.view') (0001 + the aal2 rule of 0008)
const viewPerm = (u) => hasPerm(u, 'settings.view');
const EMBEDS = { activity_log: { actor: 'profiles' } }; // FKs a select may embed (0002: activity_log.actor → profiles = USERS)
// a PostgREST `select` → { pick(row) } projecting a row to it, or { bad: 'table.column' }; embeds as alias:table(cols) along EMBEDS
function readSelect(table, select) {
  const parts = [];
  for (const c of (select || '*').match(/[^,(]+(\([^)]*\))?/g).map((x) => x.trim())) {
    const e = /^(\w+):(\w+)\(([^)]*)\)$/.exec(c);
    if (e) {
      const sub = e[3].split(',').map((x) => x.trim()); const miss = sub.find((x) => !(COLUMNS[e[2]] || []).includes(x));
      if ((EMBEDS[table] || {})[e[1]] !== e[2] || miss) return { bad: miss ? e[2] + '.' + miss : table + '.' + c };
      parts.push((r) => [[e[1], r[e[1]] == null ? null : Object.fromEntries(sub.map((x) => [x, (USERS.find((p) => p.id === r[e[1]]) || {})[x] ?? null]))]]);
    } else if (c === '*') parts.push((r) => Object.entries(r));
    else if (COLUMNS[table].includes(c)) parts.push((r) => [[c, r[c] ?? null]]);
    else return { bad: table + '.' + c };
  }
  return { pick: (r) => Object.fromEntries(parts.flatMap((p) => p(r))) };
}
const NOT_FILTERS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
// the in.(…) filters the app sends: alerts.js asks the marks of the loaded alert ids; orders.js the lines / sub-orders of the
// loaded orders, the images of their skus and (Realtime) the names of makers it does not know yet
const IN_FILTERS = { alert_reads: ['alert_id'], order_items: ['order_id'], sub_orders: ['order_id'], products: ['sku'], vendors: ['id'] };
const GTE_FILTERS = { orders_v: ['placed_at'] }; // orders.js: the last 12 months
// the horizontal filters of a PostgREST request (eq. everywhere; in.(a,b) on IN_FILTERS, gte. on GTE_FILTERS only) → { match(row) } | { bad: 'param=value' }
function readFilters(params, table) {
  const f = [...params].filter(([k]) => !NOT_FILTERS.has(k));
  const bad = f.find(([k, v]) => !v.startsWith('eq.') && !((IN_FILTERS[table] || []).includes(k) && /^in\.\(.*\)$/.test(v)) && !((GTE_FILTERS[table] || []).includes(k) && v.startsWith('gte.')));
  const one = ([k, v]) => {
    if (v.startsWith('eq.')) return (r) => String(r[k]) === v.slice(3);
    if (v.startsWith('gte.')) { const t = Date.parse(v.slice(4)); return (r) => Date.parse(r[k]) >= t; }
    const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1')); return (r) => set.includes(String(r[k]));
  };
  return bad ? { bad: bad.join('=') } : { match: (r) => f.every((p) => one(p)(r)) };
}
const MAX_ROWS = 1000; // the project's PostgREST max_rows
// a GET's order=a.desc,b.asc, then offset / limit (capped at max_rows)
function pageOf(rows, params) {
  const keys = (params.get('order') || '').split(',').filter(Boolean).map((k) => { const [col, dir] = k.split('.'); return [col, dir === 'desc' ? -1 : 1]; });
  const cmp = (a, b) => { for (const [col, d] of keys) { if (a[col] < b[col]) return -d; if (a[col] > b[col]) return d; } return 0; };
  const off = Number(params.get('offset')) || 0; const lim = Math.min(Number(params.get('limit')) || MAX_ROWS, MAX_ROWS);
  return [...rows].sort(cmp).slice(off, off + lim);
}

// ---- the orders tables (0007_orders.sql), seeded per install: three orders of the last days — a multi-maker one with two
// Dokan sub-orders, a single-maker one (no sub-order; one line removed from WooCommerce) and one whose customer name is HTML —
// plus one older than 12 months that the orders page never asks for. Images are inline data: URLs (no outside request).
export const XSS_NAME = '<img src=x onerror="window.__xss=1">';
export const IMG = { cushion: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', curtain: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };
const VND = (n) => 'a0000000-0000-4000-8000-00000000000' + n;
// status_map after 0007 (system status ↔ WooCommerce slug); تم RTC has no slug: never pushed
const STATUS_MAP = [['قيد الانتظار', 'pending', 'both'], ['جاري التنفيذ', 'processing', 'both'], ['معلّق', 'on-hold', 'both'], ['جاهز للشحن', 'ready-shipping', 'both'], ['قيد الشحن', 'in-shipping', 'both'],
  ['تم RTC', null, 'from_system'], ['مكتمل', 'completed', 'both'], ['استرجاع', 'refunded', 'both'], ['ملغي', 'cancelled', 'both']].map(([system_status, woo_status, direction], i) => ({ id: i + 1, system_status, woo_status, direction, sort: i + 1 }));
// order_items.status check list (0007): block 29's 11 sub-statuses or ''
const ITEM_STATUSES = ['', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المورد للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المورد للمخزن', 'تم الشحن للمخزن', 'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمورد'];
function ordersSeed() {
  const ago = (d) => { const t = new Date(Date.now() - d * 864e5); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const vendor = (n, woo, name, status = 'active') => ({ id: VND(n), woo_vendor_id: woo, name, aliases: [], phone: null, email: null, status, commission_pct: null, raw: { id: woo }, created_at: T0, updated_at: T0 });
  const product = (id, sku, name, image_url, v) => ({ id, sku, name, image_url, vendor_id: VND(v), price: null, status: 'publish', raw: { id }, updated_at: T0 });
  const order = (o) => ({ number: String(o.id), customer_city: null, customer_address: null, payment_method: 'cod', payment_title: 'الدفع عند الاستلام', confirm: 'غير مؤكد', confirm_at: null, confirm_note: null, deposit: 0, currency: 'EGP', note: null, customer_note: null, cancel: null, ret: null, raw: { id: o.id }, woo_updated_at: o.placed_at, synced_at: o.placed_at, created_at: o.placed_at, updated_at: o.placed_at, ...o });
  const sub = (id, order_id, v, woo_order_id, woo_status, total) => ({ id, order_id, vendor_id: VND(v), woo_order_id, woo_status, total, dokan_earning: null, commission: null, raw: { id: woo_order_id }, updated_at: T0 });
  const line = (o) => ({ sub_order_id: null, product_id: null, qty: 1, status: '', expected_at: null, comment: null, ready_at: null, waybill: null, pulled: false, ret: null, store: null, removed: false, raw: { id: o.id }, updated_at: T0, ...o, vendor_id: VND(o.vendor_id) });
  return {
    vendors: [vendor(1, 2376, 'Art Craft'), vendor(2, 44, 'Antikiano'), vendor(3, 2047, 'Bian eg', 'inactive')], // Bian eg: no order
    products: [product(9001, 'IBTA4040PAHC000013', 'Cushion', IMG.cushion, 1), product(9002, 'IBTAMCTOWM200X10014', 'Macrame Curtain', IMG.curtain, 2),
      product(9003, 'IBTB0CSW6RFTM', 'Macrame Feathers', null, 2), product(9004, 'IBTK20035BBLM000003214', 'Boho mirror', IMG.cushion, 3)],
    orders: [
      order({ id: 181668, customer_name: 'سلوى زيتوني', customer_phone: '01200007052', customer_city: 'القاهرة', customer_address: 'مدينة نصر', status: 'جاري التنفيذ', woo_status: 'processing', total: 3541, customer_note: 'اتصلوا قبل التوصيل', placed_at: ago(6) }),
      order({ id: 180686, customer_name: 'هدير عميل', customer_phone: '01000007030', status: 'جاري التنفيذ', woo_status: 'processing', confirm: 'مؤكد بدون عربون', confirm_at: ago(5).slice(0, 10), total: 1002, placed_at: ago(8) }),
      order({ id: 180656, customer_name: XSS_NAME, customer_phone: '01000007016', status: 'معلّق', woo_status: 'on-hold', confirm: 'في انتظار الرد', total: 899, note: 'هتأكد الأسبوع الجاي', placed_at: ago(10) }),
      order({ id: 150001, customer_name: 'أوردر قديم', customer_phone: '01000000000', status: 'مكتمل', woo_status: 'completed', total: 500, placed_at: ago(400) }),
    ],
    subOrders: [sub(1, 181668, 1, 181669, 'processing', 1002), sub(2, 181668, 2, 181670, 'on-hold', 2539)],
    orderItems: [
      line({ id: 5001, order_id: 181668, sub_order_id: 1, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002, vendor_id: 1 }),
      line({ id: 5002, order_id: 181668, sub_order_id: 2, product_id: 9002, sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', total: 2539, vendor_id: 2, status: 'مؤكد', comment: 'تم تبليغ المورد' }),
      line({ id: 5003, order_id: 180686, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002, vendor_id: 1 }),
      line({ id: 5004, order_id: 180686, sku: 'IBTK5050MRHC000010', name: 'Cushion Cover', total: 601, vendor_id: 1, removed: true }),
      line({ id: 5005, order_id: 180656, product_id: 9003, sku: 'IBTB0CSW6RFTM', name: 'Macrame Feathers', total: 899, vendor_id: 2 }),
      line({ id: 5006, order_id: 150001, sku: 'IBT-OLD-1', name: 'قطعة قديمة', total: 500, vendor_id: 1 }),
    ],
    statusMap: STATUS_MAP.map((r) => ({ ...r })),
  };
}
// `u` below is the caller: its profile row plus the token's aal (tokenUser). 0008: a profile enrolled in 2FA (twofa) on a token
// that is not aal2 gets nothing from has_perm / is_admin.
const aalGated = (u) => !!u.twofa && u.aal !== 'aal2';
// has_perm of 0001 + 0008: 'N' for a profile that is not active or aal-gated, 'F' for admin, else custom_perms, then the role's matrix
const hasPerm = (u, key) => (u.status !== 'active' || aalGated(u) ? 'N' : u.role_id === 'admin' ? 'F' : (u.custom_perms || {})[key] || ROLES.find((r) => r.id === u.role_id).permissions[key] || 'N');
const isAdmin = (u) => u.status === 'active' && u.role_id === 'admin' && !aalGated(u);
// mask_phone of 0007: the first 3 and last 4 characters (10 or more), else •••• and the last 2
const maskPhone = (p) => (!p ? p : p.length < 10 ? '••••' + p.slice(-2) : p.slice(0, 3) + '••••' + p.slice(-4));
// a row of orders_v as `u` reads it: every column but raw, the phone through order_customer_phone (full with
// sensitive.customer_phone = F, masked otherwise, null without orders.view)
const viewRow = (u, o) => ({ ...Object.fromEntries(COLUMNS.orders_v.map((c) => [c, o[c] ?? null])), customer_phone: hasPerm(u, 'orders.view') === 'N' ? null : hasPerm(u, 'sensitive.customer_phone') === 'F' ? o.customer_phone : maskPhone(o.customer_phone) });
// the columns the guard triggers and the update grants of 0007 allow, by the permission they need
const ORDER_STATUS_COLS = ['status', 'confirm', 'confirm_at', 'confirm_note', 'cancel', 'ret']; const ORDER_EDIT_COLS = ['note', 'customer_city', 'customer_address', 'deposit'];
const ITEM_COLS = ['status', 'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store'];
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const authUser = (u, factors) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors, created_at: T0 });
const claims = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return null; } };

export async function installSupabaseMock(page) {
  const issued = new Set(); const refresh = new Map(); let n = 0;
  // logoutScopes: the ?scope= of each /logout; afterLogout: requests that reached the origin after the first logout;
  // activityDelayMs: hold every log_activity call that long (a stalled network); recovers: emails sent a reset link;
  // lookups: the ident of each email_for_identifier call. activity: each log_activity body; activityRows: the activity_log
  // table it fills ({ id, at, actor, action, new_value }; a spec may seed older rows); prefs: the user_prefs table
  // ({ user_id, key, data }); prefsDown: every user_prefs write answers 503 (the server is unreachable).
  // alerts: the alerts table (ALERTS; a spec may change it before sign-in); alertReads: the alert_reads table ({ alert_id, user_id }).
  // orders tables: orders (with the full phone and raw), orderItems, subOrders, vendors, products, statusMap (ordersSeed());
  // patches: each successful PATCH as { table: 'orders'|'order_items', id, ...columns }; ordersDown: those tables answer 503.
  // pushes: each woo-sync push_status as { action, order_id, status, result, reason? }; syncs: each other woo-sync call ({ action });
  // wooDown: woo-sync answers 502 (WooCommerce unreachable).
  // profiles: this install's copy of USERS (the 2FA RPCs change twofa there); factors: auth.mfa_factors ({ id, user_id,
  // friendly_name, factor_type, status }; M03's verified factor seeded); enrolls / unenrolls: each POST / DELETE of a factor;
  // twofaCalls: each mark_twofa_enrolled / mark_twofa_disabled call as { fn, aal, result }; twofaRefused: both answer 42501
  // aal2_required whatever the token (a server that does not take the flag).
  const profiles = USERS.map((x) => ({ ...x, custom_perms: { ...x.custom_perms } }));
  const factors = profiles.filter((x) => x.twofa).map((x) => ({ id: 'f-' + x.member_code, user_id: x.id, friendly_name: 'Authenticator', factor_type: 'totp', status: 'verified', created_at: T0, updated_at: T0 }));
  const mock = { profiles, factors, enrolls: [], unenrolls: [], twofaCalls: [], twofaRefused: false, rateLimited: false, logouts: 0, logoutScopes: [], afterLogout: 0, activityDelayMs: 0, activity: [], activityRows: [], prefs: [], prefsDown: false, alerts: ALERTS(), alertReads: [], userUpdates: [], recovers: [], lookups: [], requests: [], unhandled: [],
    ...ordersSeed(), patches: [], ordersDown: false, pushes: [], syncs: [], wooDown: false };
  let activityId = 0;
  const profileOf = (id) => mock.profiles.find((x) => x.id === id) || null;
  const userJson = (u) => authUser(u, mock.factors.filter((x) => x.user_id === u.id).map(({ user_id, ...x }) => ({ ...x })));
  const session = (u, aal = 'aal1') => {
    const iat = Math.floor(Date.now() / 1000); n += 1;
    const access_token = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: iat }], iat, exp: iat + 3600, session_id: 's-' + u.id, n }), 'mock'].join('.');
    const refresh_token = 'rt-' + n; issued.add(access_token); refresh.set(refresh_token, { id: u.id, aal });
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: iat + 3600, refresh_token, user: userJson(u) };
  };
  // URL fragment of a password-recovery link for `email`, as GoTrue's implicit flow puts it on the redirect.
  mock.recoveryFragment = (email) => { const s = session(mock.profiles.find((u) => u.email === email)); return new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: '3600', refresh_token: s.refresh_token, token_type: 'bearer', type: 'recovery' }).toString(); };
  // mock.attach(otherPage): a second tab of the same context answered by this same mock (same sessions, same counters)
  const attach = async (p) => {
  await p.addInitScript(([url, key]) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: key, realtime: false }; }, [SUPABASE_URL, ANON_KEY]); // no Realtime socket to mock
  await p.route(SUPABASE_URL + '/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method(); const hd = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': hd['access-control-request-headers'] || '*', 'access-control-expose-headers': 'x-supabase-api-version' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify(body) });
    const empty = (status) => route.fulfill({ status, headers: cors });
    const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
    if (method === 'OPTIONS') return empty(204);
    if (mock.logouts > 0) mock.afterLogout += 1;
    mock.requests.push(method + ' ' + path);
    if (hd.apikey !== ANON_KEY) return json(401, { message: 'No API key found in request' });
    const bearer = (hd.authorization || '').replace(/^Bearer /, '');
    // the caller: a snapshot of its profile row with the token's aal (writes go through profileOf)
    const tokenUser = () => { const row = issued.has(bearer) ? profileOf(claims(bearer).sub) : null; return row ? { ...row, aal: claims(bearer).aal } : null; };
    const aal = () => (issued.has(bearer) ? claims(bearer).aal : null);

    if (path.startsWith('/auth/v1/')) {
      if (method === 'POST' && path === '/auth/v1/token') {
        const b = body();
        if (url.searchParams.get('grant_type') === 'refresh_token') { const r = refresh.get(b.refresh_token); return r ? json(200, session(profileOf(r.id), r.aal)) : json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }); }
        const u = mock.profiles.find((x) => x.email === b.email && b.password === DEV_PW);
        return u ? json(200, session(u)) : json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
      }
      if (method === 'POST' && path === '/auth/v1/recover') { mock.recovers.push(body().email); return json(200, {}); } // answers the same for unknown emails
      const u = tokenUser();
      if (!u) return json(401, { code: 'bad_jwt', message: 'invalid JWT' });
      if (method === 'GET' && path === '/auth/v1/user') return json(200, userJson(u));
      if (method === 'PUT' && path === '/auth/v1/user') { mock.userUpdates.push({ email: u.email, ...body() }); return json(200, userJson(u)); }
      if (method === 'POST' && path === '/auth/v1/logout') { // GoTrue: local = this session, others = every other one, global = all
        const scope = url.searchParams.get('scope') || 'global'; mock.logouts += 1; mock.logoutScopes.push(scope);
        for (const t of [...issued]) { const mine = claims(t).sub === u.id; if (scope === 'local' ? t === bearer : scope === 'others' ? mine && t !== bearer : mine) issued.delete(t); }
        return empty(204);
      }
      // MFA: enroll a TOTP factor (unverified until its first verify; GoTrue refuses a second factor with the same friendly
      // name), challenge / verify one of the caller's factors (→ an aal2 session; the factor becomes verified), unenroll
      // (a verified factor needs an aal2 token: 403 insufficient_aal).
      if (method === 'POST' && path === '/auth/v1/factors') {
        const b = body();
        if (b.factor_type !== 'totp') return json(422, { code: 'validation_failed', message: 'mock: only totp factors are enrolled' });
        if (mock.factors.some((x) => x.user_id === u.id && x.friendly_name === b.friendly_name)) return json(422, { code: 'mfa_factor_name_conflict', message: `A factor with the friendly name "${b.friendly_name}" for this user already exists` });
        n += 1; const id = 'f-new-' + n;
        mock.factors.push({ id, user_id: u.id, friendly_name: b.friendly_name, factor_type: 'totp', status: 'unverified', created_at: T0, updated_at: T0 });
        mock.enrolls.push({ id, friendly_name: b.friendly_name, aal: u.aal });
        return json(200, { id, type: 'totp', friendly_name: b.friendly_name, totp: { qr_code: QR_SVG, secret: TOTP_SECRET, uri: `otpauth://totp/Ibtekr:${encodeURIComponent(u.email)}?secret=${TOTP_SECRET}&issuer=Ibtekr` } });
      }
      const f = /^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/.exec(path);
      const factor = f ? mock.factors.find((x) => x.id === f[1] && x.user_id === u.id) : null;
      if (method === 'POST' && factor) {
        if (f[2] === 'challenge') return json(200, { id: 'ch-' + f[1], type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
        const b = body();
        if (b.challenge_id !== 'ch-' + f[1] || b.code !== TOTP_CODE) return json(422, { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' });
        factor.status = 'verified';
        return json(200, session(u, 'aal2'));
      }
      const del = /^\/auth\/v1\/factors\/([^/]+)$/.exec(path);
      if (method === 'DELETE' && del) {
        const i = mock.factors.findIndex((x) => x.id === del[1] && x.user_id === u.id);
        if (i < 0) return json(404, { code: 'mfa_factor_not_found', message: 'Factor not found' });
        if (mock.factors[i].status === 'verified' && u.aal !== 'aal2') return json(403, { code: 'insufficient_aal', message: 'AAL2 required to unenroll verified factor' });
        mock.unenrolls.push({ id: del[1], aal: u.aal }); mock.factors.splice(i, 1);
        return json(200, { id: del[1] });
      }
    }

    if (path.startsWith('/rest/v1/')) {
      if (bearer !== ANON_KEY && !issued.has(bearer)) return json(401, { code: 'PGRST301', message: 'JWT could not be decoded', details: null, hint: null });
      const u = tokenUser();
      if (method === 'POST' && path === '/rest/v1/rpc/email_for_identifier') {
        if (mock.rateLimited) return json(400, { code: 'P0001', details: null, hint: null, message: 'rate_limited' });
        mock.lookups.push(String(body().ident || ''));
        const d = String(body().ident || '').replace(/[\s-]/g, ''); // phone-only, like 0001_identity.sql: anything else → no rows
        const x = /^[0-9]{11}$/.test(d) ? mock.profiles.find((y) => y.phone === d) : null;
        return json(200, x ? [{ email: x.email, status: x.status }] : []);
      }
      if (!u) return json(401, { code: '42501', message: 'permission denied', details: null, hint: null }); // anon: no grants below
      // 0008: profiles.twofa follows these two definer RPCs; both need an aal2 token (enrolled: also a verified TOTP factor of the
      // caller), else 42501 'aal2_required' (PostgREST: 403 for a signed-in caller); void → 204
      const mfa = /^\/rest\/v1\/rpc\/(mark_twofa_enrolled|mark_twofa_disabled)$/.exec(path);
      if (method === 'POST' && mfa) {
        const on = mfa[1] === 'mark_twofa_enrolled';
        const ok = !mock.twofaRefused && u.aal === 'aal2' && (!on || mock.factors.some((x) => x.user_id === u.id && x.factor_type === 'totp' && x.status === 'verified'));
        mock.twofaCalls.push({ fn: mfa[1], aal: u.aal, result: ok ? 'ok' : 'aal2_required' });
        if (!ok) return json(403, { code: '42501', details: null, hint: null, message: 'aal2_required' });
        profileOf(u.id).twofa = on;
        return empty(204);
      }
      const table = /^\/rest\/v1\/(profiles|roles)$/.exec(path);
      if (method === 'GET' && table) {
        const cols = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim());
        const bad = cols.find((c) => c !== '*' && !COLUMNS[table[1]].includes(c));
        if (bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${table[1]}.${bad} does not exist` });
        // RLS profiles_select: own row, or every row with has_perm('settings.view') <> 'N'; roles: everyone signed in.
        const rows = table[1] === 'roles' ? ROLES : viewPerm(u) !== 'N' ? mock.profiles : mock.profiles.filter((x) => x.id === u.id);
        return json(200, cols.includes('*') ? rows : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))));
      }
      const emulated = /^\/rest\/v1\/(user_prefs|activity_log|alerts|alert_reads)$/.exec(path);
      const METHODS = { user_prefs: ['GET', 'POST', 'DELETE'], activity_log: ['GET'], alerts: ['GET'], alert_reads: ['GET', 'POST'] };
      if (emulated && METHODS[emulated[1]].includes(method)) {
        const t = emulated[1]; const f = readFilters(url.searchParams, t); const sel = readSelect(t, url.searchParams.get('select'));
        if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'mock: only eq. filters (and in. on alert_reads.alert_id) are emulated, got ' + f.bad });
        if (method === 'GET' && sel.bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${sel.bad} does not exist` });
        // a GET's order=col.dir and limit, then its select
        const answer = (rows) => {
          const [col, dir] = (url.searchParams.get('order') || 'id.asc').split('.'); const limit = Number(url.searchParams.get('limit')) || Infinity;
          rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
          return json(200, rows.slice(0, limit).map(sel.pick));
        };
        // RLS activity_log_select (0006): an active user's own rows; every row with settings.view
        if (t === 'activity_log') return answer(mock.activityRows.filter((r) => (viewPerm(u) !== 'N' || (u.status === 'active' && r.actor === u.id)) && f.match(r)));
        // RLS alerts_select (0002): an active user sees the alerts addressed to them or to their role
        const visible = (a) => u.status === 'active' && (a.user_id === u.id || a.role_id === u.role_id);
        if (t === 'alerts') return answer(mock.alerts.filter((a) => visible(a) && f.match(a)));
        if (t === 'alert_reads') {
          // RLS alert_reads_select (0006): own marks; alert_reads_insert: own marks of a visible alert. Granted select + insert only.
          if (method === 'GET') return answer(mock.alertReads.filter((r) => r.user_id === u.id && f.match(r)));
          const rows = [].concat(body()); const ignore = /resolution=ignore-duplicates/.test(hd.prefer || ''); // upsert(…, { ignoreDuplicates }) = on conflict do nothing
          const oc = url.searchParams.get('on_conflict'); // the primary key (alert_id, user_id) is the only unique constraint
          if (oc && oc !== 'alert_id,user_id') return json(400, { code: '42P10', details: null, hint: null, message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' });
          if (rows.some((r) => r.user_id !== u.id || !mock.alerts.some((a) => a.id === r.alert_id && visible(a)))) return json(401, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "alert_reads"' });
          const same = (a) => (b) => a.alert_id === b.alert_id && a.user_id === b.user_id; const fresh = []; let dup = false; // one statement: all rows or none
          for (const r of rows) { if (mock.alertReads.some(same(r)) || fresh.some(same(r))) dup = true; else fresh.push({ alert_id: r.alert_id, user_id: r.user_id }); }
          if (dup && !ignore) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "alert_reads_pkey"' });
          mock.alertReads.push(...fresh);
          return json(201, []);
        }
        // RLS user_prefs_owner (0006): the active owner only, every operation
        const own = (r) => r.user_id === u.id && u.status === 'active' && f.match(r);
        if (method === 'GET') return json(200, mock.prefs.filter(own).map(sel.pick));
        if (mock.prefsDown) return json(503, { code: 'PGRST000', details: null, hint: null, message: 'mock: user_prefs is down' });
        if (method === 'DELETE') { for (let i = mock.prefs.length - 1; i >= 0; i -= 1) if (own(mock.prefs[i])) mock.prefs.splice(i, 1); return empty(204); }
        const rows = [].concat(body()); const merge = /resolution=merge-duplicates/.test(hd.prefer || ''); // upsert on (user_id, key)
        if (rows.some((r) => r.user_id !== u.id || u.status !== 'active')) return json(401, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "user_prefs"' });
        if (!merge && rows.some((r) => mock.prefs.some((x) => x.user_id === r.user_id && x.key === r.key))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "user_prefs_pkey"' });
        for (const r of rows) { const i = mock.prefs.findIndex((x) => x.user_id === r.user_id && x.key === r.key); const row = { user_id: r.user_id, key: r.key, data: r.data ?? {} }; if (i >= 0) mock.prefs[i] = row; else mock.prefs.push(row); }
        return json(201, []);
      }
      const ot = /^\/rest\/v1\/(orders|orders_v|order_items|sub_orders|vendors|products|status_map)$/.exec(path);
      const OT_METHODS = { orders: ['PATCH'], orders_v: ['GET'], order_items: ['GET', 'PATCH'], sub_orders: ['GET'], vendors: ['GET'], products: ['GET'], status_map: ['GET'] };
      if (ot && OT_METHODS[ot[1]].includes(method)) {
        const t = ot[1]; const f = readFilters(url.searchParams, t);
        const denied = (message) => json(403, { code: '42501', details: null, hint: null, message });
        if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'mock: unexpected filter ' + f.bad });
        if (mock.ordersDown) return json(503, { code: 'PGRST000', details: null, hint: null, message: 'mock: the orders tables are down' });
        if (method === 'GET') {
          const asked = url.searchParams.get('select') || '*'; const graded = t === 'order_items' || t === 'sub_orders'; // column-level select grants: no raw, so no *
          if (graded && asked.split(',').some((c) => c.trim() === '*')) return denied('permission denied for table ' + t);
          const sel = readSelect(t, asked);
          if (sel.bad) return graded && sel.bad === t + '.raw' ? denied('permission denied for table ' + t) : json(400, { code: '42703', details: null, hint: null, message: `column ${sel.bad} does not exist` });
          // RLS (0007, 0002 status_map): vendors with vendors.view, every other table with orders.view
          const visible = hasPerm(u, t === 'vendors' ? 'vendors.view' : 'orders.view') !== 'N';
          const rows = t === 'orders_v' ? mock.orders.map((o) => viewRow(u, o)) : t === 'order_items' ? mock.orderItems : t === 'sub_orders' ? mock.subOrders : t === 'vendors' ? mock.vendors : t === 'products' ? mock.products : mock.statusMap;
          return json(200, pageOf(visible ? rows.filter(f.match) : [], url.searchParams).map(sel.pick));
        }
        // PATCH: one row named by id=eq.… (else 400, like Supabase's safeupdate guard for an UPDATE without WHERE); update grants
        // on the guard columns only, no returning row (select is not granted on every column); RLS using orders.view (else 0
        // rows, silently); the guard triggers and `with check` → 42501. One statement: every row or none.
        if (!(url.searchParams.get('id') || '').startsWith('eq.')) return json(400, { code: '21000', details: null, hint: null, message: 'mock: a PATCH on ' + t + ' names its row (id=eq.…): UPDATE requires a WHERE clause' });
        const b = body(); const keys = Object.keys(b); const cols = t === 'orders' ? ORDER_STATUS_COLS.concat(ORDER_EDIT_COLS) : ITEM_COLS;
        if (/return=representation/.test(hd.prefer || '') || url.searchParams.has('select') || keys.some((k) => !cols.includes(k))) return denied('permission denied for table ' + t);
        const rows = hasPerm(u, 'orders.view') === 'N' ? [] : (t === 'orders' ? mock.orders : mock.orderItems).filter(f.match);
        const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
        for (const r of rows) {
          const changed = keys.filter((k) => !same(r[k], b[k]));
          if ((t === 'order_items' ? changed.length > 0 : changed.some((k) => ORDER_STATUS_COLS.includes(k))) && hasPerm(u, 'orders.status') !== 'F') return denied(t === 'orders' ? 'orders.status = F is required to change an order status or confirmation' : 'orders.status = F is required to change an order line');
          if (t === 'orders' && changed.some((k) => ORDER_EDIT_COLS.includes(k)) && hasPerm(u, 'orders.edit') === 'N') return denied('orders.edit is required to change an order note, address or deposit');
          if (hasPerm(u, 'orders.status') !== 'F' && hasPerm(u, 'orders.edit') === 'N') return denied(`new row violates row-level security policy for table "${t}"`);
        }
        if (t === 'orders' && 'status' in b && !mock.statusMap.some((x) => x.system_status === b.status)) return json(409, { code: '23503', details: null, hint: null, message: 'insert or update on table "orders" violates foreign key constraint "orders_status_fkey"' });
        if (t === 'order_items' && 'status' in b && !ITEM_STATUSES.includes(b.status)) return json(400, { code: '23514', details: null, hint: null, message: 'new row for relation "order_items" violates check constraint "order_items_status_check"' });
        const at = new Date().toISOString();
        for (const r of rows) { Object.assign(r, b, { updated_at: at }); mock.patches.push({ table: t, id: r.id, ...b }); }
        return empty(204);
      }
      if (method === 'POST' && path === '/rest/v1/rpc/log_activity') {
        if (mock.activityDelayMs) await new Promise((r) => setTimeout(r, mock.activityDelayMs));
        const b = body(); mock.activity.push({ ...b, aal: aal() });
        activityId += 1; mock.activityRows.push({ id: activityId, at: new Date().toISOString(), actor: u.id, action: b.action, new_value: b.new_value ?? null }); // actor / at / id: the server's (0002 trigger)
        return empty(204).catch(() => {}); // the page may be gone after a long delay
      }
    }
    // woo-sync (supabase/functions/woo-sync, verify_jwt false: it checks the member's JWT itself): push_status needs
    // orders.status = F, every other action admin; push_status is skipped when the status is not the stored one ('stale')
    // or has no WooCommerce slug ('no_woo_status': تم RTC), else the order's woo_status follows the slug.
    if (method === 'POST' && path === '/functions/v1/woo-sync') {
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      if (!u || !(action === 'push_status' ? hasPerm(u, 'orders.status') === 'F' : isAdmin(u))) return json(401, { error: 'unauthorized' });
      if (mock.wooDown) return json(502, { error: 'woo_error' });
      if (action === 'push_status') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id));
        if (!o) return json(404, { error: 'order_not_found' });
        const slug = (mock.statusMap.find((x) => x.system_status === b.status) || {}).woo_status || null;
        const reason = b.status !== o.status ? 'stale' : !slug ? 'no_woo_status' : null;
        if (!reason) o.woo_status = slug;
        mock.pushes.push({ action, order_id: o.id, status: b.status, result: reason ? 'skipped' : 'ok', ...(reason ? { reason } : {}) });
        return json(200, reason ? { action, result: 'skipped', reason, counts: { pushed: 0 } } : { action, result: 'ok', conflict: false, counts: { pushed: 1 } });
      }
      const hook = SUPABASE_URL + '/functions/v1/woo-webhook';
      // 'all' answers like woo-sync's pull(): each part's counts as its cursorPull / pullVendors return them (woo-write.js writeOrderPage)
      if (action === 'all') { mock.syncs.push({ action }); return json(200, { action, result: 'ok', counts: { vendors: { vendors: mock.vendors.length, pages: 1, done: true }, products: { products: mock.products.length, pages: 1, done: true }, orders: { orders: mock.orders.length, sub_orders: mock.subOrders.length, skipped: 0, conflicts: 0, pages: 1, done: true } } }); }
      if (action === 'register_webhooks') {
        if (b.delivery_url !== undefined && b.delivery_url !== hook) return json(400, { error: 'delivery_url_mismatch' });
        mock.syncs.push({ action });
        const webhooks = ['order.created', 'order.updated', 'product.created', 'product.updated'].map((topic, i) => ({ id: 101 + i, name: 'ibtekr-ops:' + topic, topic, status: 'active', delivery_url: hook }));
        return json(200, { action, result: 'ok', counts: { created: 4, updated: 0, unchanged: 0 }, webhooks });
      }
      return json(400, { error: 'unknown_action' });
    }
    mock.unhandled.push(method + ' ' + path);
    return json(404, { message: 'not mocked: ' + method + ' ' + path });
  });
  };
  mock.attach = attach;
  await attach(page);
  return mock;
}
