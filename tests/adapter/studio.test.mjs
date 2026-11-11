import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient } from './stub-supabase.mjs';
// studio.js — B4 (the owner, 11 Nov): the categories tab's writes through woo-sync. A new category carries its square image as
// { data: base64 } (the server checks the bytes); «تعديل» sends only what changed (no undefined keys); «حذف» refused by the server
// (409) comes back as { reason: 'conflict', error, count }; the mirror (IBProducts) follows a rename / a delete; the activity rows
// carry the id, the name and the changed fields' names only — never an image.
const src = readFileSync(new URL('../../app/js/adapter/studio.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load(answer) {
  const stub = stubClient({ responses: { 'fn:woo-sync': (o) => answer(o.body) } });
  const logs = []; const mirror = [];
  const window = { IBSupabase: { client: stub.client }, IBDirectory: { perm: () => 'F' },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBProducts: { addCategory: (row) => mirror.push(['add', row]), renameCategory: (id, name) => mirror.push(['rename', id, name]), removeCategory: (id) => mirror.push(['remove', id]) } };
  runInNewContext(src, { window, document: { dispatchEvent() {} }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Error, Uint8Array, btoa });
  const bodies = () => stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args[1].body);
  return { S: window.IBStudio, bodies, logs, mirror };
}
const blob = (bytes) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer });

test('createCategory: the image as base64 of its bytes, none without one; the mirror gets the English term; logged by id and name', async () => {
  const { S, bodies, logs, mirror } = load((b) => ({ data: { action: b.action, result: 'ok', id: 80, ar_id: 81 }, error: null }));
  const r = await S.createCategory({ name_en: 'Lamps', name_ar: 'أباجورات', parent: 15, image: blob([0x52, 0x49, 0x46, 0x46]) });
  assert.deepEqual(plain(r), { ok: true, id: 80, arId: 81 });
  await S.createCategory({ name_en: 'Gifts', name_ar: 'هدايا' });
  assert.deepEqual(plain(bodies()), [{ action: 'category_create', name_en: 'Lamps', name_ar: 'أباجورات', parent: 15, image: { data: 'UklGRg==' } }, { action: 'category_create', name_en: 'Gifts', name_ar: 'هدايا', parent: 0 }]);
  assert.deepEqual(plain(mirror[0]), ['add', { id: 80, name: 'Lamps', parent_id: 15 }]);
  assert.deepEqual(plain(logs[0]), ['product.category.create', '#80 · Lamps', { entity: 'woo_categories', entity_id: '80' }]);
});

test('categoryGet: the category and its translation as the server reads them; a refused read keeps its reason', async () => {
  const cat = { id: 80, name: 'Lamps', parent: 15, count: 3, image: 'https://woo.test/l.webp' };
  const { S } = load(() => ({ data: { action: 'category_get', result: 'ok', category: cat, ar: null }, error: null }));
  assert.deepEqual(plain(await S.categoryGet(80)), { ok: true, category: cat, ar: null });
  const gone = load(() => ({ data: null, error: { context: { status: 404 } } }));
  assert.equal((await gone.S.categoryGet(80)).reason, 'missing');
});

test('categoryUpdate: only what changed goes (no empty keys), a new name follows in the mirror, the log names the fields — never the image', async () => {
  const { S, bodies, logs, mirror } = load((b) => ({ data: { action: b.action, result: 'ok', id: b.id, ar: b.name_ar ? 'ok' : 'none', image: b.image ? 'https://woo.test/n.webp' : null }, error: null }));
  const r = await S.categoryUpdate({ id: 80, name_en: 'Lights', name_ar: null, image: null });
  assert.deepEqual(plain(r), { ok: true, ar: 'none', image: null });
  await S.categoryUpdate({ id: 80, name_en: null, name_ar: 'إضاءة', image: blob([0xff, 0xd8, 0xff]) });
  assert.deepEqual(plain(bodies()), [{ action: 'category_update', id: 80, name_en: 'Lights' }, { action: 'category_update', id: 80, name_ar: 'إضاءة', image: { data: '/9j/' } }]);
  assert.deepEqual(plain(mirror), [['rename', 80, 'Lights']]);
  assert.deepEqual(plain(logs).map((l) => l[1]), ['#80 · name', '#80 · name_ar, image']);
  const off = load(() => ({ data: { action: 'category_update', result: 'skipped', reason: 'push_disabled' }, error: null }));
  assert.deepEqual(plain(await off.S.categoryUpdate({ id: 80, name_en: 'X' })), { ok: false, reason: 'push_disabled' });
});

test('categoryDelete: done → the mirror drops it and the log says which; refused by the server (409) → conflict with its error and count, nothing dropped', async () => {
  const { S, logs, mirror } = load(() => ({ data: { action: 'category_delete', result: 'ok', id: 152, ar: 'ok' }, error: null }));
  assert.deepEqual(plain(await S.categoryDelete(152, 'أباجورات')), { ok: true, ar: 'ok' });
  assert.deepEqual(plain(mirror), [['remove', 152]]);
  assert.deepEqual(plain(logs[0]), ['product.category.delete', '#152 · أباجورات', { entity: 'woo_categories', entity_id: '152' }]);
  const used = load(() => ({ data: null, error: { context: { status: 409, json: async () => ({ error: 'has_products', count: 4 }) } } }));
  assert.deepEqual(plain(await used.S.categoryDelete(151, 'إضاءة')), { ok: false, reason: 'conflict', error: 'has_products', count: 4 });
  assert.deepEqual([used.mirror, used.logs], [[], []]);
  const denied = load(() => ({ data: null, error: { context: { status: 401 } } }));
  assert.equal((await denied.S.categoryDelete(151)).reason, 'forbidden');
});
