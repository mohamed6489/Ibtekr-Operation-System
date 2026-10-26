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
(function () {
  'use strict';
  const PAGE = 1000; // PostgREST max_rows
  const COLS = {
    vendor: 'id, woo_vendor_id, name, aliases, phone, email, status, raw, created_at, updated_at, legal_name, category, alt_phone, address, instagram, store_url, lead_days, deposit_policy, notes, joined_at, contract, opening_balance',
    rate: 'id, vendor_id, rate, since, set_by, created_at',
    bank: 'vendor_id, method, bank_name, holder, iban, wallet, updated_by, updated_at',
    event: 'id, at, action, new_value, actor:profiles(name)',
  };
  const BUCKET = 'vendor-contracts'; const SIGN_SECONDS = 60; const EVENTS = 50;
  const CONTRACT_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  const CONTRACT_MAX = 10 * 1024 * 1024;
  const PAY_METHODS = ['bank', 'instapay', 'wallet', 'cash'];
  // the vendors columns the team writes, by the prototype's field names
  const COL = { name: 'name', legalName: 'legal_name', category: 'category', aliases: 'aliases', status: 'status', phone: 'phone', altPhone: 'alt_phone', email: 'email', address: 'address', instagram: 'instagram', storeUrl: 'store_url', leadDays: 'lead_days', depositPolicy: 'deposit_policy', notes: 'notes', joinedAt: 'joined_at' };
  const MESSAGES = { forbidden: 'مش من صلاحياتك', network: 'الشبكة مش متاحة — التغيير ما اتحفظش، جرّب تاني', in_use: 'ماينفعش يتمسح — عليه أوردرات', too_large: 'الملف أكبر من 10 ميجا', bad_type: 'نوع الملف مش مقبول — PDF أو صورة (PNG / JPG) بس', duplicate: 'فيه نسبة متسجلة بنفس تاريخ السريان — اختار تاريخ تاني' };
  const DONE = ['مكتمل']; const OUT = ['ملغي', 'استرجاع', 'فشل', 'مرتجع', 'مسترد', 'ملغي / مرتجع'];
  let vendors = new Map(); const timeline = new Map(); const revealed = new Map(); let gen = 0; let st = 'idle'; let ratesOk = false;
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
  function lineShare(line, v, date) {
    const tot = Number(line.tot) || 0;
    if (line.rate != null && Number.isFinite(Number(line.rate))) return { share: r2(tot - (tot * Number(line.rate) / 100 + (Number(line.fee) || 0))), noRate: false };
    if (v && v.ratesVisible && (v.rateHistory || []).length) { const r = Number(rateAt(v, date)) || 0; return { share: r2(tot * (1 - r / 100)), noRate: false }; }
    return { share: r2(tot), noRate: true };
  }
  const kindOf = (status) => (DONE.includes(status) ? 'c' : OUT.includes(status) ? 'x' : 'p');

  // ---------- the vendor shape (pure) ----------
  // a vendors row + its vendor_rates rows + its vendor_bank row (or null) → the prototype's vendor; opts.ratesVisible says
  // whether the caller may see the rates (rate / rateSince / rateHistory stay null / [] otherwise); opts.today for the effective rate
  function toVendor(r, rates, bank, opts = {}) {
    const T = (opts && opts.today) || today(); const visible = !!(opts && opts.ratesVisible);
    const hist = (rates || []).filter((x) => x.vendor_id == null || String(x.vendor_id) === String(r.id)).map((x) => ({ rate: Number(x.rate), since: localDate(x.since), by: text(x.set_by) })).filter((x) => Number.isFinite(x.rate) && x.since).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    let cur = null; for (const x of hist) if (x.since <= T) cur = x; if (!cur && hist.length) cur = hist[0];
    const raw = r.raw && typeof r.raw === 'object' ? r.raw : {};
    const ct = r.contract && typeof r.contract === 'object' ? r.contract : null;
    const contract = ct && ct.file_name ? { fileName: text(ct.file_name), size: Number(ct.size) || 0, expires: ct.expires || null, uploadedBy: text(ct.uploaded_by), uploadedAt: text(ct.uploaded_at), path: text(ct.path) } : null;
    const b = bank ? { method: PAY_METHODS.includes(bank.method) ? bank.method : 'bank', bankName: bank.bank_name || null, holder: bank.holder || null, iban: bank.iban || null, wallet: bank.wallet || null } : null;
    const name = text(r.name);
    return { id: String(r.id), name, legalName: r.legal_name || null, category: r.category || null, aliases: parseAliases(r.aliases || []), status: r.status === 'inactive' ? 'inactive' : 'active',
      phone: r.phone || null, altPhone: r.alt_phone || null, email: r.email || null, address: r.address || null, instagram: r.instagram || null, storeUrl: r.store_url || null,
      rate: visible && cur ? cur.rate : null, rateSince: visible && cur ? cur.since : null, rateHistory: visible ? hist : [], ratesVisible: visible,
      leadDays: Number(r.lead_days) || 7, depositPolicy: r.deposit_policy || null, notes: r.notes || null, logoLetter: name.charAt(0),
      joinedAt: localDate(r.joined_at) || localDate(r.created_at) || T, contract, bank: b, openingBalance: Number(r.opening_balance) || 0,
      wooVendorId: r.woo_vendor_id == null ? null : Number(r.woo_vendor_id), shopUrl: text(raw.shop_url), createdAt: text(r.created_at), lastUpdate: text(r.updated_at) || text(r.created_at) };
  }
  const contractRow = (ct) => (ct ? { path: ct.path || null, file_name: ct.fileName, size: ct.size, expires: ct.expires || null, uploaded_by: ct.uploadedBy, uploaded_at: ct.uploadedAt } : null);
  // an activity_log row → the drawer's timeline event (text in the actor's voice, like the prototype's events)
  const VERB = { 'vendor.create': 'أضاف المبتكر', 'vendor.update': 'عدّل بيانات المبتكر', 'vendor.status': 'غيّر حالة المبتكر', 'vendor.rate': 'غيّر نسبة إبتكر', 'vendor.bank': 'عدّل بيانات الحساب البنكي', 'vendor.reveal': 'أظهر', 'vendor.contract': 'رفع عقد التعاون', 'vendor.remove': 'حذف المبتكر', 'vendor.share': 'شارك أوردرات المبتكر' };
  function toEvent(r) {
    const actor = (r.actor && r.actor.name) || '—'; const detail = typeof r.new_value === 'string' ? r.new_value : r.new_value == null ? '' : JSON.stringify(r.new_value);
    return { id: r.id, at: r.at, action: r.action, actor: { name: actor }, text: actor + ' ' + (VERB[r.action] || r.action) + (detail ? ' (' + detail + ')' : '') };
  }

  // ---------- permissions (IBDirectory: has_perm's rule; the server is the judge) ----------
  const perm = (key) => { const D = window.IBDirectory; return D && D.perm ? D.perm(key) : 'N'; };
  const isAdmin = () => { const D = window.IBDirectory; const me = D && D.me && D.me(); return !!me && me.role_id === 'admin' && me.status === 'active'; };
  const canEdit = () => perm('vendors.edit') !== 'N';
  const canBank = () => perm('sensitive.vendor_bank') === 'F';
  const canToggle = () => perm('vendors.toggle') === 'F';
  const canRate = () => perm('sensitive.commission') === 'F';
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
      const [vs, rs, bs] = await Promise.all([
        pages(() => cl.from('vendors').select(COLS.vendor).order('name', { ascending: true }).order('id', { ascending: true }), g),
        cl.from('vendor_rates').select(COLS.rate).order('since', { ascending: true }).order('id', { ascending: true }),
        cl.from('vendor_bank').select(COLS.bank),
      ]);
      stale(g);
      ratesOk = !rs.error; const visible = ratesOk && canRate();
      const byVendor = new Map(); (rs.error ? [] : rs.data || []).forEach((x) => { const k = String(x.vendor_id); if (!byVendor.has(k)) byVendor.set(k, []); byVendor.get(k).push(x); });
      const bankOf = new Map((bs.error ? [] : bs.data || []).map((b) => [String(b.vendor_id), b]));
      const T = today();
      vendors = new Map(vs.map((r) => [String(r.id), toVendor(r, byVendor.get(String(r.id)) || [], bankOf.get(String(r.id)) || null, { ratesVisible: visible, today: T })]));
      setState('ready');
    } catch (e) { if (g === gen) setState('error'); /* offline or refused: the screen keeps what it had; cleared: 'idle' */ }
  }
  function clear() { gen += 1; vendors = new Map(); timeline.clear(); revealed.clear(); ratesOk = false; setState('idle'); }
  const data = () => (st === 'ready' ? { vendors: all(), ratesVisible: ratesOk && canRate() } : null);

  // ---------- the store ----------
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const get = (id) => { const v = vendors.get(String(id)); return v ? copy(v) : null; };
  const all = () => [...vendors.values()].map(copy);
  const must = (id) => { const v = vendors.get(String(id)); if (!v) throw new Error('vendor not found: ' + id); return v; };
  const events = (id) => (timeline.get(String(id)) || []).slice();
  function findByName(name) { const n = norm(name); if (!n) return null; for (const v of vendors.values()) { if (norm(v.name) === n || v.aliases.some((a) => norm(a) === n)) return copy(v); } return null; }
  const fail = (reason) => ({ ok: false, reason });
  const reasonOf = (e) => (!e ? 'network' : e.code === '42501' || e.status === 403 || e.status === 401 || e.statusCode === '403' || e.statusCode === '401' ? 'forbidden' : e.code === '23503' ? 'in_use' : e.code === '23505' ? 'duplicate' : e.statusCode === '413' || e.status === 413 ? 'too_large' : e.statusCode === '415' || e.status === 415 ? 'bad_type' : 'network');
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
  // the server write of a local change already applied to `v` (the row in the map): a refusal puts `old` back (unless a reload
  // replaced the row meanwhile) and announces the reason; a success logs, reloads (the server's row is the truth) and announces
  async function write(id, v, old, run, logged) {
    const r = await run();
    if (!r.ok) {
      const now = vendors.get(id); // a removed row: v is null and the map has nothing
      if (v ? now === v : now === undefined) { if (old) vendors.set(id, old); else vendors.delete(id); }
      emit({ id, reason: r.reason }); return r;
    }
    await Promise.all([logged ? logged() : undefined, load()]);
    emit({ id, written: true });
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
    if (typeof nv === 'string') return clean(nv, k === 'notes' ? 500 : k === 'address' || k === 'storeUrl' ? 200 : 120) || null;
    return nv;
  }
  // a patch in the prototype's field names → the changed vendors columns of `v` (the server guard checks per column)
  function update(id, patch, actor) {
    const v = must(id); if (!canEdit()) throw noPerm();
    if (patch.status !== undefined && patch.status !== v.status && !canToggle()) throw noPerm(); // the guard's rule 1 (vendors.toggle)
    const errs = validate(Object.assign({}, v, { aliases: v.aliases.join('،') }, patch)); invalid(errs, Object.keys(patch).filter((k) => patch[k] !== undefined));
    if (patch.joinedAt !== undefined && patch.joinedAt && !isIso(patch.joinedAt)) throw new Error('invalid vendor: joinedAt');
    const old = copy(v); const row = {}; const changed = [];
    for (const k of Object.keys(COL)) {
      if (patch[k] === undefined) continue;
      const nv = k === 'joinedAt' ? (patch[k] || null) : cleanField(k, patch[k]);
      if (JSON.stringify(nv) === JSON.stringify(v[k])) continue;
      changed.push(k); v[k] = nv; row[COL[k]] = nv;
    }
    if (!changed.length) return get(id);
    if (changed.includes('name')) v.logoLetter = v.name.charAt(0);
    v.lastUpdate = new Date().toISOString();
    emit({ id, changed });
    const fields = changed.filter((k) => k !== 'status');
    write(id, v, old, () => call((cl) => cl.from('vendors').update(row).eq('id', id)), () => Promise.all([
      changed.includes('status') ? logEvent('vendor.status', v.status, id) : undefined,
      fields.length ? logEvent('vendor.update', fields.join(', '), id) : undefined,
      changed.includes('name') && window.IBOrders && window.IBOrders.load ? quiet(() => window.IBOrders.load()) : undefined, // the orders carry vendors.name (decision 11)
    ]));
    return get(id);
  }
  function setRate(id, rate, since, actor) {
    const v = must(id); if (!canRate()) throw noPerm();
    const r = Number(latin(rate)); if (!Number.isFinite(r) || r < 0 || r > 65) throw new Error('rate out of range'); if (!isIso(since)) throw new Error('since required');
    if (v.rateHistory.some((x) => x.since === since)) throw new Error(MESSAGES.duplicate); // unique (vendor_id, since): rates are never rewritten
    const old = copy(v); const T = today();
    v.rateHistory = v.rateHistory.filter((x) => x.since !== since).concat([{ rate: r, since, by: actor && actor.name }]).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    let cur = null; for (const x of v.rateHistory) if (x.since <= T) cur = x; if (!cur) cur = v.rateHistory[0];
    v.rate = cur.rate; v.rateSince = cur.since; v.ratesVisible = true; v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['rate'] });
    write(id, v, old, () => call((cl) => cl.from('vendor_rates').insert({ vendor_id: id, rate: r, since, set_by: (actor && actor.name) || null })), () => logEvent('vendor.rate', r + '% من ' + since, id));
  }
  function setBank(id, bank, actor) {
    const v = must(id); if (!canBank()) throw noPerm();
    const old = copy(v); const had = !!v.bank;
    v.bank = { method: PAY_METHODS.includes(bank.method) ? bank.method : 'bank', bankName: clean(bank.bankName, 80) || null, holder: clean(bank.holder, 120) || null, iban: latin(bank.iban || '').replace(/\s/g, '') || null, wallet: latin(bank.wallet || '').replace(/\s/g, '') || null };
    v.lastUpdate = new Date().toISOString();
    emit({ id, changed: ['bank'] });
    const row = { method: v.bank.method, bank_name: v.bank.bankName, holder: v.bank.holder, iban: v.bank.iban, wallet: v.bank.wallet, updated_by: (actor && actor.name) || null, updated_at: new Date().toISOString() };
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
  // the add-vendor modal: the row, then its first rate when the caller may set rates; resolves after the reload with the vendor
  async function create(input, actor) {
    if (!(isAdmin() || perm('vendors.edit') === 'F')) throw noPerm(); // vendors_insert: vendors.edit = F
    invalid(validate(input));
    const row = {}; for (const k of Object.keys(COL)) { if (k === 'joinedAt') continue; const nv = cleanField(k, input[k] === undefined ? '' : input[k]); if (nv !== null && nv !== '' && !(Array.isArray(nv) && !nv.length)) row[COL[k]] = nv; }
    row.name = clean(input.name, 80); row.status = input.status; row.lead_days = Number(latin(input.leadDays)); row.aliases = parseAliases(input.aliases || '');
    row.joined_at = input.joinedAt && isIso(input.joinedAt) ? input.joinedAt : today();
    const r = await call((cl) => cl.from('vendors').insert(row).select('id').single());
    if (!r.ok || !r.data || r.data.id == null) throw new Error(MESSAGES[r.ok ? 'network' : r.reason]);
    const id = String(r.data.id); const rate = Number(latin(input.rate));
    const logs = [logEvent('vendor.create', row.name, id)];
    if (canRate() && Number.isFinite(rate)) { // a refused first rate does not undo the vendor
      const since = input.rateSince && isIso(input.rateSince) ? input.rateSince : today();
      const rr = await call((cl) => cl.from('vendor_rates').insert({ vendor_id: id, rate, since, set_by: (actor && actor.name) || null }));
      if (rr.ok) logs.push(logEvent('vendor.rate', rate + '% من ' + since, id));
    }
    await Promise.all(logs.concat([load()]));
    emit({ id, written: true });
    return get(id) || { id, name: row.name };
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
        const o = full.get(String(r.id)); const lines = o ? (o.subs || []).filter((s) => s.vendor === v.name) : [];
        if (!lines.length && !(r.vendors || []).includes(v.name)) continue;
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

  const store = { get, all, events, update, setRate, setBank, reveal, setContract, findByName, remove, restoreMoney, create, canEdit, canBank, canToggle, canRate, actor };
  window.IBVendors = { load, state: () => st, data, clear, store, loadEvents, events, setContract, contractUrl, stats, toVendor, lineShare, rateAt, safeName, norm, today, MESSAGES, BUCKET };
})();
