import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { mktToday, mktAddDays } from './mkt-mock.mjs';

// «التسويق» 9.5.3 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 44–47): «نظرة عامة» and «التقارير» on Meta Ads'
// own numbers (mkt_ad_objects / mkt_ad_stats, written by mkt-ads) next to WooCommerce's ad orders (mkt_ads_orders) in the reports
// page's period — the KPIs (the profit after ads for accounts.view only), the media buyer's open suggestions (9.5.4), the link's state,
// the 5 weeks' real return, the campaigns day by day, the creatives; «مزامنة دلوقتي» for the admin; the reports page's «الحملات
// الإعلانية» on the same blocks. Mock only (mkt-mock's tables, mkt_ads_orders and mkt-ads).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const TODAY = mktToday(); const D = (n) => mktAddDays(TODAY, n);
const CA = '120252323303340228', CB = '120251977233530228', CC = '120251297405730228';
const OBJECTS = [
  { kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE' },
  { kind: 'campaign', id: CA, parent_id: '1122334455', name: 'Macrame — Retargeting', status: 'ACTIVE' },
  { kind: 'campaign', id: CB, parent_id: '1122334455', name: 'Lamps — Broad', status: 'ACTIVE' },
  { kind: 'campaign', id: CC, parent_id: '1122334455', name: 'Rug — Paused', status: 'PAUSED' },
  { kind: 'ad', id: '1206', parent_id: CA, name: 'Macrame carousel', status: 'ACTIVE', thumb: 'https://cdn.example.test/ad1.jpg' },
  { kind: 'ad', id: '1207', parent_id: CB, name: 'Lamps video', status: 'ACTIVE', thumb: null },
];
const st = (level, id, camp, day, spend, x = {}) => ({ level, object_id: id, campaign_id: camp, day, spend, impressions: 1000, clicks: 30, link_clicks: 20, frequency: 1.5, purchases: 0, purchase_value: 0, ...x });
const STATS = [
  st('campaign', CA, CA, D(-2), 400, { purchases: 3, purchase_value: 3600 }), st('campaign', CA, CA, D(-1), 600, { purchases: 3, purchase_value: 4000 }),
  st('campaign', CB, CB, D(-3), 900, { purchases: 6, purchase_value: 5000 }), st('campaign', CB, CB, D(-1), 800, { purchases: 4, purchase_value: 2000 }),
  st('ad', '1206', CA, D(-2), 400, { impressions: 2000, link_clicks: 60, frequency: 1.2, purchases: 3, purchase_value: 3600 }),
  st('ad', '1206', CA, D(-1), 600, { impressions: 1000, link_clicks: 30, frequency: 2.1, purchases: 3, purchase_value: 4000 }),
  st('ad', '1207', CB, D(-3), 900, { impressions: 3000, link_clicks: 30, frequency: 4.5, purchases: 6, purchase_value: 5000 }),
];
// mkt_ads_orders' rows (the share is the server's — nulled by the mock without accounts.view)
const ORDERS = [
  { day: D(-2), platform: 'meta', source: 'fb', campaign: CA, grp: 'completed', orders: 3, sales: 3000, share: 450 },
  { day: D(-1), platform: 'meta', source: 'ig', campaign: CA, grp: 'in_progress', orders: 2, sales: 2000, share: 300 },
  { day: D(-1), platform: 'meta', source: 'fb', campaign: CA, grp: 'cancelled', orders: 1, sales: 700, share: 70 },
  { day: D(-5), platform: 'meta', source: 'fb', campaign: CC, grp: 'pending', orders: 1, sales: 500, share: 50 },
  { day: D(-4), platform: 'google', source: 'google', campaign: 'winter', grp: 'completed', orders: 2, sales: 900, share: 90 },
];
// 9.5.4: the server's open suggestions (mkt_suggestions) as the overview's card and the campaigns' «القرار المقترح» show them
const SUGG = [
  { kind: 'stop', campaign_id: CB, campaign_name: 'Lamps — Broad', title: 'وقّف «Lamps — Broad»', sub: 'صرفت 1,700 ج.م · 0 أوردر في ووكومرس من 5 أيام', why: 'ميتا بتحسب 10 مشتريات', impact: 'توفير ~340 ج.م/يوم', data: { spend5: 1700 } },
  { kind: 'tracking', campaign_id: CB, campaign_name: 'Lamps — Broad', title: 'فرق كبير في أرقام «Lamps — Broad»', sub: 'ميتا بتقول 10 مشتريات · ووكومرس 0 أوردر', impact: 'راجع التتبع' },
  { kind: 'budget_up', campaign_id: CA, campaign_name: 'Macrame — Retargeting', title: 'زوّد «Macrame — Retargeting» 20%', sub: 'العائد الحقيقي 5.00× · 5 أوردر مؤكد في ووكومرس', pct: 20, data: { daily_budget: 300 } },
];
let mock = null; let pageErrors = [];
async function start(page, extra = {}) {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('https://cdn.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  mock = await installSupabaseMock(page, { mktAdObjects: OBJECTS, mktAdStats: STATS, mktAdOrders: ORDERS, mktSuggestions: SUGG, ...extra });
}
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function signIn(page, email) {
  if (!(await page.locator('#login').isVisible().catch(() => false))) await page.goto('/'); // after a sign-out the login is already there
  await expect(page.locator('#login')).toBeVisible();
  await page.waitForLoadState('load').catch(() => {});
  for (let i = 0; i < 3; i++) { // a click swallowed by the sign-out's reload is sent again
    await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
    if (await page.locator('#root').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) break;
  }
  await expect(page.locator('#root')).toBeVisible();
}
async function signOut(page) { await page.locator('.user-btn').click(); await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click(); await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('#root')).toBeHidden(); await page.waitForLoadState('load').catch(() => {}); }
async function openTab(page, email, tab) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await pg(page).getByRole('tab', { name: new RegExp(tab) }).click();
}
const pg = (page) => page.locator('#pg-marketing');
const kpi = (scope, label) => scope.locator('.kpi[aria-label="' + label + '"]');
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const close = (m) => m.locator('button.btn-text', { hasText: 'إغلاق' }).click();
const toast = (page) => page.locator('.toast.show');

test('«نظرة عامة»: the spend, the Woo sales from ads, the real return and cost next to Meta\'s, the profit after ads; the alerts with no action; the link; 5 weeks', async ({ page }) => {
  await start(page);
  await openTab(page, ADMIN, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('[data-ads-kpis="5"]')).toBeVisible();
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('2,700.00');
  await expect(kpi(P, 'مبيعات ووكومرس من الإعلانات')).toContainText('6,400.00'); // Meta 5,500 (the cancelled out) + Google's 900 from its UTM
  await expect(kpi(P, 'مبيعات ووكومرس من الإعلانات')).toContainText('8 أوردر');
  await expect(kpi(P, 'مبيعات ووكومرس من الإعلانات')).toContainText('1 اتلغى');
  await expect(kpi(P, 'العائد الحقيقي (MER)')).toContainText('2.04'); // 5,500 ÷ 2,700
  await expect(kpi(P, 'العائد الحقيقي (MER)')).toContainText('5.41×'); // Meta says 14,600 ÷ 2,700
  await expect(kpi(P, 'تكلفة الأوردر الحقيقية')).toContainText('450.00'); // 2,700 ÷ 6 Meta orders
  await expect(kpi(P, 'تكلفة الأوردر الحقيقية')).toContainText('المنصات بتقول 169'); // 9.5.6: the platforms' own count
  await expect(kpi(P, 'الربح بعد الإعلانات')).toContainText('-1,900.00'); // Ibtekr's 800 on Meta's orders − 2,700
  // the KPI's details: the sales by platform and their source
  await kpi(P, 'مبيعات ووكومرس من الإعلانات').locator('[data-details]').click();
  const det = modal(page, 'مبيعات ووكومرس من الإعلانات');
  await expect(det.locator('tbody tr').first()).toContainText('فيسبوك 4 · انستجرام 2');
  await close(det);
  // the media buyer's open suggestions (the server's rows): the card lists them; the details and the decisions are in marketing-ai.spec
  const sugg = P.locator('[data-mk-pending="3"] [data-mk-sugg]');
  await expect(sugg).toHaveCount(3);
  await expect(sugg.nth(0)).toContainText('وقّف «Lamps — Broad»');
  await expect(sugg.nth(0)).toContainText('1,700 ج.م');
  await expect(sugg.nth(2)).toContainText('زوّد «Macrame — Retargeting» 20%');
  // a campaign's days from the reports' table (below); here the campaign card in the KPI's details is enough
  // the link: Meta connected with its account; Google and TikTok soon; Woo live with the ad orders of the period
  const conn = P.locator('[data-ads-conn="ok"]');
  await expect(conn).toContainText('ميتا — متصلة');
  await expect(conn).toContainText('حساب Ibtekr Club');
  await expect(conn).toContainText('8 أوردر من إعلانات في الفترة');
  await expect(P.locator('[data-ads-mer="5"] .col')).toHaveCount(5);
  await expect(P.locator('[data-ads-mer] .col').last()).toContainText('2.04×'); // the newest week on the left
  await expect(P.locator('.ads-vs tbody tr', { hasText: 'جوجل' })).toContainText('مش مربوطة'); // 9.5.6: not linked (no longer «soon»)
  await expect(P.locator('[data-ads-assistants="live"]')).toContainText('3 اقتراح مستني موافقتك');
  await expect(P.locator('[data-ads-assistants="live"]')).toContainText('التنفيذ على ميتا: متوقف');
  await expect(P.locator('.ads-bar .fresh')).toContainText('آخر مزامنة: ميتا');
  // «مزامنة دلوقتي» (the admin) — mkt-ads sync, then the numbers again
  await P.locator('[data-ads-sync]').click();
  await expect(toast(page)).toContainText('اتزامنت أرقام الإعلانات');
  expect(mock.mkt.calls.filter((x) => x.fn === 'mkt-ads' && x.action === 'sync').length).toBe(1);
  // the reports' period moves it: «اليوم» — nothing spent today
  await P.locator('.ads-bar .date-field').click();
  await page.locator('.dp .presets [role=radio]', { hasText: /^اليوم$/ }).click();
  await page.locator('.dp').getByRole('button', { name: 'تحديث' }).click();
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('0.00');
  await expect(P.locator('[data-mk-pending="3"]')).toBeVisible(); // the suggestions are the server's — the period does not move them
});

test('«التقارير»: the campaigns (Meta next to Woo, the suggested decision, the status filter, the days) and the creatives (the picture, tired, the utm_content tip)', async ({ page }) => {
  await start(page);
  await openTab(page, ADMIN, 'التقارير');
  const P = pg(page);
  const rows = P.locator('.ads-camps tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Lamps — Broad'); // by spend
  await expect(rows.nth(0).locator('[data-mk-camp-sugg]')).toHaveText('وقّف +1'); // the open suggestions on the campaign
  await rows.nth(0).locator('[data-mk-camp-sugg]').click();
  const sg = page.locator('.modal[data-mk-sugg]');
  await expect(sg).toContainText('ميتا بتحسب 10 مشتريات');
  await expect(sg.locator('[data-mk-approve]')).toHaveText('وافق'); // the switch is off
  await close(sg);
  await rows.nth(0).locator('[data-ads-camp]').click();
  const days = modal(page, 'Lamps — Broad — ميتا');
  await expect(days.locator('tbody tr:not(.dt-total)')).toHaveCount(2); // its two days, the newest first, and the total
  await expect(days.locator('tbody tr').first()).toContainText('800.00');
  await close(days);
  await expect(rows.nth(1)).toContainText('Macrame — Retargeting');
  await expect(rows.nth(1)).toContainText('5.00×'); // 5,000 ÷ 1,000
  await expect(rows.nth(1)).toContainText('(+1 اتلغى)');
  await expect(rows.nth(2)).toContainText('Rug — Paused'); // a paused campaign's late order
  await expect(rows.nth(2)).toContainText('متوقفة');
  await P.locator('#ads-st').click(); await page.getByRole('option', { name: 'الحالة: متوقفة' }).click();
  await expect(rows).toHaveCount(1);
  await P.locator('#ads-st').click(); await page.getByRole('option', { name: 'الحالة: الكل' }).click();
  await expect(rows).toHaveCount(3);
  await P.locator('[data-ads-camp="' + CA + '"]').click();
  const d = modal(page, 'Macrame — Retargeting — ميتا');
  await expect(d).toContainText('فيسبوك 3 · انستجرام 2');
  await expect(d.locator('tbody tr:not(.dt-total)')).toHaveCount(2);
  await close(d);
  // the creatives
  await P.getByRole('tab', { name: /الأعمال الفنية/ }).click();
  const cr = P.locator('.ads-cr tbody tr');
  await expect(cr).toHaveCount(2);
  await expect(cr.nth(0)).toContainText('Macrame carousel');
  await expect(cr.nth(0).locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(cr.nth(0).locator('img')).toHaveAttribute('src', 'https://cdn.example.test/ad1.jpg');
  await expect(cr.nth(1)).toContainText('الناس زهقت منه'); // frequency 4.5
  await expect(P.locator('.note', { hasText: 'utm_content' })).toBeVisible();
  await P.locator('[data-ads-ad="1207"]').click();
  await expect(modal(page, 'Lamps video')).toContainText('جرّب نسخة جديدة');
});

test('no accounts.view: no profit card and no share from the server; no «مزامنة دلوقتي» for a member', async ({ page }) => {
  await start(page);
  mock.profiles.find((x) => x.email === OPS).custom_perms = { 'accounts.view': 'N' };
  await openTab(page, OPS, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('[data-ads-kpis="4"]')).toBeVisible();
  await expect(kpi(P, 'الربح بعد الإعلانات')).toHaveCount(0);
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('2,700.00');
  await expect(P.locator('[data-ads-sync]')).toHaveCount(0);
  await expect(P.locator('.source')).not.toContainText('نصيب إبتكر');
  expect(mock.mkt.calls.filter((x) => x.rpc === 'mkt_ads_orders').length).toBeGreaterThan(0);
});

test('Meta not linked yet: the note, the Woo orders from ads still counted, «مزامنة دلوقتي» off; a failed sync says why', async ({ page }) => {
  await start(page, { mktAdObjects: [], mktAdStats: [], mktAds: { configured: false, account: null, synced_at: null, checked_at: null } });
  await openTab(page, ADMIN, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('.note', { hasText: 'مفيش منصة إعلانات مربوطة لسه' })).toBeVisible();
  await expect(P.locator('[data-ads-conn="off"]')).toContainText('ميتا — مش مربوطة');
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('0.00');
  await expect(kpi(P, 'مبيعات ووكومرس من الإعلانات')).toContainText('6,400.00');
  await expect(kpi(P, 'العائد الحقيقي (MER)')).toContainText('—');
  await expect(P.locator('[data-ads-sync]')).toBeDisabled();
  await expect(P.locator('.ads-bar .fresh')).toContainText('مفيش منصة إعلانات مربوطة');
});

test('a token Meta refused: the last numbers stay with the reason; «مزامنة دلوقتي» answers it', async ({ page }) => {
  await start(page, { mktAds: { error: 'token' } });
  await openTab(page, ADMIN, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('.note', { hasText: 'مفتاح إعلانات ميتا انتهى' })).toBeVisible();
  await expect(P.locator('[data-ads-conn="error"]')).toBeVisible();
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('2,700.00');
  mock.mkt.adsFail = 'token';
  await P.locator('[data-ads-sync]').click();
  await expect(toast(page)).toContainText('مفتاح إعلانات ميتا انتهى');
});

test('the reports page\'s «الحملات الإعلانية» (decision 47): the same blocks and numbers, CSV (hidden without marketing.view — reports.spec)', async ({ page }) => {
  await start(page);
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'reports-campaigns'; });
  const R = page.locator('#reports #rpanel');
  await expect(page.locator('#reports #tab-campaigns')).toHaveAttribute('aria-selected', 'true');
  await expect(kpi(R, 'الصرف الإعلاني')).toContainText('2,700.00');
  await expect(kpi(R, 'الربح بعد الإعلانات')).toContainText('-1,900.00');
  await expect(R.locator('.ads-camps tbody tr')).toHaveCount(3);
  await expect(R.locator('.ads-cr tbody tr')).toHaveCount(2);
  await expect(page.locator('#reports [data-rp-csv]')).toBeEnabled();
  // the reports' period redraws it here too
  await page.locator('#reports .page-head .date-field').click();
  await page.locator('.dp .presets [role=radio]', { hasText: /^اليوم$/ }).click();
  await page.locator('.dp').getByRole('button', { name: 'تحديث' }).click();
  await expect(kpi(R, 'الصرف الإعلاني')).toContainText('0.00');
});

// ---------------------------------------------------------------- 9.5.6: TikTok and Google linked from the system (decisions 67–71)
const TTC = '1800000000000000001';
const TT_OBJECTS = [{ platform: 'tiktok', kind: 'account', id: '7000000000000000001', name: 'Ibtekr TikTok', status: 'ACTIVE', meta: { currency: 'EGP', synced_at: new Date().toISOString() } },
  { platform: 'tiktok', kind: 'campaign', id: TTC, name: 'Macrame TT', status: 'ACTIVE', meta: { daily_budget: 300 } }];
const TT_STATS = [0, 1, 2].map((n) => ({ platform: 'tiktok', level: 'campaign', object_id: TTC, campaign_id: TTC, day: mktAddDays(mktToday(), -n), spend: 100, impressions: 3000, clicks: 90, purchases: 1, purchase_value: 700 }));
const TT_LINK = { app_id: '7012345678', secret: 'tt-secret-0123456789', access_token: 'tt-' + 'a'.repeat(40), advertiser_id: '7000000000000000001' };

test('9.5.6: the admin links TikTok from «حالة الربط» (the fields into Vault — the values never in a call record), the card turns «متصلة», the spend counts it; a member sees no link buttons', async ({ page }) => {
  await start(page);
  await openTab(page, ADMIN, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('تيك توك — مش مربوطة');
  await expect(P.locator('[data-ads-platform="google"]')).toContainText('جوجل — مش مربوطة');
  await P.locator('[data-ads-link="tiktok"]').click();
  const m = modal(page, 'ربط تيك توك إعلانات');
  await expect(m).toContainText('ads-callback.html'); // the redirect the owner registers on the app
  await m.locator('#ads-tiktok-app_id').fill(TT_LINK.app_id);
  await m.locator('#ads-tiktok-secret').fill(TT_LINK.secret);
  await m.locator('[data-ads-save="tiktok"]').click();
  await expect(toast(page)).toContainText('اتحفظت البيانات — كمّل الربط');
  expect(mock.mkt.links.tiktok).toEqual({ app_id: TT_LINK.app_id, secret: TT_LINK.secret });
  // the token and the advertiser by hand (the owner has them from the app's portal): the stored secret stays when its input is left empty
  await P.locator('[data-ads-link="tiktok"]').click();
  const m2 = modal(page, 'ربط تيك توك إعلانات');
  await expect(m2.locator('#ads-tiktok-secret')).toHaveAttribute('placeholder', /محفوظ ••••6789/);
  await m2.locator('#ads-tiktok-access_token').fill(TT_LINK.access_token);
  await m2.locator('#ads-tiktok-advertiser_id').fill(TT_LINK.advertiser_id);
  await m2.locator('[data-ads-save="tiktok"]').click();
  await expect(toast(page)).toContainText('اتحفظ الربط — المزامنة الجاية هتسحب أرقام تيك توك');
  expect(mock.mkt.links.tiktok).toEqual(TT_LINK);
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('تيك توك — متصلة');
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('حساب 7000000000000000001');
  // the calls and the writes carry the keys only — never a secret
  const txt = JSON.stringify(mock.mkt.calls) + JSON.stringify(mock.mkt.writes) + JSON.stringify(mock.activityRows);
  expect(txt).not.toContain(TT_LINK.secret); expect(txt).not.toContain(TT_LINK.access_token);
  expect(mock.mkt.writes.filter((w) => w.table === 'vault').map((w) => w.keys)).toEqual([['app_id', 'secret', 'access_token', 'advertiser_id'], ['app_id', 'access_token', 'advertiser_id']]); // the second save left the stored secret out
  // «مزامنة دلوقتي» runs Meta and TikTok
  await P.locator('[data-ads-sync]').click();
  await expect(toast(page)).toContainText('اتزامنت أرقام الإعلانات');
  await expect(P.locator('.ads-bar .fresh')).toContainText('تيك توك');
  // «فصل» asks, then the card is back to not linked
  await P.locator('[data-ads-unlink="tiktok"]').click();
  await page.getByRole('button', { name: 'افصل' }).click();
  await expect(toast(page)).toContainText('اتفصلت تيك توك');
  expect(mock.mkt.links.tiktok).toBeUndefined();
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('تيك توك — مش مربوطة');
});

test('9.5.6: a linked TikTok account with numbers — the spend and the campaigns table carry it beside Meta; the Google row stays «مش مربوطة»', async ({ page }) => {
  await start(page, { mktLinks: { tiktok: TT_LINK }, mktAdObjects: TT_OBJECTS.concat(OBJECTS), mktAdStats: TT_STATS.concat(STATS) });
  await openTab(page, ADMIN, 'نظرة عامة');
  const P = pg(page);
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('تيك توك — متصلة');
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('3,000.00'); // Meta 2,700 + TikTok 300
  await expect(kpi(P, 'الصرف الإعلاني')).toContainText('ميتا · تيك توك');
  await expect(P.locator('[data-ads-spend] .bar-row', { hasText: 'تيك توك' })).toContainText('300.00');
  await expect(P.locator('[data-ads-spend] .bar-row', { hasText: 'جوجل' })).toContainText('مش مربوطة');
  await expect(P.locator('.ads-vs tbody tr', { hasText: 'تيك توك' })).toContainText('300.00');
  await pg(page).getByRole('tab', { name: /^التقارير/ }).click();
  const row = P.locator('.ads-camps tbody tr', { hasText: 'Macrame TT' });
  await expect(row).toContainText('تيك توك');
  await expect(row).toContainText('300.00');
  // a member with marketing.view sees the state but no link buttons
  await signOut(page);
  await openTab(page, OPS, 'نظرة عامة');
  await expect(P.locator('[data-ads-platform="tiktok"]')).toContainText('تيك توك — متصلة');
  await expect(P.locator('[data-ads-link]')).toHaveCount(0);
});
