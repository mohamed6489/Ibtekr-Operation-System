import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The meeting of 23 Nov — phase 4, the accounts (docs/superpowers/plans/2026-11-23-meeting.md): the sales' orders of the period under
// the sales [#28], the ads expenses from the platforms' daily spend [#29]. Mock only; E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local';
const cairo = (n = 0) => { const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  const day = cairo().slice(0, 8) + '01';
  mock = await installSupabaseMock(page, { mktAdStats: [{ level: 'campaign', object_id: 'c1', campaign_id: 'c1', day, spend: 700 }, { level: 'campaign', object_id: 'c2', campaign_id: 'c2', day, spend: 550.5 }, { level: 'ad', object_id: 'a1', campaign_id: 'c1', day, spend: 700 }] });
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function openAccounts(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await expect(page.locator('#main')).toBeVisible();
}
const main = (page) => page.locator('#main');

test('[#28] the sales: the orders of the period under the table, each with its status, the count in the title; a row opens the order', async ({ page }) => {
  await openAccounts(page);
  await main(page).getByRole('tab', { name: 'المبيعات' }).click();
  const card = main(page).locator('[data-sales-orders]');
  await expect(card).toBeVisible();
  const n = await page.evaluate(() => { const r = window.IBOrders.data().orders; const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); return r.filter((o) => o.date >= t.slice(0, 8) + '01' && o.date <= t).length; });
  await expect(card).toContainText('أوردرات الفترة (' + n + ')');
  await expect(card.locator('tbody tr')).toHaveCount(n);
  if (n) {
    await expect(card.locator('[data-sales-status]').first()).not.toHaveText('');
    await card.locator('[data-sales-order]').first().click();
    await expect(page.locator('#orders #cscrim #cdlg').first()).toBeVisible(); // the order's popup over the page (phase 1 [#7])
  }
});

test('[#29] the ads expenses: the platforms\' daily spend shows as «الإعلانات» rows by itself (the campaign rows summed), not editable', async ({ page }) => {
  await openAccounts(page);
  await main(page).getByRole('tab', { name: 'المصروفات' }).click();
  const row = main(page).locator('tr', { has: page.locator('[data-ad-auto="meta"]') });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('1,250.50'); await expect(row).toContainText('Meta Ads');
  await expect(row.locator('[aria-label="إجراءات الصف"]')).toHaveCount(0);
  await expect(main(page).locator('.cat-card', { hasText: 'الإعلانات' })).toContainText('1,250.50');
});
