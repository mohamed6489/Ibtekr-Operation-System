// «أنهي موديل لأنهي أمر» (the owner 22 Nov — docs/superpowers/plans/2026-11-22-model-routing.md: «يبقا مكتوب في التعليمات احسن طريقة
// تخليني استخدم الكريديت صح يعني امتا يستخدم كل موديل و في اي امر بيناء علي احدث الموديلز»). Not a block. The card of «الإعدادات ›
// الذكاء الاصطناعي › المزوّدين» for Claude: the three levels with their model and price and what each is for, every command with its
// level (the admin moves one, or goes back to one model for everything) and this month's spend by model and by kind of work.
//   IBAIRouting.sections({ redraw })   the cards (block 17 puts them under the providers)
//   IBAIRouting.picker({ redraw, provider }) under the text company in the providers card (the owner 22 Nov, decisions 8–12 —
//                                       «لو تلقائي بختار الشركة بس … لو مقفول بختار الشركة و بعديها تظهرلي خانة اختار منها الموديل»): the
//                                       switch «اختيار الموديل تلقائي حسب الطلب», the company's three levels while it is on, the
//                                       model select while it is off
//   IBAIRouting.routeOf(aiRow, command, provider) the level a command runs on now (as the server's _shared/ai-routing.js — a
//                                       test keeps the two tables in step)
// The server routes by itself with no row: the card only shows it, and writes what the admin changes (IBSettings.save «ai»).
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Button } = U;
  const SET = () => window.IBSettings; const AI = () => window.IBAI;

  const LIST_DATE = '2026-11-03'; // Anthropic's list and prices the table below was written on
  const TIERS = ['light', 'mid', 'heavy'];
  // usd = [input, output] per million tokens. The owner's words for the levels: ضعيف · متوسط · قوي
  const TIER = {
    light: { model: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', label: 'ضعيف', usd: [0.1, 0.5],
      when: 'للأوامر الميكانيكية: إجابة قصيرة ومحددة من حاجة قدامه — فلتر، ترجمة، إعادة صياغة، ترتيب. بيشتغل بأقل جهد.' },
    mid: { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', label: 'متوسط', usd: [2, 10],
      when: 'للكتابة بصوت البراند من بيانات المنتج أو بريف الكامبين، ولشات المساعدين اليومي.' },
    heavy: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5', label: 'قوي', usd: [4, 20],
      when: 'للشغل اللي فيه كذا خطوة بأدوات، وقراية سكرين شوتس لشيت، والأرقام اللي بيتبني عليها قرار فلوس.' },
  };
  // every text company's levels (the server's PROVIDER_TIERS) and its models' names and prices (PRICES of ai-content.js)
  const PROVIDERS = {
    claude: { name: 'Claude', tiers: { light: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5', heavy: 'claude-opus-5-5' } },
    openai: { name: 'ChatGPT', tiers: { light: 'gpt-5.2-mini', mid: 'gpt-5.2', heavy: 'gpt-5.2' } },
    gemini: { name: 'Gemini', tiers: { light: 'gemini-3-flash', mid: 'gemini-3-pro', heavy: 'gemini-3-pro' } },
  };
  const MODEL = {
    'claude-haiku-5-5': { name: 'Claude Haiku 5.5', usd: [0.1, 0.5] }, 'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', usd: [2, 10] }, 'claude-opus-5-5': { name: 'Claude Opus 5.5', usd: [4, 20] },
    'gpt-5.2-mini': { name: 'GPT-5.2 mini', usd: [0.25, 2] }, 'gpt-5.2': { name: 'GPT-5.2', usd: [1.25, 10] },
    'gemini-3-flash': { name: 'Gemini 3 Flash', usd: [0.3, 2.5] }, 'gemini-3-pro': { name: 'Gemini 3 Pro', usd: [2, 12] },
  };
  const provOf = (p) => (PROVIDERS[p] ? p : 'claude');
  // a company's models, the strongest first (the order the «الموديل» select lists them in)
  const modelsOf = (p) => { const T = PROVIDERS[provOf(p)].tiers; return [T.heavy, T.mid, T.light].filter((m, i, a) => a.indexOf(m) === i); };
  const levelsOfModel = (p, m) => TIERS.filter((t) => PROVIDERS[provOf(p)].tiers[t] === m).map((t) => TIER[t].label).join(' و');
  // the free chats: their level is read from the message itself (the server's SIZED) unless the admin gave one
  const SIZED = ['assistant', 'agent'];
  // what runs on Claude whatever the text company is (the tool loop, the screenshots, the web search)
  const CLAUDE_ONLY = ['assistant', 'extract', 'research'];
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
    research: { tier: 'heavy', min: 'mid', label: 'البحث على الويب والتريندات', why: 'بحث بمصادر ومقارنتها — البحث مش متاح على الموديل الضعيف.' },
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
  // the row «ai» → { mode, tiers } — only what differs from the recommendation (the server's routingOf); a free chat keeps any
  // level the admin gave it (its recommendation is «by the message»)
  function routingOf(aiRow) {
    const r = isObj(aiRow) && isObj(aiRow.routing) ? aiRow.routing : {}; const tiers = {};
    if (isObj(r.tiers)) for (const k of KEYS) { const t = typeof r.tiers[k] === 'string' ? r.tiers[k].trim() : ''; if (TIERS.includes(t) && tierFor(k, t) === t && (t !== COMMANDS[k].tier || SIZED.includes(k))) tiers[k] = t; }
    return { mode: typeof r.mode === 'string' && r.mode.trim() === 'single' ? 'single' : 'auto', tiers };
  }
  const textRow = (aiRow) => (isObj(aiRow) && isObj(aiRow.providers) && isObj(aiRow.providers.text) ? aiRow.providers.text : {});
  /** The text company of the section (the default one). */
  const companyOf = (aiRow) => provOf(textRow(aiRow).default);
  /** The admin's one model of a company (the server's default when the row names none). */
  function oneModel(aiRow, provider) {
    const p = provOf(provider); const list = modelsOf(p); const T = textRow(aiRow);
    const m = p === 'claude' ? (isObj(aiRow) && typeof aiRow.model === 'string' ? aiRow.model : '') : (isObj(T.models) && typeof T.models[p] === 'string' ? T.models[p] : '');
    return list.includes(m) ? m : list[0];
  }
  /** The level and model a command runs on now on a company; with the routing off the admin's model (tier null). */
  function routeOf(aiRow, command, provider) {
    const p = provOf(provider); const r = routingOf(aiRow); const c = COMMANDS[command]; const T = PROVIDERS[p].tiers;
    if (r.mode === 'single' || !c) {
      const one = oneModel(aiRow, p);
      return { tier: null, model: c && c.min && p === 'claude' && one === T.light ? T[c.min] : one }; // the web search is not on Claude's light model
    }
    const tier = tierFor(command, r.tiers[command]); return { tier, model: T[tier] };
  }
  /** Whether a command's level is read from the message (the server's sizes()). */
  const sizes = (aiRow, command) => { const r = routingOf(aiRow); return r.mode === 'auto' && SIZED.includes(command) && !r.tiers[command]; };

  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 2 : 0, maximumFractionDigits: 2 });
  const ltr = (text) => h('bdi', { dir: 'ltr' }, text); // a price or a date keeps its order inside the Arabic line
  const price = (m) => [ltr(usd(MODEL[m].usd[0])), ' دخل · ', ltr(usd(MODEL[m].usd[1])), ' خرج (لكل مليون توكن)'];
  const money = (n) => '$' + (Math.round(Number(n) * 1000) / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const modelName = (id) => { const k = Object.keys(MODEL).filter((m) => id === m || String(id).startsWith(m + '-')).sort((a, b) => b.length - a.length)[0]; return k ? MODEL[k].name : String(id || '—'); };

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

  // ---- saving
  async function saveRouting(S0, next, what, redraw) {
    const clean = routingOf({ routing: next }); const plain = clean.mode === 'auto' && !Object.keys(clean.tiers).length;
    const res = await S0.save('ai', { routing: plain ? null : clean }); // null: the key leaves the row — the server routes by itself
    if (!res || !res.ok) { K.toast((res && res.message) || 'تعذّر الحفظ — جرّب تاني', 'error'); return; }
    if (K.logEvent) K.logEvent('settings.ai.routing', what); // the command and its level only
    K.toast('اتحفظ — هيتطبق من أول أمر جاي', 'success'); if (typeof redraw === 'function') redraw();
  }
  // the admin's one model of a company: Claude's is the row's `model`, the others' their company's entry under providers.text.models
  async function saveModel(S0, ai, provider, model, redraw) {
    let patch;
    if (provider === 'claude') patch = { model };
    else { const P = isObj(ai.providers) ? JSON.parse(JSON.stringify(ai.providers)) : {}; P.text = isObj(P.text) ? P.text : {}; P.text.models = Object.assign({}, isObj(P.text.models) ? P.text.models : {}, { [provider]: model }); patch = { providers: P }; }
    const res = await S0.save('ai', patch);
    if (!res || !res.ok) { K.toast((res && res.message) || 'تعذّر الحفظ — جرّب تاني', 'error'); return; }
    if (K.logEvent) K.logEvent('settings.ai.routing', 'model=' + model);
    K.toast('اتحفظ — كل الأوامر على ' + MODEL[model].name, 'success'); if (typeof redraw === 'function') redraw();
  }

  // ---- under the text company in the providers card: the switch, then the levels (on) or the model (off)
  function picker(opts) {
    const redraw = opts && opts.redraw; const S0 = SET(); if (!S0 || !S0.section) return null;
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin);
    const prov = provOf(opts && opts.provider); const P = PROVIDERS[prov]; const r = routingOf(ai); const auto = r.mode === 'auto';
    const sw = K.Switch({ id: 'air-auto', label: 'اختيار الموديل تلقائي حسب الطلب', checked: auto, disabled: !admin,
      help: auto ? 'السيستم بيحدد حجم كل طلب الأول ويشغّله على موديل مستواه من ' + P.name + '.' : 'مقفول — كل الأوامر على الموديل اللي تختاره تحت.',
      onChange: (v) => { if (!admin) return; saveRouting(S0, { mode: v ? 'auto' : 'single', tiers: r.tiers }, v ? 'auto' : 'one model', redraw); } });
    const levels = auto ? h('div', { class: 'air-levels', 'data-air-levels': prov }, TIERS.map((t) => h('span', { class: 'air-level', 'data-air-level': t }, h('b', null, TIER[t].label), ' ', ltr(MODEL[P.tiers[t]].name)))) : null;
    const list = modelsOf(prov); const cur = oneModel(ai, prov);
    const one = auto ? null : U.Select({ id: 'air-one', label: 'الموديل', disabled: !admin, value: cur,
      help: 'موديلات ' + P.name + ' — البسيط والتقيل هيتحاسبوا بسعره.',
      options: list.map((m) => ({ value: m, label: MODEL[m].name + ' — ' + levelsOfModel(prov, m) })),
      onChange: (v) => { if (v !== cur) saveModel(S0, ai, prov, v, redraw); } });
    return h('div', { class: 'air-pick', 'data-air-pick': auto ? 'auto' : 'single', 'data-air-provider': prov }, sw, levels, one);
  }

  // ---- the routing card
  function sections(opts) {
    const redraw = opts && opts.redraw; const S0 = SET(); if (!S0 || !S0.section) return [];
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin);
    const prov = companyOf(ai); const P = PROVIDERS[prov];
    const r = routingOf(ai); const auto = r.mode === 'auto';
    const save = (next, what) => saveRouting(S0, next, what, redraw);
    const guide = h('div', { class: 'air-tiers', 'data-air-tiers': prov }, TIERS.map((t) => h('div', { class: 'air-tier', 'data-air-tier': t },
      h('div', { class: 'air-tier-h' }, h('b', null, TIER[t].label), h('span', { class: 't-small' }, ltr(MODEL[P.tiers[t]].name))),
      h('div', { class: 'air-price t-small' }, price(P.tiers[t])),
      h('p', { class: 't-small' }, TIER[t].when))));
    const rows = KEYS.map((k) => {
      const c = COMMANDS[k]; const own = r.tiers[k]; const sized = SIZED.includes(k); const bySize = sized && !own;
      const cur = tierFor(k, own); const moved = sized ? !!own : cur !== c.tier;
      const T = PROVIDERS[CLAUDE_ONLY.includes(k) ? 'claude' : prov].tiers;
      const levels = TIERS.filter((t) => !c.min || rank(t) >= rank(c.min)).map((t) => ({ value: t, label: TIER[t].label + ' — ' + MODEL[T[t]].name + (!sized && t === c.tier ? ' (الترشيح)' : '') }));
      const pick = U.Select({ id: 'air-' + k, label: c.label, disabled: !admin || !auto,
        options: sized ? [{ value: 'size', label: 'حسب حجم الرسالة (الترشيح)' }].concat(levels) : levels, value: bySize ? 'size' : cur,
        onChange: (v) => { if (v === (bySize ? 'size' : cur)) return; const tiers = Object.assign({}, r.tiers); if (v === 'size' || (!sized && v === c.tier)) delete tiers[k]; else tiers[k] = v; save({ mode: r.mode, tiers }, k + '=' + v); } });
      const tail = (bySize || moved || (prov !== 'claude' && CLAUDE_ONLY.includes(k))); // more follows after a dash: the sentence's own stop goes
      const why = (tail ? c.why.replace(/\.$/, '') : c.why) + (bySize ? ' — الموديل الضعيف بيقرا الرسالة الأول ويحدد مستواها.' : '') + (moved ? ' — الترشيح: ' + (sized ? 'حسب حجم الرسالة' : TIER[c.tier].label) + '.' : '')
        + (prov !== 'claude' && CLAUDE_ONLY.includes(k) ? ' — بيشتغل على Claude دايمًا.' : '');
      return h('div', { class: 'air-row' + (moved ? ' moved' : ''), 'data-air-cmd': k, 'data-air-tier': cur, 'data-air-sized': bySize ? 'true' : null }, pick, h('p', { class: 't-small sub' }, why));
    });
    const changed = Object.keys(r.tiers).length;
    const acts = admin && auto && changed ? [Button({ type: 'text', label: 'رجّع الترشيح', onClick: () => K.confirm({ title: 'ترجّع توزيع الموديلات للترشيح؟', text: changed + ' أمر هيرجع لمستواه المرشّح.', okLabel: 'رجّع', onOk: () => save({ mode: 'auto', tiers: {} }, 'recommended') }) })] : null;
    const notes = [
      !auto ? U.InlineNote({ children: '«اختيار الموديل تلقائي» مقفول — كل الأوامر شغّالة على ' + MODEL[oneModel(ai, prov)].name + '، والبسيط بيتحاسب زي التقيل. شغّله من كارت المزوّدين فوق عشان كل أمر ياخد موديل مستواه.' })
        : U.InlineNote({ children: 'السيستم بيختار الموديل لوحده حسب الأمر' + (prov === 'claude' ? ': المتوسط بنص سعر القوي، والضعيف أرخص من المتوسط 20 مرة' : '') + '. غيّر مستوى أي أمر لو جودته محتاجة أعلى أو صرفه أكتر من اللازم.' }),
      prov !== 'claude' ? U.InlineNote({ kind: 'warning', children: 'المدير بالأدوات واستخراج الشيت من الواتساب والبحث على الويب بيشتغلوا على Claude دايمًا — لازم Claude يفضل مربوط ليهم.' }) : null,
    ];
    const card = K.Section('أنهي موديل لأنهي أمر (' + P.name + ')', [guide, ...notes, h('div', { class: 'air-rows' + (auto ? '' : ' off') }, rows),
      h('p', { class: 't-small sub' }, 'الموديلات والأسعار دي بتاريخ ', ltr(LIST_DATE), ' — لو أي شركة مربوطة نزّلت موديل جديد أو وقّفت موديل، «المبرمج الذكي» هيبعت تنبيه في الجرس عشان السيستم يتحدّث. الأداة اللي ليها مزوّد تاني بتمشي على مستويات مزوّدها.')],
      acts, { sub: 'أحسن طريقة لاستخدام الكريدت: كل أمر على أرخص موديل يعمله صح', th: false, cols: false });
    card.setAttribute('data-ai-routing', r.mode);
    return [card, admin ? spendSec(redraw) : null].filter(Boolean);
  }

  window.IBAIRouting = { LIST_DATE, TIERS, TIER, PROVIDERS, MODEL, SIZED, COMMANDS, WORK, routingOf, routeOf, tierFor, sizes, modelsOf, oneModel, companyOf, sections, picker };
})();
