import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE } from './supabase-mock.mjs';
test.beforeEach(async ({ page }) => { if (!LIVE) await installSupabaseMock(page); });
test('login screen renders in Arabic RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('تسجيل الدخول — نظام إبتكر');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#root')).toBeHidden();
});
