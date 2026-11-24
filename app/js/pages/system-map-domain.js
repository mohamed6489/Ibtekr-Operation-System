/* Ibtekr — «عقل السيستم»: the pure part (Safwat 24 Nov — the pinned mockup «عقل السيستم», his answers: a page of its own in the side
   menu, the admin only). Everything the system is linked to and works with, as groups around the brain — the site and its plugins, the
   server, the text brain, the images, the video and voice, Meta and WhatsApp, the ads, the shipping, the e-mail, the code, the other
   tools — each with its parts (what it does with the system, its direction, its version where the site says it), its state now
   (on · paused · unlinked · err · idle) from the system's own reads, and today's events from the activity log. No reading here: the
   page (system-map.js) hands `systemsOf` what it read; no phone, no key, no message text ever reaches it. */
(function (root) {
  'use strict';
  const STATE_TXT = { on: 'شغّال', paused: 'موقوف مؤقتًا', unlinked: 'مش مربوط', err: 'فيه مشكلة', idle: 'مش مستخدم' };
  const IMP_TXT = ['', 'إضافي', 'مهم', 'أساسي'];
  const P = (name, kind, role, dir, extra) => Object.assign({ name, kind, role, dir, ver: '', state: 'on' }, extra || {});
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  // a linked key: from the page (Vault) or the server's own secrets; «ready» = its fields complete
  const linked = (links, n) => !!(isObj(links) && isObj(links[n]) && (links[n].ready || links[n].source === 'server'));
  const testBad = (links, n) => !!(isObj(links) && isObj(links[n]) && isObj(links[n].test) && links[n].test.ok === false);
  // a pause in force: settings «integrations».paused { key: ISO until }
  const pausedTill = (paused, key, now) => { const v = isObj(paused) ? paused[key] : null; const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) && t > now ? v : null; };
  const untilText = (iso, now) => { if (!iso) return ''; const d = new Date(iso); const h = Math.round((d - now) / 3600000);
    return h <= 1 ? 'لمدة أقل من ساعة' : h < 24 ? 'لمدة ' + h + ' ساعة' : 'لحد ' + d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' }) + ' ' + d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); };
  // a part's state from its key: paused › unlinked › err (its last test failed) › on
  const keyState = (raw, name, pauseKey) => (pausedTill(raw.paused, pauseKey || name, raw.now) ? 'paused' : !linked(raw.links, name) ? 'unlinked' : testBad(raw.links, name) ? 'err' : 'on');
  // a group's state from its parts: the one in use decides; else on if any part is on
  const groupState = (parts, cur) => { const c = cur ? parts.find((p) => p.key === cur) : null; if (c) return c.state;
    if (parts.some((p) => p.state === 'on')) return parts.some((p) => p.state === 'err') ? 'err' : 'on';
    if (parts.some((p) => p.state === 'err')) return 'err'; if (parts.some((p) => p.state === 'paused')) return 'paused'; return 'unlinked'; };

  // the site's plugins the system knows (its role with each); the site's own list (site_checks «wp_updates» — WooCommerce's system
  // status read by the developer's daily check) gives the versions and adds the plugins the system does not use
  const SITE_KNOWN = [
    ['WordPress', 'النواة', 'رفع الصور على المكتبة وقراية آخر نسخة', 'الاتجاهين', /^wordpress$/i],
    ['WooCommerce', 'بلاجن', 'الأوردرات والمنتجات والأقسام — REST API والويب هوكس', 'الاتجاهين', /^woocommerce$/i],
    ['Dokan', 'بلاجن', 'المتاجر والعمولات والأوردرات الفرعية وطلبات السحب', 'الاتجاهين', /^dokan/i],
    ['WPML', 'بلاجن', 'الترجمة العربي للمنتجات والأقسام والخصائص', 'كتابة', /wpml|multilingual|sitepress/i],
    ['WooCommerce Brands', 'بلاجن', 'براندات المنتجات (ومعاها خاصية Brand)', 'الاتجاهين', /brands/i],
    ['Rank Math SEO', 'بلاجن', 'عنوان ووصف السيو للمنتج باللغتين', 'كتابة', /rank ?math/i],
    ['Bosta for WooCommerce', 'بلاجن', 'رقم شحنة بوسطة على الأوردر — السيستم بيبعت زيه بالظبط', 'قراية', /bosta/i],
    ['Variation Gallery', 'بلاجن', 'صور كل تركيبة (لون / مقاس)', 'كتابة', /variation (images|gallery)|woo.*gallery/i],
    ['WoodMart', 'ثيم', 'شكل الموقع والسلة المتروكة (مش متاحة للسيستم)', '—', /woodmart/i, 'idle'],
    ['WP All Import / Export Pro', 'بلاجن', 'الطريق القديم للرفع الجماعي — السيستم مابيستخدموش', '—', /wp all (import|export)/i, 'idle'],
  ];
  function siteParts(raw, state) {
    const wp = isObj(raw.wp) ? raw.wp : null; const list = wp && Array.isArray(wp.plugins) ? wp.plugins.filter(isObj) : [];
    const used = new Set(); const verOf = (re) => { const i = list.findIndex((p, k) => !used.has(k) && re.test(String(p.name || ''))); if (i < 0) return null; used.add(i); return list[i]; };
    const out = SITE_KNOWN.map(([name, kind, role, dir, re, st]) => {
      let ver = ''; let upd = '';
      if (name === 'WordPress' && wp && isObj(wp.core)) { ver = String(wp.core.version || ''); upd = wp.core.update ? String(wp.core.latest || '') : ''; }
      else if (name === 'WooCommerce' && wp && isObj(wp.woo)) ver = String(wp.woo.version || '');
      else if (kind === 'ثيم' && wp && isObj(wp.theme) && re.test(String(wp.theme.name || ''))) { ver = String(wp.theme.version || ''); upd = wp.theme.update ? String(wp.theme.latest || '') : ''; }
      else { const p = verOf(re); if (p) { ver = String(p.version || ''); upd = p.update ? String(p.latest || '') : ''; if (p.active === false) st = 'idle'; } }
      return P(name, kind, role, dir, { ver, upd, state: st || state });
    });
    out.push(P('Order Attribution', 'جزء من WooCommerce', 'مصدر الأوردر والـ UTM للإعلانات', 'قراية', { state }));
    const px = isObj(raw.pixel) ? raw.pixel : null;
    out.push(P('Meta Pixel', 'كود على الموقع', 'أحداث الزوار والمشتريات — فحص البيكسل', 'قراية', px ? (px.ok === false ? { state: 'err', err: 'فحص البيكسل لقى مشكلة — شوف «الميديا باير›البيكسل»' } : {}) : { state: 'idle', err: 'لسه مااتفحصش' }));
    list.forEach((p, k) => { if (used.has(k) || /^woocommerce$/i.test(String(p.name || ''))) return; out.push(P(String(p.name || '').slice(0, 60), 'بلاجن', 'على الموقع — السيستم مابيستخدموش', '—', { ver: String(p.version || ''), upd: p.update ? String(p.latest || '') : '', state: 'idle' })); });
    return out;
  }

  // the text / image / video brains and which one each tool uses (settings «ai».providers — the page's «المزوّدين»)
  const TEXT = [['anthropic', 'claude', 'Claude', 'المدير والمساعدين والكتابة والبحث على الويب'], ['openai', 'openai', 'ChatGPT', 'بديل للنصوص'], ['gemini', 'gemini', 'Gemini', 'بديل للنصوص']];
  function systemsOf(input) {
    const raw = Object.assign({ links: {}, paused: {}, channels: [], adAccounts: [], ads: {}, wp: null, speed: null, pixel: null, bridge: null, providers: {}, syncErrors: 0, events: [], now: Date.now() }, input || {});
    const now = raw.now; const prov = isObj(raw.providers) ? raw.providers : {};
    const sys = [];
    // ---- the site
    const wooState = keyState(raw, 'woo') === 'unlinked' ? 'unlinked' : pausedTill(raw.paused, 'woo', now) ? 'paused' : raw.syncErrors >= 3 ? 'err' : 'on';
    const siteP = siteParts(raw, wooState === 'on' || wooState === 'err' ? 'on' : wooState);
    sys.push({ id: 'site', glyph: 'store', name: 'الموقع (ووردبريس)', now: 'WooCommerce + Dokan', job: 'الأوردرات والمنتجات والمبتكرين وأرصدتهم', imp: 3, state: wooState, pauseKeys: ['woo'], link: 'site',
      stops: 'مزامنة الأوردرات والمنتجات والمتاجر وطلبات السحب (الموقع نفسه شغّال عادي)', err: wooState === 'err' ? 'المزامنة مع الموقع فشلت ' + raw.syncErrors + ' مرات في آخر ساعة' : '',
      note: 'تشغيل أو إيقاف أي بلاجن بيتعمل من ووردبريس نفسه — السيستم بيقرا البلاجنز ونسخها بس ومابيكتبش عليها.', parts: siteP, checkedAt: raw.wp && raw.wp.at ? raw.wp.at : null });
    // ---- the server
    sys.push({ id: 'core', glyph: 'db', name: 'السيرفر وقاعدة البيانات', now: 'Supabase', job: 'البيانات والصلاحيات والدوال والملفات', imp: 3, state: 'on', locked: true,
      note: 'ده قلب السيستم نفسه — مايتوقفش ومالوش بديل من هنا.',
      parts: [P('Postgres', 'قاعدة بيانات', 'كل البيانات والصلاحيات (RLS)', 'الاتجاهين'), P('Auth', 'الدخول', 'تسجيل الدخول والتحقق بخطوتين', 'الاتجاهين'),
        P('Edge Functions', 'دوال السيرفر', 'المزامنة والمساعدين والتنبيهات والنشر', 'الاتجاهين'), P('Storage', 'الملفات', 'الصور والمرفقات والعقود', 'الاتجاهين'),
        P('Realtime', 'لحظي', 'التحديث عند كل الأعضاء من غير ريفريش', 'الاتجاهين'), P('Vault', 'الأسرار', 'مفاتيح الربط متشفّرة', 'قراية'), P('pg_cron', 'المهام المجدولة', 'المزامنة والتنبيهات في مواعيدها', '—')] });
    // ---- the text brain
    const textCur = String((isObj(prov.text) && prov.text.default) || 'claude');
    const textParts = TEXT.map(([n, id, name, role]) => P(name, 'API', role, 'الاتجاهين', { key: id, state: keyState(raw, n) }));
    const textNow = (TEXT.find((t) => t[1] === textCur) || TEXT[0])[2];
    sys.push({ id: 'text', glyph: 'text', name: 'مخ النصوص', now: textNow, job: 'المساعدين والكتابة والتحليل', imp: 3, state: groupState(textParts, textCur), pauseKeys: [TEXT.find((t) => t[1] === textCur)?.[0] || 'anthropic'], link: 'ai', swap: 'text',
      stops: 'ردود المساعدين بالمخ الخارجي والكتابة بالـ AI (السيستم بيرد بأرقامه عادي)', parts: textParts,
      alts: textParts.map((p) => ({ id: p.key, name: p.name, sub: p.state === 'unlinked' ? 'مش مربوط' : p.state === 'paused' ? 'موقوف مؤقتًا' : 'مربوط', linked: p.state === 'on' })), cur: textCur });
    // ---- the images
    const img = isObj(prov.image) ? prov.image : {}; const imgCur = String(img.default || 'magnific'); const tools = isObj(img.tools) ? img.tools : {};
    const mgApi = keyState(raw, 'magnific_api', 'magnific'); const bridge = isObj(raw.bridge) ? raw.bridge : null;
    const imgParts = [P('Magnific API', 'API', 'توليد وتعديل الصور بالكريدت', 'الاتجاهين', { key: 'magnific', state: mgApi }),
      P('Magnific (الجسر)', 'MCP', 'الـ Spaces والفلوهات بحسابك (Unlimited)', 'الاتجاهين', { state: bridge ? (bridge.linked ? (pausedTill(raw.paused, 'magnific', now) ? 'paused' : 'on') : 'unlinked') : 'idle' }),
      P('OpenAI gpt-image', 'API', 'بديل للصور', 'الاتجاهين', { key: 'openai', state: keyState(raw, 'openai') }),
      P('Gemini Nano Banana', 'API', 'بديل للصور', 'الاتجاهين', { key: 'gemini', state: keyState(raw, 'gemini') })];
    const imgUse = (k) => (k === 'magnific' ? imgParts[0].state === 'on' || imgParts[1].state === 'on' ? 'on' : imgParts[0].state : (imgParts.find((p) => p.key === k) || { state: 'unlinked' }).state);
    const toolNames = { studio: 'الاستوديو', campaign: 'الكامبين', tool: 'أداة الصور' };
    const offTools = Object.keys(toolNames).filter((t) => imgUse(String(tools[t] || imgCur)) !== 'on');
    const nameOf = (k) => ({ magnific: 'Magnific', openai: 'OpenAI gpt-image', gemini: 'Gemini Nano Banana' })[k] || k;
    sys.push({ id: 'image', glyph: 'image', name: 'الصور', now: nameOf(imgCur) + (Object.keys(toolNames).some((t) => tools[t] && tools[t] !== imgCur) ? ' + غيره' : ''), job: 'صور المنتجات والكامبينات', imp: 2,
      state: offTools.length === 3 ? groupState(imgParts, null) === 'on' ? 'err' : groupState(imgParts, null) : offTools.length ? 'err' : 'on', pauseKeys: ['magnific'], link: 'ai', swap: 'image',
      err: offTools.length ? 'المزوّد المختار لـ ' + offTools.map((t) => toolNames[t] + ' (' + nameOf(String(tools[t] || imgCur)) + ')').join(' و') + ' مش مربوط — غيّره من «المزوّدين» أو اربطه' : '',
      stops: 'توليد الصور (الرفع اليدوي شغّال)', parts: imgParts,
      alts: [['magnific', 'Magnific'], ['openai', 'OpenAI gpt-image'], ['gemini', 'Gemini Nano Banana']].map(([k, n]) => ({ id: k, name: n, sub: imgUse(k) === 'on' ? 'مربوط' : 'مش مربوط', linked: imgUse(k) === 'on' })), cur: imgCur });
    // ---- the video and the voice
    const vidParts = [P('Higgsfield', 'MCP', 'فيديوهات الكامبينات', 'الاتجاهين', { key: 'higgsfield', state: keyState(raw, 'higgsfield') }),
      P('Veo (Gemini)', 'API', 'بديل للفيديو', 'الاتجاهين', { key: 'gemini', state: keyState(raw, 'gemini') }),
      P('ElevenLabs', 'API', 'الفويس أوفر', 'الاتجاهين', { key: 'elevenlabs', state: keyState(raw, 'elevenlabs') }),
      P('Magnific (الجسر)', 'MCP', 'فيديو الكامبين بحسابك — Seedance / Kling', 'الاتجاهين', { state: imgParts[1].state })];
    sys.push({ id: 'video', glyph: 'video', name: 'الفيديو والصوت', now: vidParts.find((p) => p.state === 'on')?.name || 'مش مربوط', job: 'ريلز الكامبينات والفويس أوفر', imp: 1, state: groupState(vidParts, null), pauseKeys: ['higgsfield', 'elevenlabs'], link: 'ai', swap: 'video',
      stops: 'فيديو وصوت الـ AI بس', parts: vidParts });
    // ---- Meta and WhatsApp (the CS page's own channels)
    const ch = (id) => (Array.isArray(raw.channels) ? raw.channels : []).find((c) => c && c.id === id) || null;
    const chState = (id, pk) => { const c = ch(id); if (pausedTill(raw.paused, pk, now)) return 'paused'; if (!c) return 'unlinked'; return c.status === 'connected' ? 'on' : c.status === 'error' ? 'err' : 'unlinked'; };
    const metaParts = [P('Messenger', 'Graph API', 'رسايل الصفحة والتعليقات', 'الاتجاهين', { state: chState('messenger', 'meta') }), P('Instagram', 'Graph API', 'الرسايل والتعليقات', 'الاتجاهين', { state: chState('instagram', 'meta') }),
      P('النشر', 'Graph API', 'البوستات والريلز وأرقامها', 'الاتجاهين', { state: chState('messenger', 'meta') }), P('WhatsApp Cloud API', 'API', 'واتساب العملاء — نفس الرقم على الموبايل', 'الاتجاهين', { state: chState('wa1', 'wa1') }),
      P('واتساب المبتكرين', 'جسر QR', 'مخفي لحد ما تفتحه', '—', { state: chState('wa2', 'wa2') === 'on' ? 'on' : 'idle' })];
    sys.push({ id: 'meta', glyph: 'meta', name: 'ميتا وواتساب', now: 'الصفحة وواتساب 1', job: 'الرسايل والتعليقات والنشر وواتساب العملاء', imp: 3, state: groupState(metaParts.slice(0, 4), null), pauseKeys: ['meta', 'wa1'], link: 'social',
      stops: 'الرسايل والتعليقات والنشر التلقائي والرد على العملاء من السيستم', parts: metaParts });
    // ---- the ads (mkt-ads status: each platform's account and its last error)
    const ads = isObj(raw.ads) ? raw.ads : {};
    const adState = (k, pk) => { if (pausedTill(raw.paused, pk, now)) return 'paused'; const a = isObj(ads[k]) ? ads[k] : null; if (!a || !a.linked) return 'unlinked'; return a.error ? 'err' : 'on'; };
    const adParts = [['meta', 'Meta Ads', 'Marketing API', 'الصرف والنتايج وفتح وقفل الحملات بموافقتك', 'الاتجاهين', 'ads_meta'], ['tiktok', 'TikTok Ads', 'API', 'الأرقام — قراية بس', 'قراية', 'ads_tiktok'], ['google', 'Google Ads', 'API', 'الأرقام — قراية بس', 'قراية', 'ads_google']]
      .map(([k, n, kind, role, dir, pk]) => P(n, kind, role, dir, { state: adState(k, pk), err: isObj(ads[k]) && ads[k].error ? 'آخر مزامنة رجعت بخطأ (' + String(ads[k].error).slice(0, 40) + ')' : '' }));
    const adErr = adParts.filter((p) => p.state === 'err');
    sys.push({ id: 'ads', glyph: 'ads', name: 'الإعلانات', now: adParts.filter((p) => p.state !== 'unlinked').map((p) => p.name.replace(' Ads', '')).join(' · ') || 'مش مربوطة', job: 'أرقام الحملات للميديا باير', imp: 2,
      state: groupState(adParts, null), pauseKeys: ['ads_meta', 'ads_tiktok', 'ads_google'], link: 'ads', stops: 'أرقام الحملات واقتراحات الميديا باير', err: adErr.length ? adErr.map((p) => p.name + ': ' + p.err).join(' · ') : '', parts: adParts });
    // ---- the shipping, the e-mail
    const bosta = P('Bosta API', 'API', 'البوالص والبيك أب وتعديل التحصيل', 'الاتجاهين', { state: keyState(raw, 'bosta') });
    sys.push({ id: 'ship', glyph: 'ship', name: 'الشحن', now: 'بوسطة', job: 'البوالص والبيك أب والتحصيل', imp: 3, state: bosta.state, pauseKeys: ['bosta'], link: 'site', stops: 'إرسال البوالص والطباعة والبيك أب', parts: [bosta] });
    const resend = P('Resend', 'API', 'الإيميلات من السيستم', 'كتابة', { state: keyState(raw, 'resend') });
    sys.push({ id: 'mail', glyph: 'mail', name: 'الإيميل', now: 'Resend', job: 'إيميلات الفريق والتنبيهات والمشاركة', imp: 1, state: resend.state, pauseKeys: ['resend'], link: 'ai', stops: 'إيميل الباسورد للأعضاء والتنبيهات بالإيميل وإرسال الملفات بالإيميل', parts: [resend] });
    // ---- the code (watched from GitHub, not from here)
    sys.push({ id: 'code', glyph: 'code', name: 'الكود والنشر', now: 'GitHub', job: 'كود السيستم واختباراته ونشره', imp: 2, state: linked(raw.links, 'github') ? 'on' : 'idle', locked: true,
      note: 'ده مكان الكود نفسه — بيتتابع ويتظبط من GitHub مش من هنا.', parts: [P('GitHub', 'الكود', 'الريبو والـ PRs', '—', { state: 'idle' }), P('GitHub Actions', 'الاختبارات والنشر', 'الـ CI ونشر الموقع والدوال', '—', { state: 'idle' })] });
    // ---- the other tools (the developer's checks)
    const sp = isObj(raw.speed) ? raw.speed : null;
    sys.push({ id: 'tools', glyph: 'tool', name: 'أدوات تانية', now: 'فحوصات المبرمج', job: 'فحوصات وقراية من برّه', imp: 1, state: 'on', locked: true,
      note: 'فحوصات قراية بس — بتشتغل لوحدها كل يوم.',
      parts: [P('Google PageSpeed', 'API', 'سرعة الموقع كل يوم (المبرمج)', 'قراية', sp ? { ver: sp.score != null ? 'أقل درجة موبايل ' + sp.score : '' } : { state: 'idle', err: 'لسه مااتفحصش' }),
        P('Google Sheets', 'لينك', 'قراية شيت المنتجات في الاستوديو', 'قراية'), P('WordPress.org', 'API', 'آخر نسخة ووردبريس (المبرمج)', 'قراية')] });
    // today's events per group (the activity log since midnight in Cairo)
    const per = countEvents(raw.events);
    sys.forEach((s) => { s.today = per[s.id] || 0; s.pausedTill = s.state === 'paused' ? untilText((s.pauseKeys || []).map((k) => pausedTill(raw.paused, k, now)).filter(Boolean).sort()[0], new Date(now)) : ''; });
    return sys;
  }

  // the activity log's action → the group it happened on and a line in Egyptian Arabic (no ids, no text from the row)
  const EV = [
    [/^order\.(status|confirm)$/, 'site', 'حالة أوردر اتغيّرت'], [/^order\.(patch|address)$/, 'site', 'أوردر اتعدّل'], [/^order\.import$/, 'site', 'أوردرات قديمة اتسحبت'],
    [/^order\.line_/, 'site', 'منتج في أوردر اتعدّل على الموقع'], [/^order\.delete$/, 'site', 'أوردر اتمسح'], [/^order\.rating$/, 'site', 'عميل اتقيّم'],
    [/^suborder\./, 'site', 'أوردر فرعي اتحدّث'], [/^vendor\.sync/, 'site', 'مبتكر اتحدّث من Dokan'], [/^vendor\./, 'site', 'بيانات مبتكر اتعدّلت'],
    [/^product\.ai\.image/, 'image', 'صورة منتج اتولّدت'], [/^product\.ai/, 'text', 'محتوى منتج اتكتب بالـ AI'], [/^product\./, 'site', 'منتج اتحدّث على الموقع'],
    [/^accounts\.withdraw/, 'site', 'طلب سحب على Dokan'], [/bosta/, 'ship', 'حركة على بوسطة'],
    [/^mkt\.campaign\.image|^mkt\.ai\.image|^mkt\.agent\.image/, 'image', 'صورة كامبين اتولّدت'], [/^mkt\.video/, 'video', 'فيديو كامبين بيتعمل'],
    [/^mkt\.ai\.|^mkt\.agent\.|^assistant\./, 'text', 'مساعد رد أو كتب'], [/^mkt\.ads\.|^mkt\.buyer\./, 'ads', 'أرقام أو قرار إعلانات'],
    [/^mkt\.post\./, 'meta', 'بوست اتنشر أو اتجدول'], [/^cs\.channel|^cs\.send|^cs\.msg|^cs\.reply/, 'meta', 'رسالة لعميل'], [/^cs\./, 'meta', 'حركة في خدمة العملاء'],
    [/^share\.email|^hr\.member\.invite/, 'mail', 'إيميل اتبعت'], [/^settings\.integration/, 'core', 'ربط اتعدّل في الإعدادات'],
  ];
  const OUT = /اتبعت|اتنشر|اتولّد|بيتعمل|مساعد رد|اتكتب|على الموقع|بوسطة|طلب سحب|رسالة لعميل/;
  function eventOf(action) {
    const a = String(action || ''); const hit = EV.find(([re]) => re.test(a));
    // `out` = the system sent something out (a pulse from the brain to the group); the rest came in
    return hit ? { sys: hit[1], text: hit[2], out: OUT.test(hit[2]) } : { sys: 'core', text: 'حركة في السيستم', out: false };
  }
  function countEvents(events) { const per = {}; (Array.isArray(events) ? events : []).forEach((e) => { const s = eventOf(e && e.action).sys; per[s] = (per[s] || 0) + 1; }); return per; }
  // the status line under the brain
  function coreLine(sys) { const on = sys.filter((s) => s.state === 'on').length; const bad = sys.filter((s) => s.state === 'err' || s.state === 'paused').length;
    const off = sys.filter((s) => s.state === 'unlinked').length;
    return bad || off ? on + ' شغّالين' + (bad ? ' · ' + bad + ' محتاجين نظرة' : '') + (off ? ' · ' + off + ' مش مربوطين' : '') : 'كله شغّال'; }

  const api = { STATE_TXT, IMP_TXT, SITE_KNOWN, systemsOf, eventOf, countEvents, coreLine, pausedTill, untilText };
  root.IbtekrSysMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
