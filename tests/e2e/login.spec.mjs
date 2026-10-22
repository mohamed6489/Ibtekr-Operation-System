import { test, expect } from '@playwright/test';
import { installSupabaseMock, installLiveConfig, LIVE, LIVE_MISSING } from './supabase-mock.mjs';
test.beforeEach(async ({ page }) => {
  if (!LIVE) return void (await installSupabaseMock(page));
  test.skip(!!LIVE_MISSING, LIVE_MISSING);
  await installLiveConfig(page);
});
test('login screen renders in Arabic RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('تسجيل الدخول — نظام إبتكر');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#root')).toBeHidden();
});
