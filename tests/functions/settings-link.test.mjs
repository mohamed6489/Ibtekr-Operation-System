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
  // a new host drops the stored secrets: the keys must come with the url (security review)
  assert.deepEqual(parseSecret('woo', { url: 'https://evil.example' }, woo), { error: 'missing', field: 'ck' });
  assert.equal(parseSecret('woo', { url: 'https://ibtekr.club' }, woo).link.ck, woo.ck, 'the same host keeps them');
  assert.equal(parseSecret('woo', { push: true }, woo).link.cs, woo.cs, 'no url in the save keeps them');
  assert.deepEqual(parseSecret('woo', { url: ['https://ibtekr.club'] }, woo), { error: 'invalid', field: 'url' }, 'no array coerced into a url');
  assert.deepEqual(parseSecret('woo', { url: { toString: () => 'https://ibtekr.club' } }, woo), { error: 'invalid', field: 'url' });
  assert.deepEqual(parseSecret('woo', { url: 'https://ibtekr.club/shop/' }, woo).link.ck, woo.ck, 'the same origin with a path keeps them');
  assert.deepEqual(parseSecret('woo', { url: '' }, woo), { error: 'missing', field: 'url' }, 'an emptied url drops the secrets too');
  assert.deepEqual(parseSecret('openai', { key: 123 }, null), { error: 'invalid', field: 'key' });
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
  assert.equal(CARDS.length, 25); // + YouTube and SerpApi (28 Nov — the trends from free sources) // + Shopify (17 Nov) assert.ok(CARDS.every((c) => !c.secret || nameOk(c.secret)));
});

test('shopify (the owner 17 Nov): the myshopify domain and an Admin API token; the probe reads the shop with the token header', async () => {
  const { parseSecret, probesOf, linkReady } = await import('../../supabase/functions/_shared/settings-link.js');
  assert.equal(parseSecret('shopify', { shop: 'evil.com', key: 'shpat_' + 'a'.repeat(32) }, null).field, 'shop');
  const ok = parseSecret('shopify', { shop: 'ibtekr.myshopify.com', key: 'shpat_' + 'a'.repeat(32) }, null);
  assert.ok(linkReady('shopify', ok.link));
  const p = probesOf('shopify', ok.link)[0];
  assert.equal(p.url, 'https://ibtekr.myshopify.com/admin/api/2025-07/shop.json'); assert.equal(p.headers['X-Shopify-Access-Token'], 'shpat_' + 'a'.repeat(32));
});

test('data-real decision 11: the WordPress user and its Application Password are saved together or not at all', () => {
  const base = { url: 'https://ibtekr.club', ck: 'ck_' + 'a'.repeat(40), cs: 'cs_' + 'b'.repeat(40) };
  assert.deepEqual(parseSecret('woo', { ...base, wp_app_password: 'abcd efgh ijkl mnop' }, null), { error: 'missing', field: 'wp_user' });
  assert.deepEqual(parseSecret('woo', { ...base, wp_user: 'admin' }, null), { error: 'missing', field: 'wp_app_password' });
  assert.equal(parseSecret('woo', { ...base, wp_user: 'admin', wp_app_password: 'abcd efgh ijkl mnop' }, null).link.wp_user, 'admin');
  assert.ok(parseSecret('woo', base, null).link); // neither = fine (read-only Dokan fields)
  // a stored pair keeps working when only the user is changed
  const stored = { ...base, wp_user: 'admin', wp_app_password: 'abcd efgh ijkl mnop' };
  assert.equal(parseSecret('woo', { wp_user: 'owner' }, stored).link.wp_user, 'owner');
});

test('youtube / serpapi (Safwat 28 Nov — the trends from free sources): a Google API key and SerpApi\'s key; YouTube\'s probe carries the key in a header, SerpApi\'s reads its account (no search counted)', async () => {
  const yt = 'AIza' + 'B'.repeat(35); const serp = 'c'.repeat(64);
  assert.equal(parseSecret('youtube', { key: 'sk-not-a-google-key' }, null).field, 'key');
  const a = parseSecret('youtube', { key: yt }, null); assert.ok(linkReady('youtube', a.link));
  const p = probesOf('youtube', a.link)[0];
  assert.equal(p.headers['x-goog-api-key'], yt); assert.ok(!p.url.includes(yt), 'the YouTube key never in the address');
  assert.deepEqual(p.ok(200, { items: [{}] }), { account: 'YouTube Data API شغّال' }); assert.equal(p.ok(403, {}), null);
  assert.equal(parseSecret('serpapi', { key: 'short' }, null).field, 'key');
  const b = parseSecret('serpapi', { key: serp }, null); assert.ok(linkReady('serpapi', b.link));
  const q = probesOf('serpapi', b.link)[0];
  assert.ok(q.url.startsWith('https://serpapi.com/account.json?api_key='));
  assert.deepEqual(q.ok(200, { plan_name: 'Free Plan', plan_searches_left: 240 }), { account: 'Free Plan · 240 بحث فاضل الشهر ده' });
  assert.ok(CARDS.some((c) => c.id === 'youtube' && c.secret === 'youtube' && c.kind === 'site') && CARDS.some((c) => c.id === 'serpapi' && c.secret === 'serpapi'));
  assert.equal(secretPublic('serpapi', b.link).fields.key, '••••' + serp.slice(-4), 'only its last four');
});
