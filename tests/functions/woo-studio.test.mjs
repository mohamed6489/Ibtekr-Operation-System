import { test } from 'node:test'; import assert from 'node:assert/strict';
import { buildStudio, studioSku, brandCode, sheetCsvUrl, fetchSheetCsv } from '../../supabase/functions/_shared/woo-studio.js';
import { loadUmd } from '../helpers/load-umd.mjs';
// The product studio's upload payloads (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md decisions 2 / 5 / 7):
// the SKU rule (the same as the page's), the product / variations / translation built from a batch item, and the refusals.
const PD = loadUmd(new URL('../../app/js/pages/products-domain.js', import.meta.url));
const B = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const O = { batchId: B, type: 'Simple', brand: 'Art Craft', colors: { BE: 'Beige', BK: 'Black' }, attrs: { color: 12, size: 3, material: 15, style: 14, brand: 13 } };
const simple = { nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', serial: 999, colors: ['BE'], sizes: ['50×50'], material: 'Cotton', style: 'Bohemian', weight: '0.4', stock: 5,
  sale: 1200, regular: 1500, shortDesc: '<p>Soft</p>', shortDescAr: '<p>ناعمة</p>', categories: [20], images: [B + '/1-1.webp', B + '/1-2.webp'] };

test('studioSku on the server is the page\'s rule (decision 2)', () => {
  for (const o of [{ brand: 'Art Craft', color: 'BE', serial: 999 }, { brand: 'Art Craft', serial: 1000 }, { brand: 'Bian eg', color: 'OW', serial: 12345, size: '40×40' }, { brand: 'w&r', color: 'BK', serial: 7, size: '٥٠×٥٠' }]) {
    assert.equal(studioSku(o), PD.studioSku(o).sku, JSON.stringify(o));
  }
  assert.equal(studioSku({ brand: 'إبتكر', serial: 1 }), null);
  assert.equal(brandCode('Art Craft'), 'AR');
});

test('buildStudio Simple: a draft English product with the SKU, prices, stock, attributes (color / size / material / style / brand as information), categories; the Arabic fields apart', () => {
  const r = buildStudio(simple, O);
  assert.equal(r.sku, 'IBTARBE0999');
  assert.deepEqual(r.product, { name: 'Boho Cushion', short_description: '<p>Soft</p>', weight: '0.4', categories: [{ id: 20 }], type: 'simple', status: 'draft', wpml_language: 'en', sku: 'IBTARBE0999',
    regular_price: '1500', sale_price: '1200', manage_stock: true, stock_quantity: 5,
    attributes: [{ id: 12, visible: true, variation: false, options: ['Beige'] }, { id: 3, visible: true, variation: false, options: ['50×50'] }, { id: 15, visible: true, variation: false, options: ['Cotton'] },
      { id: 14, visible: true, variation: false, options: ['Bohemian'] }, { id: 13, visible: true, variation: false, options: ['Art Craft'] }] });
  assert.deepEqual(r.images, simple.images);
  assert.deepEqual(r.ar, { name: 'مخدة بوهيمي', short_description: '<p>ناعمة</p>' });
  assert.deepEqual(r.variations, []);
  assert.deepEqual(buildStudio({ ...simple, onDemand: true, stock: null }, O).product.stock_status, 'onbackorder');
});

test('buildStudio Variable: the parent without a color, a variation per color × size with its own SKU, prices, stock and image; color and size are variation attributes', () => {
  const it = { ...simple, colors: ['BE', 'BK'], sizes: ['50×50', '40×40'], variations: [
    { color: 'BE', size: '50×50', sale: 1200, regular: 1500, stock: 3, image: B + '/1-be.webp' }, { color: 'BK', size: '40×40', sale: 900, regular: 1100, onDemand: true }] };
  const r = buildStudio(it, { ...O, type: 'Variable' });
  assert.equal(r.sku, 'IBTAR0999');
  assert.equal(r.product.type, 'variable');
  assert.equal(r.product.regular_price, undefined);
  assert.deepEqual(r.product.attributes.slice(0, 2), [{ id: 12, visible: true, variation: true, options: ['Beige', 'Black'] }, { id: 3, visible: true, variation: true, options: ['50×50', '40×40'] }]);
  assert.deepEqual(r.variations.map((v) => v.sku), ['IBTARBE0999-5050', 'IBTARBK0999-4040']);
  assert.deepEqual(r.variations[0].payload, { sku: 'IBTARBE0999-5050', regular_price: '1500', sale_price: '1200', manage_stock: true, stock_quantity: 3, attributes: [{ id: 12, option: 'Beige' }, { id: 3, option: '50×50' }] });
  assert.equal(r.variations[0].image, B + '/1-be.webp');
  assert.deepEqual(r.variations[1].payload.stock_status, 'onbackorder');
  const colorsOnly = buildStudio({ ...it, sizes: [], variations: [{ color: 'BE', sale: 100, regular: 120 }] }, { ...O, type: 'Variable' });
  assert.deepEqual(colorsOnly.variations.map((v) => v.sku), ['IBTARBE0999']);
});

test('buildStudio refuses before any call: tags or % in a name, an unknown color, a foreign image path, a sale above the regular price, two colors on a Simple product, a variation outside the dimensions or twice, a brand without two Latin letters', () => {
  const V = { ...O, type: 'Variable' };
  const cases = [
    [{ ...simple, nameEn: '<b>x</b>' }, O, 'nameEn'], [{ ...simple, nameEn: '%customfield(x)%' }, O, 'nameEn'], [{ ...simple, colors: ['ZZ'] }, O, 'colors'],
    [{ ...simple, images: ['other-batch/1.webp'] }, O, 'images'], [{ ...simple, images: [B + '/../x.webp'] }, O, 'images'], [{ ...simple, sale: 2000, regular: 1500 }, O, 'price'],
    [{ ...simple, colors: ['BE', 'BK'] }, O, 'variations'], [{ ...simple, serial: -1 }, O, 'serial'], [{ ...simple, shortDesc: '<img src=x onerror=alert(1)>' }, O, 'short_description'],
    [{ ...simple, colors: ['BE'], sizes: [], variations: [{ color: 'BK', sale: 1, regular: 2 }] }, V, 'variations'],
    [{ ...simple, colors: ['BE'], sizes: [], variations: [{ color: 'BE', sale: 1, regular: 2 }, { color: 'BE', sale: 1, regular: 2 }] }, V, 'variations'],
    [{ ...simple, colors: [], sizes: [] }, V, 'variations'], [simple, { ...O, brand: 'ب' }, 'brand'],
    // decision 15: the Arabic name is required (every product gets its translation)
    [{ ...simple, nameAr: '' }, O, 'nameAr'], [{ ...simple, nameAr: '   ' }, O, 'nameAr'], [{ ...simple, nameAr: undefined }, O, 'nameAr'], [{ ...simple, nameAr: '<b>x</b>' }, O, 'nameAr'],
  ];
  for (const [it, o, field] of cases) assert.equal(buildStudio(it, o).field, field, JSON.stringify(it).slice(0, 80));
});

// decision 13: a Google Sheets link → the CSV URL built from its id and tab only
const PUB = '2PACX-1vTq3x9Abc_def-GHIjkLMNopQRstuVWxyz0123456789';
const DOC = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
test('sheetCsvUrl: «Publish to the web» and a link shared with anyone → the CSV export of that tab; anything else → null', () => {
  const pubCsv = 'https://docs.google.com/spreadsheets/d/e/' + PUB + '/pub?output=csv';
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml'), pubCsv);
  assert.equal(sheetCsvUrl('  https://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml?gid=1234&single=true  '), pubCsv + '&gid=1234&single=true');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/' + PUB + '/pub?gid=0&single=true&output=xlsx'), pubCsv + '&gid=0&single=true');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml/sheet?headers=false&gid=77'), pubCsv + '&gid=77&single=true');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit?usp=sharing'), 'https://docs.google.com/spreadsheets/d/' + DOC + '/export?format=csv');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit#gid=1386834576'), 'https://docs.google.com/spreadsheets/d/' + DOC + '/export?format=csv&gid=1386834576');
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/' + DOC), 'https://docs.google.com/spreadsheets/d/' + DOC + '/export?format=csv');
  for (const bad of ['', null, 'not a url', 'http://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml', 'https://evil.example/spreadsheets/d/e/' + PUB + '/pubhtml',
    'https://docs.google.com.evil.example/spreadsheets/d/' + DOC + '/edit', 'https://user:pw@docs.google.com/spreadsheets/d/' + DOC + '/edit', 'https://docs.google.com:8443/spreadsheets/d/' + DOC + '/edit',
    'https://docs.google.com/document/d/' + DOC + '/edit', 'https://docs.google.com/spreadsheets/d/short/edit', 'https://docs.google.com/spreadsheets/d/e/' + PUB + '/other',
    'https://docs.google.com/spreadsheets/d/' + DOC + '%2F..%2F/edit']) assert.equal(sheetCsvUrl(bad), null, String(bad));
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/' + DOC + '/edit?gid=1;drop'), 'https://docs.google.com/spreadsheets/d/' + DOC + '/export?format=csv', 'a gid that is not digits is dropped');
});

const CSV = 'Name EN,Vendor Price\nStudio Test,500\n';
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), redirect: init && init.redirect, signal: !!(init && init.signal) }); const r = routes[String(url)]; if (!r) return new Response('nope', { status: 404 }); if (r.throw) throw r.throw; return new Response(r.text ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/csv' } }); };
  return { fetch, calls };
}
test('fetchSheetCsv: the built URL only, redirects by hand to Google hosts only, the CSV text; a sign-in, an HTML page, 404 = not published; size and network refusals', async () => {
  const pub = 'https://docs.google.com/spreadsheets/d/e/' + PUB + '/pubhtml';
  const csvUrl = 'https://docs.google.com/spreadsheets/d/e/' + PUB + '/pub?output=csv';
  const usercontent = 'https://doc-0k-3g-sheets.googleusercontent.com/pub/abc/def/123/' + PUB + '?output=csv';
  const ok = fakeFetch({ [csvUrl]: { status: 307, headers: { location: usercontent } }, [usercontent]: { text: '﻿' + CSV } });
  assert.deepEqual(await fetchSheetCsv(pub, ok.fetch), { csv: CSV });
  assert.deepEqual(ok.calls.map((c) => [c.url, c.redirect, c.signal]), [[csvUrl, 'manual', true], [usercontent, 'manual', true]]);
  const signIn = fakeFetch({ [csvUrl]: { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?continue=x' } } });
  assert.deepEqual(await fetchSheetCsv(pub, signIn.fetch), { error: 'not_published' });
  assert.equal(signIn.calls.length, 1, 'never follows a redirect outside Google sheets hosts');
  const away = fakeFetch({ [csvUrl]: { status: 307, headers: { location: 'https://evil.example/x.csv' } } });
  assert.deepEqual(await fetchSheetCsv(pub, away.fetch), { error: 'not_published' });
  assert.equal(away.calls.length, 1);
  const plain = fakeFetch({ [csvUrl]: { status: 307, headers: { location: 'http://doc-0k-3g-sheets.googleusercontent.com/x' } } });
  assert.deepEqual(await fetchSheetCsv(pub, plain.fetch), { error: 'not_published' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { text: '<!DOCTYPE html><html>sign in</html>', headers: { 'content-type': 'text/html; charset=utf-8' } } }).fetch), { error: 'not_published' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { text: '  <html>', headers: { 'content-type': 'text/plain' } } }).fetch), { error: 'not_published' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({}).fetch), { error: 'not_published' }, '404');
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { status: 500 } }).fetch), { error: 'unreachable' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { throw: new TypeError('network') } }).fetch), { error: 'unreachable' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { text: 'x'.repeat(50) } }).fetch, { maxBytes: 20 }), { error: 'too_big' });
  assert.deepEqual(await fetchSheetCsv(pub, fakeFetch({ [csvUrl]: { text: 'x', headers: { 'content-type': 'text/csv', 'content-length': '999999999' } } }).fetch), { error: 'too_big' });
  const loop = fakeFetch({ [csvUrl]: { status: 307, headers: { location: csvUrl } } });
  assert.deepEqual(await fetchSheetCsv(pub, loop.fetch), { error: 'unreachable' });
  assert.equal(loop.calls.length, 4, 'three redirects at most');
  const none = fakeFetch({});
  assert.deepEqual(await fetchSheetCsv('https://evil.example/a.csv', none.fetch), { error: 'bad_link' });
  assert.equal(none.calls.length, 0, 'a link outside docs.google.com is never fetched');
});
