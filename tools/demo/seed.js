// «نسخة التعليقات» — the data the copy opens with. The stand-in backend starts almost empty (every test seeds what it needs), so
// the owner could not see most of what his comments asked for without making the data himself first: an empty hub, no requests,
// no pay sheet, no campaign. This is one made-up set for every section — pieces in the hub with their products' pictures, a return
// waiting for its inspection, an order being gathered, requests, attendance / pay / evaluations, a maker's Dokan balance and
// withdrawal, a campaign in each step, trends, competitors, the site's updates and a week of ads. No real person, order or number:
// the same made-up makers, members and orders the tests use, with dates that follow today.
const V = (n) => 'a0000000-0000-4000-8000-00000000000' + n;            // the stand-in's makers: 1 Art Craft · 2 Antikiano · 3 Bian eg
const M = (n) => '00000000-0000-4000-8000-00000000000' + n;            // its members: 1 صفوت (admin) · 2 سارة · 3 محمد · 4 منى · 5 هدى
const LOT = (n) => 'b7000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const CAMP = (n) => 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const DEMO_SITE = 'https://ibtekr.stage.test';                 // the stand-in's made-up site (never reached)

const NOW = Date.now();
const iso = (daysAgo, hour = 10) => { const t = new Date(NOW - daysAgo * 864e5); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };
const cairoDay = (daysAgo = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW - daysAgo * 864e5));
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (mk, n) => { const t = new Date(mk + '-01T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 7); };
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
// a Cairo wall-clock time on a day, as the database keeps it
const cairoOffset = (d) => { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(new Date(d + 'T12:00:00Z')).find((x) => x.type === 'timeZoneName'); const m = /GMT([+-]\d+)/.exec(p ? p.value : ''); return m ? Number(m[1]) : 2; } catch (e) { return 2; } };
const at = (d, hm) => new Date(d + 'T' + hm + ':00+' + String(cairoOffset(d)).padStart(2, '0') + ':00').toISOString();
// the last n working days before today (Friday and Saturday off), newest first
const workdays = (n) => { const out = []; let d = cairoDay(0); while (out.length < n) { d = addDays(d, -1); if (dow(d) !== 5 && dow(d) !== 6) out.push(d); } return out; };

export function demoSeed() {
  const T = cairoDay(0); const MK = T.slice(0, 7); const PREV = addMonths(MK, -1); const days = workdays(9);

  // ---------------- the hub (المخزن): one piece of every reason, on products the mirror knows (so their pictures and links show)
  const lot = (n, o) => ({ id: LOT(n), mode: 'أمانة', condition: null, condition_note: null, note: null, product_id: null, order_id: null, item_id: null, ref: null, closed_at: null, created_by: null, ...o });
  const invLots = [
    lot(1, { reason: 'متاح للبيع', status: 'متاح', sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V(1), loc: 'T', cost: 650, since: cairoDay(20), created_at: iso(20) }),
    lot(2, { reason: 'تصوير', status: 'مستني تصوير', sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', vendor_id: V(2), loc: 'P', cost: 1500, since: cairoDay(6), created_at: iso(6) }),
    lot(3, { reason: 'مرتجع', status: 'بانتظار الفحص', sku: 'IBTK20035BBLM000003214', name: 'Boho mirror', vendor_id: V(3), loc: 'R', cost: 900, ref: '#181670', since: cairoDay(9), created_at: iso(9), note: 'العميل رفض الاستلام' }),
    lot(4, { reason: 'تجميع أوردر', status: 'وصل المخزن', sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V(1), loc: 'T', cost: 650, order_id: 181668, item_id: 5001, ref: 'IB-181668', since: cairoDay(2), created_at: iso(2) }),
    lot(5, { reason: 'متاح للبيع', status: 'متاح', sku: 'IBTB0CSW6RFTM', name: 'Macrame Feathers', vendor_id: V(2), loc: 'T', cost: 480, since: cairoDay(30), created_at: iso(30) }),
  ];
  const mv = (lotN, type, qty, label, reason, daysAgo, more) => ({ lot_id: LOT(lotN), type, qty, label, reason, at: iso(daysAgo), by: M(2), ...(more || {}) });
  const invMoves = [
    mv(1, 'in', 3, 'دخول — للبيع', 'متاح للبيع', 20), mv(1, 'out', 1, 'خروج', 'متاح للبيع', 12, { note: 'اتباع من المخزن' }),
    mv(2, 'in', 1, 'دخول — تصوير', 'تصوير', 6),
    mv(3, 'in', 1, 'دخول — مرتجع', 'مرتجع', 9, { ref: '#181670' }),
    mv(4, 'in', 2, 'دخول — تجميع', 'تجميع أوردر', 2, { ref: 'IB-181668' }),
    mv(5, 'in', 4, 'دخول — للبيع', 'متاح للبيع', 30), mv(5, 'adjust', -1, 'تسوية يدوية', 'تلف من التخزين', 15, { by: M(1), note: 'قطعة اتكسرت' }),
  ];

  // ---------------- team requests (طلبات الفريق): for every tab of «ملفي › طلباتي» and every group of the page's filter
  const tickets = [
    { id: 1, type: 'customer', title: 'العميلة مستنية الأوردر', description: 'اتصلت مرتين وبتسأل عن ميعاد التسليم', priority: 'high', assignee_role: 'الحسابات', order_number: '181668', order_id: 181668, customer: 'سلوى زيتوني', reason: 'تأخير في التسليم',
      follow_up: cairoDay(1), created_by: M(2), created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن', created_at: iso(2), last_update: iso(1) },
    { id: 2, type: 'internal', title: 'الكرتون خلص', description: 'محتاجين كرتون شحن مقاس وسط', priority: 'normal', assignee_role: 'اللوجستيك والشحن', assignee_member: M(3), assignee_member_name: 'محمد علي', status: 'in_progress', created_by: M(1), created_by_name: 'صفوت كمال', created_by_role: 'مدير النظام', created_at: iso(3), last_update: iso(1) },
    { id: 3, type: 'vendor', title: 'المبتكر مابيردش', description: 'بقاله 3 أيام مابيردش على الواتساب', priority: 'low', assignee_role: 'متابعة المبتكرين', vendor_id: V(1), vendor: 'Art Craft', reason: 'مش بيرد', status: 'resolved',
      resolution_outcome: 'اتحلت المشكلة', resolution_note: 'رد وأكّد ميعاد التسليم', resolved_by_name: 'هدى سمير', resolved_at: iso(1), created_by: M(2), created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن', created_at: iso(6), last_update: iso(1) },
    { id: 4, type: 'internal', title: 'مراجعة أسعار كولكشن الشتا', description: 'محتاجين موافقة على الأسعار الجديدة قبل النشر', priority: 'urgent', assignee_role: 'مدير النظام', created_by: M(4), created_by_name: 'منى حسن', created_by_role: 'الحسابات', created_at: iso(1), last_update: iso(1) },
    { id: 5, type: 'internal', title: 'تجهيز تصوير المنتجات الجديدة', description: 'خمس قطع مستنية تصوير في المخزن', priority: 'normal', assignee_role: 'اللوجستيك والشحن', status: 'waiting', created_by: M(1), created_by_name: 'صفوت كمال', created_by_role: 'مدير النظام', created_at: iso(4), last_update: iso(2) },
  ];
  const ticketEvents = [
    { ticket_id: 1, kind: 'event', at: iso(2), actor: M(2), actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'سارة أحمد أنشأ الطلب وعيّنه لدور «الحسابات»' },
    { ticket_id: 1, kind: 'message', at: iso(1), actor: M(2), actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'اتصلت تاني النهارده' },
    { ticket_id: 4, kind: 'event', at: iso(1), actor: M(4), actor_name: 'منى حسن', actor_role: 'الحسابات', text: 'منى حسن أنشأ الطلب وعيّنه لدور «مدير النظام»' },
  ];

  // ---------------- HR: nine working days of attendance, this month's sheet open with one member already paid, last month's paid,
  // and two months of evaluations (so the month / year lists, «مقارنة» and the pay popup's «اتحوّله مرتبه» case all have rows)
  const staff = [[M(2), '09:00', '17:10'], [M(3), '09:20', '17:00'], [M(4), '08:50', '17:30'], [M(5), '10:00', '18:00']];
  const hrAttendance = [];
  days.forEach((d, i) => staff.forEach(([id, a, b], k) => { if ((i + k) % 7 === 3) return; hrAttendance.push({ member_id: id, day: d, in_at: at(d, a), out_at: at(d, b), source: 'clock' }); }));
  const line = (name, salary, o) => ({ name, salary, holdback: Math.round(salary * 0.1), paid: salary - Math.round(salary * 0.1), ot_minutes: 0, ot_pay: 0, rest_days: 0, rest_pay: 0, unpaid_days: 0, unpaid_cut: 0, allowances: 0, deductions: 0, advance: 0, quarter_bonus: 0, net: salary - Math.round(salary * 0.1), ...(o || {}) });
  const hr = {
    hrMembers: [{ member_id: M(2), hire_date: '2024-05-12' }, { member_id: M(3), hire_date: '2025-01-05' }, { member_id: M(4), hire_date: '2024-09-01' }, { member_id: M(5), hire_date: '2025-06-15' }],
    hrPay: [{ member_id: M(2), salary: 12000, holdback: 1200, allowances: 500 }, { member_id: M(3), salary: 9000, holdback: 900, allowances: 0 }, { member_id: M(4), salary: 9600, holdback: 960, allowances: 0 }, { member_id: M(5), salary: 8000, holdback: 800, allowances: 300 }],
    hrAttendance,
    hrPayroll: [{ month: PREV + '-01', status: 'مدفوع', paid_at: PREV + '-28T10:00:00Z', paid_account: 'حساب البنك', total: 35340 }, { month: MK + '-01', status: 'مسودة' }],
    hrPayrollLines: [{ month: PREV + '-01', member_id: M(2), ...line('سارة أحمد', 12000, { allowances: 500, net: 11300 }) }, { month: PREV + '-01', member_id: M(3), ...line('محمد علي', 9000) },
      { month: PREV + '-01', member_id: M(4), ...line('منى حسن', 9600) }, { month: PREV + '-01', member_id: M(5), ...line('هدى سمير', 8000, { allowances: 300, net: 7500 }) }],
    hrPayrollPaid: [{ month: MK + '-01', member_id: M(4), amount: 8640, account: 'حساب البنك', early_reason: 'ظرف طارئ', paid_by: M(1), paid_at: iso(1) }],
    hrEvaluations: [{ member_id: M(2), month: MK + '-01', performance: 5, communication: 4, note: 'شغل منظم' }, { member_id: M(4), month: MK + '-01', performance: 4, communication: 4 },
      { member_id: M(2), month: PREV + '-01', performance: 4, communication: 4 }, { member_id: M(3), month: PREV + '-01', performance: 3, communication: 4 }, { member_id: M(4), month: PREV + '-01', performance: 2, communication: 3 }, { member_id: M(5), month: PREV + '-01', performance: 4, communication: 5 }],
  };

  // ---------------- the makers' accounts: Dokan's balance and withdrawals as the hourly sync mirrors them
  const dokan = {
    dokanBalances: [{ vendor_id: V(1), woo_vendor_id: 2376, balance: 4200, earning: 19000, sales: 26000, orders: 14, synced_at: iso(0, 8) }, { vendor_id: V(2), woo_vendor_id: 44, balance: 1850, earning: 9000, sales: 14500, orders: 7, synced_at: iso(0, 8) },
      { vendor_id: V(3), woo_vendor_id: 2047, balance: 0, earning: 1200, sales: 1800, orders: 1, synced_at: iso(0, 8) }],
    dokanWithdrawals: [{ id: 501, woo_vendor_id: 2376, vendor_id: V(1), amount: 4200, charge: 0, receivable: 4200, status: 'pending', method: 'bank', requested_at: cairoDay(1) + ' 12:00:00', synced_at: iso(0, 8) },
      { id: 470, woo_vendor_id: 44, vendor_id: V(2), amount: 2500, charge: 0, receivable: 2500, status: 'approved', method: 'bank', requested_at: cairoDay(20) + ' 12:00:00', synced_at: iso(0, 8) }],
  };

  // ---------------- marketing: a campaign in review (a post with a note on it, a carousel, a reel with three scenes), one ready to
  // publish, the designer's trends, the buyer's competitors, the developer's site check, and a week of Meta ads beside the orders
  const C1 = CAMP(1); const C2 = CAMP(2); const img = (c, n) => c + '/gen-' + n + '.png';
  const media = (o) => ({ video: { count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 1, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, ...(o || {}) });
  const piece = (o) => ({ size: '1080x1350', model: 'seedream-5-pro', idea: 'المخدة على كنبة بيج في ضوء الصبح', caption: 'دفا الشتا يبدأ من تفصيلة صغيرة 🤎', title: 'دفا الشتا', sub: 'كولكشن جديد', badge: 'جديد', ref: [], use: [], gen: 1, approved: false, ...o });
  const review = { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا: مخدات وستاير مكرمية بألوان دافية', mediaTab: 'post', media: media({ carousel: { count: 1, slides: 3, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, video: { count: 1, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] } }), extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [piece({ id: 'P1', kind: 'بوست', n: 1, img: img(C1, 'P1'), pins: [{ x: 40, y: 38, text: 'كبّر اللوجو شوية' }] }),
      piece({ id: 'C1', kind: 'كاروسيل', n: 1, img: img(C1, 'C1'), slides: [0, 1, 2].map((k) => ({ idea: 'تفصيلة ' + (k + 1) + ' من الخامة', title: 'شريحة ' + (k + 1), sub: '', badge: '', ref: [], use: [], img: img(C1, 'C1-' + k), approved: false })) }),
      { id: 'V1', kind: 'فيديو', n: 1, size: '9:16', model: 'seedance-2.5', dur: 15, res: '1080p', sceneCount: 3, method: 'separate', idea: 'المخدة من الكرتونة للكنبة', caption: 'من إيد المبتكر لبيتك', ref: [], use: [], gen: 1, approved: false, assembled: false, video: null, music: { src: 'none', type: '', file: '' }, voice: { mode: 'none', voice: 'm-eg-1', text: '', file: '' },
        scenes: [{ n: 1, d: 5, idea: 'الكرتونة بتتفتح', text: 'وصلت!', cam: 'ثابتة', img: img(C1, 'V1-s1'), ref: [], use: [] }, { n: 2, d: 5, idea: 'المخدة بتتحط على الكنبة', text: '', cam: 'حركة بطيئة', img: img(C1, 'V1-s2'), ref: [], use: [] }, { n: 3, d: 5, idea: 'القعدة كاملة في ضوء دافي', text: 'دفا الشتا', cam: 'ثابتة', img: img(C1, 'V1-s3'), ref: [], use: [] }] }],
    sched: {}, rtab: 'post' };
  const ready = { w: { goal: 'عرض', idea: 'عرض نهاية الأسبوع على المرايات', mediaTab: 'post', media: media({ post: { count: 2, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }), extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [piece({ id: 'P1', kind: 'بوست', n: 1, title: 'عرض المرايات', caption: 'خصم نهاية الأسبوع على كل المرايات', img: img(C2, 'P1'), approved: true }), piece({ id: 'P2', kind: 'بوست', n: 2, title: 'مراية بوهو', caption: 'المراية اللي بتغيّر شكل الأوضة', img: img(C2, 'P2'), approved: true })], sched: {}, rtab: 'post' };
  const mktObjects = {}; ['P1', 'C1', 'C1-0', 'C1-1', 'C1-2', 'V1-s1', 'V1-s2', 'V1-s3'].forEach((n) => { mktObjects[img(C1, n)] = { type: 'image/png' }; }); ['P1', 'P2'].forEach((n) => { mktObjects[img(C2, n)] = { type: 'image/png' }; });
  const D = (n) => cairoDay(-n); const CA = '120210000000001'; const CB = '120210000000002'; const CC = '120210000000003';
  const st = (level, id, camp, day, spend, x) => ({ level, object_id: id, campaign_id: camp, day, spend, impressions: 1000, clicks: 30, link_clicks: 20, frequency: 1.5, purchases: 0, purchase_value: 0, ...(x || {}) });
  const mkt = {
    mktCampaigns: [{ id: C1, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 3, state: review, updated_at: iso(0, 9) }, { id: C2, name: 'عرض المرايات', goal: 'عرض', step: 4, state: ready, updated_at: iso(1) }],
    mktObjects,
    mktTrends: [{ title: 'كاروسيل «قبل وبعد»', summary: 'صورتين لنفس الركن قبل المنتج وبعده — إبتكر تعملها للمخدات والستاير.', source: 'Later', url: 'https://later.com/blog/instagram-trends/', kind: 'image', found_at: iso(0, 7) },
      { title: 'ريل «يوم في الورشة»', summary: 'لقطات سريعة لإيد المبتكر وهو بيشتغل، بصوت الورشة من غير موسيقى.', source: 'Hootsuite', url: 'https://blog.hootsuite.com/social-media-trends/', kind: 'video', found_at: iso(0, 7) },
      { title: 'كادر الألوان الدافية', summary: 'تصوير المنتج على خلفية تراكوتا / بيج غامق بدل الأبيض.', source: 'Pinterest Predicts', url: 'https://business.pinterest.com/pinterest-predicts/', kind: 'image', found_at: iso(1, 7) }],
    mktCompetitors: [{ name: 'Boho Corner', keyword: 'بوهو ديكور', note: 'بينزلوا عروض كل خميس' }, { name: 'Dar Handmade', page_id: '104455667788990', page_url: 'https://www.facebook.com/profile.php?id=104455667788990' }],
    siteChecks: [{ kind: 'wp_updates', checked_at: iso(0, 6), data: { wp: { version: '6.8.1', latest: '6.8.3', update: true }, wc: { version: '10.2.1' }, php: '8.2.20', theme: { name: 'WoodMart', version: '8.2.3', latest: '8.3.0', update: true },
      plugins: [{ name: 'WooCommerce', version: '10.2.1', latest: '10.3.0', update: true, active: true }, { name: 'Dokan Pro', version: '4.0.8', latest: '4.0.8', update: false, active: true }, { name: 'Rank Math SEO', version: '1.0.250', latest: '1.0.252', update: true, active: true }, { name: 'WPML Multilingual CMS', version: '4.7.6', latest: '4.7.6', update: false, active: true }, { name: 'WP All Import Pro', version: '4.9.9', latest: '4.9.9', update: false, active: false }], updates: 4 } }],
    mktAdObjects: [{ kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE' }, { kind: 'campaign', id: CA, parent_id: '1122334455', name: 'Macrame — Retargeting', status: 'ACTIVE' }, { kind: 'campaign', id: CB, parent_id: '1122334455', name: 'Lamps — Broad', status: 'ACTIVE' }, { kind: 'campaign', id: CC, parent_id: '1122334455', name: 'Rug — Paused', status: 'PAUSED' },
      { kind: 'ad', id: '1206', parent_id: CA, name: 'Macrame carousel', status: 'ACTIVE', thumb: null }, { kind: 'ad', id: '1207', parent_id: CB, name: 'Lamps video', status: 'ACTIVE', thumb: null }],
    mktAdStats: [st('campaign', CA, CA, D(-2), 400, { purchases: 3, purchase_value: 3600 }), st('campaign', CA, CA, D(-1), 600, { purchases: 3, purchase_value: 4000 }), st('campaign', CB, CB, D(-3), 900, { purchases: 6, purchase_value: 5000 }), st('campaign', CB, CB, D(-1), 800, { purchases: 4, purchase_value: 2000 }),
      st('campaign', CA, CA, D(-9), 500, { purchases: 2, purchase_value: 2100 }), st('campaign', CB, CB, D(-10), 700, { purchases: 3, purchase_value: 2500 }),
      st('ad', '1206', CA, D(-2), 400, { impressions: 2000, link_clicks: 60, frequency: 1.2, purchases: 3, purchase_value: 3600 }), st('ad', '1206', CA, D(-1), 600, { impressions: 1000, link_clicks: 30, frequency: 2.1, purchases: 3, purchase_value: 4000 }), st('ad', '1207', CB, D(-3), 900, { impressions: 3000, link_clicks: 30, frequency: 4.5, purchases: 6, purchase_value: 5000 })],
    mktAdOrders: [{ day: D(-2), platform: 'meta', source: 'fb', campaign: CA, grp: 'completed', orders: 3, sales: 3000, share: 450 }, { day: D(-1), platform: 'meta', source: 'ig', campaign: CA, grp: 'in_progress', orders: 2, sales: 2000, share: 300 },
      { day: D(-1), platform: 'meta', source: 'fb', campaign: CA, grp: 'cancelled', orders: 1, sales: 700, share: 70 }, { day: D(-9), platform: 'meta', source: 'fb', campaign: CA, grp: 'completed', orders: 2, sales: 1800, share: 270 }],
    mktSuggestions: [{ kind: 'stop', campaign_id: CB, campaign_name: 'Lamps — Broad', title: 'وقّف «Lamps — Broad»', sub: 'صرفت 1,700 ج.م · 0 أوردر في ووكومرس من 5 أيام', why: 'ميتا بتحسب 10 مشتريات', impact: 'توفير ~340 ج.م/يوم', data: { spend5: 1700 } },
      { kind: 'budget_up', campaign_id: CA, campaign_name: 'Macrame — Retargeting', title: 'زوّد «Macrame — Retargeting» 20%', sub: 'العائد الحقيقي 5.00× · 5 أوردر مؤكد في ووكومرس', pct: 20, data: { daily_budget: 300 } }],
  };

  return { invLots, invMoves, tickets, ticketEvents, ...hr, ...dokan, ...mkt };
}

/** After the stand-in is installed: every product of its mirror gets a picture on its made-up site (https, so every page that shows
 *  «the product's own photo from the site» has one — the shim draws a product tile for it), and its orders are a little busier. */
export function demoAfter(mock) {
  if (!mock) return;
  (mock.products || []).forEach((p) => { const slug = (/\/product\/([^/]+)\//.exec(p.permalink || '') || [])[1] || String(p.id); if (p.status !== 'trash') { p.image_url = DEMO_SITE + '/wp-content/uploads/2026/11/' + slug + '.webp'; p.image_count = p.image_count || 1; } });
  // a second brand on Art Craft, so «البراندات» in the makers' record (and its filter) has something to show
  if (mock.brands && !mock.brands.some((b) => b.name === 'Craft Home')) {
    const id = 'd0000000-0000-4000-8000-000000000099', at = iso(40);
    mock.brands.push({ id, name: 'Craft Home', code: 'C', aliases: [], store_vendor_id: null, origin_vendor_id: V(1), created_by: 'صفوت كمال', created_at: at, updated_at: at });
    (mock.brandOwners || []).push({ id: 99, brand_id: id, vendor_id: V(1), since: iso(40).slice(0, 10), return_on: null, reason: null, set_by: 'صفوت كمال', created_at: at });
  }
  // a few rows in the activity log, so every «سجل الحركات» opens with something under its date filter (codes and fields only, like the server's)
  if (mock.activityRows && !mock.activityRows.some((r) => r.demo)) {
    const rows = [
      [0, M(2), 'hr.shift.start', 'hr', M(2), ''], [1, M(1), 'hr.request.approve', 'hr', 'TKT-0002', ''], [2, M(1), 'hr.payroll.member', 'hr', M(4), ''],
      [3, M(1), 'hr.extra.create', 'hr', M(2), ''], [5, M(4), 'hr.shift.end', 'hr', M(4), ''],
      [0, M(1), 'vendor.update', 'vendor', V(1), 'phone, social'], [2, M(5), 'vendor.notify', 'vendor', V(2), ''], [6, M(1), 'vendor.sync', 'vendor', V(3), 'name, status'],
      [1, M(2), 'product.save', 'product', '9001', 'price, stock'], [4, M(2), 'product.images.add', 'product', '9002', '2'],
    ];
    let id = mock.activityRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    rows.forEach(([d, actor, action, entity, entityId, value]) => { id += 1; mock.activityRows.push({ id, demo: true, at: iso(d, 8 + (id % 3)), actor, action, entity, entity_id: entityId, old_value: null, new_value: value || null }); });
  }
}
