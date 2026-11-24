import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The meeting of 23 Nov — phase 5, the reports (docs/superpowers/plans/2026-11-23-meeting.md): the products' reports [#34] and the out of
// stock table [#35] on the stock page's pieces «متاح للبيع» (Safwat's answer), the returns from the lines «مرتجع», a sold product's orders,
// the orders' «مكتملة» card [#31], one «قابلة للتأخير» card on the makers' tab [#33], the accounts' two cards gone [#36]. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {
    invLots: [{ id: 'L9001', sku: 'IBTA4040PAHC000013', name: 'Cushion', reason: 'متاح للبيع', status: 'سليم' }, { id: 'L9002', sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', reason: 'متاح للبيع', status: 'سليم' }],
    invMoves: [{ lot_id: 'L9001', type: 'in', qty: 2 }, { lot_id: 'L9002', type: 'in', qty: 1 }, { lot_id: 'L9002', type: 'out', qty: 1 }],
  });
  const it = mock.orderItems.find((x) => x.id === 5001); if (it) it.status = 'مرتجع للمخزن';
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

test('[#34 #35] the products\' reports: out of stock and «قرب يخلص» from the stock page only, the returns, a sold product\'s orders', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'التقارير' }).click();
  const pr = page.locator('#pg-products');
  await expect(pr.locator('.rp-out tbody tr')).toHaveCount(1); // Macrame Curtain: 1 in, 1 out
  await expect(pr.locator('.rp-out')).toContainText('Macrame Curtain');
  await expect(pr.locator('.rp-low tbody tr')).toHaveCount(1); // Cushion: 2 pieces
  await expect(pr.locator('.rp-low')).toContainText('Cushion');
  await expect(pr.locator('.rp-out')).not.toContainText('Macrame Feathers'); // a draft is never shown
  await expect(pr.locator('.rp-ret tbody tr')).toHaveCount(1);
  await expect(pr.locator('.rp-ret')).toContainText('Cushion');
  await pr.locator('.rp-top [data-prod-orders="IBTA4040PAHC000013"]').click();
  const pop = page.locator('.modal[role=dialog]', { hasText: 'أوردرات Cushion' });
  await expect(pop.locator('tbody tr')).toHaveCount(2); // the two orders with the cushion in the range
});

test('[#31 #33 #36] the reports page: «مكتملة» with the value and the count, one «قابلة للتأخير» card, the accounts without «صافي الفترة» / «المواصلات»', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="reports"]').click();
  const R = page.locator('#reports');
  await expect(R.locator('.kpi[aria-label="مكتملة"]')).toContainText('ج.م');
  await expect(R.locator('.kpi[aria-label="مكتملة"]')).toContainText('أوردر مكتمل');
  await R.locator('[role=tab]', { hasText: 'تقارير المبتكرين' }).click();
  await expect(R.locator('.kpi[aria-label="أوردرات قابلة للتأخير — الآن"]')).toContainText('مبتكر عندهم أوردرات قابلة للتأخير');
  await expect(R.locator('.kpi[aria-label="مبتكرين عندهم أوردرات قابلة للتأخير"]')).toHaveCount(0);
  await expect(R.locator('.kpi[aria-label="عندهم أوردرات قابلة للتأخير — الآن"]')).toHaveCount(0);
  await R.locator('[role=tab]', { hasText: 'تقارير الحسابات' }).click();
  await expect(R.locator('.kpi[aria-label="حصة إبتكر من المبيعات"]')).toBeVisible();
  await expect(R.locator('.kpi[aria-label="صافي الفترة (حصة إبتكر − المصروفات)"]')).toHaveCount(0);
  await expect(R.locator('.kpi[aria-label="المواصلات"]')).toHaveCount(0);
});
