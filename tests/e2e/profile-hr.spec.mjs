import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday, hrAt } from './hr-mock.mjs';

// «ملفي» on IBHR (phase 10 T7): the member's own rows from the server — this month's hours and overtime, the requests (and cancelling
// one), the performance by quarter, the achievements, the payslip of a paid month (hr_my_slips — the sheet's status, never its total),
// the contract in «hr-docs»; «تغيير كلمة المرور» for real (the current one checked on a throwaway session, the others signed out);
// the admin's beige cards on another member's file (the shift and the pay written, the notes, «باسورد مؤقت جديد»); a member without
// sensitive.salaries sees no money on someone else's file. Mock only; the dates follow today.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const OPS_ID = '00000000-0000-4000-8000-000000000002'; const M03 = '00000000-0000-4000-8000-000000000003';
const T = hrToday(); const MK = T.slice(0, 7) + '-01';
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); const restDay = dow(T) === 5 || dow(T) === 6;
const prevMonth = (mk) => { const d = new Date(mk + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
const PM = prevMonth(MK);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monLabel = (iso) => AR[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
const LINE = { name: 'سارة أحمد', salary: 12000, holdback: 1500, paid: 10500, ot_minutes: 0, ot_pay: 0, rest_days: 0, rest_pay: 0, unpaid_days: 0, unpaid_cut: 0, allowances: 500, deductions: 0, advance: 0, quarter_bonus: 0, net: 11000 };
const SEED = {
  hrMembers: [{ member_id: OPS_ID, hire_date: '2024-05-12', notes: null }, { member_id: M03 }],
  hrPay: [{ member_id: OPS_ID, salary: 12000, holdback: 1500, allowances: 500 }, { member_id: M03, salary: 9000, holdback: 900, allowances: 0 }],
  hrAttendance: [{ member_id: OPS_ID, day: T, in_at: hrAt(T, '09:40'), out_at: hrAt(T, '17:30'), source: 'clock' }],
  hrOvertime: [{ member_id: OPS_ID, day: T, start_at: hrAt(T, '17:30'), end_at: hrAt(T, '18:30'), minutes: 60, kind: 'hours', note: 'تصوير الكتالوج', status: 'اتضاف', paid_minutes: 60, created_at: new Date(Date.now() - 3600000).toISOString() }],
  hrRequests: [{ member_id: OPS_ID, type: 'إجازة سنوية', from_day: addDays(T, 9), to_day: addDays(T, 9), note: 'فرح' }],
  hrKpis: [{ member_id: OPS_ID, name: 'شحن في الميعاد', weight: 100, target: 95 }],
  hrScores: [{ member_id: OPS_ID, month: MK, score: 104 }],
  hrAdjustments: [{ member_id: OPS_ID, month: MK, amount: 750, label: 'تصوير 120 منتج', kind: 'achievement' }],
  hrPayroll: [{ month: PM, status: 'مدفوع', paid_at: PM + 'T10:00:00Z', paid_account: 'حساب البنك', total: 40000 }, { month: MK, status: 'مسودة' }],
  hrPayrollLines: [{ month: PM, member_id: OPS_ID, ...LINE }, { month: PM, member_id: M03, ...LINE, name: 'محمد علي', net: 9000 }],
  hrDocuments: [{ member_id: OPS_ID, kind: 'عقد عمل', path: OPS_ID + '/contract.pdf', name: 'عقد سارة.pdf', start_on: '2026-01-01', end_on: '2027-12-31' }],
  hrObjects: { [OPS_ID + '/contract.pdf']: { type: 'application/pdf', by: ADMIN_ID } },
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function open(page, email, hash) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const P = (page) => page.locator('#pg-profile');
const tab = (page, name) => P(page).getByRole('tab', { name, exact: true }).click();
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const calls = (fn) => mock.hr.calls.filter((c) => c.fn === fn);

test('«ملفي» from the server: my hours and overtime, a request cancelled, the performance, my paid payslip (no sheet total), my contract', async ({ page }) => {
  await open(page, OPS, 'profile');
  await expect(P(page).locator('.sum-tile', { hasText: 'آخر مرتب' })).toContainText('11,000');
  await expect(P(page).locator('.sum-tile', { hasText: 'إنجازاتي' })).toContainText('مهمة خلصت'); // decision 38: the tasks done, not the bonuses
  for (const t of ['إنجازاتي', 'التفضيلات']) await expect(P(page).getByRole('tab', { name: t })).toHaveCount(0);
  await tab(page, 'ساعات العمل');
  const row = P(page).locator('tbody tr').first();
  await expect(row).toContainText('9:40'); await expect(row).toContainText('17:30');
  await expect(row).toContainText('7:50'); await expect(row).not.toContainText('متأخر'); // decision 24: the sessions summed, no lateness
  await expect(P(page)).toContainText('تصوير الكتالوج');
  await expect(P(page).getByRole('tab', { name: 'طلباتي' })).toHaveCount(1); // the owner 11 Nov: my team requests, right after «مهامي»
  await tab(page, 'أدائي');
  await expect(P(page)).toContainText('104%'); await expect(P(page)).toContainText('شحن في الميعاد');
  await tab(page, 'مرتبي');
  const slip = P(page).locator('tbody tr', { hasText: monLabel(PM) });
  await expect(slip).toContainText('••••'); await expect(slip).toContainText('اتصرف');
  await P(page).getByRole('button', { name: 'إظهار' }).click();
  await expect(P(page).locator('tbody tr', { hasText: monLabel(PM) })).toContainText('11,000');
  await P(page).locator('tbody tr', { hasText: monLabel(PM) }).getByRole('button', { name: 'عرض' }).click();
  const m = modal(page, 'قسيمة مرتب ' + monLabel(PM));
  await expect(m).toContainText('حالة الكشف: مدفوع'); await expect(m).toContainText('11,000');
  await expect(m.getByRole('button', { name: 'إرسال للعضو' })).toHaveCount(0);
  await m.locator('.modal-f').getByRole('button', { name: 'إغلاق' }).click();
  expect(calls('hr_my_slips').length).toBeGreaterThan(0);
  expect(calls('hr_payroll_calc')).toEqual([]); // a member never computes the sheet
  await expect(P(page)).not.toContainText('40,000'); // the sheet's total stays the admin's
  await tab(page, 'بيانات الحساب'); // decision 39: the documents are inside it
  await page.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; });
  await P(page).locator('.contract').getByRole('button', { name: 'عرض' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  const [url, target] = await page.evaluate(() => window.__opened[0]);
  expect(url).toContain('/object/sign/hr-docs/' + OPS_ID + '/contract.pdf'); expect(target).toBe('_blank');
});

test('«تغيير كلمة المرور»: a wrong current password changes nothing; the right one is checked on a throwaway session, this session gets the new one, the others sign out — never logged', async ({ page }) => {
  await open(page, OPS, 'profile-security');
  await P(page).getByRole('button', { name: 'تغيير كلمة المرور' }).click();
  const f = modal(page, 'تغيير كلمة المرور');
  await expect(f.locator('#cur')).toHaveAttribute('type', 'password');
  await f.locator('#cur').fill('wrong-pass1'); await f.locator('#p1').fill('NewPass-2026'); await f.locator('#p2').fill('NewPass-2026');
  await f.getByRole('button', { name: 'تغيير' }).click();
  await expect(page.locator('.toast', { hasText: 'كلمة المرور الحالية غلط' })).toBeVisible();
  await expect(f).toBeVisible();
  expect(mock.userUpdates).toEqual([]); expect(mock.logoutScopes).toEqual([]);
  await f.locator('#cur').fill(DEV_PW);
  await f.getByRole('button', { name: 'تغيير' }).click();
  await expect(f).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'اتغيرت كلمة المرور' })).toBeVisible();
  expect(mock.userUpdates.map((u) => [u.email, u.password])).toEqual([[OPS, 'NewPass-2026']]);
  expect(mock.logoutScopes).toEqual(['local', 'others']); // the checker's own session, then the other devices
  await expect.poll(() => mock.activity.map((a) => a.action)).toContain('profile.password');
  const logged = JSON.stringify(mock.activity);
  expect(logged.includes('NewPass')).toBe(false); expect(logged.includes(DEV_PW)).toBe(false);
  await page.reload(); // this session survived
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#lg-id')).toHaveCount(0);
});

test('the admin on a member\'s file: the job and pay card, «تعديل» writes the shift (hr_members) and the pay (hr_pay), the notes, «باسورد مؤقت جديد» once', async ({ page }) => {
  await open(page, ADMIN, 'member-M02');
  await expect(P(page)).toContainText('بتشوف ملف سارة أحمد كأدمن');
  const job = P(page).locator('.card.admin', { hasText: 'الوظيفة والمرتب' });
  await expect(job).toContainText('12,000'); await expect(job).toContainText('09:00 – 17:00');
  await job.getByRole('button', { name: 'تعديل' }).click();
  const f = modal(page, 'تعديل الوظيفة والمرتب — سارة أحمد');
  await expect(f.locator('#salary')).toBeFocused();
  await f.locator('#salary').fill('13000'); await f.locator('#s0').fill('10:00'); await f.locator('#s1').fill('18:00');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f).toBeHidden();
  expect(mock.hr.pay.find((r) => r.member_id === OPS_ID)).toMatchObject({ salary: 13000, holdback: 1500, allowances: 500 });
  expect(mock.hr.members.find((r) => r.member_id === OPS_ID)).toMatchObject({ shift_start: '10:00', shift_end: '18:00' });
  await expect(P(page).locator('.card.admin', { hasText: 'الوظيفة والمرتب' })).toContainText('10:00 – 18:00');
  const notes = P(page).locator('.card.admin', { hasText: 'ملاحظات داخلية' }).locator('textarea');
  await notes.fill('ممتازة في الشحن'); await notes.press('Tab');
  await expect.poll(() => (mock.hr.members.find((r) => r.member_id === OPS_ID) || {}).notes).toBe('ممتازة في الشحن');
  // the security review (5 Nov): the note goes through hr_member_note_set, and comes back through hr_member_notes after the reload
  expect(calls('hr_member_note_set').map((c) => [c.p_member, c.p_notes])).toEqual([[OPS_ID, 'ممتازة في الشحن']]);
  await expect.poll(() => calls('hr_member_notes').length).toBeGreaterThan(1);
  await expect(notes).toHaveValue('ممتازة في الشحن');
  await P(page).locator('.card.admin', { hasText: 'الأمان' }).getByRole('button', { name: 'باسورد مؤقت جديد' }).click();
  await page.locator('.modal[role=dialog]').getByRole('button', { name: 'اعمل باسورد جديد' }).click();
  await expect(page.locator('[data-temp-password]')).toHaveText('mock-temp-1');
  expect(mock.hr.calls.filter((c) => c.fn === 'team-admin').map((c) => c.action)).toEqual(['member_password']);
  await page.locator('.modal[role=dialog]', { hasText: 'الباسورد المؤقت' }).getByRole('button', { name: 'تمام' }).click();
  await tab(page, 'المرتب');
  await expect(P(page).locator('tbody tr', { hasText: monLabel(PM) })).toContainText('11,000');
  await expect(P(page).locator('tbody tr', { hasText: 'الشهر المفتوح' })).toContainText('مسودة');
});

test('ops (hr.view P, no sensitive.salaries) on another member\'s file: no money, no beige cards', async ({ page }) => {
  await open(page, OPS, 'member-M03');
  await expect(P(page)).toContainText('بتشوف ملف محمد علي');
  await expect(P(page).locator('.card.admin')).toHaveCount(0);
  await expect(P(page).locator('.sum-tile', { hasText: 'آخر مرتب' })).toContainText('المرتبات للأدمن بس');
  await tab(page, 'المرتب');
  await expect(P(page)).toContainText('المرتبات للأدمن بس');
  await expect(P(page)).not.toContainText('9,000');
  expect(calls('hr_my_slips').length).toBe(0);
  expect(calls('hr_member_notes').length).toBe(0); // the internal notes are hr.edit F's only (security review 5 Nov)
});

test('«تعديل بياناتي»: the mobile saved on my profile (a taken one refused), a new email through Supabase\'s confirmation link — neither logged', async ({ page }) => {
  await open(page, OPS, 'profile-security');
  await P(page).locator('.prof-head').getByRole('button', { name: 'إجراءات سريعة' }).click(); await page.getByRole('menuitem', { name: 'تعديل البيانات' }).click(); // decision 45: the header's button is a menu
  const f = modal(page, 'تعديل بياناتي');
  await expect(f.locator('#name')).toBeFocused();
  // decision 22: the job title, department, role and status are shown read-only — no field for them
  await expect(f.locator('[data-info-readonly]')).toContainText('مديرة العمليات');
  await expect(f.locator('[data-info-readonly]')).toContainText('العمليات');
  await expect(f.locator('[data-info-readonly]')).toContainText('نشط');
  await expect(f.locator('input#title, input#role, input#status, input#dept')).toHaveCount(0);
  await expect(f.locator('#cur')).toHaveAttribute('type', 'password');
  await f.locator('#phone').fill('01000000003'); // محمد علي's
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.locator('.toast', { hasText: 'الرقم ده مسجّل لعضو تاني' })).toBeVisible();
  await expect(f).toBeVisible();
  await f.locator('#phone').fill('٠١٢٢٣٣٣٤٤٤٥'); await f.locator('#email').fill('sara.new@ibtekr.local');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'اتبعت لينك تأكيد على sara.new@ibtekr.local' })).toBeVisible();
  expect(mock.profileWrites.map((w) => [w.by, w.phone])).toEqual([[OPS_ID, '01223334445']]);
  expect(mock.profiles.find((x) => x.id === OPS_ID).phone).toBe('01223334445');
  expect(mock.userUpdates.map((u) => u.email)).toEqual(['sara.new@ibtekr.local']); // Supabase sends the link; the profile follows once confirmed (0047)
  await expect(P(page).locator('.kv', { hasText: 'الموبايل' }).first()).toContainText('01223334445');
  await expect.poll(() => mock.activity.map((a) => a.action)).toContain('profile.edit');
  const logged = JSON.stringify(mock.activity); expect(logged.includes('01223334445')).toBe(false); expect(logged.includes('sara.new')).toBe(false);
});

test('decision 22: «تعديل بياناتي» renames me and changes my password in the same popup — a half-filled password section is refused first', async ({ page }) => {
  await open(page, OPS, 'profile');
  await P(page).locator('.prof-head').getByRole('button', { name: 'إجراءات سريعة' }).click(); await page.getByRole('menuitem', { name: 'تعديل البيانات' }).click();
  const f = modal(page, 'تعديل بياناتي');
  await f.locator('#name').fill('  سارة   أحمد  علي ');
  await f.locator('#p1').fill('NewPass-2026'); await f.locator('#p2').fill('NewPass-2026');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f.getByText('اكتب كلمة المرور الحالية')).toBeVisible(); // nothing sent yet
  expect(mock.profileWrites).toEqual([]); expect(mock.userUpdates).toEqual([]);
  await f.locator('#cur').fill(DEV_PW);
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'اتحفظ الاسم وكلمة المرور' })).toBeVisible();
  expect(mock.profileWrites).toEqual([{ by: OPS_ID, name: 'سارة أحمد علي' }]);
  expect(mock.userUpdates.map((u) => u.password)).toEqual(['NewPass-2026']);
  await expect(page.locator('.topbar .user-btn')).toContainText('سارة أحمد علي');
  const logged = JSON.stringify(mock.activity); expect(logged.includes('NewPass')).toBe(false);
});
