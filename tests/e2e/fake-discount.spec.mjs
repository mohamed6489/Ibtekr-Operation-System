import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «الخصم الوهمي» بالشرايح (the owner 15 Nov — docs/superpowers/plans/2026-11-15-fake-discount.md): «نحط ف الاعدادات حاجة لحساب الخصم
// الوهمي الافتراضي و اعدل رينج النسبة او الرقم … و اقدر اضيف ارقام زي منا ما عايز و اختار كلمة فيما فوق ف اخر واحدة … كمان اقدر
// اعدلها من خطوة … الاسعار». Mock only.
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
const row = (s) => (mock.settings.find((x) => x.section === s) || {}).data || {};
// the owner's own example: 0–1000 → +500 · 1001–2000 → +1000 · 2001 فيما فوق → +1500
const OWNER = { tiers: [{ to: 1000, type: 'amount', value: 500 }, { to: 2000, type: 'amount', value: 1000 }, { to: null, type: 'amount', value: 1500 }] };

test('settings › إعدادات المبتكرين: the default tiers — the owner\'s three, «فيما فوق» on the last, a percent, the checks, and back to the old way', async ({ page }) => {
  await go(page, 'settings-makers');
  const st = page.locator('#pg-settings');
  const card = st.locator('.card.sec', { hasText: 'الخصم الوهمي الافتراضي' });
  await expect(card).toContainText('مفيش شرايح');
  expect(await page.evaluate(() => window.IBFakeDiscount.rule())).toBe(null);
  await card.locator('[data-fake-edit]').click();
  const f = modal(page).filter({ hasText: 'الخصم الوهمي الافتراضي' });
  // it opens with one tier, «فيما فوق»
  await expect(f.locator('[data-fk-row]')).toHaveCount(1);
  await expect(f.locator('[data-fk="open"]')).toBeChecked();
  await f.locator('[data-fk="val:1"]').fill('500');
  await f.locator('[data-fk-add]').click(); // «فيما فوق» moves to the new last tier
  await expect(f.locator('[data-fk-row]')).toHaveCount(2);
  await f.locator('[data-fk="to:1"]').fill('1000');
  await expect(f.locator('[data-fk-from="2"]')).toHaveText('1,001');
  await f.locator('[data-fk="val:2"]').fill('1000');
  await f.locator('[data-fk-add]').click();
  await f.locator('[data-fk="val:3"]').fill('1500');
  // the checks: the second tier has no end yet; an end not above the one before it
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f.locator('[data-fk-err="to:2"]')).toHaveText('اكتب آخر سعر في الشريحة');
  await f.locator('[data-fk="to:2"]').pressSequentially('900'); // the field is drawn again on the first key — the typing goes on
  await expect(f.locator('[data-fk="to:2"]')).toHaveValue('900');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f.locator('[data-fk-err="to:2"]')).toHaveText('لازم يبقى أكبر من 1,000');
  await f.locator('[data-fk="to:2"]').fill('2000');
  await expect(f.locator('[data-fk-from="3"]')).toHaveText('2,001');
  await expect(f.locator('[data-fk-open-text]')).toHaveText('فيما فوق');
  // «جرّب بسعر بيع»
  await f.locator('[data-fk="sample"]').fill('1200');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 1,200 ← قبل الخصم 2,200 ج.م');
  await f.locator('[data-fk="sample"]').fill('5000');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 5,000 ← قبل الخصم 6,500 ج.م');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f).toBeHidden();
  await expect.poll(() => row('makers').fake).toEqual(OWNER);
  await expect(card.locator('[data-fake-range]')).toHaveText(['من 0 لـ 1,000', 'من 1,001 لـ 2,000', 'من 2,001 فيما فوق']);
  await expect(card.locator('[data-fake-add]')).toHaveText(['+ 500 ج.م', '+ 1,000 ج.م', '+ 1,500 ج.م']);
  expect(await page.evaluate(() => window.IBFakeDiscount.rule())).toEqual(OWNER);
  // every price worked out from the maker's price takes it: 700 at 30% → sale 1,000 → 1,500
  expect(await page.evaluate(() => window.IbtekrProducts.priceFromVendor(700, { rate: 30, fee: 0, markup: 20, fake: window.IBFakeDiscount.rule() }))).toMatchObject({ sale: 1000, regular: 1500 });
  // the delay rules beside it were not touched by the save
  expect(row('makers').delay == null || typeof row('makers').delay === 'object').toBe(true);

  // a percent on the middle tier; «فيما فوق» off = prices above the last tier go the old way
  await card.locator('[data-fake-edit]').click();
  await expect(f.locator('[data-fk-row]')).toHaveCount(3);
  await f.locator('[data-fk="type:2:percent"]').click();
  await expect(f.locator('[data-fk="type:2:percent"]')).toHaveAttribute('aria-pressed', 'true');
  await f.locator('[data-fk="val:2"]').fill('50');
  await f.locator('[data-fk="open"]').uncheck();
  await f.locator('[data-fk="to:3"]').fill('3000');
  await f.locator('[data-fk="sample"]').fill('1210');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 1,210 ← قبل الخصم 1,820 ج.م'); // 1,815 up to the next 10
  await f.locator('[data-fk="sample"]').fill('4000');
  await expect(f.locator('[data-fk-sample]')).toContainText('أعلى من آخر شريحة');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => (row('makers').fake || {}).tiers).toEqual([{ to: 1000, type: 'amount', value: 500 }, { to: 2000, type: 'percent', value: 50 }, { to: 3000, type: 'amount', value: 1500 }]);
  await expect(card.locator('[data-fake-add]')).toHaveText(['+ 500 ج.م', '+ 50%', '+ 1,500 ج.م']);

  // every tier removed = the old way (sale + 15–30%)
  await card.locator('[data-fake-edit]').click();
  for (let i = 0; i < 3; i += 1) await f.locator('[data-fk-del="1"]').click();
  await expect(f.locator('[data-fk-empty]')).toBeVisible();
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(card).toContainText('مفيش شرايح');
  await expect.poll(() => row('makers').fake == null).toBe(true);
  // the activity log names the count only
  const logged = mock.activity.filter((a) => a.action === 'settings.change').map((a) => JSON.stringify(a));
  expect(logged.some((t) => /الخصم الوهمي = 3 شريحة/.test(t))).toBe(true);
});
