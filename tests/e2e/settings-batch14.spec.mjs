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

test('decision 6: the permissions matrix looks like the alerts matrix (icon marks, group headers with a count) and both role rows stay under the top bar until the matrix ends', async ({ page }) => {
  const stuck = (sel) => page.evaluate((s) => { const head = document.querySelector(s + ' .mx-head'); const m = document.querySelector(s + ' .matrix'); const r = m.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + Math.min(400, r.height / 2)); return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => { const h = head.getBoundingClientRect(); ok({ top: Math.round(h.top), inMatrix: m.getBoundingClientRect().bottom > h.bottom }); }))); }, sel);
  await go(page, 'settings-team');
  await page.locator('#pg-settings').getByRole('tab', { name: 'الأدوار والصلاحيات' }).click();
  const pm = page.locator('[data-perm-matrix]');
  await expect(pm.locator('.mx-head')).toContainText('أدمن');
  await expect(pm.locator('.mx-head')).toContainText('كاملة');
  await expect(pm.locator('.mx-gh .acc-t').first()).toBeVisible();
  await expect(pm.locator('.mx-gh .meta').first()).toContainText('صلاحيات');
  await expect(pm.locator('button.pm-full svg').first()).toBeVisible(); // ✓ as an icon, like the alerts matrix
  await expect(pm.locator('button.pm-none').first()).toHaveText('○');
  const s1 = await stuck('[data-perm-matrix]');
  expect(s1.top).toBeGreaterThanOrEqual(46); expect(s1.top).toBeLessThanOrEqual(50); expect(s1.inMatrix).toBe(true);
  // a click still changes a role's permission (✓ → 👁 → ○)
  const cell = pm.locator('.mx-row:not(.mx-head):not(.sens) button.pm:not([disabled])').first();
  const before = await cell.getAttribute('class');
  await cell.click();
  await expect(cell).not.toHaveAttribute('class', before);
  await go(page, 'settings-notifications');
  await page.locator('#pg-settings').getByRole('tab', { name: 'حسب الدور' }).click();
  await expect(page.locator('[data-alert-matrix] .mx-head')).toBeVisible();
  const s2 = await stuck('[data-alert-matrix]');
  expect(s2.top).toBeGreaterThanOrEqual(46); expect(s2.top).toBeLessThanOrEqual(50); expect(s2.inMatrix).toBe(true);
});

test('decision 7: the work days, the official hours, the day rate and a custom time for a department are editable and saved; the clock follows the member\'s day', async ({ page }) => {
  await go(page, 'settings-hr');
  const body = page.locator('#pg-settings');
  await expect(body.locator('[data-hs-days] [data-hs-day]')).toHaveCount(7);
  await expect(body.locator('[data-hs-day="5"]')).toHaveAttribute('aria-checked', 'false'); // Friday off by default
  await body.locator('[data-hs-day="6"]').click(); // Saturday becomes a work day
  await expect(body.locator('[data-hs-day="6"]')).toHaveAttribute('aria-checked', 'true');
  await body.locator('#hs-to').click(); await page.getByRole('option', { name: '18:00', exact: true }).click();
  await expect(body.locator('[data-hs-hours]')).toHaveText('9 ساعات');
  await body.locator('#hs-div').click(); await page.getByRole('option', { name: '30 يوم', exact: true }).click();
  // a custom time for a department
  await body.locator('[data-hs-sched-add]').click();
  const modal = page.locator('.modal');
  await modal.locator('#hs-s-from').click(); await page.getByRole('option', { name: '10:00', exact: true }).click();
  await modal.locator('#hs-s-to').click(); await page.getByRole('option', { name: '16:00', exact: true }).click();
  await expect(modal.locator('[data-hs-s-hours]')).toContainText('6 ساعات');
  await modal.getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(body.locator('[data-hs-sched^="dept:"]')).toHaveCount(1);
  await body.locator('[data-set-save]').click();
  await expect.poll(() => { const r = (mock.settings || []).find((x) => x.section === 'hr'); return r && r.data && [r.data.workDays, r.data.workTo, r.data.dayDivisor]; }).toEqual([[1, 2, 3, 4, 6, 7], '18:00', 30]);
  const hr = (mock.settings || []).find((x) => x.section === 'hr').data;
  const dept = Object.keys(hr.schedules.dept)[0];
  expect(hr.schedules.dept[dept]).toEqual({ from: '10:00', to: '16:00' });
  // the adapter answers the same as the server's hr_day_minutes: the official 9 hours, the department's 6
  // (the adapter takes the saved row when the write answers — a moment after the server has it)
  await expect.poll(() => page.evaluate(() => window.IBHR.span(window.IBHR.settings().workFrom, window.IBHR.settings().workTo))).toBe(540);
  await expect.poll(() => page.evaluate((d) => { const m = window.IBHR.everyone().find((x) => x.dept === d && x.uid); return m ? window.IBHR.dayMinutes(m.uid) : 360; }, dept)).toBe(360);
});

test('decision 7: on a work day past the member\'s start time with no session, the clock reminds once («ابدأ الدوام»)', async ({ page }) => {
  await page.evaluate(() => window.IBHR.saveSettings({ workDays: [1, 2, 3, 4, 5, 6, 7], workFrom: '00:00', workTo: '08:00' }));
  await page.evaluate(() => { try { localStorage.removeItem('ib.start.reminded'); } catch (e) { /* */ } });
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'ميعاد الدوام بدأ (00:00)' }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.clock-widget.remind')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('ib.start.reminded'))).toBe(await page.evaluate(() => window.IBHR.today()));
});
