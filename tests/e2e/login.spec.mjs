import { test, expect } from '@playwright/test';
test('login screen renders in Arabic RTL', async ({ page }) => {
  await page.goto('/#login');
  await expect(page).toHaveTitle('تسجيل الدخول — نظام إبتكر');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#root')).toBeHidden();
});
