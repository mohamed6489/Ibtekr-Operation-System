import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, BRAND } from './supabase-mock.mjs';

// The meeting of 23 Nov — phase 3, the makers (docs/superpowers/plans/2026-11-23-meeting.md): the register's two cards [#16], the
// stopped makers with a balance in the makers' accounts [#17], the withdraw request in two columns with the new statuses and
// «داخلي» [#19], the request's own popup [#20], the renames [#21 #22], «حالة العقد» [#23], «مستحقاته» from the join date [#24], the
// overview's four tables [#25], the tags with «+N» [#26], no «كشف بالفترة» [#27]. Mock only; E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003'; // Art Craft, Antikiano, Bian eg (inactive)
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {
    dokanBalances: [{ vendor_id: V1, woo_vendor_id: 2376, balance: 2500, earning: 9000, sales: 11000, orders: 12, synced_at: '2026-10-27T10:00:00Z' },
      { vendor_id: V3, woo_vendor_id: 2047, balance: 180, earning: 180, sales: 600, orders: 1, synced_at: '2026-10-27T10:00:00Z' }],
    dokanWithdrawals: [{ id: 501, woo_vendor_id: 2376, vendor_id: V1, amount: 1200, charge: 0, receivable: 1200, status: 'pending', method: 'bank', requested_at: '2026-10-25 12:00:00', synced_at: '2026-10-27T10:00:00Z' },
      { id: 400, woo_vendor_id: 44, vendor_id: V2, amount: 300, charge: 0, receivable: 300, status: 'cancelled', method: 'bank', requested_at: '2026-10-01 12:00:00', synced_at: '2026-10-27T10:00:00Z' },
      { id: 610, woo_vendor_id: 44, vendor_id: V2, amount: 2000, charge: 0, receivable: 2000, status: 'approved', method: 'bank', requested_at: '2026-10-20 12:00:00', synced_at: '2026-10-27T10:00:00Z', internal: true }],
  });
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page, email = ADMIN) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const vtab = (page, label) => page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: label });
const row = (page, id) => page.locator(`#vendors tr[data-id="${id}"]`);
async function openMakers(page) {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="vendors"]').click();
  await expect(page.locator('#vendors')).toBeVisible();
}

test('[#16 #23 #24 #26] the register: «نشطين» / «غير نشطين», «حالة العقد», «مستحقاته» from the join date, no «العربون» / «المواصلات», the tags fold at 3 with «+N» / «إظهار أقل»', async ({ page }) => {
  ['Wood & Rope', 'Nile Glass', 'Cairo Clay', 'Desert Loom'].forEach((name, i) => {
    mock.brands.push({ id: BRAND(20 + i), name, code: 'X' + i, aliases: [], store_vendor_id: null, origin_vendor_id: V1, created_by: 'system', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
    mock.brandOwners.push({ id: 20 + i, brand_id: BRAND(20 + i), vendor_id: V1, since: '2026-03-01', return_on: null, reason: null, set_by: 'system', created_at: '2026-10-01T00:00:00Z' });
  });
  await openMakers(page);
  await vtab(page, 'سجل المبتكرين').click();
  const cards = page.locator('#vendors [data-vrec-cards] .kpi');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('نشطين'); await expect(cards.nth(0)).toContainText('2');
  await expect(cards.nth(1)).toContainText('غير نشطين'); await expect(cards.nth(1)).toContainText('1');
  const head = page.locator('#vendors table thead');
  await expect(head).toContainText('الأقسام'); await expect(head).toContainText('حالة العقد'); await expect(head).toContainText('مستحقاته (من تاريخ الانضمام)');
  await expect(head).not.toContainText('العربون'); await expect(head).not.toContainText('المواصلات');
  await expect(row(page, V1).locator('[data-contract]')).toHaveText('مش مرفوع');
  await expect(row(page, V2).locator('[data-contract]')).toHaveText('بينتهي خلال شهر'); // the mock's contract ends in 20 days
  // the brands: 5 of them → 3 and «+2»; it spreads them in the cell and the last tag folds them back; the drawer stays shut
  const tags = row(page, V1).locator('[data-brands]');
  await expect(tags.locator('.chip:not(.chip-more)')).toHaveCount(3);
  await expect(tags.locator('[data-tags-more]')).toHaveText('+2');
  await tags.locator('[data-tags-more]').click();
  await expect(row(page, V1).locator('[data-brands] .chip:not(.chip-more)')).toHaveCount(5);
  await expect(row(page, V1).locator('[data-brands] [data-tags-more]')).toHaveText('إظهار أقل');
  await expect(page.locator('.drawer')).toHaveCount(0);
  await row(page, V1).locator('[data-brands] [data-tags-more]').click();
  await expect(row(page, V1).locator('[data-brands] .chip:not(.chip-more)')).toHaveCount(3);
  // the filter: «حالة العقد» is a group of it
  await page.locator('#vendors [data-fm-btn="vendors"]').click();
  const menu = page.locator('[data-fm-menu="vendors"]');
  await menu.locator('[data-fm-tab="contract"]').click();
  await menu.locator('[data-fm="contract:expiring"]').click();
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 1 مبتكر');
});

test('[#25 #24] the overview: four tables on the page\'s period — the top sales, the late, the dues (the same number as the card), the contracts about to end', async ({ page }) => {
  await openMakers(page);
  for (const k of ['sales', 'late', 'dues', 'contracts']) await expect(page.locator(`#vendors [data-ov-table="${k}"]`)).toBeVisible();
  await expect(page.locator('#vendors [data-ov-period] .date-field')).toBeVisible();
  await expect(page.locator('#vendors [data-ov-table="contracts"] tbody tr')).toHaveCount(1);
  await expect(page.locator('#vendors [data-ov-table="contracts"]')).toContainText('Antikiano');
  await expect(page.locator('#vendors .kpi[aria-label="إجمالي مستحقات المبتكرين — الآن"]')).toContainText('من الأوردرات المكتملة من تاريخ انضمام كل مبتكر');
  await expect(page.locator('#vendors')).not.toContainText('1 أكتوبر');
  // a maker's name in a table opens his file
  await page.locator('#vendors [data-ov-table="contracts"] [data-ov-maker="Antikiano"]').click();
  await expect(page.locator('.drawer')).toContainText('Antikiano');
});

test('[#17 #19 #20 #21 #22 #27] the makers\' accounts: a stopped maker with a balance shows, the request\'s status and amount apart with «داخلي», «تم الدفع» opens that request, the new names, no «كشف بالفترة»', async ({ page }) => {
  await openMakers(page);
  await page.evaluate(() => window.IBReportBlocks.periodSet('makers-acc', { from: '2020-01-01', to: '2030-12-31' })); // Safwat 24 Nov: the tab's period — every date here
  await vtab(page, 'حسابات المبتكرين').click();
  const table = page.locator('#vendors table.vendors-table');
  await expect(table).toBeVisible();
  await expect(page.locator('#vendors').getByRole('tab', { name: 'كشف بالفترة' })).toHaveCount(0);
  // [#17]: Bian eg is stopped but Dokan holds 180 for him; the count card says the active ones
  await expect(table.locator('tbody tr', { hasText: 'Bian eg' })).toHaveCount(1);
  await expect(page.locator('#vendors .cat-card', { hasText: 'عدد المبتكرين' })).toContainText('2');
  // [#19]: two columns, the new statuses, «داخلي» on the request the system made
  await expect(table.locator('thead')).toContainText('حالة طلب السحب'); await expect(table.locator('thead')).toContainText('قيمة طلب السحب');
  const art = table.locator('tbody tr', { hasText: 'Art Craft' }); const anti = table.locator('tbody tr', { hasText: 'Antikiano' });
  await expect(art.locator('[data-wd]')).toHaveText('طلب جديد'); await expect(art.locator('[data-wd-amt]')).toHaveText('1,200.00'); await expect(art.locator('[data-wd-internal]')).toHaveCount(0);
  await expect(anti.locator('[data-wd]')).toHaveText('تم الدفع'); await expect(anti.locator('[data-wd-amt]')).toHaveText('2,000.00');
  await expect(anti.locator('[data-wd-internal]')).toHaveText('داخلي — اتعمل من السيستم');
  // [#20]: «تم الدفع» opens the request itself
  await anti.locator('[data-wd]').click();
  const pop = page.locator('.modal[role=dialog]');
  await expect(pop).toContainText('طلب سحب Antikiano — تم الدفع');
  await expect(pop).toContainText('#610'); await expect(pop).toContainText('السيستم (داخلي — تسوية)'); await expect(pop).toContainText('2,000.00');
  await pop.getByRole('button', { name: 'إغلاق', exact: true }).last().click();
  // [#21 #22]: the deposit is «إيداع خارجي»
  await page.locator('#vendors').getByRole('button', { name: 'إضافة مبلغ' }).click();
  await expect(page.locator('[role=menu]')).toContainText('إيداع خارجي');
});
