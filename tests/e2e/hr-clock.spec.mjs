import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// The header clock on the server (phase 10 T6, decision 10 — known issue 1): «ابدأ الدوام» = hr_clock_in, the timer counts from the
// server's start, so a reload (or another device) shows the same open shift; «إنهاء الدوام» = hr_clock_out; at 8 hours the member
// picks «إنهاء الدوام» (the end at the 8-hour mark) or «ابدأ وقت إضافي», and ending overtime asks what was worked on (the server
// records it past 8 hours for the direct manager). Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002';
const T = hrToday(); const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); const restDay = dow(T) === 5 || dow(T) === 6;
const cairoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const restOf = (iso) => dow(iso) === 5 || dow(iso) === 6;
// a shift that began 8 hours ago is yesterday's between 00:00 and 08:10 Cairo: once it ends, today has none and the clock offers
// «ابدأ الدوام» again (the shift's day is the Cairo day of its start); otherwise it shows «خلص الدوام»
async function endedFor(page, day) {
  if (day === hrToday()) await expect(clock(page).locator('[data-shift-ended]')).toBeVisible();
  else await expect(clock(page).getByRole('button', { name: 'ابدأ الدوام' })).toBeVisible();
}
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
  expect('p_remote' in calls('hr_clock_in')[0]).toBe(false); // «عن بُعد» is the server's
  expect(mock.hr.attendance.map((a) => [a.member_id, a.day, a.out_at, a.remote])).toEqual([[OPS_ID, T, null, false]]);
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

test('at 8 hours: «ابدأ وقت إضافي», then ending it asks what was worked on → hr_clock_out with the note, the overtime recorded for the manager', async ({ page }) => {
  const inAt = Date.now() - 485 * 60000;
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day: cairoDay(inAt), in_at: new Date(inAt).toISOString(), out_at: null, source: 'clock' }] });
  const ask = modal(page, 'اكتمال ساعات العمل');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'ابدأ وقت إضافي' }).click();
  await expect(clock(page).locator('.clock')).toContainText('وقت إضافي');
  await page.reload(); // the choice holds for this shift
  await expect(clock(page).locator('.clock')).toContainText('وقت إضافي');
  await expect(modal(page, 'اكتمال ساعات العمل')).toHaveCount(0);
  await clock(page).locator('.clock').click();
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الوقت الإضافي' }).click();
  const f = modal(page, 'إنهاء الوقت الإضافي');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await expect(f).toContainText('اكتب اشتغلت على إيه'); // the note is required
  await f.locator('#note').fill('جهزت أوردرات شحنة أرامكس');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await endedFor(page, cairoDay(inAt));
  expect(calls('hr_clock_out').map((c) => c.p_ot_note)).toEqual(['جهزت أوردرات شحنة أرامكس']);
  const ot = mock.hr.overtime;
  expect(ot.length).toBe(1);
  // the overtime's kind follows the shift's own day (a rest day worked = rest_day)
  expect(ot[0]).toMatchObject({ member_id: OPS_ID, status: 'مستني', kind: restOf(cairoDay(inAt)) ? 'rest_day' : 'hours' });
  if (!restOf(cairoDay(inAt))) expect(ot[0].minutes).toBeGreaterThanOrEqual(5);
});

test('at 8 hours: «إنهاء الدوام» ends the shift at the 8-hour mark (no overtime)', async ({ page }) => {
  const inAt = Date.now() - 490 * 60000;
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day: cairoDay(inAt), in_at: new Date(inAt).toISOString(), out_at: null, source: 'clock' }] });
  const ask = modal(page, 'اكتمال ساعات العمل');
  await ask.getByRole('button', { name: 'إنهاء الدوام' }).click();
  await endedFor(page, cairoDay(inAt));
  const c = calls('hr_clock_out')[0];
  expect(c.p_ot_note).toBeNull();
  expect(Math.round((Date.parse(c.p_at) - inAt) / 60000)).toBe(480);
  expect(Math.round((Date.parse(mock.hr.attendance[0].out_at) - inAt) / 60000)).toBe(480);
  expect(mock.hr.overtime.filter((o) => o.kind === 'hours')).toEqual([]);
});

test('«عن بُعد» from the server: an approved «شغل عن بُعد» covering today makes the shift remote; the page never sends the flag', async ({ page }) => {
  await start(page, { hrRequests: [{ member_id: OPS_ID, type: 'شغل عن بُعد', from_day: T, to_day: T, status: 'موافق' }] });
  await clock(page).getByRole('button', { name: 'ابدأ الدوام' }).click();
  await expect(page.locator('.toast', { hasText: restDay ? 'يوم راحة' : 'بدأ الدوام عن بُعد' })).toBeVisible();
  expect('p_remote' in calls('hr_clock_in')[0]).toBe(false);
  expect(mock.hr.attendance.map((a) => [a.member_id, a.remote])).toEqual([[OPS_ID, true]]);
});

// phase 13 decision 24 (0068 — «يطلع زرار بدء الدوام من الأول … وكل مرة يتحسب عدد ساعات العمل» + «مع المرونة مفيش تأخير»): after «إنهاء الدوام»
// the clock shows the day's hours AND «ابدأ الدوام» again; a second start is another session of the day, and the hours are summed
test('decision 24: «ابدأ الدوام» again after «إنهاء الدوام» — a second session the same day, the hours summed', async ({ page }) => {
  const inAt = Date.now() - 125 * 60000; const outAt = Date.now() - 65 * 60000; const day = cairoDay(inAt);
  test.skip(day !== T, 'the first session must be today in Cairo (the run is within an hour of midnight)');
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day, in_at: new Date(inAt).toISOString(), out_at: new Date(outAt).toISOString(), source: 'clock' }] });
  const ended = clock(page).locator('[data-shift-ended]');
  await expect(ended).toContainText('خلص الدوام'); await expect(ended).toContainText('1:00');
  await clock(page).getByRole('button', { name: 'ابدأ الدوام' }).click();
  await expect(page.locator('.toast', { hasText: restDay ? 'يوم راحة' : 'رجعت للدوام' })).toBeVisible();
  await expect(clock(page).locator('.clock')).toContainText('على الدوام');
  await expect(clock(page).locator('.clock .num')).toHaveText(/^1:0\d$/); // the day so far: the hour before + this session
  expect(mock.hr.attendance.filter((a) => a.member_id === OPS_ID && a.day === T).length).toBe(2);
  await clock(page).locator('.clock').click();
  await expect(page.locator('.clock-pop')).toContainText('جلسة تانية');
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الدوام' }).click();
  await modal(page, 'إنهاء الدوام').getByRole('button', { name: 'إنهاء الدوام' }).click();
  await expect(ended).toContainText('1:0'); // 1 hour + the few seconds of the second session
  await expect(clock(page).getByRole('button', { name: 'ابدأ الدوام' })).toBeVisible();
  expect(mock.hr.attendance.filter((a) => a.member_id === OPS_ID && a.out_at).length).toBe(2);
  expect(calls('hr_clock_in').length).toBe(1);
});

test('decision 24: a second session that brings the day past 8 hours asks the 8-hour question; the overtime is only the part past 8 hours of the day', async ({ page }) => {
  const day = cairoDay(Date.now() - 9 * 3600000);
  const first = { member_id: OPS_ID, day, in_at: new Date(Date.now() - 9 * 3600000).toISOString(), out_at: new Date(Date.now() - 4 * 3600000).toISOString(), source: 'clock' }; // 5 hours
  const second = { member_id: OPS_ID, day, in_at: new Date(Date.now() - 190 * 60000).toISOString(), out_at: null, source: 'clock' }; // 3:10 → the day at 8:10
  await start(page, { hrAttendance: [first, second] });
  const ask = modal(page, 'اكتمال ساعات العمل');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'ابدأ وقت إضافي' }).click();
  await clock(page).locator('.clock').click();
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الوقت الإضافي' }).click();
  const f = modal(page, 'إنهاء الوقت الإضافي');
  await f.locator('#note').fill('تقفيل شحنة المسا');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await expect.poll(() => calls('hr_clock_out').length).toBe(1);
  if (!restOf(day)) {
    const ot = mock.hr.overtime.filter((o) => o.kind === 'hours');
    expect(ot.length).toBe(1);
    expect(ot[0].minutes).toBeGreaterThanOrEqual(9); expect(ot[0].minutes).toBeLessThanOrEqual(12); // ≈ 10 minutes past 8 hours of the DAY, not 3:10 − 8:00
  }
});

// phase 13 decision 25 (0069 — «في حالة اختياره لوقت إضافي يتبعت للأدمن تنبيه ويجيله في تذاكر الفريق طلب بإضافة وقت إضافي ومايتضافش إلا بعد
// الموافقة», «الموافقة للمدير المباشر», «إضافة وقت إضافي» = start overtime now): the request ticket in «تذاكر الفريق», the admins' bell,
// nothing paid before the decision, and the decision inside the ticket closes it
test('decision 25: «إضافة وقت إضافي» in «ملفي › ساعات العمل» opens the request ticket + the admins\' bell; the overtime goes in the ticket, unpaid', async ({ page }) => {
  const inAt = Date.now() - 125 * 60000; const day = cairoDay(inAt);
  test.skip(day !== T || restDay, 'a working day that began today in Cairo');
  await start(page, { hrAttendance: [{ member_id: OPS_ID, day, in_at: new Date(inAt).toISOString(), out_at: null, source: 'clock' }] });
  await page.evaluate(() => { location.hash = 'profile-hours'; });
  const P = page.locator('#pg-profile');
  await expect(P.locator('.quick-acts')).toContainText('إجراءات سريعة');
  // decision 31 («امسح زرار إنهاء الدوام»): «إضافة وقت إضافي» is the only quick action — the shift ends from the header clock
  await expect(P.locator('.quick-acts').getByRole('button')).toHaveText(['إضافة وقت إضافي']);
  await P.locator('[data-ot-start]').click();
  await modal(page, 'إضافة وقت إضافي').getByRole('button', { name: 'ابدأ وقت إضافي' }).click();
  await expect(clock(page).locator('.clock')).toContainText('وقت إضافي');
  await expect(page.locator('.toast', { hasText: 'اتبعت طلب لمديرك المباشر' })).toBeVisible();
  expect(calls('hr_overtime_begin').length).toBe(1);
  const tk = mock.tickets.find((t) => t.created_by === OPS_ID && t.title.startsWith('وقت إضافي — '));
  expect(tk).toMatchObject({ type: 'internal', status: 'open', assignee_role: 'مدير النظام' }); // no direct manager → «مدير النظام»
  expect(mock.alerts.filter((a) => a.kind === 'hr.overtime' && a.role_id === 'admin').map((a) => a.entity)).toEqual(['tickets/TKT-' + String(tk.id).padStart(4, '0')]);
  // a few seconds of overtime, then its end with what was worked on
  await page.evaluate(() => { const a = window.IBHR; return a; });
  await clock(page).locator('.clock').click();
  await page.locator('.clock-pop').getByRole('button', { name: 'إنهاء الوقت الإضافي' }).click();
  const f = modal(page, 'إنهاء الوقت الإضافي');
  await f.locator('#note').fill('تقفيل شحنة المسا');
  await f.getByRole('button', { name: 'إنهاء الدوام وإرسال للتأكيد' }).click();
  await expect.poll(() => calls('hr_clock_out').length).toBe(1);
  const ot = mock.hr.overtime.filter((o) => o.kind === 'hours');
  if (ot.length) { expect(ot[0]).toMatchObject({ status: 'مستني', paid_minutes: 0, ticket_id: tk.id }); expect(mock.ticketEvents.some((e) => e.ticket_id === tk.id && e.text.startsWith('الوقت الإضافي:'))).toBe(true); expect(mock.ticketEvents.some((e) => e.text.includes('تقفيل شحنة المسا'))).toBe(false); } // no HR detail in a ticket the whole role sees
  else expect(mock.tickets.find((t) => t.id === tk.id).status).toBe('closed'); // under a minute of overtime: nothing to record, the request closed
});

test('decision 25: the direct manager / admin decides inside the ticket — «وافق على الوقت الإضافي» with fewer minutes adds it and closes the ticket', async ({ page }) => {
  const day = cairoDay(Date.now() - 3 * 86400000);
  const tickets = [{ id: 7, type: 'internal', title: 'وقت إضافي — سارة أحمد · ' + day.slice(8, 10) + '/' + day.slice(5, 7), description: 'طلب إضافة وقت إضافي لـ سارة أحمد', priority: 'normal',
    assignee_role: 'مدير النظام', created_by: OPS_ID, created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن' }];
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { tickets, hrOvertime: [{ member_id: OPS_ID, day, start_at: new Date(Date.now() - 3 * 86400000).toISOString(), end_at: new Date(Date.now() - 3 * 86400000 + 90 * 60000).toISOString(), minutes: 90, note: 'تقفيل شحنة', ticket_id: 7, created_at: new Date(Date.now() - 3 * 86400000).toISOString() }] });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'tickets/TKT-0007'; });
  const card = page.locator('[data-ot-request]');
  await expect(card).toContainText('طلب وقت إضافي');
  await card.locator('[data-ot-approve]').click();
  const f = modal(page, 'موافقة على الوقت الإضافي');
  await f.locator('#min').fill('45');
  await f.getByRole('button', { name: 'وافق' }).click();
  await expect.poll(() => mock.hr.overtime[0].status).toBe('اتضاف');
  expect(mock.hr.overtime[0].paid_minutes).toBe(45);
  await expect.poll(() => mock.tickets.find((t) => t.id === 7).status).toBe('closed');
  expect(mock.tickets.find((t) => t.id === 7)).toMatchObject({ resolution_outcome: 'اتحلت المشكلة', resolution_note: 'اتضاف 45 دقيقة' });
  await expect(page.locator('[data-ot-request] [data-ot-approve]')).toHaveCount(0);
});

// phase 13 decision 32 (0070 — «في حالة العمل في الإجازات الرسمية أو العطلة بيتحسب كوقت إضافي يحتاج لموافقة من الأدمن»): a rest day /
// holiday worked is decided by an admin only — the direct manager sees the request without the buttons, the admin approves it in the ticket
test('decision 32: a rest day worked — the direct manager cannot approve it, the admin can (in the ticket)', async ({ page }) => {
  const day = cairoDay(Date.now() - 4 * 86400000); const at = new Date(Date.now() - 4 * 86400000).toISOString();
  const tickets = [{ id: 8, type: 'internal', title: 'يوم راحة/عطلة — منى حسن · ' + day.slice(8, 10) + '/' + day.slice(5, 7), description: 'طلب إضافة يوم راحة/عطلة اشتغله لـ منى حسن', priority: 'normal',
    assignee_role: 'مدير النظام', created_by: '00000000-0000-4000-8000-000000000004', created_by_name: 'منى حسن', created_by_role: 'الحسابات' }];
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { tickets, hrOvertime: [{ member_id: '00000000-0000-4000-8000-000000000004', day, kind: 'rest_day', start_at: at, end_at: new Date(Date.parse(at) + 300 * 60000).toISOString(), minutes: 300, note: 'جرد', ticket_id: 8, created_at: at }] });
  mock.profiles.find((p) => p.member_code === 'M04').manager_id = OPS_ID; // سارة is منى's direct manager
  await page.goto('/');
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'tickets/TKT-0008'; });
  const card = page.locator('[data-ot-request]');
  await expect(card).toContainText('يوم راحة/عطلة');
  await expect(card).toContainText('مستني موافقة الأدمن');
  await expect(card.locator('[data-ot-approve]')).toHaveCount(0);
  // the server refuses the manager too
  const r = await page.evaluate(() => window.IBHR.overtimeDecide(window.IBHR.data.overtime[0].id, 'add'));
  expect(r.ok).toBe(false);
  expect(mock.hr.overtime[0].status).toBe('مستني');
  // the admin approves it
  await page.evaluate(() => window.IBAuth.signOut('local')); await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'tickets/TKT-0008'; });
  await page.locator('[data-ot-request] [data-ot-approve]').click();
  await modal(page, 'موافقة على يوم الراحة/العطلة').getByRole('button', { name: 'وافق' }).click();
  await expect.poll(() => mock.hr.overtime[0].status).toBe('اتضاف');
  await expect.poll(() => mock.tickets.find((t) => t.id === 8).status).toBe('closed');
});
