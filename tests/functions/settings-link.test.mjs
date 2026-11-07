import { test } from 'node:test'; import assert from 'node:assert/strict';
import { CARDS, SECRET_FIELDS, SECRET_NAMES, fieldsOf, linkReady, nameOk, parseSecret, probeCode, probesOf, secretPublic, tailOf } from '../../supabase/functions/_shared/settings-link.js';

test('names: the fixed list, mcp_/custom_ slugs; nothing else', () => {
  SECRET_NAMES.forEach((n) => assert.ok(nameOk(n) && fieldsOf(n), n));
  assert.ok(nameOk('mcp_higgsfield') && fieldsOf('mcp_higgsfield') === SECRET_FIELDS.mcp);
  assert.ok(nameOk('custom_runway') && fieldsOf('custom_runway') === SECRET_FIELDS.custom);
  ['sync_secret', 'mcp_', 'MCP_x', 'ads_meta', 'custom_-x', ''].forEach((n) => assert.equal(nameOk(n), false, n));
});
test('parseSecret merges over the stored link: given replaces, empty removes, omitted stays; the shapes are checked', () => {
  const cur = { key: 're_' + 'a'.repeat(20), from: 'a@ibtekr.club' };
  assert.deepEqual(parseSecret('resend', { from: 'b@ibtekr.club' }, cur).link, { key: cur.key, from: 'b@ibtekr.club' });
  assert.deepEqual(parseSecret('resend', { from: '' }, cur).link, { key: cur.key });
  assert.deepEqual(parseSecret('resend', { key: '' }, cur), { error: 'missing', field: 'key' });
  assert.deepEqual(parseSecret('resend', { key: 'nope' }, null), { error: 'invalid', field: 'key' });
  assert.deepEqual(parseSecret('resend', { bogus: 1 }, null), { error: 'invalid', field: 'bogus' });
  assert.deepEqual(parseSecret('zzz', {}, null), { error: 'unknown_secret' });
  const woo = parseSecret('woo', { url: 'https://ibtekr.club/', ck: 'ck_' + 'a'.repeat(30), cs: 'cs_' + 'b'.repeat(30), push: '1' }, null).link;
  assert.equal(woo.url, 'https://ibtekr.club'); assert.equal(woo.push, true);
  assert.deepEqual(parseSecret('woo', { url: 'http://x.y', ck: woo.ck, cs: woo.cs }, null), { error: 'invalid', field: 'url' });
  assert.deepEqual(parseSecret('woo', { push: 'maybe' }, woo), { error: 'invalid', field: 'push' });
  assert.equal(parseSecret('woo', { push: '' }, woo).link.push, undefined);
  assert.equal(linkReady('woo', woo), true); assert.equal(linkReady('woo', { url: woo.url }), false);
  assert.deepEqual(parseSecret('custom_x', { name: 'Runway', conn: 'API', key: 'rk_12345678' }, null).link, { name: 'Runway', conn: 'API', key: 'rk_12345678' });
  assert.deepEqual(parseSecret('custom_x', { name: 'Runway', conn: 'FTP' }, null), { error: 'invalid', field: 'conn' });
});
test('secretPublic shows a secret as its tail only; probesOf names a safe read or null; probeCode maps the status', () => {
  const p = secretPublic('openai', { key: 'sk-' + 'x'.repeat(30) + '1234' }, { linked_at: 't', linked_by: 'u', test: { ok: true } });
  assert.deepEqual(p, { name: 'openai', fields: { key: '••••1234' }, ready: true, linked_at: 't', linked_by: 'u', test: { ok: true } });
  assert.equal(tailOf('short'), '••••');
  const woo = probesOf('woo', { url: 'https://ibtekr.club', ck: 'ck_a', cs: 'cs_b' });
  assert.equal(woo.length, 1); assert.match(woo[0].url, /^https:\/\/ibtekr\.club\/wp-json\/wc\/v3\/system_status/); assert.equal(woo[0].method, 'GET');
  assert.equal(probesOf('woo', { url: 'https://ibtekr.club', ck: 'ck_a', cs: 'cs_b', wp_user: 'u', wp_app_password: 'p' }).length, 2);
  assert.deepEqual(woo[0].ok(200, { environment: { site_url: 'https://ibtekr.club', version: '9.4' }, settings: { currency: 'EGP' } }), { account: 'https://ibtekr.club · WooCommerce 9.4 · EGP' });
  assert.equal(woo[0].ok(401, {}), null);
  assert.equal(probesOf('higgsfield', { key: 'x' }), null); assert.equal(probesOf('mcp_x', { url: 'https://m' }), null);
  assert.equal(probesOf('gemini', { key: 'k' })[0].headers['x-goog-api-key'], 'k');
  assert.deepEqual([401, 403, 404, 429, 500, 400, 200].map(probeCode), ['unauthorized', 'unauthorized', 'not_found', 'rate', 'provider', 'refused', 'ok']);
  assert.equal(CARDS.length, 22); assert.ok(CARDS.every((c) => !c.secret || nameOk(c.secret)));
});
