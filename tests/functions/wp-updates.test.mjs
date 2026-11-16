// «تحديثات ووردبريس» (comments decision 71) — the pure part of woo-sync's `wp_updates`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreLatest, newer, version, wpStatus } from '../../supabase/functions/_shared/wp-updates.js';

test('versions: compared number by number; a pre-release tail and anything that is not a version are left out', () => {
  assert.equal(newer('6.8.1', '6.8'), true);
  assert.equal(newer('10.0', '9.9.5'), true);
  assert.equal(newer('6.8', '6.8.0'), false);
  assert.equal(newer('6.7.2', '6.8'), false);
  assert.equal(newer('8.5.0-beta.2', '8.5.0'), false);
  assert.equal(newer('', '1.0'), false);
  assert.equal(newer('0', ''), false);
  assert.deepEqual([version(' 3.2.1 '), version('<b>1</b>'), version('v1.0'), version(7), version(null), version('1.0; drop')], ['3.2.1', '1', '', '7', '', '']);
});

test('WordPress.org\'s answer: the newest stable release among the offers', () => {
  assert.equal(coreLatest({ offers: [{ response: 'upgrade', current: '6.8.3' }, { response: 'autoupdate', current: '6.8.3' }, { current: '6.7.4' }, { current: '6.9-RC1' }] }), '6.8.3');
  assert.equal(coreLatest({ offers: [{ version: '6.5' }] }), '6.5');
  assert.equal(coreLatest({}), '');
  assert.equal(coreLatest(null), '');
});

test('the report: names and versions only; what waits first; an update where a newer version is known; nothing of the server leaves', () => {
  const sys = {
    environment: { wp_version: '6.7.2', version: '9.8.1', php_version: '8.2.20', home_url: 'https://shop.example', log_directory: '/home/x/wp-content/uploads/wc-logs/', server_info: 'nginx' },
    theme: { name: 'Woodmart', version: '8.0.4', version_latest: '8.1.0', author_url: 'https://xtemos.example' },
    active_plugins: [
      { plugin: 'woocommerce/woocommerce.php', name: 'WooCommerce', version: '9.8.1', version_latest: '9.8.1', url: 'https://woo.example', author_name: 'Automattic' },
      { plugin: 'dokan-pro/dokan-pro.php', name: 'Dokan <b>Pro</b>', version: '4.0.2', version_latest: '4.0.5' },
      { plugin: 'x/x.php', name: 'No Version Known', version: '1.2', version_latest: '' },
      { plugin: 'y/y.php', name: '', version: '1' }, 'junk'],
    inactive_plugins: [{ name: 'Hello Dolly', version: '1.7.2', version_latest: '1.7.3' }, { name: 'WooCommerce', version: '1' }],
    database: { wc_database_version: '9.8.1' }, security: { secure_connection: true } };
  const r = wpStatus(sys, '6.8.3');
  assert.deepEqual(r.core, { version: '6.7.2', latest: '6.8.3', update: true, known: true });
  assert.deepEqual([r.woo, r.php], [{ version: '9.8.1' }, '8.2.20']);
  assert.deepEqual(r.theme, { name: 'Woodmart', version: '8.0.4', latest: '8.1.0', active: true, update: true });
  assert.deepEqual(r.plugins, [
    { name: 'Dokan Pro', version: '4.0.2', latest: '4.0.5', active: true, update: true },
    { name: 'Hello Dolly', version: '1.7.2', latest: '1.7.3', active: false, update: true },
    { name: 'No Version Known', version: '1.2', latest: '', active: true, update: false },
    { name: 'WooCommerce', version: '9.8.1', latest: '', active: true, update: false }]);
  assert.equal(r.updates, 4);
  const flat = JSON.stringify(r);
  for (const leak of ['shop.example', 'wc-logs', 'nginx', 'woocommerce.php', 'Automattic', 'xtemos', 'database']) assert.equal(flat.includes(leak), false, leak);
  // WordPress.org not read: the site's version alone, no update claimed
  assert.deepEqual(wpStatus(sys, '').core, { version: '6.7.2', latest: '', update: false, known: false });
  // nothing readable
  assert.deepEqual(wpStatus(null, ''), { core: { version: '', latest: '', update: false, known: false }, woo: { version: '' }, php: '', theme: null, plugins: [], updates: 0 });
});
