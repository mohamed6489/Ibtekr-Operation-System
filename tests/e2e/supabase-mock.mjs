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
import { buildStudio, matchWooBrand, sheetCsvUrl } from '../../supabase/functions/_shared/woo-studio.js';
import { parseWrite, parseStudio, parsePrompts, cleanWrite, cleanStudio, cleanPrompts, shotPromptRows, aiSettings } from '../../supabase/functions/_shared/ai-content.js';
import { parseGenerate, parseEdit, parseCreate, imageSettings, creditsFor, usdOf, studioPathOk, studioGenPath, studioEditPath, toolPath, renameInState, MODEL_IDS } from '../../supabase/functions/_shared/ai-images.js';
import { hrState, hrRoute } from './hr-mock.mjs'; // phase 10 (0046): the HR tables, RPCs, team-admin and the bucket hr-docs
import { mktState, mktRoute } from './mkt-mock.mjs'; // phase 9.5.1 (0049): the marketing tables, RPCs, the bucket marketing and its AI actions
import { settingsState, settingsRoute } from './settings-mock.mjs';
// phase 11 (0056): the team RPCs, settings-admin / notify, company_docs, the buckets company-docs / settings, activity_log filters
import { portalState, portalRoute } from './portal-mock.mjs'; // phase 13 T4 (0065): the maker portal's Edge Function on the mock's rows
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
// permissions: the keys the emulated tables read, as in 0003_seed_roles.sql (+ 0021: products.view / edit / trash; 0034: cs.view / reply / manage)
const ROLES = [
  { id: 'admin', name: 'أدمن', description: 'كل الصلاحيات — المالك والمديرين', is_system: true, permissions: { 'hr.view': 'F', 'hr.edit': 'F', 'hr.approve': 'F', 'sensitive.salaries': 'F', 'reports.view': 'F', 'reports.export': 'F', 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'F', 'tickets.view': 'F', 'tickets.manage': 'F', 'inventory.view': 'F', 'inventory.edit': 'F', 'inventory.approve': 'F', 'cs.view': 'F', 'cs.reply': 'F', 'cs.manage': 'F', 'settings.view': 'F', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'F', 'vendors.view': 'F', 'vendors.edit': 'F', 'vendors.toggle': 'F', 'sensitive.customer_phone': 'F', 'sensitive.vendor_bank': 'F', 'sensitive.commission': 'F' }, sort: 1 },
  { id: 'ops', name: 'عمليات', description: 'الأوردرات والمخزن والتجميع والشحن', is_system: true, permissions: { 'hr.view': 'P', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N', 'reports.view': 'F', 'reports.export': 'F', 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'F', 'tickets.view': 'F', 'tickets.manage': 'F', 'inventory.view': 'F', 'inventory.edit': 'F', 'inventory.approve': 'N', 'cs.view': 'F', 'cs.reply': 'F', 'cs.manage': 'N', 'products.view': 'F', 'products.edit': 'F', 'products.bulk': 'F', 'products.trash': 'N', 'products.add': 'F', 'accounts.view': 'P', 'accounts.add': 'N', 'accounts.approve': 'N', 'settings.view': 'P', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'P', 'vendors.view': 'F', 'vendors.edit': 'P', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'F', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 2 },
  { id: 'cs', name: 'خدمة العملاء', description: 'الرسايل وتأكيد الأوردرات ومتابعة العملاء', is_system: true, permissions: { 'hr.view': 'P', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N', 'reports.view': 'F', 'reports.export': 'F', 'marketing.view': 'N', 'marketing.create': 'N', 'marketing.publish': 'N', 'tickets.view': 'F', 'tickets.manage': 'F', 'inventory.view': 'N', 'inventory.edit': 'N', 'inventory.approve': 'N', 'cs.view': 'F', 'cs.reply': 'F', 'cs.manage': 'F', 'products.view': 'F', 'products.edit': 'N', 'products.bulk': 'N', 'products.trash': 'N', 'products.add': 'N', 'accounts.view': 'N', 'accounts.add': 'N', 'accounts.approve': 'N', 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'N', 'vendors.view': 'P', 'vendors.edit': 'N', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'F', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 2 },
  { id: 'accounts', name: 'حسابات', description: 'المصروفات والتحويلات وكشوف الموردين', is_system: true, permissions: { 'hr.view': 'P', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N', 'reports.view': 'F', 'reports.export': 'F', 'marketing.view': 'N', 'marketing.create': 'N', 'marketing.publish': 'N', 'tickets.view': 'P', 'tickets.manage': 'F', 'inventory.view': 'F', 'inventory.edit': 'N', 'inventory.approve': 'N', 'cs.view': 'N', 'cs.reply': 'N', 'cs.manage': 'N', 'products.view': 'F', 'products.edit': 'N', 'products.trash': 'N', 'accounts.view': 'F', 'accounts.add': 'F', 'accounts.approve': 'P', 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'F', 'vendors.edit': 'N', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'F', 'sensitive.commission': 'N' }, sort: 4 },
  { id: 'vendors_followup', name: 'متابعة الموردين', description: 'تبليغ الموردين ومتابعة التأخير', is_system: true, permissions: { 'hr.view': 'P', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N', 'reports.view': 'P', 'reports.export': 'N', 'marketing.view': 'N', 'marketing.create': 'N', 'marketing.publish': 'N', 'tickets.view': 'P', 'tickets.manage': 'F', 'inventory.view': 'F', 'inventory.edit': 'N', 'inventory.approve': 'N', 'cs.view': 'F', 'cs.reply': 'F', 'cs.manage': 'N', 'products.view': 'F', 'products.edit': 'N', 'products.trash': 'N', 'accounts.view': 'N', 'accounts.add': 'N', 'accounts.approve': 'N', 'settings.view': 'N', 'orders.view': 'F', 'orders.status': 'F', 'orders.edit': 'N', 'vendors.view': 'F', 'vendors.edit': 'F', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 5 },
  { id: 'viewer', name: 'مشاهد', description: 'عرض بس من غير تعديل', is_system: true, permissions: { 'hr.view': 'N', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N', 'reports.view': 'P', 'reports.export': 'N', 'marketing.view': 'N', 'marketing.create': 'N', 'marketing.publish': 'N', 'tickets.view': 'P', 'tickets.manage': 'N', 'inventory.view': 'F', 'inventory.edit': 'N', 'inventory.approve': 'N', 'cs.view': 'P', 'cs.reply': 'N', 'cs.manage': 'N', 'products.view': 'F', 'products.edit': 'N', 'products.trash': 'N', 'accounts.view': 'N', 'accounts.add': 'N', 'accounts.approve': 'N', 'settings.view': 'N', 'orders.view': 'P', 'orders.status': 'N', 'orders.edit': 'N', 'vendors.view': 'P', 'vendors.edit': 'N', 'vendors.toggle': 'N', 'sensitive.customer_phone': 'N', 'sensitive.vendor_bank': 'N', 'sensitive.commission': 'N' }, sort: 6 },
];
// 0081 (the owner 12 Nov): designer / media buyer / developer — the viewer's permissions + marketing and the team requests
ROLES.push(...[['designer', 'ديزاينر', 'التصميم والبوستات والفيديوهات وطلبات الديزاين', { 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'N', 'tickets.view': 'P', 'tickets.manage': 'F' }, 7],
  ['media_buyer', 'ميديا باير', 'الحملات الإعلانية وأرقامها وطلبات الإعلانات', { 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'F', 'reports.view': 'F', 'tickets.view': 'P', 'tickets.manage': 'F' }, 8],
  ['developer', 'مبرمج', 'الموقع والسيستم وطلبات البرمجة', { 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'N', 'tickets.view': 'P', 'tickets.manage': 'F' }, 9]]
  .map(([id, name, description, perms, sort]) => ({ id, name, description, is_system: true, permissions: { ...ROLES.find((r) => r.id === 'viewer').permissions, ...perms }, sort })));
const COLUMNS = { // supabase/migrations/0001_identity.sql, 0002_system.sql (activity_log, alerts, status_map), 0006_dashboard.sql (user_prefs,
  // alert_reads), 0007_orders.sql (orders_v; order_items / sub_orders: the columns granted to authenticated, i.e. all but raw),
  // 0009 (products.permalink), 0010 (orders_v.customer_state: the governorate's code on the website; woo_states: its names),
  // 0011 (order_items.commission_rate / fee; the team's vendors columns; vendor_rates; vendor_bank)
  profiles: ['id', 'member_code', 'name', 'email', 'phone', 'role_id', 'extra_roles', 'title', 'dept', 'manager_id', 'status', 'twofa', 'custom_perms', 'created_at'],
  roles: ['id', 'name', 'description', 'is_system', 'permissions', 'sort', 'hidden'], // 0056: hidden
  user_prefs: ['user_id', 'key', 'data', 'updated_at'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
  alerts: ['id', 'at', 'kind', 'title', 'body', 'role_id', 'user_id', 'entity', 'entity_id', 'read_at'],
  alert_reads: ['alert_id', 'user_id', 'read_at'],
  orders_v: ['id', 'number', 'customer_name', 'customer_phone', 'customer_state', 'customer_city', 'customer_address', 'payment_method', 'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note', 'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'synced_at', 'created_at', 'updated_at'],
  order_items: ['id', 'order_id', 'sub_order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'status', 'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'removed', 'updated_at', 'commission_rate', 'commission_fee'],
  sub_orders: ['id', 'order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'updated_at'],
  vendors: ['id', 'woo_vendor_id', 'site_removed_at', 'name', 'aliases', 'phone', 'email', 'status', 'commission_pct', 'raw', 'created_at', 'updated_at', 'legal_name', 'category', 'main_categories', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contract', 'opening_balance',
    'contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at', 'photo_path'], // 0075 photo_path; 0014 (phase 3.3): woo_snapshot is service_role only (a select naming it → 42501, like commission_pct)
  vendor_rates: ['id', 'vendor_id', 'rate', 'flat', 'since', 'set_by', 'created_at', 'commission_type'], // 0014: flat; 0016: commission_type
  vendor_category_rates: ['id', 'vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by', 'created_at'], // 0014: sensitive.commission, add-only
  woo_categories: ['id', 'name', 'slug', 'parent_id', 'updated_at'], // 0014: the sync's, vendors.view
  vendor_bank: ['vendor_id', 'method', 'bank_name', 'holder', 'iban', 'wallet', 'updated_by', 'updated_at', 'account_number', 'account_type', 'bank_address', 'routing_number', 'swift'], // 0017: + Dokan's bank fields
  vendor_logins: ['vendor_id', 'username', 'email', 'pw_mode', 'status', 'must_change', 'invite_sent_at', 'password_set_at', 'secret_id', 'created_by', 'created_at', 'updated_at', 'fails', 'locked_until', 'own_password', 'last_login_at'], // 0065 (phase 13 T4): the portal's four columns, readable // 0012 (plan 3.1): secret_id is never granted to the client; created_by is the member's name
  products: ['id', 'sku', 'name', 'image_url', 'permalink', 'vendor_id', 'price', 'status', 'raw', 'updated_at',
    'lang', 'translation_ids', 'type', 'regular_price', 'sale_price', 'stock_quantity', 'stock_status', 'manage_stock', 'backorders', 'low_stock_amount',
    'total_sales', 'category_ids', 'brand_ids', 'image_count', 'weight', 'featured', 'desc_filled', 'short_desc_filled', 'woo_modified_at', 'trashed_at'], // 0021 (phase 5)
  woo_brands: ['id', 'name', 'slug', 'parent_id', 'updated_at'], // 0021: the site's brands (products.view or vendors.view)
  product_commissions: ['product_id', 'rate', 'type', 'fee', 'updated_at'], // 0021 decision 12: sensitive.commission = F
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
const IN_FILTERS = { alert_reads: ['alert_id'], orders_v: ['id'], order_items: ['order_id', 'id'], sub_orders: ['order_id', 'id'], products: ['sku', 'id', 'permalink'], vendors: ['id'], image_imports: ['status'], activity_log: ['action'] }; // image_imports: the sets still to import (0026)
// products.js (phase 5): the records are the rows that are not Arabic — or=(lang.is.null,lang.neq.ar) is the one `or` it sends
const OR_FILTERS = { products: { '(lang.is.null,lang.neq.ar)': (r) => r.lang == null || r.lang !== 'ar' } };
// products.js: product_commissions with a rate only (rate=not.is.null)
const NOT_NULL = { product_commissions: ['rate'] };
const GTE_FILTERS = { orders_v: ['placed_at'] }; // orders.js: the last 12 months
// the horizontal filters of a PostgREST request (eq. everywhere; in.(a,b) on IN_FILTERS, gte. on GTE_FILTERS only) → { match(row) } | { bad: 'param=value' }
function readFilters(params, table) {
  const f = [...params].filter(([k]) => !NOT_FILTERS.has(k));
  const bad = f.find(([k, v]) => !(k === 'or' && (OR_FILTERS[table] || {})[v]) && !((NOT_NULL[table] || []).includes(k) && v === 'not.is.null') && !v.startsWith('eq.') && !((IN_FILTERS[table] || []).includes(k) && /^in\.\(.*\)$/.test(v)) && !((GTE_FILTERS[table] || []).includes(k) && v.startsWith('gte.')));
  const one = ([k, v]) => {
    if (k === 'or') return OR_FILTERS[table][v];
    if (v === 'not.is.null') return (r) => r[k] != null;
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
// a 1×1 PNG for the studio's thumbnails (signed URLs of the bucket studio)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
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
const ITEM_STATUSES = ['', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن', 'تم الشحن للمخزن', 'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر'];
function ordersSeed(opts = {}) {
  const ago = (d) => { const t = new Date(Date.now() - d * 864e5); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
  const vendor = (n, woo, name, status = 'active', more = {}) => ({ id: VND(n), woo_vendor_id: woo, name, aliases: [], phone: null, email: null, status, commission_pct: null, raw: { id: woo, shop_url: SITE + '/store/' + name.toLowerCase().replace(/\s+/g, '-') + '/' }, created_at: T0, updated_at: T0,
    legal_name: null, category: null, main_categories: [], alt_phone: null, address: null, instagram: null, store_url: null, lead_days: 7, deposit_policy: null, notes: null, joined_at: '2026-03-01', contract: null, opening_balance: 0,
    contact_name: null, address_parts: null, social: null, logo_url: null, banner_url: null, woo_payment_methods: null, woo_snapshot: null, push_pending: null, woo_synced_at: null, photo_path: null, ...more }); // 0014 (phase 3.3)
  // 0021 (phase 5): the mirror columns — English rows (lang en) by default; extra: a translation, a trash row, another status
  const product = (id, sku, name, image_url, v, slug, extra = {}) => ({ id, sku, name, image_url, permalink: SITE + '/product/' + slug + '/', vendor_id: VND(v), price: null, status: 'publish', raw: { id }, updated_at: T0,
    lang: 'en', translation_ids: { en: id }, type: 'simple', regular_price: 1500, sale_price: 1200, stock_quantity: 8, stock_status: 'instock', manage_stock: true, backorders: 'no', low_stock_amount: 2,
    total_sales: 5, category_ids: [151], brand_ids: [3], image_count: 3, weight: '1', featured: false, desc_filled: true, short_desc_filled: true, woo_modified_at: T0, trashed_at: null, ...extra });
  const order = (o) => ({ number: String(o.id), customer_state: null, customer_city: null, customer_address: null, payment_method: 'cod', payment_title: 'الدفع عند الاستلام', confirm: 'غير مؤكد', confirm_at: null, confirm_note: null, deposit: 0, currency: 'EGP', note: null, customer_note: null, cancel: null, ret: null, raw: { id: o.id }, woo_updated_at: o.placed_at, synced_at: o.placed_at, created_at: o.placed_at, updated_at: o.placed_at, ...o });
  const sub = (id, order_id, v, woo_order_id, woo_status, total) => ({ id, order_id, vendor_id: VND(v), woo_order_id, woo_status, total, dokan_earning: null, commission: null, raw: { id: woo_order_id }, updated_at: T0 });
  const line = (o) => ({ sub_order_id: null, product_id: null, qty: 1, status: '', expected_at: null, comment: null, ready_at: null, waybill: null, pulled: false, ret: null, store: null, removed: false, commission_rate: null, commission_fee: null, raw: { id: o.id }, updated_at: T0, ...o, vendor_id: VND(o.vendor_id) });
  const rate = (id, v, rate, since, flat = null, type = 'fixed') => ({ id, vendor_id: VND(v), rate, flat, since, set_by: 'صفوت كمال', created_at: T0, commission_type: type });
  return {
    // 0011: Art Craft and Antikiano with a rate (Antikiano's raised in October), Antikiano with a stored contract, Bian eg (inactive, no order) with a bank row
    // 0014 (phase 3.3): Art Craft carries the synced store data (the owner's name, the address parts, two social links, the site's logo,
    // the payout methods, a last sync); Antikiano has a phone waiting for the site (push_pending); Bian eg is inactive with a store there
    vendors: [vendor(1, 2376, 'Art Craft', 'active', { aliases: ['ArtCraft'], phone: '01000000003', category: 'ديكور', main_categories: [15] /* 0080: the site's «ديكور»; Antikiano keeps an old text */, store_url: SITE + '/store/art-craft/', notes: 'الشحن على المبتكر داخل القاهرة', commission_pct: 35,
      contact_name: 'منى عادل', address: ART_ADDRESS, address_parts: ART_PARTS, social: ART_SOCIAL, instagram: ART_SOCIAL.instagram, logo_url: ART_LOGO, banner_url: SITE + '/wp-content/uploads/artcraft-banner.png', woo_payment_methods: ['bank'], woo_snapshot: { name: 'Art Craft', phone: '01000000003' }, woo_synced_at: T0 }),
      vendor(2, 44, 'Antikiano', 'active', { aliases: ['Antikiano store'], phone: '01000000001', category: 'إكسسوارات ومجوهرات', commission_pct: 45, contract: { path: CONTRACT_PATH, file_name: 'antikiano.pdf', size: CONTRACT_BYTES.length, expires: CONTRACT_EXPIRES, uploaded_by: 'منى حسن', uploaded_at: T0 }, push_pending: ['phone'], woo_synced_at: T0 }),
      vendor(3, 2047, 'Bian eg', 'inactive', { aliases: ['Bian'], phone: '01000000000', category: 'ديكور منزلي' })],
    vendorRates: [rate(1, 1, 35, '2026-03-01', null, 'category_based'), rate(2, 2, 40, '2026-03-01'), rate(3, 2, 45, '2026-10-01', 10)], // Antikiano's current rate carries the site's flat fee (0014 vendor_rates.flat)
    // 0014: Art Craft's commission on the site's category 15 (set by the sync), and the two category names the sync pulled
    vendorCategoryRates: [{ id: 1, vendor_id: VND(1), woo_category_id: 15, rate: 30, flat: 0, since: '2026-03-01', set_by: 'الموقع', created_at: T0 }],
    // the site's categories (0014), a tree since phase 3.4: ديكور → إضاءة → أباجورات; هدايا alone
    wooCategories: [{ id: 15, name: 'ديكور', slug: 'decor', parent_id: null, updated_at: T0 }, { id: 22, name: 'هدايا', slug: 'gifts', parent_id: null, updated_at: T0 },
      { id: 151, name: 'إضاءة', slug: 'lighting', parent_id: 15, updated_at: T0 }, { id: 152, name: 'أباجورات', slug: 'lamps', parent_id: 151, updated_at: T0 }],
    // the server's sync rows on Art Craft (actor null, new_value the field names): a change taken from the site, a conflict the site won
    syncActivity: [{ id: 1, at: T0, actor: null, action: 'vendor.sync', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'phone, address_parts' }, { id: 2, at: T0, actor: null, action: 'vendor.sync.conflict', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'name' }, { id: 3, at: T0, actor: null, action: 'vendor.sync.refused', entity: 'vendor', entity_id: VND(1), old_value: null, new_value: 'social' }],
    vendorBank: [{ vendor_id: VND(3), method: 'bank', bank_name: 'البنك الأهلي المصري', holder: 'Bian Egypt', iban: IBAN, wallet: '01000000000', updated_by: 'منى حسن', updated_at: T0 }],
    // 0012 (plan 3.1): Antikiano with a temporary password in the vault (secret_id → the vault entry), Bian eg with a row but no password yet
    vendorLogins: [{ vendor_id: VND(2), username: 'antikiano', email: 'antikiano.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: T0, secret_id: SECRET_ID, created_by: 'صفوت كمال', created_at: T0, updated_at: T0, fails: 0, locked_until: null, own_password: false, last_login_at: null },
      { vendor_id: VND(3), username: 'bian.eg', email: 'bian.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: null, secret_id: null, created_by: 'صفوت كمال', created_at: T0, updated_at: T0, fails: 0, locked_until: null, own_password: false, last_login_at: null }], // bian.eg: a row whose password step was refused (no password yet)
    vault: new Map([[SECRET_ID, TEST_PW]]), // vault.secrets: id → the decrypted secret (never read by the client)
    objects: new Map([[CONTRACT_PATH, { type: 'application/pdf', bytes: CONTRACT_BYTES }]]), // the bucket vendor-contracts
    products: [product(9001, 'IBTA4040PAHC000013', 'Cushion', IMG.cushion, 1, 'cushion', { translation_ids: { en: 9001, ar: 9101 }, total_sales: 40, sizes: ['50×50 cm'] }), // sizes: the site's pa_size values (product_get → editView.sizes, decision 15)
      product(9002, 'IBTAMCTOWM200X10014', 'Macrame Curtain', IMG.curtain, 2, 'macrame-curtain', { type: 'variable', manage_stock: false, stock_quantity: null, stock_status: 'onbackorder', total_sales: 12, brand_ids: [4], category_ids: [22] }),
      product(9003, 'IBTB0CSW6RFTM', 'Macrame Feathers', null, 2, 'macrame-feathers', { status: 'draft', stock_quantity: 0, weight: null, image_count: 0, total_sales: 0, brand_ids: [4] }),
      product(9004, 'IBTK20035BBLM000003214', 'Boho mirror', IMG.cushion, 3, 'boho-mirror', { status: 'pending', stock_quantity: 1, total_sales: 2 }),
      product(9101, 'IBTA4040PAHC000013', 'كيس مخدة', IMG.cushion, 1, 'cushion-ar', { lang: 'ar', translation_ids: { en: 9001, ar: 9101 } }),
      product(9005, 'IBTOLDTRAY01', 'Old Tray', null, 1, 'old-tray', { status: 'trash', trashed_at: ago(4) })],
    // Dokan's own commission on a product (0021 decision 12): Macrame Feathers 20% + 10
    productCommissions: [{ product_id: 9003, rate: 20, type: 'percentage', fee: 10, updated_at: T0 }],
    // the site's WooCommerce Brands (0021)
    wooBrands: [{ id: 3, name: 'Art Craft', slug: 'art-craft', parent_id: null, updated_at: T0 }, { id: 4, name: 'Antikiano', slug: 'antikiano', parent_id: null, updated_at: T0 }],
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
// 0056: while the security policy force2fa is on, every session that is not aal2 is gated (enrolled or not) — the mock's
// security row is read through the tokenUser's `force2fa` flag.
const aalGated = (u) => u.aal !== 'aal2' && (!!u.twofa || !!u.force2fa);
// has_perm of 0001 + 0008: 'N' for a profile that is not active or aal-gated, 'F' for admin, else custom_perms, then the role's matrix
// 0081: the highest of the main and the extra roles (a hidden role gives nothing as an extra); custom_perms first
const permOfRoles = (u, key) => { let best = 0; [u.role_id].concat(Array.isArray(u.extra_roles) ? u.extra_roles : []).forEach((id, i) => { const r = ROLES.find((x) => x.id === id); if (!r || (i > 0 && (r.hidden || id === 'admin'))) return; const p = r.permissions[key]; best = Math.max(best, p === 'F' ? 2 : p === 'P' ? 1 : 0); }); return best === 2 ? 'F' : best === 1 ? 'P' : 'N'; };
const hasPerm = (u, key) => (u.status !== 'active' || aalGated(u) ? 'N' : u.role_id === 'admin' ? 'F' : (u.custom_perms || {})[key] || permOfRoles(u, key));
const isAdmin = (u) => u.status === 'active' && u.role_id === 'admin' && !aalGated(u);
// 0045 (phase 8): the ticket roles of a system role (ticket_role_labels) and the v2 lists the server checks
const TK_ROLES = { admin: ['مدير النظام'], cs: ['خدمة العملاء'], vendors_followup: ['متابعة المبتكرين'], accounts: ['الحسابات'], ops: ['اللوجستيك والشحن', 'المحتوى والتصوير'] };
const TK_ALL_ROLES = ['مدير النظام', 'خدمة العملاء', 'متابعة المبتكرين', 'الحسابات', 'اللوجستيك والشحن', 'المحتوى والتصوير'];
// 0081: a request goes to any role — the six old labels + every other role (not hidden) by its name; my roles = the main + the extras
const TK_OLD_IDS = { admin: ['مدير النظام'], cs: ['خدمة العملاء'], vendors_followup: ['متابعة المبتكرين'], accounts: ['الحسابات'], ops: ['اللوجستيك والشحن', 'المحتوى والتصوير'], viewer: [] };
const tkRolesOf = (mock) => { const all = (mock.st && mock.st.roles) || mock.roles || ROLES; return TK_ALL_ROLES.map((label) => ({ label, role_id: Object.keys(TK_OLD_IDS).find((k) => TK_OLD_IDS[k].includes(label)) }))
  .concat(all.filter((r) => !TK_OLD_IDS[r.id] && !r.hidden).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((r) => ({ label: r.name, role_id: r.id }))); };
const tkRoleOk = (mock, label) => tkRolesOf(mock).some((x) => x.label === label);
const TK_CUSTOMER = ['تأخير في التسليم', 'منتج تالف', 'منتج مختلف عن الطلب', 'مشكلة دفع أو استرجاع', 'العميل مش بيرد', 'أخرى'];
const TK_VENDOR = ['تأخير تسليم', 'جودة', 'خامة ناقصة', 'خلاف على الحساب أو العمولة', 'مش بيرد', 'أخرى'];
const TK_OUTCOMES = ['اتحلت المشكلة', 'مش مشكلة', 'مكرر', 'العميل / المبتكر ما ردش'];
const TK_STATUS = { open: 'مفتوح', in_progress: 'جاري العمل', waiting: 'بانتظار الرد', resolved: 'تم الحل', closed: 'مغلق' };
const TK_PRIO = { urgent: 'عاجل', high: 'عالي', normal: 'عادي', low: 'منخفض' };
const TK_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const tkClean = (v, n) => String(v ?? '').replace(/[\u0001-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const tkRoles = (u) => (u && u.status === 'active' ? [...new Set([u.role_id].concat(Array.isArray(u.extra_roles) ? u.extra_roles : []).flatMap((id) => { if (TK_ROLES[id]) return TK_ROLES[id]; if (id === 'viewer') return []; const r = ROLES.find((x) => x.id === id && !x.hidden); return r ? [r.name] : []; }))] : []);
const tkSees = (u, t) => { const v = hasPerm(u, 'tickets.view'); return v === 'F' || (v === 'P' && (t.created_by === u.id || tkRoles(u).includes(t.assignee_role))); };
// mask_phone of 0007: the first 3 and last 4 characters (10 or more), else •••• and the last 2
// norm_phone (0034): Arabic / Persian digits → ASCII, digits only, 0020 / 20 (12 digits) stripped, a 10-digit number starting with 1 gets its 0
const normPhone = (p) => { let d = String(p ?? '').replace(/[٠-٩۰-۹]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(ch) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))).replace(/\D/g, ''); if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2); return d.length === 10 && d[0] === '1' ? '0' + d : d; };
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
const VT_INSERT = { vendors: ['name', 'aliases', 'phone', 'email', 'status', 'legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contact_name', 'address_parts', 'social'], vendor_rates: ['vendor_id', 'rate', 'flat', 'since', 'set_by'], vendor_bank: ['vendor_id', 'method', 'bank_name', 'holder', 'iban', 'wallet', 'updated_by', 'updated_at', 'account_number', 'account_type', 'bank_address', 'routing_number', 'swift'], vendor_logins: ['vendor_id', 'username', 'email', 'pw_mode', 'created_by'],
  vendor_category_rates: ['vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by'] };
const SYNC_FIELDS = ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates', 'bank']; // + bank (phase 3.5) // woo-core SYNC_FIELDS: push_vendor's fields
const VT_UPDATE = { vendors: VT_INSERT.vendors.concat(['contract']), vendor_bank: VT_INSERT.vendor_bank.filter((c) => c !== 'vendor_id'), vendor_logins: ['username', 'email', 'pw_mode', 'status'] }; // 0012: must_change / invite_sent_at / password_set_at / secret_id are the server's
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/; const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const canLogin = (u) => isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F'; // 0012: vendor_logins insert / update and the two RPCs
const VENDOR_DEFAULTS = () => ({ woo_vendor_id: null, site_removed_at: null, aliases: [], phone: null, email: null, status: 'active', commission_pct: null, raw: null, legal_name: null, category: null, main_categories: [], alt_phone: null, address: null, instagram: null, store_url: null, lead_days: 7, deposit_policy: null, notes: null, joined_at: null, contract: null, opening_balance: 0,
  contact_name: null, address_parts: null, social: null, logo_url: null, banner_url: null, woo_payment_methods: null, woo_snapshot: null, push_pending: null, woo_synced_at: null, photo_path: null });
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
  // ratings: the customer_ratings rows order_complete (0018, phase 3.6) wrote ({ order_id, sat, manners, note, by_user }).
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
  // phase 5.4 decision 11: magnific — the bridge's state on the server (configured = the OAuth client in Vault; linked / account = the
  // tokens; results = the project's creations the site would list: { id, name, family, tool, url, lineage? }); bridgeCalls: every bridge_* call;
  // oauthStates: the PKCE states handed out
  const mock = { aiRuns: [], aiCalls: [], aiFail: null, aiAnswer: null, imgCalls: [], webpCalls: [], importCalls: [], imageImports: [], shareCalls: [], imageShares: [], imgFail: null,
    magnific: { configured: true, linked: false, account: null, results: [], space: null, pages: {}, flows: [], flowResults: {} }, bridgeCalls: [], oauthStates: [],
    // phase 6.2: the Meta channel (cs-channel) — configured: the app secrets on the server; pages: what /me/accounts answers (one page = linked at once); metaCalls: each member action
    meta: { configured: true, verify: true, linked: false, page: null, candidates: [], pages: [{ id: '111', name: 'Ibtekr Club', ig: { id: '777', username: 'ibtekr.club' } }] }, metaCalls: [],
    // decision 12: shot_prompts (0030) — the owner's template categories; flows: the flows made on the one Space; flowResults[batchId] = { 1: [ids], 2: [...], 3: [...] } the site's output lists
    shotPrompts: [['كرسي', 1, 'كرسي 1 — تركيز على المنتج', 'CHAIR FOCUS PROMPT'], ['كرسي', 2, 'كرسي 2 — المنتج في بيئة محيطة', 'CHAIR ENV PROMPT'], ['كرسي', 3, 'كرسي 3 — Closeup للتفاصيل', 'CHAIR DETAIL PROMPT'], ['مرآة', 1, 'مرآة 1 — تركيز على المنتج', 'MIRROR FOCUS PROMPT']].map(([category, shot, name, prompt], i) => ({ id: i + 1, category, shot, name, prompt, negative: null, model: 'imagen-nano-banana-2', aspect: '3:4', resolution: '1k', updated_at: new Date().toISOString() })), imgObjects: new Map(), imgSeq: 0, settings: [], studioBatches: [], studioSeq: 0, studioWrites: [], studioObjects: new Map(), studioUploads: [], serialTakes: [], skuSerial: 999, categoriesCreated: [], sheetLinks: {}, sheetReads: [],
    skuColors: [['Beige', 'بيج', 'BE', '#d9c3a0'], ['Black', 'أسود', 'BK', '#1d1d1b'], ['White', 'أبيض', 'WH', '#ffffff'], ['Multicolor', 'ملون', 'MC', null]].map(([name_en, name_ar, code, hex], i) => ({ id: i + 1, name_en, name_ar, code, hex })),
    profiles, profileWrites: [], factors, enrolls: [], unenrolls: [], twofaCalls: [], twofaRefused: false, rateLimited: false, logouts: 0, logoutScopes: [], afterLogout: 0, activityDelayMs: 0, activity: [], activityRows: [], prefs: [], prefsDown: false, alerts: ALERTS(), alertReads: [], userUpdates: [], recovers: [], lookups: [], requests: [], unhandled: [],
    ...ordersSeed(opts), patches: [], ordersDown: false, pushes: [], syncs: [], wooDown: false, wooRefuses: false, functionsDown: false, vendorWrites: [], vendorsDown: false, uploads: [], signs: [], signed: new Map(), rpcs: [], vaultDown: false, brandWrites: [], vendorPushes: [], pushEnabled: true, ratings: [], deletes: [], trashes: [], csMedia: new Map(), orderCreates: [], vendorPhotos: new Map(), photoCalls: [], productLeads: (opts && opts.productLeads) || [], leadWrites: [] }; // phase 13 decision 51: vendor-photos objects and the vendor_photo calls; phase 13 T3: cs-media objects, the orders made from the chat
  // phase 3.3: vendorCategoryRates / wooCategories: the 0014 tables (ordersSeed()); vendorPushes: each woo-sync push_vendor as { vendor_id, fields, by, result, reason? }
  // (the body names the fields only — the mock reads the row like the server); pushEnabled: WOO_PUSH_ENABLED on the server (false → skipped/push_disabled,
  // the fields added to push_pending); wooDown → 502 pending:true with the fields in push_pending; wooRefuses → 502 pending:false, nothing
  // pending (the site's final answer); functionsDown → the request is aborted (the adapter queues the fields through vendor_push_pending). installSupabaseMock(page, { syncRows: true }) seeds the
  // server's sync rows (ordersSeed().syncActivity) into activity_log — opt-in, so the dashboard's «newest 5» expectations stay exact.
  if (opts.syncRows) mock.activityRows.push(...mock.syncActivity);
  // phase 4 (0019): acc: the three ledgers + the two Dokan mirrors (acc.dokan_balances / acc.dokan_withdrawals: a spec may seed them);
  // accWrites: each insert / update a ledger took as { table, op, ...columns }; accountsDown: those tables answer 503;
  // statements: each woo-sync `statement` call ({ vendor_id, from, to, by }); statementRows: what it answers.
  // phase 4.1 (0020): acc.acc_list_items (subs / ads, add F, unique per list without case); approvals: each woo-sync
  // withdraw_approve call ({ id, by, result, reason? }) — mock.pushEnabled is the same WOO_PUSH_ENABLED gate.
  // 0078: acc.acc_vendor_settlements (the server's, read with accounts.view); a move's settled_by / settled_at (the server's; a settled
  // move is final: 42501); a «إيداع» is a correction (kind أخرى, else 23514); withdrawCreates: each woo-sync withdraw_create
  // ({ vendor_id, by, result, reason?, id?, amount? }); withdraw_approve settles the maker's open moves like acc_settle_withdrawal.
  mock.acc = { acc_expenses: [], acc_vendor_moves: [], acc_account_moves: [], acc_list_items: [], dokan_balances: (opts.dokanBalances || []).map((x) => ({ ...x })), dokan_withdrawals: (opts.dokanWithdrawals || []).map((x) => ({ ...x })),
    acc_vendor_settlements: (opts.settlements || []).map((x) => ({ ...x })) };
  mock.approvals = []; mock.withdrawCreates = [];
  // phase 6 (0034): the customer-service tables. cs.customers: one row per normalised phone of the seeded orders (the backfill)
  // plus a manual lead; one open customer conversation (assigned to M02, two messages) and one closed maker conversation; the
  // five channels disconnected; csWrites: each insert / update / delete a member sent as { table, op, ...columns } (never the phone).
  const CS_C = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0'); const CS_K = (n) => 'd1000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const csAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  // a time «أمس» at any hour: yesterday's noon (local, as the page labels it) minus minutes — an offset from now alone lands on today
  // late in the evening (the closed vendors' conversation read «12:20 ص» at 23:40 UTC, 6 Nov)
  const csYday = (minutes) => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return new Date(d.getTime() - minutes * 60000).toISOString(); };
  mock.cs = {
    customers: mock.orders.map((o) => ({ phone: normPhone(o.customer_phone), name: o.customer_name, city: o.customer_city || null, address: o.customer_address || null, province: o.customer_state || null }))
      .filter((c, i, a) => c.phone && a.findIndex((x) => x.phone === c.phone) === i)
      .map((c, i) => ({ id: CS_C(i + 1), ...c, ig: null, address2: null, mood: null, tags: [], consent: true, auto_consent: true, source: null, created_from: 'orders', blocked_at: null, blocked_by: null, merged_into: null, created_by: null, created_at: T0, updated_at: null }))
      .concat([{ id: CS_C(9), phone: '01277766655', name: 'يوسف حامد', ig: null, city: 'المنصورة', province: null, address: null, address2: null, mood: 'متوسط', tags: ['مهتم'], consent: true, auto_consent: true, source: 'إعلان فيسبوك', created_from: 'manual', blocked_at: null, blocked_by: null, merged_into: null, created_by: ADMIN, created_at: T0, updated_at: null }]),
    notes: [{ id: 1, customer_id: CS_C(1), text: 'بتحب التغليف كهدية دايماً — اسألها قبل الشحن.', author: '00000000-0000-4000-8000-000000000002', at: csAgo(90) }],
    overrides: [], teamRatings: [],
    // decision 19: the post the comments thread is on (the pull keeps it)
    posts: [{ id: '111_p1', platform: 'facebook', caption: 'مراية خشب دهبي بمقاس 60×90 — متاحة دلوقتي', permalink: 'https://www.facebook.com/ibtekr/posts/1', thumb: null, kind: 'added_photos', posted_at: csAgo(600), seen_at: csAgo(1) },
      { id: '111_p2', platform: 'facebook', caption: 'ترابيزة قهوة رخام', permalink: 'https://www.facebook.com/ibtekr/posts/2', thumb: null, kind: 'added_video', posted_at: csAgo(300), seen_at: csAgo(1) }],
    conversations: [
      { id: CS_K(1), seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: CS_C(1), vendor_id: null, handle: null, external_id: null, status: 'مستنية ردنا', assignee: '00000000-0000-4000-8000-000000000002', outcome: null, tags: ['شكوى'], last_in_at: csAgo(18), last_out_at: null, waiting_since: csAgo(18), unread: 1, snoozed_until: null, closed_at: null, closed_by: null, created_by: null, created_at: csAgo(200), updated_at: csAgo(18) },
      { id: CS_K(2), seg: 'vendors', platform: 'whatsapp', channel: 'wa2', customer_id: null, vendor_id: VND(1), handle: null, external_id: null, status: 'اتحلت', assignee: ADMIN, outcome: 'اتحل', tags: [], last_in_at: csYday(100), last_out_at: csYday(40), waiting_since: null, unread: 0, snoozed_until: null, closed_at: csYday(0), closed_by: ADMIN, created_by: ADMIN, created_at: csYday(200), updated_at: csYday(0) },
      // phase 6.2: a Messenger thread (the server's: external_id = the PSID) waiting for the customer, and a Facebook comments thread (post × commenter)
      { id: CS_K(3), seg: 'customers', platform: 'messenger', channel: 'messenger', customer_id: CS_C(2), vendor_id: null, handle: null, external_id: '900', status: 'مستنية العميل', assignee: null, outcome: null, tags: [], last_in_at: csAgo(60), last_out_at: csAgo(50), waiting_since: null, unread: 0, snoozed_until: null, closed_at: null, closed_by: null, created_by: null, created_at: csAgo(60), updated_at: csAgo(50) },
      { id: CS_K(4), seg: 'comments', platform: 'facebook', channel: 'messenger', customer_id: null, vendor_id: null, handle: 'Noha H', external_id: '111_p1:42', status: 'جديدة', assignee: null, outcome: null, tags: [], last_in_at: csAgo(30), last_out_at: null, waiting_since: csAgo(30), unread: 1, snoozed_until: null, closed_at: null, closed_by: null, created_by: null, created_at: csAgo(30), updated_at: csAgo(30) },
      { id: CS_K(5), seg: 'comments', platform: 'facebook', channel: 'messenger', customer_id: null, vendor_id: null, handle: 'Ali S', external_id: '111_p2:43', status: 'جديدة', assignee: null, outcome: null, tags: [], last_in_at: csAgo(20), last_out_at: null, waiting_since: csAgo(20), unread: 1, snoozed_until: null, closed_at: null, closed_by: null, created_by: null, created_at: csAgo(20), updated_at: csAgo(20) }],
    messages: [
      { id: CS_K(11), conversation_id: CS_K(1), kind: 'in', text: 'لو سمحت الأوردر 181668 اتأخر ليه؟', author: null, external_id: null, delivery: null, meta: {}, created_at: csAgo(18) },
      { id: CS_K(12), conversation_id: CS_K(1), kind: 'note', text: 'كلموا المبتكر على واتساب 2', author: '00000000-0000-4000-8000-000000000002', external_id: null, delivery: null, meta: {}, created_at: csAgo(15) },
      { id: CS_K(13), conversation_id: CS_K(3), kind: 'in', text: 'عندكم المراية دي بمقاس أكبر؟', author: null, external_id: 'm.1', delivery: null, meta: {}, created_at: csAgo(60) },
      { id: CS_K(14), conversation_id: CS_K(3), kind: 'out', text: 'أيوه، 60×90 متاحة', author: ADMIN, external_id: 'm.2', delivery: 'read', meta: {}, created_at: csAgo(50) },
      { id: CS_K(15), conversation_id: CS_K(4), kind: 'in', text: 'السعر كام؟', author: null, external_id: '111_c1', delivery: null, meta: { post_id: '111_p1', comment_id: '111_c1' }, created_at: csAgo(30) },
      { id: CS_K(21), conversation_id: CS_K(2), kind: 'out', text: 'إمتى تقدروا تسلّموا الأوردر الفرعي؟', author: ADMIN, external_id: null, delivery: 'read', meta: {}, created_at: csYday(40) }],
    segments: [{ id: CS_K(31), name: 'VIP راضيين', min_total: 1000, min_orders: null, moods: [], last_kind: null, last_from: null, last_to: null, ranges: { sat: [4, 5] }, include_unrated: false, add_ids: [], remove_ids: [], created_by: ADMIN, created_at: T0, updated_at: null }],
    campaigns: [{ id: CS_K(41), name: 'عرض العملاء المتكررين — أكتوبر', segment_id: CS_K(31), channel: 'wa1', body: 'خصم 10% بالكود {كود_الخصم}', image_path: null, discount_code: 'OCT10', scheduled_at: null, cap_per_day: 300, min_delay_s: 20, test_phone: null, status: 'مسودة', size: 2, stats: {}, created_by: ADMIN, created_at: T0, updated_at: null }],
    channels: [['wa1', 'واتساب 1 · العملاء', 'customers', 'meta', 300], ['wa2', 'واتساب 2 · المبتكرين', 'vendors', 'qr', 150], ['messenger', 'ماسنجر', 'customers', 'meta', 1000], ['instagram', 'إنستجرام', 'customers', 'meta', 1000], ['tiktok', 'تيك توك', 'customers', 'none', 0]]
      .map(([id, name, audience, kind, cap_per_day]) => ({ id, name, audience, kind, status: 'disconnected', number: null, cap_per_day, since: null, last_message_at: null, meta: {}, updated_at: null })),
  };
  // 0058 (phase 6.5): one template with a quick key, one quick reply, one rule on it (off), an empty run log
  mock.cs.templates = [{ id: CS_K(61), lib: 'customers', name: 'تأكيد الأوردر', cat: 'حالة الأوردر', tone: 'brand', body: 'أهلاً {اسم_العميل} 👋 أوردرك {رقم_الأوردر} اتأكد بإجمالي {الإجمالي}.', trig_kind: 'auto', trig_on: ['جاري التنفيذ'], trig_when: 'فورًا', channels: 'كل القنوات', quick_key: '/تأكيد', wa_template: 'order_confirmed_v1', wa_vars: ['اسم_العميل', 'رقم_الأوردر', 'الإجمالي'], used: 0, active: true, created_by: ADMIN, created_at: T0, updated_by: null, updated_at: T0 }];
  mock.cs.quick = [{ id: CS_K(71), key: '/شحن', label: 'مواعيد ومصاريف الشحن', text: 'الشحن جوه القاهرة والجيزة 2–3 أيام بعد التصنيع (65 ج.م)، وباقي المحافظات 3–5 أيام (85 ج.م).', created_by: ADMIN, created_at: T0, updated_by: null, updated_at: T0 }];
  mock.cs.rules = [{ id: CS_K(81), name: 'تأكيد الأوردر', grp: 'العملاء — حالة الأوردر', event: 'status', event_to: 'جاري التنفيذ', conds: [['القناة', '=', 'واتساب 1']], action: 'send', template_id: CS_K(61), role_id: null, tag: null, delay_min: 5, once: true, ticket_if_silent: false, enabled: false, runs: 0, last_run_at: null, created_by: ADMIN, created_at: T0, updated_by: null, updated_at: T0 }];
  mock.cs.autoRuns = [];
  mock.csWrites = []; mock.csDown = false; let csSeq = 100;
  // phase 7 (0044): the inventory hub — places seeded like the migration; lots / moves from opts; every write in invWrites
  mock.inv = { inv_locations: [['T', 'منطقة التجميع', 'zone'], ['R', 'المرتجعات', 'zone'], ['P', 'التصوير', 'zone'], ['A', 'رف A', 'rack'], ['B', 'رف B', 'rack'], ['C', 'رف C', 'rack'], ['D', 'رف D', 'rack']].map(([code, label, kind]) => ({ code, label, kind, note: null })),
    inv_lots: (opts.invLots || []).map((x) => ({ product_id: null, vendor_id: null, order_id: null, item_id: null, ref: null, loc: null, mode: 'أمانة', cost: 0, condition: null, condition_note: null, note: null, closed_at: null, created_by: ADMIN, created_at: T0, since: '2026-11-01', ...x })),
    inv_moves: (opts.invMoves || []).map((x, i) => ({ id: i + 1, label: null, reason: null, ref: null, note: null, by: ADMIN, at: T0, ...x })),
    inv_consolidations: (opts.invConsolidations || []).map((x) => ({ zone: 'T', status: 'open', carrier: null, since: '2026-11-01', created_by: ADMIN, created_at: T0, ...x })),
    inv_consolidation_items: (opts.invConsolidationItems || []).map((x) => ({ ...x })), inv_counts: [], inv_count_lines: [] };
  mock.invWrites = [];
  // phase 8 (0045): team tickets — rows as the database holds them (opts.tickets / opts.ticketEvents), the files of the bucket
  // «tickets» (path → { type, size }), and every RPC call the client sent as { fn, ...args }
  mock.tickets = (opts.tickets || []).map((x) => ({ order_number: null, order_id: null, customer: null, cs_customer_id: null, cs_conversation_id: null, vendor_id: null, vendor: null, reason: null, follow_up: null,
    attachments: [], status: 'open', created_by: ADMIN, created_by_name: 'صفوت كمال', created_by_role: 'مدير النظام', created_at: T0, last_update: T0, reopen_count: 0, resolution_outcome: null, resolution_note: null,
    resolved_by: null, resolved_by_name: null, resolved_at: null, closed_by: null, closed_by_name: null, closed_at: null, ...x }));
  mock.ticketEvents = (opts.ticketEvents || []).map((x, i) => ({ id: i + 1, kind: 'event', at: T0, actor: ADMIN, actor_name: 'صفوت كمال', actor_role: 'مدير النظام', old_value: null, new_value: null, attachments: [], ...x }));
  mock.ticketObjects = new Map(Object.entries(opts.ticketObjects || {})); mock.ticketWrites = []; mock.ticketsDown = false;
  // phase 10 (0046): the HR rows (hr-mock.mjs hrState: opts.hrMembers / hrPay / hrAttendance / hrOvertime / hrRequests / …), hr.calls / hr.writes
  mock.hr = hrState(opts);
  // phase 9.5.1 (0049): the marketing rows (mkt-mock.mjs mktState: opts.mktCampaigns / mktPosts / mktTemplates / mktObjects / mktCap / mktUsed), mkt.calls / mkt.writes
  mock.mkt = mktState(opts);
  // phase 11 (0056): the settings page's server side (settings-mock.mjs settingsState: opts.vault / companyDocs / settingsObjects / sessions / probeOk), st.calls / st.writes; the roles copy of this install
  mock.st = settingsState(opts, ROLES); mock.roles = mock.st.roles;
  mock.portal = portalState(); // phase 13 T4
  mock.accWrites = []; mock.accountsDown = false; mock.statements = []; mock.statementRows = opts.statementRows || [];
  let accSeq = 0;
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
    // a stored object's content type by its name (every body is the 1×1 PNG — browsers decode by the bytes, not the header)
    const ctOf = (key) => (/\.webp$/i.test(key) ? 'image/webp' : /\.jpe?g$/i.test(key) ? 'image/jpeg' : 'image/png');
    // phase 5.2: a signed URL of the bucket studio (a thumbnail) — any token the mock signed opens the object
    const sgs = /^\/storage\/v1\/object\/sign\/studio\/(.+)$/.exec(path);
    if (method === 'GET' && sgs) { const obj = mock.studioObjects.get(decodeURIComponent(sgs[1])); return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': ctOf(sgs[1]) }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
    // phase 5.4: a signed URL of the bucket ai-images (the images tool's results) — same rule
    const sgi = /^\/storage\/v1\/object\/sign\/ai-images\/(.+)$/.exec(path);
    if (method === 'GET' && sgi) { const obj = mock.imgObjects.get(decodeURIComponent(sgi[1])); return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': ctOf(sgi[1]) }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
    // phase 8: a signed URL of the bucket tickets (an attachment's thumbnail / link) — any token the mock signed opens the object
    // phase 13 T3: a signed URL of the bucket cs-media (a bubble's image / file) — any token the mock signed opens the object
    const sgm = /^\/storage\/v1\/object\/sign\/cs-media\/(.+)$/.exec(path);
    if (method === 'GET' && sgm) { const obj = mock.csMedia.get(decodeURIComponent(sgm[1])); return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': obj.type || 'image/png' }, body: obj.type === 'application/pdf' ? Buffer.from('%PDF-1.4\n%mock\n') : PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
    const sgt = /^\/storage\/v1\/object\/sign\/tickets\/(.+)$/.exec(path);
    if (method === 'GET' && sgt) { const obj = mock.ticketObjects.get(decodeURIComponent(sgt[1])); return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': obj.type || 'image/png' }, body: obj.type === 'application/pdf' ? Buffer.from('%PDF-1.4\n%mock\n') : PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
    // a signed URL of vendor-contracts is opened with no api key (a new tab, an <a>): its token alone opens the object
    const sg = /^\/storage\/v1\/object\/sign\/vendor-contracts\/(.+)$/.exec(path);
    if (method === 'GET' && sg) {
      const tok = url.searchParams.get('token'); const sig = tok && mock.signed.get(tok); const obj = sig && sig.path === sg[1] && sig.exp > Date.now() ? mock.objects.get(sig.path) : null;
      return obj ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': obj.type, 'content-length': String(obj.bytes.length) }, body: obj.bytes }) : json(400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
    }
    if (method === 'GET' && /^\/storage\/v1\/object\/sign\/hr-docs\//.test(path)) return hrRoute({ method, path, url, hd, body, u: null, hasPerm, isAdmin, json, mock, route }); // phase 10: a signed hr-docs link
    if (method === 'GET' && /^\/storage\/v1\/object\/sign\/marketing\//.test(path)) return mktRoute({ method, path, url, hd, body, u: null, hasPerm, isAdmin, json, mock, route }); // phase 9.5.1: a signed marketing link
    if (hd.apikey !== ANON_KEY) return json(401, { message: 'No API key found in request' });
    const bearer = (hd.authorization || '').replace(/^Bearer /, '');
    // the caller: a snapshot of its profile row with the token's aal (writes go through profileOf)
    const force2fa = () => { const r = mock.settings.find((x) => x.section === 'security'); return !!(r && r.data && r.data.force2fa === true); };
    const tokenUser = () => { const row = issued.has(bearer) ? profileOf(claims(bearer).sub) : null; return row ? { ...row, aal: claims(bearer).aal, force2fa: force2fa() } : null; };
    const aal = () => (issued.has(bearer) ? claims(bearer).aal : null);
    { const hr = hrRoute({ method, path, url, hd, body, u: path.startsWith('/rest/v1/') && bearer !== ANON_KEY && !issued.has(bearer) ? null : tokenUser(), hasPerm, isAdmin, json, mock, route }); if (hr) return hr; } // phase 10 (0046)
    { const mk = mktRoute({ method, path, url, hd, body, u: path.startsWith('/rest/v1/') && bearer !== ANON_KEY && !issued.has(bearer) ? null : tokenUser(), hasPerm, isAdmin, json, mock, route }); if (mk) return mk; } // phase 9.5.1 (0049)
    { const st = settingsRoute({ method, path, url, hd, body, u: path.startsWith('/rest/v1/') && bearer !== ANON_KEY && !issued.has(bearer) ? null : tokenUser(), hasPerm, isAdmin, json, mock, route }); if (st) return st; } // phase 11 (0056)
    { const pt = portalRoute({ method, path, url, hd, body, u: null, hasPerm, isAdmin, json, mock, route }); if (pt) return pt; } // phase 13 T4: the maker portal (no member token — its own x-portal-token)

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
      // 0034 (phase 6): the customer-service tables as RLS + the guards + the column grants read them. cs_customers: a member never
      // reads the phone (the rpc below masks it), inserts a manual / import lead with cs.manage, updates mood / tags with cs.reply
      // or the rest with cs.manage (phone / created_* fixed); conversations: cs.view F all, P the assigned ones; insert / update
      // with cs.reply (a plain conversation only; identity fixed; closed_* stamped); messages: note / event / out only (out → queued);
      // notes / overrides / team ratings insert with cs.reply as oneself; segments / campaigns cs.manage (a draft or a schedule;
      // delete a draft); channels read-only. Filters: id / customer_id / conversation_id eq. or in.(…), or=(status.neq.اتحلت,updated_at.gte.X).
      // phase 7 (0044): the inventory tables — select with inventory.view; insert / update with inventory.edit (a manual adjust with
      // inventory.approve); moves append-only; a count line's system quantity the server's (the lot's on hand); a closed
      // consolidation final. Filters: eq. / in.(…) / is.null. inv_count_approve: inventory.approve, the adjustments = counted − on hand.
      const invT = /^\/rest\/v1\/(inv_locations|inv_lots|inv_moves|inv_consolidations|inv_consolidation_items|inv_counts|inv_count_lines)$/.exec(path);
      const onHand = (lot) => mock.inv.inv_moves.filter((m) => m.lot_id === lot).reduce((n, m) => n + (['in', 'adjust'].includes(m.type) ? m.qty : ['out', 'ship'].includes(m.type) ? -m.qty : 0), 0);
      if (invT) {
        const t = invT[1]; const rows = mock.inv[t]; const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        const single = /vnd\.pgrst\.object\+json/.test(hd.accept || ''); const now = new Date().toISOString();
        const fns = [...url.searchParams].filter(([k]) => !NOT_FILTERS.has(k)).map(([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v === 'is.null' ? (r) => r[k] == null : /^in\.\(.*\)$/.test(v) ? ((set) => (r) => set.includes(String(r[k])))(v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1'))) : null));
        if (fns.some((f) => !f)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + t);
        const match = (r) => fns.every((f) => f(r)); const view = hasPerm(u, 'inventory.view') !== 'N'; const edit = hasPerm(u, 'inventory.edit') === 'F';
        const out = (list) => (single ? (list.length ? json(200, { ...list[0] }) : refuse(406, 'PGRST116', 'no rows')) : json(method === 'POST' ? 201 : 200, list.map((r) => ({ ...r }))));
        if (method === 'GET') {
          if (!view) return json(200, []);
          let list = rows.filter(match); if (t === 'inv_moves') list = list.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)); if (t === 'inv_counts') list = list.slice().sort((a, b) => b.id - a.id);
          return out(list);
        }
        if (mock.invDown) return json(503, { message: 'mock: inventory down' });
        const rls = () => refuse(403, '42501', 'new row violates row-level security policy for table "' + t + '"');
        if (method === 'POST') {
          if (!edit) return rls();
          const made = [];
          for (const r of [].concat(body())) {
            let rec;
            if (t === 'inv_moves') {
              if (r.type === 'adjust' && hasPerm(u, 'inventory.approve') !== 'F') return refuse(403, '42501', 'a manual adjustment needs inventory.approve');
              if (!(r.type === 'move' ? r.qty === 0 : r.type === 'adjust' ? r.qty !== 0 : r.qty > 0)) return refuse(400, '23514', 'inv_moves_check');
              if (!mock.inv.inv_lots.some((l) => l.id === r.lot_id)) return refuse(409, '23503', 'inv_moves_lot_id_fkey');
              rec = { label: null, reason: null, ref: null, note: null, ...r, id: mock.inv.inv_moves.reduce((n, m) => Math.max(n, m.id), 0) + 1, by: u.id, at: now };
            } else if (t === 'inv_lots') rec = { product_id: null, vendor_id: null, order_id: null, item_id: null, ref: null, loc: null, cost: 0, condition: null, condition_note: null, note: null, ...r, closed_at: null, created_by: u.id, created_at: now };
            else if (t === 'inv_consolidations') { if (rows.some((x) => x.order_id === r.order_id && x.status === 'open')) return refuse(409, '23505', 'inv_consolidations_open_idx'); rec = { zone: 'T', ...r, status: 'open', carrier: null, since: now.slice(0, 10), created_by: u.id, created_at: now }; }
            else if (t === 'inv_consolidation_items') { const c = mock.inv.inv_consolidations.find((x) => x.id === r.consolidation_id); const it = mock.orderItems.find((x) => String(x.id) === String(r.item_id)); if (!c || c.status !== 'open' || !it || Number(it.order_id) !== Number(c.order_id)) return rls(); rec = { ...r }; }
            else if (t === 'inv_counts') rec = { note: null, ...r, id: rows.reduce((n, x) => Math.max(n, x.id), 0) + 1, status: 'open', started_by: u.id, started_at: now, approved_by: null, approved_at: null };
            else if (t === 'inv_count_lines') rec = { counted: null, note: null, ...r, system: onHand(r.lot_id) };
            else { if (rows.some((x) => x.code === r.code)) return refuse(409, '23505', 'inv_locations_pkey'); rec = { note: null, ...r }; }
            made.push(rec);
          }
          made.forEach((rec) => { rows.push(rec); mock.invWrites.push({ table: t, op: 'insert', ...rec }); });
          return out(made);
        }
        if (method === 'PATCH') {
          if (!['inv_lots', 'inv_consolidations', 'inv_count_lines'].includes(t)) return refuse(403, '42501', 'permission denied for table ' + t);
          if (!edit) return json(200, []);
          const b = body(); const list = rows.filter(match);
          for (const r of list) {
            if (t === 'inv_consolidations' && r.status !== 'open') return refuse(403, '42501', 'a closed consolidation is final');
            if (t === 'inv_count_lines' && (mock.inv.inv_counts.find((x) => x.id === r.count_id) || {}).status !== 'open') return refuse(403, '42501', 'an approved count is final');
            const { system, created_by, created_at, ...patch } = b; Object.assign(r, patch); if (t === 'inv_consolidations' && patch.status && patch.status !== 'open') Object.assign(r, { closed_at: now, closed_by: u.id });
            mock.invWrites.push({ table: t, op: 'update', ...patch, id: r.id || r.lot_id });
          }
          return out(list);
        }
        return refuse(403, '42501', 'permission denied for table ' + t);
      }
      // phase 8 (0045): tickets / ticket_events — read through ticket_can_see (F all; P my role's + the ones I opened); no direct
      // write for a member; ticket_create / ticket_act apply the v2 domain's rules and write the timeline (the server's texts).
      const tkT = /^\/rest\/v1\/(tickets|ticket_events)$/.exec(path);
      if (tkT) {
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (method !== 'GET') return refuse(403, '42501', 'permission denied for table ' + tkT[1]);
        if (!u) return json(200, []);
        if (mock.ticketsDown) return json(503, { message: 'mock: tickets down' });
        const fns = [...url.searchParams].filter(([k]) => !NOT_FILTERS.has(k)).map(([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v.startsWith('gte.') ? (r) => String(r[k]) >= v.slice(4) : null));
        if (fns.some((f) => !f)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + tkT[1]);
        const seen = new Set(mock.tickets.filter((t) => tkSees(u, t)).map((t) => t.id));
        const ord = url.searchParams.get('order') || ''; const lim = Number(url.searchParams.get('limit')) || 0;
        let list = (tkT[1] === 'tickets' ? mock.tickets.filter((t) => seen.has(t.id)) : mock.ticketEvents.filter((e) => seen.has(e.ticket_id))).filter((r) => fns.every((f) => f(r)));
        const [col, dir] = ord.split('.'); if (col) list = list.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : a.id - b.id) * (dir === 'desc' ? -1 : 1));
        if (lim) list = list.slice(0, lim);
        return json(200, list.map((r) => JSON.parse(JSON.stringify(r))));
      }
      if (method === 'POST' && path === '/rest/v1/rpc/ticket_roles') return u ? json(200, tkRolesOf(mock)) : json(401, { code: '42501', message: 'permission denied' });
      if (method === 'POST' && (path === '/rest/v1/rpc/ticket_create' || path === '/rest/v1/rpc/ticket_act')) {
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        const bad = (f) => refuse(400, '22023', 'invalid: ' + f); const deny = (m) => refuse(403, '42501', m);
        if (!u || hasPerm(u, 'tickets.manage') !== 'F') return deny('tickets.manage required');
        if (mock.ticketsDown) return json(503, { message: 'mock: tickets down' });
        const b = body(); const now = new Date().toISOString(); const roles = tkRoles(u);
        const who = { name: u.name, role: roles[0] || (ROLES.find((r) => r.id === u.role_id) || {}).name || 'عضو' };
        const ev = (tk, kind, text, oldV, newV, files) => { mock.ticketEvents.push({ id: mock.ticketEvents.reduce((m, e) => Math.max(m, e.id), 0) + 1, ticket_id: tk.id, kind, at: now, actor: u.id, actor_name: who.name, actor_role: who.role, text, old_value: oldV ?? null, new_value: newV ?? null, attachments: files || [] }); tk.last_update = now; };
        const day = (v) => { if (v == null || String(v).trim() === '') return null; const x = String(v).trim(); const d = new Date(x + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === x ? x : undefined; };
        const filesOf = (a) => { if (a == null) return []; if (!Array.isArray(a) || a.length > 10) return undefined; const out = [];
          for (const f of a) { if (!f || typeof f.path !== 'string' || !new RegExp('^' + u.id + '/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$').test(f.path)) return undefined; if (out.some((x) => x.path === f.path)) continue;
            const obj = mock.ticketObjects.get(f.path); const type = obj ? obj.type : f.type; const size = obj ? obj.size : Number(f.size);
            if (!TK_MIME.includes(type) || !(size >= 0 && size <= 10485760)) return undefined; out.push({ path: f.path, name: tkClean(f.name, 120) || f.path.replace(/^.*\//, ''), type, size }); }
          return out; };
        if (path.endsWith('ticket_create')) {
          const i = b.p_input || {}; mock.ticketWrites.push({ fn: 'ticket_create', ...JSON.parse(JSON.stringify(i)) });
          if (!['customer', 'vendor', 'internal'].includes(i.type)) return bad('type');
          const title = tkClean(i.title, 1000); if (!title || title.length > 80) return bad('title');
          const description = tkClean(i.description, 5000); if (!description) return bad('description');
          if (!TK_PRIO[i.priority]) return bad('priority'); if (!tkRoleOk(mock, i.assigneeRole)) return bad('assigneeRole');
          const follow = day(i.followUp); if (follow === undefined) return bad('followUp');
          const attachments = filesOf(i.attachments); if (!attachments) return bad('attachments');
          const rec = { id: mock.tickets.reduce((m, t) => Math.max(m, t.id), 0) + 1, type: i.type, title, description, priority: i.priority, assignee_role: i.assigneeRole, order_number: null, order_id: null,
            customer: tkClean(i.customer, 80) || null, cs_customer_id: null, cs_conversation_id: null, vendor_id: null, vendor: null, reason: null, follow_up: follow, attachments, status: 'open',
            created_by: u.id, created_by_name: who.name, created_by_role: who.role, created_at: now, last_update: now, reopen_count: 0, resolution_outcome: null, resolution_note: null,
            resolved_by: null, resolved_by_name: null, resolved_at: null, closed_by: null, closed_by_name: null, closed_at: null };
          if (i.csConversationId) { if (hasPerm(u, 'cs.view') === 'N') return bad('csConversationId'); const cv = mock.cs.conversations.find((x) => x.id === i.csConversationId && (hasPerm(u, 'cs.view') === 'F' || x.assignee === u.id)); if (!cv) return bad('csConversationId'); rec.cs_conversation_id = cv.id; rec.cs_customer_id = cv.customer_id || null; }
          if (i.csCustomerId) { if (hasPerm(u, 'cs.view') === 'N' || !mock.cs.customers.some((x) => x.id === i.csCustomerId)) return bad('csCustomerId'); rec.cs_customer_id = i.csCustomerId; }
          if (i.type === 'customer') {
            rec.order_number = tkClean(i.orderId, 20) || null; if (!rec.order_number) return bad('orderId'); if (!TK_CUSTOMER.includes(i.reason)) return bad('reason'); rec.reason = i.reason;
            const o = hasPerm(u, 'orders.view') === 'F' ? mock.orders.find((x) => String(x.number) === rec.order_number || String(x.id) === rec.order_number) : null;
            if (o) { rec.order_id = Number(o.id); rec.customer = rec.customer || String(o.customer_name || '').slice(0, 80) || null;
              if (!rec.cs_customer_id && o.customer_phone && hasPerm(u, 'cs.view') !== 'N') { const cu = mock.cs.customers.find((x) => x.phone === normPhone(o.customer_phone)); if (cu) rec.cs_customer_id = cu.id; } }
          } else if (i.type === 'vendor') {
            const v = mock.vendors.find((x) => x.id === i.vendorId); if (!v) return bad('vendor'); if (!TK_VENDOR.includes(i.reason)) return bad('reason'); rec.vendor_id = v.id; rec.vendor = String(v.name).slice(0, 80); rec.reason = i.reason;
          }
          mock.tickets.push(rec); ev(rec, 'event', who.name + ' أنشأ التذكرة وعيّنها لدور «' + rec.assignee_role + '»'); ev(rec, 'message', description);
          return json(200, rec.id);
        }
        const tk = mock.tickets.find((t) => t.id === Number(b.p_id)); const a = b.p_args || {}; mock.ticketWrites.push({ fn: 'ticket_act', id: Number(b.p_id), action: b.p_action, ...JSON.parse(JSON.stringify(a)) });
        if (!tk || !tkSees(u, tk)) return refuse(404, 'P0002', 'ticket not found');
        const work = isAdmin(u) || roles.includes(tk.assignee_role); const closer = isAdmin(u) || tk.created_by === u.id;
        const act = b.p_action;
        if (act === 'set_status') {
          if (!['in_progress', 'waiting'].includes(a.status)) return bad('status'); if (!work) return deny('not the role of this ticket'); if (tk.status === 'closed') return bad('closed');
          if (tk.status !== a.status) { const old = tk.status; tk.status = a.status; ev(tk, 'event', who.name + ' غيّر الحالة من «' + TK_STATUS[old] + '» إلى «' + TK_STATUS[a.status] + '»', old, a.status); }
        } else if (act === 'resolve') {
          if (!work) return deny('not the role of this ticket'); if (!TK_OUTCOMES.includes(a.outcome)) return bad('outcome'); if (tk.status === 'closed') return bad('closed');
          const note = tkClean(a.note, 1000) || null; const old = tk.status;
          Object.assign(tk, { status: 'resolved', resolution_outcome: a.outcome, resolution_note: note, resolved_by: u.id, resolved_by_name: who.name, resolved_at: now });
          ev(tk, 'event', who.name + ' حوّل التذكرة إلى «تم الحل» — ' + a.outcome + (note ? ' · ' + note : ''), old, 'resolved');
        } else if (act === 'close') {
          if (!closer) return deny('not the opener of this ticket');
          if (tk.status !== 'closed') { const old = tk.status; Object.assign(tk, { status: 'closed', closed_by: u.id, closed_by_name: who.name, closed_at: now }); ev(tk, 'event', who.name + ' قفل التذكرة نهائيًا', old, 'closed'); }
        } else if (act === 'reopen') {
          const r = tkClean(a.reason, 1000); if (!r) return bad('reason'); if (!closer) return deny('not the opener of this ticket'); if (!['resolved', 'closed'].includes(tk.status)) return bad('status');
          const old = tk.status; tk.reopen_count += 1;
          Object.assign(tk, { status: 'open', closed_by: null, closed_by_name: null, closed_at: null, resolution_outcome: null, resolution_note: null, resolved_by: null, resolved_by_name: null, resolved_at: null });
          ev(tk, 'event', who.name + ' أُعيد فتحه (×' + tk.reopen_count + ') — السبب: ' + r + ' · رجع لدور «' + tk.assignee_role + '»', old, 'open');
        } else if (act === 'update') {
          if (!work && !closer) return deny('not the role or the opener of this ticket');
          if ('assigneeRole' in a) { if (!tkRoleOk(mock, a.assigneeRole)) return bad('assigneeRole'); if (a.assigneeRole !== tk.assignee_role) { const old = tk.assignee_role; tk.assignee_role = a.assigneeRole; ev(tk, 'event', who.name + ' غيّر المسؤول من «' + old + '» إلى «' + a.assigneeRole + '»', old, a.assigneeRole); } }
          if ('priority' in a) { if (!TK_PRIO[a.priority]) return bad('priority'); if (a.priority !== tk.priority) { const old = tk.priority; tk.priority = a.priority; ev(tk, 'event', who.name + ' غيّر الأولوية من «' + TK_PRIO[old] + '» إلى «' + TK_PRIO[a.priority] + '»', old, a.priority); } }
          if ('followUp' in a) { const d = day(a.followUp); if (d === undefined) return bad('followUp'); if (d !== tk.follow_up) { const old = tk.follow_up; tk.follow_up = d; ev(tk, 'event', who.name + ' غيّر تاريخ المتابعة من «' + (old || '—') + '» إلى «' + (d || '—') + '»', old, d); } }
        } else if (act === 'reply') {
          const text = tkClean(a.text, 5000); if (!text) return bad('text'); if (tk.status === 'closed') return bad('closed');
          const files = filesOf(a.attachments); if (!files) return bad('attachments'); ev(tk, 'message', text, null, null, files);
        } else return bad('action');
        return json(200, null);
      }
      if (method === 'POST' && path === '/rest/v1/rpc/inv_count_approve') {
        if (hasPerm(u, 'inventory.approve') !== 'F') return json(403, { code: '42501', details: null, hint: null, message: 'inventory.approve is needed' });
        const b = body(); const c = mock.inv.inv_counts.find((x) => x.id === Number(b.p_id)); if (!c || c.status !== 'open') return json(400, { code: '22023', details: null, hint: null, message: 'not an open count' });
        let n = 0; const now = new Date().toISOString();
        for (const l of mock.inv.inv_count_lines.filter((x) => x.count_id === c.id && x.counted != null)) { const d = l.counted - onHand(l.lot_id); if (d) { n += 1; mock.inv.inv_moves.push({ id: mock.inv.inv_moves.reduce((k, m) => Math.max(k, m.id), 0) + 1, lot_id: l.lot_id, type: 'adjust', qty: d, label: 'تسوية جرد', reason: 'جرد', ref: 'CNT-' + c.id, note: l.note, by: u.id, at: now }); } }
        Object.assign(c, { status: 'approved', approved_by: u.id, approved_at: now }); mock.invWrites.push({ table: 'inv_counts', op: 'approve', id: c.id, adjusted: n });
        return json(200, n);
      }
      const csT = /^\/rest\/v1\/(cs_customers|cs_customer_notes|cs_rating_overrides|cs_team_ratings|cs_conversations|cs_messages|cs_segments|cs_campaigns|cs_channels|cs_contacts|cs_campaign_recipients|cs_posts|cs_templates|cs_quick_replies|cs_auto_rules|cs_auto_runs)$/.exec(path);
      if (csT) {
        if (mock.csDown) return json(503, { message: 'mock: cs down' });
        const t = csT[1]; const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        const view = hasPerm(u, 'cs.view'); const reply = hasPerm(u, 'cs.reply') === 'F'; const manage = hasPerm(u, 'cs.manage') === 'F';
        const STORE = { cs_customers: 'customers', cs_customer_notes: 'notes', cs_rating_overrides: 'overrides', cs_team_ratings: 'teamRatings', cs_conversations: 'conversations', cs_messages: 'messages', cs_segments: 'segments', cs_campaigns: 'campaigns', cs_channels: 'channels', cs_contacts: 'contacts', cs_campaign_recipients: 'recipients', cs_posts: 'posts', cs_templates: 'templates', cs_quick_replies: 'quick', cs_auto_rules: 'rules', cs_auto_runs: 'autoRuns' };
        const rows = mock.cs[STORE[t]] || (mock.cs[STORE[t]] = []);
        const now = new Date().toISOString(); const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
        const convVisible = (id) => view === 'F' || (view === 'P' && mock.cs.conversations.some((v) => v.id === id && v.assignee === u.id));
        const visible = (r) => (view === 'N' ? false : t === 'cs_conversations' ? convVisible(r.id) : t === 'cs_messages' ? convVisible(r.conversation_id) : true);
        // the horizontal filters the adapter sends
        const filters = [...url.searchParams].filter(([k]) => !NOT_FILTERS.has(k));
        const one = ([k, v]) => {
          if (k === 'or') { const m = /^\(status\.neq\.([^,]+),updated_at\.gte\.(.+)\)$/.exec(v); if (!m) return null; const T = Date.parse(m[2]); return (r) => r.status !== m[1] || (r.updated_at && Date.parse(r.updated_at) >= T); }
          if (v.startsWith('eq.')) return (r) => String(r[k]) === v.slice(3);
          if (/^in\.\(.*\)$/.test(v)) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1')); return (r) => set.includes(String(r[k])); }
          return null;
        };
        const fns = filters.map(one); if (fns.some((f) => !f)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + t + ': ' + filters.map((f) => f.join('=')).join('&'));
        const match = (r) => fns.every((f) => f(r));
        const NO_READ = { cs_customers: ['phone'], cs_campaigns: ['test_phone'], cs_campaign_recipients: ['phone'] }; // the columns never granted to a member
        const strip = (r) => { const o = { ...r }; (NO_READ[t] || []).forEach((k) => { delete o[k]; }); if (t === 'cs_channels') delete o.meta; return o; };
        const asked = (url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
        if (!asked.includes('*') && asked.some((c) => (NO_READ[t] || []).includes(c))) return refuse(401, '42501', 'permission denied for table ' + t);
        const pick = (r) => (asked.includes('*') ? strip(r) : Object.fromEntries(asked.map((c) => [c, r[c] === undefined ? null : r[c]])));
        if (method === 'GET') { const out = pageOf(rows.filter(visible).filter(match), url.searchParams).map(pick); return json(200, single ? out[0] || null : out); }
        if (['cs_channels', 'cs_contacts', 'cs_campaign_recipients', 'cs_auto_runs'].includes(t)) return refuse(401, '42501', 'permission denied for table ' + t);
        const AUTO_T = ['cs_templates', 'cs_quick_replies', 'cs_auto_rules']; // 0058: cs.manage writes; used / runs are the server's
        const b = body(); const rowIn = Array.isArray(b) ? b[0] : b;
        const deny = () => refuse(401, '42501', 'new row violates row-level security policy for table "' + t + '"');
        const returning = (list) => { const prefer = hd.prefer || ''; const out = list.filter(visible).map(pick); return /return=representation/.test(prefer) || url.searchParams.has('select') ? json(method === 'POST' ? 201 : 200, single ? out[0] || null : out) : empty(204); };
        if (method === 'POST') {
          csSeq += 1; const uid = () => (t === 'cs_customers' || t === 'cs_conversations' || t === 'cs_segments' || t === 'cs_campaigns' ? 'c' + t.slice(3, 4) + '000000-0000-4000-8000-' + String(csSeq).padStart(12, '0') : csSeq);
          if (t === 'cs_customers') {
            if (!manage) return deny();
            if (!['manual', 'import'].includes(rowIn.created_from || 'manual')) return refuse(403, '42501', 'a member adds a customer as manual or import');
            if (rowIn.phone != null && !/^\d{6,15}$/.test(rowIn.phone)) return refuse(400, '23514', 'cs_customers_phone_check');
            if (rowIn.phone != null && rows.some((r) => r.phone === rowIn.phone)) return refuse(409, '23505', 'duplicate key value violates unique constraint "cs_customers_phone_key"');
            if (!String(rowIn.name || '').trim()) return refuse(400, '23514', 'cs_customers_name_check');
            const rec = { id: uid(), phone: rowIn.phone ?? null, name: rowIn.name, ig: rowIn.ig ?? null, city: rowIn.city ?? null, province: rowIn.province ?? null, address: rowIn.address ?? null, address2: rowIn.address2 ?? null, mood: rowIn.mood ?? null, tags: rowIn.tags ?? [], consent: rowIn.consent ?? true, auto_consent: rowIn.auto_consent ?? true, source: rowIn.source ?? null, created_from: rowIn.created_from || 'manual', blocked_at: null, blocked_by: null, merged_into: null, created_by: u.id, created_at: now, updated_at: null };
            rows.push(rec); const { phone, ...logged } = rowIn; mock.csWrites.push({ table: t, op: 'insert', ...logged }); return returning([rec]);
          }
          if (t === 'cs_conversations') {
            if (!reply) return deny();
            if (rowIn.external_id != null || rowIn.seg === 'comments' || rowIn.last_in_at != null) return refuse(403, '42501', 'a member opens a plain conversation: no channel thread, no comment');
            if (!['customers', 'vendors'].includes(rowIn.seg) || (rowIn.seg === 'vendors' ? !rowIn.vendor_id || rowIn.customer_id : rowIn.vendor_id)) return refuse(400, '23514', 'cs_conversations_party');
            const rec = { id: uid(), seg: rowIn.seg, platform: rowIn.platform || 'whatsapp', channel: rowIn.channel || 'wa1', customer_id: rowIn.customer_id ?? null, vendor_id: rowIn.vendor_id ?? null, handle: rowIn.handle ?? null, external_id: null, status: rowIn.status || 'جديدة', assignee: rowIn.assignee ?? null, outcome: rowIn.outcome ?? null, tags: rowIn.tags ?? [], last_in_at: null, last_out_at: null, waiting_since: null, unread: 0, snoozed_until: rowIn.snoozed_until ?? null, closed_at: null, closed_by: null, created_by: u.id, created_at: now, updated_at: null };
            rows.push(rec); mock.csWrites.push({ table: t, op: 'insert', ...rowIn }); return returning([rec]);
          }
          if (t === 'cs_messages') {
            if (!reply || !convVisible(rowIn.conversation_id)) return deny();
            if (!['note', 'event', 'out'].includes(rowIn.kind)) return refuse(403, '42501', 'incoming and automatic messages are written by the server');
            if (!String(rowIn.text || '').trim() || String(rowIn.text).length > 4000) return refuse(400, '23514', 'cs_messages_text_check');
            const rec = { id: 'd1000000-0000-4000-8000-' + String(csSeq).padStart(12, '0'), conversation_id: rowIn.conversation_id, kind: rowIn.kind, text: rowIn.text, author: u.id, external_id: null, delivery: rowIn.kind === 'out' ? 'queued' : null, meta: rowIn.meta ?? {}, created_at: now };
            rows.push(rec); const v = mock.cs.conversations.find((x) => x.id === rec.conversation_id); if (v) { v.updated_at = now; if (rec.kind === 'out') { v.last_out_at = now; v.waiting_since = null; } }
            mock.csWrites.push({ table: t, op: 'insert', conversation_id: rec.conversation_id, kind: rec.kind, meta: rec.meta }); return returning([rec]);
          }
          if (t === 'cs_customer_notes' || t === 'cs_rating_overrides' || t === 'cs_team_ratings') {
            if (!reply) return deny();
            if (t === 'cs_rating_overrides' && !(rowIn.stars >= 1 && rowIn.stars <= 5 && String(rowIn.reason || '').trim())) return refuse(400, '23514', 'cs_rating_overrides check');
            if (t === 'cs_team_ratings' && !(rowIn.sat >= 1 && rowIn.sat <= 5 && rowIn.manners >= 1 && rowIn.manners <= 5)) return refuse(400, '23514', 'cs_team_ratings check');
            const rec = { id: csSeq, ...rowIn, ...(t === 'cs_customer_notes' ? { author: u.id } : { by_user: u.id }), at: now };
            rows.push(rec); const { text, note, ...logged } = rowIn; mock.csWrites.push({ table: t, op: 'insert', ...logged }); return returning([rec]);
          }
          if (AUTO_T.includes(t)) {
            if (!manage) return deny();
            if ('used' in rowIn || 'runs' in rowIn || 'last_run_at' in rowIn) return refuse(401, '42501', 'permission denied for table ' + t);
            if (t === 'cs_templates' && rowIn.quick_key && rows.some((r) => r.quick_key === rowIn.quick_key)) return refuse(409, '23505', 'duplicate key value violates unique constraint "cs_templates_quick_key_idx"');
            if (t === 'cs_quick_replies' && rows.some((r) => r.key === rowIn.key)) return refuse(409, '23505', 'duplicate key value violates unique constraint "cs_quick_replies_key_key"');
            if (t === 'cs_auto_rules' && rowIn.action === 'send' && !rowIn.template_id && rowIn.event !== 'afterhours') return refuse(400, '23514', 'cs_auto_rules_action_target');
            const defaults = t === 'cs_templates' ? { lib: 'customers', cat: 'متابعة', tone: 'brand', trig_kind: 'manual', trig_on: [], trig_when: 'فورًا', channels: 'كل القنوات', quick_key: null, wa_template: null, wa_vars: [], used: 0, active: true }
              : t === 'cs_quick_replies' ? {} : { grp: null, event_to: null, conds: [], action: 'send', template_id: null, role_id: null, tag: null, delay_min: 0, once: true, ticket_if_silent: false, enabled: false, runs: 0, last_run_at: null };
            const rec = Object.assign(defaults, rowIn, { id: 'c' + t.slice(3, 4) + '000000-0000-4000-8000-' + String(csSeq).padStart(12, '0'), created_by: u.id, created_at: now, updated_by: u.id, updated_at: now });
            rows.push(rec); const { body: _b, text: _t, ...logged } = rowIn; mock.csWrites.push({ table: t, op: 'insert', ...logged }); return returning([rec]);
          }
          if (t === 'cs_segments' || t === 'cs_campaigns') {
            if (!manage) return deny();
            if (t === 'cs_segments' && rows.some((r) => r.name.trim().toLowerCase() === String(rowIn.name || '').trim().toLowerCase())) return refuse(409, '23505', 'duplicate key value violates unique constraint "cs_segments_name_idx"');
            if (t === 'cs_campaigns' && !['مسودة', 'مجدولة'].includes(rowIn.status || 'مسودة')) return refuse(403, '42501', 'a member saves a draft or a schedule');
            const rec = Object.assign(t === 'cs_segments' ? { min_total: null, min_orders: null, moods: [], last_kind: null, last_from: null, last_to: null, ranges: {}, include_unrated: false, add_ids: [], remove_ids: [] } : { segment_id: null, channel: 'wa1', body: null, image_path: null, discount_code: null, scheduled_at: null, cap_per_day: 300, min_delay_s: 20, test_phone: null, status: 'مسودة', size: 0 }, rowIn, { id: uid(), stats: {}, created_by: u.id, created_at: now, updated_at: null });
            if (t === 'cs_segments') delete rec.stats;
            rows.push(rec); const { test_phone, ...logged } = rowIn; mock.csWrites.push({ table: t, op: 'insert', ...logged }); return returning([rec]);
          }
        }
        if (method === 'PATCH') {
          const targets = rows.filter(visible).filter(match);
          const LIGHT = ['mood', 'tags']; const CONV_OK = ['status', 'assignee', 'tags', 'outcome', 'snoozed_until', 'unread'];
          const may = (r) => (t === 'cs_customers' ? (reply || manage) : t === 'cs_conversations' ? reply : manage);
          const list = targets.filter(may); if (!list.length) return returning([]);
          for (const r of list) {
            if (t === 'cs_customers') {
              if (['phone', 'created_from', 'created_by', 'created_at', 'merged_into'].some((k) => k in b)) return refuse(401, '42501', 'permission denied for table cs_customers');
              if (Object.keys(b).some((k) => !LIGHT.includes(k)) && !manage) return refuse(403, '42501', 'cs.manage = F is required to edit a customer (cs.reply changes mood and tags only)');
              if ('blocked_at' in b) b.blocked_by = b.blocked_at ? u.id : null;
            }
            if (t === 'cs_conversations') {
              if (Object.keys(b).some((k) => !CONV_OK.includes(k))) return refuse(403, '42501', 'only the status, assignee, tags, outcome, snooze and read state of a conversation can be changed here');
              if (b.status === 'اتحلت' && r.status !== 'اتحلت') { b.closed_at = now; b.closed_by = u.id; } else if (b.status && b.status !== 'اتحلت') { b.closed_at = null; b.closed_by = null; }
            }
            if (AUTO_T.includes(t) && ('used' in b || 'runs' in b || 'last_run_at' in b || 'created_by' in b)) return refuse(401, '42501', 'permission denied for table ' + t);
            if (t === 'cs_campaigns') { if (['شغالة', 'خلصت'].includes(r.status) && ['status', 'body', 'segment_id'].some((k) => k in b && b[k] !== r[k])) return refuse(403, '42501', 'a running or finished campaign is not edited'); if (b.status && !['مسودة', 'مجدولة', 'متوقفة'].includes(b.status)) return refuse(403, '42501', 'a member sets draft, scheduled or paused'); delete b.stats; }
            Object.assign(r, b, { updated_at: now }); const { phone, test_phone, ...logged } = b; mock.csWrites.push({ table: t, op: 'update', id: r.id, ...logged });
          }
          return returning(list);
        }
        if (method === 'DELETE') {
          if (!['cs_segments', 'cs_campaigns', 'cs_templates', 'cs_quick_replies', 'cs_auto_rules'].includes(t)) return refuse(401, '42501', 'permission denied for table ' + t);
          if (t === 'cs_templates' && manage) { const used = rows.filter(visible).filter(match).find((r) => mock.cs.rules.some((x) => x.template_id === r.id)); if (used) return refuse(409, '23503', 'update or delete on table "cs_templates" violates foreign key constraint "cs_auto_rules_template_id_fkey"'); }
          const list = rows.filter(visible).filter(match).filter(() => manage).filter((r) => t !== 'cs_campaigns' || r.status === 'مسودة');
          list.forEach((r) => { rows.splice(rows.indexOf(r), 1); mock.csWrites.push({ table: t, op: 'delete', id: r.id }); if (t === 'cs_segments') mock.cs.campaigns.forEach((k) => { if (k.segment_id === r.id) k.segment_id = null; }); });
          return returning(list);
        }
      }
      // cs_customers_list (0034): every customer not merged with the figures from the seeded orders of the same normalised phone
      // (deleted orders left out), the chat figures, the ratings (customer_ratings + cs_team_ratings), the latest override, the
      // last five orders; the phone masked without sensitive.customer_phone; the orders' figures only with orders.view; cs.view N → 42501
      if (method === 'POST' && path === '/rest/v1/rpc/cs_customers_list') {
        if (mock.csDown) return json(503, { message: 'mock: cs down' });
        if (hasPerm(u, 'cs.view') === 'N') return json(403, { code: '42501', details: null, hint: null, message: 'cs.view is needed' });
        const full = isAdmin(u) || hasPerm(u, 'sensitive.customer_phone') === 'F'; const ov = hasPerm(u, 'orders.view') !== 'N';
        const OPEN = ['جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن']; const DEAD = ['ملغي', 'فشل', 'استرجاع']; const r1 = (xs) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length * 10) / 10 : null);
        const out = mock.cs.customers.filter((c) => !c.merged_into).map((c) => {
          const os = c.phone && ov ? mock.orders.filter((o) => !o.deleted_at && normPhone(o.customer_phone) === c.phone).sort((a, b) => (a.placed_at < b.placed_at ? 1 : -1)) : [];
          const live = os.filter((o) => !DEAD.includes(o.status)); const convs = mock.cs.conversations.filter((v) => v.customer_id === c.id);
          const rates = (ov ? mock.ratings.filter((x) => os.some((o) => Number(o.id) === Number(x.order_id))) : []).concat(mock.cs.teamRatings.filter((x) => x.customer_id === c.id));
          const o1 = mock.cs.overrides.filter((x) => x.customer_id === c.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
          const lastConv = convs.map((v) => v.updated_at || v.created_at).sort().pop() || null; const lastOrder = os[0] ? os[0].placed_at : null;
          return { id: c.id, phone: c.phone == null ? null : full ? c.phone : maskPhone(c.phone), name: c.name, ig: c.ig, city: c.city, province: c.province, address: c.address, address2: c.address2, mood: c.mood, tags: c.tags, consent: c.consent, auto_consent: c.auto_consent, source: c.source, created_from: c.created_from, blocked_at: c.blocked_at, merged_into: c.merged_into, created_at: c.created_at,
            orders: live.length, total: live.reduce((a, o) => a + Number(o.total || 0), 0), last_order_at: lastOrder, refused: os.filter((o) => o.status === 'فشل').length, returned: os.filter((o) => o.status === 'استرجاع').length,
            open_complaints: convs.filter((v) => v.status !== 'اتحلت' && (v.tags || []).includes('شكوى')).length, late_open: os.filter((o) => OPEN.includes(o.status) && Date.parse(o.placed_at) < Date.now() - 11 * 864e5).length,
            conversations: convs.length, last_active_at: [lastConv, lastOrder, c.created_at].filter(Boolean).sort().pop(), rating_sat: r1(rates.map((x) => Number(x.sat))), rating_manners: r1(rates.map((x) => Number(x.manners))), rating_count: rates.length,
            override_stars: o1 ? o1.stars : null, override_reason: o1 ? o1.reason : null, order_list: os.slice(0, 5).map((o) => ({ id: o.id, status: o.status, total: Number(o.total || 0), placed_at: o.placed_at })) };
        });
        return json(200, out);
      }
      // cs_campaign_schedule (0042, decision 23): cs.manage; a draft / paused campaign; the queued recipients = the picked customers who
      // agreed, are not blocked / merged and have a phone; the campaign «مجدولة» at p_at with its size
      if (method === 'POST' && path === '/rest/v1/rpc/cs_campaign_schedule') {
        const b = body(); const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (hasPerm(u, 'cs.manage') !== 'F') return refuse(403, '42501', 'not allowed');
        const k = mock.cs.campaigns.find((x) => x.id === b.p_id); if (!k) return refuse(400, 'P0002', 'no campaign');
        if (!['مسودة', 'متوقفة'].includes(k.status)) return refuse(400, '22023', 'campaign is ' + k.status);
        const rec = mock.cs.recipients || (mock.cs.recipients = []);
        for (let i = rec.length - 1; i >= 0; i--) if (rec[i].campaign_id === k.id && rec[i].status === 'queued') rec.splice(i, 1);
        (b.p_customers || []).forEach((id) => { const c = mock.cs.customers.find((x) => x.id === id); if (c && c.phone && c.consent !== false && !c.blocked_at && !c.merged_into) rec.push({ id: rec.length + 1, campaign_id: k.id, customer_id: c.id, phone: c.phone, status: 'queued' }); });
        const n = rec.filter((r) => r.campaign_id === k.id && r.status === 'queued').length; if (!n) return refuse(400, '22023', 'empty audience');
        Object.assign(k, { status: 'مجدولة', scheduled_at: b.p_at || new Date().toISOString(), size: n, updated_at: new Date().toISOString() });
        mock.csWrites.push({ table: 'cs_campaigns', op: 'schedule', id: k.id, size: n });
        return json(200, n);
      }
      // cs_merge_customers (0034): cs.manage; two distinct unmerged customers; the other's conversations / notes / ratings move, tags join, empties fill
      // cs_auto_settings (0058): the defaults over settings «cs».auto; cs.view N → 42501
      if (method === 'POST' && path === '/rest/v1/rpc/cs_auto_settings') {
        if (hasPerm(u, 'cs.view') === 'N') return json(403, { code: '42501', details: null, hint: null, message: 'cs.view is needed' });
        const row = mock.settings.find((x) => x.section === 'cs'); const auto = row && row.data && row.data.auto && typeof row.data.auto === 'object' ? row.data.auto : {};
        return json(200, Object.assign({ live: false, hours: { from: 9, to: 22 }, delayMin: 20, delayMax: 60, daily: { wa1: 250, wa2: 150 }, afterHoursText: 'شكرًا لرسالتك 🙏 مواعيد الرد من 9 ص لـ 10 م — هنرد عليك أول ما نفتح.', cart: { afterMin: 60 } }, auto));
      }
      // cs_link_contact (0064, phase 13 T3): cs.reply on a conversation the member sees → the customer, the contact row, an event line
      if (method === 'POST' && path === '/rest/v1/rpc/cs_link_contact') {
        const b = body(); const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (!(isAdmin(u) || hasPerm(u, 'cs.reply') === 'F')) return refuse(403, '42501', 'cs.reply = F is required to link a conversation to a customer');
        const view = isAdmin(u) ? 'F' : hasPerm(u, 'cs.view'); const v = mock.cs.conversations.find((x) => x.id === b.p_conversation && (view === 'F' || (view === 'P' && x.assignee === u.id)));
        if (!v) return refuse(400, 'P0002', 'conversation not found'); if (v.seg === 'vendors') return refuse(400, '22023', 'invalid: conversation');
        const cu = mock.cs.customers.find((x) => x.id === b.p_customer && !x.merged_into); if (!cu) return refuse(400, 'P0002', 'customer not found');
        if (v.customer_id !== cu.id) {
          const old = mock.cs.customers.find((x) => x.id === v.customer_id); v.customer_id = cu.id; v.updated_at = new Date().toISOString();
          if (v.external_id && v.seg === 'customers') { const ct = mock.cs.contacts.find((x) => x.platform === v.platform && x.external_id === v.external_id); if (ct) ct.customer_id = cu.id; else mock.cs.contacts.push({ id: mock.cs.contacts.length + 1, customer_id: cu.id, platform: v.platform, external_id: v.external_id, handle: v.handle || null, created_at: new Date().toISOString() }); }
          csSeq += 1; mock.cs.messages.push({ id: 'd1000000-0000-4000-8000-' + String(csSeq).padStart(12, '0'), conversation_id: v.id, kind: 'event', text: 'المحادثة اتربطت بالعميل «' + cu.name + '»' + (old ? ' (كانت على «' + old.name + '»)' : ''), author: u.id, external_id: null, delivery: null, meta: { link: cu.id }, created_at: new Date().toISOString() });
          mock.csWrites.push({ table: 'cs_conversations', op: 'link', id: v.id, customer_id: cu.id });
        }
        return json(200, cu.id);
      }
      if (method === 'POST' && path === '/rest/v1/rpc/cs_merge_customers') {
        const b = body(); const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (hasPerm(u, 'cs.manage') !== 'F') return refuse(403, '42501', 'cs.manage = F is required to merge customers');
        if (!b.p_keep || !b.p_other || b.p_keep === b.p_other) return refuse(400, '22023', 'two different customers are needed');
        const k = mock.cs.customers.find((c) => c.id === b.p_keep && !c.merged_into); const o = mock.cs.customers.find((c) => c.id === b.p_other && !c.merged_into);
        if (!k || !o) return refuse(400, 'P0002', 'customer not found');
        const now = new Date().toISOString();
        mock.cs.conversations.forEach((v) => { if (v.customer_id === o.id) v.customer_id = k.id; }); ['notes', 'overrides', 'teamRatings'].forEach((key) => mock.cs[key].forEach((r) => { if (r.customer_id === o.id) r.customer_id = k.id; }));
        ['ig', 'city', 'province', 'address', 'address2', 'source'].forEach((f) => { if (k[f] == null) k[f] = o[f]; }); k.tags = [...new Set([...(k.tags || []), ...(o.tags || [])])]; k.updated_at = now;
        o.merged_into = k.id; o.updated_at = now; mock.csWrites.push({ table: 'cs_customers', op: 'merge', keep: k.id, other: o.id });
        return json(200, k.id);
      }
      // 0019 (phase 4): the ledgers — read with accounts.view <> N (view P: no «المرتبات»), insert with accounts.add = F as oneself,
      // update one's own row with add F or any row with approve F (others: zero rows, like RLS); a voided row is final (42501); the
      // void is stamped here (voided_at / voided_by). The Dokan mirrors are read-only (42501 on a write). Filters: voided_at=is.null, id=eq.
      const accT = /^\/rest\/v1\/(acc_expenses|acc_vendor_moves|acc_account_moves|acc_list_items|dokan_balances|dokan_withdrawals|acc_vendor_settlements)$/.exec(path);
      if (accT) {
        if (mock.accountsDown) return json(503, { message: 'mock: accounts down' });
        const t = accT[1]; const rows = mock.acc[t]; const view = hasPerm(u, 'accounts.view');
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        const visible = (r) => view !== 'N' && (t !== 'acc_expenses' || r.category !== 'المرتبات' || view === 'F');
        const idEq = /^eq\.(\d+)$/.exec(url.searchParams.get('id') || '');
        if (method === 'GET') {
          let out = rows.filter(visible);
          if (url.searchParams.get('voided_at') === 'is.null') out = out.filter((r) => !r.voided_at);
          if (idEq) out = out.filter((r) => String(r.id) === idEq[1]);
          return json(200, out.map((r) => ({ ...r })));
        }
        if (t.startsWith('dokan_') || t === 'acc_vendor_settlements') return refuse(403, '42501', 'permission denied for table ' + t);
        const b = body(); const now = new Date().toISOString();
        if (t === 'acc_list_items') {
          if (method !== 'POST') return refuse(403, '42501', 'permission denied for table ' + t);
          const row = Array.isArray(b) ? b[0] : b;
          if (hasPerm(u, 'accounts.add') !== 'F') return refuse(403, '42501', 'new row violates row-level security policy for table "' + t + '"');
          if (!['subs', 'ads'].includes(row.list) || !String(row.name || '').trim()) return refuse(400, '23514', 'acc_list_items check');
          if (rows.some((x) => x.list === row.list && x.name.trim().toLowerCase() === String(row.name).trim().toLowerCase())) return refuse(409, '23505', 'duplicate key value violates unique constraint "acc_list_items_name_key"');
          accSeq += 1; const rec = { id: accSeq, list: row.list, name: String(row.name), created_by: u.id, created_at: now };
          rows.push(rec); mock.accWrites.push({ table: t, op: 'insert', ...row });
          return json(201, [{ ...rec }]);
        }
        if (method === 'POST') {
          const row = Array.isArray(b) ? b[0] : b;
          if (hasPerm(u, 'accounts.add') !== 'F' || (t === 'acc_expenses' && row.category === 'المرتبات' && view !== 'F')) return refuse(403, '42501', 'new row violates row-level security policy for table "' + t + '"');
          if (!(Number(row.amount) > 0)) return refuse(400, '23514', 'new row for relation "' + t + '" violates check constraint');
          if (t === 'acc_expenses' && row.category === 'الاشتراكات' && row.direction !== 'deposit' && !(row.sub_name && row.sub_ends && (row.sub_alerts || []).length)) return refuse(400, '23514', 'acc_expenses_subscription');
          if (t === 'acc_expenses' && row.reason != null && !['استرجاع مبلغ مدفوع', 'إلغاء اشتراك', 'خصم من مورد', 'تصحيح تسجيل غلط', 'أخرى'].includes(row.reason)) return refuse(400, '23514', 'acc_expenses_reason_check');
          if (t === 'acc_vendor_moves' && row.direction === 'deposit' && row.kind !== 'أخرى') return refuse(400, '23514', 'new row for relation "acc_vendor_moves" violates check constraint "acc_vendor_moves_deposit_correction"');
          accSeq += 1; const rec = { ...row, id: accSeq, amount: Number(row.amount), created_by: u.id, created_at: now, updated_by: null, updated_at: null, voided_by: null, voided_at: null };
          if (t === 'acc_vendor_moves') Object.assign(rec, { settled_by: null, settled_at: null }); // the guard: a member never settles a move
          rows.push(rec); mock.accWrites.push({ table: t, op: 'insert', ...row });
          return json(201, [{ ...rec }]);
        }
        if (method === 'PATCH') {
          const r = idEq ? rows.find((x) => String(x.id) === idEq[1]) : null;
          const may = r && visible(r) && ((r.created_by === u.id && hasPerm(u, 'accounts.add') === 'F') || hasPerm(u, 'accounts.approve') === 'F');
          if (!may) return json(200, []);
          if (r.voided_at) return refuse(403, '42501', 'a voided row is final');
          if (t === 'acc_vendor_moves' && r.settled_by != null) return refuse(403, '42501', 'a settled move is final');
          const { created_by, created_at, voided_by, settled_by, settled_at, ...patch } = b;
          Object.assign(r, patch, { updated_at: now, updated_by: u.id }); if (patch.voided_at) Object.assign(r, { voided_at: now, voided_by: u.id });
          mock.accWrites.push({ table: t, op: 'update', id: r.id, ...patch });
          return json(200, [{ ...r }]);
        }
      }
      // accounts_sales (0019): our orders placed in the range (Cairo date — the mock uses the UTC date), per maker and group + one total row per group
      if (method === 'POST' && path === '/rest/v1/rpc/accounts_sales') {
        const b = body(); if (hasPerm(u, 'accounts.view') === 'N') return json(403, { code: '42501', details: null, hint: null, message: 'accounts.view is needed' });
        if (!b.p_from || !b.p_to || b.p_to < b.p_from) return json(400, { code: '22023', details: null, hint: null, message: 'bad range' });
        const grp = (st) => (st === 'مكتمل' ? 'completed' : ['جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن'].includes(st) ? 'in_progress' : ['ملغي', 'استرجاع', 'فشل'].includes(st) ? 'cancelled' : null);
        const lines = [];
        for (const o of mock.orders) {
          const d = String(o.placed_at || '').slice(0, 10); const g = grp(o.status); if (!g || d < b.p_from || d > b.p_to) continue;
          for (const i of mock.orderItems.filter((x) => Number(x.order_id) === Number(o.id) && !x.removed)) {
            const rates = isAdmin(u) || hasPerm(u, 'sensitive.commission') === 'F'; // the agreement stays with its key (security review)
            const rate = i.commission_rate != null ? Number(i.commission_rate) : !rates ? 0 : Number((mock.vendorRates.filter((r) => r.vendor_id === i.vendor_id && r.since <= d).sort((a, c) => (a.since < c.since ? 1 : -1))[0] || {}).rate || 0);
            lines.push({ v: i.vendor_id || null, g, o: o.id, total: Number(i.total) || 0, share: (Number(i.total) || 0) * rate / 100 + (Number(i.commission_fee) || 0) });
          }
        }
        const out = []; const key = (l) => l.v + '|' + l.g; const groups = new Map();
        for (const l of lines) { if (!groups.has(key(l))) groups.set(key(l), []); groups.get(key(l)).push(l); }
        const row = (v, g, ls, total) => ({ vendor_id: v, grp: g, orders: new Set(ls.map((x) => x.o)).size, sales: Math.round(ls.reduce((t, x) => t + x.total, 0) * 100) / 100, share: Math.round(ls.reduce((t, x) => t + x.share, 0) * 100) / 100, is_total: total });
        for (const ls of groups.values()) out.push(row(ls[0].v, ls[0].g, ls, false));
        for (const g of ['completed', 'in_progress', 'cancelled']) { const ls = lines.filter((x) => x.g === g); if (ls.length) out.push(row(null, g, ls, true)); }
        return json(200, out);
      }
      // phase 5.3 (0024): ai_runs — select only (the server writes it): the member's own rows, the admin's all; named columns;
      // eq. filters and gte. on created_at (IBAI.monthSpend)
      if (path === '/rest/v1/ai_runs') {
        if (method !== 'GET') return json(403, { code: '42501', details: null, hint: null, message: 'permission denied for table ai_runs' });
        const COLS = ['id', 'created_at', 'created_by', 'action', 'source', 'label', 'product_id', 'batch_id', 'item_index', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'credits', 'status', 'error', 'output']; // credits: 0025
        const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
        const badCol = cols.find((x) => x !== '*' && !COLS.includes(x)); if (badCol) return json(400, { code: '42703', details: null, hint: null, message: `column ai_runs.${badCol} does not exist` });
        const eqs = [...url.searchParams.entries()].filter(([k, v]) => COLS.includes(k) && v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
        const gte = url.searchParams.get('created_at'); const since = gte && gte.startsWith('gte.') ? Date.parse(gte.slice(4)) : null;
        const lim = Number(url.searchParams.get('limit')) || 1000;
        const rows = mock.aiRuns.filter((x) => (isAdmin(u) || x.created_by === u.id) && eqs.every(([k, v]) => String(x[k]) === v) && (since === null || Date.parse(x.created_at) >= since)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, lim);
        return json(200, rows.map((x) => (cols.includes('*') ? { ...x } : Object.fromEntries(cols.map((c) => [c, x[c] === undefined ? null : x[c]])))));
      }
      // phase 5.4 decision 8 (0026): image_imports — select only (a Claude session queues the rows as postgres, the server marks
      // them): the member's own rows, the admin's all; named columns; the in.(…) filter on status; newest first
      // decision 12 (0030): shot_prompts — every member who sees products reads; the admin writes (the mock: read only here, the sync action writes)
      if (path === '/rest/v1/shot_prompts') {
        if (method !== 'GET') return json(403, { code: '42501', details: null, hint: null, message: 'permission denied for table shot_prompts' });
        if (hasPerm(u, 'products.view') === 'N') return json(200, []);
        const COLS = ['id', 'category', 'shot', 'name', 'prompt', 'negative', 'model', 'aspect', 'resolution', 'source_node', 'updated_at', 'updated_by'];
        const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
        const badCol = cols.find((x) => x !== '*' && !COLS.includes(x)); if (badCol) return json(400, { code: '42703', details: null, hint: null, message: `column shot_prompts.${badCol} does not exist` });
        const f = readFilters(url.searchParams, 'shot_prompts'); if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'unexpected filter ' + f.bad });
        const rows = mock.shotPrompts.filter((x) => f.match(x)).sort((x, y) => x.category.localeCompare(y.category, 'ar') || x.shot - y.shot);
        return json(200, rows.map((x) => (cols.includes('*') ? { ...x } : Object.fromEntries(cols.map((c) => [c, x[c] === undefined ? null : x[c]])))));
      }
      if (path === '/rest/v1/image_imports') {
        if (method !== 'GET') return json(403, { code: '42501', details: null, hint: null, message: 'permission denied for table image_imports' });
        const COLS = ['id', 'created_at', 'created_by', 'source', 'folder', 'label', 'product_id', 'urls', 'refs', 'status', 'paths', 'error', 'run_id', 'done_at', 'target', 'items', 'brand_id', 'vendor_id', 'batch_type', 'batch_id']; // 0027: the studio target
        const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
        const badCol = cols.find((x) => x !== '*' && !COLS.includes(x)); if (badCol) return json(400, { code: '42703', details: null, hint: null, message: `column image_imports.${badCol} does not exist` });
        const f = readFilters(url.searchParams, 'image_imports'); if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'unexpected filter ' + f.bad });
        const lim = Number(url.searchParams.get('limit')) || 1000;
        const rows = mock.imageImports.filter((x) => (isAdmin(u) || x.created_by === u.id) && f.match(x)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, lim);
        return json(200, rows.map((x) => (cols.includes('*') ? { ...x } : Object.fromEntries(cols.map((c) => [c, x[c] === undefined ? null : x[c]])))));
      }
      // phase 5.4 decision 10 (b) (0028): image_shares — select only: the member's own rows, the admin's all; eq. batch_id
      if (path === '/rest/v1/image_shares') {
        if (method !== 'GET') return json(403, { code: '42501', details: null, hint: null, message: 'permission denied for table image_shares' });
        const COLS = ['id', 'created_at', 'created_by', 'batch_id', 'item_index', 'item_key', 'name', 'path', 'url', 'expires_at', 'status', 'creation_ref', 'error', 'sent_at'];
        const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
        const badCol = cols.find((x) => x !== '*' && !COLS.includes(x)); if (badCol) return json(400, { code: '42703', details: null, hint: null, message: `column image_shares.${badCol} does not exist` });
        const f = readFilters(url.searchParams, 'image_shares'); if (f.bad) return json(400, { code: 'PGRST100', details: null, hint: null, message: 'unexpected filter ' + f.bad });
        const rows = mock.imageShares.filter((x) => (isAdmin(u) || x.created_by === u.id) && f.match(x)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
        return json(200, rows.map((x) => (cols.includes('*') ? { ...x } : Object.fromEntries(cols.map((c) => [c, x[c] === undefined ? null : x[c]])))));
      }
      // ai_month_credits (0025): this Cairo month's image credits of the rows the member reads (RLS: own rows, the admin's all)
      if (method === 'POST' && path === '/rest/v1/rpc/ai_month_credits') {
        const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date());
        const inMonth = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(x.created_at)) === month;
        return json(200, mock.aiRuns.filter((x) => x.action === 'image' && (isAdmin(u) || x.created_by === u.id) && inMonth(x)).reduce((t, x) => t + (Number(x.credits) || 0), 0));
      }
      // ai_month_cost (0024): this Cairo month's cost of the rows the member reads (RLS: own rows, the admin's all)
      if (method === 'POST' && path === '/rest/v1/rpc/ai_month_cost') {
        const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date());
        const inMonth = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(x.created_at)) === month;
        return json(200, Math.round(mock.aiRuns.filter((x) => (isAdmin(u) || x.created_by === u.id) && inMonth(x)).reduce((t, x) => t + (Number(x.cost_usd) || 0), 0) * 1e6) / 1e6);
      }
      // settings (0002): read with settings.view <> N; team / integrations / security written with settings.team = F, every other
      // section (the AI settings «ai» of phase 5.3 decision 8) by the admin only; upsert on section
      if (path === '/rest/v1/settings' && ['GET', 'POST', 'PATCH'].includes(method)) {
        if (hasPerm(u, 'settings.view') === 'N') return method === 'GET' ? json(200, []) : json(401, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "settings"' });
        const eq = url.searchParams.get('section'); const want = eq && eq.startsWith('eq.') ? eq.slice(3) : null;
        const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
        const pick = (r) => { const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim()); return cols.includes('*') ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])); };
        if (method === 'GET') { const rows = mock.settings.filter((r) => want === null || r.section === want).map(pick); return single ? (rows.length ? json(200, rows[0]) : json(200, null)) : json(200, rows); }
        const may = (section) => (['team', 'integrations', 'security'].includes(section) ? hasPerm(u, 'settings.team') === 'F' : isAdmin(u));
        const rows = [].concat(body()); const merge = /resolution=merge-duplicates/.test(hd.prefer || '');
        if (method === 'PATCH') { const i = mock.settings.findIndex((r) => r.section === want); if (i < 0 || !may(want)) return json(401, { code: '42501', details: null, hint: null, message: 'permission denied' }); mock.settings[i] = { ...mock.settings[i], ...rows[0], updated_at: new Date().toISOString(), updated_by: u.id }; return empty(204); }
        if (rows.some((r) => !may(r.section))) return json(401, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "settings"' });
        if (!merge && rows.some((r) => mock.settings.some((x) => x.section === r.section))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "settings_pkey"' });
        for (const r of rows) { const i = mock.settings.findIndex((x) => x.section === r.section); const row = { section: r.section, data: r.data ?? {}, updated_at: new Date().toISOString(), updated_by: u.id }; if (i >= 0) mock.settings[i] = row; else mock.settings.push(row); }
        return json(201, []);
      }
      // phase 5.2 (0023): studio_batches (products.add = F: select / insert / update of the granted columns, no delete), sku_colors
      // (read products.view <> N, insert products.add = F; 23505 on a taken code / name), sku_serial + sku_serial_take
      const sb = /^\/rest\/v1\/(studio_batches|sku_colors|sku_serial)$/.exec(path);
      if (sb) {
        const t = sb[1]; const add = isAdmin(u) || hasPerm(u, 'products.add') === 'F'; const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
        const idEq = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        if (t === 'sku_serial') return json(200, hasPerm(u, 'products.view') === 'N' ? [] : [{ next: mock.skuSerial }]);
        if (t === 'sku_colors') {
          if (method === 'GET') return json(200, hasPerm(u, 'products.view') === 'N' ? [] : mock.skuColors.slice().sort((a, c) => a.name_en.localeCompare(c.name_en)));
          if (!add) return json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "sku_colors"' });
          const r = body(); if (mock.skuColors.some((c) => c.code === r.code || c.name_en.toLowerCase() === String(r.name_en).toLowerCase())) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "sku_colors_code_key"' });
          const row = { id: mock.skuColors.length + 100, name_en: r.name_en, name_ar: r.name_ar, code: r.code, hex: r.hex || null }; mock.skuColors.push(row);
          return json(201, single ? row : [row]);
        }
        if (!add) return method === 'GET' ? json(200, []) : json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "studio_batches"' });
        if (method === 'GET') { const rows = mock.studioBatches.filter((x) => (idEq ? x.id === idEq : !x.archived_at)); return json(200, single ? rows[0] || null : rows.map((x) => ({ ...x }))); }
        const b = body(); const GRANT = ['title', 'brand_id', 'vendor_id', 'type', 'state', 'step', 'archived_at'];
        if (Object.keys(b).some((k) => !GRANT.includes(k))) return json(403, { code: '42501', details: null, hint: null, message: 'permission denied for table studio_batches' });
        if (method === 'POST') { mock.studioSeq += 1; const row = { id: '0b6f2f5e-1d2c-4a8b-9e3f-' + String(mock.studioSeq).padStart(12, '0'), title: b.title, brand_id: b.brand_id || null, vendor_id: b.vendor_id || null, type: b.type || 'Simple', state: b.state || {}, step: b.step || 1, status: 'draft', result: null, updated_at: new Date().toISOString(), archived_at: null };
          mock.studioBatches.unshift(row); mock.studioWrites.push({ op: 'insert', id: row.id, step: row.step }); return json(201, single ? row : [row]); }
        if (method === 'PATCH') { const row = mock.studioBatches.find((x) => x.id === idEq); if (!row) return json(200, single ? null : []); Object.assign(row, b, { updated_at: new Date().toISOString() }); mock.studioWrites.push({ op: 'update', id: row.id, step: row.step, keys: Object.keys(b) }); return json(200, single ? { ...row } : [{ ...row }]); }
      }
      if (method === 'POST' && path === '/rest/v1/rpc/sku_serial_take') {
        const n = Number(body().n); if (!(isAdmin(u) || hasPerm(u, 'products.add') === 'F')) return json(403, { code: '42501', details: null, hint: null, message: 'products.add is needed' });
        if (!(n >= 1 && n <= 200)) return json(400, { code: '22023', details: null, hint: null, message: 'n is 1..200' });
        const first = mock.skuSerial; mock.skuSerial += n; mock.serialTakes.push(n); return json(200, first);
      }
      // products_report (0022, decision 20): the products page's reports tab — totals only, products.view <> N; an Arabic line counts under its English product
      if (method === 'POST' && path === '/rest/v1/rpc/products_report') {
        const b = body(); (mock.reportCalls = mock.reportCalls || []).push({ from: b.p_from, to: b.p_to });
        if (hasPerm(u, 'products.view') === 'N') return json(403, { code: '42501', details: null, hint: null, message: 'products.view is needed' });
        if (!b.p_from || !b.p_to || b.p_to < b.p_from) return json(400, { code: '22023', details: null, hint: null, message: 'bad range' });
        if (mock.reportFail) return json(500, { code: 'XX000', details: null, hint: null, message: 'boom' });
        const sold = mock.orders.filter((o) => { const d = String(o.placed_at || '').slice(0, 10); return d >= b.p_from && d <= b.p_to && !['ملغي', 'استرجاع', 'فشل'].includes(o.status); });
        const prod = (id) => mock.products.find((p) => Number(p.id) === Number(id));
        const lines = sold.flatMap((o) => mock.orderItems.filter((i) => Number(i.order_id) === Number(o.id) && !i.removed)).map((i) => {
          const p = i.product_id != null ? prod(i.product_id) : null; const en = p && p.lang === 'ar' && p.translation_ids ? Number(p.translation_ids.en) : null;
          return { ...i, key: en || (i.product_id != null ? Number(i.product_id) : null) }; });
        const groups = new Map();
        for (const l of lines) { const k = l.key != null ? String(l.key) : 'n:' + String(l.name).trim().toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
        const sum = (ls, f) => Math.round(ls.reduce((t, x) => t + (Number(x[f]) || 0), 0) * 100) / 100;
        const g = [...groups.values()].map((ls) => ({ key: ls[0].key, name: ls[0].name, skus: [...new Set(ls.map((x) => x.sku).filter(Boolean))], vendor_id: ls[0].vendor_id || null, qty: sum(ls, 'qty'), orders: new Set(ls.map((x) => x.order_id)).size, revenue: sum(ls, 'total') }))
          .sort((x, y) => y.qty - x.qty || y.revenue - x.revenue || String(x.name).localeCompare(String(y.name)));
        const cm = new Map();
        for (const l of lines) { const p = l.key != null ? prod(l.key) : null; for (const c of (p && p.category_ids) || []) { if (!cm.has(c)) cm.set(c, []); cm.get(c).push(l); } }
        const cats = [...cm].map(([id, ls]) => ({ id, sold: sum(ls, 'qty'), revenue: sum(ls, 'total'), orders: new Set(ls.map((x) => x.order_id)).size, products: new Set(ls.map((x) => x.key)).size })).sort((x, y) => y.sold - x.sold || y.revenue - x.revenue);
        return json(200, { orders: sold.length, qty: sum(lines, 'qty'), revenue: sum(lines, 'total'), distinct: g.length, top: g.slice(0, 20), cats });
      }
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
      // 0016 (plan 3.4): vendor_commission_set — the type, the default rate / flat and the hand-set categories at once; today, a same-day
      // change replacing the day's rows; recorded in vendorWrites as { table: 'vendor_commission', vendor_id, type, rate, flat, categories }
      // 0018 (phase 3.6): order_complete — the rating and «مكتمل» in one call; orders.status = F (else 42501, as the guard);
      // figures 1–5 and a note of 500 characters at most (else 22023); an order the caller cannot see → P0002. The status change
      // is recorded in patches like a PATCH, the rating in ratings.
      if (method === 'POST' && path === '/rest/v1/rpc/order_complete') {
        if (mock.ordersDown) return json(503, { message: 'mock: orders down' });
        const b = body(); const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        const ok = (n) => Number.isInteger(n) && n >= 1 && n <= 5; const note = typeof b.p_note === 'string' && b.p_note.trim() ? b.p_note.trim() : null;
        if (!ok(b.p_sat) || !ok(b.p_manners) || (note && note.length > 500)) return refuse(400, '22023', 'the rating figures are 1 to 5');
        const o = hasPerm(u, 'orders.view') === 'N' ? null : mock.orders.find((x) => Number(x.id) === Number(b.p_order));
        if (!o) return refuse(400, 'P0002', 'order not found');
        if (hasPerm(u, 'orders.status') !== 'F') return refuse(403, '42501', 'orders.status = F is required to change an order status or confirmation');
        Object.assign(o, { status: 'مكتمل', updated_at: new Date().toISOString() }); mock.patches.push({ table: 'orders', id: o.id, status: 'مكتمل' });
        mock.ratings.push({ order_id: o.id, sat: b.p_sat, manners: b.p_manners, note, by_user: u.id });
        return json(200, mock.ratings.length);
      }
      // 0033 (phase 5.5 decision 10): order_delete — a cancelled order marked deleted with a reason; orders.view N / unknown /
      // already deleted → P0002; orders.status <> F → 42501; not «ملغي» or an empty / long reason → 22023. Recorded in deletes;
      // orders_v leaves the order out afterwards (the row stays in mock.orders with deleted_at).
      if (method === 'POST' && path === '/rest/v1/rpc/order_delete') {
        if (mock.ordersDown) return json(503, { message: 'mock: orders down' });
        const b = body(); const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (hasPerm(u, 'orders.view') === 'N') return refuse(400, 'P0002', 'order not found');
        if (hasPerm(u, 'orders.status') !== 'F') return refuse(403, '42501', 'orders.status = F is required to delete a cancelled order');
        const reason = typeof b.p_reason === 'string' ? b.p_reason.trim() : '';
        if (!reason || reason.length > 120) return refuse(400, '22023', 'a delete reason of 1 to 120 characters is required');
        const o = mock.orders.find((x) => Number(x.id) === Number(b.p_order) && !x.deleted_at);
        if (!o) return refuse(400, 'P0002', 'order not found');
        if (o.status !== 'ملغي') return refuse(400, '22023', 'only a cancelled order can be deleted');
        Object.assign(o, { deleted_at: new Date().toISOString(), deleted_by: u.id, delete_reason: reason });
        mock.deletes.push({ order_id: o.id, reason, by: u.email });
        return json(200, o.id);
      }
      // 0080 (the owner, 11 Nov — B2): vendor_main_categories_set — the admin or vendors.edit = F; a newly picked id is a main category of
      // the site (no parent), 20 at most, a repeat kept once; writes main_categories and their names in category (none = null)
      if (method === 'POST' && path === '/rest/v1/rpc/vendor_main_categories_set') {
        const b = body(); const vid = String(b.p_vendor || '').toLowerCase();
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (!(isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F')) return refuse(403, '42501', "vendors.edit = F is required to change a maker's main categories");
        const v = mock.vendors.find((x) => x.id === vid); if (!v) return refuse(400, 'P0002', 'maker not found');
        const ids = [...new Set((Array.isArray(b.p_ids) ? b.p_ids : []).map(Number).filter((x) => Number.isInteger(x)))]; const cur = Array.isArray(v.main_categories) ? v.main_categories : [];
        if (ids.length > 20 || ids.some((x) => !cur.includes(x) && !mock.wooCategories.some((c) => Number(c.id) === x && !Number(c.parent_id)))) return refuse(400, '22023', 'invalid: main_categories');
        const names = ids.map((x) => (mock.wooCategories.find((c) => Number(c.id) === x) || {}).name).filter(Boolean).join('، ').slice(0, 300) || null;
        Object.assign(v, { main_categories: ids, category: names, updated_at: new Date().toISOString() });
        mock.vendorWrites.push({ table: 'vendor_main_categories', vendor_id: vid, ids, category: names, by: u.email });
        return json(200, { main_categories: ids, category: names });
      }
      if (method === 'POST' && path === '/rest/v1/rpc/vendor_commission_set') {
        const b = body(); const vid = String(b.p_vendor || '').toLowerCase();
        const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
        if (!(isAdmin(u) || hasPerm(u, 'sensitive.commission') === 'F')) return refuse(403, '42501', 'sensitive.commission = F is required to set a maker commission');
        const type = b.p_type; const rate = b.p_rate == null ? null : Number(b.p_rate); const flat = b.p_flat == null ? null : Number(b.p_flat); const cats = b.p_categories == null ? [] : b.p_categories;
        if (!['fixed', 'category_based'].includes(type) || rate == null || !(rate >= 0 && rate <= 65) || (flat != null && !(flat >= 0)) || !Array.isArray(cats)) return refuse(400, '22023', 'bad commission');
        if (cats.some((c) => !c || !Number.isInteger(c.id) || c.id <= 0 || (c.rate != null && !(c.rate >= 0 && c.rate <= 65)) || (c.flat != null && !(c.flat >= 0)))) return refuse(400, '22023', 'bad category item');
        if (!mock.vendors.some((x) => x.id === vid)) return refuse(400, 'P0002', 'vendor not found');
        const d = new Date(); const since = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); const now = d.toISOString();
        const row = mock.vendorRates.find((x) => x.vendor_id === vid && x.since === since);
        if (row) Object.assign(row, { rate, flat, set_by: u.name, commission_type: type }); else { rateSeq += 1; mock.vendorRates.push({ id: rateSeq, vendor_id: vid, rate, flat, since, set_by: u.name, created_at: now, commission_type: type }); }
        for (const c of cats) {
          const cr = mock.vendorCategoryRates.find((x) => x.vendor_id === vid && x.since === since && Number(x.woo_category_id) === c.id);
          if (cr) Object.assign(cr, { rate: c.rate ?? null, flat: c.flat ?? null, set_by: u.name }); else { catRateSeq += 1; mock.vendorCategoryRates.push({ id: catRateSeq, vendor_id: vid, woo_category_id: c.id, rate: c.rate ?? null, flat: c.flat ?? null, since, set_by: u.name, created_at: now }); }
        }
        effectiveRate(vid);
        mock.vendorWrites.push({ table: 'vendor_commission', vendor_id: vid, type, rate, flat, categories: cats, since, set_by: u.name });
        return json(200, since);
      }
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
        const edit = hasPerm(u, 'vendors.edit'); const contact = ['phone', 'email', 'contact_name', 'address_parts', 'social']; const store = asked.filter((f) => f !== 'bank');
        if (store.length && !(isAdmin(u) || edit === 'F' || (edit === 'P' && store.every((f) => contact.includes(f))))) return refuse(403, '42501', 'vendors.edit = F (or P for the contact fields) is required to queue a push to the site');
        if (asked.includes('bank') && !(isAdmin(u) || hasPerm(u, 'sensitive.vendor_bank') === 'F')) return refuse(403, '42501', 'sensitive.vendor_bank = F is required to queue a bank push to the site'); // 0017
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
        const rows = table[1] === 'roles' ? (mock.roles || ROLES) : viewPerm(u) !== 'N' ? mock.profiles : mock.profiles.filter((x) => x.id === u.id);
        return json(200, cols.includes('*') ? rows : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))));
      }
      // «ملفي › تعديل بياناتي» (phase 10): RLS profiles_update (one's own row, or the admin) + profiles_guard_update (a non-admin: name /
      // phone only, 0001); profiles.phone is unique (23505). profileWrites: each PATCH body with its caller.
      if (method === 'PATCH' && table && table[1] === 'profiles') {
        const idf = /^eq\.(.+)$/.exec(url.searchParams.get('id') || ''); const b = body(); const isAdmin = u.role_id === 'admin' && u.status === 'active';
        if (!isAdmin && Object.keys(b).some((k) => !['name', 'phone'].includes(k))) return json(403, { code: '42501', details: null, hint: null, message: 'only an admin can change this profile field' });
        const rows = mock.profiles.filter((x) => idf && x.id === idf[1] && (x.id === u.id || isAdmin));
        if (b.phone != null && mock.profiles.some((x) => x.phone === b.phone && !rows.some((r) => r.id === x.id))) return json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "profiles_phone_key"' });
        rows.forEach((r) => Object.assign(r, b)); mock.profileWrites.push({ by: u.id, ...b });
        return json(200, rows.map((r) => ({ id: r.id })));
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
        // RLS activity_log_select (0006, 0046): an active user's own rows; every row with settings.view — but the HR ones (entity 'hr')
        // with hr.view F too
        if (t === 'activity_log') return answer(mock.activityRows.filter((r) => ((viewPerm(u) !== 'N' && (r.entity !== 'hr' || hasPerm(u, 'hr.view') === 'F')) || (u.status === 'active' && r.actor === u.id)) && f.match(r)));
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
        const bad = (r) => (t === 'vendors' ? (r.category != null && String(r.category).length > 300 ? 'vendors_category_len' : r.lead_days != null && !(Number.isInteger(Number(r.lead_days)) && r.lead_days >= 1 && r.lead_days <= 60) ? 'vendors_lead_days_check' : r.status != null && !['active', 'leave', 'inactive'].includes(r.status) ? 'vendors_status_check' : null)
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
          const visible = t === 'woo_categories' ? hasPerm(u, 'vendors.view') !== 'N' || hasPerm(u, 'products.view') !== 'N' : t === 'vendors' || t === 'vendor_logins' ? hasPerm(u, 'vendors.view') !== 'N' : F;
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
            else if (t === 'vendor_logins') { mock.vendorLogins.push({ fails: 0, locked_until: null, own_password: false, last_login_at: null, vendor_id: r.vendor_id, username: r.username, email: r.email ?? null, pw_mode: r.pw_mode ?? 'link', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: null, secret_id: null, created_by: r.created_by ?? u.name, created_at: now, updated_at: now }); out.push({ vendor_id: r.vendor_id }); } // created_by: the member's name (0012, like set_by / updated_by)
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
      // phase 13 decision 52 — product_lead_days (0076): read with orders / products / vendors view; written by the admin or products.edit F
      if (path === '/rest/v1/product_lead_days') {
        const pf = url.searchParams.get('product_id') || ''; const m = /^(eq|in)\.\(?([0-9,]*)\)?$/.exec(pf); const ids = m ? m[2].split(',').filter(Boolean) : null;
        const pick = (r) => (ids ? ids.includes(String(r.product_id)) : true);
        if (method === 'GET') {
          const vis = hasPerm(u, 'orders.view') !== 'N' || hasPerm(u, 'products.view') !== 'N' || hasPerm(u, 'vendors.view') !== 'N';
          const rows = vis ? mock.productLeads.filter(pick) : []; const sel = (url.searchParams.get('select') || '').split(',').map((x) => x.trim());
          const out = rows.map((r) => Object.fromEntries(sel.map((k) => [k, r[k]])));
          return /vnd\.pgrst\.object/.test(hd.accept || '') ? (out.length ? json(200, out[0]) : json(406, { code: 'PGRST116', details: null, hint: null, message: 'no rows' })) : json(200, out);
        }
        if (!(isAdmin(u) || hasPerm(u, 'products.edit') === 'F')) return json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "product_lead_days"' });
        if (method === 'POST') { const b = body(); const row = Array.isArray(b) ? b[0] : b; const d = Number(row.days); if (!(d >= 1 && d <= 90)) return json(400, { code: '23514', details: null, hint: null, message: 'check' });
          const ex = mock.productLeads.find((x) => String(x.product_id) === String(row.product_id)); if (ex) ex.days = d; else mock.productLeads.push({ product_id: Number(row.product_id), days: d }); mock.leadWrites.push({ op: 'upsert', product_id: String(row.product_id), days: d, by: u.email }); return empty(201); }
        if (method === 'DELETE') { mock.productLeads = mock.productLeads.filter((x) => !pick(x)); mock.leadWrites.push({ op: 'delete', product_id: ids && ids[0], by: u.email }); return empty(204); }
      }
      const ot = /^\/rest\/v1\/(orders|orders_v|order_items|sub_orders|products|status_map|woo_states|woo_brands|product_commissions)$/.exec(path);
      const OT_METHODS = { orders: ['PATCH'], orders_v: ['GET'], order_items: ['GET', 'PATCH'], sub_orders: ['GET'], products: ['GET'], status_map: ['GET'], woo_states: ['GET'], woo_brands: ['GET'], product_commissions: ['GET'] };
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
          // 0021: products with orders.view or products.view; woo_brands with products.view or vendors.view
          const visible = t === 'woo_states' || (t === 'products' ? hasPerm(u, 'orders.view') !== 'N' || hasPerm(u, 'products.view') !== 'N'
            : t === 'woo_brands' ? hasPerm(u, 'products.view') !== 'N' || hasPerm(u, 'vendors.view') !== 'N' : t === 'product_commissions' ? hasPerm(u, 'sensitive.commission') === 'F' : hasPerm(u, 'orders.view') !== 'N');
          const rows = t === 'orders_v' ? mock.orders.filter((o) => !o.deleted_at).map((o) => viewRow(u, o)) : t === 'order_items' ? mock.orderItems : t === 'sub_orders' ? mock.subOrders : t === 'products' ? mock.products : t === 'woo_states' ? mock.wooStates : t === 'woo_brands' ? mock.wooBrands : t === 'product_commissions' ? mock.productCommissions : mock.statusMap;
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
    // Storage, bucket tickets (0045, phase 8): private, images / PDF ≤ 10 MB; upload into the member's own folder with tickets.manage F;
    // a signed URL for the uploader or a member who sees a ticket carrying the file
    const stk = /^\/storage\/v1\/object\/(sign\/)?tickets\/(.+)$/.exec(path);
    if (stk && method === 'POST') {
      const u = tokenUser(); if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      const key = decodeURIComponent(stk[2]);
      if (stk[1]) {
        const mine = key.startsWith(u.id + '/'); const has = (a) => (a || []).some((f) => f.path === key);
        const seen = mock.tickets.some((t) => tkSees(u, t) && (has(t.attachments) || mock.ticketEvents.some((e) => e.ticket_id === t.id && has(e.attachments))));
        if (!(mine || seen) || !mock.ticketObjects.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
        n += 1; return json(200, { signedURL: '/object/sign/tickets/' + key + '?token=tk-' + n });
      }
      if (!key.startsWith(u.id + '/') || hasPerm(u, 'tickets.manage') !== 'F') return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      // supabase-js sends a File / Blob as multipart/form-data: the file's own type and bytes are the part's (as Storage reads them)
      let type = hd['content-type'] || ''; let bytes = req.postDataBuffer() || Buffer.alloc(0);
      if (/^multipart\/form-data/.test(type)) { const raw = bytes.toString('latin1'); const m = /Content-Type:\s*([^\r\n]+)\r\n\r\n/i.exec(raw); type = m ? m[1].trim() : ''; if (m) { const start = m.index + m[0].length; const end = raw.indexOf('\r\n--', start); bytes = bytes.subarray(start, end < 0 ? undefined : end); } }
      if (!TK_MIME.includes(type)) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + type + ' is not supported' });
      if (bytes.length > 10485760) return json(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (mock.ticketObjects.has(key)) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      mock.ticketObjects.set(key, { type, size: bytes.length, by: u.id });
      return json(200, { Key: 'tickets/' + key, Id: 'obj-tk-' + mock.ticketObjects.size });
    }
    // Storage, bucket ai-images (0025, phase 5.4): private; a member with products.add or products.edit = F reads (a signed URL, a
    // download) and deletes their own folder (<uid>/…) only; members never write (the server does — the ai-images handler below)
    // Storage, bucket cs-media (0064, phase 13 T3): private; cs.reply = F uploads into their own folder; cs.view reads (a signed URL)
    const stm = /^\/storage\/v1\/object\/(sign\/)?cs-media\/(.+)$/.exec(path);
    if (stm && method === 'POST') {
      const u = tokenUser(); if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      const key = decodeURIComponent(stm[2]);
      if (stm[1]) { if (hasPerm(u, 'cs.view') === 'N' || !mock.csMedia.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); n += 1; return json(200, { signedURL: '/object/sign/cs-media/' + key + '?token=cm-' + n }); }
      if (!key.startsWith(u.id + '/') || !(isAdmin(u) || hasPerm(u, 'cs.reply') === 'F')) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      let type = hd['content-type'] || ''; let bytes = req.postDataBuffer() || Buffer.alloc(0);
      if (/^multipart\/form-data/.test(type)) { const raw = bytes.toString('latin1'); const m = /Content-Type:\s*([^\r\n]+)\r\n\r\n/i.exec(raw); type = m ? m[1].trim() : ''; if (m) { const start = m.index + m[0].length; const end = raw.indexOf('\r\n--', start); bytes = bytes.subarray(start, end < 0 ? undefined : end); } }
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(type)) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + type + ' is not supported' });
      if (bytes.length > 10485760) return json(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (mock.csMedia.has(key)) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      mock.csMedia.set(key, { type, size: bytes.length, by: u.id });
      return json(200, { Key: 'cs-media/' + key, Id: 'obj-cm-' + mock.csMedia.size });
    }
    const sti = /^\/storage\/v1\/object\/(sign\/)?ai-images(?:\/(.+))?$/.exec(path);
    if (sti && (method === 'POST' || method === 'DELETE' || method === 'GET')) {
      const u = tokenUser(); if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      const may = isAdmin(u) || hasPerm(u, 'products.add') === 'F' || hasPerm(u, 'products.edit') === 'F';
      const own = (k) => may && typeof k === 'string' && k.startsWith(u.id + '/');
      if (sti[1]) { if (!own(sti[2]) || !mock.imgObjects.has(sti[2])) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); n += 1; return json(200, { signedURL: '/object/sign/ai-images/' + sti[2] + '?token=ai-' + n }); }
      if (method === 'GET') { return own(sti[2]) && mock.imgObjects.has(sti[2]) ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': ctOf(sti[2]) }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
      if (method === 'DELETE') { const b = body(); (b.prefixes || []).filter(own).forEach((k) => mock.imgObjects.delete(k)); return json(200, []); }
      return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    }
    // Storage, bucket studio (0023, phase 5.2): private, products.add = F; upload (WebP), a signed URL, remove
    const sst = /^\/storage\/v1\/object\/(sign\/)?studio(?:\/(.+))?$/.exec(path);
    if (sst && (method === 'POST' || method === 'DELETE' || method === 'GET')) {
      const u = tokenUser(); if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      const may = isAdmin(u) || hasPerm(u, 'products.add') === 'F';
      if (sst[1]) { if (!may || !mock.studioObjects.has(sst[2])) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); n += 1; return json(200, { signedURL: '/object/sign/studio/' + sst[2] + '?token=st-' + n }); }
      // a download (the WebP step of decision 7 reads the result back): products.add reads the bucket
      if (method === 'GET') { return may && mock.studioObjects.has(sst[2]) ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': ctOf(sst[2]) }, body: PNG_1PX }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
      if (method === 'DELETE') { const b = body(); (b.prefixes || []).forEach((k) => mock.studioObjects.delete(k)); return json(200, []); }
      if (!may) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const bytes = req.postDataBuffer() || Buffer.alloc(0); mock.studioObjects.set(sst[2], { type: hd['content-type'] || '', size: bytes.length });
      return json(200, { Key: 'studio/' + sst[2], Id: 'obj-st-' + mock.studioObjects.size });
    }
    // phase 13 decision 51 — Storage, bucket vendor-photos (0075): private, 5 MB, PNG / JPEG / WebP; insert = the admin or vendors.edit F
    // into an existing maker's folder (<vendor uuid>/<name>.png|jpg|webp); a signed URL for vendors.view <> N; GET of the signed URL → a pixel
    const vp = /^\/storage\/v1\/object\/(sign\/)?vendor-photos\/(.+)$/.exec(path);
    if (method === 'POST' && vp) {
      const u = tokenUser(); const key = decodeURIComponent(vp[2]);
      if (!u) return json(401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
      if (vp[1]) { if (hasPerm(u, 'vendors.view') === 'N' || !mock.vendorPhotos.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); return json(200, { signedURL: '/object/sign/vendor-photos/' + key + '?token=vp' }); }
      const bytes = req.postDataBuffer() || Buffer.alloc(0); const type = hd['content-type'] || '';
      if (!(isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F')) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const m = /^([0-9a-f-]{36})\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/.exec(key);
      if (!m || !mock.vendors.some((v) => v.id === m[1])) return json(400, { statusCode: '400', error: 'InvalidKey', message: 'Invalid key: ' + key });
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime' });
      if (bytes.length > 5242880) return json(413, { statusCode: '413', error: 'Payload too large', message: 'too large' });
      mock.vendorPhotos.set(key, { type, bytes }); return json(200, { Key: 'vendor-photos/' + key, Id: 'obj-vp-' + mock.vendorPhotos.size });
    }
    if (method === 'GET' && /^\/storage\/v1\/object\/sign\/vendor-photos\//.test(path)) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: PNG_1PX });
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
    // phase 5.3: ai-content (supabase/functions/ai-content, verify_jwt false): write needs the admin or products.add / products.edit = F,
    // studio the admin or products.add = F; the body checked by the server's own parseWrite / parseStudio (400 + field); a product from
    // the mirror (404 when unknown), a studio item from its batch (404); mock.aiFail = 'not_configured' (503) / 'busy' (429) / 'ai_cap'
    // (402) / 'ai_error' (502) / 'refused' (200 refused); else Claude's answer is mock.aiAnswer(action, req) or the default below,
    // cleaned by the server's own cleanWrite / cleanStudio; each call → mock.aiCalls ({ action, by, ...body }), each answer an ai_runs row.
    // phase 5.4: ai-images (supabase/functions/ai-images, verify_jwt false): generate needs the admin or products.add = F, edit of a
    // studio path products.add, of a site product products.edit, create either, probe the admin; the body checked by the server's own
    // parseGenerate / parseEdit / parseCreate (400 + field); a batch item from its batch (404) and its reference photos from the bucket
    // (400 reference), a product from the mirror (404; no https photo → 404 for edit, 400 image for create); the credit cap of the
    // settings row «ai» (image_monthly_credits — this Cairo month's image rows) → 402 + a cap row; mock.imgFail = 'not_configured'
    // (503) / 'busy' (429) / 'ai_cap' (402) / 'ai_error' (502) / 'refused' (200 refused); else one WebP per image (a 1×1 PNG body)
    // lands in bucket studio under the batch (generate, a studio edit) or in bucket ai-images under the member (create, a product's
    // edit); each call → mock.imgCalls ({ action, by, ...body without the image data }), each answer an ai_runs row with credits.
    if (method === 'POST' && path === '/functions/v1/ai-images') {
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      if (!u) return json(401, { error: 'unauthorized' });
      const add = isAdmin(u) || hasPerm(u, 'products.add') === 'F'; const edit = isAdmin(u) || hasPerm(u, 'products.edit') === 'F';
      if (!['generate', 'edit', 'create', 'probe', 'webp', 'import', 'share', 'bridge_status', 'bridge_link', 'bridge_callback', 'bridge_unlink', 'bridge_upload', 'bridge_fetch', 'bridge_prompts_sync', 'bridge_flow'].includes(action)) return json(400, { error: 'unknown_action' });
      if (action.startsWith('bridge_')) {
        // decision 11: the system as the Magnific site's MCP client — the mock keeps the account's state in mock.magnific and answers
        // like the server: status (the tool's members; the admin sees the account), link (the admin → an https sign-in url with a state),
        // callback { code, state } (the admin; the state once), unlink, upload (products.add: each product photo not sent → a sent
        // image_shares row with a creation id; 503 not_linked without an account), fetch (products.add: mock.magnific.results not
        // uploads / sources / imported, matched by lineage → family → name, into the products' empty slots through an image_imports row)
        const M = mock.magnific; mock.bridgeCalls.push({ by: u.email, action, body: { ...b, action: undefined } });
        const PROJECT = 'f3b8e918-1fac-49a7-9196-8d22ca637a8e';
        if (action === 'bridge_status') { if (!(add || edit)) return json(401, { error: 'unauthorized' }); return json(200, { result: 'ok', linked: !!M.linked, project: PROJECT, ...(isAdmin(u) ? { account: M.linked ? M.account : null, configured: !!M.configured, redirect: 'https://operation-system.ibtekr.club/magnific-callback.html' } : {}) }); }
        if (action === 'bridge_link') { if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); if (!M.configured) return json(503, { error: 'not_configured', configured: false }); const state = 'st' + Math.random().toString(36).slice(2).padEnd(41, 'x'); mock.oauthStates.push({ state, used: false, at: Date.now() }); return json(200, { result: 'ok', url: 'https://auth.mock/realms/mcp/auth?client_id=client-1&state=' + state + '&code_challenge=c&redirect_uri=' + encodeURIComponent('https://operation-system.ibtekr.club/magnific-callback.html') }); }
        if (action === 'bridge_callback') { if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); const st = mock.oauthStates.find((x) => x.state === b.state); if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(String(b.code || ''))) return json(400, { error: 'bad_request', field: 'code' }); if (!st || st.used) return json(400, { error: 'bad_request', field: 'state' }); st.used = true; if (String(b.code).startsWith('bad')) return json(400, { error: 'refused', status: 400, detail: 'invalid_grant' }); M.linked = true; M.account = M.account || 'owner@ibtekr.club'; return json(200, { result: 'ok', linked: true, account: M.account }); }
        if (action === 'bridge_unlink') { if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); M.linked = false; M.account = null; return json(200, { result: 'ok', linked: false }); }
        if (action === 'bridge_prompts_sync') {
          // decision 12: the owner's template read → shot_prompts (the mock adds one category and refreshes the chair's first prompt)
          if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); if (!M.linked) return json(503, { error: 'not_linked', status: null, detail: null });
          const tpl = typeof b.template_space === 'string' && b.template_space ? b.template_space : 'a24c0027-cdcc-461c-bc94-74a2a275c599';
          const put = (category, shot, name, prompt) => { const row = mock.shotPrompts.find((x) => x.category === category && x.shot === shot); if (row) Object.assign(row, { name, prompt, updated_at: new Date().toISOString() }); else mock.shotPrompts.push({ id: mock.shotPrompts.length + 1, category, shot, name, prompt, negative: null, model: 'imagen-nano-banana-2', aspect: '3:4', resolution: '1k', updated_at: new Date().toISOString() }); };
          put('كرسي', 1, 'كرسي 1 — تركيز على المنتج', 'CHAIR FOCUS PROMPT v2'); put('طاولة قهوة', 1, 'طاولة قهوة 1 — تركيز على المنتج', 'TABLE FOCUS'); put('طاولة قهوة', 2, 'طاولة قهوة 2 — المنتج في بيئة محيطة', 'TABLE ENV'); put('طاولة قهوة', 3, 'طاولة قهوة 3 — Closeup للتفاصيل', 'TABLE DETAIL');
          const cats = new Set(mock.shotPrompts.map((x) => x.category));
          return json(200, { result: 'ok', template_space: tpl, categories: cats.size, rows: mock.shotPrompts.length });
        }
        if (!add) return json(401, { error: 'unauthorized' });
        const bid = typeof b.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.batch_id) ? b.batch_id : null; if (!bid) return json(400, { error: 'bad_request', field: 'batch_id' });
        const batch = mock.studioBatches.find((x) => x.id === bid && !x.archived_at); if (!batch) return json(404, { error: 'not_found' });
        if (!isAdmin(u) && batch.created_by && batch.created_by !== u.id) return json(401, { error: 'unauthorized' });
        if (action === 'bridge_upload') {
          if (!M.linked) return json(503, { error: 'not_linked', status: null, detail: null });
          const only = Array.isArray(b.indexes) ? new Set(b.indexes) : null; const sent = new Set(mock.imageShares.filter((x) => x.batch_id === bid && x.status === 'sent').map((x) => x.path));
          let uploaded = 0, skipped = 0;
          (batch.state.items || []).forEach((it, i) => { if (only && !only.has(i)) return; const path = typeof it.main === 'string' && studioPathOk(bid, it.main) ? it.main : null; if (!path || sent.has(path) || !mock.studioObjects.has(path)) { skipped++; return; }
            const id = 'UP' + (mock.imageShares.length + 1); const name = (it.nameEn || it.nameAr || 'product-' + (i + 1)) + '.' + path.split('.').pop();
            mock.imageShares.push({ id: mock.imageShares.length + 1, created_at: new Date().toISOString(), created_by: u.id, batch_id: bid, item_index: i, item_key: it.key || null, name, path, url: 'https://signed.mock/studio/' + path + '?token=up', expires_at: new Date(Date.now() + 600000).toISOString(), status: 'sent', creation_ref: id, error: null, sent_at: new Date().toISOString() });
            M.results.push({ id, name: name.replace(/\.[a-z0-9]+$/i, ''), family: 'fam-' + id, tool: 'upload', url: 'https://pikaso.cdnpk.net/p/' + id + '.jpg' }); uploaded++; });
          return json(200, { result: 'ok', batch_id: bid, uploaded, failed: 0, skipped, stopped: null });
        }
        if (action === 'bridge_flow') {
          // decision 12: the batch's flow on the one Space (made once), a page a category (made once): the sent photos as the list, three generators, three outputs
          if (!M.linked) return json(503, { error: 'not_linked', status: null, detail: null });
          const category = typeof b.category === 'string' ? b.category.trim() : ''; if (!category) return json(400, { error: 'bad_request', field: 'category' });
          const sent = mock.imageShares.filter((x) => x.batch_id === bid && x.status === 'sent' && x.creation_ref); if (!sent.length) return json(409, { error: 'nothing_sent' });
          if (!M.space) M.space = { id: 'a3000000-0000-4000-8000-000000000001', url: 'https://www.magnific.com/app/spaces/a3000000-0000-4000-8000-000000000001', name: 'استوديو ابتكر' };
          if (!M.pages[category]) M.pages[category] = 'page-' + (Object.keys(M.pages).length + 1);
          const order = [...new Set(sent.map((x) => x.item_index))].sort((a, c) => a - c);
          const prompts = mock.shotPrompts.filter((x) => x.category === category);
          const n = M.flows.length + 1;
          // decision 15: a size generator a product with a numeric size (its output → slot 3)
          const sizeGens = order.filter((i) => { const it = (batch.state.items || [])[i]; return it && Array.isArray(it.sizes) && it.sizes.some((s) => /\d/.test(String(s)) && !/[A-Za-z؀-ۿ]/.test(String(s).replace(/cm|سم/gi, ''))); }).map((i) => ({ shot: 4, index: i, id: 'gen-' + n + '-4-' + i, out: 'out-' + n + '-4-' + i }));
          const flow = { space_id: M.space.id, url: M.space.url, page_id: M.pages[category], category, panel: 'panel-' + n, list: 'list-' + n, gens: [1, 2, 3].map((s) => ({ shot: s, id: 'gen-' + n + '-' + s, out: 'out-' + n + '-' + s })).concat(sizeGens), order, made_at: new Date().toISOString(), prompts: prompts.map((p) => p.prompt) };
          M.flows.push({ batch_id: bid, ...flow });
          batch.state = { ...batch.state, flow }; batch.updated_at = new Date().toISOString();
          return json(200, { result: 'ok', batch_id: bid, url: M.space.url, space_id: M.space.id, page_id: M.pages[category], photos: order.length, sizes: sizeGens.length, category, prompts: prompts.length });
        }
        // bridge_fetch
        if (!M.linked) return json(503, { error: 'not_linked', status: null, detail: null });
        const place = (row, batch) => {
          // the import of a batch row: the images into the products' slots — a named slot (decision 12) when empty, else the next empty one
          const items = batch.state.items || []; const paths = row.urls.map(() => null); let placed = 0; const stamp = Date.now().toString(36) + (++mock.imgSeq);
          row.items.forEach((q) => { const it = items[q.index]; if (!it) return; it.slots = Array.isArray(it.slots) ? it.slots : []; q.images.forEach((nn, j) => { const k = batch.id + '/gen-' + q.index + '-imp-' + stamp + '-' + (nn + 1) + '.png'; mock.studioObjects.set(k, { type: 'image/png', size: PNG_1PX.length, by: 'import' }); paths[nn] = k; const want = Array.isArray(q.slots) ? q.slots[j] : null; let k2 = Number.isInteger(want) && !it.slots[want] ? want : 0; if (!(Number.isInteger(want) && !it.slots[want])) while (k2 < it.slots.length && it.slots[k2]) k2++; it.slots[k2] = k; placed++; }); });
          batch.updated_at = new Date().toISOString();
          const run = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'image', source: 'import', label: row.label, product_id: null, batch_id: batch.id, item_index: null, model: null, credits: 0, cost_usd: 0, status: 'ok', error: null, output: { paths, bucket: 'studio', import_id: row.id, failed: 0, placed } };
          mock.aiRuns.push(run); Object.assign(row, { status: 'ok', paths, run_id: run.id, done_at: new Date().toISOString() });
          return { paths, placed, run };
        };
        if (batch.state.flow && batch.state.flow.space_id) {
          // decision 12: the flow's output lists in order — shot s of photo k → product order[k], slot s−1
          const flow = batch.state.flow; const outs = M.flowResults[bid] || {}; const known = new Set(); mock.imageImports.filter((x) => x.batch_id === bid).forEach((x) => (x.refs || []).forEach((r) => known.add(r)));
          const picks = []; [1, 2, 3].forEach((s) => (outs[s] || []).forEach((id, k) => { if (k < flow.order.length && !known.has(id)) picks.push({ id, index: flow.order[k], slot: s - 1 }); }));
          // decision 15: flowResults[bid][4] = { [index]: [ids] } — a product's size drawings → its slot 3
          Object.entries(outs[4] || {}).forEach(([idx, ids]) => (ids || []).forEach((id) => { if (!known.has(id) && (flow.gens || []).some((g) => g.shot === 4 && g.index === Number(idx))) picks.push({ id, index: Number(idx), slot: 3 }); }));
          if (!picks.length) return json(200, { result: 'ok', batch_id: bid, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok', flow: true });
          const byIndex = new Map(); picks.forEach((p, nn) => { if (!byIndex.has(p.index)) byIndex.set(p.index, { images: [], slots: [] }); byIndex.get(p.index).images.push(nn); byIndex.get(p.index).slots.push(p.slot); });
          const row = { id: mock.imageImports.length + 1, created_at: new Date().toISOString(), created_by: u.id, source: 'magnific', folder: 'ابتكر', label: 'نتائج Magnific — ' + batch.title, product_id: null, urls: picks.map((p) => 'https://pikaso.cdnpk.net/p/' + p.id + '.png'), refs: picks.map((p) => p.id), status: 'pending', paths: null, error: null, run_id: null, done_at: null, target: 'batch', items: [...byIndex.entries()].map(([index, v]) => ({ index, images: v.images, slots: v.slots })), brand_id: null, vendor_id: null, batch_type: null, batch_id: bid };
          mock.imageImports.push(row);
          const { paths, placed, run } = place(row, batch);
          return json(200, { result: 'ok', target: 'batch', bucket: 'studio', batch_id: batch.id, path: paths[0], paths, credits: 0, model: '', run_id: run.id, imported: paths.length, failed: 0, status: 'ok', placed, found: picks.length, unmatched: 0, offhost: 0, import_id: row.id, flow: true });
        }
        const sources = mock.imageShares.filter((x) => x.batch_id === bid && x.status === 'sent' && x.creation_ref).map((x) => ({ ref: x.creation_ref, index: x.item_index, name: x.name.replace(/\.[a-z0-9]+$/i, '').toLowerCase(), family: (M.results.find((r) => r.id === x.creation_ref) || {}).family || '' }));
        if (!sources.length) return json(200, { result: 'ok', batch_id: bid, found: 0, placed: 0, unmatched: 0, imported: 0, failed: 0, status: 'ok' });
        const known = new Set(sources.map((s) => s.ref)); mock.imageImports.filter((x) => x.batch_id === bid).forEach((x) => (x.refs || []).forEach((r) => known.add(r)));
        const fresh = M.results.filter((r) => !known.has(r.id) && r.tool !== 'upload' && /^https:\/\/pikaso\.cdnpk\.net\//.test(r.url || ''));
        const matched = [], unmatched = [];
        fresh.forEach((r) => { let src = (r.lineage || []).map((id) => sources.find((s) => s.ref === id)).find(Boolean) || (r.family ? sources.find((s) => s.family === r.family) : null) || sources.find((s) => s.name.length >= 3 && (r.name || '').toLowerCase().includes(s.name)) || null; if (src) matched.push({ r, index: src.index }); else unmatched.push(r); });
        if (!matched.length) return json(200, { result: 'ok', batch_id: bid, found: fresh.length, placed: 0, unmatched: unmatched.length, imported: 0, failed: 0, status: 'ok' });
        const urls = matched.map((m) => m.r.url), refs = matched.map((m) => m.r.id); const byIndex = new Map(); matched.forEach((m, k) => { if (!byIndex.has(m.index)) byIndex.set(m.index, []); byIndex.get(m.index).push(k); });
        const row = { id: mock.imageImports.length + 1, created_at: new Date().toISOString(), created_by: u.id, source: 'magnific', folder: 'ابتكر', label: 'نتائج Magnific — ' + batch.title, product_id: null, urls, refs, status: 'pending', paths: null, error: null, run_id: null, done_at: null, target: 'batch', items: [...byIndex.entries()].map(([index, images]) => ({ index, images })), brand_id: null, vendor_id: null, batch_type: null, batch_id: bid };
        mock.imageImports.push(row);
        const { paths, placed, run } = place(row, batch);
        return json(200, { result: 'ok', target: 'batch', bucket: 'studio', batch_id: batch.id, path: paths[0], paths, credits: 0, model: '', run_id: run.id, imported: paths.length, failed: 0, status: 'ok', placed, found: fresh.length, unmatched: unmatched.length, import_id: row.id });
      }
      if (action === 'share') {
        // decision 10 (b): the batch's product photos (main, not shared yet) → image_shares rows (pending, a week's link, the
        // product's name as the file name) for the bridge; products.add and the member's own batch (the admin any)
        if (!add) return json(401, { error: 'unauthorized' });
        const bid = typeof b.batch_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.batch_id) ? b.batch_id : null; if (!bid) return json(400, { error: 'bad_request', field: 'batch_id' });
        const batch = mock.studioBatches.find((x) => x.id === bid && !x.archived_at); if (!batch) return json(404, { error: 'not_found' });
        if (!isAdmin(u) && batch.created_by && batch.created_by !== u.id) return json(401, { error: 'unauthorized' });
        const only = Array.isArray(b.indexes) ? new Set(b.indexes) : null; const had = new Set(mock.imageShares.filter((x) => x.batch_id === bid && x.status !== 'error').map((x) => x.path));
        let shared = 0, skipped = 0;
        (batch.state.items || []).forEach((it, i) => { if (only && !only.has(i)) return; const path = typeof it.main === 'string' && studioPathOk(bid, it.main) ? it.main : null; if (!path || had.has(path) || !mock.studioObjects.has(path)) { skipped++; return; }
          mock.imageShares.push({ id: mock.imageShares.length + 1, created_at: new Date().toISOString(), created_by: u.id, batch_id: bid, item_index: i, item_key: it.key || null, name: (it.nameEn || it.nameAr || 'product-' + (i + 1)) + '.' + path.split('.').pop(), path, url: 'https://signed.mock/studio/' + path + '?token=share', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), status: 'pending', creation_ref: null, error: null, sent_at: null }); shared++; });
        mock.shareCalls.push({ by: u.email, batch_id: bid, shared, skipped });
        return json(200, { result: 'ok', batch_id: bid, shared, skipped });
      }
      if (action === 'import') {
        // decision 8: a queued Magnific set — the row's owner (or the admin) with the tool permission; https links on
        // pikaso.cdnpk.net land as PNG under the importing member (the browser turns them WebP), any other link fails (null path);
        // one ai_runs row (source import, 0 credits); the row ok / partial / error; ok → 409; each call → mock.importCalls
        if (!(add || edit)) return json(401, { error: 'unauthorized' });
        const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request', field: 'id' });
        const row = mock.imageImports.find((x) => x.id === id); if (!row) return json(404, { error: 'not_found' });
        if (!isAdmin(u) && row.created_by !== u.id) return json(401, { error: 'unauthorized' });
        if (row.status === 'ok') return json(409, { error: 'done' });
        mock.importCalls.push({ by: u.email, id, target: row.target === 'studio' || row.target === 'batch' ? row.target : 'tool' });
        const stamp = Date.now().toString(36) + (++mock.imgSeq);
        if (row.target === 'batch') {
          // decision 10 (c): the site's results into the product slots of the batch they were made for (empty slots in order)
          if (!add) return json(401, { error: 'unauthorized' });
          const batch = mock.studioBatches.find((x) => x.id === row.batch_id && !x.archived_at); if (!batch) return json(404, { error: 'not_found' });
          if (!isAdmin(u) && batch.created_by && batch.created_by !== u.id) return json(401, { error: 'unauthorized' });
          const items = batch.state.items || []; const urls = row.urls || []; const paths = Array.isArray(row.paths) ? row.paths.slice() : urls.map(() => null); let placed = 0;
          const okUrl = (link) => { try { const x = new URL(link); return x.protocol === 'https:' && x.hostname === 'pikaso.cdnpk.net'; } catch (e) { return false; } };
          (Array.isArray(row.items) ? row.items : []).forEach((q) => { const it = items[q.index]; if (!it) return; it.slots = Array.isArray(it.slots) ? it.slots : [];
            (Array.isArray(q.images) ? q.images : []).filter((n) => Number.isInteger(n) && n >= 0 && n < urls.length).forEach((n) => {
              if (!paths[n]) { if (!okUrl(urls[n])) return; const k = batch.id + '/gen-' + q.index + '-imp-' + stamp + '-' + (n + 1) + '.png'; mock.studioObjects.set(k, { type: 'image/png', size: PNG_1PX.length, by: 'import' }); paths[n] = k; }
              if (it.slots.includes(paths[n])) return; let k2 = 0; while (k2 < it.slots.length && it.slots[k2]) k2++; it.slots[k2] = paths[n]; placed++; }); });
          batch.updated_at = new Date().toISOString();
          const done = paths.filter(Boolean); const status = done.length === paths.length ? 'ok' : done.length ? 'partial' : 'error';
          const run = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'image', source: 'import', label: row.label || 'وارد', product_id: null, batch_id: batch.id, item_index: null, model: null, credits: 0, cost_usd: 0, status: done.length ? 'ok' : 'error', error: done.length ? null : 'import_failed', output: { paths: done, bucket: 'studio', import_id: id, failed: paths.length - done.length, placed } };
          mock.aiRuns.push(run);
          Object.assign(row, { status, paths, error: done.length ? null : 'import_failed', run_id: run.id, done_at: status === 'ok' ? new Date().toISOString() : null });
          if (!done.length) return json(502, { error: 'ai_error' });
          return json(200, { result: 'ok', target: 'batch', bucket: 'studio', batch_id: batch.id, path: done[0], paths: done, credits: 0, model: '', run_id: run.id, imported: done.length, failed: paths.length - done.length, status, placed });
        }
        if (row.target === 'studio') {
          // decision 9: the set becomes a studio batch (products.add): the brand / maker / type as queued, the items from the
          // queued details (colors by code from sku_colors, Variable → colors × sizes), the photos under the batch in bucket studio
          if (!add) return json(401, { error: 'unauthorized' });
          const type = row.batch_type === 'Variable' ? 'Variable' : 'Simple';
          let batch = row.batch_id ? mock.studioBatches.find((x) => x.id === row.batch_id && !x.archived_at) : null;
          const brand = mock.brands.find((x) => x.id === row.brand_id) || null; const vendor = mock.vendors.find((x) => x.id === row.vendor_id) || null;
          if (!batch) { mock.studioSeq += 1; batch = { id: '0b6f2f5e-1d2c-4a8b-9e3f-' + String(mock.studioSeq).padStart(12, '0'), title: (row.label || row.folder || (brand && brand.name) || 'Magnific') + ' — ' + type + ' · ' + new Date().toISOString().slice(0, 10), brand_id: brand ? brand.id : null, vendor_id: vendor ? vendor.id : null, type, state: {}, step: 2, status: 'draft', result: null, created_by: u.id, updated_at: new Date().toISOString(), archived_at: null }; mock.studioBatches.unshift(batch); mock.studioWrites.push({ op: 'import', id: batch.id }); }
          const items = Array.isArray(row.items) ? row.items : []; const firstOf = new Set(items.map((it) => (Array.isArray(it.images) ? it.images[0] : null)));
          const paths = (row.urls || []).map((link, i) => { if (Array.isArray(row.paths) && typeof row.paths[i] === 'string') return row.paths[i]; let ok = false; try { const x = new URL(link); ok = x.protocol === 'https:' && x.hostname === 'pikaso.cdnpk.net'; } catch (e) { ok = false; } if (!ok) return null; const k = batch.id + '/row' + (i + 1) + '-' + (firstOf.has(i) ? 'main' : 'ref') + '-' + stamp + '.png'; mock.studioObjects.set(k, { type: 'image/png', size: PNG_1PX.length, by: 'import' }); return k; });
          const old = Array.isArray(batch.state.items) ? batch.state.items : [];
          const byName = (n) => mock.skuColors.find((c) => c.name_en.toLowerCase() === String(n).trim().toLowerCase() || String(c.name_ar).trim() === String(n).trim()) || null;
          const made = items.map((it, i) => { const prev = old[i] || {}; const names = Array.isArray(it.colors) ? it.colors : []; const found = names.map(byName); let colors = found.filter(Boolean).map((c) => c.code); const unknownColors = names.filter((n, k) => !found[k]); let sizes = Array.isArray(it.sizes) ? it.sizes : []; if (type !== 'Variable') { colors = colors.slice(0, 1); sizes = sizes.slice(0, 1); }
            const idx = (Array.isArray(it.images) ? it.images : []).filter((n) => Number.isInteger(n) && n >= 0 && n < paths.length); const vendorPrice = Number(it.vendorPrice) > 0 ? Number(it.vendorPrice) : null; const variations = [];
            if (type === 'Variable') for (const c of colors.length ? colors : [null]) for (const sz of sizes.length ? sizes : [null]) { if (c === null && sz === null) continue; variations.push({ color: c, size: sz, vendorPrice, stock: null, onDemand: false }); }
            return { key: prev.key || 'imp' + i, row: null, nameEn: it.nameEn || '', nameAr: it.nameAr || '', vendorPrice, colors, unknownColors, sizes, material: it.material || '', style: it.style || '', weight: it.weight || '', stock: null, onDemand: false, shortDesc: '', shortDescAr: '', categories: prev.categories || [], main: typeof prev.main === 'string' ? prev.main : (idx.length ? paths[idx[0]] : null), refs: (prev.refs || []).length ? prev.refs : idx.slice(1).map((n) => paths[n]).filter(Boolean), slots: prev.slots || [], colorImages: prev.colorImages || {}, variations: (prev.variations || []).length ? prev.variations : variations, sheetVariations: null }; });
          batch.state = { v: 1, type, vary: ['color'], brandId: brand ? brand.id : null, brandName: brand ? brand.name : '', vendorId: vendor ? vendor.id : null, vendorName: vendor ? vendor.name : '', rate: null, fee: null, sheet: null, imgCount: 4, items: made, imported: { import_id: id, source: 'magnific' } };
          batch.updated_at = new Date().toISOString();
          const done = paths.filter(Boolean); const status = done.length === paths.length ? 'ok' : done.length ? 'partial' : 'error';
          const run = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'image', source: 'import', label: row.label || row.folder || 'وارد', product_id: null, batch_id: batch.id, item_index: null, model: null, credits: 0, cost_usd: 0, status: done.length ? 'ok' : 'error', error: done.length ? null : 'import_failed', output: { paths: done, bucket: 'studio', import_id: id, failed: paths.length - done.length, items: items.length } };
          mock.aiRuns.push(run);
          Object.assign(row, { status, paths, batch_id: batch.id, error: done.length ? null : 'import_failed', run_id: run.id, done_at: status === 'ok' ? new Date().toISOString() : null });
          if (!done.length) return json(502, { error: 'ai_error' });
          return json(200, { result: 'ok', target: 'studio', bucket: 'studio', batch_id: batch.id, path: done[0], paths: done, credits: 0, model: '', run_id: run.id, imported: done.length, failed: paths.length - done.length, status, items: items.length });
        }
        const paths = (row.urls || []).map((link, i) => { if (Array.isArray(row.paths) && typeof row.paths[i] === 'string') return row.paths[i]; let ok = false; try { const x = new URL(link); ok = x.protocol === 'https:' && x.hostname === 'pikaso.cdnpk.net'; } catch (e) { ok = false; } if (!ok) return null; const k = u.id + '/imp-' + stamp + '-' + (i + 1) + '.png'; mock.imgObjects.set(k, { type: 'image/png', size: PNG_1PX.length, by: 'import' }); return k; });
        const done = paths.filter(Boolean); const status = done.length === paths.length ? 'ok' : done.length ? 'partial' : 'error';
        const run = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'image', source: 'import', label: row.label || row.folder || 'وارد', product_id: row.product_id || null, batch_id: null, item_index: null, model: null, credits: 0, cost_usd: 0, status: done.length ? 'ok' : 'error', error: done.length ? null : 'import_failed', output: { paths: done, bucket: 'ai-images', import_id: id, failed: paths.length - done.length } };
        mock.aiRuns.push(run);
        Object.assign(row, { status, paths, error: done.length ? null : 'import_failed', run_id: run.id, done_at: status === 'ok' ? new Date().toISOString() : null });
        if (!done.length) return json(502, { error: 'ai_error' });
        return json(200, { result: 'ok', target: 'tool', bucket: 'ai-images', path: done[0], paths: done, credits: 0, model: '', run_id: run.id, imported: done.length, failed: paths.length - done.length, status });
      }
      if (action === 'webp') {
        // decision 7: the browser's WebP of a result replaces the original under the same name (.webp) — a studio path with
        // products.add and its batch, a tool path in the member's own folder (the admin any); RIFF/WEBP bytes; the run row renamed;
        // each call → mock.webpCalls ({ by, bucket, path, bytes, run_id }); no credits, no ai_runs row
        const bucket = b.bucket === 'studio' ? 'studio' : b.bucket === 'ai-images' ? 'ai-images' : null;
        if (!bucket) return json(400, { error: 'bad_request', field: 'bucket' });
        const p = typeof b.path === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,120}\.(webp|png|jpe?g)$/i.test(b.path) ? b.path : null;
        if (!p) return json(400, { error: 'bad_request', field: 'path' });
        const data = b.image && typeof b.image.data === 'string' ? b.image.data : ''; const bytes = Buffer.from(data, 'base64');
        if (!data || bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return json(400, { error: 'bad_request', field: 'image' });
        if (bucket === 'studio') {
          if (!add) return json(401, { error: 'unauthorized' });
          const batchId = p.split('/')[0]; if (!studioPathOk(batchId, p)) return json(400, { error: 'bad_request', field: 'path' });
          const row = mock.studioBatches.find((x) => x.id === batchId); if (!row || row.archived_at) return json(404, { error: 'not_found' });
        } else if (!(add || edit) || (!isAdmin(u) && !p.startsWith(u.id + '/'))) return json(401, { error: 'unauthorized' });
        const objs = bucket === 'studio' ? mock.studioObjects : mock.imgObjects;
        if (!objs.has(p)) return json(404, { error: 'not_found' });
        const target = p.replace(/\.[a-z]+$/i, '.webp');
        objs.set(target, { type: 'image/webp', size: bytes.length, by: 'browser' }); if (target !== p) objs.delete(p);
        // decision 14: a studio result renamed → the batch's state points at the new name (the server's renameInState)
        if (bucket === 'studio' && target !== p) { const row = mock.studioBatches.find((x) => x.id === p.split('/')[0]); if (row && row.state) { const r = renameInState(row.state, p, target); if (r.changed) { row.state = r.state; row.updated_at = new Date().toISOString(); } } }
        const run = mock.aiRuns.find((x) => x.id === Number(b.run_id));
        if (run && (isAdmin(u) || run.created_by === u.id) && run.output && Array.isArray(run.output.paths)) run.output.paths = run.output.paths.map((x) => (x === p ? target : x));
        mock.webpCalls.push({ by: u.email, bucket, path: p, bytes: bytes.length, run_id: b.run_id ?? null });
        return json(200, { result: 'ok', bucket, path: target });
      }
      if (action === 'probe') { if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); if (mock.imgFail === 'not_configured') return json(503, { error: 'not_configured', configured: false }); if (mock.imgFail === 'key_refused') return json(503, { error: 'not_configured', configured: true, status: 401 }); return json(200, { result: 'ok', provider: 'magnific', shape: { credits: 'number', plan: { name: 'string' } }, models: MODEL_IDS }); }
      const may = action === 'generate' ? add : action === 'edit' ? (b.path ? add : edit) : add || edit;
      if (!may) return json(401, { error: 'unauthorized' });
      const parsed = action === 'generate' ? parseGenerate(b) : action === 'edit' ? parseEdit(b) : parseCreate(b);
      if (parsed.error) return json(400, parsed);
      const req = parsed.req;
      mock.imgCalls.push({ action, by: u.email, ...b, image: b.image ? { media_type: b.image.media_type, bytes: String(b.image.data || '').length } : undefined });
      let label = null; let batchId = null; let itemIndex = null; let productId = null; let source; let count = 1; let where; let bucket;
      const stamp = Date.now().toString(36) + (++mock.imgSeq);
      const product = (id) => mock.products.find((p) => Number(p.id) === id);
      if (action === 'generate') {
        const row = mock.studioBatches.find((x) => x.id === req.batchId); const it = row && !row.archived_at && row.state && Array.isArray(row.state.items) ? row.state.items[req.index] : null;
        if (!it) return json(404, { error: 'not_found' });
        const refs = [it.main, ...(Array.isArray(it.refs) ? it.refs : []), req.slot && typeof req.slot === 'object' && it.colorImages ? it.colorImages[req.slot.color] : null].filter((k) => typeof k === 'string' && studioPathOk(req.batchId, k) && mock.studioObjects.has(k));
        if (!refs.length) return json(400, { error: 'bad_request', field: 'reference' });
        source = 'studio'; label = it.nameEn || it.nameAr || '#' + (req.index + 1); batchId = req.batchId; itemIndex = req.index; bucket = 'studio';
        where = () => studioGenPath(req.batchId, req.index, req.slot, stamp, 'png');
      } else if (action === 'edit') {
        source = 'edit';
        if (req.path) {
          const index = Number.isInteger(b.index) && b.index >= 0 ? b.index : 0;
          const row = mock.studioBatches.find((x) => x.id === req.batchId); const it = row && !row.archived_at && row.state && Array.isArray(row.state.items) ? row.state.items[index] : null;
          if (!it || !studioPathOk(req.batchId, req.path)) return json(it ? 400 : 404, it ? { error: 'bad_request', field: 'path' } : { error: 'not_found' });
          if (!mock.studioObjects.has(req.path)) return json(404, { error: 'not_found' });
          label = it.nameEn || it.nameAr || '#' + (index + 1); batchId = req.batchId; itemIndex = index; bucket = 'studio';
          where = () => studioEditPath(req.batchId, index, stamp, 'png');
        } else {
          const p = product(req.productId); if (!p || !/^https:\/\//.test(p.image_url || '')) return json(404, { error: 'not_found' });
          label = p.name || '#' + req.productId; productId = req.productId; bucket = 'ai-images';
          where = (k) => toolPath(u.id, stamp, k, 'png');
        }
      } else {
        source = 'tool'; count = req.count; bucket = 'ai-images'; label = req.prompt || 'صورة';
        if (req.source === 'image' && !req.image) { const p = product(req.productId); if (!p) return json(404, { error: 'not_found' }); if (!/^https:\/\//.test(p.image_url || '')) return json(400, { error: 'bad_request', field: 'image' }); label = p.name || label; productId = req.productId; }
        else if (req.productId) { const p = product(req.productId); if (!p) return json(404, { error: 'not_found' }); label = p.name || label; productId = req.productId; }
        if (req.shape === 'size') label += ' — المقاس'; // decision 15: the size drawing's run, like the server
        where = (k) => toolPath(u.id, stamp, k, 'png');
      }
      const model = req.model; const planned = creditsFor(model, count);
      const base = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'image', source, label, product_id: productId, batch_id: batchId, item_index: itemIndex, model, credits: 0, cost_usd: 0, output: null };
      // the cap (0025 ai_image_run_start): this Cairo month's image credits + the planned ones over settings «ai».image_monthly_credits
      const cfg = imageSettings((mock.settings.find((x) => x.section === 'ai') || {}).data, {});
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date());
      const spent = mock.aiRuns.filter((x) => x.action === 'image' && new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(x.created_at)) === month).reduce((t, x) => t + (Number(x.credits) || 0), 0);
      if ((cfg.monthlyCredits != null && spent + planned > cfg.monthlyCredits) || mock.imgFail === 'ai_cap') { mock.aiRuns.push({ ...base, status: 'cap', error: 'ai_cap' }); return json(402, { error: 'ai_cap' }); }
      const fail = mock.imgFail;
      if (fail === 'not_configured' || fail === 'busy' || fail === 'ai_error') { mock.aiRuns.push({ ...base, status: 'error', error: fail, credits: fail === 'busy' ? planned : 0, cost_usd: fail === 'busy' ? usdOf(planned) : 0 }); return json(fail === 'not_configured' ? 503 : fail === 'busy' ? 429 : 502, fail === 'not_configured' ? { error: fail, configured: false } : { error: fail }); }
      if (fail === 'key_refused') { mock.aiRuns.push({ ...base, status: 'error', error: 'not_configured', credits: 0, cost_usd: 0, output: { configured: true, status: 401 } }); return json(503, { error: 'not_configured', configured: true, status: 401 }); }
      if (fail === 'refused') { mock.aiRuns.push({ ...base, status: 'refused', error: 'refused' }); return json(200, { result: 'refused', model, credits: 0, run_id: base.id }); }
      const paths = Array.from({ length: count }, (_, k) => where(k + 1));
      paths.forEach((k) => (bucket === 'studio' ? mock.studioObjects : mock.imgObjects).set(k, { type: 'image/png', size: PNG_1PX.length, by: 'ai' }));
      const run = { ...base, status: 'ok', error: null, credits: planned, cost_usd: usdOf(planned), output: { paths, bucket } };
      mock.aiRuns.push(run);
      return json(200, { result: 'ok', bucket, path: paths[0], paths, credits: planned, model, run_id: run.id });
    }
    // cs-wa (6.4, decisions 21–22): the admin's wa_status (the states + the QR, from mock.wa — a test moves it along) and wa_logout
    if (method === 'POST' && path === '/functions/v1/cs-wa') {
      const u = tokenUser(); const b = body(); if (!u || !isAdmin(u)) return json(401, { error: 'unauthorized' });
      const W = mock.wa || (mock.wa = { states: { wa1: { status: 'offline' }, wa2: { status: 'offline' } }, calls: [], script: null });
      W.calls.push(b.action);
      const row = mock.settings.find((r) => r.section === 'cs'); const lv = row && row.data && row.data.live ? row.data.live : {};
      if (b.action === 'wa_status') { if (typeof W.script === 'function') W.script(W); return json(200, { result: 'ok', live: { wa: lv.wa === true, campaigns: lv.campaigns === true }, states: Object.entries(W.states).map(([channel, x]) => ({ channel, status: x.status, qr_svg: x.status === 'qr' ? x.qr_svg || null : null, phone: x.phone || null, updated_at: new Date().toISOString() })) }); }
      if (b.action === 'wa_logout') { W.logout = b.channel; return json(200, { result: 'ok' }); }
      return json(400, { error: 'unknown_action' });
    }
    // cs-whatsapp (decision 26): WhatsApp 1 on the Cloud API — status (cs.view; the admin: the configuration, the number, the
    // history's progress), connect_start (the admin → an Embedded Signup url with a «wa_» state), connect_callback (the state once →
    // linked + the syncs asked for), sync, disconnect, send (cs.reply: the queued wa1 row → sent + a wamid; «ارفض» → 502 graph_131047).
    if (method === 'POST' && path === '/functions/v1/cs-whatsapp') {
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      if (!u) return json(401, { error: 'unauthorized' });
      const W = mock.waCloud || (mock.waCloud = { configured: true, configId: true, linked: false, number: null, calls: [] });
      W.calls.push(action);
      const canView = isAdmin(u) || hasPerm(u, 'cs.view') !== 'N'; const canReply = isAdmin(u) || hasPerm(u, 'cs.reply') === 'F';
      const now = new Date().toISOString(); const c1 = mock.cs.channels.find((c) => c.id === 'wa1');
      const chan = () => ({ id: 'wa1', name: c1.name, status: c1.status, number: c1.number, since: c1.since, last_message_at: c1.last_message_at, history: c1.meta && c1.meta.history ? c1.meta.history : null, contacts: null });
      if (action === 'status') { if (!canView) return json(401, { error: 'unauthorized' }); return json(200, { result: 'ok', linked: W.linked, channel: chan(), ...(isAdmin(u) ? { configured: W.configured, config_id: W.configId, verify_configured: true, webhook_url: 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-whatsapp', redirect: 'https://operation-system.ibtekr.club/meta-callback.html', ...(W.linked ? { number: { display: W.number, name: 'Ibtekr', biz_app: true } } : {}) } : {}) }); }
      if (['connect_start', 'connect_callback', 'connect_token', 'sync', 'disconnect'].includes(action) && !isAdmin(u)) return json(401, { error: 'unauthorized' });
      if (action === 'connect_token') {
        if (!/^\d{5,30}$/.test(String(b.waba_id || '')) || !/^\d{5,30}$/.test(String(b.phone_id || ''))) return json(400, { error: 'bad_request', field: 'waba_id' });
        if (String(b.token || '').length < 40) return json(400, { error: 'bad_request', field: 'token' });
        W.linked = true; W.number = '+1 555 161 0811'; W.last = { manual: true, waba_id: b.waba_id, phone_id: b.phone_id, token_len: String(b.token).length };
        Object.assign(c1, { kind: 'meta', status: 'connected', number: W.number, since: now, meta: { waba_id: b.waba_id, phone_id: b.phone_id, manual: true }, updated_at: now });
        return json(200, { result: 'ok', linked: true, manual: true, number: { display: W.number, name: 'Test Number' }, channel: chan() });
      }
      if (action === 'connect_start') {
        if (!W.configured || !W.configId) return json(503, { error: 'not_configured', configured: W.configured, config_id: W.configId });
        const state = 'wa_' + Math.random().toString(36).slice(2).padEnd(41, 'x'); mock.oauthStates.push({ state, used: false, at: Date.now(), kind: 'wa' });
        return json(200, { result: 'ok', state, url: 'https://www.facebook.com/v25.0/dialog/oauth?client_id=1234567890&config_id=5550001112&response_type=code&override_default_response_type=true&state=' + state, sdk: { app_id: '1234567890', config_id: '5550001112', version: 'v25.0', extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4' } } });
      }
      if (action === 'connect_callback') {
        W.last = { sdk: b.sdk, code: b.code, waba_id: b.waba_id, phone_id: b.phone_id };
        const st = mock.oauthStates.find((x) => x.state === b.state && x.kind === 'wa'); if (!st || st.used) return json(400, { error: 'bad_request', field: 'state' }); st.used = true;
        if (String(b.code || '').startsWith('bad')) return json(400, { error: 'no_account' });
        W.linked = true; W.number = '+20 100 000 0001';
        Object.assign(c1, { kind: 'meta', status: 'connected', number: W.number, since: now, meta: { waba_id: '1029384756', phone_id: '5566778899', history: { requested_at: now } }, updated_at: now });
        return json(200, { result: 'ok', linked: true, number: { display: W.number, name: 'Ibtekr' }, sync: { contacts: 'requested', history: 'requested' }, channel: chan() });
      }
      if (action === 'sync') { if (!W.linked) return json(503, { error: 'not_linked' }); return json(200, { result: 'ok', type: b.type }); }
      if (action === 'disconnect') { W.linked = false; W.number = null; Object.assign(c1, { status: 'disconnected', number: null, since: null, meta: {}, updated_at: now }); return json(200, { result: 'ok', linked: false, channel: chan() }); }
      // phase 13 T3: a customer's WhatsApp media fetched from Meta once (the mock: signed at once), or our own attachment signed
      if (action === 'media_url') {
        if (!canView) return json(401, { error: 'unauthorized' });
        const m = mock.cs.messages.find((x) => x.id === b.message_id); if (!m) return json(404, { error: 'not_found' });
        const meta = m.meta || {}; if (meta.media && meta.media.path) { n += 1; return json(200, { result: 'ok', url: '/object/sign/cs-media/' + meta.media.path + '?token=cm-' + n, type: meta.media.type }); }
        if (!meta.media_id) return json(409, { error: 'no_media' }); if (!W.linked) return json(503, { error: 'not_linked' });
        const key = 'inbound/' + m.id + '.jpg'; mock.csMedia.set(key, { type: 'image/jpeg', size: 1, by: null }); m.meta = { ...meta, media_path: key }; n += 1;
        return json(200, { result: 'ok', url: '/object/sign/cs-media/' + key + '?token=cm-' + n, type: meta.mime || 'image/jpeg' });
      }
      if (action === 'send') {
        if (!canReply) return json(401, { error: 'unauthorized' });
        const m = mock.cs.messages.find((x) => x.id === b.message_id); if (!m) return json(404, { error: 'not_found' });
        if (m.kind !== 'out' || m.delivery !== 'queued') return json(409, { error: 'not_queued', delivery: m.delivery });
        if (!W.linked) return json(503, { error: 'not_linked' });
        if (String(m.text).includes('ارفض')) { m.delivery = 'failed'; m.meta = { ...(m.meta || {}), error: 'graph_131047' }; return json(502, { error: 'graph_131047', status: 400, delivery: 'failed' }); }
        m.delivery = 'sent'; m.external_id = 'wamid.' + Math.random().toString(36).slice(2, 10); return json(200, { result: 'ok', delivery: 'sent', external_id: m.external_id });
      }
      // phase 13 T1: the approved Meta template to one number (cs.manage); the tick by hand (the admin)
      if (action === 'campaign_test') {
        if (!(isAdmin(u) || hasPerm(u, 'cs.manage') === 'F')) return json(401, { error: 'unauthorized' });
        const t = mock.cs.templates.find((x) => x.id === b.template_id && x.wa_template && x.active !== false); if (!t) return json(400, { error: 'bad_request', field: 'template_id' });
        if (String(b.phone || '').replace(/\D/g, '').length < 10) return json(400, { error: 'bad_request', field: 'phone' });
        if (!W.linked) return json(503, { error: 'not_linked' });
        W.last = { test: { template: t.wa_template, phone_len: String(b.phone).replace(/\D/g, '').length, code: b.code || null } };
        return json(200, { result: 'ok', external_id: 'wamid.test', template: t.wa_template });
      }
      if (action === 'campaign_tick') { if (!isAdmin(u)) return json(401, { error: 'unauthorized' }); return json(200, { result: 'ok', skipped: 'off' }); }
      return json(400, { error: 'unknown_action' });
    }
    if (method === 'POST' && path === '/functions/v1/cs-auto') {
      // phase 6.5: the engine's member actions — status (cs.view), tick (the admin; dry = a preview, nothing written)
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      if (!u) return json(401, { error: 'unauthorized' });
      if (!['status', 'tick'].includes(action)) return json(400, { error: 'unknown_action' });
      const row = mock.settings.find((x) => x.section === 'cs'); const live = !!(row && row.data && row.data.auto && row.data.auto.live === true);
      if (action === 'status') { if (hasPerm(u, 'cs.view') === 'N') return json(401, { error: 'unauthorized' }); return json(200, { result: 'ok', live, hours: { from: 9, to: 22 }, daily: { wa1: 250, wa2: 150 }, last: null, rules: { total: mock.cs.rules.length, enabled: mock.cs.rules.filter((r) => r.enabled).length }, channels: { wa1: false, page: false } }); }
      if (!isAdmin(u)) return json(401, { error: 'unauthorized' });
      mock.csWrites.push({ table: 'cs-auto', op: b.dry ? 'dry' : 'tick' });
      return json(200, { result: b.dry ? 'dry' : 'ok', at: new Date().toISOString(), live, events: 0, sent: 0, held: 0, skipped: 0, failed: 0, tickets: 0, assigned: 0, tagged: 0, due: 0, silent: 0, by: {}, ...(b.dry ? { preview: [] } : {}) });
    }
    if (method === 'POST' && path === '/functions/v1/cs-channel') {
      // phase 6.2: the Meta channel's member actions like the server answers them (the webhook side is the server's alone — no browser call).
      // status (cs.view; the admin sees the configuration), connect_start (the admin → a facebook.com dialog url with a state), connect_callback
      // { code, state } (the state once; one page → linked, several → choose; a code starting with «bad» → Meta refuses), connect_pick, disconnect,
      // send / comment_private { message_id } (cs.reply: the queued out row → sent + an id; a text with «ارفض» → 502 graph_10:2018278 + failed),
      // comment_hide { conversation_id } (an event row).
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      if (!u) return json(401, { error: 'unauthorized' });
      const ACTS = ['status', 'connect_start', 'connect_callback', 'connect_pick', 'disconnect', 'send', 'comment_private', 'comment_hide'];
      if (!ACTS.includes(action)) return json(400, { error: 'unknown_action' });
      const M = mock.meta; const canView = isAdmin(u) || hasPerm(u, 'cs.view') !== 'N'; const canReply = isAdmin(u) || hasPerm(u, 'cs.reply') === 'F';
      mock.metaCalls.push({ by: u.email, action, body: { ...b, action: undefined } });
      const now = new Date().toISOString();
      const chans = () => mock.cs.channels.filter((c) => c.id === 'messenger' || c.id === 'instagram').map((c) => ({ id: c.id, name: c.name, status: c.status, number: c.number, since: c.since, last_message_at: c.last_message_at }));
      const logRow = (act, entityId, value) => { activityId += 1; mock.activityRows.push({ id: activityId, at: now, actor: u.id, action: act, entity: 'cs_channel', entity_id: entityId, new_value: value }); };
      const link = (p) => {
        M.linked = true; M.page = p; M.candidates = [];
        const meta = { page_id: p.id, page_name: p.name, ig_id: p.ig ? p.ig.id : null, ig_username: p.ig ? p.ig.username : null, fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes', 'feed'] };
        Object.assign(mock.cs.channels.find((c) => c.id === 'messenger'), { status: 'connected', number: p.name, since: now, meta, updated_at: now });
        Object.assign(mock.cs.channels.find((c) => c.id === 'instagram'), p.ig ? { status: 'connected', number: '@' + p.ig.username, since: now, meta, updated_at: now } : { status: 'disconnected', number: null, since: null, meta: { ...meta, note: 'no_instagram_account' }, updated_at: now });
        logRow('cs.channel.connect', 'messenger', p.name + (p.ig ? ' + instagram' : ''));
        return json(200, { result: 'ok', linked: true, page: p, instagram: !!p.ig, channels: chans() });
      };
      if (action === 'status') { if (!canView) return json(401, { error: 'unauthorized' }); return json(200, { result: 'ok', linked: M.linked, channels: chans(), ...(isAdmin(u) ? { configured: M.configured, verify_configured: M.verify, redirect: 'https://operation-system.ibtekr.club/meta-callback.html', webhook_url: 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-channel', page: M.page } : {}) }); }
      if (['connect_start', 'connect_callback', 'connect_pick', 'disconnect'].includes(action) && !isAdmin(u)) return json(401, { error: 'unauthorized' });
      if (action === 'connect_start') {
        if (!M.configured) return json(503, { error: 'not_configured', configured: false });
        const state = 'ms' + Math.random().toString(36).slice(2).padEnd(41, 'x'); mock.oauthStates.push({ state, used: false, at: Date.now(), kind: 'meta' });
        return json(200, { result: 'ok', url: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1234567890&redirect_uri=' + encodeURIComponent('https://operation-system.ibtekr.club/meta-callback.html') + '&state=' + state + '&response_type=code&scope=pages_show_list%2Cpages_messaging', channel: b.channel === 'instagram' ? 'instagram' : 'messenger' });
      }
      if (action === 'connect_callback') {
        if (!M.configured) return json(503, { error: 'not_configured', configured: false });
        if (!/^[A-Za-z0-9._~#-]{8,2048}$/.test(String(b.code || ''))) return json(400, { error: 'bad_request', field: 'code' });
        const st = mock.oauthStates.find((x) => x.state === b.state && x.kind === 'meta'); if (!st || st.used) return json(400, { error: 'bad_request', field: 'state' }); st.used = true;
        if (String(b.code).startsWith('bad')) return json(502, { error: 'graph_100', status: 400 });
        if (!M.pages.length) return json(400, { error: 'no_pages', seen: 0, granted: ['pages_show_list'], declined: [], missing: ['pages_messaging'] });
        if (M.pages.length === 1) return link(M.pages[0]);
        M.candidates = M.pages.slice(); return json(200, { result: 'choose', pages: M.pages.map((p) => ({ id: p.id, name: p.name, ig: p.ig })) });
      }
      if (action === 'connect_pick') { const p = M.candidates.find((x) => x.id === String(b.page_id)); if (!p) return json(404, { error: 'not_found' }); return link(p); }
      if (action === 'disconnect') {
        M.linked = false; M.page = null; mock.cs.channels.filter((c) => c.id === 'messenger' || c.id === 'instagram').forEach((c) => Object.assign(c, { status: 'disconnected', number: null, since: null, meta: {}, updated_at: now }));
        logRow('cs.channel.disconnect', 'messenger', null); return json(200, { result: 'ok', linked: false, channels: chans() });
      }
      if (!canReply) return json(401, { error: 'unauthorized' });
      if (action === 'send' || action === 'comment_private') {
        const m = mock.cs.messages.find((x) => x.id === b.message_id); if (!m) return json(404, { error: 'not_found' });
        if (m.kind !== 'out' || m.delivery !== 'queued') return json(409, { error: 'not_queued', delivery: m.delivery });
        if (!isAdmin(u) && m.author !== u.id) return json(401, { error: 'unauthorized' });
        const v = mock.cs.conversations.find((x) => x.id === m.conversation_id); if (!v || !['messenger', 'instagram'].includes(v.channel)) return json(400, { error: 'bad_request', field: 'channel' });
        if (!M.linked) return json(503, { error: 'not_linked' });
        if (action === 'comment_private' && v.seg !== 'comments') return json(400, { error: 'bad_request', field: 'conversation' });
        if (/ارفض/.test(m.text)) { m.delivery = 'failed'; m.meta = { ...m.meta, error: 'graph_10:2018278' }; logRow('cs.channel.failed', v.id, 'graph_10:2018278'); return json(502, { error: 'graph_10:2018278', status: 400, delivery: 'failed' }); }
        m.delivery = 'sent'; m.external_id = 'm_mock_' + m.id.slice(-4); if (action === 'comment_private') m.meta = { ...m.meta, private: true };
        logRow(action === 'comment_private' ? 'cs.channel.private' : 'cs.channel.send', v.id, v.platform);
        return json(200, { result: 'ok', delivery: 'sent', external_id: m.external_id, private: action === 'comment_private' });
      }
      const v = mock.cs.conversations.find((x) => x.id === b.conversation_id); if (!v) return json(404, { error: 'not_found' });
      if (v.seg !== 'comments') return json(400, { error: 'bad_request', field: 'conversation' });
      if (!M.linked) return json(503, { error: 'not_linked' });
      const last = mock.cs.messages.filter((x) => x.conversation_id === v.id && x.kind === 'in').pop();
      csSeq += 1; mock.cs.messages.push({ id: 'd1000000-0000-4000-8000-' + String(csSeq).padStart(12, '0'), conversation_id: v.id, kind: 'event', text: 'التعليق اتخفى من على البوست', author: u.id, external_id: null, delivery: null, meta: { hidden: last ? last.external_id : null }, created_at: now });
      v.updated_at = now; logRow('cs.channel.hide', v.id, v.platform);
      return json(200, { result: 'ok', hidden: last ? last.external_id : null });
    }
    if (method === 'POST' && path === '/functions/v1/ai-content') {
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      // phase 12 T1: the header's assistant — any active member; the answer is mock.aiAnswer('assistant', req) → { text, actions } (else a
      // stock line with no action); mock.aiFail applies; one ai_runs row (action assistant, source = the mode)
      if (action === 'assistant') {
        if (!u || u.status !== 'active') return json(401, { error: 'unauthorized' });
        const turns = Array.isArray(b.turns) ? b.turns : []; const last = turns[turns.length - 1];
        if (!turns.length || !last || last.role !== 'user' || typeof last.text !== 'string' || !last.text.trim()) return json(400, { error: 'bad_request', field: 'turns' });
        const mode = b.mode === 'filter' ? 'filter' : 'chat';
        const req = { mode, turns, question: last.text.trim(), context: b.context && typeof b.context === 'object' ? b.context : {} };
        mock.aiCalls.push({ action, by: u.email, ...b });
        const base = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: 'assistant', source: mode, label: req.question.slice(0, 200), model: 'claude-opus-5-5', cost_usd: 0, output: null };
        const fail = mock.aiFail;
        if (fail === 'not_configured' || fail === 'busy' || fail === 'ai_error') { mock.aiRuns.push({ ...base, status: 'error', error: fail }); return json(fail === 'not_configured' ? 503 : fail === 'busy' ? 429 : 502, { error: fail }); }
        if (fail === 'ai_cap') { mock.aiRuns.push({ ...base, status: 'cap', error: 'ai_cap' }); return json(402, { error: 'ai_cap' }); }
        const a = typeof mock.aiAnswer === 'function' ? mock.aiAnswer('assistant', req) : null;
        const out = { text: a && typeof a.text === 'string' ? a.text : (mode === 'filter' ? '' : 'تمام.'), actions: a && Array.isArray(a.actions) ? a.actions : [], tools: a && Array.isArray(a.tools) ? a.tools : [] };
        const report = a && Array.isArray(a.report) ? a.report : []; // decision 23: the reads for «تفاصيل» — never in ai_runs
        const run = { ...base, status: 'ok', error: null, input_tokens: 3000, output_tokens: 400, cost_usd: 0.02, output: out };
        mock.aiRuns.push(run);
        return json(200, { result: 'ok', ...out, report, model: 'claude-opus-5-5', cost_usd: 0.02, run_id: run.id });
      }
      const may = u && (action === 'write' ? isAdmin(u) || hasPerm(u, 'products.add') === 'F' || hasPerm(u, 'products.edit') === 'F' : action === 'studio' || action === 'prompts' ? isAdmin(u) || hasPerm(u, 'products.add') === 'F' : isAdmin(u));
      if (!may) return json(401, { error: 'unauthorized' });
      if (!['write', 'studio', 'prompts'].includes(action)) return json(400, { error: 'unknown_action' });
      const parsed = action === 'write' ? parseWrite(b) : action === 'prompts' ? parsePrompts(b) : parseStudio(b);
      if (parsed.error) return json(400, parsed);
      const req = parsed.req;
      mock.aiCalls.push({ action, by: u.email, ...b });
      let item = null; let row = null;
      if (action === 'write' && req.source === 'product' && !mock.products.some((p) => Number(p.id) === req.productId)) return json(404, { error: 'not_found' });
      if (action === 'studio') { row = mock.studioBatches.find((x) => x.id === req.batchId); item = row && !row.archived_at && row.state && Array.isArray(row.state.items) ? row.state.items[req.index] : null; if (!item) return json(404, { error: 'not_found' }); }
      // decision 13: the template's rows (source_node set) are never written over by the AI
      if (action === 'prompts' && mock.shotPrompts.some((x) => x.category === req.category && x.source_node)) return json(409, { error: 'exists', category: req.category });
      // decision 8: the settings row «ai» picks the model and the cap (the server reads it before every call; no secrets here)
      const cfg = aiSettings((mock.settings.find((s) => s.section === 'ai') || {}).data, {});
      const model = cfg.model; const cost = model === 'claude-sonnet-5-5' ? 0.026 : 0.052;
      const base = { id: mock.aiRuns.length + 1, created_at: new Date().toISOString(), created_by: u.id, action: action === 'prompts' ? 'studio' : action, source: action === 'studio' || action === 'prompts' ? 'studio' : req.source, label: action === 'prompts' ? req.category : action === 'studio' ? (item.nameEn || item.nameAr || '#' + (req.index + 1)) : ((req.source === 'product' ? (mock.products.find((p) => Number(p.id) === req.productId) || {}).name : req.data.name) || null),
        product_id: req.productId || null, batch_id: action === 'studio' ? req.batchId : null, item_index: action === 'studio' ? req.index : null, model, cost_usd: 0, output: null };
      const spent = mock.aiRuns.reduce((t, x) => t + (Number(x.cost_usd) || 0), 0);
      if (cfg.cap != null && spent + 0.5 > cfg.cap) { mock.aiRuns.push({ ...base, status: 'cap', error: 'ai_cap' }); return json(402, { error: 'ai_cap' }); }
      const fail = mock.aiFail;
      if (fail === 'not_configured' || fail === 'busy' || fail === 'ai_error') { mock.aiRuns.push({ ...base, status: 'error', error: fail }); return json(fail === 'not_configured' ? 503 : fail === 'busy' ? 429 : 502, { error: fail }); }
      if (fail === 'ai_cap') { mock.aiRuns.push({ ...base, status: 'cap', error: 'ai_cap' }); return json(402, { error: 'ai_cap' }); }
      if (fail === 'refused') { mock.aiRuns.push({ ...base, status: 'refused', error: 'refused', cost_usd: 0.004 }); return json(200, { result: 'refused', model, cost_usd: 0.004 }); }
      const SAMPLE = { ar: { name: 'مراية بامبو بوهيمي', short: 'مراية من البامبو الطبيعي تضيف للحيطة روح بوهيمية دافية.', long: 'مصنوعة يدويًا من البامبو الطبيعي.\n\nتنفع للمدخل أو ركن التجهيز.', keywords: ['مرايا بامبو', 'ديكور بوهيمي', 'مرايا حائط'], bullets: ['بامبو طبيعي', 'شغل إيد', 'ستايل بوهيمي', 'سهلة التعليق', 'لون بيج'], seo_title: 'مرايا بامبو بوهيمي | Alaa Anas — إبتكر كلوب', seo_description: 'مراية بامبو طبيعي بستايل بوهيمي، شغل إيد من Alaa Anas — تضيف دفا لأي حيطة.' },
        en: { name: 'Boho Bamboo Mirror', short: 'A natural bamboo mirror that brings a warm bohemian note to the wall.', long: 'Handmade from natural bamboo.\n\nMade for an entrance or a dressing corner.', keywords: ['bamboo mirror', 'boho wall decor', 'handmade mirror'], bullets: ['Natural bamboo', 'Handmade', 'Bohemian style', 'Easy to hang', 'Beige'], seo_title: 'Boho Bamboo Mirror | Alaa Anas — Ibtekr Club', seo_description: 'A handmade natural bamboo mirror in a bohemian style by Alaa Anas — warmth for any wall.' } };
      const cats = mock.wooCategories.map((c) => Number(c.id));
      const PROMPTS = { shot1: 'A professional product photograph of the exact ' + req.category + ' from the reference, kept completely identical, centered on a warm cream studio background, soft window light.', shot2: 'A lifestyle photograph of the exact same ' + req.category + ' from the reference, kept completely identical, in its place in a warm modern Egyptian home, afternoon daylight.', shot3: 'A close-up detail photograph of the exact same ' + req.category + ' from the reference, kept completely identical: material, craft and texture, shallow depth of field.', negative: 'text, logos, watermarks, people, hands' };
      const answer = typeof mock.aiAnswer === 'function' ? mock.aiAnswer(action, req, item) : action === 'write' ? SAMPLE : action === 'prompts' ? PROMPTS
        : { nameEn: item.nameEn || 'Bamboo Desk Lamp', nameAr: 'أباجورة مكتب بامبو', shortDesc: 'A warm bamboo desk lamp.', shortDescAr: 'أباجورة مكتب من البامبو بإضاءة دافية.', categories: cats.slice(0, 1), colors: ['BE'], sizes: [] };
      const cleaned = action === 'write' ? cleanWrite(answer, req.outputs, req.langs) : action === 'prompts' ? cleanPrompts(answer) : cleanStudio(answer, req.want, { categoryIds: new Set(cats), colorCodes: new Set(mock.skuColors.map((c) => c.code)) });
      const run = { ...base, status: 'ok', error: null, input_tokens: 3000, output_tokens: 2000, cost_usd: cost, output: cleaned };
      mock.aiRuns.push(run);
      if (action === 'prompts' && cleaned.prompts.length === 3) {
        // the server: upsert on (category, shot) — the AI's rows carry no source_node
        for (const r of shotPromptRows(req.category, cleaned.prompts, u.id, new Date().toISOString())) { const old = mock.shotPrompts.find((x) => x.category === r.category && x.shot === r.shot); if (old) Object.assign(old, r); else mock.shotPrompts.push({ id: mock.shotPrompts.length + 1, ...r }); }
        cleaned.category = req.category; cleaned.rows = 3;
      }
      return json(200, { result: 'ok', ...cleaned, model, cost_usd: cost, run_id: run.id });
    }
    if (method === 'POST' && path === '/functions/v1/woo-sync') {
      if (mock.functionsDown) return route.abort('failed'); // the function never answers (review I-1): the adapter queues through the RPC
      const u = tokenUser(); const b = body(); const action = typeof b.action === 'string' ? b.action : '';
      const CONTACT_PUSH = ['phone', 'email', 'contact_name', 'address_parts', 'social']; // vendors.edit = P may push these alone (the guard's contact rule)
      const rateAsked = () => Array.isArray(b.fields) && b.fields.some((f) => f === 'rate' || f === 'category_rates');
      // phase 3.5: `bank` needs sensitive.vendor_bank = F; alone it needs no vendors.edit
      const bankAsked = () => Array.isArray(b.fields) && b.fields.includes('bank'); const storeAsked = () => (Array.isArray(b.fields) ? b.fields : []).filter((f) => f !== 'bank');
      const mayPushVendor = () => isAdmin(u) || ((!bankAsked() || hasPerm(u, 'sensitive.vendor_bank') === 'F')
        && (storeAsked().length === 0 ? bankAsked() : (hasPerm(u, 'vendors.edit') === 'F' || (hasPerm(u, 'vendors.edit') === 'P' && storeAsked().every((f) => CONTACT_PUSH.includes(f)))))
        && (!rateAsked() || hasPerm(u, 'sensitive.commission') === 'F'));
      // phase 13 decision 51: vendor_photo — the admin or vendors.edit F; the object in vendor-photos under the maker's folder; recorded on the
      // maker; a store + WOO_PUSH_ENABLED → site ok (the store photo), else skipped with the reason; mock.photoSiteFails → 502 saved
      if (action === 'vendor_photo') {
        if (!u || !(isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F')) return json(401, { error: 'unauthorized' });
        const v = mock.vendors.find((x) => x.id === String(b.vendor_id || '').toLowerCase()); const key = String(b.path || '');
        if (!v || key.split('/')[0] !== v.id) return json(400, { error: 'bad_request', field: 'path' });
        if (!mock.vendorPhotos.has(key)) return json(404, { error: 'not_found', field: 'path' });
        v.photo_path = key; const rec = { vendor_id: v.id, path: key, by: u.email }; mock.photoCalls.push(rec);
        if (!v.woo_vendor_id || !mock.pushEnabled) { rec.site = 'skipped'; return json(200, { action, result: 'ok', site: 'skipped', reason: v.woo_vendor_id ? 'push_disabled' : 'no_store' }); }
        if (mock.photoSiteFails) { rec.site = 'failed'; return json(502, { error: 'woo_error', action, saved: true }); }
        rec.site = 'ok'; return json(200, { action, result: 'ok', site: 'ok', media: 900 + mock.photoCalls.length });
      }
      // the owner, 11 Nov: vendor_store — a maker without a store gets one on the site (Dokan «Add New Vendor»): the admin or vendors.edit F;
      // his portal login (username / e-mail), the typed password (checked, never kept: only its length is recorded), the shop URL, the
      // commission for the admin / sensitive.commission F, the bank for the admin / sensitive.vendor_bank F; the row is linked to the new
      // store id (mock.nextStore, 900+). mock.storeRefuse = 'login_taken' | 'email_taken' | 'shop_url_taken' → 409; wooDown → 502.
      if (action === 'vendor_store') {
        if (!u || !(isAdmin(u) || hasPerm(u, 'vendors.edit') === 'F')) return json(401, { error: 'unauthorized' });
        const v = mock.vendors.find((x) => x.id === String(b.vendor_id || '').toLowerCase()); if (!v) return json(404, { error: 'vendor_not_found' });
        const pw = typeof b.password === 'string' ? b.password : '';
        if (pw.length < 8 || pw.length > 64 || /\s/.test(pw) || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return json(400, { error: 'bad_request', field: 'password' });
        if (b.shop_url !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(String(b.shop_url))) return json(400, { error: 'bad_request', field: 'shop_url' });
        if (v.woo_vendor_id != null) return json(409, { error: 'has_store' });
        const login = (mock.vendorLogins || []).find((l) => l.vendor_id === v.id);
        if (!login || !login.username) return json(409, { error: 'no_login' });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error', action });
        if (mock.storeRefuse) return json(409, { error: mock.storeRefuse });
        const commission = isAdmin(u) || hasPerm(u, 'sensitive.commission') === 'F'; const bank = (isAdmin(u) || hasPerm(u, 'sensitive.vendor_bank') === 'F') && (mock.vendorBank || []).some((x) => x.vendor_id === v.id);
        mock.nextStore = (mock.nextStore || 900) + 1; const store = mock.nextStore;
        const shop = String(b.shop_url || String(login.username).replace(/[._]+/g, '-'));
        (mock.storeCalls = mock.storeCalls || []).push({ vendor_id: v.id, by: u.email, username: login.username, email: login.email || v.email, pwLength: pw.length, shop_url: shop, notify: b.notify !== false, trusted: b.trusted === true, featured: b.featured === true, commission, bank, store });
        v.woo_vendor_id = store; v.woo_synced_at = new Date().toISOString(); v.push_pending = null;
        return json(200, { action, result: 'ok', store, adopted: false, commission, bank, photo: 'none', shop_url: 'https://woo.test/store/' + shop + '/' });
      }
      if (!u || !(action === 'push_status' ? hasPerm(u, 'orders.status') === 'F' : (action === 'order_trash' || action === 'suborder_trash' || action === 'line_trash' || action === 'suborder_status') ? hasPerm(u, 'orders.status') === 'F' && hasPerm(u, 'orders.view') !== 'N' : (action === 'order_create' || action === 'order_pay_link') ? (isAdmin(u) || hasPerm(u, 'orders.status') === 'F') : action === 'push_vendor' ? mayPushVendor() : (action === 'statement' || action === 'withdrawals') ? hasPerm(u, 'accounts.view') !== 'N' : action === 'withdraw_approve' || action === 'withdraw_create' ? (isAdmin(u) || hasPerm(u, 'accounts.approve') === 'F')
        : action === 'product_get' ? hasPerm(u, 'products.view') !== 'N' : action === 'product_save' || action === 'product_images_add' ? (isAdmin(u) || hasPerm(u, 'products.edit') === 'F') : action === 'products_batch' || action === 'products_vendor' ? (isAdmin(u) || hasPerm(u, 'products.bulk') === 'F')
          : action === 'products_trash' || action === 'products_restore' ? hasPerm(u, 'products.trash') === 'F' : action === 'studio_upload' || action === 'category_create' || action === 'studio_sheet' || action === 'product_duplicate' || action === 'category_get' || action === 'category_update' || action === 'category_delete' ? (isAdmin(u) || hasPerm(u, 'products.add') === 'F') : isAdmin(u))) return json(401, { error: 'unauthorized' });
      // phase 5.2: studio_upload — the item read from the batch and checked by the server's own buildStudio; the gate; a product
      // (draft, the mirror row) per item, the result on the batch; mock.studioFail = { [index]: 'product_invalid_sku' } refuses one;
      // mock.studioArFail = { [index]: true } refuses its Arabic translation only (arNote / arError on the result);
      // mock.studioAuthorFail = { [index]: true } answers author 'failed' (the translation's maker did not stick). The maker as the
      // server keeps it (authorOwner = the batch maker's woo_vendor_id): a retry on another maker moves a product with no variation
      // made (its mirror row's vendor_id), and refuses one with them (maker_changed, the record kept). The SKU as the server keeps it:
      // a retry whose item builds another SKU than the product's is refused (brand_changed / sku_changed, the record kept). The
      // product carries the site's WooCommerce brand named like the batch's (matchWooBrand over mock.wooBrands; none = wooBrand null).
      // category_create — a new woo_categories row (id 9500+). studio_sheet (decision 13) — the server's own sheetCsvUrl check
      // (400 bad_link), then mock.sheetLinks[url] = { csv } | { reason } (else not_published); mock.sheetReads lists the links.
      if (action === 'studio_sheet') {
        if (!sheetCsvUrl(b.url)) return json(400, { error: 'bad_link', field: 'url' });
        mock.sheetReads.push(b.url);
        const hit = (mock.sheetLinks || {})[b.url];
        return json(200, hit && typeof hit.csv === 'string' ? { action, result: 'ok', csv: hit.csv } : { action, result: 'error', reason: (hit && hit.reason) || 'not_published' });
      }
      if (action === 'studio_upload') {
        const row = mock.studioBatches.find((x) => x.id === b.batch_id); const it = row && row.state && Array.isArray(row.state.items) ? row.state.items[b.index] : null;
        if (!row || !it) return json(404, { error: 'no_item' });
        const brand = mock.brands.find((x) => x.id === row.brand_id);
        const wooBrand = matchWooBrand(brand, mock.wooBrands); // the server's rule: the site's WooCommerce brand named like ours
        const built = buildStudio(it, { batchId: row.id, type: row.type, brand: brand ? brand.name : '', wooBrand, colors: Object.fromEntries(mock.skuColors.map((c) => [c.code, c.name_en])), attrs: { color: 12, size: 3, material: 15, style: 14, brand: 13 } });
        if (built.error) return json(400, built);
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        const items = row.result && Array.isArray(row.result.items) ? row.result.items.slice() : [];
        const fail = (mock.studioFail || {})[b.index];
        const prev = items[b.index];
        // the SKU is fixed with the product (decision 2): a retry whose item builds another is refused, the record kept
        const changed = prev && prev.productId && typeof prev.sku === 'string' && prev.sku !== built.sku ? (prev.sku.slice(3, 5) === built.sku.slice(3, 5) ? 'sku_changed' : 'brand_changed') : null;
        let res;
        if (fail) res = { sku: built.sku, error: fail, media: {} };
        else if (changed) res = { ...prev, error: changed };
        else { const id = prev && prev.productId ? prev.productId : 7700 + mock.studioUploads.length;
          const mv = mock.vendors.find((x) => x.id === row.vendor_id); const owner = mv && mv.woo_vendor_id != null ? mv.woo_vendor_id : null;
          const was = prev && prev.productId && prev.authorOwner !== undefined ? prev.authorOwner : owner; const kept = was !== owner && !!(prev && prev.variations);
          if (prev && prev.productId && was !== owner && !kept) { const p = mock.products.find((x) => x.id === id); if (p) p.vendor_id = row.vendor_id; }
          if (!prev || !prev.productId) mock.products.push({ id, sku: built.sku, name: it.nameEn, image_url: null, permalink: SITE + '/product/studio-' + id + '/', vendor_id: row.vendor_id, price: null, status: 'draft', raw: { id }, updated_at: T0, lang: 'en', translation_ids: { en: id }, type: row.type === 'Variable' ? 'variable' : 'simple', regular_price: built.product.regular_price ? Number(built.product.regular_price) : null, sale_price: built.product.sale_price ? Number(built.product.sale_price) : null, stock_quantity: null, stock_status: 'instock', manage_stock: false, backorders: 'no', low_stock_amount: null, total_sales: 0, category_ids: it.categories, brand_ids: wooBrand ? [wooBrand] : [], image_count: built.images.length, weight: it.weight || null, featured: false, desc_filled: false, short_desc_filled: !!it.shortDesc, woo_modified_at: T0, trashed_at: null });
          const arFail = !!(mock.studioArFail || {})[b.index]; // the site refusing the translation (the live 422): the product stays, the translation waits for a retry
          res = { sku: built.sku, productId: id, arId: it.nameAr && !arFail ? id + 1 : null, ...(it.nameAr && !arFail ? { arAttrs: 'ok' } : {}), ...(arFail ? { arNote: 'wcml_invalid_language', arError: 'Language ar is not active.' } : {}), author: kept || (mock.studioAuthorFail || {})[b.index] ? 'failed' : 'ok', authorOwner: kept ? was : owner, wooBrand: prev && prev.productId && prev.wooBrand !== undefined ? prev.wooBrand : wooBrand,
            variations: kept ? prev.variations : built.variations.length ? { done: built.variations.length, failed: 0 } : undefined, media: Object.fromEntries(built.images.map((p, k) => [p, 8800 + k])), error: kept ? 'maker_changed' : null }; }
        mock.studioUploads.push({ index: b.index, by: u.email, maker: row.vendor_id, sku: built.sku, product: built.product, variations: built.variations.map((v) => v.payload), images: built.images, ar: built.ar, result: res.error || 'ok' });
        while (items.length < b.index) items.push(null); items[b.index] = res;
        row.result = { items }; row.status = row.state.items.every((_, i) => items[i] && items[i].productId && !items[i].error) ? 'done' : 'uploading';
        return json(200, { action, result: res.error ? 'error' : 'ok', item: res });
      }
      // B4: an image comes as { data: base64 } and the server checks its bytes (PNG / JPEG / WebP); categoriesCreated records image: true
      // (never the bytes); mock.catSite[id] = { ar, image, count } is what the site answers for a category (category_get / _update /
      // _delete — the Arabic name defaults to «<name> AR»); categoryWrites records each update / delete as the server would send them
      const catImage = (v) => { if (v === undefined || v === null) return null; if (!v || typeof v.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) return false;
        let bin = ''; try { bin = atob(v.data); } catch (e) { return false; } const c = (i) => bin.charCodeAt(i);
        return (c(0) === 0x89 && c(1) === 0x50) || (c(0) === 0xff && c(1) === 0xd8) || (bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP') ? true : false; };
      if (action === 'category_create') {
        const img = catImage(b.image); if (img === false) return json(400, { error: 'bad_request', field: 'image' });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        const id = 9500 + mock.wooCategories.length; mock.wooCategories.push({ id, name: b.name_en, slug: 'c-' + id, parent_id: b.parent || null, updated_at: T0 });
        const rec = { ...b, by: u.email }; delete rec.image; if (img) rec.image = true; mock.categoriesCreated.push(rec);
        (mock.catSite = mock.catSite || {})[id] = { ar: b.name_ar || null, image: img ? 'https://woo.test/cat-' + id + '.webp' : null, count: 0 };
        return json(200, { action, result: 'ok', id, ar_id: b.name_ar ? id + 1 : null, image: img ? 'https://woo.test/cat-' + id + '.webp' : null });
      }
      if (action === 'category_get' || action === 'category_update' || action === 'category_delete') {
        const cat = mock.wooCategories.find((x) => x.id === Number(b.id)); if (!cat) return json(404, { error: 'not_found' });
        const site = Object.assign({ ar: cat.name + ' AR', image: null, count: 0 }, (mock.catSite || {})[cat.id] || {});
        mock.categoryWrites = mock.categoryWrites || [];
        if (action === 'category_get') return json(200, { action, result: 'ok', category: { id: cat.id, name: cat.name, parent: cat.parent_id || 0, count: site.count, image: site.image }, ar: site.ar ? { id: cat.id + 1, name: site.ar, parent: 0, count: site.count, image: site.image } : null });
        if (action === 'category_update') {
          const img = catImage(b.image); const bad = (v) => v != null && v !== '' && (typeof v !== 'string' || !v.trim() || v.length > 80 || /[<>%]/.test(v));
          if (img === false || bad(b.name_en) || bad(b.name_ar) || (!b.name_en && !b.name_ar && !img)) return json(400, { error: 'bad_request' });
          if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
          if (b.name_en) cat.name = b.name_en; const had = !!site.ar; if (b.name_ar) site.ar = b.name_ar; if (img) site.image = 'https://woo.test/cat-' + cat.id + '-v2.webp';
          (mock.catSite = mock.catSite || {})[cat.id] = site;
          mock.categoryWrites.push({ action, id: cat.id, name_en: b.name_en || null, name_ar: b.name_ar || null, image: !!img, by: u.email });
          return json(200, { action, result: 'ok', id: cat.id, ar: b.name_ar || img ? (had ? 'ok' : 'made') : 'none', image: site.image });
        }
        const uses = mock.products.filter((p) => (p.category_ids || []).includes(cat.id)).length; const kids = mock.wooCategories.filter((x) => x.parent_id === cat.id).length;
        const makers = mock.vendors.filter((v) => (v.main_categories || []).includes(cat.id)).length;
        if (uses) return json(409, { error: 'has_products', count: uses });
        if (kids) return json(409, { error: 'has_children', count: kids });
        if (makers) return json(409, { error: 'has_makers', count: makers });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (site.count) return json(409, { error: 'has_products', count: site.count });
        mock.wooCategories.splice(mock.wooCategories.indexOf(cat), 1); mock.categoryWrites.push({ action, id: cat.id, by: u.email });
        return json(200, { action, result: 'ok', id: cat.id, ar: site.ar ? 'ok' : 'none' });
      }
      // phase 5: the product actions — productWrites records each write call ({ action, by, ...body }); mock.pushEnabled gates them;
      // the mirror rows follow what was written (prices as numbers, the trash / draft status)
      if (action === 'product_get') {
        const p = mock.products.find((x) => x.id === Number(b.id));
        if (!p) return json(502, { error: 'woo_error' });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        const ar = p.translation_ids && p.translation_ids.ar ? mock.products.find((x) => x.id === p.translation_ids.ar) : null;
        const term = (list, ids) => (ids || []).map((id) => ({ id, name: (list.find((x) => x.id === id) || {}).name || '' }));
        const str = (v) => (v == null ? '' : String(v));
        return json(200, { action, product: { id: p.id, name: p.name, sku: p.sku || '', status: p.status, type: p.type, lang: p.lang, translations: p.translation_ids || {}, permalink: p.permalink || '',
          regular_price: str(p.regular_price), sale_price: str(p.sale_price), price: str(p.sale_price ?? p.price), manage_stock: !!p.manage_stock, stock_quantity: p.stock_quantity, stock_status: p.stock_status, backorders: p.backorders,
          low_stock_amount: p.low_stock_amount, total_sales: p.total_sales, weight: p.weight || '', featured: !!p.featured, categories: term(mock.wooCategories, p.category_ids), brands: term(mock.wooBrands, p.brand_ids),
          images: Array.from({ length: p.image_count || 0 }, (_, i) => ({ id: 100 + i, src: p.image_url || '', name: 'img-' + i })), short_description: p.short_desc_filled ? 'وصف قصير' : '', description: p.desc_filled ? '<p>وصف</p>' : '', modified: p.woo_modified_at, store: { id: 44, shop_name: 'Store' },
          seo_title: str(p.seo_title), seo_description: str(p.seo_description), sizes: Array.isArray(p.sizes) ? p.sizes : [] },
          ar: ar ? { id: ar.id, name: ar.name, short_description: '', description: '', seo_title: str(ar.seo_title), seo_description: str(ar.seo_description), status: ar.status } : null,
          variations: p.type === 'variable' ? [{ id: 9901, sku: p.sku + '-R', attributes: [{ name: 'Color', option: 'Red' }], regular_price: '900', sale_price: '', price: '900', manage_stock: true, stock_quantity: 2, stock_status: 'instock', backorders: 'no', image: '' }] : [] });
      }
      // phase 5.4 (T8): product_images_add — the member's own ai-images objects (the admin any) onto the product: the gate, each
      // object must exist (404), the mirror's image_count grows (first = ahead); mock.productWrites records it; media ids 9000+
      if (action === 'product_images_add') {
        mock.productWrites = mock.productWrites || []; mock.productWrites.push({ action, by: u.email, ...b });
        const p = mock.products.find((x) => x.id === Number(b.id)); const paths = Array.isArray(b.paths) ? b.paths : [];
        if (!p || !Number.isInteger(Number(b.id))) return json(400, { error: 'bad_request', field: 'id' });
        if (!paths.length || paths.length > 10 || !paths.every((k) => typeof k === 'string' && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.(webp|png|jpe?g)$/i.test(k))) return json(400, { error: 'bad_request', field: 'paths' });
        if (!isAdmin(u) && !paths.every((k) => k.startsWith(u.id + '/'))) return json(401, { error: 'unauthorized' });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (!paths.every((k) => mock.imgObjects.has(k))) return json(404, { error: 'not_found', field: 'paths' });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        const media = paths.map((_, i) => 9000 + (mock.productWrites.length * 10) + i);
        p.image_count = (p.image_count || 0) + paths.length; if (b.first === true && !p.image_url) p.image_url = 'https://ibtekr.stage.test/wp-content/uploads/ai.webp';
        return json(200, { action, result: 'ok', media, count: media.length, images: p.image_count });
      }
      // phase 12 T2: product_duplicate — a draft copy row (and its Arabic row) in the mirror under a new SKU from the serial; the gate
      if (action === 'product_duplicate') {
        mock.productWrites = mock.productWrites || []; mock.productWrites.push({ action, by: u.email, id: b.id });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        const src = mock.products.find((x) => x.id === Number(b.id)); if (!src || mock.wooDown) return json(502, { error: 'woo_error' });
        const serial = mock.skuSerial; mock.skuSerial += 1; mock.serialTakes.push(1);
        const m = /^IBT([A-Z]{2})([A-Z]{2})?(\d{4,})(-\d+)?$/.exec(src.sku || ''); const sku = m ? 'IBT' + m[1] + (m[2] || '') + String(serial).padStart(4, '0') + (m[4] || '') : (src.sku ? src.sku + '-' + String(serial).padStart(4, '0') : null);
        const nid = Math.max(...mock.products.map((x) => Number(x.id))) + 1;
        const arSrc = src.translation_ids && src.translation_ids.ar ? mock.products.find((x) => x.id === src.translation_ids.ar) : null;
        const arId = arSrc ? nid + 1 : null;
        const copy = { ...src, id: nid, sku, name: src.name + ' (نسخة)', status: 'draft', permalink: null, total_sales: 0, translation_ids: arId ? { en: nid, ar: arId } : { en: nid }, raw: { id: nid }, updated_at: new Date().toISOString() };
        mock.products.push(copy);
        if (arSrc) mock.products.push({ ...arSrc, id: arId, sku, name: arSrc.name + ' (نسخة)', status: 'draft', permalink: null, total_sales: 0, translation_ids: { en: nid, ar: arId }, raw: { id: arId } });
        return json(200, { action, result: 'ok', id: nid, sku, variations: src.type === 'variable' ? { done: 2, failed: 0 } : null, ar: arId, ar_code: null, author: 'ok' });
      }
      if (action === 'product_save' || action === 'products_batch' || action === 'products_vendor' || action === 'products_trash' || action === 'products_restore') {
        mock.productWrites = mock.productWrites || [];
        mock.productWrites.push({ action, by: u.email, ...b });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        if (action === 'products_vendor') {
          // the owner (1 Nov): the maker on the site (Dokan's post_author) — the product and its translation follow in the mirror
          const v = mock.vendors.find((x) => x.id === b.vendor_id); if (!v) return json(404, { error: 'not_found' }); if (!v.woo_vendor_id) return json(409, { error: 'no_store' });
          for (const id of b.ids || []) { const p = mock.products.find((x) => x.id === Number(id)); const ar = p && p.translation_ids && p.translation_ids.ar ? mock.products.find((x) => x.id === p.translation_ids.ar) : null; for (const x of [p, ar].filter(Boolean)) x.vendor_id = v.id; }
          return json(200, { action, result: 'ok', counts: { moved: (b.ids || []).length, failed: 0 }, failed_ids: [] });
        }
        const NUMS = ['regular_price', 'sale_price']; const apply = (p, f) => { for (const [k, v] of Object.entries(f || {})) { if (k === 'categories') p.category_ids = v.map(Number); else if (k === 'brands') p.brand_ids = v.map(Number); else if (k === 'images') p.image_count = v.length; else if (NUMS.includes(k)) p[k] = v === '' ? null : Number(v); else p[k] = v; } };
        const withAr = (id) => { const p = mock.products.find((x) => x.id === Number(id)); const ar = p && p.translation_ids && p.translation_ids.ar ? mock.products.find((x) => x.id === p.translation_ids.ar) : null; return [p, ar]; };
        if (action === 'product_save') {
          const [p, ar] = withAr(b.id); if (!p) return json(502, { error: 'woo_error' });
          if (b.ar && Object.keys(b.ar).length && !ar) return json(409, { error: 'no_translation' });
          // the shared fields (status, prices, stock — SHARED_FIELDS in woo-products.js) go to the translation too, with its own fields
          const SHARED = ['status', 'regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders', 'low_stock_amount'];
          apply(p, b.fields); if (ar) apply(ar, Object.assign(Object.fromEntries(Object.entries(b.fields || {}).filter(([k]) => SHARED.includes(k))), b.ar || {}));
          return json(200, { action, result: 'ok', counts: { saved: ar ? 2 : 1, variations: (b.variations || []).length, variations_failed: 0 } });
        }
        if (action === 'products_batch') {
          const ids = (b.update || []).map((x) => Number(x.id));
          for (const it of b.update || []) { const [p] = withAr(it.id); if (p) { const { id: _i, ...rest } = it; apply(p, rest); } }
          return json(200, { action, result: 'ok', counts: { updated: ids.length, failed: 0, translations: 0 }, failed_ids: [] });
        }
        for (const id of b.ids || []) { const [p, ar] = withAr(id); for (const x of [p, ar].filter(Boolean)) { x.status = action === 'products_trash' ? 'trash' : 'draft'; x.trashed_at = action === 'products_trash' ? new Date().toISOString() : null; } }
        return json(200, { action, result: 'ok', counts: { done: (b.ids || []).length, failed: 0 }, failed_ids: [] });
      }
      // phase 4.1 decision 12: «تحديث من Dokan» — mock.dokanNewRequests (a spec may seed them) join the mirror now
      if (action === 'withdrawals') {
        mock.refreshes = (mock.refreshes || 0) + 1;
        if (mock.wooDown) return json(502, { error: 'sync_failed', action });
        for (const w of mock.dokanNewRequests || []) if (!mock.acc.dokan_withdrawals.some((x) => x.id === w.id)) mock.acc.dokan_withdrawals.push({ ...w });
        return json(200, { action, result: 'ok', counts: { withdrawals: mock.acc.dokan_withdrawals.length, skipped: 0, failed_rows: 0, pages: 1, done: true } });
      }
      // phase 4.1: approve a pending Dokan request — the mirror row follows; WOO_PUSH_ENABLED (mock.pushEnabled) gates it
      if (action === 'withdraw_approve') {
        const id = Number(b.id); const w = mock.acc.dokan_withdrawals.find((x) => Number(x.id) === id);
        const done = (result, reason) => { mock.approvals.push({ id, by: u.email, result, ...(reason ? { reason } : {}) }); return json(200, { action, result, ...(reason ? { reason } : {}), status: w ? w.status : null }); };
        if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request' });
        if (!w) return json(404, { error: 'withdraw_not_found' });
        if (w.status !== 'pending') return done('skipped', 'not_pending');
        if (!mock.pushEnabled) return done('skipped', 'push_disabled');
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        w.status = 'approved'; w.synced_at = new Date().toISOString();
        // Dokan lowers the maker's balance; 0078: the maker's open moves settle against the request (acc_settle_withdrawal's rule)
        const balRow = mock.acc.dokan_balances.find((x) => x.vendor_id === w.vendor_id); if (balRow && balRow.balance != null) balRow.balance = Math.round((Number(balRow.balance) - Number(w.amount)) * 100) / 100;
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const open = mock.acc.acc_vendor_moves.filter((m) => m.vendor_id === w.vendor_id && !m.voided_at && m.settled_by == null && String(m.on_date) <= day);
        const net = open.reduce((x, m) => x + (m.direction === 'withdraw' ? Number(m.amount) : -Number(m.amount)), 0);
        const last = mock.acc.acc_vendor_settlements.filter((x) => x.vendor_id === w.vendor_id).sort((a, c) => a.id - c.id).pop(); const cin = last ? Number(last.carry_out) : 0;
        const op = Math.round((net + cin) * 100) / 100; const cons = op > 0 ? Math.min(Number(w.amount), op) : op;
        open.forEach((m) => { m.settled_by = id; m.settled_at = new Date().toISOString(); });
        const st = { id: mock.acc.acc_vendor_settlements.length + 1, withdraw_id: id, vendor_id: w.vendor_id, amount: Number(w.amount), moves_net: Math.round(net * 100) / 100, carry_in: cin, consumed: cons,
          carry_out: Math.round((op - cons) * 100) / 100, cash: Math.round((Number(w.amount) - cons) * 100) / 100, moves: open.length, source: 'system', approved_by: u.id, settled_on: day, created_at: new Date().toISOString() };
        mock.acc.acc_vendor_settlements.push(st);
        mock.approvals.push({ id, by: u.email, result: 'ok' });
        return json(200, { action, result: 'ok', status: 'approved', settlement: { amount: st.amount, consumed: st.consumed, cash: st.cash, carry_out: st.carry_out, moves: st.moves } });
      }
      // 0078: «اعمل طلب السحب على Dokan» — the maker's whole Dokan balance, pending; never with a pending one; WOO_PUSH_ENABLED
      if (action === 'withdraw_create') {
        const vid = String(b.vendor_id || '').toLowerCase(); const v = mock.vendors.find((x) => x.id === vid);
        const rec = { vendor_id: vid, by: u.email };
        const done = (status, payload) => { Object.assign(rec, payload); mock.withdrawCreates.push(rec); return json(status, { action, ...payload }); };
        if (!v) return json(404, { error: 'vendor_not_found' });
        if (!v.woo_vendor_id) return done(409, { result: 'refused', reason: 'no_store', error: 'no_store' });
        const open = mock.acc.dokan_withdrawals.find((x) => Number(x.woo_vendor_id) === Number(v.woo_vendor_id) && x.status === 'pending');
        if (open) return done(200, { result: 'skipped', reason: 'pending_exists', id: open.id });
        if (!mock.pushEnabled) return done(200, { result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        if (mock.withdrawRefuse) return done(409, { result: 'refused', reason: mock.withdrawRefuse });
        const balRow = mock.acc.dokan_balances.find((x) => x.vendor_id === vid); const amount = balRow && Number(balRow.balance) > 0 ? Math.floor(Number(balRow.balance) * 100) / 100 : 0;
        if (!(amount > 0)) return done(200, { result: 'skipped', reason: 'no_balance', balance: balRow ? balRow.balance : null });
        const nid = Math.max(700, ...mock.acc.dokan_withdrawals.map((x) => Number(x.id))) + 1;
        mock.acc.dokan_withdrawals.push({ id: nid, woo_vendor_id: Number(v.woo_vendor_id), vendor_id: vid, amount, charge: 0, receivable: amount, status: 'pending', method: 'bank', requested_at: new Date().toISOString().replace('T', ' ').slice(0, 19), synced_at: new Date().toISOString() });
        return done(200, { result: 'ok', id: nid, amount, status: 'pending' });
      }
      // phase 4: the maker's Dokan statement (read-only, not stored) — mock.statementRows for any range
      if (action === 'statement') {
        mock.statements.push({ vendor_id: b.vendor_id, from: b.from, to: b.to, by: u.email });
        const v = mock.vendors.find((x) => x.id === String(b.vendor_id || '').toLowerCase());
        if (!v) return json(404, { error: 'vendor_not_found' });
        if (v.woo_vendor_id == null) return json(200, { action, result: 'no_store', rows: [] });
        if (mock.wooDown || (mock.statementFail && mock.statementFail.has(v.id))) return json(502, { error: 'woo_error' });
        // phase 5.5 decision 13: the rows per maker ({ [vendor id]: rows }) or the same rows for every maker
        const rows = Array.isArray(mock.statementRows) ? mock.statementRows : (mock.statementRows[v.id] || []);
        return json(200, { action, result: 'ok', store: v.woo_vendor_id, from: b.from, to: b.to, rows, done: true });
      }
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
        v.woo_snapshot = { ...(v.woo_snapshot || {}), ...Object.fromEntries(sent.filter((f) => !['rate', 'category_rates', 'bank'].includes(f)).map((f) => [f, v[f] ?? null])) };
        return json(200, { action, result: 'ok', fields: sent, accepted: sent, refused: [], dropped: fields.filter((f) => !sent.includes(f)), counts: { pushed: 1 } });
      }
      if (mock.wooDown) return json(502, { error: 'woo_error' });
      // 0033 / phase 5.5 decision 10: order_trash — the cancelled order and its Dokan sub-orders to the site's trash (no force); not
      // «ملغي» → skipped/not_cancelled; pushEnabled off → skipped/push_disabled; wooDown → 502. Recorded in trashes.
      // phase 13 T3 (decision 7): an order from the chat (pending, unpaid) and the pay link of a pending order of that customer
      if (action === 'order_create') {
        const cu = mock.cs.customers.find((x) => x.id === b.customer_id && !x.merged_into); if (!cu) return json(404, { error: 'customer_not_found' });
        if (!Array.isArray(b.items) || !b.items.length) return json(400, { error: 'bad_request', field: 'items' });
        for (const it of b.items) { const p = mock.products.find((x) => x.id === Number(it.product_id) && !x.trashed_at); if (!p) return json(400, { error: 'bad_request', field: 'product', product_id: it.product_id }); }
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        const id = 190000 + mock.orderCreates.length + 1; const total = b.items.reduce((a, it) => { const p = mock.products.find((x) => x.id === Number(it.product_id)); return a + (p.sale_price != null ? p.sale_price : p.price || 0) * (Number(it.qty) || 1); }, 0);
        const now = new Date().toISOString(); // the same shape as ordersSeed's order() — pending and unpaid, the customer's row as the address
        const row = { id, number: String(id), customer_name: cu.name, customer_phone: cu.phone, customer_state: null, customer_city: cu.city || null, customer_address: cu.address || null, status: 'قيد الانتظار', woo_status: 'pending', payment_method: 'cod', payment_title: 'الدفع عند الاستلام', confirm: 'غير مؤكد', confirm_at: null, confirm_note: null, deposit: 0, currency: 'EGP', total, note: null, customer_note: b.note || null, cancel: null, ret: null, raw: { id }, placed_at: now, woo_updated_at: now, synced_at: now, created_at: now, updated_at: now };
        mock.orders.push(row); mock.orderCreates.push({ id, customer_id: cu.id, items: b.items, note: b.note || null, conversation_id: b.conversation_id || null, by: u.email });
        return json(200, { action, result: 'ok', id, number: String(id), payment_url: SITE + '/checkout/order-pay/' + id + '/?pay_for_order=true&key=wc_order_mock' + id });
      }
      if (action === 'order_pay_link') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id) && !x.deleted_at); if (!o) return json(404, { error: 'order_not_found' });
        if (b.customer_id) { const cu = mock.cs.customers.find((x) => x.id === b.customer_id); if (!cu || normPhone(cu.phone) !== normPhone(o.customer_phone)) return json(404, { error: 'order_not_found' }); }
        if (!['قيد الانتظار', 'فشل', 'معلّق'].includes(o.status)) return json(409, { error: 'not_payable', status: o.status });
        return json(200, { action, result: 'ok', id: o.id, number: String(o.number || o.id), url: SITE + '/checkout/order-pay/' + o.id + '/?pay_for_order=true&key=wc_order_mock' + o.id });
      }
      // phase 13 decision 54: suborder_trash — the server's own checks (closed / only_sub / push off), the sub-order trashed, its
      // lines flagged removed; the parent on the site is never written (the owner 11 Nov — its total stays, the answer's total null).
      // Recorded in subTrashes.
      if (action === 'suborder_trash') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id) && !x.deleted_at); if (!o) return json(404, { error: 'order_not_found' });
        const reason = typeof b.reason === 'string' ? b.reason.trim() : ''; if (!reason || reason.length > 120) return json(400, { error: 'bad_request' });
        if (['مكتمل', 'استرجاع'].includes(o.status)) return json(409, { error: 'closed', status: o.status });
        const so = mock.subOrders.find((x) => x.order_id === o.id && x.woo_order_id === Number(b.sub_id)); if (!so) return json(404, { error: 'sub_not_found' });
        const lines = mock.orderItems.filter((i) => i.order_id === o.id && !i.removed); const mine = lines.filter((i) => i.sub_order_id === so.id);
        if (!mine.length) return json(404, { error: 'sub_not_found' }); if (mine.length === lines.length) return json(409, { error: 'only_sub' });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error', step: 'trash' });
        so.woo_status = 'trash'; mine.forEach((i) => { i.removed = true; i.dropped_at = mock.now || new Date().toISOString(); i.pulled = false; });
        (mock.subTrashes = mock.subTrashes || []).push({ order_id: o.id, sub_id: so.woo_order_id, lines: mine.map((i) => i.id), reason, by: u.email });
        return json(200, { action, result: 'ok', lines: mine.length, already: false, released: 0, total: null });
      }
      // the owner 11 Nov: line_trash — one product off the order (its sub-order's last → only_in_sub, the order's last → only_line), the
      // line flagged removed (recorded in lineTrashes): off the sub-order only for an order with sub-orders (the parent untouched, total
      // null), off the order itself for an order of one maker (the total less it); suborder_status — a status_map slug on the sub-order
      if (action === 'line_trash') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id) && !x.deleted_at); if (!o) return json(404, { error: 'order_not_found' });
        const reason = typeof b.reason === 'string' ? b.reason.trim() : ''; if (!reason || reason.length > 120) return json(400, { error: 'bad_request' });
        if (['مكتمل', 'استرجاع'].includes(o.status)) return json(409, { error: 'closed', status: o.status });
        const lines = mock.orderItems.filter((i) => i.order_id === o.id && !i.removed); const it = lines.find((i) => i.id === Number(b.item_id));
        if (!it) return json(404, { error: 'line_not_found' }); if (lines.length === 1) return json(409, { error: 'only_line' });
        const so = mock.subOrders.find((x) => x.id === it.sub_order_id); const multi = !!so && so.woo_order_id !== o.id;
        if (multi && lines.filter((i) => i.sub_order_id === so.id).length === 1) return json(409, { error: 'only_in_sub', sub: so.woo_order_id });
        if (!multi && mock.subOrders.some((x) => x.order_id === o.id && x.woo_order_id !== o.id && x.woo_status !== 'trash')) return json(409, { error: 'sub_line', matches: 0 });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error', step: 'lines' });
        it.removed = true; it.pulled = false;
        if (multi) it.dropped_at = mock.now || new Date().toISOString(); else o.total = Number(o.total) - Number(it.total || 0);
        (mock.lineTrashes = mock.lineTrashes || []).push({ order_id: o.id, item_id: it.id, reason, by: u.email });
        return json(200, { action, result: 'ok', sub: multi ? so.woo_order_id : null, released: 0, total: multi ? null : o.total.toFixed(2) });
      }
      if (action === 'suborder_status') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id) && !x.deleted_at); if (!o) return json(404, { error: 'order_not_found' });
        if (Number(b.sub_id) === o.id) return json(400, { error: 'bad_request' });
        const so = mock.subOrders.find((x) => x.order_id === o.id && x.woo_order_id === Number(b.sub_id)); if (!so) return json(404, { error: 'sub_not_found' });
        if (!mock.statusMap.some((r) => r.woo_status && r.woo_status === b.status)) return json(400, { error: 'bad_status' });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled' });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        so.woo_status = b.status; (mock.subStatuses = mock.subStatuses || []).push({ order_id: o.id, sub_id: so.woo_order_id, status: b.status, by: u.email });
        return json(200, { action, result: 'ok', sub: so.woo_order_id, status: b.status });
      }
      if (action === 'order_trash') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id) && !x.deleted_at);
        if (!o) return json(404, { error: 'order_not_found' });
        if (o.status !== 'ملغي') return json(200, { action, result: 'skipped', reason: 'not_cancelled', counts: { trashed: 0, already: 0 } });
        if (!mock.pushEnabled) return json(200, { action, result: 'skipped', reason: 'push_disabled', counts: { trashed: 0, already: 0 } });
        if (mock.wooDown) return json(502, { error: 'woo_error' });
        const subs = mock.subOrders.filter((x) => x.order_id === o.id).map((x) => x.woo_order_id);
        o.woo_status = 'trash'; mock.subOrders.forEach((x) => { if (x.order_id === o.id) x.woo_status = 'trash'; });
        mock.trashes.push({ order_id: o.id, sub_orders: subs, by: u.email });
        return json(200, { action, result: 'ok', counts: { trashed: 1 + subs.length, already: 0 } });
      }
      if (action === 'push_status') {
        const o = mock.orders.find((x) => x.id === Number(b.order_id));
        if (!o) return json(404, { error: 'order_not_found' });
        // outgoingWooStatus (woo-core): a both / from_system row with a slug; a from_woo row («فشل») is never pushed
        const row = mock.statusMap.find((x) => x.system_status === b.status) || {};
        const slug = row.woo_status && ['both', 'from_system'].includes(row.direction || 'both') ? row.woo_status : null;
        const reason = b.status !== o.status ? 'stale' : !slug ? 'no_woo_status' : null;
        // the owner 11 Nov («زي الـ automation»): an order with Dokan sub-orders gets the status on each current one (the ones its live
        // lines point to), never the parent — recorded with subs
        const subs = reason ? [] : mock.subOrders.filter((x) => x.order_id === o.id && x.woo_order_id !== o.id && x.woo_status !== 'trash'
          && mock.orderItems.some((i) => i.order_id === o.id && !i.removed && i.sub_order_id === x.id));
        if (subs.length) {
          subs.forEach((x) => { x.woo_status = slug; }); const ids = subs.map((x) => x.woo_order_id);
          mock.pushes.push({ action, order_id: o.id, status: b.status, result: 'ok', subs: ids });
          return json(200, { action, result: 'ok', conflict: false, subs: ids, woo_status: slug, counts: { pushed: ids.length } });
        }
        if (!reason) o.woo_status = slug;
        mock.pushes.push({ action, order_id: o.id, status: b.status, result: reason ? 'skipped' : 'ok', ...(reason ? { reason } : {}) });
        return json(200, reason ? { action, result: 'skipped', reason, counts: { pushed: 0 } } : { action, result: 'ok', conflict: false, counts: { pushed: 1 } });
      }
      const hook = SUPABASE_URL + '/functions/v1/woo-webhook';
      // 'all' answers like woo-sync's pull(): each part's counts as its cursorPull / pullVendors return them (woo-write.js writeOrderPage)
      if (action === 'all') { mock.syncs.push({ action }); return json(200, { action, result: 'ok', counts: { vendors: { vendors: mock.vendors.length, pages: 1, done: true }, products: { products: mock.products.length, pages: 1, done: true }, orders: { orders: mock.orders.length, sub_orders: mock.subOrders.length, skipped: 0, conflicts: 0, pages: 1, done: true } } }); }
      // 'vendors' (plan 3.4 decision 10, «مزامنة دلوقتي»): mock.onVendorsSync(mock) plays the site's change and returns from_site
      if (action === 'vendors') {
        mock.syncs.push({ action });
        if (mock.wooDown) return json(502, { error: 'sync_failed', action, failed: ['vendors'], counts: {} });
        const fromSite = typeof mock.onVendorsSync === 'function' ? Number(mock.onVendorsSync(mock)) || 0 : 0;
        return json(200, { action, result: 'ok', counts: { vendors: { vendors: mock.vendors.length, from_site: fromSite, conflicts: 0, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0, removed: 0, back: 0, pages: 1, done: true } } });
      }
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
