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
test('genPassword: 10 unambiguous characters that pass the rules; crypto-random without a source (200 differ), deterministic with an injected one', () => {
  const made = []; for (let i = 0; i < 200; i += 1) { const p = V.genPassword(); assert.match(p, /^[a-hj-km-np-zA-HJ-NP-Z2-9]{10}$/); assert.deepEqual(V.passwordIssues(p), []); made.push(p); }
  assert.ok(new Set(made).size > 1, 'not all equal');
  const p = V.genPassword(seq(0, 0.5, 0.99)); assert.equal(p.length, 10); assert.deepEqual(V.passwordIssues(p), []);
  assert.equal(V.genPassword(seq(0, 0.5, 0.99)), p); // deterministic for a fixed source
  assert.equal(V.genPassword(seq(0.5)), V.genPassword(seq(0.5)));
  assert.notEqual(V.genPassword(seq(0.1, 0.7)), V.genPassword(seq(0.5)));
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
test('validateLogin: username rules, email rules, the temporary password when the form carries one (pwMode temp — the only mode since 26 Oct)', () => {
  assert.deepEqual(V.validateLogin({ username: '', email: '' }), { username: 'اكتب اسم المستخدم', email: 'اكتب الإيميل — عليه بيوصل استرجاع الباسورد من بوابة المبتكر' });
  assert.deepEqual(V.validateLogin({ username: 'ab', email: 'x' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس', email: 'اكتب إيميل صحيح' });
  assert.deepEqual(V.validateLogin({ username: '.abc', email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: 'wood-rope', email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: 'a'.repeat(31), email: 'a@b.co' }), { username: 'من 3 لـ 30: حروف إنجليزي صغيرة وأرقام و . _ بس' });
  assert.deepEqual(V.validateLogin({ username: ' Wood.Rope ', email: ' name@example.com ' }), {}); // trimmed and lower-cased before the check
  assert.deepEqual(V.validateLogin({ username: 'wood.rope', email: 'a@b.co' }), {}); // username + e-mail alone (the drawer's edit): no password check
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
// Phase 3.2 (decision 6): the brands rules ported from the prototype's brands domain — the add / edit form, the trigger's code,
// the owner on a date, the special rate in force, the transfer / return form.
test('brandCode: the first Latin letter upper-cased, else X (the trigger\'s rule)', () => {
  assert.equal(V.brandCode('antikiano'), 'A');
  assert.equal(V.brandCode(' 3d Wood & Rope'), 'D');
  assert.equal(V.brandCode('مبتكر'), 'X');
  assert.equal(V.brandCode(''), 'X');
  assert.equal(V.brandCode(null), 'X');
});
test('validateBrand: the name (1–80), the code (optional; 1–3 of A–Z / 0–9 after upper-casing), the special rate (optional; 0–65)', () => {
  assert.deepEqual(V.validateBrand({ name: '', code: '', aliases: '', rate: '' }), { name: 'اكتب اسم البراند' });
  assert.deepEqual(V.validateBrand({ name: '  ' }), { name: 'اكتب اسم البراند' });
  assert.deepEqual(V.validateBrand({ name: 'a'.repeat(81) }), { name: 'اسم البراند لحد 80 حرف' });
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', code: 'wr', aliases: 'W&R', rate: '' }), {}); // lower-case is upper-cased before the check
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', code: 'WOOD' }), { code: 'الكود من 1 لـ 3: حروف إنجليزي كبيرة أو أرقام' });
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', code: 'W-1' }), { code: 'الكود من 1 لـ 3: حروف إنجليزي كبيرة أو أرقام' });
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', code: '٣' }), {}); // Arabic digits read as Latin
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', rate: '70' }), { rate: 'النسبة الخاصة من 0% إلى 65%' });
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', rate: 'abc' }), { rate: 'النسبة الخاصة من 0% إلى 65%' });
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', rate: '٣٥' }), {});
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', rate: 0 }), {});
  assert.deepEqual(V.validateBrand({ name: 'Wood & Rope', rate: null }), {});
});
test('ownerAt: the last row that had started on the date, else the first row; today without a date; null for no history', () => {
  const h = [{ vendor: 'B', since: '2026-10-18' }, { vendor: 'A', since: '2026-03-01' }, { vendor: 'A', since: '2026-11-20' }]; // unsorted on purpose
  assert.equal(V.ownerAt(h, '2026-10-17'), 'A');
  assert.equal(V.ownerAt(h, '2026-10-18'), 'B');
  assert.equal(V.ownerAt(h, '2026-11-01'), 'B');
  assert.equal(V.ownerAt(h, '2026-11-20'), 'A');
  assert.equal(V.ownerAt(h, '2025-01-01'), 'A'); // before the history: the first owner
  assert.equal(V.ownerAt(h, null), 'A'); // no date: the latest row
  assert.equal(V.ownerAt([], '2026-10-17'), null);
  assert.equal(V.ownerAt(null, '2026-10-17'), null);
});
test('effectiveRate: the row in force on the date — none before the first row has started; a null row means no special rate', () => {
  const rows = [{ rate: 30, since: '2026-10-01' }, { rate: null, since: '2026-11-01' }, { rate: '25.00', since: '2026-12-01' }];
  assert.equal(V.effectiveRate(rows, '2026-10-15'), 30);
  assert.equal(V.effectiveRate(rows, '2026-11-15'), null); // «no special rate» from November
  assert.equal(V.effectiveRate(rows, '2026-12-01'), 25);
  assert.equal(V.effectiveRate(rows, '2026-09-01'), null); // before the first row: no special rate yet (review I1)
  assert.equal(V.effectiveRate([], '2026-10-15'), null);
  assert.equal(V.effectiveRate(null, '2026-10-15'), null);
  assert.equal(V.effectiveRate([{ rate: null, since: '2026-01-01' }], '2026-10-15'), null);
});
test('validateTransfer: a start date, not before the last transfer; a return date after the start; a maker, not the current owner', () => {
  assert.deepEqual(V.validateTransfer({ since: '', toId: '', ownerId: 'A' }), { since: 'اكتب تاريخ البداية', to: 'اختار المبتكر' });
  assert.deepEqual(V.validateTransfer({ since: '2026-13-01', toId: 'B', ownerId: 'A' }), { since: 'اكتب تاريخ البداية' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-10', lastSince: '2026-10-18', toId: 'B', ownerId: 'A' }), { since: 'التاريخ ده قبل آخر نقل للبراند (2026-10-18) — اختار تاريخ بعده' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-18', lastSince: '2026-10-18', toId: 'B', ownerId: 'A' }), { since: 'فيه نقل للبراند بنفس التاريخ (2026-10-18) — اختار تاريخ بعده' }); // the same day: refused before the server's 23505 (review I2)
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', lastSince: '2026-10-18', returnOn: '2026-10-20', toId: 'B', ownerId: 'A' }), { returnOn: 'تاريخ الرجوع لازم يكون بعد تاريخ البداية' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', returnOn: '2026-10-19', toId: 'B', ownerId: 'A' }), { returnOn: 'تاريخ الرجوع لازم يكون بعد تاريخ البداية' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', returnOn: 'soon', toId: 'B', ownerId: 'A' }), { returnOn: 'اكتب تاريخ الرجوع' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', toId: 'A', ownerId: 'A' }), { to: 'البراند أصلًا عند المبتكر ده' });
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', returnOn: '2026-11-20', toId: 'B', ownerId: 'A', lastSince: '2026-03-01' }), {});
  assert.deepEqual(V.validateTransfer({ since: '2026-10-20', returnOn: null, toId: 'B' }), {});
});
