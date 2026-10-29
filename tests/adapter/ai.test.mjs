import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// ai.js (phase 5.3) against a stub IBSupabase: the ai-content bodies (write / studio), the answers and the refusals by status,
// the activity rows (the source, the fields and the ids — never a text), «سجل المحتوى» from ai_runs, the permissions.
const src = readFileSync(new URL('../../app/js/adapter/ai.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const fail = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });
function load({ responses = {}, perms = { 'products.add': 'F' } } = {}) {
  const stub = stubClient({ responses });
  const logs = [];
  const window = { IBSupabase: { client: stub.client }, IBDirectory: { perm: (k) => perms[k] || 'N' },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } } };
  runInNewContext(src, { window, document: {}, Promise, Date, Number, String, Array, Object, JSON, Error });
  return { A: window.IBAI, stub, logs };
}
const REQ = { source: 'data', outputs: ['name', 'short'], langs: ['ar', 'en'], tone: 'luxury', data: { name: 'Bamboo Mirror', brand: 'Alaa Anas' } };

test('write: the ai-content body, the answer, logged with the source and fields only', async () => {
  const { A, stub, logs } = load({ responses: { 'fn:ai-content': () => ({ data: { result: 'ok', out: { ar: { name: 'مراية' } }, missing: ['en.name'], model: 'claude-opus-5-5', cost_usd: 0.052, run_id: 7 }, error: null }) } });
  const r = await A.write(REQ);
  assert.deepEqual(plain(r), { ok: true, result: 'ok', missing: ['en.name'], model: 'claude-opus-5-5', cost: 0.052, runId: 7, out: { ar: { name: 'مراية' } } });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args, ['ai-content', { body: { action: 'write', source: 'data', outputs: ['name', 'short'], langs: ['ar', 'en'], tone: 'luxury', data: REQ.data } }]);
  assert.deepEqual(plain(logs), [['product.ai.write', 'data · name, short · ar, en', { entity: 'products', entity_id: null }]]);
  assert.ok(!JSON.stringify(logs).includes('مراية') && !JSON.stringify(logs).includes('Bamboo'), 'no text in the activity');
});

test('write from a product or a photo: product_id, current texts and the photo go; the tone warm by default', async () => {
  const { A, stub, logs } = load({ responses: { 'fn:ai-content': { data: { result: 'refused', model: 'claude-opus-5-5', cost_usd: 0.004 }, error: null } } });
  const r = await A.write({ source: 'product', outputs: ['long'], langs: ['en'], productId: '4001', current: { shortEn: 'Soft' } });
  assert.deepEqual([r.ok, r.result, r.cost], [true, 'refused', 0.004]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'write', source: 'product', outputs: ['long'], langs: ['en'], tone: 'warm', current: { shortEn: 'Soft' }, product_id: 4001 });
  assert.deepEqual(plain(logs.at(-1)), ['product.ai.write', 'product · long · en · #4001 · refused', { entity: 'products', entity_id: '4001' }]);
  await A.write({ source: 'image', outputs: ['short'], langs: ['ar'], image: { media_type: 'image/jpeg', data: 'QUJD', preview: 'data:image/jpeg;base64,QUJD' } });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body.image, { media_type: 'image/jpeg', data: 'QUJD' }, 'the preview stays in the page');
});

test('the refusals by status: forbidden, invalid (+ field), missing, ai_cap, busy, not_configured, ai_error, network', async () => {
  const cases = [[401, {}, 'forbidden'], [400, { error: 'bad_request', field: 'data.name' }, 'invalid'], [404, {}, 'missing'], [402, { error: 'ai_cap' }, 'ai_cap'],
    [429, { error: 'busy' }, 'busy'], [503, { error: 'not_configured' }, 'not_configured'], [502, { error: 'ai_error' }, 'ai_error'], [500, {}, 'network']];
  for (const [status, body, reason] of cases) {
    const { A, logs } = load({ responses: { 'fn:ai-content': fail(status, body) } });
    const r = await A.write(REQ);
    assert.deepEqual([r.ok, r.reason], [false, reason], String(status));
    assert.equal(logs.length, 0, 'nothing logged without an answer');
    if (status === 400) assert.equal(r.field, 'data.name');
  }
  const none = load(); // no answer from the function at all
  assert.equal((await none.A.write(REQ)).reason, 'network');
});

test('studio: one batch item by its index and what to fill → the fields; logged on the batch', async () => {
  const { A, stub, logs } = load({ responses: { 'fn:ai-content': { data: { result: 'ok', fields: { nameAr: 'أباجورة', categories: [11] }, missing: [], model: 'claude-opus-5-5', cost_usd: 0.03, run_id: 9 }, error: null } } });
  const r = await A.studio(SB, 2, ['nameAr', 'category']);
  assert.deepEqual(plain(r), { ok: true, result: 'ok', missing: [], model: 'claude-opus-5-5', cost: 0.03, runId: 9, fields: { nameAr: 'أباجورة', categories: [11] } });
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args, ['ai-content', { body: { action: 'studio', batch_id: SB, index: 2, want: ['nameAr', 'category'] } }]);
  assert.deepEqual(plain(logs), [['product.ai.studio', '#3 · nameAr, category', { entity: 'studio_batches', entity_id: SB }]]);
});

test('history: the content tool\'s good runs from ai_runs, newest first (named columns, no select *)', async () => {
  const row = { id: 3, created_at: '2026-10-29T10:00:00Z', source: 'product', label: 'Boho Cushion', product_id: 4001, model: 'claude-opus-5-5', cost_usd: '0.052000', output: { out: { en: { name: 'Boho Cushion' } }, missing: [] } };
  const { A, stub } = load({ responses: { ai_runs: { data: [row], error: null } } });
  const r = await A.history();
  assert.deepEqual(plain(r), { ok: true, rows: [{ id: 3, at: '2026-10-29T10:00:00Z', source: 'product', label: 'Boho Cushion', productId: 4001, model: 'claude-opus-5-5', cost: 0.052, out: { en: { name: 'Boho Cushion' } } }] });
  const ops = opsOf(stub.calls, 'ai_runs').map((c) => [c.op, ...(c.args || [])]);
  assert.deepEqual(ops, [['select', 'id, created_at, source, label, product_id, model, cost_usd, output'], ['eq', 'action', 'write'], ['eq', 'status', 'ok'], ['order', 'created_at', { ascending: false }], ['limit', 20]]);
  const down = load({ responses: { ai_runs: { data: null, error: { code: '500' } } } });
  assert.deepEqual(plain(await down.A.history()), { ok: false, reason: 'network' });
});

test('can: the tool with products.add or products.edit = F, the studio with products.add, saving with products.edit', () => {
  assert.deepEqual(plain(load({ perms: { 'products.add': 'F' } }).A.can()), { write: true, studio: true, save: false });
  assert.deepEqual(plain(load({ perms: { 'products.edit': 'F' } }).A.can()), { write: true, studio: false, save: true });
  assert.deepEqual(plain(load({ perms: { 'products.add': 'P', 'products.edit': 'P', 'products.view': 'F' } }).A.can()), { write: false, studio: false, save: false });
});
