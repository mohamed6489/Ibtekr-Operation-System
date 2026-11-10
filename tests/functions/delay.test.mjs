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
