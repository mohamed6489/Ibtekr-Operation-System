
/* Ibtekr Transport (المواصلات) — domain layer. Pure: no DOM, no I/O.
   Reads the Logistics expenses sheet rows, keeps transport withdrawals only (Uber trips and
   notes that say uber / اوبر / مواصلات / سواق, never packaging), repairs the sheet's typo dates
   by row order, and attributes each trip to a vendor or to operations. UMD. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrTransport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const TRANSPORT_RE = /(^|[^a-z])(uber|uper)([^a-z]|$)|اوبر|أوبر|مواصلات|سواق/i;
  const RETURN_RE = /مرتجع|mortg|mortag|return/i;
  const OPS_KEYS = ['opration', 'operation', 'uper', 'wrapping'];
  const key = (s) => String(s || '').toLowerCase().replace(/[@\s_.\-]/g, '');
  const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const ms = (s) => Date.parse(s + 'T00:00:00Z');
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
  const round2 = (n) => Math.round(n * 100) / 100;

  function isTransport(row) {
    const [, op, , name, beneficiary, note] = row;
    if (op !== 'سحب') return false;
    if (/تغليف/.test(note || '')) return false;
    if (RETURN_RE.test(note || '')) return false; // owner (22 Oct): return trips are never counted
    return String(name).trim().toLowerCase() === 'uber' || TRANSPORT_RE.test((beneficiary || '') + ' ' + (note || ''));
  }

  // One raw date → ISO, using the previous row's date to pick D/M vs M/D and to repair typo years/months.
  function fixDate(raw, prev) {
    const [a, b, y] = String(raw).split('/').map((x) => parseInt(x, 10));
    const orders = a > 12 ? [[a, b]] : b > 12 ? [[b, a]] : [[a, b], [b, a]]; // [day, month]
    const ok = y === 2025 || y === 2026;
    if (!prev) { for (const [d, m] of orders) if (ok && valid(y, m, d)) return { date: iso(y, m, d), fixed: false }; }
    const P = prev ? ms(prev) : null; const py = prev ? Number(prev.slice(0, 4)) : 2026;
    const cands = [];
    for (const [d, m] of orders) for (const yy of new Set([ok ? y : null, py, py + 1].filter(Boolean))) {
      if (!valid(yy, m, d)) continue; const s = iso(yy, m, d); const diff = (ms(s) - P) / DAY;
      if (diff >= -7 && diff <= 20) cands.push({ date: s, fixed: yy !== y, dist: Math.abs(diff) });
    }
    cands.sort((p, q) => (p.fixed - q.fixed) || (p.dist - q.dist));
    if (cands.length) return { date: cands[0].date, fixed: cands[0].fixed };
    const day = orders[0][0]; let m = Number(prev.slice(5, 7)), yy = py;
    let s = iso(yy, m, Math.min(day, 28)); if ((ms(s) - P) / DAY < -7) { m = m === 12 ? 1 : m + 1; if (m === 1) yy++; s = iso(yy, m, Math.min(day, 28)); }
    return { date: s, fixed: true };
  }

  // Owner (22 Oct): the word أوبر/Uber is never shown — it is «مواصلات» everywhere in the system.
  const WORD_RE = /(^|[^a-z])(uber|uper)(?=[^a-z]|$)|[اأإ]وبر/gi;
  const relabel = (t) => String(t || '').replace(WORD_RE, (m, pre) => (pre && !/[اأإ]/.test(m[0]) ? pre : '') + 'مواصلات').replace(/\s+/g, ' ').trim();

  function matchVendor(text, vendors) { const k = key(text); return k ? (vendors.find((v) => key(v) === k) || null) : null; }

  // rows: [date, op, amount, name, beneficiary, note] in sheet order.
  function parseSheet(rows, vendors) {
    let prev = null; const out = [];
    for (const row of rows || []) {
      const f = fixDate(row[0], prev); prev = f.date;
      if (!isTransport(row)) continue;
      const ben = row[4] || ''; const opsBen = OPS_KEYS.includes(key(ben));
      const vendor = opsBen ? matchVendor(row[5], vendors) : matchVendor(ben, vendors);
      out.push({ date: f.date, dateFixed: f.fixed, raw: row[0], amount: Number(row[2]) || 0, vendor, scope: vendor ? 'vendor' : 'ops', payer: relabel(row[3]), note: relabel(row[5]), place: opsBen && !vendor ? relabel(row[5]) : '' });
    }
    return out;
  }

  const inRange = (r, range) => !range || ((!range.from || r.date >= range.from) && (!range.to || r.date <= range.to));

  function forVendor(list, name, range) {
    const rows = (list || []).filter((r) => r.vendor === name && inRange(r, range));
    return { total: round2(rows.reduce((s, r) => s + r.amount, 0)), trips: rows.length, first: rows.length ? rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date) : null, last: rows.length ? rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date) : null, rows };
  }

  function totals(list, range) {
    const rows = (list || []).filter((r) => inRange(r, range));
    const sum = (l) => round2(l.reduce((s, r) => s + r.amount, 0));
    const vrows = rows.filter((r) => r.vendor), orows = rows.filter((r) => !r.vendor);
    const names = [...new Set(vrows.map((r) => r.vendor))];
    const byVendor = names.map((n) => { const v = forVendor(rows, n); return { name: n, total: v.total, trips: v.trips, last: v.last }; }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const dates = rows.map((r) => r.date).sort();
    return { total: sum(rows), vendors: sum(vrows), ops: sum(orows), trips: rows.length, vendorTrips: vrows.length, opsTrips: orows.length, vendorCount: names.length, from: dates[0] || null, to: dates[dates.length - 1] || null, byVendor, opsRows: orows, fixedCount: rows.filter((r) => r.dateFixed).length };
  }

  return Object.freeze({ relabel, isTransport, fixDate, parseSheet, forVendor, totals, matchVendor });
});

