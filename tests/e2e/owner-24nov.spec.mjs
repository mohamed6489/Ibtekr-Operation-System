import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Safwat's three notes of 24 Nov: (1) «المتأخرين» on the makers' overview — the maker opens his late and at-risk orders; (2) «حسابات
// المبتكرين» has a period like the reports (the moves, the requests and the lost pieces dated in it; Dokan's balance and the net now;
// a request still waiting shows whatever its date) with «مقارنة بفترة سابقة»; (3) the order card's «الأوردرات الفرعية» no longer runs
// into «إجمالي القيمة». Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002';
const ymd = (d) => d.toISOString().slice(0, 10); const NOW = new Date(); const THIS = ymd(NOW); const OLD = ymd(new Date(NOW.getTime() - 70 * 864e5));
const mv = (id, vendor_id, on_date, direction, kind, amount) => ({ id, vendor_id, on_date, direction, kind, kind_name: null, amount, note: null, created_by: null, created_at: on_date + 'T09:00:00Z', voided_at: null, settled_by: null, settled_at: null });
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {
    dokanBalances: [{ vendor_id: V1, woo_vendor_id: 2376, balance: 2500, earning: 9000, sales: 11000, orders: 12, synced_at: THIS + 'T08:00:00Z' }],
    dokanWithdrawals: [{ id: 501, woo_vendor_id: 2376, vendor_id: V1, amount: 1200, charge: 0, receivable: 1200, status: 'pending', method: 'bank', requested_at: OLD + ' 12:00:00', synced_at: THIS + 'T08:00:00Z' },
      { id: 400, woo_vendor_id: 44, vendor_id: V2, amount: 300, charge: 0, receivable: 300, status: 'cancelled', method: 'bank', requested_at: OLD + ' 12:00:00', synced_at: THIS + 'T08:00:00Z' }],
  });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const vtab = (page, label) => page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: label });

test('(1) «المتأخرين»: the maker\'s name opens his late and at-risk orders; the other tables still open his file', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => window.IBReportBlocks.periodSet('makers-ov', { from: '2020-01-01', to: '2030-12-31' }));
  await page.locator('.sidebar .nav-item[data-page="vendors"]').click();
  const late = page.locator('#vendors [data-ov-table="late"]');
  const first = late.locator('[data-ov-maker]').first(); await expect(first).toBeVisible();
  const name = (await first.textContent()).trim();
  await first.click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'أوردرات متأخرة وقابلة للتأخير — ' + name });
  await expect(m).toBeVisible();
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('(2) «حسابات المبتكرين»: the period (this month) — the moves dated in it, the old rejected request out, the waiting one in; the comparison', async ({ page }) => {
  mock.acc.acc_vendor_moves.push(mv(9101, V1, THIS, 'withdraw', 'عربون', 400), mv(9102, V1, OLD, 'withdraw', 'عربون', 1000));
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="vendors"]').click();
  await vtab(page, 'حسابات المبتكرين').click();
  await expect(page.locator('#vendors [data-acc-period] .date-field')).toBeVisible();
  const table = page.locator('#vendors table.vendors-table');
  const art = table.locator('tbody tr', { hasText: 'Art Craft' });
  const head = await table.locator('thead th').allTextContents(); const dep = head.findIndex((t) => t.trim() === 'العرابين');
  await expect(art.locator('td').nth(dep)).toHaveText('400.00'); // this month's only (the 1,000 of 70 days ago is out)
  await expect(art.locator('[data-wd]')).toHaveText('طلب جديد'); // waiting since 70 days: still shown
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('لا يوجد'); // its rejected request is before the period
  // a wide period brings the old move and request back
  await page.evaluate(() => { window.IBReportBlocks.periodSet('makers-acc', { from: '2020-01-01', to: '2030-12-31' }); });
  await vtab(page, 'نظرة عامة').click(); await vtab(page, 'حسابات المبتكرين').click();
  await expect(art.locator('td').nth(dep)).toHaveText('1,400.00');
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('تم الرفض');
  // «مقارنة بفترة سابقة»
  await page.evaluate(() => { window.IBReportBlocks.periodSet('makers-acc', null); });
  await vtab(page, 'نظرة عامة').click(); await vtab(page, 'حسابات المبتكرين').click();
  await page.locator('#vendors [data-acc-period] .date-field').click();
  const cmp = page.locator('[role=dialog] [role=switch], [role=dialog] [role=checkbox]', { hasText: /مقارنة/ }).first();
  if (await cmp.count()) {
    await cmp.click(); await page.locator('[role=dialog]').getByRole('button', { name: /تطبيق|عرض/ }).first().click();
    await expect(page.locator('#vendors .pcmp-head')).toContainText('مقارنة الفترتين');
    await expect(page.locator('#vendors .pcmp-grid')).toContainText('العرابين');
  }
});

test('(3) the order card: «الأوردرات الفرعية» and «إجمالي القيمة» do not touch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="orders"]').click();
  await expect.poll(() => page.evaluate(() => { const h = document.getElementById('orders'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.oh [data-subn]')); })).toBe(true);
  const gap = await page.evaluate(() => {
    const root = document.getElementById('orders').shadowRoot;
    for (const n of root.querySelectorAll('[data-subn]')) {
      const f = n.closest('.fld'); const next = f && f.nextElementSibling; if (!next || !n.closest('.oh')) continue;
      const a = f.getBoundingClientRect(); const b = next.getBoundingClientRect(); const txt = n.scrollWidth <= n.clientWidth + 1;
      return { gap: a.left - b.right, fits: txt }; // RTL: the next field sits to the left
    }
    return null;
  });
  expect(gap).not.toBeNull();
  expect(gap.fits, JSON.stringify(gap)).toBe(true);
  expect(gap.gap).toBeGreaterThanOrEqual(8);
});

test('(4) every table\'s total row: green with our gold text (desktop and the mobile cards)', async ({ page }) => {
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    if (w === 1440) await signIn(page);
    await page.evaluate(() => { location.hash = 'vendors'; });
    await page.locator('#root [role=tab]', { hasText: 'حسابات المبتكرين' }).first().click();
    const td = page.locator('table.vendors-table tfoot td').first();
    await expect(td).toBeVisible();
    const [bg, fg] = await td.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    expect(bg).toBe('rgb(0, 86, 66)'); // --color-brand-default
    expect(fg).toBe('rgb(230, 186, 101)'); // --color-text-gold
    // a coloured figure inside (the net's pos / neg) takes the gold too
    const inner = await page.locator('table.vendors-table tfoot td span').first().evaluate((e) => getComputedStyle(e).color).catch(() => null);
    if (inner) expect(inner).toBe('rgb(230, 186, 101)');
  }
});
