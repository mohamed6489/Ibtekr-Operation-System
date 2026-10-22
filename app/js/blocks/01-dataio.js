
/* Ibtekr — data export / import (owner 22 Oct). Pure, no DOM. UMD.
   CSV out (UTF-8 BOM, Arabic or English headers) · CSV in (auto ; or ,) · auto column mapping · row validation
   against the field spec (required / number / date / list / phone / email) with suggestions · new vs update by key · summary. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrDataX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const latin = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '').replace(/^ال/, '');
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function toCSV(rows, fields, opts) {
    const en = opts && opts.lang === 'en'; const lines = [fields.map((f) => esc(en ? f.en || f.label : f.label)).join(',')];
    for (const r of rows || []) lines.push(fields.map((f) => esc(r[f.key])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  const toTSV = (rows, fields, opts) => { const en = opts && opts.lang === 'en'; const c = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
    return [fields.map((f) => c(en ? f.en || f.label : f.label)).join('\t')].concat((rows || []).map((r) => fields.map((f) => c(r[f.key])).join('\t'))).join('\n'); };
  // Excel (owner 22 Oct): array of arrays for SheetJS — header row + raw cell values
  const toAOA = (rows, fields, opts) => { const en = opts && opts.lang === 'en'; return [fields.map((f) => (en ? f.en : f.label))].concat((rows || []).map((r) => fields.map((f) => (r[f.key] == null ? '' : r[f.key])))); };
  function parseCSV(text) {
    let s = String(text || '').replace(/^﻿/, ''); if (!s.trim()) return { headers: [], rows: [] };
    const first = s.split(/\r?\n/)[0]; const outside = first.replace(/"[^"]*"/g, ''); const cnt = (re) => (outside.match(re) || []).length; const d = cnt(/\t/g) ? '\t' : cnt(/;/g) > cnt(/,/g) ? ';' : ','; // a tab = pasted from Google Sheets / Excel
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) { const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true; else if (ch === d) { row.push(cell); cell = ''; } else if (ch === '\r') { /* skip */ } else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else cell += ch; }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    const rows = out.filter((r) => r.some((c) => c.trim() !== ''));
    return { headers: (rows.shift() || []).map((h) => h.trim()), rows, delimiter: d };
  }
  function autoMap(headers, fields) {
    const m = {}; headers.forEach((h, i) => { const n = norm(h); const f = fields.find((x) => [x.label, x.en, x.key].some((c) => c && norm(c) === n)); m[i] = f ? f.key : ''; }); return m;
  }
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0))); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  function suggest(value, options) {
    const n = norm(value); if (!n) return null; const ex = (options || []).find((o) => norm(o) === n); if (ex) return ex;
    let best = null, bd = 3, tie = false; for (const o of options || []) { const dd = lev(n, norm(o)); if (dd < bd) { bd = dd; best = o; tie = false; } else if (dd === bd) tie = true; }
    return best && !tie && bd <= 2 ? best : null;
  }
  const isoOf = (v) => { const t = latin(v).trim(); let y, m, d, x;
    if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+x[1], +x[2], +x[3]]; else if ((x = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [+x[1], +x[2], +x[3]]; else return null;
    const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : null; };
  function cellValue(f, raw) {
    const v = String(raw == null ? '' : raw).trim(); if (v === '') return { v: '' };
    switch (f.type) {
      case 'number': { const n = Number(latin(v).replace(/[,\s]/g, '').replace(/٫/g, '.')); return Number.isFinite(n) ? { v: n } : { e: f.label + ' لازم يكون رقم' }; }
      case 'date': { const d = isoOf(v); return d ? { v: d } : { e: 'التاريخ «' + v + '» غلط — اكتبه كده 25/10/2026' }; }
      case 'enum': { const hit = (f.options || []).find((o) => norm(o) === norm(v)); return hit ? { v: hit } : { e: f.label + ' «' + v + '» مش في القائمة', s: suggest(v, f.options) }; }
      case 'phone': { const p = latin(v).replace(/[\s-]/g, ''); return /^01\d{9}$/.test(p) ? { v: p } : { e: f.label + ' لازم 11 رقم يبدأ بـ 01' }; }
      case 'time': { const m = /^(\d{1,2}):(\d{2})$/.exec(latin(v).replace(/\s/g, '')); return m && +m[1] < 24 && +m[2] < 60 ? { v: m[1].padStart(2, '0') + ':' + m[2] } : { e: f.label + ' لازم يكون ساعة زي 09:00' }; }
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { v } : { e: f.label + ' مش إيميل صحيح' };
      default: return { v };
    }
  }
  // template of a sheet (owner 22 Oct): add = every writable column · update = the key first + the columns that can be edited (only the key is required)
  const HINT = { time: '09:00', number: 'رقم', date: '25/10/2026', phone: '01xxxxxxxxx', email: 'name@mail.com' };
  const keysOf = (key) => (Array.isArray(key) ? key : key ? [key] : []);
  // the match key of a row: one field or several (employee + day …), normalized
  const keyOf = (data, key) => { const ks = keysOf(key); if (!ks.length) return ''; const v = ks.map((k) => (data[k] == null ? '' : String(data[k]))); return v.some((x) => x === '') ? '' : v.map((x) => norm(x)).join('|'); };
  function templateCols(fields, mode, key) {
    const w = (fields || []).filter((f) => !f.readOnly); const ks = keysOf(key);
    const list = mode === 'update' ? ks.map((k) => w.find((f) => f.key === k)).filter(Boolean).concat(w.filter((f) => !ks.includes(f.key) && !f.noUpdate)) : w;
    return list.map((f) => ({ key: f.key, label: f.label, en: f.en, required: mode === 'update' ? ks.includes(f.key) : !!f.required,
      hint: mode === 'update' && ks.includes(f.key) ? 'المفتاح — بيه بنعرف السجل اللي هيتعدّل' : f.type === 'enum' ? (f.options || []).join(' / ') : HINT[f.type] || 'نص' }));
  }
  // rows: arrays of cells · mapping: {colIndex: fieldKey} · ctx.key: unique field · ctx.existing: keys already in the system
  // ctx.mode: 'add' (existing rows are skipped) | 'update' (only existing rows; empty cells keep the old value; ctx.current(key) → record for the diff) | none (legacy)
  function validate(rows, mapping, fields, ctx) {
    const c = ctx || {}; const ex = new Set((c.existing || []).map(norm)); const seen = new Map(); const up = c.mode === 'update';
    const ks = keysOf(c.key); const keyFs = ks.map((k) => fields.find((f) => f.key === k)).filter(Boolean);
    return (rows || []).map((cells, ri) => {
      const data = {}, errors = [], sug = {}; let note;
      Object.keys(mapping).forEach((ci) => { const k = mapping[ci]; if (!k) return; const f = fields.find((x) => x.key === k); const r = cellValue(f, cells[ci]);
        if (r.e) { errors.push(r.e); if (r.s) sug[k] = r.s; } else if (!(up && r.v === '')) data[k] = r.v; });
      if (up) { keyFs.slice().reverse().forEach((kf) => { if (data[kf.key] === undefined || data[kf.key] === '') errors.unshift(kf.label + ' مطلوب عشان نعرف نعدّل أنهي سجل'); }); }
      else fields.filter((f) => f.required).forEach((f) => { if (data[f.key] === undefined || data[f.key] === '') { if (!errors.some((e) => e.indexOf(f.label) === 0)) errors.push(f.label + ' مطلوب'); } });
      const kv = keyOf(data, c.key); if (kv) { if (seen.has(kv)) errors.push('مكرر في الملف (زي صف ' + (seen.get(kv) + 1) + ')'); else seen.set(kv, ri); }
      let status = errors.length ? 'error' : kv && ex.has(kv) ? 'update' : 'new'; let changes;
      if (!errors.length && c.mode === 'add' && status === 'update') { status = 'exists'; note = 'موجود بالفعل — مش هيتضاف (لو عايز تعدّله اختار «تعديل بيانات موجودة»)'; }
      if (!errors.length && up) {
        if (status === 'new') { status = 'error'; errors.push('«' + ks.map((k) => data[k]).join(' · ') + '» مش موجود في السيستم — لو جديد اختار «إضافة بيانات جديدة»'); }
        else { const cur = c.current ? c.current(ks.length > 1 ? data : data[ks[0]]) || {} : {}; changes = Object.keys(data).filter((k) => !ks.includes(k) && String(cur[k] == null ? '' : cur[k]) !== String(data[k])).map((k) => ({ key: k, label: fields.find((f) => f.key === k).label, from: cur[k] == null || cur[k] === '' ? '—' : cur[k], to: data[k] }));
          if (!changes.length) { status = 'same'; note = 'مفيش تغيير'; } }
      }
      const out = { row: ri + 1, data, errors, suggest: Object.keys(sug).length ? sug : undefined, status }; if (note) out.note = note; if (changes) out.changes = changes; return out;
    }).map((r) => { if (!r.suggest) delete r.suggest; return r; });
  }
  function summary(v, onMatch) {
    const s = { create: 0, update: 0, skip: 0, error: 0, total: v.length };
    for (const r of v) { if (r.status === 'error') s.error++; else if (r.status === 'exists' || r.status === 'same') s.skip++; else if (r.status === 'new') s.create++; else if (onMatch === 'تخطّي') s.skip++; else if (onMatch === 'إنشاء نسخة') s.create++; else s.update++; }
    return s;
  }
  const inRange = (rows, key, range) => (!range ? rows.slice() : rows.filter((r) => r[key] && (!range.from || r[key] >= range.from) && (!range.to || r[key] <= range.to)));
  const presetCols = (fields, p) => fields.filter((f) => p === 'full' || !f.sensitive).map((f) => f.key);
  return Object.freeze({ toAOA, keyOf, keysOf, latin, norm, toCSV, toTSV, parseCSV, autoMap, suggest, validate, summary, templateCols, inRange, presetCols, isoOf });
});

