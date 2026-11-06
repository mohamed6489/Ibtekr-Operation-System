import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// «ملفي › مهامي» on the server (phase 10 decision 25, 0048 hr_tasks): the member's today with «من امبارح», a task the admin put on them
// («من …», no «حذف»), «ضيف مهمة» with Enter (the field keeps its focus), a status with its reason, the checkbox to «خلصت», «حذف», the
// postponed and the done tabs; the reviewer's «راجع: …» in «تلقائية من السيستم» («رجّعها» needs a note, the owner reads it back); the
// admin on a member's file adds a task for them; the team's requests and my role's tickets as automatic tasks; the dashboard's daily card;
// the staff report's «مهام مفتوحة». The log carries codes and statuses, never a title. Mock only; the dates follow today (Cairo).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const OPS_ID = '00000000-0000-4000-8000-000000000002'; const ACC_ID = '00000000-0000-4000-8000-000000000004';
const T = hrToday();
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
const SEED = {
  hrMembers: [{ member_id: OPS_ID }, { member_id: ACC_ID }],
  hrTasks: [
    { member_id: OPS_ID, title: 'تجهيز عرض المبتكرين الجدد', status: 'جاري', day: addDays(T, -1) }, // 1 — from yesterday
    { member_id: OPS_ID, title: 'مكالمة مع شركة الشحن', status: 'لسه', day: T }, // 2
    { member_id: OPS_ID, title: 'مراجعة صور منتجات W&R', status: 'لسه', day: T, created_by: ADMIN_ID }, // 3 — the admin put it
    { member_id: OPS_ID, title: 'خطة محتوى نوفمبر', status: 'اتأجلت', until: null, day: addDays(T, -3) }, // 4 — «المؤجل»
    { member_id: OPS_ID, title: 'إرسال فواتير سبتمبر', status: 'خلصت', day: T, done_at: at(1) }, // 5 — «خلصت»
    { member_id: ADMIN_ID, title: 'مراجعة كشف المرتبات', status: 'لسه', day: T }, // 6 — the admin's own
    { member_id: ACC_ID, title: 'تسوية حساب البنك', status: 'جاهزة للمراجعة', reviewer_id: ADMIN_ID, day: T }, // 7 — waits for the admin
  ],
  hrRequests: [{ member_id: OPS_ID, type: 'إجازة سنوية', from_day: addDays(T, 9), to_day: addDays(T, 9), note: 'فرح' }],
  tickets: [
    { id: 1, type: 'internal', title: 'الطابعة واقفة', description: 'محتاجين حبر', priority: 'urgent', assignee_role: 'مدير النظام', created_by: OPS_ID, created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن', created_at: at(3), last_update: at(3) },
    { id: 2, type: 'internal', title: 'تحديث الأسعار', description: 'قايمة جديدة', priority: 'normal', assignee_role: 'مدير النظام', created_by: OPS_ID, created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن', created_at: at(2), last_update: at(2) },
  ],
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
const row = (page, title) => P(page).locator('.task:not(.auto)', { hasText: title });
const sub = (page, name) => P(page).locator('.subtab', { hasText: name });
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const calls = (fn) => mock.hr.calls.filter((c) => c.fn === fn);
const task = (id) => mock.hr.tasks.find((t) => t.id === id);

test('the member: today with «من امبارح» and the admin\'s task, «ضيف مهمة» with Enter, «متوقفة» with its reason, the checkbox, «حذف», the postponed and the done', async ({ page }) => {
  await open(page, OPS, 'profile-tasks');
  await expect(row(page, 'تجهيز عرض المبتكرين الجدد')).toContainText('من امبارح');
  await expect(row(page, 'مراجعة صور منتجات W&R')).toContainText('من صفوت كمال');
  await expect(row(page, 'مراجعة صور منتجات W&R').getByRole('button', { name: /^إجراءات/ })).toHaveCount(0); // the admin put it: no «حذف» for the member
  await expect(P(page).locator('.task.auto').first()).toBeVisible(); // the open orders not confirmed yet (ops has orders.status F)
  await expect(sub(page, 'النهارده').locator('.cnt')).toHaveText(String(3 + await P(page).locator('.task.auto').count())); // the three of today + the automatic ones
  // «ضيف مهمة واضغط Enter»: it shows at once, the field stays focused and empty
  const add = P(page).locator('.task-add'); await add.fill('متابعة شحنة أسوان'); await add.press('Enter');
  await expect(row(page, 'متابعة شحنة أسوان')).toBeVisible(); await expect(add).toBeFocused(); await expect(add).toHaveValue('');
  await expect.poll(() => calls('hr_task_add').length).toBe(1);
  expect(calls('hr_task_add')[0]).toMatchObject({ p_member: OPS_ID, p_title: 'متابعة شحنة أسوان' });
  // a status with its reason
  await row(page, 'مكالمة مع شركة الشحن').locator('.tstat-btn').click(); await page.getByRole('option', { name: 'متوقفة · Hold' }).click();
  const m = modal(page, 'وقّف المهمة'); await m.getByRole('button', { name: 'حفظ' }).click(); await expect(m).toContainText('اكتب سبب التوقف');
  await m.locator('textarea').fill('مستني رد الشركة'); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(row(page, 'مكالمة مع شركة الشحن')).toContainText('السبب: مستني رد الشركة');
  await expect.poll(() => task(2).status).toBe('متوقفة');
  expect(calls('hr_task_set')[0]).toMatchObject({ p_id: 2, p_status: 'متوقفة', p_args: { reason: 'مستني رد الشركة' } });
  // the checkbox: «خلصت» leaves «النهارده» for «خلصت»; the day moves up to today
  await row(page, 'تجهيز عرض المبتكرين الجدد').getByRole('checkbox').click();
  await expect(row(page, 'تجهيز عرض المبتكرين الجدد')).toHaveCount(0);
  await expect.poll(() => [task(1).status, task(1).day, !!task(1).done_at]).toEqual(['خلصت', T, true]);
  await sub(page, 'خلصت').click();
  await expect(row(page, 'تجهيز عرض المبتكرين الجدد')).toBeVisible(); await expect(row(page, 'إرسال فواتير سبتمبر')).toBeVisible();
  // «حذف» on my own task (marked on the server, gone from the list)
  await sub(page, 'النهارده').click();
  await row(page, 'متابعة شحنة أسوان').getByRole('button', { name: 'إجراءات متابعة شحنة أسوان' }).click(); await page.getByRole('menuitem', { name: 'حذف' }).click();
  await expect(row(page, 'متابعة شحنة أسوان')).toHaveCount(0);
  await expect.poll(() => calls('hr_task_delete').length).toBe(1);
  expect(mock.hr.tasks.find((t) => t.title === 'متابعة شحنة أسوان').deleted_at).toBeTruthy();
  // «المؤجل»
  await sub(page, 'المؤجل').click(); await expect(row(page, 'خطة محتوى نوفمبر')).toContainText('لأجل غير مسمى');
  // the log: the member's code and the statuses — never a title
  await expect.poll(() => mock.activity.map((a) => a.action)).toEqual(expect.arrayContaining(['hr.task.add', 'hr.task.status', 'hr.task.delete']));
  const logged = JSON.stringify(mock.activity.filter((a) => /^hr\.task/.test(a.action)));
  expect(logged.includes('شحنة')).toBe(false); expect(logged.includes('مستني')).toBe(false);
});

test('«جاهزة للمراجعة»: the reviewer from the team (the direct manager first) — the task waits at the reviewer', async ({ page }) => {
  await open(page, OPS, 'profile-tasks');
  await row(page, 'مكالمة مع شركة الشحن').locator('.tstat-btn').click(); await page.getByRole('option', { name: 'جاهزة للمراجعة · Ready for review' }).click();
  const m = modal(page, 'جاهزة للمراجعة'); await expect(m.locator('#reviewer')).toContainText('صفوت كمال');
  await m.locator('#reviewer').click(); await expect(page.getByRole('option', { name: 'سارة أحمد' })).toHaveCount(0); // not the task's own member
  await page.getByRole('option', { name: 'منى حسن' }).click(); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(row(page, 'مكالمة مع شركة الشحن')).toContainText('المراجع: منى حسن');
  await expect.poll(() => [task(2).status, task(2).reviewer_id]).toEqual(['جاهزة للمراجعة', ACC_ID]);
});

test('the reviewer: «راجع: …» in «تلقائية من السيستم», «رجّعها» needs a note, the owner reads it; on a member\'s file the admin adds a task for them', async ({ page }) => {
  await open(page, ADMIN, 'profile-tasks');
  const auto = P(page).locator('[data-auto="rv7"]'); await expect(auto).toContainText('راجع: تسوية حساب البنك — منى حسن');
  await auto.getByRole('button').click();
  const m = modal(page, 'مراجعة مهمة'); await m.getByRole('radio', { name: 'رجّعها — محتاجة تعديل' }).click(); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(m).toContainText('اكتب ملاحظتك');
  await m.locator('textarea').fill('ناقص كشف أكتوبر'); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(m).toHaveCount(0); await expect(auto).toHaveCount(0);
  expect(calls('hr_task_review')[0]).toMatchObject({ p_id: 7, p_ok: false, p_note: 'ناقص كشف أكتوبر' });
  // the member's file: «المهام» with the note back; the admin adds one for them
  await page.evaluate(() => { location.hash = 'member-M04'; });
  await P(page).getByRole('tab', { name: 'المهام', exact: true }).click();
  await expect(row(page, 'تسوية حساب البنك')).toContainText('رجعت من صفوت كمال: ناقص كشف أكتوبر');
  const add = P(page).locator('.task-add'); await add.fill('مراجعة فواتير المبتكرين'); await add.press('Enter');
  await expect.poll(() => calls('hr_task_add').length).toBe(1);
  expect(calls('hr_task_add')[0]).toMatchObject({ p_member: ACC_ID, p_title: 'مراجعة فواتير المبتكرين' });
  await expect(row(page, 'مراجعة فواتير المبتكرين')).toContainText('من صفوت كمال');
});

test('«تلقائية من السيستم» from the live data: my team\'s request waiting for me, my role\'s urgent ticket, then the count of the rest', async ({ page }) => {
  await open(page, ADMIN, 'profile-tasks');
  const box = P(page).locator('.task.auto');
  await expect(box.filter({ hasText: 'مراجعة طلب إجازة سنوية — سارة أحمد' })).toHaveCount(1);
  await expect(P(page).locator('[data-auto="tkTKT-0001"] a')).toHaveAttribute('href', '#tickets/TKT-0001');
  await expect(P(page).locator('[data-auto="tkTKT-0001"]')).toContainText('الرد على تذكرة TKT-0001 (عاجل)');
  await expect(P(page).locator('[data-auto="tk"]')).toContainText('الرد على تذكرة مفتوحة');
  // the request opens «طلباتي › محتاجة مني»
  await box.filter({ hasText: 'مراجعة طلب إجازة سنوية' }).getByRole('button').click();
  await expect(P(page).getByRole('tab', { name: 'طلباتي', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(P(page).locator('.subtab[aria-selected=true]')).toContainText('محتاجة منك');
});

test('the dashboard\'s «يومي — دوامي ومهامي»: today\'s tasks from the server, the checkbox writes «خلصت»', async ({ page }) => {
  await open(page, ADMIN, 'dashboard');
  const card = page.locator('.dc-daily'); const cb = card.getByRole('checkbox', { name: 'مراجعة كشف المرتبات' });
  await expect(cb).toHaveAttribute('aria-checked', 'false'); await cb.click();
  await expect.poll(() => task(6).status).toBe('خلصت');
  await expect(card.getByRole('checkbox', { name: 'مراجعة كشف المرتبات' })).toHaveAttribute('aria-checked', 'true');
});

test('the staff report: «مهام مفتوحة» and «أكتر 5 عندهم مهام» from the team\'s open tasks now', async ({ page }) => {
  await open(page, ADMIN, 'reports-staff');
  const kpi = page.locator('#rpanel .kpi[aria-label="مهام مفتوحة"]'); await expect(kpi).toContainText('4'); // سارة 3 (جاري · لسه · لسه) + منى 1 (جاهزة للمراجعة); «اتأجلت» and «خلصت» out
  const top = page.locator('#rpanel [data-staff="tasks"] .st-row');
  await expect(top).toHaveCount(2); await expect(top.nth(0)).toContainText('سارة أحمد'); await expect(top.nth(0)).toContainText('3'); await expect(top.nth(1)).toContainText('منى حسن');
});
