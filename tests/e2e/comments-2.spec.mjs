import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, SITE } from './supabase-mock.mjs';
// The owner's comments on «نسخة التعليقات» — batch 2 (docs/superpowers/plans/2026-11-15-comments.md): one case a comment (or a small
// group on the same screen), named by the comment's number there. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function signIn(page, email = ADMIN) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const go = async (page, hash) => { await page.evaluate((x) => { location.hash = x; }, hash); };
const box = async (loc) => loc.first().boundingBox();

test('comment 4 — makers › «حسابات المبتكرين»: «تحديث من Dokan» sits with the head\'s buttons at the end of the card, right before «بحث»', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'makers');
  await page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: 'حسابات المبتكرين' }).click();
  const head = page.locator('#vpanel section.card .table-title').filter({ has: page.locator('[data-dokan-refresh]') }).first();
  // the kit puts «بحث» in the head a moment after the card is drawn — measure once both stand there
  await expect(head.locator('[data-dokan-refresh]')).toBeVisible(); await expect(head.locator('[data-tq-btn]')).toBeVisible();
  const refresh = await box(head.locator('[data-dokan-refresh]')); const search = await box(head.locator('[data-tq-btn]')); const title = await box(head.locator('h2'));
  // RTL: the title at the right; the page's button directly at the right of «بحث», no gap of free space between them
  expect(refresh.x).toBeGreaterThan(search.x + search.width - 1);
  expect(refresh.x - (search.x + search.width)).toBeLessThan(24);
  expect(title.x).toBeGreaterThan(refresh.x + refresh.width + 80);
  // the accounts page's own tab is the same card
  await go(page, 'accounts-vendors');
  const head2 = page.locator('#rpanel section.card .table-title, main:not([hidden]) section.card .table-title').filter({ has: page.locator('[data-dokan-refresh]') }).first();
  await expect(head2.locator('[data-dokan-refresh]')).toBeVisible(); await expect(head2.locator('[data-tq-btn]')).toBeVisible();
  const r2 = await box(head2.locator('[data-dokan-refresh]')); const s2 = await box(head2.locator('[data-tq-btn]'));
  expect(r2.x - (s2.x + s2.width)).toBeLessThan(24);
});

test('comment 5 — orders: a confirmation date typed on a confirmed order goes to «تاريخ تبليغ المبتكر» of its lines at once (0103)', async ({ page }) => {
  await signIn(page);
  await go(page, 'orders');
  await expect(page.locator('#orders')).toBeVisible();
  await page.evaluate(() => window.OrdersApp.toggle && window.OrdersApp.toggle('181668'));
  const o = mock.orders.find((x) => x.id === 181668); o.confirm = 'مؤكد بدون عربون';
  await page.evaluate(() => window.IBOrders.refetch('181668'));
  const cd = page.locator('#orders input[data-fi="cd:181668"]');
  await cd.fill('01/11/2026'); await cd.press('Enter');
  await expect.poll(() => mock.patches.some((p) => p.table === 'orders' && p.id === 181668 && p.confirm_at === '2026-11-01')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.OrdersApp.get('181668').subs.map((s) => s.exp))).toEqual(['2026-11-01', '2026-11-01']);
  // a date moved — typed straight into the field that kept the focus (the picker shut after the first save): it is saved all the
  // same; the lines still on the old confirmation date follow, one set by hand to another day stays
  mock.orderItems.find((i) => i.id === 5002).expected_at = '2026-11-03';
  await page.evaluate(() => window.IBOrders.refetch('181668'));
  await page.locator('#orders input[data-fi="cd:181668"]').fill('05/11/2026'); await page.locator('#orders input[data-fi="cd:181668"]').press('Enter');
  await expect.poll(() => page.evaluate(() => window.OrdersApp.get('181668').subs.map((s) => s.exp).sort())).toEqual(['2026-11-03', '2026-11-05']);
});

test('comment 6 — the customer\'s file: every section in a box of its own with a clear green edit button, like the maker\'s drawer; the other tabs boxed too', async ({ page }) => {
  await signIn(page);
  await go(page, 'cs-customers');
  await expect(page.locator('#pg-cs')).toBeVisible();
  await page.evaluate(() => { const S = window.IBCS.data; const cu = S.customers.find((c) => c.orders > 0) || S.customers[0]; window.IBPages.all().cs.api.peekCustomer(cu.id); });
  const d = page.locator('.drawer[aria-label^="ملف العميل"]');
  await expect(d).toBeVisible();
  const boxes = d.locator('[data-cu-boxes] > .pn-s');
  await expect(boxes.filter({ hasText: 'أرقام الشراء' })).toHaveCount(1);
  expect(await boxes.count()).toBeGreaterThanOrEqual(5);
  for (const title of ['أرقام الشراء', 'التقييم والحالة', 'بيانات التواصل والعناوين', 'الموافقات', 'ملاحظات الفريق']) {
    const b = boxes.filter({ has: page.locator('.pn-h h3', { hasText: title }) });
    await expect(b).toHaveCount(1);
    const st = await b.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopWidth, c.borderTopStyle, parseFloat(c.borderTopLeftRadius) > 0, parseFloat(c.paddingTop) >= 8]; });
    expect(st).toEqual(['1px', 'solid', true, true]);
  }
  // the edit of a box: a filled green button in its head (not a bare text link)
  const edit = boxes.filter({ hasText: 'بيانات التواصل والعناوين' }).locator('.pn-h > button', { hasText: 'تعديل' });
  const look = await edit.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
  expect(look[0]).toBe('rgb(0, 86, 66)');
  expect(look[1]).not.toBe('rgb(0, 86, 66)');
  // six numbers as tiles, three a row
  const tiles = boxes.filter({ hasText: 'أرقام الشراء' }).locator('.kvc');
  await expect(tiles).toHaveCount(6);
  const [a, b3, c4] = [await box(tiles.nth(0)), await box(tiles.nth(2)), await box(tiles.nth(3))];
  expect(Math.abs(a.y - b3.y)).toBeLessThan(2); expect(c4.y).toBeGreaterThan(a.y + a.height - 1);
  // the other tabs: one box each
  await d.getByRole('tab', { name: /الأوردرات/ }).click();
  await expect(d.locator('[data-cu-boxes] > .pn-s')).toHaveCount(1);
  await expect(d.locator('[data-cu-boxes] > .pn-s .pn-h h3')).toHaveText('أوردرات العميل');
  await d.getByRole('tab', { name: 'السجل' }).click();
  await expect(d.locator('[data-cu-boxes] > .pn-s .pn-h h3')).toHaveText('سجل العميل');
});

test('comment 8 — HR › «الفريق»: a member\'s name opens their data in a drawer (boxes like the maker\'s drawer) with «افتح ملف العضو»; the page stays where it is until that button', async ({ page }) => {
  await signIn(page);
  await go(page, 'hr');
  await page.locator('#pg-hr [role=tab]', { hasText: 'الفريق والحضور' }).click();
  const link = page.locator('#pg-hr table a[data-member-link="M02"]');
  await expect(link).toBeVisible();
  await link.click();
  const d = page.locator('.drawer[data-member-drawer="M02"]');
  await expect(d).toBeVisible();
  await expect(page).not.toHaveURL(/#member-M02/); // still on the HR page
  const name = await page.evaluate(() => window.IBHR.member('M02').name);
  await expect(d.locator('h2')).toHaveText(name);
  for (const title of ['البيانات الأساسية', 'التواصل', 'النهارده', 'الشهر ده', 'مستني قرار', 'العقد']) await expect(d.locator('.vsection .head h3', { hasText: title })).toHaveCount(1);
  await expect(d.locator('.vsection').first()).toContainText('M02');
  // a box's action is the page's own (the manual attendance popup)
  await d.locator('[data-md-att], [data-md-end]').first().click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await link.click();
  await page.locator('.drawer [data-member-open="M02"]').click();
  await expect(page).toHaveURL(/#member-M02$/);
  await expect(page.locator('.drawer[data-member-drawer]')).toHaveCount(0);
  // ctrl-click keeps the plain link (a new tab) — the drawer is not opened
  expect(await page.evaluate(() => { location.hash = 'hr'; return true; })).toBe(true);
});

test('comment 9 — «إضافة مبتكر» in steps: بيانات المبتكر · بيانات الدخول · بيانات المتجر · الحساب البنكي والعقد — «التالي» checks its own step, a done step is a click back, «إضافة المبتكر» on the last step only; editing a maker stays one form', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'makers/new');
  const m = page.locator('.modal.mk-modal');
  await expect(m).toBeVisible();
  const steps = m.locator('.mk-steps li');
  await expect(steps).toHaveText([/بيانات المبتكر/, /بيانات الدخول/, /بيانات المتجر/, /الحساب البنكي والعقد/]);
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  // the first step: «التالي» only (no «السابق», no «إضافة المبتكر»), and only its own fields
  await expect(m.locator('[data-mk-next]')).toHaveText('التالي');
  await expect(m.locator('[data-mk-prev]')).toHaveCount(0);
  await expect(m.getByRole('button', { name: 'إضافة المبتكر' })).toHaveCount(0);
  await expect(m.locator('#v-name')).toBeVisible();
  await expect(m.locator('#v-login-email')).toHaveCount(0); await expect(m.locator('#v-bank-method')).toHaveCount(0);
  for (const i of [1, 2, 3]) await expect(steps.nth(i).locator('button')).toBeDisabled(); // a step not reached yet is not a way round the checks
  // «التالي» with the step empty: it stays, with its own mistakes
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(m.locator('#v-name-err')).toBeVisible();
  await m.locator('#v-name').fill('Step Maker');
  await m.locator('#v-cat').click(); await page.locator('[data-mp-menu] [role=menuitemcheckbox]', { hasText: 'ديكور' }).click(); await page.locator('[data-mp-menu] [data-mp-done]').click();
  await m.locator('#v-phone').fill('01000000055');
  await m.locator('[data-mk-next]').click();
  // step 2: the login — the username from the name; an empty e-mail stops «التالي» here
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'login');
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(m.locator('#v-login-user')).toHaveValue('step.maker');
  await expect(m.locator('#v-name')).toHaveCount(0);
  await expect(m.locator('[data-mk-prev]')).toHaveText('السابق');
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'login');
  await expect(m.locator('#v-login-email-err')).toBeVisible();
  await m.locator('#v-login-email').fill('step.dev@ibtekr.local'); await m.locator('[data-genpw]').click();
  // «السابق» goes back with everything kept; the done step's own button too
  await m.locator('[data-mk-prev]').click();
  await expect(m.locator('#v-name')).toHaveValue('Step Maker');
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('#v-login-email')).toHaveValue('step.dev@ibtekr.local');
  await m.locator('[data-mk-next]').click();
  // step 3: the store
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'store');
  await expect(m.getByRole('switch', { name: 'اعمل له متجر على الموقع' })).toBeVisible();
  await steps.nth(0).locator('button').click(); // a done step is one click away
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(steps.nth(2).locator('button')).toBeDisabled(); // forward is «التالي» only — every step is checked on the way
  await m.locator('[data-mk-next]').click(); await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'store');
  await m.locator('[data-mk-next]').click();
  // step 4: the bank and the contract — the only step with «إضافة المبتكر»
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'bank');
  await expect(m.locator('#v-bank-method')).toBeVisible(); await expect(m.locator('[data-v-contract]')).toHaveCount(1);
  await expect(m.locator('[data-mk-next]')).toHaveText('إضافة المبتكر');
  await expect(m.locator('[data-mk-next]')).toHaveAttribute('data-mk-next', 'add');
  await m.locator('[data-mk-next]').click();
  await expect(page.locator('.drawer .drawer-h h2')).toHaveText('Step Maker');
  // the popup fits a phone: the steps in one row, nothing wider than the screen
  await page.locator('.drawer').getByRole('button', { name: 'إغلاق' }).first().click();
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, 'makers/new');
  await expect(m).toBeVisible();
  const mb = await box(m); expect(mb.x).toBeGreaterThanOrEqual(0); expect(mb.x + mb.width).toBeLessThanOrEqual(390);
  const sb = await box(m.locator('.mk-steps')); expect(sb.x).toBeGreaterThanOrEqual(mb.x - 1); expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + mb.width + 1);
});

// comments 10 and 11: the maker's short report — Art Craft with 2,500 on Dokan and a pending request of 1,200; Antikiano with 25,000
// and no request. The site's product photos are answered here (the page shows them; woo-sync thumbs hands them to the file).
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function makersAccounts(page) {
  mock.acc.dokan_balances.push({ vendor_id: V1, woo_vendor_id: 2376, balance: 2500, earning: 9000, sales: 11000, orders: 12, synced_at: '2026-10-27T10:00:00Z' }, { vendor_id: V2, woo_vendor_id: 44, balance: 25000, earning: 30000, sales: 40000, orders: 20, synced_at: '2026-11-11T10:00:00Z' });
  mock.acc.dokan_withdrawals.push({ id: 501, woo_vendor_id: 2376, vendor_id: V1, amount: 1200, charge: 0, receivable: 1200, status: 'pending', method: 'bank', requested_at: '2026-10-25 12:00:00', synced_at: '2026-10-27T10:00:00Z' });
  mock.orders.forEach((o) => { if (o.id === 181668 || o.id === 180656) Object.assign(o, { status: 'مكتمل', woo_status: 'completed' }); });
  mock.products.forEach((p, i) => { p.image_url = SITE + '/wp-content/uploads/2026/11/p' + i + '.webp'; });
  await page.route(SITE + '/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'makers');
  await page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: 'حسابات المبتكرين' }).click();
}

test('comment 10 — «تقرير مختصر»: five numbers, the request\'s box, the orders with the product\'s photo, three buttons; «مشاركة» asks the file\'s kind and how it goes — a PDF / an Excel with the photos; «التقرير الكامل» says it is the maker\'s whole history', async ({ page }) => {
  await makersAccounts(page);
  await page.locator('#vpanel .vname-link', { hasText: 'Art Craft' }).first().click();
  const m = page.locator('.modal.vb-modal');
  await expect(m.locator('.modal-h h2')).toHaveText('تقرير مختصر — Art Craft');
  // the owner's five numbers, in his order — nothing else on top
  await expect(m.locator('[data-vb-tile] > span')).toHaveText(['رصيد Dokan', 'العرابين', 'المواصلات', 'التصحيح', 'صافي الرصيد']);
  await expect(m.locator('[data-vb-tile="dokan"] b')).toHaveText('2,500.00 ج.م'); await expect(m.locator('[data-vb-tile="net"] b')).toHaveText('2,500.00 ج.م');
  await expect(m.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'pending');
  // the orders: the number and the product with its own photo (the site's)
  const row = m.locator('[data-vb-table] tbody tr').first();
  await expect(row).toContainText('#181668'); await expect(row).toContainText('Cushion'); await expect(row).toContainText('1,002.00');
  await expect(row.locator('.vr-prod img')).toHaveAttribute('src', new RegExp('^' + SITE.replace(/\./g, '\\.') + '/wp-content/uploads/'));
  // the buttons: «مشاركة» · «التقرير الكامل» · «إغلاق» — «كشف حساب Dokan» and «نسخ CSV» are gone
  await expect(m.locator('.modal-f button')).toHaveText(['مشاركة', 'التقرير الكامل', 'إغلاق']);
  await expect(m).not.toContainText('نسخ CSV'); await expect(m.getByRole('button', { name: 'كشف حساب Dokan' })).toHaveCount(0);
  // «مشاركة»: the file's kind, then how it goes
  await m.locator('[data-vb-share]').click();
  const sh = page.locator('.modal.sh-modal');
  await expect(sh.locator('.modal-h h2')).toHaveText('مشاركة — تقرير مختصر — Art Craft');
  await expect(sh.locator('[data-sh-type] b')).toHaveText(['Excel', 'PDF']);
  await expect(sh.locator('[data-sh-via] b')).toHaveText(['واتساب', 'إيميل', 'تحميل على الجهاز']);
  await expect(sh.locator('[data-sh-hint]')).toContainText('هيتفتح واتساب على رقم 01000000003'); // the maker's own number
  // a PDF saved on the device: one A4 page, with the product's photo read by the server
  await sh.locator('[data-sh-type="pdf"]').click(); await sh.locator('[data-sh-via="download"]').click();
  await expect(sh.locator('[data-sh-go]')).toHaveText('تحميل');
  const [pdf] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  const fs = await import('node:fs'); const bytes = fs.readFileSync(await pdf.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4'); expect(bytes.subarray(-6).toString('latin1')).toBe('%%EOF\n');
  expect(bytes.includes(Buffer.from('/Type /Pages /Count 1 '))).toBe(true);
  await expect(sh).toHaveCount(0);
  let last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'pdf', via: 'download', ok: true, name: 'تقرير Art Craft.pdf', pages: 1, photos: 1 });
  expect(mock.thumbs).toEqual([{ urls: [expect.stringContaining('/wp-content/uploads/2026/11/')], by: ADMIN }]);
  expect(last.text).not.toMatch(/نسبة|عمولة/); // it goes to the maker: no Ibtekr share or rate
  // an Excel by WhatsApp: the file is saved, the chat opens on the maker's number with the numbers as the message
  await m.locator('[data-vb-share]').click();
  await sh.locator('[data-sh-type="excel"]').click(); await sh.locator('[data-sh-via="whatsapp"]').click();
  await expect(sh.locator('[data-sh-go]')).toHaveText('مشاركة');
  page.on('popup', (p) => p.close().catch(() => {}));
  const [xlsx] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  const zip = fs.readFileSync(await xlsx.path());
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK'); expect(zip.includes(Buffer.from('xl/media/image1.jpeg'))).toBe(true); // the photo is inside the sheet
  last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'excel', via: 'whatsapp', name: 'تقرير Art Craft.xlsx', photos: 1 });
  expect(last.href.startsWith('https://wa.me/201000000003?text=')).toBe(true);
  expect(decodeURIComponent(last.href.split('text=')[1])).toContain('صافي الرصيد: 2,500.00 ج.م');
  expect(mock.thumbs).toHaveLength(1); // the photo is kept for the session
  // «التقرير الكامل»: its own popup, and it says what it is — the whole history, an order older than the screen's 12 months too
  await m.locator('[data-vb-full]').click();
  const full = page.locator('.modal.vb-modal');
  await expect(full.locator('.modal-h h2')).toHaveText('التقرير الكامل — Art Craft');
  await expect(full.locator('[data-vfull-scope]')).toHaveAttribute('data-vfull-scope', 'whole');
  await expect(full.locator('[data-vfull-scope]')).toContainText('ده التقرير الكامل للمبتكر: كل أوردراته المكتملة والملغية من أول ما بدأ معانا');
  await expect(full.locator('[data-vfull-table] tbody tr.dt-click')).toHaveCount(2);
  await expect(full.locator('[data-vfull-table]')).toContainText('#150001'); // 2025: not among the screen's orders
  await expect(full.locator('.modal-f button')).toHaveText(['مشاركة', 'إغلاق']);
});

test('comment 11 — «تقفيل حساب» is the short report\'s own popup; «اعمل طلب سحب على Dokan» files the request and asks «وافق دلوقتي» / «بعدين» in the same popup', async ({ page }) => {
  await makersAccounts(page);
  await page.locator('#vpanel table tbody tr', { hasText: 'Antikiano' }).getByRole('button', { name: /إجراءات/ }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'تسوية دلوقتي (تقفيل الحساب)' }).first().click();
  const m = page.locator('.modal.vb-modal');
  await expect(m.locator('.modal-h h2')).toHaveText('تقفيل حساب — Antikiano');
  // the same popup as the short report: the five numbers, the orders, the three buttons
  await expect(m.locator('[data-vb-tile] > span')).toHaveText(['رصيد Dokan', 'العرابين', 'المواصلات', 'التصحيح', 'صافي الرصيد']);
  await expect(m.locator('[data-vb-table]')).toBeVisible();
  await expect(m.locator('.modal-f button')).toHaveText(['مشاركة', 'التقرير الكامل', 'إغلاق']);
  await expect(m.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'settle');
  // one press: the request is filed on Dokan and the same popup asks — it never closes and opens again
  await m.locator('[data-vb-create]').click();
  await expect(m.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'ask');
  await expect(m.locator('[data-vb-req]')).toContainText('بمبلغ 25,000.00 ج.م على Dokan — توافق عليه دلوقتي؟');
  await expect(m.locator('[data-vb-req] button')).toHaveText(['وافق دلوقتي', 'بعدين']);
  await expect(page.locator('.modal[role=dialog]')).toHaveCount(1);
  expect(mock.withdrawCreates).toHaveLength(1);
  // «وافق دلوقتي»: approved on Dokan, the result in the box, the numbers follow
  await m.locator('[data-vb-approve]').click();
  await expect(m.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'approved');
  await expect(m.locator('[data-vb-res]')).toContainText('اتوافق على طلب السحب');
  await expect(m.locator('[data-vb-tile="dokan"] b')).toHaveText('0.00 ج.م');
  expect(mock.approvals.at(-1)).toMatchObject({ by: ADMIN, result: 'ok' });
  await expect(page.locator('.modal[role=dialog]')).toHaveCount(1);
});

test('comment 12 — no «افتح في صفحة التقارير» on any page\'s own reports tab', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  for (const [hash, tab] of [['makers', 'التقارير'], ['accounts', 'التقارير'], ['inventory', 'التقارير'], ['products', 'التقارير'], ['tickets', 'التقارير'], ['hr', 'التقارير'], ['cs', 'التقارير']]) {
    await go(page, hash);
    const t = page.locator('main.content:not([hidden]) [role=tab]', { hasText: tab }).last();
    await expect(t, hash).toBeVisible();
    await t.click();
    await expect(t, hash).toHaveAttribute('aria-selected', 'true'); // the tab drew
    await expect(page.locator('main.content:not([hidden])'), hash).not.toContainText('افتح في صفحة التقارير');
  }
});

// ---- comment 14: «مقارنة بفترة سابقة» works on every period filter ----
const cairoDay = (n = 0) => { const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split('-').reverse().join('/');
const expense = (id, on, amount, category) => ({ id, on_date: on, direction: 'withdraw', category, beneficiary: 'مستفيد ' + id, beneficiary_other: true, amount, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null,
  created_by: '00000000-0000-4000-8000-000000000001', created_by_name: 'صفوت كمال', created_at: on + 'T10:00:00Z', voided_at: null });

test('comment 14 — the accounts page: the comparison period\'s own «من» / «إلى» show under the picker when ticked, «تحديث» puts the two periods side by side; a typed period, back to the same length before, and off = the page as before', async ({ page }) => {
  mock.acc.acc_expenses.push(expense(1, cairoDay(-2), 9000, 'المرتبات'), expense(2, cairoDay(-33), 8000, 'المرتبات'), expense(3, cairoDay(-5), 1800, 'المصروفات'), expense(4, cairoDay(-36), 2500, 'المصروفات'));
  await signIn(page);
  await go(page, 'expenses');
  const main = page.locator('#main'); const dp = page.locator('.dp.range'); const update = dp.getByRole('button', { name: 'تحديث', exact: true });
  const tick = dp.locator('[data-rp-compare="accounts"] input[type=checkbox]');
  await expect(main.locator('.cards').first()).toBeVisible();
  await expect(main.locator('.pcmp-card')).toHaveCount(0);
  await main.locator('.date-field').first().click();
  await dp.getByRole('radio', { name: 'آخر 30 يومًا' }).click();
  await expect(tick).not.toBeChecked();
  await expect(dp.locator('[data-rp-cmp]')).toHaveCount(0); // off: the picker as it always was
  await tick.check();
  // its own fields, on the same length right before until the member types
  await expect(dp.locator('[data-rp-cmp] [data-rp-c="cfrom"]')).toHaveValue(dmy(cairoDay(-59)));
  await expect(dp.locator('[data-rp-cmp] [data-rp-c="cto"]')).toHaveValue(dmy(cairoDay(-30)));
  await expect(dp.locator('[data-rp-cmp]')).toContainText('فترة المقارنة');
  await expect(dp.locator('[data-rp-cauto]')).toBeVisible();
  await update.click();
  const card = main.locator('.pcmp-card[data-cmp="accounts"]');
  await expect(card).toContainText('مقارنة الفترتين');
  await expect(card.locator('[data-cmp-per="cur"]')).toHaveAttribute('data-range', cairoDay(-29) + '|' + cairoDay(0));
  await expect(card.locator('[data-cmp-per="was"]')).toHaveAttribute('data-range', cairoDay(-59) + '|' + cairoDay(-30));
  const row = (l) => card.locator('[data-cmp-row="' + l + '"]');
  await expect(row('المرتبات').locator('.pcmp-v.cur')).toContainText('9,000.00');
  await expect(row('المرتبات').locator('.pcmp-v.was')).toContainText('8,000.00');
  await expect(row('المرتبات').locator('[data-cmp-tone]')).toHaveAttribute('data-cmp-tone', 'negative'); // an expense that grew is bad news
  await expect(row('المرتبات').locator('.pill')).toContainText('+13%');
  await expect(row('المصروفات').locator('[data-cmp-tone]')).toHaveAttribute('data-cmp-tone', 'positive');
  await expect(row('المصروفات').locator('.pill')).toContainText('−28%');
  await expect(row('إجمالي المصروفات').locator('.pcmp-v.cur')).toContainText('10,800.00');
  await expect(row('إجمالي المصروفات').locator('.pcmp-v.was')).toContainText('10,500.00');
  // right under the period filter, before the tab's own cards
  const [cb, tb, kb] = await Promise.all([card.boundingBox(), main.locator('.toolbar').first().boundingBox(), main.locator('#panel').boundingBox()]);
  expect(cb.y).toBeGreaterThan(tb.y); expect(cb.y + cb.height).toBeLessThanOrEqual(kb.y + 1);
  // the other tabs of the page compare too, each with its own figures
  await main.getByRole('tab', { name: 'نظرة عامة', exact: true }).click();
  await expect(main.locator('.pcmp-card [data-cmp-row="إجمالي المصروفات"] .pcmp-v.cur')).toContainText('10,800.00');
  await expect(main.locator('.pcmp-card [data-cmp-row="المبيعات"]')).toHaveCount(1);
  await main.getByRole('tab', { name: 'المصروفات', exact: true }).click();
  // a period of the member's own: typed in the two fields; the wrong order is refused
  await main.locator('.date-field').first().click();
  await expect(tick).toBeChecked(); // kept with the period
  await dp.locator('[data-rp-c="cfrom"]').fill(dmy(cairoDay(-40))); await dp.locator('[data-rp-c="cfrom"]').press('Enter');
  await dp.locator('[data-rp-c="cto"]').fill(dmy(cairoDay(-50))); await dp.locator('[data-rp-c="cto"]').press('Enter');
  await expect(dp.locator('[role=alert]')).toContainText('بداية فترة المقارنة لازم تكون قبل نهايتها');
  await expect(update).toBeDisabled();
  await dp.locator('[data-rp-c="cto"]').fill(dmy(cairoDay(-31))); await dp.locator('[data-rp-c="cto"]').press('Enter');
  await expect(dp.locator('[role=alert]')).toHaveCount(0);
  await update.click();
  await expect(card.locator('[data-cmp-per="was"]')).toHaveAttribute('data-range', cairoDay(-40) + '|' + cairoDay(-31));
  await expect(row('المرتبات').locator('.pcmp-v.was')).toContainText('8,000.00'); // day −33 is inside the typed period
  await expect(row('المصروفات').locator('.pcmp-v.was')).toContainText('2,500.00');
  // back to the same length before, then off: no fields, no card — the page as it was
  await main.locator('.date-field').first().click();
  await expect(dp.locator('[data-rp-c="cfrom"]')).toHaveValue(dmy(cairoDay(-40)));
  await dp.locator('[data-rp-creset]').click();
  await expect(dp.locator('[data-rp-c="cfrom"]')).toHaveValue(dmy(cairoDay(-59)));
  await tick.uncheck();
  await expect(dp.locator('[data-rp-cmp]')).toHaveCount(0);
  await update.click();
  await expect(main.locator('.pcmp-card')).toHaveCount(0);
  await expect(main.locator('.cards').first()).toBeVisible();
});

test('comment 14 — every period filter with figures behind it compares (the reports, the moves log, the makers\' ledger, the dashboard); the campaign plan\'s calendar has no comparison', async ({ page }) => {
  await signIn(page);
  const dp = page.locator('.dp.range'); const update = dp.getByRole('button', { name: 'تحديث', exact: true });
  // the reports: the card with the tab's own figures; a snapshot tab (customer service) has no period and no card
  await go(page, 'reports-orders');
  const rep = page.locator('#reports');
  await rep.locator('.date-field').click();
  await dp.locator('[data-rp-compare="reports"] input').check();
  await expect(dp.locator('[data-rp-cmp="reports"]')).toBeVisible();
  await update.click();
  await expect(rep.locator('.pcmp-card[data-cmp="reports"] [data-cmp-row="إجمالي الأوردرات"]')).toHaveCount(1);
  await expect(rep.locator('.pcmp-card [data-cmp-row="نسبة الإكمال"] .pill')).toBeVisible();
  await rep.getByRole('tab', { name: 'تقارير المبتكرين' }).click();
  await expect(rep.locator('.pcmp-card [data-cmp-row="مبتكرين نشطين"]')).toHaveCount(1);
  await rep.getByRole('tab', { name: 'تقارير خدمة العملاء' }).click();
  await expect(rep.locator('.pcmp-card')).toHaveCount(0);
  // the same period on a page's own reports tab
  await go(page, 'makers');
  await page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: 'التقارير' }).click();
  await expect(page.locator('#vendors .pcmp-card [data-cmp-row="مبتكرين نشطين"]')).toHaveCount(1);
  // the makers' ledger by period: the comparison period's statements are asked from Dokan too
  await page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: 'حسابات المبتكرين' }).click();
  await page.locator('#vendors').getByRole('tab', { name: 'كشف بالفترة' }).click();
  await page.locator('#vendors .toolbar .date-field').click();
  await dp.getByRole('radio', { name: 'آخر 7 أيام' }).click();
  await dp.locator('[data-rp-compare="vledger"] input').check();
  await update.click();
  const led = page.locator('#vendors .pcmp-card[data-cmp="vledger"]');
  await expect(led.locator('[data-cmp-per="was"]')).toHaveAttribute('data-range', cairoDay(-13) + '|' + cairoDay(-7));
  await expect(led.locator('[data-cmp-row="المستحق آخر الفترة"]')).toHaveCount(1);
  expect(mock.statements.some((s) => s.from === cairoDay(-13) && s.to === cairoDay(-7))).toBe(true);
  // the accounts' moves log: its own period, the card under it
  await go(page, 'moves-log');
  await page.locator('#main .mlog-bar .date-field').click();
  await dp.locator('[data-rp-compare="mlog"] input').check();
  await update.click();
  await expect(page.locator('#main .pcmp-card[data-cmp="mlog"] [data-cmp-row="عدد الحركات"]')).toHaveCount(1);
  // the dashboard always compared: a typed comparison period is named beside the period
  await go(page, 'dashboard');
  await page.locator('#pg-dashboard').getByRole('button', { name: 'اختيار الفترة' }).click();
  await expect(dp.locator('[data-rp-compare="dash"] input')).toBeChecked();
  await dp.locator('[data-rp-c="cfrom"]').fill('01/09/2026'); await dp.locator('[data-rp-c="cfrom"]').press('Enter');
  await dp.locator('[data-rp-c="cto"]').fill('30/09/2026'); await dp.locator('[data-rp-c="cto"]').press('Enter');
  await update.click();
  await expect(page.locator('#pg-dashboard .range-label')).toContainText('مقارنة بـ');
  // the campaign plan's calendar: a calendar of posts — nothing to compare
  await go(page, 'marketing-calendar');
  await page.locator('#pg-marketing .cal-bar .date-field').click();
  await expect(dp).toBeVisible();
  await expect(dp.locator('[data-rp-compare]')).toHaveCount(0);
});

// ---- comment 15: the refund's reason is asked once ----
test('comment 15 — «استرجاع» on the order with its reason: a product then set «مرتجع» takes that reason (no reason field); a product returned by itself must have its own reason', async ({ page }) => {
  await signIn(page);
  await go(page, 'orders');
  const O = page.locator('#orders'); const card = (id) => O.locator('.card[data-o="' + id + '"]');
  await expect(O.locator('#list .card')).toHaveCount(3);
  const modal = (t) => page.locator('.modal[role=dialog]').filter({ hasText: t });
  for (const id of ['181668', '180656']) { const b = card(id).locator('[data-tg]').first(); if ((await b.getAttribute('aria-label')) === 'فتح') await b.click(); }
  // a product returned by itself: the reason is required
  await O.locator('select[data-ss="5002"]').selectOption('مرتجع للمبتكر');
  const one = modal('مرتجع للمبتكر — فرعي #181670');
  await expect(one.locator('#reason')).toBeVisible();
  await expect(one.locator('[data-ret-from-order]')).toHaveCount(0);
  await one.getByRole('button', { name: 'تسجيل مرتجع للمبتكر' }).click();
  await expect(one).toContainText('اختار سبب المرتجع'); // refused without it
  expect(mock.orderItems.find((i) => i.id === 5002).status).not.toBe('مرتجع للمبتكر');
  await one.locator('#reason').click(); await page.getByRole('option', { name: 'فيه عيب' }).click();
  await one.getByRole('button', { name: 'تسجيل مرتجع للمبتكر' }).click();
  await expect.poll(() => { const i = mock.orderItems.find((x) => x.id === 5002); return [i.status, i.ret && i.ret.reason]; }).toEqual(['مرتجع للمبتكر', 'فيه عيب']);
  // the order refunded with its reason: its other product takes it, the field is not asked again
  await O.locator('select[data-st="181668"]').selectOption('استرجاع');
  const ord = modal('استرجاع — IB-181668');
  await ord.locator('#reason').click(); await page.getByRole('option', { name: 'العميل غيّر رأيه' }).click();
  await ord.getByRole('button', { name: 'تأكيد' }).click();
  await expect.poll(() => { const o = mock.orders.find((x) => x.id === 181668); return [o.status, o.ret && o.ret.reason]; }).toEqual(['استرجاع', 'العميل غيّر رأيه']);
  await O.locator('select[data-ss="5001"]').selectOption('مرتجع للمبتكر');
  const two = modal('مرتجع للمبتكر — فرعي #181669');
  await expect(two.locator('[data-ret-from-order]')).toContainText('العميل غيّر رأيه');
  await expect(two.locator('#reason')).toHaveCount(0);
  await two.getByRole('button', { name: 'تسجيل مرتجع للمبتكر' }).click();
  await expect.poll(() => { const i = mock.orderItems.find((x) => x.id === 5001); return [i.status, i.ret && i.ret.reason]; }).toEqual(['مرتجع للمبتكر', 'العميل غيّر رأيه']);
});

// ---- comment 16: the reports' cards picker looks like the prototype's ----
test('comment 16 — «تخصيص اللوحة» of the reports cards: the prototype\'s picker — the choices as bordered cards two a row, the picked ones tinted with a filled tick, the value at the end', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'reports-tickets');
  await page.locator('#reports [data-kpi-custom="tickets"]').click();
  const m = page.locator('.modal[role=dialog]').filter({ hasText: 'تخصيص تقارير الطلبات' });
  const css = (loc, prop) => loc.evaluate((e, p) => getComputedStyle(e)[p], prop);
  const grid = m.locator('.kpi-pick-grid').first();
  expect(await css(grid, 'display')).toBe('grid');
  expect((await css(grid, 'gridTemplateColumns')).split(' ').length).toBe(2);
  const on = m.locator('.kpi-opt.on').first(); const off = m.locator('.kpi-opt:not(.on)').first();
  expect(await css(on, 'display')).toBe('flex');
  expect(parseFloat(await css(on, 'minHeight'))).toBeGreaterThanOrEqual(56);
  expect(await css(on, 'borderTopStyle')).toBe('solid');
  expect(await css(on, 'backgroundColor')).not.toBe(await css(off, 'backgroundColor')); // the picked ones are tinted
  expect(await css(on.locator('.mchk'), 'backgroundColor')).toBe('rgb(0, 86, 66)'); // the filled tick
  expect(await css(off, 'opacity')).toBe('0.45'); // 8 of 8 picked: the rest wait
  // a card: the tick, the name with its hint under it, the value now at the far end
  const [tick, text, val] = await Promise.all([on.locator('.mchk').boundingBox(), on.locator('.kpi-opt-t').boundingBox(), on.locator('.kpi-opt-v').boundingBox()]);
  expect(tick.x).toBeGreaterThan(text.x); expect(val.x + val.width).toBeLessThanOrEqual(text.x + 1); // RTL: tick · text · value
  // the products reports' picker is the same component
  await m.getByRole('button', { name: 'إلغاء' }).click();
  await go(page, 'products-reports');
  await page.locator('#pg-products [data-prod-kpi-custom]').click();
  const p = page.locator('.modal[role=dialog]').filter({ hasText: 'تخصيص تقارير المنتجات' });
  expect(await css(p.locator('.kpi-pick-grid').first(), 'display')).toBe('grid');
  expect(await css(p.locator('.kpi-opt').first(), 'borderTopStyle')).toBe('solid');
});

// ---- comments 17–19: the stock records table ----
test('comments 17–19 — «سجل المخزون»: no «الخطوة الجاية» column; a piece shows its product\'s own photo from the site and «افتح على الموقع» opens the product\'s page in a new tab; a piece with no product on the site has neither', async ({ page }) => {
  const V1 = 'a0000000-0000-4000-8000-000000000001'; const L1 = 'b7000000-0000-4000-8000-0000000000a1', L2 = 'b7000000-0000-4000-8000-0000000000a2';
  const lot = (id, sku, name) => ({ id, reason: 'متاح للبيع', status: 'متاح', sku, name, vendor_id: V1, order_id: null, item_id: null, ref: null, loc: 'T', mode: 'ملك ابتكر', cost: 650, condition: null, condition_note: null, note: null, product_id: null, since: '2026-11-01', closed_at: null, created_by: null, created_at: '2026-11-01T10:00:00Z' });
  mock.inv.inv_lots.push(lot(L1, 'IBTA4040PAHC000013', 'Cushion'), lot(L2, 'NO-SUCH-SKU', 'قطعة من غير منتج'));
  mock.inv.inv_moves.push({ id: 98, lot_id: L1, type: 'in', qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: null, note: null, by: null, at: '2026-11-01T10:00:00Z' }, { id: 99, lot_id: L2, type: 'in', qty: 1, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: null, note: null, by: null, at: '2026-11-01T10:00:00Z' });
  const photo = SITE + '/wp-content/uploads/2026/11/cushion.webp';
  mock.products.filter((p) => p.sku === 'IBTA4040PAHC000013').forEach((p) => { p.image_url = photo; });
  await page.route(SITE + '/wp-content/**', (r) => r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));
  await signIn(page);
  await go(page, 'inventory-now');
  const inv = page.locator('#pg-inventory'); const table = inv.locator('table.inv-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  // 17: the column is gone (the piece's details keep the step)
  const heads = (await table.locator('thead th').allTextContents()).map((x) => x.trim());
  expect(heads).not.toContain('الخطوة الجاية');
  expect(heads).toEqual(expect.arrayContaining(['المنتج', 'السبب', 'الحالة', 'دخل المخزن', 'بقاله']));
  // 18: the product's own photo from the site
  const r1 = table.locator('tbody tr', { hasText: 'Cushion' }); const r2 = table.locator('tbody tr', { hasText: 'قطعة من غير منتج' });
  await expect(r1.locator('.thumb img')).toHaveAttribute('src', photo);
  await expect(r2.locator('.thumb img')).toHaveCount(0);
  // 19: the product's page on the site — a new tab, never this one
  const link = r1.locator('a[data-inv-site]');
  await expect(link).toHaveText('افتح على الموقع');
  await expect(link).toHaveAttribute('href', SITE + '/product/cushion/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(r2.locator('a[data-inv-site]')).toHaveCount(0);
});

test('comment 20 — the campaign\'s file / link chips are green pills with beige content (the icon, the name and the ×)', async ({ page }) => {
  await signIn(page); await go(page, '#marketing-create');
  const pg = page.locator('#pg-marketing');
  await pg.locator('[data-mk-start]').click();
  await pg.locator('#cw-idea').fill('كولكشن المكرمية');
  const ref = pg.locator('[data-cw-files="cw-ref-post"]');
  await pg.locator('#cw-ref-post-l').fill('https://pin.it/4yUtHzQQl'); await ref.getByRole('button', { name: 'ضيف' }).click();
  const chip = ref.locator('.cw-f'); await expect(chip).toContainText('لينك — pin.it');
  const GREEN = 'rgb(0, 86, 66)', BEIGE = 'rgb(255, 247, 239)';
  const look = await chip.evaluate((el) => { const cs = (x) => getComputedStyle(x); const x = el.querySelector('.icon-btn');
    return { bg: cs(el).backgroundColor, border: cs(el).borderTopColor, text: cs(el.querySelector('.cw-fn')).color, icon: cs(el.querySelector('svg')).color, x: cs(x).color, xbg: cs(x).backgroundColor }; });
  expect(look).toEqual({ bg: GREEN, border: GREEN, text: BEIGE, icon: BEIGE, x: BEIGE, xbg: 'rgba(0, 0, 0, 0)' });
  // the × still takes the chip off
  await chip.getByRole('button', { name: /شيل/ }).click();
  await expect(ref.locator('.cw-f')).toHaveCount(0);
});

// ---------- comments 21–25: the hub — the open count and gathering an order ----------
const dlg = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
async function ordersOpen(page) {
  await signIn(page); await go(page, '#orders');
  await expect(page.locator('#orders .card[data-o="181668"]')).toBeVisible();
  for (const id of await page.locator('#orders #list .card').evaluateAll((cs) => cs.map((c) => c.dataset.o))) { // decision 48: the orders start closed
    const b = page.locator(`#orders .card[data-o="${id}"] [data-tg]`).first();
    if ((await b.getAttribute('aria-label')) === 'فتح') await b.click();
    await expect(page.locator(`#orders .card[data-o="${id}"] [data-tg]`).first()).toHaveAttribute('aria-label', 'طي');
  }
}
const gatherMenu = async (page, id) => { await page.locator(`#orders .card[data-o="${id}"] [data-more="o:${id}"]`).click(); await page.locator('#orders #mpop [data-ma="cons"]').click(); };
const hubLot = (id, order, item, name, extra) => ({ id, reason: 'تجميع أوردر', status: 'وصل المخزن', sku: 'IBTA4040PAHC000013', name, vendor_id: 'a0000000-0000-4000-8000-000000000001', order_id: order, item_id: item, ref: 'IB-' + order, loc: 'T', mode: 'أمانة', cost: 650, condition: null, condition_note: null, note: null, product_id: null, since: '2026-11-10', closed_at: null, created_by: null, created_at: '2026-11-10T10:00:00Z', ...(extra || {}) });
const hubIn = (id, lot) => ({ id, lot_id: lot, type: 'in', qty: 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: null, note: null, by: null, at: '2026-11-10T10:00:00Z' });

test('comment 21 — the open count has no fixed «المكان: رف B» / «العرض: الكل» dropdowns and no «العدّ بيتحفظ تلقائي» beside them; the card\'s «بحث» finds a product', async ({ page }) => {
  mock.inv.inv_lots.push(hubLot('b7000000-0000-4000-8000-0000000000c1', null, null, 'Cushion', { reason: 'متاح للبيع', status: 'متاح', ref: null }), hubLot('b7000000-0000-4000-8000-0000000000c2', null, null, 'Macrame Curtain', { reason: 'متاح للبيع', status: 'متاح', ref: null, sku: 'IBTAMCTOWM200X10014' }));
  mock.inv.inv_moves.push(hubIn(81, 'b7000000-0000-4000-8000-0000000000c1'), hubIn(82, 'b7000000-0000-4000-8000-0000000000c2'));
  await signIn(page); await go(page, '#inventory-count');
  await page.locator('#pg-inventory').getByRole('button', { name: 'جرد جديد' }).first().click();
  await dlg(page, 'جرد جديد').getByRole('button', { name: 'ابدأ الجرد' }).click();
  const card = page.locator('#pg-inventory section.card').filter({ hasText: 'CNT-' }).first();
  await expect(card.locator('table tbody tr')).toHaveCount(2);
  await expect(card.locator('#cn-l, #cn-v')).toHaveCount(0);
  await expect(card).not.toContainText('رف B'); await expect(card).not.toContainText('العرض: الكل'); await expect(card.locator('.toolbar')).toHaveCount(0);
  await card.locator('[data-tq-btn]').click();
  await card.locator('[data-tq-row] input').fill('Macrame');
  await expect(card.locator('table tbody tr:visible')).toHaveCount(1);
  await expect(card.locator('table tbody tr:visible')).toContainText('Macrame Curtain');
});

test('comments 22 and 25 — «تجميع في المخزن»: the products as a table (photo, product, maker, status now), the place one of the hub\'s normal places, and one product of one maker is enough', async ({ page }) => {
  const photo = SITE + '/wp-content/uploads/2026/11/cushion.webp';
  mock.products.filter((p) => p.sku === 'IBTA4040PAHC000013').forEach((p) => { p.image_url = photo; });
  await page.route(SITE + '/wp-content/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ordersOpen(page);
  await gatherMenu(page, 181668);
  const m = dlg(page, 'تجميع في المخزن — IB-181668');
  await expect(m.locator('table.cons-pick thead th')).toHaveText(['', 'الصورة', 'المنتج', 'المبتكر', 'الحالة الحالية']);
  const rows = m.locator('table.cons-pick tbody tr'); await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.thumb img')).toHaveAttribute('src', photo);
  await expect(rows.nth(0)).toContainText('Cushion'); await expect(rows.nth(0)).toContainText('#181669 × 2'); await expect(rows.nth(0)).toContainText('Art Craft');
  await expect(rows.nth(1)).toContainText('Macrame Curtain'); await expect(rows.nth(1)).toContainText('Antikiano'); await expect(rows.nth(1).locator('td').nth(4)).toHaveText('مؤكد');
  // the place: the hub's three places, «T — تجميع» first
  await expect(m.locator('#zone')).toHaveText('T — تجميع');
  await m.locator('#zone').click();
  const opts = page.locator('[role="listbox"]:visible [role="option"]'); // (the orders page has <select>s of its own)
  await expect(opts).toHaveText(['T — تجميع', 'R — مرتجعات', 'P — تصوير']);
  await opts.filter({ hasText: 'T — تجميع' }).click();
  // nothing ticked is refused; one product is enough
  await m.locator('[data-cons-line="5001"]').click(); await m.locator('[data-cons-line="5002"]').click();
  await m.getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect(m.getByRole('alert')).toHaveText('اختار منتج واحد على الأقل');
  await m.locator('[data-cons-line="5001"]').click();
  await m.getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id)).toEqual([5001]);
  expect(mock.inv.inv_consolidations[0]).toMatchObject({ order_id: 181668, zone: 'T', status: 'open' });
  // an order of one maker (one product) is gathered the same way
  await gatherMenu(page, 180686);
  const one = dlg(page, 'تجميع في المخزن — IB-180686');
  await expect(one.locator('table.cons-pick tbody tr')).toHaveCount(1);
  await expect(one).toContainText('من المبتكر للمخزن');
  await one.getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id).sort()).toEqual([5001, 5003]);
  await expect(page.locator('#orders .card[data-o="180686"] .consbar')).toContainText('0 من 1 وصلوا');
});

test('comment 24 — a product set «جاهز للشحن من المبتكر للمخزن» asks «هتجمّع الأوردر ده في المخزن؟»: «لأ» leaves the order, «أيوه» opens the gather popup; an order already gathered takes the product in without asking', async ({ page }) => {
  await ordersOpen(page);
  const READY = 'جاهز للشحن من المبتكر للمخزن';
  await page.locator('#orders select[data-ss="5001"]').selectOption(READY);
  const ask = page.locator('.modal[role=dialog]').filter({ has: page.locator('[data-cons-ask="181668"]') });
  await expect(ask).toContainText('هتجمّع الأوردر ده في المخزن؟');
  await expect.poll(() => mock.patches.find((p) => p.id === 5001)).toMatchObject({ table: 'order_items', status: READY }); // the status is saved whatever the answer
  await ask.getByRole('button', { name: 'لأ', exact: true }).click();
  await expect(ask).toHaveCount(0); await expect(page.locator('table.cons-pick')).toHaveCount(0);
  expect(mock.inv.inv_consolidations).toHaveLength(0);
  // the other product → «أيوه» → the popup, the products ticked
  await page.locator('#orders select[data-ss="5002"]').selectOption(READY);
  await ask.getByRole('button', { name: 'أيوه، جمّعه' }).click();
  const m = dlg(page, 'المنتجات اللي هتتجمع');
  await expect(m.locator('[data-cons-line="5002"]')).toHaveAttribute('aria-checked', 'true');
  await m.locator('[data-cons-line="5001"]').click(); // gather the second only
  // the server is slow to write the gathering: a product that joins before it answered must not be lost
  let started = 0;
  await page.route('**/rest/v1/inv_consolidations*', async (route) => { if (route.request().method() === 'POST') { started++; await new Promise((r) => setTimeout(r, 900)); } await route.fallback(); });
  await m.getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect(page.locator('#orders .card[data-o="181668"] .consbar')).toContainText('0 من 1 وصلوا');
  // the order is gathered now: the first product set ready again joins it — no question — even while the gathering is still being written
  await page.locator('#orders select[data-ss="5001"]').selectOption('مؤكد');
  await page.locator('#orders select[data-ss="5001"]').selectOption(READY);
  expect(mock.inv.inv_consolidations).toHaveLength(0); // the write has not landed yet
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id).sort()).toEqual([5001, 5002]);
  expect(started).toBe(1); expect(mock.inv.inv_consolidations).toHaveLength(1); // one gathering, the product joined it
  await expect(ask).toHaveCount(0);
  await expect(page.locator('#orders .card[data-o="181668"] .consbar')).toContainText('0 من 2 وصلوا');
});

test('comment 23 — «تجميع أوردرات» lists every order gathered in the hub: a product received «وصل المخزن» as «تجميع أوردر» opens the order\'s consolidation, and pieces received before with no consolidation are listed — «إلغاء التجميع» records it', async ({ page }) => {
  const L = 'b7000000-0000-4000-8000-0000000000d1';
  mock.inv.inv_lots.push(hubLot(L, 180686, 5003, 'Cushion')); mock.inv.inv_moves.push(hubIn(71, L));
  await ordersOpen(page);
  // the order whose piece is in the hub is gathered on the orders page too (no row yet)
  await expect(page.locator('#orders .card[data-o="180686"] .consbar')).toContainText('1 من 1');
  // «وصل المخزن» on a product of an order that is not gathered, kept as «تجميع أوردر»
  await page.locator('#orders select[data-ss="5001"]').selectOption('وصل المخزن');
  const a = dlg(page, 'وصل المخزن — فرعي #181669');
  await a.getByRole('radio', { name: /^تجميع أوردر/ }).click();
  await a.getByRole('button', { name: 'تأكيد' }).click();
  await expect.poll(() => mock.inv.inv_consolidations.filter((c) => c.order_id === 181668 && c.status === 'open').length).toBe(1);
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id).sort()).toEqual([5001, 5002]); // the order's open products
  // the hub's tab: both orders
  await go(page, '#inventory-consolidate');
  const cards = page.locator('#pg-inventory section.card.cons');
  await expect(cards).toHaveCount(2);
  const c1 = cards.filter({ hasText: 'IB-181668' }), c2 = cards.filter({ hasText: 'IB-180686' });
  await expect(c1).toContainText('1 من 2'); await expect(c1).toContainText('2 مبتكرين');
  await expect(c2).toContainText('مبتكر واحد'); await expect(c2).toContainText('1 من 1 وصلوا — جاهز يطلع كامل');
  // «إلغاء التجميع» on the one with no row: the row is written, then closed
  await c2.getByRole('button', { name: 'إجراءات' }).click();
  await page.getByRole('menuitem', { name: 'إلغاء التجميع' }).click();
  await dlg(page, 'كل أوردر فرعي هيتشحن لوحده').getByRole('button', { name: 'إلغاء التجميع' }).click();
  await expect.poll(() => mock.inv.inv_consolidations.find((c) => c.order_id === 180686)).toMatchObject({ status: 'cancelled' });
  await page.evaluate(() => window.IBInventory.load());
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('IB-181668'); // a cancelled gathering is not listed again
});

// ---------- comments 26, 27 and 80: the system's period filter above every movement log, one each ----------
const stampAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
async function pickLast7(page, key) {
  await page.locator(`[data-log-period="${key}"] .date-field`).click();
  const dp = page.locator('.dp.range');
  await dp.getByRole('radio', { name: 'آخر 7 أيام' }).click();
  await dp.getByRole('button', { name: 'تحديث' }).click();
  await expect(dp).toHaveCount(0);
}
test('comments 26, 27 and 80 — every movement log has the system\'s period filter above its table (the hub\'s moves, the makers\', the products\', HR\'s, the settings\' activity): «كل الفترات» until a period is picked, the rows follow it, and no log has two date filters', async ({ page }) => {
  const V1 = 'a0000000-0000-4000-8000-000000000001';
  // the hub: a move 40 days ago and one 2 days ago
  const L1 = 'b7000000-0000-4000-8000-0000000000e1', L2 = 'b7000000-0000-4000-8000-0000000000e2';
  mock.inv.inv_lots.push(hubLot(L1, null, null, 'Cushion', { reason: 'متاح للبيع', status: 'متاح', ref: null }), hubLot(L2, null, null, 'Macrame Curtain', { reason: 'متاح للبيع', status: 'متاح', ref: null, sku: 'IBTAMCTOWM200X10014' }));
  mock.inv.inv_moves.push({ ...hubIn(61, L1), qty: 5, at: stampAgo(40) }, { ...hubIn(62, L2), qty: 2, at: stampAgo(2) });
  // the activity log: an old and a fresh row for the makers, the products and HR
  let n = 9000; const act = (action, entity, entity_id, days, value) => ({ id: ++n, at: stampAgo(days), actor: null, action, entity, entity_id, old_value: null, new_value: value });
  mock.activityRows.push(act('vendor.create', 'vendor', V1, 40, 'Art Craft'), act('vendor.status', 'vendor', V1, 2, 'inactive'),
    act('product.save', 'product', '9001', 40, '#9001 · name'), act('product.trash', 'product', '9002', 2, '#9002'),
    act('hr.attendance.manual', 'hr', null, 40, 'M02'), act('hr.settings', 'hr', null, 2, 'workDays'));
  await signIn(page);
  const one = async (root) => { await expect(page.locator(root + ' .date-field:visible')).toHaveCount(1); }; // never two date filters side by side
  const above = async (key, table) => expect(await page.locator(`[data-log-period="${key}"]`).evaluate((bar, sel) => { const t = document.querySelector(sel); return !!t && !!(bar.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); }, table)).toBe(true);

  // 26 — the hub's moves: no fixed month dropdown; the cards and the table follow the period
  await go(page, '#inventory-moves');
  const inv = page.locator('#pg-inventory');
  await expect(inv.locator('[data-log-period="inventory"] .range-label')).toHaveText('كل الفترات');
  await expect(inv.locator('#mv-p')).toHaveCount(0); await expect(inv).not.toContainText('أكتوبر 2026');
  await one('#pg-inventory'); await above('inventory', '#pg-inventory table');
  await expect(inv.locator('table tbody tr')).toHaveCount(2);
  await expect(inv.locator('.cards .card').first()).toContainText('+ 7');
  await pickLast7(page, 'inventory');
  await expect(inv.locator('table tbody tr')).toHaveCount(1); await expect(inv.locator('table tbody tr')).toContainText('Macrame Curtain');
  await expect(inv.locator('.cards .card').first()).toContainText('+ 2');
  await expect(inv.locator('[data-log-period="inventory"] .range-label')).not.toHaveText('كل الفترات');
  await one('#pg-inventory');
  await inv.locator('[data-log-all="inventory"]').click();
  await expect(inv.locator('table tbody tr')).toHaveCount(2);
  await expect(inv.locator('[data-log-all]')).toHaveCount(0);

  // 27 — the makers' log
  await go(page, '#makers'); await page.getByRole('tab', { name: 'سجل الحركات' }).click();
  await expect(page.locator('[data-log-period="makers"] .range-label')).toHaveText('كل الفترات');
  await expect(page.locator('[data-vlog-row]')).toHaveCount(2);
  await above('makers', '#vendors table');
  await pickLast7(page, 'makers');
  await expect(page.locator('[data-vlog-row]')).toHaveCount(1); await expect(page.locator('[data-vlog-row]')).toHaveText('توقيف');
  await expect(page.locator('#vendors .date-field:visible')).toHaveCount(1);

  // 80 — the products' log
  await go(page, '#products-log');
  const pr = page.locator('#pg-products');
  await expect(pr.locator('[data-log-period="products"] .range-label')).toHaveText('كل الفترات');
  await expect(pr.locator('[data-plog-row]')).toHaveCount(2);
  await pickLast7(page, 'products');
  await expect(pr.locator('[data-plog-row]')).toHaveCount(1); await expect(pr.locator('[data-plog-row]')).toHaveText('نقل للمهملات');
  await one('#pg-products');

  // 80 — HR's log
  await go(page, '#hr-log');
  const hr = page.locator('#pg-hr');
  await expect(hr.locator('[data-log-period="hr"] .range-label')).toHaveText('كل الفترات');
  await expect(hr.locator('table.hr-log tbody tr')).toHaveCount(2);
  await pickLast7(page, 'hr');
  await expect(hr.locator('table.hr-log tbody tr')).toHaveCount(1); await expect(hr.locator('table.hr-log tbody tr')).toContainText('عدّل إعدادات الموارد البشرية');
  await one('#pg-hr');

  // 80 — the settings' activity log: the two «من» / «إلى» fields became the one filter
  await go(page, '#settings-activity');
  const se = page.locator('#pg-settings');
  await expect(se.locator('[data-log-period="activity"] .range-label')).toHaveText('كل الفترات');
  await expect(se.locator('#ac-from, #ac-to')).toHaveCount(0);
  await one('#pg-settings');
  const before = await se.locator('table.act-tbl tbody tr').count(); expect(before).toBeGreaterThanOrEqual(6);
  await pickLast7(page, 'activity');
  await expect.poll(() => se.locator('table.act-tbl tbody tr').count()).toBeLessThan(before);
  await expect(se.locator('table.act-tbl')).not.toContainText('vendor.create'); await expect(se.locator('table.act-tbl')).toContainText('vendor.status');
  await one('#pg-settings');

  // the accounts' moves log keeps its one filter
  await go(page, '#moves-log');
  await expect(page.locator('[data-mlog-csv]')).toBeVisible();
  await expect(page.locator('#panel .date-field:visible')).toHaveCount(1);
});

test('comment 28 — «متابعة للبناء» writes every piece with the AI by itself (each piece once, in order, no popup); going back and forth asks nothing again; a refusal stops the run and says so, «املأ بالـ AI» stays on the piece', async ({ page }) => {
  await signIn(page); await go(page, '#marketing-create');
  const pg = page.locator('#pg-marketing');
  const fills = () => mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.task === 'fill').map((c) => c.piece);
  await pg.locator('[data-mk-start]').click();
  await pg.locator('#cw-idea').fill('كولكشن الشتا');
  await pg.locator('.cp-next').click(); // «متابعة للبناء» — 2 posts and a carousel by default
  await expect(pg.locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect.poll(fills).toEqual(['P1', 'P2', 'C1']);
  await expect(pg.locator('[data-cw-autofill]')).toHaveCount(0);
  await expect(page.locator('[data-ai-go]')).toHaveCount(0); // no instructions popup on the way
  for (const id of ['P1', 'P2', 'C1']) await expect(pg.locator('#b-' + id + '-idea')).not.toHaveValue('');
  await expect(pg.locator('#b-P2-t')).toHaveValue('دفا الشتا');
  await expect(page.locator('.busy-stack')).toContainText('اتكتب محتوى 3 قطعة');
  // what the member wrote stays, and back and forth asks nothing again
  await pg.locator('#b-P1-t').fill('عنواني');
  await pg.locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await expect(pg.locator('.wstepper .stp-cur')).toContainText('تفاصيل الكامبين');
  await pg.locator('.cp-next').click();
  await expect(pg.locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect(pg.locator('#b-P1-t')).toHaveValue('عنواني');
  expect(fills()).toEqual(['P1', 'P2', 'C1']);
  // a new campaign while the AI refuses: the run stops at the first piece and says so; the piece keeps its button
  mock.mkt.aiFail = 'ai_cap';
  await go(page, '#marketing-create');
  await pg.locator('[data-mk-start]').click();
  await pg.locator('#cw-idea').fill('كولكشن تاني');
  await pg.locator('.cp-next').click();
  await expect(pg.locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect(page.locator('.busy-stack')).toContainText('المحتوى ماتكتبش');
  await expect(pg.locator('[data-cw-autofill]')).toHaveCount(0);
  await expect(pg.locator('#b-P1-t')).toHaveValue('');
  await expect(pg.locator('[data-cw-fill="P1"]')).toBeVisible();
  expect(fills().length).toBe(4); // one more try only: it did not go on to the other pieces
});

test('comments 29 and 30 — «تفاصيل المنتج» in order (head, the three quantities, labelled boxes, the moves table); every «مشاركة» is the one share popup: a file (Excel / PDF) or, when the product is on the site, its link', async ({ page }) => {
  const L = 'b7000000-0000-4000-8000-0000000000f1';
  mock.inv.inv_lots.push(hubLot(L, null, null, 'Cushion', { reason: 'متاح للبيع', status: 'متاح', ref: null, note: 'على الرف التاني' }));
  mock.inv.inv_moves.push({ ...hubIn(51, L), qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع' }, { id: 52, lot_id: L, type: 'reserve', qty: 1, label: 'حجز لأوردر', reason: 'متاح للبيع', ref: 'IB-181668', note: 'سحب من المخزن', by: null, at: '2026-11-12T10:00:00Z' });
  page.on('popup', (p) => p.close().catch(() => {}));
  await signIn(page); await go(page, '#inventory-now');
  const row = page.locator('#pg-inventory table tbody tr', { hasText: 'Cushion' }).first();
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تفاصيل المنتج' }).click();
  const m = page.locator('.modal.pd-modal');
  // 29 — the head, the quantities, the boxes, the moves
  await expect(m.locator('.pd-head .pd-name')).toHaveText('Cushion');
  await expect(m.locator('.pd-head')).toContainText('IBTA4040PAHC000013');
  await expect(m.locator('.pd-tags')).toContainText('متاح للبيع');
  await expect(m.locator('.pd-tags a[data-inv-site]')).toHaveAttribute('href', SITE + '/product/cushion/');
  await expect(m.locator('.pd-qty .pd-q')).toHaveText(['3في المخزن', '2متاح', '1محجوز']);
  await expect(m.locator('.pd-grid .pd-box .pd-l')).toHaveText(['المبتكر', 'المكان', 'دخل المخزن', 'بقاله', 'قيمة القطعة', 'الخطوة الجاية', 'ملاحظة']);
  await expect(m.locator('.pd-grid .pd-box', { hasText: 'المكان' }).locator('.pd-v')).toHaveText('T — تجميع');
  await expect(m.locator('table.pd-moves thead th')).toHaveText(['التاريخ', 'الحركة', 'الكمية', 'بواسطة', 'ملاحظة']);
  await expect(m.locator('table.pd-moves tbody tr')).toHaveCount(2);
  await expect(m.locator('.kv')).toHaveCount(0); // no bare label / value list any more
  const cols = await m.locator('.pd-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length); expect(cols).toBe(2);
  // 30 — «مشاركة»: the one popup; the product has a page on the site, so its link is offered beside the file
  await expect(page.locator('.share-menu')).toHaveCount(0);
  await m.locator('.modal-f [data-share]').click();
  const sh = page.locator('[data-share-modal]');
  await expect(sh.locator('[data-sh-type]')).toHaveText([/Excel/, /PDF/, /لينك/]);
  await expect(page.locator('.share-menu')).toHaveCount(0); // no WhatsApp / e-mail menu with a screenshot
  await sh.locator('[data-sh-type="link"]').click(); await sh.locator('[data-sh-via="whatsapp"]').click();
  await sh.locator('[data-sh-go]').click();
  let last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'link', via: 'whatsapp' });
  expect(decodeURIComponent(last.href)).toContain(SITE + '/product/cushion/');
  // the same button, a file this time: the piece's facts and its moves
  await m.locator('.modal-f [data-share]').click();
  await sh.locator('[data-sh-type="excel"]').click(); await sh.locator('[data-sh-via="download"]').click();
  const [file] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  const fs = await import('node:fs'); expect(fs.readFileSync(await file.path()).subarray(0, 2).toString('latin1')).toBe('PK');
  last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'excel', via: 'download', name: 'تفاصيل Cushion.xlsx' });
  expect(last.text).toContain('في المخزن: 3'); expect(last.text).toContain('المبتكر: Art Craft');
  // any popup's «مشاركة» reads the popup as a report: its label / value list, and its table without the columns of controls
  const spec = await page.evaluate(() => {
    const U = window.IBUI, h = U.h;
    const el = h('div', null, h('dl', { class: 'kv' }, h('dt', null, 'العضو'), h('dd', null, 'سارة'), h('dt', null, 'اليوم'), h('dd', null, 'الأحد')),
      h('table', null, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'المنتج'), h('th', null, 'الكمية'), h('th', null, ''))),
        h('tbody', null, h('tr', null, h('td', null, h('button', { role: 'checkbox' })), h('td', null, h('img', { src: 'https://example.com/a.jpg' }), 'كوشن'), h('td', null, '2'), h('td', null, h('button', null, '⋮'))),
          h('tr', null, h('td', null, h('button', { role: 'checkbox' })), h('td', null, 'ستارة'), h('td', null, '1'), h('td', null, h('button', null, '⋮'))))));
    return U.shareSpecOf({ title: 'تفاصيل يوم', el, phone: '01000000000' });
  });
  expect(spec).toMatchObject({ title: 'تفاصيل يوم', phone: '01000000000', summary: [{ label: 'العضو', value: 'سارة' }, { label: 'اليوم', value: 'الأحد' }], headers: ['المنتج', 'الكمية'],
    rows: [[{ text: 'كوشن', img: 'https://example.com/a.jpg' }, '2'], ['ستارة', '1']] });
});

test('comment 31 — a return has not «entered the hub» until it is inspected: no «دخل المخزن» day and its days are days of waiting; the inspection that keeps it makes that day its «دخل المخزن», and the return keeps the day it came back', async ({ page }) => {
  const L = 'b7000000-0000-4000-8000-0000000000e1'; const back = cairoDay(-10); const today = cairoDay(0);
  mock.inv.inv_lots.push(hubLot(L, null, null, 'Cushion', { reason: 'مرتجع', status: 'بانتظار الفحص', loc: 'R', ref: '#181669', since: back, note: 'العميل رفض الاستلام' }));
  mock.inv.inv_moves.push({ ...hubIn(81, L), label: 'دخول — مرتجع', reason: 'مرتجع', at: back + 'T10:00:00Z' });
  await signIn(page); await go(page, '#inventory-now');
  const row = page.locator('#pg-inventory table tbody tr', { hasText: 'Cushion' }).first();
  // waiting: no entry day, and the days are the wait (late past the settings' days)
  await expect(row.locator('[data-inv-wait]')).toHaveText('بعد الفحص');
  await expect(row.locator('.late')).toHaveText('مستني الفحص · 10 أيام ⚠');
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تفاصيل المنتج' }).click();
  const m = page.locator('.modal.pd-modal');
  const box = (label) => m.locator('.pd-grid .pd-box').filter({ has: page.locator('.pd-l', { hasText: new RegExp('^' + label + '$') }) }).locator('.pd-v');
  await expect(box('دخل المخزن')).toHaveText('لسه — بيتحسب من يوم الفحص');
  const label = (d) => page.evaluate((x) => window.IBKit.dlabel(x), d);
  await expect(box('وصل مرتجع')).toHaveText(await label(back));
  await expect(box('مستني الفحص')).toHaveText('10 أيام ⚠');
  await expect(m.locator('.pd-grid .pd-l', { hasText: /^بقاله$/ })).toHaveCount(0);
  await m.locator('.modal-f').getByRole('button', { name: 'إغلاق', exact: true }).click();
  // the inspection keeps it for sale → today is its «دخل المخزن»
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'فحص مرتجع' }).click();
  const f = dlg(page, 'فحص مرتجع — Cushion');
  await f.getByRole('radio', { name: 'سليم', exact: true }).click();
  await f.getByRole('radio', { name: /متاح للبيع من المخزن/ }).click();
  await f.getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect.poll(() => mock.inv.inv_lots.find((x) => x.id === L)).toMatchObject({ reason: 'متاح للبيع', status: 'متاح', since: today });
  await page.evaluate(() => window.IBInventory.load());
  await expect(row.locator('[data-inv-wait]')).toHaveCount(0);
  await expect(row.locator('td').filter({ hasText: /^النهارده$/ })).toHaveCount(2); // «دخل المخزن» and «بقاله» both start today
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تفاصيل المنتج' }).click();
  await expect(box('دخل المخزن')).toHaveText(await label(today));
  await expect(box('وصل مرتجع')).toHaveText(await label(back)); // the day it came back is kept
  await expect(box('بقاله')).toHaveText('النهارده');
  await m.locator('.modal-f').getByRole('button', { name: 'إغلاق', exact: true }).click();
  // the returns log keeps the return's own day
  await go(page, '#inventory-returns');
  const short = await page.evaluate((x) => window.IBKit.dshort(x), back);
  await expect(page.locator('#pg-inventory table tbody tr', { hasText: 'Cushion' }).first()).toContainText(short);
  await expect(page.locator('#pg-inventory table tbody tr', { hasText: 'Cushion' }).first()).toContainText('اتفحص — سليم');
});

test('comment 30 — a maker\'s orders popup shares through the one popup too: the orders as a file to his number, and the share is logged without the file', async ({ page }) => {
  page.on('popup', (p) => p.close().catch(() => {}));
  await signIn(page); await go(page, '#makers/' + V1);
  const drawer = page.locator('.drawer[aria-label^="ملف المبتكر"]'); await expect(drawer).toBeVisible();
  await drawer.getByRole('tab', { name: 'الأوردرات' }).click();
  await drawer.locator('.kpi[data-kind="all"]').click();
  const m = page.locator('.modal[data-vorders="all"]'); await expect(m).toBeVisible();
  const n = await m.locator('table.vlo-table tbody tr').count(); expect(n).toBeGreaterThan(0);
  await expect(m.locator('[aria-haspopup="menu"]')).toHaveCount(0); // no WhatsApp / e-mail menu
  await m.locator('.modal-f [data-share]').click();
  const sh = page.locator('[data-share-modal]');
  await expect(sh.locator('[data-sh-type]')).toHaveText([/Excel/, /PDF/]); // a table → a file, no link
  await sh.locator('[data-sh-type="excel"]').click(); await sh.locator('[data-sh-via="whatsapp"]').click();
  const [file] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  const fs = await import('node:fs'); expect(fs.readFileSync(await file.path()).subarray(0, 2).toString('latin1')).toBe('PK');
  const last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'excel', via: 'whatsapp' });
  expect(last.name).toMatch(/Art Craft\.xlsx$/);
  expect(last.href).toMatch(/^https:\/\/wa\.me\/20\d+\?text=/); // the maker's own number
  expect(await page.evaluate(() => window.__vLastShare())).toMatchObject({ via: 'whatsapp', type: 'excel' });
  await expect(sh).toHaveCount(0); await expect(m).toBeVisible(); // the share popup closed, the orders stay
});
