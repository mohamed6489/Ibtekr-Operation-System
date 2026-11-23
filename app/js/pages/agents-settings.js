/* «الإعدادات › الذكاء الاصطناعي › المساعدين» — what each assistant's tab adds to its rules and skills (the owner 22 Nov — «اختار
   الموديل لكل مساعد او اعمل اختيار تلقائي … زي المزودين» · «اضف لكل مساعد مصادر مختلفة» · «بدل ما المساعدين تحت بعض تفصلهم في تابس
   و كل مساعد عندوا القواعد و الاسكيلز و المصادر» · «املا كل البيانات دي من عندك و افضل مواقع تساعد كل مساعد»). Not a block.
     IBAgentsSet.tabs({ agents, active, onPick, onAdd })   the assistants as one line of tabs
     IBAgentsSet.brainCard(agent, { live, read, redraw })  its outside brain: automatic (as the providers) or a company and model
     IBAgentsSet.sourcesCard(agent, { redraw })            its sources: the sites it leans on — add · edit · delete · back to the shipped
     IBAgentsSet.rulesCard(agent, { redraw })              the rules that run by themselves: a number of the system against a limit → a note
     IBAgentsSet.sourcesOf(aiRow, id) / brainOf(aiRow, id) what the row «ai» holds (the shipped sources until the admin changes them)
   Kept in the row «ai» under `agents: { <id>: { brain: { provider, model }, sources: [{ name, url, note }], rules: [{ id, metric, op, value, kind, on }] } }` — the admin's row.
   A source is a reference: the system's own engine does not read a site; an outside brain the member agrees to searches these first. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Button, Icon } = U;
  const EN = window.IB_LANG === 'en'; const tx = (ar, en) => (EN ? en : ar);
  const SET = () => window.IBSettings;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const MAX = 20;

  // ---- the shipped sources: the sites each assistant's work leans on (the vendor's own help and documentation first)
  const S = (name, url, ar, en) => ({ name, url, note: tx(ar, en) });
  const DOKAN = () => S('Dokan Docs', 'https://dokan.co/docs/', 'المتاجر والعمولات وطلبات السحب', 'Stores, commissions and withdrawals');
  const WOO = () => S('WooCommerce Docs', 'https://woocommerce.com/documentation/', 'الأوردرات والمنتجات والإعدادات', 'Orders, products and settings');
  const BOSTA = () => S('Bosta API Docs', 'https://docs.bosta.co/', 'الشحنات والبيك أب والتحصيل', 'Deliveries, pickups and cash collection');
  const META_HELP = () => S('Meta Business Help Center', 'https://www.facebook.com/business/help', 'الصفحات والإعلانات والسياسات', 'Pages, ads and policies');
  const SHIPPED = {
    manager: () => [S('Atlassian Team Playbook', 'https://www.atlassian.com/team-playbook', 'طرق ترتيب شغل الفريق والأولويات', 'Ways to organise a team’s work and priorities'),
      S('Harvard Business Review', 'https://hbr.org/', 'الإدارة واتخاذ القرار', 'Management and decision making'), WOO(), DOKAN()],
    buyer: () => [META_HELP(), S('Meta Ad Library', 'https://www.facebook.com/ads/library/', 'إعلانات المنافسين الشغّالة', 'Competitors’ running ads'),
      S('Google Ads Help', 'https://support.google.com/google-ads/', 'الحملات والمزايدة والتتبع', 'Campaigns, bidding and tracking'),
      S('TikTok Business Help Center', 'https://ads.tiktok.com/help/', 'إعلانات تيك توك وسياساتها', 'TikTok ads and their policies'),
      S('TikTok Creative Center', 'https://ads.tiktok.com/business/creativecenter/', 'الإعلانات والتريندات الأعلى أداءً', 'Top-performing ads and trends'),
      S('Think with Google', 'https://www.thinkwithgoogle.com/', 'أبحاث السوق وسلوك المشتري', 'Market research and buyer behaviour')],
    designer: () => [S('Meta Ads Guide', 'https://www.facebook.com/business/ads-guide', 'مقاسات ومواصفات كل شكل إعلان', 'Sizes and specs of every ad format'),
      S('TikTok Creative Center', 'https://ads.tiktok.com/business/creativecenter/', 'تريندات الفيديو والصوت', 'Video and sound trends'),
      S('Pinterest Trends', 'https://trends.pinterest.com/', 'تريندات الديكور والهاند ميد', 'Decor and handmade trends'),
      S('Behance', 'https://www.behance.net/', 'مراجع تصميم وهويات بصرية', 'Design references and visual identities'),
      S('Canva Design School', 'https://www.canva.com/designschool/', 'أساسيات التصميم والتكوين', 'Design and layout basics')],
    dev: () => [WOO(), S('WooCommerce REST API', 'https://woocommerce.github.io/woocommerce-rest-api-docs/', 'مرجع الـ API اللي السيستم بيكلّمه', 'The API reference the system talks to'), DOKAN(),
      S('WordPress Developer Resources', 'https://developer.wordpress.org/', 'ووردبريس والإضافات والتحديثات', 'WordPress, plugins and updates'),
      S('PageSpeed Insights', 'https://pagespeed.web.dev/', 'قياس سرعة صفحات الموقع', 'Measuring the site’s page speed'),
      S('web.dev', 'https://web.dev/', 'أداء المواقع و Core Web Vitals', 'Site performance and Core Web Vitals'),
      S('Supabase Docs', 'https://supabase.com/docs', 'قاعدة البيانات والدوال', 'The database and the functions')],
    stock: () => [BOSTA(), S('WooCommerce — Managing Orders', 'https://woocommerce.com/document/managing-orders/', 'حالات الأوردر على الموقع', 'Order statuses on the site'), DOKAN()],
    cs: () => [S('WhatsApp Business Platform', 'https://developers.facebook.com/docs/whatsapp', 'القوالب ونافذة الـ 24 ساعة', 'Templates and the 24-hour window'),
      S('Messenger Platform', 'https://developers.facebook.com/docs/messenger-platform', 'رسايل ماسنجر وإنستجرام وسياساتها', 'Messenger and Instagram messages and their policies'), META_HELP(),
      S('HubSpot Service Blog', 'https://blog.hubspot.com/service', 'طرق الرد وخدمة العملاء', 'Ways of replying and customer service'),
      S('Zendesk Blog', 'https://www.zendesk.com/blog/', 'مؤشرات خدمة العملاء (SLA · CSAT)', 'Customer-service measures (SLA · CSAT)')],
    makers: () => [DOKAN(), WOO(), BOSTA()],
    accountant: () => [S(tx('مصلحة الضرائب المصرية', 'Egyptian Tax Authority'), 'https://www.eta.gov.eg/', 'الفاتورة الإلكترونية والضرائب', 'E-invoicing and taxes'),
      S(tx('البنك المركزي المصري', 'Central Bank of Egypt'), 'https://www.cbe.org.eg/', 'أسعار الصرف والتعليمات البنكية', 'Exchange rates and banking rules'), DOKAN(),
      S('Paymob Developers', 'https://developers.paymob.com/', 'المدفوعات الإلكترونية وتسوياتها', 'Online payments and their settlements'), BOSTA()],
    hr: () => [S(tx('وزارة العمل', 'Ministry of Labour'), 'https://www.manpower.gov.eg/', 'قانون العمل والإجازات الرسمية', 'The labour law and official holidays'),
      S(tx('الهيئة القومية للتأمين الاجتماعي', 'National Organization for Social Insurance'), 'https://www.nosi.gov.eg/', 'التأمينات الاجتماعية', 'Social insurance'),
      S('SHRM', 'https://www.shrm.org/', 'ممارسات الموارد البشرية والتقييم', 'HR practice and appraisal')],
  };
  const shipped = (id) => (SHIPPED[id] ? SHIPPED[id]() : []);
  const cleanSource = (x) => { const name = String((x && x.name) || '').trim().slice(0, 60); const url = String((x && x.url) || '').trim().slice(0, 200); const note = String((x && x.note) || '').trim().slice(0, 200);
    return name && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"']*)?$/i.test(url) && !/[<>]/.test(name + note) ? { name, url, note } : null; };
  const rowOf = (aiRow, id) => (isObj(aiRow) && isObj(aiRow.agents) && isObj(aiRow.agents[id]) ? aiRow.agents[id] : {});
  /** An assistant's sources: the admin's own list once it was changed, else the shipped one. */
  function sourcesOf(aiRow, id) { const r = rowOf(aiRow, id); return Array.isArray(r.sources) ? r.sources.map(cleanSource).filter(Boolean).slice(0, MAX) : shipped(id); }
  /** An assistant's own outside brain: { provider, model }, or null = automatic (as the providers card). */
  function brainOf(aiRow, id) { const b = rowOf(aiRow, id).brain; return isObj(b) && typeof b.provider === 'string' && typeof b.model === 'string' ? { provider: b.provider, model: b.model } : null; }
  async function saveAgent(id, patch, what, redraw, said) {
    const S0 = SET(); const ai = S0.section('ai') || {}; const all = isObj(ai.agents) ? JSON.parse(JSON.stringify(ai.agents)) : {}; const cur = isObj(all[id]) ? all[id] : {};
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete cur[k]; else cur[k] = patch[k]; }
    if (Object.keys(cur).length) all[id] = cur; else delete all[id];
    const res = await S0.save('ai', { agents: all });
    if (!res || !res.ok) { K.toast((res && res.message) || tx('تعذّر الحفظ — جرّب تاني', 'Could not save — try again'), 'error'); return false; }
    if (K.logEvent) K.logEvent('settings.ai.agent', id + ' · ' + what); // the assistant and what changed — no link and no text
    K.toast(said, 'success'); if (typeof redraw === 'function') redraw(); return true;
  }
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };

  // ---- the assistants as labels (the owner 22 Nov — «خلي الادوار في صفحة المساعدين علي شكل ليبلز عشان ميبقاش التابس فوق و تحت شبه
  // بعض»): a pill each with its icon, the open one filled — the page's own tabs above keep the underline (the archived ones last,
  // marked), then «مساعد جديد»
  function tabs(o) {
    const strip = h('div', { class: 'ag-tabs', role: 'tablist', 'aria-label': tx('المساعدين', 'Assistants'), 'data-ag-tabs': '', 'data-set-instant': '' }, o.agents.map((x) =>
      h('button', { type: 'button', role: 'tab', class: 'ag-tab' + (x.archived ? ' off' : ''), id: 'ag-tab-' + x.id, 'data-ag-tab': x.id, 'aria-selected': String(x.id === o.active), tabindex: x.id === o.active ? '0' : '-1', onClick: () => { if (x.id !== o.active) o.onPick(x.id); } },
        Icon(x.icon || 'sparkle', 'sm'), h('span', null, x.name), x.archived ? h('span', { class: 'ag-arch' }, tx('مؤرشف', 'archived')) : null)));
    return h('div', { class: 'ag-tabs-row' }, h('div', { class: 'ag-tabs-h' }, h('span', { class: 't-small sub' }, tx('اختار المساعد', 'Choose the assistant')), o.onAdd ? Button({ size: 'sm', type: 'primary', icon: 'plus', label: tx('مساعد جديد', 'New assistant'), attrs: { 'data-set-ag-add': '' }, onClick: o.onAdd }) : null), strip);
  }

  // ---- the outside brain of one assistant
  function brainCard(agent, o) {
    const S0 = SET(); const R = window.IBAIRouting; if (!S0 || !S0.section || !R || !R.brainField) return null;
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin); const cur = brainOf(ai, agent.id);
    const field = R.brainField({ id: 'ag-brain-' + agent.id, label: tx('المخ الخارجي', 'Outside AI'), title: [agent.name, ' › ', tx('المخ الخارجي', 'Outside AI')], value: cur, live: o.live, read: o.read, disabled: !admin,
      inherit: tx('تلقائي', 'Automatic'), inheritSub: tx('السيستم يختار الشركة والموديل المناسب', 'The system chooses the right company and model'),
      help: cur ? tx('المساعد ده هيستخدم الموديل ده لما توافق على مخ خارجي.', 'This assistant will use this model when you agree to an outside AI.') : tx('السيستم بيختار الشركة والموديل زي كارت «مصادر الذكاء».', 'The system chooses the company and the model as the “Providers” card does.'),
      onChange: (v) => saveAgent(agent.id, { brain: v ? { provider: v.provider, model: v.model } : null }, v ? 'brain=' + v.provider + ':' + v.model : 'brain=auto', o.redraw,
        tx('اتحفظ — ', 'Saved — ') + (v ? R.CATALOG.text[v.provider].name + ' · ' + R.nameOf(v.model) : tx('تلقائي', 'Automatic'))) });
    const card = K.Section(tx('المخ الخارجي', 'Outside AI'), [h('div', { class: 'ag-brain', 'data-ag-brain': cur ? cur.provider + ':' + cur.model : 'auto', 'data-set-instant': '' }, h('span', { class: 'set-ic' }, Icon('zap')),
      h('div', { class: 'ag-brain-f' }, field), h('p', { class: 't-small sub ag-brain-n' }, tx('المساعد بيرد من السيستم الأول، ومابيستخدمش مخ خارجي غير بموافقتك على الرسالة.', 'The assistant answers from the system first, and uses an outside AI only with your consent on the message.')))],
      null, { sub: tx('أنهي شركة وموديل يرد لما السيستم مايفهمش وإنت توافق', 'Which company and model answers when the system doesn’t understand and you agree'), th: false, cols: false });
    return card;
  }

  // ---- the sources of one assistant
  function sourcesCard(agent, o) {
    const S0 = SET(); if (!S0 || !S0.section) return null;
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin); const list = sourcesOf(ai, agent.id); const own = Array.isArray(rowOf(ai, agent.id).sources);
    const save = (L, what, said) => saveAgent(agent.id, { sources: L }, what, o.redraw, said);
    const form = (it) => K.form({ title: it ? tx('تعديل المصدر', 'Edit the source') : tx('مصدر جديد', 'New source'), submitLabel: it ? tx('احفظ', 'Save') : tx('ضيف', 'Add'),
      values: { name: it ? it.name : '', url: it ? it.url : 'https://', note: it ? it.note : '' },
      fields: (f, e, set) => [K.field.text('name', tx('اسم المصدر', 'Source name'), f, e, set, { required: true, placeholder: tx('مثلًا: Meta Business Help Center', 'e.g. Meta Business Help Center') }),
        K.field.text('url', tx('اللينك', 'Link'), f, e, set, { required: true, help: tx('لازم يبدأ بـ https://', 'Must start with https://') }),
        K.field.text('note', tx('بيفيده في إيه', 'What it helps with'), f, e, set, { placeholder: tx('اختياري', 'Optional') })],
      validate: (f) => { const n = (f.name || '').trim(); if (!n) return { name: tx('اكتب اسم المصدر', 'Enter the source’s name') }; if (n.length > 60) return { name: tx('لحد 60 حرف', 'Up to 60 characters') };
        if (!cleanSource({ name: n, url: f.url, note: '' })) return { url: tx('لينك https صحيح', 'A valid https link') }; if (/[<>]/.test(f.note || '')) return { note: tx('من غير < أو >', 'Without < or >') };
        if (!it && list.length >= MAX) return { name: tx('لحد 20 مصدر للمساعد', 'Up to 20 sources an assistant') }; return {}; },
      submit: async (f, md) => { const v = cleanSource(f); const L = list.slice(); if (it) L[list.indexOf(it)] = v; else L.push(v); if (await save(L, 'sources=' + L.length, it ? tx('اتحفظ المصدر', 'Source saved') : tx('اتضاف المصدر', 'Source added'))) md.close(); } });
    const items = list.map((it) => h('li', { class: 'ag-src', 'data-ag-src': it.url },
      h('span', { class: 'ag-src-ic' }, Icon('link', 'sm')),
      h('div', { class: 'ag-src-t' }, h('b', null, h('bdi', null, it.name)), it.note ? h('small', null, it.note) : null,
        h('a', { class: 'ag-src-u', href: it.url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, hostOf(it.url))),
      admin ? K.RowMenu([{ label: tx('تعديل', 'Edit'), icon: 'edit', run: () => form(it) },
        { label: tx('امسح', 'Delete'), icon: 'trash', danger: true, run: () => K.confirm({ title: tx('تمسح «', 'Delete “') + it.name + tx('»؟', '”?'), okType: 'danger', okLabel: tx('امسح', 'Delete'), onOk: () => save(list.filter((x) => x !== it), 'sources=' + (list.length - 1), tx('اتمسح المصدر', 'Source deleted')) }) }], tx('إجراءات ', 'Actions for ') + it.name) : null));
    const acts = admin ? [own ? Button({ size: 'sm', icon: 'refresh', label: tx('رجّع الافتراضي', 'Back to the default'), attrs: { 'data-ag-src-reset': '' }, onClick: () => K.confirm({ title: tx('ترجّع مصادر «', 'Put the sources of “') + agent.name + tx('» الافتراضية؟', '” back to the default?'), text: tx('اللي ضفته أو عدّلته هنا هيتشال.', 'What you added or changed here goes.'), okLabel: tx('رجّع', 'Put back'), onOk: () => saveAgent(agent.id, { sources: null }, 'sources=default', o.redraw, tx('رجعت المصادر الافتراضية', 'The default sources are back')) }) }) : null,
      Button({ size: 'sm', type: 'primary', icon: 'plus', label: tx('مصدر جديد', 'New source'), attrs: { 'data-ag-src-add': '' }, onClick: () => form(null) })].filter(Boolean) : null;
    const card = K.Section(tx('المصادر', 'Sources'), [list.length ? h('ul', { class: 'ag-srcs', 'data-ag-srcs': agent.id }, items) : K.Empty(tx('لسه مفيش مصادر', 'No sources yet'), tx('ضيف المواقع اللي المساعد يعتمد عليها.', 'Add the sites the assistant should lean on.')),
      U.InlineNote({ children: tx('المصادر مراجع: محرّك السيستم مابيقراش مواقع، والمخ الخارجي — لما توافق عليه — بيدوّر فيها الأول.', 'Sources are references: the system’s own engine does not read sites, and an outside AI — once you agree to it — searches them first.') })],
      acts, { sub: tx('المواقع اللي المساعد بيعتمد عليها في تخصصه', 'The sites the assistant leans on in its speciality') + (list.length ? ' · ' + list.length : ''), th: false, cols: false });
    card.setAttribute('data-ag-sources', own ? 'own' : 'default');
    return card;
  }

  // ---- the rules that run by themselves (the owner 22 Nov — «السيستم لوحدوا يقدر يبعت تنبيهات … بناء علي القواعد … اللي مكاتبها لكل
  // مساعد»): a number the system counts from its own data against a limit; while it holds, the assistant's note sits in the bell
  // under «المساعدين». A rule never executes anything. The numbers and the metrics come from the server (notify `rules`).
  const RS = { data: null, loading: false, stale: false, off: false };
  const KIND = () => ({ alert: [tx('تنبيه', 'Alert'), 'orange'], problem: [tx('مشكلة', 'Problem'), 'error'], idea: [tx('اقتراح', 'Suggestion'), 'info'] });
  function rulesCard(agent, o) {
    const S0 = SET(); if (!S0 || !S0.agentRules || RS.off || !(S0.can && S0.can().admin)) return null;
    if ((!RS.data || RS.stale) && !RS.loading) { RS.loading = true; RS.stale = false;
      S0.agentRules().then((r) => { RS.loading = false; if (r && r.ok && r.data && r.data.agents) RS.data = r.data; else if (!RS.data) RS.off = true; if (typeof o.redraw === 'function') o.redraw(); }); }
    const title = tx('قواعد بتشتغل لوحدها', 'Rules that run by themselves'); const subText = tx('رقم من بيانات السيستم قصاد حد — لما يتحقق المساعد يبعتلك تنبيه أو اقتراح في الجرس', 'A number from the system’s data against a limit — while it holds, the assistant sends you an alert or a suggestion in the bell');
    if (!RS.data) { const c0 = K.Section(title, [U.InlineNote({ children: tx('بنحمّل القواعد…', 'Loading the rules…') })], null, { sub: subText, th: false, cols: false }); c0.setAttribute('data-ag-rules', 'loading'); return c0; }
    const st = RS.data.agents[agent.id] || { own: false, metrics: [], rules: [] }; const list = st.rules; const KD = KIND(); const metric = (k) => st.metrics.find((m) => m.key === k);
    const plain = (L) => L.map((r) => ({ id: r.id, metric: r.metric, op: r.op, value: r.value, kind: r.kind, on: r.on }));
    const save = async (L, what, said) => { const ok = await saveAgent(agent.id, { rules: L }, what, null, said); if (ok) { RS.stale = true; if (window.IBAlerts && window.IBAlerts.load) window.IBAlerts.load(); if (typeof o.redraw === 'function') o.redraw(); } return ok; };
    const form = (it) => { const m0 = it ? metric(it.metric) : (st.metrics.find((m) => !list.some((r) => r.metric === m.key)) || st.metrics[0]);
      return K.form({ title: it ? tx('تعديل القاعدة', 'Edit the rule') : tx('قاعدة جديدة', 'New rule'), submitLabel: it ? tx('احفظ', 'Save') : tx('ضيف', 'Add'),
        values: { metric: m0.key, op: it ? it.op : m0.op, value: String(it ? it.value : m0.value), kind: it ? it.kind : m0.kind },
        fields: (f, e, set) => { const m = metric(f.metric) || m0;
          return [K.field.select('metric', tx('السيستم يراقب', 'The system watches'), st.metrics.map((x) => ({ value: x.key, label: x.label })), f, e, set, { required: true, help: m.nowText === null ? tx('لسه ماتقراش', 'Not read yet') : tx('دلوقتي: ', 'Now: ') + m.nowText }),
            h('div', { class: 'row cols2' }, K.field.select('op', tx('الشرط', 'The condition'), [{ value: 'gte', label: tx('يوصل للحد أو أكتر', 'Reaches the limit or more') }, { value: 'lte', label: tx('ينزل للحد أو أقل', 'Drops to the limit or less') }], f, e, set, { required: true }),
              K.field.text('value', tx('الحد', 'The limit') + (m.unit ? ' (' + m.unit + ')' : ''), f, e, set, { required: true, inputmode: 'numeric' })),
            K.field.select('kind', tx('المساعد يبعت', 'The assistant sends'), ['alert', 'problem', 'idea'].map((k) => ({ value: k, label: KD[k][0] })), f, e, set, { required: true })]; },
        validate: (f) => { const v = String(f.value || '').trim(); if (!/^\d{1,7}$/.test(v) || Number(v) > 1000000) return { value: tx('رقم صحيح من 0 لـ 1,000,000', 'A whole number from 0 to 1,000,000') };
          if (!it && list.length >= 12) return { metric: tx('لحد 12 قاعدة للمساعد', 'Up to 12 rules an assistant') }; return {}; },
        submit: async (f, md) => { const v = { id: it ? it.id : 'r' + Date.now().toString(36), metric: f.metric, op: f.op === 'lte' ? 'lte' : 'gte', value: Number(String(f.value).trim()), kind: KD[f.kind] ? f.kind : 'alert', on: it ? it.on : true };
          const L = plain(list); if (it) L[list.indexOf(it)] = v; else L.push(v); if (await save(L, 'rules=' + L.length, it ? tx('اتحفظت القاعدة', 'Rule saved') : tx('اتضافت القاعدة', 'Rule added'))) md.close(); } }); };
    const toggle = (it) => { const L = plain(list); L[list.indexOf(it)].on = !it.on; return save(L, 'rule ' + (it.on ? 'off' : 'on'), it.on ? tx('القاعدة اتوقفت', 'The rule is off') : tx('القاعدة اشتغلت', 'The rule is on')); };
    const state = (r) => (!r.on ? K.Tag('neutral', tx('موقوفة', 'Off')) : r.now === null ? K.Tag('neutral', tx('لسه ماتقراش', 'Not read yet')) : r.firing ? K.Tag(KD[r.kind][1], tx('متحققة — في الجرس', 'Holds — in the bell')) : K.Tag('success', tx('تمام', 'Fine')));
    const items = list.map((r) => h('li', { class: 'ag-rule' + (r.on ? '' : ' off'), 'data-ag-rule': r.id, 'data-firing': r.firing ? 'yes' : 'no', 'data-on': String(!!r.on) },
      h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(!!r.on), 'aria-label': r.text, 'data-ag-rule-sw': '', onClick: () => toggle(r) }, h('i')),
      h('div', { class: 'ag-rule-t' }, h('b', null, r.text), h('small', null, tx('دلوقتي: ', 'Now: '), h('bdi', { 'data-ag-rule-now': '' }, r.nowText === null ? '—' : r.nowText), ' · ', tx('بيبعت ', 'Sends: '), KD[r.kind][0])),
      h('span', { class: 'ag-rule-s' }, state(r)),
      K.RowMenu([{ label: tx('تعديل', 'Edit'), icon: 'edit', run: () => form(r) },
        { label: tx('امسح', 'Delete'), icon: 'trash', danger: true, run: () => K.confirm({ title: tx('تمسح القاعدة دي؟', 'Delete this rule?'), text: r.text, okType: 'danger', okLabel: tx('امسح', 'Delete'), onOk: () => save(plain(list.filter((x) => x !== r)), 'rules=' + (list.length - 1), tx('اتمسحت القاعدة', 'Rule deleted')) }) }], tx('إجراءات القاعدة', 'Rule actions'))));
    const acts = [st.own ? Button({ size: 'sm', icon: 'refresh', label: tx('رجّع الافتراضي', 'Back to the default'), attrs: { 'data-ag-rule-reset': '' }, onClick: () => K.confirm({ title: tx('ترجّع قواعد «', 'Put the rules of “') + agent.name + tx('» الافتراضية؟', '” back to the default?'), text: tx('اللي ضفته أو عدّلته هنا هيتشال.', 'What you added or changed here goes.'), okLabel: tx('رجّع', 'Put back'), onOk: () => save(null, 'rules=default', tx('رجعت القواعد الافتراضية', 'The default rules are back')) }) }) : null,
      st.metrics.length ? Button({ size: 'sm', type: 'primary', icon: 'plus', label: tx('قاعدة جديدة', 'New rule'), attrs: { 'data-ag-rule-add': '' }, onClick: () => form(null) }) : null].filter(Boolean);
    const firing = list.filter((r) => r.firing).length;
    const body = !st.metrics.length ? K.Empty(tx('مفيش أرقام للمساعد ده يراقبها لسه', 'No numbers for this assistant to watch yet'), tx('القواعد بتشتغل على البيانات اللي المساعد بيقراها.', 'Rules run on the data the assistant reads.'))
      : list.length ? h('ul', { class: 'ag-rules', 'data-ag-rules-list': agent.id, 'data-set-instant': '' }, items) : K.Empty(tx('لسه مفيش قواعد', 'No rules yet'), tx('ضيف قاعدة عشان المساعد ينبّهك لوحده.', 'Add a rule so the assistant alerts you by itself.'));
    const card = K.Section(title, [body, U.InlineNote({ children: tx('الأرقام من بيانات السيستم نفسها، والتنبيه بيفضل في الجرس تحت «المساعدين» طول ما القاعدة متحققة. القاعدة مابتنفّذش حاجة — القرار ليك.', 'The numbers come from the system’s own data, and the alert stays in the bell under “Assistants” while the rule holds. A rule executes nothing — the decision is yours.') })],
      acts, { sub: subText + (list.length ? ' · ' + firing + tx(' متحققة دلوقتي', ' holding now') : ''), th: false, cols: false });
    card.setAttribute('data-ag-rules', st.own ? 'own' : 'default'); card.setAttribute('data-set-instant', '');
    return card;
  }

  window.IBAgentsSet = { tabs, brainCard, rulesCard, sourcesCard, sourcesOf, brainOf, shipped };
})();
