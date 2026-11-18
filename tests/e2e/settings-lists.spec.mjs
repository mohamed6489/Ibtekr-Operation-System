import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The settings lists all editable (docs/superpowers/plans/2026-11-14-settings-lists.md — the owner: «كله يتعدل»). Mock only: the cases
// assert the settings row «lists» the page saved and the expense rows the accounts page wrote (0093's guard is in the mock too).
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
const lists = () => ((mock.settings || []).find((r) => r.section === 'lists') || {}).data || {};
const modal = (page) => page.locator('.modal[role=dialog]');
const rowMenu = async (page, scope, sel, item) => { await scope.locator('tr').filter({ has: page.locator(sel) }).locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: item }).click(); };
async function openExpenses(page) {
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await page.locator('#main [role=tab]', { hasText: 'المصروفات' }).first().click();
}
async function addExpense(page, cat) {
  await page.locator('#main').getByRole('button', { name: 'إضافة مصروفات', exact: true }).click();
  await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'سحب' }).first().click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('#f-cat').click();
  const opts = page.locator('[role=listbox] [role=option]');
  const shown = await opts.allInnerTexts();
  if (!cat) { await page.keyboard.press('Escape'); return shown.map((t) => t.trim()); }
  await opts.filter({ hasText: cat }).first().click();
  await modal(page).locator('#f-amount').fill('700');
  await modal(page).locator('#f-ben').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'آخر' }).first().click();
  await modal(page).locator('#f-other').fill('صاحب المحل');
  await modal(page).locator('#f-details').fill('إيجار الشهر');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  return shown.map((t) => t.trim());
}

test('decision 1: a base expense type takes a shown name; an added type is used by an expense, then removed — its row keeps it in the totals', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'أنواع المصروفات' }).click();
  await expect(body.locator('[data-expense-kind]')).toHaveText(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات']);
  // a base one: ⋮ «تغيير الاسم» only (no «حذف»)
  await body.locator('tr').filter({ has: page.locator('[data-expense-kind="الإعلانات"]') }).locator('button[aria-haspopup=menu]').click();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click();
  await modal(page).locator('input').first().fill('إعلانات ممولة');
  await modal(page).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(body.locator('[data-expense-label="الإعلانات"]')).toHaveText('إعلانات ممولة');
  await expect.poll(() => lists().labels).toEqual({ expense: { 'الإعلانات': 'إعلانات ممولة' } });
  // «+ إضافة نوع»: a new type; a base name or one already there is refused
  await body.locator('[data-expense-add]').click();
  await modal(page).locator('input').first().fill('المرتبات');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('النوع ده موجود');
  await modal(page).locator('input').first().fill('إيجار');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().expenseKinds).toEqual(['إيجار']);
  await expect(body.locator('[data-expense-kind]')).toHaveText(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات', 'إيجار']);
  expect(lists().labels).toEqual({ expense: { 'الإعلانات': 'إعلانات ممولة' } }); // the names stay
  // the accounts page: the popup offers the shown names and the added type; an expense of it is written
  await openExpenses(page);
  const offered = await addExpense(page, 'إيجار');
  expect(offered).toEqual(['المرتبات', 'المصروفات', 'الاشتراكات', 'إعلانات ممولة', 'إيجار']);
  await expect.poll(() => (mock.accWrites || []).filter((w) => w.table === 'acc_expenses').map((w) => w.category)).toEqual(['إيجار']);
  const details = page.locator('#main .table-card', { hasText: 'تفاصيل المصروفات' });
  await expect(details.locator('tbody tr')).toHaveCount(5);
  await expect(details.locator('tbody')).toContainText('إيجار');
  await expect(details.locator('tbody')).toContainText('إعلانات ممولة');
  // removed: the expense keeps its type and its amount in the totals, the add popup doesn't offer it any more
  await go(page, 'settings-lists');
  await body.getByRole('tab', { name: 'أنواع المصروفات' }).click();
  await rowMenu(page, body, '[data-expense-kind="إيجار"]', 'حذف');
  await modal(page).getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => lists().expenseKinds).toEqual([]);
  await openExpenses(page);
  await expect(details.locator('tbody')).toContainText('إيجار');
  await expect(details.locator('tfoot, tbody').last()).toContainText('700');
  const after = await addExpense(page, null);
  expect(after).toEqual(['المرتبات', 'المصروفات', 'الاشتراكات', 'إعلانات ممولة']);
  // the server (the mock's copy of 0093's guard) refuses a type nobody added
  const refused = await page.evaluate(async () => { const r = await window.IBAccounts.add('expenses', { amount: 10, date: '2026-11-01', direction: 'withdraw', category: 'نوع مش موجود', beneficiaryName: 'x', beneficiaryIsOther: true, details: 'x' }); return r && r.ok; }).catch(() => false);
  expect(refused).toBeFalsy();
});

test('decision 3: a priority gets a shown name by its code; the tickets\' tag and picker show it', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'الأولويات' }).click();
  await expect(body.locator('[data-priority]')).toHaveText(['عاجل', 'عالي', 'عادي', 'منخفض']);
  await rowMenu(page, body, '[data-priority="urgent"]', 'تغيير الاسم');
  await modal(page).locator('input').first().fill('طارئ');
  await modal(page).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(body.locator('[data-priority-label="urgent"]')).toHaveText('طارئ');
  await expect.poll(() => lists().labels).toEqual({ priority: { urgent: 'طارئ' } });
  expect(await page.evaluate(() => [window.IBUI.PriorityTag('urgent').textContent, window.IbtekrTickets.PRIORITIES[0][1], window.IbtekrTickets.PRIORITIES[0][0]])).toEqual(['طارئ', 'طارئ', 'urgent']);
  // back to its own name
  await rowMenu(page, body, '[data-priority="urgent"]', 'رجّع الاسم الأصلي');
  await expect(body.locator('[data-priority-label="urgent"]')).toHaveText('عاجل');
  await expect.poll(() => lists().labels || {}).toEqual({});
});

test('decision 2: the makers\' categories are the site\'s main categories — add / rename / delete through woo-sync; the default pick reads them', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'فئات المبتكرين' }).click();
  const names = await body.locator('[data-maker-cat]').allInnerTexts();
  expect(names).toContain('ديكور'); expect(names).toContain('هدايا');
  await body.locator('[data-maker-cat-add]').click();
  await modal(page).locator('input').first().fill('ديكور');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('الفئة دي موجودة');
  await modal(page).locator('input').first().fill('Lighting');
  await modal(page).locator('input').nth(1).fill('إضاءة');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => (mock.categoriesCreated || []).map((c) => [c.name_en, c.name_ar, c.parent])).toEqual([['Lighting', 'إضاءة', 0]]);
  await expect(body.locator('[data-maker-cat]', { hasText: 'Lighting' })).toHaveCount(1);
  const id = (mock.wooCategories.find((c) => c.name === 'Lighting') || {}).id;
  await rowMenu(page, body, '[data-maker-cat="' + id + '"]', 'تغيير الاسم');
  await modal(page).locator('input').first().fill('Lamps');
  await modal(page).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => (mock.categoryWrites || []).filter((w) => w.action === 'category_update').map((w) => w.name_en)).toEqual(['Lamps']);
  await expect(body.locator('[data-maker-cat="' + id + '"]')).toHaveText('Lamps');
  await rowMenu(page, body, '[data-maker-cat="' + id + '"]', 'حذف');
  await modal(page).getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => (mock.categoryWrites || []).filter((w) => w.action === 'category_delete').map((w) => w.id)).toEqual([id]);
  await expect(body.locator('[data-maker-cat="' + id + '"]')).toHaveCount(0);
  // the makers' default category reads the same list
  await go(page, 'settings-makers');
  await page.locator('#mk-cat').click();
  await expect(page.locator('[role=listbox] [role=option]', { hasText: 'هدايا' })).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('decision 4: the week start is a choice in «عام» (Saturday by default) — the calendar presets follow it after «حفظ»', async ({ page }) => {
  expect(await page.evaluate(() => [window.IBSettings.weekStart(), window.IbtekrDomain.presetRange('thisWeek', '2026-11-17').from])).toEqual([6, '2026-11-14']);
  await go(page, 'settings-general');
  await page.locator('#g-week').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'الأحد' }).first().click();
  await page.locator('#pg-settings [data-set-save]').click();
  await expect.poll(() => ((mock.settings.find((r) => r.section === 'general') || {}).data || {}).week).toBe('الأحد');
  // the page reads the saved row back after «حفظ» — wait for it (CI run 977 read it before the reload)
  await expect.poll(() => page.evaluate(() => [window.IBSettings.weekStart(), window.IbtekrDomain.presetRange('thisWeek', '2026-11-17').from])).toEqual([0, '2026-11-15']);
  // the other region rows stay facts with their reason
  await expect(page.locator('#pg-settings')).toContainText('المنطقة واللغة والعملة ثابتة');
});

// ش28 (the owner 16 Nov — «فورمات الوقت يبقي فيها اختيارات نظام ال12 ساعة و نظام ال24 ساعة»): the clock and the tables' date format
test('ش28: the clock (12 / 24) and the date format are choices in «اللغة والمنطقة» — the times and the tables follow after «حفظ»', async ({ page }) => {
  expect(await page.evaluate(() => [window.IBKit.t12('21:05'), window.IbtekrDomain.formatDateNumeric('2026-10-20'), window.IbtekrDomain.parseDate('2026-10-20'), window.IbtekrDomain.parseDate('20/10/2026')]))
    .toEqual(['9:05 م', '20/10/2026', '2026-10-20', '2026-10-20']);
  await go(page, 'settings-general');
  await page.locator('#g-clock').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'نظام 24 ساعة' }).click();
  await page.locator('#g-datefmt').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'سنة-شهر-يوم' }).click();
  await page.locator('#pg-settings [data-set-save]').click();
  await expect.poll(() => { const g = (mock.settings.find((r) => r.section === 'general') || {}).data || {}; return [g.clock, g.dateFmt]; }).toEqual(['24', 'ymd']);
  await expect.poll(() => page.evaluate(() => [window.IBKit.t12('21:05'), window.IBKit.t12('09:00'), window.IbtekrDomain.formatDateNumeric('2026-10-20')])).toEqual(['21:05', '09:00', '2026-10-20']);
  // every member reads them from settings_public (0114)
  expect(await page.evaluate(() => window.IBSupabase.client.rpc('settings_public').then((r) => [r.data.general.clock, r.data.general.dateFmt]))).toEqual(['24', 'ymd']);
});

test('the side menu (the owner 17 Nov — «القوائم والحالات»): rename, icon, hide, reorder, back to the original — saved in brand.menu and the menu redrawn', async ({ page }) => {
  const menu = () => (((mock.settings || []).find((r) => r.section === 'brand') || {}).data || {}).menu || null;
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'القائمة الجانبية' }).click();
  const rows = body.locator('[data-menu-item]');
  await expect(rows).toHaveCount(await page.locator('.sidebar .nav-item[data-page]').count());
  // the dashboard and the settings show always
  await expect(body.locator('[data-menu-locked="dashboard"]')).toBeVisible(); await expect(body.locator('[data-menu-locked="settings"]')).toBeVisible();
  // a name
  const lbl = body.locator('[data-menu-label="orders"]'); await lbl.fill('طلبات العملاء'); await lbl.press('Enter');
  await expect.poll(menu).toMatchObject({ items: { orders: { label: 'طلبات العملاء' } } });
  await expect(page.locator('.sidebar .nav-item[data-page="orders"]')).toContainText('طلبات العملاء');
  // an icon
  await body.locator('[data-menu-icon-btn="vendors"]').click();
  await modal(page).locator('[data-menu-icon="truck"]').click();
  await expect.poll(() => (menu() || {}).items && menu().items.vendors).toEqual({ icon: 'truck' });
  // hidden: out of the side menu, the page itself still opens by its link
  await body.locator('[data-menu-show="inventory"]').uncheck();
  await expect.poll(() => menu().items.inventory).toEqual({ hidden: true });
  await expect(page.locator('.sidebar .nav-item[data-page="inventory"]')).toHaveCount(0);
  // the order, by keyboard on the grip
  const grip = body.locator('[data-menu-item="reports"] [data-grip]'); await grip.focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(() => (menu().order || []).indexOf('reports') < (menu().order || []).indexOf('tickets')).toBe(true);
  await expect.poll(async () => { const side = await page.locator('.sidebar .nav-item[data-page]').evaluateAll((els) => els.map((e) => e.dataset.page)); return side.indexOf('reports') < side.indexOf('tickets'); }).toBe(true);
  // the original name back when the box is emptied; then everything back
  await body.locator('[data-menu-reset="vendors"]').click();
  await expect.poll(() => (menu().items || {}).vendors).toBeUndefined();
  await body.locator('[data-menu-reset-all]').click(); await page.getByRole('button', { name: 'رجّع', exact: true }).last().click();
  await expect.poll(menu).toBeNull();
  await expect(page.locator('.sidebar .nav-item[data-page="orders"]')).toContainText('الأوردرات');
  await expect(page.locator('.sidebar .nav-item[data-page="inventory"]')).toHaveCount(1);
  await expect(page.locator('#pg-settings [data-set-dirty]')).toBeHidden(); // saved on the spot — no «تغييرات مش محفوظة»
});

// the owner 18 Nov — «لما اضيف استايل جديد … ضيفه علي الويبسايت انجليزي و عربي … شوف انسب مكان تتحط فيه»; «المسح لا»
test('the owner 18 Nov: «ستايلات المنتجات» in the lists — the site\'s styles with their products; add one (English + Arabic) and rename one on the site; no delete', async ({ page }) => {
  mock.siteStyles = [{ id: 81, en: 'Bohemian', ar: 'بوهيمى', count: 2342 }, { id: 82, en: 'Modern', ar: 'مودرن', count: 353 }];
  await go(page, 'settings-lists');
  const sec = page.locator('#pg-settings');
  await sec.getByRole('tab', { name: 'ستايلات المنتجات' }).click();
  await expect(sec).toContainText('ستايلات المنتجات');
  await expect(sec.locator('[data-style-en="Bohemian"]')).toBeVisible();
  await expect(sec.locator('tr', { has: page.locator('[data-style-en="Bohemian"]') })).toContainText('2342');
  await page.locator('[data-style-add]').click();
  await modal(page).locator('input').first().fill('Rustic');
  await modal(page).locator('input').nth(1).fill('Rustic');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('اكتبه بالعربي');
  await modal(page).locator('input').nth(1).fill('ريفى');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toBeHidden();
  await expect(sec.locator('[data-style-en="Rustic"]')).toBeVisible();
  expect(mock.styleWrites).toEqual([{ action: 'style_create', en: 'Rustic', ar: 'ريفى' }]);
  await rowMenu(page, sec, '[data-style-en="Modern"]', 'تغيير الاسم');
  await expect(page.getByRole('menuitem', { name: /حذف|مسح/ })).toHaveCount(0);
  await modal(page).locator('input').nth(1).fill('حديث');
  await modal(page).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(modal(page)).toBeHidden();
  expect(mock.styleWrites.at(-1)).toEqual({ action: 'style_update', id: 82, ar: 'حديث' });
  await expect(sec.locator('[data-style-ar="Modern"]')).toHaveText('حديث');
});
