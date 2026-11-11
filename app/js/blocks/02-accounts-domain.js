
/* Ibtekr Accounts — domain layer. Pure functions only: no DOM, no I/O, no globals.
   UMD so the same file runs in node tests and inside the published page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrDomain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = Object.freeze(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات']);
  const PAYOUT_TYPE = 'تحويل مستحقات';
  // phase 4.1 (plan decision 1): no «تحويل مستحقات» move is recorded here — Dokan lowers the balance itself when a request is approved
  const VENDOR_TYPES = Object.freeze(['مواصلات', 'عربون', 'أخرى']);
  const CORRECTION = 'أخرى'; // 0078: a «إيداع» is a correction: this kind, its title in typeName
  const ACCOUNTS = Object.freeze(['حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية']);
  const OTHER = 'آخر';
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const MAX_AMOUNT = 1e9;

  const toLatinDigits = (s) => String(s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function sanitizeText(s, max) {
    // strip control chars, collapse whitespace, cap length
    const clean = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, (c) => (/[\t\n\r]/.test(c) ? ' ' : '')).replace(/\s+/g, ' ').trim();
    return clean.slice(0, max);
  }

  function parseAmount(raw) {
    const s = toLatinDigits(raw == null ? '' : raw).replace(/٬|,/g, '').replace(/٫/g, '.').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return round2(Number(s));
  }
  function formatMoney(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatPct(fraction) { return (fraction * 100).toFixed(1) + '%'; }

  // ---- dates (ISO yyyy-mm-dd built from UTC parts, never from local time) ----
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  function isoToUtc(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function utcToIso(ms) { const t = new Date(ms); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  const addDays = (s, n) => utcToIso(isoToUtc(s) + n * 86400000);
  function parseDate(raw) {
    const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(toLatinDigits(raw == null ? '' : raw).trim());
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return iso(y, mo, d);
  }
  function formatDateNumeric(s) { const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; }
  function formatDateLong(s) { const [y, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m - 1] + ' ' + y; }
  function rangeLabel(from, to) { return 'الفترة: ' + formatDateLong(from) + ' – ' + formatDateLong(to); }
  const monthName = (m1) => MONTHS[m1 - 1];

  // weekday index with Saturday = 0
  const satIndex = (s) => (new Date(isoToUtc(s)).getUTCDay() + 1) % 7;

  function presetRange(key, today) {
    const [y, m] = today.split('-').map(Number);
    switch (key) {
      case 'today': return { from: today, to: today };
      case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d }; }
      case 'todayYesterday': return { from: addDays(today, -1), to: today };
      case 'last7': return { from: addDays(today, -6), to: today };
      case 'last14': return { from: addDays(today, -13), to: today };
      case 'last28': return { from: addDays(today, -27), to: today };
      case 'last30': return { from: addDays(today, -29), to: today };
      case 'thisWeek': return { from: addDays(today, -satIndex(today)), to: today };
      case 'lastWeek': { const start = addDays(today, -satIndex(today) - 7); return { from: start, to: addDays(start, 6) }; }
      case 'thisMonth': return { from: iso(y, m, 1), to: today };
      case 'lastMonth': {
        const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
        const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
        return { from: iso(py, pm, 1), to: iso(py, pm, last) };
      }
      case 'max': return { from: '2024-03-01', to: today };
      default: throw new Error('unknown preset ' + key);
    }
  }

  function monthMatrix(year, month1) {
    const first = iso(year, month1, 1);
    const start = addDays(first, -satIndex(first));
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const i = addDays(start, w * 7 + d);
        row.push({ iso: i, day: Number(i.slice(8)), outside: Number(i.slice(5, 7)) !== month1 });
      }
      weeks.push(row);
    }
    return weeks;
  }

  // ---- validation ----
  function checkAmountDate(input, errors) {
    const amount = parseAmount(input.amount);
    if (!(amount > 0) || amount > MAX_AMOUNT) errors.amount = 'اكتب مبلغ أكبر من صفر';
    const date = parseDate(input.date);
    if (!date) errors.date = 'اكتب التاريخ بالشكل يوم/شهر/سنة، مثال 20/10/2026';
    return { amount, date };
  }
  // ---- الاشتراكات (owner 27 Oct): اسم الاشتراك + تاريخ الانتهاء + تنبيه قبل الانتهاء بشهر/أسبوع/يوم + ملاحظة حرة ----
  const SUB_NAMES = Object.freeze(['استضافة الموقع (Hostinger)', 'دومين ibtekr.club', 'ووكومرس / بلجنز', 'Airtable', 'Google Workspace', 'Meta Business (أدوات)', 'Canva', 'Adobe', 'شوبيفاي', 'واتساب بزنس API', 'باي موب', 'أخرى']);
  const SUB_ALERTS = Object.freeze([['month', 'بشهر', 30], ['week', 'بأسبوع', 7], ['day', 'بيوم', 1]]);
  const AD_PLATFORMS = Object.freeze(['ميتا (فيسبوك وإنستجرام)', 'تيك توك', 'جوجل']);
  const REFUND_REASONS = Object.freeze(['استرجاع مبلغ مدفوع', 'إلغاء اشتراك', 'خصم من مورد', 'تصحيح تسجيل غلط', 'أخرى']);
  const subAlertDays = (k) => (SUB_ALERTS.find((x) => x[0] === k) || [, , 0])[2];
  // الحقول المطلوبة حسب نوع المصروف (owner 27 Oct) — السحب بس؛ الإيداع ليه شروطه تحت
  function validateExpenseCategory(input) {
    const errors = {}; const cat = input.category;
    if (input.direction === 'deposit') {
      if (!sanitizeText(input.source, 80)) errors.source = 'اكتب مصدر المبلغ';
      if (!REFUND_REASONS.includes(input.reason)) errors.reason = 'اختار سبب الإيداع';
      const src = sanitizeText(input.source, 80);
      return { errors, value: { source: src, reason: input.reason, note: sanitizeText(input.note, 500), beneficiaryName: src, beneficiaryIsOther: true } };
    }
    if (cat === 'الاشتراكات') return { errors, value: {} }; // بيتتحقق منه validateSubscription
    if (cat === 'المرتبات') {
      const other = input.beneficiary === OTHER;
      const name = other ? sanitizeText(input.otherName, 80) : sanitizeText(input.beneficiary, 80);
      if (!name) errors[other ? 'otherName' : 'beneficiary'] = other ? 'اكتب اسم المستفيد' : 'اختار المستفيد من الفريق';
      return { errors, value: { beneficiaryName: name, beneficiaryIsOther: other, staffKind: other ? (input.staffKind === 'freelance' ? 'freelance' : 'staff') : 'staff', note: sanitizeText(input.note, 500) } };
    }
    if (cat === 'الإعلانات') {
      const p = sanitizeText(input.platform, 60);
      if (!p) errors.platform = 'اختار المنصة';
      return { errors, value: { platform: p, beneficiaryName: p, beneficiaryIsOther: false, details: sanitizeText(input.details, 500), note: sanitizeText(input.note, 500) } };
    }
    const details = sanitizeText(input.details, 500);
    if (!details) errors.details = 'اكتب تفاصيل المصروف';
    return { errors, value: { details, note: sanitizeText(input.note, 500) } };
  }
  function validateSubscription(input) {
    const errors = {}; const name = sanitizeText(input.subName, 80);
    if (!name) errors.subName = 'اختار الاشتراك';
    const ends = input.subEnds ? (/^\d{4}-\d{2}-\d{2}$/.test(input.subEnds) ? input.subEnds : parseDate(input.subEnds)) : null;
    if (!input.subEnds) errors.subEnds = 'حدّد تاريخ الانتهاء';
    else if (!ends) errors.subEnds = 'التاريخ لازم يكون يوم/شهر/سنة';
    const alerts = (input.subAlerts || []).filter((k) => SUB_ALERTS.some((a) => a[0] === k));
    if (!alerts.length) errors.subAlerts = 'اختار تنبيه واحد على الأقل';
    return { errors, value: { subName: name, subEnds: ends, subAlerts: alerts, subNote: sanitizeText(input.subNote, 500), beneficiaryName: name, beneficiaryIsOther: false } };
  }
  // اللي قرب ينتهي: بترجّع لكل اشتراك الأيام الباقية وأقرب تنبيه مستحق (أو null لو لسه بدري)
  function subsDue(subs, today) {
    return (subs || []).filter((x) => x.subEnds).map((x) => {
      const left = daysBetweenIso(today, x.subEnds);
      const fired = (x.subAlerts || []).map((k) => ({ k, d: subAlertDays(k) })).filter((a) => left <= a.d).sort((a, b) => a.d - b.d)[0] || null;
      return { name: x.subName, ends: x.subEnds, amount: x.amount, note: x.subNote || '', alerts: x.subAlerts || [], daysLeft: left, expired: left < 0, due: !!fired, alert: fired ? fired.k : null, label: fired ? (SUB_ALERTS.find((a) => a[0] === fired.k) || [, ''])[1] : '' };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
  }
  const daysBetweenIso = (a, b) => Math.round((isoToUtc(b) - isoToUtc(a)) / 86400000);
  // ---- سجل الحركات (owner 27 Oct): كل الحركات في مكان واحد، تابس المصروفات · حسابات المبتكرين · الحساب الفعلي ----
  // بيدمج الحركات المتسجلة في السيستم مع اللي جاي من الشيتات (عرابين · مواصلات) ويرتّبهم من الأحدث.
  function movementLog(kind, src = {}) {
    const rows = [];
    const push = (r) => rows.push(Object.assign({ at: '', note: '', by: '—' }, r));
    if (kind === 'expenses') {
      (src.expenses || []).forEach((e) => push({ date: e.date, kind: e.direction === 'deposit' ? 'إيداع' : 'سحب', what: e.category, who: e.beneficiaryName || '—', amount: e.amount, by: e.createdBy || '—', source: 'تسجيل يدوي', ref: e.id ? '#' + e.id : '', note: e.subName ? 'اشتراك: ' + e.subName + (e.subEnds ? ' · بينتهي ' + e.subEnds : '') : '' }));
      Object.keys(src.expenseSeed || {}).forEach((mk) => { const m = src.expenseSeed[mk]; Object.keys(m).forEach((cat) => { if (!m[cat]) return; push({ date: mk + '-01', kind: 'سحب', what: cat, who: '—', amount: m[cat], by: 'شيت', source: 'شيت Monthly Performance', ref: mk, note: 'إجمالي الشهر من الشيت' }); }); });
    } else if (kind === 'vendorMoves') {
      // 0078: a «إيداع» is a balance correction; a move an approved request settled says so
      (src.vendorMoves || []).forEach((m) => push({ date: m.date, kind: m.direction === 'deposit' ? 'إيداع' : 'سحب', what: m.direction === 'deposit' ? 'تصحيح: ' + (m.typeName || m.type) : m.typeName || m.type, who: m.vendor, amount: m.amount, by: m.createdBy || '—', source: 'تسجيل يدوي', ref: m.id ? '#' + m.id : '',
        note: [m.note || '', m.settledBy != null ? 'اتصفّت مع طلب السحب #' + m.settledBy : ''].filter(Boolean).join(' · ') }));
      (src.vendorSeed || []).forEach((v) => { if (v.deposits) push({ date: src.seedDate || '', kind: 'إيداع', what: 'عربون', who: v.name, amount: v.deposits, by: 'شيت', source: 'شيت Balances_Payouts', ref: '', note: 'عربون مدفوع مقدمًا — الشيت مفيهوش تاريخ الحركة' }); });
      (src.transport || []).forEach((t) => push({ date: t.date, kind: 'سحب', what: 'مواصلات', who: t.vendor || '—', amount: t.amount, by: t.payer || 'شيت', source: 'شيت Logistics expenses', ref: '', note: t.note || '' }));
      (src.withdrawals || []).forEach((w) => push({ date: String(w.at || '').slice(0, 10), kind: 'طلب سحب', what: w.source === 'internal' ? 'طلب داخلي' : 'طلب من المبتكر', who: w.vendor, amount: w.amount, by: w.by || '—', source: 'طلبات السحب', ref: w.id, note: w.note || '' }));
    } else {
      (src.accountMoves || []).forEach((m) => push({ date: m.date, kind: m.direction === 'deposit' ? 'إيداع' : 'سحب', what: m.account, who: '—', amount: m.amount, by: m.createdBy || '—', source: 'تسجيل يدوي', ref: m.id ? '#' + m.id : '', note: m.note || '' }));
      Object.keys(src.accounts || {}).forEach((a) => push({ date: src.seedDate || '', kind: 'رصيد افتتاحي', what: a, who: '—', amount: src.accounts[a], by: 'شيت', source: 'شيت Balances_Payouts', ref: '', note: 'الرصيد قبل حركات السيستم — الشيت مفيهوش تاريخ' }));
    }
    rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    const sum = (f) => round2(rows.filter(f).reduce((t, r) => t + (Number(r.amount) || 0), 0));
    return { rows, count: rows.length, inTotal: sum((r) => r.kind === 'إيداع' || r.kind === 'رصيد افتتاحي'), outTotal: sum((r) => r.kind === 'سحب'), requests: rows.filter((r) => r.kind === 'طلب سحب').length };
  }
  function validateExpense(input) {
    const errors = {};
    const { amount, date } = checkAmountDate(input, errors);
    if (!CATEGORIES.includes(input.category)) errors.category = 'اختار النوع من القايمة';
    const direction = input.direction === undefined ? 'withdraw' : input.direction;
    if (direction !== 'withdraw' && direction !== 'deposit') errors.direction = 'اختار إيداع أو سحب';
    let beneficiaryName = sanitizeText(input.beneficiary, 80);
    if (input.beneficiary === OTHER) {
      beneficiaryName = sanitizeText(input.otherName, 80);
      if (!beneficiaryName) errors.otherName = 'اكتب اسم المستفيد';
    }
    return { errors, value: { amount, date, direction, category: input.category, beneficiaryName, beneficiaryIsOther: input.beneficiary === OTHER } };
  }
  // 0078 (the owner, 11 Nov — «إجراء»): «سحب» = عربون / مواصلات / أخرى (deducted from the net); «إيداع» = a balance correction only —
  // the kind «أخرى» with the transaction's title (typeName, required) and an optional description (note); the server refuses another kind
  function validateVendorMovement(input) {
    const errors = {};
    const { amount, date } = checkAmountDate(input, errors);
    if (input.direction !== 'deposit' && input.direction !== 'withdraw') errors.direction = 'اختار سحب أو إيداع';
    const vendor = sanitizeText(input.vendor, 80);
    if (!vendor) errors.vendor = 'اختار المبتكر';
    const note = sanitizeText(input.note, 500);
    if (input.direction === 'deposit') {
      const typeName = sanitizeText(input.otherName, 80);
      if (!typeName) errors.otherName = 'اكتب عنوان المعاملة';
      return { errors, value: { direction: 'deposit', amount, date, type: CORRECTION, typeName, vendor, note } };
    }
    if (!VENDOR_TYPES.includes(input.type)) errors.type = 'اختار النوع من القايمة';
    let typeName = input.type;
    if (input.type === 'أخرى') {
      typeName = sanitizeText(input.otherName, 80);
      if (!typeName) errors.otherName = 'اكتب النوع';
    }
    return { errors, value: { direction: input.direction, amount, date, type: input.type, typeName, vendor, note } };
  }
  function validateAccountMovement(input) {
    const errors = {};
    const { amount, date } = checkAmountDate(input, errors);
    if (input.direction !== 'deposit' && input.direction !== 'withdraw') errors.direction = 'اختار إيداع أو سحب';
    if (!ACCOUNTS.includes(input.account)) errors.account = 'اختار نوع الحساب من القايمة';
    return { errors, value: { direction: input.direction, amount, date, account: input.account } };
  }

  // ---- derived numbers ----
  function categoryTotals(seed, entries, from, to) {
    const amounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const key of Object.keys(seed)) {
      const [y, m] = key.split('-').map(Number);
      const first = iso(y, m, 1), last = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
      if (first >= from && last <= to) for (const c of CATEGORIES) amounts[c] += seed[key][c] || 0; // a month seeds the range only when fully covered
    }
    for (const e of entries) if (e.date >= from && e.date <= to && amounts[e.category] !== undefined) amounts[e.category] += e.direction === 'deposit' ? -e.amount : e.amount;
    let total = 0;
    for (const c of CATEGORIES) { amounts[c] = round2(amounts[c]); total += amounts[c]; }
    total = round2(total);
    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = { amount: amounts[c], share: total === 0 ? 0 : amounts[c] / total };
    return { total, byCategory };
  }
  function sortVendors(list, key, dir) {
    const sign = dir === 'asc' ? 1 : -1;
    return list.map((v, i) => [v, i]).sort((a, b) => sign * (a[0][key] - b[0][key]) || a[1] - b[1]).map((p) => p[0]);
  }
  // 0078 (the owner, 11 Nov): «سحب» (withdraw) is always deducted from the net — an «عربون» into the deposits, an «أخرى» into the
  // other deductions (a «مواصلات» into the transport: deductTransport) — even below zero; «إيداع» (deposit) is a correction added to it
  function applyVendorMovement(v, direction, amount, type) {
    // تحويل مستحقات = صرف رصيد المبتكر له — بيقلّل الرصيد من غير ما يزوّد العرابين (no such move is recorded: phase 4.1)
    if (type === PAYOUT_TYPE) { const s = direction === 'deposit' ? 1 : -1; return { ...v, balance: round2(v.balance - s * amount) }; }
    if (direction === 'deposit') return { ...v, corrections: round2((v.corrections || 0) + amount), balance: round2(v.balance + amount) };
    if (type === 'عربون') return { ...v, deposits: round2((v.deposits || 0) + amount), balance: round2(v.balance - amount) };
    if (type === 'مواصلات') return { ...v, transport: round2((v.transport || 0) + amount), balance: round2(v.balance - amount) };
    return { ...v, other: round2((v.other || 0) + amount), balance: round2(v.balance - amount) };
  }
  function vendorSummary(vs) {
    let positive = 0, negative = 0, positiveCount = 0, negativeCount = 0, deposits = 0, transport = 0, other = 0, corrections = 0, carry = 0;
    for (const v of vs) {
      if (v.balance > 0) { positive += v.balance; positiveCount++; }
      if (v.balance < 0) { negative += v.balance; negativeCount++; }
      deposits += v.deposits || 0; transport += v.transport || 0; other += v.other || 0; corrections += v.corrections || 0; carry += v.carry || 0;
    }
    return { count: vs.length, positive: round2(positive), positiveCount, negative: round2(negative), negativeCount, deposits: round2(deposits),
      transport: round2(transport), other: round2(other), corrections: round2(corrections), carry: round2(carry), net: round2(positive + negative) };
  }
  // 0078: what a settlement left on the maker (his request was smaller than the deductions) — deducted like a move until the next
  function withCarry(list, carryById) {
    return list.map((v) => { const c = round2(Number((carryById || {})[v.id]) || 0); return { ...v, carry: c, balance: round2(v.balance - c) }; });
  }
  // the maker's open moves now: deductions − corrections + the carry (Dokan's balance − the net)
  const openOf = (v) => round2((v.deposits || 0) + (v.transport || 0) + (v.other || 0) + (v.carry || 0) - (v.corrections || 0));
  // 0078: an approved request settles the open moves — the same rule as acc_settle_withdrawal: consumed = min(request, open) when
  // open > 0, else open (the credits are paid with it); what is left on the maker; the cash to transfer = request − consumed
  function settlePlan(amount, open) {
    const a = round2(Number(amount) || 0), o = round2(Number(open) || 0);
    const consumed = round2(o > 0 ? Math.min(a, o) : o);
    return { amount: a, open: o, consumed, carryOut: round2(o - consumed), cash: round2(a - consumed) };
  }
  function applyAccountMovement(accounts, account, direction, amount) {
    if (!ACCOUNTS.includes(account)) throw new Error('unknown account');
    const next = { ...accounts };
    const v = round2(accounts[account] + (direction === 'deposit' ? amount : -amount));
    if (v < 0) throw new Error('insufficient balance');
    next[account] = v;
    return next;
  }
  function potential(accounts, inProgressShare, vendorDeposits) {
    const actual = round2(ACCOUNTS.reduce((s, a) => s + accounts[a], 0));
    const total = round2(actual + inProgressShare + vendorDeposits);
    const f = (x) => (total === 0 ? 0 : x / total);
    return { actual, inProgress: inProgressShare, deposits: vendorDeposits, total, shares: { actual: f(actual), inProgress: f(inProgressShare), deposits: f(vendorDeposits) } };
  }

  function deriveAccounts(opening, movements) {
    let balances = { ...opening };
    for (const m of movements) {
      const v = round2(balances[m.account] + (m.direction === 'deposit' ? m.amount : -m.amount));
      balances = { ...balances, [m.account]: v };
    }
    for (const a of ACCOUNTS) if (balances[a] < 0) return { ok: false, account: a, balances };
    return { ok: true, balances };
  }
  function deriveVendors(base, movements) {
    return movements.reduce((list, m) => list.map((v) => (v.name === m.vendor ? applyVendorMovement(v, m.direction, m.amount, m.type) : v)), base.map((v) => ({ ...v })));
  }

  // Owner (22 Oct): transport paid for a vendor is deducted from his balance (deposits untouched).
  function deductTransport(list, byVendor) {
    return list.map((v) => { const t = round2((byVendor || {})[v.name] || 0); return { ...v, transport: t, balance: round2(v.balance - t) }; });
  }

  // ---- audit trail ----
  function createEventLog(clock) {
    const items = [];
    return {
      append(ev) {
        const entry = Object.freeze({ id: items.length + 1, at: clock(), action: ev.action, actor: ev.actor, oldValue: ev.oldValue === undefined ? null : ev.oldValue, newValue: ev.newValue === undefined ? null : ev.newValue });
        items.push(entry);
        return entry;
      },
      all() { return items.slice(); },
    };
  }

  // ---- phase 4 (plan decisions 4 / 7): the live numbers in the shape of the September seed (block 03), so the accounts views
  // read SEED.vendors / sales / salesTotal / vendorTotals / accounts / inProgressShare / expenseSeed as before.
  // makers: [{ id, name, rate }] (rate null = not visible → «—»); balances: [{ vendorId, balance }] (Dokan, read-only);
  // sales: accounts_sales rows [{ vendorId, group, orders, sales, share, isTotal }]. The maker's balance starts at Dokan's; the
  // deposits / transport / other moves are applied by deriveVendors / deductTransport like the prototype. Opening balances: 0.
  const SALES_GROUPS = Object.freeze([['completed', 'مكتملة'], ['in_progress', 'تحت التنفيذ'], ['cancelled', 'مرتجع / ملغي']]);
  const pctOf = (share, sales) => (sales > 0 ? (Math.round((share / sales) * 1000) / 10).toFixed(1) + '%' : '0.0%');
  function liveSeed({ makers = [], balances = [], sales = [] } = {}) {
    const bal = new Map(balances.map((b) => [b.vendorId, b]));
    const slot = { completed: 'c', in_progress: 'p', cancelled: 'x' };
    const vendors = makers.map((m) => {
      const b = bal.get(m.id); const n = b && b.balance != null && isFinite(Number(b.balance)) ? round2(Number(b.balance)) : null;
      return { id: m.id, name: m.name, pct: m.rate == null || !isFinite(Number(m.rate)) ? '—' : Number(m.rate).toFixed(1) + '%', c: [0, 0, 0], p: [0, 0, 0], x: [0, 0, 0], deposits: 0, dokanBalance: n, balance: n || 0 };
    });
    const byId = new Map(vendors.map((v) => [v.id, v]));
    const totals = Object.fromEntries(SALES_GROUPS.map(([g]) => [g, [0, 0, 0]]));
    for (const r of sales || []) {
      const k = slot[r.group]; if (!k) continue;
      const add = (t) => [t[0] + (Number(r.orders) || 0), round2(t[1] + (Number(r.sales) || 0)), round2(t[2] + (Number(r.share) || 0))];
      if (r.isTotal) totals[r.group] = add(totals[r.group]);
      else { const v = byId.get(r.vendorId); if (v) v[k] = add(v[k]); }
    }
    const rows = SALES_GROUPS.map(([g, label]) => ({ group: g, label, orders: totals[g][0], sales: totals[g][1], share: totals[g][2], pct: pctOf(totals[g][2], totals[g][1]) }));
    const sum = (i) => round2(rows.reduce((t, r) => t + [r.orders, r.sales, r.share][i], 0));
    return {
      vendors, expenseSeed: {}, accounts: Object.fromEntries(ACCOUNTS.map((a) => [a, 0])), inProgressShare: totals.in_progress[2],
      sales: rows, salesTotal: { orders: sum(0), sales: sum(1), share: sum(2), pct: pctOf(sum(2), sum(1)) },
      vendorTotals: { c: totals.completed, p: totals.in_progress, x: totals.cancelled, dep: 0, bal: round2(vendors.reduce((t, v) => t + v.balance, 0)) },
    };
  }

  // ---- phase 5.5 decision 13 (owner 5 Nov): a maker's account over a period («كشف بالفترة») ----
  // The opening is Dokan's own balance on the first day (the statement's opening row) less the maker's open moves the evening before;
  // in the period: what Dokan credited for orders («حقه من المكتمل»), its refunds and its withdrawals from the same statement, and
  // our moves dated in it. 0078 (the owner, 11 Nov): «سحب» deducts (عربون → deposits, مواصلات → transport, أخرى → otherMoves),
  // «إيداع» corrects (corrections); a withdrawal Dokan made covered the moves it settled (`settlements`: { withdrawId, consumed,
  // carryOut, settledOn }) — «اتحوّله» (payouts) is the cash, the request less what it covered (requested / consumed apart).
  // closing = opening + earned − refunds − payouts − deposits − transport − otherMoves + corrections + other = on the last day,
  // Dokan's balance less the open moves. `statement`: { rows: [{ date, type, debit, credit, balance, ref }] } or null (no store:
  // Dokan's part is 0); `moves`: the maker's moves ({ date, type, direction, amount, settledBy, settledAt }); `salesOf(ref)`: our
  // lines' total for a Dokan order (null when the order is not in our mirror) — the sales and Ibtekr's share of the matched orders.
  const LEDGER_STATUS = Object.freeze({ owed: 'مستحق', onThem: 'عليه', settled: 'متصفّي' });
  const ledgerStatus = (closing) => (closing > 0.004 ? 'owed' : closing < -0.004 ? 'onThem' : 'settled');
  const day10 = (v) => String(v || '').slice(0, 10);
  // the open moves at the end of day t: the moves dated up to t not settled by then (a settlement's day) + the carry left then
  function openAt(moves, settlements, t) {
    const sets = (settlements || []).filter((x) => x && x.settledOn);
    const dayOfSet = new Map(sets.map((x) => [String(x.withdrawId), day10(x.settledOn)]));
    let o = 0;
    for (const m of moves || []) {
      const d = day10(m && m.date); if (!d || d > t) continue;
      const sd = m.settledBy != null ? dayOfSet.get(String(m.settledBy)) || day10(m.settledAt) : '';
      if (sd && sd <= t) continue;
      const a = Number(m.amount) || 0; o += m.direction === 'deposit' ? -a : a;
    }
    const last = sets.filter((x) => day10(x.settledOn) <= t).sort((p, q) => (day10(p.settledOn) < day10(q.settledOn) ? -1 : day10(p.settledOn) > day10(q.settledOn) ? 1 : (Number(p.id) || 0) - (Number(q.id) || 0))).pop();
    return round2(o + (last ? Number(last.carryOut) || 0 : 0));
  }
  function movesIn(moves, from, to) {
    let deposits = 0, transport = 0, otherMoves = 0, corrections = 0;
    for (const m of moves || []) {
      const d = day10(m && m.date); if (!d || (from && d < from) || (to && d > to)) continue;
      const a = Number(m.amount) || 0;
      if (m.direction === 'deposit') corrections += a; else if (m.type === 'عربون') deposits += a; else if (m.type === 'مواصلات') transport += a; else otherMoves += a;
    }
    return { deposits: round2(deposits), transport: round2(transport), otherMoves: round2(otherMoves), corrections: round2(corrections) };
  }
  function makerLedger({ statement, moves, settlements, from, to, salesOf } = {}) {
    const rows = statement && Array.isArray(statement.rows) ? statement.rows.filter((r) => r && typeof r === 'object') : [];
    const num = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };
    const open = rows.find((r) => r.type === 'opening_balance');
    const first = rows[0];
    const dokanOpen = open ? num(open.balance) : first && first.balance != null ? num(first.balance) - num(first.debit) + num(first.credit) : 0;
    let earned = 0, refunds = 0, requested = 0, other = 0, sales = 0, share = 0, lines = 0, matched = 0; const refs = new Set();
    for (const r of rows) {
      if (r === open) continue;
      const dr = num(r.debit), cr = num(r.credit);
      if (r.type === 'dokan_orders') {
        if (dr) {
          earned += dr; lines += 1; refs.add(r.ref != null ? 'o' + r.ref : 'l' + lines);
          const s = r.ref != null && salesOf ? salesOf(r.ref) : null;
          if (s != null && isFinite(Number(s))) { sales += Number(s); share += Number(s) - dr; matched += 1; }
        }
        if (cr) refunds += cr;
      } else if (r.type === 'dokan_refund') refunds += cr - dr;
      else if (r.type === 'dokan_withdraw') requested += cr - dr;
      else other += dr - cr;
    }
    const consumed = round2((settlements || []).filter((x) => x && day10(x.settledOn) >= from && day10(x.settledOn) <= to).reduce((t, x) => t + num(x.consumed), 0));
    const m = movesIn(moves, from, to);
    const out = { from, to, dokanOpening: round2(dokanOpen), opening: round2(dokanOpen - openAt(moves, settlements, addDays(from, -1))),
      completed: { orders: refs.size, lines, earned: round2(earned), sales: round2(sales), share: round2(share), matched },
      refunds: round2(refunds), requested: round2(requested), consumed, payouts: round2(requested - consumed),
      deposits: m.deposits, transport: m.transport, otherMoves: m.otherMoves, corrections: m.corrections, other: round2(other) };
    out.closing = round2(out.opening + out.completed.earned - out.refunds - out.payouts - out.deposits - out.transport - out.otherMoves + out.corrections + out.other);
    out.status = ledgerStatus(out.closing);
    return out;
  }
  // 0078 («كشف بالفترة» من غير فلتر = from the start): a maker's whole account from Dokan's own totals (stores/{id}/stats: earning =
  // every order credited less the refunds, sales, orders) + every approved request + all our moves and settlements — no statement.
  // closing = earned − (requested − consumed) − deductions + corrections + other = Dokan's balance − the open moves (the net now).
  function lifetimeLedger({ dokan, withdrawals, moves, settlements } = {}) {
    const num = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };
    const d = dokan || {}; const bal = round2(num(d.balance));
    const requested = round2((withdrawals || []).filter((w) => w && w.status === 'approved').reduce((t, w) => t + num(w.amount), 0));
    const earned = round2(d.earning != null ? num(d.earning) : bal + requested);
    const sales = round2(num(d.sales)); const orders = Number(d.orders) || 0;
    const consumed = round2((settlements || []).reduce((t, x) => t + num(x && x.consumed), 0));
    const m = movesIn(moves, null, null);
    const out = { from: null, to: null, dokanOpening: 0, opening: 0,
      completed: { orders, lines: orders, earned, sales, share: sales ? round2(sales - earned) : 0, matched: orders },
      refunds: 0, requested, consumed, payouts: round2(requested - consumed), deposits: m.deposits, transport: m.transport, otherMoves: m.otherMoves, corrections: m.corrections,
      other: round2(bal - (earned - requested)), dokanBalance: bal };
    out.closing = round2(out.opening + out.completed.earned - out.payouts - out.deposits - out.transport - out.otherMoves + out.corrections + out.other);
    out.status = ledgerStatus(out.closing);
    return out;
  }
  function ledgerTotals(list) {
    const t = { opening: 0, orders: 0, lines: 0, sales: 0, share: 0, earned: 0, refunds: 0, payouts: 0, requested: 0, consumed: 0, deposits: 0, transport: 0, otherMoves: 0, corrections: 0, other: 0, closing: 0, owed: 0, owedCount: 0, onThem: 0, onThemCount: 0 };
    for (const l of list || []) {
      t.opening += l.opening; t.orders += l.completed.orders; t.lines += l.completed.lines; t.sales += l.completed.sales; t.share += l.completed.share; t.earned += l.completed.earned;
      t.refunds += l.refunds; t.payouts += l.payouts; t.requested += l.requested || 0; t.consumed += l.consumed || 0; t.deposits += l.deposits; t.transport += l.transport;
      t.otherMoves += l.otherMoves || 0; t.corrections += l.corrections || 0; t.other += l.other; t.closing += l.closing;
      if (l.status === 'owed') { t.owed += l.closing; t.owedCount += 1; } else if (l.status === 'onThem') { t.onThem += l.closing; t.onThemCount += 1; }
    }
    for (const k of Object.keys(t)) if (!/Count$|^orders$|^lines$/.test(k)) t[k] = round2(t[k]);
    return t;
  }

  return Object.freeze({
    LEDGER_STATUS, makerLedger, ledgerTotals, lifetimeLedger, openAt, settlePlan, withCarry, openOf, CORRECTION,
    deductTransport, PAYOUT_TYPE,
    SALES_GROUPS, liveSeed,
    CATEGORIES, VENDOR_TYPES, ACCOUNTS, OTHER, MAX_AMOUNT,
    parseAmount, formatMoney, formatPct, sanitizeText, round2,
    parseDate, formatDateNumeric, formatDateLong, rangeLabel, monthName, presetRange, monthMatrix, addDays,
    validateExpense, validateVendorMovement, validateAccountMovement,
    movementLog, SUB_NAMES, SUB_ALERTS, AD_PLATFORMS, REFUND_REASONS, validateExpenseCategory, subAlertDays, validateSubscription, subsDue, daysBetweenIso,
    categoryTotals, sortVendors, applyVendorMovement, vendorSummary, applyAccountMovement, deriveAccounts, deriveVendors, potential, createEventLog,
  });
});

