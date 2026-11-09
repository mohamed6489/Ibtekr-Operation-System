import { test } from 'node:test'; import assert from 'node:assert/strict';
import { CART_PATH, cartRow, cartRows } from '../../supabase/functions/_shared/woo-carts.js';
// the visitor's abandoned carts (phase 12 T7): the snippet's rows → cs_carts rows, nothing else

const SITE = 'https://staging.ibtekr.club';
const NOW = '2026-11-09T10:00:00.000Z';

test('cartRow: the fields we keep, the phone digits only, the link https on the site only, a bad status → normal; no id / no time → null', () => {
  const r = cartRow({ id: '41', email: ' Noha@Example.test ', phone: '+20 (101) 234-5678', name: 'نهى عبد الرحمن', total: '1250.456', items: 2, status: 'normal', unsubscribed: false, updated_at: '2026-11-09T08:00:00+00:00', url: SITE + '/checkout/?wcf_ac_token=abc' }, { siteUrl: SITE, now: NOW });
  assert.deepEqual(r, { cart_id: 41, email: 'Noha@Example.test', phone: '+201012345678', name: 'نهى عبد الرحمن', total: 1250.46, items: 2, status: 'normal', unsubscribed: false, url: SITE + '/checkout/?wcf_ac_token=abc', site_updated_at: '2026-11-09T08:00:00.000Z', synced_at: NOW });
  assert.equal(cartRow({ id: 42, updated_at: '2026-11-09T08:00:00Z', url: 'https://evil.test/x', status: 'paid', total: -5, items: 5000 }, { siteUrl: SITE, now: NOW }).url, '', 'a link off the site is dropped');
  const b = cartRow({ id: 42, updated_at: '2026-11-09T08:00:00Z', url: 'http://staging.ibtekr.club/checkout/', status: 'paid', total: -5, items: 5000 }, { siteUrl: SITE, now: NOW });
  assert.deepEqual([b.url, b.status, b.total, b.items, b.email, b.phone], ['', 'normal', 0, 1000, '', '']);
  assert.equal(cartRow({ id: 0, updated_at: '2026-11-09T08:00:00Z' }), null); assert.equal(cartRow({ id: 5, updated_at: 'x' }), null); assert.equal(cartRow('x'), null);
  assert.equal(CART_PATH, 'ibtekr/v1/carts');
});

test('cartRows: bad rows counted, the same id keeps the latest change', () => {
  const { rows, bad } = cartRows([{ id: 1, updated_at: '2026-11-09T08:00:00Z', status: 'normal' }, { id: 1, updated_at: '2026-11-09T09:00:00Z', status: 'completed' }, { id: 'x' }, null], { siteUrl: SITE, now: NOW });
  assert.equal(bad, 2); assert.deepEqual(rows.map((r) => [r.cart_id, r.status]), [[1, 'completed']]);
  assert.deepEqual(cartRows(null), { rows: [], bad: 0 });
});
