
/* Ibtekr Vendors (المبتكرين) — domain layer. Pure: no DOM, no I/O. UMD.
   The Vendors table is the master: stable Vendor ID, canonical name + aliases, commission rate with effective date (new orders only),
   lead days (feeds the delay rule), contract with expiry, masked bank data visible to admin + accounts only. Every change is an event. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrVendors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ADMIN = 'مدير النظام', ACCOUNTS = 'الحسابات', VENDOR_FOLLOW = 'متابعة الموردين';
  const CATEGORIES = Object.freeze(['ديكور منزلي', 'إكسسوارات ومجوهرات', 'ملابس ومنسوجات', 'فنون ولوحات', 'هدايا', 'مستلزمات حرف', 'أطعمة وحلويات']);
  const STATUSES = Object.freeze([['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط']]);
  const PAY_METHODS = Object.freeze([['bank', 'تحويل بنكي'], ['instapay', 'إنستاباي'], ['wallet', 'محفظة إلكترونية (فودافون كاش)'], ['cash', 'نقدي عند التسليم']]);
  const CONTRACT_TYPES = Object.freeze(['pdf', 'png', 'jpg', 'jpeg']);
  const CONTRACT_MAX = 10 * 1024 * 1024, EXPIRY_WARN_DAYS = 30, DAY = 86400000;
  const label = (list, k) => { const f = list.find((x) => x[0] === k); return f ? f[1] : k; };
  const latin = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const isIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3]; };
  const phoneOk = (p) => /^01[0-9]{9}$/.test(latin(p).replace(/[\s-]/g, ''));
  const norm = (s) => clean(latin(s), 80).toLowerCase().replace(/[\s_.-]+/g, ' ');
  const parseAliases = (s) => clean(s, 400).split(/[,،]/).map((x) => x.trim()).filter(Boolean);

  // Login + payout data (owner 26 Oct, phase 3.1 decision 7): every maker gets a portal login (username + email + password) and payout
  // details at creation. Pure rules only — the login's life cycle (invite, temporary password, reveal) lives on the server (vendor_logins).
  const LOGIN_STATUS = Object.freeze([['none', 'مفيش حساب دخول'], ['invited', 'مستني التفعيل'], ['active', 'مفعّل'], ['disabled', 'موقوف']]);
  const userOk = (u) => /^[a-z0-9][a-z0-9._]{2,29}$/.test(String(u || ''));
  const emailOk = (m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(m, 120));
  function passwordIssues(p) { const s = String(p || ''); const out = []; if (s.length < 8) out.push('8 حروف على الأقل'); if (!/[A-Za-z]/.test(s)) out.push('حرف إنجليزي'); if (!/[0-9]/.test(s)) out.push('رقم'); if (/\s/.test(s)) out.push('من غير مسافات'); return out; }
  // genPassword (controller amendment to decision 7, CWE-338): the prototype's alphabet and shape (a letter, a digit, then up to 10 from
  // both), but every index comes from crypto.getRandomValues with rejection sampling (no modulo bias) and the shuffle is Fisher–Yates;
  // `rand` (a function → [0, 1)) is injected by tests only.
  function genPassword(rand) {
    const pick = (n) => { if (rand) return Math.floor(rand() * n); const buf = new Uint32Array(1); const lim = 0x100000000 - (0x100000000 % n); do { crypto.getRandomValues(buf); } while (buf[0] >= lim); return buf[0] % n; };
    const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', N = '23456789', A = L + N;
    const s = [L[pick(L.length)], N[pick(N.length)]]; while (s.length < 10) s.push(A[pick(A.length)]);
    for (let i = s.length - 1; i > 0; i -= 1) { const j = pick(i + 1); const t = s[i]; s[i] = s[j]; s[j] = t; }
    return s.join('');
  }
  function suggestUsername(name, taken) { const base = latin(name).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24) || 'maker'; let u = base.length < 3 ? base + '.ib' : base; let i = 2; while (taken && taken(u)) u = base + i++; return u; }
  const ibanOk = (x) => /^EG\d{27}$/.test(x) || /^\d{8,20}$/.test(x);
  function validateLogin(l) {
    const e = {}; const u = String(l.username || '').trim().toLowerCase();
    if (!u) e.username = 'اكتب اسم المستخدم'; else if (!userOk(u)) e.username = 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس';
    if (!clean(l.email, 120)) e.email = 'اكتب الإيميل — عليه بيوصل استرجاع الباسورد من بوابة المبتكر'; else if (!emailOk(l.email)) e.email = 'اكتب إيميل صحيح';
    if (l.pwMode === 'temp') { const iss = passwordIssues(l.password); if (iss.length) e.password = 'الباسورد لازم: ' + iss.join('، '); } // pwMode temp = this form carries the temporary password (the only mode since 26 Oct: no invite link)
    return e;
  }
  function validateBank(b) {
    const e = {}; const m = b.method; if (!PAY_METHODS.some((x) => x[0] === m)) { e.method = 'اختار طريقة التحويل'; return e; }
    if (m === 'cash') return e;
    if (!clean(b.holder, 120)) e.holder = 'اكتب اسم صاحب الحساب زي ما هو في البنك';
    if (m === 'bank') { if (!clean(b.bankName, 80)) e.bankName = 'اكتب اسم البنك'; const ib = latin(b.iban || '').replace(/\s/g, '').toUpperCase(); if (!ib) e.iban = 'اكتب IBAN أو رقم الحساب'; else if (!ibanOk(ib)) e.iban = 'IBAN مصري = EG + 27 رقم، أو رقم حساب من 8 لـ 20 رقم'; }
    else { const w = latin(b.wallet || '').replace(/[\s-]/g, ''); if (!w) e.wallet = m === 'instapay' ? 'اكتب رقم الموبايل أو عنوان إنستاباي' : 'اكتب رقم المحفظة'; else if (!(phoneOk(w) || (m === 'instapay' && /^[a-z0-9._-]+@instapay$/i.test(w)))) e.wallet = m === 'instapay' ? 'رقم موبايل (01…) أو عنوان زي name@instapay' : 'رقم موبايل مصري 11 رقم'; }
    return e;
  }

  function validateVendor(input) {
    const e = {};
    if (!clean(input.name, 80)) e.name = 'اكتب اسم المبتكر';
    if (!CATEGORIES.includes(input.category)) e.category = 'اختار الفئة';
    if (!phoneOk(input.phone)) e.phone = 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)';
    const rate = Number(latin(input.rate)); if (!Number.isFinite(rate) || rate < 0 || rate > 65) e.rate = 'النسبة من 0% إلى 65%';
    const lead = Number(latin(input.leadDays)); if (!Number.isInteger(lead) || lead < 1 || lead > 60) e.leadDays = 'مدة التجهيز من 1 إلى 60 يوم';
    if (!STATUSES.some((s) => s[0] === input.status)) e.status = 'اختار الحالة';
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(input.email, 120))) e.email = 'اكتب إيميل صحيح';
    if (input.altPhone && !phoneOk(input.altPhone)) e.altPhone = 'اكتب رقم موبايل صحيح';
    return e;
  }
  // Drawer edit groups — each section of «ملف المبتكر» has its own «تعديل» popup with only its fields (rate has its own dated flow inside «الاتفاق التجاري»).
  const EDIT_GROUPS = Object.freeze({
    identity: Object.freeze({ title: 'بيانات الهوية', fields: Object.freeze(['name', 'legalName', 'category', 'aliases', 'status']) }),
    contact: Object.freeze({ title: 'بيانات الاتصال', fields: Object.freeze(['phone', 'altPhone', 'email', 'address', 'instagram', 'storeUrl']) }),
    terms: Object.freeze({ title: 'بيانات الاتفاق التجاري', fields: Object.freeze(['leadDays', 'depositPolicy', 'notes']) }) });
  const group = (g) => { const x = EDIT_GROUPS[g]; if (!x) throw new Error('unknown edit group: ' + g); return x; };
  function groupPatch(g, form) { const out = {}; for (const k of group(g).fields) if (form[k] !== undefined) out[k] = form[k]; return out; }
  function validateGroup(g, current, form) { const fields = group(g).fields; const e = validateVendor(Object.assign({}, current, groupPatch(g, form))); const out = {}; for (const k of Object.keys(e)) if (fields.includes(k)) out[k] = e[k]; return out; }
  // Drawer tabs «الأوردرات» + «الحسابات» (owner, 21 Oct): counts, performance summary, account ledger. Pure.
  const CANCELLED = ['ملغي', 'مرتجع', 'مسترد', 'ملغي / مرتجع'];
  const isDone = (o) => o.status === 'مكتمل', isCancel = (o) => CANCELLED.includes(o.status);
  function orderCounts(orders) { const completed = orders.filter(isDone).length, cancelled = orders.filter(isCancel).length; return { total: orders.length, completed, inProgress: orders.length - completed - cancelled, cancelled }; }
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  function performance(orders, leadDays) {
    const c = orderCounts(orders); const live = orders.filter((o) => !isCancel(o)); const open = live.filter((o) => !isDone(o));
    const onTime = live.filter((o) => isDone(o) || o.delivery === 'ok').length; const late = open.filter((o) => o.delivery !== 'ok').length;
    const r = { completionPct: pct(c.completed, c.total), onTimePct: pct(onTime, live.length), cancelPct: pct(c.cancelled, c.total), late, avgOpenAge: open.length ? Math.round(open.reduce((s, o) => s + (o.ageDays || 0), 0) / open.length) : 0, leadDays };
    r.verdict = !c.total ? 'لسه مفيش أوردرات' : (r.cancelPct > 20 || r.onTimePct < 70) ? 'محتاج متابعة' : (late > 0 || r.cancelPct > 10 || r.onTimePct < 90) ? 'جيد' : 'ممتاز';
    return r;
  }
  const ORDER_KINDS = Object.freeze({ all: 'كل الأوردرات', completed: 'الأوردرات المكتملة', inProgress: 'الأوردرات قيد التنفيذ', cancelled: 'الأوردرات الملغية / المرتجعة', risk: 'قابل للتأخير', late: 'متأخر', onTime: 'غير متأخر' });
  const isOpen = (o) => !isDone(o) && !isCancel(o);
  const KIND_FN = { all: () => true, completed: isDone, inProgress: isOpen, cancelled: isCancel, risk: (o) => isOpen(o) && o.delivery === 'risk', late: (o) => isOpen(o) && o.delivery === 'late', onTime: (o) => isOpen(o) && o.delivery === 'ok' };
  function ordersByKind(orders, kind) { const f = KIND_FN[kind]; if (!f) throw new Error('unknown order kind: ' + kind); return orders.filter(f); }
  function delayCounts(orders) { return { risk: ordersByKind(orders, 'risk').length, late: ordersByKind(orders, 'late').length, onTime: ordersByKind(orders, 'onTime').length }; }
  const DELAY_LABEL = { risk: 'قابل للتأخير', late: 'متأخر', ok: 'غير متأخر' };
  function shareText(title, rows) {
    const lines = [title, rows.length ? rows.length + ' أوردر' : 'مفيش أوردرات'];
    for (const o of rows) lines.push('• ' + ['IB-' + o.id, o.customer, o.status].concat(isOpen(o) ? [DELAY_LABEL[o.delivery] || DELAY_LABEL.ok] : []).concat([o.ageDays + ' يوم']).join(' · '));
    return lines.join('\n');
  }
  const waPhone = (p) => { const d = latin(p || '').replace(/\D/g, ''); return d ? '20' + d.replace(/^0/, '') : ''; };
  const r2 = (n) => Math.round(n * 100) / 100;
  function ledger(seed, balance, deposits, transport) {
    const s = seed || { c: [0, 0, 0], p: [0, 0, 0], x: [0, 0, 0] }; const earned = r2(s.c[1] - s.c[2]); const tr = r2(Number(transport) || 0);
    return { sales: r2(s.c[1]), ibtekrShare: r2(s.c[2]), earned, transport: tr, pending: r2(s.p[1] - s.p[2]), received: Math.max(0, r2(earned - tr - balance)), balance: r2(balance), deposits: r2(deposits), position: balance < 0 ? 'عليه' : balance > 0 ? 'له' : 'متصفّي' };
  }
  const isAdmin = (a) => !!a && a.role === ADMIN;
  const canEdit = (a) => !!a && (a.role === ADMIN || a.role === VENDOR_FOLLOW);
  const canSeeBank = (a) => !!a && (a.role === ADMIN || a.role === ACCOUNTS);
  const noPerm = () => new Error('مفيش صلاحية للإجراء ده');
  const mask = (v) => { const s = latin(v || '').replace(/\s/g, ''); if (!s) return '—'; const tail = s.slice(-4); return (s.length > 8 ? '•••• •••• •••• ' : '•••• ') + tail; };
  function rateAt(v, isoDate) { let r = v.rateHistory[0] ? v.rateHistory[0].rate : v.rate; for (const h of v.rateHistory) if (h.since <= isoDate) r = h.rate; return r; }
  function contractStatus(v, today) {
    const c = v.contract; if (!c || !c.fileName) return 'missing';
    if (c.expires) { if (c.expires < today) return 'expired'; const days = Math.round((Date.parse(c.expires) - Date.parse(today)) / DAY); if (days <= EXPIRY_WARN_DAYS) return 'expiring'; }
    return 'uploaded';
  }

  function createStore({ now, seed } = {}) {
    const clock = now || (() => new Date().toISOString());
    const vendors = new Map(); const timeline = new Map(); let seq = 0;
    const today = () => clock().slice(0, 10);
    const event = (id, text, actor, extra) => { const e = Object.freeze(Object.assign({ at: clock(), text, actor: actor && { name: actor.name, role: actor.role } }, extra || {})); timeline.get(id).push(e); vendors.get(id).lastUpdate = e.at; return e; };
    const must = (id) => { const v = vendors.get(id); if (!v) throw new Error('vendor not found: ' + id); return v; };
    const get = (id) => { const v = vendors.get(id); return v ? JSON.parse(JSON.stringify(v)) : null; };
    function create(input, actor) {
      const errs = validateVendor(input); const bad = Object.keys(errs); if (bad.length) throw new Error('invalid vendor: ' + bad.join(','));
      seq += 1; const id = 'VND-' + String(seq).padStart(4, '0'); const at = clock(); const rate = Number(latin(input.rate));
      const v = { id, name: clean(input.name, 80), legalName: clean(input.legalName, 120) || null, category: input.category, aliases: parseAliases(input.aliases), status: input.status,
        phone: latin(input.phone).replace(/[\s-]/g, ''), altPhone: input.altPhone ? latin(input.altPhone).replace(/[\s-]/g, '') : null, email: clean(input.email, 120) || null, address: clean(input.address, 200) || null, instagram: clean(input.instagram, 80) || null, storeUrl: clean(input.storeUrl, 200) || null,
        rate, rateSince: input.rateSince || at.slice(0, 10), rateHistory: [{ rate, since: input.rateSince || at.slice(0, 10), by: actor.name }], leadDays: Number(latin(input.leadDays)), depositPolicy: clean(input.depositPolicy, 120) || null, notes: clean(input.notes, 500) || null,
        logoLetter: clean(input.name, 80).charAt(0), joinedAt: input.joinedAt || at.slice(0, 10), contract: null, bank: null, createdBy: { name: actor.name, role: actor.role }, createdAt: at, lastUpdate: at };
      vendors.set(id, v); timeline.set(id, []);
      event(id, actor.name + ' أضاف المبتكر بنسبة ' + rate + '%', actor);
      return get(id);
    }
    function update(id, patch, actor) {
      const v = must(id); if (!canEdit(actor)) throw noPerm();
      const allowed = ['name', 'legalName', 'category', 'aliases', 'status', 'phone', 'altPhone', 'email', 'address', 'instagram', 'storeUrl', 'leadDays', 'depositPolicy', 'notes', 'logoLetter'];
      const errs = validateVendor(Object.assign({}, v, { aliases: v.aliases.join('،') }, patch)); const bad = Object.keys(errs).filter((k) => patch[k] !== undefined); if (bad.length) throw new Error('invalid vendor: ' + bad.join(','));
      const changed = [];
      for (const k of allowed) { if (patch[k] === undefined) continue; let nv = patch[k]; if (k === 'aliases') nv = Array.isArray(nv) ? nv : parseAliases(nv); if (k === 'leadDays') nv = Number(latin(nv)); if (k === 'phone' || k === 'altPhone') nv = nv ? latin(nv).replace(/[\s-]/g, '') : null; if (typeof nv === 'string') nv = clean(nv, 500) || null; if (JSON.stringify(nv) !== JSON.stringify(v[k])) { changed.push(k); v[k] = nv; } }
      if (changed.length) event(id, actor.name + ' عدّل بيانات المبتكر (' + changed.join('، ') + ')', actor, { fields: changed });
      return get(id);
    }
    function setRate(id, rate, since, actor) {
      const v = must(id); if (!canEdit(actor)) throw noPerm(); const r = Number(latin(rate)); if (!Number.isFinite(r) || r < 0 || r > 65) throw new Error('rate out of range'); if (!isIso(since)) throw new Error('since required');
      const old = v.rate; v.rate = r; v.rateSince = since; v.rateHistory.push({ rate: r, since, by: actor.name }); v.rateHistory.sort((a, b) => (a.since < b.since ? -1 : 1));
      event(id, actor.name + ' غيّر نسبة إبتكر من ' + old + '% إلى ' + r + '% — تنطبق على الأوردرات الجديدة من ' + since, actor, { oldValue: old, newValue: r });
    }
    function setBank(id, bank, actor) {
      const v = must(id); if (!canSeeBank(actor)) throw noPerm();
      v.bank = { method: PAY_METHODS.some((m) => m[0] === bank.method) ? bank.method : 'bank', bankName: clean(bank.bankName, 80) || null, holder: clean(bank.holder, 120) || null, iban: latin(bank.iban || '').replace(/\s/g, '').toUpperCase() || null, wallet: latin(bank.wallet || '').replace(/\s/g, '') || null };
      event(id, actor.name + ' عدّل بيانات الحساب البنكي', actor);
    }
    function reveal(id, field, actor) {
      const v = must(id); if (!canSeeBank(actor)) throw noPerm(); if (!v.bank || !v.bank[field]) return null;
      event(id, actor.name + ' أظهر ' + (field === 'iban' ? 'IBAN' : 'رقم المحفظة'), actor, { sensitive: true });
      return v.bank[field];
    }
    function setContract(id, file, actor) {
      const v = must(id); if (!canSeeBank(actor)) throw noPerm();
      const ext = String(file.fileName || '').split('.').pop().toLowerCase(); if (!CONTRACT_TYPES.includes(ext) || !(file.size > 0 && file.size <= CONTRACT_MAX)) throw new Error('file must be PDF/image up to 10MB');
      if (file.expires && !isIso(file.expires)) throw new Error('expires invalid');
      v.contract = { fileName: clean(file.fileName, 120), size: file.size, expires: file.expires || null, uploadedBy: actor.name, uploadedAt: clock() };
      event(id, actor.name + ' رفع عقد التعاون (' + ext.toUpperCase() + (file.expires ? ' · ساري حتى ' + file.expires : '') + ')', actor);
    }
    const all = () => [...vendors.values()].map((v) => JSON.parse(JSON.stringify(v)));
    const events = (id) => (timeline.get(id) || []).slice();
    function findByName(name) { const n = norm(name); if (!n) return null; for (const v of vendors.values()) { if (norm(v.name) === n || v.aliases.some((a) => norm(a) === n)) return get(v.id); } return null; }
    function remove(id, actor) { must(id); if (!actor || actor.role !== ADMIN) throw noPerm(); vendors.delete(id); timeline.delete(id); return true; }
    // import undo (owner 22 Oct): money fields back to a snapshot taken before the import
    function restoreMoney(id, snap, actor) { const v = must(id); if (!canSeeBank(actor)) throw noPerm(); ['bank', 'contract', 'rate', 'rateSince', 'rateHistory'].forEach((k) => { v[k] = snap[k] === undefined ? v[k] : JSON.parse(JSON.stringify(snap[k])); }); event(id, actor.name + ' رجّع البنك والعقد والنسبة (تراجع عن استيراد)', actor); }
    const api = { create, get, all, events, update, setRate, setBank, reveal, setContract, findByName, remove, restoreMoney };
    if (seed) seed(api);
    return api;
  }

  function summary(list, stats) {
    const st = (v) => stats[v.id] || { open: 0, late: 0, balance: 0, tickets: 0 };
    const active = list.filter((v) => v.status === 'active');
    return { total: list.length, active: active.length, withDelay: active.filter((v) => st(v).late > 0).length, negative: list.filter((v) => st(v).balance < 0).length, negativeTotal: Math.round(list.reduce((s, v) => s + Math.min(0, st(v).balance), 0) * 100) / 100 * -1, due: Math.round(list.reduce((s, v) => s + Math.max(0, st(v).balance), 0) * 100) / 100 };
  }
  // rows behind the 4 vendors-page KPIs (details popups) — same filters as summary()
  function summaryDetails(list, stats) {
    const st = (v) => stats[v.id] || { open: 0, late: 0, balance: 0, deposits: 0, orders: [] };
    const active = list.filter((v) => v.status === 'active');
    const delay = active.filter((v) => st(v).late > 0).map((v) => { const o = st(v).orders || []; const dc = delayCounts(o); const open = o.filter(isOpen); return { id: v.id, name: v.name, risk: dc.risk, late: dc.late, open: st(v).open, oldest: open.length ? Math.max(...open.map((x) => x.ageDays || 0)) : 0 }; }).sort((a, b) => b.late - a.late || b.risk - a.risk);
    const due = list.filter((v) => st(v).balance > 0).map((v) => ({ id: v.id, name: v.name, balance: st(v).balance })).sort((a, b) => b.balance - a.balance);
    const negative = list.filter((v) => st(v).balance < 0).map((v) => ({ id: v.id, name: v.name, balance: st(v).balance, deposits: st(v).deposits || 0 })).sort((a, b) => a.balance - b.balance);
    return { active, delay, due, negative };
  }
  function filterVendors(list, stats, f = {}, today) {
    const q = norm(f.q || ''); const st = (v) => stats[v.id] || { open: 0, late: 0, balance: 0, tickets: 0 };
    const day = today || new Date().toISOString().slice(0, 10);
    const tk = (v) => { const t = st(v).tickets; return Array.isArray(t) ? t.length : (t || 0); };
    return list.filter((v) => {
      if (f.balance === 'due' && !(st(v).balance > 0)) return false;
      if (f.balance === 'negative' && !(st(v).balance < 0)) return false;
      if (f.balance === 'zero' && st(v).balance !== 0) return false;
      if (f.contract && f.contract !== 'all' && contractStatus(v, day) !== f.contract) return false;
      if (f.tickets && !(tk(v) > 0)) return false;
      if ((f.status || 'active') !== 'all' && v.status !== (f.status || 'active')) return false;
      if (f.category && f.category !== 'all' && v.category !== f.category) return false;
      if (f.late && !(st(v).late > 0)) return false;
      if (f.negative && !(st(v).balance < 0)) return false;
      if (f.due && !(st(v).balance > 0)) return false;
      if (q && !(norm(v.name).includes(q) || v.aliases.some((a) => norm(a).includes(q)) || (v.phone || '').includes(latin(q)))) return false;
      return true;
    }).sort((a, b) => st(b).open - st(a).open || st(b).late - st(a).late || a.name.localeCompare(b.name));
  }
  // «فلتر» + «ترتيب حسب» on the vendors page (owner, 22 Oct)
  function activeFilterCount(f = {}) {
    return [(f.status || 'active') !== 'active', f.category && f.category !== 'all', f.balance && f.balance !== 'all', f.contract && f.contract !== 'all', !!f.late, !!f.tickets, !!f.negative && f.balance !== 'negative'].filter(Boolean).length;
  }
  const VENDOR_SORTS = Object.freeze([
    { value: 'open', label: 'الأوردرات المفتوحة (الأكتر)' }, { value: 'late', label: 'قابلة للتأخير (الأكتر)' },
    { value: 'balanceDesc', label: 'الرصيد (الأعلى ليه)' }, { value: 'balanceAsc', label: 'الرصيد (الأعلى عليه)' },
    { value: 'name', label: 'الاسم (أ – ي)' }, { value: 'rate', label: 'نسبة إبتكر (الأعلى)' },
    { value: 'lastOrder', label: 'آخر أوردر (الأحدث)' }, { value: 'joined', label: 'تاريخ الانضمام (الأحدث)' },
    { value: 'transport', label: 'المواصلات (الأعلى)' }]);
  function sortVendors(list, stats, key) {
    const st = (v) => stats[v.id] || { open: 0, late: 0, balance: 0, lastAge: null };
    const age = (v) => (st(v).lastAge == null ? Infinity : st(v).lastAge);
    const by = { open: (a, b) => st(b).open - st(a).open || st(b).late - st(a).late, late: (a, b) => st(b).late - st(a).late || st(b).open - st(a).open,
      balanceDesc: (a, b) => st(b).balance - st(a).balance, balanceAsc: (a, b) => st(a).balance - st(b).balance, name: (a, b) => a.name.localeCompare(b.name, 'ar'),
      rate: (a, b) => b.rate - a.rate, lastOrder: (a, b) => age(a) - age(b), joined: (a, b) => (a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : 0),
      transport: (a, b) => ((st(b).transport || {}).total || 0) - ((st(a).transport || {}).total || 0) }[key] || ((a, b) => st(b).open - st(a).open);
    return list.slice().sort((a, b) => by(a, b) || a.name.localeCompare(b.name));
  }
  // Vendor statement (owner 22 Oct): balance + completed / cancelled counts + every sub-order (photo, order #, value, status).
  // Deliberately carries no Ibtekr share or rate — it is sent to the vendor.
  const REPORT_STATUSES = ['مكتمل', 'ملغي']; // owner 22 Oct: completed + cancelled only
  function vendorReport(orders, names, balance) {
    const keys = (names || []).map(norm); const rows = [];
    for (const o of orders || []) for (const s of o.subs || []) if (keys.includes(norm(s.vendor)) && REPORT_STATUSES.includes(o.st)) rows.push({ oid: String(o.id), sid: String(s.sid), prod: s.prod, sku: s.sku || '', tot: Number(s.tot) || 0, status: o.st });
    rows.sort((a, b) => Number(b.oid) - Number(a.oid) || Number(a.sid) - Number(b.sid));
    const st = new Map(rows.map((r) => [r.oid, r.status])); const cnt = (f) => [...st.values()].filter(f).length;
    return { balance: Number(balance) || 0, orders: st.size, completed: cnt((x) => x === 'مكتمل'), cancelled: cnt((x) => x === 'ملغي'), value: Math.round(rows.reduce((t, r) => t + r.tot, 0) * 100) / 100, rows };
  }
  const money2 = (n) => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function vendorReportText(name, r) {
    return ['تقرير ' + name, 'الرصيد: ' + money2(r.balance) + ' ج.م', 'مكتمل: ' + r.completed + ' · ملغي: ' + r.cancelled + ' · إجمالي الأوردرات: ' + r.orders]
      .concat(r.rows.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · ' + money2(x.tot) + ' · ' + x.status), ['الإجمالي: ' + money2(r.value) + ' ج.م']).join('\n');
  }

  // Biweekly vendor statement (owner 22 Oct): every 14 days from a Saturday anchor; the statement covers the last finished cycle.
  const DAYMS = 86400000; const dms = (d) => Date.parse(d + 'T00:00:00Z'); const dstr = (t) => new Date(t).toISOString().slice(0, 10);
  function biweeklyPeriod(today, anchor) {
    const k = Math.floor((dms(today) - dms(anchor)) / DAYMS / 14); const start = dms(anchor) + k * 14 * DAYMS;
    return { from: dstr(start - 14 * DAYMS), to: dstr(start - DAYMS), due: dstr(start), next: dstr(start + 14 * DAYMS) };
  }
  const SUCCESS = ['مكتمل'], FAILED = ['ملغي', 'استرجاع'];
  function periodStatement(orders, names, range, balance) {
    const keys = (names || []).map(norm); const rows = [];
    for (const o of orders || []) {
      if (!(SUCCESS.includes(o.st) || FAILED.includes(o.st))) continue;
      if (range && ((range.from && o.date < range.from) || (range.to && o.date > range.to))) continue;
      for (const s of o.subs || []) if (keys.includes(norm(s.vendor))) rows.push({ oid: String(o.id), sid: String(s.sid), prod: s.prod, sku: s.sku || '', tot: Number(s.tot) || 0, status: o.st, date: o.date });
    }
    rows.sort((a, b) => Number(b.oid) - Number(a.oid) || Number(a.sid) - Number(b.sid));
    const st = new Map(rows.map((r) => [r.oid, r.status])); const cnt = (f) => [...st.values()].filter(f).length;
    return { balance: Number(balance) || 0, orders: st.size, success: cnt((x) => SUCCESS.includes(x)), failed: cnt((x) => FAILED.includes(x)), cancelled: cnt((x) => x === 'ملغي'), returned: cnt((x) => x === 'استرجاع'), value: r2(rows.reduce((t, r) => t + r.tot, 0)), rows };
  }
  // Owner (22 Oct): what was paid for the vendor inside the statement window — deposits (system «عربون» moves) and transport trips.
  function periodMoney(moves, trips, name, range) {
    const inR = (d) => d && (!range.from || d >= range.from) && (!range.to || d <= range.to); const k = norm(name);
    const dep = (moves || []).filter((m) => norm(m.vendor) === k && m.type === 'عربون' && m.direction === 'deposit' && inR(m.date));
    const tr = (trips || []).filter((t) => t.vendor && norm(t.vendor) === k && inR(t.date));
    return { deposits: r2(dep.reduce((t, m) => t + m.amount, 0)), depositCount: dep.length, transport: r2(tr.reduce((t, x) => t + x.amount, 0)), trips: tr.length };
  }
  function periodStatementText(name, r, range, mo) {
    return ['كشف حساب ' + name + ' — من ' + range.from + ' لـ ' + range.to, 'الرصيد: ' + money2(r.balance) + ' ج.م'].concat(mo ? ['العربون المستلم: ' + money2(mo.deposits) + ' ج.م · المواصلات: ' + money2(mo.transport) + ' ج.م'] : [], [ 'ناجحة: ' + r.success + ' · فاشلة: ' + r.failed + ' (ملغي ' + r.cancelled + ' · مرتجع ' + r.returned + ')'])
      .concat(r.rows.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · ' + money2(x.tot) + ' · ' + x.status)).join('\n');
  }

  // Weekly vendor report (owner 22 Oct): sent every Sunday on WhatsApp — late + in progress (open now), completed in the week,
  // and the actual account = his share of the completed orders (after Ibtekr's rate on each order date) − transport − deposit in the week.
  function weeklyVendorReport(orders, names, range, money, v) {
    const keys = (names || []).map(norm); const late = [], progress = [], completed = []; let share = 0;
    const DONE = ['مكتمل'], OUT = ['ملغي', 'استرجاع'];
    for (const o of orders || []) for (const s of o.subs || []) {
      if (!keys.includes(norm(s.vendor))) continue;
      const row = { oid: String(o.id), sid: String(s.sid), prod: s.prod, sku: s.sku || '', tot: Number(s.tot) || 0, status: o.st, date: o.date, age: o.age || 0, delivery: o.delivery || 'ok', ss: s.ss || '' };
      if (DONE.includes(o.st)) { if (o.date >= range.from && o.date <= range.to) { completed.push(row); const rate = v ? rateAt(v, o.date) : 0; share += row.tot * (1 - rate / 100); } }
      else if (!OUT.includes(o.st) && s.open) (o.delivery === 'late' ? late : progress).push(row);
    }
    late.sort((a, b) => b.age - a.age); progress.sort((a, b) => (a.delivery === 'risk' ? 0 : 1) - (b.delivery === 'risk' ? 0 : 1) || b.age - a.age);
    completed.sort((a, b) => Number(b.oid) - Number(a.oid) || Number(a.sid) - Number(b.sid));
    const m = money || {}; const transport = r2(m.transport || 0), deposits = r2(m.deposits || 0); share = r2(share);
    return { late, progress, completed, completedValue: r2(completed.reduce((t, x) => t + x.tot, 0)), share, transport, deposits, net: r2(share - transport - deposits) };
  }
  function weeklyVendorText(name, r, range) {
    const L = ['التقرير الأسبوعي — ' + name, 'من ' + range.from + ' لـ ' + range.to, '', 'متأخرة (' + r.late.length + ')'].concat(r.late.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · متأخر ' + x.age + ' يوم'),
      ['', 'قيد التنفيذ (' + r.progress.length + ')'], r.progress.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · ' + (x.delivery === 'risk' ? 'قابل للتأخير · ' : '') + 'عمره ' + x.age + ' يوم'),
      ['', 'المكتملة في الأسبوع (' + r.completed.length + ')'], r.completed.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · ' + money2(x.tot)),
      ['', 'مستحقك من المكتملة: ' + money2(r.share) + ' ج.م', 'خصم المواصلات: ' + money2(r.transport) + ' ج.م', 'خصم العربون: ' + money2(r.deposits) + ' ج.م', 'الحساب الفعلي: ' + money2(r.net) + ' ج.م']);
    return L.join('\n');
  }

  // Daily vendor follow-up (owner 22 Oct): replaces the daily «late» alert — late + at risk (open now) + orders confirmed in the window (start them).
  function dailyVendorReport(orders, names, range) {
    const keys = (names || []).map(norm); const late = [], risk = [], confirmed = []; const OUT = ['مكتمل', 'ملغي', 'استرجاع'];
    for (const o of orders || []) { if (OUT.includes(o.st)) continue;
      for (const s of o.subs || []) { if (!keys.includes(norm(s.vendor)) || !s.open) continue;
        const row = { oid: String(o.id), sid: String(s.sid), prod: s.prod, sku: s.sku || '', tot: Number(s.tot) || 0, age: o.age || 0, delivery: o.delivery || 'ok', ss: s.ss || '' };
        if (o.delivery === 'late') late.push(row); else if (o.delivery === 'risk') risk.push(row);
        const when = o.confAt || o.cdate || o.date;
        if (/^مؤكد/.test(o.cf || '') && when >= range.from && when <= range.to && o.delivery === 'ok') confirmed.push(row); } }
    late.sort((a, b) => b.age - a.age); risk.sort((a, b) => b.age - a.age); confirmed.sort((a, b) => Number(b.oid) - Number(a.oid));
    return { late, risk, confirmed };
  }
  function dailyVendorText(name, r, day) {
    return ['متابعة يومية — ' + name, day, '', 'متأخرة (' + r.late.length + ')'].concat(r.late.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · متأخر ' + x.age + ' يوم'),
      ['', 'قابلة للتأخير (' + r.risk.length + ')'], r.risk.map((x) => '• #' + x.oid + ' · ' + x.prod + ' · عمره ' + x.age + ' يوم'),
      ['', 'اتأكدت — ابدأ فيها (' + r.confirmed.length + ')'], r.confirmed.map((x) => '• #' + x.oid + ' · ' + x.prod)).join('\n');
  }

  // Brands (owner 26 Oct, phase 3.2 decision 6): the pure rules of the prototype's brands domain. المبتكر = اللي بنحاسبه · البراند =
  // الاسم اللي المنتجات بتتباع بيه. A maker may own several brands, a brand moves to another maker from a date (temporarily until a
  // return date, or for good), the orders count for whoever held the brand on the order's day, the SKU never changes (the code is
  // informational), the rate = the owner's unless the brand carries a special one. The history and the rates live on the server
  // (brand_owners / brand_rates, add-only); these functions judge a form before any request and read a history / a rate list.
  const BRAND_CODE_RE = /^[A-Z0-9]{1,3}$/;
  // the code the trigger derives: the first Latin letter of the name upper-cased, else X
  function brandCode(name) { const m = /[A-Za-z]/.exec(String(name == null ? '' : name)); return m ? m[0].toUpperCase() : 'X'; }
  // { name, code, aliases, rate } of the add / edit popup → { field: message }; the code is optional (suggested from the name), the
  // rate optional ('' / null = no special rate)
  function validateBrand(input) {
    const e = {}; const b = input || {};
    if (!clean(b.name, 80)) e.name = 'اكتب اسم البراند';
    else if (clean(b.name, 200).length > 80) e.name = 'اسم البراند لحد 80 حرف';
    const code = latin(b.code == null ? '' : b.code).trim().toUpperCase();
    if (code && !BRAND_CODE_RE.test(code)) e.code = 'الكود من 1 لـ 3: حروف إنجليزي كبيرة أو أرقام';
    if (b.rate !== undefined && b.rate !== null && String(b.rate).trim() !== '') { const r = Number(latin(b.rate)); if (!Number.isFinite(r) || r < 0 || r > 65) e.rate = 'النسبة الخاصة من 0% إلى 65%'; }
    return e;
  }
  // history rows [{ vendor, since }] (since ascending) → the owner on `date` ('YYYY-MM-DD'; none = today's): the last row that had
  // started, else the first row (orders older than the history belong to the first owner); null for an empty history
  function ownerAt(history, date) {
    const h = (history || []).slice().sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    if (!h.length) return null;
    let o = h[0].vendor; for (const x of h) if (!date || x.since <= date) o = x.vendor; return o;
  }
  // rate rows [{ rate, since }] (rate null = no special rate from that date) → the special rate on `date`, the prototype's rateAt rule
  // (the earliest row until one has started); null without rows or when the row in force says none
  function effectiveRate(rows, date) {
    const h = (rows || []).slice().sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    if (!h.length) return null;
    let r = h[0].rate; for (const x of h) if (!date || x.since <= date) r = x.rate;
    return r == null ? null : Number(r);
  }
  // the transfer / return popup: { since, lastSince (the brand's latest history row), returnOn, toId, ownerId } → { field: message }
  function validateTransfer(input) {
    const e = {}; const t = input || {};
    if (!isIso(t.since)) e.since = 'اكتب تاريخ البداية';
    else if (t.lastSince && t.since < t.lastSince) e.since = 'التاريخ ده قبل آخر نقل للبراند (' + t.lastSince + ') — اختار تاريخ بعده';
    if (t.returnOn) { if (!isIso(t.returnOn)) e.returnOn = 'اكتب تاريخ الرجوع'; else if (isIso(t.since) && t.returnOn <= t.since) e.returnOn = 'تاريخ الرجوع لازم يكون بعد تاريخ البداية'; }
    if (!t.toId) e.to = 'اختار المبتكر';
    else if (t.ownerId && String(t.toId) === String(t.ownerId)) e.to = 'البراند أصلًا عند المبتكر ده';
    return e;
  }

  return Object.freeze({ validateBrand, brandCode, ownerAt, effectiveRate, validateTransfer, LOGIN_STATUS, passwordIssues, genPassword, suggestUsername, validateLogin, validateBank, dailyVendorReport, dailyVendorText, weeklyVendorReport, weeklyVendorText, vendorReport, vendorReportText, biweeklyPeriod, periodStatement, periodStatementText, periodMoney, ADMIN, ACCOUNTS, VENDOR_FOLLOW, CATEGORIES, STATUSES, PAY_METHODS, CONTRACT_TYPES, CONTRACT_MAX, EXPIRY_WARN_DAYS, label, validateVendor, EDIT_GROUPS, groupPatch, validateGroup, orderCounts, performance, ledger, ORDER_KINDS, ordersByKind, delayCounts, shareText, waPhone, createStore, isAdmin, canEdit, canSeeBank, mask, rateAt, contractStatus, summary, summaryDetails, filterVendors, activeFilterCount, VENDOR_SORTS, sortVendors, parseAliases, norm });
});

