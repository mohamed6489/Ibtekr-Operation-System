import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { CAPS, PLATFORMS, READY, storeOf, isSingle, wooActive, STORE_FREE_ACTIONS } from '../../supabase/functions/_shared/store/index.js';
// The store layer (plan 2026-11-17-stores-single.md T1, 0127): one platform at a time and how the business sells; the page's copy in
// app/js/adapter/settings.js must give the same answers (the server's store_cfg in 0127 too — supabase/tests/rls_store_settings.sql).
const plain = (v) => JSON.parse(JSON.stringify(v));
const src = readFileSync(new URL('../../app/js/adapter/settings.js', import.meta.url), 'utf8');
function page(sections = [], pub = null) {
  const window = { IBSupabase: { client: null }, IBDirectory: { perm: () => 'F', me: () => ({ id: 'a', role_id: 'admin', status: 'active' }), members: () => [] }, IBActivity: { log: () => Promise.resolve() } };
  const ctx = { window, document: { dispatchEvent() {} }, CustomEvent: class {}, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, Error, RegExp };
  ctx.globalThis = ctx; runInNewContext(src, ctx);
  const S = window.IBSettings; for (const s of sections) S.data.sections[s.section] = s.data; if (pub) S.data.public = pub;
  return S;
}

test('no row = WooCommerce + Dokan, marketplace, margin 30, every cap as built', () => {
  const s = storeOf(null);
  assert.deepEqual([s.platform, s.mode, s.dokan, s.margin], ['woo', 'marketplace', true, 30]);
  assert.deepEqual(s.caps, CAPS.woo);
  assert.equal(isSingle(null), false); assert.equal(wooActive(null), true);
});

test('single by choice on WooCommerce, or forced on any platform without Dokan; vendors and sub-orders off then', () => {
  for (const row of [{ mode: 'single' }, { dokan: false }, { dokan: 'false' }, { platform: 'shopify' }, { platform: 'easyorders', mode: 'marketplace' }]) {
    const s = storeOf(row);
    assert.equal(s.mode, 'single', JSON.stringify(row));
    assert.equal(s.caps.vendors, false); assert.equal(s.caps.suborders, false);
  }
  assert.equal(wooActive({ platform: 'shopify' }), false);
  assert.equal(storeOf({ platform: 'nope' }).platform, 'woo');
});

test('the margin: a JSON number 0–500 only (two decimals), else 30 — as store_cfg', () => {
  for (const [m, want] of [[45, 45], [12.345, 12.35], [0, 0], [500, 500], [501, 30], [-1, 30], ['40', 30], [null, 30]]) assert.equal(storeOf({ margin: m }).margin, want, String(m));
});

test('storeOf is idempotent (the server hands its result out as settings_public().store)', () => {
  for (const row of [null, { mode: 'single', margin: 20 }, { platform: 'shopify' }]) assert.deepEqual(storeOf(storeOf(row)), storeOf(row));
});

test('the page copy (IBSettings) = the server copy: platforms, ready, caps, storeOf on the same rows', () => {
  const S = page();
  assert.deepEqual(plain(S.STORE_PLATFORMS), PLATFORMS); assert.deepEqual(plain(S.STORE_READY), READY); assert.deepEqual(plain(S.STORE_CAPS), CAPS);
  for (const row of [null, {}, { mode: 'single' }, { dokan: false }, { platform: 'shopify', margin: 12.345 }, { platform: 'easyorders' }, { platform: 'x', margin: '9' }]) assert.deepEqual(plain(S.storeOf(row)), storeOf(row), JSON.stringify(row));
});

test('IBSettings.store(): the admin row first, else settings_public().store, else WooCommerce', () => {
  assert.equal(page().store().platform, 'woo');
  assert.equal(page([], { store: { platform: 'woo', mode: 'single', dokan: true, margin: 30 } }).single(), true);
  const S = page([{ section: 'store', data: { platform: 'shopify' } }], { store: { platform: 'woo', mode: 'marketplace' } });
  assert.equal(S.store().platform, 'shopify'); assert.equal(S.storeCaps().vendors, false);
});

test('woo-sync keeps the actions that never reach the store open', () => {
  assert.deepEqual(STORE_FREE_ACTIONS, ['thumbs', 'studio_sheet']);
});
