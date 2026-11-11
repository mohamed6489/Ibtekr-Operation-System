import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// Phase 13 decision 44 (0073 — owner 10 Nov: «طلب وقت إضافي» in the account menu → a popup to add the overtime and send a request the
// admin and the approvers decide): the day (last 31), from / to, what was worked on → hr_overtime_request; a «مستني» row with its ticket;
// the same time twice is refused with the server's message. Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002';
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
let mock = null; let pageErrors = [];
test.beforeEach(() => { test.skip(LIVE, 'asserts on the mocked Supabase'); });
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

test('decision 44: «طلب وقت إضافي» from the account menu opens the popup; the request goes as a «مستني» overtime with its ticket; the same time twice is refused', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  const day = addDays(hrToday(), -2);
  const open = async () => { await page.locator('.user-btn').click(); await page.getByRole('menuitem', { name: 'طلب وقت إضافي' }).click(); return page.locator('.modal[role=dialog]', { hasText: 'طلب وقت إضافي' }).last(); };
  let m = await open();
  await expect(m).toContainText('للأدمن ومديرك المباشر');
  await m.locator('#day').fill(dmy(day)); await m.locator('#day').dispatchEvent('change');
  await m.locator('#from').fill('18:00'); await m.locator('#to').fill('18:05');
  await m.getByRole('button', { name: 'ابعت الطلب' }).click();
  await expect(m).toContainText('المدة من ربع ساعة لـ 12 ساعة'); // the popup checks before the server
  await m.locator('#to').fill('20:30'); await m.locator('#note').fill('جرد المخزن');
  await m.getByRole('button', { name: 'ابعت الطلب' }).click();
  await expect(m).toBeHidden();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'طلب' }).last()).toContainText('اتبعت طلب الوقت الإضافي');
  const rows = mock.hr.overtime.filter((o) => o.member_id === OPS_ID);
  expect(rows).toEqual([expect.objectContaining({ day, minutes: 150, status: 'مستني', note: 'جرد المخزن', ticket_id: expect.anything() })]);
  expect(mock.activity.filter((a) => a.action === 'hr.overtime.request').length).toBe(1);
  expect(JSON.stringify(mock.activity.filter((a) => a.action === 'hr.overtime.request'))).not.toContain('جرد');
  // the same time again: the server's «overlap» message, the popup stays
  m = await open();
  await m.locator('#day').fill(dmy(day)); await m.locator('#day').dispatchEvent('change');
  await m.locator('#from').fill('19:00'); await m.locator('#to').fill('21:00'); await m.locator('#note').fill('تاني');
  await m.getByRole('button', { name: 'ابعت الطلب' }).click();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'طلب' }).last()).toContainText('فيه طلب وقت إضافي تاني على نفس الوقت');
  await expect(m).toBeVisible();
  expect(mock.hr.overtime.filter((o) => o.member_id === OPS_ID).length).toBe(1);
});

test('decision 45: «ملفي»\'s header button is a menu — «+ وقت إضافي» opens the overtime request, «فتح طلب» the new request on «طلبات الفريق»; the sidebar says «طلبات الفريق»', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('.sidebar .nav-item[data-page="tickets"]')).toContainText('طلبات الفريق');
  await page.evaluate(() => { location.hash = 'profile'; });
  const menuBtn = page.locator('#pg-profile .prof-head [data-my-menu]');
  await menuBtn.click();
  await expect(page.getByRole('menuitem')).toHaveText(['+ وقت إضافي', 'تعديل البيانات', 'فتح طلب']);
  await page.getByRole('menuitem', { name: '+ وقت إضافي' }).click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'طلب وقت إضافي' }).last(); await expect(m).toBeVisible();
  await m.getByRole('button', { name: 'إلغاء' }).click(); await expect(m).toBeHidden();
  await menuBtn.click(); await page.getByRole('menuitem', { name: 'فتح طلب' }).click();
  await expect(page.locator('.modal[role=dialog]', { hasText: 'طلب جديد' }).last()).toBeVisible();
  await expect(page.locator('#tickets h1')).toHaveText('طلبات الفريق');
  await expect(page.getByRole('button', { name: 'فتح طلب' })).toBeVisible();
});
