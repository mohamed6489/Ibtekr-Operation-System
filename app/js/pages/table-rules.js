/* Ibtekr — the rules every table's filter follows (the meeting of 23 Nov, docs/superpowers/plans/2026-11-23-meeting.md phase 1).
   Not a block; pure, loaded before the kit (14-kit.js) and read by it, the pages' own filters and the orders page.
   [#1, #3, #10] the filter = the table's columns, its shape by the column's data:
     · a column of a few repeating values (a status, a maker, a category, a platform…) — choices (multi-select), up to 40 values;
     · a column of numbers or money — five choices, never a number typed: «يوجد» (any value but zero) · «لا يوجد» (zero or empty) ·
       «أعلى من صفر» · «أقل من صفر» · «يساوي صفر»;
     · a column of dates — a period from–to;
     · a column of free text whose values do not repeat (names, phones, order numbers, SKUs, notes…) — no filter: the search covers it
       (the owner's answer 1 to the phase's questions).
   [#2] the total row: the sum of the rows shown (the search and the filter), labelled «إجمالي النتايج» while either is on. */
(function (root) {
  'use strict';
  const NUM_OPTS = [['has', 'يوجد'], ['none', 'لا يوجد'], ['pos', 'أعلى من صفر'], ['neg', 'أقل من صفر'], ['zero', 'يساوي صفر']];
  const CAT_MAX = 40;
  const TOTAL_LABEL = 'إجمالي النتايج';
  const AR_DIG = /[٠-٩]/g;
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const clean = (s) => String(s == null ? '' : s).replace(AR_DIG, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, ' ').trim();
  const empty = (s) => { const x = clean(s); return !x || x === '—' || x === '-' || x === '–'; };
  // a cell's number: «1,250 ج.م», «-300», «12%», «3 قطع» → the number; anything with other words → null
  function numOf(s) {
    const x = clean(s).replace(/[٬,]/g, '').replace(/ /g, ' ');
    const m = x.match(/^([+\-−]?\d+(?:\.\d+)?)\s*(ج\.?\s?م\.?|جنيه|%|٪|EGP|قطعة|قطع|يوم|أيام|ساعة|ساعات|دقيقة|د|س)?$/);
    return m ? Number(m[1].replace('−', '-')) : null;
  }
  // a cell's day (YYYY-MM-DD): «2026-11-23», «23/11/2026», «23/11», «23 نوفمبر 2026», «اليوم 10:00»… → the day; anything else → null
  function dateOf(s, today) {
    const x = clean(s); if (!x) return null;
    let m = x.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = x.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s|$)/);
    const year = (y) => (y ? (y.length === 2 ? '20' + y : y) : String((today || '').slice(0, 4) || new Date().getFullYear()));
    const pad = (n) => String(n).padStart(2, '0');
    if (m) { const d = Number(m[1]), mo = Number(m[2]); if (d < 1 || d > 31 || mo < 1 || mo > 12) return null; return year(m[3]) + '-' + pad(mo) + '-' + pad(d); }
    m = x.match(/^(\d{1,2})\s+(\S+)(?:\s+(\d{4}))?/); if (m) { const mo = MONTHS.indexOf(m[2].replace('إبريل', 'أبريل').replace('ابريل', 'أبريل').replace('اغسطس', 'أغسطس').replace('اكتوبر', 'أكتوبر')); if (mo > -1) return year(m[3]) + '-' + pad(mo + 1) + '-' + pad(Number(m[1])); }
    return null;
  }
  // the kind of a column from its values (and how many rows): 'num' · 'date' · 'cat' (a few repeating values) · 'text' (free text, no
  // filter) · null (an empty column)
  function colKind(values, rows) {
    const ne = (values || []).map(clean).filter((v) => !empty(v)); if (!ne.length) return null;
    if (ne.every((v) => numOf(v) !== null)) return 'num';
    if (ne.every((v) => dateOf(v) !== null)) return 'date';
    const distinct = new Set(ne);
    const n = rows == null ? ne.length : rows;
    if (distinct.size <= CAT_MAX && [...distinct].every((v) => v.length <= 60) && !(distinct.size === n && n > 5)) return 'cat';
    return 'text';
  }
  // a number against the five choices (OR between the choices; none picked = every row)
  function numPass(v, picks) {
    if (!picks || !picks.length) return true;
    const n = typeof v === 'number' ? v : numOf(v);
    return picks.some((p) => (p === 'has' ? n != null && n !== 0 : p === 'none' ? n == null || n === 0 : p === 'pos' ? n != null && n > 0
      : p === 'neg' ? n != null && n < 0 : p === 'zero' ? n === 0 : false));
  }
  // a day against a period [from, to] (either end empty = open); none = every row
  function datePass(day, range) {
    if (!range || (!range[0] && !range[1])) return true;
    const d = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}/.test(day) ? day.slice(0, 10) : dateOf(day);
    if (!d) return false;
    return (!range[0] || d >= range[0]) && (!range[1] || d <= range[1]);
  }
  // the total row's number for one column: the sum of the shown rows' cells, with the original's decimals
  function sumShown(cells, decimals) { const s = cells.reduce((n, c) => n + (numOf(c) || 0), 0); return s.toLocaleString('en-US', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }); }
  const api = { NUM_OPTS, CAT_MAX, TOTAL_LABEL, numOf, dateOf, colKind, numPass, datePass, sumShown, clean, empty };
  root.IBTableRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
