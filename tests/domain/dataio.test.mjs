import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const X = loadUmd(new URL('../../app/js/blocks/01-dataio.js', import.meta.url));

// 2026-11-16-data-page.md decision 3: import by the system's ID — a row with an ID edits its filled cells only, an empty cell keeps the
// value, an unknown ID is an error, a row with no ID is a new one (when the sheet adds), a new row already in the system is skipped
const F = [X.ID_FIELD, { key: 'name', label: 'الاسم', required: true }, { key: 'cat', label: 'الفئة', type: 'list', options: ['Fashion', 'Kids'] }, { key: 'st', label: 'الحالة', type: 'enum', options: ['نشط', 'غير نشط'] }];
const MAP = { 0: '_id', 1: 'name', 2: 'cat', 3: 'st' };
const byId = (id) => (id === 'v1' ? { name: 'أحمد', cat: 'Fashion', st: 'نشط' } : id === 'v2' ? { name: 'سارة', cat: 'Kids', st: 'نشط' } : null);
const run = (rows, extra) => X.validate(rows, MAP, F, Object.assign({ mode: 'mixed', canAdd: true, key: 'name', existing: ['موجود'], byId }, extra));

test('mixed: an ID row changes only its filled cells, before → after', () => {
  const [r] = run([['v1', '', 'kids، fashion', 'غير نشط']]);
  assert.equal(r.status, 'update');
  assert.deepEqual(r.changes.map((c) => [c.key, c.from, c.to]), [['cat', 'Fashion', 'Kids، Fashion'], ['st', 'نشط', 'غير نشط']]);
  assert.equal(r.data.name, undefined, 'the empty name cell is not a change');
});
test('mixed: an ID with nothing new is «مفيش تغيير»; an unknown ID and a repeated ID are errors', () => {
  const r = run([['v2', 'سارة', '', ''], ['v9', 'x', '', ''], ['v2', '', '', 'نشط']]);
  assert.equal(r[0].status, 'same');
  assert.equal(r[1].status, 'error'); assert.match(r[1].errors[0], /مش موجود/);
  assert.equal(r[2].status, 'error'); assert.match(r[2].errors.join(' '), /متكرر/);
});
test('mixed: a row with no ID is new with its required cells; a known name is skipped; a sheet that only edits refuses it', () => {
  const r = run([['', 'نور', 'Fashion', ''], ['', '', 'Kids', ''], ['', 'موجود', '', '']]);
  assert.deepEqual(r.map((x) => x.status), ['new', 'error', 'exists']);
  assert.match(r[1].errors[0], /الاسم مطلوب/);
  const [only] = run([['', 'نور', '', '']], { canAdd: false });
  assert.equal(only.status, 'error'); assert.match(only.errors[0], /تعديل بس/);
});
test('Arabic matching folds the hamza, ya and ta marbuta; a list value outside the options is an error', () => {
  assert.equal(X.norm('إدارة'), X.norm('اداره'));
  assert.equal(X.norm('هدى'), X.norm('هدي'));
  const [r] = run([['', 'نور', 'Kids، ديكور', '']]);
  assert.equal(r.status, 'error'); assert.match(r.errors[0], /«ديكور» مش في القائمة/);
});
test('the mixed template puts the ID first and marks «مطلوب» for new rows only', () => {
  const cols = X.templateCols(F, 'mixed');
  assert.equal(cols[0].key, '_id'); assert.equal(cols[0].required, false); assert.equal(cols[1].required, true);
  assert.match(cols[2].hint, /أكتر من واحد/);
});
