import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// agents-brain T3 (docs/superpowers/plans/2026-11-17-agents-brain.md decision 2 — the owner 17 Nov: «يفتح الشاشات المناسبة لو محتاج اخد
// اي اكشنز … و بوباب باكشنز لو محتاجة اكشنز»): an assistant's answer brings the system's own popups filled («افتح البوب أب — …») and a
// page («افتح …») under it; nothing runs until the member clicks, and the popup's own button is the confirmation. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page);
  // the owner 22 Nov: an assistant's chat answers from the system first, and what it does not take waits for the member's «أيوه» on an outside
  // company — these specs are about the outside model's answers, so Claude is linked and the card is answered as soon as it shows
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-' + 'a'.repeat(40) }); await page.addLocatorHandler(page.locator('[data-mk-consent] [data-mk-brain="claude"]'), async (b) => { await b.click(); }); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const pg = (page) => page.locator('main.content.mod:not([hidden])');

test('T3 — the accountant answers with «افتح البوب أب — مصروف» (filled) and «افتح الحسابات»; nothing is written until the popup\'s own button', async ({ page }) => {
  await page.goto('/'); await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'ai-accountant'; });
  await expect(pg(page).locator('#mk-ask')).toBeVisible();
  mock.mkt.agentAnswer = () => ({ text: 'حطيتلك البيانات في البوب أب — راجعها واضغط زراره', forms: [{ form: 'expense_add', values: [{ key: 'direction', value: 'withdraw' }, { key: 'amount', value: '750' }, { key: 'category', value: 'المصروفات' }] }],
    page: { page: 'accounts', tab: '' }, request: { title: '', details: '' } });
  const writes0 = mock.mkt.writes.length;
  await pg(page).locator('#mk-ask').fill('عايز أسجل مصروف الكهربا زي الشهر اللي فات'); // (an amount said outright — «سجّل مصروف 750 كهربا» — is the system's own now: assistant.spec)
   await pg(page).locator('[data-mk-ask]').click();
  const links = pg(page).locator('[data-mk-forms]');
  await expect(links.locator('[data-mk-form="expense_add"]')).toContainText('مصروف');
  await expect(links.locator('[data-mk-page="accounts"]')).toContainText('الحسابات');
  expect(mock.mkt.writes.length).toBe(writes0); // the answer wrote nothing
  await links.locator('[data-mk-form="expense_add"]').click();
  const md = page.locator('.modal[role=dialog]').last();
  await expect(md).toBeVisible();
  await expect(md.locator('input[inputmode="decimal"], input[type="number"], input').filter({ hasNotText: 'x' }).first()).toBeVisible();
  await expect(page.locator('#pg-accounts, main.content:not([hidden])').first()).toBeVisible();
});

test('T4 — the accountant: «افتح البوب أب — مكافأة / خصم» opens the payroll\'s popup filled (deduction, label, amount) for the member named; «تسوية المبتكر» opens the maker\'s settle popup', async ({ page }) => {
  await page.goto('/'); await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.IBHR && window.IBHR.everyone ? window.IBHR.everyone().length : 0))).toBeGreaterThan(1);
  const who = await page.evaluate(() => window.IBHR.everyone().find((m) => m.salary || true).name);
  const maker = await page.evaluate(() => { const V = window.IBVendors && window.IBVendors.store && window.IBVendors.store.all ? window.IBVendors.store.all() : []; return V.length ? V[0].name : ''; });
  await page.evaluate(() => { location.hash = 'ai-accountant'; });
  await expect(pg(page).locator('#mk-ask')).toBeVisible();
  mock.mkt.agentAnswer = () => ({ text: 'حطيتلك البيانات', forms: [{ form: 'salary_adjust', values: [{ key: 'member', value: who }, { key: 'kind', value: 'خصم' }, { key: 'label', value: 'غياب' }, { key: 'amount', value: '300' }] }]
    .concat(maker ? [{ form: 'vendor_settle', values: [{ key: 'vendor', value: maker }] }] : []), page: { page: '', tab: '' }, request: { title: '', details: '' } });
  await pg(page).locator('#mk-ask').fill('اخصم 300 من ' + who + ' غياب'); await pg(page).locator('[data-mk-ask]').click();
  await pg(page).locator('[data-mk-form="salary_adjust"]').click();
  const md = page.locator('.modal[role=dialog]', { hasText: 'مكافأة / خصم' });
  await expect(md).toBeVisible();
  await expect(md.getByRole('radio', { name: 'خصم' })).toBeChecked();
  await expect(md.locator('input[value="غياب"]')).toHaveCount(1);
  await expect(md.locator('input[value="300"]')).toHaveCount(1);
  if (maker) {
    await md.getByRole('button', { name: /إلغاء|إغلاق/ }).first().click();
    await page.evaluate(() => { location.hash = 'ai-accountant'; });
    await pg(page).locator('[data-mk-form="vendor_settle"]').click();
    await expect(page.locator('.modal[role=dialog]').last()).toContainText(maker);
  }
});
