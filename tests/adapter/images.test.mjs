import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// images.js (phase 5.4) against a stub IBSupabase: the ai-images bodies (generate / edit / create / probe), the answers and the
// refusals by status, the activity rows (the source, the slot or op, the model, the credits and the ids — never a prompt or a path),
// the buckets (signed URLs, downloads, the member's own deletes), «سجل الصور» from ai_runs, the image settings merged into the row
// «ai», this month's credits, the permissions.
const src = readFileSync(new URL('../../app/js/adapter/images.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const ME = '00000000-0000-4000-8000-0000000000b2';
const fail = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });
function load({ responses = {}, perms = { 'products.add': 'F' }, admin = false, globals = {} } = {}) {
  const stub = stubClient({ responses });
  const logs = []; const events = [];
  const window = { IBSupabase: { client: stub.client }, IBDirectory: { perm: (k) => (admin ? 'F' : perms[k] || 'N'), me: () => ({ id: ME, role_id: admin ? 'admin' : 'ops', status: 'active' }) },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } } };
  const document = { dispatchEvent: (e) => events.push(e.detail) };
  // no Image / canvas / URL here unless a case brings a fake browser (globals) — so the WebP step stays out of the other cases
  runInNewContext(src, { window, document, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }, Promise, Date, Number, String, Array, Object, JSON, Error, Intl, Math, Map, Uint8Array, ...globals });
  return { I: window.IBImages, stub, logs, events };
}
// a fake browser for the WebP step: a canvas whose toBlob writes `type` (image/webp — or image/png, Safari's way), an Image that loads
const browser = (type) => {
  const made = [];
  return { made, globals: {
    document: { dispatchEvent() {}, createElement: (tag) => { assert.equal(tag, 'canvas'); return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (cb, t, q) => { made.push([t, q]); cb({ type, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }); } }; } },
    Image: class { set src(v) { this.naturalWidth = 4; this.naturalHeight = 4; Promise.resolve().then(() => this.onload && this.onload()); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  } };
};
const OK = (extra) => ({ data: { result: 'ok', bucket: 'studio', path: SB + '/gen-0-0-abc.webp', paths: [SB + '/gen-0-0-abc.webp'], credits: 75, model: 'seedream-5-pro', run_id: 7, ...extra }, error: null });

test('generate: a slot (a number or a color) of a batch item, the model and size when given; the answer; logged with the slot, the model and the credits only', async () => {
  const { I, stub, logs } = load({ responses: { 'fn:ai-images': OK() } });
  const r = await I.generate(SB, 0, 0);
  assert.deepEqual(plain(r), { ok: true, result: 'ok', bucket: 'studio', path: SB + '/gen-0-0-abc.webp', paths: [SB + '/gen-0-0-abc.webp'], credits: 75, model: 'seedream-5-pro', runId: 7 });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args, ['ai-images', { body: { action: 'generate', batch_id: SB, index: 0, slot: 0 } }]);
  await I.generate(SB, 2, { color: 'bk' }, { model: 'seedream-5-lite', size: 'custom', width: '900', height: 1200 });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'generate', batch_id: SB, index: 2, slot: 'color:BK', model: 'seedream-5-lite', size: 'custom', width: 900, height: 1200 });
  assert.deepEqual(plain(logs), [['product.ai.image', 'studio · #1 · slot 1 · seedream-5-pro · 75 credits', { entity: 'studio_batches', entity_id: SB }],
    ['product.ai.image', 'studio · #3 · color BK · seedream-5-pro · 75 credits', { entity: 'studio_batches', entity_id: SB }]]);
  assert.ok(!JSON.stringify(logs).includes('gen-0-0'), 'no path in the activity');
});

test('edit: a studio image (its batch, index and path) or a site product (product_id); the op, the words and the options; a refusal logged as such', async () => {
  const { I, stub, logs } = load({ responses: { 'fn:ai-images': OK({ bucket: 'studio', path: SB + '/edit-0-x.webp', paths: [SB + '/edit-0-x.webp'], credits: 40 }) } });
  const r = await I.edit({ batchId: SB, index: 0, path: SB + '/gen-0-0-abc.webp' }, 'instruction', { prompt: 'lighter background' });
  assert.deepEqual([r.ok, r.bucket, r.path, r.credits], [true, 'studio', SB + '/edit-0-x.webp', 40]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'edit', op: 'instruction', prompt: 'lighter background', batch_id: SB, index: 0, path: SB + '/gen-0-0-abc.webp' });
  stub.responses['fn:ai-images'] = { data: { result: 'refused', model: 'seedream-5-pro', credits: 0, run_id: 8 }, error: null };
  const r2 = await I.edit({ productId: '4001' }, 'remove_bg', { options: { bg: 'white' }, model: 'gpt-image-2' });
  assert.deepEqual(plain(r2), { ok: true, result: 'refused', bucket: null, path: null, paths: [], credits: 0, model: 'seedream-5-pro', runId: 8 });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'edit', op: 'remove_bg', model: 'gpt-image-2', options: { bg: 'white' }, product_id: 4001 });
  assert.deepEqual(plain(logs), [['product.ai.image', 'edit · #1 · instruction · seedream-5-pro · 40 credits', { entity: 'studio_batches', entity_id: SB }],
    ['product.ai.image', 'edit · #4001 · remove_bg · seedream-5-pro · refused', { entity: 'products', entity_id: '4001' }]]);
  assert.ok(!JSON.stringify(logs).includes('lighter'), 'no prompt in the activity');
});

test('create (the tool): text or a photo (its preview stays in the page) or a product; count, size and model; the paths; logged with the count', async () => {
  const paths = [ME + '/abc-1.webp', ME + '/abc-2.webp'];
  const { I, stub, logs } = load({ perms: { 'products.edit': 'F' }, responses: { 'fn:ai-images': OK({ bucket: 'ai-images', path: paths[0], paths, credits: 100, model: 'seedream-5-lite' }) } });
  const r = await I.create({ source: 'text', prompt: 'a macrame bag', shape: 'home', size: '1080x1350', count: 2, model: 'seedream-5-lite' });
  assert.deepEqual([r.ok, r.bucket, r.paths, r.credits], [true, 'ai-images', paths, 100]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'create', source: 'text', shape: 'home', prompt: 'a macrame bag', count: 2, model: 'seedream-5-lite', size: '1080x1350' });
  await I.create({ source: 'image', shape: 'studio', image: { media_type: 'image/jpeg', data: 'QUJD', preview: 'data:image/jpeg;base64,QUJD' } });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'create', source: 'image', shape: 'studio', count: 1, image: { media_type: 'image/jpeg', data: 'QUJD' } });
  await I.create({ source: 'image', shape: 'detail', productId: 4001 });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'create', source: 'image', shape: 'detail', count: 1, product_id: 4001 });
  assert.deepEqual(plain(logs[0]), ['product.ai.image', 'tool · text · home · 2 images · seedream-5-lite · 100 credits', { entity: 'products', entity_id: null }]);
  assert.deepEqual(plain(logs[2]), ['product.ai.image', 'tool · image · detail · 2 images · seedream-5-lite · #4001 · 100 credits', { entity: 'products', entity_id: '4001' }]);
  assert.ok(!JSON.stringify(logs).includes('macrame') && !JSON.stringify(logs).includes('QUJD'), 'no prompt or image in the activity');
});

test('WebP (decision 7): a result that is not .webp is downloaded, re-encoded by the canvas (image/webp, 0.85) and handed back as action webp with the run id; the answer carries the new name; a .webp result is left alone; a browser that writes PNG keeps the original', async () => {
  const fn = ({ body }) => (body.action === 'webp' ? { data: { result: 'ok', bucket: body.bucket, path: body.path.replace(/\.png$/, '.webp') }, error: null }
    : { data: { result: 'ok', bucket: 'ai-images', path: ME + '/x-1.png', paths: [ME + '/x-1.png', ME + '/x-2.webp'], credits: 100, model: 'seedream-5-lite', run_id: 9 }, error: null });
  const chrome = browser('image/webp');
  const { I, stub, logs } = load({ globals: chrome.globals, responses: { 'fn:ai-images': fn, 'storage:ai-images:download': { data: { size: 3, type: 'image/png', arrayBuffer: async () => new Uint8Array([9]).buffer }, error: null } } });
  const r = await I.create({ source: 'text', prompt: 'a bag', shape: 'home', count: 2 });
  assert.deepEqual([r.ok, r.path, r.paths], [true, ME + '/x-1.webp', [ME + '/x-1.webp', ME + '/x-2.webp']]);
  const bodies = stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args[1].body);
  assert.deepEqual(bodies.map((b) => b.action), ['create', 'webp'], 'one webp call: the .webp result needs none');
  assert.deepEqual(bodies[1], { action: 'webp', bucket: 'ai-images', path: ME + '/x-1.png', run_id: 9, image: { data: 'AQID' } });
  assert.deepEqual(opsOf(stub.calls, 'storage:ai-images'), [{ op: 'download', args: [ME + '/x-1.png'] }]);
  assert.deepEqual(chrome.made, [['image/webp', 0.85]]);
  assert.equal(logs.length, 1, 'the conversion is not an activity row');
  // Safari: the canvas answers PNG → nothing sent, the provider's file stays
  const safari = browser('image/png');
  const s = load({ globals: safari.globals, responses: { 'fn:ai-images': fn, 'storage:ai-images:download': { data: { size: 3, type: 'image/png', arrayBuffer: async () => new Uint8Array([9]).buffer }, error: null } } });
  const r2 = await s.I.create({ source: 'text', prompt: 'a bag', shape: 'home', count: 2 });
  assert.deepEqual([r2.paths, s.stub.calls.filter((c) => c.op === 'invoke').length], [[ME + '/x-1.png', ME + '/x-2.webp'], 1]);
  // the server refusing the WebP (or a download failing) keeps the original too
  const refused = load({ globals: browser('image/webp').globals, responses: { 'fn:ai-images': (opts) => (opts.body.action === 'webp' ? fail(401, {}) : fn(opts)), 'storage:ai-images:download': { data: { size: 3, type: 'image/png', arrayBuffer: async () => new Uint8Array([9]).buffer }, error: null } } });
  assert.deepEqual((await refused.I.create({ source: 'text', prompt: 'a bag', shape: 'home' })).paths, [ME + '/x-1.png', ME + '/x-2.webp']);
});

test('the refusals by status: forbidden, invalid (+ field), missing, ai_cap, busy, not_configured, ai_error, network — nothing logged', async () => {
  const cases = [[401, {}, 'forbidden'], [400, { error: 'bad_request', field: 'slot' }, 'invalid'], [404, {}, 'missing'], [402, { error: 'ai_cap' }, 'ai_cap'],
    [429, { error: 'busy' }, 'busy'], [503, { error: 'not_configured' }, 'not_configured'], [502, { error: 'ai_error' }, 'ai_error'], [500, {}, 'network']];
  for (const [status, body, reason] of cases) {
    const { I, logs } = load({ responses: { 'fn:ai-images': fail(status, body) } });
    const r = await I.generate(SB, 0, 1);
    assert.deepEqual([r.ok, r.reason], [false, reason], String(status));
    assert.equal(logs.length, 0);
    if (status === 400) assert.equal(r.field, 'slot');
  }
  assert.equal((await load().I.create({ source: 'text', prompt: 'x', shape: 'studio' })).reason, 'network');
});

test('probe (the admin): the provider, the shape and the models as the server sent them', async () => {
  const { I } = load({ admin: true, responses: { 'fn:ai-images': { data: { result: 'ok', provider: 'magnific', shape: { credits: 'number' }, models: ['seedream-5-pro'] }, error: null } } });
  assert.deepEqual(plain(await I.probe()), { ok: true, provider: 'magnific', shape: { credits: 'number' }, models: ['seedream-5-pro'] });
});

test('the buckets: a signed URL cached and announced (ib:images), a download, and remove of the member\'s own paths in ai-images only', async () => {
  const { I, stub, events } = load({ responses: { 'storage:studio:createSignedUrl': { data: { signedUrl: 'https://x.supabase.co/sign/a?token=t' }, error: null },
    'storage:ai-images:download': { data: { size: 3, type: 'image/webp' }, error: null }, 'storage:ai-images:remove': { data: [], error: null } } });
  assert.equal(I.imageUrl('studio', SB + '/a.webp'), null, 'null while it loads');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(I.imageUrl('studio', SB + '/a.webp'), 'https://x.supabase.co/sign/a?token=t');
  assert.deepEqual(opsOf(stub.calls, 'storage:studio'), [{ op: 'createSignedUrl', args: [SB + '/a.webp', 3600] }], 'one request for two reads');
  assert.deepEqual(plain(events), [{ url: SB + '/a.webp', bucket: 'studio' }]);
  const d = await I.download('ai-images', ME + '/abc-1.webp');
  assert.deepEqual([d.ok, d.blob.size], [true, 3]);
  assert.deepEqual(plain(await I.remove([ME + '/abc-1.webp', 'other/x.webp'])), { ok: true });
  assert.deepEqual(opsOf(stub.calls, 'storage:ai-images').filter((x) => x.op === 'remove'), [{ op: 'remove', args: [[ME + '/abc-1.webp']] }], 'another member\'s path is never sent');
  assert.deepEqual(plain(await I.remove(['other/x.webp'])), { ok: false, reason: 'forbidden' });
  const missing = load({ responses: { 'storage:ai-images:download': { data: null, error: { message: 'Object not found' } } } });
  assert.deepEqual(plain(await missing.I.download('ai-images', ME + '/gone.webp')), { ok: false, reason: 'missing' });
});

test('history: the good image runs from ai_runs, newest first (named columns, no select *), with their bucket and paths', async () => {
  const row = { id: 3, created_at: '2026-10-31T10:00:00Z', created_by: ME, source: 'tool', label: 'Mug', product_id: null, batch_id: null, item_index: null, model: 'seedream-5-pro', credits: 150, cost_usd: '0.300000', output: { bucket: 'ai-images', paths: [ME + '/a-1.webp', ME + '/a-2.webp'] } };
  const { I, stub } = load({ responses: { ai_runs: { data: [row, { ...row, id: 2, source: 'studio', batch_id: SB, item_index: 1, output: null }], error: null } } });
  const r = await I.history(10);
  assert.deepEqual(plain(r.rows[0]), { id: 3, at: '2026-10-31T10:00:00Z', by: ME, source: 'tool', label: 'Mug', productId: null, batchId: null, index: null, model: 'seedream-5-pro', credits: 150, cost: 0.3, bucket: 'ai-images', paths: [ME + '/a-1.webp', ME + '/a-2.webp'] });
  assert.deepEqual(plain([r.rows[1].batchId, r.rows[1].index, r.rows[1].bucket, r.rows[1].paths]), [SB, 1, 'ai-images', []]);
  assert.deepEqual(opsOf(stub.calls, 'ai_runs').map((c) => [c.op, ...(c.args || [])]), [['select', 'id, created_at, created_by, source, label, product_id, batch_id, item_index, model, credits, cost_usd, output'],
    ['eq', 'action', 'image'], ['eq', 'status', 'ok'], ['order', 'created_at', { ascending: false }], ['limit', 10]]);
});

test('can: the studio with products.add, a site edit with products.edit, the tool with either, the settings the admin; credits and the USD estimate', () => {
  assert.deepEqual(plain(load({ perms: { 'products.add': 'F' } }).I.can()), { studio: true, edit: false, tool: true, settings: false });
  assert.deepEqual(plain(load({ perms: { 'products.edit': 'F' } }).I.can()), { studio: false, edit: true, tool: true, settings: false });
  assert.deepEqual(plain(load({ perms: { 'products.add': 'P' } }).I.can()), { studio: false, edit: false, tool: false, settings: false });
  assert.deepEqual(plain(load({ admin: true }).I.can()), { studio: true, edit: true, tool: true, settings: true });
  const { I } = load();
  assert.deepEqual([I.credits('seedream-5-pro', 1), I.credits('seedream-5-lite', 3), I.credits('unknown', 2), I.usd(75), I.DEFAULT_MODEL, I.MAX_COUNT], [75, 150, 150, 0.15, 'seedream-5-pro', 4]);
});

test('settings (decision 3): image_model / image_monthly_credits of the row «ai» with their defaults; saveSettings by the admin, merged into the row (the content keys stay), logged without secrets; estModel follows the read', async () => {
  const row = { data: { model: 'claude-sonnet-5-5', monthly_limit_usd: 20, image_model: 'gpt-image-2', image_monthly_credits: '5000' } };
  const { I, stub, logs } = load({ admin: true, responses: { settings: { data: row, error: null } } });
  assert.deepEqual(plain(await I.settings()), { ok: true, model: 'gpt-image-2', monthlyCredits: 5000, fromRow: ['image_model', 'image_monthly_credits'] });
  assert.equal(I.estModel(), 'gpt-image-2');
  assert.deepEqual(plain(await I.saveSettings({ model: 'dall-e', monthlyCredits: null })), { ok: false, reason: 'invalid', field: 'model' });
  assert.deepEqual(plain(await I.saveSettings({ model: 'seedream-5-pro', monthlyCredits: '12.5' })), { ok: false, reason: 'invalid', field: 'monthlyCredits' });
  assert.deepEqual(plain(await I.saveSettings({ model: 'seedream-5-pro', monthlyCredits: '8000' })), { ok: true });
  assert.deepEqual(opsOf(stub.calls, 'settings').filter((x) => x.op === 'upsert'), [{ op: 'upsert', args: [{ section: 'ai', data: { model: 'claude-sonnet-5-5', monthly_limit_usd: 20, image_model: 'seedream-5-pro', image_monthly_credits: 8000 } }, { onConflict: 'section' }] }]);
  assert.deepEqual(plain(logs), [['product.ai.image.settings', 'seedream-5-pro · 8000 credits', { entity: 'settings', entity_id: 'ai' }]]);
  assert.equal(I.estModel(), 'seedream-5-pro');
  assert.deepEqual(plain(await I.saveSettings({ model: 'gpt-image-2', monthlyCredits: '' })), { ok: true });
  assert.equal(opsOf(stub.calls, 'settings').filter((x) => x.op === 'upsert').at(-1).args[0].data.image_monthly_credits, null);
  const ops = load({ perms: { 'products.add': 'F' } });
  assert.deepEqual(plain(await ops.I.saveSettings({ model: 'gpt-image-2', monthlyCredits: null })), { ok: false, reason: 'forbidden' });
  assert.deepEqual(opsOf(ops.stub.calls, 'settings'), []);
  assert.deepEqual(plain(await load({ responses: { settings: { data: null, error: null } } }).I.settings()), { ok: true, model: 'seedream-5-pro', monthlyCredits: null, fromRow: [] });
});

test('monthCredits: ai_month_credits + this Cairo month\'s image runs by source (cap rows not counted)', async () => {
  const now = new Date().toISOString();
  const { I, stub } = load({ admin: true, responses: { 'rpc:ai_month_credits': { data: 225, error: null },
    ai_runs: { data: [{ source: 'studio', status: 'ok', credits: 75, created_at: now }, { source: 'tool', status: 'ok', credits: '150', created_at: now }, { source: 'tool', status: 'cap', credits: 0, created_at: now },
      { source: 'edit', status: 'ok', credits: 40, created_at: '2020-01-01T00:00:00Z' }], error: null } } });
  assert.deepEqual(plain(await I.monthCredits()), { ok: true, total: 225, usd: 0.45, runs: 2, studio: { runs: 1, credits: 75 }, tool: { runs: 1, credits: 150 }, edit: { runs: 0, credits: 0 } });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'rpc').map((c) => c.args), [['ai_month_credits', null]]);
  assert.deepEqual(opsOf(stub.calls, 'ai_runs').map((x) => x.op), ['select', 'eq', 'gte', 'limit']);
});

test('why: the two faces of not_configured and the provider\'s 402 get their own words; anything else none', () => {
  const { I } = load();
  assert.ok(I.why({ ok: false, reason: 'not_configured', configured: false }).includes('MAGNIFIC_API_KEY'));
  assert.ok(I.why({ ok: false, reason: 'not_configured', configured: true, status: 403 }).includes('(HTTP 403)'));
  assert.ok(I.why({ ok: false, reason: 'ai_error', status: 402 }).includes('402'));
  assert.equal(I.why({ ok: false, reason: 'ai_error', status: null }), '');
  assert.equal(I.why({ ok: true }), '');
});

test('decision 8 — the Magnific import queue: imports() reads the sets still to import (own rows, named columns); importRun(id) → action import, the answer with imported / failed / status, logged with the counts only; 409 → done', async () => {
  const rows = [{ id: 7, created_at: '2026-11-01T06:00:00Z', created_by: ME, source: 'magnific', folder: 'ابتكر', label: 'Cushion set', product_id: 4001, urls: ['https://pikaso.cdnpk.net/a.jpg', 'https://pikaso.cdnpk.net/b.jpg'], status: 'partial', paths: [ME + '/imp-1-1.webp', null], error: null }];
  const { I, stub, logs } = load({ responses: { image_imports: { data: rows, error: null }, 'fn:ai-images': { data: { result: 'ok', bucket: 'ai-images', path: ME + '/imp-1-1.webp', paths: [ME + '/imp-1-1.webp', ME + '/imp-1-2.webp'], credits: 0, model: '', run_id: 12, imported: 2, failed: 0, status: 'ok' }, error: null } } });
  const r = await I.imports();
  assert.deepEqual(plain(r), { ok: true, rows: [{ id: 7, at: '2026-11-01T06:00:00Z', by: ME, source: 'magnific', folder: 'ابتكر', label: 'Cushion set', productId: 4001, count: 2, done: 1, status: 'partial', error: null }] });
  assert.deepEqual(opsOf(stub.calls, 'image_imports').map((c) => [c.op, ...(c.args || [])]), [['select', 'id, created_at, created_by, source, folder, label, product_id, urls, status, paths, error'], ['in', 'status', ['pending', 'partial', 'error']], ['order', 'created_at', { ascending: false }], ['limit', 50]]);
  const out = await I.importRun(7);
  assert.deepEqual(plain(out), { ok: true, result: 'ok', bucket: 'ai-images', path: ME + '/imp-1-1.webp', paths: [ME + '/imp-1-1.webp', ME + '/imp-1-2.webp'], credits: 0, model: '', runId: 12, imported: 2, failed: 0, status: 'ok' });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'import', id: 7 });
  assert.deepEqual(plain(logs.at(-1)), ['product.ai.image', 'import · #7 · 2 images', { entity: 'image_imports', entity_id: '7' }]);
  const done = load({ responses: { 'fn:ai-images': fail(409, { error: 'done' }) } });
  assert.deepEqual([(await done.I.importRun(7)).reason, done.logs.length], ['done', 0]);
});
