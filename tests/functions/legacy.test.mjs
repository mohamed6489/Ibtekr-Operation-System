// Phase 9 (meeting 23 Nov — the old orders' import): LIVE_FROM is the day the sync starts from (woo-core START_DATE), and an order placed
// before it is history — the engines (notify's rules, cs-auto) read the orders from LIVE_FROM on only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_FROM, isLegacy } from '../../supabase/functions/_shared/legacy.js';
import { START_DATE, mapOrder } from '../../supabase/functions/_shared/woo-core.js';

test('LIVE_FROM is START_DATE at midnight UTC; isLegacy splits on it', () => {
  assert.equal(LIVE_FROM, `${START_DATE}T00:00:00Z`);
  assert.equal(isLegacy('2026-08-13T23:59:59Z'), true);
  assert.equal(isLegacy('2026-08-14T00:00:00Z'), false);
  assert.equal(isLegacy(null), false);
});

test('mapOrder: the sync skips an old order; legacy takes the old ones only (an order of the sync\'s side is the sync\'s)', () => {
  const o = (created) => ({ id: 7, number: '7', status: 'completed', date_created_gmt: created, date_modified_gmt: created, line_items: [] });
  assert.equal(mapOrder(o('2026-03-02T10:00:00')).skipped, 'before_start');
  const statusMap = [{ system_status: 'مكتمل', woo_status: 'completed', direction: 'both' }];
  assert.equal(mapOrder(o('2026-03-02T10:00:00'), { legacy: true, statusMap }).skipped, undefined); // mapped, not skipped
  assert.equal(mapOrder(o('2026-10-02T10:00:00'), { legacy: true }).skipped, 'after_start');
  assert.equal(mapOrder({ ...o('2026-03-02T10:00:00'), status: 'checkout-draft' }, { legacy: true }).skipped, 'draft');
});

test('phase 9 (Safwat 24 Nov): «delivery-completed» is «مكتمل»; any other status with no counterpart leaves an old order out', () => {
  const map = [{ system_status: 'جاري التنفيذ', woo_status: 'processing', direction: 'both' }, { system_status: 'مكتمل', woo_status: 'completed', direction: 'both' }];
  const o = (status) => ({ id: 7, number: '7', status, date_created_gmt: '2026-03-02T10:00:00', date_modified_gmt: '2026-03-02T10:00:00', line_items: [] });
  assert.equal(mapOrder(o('delivery-completed'), { legacy: true, statusMap: map }).order.status, 'مكتمل');
  assert.equal(mapOrder(o('some-plugin-status'), { legacy: true, statusMap: map }).skipped, 'unmapped');
});
