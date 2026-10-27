// Test-only stand-in for the Supabase project: answers exactly the auth / PostgREST / Storage / Edge Function calls supabase-js
// 2.118 makes for the login flow, the dashboard, the orders page and the vendors page, with the three dev users of
// tools/seed-dev-users.sql (+ M03, a mock-only 2FA user, M04, a mock-only accounts user: orders.status N,
// sensitive.customer_phone N, sensitive.vendor_bank F, and M05, a mock-only «متابعة الموردين» user: vendors.edit F,
// vendors.toggle N, no sensitive key).
// Strict like the real thing: apikey required, PostgREST bearer must be the anon key or a token issued here,
// `select` columns checked against supabase/migrations (0001, 0002, 0006, 0007, 0009, 0010, 0011), RLS of each emulated table, the column-level
// grants and guard triggers of the orders tables (0007) and of the vendors tables (0011: the per-column guard of phase 3's
// decision 8, vendor_rates / vendor_bank behind their sensitive keys, the private bucket vendor-contracts with its size / mime /
// layout rules and signed URLs), the maker logins of phase 3.1 as the plan's contract for 0012 (vendor_logins: column-list
// select without secret_id, insert / update for the admin or vendors.edit = F, the guard refusing status = active and the
// server columns, 23505 on a duplicate username, the two Vault RPCs vendor_login_set_password / vendor_login_reveal with
// 42501 / 22023 / 0A000, every reveal and every password set logged by the server; vendors.status taking leave), woo-sync's
// push_status contract, the aal2 rule of has_perm and the 2FA RPCs (0008) with GoTrue's MFA endpoints (enroll / challenge /
// verify / unenroll), and the brands of phase 3.2 as the plan's contract for 0013 (brands / brand_owners / brand_rates: column-list
// insert grants, update of name / code / aliases on brands only, no upsert and no delete, RLS by vendors.view / vendors.edit = F /
// sensitive.commission, the guards brand_owners_guard (22023 'since before the last transfer' / 'same vendor') and the name index
// (23505 brands_name_key), the vendors insert trigger making the automatic brand + owner row, the delete guard
// vendors_brands_guard_delete (23503 naming brand_owners_vendor_id_fkey) and the cascade of the origin's brands). Not a product feature.
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
export const TEST_PW = 'Test1234'; // the fake temporary password of the mock's maker login (Antikiano) and of the specs
export const TOTP_CODE = '123456'; // the code every mocked authenticator accepts (M03's and any factor enrolled in a spec)
export const TOTP_SECRET = 'MOCKTOTPSECRETAAAAAAAAAA'; // the base32 key a mocked enrolment hands out (not a real secret)
// GoTrue answers the QR as raw SVG markup (supabase-js prefixes `data:image/svg+xml;utf-8,`); the '#' must survive as an <img>
export const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="#000"/></svg>';
const ANON_KEY = 'mock-anon-key';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-10-22T00:00:00Z';
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
export const CONTRACT_EXPIRES = ymd(new Date(Date.now() + 20 * 86400000)); // within 30 days of the clock: the «expiring» branch
export const USERS = [
  { id: ADMIN, member_code: 'M01', name: 'صفوت كمال', email: 'admin.dev@ibtekr.local', phone: '01000000001', role_id: 'admin', title: 'المؤسس والمدير العام', dept: 'الإدارة', manager_id: null, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000002', member_code: 'M02', name: 'سارة أحمد', email: 'ops.dev@ibtekr.local', phone: '01000000002', role_id: 'ops', title: 'مديرة العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000003', member_code: 'M03', name: 'محمد علي', email: 'twofa.dev@ibtekr.local', phone: '01000000003', role_id: 'ops', title: 'العمليات', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: true, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000004', member_code: 'M04', name: 'منى حسن', email: 'accounts.dev@ibtekr.local', phone: '01000000004', role_id: 'accounts', title: 'الحسابات', dept: 'الحسابات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000005', member_code: 'M05', name: 'هدى سمير', email: 'vf.dev@ibtekr.local', phone: '01000000005', role_id: 'vendors_followup', title: 'متابعة الموردين', dept: 'العمليات', manager_id: ADMIN, status: 'active', twofa: false, custom_perms: {}, created_at: T0 },
  { id: '00000000-0000-4000-8000-000000000099', member_code: 'M99', name: 'مشاهد تجريبي', email: 'viewer.dev@ibtekr.local', phone: '01000000099', role_id: 'viewer', title: 'مشاهد', dept: 'الإدارة', manager_id: ADMIN, status: 'suspended', twofa: false, custom_perms: {}, created_at: T0 },
];
// permissions: the keys the emulated tables read, as in 0003_seed_roles.sql
const ROLES = [
  { id: 'admin', name: 'أدمن', description: 'كل الصلاحيات — المالك والمديرين', is_system: true, permissions: { 'settings.view': 'F', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'F', 'vendors.view': 'F', 'vendors.edit': 'F', 'vendors.toggle': 'F', 'sensitive.customer_phone': 'F', 'sensitive.vendor_bank': 'F', 'sensitive.commission': 'F' }, sort: 1 },
  { id: 'ops', name: 'عمليات', description: 'الأوردرات والمخزن والتجميع والشحن', is_system: true, permissions: { 'settings.view': 'P', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'P', 'vendors.view': 'F', 'vendors.edit': 'P', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'F', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 2 },
  { id: 'accounts', name: 'حسابات', description: 'المصروفات والتحويلات وكشوف الموردين', is_system: true, permissions: { 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'F', 'vendors.edit': 'N', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'F', 'sensitive.commission': 'N' }, sort: 4 },
  { id: 'vendors_followup', name: 'متابعة الموردين', description: 'تبليغ الموردين ومتابعة التأخير', is_system: true, permissions: { 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'N', 'vendors.view': 'F', 'vendors.edit': 'F', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 5 },
  { id: 'viewer', name: 'مشاهد', description: 'عرض بس من غير تعديل', is_system: true, permissions: { 'settings.view': 'N', 'orders.view': 'P', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'P', 'vendors.edit': 'N', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 6 },
];
const COLUMNS = { // supabase/migrations/0001_identity.sql, 0002_system.sql (activity_log, alerts, status_map), 0006_dashboard.sql (user_prefs,
  // alert_reads), 0007_orders.sql (orders_v; order_items / sub_orders: the columns granted to authenticated, i.e. all but raw),
  // 0009 (products.permalink), 0010 (orders_v.customer_state: the governorate's code on the website; woo_states: its names),
  // 0011 (order_items.commission_rate / fee; the team's vendors columns; vendor_rates; vendor_bank)
  profiles: ['id', 'member_code', 'name', 'email', 'phone', 'role_id', 'title', 'dept', 'manager_id', 'status', 'twofa', 'custom_perms', 'created_at'],
  roles: ['id', 'name', 'description', 'is_system', 'permissions', 'sort'],
  user_prefs: ['user_id', 'key', 'data', 'updated_at'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
  alerts: ['id', 'at', 'kind', 'title', 'body', 'role_id', 'user_id', 'entity', 'entity_id', 'read_at'],
  alert_reads: ['alert_id', 'user_id', 'read_at'],
  orders_v: ['id', 'number', 'customer_name', 'customer_phone', 'customer_state', 'customer_city', 'customer_address', 'payment_method', 'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note', 'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'synced_at', 'created_at', 'updated_at'],
  order_items: ['id', 'order_id', 'sub_order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'status', 'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'removed', 'updated_at', 'commission_rate', 'commission_fee'],
  sub_orders: ['id', 'order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'updated_at'],
  vendors: ['id', 'woo_vendor_id', 'name', 'aliases', 'phone', 'email', 'status', 'commission_pct', 'raw', 'created_at', 'updated_at', 'legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contract', 'opening_balance',
    'contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at'], // 0014 (phase 3.3): woo_snapshot is service_role only (a select naming it → 42501, like commission_pct)
  vendor_rates: ['id', 'vendor_id', 'rate', 'flat', 'since', 'set_by', 'created_at'], // 0014: flat
  vendor_category_rates: ['id', 'vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by', 'created_at'], // 0014: sensitive.commission, add-only
  woo_categories: ['id', 'name', 'slug', 'parent_id', 'updated_at'], // 0014: the sync's, vendors.view
  vendor_bank: ['vendor_id', 'method', 'bank_name', 'holder', 'iban', 'wallet', 'updated_by', 'updated_at'],
  vendor_logins: ['vendor_id', 'username', 'email', 'pw_mode', 'status', 'must_change', 'invite_sent_at', 'password_set_at', 'secret_id', 'created_by', 'created_at', 'updated_at'], // 0012 (plan 3.1): secret_id is never granted to the client; created_by is the member's name
  products: ['id', 'sku', 'name', 'image_url', 'permalink', 'vendor_id', 'price', 'status', 'raw', 'updated_at'],
  status_map: ['id', 'system_status', 'woo_status', 'direction', 'sort'],
  woo_states: ['code', 'name', 'updated_at'],
  brands: ['id', 'name', 'code', 'aliases', 'store_vendor_id', 'origin_vendor_id', 'created_by', 'created_at', 'updated_at'], // 0013 (phase 3.2): the select grants are table-level
  brand_owners: ['id', 'brand_id', 'vendor_id', 'since', 'return_on', 'reason', 'set_by', 'created_at'],
  brand_rates: ['id', 'brand_id', 'rate', 'since', 'set_by', 'created_at'],
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
// loaded orders, the images / permalinks of their skus and (Realtime) the names of makers it does not know yet
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
// plus one older than 12 months that the orders page never asks for. Images are inline data: URLs (no outside request);
// permalinks are https URLs on a fake staging host (SITE), never reached (a spec that opens one answers it itself).
// Governorates (0010): 181668 is EG-01 (a name in woo_states), 180656 EG-14 (a code the list has no name for), 180686 none.
export const XSS_NAME = '<img src=x onerror="window.__xss=1">';
export const IBAN = 'EG38000300010000000000000482'; // a made-up IBAN (Bian eg's bank row)
export const CONTRACT_PATH = 'a0000000-0000-4000-8000-000000000002/1700000000000-antikiano.pdf'; // Antikiano's stored contract in vendor-contracts
const SECRET_ID = 'c0000000-0000-4000-8000-000000000001'; // the vault id of Antikiano's temporary password
export const CONTRACT_BYTES = Buffer.from('%PDF-1.4\n% mock contract of Antikiano\n%%EOF\n');
export const SITE = 'https://ibtekr.stage.test';
export const IMG = { cushion: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', curtain: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };
const VND = (n) => 'a0000000-0000-4000-8000-00000000000' + n;
// phase 3.3 (0014): Art Craft's synced store data (no real person: a made-up owner name, a made-up address, links on the fake staging host)
export const ART_PARTS = { street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' };
export const ART_ADDRESS = '12 شارع المعز، القاهرة، الجمالية';
export const ART_SOCIAL = { fb: 'https://www.facebook.com/artcraft.dev', instagram: 'https://www.instagram.com/artcraft.dev', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' };
export const ART_LOGO = SITE + '/wp-content/uploads/artcraft-logo.png'; // never reached: a spec that needs the image answers it itself
export const BRAND = (n) => 'd0000000-0000-4000-8000-00000000000' + n; // the automatic brand of maker n (0013 backfill)
export const NEW_BRAND = (n) => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0'); // the n-th brand inserted on this install (by the popup or the trigger)
// phase 3.2 (decision 7): with installSupabaseMock(page, { transfer: true }) Antikiano's brand is with Bian eg from 8 days ago,
// temporarily (back in 30 days) — order 181668 (6 days ago) falls after that date, 180656 (10 days ago) before it
export const TRANSFER_SINCE = ymd(new Date(Date.now() - 8 * 86400000)); export const TRANSFER_RETURN = ymd(new Date(Date.now() + 30 * 86400000));
// status_map after 0009 (system status ↔ WooCommerce slug): 0007's «تم RTC» row (id 6) became «فشل» = failed, from_woo, sort 10
const STATUS_MAP = [['قيد الانتظار', 'pending', 'both'], ['جاري التنفيذ', 'processing', 'both'], ['معلّق', 'on-hold', 'both'], ['جاهز للشحن', 'ready-shipping', 'both'], ['قيد الشحن', 'in-shipping', 'both'],
  ['فشل', 'failed', 'from_woo', 10], ['مكتمل', 'completed', 'both'], ['استرجاع', 'refunded', 'both'], ['ملغي', 'cancelled', 'both']].map(([system_status, woo_status, direction, sort], i) => ({ id: i + 1, system_status, woo_status, direction, sort: sort || i + 1 }));
// order_items.status check list (0007): block 29's 11 sub-statuses or ''
const ITEM_STATUSES = ['', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المورد للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المورد للمخزن', 'تم الشحن للمخزن', 'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمورد'];
function ordersSeed(opts = {}) {
  const ago = (d) => { const t = new Date(Date.now() - d * 864e5); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const vendor = (n, woo, name, status = 'active', more = {}) => ({ id: VND(n), woo_vendor_id: woo, name, aliases: [], phone: null, email: null, status, commission_pct: null, raw: { id: woo, shop_url: SITE + '/store/' + name.toLowerCase().replace(/\s+/g, '-') + '/' }, created_at: T0, updated_at: T0,
    legal_name: null, category: null, alt_phone: null, address: null, instagram: null, store_url: null, lead_days: 7, deposit_policy: null, notes: null, joined_at: '2026-03-01', contract: null, opening_balance: 0,
    contact_name: null, address_parts: null, social: null, logo_url: null, banner_url: null, woo_payment_methods: null, woo_snapshot: null, push_pending: null, woo_synced_at: null, ...more }); // 0014 (phase 3.3)
  const product = (id, sku, name, image_url, v, slug) => ({ id, sku, name, image_url, permalink: SITE + '/product/' + slug + '/', vendor_id: VND(v), price: null, status: 'publish', raw: { id }, updated_at: T0 });
  const order = (o) => ({ number: String(o.id), customer_state: null, customer_city: null, customer_address: null, payment_method: 'cod', payment_title: 'الدفع عند الاستلام', confirm: 'غير مؤكد', confirm_at: null, confirm_note: null, deposit: 0, currency: 'EGP', note: null, customer_note: null, cancel: null, ret: null, raw: { id: o.id }, woo_updated_at: o.placed_at, synced_at: o.placed_at, created_at: o.placed_at, updated_at: o.placed_at, ...o });
  const sub = (id, order_id, v, woo_order_id, woo_status, total) => ({ id, order_id, vendor_id: VND(v), woo_order_id, woo_status, total, dokan_earning: null, commission: null, raw: { id: woo_order_id }, updated_at: T0 });
  const line = (o) => ({ sub_order_id: null, product_id: null, qty: 1, status: '', expected_at: null, comment: null, ready_at: null, waybill: null, pulled: false, ret: null, store: null, removed: false, commission_rate: null, commission_fee: null, raw: { id: o.id }, updated_at: T0, ...o, vendor_id: VND(o.vendor_id) });
  const rate = (id, v, rate, since, flat = null) => ({ id, vendor_id: VND(v), rate, flat, since, set_by: 'صفوت كمال', created_at: T0 });
  return {
    // 0011: Art Craft and Antikiano with a rate (Antikiano's raised in October), Antikiano with a stored contract, Bian eg (inactive, no order) with a bank row
    // 0014 (phase 3.3): Art Craft carries the synced store data (the owner's name, the address parts, two social links, the site's logo,
    // the payout methods, a last sync); Antikiano has a phone waiting for the site (push_pending); Bian eg is inactive with a store there
    vendors: [vendor(1, 2376, 'Art Craft', 'active', { aliases: ['ArtCraft'], phone: '01000000003', category: 'فنون ولوحات', store_url: SITE + '/store/art-craft/', notes: 'الشحن على المبتكر داخل القاهرة', commission_pct: 35,
      contact_name: 'منى عادل', address: ART_ADDRESS, address_parts: ART_PARTS, social: ART_SOCIAL, instagram: ART_SOCIAL.instagram, logo_url: ART_LOGO, banner_url: SITE + '/wp-content/uploads/artcraft-banner.png', woo_payment_methods: ['bank'], woo_snapshot: { name: 'Art Craft', phone: '01000000003' }, woo_synced_at: T0 }),
      vendor(2, 44, 'Antikiano', 'active', { aliases: ['Antikiano store'], phone: '01000000001', category: 'إكسسوارات ومجوهرات', commission_pct: 45, contract: { path: CONTRACT_PATH, file_name: 'antikiano.pdf', size: CONTRACT_BYTES.length, expires: CONTRACT_EXPIRES, uploaded_by: 'منى حسن', uploaded_at: T0 }, push_pending: ['phone'], woo_synced_at: T0 }),
      vendor(3, 2047, 'Bian eg', 'inactive', { aliases: ['Bian'], phone: '01000000000', category: 'ديكور منزلي' })],
    vendorRates: [rate(1, 1, 35, '2026-03-01'), rate(2, 2, 40, '2026-03-01'), rate(3, 2, 45, '2026-10-01', 10)], // Antikiano's current rate carries the site's flat fee (0014 vendor_rates.flat)
    // 0014: Art Craft's commission on the site's category 15 (set by the sync), and the two category names the sync pulled
    vendorCategoryRates: [{ id: 1, vendor_id: VND(1), woo_category_id: 15, rate: 30, flat: 0, since: '2026-03-01', set_by: 'الموقع', created_at: T0 }],
    wooCategories: [{ id: 15, name: 'ديكور', slug: 'decor', parent_id: 0, updated_at: T0 }, { id: 22, name: 'هدايا', slug: 'gifts', parent_id: 0, updated_at: T0 }],
    // the server's sync rows on Art Craft (actor null, new_value the field names): a change taken from the site, a conflict the site won
    syncActivity: [{ id: 1, at: T0, actor: null, action: 'vendor.sync', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'phone, address_parts' }, { id: 2, at: T0, actor: null, action: 'vendor.sync.conflict', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'name' }, { id: 3, at: T0, actor: null, action: 'vendor.sync.refused', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'social' }],
    vendorBank: [{ vendor_id: VND(3), method: 'bank', bank_name: 'البنك الأهلي المصري', holder: 'Bian Egypt', iban: IBAN, wallet: '01000000000', updated_by: 'منى حسن', updated_at: T0 }],
    // 0012 (plan 3.1): Antikiano with a temporary password in the vault (secret_id → the vault entry), Bian eg with a row but no password yet
    vendorLogins: [{ vendor_id: VND(2), username: 'antikiano', email: 'antikiano.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: T0, secret_id: SECRET_ID, created_by: 'صفوت كمال', created_at: T0, updated_at: T0 },
      { vendor_id: VND(3), username: 'bian.eg', email: 'bian.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: null, secret_id: null, created_by: 'صفوت كمال', created_at: T0, updated_at: T0 }], // bian.eg: a row whose password step was refused (no password yet)
    vault: new Map([[SECRET_ID, TEST_PW]]), // vault.secrets: id → the decrypted secret (never read by the client)
    objects: new Map([[CONTRACT_PATH, { type: 'application/pdf', bytes: CONTRACT_BYTES }]]), // the bucket vendor-contracts
    products: [product(9001, 'IBTA4040PAHC000013', 'Cushion', IMG.cushion, 1, 'cushion'), product(9002, 'IBTAMCTOWM200X10014', 'Macrame Curtain', IMG.curtain, 2, 'macrame-curtain'),
      product(9003, 'IBTB0CSW6RFTM', 'Macrame Feathers', null, 2, 'macrame-feathers'), product(9004, 'IBTK20035BBLM000003214', 'Boho mirror', IMG.cushion, 3, 'boho-mirror')],
    orders: [
      order({ id: 181668, customer_name: 'سلوى زيتوني', customer_phone: '01200007052', customer_state: 'EG-01', customer_city: 'مدينة نصر', customer_address: 'شارع عباس العقاد', status: 'جاري التنفيذ', woo_status: 'processing', total: 3541, customer_note: 'اتصلوا قبل التوصيل\nالدور التالت\nالشقة 12', placed_at: ago(6) }),
      order({ id: 180686, customer_name: 'هدير عميل', customer_phone: '01000007030', status: 'جاري التنفيذ', woo_status: 'processing', confirm: 'مؤكد بدون عربون', confirm_at: ago(5).slice(0, 10), total: 1002, placed_at: ago(8) }),
      order({ id: 180656, customer_name: XSS_NAME, customer_phone: '01000007016', customer_state: 'EG-14', customer_address: 'ش التحرير', status: 'معلّق', woo_status: 'on-hold', confirm: 'في انتظار الرد', total: 899, note: 'هتأكد الأسبوع الجاي', placed_at: ago(10) }),
      order({ id: 150001, customer_name: 'أوردر قديم', customer_phone: '01000000000', status: 'مكتمل', woo_status: 'completed', total: 500, placed_at: ago(400) }),
    ],
    subOrders: [sub(1, 181668, 1, 181669, 'processing', 1002), sub(2, 181668, 2, 181670, 'on-hold', 2539)],
    orderItems: [
      line({ id: 5001, order_id: 181668, sub_order_id: 1, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002, vendor_id: 1, commission_rate: 35, commission_fee: 0 }), // 0011: the website's commission on the line
      line({ id: 5002, order_id: 181668, sub_order_id: 2, product_id: 9002, sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', total: 2539, vendor_id: 2, status: 'مؤكد', comment: 'تم تبليغ المورد', commission_rate: 40, commission_fee: 10 }),
      line({ id: 5003, order_id: 180686, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002, vendor_id: 1 }),
      line({ id: 5004, order_id: 180686, sku: 'IBTK5050MRHC000010', name: 'Cushion Cover', total: 601, vendor_id: 1, removed: true }),
      line({ id: 5005, order_id: 180656, product_id: 9003, sku: 'IBTB0CSW6RFTM', name: 'Macrame Feathers', total: 899, vendor_id: 2 }),
      line({ id: 5006, order_id: 150001, sku: 'IBT-OLD-1', name: 'قطعة قديمة', total: 500, vendor_id: 1 }),
    ],
    // 0013: the automatic brand of each maker (code = the first Latin letter, aliases = the maker's, the store tied, owned since joined_at)
    brands: [[1, 'Art Craft', 'A', ['ArtCraft']], [2, 'Antikiano', 'A', ['Antikiano store']], [3, 'Bian eg', 'B', ['Bian']]].map(([n, name, code, aliases]) => ({ id: BRAND(n), name, code, aliases, store_vendor_id: VND(n), origin_vendor_id: VND(n), created_by: 'system', created_at: T0, updated_at: T0 })),
    brandOwners: [1, 2, 3].map((n) => ({ id: n, brand_id: BRAND(n), vendor_id: VND(n), since: '2026-03-01', return_on: null, reason: null, set_by: 'system', created_at: T0 }))
      .concat(opts.transfer ? [{ id: 4, brand_id: BRAND(2), vendor_id: VND(3), since: TRANSFER_SINCE, return_on: TRANSFER_RETURN, reason: 'إجازة الصيف', set_by: 'صفوت كمال', created_at: T0 }] : []),
    brandRates: [],
    statusMap: STATUS_MAP.map((r) => ({ ...r })),
    wooStates: [['EG-01', 'القاهرة'], ['EG-02', 'الجيزة'], ['EG-03', 'الإسكندرية']].map(([code, name]) => ({ code, name, updated_at: T0 })), // no EG-14
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
// 0011: the vendors columns granted for insert / update to authenticated (never woo_vendor_id, commission_pct, raw, opening_balance), by the rule they need
const VENDOR_IDENTITY_COLS = ['name', 'legal_name', 'category', 'aliases', 'lead_days', 'deposit_policy', 'joined_at']; const VENDOR_CONTACT_COLS = ['phone', 'alt_phone', 'email', 'address', 'address_parts', 'contact_name', 'social', 'instagram', 'store_url', 'notes']; // 0014: the three synced contact columns under the contact rule
// 0014: contact_name / address_parts / social granted with the contact columns; logo_url / banner_url / woo_payment_methods / woo_snapshot / push_pending / woo_synced_at are the server's (no grant); vendor_rates.flat
const VT_INSERT = { vendors: ['name', 'aliases', 'phone', 'email', 'status', 'legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contact_name', 'address_parts', 'social'], vendor_rates: ['vendor_id', 'rate', 'flat', 'since', 'set_by'], vendor_bank: ['vendor_id', 'method', 'bank_name', 'holder', 'iban', 'wallet', 'updated_by', 'updated_at'], vendor_logins: ['vendor_id', 'username', 'email', 'pw_mode', 'created_by'],
  vendor_category_rates: ['vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by'] };
const SYNC_FIELDS = ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates']; // woo-core SYNC_FIELDS: push_vendor's fields
const VT_UPDATE = { vendors: VT_INSERT.vendors.concat(['contract']), vendor_bank: VT_INSERT.vendor_bank.filter((c) => c !== 'vendor_id'), vendor_logins: ['username', 'email', 'pw_mode', 'status'] }; // 0012: must_change / invite_sent_at / password_set_at / secret_id are the server's
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/; const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const canLogin = (u) => isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F'; // 0012: vendor_logins insert / update and the two RPCs
const VENDOR_CATEGORIES = ['ديكور منزلي', 'إكسسوارات ومجوهرات', 'ملابس ومنسوجات', 'فنون ولوحات', 'هدايا', 'مستلزمات حرف', 'أطعمة وحلويات'];
const VENDOR_DEFAULTS = () => ({ woo_vendor_id: null, aliases: [], phone: null, email: null, status: 'active', commission_pct: null, raw: null, legal_name: null, category: null, alt_phone: null, address: null, instagram: null, store_url: null, lead_days: 7, deposit_policy: null, notes: null, joined_at: null, contract: null, opening_balance: 0,
  contact_name: null, address_parts: null, social: null, logo_url: null, banner_url: null, woo_payment_methods: null, woo_snapshot: null, push_pending: null, woo_synced_at: null });
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const authUser = (u, factors) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors, created_at: T0 });
const claims = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return null; } };

export async function installSupabaseMock(page, opts = {}) {
  const issued = new Set(); const refresh = new Map(); let n = 0;
  // logoutScopes: the ?scope= of each /logout; afterLogout: requests that reached the origin after the first logout;
  // activityDelayMs: hold every log_activity call that long (a stalled network); recovers: emails sent a reset link;
  // lookups: the ident of each email_for_identifier call. activity: each log_activity body; activityRows: the activity_log
  // table it fills ({ id, at, actor, action, new_value }; a spec may seed older rows); prefs: the user_prefs table
  // ({ user_id, key, data }); prefsDown: every user_prefs write answers 503 (the server is unreachable).
  // alerts: the alerts table (ALERTS; a spec may change it before sign-in); alertReads: the alert_reads table ({ alert_id, user_id }).
  // orders tables: orders (with the full phone and raw), orderItems, subOrders, vendors, products, statusMap, wooStates (ordersSeed());
  // patches: each successful PATCH as { table: 'orders'|'order_items', id, ...columns }; ordersDown: those tables answer 503.
  // pushes: each woo-sync push_status as { action, order_id, status, result, reason? }; syncs: each other woo-sync call ({ action });
  // wooDown: woo-sync answers 502 (WooCommerce unreachable). vendors / vendorRates / vendorBank: the 0011 tables (ordersSeed());
  // vendorWrites: each insert / update / delete the vendors tables took as { table, op, ...columns }; vendorsDown: those tables
  // answer 503. objects: the bucket vendor-contracts (path → { type, bytes }); uploads: each upload attempt as { path, type,
  // size, upsert, by, ok: 'ok' | the refusal }; signs: each signed-URL request ({ path, expiresIn, by }); signed: token → { path, exp }.
  // profiles: this install's copy of USERS (the 2FA RPCs change twofa there); factors: auth.mfa_factors ({ id, user_id,
  // friendly_name, factor_type, status }; M03's verified factor seeded); enrolls / unenrolls: each POST / DELETE of a factor;
  // twofaCalls: each mark_twofa_enrolled / mark_twofa_disabled call as { fn, aal, result }; twofaRefused: both answer 42501
  // aal2_required whatever the token (a server that does not take the flag).
  const profiles = USERS.map((x) => ({ ...x, custom_perms: { ...x.custom_perms } }));
  const factors = profiles.filter((x) => x.twofa).map((x) => ({ id: 'f-' + x.member_code, user_id: x.id, friendly_name: 'Authenticator', factor_type: 'totp', status: 'verified', created_at: T0, updated_at: T0 }));
  const mock = { profiles, factors, enrolls: [], unenrolls: [], twofaCalls: [], twofaRefused: false, rateLimited: false, logouts: 0, logoutScopes: [], afterLogout: 0, activityDelayMs: 0, activity: [], activityRows: [], prefs: [], prefsDown: false, alerts: ALERTS(), alertReads: [], userUpdates: [], recovers: [], lookups: [], requests: [], unhandled: [],
    ...ordersSeed(opts), patches: [], ordersDown: false, pushes: [], syncs: [], wooDown: false, wooRefuses: false, functionsDown: false, vendorWrites: [], vendorsDown: false, uploads: [], signs: [], signed: new Map(), rpcs: [], vaultDown: false, brandWrites: [], vendorPushes: [], pushEnabled: true };
  // phase 3.3: vendorCategoryRates / wooCategories: the 0014 tables (ordersSeed()); vendorPushes: each woo-sync push_vendor as { vendor_id, fields, by, result, reason? }
  // (the body names the fields only — the mock reads the row like the server); pushEnabled: WOO_PUSH_ENABLED on the server (false → skipped/push_disabled,
  // the fields added to push_pending); wooDown → 502 pending:true with the fields in push_pending; wooRefuses → 502 pending:false, nothing
  // pending (the site's final answer); functionsDown → the request is aborted (the adapter queues the fields through vendor_push_pending). installSupabaseMock(page, { syncRows: true }) seeds the
  // server's sync rows (ordersSeed().syncActivity) into activity_log — opt-in, so the dashboard's «newest 5» expectations stay exact.
  if (opts.syncRows) mock.activityRows.push(...mock.syncActivity);
  // brands / brandOwners / brandRates: the 0013 tables (ordersSeed(opts): opts.transfer seeds the temporary transfer); brandWrites: each
  // insert / update the client sent them as { table, op, ...columns } — the trigger's own rows (the automatic brand) are not writes of the client
  let brandSeq = 0; let ownerSeq = mock.brandOwners.length; let brandRateSeq = 0;
  const nameKey = (n) => String(n ?? '').trim().toLowerCase(); // brands_name_key: unique on lower(btrim(name))
  // vendors_brand_after_insert (0013): a brand of the maker's own name (code = the first Latin letter upper-cased, else X; the store tied
  // when woo_vendor_id is set) and its first owner row, unless the name is blank / over 80 / taken — then nothing, and the insert passes
  const autoBrand = (v, now) => {
    const name = String(v.name ?? '').trim();
    if (!name || name.length > 80 || mock.brands.some((b) => b.origin_vendor_id === v.id || b.store_vendor_id === v.id) || mock.brands.some((b) => nameKey(b.name) === nameKey(name))) return;
    brandSeq += 1; const m = /[A-Za-z]/.exec(name); const id = NEW_BRAND(brandSeq);
    mock.brands.push({ id, name, code: m ? m[0].toUpperCase() : 'X', aliases: v.aliases ?? [], store_vendor_id: v.woo_vendor_id != null ? v.id : null, origin_vendor_id: v.id, created_by: 'system', created_at: now, updated_at: now });
    ownerSeq += 1; mock.brandOwners.push({ id: ownerSeq, brand_id: id, vendor_id: v.id, since: v.joined_at || now.slice(0, 10), return_on: null, reason: null, set_by: 'system', created_at: now });
  };
  // vendorLogins / vault: the 0012 table and vault.secrets (ordersSeed()); rpcs: each vendor_login_set_password / vendor_login_reveal call
  // as { fn, vendor_id, by, result } — never the password; vaultDown: both RPCs answer 0A000 (a Postgres without Vault).
  let vendorSeq = 0; let rateSeq = 3;
  // the after-insert trigger of vendor_rates: vendors.commission_pct = the rate effective today
  const effectiveRate = (vid) => { const today = new Date().toISOString().slice(0, 10); const v = mock.vendors.find((x) => x.id === vid); if (!v) return; const cur = mock.vendorRates.filter((r) => r.vendor_id === vid && r.since <= today).sort((a, b) => (a.since < b.since ? -1 : 1)).pop(); v.commission_pct = cur ? cur.rate : null; };
  let activityId = mock.activityRows.length; let catRateSeq = mock.vendorCategoryRates.length;
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
    // a signed URL of vendor-contracts is opened with no api key (a new tab, an <a>): its token alone opens the object
    const sg = /^\/storage\/v1\/object\/sign\/vendor-contracts\/(.+)$/.exec(path);
    if (method === 'GET' && sg) {
      const tok = url.searchParams.get('token'); const sig = tok && mock.signed.get(tok); const obj = sig && sig.path === sg[1] && sig.exp > Date.now() ? mock.objects.get(sig.path) : null;
      return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': obj.type, 'content-length': String(obj.bytes.length) }, body: obj.bytes }) : json(400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
    }
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
      // 0012 (plan 3.1): the two definer RPCs on the maker's temporary password — the admin or vendors.edit = F (else 42501), the
      // password rules again on the server (22023), 0A000 without Vault; the secret lives in the vault under the row's secret_id;
      // every set and every reveal writes its own activity_log row (actor = the caller, new_value null). Scalars come back as JSON.
      // phase 3.3 (review I-1) vendor_push_pending(p_vendor, p_fields): the push rule of push_vendor (the admin, vendors.edit F — a rate
      // field with sensitive.commission F too —, or vendors.edit P for the contact fields alone), the synced names only (22023 when none),
      // P0002 for an unknown maker; push_pending ∪ fields, sorted; the new list comes back. Recorded in mock.rpcs.
      // 0015 (plan 3.3 decision 12): vendor_rate_set / vendor_category_rate_set — the rate / category rate dated today, a same-day
      // change replacing the day's row; admin or sensitive.commission = F (42501); 22023 out of range; P0002 unknown maker; set_by =
      // the caller's name. Recorded in vendorWrites as { table, op: 'insert' | 'update', vendor_id, [woo_category_id,] rate, since,
      // set_by[, flat] } (flat only when given, like the insert path).
      const rateRpc = /^\/rest\/v1\/rpc\/(vendor_rate_set|vendor_category_rate_set)$/.exec(path);
      if (method === 'POST' && rateRpc) {
        const fn = rateRpc[1]; const b = body(); const vid = String(b.p_vendor || '').toLowerCase(); const cat = fn === 'vendor_category_rate_set';
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (!(isAdmin(u) || hasPerm(u, 'sensitive.commission') === 'F')) return refuse(403, '42501', 'sensitive.commission = F is required to set a ' + (cat ? 'category' : 'maker') + ' rate');
        const rate = b.p_rate == null ? null : Number(b.p_rate); const flat = b.p_flat == null ? null : Number(b.p_flat); const cid = cat ? Number(b.p_category) : null;
        if ((!cat && rate == null) || (rate != null && !(rate >= 0 && rate <= 65))) return refuse(400, '22023', 'the rate must be between 0 and 65');
        if (flat != null && !(flat >= 0)) return refuse(400, '22023', 'the flat fee must be 0 or more');
        if (cat && !(Number.isInteger(cid) && cid > 0)) return refuse(400, '22023', 'the category id must be a positive integer');
        if (!mock.vendors.some((x) => x.id === vid)) return refuse(400, 'P0002', 'vendor not found');
        const d = new Date(); const since = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
        const list = cat ? mock.vendorCategoryRates : mock.vendorRates; const now = d.toISOString();
        const row = list.find((x) => x.vendor_id === vid && x.since === since && (!cat || Number(x.woo_category_id) === cid));
        if (row) Object.assign(row, { rate, flat, set_by: u.name });
        else if (cat) { catRateSeq += 1; list.push({ id: catRateSeq, vendor_id: vid, woo_category_id: cid, rate, flat, since, set_by: u.name, created_at: now }); }
        else { rateSeq += 1; list.push({ id: rateSeq, vendor_id: vid, rate, flat, since, set_by: u.name, created_at: now }); }
        if (!cat) effectiveRate(vid);
        mock.vendorWrites.push({ table: cat ? 'vendor_category_rates' : 'vendor_rates', op: row ? 'update' : 'insert', vendor_id: vid, ...(cat ? { woo_category_id: cid } : {}), rate, since, set_by: u.name, ...(flat != null ? { flat } : {}) });
        return json(200, since);
      }
      if (method === 'POST' && path === '/rest/v1/rpc/vendor_push_pending') {
        const b = body(); const vid = String(b.p_vendor || ''); const asked = (Array.isArray(b.p_fields) ? b.p_fields : []).filter((f) => SYNC_FIELDS.includes(f));
        const rec = { fn: 'vendor_push_pending', vendor_id: vid, fields: asked, by: u.email, result: 'ok' }; mock.rpcs.push(rec);
        const refuse = (status, code, message) => { rec.result = code; return json(status, { code, details: null, hint: null, message }); };
        if (!asked.length) return refuse(400, '22023', 'a vendor and at least one synced field are required');
        const edit = hasPerm(u, 'vendors.edit'); const contact = ['phone', 'email', 'contact_name', 'address_parts', 'social'];
        if (!(isAdmin(u) || edit === 'F' || (edit === 'P' && asked.every((f) => contact.includes(f))))) return refuse(403, '42501', 'vendors.edit = F (or P for the contact fields) is required to queue a push to the site');
        if (asked.some((f) => f === 'rate' || f === 'category_rates') && !(isAdmin(u) || hasPerm(u, 'sensitive.commission') === 'F')) return refuse(403, '42501', 'sensitive.commission = F is required to queue a commission push to the site');
        const v = mock.vendors.find((x) => x.id === vid.toLowerCase());
        if (!v) return refuse(400, 'P0002', 'vendor not found');
        v.push_pending = [...new Set((Array.isArray(v.push_pending) ? v.push_pending : []).concat(asked))].sort();
        return json(200, v.push_pending);
      }
      const vrpc = /^\/rest\/v1\/rpc\/(vendor_login_set_password|vendor_login_reveal)$/.exec(path);
      if (method === 'POST' && vrpc) {
        const fn = vrpc[1]; const b = body(); const vid = String(b.p_vendor || '');
        const rec = { fn, vendor_id: vid, by: u.email, result: 'ok' }; mock.rpcs.push(rec);
        const refuse = (status, code, message) => { rec.result = code; return json(status, { code, details: null, hint: null, message }); };
        if (!canLogin(u)) return refuse(403, '42501', 'vendors.edit = F is required to manage a maker login');
        if (mock.vaultDown) return refuse(400, '0A000', 'vault is not available');
        const row = mock.vendorLogins.find((x) => x.vendor_id === vid); const at = new Date().toISOString();
        const logRow = (action) => { activityId += 1; mock.activityRows.push({ id: activityId, at, actor: u.id, action, entity: 'vendor', entity_id: vid, new_value: null }); };
        if (fn === 'vendor_login_set_password') {
          const pw = String(b.p_password ?? '');
          if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) || /\s/.test(pw)) return refuse(400, '22023', 'password: 8 to 128 characters, a latin letter, a digit and no spaces');
          if (!row) return refuse(400, 'P0002', 'vendor login not found');
          if (!row.secret_id) { n += 1; row.secret_id = 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
          mock.vault.set(row.secret_id, pw); Object.assign(row, { password_set_at: at, must_change: true, pw_mode: 'temp', updated_at: at });
          logRow('vendor.login.password');
          return json(200, at);
        }
        logRow('vendor.login.reveal'); // every call, as 0012 does: the row is logged before the read, even without a login row or a password
        if (!row) return json(200, null);
        const secret = row.secret_id ? mock.vault.get(row.secret_id) : null;
        return json(200, secret ?? null);
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
      // ---- the vendors tables (0011): column-list grants (no * / commission_pct on vendors), RLS by vendors.view, the per-column
      // guard of decision 8 (42501 with the rule's message), vendor_rates / vendor_bank behind sensitive.commission /
      // sensitive.vendor_bank (RLS using → [] for the others; a write → 42501), the rate trigger, delete by the admin only and
      // refused while order lines point at the maker (23503). One statement: every row or none.
      // 0014 (phase 3.3): vendor_category_rates (select / insert with sensitive.commission; the checks 23514; unique (vendor, category, since) 23505;
      // no update / delete), woo_categories (select with vendors.view; never written by a member)
      const vt = /^\/rest\/v1\/(vendors|vendor_rates|vendor_bank|vendor_logins|vendor_category_rates|woo_categories)$/.exec(path);
      const VT_METHODS = { vendors: ['GET', 'POST', 'PATCH', 'DELETE'], vendor_rates: ['GET', 'POST'], vendor_bank: ['GET', 'POST', 'PATCH'], vendor_logins: ['GET', 'POST', 'PATCH'], vendor_category_rates: ['GET', 'POST'], woo_categories: ['GET'] };
      if (vt && VT_METHODS[vt[1]].includes(method)) {
        const t = vt[1]; const f = readFilters(url.searchParams, t); const now = new Date().toISOString();
        const denied = (message) => json(403, { code: '42501', details: null, hint: null, message });
        const check = (name) => json(400, { code: '23514', details: null, hint: null, message: `new row for relation "${t}" violates check constraint "${name}"` });
        if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'mock: unexpected filter ' + f.bad });
        if (mock.vendorsDown) return json(503, { code: 'PGRST000', details: null, hint: null, message: 'mock: the vendors tables are down' });
        const representation = /return=representation/.test(hd.prefer || '') || url.searchParams.has('select');
        const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
        // the key of the writes: sensitive.commission / sensitive.vendor_bank for the money tables, vendors.edit = F (or admin) for the logins
        const F = t === 'vendor_logins' ? canLogin(u) : t === 'woo_categories' ? false : hasPerm(u, t === 'vendor_rates' || t === 'vendor_category_rates' ? 'sensitive.commission' : 'sensitive.vendor_bank') === 'F';
        const rows = () => (t === 'vendors' ? mock.vendors : t === 'vendor_rates' ? mock.vendorRates : t === 'vendor_bank' ? mock.vendorBank : t === 'vendor_category_rates' ? mock.vendorCategoryRates : t === 'woo_categories' ? mock.wooCategories : mock.vendorLogins);
        // the check constraints of 0011 (category, lead_days, status — leave since 0012; rate; method) and 0012 (username, email, pw_mode, status)
        const bad = (r) => (t === 'vendors' ? (r.category != null && !VENDOR_CATEGORIES.includes(r.category) ? 'vendors_category_check' : r.lead_days != null && !(Number.isInteger(Number(r.lead_days)) && r.lead_days >= 1 && r.lead_days <= 60) ? 'vendors_lead_days_check' : r.status != null && !['active', 'leave', 'inactive'].includes(r.status) ? 'vendors_status_check' : null)
          : t === 'vendor_rates' ? (!(Number(r.rate) >= 0 && Number(r.rate) <= 65) ? 'vendor_rates_rate_check' : r.flat != null && !(Number(r.flat) >= 0) ? 'vendor_rates_flat_check' : null)
          : t === 'vendor_category_rates' ? (!(Number.isInteger(Number(r.woo_category_id)) && Number(r.woo_category_id) > 0) ? 'vendor_category_rates_woo_category_id_check' : r.rate != null && !(Number(r.rate) >= 0 && Number(r.rate) <= 65) ? 'vendor_category_rates_rate_check' : r.flat != null && !(Number(r.flat) >= 0) ? 'vendor_category_rates_flat_check' : null)
          : t === 'vendor_logins' ? (!USERNAME_RE.test(String(r.username ?? '')) ? 'vendor_logins_username_check' : r.email != null && !EMAIL_RE.test(String(r.email)) ? 'vendor_logins_email_check' : r.pw_mode != null && !['link', 'temp'].includes(r.pw_mode) ? 'vendor_logins_pw_mode_check' : r.status != null && !['invited', 'active', 'disabled'].includes(r.status) ? 'vendor_logins_status_check' : null)
          : (r.method != null && !['bank', 'instapay', 'wallet', 'cash'].includes(r.method) ? 'vendor_bank_method_check' : null));
        const usernameTaken = (name, except) => mock.vendorLogins.some((x) => x !== except && x.username.toLowerCase() === String(name).toLowerCase()); // the unique index on lower(username)
        const dupUser = () => json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "vendor_logins_username_key"' });
        if (method === 'GET') {
          const asked = url.searchParams.get('select') || '*';
          if (t === 'vendors' && asked.split(',').some((c) => c.trim() === '*' || c.trim() === 'commission_pct' || c.trim() === 'woo_snapshot')) return denied('permission denied for table vendors'); // the select grant is a column list without commission_pct / woo_snapshot (0014)
          if (t === 'vendor_logins' && asked.split(',').some((c) => c.trim() === '*' || c.trim() === 'secret_id')) return denied('permission denied for table vendor_logins'); // 0012: the select grant is a column list without secret_id
          const sel = readSelect(t, asked);
          if (sel.bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${sel.bad} does not exist` });
          const visible = t === 'vendors' || t === 'vendor_logins' || t === 'woo_categories' ? hasPerm(u, 'vendors.view') !== 'N' : F;
          return json(200, pageOf(visible ? rows().filter(f.match) : [], url.searchParams).map(sel.pick));
        }
        if (t !== 'vendors' && !F) return denied(`new row violates row-level security policy for table "${t}"`);
        if (representation && (url.searchParams.get('select') || 'id') !== 'id') return denied('permission denied for table ' + t); // mock: a returning row names id only
        if (method === 'POST') {
          const b = body(); const list = Array.isArray(b) ? b : [b]; const cols = VT_INSERT[t];
          if (t === 'vendor_logins' && (url.searchParams.has('on_conflict') || /resolution=/.test(hd.prefer || ''))) return denied('permission denied for table vendor_logins'); // 0012: no update grant on vendor_id / created_by — an upsert needs it
          if (list.some((r) => Object.keys(r).some((k) => !cols.includes(k)))) return denied('permission denied for table ' + t);
          if (t === 'vendor_logins' && list.some((r) => r.email == null || r.email === '')) return json(400, { code: '23502', details: null, hint: null, message: 'null value in column "email" of relation "vendor_logins" violates not-null constraint' });
          if (t === 'vendors' && !(isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F')) return denied('new row violates row-level security policy for table "vendors"');
          for (const r of list) { const c = bad(r); if (c) return check(c); if (t !== 'vendors' && !mock.vendors.some((v) => v.id === r.vendor_id)) return json(409, { code: '23503', details: null, hint: null, message: `insert or update on table "${t}" violates foreign key constraint "${t}_vendor_id_fkey"` }); }
          if (t === 'vendor_rates' && list.some((r) => mock.vendorRates.some((x) => x.vendor_id === r.vendor_id && x.since === r.since))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "vendor_rates_vendor_id_since_key"' });
          if (t === 'vendor_category_rates' && (url.searchParams.has('on_conflict') || /resolution=/.test(hd.prefer || ''))) return denied('permission denied for table vendor_category_rates'); // add-only: no update grant, so no upsert
          if (t === 'vendor_category_rates' && list.some((r) => mock.vendorCategoryRates.some((x) => x.vendor_id === r.vendor_id && Number(x.woo_category_id) === Number(r.woo_category_id) && x.since === r.since))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "vendor_category_rates_vendor_id_woo_category_id_since_key"' });
          if (t === 'vendor_bank' && list.some((r) => mock.vendorBank.some((x) => x.vendor_id === r.vendor_id))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "vendor_bank_pkey"' });
          if (t === 'vendor_logins' && list.some((r) => mock.vendorLogins.some((x) => x.vendor_id === r.vendor_id))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "vendor_logins_pkey"' });
          if (t === 'vendor_logins' && list.some((r) => usernameTaken(r.username, null))) return dupUser();
          const out = [];
          for (const r of list) {
            if (t === 'vendors') { vendorSeq += 1; const row = { ...VENDOR_DEFAULTS(), ...r, id: 'b0000000-0000-4000-8000-' + String(vendorSeq).padStart(12, '0'), created_at: now, updated_at: now }; mock.vendors.push(row); autoBrand(row, now); out.push({ id: row.id }); }
            else if (t === 'vendor_rates') { rateSeq += 1; const row = { id: rateSeq, vendor_id: r.vendor_id, rate: Number(r.rate), flat: r.flat == null ? null : Number(r.flat), since: r.since, set_by: r.set_by ?? null, created_at: now }; mock.vendorRates.push(row); effectiveRate(r.vendor_id); out.push({ id: row.id }); }
            else if (t === 'vendor_category_rates') { catRateSeq += 1; const row = { id: catRateSeq, vendor_id: r.vendor_id, woo_category_id: Number(r.woo_category_id), rate: r.rate == null ? null : Number(r.rate), flat: r.flat == null ? null : Number(r.flat), since: r.since, set_by: r.set_by ?? null, created_at: now }; mock.vendorCategoryRates.push(row); out.push({ id: row.id }); }
            else if (t === 'vendor_logins') { mock.vendorLogins.push({ vendor_id: r.vendor_id, username: r.username, email: r.email ?? null, pw_mode: r.pw_mode ?? 'link', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: null, secret_id: null, created_by: r.created_by ?? u.name, created_at: now, updated_at: now }); out.push({ vendor_id: r.vendor_id }); } // created_by: the member's name (0012, like set_by / updated_by)
            else { mock.vendorBank.push({ method: 'bank', bank_name: null, holder: null, iban: null, wallet: null, updated_by: null, updated_at: now, ...r }); out.push({ vendor_id: r.vendor_id }); }
            mock.vendorWrites.push({ table: t, op: 'insert', ...r });
          }
          return representation ? json(201, single ? out[0] : out) : json(201, []);
        }
        if (method === 'PATCH') {
          const key = t === 'vendor_bank' || t === 'vendor_logins' ? 'vendor_id' : 'id';
          if (!(url.searchParams.get(key) || '').startsWith('eq.')) return json(400, { code: '21000', details: null, hint: null, message: 'mock: a PATCH on ' + t + ' names its row (' + key + '=eq.…): UPDATE requires a WHERE clause' });
          const b = body(); const keys = Object.keys(b); const cols = VT_UPDATE[t];
          if (representation || keys.some((k) => !cols.includes(k))) return denied('permission denied for table ' + t);
          const target = t === 'vendors' ? (hasPerm(u, 'vendors.view') === 'N' ? [] : mock.vendors.filter(f.match)) : t === 'vendor_logins' ? mock.vendorLogins.filter(f.match) : mock.vendorBank.filter(f.match);
          const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
          for (const r of target) {
            const changed = keys.filter((k) => !same(r[k], b[k]));
            if (t === 'vendor_logins') { // vendor_logins_guard (0012): the client sets invited / disabled only; the unique username
              if (changed.includes('status') && b.status === 'active') return denied('vendor_logins.status: the client may set invited or disabled only (active is set by the portal)');
              if (changed.includes('username') && usernameTaken(b.username, r)) return dupUser();
            }
            if (t === 'vendors') { // vendors_guard_update (decision 8, amended: a member with sensitive.vendor_bank = F may change the contract and nothing else), then the policy's with check
              if (changed.includes('status') && hasPerm(u, 'vendors.toggle') !== 'F') return denied('vendors.toggle = F is required to change a vendor status');
              if (changed.includes('contract') && !F) return denied('sensitive.vendor_bank = F is required to change a vendor contract');
              if (changed.some((k) => VENDOR_IDENTITY_COLS.includes(k)) && hasPerm(u, 'vendors.edit') !== 'F') return denied('vendors.edit = F is required to change a vendor name, category, aliases or terms');
              if (changed.some((k) => VENDOR_CONTACT_COLS.includes(k)) && hasPerm(u, 'vendors.edit') === 'N') return denied('vendors.edit (F or P) is required to change a vendor contact or notes');
              if (!(isAdmin(u) || hasPerm(u, 'vendors.edit') !== 'N' || F)) return denied('new row violates row-level security policy for table "vendors"');
            }
            const c = bad({ ...r, ...b }); if (c) return check(c);
          }
          for (const r of target) { Object.assign(r, b, { updated_at: now }); mock.vendorWrites.push({ table: t, op: 'update', [key]: r[key], ...b }); } // updated_at: the server bumps it on every write
          return empty(204);
        }
        // DELETE (vendors): the policy admits the admin only (0 rows for anyone else); the fk from order_items / sub_orders refuses
        if (!(url.searchParams.get('id') || '').startsWith('eq.')) return json(400, { code: '21000', details: null, hint: null, message: 'mock: a DELETE on vendors names its row (id=eq.…)' });
        const target = isAdmin(u) ? mock.vendors.filter(f.match) : [];
        // vendors_brands_guard_delete (0013, before delete): a maker in the ownership history of another maker's brand stays
        if (target.some((r) => mock.brandOwners.some((o) => o.vendor_id === r.id && (mock.brands.find((b) => b.id === o.brand_id) || {}).origin_vendor_id !== r.id))) return json(409, { code: '23503', details: null, hint: null, message: 'the maker holds or held a brand of another maker (brand_owners_vendor_id_fkey): transfer or return it first' });
        if (target.some((r) => mock.orderItems.some((x) => x.vendor_id === r.id) || mock.subOrders.some((x) => x.vendor_id === r.id))) return json(409, { code: '23503', details: null, hint: null, message: 'update or delete on table "vendors" violates foreign key constraint "order_items_vendor_id_fkey" on table "order_items"' });
        for (const r of target) { mock.vendors.splice(mock.vendors.indexOf(r), 1); mock.vendorRates = mock.vendorRates.filter((x) => x.vendor_id !== r.id); mock.vendorBank = mock.vendorBank.filter((x) => x.vendor_id !== r.id); mock.vendorLogins = mock.vendorLogins.filter((x) => x.vendor_id !== r.id); mock.vendorWrites.push({ table: t, op: 'delete', id: r.id }); // the sensitive rows and the login cascade
          const gone = new Set(mock.brands.filter((b) => b.origin_vendor_id === r.id || b.store_vendor_id === r.id).map((b) => b.id)); // 0013: the maker's own brands cascade with their history and rates
          mock.brands = mock.brands.filter((b) => !gone.has(b.id)); mock.brandOwners = mock.brandOwners.filter((o) => !gone.has(o.brand_id)); mock.brandRates = mock.brandRates.filter((o) => !gone.has(o.brand_id)); }
        return representation ? json(200, target.map((r) => ({ id: r.id }))) : empty(204);
      }
      // ---- the brands tables (0013, phase 3.2): table-level select (RLS by vendors.view; brand_rates by sensitive.commission → [] for the
      // others), column-list inserts (brands: name / code / aliases / origin_vendor_id / created_by — never store_vendor_id; brand_owners;
      // brand_rates), update of name / code / aliases on brands only, no upsert (no update grant on the keys), no delete; the policies
      // (admin or vendors.edit = F; sensitive.commission = F for the rates) → 42501; the check constraints (23514), the name index and
      // the (brand_id, since) keys (23505), the foreign keys (23503), brand_owners_guard (22023). One statement: every row or none.
      const bt = /^\/rest\/v1\/(brands|brand_owners|brand_rates)$/.exec(path);
      const BT_METHODS = { brands: ['GET', 'POST', 'PATCH'], brand_owners: ['GET', 'POST'], brand_rates: ['GET', 'POST'] };
      const BT_INSERT = { brands: ['name', 'code', 'aliases', 'origin_vendor_id', 'created_by'], brand_owners: ['brand_id', 'vendor_id', 'since', 'return_on', 'reason', 'set_by'], brand_rates: ['brand_id', 'rate', 'since', 'set_by'] };
      if (bt && BT_METHODS[bt[1]].includes(method)) {
        const t = bt[1]; const f = readFilters(url.searchParams, t); const now = new Date().toISOString();
        const denied = (message) => json(403, { code: '42501', details: null, hint: null, message });
        const check = (name) => json(400, { code: '23514', details: null, hint: null, message: `new row for relation "${t}" violates check constraint "${name}"` });
        const dup = (name) => json(409, { code: '23505', details: null, hint: null, message: `duplicate key value violates unique constraint "${name}"` });
        const fk = (name) => json(409, { code: '23503', details: null, hint: null, message: `insert or update on table "${t}" violates foreign key constraint "${name}"` });
        const ISO = /^\d{4}-\d{2}-\d{2}$/; const CODE_RE = /^[A-Z0-9]{1,3}$/;
        if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'mock: unexpected filter ' + f.bad });
        if (mock.vendorsDown) return json(503, { code: 'PGRST000', details: null, hint: null, message: 'mock: the vendors tables are down' });
        const representation = /return=representation/.test(hd.prefer || '') || url.searchParams.has('select');
        const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
        const rows = () => (t === 'brands' ? mock.brands : t === 'brand_owners' ? mock.brandOwners : mock.brandRates);
        const visible = t === 'brand_rates' ? hasPerm(u, 'sensitive.commission') === 'F' : hasPerm(u, 'vendors.view') !== 'N';
        const mayWrite = t === 'brand_rates' ? hasPerm(u, 'sensitive.commission') === 'F' : isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F';
        if (method === 'GET') {
          const sel = readSelect(t, url.searchParams.get('select') || '*');
          if (sel.bad) return json(400, { code: '42703', details: null, hint: null, message: `column ${sel.bad} does not exist` });
          return json(200, pageOf(visible ? rows().filter(f.match) : [], url.searchParams).map(sel.pick));
        }
        if (representation && (url.searchParams.get('select') || 'id') !== 'id') return denied('permission denied for table ' + t); // mock: a returning row names id only
        if (url.searchParams.has('on_conflict') || /resolution=/.test(hd.prefer || '')) return denied('permission denied for table ' + t); // no upsert: no update grant on the key columns
        if (method === 'POST') {
          const list = [].concat(body()); const cols = BT_INSERT[t];
          if (list.some((r) => Object.keys(r).some((k) => !cols.includes(k)))) return denied('permission denied for table ' + t);
          if (!mayWrite) return denied(`new row violates row-level security policy for table "${t}"`);
          for (const r of list) {
            if (t === 'brands') {
              const n = String(r.name ?? '').trim(); if (!(n.length >= 1 && n.length <= 80)) return check('brands_name_check');
              if (!CODE_RE.test(String(r.code ?? ''))) return check('brands_code_check');
              if (!mock.vendors.some((v) => v.id === r.origin_vendor_id)) return fk('brands_origin_vendor_id_fkey');
              if (mock.brands.some((b) => nameKey(b.name) === nameKey(n))) return dup('brands_name_key');
            } else {
              if (!mock.brands.some((b) => b.id === r.brand_id)) return fk(t + '_brand_id_fkey');
              if (!ISO.test(String(r.since ?? ''))) return json(400, { code: '22007', details: null, hint: null, message: 'invalid input syntax for type date' });
              if (rows().some((x) => x.brand_id === r.brand_id && x.since === r.since)) return dup(t + '_brand_id_since_key');
            }
            if (t === 'brand_owners') {
              if (!mock.vendors.some((v) => v.id === r.vendor_id)) return fk('brand_owners_vendor_id_fkey');
              if (r.return_on != null && !(ISO.test(String(r.return_on)) && r.return_on > r.since)) return check('brand_owners_return_on_check');
              if (r.reason != null && String(r.reason).length > 200) return check('brand_owners_reason_check');
              // brand_owners_guard (before insert): against the latest row by (since, id)
              const last = mock.brandOwners.filter((o) => o.brand_id === r.brand_id).sort((a, b) => (a.since < b.since ? 1 : a.since > b.since ? -1 : b.id - a.id))[0];
              if (last && r.since < last.since) return json(400, { code: '22023', details: null, hint: null, message: 'since before the last transfer' });
              if (last && r.vendor_id === last.vendor_id) return json(400, { code: '22023', details: null, hint: null, message: 'same vendor' });
            }
            if (t === 'brand_rates' && r.rate != null && !(Number(r.rate) >= 0 && Number(r.rate) <= 65)) return check('brand_rates_rate_check');
          }
          const out = [];
          for (const r of list) {
            if (t === 'brands') { brandSeq += 1; const row = { id: NEW_BRAND(brandSeq), name: r.name, code: r.code, aliases: r.aliases ?? [], store_vendor_id: null, origin_vendor_id: r.origin_vendor_id, created_by: r.created_by ?? null, created_at: now, updated_at: now }; mock.brands.push(row); out.push({ id: row.id }); }
            else if (t === 'brand_owners') { ownerSeq += 1; mock.brandOwners.push({ id: ownerSeq, brand_id: r.brand_id, vendor_id: r.vendor_id, since: r.since, return_on: r.return_on ?? null, reason: r.reason ?? null, set_by: r.set_by ?? null, created_at: now }); out.push({ id: ownerSeq }); }
            else { brandRateSeq += 1; mock.brandRates.push({ id: brandRateSeq, brand_id: r.brand_id, rate: r.rate == null ? null : Number(r.rate), since: r.since, set_by: r.set_by ?? null, created_at: now }); out.push({ id: brandRateSeq }); }
            mock.brandWrites.push({ table: t, op: 'insert', ...r });
          }
          return representation ? json(201, single ? out[0] : out) : json(201, []);
        }
        // PATCH brands: one row by id; name / code / aliases only (the column grants, then brands_guard); RLS using vendors.view, with check the editors
        if (!(url.searchParams.get('id') || '').startsWith('eq.')) return json(400, { code: '21000', details: null, hint: null, message: 'mock: a PATCH on brands names its row (id=eq.…): UPDATE requires a WHERE clause' });
        const b = body(); const keys = Object.keys(b);
        if (representation || keys.some((k) => !['name', 'code', 'aliases'].includes(k))) return denied('permission denied for table brands');
        const target = visible ? mock.brands.filter(f.match) : [];
        if (target.length && !mayWrite) return denied('new row violates row-level security policy for table "brands"');
        for (const r of target) {
          const next = { ...r, ...b }; const n = String(next.name ?? '').trim();
          if (!(n.length >= 1 && n.length <= 80)) return check('brands_name_check');
          if (!CODE_RE.test(String(next.code ?? ''))) return check('brands_code_check');
          if (mock.brands.some((x) => x !== r && nameKey(x.name) === nameKey(n))) return dup('brands_name_key');
        }
        for (const r of target) { Object.assign(r, b, { updated_at: now }); mock.brandWrites.push({ table: 'brands', op: 'update', id: r.id, ...b }); }
        return empty(204);
      }
      const ot = /^\/rest\/v1\/(orders|orders_v|order_items|sub_orders|products|status_map|woo_states)$/.exec(path);
      const OT_METHODS = { orders: ['PATCH'], orders_v: ['GET'], order_items: ['GET', 'PATCH'], sub_orders: ['GET'], products: ['GET'], status_map: ['GET'], woo_states: ['GET'] };
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
          // RLS (0007, 0002 status_map, 0010 woo_states): woo_states for any signed-in member, every other table with orders.view
          const visible = t === 'woo_states' || hasPerm(u, 'orders.view') !== 'N';
          const rows = t === 'orders_v' ? mock.orders.map((o) => viewRow(u, o)) : t === 'order_items' ? mock.orderItems : t === 'sub_orders' ? mock.subOrders : t === 'products' ? mock.products : t === 'woo_states' ? mock.wooStates : mock.statusMap;
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
        activityId += 1; mock.activityRows.push({ id: activityId, at: new Date().toISOString(), actor: u.id, action: b.action, entity: b.entity ?? null, entity_id: b.entity_id ?? null, new_value: b.new_value ?? null }); // actor / at / id: the server's (0002 trigger)
        return empty(204).catch(() => {}); // the page may be gone after a long delay
      }
    }
    // Storage, bucket vendor-contracts (0011): private, 10 MB, PDF / PNG / JPEG; select / insert for sensitive.vendor_bank = F,
    // no delete. The mock also holds the bucket's layout (<vendor uuid>/<unix ms>-<safe name>, a known maker) and answers like
    // the Storage API: 403 without the permission, 400 on a bad key, 415 / 413 on the mime / size, 409 on an existing object.
    const st = /^\/storage\/v1\/object\/(sign\/)?vendor-contracts\/(.+)$/.exec(path);
    if (method === 'POST' && st) {
      const u = tokenUser(); const key = st[2];
      if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      const F = hasPerm(u, 'sensitive.vendor_bank') === 'F';
      if (st[1]) { // a signed URL: the select policy hides the object from anyone else
        const b = body(); mock.signs.push({ path: key, expiresIn: b.expiresIn, by: u.email });
        if (!F || !mock.objects.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
        n += 1; const tok = 'sig-' + n; mock.signed.set(tok, { path: key, exp: Date.now() + (Number(b.expiresIn) || 60) * 1000 });
        return json(200, { signedURL: '/object/sign/vendor-contracts/' + key + '?token=' + tok });
      }
      const bytes = req.postDataBuffer() || Buffer.alloc(0);
      const rec = { path: key, type: hd['content-type'] || '', size: bytes.length, upsert: hd['x-upsert'] || '', by: u.email, ok: null }; mock.uploads.push(rec);
      const refuse = (status, error, message) => { rec.ok = error; return json(status, { statusCode: String(status), error, message }); };
      if (!F) return refuse(403, 'Unauthorized', 'new row violates row-level security policy');
      const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{13})-([A-Za-z0-9._-]{1,100})$/.exec(key);
      if (!m || !mock.vendors.some((v) => v.id === m[1])) return refuse(400, 'InvalidKey', 'Invalid key: ' + key);
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(rec.type)) return refuse(415, 'invalid_mime_type', 'mime type ' + rec.type + ' is not supported');
      if (rec.size > 10485760) return refuse(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      if (mock.objects.has(key) && rec.upsert !== 'true') return refuse(409, 'Duplicate', 'The resource already exists');
      mock.objects.set(key, { type: rec.type, bytes }); rec.ok = 'ok'; n += 1;
      return json(200, { Key: 'vendor-contracts/' + key, Id: 'obj-' + n });
    }
    // woo-sync (supabase/functions/woo-sync, verify_jwt false: it checks the member's JWT itself): push_status needs
    // orders.status = F, every other action admin; push_status is skipped when the status is not the stored one ('stale')
    // or has no outgoing WooCommerce slug ('no_woo_status': a from_woo row like «فشل», or a row without a slug — none today; a from_system row WITH a slug is pushed), else the order's woo_status follows the slug.
    // phase 3.3 push_vendor (the contract of Task A): the admin or vendors.edit = F (+ sensitive.commission = F when the fields name the
    // commission) → else 401; a non-uuid / empty or unknown fields → 400; the row read here (never the body) → 404; no store →
    // skipped/no_store; the gate (mock.pushEnabled) → skipped/push_disabled with the fields in push_pending; a `#` placeholder name alone →
    // skipped/placeholder; WooCommerce down → 502 woo_error with the fields in push_pending; else ok: woo_synced_at = now, push_pending
    // minus the fields, accepted = the fields.
    if (method === 'POST' && path === '/functions/v1/woo-sync') {
      if (mock.functionsDown) return route.abort('failed'); // the function never answers (review I-1): the adapter queues through the RPC
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      const CONTACT_PUSH = ['phone', 'email', 'contact_name', 'address_parts', 'social']; // vendors.edit = P may push these alone (the guard's contact rule)
      const rateAsked = () => Array.isArray(b.fields) && b.fields.some((f) => f === 'rate' || f === 'category_rates');
      const contactOnly = () => Array.isArray(b.fields) && b.fields.length > 0 && b.fields.every((f) => CONTACT_PUSH.includes(f));
      const mayPushVendor = () => isAdmin(u) || ((hasPerm(u, 'vendors.edit') === 'F' || (hasPerm(u, 'vendors.edit') === 'P' && contactOnly())) && (!rateAsked() || hasPerm(u, 'sensitive.commission') === 'F'));
      if (!u || !(action === 'push_status' ? hasPerm(u, 'orders.status') === 'F' : action === 'push_vendor' ? mayPushVendor() : isAdmin(u))) return json(401, { error: 'unauthorized' });
      if (action === 'push_vendor') {
        const fields = Array.isArray(b.fields) ? [...new Set(b.fields.filter((f) => typeof f === 'string'))] : [];
        if (typeof b.vendor_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.vendor_id) || !fields.length || fields.some((f) => !SYNC_FIELDS.includes(f))) return json(400, { error: 'bad_request' });
        const v = mock.vendors.find((x) => x.id === b.vendor_id.toLowerCase());
        if (!v) return json(404, { error: 'vendor_not_found' });
        const rec = { vendor_id: v.id, fields, by: u.email, result: 'ok' }; mock.vendorPushes.push(rec);
        const pend = () => { v.push_pending = [...new Set((Array.isArray(v.push_pending) ? v.push_pending : []).concat(fields))]; };
        const skip = (reason) => { rec.result = 'skipped'; rec.reason = reason; return json(200, { action, result: 'skipped', reason, fields, counts: { pushed: 0 } }); };
        if (v.woo_vendor_id == null) return skip('no_store');
        if (!mock.pushEnabled) { pend(); return skip('push_disabled'); }
        if (mock.wooDown) { pend(); rec.result = 'error'; return json(502, { error: 'woo_error', action, fields, pending: true }); }
        if (mock.wooRefuses) { rec.result = 'refused'; return json(502, { error: 'woo_error', action, fields, pending: false }); } // the site's final answer (review I-3): nothing waits
        const sent = fields.filter((f) => !(f === 'name' && /^#/.test(String(v.name || '').trim())));
        if (!sent.length) return skip('placeholder');
        const now = new Date().toISOString(); v.woo_synced_at = now; v.updated_at = now;
        const left = (Array.isArray(v.push_pending) ? v.push_pending : []).filter((f) => !fields.includes(f)); v.push_pending = left.length ? left : null;
        v.woo_snapshot = { ...(v.woo_snapshot || {}), ...Object.fromEntries(sent.filter((f) => !['rate', 'category_rates'].includes(f)).map((f) => [f, v[f] ?? null])) };
        return json(200, { action, result: 'ok', fields: sent, accepted: sent, refused: [], dropped: fields.filter((f) => !sent.includes(f)), counts: { pushed: 1 } });
      }
      if (mock.wooDown) return json(502, { error: 'woo_error' });
      if (action === 'push_status') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id));
        if (!o) return json(404, { error: 'order_not_found' });
        // outgoingWooStatus (woo-core): a both / from_system row with a slug; a from_woo row («فشل») is never pushed
        const row = mock.statusMap.find((x) => x.system_status === b.status) || {};
        const slug = row.woo_status && ['both', 'from_system'].includes(row.direction || 'both') ? row.woo_status : null;
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
