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
