import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// Block 06 after phase 3.1 (decision 7): the functions ported from the owner's «إضافة مبتكر» prototype — the status «في إجازة»,
// the login rules (username / email / temporary password), the password generator, the username suggestion, the payout rules.
const V = loadUmd(new URL('../../app/js/blocks/06-vendors-domain.js', import.meta.url));
const ok = (n) => ({ name: 'Zaan', category: V.CATEGORIES[0], phone: '01000000009', rate: 40, leadDays: 7, status: 'active', ...n });
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('STATUSES carries «في إجازة» between active and inactive; validateVendor takes it, nothing else', () => {
  assert.deepEqual(V.STATUSES, [['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط']]);
  assert.equal(V.label(V.STATUSES, 'leave'), 'في إجازة');
  assert.deepEqual(V.validateVendor(ok({ status: 'leave' })), {});
  assert.deepEqual(V.validateVendor(ok({ status: 'vacation' })), { status: 'اختار الحالة' });
});
test('LOGIN_STATUS: none / invited / active / disabled, in the prototype\'s words', () => {
  assert.deepEqual(V.LOGIN_STATUS, [['none', 'مفيش حساب دخول'], ['invited', 'مستني التفعيل'], ['active', 'مفعّل'], ['disabled', 'موقوف']]);
});
test('passwordIssues: 8 chars, a latin letter, a digit, no spaces — each missing rule by name', () => {
  assert.deepEqual(V.passwordIssues(''), ['8 حروف على الأقل', 'حرف إنجليزي', 'رقم']);
  assert.deepEqual(V.passwordIssues('abcdefgh'), ['رقم']);
  assert.deepEqual(V.passwordIssues('12345678'), ['حرف إنجليزي']);
  assert.deepEqual(V.passwordIssues('abc 1234'), ['من غير مسافات']);
  assert.deepEqual(V.passwordIssues('Test1234'), []);
  assert.deepEqual(V.passwordIssues(null), ['8 حروف على الأقل', 'حرف إنجليزي', 'رقم']);
});
test('genPassword: 10 unambiguous characters that pass the rules, from the given random source', () => {
  for (let i = 0; i < 50; i += 1) { const p = V.genPassword(); assert.match(p, /^[a-hj-km-np-zA-HJ-NP-Z2-9]{10}$/); assert.deepEqual(V.passwordIssues(p), []); }
  const p = V.genPassword(seq(0, 0.5, 0.99)); assert.equal(p.length, 10); assert.deepEqual(V.passwordIssues(p), []);
  assert.equal(V.genPassword(seq(0.5)), V.genPassword(seq(0.5))); // deterministic for a fixed source
});
test('suggestUsername: the name in lower-case latin with dots, 3–24 chars, skipping the taken ones', () => {
  assert.equal(V.suggestUsername('Wood & Rope'), 'wood.rope');
  assert.equal(V.suggestUsername(' Antikiano '), 'antikiano');
  assert.equal(V.suggestUsername('Antikiano', (u) => u === 'antikiano'), 'antikiano2');
  assert.equal(V.suggestUsername('Antikiano', (u) => ['antikiano', 'antikiano2'].includes(u)), 'antikiano3');
  assert.equal(V.suggestUsername('ab'), 'ab.ib');
  assert.equal(V.suggestUsername('مبتكر'), 'maker'); // nothing latin in the name
  assert.equal(V.suggestUsername('Bian eg ٢'), 'bian.eg.2');
  assert.equal(V.suggestUsername('a'.repeat(40)).length, 24);
});
test('validateLogin: username rules, email rules, the temporary password only in temp mode', () => {
  assert.deepEqual(V.validateLogin({ username: '', email: '' }), { username: 'اكتب اسم المستخدم', email: 'اكتب الإيميل — عليه بيوصل لينك التفعيل واسترجاع الباسورد' });
  assert.deepEqual(V.validateLogin({ username: 'ab', email: 'x' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس', email: 'اكتب إيميل صحيح' });
  assert.deepEqual(V.validateLogin({ username: '.abc', email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: 'wood-rope', email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: 'a'.repeat(31), email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: ' Wood.Rope ', email: ' name@example.com ' }), {}); // trimmed and lower-cased before the check
  assert.deepEqual(V.validateLogin({ username: 'wood.rope', email: 'a@b.co', pwMode: 'link', password: '' }), {});
  assert.deepEqual(V.validateLogin({ username: 'wood.rope', email: 'a@b.co', pwMode: 'temp', password: 'short' }), { password: 'الباسورد لازم: 8 حروف على الأقل، رقم' });
  assert.deepEqual(V.validateLogin({ username: 'wood.rope', email: 'a@b.co', pwMode: 'temp', password: 'Test1234' }), {});
});
test('validateBank: the method first; cash needs nothing; bank needs holder + bank + IBAN (EG + 27 digits) or an account number (8–20); instapay / wallet a phone (or name@instapay)', () => {
  assert.deepEqual(V.validateBank({}), { method: 'اختار طريقة التحويل' });
  assert.deepEqual(V.validateBank({ method: 'cash' }), {});
  assert.deepEqual(V.validateBank({ method: 'bank' }), { holder: 'اكتب اسم صاحب الحساب زي ما هو في البنك', bankName: 'اكتب اسم البنك', iban: 'اكتب IBAN أو رقم الحساب' });
  assert.deepEqual(V.validateBank({ method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: 'EG38000300010000000000000482' }), { iban: 'IBAN مصري = EG + 27 رقم، أو رقم حساب من 8 لـ 20 رقم' }); // 26 digits
  assert.deepEqual(V.validateBank({ method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: 'eg38 0003 0001 0000 0000 0000 0482 1' }), {}); // spaces and case do not matter
  assert.deepEqual(V.validateBank({ method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: '١٢٣٤٥٦٧٨' }), {}); // an 8-digit account number, Arabic digits
  assert.deepEqual(V.validateBank({ method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: '1234567' }), { iban: 'IBAN مصري = EG + 27 رقم، أو رقم حساب من 8 لـ 20 رقم' });
  assert.deepEqual(V.validateBank({ method: 'instapay', holder: 'Zaan' }), { wallet: 'اكتب رقم الموبايل أو عنوان إنستاباي' });
  assert.deepEqual(V.validateBank({ method: 'instapay', holder: 'Zaan', wallet: 'zaan@instapay' }), {});
  assert.deepEqual(V.validateBank({ method: 'instapay', holder: 'Zaan', wallet: '0100 000 0009' }), {});
  assert.deepEqual(V.validateBank({ method: 'instapay', holder: 'Zaan', wallet: 'zaan@gmail' }), { wallet: 'رقم موبايل (01…) أو عنوان زي name@instapay' });
  assert.deepEqual(V.validateBank({ method: 'wallet', holder: 'Zaan', wallet: 'zaan@instapay' }), { wallet: 'رقم موبايل مصري 11 رقم' });
  assert.deepEqual(V.validateBank({ method: 'wallet', holder: 'Zaan', wallet: '01000000009' }), {});
});
test('createStore.setBank stores the IBAN upper-cased and without spaces (the prototype\'s store, kept for a bare page)', () => {
  const s = V.createStore({ now: () => '2026-10-26T10:00:00.000Z' }); const me = { name: 'صفوت كمال', role: V.ADMIN };
  const v = s.create(ok({}), me);
  s.setBank(v.id, { method: 'bank', holder: 'Zaan', bankName: 'بنك مصر', iban: 'eg38 0003 0001 0000 0000 0000 0482 1' }, me);
  assert.equal(s.get(v.id).bank.iban, 'EG380003000100000000000004821');
});
