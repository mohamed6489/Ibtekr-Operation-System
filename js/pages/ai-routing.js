// «أنهي موديل لأنهي أمر» (the owner 22 Nov — docs/superpowers/plans/2026-11-22-model-routing.md: «يبقا مكتوب في التعليمات احسن طريقة
// تخليني استخدم الكريديت صح يعني امتا يستخدم كل موديل و في اي امر بيناء علي احدث الموديلز»). Not a block. The card of «الإعدادات ›
// الذكاء الاصطناعي › مصادر الذكاء» for Claude: the three levels with their model and price and what each is for, every command with its
// level (the admin moves one, or goes back to one model for everything) and this month's spend by model and by kind of work.
//   IBAIRouting.sections({ redraw })   the cards (block 17 puts them under the providers)
//   IBAIRouting.autoSwitch({ redraw })  the providers card's switch «اختيار مصادر الذكاء تلقائيًا» (the owner 22 Nov): on,
//                                       every field takes a company only and the system picks the model
//   IBAIRouting.modelField({ id, label, title, section, tool, live, read, redraw }) a field of that card while the switch is off: its
//                                       company and model, from a list with a tab per linked company (one choice)
//   IBAIRouting.routeOf(aiRow, command, provider) the level a command runs on now (as the server's _shared/ai-routing.js — a
//                                       test keeps the two tables in step)
// The server routes by itself with no row: the card only shows it, and writes what the admin changes (IBSettings.save «ai»).
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h, Button, Icon } = U;
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
  // ---- the providers card (the owner 22 Nov — «جملة إختيار مزودين الذكاء الاصطناعي تلقائيا و جمبيها راديو باتون … لو شلت الاختيار
  // التلقائي … يكتب اسم الشركة و الموديلز بحيث اقدر اختار لكل نوع محتوى الموديل» and «الدروب داون يبقا فيه تابس بحيث كل شركة في تاب و
  // تحتيها الموديلز بتاعتها زي الفلتر بس … مفيهوش اختيار متعدد»): one switch over the whole card. On: a field takes a company only and
  // the system picks the model. Off: every field takes a company and one of its models, from a list with a tab per linked company.
  const EN = window.IB_LANG === 'en'; const tx = (ar, en) => (EN ? en : ar);
  // every section's companies and their models (the server's ai-providers.js lists; Magnific's image models and their credits are
  // the images adapter's MODELS, its video models mkt-video.js VIDEO_MODELS, its voice the bridge's ElevenLabs)
  const CATALOG = {
    text: { claude: { name: 'Claude', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] }, openai: { name: 'ChatGPT', models: ['gpt-5.2', 'gpt-5.2-mini'] }, gemini: { name: 'Gemini', models: ['gemini-3-pro', 'gemini-3-flash'] } },
    image: { magnific: { name: 'Magnific', models: ['seedream-5-pro', 'seedream-5-lite', 'gemini-2-5-flash', 'gpt-image-2'] }, openai: { name: 'OpenAI', models: ['gpt-image-2'] }, gemini: { name: 'Gemini', models: ['gemini-3-pro-image', 'gemini-2.5-flash-image'] } },
    voice: { magnific: { name: 'Magnific', models: ['bridge'] }, elevenlabs: { name: 'ElevenLabs', models: ['eleven_v3', 'eleven_multilingual_v2'] } },
    video: { magnific: { name: 'Magnific', models: ['seedance-2.5', 'seedance-2.0', 'kling-2.5', 'minimax-h3'] }, higgsfield: { name: 'Higgsfield', models: ['seedance_2_5', 'kling3_0', 'minimax_h3', 'marketing_studio_video'] }, veo: { name: 'Google Veo', models: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview'] } },
  };
  const MNAME = { 'seedream-5-pro': 'Seedream 5 Pro', 'seedream-5-lite': 'Seedream 5 Lite', 'gemini-2-5-flash': 'Gemini 2.5 Flash (Nano Banana)', 'gpt-image-2': 'GPT Image 2',
    'gemini-3-pro-image': 'Gemini 3 Pro Image', 'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image', bridge: 'ElevenLabs', eleven_v3: 'Eleven v3', eleven_multilingual_v2: 'Eleven Multilingual v2',
    'seedance-2.5': 'Seedance 2.5', 'seedance-2.0': 'Seedance 2.0', 'kling-2.5': 'Kling 2.5', 'minimax-h3': 'MiniMax H3 Max', seedance_2_5: 'Seedance 2.5', kling3_0: 'Kling 3.0', minimax_h3: 'MiniMax H3',
    marketing_studio_video: 'Marketing Studio Video', 'veo-3.1-generate-preview': 'Veo 3.1', 'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast' };
  const CREDITS = { 'seedream-5-pro': 75, 'seedream-5-lite': 50, 'gemini-2-5-flash': 20, 'gpt-image-2': 60 }; // one image on Magnific
  const nameOf = (m) => (MODEL[m] ? MODEL[m].name : MNAME[m] || String(m));
  const shortName = (company, name) => (name.indexOf(company + ' ') === 0 ? name.slice(company.length + 1) : name); // «Claude — Sonnet 5.5»
  // what a model's row says beside its name: a text model its levels and its price (in · out), a Magnific image its credits
  function modelSub(k, provider, m) {
    if (k === 'text') return { tag: levelsOfModel(provider, m), price: [ltr(usd(MODEL[m].usd[0])), ' · ', ltr(usd(MODEL[m].usd[1]))] };
    if (k === 'image' && provider === 'magnific') return { price: [ltr(String(CREDITS[m])), tx(' كريدت', ' credits')] };
    return null;
  }
  const FOOT = { text: () => tx('السعر بالدولار لكل مليون توكن: دخل · خرج', 'Price in dollars per million tokens: in · out'), image: () => tx('الكريدت للصورة الواحدة على Magnific', 'Credits for one image on Magnific') };
  const secRow = (aiRow, k) => (isObj(aiRow) && isObj(aiRow.providers) && isObj(aiRow.providers[k]) ? aiRow.providers[k] : {});
  // the model of a field: the one saved for it while it is its company's, else the company's own (the text company's one model,
  // Magnific's image model of «إعدادات الصور»), else the company's first
  function fieldModel(aiRow, k, provider, saved) {
    const list = CATALOG[k][provider].models; if (list.includes(saved)) return saved;
    if (k === 'text') return oneModel(aiRow, provider);
    if (k === 'image' && provider === 'magnific' && isObj(aiRow) && list.includes(aiRow.image_model)) return aiRow.image_model;
    return list[0];
  }
  /** What a field runs on with the automatic choice off: { provider, model } — null for a tool that follows its section. */
  function pickOf(aiRow, k, tool) {
    const C = CATALOG[k]; if (!C) return null; const ids = Object.keys(C); const cur = secRow(aiRow, k);
    if (tool) { const p = isObj(cur.tools) ? cur.tools[tool] : ''; return ids.includes(p) ? { provider: p, model: fieldModel(aiRow, k, p, isObj(cur.toolModels) ? cur.toolModels[tool] : '') } : null; }
    const p = ids.includes(cur.default) ? cur.default : ids[0]; return { provider: p, model: fieldModel(aiRow, k, p, cur.model) };
  }
  // a field's company and model: the section's own under `default` + `model`, a tool's under `tools` + `toolModels`; the text
  // section's own model is also its company's one model (the row's `model` for Claude), which the rest of the system reads
  async function saveField(S0, ai, k, tool, v, redraw) {
    const P = isObj(ai.providers) ? JSON.parse(JSON.stringify(ai.providers)) : {}; const cur = P[k] = isObj(P[k]) ? P[k] : {}; const patch = { providers: P };
    if (tool) {
      cur.tools = isObj(cur.tools) ? cur.tools : {}; cur.toolModels = isObj(cur.toolModels) ? cur.toolModels : {};
      if (v) { cur.tools[tool] = v.provider; cur.toolModels[tool] = v.model; } else { delete cur.tools[tool]; delete cur.toolModels[tool]; }
    } else {
      cur.default = v.provider; cur.model = v.model;
      if (k === 'text') { if (v.provider === 'claude') patch.model = v.model; else cur.models = Object.assign({}, isObj(cur.models) ? cur.models : {}, { [v.provider]: v.model }); }
    }
    const res = await S0.save('ai', patch);
    if (!res || !res.ok) { K.toast((res && res.message) || tx('تعذّر الحفظ — جرّب تاني', 'Could not save — try again'), 'error'); return; }
    if (K.logEvent) K.logEvent('settings.ai.providers', k + (tool ? '.' + tool : '') + '=' + (v ? v.provider + ':' + v.model : 'default')); // the field and its names only
    K.toast(tx('اتحفظ — ', 'Saved — ') + (v ? CATALOG[k][v.provider].name + ' · ' + nameOf(v.model) : tx('الافتراضي للقسم', 'Section default')), 'success'); if (typeof redraw === 'function') redraw();
  }
  // a single-choice list: «تلقائي» / «الافتراضي للقسم» on top (when the field has one), the companies as one segmented line, the open
  // company's models as rows — name, level, price in columns — and what the figures are under them; picking closes it
  function TabPick({ id, label, title, help, disabled, text, groups, value, inherit, inheritSub, foot, onChange }) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' });
    const btn = h('button', { type: 'button', id, class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', disabled: disabled ? '' : false, 'data-cm-btn': value ? value.provider + ':' + value.model : '' },
      Icon('chevD', 'sm'), h('span', { class: 'val' }, text));
    const pop = U.popover(wrap, btn, (close) => {
      const menu = h('div', { class: 'menu cm-menu', 'data-popover-root': '', 'data-cm-menu': id, 'data-focus': 'no' });
      menu.append(h('div', { class: 'cm-title' }, title || label)); // a phone's sheet says what it chooses (hidden under a field on a wide screen)
      const pickIt = (v) => { close(); const same = (!v && !value) || (!!v && !!value && v.provider === value.provider && v.model === value.model); if (!same) onChange(v); };
      if (inherit) menu.append(h('button', { type: 'button', class: 'opt cm-inherit', role: 'option', 'aria-selected': String(!value), 'data-cm': '', onClick: () => pickIt(null) },
        h('span', { class: 'cm-ic' }, Icon('zap', 'sm')), h('span', { class: 'cm-n' }, h('b', null, inherit), inheritSub ? h('small', { class: 'cm-s' }, inheritSub) : null), h('span', { class: 'cm-ck' }, !value ? Icon('check', 'sm') : null)));
      if (!groups.length) { menu.append(h('div', { class: 'menu-empty' }, tx('مفيش شركة مربوطة هنا — اربط من «الربط بالمنصات».', 'No company is connected here — connect one from “Integrations”.'))); return menu; }
      const tabs = h('div', { class: 'cm-tabs', role: 'tablist', 'aria-label': tx('الشركة', 'Company') }); const secs = {}; let drawn = false;
      const show = (gid) => {
        tabs.querySelectorAll('[data-cm-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.getAttribute('data-cm-tab') === gid)));
        for (const g of groups) secs[g.id].hidden = g.id !== gid;
        if (drawn) window.dispatchEvent(new Event('resize')); // the list is another height now: the kit places it again
      };
      for (const g of groups) {
        tabs.append(h('button', { type: 'button', role: 'tab', class: 'cm-tab', 'data-cm-tab': g.id, 'aria-selected': 'false', onClick: () => show(g.id) }, h('bdi', null, g.name), g.off ? h('span', { class: 'cm-off' }, tx(' — مش مربوط', ' — not connected')) : null));
        secs[g.id] = h('div', { class: 'cm-sec', role: 'listbox', 'aria-label': g.name, 'data-cm-sec': g.id }, g.models.map((m) => {
          const on = !!value && value.provider === g.id && value.model === m.id; const x = m.sub || {};
          return h('button', { type: 'button', class: 'opt cm-opt', role: 'option', 'aria-selected': String(on), 'data-cm': g.id + ':' + m.id, onClick: () => pickIt({ provider: g.id, model: m.id }) },
            h('span', { class: 'cm-n' }, h('bdi', null, m.name)), x.tag ? h('span', { class: 'cm-tag' }, x.tag) : null, x.price ? h('span', { class: 'cm-price' }, x.price) : null, h('span', { class: 'cm-ck' }, on ? Icon('check', 'sm') : null));
        }));
      }
      menu.append(h('div', { class: 'cm-cap' }, tx('الشركة', 'Company')), tabs, h('div', { class: 'cm-cap' }, tx('الموديل', 'Model'))); for (const g of groups) menu.append(secs[g.id]);
      if (foot) menu.append(h('div', { class: 'cm-foot' }, foot));
      show(value && secs[value.provider] ? value.provider : groups[0].id); drawn = true;
      menu.addEventListener('keydown', (e) => { // ↑ ↓ through the open company's models
        const items = [...menu.querySelectorAll('[role=option]')].filter((x) => !x.closest('[hidden]')); const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      });
      return menu;
    });
    btn.addEventListener('click', pop.toggle); wrap.append(btn);
    return U.FieldShell({ id, label, help }, wrap);
  }
  /** The card's switch: the system picks every model (on) or the admin names each field's company and model (off). */
  function autoSwitch(opts) {
    const redraw = opts && opts.redraw; const S0 = SET(); if (!S0 || !S0.section) return null;
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin); const r = routingOf(ai); const auto = r.mode === 'auto';
    const sw = K.Switch({ id: 'prov-auto', label: tx('اختيار مصادر الذكاء تلقائيًا', 'Choose the AI providers automatically'), checked: auto, disabled: !admin,
      help: auto ? tx('شغّال — السيستم عارف موديلات كل شركة وبيختار الموديل المناسب لكل طلب. إنت بتختار الشركة بس لكل نوع.', 'On — the system knows every company’s models and picks the right one for each request. You only choose the company for each kind.')
        : tx('مقفول — اختار لكل نوع الشركة والموديل اللي يشتغل عليه.', 'Off — choose the company and the model each kind runs on.'),
      onChange: (v) => { if (!admin) return; saveRouting(S0, { mode: v ? 'auto' : 'single', tiers: r.tiers }, v ? 'auto' : 'by hand', redraw); } });
    return h('div', { class: 'prov-auto', 'data-prov-auto': auto ? 'on' : 'off', 'data-set-instant': '' }, h('span', { class: 'set-ic' }, Icon('zap')), sw); // saved on the spot: not an unsaved change of the page
  }
  // the tabs of a list: the linked companies of a kind (and the chosen one, marked, while it is not), each with its models
  const groupsFor = (k, cur, live, read) => Object.keys(CATALOG[k]).filter((p) => live(p) || (cur && cur.provider === p)).map((p) => ({ id: p, name: CATALOG[k][p].name, off: !!read && !live(p),
    models: CATALOG[k][p].models.map((m) => ({ id: m, name: nameOf(m), sub: modelSub(k, p, m) })) }));
  /** A text company-and-model field its caller keeps (an assistant's own outside brain): value { provider, model } or null = `inherit`. */
  function brainField(o) {
    const C = CATALOG.text; const live = (p) => !!o.read && !!o.live(p);
    const cur = o.value && C[o.value.provider] ? { provider: o.value.provider, model: C[o.value.provider].models.includes(o.value.model) ? o.value.model : C[o.value.provider].models[0] } : null;
    const gone = !!cur && !!o.read && !live(cur.provider);
    const text = cur ? h('bdi', null, C[cur.provider].name + ' — ' + shortName(C[cur.provider].name, nameOf(cur.model)) + (gone ? tx(' — مش مربوط', ' — not connected') : '')) : o.inherit;
    return TabPick({ id: o.id, label: o.label, title: o.title, disabled: !!o.disabled, text, groups: groupsFor('text', cur, live, o.read), value: cur, inherit: o.inherit, inheritSub: o.inheritSub, foot: FOOT.text(),
      help: gone ? tx('مصدر الذكاء ده مش مربوط — اربطه من «الربط بالمنصات» أو اختار مصدر مربوط.', 'This provider is not connected — connect it from “Integrations” or choose a connected one.') : o.help || null, onChange: o.onChange });
  }
  /** A field of the card with the automatic choice off: its company and model, picked from the linked companies' tabs. */
  function modelField(o) {
    const S0 = SET(); if (!S0 || !S0.section) return null; const k = o.section; const C = CATALOG[k]; if (!C) return null;
    const ai = S0.section('ai') || {}; const admin = !!(S0.can && S0.can().admin);
    const cur = pickOf(ai, k, o.tool); const live = (p) => !!o.read && !!o.live(p);
    // before the links are read: the chosen company alone, unmarked (the control never shows another than the row holds)
    const groups = Object.keys(C).filter((p) => live(p) || (cur && cur.provider === p)).map((p) => ({ id: p, name: C[p].name, off: !!o.read && !live(p),
      models: C[p].models.map((m) => ({ id: m, name: nameOf(m), sub: modelSub(k, p, m) })) }));
    const gone = !!cur && !!o.read && !live(cur.provider); const inherit = o.tool ? tx('الافتراضي للقسم', 'Section default') : null;
    const text = cur ? h('bdi', null, C[cur.provider].name + ' — ' + shortName(C[cur.provider].name, nameOf(cur.model)) + (gone ? tx(' — مش مربوط', ' — not connected') : '')) : inherit;
    return TabPick({ id: o.id, label: o.label, title: o.title, disabled: !admin, text, groups, value: cur, inherit, foot: FOOT[k] && (k !== 'image' || groups.some((g) => g.id === 'magnific')) ? FOOT[k]() : null,
      inheritSub: inherit ? tx('زي اختيار القسم كله', 'As the whole section’s choice') : null,
      help: gone ? tx('مصدر الذكاء ده مش مربوط — اربطه من «الربط بالمنصات» أو اختار مصدر مربوط.', 'This provider is not connected — connect it from “Integrations” or choose a connected one.') : null,
      onChange: (v) => saveField(S0, ai, k, o.tool, v, o.redraw) });
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
      !auto ? U.InlineNote({ children: tx('الاختيار التلقائي مقفول — كل نوع شغّال على الموديل اللي اخترته له في كارت «مصادر الذكاء» فوق، والأمر البسيط بيتحاسب بسعر موديله. شغّله عشان كل أمر ياخد موديل مستواه.', 'The automatic choice is off — every kind runs on the model you chose for it in the providers card above, and a simple command is billed at that model’s price. Turn it on so every command takes the model of its level.') })
        : U.InlineNote({ children: 'السيستم بيختار الموديل لوحده حسب الأمر' + (prov === 'claude' ? ': المتوسط بنص سعر القوي، والضعيف أرخص من المتوسط 20 مرة' : '') + '. غيّر مستوى أي أمر لو جودته محتاجة أعلى أو صرفه أكتر من اللازم.' }),
      prov !== 'claude' ? U.InlineNote({ kind: 'warning', children: 'المدير بالأدوات واستخراج الشيت من الواتساب والبحث على الويب بيشتغلوا على Claude دايمًا — لازم Claude يفضل مربوط ليهم.' }) : null,
    ];
    const card = K.Section('أنهي موديل لأنهي أمر (' + P.name + ')', [guide, ...notes, h('div', { class: 'air-rows' + (auto ? '' : ' off') }, rows),
      h('p', { class: 't-small sub' }, 'الموديلات والأسعار دي بتاريخ ', ltr(LIST_DATE), ' — لو أي شركة مربوطة نزّلت موديل جديد أو وقّفت موديل، «المبرمج الذكي» هيبعت تنبيه في الجرس عشان السيستم يتحدّث. الأداة اللي ليها مصدر ذكاء تاني بتمشي على مستويات مصدرها.')],
      acts, { sub: 'أحسن طريقة لاستخدام الكريدت: كل أمر على أرخص موديل يعمله صح', th: false, cols: false });
    card.setAttribute('data-ai-routing', r.mode);
    return [card, admin ? spendSec(redraw) : null].filter(Boolean);
  }

  window.IBAIRouting = { LIST_DATE, TIERS, TIER, PROVIDERS, MODEL, SIZED, COMMANDS, WORK, routingOf, routeOf, tierFor, sizes, modelsOf, oneModel, companyOf, sections, CATALOG, pickOf, autoSwitch, modelField, brainField, nameOf };
})();
