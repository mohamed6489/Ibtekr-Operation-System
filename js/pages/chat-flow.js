/* «خطوات الاختيارات» in an assistant's chat (chat-flows phase 4 — Safwat 25 Nov: «عايز المساعد ببساطة يجيب خطوات اي حاجة بطلبها جوه
   السيستم لو كانت اضافة او تعديل او حذف في شكل اختيارات جوه الشات زي بروسيس اضافة المنتجات في التشغيل الذكي بس نعممها علي جميع انواع
   الطلبات بحسب الدور»; docs/superpowers/plans/2026-11-25-agent-chat-flows.md phase 4). Not a block. An add / edit / delete the system
   knows, asked without what its popup needs, becomes that popup's questions inside the chat — buttons for a choice, a box for a word or
   a number — one at a time, the answered ones a line above with «غيّر»; the last step opens the system's own popup filled over the chat
   (its own button — «حفظ», «امسح» — is the member's). Nothing is written from here. The order (the plan): an expense, a new post (the
   designer), a team request, a maker, an order, a product to the trash; then (part 2) a maker's money (عربون / مواصلات / تصحيح رصيد)
   and one product's edit.
     detect(text, ctx) → { id, pre } | null   — ctx: { kinds: [the expense kinds] }; null when the ask already carries what its popup
                                                needs (the system's engine opens it as before) or is not an add / edit / delete
     create(id, pre) → the flow's state; current(state) → the step in front of the member (null = every step answered)
     answer(state, key, value) → '' | the reason it was refused · back(state, key) · shown(state, step, lists) · openSpec(state)
     card(state, o) → its card in the chat — o: { redraw, cancel, open(spec) → '' | an error to say, lists }
       lists: { kinds: [[value, label]], goals, priorities: [[value, label]], statuses: [[value, label]], makers: () => [name],
                products: (q) => [{ id, name, sku, type, live, priced }] | null (null = still loading), may: (requestType) → bool,
                productMay: ('price' | 'status' | 'brand' | 'maker') → bool — the products page's own rights for one product }
       state.want: a choice said in the ask that hangs on an earlier answer (the product's edit) — picked when its step comes, if allowed
       state.loading: the step in front waits on a list (the products searched, the makers) — the page draws the card again when
       that list lands, so the matches show without a second press (CI 26 Nov)
   The popup it opens: { form, values } (block 28's open_form, under the same rights as by hand) · { draft } (the designer's «كامبين
   جديدة») · { trash: product } (the products page's own «مسح» confirmation) · { productEdit: { product, what } } (the products page's own
   popup — price · publish · draft · brand · maker — or its page by a link). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBChatFlow = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[؟?!.,،:;()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const pad = (t) => ' ' + t + ' ';

  const BASE_KINDS = ['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات'];
  const GOALS = ['منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم'];
  const PRIORITIES = [['normal', 'عادي'], ['high', 'عالي'], ['urgent', 'عاجل'], ['low', 'منخفض']];
  // the statuses an assistant may set on an order (block 28's order_update) — cancelling, refunding and failing have their own popup with a reason
  const ORDER_ST = ['قيد الانتظار', 'معلّق', 'جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن', 'مكتمل'];
  const REQ_TYPES = [['customer', 'مشكلة عميل', 'أوردر أو عميل'], ['vendor', 'مبتكر', 'حاجة على مبتكر'], ['internal', 'طلب خاص', 'شغل لحد في الفريق'],
    ['hr_leave', 'إجازة', 'طلب إجازة'], ['hr_advance', 'سلفة', 'طلب سلفة'], ['hr_remote', 'شغل من البيت', 'يوم شغل عن بُعد']];
  const TICKET = (v) => ['customer', 'vendor', 'internal'].includes(v.type);
  // a maker's money (0078): «سحب» = these off his net (D.VENDOR_TYPES), «إيداع» = a balance correction with a title
  const MAKER_TYPES = ['عربون', 'مواصلات', 'أخرى'];
  // what one product's edit opens — the products page's own popups (its row menu's rights), else its page by a link
  const PRODUCT_EDITS = (p, L) => {
    const x = p || {}; const may = (w) => !L.productMay || L.productMay(w);
    return [x.priced && may('price') ? ['price', 'السعر', 'سعر المبتكر أو الخصم الوهمي'] : null,
      may('status') ? (x.live ? ['draft', 'تحويل لمسودة', 'يختفي من الموقع لحد ما تنشره'] : ['publish', 'نشر', 'يظهر للعملاء على الموقع']) : null,
      may('brand') ? ['brand', 'البراند', 'نقل لبراند تاني'] : null,
      may('maker') ? ['maker', 'المبتكر', 'نقل لمتجر مبتكر تاني على Dokan'] : null,
      ['page', 'باقي البيانات', 'الاسم والوصف والصور والأقسام' + (x.priced ? '' : ' والسعر') + ' — من صفحته']].filter(Boolean);
  };

  // each step: key · label (its answered line) · q (the question) · kind: choice | text | number | maker | product · optional · when(values) · the values' checks
  const FLOWS = {
    expense: { title: 'مصروف جديد', popup: '«سحب / إيداع» بتاع الحسابات', btn: 'افتح «سحب / إيداع»', icon: 'wallet', steps: [
      { key: 'direction', label: 'الحركة', q: 'سحب ولا إيداع؟', kind: 'choice', options: () => [['withdraw', 'سحب', 'فلوس طالعة — مصروف'], ['deposit', 'إيداع', 'فلوس داخلة']] },
      { key: 'category', label: 'النوع', q: 'نوع المصروف إيه؟', kind: 'choice', options: (v, L) => (L.kinds && L.kinds.length ? L.kinds : BASE_KINDS.map((k) => [k, k])) },
      { key: 'amount', label: 'المبلغ', q: 'المبلغ كام؟', kind: 'number', unit: 'ج.م' },
      { key: 'details', label: 'التفاصيل', q: 'اتصرف على إيه؟', kind: 'text', optional: true, max: 200, hint: 'مثلًا: كهربا المخزن' }],
      open: (v) => ({ form: 'expense_add', values: { direction: v.direction, category: v.category, amount: v.amount, details: v.details || '' } }) },
    post: { title: 'بوست جديد', popup: '«كامبين جديدة» في التسويق', btn: 'افتح الكامبين', icon: 'megaphone', steps: [
      { key: 'kind', label: 'الشكل', q: 'عايزه إيه؟', kind: 'choice', options: () => [['post', 'بوست', 'صورة واحدة'], ['carousel', 'كاروسيل', 'كذا صورة ورا بعض'], ['video', 'فيديو / ريل', 'مشاهد بالـ AI']] },
      { key: 'goal', label: 'الهدف', q: 'الهدف منه إيه؟', kind: 'choice', options: (v, L) => (L.goals && L.goals.length ? L.goals : GOALS).map((g) => [g, g]) },
      { key: 'idea', label: 'الفكرة', q: 'الفكرة في سطر؟', kind: 'text', max: 500, hint: 'مثلًا: خصم 20% على الكراسي الخشب' }],
      open: (v) => ({ draft: { goal: v.goal, idea: v.idea, post: v.kind === 'post' ? 1 : 0, carousel: v.kind === 'carousel' ? 1 : 0, video: v.kind === 'video' ? 1 : 0 } }) },
    request: { title: 'طلب جديد', popup: 'بوب أب الطلب', btn: 'افتح الطلب', icon: 'ticket', steps: [
      { key: 'type', label: 'النوع', q: 'نوع الطلب إيه؟', kind: 'choice', options: (v, L) => REQ_TYPES.filter(([t]) => !L.may || L.may(t)) },
      { key: 'orderId', label: 'الأوردر', q: 'رقم الأوردر؟', kind: 'text', optional: true, digits: true, when: (v) => v.type === 'customer', hint: 'لو المشكلة على أوردر' },
      { key: 'vendor', label: 'المبتكر', q: 'أنهي مبتكر؟', kind: 'maker', when: (v) => v.type === 'vendor' },
      { key: 'title', label: 'العنوان', q: 'عنوان الطلب في سطر؟', kind: 'text', max: 200, when: TICKET },
      { key: 'priority', label: 'الأولوية', q: 'الأولوية؟', kind: 'choice', options: (v, L) => (L.priorities && L.priorities.length ? L.priorities : PRIORITIES), when: TICKET },
      { key: 'amount', label: 'المبلغ', q: 'المبلغ كام؟', kind: 'number', optional: true, unit: 'ج.م', when: (v) => v.type === 'hr_advance' }],
      open: (v) => (TICKET(v) ? { form: 'ticket_new', values: { type: v.type, title: v.title, priority: v.priority, orderId: v.orderId || '', vendor: v.vendor || '' } }
        : { form: v.type, values: v.amount ? { amount: v.amount } : {} }) },
    maker: { title: 'مبتكر جديد', popup: '«إضافة مبتكر»', btn: 'افتح «إضافة مبتكر»', icon: 'users', steps: [
      { key: 'name', label: 'الاسم', q: 'اسم المبتكر (أو البراند)؟', kind: 'text', max: 120 },
      { key: 'phone', label: 'الموبايل', q: 'رقم موبايله؟', kind: 'text', optional: true, phone: true },
      { key: 'email', label: 'الإيميل', q: 'إيميله؟', kind: 'text', optional: true, email: true }],
      open: (v) => ({ form: 'vendor_add', values: { name: v.name, phone: v.phone || '', email: v.email || '' } }) },
    order: { title: 'تعديل أوردر', popup: 'تحديث الأوردر', btn: 'افتح تحديث الأوردر', icon: 'package', steps: [
      { key: 'order', label: 'الأوردر', q: 'رقم الأوردر؟', kind: 'text', digits: true, need: true },
      { key: 'what', label: 'المطلوب', q: 'عايز تعمل إيه؟', kind: 'choice', options: () => [['confirm', 'تأكيد', 'بعربون أو من غير'], ['status', 'تغيير الحالة', 'من قيد الانتظار لحد مكتمل']] },
      { key: 'confirm', label: 'التأكيد', q: 'التأكيد؟', kind: 'choice', options: () => [['مؤكد بعربون', 'مؤكد بعربون'], ['مؤكد بدون عربون', 'مؤكد بدون عربون']], when: (v) => v.what === 'confirm' },
      { key: 'status', label: 'الحالة', q: 'الحالة الجديدة؟', kind: 'choice', note: 'الإلغاء والاسترجاع والفشل ليهم بوب أب بسبب — من صفحة الأوردرات.',
        options: (v, L) => (L.statuses && L.statuses.length ? L.statuses : ORDER_ST.map((s) => [s, s])), when: (v) => v.what === 'status' }],
      open: (v) => ({ form: 'order_update', values: v.what === 'confirm' ? { order: v.order, confirm: v.confirm } : { order: v.order, status: v.status } }) },
    trash: { title: 'مسح منتج', popup: 'تأكيد المسح', btn: 'افتح تأكيد المسح', icon: 'trash', steps: [
      { key: 'product', label: 'المنتج', q: 'أنهي منتج؟ اكتب اسمه أو الـ SKU', kind: 'product' }],
      open: (v) => ({ trash: v.product }) },
    // part 2 (26 Nov — «وبعدها الباقي»): a maker's money, one product's edit
    makerMove: { title: 'حركة على حساب مبتكر', popup: '«سحب / إيداع» للمبتكر في الحسابات', btn: 'افتح «سحب / إيداع»', icon: 'wallet', steps: [
      { key: 'direction', label: 'الحركة', q: 'سحب ولا إيداع؟', kind: 'choice', options: () => [['withdraw', 'سحب', 'عربون أو مواصلات — بيتخصم من صافيه'], ['deposit', 'إيداع', 'تصحيح رصيد — بيتضاف على صافيه']] },
      { key: 'vendor', label: 'المبتكر', q: 'أنهي مبتكر؟', kind: 'maker' },
      { key: 'type', label: 'النوع', q: 'نوع السحب؟', kind: 'choice', options: () => MAKER_TYPES.map((k) => [k, k]), when: (v) => v.direction === 'withdraw' },
      { key: 'otherName', label: 'اسم النوع', q: 'اكتب النوع؟', kind: 'text', max: 80, when: (v) => v.direction === 'withdraw' && v.type === 'أخرى' },
      { key: 'title', label: 'عنوان المعاملة', q: 'عنوان المعاملة؟', kind: 'text', max: 80, hint: 'مثلًا: فرق سعر مقاس مخصص', when: (v) => v.direction === 'deposit' },
      { key: 'amount', label: 'المبلغ', q: 'المبلغ كام؟', kind: 'number', unit: 'ج.م' },
      { key: 'note', label: 'ملاحظة', q: 'ملاحظة؟', kind: 'text', optional: true, max: 200, hint: 'مثلًا: عربون أوردر 180656' }],
      open: (v) => ({ form: 'vendor_move', values: { direction: v.direction, vendor: v.vendor, type: v.direction === 'withdraw' ? v.type : '',
        otherName: (v.direction === 'deposit' ? v.title : v.otherName) || '', amount: v.amount, note: v.note || '' } }) },
    productEdit: { title: 'تعديل منتج', popup: 'بوب أب المنتج', btn: 'افتحه', icon: 'sliders', steps: [
      { key: 'product', label: 'المنتج', q: 'أنهي منتج؟ اكتب اسمه أو الـ SKU', kind: 'product', resets: ['what'] }, // another product: its edits asked again
      { key: 'what', label: 'التعديل', q: 'عايز تعدّل إيه فيه؟', kind: 'choice', options: (v, L) => PRODUCT_EDITS(v.product, L) }],
      open: (v) => ({ productEdit: { product: v.product, what: v.what } }) },
  };

  // ---- the ask: an add / edit / delete of one of the flows, with what it already carries. An ask that says more than the steps
  // understand («زي الشهر اللي فات», a video's seconds and product) is not taken: the engine, or the assistant itself, reads it whole.
  const ADD = /\s(ضيف|ضيفلي|اضف|اضيف|اضيفه|اضافه|اعمل|اعملي|اعمللي|اعملها|سجل|سجلي|اسجل|عايز|عاوز|محتاج|افتح|افتحلي|جديد|جديده|نزل|انزل|new|add|create|record|open|make)\s/;
  const EDIT = /\s(عدل|عدللي|تعديل|غير|غيرلي|تغيير|حدث|تحديث|اكد|اكدلي|تاكيد|edit|change|update|confirm|modify)\s/;
  const DEL = /\s(امسح|امسحلي|مسح|احذف|احذفلي|حذف|شيل|شيلي|delete|remove|trash)\s/;
  const READ = /\s(اعرف|اشوف|شوف|اعرض|اعرضلي|وريني|ورني|كام|كم|ايه|مين|فين|ليه|تقرير|ملخص|حساب|رصيد|show|list|how|report|summary|what|which)\s/;
  const N = { expense: /\s(ال)?(مصروف|مصاريف|مصروفات|expense|expenses)\s/, post: /\s(ال)?(بوست|بوستات|منشور|كاروسيل|ريل|post|carousel|reel)\s/,
    request: /\s(ال)?(طلب|request|ticket)\s/, maker: /\s(ال)?(مبتكر|مبتكره|فيندور|maker|vendor)\s/, order: /\s(ال)?(اوردر|order)\s/, product: /\s(ال)?(منتج|product)\s/ };
  const FILL = ['جديد', 'جديده', 'باسم', 'اسمه', 'اسمها', 'ل', 'لـ', 'للـ', 'لل', 'ده', 'دا', 'دي', 'من', 'على', 'علي', 'في', 'الموقع', 'لو', 'سمحت', 'ممكن', 'يا', 'named', 'called', 'a', 'an', 'the', 'for', 'new', 'please'];
  const words = (t) => t.split(' ').filter(Boolean);
  const isVerb = (w) => ADD.test(pad(w)) || EDIT.test(pad(w)) || DEL.test(pad(w));
  const isNoun = (w) => Object.keys(N).some((k) => N[k].test(pad(w)) || N[k].test(pad(w.replace(/^لل?/, '')))); // «للمبتكر» too
  // the words the steps do not know: not a verb, not a flow's noun, not a filler, not one the flow reads itself (known)
  const rest = (t, known) => words(t).filter((w) => !FILL.includes(w) && !isVerb(w) && !isNoun(w) && !(known && known(w)));
  // the same words as they were written (the letters the member typed), when the two splits agree
  const asSaid = (raw, t, list) => { const rw = String(raw).replace(/[؟?!.,،:;()«»"]/g, ' ').trim().split(/\s+/); const tw = words(t);
    if (rw.length !== tw.length) return list.join(' '); const used = new Set(); return list.map((w) => { const i = tw.findIndex((x, j) => x === w && !used.has(j)); if (i < 0) return w; used.add(i); return rw[i]; }).join(' '); };
  const TYPE_W = ['عميل', 'العميل', 'مبتكر', 'المبتكر', 'خاص', 'داخلي', 'عاجل', 'عاجله', 'customer', 'vendor', 'maker', 'internal', 'urgent'];
  const KIND_W = ['فيديو', 'الفيديو', 'video', 'بوست', 'منشور', 'ريل', 'كاروسيل'];
  const ORDER_W = ['حاله', 'الحاله', 'حالته', 'عربون', 'بعربون', 'بدون', 'غير', 'status', 'deposit', 'without', 'with', 'no'];
  // a maker's money: «عربون / مواصلات» come off his net, «إيداع / تصحيح» go on it — not an order's deposit («أكد الأوردر بعربون»), not an
  // expense («مصروف مواصلات»), not a withdrawal request on Dokan («طلب سحب»), not a read of his account («رصيد المبتكر كام»); a name or
  // more words = the engine's popup with them («عربون 300 لـ ‹مبتكر›»)
  const READ_MONEY = /\s(اعرف|اشوف|شوف|اعرض|اعرضلي|وريني|ورني|كام|كم|ايه|مين|فين|ليه|تقرير|ملخص|show|list|how|report|summary|what|which)\s/;
  const MONEY_W = ['عربون', 'العربون', 'مواصلات', 'المواصلات', 'اوبر', 'transport', 'سحب', 'اسحب', 'ايداع', 'اودع', 'تصحيح', 'خصم', 'اخصم', 'withdraw', 'deposit', 'correct',
    'correction', 'رصيد', 'الرصيد', 'رصيده', 'حساب', 'الحساب', 'حسابه', 'خارجي', 'جنيه', 'ج', 'egp'];
  function makerMoney(raw, t, p) {
    if (READ_MONEY.test(p) || ['order', 'expense', 'request', 'post', 'product'].some((k) => N[k].test(p))) return null;
    const kind = /\s(ال)?عربون\s/.test(p) ? 'عربون' : /\s(ال)?(مواصلات|اوبر|transport)\s/.test(p) ? 'مواصلات' : '';
    const maker = words(t).some((w) => N.maker.test(pad(w)) || N.maker.test(pad(w.replace(/^لل?/, ''))));
    const dep = /\s(ايداع|اودع|تصحيح|deposit|correct|correction)\s/.test(p);
    if (!kind && !(maker && (dep || /\s(سحب|اسحب|خصم|اخصم|withdraw)\s/.test(p)))) return null;
    const am = /(^|\s)(\d[\d,]*(?:\.\d+)?)(\s|$)/.exec(t);
    if (rest(t, (w) => MONEY_W.includes(w) || (!!am && w === am[2])).length) return null; // a maker's name or more: the engine reads it whole
    const pre = { direction: dep && !kind ? 'deposit' : 'withdraw' }; if (pre.direction === 'withdraw' && kind) pre.type = kind;
    const n = am ? Number(am[2].replace(/,/g, '')) : 0; if (n > 0 && n <= 10000000) pre.amount = String(n);
    return { id: 'makerMove', pre };
  }
  // one product's edit: what was said («السعر», «البراند», «المبتكر», «انشر» / «مسودة») is picked by itself when that product allows it
  const PE_VERB = /\s(انقل|نقل|انقله|انشر|انشره|نشر|move|publish)\s/;
  const PE_WANT = [['price', /\s(ال)?(سعر|سعره|اسعار|price|prices)\s/], ['brand', /\s(ل|لل|ال)?(براند|brand)\s/], ['maker', /\s(ل|لل|ال)?(مبتكر|متجر|maker|vendor|store)\s/],
    ['draft', /\s(ل|لل|ال)?(مسوده|draft)\s/], ['publish', /\s(انشر|انشره|نشر|publish)\s/]];
  const PE_W = /\s(ل|لل|ال)?(سعر|سعره|اسعار|price|prices|براند|brand|متجر|store|حاله|حالته|status|مسوده|draft|انقل|نقل|انقله|انشر|انشره|نشر|move|publish|تاني|اخر|اخري|other)\s/;

  function detect(text, ctx) {
    const c = ctx || {}; const raw = String(text == null ? '' : text).trim(); const t = norm(raw); if (!t) return null;
    const p = pad(t); if (words(t).length > 14) return null;
    const mm = makerMoney(raw, t, p); if (mm) return mm; // before the reads: «تصحيح رصيد المبتكر» is an edit, not his balance asked
    if (READ.test(p)) return null;
    const add = ADD.test(p); const edit = EDIT.test(p); const del = DEL.test(p); const num = /(^|\s)\d[\d,]*(\.\d+)?(\s|$)/.test(t);
    // a team request — not «طلب سحب» (a maker's withdrawal) nor a request read
    if (N.request.test(p) && add && !/\sسحب\s/.test(p)) {
      if (/\s(اجازه|اجازات|سلفه|عن بعد|من البيت|remote|leave|advance)\s/.test(p)) return null; // the HR popups: the engine opens them as said
      const type = /\s(ل|لل)?(عميل|العميل|customer)\s/.test(p) ? 'customer' : /\s(ل|لل)?(مبتكر|المبتكر|vendor|maker)\s/.test(p) ? 'vendor' : /\s(خاص|داخلي|internal)\s/.test(p) ? 'internal' : '';
      if (rest(t, (w) => TYPE_W.includes(w) || TYPE_W.includes(w.replace(/^لل?/, ''))).length) return null; // a title said: the engine's «طلب جديد» with it
      const pre = type ? { type } : {}; if (/\s(عاجل|عاجله|urgent)\s/.test(p) && type) pre.priority = 'urgent'; // the priority is asked after the type
      return { id: 'request', pre };
    }
    if (N.product.test(p) && del) { const q = rest(t, (w) => w === 'sku'); if (q.length > 8) return null; const qs = asSaid(raw, t, q).slice(0, 80); return { id: 'trash', pre: qs ? { q: qs } : {} }; }
    if (N.product.test(p) && (edit || PE_VERB.test(p))) {
      const q = rest(t, (w) => w === 'sku' || PE_W.test(pad(w))); if (q.length > 8) return null; const qs = asSaid(raw, t, q).slice(0, 80);
      const want = (PE_WANT.find(([, re]) => re.test(p)) || [])[0]; const pre = qs ? { q: qs } : {}; if (want) pre.want = { what: want };
      return { id: 'productEdit', pre };
    }
    if (N.order.test(p) && edit) {
      const on = /(^|\s)#?(\d{2,})(\s|$)/.exec(t); const order = on ? on[2] : '';
      const confirm = /\s(اكد|اكدلي|تاكيد|confirm)\s/.test(p); const st = ORDER_ST.find((x) => p.includes(pad(norm(x))));
      if (order && (st || (confirm && /عربون|deposit/.test(p)))) return null; // all said: the engine opens its popup as before
      const stW = ORDER_ST.flatMap((x) => words(norm(x))); if (rest(t, (w) => w === order || w === '#' + order || ORDER_W.includes(w) || stW.includes(w)).length > 1) return null;
      const pre = {}; if (order) pre.order = order; if (confirm) pre.what = 'confirm'; else if (st) { pre.what = 'status'; pre.status = st; }
      return { id: 'order', pre };
    }
    if ((N.post.test(p) || /\s(فيديو|الفيديو|video)\s/.test(p) && add) && add) {
      const cut = p.search(/\s(عن|about)\s/); const head = cut >= 0 ? p.slice(0, cut).trim() : t;
      if (rest(head, (w) => KIND_W.includes(w)).length) return null; // a video's length, a product, a style: the designer reads it whole
      const pre = {}; if (/\s(كاروسيل|carousel)\s/.test(p)) pre.kind = 'carousel'; else if (/\s(ريل|فيديو|الفيديو|reel|video)\s/.test(p)) pre.kind = 'video'; else pre.kind = 'post';
      const idea = cut >= 0 ? raw.split(/\s(?:عن|about)\s/).slice(1).join(' ').trim() : ''; if (idea) pre.idea = idea.slice(0, 500);
      return { id: 'post', pre };
    }
    if (N.expense.test(p) && add) {
      if (num) return null; // the amount said: the engine's money entry (block 27) opens the accounts' popup filled, as before
      const kinds = (c.kinds || BASE_KINDS).map((k) => norm(Array.isArray(k) ? k[0] : k)); const kindW = (w) => kinds.includes(w) || kinds.includes('ال' + w);
      const left = rest(t, (w) => kindW(w) || ['سحب', 'ايداع', 'اودع', 'withdraw', 'deposit'].includes(w));
      if (left.length > 3) return null; // «زي الشهر اللي فات»: more than the steps know
      const pre = { direction: /\s(ايداع|اودع|deposit)\s/.test(p) ? 'deposit' : 'withdraw' };
      const kind = (c.kinds || BASE_KINDS).map((k) => (Array.isArray(k) ? k[0] : k)).find((k) => k !== 'المصروفات' && (p.includes(pad(norm(k))) || p.includes(pad(norm(k).replace(/^ال/, ''))))); if (kind) pre.category = kind;
      if (left.length) pre.details = asSaid(raw, t, left).slice(0, 200);
      return { id: 'expense', pre };
    }
    // a maker: not a maker's money (the engine's «عربون» / «مواصلات» / his account), and a name said = the engine's «إضافة مبتكر» with it
    if (N.maker.test(p) && add && !num && !/\s(عربون|مواصلات|سحب|ايداع)\s/.test(p)) return rest(t).length ? null : { id: 'maker', pre: {} };
    return null;
  }

  // ---- the state and its steps
  function create(id, pre) {
    const def = FLOWS[id]; if (!def) return null;
    const v = {}; const p = pre || {};
    for (const s of def.steps) if (p[s.key] != null && p[s.key] !== '' && s.kind !== 'product' && s.kind !== 'maker') v[s.key] = p[s.key];
    return { id, values: v, skipped: {}, q: p.q || '', draft: '', err: '', phase: 'ask', done: false, loading: false, want: Object.assign({}, p.want || {}) };
  }
  const live = (st) => FLOWS[st.id].steps.filter((s) => !s.when || s.when(st.values));
  function current(st) {
    if (!st || st.done) return null;
    return live(st).find((s) => st.values[s.key] == null && !st.skipped[s.key]) || null;
  }
  const digitsOf = (x) => String(x == null ? '' : x).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[^\d]/g, '');
  function answer(st, key, value) {
    const s = FLOWS[st.id].steps.find((x) => x.key === key); if (!s) return 'invalid';
    if (s.kind === 'number') { const n = Number(String(value == null ? '' : value).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[,٬\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) return 'اكتب رقم أكبر من صفر'; if (n > 10000000) return 'الرقم كبير أوي'; st.values[key] = String(Math.round(n * 100) / 100); }
    else if (s.kind === 'text') { let x = String(value == null ? '' : value).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s.digits) { x = digitsOf(x); if (!x || x.length < 2 || x.length > 12) return 'اكتب الرقم (أرقام بس)'; }
      if (s.phone) { x = x.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[\s-]/g, ''); if (!/^\+?\d{8,15}$/.test(x)) return 'الرقم مش مظبوط'; }
      if (s.email) { x = x.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) return 'الإيميل مش مظبوط'; }
      if (!x) return 'اكتب حاجة'; st.values[key] = x.slice(0, s.max || 200); }
    else if (s.kind === 'choice') { if (value == null || value === '') return 'اختار'; st.values[key] = String(value); }
    else st.values[key] = value; // maker (a name) · product ({ id, name, sku, … })
    delete st.skipped[key]; st.err = ''; st.draft = '';
    for (const k of s.resets || []) { delete st.values[k]; delete st.skipped[k]; } // the steps that hang on this answer are asked again
    // a step that no longer applies after this answer drops its value («غيّر» the type of a request)
    for (const x of FLOWS[st.id].steps) if (x.when && !x.when(st.values)) { delete st.values[x.key]; delete st.skipped[x.key]; }
    return '';
  }
  function skip(st, key) { const s = FLOWS[st.id].steps.find((x) => x.key === key); if (!s || !s.optional) return false; st.skipped[key] = true; st.err = ''; st.draft = ''; return true; }
  function back(st, key) { delete st.values[key]; delete st.skipped[key]; st.err = ''; st.draft = ''; st.phase = 'ask'; st.done = false; }
  function shown(st, s, lists) {
    const v = st.values[s.key]; if (v == null) return 'تخطّيت';
    if (s.kind === 'choice') { const o = (s.options(st.values, lists || {}) || []).find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
    if (s.kind === 'product') return (v.name || '') + (v.sku ? ' · ' + v.sku : '');
    return String(v) + (s.unit ? ' ' + s.unit : '');
  }
  const openSpec = (st) => (current(st) ? null : FLOWS[st.id].open(st.values));

  // ---- its card (the studio chat's look: answered lines with «غيّر», the question, its buttons or box)
  function card(st, o) {
    const U = root.IBUI; const h = U.h; const opt = o || {}; const redraw = opt.redraw || (() => {}); const L = opt.lists || {};
    const def = FLOWS[st.id]; let s = current(st); const out = []; st.loading = false; // its step says so below when it waits on a list
    // a choice said in the ask that hangs on an earlier answer («غيّر سعر المنتج …» → «السعر» once that product has a price to change):
    // picked by itself when its step comes and it is one of the options; else the step asks as usual
    const said = s && s.kind === 'choice' && st.want ? st.want[s.key] : undefined;
    if (said != null) { delete st.want[s.key]; if ((s.options(st.values, L) || []).some((x) => String(x[0]) === String(said))) { answer(st, s.key, said); s = current(st); } }
    const line = (x) => h('div', { class: 'sc-done', 'data-cf-done': x.key }, U.Icon('check', 'sm'), h('span', null, (x.label || x.q) + ': '), h('b', null, shown(st, x, L)),
      st.phase === 'opened' ? null : h('button', { type: 'button', class: 'sc-edit', 'data-cf-back': x.key, 'aria-label': 'غيّر ' + x.q, onClick: () => { back(st, x.key); redraw(); } }, 'غيّر'));
    // every answered step above the question — the ones said in the ask too, even when their turn is later («سجل عربون»: «النوع: عربون»
    // shows while the maker is asked)
    for (const x of live(st)) { if (x === s) continue; if (st.values[x.key] != null || st.skipped[x.key]) out.push(line(x)); }
    if (s) out.push(ask(st, s, L, redraw, h, U));
    else out.push(end(st, def, opt, redraw, h, U));
    const cancel = opt.cancel && st.phase !== 'opened' ? h('button', { type: 'button', class: 'sc-edit sc-cancel', 'data-cf-cancel': '', onClick: () => opt.cancel() }, 'إلغاء') : null;
    return h('div', { class: 'mk-msg-req sc-card cf-card', 'data-cf': st.id, 'data-cf-step': s ? s.key : st.phase }, h('div', { class: 'sc-head' }, U.Icon(def.icon || 'plus', 'sm'), h('b', null, def.title), cancel), out);
  }
  // the box takes the focus when its step comes (or after the member's own press in the card) — never on a redraw of the page,
  // which would take it from the chat's own box while the member types there
  const focusSoon = (id) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.focus(); }); };
  const focusOnce = (st, key, id) => { if (st.fk === key) return; st.fk = key; focusSoon(id); };
  function ask(st, s, L, redraw, h, U) {
    const Q = h('p', { class: 'sc-q' }, s.q);
    const note = s.note ? h('small', { class: 'help', 'data-cf-note': '' }, s.note) : null;
    const err = st.err ? U.InlineNote({ kind: 'error', children: st.err }) : null;
    const skipBtn = s.optional ? U.Button({ size: 'sm', label: 'تخطّي', attrs: { 'data-cf-skip': s.key }, onClick: () => { skip(st, s.key); redraw(); } }) : null;
    if (s.kind === 'choice') {
      const list = s.options(st.values, L) || [];
      return h('div', null, Q, h('div', { class: 'sc-opts' }, list.map(([v, l, hint]) => h('button', { type: 'button', class: 'sc-opt', 'data-cf-opt': String(v), onClick: () => { answer(st, s.key, v); redraw(); } }, h('b', null, l), hint ? h('small', null, hint) : null))), note, skipBtn);
    }
    if (s.kind === 'maker') {
      const names = (L.makers ? L.makers() : []) || []; st.loading = !names.length;
      return h('div', null, Q, h('div', { class: 'sc-maker' }, U.Select({ id: 'cf-maker', label: '', placeholder: names.length ? 'اختار المبتكر — اكتب أول حروف اسمه' : 'بنحمّل المبتكرين…', value: '',
        options: names.map((n) => ({ value: n, label: n })), onChange: (v) => { if (v) { answer(st, s.key, v); redraw(); } } })), err);
    }
    if (s.kind === 'product') return productAsk(st, s, L, redraw, h, U, Q, err);
    // a word or a number: a box and «التالي» (Enter too); the box is not redrawn while typed in
    const id = 'cf-in'; const go = () => { const e = answer(st, s.key, st.draft); if (e) { st.err = e; st.fk = ''; } redraw(); }; // a refused one: the box again
    const inp = h('input', { id, class: 'input cf-in', type: 'text', inputmode: s.kind === 'number' || s.digits || s.phone ? 'decimal' : undefined, dir: s.email || s.phone ? 'ltr' : undefined,
      placeholder: s.hint || (s.kind === 'number' ? 'مثلًا 1500' : ''), value: st.draft || '', 'aria-label': s.q, 'data-cf-in': s.key,
      onInput: (e) => { st.draft = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } } });
    focusOnce(st, s.key, id);
    return h('div', null, Q, h('div', { class: 'cf-row' }, inp, s.unit ? h('span', { class: 'help' }, s.unit) : null,
      U.Button({ size: 'sm', type: 'primary', label: 'التالي', attrs: { 'data-cf-next': s.key }, onClick: go }), skipBtn), err, note);
  }
  // a product by its name or SKU: the matches as buttons (the member's own products list)
  function productAsk(st, s, L, redraw, h, U, Q, err) {
    const q = st.q || ''; const found = q ? (L.products ? L.products(q) : []) : []; st.loading = !!q && found === null;
    const search = () => { st.q = String(st.draft || '').trim(); st.draft = st.q; st.fk = ''; redraw(); };
    const inp = h('input', { id: 'cf-in', class: 'input cf-in', type: 'text', placeholder: 'اسم المنتج أو الـ SKU', value: st.draft || q, 'aria-label': s.q, 'data-cf-in': s.key,
      onInput: (e) => { st.draft = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } } });
    focusOnce(st, s.key, 'cf-in');
    const worm = () => (root.IBLoader && root.IBLoader.mark ? root.IBLoader.mark(16) : null); // the system's loading look (the logo's worm)
    const res = !q ? null : found === null ? h('p', { class: 'help cf-wait', 'data-cf-loading': '' }, worm(), h('span', null, 'بنحمّل المنتجات — النتيجة هتظهر هنا لوحدها أول ما تخلص.'))
      : !found.length ? h('p', { class: 'help', 'data-cf-none': '' }, 'مالقيتش منتج بالاسم ده — جرّب جزء من الاسم أو الـ SKU.')
        : h('div', { class: 'sc-opts' }, found.slice(0, 8).map((p) => h('button', { type: 'button', class: 'sc-opt', 'data-cf-product': String(p.id), onClick: () => { answer(st, s.key, Object.assign({}, p, { sku: p.sku || '' })); redraw(); } }, h('b', null, p.name), p.sku ? h('small', { dir: 'ltr' }, p.sku) : null)));
    return h('div', null, Q, h('div', { class: 'cf-row' }, inp, U.Button({ size: 'sm', type: 'primary', icon: 'search', label: 'دوّر', attrs: { 'data-cf-search': '' }, onClick: search })), res, err);
  }
  // every step answered: the popup, opened by the member's press — its own button is the confirmation
  function end(st, def, o, redraw, h, U) {
    const opened = st.phase === 'opened';
    const press = () => { const spec = openSpec(st); if (!spec) return; const e = o.open ? o.open(spec) : 'invalid'; if (e) { st.err = e; redraw(); return; } st.phase = 'opened'; st.err = ''; redraw(); };
    return h('div', { class: 'cf-end' },
      h('p', { class: 'help' }, opened ? 'فتحتلك ' + def.popup + ' — كمّل منه ودوس زرار الحفظ فيه.' : 'تمام كده. هفتحلك ' + def.popup + ' متملّي باللي قلته — مفيش حاجة بتتسجّل لحد ما تدوس الزرار فيه.'),
      st.err ? U.InlineNote({ kind: 'error', children: st.err }) : null,
      U.Button({ size: 'sm', type: opened ? 'default' : 'primary', icon: 'external', label: opened ? 'افتحه تاني' : def.btn, attrs: { 'data-cf-open': st.id }, onClick: press }));
  }

  return Object.freeze({ FLOWS, ORDER_ST, PRIORITIES, GOALS, REQ_TYPES, norm, detect, create, current, answer, skip, back, shown, openSpec, card });
});
