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

// owner batch 14 Nov decision 12 («المهام هيا بس المهام التلقائية اللي بتيجي من السيستم، غير كده كلها طلبات»): no manual task — no
// add box, no own list; «مهامي» = «تلقائية من السيستم» and a way to open a team request
test('owner batch 14 Nov: «مهامي» is the system\'s automatic tasks only — no add box, no manual list, «فتح طلب» for anything else', async ({ page }) => {
  await open(page, OPS, 'profile-tasks');
  await expect(P(page).locator('.task-add')).toHaveCount(0);
  await expect(P(page).locator('.task:not(.auto)')).toHaveCount(0);
  await expect(P(page).locator('.subtab', { hasText: 'المؤجل' })).toHaveCount(0);
  await expect(P(page).locator('[data-tasks-note]')).toContainText('«طلب» من «طلبات الفريق»');
  await expect(P(page).getByRole('button', { name: 'فتح طلب' })).toBeVisible();
  expect(calls('hr_task_add')).toEqual([]);
});

test('the reviewer: «راجع: …» in «تلقائية من السيستم», «رجّعها» needs a note', async ({ page }) => {
  await open(page, ADMIN, 'profile-tasks');
  const auto = P(page).locator('[data-auto="rv7"]'); await expect(auto).toContainText('راجع: تسوية حساب البنك — منى حسن');
  await auto.getByRole('button').click();
  const m = modal(page, 'مراجعة مهمة'); await m.getByRole('radio', { name: 'رجّعها — محتاجة تعديل' }).click(); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(m).toContainText('اكتب ملاحظتك');
  await m.locator('textarea').fill('ناقص كشف أكتوبر'); await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(m).toHaveCount(0); await expect(auto).toHaveCount(0);
  expect(calls('hr_task_review')[0]).toMatchObject({ p_id: 7, p_ok: false, p_note: 'ناقص كشف أكتوبر' });
  // owner batch 14 Nov decision 12: no «ضيف مهمة» on a member's file either
});

test('«تلقائية من السيستم» from the live data: my team\'s request waiting for me, my role\'s urgent ticket, then the count of the rest', async ({ page }) => {
  await open(page, ADMIN, 'profile-tasks');
  const box = P(page).locator('.task.auto');
  await expect(box.filter({ hasText: 'مراجعة طلب إجازة سنوية — سارة أحمد' })).toHaveCount(1);
  await expect(P(page).locator('[data-auto="tkTKT-0001"] a')).toHaveAttribute('href', '#tickets/TKT-0001');
  await expect(P(page).locator('[data-auto="tkTKT-0001"]')).toContainText('الرد على تذكرة TKT-0001 (عاجل)');
  await expect(P(page).locator('[data-auto="tk"]')).toContainText('الرد على تذكرة مفتوحة');
  // decision 33: the request is decided in «تذاكر الفريق» (a seeded request without its ticket opens the list)
  await box.filter({ hasText: 'مراجعة طلب إجازة سنوية' }).getByRole('button').click();
  await expect(page).toHaveURL(/#tickets$/);
});

test('the dashboard\'s «يومي — دوامي ومهامي»: the automatic tasks as links (owner batch 14 Nov decision 12 — no manual checkbox)', async ({ page }) => {
  await open(page, ADMIN, 'dashboard');
  const card = page.locator('.dc-daily');
  await expect(card.locator('[data-dash-auto] .dash-task-auto').first()).toBeVisible();
  await expect(card.locator('[data-dash-auto]')).toContainText('راجع: تسوية حساب البنك');
  await expect(card.getByRole('checkbox')).toHaveCount(0);
});

test('the staff report: «مهام مفتوحة» and «أكتر 5 عندهم مهام» from the team\'s open tasks now', async ({ page }) => {
  await open(page, ADMIN, 'reports-staff');
  const kpi = page.locator('#rpanel .kpi[aria-label="مهام مفتوحة"]'); await expect(kpi).toContainText('4'); // سارة 3 (جاري · لسه · لسه) + منى 1 (جاهزة للمراجعة); «اتأجلت» and «خلصت» out
  const top = page.locator('#rpanel [data-staff="tasks"] .st-row');
  await expect(top).toHaveCount(2); await expect(top.nth(0)).toContainText('سارة أحمد'); await expect(top.nth(0)).toContainText('3'); await expect(top.nth(1)).toContainText('منى حسن');
});
