import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 12 Nov («ضيف شادو لكل الأقسام بنفس المثال والقيم المرفوعة عشان يعمل فاصل عن الخلفية… على كل صفحات السيستم»): every section
// card carries the drop shadow of his Figma example — X 0 · Y 0 · blur 6 · spread 0 · #000000 at 25% — the kit's .card everywhere, the
// messages box, and the orders page's own cards and status strip (its own stylesheet). Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
const SHADOW = 'rgba(0, 0, 0, 0.25) 0px 0px 6px 0px';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

test('the section cards, the KPI tiles, the messages box and the orders page\'s cards carry the same drop shadow', async ({ page }) => {
  await page.evaluate(() => { location.hash = 'acc-overview'; });
  await expect(page.locator('#main .table-card').first()).toHaveCSS('box-shadow', SHADOW);
  await expect(page.locator('#main .card.kpi').first()).toHaveCSS('box-shadow', SHADOW);
  await page.evaluate(() => { location.hash = 'cs-inbox'; });
  await expect(page.locator('#pg-cs .cs-inbox')).toHaveCSS('box-shadow', SHADOW);
  await page.evaluate(() => { location.hash = 'orders'; });
  const card = page.locator('#orders .card').first(); // the orders page's own stylesheet (inside its shadow root)
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('box-shadow', SHADOW);
  await expect(page.locator('#orders .toolbar').first()).toHaveCSS('box-shadow', SHADOW);
});
