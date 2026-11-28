/* «املا البيانات دي من اللينك ده» — an add / edit / delete asked of any assistant without saying what (Safwat 28 Nov;
   docs/superpowers/plans/2026-11-28-ask-popups.md, phase B). Not a block. The popup picks the kind of request (إضافة · تعديل · حذف) and
   the element (منتج · مبتكر · رقم مالي · قسم · موظف · أوردر رئيسي · أوردر فرعي · تصميم · عميل · طلب موارد بشرية · قطعة في المخزن ·
   براند — «إجراءات ذكية», 2026-11-28-smart-actions.md: «ونضيف كل العناصر»); the host then runs what that pick is in the system: the
   chat's steps (IBChatFlow) and the system's own popup filled at their end, the system's popup itself, or — where the system has no
   steps for it yet — its page behind a link popup. Nothing is written from here.
     IBRequestAsk.detect(text)      → an add / edit / delete asked without the element a flow knows
     IBRequestAsk.preOf(text)       → { verb, element } said in the words
     IBRequestAsk.route(pick)       → pure: { flow, pre } | { form, values } | { studio: true } | { page: { hash, label } }
     IBRequestAsk.summary(pick)     → the member's message line
     IBRequestAsk.label(pick)       → its short name («إضافة منتج», «إضافة مصروف»)
     IBRequestAsk.complete(pre)     → the kind and the element both said — runs with no popup
     IBRequestAsk.formState(pre) / check(f) / fields(f, redraw, { may }) → the popup's part (the «إضافة طلب ذكي» popup uses it too)
     IBRequestAsk.open({ pre, onPick, may }) → the popup (browser only) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBRequestAsk = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[؟?!.,،:;()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const pad = (t) => ' ' + t + ' ';

  const VERBS = [['add', 'إضافة'], ['edit', 'تعديل'], ['delete', 'حذف']];
  const ELEMENTS = [['product', 'منتج'], ['maker', 'مبتكر'], ['money', 'رقم مالي'], ['category', 'قسم'], ['member', 'موظف'], ['order', 'أوردر رئيسي'], ['sub', 'أوردر فرعي'], ['design', 'تصميم'],
    ['customer', 'عميل'], ['hr', 'طلب موارد بشرية'], ['lot', 'قطعة في المخزن'], ['brand', 'براند']];
  // «رقم مالي» to add: which of the accounts' moves (his answer — the accounts' own popups)
  const MONEY = [['expense', 'مصروف', 'سحب أو إيداع على حسابات الشركة'], ['makerMove', 'حركة على حساب مبتكر', 'عربون / مواصلات / تصحيح رصيد']];
  // «طلب موارد بشرية» to add: which request (the HR page's own popups — to the member's manager)
  const HR = [['leave', 'طلب إجازة', 'بأيامها ونوعها'], ['advance', 'طلب سلفة', 'بتتخصم من المرتب'], ['remote', 'شغل عن بُعد', 'يوم أو أكتر من برّه']];
  const SUBS = { money: MONEY, hr: HR };
  const SUB_Q = { money: 'نوع الحركة', hr: 'نوع الطلب' };
  const needsSub = (p) => !!(p && p.verb === 'add' && SUBS[p.element]);
  const label = (list, v) => (list.find((x) => x[0] === v) || [])[1] || v;

  const page = (hash, lbl, text) => ({ page: { hash, label: lbl, text } });
  /** What a pick is in the system — the chat's steps first, the system's own popup, else its page by a link. */
  function route(p) {
    const k = (p && p.verb) + '.' + (p && p.element);
    switch (k) {
      case 'add.product': return { studio: true };
      case 'edit.product': return { flow: 'productEdit' };
      case 'delete.product': return { flow: 'trash' };
      case 'add.maker': return { flow: 'maker' };
      case 'edit.maker': return { flow: 'makerEdit' };
      case 'add.money': return { flow: p.sub === 'makerMove' ? 'makerMove' : 'expense' };
      case 'edit.order': return { flow: 'order' };
      case 'add.design': return { flow: 'post' };
      case 'add.member': return { form: 'member_add', values: {} };
      case 'delete.maker': return page('makers', 'المبتكرين', '«حذف المبتكر» من قايمة «⋮» في ملفه — بسبب، والأدمن بس.');
      case 'edit.money': case 'delete.money': return page('moves-log', 'سجل الحركات', 'الحركة بتتعدّل أو بتتلغي من «⋮» على صفها في «سجل الحركات».');
      case 'add.category': case 'edit.category': case 'delete.category': return page('products-cats', 'أقسام المنتجات', 'الأقسام بتتضاف وتتعدّل وتتمسح من تاب «الأقسام» في المنتجات — والمسح للقسم اللي مفيهوش منتجات.');
      case 'edit.member': case 'delete.member': return page('hr-team', 'الفريق', 'بيانات العضو وإيقافه أو مسحه من «⋮» على صفه في «الموارد البشرية › الفريق والحضور».');
      case 'add.order': return page('cs-inbox', 'خدمة العملاء', '«أوردر جديد» بيتعمل من محادثة العميل في «خدمة العملاء» — بيتعمل على الموقع مستني الدفع.');
      case 'delete.order': return page('orders', 'الأوردرات', '«مسح» الأوردر من قايمة «⋮» على الأوردر — بسبب، وبيتلغي الأول لو مش ملغي.');
      case 'add.sub': case 'edit.sub': case 'delete.sub': return page('orders', 'الأوردرات', 'إضافة منتج جوه أوردر فرعي وتعديله ومسحه من «تعديل» الأوردر › «الأوردرات الفرعية».');
      case 'edit.design': case 'delete.design': return page('marketing-create', 'التسويق', 'الكامبين بتتعدّل أو بتتمسح من «آخر الشغل» في «التسويق › إنشاء».');
      // «ونضيف كل العناصر» (2026-11-28-smart-actions.md): the customer, the HR request, the hub's piece and the brand
      case 'add.customer': return { form: 'customer_add', values: {} };
      case 'edit.customer': return page('cs-customers', 'العملاء', 'بيانات العميل بتتعدّل من ملفه: «خدمة العملاء» › «العملاء» › اضغط على العميل › «تعديل».');
      case 'delete.customer': return page('cs-customers', 'العملاء', 'العميل مابيتمسحش — المكرر بيتدمج في التاني من ملفه («دمج مع عميل تاني») وتاريخه بيفضل.');
      case 'add.hr': return { form: p.sub === 'advance' ? 'hr_advance' : p.sub === 'remote' ? 'hr_remote' : 'hr_leave', values: {} };
      case 'edit.hr': case 'delete.hr': return page('profile-requests-mine', 'طلباتي', 'الطلب بيتلغي وهو لسه مستني: «ملفي» › «طلباتي» › افتح الطلب › «إلغاء الطلب» — وبعدها اعمل واحد جديد لو عايز تغيّره.');
      case 'add.lot': return page('inventory', 'المخزون', '«استلام في المخزن» من صفحة «المخزون» — من أوردر (بالرقم أو اسم العميل) أو استلام يدوي لقطعة من غير أوردر.');
      case 'edit.lot': return page('inventory', 'المخزون', 'الكمية من «⋮» على القطعة في «سجل المخزون» › «تسوية كمية»، والمكان والحالة من «⋮» على القطعة في الجرد («المخزون» › «الجرد»).');
      case 'delete.lot': return page('inventory', 'المخزون', 'من الجرد («المخزون» › «الجرد»): «⋮» على القطعة › «شيل من المخزن» بسبب — بتتسجل حركة خروج والسطر بيفضل بالباقي.');
      case 'add.brand': return page('makers', 'المبتكرين', 'البراند بيتضاف من ملف المبتكر: اضغط على المبتكر › قسم «البراندات» › «إضافة براند».');
      case 'edit.brand': return page('makers', 'المبتكرين', 'من ملف المبتكر › «البراندات» › «⋮» على البراند: «تعديل» (الاسم والكود) أو «تغيير صورة البراند» أو «نقل لمبتكر تاني».');
      case 'delete.brand': return page('makers', 'المبتكرين', 'البراند مابيتمسحش (ملكيته بتتحسب في الحسابات) — لو مابقاش بتاع المبتكر انقله لمبتكر تاني من «⋮» › «نقل لمبتكر تاني».');
      default: return null;
    }
  }
  const subLabel = (p) => (needsSub(p) && p.sub ? label(SUBS[p.element], p.sub) : '');
  const summary = (p) => 'طلب: ' + label(VERBS, p.verb) + ' ' + label(ELEMENTS, p.element) + (subLabel(p) ? ' — ' + subLabel(p) : '');
  /** The pick's short name: «إضافة منتج», «إضافة مصروف», «إضافة طلب إجازة». */
  const shortLabel = (p) => label(VERBS, p.verb) + ' ' + (subLabel(p) || label(ELEMENTS, p.element));

  const VERB_RE = [['add', /\s(ضيف|ضيفلي|اضيف|اضف|اضافه|سجل|اسجل|add)\s/], ['edit', /\s(عدل|اعدل|عدللي|تعديل|غير|اغير|edit|change)\s/], ['delete', /\s(امسح|مسح|احذف|حذف|اشيل|شيل|delete|remove)\s/]];
  const EL_RE = [['sub', /اوردر(ات)? فرعي|فرعيه/], ['order', /اوردر|order/], ['product', /منتج|product/], ['brand', /براند|brand/], ['maker', /مبتكر|maker|vendor/], ['money', /مصروف|فلوس|رقم مالي|حركه ماليه|money/],
    ['category', /قسم|اقسام|category/], ['member', /موظف|عضو|member|employee/], ['design', /تصميم|بوست|كامبين|design|post|campaign/], ['customer', /عميل|عملاء|customer/],
    ['hr', /اجاز|سلف|شغل عن بعد|leave|advance/], ['lot', /قطعه|مخزن|inventory/]];
  const READ = /\s(اعرف|اشوف|شوف|اعرض|وريني|كام|كم|ايه|مين|فين|ليه|تقرير|تقارير)\s/;
  function preOf(text) {
    const t = norm(text); const p = pad(t);
    return { verb: (VERB_RE.find(([, re]) => re.test(p)) || [])[0] || '', element: (EL_RE.find(([, re]) => re.test(t)) || [])[0] || '' };
  }
  /** An add / edit / delete said in a few words («عايز أضيف حاجة», «عايز أعدّل», «امسح») — the steps a flow knows were tried first. */
  // the words around a bare ask — anything else is a detail («زي الشهر اللي فات», a name, an amount) and the ask goes its old way
  const FILLER = /^(عايز|عاوز|عايزه|محتاج|محتاجه|ممكن|لو|سمحت|حاجه|حاجات|جديد|جديده|حد|انا|ان|اني|عايزين|يا|من|في|فضلك)$/;
  const isWord = (w, re) => re.test(pad(w)) || re.test(w);
  function detect(text) {
    const t = norm(text); if (!t || t.split(' ').length > 8 || READ.test(pad(t))) return false;
    if (!preOf(text).verb) return false;
    const extra = t.split(' ').filter((w) => !FILLER.test(w) && !VERB_RE.some(([, re]) => isWord(w, re)) && !EL_RE.some(([, re]) => re.test(w)));
    return extra.length <= 1;
  }

  // ---- the popup's part — its own popup and the «إضافة طلب ذكي» popup draw it (2026-11-28-smart-actions.md)
  const formState = (pre) => ({ verb: (pre && pre.verb) || '', element: (pre && pre.element) || '', sub: (pre && pre.sub) || '' });
  /** What is still missing in the pick, in words — '' when it is complete. */
  const check = (f) => (!f.verb ? 'اختار نوع الطلب' : !f.element ? 'اختار العنصر' : needsSub(f) && !f.sub ? 'اختار ' + SUB_Q[f.element] : '');
  const U = () => w.IBUI;
  /** The kind, the element (one the member may not do with that kind is greyed — `may({ verb, element })`) and the add's sub-kind. */
  // the popup's look (Safwat 28 Nov — «راجع تصميم بوباب الطلبات عشان يطلع بشكل احترافي و منظم»): numbered steps, the kind a segmented
  // control, the elements icon tiles in a fixed order (the products' side, the makers and the orders, the money, the team, the design),
  // the sub-kinds small cards with a line each, and the pick said in one line before «ابدأ»
  const VERB_IC = { add: 'plus', edit: 'edit', delete: 'trash' };
  const EL_IC = { product: 'box', category: 'tag', brand: 'star', lot: 'stock', maker: 'users', order: 'package', sub: 'truck', customer: 'headset', money: 'wallet', member: 'briefcase', hr: 'calendar', design: 'image' };
  const EL_ORDER = ['product', 'category', 'brand', 'lot', 'maker', 'order', 'sub', 'customer', 'money', 'member', 'hr', 'design'];
  const SUB_IC = { expense: 'wallet', makerMove: 'users', leave: 'calendar', advance: 'wallet', remote: 'home' };
  const shownEls = () => EL_ORDER.map((id) => ELEMENTS.find((e) => e[0] === id)).filter(Boolean).concat(ELEMENTS.filter((e) => !EL_ORDER.includes(e[0])));
  function fields(f, redraw, o) {
    const u = U(); const { h, Icon } = u; const may = o && typeof o.may === 'function' ? o.may : null;
    const ok = (e, sub) => { try { return !!may({ verb: f.verb, element: e, sub: sub || '' }); } catch (x) { return false; } };
    // an element is open when its pick is — an add with sub-kinds when any of them is
    const off = (e) => !!(may && f.verb && !(needsSub({ verb: f.verb, element: e }) ? SUBS[e].some(([sub]) => ok(e, sub)) : ok(e)));
    const subOff = (sub) => !!(may && !ok(f.element, sub));
    if (f.element && off(f.element)) { f.element = ''; f.sub = ''; }
    if (f.sub && needsSub(f) && subOff(f.sub)) f.sub = '';
    const step = (n, t) => h('p', { class: 'rqq-step' }, h('span', { class: 'rqq-n' }, String(n)), t);
    const radio = (key, v, on, no, kids, cls) => h('button', { type: 'button', class: cls + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), disabled: no, title: no ? 'مش من صلاحياتك' : null, 'data-rqq-opt': key + ':' + v }, ...kids);
    const verbs = h('div', { class: 'rqq-seg', role: 'radiogroup', 'aria-label': 'نوع الطلب', 'data-rqq-group': 'verb' }, VERBS.map(([v, l]) => {
      const b = radio('verb', v, f.verb === v, false, [Icon(VERB_IC[v] || 'plus', 'sm'), h('span', null, l)], 'rqq-segb'); b.addEventListener('click', () => { f.verb = v; f.sub = ''; redraw(); }); return b; }));
    const tiles = h('div', { class: 'rqq-tiles', role: 'radiogroup', 'aria-label': 'العنصر', 'data-rqq-group': 'element' }, shownEls().map(([v, l]) => {
      const no = off(v); const b = radio('element', v, f.element === v, no, [h('span', { class: 'rqq-ic' }, Icon(EL_IC[v] || 'box', 'sm')), h('span', { class: 'rqq-tl' }, l)], 'rqq-tile');
      b.addEventListener('click', () => { f.element = v; f.sub = ''; redraw(); }); return b; }));
    const subs = needsSub(f) ? h('div', { class: 'rqq-subs', role: 'radiogroup', 'aria-label': SUB_Q[f.element], 'data-rqq-group': 'sub' }, SUBS[f.element].map(([v, l, d]) => {
      const no = subOff(v); const b = radio('sub', v, f.sub === v, no, [h('span', { class: 'rqq-ic' }, Icon(SUB_IC[v] || 'plus', 'sm')), h('span', { class: 'rqq-st' }, h('b', null, l), d ? h('small', null, d) : null)], 'rqq-sub');
      b.addEventListener('click', () => { f.sub = v; redraw(); }); return b; })) : null;
    const left = check(f);
    const pick = h('p', { class: 'rqq-pick' + (left ? '' : ' done'), 'data-rqq-pick': '' }, Icon(left ? 'sliders' : 'checkCircle', 'sm'),
      left ? h('span', null, left) : h('span', null, 'هتطلب: ', h('b', null, shortLabel(f))));
    return h('div', { class: 'rqq-form', 'data-rqq-form': '' }, ...[h('p', { class: 't-small help rqq-help' }, 'اختار نوع الطلب والعنصر — والمساعد هيكمّل معاك خطوة خطوة، وفي الآخر بوب أب السيستم نفسه متملّي والتأكيد منك.'),
      step(1, 'نوع الطلب'), verbs, step(2, 'العنصر'), tiles, subs ? step(3, SUB_Q[f.element]) : null, subs, pick].filter(Boolean));
  }
  function open(o) {
    const u = U(); if (!u || !u.Modal) return null; const { h, Button } = u; const opt = o || {};
    const f = formState(opt.pre); let err = ''; let m = null; const box = h('div', { 'data-rqq-box': '' });
    const draw = () => { err = err ? check(f) : ''; box.replaceChildren(fields(f, draw, { may: opt.may }), ...(err ? [u.InlineNote({ kind: 'error', children: err })] : [])); };
    const go = () => {
      err = check(f); if (err) { draw(); return; }
      m.close(); if (typeof opt.onPick === 'function') opt.onPick({ verb: f.verb, element: f.element, sub: f.sub });
    };
    draw();
    m = u.Modal({ title: 'املا بيانات الطلب', body: [box], footer: [Button({ type: 'primary', icon: 'send', label: 'ابدأ', attrs: { 'data-rqq-go': '' }, onClick: go }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-rqq', ''); }
    return m;
  }
  /** Both said and nothing else to ask («ضيف منتجات», «امسح مبتكر») — runs with no popup; a money / HR add asks its kind first. */
  const complete = (p) => !!(p && p.verb && p.element && !(needsSub(p) && !p.sub));
  return Object.freeze({ VERBS, ELEMENTS, MONEY, HR, SUBS, detect, preOf, route, summary, label: shortLabel, complete, formState, check, fields, open });
});
