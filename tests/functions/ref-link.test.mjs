import { test } from 'node:test'; import assert from 'node:assert/strict';
import { refUrl, privateIp, pageImage, imageKind, refName, tiktokCover, REF_HOPS } from '../../supabase/functions/_shared/ref-link.js';
// The owner 15 Nov («السيستم مش قابل اي لينكات»): a campaign's examples / photos take any public link — the pure rules the server
// (ai-images ref_link) fetches under: which links, which addresses, the page's picture, the image's type by its bytes.

test('refUrl: https on the default port with a public DNS name only', () => {
  for (const ok of ['https://pin.it/4yUtHzQQl', 'https://www.pinterest.com/pin/123/', 'https://i.pinimg.com/736x/a.jpg?x=1', 'https://cdn.example.com:443/a.png', '  https://behance.net/gallery/1  ']) assert.ok(refUrl(ok), ok);
  for (const bad of ['http://pin.it/x', 'ftp://a.com/x', 'https://127.0.0.1/', 'https://0x7f.1/', 'https://2130706433/', 'https://[::1]/', 'https://[fe80::1]/', 'https://localhost/', 'https://a.localhost/',
    'https://nas.local/', 'https://metadata.google.internal/', 'https://router.lan/', 'https://intranet/', 'https://u:p@a.com/', 'https://a.com:8443/', 'javascript:alert(1)', 'نص', '', null, 'https://' + 'a'.repeat(2000) + '.com'])
    assert.equal(refUrl(bad), null, String(bad).slice(0, 40));
  assert.equal(REF_HOPS, 5);
});

test('privateIp: loopback, private, link-local, CGNAT, reserved and multicast — IPv4, IPv6 and mapped', () => {
  for (const p of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip'])
    assert.equal(privateIp(p), true, p);
  for (const p of ['151.101.0.84', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2a04:4e42::84', '::ffff:8.8.8.8']) assert.equal(privateIp(p), false, p);
});

test('pageImage: og:image (any attribute order, entities), then twitter:image, then <link rel=image_src>; relative made absolute', () => {
  assert.equal(pageImage('<meta content="https://i.pinimg.com/a.jpg?w=1&amp;h=2" property="og:image">', 'https://www.pinterest.com/pin/1/'), 'https://i.pinimg.com/a.jpg?w=1&h=2');
  assert.equal(pageImage("<meta property='og:image:secure_url' content='https://s.com/1.jpg'><meta property='og:image' content='http://s.com/1.jpg'>", 'https://s.com/'), 'https://s.com/1.jpg');
  assert.equal(pageImage('<meta name="twitter:image" content="/img/t.png">', 'https://site.com/post/9'), 'https://site.com/img/t.png');
  assert.equal(pageImage('<link rel="image_src" href="https://x.com/i.webp">', 'https://x.com/'), 'https://x.com/i.webp');
  assert.equal(pageImage('<title>no picture</title>', 'https://x.com/'), null);
  assert.equal(pageImage('', 'https://x.com/'), null);
});

test('imageKind: PNG / JPEG / WebP by the first bytes; GIF, SVG, HTML and short bodies are not taken', () => {
  const b = (...n) => new Uint8Array([...n, ...new Array(12).fill(0)]);
  assert.equal(imageKind(b(137, 80, 78, 71, 13, 10, 26, 10)), 'image/png');
  assert.equal(imageKind(b(255, 216, 255, 224)), 'image/jpeg');
  assert.equal(imageKind(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80, 0])), 'image/webp');
  assert.equal(imageKind(b(71, 73, 70, 56, 57, 97)), null);
  assert.equal(imageKind(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageKind(new Uint8Array([255, 216])), null);
  assert.equal(refName(new URL('https://www.pinterest.com/pin/1')), 'لينك — pinterest.com');
});

test('tiktokCover (the owner 17 Nov — TikTok\'s oEmbed names no thumbnail): the cover after that video\'s id in the page data, decoded; another id, none, a bad link → null', () => {
  const html = '<script>{"a":{"id":"7499","cover":"https:\\u002F\\u002Fp16.tiktokcdn.com\\u002Fother.jpg"},"b":{"id":"7400000000000000002","video":{"cover":"https:\\u002F\\u002Fp16.tiktokcdn-eu.com\\u002Fc.image?x-expires=1&s=a%3D"}}}</script>';
  assert.equal(tiktokCover(html, '7400000000000000002'), 'https://p16.tiktokcdn-eu.com/c.image?x-expires=1&s=a%3D');
  assert.equal(tiktokCover(html, '7400000000000000003'), null);
  assert.equal(tiktokCover('<p>"id":"7400000000000000002"</p>', '7400000000000000002'), null);
  assert.equal(tiktokCover('{"id":"7400000000000000002","cover":"javascript:alert(1)//aaaaaaaa"}', '7400000000000000002'), null);
  assert.equal(tiktokCover(html, 'x"'), null);
  assert.equal(tiktokCover(null, '7400000000000000002'), null);
});
