import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 decision 19 (the owner, 10 Nov: «اعملي للبوب أب maximum height يبقى 80% بحيث يسيب 10% و10% تحت»): a popup is at most 80% of
// the screen's height and sits in the middle — 10% above and 10% below — on a desktop and on a phone; the kit's Modal and the orders' own
// popups (the order details) alike. A tall body scrolls inside. Mock only.
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
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function inBand(page, locator) {
  const vh = page.viewportSize().height; const b = await locator.boundingBox();
  expect(b.height).toBeLessThanOrEqual(vh * 0.8 + 1);
  expect(b.y).toBeGreaterThanOrEqual(vh * 0.1 - 1);
  expect(b.y + b.height).toBeLessThanOrEqual(vh * 0.9 + 1);
}

for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
  test('a tall popup stays within 80% of the screen, centred (' + label + ')', async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page);
    // the kit's Modal with a long body: capped, the body scrolls
    await page.evaluate(() => { const U = window.IBUI; U.Modal({ title: 'بوب أب طويل', body: Array.from({ length: 60 }, (_, i) => U.h('p', null, 'سطر ' + (i + 1))), footer: [U.Button({ label: 'إغلاق' })] }); });
    const modal = page.locator('.modal[role=dialog]', { hasText: 'بوب أب طويل' });
    await expect(modal).toBeVisible();
    await inBand(page, modal);
    expect(await modal.locator('.modal-b').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(modal.locator('.modal-f')).toBeInViewport();
    await page.keyboard.press('Escape');
    // the orders' own popup (the order details, in its shadow root)
    await page.waitForFunction(() => window.OrdersApp && window.OrdersApp.query({}, 1).rows.length > 0);
    await page.evaluate(() => { const A = window.OrdersApp; A.details(A.query({}, 1).rows[0].id, 'subs'); });
    const dlg = page.locator('#orders #cdlg');
    await expect(dlg).toBeVisible();
    await inBand(page, dlg);
  });
}
