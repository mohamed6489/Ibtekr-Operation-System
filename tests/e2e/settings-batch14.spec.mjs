import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md decisions 3–8): the settings hub's groups as sticky tabs that
// scroll to their group and follow the scroll; every settings page in the middle at one width with «حفظ» at its left end; no table
// tools (بحث / فلتر / ترتيب / الأعمدة) on a settings table. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };

test('decision 3: the hub\'s groups are sticky tabs — a tab scrolls to its group and the group in view is the marked one', async ({ page }) => {
  await page.locator('.sidebar .nav-item[data-page="settings"]').click();
  const bar = page.locator('#pg-settings > [data-set-jump]');
  await expect(bar.locator('[role=tab]')).toHaveText(['الشركة والفريق', 'الربط والأدوات', 'التشغيل', 'الأمان والبيانات']);
  await expect(bar).toHaveCSS('position', 'sticky');
  await expect(bar.locator('[aria-selected=true]')).toHaveText('الشركة والفريق');
  await bar.locator('[data-set-jump-to="الربط والأدوات"]').click();
  await expect(bar.locator('[aria-selected=true]')).toHaveText('الربط والأدوات');
  // the group sits right under the sticky bar, and the bar is still on screen
  await expect.poll(() => page.locator('[data-set-group="الربط والأدوات"]').evaluate((g) => { const b = document.querySelector('[data-set-jump]').getBoundingClientRect(); return Math.abs(g.getBoundingClientRect().top - b.bottom) < 40; })).toBe(true);
  await expect.poll(() => bar.evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan(60);
  // scrolling by hand moves the mark
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await expect(bar.locator('[aria-selected=true]')).toHaveText('الشركة والفريق');
});

test('decision 3: a settings page is centred at one width with «حفظ» at its left end; its tables have no بحث / فلتر / ترتيب / columns', async ({ page }) => {
  for (const sec of ['settings-team', 'settings-quick', 'settings-lists', 'settings-activity', 'settings-hr']) {
    await go(page, sec);
    const wrap = page.locator('#pg-settings [data-set-wrap]');
    await expect(wrap).toBeVisible();
    const g = await wrap.evaluate((w) => { const r = w.getBoundingClientRect(); const main = w.parentElement.getBoundingClientRect(); const s = w.querySelector('[data-set-save]').getBoundingClientRect();
      return { centred: Math.abs((r.left - main.left) - (main.right - r.right)) < 40 || r.width >= main.width - 60, saveLeft: Math.abs(s.left - r.left) < 2, width: Math.round(r.width) }; });
    expect(g, sec).toEqual(expect.objectContaining({ centred: true, saveLeft: true }));
    expect(g.width, sec).toBeLessThanOrEqual(1040);
    await expect(page.locator('#pg-settings [data-tq-btn], #pg-settings [data-cols], #pg-settings [data-fm-btn^="auto"], #pg-settings [data-sm-btn^="auto"]'), sec).toHaveCount(0);
  }
});

const settingsRow = (section) => (mock.settings || []).find((r) => r.section === section);

test('decisions 4, 5 and 8: a status gets a shown name (⋮ «تغيير الاسم») that the orders page shows while the value stays; shipping companies and stop reasons are saved lists; the return default can ask every time', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  // statuses: no «+» (rename only), a ⋮ next to each status
  await expect(body.locator('[data-reason-add]')).toHaveCount(0);
  const row = body.locator('tr').filter({ has: page.locator('[data-status="جاري التنفيذ"]') });
  await row.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click();
  await page.locator('.modal input').first().fill('تحت التصنيع');
  await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(body.locator('[data-status-label="جاري التنفيذ"]')).toHaveText('تحت التصنيع');
  await expect.poll(() => ((settingsRow('lists') || {}).data || {}).labels).toEqual({ order: { 'جاري التنفيذ': 'تحت التصنيع' } });
  // the shipping companies: «+ إضافة» next to the title, then ⋮ تعديل
  await body.getByRole('tab', { name: 'شركات الشحن' }).click();
  await expect(body.locator('[data-reason]')).toHaveText(['بوسطة', 'أرامكس', 'مندوب إبتكر']);
  await body.locator('[data-reason-add="shipping"]').click();
  await page.locator('.modal input').first().fill('J&T');
  await page.locator('.modal').getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => ((settingsRow('lists') || {}).data || {}).shipping).toEqual(['بوسطة', 'أرامكس', 'مندوب إبتكر', 'J&T']);
  // a company the list has already → the popup refuses it
  await body.locator('[data-reason-add="shipping"]').click();
  await page.locator('.modal input').first().fill('بوسطة');
  await page.locator('.modal').getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(page.locator('.modal')).toContainText('موجودة في القايمة');
  await page.keyboard.press('Escape');
  // the stop reasons keep «أخرى» last and fixed
  await body.getByRole('tab', { name: 'أسباب إيقاف المبتكر' }).click();
  await expect(body.locator('[data-reason]').last()).toHaveText('أخرى');
  expect((settingsRow('lists').data || {}).cancel.length).toBeGreaterThan(0); // the saved row keeps the cancel / return reasons
  expect(JSON.stringify(mock.activity.filter((a) => /^settings\.lists/.test(a.action)))).not.toContain('J&T'); // counts / kinds only in the log
  // the orders page shows the new name; the value in the dropdown is the system's
  await go(page, 'orders');
  await expect(page.locator('#chips [data-sc="جاري التنفيذ"] span')).toHaveText('تحت التصنيع');
  const opt = page.locator('select[data-st] option[value="جاري التنفيذ"]').first();
  await expect(opt).toHaveText('تحت التصنيع');
  // the inventory return default can be «اسألني في كل مرة»
  await go(page, 'settings-inventory');
  await expect(page.locator('#pg-settings').getByRole('radio', { name: 'اسألني في كل مرة' })).toHaveCount(1);
});
