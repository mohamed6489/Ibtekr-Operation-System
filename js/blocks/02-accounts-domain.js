
/* Ibtekr Accounts — domain layer. Pure functions only: no DOM, no I/O, no globals.
   UMD so the same file runs in node tests and inside the published page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrDomain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = Object.freeze(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات']);
  const VENDOR_TYPES = Object.freeze(['مواصلات', 'عربون', 'أخرى']);
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
  function validateVendorMovement(input) {
    const errors = {};
    const { amount, date } = checkAmountDate(input, errors);
    if (input.direction !== 'deposit' && input.direction !== 'withdraw') errors.direction = 'اختار إيداع أو سحب';
    if (!VENDOR_TYPES.includes(input.type)) errors.type = 'اختار النوع من القايمة';
    const vendor = sanitizeText(input.vendor, 80);
    if (!vendor) errors.vendor = 'اختار المورد';
    let typeName = input.type;
    if (input.type === 'أخرى') {
      typeName = sanitizeText(input.otherName, 80);
      if (!typeName) errors.otherName = 'اكتب النوع';
    }
    return { errors, value: { direction: input.direction, amount, date, type: input.type, typeName, vendor } };
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
  function applyVendorMovement(v, direction, amount) {
    const s = direction === 'deposit' ? 1 : -1; // deposit = money paid to the vendor in advance
    return { ...v, deposits: round2(v.deposits + s * amount), balance: round2(v.balance - s * amount) };
  }
  function vendorSummary(vs) {
    let positive = 0, negative = 0, positiveCount = 0, negativeCount = 0, deposits = 0;
    for (const v of vs) {
      if (v.balance > 0) { positive += v.balance; positiveCount++; }
      if (v.balance < 0) { negative += v.balance; negativeCount++; }
      deposits += v.deposits;
    }
    return { count: vs.length, positive: round2(positive), positiveCount, negative: round2(negative), negativeCount, deposits: round2(deposits), net: round2(positive + negative) };
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
    return movements.reduce((list, m) => list.map((v) => (v.name === m.vendor ? applyVendorMovement(v, m.direction, m.amount) : v)), base.map((v) => ({ ...v })));
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

  return Object.freeze({
    deductTransport,
    CATEGORIES, VENDOR_TYPES, ACCOUNTS, OTHER, MAX_AMOUNT,
    parseAmount, formatMoney, formatPct, sanitizeText, round2,
    parseDate, formatDateNumeric, formatDateLong, rangeLabel, monthName, presetRange, monthMatrix, addDays,
    validateExpense, validateVendorMovement, validateAccountMovement,
    categoryTotals, sortVendors, applyVendorMovement, vendorSummary, applyAccountMovement, deriveAccounts, deriveVendors, potential, createEventLog,
  });
});

