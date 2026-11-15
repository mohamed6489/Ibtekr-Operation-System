import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadUmd } from '../helpers/load-umd.mjs';
import { TYPE_RENAMES, typeName, typeRules, escalationFor } from '../../supabase/functions/_shared/notify.js';
// The owner 15 Nov (2026-11-15-comments.md decision 13): «كل كلمة تذاكر أو تذكرة في السيستم كله تبقى طلبات أو طلب». The page's
// own strings say «طلب»; what was saved or written by the server with the old word is read as the new one (never the other way).
const root = new URL('../../', import.meta.url);
const TK = loadUmd(new URL('app/js/blocks/05-tickets-domain.js', root));
const OPS = loadUmd(new URL('app/js/blocks/12-ops-domain.js', root));
const CS = loadUmd(new URL('app/js/blocks/19-cs-domain.js', root));
const plain = (v) => JSON.parse(JSON.stringify(v));
const OLD = /تذكر[ةه]|تذاكر/;

test('no string of the pages, the adapters or the server functions says «تذكرة» / «تذاكر» — but the names kept to read what was saved before', () => {
  const lit = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  // the only strings that may: the old names in the rename tables and the old condition word the engine still accepts
  const kept = new Set([...Object.keys(TYPE_RENAMES), 'تذكرة جديدة', 'تذكرة مفتوحة', 'أنشأ التذكرة وعيّنها', 'فتح التذكرة وعيّنها', 'فتحت التذكرة وعيّنتها', 'من التذكرة دي', 'الطلب في التذكرة', 'للتذكرة', 'التذكرة', 'التذاكر', 'تذاكر', 'تذكرة', 'من التذكرة دي أو من', 'الطلب في التذكرة TKT-']);
  const allowIn = { 'blocks/05-tickets-domain.js': true, 'blocks/12-ops-domain.js': true, 'blocks/19-cs-domain.js': true, '_shared/notify.js': true, '_shared/cs-auto-run.ts': true };
  const found = [];
  const scan = (dir, base, ok) => { for (const f of readdirSync(new URL(dir, root))) {
    if (!ok(f)) continue; const src = readFileSync(new URL(dir + f, root), 'utf8');
    for (const m of src.matchAll(lit)) { let s = m[1] ?? m[2] ?? m[3] ?? '';
      if (base + f === '_shared/ai-assistant.js') s = s.split('(مش «تذكرة» / «تذاكر»)').join(''); // the assistant is told which word not to say
      if (OLD.test(s) && !(allowIn[base + f] && kept.has(s))) found.push(base + f + ': ' + s.slice(0, 60)); }
  } };
  const js = (f) => f.endsWith('.js');
  scan('app/js/blocks/', 'blocks/', js); scan('app/js/pages/', 'pages/', js); scan('app/js/adapter/', 'adapter/', js);
  scan('supabase/functions/_shared/', '_shared/', (f) => /\.(js|ts)$/.test(f) && !f.endsWith('_test.ts'));
  for (const fn of readdirSync(new URL('supabase/functions/', root))) { if (fn.startsWith('_')) continue; scan('supabase/functions/' + fn + '/', fn + '/', (f) => f === 'index.ts'); }
  assert.deepEqual(found, []);
  for (const page of ['app/index.html', 'app/portal.html']) assert.equal(OLD.test(readFileSync(new URL(page, root), 'utf8')), false, page);
});

test('a history line the server wrote is shown with the new word — the whole phrase, so its gender follows; a member\'s own words are not touched', () => {
  assert.equal(TK.words('سارة أنشأ التذكرة وعيّنها لدور «الحسابات»'), 'سارة أنشأ الطلب وعيّنه لدور «الحسابات»');
  assert.equal(TK.words('الرد الآلي فتح التذكرة وعيّنها لدور «خدمة العملاء»'), 'الرد الآلي فتح الطلب وعيّنه لدور «خدمة العملاء»');
  assert.equal(TK.words('بوابة المبتكر فتحت التذكرة وعيّنتها لدور «الحسابات»'), 'بوابة المبتكر فتحت الطلب وعيّنته لدور «الحسابات»');
  assert.equal(TK.words('هبة حوّل التذكرة إلى «تم الحل» — اتحلت المشكلة'), 'هبة حوّل الطلب إلى «تم الحل» — اتحلت المشكلة');
  assert.equal(TK.words('هبة قفل التذكرة نهائيًا'), 'هبة قفل الطلب نهائيًا');
  assert.equal(TK.words('فتح التذكرة'), 'فتح الطلب');
  assert.equal(TK.words('رد من غير الكلمة'), 'رد من غير الكلمة'); assert.equal(TK.words(null), '');
  // a description / a closing note: only the server's own sentences
  assert.equal(TK.phrases('مايتحسبش في المرتب غير بعد موافقة المدير المباشر — من التذكرة دي أو من «طلبات الفريق».'), 'مايتحسبش في المرتب غير بعد موافقة المدير المباشر — من الطلب ده أو من «طلبات الفريق».');
  assert.equal(TK.phrases('الطلب في التذكرة TKT-0005'), 'موجود في الطلب TKT-0005');
  assert.equal(TK.phrases('العميل عايز تذكرة طيران جديدة'), 'العميل عايز تذكرة طيران جديدة'); // typed by a member: as typed
});

test('the alert names: the page and the engine rename the same four, and a «notif» row saved before reads with the new names', () => {
  assert.deepEqual(plain(OPS.NOTIF_RENAMES), plain(TYPE_RENAMES));
  assert.equal(OPS.NOTIF_TEAMS.includes('المسؤول عن الطلب'), true); assert.equal(OPS.NOTIF_TEAMS.some((x) => OLD.test(x)), false);
  const saved = { notif: [['مهام', [['تذكرة عاجلة / عالية', 'حتى الحل', 'داخل السيستم', 'المسؤول عن التذكرة + خدمة العملاء', false], ['مراجعة تنشيط مبتكر', '3 أيام', 'داخل السيستم', 'أدمن', true]]]],
    escalations: [{ type: 'تذكرة عاجلة بدون رد', after: '4 ساعات', to: ['دور أدمن', 'المسؤول عن التذكرة'], ch: 'داخل السيستم', on: true }], quiet: { on: true } };
  const now = plain(OPS.notifRenamed(saved));
  assert.deepEqual(now.notif, [['مهام', [['طلب عاجل / عالي', 'حتى الحل', 'داخل السيستم', 'المسؤول عن الطلب + خدمة العملاء', false], ['مراجعة تنشيط مبتكر', '3 أيام', 'داخل السيستم', 'أدمن', true]]]]);
  assert.deepEqual(now.escalations, [{ type: 'طلب عاجل بدون رد', after: '4 ساعات', to: ['دور أدمن', 'المسؤول عن الطلب'], ch: 'داخل السيستم', on: true }]);
  assert.deepEqual(now.quiet, { on: true });
  assert.equal(saved.notif[0][1][0][0], 'تذكرة عاجلة / عالية', 'the saved row itself is not changed in place');
  assert.equal(OPS.notifRenamed(null), null);
  // the engine: the saved switch of the old name governs the new type; the escalation saved with the old name still fires
  assert.equal(typeName('تذكرة متأخرة عن موعد المتابعة'), 'طلب متأخر عن موعد المتابعة'); assert.equal(typeName('أي اسم'), 'أي اسم'); assert.equal(typeName('constructor'), 'constructor');
  const rules = typeRules(saved);
  assert.equal(rules.get('طلب عاجل / عالي').on, false); assert.equal(rules.has('تذكرة عاجلة / عالية'), false);
  assert.deepEqual(escalationFor(saved, 'tasks.urgent').roles, ['admin']);
  assert.deepEqual(escalationFor({ escalations: [{ type: 'طلب عاجل بدون رد', after: '4 ساعات', to: ['دور أدمن'] }] }, 'tasks.urgent').roles, ['admin']);
});

test('a template\'s trigger saved as «تذكرة جديدة» is «طلب جديد» — valid and shown so', () => {
  assert.equal(CS.TRIGGERS['شكاوى'].opts.includes('طلب جديد'), true); assert.equal(CS.TRIGGERS['شكاوى'].opts.some((x) => OLD.test(x)), false);
  assert.equal(CS.trigName('تذكرة جديدة'), 'طلب جديد'); assert.equal(CS.trigName('شكوى اتسجلت'), 'شكوى اتسجلت');
  assert.deepEqual(plain(CS.validateTrigger({ cat: 'شكاوى', trigKind: 'auto', trigOn: ['تذكرة جديدة'] })), {});
  assert.equal(CS.triggerText({ cat: 'شكاوى', trigKind: 'auto', trigOn: ['تذكرة جديدة'] }).includes('«طلب جديد»'), true);
});
