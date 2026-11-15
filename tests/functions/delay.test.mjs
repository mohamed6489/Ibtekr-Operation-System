// Phase 13 decision 52 — the delay rule: the order from its confirmation (none while not confirmed), the sub-order from the maker's
// notify date against the making days (the product's own, else the maker's). The server's copy (_shared/delay.js) and block 12's
// (IbtekrOps) must answer the same on every case.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as S from '../../supabase/functions/_shared/delay.js';
import { loadUmd } from '../helpers/load-umd.mjs';
const O = loadUmd(new URL('../../app/js/blocks/12-ops-domain.js', import.meta.url));

const T = '2026-11-20';
test('the order: no delay while not confirmed, whatever its age; from the confirmation date once confirmed', () => {
  assert.equal(S.confirmAge({ confirm: 'غير مؤكد', confirmAt: null, placedAt: '2026-10-01' }, T), null);
  assert.equal(S.confirmAge({ confirm: 'في انتظار الرد', confirmAt: null, placedAt: '2026-10-01' }, T), null);
  assert.equal(S.orderDelay(S.confirmAge({ confirm: 'غير مؤكد', placedAt: '2026-10-01' }, T)), 'ok', 'an old unconfirmed order is not late');
  assert.equal(S.confirmAge({ confirm: 'مؤكد بعربون', confirmAt: '2026-11-15', placedAt: '2026-10-01' }, T), 5, 'from the confirmation, not the order date');
  assert.equal(S.confirmAge({ confirm: 'مؤكد بدون عربون', confirmAt: null, placedAt: '2026-11-10T08:00:00Z' }, T), 10, 'confirmed without a date: the order date');
  assert.deepEqual([8, 9, 11, 12, 30].map((a) => S.orderDelay(a)), ['ok', 'risk', 'risk', 'late', 'late']);
  assert.equal(S.orderDelay(10, { riskFrom: 5, lateFrom: 10 }), 'late', 'the settings move the days');
});
test('the sub-order: from the notify date against the making days (product, else maker, else 7); risk in the last 3 days, late after', () => {
  assert.equal(S.leadOf(10, 5), 10); assert.equal(S.leadOf(null, 5), 5); assert.equal(S.leadOf(null, null), 7); assert.equal(S.leadOf(0, 200), 7);
  const el = S.subElapsed({ notifiedAt: '2026-11-12', confirm: 'غير مؤكد' }, T); assert.equal(el, 8, 'the notify date counts even before the order is confirmed');
  assert.deepEqual([4, 5, 7, 8].map((e) => S.subDelay(e, 7)), ['ok', 'risk', 'risk', 'late']);
  assert.equal(S.subDelay(20, 7, false), 'ok', 'a closed line is never late');
  assert.equal(S.subElapsed({ notifiedAt: '', confirm: 'غير مؤكد', placedAt: '2026-10-01' }, T), null, 'no notify date and not confirmed: nothing counted');
  assert.equal(S.subDelay(null, 7), 'ok');
  assert.equal(S.subElapsed({ notifiedAt: null, confirm: 'مؤكد بعربون', confirmAt: '2026-11-17' }, T), 3, 'no notify date: from the confirmation');
  assert.equal(S.subDelay(2, 2), 'risk', 'a short making time is at risk from the first day');
});
test('block 12 (IbtekrOps) answers like the server on every case', () => {
  const orders = [{ confirm: 'غير مؤكد', placedAt: '2026-09-01' }, { confirm: 'مؤكد بعربون', confirmAt: '2026-11-11' }, { confirm: 'مؤكد بدون عربون', placedAt: '2026-11-01' }, { confirm: 'مؤكد بعربون', confirmAt: '2026-11-19' }];
  for (const o of orders) { assert.equal(O.confirmAge(o, T), S.confirmAge(o, T)); assert.equal(O.orderDelay(O.confirmAge(o, T)), S.orderDelay(S.confirmAge(o, T))); }
  const subs = [{ notifiedAt: '2026-11-10' }, { notifiedAt: '2026-11-18' }, { notifiedAt: '', confirm: 'مؤكد بعربون', confirmAt: '2026-11-01' }, { confirm: 'غير مؤكد' }];
  for (const s of subs) for (const lead of [null, 1, 3, 7, 15]) {
    assert.equal(O.subElapsed(s, T), S.subElapsed(s, T));
    assert.equal(O.subDelay(O.subElapsed(s, T), O.leadOf(lead, 7)), S.subDelay(S.subElapsed(s, T), S.leadOf(lead, 7)));
  }
  assert.deepEqual(O.DELAY, { riskFrom: S.RISK_FROM, lateFrom: S.LATE_FROM, lead: S.LEAD_DEFAULT, window: S.RISK_WINDOW });
});

// owner batch 2 decision 17: the rules from the settings
test('decision 17: the rules — defaults, bad values back to the defaults, the stop statuses', () => {
  assert.deepEqual(S.delayRules(null), { start: 'confirm', orderRisk: 2, subRisk: 2, lead: 7, stop: ['قيد الشحن', 'مكتمل', 'ملغي', 'استرجاع', 'فشل'] });
  assert.deepEqual(S.delayRules({ start: 'order', orderRisk: 3, subRisk: 0, lead: 10, stop: ['مكتمل', 'مكتمل', ' ملغي '] }), { start: 'order', orderRisk: 3, subRisk: 0, lead: 10, stop: ['مكتمل', 'ملغي'] });
  assert.deepEqual(S.delayRules({ start: 'x', orderRisk: -1, subRisk: 'a', lead: 0 }), S.delayRules({}));
});
test('decision 17: the order against the longest making days of its open lines — risk N days before, late once past, a stop status never', () => {
  const r = S.delayRules({});
  assert.deepEqual([4, 5, 7, 8].map((e) => S.orderDelayOf({ status: 'جاري التنفيذ', elapsed: e, maxLead: 7 }, r)), ['ok', 'risk', 'risk', 'late']);
  assert.equal(S.orderDelayOf({ status: 'قيد الشحن', elapsed: 30, maxLead: 7 }, r), 'ok', 'moved to shipping: never late');
  assert.equal(S.orderDelayOf({ status: 'جاهز للشحن', elapsed: 30, maxLead: 7 }, r), 'late', 'ready but not shipped still counts');
  assert.equal(S.orderDelayOf({ status: 'جاري التنفيذ', elapsed: 30, maxLead: null }, r), 'ok', 'no open line');
  assert.equal(S.orderDelayOf({ status: 'جاري التنفيذ', elapsed: null, maxLead: 7 }, r), 'ok', 'not confirmed');
  assert.equal(S.orderDelayOf({ status: 'جاري التنفيذ', elapsed: 6, maxLead: 10 }, S.delayRules({ orderRisk: 4 })), 'risk', 'the settings move the risk days');
  assert.equal(S.orderDelayOf({ status: 'قيد الشحن', elapsed: 30, maxLead: 7 }, S.delayRules({ stop: ['مكتمل'] })), 'late', 'the stop list is the settings');
});
test('decision 17: the start point — confirmation (default), the order date, or the notify date only for a line', () => {
  const o = { confirm: 'غير مؤكد', confirmAt: null, placedAt: '2026-11-10' };
  assert.equal(S.orderElapsed(o, T, S.delayRules({})), null); assert.equal(S.orderElapsed(o, T, S.delayRules({ start: 'order' })), 10);
  assert.equal(S.lineElapsed({ ...o, notifiedAt: null }, T, S.delayRules({ start: 'order' })), 10);
  assert.equal(S.lineElapsed({ confirm: 'مؤكد بعربون', confirmAt: '2026-11-15', notifiedAt: null }, T, S.delayRules({ start: 'notify' })), null, 'notify: nothing without the notify date');
  assert.equal(S.lineElapsed({ notifiedAt: '2026-11-18' }, T, S.delayRules({ start: 'notify' })), 2);
  // the owner 15 Nov: «بناء علي تاريخ التأكيد» — a line counts from the order's start point; the notify date only with start 'notify'
  const late = { confirm: 'مؤكد بدون عربون', confirmAt: '2026-09-13', notifiedAt: '2026-11-15', placedAt: '2026-09-12' };
  assert.equal(S.lineElapsed(late, T, S.delayRules({})), 68, 'start confirm: from the confirmation, not the later notify date');
  assert.equal(S.lineDelayOf(S.lineElapsed(late, T, S.delayRules({})), 7, true, S.delayRules({})), 'late');
  assert.equal(S.lineElapsed(late, T, S.delayRules({ start: 'order' })), 69, 'start order: from the order date');
  assert.equal(S.lineElapsed(late, T, S.delayRules({ start: 'notify' })), 5, 'start notify: from the notify date');
  assert.equal(S.lineElapsed({ ...late, confirm: 'غير مؤكد', confirmAt: null }, T, S.delayRules({})), null, 'not confirmed: no counter even with a notify date');
  assert.deepEqual([4, 5, 7, 8].map((e) => S.lineDelayOf(e, 7, true, S.delayRules({}))), ['ok', 'risk', 'risk', 'late']);
  assert.equal(S.lineDelayOf(6, 7, true, S.delayRules({ subRisk: 0 })), 'ok'); assert.equal(S.lineDelayOf(20, 7, false, S.delayRules({})), 'ok', 'a closed line is never late');
  assert.equal(S.leadBy(null, null, S.delayRules({ lead: 12 })), 12, 'the default making days from the settings');
});
test('decision 17: block 12 answers like the server on every case', () => {
  const rules = [{}, { start: 'order', orderRisk: 3 }, { start: 'notify', subRisk: 0, lead: 10 }, { stop: ['مكتمل'] }];
  const os = [{ confirm: 'غير مؤكد', placedAt: '2026-11-01' }, { confirm: 'مؤكد بعربون', confirmAt: '2026-11-12', placedAt: '2026-11-01' }, { confirm: 'مؤكد بدون عربون', placedAt: '2026-11-15', notifiedAt: '2026-11-16' }];
  for (const raw of rules) {
    assert.deepEqual(O.delayRules(raw), S.delayRules(raw));
    const r = S.delayRules(raw); const r2 = O.delayRules(raw);
    for (const o of os) {
      assert.equal(O.orderElapsed(o, T, r2), S.orderElapsed(o, T, r)); assert.equal(O.lineElapsed(o, T, r2), S.lineElapsed(o, T, r));
      for (const st of ['جاري التنفيذ', 'قيد الشحن', 'مكتمل']) for (const ml of [null, 3, 7, 12]) assert.equal(O.orderDelayOf({ status: st, elapsed: O.orderElapsed(o, T, r2), maxLead: ml }, r2), S.orderDelayOf({ status: st, elapsed: S.orderElapsed(o, T, r), maxLead: ml }, r));
      for (const lead of [null, 2, 7]) assert.equal(O.lineDelayOf(O.lineElapsed(o, T, r2), lead, true, r2), S.lineDelayOf(S.lineElapsed(o, T, r), lead, true, r));
    }
  }
  assert.deepEqual(O.DELAY_STOP, S.DELAY_STOP); assert.deepEqual(O.START_POINTS, S.START_POINTS);
});
