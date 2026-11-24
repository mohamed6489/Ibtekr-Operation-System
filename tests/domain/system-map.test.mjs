// «عقل السيستم» (Safwat 24 Nov): the groups' states from the system's own reads, the pauses, the site's plugins, today's events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../../app/js/pages/system-map-domain.js');
const M = globalThis.IbtekrSysMap;
const NOW = Date.parse('2026-11-24T12:00:00Z');
const by = (sys, id) => sys.find((s) => s.id === id);

test('nothing linked: every group says so; the server and the tools are on; the code is watched from GitHub', () => {
  const sys = M.systemsOf({ now: NOW });
  assert.equal(sys.length, 11);
  assert.equal(by(sys, 'site').state, 'unlinked'); assert.equal(by(sys, 'text').state, 'unlinked'); assert.equal(by(sys, 'mail').state, 'unlinked');
  assert.equal(by(sys, 'core').state, 'on'); assert.equal(by(sys, 'tools').state, 'on'); assert.equal(by(sys, 'code').state, 'idle');
  assert.match(M.coreLine(sys), /مش مربوطين/);
});
test('a linked key is on, a failed test is a problem, a pause in force is paused (an old one is not)', () => {
  const links = { resend: { ready: true }, bosta: { ready: true, test: { ok: false, error: 'unauthorized' } }, anthropic: { source: 'server' } };
  const sys = M.systemsOf({ now: NOW, links, paused: { anthropic: '2026-11-25T12:00:00Z', resend: '2026-11-20T00:00:00Z' } });
  assert.equal(by(sys, 'mail').state, 'on', 'a pause that ended is gone');
  assert.equal(by(sys, 'ship').state, 'err');
  assert.equal(by(sys, 'text').state, 'paused'); assert.match(by(sys, 'text').pausedTill, /لحد/);
});
test('the images: the provider a tool uses is not linked → a problem that names the tool; the bridge counts as Magnific', () => {
  const sys = M.systemsOf({ now: NOW, links: { magnific_api: { ready: true } }, providers: { image: { default: 'openai', tools: { studio: 'magnific' } } } });
  const im = by(sys, 'image'); assert.equal(im.state, 'err'); assert.match(im.err, /الكامبين \(OpenAI gpt-image\)/); assert.doesNotMatch(im.err, /الاستوديو/);
  const ok = by(M.systemsOf({ now: NOW, bridge: { linked: true }, providers: { image: { default: 'magnific' } } }), 'image'); assert.equal(ok.state, 'on');
});
test('the site: the plugins\' versions from the developer\'s check, an update shown, a plugin the system does not use added as idle; three failed syncs = a problem', () => {
  const wp = { at: '2026-11-24T06:00:00Z', core: { version: '6.8', latest: '6.9', update: true }, woo: { version: '10.3' }, theme: { name: 'WoodMart', version: '8.2' },
    plugins: [{ name: 'Dokan Lite', version: '4.0', active: true }, { name: 'Rank Math SEO', version: '1.0.250', latest: '1.0.251', update: true, active: true }, { name: 'Hello Dolly', version: '1.7', active: true }] };
  const site = by(M.systemsOf({ now: NOW, links: { woo: { ready: true } }, wp, syncErrors: 3 }), 'site');
  assert.equal(site.state, 'err'); assert.match(site.err, /3 مرات/);
  const p = (n) => site.parts.find((x) => x.name === n);
  assert.equal(p('WordPress').ver, '6.8'); assert.equal(p('WordPress').upd, '6.9'); assert.equal(p('WooCommerce').ver, '10.3'); assert.equal(p('Dokan').ver, '4.0');
  assert.equal(p('Rank Math SEO').upd, '1.0.251'); assert.equal(p('WoodMart').ver, '8.2'); assert.equal(p('Hello Dolly').state, 'idle');
});
test('Meta and the ads from the channels and the accounts; today\'s events counted per group', () => {
  const sys = M.systemsOf({ now: NOW, channels: [{ id: 'messenger', status: 'connected' }, { id: 'instagram', status: 'connected' }, { id: 'wa1', status: 'connected' }],
    ads: { meta: { linked: true, error: 'graph_1' }, tiktok: null, google: null },
    events: [{ action: 'order.status' }, { action: 'suborder.status' }, { action: 'cs.reply' }, { action: 'product.ai.image' }, { action: 'auth.login' }] });
  assert.equal(by(sys, 'meta').state, 'on'); assert.equal(by(sys, 'ads').state, 'err'); assert.match(by(sys, 'ads').err, /graph_1/);
  assert.equal(by(sys, 'site').today, 2); assert.equal(by(sys, 'meta').today, 1); assert.equal(by(sys, 'image').today, 1); assert.equal(by(sys, 'core').today, 1);
  assert.deepEqual(M.eventOf('order.status'), { sys: 'site', text: 'حالة أوردر اتغيّرت', out: false });
  assert.equal(M.eventOf('share.email').sys, 'mail');
});
