/* Ibtekr — the evaluation's rules (the meeting of 23 Nov [#41 #42], docs/superpowers/plans/2026-11-23-meeting.md phase 7).
   Not a block; pure, the same rules as 0155 on the server (hr_eval_rules_default / hr_eval_items_ok / hr_eval_actions_ok /
   hr_eval_rules_of / hr_eval_score / hr_eval_pct / hr_eval_kinds — tests/domain/eval-rules.test.mjs reads both):
     · items out of 5 with weights summing to 100 (the attendance «att» the only automatic one; weight 0 = not counted), per role
       (settings «hr».evalRules.roles[role]) else the team's (evalRules.items) else the default الحضور 25 · التواصل 25 · الأداء 50;
     · the result = the weighted average of the items that have a score, not rounded; the bonus % = the result × the point (1–20,
       20 by default), never past 100, of the month's holdback;
     · the bands («actions»): from a «min» up — the default under 2.5 warning + meeting · 2.5 a note · 3.5 nothing · 4.5 a reward. */
(function (root) {
  'use strict';
  const DEFAULT = Object.freeze({
    items: [{ id: 'att', name: 'الحضور', weight: 25, auto: true }, { id: 'comm', name: 'التواصل', weight: 25 }, { id: 'perf', name: 'الأداء', weight: 50 }],
    point: 20,
    actions: [{ min: 0, kinds: ['warning', 'meeting'] }, { min: 2.5, kinds: ['note'] }, { min: 3.5, kinds: [] }, { min: 4.5, kinds: ['reward'] }],
  });
  const KINDS = { warning: 'إنذار', meeting: 'ميتنج فردي', note: 'ملاحظة', reward: 'مكافأة إضافية' };
  const MAX_ITEMS = 12; const MAX_BANDS = 8;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const isAuto = (i) => !!(i && i.auto === true);
  // what is wrong with a list of items (an Arabic line for the settings page) or null
  function itemsError(items) {
    if (!Array.isArray(items) || !items.length) return 'لازم بند واحد على الأقل';
    if (items.length > MAX_ITEMS) return 'لحد ' + MAX_ITEMS + ' بند';
    const ids = new Set(); let sum = 0; let manual = 0;
    for (const i of items) {
      if (!i || typeof i !== 'object') return 'بند مش مظبوط';
      const id = String(i.id || ''); const name = String(i.name == null ? '' : i.name).trim(); const w = num(i.weight);
      if (!/^[a-z][a-z0-9_]{0,23}$/.test(id) || ids.has(id)) return 'بند مش مظبوط';
      if (!name) return 'اكتب اسم كل بند'; if (name.length > 40 || /[<>]/.test(name)) return 'اسم البند لحد 40 حرف من غير < >';
      if (w == null || w < 0 || w > 100) return 'الوزن من 0 لـ 100';
      if (isAuto(i) !== (id === 'att')) return 'الحضور بس هو اللي تلقائي';
      if (id !== 'att' && w > 0) manual += 1;
      ids.add(id); sum += w;
    }
    if (Math.round(sum * 1000) / 1000 !== 100) return 'مجموع الأوزان لازم يبقى 100% — دلوقتي ' + (Math.round(sum * 100) / 100) + '%';
    if (!manual) return 'لازم بند واحد غير الحضور بوزن أكبر من صفر';
    return null;
  }
  const itemsOk = (items) => itemsError(items) === null;
  function actionsError(list) {
    if (!Array.isArray(list) || !list.length) return 'لازم شريحة واحدة على الأقل';
    if (list.length > MAX_BANDS) return 'لحد ' + MAX_BANDS + ' شرايح';
    let prev = -1;
    for (let n = 0; n < list.length; n += 1) {
      const a = list[n]; const m = a && num(a.min);
      if (m == null || !Array.isArray(a.kinds)) return 'شريحة مش مظبوطة';
      if (n === 0 && m !== 0) return 'أول شريحة من صفر';
      if (m <= prev) return 'بداية كل شريحة لازم تبقى أكبر من اللي قبلها';
      if (m > 5) return 'البداية من 0 لـ 5';
      if (a.kinds.some((k) => !KINDS[k])) return 'إجراء مش معروف';
      prev = m;
    }
    return null;
  }
  const actionsOk = (list) => actionsError(list) === null;
  const pointOk = (p) => num(p) != null && p >= 1 && p <= 20;
  // the settings' evalRules (any shape) → the rules of a role, like hr_eval_rules_of
  function rulesOf(evalRules, roleId) {
    const v = evalRules && typeof evalRules === 'object' && !Array.isArray(evalRules) ? evalRules : {};
    const role = roleId && v.roles && typeof v.roles === 'object' ? v.roles[roleId] : null;
    const items = itemsOk(role) ? role : itemsOk(v.items) ? v.items : DEFAULT.items;
    return { items: copy(items), point: pointOk(v.point) ? v.point : DEFAULT.point, actions: copy(actionsOk(v.actions) ? v.actions : DEFAULT.actions) };
  }
  // the result out of 5 — null when no item but the attendance has a score
  function score(scores, att, rules) {
    let w = 0; let s = 0; let manual = 0;
    ((rules && rules.items) || []).forEach((i) => {
      const wt = num(i.weight); if (!(wt > 0)) return;
      const v = isAuto(i) ? num(att) : num(scores && scores[i.id]); if (v == null) return;
      if (!isAuto(i)) manual += 1; w += wt; s += wt * v;
    });
    return !manual || !w ? null : Math.round(s / w * 10000) / 10000;
  }
  const pct = (total, rules) => (total == null ? null : Math.min(100, Math.round(total * (pointOk(rules && rules.point) ? rules.point : DEFAULT.point) * 100) / 100));
  function kinds(total, rules) {
    if (total == null) return [];
    let out = []; ((rules && rules.actions) || []).forEach((a) => { if (num(a.min) != null && a.min <= total) out = a.kinds || []; });
    return out.slice();
  }
  // the scores of an evaluation made before 0155 (its two columns)
  const scoresOf = (x) => (x && x.scores && typeof x.scores === 'object' ? x.scores : Object.fromEntries([['perf', x && x.perf], ['comm', x && x.comm]].filter((p) => p[1] != null)));
  const fmt = (n) => (n == null ? '—' : String(Math.round(n * 10000) / 10000));
  const kindsText = (list) => (list || []).map((k) => KINDS[k] || k).join(' + ');
  // a new item's id from its name's order (the name is Arabic; the id is ours)
  function newId(items) { const ids = new Set((items || []).map((i) => i.id)); let n = 1; while (ids.has('i' + n)) n += 1; return 'i' + n; }
  const api = { DEFAULT, KINDS, MAX_ITEMS, MAX_BANDS, itemsError, itemsOk, actionsError, actionsOk, pointOk, rulesOf, score, pct, kinds, scoresOf, fmt, kindsText, newId };
  root.IBEvalRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
