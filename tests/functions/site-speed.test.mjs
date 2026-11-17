// ش45 decision 1 — «أداء الموقع» for the developer: the linked site's pages, the PageSpeed address, an answer → numbers, the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPPS_MAX, psiUrl, speedLine, speedOf, speedPages, speedReport } from '../../supabase/functions/_shared/site-speed.js';

test('ش45: the pages are the linked site\'s own — home, the product on the same host, /shop/; https only', () => {
  assert.deepEqual(speedPages('https://staging.ibtekr.club/wp', 'https://staging.ibtekr.club/product/vase/?x=1'), [
    { kind: 'home', url: 'https://staging.ibtekr.club/' }, { kind: 'product', url: 'https://staging.ibtekr.club/product/vase/' }, { kind: 'shop', url: 'https://staging.ibtekr.club/shop/' }]);
  assert.deepEqual(speedPages('https://ibtekr.club', 'https://evil.example/product/x').map((p) => p.kind), ['home', 'shop']);
  assert.deepEqual(speedPages('https://ibtekr.club', 'http://ibtekr.club/product/x').map((p) => p.kind), ['home', 'shop']);
  assert.deepEqual(speedPages('http://ibtekr.club', null), []);
  assert.deepEqual(speedPages('__unset', null), []);
  assert.deepEqual(speedPages('https://u:p@ibtekr.club', null), []);
});

test('ش45: the PageSpeed address — performance only, the key only when there is one', () => {
  const u = new URL(psiUrl('https://ibtekr.club/', 'mobile', ''));
  assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  assert.equal(u.searchParams.get('url'), 'https://ibtekr.club/');
  assert.equal(u.searchParams.get('strategy'), 'mobile');
  assert.equal(u.searchParams.get('category'), 'performance');
  assert.equal(u.searchParams.has('key'), false);
  assert.equal(new URL(psiUrl('https://ibtekr.club/', 'desktop', 'k1')).searchParams.get('key'), 'k1');
});

const answer = {
  lighthouseResult: { categories: { performance: { score: 0.47 } }, audits: {
    'largest-contentful-paint': { numericValue: 5234.6 }, 'cumulative-layout-shift': { numericValue: 0.10423 }, 'total-blocking-time': { numericValue: 812.2 },
    'first-contentful-paint': { numericValue: 2100 }, 'speed-index': { numericValue: 4300 }, 'total-byte-weight': { numericValue: 3456789 },
    'render-blocking-resources': { title: 'Eliminate render-blocking resources', score: 0.2, details: { type: 'opportunity', overallSavingsMs: 1200 } },
    'unused-javascript': { title: 'Reduce unused [JavaScript](https://x.y)', score: 0.3, details: { type: 'opportunity', overallSavingsMs: 900 } },
    'modern-image-formats': { title: 'Serve images in <b>next-gen</b> formats', score: 0.5, details: { type: 'opportunity' }, metricSavings: { LCP: 450, FCP: 0 } },
    'tiny': { title: 'Tiny', score: 0.5, details: { type: 'opportunity', overallSavingsMs: 40 } },
    'passed': { title: 'Passed one', score: 1, details: { type: 'opportunity', overallSavingsMs: 5000 } },
  } },
  loadingExperience: { overall_category: 'SLOW', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 310 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 } } },
};

test('ش45: an answer → the score, the lab numbers, the real users\' numbers and the biggest fixes (titles cleaned)', () => {
  const s = speedOf(answer);
  assert.equal(s.score, 47);
  assert.deepEqual(s.lab, { lcp: 5235, cls: 0.104, tbt: 812, fcp: 2100, si: 4300, bytes: 3456789 });
  assert.deepEqual(s.field, { lcp: 4100, inp: 310, cls: 0.12, rating: 'poor' });
  assert.deepEqual(s.opps, [{ title: 'Eliminate render-blocking resources', ms: 1200 }, { title: 'Reduce unused JavaScript', ms: 900 }, { title: 'Serve images in next-gen formats', ms: 450 }]);
  assert.equal(speedOf({}), null);
  assert.equal(speedOf({ lighthouseResult: { categories: {} } }), null);
  assert.equal(speedOf({ lighthouseResult: { categories: { performance: { score: 0.9 } } } }).field, null);
  const many = { lighthouseResult: { categories: { performance: { score: 0.5 } }, audits: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['a' + i, { title: 'Fix ' + i, score: 0, details: { overallSavingsMs: 200 + i } }])) } };
  assert.equal(speedOf(many).opps.length, OPPS_MAX);
});

test('ش45: the report keeps each page by device, the lowest mobile score and the failures as codes', () => {
  const r = speedReport([
    { kind: 'home', url: 'https://ibtekr.club/', strategy: 'mobile', body: answer },
    { kind: 'home', url: 'https://ibtekr.club/', strategy: 'desktop', body: { lighthouseResult: { categories: { performance: { score: 0.88 } } } } },
    { kind: 'shop', url: 'https://ibtekr.club/shop/', strategy: 'mobile', body: null, error: 'http_429' },
    { kind: 'shop', url: 'https://ibtekr.club/shop/', strategy: 'desktop', body: { lighthouseResult: { categories: { performance: { score: 0.7 } } } } },
    { kind: 'evil', url: 'https://x/', strategy: 'mobile', body: answer },
  ]);
  assert.deepEqual(r.pages.map((p) => [p.kind, p.path]), [['home', '/'], ['shop', '/shop/']]);
  assert.equal(r.pages[0].mobile.score, 47); assert.equal(r.pages[0].desktop.score, 88);
  assert.deepEqual(r.pages[1].mobile, { error: 'http_429' });
  assert.equal(r.score, 47); assert.equal(r.ok, 3);
  assert.equal(speedReport([]).score, null);
  const line = speedLine(r);
  assert.match(line, /الصفحة الرئيسية \(\/\): mobile 47\/100 LCP 5\.2s TBT 812ms CLS 0\.104 · desktop 88\/100/);
  assert.match(line, /fixes: Eliminate render-blocking resources \(1\.2s\)/);
  assert.match(line, /صفحة المتجر \(\/shop\/\): mobile no answer/);
  assert.equal(speedLine(null), '');
});

test('ش45: the developer\'s <site_status> — the speed and the updates waiting, or «never checked»; it goes before the dev\'s question only', async () => {
  const { siteBlock, agentRequest } = await import('../../supabase/functions/_shared/marketing.js');
  const rows = [{ kind: 'pagespeed', checked_at: '2026-11-17T05:41:10Z', data: speedReport([{ kind: 'home', url: 'https://ibtekr.club/', strategy: 'mobile', body: answer }]) },
    { kind: 'wp_updates', checked_at: '2026-11-16T09:00:00Z', data: { core: { version: '6.7.2', latest: '6.8.3', update: true }, woo: { version: '9.8.1' }, php: '8.2.20', updates: 2,
      plugins: [{ name: 'Dokan Pro', version: '4.0.2', latest: '4.0.5', update: true }, { name: 'WooCommerce', version: '9.8.1', update: false }] } }];
  const b = siteBlock(rows);
  assert.match(b, /^<site_status>\n/); assert.match(b, /<\/site_status>$/);
  assert.match(b, /PageSpeed \(checked 2026-11-17 05:41 UTC\):\nالصفحة الرئيسية \(\/\): mobile 47\/100/);
  assert.match(b, /WordPress 6\.7\.2 → 6\.8\.3 · WooCommerce 9\.8\.1 · PHP 8\.2\.20 · waiting: 2 \(Dokan Pro 4\.0\.2 → 4\.0\.5\)/);
  assert.equal(siteBlock([]), '<site_status>\nPageSpeed: never checked\nWordPress updates: never checked\n</site_status>');
  const dev = agentRequest({ agent: 'dev', question: 'الموقع بطيء؟' }, { model: 'm', effort: 'low', history: [], cfg: {}, site: rows });
  const q = dev.messages[dev.messages.length - 1].content[0].text;
  assert.match(q, /^<site_status>[\s\S]*<\/site_status>\n\nالموقع بطيء؟$/);
  assert.match(dev.system[0].text, /<site_status>/);
  const des = agentRequest({ agent: 'designer', question: 'بوست' }, { model: 'm', effort: 'low', history: [], cfg: {}, site: rows });
  assert.equal(des.messages[des.messages.length - 1].content[0].text, 'بوست');
});
