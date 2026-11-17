// The media buyer looks at the Meta Pixel (the owner 17 Nov — «يبص علي البيكسل و لو في حاجة محتاجة تتصلح يقدر يساعدني نصلحها»):
// the pure part — Meta's answers read, the site's page scanned, the issues with their fixes, the text for the chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checksOf, eventCounts, pixelPath, pixelReport, pixelText, pixelsOf, siteScan } from '../../supabase/functions/_shared/mkt-pixel.js';

const NOW = '2026-11-17T12:00:00Z';
const PIX = { id: '1234567890', name: 'Ibtekr', lastFired: '2026-11-17T11:00:00.000Z', unavailable: false, matching: true };
const ALL = { PageView: 900, ViewContent: 400, AddToCart: 60, InitiateCheckout: 30, Purchase: 10 };

test('pixel: Meta\'s answers are read (ids only digits, stats summed per event, checks as data)', () => {
  assert.deepEqual(pixelsOf({ data: [{ id: '123456789', name: 'P<b>', last_fired_time: '2026-11-17T10:00:00+0000', enable_automatic_matching: true }, { id: 'x' }] }),
    [{ id: '123456789', name: 'P b', lastFired: '2026-11-17T10:00:00.000Z', unavailable: false, matching: true }]);
  assert.deepEqual(eventCounts({ data: [{ data: [{ value: 'PageView', count: 3 }, { value: 'Purchase', count: 1 }] }, { data: [{ value: 'PageView', count: '2' }] }] }), { PageView: 5, Purchase: 1 });
  assert.equal(checksOf({ data: [{ key: 'k', title: 'T', result: 'FAILED' }] })[0].result, 'failed');
  assert.match(pixelPath.stats('1', 10, 20), /\/1\/stats\?aggregation=event&start_time=10&end_time=20$/);
});

test('pixel: the site page — the ids it starts, twice, the plugins, GTM', () => {
  const html = "<script>fbq('init', '1234567890');fbq('init','1234567890')</script><script src='https://connect.facebook.net/en_US/fbevents.js'></script>pysOptions={\"pixelIds\":[\"999999999\"]} facebook-for-woocommerce";
  const s = siteScan(html);
  assert.deepEqual(s.ids, ['1234567890', '999999999']); assert.equal(s.inits, 2); assert.equal(s.script, true);
  assert.deepEqual(s.plugins, ['PixelYourSite', 'Facebook for WooCommerce']);
  assert.equal(siteScan('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>').gtm, true);
});

test('pixel: a healthy pixel has no issue', () => {
  const r = pixelReport({ pixels: [PIX], events: ALL, checks: [{ key: 'a', title: 'ok', result: 'passed' }], site: siteScan("fbq('init','1234567890')"), orders: 10, now: NOW });
  assert.deepEqual(r.issues, []); assert.equal(r.ok, true); assert.equal(r.purchases, 10);
});

test('pixel: no pixel; silent; wrong id on the site; missing Purchase; double counted; missing purchases — bad first, each with a fix', () => {
  assert.equal(pixelReport({ pixels: [], now: NOW }).issues[0].key, 'no_pixel');
  const silent = pixelReport({ pixels: [{ ...PIX, lastFired: '2026-11-15T00:00:00Z', matching: false }], events: { PageView: 5 }, site: siteScan("fbq('init','555555555')"), orders: 20, now: NOW });
  const keys = silent.issues.map((i) => i.key);
  for (const k of ['silent', 'site_other', 'event_Purchase', 'missing', 'matching', 'event_AddToCart']) assert.ok(keys.includes(k), k);
  assert.equal(silent.ok, false);
  assert.ok(silent.issues.findIndex((i) => i.level === 'warn') > silent.issues.findIndex((i) => i.key === 'missing'));
  assert.ok(silent.issues.every((i) => i.fix && i.title));
  const dbl = pixelReport({ pixels: [PIX], events: { ...ALL, Purchase: 30 }, site: null, orders: 10, now: NOW });
  assert.deepEqual(dbl.issues.map((i) => i.key), ['double']);
  const twice = pixelReport({ pixels: [PIX], events: ALL, site: siteScan("fbq('init','1234567890');fbq('init','1234567890')"), orders: 10, now: NOW });
  assert.deepEqual(twice.issues.map((i) => i.key), ['site_twice']);
  const meta = pixelReport({ pixels: [PIX], events: ALL, checks: [{ key: 'domain', title: 'Verify your domain', description: 'd', result: 'failed' }], orders: 10, now: NOW });
  assert.equal(meta.issues[0].level, 'bad'); assert.equal(meta.issues[0].title, 'Verify your domain');
});

test('pixel: the chat text names the pixel, the events and each issue with its fix', () => {
  const r = pixelReport({ pixels: [PIX], events: { PageView: 5 }, orders: 0, now: NOW });
  const t = pixelText({ data: r, checked_at: NOW });
  assert.match(t, /pixel: 1234567890 \(Ibtekr\)/); assert.match(t, /PageView 5/); assert.match(t, /\[bad\] حدث Purchase مش واصل .* fix: /);
  assert.equal(pixelText(null), '');
});
