import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// 0081 (the owner 12 Nov — «نقدر نزود أدوار زي ديزاينر، ميديا باير، مبرمج… ونديها صلاحيات» + «دور أساسي + أدوار إضافية»): the three new
// roles are there; «+ أدوار إضافية» beside a member's role in الإعدادات › الفريق → member_roles_set; the member then has the
// permissions of every role (the highest) — the accounts member with «ديزاينر» opens «التسويق» — and the team requests go to any role
// (ticket_roles → the domain's list). Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const ACC = 'accounts.dev@ibtekr.local'; const ACC_ID = '00000000-0000-4000-8000-000000000004';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page, id) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}

test('the admin gives the accounts member «ديزاينر» as an extra role; the member opens «التسويق» and the team requests go to the new roles', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'settings-team'; });
  await expect(page.locator('#pg-settings .set-page')).toBeVisible();
  await page.getByRole('tab', { name: /^الأعضاء/ }).click();
  const row = page.locator('#pg-settings table tbody tr', { hasText: 'منى حسن' });
  const btn = row.locator('[data-extra-roles]');
  await expect(btn).toHaveText('+ أدوار إضافية');
  await btn.click();
  const md = page.locator('.modal[role=dialog]', { hasText: 'الأدوار الإضافية — منى حسن' });
  await expect(md).toBeVisible();
  await md.locator('#xr-pick').click();
  const menu = page.locator('[data-mp-menu="xr-pick"]');
  await expect(menu.locator('[data-mp-opt="admin"]')).toHaveCount(0); // «أدمن» is never an extra
  await expect(menu.locator('[data-mp-opt="accounts"]')).toHaveCount(0); // nor the main role
  await menu.locator('[data-mp-opt="designer"]').click();
  await menu.locator('[data-mp-done]').click();
  await md.getByRole('button', { name: 'احفظ الأدوار' }).click();
  await expect.poll(() => mock.st.writes.filter((w) => w.op === 'roles').length).toBe(1);
  expect(mock.st.writes.find((w) => w.op === 'roles')).toMatchObject({ id: ACC_ID, roles: ['designer'] });
  expect(mock.profiles.find((p) => p.id === ACC_ID).extra_roles).toEqual(['designer']);
  await expect(row.locator('[data-extra-roles]')).toHaveText('+ ديزاينر');
  // the team requests: the domain's list = the six + the team's other roles (ticket_roles)
  await page.locator('.sidebar .nav-item[data-page="tickets"]').click();
  await page.waitForFunction(() => window.IbtekrTickets.ROLES.includes('ديزاينر'));
  expect(await page.evaluate(() => window.IbtekrTickets.ROLES.slice(6))).toEqual(['ديزاينر', 'ميديا باير', 'مبرمج']);
  // the accounts member signs in: «التسويق» is open now (the designer's marketing.view), as is the design request queue
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* */ } });
  await signIn(page, ACC);
  await expect(page.locator('.sidebar .nav-item[data-page="marketing"]')).toBeVisible();
  expect(await page.evaluate(() => [window.IBDirectory.perm('marketing.create'), window.IBDirectory.perm('accounts.view'), window.IBTickets.myRoles()])).toEqual(['F', 'F', ['الحسابات', 'ديزاينر']]);
});
