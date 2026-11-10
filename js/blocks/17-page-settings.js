
/* Settings «الإعدادات» — the v6 prototype's block 20 (7 Nov) on IBSettings (phase 11, docs/superpowers/plans/2026-11-07-phase-11-settings.md
   decision 26): the v6 shapes and sections as they are, hydrated from the settings rows and persisted back through the adapter (the
   bridge at the end of this block redefines the functions that talk to the server). Switches auto-save with toast; forms use the
   Save bar; leaving with unsaved changes asks first. */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button, IconButton } = U; const S = K.store;
  const SECTIONS = [
    ['general', 'عام', 'بيانات الشركة واللغة والعرض', 'home'], ['team', 'الفريق والصلاحيات', 'الأعضاء والأدوار والدعوات', 'users'], ['integrations', 'الربط بالمنصات', 'WooCommerce وAirtable وواتساب', 'external'], ['ai', 'تعليمات الذكاء الاصطناعي', 'الصور، الفيديو، والمحتوى بأسلوب إبتكر', 'sparkle'],
    ['makers', 'إعدادات المبتكرين', 'قواعد التأخير والتنشيط', 'truck'], ['notifications', 'التنبيهات', 'الأنواع والتصعيد وساعات الهدوء', 'bell'], ['lists', 'القوائم والحالات', 'الحالات والأسباب والفئات', 'sliders'],
    ['payments', 'الحسابات والدفع', 'الحسابات والتحويلات والفاتورة', 'wallet'], ['activity', 'سجل النشاط', 'مين عمل إيه وإمتى', 'activity'], ['security', 'الأمان', 'كلمة السر والجلسات والسياسات', 'alert'], ['docs', 'الأوراق الرسمية', 'السجل التجاري والبطاقة الضريبية والعقود', 'file'], ['brand', 'الهوية البصرية', 'ألوان الموقع واللوجو والخطوط', 'image'], ['data', 'البيانات', 'تصدير واستيراد ونسخ احتياطي', 'download'], ['quick', 'الإجراءات السريعة', 'روابط لأي صفحة بفلاترها في القايمة اللي فوق', 'zap']];
  const st = { sec: 'home', ntab: 'types', itab: 'site', teamSub: 'members', integ: null, list: 'order', open: {}, nopen: {}, aopen: {}, dirty: false, draft: null, mq: '', pending: new Set() };
  const R = () => window.IBPages.render('settings');
  const note = (t) => h('p', { class: 't-small help', style: 'margin:0' }, t);
  let ROLES = ['أدمن', 'عمليات', 'خدمة العملاء', 'حسابات', 'متابعة المبتكرين', 'مشاهد'];
  // owner 22 Oct: role popup — every role keeps its column index; a deleted built-in is masked, a deleted custom role is dropped
  const ROLE_DESC = { 'أدمن': 'كل الصلاحيات — المالك والمديرين', 'عمليات': 'الأوردرات والمخزن والتجميع والشحن', 'خدمة العملاء': 'الرسايل وتأكيد الأوردرات ومتابعة العملاء', 'حسابات': 'المصروفات والتحويلات وكشوف المبتكرين', 'متابعة المبتكرين': 'تبليغ المبتكرين ومتابعة التأخير', 'مشاهد': 'عرض بس من غير تعديل' };
  const allNames = () => ROLES.concat(C.custom || []);
  const isRemoved = (r) => (C.removed || []).includes(r);
  const live = () => allNames().map((r, ci) => [r, ci]).filter(([r]) => !isRemoved(r));
  const liveNames = () => live().map((x) => x[0]);
  const roleIndex = (r) => { const i = allNames().indexOf(r); return i < 0 || isRemoved(r) ? ROLES.length - 1 : i; };
  const roleDesc = (r) => ((C.roleInfo || {})[r] != null ? C.roleInfo[r] : ROLE_DESC[r] || '');
  const C = {
    general: { company: 'إبتكر كلوب', legal: 'Ibtekr Club LLC', email: 'hello@ibtekr.club', site: 'https://ibtekr.club', address: 'القاهرة، مصر', phone: '0100 000 0000', tz: '(GMT+3) القاهرة', lang: 'العربية', dateFmt: '20 أكتوبر 2026', currency: 'ج.م — الجنيه المصري', numFmt: '1,234.56', week: 'السبت', compact: true, thumbs: true, rememberFilters: true, hidePhones: true },
    // ✓ F · ▣ P (عرض بدون تعديل) · ☐ N — columns follow ROLES
    perms: [
      ['الأوردرات', [['عرض', 'FFFFFP'], ['تعديل الحالة والتأكيد', 'FFFNFN'], ['تعديل وحذف الأوردر', 'FPNNNN'], ['تصدير', 'FFNFNN']]],
      ['المبتكرين', [['عرض', 'FFPFFP'], ['إضافة وتعديل', 'FPNNFN'], ['تنشيط / إيقاف', 'FNNNNN']]],
      ['الحسابات', [['عرض', 'FPNFNN'], ['إضافة مصروف / حركة', 'FNNFNN'], ['الموافقة على التحويلات', 'FNNPNN']]],
      ['تذاكر الفريق', [['عرض', 'FFFNPP'], ['إنشاء وحل التذاكر', 'FFFNNN']]],
      ['التقارير', [['عرض', 'FFPFPP'], ['تصدير CSV', 'FFNFNN']]],
      ['الإعدادات', [['عرض', 'FPNNNN'], ['تعديل الفريق والربط', 'FNNNNN']]],
      ['بيانات حساسة', [['رؤية أرقام هواتف العملاء', 'FFFNNN', 1], ['رؤية الحساب البنكي للمبتكر', 'FNNFNN', 1], ['تعديل نسب العمولة', 'FNNNNN', 1]]]],
    integrations: [], // filled from the server (settings-admin status + the other pages' links) — phase 11
    syncLog: [],
    woo: { direction: 'both', freq: 'كل 15 دقيقة', conflict: 'آخر تعديل يكسب (حسب الطابع الزمني)', failAlert: true, ent: { orders: true, subs: true, products: true, customers: true, vendors: true } },
    makers: { risk: 9, lead: '12 – 15', counter: 15, late: 11, start: 'تاريخ تبليغ المبتكر ← وإلا تاريخ الأوردر', autoLate: true, autoNoReply: true, autoContract: true, reactivate: true, openEffect: 'تستمر حتى الإغلاق + تنبيه لخدمة العملاء', siteEffect: 'إخفاء منتجاته + منع أوردرات جديدة', deposit: 'عربون 50% للأوردرات فوق 3,000 ج.م', rate: '40%', contractAlert: 'قبل 30 يوم', contractLen: '12 شهر', newStatus: 'نشط بعد رفع العقد', category: '— بدون', pwMode: 'لينك تفعيل على الإيميل', linkTtl: '48 ساعة', forceChange: true, bankRequired: true },
    makerRules: [], // filled from the makers' real lead days (phase 11 decision 17)
    notif: [
      ['عملاء', [['أوردر متأخر — محتاج متابعة مع العميل', 'حتى الإغلاق', 'داخل السيستم + واتساب', 'خدمة العملاء', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['أوردر معلّق — محتاج متابعة', '7 أيام', 'داخل السيستم + واتساب', 'خدمة العملاء', true, '3 مرات', 'كل 24 ساعة'], ['غير مؤكد من العميل', '3 أيام', 'داخل السيستم', 'خدمة العملاء', true], ['في انتظار رد العميل', '2 يوم', 'داخل السيستم', 'خدمة العملاء', true]]],
      ['المبتكرين', [['المتابعة اليومية للمبتكر', 'حتى الإغلاق', 'داخل السيستم + واتساب + إيميل', 'متابعة المبتكرين + المبتكر (واتساب)', true, 'لحد ما يتحل', 'كل 24 ساعة', '10:00 ص'], ['مبتكر قابل للتأخير (9–11 يوم)', 'حتى الإغلاق', 'داخل السيستم', 'متابعة المبتكرين', true], ['عقد مبتكر بينتهي', '30 يوم', 'داخل السيستم + إيميل', 'أدمن', true], ['التقرير الأسبوعي للمبتكر', '7 أيام', 'داخل السيستم + واتساب', 'متابعة المبتكرين + الحسابات + المبتكر (واتساب)', true, 'مرة واحدة', 'أسبوعيًا', '10:00 ص', null, 'الأحد']]],
      ['مهام', [['تذكرة عاجلة / عالية', 'حتى الحل', 'داخل السيستم + واتساب', 'المسؤول عن التذكرة', true, 'لحد ما يتحل', 'كل 4 ساعات'], ['تذكرة متأخرة عن موعد المتابعة', 'حتى الحل', 'داخل السيستم', 'المسؤول + خدمة العملاء', true], ['مراجعة تنشيط مبتكر', 'حتى القرار', 'داخل السيستم', 'أدمن', true], ['فشل مزامنة منصة', 'حتى الإصلاح', 'داخل السيستم + إيميل', 'أدمن', true], ['ملخص يومي', '1 يوم', 'إيميل', 'الكل', true]]],
      ['الفريق', [['طلب إجازة / سُلفة / تصحيح', 'حتى القرار', 'داخل السيستم', 'المدير المباشر', true], ['وقت إضافي محتاج تأكيد', '24 ساعة ثم تصعيد', 'داخل السيستم', 'المدير المباشر ← الأدمن', true], ['ميتنج فردي اتحدد', 'حتى الميعاد', 'داخل السيستم + إيميل', 'العضو + الأدمن', true]]],
      ['الحسابات', [['مرتبات الموظفين — قبل يوم الصرف', 'حتى الدفع', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['كشف حساب المبتكرين', '7 أيام', 'داخل السيستم + واتساب', 'الحسابات + المبتكر (واتساب)', true, 'مرة واحدة', 'أيام محددة من الشهر', '12:00 ص', [16, 'last']], ['اشتراك قرب يخلص', 'حتى التجديد', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['اشتراك خلص من غير تجديد', 'حتى التجديد', 'داخل السيستم + إيميل', 'أدمن + الحسابات', true, 'لحد ما يتحل', 'كل 24 ساعة']]],
      ['المخزن', [['اتحجزت قطعة من المخزن', '3 أيام', 'داخل السيستم', 'أدمن + مسؤول الأوردرات', true], ['قاعدة أكتر من اللازم (تجميع / تصوير)', 'حتى الإجراء', 'داخل السيستم', 'المخزن + العمليات', true], ['مرتجع بانتظار الفحص', 'حتى الفحص', 'داخل السيستم', 'المخزن', true]]], ['التوصيل', [['بوليصة بوسطة مطلوبة', 'حتى التنفيذ', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل', true, 'مرة واحدة', 'كل ساعة'], ['بوليصة متأخرة (أكتر من 24 ساعة)', 'حتى التنفيذ', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل + العمليات', true, 'لحد ما يتحل', 'كل 4 ساعات'], ['ملخص التوصيل اليومي', '1 يوم', 'داخل السيستم + واتساب', 'المسؤول عن التوصيل', true, 'مرة واحدة', 'كل 24 ساعة', '9:00 ص']]]],
    escalations: [{ type: 'مبتكر متأخر', after: '48 ساعة', to: ['دور أدمن'], ch: 'واتساب + إيميل', on: true }, { type: 'غير مؤكد من العميل', after: '24 ساعة', to: ['مدير خدمة العملاء'], ch: 'داخل السيستم', on: true }, { type: 'تذكرة عاجلة بدون رد', after: '4 ساعات', to: ['دور أدمن'], ch: 'واتساب', on: true }, { type: 'فشل مزامنة منصة', after: '1 ساعة', to: ['دور أدمن'], ch: 'إيميل', on: true }, { type: 'وقت إضافي بدون تأكيد', after: '24 ساعة', to: ['دور أدمن'], ch: 'داخل السيستم', on: true }],
    quiet: { days: 'الجمعة', hours: 'من 11:00 م إلى 9:00 ص', waMax: 'رسالتان في اليوم', digest: '9:30 ص · إيميل', signature: 'فريق إبتكر كلوب', langMsg: 'العربية' },
    orderStatuses: [['جاري التنفيذ', 'gold', 'processing', 'نعم', 'مفتوح'], ['معلّق', 'orange', 'on-hold', 'نعم', 'مفتوح'], ['جاهز للشحن', 'info', 'ready-for-shipping', 'نعم', 'مفتوح'], ['قيد الشحن', 'info', 'shipping', 'نعم', 'مفتوح'], ['مكتمل', 'success', 'completed', 'نظامية', 'مغلق'], ['ملغي', 'neutral', 'cancelled', 'نظامية · سبب إجباري', 'مغلق'], ['استرجاع', 'error', 'refunded', 'نظامية', 'مغلق']],
    cancelReasons: [['العميل لا يرد', 'إلغاء', 6, true], ['العميل لم يعد يحتاج المنتج', 'إلغاء', 4, true], ['المنتج غير متوفر عند المبتكر', 'إلغاء · استرجاع', 3, true], ['تأخير المبتكر', 'إلغاء · استرجاع', 2, true], ['خلاف على السعر أو الشحن', 'إلغاء', 1, true], ['أوردر تجريبي', 'مسح', 2, true], ['العميل عايز يعدل الأوردر', 'مسح', 1, true], ['أخرى (نص حر إجباري)', 'إلغاء · مسح · استرجاع', 3, true]],
    otherLists: { confirm: ['مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد'], sub: ['غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن', 'تم الشحن للمخزن', 'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر'], returns: O.RETURN_REASONS.slice(), expenses: ['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات'], categories: ['ديكور', 'إكسسوارات', 'ملابس', 'أثاث', 'فنون', 'هدايا', 'أغذية', 'أخرى'], stop: ['تأخير متكرر', 'جودة', 'عدم رد', 'طلب المبتكر', 'أخرى'], priorities: ['عاجل', 'عالي', 'عادي', 'منخفض'] },
    accounts: [{ name: 'البنك الأهلي — الحساب الجاري', kind: 'بنك', ident: 'EG•••• •••• 4821', link: 'يدوي', on: true }, { name: 'حساب بوسطة', kind: 'شركة شحن', ident: 'BST-10422', link: 'يدوي', on: true }, { name: 'Paymob', kind: 'بوابة دفع', ident: 'merchant_7f2a', link: 'غير مربوط', on: false }, { name: 'المحفظة الإلكترونية (فودافون كاش)', kind: 'محفظة', ident: '0100 000 0000', link: 'يدوي', on: true }, { name: 'خزنة المكتب', kind: 'نقدي', ident: '—', link: 'يدوي', on: true }],
    payout: { after: 'مكتمل + 7 أيام (فترة الاسترجاع)', min: '500 ج.م', cycle: 'كل أسبوعين — يوم الأحد', notify: 'واتساب + كشف حساب PDF', method: 'تحويل بنكي (InstaPay)', approval: 'حسابات + أدمن (توقيعان)', deductDeposit: true, holdLate: true, invLang: 'عربي + إنجليزي', tax: '—', prefix: 'IBT-2026-', next: 'IBT-2026-0147', commission: 'نعم', orders: 'نعم — جدول الأوردرات المكتملة', footer: 'شكرًا لكونك جزءًا من مجتمع إبتكر' },
    activity: [], // the real log is read with filters (phase 11 decision 18)
    actSet: { sensitiveViews: true, permAlert: true, dailyCopy: false },
    security: { force2fa: false, idle: true, maskCustomers: true, blockExport: true, ipOnly: false, pwMin: '8 أحرف + رقم', idleDesktop: '8 ساعات (تحذير قبلها بدقيقة)', idleMobile: '7 أيام' },
    sessions: [['Chrome · macOS', 'القاهرة، مصر', 'الآن', 'الجلسة الحالية'], ['Safari · iPhone', 'القاهرة، مصر', 'اليوم 09:12', 'نشطة'], ['Chrome · Windows', 'الجيزة، مصر', 'منذ 5 أيام', 'نشطة']],
    exports: [['الأوردرات والأوردرات الفرعية', '1,214', 'اليوم 09:00', 'آخر 30 يوم'], ['المبتكرين والنسب', '31', 'منذ 3 أيام', 'الكل'], ['الحسابات (مصروفات، حركات، تحويلات)', '412', 'أمس', 'سبتمبر 2026'], ['التذاكر', '38', '—', 'الكل'], ['الفريق والحضور والمرتبات', '7', '—', 'أكتوبر 2026'], ['المخزن (القطع والحركات)', '—', '—', 'الكل'], ['سجل النشاط', '1,240', '—', 'آخر 7 أيام']],
    backup: { daily: true, drive: false, inactive: 'لا — يدوي فقط', orders: 'بلا حد (أرشفة بعد 12 شهر)', log: '24 شهر', importKey: 'Vendor ID', onMatch: 'تحديث السجل الموجود', importSet: 'المبتكرين' },
  };

  // ---------- تعليمات الذكاء الاصطناعي (26 Oct · Figma 705:11500 / 705:12015 / 705:12511) ----------
  const AI_DEF = () => ({ slots: ['تركيز على المنتج في النص، خلفية كريم نضيفة، إضاءة ناعمة، من غير ظلال قوية.', 'المنتج في مكانه الطبيعي في بيت مصري دافي، ألوان هادية، من غير ناس.', 'قرّب على الخامة أو التفصيلة اللي بتميّز المنتج (خياطة، نسيج، حفر).', 'المنتج على خلفية إبتكر وخطوط الأبعاد دهبي، والأرقام بالسنتيمتر.'],
    style: 'هاندميد، دافي، طبيعي. ألوان البراند: أخضر غامق ودهبي وكريم. من غير فلاتر مبالغ فيها.', size: '700 × 800 · طولي', fmt: 'WebP', pattern: true, imgNo: ['نصوص مكتوبة', 'علامات مائية', 'أيدي مشوهة', 'لوجوهات براندات تانية'],
    vModel: 'Seedance 2.5', vSize: '9:16', vDur: '15 ثانية', vRes: '1080p', vMusic: 'دافية هادية', vVoice: 'صوت ست — مصري', vScenes: 'أول 3 ثواني فيها المنتج واضح. حركة كاميرا ناعمة. آخر مشهد لوجو إبتكر على خلفية كريم مع ibtekr.club.', vNo: ['كلام مكتوب غلط', 'موسيقى عليها حقوق', 'وشوش حقيقية من غير إذن'],
    lang: 'عربي مصري + English', tone: 'دافي وبسيط', voice: 'بنتكلم مع الناس كأننا صحابهم: دافي، بسيط، فخورين بالشغل اليدوي المصري. بنحكي عن الصانع والخامة، مش بس المنتج.', rules: 'اسم البراند والمبتكر بيفضل بالإنجليزي. من غير وعود مش حقيقية (زي «الأرخص في مصر»). الوصف القصير لحد 160 حرف.', words: ['الأرخص', 'أصلي 100%', 'ضمان مدى الحياة'], tags: '#إبتكر #هاندميد #صنع_في_مصر', sections: AI_SECTIONS_DEF() });
  // أقسام التعليمات (owner 27 Oct): جوه كل نوع (صور/فيديو/محتوى) تابات — «المنتجات» (الموجود) + «البوست» + أقسام يضيفها المستخدم
  const AI_PRODUCTS = { img: 'صور المنتجات', vid: 'فيديوهات المنتجات', txt: 'محتوى المنتجات' };
  const AI_SIZES = { img: ['1080 × 1080 · مربع', '1080 × 1350 · طولي 4:5', '1080 × 1920 · ستوري', '700 × 800 · طولي'], vid: ['9:16', '1:1', '4:5', '16:9'] };
  function aiSecDefault(type, name) {
    if (type === 'img') return { name, prompt: '', size: AI_SIZES.img[0], textOn: false, logo: true, no: [] };
    if (type === 'vid') return { name, prompt: '', size: '9:16', dur: '15 ثانية', music: 'دافية هادية', no: [] };
    return { name, prompt: '', len: 'متوسط — لحد 300 حرف', tone: 'دافي وبسيط', tags: '', no: [] };
  }
  function AI_SECTIONS_DEF() {
    return {
      img: [Object.assign(aiSecDefault('img', 'البوست'), { id: 'post', prompt: 'بوست سوشيال ميديا: المنتج بطل الصورة على خلفية من ألوان إبتكر (أخضر غامق، دهبي، كريم). مساحة فاضية فوق أو تحت للعنوان. لمسة هاندميد (خيوط، خشب، كتان).', size: '1080 × 1350 · طولي 4:5', textOn: true, no: ['أسعار مكتوبة على الصورة', 'لوجوهات براندات تانية'] })],
      vid: [Object.assign(aiSecDefault('vid', 'البوست'), { id: 'post', prompt: 'ريلز/بوست قصير: أول ثانيتين hook (المنتج في إيد الصانع أو حركة سريعة). مشاهد قصيرة 2–3 ثواني. نص قصير على الشاشة. آخر مشهد لوجو إبتكر + ibtekr.club.', size: '9:16', dur: '15 ثانية', music: 'مبهجة', no: ['موسيقى عليها حقوق'] })],
      txt: [Object.assign(aiSecDefault('txt', 'البوست'), { id: 'post', prompt: 'كابشن بوست: سطر أول يشد (سؤال أو حكاية الصانع)، بعدين 2–3 سطور عن المنتج والخامة، وفي الآخر CTA واضح (اطلبه من ibtekr.club أو ابعتلنا رسالة). إيموجي قليل.', len: 'قصير — لحد 150 حرف', tags: '#إبتكر #هاندميد #صنع_في_مصر', no: ['الأرخص', 'عرض لفترة محدودة (لو مش حقيقي)'] })],
    };
  }
  // باترن إبتكر (owner 26 Oct): صورة الباترن اللي بتتحط على صور المنتجات بتتغير من هنا (PNG شفاف) + الشفافية والحجم.
  function applyPattern(A) { const r = document.documentElement.style; if (A.patImg) { r.setProperty('--pat-img', 'url("' + A.patImg + '")'); r.setProperty('--pat-size', (A.patSize || 120) + 'px'); } else { r.removeProperty('--pat-img'); r.removeProperty('--pat-size'); } r.setProperty('--pat-op', String((A.patOp || 18) / 100)); }
  function patternCard(A) {
    const inp = h('input', { type: 'file', accept: 'image/png,image/svg+xml,image/webp', class: 'sr-file', id: 'pat-file', onChange: () => { const f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { A.patImg = rd.result; A.patName = f.name; applyPattern(A); LOGV('settings.pattern', f.name); K.toast('اتغيرت صورة الباترن — هتظهر على كل الصور', 'success'); R(); }; rd.readAsDataURL(f); } });
    return h('div', { class: 'pat-card' }, h('div', { class: 'pat-pv', role: 'img', 'aria-label': 'معاينة الباترن على صورة منتج' }, h('i', { class: 'pat', 'aria-hidden': 'true' })),
      h('div', { class: 'pat-meta' }, h('b', null, 'صورة الباترن'), h('small', { class: 't-small help' }, A.patName ? A.patName : 'الافتراضي: خطوط إبتكر الدهبي المايلة'), h('div', { class: 'acts-inline start' }, h('label', { class: 'btn btn-default sm', for: 'pat-file', tabindex: '0', role: 'button', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, 'ارفع صورة باترن', inp), A.patImg ? Button({ type: 'text', size: 'sm', label: 'رجّع الافتراضي', onClick: () => { A.patImg = null; A.patName = null; applyPattern(A); R(); } }) : null),
        K.two(U.Select({ id: 'pat-op', label: 'الشفافية', options: [10, 18, 25, 35].map((x) => ({ value: String(x), label: x + '%' })), value: String(A.patOp || 18), onChange: (v) => { A.patOp = Number(v); applyPattern(A); R(); } }), U.Select({ id: 'pat-size', label: 'حجم التكرار', options: [80, 120, 200, 400].map((x) => ({ value: String(x), label: x + 'px' })), value: String(A.patSize || 120), onChange: (v) => { A.patSize = Number(v); applyPattern(A); R(); } })), h('small', { class: 't-small help' }, 'PNG أو SVG شفاف · بيتكرر على الصورة كلها · بيتطبق على كل الدفعات الجاية.')));
  }
  function aiSecV6() {
    S.aiRules = S.aiRules || AI_DEF(); const A = S.aiRules; st.aiTab = st.aiTab || 'img';
    const area = (id, label, key, i) => U.Textarea({ id: 'ai-' + id, label, rows: 3, value: i == null ? A[key] : A[key][i], onInput: (v) => { if (i == null) A[key] = v; else A[key][i] = v; } });
    const sel = (id, label, key, opts) => U.Select({ id: 'ai-' + id, label, options: opts.map((x) => ({ value: x, label: x })), value: A[key], onChange: (v) => { A[key] = v; R(); } });
    const words = (id, label, key) => U.FieldShell({ id: 'ai-' + id, label }, h('div', { class: 'chips' }, A[key].map((w) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'aria-label': 'شيل ' + w, onClick: () => { A[key] = A[key].filter((x) => x !== w); R(); } }, w + ' ✕')), Button({ size: 'sm', label: '+ ضيف', onClick: () => K.form({ title: 'ضيف لـ «' + label + '»', values: { w: '' }, fields: (f, e, set) => [K.field.text('w', 'الكلمة', f, e, set, { required: true })], validate: (f) => K.req(f, ['w']), submit: (f) => { A[key] = A[key].concat(f.w); R(); } }) })));
    const head = K.Section('تعليمات الذكاء الاصطناعي', [K.MainTabs({ items: [{ id: 'img', label: 'الصور' }, { id: 'vid', label: 'الفيديو' }, { id: 'txt', label: 'المحتوى' }], active: st.aiTab, onChange: (id) => { st.aiTab = id; R(); }, label: 'نوع التعليمات' })], [Button({ type: 'text', label: 'رجّع للافتراضي', onClick: () => K.confirm({ title: 'ترجّع التعليمات للافتراضي؟', text: 'كل التعديلات اللي عملتها هنا هتتشال.', okLabel: 'رجّع', onOk: () => { S.aiRules = AI_DEF(); R(); } }) }), Button({ type: 'primary', label: 'احفظ التعليمات', onClick: () => { LOGV('settings.ai.save', st.aiTab); K.toast('اتحفظت التعليمات — هتتطبق على أي حاجة جديدة بتتولد', 'success'); } })], { sub: 'بتتطبق على كل حاجة بتتولد في «المنتجات» و«التسويق» — اكتبها مرة واحدة.' });
    A.sections = A.sections || AI_SECTIONS_DEF(); st.aiSub = st.aiSub || {}; const T = st.aiTab; const secs = A.sections[T]; const sub = st.aiSub[T] && (st.aiSub[T] === 'products' || secs.some((x) => x.id === st.aiSub[T])) ? st.aiSub[T] : 'products';
    const subTabs = h('div', { class: 'ai-subs' }, K.SubTabs({ items: [{ id: 'products', label: AI_PRODUCTS[T] }].concat(secs.map((x) => ({ id: x.id, label: x.name }))), active: sub, onChange: (id) => { st.aiSub[T] = id; R(); }, label: 'أقسام ' + { img: 'الصور', vid: 'الفيديو', txt: 'المحتوى' }[T] }), Button({ size: 'sm', type: 'text', icon: 'plus', label: 'قسم جديد', attrs: { 'data-ai-addsec': '' }, onClick: () => addAiSection(A, T) }));
    let body;
    if (sub !== 'products') body = aiCustom(A, T, secs.find((x) => x.id === sub), area, words);
    else if (st.aiTab === 'img') body = [K.Section('قواعد الخانات الأربعة', ['Close-up', 'البيئة المحيطة', 'Feature', 'المقاسات'].map((l, i) => area('s' + i, (i + 1) + ' · ' + l, 'slots', i)), null, { sub: 'كل خانة في خطوة الصور بتتولد بالتعليمات دي.' }),
      K.Section('الستايل العام', [area('style', 'وصف الستايل', 'style'), K.two(sel('size', 'المقاس الافتراضي', 'size', ['700 × 800 · طولي', '1080 × 1080 · مربع']), sel('fmt', 'الصيغة', 'fmt', ['WebP', 'JPG', 'PNG'])), K.Switch({ id: 'ai-pat', label: 'باترن إبتكر على الصور', help: 'الافتراضي في كل دفعة — وتقدر تشيله من أي صورة', checked: A.pattern, onChange: (v) => { A.pattern = v; R(); } }), patternCard(A), words('imgNo', 'ممنوع في الصور', 'imgNo'), K.field.file('ref', 'صور مرجعية للبراند', { ref: '' }, {}, () => K.toast('اترفعت الصورة المرجعية'), { accept: 'image/*', help: 'الـ AI بيقلّد الستايل منها' })])];
    else if (st.aiTab === 'vid') body = [K.Section('إعدادات الفيديو الافتراضية', [K.two(sel('vm', 'الموديل الافتراضي', 'vModel', ['Seedance 2.5', 'Seedance 2.0', 'Kling 2.5', 'MiniMax H3']), sel('vs', 'المقاس', 'vSize', ['9:16', '1:1', '4:5', '16:9'])), K.two(sel('vd', 'المدة', 'vDur', ['10 ثواني', '15 ثانية', '30 ثانية']), sel('vr', 'الجودة', 'vRes', ['1080p', '720p', '4K'])), K.two(sel('vmu', 'المزيكا الافتراضية', 'vMusic', ['دافية هادية', 'شرقي حديث', 'مبهجة', 'سينمائي']), sel('vv', 'الفويس أوفر', 'vVoice', ['صوت ست — مصري', 'صوت راجل — مصري', 'English — female'])), area('vsc', 'تعليمات المشاهد', 'vScenes'), words('vNo', 'ممنوع', 'vNo')], null, { sub: 'بتتحط أول ما تفتح أداة الفيديو أو فيديوهات الكامبين.' })];
    else body = [K.Section('أسلوب الكتابة', [K.two(sel('lang', 'اللغة الأساسية', 'lang', ['عربي مصري + English', 'عربي فصحى مبسط + English', 'English بس']), sel('tone', 'الأسلوب', 'tone', ['دافي وبسيط', 'فخم', 'مختصر جدًا'])), area('voice', 'صوت البراند', 'voice'), area('rules', 'قواعد ثابتة', 'rules'), words('words', 'كلمات ممنوعة', 'words'), U.TextInput({ id: 'ai-tags', label: 'هاشتاجات ثابتة', value: A.tags, onInput: (v) => { A.tags = v; } })], null, { sub: 'للأسماء والأوصاف والكابشن والهاشتاجات.' })];
    return [head, subTabs, ...body, U.InlineNote({ children: 'التعليمات بتتبعت مع كل طلب للـ AI. الـ AI مش بيكتب أسعار ولا أكواد SKU أبدًا.' })];
  }
  function addAiSection(A, T) {
    const L = A.sections[T]; const names = [AI_PRODUCTS[T]].concat(L.map((x) => x.name));
    K.form({ title: 'قسم جديد — ' + { img: 'الصور', vid: 'الفيديو', txt: 'المحتوى' }[T], values: { name: '', from: '' },
      fields: (f, e, set) => [K.field.text('name', 'اسم القسم', f, e, set, { required: true, placeholder: { img: 'مثلاً: الستوري، الإعلانات، البانر', vid: 'مثلاً: إعلان 30 ثانية، Unboxing', txt: 'مثلاً: الإعلانات، رسايل واتساب، المدونة' }[T] }),
        K.field.select('from', 'ابدأ من', [{ value: '', label: 'فاضي' }].concat(L.map((x) => ({ value: x.id, label: 'نسخة من «' + x.name + '»' }))), f, e, set)],
      validate: (f) => { const n = (f.name || '').trim(); if (!n) return { name: 'اكتب اسم القسم' }; if (names.some((x) => x.trim().toLowerCase() === n.toLowerCase())) return { name: 'فيه قسم بنفس الاسم' }; return {}; },
      submitLabel: 'ضيف القسم', submit: (f) => { const src = L.find((x) => x.id === f.from); const sec = Object.assign(src ? JSON.parse(JSON.stringify(src)) : aiSecDefault(T, ''), { id: 'c' + Date.now().toString(36), name: f.name.trim(), custom: true }); L.push(sec); st.aiSub[T] = sec.id; LOGV('settings.ai.section', T + ' · ' + sec.name); K.toast('اتضاف قسم «' + sec.name + '»', 'success'); R(); } });
  }
  function aiCustom(A, T, x, area0, words0) {
    const L = A.sections[T];
    const ar = (id, label, key, help) => U.Textarea({ id: 'ais-' + id, label, rows: 4, value: x[key], help, onInput: (v) => { x[key] = v; } });
    const sl = (id, label, key, opts) => U.Select({ id: 'ais-' + id, label, options: opts.map((o) => ({ value: o, label: o })), value: x[key], onChange: (v) => { x[key] = v; R(); } });
    const no = U.FieldShell({ id: 'ais-no', label: 'ممنوع في القسم ده' }, h('div', { class: 'chips' }, x.no.map((w) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'aria-label': 'شيل ' + w, onClick: () => { x.no = x.no.filter((y) => y !== w); R(); } }, w + ' ✕')), Button({ size: 'sm', label: '+ ضيف', onClick: () => K.form({ title: 'ممنوع في «' + x.name + '»', values: { w: '' }, fields: (f, e, set) => [K.field.text('w', 'الكلمة', f, e, set, { required: true })], validate: (f) => K.req(f, ['w']), submit: (f) => { x.no = x.no.concat(f.w); R(); } }) })));
    const fields = T === 'img' ? [ar('p', 'التعليمات', 'prompt', 'اوصف شكل الصورة: الخلفية، الإضاءة، الزاوية، فين المساحة الفاضية للكلام…'), K.two(sl('size', 'المقاس الافتراضي', 'size', AI_SIZES.img), U.Select({ id: 'ais-logo', label: 'لوجو إبتكر', options: [{ value: 'yes', label: 'يتحط على الصورة' }, { value: 'no', label: 'من غير لوجو' }], value: x.logo ? 'yes' : 'no', onChange: (v) => { x.logo = v === 'yes'; R(); } })), K.Switch({ id: 'ais-text', label: 'مسموح بكلام مكتوب على الصورة', help: 'للبوستات والإعلانات — العنوان بيتكتب بخط Cairo', checked: x.textOn, onChange: (v) => { x.textOn = v; R(); } }), no]
      : T === 'vid' ? [ar('p', 'تعليمات المشاهد', 'prompt', 'الـ hook، طول كل مشهد، الكلام على الشاشة، آخر مشهد…'), K.two(sl('size', 'المقاس', 'size', AI_SIZES.vid), sl('dur', 'المدة', 'dur', ['10 ثواني', '15 ثانية', '30 ثانية', '60 ثانية'])), sl('music', 'المزيكا', 'music', ['دافية هادية', 'شرقي حديث', 'مبهجة', 'سينمائي']), no]
        : [ar('p', 'التعليمات', 'prompt', 'شكل الكتابة: أول سطر، الطول، الـ CTA، الإيموجي…'), K.two(sl('len', 'الطول', 'len', ['قصير — لحد 150 حرف', 'متوسط — لحد 300 حرف', 'طويل — مقال']), sl('tone', 'الأسلوب', 'tone', ['دافي وبسيط', 'فخم', 'مختصر جدًا', 'حماسي'])), U.TextInput({ id: 'ais-tags', label: 'هاشتاجات', value: x.tags, onInput: (v) => { x.tags = v; } }), no];
    const acts = [Button({ size: 'sm', type: 'text', label: 'غيّر الاسم', attrs: { 'data-ai-rename': '' }, onClick: () => K.form({ title: 'اسم القسم', values: { name: x.name }, fields: (f, e, set) => [K.field.text('name', 'الاسم', f, e, set, { required: true })], validate: (f) => { const n = (f.name || '').trim(); if (!n) return { name: 'اكتب الاسم' }; if ([AI_PRODUCTS[T]].concat(L.filter((y) => y !== x).map((y) => y.name)).some((y) => y.trim().toLowerCase() === n.toLowerCase())) return { name: 'فيه قسم بنفس الاسم' }; return {}; }, submit: (f) => { x.name = f.name.trim(); R(); } }) }),
      Button({ size: 'sm', type: 'text', label: 'امسح القسم', attrs: { 'data-ai-delsec': '' }, onClick: () => K.confirm({ title: 'تمسح قسم «' + x.name + '»؟', text: 'التعليمات بتاعته هتتمسح، والحاجات اللي بتتولد له هترجع تستخدم «' + AI_PRODUCTS[T] + '».', okLabel: 'امسح', okType: 'danger', onOk: () => { L.splice(L.indexOf(x), 1); st.aiSub[T] = 'products'; K.toast('اتمسح القسم'); R(); } }) })];
    return [K.Section(x.name, fields, acts, { sub: 'تعليمات «' + x.name + '» — بتتطبق مع الستايل العام والقواعد الثابتة.' })];
  }
  // الإعدادات كصفحة كروت (owner 1 Nov 22:51): مجموعات · كل قسم كارت فيه بيتحكم في إيه + رقم الحالة + «تعديل» بيفتح صفحة لوحده
  const GROUPS = [['الشركة والفريق', ['general', 'team', 'docs', 'brand']], ['الربط والأدوات', ['integrations', 'ai', 'quick']], ['التشغيل', ['makers', 'notifications', 'lists', 'payments']], ['الأمان والبيانات', ['security', 'activity', 'data']]];
  const STATS = {
    general: () => [C.general.company, 'neutral'],
    team: () => { const a = S.members.filter((m) => m.status === 'active').length, inv = S.members.filter((m) => m.status === 'invited').length; return [a + ' عضو' + (inv ? ' · ' + inv + ' دعوة معلّقة' : ''), inv ? 'gold' : 'neutral']; },
    docs: () => { const soon = docs.filter((x) => x.expires && daysTo(x.expires) <= 30).length; return [docs.length + ' ورقة' + (soon ? ' · ' + soon + ' بتنتهي قريب' : ''), soon ? 'orange' : 'neutral']; },
    brand: () => { const n = Object.keys(brand.colors).length + ['color', 'reversed', 'mark'].filter((t) => window.IBLogo.get(t)).length; return [n ? n + ' تعديل على الأصلي' : 'الهوية الأصلية', n ? 'gold' : 'neutral']; },
    integrations: () => { const all = C.integrations, on = all.filter((x) => x.status === 'متصل').length, err = all.filter((x) => String(x.status).startsWith('خطأ')).length; return [on + ' من ' + all.length + ' متصلة' + (err ? ' · ' + err + ' فيها خطأ' : ''), err ? 'error' : 'success']; },
    quick: () => { const n = window.IBQuick ? window.IBQuick.list().length : 0; return [n + ' إجراء سريع', 'neutral']; },
    makers: () => [C.makerRules.length + ' قاعدة تأخير خاصة', 'neutral'],
    notifications: () => [C.notif.length + ' نوع تنبيه · ' + C.escalations.length + ' تصعيد', 'neutral'],
    activity: () => { const n = (K.store.log || []).length; return [n ? n + ' حدث متسجل' : 'مين عمل إيه وإمتى', 'neutral']; },
  };
  function hub() {
    const card = (id) => { const x = SECTIONS.find((q) => q[0] === id); if (!x) return null; const [, t, d, ic] = x; let stt = null; try { stt = STATS[id] ? STATS[id]() : null; } catch (e) { stt = null; }
      return h('section', { class: 'card set-card', 'data-set-card': id }, h('div', { class: 'set-card-h' }, h('span', { class: 'set-ic' }, Icon(ic)), h('h3', { class: 't-h5' }, t)), h('p', { class: 't-small help' }, d), stt ? K.Tag(stt[1], stt[0]) : null,
        st.pending.has(id) ? K.Tag('orange', 'تغييرات مش محفوظة') : null, h('span', { class: 'grow' }), Button({ iconEnd: 'chevL', label: 'تفاصيل', attrs: { 'aria-label': 'تفاصيل ' + t, 'data-set-edit': id }, onClick: () => openSec(id) })); };
    return [K.PageHead('الإعدادات', 'إعدادات الشركة والفريق والربط — للأدمن بس'), ...GROUPS.map(([g, ids]) => h('div', { class: 'set-group', 'data-set-group': g }, h('h2', { class: 't-h5 set-gt' }, g), h('div', { class: 'set-grid' }, ids.map(card))))];
  }
  function openSec(id) { st.sec = id; st.integ = null; st.dirty = st.pending.has(id); try { history.replaceState(null, '', '#settings-' + id); } catch (e) { /* */ } R(); window.scrollTo(0, 0); }
  function goHub() { leave(() => { st.sec = 'home'; st.integ = null; try { history.replaceState(null, '', '#settings'); } catch (e) { /* */ } R(); window.scrollTo(0, 0); }); }
  function viewV6() {
    if (st.sec === 'home' || !SECTIONS.some((q) => q[0] === st.sec)) { st.snapSec = null; return hub(); }
    const x = SECTIONS.find((q) => q[0] === st.sec);
    // زرار «حفظ» في كل صفحة (owner 2 Nov 01:34) + أي تغيير في الصفحة بيتعلّم «مش محفوظ» من غير ما الصفحة تتعاد
    const note = h('span', { class: 'set-dirty t-small', 'data-set-dirty': '', hidden: !st.dirty }, Icon('alert', 'sm'), ' تغييرات مش محفوظة');
    const save = Button({ type: 'brand', icon: 'check', label: 'حفظ', attrs: { 'data-set-save': '' }, onClick: () => { commit(); R(); } });
    if (st.snapSec !== st.sec) { st.snap = snapTake(); st.snapSec = st.sec; }
    const body = h('div', { class: 'set-body set-page' }, ...section());
    const mark = () => { if (st.dirty) return; st.dirty = true; note.hidden = false; const pg = document.getElementById('pg-settings'); if (pg && !pg.querySelector('.save-bar')) pg.append(saveBar()); };
    // التحديد في الجداول والفلاتر والتابات مش «تغيير» — مش بيطلّع تذكير الحفظ
    const skip = (t) => !t || t.type === 'search' || !!t.closest('.search-field, [role=search], .toolbar label.search, [data-bulk-box], [data-bulk], .bulk-bar, [role=tab], .subtabs, [data-fm], [data-af], [data-sm-btn], .pop-anchor[data-popover-root] .menu');
    body.addEventListener('input', (e) => { if (!skip(e.target)) mark(); }, true);
    body.addEventListener('change', (e) => { if (!skip(e.target)) mark(); }, true);
    body.addEventListener('click', (e) => { if (!skip(e.target) && e.target.closest('[role=switch], [role=radio], [role=checkbox], .chip, [role=option]')) mark(); }, true);
    return [h('div', { class: 'set-back' }, Button({ type: 'text', size: 'sm', icon: 'chevR', label: 'رجوع للإعدادات', attrs: { 'data-set-back': '' }, onClick: goHub })), K.PageHead(x[1], x[2], [note, save]), body, st.dirty ? saveBar() : null];
  }
  // «تجاهل التغييرات» بيرجّع البيانات فعلًا: لقطة من الإعدادات أول ما القسم يفتح (وبعد كل حفظ)
  const LOGO_T = ['color', 'reversed', 'mark'];
  const snapTake = () => { try { return { c: JSON.stringify(C), m: JSON.stringify(S.members || []), a: S.aiRules ? JSON.stringify(S.aiRules) : null, logos: LOGO_T.map((t) => (window.IBLogo && window.IBLogo.get ? window.IBLogo.get(t) : null)) }; } catch (e) { return null; } };
  function restoreInto(t, v) { if (Array.isArray(t) && Array.isArray(v)) { t.splice(0, t.length, ...v); return; } if (t && v && typeof t === 'object' && typeof v === 'object') { Object.keys(t).forEach((x) => { if (!(x in v)) delete t[x]; }); Object.assign(t, v); } }
  function discard() {
    const s0 = st.snap; const nm = (SECTIONS.find((q) => q[0] === st.sec) || [, ''])[1];
    if (s0) { const c = JSON.parse(s0.c); Object.keys(c).forEach((x) => { if (C[x] && typeof C[x] === 'object') restoreInto(C[x], c[x]); else C[x] = c[x]; });
      if (S.members) restoreInto(S.members, JSON.parse(s0.m)); if (s0.a && S.aiRules) restoreInto(S.aiRules, JSON.parse(s0.a));
      LOGO_T.forEach((t, i) => { if (window.IBLogo && window.IBLogo.get(t) !== s0.logos[i]) window.IBLogo.set(t, s0.logos[i]); });
      try { applyBrand(); saveBrand(); } catch (e) { /* brand section not loaded */ } }
    st.dirty = false; st.draft = null; st.pending.delete(st.sec); LOGV('settings.discard', nm); K.toast('اتلغت التغييرات ورجعت زي ما كانت');
  }
  function leave(go) {
    if (!st.dirty) return go();
    // مفيش خروج من غير حفظ (owner 2 Nov 02:51): البوب أب بيطلب الحفظ — يا «احفظ واخرج» يا «ارجع للصفحة» (والتجاهل من شريط الحفظ تحت بس)
    const sec = st.sec; const name = (SECTIONS.find((q) => q[0] === sec) || [, ''])[1];
    const here = () => { try { history.replaceState(null, '', sec === 'home' ? '#settings' : '#settings-' + sec); } catch (e) { /* */ } };
    here();
    const m = U.Modal({ title: 'لازم تحفظ التغييرات الأول', body: [h('p', { style: 'margin:0' }, 'عملت تغييرات في «' + name + '» ولسه ما اتحفظتش. احفظها عشان تقدر تخرج من الصفحة.'), h('p', { class: 't-small help', style: 'margin:8px 0 0' }, 'لو مش عايز التغييرات دي: ارجع للصفحة ودوس «تجاهل التغييرات» في الشريط اللي تحت.')],
      footer: [Button({ label: 'ارجع للصفحة', attrs: { 'data-save-stay': '' }, onClick: () => { m.close(); here(); R(); } }), Button({ type: 'primary', icon: 'check', label: 'احفظ واخرج', attrs: { 'data-save-now': '' }, onClick: () => { commit(); m.close(); go(); } })] });
  }
  function commit() { const nm = (SECTIONS.find((q) => q[0] === st.sec) || [, 'عام'])[1]; if (st.draft) Object.assign(C.general, st.draft); st.dirty = false; st.draft = null; st.pending.delete(st.sec); st.snap = snapTake(); st.snapSec = st.sec; LOGV('settings.save', nm); K.toast('اتحفظت التغييرات', 'success'); }
  function saveBar() { return h('div', { class: 'save-bar', role: 'region', 'aria-label': 'تغييرات غير محفوظة' }, h('span', null, Icon('alert', 'sm'), ' فيه تغييرات غير محفوظة في هذا القسم'), h('div', { class: 'acts-inline' }, Button({ label: 'تجاهل التغييرات', attrs: { 'data-set-discard': '' }, onClick: () => { discard(); R(); } }), Button({ type: 'primary', label: 'حفظ التغييرات', onClick: () => { commit(); R(); } }))); }
  // Setting row with switch (auto-save + toast)
  const row = (title, desc, on, set) => h('div', { class: 'set-row' }, h('div', null, h('b', null, title), desc ? h('div', { class: 't-small help' }, desc) : null), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(!!on), 'aria-label': title, onClick: () => { set(!on); LOGV('settings.toggle', title + ' = ' + !on); K.toast((!on ? 'اتفعّل: ' : 'اتقفل: ') + title); R(); } }, h('i')));
  const vrow = (title, desc, ctl) => h('div', { class: 'set-row' }, h('div', null, h('b', null, title), desc ? h('div', { class: 't-small help' }, desc) : null), ctl);
  const pick = (obj, k, id, label, opts, help) => h('div', null, U.Select({ id, label, options: opts.map((x) => ({ value: String(x), label: String(x) })), value: String(obj[k]), onChange: (v) => { obj[k] = v; LOGV('settings.change', label + ' = ' + v); K.toast('اتحفظ'); R(); } }), help ? h('div', { class: 't-small help' }, help) : null);
  const tagFor = (s) => (s === 'متصل' ? 'success' : s.startsWith('خطأ') ? 'error' : 'neutral');

  function section() {
    switch (st.sec) {
      case 'general': return general();
      case 'team': return teamSec();
      case 'integrations': return st.integ === 'woo' ? wooPage() : st.integ === 'wa' ? waPage() : integrations();
      case 'ai': return aiSec();
      case 'quick': return window.IBQuick ? [window.IBQuick.manage(R)] : [];
      case 'makers': return makers();
      case 'notifications': return notifSec();
      case 'lists': return lists();
      case 'payments': return payments();
      case 'activity': return activity();
      case 'security': return security();
      case 'docs': return docsSec();
      case 'brand': return brandSec();
      default: return data();
    }
  }

  // ---------- عام ----------
  function general() {
    const g = st.draft || C.general; const ed = (k) => (v) => { st.draft = Object.assign({}, st.draft || C.general, { [k]: v }); if (!st.dirty) { st.dirty = true; R(); } };
    const sel = (k, id, label, opts, help) => h('div', null, U.Select({ id, label, required: true, options: opts.map((x) => ({ value: x, label: x })), value: g[k], onChange: (v) => { ed(k)(v); R(); } }), help ? h('div', { class: 't-small help' }, help) : null);
    return [K.Section('بيانات الشركة', [vrow('اللوجو', 'PNG أو SVG · مربع 512×512 · يُستخدم في الفاتورة ورأس الصفحة', h('div', { class: 'acts-inline' }, window.IBLogo.Logo({ tone: 'color', width: 150 }), Button({ size: 'sm', label: 'غيّر اللوجو', onClick: () => { st.sec = 'brand'; try { history.replaceState(null, '', '#settings-brand'); } catch (e) { /* */ } R(); } }))),
        K.two(U.TextInput({ id: 'g-co', label: 'اسم الشركة', required: true, value: g.company, onInput: ed('company') }), U.TextInput({ id: 'g-lg', label: 'الاسم القانوني', value: g.legal, onInput: ed('legal') })),
        K.two(U.TextInput({ id: 'g-em', label: 'إيميل التواصل', required: true, value: g.email, onInput: ed('email') }), U.TextInput({ id: 'g-site', label: 'الموقع الإلكتروني', value: g.site, onInput: ed('site') })),
        K.two(U.TextInput({ id: 'g-ad', label: 'العنوان', value: g.address, onInput: ed('address') }), U.TextInput({ id: 'g-ph', label: 'هاتف الشركة', value: g.phone, onInput: ed('phone') }))], null, { sub: 'بتظهر في الفواتير وإيميلات الفريق وملفات التصدير · الشعار: بيت لكل مبتكر' }),
      // phase 12 T3 (decision 3): no pretend choices — the system runs on Cairo time, Arabic RTL and the pound; these are facts, not settings
      K.Section('اللغة والمنطقة', [vrow('المنطقة الزمنية', 'كل التواريخ والأيام في السيستم والتقارير بتوقيت القاهرة', K.Tag('neutral', '(GMT+2/+3) القاهرة')), vrow('اللغة', 'الواجهة عربي RTL باللهجة المصرية — مفيش نسخة إنجليزية', K.Tag('neutral', 'العربية')),
        vrow('العملة', 'الجنيه المصري في كل الأرقام', K.Tag('neutral', 'ج.م')), vrow('تنسيق التاريخ والأرقام', 'التواريخ «20 أكتوبر 2026» وفي الجداول 20/10/2026 · الأرقام 1,234.56 · الهواتف وSKU LTR', K.Tag('neutral', 'ثابت')),
        vrow('بداية الأسبوع', 'تقارير «أسبوعيًا» والخطة الإعلانية على أسبوع يبدأ السبت', K.Tag('neutral', 'السبت'))], null, { sub: 'ثوابت السيستم — مش اختيارات' }),
      K.Section('تفضيلات العرض', [row('الوضع المضغوط للجداول', 'صفوف 48px بدل 56px وخطوط أصغر في الجداول الكثيفة', g.compact, ed('compact')), row('إظهار صور المنتجات في الأوردرات', 'صورة مصغّرة 40px في صف الأوردر الفرعي', g.thumbs, ed('thumbs')), row('تذكّر آخر فلاتر لكل صفحة', 'الأوردرات والتقارير بتفتح على آخر فلتر استخدمته', g.rememberFilters, ed('rememberFilters')), row('إخفاء أرقام هواتف العملاء في القوائم', 'تظهر كاملة عند الفتح فقط لمن يملك الصلاحية', g.hidePhones, ed('hidePhones'))], null, { sub: 'إعدادات واجهة على مستوى الشركة — كل عضو يقدر يغيّرها لنفسه من ملفه' })];
  }

  // ---------- الأوراق الرسمية (owner 1 Nov 20:42): السجل التجاري والبطاقة الضريبية وأي ورقة تانية — بحث + اسم للملف + تاريخ انتهاء ----------
  const DOC_TYPES = ['السجل التجاري', 'البطاقة الضريبية', 'شهادة القيمة المضافة', 'عقد التأسيس', 'رخصة', 'عقد إيجار', 'توكيل', 'أخرى'];
  const docs = (C.docs = C.docs || []); // the company papers come from company_docs (phase 11 decision 20)
  const TODAY_S = K.TODAY;
  const daysTo = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(TODAY_S + 'T00:00:00Z')) / 864e5);
  const docState = (x) => { if (!x.expires) return ['neutral', 'من غير انتهاء']; const n = daysTo(x.expires); return n < 0 ? ['error', 'منتهية'] : n <= 30 ? ['orange', 'بتنتهي بعد ' + n + ' يوم'] : ['success', 'سارية']; };
  const fmtD = (d) => (d ? d.split('-').reverse().join('/') : '—');
  function editDoc(x) {
    const isNew = !x;
    K.form({ title: isNew ? 'رفع ورقة رسمية' : 'تعديل «' + x.name + '»', submitLabel: isNew ? 'احفظ الورقة' : 'احفظ',
      values: x ? Object.assign({}, x) : { name: '', type: 'السجل التجاري', no: '', issued: '', expires: '', file: '', size: '', notes: '' },
      fields: (f, e, set) => [
        f.file ? h('div', { class: 'file-row', 'data-doc-file': '' }, Icon('file', 'sm'), h('b', { dir: 'auto' }, f.file), h('small', { class: 'help' }, f.size), h('span', { class: 'grow' }), (() => { const inp = h('input', { type: 'file', class: 'sr-file', id: 'doc-rep', accept: '.pdf,image/*', onChange: () => { const fl = inp.files[0]; if (fl) { set('file', fl.name); set('size', Math.max(1, Math.round(fl.size / 1024)) + 'KB', true); } } }); return h('label', { class: 'btn btn-default sm', for: 'doc-rep', tabindex: '0', role: 'button' }, 'استبدال', inp); })())
          : (() => { const inp = h('input', { type: 'file', class: 'sr-file', id: 'doc-up', accept: '.pdf,image/*', onChange: () => { const fl = inp.files[0]; if (!fl) return; if (!f.name) set('name', fl.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')); set('size', Math.max(1, Math.round(fl.size / 1024)) + 'KB'); set('file', fl.name, true); } });
            return h('div', null, h('label', { class: 'drop' + (e.file ? ' err' : ''), for: 'doc-up', tabindex: '0', role: 'button', 'data-doc-drop': '', onKeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); inp.click(); } } }, Icon('upload'), h('b', null, 'ارفع الملف'), h('small', null, 'PDF أو صورة · لحد 20MB'), inp), e.file ? h('div', { class: 'err-msg', role: 'alert' }, e.file) : null); })(),
        K.field.text('name', 'اسم الملف', f, e, set, { required: true, help: 'الاسم اللي هتدوّر بيه بعدين — مثلًا «السجل التجاري 2027»' }),
        K.two(K.field.select('type', 'النوع', DOC_TYPES, f, e, set, { required: true }), K.field.text('no', 'رقم الورقة', f, e, set, { dir: 'ltr', help: 'رقم السجل أو التسجيل الضريبي' })),
        K.two(U.DateField({ id: 'doc-is', label: 'تاريخ الإصدار', value: f.issued, today: TODAY_S, onChange: (v) => set('issued', v, true) }), U.DateField({ id: 'doc-ex', label: 'تاريخ الانتهاء', value: f.expires, today: TODAY_S, error: e.expires, onChange: (v) => set('expires', v, true), help: 'سيبه فاضي لو مالهاش انتهاء — هننبّهك قبلها بـ 30 يوم' })),
        K.field.area('notes', 'ملاحظات', f, e, set, { rows: 2 })],
      validate: (f) => Object.assign(K.req(f, ['name', 'type']), !f.file ? { file: 'ارفع الملف' } : {}, f.issued && f.expires && f.expires < f.issued ? { expires: 'تاريخ الانتهاء قبل الإصدار' } : {}),
      submit: (f) => { const v = { name: f.name.trim(), type: f.type, no: f.no, issued: f.issued, expires: f.expires, file: f.file, size: f.size || '—', notes: f.notes, at: TODAY_S };
        if (isNew) docs.unshift(Object.assign({ id: 'D' + (docs.length + 1) + Date.now() % 1000 }, v)); else Object.assign(x, v);
        LOGV('settings.docs.' + (isNew ? 'add' : 'edit'), v.name); K.toast(isNew ? 'اتحفظت «' + v.name + '»' : 'اتحفظ', 'success'); R(); } });
  }
  function docsSec() {
    const q = (st.dq || '').trim(); const tp = st.dtype || 'all';
    const list = docs.filter((x) => (tp === 'all' || x.type === tp) && (!q || [x.name, x.type, x.no, x.file, x.notes].some((v) => v && String(v).includes(q))));
    const soon = docs.filter((x) => x.expires && daysTo(x.expires) <= 30);
    const search = h('input', { type: 'search', class: 'input', id: 'doc-q', placeholder: 'دوّر باسم الملف أو النوع أو الرقم', 'aria-label': 'بحث في الأوراق', value: st.dq || '' });
    search.addEventListener('input', () => { st.dq = search.value; R(); setTimeout(() => { const s = document.getElementById('doc-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    const types = ['all'].concat(DOC_TYPES.filter((t) => docs.some((x) => x.type === t)));
    const rows = list.map((x) => { const s = docState(x); return [h('span', { class: 'doc-n' }, Icon('file', 'sm'), h('span', null, h('b', null, x.name), h('small', { class: 'help', dir: 'ltr' }, x.file + ' · ' + x.size))), x.type, x.no ? K.Num(x.no) : '—', K.Num(fmtD(x.expires)), K.Tag(s[0], s[1]),
      K.RowMenu([{ label: 'عرض', icon: 'eye', run: () => K.toast('بيفتح «' + x.file + '»') }, { label: 'تنزيل', icon: 'download', run: () => { LOGV('settings.docs.download', x.name); K.toast('اتنزل ' + x.file, 'success'); } }, { label: 'تعديل', icon: 'edit', run: () => editDoc(x) }, { label: 'حذف', danger: true, run: () => K.confirm({ title: 'تحذف «' + x.name + '»؟', text: 'الملف هيتمسح من السيستم. لو محتاجه بعدين لازم ترفعه تاني.', okLabel: 'احذف', okType: 'danger', onOk: () => { docs.splice(docs.indexOf(x), 1); LOGV('settings.docs.delete', x.name); K.toast('اتحذفت'); R(); } }) }])]; });
    return [soon.length ? U.InlineNote({ kind: soon.some((x) => daysTo(x.expires) < 0) ? 'error' : 'warning', children: soon.map((x) => '«' + x.name + '» ' + docState(x)[1]).join(' · ') + ' — جدّدها وارفع النسخة الجديدة.' }) : null,
      K.Section('الأوراق الرسمية', [h('div', { class: 'toolbar doc-bar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), search), U.Select({ id: 'doc-type', label: '', options: types.map((t) => ({ value: t, label: t === 'all' ? 'النوع: الكل' : 'النوع: ' + t })), value: tp, onChange: (v) => { st.dtype = v; R(); } })),
        list.length ? U.Table({ cls: 'doc-tbl', headers: ['الملف', 'النوع', 'الرقم', 'الانتهاء', 'الحالة', ''], rows }) : K.Empty(q || tp !== 'all' ? 'مفيش ورقة بالاسم ده' : 'لسه مفيش أوراق', q || tp !== 'all' ? 'جرّب اسم تاني أو امسح البحث.' : 'ارفع السجل التجاري والبطاقة الضريبية عشان تلاقيهم هنا.')],
        Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'رفع ورقة', attrs: { 'data-doc-add': '' }, onClick: () => editDoc() }), { sub: docs.length + ' ورقة · بتظهر للأدمن بس · نبّهك قبل الانتهاء بـ 30 يوم' })];
  }

  // ---------- الهوية البصرية (owner 1 Nov 20:42): ألوان الموقع واللوجو والخطوط — التعديل بيبان في السيستم كله فورًا ----------
  // كل ألوان السيستم بأنواعها (owner 1 Nov 21:46): [token, الاسم, بيستخدم في, القيمة الأصلية, تابع لـ (اختياري), معامل التغميق]
  // اللون «التابع» بيمشي مع اللون الأساسي بتاعه لحد ما تعدّله بإيدك
  const BRAND_ROWS = [
    ['الألوان الأساسية', 'الأخضر والذهبي — أهم لونين في الهوية', [['--color-brand-default', 'الأخضر — البراند', 'العناوين، الروابط، الأزرار الخضرا', '#005642'], ['--color-brand-hover', 'الأخضر — وقت الوقوف عليه', 'hover على الأزرار الخضرا', '#054b39', '--color-brand-default', 0.86], ['--color-brand-subtle-bg', 'الأخضر الفاتح', 'الاختيار الحالي في القوايم', '#ebf1f0'], ['--color-action-default', 'الذهبي — الأزرار', 'الزرار الأساسي والتاب المختار', '#c39e57'], ['--color-action-hover', 'الذهبي — وقت الوقوف عليه', 'hover على الزرار الأساسي', '#b28f4d', '--color-action-default', 0.91]]],
    ['الخلفيات', 'الكريمي ودرجاته', [['--color-bg-layout', 'خلفية الصفحة', 'الكريمي ورا كل حاجة', '#fff3e6'], ['--color-bg-base', 'خلفية الكروت', 'الكروت والبوب أب', '#fff7ef'], ['--color-bg-container', 'خلفية الحقول والصفوف', 'الهيدر الخفيف والصفوف', '#f5eddc'], ['--color-bg-tint', 'الخلفية المظللة', 'الفواصل والتظليل', '#f0e5cf'], ['--color-bg-elevated', 'خلفية القوايم المنسدلة', 'القوايم والبوب أوفر', '#fff7ef', '--color-bg-base'], ['--color-bg-disabled', 'خلفية المقفول', 'الحقول والأزرار المقفولة', '#f0e5cf', '--color-bg-tint'], ['--color-bg-sidebar', 'خلفية القايمة الجانبية', 'السايدبار', '#005642', '--color-brand-default']]],
    ['النصوص', null, [['--color-text-primary', 'النص الأساسي', 'الكلام العادي', '#2e2a1b'], ['--color-text-secondary', 'النص الثانوي', 'الوصف والملاحظات', '#6b6558'], ['--color-text-disabled', 'النص المقفول', 'الحاجات المقفولة والـ placeholder', '#8f887b'], ['--color-text-on-action', 'نص على الذهبي', 'الكلام فوق الزرار الذهبي', '#fff7ef'], ['--color-text-on-brand', 'نص على الأخضر', 'الكلام فوق الأخضر والسايدبار', '#fff7ef', '--color-text-on-action'], ['--color-text-gold', 'الذهبي الفاتح', 'على الخلفية الخضرا', '#e6ba65']]],
    ['الحدود', null, [['--color-border-default', 'الحد العادي', 'الحقول والأزرار الثانوية', '#8f887b'], ['--color-border-subtle', 'الحد الخفيف', 'الكروت والفواصل', '#f0e5cf'], ['--color-border-focus', 'حد الفوكس', 'الحقل اللي عليه الكيبورد', '#005642', '--color-brand-default']]],
    ['الحالات', 'نجاح · خطأ · تحذير · برتقالي (قابل للتأخير) — كل حالة: الأساسي، النص، الخلفية، الحد', [
      ['--color-success-base', 'نجاح — الأساسي', 'أيقونات النجاح', '#39ac00'], ['--color-success-text', 'نجاح — النص', '«اتوافق» و«مكتمل»', '#2d7106'], ['--color-success-bg', 'نجاح — الخلفية', 'خلفية التاج', '#dfebd3'], ['--color-success-border', 'نجاح — الحد', 'حد التاج', '#93d164'],
      ['--color-error-base', 'خطأ — الأساسي', 'الأزرار الحمرا والنجمة', '#da0001'], ['--color-error-text', 'خطأ — النص', 'رسايل الخطأ', '#8e0a07'], ['--color-error-bg', 'خطأ — الخلفية', 'خلفية التنبيه', '#ffeae6'], ['--color-error-border', 'خطأ — الحد', 'حد الحقل الغلط', '#ff887a'],
      ['--color-warning-base', 'تحذير — الأساسي', 'أيقونة التحذير', '#bc8000'], ['--color-warning-text', 'تحذير — النص', 'كلام التحذير', '#7a5300'], ['--color-warning-bg', 'تحذير — الخلفية', 'خلفية التنبيه', '#fcf9e3'], ['--color-warning-border', 'تحذير — الحد', 'حد التنبيه', '#e3c96d'],
      ['--color-orange-base', 'برتقالي — الأساسي', '«قابل للتأخير»', '#f08a1c'], ['--color-orange-text', 'برتقالي — النص', 'كلام التاج', '#8a4500'], ['--color-orange-bg', 'برتقالي — الخلفية', 'خلفية التاج', '#fff0dc'], ['--color-orange-border', 'برتقالي — الحد', 'حد التاج', '#f5a04a']]],
    ['الرسوم البيانية', 'الترتيب ثابت: أول سلسلة دايمًا اللون 1', [['--color-chart-1', 'لون 1', 'أول سلسلة', '#005642', '--color-brand-default'], ['--color-chart-2', 'لون 2', 'تاني سلسلة', '#c39e57', '--color-action-default'], ['--color-chart-3', 'لون 3', 'تالت سلسلة', '#e6ba65', '--color-text-gold'], ['--color-chart-4', 'لون 4', 'الباقي / أخرى', '#8f887b', '--color-border-default']]]];
  const TOK = {}; BRAND_ROWS.forEach(([, , rows]) => rows.forEach(([k, label, use, def, link, f]) => { TOK[k] = { k, label, use, def, link, f }; }));
  const BRAND_DEF = Object.freeze(Object.fromEntries(Object.keys(TOK).map((k) => [k, TOK[k].def])));
  const FONTS = [['Cairo', 'كايرو — الحالي'], ['Tajawal', 'تجوّل'], ['IBM Plex Sans Arabic', 'IBM Plex عربي'], ['Almarai', 'المراعي'], ['Noto Kufi Arabic', 'نوتو كوفي'], ['Readex Pro', 'ريدكس برو'], ['Rubik', 'روبيك']];
  const FONT_DEF = { body: 'Cairo', head: 'Cairo' };
  const SKEY = 'ib-brand-v2';
  const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(v);
  const shade = (hex, f) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 10) / 10; };
  // brand.colors = اللي اتعدّل بس؛ الباقي أصلي أو تابع
  const brand = (C.brand = C.brand || (() => { let s = null; try { s = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { s = null; } return { colors: Object.assign({}, (s && s.colors) || {}), fonts: Object.assign({}, FONT_DEF, (s && s.fonts) || {}) }; })());
  function eff(k) { const t = TOK[k]; if (brand.colors[k]) return brand.colors[k]; if (t.link) { const b = eff(t.link); if (b !== TOK[t.link].def) return t.f ? shade(b, t.f) : b; } return t.def; }
  const loaded = new Set(['Cairo']);
  function loadFont(f) { if (loaded.has(f)) return; loaded.add(f); try { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700&display=swap'; document.head.append(l); } catch (e) { /* offline */ } }
  function applyBrand() {
    const r = document.documentElement.style;
    Object.keys(TOK).forEach((k) => { const v = eff(k); if (v === TOK[k].def && !brand.colors[k]) r.removeProperty(k); else r.setProperty(k, v); });
    [brand.fonts.body, brand.fonts.head].forEach(loadFont);
    if (brand.fonts.body === FONT_DEF.body) r.removeProperty('--font'); else r.setProperty('--font', "'" + brand.fonts.body + "',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif");
    r.setProperty('--font-head', "'" + brand.fonts.head + "',var(--font)");
  }
  const saveBrand = () => { try { localStorage.setItem(SKEY, JSON.stringify(brand)); } catch (e) { /* private mode */ } };
  applyBrand();
  function setColor(k, v) { if (!hexOk(v)) return false; v = v.toLowerCase(); if (v === TOK[k].def && !TOK[k].link) delete brand.colors[k]; else brand.colors[k] = v; applyBrand(); saveBrand(); return true; }
  function colorRow(k) {
    const t = TOK[k]; const v = eff(k); const own = !!brand.colors[k]; const changed = own && brand.colors[k] !== t.def;
    const txt = h('input', { type: 'text', class: 'input hex-in', id: 'clr-' + k.slice(2), value: v, dir: 'ltr', maxlength: 7, spellcheck: 'false', 'aria-label': t.label + ' — كود اللون' });
    const pick = h('input', { type: 'color', class: 'clr-pick', value: v, 'aria-label': t.label + ' — اختار اللون', 'data-clr': k });
    pick.addEventListener('input', () => { txt.value = pick.value; setColor(k, pick.value); });
    pick.addEventListener('change', () => { LOGV('settings.brand.color', t.label + ' = ' + pick.value); R(); });
    txt.addEventListener('change', () => { let x = txt.value.trim(); if (!x.startsWith('#')) x = '#' + x; if (setColor(k, x)) { LOGV('settings.brand.color', t.label + ' = ' + x); R(); } else { txt.classList.add('err'); K.toast('اكتب كود زي #005642', 'error'); } });
    const linkTag = t.link && !own ? K.Tag('neutral', 'تابع لـ «' + TOK[t.link].label + '»') : null;
    return h('div', { class: 'clr-row', 'data-clr-row': k }, h('label', { class: 'clr-sw', style: 'background:' + v }, pick), h('div', { class: 'clr-t' }, h('b', null, t.label), h('small', { class: 'help' }, t.use), h('span', { class: 'clr-meta' }, h('code', { dir: 'ltr' }, k), linkTag)), txt,
      own ? Button({ type: 'text', size: 'sm', label: t.link ? 'رجّعه تابع' : 'الأصلي', attrs: { 'aria-label': 'رجّع ' + t.label + (t.link ? ' تابع' : ' للأصلي') }, onClick: () => { delete brand.colors[k]; applyBrand(); saveBrand(); R(); } }) : h('span', { class: 'clr-def t-small help' }, changed ? '' : 'الأصلي'));
  }
  // اللوجو صورة بتتغير (owner 1 Nov 22:43): نسخة للخلفية الفاتحة، ونسخة للأخضر، والأيقونة الصغيرة
  const LOGO_SLOTS = [['color', 'اللوجو على الخلفية الفاتحة', 'رأس الصفحة والفواتير والإيميلات', 'light', false], ['reversed', 'اللوجو على الأخضر', 'القايمة الجانبية', 'dark', false], ['mark', 'الأيقونة', 'التطبيق على الموبايل والأيقونة الصغيرة', 'light', true]];
  function logoSlot([tone, label, use, bg, mark]) {
    const cur = window.IBLogo.get(tone); const id = 'logo-up-' + tone;
    const inp = h('input', { type: 'file', class: 'sr-file', id, accept: 'image/svg+xml,image/png,image/webp', onChange: () => { const f = inp.files[0]; if (!f) return;
      if (!/^image\/(svg\+xml|png|webp)$/.test(f.type)) { K.toast('ارفع SVG أو PNG أو WebP', 'error'); return; } if (f.size > 1024 * 1024) { K.toast('الصورة أكبر من 1MB — صغّرها الأول', 'error'); return; }
      const r = new FileReader(); r.onload = () => { window.IBLogo.set(tone, r.result); LOGV('settings.brand.logo', label + ' · ' + f.name); K.toast('اتغيّر ' + label, 'success'); R(); }; r.readAsDataURL(f); } });
    return h('div', { class: 'logo-slot', 'data-logo-slot': tone }, h('div', { class: 'logo-pv ' + bg }, window.IBLogo.Logo({ tone: mark ? 'color' : tone, width: mark ? 56 : 170, mark })),
      h('div', { class: 'logo-meta' }, h('b', null, label), h('small', { class: 'help' }, use), cur ? K.Tag('gold', 'مرفوع') : K.Tag('neutral', 'الأصلي')),
      h('div', { class: 'acts-inline start' }, h('label', { class: 'btn btn-default sm', for: id, tabindex: '0', role: 'button', 'data-logo-up': tone, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, Icon('upload', 'sm'), h('span', null, cur ? 'غيّر الصورة' : 'ارفع صورة')), inp,
        cur ? Button({ type: 'text', size: 'sm', label: 'رجّع الأصلي', attrs: { 'data-logo-reset': tone }, onClick: () => { window.IBLogo.set(tone, null); LOGV('settings.brand.logo', label + ' · الأصلي'); K.toast('رجع اللوجو الأصلي'); R(); } }) : null));
  }
  function brandSec() {
    const c = eff;
    const checks = [['نص على الذهبي', '--color-text-on-action', '--color-action-default', 3], ['نص على الأخضر', '--color-text-on-brand', '--color-brand-default', 4.5], ['النص الأساسي على الخلفية', '--color-text-primary', '--color-bg-layout', 4.5], ['النص الثانوي على الكروت', '--color-text-secondary', '--color-bg-base', 4.5], ['العناوين الخضرا على الخلفية', '--color-brand-default', '--color-bg-layout', 4.5],
      ['نص النجاح على خلفيته', '--color-success-text', '--color-success-bg', 4.5], ['نص الخطأ على خلفيته', '--color-error-text', '--color-error-bg', 4.5], ['نص التحذير على خلفيته', '--color-warning-text', '--color-warning-bg', 4.5], ['نص البرتقالي على خلفيته', '--color-orange-text', '--color-orange-bg', 4.5]];
    const cRows = checks.map(([l, fg, bg, min]) => { const r = contrast(c(fg), c(bg)); return h('div', { class: 'cc-row', 'data-cc': l }, h('span', { class: 'cc-sw', style: 'background:' + c(bg) + ';color:' + c(fg) }, 'أب'), h('span', { class: 'grow' }, l), K.Num(r + ':1'), r >= min ? K.Tag('success', 'مقروء') : K.Tag('error', 'ضعيف — محتاج ' + min + ':1')); });
    const preview = h('div', { class: 'brand-pv', 'data-brand-pv': '' }, h('div', { class: 'bp-side' }, window.IBLogo.Logo({ tone: 'reversed', width: 120 }), h('span', { class: 'bp-nav on' }, 'الأوردرات'), h('span', { class: 'bp-nav' }, 'المنتجات')),
      h('div', { class: 'bp-main' }, window.IBLogo.Logo({ tone: 'color', width: 140 }), h('b', { class: 'bp-h' }, 'عنوان بالأخضر'), h('p', { class: 'bp-p' }, 'ده كلام عادي على الخلفية، ', h('span', { class: 'help' }, 'وده نص ثانوي.')), h('div', { class: 'acts-inline start' }, Button({ type: 'primary', size: 'sm', label: 'زرار أساسي' }), Button({ type: 'brand', size: 'sm', label: 'زرار أخضر' }), Button({ size: 'sm', label: 'ثانوي' })),
        h('div', { class: 'acts-inline start' }, K.Tag('success', 'مكتمل'), K.Tag('error', 'ملغي'), K.Tag('warning', 'تحذير'), K.Tag('orange', 'قابل للتأخير')), h('div', { class: 'bp-chart', 'aria-hidden': 'true' }, [1, 2, 3, 4].map((i) => h('i', { style: 'background:var(--color-chart-' + i + ');height:' + [36, 26, 18, 10][i - 1] + 'px' })))));
    const fsel = (k, id, label, help) => U.Select({ id, label, help, value: brand.fonts[k], options: FONTS.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { brand.fonts[k] = v; applyBrand(); saveBrand(); LOGV('settings.brand.font', label + ' = ' + v); R(); } });
    const nEdit = Object.keys(brand.colors).length; const anyChanged = nEdit || brand.fonts.body !== FONT_DEF.body || brand.fonts.head !== FONT_DEF.head;
    const q = (st.clrq || '').trim();
    const search = h('input', { type: 'search', class: 'input', id: 'clr-q', placeholder: 'دوّر على لون — مثلًا: خطأ، خلفية، chart', 'aria-label': 'بحث في الألوان', value: st.clrq || '' });
    search.addEventListener('input', () => { st.clrq = search.value; R(); setTimeout(() => { const s = document.getElementById('clr-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    const groups = BRAND_ROWS.map(([t, sub, rows]) => [t, sub, rows.map((r) => r[0]).filter((k) => !q || (t + TOK[k].label + TOK[k].use + k).includes(q))]).filter(([, , ks]) => ks.length);
    return [K.Section('معاينة', [preview, h('div', { class: 'cc-list' }, cRows)], anyChanged ? Button({ size: 'sm', label: 'رجّع كله للأصلي', attrs: { 'data-brand-reset': '' }, onClick: () => K.confirm({ title: 'ترجّع الألوان والخطوط للأصلي؟', text: 'هترجع ألوان إبتكر وخط Cairo زي ما كانوا' + (nEdit ? ' (' + nEdit + ' لون متعدّل)' : '') + '.', okLabel: 'رجّع', onOk: () => { brand.colors = {}; brand.fonts = Object.assign({}, FONT_DEF); applyBrand(); saveBrand(); LOGV('settings.brand.reset', ''); K.toast('رجعت للأصلي', 'success'); R(); } }) }) : null, { sub: Object.keys(TOK).length + ' لون في ' + BRAND_ROWS.length + ' مجموعات · أي تعديل بيبان في السيستم كله على طول (والأوردرات كمان) ومتسجل في سجل النشاط' }),
      K.Section('اللوجو', h('div', { class: 'logo-slots' }, LOGO_SLOTS.map(logoSlot)), null, { sub: 'صورة SVG أو PNG بخلفية شفافة · لحد 1MB · بتتغير في السيستم كله على طول', cols: false }),
      h('div', { class: 'toolbar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), search), h('span', { class: 't-small help', 'data-clr-count': '' }, nEdit ? nEdit + ' لون متعدّل' : 'كل الألوان أصلية')),
      ...(groups.length ? groups.map(([t, sub, ks]) => K.Section(t + ' (' + ks.length + ')', h('div', { class: 'clr-list' }, ks.map(colorRow)), null, sub ? { sub } : {})) : [K.Empty('مفيش لون بالاسم ده', 'جرّب كلمة تانية.')]),
      K.Section('الخطوط', [U.InlineNote({ children: 'اختيار مبدئي للتجربة — الخط النهائي هيتثبت في البرمجة.' }), K.two(fsel('body', 'f-body', 'خط الكلام', 'الجداول والحقول والكلام العادي'), fsel('head', 'f-head', 'خط العناوين', 'عناوين الصفحات والكروت')),
        h('div', { class: 'type-pv', 'data-type-pv': '' }, [['t-h3', 'عنوان صفحة · 24'], ['t-h4', 'عنوان كارت · 20'], ['t-h5', 'عنوان قسم · 16'], ['', 'كلام عادي · 14 — بيت لكل مبتكر 0123456789'], ['t-small', 'ملاحظة · 12']].map(([cls, s]) => h('div', { class: 'tp-row' }, h('span', { class: cls || 'tp-body' }, s))))], null, { sub: 'من Google Fonts — كلها بتدعم العربي' })];
  }

  // ---------- الفريق والصلاحيات ----------
  function teamSec() {
    const invites = S.members.filter((m) => m.status === 'invited');
    const subs = [{ id: 'members', label: 'الأعضاء', count: S.members.length }, { id: 'roles', label: 'الأدوار والصلاحيات' }, { id: 'invites', label: 'الدعوات المعلّقة', count: invites.length }];
    const out = [K.SubTabs({ items: subs, active: st.teamSub, onChange: (id) => { st.teamSub = id; R(); }, label: 'الفريق والصلاحيات' })];
    const stTag = (m) => K.Tag(m.status === 'active' ? 'success' : m.status === 'invited' ? 'info' : 'error', m.status === 'active' ? 'نشط' : m.status === 'invited' ? 'دعوة معلّقة' : 'موقوف');
    if (st.teamSub === 'members') {
      const q = st.mq.trim(); const list = S.members.filter((m) => !q || m.name.includes(q) || m.email.includes(q));
      const srch = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الإيميل', 'aria-label': 'بحث في الأعضاء', value: st.mq }); srch.addEventListener('input', () => { st.mq = srch.value; const p = srch.selectionStart; R(); const n = document.querySelector('#pg-settings input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
      // تحديد جماعي (owner 31 Oct): تغيير الدور · إيقاف/تفعيل · إعادة إرسال الدعوات (المالك مش بيتحدد)
      const pickM = (ids) => S.members.filter((m) => ids.includes(m.id) && m.id !== 'M01');
      const MB = K.Bulk({ key: 'set-members', ids: list.filter((m) => m.id !== 'M01').map((m) => m.id), noun: 'عضو', render: R, actions: [
        { id: 'role', label: 'تغيير الدور', icon: 'users', run: (ids, done) => K.form({ title: 'تغيير دور ' + ids.length + ' أعضاء', values: { role: liveNames()[1] || liveNames()[0] }, submitLabel: 'غيّر الدور', fields: (f, e, set) => [K.field.select('role', 'الدور الجديد', liveNames(), f, e, set, { required: true }), U.InlineNote({ children: 'الصلاحيات المخصصة لكل عضو بتفضل زي ما هي.' })], submit: async (f) => { const id = roleIdOf(f.role); let n = 0; for (const m of pickM(ids)) { if (!m.uid || !id) continue; const r = await SETT().setMemberRole(m.uid, id); if (!r.ok) { fail(r, 'تغيير الدور'); continue; } LOGV('settings.member.role', m.name + ': ' + m.role + ' ← ' + f.role); m.role = f.role; n++; } done('اتغير دور ' + n + ' أعضاء لـ ' + f.role); } }) },
        { id: 'suspend', label: 'إيقاف', icon: 'alert', danger: true, run: (ids, done) => { const l = pickM(ids).filter((m) => m.status === 'active'); if (!l.length) { K.toast('مفيش أعضاء نشطين في المحدد', 'error'); return; } K.form({ title: 'إيقاف ' + l.length + ' أعضاء', values: { reason: '' }, note: U.InlineNote({ kind: 'warning', children: l.map((m) => m.name).join('، ') + ' — مش هيقدروا يدخلوا السيستم لحد ما تفعّلهم تاني.' }), fields: (f, e, set) => [K.field.area('reason', 'سبب الإيقاف', f, e, set, { required: true, rows: 2 })], validate: (f) => K.req(f, ['reason']), submitLabel: 'إيقاف', submitType: 'danger', submit: async (f, md) => { let n = 0; for (const m of l) { if (!m.uid) continue; const r = await SETT().setMemberStatus(m.uid, 'suspended', f.reason); if (!r.ok) { fail(r, 'الإيقاف'); continue; } m.status = 'suspended'; n++; } md.close(); done('اتوقف ' + n + ' أعضاء'); } }); } },
        { id: 'activate', label: 'تفعيل', icon: 'check', run: (ids, done) => { const l = pickM(ids).filter((m) => m.status === 'suspended'); if (!l.length) { K.toast('مفيش أعضاء موقوفين في المحدد', 'error'); return; } (async () => { let n = 0; for (const m of l) { if (!m.uid) continue; const r = await SETT().setMemberStatus(m.uid, 'active', ''); if (!r.ok) { fail(r, 'التفعيل'); continue; } m.status = 'active'; n++; } done('اتفعّل ' + n + ' أعضاء'); })(); } },
        { id: 'resend', label: 'إعادة إرسال الدعوات', icon: 'send', run: (ids, done) => { const l = pickM(ids).filter((m) => m.status === 'invited'); if (!l.length) { K.toast('مفيش دعوات معلّقة في المحدد', 'error'); return; } done('اتبعتت ' + l.length + ' دعوة تاني'); } }] });
      out.push(K.Section('الأعضاء', [h('div', { class: 'toolbar' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), srch), h('span', { class: 'grow' }), Button({ type: 'primary', label: '+ إضافة عضو', onClick: () => invite() })),
        MB.bar(), U.Table({ headers: [MB.head(), 'العضو', 'الدور', 'الحالة', 'قنوات خدمة العملاء', 'آخر دخول', 'صلاحيات مخصصة', ''], rows: list.map((m) => [m.id === 'M01' ? '' : MB.box(m.id, m.name), h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', { dir: 'ltr' }, m.email))), m.id === 'M01' ? K.Tag('brand', 'أدمن (المالك)') : roleSelect(m), stTag(m), K.chanAll(m) ? K.Tag('brand', 'كل القنوات') : chanLabelsOf(m).length ? h('span', { class: 'chips' }, chanLabelsOf(m).map((n) => h('span', { class: 'list-chip' }, n))) : h('span', { class: 't-small help' }, '—'), m.lastLogin || '—', m.override ? K.Tag('gold', m.override + ' تجاوز') : '—',
          m.id === 'M01' ? h('span', { class: 't-small help' }, '—') : K.RowMenu([{ label: 'صلاحيات مخصصة', icon: 'sliders', run: () => customPerms(m) }, { label: 'قنوات خدمة العملاء', icon: 'headset', run: () => memberChans(m) }, { label: 'تنبيهات مخصصة', icon: 'bell', run: () => memberAlerts(m) }, m.status === 'active' ? { label: 'فتح الملف', icon: 'users', run: () => { location.hash = 'hr-team'; } } : null, m.status === 'invited' ? { label: 'إعادة إرسال الدعوة', icon: 'send', run: () => K.toast('اتبعتت الدعوة تاني لـ ' + m.email) } : null, m.status === 'invited' ? { label: 'إلغاء الدعوة', icon: 'close', danger: true, run: () => cancelInvite(m) } : { label: m.status === 'suspended' ? 'إعادة تفعيل' : 'إيقاف العضو', icon: 'alert', danger: m.status !== 'suspended', run: () => suspend(m) }, m.uid && m.uid !== (window.IBDirectory.me() || {}).id ? { label: 'حذف العضو نهائي', icon: 'trash', danger: true, run: () => deleteMember(m) } : null].filter(Boolean), 'إجراءات ' + m.name)]) }),
        note('العضو الجديد بيتضاف من «الموارد البشرية › إضافة عضو» بدوره: بيوصله إيميل بلينك يعمل منه الباسورد بتاعه (لما Resend يبقى متظبط في «الربط والمفاتيح»)، وغير كده باسورد مؤقت بيظهر مرة واحدة. «ابعت إيميل الباسورد تاني» و«باسورد مؤقت جديد» من قايمة العضو في الموارد البشرية.'), U.InlineNote({ children: 'الإيقاف بيقفل الدخول فورًا ويحتفظ بسجل نشاطه وأوردراته وحركاته، وإعادة التفعيل من ⋮ بجانب العضو. «حذف العضو نهائي» من ⋮ هنا أو من الموارد البشرية — بس لعضو ماعملش أي حاجة في السيستم؛ اللي له سجل بيتوقف مش بيتمسح.' })],
        null, { sub: S.members.length + ' أعضاء · ' + S.members.filter((m) => m.status === 'active').length + ' نشطين · ' + invites.length + ' دعوة معلّقة — المالك لا يمكن إزالته ولا تخفيض دوره' }));
    } else if (st.teamSub === 'roles') out.push(...rolesView());
    else out.push(K.Section('الدعوات المعلّقة', invites.length ? U.Table({ headers: ['الإيميل', 'الدور', 'اتبعتت', 'بتنتهي', ''], rows: invites.map((m) => [h('span', { dir: 'ltr' }, m.email), m.role, m.invitedAt || 'النهارده', 'بعد 6 أيام', h('div', { class: 'acts-inline' }, Button({ size: 'sm', label: 'إعادة إرسال', onClick: () => K.toast('اتبعتت الدعوة تاني') }), Button({ type: 'text', size: 'sm', label: 'إلغاء', onClick: () => cancelInvite(m) }))]) }) : K.Empty('مفيش دعوات معلّقة', 'ادعي عضو جديد من «الأعضاء».'), [Button({ type: 'primary', label: '+ إضافة عضو', onClick: () => invite() })]));
    return out;
  }
  function roleSelect(m) { return h('div', { class: 'inline-sel' }, U.Select({ id: 'role-' + m.id, label: '', options: liveNames().map((r) => ({ value: r, label: r })), value: m.role, onChange: (v) => { const old = m.role; m.role = v; LOGV('settings.member.role', m.name + ': ' + old + ' ← ' + v); K.toast('دور ' + m.name + ' بقى ' + v); R(); } })); }
  const SYM = { F: ['✓', 'مسموح', 'full'], P: ['▣', 'جزئي (عرض بدون تعديل)', 'part'], N: ['☐', 'غير مسموح', 'none'] };
  function rolesView() {
    const L = live(); const roles = L.map((x) => x[0]); const all = C.perms.every(([g]) => st.open[g] !== false);
    const isOpen = (g) => st.open[g] !== false;
    return [K.Section('الأدوار', h('div', { class: 'chips' }, L.map(([r, ci]) => h('button', { type: 'button', class: 'list-chip role-chip', 'aria-haspopup': 'dialog', title: roleDesc(r), onClick: () => rolePopup(r, ci) }, r + ' · ' + S.members.filter((m) => m.role === r).length)), Button({ type: 'text', label: '+ دور مخصص', onClick: () => customRole() })), null, { sub: 'اضغط على أي دور تفتح إعداداته: البيانات والصلاحيات والتنبيهات والحذف — اسم الدور ووصفه بيظهروا عند الدعوة' }),
      K.Section('مصفوفة الصلاحيات', [h('div', { class: 'legend t-small' }, ...Object.values(SYM).map(([s, l, c]) => h('span', { class: 'pm pm-' + c }, s + ' ' + l)), h('span', { class: 'pm sens' }, Icon('alert', 'sm'), ' صلاحية حساسة')), note('الصفوف الحساسة مميزة — تغييرها بيتسجل في سجل النشاط ويطلب تأكيد. كل مجموعة قابلة للطي — اضغط على اسم المجموعة أو السهم.'),
        h('div', { class: 'scroll-x' }, h('div', { class: 'matrix', style: '--cols:' + roles.length }, h('div', { class: 'mx-row mx-head' }, h('span', null, 'الصلاحية'), roles.map((r) => h('span', { class: 't-label-s' }, r))),
          C.perms.map(([g, rows]) => h('div', { class: 'mx-group' + (isOpen(g) ? ' open' : '') }, h('button', { type: 'button', class: 'mx-gh', 'aria-expanded': String(isOpen(g)), onClick: () => { st.open[g] = !isOpen(g); R(); } }, Icon('chevD', 'sm'), h('b', null, g), h('small', { class: 't-small help' }, rows.length + ' صلاحيات')),
            isOpen(g) ? rows.map(([name, v, sens], ri) => h('div', { class: 'mx-row' + (sens ? ' sens' : '') }, h('span', null, sens ? Icon('alert', 'sm') : null, name), L.map(([r, ci]) => { const c = v[ci] || 'N'; return h('button', { type: 'button', class: 'pm pm-' + SYM[c][2], disabled: ci === 0, 'aria-label': name + ' — ' + r + ': ' + SYM[c][1], title: ci === 0 ? 'الأدمن عنده كل الصلاحيات' : 'غيّر', onClick: () => togglePerm(g, rows, ri, ci, c, !!sens, name, r) }, SYM[c][0]); }))) : null)))),
        note('الأدمن لا يقدر يشيل صلاحية «تعديل الفريق والربط» من نفسه لو هو آخر أدمن (self-lockout guard). التجاوز الفردي لعضو بيتعمل من صفحة الأعضاء ← ⋮ ← «صلاحيات مخصصة».')],
        [Button({ label: 'فتح الكل', onClick: () => { C.perms.forEach(([g]) => { st.open[g] = true; }); R(); } }), Button({ label: 'اغلاق الكل', onClick: () => { C.perms.forEach(([g]) => { st.open[g] = false; }); R(); } }), Button({ type: 'text', label: 'تصدير CSV', onClick: () => K.toast('اتجهز ملف الصلاحيات') })], { sub: '✓ مسموح · ☐ غير مسموح · ▣ جزئي (عرض بدون تعديل)' })];
  }
  function togglePerm(g, rows, ri, ci, c, sens, name, role) {
    const nx = c === 'F' ? 'P' : c === 'P' ? 'N' : 'F'; const apply = () => { const v = rows[ri][1].padEnd(ci + 1, 'N'); rows[ri][1] = v.slice(0, ci) + nx + v.slice(ci + 1); LOGV('settings.perm', g + ' / ' + name + ' / ' + role + ': ' + SYM[c][0] + ' ← ' + SYM[nx][0]); R(); };
    if (sens) K.confirm({ title: 'تغيير صلاحية حساسة', text: '«' + name + '» لدور «' + role + '»: ' + SYM[c][1] + ' ← ' + SYM[nx][1] + '. التغيير هيتسجل في سجل النشاط ويتبعت تنبيه للأدمن.', okLabel: 'تأكيد التغيير', onOk: apply }); else apply();
  }

  // ---------- الربط بالمنصات ----------
  function integrations() {
    waSync();
    const I = C.integrations; const con = I.filter((x) => x.status === 'متصل').length, err = I.filter((x) => x.status.startsWith('خطأ')).length;
    // «التفاصيل» (owner, 22 Oct): platforms and sync-log rows behind each number.
    const pRow = (x) => [x.name, x.status, x.last, x.dir]; const pHead = ['المنصة', 'الحالة', 'آخر مزامنة', 'الاتجاه'];
    const logHead = ['الوقت', 'المنصة', 'الكيان', 'الحدث', 'الاتجاه', 'النتيجة'];
    const today = C.syncLog.filter((r) => r[0].startsWith('اليوم')); const fails = C.syncLog.filter((r) => r[5] === 'فشل');
    const dCon = () => ({ title: 'المنصات المتصلة — ' + con + ' من ' + I.length, summary: [{ label: 'متصل', value: String(con) }, { label: 'فيها خطأ', value: String(err) }, { label: 'مش متصل', value: String(I.length - con - err) }], headers: pHead, rows: I.filter((x) => x.status === 'متصل').map(pRow), source: 'الإعدادات › الربط بالمنصات' });
    const dErr = () => ({ title: 'منصات فيها خطأ — ' + err, sub: 'اربطها تاني من كارت المنصة («ربط تاني»)', summary: [{ label: 'فيها خطأ', value: String(err) }], headers: pHead, rows: I.filter((x) => x.status.startsWith('خطأ')).map(pRow), empty: 'كل المنصات المتصلة شغالة.', source: 'الإعدادات › الربط بالمنصات' });
    const dEv = () => ({ title: 'أحداث متزامنة اليوم — 312', sub: 'العدّاد = كل الأحداث اللي اتزامنت النهارده (أوردرات · منتجات · عملاء · رسايل)؛ الجدول آخر ' + today.length + ' حدث من سجل المزامنة', summary: [{ label: 'أحداث اليوم', value: '312' }, { label: 'تم', value: String(today.filter((r) => r[5] === 'تم').length) + ' من آخر ' + today.length }, { label: 'فشل', value: String(today.filter((r) => r[5] === 'فشل').length) }], headers: logHead, rows: today, source: 'سجل المزامنة' });
    const dFail = () => ({ title: 'أخطاء آخر 24 ساعة — ' + fails.length, sub: I.filter((x) => x.status.startsWith('خطأ')).map((x) => x.name + ' — الربط فصل').join('، ') || 'مفيش منصة فاصلة', summary: [{ label: 'أخطاء', value: String(fails.length) }], headers: logHead, rows: fails, empty: 'مفيش أخطاء في آخر 24 ساعة.', note: '«إعادة محاولة الفاشلة» تحت سجل المزامنة بتعيد إرسالهم.', source: 'سجل المزامنة' });
    // تابس حسب النوع (owner 28 Oct): الموقع والبيانات · وسائل التواصل · الإعلانات · الذكاء الاصطناعي و API
    const ITABS = [['site', 'الموقع والبيانات'], ['social', 'وسائل التواصل والرسايل'], ['ads', 'الإعلانات'], ['ai', 'الذكاء الاصطناعي و API']];
    const kindOf = (x) => x.kind || 'site';
    const tab = ITABS.some(([id]) => id === st.itab) ? st.itab : 'site';
    const inTab = I.filter((x) => kindOf(x) === tab);
    const tabLabel = (ITABS.find(([id]) => id === tab) || [, ''])[1];
    const SUBS = { site: 'الموقع والبيانات اللي السيستم شغال عليها: الأوردرات والمنتجات والحسابات والشحن والأتمتة.',
      social: 'حسابات الرسايل والتعليقات اللي فريق خدمة العملاء بيرد منها — الأرقام والقنوات بتتدار من هنا بس.',
      ads: 'حسابات الإعلانات اللي بتغذّي صفحة «التسويق» بالصرف والحملات والكرييتيف.',
      ai: 'أدوات الذكاء الاصطناعي اللي السيستم بيشتغل بيها — كل أداة بتتربط بـ API أو MCP، والمفاتيح بتتحفظ مشفّرة ومابتظهرش تاني.' };
    const tabs = K.MainTabs({ items: ITABS.map(([id, label]) => ({ id, label: label + ' · ' + I.filter((x) => kindOf(x) === id).length })), active: tab, onChange: (id) => { st.itab = id; R(); }, label: 'أنواع الربط' });
    return [h('div', { class: 'cards' }, K.Stat('منصات متصلة', con, 'من ' + I.length, I.filter((x) => x.status === 'متصل').map((x) => x.short || x.name).join(' · '), undefined, dCon), K.Stat('منصات بها خطأ', err, 'من ' + (con + err) + ' متصلة', I.filter((x) => x.status.startsWith('خطأ')).map((x) => x.name).join('، '), undefined, dErr), K.Stat('أحداث متزامنة اليوم', 312, 'حدث', 'أوردرات · منتجات · عملاء', undefined, dEv), K.Stat('أخطاء آخر 24 ساعة', C.syncLog.filter((r) => r[5] === 'فشل').length, 'خطأ', I.filter((x) => x.status.startsWith('خطأ')).map((x) => x.name + ' — الربط فصل').join('، ') || '—', undefined, dFail)),
      h('div', { class: 'integ-tabs', 'data-itabs': '' }, tabs),
      K.Section(tabLabel, h('div', { class: 'integ-grid' }, inTab.map((p) => h('div', { class: 'card integ', 'data-integ': p.id }, h('div', { class: 'integ-h' }, h('span', { class: 'vlogo vlogo-md' }, p.letter), h('div', null, h('b', null, p.name), h('div', { class: 't-small help' }, p.desc)), K.Tag(tagFor(p.status), p.status)),
        p.conn ? h('div', { class: 'integ-conn' }, K.Tag('neutral', 'ربط: ' + p.conn)) : null,
        h('div', { class: 't-small' }, p.last), h('div', { class: 't-small help' }, p.dir),
        h('div', { class: 'acts-inline start' }, p.status === 'غير متصل' ? Button({ type: 'primary', size: 'sm', label: p.multi === 'wa' ? 'إدارة الأرقام' : 'ربط', attrs: p.multi === 'wa' ? { 'data-wa-open': '' } : undefined, onClick: () => (p.id === 'woo' ? wooWizard() : p.cs || p.multi ? csConnect(p) : connect(p)) }) : Button({ size: 'sm', label: p.multi === 'wa' ? 'إدارة الأرقام' : 'الإعدادات', attrs: p.multi === 'wa' ? { 'data-wa-open': '' } : undefined, onClick: () => { if (p.id === 'woo') { st.integ = 'woo'; R(); window.scrollTo(0, 0); } else if (p.multi === 'wa') { st.integ = 'wa'; R(); window.scrollTo(0, 0); } else K.toast('إعدادات ' + p.name + ' — نفس هيكل صفحة WooCommerce'); } }), Button({ size: 'sm', label: 'اختبار الاتصال', onClick: () => K.toast(p.status === 'غير متصل' ? 'المنصة مش متصلة' : p.status.startsWith('خطأ') ? 'فشل — الربط فصل، اعمل ربط تاني' : 'الاتصال سليم · 120ms', p.status === 'متصل' ? 'success' : 'error') }),
          p.multi === 'wa' ? Button({ type: 'text', size: 'sm', label: 'الأرقام (' + waChannels().length + ')', onClick: () => csConnect(p) }) : p.status === 'غير متصل' || p.status.startsWith('خطأ') ? Button({ type: 'text', size: 'sm', label: p.status.startsWith('خطأ') ? 'ربط تاني' : 'حذف', onClick: () => (p.status.startsWith('خطأ') ? (p.cs ? csConnect(p) : connect(p)) : K.toast('اتشالت من القائمة')) }) : Button({ type: 'text', size: 'sm', label: 'فصل', onClick: () => disconnect(p) }))))), [Button({ size: 'sm', icon: 'plus', label: 'ربط أداة تانية', attrs: { 'data-integ-add': '' }, onClick: () => addIntegration(tab) })], { sub: SUBS[tab] }),
      K.Section('سجل المزامنة', U.Table({ headers: ['الوقت', 'المنصة', 'الكيان', 'الحدث', 'الاتجاه', 'النتيجة'], rows: C.syncLog.map((r) => [r[0], r[1], K.Num(r[2]), r[3], h('span', { class: 't-small' }, r[4]), K.Tag(r[5] === 'تم' ? 'success' : r[5] === 'فشل' ? 'error' : 'orange', r[5])]) }), [Button({ label: 'عرض السجل الكامل', onClick: () => K.toast('بيفتح السجل الكامل') }), Button({ type: 'primary', label: 'إعادة محاولة الفاشلة', onClick: () => { C.syncLog.forEach((r) => { if (r[5] === 'فشل') r[5] = 'تم'; }); K.toast('اتعادت المحاولة', 'success'); R(); } })], { sub: 'آخر 50 حدث عبر كل المنصات — الأخطاء بتظهر كمان في التنبيهات (قسم «مهام»)' })];
  }
  // WhatsApp / Meta / TikTok channels are managed here only (CS channels tab removed 29 Oct); state lives in cs.api.data.channels
  function csConnect(p) { const cs = window.IBPages.all().cs; if (p.multi === 'wa') { st.integ = 'wa'; R(); window.scrollTo(0, 0); return; } if (cs && cs.api && (p.cs === 'wa1' || p.cs === 'wa2')) cs.api.qrConnect(p.cs); else connect(p); }
  function setIntegration(id, status, last) { if (String(id).startsWith('wa')) { waSync(); if (window.IBPages.current === 'settings') R(); return; } const p = C.integrations.find((x) => x.id === id || x.cs === id); if (!p) return; p.status = status; p.last = last; if (window.IBPages.current === 'settings') R(); }

  // ======================= واتساب: كارت واحد + أرقام متعددة (owner 28 Oct) =======================
  // الأرقام بتتدار من هنا بس — خدمة العملاء بتقرا نفس البيانات (cs.api.data.channels).
  const AUD = { customers: 'العملاء', vendors: 'المبتكرين' };
  function waChannels() { const cs = window.IBPages.all().cs; const ch = cs && cs.api && cs.api.data ? cs.api.data.channels : null; if (!ch) return []; return Object.keys(ch).filter((k) => k.startsWith('wa')).map((id) => ({ id: id, c: ch[id] })); }
  function waSync() {
    const p = C.integrations.find((x) => x.multi === 'wa'); const list = waChannels(); if (!p || !list.length) return;
    const on = list.filter((x) => x.c.status === 'connected').length, bad = list.filter((x) => x.c.status === 'error').length;
    p.status = bad ? 'خطأ في المزامنة' : on ? 'متصل' : 'غير متصل';
    const byAud = (a) => list.filter((x) => (x.c.aud || 'customers') === a).length;
    p.desc = 'أرقام واتساب: ' + byAud('customers') + ' للعملاء · ' + byAud('vendors') + ' للمبتكرين — كل رقم بيتربط بمسح QR';
    p.last = on + ' من ' + list.length + ' رقم متصل' + (bad ? ' · ' + bad + ' فاصل' : '');
  }
  function waPage() {
    const list = waChannels(); const cs = window.IBPages.all().cs;
    const tone = { connected: 'success', error: 'error', disconnected: 'neutral' }, lbl = { connected: 'متصل', error: 'فصل', disconnected: 'غير متصل' };
    const back = () => { st.integ = null; R(); window.scrollTo(0, 0); };
    const owners = (id) => K.chanMembers(id).map((m) => m.name);
    const rows = list.map(({ id, c }) => [h('b', null, c.name), h('span', { dir: 'ltr' }, c.number), K.Tag((c.aud || 'customers') === 'vendors' ? 'gold' : 'brand', AUD[c.aud || 'customers']),
      K.Tag(tone[c.status], lbl[c.status]),
      owners(id).length ? h('span', { class: 'chips' }, owners(id).map((n) => h('span', { class: 'list-chip' }, n))) : h('span', { class: 't-small help' }, 'الأدمن بس'),
      h('span', { class: 't-small' }, c.last || '—'), String(c.cap || '—'),
      K.RowMenu([{ label: 'تعديل', onClick: () => waEdit(id, c) }, { label: 'مين بيشتغل عليه', icon: 'users', onClick: () => waOwners(id, c) },
        c.status === 'connected' ? { label: 'فصل', danger: true, onClick: () => K.confirm({ title: 'فصل ' + c.name + '؟', text: 'الرسايل الجديدة على الرقم ده مش هتوصل، والرد الآلي والحملات عليه هيقفوا.', okType: 'danger', okLabel: 'فصل', onOk: () => { c.status = 'disconnected'; c.last = 'مش مربوط'; LOGV('settings.wa.disconnect', c.name); R(); } }) }
          : { label: c.status === 'error' ? 'إعادة الربط' : 'ربط', onClick: () => (cs && cs.api ? cs.api.qrConnect(id) : K.toast('افتح خدمة العملاء › القنوات')) },
        { label: 'حذف الرقم', danger: true, onClick: () => K.confirm({ title: 'حذف ' + c.name + '؟', text: 'الرقم هيتشال من السيستم. المحادثات القديمة بتفضل محفوظة.', okType: 'danger', okLabel: 'حذف', onOk: () => { delete cs.api.data.channels[id]; LOGV('settings.wa.remove', c.name); K.toast('اتشال ' + c.name); waSync(); R(); } }) }], 'إجراءات ' + c.name)]);
    return [h('div', { class: 'toolbar' }, Button({ type: 'text', label: '‹ الربط بالمنصات', onClick: back }), h('b', null, 'WhatsApp Business'), K.Tag(list.some((x) => x.c.status === 'error') ? 'error' : list.some((x) => x.c.status === 'connected') ? 'success' : 'neutral', list.filter((x) => x.c.status === 'connected').length + ' من ' + list.length + ' متصل')),
      K.TableSection({ title: 'أرقام واتساب', sub: 'كل رقم ليه استخدام واحد: العملاء أو المبتكرين — والرقم بيظهر في خدمة العملاء للأعضاء المحددين بس (الأدمن بيشوف الكل).',
        body: U.Table({ headers: ['الاسم', 'الرقم', 'ده لمين', 'الحالة', 'مين بيشتغل عليه', 'آخر نشاط', 'الحد اليومي', ''], rows: rows }),
        actions: [Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'إضافة رقم واتساب', attrs: { 'data-wa-add': '' }, onClick: () => waEdit() })] }),
      U.InlineNote({ kind: 'warning', children: 'الربط بمسح QR من تطبيق واتساب بيزنس — ربط غير رسمي: الإرسال الجماعي الكتير ممكن يعرّض الرقم للحظر. خلي لكل استخدام رقم لوحده وسيب الحد اليومي زي ما هو.' })];
  }
  function waEdit(id, c) {
    const cs = window.IBPages.all().cs; if (!cs || !cs.api) { K.toast('خدمة العملاء مش جاهزة'); return; }
    const ch = cs.api.data.channels; const isNew = !id;
    K.form({ title: isNew ? 'إضافة رقم واتساب' : 'تعديل ' + c.name, values: { name: c ? c.name : '', number: c ? c.number : '', aud: c ? (c.aud || 'customers') : 'customers', cap: String((c && c.cap) || 200) },
      fields: (f, e, set) => [K.two(K.field.text('name', 'اسم الرقم', f, e, set, { required: true, help: 'بيظهر في خدمة العملاء وفي سجل الإرسال' }), K.field.text('number', 'رقم الموبايل', f, e, set, { required: true, inputmode: 'tel', dir: 'ltr', help: 'رقم واتساب بيزنس شغال على موبايل' })),
        K.Radios({ label: 'الرقم ده لمين؟', required: true, value: f.aud, error: e.aud, onChange: (v) => set('aud', v), options: [{ value: 'customers', label: 'العملاء', hint: 'شات العملاء + الرد الآلي + الحملات' }, { value: 'vendors', label: 'المبتكرين', hint: 'تبليغ المبتكرين بالأوردرات والتأخير والتحويلات' }] }),
        K.field.text('cap', 'الحد اليومي للرسايل', f, e, set, { inputmode: 'numeric', help: 'بيحمي الرقم من الحظر' })],
      validate: (f) => { const er = {}; if (!String(f.name || '').trim()) er.name = 'اكتب اسم للرقم'; const n = String(f.number || '').replace(/\s/g, ''); if (!/^0?1[0-9]{9}$/.test(n)) er.number = 'رقم موبايل مصري غير صحيح'; else if (waChannels().some((x) => x.id !== id && String(x.c.number).replace(/\s/g, '') === n)) er.number = 'الرقم ده مضاف قبل كده'; if (!f.aud) er.aud = 'اختار الرقم ده لمين'; return er; },
      submitLabel: isNew ? 'إضافة الرقم' : 'حفظ',
      submit: (f) => {
        const use = f.aud === 'vendors' ? 'الاستخدام: شات المبتكرين + الرد الآلي' : 'الاستخدام: الشات + الرد الآلي + الحملات · الحد اليومي ' + f.cap;
        if (isNew) { let n = 1; while (ch['wa' + n]) n++; const key = 'wa' + n;
          ch[key] = { name: f.name, number: f.number, aud: f.aud, kind: 'qr', status: 'disconnected', last: 'مش مربوط', use: use, cap: Number(f.cap) || 200, left: Number(f.cap) || 200, today: 0, queued: 0 };
          LOGV('settings.wa.add', f.name + ' · ' + AUD[f.aud]); K.toast('اتضاف ' + f.name + ' — امسح الـ QR عشان يتربط', 'success'); waSync(); R(); cs.api.qrConnect(key); return; }
        c.name = f.name; c.number = f.number; c.aud = f.aud; c.cap = Number(f.cap) || c.cap; c.use = use;
        LOGV('settings.wa.edit', f.name); K.toast('اتحفظ'); waSync(); R();
      } });
  }
  // مين بيشتغل على القناة دي — نفس البيانات اللي في «الفريق › قنوات خدمة العملاء»
  function waOwners(id, c) {
    const staff = K.store.members.filter((m) => m.status === 'active' && !K.chanAll(m));
    const vals = {}; staff.forEach((m) => { vals['m_' + m.id] = K.canChan(m, id); });
    K.form({ title: 'مين بيشتغل على ' + c.name, values: vals,
      note: U.InlineNote({ children: 'الأدمن بيشوف كل الأرقام دايمًا. العضو اللي مش متحدد هنا مش هيشوف محادثات الرقم ده في خدمة العملاء.' }),
      fields: (f, e, set) => staff.map((m) => K.Switch({ label: m.name, hint: m.title + ' · ' + m.role, checked: !!f['m_' + m.id], onChange: (v) => set('m_' + m.id, v) })),
      submit: (f) => { staff.forEach((m) => setChan(m, id, !!f['m_' + m.id])); LOGV('settings.channel.owners', c.name + ': ' + K.chanMembers(id).map((m) => m.name).join('، ')); K.toast('اتحفظ'); R(); } });
  }
  function setChan(m, id, on) { if (!Array.isArray(m.chans)) m.chans = []; const i = m.chans.indexOf(id); if (on && i < 0) m.chans.push(id); if (!on && i > -1) m.chans.splice(i, 1); }
  const CHAN_FIXED = [['messenger', 'ماسنجر (Meta)'], ['instagram', 'إنستجرام'], ['tiktok', 'تيك توك']];
  function chanOptions() { return waChannels().map(({ id, c }) => [id, c.name + ' · ' + AUD[c.aud || 'customers']]).concat(CHAN_FIXED); }
  function chanLabelsOf(m) { const map = {}; chanOptions().forEach(([id, label]) => { map[id] = label.split(' · ')[0]; }); return K.chanList(m).map((id) => map[id]).filter(Boolean); }
  function memberChans(m) {
    if (K.chanAll(m)) { K.toast('الأدمن بيشوف كل القنوات'); return; }
    const opts = chanOptions(); const vals = {}; opts.forEach(([id]) => { vals['c_' + id] = K.canChan(m, id); });
    K.form({ title: 'قنوات خدمة العملاء — ' + m.name, values: vals,
      note: U.InlineNote({ children: 'العضو بيشوف في «خدمة العملاء» محادثات القنوات المحددة هنا بس. الأرقام بتتضاف من «الربط بالمنصات › واتساب».' }),
      fields: (f, e, set) => opts.map(([id, label]) => K.Switch({ label: label, checked: !!f['c_' + id], onChange: (v) => set('c_' + id, v) })),
      submit: (f) => { opts.forEach(([id]) => setChan(m, id, !!f['c_' + id])); LOGV('settings.member.chans', m.name + ': ' + K.chanList(m).length + ' قناة'); K.toast('اتحفظت قنوات ' + m.name); R(); } });
  }

  function wooPage() {
    const w = C.woo; const sv = (msg) => { LOGV('settings.woo', msg); K.toast('اتحفظ'); R(); };
    return [h('div', { class: 'toolbar' }, Button({ type: 'text', label: '‹ الربط بالمنصات', onClick: () => { st.integ = null; R(); } }), h('b', null, 'WooCommerce'), K.Tag('success', 'متصل')),
      K.Section('الاتصال', [K.two(U.TextInput({ id: 'w-url', label: 'رابط المتجر', required: true, value: 'https://ibtekr.club', onInput: () => {} }), U.TextInput({ id: 'w-ck', label: 'Consumer key', required: true, value: 'ck_•••••••••••••••••7f2a', onInput: () => {} })), U.TextInput({ id: 'w-cs', label: 'Consumer secret', required: true, value: 'cs_•••••••••••••••••91bd', onInput: () => {} }),
        h('div', { class: 'acts-inline start' }, K.Tag('success', 'الاتصال سليم · 120ms', 'check'), Button({ size: 'sm', label: 'اختبار الاتصال', onClick: () => K.toast('الاتصال سليم · 120ms', 'success') }), Button({ type: 'danger', size: 'sm', label: 'فصل المنصة', onClick: () => disconnect(C.integrations[0]) }))], null, { sub: 'مفاتيح REST API من WooCommerce › الإعدادات › متقدم — الصلاحية: قراءة/كتابة' }),
      K.Section('اتجاه المزامنة وقاعدة التعارض', [K.Radios({ label: 'الاتجاه', value: w.direction, onChange: (v) => { w.direction = v; sv('direction=' + v); }, options: [{ value: 'both', label: 'ثنائي الاتجاه (السيستم ⇄ WooCommerce)', hint: 'الموصى به — تغيير الحالة من الأوردرات يظهر على الموقع، وأوردر جديد من الموقع يظهر في السيستم' }, { value: 'in', label: 'من WooCommerce → السيستم فقط', hint: 'السيستم يقرأ ولا يكتب — مناسب لفترة التجربة' }, { value: 'out', label: 'من السيستم → WooCommerce فقط', hint: 'الموقع مرآة للسيستم' }] }),
        K.two(pick(w, 'freq', 'w-fr', 'تكرار المزامنة الاحتياطية', ['كل 5 دقايق', 'كل 15 دقيقة', 'كل 30 دقيقة', 'كل ساعة', 'يدوي'], 'لو الـ Webhook فشل'), pick(w, 'conflict', 'w-cf', 'عند التعارض', ['آخر تعديل يكسب (حسب الطابع الزمني)', 'السيستم دايمًا يكسب', 'المنصة دايمًا تكسب', 'إيقاف وطلب مراجعة يدوية'])),
        row('إشعار عند الفشل', 'بعد 3 محاولات متتالية — يظهر في التنبيهات › مهام ويُرسل لدور «أدمن»', w.failAlert, (v) => { w.failAlert = v; })], null, { sub: 'التحديث من أي طرف بيوصل للطرف التاني خلال ثوانٍ (Webhooks) — ولو الاتنين اتعدلوا في نفس الوقت تُطبَّق القاعدة' }),
      K.Section('الكيانات المتزامنة', [['orders', 'الأوردرات', 'الحالة، التأكيد، العربون، الملاحظات — ID الأوردر هو المفتاح الثابت'], ['subs', 'الأوردرات الفرعية (Dokan)', 'كل مبتكر في الأوردر = أوردر فرعي بنفس الـ ID الفرعي'], ['products', 'المنتجات والمخزون', 'الاسم، SKU، السعر، الكمية = «متاح» في المخزن — الصور للعرض فقط'], ['customers', 'العملاء', 'الاسم والهاتف والعنوان — بيانات حساسة (صلاحية خاصة)'], ['vendors', 'المبتكرين (Dokan vendors)', 'ربط حساب البائع بسجل المبتكر — النسبة من السيستم وليس من الموقع']].map(([k, t, d]) => row(t, d, w.ent[k], (v) => { w.ent[k] = v; })), null, { sub: 'اختار إيه اللي يتزامن — كل كيان له خريطة حقول خاصة' }),
      K.Section('خريطة الحالات', U.Table({ headers: ['حالة WooCommerce', 'حالة السيستم', 'الاتجاه'], rows: C.orderStatuses.map((s) => [h('code', { dir: 'ltr' }, s[2] + (s[2].includes('-for-') || s[2] === 'shipping' ? ' (custom)' : '')), K.Tag(s[1], s[0] + (s[0] === 'ملغي' ? ' (سبب إجباري في السيستم)' : '')), '⇄']) }), null, { sub: 'حالة WooCommerce ↔ حالة السيستم — السيستم هو مصدر الأسماء العربية' }),
      K.Section('خريطة الحقول — الأوردرات', U.Table({ headers: ['حقل السيستم', 'حقل WooCommerce', 'الاتجاه'], rows: [['رقم الأوردر', 'order.id', 'من المنصة فقط'], ['حالة الأوردر', 'order.status', '⇄'], ['حالة التأكيد', 'meta: _ibtekr_confirmation', '⇄'], ['قيمة العربون', 'meta: _ibtekr_deposit', '⇄'], ['تعليق خدمة العملاء', 'order.customer_note (private)', 'من السيستم فقط'], ['تاريخ تبليغ المبتكر', 'meta: _ibtekr_vendor_notified', 'من السيستم فقط'], ['حالة التسليم (محسوبة)', '—', '— لا تُزامن']].map((r) => [r[0], h('code', { dir: 'ltr' }, r[1]), r[2]]) }), null, { sub: 'الحقول المحسوبة (التأخير، العمولة) لا تُكتب للموقع' }),
      h('section', { class: 'card danger-zone' }, h('h2', { class: 't-h5' }, 'فصل WooCommerce'), vrow('الفصل بيوقف المزامنة فورًا ويحتفظ بكل البيانات المستوردة', 'إعادة الربط بتعيد المزامنة من آخر نقطة.', Button({ type: 'danger', label: 'فصل المنصة', onClick: () => disconnect(C.integrations[0]) })))];
  }

  // ---------- إعدادات المبتكرين ----------
  function makersV6() {
    const m = C.makers; const chips = h('div', { class: 'acts-inline start' }, U.DelayBadge('ok'), U.DelayBadge('risk'), U.DelayBadge('late'));
    return [K.Section('قواعد التأخير الافتراضية', [K.two(pick(m, 'lead', 'mk-lead', 'مدة التصنيع الافتراضية (يوم)', ['7 – 10', '10 – 12', '12 – 15', '15 – 20'], 'تظهر في كارت الأوردر الفرعي «مدة التصنيع 12–15 يوم»'), pick(m, 'risk', 'mk-risk', '«قابل للتأخير» من يوم', [7, 8, 9, 10], 'شارة برتقالية + إشعار «مبتكرين قابلين للتأخير»')),
        K.two(pick(m, 'late', 'mk-late', '«متأخر» بعد يوم', [10, 11, 12, 14], 'شارة حمراء + إشعار «مبتكرين متأخرين»'), pick(m, 'counter', 'mk-cnt', 'سقف العدّاد (يوم)', [10, 15, 20], 'شريط التقدم 0/15')),
        K.two(vrow('استثناء الحالات', 'الأوردرات دي لا تُعتبر متأخرة أبدًا', h('b', null, 'مكتمل · ملغي · استرجاع')), pick(m, 'start', 'mk-start', 'نقطة بداية الحساب', ['تاريخ تبليغ المبتكر ← وإلا تاريخ الأوردر', 'تاريخ الأوردر', 'تاريخ التأكيد'])), vrow('معاينة الشارات بالقواعد الحالية', '', chips)], null, { sub: 'بتُطبَّق على كل المبتكرين إلا اللي ليهم قاعدة خاصة — الحالة دايمًا محسوبة، لا تُكتب يدويًا' }),
      K.Section('قواعد خاصة لكل مبتكر', U.Table({ headers: ['المبتكر', 'مدة التصنيع', 'قابل للتأخير من', 'متأخر بعد', 'المصدر', 'المتوسط الفعلي', ''], rows: C.makerRules.map((r) => [...r.slice(0, 4), K.Tag(r[4] === 'مدخل يدويًا' ? 'brand' : r[4].startsWith('محسوب') ? 'info' : 'neutral', r[4]), r[5], Button({ type: 'text', size: 'sm', label: 'تعديل', onClick: () => delayRule(r) })]) }), [Button({ label: '+ قاعدة خاصة', onClick: () => delayRule() })], { sub: 'لو المبتكر معندوش مدة مدخلة، السيستم بيستخدم المتوسط الفعلي من آخر 10 أوردرات مكتملة (لو ≥ 3 أوردرات) وإلا الافتراضي' }),
      K.Section('التنشيط وإيقاف التنشيط', [row('اقتراح إيقاف تلقائي عند تكرار التأخير', 'لو ≥ 3 أوردرات متأخرة خلال 30 يوم ← تنبيه «مراجعة تنشيط المبتكر»', m.autoLate, (v) => { m.autoLate = v; }), row('اقتراح إيقاف عند عدم الرد', 'لو ≥ 2 تذكرة «مشكلة مبتكر» بدون رد 48 ساعة', m.autoNoReply, (v) => { m.autoNoReply = v; }), row('إيقاف تلقائي عند انتهاء العقد', 'بعد 7 أيام من انتهاء العقد بدون تجديد', m.autoContract, (v) => { m.autoContract = v; }), row('إعادة التنشيط تتطلب موافقة أدمن', 'المبتكر الموقوف يرجع «نشط» بعد مراجعة السبب', m.reactivate, (v) => { m.reactivate = v; }),
        K.two(pick(m, 'openEffect', 'mk-oe', 'أثر الإيقاف على الأوردرات المفتوحة', ['تستمر حتى الإغلاق + تنبيه لخدمة العملاء', 'تتحوّل لمبتكر تاني']), pick(m, 'siteEffect', 'mk-se', 'أثر الإيقاف على الموقع', ['إخفاء منتجاته + منع أوردرات جديدة', 'منع أوردرات جديدة فقط', 'لا شيء (داخلي)'])),
        vrow('أسباب الإيقاف (قائمة)', 'تُعدَّل من «القوائم والحالات»', h('b', null, C.otherLists.stop.join(' · '))), vrow('إيقاف تنشيط مبتكر', 'اقتراح من السيستم ← قرار بشري بسبب إجباري', Button({ type: 'danger', size: 'sm', label: 'إيقاف تنشيط مبتكر', onClick: () => deactivateMaker() }))], null, { sub: 'الإيقاف التلقائي بينزل كتنبيه «مهام» للموافقة — مفيش إيقاف بدون قرار بشري. السبب إجباري ويتسجل في ملف المبتكر' }),
      K.Section('الافتراضيات عند إضافة مبتكر جديد', [K.two(pick(m, 'rate', 'mk-rate', 'نسبة عمولة إبتكر الافتراضية', ['30%', '35%', '40%', '45%', '50%'], 'النطاق الحالي 30% – 65% · إبتكر الداخلي 100%'), pick(m, 'deposit', 'mk-dep', 'سياسة العربون الافتراضية', ['عربون 50% للأوردرات فوق 3,000 ج.م', 'بدون عربون'])), K.two(pick(m, 'contractLen', 'mk-cl', 'مدة العقد الافتراضية', ['6 شهور', '12 شهر', '24 شهر']), pick(m, 'contractAlert', 'mk-ca', 'تنبيه قبل انتهاء العقد', ['قبل 15 يوم', 'قبل 30 يوم', 'قبل 60 يوم'], 'يظهر في التنبيهات › مهام (أولوية عالية)')), K.two(pick(m, 'newStatus', 'mk-ns', 'حالة المبتكر الجديد', ['نشط فورًا', 'نشط بعد رفع العقد', 'معلّق للمراجعة']), pick(m, 'category', 'mk-cat', 'فئة المبتكر الافتراضية', ['— بدون'].concat(C.otherLists.categories)))], null, { sub: 'تُملأ تلقائيًا في بوب أب «إضافة مبتكر» وتظل قابلة للتعديل لكل مبتكر' }),
      loginBankSec(m)];
  }
  window.IBMakerDefaults = () => C.makers;
  if (window.IBCrumbs) window.IBCrumbs.register('settings', () => { const x = SECTIONS.find((q) => q[0] === st.sec); return x ? [{ label: x[1] }] : []; });
  // login + payout for every maker (owner 26 Oct): rules for new makers + coverage of the existing ones
  function loginBankSec(m) {
    const A = window.IBVendorsAPI; const all = A ? A.store.all() : []; const miss = (v) => A.store.missing(v.id);
    const done = all.filter((v) => !miss(v).length).length; const canInvite = all.filter((v) => v.login && v.login.username && v.email && !v.login.inviteSentAt && !v.login.passwordSetAt);
    const LS = { none: ['neutral', 'مفيش حساب'], invited: ['gold', 'مستني التفعيل'], active: ['success', 'مفعّل'], disabled: ['error', 'موقوف'] };
    return K.Section('بيانات الدخول والحساب البنكي', [
      K.two(pick(m, 'pwMode', 'mk-pw', 'طريقة الباسورد الافتراضية', ['لينك تفعيل على الإيميل', 'باسورد مؤقت'], 'الاختيار الأول في «إضافة مبتكر» — الباسورد عمره ما بيتحفظ ولا بيظهر تاني'), pick(m, 'linkTtl', 'mk-ttl', 'صلاحية لينك التفعيل', ['24 ساعة', '48 ساعة', '72 ساعة'])),
      row('يغيّر الباسورد أول ما يدخل', 'إجباري للباسورد المؤقت ولينك التفعيل', m.forceChange, (v) => { m.forceChange = v; }),
      row('الحساب البنكي إجباري عند الإضافة', 'لو اتقفل: «الحسابات» تكمّله بعدين ويظهر «ناقص» في ملف المبتكر', m.bankRequired, (v) => { m.bankRequired = v; }),
      h('div', { class: 'set-row' }, h('div', null, h('b', null, 'مكتمل ' + done + ' من ' + all.length + ' مبتكر'), h('div', { class: 't-small help' }, 'الناقص بيتكمّل من ملف كل مبتكر (بيانات الدخول + تاب الحسابات)')),
        Button({ size: 'sm', label: 'ابعت لينك التفعيل (' + canInvite.length + ')', disabled: !canInvite.length, attrs: { 'data-bulk-invite': '' }, onClick: () => { canInvite.forEach((v) => A.store.setPassword(v.id, { mode: 'link' }, A.me())); K.toast('اتبعت لينك التفعيل لـ ' + canInvite.length + ' مبتكر', 'success'); R(); } })),
      h('div', { class: 'scroll-x' }, U.Table({ cls: 'mini-table mk-cover', headers: ['المبتكر', 'حساب الدخول', 'اسم المستخدم', 'الإيميل', 'الحساب البنكي', ''], rows: all.map((v) => { const L0 = v.login || { status: 'none' }; const t = LS[L0.status] || LS.none; return [v.name, K.Tag(t[0], t[1]), L0.username ? h('span', { dir: 'ltr' }, L0.username) : '—', v.email ? h('span', { dir: 'ltr' }, v.email) : K.Tag('orange', 'ناقص'), v.bank ? K.Tag('success', 'مكتمل') : K.Tag('orange', 'ناقص'), miss(v).length ? Button({ type: 'text', size: 'sm', label: 'كمّل', onClick: () => { location.hash = 'makers/' + v.id; } }) : null]; }) }))], null, { sub: 'بيتطبق على كل المبتكرين — الجداد في «إضافة مبتكر» والقدام من هنا' });
  }

  // ---------- التنبيهات ----------
  // تابس فوق بدل صفحة طويلة (owner 28 Oct): كل جزء في تاب لوحده
  const NTABS = [{ id: 'types', label: 'أنواع التنبيهات' }, { id: 'roles', label: 'حسب الدور' }, { id: 'escalation', label: 'التصعيد' },
    { id: 'accounts', label: 'الحسابات والاشتراكات' }, { id: 'delivery', label: 'التوصيل' }, { id: 'digests', label: 'تقارير المهام' }, { id: 'quiet', label: 'ساعات الهدوء' }];
  function notifSec() {
    const tabs = K.MainTabs({ items: NTABS, active: st.ntab, onChange: (id) => { st.ntab = id; R(); }, label: 'أقسام التنبيهات' });
    const panes = { types: () => [notifTypesSec()], roles: () => [alertRolesSec()], escalation: () => [escalationSec()],
      accounts: () => [accAlertsSec(), subsAlertsSec()], delivery: () => [deliverySec()], digests: () => [digestsSec(), roleDigestsBlock()], quiet: () => [quietSec()] };
    const pane = (panes[st.ntab] || panes.types)();
    return [h('div', { class: 'ntab-bar', 'data-ntabs': '' }, tabs)].concat(pane);
  }
  function notifTypesSec() {
    const isOpen = (g) => st.nopen[g] !== false;
    const allOpen = C.notif.every(([g]) => isOpen(g));
    const chips = (v, max) => { const L = O.listShort(v, max); return h('span', { class: 'ntf-chips', title: L.all }, L.shown.map((x) => h('span', { class: 'ntf-chip' }, x)), L.more ? h('span', { class: 'ntf-chip more', dir: 'ltr', title: L.all }, '+' + L.more) : null); };
    return K.Section('أنواع التنبيهات', [
        ...C.notif.map(([g, rows]) => K.Accordion({ id: 'n-' + g, title: g, desc: NTF_DESC[g] || '', meta: rows.length + ' تنبيهات · ' + rows.filter((r) => r[4]).length + ' مفعّل', open: isOpen(g), onToggle: () => { st.nopen[g] = !isOpen(g); R(); },
          body: rows.length ? h('div', { class: 'scroll-x' }, U.Table({ cls: 'mini-table ntf-table', headers: ['نوع التنبيه', 'مفعّل', 'مدة الظهور', 'التكرار', 'القنوات', 'المستلم', ''], rows: rows.map((r) => [h('span', { class: 'ntf-name' }, r[0]), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(r[4]), 'aria-label': r[0], onClick: () => { r[4] = !r[4]; LOGV('settings.notif.toggle', r[0] + ' · ' + (r[4] ? 'مفعّل' : 'مقفول')); K.toast((r[4] ? 'اتفعّل: ' : 'اتقفل: ') + r[0]); R(); } }, h('i')), r[1],
            h('span', { class: 'ntf-rep', title: O.notifRepeat(r[5] || 'مرة واحدة', r[6] || 'كل 24 ساعة', r[7], r[8], r[9]) }, O.notifRepeatShort(r[5] || 'مرة واحدة', r[6] || 'كل 24 ساعة', r[7], r[8], r[9])), h('span', { class: 'ntf-ch', title: r[2] }, O.channelsShort(r[2])), chips(r[3], 2),
            K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => editNotif(r, g) }, { label: 'مسح', icon: 'trash', danger: true, run: () => delNotif(r, g) }])]) })) : K.Empty('مفيش تنبيهات في «' + g + '»', 'ضيف تنبيه جديد للقسم ده'),
        }))],
        [IconButton({ icon: allOpen ? 'chevU' : 'chevD', label: allOpen ? 'طي كل الأقسام' : 'فتح كل الأقسام', onClick: () => { C.notif.forEach(([g]) => { st.nopen[g] = !allOpen; }); R(); }, attrs: { class: 'icon-btn acc-tog', 'aria-expanded': String(allOpen), 'data-all': '' } }), Button({ label: '+ تنبيه جديد', onClick: () => editNotif(null) })],
        { sub: 'مدة الظهور = قد إيه يفضل في اللوحة لو محدش اتصرف · ⋮ للتعديل أو المسح' });
  }
  function escalationSec() {
    return K.Section('قواعد التصعيد', C.escalations.length ? U.Table({ headers: ['التنبيه', 'بعد', 'يتصعّد إلى', 'القناة', 'مفعّل', ''], rows: C.escalations.map((e, i) => [e.type, e.after, h('span', { class: 'wrap' }, e.to.join(' + ')), e.ch, h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(e.on), 'aria-label': 'تصعيد ' + e.type, onClick: () => { e.on = !e.on; LOGV('settings.escalation.toggle', e.type + ' · ' + (e.on ? 'مفعّل' : 'مقفول')); R(); } }, h('i')),
      K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => escalation(i) }, { label: 'مسح', icon: 'trash', danger: true, run: () => K.confirm({ title: 'مسح قاعدة التصعيد', text: '«' + e.type + '» بعد ' + e.after + ' ← ' + e.to.join(' + ') + '. القاعدة هتتمسح ومش هيتصعّد التنبيه ده تاني.', okLabel: 'مسح', okType: 'danger', onOk: () => { C.escalations.splice(i, 1); LOGV('settings.escalation.delete', e.type); K.toast('اتمسحت القاعدة'); R(); } }) }])]) }) : K.Empty('مفيش قواعد تصعيد', 'اعمل قاعدة: لو التنبيه فضل من غير إجراء مدة معينة يوصل لشخص أو دور أعلى'), [Button({ label: '+ قاعدة تصعيد', onClick: () => escalation() })], { sub: 'لو التنبيه فضل بدون إجراء المدة المحددة يتصعّد لشخص أو دور أو أكتر — ويظهر في «مهام» بأولوية عاجل' });
  }
  function quietSec() {
    const q = C.quiet;
    return K.Section('ساعات الهدوء والملخص اليومي', [K.two(pick(q, 'days', 'q-d', 'أيام الراحة', ['الجمعة', 'الجمعة والسبت', 'لا يوجد']), pick(q, 'hours', 'q-h', 'ساعات الهدوء', ['من 11:00 م إلى 9:00 ص', 'من 10:00 م إلى 8:00 ص'])), K.two(pick(q, 'waMax', 'q-w', 'الحد الأقصى لرسائل واتساب لكل عميل', ['رسالة في اليوم', 'رسالتان في اليوم', '3 رسايل']), pick(q, 'digest', 'q-dg', 'الملخص اليومي', ['9:30 ص · إيميل', '8:00 ص · إيميل'], 'عدد الأوردرات، المتأخرة، التذاكر المفتوحة، أخطاء المزامنة')), K.two(pick(q, 'signature', 'q-s', 'توقيع الرسائل', ['فريق إبتكر كلوب']), pick(q, 'langMsg', 'q-l', 'لغة رسائل العملاء', ['العربية']))], null, { sub: 'رسائل واتساب والإيميل بتتأجل لبعد ساعات الهدوء — التنبيهات داخل السيستم بتظهر عادي' });
  }
  // تنبيهات الاشتراكات (owner 28 Oct): التنبيه الافتراضي للاشتراك الجديد + اللي قرب يخلص
  function subsAlertsSec() {
    const S2 = K.store; S2.subsAlert = S2.subsAlert || { def: 'month', repeat: 'كل 24 ساعة', to: 'أدمن + الحسابات' };
    const A = S2.subsAlert; const DD = window.IbtekrDomain;
    const subs = (window.IBAccounts && window.IBAccounts.subsDueNow) ? window.IBAccounts.subsDueNow() : [];
    const rows = subs.map((x) => [x.name, K.Num(DD.formatDateNumeric(x.ends)), K.Tag(x.expired ? 'error' : x.due ? 'orange' : 'success', x.expired ? 'انتهى من ' + Math.abs(x.daysLeft) + ' يوم' : x.daysLeft === 0 ? 'بينتهي النهاردة' : 'باقي ' + x.daysLeft + ' يوم'),
      (DD.SUB_ALERTS.find((a) => a[0] === (x.alerts || [])[0]) || [, '—'])[1]]);
    const sel = (id, label, val, opts, onCh, help) => h('div', null, U.Select({ id, label, options: opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)), value: String(val), onChange: (v) => { onCh(v); LOGV('settings.change', label + ' = ' + v); K.toast('اتحفظ'); R(); } }), help ? h('div', { class: 't-small help' }, help) : null);
    return K.Section('تنبيهات الاشتراكات', [
      K.two(sel('sub-def', 'التنبيه الافتراضي للاشتراك الجديد', A.def, DD.SUB_ALERTS.map(([k, lb, d]) => ({ value: k, label: 'قبل الانتهاء ' + lb + ' (' + d + ' يوم)' })), (v) => { A.def = v; }, 'بيتملّى لوحده في بوب أب «إضافة مصروفات › الاشتراكات» وتقدر تغيّره لكل اشتراك'),
        sel('sub-rep', 'تكرار التنبيه لحد التجديد', A.repeat, ['مرة واحدة', 'كل 24 ساعة', 'كل 12 ساعة'], (v) => { A.repeat = v; })),
      K.two(sel('sub-to', 'المستلم', A.to, ['أدمن + الحسابات', 'أدمن', 'الحسابات'], (v) => { A.to = v; }), h('div', null)),
      rows.length ? U.Table({ cls: 'mini-table', headers: ['الاشتراك', 'تاريخ التجديد', 'الحالة', 'التنبيه'], rows }) : K.Empty('مفيش اشتراكات مسجّلة', 'الاشتراكات بتتسجل من «الحسابات › المصروفات › الاشتراكات»'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, Button({ size: 'sm', label: 'افتح الاشتراكات في الحسابات', attrs: { 'data-subs-open': '' }, onClick: () => { location.hash = 'expenses'; } }))],
      null, { sub: 'كل اشتراك ليه تنبيه واحد قبل الانتهاء — بيظهر في الإشعارات › الحسابات وبيتكرر لحد ما تجدده' });
  }

  // owner 22 Oct — delivery: who prepares Bosta waybills + the warehouse as sender/receiver
  function deliverySec() {
    const d = K.store.delivery; const team = K.team().filter((m) => m.status !== 'inactive');
    const txt = (k, id, label, help) => U.TextInput({ id, label, value: d[k], help, onInput: (v) => { d[k] = v; } });
    return K.Section('التوصيل وبوالص بوسطة', [
      K.two(U.Select({ id: 'dl-co', label: 'شركة الشحن', options: [{ value: 'بوسطة', label: 'بوسطة (Bosta)' }], value: d.company, onChange: (v) => { d.company = v; R(); } }),
        U.Select({ id: 'dl-own', label: 'المسؤول عن التوصيل', options: team.map((m) => ({ value: m.id, label: m.name + ' — ' + m.role })), value: d.owner, onChange: (v) => { d.owner = v; LOGV('settings.delivery.owner', K.member(v).name); R(); document.dispatchEvent(new Event('ib:notify')); }, help: 'بيستلم «بوليصة مطلوبة» والملخص اليومي على واتساب على رقمه في ملفه' })),
      K.two(txt('whName', 'dl-wn', 'اسم المخزن (المرسل / المستلم)'), txt('whPhone', 'dl-wp', 'تليفون المخزن')), txt('whAddress', 'dl-wa', 'عنوان المخزن', 'بيظهر في بوليصة «من المخزن للعميل» و«من المبتكر للمخزن»'),
      U.Table({ cls: 'mini-table', headers: ['حالة الأوردر الفرعي', 'المرسل', 'المستلم', 'التحصيل'], rows: [['جاهز للشحن من المبتكر للعميل', 'المبتكر', 'العميل', 'المتبقي'], ['جاهز للشحن من المخزن للعميل', 'المخزن', 'العميل', 'المتبقي'], ['جاهز للشحن من المبتكر للمخزن', 'المبتكر', 'المخزن', 'مفيش']] })],
      null, { sub: 'أول ما الأوردر الفرعي يبقى «جاهز للشحن …» بيتبعت للمسؤول بيانات البوليصة: الاسم والتليفون (واتساب) والعنوان + الإجمالي والعربون والمتبقي' });
  }

  const NTF_DESC = { 'عملاء': 'متابعة الأوردرات والتأكيد مع العميل', 'المبتكرين': 'التأخير والعقود وتقارير المبتكر على واتساب', 'مهام': 'التذاكر والمراجعات وأعطال الربط', 'الفريق': 'الإجازات والوقت الإضافي والمنتجات الفردية', 'الحسابات': 'المرتبات وكشوف حساب المبتكرين والاشتراكات', 'المخزن': 'التجميع والتصوير والمرتجعات', 'رسايل': 'رسايل العملاء والقنوات والحملات', 'التوصيل': 'بوالص بوسطة — المرسل والمستلم والتحصيل' };
  function delNotif(r, g) {
    const esc = C.escalations.filter((e) => e.type === r[0]);
    K.confirm({ title: 'مسح نوع التنبيه', text: '«' + r[0] + '» من قسم ' + g + ' هيتمسح ومش هيتبعت تاني.' + (esc.length ? ' وقواعد التصعيد بتاعته (' + esc.length + ') هتتمسح معاه.' : ''), okLabel: 'مسح', okType: 'danger',
      onOk: () => { const rows = C.notif.find(([x]) => x === g)[1]; rows.splice(rows.indexOf(r), 1); C.escalations = C.escalations.filter((e) => e.type !== r[0]); LOGV('settings.notif.delete', g + ' › ' + r[0]); K.toast('اتمسح التنبيه'); R(); } });
  }

  // ---------- owner 22 Oct: alerts by role ----------
  const ASYM = { R: ['check', 'يستلم', 'full'], S: ['eye', 'يشوف بس', 'part'], N: ['○', 'لا', 'none'] };
  const asymMark = (c) => (c === 'N' ? '○' : Icon(ASYM[c][0], 'sm'));
  function alertRolesSec() {
    const NR = window.IbtekrNotifRoles; if (!NR) return null; const M = K.store.alertRoles; const groups = [...new Set(NR.SOURCES.map((x) => x.section))]; const isOpen = (g) => st.aopen[g] !== false;
    const cell = (src, ci, r) => { const ok = NR.canSee(C.perms, src, ci); const c = NR.access(M, C.perms, src.key, ci);
      if (!ok) return h('button', { type: 'button', class: 'pm pm-none', disabled: '', 'aria-label': src.label + ' — ' + r + ': مالوش صلاحية', title: 'الدور ده مالوش صلاحية «' + src.perm.g + ' › ' + src.perm.r + '»' + (src.perm.need === 'F' ? ' كاملة' : '') + ' — غيّرها من الأدوار والصلاحيات الأول' }, '—');
      return h('button', { type: 'button', class: 'pm pm-' + ASYM[c][2], 'aria-label': src.label + ' — ' + r + ': ' + ASYM[c][1], title: ASYM[c][1] + ' — اضغط للتغيير', onClick: () => { const nx = NR.nextCode(c, ci); const v = (M[src.key] || NR.DEFAULTS[src.key]).split(''); v[ci] = nx; M[src.key] = v.join(''); LOGV('settings.alert.role', src.label + ' / ' + r + ': ' + ASYM[c][1] + ' ← ' + ASYM[nx][1]); R(); document.dispatchEvent(new Event('ib:notify')); } }, asymMark(c)); };
    const cnt = (ci) => NR.SOURCES.filter((x) => NR.access(M, C.perms, x.key, ci) === 'R').length;
    return K.Section('التنبيهات حسب الدور', [h('div', { class: 'legend t-small' }, ...Object.keys(ASYM).map((k) => h('span', { class: 'pm pm-' + ASYM[k][2] }, asymMark(k), ' ' + ASYM[k][1])), h('span', { class: 'pm pm-none' }, '— مالوش صلاحية')),
      h('p', { class: 't-small help ntf-hint' }, 'يستلم = في الجرس وعلى القنوات · يشوف بس = باهت «للعلم» من غير إشعار · اضغط على الخانة للتغيير. تجاوز لموظف: الفريق ← ⋮ ← تنبيهات مخصصة.'),
      h('div', { class: 'scroll-x' }, h('div', { class: 'matrix', style: '--cols:' + live().length }, h('div', { class: 'mx-row mx-head' }, h('span', null, 'التنبيه'), live().map(([r, ci]) => h('span', { class: 't-label-s' }, r, h('small', { class: 't-small help', style: 'display:block' }, cnt(ci) + ' بيستلمه')))),
        groups.map((g) => h('div', { class: 'mx-group' + (isOpen(g) ? ' open' : '') }, h('div', { class: 'mx-gh' }, h('button', { type: 'button', class: 'acc-t', 'aria-expanded': String(isOpen(g)), onClick: () => { st.aopen[g] = !isOpen(g); R(); } }, h('span', { class: 't-label' }, g), h('span', { class: 't-small acc-d' }, NTF_DESC[g] || '')), h('span', { class: 't-small meta' }, NR.SOURCES.filter((x) => x.section === g).length + ' أنواع'), IconButton({ icon: isOpen(g) ? 'chevU' : 'chevD', label: (isOpen(g) ? 'طي ' : 'فتح ') + g, onClick: () => { st.aopen[g] = !isOpen(g); R(); }, attrs: { class: 'icon-btn acc-tog', 'aria-expanded': String(isOpen(g)) } })),
          isOpen(g) ? NR.SOURCES.filter((x) => x.section === g).map((src) => h('div', { class: 'mx-row' }, h('span', null, src.label), live().map(([r, ci]) => cell(src, ci, r)))) : null))))],
      [Button({ label: 'رجوع للافتراضي', onClick: () => K.confirm({ title: 'رجوع للافتراضي', text: 'كل تعديلات الأدوار على التنبيهات هتتشال وترجع القيم المبدئية.', okLabel: 'رجوع للافتراضي', onOk: () => { Object.keys(M).forEach((k) => delete M[k]); LOGV('settings.alert.role.reset', '—'); K.toast('رجعت للافتراضي'); R(); } }) })],
      { sub: 'مين يستلم أنهي تنبيه — نفس فكرة مصفوفة الصلاحيات، والجرس بيتفلتر بدور كل موظف' });
  }
  function memberAlerts(m) {
    const NR = window.IbtekrNotifRoles; const ci = roleIndex(m.role); const cur = Object.assign({}, (K.store.alertOverrides[m.id] || {}));
    K.form({ title: 'تنبيهات مخصصة — ' + m.name, wide: true, values: cur, note: U.InlineNote({ children: 'الافتراضي «حسب الدور» (' + m.role + '). التجاوز بيشتغل جوه حدود صلاحيات الدور — اللي مالوش صلاحية مقفول.' }),
      fields: (f, e, set) => [h('div', { class: 'ma-list' }, NR.SOURCES.map((src) => { const ok = NR.canSee(C.perms, src, ci); const role = NR.access(K.store.alertRoles, C.perms, src.key, ci);
        return h('div', { class: 'ma-row' }, h('span', null, h('small', { class: 't-small help' }, src.section + ' › '), src.label), ok ? U.Select({ id: 'ma-' + src.key.replace('.', '-'), label: '', options: [{ value: 'role', label: 'حسب الدور (' + ASYM[role][1] + ')' }, { value: 'R', label: 'يستلم' }, { value: 'S', label: 'يشوف بس' }].concat(ci === 0 ? [] : [{ value: 'N', label: 'لا' }]), value: f[src.key] || 'role', onChange: (v) => set(src.key, v, true) }) : h('span', { class: 't-small help' }, '— مالوش صلاحية')); }))],
      submitLabel: 'حفظ', submit: (f) => { const o = {}; Object.keys(f).forEach((k) => { if (f[k] && f[k] !== 'role') o[k] = f[k]; }); K.store.alertOverrides[m.id] = o; LOGV('settings.alert.member', m.name + ': ' + Object.keys(o).length + ' تجاوز'); K.toast('اتحفظت تنبيهات ' + m.name, 'success'); R(); document.dispatchEvent(new Event('ib:notify')); } });
  }
  function roleDigestsBlock() {
    const NR = window.IbtekrNotifRoles; const N = window.IBNotif; if (!NR) return null; const at = (K.store.roleDigestAt = K.store.roleDigestAt || {});
    // جدول منفصل في نفس التاب (owner 2 Nov 18:06) — كان جوه كارت «تقارير المهام المخصصة»
    return K.Section('ملخص يومي تلقائي لكل دور', [
      U.Table({ cls: 'mini-table', headers: ['الدور', 'مفعّل', 'بيشمل', 'الساعة', ''], rows: live().map(([r, ci]) => { const keys = NR.roleDigestKeys(K.store.alertRoles, C.perms, ci); const on = K.store.roleDigests[r] !== false;
        return [h('b', null, 'الملخص اليومي — ' + r), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(on), 'aria-label': 'الملخص اليومي — ' + r, onClick: () => { K.store.roleDigests[r] = !on; K.toast((!on ? 'اتفعّل' : 'اتقفل') + ' ملخص ' + r); R(); } }, h('i')), keys.length + ' تنبيهات',
          h('div', { class: 'inline-sel' }, U.Select({ id: 'rd-at-' + ci, label: '', options: O.NOTIF_TIMES.map((x) => ({ value: x, label: x })), value: at[r] || O.NOTIF_DEFAULT_AT, onChange: (v) => { at[r] = v; K.toast('اتحفظ'); R(); } })),
          K.RowMenu([{ label: 'معاينة', icon: 'eye', run: () => N && N.openDigest({ name: 'الملخص اليومي — ' + r, keys, to: [r], every: 'يوميًا', at: at[r] || O.NOTIF_DEFAULT_AT }) }])]; }) })],
      null, { sub: 'بيتجمّع لوحده من التنبيهات اللي الدور «يستلمها» في «حسب الدور» — مش محتاج تعمله بإيدك · غيّر الساعة أو اقفله من هنا' });
  }
  // ---------- owner 22 Oct: accounts alerts settings + custom task reports ----------
  function syncStmtRow() { const A = K.store.accAlerts; C.notif.forEach(([, rows]) => rows.forEach((r) => { if (/^كشف حساب المبتكرين/.test(r[0])) { if (A.cycle === 'monthDays') { r[6] = 'أيام محددة من الشهر'; r[8] = A.days.slice(); } else { r[6] = 'كل 24 ساعة'; } } })); }
  function accAlertsSec() {
    const A = K.store.accAlerts; const N = window.IBNotif; const IB = window.IbtekrVendors;
    const sel = (id, label, val, opts, onCh, help) => h('div', null, U.Select({ id, label, options: opts, value: String(val), onChange: (v) => { onCh(v); LOGV('settings.change', label + ' = ' + v); K.toast('اتحفظ'); R(); } }), help ? h('div', { class: 't-small help' }, help) : null);
    const per = A.cycle === 'monthDays' ? O.monthDaysPeriod(K.TODAY, A.days) : IB.biweeklyPeriod(K.TODAY, A.anchor); const due = O.payrollDue(K.TODAY, { payDay: A.payDay, lead: A.lead, status: K.store.sheet.status });
    return K.Section('تنبيهات الحسابات', [
      K.two(sel('acc-pd', 'يوم صرف المرتبات (من الشهر)', A.payDay, Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: 'يوم ' + (i + 1) })), (v) => { A.payDay = Number(v); }, 'الصرف الجاي: ' + due.date + ' · فاضل ' + due.daysLeft + ' يوم'),
        sel('acc-lead', 'التنبيه يبدأ قبل الصرف بـ', A.lead, [3, 5, 7, 10, 14].map((n) => ({ value: String(n), label: n + ' أيام' })), (v) => { A.lead = Number(v); }, 'بيفضل يتكرر لحد ما الكشف يتعلّم «مدفوع»')),
      K.two(sel('acc-cyc', 'دورة كشف حساب المبتكرين', A.cycle, [{ value: 'monthDays', label: 'أيام محددة من الشهر' }, { value: 'biweekly', label: 'كل أسبوعين (14 يوم من السبت)' }], (v) => { A.cycle = v; syncStmtRow(); }, 'بيشمل الرصيد بعد المواصلات + الناجحة (مكتمل) + الفاشلة (ملغي + مرتجع) + العربون المستلم + المواصلات في الفترة'),
        h('div', null, h('b', null, 'آخر كشف: ' + per.from + ' → ' + per.to), h('div', { class: 't-small help' }, 'اتبعت ' + per.due + ' · الكشف الجاي ' + per.next))),
      A.cycle === 'monthDays' ? daysGroup(A, {}, (k, v) => { if (!v.length) return K.toast('لازم يوم واحد على الأقل'); A.days = v; syncStmtRow(); LOGV('settings.change', 'أيام كشف المبتكرين = ' + O.monthDaysLabel(v)); K.toast('اتحفظ'); R(); }) : null,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, Button({ size: 'sm', label: 'معاينة تنبيه المرتبات', onClick: () => N && N.openPayrollAlert() }), Button({ size: 'sm', label: 'معاينة كشوف المبتكرين', onClick: () => { location.hash = 'orders'; setTimeout(() => { const b = document.querySelector('.notif-btn'); if (b) b.click(); }, 300); } }))],
      null, { sub: 'المرتبات قبل يوم الصرف + كشف حساب كل مبتكر في الأيام اللي تحددها — بيظهروا في الإشعارات › الحسابات' });
  }
  const DG_EVERY = ['يوميًا', 'أيام الشغل (السبت – الخميس)', 'أسبوعيًا (السبت)', 'أسبوعيًا (الأحد)', 'كل أسبوعين', 'أيام محددة من الشهر'];
  function digestsSec() {
    const L = K.store.digests; const N = window.IBNotif;
    return K.Section('تقارير المهام المخصصة', [note('اجمع أكتر من تنبيه في تقرير واحد للمهام اللي المفروض الموظف أو القسم يعملها — بيوصله في ميعاده ويظهر في الإشعارات › تقارير المهام.'),
      L.length ? U.Table({ cls: 'mini-table', headers: ['التقرير', 'مفعّل', 'بيشمل', 'المستلم', 'الميعاد', ''], rows: L.map((d) => [h('span', { class: 'wrap' }, h('b', null, d.name)), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(d.on), 'aria-label': d.name, onClick: () => { d.on = !d.on; K.toast((d.on ? 'اتفعّل: ' : 'اتقفل: ') + d.name); R(); } }, h('i')), h('span', { class: 'wrap' }, d.keys.length + ' تنبيهات'), h('span', { class: 'wrap' }, d.to.join(' + ')), h('span', { class: 'wrap' }, (d.every === 'أيام محددة من الشهر' && d.days ? O.monthDaysLabel(d.days) : d.every) + ' · ' + d.at),
        K.RowMenu([{ label: 'معاينة', icon: 'eye', run: () => N && N.openDigest(d) }, { label: 'تعديل', icon: 'sliders', run: () => editDigest(d) }, { label: 'مسح', icon: 'trash', danger: true, run: () => K.confirm({ title: 'مسح التقرير', text: 'هيتمسح «' + d.name + '» ومش هيتبعت تاني.', okLabel: 'مسح', okType: 'danger', onOk: () => { L.splice(L.indexOf(d), 1); LOGV('settings.digest.delete', d.name); K.toast('اتمسح'); R(); } }) }])]) }) : K.Empty('مفيش تقارير مهام', 'اعمل أول تقرير وحدد التنبيهات اللي يجمعها')],
      [Button({ type: 'brand', label: '+ تقرير مهام جديد', onClick: () => editDigest(null) })], { sub: 'مثال: «مهام خدمة العملاء اليومية» = متأخرة + غير مؤكد + في انتظار الرد + معلّق' });
  }
  function editDigest(d) {
    const N = window.IBNotif; const src = N ? N.sources() : []; const secs = [...new Set(src.map((x) => x.section))];
    const people = O.NOTIF_TEAMS.filter((t) => t !== O.VENDOR_RECIPIENT).concat(K.team().map((m) => m.name));
    K.form({ title: d ? 'تعديل تقرير مهام' : 'تقرير مهام جديد', wide: true, values: d ? { name: d.name, keys: d.keys.slice(), to: d.to.slice(), every: d.every, at: d.at, ch: d.ch, days: (d.days || [16, 'last']).slice() } : { name: '', keys: [], to: [], every: 'يوميًا', at: O.NOTIF_DEFAULT_AT, ch: 'داخل السيستم', days: [16, 'last'] },
      validate: (f) => { const e = K.req(f, ['name']); if (!f.keys.length) e.keys = 'اختار تنبيه واحد على الأقل'; if (!f.to.length) e.to = 'اختار مستلم واحد على الأقل'; if (f.every === 'أيام محددة من الشهر' && !f.days.length) e.days = 'اختار يوم واحد على الأقل'; return e; },
      fields: (f, e, set) => {
        const r = O.digest(src, f.keys);
        const group = (id, label, opts, help) => h('div', { class: 'field' + (e[id] ? ' has-err' : '') }, h('span', { class: 'flabel', id: id + '-l' }, label, h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), opts, e[id] ? h('div', { class: 'err-msg', role: 'alert' }, e[id]) : h('div', { class: 'help' }, help));
        return [K.field.text('name', 'اسم التقرير', f, e, set, { required: true, placeholder: 'مثلًا: مهام خدمة العملاء اليومية' }),
          group('keys', 'التنبيهات اللي يجمعها', h('div', { class: 'dg-src', id: 'keys', role: 'group', 'aria-labelledby': 'keys-l' }, secs.map((sec) => h('div', { class: 'dg-sec' }, h('b', { class: 't-label' }, sec), h('div', { class: 'cb-group' }, src.filter((x) => x.section === sec).map((x) => K.Checkbox({ label: x.label + ' (' + x.items.length + ')', checked: f.keys.includes(x.key), onChange: (v) => set('keys', v ? f.keys.concat(x.key) : f.keys.filter((k) => k !== x.key), true) })))))),
            'لو دلوقتي: ' + r.total + ' مهمة — ' + (r.groups.filter((g) => g.count).map((g) => g.label + ' ' + g.count).join(' · ') || 'مفيش')),
          group('to', 'المستلم', h('div', { class: 'cb-group', id: 'to', role: 'group', 'aria-labelledby': 'to-l' }, people.map((t) => K.Checkbox({ label: t, checked: f.to.includes(t), onChange: (v) => set('to', v ? f.to.concat(t) : f.to.filter((x) => x !== t), true) }))), 'قسم أو موظف أو أكتر'),
          K.two(K.field.select('every', 'بيتبعت', DG_EVERY, f, e, set), K.field.select('at', 'الساعة', O.NOTIF_TIMES.slice(), f, e, set, { help: 'افتراضي 12:00 ص' })), f.every === 'أيام محددة من الشهر' ? daysGroup(f, e, set) : null,
          K.field.select('ch', 'القنوات', ['داخل السيستم', 'داخل السيستم + إيميل', 'داخل السيستم + واتساب', 'داخل السيستم + واتساب + إيميل'], f, e, set)];
      },
      submitLabel: d ? 'حفظ' : 'إنشاء التقرير',
      submit: (f) => { const v = { name: f.name.trim(), keys: f.keys.slice(), to: f.to.slice(), every: f.every, at: f.at, ch: f.ch, days: f.every === 'أيام محددة من الشهر' ? f.days.slice() : null }; if (d) Object.assign(d, v); else K.store.digests.push(Object.assign({ id: 'DG-' + String(K.store.digests.length + 1).padStart(2, '0'), on: true }, v)); LOGV(d ? 'settings.digest.edit' : 'settings.digest.add', v.name); K.toast(d ? 'اتحفظ' : 'اتعمل التقرير', 'success'); R(); document.dispatchEvent(new Event('ib:notify')); } });
  }

  // ---------- القوائم والحالات ----------
  function lists() {
    const L = C.otherLists; const tabs = [{ id: 'order', label: 'حالات الأوردر' }, { id: 'confirm', label: 'حالات التأكيد' }, { id: 'sub', label: 'حالات الأوردر الفرعي' }, { id: 'cancel', label: 'أسباب الإلغاء والمسح' }, { id: 'returns', label: 'أسباب المرتجع' }, { id: 'expenses', label: 'أنواع المصروفات' }, { id: 'categories', label: 'فئات المبتكرين' }, { id: 'stop', label: 'أسباب إيقاف المبتكر' }];
    const out = [K.SubTabs({ items: tabs, active: st.list, onChange: (id) => { st.list = id; R(); }, label: 'القوائم' })];
    if (st.list === 'order') out.push(K.Section('حالات الأوردر', U.Table({ headers: ['', 'الاسم في السيستم', 'المعاينة', 'مقابل WooCommerce', 'قابلة للتعديل', 'النوع', ''], rows: C.orderStatuses.map((s, i) => [h('span', { class: 'drag', 'aria-hidden': 'true' }, '⋮⋮'), s[0], K.Tag(s[1], s[0]), h('code', { dir: 'ltr' }, s[2]), s[3], s[4], K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => statusForm('order', i) }, i > 0 ? { label: 'تحريك لفوق', icon: 'chevD', run: () => { const a = C.orderStatuses; [a[i - 1], a[i]] = [a[i], a[i - 1]]; R(); } } : null, s[3] === 'نعم' ? { label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف «' + s[0] + '»', text: 'لو مستخدمة في سجلات قديمة هتتحوّل «مؤرشفة» وتختفي من القوائم الجديدة بس.', okType: 'danger', okLabel: 'حذف', onOk: () => { C.orderStatuses.splice(i, 1); R(); } }) } : null].filter(Boolean))]) }), [Button({ label: '+ حالة جديدة', onClick: () => statusForm('order') })], { sub: 'الترتيب = ترتيب الظهور في الدروب داون والفلاتر. الحالات النظامية (مكتمل، ملغي، استرجاع) لا تُحذف — تُعاد تسميتها فقط.' }));
    else if (st.list === 'cancel') out.push(K.Section('أسباب الإلغاء والمسح', U.Table({ headers: ['السبب', 'يُستخدم في', 'مرات الاستخدام (30 يوم)', 'مفعّل'], rows: C.cancelReasons.map((r) => [r[0], r[1], String(r[2]), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(r[3]), 'aria-label': r[0], onClick: () => { r[3] = !r[3]; R(); } }, h('i'))]) }), [Button({ label: '+ سبب', onClick: () => simpleAdd('سبب جديد', (v) => C.cancelReasons.splice(C.cancelReasons.length - 1, 0, [v, 'إلغاء', 0, true])) })], { sub: 'القائمة المتحكم فيها اللي بتظهر في بوب أب «تأكيد المسح» وتعديل الحالة إلى ملغي — «أخرى» بتفتح خانة نص إجبارية' }));
    else { const titles = { confirm: 'حالات التأكيد', sub: 'حالات الأوردر الفرعي', returns: 'أسباب المرتجع', expenses: 'أنواع المصروفات', categories: 'فئات المبتكرين', stop: 'أسباب إيقاف المبتكر' }; const items = L[st.list];
      out.push(K.Section(titles[st.list], U.Table({ headers: ['', 'الاسم', 'مفعّل', ''], rows: items.map((x, i) => [h('span', { class: 'drag', 'aria-hidden': 'true' }, '⋮⋮'), x, K.Tag('success', 'نعم'), K.RowMenu([{ label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف «' + x + '»', text: 'حذف عنصر مستخدم في سجلات قديمة غير مسموح — بيتحول إلى «مؤرشف» ويختفي من القوائم الجديدة فقط.', okType: 'danger', okLabel: 'أرشفة', onOk: () => { items.splice(i, 1); R(); } }) }])]) }), [Button({ label: '+ إضافة', onClick: () => simpleAdd('عنصر جديد', (v) => items.push(v)) })], { sub: st.list === 'sub' ? '11 حالة — «مؤكد» بتتحط تلقائي لما الأوردر الرئيسي يتأكد · «جاهز للشحن …» (3 اتجاهات) بتطلب بوليصة بوسطة من المسؤول عن التوصيل · «مرتجع للمخزن» و«مرتجع للمبتكر» بيفتحوا بوب أب بسبب إجباري وتاريخ وأثر' : st.list === 'returns' ? 'بتظهر في بوب أب المرتجع — «أخرى» بتفتح خانة نص إجبارية' : 'الاسم، الترتيب، مفعّل' })); }
    out.push(note('حذف عنصر مستخدم في سجلات قديمة غير مسموح — بيتحول إلى «مؤرشف» ويختفي من القوائم الجديدة فقط.'));
    return out;
  }

  // ---------- الحسابات والدفع ----------
  function payments() {
    const p = C.payout;
    return [K.Section('حسابات الشركة', U.Table({ headers: ['الحساب', 'النوع', 'الرقم / المعرّف', 'الربط', 'مفعّل', ''], rows: C.accounts.map((a) => [a.name, a.kind, h('span', { dir: 'ltr' }, a.ident), K.Tag(a.link === 'غير مربوط' ? 'neutral' : 'info', a.link), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(a.on), 'aria-label': a.name, onClick: () => { a.on = !a.on; R(); } }, h('i')), K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => addAccount(a) }, { label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف الحساب', text: 'هيتشال «' + a.name + '». الحركات القديمة هتفضل في السجل.', okType: 'danger', okLabel: 'حذف', onOk: () => { C.accounts = C.accounts.filter((x) => x !== a); R(); } }) }])]) }), [Button({ label: '+ حساب', onClick: () => addAccount() })], { sub: 'الحسابات اللي بتظهر في تاب «الحساب الفعلي» وفي بوب أب «إضافة مبلغ» — الأرصدة تُدخل يدويًا حتى الربط البنكي' }),
      K.Section('تحويل مستحقات المبتكرين', [h('div', { class: 'grid3' }, pick(p, 'after', 'p-af', 'يُحوَّل بعد حالة', ['مكتمل + 7 أيام (فترة الاسترجاع)', 'مكتمل']), pick(p, 'min', 'p-min', 'الحد الأدنى للتحويل', ['250 ج.م', '500 ج.م', '1,000 ج.م'], 'الأرصدة الأقل بتترحّل للدورة التالية'), pick(p, 'cycle', 'p-cy', 'دورية التحويل', ['أسبوعي', 'كل أسبوعين — يوم الأحد', 'شهري', 'يدوي'])),
        h('div', { class: 'grid3' }, pick(p, 'notify', 'p-nt', 'إشعار المبتكر بالتحويل', ['واتساب + كشف حساب PDF', 'إيميل']), pick(p, 'method', 'p-me', 'طريقة التحويل الافتراضية', ['تحويل بنكي (InstaPay)', 'فودافون كاش']), pick(p, 'approval', 'p-ap', 'الموافقة مطلوبة من', ['حسابات فقط', 'حسابات + أدمن (توقيعان)', 'أدمن فقط'])),
        row('خصم العربون تلقائيًا من المستحقات', 'العربون المدفوع مقدمًا يُخصم قبل التحويل ويظهر بالسالب في حساب المبتكر', p.deductDeposit, (v) => { p.deductDeposit = v; }), row('إيقاف التحويل لو عليه أوردرات متأخرة', 'التحويل بيستنى لحد ما الأوردرات المتأخرة تتقفل — مع تنبيه للحسابات', p.holdLate, (v) => { p.holdLate = v; })], null, { sub: 'بيحدد إمتى وإزاي بيتم تحويل أرصدة «لصالح المبتكرين» — كل تحويل بيتسجل في Payout_Log ويحتاج موافقة حسب الصلاحيات' }),
      K.Section('الفاتورة وكشف الحساب', [h('div', { class: 'grid3' }, pick(p, 'invLang', 'p-il', 'لغة الفاتورة', ['عربي + إنجليزي', 'عربي']), pick(p, 'tax', 'p-tx', 'الرقم الضريبي', ['—']), h('div', null, U.TextInput({ id: 'p-pr', label: 'بادئة رقم الفاتورة', required: true, value: p.prefix, onInput: (v) => { p.prefix = v; } }), h('div', { class: 't-small help' }, 'الرقم التالي: ' + p.next))),
        h('div', { class: 'grid3' }, pick(p, 'commission', 'p-cm', 'تضمين العمولة لكل أوردر', ['نعم', 'لا']), pick(p, 'orders', 'p-or', 'تضمين تفاصيل الأوردرات', ['نعم — جدول الأوردرات المكتملة', 'لا']), pick(p, 'footer', 'p-ft', 'ملاحظة أسفل الفاتورة', ['شكرًا لكونك جزءًا من مجتمع إبتكر', 'بيت لكل مبتكر']))], null, { sub: 'قالب PDF بيتبعت للمبتكر مع كل تحويل — اللوجو وبيانات الشركة من قسم «عام»' })];
  }

  // ---------- سجل النشاط ----------
  function activity() {
    const mine = S.activity.slice(0, 20).map((a) => [a.at.slice(11) ? 'اليوم ' + a.at.slice(11) : a.at, a.actor, a.action.split('.')[0], a.action, h('span', { class: 'wrap' }, a.detail), 'الويب']);
    const rows = mine.concat(C.activity);
    return [K.Section('سجل النشاط', [h('div', { class: 'toolbar' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), h('input', { type: 'search', placeholder: 'ابحث برقم أوردر أو اسم', 'aria-label': 'بحث في السجل' })), ['العضو', 'الصفحة', 'النوع'].map((x, i) => U.Select({ id: 'ac-' + i, label: '', options: [{ value: '', label: x + ': الكل' }], value: '', onChange: () => {} })), U.Select({ id: 'ac-p', label: '', options: [{ value: '7', label: 'الفترة: آخر 7 أيام' }], value: '7', onChange: () => {} }), Button({ label: 'تصدير CSV', icon: 'download', onClick: () => K.toast('اتجهز ملف السجل') })),
        U.Table({ headers: ['الوقت', 'العضو', 'الصفحة', 'الإجراء', 'التغيير (قديم ← جديد)', 'المصدر'], rows: rows.map((r) => [r[0], r[1], r[2], h('span', { class: 'wrap' }, r[3]), r[4], K.Tag(r[5] === 'الويب' ? 'neutral' : r[5] === 'الموبايل' ? 'info' : 'gold', r[5])]) }), h('div', { class: 't-small help' }, 'عرض 1–' + rows.length + ' من ' + (1232 + rows.length).toLocaleString('en-US') + ' حدث')], null, { sub: 'المصدر: Event Log — نفس السجل اللي بتتبني عليه المزامنة والتقارير. الاحتفاظ: 24 شهر. يمكن التصدير CSV' }),
      K.Section('إعدادات السجل', [row('تسجيل عمليات العرض للبيانات الحساسة', 'مين شاف رقم هاتف عميل أو حساب بنكي لمبتكر أو مرتب عضو — مهم للامتثال', C.actSet.sensitiveViews, (v) => { C.actSet.sensitiveViews = v; }), row('تنبيه عند تغيير صلاحيات أو أدوار', 'يروح للأدمن فورًا (واتساب + إيميل)', C.actSet.permAlert, (v) => { C.actSet.permAlert = v; }), row('إرسال نسخة يومية من السجل بالإيميل', 'ملف CSV للأدمن الساعة 23:00', C.actSet.dailyCopy, (v) => { C.actSet.dailyCopy = v; })])];
  }

  // ---------- الأمان ----------
  function security() {
    const s = C.security; const me = K.member(K.ME); let pw = { cur: '', p1: '', p2: '' }; let errs = {};
    const pwField = (id, k, label, help) => U.FieldShell({ id, label, required: true, error: errs[k], help }, (() => { const i = h('input', { id, type: 'password', autocomplete: k === 'cur' ? 'current-password' : 'new-password', 'aria-invalid': errs[k] ? 'true' : false }); i.addEventListener('input', () => { pw[k] = i.value; }); return h('div', { class: 'input' + (errs[k] ? ' err' : '') }, i); })());
    const pwBox = h('div', { class: 'grid3' }, pwField('sc-cur', 'cur', 'كلمة السر الحالية'), pwField('sc-p1', 'p1', 'كلمة السر الجديدة', '8 أحرف على الأقل، فيها حرف ورقم'), pwField('sc-p2', 'p2', 'تأكيد كلمة السر', 'أعد كتابة كلمة السر'));
    const change = Button({ type: 'primary', label: 'تغيير كلمة السر', onClick: () => { const e = O.validatePassword(pw.p1, pw.p2); if (!pw.cur) return K.toast('اكتب كلمة السر الحالية', 'error'); if (e) return K.toast(e, 'error'); LOGV('settings.password', me.name); K.toast('اتغيرت كلمة السر — الأجهزة التانية هتخرج', 'success'); R(); } });
    return [K.Section('حسابي', [pwBox, h('div', { class: 'acts-inline start' }, change), vrow('التحقق بخطوتين (2FA)', me.twofa ? 'كود عند كل دخول جديد — مفعّل منذ 3 سبتمبر 2026 · واتساب / إيميل / Authenticator + 10 أكواد احتياطية' : 'مش مفعّل — اختياري للكل', h('div', { class: 'acts-inline' }, me.twofa ? Button({ size: 'sm', label: 'عرض رموز الاسترداد', onClick: () => K.toast('افتح ملفي › الحساب والأمان') }) : null, Button({ type: me.twofa ? 'text' : 'primary', size: 'sm', label: me.twofa ? 'إلغاء التفعيل' : 'تفعيل', onClick: () => { location.hash = 'profile-security'; } })))], null, { sub: 'إعدادات شخصية للعضو الحالي — ' + me.name + ' (' + me.role + ')' }),
      K.Section('الجلسات النشطة', U.Table({ headers: ['الجهاز', 'الموقع', 'آخر نشاط', 'الحالة', ''], rows: C.sessions.map((r, i) => [r[0], r[1], r[2], K.Tag(i === 0 ? 'brand' : 'success', r[3]), i === 0 ? '—' : Button({ type: 'text', size: 'sm', label: 'خروج', onClick: () => { C.sessions.splice(i, 1); K.toast('اتعمل خروج من ' + r[0]); R(); } })]) }), [Button({ label: 'تسجيل الخروج من كل الأجهزة الأخرى', onClick: () => window.IBShell.signOutAll() })], { sub: 'كل الأجهزة اللي داخلة بحسابك — سجّل الخروج من أي جهاز مش بتاعك' }),
      K.Section('سياسات الشركة (أدمن)', [row('إلزام التحقق بخطوتين لكل الأعضاء', 'مقفول = اختياري للكل (قرار 21 أكتوبر) · لو اتفعّل العضو بيتطلب منه التفعيل في أول دخول', s.force2fa, (v) => { s.force2fa = v; }), row('قفل الحساب بعد 5 محاولات غلط', 'لمدة 15 دقيقة + إشعار للأدمن', true, () => K.toast('القاعدة دي ثابتة')), row('انتهاء الجلسة بعد عدم النشاط', '8 ساعات من غير نشاط · تحذير قبلها بدقيقة', s.idle, (v) => { s.idle = v; }), row('إخفاء بيانات العملاء الحساسة افتراضيًا', 'الهاتف والعنوان مقنّعة في القوائم — تظهر بالضغط ويُسجَّل العرض', s.maskCustomers, (v) => { s.maskCustomers = v; }), row('منع التصدير لغير الأدمن والحسابات', 'CSV / PDF فقط للأدوار المسموح لها في المصفوفة', s.blockExport, (v) => { s.blockExport = v; }), row('السماح بالدخول من IP محددة فقط', 'قائمة عناوين المكتب — مناسب لاحقًا', s.ipOnly, (v) => { s.ipOnly = v; }),
        h('div', { class: 'grid3' }, pick(s, 'pwMin', 'sp-pw', 'الحد الأدنى لكلمة السر', ['8 أحرف + رقم', '8 أحرف + رقم + رمز']), pick(s, 'idleDesktop', 'sp-id', 'انتهاء الجلسة (ديسكتوب)', ['4 ساعات', '8 ساعات (تحذير قبلها بدقيقة)', '12 ساعة']), pick(s, 'idleMobile', 'sp-im', 'انتهاء الجلسة (موبايل)', ['1 يوم', '7 أيام', '30 يوم'])),
        vrow('تجربة: تحذير انتهاء الجلسة', 'يعرض التحذير اللي بيظهر قبل الخروج التلقائي بدقيقة', Button({ size: 'sm', label: 'اعرض التحذير', onClick: () => window.IBShell.sessionWarning() }))], null, { sub: 'بتُطبَّق على كل الأعضاء' })];
  }

  // ---------- البيانات ----------
  function data() {
    const b = C.backup;
    return [exportSec(), ...importSec(),
      K.Section('النسخ الاحتياطي والاحتفاظ', [row('نسخة احتياطية يومية تلقائية', 'الساعة 03:00 · آخر نسخة: اليوم 03:00 (نجحت) · الاحتفاظ 30 نسخة', b.daily, (v) => { b.daily = v; }), row('نسخة أسبوعية إلى Google Drive', 'مجلد Ibtekr-Backups — يحتاج ربط Google Drive من الربط بالمنصات', b.drive, (v) => { b.drive = v; }),
        h('div', { class: 'grid3' }, pick(b, 'inactive', 'd-in', 'حذف بيانات العملاء غير النشطين', ['لا — يدوي فقط', 'عميل بدون أوردر لمدة 24 شهر']), pick(b, 'orders', 'd-or', 'الاحتفاظ بالأوردرات المغلقة', ['بلا حد (أرشفة بعد 12 شهر)', '5 سنين']), pick(b, 'log', 'd-lg', 'الاحتفاظ بسجل النشاط', ['12 شهر', '24 شهر'])), h('div', { class: 'acts-inline start' }, Button({ size: 'sm', label: 'عرض النسخ السابقة', onClick: () => K.toast('30 نسخة محفوظة') }), Button({ type: 'primary', size: 'sm', label: 'إنشاء نسخة الآن', onClick: () => K.toast('اتعملت نسخة احتياطية', 'success') }))]),
      fullExportSec()];
  }


  // ---------- owner 22 Oct: export with options + import wizard ----------
  const LIST_KEYS = { 'حالات التأكيد': 'confirm', 'حالات الأوردر الفرعي': 'sub', 'أسباب المرتجع': 'returns', 'أنواع المصروفات': 'expenses', 'فئات المنتجات': 'categories', 'أسباب الإيقاف': 'stop', 'الأولويات': 'priorities' };
  function listsMap() { const o = {}; Object.keys(LIST_KEYS).forEach((n) => { if (C.otherLists[LIST_KEYS[n]]) o[n] = C.otherLists[LIST_KEYS[n]].slice(); }); o['أسباب الإلغاء'] = C.cancelReasons.map((r) => r[0]); return o; }
  function addListValue(name, v) { if (name === 'أسباب الإلغاء') C.cancelReasons.push([v, 'إلغاء', 0, true]); else if (LIST_KEYS[name]) C.otherLists[LIST_KEYS[name]].push(v); }
  function removeListValue(name, v) { if (name === 'أسباب الإلغاء') { const i = C.cancelReasons.findIndex((r) => r[0] === v); if (i >= 0) C.cancelReasons.splice(i, 1); } else if (LIST_KEYS[name]) { const a = C.otherLists[LIST_KEYS[name]]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); } }
  const XS = (C.xstate = C.xstate || { last: {}, sched: {}, imports: [] });
  const DX = () => window.IbtekrDataX; const DG = () => window.IBData;
  function exportSec() {
    const G = DG() ? DG().groups() : [];
    // تحديد جماعي (owner 31 Oct): تصدير كذا مجموعة مرة واحدة (ملف لكل مجموعة · من غير البيانات الحساسة)
    const XB = K.Bulk({ key: 'set-export', ids: G.map((g) => g.id), noun: 'مجموعة', render: R, actions: [
      { id: 'export', label: 'تصدير المحدد (من غير الحساس)', icon: 'download', run: (ids, done) => { const X = DX(); let n = 0; G.filter((g) => ids.includes(g.id)).forEach((g) => { try { const F = g.fields(); const cols = X.presetCols(F, 'safe'); const lab = cols.map((k) => (F.find((x) => x.key === k) || { label: k }).label); K.xlsxExport('ibtekr-' + g.id + '-' + K.TODAY + '.xlsx', g.label, [lab].concat(g.rows().map((r) => cols.map((k) => (r[k] == null ? '' : r[k]))))); XS.last[g.id] = K.TODAY; LOGV('data.export', g.id + ' (تحديد جماعي)'); n++; } catch (e) { /* skip */ } }); done('اتصدّر ' + n + ' ملف'); } }] });
    return K.Section('تصدير البيانات', [XB.bar(), U.Table({ headers: [XB.head(), 'المجموعة', 'السجلات', 'آخر تصدير', 'متكرر', ''], rows: G.map((g) => { let n = '—'; try { n = K.Num(g.rows().length); } catch (e) { /* not ready */ }
      return [XB.box(g.id, g.label), h('b', null, g.label), n, XS.last[g.id] || '—', XS.sched[g.id] ? K.Tag('brand', XS.sched[g.id]) : h('span', { class: 't-small help' }, '—'), Button({ size: 'sm', label: 'تصدير', icon: 'download', attrs: { 'data-export': g.id }, onClick: () => exportDialog(g) })]; }) })],
      null, { sub: 'كل مجموعة: تختار الفترة والفلتر والأعمدة والصيغة وتشوف معاينة قبل التصدير — CSV بترميز UTF-8 يفتح في Excel وGoogle Sheets · كل تصدير بيتسجل في سجل النشاط' });
  }
  // owner 22 Oct: a file download (CSV / Excel); the shared artifact link blocks downloads, so the copy box stays as the fallback
  const saveFile = (name, text, type) => { try { K.saveFile(name, new Blob([text], { type: type || 'text/csv;charset=utf-8' })); return true; } catch (e) { return false; } };
  const sheetPick = (opts, g, reopen) => (opts && opts.sheets && opts.sheets.length > 1 ? U.Select({ id: 'x-sheet', label: 'الشيت', options: opts.sheets.map((id) => DG().group(id)).filter(Boolean).map((x) => ({ value: x.id, label: x.label })), value: g.id, onChange: (v) => reopen(DG().group(v)) }) : null);
  function exportDialog(g, opts) {
    const X = DX(); const F = g.fields(); const all = g.rows(); const o = opts || {};
    const f = { range: null, from: '', to: '', filt: '', cols: X.presetCols(F, 'safe'), preset: 'safe', lang: 'ar', fmt: o.fmt || 'XLSX', repeat: XS.sched[g.id] || '' };
    const presets = [['safe', 'من غير البيانات الحساسة'], ['full', 'كل الأعمدة']].concat(g.presets && g.presets.accountant ? [['accountant', 'للمحاسب']] : []).concat(g.presets && g.presets.vendor ? [['vendor', 'للمبتكر']] : []).concat([['custom', 'مخصص']]);
    let out = null;
    const md = U.Modal({ title: 'تصدير — ' + g.label, body: [] }); md.el.classList.add('wide');
    const rowsNow = () => { let r = g.dateKey && (f.from || f.to) ? X.inRange(all, g.dateKey, { from: f.from, to: f.to }) : all.slice(); if (f.filt && g.filter) r = r.filter((x) => String(x[g.filter.key]) === f.filt); return r; };
    const fieldsNow = () => F.filter((x) => f.cols.includes(x.key));
    const draw = () => {
      const rows = rowsNow(); const cols = fieldsNow(); const sens = cols.filter((c) => c.sensitive);
      md.setBody(h('div', { class: 'dx-grid' }, sheetPick(o, g, (ng) => { md.close(); exportDialog(ng, Object.assign({}, o, { fmt: f.fmt })); }),
        g.dateKey ? K.two(U.DateField({ id: 'x-from', label: 'من تاريخ', value: f.from, today: K.TODAY, onChange: (v) => { f.from = v || ''; draw(); } }), U.DateField({ id: 'x-to', label: 'لحد تاريخ', value: f.to, today: K.TODAY, onChange: (v) => { f.to = v || ''; draw(); } })) : h('div', { class: 't-small help' }, 'المجموعة دي مالهاش تاريخ — بتتصدّر كاملة.'),
        g.filter ? U.Select({ id: 'x-filt', label: g.filter.label, options: [{ value: '', label: 'الكل' }].concat(g.filter.options().map((o) => ({ value: String(o), label: String(o) }))), value: f.filt, onChange: (v) => { f.filt = v; draw(); } }) : null,
        K.two(U.Select({ id: 'x-preset', label: 'الأعمدة', options: presets.map(([v, l]) => ({ value: v, label: l })), value: f.preset, onChange: (v) => { f.preset = v; if (v === 'safe' || v === 'full') f.cols = X.presetCols(F, v); else if (g.presets && g.presets[v]) f.cols = g.presets[v].slice(); draw(); } }),
          U.Select({ id: 'x-lang', label: 'عناوين الأعمدة', options: [{ value: 'ar', label: 'عربي' }, { value: 'en', label: 'English' }], value: f.lang, onChange: (v) => { f.lang = v; draw(); } })),
        h('div', { class: 'cb-group dx-cols', id: 'x-cols', role: 'group', 'aria-label': 'الأعمدة' }, F.map((c) => K.Checkbox({ label: c.label + (c.sensitive ? ' 🔒' : ''), checked: f.cols.includes(c.key), onChange: (v) => { f.cols = v ? F.filter((x) => x.key === c.key || f.cols.includes(x.key)).map((x) => x.key) : f.cols.filter((k) => k !== c.key); f.preset = 'custom'; draw(); } }))),
        sens.length ? U.InlineNote({ kind: 'warning', children: 'فيه بيانات حساسة (' + sens.map((c) => c.label).join('، ') + ') — بتظهر بس للي معاه صلاحية «بيانات حساسة»، والتصدير بيتسجل باسمك.' }) : null,
        K.two(U.Select({ id: 'x-fmt', label: 'الصيغة', options: FORMATS.map(([v, l]) => ({ value: v, label: l })), value: f.fmt, onChange: (v) => { f.fmt = v; out = null; draw(); } }),
          U.Select({ id: 'x-rep', label: 'تصدير متكرر', options: [{ value: '', label: 'مرة واحدة' }, { value: 'كل أسبوع (السبت) · إيميل', label: 'كل أسبوع (السبت) · إيميل' }, { value: 'كل شهر (يوم 1) · إيميل', label: 'كل شهر (يوم 1) · إيميل' }, { value: 'كل أسبوع · Google Drive', label: 'كل أسبوع · Google Drive' }], value: f.repeat, onChange: (v) => { f.repeat = v; draw(); } })),
        h('div', { class: 'dx-prev' }, h('b', { class: 't-label' }, 'معاينة — ' + rows.length + ' سجل · ' + cols.length + ' عمود'),
          cols.length && rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'vlo-table dt-table dx-table' }, h('thead', null, h('tr', null, cols.map((c) => h('th', null, f.lang === 'en' ? c.en : c.label)))), h('tbody', null, rows.slice(0, 5).map((r) => h('tr', null, cols.map((c) => h('td', null, String(r[c.key] == null ? '' : r[c.key])))))))) : K.Empty('مفيش حاجة تتصدّر', cols.length ? 'وسّع الفترة أو شيل الفلتر' : 'اختار عمود واحد على الأقل')),
        out ? h('div', { class: 'dx-out' }, h('b', { class: 't-label' }, out.fmt === 'TSV' ? 'جاهز للصق — اضغط «نسخ» والصقه في أول خانة في Google Sheets أو Excel' : 'الملف اتنزّل: ' + out.name), h('textarea', { class: 'input dx-text', readonly: '', rows: '6', dir: 'auto', 'aria-label': 'محتوى الملف' }, out.text), out.fmt === 'TSV' ? null : h('div', { class: 't-small help' }, 'لو الملف مانزلش (اللينك المشترك بيمنع التنزيل) — اضغط «تنزيل تاني» من الملف على جهازك، أو انسخ المحتوى والصقه في Google Sheets.')) : null));
      md.setFooter(Button({ type: 'text', label: 'إغلاق', onClick: () => md.close() }), out && out.fmt !== 'TSV' ? Button({ label: 'تنزيل تاني', icon: 'download', onClick: () => out.save() }) : null, out ? Button({ label: 'نسخ المحتوى', icon: 'copy', onClick: () => { const done = () => K.toast('اتنسخ', 'success'); try { navigator.clipboard.writeText(out.text).then(done, () => { const t = md.el.querySelector('.dx-text'); t.select(); K.toast('حدّد واعمل نسخ'); }); } catch (e) { md.el.querySelector('.dx-text').select(); } } }) : null,
        Button({ type: 'primary', label: 'تصدير ' + rows.length + ' سجل', disabled: !rows.length || !cols.length, attrs: { 'data-xgo': '' }, onClick: () => { const name = 'ibtekr-' + g.id + '-' + K.TODAY + (f.fmt === 'XLSX' ? '.xlsx' : f.fmt === 'TSV' ? '.tsv' : '.csv');
          const text = f.fmt === 'CSV' ? X.toCSV(rows, cols, { lang: f.lang }) : X.toTSV(rows, cols, { lang: f.lang });
          const save = f.fmt === 'XLSX' ? () => loadXLSX().then((XL) => { const wb = XL.utils.book_new(); const ws = XL.utils.aoa_to_sheet(X.toAOA(rows, cols, { lang: f.lang })); ws['!views'] = [{ RTL: true }]; XL.utils.book_append_sheet(wb, ws, g.label.slice(0, 31).replace(/[\\/?*\[\]:]/g, ' ')); XL.writeFile(wb, name); }).catch(() => K.toast('معرفناش نجهّز ملف Excel — صدّره CSV أو انسخ المحتوى')) : f.fmt === 'CSV' ? () => saveFile(name, text) : () => {};
          out = { text, name, fmt: f.fmt, save }; save(); if (f.fmt === 'TSV') { try { navigator.clipboard.writeText(text).then(() => K.toast('اتنسخ — الصقه في الشيت', 'success'), () => {}); } catch (e) { /* manual copy */ } } XS.last[g.id] = 'دلوقتي · ' + rows.length + ' سجل'; if (f.repeat) XS.sched[g.id] = f.repeat; else delete XS.sched[g.id]; LOGV('settings.export', g.label + ' · ' + rows.length + ' سجل · ' + cols.length + ' عمود' + (sens.length ? ' · فيه بيانات حساسة' : '')); draw(); R(); } }));
    };
    draw();
  }
  // owner 22 Oct: every sheet has its template, and every import says up front if it adds new data or edits what's already there
  const FORMATS = [['XLSX', 'Excel (‎.xlsx)'], ['CSV', 'CSV (Excel / Google Sheets)'], ['TSV', 'نسخ للصق في Google Sheets']];
  const MODES = { add: ['إضافة بيانات جديدة', 'الصفوف الجديدة بتتضاف · اللي موجود بالفعل بيتخطّى ومش بيتكرر'], update: ['تعديل بيانات موجودة', 'بنلاقي السجل بالمفتاح ونعدّل الخانات المكتوبة بس · الخانة الفاضية بتفضل زي ما هي'] };
  const modesOf = (g) => g.modes || ['add'];
  const keyLabel = (g) => { const ks = DX().keysOf(g.key); return ks.map((k) => (g.fields().find((x) => x.key === k) || {}).label).join(' + '); };
  const keyText = (g, d) => DX().keysOf(g.key).map((k) => (d[k] == null || d[k] === '' ? '—' : d[k])).join(' · ');
  function importSec() {
    const G = DG() ? DG().groups() : []; const imp = G.filter((g) => g.apply); const b = C.backup; if (!imp.some((g) => g.id === b.importSet)) b.importSet = imp[0] ? imp[0].id : '';
    const g = DG().group(b.importSet); if (!modesOf(g).includes(b.importMode)) b.importMode = modesOf(g)[0];
    const last = XS.imports.slice(-5).reverse(); const X = DX();
    const modeRadios = K.Radios({ label: 'نوع الاستيراد', name: 'imp-mode', value: b.importMode, onChange: (v) => { b.importMode = v; R(); }, options: ['add', 'update'].filter((m) => modesOf(g).includes(m)).map((m) => ({ value: m, label: MODES[m][0], hint: m === 'update' ? MODES[m][1] + ' · المفتاح: ' + keyLabel(g) : MODES[m][1] })) });
    const tplRows = imp.map((x) => { const F = x.fields(); return [h('b', null, x.label), modesOf(x).includes('add') ? U.num(String(X.templateCols(F, 'add', x.key).length)) : h('span', { class: 't-small help' }, 'تعديل بس'), modesOf(x).includes('update') ? h('span', null, U.num(String(X.templateCols(F, 'update', x.key).length)), h('small', { class: 't-small help' }, ' · المفتاح: ' + keyLabel(x))) : h('span', { class: 't-small help' }, 'إضافة بس'),
      h('div', { class: 'acts-inline' }, modesOf(x).includes('add') ? Button({ size: 'sm', label: 'قالب إضافة', attrs: { 'data-tpl': x.id + ':add' }, onClick: () => templateDialog(x, 'add') }) : null, modesOf(x).includes('update') ? Button({ size: 'sm', label: 'قالب تعديل', attrs: { 'data-tpl': x.id + ':update' }, onClick: () => templateDialog(x, 'update') }) : null)]; });
    return [K.Section('استيراد البيانات', [h('div', { class: 'grid3 dx-imp' }, h('div', null, U.Select({ id: 'd-set', label: 'الشيت', options: imp.map((x) => ({ value: x.id, label: x.label })), value: b.importSet, onChange: (v) => { b.importSet = v; R(); } }), h('div', { class: 't-small help' }, 'الأوردرات الجديدة بتيجي من الموقع / Airtable — هنا بتعدّل بياناتها بس')),
        modeRadios,
        h('div', { class: 'acts-inline start dx-acts' }, Button({ label: 'القالب', icon: 'download', onClick: () => templateDialog(g, b.importMode) }), Button({ type: 'primary', label: 'ابدأ الاستيراد', attrs: { 'data-import': '' }, onClick: () => importWizard(g, b.importMode) }))),
      g.id === 'expenses' ? U.InlineNote({ children: 'المصروفات مالهاش مفتاح ثابت، فالاستيراد إضافة بس — التعديل من صفحة الحسابات.' }) : null,
      g.note ? U.InlineNote({ kind: g.sensitive ? 'warning' : 'info', children: g.note }) : null,
      last.length ? h('div', null, h('b', { class: 't-label' }, 'آخر عمليات الاستيراد'), U.Table({ cls: 'mini-table', headers: ['الوقت', 'الشيت', 'النوع', 'النتيجة', 'بواسطة', ''], rows: last.map((x) => [x.at, x.label, x.mode ? MODES[x.mode][0] : '—', x.undone ? K.Tag('neutral', 'اتلغى') : h('span', null, x.created + ' جديد · ' + x.updated + ' اتعدّل' + (x.skipped ? ' · ' + x.skipped + ' اتخطّى' : '') + (x.errors ? ' · ' + x.errors + ' أخطاء' : '')), x.by,
        x.undone ? h('span', { class: 't-small help' }, '—') : Button({ type: 'text', size: 'sm', label: 'تراجع', onClick: () => K.confirm({ title: 'تراجع عن الاستيراد', text: 'هيتمسح اللي اتضاف (' + x.created + ') ويرجع اللي اتعدّل (' + x.updated + ') زي ما كان.', okLabel: 'تراجع', onOk: () => { x.undo(); x.undone = true; LOGV('settings.import.undo', x.label); K.toast('اتلغى الاستيراد', 'success'); R(); } }) })]) })) : null],
      null, { sub: 'اختار الشيت ونوع الاستيراد ← حمّل القالب واملاه ← ارفع الملف أو الصق من Google Sheets ← راجع ← أكّد. مفيش حاجة بتتكتب قبل ما توافق، وتقدر تتراجع بعدها' }),
      K.Section('قوالب الشيتات', [U.Table({ cls: 'mini-table dx-tpls', headers: ['الشيت', 'أعمدة الإضافة', 'أعمدة التعديل', ''], rows: tplRows }), note('كل قالب فيه كل الأعمدة اللي السيستم محتاجها بنفس الأسماء (عربي أو English) + صف مثال. الأعمدة المطلوبة عليها *. اللصق في Google Sheets بيحط كل عمود في خانة.')], null, { sub: 'قالب لكل شيت — واحد للإضافة وواحد للتعديل' })];
  }
  function templateDialog(g, mode, opts) {
    if (!modesOf(g).includes(mode)) mode = modesOf(g)[0]; const X = DX(); const F = g.fields(); const cols = X.templateCols(F, mode, g.key); const st3 = { lang: 'ar' };
    const ex = g.rows()[0] || {}; const example = cols.map((c) => { const v = ex[c.key]; const f = F.find((x) => x.key === c.key); return v == null || v === '' ? '' : f.type === 'date' ? String(v).split('-').reverse().join('/') : String(v); });
    const head = () => cols.map((c) => (st3.lang === 'en' ? c.en : c.label) + (c.required ? ' *' : ''));
    const tsv = () => [head().join('\t'), example.join('\t')].join('\n'); const csv = () => X.toCSV([Object.fromEntries(cols.map((c, i) => [c.key, example[i]]))], cols.map((c) => Object.assign({}, c, { label: c.label + (c.required ? ' *' : ''), en: c.en + (c.required ? ' *' : '') })), { lang: st3.lang });
    const copy = (t, msg) => { try { navigator.clipboard.writeText(t).then(() => K.toast(msg, 'success'), () => K.toast('حدّد النص وانسخه بإيدك')); } catch (e) { K.toast('حدّد النص وانسخه بإيدك'); } };
    const md = U.Modal({ title: 'قالب ' + MODES[mode][0] + ' — ' + g.label, body: [] }); md.el.classList.add('wide'); md.el.dataset.template = g.id + ':' + mode;
    const draw = () => md.setBody(sheetPick(opts, g, (ng) => { md.close(); templateDialog(ng, mode, opts); }), modesOf(g).length > 1 ? K.Radios({ label: 'القالب', name: 'tpl-mode', value: mode, onChange: (v) => { md.close(); templateDialog(g, v, opts); }, options: modesOf(g).map((m) => ({ value: m, label: MODES[m][0] })) }) : null, U.InlineNote({ children: MODES[mode][1] + (mode === 'update' ? ' · المفتاح: ' + keyLabel(g) : '') }),
      K.Radios({ label: 'أسماء الأعمدة', name: 'tpl-lang', value: st3.lang, onChange: (v) => { st3.lang = v; draw(); }, options: [{ value: 'ar', label: 'عربي' }, { value: 'en', label: 'English' }] }),
      U.Table({ cls: 'mini-table dx-cols', headers: ['العمود', 'مطلوب', 'الشكل / القيم المسموحة', 'مثال'], rows: cols.map((c, i) => [h('b', null, st3.lang === 'en' ? c.en : c.label), c.required ? K.Tag('error', 'مطلوب') : h('span', { class: 't-small help' }, mode === 'update' ? 'سيبه فاضي لو مش هتغيّره' : 'اختياري'), h('span', { class: 't-small' }, c.hint), h('span', { class: 't-small' }, example[i] || '—')]) }),
      mode === 'update' && F.some((x) => x.noUpdate) ? h('div', { class: 't-small help' }, 'مش في قالب التعديل: ' + F.filter((x) => x.noUpdate).map((x) => x.label).join('، ') + ' — بيتغيّر من الملف نفسه (بتاريخ سريان)') : null,
      h('textarea', { class: 'input dx-text', readonly: '', rows: '4', dir: 'auto', 'aria-label': 'القالب' }, tsv()));
    draw();
    md.setFooter(Button({ type: 'text', label: 'إغلاق', onClick: () => md.close() }), Button({ label: 'نسخ CSV', onClick: () => copy(csv(), 'اتنسخ القالب CSV') }), Button({ type: 'primary', label: 'نسخ للصق في Google Sheets', attrs: { 'data-copy-sheet': '' }, onClick: () => copy(tsv(), 'اتنسخ — الصقه في أول خانة في الشيت') }));
  }
  // Excel files are read with SheetJS (cdnjs) only when someone picks one
  const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.appendChild(sc); }));
  function importWizard(g, mode0, opts) {
    const X = DX(); const st2 = { step: 1, mode: modesOf(g).includes(mode0) ? mode0 : modesOf(g)[0], text: '', name: '', parsed: null, map: {}, res: null, applied: null, err: '', sheets: null, wb: null };
    const F = () => { const all = g.fields(); return X.templateCols(all, st2.mode, g.key).map((c) => Object.assign({}, all.find((x) => x.key === c.key), { required: c.required })); };
    const md = U.Modal({ title: 'استيراد — ' + g.label, body: [] }); md.el.classList.add('wide');
    const steps = ['الملف', 'ربط الأعمدة', 'المراجعة', 'النتيجة'];
    const multi = Array.isArray(g.key);
    const current = (k) => g.rows().find((r) => (multi ? X.keyOf(r, g.key) === X.keyOf(k, g.key) : X.norm(r[g.key]) === X.norm(k)));
    // each sheet can add its own checks (vendor exists, balance enough, valid for the reason …) — shown in the review before anything is saved
    const runValidate = () => { st2.res = X.validate(st2.parsed.rows, st2.map, F(), { key: g.key, existing: g.existing ? g.existing() : [], mode: st2.mode, current });
      if (g.check) st2.res.forEach((r) => { if (r.status === 'error') return; const c = g.check(r.data, st2.mode) || {}; if (c.errors && c.errors.length) { r.errors = r.errors.concat(c.errors); r.status = 'error'; } }); };
    const load = (text, name) => { const p = X.parseCSV(text); if (!p.headers.length || !p.rows.length) { st2.err = 'الملف فاضي أو مافيهوش صفوف تحت العناوين'; draw(); return; } p.headers = p.headers.map((x) => x.replace(/\s*\*$/, '')); st2.text = text; st2.name = name; st2.parsed = p; st2.map = X.autoMap(p.headers, F()); st2.err = ''; st2.step = 2; draw(); };
    const readExcel = (fl) => { st2.err = ''; loadXLSX().then((XL) => fl.arrayBuffer().then((buf) => { const wb = XL.read(buf, { type: 'array' }); st2.wb = wb; st2.sheets = wb.SheetNames; const name = wb.SheetNames.find((n) => X.norm(n) === X.norm(g.label)) || wb.SheetNames[0];
      if (wb.SheetNames.length > 1) { st2.pickName = name; st2.fileName = fl.name; draw(); return; } load(XL.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t' }), fl.name + ' › ' + name); })).catch(() => { st2.err = 'معرفناش نقرا ملف Excel هنا — احفظه CSV، أو حدّد الخلايا في الشيت وانسخها والصقها تحت'; draw(); }); };
    const sampleText = () => { const s = g.rows().slice(0, 2).map((r) => Object.assign({}, r)); const cols = F();
      if (st2.mode === 'update') { if (g.id === 'vendors') return X.toCSV([{ name: s[0].name, status: 'غير نشط' }, { name: s[1].name, leadDays: '14' }, { name: 'مبتكر مش موجود', status: 'نشط' }], cols, { lang: 'ar' }); if (g.id === 'team') { const m = s[0]; return X.toCSV([{ email: m.email, title: 'مدير العمليات' }, { email: 'nobody@ibtekr.club', dept: 'المخزن' }], cols, { lang: 'ar' }); } }
      if (g.id === 'vendors') { s.push({ name: 'ورشة نور', category: 'ديكور منزلى', status: 'نشط', phone: '01012345678', rate: '٣٥', leadDays: '10' }); s.push({ name: '', category: 'هدايا', status: 'نشط', phone: '0101', rate: '40', leadDays: '12' }); }
      if (g.id === 'expenses') s.push({ date: '22/10/2026', amount: '1,250', category: 'الإعلانات', direction: 'سحب', beneficiary: 'Meta' }, { date: '32/10/2026', amount: 'ألف', category: 'اعلانات', direction: 'سحب' });
      if (g.id === 'team') s.push({ name: 'ليلى حسن', email: 'laila@ibtekr.club', role: 'خدمة العملاء', title: 'خدمة العملاء', dept: 'خدمة العملاء' });
      if (g.id === 'lists') s.push({ list: 'أسباب الإلغاء', value: 'العميل طلب منتج تاني' }, { list: 'أسباب الإيقاف', value: 'تأخير متكرر' });
      return X.toCSV(s, cols, { lang: 'ar' }); };
    const tagOf = (r) => (r.status === 'error' ? ['error', 'خطأ'] : r.status === 'exists' ? ['neutral', 'موجود — هيتخطّى'] : r.status === 'same' ? ['neutral', 'مفيش تغيير'] : r.status === 'update' ? ['gold', 'هيتعدّل'] : ['success', 'جديد']);
    const draw = () => {
      const head = h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i + 1 === st2.step ? 'on' : i + 1 < st2.step ? 'done' : '' }, s)));
      const modeLine = h('div', { class: 'dx-mode' }, K.Tag(st2.mode === 'update' ? 'gold' : 'success', MODES[st2.mode][0]), h('span', { class: 't-small help' }, MODES[st2.mode][1] + (st2.mode === 'update' ? ' · المفتاح: ' + keyLabel(g) : '')));
      let body = null, foot = [Button({ type: 'text', label: st2.step === 4 ? 'إغلاق' : 'إلغاء', onClick: () => md.close() })];
      if (st2.step === 1) {
        body = [sheetPick(opts, g, (ng) => { md.close(); importWizard(ng, st2.mode, opts); }), modesOf(g).length > 1 ? K.Radios({ label: 'نوع الاستيراد', name: 'wz-mode', value: st2.mode, onChange: (v) => { st2.mode = v; draw(); }, options: modesOf(g).map((m) => ({ value: m, label: MODES[m][0], hint: MODES[m][1] })) }) : modeLine,
          h('div', { class: 'dx-tplline t-small' }, 'محتاج القالب؟ ', Button({ type: 'text', size: 'sm', label: 'قالب ' + MODES[st2.mode][0], onClick: () => templateDialog(g, st2.mode, opts) })),
          h('label', { class: 'upload drop', for: 'imp-f2' }, Icon('attach', 'sm'), h('span', null, h('b', null, 'ارفع الشيت — Excel أو CSV'), h('small', { class: 't-small help' }, ' · ‎.xlsx · ‎.csv · الحد 10 ميجا · لو فيه أكتر من تاب هتختار التاب')), h('input', { type: 'file', id: 'imp-f2', class: 'sr-file', accept: '.csv,.tsv,.txt,.xlsx,.xls,text/csv', onChange: (e) => { const fl = e.target.files[0]; if (!fl) return; if (fl.size > 10 * 1024 * 1024) { st2.err = 'الملف أكبر من 10 ميجا'; draw(); return; } if (/\.xlsx?$/i.test(fl.name)) { readExcel(fl); return; } const rd = new FileReader(); rd.onload = () => load(String(rd.result), fl.name); rd.readAsText(fl, 'utf-8'); } })),
          st2.sheets && st2.sheets.length > 1 ? h('div', { class: 'dx-sheetpick' }, U.Select({ id: 'imp-sheet', label: 'التاب في ' + st2.fileName, options: st2.sheets.map((n) => ({ value: n, label: n })), value: st2.pickName, onChange: (v) => { st2.pickName = v; draw(); } }), Button({ size: 'sm', label: 'افتح التاب', onClick: () => load(window.XLSX.utils.sheet_to_csv(st2.wb.Sheets[st2.pickName], { FS: '\t' }), st2.fileName + ' › ' + st2.pickName) })) : null,
          h('div', { class: 't-small help' }, 'أو من Google Sheets: حدّد الخلايا مع العناوين ← Ctrl+C ← الصق هنا:'), h('textarea', { class: 'input', id: 'imp-paste', rows: '5', dir: 'auto', placeholder: 'الصق الخلايا هنا (العناوين في أول صف)' }),
          st2.err ? h('div', { class: 'err-msg', role: 'alert' }, st2.err) : null];
        foot.push(Button({ label: 'جرّب بملف مثال', onClick: () => load(sampleText(), 'مثال.csv') }), Button({ type: 'primary', label: 'التالي', onClick: () => { const t = (md.el.querySelector('#imp-paste') || {}).value || ''; if (!t.trim()) { st2.err = 'ارفع ملف أو الصق الخلايا'; draw(); return; } load(t, 'لصق من الشيت'); } }));
      } else if (st2.step === 2) {
        const P = st2.parsed; const FF = F(); const used = Object.values(st2.map).filter(Boolean); const missing = FF.filter((x) => x.required && !used.includes(x.key)); const extra = P.headers.filter((hd, i) => !st2.map[i]);
        body = [modeLine, h('div', { class: 't-small help' }, st2.name + ' · ' + P.rows.length + ' صف · ' + P.headers.length + ' عمود — السيستم ربط اللي يقدر عليه، راجع الباقي'),
          h('div', { class: 'scroll-x' }, h('table', { class: 'vlo-table dt-table dx-map' }, h('thead', null, h('tr', null, h('th', null, 'عمود الشيت'), h('th', null, 'مثال'), h('th', null, 'الحقل في السيستم'))),
            h('tbody', null, P.headers.map((hd, i) => h('tr', null, h('td', null, h('b', null, hd)), h('td', { class: 't-small' }, String(P.rows[0][i] || '').slice(0, 30)), h('td', null, U.Select({ id: 'map-' + i, label: '', options: [{ value: '', label: '— تجاهل العمود —' }].concat(FF.map((x) => ({ value: x.key, label: x.label + (x.required ? ' *' : '') }))), value: st2.map[i] || '', onChange: (v) => { Object.keys(st2.map).forEach((k) => { if (v && st2.map[k] === v) st2.map[k] = ''; }); st2.map[i] = v; draw(); } }))))))),
          missing.length ? U.InlineNote({ kind: 'warning', children: 'حقول مطلوبة مش مربوطة: ' + missing.map((x) => x.label).join('، ') + (st2.mode === 'update' ? ' — التعديل محتاج المفتاح عشان يلاقي السجل' : '') }) : null,
          extra.length && st2.mode === 'update' ? h('div', { class: 't-small help' }, 'الأعمدة المتجاهلة مش هتتغيّر') : null];
        foot.push(Button({ label: 'رجوع', onClick: () => { st2.step = 1; draw(); } }), Button({ type: 'primary', label: 'التالي: المراجعة', disabled: !!missing.length, onClick: () => { runValidate(); st2.step = 3; draw(); } }));
      } else if (st2.step === 3) {
        const sm = X.summary(st2.res, st2.mode); const shown = st2.res.slice(0, 50); const up = st2.mode === 'update';
        const chips = up ? [['هيتعدّل', sm.update], ['مفيش تغيير', sm.skip], ['فيه أخطاء (مش هيدخل)', sm.error]] : [['جديد', sm.create], ['موجود بالفعل (هيتخطّى)', sm.skip], ['فيه أخطاء (مش هيدخل)', sm.error]];
        body = [modeLine, h('div', { class: 'dt-sum' }, chips.map(([l, v]) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, l), h('b', null, String(v))))),
          h('div', { class: 'scroll-x' }, h('table', { class: 'vlo-table dt-table dx-rev' }, h('thead', null, h('tr', null, h('th', null, 'صف'), h('th', null, 'الحالة'), h('th', null, g.key ? keyLabel(g) : 'البيانات'), h('th', null, up ? 'التغيير' : 'الملاحظات'))),
            h('tbody', null, shown.map((r) => { const t = tagOf(r); return h('tr', { class: r.status === 'error' ? 'dx-err' : '' }, h('td', null, String(r.row)), h('td', null, K.Tag(t[0], t[1])),
              h('td', null, String(g.key ? keyText(g, r.data) : Object.values(r.data).slice(0, 3).join(' · '))),
              h('td', null, r.errors.length ? h('div', { class: 'dx-errs' }, r.errors.map((e) => h('div', null, e)), r.suggest ? Object.keys(r.suggest).map((k) => Button({ type: 'text', size: 'sm', label: 'صحّحها لـ «' + r.suggest[k] + '»', onClick: () => { const ci = Object.keys(st2.map).find((c) => st2.map[c] === k); st2.parsed.rows[r.row - 1][ci] = r.suggest[k]; runValidate(); draw(); } })) : null)
                : r.changes && r.changes.length ? h('div', { class: 'dx-chg' }, r.changes.map((c) => h('div', { class: 't-small' }, h('b', null, c.label + ': '), String(c.from) + ' ← ' + String(c.to))))
                : h('span', { class: 't-small help' }, r.note || '—'))); })))),
          st2.res.length > 50 ? h('div', { class: 't-small help' }, 'معروض أول 50 صف من ' + st2.res.length) : null];
        const go = up ? sm.update : sm.create;
        foot.push(Button({ label: 'رجوع', onClick: () => { st2.step = 2; draw(); } }), Button({ type: 'primary', label: (up ? 'تعديل ' : 'إضافة ') + go + ' سجل', disabled: !go, attrs: { 'data-imp-go': '' }, onClick: () => {
          const okRows = st2.res.filter((r) => r.status === (up ? 'update' : 'new')); let out;
          try { out = g.apply(okRows, up ? 'تحديث السجل الموجود' : 'تخطّي'); } catch (e) { st2.err = 'حصل خطأ أثناء الحفظ: ' + e.message; draw(); return; }
          const rec = { at: K.TODAY + ' ' + (K.NOW_MIN != null ? K.hm(K.NOW_MIN) : ''), label: g.label, mode: st2.mode, created: out.done.created.length, updated: out.done.updated.length, skipped: sm.skip, errors: sm.error, by: K.member(K.ME).name, undo: out.undo, undone: false };
          XS.imports.push(rec); st2.applied = rec; LOGV('settings.import', g.label + ' · ' + MODES[st2.mode][0] + ' · ' + rec.created + ' جديد · ' + rec.updated + ' اتعدّل · ' + sm.skip + ' اتخطّى · ' + sm.error + ' أخطاء'); st2.step = 4; draw(); R(); document.dispatchEvent(new Event('ib:notify')); } }));
      } else {
        const a = st2.applied;
        body = [U.InlineNote({ kind: 'success', children: (a.mode === 'update' ? 'اتعدّل ' + a.updated + ' سجل' : 'اتضاف ' + a.created + ' سجل جديد') + (a.skipped ? ' · ' + a.skipped + ' اتخطّى' : '') + (a.errors ? ' · ' + a.errors + ' صف فيه أخطاء ماتدخلش' : '') + '.' }), h('div', { class: 't-small help' }, 'تقدر تتراجع دلوقتي أو بعدين من «آخر عمليات الاستيراد».')];
        foot.push(a.undone ? null : Button({ label: 'تراجع', onClick: () => { a.undo(); a.undone = true; LOGV('settings.import.undo', a.label); K.toast('اتلغى الاستيراد', 'success'); md.close(); R(); } }));
      }
      md.setBody(head, ...[].concat(body).filter(Boolean)); md.setFooter(...foot.filter(Boolean));
    };
    draw();
  }

  // ---------- popups ----------
  function invite() { K.form({ title: 'دعوة عضو', values: { role: liveNames().includes('مشاهد') ? 'مشاهد' : liveNames()[1] }, fields: (f, e, set) => [K.field.text('name', 'الاسم', f, e, set, { required: true }), K.field.text('email', 'الإيميل', f, e, set, { required: true, placeholder: 'name@ibtekr.club' }), K.field.select('role', 'الدور', liveNames().filter((r) => r !== 'أدمن').map((r) => ({ value: r, label: r + (roleDesc(r) ? ' — ' + roleDesc(r) : '') })), f, e, set, { required: true, help: 'ابدأ بأقل صلاحية (مشاهد) — تقدر تغيرها بعدين' }), note('الدعوة صالحة 7 أيام — العضو بيعمل كلمة المرور من اللينك.')], validate: (f) => { const e = K.req(f, ['name', 'email', 'role']); if (f.email && O.identifierKind(f.email) !== 'email') e.email = 'اكتب إيميل صحيح'; else if (S.members.some((m) => m.email === f.email)) e.email = 'الإيميل ده موجود بالفعل'; return e; }, submitLabel: 'إرسال الدعوة', submit: (f) => { S.members.push({ id: 'M' + String(S.members.length + 1).padStart(2, '0'), name: f.name, role: f.role, title: f.role, dept: 'العمليات', manager: 'M01', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'], leave: 21, used: 0, hire: K.TODAY, phone: '', email: f.email, status: 'invited', twofa: false, contract: 'missing', monthMin: 0, otMonth: 0, lastLogin: '—', invitedAt: 'دلوقتي' }); LOGV('settings.invite', f.email + ' · ' + f.role); K.toast('اتبعتت الدعوة لـ ' + f.email, 'success'); R(); } }); }
  function cancelInvite(m) { K.confirm({ title: 'إلغاء الدعوة', text: 'اللينك اللي اتبعت لـ ' + m.email + ' هيبطل.', okType: 'danger', okLabel: 'إلغاء الدعوة', onOk: () => { S.members.splice(S.members.indexOf(m), 1); LOGV('settings.invite.cancel', m.email); R(); } }); }
  function customPerms(m) { const all = C.perms.flatMap(([g, rows]) => rows.map(([n]) => [g, n])); K.form({ title: 'صلاحيات مخصصة — ' + m.name, values: {}, note: U.InlineNote({ children: 'الدور الحالي: ' + m.role + '. التجاوز بيتطبق على العضو ده بس.' }), fields: (f, e, set) => all.map(([g, n], i) => U.Select({ id: 'cp-' + i, label: g + ' › ' + n, options: [{ value: '', label: 'حسب الدور' }, { value: 'allow', label: 'سماح' }, { value: 'deny', label: 'منع' }], value: f['p' + i] || '', onChange: (v) => set('p' + i, v, true) })), submitLabel: 'حفظ', submit: (f) => { m.override = Object.values(f).filter(Boolean).length || null; LOGV('settings.member.override', m.name + ' · ' + (m.override || 0) + ' تجاوز'); K.toast('اتحفظت صلاحيات ' + m.name, 'success'); R(); } }); }
  function customRole() { const NR = window.IbtekrNotifRoles; K.form({ title: 'دور مخصص', values: { base: liveNames().includes('مشاهد') ? 'مشاهد' : liveNames()[1] }, fields: (f, e, set) => [K.field.text('name', 'اسم الدور', f, e, set, { required: true }), K.field.text('desc', 'الوصف', f, e, set, { help: 'بيظهر عند الدعوة' }), K.field.select('base', 'ابدأ من صلاحيات وتنبيهات', liveNames().slice(1), f, e, set, { help: 'بينسخ صلاحيات الدور وتنبيهاته — تقدر تعدّلهم بعدين من الدور نفسه' })], validate: (f) => { const e = K.req(f, ['name']); if (allNames().includes(String(f.name).trim())) e.name = 'الاسم ده موجود'; return e; }, submitLabel: 'إنشاء الدور', submit: (f) => { const bi = allNames().indexOf(f.base); C.custom = (C.custom || []).concat(f.name.trim()); const ni = allNames().length - 1; C.perms.forEach(([, rows]) => rows.forEach((r) => { r[1] = r[1].padEnd(ni, 'N').slice(0, ni) + (r[1][bi] || 'N'); })); if (NR) Object.assign(K.store.alertRoles, NR.matrixCopyCol(K.store.alertRoles, bi, ni)); C.roleInfo = Object.assign(C.roleInfo || {}, { [f.name.trim()]: (f.desc || '').trim() }); LOGV('settings.role.create', f.name); K.toast('اتعمل دور ' + f.name, 'success'); R(); document.dispatchEvent(new Event('ib:notify')); } }); }
  // owner 22 Oct: click a role → one popup with its data, permissions, alerts and permanent delete
  const PLV = [{ value: 'F', label: 'مسموح' }, { value: 'P', label: 'عرض بس' }, { value: 'N', label: 'غير مسموح' }];
  function rolePopup(name, ci) {
    const NR = window.IbtekrNotifRoles; const isAdmin = ci === 0; const custom = ci >= ROLES.length; const at = (K.store.roleDigestAt = K.store.roleDigestAt || {});
    const members = () => S.members.filter((m) => m.role === name);
    const pk = (g, n) => g + '›' + n;
    const v0 = { tab: 'info', name, desc: roleDesc(name), digest: K.store.roleDigests[name] !== false, at: at[name] || O.NOTIF_DEFAULT_AT, p: {}, a: {} };
    C.perms.forEach(([g, rows]) => rows.forEach(([n, v]) => { v0.p[pk(g, n)] = isAdmin ? 'F' : (v[ci] || 'N'); }));
    if (NR) NR.SOURCES.forEach((src) => { v0.a[src.key] = ((K.store.alertRoles[src.key] || NR.DEFAULTS[src.key])[ci]) || 'N'; });
    // draft perms in the matrix shape so the alert gate follows unsaved permission edits
    const draftPerms = (f) => C.perms.map(([g, rows]) => [g, rows.map(([n, v]) => [n, NR.colSet(v, ci, f.p[pk(g, n)])])]);
    const tabs = (f, set) => K.SubTabs({ label: 'إعدادات الدور', active: f.tab, onChange: (id) => set('tab', id, true), items: [{ id: 'info', label: 'البيانات' }, { id: 'perms', label: 'الصلاحيات' }, { id: 'alerts', label: 'التنبيهات' }] });
    const info = (f, e, set) => [K.field.text('name', 'اسم الدور', f, e, set, { required: true, disabled: !custom, help: custom ? 'بيتغيّر عند كل الأعضاء اللي عندهم الدور' : 'اسم الدور الجاهز ثابت — تقدر تغيّر الوصف والصلاحيات والتنبيهات' }),
      K.field.area('desc', 'الوصف', f, e, set, { help: 'بيظهر جنب الدور في الدعوة واختيار الدور' }),
      h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'الأعضاء على الدور ده (' + members().length + ')'), members().length ? h('div', { class: 'rp-members' }, members().map((m) => h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', { class: 't-small help' }, m.status === 'invited' ? 'دعوة معلّقة' : m.status === 'suspended' ? 'موقوف' : 'نشط'))))) : h('div', { class: 't-small help' }, 'مفيش أعضاء على الدور ده لسه'))];
    const perms = (f, e, set) => [isAdmin ? U.InlineNote({ children: 'الأدمن عنده كل الصلاحيات ومينفعش تتقفل — عشان محدش يقفل السيستم على نفسه.' }) : note('«عرض بس» = يشوف من غير تعديل. الصلاحيات الحساسة عليها علامة ⚠ وتغييرها بيطلب تأكيد ويتسجل في سجل النشاط.'),
      h('div', { class: 'rp-list' }, C.perms.map(([g, rows]) => h('div', { class: 'rp-group' }, h('b', { class: 't-label' }, g), rows.map(([n, , sens]) => h('div', { class: 'ma-row' + (sens ? ' sens' : '') }, h('span', null, sens ? Icon('alert', 'sm') : null, n), U.Select({ id: 'rp-p-' + g.replace(/\s/g, '') + '-' + n.replace(/\s/g, ''), label: '', disabled: isAdmin, options: PLV, value: f.p[pk(g, n)], onChange: (v) => { f.p[pk(g, n)] = v; set('tab', 'perms', true); } }))))))];
    const alerts = (f, e, set) => { if (!NR) return []; const dp = draftPerms(f); const groups = [...new Set(NR.SOURCES.map((x) => x.section))]; const rec = NR.SOURCES.filter((x) => NR.canSee(dp, x, ci) && f.a[x.key] === 'R').length;
      return [note('«يستلم» = في الجرس ويتحسب في الرقم ويوصله على القنوات · «يشوف بس» = باهت «للعلم» · «لا» = مايظهرش. التنبيه اللي بياناته مقفولة في الصلاحيات بيبان «مالوش صلاحية».'),
        h('div', { class: 'rp-list' }, groups.map((g) => h('div', { class: 'rp-group' }, h('b', { class: 't-label' }, g), NR.SOURCES.filter((x) => x.section === g).map((src) => h('div', { class: 'ma-row' }, h('span', null, src.label), NR.canSee(dp, src, ci) ? U.Select({ id: 'rp-a-' + src.key.replace('.', '-'), label: '', options: [{ value: 'R', label: 'يستلم' }, { value: 'S', label: 'يشوف بس' }].concat(isAdmin ? [] : [{ value: 'N', label: 'لا' }]), value: isAdmin && f.a[src.key] === 'N' ? 'S' : f.a[src.key], onChange: (v) => { f.a[src.key] = v; set('tab', 'alerts', true); } }) : h('span', { class: 't-small help' }, '— مالوش صلاحية')))))),
        h('div', { class: 'rd-block' }, K.Switch({ id: 'rp-dg', label: 'الملخص اليومي للدور', help: 'بيجمع الـ ' + rec + ' تنبيهات اللي الدور بيستلمها في رسالة واحدة', checked: f.digest, onChange: (v) => set('digest', v, true) }), f.digest ? K.field.select('at', 'ساعة الإرسال', O.NOTIF_TIMES, f, e, set) : null)]; };
    const changedSens = (f) => C.perms.flatMap(([g, rows]) => rows.filter(([n, v, sens]) => sens && (v[ci] || 'N') !== f.p[pk(g, n)]).map(([n]) => n));
    const apply = (f, m) => {
      const nm = String(f.name).trim(); let changes = 0;
      if (custom && nm !== name) { C.custom[C.custom.indexOf(name)] = nm; S.members.forEach((x) => { if (x.role === name) x.role = nm; }); if (name in K.store.roleDigests) { K.store.roleDigests[nm] = K.store.roleDigests[name]; delete K.store.roleDigests[name]; } delete at[name]; if (C.roleInfo) delete C.roleInfo[name]; changes++; }
      C.roleInfo = Object.assign(C.roleInfo || {}, { [nm]: String(f.desc || '').trim() });
      if (!isAdmin) C.perms.forEach(([g, rows]) => rows.forEach((r) => { const c = f.p[pk(g, r[0])]; if ((r[1][ci] || 'N') !== c) { r[1] = NR.colSet(r[1], ci, c); changes++; } }));
      if (NR) NR.SOURCES.forEach((src) => { const cur = (K.store.alertRoles[src.key] || NR.DEFAULTS[src.key]); if ((cur[ci] || 'N') !== f.a[src.key]) { K.store.alertRoles[src.key] = NR.colSet(cur, ci, f.a[src.key]); changes++; } });
      K.store.roleDigests[nm] = !!f.digest; at[nm] = f.at;
      LOGV('settings.role.update', nm + ': ' + changes + ' تغيير'); K.toast('اتحفظت إعدادات دور ' + nm, 'success'); m.close(); R(); document.dispatchEvent(new Event('ib:notify'));
    };
    K.form({ title: 'إعدادات الدور — ' + name, wide: true, values: v0,
      note: (f) => h('div', { class: 'rp-head' }, K.Tag(isAdmin ? 'brand' : custom ? 'gold' : 'info', isAdmin ? 'دور النظام' : custom ? 'دور مخصص' : 'دور جاهز'), h('span', { class: 't-small help' }, members().length + ' أعضاء · ' + Object.values(f.p).filter((c) => c === 'F').length + ' صلاحية كاملة')),
      fields: (f, e, set) => [tabs(f, set)].concat(f.tab === 'info' ? info(f, e, set) : f.tab === 'perms' ? perms(f, e, set) : alerts(f, e, set)),
      extraFooter: isAdmin ? null : (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'danger', label: 'حذف الدور', onClick: () => deleteRole(name, ci, m) })),
      validate: (f) => { const e = K.req(f, ['name']); const nm = String(f.name || '').trim(); if (custom && nm !== name && allNames().includes(nm)) e.name = 'الاسم ده موجود'; if (Object.keys(e).length) f.tab = 'info'; return e; },
      submitLabel: 'حفظ', submit: (f, m) => { const sens = changedSens(f); if (sens.length && !isAdmin) { K.confirm({ title: 'تغيير صلاحية حساسة', text: '«' + sens.join('، ') + '» لدور «' + name + '». التغيير هيتسجل في سجل النشاط ويتبعت تنبيه للأدمن.', okLabel: 'تأكيد التغيير', onOk: () => apply(f, m) }); return false; } apply(f, m); return false; } });
  }
  function deleteRole(name, ci, parent) {
    const NR = window.IbtekrNotifRoles; const custom = ci >= ROLES.length; const mem = S.members.filter((m) => m.role === name); const others = liveNames().filter((r) => r !== name);
    const def = others.includes('مشاهد') ? 'مشاهد' : others[1] || others[0]; const v0 = { mode: 'all', to: def, ok: false }; mem.forEach((m) => { v0['to-' + m.id] = ''; });
    K.form({ title: 'حذف دور «' + name + '»', values: v0, submitType: 'danger', submitLabel: 'حذف نهائي', wide: mem.length ? true : false,
      note: U.InlineNote({ kind: 'warning', children: 'الحذف نهائي ومينفعش يترجع: الدور هيختفي من مصفوفة الصلاحيات والتنبيهات والدعوات والملخص اليومي.' + (mem.length ? ' عليه ' + mem.length + ' أعضاء — اختار يروحوا فين قبل الحذف.' : '') }),
      fields: (f, e, set) => [mem.length ? K.Radios({ label: 'الأعضاء على الدور ده (' + mem.length + ') يروحوا فين؟', name: 'mode', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'all', label: 'انقل الكل لدور واحد' }, { value: 'each', label: 'اختار دور لكل عضو' }] }) : null,
        mem.length && f.mode === 'all' ? h('div', { class: 'rp-move' }, K.field.select('to', 'الدور الجديد للكل', others, f, e, set, { required: true }), h('div', { class: 'rp-members' }, mem.map((m) => h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', { class: 't-small help' }, m.role + ' ← ' + (f.to || '—'))))))) : null,
        mem.length && f.mode === 'each' ? h('div', { class: 'ma-list rp-each' }, mem.map((m) => h('div', { class: 'ma-row' }, h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', { class: 't-small help', dir: 'ltr' }, m.email))), U.Select({ id: 'to-' + m.id, label: '', placeholder: 'اختار الدور', options: others.map((r) => ({ value: r, label: r })), value: f['to-' + m.id], error: e['to-' + m.id], onChange: (v) => set('to-' + m.id, v, true) })))) : null,
        h('div', { class: 'field' + (e.ok ? ' has-err' : '') }, K.Checkbox({ label: 'فاهم إن حذف الدور نهائي', checked: f.ok, onChange: (v) => set('ok', v, true) }), e.ok ? h('div', { class: 'err-msg t-small', role: 'alert' }, e.ok) : null)],
      validate: (f) => { const e = {}; if (mem.length && f.mode === 'all' && !f.to) e.to = 'اختار الدور'; if (mem.length && f.mode === 'each') mem.forEach((m) => { if (!f['to-' + m.id]) e['to-' + m.id] = 'اختار دور لـ ' + m.name; }); if (!f.ok) e.ok = 'علّم على التأكيد عشان تحذف'; return e; },
      submit: (f) => {
        const dest = (m) => (f.mode === 'each' ? f['to-' + m.id] : f.to); mem.forEach((m) => { m.role = dest(m); }); const at = K.store.roleDigestAt || {};
        if (custom) { const P = NR.permsDropCol(C.perms, ci); C.perms.splice(0, C.perms.length, ...P); const A = NR.matrixDropCol(K.store.alertRoles, ci); Object.keys(K.store.alertRoles).forEach((k) => delete K.store.alertRoles[k]); Object.assign(K.store.alertRoles, A); C.custom.splice(C.custom.indexOf(name), 1); }
        else C.removed = (C.removed || []).concat(name);
        delete K.store.roleDigests[name]; delete at[name]; if (C.roleInfo) delete C.roleInfo[name];
        const moved = mem.map((m) => m.name + ' ← ' + m.role).join('، '); LOGV('settings.role.delete', name + (mem.length ? ' — ' + moved : '')); K.toast('اتحذف دور ' + name + (mem.length ? ' — ' + (f.mode === 'all' ? 'الأعضاء اتنقلوا لـ ' + f.to : 'كل عضو اتنقل لدوره الجديد') : ''), 'success');
        if (parent) parent.close(); R(); document.dispatchEvent(new Event('ib:notify'));
      } });
  }
  function suspend(m) { if (m.status === 'suspended') { m.status = 'active'; LOGV('settings.member.reactivate', m.name); K.toast('اتفعّل ' + m.name); return R(); } K.form({ title: 'إيقاف عضو — ' + m.name, values: {}, note: U.InlineNote({ kind: 'warning', children: 'الإيقاف بيقفل الدخول فورًا ويعمل خروج من كل الأجهزة. سجل نشاطه بيفضل. الحذف النهائي ممكن بعد 30 يوم.' }), fields: (f, e, set) => [K.field.area('reason', 'السبب', f, e, set, { required: true })], validate: (f) => K.req(f, ['reason']), submitType: 'danger', submitLabel: 'إيقاف', submit: (f) => { m.status = 'suspended'; m.lastLogin = 'موقوف'; LOGV('settings.member.suspend', m.name + ' — ' + f.reason); K.toast('اتوقف ' + m.name); R(); } }); }
  // ربط أداة مش في القايمة (owner 28 Oct) — بتتضاف لنفس التاب
  function addIntegration(kind) {
    const LABEL = { site: 'منصة أو خدمة', social: 'حساب تواصل', ads: 'حساب إعلانات', ai: 'أداة ذكاء اصطناعي' };
    K.form({ title: 'ربط ' + (LABEL[kind] || 'أداة') + ' جديدة', values: { name: '', conn: 'API', key: '', desc: '' },
      note: U.InlineNote({ children: 'المفتاح بيتحفظ مشفّر ومابيظهرش تاني — تقدر تستبدله في أي وقت من كارت الأداة.' }),
      fields: (f, e, set) => [K.field.text('name', 'اسم الأداة', f, e, set, { required: true, maxlength: 60, placeholder: 'مثلاً: Runway' }),
        K.Radios({ label: 'طريقة الربط', name: 'integ-conn', value: f.conn, required: true,
          options: [{ value: 'API', label: 'API Key', hint: 'مفتاح من حساب الأداة' }, { value: 'MCP', label: 'MCP', hint: 'سيرفر MCP — الأداة بتشتغل جوه السيستم' }, { value: 'OAuth', label: 'OAuth', hint: 'تسجيل دخول بحساب الأداة' }],
          onChange: (v) => set('conn', v, true) }),
        K.field.text('key', f.conn === 'MCP' ? 'لينك سيرفر MCP' : f.conn === 'OAuth' ? 'الحساب' : 'مفتاح API', f, e, set, { required: true }),
        U.Textarea({ id: 'integ-desc', label: 'بتستعمله في إيه؟', value: f.desc, rows: 2, placeholder: 'اختياري — يظهر تحت اسم الأداة', onInput: (v) => set('desc', v) })],
      validate: (f) => K.req(f, ['name', 'key']),
      submitLabel: 'ربط واختبار', submit: (f) => {
        C.integrations.push({ kind, conn: f.conn, id: 'x-' + Date.now().toString(36), name: f.name.trim(), short: f.name.trim(), letter: f.name.trim().charAt(0).toUpperCase(), status: 'متصل', desc: f.desc || '—', last: 'اتربطت دلوقتي', dir: 'الاتجاه: إرسال طلب + استلام الناتج' });
        LOGV('settings.integration.add', f.name + ' · ' + f.conn); K.toast('اتربطت ' + f.name, 'success'); R(); } });
  }
  function connect(p) { K.form({ title: 'ربط ' + p.name, values: {}, fields: (f, e, set) => [K.field.text('key', 'مفتاح API / التوكن', f, e, set, { required: true })], validate: (f) => K.req(f, ['key']), submitLabel: 'ربط واختبار', submit: () => { p.status = 'متصل'; p.last = 'آخر مزامنة: دلوقتي'; LOGV('settings.integration.connect', p.name); K.toast('اتربط ' + p.name, 'success'); R(); } }); }
  function wooWizard() {
    let step = 1; const f = { url: 'https://ibtekr.club', key: '', secret: '', direction: 'ثنائي الاتجاه', conflict: 'آخر تعديل يكسب' }; let err = {};
    const md = U.Modal({ title: 'ربط WooCommerce', body: [] });
    const draw = () => { const steps = ['الموقع', 'المفاتيح', 'الاتجاه', 'مراجعة'];
      md.setBody(h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '' }, s))),
        step === 1 ? U.TextInput({ id: 'w-url2', label: 'رابط المتجر', value: f.url, error: err.url, onInput: (v) => { f.url = v; } }) : null,
        step === 2 ? [U.TextInput({ id: 'w-key2', label: 'Consumer key', value: f.key, error: err.key, placeholder: 'ck_…', onInput: (v) => { f.key = v; } }), U.TextInput({ id: 'w-sec2', label: 'Consumer secret', value: f.secret, error: err.secret, placeholder: 'cs_…', onInput: (v) => { f.secret = v; } }), note('من WooCommerce › الإعدادات › متقدم › REST API — صلاحية قراءة/كتابة.')] : null,
        step === 3 ? [U.Select({ id: 'w-dir2', label: 'اتجاه المزامنة', options: ['ثنائي الاتجاه', 'من WooCommerce فقط', 'من السيستم فقط'].map((x) => ({ value: x, label: x })), value: f.direction, onChange: (v) => { f.direction = v; draw(); } }), U.Select({ id: 'w-con2', label: 'عند التعارض', options: ['آخر تعديل يكسب', 'السيستم دايمًا يكسب', 'المنصة دايمًا تكسب', 'إيقاف وطلب مراجعة يدوية'].map((x) => ({ value: x, label: x })), value: f.conflict, onChange: (v) => { f.conflict = v; draw(); } })] : null,
        step === 4 ? [K.Kv([['الموقع', f.url], ['المفتاح', f.key.slice(0, 6) + '…'], ['الاتجاه', f.direction], ['التعارض', f.conflict]]), U.InlineNote({ kind: 'success', children: 'الاتصال اتجرب ونجح · 120ms — الأوردرات والمنتجات جاهزة للمزامنة.' })] : null);
      md.setFooter(step > 1 ? Button({ label: 'رجوع', onClick: () => { step--; err = {}; draw(); } }) : Button({ label: 'إلغاء', onClick: () => md.close() }), Button({ type: 'primary', label: step === 4 ? 'ربط وابدأ المزامنة' : 'التالي', onClick: () => {
        err = {}; if (step === 1 && !/^https:\/\/.+\..+/.test(f.url)) err.url = 'اكتب الرابط كامل بـ https://'; if (step === 2) { if (!/^ck_/.test(f.key)) err.key = 'المفتاح بيبدأ بـ ck_'; if (!/^cs_/.test(f.secret)) err.secret = 'السر بيبدأ بـ cs_'; }
        if (Object.keys(err).length) return draw(); if (step < 4) { step++; return draw(); } const p = C.integrations[0]; p.status = 'متصل'; p.last = 'آخر مزامنة: دلوقتي'; LOGV('settings.integration.connect', 'WooCommerce'); md.close(); K.toast('اتربط WooCommerce', 'success'); R(); } })); };
    draw();
  }
  function disconnect(p) { K.form({ title: 'فصل ' + p.name, values: {}, note: U.InlineNote({ kind: 'warning', children: 'الفصل بيوقف المزامنة فورًا ويحتفظ بكل البيانات المستوردة. إعادة الربط بتعيد المزامنة من آخر نقطة.' }), fields: (f, e, set) => [K.field.text('confirm', 'اكتب «فصل» للتأكيد', f, e, set, { required: true })], validate: (f) => (String(f.confirm || '').trim() === 'فصل' ? {} : { confirm: 'اكتب «فصل» بالظبط' }), submitType: 'danger', submitLabel: 'فصل المنصة', submit: () => { p.status = 'غير متصل'; p.last = 'اتفصل دلوقتي'; st.integ = null; LOGV('settings.integration.disconnect', p.name); K.toast('اتفصل ' + p.name); R(); } }); }
  function delayRule(r) { K.form({ title: r ? 'تعديل قاعدة ' + r[0] : 'قاعدة تأخير خاصة', values: { maker: r ? r[0] : '', lead: r ? r[1].replace(' يوم', '') : '12 – 15', risk: r ? r[2].replace('يوم ', '') : '9', late: r ? r[3].replace('يوم ', '') : '11' }, fields: (f, e, set) => [K.field.select('maker', 'المبتكر', ['Lusso Furniture', 'Antikiano', 'Art Craft', 'rufaida_store', 'HANDS_Crafts', 'zaan', 'W&R'], f, e, set, { required: true }), K.field.text('lead', 'مدة التصنيع', f, e, set, { required: true, suffix: 'يوم' }), K.two(K.field.text('risk', 'قابل للتأخير من يوم', f, e, set, { required: true, inputmode: 'numeric' }), K.field.text('late', 'متأخر بعد يوم', f, e, set, { required: true, inputmode: 'numeric' }))], validate: (f) => { const e = K.req(f, ['maker', 'lead', 'risk', 'late']); if (!e.late && Number(f.late) <= Number(f.risk)) e.late = 'لازم أكبر من «قابل للتأخير»'; return e; }, submitLabel: 'حفظ القاعدة', submit: (f) => { const nr = [f.maker, f.lead + ' يوم', 'يوم ' + f.risk, 'يوم ' + f.late, 'مدخل يدويًا', r ? r[5] : '—']; if (r) r.splice(0, 6, ...nr); else C.makerRules.push(nr); LOGV('settings.makers.rule', f.maker); K.toast('اتحفظت قاعدة ' + f.maker, 'success'); R(); } }); }
  function deactivateMaker() { K.form({ title: 'إيقاف تنشيط مبتكر', values: { effect: C.makers.siteEffect }, fields: (f, e, set) => [K.field.select('maker', 'المبتكر', ['Antikiano', 'Art Craft', 'rufaida_store', 'HANDS_Crafts', 'zaan', 'W&R'], f, e, set, { required: true }), K.field.select('reason', 'السبب', C.otherLists.stop, f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, K.field.select('effect', 'أثر الإيقاف على الموقع', ['إخفاء منتجاته + منع أوردرات جديدة', 'منع أوردرات جديدة فقط', 'لا شيء (داخلي)'], f, e, set)], validate: (f) => { const e = K.req(f, ['maker', 'reason']); if (f.reason === 'أخرى' && !String(f.other || '').trim()) e.other = 'اكتب السبب'; return e; }, submitType: 'danger', submitLabel: 'إيقاف التنشيط', submit: (f) => { LOGV('settings.maker.deactivate', f.maker + ' — ' + f.reason); K.toast('اتوقف ' + f.maker); } }); }
  function escalation(idx) {
    const cur = idx == null ? null : C.escalations[idx];
    const T = O.escalationTargets(ROLES, K.team()); const extra = (cur ? cur.to : []).filter((v) => !T.some((t) => t.value === v)).map((v) => ({ value: v, label: v, kind: 'role' }));
    const opts = T.concat(extra); const types = [...new Set(C.notif.flatMap(([, r]) => r.map((x) => x[0])).concat(cur ? [cur.type] : []))];
    K.form({ title: cur ? 'تعديل قاعدة تصعيد' : 'قاعدة تصعيد جديدة', wide: true, values: cur ? { type: cur.type, after: cur.after, to: cur.to.slice(), ch: O.splitChannels(cur.ch) } : { type: '', after: '24 ساعة', to: [], ch: ['داخل السيستم'] },
      validate: (f) => O.validateEscalation(f, C.escalations, cur ? idx : undefined),
      fields: (f, e, set) => {
        const tog = (k, v) => (on) => set(k, on ? f[k].concat(v) : f[k].filter((x) => x !== v), true);
        const group = (id, label, body, help) => h('div', { class: 'field' + (e[id] ? ' has-err' : '') }, h('span', { class: 'flabel', id: id + '-l' }, label, h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), body, e[id] ? h('div', { class: 'err-msg', role: 'alert' }, e[id]) : h('div', { class: 'help' }, help));
        const sec = (title, kinds) => h('div', { class: 'dg-sec' }, h('b', { class: 't-label' }, title), h('div', { class: 'cb-group' }, opts.filter((o) => kinds.includes(o.kind)).map((o) => K.Checkbox({ label: o.label, checked: f.to.includes(o.value), onChange: tog('to', o.value) }))));
        return [K.two(K.field.select('type', 'التنبيه', types, f, e, set, { required: true, placeholder: 'اختار التنبيه' }), K.field.select('after', 'يتصعّد بعد', [...new Set(O.ESC_AFTER.concat(cur ? [cur.after] : []))], f, e, set, { help: 'من غير ما حد ياخد إجراء على التنبيه' })),
          group('to', 'يتصعّد إلى', h('div', { class: 'dg-src', id: 'to', role: 'group', 'aria-labelledby': 'to-l' }, sec('الأدوار', ['manager', 'role']), sec('الأشخاص', ['person'])), f.to.length ? 'هيوصل لـ: ' + f.to.join(' + ') : 'اختار شخص أو دور أو أكتر — الدور = كل أعضائه. المدير المباشر = مدير صاحب التنبيه في الفريق (من ملفه)'),
          group('ch', 'القناة', h('div', { class: 'cb-group', id: 'ch', role: 'group', 'aria-labelledby': 'ch-l' }, O.ESC_CHANNELS.map((c) => K.Checkbox({ label: c, checked: f.ch.includes(c), onChange: tog('ch', c) }))), 'واتساب وإيميل بيروحوا على رقم وإيميل كل شخص في ملفه — وبيتأجلوا لبعد ساعات الهدوء')];
      },
      submitLabel: cur ? 'حفظ' : 'إضافة القاعدة',
      submit: (f) => { const v = { type: f.type, after: f.after, to: f.to.slice(), ch: O.joinChannels(f.ch) }; if (cur) Object.assign(cur, v); else C.escalations.push(Object.assign(v, { on: true })); LOGV(cur ? 'settings.escalation.edit' : 'settings.escalation.add', v.type + ' · ' + v.after + ' ← ' + v.to.join(' + ')); K.toast(cur ? 'اتحفظت القاعدة' : 'اتضافت القاعدة', 'success'); R(); } });
  }
  // owner 22 Oct: pick days of the month (1–28 + آخر يوم)
  const daysGroup = (f, e, set, id = 'days') => h('div', { class: 'field' + (e[id] ? ' has-err' : '') }, h('span', { class: 'flabel', id: id + '-l' }, 'أيام الإرسال من الشهر', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    h('div', { class: 'cb-group days', id, role: 'group', 'aria-labelledby': id + '-l' }, O.MONTH_DAYS.map((d) => K.Checkbox({ label: d === 'last' ? 'آخر يوم في الشهر' : String(d), checked: (f[id] || []).includes(d), onChange: (v) => set(id, v ? (f[id] || []).concat(d) : (f[id] || []).filter((x) => x !== d), true) }))),
    e[id] ? h('div', { class: 'err-msg', role: 'alert' }, e[id]) : h('div', { class: 'help' }, (f[id] || []).length ? 'بيتبعت ' + O.monthDaysLabel(f[id]) + ' — أيام 29 و30 و31 مش موجودة في كل الشهور، استخدم «آخر يوم في الشهر»' : 'اختار يوم أو أكتر'));
  function editNotif(r0, g0) { const isNew = !r0; const r = r0 || ['', '3 أيام', 'داخل السيستم', '', true, 'مرة واحدة', 'كل 24 ساعة', O.NOTIF_DEFAULT_AT, null, 'الأحد', 'custom']; const named = isNew || r[10] === 'custom'; const names = C.notif.flatMap(([, rr]) => rr.map((x) => x[0])); K.form({ title: isNew ? 'تنبيه جديد' : 'تعديل نوع تنبيه', validate: (f) => Object.assign(named ? O.validateNotifType(f, names, isNew ? undefined : r[0]) : (f.to.length ? {} : { to: 'اختار قسم واحد على الأقل' }), f.re === 'أيام محددة من الشهر' && !f.days.length ? { days: 'اختار يوم واحد على الأقل' } : {}), values: { dur: r[1], ch: r[2], to: O.splitRecipients(r[3]), rc: r[5] || 'مرة واحدة', re: r[6] || 'كل 24 ساعة', at: r[7] || O.NOTIF_DEFAULT_AT, days: (r[8] || [16, 'last']).slice(), wd: r[9] || 'الأحد', name: r[0], grp: g0 || C.notif[0][0] }, note: named ? null : h('b', null, r[0]), fields: (f, e, set) => [named ? K.two(K.field.text('name', 'اسم التنبيه', f, e, set, { required: true, placeholder: 'مثلًا: أوردر مرتجع محتاج فحص' }), K.field.select('grp', 'القسم', C.notif.map(([x]) => x), f, e, set, { help: 'نفس أقسام لوحة الإشعارات' })) : null, K.field.select('dur', 'مدة الظهور', ['1 يوم', '2 يوم', '3 أيام', '7 أيام', '30 يوم', 'حتى الإغلاق', 'حتى الحل', r[1]].filter((v, i, a) => a.indexOf(v) === i), f, e, set), K.two(K.field.select('rc', 'عدد مرات التنبيه', O.NOTIF_COUNTS.slice(), f, e, set), K.field.select('re', 'مرة كل', O.NOTIF_EVERY.slice(), f, e, set, { help: f.re === 'أسبوعيًا' ? 'بيتبعت كل ' + f.wd + ' الساعة ' + f.at : f.re === 'أيام محددة من الشهر' ? 'بيتبعت ' + (f.days.length ? O.monthDaysLabel(f.days) : '…') + ' الساعة ' + f.at : O.isDaily(f.re) ? (f.rc === 'مرة واحدة' ? 'بيتبعت مرة واحدة الساعة ' + f.at : 'بيتبعت كل يوم الساعة ' + f.at + (f.rc === 'لحد ما يتحل' ? ' لحد ما يتحل' : ' — ' + f.rc)) : f.rc === 'مرة واحدة' ? 'بيتبعت مرة واحدة أول ما الحالة تحصل' : 'أول تنبيه فورًا · ' + O.notifSchedule(f.rc, f.re).map((x) => x ? 'بعد ' + x + ' س' : 'فورًا').slice(1, 4).join(' · ') + (f.rc === 'لحد ما يتحل' ? ' … لحد ما يتحل' : '') })), f.re === 'أيام محددة من الشهر' ? daysGroup(f, e, set) : null, f.re === 'أسبوعيًا' ? K.field.select('wd', 'يوم الإرسال', O.WEEKDAYS.slice(), f, e, set, { help: /^التقرير الأسبوعي للمبتكر/.test(r[0]) ? 'المكتملة = الأسبوع اللي خلص قبل يوم الإرسال · المتأخرة وقيد التنفيذ = المفتوح وقت الإرسال' : 'كل أسبوع في اليوم ده' }) : null, O.isDaily(f.re) ? K.field.select('at', 'وقت الإرسال', O.NOTIF_TIMES.slice(), f, e, set, { help: 'افتراضي 12:00 ص (نص الليل). داخل السيستم بيظهر في ميعاده؛ واتساب والإيميل لو الميعاد جوه ساعات الهدوء بيتأجّلوا لآخرها.' }) : null, K.field.select('ch', 'القنوات', ['داخل السيستم', 'داخل السيستم + إيميل', 'داخل السيستم + واتساب', 'داخل السيستم + واتساب + إيميل', 'إيميل', r[2]].filter((v, i, a) => a.indexOf(v) === i), f, e, set), h('div', { class: 'field' + (e.to ? ' has-err' : '') }, h('span', { class: 'flabel', id: 'to-l' }, 'المستلم', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), h('div', { class: 'cb-group', role: 'group', 'aria-labelledby': 'to-l', id: 'to' }, [...new Set(O.NOTIF_TEAMS.concat(O.splitRecipients(r[3])))].map((t) => K.Checkbox({ label: t, checked: f.to.includes(t), onChange: (v) => set('to', v ? f.to.concat(t) : f.to.filter((x) => x !== t), true) }))), e.to ? h('div', { class: 'err-msg', role: 'alert' }, e.to) : h('div', { class: 'help' }, f.to.includes(O.VENDOR_RECIPIENT) ? 'المبتكر بيستلم التنبيه على واتساب بس، على رقمه المسجّل في ملفه — والأقسام التانية على «القنوات» المختارة' : 'تقدر تختار أكتر من قسم — التنبيه بيوصل لكل الأقسام المختارة')), K.field.area('tpl', 'قالب الرسالة', f, e, set, { placeholder: 'أوردر {رقم} محتاج متابعة من {المسؤول}' })], submitLabel: isNew ? 'إضافة التنبيه' : 'حفظ', submit: (f) => { if (named) r[0] = f.name.trim(); r[1] = f.dur; r[2] = f.ch; r[3] = O.joinRecipients(f.to); r[5] = f.rc; r[6] = f.re; r[7] = f.at; r[8] = f.days.slice(); r[9] = f.re === 'أسبوعيًا' ? f.wd : r[9]; if (/^التقرير الأسبوعي للمبتكر/.test(r[0]) && f.re === 'أسبوعيًا') K.store.vendorWeekly = { weekday: f.wd, at: f.at }; if (/^كشف حساب المبتكرين/.test(r[0])) Object.assign(K.store.accAlerts, f.re === 'أيام محددة من الشهر' ? { cycle: 'monthDays', days: f.days.slice() } : { cycle: 'biweekly' }); if (named && f.grp !== g0) { if (!isNew) { const old = C.notif.find(([x]) => x === g0)[1]; old.splice(old.indexOf(r), 1); } C.notif.find(([x]) => x === f.grp)[1].push(r); st.nopen[f.grp] = true; } LOGV(isNew ? 'settings.notif.add' : 'settings.notif.edit', f.grp + ' › ' + r[0]); K.toast(isNew ? 'اتضاف التنبيه' : 'اتحفظ', 'success'); R(); } }); }
  function statusForm(kind, i) { const s = i != null ? C.orderStatuses[i] : null; K.form({ title: s ? 'تعديل «' + s[0] + '»' : 'حالة أوردر جديدة', values: { name: s ? s[0] : '', tone: s ? s[1] : 'gold', woo: s ? s[2] : '', type: s ? s[4] : 'مفتوح' }, fields: (f, e, set) => [K.field.text('name', 'الاسم في السيستم', f, e, set, { required: true }), K.field.select('tone', 'لون الحالة', [['success', 'أخضر — تم'], ['brand', 'أخضر غامق'], ['info', 'أزرق'], ['gold', 'ذهبي — جاري'], ['orange', 'برتقالي — تنبيه'], ['error', 'أحمر — مشكلة'], ['neutral', 'رمادي']].map(([v, l]) => ({ value: v, label: l })), f, e, set), K.two(K.field.text('woo', 'مقابل WooCommerce', f, e, set, { required: true, placeholder: 'custom-status' }), K.field.select('type', 'النوع', ['مفتوح', 'مغلق'], f, e, set)), f.name ? h('div', null, 'المعاينة: ', K.Tag(f.tone, f.name)) : null], validate: (f) => { const e = K.req(f, ['name', 'woo']); if (!s && C.orderStatuses.some((x) => x[0] === String(f.name).trim())) e.name = 'موجودة بالفعل'; return e; }, submitLabel: 'حفظ', submit: (f) => { if (s) { s[0] = f.name; s[1] = f.tone; if (s[3] === 'نعم') { s[2] = f.woo; s[4] = f.type; } } else C.orderStatuses.splice(4, 0, [f.name.trim(), f.tone, f.woo, 'نعم', f.type]); LOGV('settings.list.status', f.name); R(); } }); }
  function simpleAdd(title, add) { K.form({ title, values: {}, fields: (f, e, set) => [K.field.text('v', 'الاسم', f, e, set, { required: true })], validate: (f) => K.req(f, ['v']), submitLabel: 'إضافة', submit: (f) => { add(f.v.trim()); LOGV('settings.list.add', f.v); R(); } }); }
  function addAccount(a) { K.form({ title: a ? 'تعديل حساب' : 'إضافة حساب', values: a ? { name: a.name, kind: a.kind, ident: a.ident, link: a.link } : { kind: 'بنك', link: 'يدوي' }, fields: (f, e, set) => [K.field.text('name', 'اسم الحساب', f, e, set, { required: true }), K.two(K.field.select('kind', 'النوع', ['بنك', 'محفظة', 'بوابة دفع', 'شركة شحن', 'نقدي'], f, e, set), K.field.select('link', 'الربط', ['يدوي', 'غير مربوط'], f, e, set)), K.field.text('ident', 'الرقم / المعرّف', f, e, set, { help: 'بنحفظ آخر 4 أرقام بس للحسابات البنكية' })], validate: (f) => K.req(f, ['name']), submitLabel: 'حفظ', submit: (f) => { const ident = f.kind === 'بنك' && /\d{4}$/.test(O.toLatin(f.ident || '')) ? 'EG•••• •••• ' + O.toLatin(f.ident).slice(-4) : f.ident || '—'; if (a) Object.assign(a, { name: f.name, kind: f.kind, link: f.link, ident }); else C.accounts.push({ name: f.name, kind: f.kind, ident, link: f.link, on: true }); LOGV('settings.account', f.name); R(); } }); }
  // phase 12 T4 (decision 4 / 11): «تصدير نسخة كاملة من البيانات» replaces the v6's demo «حذف بيانات الشركة» — one Excel workbook, a sheet per
  // group of «تصدير البيانات» (the safe columns: nothing marked sensitive), from the data the admin's own session reads (RLS applies).
  // Nothing is deleted from here, ever: a stopped member, a trashed product or a cancelled order each has its own page and rule.
  function fullExportSec() {
    const G = DG() ? DG().groups() : [];
    const run = () => K.confirm({ title: 'تصدير نسخة كاملة من البيانات؟', text: 'ملف Excel واحد فيه شيت لكل مجموعة (' + G.length + ' مجموعة) من غير البيانات الحساسة (أرقام التليفونات والحسابات البنكية). التصدير بيتسجل في سجل النشاط باسمك.', okLabel: 'صدّر الملف',
      onOk: () => loadXLSX().then((XL) => {
        const X = DX(); const wb = XL.utils.book_new(); const done = [];
        for (const g of G) { let rows = []; try { rows = g.rows(); } catch (e) { continue; } const F = g.fields(); const cols = X.presetCols(F, 'safe'); const lab = cols.map((k) => (F.find((x) => x.key === k) || { label: k }).label);
          const ws = XL.utils.aoa_to_sheet([lab].concat(rows.map((r) => cols.map((k) => (r[k] == null ? '' : r[k]))))); ws['!views'] = [{ RTL: true }]; XL.utils.book_append_sheet(wb, ws, g.label.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')); done.push(g.id + ':' + rows.length); }
        if (!done.length) { K.toast('مفيش بيانات محمّلة تتصدّر — افتح الصفحات الأول', 'error'); return; }
        XL.writeFile(wb, 'ibtekr-full-' + K.TODAY + '.xlsx'); LOGV('settings.export.full', done.join(' · ')); K.toast('اتنزّل الملف — ' + done.length + ' شيت', 'success');
      }).catch(() => K.toast('معرفناش نجهّز ملف Excel — صدّر المجموعات واحدة واحدة من فوق', 'error')) });
    return h('section', { class: 'card' }, h('h2', { class: 't-h5' }, 'نسخة كاملة من البيانات'), vrow('تصدير كل المجموعات في ملف Excel واحد', 'شيت لكل مجموعة · من غير البيانات الحساسة · من البيانات اللي السيستم محمّلها دلوقتي. مفيش حذف لبيانات الشركة من السيستم — كل سجل ليه قاعدته في صفحته.', Button({ type: 'primary', label: 'تصدير نسخة كاملة', icon: 'download', attrs: { 'data-full-export': '' }, onClick: run })));
  }


  // ======================= phase 11 (decision 26): the page on IBSettings =======================
  // The v6 block above keeps its shapes (C.*, K.store.*); this part hydrates them from the server rows, persists every change the
  // v6 logs (LOGV → afterLog → the section's row), and redefines the functions that must talk to the server (the team's RPCs, the
  // platform links, the activity log, the sessions, the papers, the logos, the AI providers). Function declarations below replace
  // the v6 ones of the same name (hoisting: the last declaration wins); the v6 helpers they build on were renamed *V6 by the patch.
  const SETT = () => window.IBSettings;
  const ROW_OF = { general: 'general', notifications: 'notif', makers: 'makers', payments: 'payments', activity: 'activity', security: 'security', data: 'data', brand: 'brand', ai: 'ai_rules' };
  const SYSTEM_NAMES = { admin: 'أدمن', ops: 'عمليات', cs: 'خدمة العملاء', accounts: 'حسابات', vendors_followup: 'متابعة المبتكرين', viewer: 'مشاهد' };
  const SYSTEM_ORDER = ['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'viewer'];
  let ROLE_IDS = SYSTEM_ORDER.slice(); let hydrated = false; let pendingSave = null; let loadingLinks = false;
  const roleIdAt = (ci) => ROLE_IDS[ci] || null; const roleIdOf = (name) => roleIdAt(allNames().indexOf(name));
  const serverRole = (id) => (SETT() ? SETT().roles().find((r) => r.id === id) : null) || null;
  const roleNameOf = (id) => { const r = serverRole(id); return r ? r.name : SYSTEM_NAMES[id] || id; };
  const uidOf = (m) => (m && m.uid) || null; const memberByUid = (uid) => S.members.find((m) => m.uid === uid) || null;
  const isAdminMe = () => { const me = window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null; return !!me && me.role_id === 'admin' && me.status === 'active'; };
  const canView = () => isAdminMe() || (window.IBDirectory && window.IBDirectory.perm && window.IBDirectory.perm('settings.view') !== 'N');
  const fail = (r, what) => K.toast((r && r.message) || ('تعذّر ' + (what || 'الحفظ') + ' — جرّب تاني'), 'error');
  // activity: the v6 logs values in its details — the server copy gets names only (never a key-looking token)
  function LOGV(action, detail) { K.logEvent(action, String(detail == null ? '' : detail).replace(/[A-Za-z0-9_.-]{24,}/g, '…').slice(0, 300)); afterLog(action); }

  // ---------- the roles and the matrix (decision 12) ----------
  function hydrateRoles() {
    const roles = SETT().roles(); if (!roles.length) return;
    const sys = SYSTEM_ORDER.map((id) => roles.find((r) => r.id === id) || { id, name: SYSTEM_NAMES[id], hidden: false, permissions: {}, description: '' });
    const custom = roles.filter((r) => !SYSTEM_ORDER.includes(r.id)).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    ROLES = sys.map((r) => r.name); ROLE_IDS = sys.map((r) => r.id).concat(custom.map((r) => r.id));
    C.custom = custom.filter((r) => !r.hidden).map((r) => r.name); ROLE_IDS = sys.map((r) => r.id).concat(custom.filter((r) => !r.hidden).map((r) => r.id));
    C.removed = sys.filter((r) => r.hidden).map((r) => r.name);
    C.roleInfo = Object.fromEntries(sys.concat(custom).map((r) => [r.name, r.description || ROLE_DESC[r.name] || '']));
    const all = allNames(); const lvl = (ci, key) => { const r = roles.find((x) => x.id === ROLE_IDS[ci]); return !r ? 'N' : r.id === 'admin' ? 'F' : (r.permissions[key] || 'N'); };
    const rows = SETT().PERMS.map(([g, list]) => [g, list.map(([label, key, sens]) => [label, all.map((_, ci) => lvl(ci, key)).join(''), sens, key])]);
    C.perms.splice(0, C.perms.length, ...rows);
  }
  // the matrix → the server: every live role whose levels or words differ (the admin never)
  async function syncRoles() {
    const S0 = SETT(); if (!S0 || !isAdminMe()) return;
    const all = allNames(); let touched = false;
    for (let ci = 0; ci < all.length; ci++) {
      const id = roleIdAt(ci); const r = serverRole(id); if (!r || id === 'admin' || (C.removed || []).includes(all[ci])) continue;
      const perms = {}; C.perms.forEach(([, list]) => list.forEach((row) => { if (row[3]) perms[row[3]] = row[1][ci] || 'N'; }));
      const changed = S0.PERM_KEYS.some((k) => (perms[k] || 'N') !== (r.permissions[k] || 'N'));
      if (changed) { const x = await S0.setRolePerms(id, perms); if (!x.ok) fail(x, 'حفظ الصلاحيات'); touched = true; }
      const desc = (C.roleInfo || {})[all[ci]]; const nm = all[ci];
      if ((desc != null && desc !== (r.description || '')) || nm !== r.name) { const x = await S0.updateRole(id, { name: r.isSystem ? null : nm, desc: desc || '' }); if (!x.ok) fail(x, 'حفظ الدور'); touched = true; }
    }
    if (touched) { hydrateRoles(); if (window.IBPages.current === 'settings') R(); }
  }
  function roleSelect(m) {
    return h('div', { class: 'inline-sel' }, U.Select({ id: 'role-' + m.id, label: '', options: liveNames().map((r) => ({ value: r, label: r })), value: m.role, onChange: async (v) => {
      const id = roleIdOf(v); if (!id || !uidOf(m)) return; const old = m.role; const r = await SETT().setMemberRole(uidOf(m), id);
      if (!r.ok) { fail(r, 'تغيير الدور'); R(); return; } m.role = v; K.logEvent('settings.member.role', m.name + ': ' + old + ' ← ' + v); K.toast('دور ' + m.name + ' بقى ' + v); R(); } }));
  }
  // phase 13 decision 15 (the owner: «الحذف من الإعدادات كمان»): for good, through IBHR → team-admin member_delete — a trace anywhere refuses it
  function deleteMember(m) {
    const HR = window.IBHR; if (!HR || !HR.memberDelete || !uidOf(m)) return;
    K.confirm({ title: 'حذف ' + m.name + ' نهائي؟', text: 'الحساب والملف وبياناته في الموارد البشرية هيتمسحوا خالص ومافيش رجوع. بينفع بس لعضو ماعملش أي حاجة في السيستم (ماسجّلش دخول، ماكتبش حاجة، ماعندوش حضور ولا طلبات ولا مستندات) — غير كده السيستم هيرفض وتقدر توقفه بدل ما تمسحه.', okLabel: 'احذف نهائي', okType: 'danger',
      onOk: () => HR.memberDelete(uidOf(m)).then((r) => { if (!r.ok) return fail(r, 'الحذف'); const i = S.members.indexOf(m); if (i >= 0) S.members.splice(i, 1); K.toast('اتحذف ' + m.name + ' نهائي', 'success'); R(); }) });
  }
  function suspend(m) {
    if (!uidOf(m)) return;
    if (m.status === 'suspended') { SETT().setMemberStatus(uidOf(m), 'active', '').then((r) => { if (!r.ok) return fail(r, 'التفعيل'); m.status = 'active'; K.toast('اتفعّل ' + m.name); R(); }); return; }
    K.form({ title: 'إيقاف عضو — ' + m.name, values: { reason: '' }, note: U.InlineNote({ kind: 'warning', children: 'الإيقاف بيقفل الدخول فورًا ويعمل خروج من كل الأجهزة. بياناته وسجله بيفضلوا زي ما هم.' }),
      fields: (f, e, set) => [K.field.area('reason', 'سبب الإيقاف', f, e, set, { required: true, rows: 2, help: 'بيتسجل في سجل النشاط (مش بيظهر للعضو)' })], validate: (f) => K.req(f, ['reason']), submitLabel: 'إيقاف', submitType: 'danger',
      submit: async (f, md) => { const r = await SETT().setMemberStatus(uidOf(m), 'suspended', f.reason); if (!r.ok) return fail(r, 'الإيقاف'); m.status = 'suspended'; md.close(); K.toast('اتوقف ' + m.name); R(); } });
  }
  function invite() { const hr = window.IBPages.all().hr; if (hr && hr.api && hr.api.addMember) { hr.api.addMember(); return; } location.hash = 'hr'; K.toast('إضافة عضو من «الموارد البشرية › الفريق»'); }
  function cancelInvite(m) { K.toast('مفيش دعوات معلّقة — العضو بيتضاف بحساب وباسورد مؤقت من الموارد البشرية'); void m; }
  function customPerms(m) {
    if (!uidOf(m)) return; const cur = (m.customPerms && typeof m.customPerms === 'object') ? m.customPerms : {}; const v0 = {}; SETT().PERM_KEYS.forEach((k) => { v0[k] = cur[k] || 'role'; });
    K.form({ title: 'صلاحيات مخصصة — ' + m.name, wide: true, values: v0, note: U.InlineNote({ children: 'الدور الحالي: ' + m.role + '. التجاوز بيتطبق على العضو ده بس — «حسب الدور» بيشيل التجاوز.' }),
      fields: (f, e, set) => [h('div', { class: 'rp-list' }, SETT().PERMS.map(([g, rows]) => h('div', { class: 'rp-group' }, h('b', { class: 't-label' }, g), rows.map(([n, key, sens]) => h('div', { class: 'ma-row' + (sens ? ' sens' : '') }, h('span', null, sens ? Icon('alert', 'sm') : null, n),
        U.Select({ id: 'cp-' + key.replace('.', '-'), label: '', options: [{ value: 'role', label: 'حسب الدور' }].concat(PLV), value: f[key], onChange: (v) => set(key, v, true) }))))))],
      submitLabel: 'حفظ', submit: async (f, md) => { const o = {}; Object.keys(f).forEach((k) => { if (f[k] && f[k] !== 'role') o[k] = f[k]; }); const r = await SETT().setMemberPerms(uidOf(m), o); if (!r.ok) return fail(r, 'حفظ الصلاحيات'); m.customPerms = o; m.override = Object.keys(o).length || null; md.close(); K.toast('اتحفظت صلاحيات ' + m.name, 'success'); R(); } });
  }
  function customRole() {
    K.form({ title: 'دور مخصص', values: { name: '', desc: '', base: liveNames().includes('مشاهد') ? 'مشاهد' : liveNames()[1] },
      fields: (f, e, set) => [K.field.text('name', 'اسم الدور', f, e, set, { required: true }), K.field.text('desc', 'الوصف', f, e, set, { help: 'بيظهر عند الدعوة واختيار الدور' }), K.field.select('base', 'ابدأ من صلاحيات', liveNames().filter((r) => r !== 'أدمن'), f, e, set, { required: true, help: 'نسخة من صلاحيات الدور ده وتنبيهاته — تعدّلها بعدين' })],
      validate: (f) => { const e = K.req(f, ['name', 'base']); if (allNames().includes(String(f.name || '').trim())) e.name = 'الاسم ده موجود'; return e; }, submitLabel: 'إنشاء الدور',
      submit: async (f, md) => { const r = await SETT().createRole({ name: f.name, desc: f.desc, base: roleIdOf(f.base) || 'viewer' }); if (!r.ok) return fail(r, 'إنشاء الدور'); md.close(); hydrateRoles(); K.logEvent('settings.role.create', f.name); K.toast('اتعمل دور «' + f.name.trim() + '»', 'success'); R(); } });
  }
  function deleteRole(name, ci, parent) {
    const id = roleIdAt(ci); const mem = S.members.filter((m) => m.role === name); const others = liveNames().filter((r) => r !== name && r !== 'أدمن');
    const v0 = { to: others.includes('مشاهد') ? 'مشاهد' : others[0], ok: false };
    K.form({ title: 'حذف دور «' + name + '»', values: v0, submitType: 'danger', submitLabel: 'حذف نهائي',
      note: U.InlineNote({ kind: 'warning', children: 'الدور هيختفي من مصفوفة الصلاحيات والتنبيهات.' + (mem.length ? ' عليه ' + mem.length + ' أعضاء — هيتنقلوا للدور اللي تختاره.' : '') }),
      fields: (f, e, set) => [mem.length ? K.field.select('to', 'الدور الجديد للأعضاء (' + mem.length + ')', others, f, e, set, { required: true }) : null, h('div', { class: 'field' + (e.ok ? ' has-err' : '') }, K.Checkbox({ label: 'فاهم إن حذف الدور نهائي', checked: f.ok, onChange: (v) => set('ok', v, true) }), e.ok ? h('div', { class: 'err-msg t-small', role: 'alert' }, e.ok) : null)],
      validate: (f) => { const e = {}; if (mem.length && !f.to) e.to = 'اختار الدور'; if (!f.ok) e.ok = 'علّم على التأكيد عشان تحذف'; return e; },
      submit: async (f, md) => { const r = await SETT().deleteRole(id, mem.length ? { '*': roleIdOf(f.to) } : {}); if (!r.ok) return fail(r, 'حذف الدور'); md.close(); if (parent) parent.close(); hydrateRoles(); if (window.IBDirectory && window.IBDirectory.refresh) window.IBDirectory.refresh().catch(() => {}); K.toast('اتحذف دور ' + name, 'success'); R(); document.dispatchEvent(new Event('ib:notify')); } });
  }

  // ---------- the notifications row (decision 16): the v6 shapes in one row «notif» ----------
  const codeToUid = (o) => { const out = {}; Object.keys(o || {}).forEach((code) => { const m = S.members.find((x) => x.id === code); if (m && m.uid) out[m.uid] = o[code]; }); return out; };
  const uidToCode = (o) => { const out = {}; Object.keys(o || {}).forEach((uid) => { const m = memberByUid(uid); if (m) out[m.id] = o[uid]; }); return out; };
  function notifPayload() {
    return { notif: C.notif, escalations: C.escalations, quiet: C.quiet, alertRoles: K.store.alertRoles, alertOverrides: codeToUid(K.store.alertOverrides), digests: K.store.digests, roleDigests: K.store.roleDigests, roleDigestAt: K.store.roleDigestAt || {},
      accAlerts: K.store.accAlerts, delivery: K.store.delivery, subsAlert: K.store.subsAlert || null, whatsappTemplate: C.whatsappTemplate || 'ibtekr_alert', channels: channelsOut() };
  }
  function hydrateNotif(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.notif) && n.notif.length) C.notif.splice(0, C.notif.length, ...n.notif);
    if (Array.isArray(n.escalations)) C.escalations = n.escalations;
    if (n.quiet && typeof n.quiet === 'object') Object.assign(C.quiet, n.quiet);
    const fill = (target, src) => { Object.keys(target).forEach((k) => delete target[k]); Object.assign(target, src && typeof src === 'object' ? src : {}); };
    fill(K.store.alertRoles, n.alertRoles); fill(K.store.alertOverrides, uidToCode(n.alertOverrides)); fill(K.store.roleDigests, n.roleDigests);
    K.store.roleDigestAt = n.roleDigestAt && typeof n.roleDigestAt === 'object' ? n.roleDigestAt : (K.store.roleDigestAt || {});
    if (Array.isArray(n.digests)) K.store.digests.splice(0, K.store.digests.length, ...n.digests);
    if (n.accAlerts && typeof n.accAlerts === 'object') Object.assign(K.store.accAlerts, n.accAlerts);
    if (n.delivery && typeof n.delivery === 'object') Object.assign(K.store.delivery, n.delivery);
    if (n.subsAlert && typeof n.subsAlert === 'object') K.store.subsAlert = Object.assign(K.store.subsAlert || {}, n.subsAlert);
    if (typeof n.whatsappTemplate === 'string') C.whatsappTemplate = n.whatsappTemplate;
    if (n.channels && typeof n.channels === 'object') C.channelsOut = { email: n.channels.email === true, whatsapp: n.channels.whatsapp === true };
  }
  // the outbound channels as a whole (owner 8 Nov: the system's alerts only — both off until the admin turns one on here)
  const channelsOut = () => (C.channelsOut = C.channelsOut || { email: false, whatsapp: false });
  function quietSec() {
    const q = C.quiet;
    const tpl = U.TextInput({ id: 'q-wa-tpl', label: 'قالب واتساب للتنبيهات', value: C.whatsappTemplate || 'ibtekr_alert', dir: 'ltr', help: 'اسم القالب المعتمد في WhatsApp Manager (متغير نص واحد) — بيتبعت عليه تنبيهات الفريق والمبتكرين من رقم واتساب 1', onInput: (v) => { const t = String(v || '').trim().toLowerCase(); if (/^[a-z0-9_]{1,120}$/.test(t)) C.whatsappTemplate = t; } });
    return K.Section('ساعات الهدوء والملخص اليومي', [K.two(pick(q, 'days', 'q-d', 'أيام الراحة', ['الجمعة', 'الجمعة والسبت', 'لا يوجد']), pick(q, 'hours', 'q-h', 'ساعات الهدوء', ['من 11:00 م إلى 9:00 ص', 'من 10:00 م إلى 8:00 ص'])),
      K.two(pick(q, 'waMax', 'q-w', 'الحد الأقصى لرسائل واتساب لكل عضو في اليوم', ['رسالة في اليوم', 'رسالتان في اليوم', '3 رسايل']), pick(q, 'digest', 'q-dg', 'الملخص اليومي الافتراضي', ['9:30 ص · إيميل', '9:00 ص · إيميل', '8:00 ص · إيميل'])),
      K.two(U.TextInput({ id: 'q-sig', label: 'توقيع الرسايل', value: q.signature || 'فريق إبتكر كلوب', onInput: (v) => { q.signature = String(v || '').slice(0, 80); } }), tpl),
      h('div', { class: 'row cols2', 'data-out-channels': '' }, K.Switch({ id: 'q-ch-email', label: 'إرسال التنبيهات بالإيميل', help: 'مقفول = التنبيهات في الجرس بس · مفتوح = الأنواع اللي عليها «إيميل» بتتبعت عبر Resend', checked: channelsOut().email, onChange: (v) => { channelsOut().email = !!v; LOGV('settings.notif.channels', 'email · ' + (v ? 'مفعّل' : 'مقفول')); } }),
        K.Switch({ id: 'q-ch-wa', label: 'إرسال التنبيهات بواتساب', help: 'مقفول = الجرس بس · مفتوح = الأنواع اللي عليها «واتساب» بتتبعت من واتساب 1 بالقالب المعتمد', checked: channelsOut().whatsapp, onChange: (v) => { channelsOut().whatsapp = !!v; LOGV('settings.notif.channels', 'whatsapp · ' + (v ? 'مفعّل' : 'مقفول')); } })),
      h('div', { class: 'acts-inline start' }, Button({ size: 'sm', label: 'حفظ', onClick: () => { persist('notifications'); } }), Button({ size: 'sm', type: 'text', label: 'شغّل المحرك دلوقتي (تجربة)', attrs: { 'data-notify-dry': '' }, onClick: async () => { const r = await SETT().notifyTick(true); if (!r.ok) return fail(r, 'التشغيل'); K.toast('لو اتشغّل دلوقتي: ' + (r.alerts || 0) + ' تنبيه · ' + (r.digests || 0) + ' ملخص · ' + (r.external || 0) + ' رسالة خارجية'); } }))],
      null, { sub: 'القنوات الخارجية (واتساب / إيميل) بتتأجل في ساعات الهدوء وأيام الراحة — الجرس بيظهر عادي · المحرك بيلف كل 15 دقيقة على السيرفر' });
  }

  // ---------- the sections' rows ----------
  const PAYLOADS = { general: () => Object.assign({}, C.general), notifications: notifPayload, makers: () => Object.assign({}, C.makers), payments: () => ({ payout: C.payout }), activity: () => Object.assign({}, C.actSet),
    security: () => Object.assign({}, C.security), data: () => ({ backup: C.backup }), brand: () => ({ colors: brand.colors, fonts: brand.fonts, logos: (SETT().section('brand') || {}).logos || {} }), ai: () => (S.aiRules ? JSON.parse(JSON.stringify(S.aiRules)) : null) };
  async function persist(sec) {
    const row = ROW_OF[sec]; const build = PAYLOADS[sec]; if (!row || !build || !SETT() || !isAdminMe()) return;
    const payload = build(); if (!payload) return;
    const r = await SETT().save(row, payload, { merge: false }); if (!r.ok) fail(r, 'الحفظ');
  }
  function persistSoon(sec) { clearTimeout(pendingSave); pendingSave = setTimeout(() => persist(sec), 400); }
  function afterLog(action) {
    if (!hydrated) return;
    if (action.startsWith('settings.role.') || action === 'settings.perm') { syncRoles(); persistSoon('notifications'); return; }
    if (/^settings\.(alert|notif|escalation|digest|delivery)\./.test(action)) { persistSoon('notifications'); return; }
    if (action.startsWith('settings.brand.')) { persistSoon('brand'); return; }
    if (action.startsWith('settings.ai.') || action.startsWith('settings.pattern')) { persistSoon('ai'); return; }
    if (action === 'settings.change' || action === 'settings.toggle' || action === 'settings.save') { if (ROW_OF[st.sec]) persistSoon(st.sec); return; }
    if (action === 'settings.discard') { hydrateAll(); }
  }
  function hydrateAll() {
    const S0 = SETT(); if (!S0) return; const sec = S0.sections();
    if (sec.general) Object.assign(C.general, sec.general); if (sec.makers) Object.assign(C.makers, sec.makers);
    if (sec.payments && sec.payments.payout) Object.assign(C.payout, sec.payments.payout); if (sec.activity) Object.assign(C.actSet, sec.activity);
    if (sec.security) Object.assign(C.security, sec.security); if (sec.data && sec.data.backup) Object.assign(C.backup, sec.data.backup);
    if (sec.brand) { brand.colors = Object.assign({}, sec.brand.colors || {}); brand.fonts = Object.assign({}, FONT_DEF, sec.brand.fonts || {}); applyBrand(); saveBrand(); }
    if (sec.ai_rules && Object.keys(sec.ai_rules).length) S.aiRules = Object.assign(AI_DEF(), sec.ai_rules);
    if (S0.lists) { const L = S0.lists(); C.cancelReasons.splice(0, C.cancelReasons.length, ...L.cancel.map((x) => [x, 'إلغاء', 0, true])); C.otherLists.returns = L.returns.slice(); } // phase 12 T3: the v6 arrays mirror the saved lists
    hydrateNotif(sec.notif); hydrateRoles(); hydrated = true;
  }
  document.addEventListener('ib:settings', () => { if (SETT() && SETT().data.loaded) { hydrateAll(); if (window.IBPages.current === 'settings') R(); } });
  document.addEventListener('ib:directory', () => { if (window.IBPages.current === 'settings') R(); });
  function view() {
    if (!canView()) return [K.PageHead('الإعدادات', 'إعدادات الشركة والفريق والربط'), U.InlineNote({ kind: 'warning', children: 'الصفحة دي للأدمن (أو صلاحية «الإعدادات › عرض») بس.' })];
    const S0 = SETT();
    if (S0 && !S0.data.loaded) { S0.ensure().then(() => { hydrateAll(); loadLinks(); loadDocs(); if (window.IBPages.current === 'settings') R(); }); return [K.PageHead('الإعدادات', 'بنحمّل الإعدادات…'), h('div', { class: 'card', style: 'padding:24px;text-align:center' }, h('span', { class: 't-small help' }, 'ثواني…'))]; }
    if (S0 && S0.data.loaded && !hydrated) { hydrateAll(); loadLinks(); loadDocs(); }
    return viewV6();
  }
  function commit() { const nm = (SECTIONS.find((q) => q[0] === st.sec) || [, 'عام'])[1]; if (st.draft) Object.assign(C.general, st.draft); st.dirty = false; st.draft = null; st.pending.delete(st.sec); st.snap = snapTake(); st.snapSec = st.sec; K.logEvent('settings.save', nm); if (ROW_OF[st.sec]) persist(st.sec); K.toast('اتحفظت التغييرات', 'success'); }

  // ---------- the platform links (decisions 9 / 10 / 13): settings-admin + the other pages' links ----------
  const CARD_DESC = { woo: 'الأوردرات والمنتجات والعملاء من الموقع — مفاتيح REST API وباسورد التطبيق للصور', airtable: 'قاعدة البيانات المؤقتة القديمة', wa: 'أرقام واتساب العملاء والمبتكرين — الربط من خدمة العملاء › القنوات', messenger: 'رسايل الصفحة وتعليقات البوستات من خدمة العملاء', instagram: 'رسايل الـ Direct وتعليقات البوستات', tiktok: 'مفيش API رسايل عام — غير متصل', sheets: 'قراءة شيتات Google', paymob: 'تأكيد المدفوعات الإلكترونية', bosta: 'حالة الشحنات ورصيد التحصيل', n8n: 'الأتمتة الخارجية (webhook)', metaads: 'الصرف والحملات لصفحة «التسويق» — الربط من التسويق › نظرة عامة', googleads: 'حملات جوجل لصفحة «التسويق»', tiktokads: 'حملات تيك توك لصفحة «التسويق»', magnific: 'صور المنتجات والكامبينات — مفتاح الـ API هنا، وحساب الموقع (الجسر) من المنتجات › الصور', github: 'المبرمج: الريبو ولينك المعاينة', claude: 'المحتوى والمساعدين — Claude', openai: 'نصوص وصور gpt-image', gemini: 'نصوص وصور Nano Banana وفيديو Veo', elevenlabs: 'التعليق الصوتي المباشر', higgsfield: 'فيديوهات الكامبينات عبر MCP', resend: 'إيميلات التنبيهات من alerts@ibtekr.club', figma: 'ملف الديزاين سيستم' };
  const CONN_OF = { woo: 'REST API', wa: 'Meta Cloud API / QR', messenger: 'OAuth', instagram: 'OAuth', tiktok: '—', metaads: 'System User', googleads: 'OAuth', tiktokads: 'OAuth', magnific: 'API + MCP', higgsfield: 'MCP', github: 'Token', figma: 'Token', resend: 'API Key' };
  const FIELD_LABELS = { url: 'رابط الموقع / السيرفر', ck: 'Consumer key', cs: 'Consumer secret', wp_user: 'مستخدم WordPress (للصور)', wp_app_password: 'باسورد التطبيق (WordPress)', push: 'السماح بالكتابة على الموقع', key: 'مفتاح API', secret: 'السر (اختياري)', from: 'إيميل المرسل', base: 'رقم القاعدة (اختياري)', sheet: 'رقم الشيت (اختياري)', merchant: 'رقم التاجر (اختياري)', repo: 'الريبو owner/name (اختياري)', file: 'ملف Figma (اختياري)', token: 'التوكن (اختياري)', name: 'الاسم', conn: 'طريقة الربط', desc: 'بتستعمله في إيه؟' };
  const FIELDS_OF = { woo: ['url', 'ck', 'cs', 'wp_user', 'wp_app_password', 'push'], anthropic: ['key'], openai: ['key'], gemini: ['key'], elevenlabs: ['key'], higgsfield: ['key', 'secret'], magnific_api: ['key'], resend: ['key', 'from'], airtable: ['key', 'base'], sheets: ['key', 'sheet'], paymob: ['key', 'merchant'], bosta: ['key'], n8n: ['url', 'key'], github: ['key', 'repo'], figma: ['key', 'file'], mcp: ['name', 'url', 'token'], custom: ['name', 'conn', 'key', 'url', 'desc'] };
  const SECRETISH = ['ck', 'cs', 'wp_app_password', 'key', 'secret', 'token'];
  const fieldsOfName = (n) => FIELDS_OF[n] || (String(n).startsWith('mcp_') ? FIELDS_OF.mcp : String(n).startsWith('custom_') ? FIELDS_OF.custom : ['key']);
  let LINKS = { links: {}, cards: [], conns: null, at: 0 };
  const ago = (iso) => { if (!iso) return ''; const d = Date.parse(iso); if (!Number.isFinite(d)) return ''; const h = Math.round((Date.now() - d) / 3600000); return h < 1 ? 'دلوقتي' : h < 24 ? 'من ' + h + ' ساعة' : 'من ' + Math.round(h / 24) + ' يوم'; };
  function buildIntegrations() {
    const cards = LINKS.cards.length ? LINKS.cards : [{ id: 'woo', kind: 'site', name: 'WooCommerce', secret: 'woo', used: true }];
    const c = LINKS.conns || {}; const cs = c.cs && !c.cs.down ? c.cs : null; const wa = c.wa && !c.wa.down ? c.wa : null; const ads = c.ads && !c.ads.down && c.ads.ads ? c.ads.ads : null; const mg = c.magnific && !c.magnific.down ? c.magnific : null; const nt = c.notify && !c.notify.down ? c.notify : null;
    const list = cards.map((card) => {
      const link = card.secret ? LINKS.links[card.secret] : null; let status = 'غير متصل', last = 'لم يتم الربط بعد', dir = '';
      if (link) { status = link.ready ? (link.test && link.test.ok === false ? 'خطأ في المزامنة' : 'متصل') : 'غير متصل'; last = link.linked_at ? 'اتربط ' + ago(link.linked_at) + (link.test ? ' · ' + (link.test.ok ? 'الاختبار نجح' + (link.test.account ? ' · ' + link.test.account : '') : 'الاختبار فشل') : '') : last; }
      if (card.id === 'messenger' || card.id === 'instagram') { const ch = cs && Array.isArray(cs.channels) ? cs.channels.find((x) => x.id === card.id) : null; status = cs ? (cs.linked ? 'متصل' : 'غير متصل') : 'غير متصل'; last = cs ? (cs.linked ? 'صفحة مربوطة' + (ch && ch.name ? ' · ' + ch.name : '') : 'اربطها من خدمة العملاء › القنوات') : 'خدمة العملاء ماردّتش'; }
      if (card.id === 'wa') { const st1 = wa && wa.states ? wa.states.wa1 : null; const meta = cs && Array.isArray(cs.channels) ? cs.channels.find((x) => x.id === 'wa1') : null; const on = (meta && meta.status === 'connected') || (st1 && st1.status === 'connected'); status = on ? 'متصل' : 'غير متصل'; last = on ? 'واتساب 1 متصل' : 'الربط من خدمة العملاء › القنوات (Meta Cloud API)'; }
      if (card.kind === 'ads') { const k = card.id === 'metaads' ? 'meta' : card.id === 'googleads' ? 'google' : 'tiktok'; const p = ads && ads.platforms ? ads.platforms[k] : null; status = p && (p.linked || p.configured) ? (p.error ? 'خطأ في المزامنة' : 'متصل') : 'غير متصل'; last = p && p.syncedAt ? 'آخر مزامنة ' + ago(p.syncedAt) : p ? 'اربطها من التسويق › نظرة عامة › حالة الربط' : 'التسويق ماردّش'; }
      if (card.id === 'magnific') { const api = link && link.ready; const br = mg && mg.linked; status = api || br ? 'متصل' : 'غير متصل'; last = (api ? 'مفتاح API' : 'من غير مفتاح API') + ' · ' + (br ? 'حساب الموقع مربوط' + (mg.account ? ' (' + mg.account + ')' : '') : 'حساب الموقع مش مربوط'); }
      if (card.id === 'resend' && nt) last += (nt.email && nt.email.ready ? ' · محرك التنبيهات جاهز للإيميل' : ''); if (card.id === 'tiktok') { status = 'غير متصل'; last = 'مفيش API رسايل عام'; }
      return { id: card.id, kind: card.kind || 'site', conn: CONN_OF[card.id] || 'API', name: card.name, short: card.name, letter: String(card.name).charAt(0), status, desc: CARD_DESC[card.id] || '', last, dir, secret: card.secret, used: !!card.used, link };
    });
    // the MCP servers and the custom tools the admin linked (names from the links)
    Object.keys(LINKS.links).forEach((n) => { if (!/^(mcp|custom)_/.test(n)) return; const l = LINKS.links[n]; const nm = (l.fields && l.fields.name) || n; list.push({ id: n, kind: 'ai', conn: n.startsWith('mcp_') ? 'MCP' : (l.fields && l.fields.conn) || 'API', name: nm, short: nm, letter: String(nm).charAt(0), status: l.ready ? 'متصل' : 'غير متصل', desc: (l.fields && l.fields.desc) || (n.startsWith('mcp_') ? 'سيرفر MCP — السيستم بيستعمل أدواته' : 'أداة مربوطة'), last: l.linked_at ? 'اتربط ' + ago(l.linked_at) : '', dir: '', secret: n, used: true, link: l, custom: true }); });
    C.integrations.splice(0, C.integrations.length, ...list);
  }
  async function loadLinks(force) {
    if (!SETT() || !isAdminMe() || loadingLinks) return; if (!force && LINKS.at && Date.now() - LINKS.at < 60000) return;
    loadingLinks = true;
    try { const c = await SETT().connections(); const s = c.settings && !c.settings.down && c.settings.ok ? c.settings : null; LINKS = { links: s ? s.links : LINKS.links, cards: s ? s.cards : LINKS.cards, conns: c, at: Date.now() }; buildIntegrations(); } catch (e) { /* the cards keep their last state */ }
    loadingLinks = false; if (window.IBPages.current === 'settings') R();
  }
  function integrations() {
    if (!LINKS.at) loadLinks();
    const I = C.integrations; const con = I.filter((x) => x.status === 'متصل').length, err = I.filter((x) => String(x.status).startsWith('خطأ')).length;
    const ITABS = [['site', 'الموقع والبيانات'], ['social', 'وسائل التواصل والرسايل'], ['ads', 'الإعلانات'], ['ai', 'الذكاء الاصطناعي و API']];
    const tab = ITABS.some(([id]) => id === st.itab) ? st.itab : 'site'; const inTab = I.filter((x) => (x.kind || 'site') === tab); const tabLabel = (ITABS.find(([id]) => id === tab) || [, ''])[1];
    const SUBS = { site: 'الموقع والبيانات اللي السيستم شغال عليها — مفاتيح الموقع بتتجرب الأول وبتتحفظ بعد التأكيد.', social: 'حسابات الرسايل والتعليقات — بتتربط من خدمة العملاء › القنوات وبتظهر حالتها هنا.', ads: 'حسابات الإعلانات اللي بتغذّي «التسويق» — الربط من التسويق › نظرة عامة › حالة الربط.', ai: 'أدوات الذكاء الاصطناعي — المفتاح بيتحفظ في الخزنة (Vault) ومابيظهرش تاني غير آخر 4 حروف.' };
    const tabs = K.MainTabs({ items: ITABS.map(([id, label]) => ({ id, label: label + ' · ' + I.filter((x) => (x.kind || 'site') === id).length })), active: tab, onChange: (id) => { st.itab = id; R(); }, label: 'أنواع الربط' });
    const actions = (p) => {
      const out = [];
      if (p.id === 'woo') out.push(Button({ type: p.status === 'متصل' ? 'default' : 'primary', size: 'sm', label: p.status === 'متصل' ? 'الإعدادات' : 'ربط', attrs: { 'data-integ-open': p.id }, onClick: () => { st.integ = 'woo'; R(); window.scrollTo(0, 0); } }));
      else if (p.kind === 'social') out.push(Button({ size: 'sm', label: 'خدمة العملاء › القنوات', onClick: () => { location.hash = 'cs-channels'; } }));
      else if (p.kind === 'ads') out.push(Button({ size: 'sm', label: 'التسويق › حالة الربط', onClick: () => { location.hash = 'marketing'; } }));
      else if (p.secret) { out.push(Button({ type: p.status === 'متصل' ? 'default' : 'primary', size: 'sm', label: p.status === 'متصل' ? 'غيّر المفتاح' : 'ربط', attrs: { 'data-integ-connect': p.id }, onClick: () => connect(p) })); if (p.link && p.link.ready) { out.push(Button({ type: 'text', size: 'sm', label: 'اختبار', attrs: { 'data-integ-test': p.id }, onClick: () => testLink(p) })); out.push(Button({ type: 'text', size: 'sm', label: 'فصل', attrs: { 'data-integ-unlink': p.id }, onClick: () => disconnect(p) })); } }
      if (p.id === 'magnific') out.push(Button({ type: 'text', size: 'sm', label: 'حساب الموقع (الجسر)', onClick: () => { location.hash = 'products-tool-images'; } }));
      return out;
    };
    return [h('div', { class: 'cards' }, K.Stat('منصات متصلة', con, 'من ' + I.length, I.filter((x) => x.status === 'متصل').map((x) => x.short || x.name).join(' · ')), K.Stat('منصات بها خطأ', err, 'من ' + (con + err) + ' متصلة', I.filter((x) => String(x.status).startsWith('خطأ')).map((x) => x.name).join('، ') || '—'), K.Stat('محرك التنبيهات', LINKS.conns && LINKS.conns.notify && !LINKS.conns.notify.down && LINKS.conns.notify.last ? 'شغّال' : '—', LINKS.conns && LINKS.conns.notify && LINKS.conns.notify.last ? 'آخر تشغيلة ' + ago(LINKS.conns.notify.last.at) : 'لسه ما اتشغّلش', '')),
      h('div', { class: 'integ-tabs', 'data-itabs': '' }, tabs),
      K.Section(tabLabel, h('div', { class: 'integ-grid' }, inTab.length ? inTab.map((p) => h('div', { class: 'card integ', 'data-integ': p.id }, h('div', { class: 'integ-h' }, h('span', { class: 'vlogo vlogo-md' }, p.letter), h('div', null, h('b', null, p.name), h('div', { class: 't-small help' }, p.desc)), K.Tag(tagFor(p.status), p.status)),
        p.conn ? h('div', { class: 'integ-conn' }, K.Tag('neutral', 'ربط: ' + p.conn), p.link && p.link.fields && Object.keys(p.link.fields).length ? K.Tag('neutral', Object.keys(p.link.fields).filter((k) => SECRETISH.includes(k)).map((k) => p.link.fields[k]).join(' · ')) : null) : null,
        h('div', { class: 't-small' }, p.last), h('div', { class: 'acts-inline start' }, actions(p)))) : K.Empty('مفيش منصات في التاب ده', '')),
        [Button({ type: 'text', size: 'sm', label: 'حدّث الحالة', attrs: { 'data-integ-refresh': '' }, onClick: () => loadLinks(true) }), tab === 'ai' || tab === 'site' ? Button({ type: 'primary', size: 'sm', icon: 'plus', label: tab === 'ai' ? 'ربط أداة أو سيرفر MCP' : 'ربط منصة تانية', attrs: { 'data-integ-add': tab }, onClick: () => addIntegration(tab) }) : null].filter(Boolean), { sub: SUBS[tab] })];
  }
  function fieldInputs(secret, f, e, set, link) {
    return fieldsOfName(secret).map((k) => {
      if (k === 'push') return K.Switch({ id: 'lk-push', label: 'السماح للسيستم بالكتابة على الموقع (WOO_PUSH_ENABLED)', hint: 'مقفول = قراءة بس', checked: f.push === true || f.push === '1', onChange: (v) => set('push', v, true) });
      if (k === 'conn') return K.field.select('conn', FIELD_LABELS.conn, ['API', 'MCP', 'OAuth'], f, e, set, { required: true });
      if (k === 'desc') return K.field.area('desc', FIELD_LABELS.desc, f, e, set, { rows: 2 });
      const tail = link && link.fields && link.fields[k]; const sec = SECRETISH.includes(k);
      return K.field.text(k, FIELD_LABELS[k] || k, f, e, set, { dir: k === 'name' || k === 'desc' ? undefined : 'ltr', type: sec ? 'password' : 'text', placeholder: sec && tail ? 'محفوظ (' + tail + ') — سيبه فاضي لو مش هتغيّره' : (k === 'url' ? 'https://…' : ''), help: sec ? 'بيتحفظ في الخزنة ومابيظهرش تاني' : undefined });
    });
  }
  function connect(p) {
    const secret = p.secret; if (!secret) return; const link = p.link; const v0 = {}; fieldsOfName(secret).forEach((k) => { v0[k] = k === 'push' ? !!(link && link.fields && (link.fields.push === true || link.fields.push === '1')) : (link && link.fields && !SECRETISH.includes(k) ? link.fields[k] || '' : ''); });
    K.form({ title: (link && link.ready ? 'تعديل ربط ' : 'ربط ') + p.name, values: v0, note: U.InlineNote({ children: 'المفاتيح بتتحفظ في خزنة Supabase (Vault) ومابتظهرش تاني — بيتعمل اختبار اتصال بعد الحفظ.' }),
      fields: (f, e, set) => fieldInputs(secret, f, e, set, link),
      submitLabel: 'حفظ واختبار', submit: async (f, md) => { const fields = {}; Object.keys(f).forEach((k) => { if (f[k] !== '' && f[k] != null) fields[k] = typeof f[k] === 'boolean' ? f[k] : String(f[k]); }); const r = await SETT().setSecret(secret, fields); if (!r.ok) { K.toast(r.message || 'تعذّر الحفظ', 'error'); return; } md.close(); K.toast(r.test ? (r.test.ok ? 'اتربط ' + p.name + ' · ' + (r.test.account || 'الاختبار نجح') : 'اتحفظ المفتاح بس الاختبار فشل — راجعه') : 'اتحفظ ' + p.name, r.test && r.test.ok === false ? 'error' : 'success'); loadLinks(true); } });
  }
  async function testLink(p) { if (!p.secret) return; const r = await SETT().testSecret(p.secret); if (!r.ok) return fail(r, 'الاختبار'); const t = r.test || {}; K.toast(t.ok ? 'الاتصال سليم' + (t.account ? ' · ' + t.account : '') : 'الاختبار فشل — راجع المفاتيح', t.ok ? 'success' : 'error'); loadLinks(true); }
  function disconnect(p) { if (!p.secret) return; K.confirm({ title: 'فصل ' + p.name + '؟', text: 'المفتاح هيتمسح من الخزنة والأدوات اللي بتعتمد عليه هتقول «مش مربوط» لحد ما تربطه تاني.', okType: 'danger', okLabel: 'فصل', onOk: async () => { const r = await SETT().unlink(p.secret); if (!r.ok) return fail(r, 'الفصل'); K.toast('اتفصل ' + p.name); loadLinks(true); } }); }
  function addIntegration(kind) {
    const isAi = kind === 'ai';
    K.form({ title: isAi ? 'ربط أداة أو سيرفر MCP' : 'ربط منصة تانية', values: { name: '', conn: isAi ? 'MCP' : 'API', key: '', url: '', desc: '' },
      note: U.InlineNote({ children: isAi ? 'سيرفر MCP: السيستم بيتصل بيه بلينك وتوكن وبيستعمل أدواته (زي Higgsfield). أداة بـ API: المفتاح بيتحفظ في الخزنة.' : 'المفتاح بيتحفظ مشفّر في الخزنة ومابيظهرش تاني.' }),
      fields: (f, e, set) => [K.field.text('name', 'اسم الأداة', f, e, set, { required: true, maxlength: 60, placeholder: isAi ? 'مثلاً: Higgsfield' : 'مثلاً: Runway' }),
        K.Radios({ label: 'طريقة الربط', name: 'integ-conn', value: f.conn, required: true, options: [{ value: 'MCP', label: 'MCP', hint: 'سيرفر MCP — لينك + توكن' }, { value: 'API', label: 'API Key', hint: 'مفتاح من حساب الأداة' }, { value: 'OAuth', label: 'OAuth', hint: 'بيتسجل بس — الربط من الأداة' }], onChange: (v) => set('conn', v, true) }),
        f.conn === 'MCP' || f.conn === 'OAuth' ? K.field.text('url', f.conn === 'MCP' ? 'لينك سيرفر MCP' : 'رابط الأداة', f, e, set, { required: f.conn === 'MCP', dir: 'ltr', placeholder: 'https://…' }) : null,
        K.field.text('key', f.conn === 'MCP' ? 'التوكن (اختياري)' : 'مفتاح API', f, e, set, { required: f.conn === 'API', dir: 'ltr', type: 'password' }),
        U.Textarea({ id: 'integ-desc', label: 'بتستعمله في إيه؟', value: f.desc, rows: 2, placeholder: 'اختياري — يظهر تحت اسم الأداة', onInput: (v) => set('desc', v) })],
      validate: (f) => { const e = K.req(f, ['name']); if (f.conn === 'MCP' && !/^https:\/\/.+/.test(String(f.url || ''))) e.url = 'اكتب لينك السيرفر كامل بـ https://'; if (f.conn === 'API' && !String(f.key || '').trim()) e.key = 'اكتب المفتاح'; return e; },
      submitLabel: 'ربط واختبار', submit: async (f, md) => {
        const slug = String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || Date.now().toString(36); const base = /^[a-z0-9]/.test(slug) ? slug : 'x' + slug;
        const secret = f.conn === 'MCP' ? 'mcp_' + base : 'custom_' + base;
        const fields = f.conn === 'MCP' ? { name: f.name.trim(), url: f.url.trim(), ...(f.key ? { token: f.key.trim() } : {}) } : { name: f.name.trim(), conn: f.conn, ...(f.key ? { key: f.key.trim() } : {}), ...(f.url ? { url: f.url.trim() } : {}), ...(f.desc ? { desc: f.desc.trim() } : {}) };
        const r = await SETT().setSecret(secret, fields); if (!r.ok) { K.toast(r.message || 'تعذّر الربط', 'error'); return; } md.close(); K.toast(r.test ? (r.test.ok ? 'اتربطت ' + f.name.trim() + (r.test.account ? ' · ' + r.test.account : '') : 'اتحفظت بس الاختبار فشل') : 'اتحفظت ' + f.name.trim(), r.test && r.test.ok === false ? 'error' : 'success'); st.itab = kind; loadLinks(true); } });
  }
  function wooPage() {
    const p = C.integrations.find((x) => x.id === 'woo') || { name: 'WooCommerce', status: 'غير متصل', link: null }; const link = p.link; const F = link && link.fields ? link.fields : {};
    const f = st.wooDraft || (st.wooDraft = { url: F.url || '', ck: '', cs: '', wp_user: F.wp_user || '', wp_app_password: '', push: F.push === true || F.push === '1' });
    const txt = (k, label, opts) => U.TextInput(Object.assign({ id: 'w-' + k, label, value: f[k], dir: 'ltr', onInput: (v) => { f[k] = v; } }, opts || {}));
    const probe = st.wooProbe;
    const run = async (confirm) => {
      const fields = {}; Object.keys(f).forEach((k) => { if (f[k] !== '' && f[k] != null) fields[k] = typeof f[k] === 'boolean' ? f[k] : String(f[k]); });
      st.wooBusy = true; R(); const r = await SETT().wooSet(fields, confirm); st.wooBusy = false;
      if (!r.ok) { st.wooProbe = { ok: false, error: r.message || r.reason }; R(); K.toast(r.message || 'الاتصال فشل', 'error'); return; }
      if (!confirm) { st.wooProbe = Object.assign({ ok: true }, r.body && r.body.probe ? r.body.probe : {}); R(); K.toast('الاتصال نجح — أكّد الحفظ'); return; }
      st.wooProbe = null; st.wooDraft = null; K.toast('اتحفظت مفاتيح الموقع', 'success'); LOGV('settings.integration.connect', 'WooCommerce'); loadLinks(true); R();
    };
    return [h('div', { class: 'toolbar' }, Button({ type: 'text', label: '‹ الربط بالمنصات', onClick: () => { st.integ = null; st.wooDraft = null; st.wooProbe = null; R(); } }), h('b', null, 'WooCommerce'), K.Tag(tagFor(p.status), p.status)),
      K.Section('الاتصال', [K.two(txt('url', 'رابط المتجر', { required: true, placeholder: 'https://ibtekr.club' }), txt('ck', 'Consumer key', { type: 'password', placeholder: F.ck ? 'محفوظ (' + F.ck + ') — سيبه فاضي لو مش هتغيّره' : 'ck_…' })),
        K.two(txt('cs', 'Consumer secret', { type: 'password', placeholder: F.cs ? 'محفوظ (' + F.cs + ')' : 'cs_…' }), txt('wp_user', 'مستخدم WordPress (رفع الصور)', { placeholder: 'اختياري' })),
        K.two(txt('wp_app_password', 'باسورد التطبيق (WordPress)', { type: 'password', placeholder: F.wp_app_password ? 'محفوظ (' + F.wp_app_password + ')' : 'xxxx xxxx xxxx xxxx' }), h('div', { style: 'padding-top:26px' }, K.Switch({ id: 'w-push', label: 'السماح بالكتابة على الموقع', hint: 'الحالات والمنتجات وبيانات المتجر — مقفول = قراءة بس', checked: !!f.push, onChange: (v) => { f.push = v; R(); } }))),
        probe ? U.InlineNote({ kind: probe.ok ? 'success' : 'error', children: probe.ok ? 'الاتصال نجح' + (probe.account ? ' · ' + probe.account : '') + ' — اضغط «احفظ المفاتيح» عشان تتحفظ.' : 'الاتصال فشل: ' + (probe.error || '—') }) : null,
        h('div', { class: 'acts-inline start' }, Button({ size: 'sm', label: 'اختبار الاتصال', disabled: !!st.wooBusy, attrs: { 'data-woo-test': '' }, onClick: () => run(false) }), Button({ type: 'primary', size: 'sm', label: 'احفظ المفاتيح', disabled: !!st.wooBusy || !probe || !probe.ok, attrs: { 'data-woo-save': '' }, onClick: () => run(true) }),
          link && link.ready ? Button({ type: 'danger', size: 'sm', label: 'فصل الموقع', onClick: () => disconnect(p) }) : null)], null, { sub: 'المفاتيح من WooCommerce › الإعدادات › متقدم › REST API (قراءة/كتابة) — بتتجرب الأول وبتتحفظ في الخزنة بعد التأكيد · تغيير رابط الموقع بيشيل المفاتيح القديمة' }),
      K.Section('خريطة الحالات', U.Table({ headers: ['حالة WooCommerce', 'حالة السيستم', 'الاتجاه'], rows: C.orderStatuses.map((s) => [h('code', { dir: 'ltr' }, s[2]), K.Tag(s[1], s[0]), '⇄']) }), null, { sub: 'الخريطة ثابتة في السيستم (status_map) — عرض بس' })];
  }
  function setIntegration() { loadLinks(true); }

  // ---------- the activity log (decision 18) ----------
  const ACT_PAGES = [['', 'الصفحة: الكل'], ['auth', 'الدخول'], ['dashboard', 'لوحة التحكم'], ['order', 'الأوردرات'], ['vendor', 'المبتكرين'], ['accounts', 'الحسابات'], ['product', 'المنتجات'], ['cs', 'خدمة العملاء'], ['inventory', 'المخزون'], ['ticket', 'تذاكر الفريق'], ['hr', 'الموارد البشرية'], ['mkt', 'التسويق'], ['settings', 'الإعدادات'], ['profile', 'ملفي']];
  const AF = () => (st.act = st.act || { actor: '', prefix: '', from: '', to: '', page: 0, rows: null, more: false, loading: false, key: '' });
  async function loadActivity() {
    const a = AF(); const key = JSON.stringify([a.actor, a.prefix, a.from, a.to, a.page]); if (a.key === key && a.rows) return; a.key = key; a.loading = true; R();
    const r = await SETT().activity({ actor: a.actor || undefined, prefix: a.prefix || undefined, from: a.from || undefined, to: a.to || undefined, page: a.page });
    if (a.key !== key) return; a.loading = false; a.rows = r.ok ? r.rows : []; a.more = !!(r.ok && r.more); if (!r.ok) K.toast(r.message || 'تعذّر قراية السجل', 'error'); R();
  }
  const fmtAt = (iso) => { const d = new Date(iso); if (isNaN(d)) return '—'; return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); };
  const valText = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.join('، ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => k + ': ' + (typeof x === 'object' ? JSON.stringify(x) : x)).join(' · ') : String(v)).slice(0, 160);
  function activity() {
    const a = AF(); if (a.rows === null && !a.loading) loadActivity();
    const members = S.members.slice().sort((x, y) => x.name.localeCompare(y.name, 'ar'));
    const sel = (id, label, value, opts, on) => U.Select({ id, label: '', options: opts.map(([v, l]) => ({ value: v, label: l })), value, onChange: (v) => { on(v); a.page = 0; a.rows = null; loadActivity(); } });
    const date = (id, k, label) => U.DateField({ id, label: '', placeholder: label, value: a[k], today: K.TODAY, onChange: (v) => { a[k] = v || ''; a.page = 0; a.rows = null; loadActivity(); } });
    const rows = (a.rows || []).map((r) => [h('span', { class: 't-small', dir: 'ltr' }, fmtAt(r.at)), r.actorName, r.page, h('code', { dir: 'ltr' }, r.action), h('span', { class: 'wrap t-small' }, [r.entityId ? r.entity + ' ' + r.entityId : r.entity, valText(r.oldValue) && valText(r.newValue) ? valText(r.oldValue) + ' ← ' + valText(r.newValue) : valText(r.newValue) || valText(r.oldValue)].filter(Boolean).join(' · '))]);
    const csv = () => { const lines = [['الوقت', 'العضو', 'الصفحة', 'الإجراء', 'التفاصيل']].concat((a.rows || []).map((r) => [r.at, r.actorName, r.page, r.action, [r.entity, r.entityId, valText(r.oldValue), valText(r.newValue)].filter(Boolean).join(' · ')])); const esc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; K.saveFile('activity-' + K.TODAY + '.csv', new Blob(['﻿' + lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })); LOGV('settings.activity.export', (a.rows || []).length + ' صف'); };
    return [K.Section('سجل النشاط', [h('div', { class: 'toolbar act-bar' }, sel('ac-m', 'العضو', a.actor, [['', 'العضو: الكل']].concat(members.map((m) => [m.uid, m.name])), (v) => { a.actor = v; }), sel('ac-p', 'الصفحة', a.prefix, ACT_PAGES, (v) => { a.prefix = v; }), date('ac-from', 'from', 'من'), date('ac-to', 'to', 'إلى'), h('span', { class: 'grow' }), Button({ size: 'sm', type: 'text', label: 'CSV', icon: 'download', disabled: !(a.rows && a.rows.length), onClick: csv })),
      a.loading && !a.rows ? h('p', { class: 't-small help' }, 'بنحمّل…') : rows.length ? U.Table({ cls: 'act-tbl', headers: ['الوقت', 'العضو', 'الصفحة', 'الإجراء', 'التفاصيل'], rows }) : K.Empty('مفيش أحداث بالفلاتر دي', 'غيّر الفلاتر أو الفترة.'),
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', label: '‹ الأحدث', disabled: !a.page, onClick: () => { a.page = Math.max(0, a.page - 1); a.rows = null; loadActivity(); } }), h('span', { class: 't-small help' }, 'صفحة ' + (a.page + 1) + (a.rows ? ' · ' + a.rows.length + ' حدث' : '')), Button({ size: 'sm', label: 'الأقدم ›', disabled: !a.more, onClick: () => { a.page += 1; a.rows = null; loadActivity(); } }))],
      null, { sub: 'كل كتابة في السيستم بتتسجل بالعضو والصفحة والإجراء — 100 حدث في الصفحة · الأرقام والنصوص الحساسة مش بتتسجل' }),
      K.Section('إعدادات السجل', [row('تسجيل عمليات العرض للبيانات الحساسة', 'مين شاف رقم هاتف عميل أو حساب بنكي لمبتكر — بيتسجل دايمًا (الكشف بيتسجل في السيرفر)', C.actSet.sensitiveViews !== false, (v) => { C.actSet.sensitiveViews = v; }), row('تنبيه عند تغيير صلاحيات أو أدوار', 'يروح للأدمن في الجرس فورًا', C.actSet.permAlert !== false, (v) => { C.actSet.permAlert = v; })], null, { sub: 'الاحتفاظ بالسجل من «البيانات»' })];
  }

  // ---------- the security section (decision 19): my sessions + the company policies ----------
  async function loadSessions() { if (st.sessLoading) return; st.sessLoading = true; const r = await SETT().sessions(); st.sessLoading = false; st.sessions = r.ok ? r.sessions : []; if (!r.ok) K.toast(r.message || 'تعذّر قراية الجلسات', 'error'); R(); }
  function security() {
    const s = C.security; const me = K.member(K.ME) || { name: '', twofa: false };
    if (!st.sessions && !st.sessLoading) loadSessions();
    const sess = st.sessions || [];
    return [K.Section('حسابي', [vrow('كلمة السر والتحقق بخطوتين', (me.twofa ? 'التحقق بخطوتين مفعّل' : 'التحقق بخطوتين مش مفعّل') + ' — التغيير من «ملفي › الحساب والأمان»', Button({ size: 'sm', label: 'افتح ملفي', onClick: () => { location.hash = 'profile-security'; } }))], null, { sub: 'كلمة السر بتتغير من ملفك وبيتعمل خروج من الأجهزة التانية' }),
      K.Section('الجلسات النشطة', st.sessLoading && !st.sessions ? h('p', { class: 't-small help' }, 'بنحمّل…') : U.Table({ headers: ['الجهاز', 'IP', 'آخر نشاط', 'الحالة', ''], rows: sess.map((x) => [x.device, h('span', { dir: 'ltr' }, x.ip || '—'), h('span', { dir: 'ltr' }, fmtAt(x.refreshedAt)), K.Tag(x.current ? 'brand' : 'success', x.current ? 'الجلسة الحالية' : (x.aal === 'aal2' ? 'نشطة · 2FA' : 'نشطة')), x.current ? '—' : Button({ type: 'text', size: 'sm', label: 'خروج', attrs: { 'data-sess-out': x.id }, onClick: async () => { const r = await SETT().revokeSession(x.id); if (!r.ok) return fail(r, 'الخروج'); K.toast('اتعمل خروج من ' + x.device); st.sessions = null; loadSessions(); } })]) }),
        [Button({ label: 'خروج من كل الأجهزة الأخرى', attrs: { 'data-sess-others': '' }, onClick: () => K.confirm({ title: 'خروج من كل الأجهزة الأخرى؟', text: 'الجلسة دي هتفضل شغالة.', okLabel: 'خروج', onOk: async () => { const A = window.IBAuth; if (A && A.signOutOthers) { await A.signOutOthers(); } K.toast('اتعمل خروج من الأجهزة التانية'); st.sessions = null; loadSessions(); } }) })], { sub: 'جلساتك انت بس — جلسات الأعضاء بتتقفل بإيقاف العضو من الفريق' }),
      K.Section('سياسات الشركة (أدمن)', [row('إلزام التحقق بخطوتين لكل الأعضاء', 'لو اتفعّل: العضو اللي من غير 2FA بيتحوّل لشاشة التفعيل في أول دخول ومايعدّيش', !!s.force2fa, (v) => { s.force2fa = v; }), row('انتهاء الجلسة بعد عدم النشاط', 'تحذير قبلها بدقيقة ثم خروج تلقائي', s.idle !== false, (v) => { s.idle = v; }),
        h('div', { class: 'grid3' }, pick(s, 'pwMin', 'sp-pw', 'الحد الأدنى لكلمة السر', ['8 أحرف + رقم', '8 أحرف + رقم + رمز']), pick(s, 'idleDesktop', 'sp-id', 'انتهاء الجلسة (ديسكتوب)', ['4 ساعات', '8 ساعات (تحذير قبلها بدقيقة)', '12 ساعة']), pick(s, 'idleMobile', 'sp-im', 'انتهاء الجلسة (موبايل)', ['1 يوم', '7 أيام', '30 يوم'])),
        vrow('قفل الحساب بعد 5 محاولات غلط', 'ثابت في Supabase Auth', K.Tag('neutral', 'ثابت')), vrow('تقييد الدخول من IP محددة', 'مش متاح في الخطة الحالية', K.Tag('neutral', 'مش متاح')),
        vrow('تجربة: تحذير انتهاء الجلسة', 'يعرض التحذير اللي بيظهر قبل الخروج التلقائي بدقيقة', Button({ size: 'sm', label: 'اعرض التحذير', onClick: () => window.IBShell.sessionWarning() }))], null, { sub: 'بتُطبَّق على كل الأعضاء مع الدخول الجاي' })];
  }

  // ---------- the company papers (decision 20) ----------
  async function loadDocs() { if (!isAdminMe()) return; const r = await SETT().docs(); if (!r.ok) return; C.docs.splice(0, C.docs.length, ...r.docs.map((d) => ({ id: d.id, name: d.name, type: d.type, no: d.docNo, issued: d.issued || '', expires: d.expires || '', file: d.path.split('/').pop(), size: d.size ? Math.max(1, Math.round(d.size / 1024)) + 'KB' : '—', notes: d.notes, at: String(d.createdAt).slice(0, 10), path: d.path, mime: d.mime }))); if (window.IBPages.current === 'settings') R(); }
  function editDoc(x) {
    const isNew = !x; let file = null;
    K.form({ title: isNew ? 'رفع ورقة رسمية' : 'تعديل «' + x.name + '»', submitLabel: isNew ? 'احفظ الورقة' : 'احفظ',
      values: x ? { name: x.name, type: x.type, no: x.no || '', issued: x.issued || '', expires: x.expires || '', notes: x.notes || '', file: x.file } : { name: '', type: 'السجل التجاري', no: '', issued: '', expires: '', notes: '', file: '' },
      fields: (f, e, set) => [isNew ? (() => { const inp = h('input', { type: 'file', class: 'sr-file', id: 'doc-up', accept: 'application/pdf,image/png,image/jpeg,image/webp', onChange: () => { const fl = inp.files[0]; if (!fl) return; file = fl; if (!f.name) set('name', fl.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')); set('file', fl.name, true); } });
          return h('div', null, h('label', { class: 'drop' + (e.file ? ' err' : ''), for: 'doc-up', tabindex: '0', role: 'button', 'data-doc-drop': '', onKeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); inp.click(); } } }, Icon('upload'), h('b', null, f.file || 'ارفع الملف'), h('small', null, 'PDF أو صورة · لحد 20MB'), inp), e.file ? h('div', { class: 'err-msg', role: 'alert' }, e.file) : null); })() : h('div', { class: 'file-row', 'data-doc-file': '' }, Icon('file', 'sm'), h('b', { dir: 'auto' }, x.file), h('small', { class: 'help' }, x.size)),
        K.field.text('name', 'اسم الملف', f, e, set, { required: true, help: 'الاسم اللي هتدوّر بيه بعدين — مثلًا «السجل التجاري 2027»' }),
        K.two(K.field.select('type', 'النوع', DOC_TYPES, f, e, set, { required: true }), K.field.text('no', 'رقم الورقة', f, e, set, { dir: 'ltr' })),
        K.two(U.DateField({ id: 'doc-is', label: 'تاريخ الإصدار', value: f.issued, today: TODAY_S, onChange: (v) => set('issued', v, true) }), U.DateField({ id: 'doc-ex', label: 'تاريخ الانتهاء', value: f.expires, today: TODAY_S, error: e.expires, onChange: (v) => set('expires', v, true), help: 'سيبه فاضي لو مالهاش انتهاء — هننبّهك قبلها بـ 30 يوم' })),
        K.field.area('notes', 'ملاحظات', f, e, set, { rows: 2 })],
      validate: (f) => Object.assign(K.req(f, ['name', 'type']), isNew && !file ? { file: 'ارفع الملف' } : {}, f.issued && f.expires && f.expires < f.issued ? { expires: 'تاريخ الانتهاء قبل الإصدار' } : {}),
      submit: async (f, md) => { const meta = { name: f.name, type: f.type, docNo: f.no, issued: f.issued || null, expires: f.expires || null, notes: f.notes }; const r = isNew ? await SETT().addDoc(file, meta) : await SETT().updateDoc(x.id, meta); if (!r.ok) return fail(r, 'حفظ الورقة'); md.close(); K.toast(isNew ? 'اتحفظت «' + f.name.trim() + '»' : 'اتحفظ', 'success'); loadDocs(); } });
  }
  function docsSec() {
    const q = (st.dq || '').trim(); const tp = st.dtype || 'all';
    const list = C.docs.filter((x) => (tp === 'all' || x.type === tp) && (!q || [x.name, x.type, x.no, x.file, x.notes].some((v) => v && String(v).includes(q))));
    const soon = C.docs.filter((x) => x.expires && daysTo(x.expires) <= 30);
    const search = h('input', { type: 'search', class: 'input', id: 'doc-q', placeholder: 'دوّر باسم الملف أو النوع أو الرقم', 'aria-label': 'بحث في الأوراق', value: st.dq || '' });
    search.addEventListener('input', () => { st.dq = search.value; R(); setTimeout(() => { const s = document.getElementById('doc-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    const types = ['all'].concat(DOC_TYPES.filter((t) => C.docs.some((x) => x.type === t)));
    const open = async (x) => { const r = await SETT().docUrl(x.id); if (!r.ok) return fail(r, 'فتح الملف'); window.open(r.url, '_blank', 'noopener'); };
    const rows = list.map((x) => { const s = docState(x); return [h('span', { class: 'doc-n' }, Icon('file', 'sm'), h('span', null, h('b', null, x.name), h('small', { class: 'help', dir: 'ltr' }, x.file + ' · ' + x.size))), x.type, x.no ? K.Num(x.no) : '—', K.Num(fmtD(x.expires)), K.Tag(s[0], s[1]),
      K.RowMenu([{ label: 'عرض / تنزيل', icon: 'eye', run: () => open(x) }, { label: 'تعديل', icon: 'edit', run: () => editDoc(x) }, { label: 'حذف', danger: true, run: () => K.confirm({ title: 'تحذف «' + x.name + '»؟', text: 'الملف هيتمسح من الخزنة.', okType: 'danger', okLabel: 'حذف', onOk: async () => { const r = await SETT().removeDoc(x.id); if (!r.ok) return fail(r, 'الحذف'); K.toast('اتحذفت «' + x.name + '»'); loadDocs(); } }) }], 'إجراءات ' + x.name)]; });
    return [soon.length ? U.InlineNote({ kind: soon.some((x) => daysTo(x.expires) < 0) ? 'error' : 'warning', children: soon.map((x) => '«' + x.name + '» ' + docState(x)[1]).join(' · ') + ' — جدّدها وارفع النسخة الجديدة.' }) : null,
      K.Section('الأوراق الرسمية', [h('div', { class: 'toolbar doc-bar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), search), U.Select({ id: 'doc-type', label: '', options: types.map((t) => ({ value: t, label: t === 'all' ? 'النوع: الكل' : 'النوع: ' + t })), value: tp, onChange: (v) => { st.dtype = v; R(); } })),
        list.length ? U.Table({ cls: 'doc-tbl', headers: ['الملف', 'النوع', 'الرقم', 'الانتهاء', 'الحالة', ''], rows }) : K.Empty(q || tp !== 'all' ? 'مفيش ورقة بالاسم ده' : 'لسه مفيش أوراق', q || tp !== 'all' ? 'جرّب اسم تاني أو امسح البحث.' : 'ارفع السجل التجاري والبطاقة الضريبية عشان تلاقيهم هنا.')],
        Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'رفع ورقة', attrs: { 'data-doc-add': '' }, onClick: () => editDoc() }), { sub: C.docs.length + ' ورقة · للأدمن بس · العرض بلينك موقّع 60 ثانية وبيتسجل · التنبيه قبل الانتهاء بـ 30 يوم من المحرك' })];
  }

  // ---------- the logos (decision 21): bucket settings, every member reads them by a signed link ----------
  function logoSlot([tone, label, use, bg, mark]) {
    const cur = window.IBLogo.get(tone); const id = 'logo-up-' + tone;
    const inp = h('input', { type: 'file', class: 'sr-file', id, accept: 'image/svg+xml,image/png,image/webp', onChange: async () => { const f = inp.files[0]; if (!f) return;
      if (!/^image\/(svg\+xml|png|webp)$/.test(f.type)) { K.toast('ارفع SVG أو PNG أو WebP', 'error'); return; } if (f.size > 2 * 1024 * 1024) { K.toast('الصورة أكبر من 2MB — صغّرها الأول', 'error'); return; }
      const r = await SETT().uploadLogo(tone, f); if (!r.ok) return fail(r, 'رفع اللوجو'); const url = await SETT().logoUrl(r.path); window.IBLogo.set(tone, url); LOGV('settings.brand.logo', label); K.toast('اتغيّر ' + label, 'success'); R(); } });
    return h('div', { class: 'logo-slot', 'data-logo-slot': tone }, h('div', { class: 'logo-pv ' + bg }, window.IBLogo.Logo({ tone: mark ? 'color' : tone, width: mark ? 56 : 170, mark })),
      h('div', { class: 'logo-meta' }, h('b', null, label), h('small', { class: 'help' }, use), cur ? K.Tag('gold', 'مرفوع') : K.Tag('neutral', 'الأصلي')),
      h('div', { class: 'acts-inline start' }, h('label', { class: 'btn btn-default sm', for: id, tabindex: '0', role: 'button', 'data-logo-up': tone, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, Icon('upload', 'sm'), h('span', null, cur ? 'غيّر الصورة' : 'ارفع صورة')), inp,
        cur ? Button({ type: 'text', size: 'sm', label: 'رجّع الأصلي', attrs: { 'data-logo-reset': tone }, onClick: async () => { const logos = Object.assign({}, (SETT().section('brand') || {}).logos || {}); delete logos[tone]; const r = await SETT().save('brand', { logos }); if (!r.ok) return fail(r, 'الحفظ'); window.IBLogo.set(tone, null); LOGV('settings.brand.logo', label + ' · الأصلي'); K.toast('رجع اللوجو الأصلي'); R(); } }) : null));
  }

  // ---------- the AI providers (decision 14): the defaults per section and per tool, from the row «ai» ----------
  const PROV = { text: { label: 'المحتوى (النصوص)', options: [['claude', 'Claude (Anthropic)'], ['openai', 'ChatGPT (OpenAI)'], ['gemini', 'Gemini (Google)']], tools: [['products', 'المنتجات والاستوديو'], ['marketing', 'التسويق'], ['buyer', 'الميديا باير']] },
    image: { label: 'الصور', options: [['magnific', 'Magnific (كريدت)'], ['openai', 'OpenAI gpt-image'], ['gemini', 'Gemini Nano Banana']], tools: [['studio', 'استوديو المنتجات'], ['campaign', 'كامبينات التسويق'], ['tool', 'أداة الصور']] },
    voice: { label: 'الصوت', options: [['magnific', 'Magnific (ElevenLabs عبر الجسر)'], ['elevenlabs', 'ElevenLabs مباشر']], tools: [] },
    video: { label: 'الفيديو', options: [['magnific', 'Magnific (Seedance / Kling عبر الجسر)'], ['higgsfield', 'Higgsfield (MCP)'], ['veo', 'Google Veo (بمفتاح Gemini)']], tools: [] } };
  function providersSec() {
    const ai = SETT().section('ai') || {}; const P = ai.providers && typeof ai.providers === 'object' ? JSON.parse(JSON.stringify(ai.providers)) : {};
    const get = (k) => (P[k] && typeof P[k] === 'object' ? P[k] : (P[k] = {}));
    const save = async () => { const r = await SETT().save('ai', { providers: P }); if (!r.ok) return fail(r, 'حفظ المزوّدين'); LOGV('settings.ai.providers', Object.keys(P).map((k) => k + '=' + (P[k].default || 'default')).join(' · ')); K.toast('اتحفظ المزوّد', 'success'); R(); };
    const sel = (id, label, value, options, on, help) => U.Select({ id, label, help, options: options.map(([v, l]) => ({ value: v, label: l })), value: value || options[0][0], onChange: (v) => { on(v); save(); } });
    const blocks = Object.keys(PROV).map((k) => { const d = PROV[k]; const cur = get(k); const opts = [['', 'الافتراضي للقسم']].concat(d.options);
      return h('div', { class: 'prov-block', 'data-prov': k }, K.two(sel('prov-' + k, d.label + ' — المزوّد الافتراضي', cur.default, d.options, (v) => { cur.default = v; }), d.tools.length ? h('div', { class: 'prov-tools' }, d.tools.map(([t, tl]) => sel('prov-' + k + '-' + t, tl, (cur.tools || {})[t] || '', opts, (v) => { cur.tools = cur.tools || {}; if (v) cur.tools[t] = v; else delete cur.tools[t]; }))) : h('div', null))); });
    return K.Section('مزوّدي الذكاء الاصطناعي', [U.InlineNote({ children: 'المفاتيح من «الربط بالمنصات › الذكاء الاصطناعي» — المزوّد اللي مالوش مفتاح بيرجّع «اربطه من الإعدادات». Magnific بالكريدت، والباقي بالدولار على سقف المحتوى الشهري.' }), ...blocks], null, { sub: 'افتراضي لكل قسم + تبديل لكل أداة (قرار صاحب المشروع، 7 نوفمبر)' });
  }
  function aiSec() { return [providersSec()].concat(aiSecV6()); }

  // ---------- the lists (decision 8; phase 12 T3 decision 10): the statuses are the system's (a view); the cancel / return reasons are saved ----------
  // The statuses stay read-only on purpose: accounts_sales, products_report, order_delete, the auto-reply engine and the reports read them
  // by name — a rename from the page would break those quietly. The reasons live in the settings row «lists» (IBSettings.saveLists) and the
  // orders page's cancel / return popups read them (block 22); «أخرى» is always last and cannot go.
  const REASON_LISTS = { cancel: 'أسباب الإلغاء والمسح', returns: 'أسباب المرتجع' };
  function reasonsSec(k) {
    const S0 = SETT(); const L = S0 && S0.lists ? S0.lists() : { cancel: [], returns: [] }; const items = L[k] || [];
    const saveWith = async (next) => { const r = await S0.saveLists(Object.assign({}, L, { [k]: next })); if (!r.ok) return fail(r, 'حفظ الأسباب'); LOGV('settings.lists.save', k + ' = ' + next.length); K.toast('اتحفظت الأسباب', 'success'); R(); };
    const rows = items.map((x, i) => [h('span', { 'data-reason': x }, x), x === 'أخرى' ? K.Tag('neutral', 'ثابت — بيفتح خانة نص') : K.RowMenu([
      { label: 'تعديل', icon: 'sliders', run: () => K.form({ title: 'تعديل السبب', values: { v: x }, fields: (f, e, set) => [K.field.text('v', 'السبب', f, e, set, { required: true, maxlength: 60 })], validate: (f) => K.req(f, ['v']), submitLabel: 'حفظ', submit: (f) => { const next = items.filter((y) => y !== 'أخرى'); next[i] = f.v.trim(); saveWith(next); } }) },
      i > 0 ? { label: 'تحريك لفوق', icon: 'chevD', run: () => { const next = items.filter((y) => y !== 'أخرى'); [next[i - 1], next[i]] = [next[i], next[i - 1]]; saveWith(next); } } : null,
      { label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف «' + x + '»', text: 'السبب مش هيظهر في بوب أب الأوردرات الجديدة؛ الأوردرات اللي اتسجلت بيه بتفضل زي ما هي.', okType: 'danger', okLabel: 'حذف', onOk: () => saveWith(items.filter((y, j) => j !== i && y !== 'أخرى')) }) }].filter(Boolean))]);
    return K.Section(REASON_LISTS[k], U.Table({ headers: ['السبب', ''], rows }), isAdminMe() ? [Button({ label: '+ سبب', attrs: { 'data-reason-add': k }, onClick: () => K.form({ title: 'سبب جديد', values: { v: '' }, fields: (f, e, set) => [K.field.text('v', 'السبب', f, e, set, { required: true, maxlength: 60 })], validate: (f) => K.req(f, ['v']), submitLabel: 'إضافة', submit: (f) => { saveWith(items.filter((y) => y !== 'أخرى').concat([f.v.trim()])); } }) })] : null,
      { sub: k === 'cancel' ? 'بتظهر في بوب أب «إلغاء» الأوردر (الملغي بيتسجل بسببه في تقرير «أوردرات ملغية») — «أخرى» بتفتح خانة نص إجبارية' : 'بتظهر في بوب أب «استرجاع» الأوردر و«مرتجع للمخزن / للمبتكر» للفرعي — «أخرى» بتفتح خانة نص إجبارية' });
  }
  function lists() {
    const L = C.otherLists; const tabs = [{ id: 'order', label: 'حالات الأوردر' }, { id: 'confirm', label: 'حالات التأكيد' }, { id: 'sub', label: 'حالات الأوردر الفرعي' }, { id: 'cancel', label: 'أسباب الإلغاء والمسح' }, { id: 'returns', label: 'أسباب المرتجع' }, { id: 'expenses', label: 'أنواع المصروفات' }, { id: 'categories', label: 'فئات المبتكرين' }, { id: 'stop', label: 'أسباب إيقاف المبتكر' }, { id: 'priorities', label: 'الأولويات' }];
    const out = [K.SubTabs({ items: tabs, active: tabs.some((t) => t.id === st.list) ? st.list : 'order', onChange: (id) => { st.list = id; R(); }, label: 'القوائم' })]; const cur = tabs.some((t) => t.id === st.list) ? st.list : 'order';
    if (cur === 'order') out.push(K.Section('حالات الأوردر', U.Table({ headers: ['الاسم في السيستم', 'المعاينة', 'مقابل WooCommerce', 'النوع'], rows: C.orderStatuses.map((s) => [s[0], K.Tag(s[1], s[0]), h('code', { dir: 'ltr' }, s[2]), s[4]]) }), null, { sub: 'مربوطة بالموقع (status_map) وبقواعد الحسابات والتقارير والرد الآلي بالاسم — عرض بس' }));
    else if (cur === 'cancel' || cur === 'returns') out.push(reasonsSec(cur));
    else { const titles = Object.fromEntries(tabs.map((t) => [t.id, t.label])); const items = L[cur] || []; out.push(K.Section(titles[cur], U.Table({ headers: ['الاسم'], rows: items.map((x) => [x]) }))); }
    if (cur !== 'cancel' && cur !== 'returns') out.push(U.InlineNote({ children: 'القوايم دي ثابتة في السيستم (الحالات مربوطة بالموقع والتقارير، وأنواع المصروفات بقيود قاعدة البيانات) — عرض بس. أسباب الإلغاء والمرتجع هي اللي بتتعدل من هنا.' }));
    return out;
  }
  // ---------- the makers' defaults (decision 17): the row «makers» + the real rules of the makers ----------
  function loginBankSec(m) {
    const V = window.IBVendors; const all = V && V.store && V.store.all ? V.store.all() : []; const L0 = (v) => (v.login && v.login.status) || 'none'; const LS = { none: ['neutral', 'مفيش حساب'], invited: ['gold', 'مستني التفعيل'], active: ['success', 'مفعّل'], disabled: ['error', 'موقوف'], leave: ['gold', 'في إجازة'] };
    const bankOk = (v) => !!(v.bank && (v.bank.holder || v.bank.accountNumber || v.bank.iban || v.bank.wallet)); const done = all.filter((v) => L0(v) === 'active' && bankOk(v)).length;
    return K.Section('بيانات الدخول والحساب البنكي', [vrow('طريقة الباسورد', 'باسورد مؤقت بيظهر مرة واحدة — الطريقة الوحيدة (قرار 26 أكتوبر)', K.Tag('brand', 'باسورد مؤقت')),
      row('يغيّر الباسورد أول ما يدخل', 'إجباري للباسورد المؤقت', m.forceChange !== false, (v) => { m.forceChange = v; }), row('الحساب البنكي إجباري عند الإضافة', 'لو اتقفل: «الحسابات» تكمّله بعدين ويظهر «ناقص» في ملف المبتكر', m.bankRequired !== false, (v) => { m.bankRequired = v; }),
      h('div', { class: 'set-row' }, h('div', null, h('b', null, 'مكتمل ' + done + ' من ' + all.length + ' مبتكر'), h('div', { class: 't-small help' }, 'الناقص بيتكمّل من ملف كل مبتكر (بيانات الدخول + الحساب البنكي)'))),
      all.length ? h('div', { class: 'scroll-x' }, U.Table({ cls: 'mini-table mk-cover', headers: ['المبتكر', 'حساب الدخول', 'الحساب البنكي'], rows: all.slice(0, 200).map((v) => { const t = LS[L0(v)] || LS.none; return [v.name, K.Tag(t[0], t[1]), bankOk(v) ? K.Tag('success', 'موجود') : K.Tag('error', 'ناقص')]; }) })) : null], null, { sub: 'من ملفات المبتكرين الحقيقية' });
  }
  function delayRule(r) { K.toast(r ? 'مدة التصنيع بتتعدل من ملف المبتكر «' + r[0] + '»' : 'القاعدة الخاصة = مدة التصنيع في ملف المبتكر'); }
  function deactivateMaker() { location.hash = 'makers'; K.toast('إيقاف المبتكر من صفحة المبتكرين (قايمة المزيد)'); }
  function hydrateMakerRules() { const V = window.IBVendors; const all = V && V.store && V.store.all ? V.store.all() : []; const risk = Number(C.makers.risk) || 9, late = Number(C.makers.late) || 11; C.makerRules.splice(0, C.makerRules.length, ...all.filter((v) => v.status !== 'inactive').map((v) => [v.name, (v.leadDays || 7) + ' يوم', 'يوم ' + risk, 'يوم ' + late, v.leadDays && v.leadDays !== 7 ? 'مدخل يدويًا' : 'الافتراضي', '—'])); }
  function makers() { hydrateMakerRules(); return makersV6(); }

  window.IBPages.register('settings', { title: 'الإعدادات', adminOnly: true, hash: (hs) => { const m = /^settings(?:-([a-z]+))?$/.exec(hs); if (!m) return false; const target = m[1] && SECTIONS.some((s) => s[0] === m[1]) ? m[1] : 'home'; if (st.dirty && target !== st.sec) { setTimeout(() => leave(() => { st.sec = target; st.integ = null; try { history.replaceState(null, '', target === 'home' ? '#settings' : '#settings-' + target); } catch (e) { /* */ } R(); window.scrollTo(0, 0); }), 0); return true; } st.sec = target; return true; }, defaultHash: () => (st.sec === 'home' ? 'settings' : 'settings-' + st.sec), view, canLeave: (go) => leave(go), api: { aiRules: () => (S.aiRules = S.aiRules || AI_DEF()), reload: () => { hydrated = false; if (SETT()) SETT().load().then(() => { hydrateAll(); R(); }); }, hydrate: hydrateAll, exportData: (id, o) => exportDialog(DG().group(id), o), importData: (id, mode, o) => { const g = DG().group(id); importWizard(g, mode || modesOf(g)[0], o); }, templates: (id, mode, o) => { const g = DG().group(id); templateDialog(g, mode || modesOf(g)[0], o); }, setIntegration, memberChans: (id) => { const m = K.store.members.find((x) => x.id === id); if (m) memberChans(m); }, openSocial: () => { st.sec = 'integrations'; st.integ = null; st.itab = 'social'; R(); window.scrollTo(0, 0); }, openWa: () => { st.sec = 'integrations'; st.integ = 'wa'; R(); window.scrollTo(0, 0); }, addWa: () => { st.sec = 'integrations'; st.integ = 'wa'; R(); waEdit(); }, makerRules: () => C.makerRules, integrations: () => C.integrations, activityLog: () => C.activity, backup: () => C.backup, perms: () => C.perms, roles: () => liveNames(), roleIndex, rolePopup: (r) => rolePopup(r, roleIndex(r)), lists: listsMap, addListValue, removeListValue } });
})();

