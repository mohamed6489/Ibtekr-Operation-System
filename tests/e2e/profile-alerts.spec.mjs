import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 — «ملفي»: decision 26 («عايز تنبيهات اللي هي إشعارات وتبقى متقسمة تابات حسب النوع»; the mute table removed): «تنبيهاتي» lists the
// bell's own items as tabs by type, each opening its place; decision 27 («زرار تخصيص اللوحة … وإمكانية إظهار عدد التنبيهات أو الطلبات»):
// «نظرة عامة» has «تخصيص اللوحة» and two cards — my alerts and my open requests; decision 29 («خلي السيرش align right والباقي align left»):
// the header search on the right, the other header items together on the left. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function open(page, hash) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const P = (page) => page.locator('#pg-profile');

test('decision 26: «تنبيهاتي» is my notifications by type — no mute table; a type tab narrows the list; an item opens its place', async ({ page }) => {
  await open(page, 'profile-alerts');
  await expect(P(page)).toContainText('تنبيهاتي');
  await expect(P(page)).not.toContainText('اللي بستلمه');
  await expect(P(page).locator('[role=switch]')).toHaveCount(0);
  const items = P(page).locator('[data-ntf-item]');
  await expect(items.first()).toBeVisible();
  const all = await items.count();
  await expect(P(page).getByRole('tab', { name: /^الكل/ })).toHaveAttribute('aria-selected', 'true');
  // the server alert (the admins' «فشل مزامنة WooCommerce») is in the list and opens its place
  const woo = items.filter({ hasText: 'فشل مزامنة WooCommerce' });
  await expect(woo).toHaveCount(1);
  // another type tab: fewer (or as many) items, all of that type
  const tabs = P(page).getByRole('tablist', { name: 'أنواع التنبيهات' }).getByRole('tab');
  expect(await tabs.count()).toBeGreaterThan(1);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await items.count()).toBeLessThanOrEqual(all);
  await tabs.first().click();
  await woo.click();
  await expect(page).toHaveURL(/#settings-integrations$/);
});

test('decision 27: «نظرة عامة» shows my alerts and my open requests, and «تخصيص اللوحة» hides a card for me', async ({ page }) => {
  await open(page, 'profile');
  const tile = (t) => P(page).locator('.sum-tile', { hasText: t });
  await expect(tile('التنبيهات')).toBeVisible();
  await expect(tile('طلباتي المفتوحة')).toBeVisible();
  await page.locator('[data-pn-custom="profile:overview"]').click();
  const modal = page.locator('.modal[role=dialog]', { hasText: 'تخصيص اللوحة' });
  await modal.locator('[data-pn-item="التنبيهات"]').getByRole('switch').click();
  await modal.getByRole('button', { name: 'حفظ' }).click();
  await expect(tile('التنبيهات')).toBeHidden();
  await expect(tile('طلباتي المفتوحة')).toBeVisible();
  await expect.poll(() => { const p = mock.prefs.find((x) => x.key === 'panel.prefs' && x.user_id === ADMIN_ID); return p && p.data['profile:overview'] && p.data['profile:overview'].hidden; }).toEqual(['التنبيهات']);
  await tile('طلباتي المفتوحة').click();
  await expect(page).toHaveURL(/#profile-requests$/); // the owner 11 Nov: «ملفي › طلباتي» (my team requests)
  await expect(P(page).getByRole('tab', { name: 'طلباتي' })).toHaveAttribute('aria-selected', 'true');
});

test('decision 29: the header search sits on the right and every other header item together on the left', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await open(page, 'dashboard');
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const bar = await box('.topbar'); const search = await box('.topbar .gq-wrap'); const user = await box('.topbar .user-btn');
  expect(search.x + search.width).toBeGreaterThan(bar.x + bar.width - 40); // the search against the right edge
  expect(user.x).toBeLessThan(bar.x + 60);                                  // the last item against the left edge
});

// decision 30 (owner 10 Nov — «في حالة الضغط على زرار ملفي بيظهر بيانات المستخدم ومعلوماته مش معلومات الأدمن، وخلي الاسم والإيميل يبقوا رايت»):
// a page opened on #profile before the sign-in kept the default M01 as «me», so another member saw M01's file as an admin view
test('decision 30: «ملفي» is the signed-in member, even when #profile was the hash before the sign-in; the menu head sits on the right', async ({ page }) => {
  await page.goto('/#profile');
  await page.fill('#lg-id', 'ops.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.getByRole('button', { name: /^حسابي/ }).click();
  const head = page.locator('.acct-h');
  await expect(head).toContainText('سارة أحمد'); await expect(head).toContainText('ops.dev@ibtekr.local');
  for (const sel of ['b', 'small']) expect(await head.locator(sel).evaluate((n) => getComputedStyle(n).textAlign)).toBe('right');
  // the e-mail's right edge lines up with the name's (both on the right of the menu)
  const [b, s] = await Promise.all([head.locator('b').boundingBox(), head.locator('small').boundingBox()]);
  const hb = await head.boundingBox();
  expect(Math.abs((b.x + b.width) - (s.x + s.width))).toBeLessThan(40); expect(hb.x + hb.width - (b.x + b.width)).toBeLessThan(30);
  await page.getByRole('menuitem', { name: 'ملفي' }).click();
  await expect(P(page).locator('.prof-head h1')).toHaveText('سارة أحمد');
  await expect(P(page)).not.toContainText('بتشوف ملف');
  await expect(page).toHaveURL(/#profile$/);
});
