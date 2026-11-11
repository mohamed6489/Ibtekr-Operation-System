import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Team tickets on real data (phase 8, docs/superpowers/plans/2026-11-05-phase-8-tickets.md): the v2 page (block 28) on IBTickets
// (0045) — the list is what tickets_select lets the member read (F all, P their role's + the ones they opened), every change goes
// through ticket_create / ticket_act (the mock applies the v2 rules like the server), the buttons follow the member's ticket roles,
// attachments go into the bucket «tickets» under the member's folder, the reports tab is in the page. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const OPS_ID = '00000000-0000-4000-8000-000000000002'; const ACC_ID = '00000000-0000-4000-8000-000000000004';
const V1 = 'a0000000-0000-4000-8000-000000000001';
const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
const SEED = {
  tickets: [
    { id: 1, type: 'customer', title: 'العميلة مستنية الأوردر', description: 'اتصلت مرتين', priority: 'high', assignee_role: 'الحسابات', order_number: '181668', order_id: 181668, customer: 'سلوى زيتوني', reason: 'تأخير في التسليم',
      follow_up: '2026-10-01', created_by: OPS_ID, created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن', created_at: at(30), last_update: at(29) },
    { id: 2, type: 'internal', title: 'الكرتون خلص', description: 'محتاجين كرتون شحن', priority: 'normal', assignee_role: 'اللوجستيك والشحن', status: 'in_progress', created_at: at(20), last_update: at(20) },
    { id: 3, type: 'vendor', title: 'المبتكر مابيردش', description: 'بقاله 3 أيام', priority: 'low', assignee_role: 'متابعة المبتكرين', vendor_id: V1, vendor: 'Art Craft', reason: 'مش بيرد', status: 'resolved',
      resolution_outcome: 'اتحلت المشكلة', resolution_note: 'رد', resolved_by_name: 'صفوت كمال', resolved_at: at(5), created_at: at(48), last_update: at(5) }],
  ticketEvents: [
    { ticket_id: 1, kind: 'event', at: at(30), actor: OPS_ID, actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'سارة أحمد أنشأ التذكرة وعيّنها لدور «الحسابات»' },
    { ticket_id: 1, kind: 'message', at: at(29.9), actor: OPS_ID, actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'اتصلت مرتين' }],
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page, email) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function openTickets(page, email = ADMIN) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="tickets"]').click();
  await expect(page.locator('#tickets')).toBeVisible();
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const drawer = (page) => page.locator('.drawer');
async function pick(page, scope, id, label) { await scope.locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }

test('«تذاكر الفريق» is open: the open tickets from the database (the resolved one behind the filter), the v2 columns', async ({ page }) => {
  await openTickets(page);
  const rows = page.locator('#tickets tbody tr[data-id]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#tickets tr[data-id="TKT-0001"]')).toContainText('العميلة مستنية الأوردر');
  await expect(page.locator('#tickets tr[data-id="TKT-0001"]')).toContainText('سلوى زيتوني');
  await expect(page.locator('#tickets tr[data-id="TKT-0003"]')).toHaveCount(0);
  await expect(page.locator('#tickets')).toContainText('الحالة: مفتوحة');
});

test('admin opens a ticket: ticket_create with the form, the drawer on the new ticket with the server\'s timeline, an activity row without the text', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('button', { name: 'فتح طلب' }).click();
  const m = modal(page, 'طلب جديد');
  await m.locator('#t-title').fill('الطابعة واقفة');
  await pick(page, m, 't-type', 'طلب خاص');
  await m.locator('#t-desc').fill('سر الوصف — محتاجين حبر');
  await pick(page, m, 't-role', 'اللوجستيك والشحن');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('الطابعة واقفة');
  await expect(drawer(page)).toContainText('أنشأ التذكرة وعيّنها لدور «اللوجستيك والشحن»');
  await expect(drawer(page)).toContainText('سر الوصف — محتاجين حبر');
  const w = mock.ticketWrites.find((x) => x.fn === 'ticket_create');
  expect([w.type, w.title, w.assigneeRole, w.priority]).toEqual(['internal', 'الطابعة واقفة', 'اللوجستيك والشحن', 'normal']);
  expect(mock.tickets.at(-1)).toMatchObject({ id: 4, created_by: ADMIN_ID, created_by_role: 'مدير النظام', status: 'open' });
  await expect.poll(() => mock.activityRows.filter((r) => r.action === 'ticket.create').map((r) => r.new_value)).toEqual(['TKT-0004 · internal · اللوجستيك والشحن']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('سر الوصف');
});

test('a customer ticket needs the order number and a reason (the v2 validation, before any call)', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('button', { name: 'فتح طلب' }).click();
  const m = modal(page, 'طلب جديد');
  await m.locator('#t-title').fill('x');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(m).toContainText('اكتب رقم الأوردر');
  await expect(m).toContainText('اختار سبب المشكلة');
  expect(mock.ticketWrites).toEqual([]);
});

test('accounts (P): only its role\'s ticket; works on it (status, reply, resolve) but cannot close it — not the opener', async ({ page }) => {
  await openTickets(page, ACCOUNTS);
  await expect(page.locator('#tickets tbody tr[data-id]')).toHaveCount(1);
  await page.locator('#tickets tr[data-id="TKT-0001"]').click();
  const d = drawer(page);
  await expect(d).toContainText('اتصلت مرتين');
  await d.getByRole('button', { name: 'جاري العمل' }).click();
  await expect(d).toContainText('غيّر الحالة من «مفتوح» إلى «جاري العمل»');
  expect(mock.tickets[0].status).toBe('in_progress');
  await d.locator('.tk-reply textarea').fill('كلمنا المبتكر');
  await d.getByRole('button', { name: 'إرسال' }).click();
  await expect(d.locator('.tk-msg', { hasText: 'كلمنا المبتكر' })).toHaveCount(1);
  await d.getByRole('button', { name: 'المزيد' }).click();
  await expect(page.getByRole('menuitem', { name: 'إغلاق نهائي' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await d.getByRole('button', { name: 'تم الحل' }).click();
  const r = modal(page, 'تم حل التذكرة؟');
  await r.getByRole('button', { name: 'تأكيد الحل' }).click();
  await expect(r).toContainText('اختار نتيجة الحل');
  await pick(page, r, 'r-out', 'اتحلت المشكلة');
  await r.getByRole('button', { name: 'تأكيد الحل' }).click();
  await expect(d).toContainText('حوّل التذكرة إلى «تم الحل» — اتحلت المشكلة');
  expect(mock.tickets[0]).toMatchObject({ status: 'resolved', resolved_by: ACC_ID });
  await expect(d.getByRole('button', { name: 'إغلاق نهائي' })).toHaveCount(0);
});

test('ops (the opener of TKT-0001, not its role): no work buttons, closes it, then reopens it with a reason', async ({ page }) => {
  await openTickets(page, OPS);
  await page.locator('#tickets tr[data-id="TKT-0001"]').click();
  const d = drawer(page);
  await expect(d).toContainText('العميلة مستنية الأوردر');
  await expect(d.getByRole('button', { name: 'جاري العمل' })).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'تم الحل' })).toHaveCount(0);
  await d.getByRole('button', { name: 'المزيد' }).click();
  await page.getByRole('menuitem', { name: 'إغلاق نهائي' }).click();
  await modal(page, 'إغلاق نهائي').getByRole('button', { name: 'إغلاق نهائي' }).click();
  await expect(d).toContainText('قفل التذكرة نهائيًا');
  await expect(d.locator('.tk-reply')).toHaveCount(0); // a closed ticket takes no reply
  await d.getByRole('button', { name: 'إعادة فتح' }).click();
  const o = modal(page, 'إعادة فتح التذكرة');
  await o.getByRole('button', { name: 'إعادة الفتح' }).click();
  await expect(o).toContainText('اكتب سبب إعادة الفتح');
  await o.locator('#o-reason').fill('العميلة لسه ما استلمتش');
  await o.getByRole('button', { name: 'إعادة الفتح' }).click();
  await expect(d).toContainText('أُعيد فتحه (×1) — السبب: العميلة لسه ما استلمتش · رجع لدور «الحسابات»');
  expect(mock.tickets[0]).toMatchObject({ status: 'open', reopen_count: 1 });
  // ops works on its own roles' ticket (اللوجستيك والشحن)
  await d.getByRole('button', { name: 'إغلاق' }).first().click();
  await page.locator('#tickets tr[data-id="TKT-0002"]').click();
  await expect(drawer(page).getByRole('button', { name: 'تم الحل' })).toBeVisible();
});

test('bulk: priority for the selected tickets, one RPC each', async ({ page }) => {
  await openTickets(page);
  await page.locator('#tickets [data-bulk-box="TKT-0001"]').click();
  await page.locator('#tickets [data-bulk-box="TKT-0002"]').click();
  await page.getByRole('button', { name: 'الأولوية' }).click();
  const m = modal(page, 'تغيير الأولوية');
  await pick(page, m, 'v', 'عاجل');
  await m.getByRole('button', { name: 'طبّق' }).click();
  await expect.poll(() => mock.ticketWrites.filter((x) => x.action === 'update').map((x) => [x.id, x.priority])).toEqual([[1, 'urgent'], [2, 'urgent']]);
});

test('the reports tab: open / overdue / average from the loaded tickets, by role', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('tab', { name: /التقارير/ }).click();
  const tiles = page.locator('#tickets .cards');
  await expect(tiles).toContainText('تذاكر مفتوحة');
  await expect(tiles.locator('.kpi', { hasText: 'تذاكر مفتوحة' })).toContainText('2');
  await expect(tiles.locator('.kpi', { hasText: 'متأخرة عن موعد المتابعة' })).toContainText('1');
  await expect(page.locator('#tickets')).toContainText('حسب المسؤول');
});

test('attachments: an image uploaded into tickets/<my uid>/, carried by the new ticket, shown in the drawer; an HTML file refused', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('button', { name: 'فتح طلب' }).click();
  const m = modal(page, 'طلب جديد');
  await m.locator('#t-title').fill('صورة الكسر');
  await pick(page, m, 't-type', 'طلب خاص');
  await m.locator('#t-desc').fill('الصورة مرفقة');
  await pick(page, m, 't-role', 'الحسابات');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await m.locator('[data-tk-file]').setInputFiles([{ name: 'break.png', mimeType: 'image/png', buffer: PNG }, { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<b>x</b>') }]);
  await expect(m.locator('.tk-file', { hasText: 'break.png' })).toBeVisible();
  await expect(m).toContainText('page.html');
  await expect(m).toContainText('أو PDF بس');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('مرفقات التذكرة');
  const w = mock.ticketWrites.find((x) => x.fn === 'ticket_create');
  expect(w.attachments.length).toBe(1);
  expect(w.attachments[0].path).toMatch(new RegExp('^' + ADMIN_ID + '/[a-z0-9]+-break\\.png$'));
  expect([...mock.ticketObjects.keys()]).toEqual([w.attachments[0].path]);
  expect(mock.tickets.at(-1).attachments[0]).toMatchObject({ type: 'image/png', name: 'break.png' });
  await expect(drawer(page).locator('img.tk-thumb')).toHaveCount(1);
});

// ---------------------------------------------------------------- T6: the links (decisions 3 + 11) and the live bell (decision 9)
const bell = (page) => page.getByRole('dialog', { name: 'الإشعارات' });

test('orders: the open-ticket chip on the order opens its tickets; «افتح تذكرة» from the order menu fills the customer ticket', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.locator('.sidebar .nav-item[data-page="orders"]').click();
  const chip = page.locator('#orders [data-tk-order="181668"]').first();
  await expect(chip).toHaveText('1 تذكرة');
  await chip.click();
  await expect(page.locator('#tickets')).toBeVisible();
  await expect(page.locator('#tickets input[type=search]')).toHaveValue('181668');
  await expect(page.locator('#tickets tbody tr[data-id]')).toHaveCount(1);
  await page.locator('.sidebar .nav-item[data-page="orders"]').click();
  await page.locator('#orders [data-more="o:180686"]').first().click();
  await page.getByRole('menuitem', { name: 'افتح تذكرة' }).click();
  const m = modal(page, 'طلب جديد');
  await expect(m.locator('#t-order')).toHaveValue('180686');
  await m.locator('#t-title').fill('العميلة عايزة تغيّر المقاس');
  await m.locator('#t-desc').fill('اتصلت النهارده');
  await pick(page, m, 't-reason', 'أخرى');
  await pick(page, m, 't-role', 'خدمة العملاء');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('العميلة عايزة تغيّر المقاس');
  expect(mock.tickets.at(-1)).toMatchObject({ type: 'customer', order_number: '180686', order_id: 180686, customer: 'هدير عميل' });
});

test('makers: «إنشاء تذكرة» from the maker drawer is a maker ticket on that maker; the drawer counts the open ones', async ({ page }) => {
  mock.tickets[2].status = 'open'; // TKT-0003 on Art Craft, open again
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'makers/' + 'a0000000-0000-4000-8000-000000000001'; });
  const vd = page.locator('.drawer');
  await expect(vd).toContainText('Art Craft');
  await vd.getByRole('tab', { name: /الأوردرات|البيانات|المعلومات/ }).first().click().catch(() => {});
  await expect(vd).toContainText('TKT-0003');
  await vd.getByRole('button', { name: 'إنشاء طلب' }).first().click(); // decision 66
  const m = modal(page, 'طلب جديد');
  await expect(m.locator('#t-vendor')).toContainText('Art Craft');
  await m.locator('#t-title').fill('الشحنة متأخرة');
  await m.locator('#t-desc').fill('بقالها أسبوع');
  await pick(page, m, 't-reason', 'تأخير تسليم');
  await pick(page, m, 't-role', 'متابعة المبتكرين');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('الشحنة متأخرة');
  expect(mock.tickets.at(-1)).toMatchObject({ type: 'vendor', vendor_id: V1, vendor: 'Art Craft', reason: 'تأخير تسليم' });
});

test('customer service: «تحويل لتذكرة» from the conversation links the customer and the conversation; the panel lists the customer\'s tickets', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.waitForFunction(() => window.IBCS && window.IBCS.state() === 'ready');
  await page.evaluate(() => { location.hash = 'cs-inbox'; });
  const P = page.locator('#pg-cs');
  await expect(P.locator('.cs-ch .who b')).toHaveText('سلوى زيتوني');
  await expect(P.locator('.cs-panel')).toContainText('التذاكر');
  await P.locator('.cs-ch').getByRole('button', { name: 'المزيد' }).click();
  await page.getByRole('menuitem', { name: 'تحويل لتذكرة' }).click();
  const m = modal(page, 'طلب جديد');
  await expect(m).toContainText('هتتربط بمحادثة خدمة العملاء مع سلوى زيتوني');
  await m.locator('#t-title').fill('سؤال عن ميعاد التسليم');
  await m.locator('#t-desc').fill('العميلة سألت على الشات');
  await pick(page, m, 't-reason', 'تأخير في التسليم');
  await pick(page, m, 't-role', 'متابعة المبتكرين');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('سؤال عن ميعاد التسليم');
  const t = mock.tickets.at(-1);
  expect([t.cs_conversation_id, t.order_number, t.customer]).toEqual([mock.cs.conversations[0].id, '181668', 'سلوى زيتوني']);
  expect(t.cs_customer_id).toBeTruthy();
  await expect(drawer(page).getByRole('button', { name: 'فتح المحادثة' })).toBeVisible();
  await drawer(page).getByRole('button', { name: 'فتح المحادثة' }).click();
  await expect(P.locator('.cs-panel')).toContainText(mock.tickets.at(-1).id === 4 ? 'TKT-0004' : 'TKT-');
});

test('the bell: a new ticket for my role and a reply by someone else reach it live; opening the ticket takes it off', async ({ page }) => {
  await openTickets(page, ACCOUNTS);
  await expect.poll(() => page.evaluate(() => window.IBTickets.state())).toBe('ready');
  expect(await page.evaluate(() => window.IBTickets.bell())).toEqual([]); // the baseline is now: the seeded history does not flood the bell
  expect(mock.prefs.filter((r) => r.key === 'tickets.seen')).toEqual([]); // and nothing is written for it at sign-in
  const now = new Date(Date.now() + 1000).toISOString();
  mock.tickets.push({ ...mock.tickets[0], id: 9, title: 'تذكرة جديدة للحسابات', created_by: OPS_ID, created_at: now, last_update: now, status: 'open', reopen_count: 0, follow_up: null, attachments: [] });
  mock.ticketEvents.push({ id: 90, ticket_id: 9, kind: 'event', at: now, actor: OPS_ID, actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'سارة أحمد أنشأ التذكرة وعيّنها لدور «الحسابات»', old_value: null, new_value: null, attachments: [] },
    { id: 91, ticket_id: 1, kind: 'message', at: now, actor: OPS_ID, actor_name: 'سارة أحمد', actor_role: 'اللوجستيك والشحن', text: 'العميلة اتصلت تاني', old_value: null, new_value: null, attachments: [] });
  await page.evaluate(() => window.IBTickets.load()); // the live ping (no Realtime socket in the mock) = one load()
  await page.locator('.notif-btn').click();
  await bell(page).locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: /^مهام$/ }) }).click();
  await expect(bell(page).locator('.ntf-item', { hasText: 'TKT-0009' })).toContainText('تذكرة جديدة لدور «الحسابات» من سارة أحمد');
  await expect(bell(page).locator('.ntf-item', { hasText: 'TKT-0001' }).first()).toContainText('رد من سارة أحمد: العميلة اتصلت تاني');
  await bell(page).locator('.ntf-item', { hasText: 'TKT-0009' }).click();
  await expect(drawer(page)).toContainText('تذكرة جديدة للحسابات');
  await expect.poll(() => page.evaluate(() => (window.IBPrefs.get('tickets.seen') || { ids: {} }).ids['9'])).toBe(90);
  await expect.poll(() => page.evaluate(() => window.IBTickets.bell().map((b) => b.id))).toEqual(['TKT-0001']);
});

test('decision 19: «رقم الأوردر» lists the matching orders as it is typed (number or customer); a pick fills the number and the customer', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.locator('.sidebar .nav-item[data-page="orders"]').click(); // the orders are loaded
  await expect(page.locator('#orders [data-more="o:180686"]').first()).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="tickets"]').click();
  await page.getByRole('button', { name: 'فتح طلب' }).click();
  const m = modal(page, 'طلب جديد');
  await m.locator('#t-order').fill('هدير');
  const opt = m.locator('[data-tk-pick="180686"]');
  await expect(opt).toContainText('هدير عميل');
  await expect(m.locator('[data-tk-pick]')).toHaveCount(1);
  await opt.click();
  await expect(m.locator('#t-order')).toHaveValue('180686');
  await expect(m.locator('[data-tk-pick]')).toHaveCount(0);
  await m.locator('#t-order').fill('1816');
  await expect(m.locator('[data-tk-pick="181668"]')).toBeVisible();
  await m.locator('#t-order').press('Enter');
  await expect(m.locator('#t-order')).toHaveValue('181668');
  await m.locator('#t-title').fill('اختيار من القايمة');
  await m.locator('#t-desc').fill('x');
  await pick(page, m, 't-reason', 'أخرى');
  await pick(page, m, 't-role', 'الحسابات');
  await m.getByRole('button', { name: 'إنشاء الطلب' }).click();
  await expect(drawer(page)).toContainText('اختيار من القايمة');
  expect(mock.ticketWrites.find((x) => x.fn === 'ticket_create')).toMatchObject({ orderId: '181668', customer: 'سلوى زيتوني' });
});
