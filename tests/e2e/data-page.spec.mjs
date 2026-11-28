import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// docs/superpowers/plans/2026-11-16-data-page.md: «القوائم والحالات» as a side menu; «البيانات» in tabs; the import by ID (a row with an ID
// edits its filled cells only through the page's own adapter, a row with no ID is new); the Excel template; «منطقة الخطر» (0117). Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const open = async (page, s) => { await page.evaluate((x) => { location.hash = 'settings-' + x; }, s); await expect(page.locator('#pg-settings .set-page')).toBeVisible(); };
const modal = (page) => page.locator('.modal').last();

test('decision 1: «القوائم والحالات» — the lists in a side menu by group with their counts; a list opens beside it', async ({ page }) => {
  await signIn(page); await open(page, 'lists');
  const nav = page.locator('[data-lists-nav]');
  // settings-lists-2 (Safwat 28 Nov): the groups by department, in the side menu's order — «القائمة الجانبية» in «شكل السيستم» (the owner 17 Nov)
  await expect(nav.locator('.lst-gt')).toHaveText(['الأوردرات', 'المبتكرين', 'المنتجات', 'المخزن', 'خدمة العملاء', 'طلبات الفريق', 'الحسابات', 'التسويق', 'شكل السيستم']);
  await expect(nav.getByRole('tab')).toHaveCount(27);
  await expect(nav.getByRole('tab', { name: /أسباب الإلغاء/ }).locator('.lst-n')).toBeVisible();
  await nav.getByRole('tab', { name: /شركات الشحن/ }).click();
  await expect(nav.getByRole('tab', { name: /شركات الشحن/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-lists="shipping"] .lst-main')).toContainText('شركات الشحن');
});

test('decisions 2, 3 and 5: «البيانات» in tabs; the template popup has the ID first and downloads an Excel file; the import edits a maker by its ID (the filled cells only) and adds a new one', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await expect(page.locator('[data-dtab]')).toHaveText(['تصدير', 'استيراد', 'القوالب', 'النسخة الكاملة', 'منطقة الخطر']);
  await page.locator('[data-dtab="import"]').click();
  await expect(page.locator('[data-dx-howto] li')).toHaveCount(3);
  await page.locator('#d-set').click(); await page.getByRole('option', { name: 'المبتكرين والنسب' }).click();
  // the template
  await page.locator('[data-tpl-open="vendors"]').click();
  const tpl = modal(page);
  await expect(tpl.locator('[data-tpl-kind]')).toHaveCount(2);
  await expect(tpl.locator('table.dx-cols tbody tr').first()).toContainText('ID');
  const [dl] = await Promise.all([page.waitForEvent('download'), tpl.locator('[data-tpl-go]').click()]);
  expect(dl.suggestedFilename()).toMatch(/^ibtekr-vendors-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await tpl.locator('.btn-text', { hasText: 'إغلاق' }).click();
  // a file: the first maker by its ID with a new lead time (its name cell empty = kept), and a new maker
  const info = await page.evaluate(() => { const g = window.IBData.group('vendors'); const r = g.rows()[0]; const cat = g.fields().find((f) => f.key === 'category').options[0]; return { id: r._id, name: r.name, lead: r.leadDays, cat }; });
  const lead = Number(info.lead || 0) + 3;
  const text = ['ID (ماتغيّروش)\tاسم المبتكر\tالفئة الأساسية\tالحالة\tالموبايل (واتساب)\tنسبة إبتكر %\tمدة التجهيز (يوم)', info.id + '\t\t\t\t\t\t' + lead, '\tورشة الاستيراد\t' + info.cat + '\tنشط\t01011112222\t30\t9'].join('\n');
  await page.locator('[data-import]').click();
  const wz = modal(page);
  await wz.locator('.dx-paste summary').click(); await wz.locator('#imp-paste').fill(text);
  await wz.getByRole('button', { name: 'التالي', exact: true }).click();
  await wz.getByRole('button', { name: 'التالي: المراجعة' }).click();
  await expect(wz.locator('[data-dx-show="update"] b')).toHaveText('1');
  await expect(wz.locator('[data-dx-show="new"] b')).toHaveText('1');
  await expect(wz.locator('.dx-chg-row')).toContainText('مدة التجهيز');
  await wz.locator('[data-imp-go]').click();
  await expect(wz.locator('.dx-stat.gold b')).toHaveText('1');
  await expect(wz.locator('.dx-stat.success b')).toHaveText('1');
  await expect.poll(() => page.evaluate((id) => window.IBVendors.store.get(id).leadDays, info.id)).toBe(lead);
  expect(await page.evaluate((id) => window.IBVendors.store.get(id).name, info.id)).toBe(info.name);
  await expect.poll(() => page.evaluate(() => !!window.IBVendors.store.findByName('ورشة الاستيراد'))).toBe(true);
});

test('decision 3: an unknown ID, or a row with no ID on a sheet that only edits, is an error in the review and nothing is written', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="import"]').click();
  await page.locator('#d-set').click(); await page.getByRole('option', { name: 'بيانات المبتكرين الحساسة' }).click();
  await page.locator('[data-import]').click();
  const wz = modal(page);
  await wz.locator('.dx-paste summary').click(); await wz.locator('#imp-paste').fill('ID (ماتغيّروش)\tالبنك\nnot-a-real-id\tبنك مصر');
  await wz.getByRole('button', { name: 'التالي', exact: true }).click();
  await wz.getByRole('button', { name: 'التالي: المراجعة' }).click();
  await expect(wz.locator('[data-dx-show="error"] b')).toHaveText('1');
  await expect(wz.locator('.dx-errs')).toContainText('مش موجود');
  await expect(wz.locator('[data-imp-go]')).toBeDisabled();
});

test('decision 6: «منطقة الخطر» — pick sections, the review lists the tables, the phrase unlocks the wipe (data_wipe), then the page reloads', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="danger"]').click();
  const dz = page.locator('[data-danger-zone]');
  await expect(dz.locator('[data-wipe]')).toHaveCount(10);
  await expect(dz.locator('[data-wipe-go]')).toBeDisabled();
  await dz.locator('[data-wipe="orders"] input').check(); await dz.locator('[data-wipe="tickets"] input').check();
  await dz.locator('[data-wipe-go]').click();
  const md = modal(page);
  await expect(md.locator('.dz-tables tbody tr')).toHaveCount(2);
  const go = md.locator('[data-wipe-confirm]');
  await expect(go).toBeDisabled();
  await md.locator('#wipe-confirm').fill('امسح');
  await expect(go).toBeDisabled();
  await md.locator('#wipe-confirm').fill('امسح البيانات'); // 0133: the old phrase no longer unlocks it
  await expect(go).toBeDisabled();
  await md.locator('#wipe-confirm').fill('حذف الداتا من السيستم بشكل نهائي');
  await Promise.all([page.waitForEvent('load'), go.click()]);
  expect(mock.st.wipes).toEqual([['orders', 'tickets']]);
});

// the owner 18 Nov («ضيف زر منه اقدر امسح كل حاجة … لازم اكتب كلمة معينة … زر احذف او الغاء او صدر البيانات قبل الحذف … بوب اب يقولي اي اللي
// هيتحذف و قد اي بيانات و فيه زر ابدأ الحذف و … progress bar … البوب ده مينفعش يتقفل لحد ما يخلص»)
test('2026-11-18-data-real.md decision 4: «امسح كل حاجة» — the phrase unlocks «احذف», «إلغاء» clears it; the popup lists every section with its rows; «ابدأ الحذف» wipes section by section with a progress bar (a blocked one retried after the rest) and can\'t close until done', async ({ page }) => {
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="danger"]').click();
  const card = page.locator('[data-wipe-all-card]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-wipe-export]')).toBeVisible();
  const go = card.locator('[data-wipe-all]'); const phrase = card.locator('[data-wipe-all-phrase]');
  await expect(go).toBeDisabled();
  await phrase.fill('حذف الداتا'); await expect(go).toBeDisabled();
  await phrase.fill('حذف الداتا من السيستم بشكل نهائي'); await expect(go).toBeEnabled();
  await card.locator('[data-wipe-all-cancel]').click(); await expect(phrase).toHaveValue(''); await expect(go).toBeDisabled();
  await phrase.fill('حذف الداتا من السيستم بشكل نهائي'); await go.click();
  const md = page.locator('[data-wipe-all-modal]');
  await expect(md.locator('[data-wipe-row]')).toHaveCount(12);
  await expect(md.locator('[data-wipe-row="orders"]')).toContainText('3 صف');
  // 0134: the uploaded files and the team (every member but me and the owner, the added roles) are in it too
  await expect(md.locator('[data-wipe-row="files"]')).toContainText('4 ملف');
  await expect(md.locator('[data-wipe-row="team"]')).toContainText('دور');
  await expect(md).toContainText('30 صف');
  expect(mock.st.wipes || []).toEqual([]);
  mock.st.wipeBlockOnce = ['orders']; mock.st.wipeDelay = 250;
  await md.locator('[data-wipe-start]').click();
  await expect(md.locator('.dz-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(md).toBeVisible(); // can't close while it runs
  await expect(md.locator('[data-wipe-close]')).toBeVisible({ timeout: 15000 });
  await expect(md.locator('[data-wipe-status]')).toContainText('خلص');
  await expect(md.locator('.dz-row.ok')).toHaveCount(12);
  await expect(md.locator('.dz-bar')).toHaveAttribute('aria-valuenow', '100');
  // one section a call, in the run's order; «orders» was blocked once and came after the rest
  expect(mock.st.wipes).toEqual([['tickets'], ['cs'], ['marketing'], ['inventory'], ['accounts'], ['products'], ['vendors'], ['hr'], ['logs'], ['orders']]);
  expect([mock.st.filesWipes, mock.st.teamWipes, mock.st.wipeFiles]).toEqual([3, 1, 0]); // the files until none is left, the team once
  await expect(md.locator('[data-wipe-row="files"]')).toContainText('اتمسح 4 ملف');
  await Promise.all([page.waitForEvent('load'), md.locator('[data-wipe-close]').click()]);
});

// 2026-11-18-data-real.md decisions 1 and 2: a sheet row says «اتعمل» only when the server answered — an expense edited by its ID (the
// cells given only — its details stay) and a new one, then the same with the accounts down: the row is refused, not «done»
test('2026-11-18-data-real.md decisions 1–2: the expenses sheet edits by ID and adds, awaiting the server — a refused write is counted as refused', async ({ page }) => {
  const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
  mock.acc.acc_expenses.push({ id: 950001, on_date: today, direction: 'withdraw', category: 'المصروفات', beneficiary: 'مطبعة النيل', beneficiary_other: true, amount: 400, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, details: 'ورق وكراتين', staff_kind: null, reason: null, created_by: '00000000-0000-4000-8000-000000000001', created_at: '2026-11-01T08:00:00Z', voided_at: null });
  await signIn(page); await open(page, 'data');
  await page.locator('[data-dtab="import"]').click();
  await page.locator('#d-set').click(); await page.getByRole('option', { name: 'الحسابات (المصروفات)' }).click();
  const run = async (text) => {
    await page.locator('[data-import]').click(); const wz = modal(page);
    await wz.locator('.dx-paste summary').click(); await wz.locator('#imp-paste').fill(text);
    await wz.getByRole('button', { name: 'التالي', exact: true }).click();
    await wz.getByRole('button', { name: 'التالي: المراجعة' }).click();
    await wz.locator('[data-imp-go]').click(); await expect(wz.locator('.dx-stat.error')).toBeVisible(); return wz;
  };
  const head = 'ID (ماتغيّروش)\tالتاريخ\tالمبلغ (ج.م)\tالنوع';
  const wz = await run([head, '950001\t\t650\t', '\t' + today + '\t250\tالمصروفات'].join('\n'));
  await expect(wz.locator('.dx-stat.gold b')).toHaveText('1'); await expect(wz.locator('.dx-stat.success b')).toHaveText('1'); await expect(wz.locator('.dx-stat.error b')).toHaveText('0');
  const ed = mock.acc.acc_expenses.find((x) => x.id === 950001);
  expect([ed.amount, ed.details, ed.beneficiary]).toEqual([650, 'ورق وكراتين', 'مطبعة النيل']); // the cells given only — the rest stays
  await expect.poll(() => mock.accWrites.filter((w) => w.table === 'acc_expenses' && w.op === 'insert').map((w) => Number(w.amount))).toEqual([250]);
  await wz.locator('.btn-text', { hasText: 'إغلاق' }).click();
  mock.accountsDown = true;
  const wz2 = await run([head, '\t' + today + '\t90\tالمصروفات'].join('\n'));
  await expect(wz2.locator('.dx-stat.error b')).toHaveText('1');
  await expect(wz2.locator('.dx-stat.success b')).toHaveText('0');
  mock.accountsDown = false;
});
