// «أنهي موديل لأنهي أمر» (the owner 22 Nov — docs/superpowers/plans/2026-11-22-model-routing.md: «يبقا مكتوب في التعليمات احسن طريقة
// تخليني استخدم الكريديت صح يعني امتا يستخدم كل موديل و في اي امر بيناء علي احدث الموديلز»). Not a block. The card of «الإعدادات ›
// الذكاء الاصطناعي › المزوّدين» for Claude: the three levels with their model and price and what each is for, every command with its
// level (the admin moves one, or goes back to one model for everything) and this month's spend by model and by kind of work.
//   IBAIRouting.sections({ redraw })   the cards (block 17 puts them under the providers)
//   IBAIRouting.routeOf(aiRow, command) the level a command runs on now (as the server's _shared/ai-routing.js — a test keeps
//                                       the two tables in step)
// The server routes by itself with no row: the card only shows it, and writes what the admin changes (IBSettings.save «ai»).
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Button } = U;
  const SET = () => window.IBSettings; const AI = () => window.IBAI;

  const LIST_DATE = '2026-11-03'; // Anthropic's list and prices the table below was written on
  const TIERS = ['light', 'mid', 'heavy'];
  // usd = [input, output] per million tokens
  const TIER = {
    light: { model: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', label: 'خفيف', usd: [0.1, 0.5],
      when: 'للأوامر الميكانيكية: إجابة قصيرة ومحددة من حاجة قدامه — فلتر، ترجمة، إعادة صياغة، ترتيب. بيشتغل بأقل جهد.' },
    mid: { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', label: 'متوسط', usd: [2, 10],
      when: 'للكتابة بصوت البراند من بيانات المنتج أو بريف الكامبين، ولشات المساعدين اليومي.' },
    heavy: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5', label: 'تقيل', usd: [4, 20],
      when: 'للشغل اللي فيه كذا خطوة بأدوات، وقراية سكرين شوتس لشيت، والأرقام اللي بيتبني عليها قرار فلوس.' },
  };
  // the commands in the server's order; min = the lowest level a command can run on
  const COMMANDS = {
    filter: { tier: 'light', label: 'فلتر الأوردرات بالكلام', why: 'بيحوّل جملة لشروط فلتر — إجابة واحدة محددة.' },
    rewrite: { tier: 'light', label: 'إعادة الصياغة', why: 'اسم أو وصف أو كابشن موجود بيتكتب أحسن — نفس المعلومات.' },
    translate: { tier: 'light', label: 'الترجمة للإنجليزي', why: 'اسم المنتج ووصفه من العربي للإنجليزي.' },
    kb: { tier: 'light', label: 'إعادة كتابة قاعدة أو سكيل', why: 'ترتيب نص قاعدة في الإعدادات.' },
    write: { tier: 'mid', label: 'وصف المنتج و SEO', why: 'الاسم والوصف والعناوين بصوت البراند.' },
    studio: { tier: 'mid', label: 'بيانات المنتج في الاستوديو', why: 'الاسم والقسم واللون والخامة من الصورة والداتا.' },
    prompts: { tier: 'mid', label: 'برومبتات صور الفئة', why: 'برومبتات اللقطات لفئة منتجات جديدة.' },
    marketing: { tier: 'mid', label: 'كتابة قطع الكامبين', why: 'الفكرة والكابشن والبادج لكل قطعة، ووصف القوالب.' },
    scenes: { tier: 'mid', label: 'مشاهد الفيديو', why: 'المشاهد والنص على الشاشة ونص الفويس.' },
    agent: { tier: 'mid', label: 'شات المساعدين', why: 'المصمم والمبرمج والتشغيل وخدمة العملاء وباقي المساعدين.' },
    assistant: { tier: 'heavy', label: 'المدير (المساعد في الهيدر)', why: 'بيقرا بيانات السيستم بأدوات على كذا خطوة ويجهّز البوب أبات.' },
    extract: { tier: 'heavy', label: 'استخراج شيت من الواتساب', why: 'قراية سكرين شوتس وتحويلها لصفوف منتجات.' },
    buyer: { tier: 'heavy', label: 'الميديا باير', why: 'تحليل أرقام الإعلانات واقتراحات الميزانية.' },
    research: { tier: 'heavy', min: 'mid', label: 'البحث على الويب والتريندات', why: 'بحث بمصادر ومقارنتها — البحث مش متاح على الموديل الخفيف.' },
  };
  const KEYS = Object.keys(COMMANDS);
  // this month's runs by kind of work: what ai_runs stores (action + source), in the member's words
  const WORK = [
    ['write', 'وصف المنتج', (r) => r.action === 'write'],
    ['studio', 'استوديو المنتجات', (r) => r.action === 'studio'],
    ['assistant', 'المدير (الهيدر)', (r) => r.action === 'assistant' && r.source !== 'filter'],
    ['filter', 'فلتر الأوردرات', (r) => r.action === 'assistant' && r.source === 'filter'],
    ['marketing', 'كتابة التسويق', (r) => r.action === 'marketing' && ['campaign', 'post', 'template'].includes(r.source)],
    ['agent', 'شات المساعدين', (r) => r.action === 'marketing' && r.source === 'agent'],
    ['buyer', 'الميديا باير', (r) => r.action === 'marketing' && r.source === 'buyer'],
    ['research', 'البحث والتريندات', (r) => r.action === 'marketing' && ['research', 'trends'].includes(r.source)],
  ];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const rank = (t) => TIERS.indexOf(t);
  const tierFor = (command, asked) => { const c = COMMANDS[command]; if (!c) return 'mid'; const t = TIERS.includes(asked) ? asked : c.tier; return c.min && rank(t) < rank(c.min) ? c.min : t; };
  // the row «ai» → { mode, tiers } — only what differs from the recommendation (the server's routingOf)
  function routingOf(aiRow) {
    const r = isObj(aiRow) && isObj(aiRow.routing) ? aiRow.routing : {}; const tiers = {};
    if (isObj(r.tiers)) for (const k of KEYS) { const t = typeof r.tiers[k] === 'string' ? r.tiers[k].trim() : ''; if (TIERS.includes(t) && tierFor(k, t) === t && t !== COMMANDS[k].tier) tiers[k] = t; }
    return { mode: typeof r.mode === 'string' && r.mode.trim() === 'single' ? 'single' : 'auto', tiers };
  }
  /** The level and model a command runs on now; in «موديل واحد للكل» the admin's model (tier null). */
  function routeOf(aiRow, command) {
    const r = routingOf(aiRow); const one = isObj(aiRow) && typeof aiRow.model === 'string' && aiRow.model ? aiRow.model : TIER.heavy.model;
    if (r.mode === 'single' || !COMMANDS[command]) return { tier: null, model: one };
    const tier = tierFor(command, r.tiers[command]); return { tier, model: TIER[tier].model };
  }

  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 2 : 0, maximumFractionDigits: 2 });
  const ltr = (text) => h('bdi', { dir: 'ltr' }, text); // a price or a date keeps its order inside the Arabic line
  const price = (t) => [ltr(usd(TIER[t].usd[0])), ' دخل · ', ltr(usd(TIER[t].usd[1])), ' خرج (لكل مليون توكن)'];
  const money = (n) => '$' + (Math.round(Number(n) * 1000) / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const modelName = (id) => { const t = TIERS.find((x) => id === TIER[x].model || String(id).startsWith(TIER[x].model + '-')); return t ? TIER[t].name : String(id || '—'); };

  // ---- this month's spend (the admin reads every member's runs; loaded once per visit, again with «حدّث»)
  let spend = null; let spendAt = 0; let loading = false;
  function loadSpend(redraw, force) {
    if (loading || (!force && spend && Date.now() - spendAt < 120000)) return;
    const A = AI(); if (!A || !A.spendBreakdown) return;
    loading = true;
    Promise.resolve(A.spendBreakdown()).then((r) => { spend = r && r.ok ? r : { ok: false }; spendAt = Date.now(); }).catch(() => { spend = { ok: false }; spendAt = Date.now(); })
      .then(() => { loading = false; if (typeof redraw === 'function' && document.querySelector('[data-ai-routing]')) redraw(); });
  }
  function spendSec(redraw) {
    loadSpend(redraw, false);
    const head = [Button({ size: 'sm', label: 'حدّث', icon: 'refresh', onClick: () => { loadSpend(redraw, true); } })];
    let body;
    if (!spend) body = [U.InlineNote({ children: 'بنحمّل صرف الشهر…' })];
    else if (!spend.ok) body = [U.InlineNote({ kind: 'error', children: 'تعذّر تحميل الصرف — جرّب «حدّث».' })];
    else if (!spend.runs) body = [U.InlineNote({ children: 'مفيش نداءات للذكاء الاصطناعي الشهر ده لسه.' })];
    else {
      const share = (c) => (spend.total > 0 ? Math.round((c / spend.total) * 100) + '%' : '—');
      const byModel = spend.byModel.map((m) => [modelName(m.model), String(m.runs), money(m.cost), share(m.cost)]);
      const byWork = WORK.map(([key, label, is]) => { const L = spend.rows.filter(is); return { key, label, runs: L.length, cost: L.reduce((t, r) => t + r.cost, 0) }; }).filter((w) => w.runs);
      const rest = spend.rows.filter((r) => !WORK.some(([, , is]) => is(r)));
      if (rest.length) byWork.push({ key: 'other', label: 'حاجات تانية', runs: rest.length, cost: rest.reduce((t, r) => t + r.cost, 0) });
      byWork.sort((a, b) => b.cost - a.cost);
      body = [h('div', { class: 'air-spend', 'data-air-spend': '' },
        h('div', null, h('h3', { class: 't-h6' }, 'بالموديل'), U.Table({ cls: 'mini-table', headers: ['الموديل', 'النداءات', 'الصرف', 'من الإجمالي'], rows: byModel })),
        h('div', null, h('h3', { class: 't-h6' }, 'بنوع الشغل'), U.Table({ cls: 'mini-table', headers: ['الشغل', 'النداءات', 'الصرف', 'من الإجمالي'], rows: byWork.map((w) => [w.label, String(w.runs), money(w.cost), share(w.cost)]) }))),
      h('p', { class: 't-small sub' }, 'الإجمالي ' + money(spend.total) + ' في ' + spend.runs + ' نداء — صرف النصوص بس (الصور بالكريدت لوحدها).')];
    }
    return K.Section('صرف الشهر ده على الذكاء الاصطناعي', body, head, { sub: 'عشان تشوف الكريدت بيروح فين: بالموديل وبنوع الشغل', th: false, cols: false });
  }

  // ---- the routing card
  function sections(opts) {
    const redraw = opts && opts.redraw; const S0 = SET(); if (!S0 || !S0.section) return [];
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin);
    const P = isObj(ai.providers) && isObj(ai.providers.text) ? ai.providers.text : {};
    const onClaude = (P.default || 'claude') === 'claude' || Object.values(isObj(P.tools) ? P.tools : {}).includes('claude');
    const r = routingOf(ai);
    const save = async (next, what) => {
      const clean = routingOf({ routing: next }); const plain = clean.mode === 'auto' && !Object.keys(clean.tiers).length;
      const res = await S0.save('ai', { routing: plain ? null : clean }); // null: the key leaves the row — the server routes by itself
      if (!res || !res.ok) { K.toast((res && res.message) || 'تعذّر الحفظ — جرّب تاني', 'error'); return; }
      if (K.logEvent) K.logEvent('settings.ai.routing', what); // the command and its level only
      K.toast('اتحفظ — هيتطبق من أول أمر جاي', 'success'); if (typeof redraw === 'function') redraw();
    };
    const guide = h('div', { class: 'air-tiers', 'data-air-tiers': '' }, TIERS.map((t) => h('div', { class: 'air-tier', 'data-air-tier': t },
      h('div', { class: 'air-tier-h' }, h('b', null, TIER[t].label), h('span', { class: 't-small' }, TIER[t].name)),
      h('div', { class: 'air-price t-small' }, price(t)),
      h('p', { class: 't-small' }, TIER[t].when))));
    const mode = K.Radios({ label: 'طريقة التشغيل', name: 'air-mode', value: r.mode, options: [{ value: 'auto', label: 'تلقائي — كل أمر على موديل مستواه' }, { value: 'single', label: 'موديل واحد للكل' }],
      onChange: (v) => { if (!admin || v === r.mode) return; save({ mode: v, tiers: r.tiers }, v === 'single' ? 'one model' : 'auto'); } });
    const one = (AI() && AI().MODELS) || [];
    const single = r.mode === 'single' ? U.Select({ id: 'air-one', label: 'الموديل', disabled: !admin, options: one.map((m) => ({ value: m.id, label: m.label })), value: one.some((m) => m.id === ai.model) ? ai.model : (one[0] && one[0].id),
      onChange: async (v) => { const res = await S0.save('ai', { model: v }); if (!res || !res.ok) return K.toast((res && res.message) || 'تعذّر الحفظ — جرّب تاني', 'error'); K.toast('اتحفظ', 'success'); if (typeof redraw === 'function') redraw(); } }) : null;
    const rows = KEYS.map((k) => {
      const c = COMMANDS[k]; const cur = tierFor(k, r.tiers[k]); const moved = cur !== c.tier;
      const pick = U.Select({ id: 'air-' + k, label: c.label, disabled: !admin || r.mode === 'single',
        options: TIERS.filter((t) => !c.min || rank(t) >= rank(c.min)).map((t) => ({ value: t, label: TIER[t].label + ' — ' + TIER[t].name + (t === c.tier ? ' (الترشيح)' : '') })), value: cur,
        onChange: (v) => { if (v === cur) return; const tiers = Object.assign({}, r.tiers); if (v === c.tier) delete tiers[k]; else tiers[k] = v; save({ mode: r.mode, tiers }, k + '=' + v); } });
      return h('div', { class: 'air-row' + (moved ? ' moved' : ''), 'data-air-cmd': k, 'data-air-tier': cur }, pick, h('p', { class: 't-small sub' }, c.why + (moved ? ' — الترشيح: ' + TIER[c.tier].label + '.' : '')));
    });
    const changed = Object.keys(r.tiers).length;
    const acts = admin && r.mode === 'auto' && changed ? [Button({ type: 'text', label: 'رجّع الترشيح', onClick: () => K.confirm({ title: 'ترجّع توزيع الموديلات للترشيح؟', text: changed + ' أمر هيرجع لمستواه المرشّح.', okLabel: 'رجّع', onOk: () => save({ mode: 'auto', tiers: {} }, 'recommended') }) })] : null;
    const notes = [
      !onClaude ? U.InlineNote({ kind: 'warning', children: 'المحتوى دلوقتي مش على Claude — التوزيع ده بيشتغل على الأدوات اللي مزوّدها Claude بس.' }) : null,
      r.mode === 'single' ? U.InlineNote({ children: 'كل الأوامر شغّالة على موديل واحد — البسيط بيتحاسب زي التقيل. ارجع لـ «تلقائي» عشان كل أمر ياخد موديل مستواه.' })
        : U.InlineNote({ children: 'السيستم بيختار الموديل لوحده حسب الأمر: المتوسط بنص سعر التقيل، والخفيف أرخص من المتوسط 20 مرة. غيّر مستوى أي أمر لو جودته محتاجة أعلى أو صرفه أكتر من اللازم.' }),
    ];
    const card = K.Section('أنهي موديل لأنهي أمر (Claude)', [guide, ...notes, mode, single, h('div', { class: 'air-rows' + (r.mode === 'single' ? ' off' : '') }, rows),
      h('p', { class: 't-small sub' }, 'الموديلات والأسعار دي قايمة Anthropic بتاريخ ', ltr(LIST_DATE), ' — لو نزل موديل جديد أو اتغيّر سعر، «المبرمج الذكي» هيبعت تنبيه في الجرس عشان السيستم يتحدّث.')],
      acts, { sub: 'أحسن طريقة لاستخدام الكريدت: كل أمر على أرخص موديل يعمله صح', th: false, cols: false });
    card.setAttribute('data-ai-routing', r.mode);
    return [card, admin ? spendSec(redraw) : null].filter(Boolean);
  }

  window.IBAIRouting = { LIST_DATE, TIERS, TIER, COMMANDS, WORK, routingOf, routeOf, tierFor, sections };
})();
