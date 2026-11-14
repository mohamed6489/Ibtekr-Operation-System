import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md decisions 9–14) — the pages' items of the batch: the products'
// categories tab, the inventory count, the CS inbox, «مهامي», the evaluation ⋮ and the agents' chat. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, email = ADMIN) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };

test('decision 9: the categories tab — lighter levels, a small image, the slug, a checkbox with a bulk bar (parent / delete), the ⋮ menu readable on the green header, a search in the products popup', async ({ page }) => {
  mock.wooCategories.find((c) => c.id === 22).image_url = 'https://woo.test/gifts.webp';
  await signIn(page);
  await go(page, 'products-cats');
  const pg = page.locator('#pg-products');
  await expect(pg.locator('.cat-main[data-cat="22"] [data-cat-thumb="22"]')).toHaveAttribute('src', 'https://woo.test/gifts.webp');
  await expect(pg.locator('[data-cat-slug="15"]')).toHaveText('decor');
  await pg.getByRole('button', { name: 'افتح الكل' }).click();
  // the levels get lighter: «-» → «--»
  const bg = (id) => pg.locator(`.cat-sub[data-cat="${id}"]`).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(151)).toBe('rgb(239, 226, 201)'); expect(await bg(152)).toBe('rgb(245, 237, 220)');
  // the ⋮ on the green header opens a menu with the kit's dark text (not the header's beige)
  await pg.locator('.cat-main[data-cat="22"]').getByRole('button', { name: 'إجراءات القسم هدايا' }).click();
  const color = await page.getByRole('menuitem', { name: 'تعديل' }).evaluate((e) => getComputedStyle(e).color);
  expect(color).not.toBe('rgb(255, 247, 239)');
  await page.keyboard.press('Escape');
  // a new category with a bad slug is refused here; a good one is sent
  await pg.locator('[data-cat-new]').click();
  const nd = page.getByRole('dialog', { name: 'قسم رئيسي جديد' });
  await nd.locator('#en').fill('Candles'); await nd.locator('#ar').fill('شموع'); await nd.locator('#slug').fill('Candles Big');
  await nd.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(nd).toContainText('حروف إنجليزي صغيرة');
  await nd.locator('#slug').fill('decor'); await nd.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(nd).toContainText('مستخدم في قسم تاني');
  await nd.locator('#slug').fill('candles'); await nd.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(nd).toHaveCount(0);
  expect(mock.categoriesCreated.at(-1)).toMatchObject({ name_en: 'Candles', slug: 'candles' });
  // the bulk bar: «أباجورات» (no products? it has one) — move «هدايا» under «ديكور»
  await pg.locator('[data-cat-cb="22"] [role=checkbox]').click();
  await expect(pg.locator('[data-cat-bulk-bar]')).toContainText('محدد 1');
  await pg.locator('[data-cat-bulk-parent]').click();
  const pd = page.getByRole('dialog', { name: /تغيير القسم الأب/ });
  await pd.locator('#cat-new-parent').click(); await page.getByRole('option', { name: 'ديكور', exact: true }).click();
  await pd.getByRole('button', { name: 'انقل' }).click();
  await expect(pd).toHaveCount(0);
  await expect.poll(() => mock.categoryWrites.at(-1)).toMatchObject({ action: 'category_update', id: 22, parent: 15 });
  await expect(pg.locator('.cat-sub[data-cat="22"]')).toHaveCount(1); // now a sub-category of «ديكور»
  // a category the products use cannot go: the bulk delete says so, nothing sent
  await pg.locator('[data-cat-cb="151"] [role=checkbox]').click();
  await pg.locator('[data-cat-bulk-del]').click();
  await expect(page.locator('[data-cat-blocked]')).toBeVisible();
  await page.locator('[data-cat-blocked]').getByRole('button', { name: 'تمام' }).click();
  // the products popup searches by the name or the SKU
  await pg.locator('[data-cat-prods="15"]').click();
  const pp = page.locator('[data-cat-prods-pop="15"]');
  const n0 = await pp.locator('tbody tr').count(); expect(n0).toBeGreaterThan(0);
  await pp.locator('[data-cat-prods-q]').fill('zzzz-nothing');
  await expect(pp.locator('[data-cat-prods-none]')).toBeVisible();
  await pp.locator('[data-cat-prods-q]').fill('');
  await expect(pp.locator('tbody tr')).toHaveCount(n0);
});
