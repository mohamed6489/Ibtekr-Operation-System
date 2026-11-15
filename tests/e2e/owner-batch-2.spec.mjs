import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner's second batch of 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch-2.md). Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
const modal = (page) => page.locator('.modal[role=dialog]');

test('T1 — decisions 1, 8, 18, 20, 30, 31, 29: no compact rows, the save popup, the makers settings and the data page trimmed, no «null» in the template popup', async ({ page }) => {
  // 1. «الوضع المضغوط للجداول» is gone
  await go(page, 'settings-general');
  await expect(page.locator('#pg-settings')).not.toContainText('الوضع المضغوط');
  // 8. a change, then «رجوع»: «احفظ واخرج» first (the right one in RTL), «تجاهل التغييرات» second; no «ارجع للصفحة»
  await page.locator('#g-co').fill('إبتكر تجربة');
  await page.locator('[data-set-back]').click();
  const ask = modal(page).filter({ hasText: 'لازم تحفظ التغييرات الأول' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.modal-f button, footer button, .modal-foot button').first()).toHaveText(/احفظ واخرج/);
  await expect(ask.getByRole('button', { name: 'ارجع للصفحة' })).toHaveCount(0);
  const [save, drop] = [ask.locator('[data-save-now]'), ask.locator('[data-save-discard]')];
  const xs = await Promise.all([save.evaluate((b) => b.getBoundingClientRect().left), drop.evaluate((b) => b.getBoundingClientRect().left)]);
  expect(xs[0]).toBeGreaterThan(xs[1]); // «احفظ واخرج» right of «تجاهل التغييرات»
  await drop.click();
  await expect(page.locator('#pg-settings [data-set-jump]')).toBeVisible(); // out to the hub
  await go(page, 'settings-general');
  await expect(page.locator('#g-co')).not.toHaveValue('إبتكر تجربة');
  // 18 + 20. the makers settings: no «إيقاف تنشيط مبتكر», no coverage table
  await go(page, 'settings-makers');
  await expect(page.locator('#pg-settings')).not.toContainText('إيقاف تنشيط مبتكر');
  await expect(page.locator('#pg-settings .mk-cover')).toHaveCount(0);
  // 30 + 31. the data page: no «عرض النسخ السابقة»; the full copy is a regular section
  await go(page, 'settings-data');
  await expect(page.locator('#pg-settings')).not.toContainText('عرض النسخ السابقة');
  await expect(page.locator('#pg-settings .card.sec', { hasText: 'نسخة كاملة من البيانات' })).toHaveCount(1);
  // 29. the template popup never shows «null»
  await page.locator('[data-tpl$=":update"]').first().click();
  await expect(modal(page).last()).toBeVisible();
  await expect(modal(page).last()).not.toContainText('null');
});

test('T1 — decisions 6 and 34: a work day picked is green with beige text; what is selected is light beige with a thick green border', async ({ page }) => {
  await go(page, 'settings-hr');
  const day = page.locator('#pg-settings [data-hs-day][aria-checked=true]').first();
  await expect(day).toHaveCSS('background-color', 'rgb(0, 86, 66)');
  // a picked option in a list
  await go(page, 'settings-general');
  await page.locator('#g-week').click();
  const opt = page.locator('[role=listbox] [role=option][aria-selected=true]').first();
  await expect(opt).toHaveCSS('background-color', 'rgb(246, 234, 214)');
  await expect(opt).toHaveCSS('color', 'rgb(0, 86, 66)');
  await page.keyboard.press('Escape');
});

const lists = () => ((mock.settings || []).find((r) => r.section === 'lists') || {}).data || {};

test('T2 — decision 22: an order status added «بتتحسب زي» a base one; the orders page offers it and writes it as its base + status_custom; in use it is not deleted', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  const add = body.locator('[data-status-add="order"]');
  await expect(add).toBeEnabled(); // status_map read live
  await add.click();
  await modal(page).locator('#name').fill('متابعة');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('اختار الحالة الأساسية'); // the base is required
  await modal(page).locator('#base').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'جاري التنفيذ' }).first().click();
  await modal(page).locator('#slug').fill('Bad Slug');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('حروف إنجليزي صغيرة');
  await modal(page).locator('#slug').fill('');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(body.locator('[data-status="متابعة"]')).toHaveCount(1);
  expect(mock.statusMap.find((r) => r.system_status === 'متابعة')).toMatchObject({ base: 'جاري التنفيذ', woo_status: null });
  await expect(body.locator('[data-status-slug="متابعة"]')).toHaveText('processing'); // its base's slug
  // a base status: no «حذف»; the added one: «حذف»
  await body.locator('tr').filter({ has: page.locator('[data-status="مكتمل"]') }).locator('button[aria-haspopup=menu]').click();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // the orders page: the dropdown offers it; picking it writes the base + the added one and pushes the added one
  await go(page, 'orders');
  const sel = page.locator('#orders select[data-st="181668"]').first();
  await expect(sel.locator('option', { hasText: 'متابعة' })).toHaveCount(1);
  await sel.selectOption('متابعة');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders')).toEqual([{ table: 'orders', id: 181668, status: 'جاري التنفيذ', status_custom: 'متابعة' }]);
  await expect.poll(() => mock.pushes.map((p) => [p.order_id, p.status])).toEqual([[181668, 'متابعة']]);
  await expect(page.locator('#orders .card').filter({ hasText: 'IB-181668' }).first()).toContainText('متابعة');
  // in use → not deleted
  await go(page, 'settings-lists');
  await body.locator('tr').filter({ has: page.locator('[data-status="متابعة"]') }).locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  await modal(page).getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'عليها أوردرات' }).first()).toBeVisible();
  expect(mock.statusMap.some((r) => r.system_status === 'متابعة')).toBe(true);
  // back to a base status: status_custom cleared
  await go(page, 'orders');
  await page.locator('#orders select[data-st="181668"]').first().selectOption('جاهز للشحن');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders').slice(-1)[0]).toEqual({ table: 'orders', id: 181668, status: 'جاهز للشحن', status_custom: null });
  expect(mock.orders.find((o) => o.id === 181668).status_custom).toBe(null);
});

test('T2 — decision 22: confirmation and product statuses added in the settings show in the orders page; a base one has no «حذف»', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'حالات التأكيد' }).click();
  await body.locator('[data-status-add="confirm"]').click();
  await modal(page).locator('#v').fill('غير مؤكد');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('فيه حالة بالاسم ده');
  await modal(page).locator('#v').fill('بيفكر');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().statusAdded).toEqual({ confirm: ['بيفكر'], sub: [] });
  await expect(body.locator('[data-status]')).toHaveText(['مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد', 'بيفكر']);
  await body.getByRole('tab', { name: 'حالات المنتج' }).click();
  await body.locator('[data-status-add="sub"]').click();
  await modal(page).locator('#v').fill('في التغليف');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect.poll(() => lists().statusAdded).toEqual({ confirm: ['بيفكر'], sub: ['في التغليف'] });
  await go(page, 'orders');
  await expect(page.locator('#orders select[data-cf="181668"]').first().locator('option', { hasText: 'بيفكر' })).toHaveCount(1);
  await page.locator('#orders select[data-cf="181668"]').first().selectOption('بيفكر');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders').map((p) => p.confirm)).toEqual(['بيفكر']);
});

test('T2 — decision 22 (security review): a status name with a quote or & is refused, and the order page escapes the names it shows', async ({ page }) => {
  await go(page, 'settings-lists');
  const body = page.locator('#pg-settings');
  await body.locator('[data-status-add="order"]').click();
  await modal(page).locator('#name').fill('حالة "x"');
  await modal(page).getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(modal(page)).toContainText('من غير');
  await page.keyboard.press('Escape');
  // a name the server already holds with a quote (made by hand): the chips and the edit popup keep it as text
  mock.statusMap.push({ id: 99, system_status: 'مراجعة "خاصة"', woo_status: null, direction: 'both', sort: 99, base: 'جاري التنفيذ' });
  await go(page, 'orders');
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders [data-sc="مراجعة \\"خاصة\\""]')).toHaveCount(1);
  await expect(page.locator('#orders select[data-st="181668"]').first().locator('option', { hasText: 'مراجعة "خاصة"' })).toHaveCount(1);
});

test('T3 — decision 17: the delay rules in two boxes (no per-maker rules); the start point, the risk days and the stop statuses are saved and the orders page counts with them', async ({ page }) => {
  await go(page, 'settings-makers');
  const body = page.locator('#pg-settings');
  await expect(body.locator('.dl-boxes > .card')).toHaveCount(2);
  // the owner 15 Nov: the two boxes say what they are
  expect(await body.locator('.dl-boxes > .card h2').allTextContents()).toEqual(['قواعد تأخير الأوردر الرئيسي', 'قواعد تأخير الأوردر الفرعي']);
  await expect(body).not.toContainText('قواعد خاصة لكل مبتكر');
  const delay = () => (((mock.settings || []).find((r) => r.section === 'makers') || {}).data || {}).delay;
  // the risk days of the order
  await body.locator('#dl-orisk').click(); await page.locator('[role=listbox] [role=option]', { hasText: '4 يوم' }).first().click();
  await expect.poll(() => (delay() || {}).orderRisk).toBe(4);
  // «قيد الشحن» no longer stops the counter
  await body.locator('[data-delay-st="قيد الشحن"]').click();
  await expect.poll(() => (delay() || {}).stop).toEqual(['مكتمل', 'ملغي', 'استرجاع', 'فشل']);
  await expect(body.locator('[data-delay-st="قيد الشحن"]')).toHaveAttribute('aria-checked', 'false');
  // the orders page: 180656 is not confirmed — no delay from the confirmation …
  mock.orders.find((o) => o.id === 180656).placed_at = new Date(Date.now() - 30 * 864e5).toISOString();
  const leave = async () => { const sv = page.locator('[data-set-save]').first(); if (await sv.count()) await sv.click(); await go(page, 'orders'); };
  await leave();
  const badge = (id) => page.locator('#orders .card').filter({ hasText: 'IB-' + id }).first().locator('.badge').filter({ hasText: /^\s*متأخر\s*$/ });
  await expect(badge('180656')).toHaveCount(0);
  // … counted from the order's own date it is past its making days
  await go(page, 'settings-makers');
  await body.locator('#dl-start').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'تاريخ الأوردر' }).first().click();
  await expect.poll(() => (delay() || {}).start).toBe('order');
  await expect(body.locator('[data-delay-start-help]')).toContainText('الأوردر والأوردرات الفرعية من تاريخ الأوردر');
  await leave();
  await expect(badge('180656')).toHaveCount(1);
});

test('T4 — decision 2: the permissions in three levels — a role opens its levels, the matrix of a level is saved as that level; a member\'s level beside his role', async ({ page }) => {
  await go(page, 'settings-team');
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'الأدوار والصلاحيات' }).click();
  // a role chip opens its three levels
  await body.locator('[data-role-chip="عمليات"]').click();
  await expect(body.locator('[data-role-levels="عمليات"] [data-role-level]')).toHaveCount(3);
  await body.locator('[data-role-levels="عمليات"] [data-role-level="manager"]').click();
  await expect(body.locator('[data-role-levels="عمليات"] [data-role-level="manager"]')).toHaveAttribute('aria-pressed', 'true');
  // the owner 15 Nov: the matrix is the picked role at the picked level only — no other role's column
  const pm = body.locator('[data-perm-matrix]');
  await expect(pm.locator('.mx-head > .t-label-s')).toHaveCount(1);
  await expect(pm.locator('.mx-head')).toContainText('عمليات · المدير');
  await expect(pm.locator('.mx-head')).not.toContainText('خدمة العملاء');
  // toggle a cell of «عمليات» in the manager's matrix → saved as the manager group only
  const cell = pm.locator('button.pm[aria-label*="عمليات"]').filter({ hasNot: page.locator('[disabled]') }).first();
  const label = await cell.getAttribute('aria-label');
  await cell.click();
  await expect.poll(() => (mock.st.writes || []).filter((w) => w.op === 'level_perms').map((w) => [w.id, w.level])).toContainEqual(['ops', 'manager']);
  const ops = mock.st.roles.find((r) => r.id === 'ops');
  expect(ops.level_perms && ops.level_perms.manager).toBeTruthy();
  expect(label).toContain('عمليات');
  const sv = page.locator('[data-set-save]').first(); if (await sv.count()) await sv.click(); // the matrix change saved before leaving the tab
  // the member's level beside the role (the admin): «مشاهد» for the ops member
  await body.getByRole('tab', { name: 'الأعضاء' }).click();
  const row = body.locator('tr', { hasText: 'ops.dev@ibtekr.local' }).first();
  await expect(async () => { // the page redraws once the roles are read again after the matrix save
    await row.getByRole('button', { name: 'موظف', exact: true }).click();
    await page.getByRole('option', { name: 'مشاهد', exact: true }).last().click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect.poll(() => (mock.st.writes || []).filter((w) => w.op === 'level').map((w) => w.level)).toEqual(['viewer']);
});

// the owner 15 Nov: «قدام كل عضو الدور والمستوى …» — then the same day «شيل قنوات خدمة العملاء و المدير المسؤول و الصلاحيات المخصصة»
test('the members: the role, the extra roles, then the level in their columns — the admin has no level; no «المدير المسؤول» / «قنوات خدمة العملاء» / «صلاحيات مخصصة» columns (⋮ keeps the channels and the permissions)', async ({ page }) => {
  await go(page, 'settings-team');
  const body = page.locator('#pg-settings');
  const heads = (await body.locator('table thead th').allTextContents()).map((x) => x.trim());
  expect(heads).toEqual(expect.arrayContaining(['العضو', 'الدور', 'أدوار إضافية', 'المستوى', 'الحالة', 'آخر دخول']));
  for (const gone of ['المدير المسؤول', 'قنوات خدمة العملاء', 'صلاحيات مخصصة']) expect(heads).not.toContain(gone);
  // the owner 15 Nov: the extra roles in a column of their own, between the role and the level
  expect(heads.findIndex((x) => x === 'أدوار إضافية')).toBe(heads.findIndex((x) => x === 'الدور') + 1);
  expect(heads.findIndex((x) => x === 'المستوى')).toBe(heads.findIndex((x) => x === 'الدور') + 2);
  const admin = body.locator('tr', { hasText: 'admin.dev@ibtekr.local' }).first();
  await expect(admin.locator('[data-member-level="admin"]')).toHaveText('أدمن — كل الصلاحيات');
  const row = body.locator('tr', { hasText: 'ops.dev@ibtekr.local' }).first();
  await expect(row.locator('[data-member-manager]')).toHaveCount(0);
  await row.getByRole('button', { name: /^إجراءات/ }).click();
  await expect(page.getByRole('menuitem', { name: 'صلاحيات مخصصة' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'قنوات خدمة العملاء' })).toBeVisible();
});

test('T4 — decision 4: «إضافة عضو» in three parts; the level «مدير» has no direct manager; another level picks from the role\'s managers; the level is saved after the account', async ({ page }) => {
  await go(page, 'hr-team');
  await page.locator('#pg-hr').getByRole('button', { name: 'إضافة عضو' }).click();
  const f = modal(page).filter({ hasText: 'إضافة عضو' });
  await expect(f.locator('[data-form-sec]')).toHaveText(['البيانات الشخصية', 'البيانات المالية', 'بيانات الوظيفة']);
  await expect(f.locator('#manager')).toHaveCount(1);
  await f.locator('#level').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'مدير' }).first().click();
  await expect(f.locator('#manager')).toHaveCount(0); // a manager has none
  await f.locator('#level').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'مشاهد' }).first().click();
  await expect(f.locator('#manager')).toHaveCount(1);
  // the owner 15 Nov: «بيظهر تلقائي المدير للدور لو متحدد او انا بختار الشخص» — the automatic choice names the role's manager
  // («مفيش» here: خدمة العملاء has none) and any active member can be picked
  await expect(f.locator('#manager')).toContainText('مدير الدور (تلقائي) — مفيش');
  await f.locator('#manager').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'منى حسن' }).first().click();
  await f.locator('#name').fill('ليلى عادل'); await f.locator('#title').fill('مساعدة'); await f.locator('#email').fill('laila.dev@ibtekr.local');
  await f.locator('#hire').fill('01/11/2026'); await f.locator('#hire').press('Tab');
  await f.locator('#salary').fill('8000');
  await f.getByRole('button', { name: 'إضافة وعمل الحساب' }).click();
  await expect.poll(() => (mock.st.writes || []).filter((w) => w.op === 'level').map((w) => w.level)).toEqual(['viewer']);
  const p = mock.profiles.find((x) => x.email === 'laila.dev@ibtekr.local');
  expect(p && p.level).toBe('viewer');
  expect(p && p.manager_id).toBe('00000000-0000-4000-8000-000000000004'); // the picked person
});

// T5 — decision 32: «طلب جديد» → the role, then «كل الدور» or one member of it; the member is stored and shown, «تغيير المسؤول»
// takes it back to the whole role; the role's list opens under its field
test('T5 — decision 32: a request to one member of the role; the list opens under its field; back to «كل الدور»', async ({ page }) => {
  await page.locator('.sidebar .nav-item[data-page="tickets"]').click();
  await page.getByRole('button', { name: 'فتح طلب' }).click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'طلب جديد' });
  await m.locator('#t-title').fill('راجعي كشف المبتكر');
  await m.locator('#t-type').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'طلب خاص' }).first().click();
  await m.locator('#t-desc').fill('الكشف فيه فرق');
  await expect(m.locator('#t-member')).toBeDisabled(); // no role yet
  await m.locator('#t-role').click();
  const list = page.locator('.menu.floating[role=listbox]');
  await expect(list).toHaveAttribute('data-dir', 'down'); // under its field
  const [lb, rb] = await Promise.all([list.boundingBox(), m.locator('#t-role').boundingBox()]);
  expect(lb.y).toBeGreaterThanOrEqual(rb.y + rb.height - 1);
  await list.locator('[role=option]', { hasText: 'الحسابات' }).first().click();
  await m.locator('#t-member').click();
  await expect(page.locator('.menu.floating [role=option]')).toHaveText(['كل الدور', 'منى حسن']);
  await page.locator('.menu.floating [role=option]', { hasText: 'منى حسن' }).click();
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  const d = page.locator('.drawer');
  await expect(d).toContainText('المسؤول: الحسابات — منى حسن');
  await expect(d).toContainText('عيّنها لدور «الحسابات» — منى حسن');
  const w = mock.ticketWrites.find((x) => x.fn === 'ticket_create');
  expect([w.assigneeRole, w.assigneeMember]).toEqual(['الحسابات', '00000000-0000-4000-8000-000000000004']);
  // back to the whole role from «تغيير المسؤول»
  await d.getByRole('button', { name: 'المزيد' }).click();
  await page.getByRole('menuitem', { name: 'تغيير المسؤول' }).click();
  const e = page.locator('.modal[role=dialog]', { hasText: 'تغيير المسؤول' });
  await e.locator('#e-member').click(); await page.locator('.menu.floating [role=option]', { hasText: 'كل الدور' }).click();
  await e.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.ticketWrites.filter((x) => x.fn === 'ticket_act' && x.action === 'update').map((x) => x.assigneeMember)).toEqual(['']);
  await expect(d).toContainText('لكل دور «الحسابات»');
  expect(mock.tickets.at(-1).assignee_member).toBe(null);
});

// T6 — decision 16 (0098): the quick actions by visibility and state; «جرّب / تعديل / إيقاف / امسح» in ⋮
test('T6 — decision 16: a team action from the settings, stopped from ⋮ and gone from the menu; a member adds «أنا بس» from the menu and cannot edit the team one', async ({ page }) => {
  await go(page, '#settings-quick');
  await page.locator('[data-qa-new]').click();
  const f = modal(page).filter({ hasText: 'إجراء سريع جديد' });
  await expect(f.locator('#scope')).toContainText('كل الفريق'); // the admin's default on the settings page
  await f.locator('#name').fill('أوردرات النهارده'); await f.locator('#link').fill('#orders?st=مكتمل');
  await f.getByRole('button', { name: 'ضيف' }).click();
  await expect.poll(() => mock.st.quick.map((x) => [x.name, x.scope, x.active])).toEqual([['أوردرات النهارده', 'all', true]]);
  const row = page.locator('.qa-table tbody tr', { hasText: 'أوردرات النهارده' });
  await expect(row.locator('[data-qa-scope]')).toHaveText('كل الفريق');
  await row.locator('[data-qa-more]').click(); await page.getByRole('menuitem', { name: 'إيقاف' }).click();
  await expect(row.locator('[data-qa-state]')).toHaveText('موقوف');
  await page.locator('[data-quick]').click();
  await expect(page.getByRole('menuitem', { name: 'أوردرات النهارده' })).toHaveCount(0); // stopped = not in the menu
  await page.keyboard.press('Escape');
  await row.locator('[data-qa-more]').click(); await page.getByRole('menuitem', { name: 'تفعيل' }).click();
  await expect(row.locator('[data-qa-state]')).toHaveText('مفعّل');
  // ops (not a role manager) — «إدارة الإجراءات السريعة» opens the popup; a new action is «أنا بس» only
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* */ } }); await page.goto('/');
  await page.fill('#lg-id', 'ops.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('[data-quick]').click();
  await expect(page.getByRole('menuitem', { name: 'أوردرات النهارده' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'إدارة الإجراءات السريعة' }).click();
  const mg = modal(page).filter({ hasText: 'الإجراءات السريعة' });
  const teamRow = mg.locator('.qa-table tbody tr', { hasText: 'أوردرات النهارده' });
  await teamRow.locator('[data-qa-more]').click();
  await expect(page.getByRole('menuitem')).toHaveText(['جرّب']); // not his to edit
  await page.keyboard.press('Escape');
  await mg.locator('[data-qa-new]').click();
  const f2 = modal(page).filter({ hasText: 'إجراء سريع جديد' });
  await f2.locator('#scope').click();
  await expect(page.locator('.menu.floating [role=option]')).toHaveText(['أنا بس']);
  await page.keyboard.press('Escape');
  await f2.locator('#name').fill('تذاكري'); await f2.locator('#link').fill('#tickets');
  await f2.getByRole('button', { name: 'ضيف' }).click();
  await expect.poll(() => mock.st.quick.filter((x) => x.scope === 'me').map((x) => [x.name, x.owner])).toEqual([['تذاكري', '00000000-0000-4000-8000-000000000002']]);
  await expect(mg.locator('.qa-table tbody tr', { hasText: 'تذاكري' }).locator('[data-qa-scope]')).toHaveText('أنا بس');
});

// T7 — decisions 11 and 12 (0099): a linked platform pauses for a while from its card (the settings row «integrations»), «كمّل» brings it back
test('T7 — decision 11: «إيقاف مؤقت» for a day writes integrations.paused, the card says «موقوف مؤقتًا», «كمّل» clears it; the social cards link from here', async ({ page }) => {
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-xxxxxxxxxxxxxxxxxxxx1234' });
  await go(page, '#settings-integrations');
  await page.locator('#pg-settings [role=tab]', { hasText: 'الذكاء الاصطناعي' }).click();
  const card = page.locator('#pg-settings [data-integ="claude"]');
  await expect(card).toContainText('متصل');
  await card.locator('[data-integ-pause="claude"]').click();
  const f = modal(page).filter({ hasText: 'إيقاف' });
  await f.getByRole('radio', { name: 'يوم' }).click();
  await f.getByRole('button', { name: 'إيقاف', exact: true }).click();
  await expect.poll(() => { const r = (mock.settings || []).find((x) => x.section === 'integrations'); return r && r.data && r.data.paused ? Object.keys(r.data.paused) : []; }).toEqual(['anthropic']);
  const until = Date.parse(mock.settings.find((x) => x.section === 'integrations').data.paused.anthropic);
  expect(until - Date.now()).toBeGreaterThan(23 * 3600e3);
  await expect(card).toContainText('موقوف مؤقتًا');
  await card.locator('[data-integ-resume="claude"]').click();
  await expect.poll(() => Object.keys(mock.settings.find((x) => x.section === 'integrations').data.paused || {})).toEqual([]);
  await expect(card).not.toContainText('موقوف مؤقتًا');
  // decision 12: Meta / WhatsApp link from here (not from «خدمة العملاء › القنوات»)
  await page.locator('#pg-settings [role=tab]', { hasText: 'وسائل التواصل' }).click();
  await expect(page.locator('#pg-settings [data-integ-connect="messenger"]')).toBeVisible();
  await expect(page.locator('#pg-settings [data-integ-connect="wa"]')).toBeVisible();
});

test('T8 — decisions 13–15: the six shot rules of the studio; «+ تعليمات جديدة» adds a template; a campaign picks it beside its own words (the ids only)', async ({ page }) => {
  await go(page, '#settings-ai');
  const st = page.locator('#pg-settings');
  // decision 13: the studio's five shots + the features image, in its order
  await expect(st).toContainText('قواعد اللقطات');
  for (const l of ['1 · في النص', '2 · بيئة', '3 · بيئة تانية', '4 · تفاصيل 2×2', '5 · رسم المقاس', '6 · صورة المميزات']) await expect(st.getByText(l, { exact: true })).toBeVisible();
  await expect(st.locator('#ai-s0')).toHaveValue(/في النص لوحده/);
  await expect(st).not.toContainText('قواعد الخانات الأربعة');
  // decision 15: «+ تعليمات جديدة» (was «+ قسم جديد»)
  await expect(st.getByRole('button', { name: 'قسم جديد' })).toHaveCount(0);
  await st.locator('[data-ai-addsec]').click();
  const f = modal(page).filter({ hasText: 'تعليمات جديدة — الصور' });
  await f.locator('input').first().fill('ألوان الشتا');
  await f.getByRole('button', { name: 'ضيف التعليمات' }).click();
  await st.locator('#ais-p').fill('ألوان دافية بني وكريمي، إضاءة شتوية');
  await st.locator('#ais-p').blur();
  await st.getByRole('button', { name: 'احفظ التعليمات' }).click();
  await expect.poll(() => { const r = mock.settings.find((x) => x.section === 'ai_rules'); const img = r && r.data && r.data.sections ? r.data.sections.img : [];
    return { six: r && r.data ? (r.data.slots || []).length : 0, tpl: img.filter((x) => x.custom).map((x) => [x.name, x.prompt]) }; })
    .toEqual({ six: 6, tpl: [['ألوان الشتا', 'ألوان دافية بني وكريمي، إضاءة شتوية']] });
  const id = mock.settings.find((x) => x.section === 'ai_rules').data.sections.img.find((x) => x.custom).id;
  // the owner 15 Nov («ضفت … بجرب بس مظهرتش في قوالب التعليمات وأنا بعمل كامبين»): no reload of the page — saving the instructions reads
  // the public templates again, and a campaign reads them when it opens (here: one added from another device after the save)
  const rules = mock.settings.find((x) => x.section === 'ai_rules').data;
  rules.sections.img.push({ id: 'other1', name: 'بجرب', prompt: 'إضاءة طبيعية', custom: true });
  // decision 14: the campaign's «تعليمات» = the templates (one picked — 15 Nov) + its own words
  await go(page, '#marketing-create');
  const mk = page.locator('#pg-marketing');
  await mk.locator('[data-mk-start]').click();
  await mk.locator('#cw-idea').fill('كولكشن الشتا — مخدات مشغولة');
  await expect(mk.locator('[data-cw-tpl="post"]')).toBeVisible();
  // the owner 15 Nov: «غير محدد» first (and picked while nothing is), then the images' new templates — the images' «البوست» is applied
  // to every post already
  await expect(mk.locator('#cw-tpl-post')).toContainText('غير محدد');
  // the owner 15 Nov: one template only — a plain dropdown, the pick closes it, no «تم» / «مسح»
  await mk.locator('#cw-tpl-post').click();
  const menu = page.locator('[role=listbox]').last();
  expect(await menu.locator('[role=option]').allTextContents()).toEqual(['غير محدد', 'ألوان الشتا', 'بجرب']);
  await expect(menu.locator('[role=checkbox], input[type=checkbox]')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /^(تم|مسح)$/ })).toHaveCount(0);
  await menu.getByRole('option', { name: 'بجرب' }).click();
  await expect(menu).toBeHidden();
  await expect(mk.locator('#cw-tpl-post')).toContainText('بجرب');
  await mk.locator('#cw-tpl-post').click();
  await page.locator('[role=listbox]').last().getByRole('option', { name: 'ألوان الشتا' }).click(); // a second pick replaces the first
  await expect(mk.locator('#cw-tpl-post')).toContainText('ألوان الشتا');
  await expect(mk.locator('#cw-tpl-post')).not.toContainText('بجرب');
  await mk.locator('#cw-notes-post').fill('من غير ناس');
  // the video: «غير محدد» and the videos' templates — its «البوست» too (nothing applies it to a video by itself)
  await mk.locator('.subtab', { hasText: 'فيديو' }).click();
  await expect(mk.locator('#cw-tpl-video')).toContainText('غير محدد');
  await mk.locator('#cw-tpl-video').click();
  expect(await page.locator('[role=listbox]').last().locator('[role=option]').count()).toBe(2); // «غير محدد» + the videos' «البوست»
  await page.keyboard.press('Escape');
  await mk.locator('.subtab', { hasText: 'بوستات' }).click();
  await mk.locator('.cp-next').click();
  await expect.poll(() => { const c = mock.mkt.campaigns.find((x) => x.name === 'كولكشن الشتا — مخدات مشغولة'); const m = c && c.state && c.state.w ? c.state.w.media.post : null; return m ? [m.tpl, m.notes] : null; })
    .toEqual([[id], 'من غير ناس']);
});

test('T9 — decisions 19, 21, 23–26: deposit rules, each missing item opens its form, payout days 1 and 16, the bank transfer, the transport switch, the statement preview', async ({ page }) => {
  const row = (s) => (mock.settings.find((x) => x.section === s) || {}).data || {};
  // 19: «سياسة العربون» = rules with «+ إضافة قاعدة»
  await go(page, '#settings-makers');
  const st = page.locator('#pg-settings');
  await expect(st.locator('[data-dep-rule="الأوردرات الكبيرة"]')).toBeVisible();
  await expect(st).not.toContainText('سياسة العربون الافتراضية');
  await st.locator('[data-dep-add]').click();
  let f = modal(page).filter({ hasText: 'قاعدة عربون جديدة' });
  await f.locator('input').nth(0).fill('الأوردرات الصغيرة'); await f.locator('input').nth(1).fill('3000'); await f.locator('input').nth(2).fill('20');
  await f.getByRole('button', { name: 'ضيف القاعدة' }).click();
  await expect(f).toContainText('فيه قاعدة بنفس المبلغ');
  await f.locator('input').nth(1).fill('1000');
  await f.getByRole('button', { name: 'ضيف القاعدة' }).click();
  await expect.poll(() => (row('makers').depositRules || []).map((r) => [r.name, r.over, r.pct])).toEqual([['الأوردرات الصغيرة', 1000, 20], ['الأوردرات الكبيرة', 3000, 50]]);
  expect(await page.evaluate(() => window.IBDepositRule(2000).pct)).toBe(20); // the highest «over» an order passes
  expect(await page.evaluate(() => window.IBDepositRule(5000).pct)).toBe(50);
  expect(await page.evaluate(() => window.IBDepositRule(800))).toBeNull();
  // 23–26: the payout and the statement
  await go(page, '#settings-payments');
  await expect(st.locator('[data-pay-days]')).toHaveAttribute('data-pay-days', '1,16');
  await st.locator('[data-pay-day="16"]').click(); await st.locator('[data-pay-day="10"]').click();
  await expect.poll(() => row('payments').payout && row('payments').payout.days).toEqual([1, 10]);
  await st.locator('#p-me').click();
  await expect(page.getByRole('option', { name: 'تحويل من الحساب البنكي' })).toBeVisible();
  await page.getByRole('option', { name: 'تحويل من الحساب البنكي' }).click();
  await expect.poll(() => row('payments').payout && row('payments').payout.method).toBe('تحويل من الحساب البنكي');
  const sw = st.getByRole('switch', { name: 'خصم المواصلات تلقائيًا من المستحقات' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect.poll(() => row('payments').payout && row('payments').payout.deductTransport).toBe(false);
  await st.locator('[data-stmt-preview]').click();
  const pv = modal(page).filter({ hasText: 'معاينة كشف الحساب' });
  await expect(pv.locator('[data-stmt]')).toContainText('كشف حساب المبتكر');
  await expect(pv.locator('[data-stmt-no]')).toHaveText('IBT-2026-0148');
  await expect(pv.locator('[data-stmt-brand]')).toBeVisible();
  await expect(pv.locator('[data-stmt-moves]')).toBeVisible();
  // the owner 15 Nov: «إظهار صور المنتجات» — on by default: each line's product with its picture; «لا» = the names only
  await expect(pv.locator('[data-stmt-img]')).toHaveCount(3);
  await expect(pv).toContainText('مخدة بوهيمي');
  await page.keyboard.press('Escape');
  await st.locator('#p-im').click(); await page.getByRole('option', { name: 'لا', exact: true }).click();
  await expect.poll(() => row('payments').payout && row('payments').payout.images).toBe('لا');
  await st.locator('[data-stmt-preview]').click();
  await expect(modal(page).filter({ hasText: 'معاينة كشف الحساب' }).locator('[data-stmt-img]')).toHaveCount(0);
  await expect(modal(page).filter({ hasText: 'معاينة كشف الحساب' })).toContainText('مخدة بوهيمي');
  // and «إظهار سعر البيع»: on = the «المبيعات» column, «لا» = without it
  await expect(modal(page).filter({ hasText: 'معاينة كشف الحساب' }).locator('[data-stmt-sales]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await st.locator('#p-sl').click(); await page.getByRole('option', { name: 'لا', exact: true }).click();
  await expect.poll(() => row('payments').payout && row('payments').payout.sales).toBe('لا');
  await st.locator('[data-stmt-preview]').click();
  await expect(modal(page).filter({ hasText: 'معاينة كشف الحساب' }).locator('[data-stmt-sales]')).toHaveCount(0);
  await expect(modal(page).filter({ hasText: 'معاينة كشف الحساب' })).not.toContainText('المبيعات');
  await page.keyboard.press('Escape');
  // 21: the maker drawer lists each missing item, a click opens where it is filled
  await page.evaluate(() => { location.hash = 'makers/a0000000-0000-4000-8000-000000000001'; });
  const dr = page.locator('.drawer[aria-label^="ملف المبتكر"]');
  await expect(dr.locator('[data-missing]')).toBeVisible();
  await dr.locator('[data-missing-item="بيانات الدخول"]').click();
  await expect(modal(page).filter({ hasText: 'بيانات الدخول —' })).toBeVisible();
});

test('T10 — decisions 5, 7, 9: «مطلوبة مني» / «طلباتي» with an overview, a custom time\'s own work days, the 12-hour clock', async ({ page }) => {
  // 9: the kit's 12-hour clock (the stored value stays HH:MM)
  expect(await page.evaluate(() => [window.IBKit.t12('09:00'), window.IBKit.t12('17:30'), window.IBKit.t12('00:15'), window.IBKit.t12('12:00'), window.IBKit.t12(540), window.IBKit.t12(''), window.IBKit.t12('بكرة')]))
    .toEqual(['9:00 ص', '5:30 م', '12:15 ص', '12:00 م', '9:00 ص', '—', 'بكرة']);
  // 7: «وقت عمل مخصص» for a member with its own days; the hour lists read on the 12-hour clock
  await go(page, '#settings-hr');
  const st = page.locator('#pg-settings');
  await st.locator('[data-hs-sched-add]').click();
  const f = modal(page).filter({ hasText: 'وقت عمل مخصص' });
  await f.getByRole('radio', { name: 'موظف' }).click();
  await f.locator('#hs-s-member').click();
  const opt = page.getByRole('option').filter({ hasText: '—' }).nth(1); const who = (await opt.textContent()).split(' — ')[0].trim(); await opt.click();
  await f.locator('#hs-s-from').click(); await expect(page.getByRole('option', { name: '9:00 ص', exact: true })).toBeVisible(); await page.getByRole('option', { name: '12:00 م', exact: true }).click();
  await f.locator('#hs-s-to').click(); await page.getByRole('option', { name: '8:00 م', exact: true }).click();
  await expect(f.locator('[data-hs-s-days]')).toContainText('من غير اختيار = أيام الشغل الرسمية');
  await f.locator('[data-hs-s-day="5"]').click(); await f.locator('[data-hs-s-day="6"]').click();
  await expect(f.locator('[data-hs-s-days]')).toContainText('بيشتغل: السبت، الجمعة');
  await f.getByRole('button', { name: 'إضافة', exact: true }).click();
  const rowDays = st.locator('[data-hs-sched-days^="member:"]');
  await expect(rowDays).toHaveText('السبت، الجمعة');
  await expect(st.locator('tr', { has: page.locator('[data-hs-sched-days^="member:"]') })).toContainText('12:00 م');
  await st.locator('[data-set-save]').click();
  await expect.poll(() => { const r = mock.settings.find((x) => x.section === 'hr'); const m = r && r.data && r.data.schedules ? Object.values(r.data.schedules.member || {}) : []; return m.map((x) => [x.from, x.to, x.days]); })
    .toEqual([['12:00', '20:00', [5, 6]]]);
  const uid = Object.keys(mock.settings.find((x) => x.section === 'hr').data.schedules.member)[0];
  await expect.poll(() => page.evaluate((u) => window.IBHR.workDaysOf(u), uid)).toEqual([5, 6]);
  expect(await page.evaluate((u) => [window.IBHR.isWorkDay('2026-11-06', u), window.IBHR.isWorkDay('2026-11-08', u), window.IBHR.isWorkDay('2026-11-08')], uid)).toEqual([true, false, true]);
  expect(who.length).toBeGreaterThan(0);
  // 5: «ملفي › طلباتي» — «مطلوبة مني» first, then «طلباتي». The owner's comments 15 Nov (2026-11-15-comments.md decisions 2, 3 and 7): the
  // «نظرة عامة» cards above the list are gone, each tab carries the number of its open requests and lists them, and «الكل» is the
  // third tab of the same row (the «المفتوحة / الكل» row under the tabs is gone)
  await go(page, '#profile-requests');
  const P = page.locator('#pg-profile');
  await expect(P.locator('#tab-forme')).toHaveAttribute('aria-selected', 'true');
  await expect(P.locator('[data-my-req-kpis]')).toHaveCount(0); await expect(P.locator('.card-title, h2, h3').filter({ hasText: /^نظرة عامة$/ })).toHaveCount(0);
  await expect(P.locator('.subtab')).toHaveCount(0);
  const cnt = async (id) => Number(await P.locator('#tab-' + id + ' .cnt').innerText());
  await expect(P.locator('[data-my-req]')).toHaveCount(await cnt('forme'));
  await P.locator('#tab-mine').click();
  await expect(P.locator('#tab-mine')).toHaveAttribute('aria-selected', 'true');
  await expect(P.locator('[data-my-req]')).toHaveCount(await cnt('mine'));
  await P.locator('#tab-all').click();
  await expect(P.locator('#tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect(P.locator('[data-my-req]')).toHaveCount(await cnt('all'));
  expect(await cnt('all')).toBeGreaterThanOrEqual(Math.max(await cnt('forme'), await cnt('mine')));
  await go(page, '#profile-requests-forme');
  await expect(P.locator('#tab-forme')).toHaveAttribute('aria-selected', 'true');
});

test('T11 — decisions 27, 28: the login lock (attempts and minutes from «الأمان», the counter on the server, the admin unlocks); the activity log is a standard table', async ({ page }) => {
  mock.settings.push({ section: 'security', data: { lockAttempts: '3', lockMinutes: '5' } });
  // the admin signs out; ops tries a wrong password three times
  await page.locator('.user-btn').click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  const card = page.locator('#login .login-card');
  await expect(page.locator('#lg-title')).toHaveText('تسجيل الدخول'); await page.waitForTimeout(500); // the sign-out settles before typing
  for (const left of [2, 1]) {
    await page.fill('#lg-id', 'ops.dev@ibtekr.local'); await page.fill('#lg-pw', 'not-the-password-1');
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
    await expect(card).toContainText('فاضل ' + left + ' محاولات');
  }
  await page.fill('#lg-id', '01000000002'); await page.fill('#lg-pw', 'not-the-password-1'); // her phone counts on the same counter
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(card.locator('[data-login-locked]')).toContainText('5 دقيقة');
  // a reload: the lock is on the server — the right password is refused until the admin unlocks
  await page.reload();
  await page.fill('#lg-id', 'ops.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(card.locator('[data-login-locked]')).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  // the admin: «الأمان» has the attempts and the minutes, and «فك القفل»
  await page.reload();
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await go(page, '#settings-security');
  const st = page.locator('#pg-settings');
  await expect(st.locator('#sp-la')).toContainText('3'); await expect(st.locator('#sp-lm')).toContainText('5');
  await expect(st.locator('[data-login-locks]')).toHaveAttribute('data-login-locks', '1');
  await st.locator('[data-login-locks] [data-login-unlock]').click();
  await expect(st.locator('[data-login-locks]')).toHaveAttribute('data-login-locks', '0');
  expect(mock.activity.some((x) => x.action === 'settings.login.unlock')).toBe(true);
  await st.locator('#sp-la').click(); await page.getByRole('option', { name: '7', exact: true }).click();
  await expect.poll(() => (mock.settings.find((x) => x.section === 'security') || {}).data.lockAttempts).toBe('7');
  // 28: the activity log has the standard head (search · filter · sort · columns) beside its own filters and period
  await go(page, '#settings-activity');
  const act = st.locator('.card', { hasText: 'سجل النشاط' }).first();
  await expect(act.locator('[data-tq-btn]')).toBeVisible();
  await expect(act.locator('#ac-from')).toBeVisible();
  await go(page, '#settings-general');
  await expect(st.locator('[data-tq-btn]')).toHaveCount(0); // the other settings tables stay plain
});
