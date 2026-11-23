import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// The system's own engine (the owner 22 Nov — «المساعدين … ذكائهم في السيستم مش بيستخدموا مخ خارجي»): what a member asks of the system is
// understood with no model behind it — a page by its name, the fixed commands in today's words, a maker's name by its sound or with
// a slip of the hand — and what is a model's work (a why, an opinion, writing) or more than one ask is left `unknown`.
const B = loadUmd(new URL('../../app/js/pages/system-brain.js', import.meta.url))(loadUmd(new URL('../../app/js/blocks/27-commands-domain.js', import.meta.url)));
const ctx = { vendors: ['antekama', 'Glastora', 'نقشة', 'خشب وبس', 'خشب الورد', 'Nile Craft'], today: '2026-11-22',
  pages: [{ id: 'inventory', label: 'المخزون' }, { id: 'orders', label: 'الأوردرات' }, { id: 'tickets', label: 'طلبات الفريق' }, { id: 'reports', label: 'التقارير' }, { id: 'hr', label: 'الموارد البشرية' }] };
const u = (s, c) => JSON.parse(JSON.stringify(B.understand(s, c || ctx)));

test('a page by the words people call it: with «افتح» / «وديني», or its name alone; a page the member may not open is not offered', () => {
  assert.deepEqual(u('افتح المخزن'), { type: 'goPage', page: 'inventory' });
  assert.deepEqual(u('التقارير'), { type: 'goPage', page: 'reports' });
  assert.deepEqual(u('وديني على طلبات الفريق'), { type: 'goPage', page: 'tickets' });
  assert.deepEqual(u('افتح الموظفين'), { type: 'goPage', page: 'hr' });
  assert.deepEqual(u('افتح المخزن', Object.assign({}, ctx, { pages: ctx.pages.filter((p) => p.id !== 'inventory') })), { type: 'unknown' });
});

test('the fixed commands in today\'s words: «المبتكر» is read, a filter says what it found, a general expense has its kind', () => {
  assert.deepEqual(u('اعرض الأوردرات المتأخرة'), { type: 'ordersFilter', filter: { deliv: 'late' } });
  assert.deepEqual(u('كام أوردر متأخر؟'), { type: 'ordersFilter', filter: { deliv: 'late' } });
  assert.deepEqual(u('رتب المبتكرين بالعربون'), { type: 'sortVendors', sort: 'deposits:desc' });
  assert.equal(u('سجل سحب مرتبات 5000').category, 'المرتبات');
  assert.deepEqual([u('سحب مصروفات 1500').type, u('سحب مصروفات 1500').category, u('سحب مصروفات 1500').amount], ['addExpense', 'المصروفات', '1500']);
  assert.deepEqual(u('الشهر ده'), { type: 'setRange', preset: 'thisMonth' });
});

test('a maker\'s name: by its sound across the two alphabets, with a slip of the hand, only where a name is announced; two that fit are asked about', () => {
  assert.deepEqual([B.skel('انتيكما'), B.skel('antekama'), B.skel('جلاستورا'), B.skel('Glastora'), B.skel('نايل كرافت'), B.skel('Nile Craft')], ['ntkm', 'ntkm', 'glstr', 'glstr', 'nlkrft', 'nlkrft']);
  assert.deepEqual(u('أوردرات المبتكر انتيكما جاري التنفيذ'), { type: 'ordersFilter', filter: { st: 'جاري التنفيذ', vendor: 'antekama' }, heard: 'antekama' });
  assert.deepEqual(u('اوردرات المبتكر antekma').filter, { vendor: 'antekama' });
  assert.deepEqual(u('اوردرات المبتكر نايل كرافت متأخرة').filter, { deliv: 'late', vendor: 'Nile Craft' });
  const two = u('اوردرات المبتكر خشب');
  assert.equal(two.type, 'choose'); assert.deepEqual(two.options, ['خشب الورد', 'خشب وبس']); assert.deepEqual(two.texts, ['اوردرات المبتكر خشب الورد', 'اوردرات المبتكر خشب وبس']);
  // a word of the system's own is never taken for a name: no name is announced here
  assert.deepEqual(B.findName('كام أوردر متأخر', ['Mtakhar Home']), { hit: '', others: [] });
  assert.equal(B.findName('حساب Glastora', ctx.vendors).hit, 'Glastora'); // as written: anywhere
});

test('a model\'s work is left to the member\'s choice: a why, an opinion, writing, a page\'s name inside a longer question, two asks in one', () => {
  for (const s of ['ليه مبيعات انتيكما نزلت الشهر ده؟', 'اكتب وصف لمنتج جديد', 'عايز اعرف رأيك في الحسابات', 'ازيك', 'اقترح عرض للأسبوع الجاي', 'الحسابات فيها مشكلة من امبارح ومش عارف السبب',
    'حساب antekama وعدد الأوردرات الملغية', '']) assert.deepEqual(u(s), { type: 'unknown' }, s);
});

// The owner 22 Nov — «الفلتر بالكلام علي الداتا عيزو يبقا من ضمن السيستم»: a list of a page by the word people call it, the rest of
// the words for the page's own filter; what the words name among the filter's choices, and what is left for the table's search.
test('a list filtered by words: the list, its tab and the words — never the orders, a page alone, an order to write or a «why»', () => {
  const all = { vendors: ['Artisan Loft'], today: '2026-11-22', pages: ['orders', 'vendors', 'accounts', 'inventory', 'products', 'cs', 'tickets', 'hr'].map((id) => ({ id, label: id })) };
  const f = (s, c) => { const r = B.understand(s, c || all); return r.type === 'listFilter' ? [r.list, r.hash, r.tab, r.words] : r.type; };
  assert.deepEqual(f('اعرض المبتكرين الموقوفين'), ['makers', 'makers', 'سجل المبتكرين', ['الموقوفين']]);
  assert.deepEqual(f('طلبات الفريق العاجلة'), ['tickets', 'tickets', 'السجل', ['العاجلة']]);
  assert.deepEqual(f('هات المصروفات بتاعة الإعلانات'), ['expenses', 'expenses', '', ['الإعلانات']]);
  assert.deepEqual(f('وريني العملاء المتضايقين على واتساب'), ['customers', 'cs-customers', '', ['المتضايقين', 'واتساب']]);
  assert.deepEqual(f('اعرض القطع المرتجعة في المخزن'), ['inventory', 'inventory', 'سجل المخزون', ['المرتجعة']]);
  assert.deepEqual(f('الموظفين الغايبين'), ['team', 'hr-team', '', ['الغايبين']]);
  assert.deepEqual(f('اعرض المنتجات مكرمية'), ['products', 'products-records', '', ['مكرمية']], 'the word as it was written, for the search');
  assert.deepEqual(f('show inactive makers'), ['makers', 'makers', 'سجل المبتكرين', ['inactive']]);
  // what it is not
  assert.equal(f('اعرض الأوردرات المتأخرة'), 'ordersFilter'); assert.equal(f('افتح المخزن'), 'goPage'); assert.equal(f('افتح حسابات المبتكرين'), 'navigate'); assert.equal(f('رتب المبتكرين بالعربون'), 'sortVendors');
  assert.equal(f('سجل مصروف 500 كهربا'), 'addExpense', 'an order to write is not a list to show'); assert.equal(f('ليه المبتكرين متأخرين'), 'unknown');
  assert.equal(typeof f('اعرض المبتكرين الموقوفين', Object.assign({}, all, { pages: [{ id: 'orders', label: 'الأوردرات' }] })), 'string', 'a page the member may not open is not filtered');
});

test('the filter’s choices the words name: by stem, the words people say for a choice, the longer label first, the rest for the search', () => {
  const O = [['نشط', 'الحالة'], ['في إجازة', 'الحالة'], ['غير نشط', 'الحالة'], ['ديكور', 'الفئة'], ['عاجل', 'الأولوية'], ['مسودة', 'الحالة'], ['نفد', 'المخزون'], ['متضايق', 'الحالة'], ['واتساب', 'القناة'], ['مرتجع', 'السبب'], ['الإعلانات', 'النوع'], ['غائب', 'الحالة اليوم'], ['في انتظار المراجعة', 'الحالة'], ['مفتوحة (كل الحالات المفتوحة)', 'الحالة']].map(([label, group]) => ({ label, group }));
  const p = (w) => { const r = B.pickOptions(w, O); return [r.picks.map((i) => O[i].label), r.rest]; };
  assert.deepEqual(p(['الموقوفين']), [['غير نشط'], []]); assert.deepEqual(p(['العاجلة']), [['عاجل'], []]); assert.deepEqual(p(['المسودة']), [['مسودة'], []]);
  assert.deepEqual(p(['المتضايقين', 'واتساب']), [['متضايق', 'واتساب'], []]); assert.deepEqual(p(['الغايبين']), [['غائب'], []]); assert.deepEqual(p(['خلصت']), [['نفد'], []]);
  assert.deepEqual(p(['نشط']), [['نشط'], []]); assert.deepEqual(p(['غير', 'نشط']), [['غير نشط'], []], 'the longer label takes the words it shares');
  assert.deepEqual(p(['انتظار', 'المراجعة']), [['في انتظار المراجعة'], []]); assert.deepEqual(p(['المفتوحة']), [['مفتوحة (كل الحالات المفتوحة)'], []]);
  assert.deepEqual(p(['النشطين', 'ديكور', 'خشب']), [['نشط', 'ديكور'], ['خشب']]); assert.deepEqual(p(['مكرمية']), [[], ['مكرمية']]); assert.deepEqual(p([]), [[], []]);
});

// The owner 22 Nov — «لو طلبت حساب مبتكر منتج او موظف او تقرير معين»: what is asked to be read out — never an order to write, a
// list to filter, or a question a model has to think about.
test('a read-out: a maker’s account by name, a period’s sales / expenses / orders / summary, one product, one member', () => {
  const all = { vendors: ['Artisan Loft', 'Anticora'], today: '2026-11-22', pages: ['orders', 'vendors', 'accounts', 'inventory', 'products', 'cs', 'tickets', 'hr'].map((id) => ({ id, label: id })) };
  const r = (s) => { const x = B.understand(s, all); return x.type === 'readMaker' ? ['maker', x.vendor] : x.type === 'readPeriod' ? [x.what, x.preset] : x.type === 'readProduct' ? ['product', x.q] : x.type === 'readMember' ? ['member', x.q] : x.type; };
  assert.deepEqual(r('حساب Anticora'), ['maker', 'Anticora']); assert.deepEqual(r('رصيد Artisan Loft كام؟'), ['maker', 'Artisan Loft']); assert.deepEqual(r('حساب المبتكر Anticora'), ['maker', 'Anticora']);
  assert.deepEqual(r('Anticora account'), ['maker', 'Anticora']); assert.deepEqual(r('balance of Artisan Loft'), ['maker', 'Artisan Loft']);
  assert.deepEqual(r('مبيعات الشهر ده'), ['sales', 'thisMonth']); assert.deepEqual(r('مصروفات الأسبوع ده'), ['expenses', 'thisWeek']); assert.deepEqual(r('كام أوردر النهارده'), ['orders', 'today']);
  assert.deepEqual(r('ملخص الشهر اللي فات'), ['summary', 'lastMonth']); assert.deepEqual(r('sales this month'), ['sales', 'thisMonth']); assert.deepEqual(r('expenses last month'), ['expenses', 'lastMonth']);
  assert.deepEqual(r('المنتج lamp'), ['product', 'lamp']); assert.deepEqual(r('product IBTFA1007'), ['product', 'IBTFA1007']);
  assert.deepEqual(r('الموظف منى'), ['member', 'منى']); assert.deepEqual(r('member Mona'), ['member', 'Mona']);
  // what it is not
  assert.notEqual(B.understand('سجل عربون 300 لـ Anticora', all).type, 'readMaker');
  assert.equal(r('اعرض المنتجات مكرمية'), 'listFilter'); assert.equal(r('اعرض الأوردرات المتأخرة'), 'ordersFilter'); assert.equal(r('افتح حسابات المبتكرين'), 'navigate');
  assert.equal(r('ليه مبيعات الشهر ده قليلة'), 'unknown', 'a why is a model’s to answer');
});

// The owner 22 Nov — «كل الاكشنز اللي ليها علاقة بالسيستم ادخال او اخراج او تعديل بيانات»: an add or an edit names one of the system's
// popups and what to fill it with; the engine writes nothing.
test('add / edit by words: the popup and its values — a maker, a member, a customer, a request, my HR requests, an order, the payroll, a settlement, money without «سحب»', () => {
  const all = { vendors: ['Artisan Loft', 'Anticora'], today: '2026-11-22', pages: ['orders', 'vendors', 'accounts', 'inventory', 'products', 'cs', 'tickets', 'hr'].map((id) => ({ id, label: id })) };
  const f = (s, c) => { const r = B.understand(s, c || all); return r.type === 'openForm' ? [r.form, r.values] : r.type; };
  assert.deepEqual(f('ضيف مبتكر جديد اسمه ورشة النور'), ['vendor_add', { name: 'ورشة النور' }]);
  assert.deepEqual(f('ضيف عميل أحمد سامي 01001234567'), ['customer_add', { name: 'أحمد سامي', phone: '01001234567' }]); assert.deepEqual(f('add customer Sara Ali 01112223334'), ['customer_add', { name: 'Sara Ali', phone: '01112223334' }]);
  assert.deepEqual(f('ضيف موظف كريم عادل karim@x.com'), ['member_add', { name: 'كريم عادل', email: 'karim@x.com' }]);
  assert.deepEqual(f('افتح طلب الطابعة بايظة عاجل'), ['ticket_new', { title: 'الطابعة بايظة', priority: 'urgent' }]); assert.deepEqual(f('new request printer is broken'), ['ticket_new', { title: 'printer is broken' }]);
  assert.deepEqual(f('ضيف مهمة مراجعة الأسعار'), ['ticket_new', { title: 'مراجعة الأسعار' }]);
  assert.deepEqual(f('عايز إجازة'), ['hr_leave', {}]); assert.deepEqual(f('طلب سلفة 2000'), ['hr_advance', { amount: '2000' }]); assert.deepEqual(f('شغل عن بعد'), ['hr_remote', {}]);
  assert.deepEqual(f('أكد الأوردر 10234 بعربون'), ['order_update', { order: '10234', confirm: 'مؤكد بعربون' }]); assert.deepEqual(f('أكد الأوردر 10234 من غير عربون'), ['order_update', { order: '10234', confirm: 'مؤكد بدون عربون' }]);
  assert.equal(f('أكد الأوردر 10234'), 'choose', 'with a deposit or without is asked');
  assert.deepEqual(f('غير حالة الأوردر 10234 لقيد الشحن'), ['order_update', { order: '10234', status: 'قيد الشحن' }]); assert.deepEqual(f('set order 10234 to shipped'), ['order_update', { order: '10234', status: 'قيد الشحن' }]);
  assert.equal(f('خلي الأوردر 10234 ملغي'), 'tell', 'a cancel takes its reason on the orders page');
  assert.deepEqual(f('سوي حساب Anticora'), ['vendor_settle', { vendor: 'Anticora' }]);
  assert.deepEqual(f('خصم 200 من مرتب محمد علي'), ['salary_adjust', { member: 'محمد علي', kind: 'خصم', amount: '200', label: '' }]); assert.deepEqual(f('حول مرتب منى حسن'), ['salary_pay', { member: 'منى حسن' }]);
  assert.deepEqual(f('مكافأة 500 لمنى حسن')[1].kind, 'بدل');
  // money said without «سحب»: the accounts' popup, filled
  const m = (s) => { const r = B.understand(s, all); return [r.type, r.amount, r.vendorType || r.category, r.vendor || r.details || '']; };
  assert.deepEqual(m('سجل عربون 300 لـ Anticora'), ['addVendorMove', '300', 'عربون', 'Anticora']); assert.deepEqual(m('مواصلات 150 لـ Artisan Loft'), ['addVendorMove', '150', 'مواصلات', 'Artisan Loft']);
  assert.deepEqual(m('مصروف 1,200 صيانة المكتب'), ['addExpense', '1200', 'المصروفات', 'صيانة المكتب']);
  // what it is not: the old commands, a page, a list, a read-out, a why; and a page the member may not open opens no popup
  assert.equal(f('سجل سحب مرتبات 5000'), 'addExpense'); assert.equal(f('افتح طلبات الفريق'), 'goPage'); assert.equal(f('طلبات الفريق العاجلة'), 'listFilter'); assert.equal(f('الموظف منى'), 'readMember');
  assert.equal(f('ليه المصروف 500 عالي'), 'unknown'); assert.equal(f('عربون 300'), 'unknown', 'no maker named');
  const few = Object.assign({}, all, { pages: [{ id: 'orders', label: 'الأوردرات' }] });
  assert.equal(typeof f('ضيف عميل أحمد سامي', few), 'string'); assert.equal(typeof f('ضيف مبتكر ورشة النور', few), 'string');
});
