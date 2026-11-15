import test from 'node:test';
import assert from 'node:assert/strict';
import { imageHosts, siteImage, thumbCandidates, imageKind, thumbUrls } from '../../supabase/functions/_shared/site-image.js';

const HOSTS = imageHosts({ WOO_URL: 'https://Shop.Test/', IMAGE_HOSTS: 'cdn.shop.test, bad host!, ' });

test('the hosts: the site\'s own and the listed CDN, exact names, lower-cased', () => {
  assert.deepEqual([...HOSTS].sort(), ['cdn.shop.test', 'shop.test']);
  assert.deepEqual([...imageHosts({})], []);
  assert.deepEqual([...imageHosts({ WOO_URL: 'not a url' })], []);
});

test('a site upload: https, an allowed host, under /wp-content/uploads/, an image by its name; the query is dropped', () => {
  assert.equal(siteImage('https://shop.test/wp-content/uploads/2026/11/a-b.webp?x=1#y', HOSTS).href, 'https://shop.test/wp-content/uploads/2026/11/a-b.webp');
  assert.equal(siteImage('https://CDN.shop.test/wp-content/uploads/a.JPG', HOSTS).hostname, 'cdn.shop.test');
  for (const bad of [
    'http://shop.test/wp-content/uploads/a.webp', // not https
    'https://other.test/wp-content/uploads/a.webp', // another host
    'https://shop.test.evil.test/wp-content/uploads/a.webp', // a look-alike
    'https://user:pw@shop.test/wp-content/uploads/a.webp', // credentials
    'https://shop.test:8443/wp-content/uploads/a.webp', // a port
    'https://shop.test/wp-admin/a.webp', // not an upload
    'https://shop.test/wp-content/uploads/../../wp-config.php', // climbs out
    'https://shop.test/wp-content/uploads/%2e%2e/secret.png', // … encoded
    'https://shop.test/wp-content/uploads/a.php', // not an image
    'https://shop.test/wp-content/uploads/a.svg', // not one of ours
    'https://169.254.169.254/wp-content/uploads/a.png', // an address
    '', null, 5, 'x'.repeat(501),
  ]) assert.equal(siteImage(bad, HOSTS), null, String(bad));
  assert.equal(siteImage('https://shop.test/wp-content/uploads/a.webp', new Set()), null);
});

test('the copies to try: the two small WordPress sizes, then the original; a sized name as it is', () => {
  const u = siteImage('https://shop.test/wp-content/uploads/2026/11/Lamp-IBT-01.webp', HOSTS);
  assert.deepEqual(thumbCandidates(u), ['https://shop.test/wp-content/uploads/2026/11/Lamp-IBT-01-150x150.webp', 'https://shop.test/wp-content/uploads/2026/11/Lamp-IBT-01-300x300.webp', u.href]);
  const s = siteImage('https://shop.test/wp-content/uploads/a-700x800.jpg', HOSTS);
  assert.deepEqual(thumbCandidates(s), [s.href]);
});

test('the bytes say what the file is', () => {
  const pad = (a) => Uint8Array.from(a.concat(new Array(12).fill(0)).slice(0, 12));
  assert.equal(imageKind(pad([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(imageKind(pad([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(imageKind(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(imageKind(pad([0x3c, 0x68, 0x74, 0x6d])), null); // html
  assert.equal(imageKind(Uint8Array.from([0xff, 0xd8])), null); // too short
});

test('the request: 1–12 strings, the same one once', () => {
  assert.deepEqual(thumbUrls(['a', 'b', 'a']), ['a', 'b']);
  for (const bad of [null, 'a', [], new Array(13).fill('a').map((x, i) => x + i), ['a', 5], [''], ['x'.repeat(501)]]) assert.equal(thumbUrls(bad), null);
});
