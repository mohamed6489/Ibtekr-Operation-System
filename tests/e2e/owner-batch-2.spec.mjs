import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner's second batch of 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch-2.md). Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
const modal = (page) => page.locator('.modal[role=dialog]');

test('T1 — decisions 1, 8, 18, 20, 30, 31, 29: no compact rows, the save popup, the makers settings and the data page trimmed, no «null» in the template popup', async ({ page }) => {
  // 1. «الوضع المضغوط للجداول» is gone
  await go(page, 'settings-general');
  await expect(page.locator('#pg-settings')).not.toContainText('الوضع المضغوط');
  // 8. a change, then «رجوع»: «احفظ واخرج» first (the right one in RTL), «تجاهل التغييرات» second; no «ارجع للصفحة»
  await page.locator('#g-co').fill('إبتكر تجربة');
  await page.locator('[data-set-back]').click();
  const ask = modal(page).filter({ hasText: 'لازم تحفظ التغييرات الأول' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.modal-f button, footer button, .modal-foot button').first()).toHaveText(/احفظ واخرج/);
  await expect(ask.getByRole('button', { name: 'ارجع للصفحة' })).toHaveCount(0);
  const [save, drop] = [ask.locator('[data-save-now]'), ask.locator('[data-save-discard]')];
  const xs = await Promise.all([save.evaluate((b) => b.getBoundingClientRect().left), drop.evaluate((b) => b.getBoundingClientRect().left)]);
  expect(xs[0]).toBeGreaterThan(xs[1]); // «احفظ واخرج» right of «تجاهل التغييرات»
  await drop.click();
  await expect(page.locator('#pg-settings [data-set-jump]')).toBeVisible(); // out to the hub
  await go(page, 'settings-general');
  await expect(page.locator('#g-co')).not.toHaveValue('إبتكر تجربة');
  // 18 + 20. the makers settings: no «إيقاف تنشيط مبتكر», no coverage table
  await go(page, 'settings-makers');
  await expect(page.locator('#pg-settings')).not.toContainText('إيقاف تنشيط مبتكر');
  await expect(page.locator('#pg-settings .mk-cover')).toHaveCount(0);
  // 30 + 31. the data page: no «عرض النسخ السابقة»; the full copy is a regular section
  await go(page, 'settings-data');
  await expect(page.locator('#pg-settings')).not.toContainText('عرض النسخ السابقة');
  await expect(page.locator('#pg-settings .card.sec', { hasText: 'نسخة كاملة من البيانات' })).toHaveCount(1);
  // 29. the template popup never shows «null»
  await page.locator('[data-tpl$=":update"]').first().click();
  await expect(modal(page).last()).toBeVisible();
  await expect(modal(page).last()).not.toContainText('null');
});

test('T1 — decisions 6 and 34: a work day picked is green with beige text; what is selected is light beige with a thick green border', async ({ page }) => {
  await go(page, 'settings-hr');
  const day = page.locator('#pg-settings [data-hs-day][aria-checked=true]').first();
  await expect(day).toHaveCSS('background-color', 'rgb(0, 86, 66)');
  // a picked option in a list
  await go(page, 'settings-general');
  await page.locator('#g-week').click();
  const opt = page.locator('[role=listbox] [role=option][aria-selected=true]').first();
  await expect(opt).toHaveCSS('background-color', 'rgb(246, 234, 214)');
  await expect(opt).toHaveCSS('color', 'rgb(0, 86, 66)');
  await page.keyboard.press('Escape');
});

const lists = () => ((mock.settings || []).find((r) => r.section === 'lists') || {}).data || {};

test('T2 — decision 22: an order status added «بتتحسب زي» a base one; the orders page offers it and writes it as its base + status_custom; in use it is not deleted', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  const add = body.locator('[data-status-add="order"]');
  await expect(add).toBeEnabled(); // status_map read live
  await add.click();
  await modal(page).locator('#name').fill('متابعة');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('اختار الحالة الأساسية'); // the base is required
  await modal(page).locator('#base').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'جاري التنفيذ' }).first().click();
  await modal(page).locator('#slug').fill('Bad Slug');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('حروف إنجليزي صغيرة');
  await modal(page).locator('#slug').fill('');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(body.locator('[data-status="متابعة"]')).toHaveCount(1);
  expect(mock.statusMap.find((r) => r.system_status === 'متابعة')).toMatchObject({ base: 'جاري التنفيذ', woo_status: null });
  await expect(body.locator('[data-status-slug="متابعة"]')).toHaveText('processing'); // its base's slug
  // a base status: no «حذف»; the added one: «حذف»
  await body.locator('tr').filter({ has: page.locator('[data-status="مكتمل"]') }).locator('button[aria-haspopup=menu]').click();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // the orders page: the dropdown offers it; picking it writes the base + the added one and pushes the added one
  await go(page, 'orders');
  const sel = page.locator('#orders select[data-st="181668"]').first();
  await expect(sel.locator('option', { hasText: 'متابعة' })).toHaveCount(1);
  await sel.selectOption('متابعة');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders')).toEqual([{ table: 'orders', id: 181668, status: 'جاري التنفيذ', status_custom: 'متابعة' }]);
  await expect.poll(() => mock.pushes.map((p) => [p.order_id, p.status])).toEqual([[181668, 'متابعة']]);
  await expect(page.locator('#orders .card').filter({ hasText: 'IB-181668' }).first()).toContainText('متابعة');
  // in use → not deleted
  await go(page, 'settings-lists');
  await body.locator('tr').filter({ has: page.locator('[data-status="متابعة"]') }).locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  await modal(page).getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'عليها أوردرات' }).first()).toBeVisible();
  expect(mock.statusMap.some((r) => r.system_status === 'متابعة')).toBe(true);
  // back to a base status: status_custom cleared
  await go(page, 'orders');
  await page.locator('#orders select[data-st="181668"]').first().selectOption('جاهز للشحن');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders').slice(-1)[0]).toEqual({ table: 'orders', id: 181668, status: 'جاهز للشحن', status_custom: null });
  expect(mock.orders.find((o) => o.id === 181668).status_custom).toBe(null);
});

test('T2 — decision 22: confirmation and product statuses added in the settings show in the orders page; a base one has no «حذف»', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'حالات التأكيد' }).click();
  await body.locator('[data-status-add="confirm"]').click();
  await modal(page).locator('#v').fill('غير مؤكد');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('فيه حالة بالاسم ده');
  await modal(page).locator('#v').fill('بيفكر');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().statusAdded).toEqual({ confirm: ['بيفكر'], sub: [] });
  await expect(body.locator('[data-status]')).toHaveText(['مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد', 'بيفكر']);
  await body.getByRole('tab', { name: 'حالات المنتج' }).click();
  await body.locator('[data-status-add="sub"]').click();
  await modal(page).locator('#v').fill('في التغليف');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().statusAdded).toEqual({ confirm: ['بيفكر'], sub: ['في التغليف'] });
  await go(page, 'orders');
  await expect(page.locator('#orders select[data-cf="181668"]').first().locator('option', { hasText: 'بيفكر' })).toHaveCount(1);
  await page.locator('#orders select[data-cf="181668"]').first().selectOption('بيفكر');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders').map((p) => p.confirm)).toEqual(['بيفكر']);
});
