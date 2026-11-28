/* An alert's card in the bell, drawn from its rule's template (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي ظاهر
   عشان المستخدم لو عايز يعدل يقدر يعدل» · «خلي التصميم لكل التنبيهات يكون احترافي و منظم»; docs/superpowers/plans/
   2026-11-24-bell-redesign.md decision 17). Not a block.
     IBNtfCard.el(c) → the lines under the alert's title: c = { lines: IBNotifCatalog.cardLines(…), phone, dial, wa, dl }
       a line with the customer's name and phone = the card's head (the name bold, the number with «نسخ» / WhatsApp — a masked one,
       no rights to the phone, as it is with no buttons); «follow» = the red (late) / yellow (about to be) chip with its icon; «subs» =
       the sub-orders with a box; «makers» = a row per maker (name · pieces · his products' status, the late / about to be ones with a
       word and a colour — never the colour alone); «details» = the entity's line, its « · » pieces apart; «chip» / «text» as they are;
       «state» = the alert's state as a chip in its tone (late red · about to be yellow · confirmed green — the word on it); «nums» =
       a maker's sub-order numbers, each opening its order's details with a copy mark beside it, and «نسخ الكل» (Safwat 25 Nov — the maker's card; 28 Nov)
     IBNtfCard.preview(rule, stateLabel) → the rule's card on a sample alert of its element, for its form (the settings) — every
       template works the same way (Safwat 25 Nov — «قوالب الرسايل كلها تشتغل بنفس الطريقة») */
(function () {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit; const C = () => window.IBNotifCatalog || {};
  const stop = (e) => e.stopPropagation();
  function copy(e, p, said) {
    e.stopPropagation();
    try { navigator.clipboard.writeText(p).then(() => K().toast(said || 'اتنسخ الرقم', 'success'), () => K().toast('ماقدرتش أنسخ', 'error')); } catch (x) { K().toast('ماقدرتش أنسخ', 'error'); }
  }
  const TONE = { late: 'error', risk: 'warning', ok: 'success', off: 'neutral' };
  function stateEl(p) {
    const { h } = U(); const L = p.items && p.items.length ? p.items : [{ t: p.text, d: '' }];
    return L.map((x) => h('span', { class: 'ntf-chip ' + (TONE[x.d] || 'neutral'), 'data-ntf-state': x.d || '' }, x.t));
  }
  // the main order a sub-order number belongs to, on the orders page's own rows (its own number for an order of one maker)
  function orderOfSub(n) {
    const O = window.OrdersApp; if (!O || !O.query || !O.get) return null; const k = String(n);
    for (const r of O.query({}, 1e6).rows) { if (String(r.id) === k) return r.id; const g = O.get(r.id); if (g && g.subs.some((s) => String(s.sid) === k)) return r.id; }
    return null;
  }
  // Safwat 28 Nov — «زراير الاوردرات الفرعية لو دوست عليه تفتحلي تفاصيل الاوردر و لو دوست علي علامة كوبي اقدر انسخهم»: the number opens its
  // order's details over the page (OrdersApp.peek), the copy mark beside it copies it; «نسخ الكل» copies them a line each (to paste to him)
  function openSub(e, n) {
    e.stopPropagation(); const id = orderOfSub(n); const O = window.OrdersApp;
    if (id == null || !O || !O.peek) { K().toast('الأوردر الفرعي #' + n + ' مش ظاهر في صفحة الأوردرات دلوقتي', 'error'); return; }
    if (U().closePopover) U().closePopover(); O.peek(id);
  }
  function numsEl(p) {
    const { h, Icon } = U(); const L = (p.items || []).filter((x) => x && x.n);
    const all = L.map((x) => x.n).join('\n');
    return h('span', { class: 'ntf-nums', role: 'group', 'aria-label': 'أرقام الأوردرات الفرعية', 'data-ntf-nums': String(L.length) },
      L.map((x) => h('span', { class: 'ntf-num ' + (x.d || ''), 'data-ntf-num': x.n },
        h('button', { type: 'button', class: 'ntf-num-open', title: 'تفاصيل الأوردر', 'aria-label': 'افتح تفاصيل الأوردر الفرعي ' + x.n, 'data-ntf-num-open': x.n, onClick: (e) => openSub(e, x.n) }, h('bdi', { dir: 'ltr' }, '#' + x.n)),
        h('button', { type: 'button', class: 'ntf-num-copy', title: 'نسخ ' + x.n, 'aria-label': 'نسخ الأوردر الفرعي ' + x.n, 'data-ntf-num-copy': x.n, onClick: (e) => copy(e, x.n, 'اتنسخ الرقم ' + x.n) }, Icon('copy', 'sm')))),
      L.length > 1 ? h('button', { type: 'button', class: 'ntf-num all', 'aria-label': 'نسخ كل الأرقام', 'data-ntf-nums-all': '', onClick: (e) => copy(e, all, 'اتنسخت ' + L.length + ' أرقام') }, Icon('copy', 'sm'), 'نسخ الكل') : null);
  }
  const pcs = (n) => (C().pcsWord ? C().pcsWord(n) : String(n));
  const DL = { late: 'متأخر', risk: 'قابل للتأخير' };
  function phoneEl(p, c) {
    const { h, Icon } = U();
    return h('span', { class: 'ntf-ph' }, h('bdi', { dir: 'ltr', 'data-ntf-phone': '' }, p.text),
      c.dial ? h('button', { type: 'button', class: 'icon-btn sm', title: 'نسخ الرقم', 'aria-label': 'نسخ الرقم', 'data-ntf-copy': '', onClick: (e) => copy(e, c.phone) }, Icon('copy', 'sm')) : null,
      c.wa ? h('a', { class: 'icon-btn sm ntf-wa', href: c.wa, target: '_blank', rel: 'noopener', title: 'واتساب', 'aria-label': 'واتساب', 'data-ntf-wa': '', onClick: stop }, Icon('whatsapp', 'sm')) : null);
  }
  function makersEl(p) {
    const { h } = U();
    return h('span', { class: 'ntf-mk', role: 'list', 'data-ntf-makers': '' }, (p.items || []).map((x) => h('span', { class: 'ntf-mk-row ' + x.d, role: 'listitem', 'data-ntf-maker': x.d },
      h('span', { class: 'nm', title: x.n }, h('bdi', null, x.n)),
      h('span', { class: 'pc', 'data-ntf-pcs': '' }, pcs(x.p)),
      x.s || DL[x.d] ? h('span', { class: 'st', title: [DL[x.d], x.s].filter(Boolean).join(' · ') }, DL[x.d] ? h('span', { class: 'w' }, DL[x.d]) : null, DL[x.d] && x.s ? ' · ' : null, x.s || null) : null)));
  }
  function part(p, c) {
    const { h, Icon } = U();
    if (p.kind === 'phone') return phoneEl(p, c);
    if (p.kind === 'state') return stateEl(p);
    if (p.kind === 'nums') return numsEl(p);
    if (p.kind === 'name') return h('span', { class: 'ntf-nm', 'data-ntf-name': '' }, h('bdi', null, p.text));
    if (p.kind === 'follow') return h('span', { class: 'ntf-chip ' + (c.dl === 'late' ? 'error' : 'warning'), 'data-ntf-follow': c.dl }, Icon('clock', 'sm'), p.text);
    if (p.kind === 'subs') return h('span', { class: 'ntf-chip neutral', 'data-ntf-chip': '', 'data-ntf-subs': '' }, Icon('package', 'sm'), p.text);
    if (p.kind === 'chip') return h('span', { class: 'ntf-chip neutral', 'data-ntf-chip': '' }, p.text);
    if (p.kind === 'details') return h('span', { class: 'ntf-det', 'data-ntf-text': '' }, p.text.split(' · ').filter(Boolean).map((t) => h('span', null, t)));
    return h('small', { class: 'ntf-late', 'data-ntf-text': '' }, p.text);
  }
  function lineEl(L, c) {
    const { h } = U();
    if (L.length === 1 && L[0].kind === 'makers') return makersEl(L[0]);
    if (L.length === 1 && L[0].kind === 'nums') return numsEl(L[0]);
    if (L.every((p) => p.kind === 'text')) return h('small', { class: 'ntf-late', 'data-ntf-line': '' }, L.map((p) => p.text).join(' · '));
    const head = L.some((p) => p.kind === 'phone' || p.kind === 'name');
    return h('span', { class: head ? 'ntf-line ph' : 'ntf-chips', 'data-ntf-line': '' }, L.map((p) => (p.kind === 'makers' ? makersEl(p) : part(p, c))));
  }
  function el(c) {
    const { h } = U();
    return h('span', { class: 'ntf-cust', 'data-ntf-cust': '' }, (c.lines || []).map((L) => lineEl(L, c)));
  }
  // the rule's card on a sample alert of its element (an order's facts for an order rule), for its form in the settings
  function preview(rule, stateLabel) {
    const Cat = C(); const { h } = U(); if (!Cat.cardLines) return null;
    const order = Cat.isOrderRule(rule); const maker = !!(Cat.isMakerRule && Cat.isMakerRule(rule)); const phone = order || maker ? '01012345678' : '';
    const c = { lines: Cat.cardLines(Cat.templateOf(rule), Cat.sampleVars(rule, stateLabel)), phone, dial: !!phone, wa: phone ? 'https://wa.me/201012345678' : null, dl: 'late' };
    return h('div', { class: 'nr-card-prev', 'data-nr-card-prev': '' }, h('span', { class: 't-small sub' }, 'شكله في الجرس (تنبيه مثال):'),
      h('div', { class: 'ntf-item cust prev' }, h('span', { class: 'av letter ' + (maker ? 'vendor' : 'customer'), 'aria-hidden': 'true' }, order ? 'م' : maker ? 'A' : '؟'),
        h('span', { class: 'txt' }, h('b', null, h('span', { class: 'tt' }, String((rule && rule.name) || 'اسم التنبيه') + (maker ? '' : ' — IB-1001'))), el(c))));
  }
  window.IBNtfCard = { el, preview };
})();
