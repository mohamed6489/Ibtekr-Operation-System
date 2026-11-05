import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// The header clock on the server (phase 10 T6, decision 10 — known issue 1): «ابدأ الدوام» = hr_clock_in, the timer counts from the
// server's start, so a reload (or another device) shows the same open shift; «إنهاء الدوام» = hr_clock_out; at 8 hours the member
// picks «إنهاء الدوام» (the end at the 8-hour mark) or «لسه — وقت إضافي», and ending overtime asks what was worked on (the server
// records it past 8 hours for the direct manager). Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002';
const T = hrToday(); const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); const restDay = dow(T) === 5 || dow(T) === 6;
const cairoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
let mock = null; let pageErrors = [];
async function start(page, seed = {}) {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, seed);
  await page.goto('/');
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
test.beforeEach(() => { test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)'); });
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const clock = (page) => page.locator('.clock-widget');
const calls = (fn) => mock.hr.calls.filter((c) => c.fn === fn);
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });

test('«ابدأ الدوام» writes the shift on the server; a reload shows the same open shift; «إنهاء الدوام» closes it for the day', async ({ page }) => {
  await start(page);
  await clock(page).getByRole('button', { name: 'ابدأ الدوام' }).click();
  await expect(clock(page).locator('.clock')).toContainText('على الدوام');
  expect(calls('hr_clock_in').length).toBe(1);
  expect(mock.hr.attendance.map((a) => [a.member_id, a.day, a.out_at])).toEqual([[OPS_ID, T, null]]);
  await page.reload(); // known issue 1: the shift used to live in memory only
  await expect(page.locator('#root')).toBeVisible();
  await expect(clock(page).locator('.clock')).toContainText('على الدوام');
  expect(calls('hr_clock_in').length).toBe(1);
  await clock(page).locator('.clock').click();
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الدوام' }).click();
  await modal(page, 'إنهاء الدوام').getByRole('button', { name: 'إنهاء الدوام' }).click();
  await expect(clock(page).locator('[data-shift-ended]')).toContainText('خلص الدوام');
  expect(calls('hr_clock_out').map((c) => c.p_ot_note)).toEqual([null]);
  expect(mock.hr.attendance[0].out_at).not.toBeNull();
  expect(mock.hr.overtime).toEqual([]);
});

test('at 8 hours: «لسه — وقت إضافي», then ending it asks what was worked on → hr_clock_out with the note, the overtime recorded for the manager', async ({ page }) => {
  const inAt = Date.now() - 485 * 60000;
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day: cairoDay(inAt), in_at: new Date(inAt).toISOString(), out_at: null, source: 'clock' }] });
  const ask = modal(page, 'ساعات العمل خلصت');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'لسه — وقت إضافي' }).click();
  await expect(clock(page).locator('.clock')).toContainText('وقت إضافي');
  await page.reload(); // the choice holds for this shift
  await expect(clock(page).locator('.clock')).toContainText('وقت إضافي');
  await expect(modal(page, 'ساعات العمل خلصت')).toHaveCount(0);
  await clock(page).locator('.clock').click();
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الوقت الإضافي' }).click();
  const f = modal(page, 'إنهاء الوقت الإضافي');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await expect(f).toContainText('اكتب اشتغلت على إيه'); // the note is required
  await f.locator('#note').fill('جهزت أوردرات شحنة أرامكس');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await expect(clock(page).locator('[data-shift-ended]')).toBeVisible();
  expect(calls('hr_clock_out').map((c) => c.p_ot_note)).toEqual(['جهزت أوردرات شحنة أرامكس']);
  const ot = mock.hr.overtime;
  expect(ot.length).toBe(1);
  expect(ot[0]).toMatchObject({ member_id: OPS_ID, status: 'مستني', kind: restDay ? 'rest_day' : 'hours' });
  if (!restDay) expect(ot[0].minutes).toBeGreaterThanOrEqual(5);
});

test('at 8 hours: «إنهاء الدوام» ends the shift at the 8-hour mark (no overtime)', async ({ page }) => {
  const inAt = Date.now() - 490 * 60000;
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day: cairoDay(inAt), in_at: new Date(inAt).toISOString(), out_at: null, source: 'clock' }] });
  const ask = modal(page, 'ساعات العمل خلصت');
  await ask.getByRole('button', { name: 'إنهاء الدوام' }).click();
  await expect(clock(page).locator('[data-shift-ended]')).toBeVisible();
  const c = calls('hr_clock_out')[0];
  expect(c.p_ot_note).toBeNull();
  expect(Math.round((Date.parse(c.p_at) - inAt) / 60000)).toBe(480);
  expect(Math.round((Date.parse(mock.hr.attendance[0].out_at) - inAt) / 60000)).toBe(480);
  expect(mock.hr.overtime.filter((o) => o.kind === 'hours')).toEqual([]);
});
