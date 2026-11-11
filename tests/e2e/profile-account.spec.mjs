import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 decision 39 (0072 — owner 10 Nov: «بيانات الحساب» right after «نظرة عامة» with «البيانات الشخصية» / «الرقم السري» /
// «رقم الحساب البنكي» / «مستندات وعقود»; the reply «تمام» to: the member types the bank account, it shows masked, the admin reveals it and
// the reveal is logged): the tab replaces «الحساب والأمان» and «العقود والمستندات»; the bank account goes through hr_bank_set / get /
// reveal only — the page never holds the full number until «إظهار». Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002';
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(() => { test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)'); });
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function open(page, email, hash) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const P = (page) => page.locator('#pg-profile');
const modal = (page, title) => page.locator('.modal[role=dialog]', { hasText: title }).last();
const sec = (page, title) => P(page).locator('section', { has: page.locator('h2', { hasText: title }) });

test('decision 39: «بيانات الحساب» second, its four sections; the member adds a bank account, sees it masked, reveals it (logged, no number)', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await open(page, OPS, 'profile');
  const tabs = P(page).getByRole('tab');
  await expect(tabs.nth(0)).toHaveText('نظرة عامة'); await expect(tabs.nth(1)).toHaveText('بيانات الحساب');
  for (const t of ['الحساب والأمان', 'العقود والمستندات']) await expect(P(page).getByRole('tab', { name: t, exact: true })).toHaveCount(0);
  await tabs.nth(1).click();
  for (const t of ['البيانات الشخصية', 'الرقم السري', 'رقم الحساب البنكي', 'مستندات وعقود']) await expect(P(page).locator('h2', { hasText: t })).toBeVisible();
  // decision 46: a section's header is green with beige text
  // polled: the tab can re-render once its data lands, and a detached header reads "" for both
  await expect.poll(() => sec(page, 'الرقم السري').locator('.sec-h').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el.querySelector('h2')).color]).catch(() => [])).toEqual(['rgb(0, 86, 66)', 'rgb(255, 247, 239)']);
  await expect(sec(page, 'البيانات الشخصية')).toContainText('سارة أحمد'); await expect(sec(page, 'البيانات الشخصية')).toContainText('مديرة العمليات');
  await expect(sec(page, 'الرقم السري').getByRole('button', { name: 'تغيير كلمة المرور' })).toBeVisible();
  // no bank account yet → add one; a number with letters is refused in the form
  await expect(sec(page, 'رقم الحساب البنكي')).toContainText('لسه ماضفتش حسابك البنكي');
  await P(page).locator('[data-bank-edit]').click();
  const f = modal(page, 'إضافة الحساب البنكي');
  await f.locator('#bankName').fill('بنك مصر'); await f.locator('#number').fill('12ab');
  await f.getByRole('button', { name: 'حفظ' }).click(); await expect(f).toContainText('رقم الحساب أرقام بس');
  await f.locator('#number').fill('1000 2000 3000 4321'); await f.locator('#iban').fill('eg38 0019 0005 0000 0000 2631 8000 2');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(P(page).locator('[data-bank-number]')).toHaveText('•••• 4321');
  expect(mock.hr.bank).toEqual([expect.objectContaining({ member_id: OPS_ID, bank_name: 'بنك مصر', holder: 'سارة أحمد', account_number: '1000200030004321', iban: 'EG380019000500000000263180002' })]);
  await expect(P(page)).not.toContainText('1000200030004321');
  // «إظهار» → the full number from the server, logged with the member only
  await P(page).locator('[data-bank-reveal]').click();
  await expect(P(page).locator('[data-bank-number]')).toHaveText('1000200030004321');
  await P(page).locator('[data-bank-reveal]').click(); await expect(P(page).locator('[data-bank-number]')).toHaveText('•••• 4321');
  expect(mock.activity.filter((a) => /^hr\.bank\./.test(a.action)).map((a) => a.action)).toEqual(['hr.bank.set', 'hr.bank.reveal']);
  expect(JSON.stringify(mock.activity.filter((a) => /^hr\.bank\./.test(a.action)))).not.toContain('4321');
  // the overview's «المستندات» card opens «بيانات الحساب»
  await P(page).getByRole('tab', { name: 'نظرة عامة' }).click();
  await P(page).locator('.sum-tile', { hasText: 'المستندات' }).click();
  await expect(P(page).getByRole('tab', { name: 'بيانات الحساب' })).toHaveAttribute('aria-selected', 'true');
});

test('decision 39: the admin sees a member\'s bank account masked on their file and reveals it (logged); another member gets nothing', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { hrBank: [{ member_id: OPS_ID, bank_name: 'بنك مصر', holder: 'سارة أحمد', account_number: '55556666777788', iban: null, updated_at: new Date().toISOString() }] });
  await open(page, ADMIN, 'member-M02');
  await P(page).getByRole('tab', { name: 'بيانات الحساب' }).click();
  await expect(P(page).locator('[data-bank-number]')).toHaveText('•••• 7788');
  await expect(P(page).locator('[data-bank-edit]')).toHaveCount(0); // the member types it, not the admin
  await expect(sec(page, 'الرقم السري').getByRole('button', { name: 'تغيير كلمة المرور' })).toHaveCount(0);
  await P(page).locator('[data-bank-reveal]').click();
  await expect(P(page).locator('[data-bank-number]')).toHaveText('55556666777788');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'hr.bank.reveal').map((a) => a.entity_id)).toEqual([OPS_ID]);
  // the server refuses anyone else: the mock answers 42501 for a member reading another's
  const r = await page.evaluate(async () => { await window.IBAuth.signOut('local'); return true; });
  expect(r).toBe(true);
  await open(page, 'accounts.dev@ibtekr.local', 'profile');
  const out = await page.evaluate((id) => window.IBHR.bank(id), OPS_ID);
  expect(out).toMatchObject({ ok: false, reason: 'forbidden' });
});
