/* What an outside AI may be shown (the owner 22 Nov — «اي مخ خارجي لما بدخلوا لازم اوافق … من غير ما يكون عندوا كل معلومات الشركة
   الا لو انا وافقت بعد ما الايجنت بتاعي يطلب مني»). Not a block.
   An outside model gets the member's message only. When it needs the system's data to go on, the assistant asks: which kinds,
   what each holds and what it leaves out — «وافق المرة دي» sends exactly those kinds for this request, «ارفض» sends nothing.
     IBBrainShare.KINDS        the kinds a model may ask for: { label, has, not }
     IBBrainShare.NEVER        what never leaves the system, whatever is approved
     IBBrainShare.clean(list)  the known kinds of a list, once each
     IBBrainShare.names(list)  their names in one line («الأوردرات · المبيعات»)
     IBBrainShare.card({ redraw })  the settings card: the locked list and the last sends (kinds and counts — no text)
   The server keeps the rule: a model is given a kind's rows only when the request carries it in `share`. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Icon } = U;
  const EN = window.IB_LANG === 'en'; const tx = (ar, en) => (EN ? en : ar);
  const single = () => !!(window.IBSettings && window.IBSettings.single && window.IBSettings.single());
  const D = (label, has, not) => ({ label, has, not });
  const KINDS = {
    summary: D(tx('ملخص اليوم', 'The day’s summary'), tx('أعداد الأوردرات والطلبات والرسايل المفتوحة', 'Counts of the open orders, requests and messages'), tx('من غير أسامي ولا مبالغ تفصيلية', 'No names and no detailed amounts')),
    orders: D(tx('الأوردرات', 'Orders'), tx('الأرقام والحالات والتواريخ والإجماليات', 'Numbers, statuses, dates and totals'), tx('من غير أسامي العملاء وتليفوناتهم وعناوينهم', 'No customer names, phones or addresses')),
    sales: D(tx('المبيعات', 'Sales'), tx('إجماليات المبيعات بالفترة والحالة', 'Sales totals by period and status'), tx('من غير بيانات العملاء', 'No customer data')),
    vendors: D(tx('المبتكرين', 'Makers'), tx('الأسامي والحالات وعدد الأوردرات والأرصدة — ومع «التشغيل الذكي» أسامي منتجاتهم وأقسامها', 'Names, statuses, order counts and balances — and, with the operations assistant, their products’ names and categories'), tx('من غير الحسابات البنكية ونسب العمولة', 'No bank accounts and no commission rates')),
    vendor: D(tx('حساب مبتكر', 'A maker’s account'), tx('أوردراته وحركاته ورصيده', 'Its orders, moves and balance'), tx('من غير حسابه البنكي ونسبة عمولته', 'No bank account and no commission rate')),
    customers: D(tx('العملاء', 'Customers'), tx('الأعداد والحالات والمحادثات المفتوحة', 'Counts, statuses and open conversations'), tx('من غير الأسامي والتليفونات ونص الرسايل', 'No names, phones or message text')),
    tickets: D(tx('طلبات الفريق', 'Team requests'), tx('العناوين والحالات والأولويات والمسؤول', 'Titles, statuses, priorities and who holds each'), tx('من غير المرفقات', 'No attachments')),
    tasks: D(tx('المهام', 'Tasks'), tx('العناوين والحالات', 'Titles and statuses'), tx('من غير ملاحظات المراجعة', 'No review notes')),
    expenses: D(tx('المصروفات', 'Expenses'), tx('المبالغ والأنواع والتواريخ', 'Amounts, types and dates'), tx('من غير المرتبات', 'No salaries')),
    inventory: D(tx('المخزن', 'Inventory'), tx('القطع وأماكنها وحالاتها', 'Items, their places and conditions'), tx('من غير التكلفة', 'No cost')),
    hr: D(tx('الفريق', 'The team'), tx('الأسامي والأدوار والحضور', 'Names, roles and attendance'), tx('من غير المرتبات والتقييمات', 'No salaries and no appraisals')),
    ads: D(tx('أرقام الإعلانات', 'Ad numbers'), tx('الحملات والإعلانات (الكريتيفز) وصرفها ونتايجها والأوردرات اللي جت منها والاقتراحات المفتوحة', 'The campaigns and ads (creatives), their spend and results, the orders they brought, and the open suggestions'), tx('من غير مفاتيح الربط بالمنصات', 'No platform keys')),
    site: D(tx('حالة الموقع', 'The site’s state'), tx('فحص السرعة وتحديثات ووردبريس', 'The speed check and the WordPress updates'), tx('من غير بيانات العملاء والأوردرات', 'No customer or order data')),
    files: D(tx('ملفات', 'Files'), tx('أسامي الملفات المرفوعة', 'The uploaded files’ names'), tx('من غير محتوى الملف', 'No file content')),
  };
  const NEVER = () => [tx('تليفونات العملاء', 'Customer phones'), tx('عناوين العملاء', 'Customer addresses'), tx('الحسابات البنكية', 'Bank accounts'), tx('المرتبات', 'Salaries'), single() ? null : tx('نسب العمولة', 'Commission rates'), tx('المفاتيح والباسوردات', 'Keys and passwords'), tx('نص رسايل العملاء', 'Customer message text')].filter(Boolean);
  const clean = (list) => (Array.isArray(list) ? list : []).filter((k, i, a) => typeof k === 'string' && KINDS[k] && a.indexOf(k) === i);
  const names = (list) => clean(list).map((k) => KINDS[k].label).join(' · ');
  const BRAIN = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

  // ---- the settings card (under «مصادر الذكاء»): what never leaves, and what was sent lately
  const LOG = { rows: null, loading: false };
  function card(o) {
    const A = window.IBActivity; const redraw = o && o.redraw;
    if (LOG.rows === null && !LOG.loading && A && A.byAction) { LOG.loading = true; A.byAction(['assistant.share', 'mkt.agent.share'], 20).then((r) => { LOG.loading = false; LOG.rows = r || []; if (typeof redraw === 'function') redraw(); }); }
    const when = (at) => { try { return new Intl.DateTimeFormat(EN ? 'en-GB' : 'ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at)); } catch (e) { return String(at || '').slice(0, 16); } };
    // a log line is «<company> · <kinds>» — written by the adapter: ids only
    const row = (r) => { let p = String(r.detail || '').split(' · '); if (p.length > 2) p = p.slice(1); /* an assistant's send names the assistant first */ const kinds = clean(String(p[1] || '').split(', '));
      return h('li', { class: 'bs-log-i', 'data-bs-log': '' }, h('span', { class: 'bs-log-w' }, when(r.at)), h('b', null, h('bdi', null, BRAIN[p[0]] || p[0] || '—')), h('span', { class: 'bs-log-k' }, names(kinds) || '—'), h('span', { class: 'bs-log-a' }, r.actor)); };
    const log = LOG.rows === null ? h('p', { class: 't-small sub' }, tx('بنحمّل…', 'Loading…'))
      : LOG.rows.length ? h('ul', { class: 'bs-log', 'data-bs-logs': '' }, LOG.rows.map(row)) : h('p', { class: 't-small sub', 'data-bs-logs': 'none' }, tx('لسه مفيش بيانات اتبعتت لمخ خارجي.', 'No data has been sent to an outside AI yet.'));
    const c = K.Section(tx('البيانات والمخ الخارجي', 'Data and the outside AI'), [
      h('div', { class: 'bs-rule' }, h('span', { class: 'set-ic' }, Icon('lock')), h('div', null, h('b', null, tx('المخ الخارجي بياخد رسالتك بس', 'An outside AI gets your message only')),
        h('p', { class: 't-small sub' }, tx('لو محتاج بيانات من السيستم، المساعد بيسألك الأول على كل نوع — والموافقة للمرة دي بس.', 'When it needs the system’s data, the assistant asks you first about each kind — and the approval is for that one time.')))),
      h('div', { class: 'bs-cap t-small sub' }, tx('ممنوع يخرج أبدًا', 'Never leaves the system')),
      h('ul', { class: 'bs-never', 'data-bs-never': '' }, NEVER().map((x) => h('li', null, Icon('lock', 'sm'), h('span', null, x)))),
      h('div', { class: 'bs-cap t-small sub' }, tx('آخر اللي اتبعت', 'What was sent lately')), log],
      null, { sub: tx('إيه اللي المخ الخارجي يقدر يشوفه — وبموافقتك بس', 'What an outside AI can see — and only with your approval'), th: false, cols: false });
    c.setAttribute('data-brain-share', '');
    return c;
  }

  window.IBBrainShare = { KINDS, NEVER, clean, names, card, refresh: () => { LOG.rows = null; } };
})();
