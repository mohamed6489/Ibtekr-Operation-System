import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 decision 17 (the owner, 10 Nov: «لما ادوس علي اي صفحة يجيبلي الصفحة الرئيسية ليها»): a click on a menu item — the sidebar,
// the mobile bottom nav and its «المزيد» sheet — always opens the page's main view, whatever the page remembered (a tab, a product
// being edited, a campaign step, the settings section), even when it is the current page. Direct links keep opening their exact spot,
// and the unsaved-changes guard of the product editor still asks first. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const at = (page, hash) => page.evaluate((x) => { location.hash = x; }, hash);
const menu = (page, id) => page.locator('.sidebar .nav-item[data-page="' + id + '"]');
const url = (page, hash) => expect(page).toHaveURL(new RegExp('#' + hash + '$'));

// a page remembered somewhere inside → the menu opens its main view (hash + the visible main block)
const CASES = [
  ['hr', 'hr-payroll', 'hr-team', '#pg-hr'],
  ['inventory', 'inventory-moves', 'inventory-now', '#pg-inventory'],
  ['cs', 'cs-customers', 'cs-inbox', '#pg-cs'],
  ['autoreply', 'autoreply-rules', 'autoreply-templates', '#pg-autoreply'],
  ['settings', 'settings-team', 'settings', '#pg-settings'],
  ['products', 'products-trash', 'products-records', '#pg-products'],
  ['marketing', 'marketing-calendar', 'marketing-create', '#pg-marketing'],
  ['accounts', 'sales', 'expenses', '#main'],
  ['reports', 'reports-vendors', 'reports-orders', '#reports'],
];
for (const [id, inside, home, sel] of CASES) {
  test('the menu opens «' + id + '» on its main view after «' + inside + '» (from another page, and from the page itself)', async ({ page }) => {
    await signIn(page);
    await at(page, inside); await url(page, inside); await expect(page.locator(sel)).toBeVisible();
    // from the dashboard: the page used to come back where it was
    await menu(page, 'dashboard').click(); await url(page, 'dashboard');
    await menu(page, id).click(); await url(page, home); await expect(page.locator(sel)).toBeVisible();
    // back inside, then the same page's menu item
    await at(page, inside); await url(page, inside);
    await menu(page, id).click(); await url(page, home);
  });
}

test('a direct link still opens its exact spot (the menu is the only reset)', async ({ page }) => {
  await signIn(page);
  await at(page, 'hr-payroll'); await url(page, 'hr-payroll');
  await at(page, 'dashboard'); await url(page, 'dashboard');
  await at(page, 'hr-payroll'); await url(page, 'hr-payroll'); await expect(page.locator('#pg-hr')).toBeVisible();
  await at(page, 'cs-customers'); await url(page, 'cs-customers'); await expect(page.locator('#pg-cs .cs-tab-customers')).toBeVisible();
});

test('the product editor with unsaved changes asks before the menu leaves it; «ارجع للتعديل» stays, «اخرج من غير حفظ» opens the records', async ({ page }) => {
  await signIn(page);
  await menu(page, 'products').click(); await url(page, 'products-records');
  await page.waitForFunction(() => window.IBPages.all().products.api.ready());
  await at(page, 'products-edit-9001'); await url(page, 'products-edit-9001');
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await page.fill('#e-reg', '1600');
  await expect(page.locator('.unsaved')).toContainText('تعديلات');
  await menu(page, 'products').click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'تعديلات مش محفوظة' });
  await expect(m).toBeVisible();
  await m.getByRole('button', { name: 'ارجع للتعديل' }).click();
  await expect(m).toBeHidden(); await url(page, 'products-edit-9001-price');
  await menu(page, 'products').click();
  await m.getByRole('button', { name: 'اخرج من غير حفظ' }).click();
  await url(page, 'products-records');
});

test('the mobile bottom nav and its «المزيد» sheet reset the page the same way', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await at(page, 'sales'); await url(page, 'sales');
  await page.locator('.bottom-nav .bn-item[data-page="accounts"]').click(); await url(page, 'expenses');
  await at(page, 'hr-payroll'); await url(page, 'hr-payroll');
  await page.locator('.bottom-nav .bn-more button').first().click();
  await page.locator('.bn-sheet .bn-opt[data-page="hr"]').click(); await url(page, 'hr-team');
});

test('decision 21: «ملفي» in the account menu always opens «نظرة عامة», from any tab and from another page', async ({ page }) => {
  await signIn(page);
  const openMine = async () => { await page.locator('.topbar .user-btn').click(); await page.getByRole('menuitem', { name: 'ملفي' }).click(); };
  await at(page, 'profile-security'); await url(page, 'profile-security');
  await openMine(); await url(page, 'profile');
  await at(page, 'profile-hours'); await url(page, 'profile-hours');
  await menu(page, 'dashboard').click(); await url(page, 'dashboard');
  await openMine(); await url(page, 'profile'); await expect(page.locator('#pg-profile')).toBeVisible();
});
