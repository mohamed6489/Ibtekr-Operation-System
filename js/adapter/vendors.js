// Vendors (phase 3): the registry is the sync's `vendors` table (the Dokan stores, completed by the team), read with its
// rates (vendor_rates: a history with effective dates, readable with sensitive.commission = F) and bank rows (vendor_bank, one per
// vendor, readable with sensitive.vendor_bank = F) → the prototype's vendor shape (toVendor, pure) behind `store`, the same API
// block 28's vstore had (get / all / events / update / setRate / setBank / reveal / setContract / findByName / remove /
// restoreMoney / create) plus canEdit / canBank / canToggle / canRate (IBDirectory.perm) and actor() (the signed-in member).
// load() runs with the sign-in (IBDirectory.load) and after every write the server took (the server's row is the truth:
// timestamps, the rate trigger); state() is 'idle' | 'loading' | 'ready' | 'error', each change dispatches ib:vendors. A
// vendor_rates / vendor_bank read that is refused or empty is no error: the rates are «not visible» (rate null, the screen
// shows «—») and the bank is null. Reads name their columns (0011 grants are column lists: `*` and commission_pct are refused).
// Writes are write-through: the local copy changes first (validated like the prototype, VD.validateVendor; invalid → throws),
// the server write runs after; 42501 puts the old value back and announces ib:vendors with { id, reason: 'forbidden' }, a delete
// refused by orders is 'in_use', a storage refusal 'too_large' / 'bad_type', anything else 'network'. An update sends the changed
// columns only (the guard trigger checks per column), without .select(); an insert asks .select('id'). create() is the one
// asynchronous call (the id comes from the server): it resolves to the vendor or rejects with the reason's message (MESSAGES).
// Every write the server took is logged through IBActivity.log as vendor.* with entity 'vendor' / entity_id, and a value without
// PII (the changed fields by name, a status, a rate, a file type — never a phone or an IBAN). events(id) is that vendor's
// activity_log, loaded by loadEvents(id) when its drawer opens (and refreshed after each of its writes); reveal() logs
// vendor.reveal once per field per loadEvents (a redraw while the field stays shown is not a second reveal).
// setContract uploads to the private bucket vendor-contracts at <vendor uuid>/<unix ms>-<safe name> (upsert: false; the old file
// stays), then writes vendors.contract; contractUrl(id) is a 60 s signed URL. stats() gives block 28's per-vendor numbers from
// the loaded orders: a line's share is total − (total × its Dokan rate / 100 + fee) (order_items.commission_rate / fee, decision
// 4); a line without one uses our rate on the order's date when the rates are visible, else counts in full and is marked noRate.
// Balance in this phase = opening_balance (0 until the phase-4 import) + the shares of the completed orders.
// Phase 3.1 (decision 10): a vendor also carries `login` — its vendor_logins row (username, email, pwMode, status, mustChange,
// passwordSetAt, inviteSentAt, hasPassword) or null — read by column list without secret_id. create(input) runs vendors →
// vendor_rates (canRate) → vendor_logins (input.login) → rpc vendor_login_set_password (the temporary password — the only mode since
// 26 Oct, no invite link) → vendor_bank (canBank and input.bank); a step refused after the vendor's insert never undoes the vendor: the
// result is { vendor, missing: [...], reasons } so the page can say what is still missing. addLogin creates the row with its password
// (the same two steps), setLogin patches username / e-mail of an existing row, setLoginStatus writes
// invited / disabled (created_by on the insert is the member's name, like set_by / updated_by), setLoginPassword and revealPassword are the two RPCs (Promises; the server logs vendor.login.password /
// vendor.login.reveal itself, the password is never kept, logged or emitted here), usernameTaken is the local check (the server's
// unique index is the judge: 23505 → duplicate_username), canLogin = admin or vendors.edit = F, missing(id) lists what the maker
// still lacks (login, e-mail, bank — the bank only when the caller can see bank rows).
// Phase 3.2 (decisions 3 / 4): the brands. load() also reads brands + brand_owners (column lists) and brand_rates when the caller
// has sensitive.commission (refused / empty → no special rates known). A vendor carries `brands` (the brands he holds today:
// { id, name, code, aliases, since, returnOn, temp, rate, store, origin, owner, lastSince, back }) and `brandsEver` (those he held and
// holds no more: { …, until, now }). The owner of a brand on a date = the last history row that had started, else the first row
// (the server's brand_owner_at rule); the history and the rates are add-only on the server, so a transfer / return is a new row
// (transferBrand / returnBrand, two client events — one on each maker), a special rate a new dated row (setBrandRate), and
// addBrand / updateBrand write brands (an insert with .select('id'), a PATCH of the changed columns). The local refusals
// (a taken name, the same maker, a date before the last transfer, a return date before the start, a brand already with its
// owner) come before any request; the server's 22023 / 23505 / 23503 are mapped to the same messages (MESSAGES). A sub-order
// counts for the maker who owned its store's brand on the order's date (stats: storeOwnerAt(s.vendorId, o.date); the old
// match by name only for a sub without vendorId), and its share uses rateFor (the brand's special rate in force, else the
// owner's rate that day) — without any transfer or special rate the numbers are those of phase 3. A brand without a history
// row (an owner insert refused after the brand's) belongs to its origin until a row is written.
// Phase 3.3 (decision 5, the store data two-way with Dokan): the vendor shape gains the synced columns of 0014 — contactName,
// addressParts (the six Dokan keys), social (the eight keys, each https:// or ''), the read-only mirrors logoUrl / bannerUrl /
// wooPaymentMethods, wooSyncedAt and pushPending (field names waiting for the site), rateFlat (the flat fee shown with the rate; the
// history rows carry `flat`) and categoryRates (the per-category commission in force today, read from vendor_category_rates with
// sensitive.commission); categories() lists woo_categories for the pickers. A contact edit writes contact_name / address_parts /
// social and, with them, `address` (block 06 addressText — the server's rule) and `instagram` (= social.instagram, decision 1); then the
// row is pushed to the site: pushVendor(id, fields) = functions.invoke('woo-sync', { body: { action: 'push_vendor', vendor_id, fields } })
// with the member's session — the values pushed are the row's, the body names the fields only. Only the admin and vendors.edit = F may
// push (the server's rule, canPush): anyone else saves here and the result says 'no_permission' without a request; a maker without a
// store is 'no_store' without a request. The answers: ok (wooSyncedAt / pushPending refreshed by the reload), skipped (no_store /
// push_disabled / placeholder: saved, nothing more to say), an error (502 and the rest: MESSAGES.push_failed — the fields wait in
// push_pending for the next sync run). setRate carries an optional flat fee and pushes ['rate']; setCategoryRate inserts a dated
// vendor_category_rates row (rate null = removed from that date; unique (vendor, category, since) → 23505 category_duplicate) and
// pushes ['category_rates']. The server's vendor.sync / vendor.sync.conflict rows (actor null) read «اتعدل من الموقع: …» / «تعارض —
// الموقع كسب في: …» with the field labels of block 06. The screen never calls WooCommerce: every push is this one Edge Function.
(function () {
  'use strict';
  const PAGE = 1000; // PostgREST max_rows
  const COLS = {
    vendor: 'id, woo_vendor_id, name, aliases, phone, email, status, raw, created_at, updated_at, legal_name, category, alt_phone, address, instagram, store_url, lead_days, deposit_policy, notes, joined_at, contract, opening_balance, contact_name, address_parts, social, logo_url, banner_url, woo_payment_methods, push_pending, woo_synced_at', // 0014: never woo_snapshot (service_role only)
    rate: 'id, vendor_id, rate, flat, since, set_by, created_at',
    catRate: 'id, vendor_id, woo_category_id, rate, flat, since, set_by, created_at', // 0014 (phase 3.3): sensitive.commission
    category: 'id, name, slug, parent_id, updated_at', // 0014: woo_categories (vendors.view)
    bank: 'vendor_id, method, bank_name, holder, iban, wallet, updated_by, updated_at',
    login: 'vendor_id, username, email, pw_mode, status, must_change, invite_sent_at, password_set_at, created_by, created_at, updated_at', // never secret_id (server only)
    event: 'id, at, action, new_value, actor:profiles(name)',
    brand: 'id, name, code, aliases, store_vendor_id, origin_vendor_id, created_by, created_at, updated_at', // 0013 (store_vendor_id: the server's)
    owner: 'id, brand_id, vendor_id, since, return_on, reason, set_by, created_at',
    brandRate: 'id, brand_id, rate, since, set_by, created_at',
  };
  const BUCKET = 'vendor-contracts'; const SIGN_SECONDS = 60; const EVENTS = 50;
  const CONTRACT_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  const CONTRACT_MAX = 10 * 1024 * 1024;
  const PAY_METHODS = ['bank', 'instapay', 'wallet', 'cash'];
  // the vendors columns the team writes, by the prototype's field names
  const COL = { name: 'name', legalName: 'legal_name', category: 'category', aliases: 'aliases', status: 'status', phone: 'phone', altPhone: 'alt_phone', email: 'email', address: 'address', instagram: 'instagram', storeUrl: 'store_url', leadDays: 'lead_days', depositPolicy: 'deposit_policy', notes: 'notes', joinedAt: 'joined_at',
    contactName: 'contact_name', addressParts: 'address_parts', social: 'social' }; // phase 3.3 (0014): the three synced contact columns
  // phase 3.3: the vendors fields the site mirrors (push_vendor's `fields`), by the prototype's field name → the server's name
  const SYNC_OF = { name: 'name', phone: 'phone', email: 'email', contactName: 'contact_name', addressParts: 'address_parts', social: 'social', status: 'status' };
  const SYNC_FIELDS = ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates'];
  const ADDRESS_KEYS = ['street_1', 'street_2', 'city', 'state', 'zip', 'country']; const SOCIAL_KEYS = ['fb', 'instagram', 'twitter', 'youtube', 'linkedin', 'pinterest', 'threads', 'flickr'];
  const MESSAGES = { forbidden: 'مش من صلاحياتك', network: 'الشبكة مش متاحة — التغيير ما اتحفظش، جرّب تاني', in_use: 'ماينفعش يتمسح — عليه أوردرات', too_large: 'الملف أكبر من 10 ميجا', bad_type: 'نوع الملف مش مقبول — PDF أو صورة (PNG / JPG) بس', duplicate: 'فيه نسبة متسجلة بنفس تاريخ السريان — اختار تاريخ تاني',
    // phase 3.3: the push to the site and the per-category commission
    push_failed: 'اتحفظ في السيستم، ومابعتش للموقع — هيتبعت مع المزامنة الجاية', push_forbidden: 'اتحفظ في السيستم بس — إرسال التعديل للموقع محتاج صلاحية تعديل المبتكرين الكاملة', category_duplicate: 'فيه عمولة للفئة دي بنفس تاريخ السريان — اختار تاريخ تاني', bad_rate: 'النسبة من 0% إلى 65% والرسوم الثابتة من 0 أو أكتر', bad_category: 'اختار فئة من فئات الموقع',
    duplicate_username: 'اسم المستخدم ده مستخدم قبل كده', login_exists: 'المبتكر ده عنده بيانات دخول — عدّلها من ملفه', weak_password: 'الباسورد لازم: 8 حروف على الأقل، حرف إنجليزي، رقم، من غير مسافات', no_vault: 'الباسورد المؤقت مش متاح على السيرفر ده دلوقتي (Vault مش شغّال)', no_login: 'اعمل اسم مستخدم الأول', long_password: 'الباسورد أطول من 128 حرف',
    // phase 3.2: the brands (the local refusals and the server's 23505 / 22023 / 23503 say the same)
    brand_exists: 'فيه براند بنفس الاسم — اختار اسم تاني', brand_same_vendor: 'البراند أصلًا عند المبتكر ده', brand_same_date: 'فيه نقل للبراند بنفس التاريخ — اختار تاريخ بعده', brand_since_before: 'التاريخ ده قبل آخر نقل للبراند — اختار تاريخ بعده',
    brand_return_before: 'تاريخ الرجوع لازم يكون بعد تاريخ البداية', brand_with_origin: 'البراند أصلًا عند صاحبه', has_brands: 'ماينفعش يتمسح — عليه براندات (ماسك أو كان ماسك براند مبتكر تاني): انقلها أو رجّعها الأول' };
  const PW_MAX = 128; // the server's cap (22023 past it)
  const LOGIN_STATUSES = ['invited', 'active', 'disabled'];
  const DONE = ['مكتمل']; const OUT = ['ملغي', 'استرجاع', 'فشل', 'مرتجع', 'مسترد', 'ملغي / مرتجع'];
  let vendors = new Map(); const timeline = new Map(); const revealed = new Map(); let gen = 0; let st = 'idle'; let ratesOk = false;
  let brands = new Map(); let brandRatesOk = false; // phase 3.2: id → { id, name, code, aliases, store, origin, history, rates, … }
  let catRates = new Map(); let catRatesOk = false; let categoriesMap = new Map(); // phase 3.3: vendor → vendor_category_rates rows (since ascending); woo_categories by id
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const uid = () => { const s = window.IBAuth && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const VD = () => window.IbtekrVendors || null; // block 06: the prototype's validation (pure)
  function emit(detail) {
    const ev = typeof CustomEvent === 'function' ? new CustomEvent('ib:vendors', { detail }) : Object.assign(new Event('ib:vendors'), { detail });
    quiet(() => document.dispatchEvent(ev));
  }
  const setState = (v) => { if (st === v) return; st = v; emit({ state: v }); };

  // ---------- pure helpers (the prototype's cleaning rules, block 06) ----------
  const text = (v) => (v == null ? '' : String(v).trim());
  const latin = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x6f0));
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const norm = (s) => clean(latin(s), 80).toLowerCase().replace(/[\s_.-]+/g, ' ');
  const parseAliases = (s) => (Array.isArray(s) ? s.map((x) => clean(x, 80)).filter(Boolean) : clean(s, 400).split(/[,،]/).map((x) => x.trim()).filter(Boolean));
  const isIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3]; };
  const digits = (p) => (p ? latin(p).replace(/[\s-]/g, '') : null);
  const r2 = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date()); // the real local date
  // a date column ('YYYY-MM-DD') stays; a timestamp → its local date; else ''
  const localDate = (s) => { const v = text(s); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const d = new Date(v || NaN); return isNaN(d) ? '' : ymd(d); };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const ext = (name) => String(name || '').split('.').pop().toLowerCase();
  // the object name inside the bucket: [A-Za-z0-9._-] kept, anything else '_'; never empty, never starting with a dot, at most 100 chars
  function safeName(name) { const s = String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'file'; return s.length > 100 ? s.slice(-100) : s; }
  // the effective rate on `date` (prototype's rateAt): the earliest in the history until one has started
  function rateAt(v, date) { const h = v.rateHistory || []; let r = h[0] ? h[0].rate : v.rate; for (const x of h) if (x.since <= date) r = x.rate; return r; }
  // a line's share for the maker (decision 4): its Dokan rate and fee when the sync gave them; else our rate on the order's date
  // when the rates are visible; else the full total, marked noRate
  // phase 3.2: a line with its store's uuid asks rateFor first (the brand's special rate in force, else its owner's rate that day)
  function lineShare(line, v, date) {
    const tot = Number(line.tot) || 0;
    if (line.rate != null && Number.isFinite(Number(line.rate))) return { share: r2(tot - (tot * Number(line.rate) / 100 + (Number(line.fee) || 0))), noRate: false };
    if (line.vendorId) { const br = rateFor(line.vendorId, date); if (br != null) return { share: r2(tot * (1 - Number(br) / 100)), noRate: false }; }
    if (v && v.ratesVisible && (v.rateHistory || []).length) { const r = Number(rateAt(v, date)) || 0; return { share: r2(tot * (1 - r / 100)), noRate: false }; }
    return { share: r2(tot), noRate: true };
  }
  const kindOf = (status) => (DONE.includes(status) ? 'c' : OUT.includes(status) ? 'x' : 'p');

  // phase 3.3: an https:// URL (the site's logo / banner / links), else null — the screen makes a link or an image from these only
  const httpsOrNull = (v) => { const s = text(v); if (!/^https:\/\//i.test(s)) return null; try { return new URL(s).protocol === 'https:' ? s : null; } catch (e) { return null; } };
  // vendor_category_rates rows of one maker → the row in force today per category (the last `since <= T`), those with a rate (a null
  // rate = removed from that date): [{ wooCategoryId, name, rate, flat, since }] by category name
  function effectiveCategoryRates(rows, T) {
    const cur = new Map();
    for (const x of (rows || []).slice().sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : (Number(a.id) || 0) - (Number(b.id) || 0)))) { const s = localDate(x.since); if (s && s <= T) cur.set(String(x.woo_category_id), Object.assign({}, x, { since: s })); }
    return [...cur.values()].filter((x) => x.rate != null && Number.isFinite(Number(x.rate))).map((x) => ({ wooCategoryId: Number(x.woo_category_id), name: categoryName(x.woo_category_id), rate: Number(x.rate), flat: x.flat == null ? null : num(x.flat), since: x.since })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }
  const categoryName = (id) => { const c = categoriesMap.get(String(id)); return c ? c.name : '#' + id; };
  // ---------- the vendor shape (pure) ----------
  // a vendors row + its vendor_rates rows + its vendor_bank row (or null) → the prototype's vendor; opts.ratesVisible says
  // whether the caller may see the rates (rate / rateSince / rateHistory stay null / [] otherwise); opts.today for the effective rate
  // a vendor_logins row (without secret_id) → the login shape; hasPassword = a temporary password was set on the server
  const toLogin = (l) => (l ? { username: text(l.username), email: l.email || null, pwMode: l.pw_mode === 'temp' ? 'temp' : 'link', status: LOGIN_STATUSES.includes(l.status) ? l.status : 'invited', mustChange: !!l.must_change, passwordSetAt: l.password_set_at || null, inviteSentAt: l.invite_sent_at || null, hasPassword: !!l.password_set_at } : null);
  function toVendor(r, rates, bank, opts = {}) {
    const T = (opts && opts.today) || today(); const visible = !!(opts && opts.ratesVisible);
    const hist = (rates || []).filter((x) => x.vendor_id == null || String(x.vendor_id) === String(r.id)).map((x) => ({ rate: Number(x.rate), flat: x.flat == null ? null : num(x.flat), since: localDate(x.since), by: text(x.set_by) })).filter((x) => Number.isFinite(x.rate) && x.since).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    let cur = null; for (const x of hist) if (x.since <= T) cur = x; if (!cur && hist.length) cur = hist[0];
    const raw = r.raw && typeof r.raw === 'object' ? r.raw : {};
    const ct = r.contract && typeof r.contract === 'object' ? r.contract : null;
    const contract = ct && ct.file_name ? { fileName: text(ct.file_name), size: Number(ct.size) || 0, expires: ct.expires || null, uploadedBy: text(ct.uploaded_by), uploadedAt: text(ct.uploaded_at), path: text(ct.path) } : null;
    const b = bank ? { method: PAY_METHODS.includes(bank.method) ? bank.method : 'bank', bankName: bank.bank_name || null, holder: bank.holder || null, iban: bank.iban || null, wallet: bank.wallet || null } : null;
    const name = text(r.name);
    // phase 3.3: the synced store data — the parts and the links always carry every key; the mirrors are https:// or null
    const D = VD(); const parts = D && D.cleanAddressParts ? D.cleanAddressParts(r.address_parts) : Object.fromEntries(ADDRESS_KEYS.map((k) => [k, text(r.address_parts && r.address_parts[k])]));
    const social = D && D.cleanSocial ? D.cleanSocial(r.social) : Object.fromEntries(SOCIAL_KEYS.map((k) => [k, httpsOrNull(r.social && r.social[k]) || '']));
    const pending = Array.isArray(r.push_pending) ? r.push_pending.filter((f) => SYNC_FIELDS.includes(f)) : [];
    const cats = visible ? effectiveCategoryRates(opts.categoryRates || [], T) : [];
    return { id: String(r.id), name, legalName: r.legal_name || null, category: r.category || null, aliases: parseAliases(r.aliases || []), status: r.status === 'inactive' || r.status === 'leave' ? r.status : 'active',
      phone: r.phone || null, altPhone: r.alt_phone || null, email: r.email || null, address: r.address || null, instagram: r.instagram || null, storeUrl: r.store_url || null,
      contactName: text(r.contact_name) || null, addressParts: parts, social, logoUrl: httpsOrNull(r.logo_url), bannerUrl: httpsOrNull(r.banner_url), wooPaymentMethods: Array.isArray(r.woo_payment_methods) ? r.woo_payment_methods.map(text).filter(Boolean) : [],
      wooSyncedAt: text(r.woo_synced_at) || null, pushPending: pending, categoryRates: cats, rateFlat: visible && cur ? cur.flat : null,
      rate: visible && cur ? cur.rate : null, rateSince: visible && cur ? cur.since : null, rateHistory: visible ? hist : [], ratesVisible: visible,
      leadDays: Number(r.lead_days) || 7, depositPolicy: r.deposit_policy || null, notes: r.notes || null, logoLetter: name.charAt(0),
      joinedAt: localDate(r.joined_at) || localDate(r.created_at) || T, contract, bank: b, login: toLogin(opts && opts.login), openingBalance: Number(r.opening_balance) || 0,
      wooVendorId: r.woo_vendor_id == null ? null : Number(r.woo_vendor_id), shopUrl: text(raw.shop_url), createdAt: text(r.created_at), lastUpdate: text(r.updated_at) || text(r.created_at),
      brands: [], brandsEver: [] }; // phase 3.2: filled by load() from the brands tables (syncVendorBrands)
  }
  // ---------- the brands (phase 3.2, pure) ----------
  const bySince = (a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : (a.id || 0) - (b.id || 0));
  // a brands row + its brand_owners rows + its brand_rates rows (shown only when visible) → the internal brand record
  function toBrand(r, owners, rates, visible) {
    const history = (owners || []).filter((o) => String(o.brand_id) === String(r.id)).map((o) => ({ id: Number(o.id) || 0, vendor: String(o.vendor_id), since: localDate(o.since), returnOn: o.return_on ? localDate(o.return_on) : null, reason: text(o.reason) || null, by: text(o.set_by) })).filter((x) => x.since).sort(bySince);
    const rr = visible ? (rates || []).filter((x) => String(x.brand_id) === String(r.id)).map((x) => ({ id: Number(x.id) || 0, rate: x.rate == null ? null : Number(x.rate), since: localDate(x.since), by: text(x.set_by) })).filter((x) => x.since && (x.rate == null || Number.isFinite(x.rate))).sort(bySince) : [];
    return { id: String(r.id), name: text(r.name), code: text(r.code), aliases: parseAliases(r.aliases || []), store: r.store_vendor_id == null ? null : String(r.store_vendor_id), origin: String(r.origin_vendor_id), history, rates: rr, createdAt: text(r.created_at), updatedAt: text(r.updated_at) };
  }
  // the history row in force on `date` (the last that had started, else the first); null for an empty history
  function rowAt(b, date) { const h = b.history; if (!h.length) return null; let row = h[0]; for (const x of h) if (!date || x.since <= date) row = x; return row; }
  const ownerOf = (b, date) => { const row = rowAt(b, date); return row ? row.vendor : b.origin; }; // no history yet: the origin
  const lastRow = (b) => (b.history.length ? b.history[b.history.length - 1] : null); // the latest row, the one the server's guard compares with
  // the special rate in force on `date` (block 06 effectiveRate): none until a row has started — a rate «من التاريخ ده» never re-prices
  // the orders before it (review I1); null = none
  function brandRateAt(b, date) { let r = null; for (const x of b.rates) if (!date || x.since <= date) r = x.rate; return r == null ? null : r; }
  // the drawer's brand shape: the row in force today gives since / returnOn / temp; rate = the special rate today (null without one, or
  // when the rates are not visible); owner = the maker today; lastSince = the latest row's date (a transfer may not go before it);
  // back = where «رجوع لصاحبه» sends it (the maker before a temporary transfer, else the origin)
  const backOf = (b, T) => { const cur = rowAt(b, T); const i = cur ? b.history.indexOf(cur) : -1; return cur && cur.returnOn && i > 0 ? b.history[i - 1].vendor : b.origin; };
  function brandShape(b, T) {
    const cur = rowAt(b, T); const last = lastRow(b);
    return { id: b.id, name: b.name, code: b.code, aliases: b.aliases.slice(), since: cur ? cur.since : null, returnOn: cur && cur.returnOn ? cur.returnOn : null, temp: !!(cur && cur.returnOn), rate: brandRatesOk && canRate() ? brandRateAt(b, T) : null, store: b.store, origin: b.origin, owner: ownerOf(b, T), lastSince: last ? last.since : null, back: backOf(b, T) };
  }
  const ownerName = (vid) => { const v = vendors.get(String(vid)); return v ? v.name : '—'; };
  const brandsOf = (vid, T) => [...brands.values()].filter((b) => ownerOf(b, T) === String(vid)).sort((a, b) => a.name.localeCompare(b.name)).map((b) => brandShape(b, T));
  // the brands the maker held (a started row of his) and holds no more: until = the row after his last one
  function brandsEverOf(vid, T) {
    const out = [];
    for (const b of brands.values()) {
      if (ownerOf(b, T) === String(vid)) continue;
      let i = -1; b.history.forEach((x, k) => { if (x.vendor === String(vid) && x.since <= T) i = k; });
      if (i < 0) continue;
      const next = b.history[i + 1]; out.push(Object.assign(brandShape(b, T), { until: next ? next.since : null, now: ownerName(ownerOf(b, T)) }));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  function syncVendorBrands() { const T = today(); for (const v of vendors.values()) { v.brands = brandsOf(v.id, T); v.brandsEver = brandsEverOf(v.id, T); } }
  const contractRow = (ct) => (ct ? { path: ct.path || null, file_name: ct.fileName, size: ct.size, expires: ct.expires || null, uploaded_by: ct.uploadedBy, uploaded_at: ct.uploadedAt } : null);
  // an activity_log row → the drawer's timeline event (text in the actor's voice, like the prototype's events)
  const VERB = { 'vendor.create': 'أضاف المبتكر', 'vendor.update': 'عدّل بيانات المبتكر', 'vendor.status': 'غيّر حالة المبتكر', 'vendor.rate': 'غيّر نسبة إبتكر', 'vendor.bank': 'عدّل بيانات الحساب البنكي', 'vendor.reveal': 'أظهر', 'vendor.contract': 'رفع عقد التعاون', 'vendor.remove': 'حذف المبتكر', 'vendor.share': 'شارك أوردرات المبتكر', 'vendor.login': 'عدّل بيانات الدخول', 'vendor.login.status': 'غيّر حالة حساب الدخول', 'vendor.login.password': 'عمل باسورد مؤقت للمبتكر', 'vendor.login.reveal': 'أظهر باسورد الدخول (دعم)',
    'vendor.category_rate': 'حدّد عمولة الفئة' }; // phase 3.3
  // phase 3.3: the server's sync rows (actor null, new_value = the field names joined by ', ') read in the site's voice with the Arabic
  // labels of block 06 — «اتعدل من الموقع: التليفون، العنوان» / «تعارض — الموقع كسب في: الاسم»
  const SYNC_VERB = { 'vendor.sync': 'اتعدل من الموقع: ', 'vendor.sync.conflict': 'تعارض — الموقع كسب في: ' };
  const SITE_ACTOR = 'الموقع';
  function syncText(action, detail) {
    const D = VD(); const L = (D && D.SYNC_FIELD_LABELS) || {};
    const labels = String(detail || '').split(/\s*,\s*/).map((f) => f.trim()).filter(Boolean).map((f) => L[f] || f);
    return SYNC_VERB[action] + (labels.length ? labels.join('، ') : '—');
  }
  // phase 3.2: the brand events read as sentences — vendor.brand carries `add: <name>` / `update: <name> (<fields>)`,
  // vendor.brand.rate `<name>: <rate|—> من <since>`, vendor.brand.transfer / .return `<name> → <to> من <since>[ لحد <returnOn>]`
  function brandText(action, detail) {
    if (action === 'vendor.brand') return /^add: /.test(detail) ? 'أضاف البراند ' + detail.slice(5) : /^update: /.test(detail) ? 'عدّل البراند ' + detail.slice(8) : 'عدّل البراندات' + (detail ? ' (' + detail + ')' : '');
    const verb = { 'vendor.brand.rate': 'حدّد النسبة الخاصة للبراند', 'vendor.brand.transfer': 'نقل البراند', 'vendor.brand.return': 'رجّع البراند لصاحبه' }[action];
    return verb + (detail ? ' (' + detail + ')' : '');
  }
  function toEvent(r) {
    const detail = typeof r.new_value === 'string' ? r.new_value : r.new_value == null ? '' : JSON.stringify(r.new_value);
    // the site's voice only for a row without an actor (the server writes vendor.sync* with the service role); a member who logged such
    // an action himself (log_activity takes any vendor.* name) reads under his own name with the generic wording — never as the site
    if (SYNC_VERB[r.action] && r.actor == null) return { id: r.id, at: r.at, action: r.action, actor: { name: SITE_ACTOR }, text: syncText(r.action, detail) };
    const actor = (r.actor && r.actor.name) || '—';
    const text = /^vendor\.brand(\.|$)/.test(r.action) && !VERB[r.action] ? brandText(r.action, detail) : (VERB[r.action] || r.action) + (detail ? ' (' + detail + ')' : '');
    return { id: r.id, at: r.at, action: r.action, actor: { name: actor }, text: actor + ' ' + text };
  }

  // ---------- permissions (IBDirectory: has_perm's rule; the server is the judge) ----------
  const perm = (key) => { const D = window.IBDirectory; return D && D.perm ? D.perm(key) : 'N'; };
  const isAdmin = () => { const D = window.IBDirectory; const me = D && D.me && D.me(); return !!me && me.role_id === 'admin' && me.status === 'active'; };
  const canEdit = () => perm('vendors.edit') !== 'N';
  const canBank = () => perm('sensitive.vendor_bank') === 'F';
  const canToggle = () => perm('vendors.toggle') === 'F';
  const canRate = () => perm('sensitive.commission') === 'F';
  const canLogin = () => isAdmin() || perm('vendors.edit') === 'F'; // vendor_logins insert / update and the two RPCs
  const canBrands = () => isAdmin() || perm('vendors.edit') === 'F'; // brands insert / update, brand_owners insert (0013: admin or vendors.edit = F)
  const canPush = () => isAdmin() || perm('vendors.edit') === 'F'; // phase 3.3: woo-sync push_vendor (the rate fields add sensitive.commission, checked by the callers)
  // the signed-in member as the prototype's actor { name, role }
  function actor() {
    const K = window.IBKit; const m = K && K.member && K.ME ? K.member(K.ME) : null;
    if (m && m.name && m.name !== '—') return { name: m.name, role: m.role || '' };
    const D = window.IBDirectory; const me = D && D.me && D.me();
    return { name: (me && me.name) || '—', role: '' };
  }
  const noPerm = () => new Error(MESSAGES.forbidden);

  // ---------- load ----------
  const stale = (g) => { if (g !== gen) throw new Error('stale'); };
  async function pages(build, g) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      if (from) stale(g);
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }
  async function load() {
    const cl = c();
    if (!cl || !uid()) return;
    const g = ++gen;
    setState('loading');
    try {
      const mayRate = canRate(); // the brand_rates policy needs sensitive.commission = F: no request without it (0 rows anyway)
      const none = { data: [], error: null };
      const [vs, rs, bs, ls, brs, ows, bts, crs, cts] = await Promise.all([
        pages(() => cl.from('vendors').select(COLS.vendor).order('name', { ascending: true }).order('id', { ascending: true }), g),
        cl.from('vendor_rates').select(COLS.rate).order('since', { ascending: true }).order('id', { ascending: true }),
        cl.from('vendor_bank').select(COLS.bank),
        cl.from('vendor_logins').select(COLS.login),
        pages(() => cl.from('brands').select(COLS.brand).order('name', { ascending: true }).order('id', { ascending: true }), g).then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
        pages(() => cl.from('brand_owners').select(COLS.owner).order('since', { ascending: true }).order('id', { ascending: true }), g).then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
        mayRate ? cl.from('brand_rates').select(COLS.brandRate).order('since', { ascending: true }).order('id', { ascending: true }) : none,
        // phase 3.3: the per-category commission (sensitive.commission: no request without it) and the site's category names (vendors.view)
        mayRate ? pages(() => cl.from('vendor_category_rates').select(COLS.catRate).order('since', { ascending: true }).order('id', { ascending: true }), g).then((data) => ({ data, error: null }), (error) => ({ data: null, error })) : none,
        pages(() => cl.from('woo_categories').select(COLS.category).order('name', { ascending: true }).order('id', { ascending: true }), g).then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
      ]);
      stale(g);
      ratesOk = !rs.error; const visible = ratesOk && canRate();
      brandRatesOk = mayRate && !bts.error; // refused / not asked: no special rates known
      catRatesOk = mayRate && !crs.error; // refused / not asked: no category rates known
      categoriesMap = new Map((cts.error ? [] : cts.data || []).map((c) => [String(c.id), { id: Number(c.id), name: text(c.name) || '#' + c.id, slug: text(c.slug), parentId: c.parent_id == null ? null : Number(c.parent_id) }]));
      catRates = new Map(); (catRatesOk ? crs.data || [] : []).forEach((x) => { const k = String(x.vendor_id); if (!catRates.has(k)) catRates.set(k, []); catRates.get(k).push(x); });
      const brandRows = brs.error ? [] : brs.data || []; const ownerRows = ows.error ? [] : ows.data || []; const brandRates = brandRatesOk ? bts.data || [] : [];
      brands = new Map(brandRows.map((r) => [String(r.id), toBrand(r, ownerRows, brandRates, brandRatesOk)]));
      const byVendor = new Map(); (rs.error ? [] : rs.data || []).forEach((x) => { const k = String(x.vendor_id); if (!byVendor.has(k)) byVendor.set(k, []); byVendor.get(k).push(x); });
      const bankOf = new Map((bs.error ? [] : bs.data || []).map((b) => [String(b.vendor_id), b]));
      const loginOf = new Map((ls.error ? [] : ls.data || []).map((l) => [String(l.vendor_id), l])); // refused or empty: no login known
      const T = today();
      vendors = new Map(vs.map((r) => [String(r.id), toVendor(r, byVendor.get(String(r.id)) || [], bankOf.get(String(r.id)) || null, { ratesVisible: visible, today: T, login: loginOf.get(String(r.id)) || null, categoryRates: catRates.get(String(r.id)) || [] })]));
      syncVendorBrands();
      setState('ready');
    } catch (e) { if (g === gen) setState('error'); /* offline or refused: the screen keeps what it had; cleared: 'idle' */ }
  }
  function clear() { gen += 1; vendors = new Map(); brands = new Map(); catRates = new Map(); categoriesMap = new Map(); timeline.clear(); revealed.clear(); ratesOk = false; brandRatesOk = false; catRatesOk = false; setState('idle'); }
  // phase 3.3: the site's product categories for the pickers, by name
  const categories = () => [...categoriesMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((c) => Object.assign({}, c));
  const data = () => (st === 'ready' ? { vendors: all(), ratesVisible: ratesOk && canRate(), brands: allBrands() } : null);

  // ---------- the store ----------
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const get = (id) => { const v = vendors.get(String(id)); return v ? copy(v) : null; };
  const all = () => [...vendors.values()].map(copy);
  const must = (id) => { const v = vendors.get(String(id)); if (!v) throw new Error('vendor not found: ' + id); return v; };
  const events = (id) => (timeline.get(String(id)) || []).slice();
  function findByName(name) { const n = norm(name); if (!n) return null; for (const v of vendors.values()) { if (norm(v.name) === n || v.aliases.some((a) => norm(a) === n)) return copy(v); } return null; }
  const fail = (reason) => ({ ok: false, reason });
  // the brands' own codes (0013) are told apart by their message: 23503 of vendors_brands_guard_delete names brand_owners_vendor_id_fkey,
  // 23505 of the name index brands_name_key, 22023 of brand_owners_guard says which rule
  const msgOf = (e) => String((e && e.message) || '');
  // phase 3.3: 23505 of vendor_category_rates (vendor, category, since) → category_duplicate; its checks (23514 rate / flat / category id) → bad_rate / bad_category
  const reasonOf = (e) => (!e ? 'network' : e.code === '42501' || e.status === 403 || e.status === 401 || e.statusCode === '403' || e.statusCode === '401' ? 'forbidden' : e.code === '23503' ? (/brand_owners_vendor_id_fkey/.test(msgOf(e)) ? 'has_brands' : 'in_use') : e.code === '23505' ? (/brands_name_key/.test(msgOf(e)) ? 'brand_exists' : /brand_owners_brand_id_since_key/.test(msgOf(e)) ? 'brand_same_date' : /vendor_category_rates/.test(msgOf(e)) ? 'category_duplicate' : 'duplicate') : e.code === '22023' ? (/since before the last transfer/.test(msgOf(e)) ? 'brand_since_before' : /same vendor/.test(msgOf(e)) ? 'brand_same_vendor' : 'weak_password') : e.code === '23514' && /return_on/.test(msgOf(e)) ? 'brand_return_before' : e.code === '23514' && /vendor_category_rates_woo_category_id/.test(msgOf(e)) ? 'bad_category' : e.code === '23514' && /vendor_category_rates|vendor_rates_(rate|flat)/.test(msgOf(e)) ? 'bad_rate' : e.code === '0A000' ? 'no_vault' : e.code === 'P0002' ? 'no_login' : e.statusCode === '413' || e.status === 413 ? 'too_large' : e.statusCode === '415' || e.status === 415 ? 'bad_type' : 'network');
  // one call of the client → { ok, data } | { ok:false, reason }, never thrown
  async function call(fn) {
    const cl = c();
    if (!cl || !uid()) return fail('network');
    try { const { data: d, error } = await fn(cl); return error ? fail(reasonOf(error)) : { ok: true, data: d }; } catch (e) { return fail('network'); }
  }
  // vendor.* → activity_log with the vendor as entity (IBActivity forwards 'vendor.'); the drawer's timeline follows when it is open
  function logEvent(action, detail, id) {
    const A = window.IBActivity; if (!A || !A.log) return Promise.resolve();
    return Promise.resolve(quiet(() => A.log(action, detail, { entity: 'vendor', entity_id: String(id) }))).catch(() => undefined).then(() => (timeline.has(String(id)) ? fetchEvents(id) : undefined)).catch(() => undefined);
  }
  // phase 3.3 (decision 5): the row written, the site takes it — one call of woo-sync push_vendor with the member's session; the body
  // names the fields only (the server reads the row). → { result: 'ok' | 'skipped' | 'error', reason?, fields? }; never thrown. No request
  // for a caller without the push permission ('no_permission') or a maker without a store ('no_store'): the server would answer the same.
  async function pushVendor(id, fields) {
    const v = vendors.get(String(id)); const list = (fields || []).filter((f) => SYNC_FIELDS.includes(f));
    if (!list.length) return { result: 'skipped', reason: 'no_fields', fields: [] };
    if (!canPush() || (list.some((f) => f === 'rate' || f === 'category_rates') && !canRate())) return { result: 'skipped', reason: 'no_permission', fields: list };
    if (v && !v.wooVendorId) return { result: 'skipped', reason: 'no_store', fields: list };
    const cl = c();
    if (!cl || !uid()) return { result: 'error', reason: 'network', fields: list };
    try {
      const { data: d, error } = await cl.functions.invoke('woo-sync', { body: { action: 'push_vendor', vendor_id: String(id), fields: list } });
      if (error) { const st = error.context && error.context.status; return { result: 'error', reason: st === 401 || st === 403 ? 'forbidden' : st === 502 ? 'woo_error' : 'failed', status: st || null, fields: list }; }
      const a = d && typeof d === 'object' ? d : {};
      if (a.result === 'ok') return { result: 'ok', fields: Array.isArray(a.fields) ? a.fields : list, accepted: a.accepted || [], refused: a.refused || [], dropped: a.dropped || [] };
      if (a.result === 'skipped') return { result: 'skipped', reason: text(a.reason) || 'skipped', fields: list };
      return { result: 'error', reason: 'failed', fields: list };
    } catch (e) { return { result: 'error', reason: 'network', fields: list }; }
  }
  // the server write of a local change already applied to `v` (the row in the map): a refusal puts `old` back (unless a reload
  // replaced the row meanwhile) and announces the reason; a success pushes the synced fields to the site (phase 3.3, when any),
  // logs, reloads (the server's row is the truth: woo_synced_at / push_pending among it) and announces { written, push }
  async function write(id, v, old, run, logged, push) {
    const r = await run();
    if (!r.ok) {
      const now = vendors.get(id); // a removed row: v is null and the map has nothing
      if (v ? now === v : now === undefined) { if (old) vendors.set(id, old); else vendors.delete(id); }
      emit({ id, reason: r.reason }); return r;
    }
    const p = push && push.length ? await pushVendor(id, push) : null;
    await Promise.all([logged ? logged() : undefined, load()]);
    emit(p ? { id, written: true, push: p } : { id, written: true });
    return r;
  }
  const validate = (input) => { const D = VD(); return D && D.validateVendor ? D.validateVendor(input) : {}; };
  function invalid(errs, keys) { const bad = Object.keys(errs).filter((k) => !keys || keys.includes(k)); if (bad.length) throw new Error('invalid vendor: ' + bad.join(',')); }
  // the prototype's cleaning of one field
  function cleanField(k, nv) {
    if (k === 'aliases') return parseAliases(nv);
    if (k === 'leadDays') return Number(latin(nv));
    if (k === 'phone' || k === 'altPhone') return nv ? digits(nv) : null;
    if (k === 'category' || k === 'status') return nv;
    if (k === 'addressParts') { const D = VD(); return D && D.cleanAddressParts ? D.cleanAddressParts(nv) : nv; } // phase 3.3: always the six keys
    if (k === 'social') { const D = VD(); return D && D.cleanSocial ? D.cleanSocial(nv) : nv; } // the eight keys, https:// or ''
    if (typeof nv === 'string') return clean(nv, k === 'notes' ? 500 : k === 'address' || k === 'storeUrl' ? 200 : 120) || null;
    return nv;
  }
  const addressOf = (parts) => { const D = VD(); return D && D.addressText ? D.addressText(parts) : null; };
  // a patch in the prototype's field names → the changed vendors columns of `v` (the server guard checks per column)
  function update(id, patch, actor) {
    const v = must(id); if (!canEdit()) throw noPerm();
    if (patch.status !== undefined && patch.status !== v.status && !canToggle()) throw noPerm(); // the guard's rule 1 (vendors.toggle)
    const errs = validate(Object.assign({}, v, { aliases: v.aliases.join('،') }, patch)); invalid(errs, Object.keys(patch).filter((k) => patch[k] !== undefined));
    if (patch.joinedAt !== undefined && patch.joinedAt && !isIso(patch.joinedAt)) throw new Error('invalid vendor: joinedAt');
    // phase 3.3: the parts and the links judged by block 06 before any write (the popup shows the same messages)
    const D = VD();
    if (patch.addressParts !== undefined && D && D.validateAddressParts && Object.keys(D.validateAddressParts(patch.addressParts)).length) throw new Error('invalid vendor: addressParts');
    if (patch.social !== undefined && D && D.validateSocial && Object.keys(D.validateSocial(patch.social)).length) throw new Error('invalid vendor: social');
    const old = copy(v); const row = {}; const changed = [];
    for (const k of Object.keys(COL)) {
      if (patch[k] === undefined) continue;
      const nv = k === 'joinedAt' ? (patch[k] || null) : cleanField(k, patch[k]);
      if (JSON.stringify(nv) === JSON.stringify(v[k])) continue;
      changed.push(k); v[k] = nv; row[COL[k]] = nv;
    }
    if (!changed.length) return get(id);
    if (changed.includes('name')) v.logoLetter = v.name.charAt(0);
    // phase 3.3 (decision 1): the parts change → `address` (the joined text, the server's rule) with them; the links change → `instagram` = social.instagram
    if (changed.includes('addressParts')) { v.address = addressOf(v.addressParts); row.address = v.address; }
    if (changed.includes('social')) { v.instagram = v.social.instagram || null; row.instagram = v.instagram; }
    v.lastUpdate = new Date().toISOString();
    emit({ id, changed });
    const fields = changed.filter((k) => k !== 'status');
    const push = changed.map((k) => SYNC_OF[k]).filter(Boolean); // the synced fields among the change → push_vendor after the row
    write(id, v, old, () => call((cl) => cl.from('vendors').update(row).eq('id', id)), () => Promise.all([
      changed.includes('status') ? logEvent('vendor.status', v.status, id) : undefined,
      fields.length ? logEvent('vendor.update', fields.join(', '), id) : undefined,
      changed.includes('name') && window.IBOrders && window.IBOrders.load ? quiet(() => window.IBOrders.load()) : undefined, // the orders carry vendors.name (decision 11)
    ]), push);
    return get(id);
  }
  // the flat fee next to a rate ('' / null = none): a number ≥ 0 or null; anything else throws
  const flatOf = (raw) => { if (raw == null || String(raw).trim() === '') return null; const f = Number(latin(raw)); if (!Number.isFinite(f) || f < 0) throw new Error('flat out of range'); return f; };
  // phase 3.3: opts.flat = the site's flat fee shown with the rate (vendor_rates.flat, display only); the new row is pushed as the
  // maker's commission on the site (push_vendor ['rate'] — fixed, or category_based when he has category rates)
  function setRate(id, rate, since, actor, opts) {
    const v = must(id); if (!canRate()) throw noPerm();
    const r = Number(latin(rate)); if (!Number.isFinite(r) || r < 0 || r > 65) throw new Error('rate out of range'); if (!isIso(since)) throw new Error('since required');
    const flat = flatOf(opts && opts.flat);
    if (v.rateHistory.some((x) => x.since === since)) throw new Error(MESSAGES.duplicate); // unique (vendor_id, since): rates are never rewritten
    const old = copy(v); const T = today();
    v.rateHistory = v.rateHistory.filter((x) => x.since !== since).concat([{ rate: r, flat, since, by: actor && actor.name }]).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    let cur = null; for (const x of v.rateHistory) if (x.since <= T) cur = x; if (!cur) cur = v.rateHistory[0];
    v.rate = cur.rate; v.rateFlat = cur.flat == null ? null : cur.flat; v.rateSince = cur.since; v.ratesVisible = true; v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['rate'] });
    const ins = { vendor_id: id, rate: r, since, set_by: (actor && actor.name) || null }; if (flat != null) ins.flat = flat;
    write(id, v, old, () => call((cl) => cl.from('vendor_rates').insert(ins)), () => logEvent('vendor.rate', r + '% من ' + since + (flat != null ? ' + ' + flat + ' ج.م' : ''), id), ['rate']);
  }
  // phase 3.3 (decision 2): the commission on one of the site's categories from a date — a new vendor_category_rates row (add-only; rate
  // null = the category rate is removed from that date; unique (vendor, category, since) refused locally, 23505 reads the same), then
  // push_vendor ['category_rates'] (the site takes category_based with every category rate in force). Logged with the category's name.
  function setCategoryRate(vendorId, wooCategoryId, input, since, actor) {
    const v = must(vendorId); if (!canRate()) throw noPerm();
    const D = VD(); const errs = D && D.validateCategoryRate ? D.validateCategoryRate({ wooCategoryId, rate: input && input.rate, flat: input && input.flat }) : {};
    const bad = Object.keys(errs); if (bad.length) throw new Error('invalid category rate: ' + bad.join(','));
    const cid = Number(latin(wooCategoryId)); if (!isIso(since)) throw new Error('since required');
    if (!categoriesMap.has(String(cid))) throw new Error(MESSAGES.bad_category);
    const raw = input && input.rate; const r = raw == null || String(raw).trim() === '' ? null : Number(latin(raw)); const flat = flatOf(input && input.flat);
    const rows = catRates.get(String(vendorId)) || [];
    if (rows.some((x) => Number(x.woo_category_id) === cid && localDate(x.since) === since)) throw new Error(MESSAGES.category_duplicate);
    const old = copy(v); const oldRows = rows.slice(); const by = (actor && actor.name) || null;
    catRates.set(String(vendorId), rows.concat([{ id: Number.MAX_SAFE_INTEGER, vendor_id: String(vendorId), woo_category_id: cid, rate: r, flat, since, set_by: by }]));
    v.categoryRates = effectiveCategoryRates(catRates.get(String(vendorId)), today()); catRatesOk = true; v.lastUpdate = new Date().toISOString();
    emit({ id: String(vendorId), changed: ['categoryRates'] });
    const run = async () => { const res = await call((cl) => cl.from('vendor_category_rates').insert({ vendor_id: String(vendorId), woo_category_id: cid, rate: r, flat, since, set_by: by })); if (!res.ok) catRates.set(String(vendorId), oldRows); return res; };
    write(String(vendorId), v, old, run, () => logEvent('vendor.category_rate', categoryName(cid) + ': ' + (r == null ? '—' : r + '%') + (flat != null ? ' + ' + flat + ' ج.م' : '') + ' من ' + since, vendorId), ['category_rates']);
    return get(vendorId);
  }
  // the prototype's cleaning of a bank form (the IBAN upper-cased, decision 7) and its vendor_bank row
  const cleanBank = (bank) => ({ method: PAY_METHODS.includes(bank.method) ? bank.method : 'bank', bankName: clean(bank.bankName, 80) || null, holder: clean(bank.holder, 120) || null, iban: latin(bank.iban || '').replace(/\s/g, '').toUpperCase() || null, wallet: latin(bank.wallet || '').replace(/\s/g, '') || null });
  const bankRow = (b, actor) => ({ method: b.method, bank_name: b.bankName, holder: b.holder, iban: b.iban, wallet: b.wallet, updated_by: (actor && actor.name) || null, updated_at: new Date().toISOString() });
  function setBank(id, bank, actor) {
    const v = must(id); if (!canBank()) throw noPerm();
    const old = copy(v); const had = !!v.bank;
    v.bank = cleanBank(bank);
    v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['bank'] });
    const row = bankRow(v.bank, actor);
    write(id, v, old, () => call((cl) => (had ? cl.from('vendor_bank').update(row).eq('vendor_id', id) : cl.from('vendor_bank').insert(Object.assign({ vendor_id: id }, row)))), () => logEvent('vendor.bank', v.bank.method, id));
  }
  // the value behind a masked field; logged once per field per drawer open (loadEvents resets it)
  function reveal(id, field, actor) {
    const v = must(id); if (!canBank()) throw noPerm(); if (!v.bank || !v.bank[field]) return null;
    const k = String(id); if (!revealed.has(k)) revealed.set(k, new Set());
    if (!revealed.get(k).has(field)) { revealed.get(k).add(field); logEvent('vendor.reveal', field === 'iban' ? 'IBAN' : 'wallet', id); }
    return v.bank[field];
  }
  // file: { fileName, size, expires, file (a Blob / File; absent = keep the stored file, change its expiry) }
  function setContract(id, file, actor) {
    const v = must(id); if (!canBank()) throw noPerm();
    const f = file || {}; const e = ext(f.fileName); const blob = f.file || null;
    if (blob) { if (!CONTRACT_MIME[e] || !(f.size > 0 && f.size <= CONTRACT_MAX)) throw new Error(MESSAGES.bad_type + ' — وحجمه لحد 10 ميجا'); }
    else if (!v.contract || !v.contract.path) throw new Error('اختار ملف العقد الأول.');
    if (f.expires && !isIso(f.expires)) throw new Error('expires invalid');
    const old = copy(v); const now = new Date().toISOString();
    v.contract = blob ? { fileName: clean(f.fileName, 120), size: Number(f.size), expires: f.expires || null, uploadedBy: (actor && actor.name) || '', uploadedAt: now, path: null } : Object.assign({}, v.contract, { expires: f.expires || null });
    v.lastUpdate = now;
    emit({ id, changed: ['contract'] });
    const path = blob ? id + '/' + Date.now() + '-' + safeName(f.fileName) : v.contract.path;
    const run = async () => {
      if (blob) {
        const up = await call(async (cl) => cl.storage.from(BUCKET).upload(path, await blob.arrayBuffer(), { contentType: CONTRACT_MIME[e], upsert: false }));
        if (!up.ok) return up;
        v.contract.path = path;
      }
      return call((cl) => cl.from('vendors').update({ contract: contractRow(v.contract) }).eq('id', id));
    };
    write(id, v, old, run, () => logEvent('vendor.contract', (blob ? e.toUpperCase() + ' · ' + (Number(f.size) / 1048576).toFixed(1) + ' ميجا' : 'expires') + (f.expires ? ' · حتى ' + f.expires : ''), id));
  }
  // «عرض / تحميل»: a signed URL (60 s) of the stored file → { ok, url } | { ok:false, reason }
  async function contractUrl(id) {
    if (!canBank()) return fail('forbidden'); // the Storage policies need the key; no request without it
    const v = vendors.get(String(id)); const path = v && v.contract && v.contract.path;
    if (!path) return fail('network');
    const r = await call((cl) => cl.storage.from(BUCKET).createSignedUrl(path, SIGN_SECONDS));
    return r.ok && r.data && r.data.signedUrl ? { ok: true, url: r.data.signedUrl } : fail(r.ok ? 'network' : r.reason);
  }
  // admin only (the policy); refused by the server while order lines point at the vendor (23503 → 'in_use')
  function remove(id, actor) {
    const v = must(id); if (!isAdmin()) throw noPerm();
    const old = copy(v); vendors.delete(String(id)); timeline.delete(String(id));
    emit({ id, removed: true });
    write(String(id), null, old, async () => { const r = await call((cl) => cl.from('vendors').delete().eq('id', id).select('id')); return r.ok && !(r.data || []).length ? fail('forbidden') : r; }, () => logEvent('vendor.remove', old.name, id));
    return true;
  }
  // import undo (block 26): the money fields back to a snapshot — the bank row, the contract metadata (the file stays) and the
  // rate (a new dated row: rates are never deleted)
  function restoreMoney(id, snap, actor) {
    const v = must(id); if (!canBank()) throw noPerm(); const s = snap || {};
    if (s.bank) setBank(id, s.bank, actor);
    if (s.contract !== undefined && JSON.stringify(s.contract) !== JSON.stringify(v.contract)) {
      const old = copy(v); v.contract = s.contract ? copy(s.contract) : null; emit({ id, changed: ['contract'] });
      write(id, v, old, () => call((cl) => cl.from('vendors').update({ contract: contractRow(v.contract) }).eq('id', id)), () => logEvent('vendor.update', 'contract (restore)', id));
    }
    if (s.rate != null && canRate() && Number(s.rate) !== v.rate) setRate(id, s.rate, s.rateSince || today(), actor);
  }
  // ---------- login (phase 3.1, decision 10) ----------
  const loginErrs = (l) => { const D = VD(); return D && D.validateLogin ? D.validateLogin(l) : {}; };
  const bankErrs = (b) => { const D = VD(); return D && D.validateBank ? D.validateBank(b) : {}; };
  const pwIssues = (p) => { const D = VD(); return D && D.passwordIssues ? D.passwordIssues(p) : []; };
  const loginReason = (reason) => (reason === 'duplicate' ? 'duplicate_username' : reason); // 23505 on vendor_logins: the unique username
  // local check over the loaded logins (lower-cased); the server's unique index on lower(username) is the judge
  function usernameTaken(username, exceptId) { const n = String(username || '').trim().toLowerCase(); if (!n) return false; for (const v of vendors.values()) if (String(v.id) !== String(exceptId || '') && v.login && v.login.username && v.login.username.toLowerCase() === n) return true; return false; }
  // what the maker still lacks to work on the system (the drawer's «ناقص» line); the bank only when the caller can see bank rows
  function missing(id) { const v = must(id); const out = []; if (!v.login || !v.login.username) out.push('بيانات الدخول'); if (!v.email && !(v.login && v.login.email)) out.push('الإيميل'); if (canBank() && !v.bank) out.push('الحساب البنكي'); return out; }
  // username + e-mail of an existing row: the changed columns only (a PATCH); the row's status stays. A maker without a row → no_login:
  // the row is born with its temporary password through addLogin (owner 26 Oct: no invite link, so no login without a password).
  function setLogin(id, l, actor) {
    const v = must(id); if (!canLogin()) throw noPerm(); if (!v.login || !v.login.username) throw new Error(MESSAGES.no_login);
    const u = String((l && l.username) || '').trim().toLowerCase(); const email = clean(l && l.email, 120);
    const errs = loginErrs({ username: u, email }); const bad = Object.keys(errs); if (bad.length) throw new Error('invalid login: ' + bad.join(','));
    if (usernameTaken(u, id)) throw new Error(MESSAGES.duplicate_username);
    const changed = [];
    if (v.login.username !== u) changed.push('username'); if ((v.login.email || null) !== email) changed.push('email');
    if (!changed.length) return get(id);
    const old = copy(v);
    v.login = Object.assign(v.login, { username: u, email }); v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['login'] });
    const row = Object.fromEntries(changed.map((k) => [k, k === 'username' ? u : email]));
    write(id, v, old, async () => { const r = await call((cl) => cl.from('vendor_logins').update(row).eq('vendor_id', id)); return r.ok ? r : fail(loginReason(r.reason)); }, () => logEvent('vendor.login', changed.join(', '), id));
    return get(id);
  }
  // the drawer's «إضافة بيانات الدخول»: the row and its temporary password in one go — the insert (vendor_id, username, email,
  // pw_mode temp, created_by = the member's name), then rpc vendor_login_set_password (it needs the row). A refused insert rejects
  // with its message (the duplicate username included) and nothing is written; a refused password leaves the row and comes back in
  // `missing` with its reason, as create does. The password is local to this call. Resolves after the reload.
  async function addLogin(id, l, actor) {
    const v = must(id); if (!canLogin()) throw noPerm(); if (v.login && v.login.username) throw new Error(MESSAGES.login_exists);
    const u = String((l && l.username) || '').trim().toLowerCase(); const email = clean(l && l.email, 120); const pw = String((l && l.password) || '');
    const errs = loginErrs({ username: u, email, pwMode: 'temp', password: pw }); const bad = Object.keys(errs); if (bad.length) throw new Error('invalid login: ' + bad.join(','));
    if (pw.length > PW_MAX) throw new Error(MESSAGES.long_password);
    if (usernameTaken(u, id)) throw new Error(MESSAGES.duplicate_username);
    const lr = await call((cl) => cl.from('vendor_logins').insert({ vendor_id: id, username: u, email, pw_mode: 'temp', created_by: (actor && actor.name) || null }));
    if (!lr.ok) throw new Error(MESSAGES[loginReason(lr.reason)] || MESSAGES.network);
    const logs = [logEvent('vendor.login', 'username, email', id)]; const missing = []; const reasons = {};
    const pr = await call((cl) => cl.rpc('vendor_login_set_password', { p_vendor: id, p_password: pw }));
    if (!pr.ok) { missing.push('password'); reasons.password = pr.reason; }
    await Promise.all(logs.concat([timeline.has(String(id)) ? fetchEvents(id) : undefined, load()]));
    emit({ id, written: true });
    return { vendor: get(id), missing, reasons };
  }
  // the client may set invited / disabled only (active is the portal's, when the maker makes his own password)
  function setLoginStatus(id, status, actor) {
    const v = must(id); if (!canLogin()) throw noPerm(); if (status !== 'invited' && status !== 'disabled') throw new Error('bad status');
    if (!v.login || !v.login.username) throw new Error(MESSAGES.no_login);
    if (v.login.status === status) return get(id);
    const old = copy(v); v.login.status = status; v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['login'] });
    write(id, v, old, () => call((cl) => cl.from('vendor_logins').update({ status }).eq('vendor_id', id)), () => logEvent('vendor.login.status', status, id));
    return get(id);
  }
  // rpc vendor_login_set_password: the rules checked here first (the server checks them again: 22023), the password goes to the RPC
  // and nowhere else; the server stores it in Vault and logs vendor.login.password itself. Resolves to password_set_at.
  async function setLoginPassword(id, password, actor) {
    const v = must(id); if (!canLogin()) throw noPerm(); if (!v.login || !v.login.username) throw new Error(MESSAGES.no_login);
    const iss = pwIssues(password); if (iss.length) throw new Error('الباسورد لازم: ' + iss.join('، ')); if (String(password).length > PW_MAX) throw new Error(MESSAGES.long_password);
    const r = await call((cl) => cl.rpc('vendor_login_set_password', { p_vendor: id, p_password: String(password) }));
    if (!r.ok) throw new Error(MESSAGES[r.reason] || MESSAGES.network);
    await Promise.all([timeline.has(String(id)) ? fetchEvents(id) : undefined, load()]);
    emit({ id, written: true });
    return r.data || null;
  }
  // rpc vendor_login_reveal: the temporary password for support — every call is logged by the server (vendor.login.reveal);
  // nothing is kept here. null when no temporary password was set.
  async function revealPassword(id, actor) {
    const v = must(id); if (!canLogin()) throw noPerm(); if (!v.login || !v.login.hasPassword) return null;
    const r = await call((cl) => cl.rpc('vendor_login_reveal', { p_vendor: id }));
    if (!r.ok) throw new Error(MESSAGES[r.reason] || MESSAGES.network);
    if (timeline.has(String(id))) await fetchEvents(id).catch(() => undefined); // the server's vendor.login.reveal row, so the drawer's redraw shows it
    return typeof r.data === 'string' ? r.data : null;
  }
  // the add-vendor modal (decision 10): vendors → vendor_rates (canRate) → vendor_logins (input.login) → rpc vendor_login_set_password
  // (pwMode temp) → vendor_bank (canBank and input.bank); the first insert refused → rejects with the reason's message; a later step
  // refused never undoes the vendor: it is named in `missing` (with its reason in `reasons`). Resolves after the reload.
  async function create(input, actor) {
    if (!(isAdmin() || perm('vendors.edit') === 'F')) throw noPerm(); // vendors_insert: vendors.edit = F
    invalid(validate(input));
    const login = input.login && input.login.username ? { username: String(input.login.username).trim().toLowerCase(), email: clean(input.email, 120) || clean(input.login.email, 120) } : null;
    const pw = login ? String(input.login.password || '') : ''; // the temporary password — the only mode (owner 26 Oct); local to this call only
    if (login) {
      const le = loginErrs({ username: login.username, email: login.email, pwMode: 'temp', password: pw }); const bad = Object.keys(le); if (bad.length) throw new Error('invalid login: ' + bad.join(','));
      if (pw.length > PW_MAX) throw new Error(MESSAGES.long_password);
      if (usernameTaken(login.username)) throw new Error(MESSAGES.duplicate_username);
    }
    const bank = canBank() && input.bank && input.bank.method ? cleanBank(input.bank) : null;
    if (bank) { const be = bankErrs(input.bank); const bad = Object.keys(be); if (bad.length) throw new Error('invalid bank: ' + bad.join(',')); }
    const row = {}; for (const k of Object.keys(COL)) { if (k === 'joinedAt' || ((k === 'addressParts' || k === 'social') && (!input[k] || typeof input[k] !== 'object'))) continue; const nv = cleanField(k, input[k] === undefined ? '' : input[k]); if (nv !== null && nv !== '' && !(Array.isArray(nv) && !nv.length)) row[COL[k]] = nv; }
    if (row.address_parts) row.address = addressOf(row.address_parts) || undefined; if (row.social) row.instagram = row.social.instagram || undefined; // phase 3.3: the derived columns with their source
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    row.name = clean(input.name, 80); row.status = input.status; row.lead_days = Number(latin(input.leadDays)); row.aliases = parseAliases(input.aliases || '');
    row.joined_at = input.joinedAt && isIso(input.joinedAt) ? input.joinedAt : today();
    const r = await call((cl) => cl.from('vendors').insert(row).select('id').single());
    if (!r.ok || !r.data || r.data.id == null) throw new Error(MESSAGES[r.ok ? 'network' : r.reason]);
    const id = String(r.data.id); const rate = Number(latin(input.rate)); const missingSteps = []; const reasons = {};
    const logs = [logEvent('vendor.create', row.name, id)];
    const refused = (step, res) => { missingSteps.push(step); reasons[step] = res.reason; };
    if (canRate() && Number.isFinite(rate)) { // a refused first rate does not undo the vendor
      const since = input.rateSince && isIso(input.rateSince) ? input.rateSince : today();
      const rr = await call((cl) => cl.from('vendor_rates').insert({ vendor_id: id, rate, since, set_by: (actor && actor.name) || null }));
      if (rr.ok) logs.push(logEvent('vendor.rate', rate + '% من ' + since, id)); else refused('rate', rr);
    }
    if (login) {
      const lr = await call((cl) => cl.from('vendor_logins').insert({ vendor_id: id, username: login.username, email: login.email, pw_mode: 'temp', created_by: (actor && actor.name) || null }));
      if (lr.ok) {
        logs.push(logEvent('vendor.login', 'username, email', id));
        const pr = await call((cl) => cl.rpc('vendor_login_set_password', { p_vendor: id, p_password: pw })); if (!pr.ok) refused('password', pr);
      } else refused('login', { reason: loginReason(lr.reason) });
    }
    if (bank) {
      const br = await call((cl) => cl.from('vendor_bank').insert(Object.assign({ vendor_id: id }, bankRow(bank, actor))));
      if (br.ok) logs.push(logEvent('vendor.bank', bank.method, id)); else refused('bank', br);
    }
    await Promise.all(logs.concat([load()]));
    emit({ id, written: true });
    return { vendor: get(id) || { id, name: row.name }, missing: missingSteps, reasons };
  }
  // ---------- brands (phase 3.2, decision 3) ----------
  const brandMust = (id) => { const b = brands.get(String(id)); if (!b) throw new Error('brand not found: ' + id); return b; };
  const brand = (id) => { const b = brands.get(String(id)); return b ? brandShape(b, today()) : null; };
  const allBrands = () => [...brands.values()].sort((a, b) => a.name.localeCompare(b.name)).map((b) => brandShape(b, today()));
  // the name or an alias, normalised like findByName → the brand's shape, or null
  function brandByName(name) { const n = norm(name); if (!n) return null; for (const b of brands.values()) if (norm(b.name) === n || b.aliases.some((a) => norm(a) === n)) return brandShape(b, today()); return null; }
  // the maker who owned the brand on `date` (today without one); null for an unknown brand
  function ownerAt(brandId, date) { const b = brands.get(String(brandId)); return b ? ownerOf(b, date || today()) : null; }
  const brandOfStore = (storeId) => { for (const b of brands.values()) if (b.store === String(storeId)) return b; return null; };
  // the maker paid for a store's sub-order on `date`: the owner of the store's brand that day, else the store itself (no brand)
  function storeOwnerAt(storeId, date) { const b = brandOfStore(storeId); return b ? ownerOf(b, date || today()) : String(storeId); }
  // the rate on a store's line on `date`: the brand's special rate in force (when visible), else its owner's rate that day (rateAt, when
  // visible); null when none is known (the caller counts the line in full, marked noRate)
  function rateFor(storeId, date) {
    const D = date || today(); const b = brandOfStore(storeId);
    if (b && brandRatesOk && canRate()) { const r = brandRateAt(b, D); if (r != null) return r; }
    const v = vendors.get(b ? ownerOf(b, D) : String(storeId));
    return v && v.ratesVisible && (v.rateHistory || []).length ? rateAt(v, D) : null;
  }
  // the maker's name and aliases, plus the names and aliases of every brand he holds or held (the list's search)
  function namesOf(vendorId) {
    const v = must(vendorId); const out = [v.name].concat(v.aliases);
    for (const b of brands.values()) if (b.origin === String(vendorId) || b.history.some((x) => x.vendor === String(vendorId))) out.push(b.name, ...b.aliases);
    return [...new Set(out.filter(Boolean))];
  }
  const brandErrs = (input) => { const D = VD(); return D && D.validateBrand ? D.validateBrand(input) : {}; };
  const transferErrs = (input) => { const D = VD(); return D && D.validateTransfer ? D.validateTransfer(input) : {}; };
  const codeOf = (code, name) => { const c = latin(code == null ? '' : code).trim().toUpperCase(); if (c) return c; const D = VD(); return D && D.brandCode ? D.brandCode(name) : 'X'; };
  const rateOf = (raw) => (raw == null || String(raw).trim() === '' ? null : Number(latin(raw)));
  // a brand change written: like write(), with the brand record put back on a refusal; the owner (or both makers) announced
  async function writeBrand(id, old, run, logged, ids) {
    const r = await run();
    if (!r.ok) { if (brands.get(String(id))) brands.set(String(id), old); syncVendorBrands(); emit({ id: ids[0], reason: r.reason }); return r; }
    await Promise.all([logged ? logged() : undefined, load()]);
    ids.forEach((vid) => emit({ id: vid, written: true }));
    return r;
  }
  // «إضافة براند» (asynchronous: the id comes from the server): brands → brand_owners (since = input.since, else the maker's joining
  // date) → brand_rates when a special rate is given and the caller may set rates. The brand's insert refused → rejects with its
  // message (a taken name included: local first, then the server's 23505); a later step refused never undoes the brand — it is named in
  // `missing` with its reason. Resolves { brand, missing, reasons } after the reload.
  async function addBrand(vendorId, input, actor) {
    const v = must(vendorId); if (!canBrands()) throw noPerm();
    const errs = brandErrs(input || {}); const bad = Object.keys(errs); if (bad.length) throw new Error('invalid brand: ' + bad.join(','));
    const name = clean(input.name, 80); const code = codeOf(input.code, name); const aliases = parseAliases(input.aliases || ''); const rate = rateOf(input.rate);
    const since = input.since && isIso(input.since) ? input.since : v.joinedAt || today();
    if (brandByName(name)) throw new Error(MESSAGES.brand_exists);
    const by = (actor && actor.name) || null;
    const r = await call((cl) => cl.from('brands').insert({ name, code, aliases, origin_vendor_id: String(vendorId), created_by: by }).select('id').single());
    if (!r.ok || !r.data || r.data.id == null) throw new Error(MESSAGES[r.ok ? 'network' : r.reason] || MESSAGES.network);
    const id = String(r.data.id); const logs = [logEvent('vendor.brand', 'add: ' + name, vendorId)]; const missingSteps = []; const reasons = {};
    const o = await call((cl) => cl.from('brand_owners').insert({ brand_id: id, vendor_id: String(vendorId), since, set_by: by }));
    if (!o.ok) { missingSteps.push('owner'); reasons.owner = o.reason; }
    if (rate != null && canRate()) {
      const rr = await call((cl) => cl.from('brand_rates').insert({ brand_id: id, rate, since, set_by: by }));
      if (rr.ok) logs.push(logEvent('vendor.brand.rate', name + ': ' + rate + '% من ' + since, vendorId)); else { missingSteps.push('rate'); reasons.rate = rr.reason; }
    }
    await Promise.all(logs.concat([load()]));
    emit({ id: String(vendorId), written: true });
    return { brand: brand(id) || { id, name, code, aliases }, missing: missingSteps, reasons };
  }
  // «تعديل»: name / code / aliases — the changed columns only (a PATCH, no .select()); write-through, logged on the owner today
  function updateBrand(id, patch, actor) {
    const b = brandMust(id); if (!canBrands()) throw noPerm(); const p = patch || {};
    const merged = { name: p.name !== undefined ? p.name : b.name, code: p.code !== undefined ? p.code : b.code, aliases: p.aliases !== undefined ? p.aliases : b.aliases.join('، ') };
    const errs = brandErrs(merged); const bad = Object.keys(errs).filter((k) => p[k] !== undefined); if (bad.length) throw new Error('invalid brand: ' + bad.join(','));
    const name = clean(merged.name, 80); const code = codeOf(merged.code, name); const aliases = parseAliases(merged.aliases);
    const dup = brandByName(name); if (dup && dup.id !== b.id) throw new Error(MESSAGES.brand_exists);
    const row = {}; const changed = [];
    if (name !== b.name) { row.name = name; changed.push('name'); }
    if (code !== b.code) { row.code = code; changed.push('code'); }
    if (JSON.stringify(aliases) !== JSON.stringify(b.aliases)) { row.aliases = aliases; changed.push('aliases'); }
    if (!changed.length) return brand(id);
    const ownerId = ownerOf(b, today()); const old = copy(b);
    Object.assign(b, { name, code, aliases }); syncVendorBrands();
    emit({ id: ownerId, changed: ['brands'] });
    writeBrand(id, old, () => call((cl) => cl.from('brands').update(row).eq('id', String(id))), () => logEvent('vendor.brand', 'update: ' + name + ' (' + changed.join(', ') + ')', ownerId), [ownerId]);
    return brand(id);
  }
  // «النسبة الخاصة»: a new dated row (rate null = no special rate from that date); unique (brand_id, since) is never rewritten
  function setBrandRate(id, rate, since, actor) {
    const b = brandMust(id); if (!canRate()) throw noPerm();
    const r = rateOf(rate); if (r != null && (!Number.isFinite(r) || r < 0 || r > 65)) throw new Error('rate out of range'); if (!isIso(since)) throw new Error('since required');
    if (b.rates.some((x) => x.since === since)) throw new Error(MESSAGES.duplicate);
    const ownerId = ownerOf(b, today()); const old = copy(b);
    b.rates = b.rates.concat([{ id: 0, rate: r, since, by: (actor && actor.name) || '' }]).sort(bySince); brandRatesOk = true; syncVendorBrands();
    emit({ id: ownerId, changed: ['brands'] });
    writeBrand(id, old, () => call((cl) => cl.from('brand_rates').insert({ brand_id: String(id), rate: r, since, set_by: (actor && actor.name) || null })), () => logEvent('vendor.brand.rate', b.name + ': ' + (r == null ? '—' : r + '%') + ' من ' + since, ownerId), [ownerId]);
    return brand(id);
  }
  // a new history row (a transfer or a return): the local rules first (block 06 validateTransfer against the latest row — the server's
  // guard compares with the same row), then one insert; two events, one on each maker, with the same text
  function moveBrand(id, toId, opts, actor, action) {
    const b = brandMust(id); const to = must(toId); if (!canBrands()) throw noPerm();
    const o = opts || {}; const since = o.since || today(); const returnOn = o.returnOn || null; const last = lastRow(b); const from = last ? last.vendor : b.origin;
    const errs = transferErrs({ since, lastSince: last ? last.since : null, returnOn, toId: String(toId), ownerId: from });
    const first = ['to', 'since', 'returnOn'].find((k) => errs[k]); if (first) throw new Error(errs[first]);
    const reason = clean(o.reason, 200) || null; const by = (actor && actor.name) || null;
    const old = copy(b);
    b.history = b.history.concat([{ id: Number.MAX_SAFE_INTEGER, vendor: String(toId), since, returnOn, reason, by: by || '' }]).sort(bySince); syncVendorBrands();
    emit({ id: from, changed: ['brands'] }); emit({ id: String(toId), changed: ['brands'] });
    const txt = b.name + ' → ' + to.name + ' من ' + since + (returnOn ? ' لحد ' + returnOn : '');
    writeBrand(id, old, () => call((cl) => cl.from('brand_owners').insert({ brand_id: String(id), vendor_id: String(toId), since, return_on: returnOn, reason, set_by: by })),
      () => Promise.all([logEvent('vendor.brand.' + action, txt, from), logEvent('vendor.brand.' + action, txt, String(toId))]), [from, String(toId)]);
    return brand(id);
  }
  const transferBrand = (id, toId, opts, actor) => moveBrand(id, toId, opts, actor, 'transfer');
  // «رجوع لصاحبه»: to the maker before a temporary transfer (the row in force today carries return_on), else to the origin; refused
  // when the brand is already there
  function returnBrand(id, opts, actor) {
    const b = brandMust(id); if (!canBrands()) throw noPerm();
    const back = backOf(b, today()); const last = lastRow(b); if (back === (last ? last.vendor : b.origin)) throw new Error(MESSAGES.brand_with_origin);
    return moveBrand(id, back, { since: (opts && opts.since) || today(), reason: 'رجوع لصاحبه' }, actor, 'return');
  }
  // that vendor's activity_log (entity 'vendor'), newest 50, kept ascending for the drawer
  async function fetchEvents(id) {
    const k = String(id);
    const r = await call((cl) => cl.from('activity_log').select(COLS.event).eq('entity', 'vendor').eq('entity_id', k).order('at', { ascending: false }).limit(EVENTS));
    if (r.ok) timeline.set(k, (r.data || []).slice().reverse().map(toEvent)); else if (!timeline.has(k)) timeline.set(k, []);
    return events(k);
  }
  // the drawer opening on a vendor: its events, and a fresh reveal log (the refresh after a write keeps it)
  function loadEvents(id) { revealed.delete(String(id)); return fetchEvents(id); }

  // ---------- stats: block 28's per-vendor numbers from the loaded orders ----------
  function stats() {
    const out = {}; const OA = window.OrdersApp; const rows = OA && OA.query ? OA.query({}, 10000).rows : [];
    const d = window.IBOrders && window.IBOrders.data ? window.IBOrders.data() : null; const full = new Map(((d && d.orders) || []).map((o) => [String(o.id), o]));
    for (const v of vendors.values()) {
      const mine = []; let noRate = 0; const by = { c: { n: 0, sales: 0, earned: 0 }, p: { n: 0, sales: 0, earned: 0 }, x: { n: 0, sales: 0, earned: 0 } };
      for (const r of rows) {
        // decision 4 (phase 3.2): a sub with its store's uuid belongs to whoever owned the store's brand on the order's date; a sub without
        // one (not on the live data) is matched by name as before. An order the adapter knows with no line of his is skipped.
        const o = full.get(String(r.id)); const lines = o ? (o.subs || []).filter((s) => (s.vendorId ? storeOwnerAt(s.vendorId, o.date) === v.id : s.vendor === v.name)) : [];
        if (!lines.length && (o || !(r.vendors || []).includes(v.name))) continue;
        let sales = 0, share = 0; for (const s of lines) { const x = lineShare(s, v, o.date); sales += Number(s.tot) || 0; share += x.share; if (x.noRate) noRate += 1; }
        const k = kindOf(r.status); by[k].n += 1; by[k].sales += sales; by[k].earned += share;
        mine.push(Object.assign({}, r, { sales: r2(sales), share: r2(share) }));
      }
      const open = mine.filter((r) => kindOf(r.status) === 'p');
      const earned = r2(by.c.earned);
      out[v.id] = { orders: mine, open: open.length, late: open.filter((r) => r.delivery !== 'ok').length, lastAge: mine.length ? Math.min(...mine.map((r) => Number(r.ageDays) || 0)) : null,
        sales: r2(by.c.sales), earned, ibtekrShare: r2(by.c.sales - by.c.earned), pending: r2(by.p.earned), pendingSales: r2(by.p.sales), noRate,
        openingBalance: v.openingBalance, balance: r2(v.openingBalance + earned), deposits: 0, transport: { total: 0, trips: 0, last: null }, tickets: [], seed: null,
        byStatus: { c: [by.c.n, r2(by.c.sales), r2(by.c.earned)], p: [by.p.n, r2(by.p.sales), r2(by.p.earned)], x: [by.x.n, r2(by.x.sales), r2(by.x.earned)] } };
    }
    return out;
  }

  const store = { get, all, events, update, setRate, setBank, reveal, setContract, findByName, remove, restoreMoney, create, addLogin, setLogin, setLoginStatus, setLoginPassword, revealPassword, usernameTaken, missing, canEdit, canBank, canToggle, canRate, canLogin, canBrands, actor,
    brand, allBrands, brandByName, namesOf, ownerAt, storeOwnerAt, rateFor, addBrand, updateBrand, setBrandRate, transferBrand, returnBrand,
    setCategoryRate, categories, canPush, pushVendor }; // phase 3.3
  window.IBVendors = { load, state: () => st, data, clear, store, loadEvents, events, setContract, contractUrl, stats, toVendor, toBrand, lineShare, rateAt, rateFor, storeOwnerAt, safeName, norm, today, MESSAGES, BUCKET, SYNC_FIELDS, toEvent, categories };
})();
