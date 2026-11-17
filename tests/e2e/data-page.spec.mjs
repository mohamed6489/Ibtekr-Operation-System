import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// docs/superpowers/plans/2026-11-16-data-page.md: «القوائم والحالات» as a side menu; «البيانات» in tabs; the import by ID (a row with an ID
// edits its filled cells only through the page's own adapter, a row with no ID is new); the Excel template; «منطقة الخطر» (0117). Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const open = async (page, s) => { await page.evaluate((x) => { location.hash = 'settings-' + x; }, s); await expect(page.locator('#pg-settings .set-page')).toBeVisible(); };
const modal = (page) => page.locator('.modal').last();

test('decision 1: «القوائم والحالات» — the lists in a side menu by group with their counts; a list opens beside it', async ({ page }) => {
  await signIn(page); await open(page, 'lists');
  const nav = page.locator('[data-lists-nav]');
  await expect(nav.locator('.lst-gt')).toHaveText(['الحالات', 'الأسباب', 'قوائم تانية', 'شكل السيستم']); // the owner 17 Nov: «القائمة الجانبية» in its own group
  await expect(nav.getByRole('tab')).toHaveCount(11);
  await expect(nav.getByRole('tab', { name: /أسباب الإلغاء/ }).locator('.lst-n')).toBeVisible();
  await nav.getByRole('tab', { name: /شركات الشحن/ }).click();
  await expect(nav.getByRole('tab', { name: /شركات الشحن/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-lists="shipping"] .lst-main')).toContainText('شركات الشحن');
});

test('decisions 2, 3 and 5: «البيانات» in tabs; the template popup has the ID first and downloads an Excel file; the import edits a maker by its ID (the filled cells only) and adds a new one', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await expect(page.locator('[data-dtab]')).toHaveText(['تصدير', 'استيراد', 'القوالب', 'النسخة الكاملة', 'منطقة الخطر']);
  await page.locator('[data-dtab="import"]').click();
  await expect(page.locator('[data-dx-howto] li')).toHaveCount(3);
  await page.locator('#d-set').click(); await page.getByRole('option', { name: 'المبتكرين والنسب' }).click();
  // the template
  await page.locator('[data-tpl-open="vendors"]').click();
  const tpl = modal(page);
  await expect(tpl.locator('[data-tpl-kind]')).toHaveCount(2);
  await expect(tpl.locator('table.dx-cols tbody tr').first()).toContainText('ID');
  const [dl] = await Promise.all([page.waitForEvent('download'), tpl.locator('[data-tpl-go]').click()]);
  expect(dl.suggestedFilename()).toMatch(/^ibtekr-vendors-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await tpl.locator('.btn-text', { hasText: 'إغلاق' }).click();
  // a file: the first maker by its ID with a new lead time (its name cell empty = kept), and a new maker
  const info = await page.evaluate(() => { const g = window.IBData.group('vendors'); const r = g.rows()[0]; const cat = g.fields().find((f) => f.key === 'category').options[0]; return { id: r._id, name: r.name, lead: r.leadDays, cat }; });
  const lead = Number(info.lead || 0) + 3;
  const text = ['ID (ماتغيّروش)\tاسم المبتكر\tالفئة الأساسية\tالحالة\tالموبايل (واتساب)\tنسبة إبتكر %\tمدة التجهيز (يوم)', info.id + '\t\t\t\t\t\t' + lead, '\tورشة الاستيراد\t' + info.cat + '\tنشط\t01011112222\t30\t9'].join('\n');
  await page.locator('[data-import]').click();
  const wz = modal(page);
  await wz.locator('.dx-paste summary').click(); await wz.locator('#imp-paste').fill(text);
  await wz.getByRole('button', { name: 'التالي', exact: true }).click();
  await wz.getByRole('button', { name: 'التالي: المراجعة' }).click();
  await expect(wz.locator('[data-dx-show="update"] b')).toHaveText('1');
  await expect(wz.locator('[data-dx-show="new"] b')).toHaveText('1');
  await expect(wz.locator('.dx-chg-row')).toContainText('مدة التجهيز');
  await wz.locator('[data-imp-go]').click();
  await expect(wz.locator('.dx-stat.gold b')).toHaveText('1');
  await expect(wz.locator('.dx-stat.success b')).toHaveText('1');
  await expect.poll(() => page.evaluate((id) => window.IBVendors.store.get(id).leadDays, info.id)).toBe(lead);
  expect(await page.evaluate((id) => window.IBVendors.store.get(id).name, info.id)).toBe(info.name);
  await expect.poll(() => page.evaluate(() => !!window.IBVendors.store.findByName('ورشة الاستيراد'))).toBe(true);
});

test('decision 3: an unknown ID, or a row with no ID on a sheet that only edits, is an error in the review and nothing is written', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="import"]').click();
  await page.locator('#d-set').click(); await page.getByRole('option', { name: 'بيانات المبتكرين الحساسة' }).click();
  await page.locator('[data-import]').click();
  const wz = modal(page);
  await wz.locator('.dx-paste summary').click(); await wz.locator('#imp-paste').fill('ID (ماتغيّروش)\tالبنك\nnot-a-real-id\tبنك مصر');
  await wz.getByRole('button', { name: 'التالي', exact: true }).click();
  await wz.getByRole('button', { name: 'التالي: المراجعة' }).click();
  await expect(wz.locator('[data-dx-show="error"] b')).toHaveText('1');
  await expect(wz.locator('.dx-errs')).toContainText('مش موجود');
  await expect(wz.locator('[data-imp-go]')).toBeDisabled();
});

test('decision 6: «منطقة الخطر» — pick sections, the review lists the tables, the phrase unlocks the wipe (data_wipe), then the page reloads', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="danger"]').click();
  const dz = page.locator('[data-danger-zone]');
  await expect(dz.locator('[data-wipe]')).toHaveCount(10);
  await expect(dz.locator('[data-wipe-go]')).toBeDisabled();
  await dz.locator('[data-wipe="orders"] input').check(); await dz.locator('[data-wipe="tickets"] input').check();
  await dz.locator('[data-wipe-go]').click();
  const md = modal(page);
  await expect(md.locator('.dz-tables tbody tr')).toHaveCount(2);
  const go = md.locator('[data-wipe-confirm]');
  await expect(go).toBeDisabled();
  await md.locator('#wipe-confirm').fill('امسح');
  await expect(go).toBeDisabled();
  await md.locator('#wipe-confirm').fill('امسح البيانات');
  await Promise.all([page.waitForEvent('load'), go.click()]);
  expect(mock.st.wipes).toEqual([['orders', 'tickets']]);
});
