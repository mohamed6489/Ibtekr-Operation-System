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
// Phase 3.3 (decisions 1 / 5 / 6): the synced store data — the address parts and their joined text (the server's rule), the social
// links (https:// or nothing), the per-category commission form, the Arabic labels of the synced fields, the widened contact group.
test('ADDRESS_KEYS / SOCIAL_KEYS / SYNC_FIELD_LABELS: Dokan\'s six address keys, its eight social keys with Arabic labels, a label for every synced field', () => {
  assert.deepEqual(V.ADDRESS_KEYS, ['street_1', 'street_2', 'city', 'state', 'zip', 'country']);
  assert.deepEqual(V.ADDRESS_LABELS.map((x) => x[0]), V.ADDRESS_KEYS);
  assert.deepEqual(V.SOCIAL_KEYS.map((x) => x[0]), ['fb', 'instagram', 'twitter', 'youtube', 'linkedin', 'pinterest', 'threads', 'flickr']);
  assert.equal(V.label(V.SOCIAL_KEYS, 'fb'), 'فيسبوك');
  assert.deepEqual(Object.keys(V.SYNC_FIELD_LABELS), ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates']);
  assert.deepEqual([V.SYNC_FIELD_LABELS.phone, V.SYNC_FIELD_LABELS.address_parts, V.SYNC_FIELD_LABELS.category_rates], ['التليفون', 'العنوان', 'عمولة الفئات']);
});
test('addressText: the filled street_1 / street_2 / city / state joined by «، » (zip and country never), null when none — the server\'s rule', () => {
  assert.equal(V.addressText({ street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' }), '12 شارع المعز، القاهرة، الجمالية');
  assert.equal(V.addressText({ street_1: ' 12 شارع المعز ', street_2: 'الدور 3', city: 'القاهرة', state: 'الجمالية' }), '12 شارع المعز، الدور 3، القاهرة، الجمالية');
  assert.equal(V.addressText({ zip: '11511', country: 'EG' }), null);
  assert.equal(V.addressText({}), null);
  assert.equal(V.addressText(null), null);
  assert.equal(V.addressText({ city: 'الجيزة' }), 'الجيزة');
});
test('cleanAddressParts: always the six keys, trimmed and capped, the country upper-cased latin; cleanSocial: always the eight keys, https:// or empty', () => {
  assert.deepEqual(V.cleanAddressParts({ street_1: '  12 شارع   المعز ', city: 'القاهرة', country: 'eg', extra: 'x' }), { street_1: '12 شارع المعز', street_2: '', city: 'القاهرة', state: '', zip: '', country: 'EG' });
  assert.deepEqual(V.cleanAddressParts(null), { street_1: '', street_2: '', city: '', state: '', zip: '', country: '' });
  assert.equal(V.cleanAddressParts({ street_1: 'a'.repeat(200) }).street_1.length, 120);
  assert.deepEqual(V.cleanSocial({ fb: ' https://www.facebook.com/artcraft ', instagram: 'javascript:alert(1)', twitter: 'http://x.com/a', youtube: '@artcraft', linkedin: 'https://', threads: 'https://www.threads.net/@a"><img src=x>' }),
    { fb: 'https://www.facebook.com/artcraft', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: 'https://www.threads.net/@a"><img src=x>', flickr: '' }); // html inside an https link stays text for the screen; a non-https value is nothing
  assert.deepEqual(V.cleanSocial(null), { fb: '', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' });
  assert.equal(V.cleanSocial({ fb: 'https://x.com/' + 'a'.repeat(200) }).fb, ''); // over 200: blanked
  assert.equal(V.cleanSocial({ fb: 'HTTPS://X.COM/A' }).fb, 'HTTPS://X.COM/A');
});
test('validateAddressParts: each part within its length, the zip latin letters / digits, the country a two-letter code or empty', () => {
  assert.deepEqual(V.validateAddressParts({ street_1: '12 شارع المعز', city: 'القاهرة', state: 'الجمالية', zip: '11511', country: 'EG' }), {});
  assert.deepEqual(V.validateAddressParts({}), {});
  assert.deepEqual(V.validateAddressParts(null), {});
  assert.deepEqual(V.validateAddressParts({ street_1: 'a'.repeat(121), city: 'b'.repeat(81), zip: '١١٥١١', country: 'Egypt' }), { street_1: 'لحد 120 حرف', city: 'لحد 80 حرف', country: 'كود الدولة حرفين إنجليزي (مثلًا EG)' }); // Arabic digits in the zip read as latin
  assert.deepEqual(V.validateAddressParts({ zip: '11511-ش', country: 'eg' }), { zip: 'الرمز البريدي أرقام وحروف إنجليزي بس' });
  assert.deepEqual(V.validateAddressParts({ zip: 'a'.repeat(21) }), { zip: 'لحد 20 حرف' });
});
test('validateSocial: empty is fine; a link must be a full https:// address (no http, no handle, no javascript:) up to 200 characters', () => {
  assert.deepEqual(V.validateSocial({ fb: 'https://www.facebook.com/artcraft', instagram: '' }), {});
  assert.deepEqual(V.validateSocial({}), {});
  assert.deepEqual(V.validateSocial(null), {});
  assert.deepEqual(V.validateSocial({ fb: 'http://www.facebook.com/artcraft', instagram: '@artcraft', twitter: 'javascript:alert(1)', youtube: 'https://', linkedin: 'https://x.com/' + 'a'.repeat(200) }),
    { fb: 'الرابط لازم يبدأ بـ https://', instagram: 'الرابط لازم يبدأ بـ https://', twitter: 'الرابط لازم يبدأ بـ https://', youtube: 'الرابط لازم يبدأ بـ https://', linkedin: 'الرابط أطول من 200 حرف' });
  assert.deepEqual(V.validateSocial({ unknown: 'x' }), {}); // only the eight keys are judged
});
test('validateCategoryRate: a positive category id; the rate empty (none from that date) or 0–65; the flat fee empty or ≥ 0', () => {
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: 15, rate: '30', flat: '' }), {});
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: '15', rate: '', flat: '0' }), {}); // blank rate = the category rate is removed from that date
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: '٢٢', rate: '٣٥', flat: '١٠' }), {}); // Arabic digits
  assert.deepEqual(V.validateCategoryRate({}), { wooCategoryId: 'اختار الفئة' });
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: 0, rate: 70, flat: -1 }), { wooCategoryId: 'اختار الفئة', rate: 'النسبة من 0% إلى 65%', flat: 'الرسوم الثابتة رقم من 0 أو أكتر' });
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: 1.5, rate: 'abc', flat: 'x' }), { wooCategoryId: 'اختار الفئة', rate: 'النسبة من 0% إلى 65%', flat: 'الرسوم الثابتة رقم من 0 أو أكتر' });
  assert.deepEqual(V.validateCategoryRate({ wooCategoryId: 15, rate: null, flat: null }), {});
});
test('EDIT_GROUPS.contact carries contactName / addressParts / social (instagram lives in social); validateGroup nests their errors; groupPatch keeps the objects', () => {
  assert.deepEqual([...V.EDIT_GROUPS.contact.fields], ['phone', 'altPhone', 'email', 'contactName', 'addressParts', 'social', 'storeUrl']);
  const cur = ok({ contactName: 'منى عادل', addressParts: { city: 'القاهرة' }, social: { fb: '' } });
  assert.deepEqual(V.validateGroup('contact', cur, { phone: '01000000009', addressParts: { street_1: 'x', country: 'Egypt' }, social: { fb: 'http://f.com/a' } }), { addressParts: { country: 'كود الدولة حرفين إنجليزي (مثلًا EG)' }, social: { fb: 'الرابط لازم يبدأ بـ https://' } });
  assert.deepEqual(V.validateGroup('contact', cur, { phone: '01000000009', addressParts: { street_1: 'x', country: 'EG' }, social: { fb: 'https://f.com/a' } }), {});
  assert.deepEqual(V.validateGroup('contact', cur, { phone: '123', contactName: 'a'.repeat(121) }), { phone: 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)', contactName: 'اسم صاحب المتجر لحد 120 حرف' });
  assert.deepEqual(V.validateGroup('identity', cur, { name: 'Zaan', addressParts: { country: 'Egypt' } }), {}); // another group never judges the contact objects
  assert.deepEqual(V.groupPatch('contact', { social: { fb: 'https://f.com/a' }, name: 'x' }), { social: { fb: 'https://f.com/a' } });
});

test('categoryTree / categoryFigures (3.4): the site categories as a tree by name; a parent\'s figure flows to its children, a hand-set child keeps its own, the rest the default', () => {
  const cats = [{ id: 100, name: 'ديكور', parentId: null }, { id: 110, name: 'إضاءة', parentId: 100 }, { id: 111, name: 'أباجورات', parentId: 110 }, { id: 120, name: 'سجاد', parentId: 100 }, { id: 200, name: 'أزياء', parentId: null }, { id: 300, name: 'يتيم', parentId: 999 }, { id: 0, name: 'x' }];
  const tree = V.categoryTree(cats);
  assert.deepEqual(tree.map((n) => n.id), [200, 100, 300]); // by name (Arabic order), the orphan at the top
  assert.deepEqual(tree[1].children.map((n) => n.id), [110, 120]);
  assert.deepEqual(tree[1].children[0].children.map((n) => n.id), [111]);
  const f = V.categoryFigures(tree, { 100: { rate: '٣٠', flat: '' }, 111: { rate: 20, flat: 2 }, 120: { rate: '' } }, { rate: 40, flat: null });
  assert.deepEqual(f[100], { rate: 30, flat: null, inherited: false });
  assert.deepEqual([f[110], f[111], f[120]], [{ rate: 30, flat: null, inherited: true }, { rate: 20, flat: 2, inherited: false }, { rate: 30, flat: null, inherited: true }]);
  assert.deepEqual([f[200], f[300]], [{ rate: 40, flat: null, inherited: true }, { rate: 40, flat: null, inherited: true }]);
  assert.deepEqual(V.categoryTree(null), []);
});
