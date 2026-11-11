import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The auto-reply page (phase 6.5, block 20 «autoreply» from the v6 prototype on IBCS / 0058): the templates library with the seeded
// template, a new quick reply, the rules tab with its switch, the sending settings and the admin's master switch (off by default),
// a rule saved as a draft; and the composer's «/» suggestions + the template picker in the inbox. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, id, hash = '#autoreply') {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForFunction(() => window.IBCS && window.IBCS.state() === 'ready');
  await page.evaluate((h) => { location.hash = h; }, hash);
}
const P = (page) => page.locator('#pg-autoreply');

test('the page is in the menu; templates: the seeded template card, a new template saved through the adapter', async ({ page }) => {
  await signIn(page, ADMIN, '#autoreply-templates'); // decision 65: #autoreply opens «نظرة عامة»
  await expect(page.locator('nav.sidebar .nav-item[data-page="autoreply"]')).toHaveText(/الرد الآلي/);
  await expect(P(page)).toBeVisible();
  await expect(P(page).locator('[data-ar-lib] [data-lib="customers"] .cnt')).toHaveText('1');
  const card = P(page).locator('.tcard[data-tpl]'); await expect(card).toHaveCount(1);
  await expect(card).toContainText('تأكيد الأوردر'); await expect(card).toContainText('/تأكيد'); await expect(card).toContainText('قالب Meta');
  await expect(card).toContainText('تلقائي: يتبعت لما الأوردر يبقى «جاري التنفيذ»');
  await page.getByRole('button', { name: 'قالب جديد' }).click();
  const m = page.locator('.modal');
  await m.locator('#name').fill('تم الشحن');
  await m.locator('#tp-body').fill('أوردرك {رقم_الأوردر} اتشحن 🚚 تابعه: {رابط_التتبع}');
  await expect(m.locator('.tp-prev .tx')).toContainText('178611 اتشحن');
  await m.getByRole('button', { name: 'حفظ القالب' }).click();
  await expect(m).toHaveCount(0);
  await expect(P(page).locator('.tcard[data-tpl]')).toHaveCount(2);
  const w = mock.csWrites.find((x) => x.table === 'cs_templates' && x.op === 'insert');
  expect(w.name).toBe('تم الشحن'); expect(w.trig_kind).toBe('manual'); expect(w.quick_key).toBe(null); expect(w.body).toBeUndefined(); // the text is never in the write log
});

test('quick replies: the seeded one, a new one; the inbox composer lists them on «/» and fills the box; the template picker', async ({ page }) => {
  await signIn(page, ADMIN, '#autoreply-quick');
  await expect(P(page).locator('[data-quick]')).toHaveText('/شحن');
  await page.getByRole('button', { name: 'رد سريع جديد' }).click();
  const m = page.locator('.modal');
  await m.locator('#key').fill('شكر'); await m.locator('#label').fill('شكر بعد الاستلام'); await m.locator('#text').fill('شكراً إنك اخترتي إبتكر ❤️');
  await m.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(m.locator('.err-msg')).toContainText('الاختصار لازم يبدأ بـ /');
  await m.locator('#key').fill('/شكر');
  await m.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(m).toHaveCount(0);
  await expect(P(page).locator('[data-quick]')).toHaveCount(2);
  // the composer: «/ش» → the two quick replies and the template with a key starting the same
  await page.evaluate(() => { location.hash = 'cs-inbox'; });
  const ta = page.locator('#cs-ta'); await expect(ta).toBeVisible();
  await ta.fill('/ش');
  const slash = page.locator('#cs-slash'); await expect(slash).toBeVisible();
  await expect(slash.locator('[data-slash]')).toHaveCount(2);
  await slash.locator('[data-slash="/شحن"]').click();
  await expect(page.locator('#cs-ta')).toHaveValue(/الشحن جوه القاهرة/);
  await expect(page.locator('#cs-slash')).toBeHidden();
  await page.locator('[data-cmp-tool="قالب"]').click();
  await expect(page.locator('.modal [data-tpl-pick] .tcard')).toHaveCount(1);
  await page.locator('.modal [data-tpl-pick] .tcard').click();
  await expect(page.locator('#cs-ta')).toHaveValue(/أهلاً سلوى 👋 أوردرك 181668/);
});

test('rules: the seeded rule off, its switch turns it on through the adapter; the master switch is off and asks before turning on; a draft rule', async ({ page }) => {
  await signIn(page, ADMIN, '#autoreply-rules');
  await expect(P(page).locator('[data-auto-live]')).toHaveAttribute('aria-checked', 'false');
  await expect(P(page).locator('[data-auto-live-row]')).toContainText('متوقف');
  await expect(P(page).locator('[data-send-settings]')).toContainText('واتساب 1: 250');
  const rule = P(page).locator('.rule[data-rule]'); await expect(rule).toHaveCount(1);
  await expect(rule).toContainText('لما: الأوردر بقى «جاري التنفيذ» والقناة = واتساب 1 ← ابعت قالب «تأكيد الأوردر» · بعد 5 دقايق · مرة واحدة');
  await expect(rule.locator('[data-rule-switch]')).toHaveAttribute('aria-checked', 'false');
  await rule.locator('[data-rule-switch]').click();
  await expect(P(page).locator('.rule[data-rule] [data-rule-switch]')).toHaveAttribute('aria-checked', 'true');
  expect(mock.csWrites.find((x) => x.table === 'cs_auto_rules' && x.op === 'update').enabled).toBe(true);
  // the master switch: a confirmation, then the settings row «cs».auto.live
  await P(page).locator('[data-auto-live]').click();
  await expect(page.locator('.modal')).toContainText('تشغيل الإرسال التلقائي؟');
  await page.locator('.modal').getByRole('button', { name: 'أيوه، شغّل' }).click();
  await expect(P(page).locator('[data-auto-live]')).toHaveAttribute('aria-checked', 'true');
  const cs = await page.evaluate(() => window.IBCS.data.auto); expect(cs.live).toBe(true);
  // a new rule saved as a draft: after-hours needs no template
  await page.getByRole('button', { name: 'قاعدة جديدة' }).click();
  const m = page.locator('.modal').last();
  await m.locator('#name').fill('خارج المواعيد');
  await m.locator('button.select#event').click(); await page.getByRole('option', { name: 'رسالة خارج مواعيد العمل' }).click();
  await m.locator('[data-rule-draft]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(P(page).locator('.rule[data-rule]')).toHaveCount(2);
  const w = mock.csWrites.find((x) => x.table === 'cs_auto_rules' && x.op === 'insert');
  expect([w.event, w.action, w.template_id, w.enabled]).toEqual(['afterhours', 'send', null, false]);
});

test('a member without cs.manage reads the page and cannot write; the engine switch is the admin\'s', async ({ page }) => {
  await signIn(page, OPS, '#autoreply-rules');
  await expect(P(page).locator('.rule[data-rule]')).toHaveCount(1);
  await expect(P(page).locator('[data-rule-switch]')).toBeDisabled();
  await expect(P(page).locator('[data-auto-live]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'قاعدة جديدة' })).toHaveCount(0);
  await expect(P(page).locator('[data-send-edit]')).toHaveCount(0);
});

// phase 13 decision 65: «نظرة عامة» first and «التقارير» last
test('decision 65: the tabs are نظرة عامة · القوالب · الردود السريعة · قواعد الرد الآلي · التقارير; the overview and the reports from the rules, templates and automatic messages', async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(P(page).locator('[role=tab]')).toHaveText(['نظرة عامة', 'القوالب', 'الردود السريعة', 'قواعد الرد الآلي', 'التقارير']);
  await expect(P(page).locator('[role=tab]').first()).toHaveAttribute('aria-selected', 'true');
  await expect(P(page).locator('.kpi[aria-label="الرد الآلي"]')).toContainText('متوقف'); // live off by default
  await expect(P(page).locator('.kpi[aria-label="القوالب والردود السريعة"]')).toContainText('1 قالب Meta معتمد');
  await expect(P(page)).toContainText('أكتر القواعد تنفيذًا');
  await expect(P(page)).toContainText('إعدادات الإرسال');
  await P(page).locator('[role=tab]', { hasText: 'التقارير' }).click();
  await expect(page).toHaveURL(/#autoreply-reports$/);
  await expect(P(page).locator('.kpi[aria-label="رسايل آلية"]')).toBeVisible();
  await expect(P(page)).toContainText('حالة الإرسال');
});
