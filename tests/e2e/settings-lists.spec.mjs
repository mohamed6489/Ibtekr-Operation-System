import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The settings lists all editable (docs/superpowers/plans/2026-11-14-settings-lists.md — the owner: «كله يتعدل»). Mock only: the cases
// assert the settings row «lists» the page saved and the expense rows the accounts page wrote (0093's guard is in the mock too).
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };
const lists = () => ((mock.settings || []).find((r) => r.section === 'lists') || {}).data || {};
const modal = (page) => page.locator('.modal[role=dialog]');
const rowMenu = async (page, scope, sel, item) => { await scope.locator('tr').filter({ has: page.locator(sel) }).locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: item }).click(); };
async function openExpenses(page) {
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await page.locator('#main [role=tab]', { hasText: 'المصروفات' }).first().click();
}
async function addExpense(page, cat) {
  await page.locator('#main').getByRole('button', { name: 'إضافة مصروفات', exact: true }).click();
  await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'سحب' }).first().click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('#f-cat').click();
  const opts = page.locator('[role=listbox] [role=option]');
  const shown = await opts.allInnerTexts();
  if (!cat) { await page.keyboard.press('Escape'); return shown.map((t) => t.trim()); }
  await opts.filter({ hasText: cat }).first().click();
  await modal(page).locator('#f-amount').fill('700');
  await modal(page).locator('#f-ben').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'آخر' }).first().click();
  await modal(page).locator('#f-other').fill('صاحب المحل');
  await modal(page).locator('#f-details').fill('إيجار الشهر');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  return shown.map((t) => t.trim());
}

test('decision 1: a base expense type takes a shown name; an added type is used by an expense, then removed — its row keeps it in the totals', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'أنواع المصروفات' }).click();
  await expect(body.locator('[data-expense-kind]')).toHaveText(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات']);
  // a base one: ⋮ «تغيير الاسم» only (no «حذف»)
  await body.locator('tr').filter({ has: page.locator('[data-expense-kind="الإعلانات"]') }).locator('button[aria-haspopup=menu]').click();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click();
  await modal(page).locator('input').first().fill('إعلانات ممولة');
  await modal(page).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(body.locator('[data-expense-label="الإعلانات"]')).toHaveText('إعلانات ممولة');
  await expect.poll(() => lists().labels).toEqual({ expense: { 'الإعلانات': 'إعلانات ممولة' } });
  // «+ إضافة نوع»: a new type; a base name or one already there is refused
  await body.locator('[data-expense-add]').click();
  await modal(page).locator('input').first().fill('المرتبات');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('النوع ده موجود');
  await modal(page).locator('input').first().fill('إيجار');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().expenseKinds).toEqual(['إيجار']);
  await expect(body.locator('[data-expense-kind]')).toHaveText(['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات', 'إيجار']);
  expect(lists().labels).toEqual({ expense: { 'الإعلانات': 'إعلانات ممولة' } }); // the names stay
  // the accounts page: the popup offers the shown names and the added type; an expense of it is written
  await openExpenses(page);
  const offered = await addExpense(page, 'إيجار');
  expect(offered).toEqual(['المرتبات', 'المصروفات', 'الاشتراكات', 'إعلانات ممولة', 'إيجار']);
  await expect.poll(() => (mock.accWrites || []).filter((w) => w.table === 'acc_expenses').map((w) => w.category)).toEqual(['إيجار']);
  const details = page.locator('#main .table-card', { hasText: 'تفاصيل المصروفات' });
  await expect(details.locator('tbody tr')).toHaveCount(5);
  await expect(details.locator('tbody')).toContainText('إيجار');
  await expect(details.locator('tbody')).toContainText('إعلانات ممولة');
  // removed: the expense keeps its type and its amount in the totals, the add popup doesn't offer it any more
  await go(page, 'settings-lists');
  await body.getByRole('tab', { name: 'أنواع المصروفات' }).click();
  await rowMenu(page, body, '[data-expense-kind="إيجار"]', 'حذف');
  await modal(page).getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => lists().expenseKinds).toEqual([]);
  await openExpenses(page);
  await expect(details.locator('tbody')).toContainText('إيجار');
  await expect(details.locator('tfoot, tbody').last()).toContainText('700');
  const after = await addExpense(page, null);
  expect(after).toEqual(['المرتبات', 'المصروفات', 'الاشتراكات', 'إعلانات ممولة']);
  // the server (the mock's copy of 0093's guard) refuses a type nobody added
  const refused = await page.evaluate(async () => { const r = await window.IBAccounts.add('expenses', { amount: 10, date: '2026-11-01', direction: 'withdraw', category: 'نوع مش موجود', beneficiaryName: 'x', beneficiaryIsOther: true, details: 'x' }); return r && r.ok; }).catch(() => false);
  expect(refused).toBeFalsy();
});
