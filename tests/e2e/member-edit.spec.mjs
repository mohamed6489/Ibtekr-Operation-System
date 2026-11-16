import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// 0111 (the owner 16 Nov — «عايز امكانية للمدير المباشر او الادمن يقدر يعدل اي بيانات لاي فرد في الفريق و الصلاحيات»; the pay stays the
// admin's, and a manager gives nothing above his own): the member's file has «بيانات العضو والصلاحيات» for the admin or the direct
// manager — «تعديل البيانات» (member_info_set; the login email the admin's only, team-admin member_email) and «الدور والصلاحيات» (the
// custom permissions offered up to the manager's own, member_perms_set). Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002'; const VF_ID = '00000000-0000-4000-8000-000000000005'; const ACC_ID = '00000000-0000-4000-8000-000000000004';
const SEED = { hrMembers: [{ member_id: OPS_ID }, { member_id: VF_ID, shift_start: '10:00', shift_end: '18:00' }, { member_id: ACC_ID }] };
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
  mock.profiles.find((p) => p.id === VF_ID).manager_id = OPS_ID; // هدى reports to سارة
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function openMember(page, email, code) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, '#member-' + code);
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });

test('the direct manager edits his report: the name, the mobile and the title (the email read only); custom permissions offered up to his own', async ({ page }) => {
  await openMember(page, OPS, 'M05');
  const card = page.locator('[data-member-card]'); await expect(card).toBeVisible();
  await expect(card).toContainText('هدى سمير'); await expect(card).toContainText('انت المدير المباشر');
  // the data
  await card.locator('[data-member-info]').click();
  const d = modal(page, 'تعديل بيانات'); await expect(d).toBeVisible();
  await expect(d.locator('#email')).toBeDisabled();
  await d.locator('#name').fill('هدى سمير محمود'); await d.locator('#phone').fill('01000000055'); await d.locator('#title').fill('متابعة المبتكرين');
  await d.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(d).toBeHidden();
  const p = mock.profiles.find((x) => x.id === VF_ID);
  expect([p.name, p.phone, p.title]).toEqual(['هدى سمير محمود', '01000000055', 'متابعة المبتكرين']);
  expect(mock.activityRows.some((r) => r.action === 'hr.member.info' && r.entity_id === VF_ID)).toBe(true);
  expect(mock.hr.calls.filter((c) => c.action === 'member_email')).toEqual([]); // the email is the admin's
  // the access: a permission سارة lacks offers no «مسموح»; one she has is handed over
  await card.locator('[data-member-access]').click();
  const a = modal(page, 'الدور والصلاحيات'); await expect(a).toBeVisible();
  await a.locator('#ma-accounts-approve').click();
  await expect(page.locator('[role=listbox] [role=option]', { hasText: 'مسموح' }).filter({ hasNotText: 'غير' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await a.locator('#ma-orders-status').click(); await page.locator('[role=listbox] [role=option]', { hasText: /^مسموح$/ }).first().click();
  await a.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(a).toBeHidden();
  expect(mock.profiles.find((x) => x.id === VF_ID).custom_perms).toEqual({ 'orders.status': 'F' });
});

test('a member who is not his report has no card; the admin changes the login email too', async ({ page }) => {
  await openMember(page, ADMIN, 'M05');
  const card = page.locator('[data-member-card]'); await expect(card).toBeVisible();
  await card.locator('[data-member-info]').click();
  const d = modal(page, 'تعديل بيانات'); await expect(d.locator('#email')).toBeEnabled();
  await d.locator('#email').fill('huda.new@ibtekr.local');
  await d.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(d).toBeHidden();
  expect(mock.profiles.find((x) => x.id === VF_ID).email).toBe('huda.new@ibtekr.local');
  expect(mock.activityRows.some((r) => r.action === 'hr.member.email' && r.entity_id === VF_ID)).toBe(true);
});

test('the manager on someone else\'s report: no edit card', async ({ page }) => {
  await openMember(page, OPS, 'M04');
  await expect(page.locator('#pg-profile .prof-head')).toBeVisible();
  await expect(page.locator('[data-member-card]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#member-M05'; }); // her own report has it
  await expect(page.locator('[data-member-card]')).toBeVisible();
});
