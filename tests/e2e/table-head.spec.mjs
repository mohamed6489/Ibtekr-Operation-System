import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 13 Nov (docs/superpowers/plans/2026-11-13-table-head.md): every big table's head like «سجل المخزون» — a table outside a popup
// with 5 named columns or more gets one line under its title «‹إمتى› · N من M ‹اسم› · ‹إجمالي›» (N after the filter and the search; a
// description the page had there moves under the table), «كل الـ‹الجمع› · M ‹مفرد›» under the head while no filter chip shows, and the
// controls in one order: the page's own buttons, then «بحث» · «فلتر» · «ترتيب» · the columns icon last. A page with its own filter and no
// sort gets the kit's «ترتيب». A smaller table stays as it was. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'mounts kit tables on the mocked app');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

// a page-like card from the kit's Section: `cols` columns, six rows, a description under the title and a page button in the head;
// opts go to Section as they are (noun / when / total / count); own: a «فلتر» of the page's own (FilterMenu) and the class own-filter
const mount = (page, { cols = 5, opts = {}, own = false, popup = false } = {}) => page.evaluate(({ cols, opts, own, popup }) => {
  const K = window.IBKit;
  const h = (t, a, ...c) => { const e = document.createElement(t); Object.entries(a || {}).forEach(([k, v]) => e.setAttribute(k, v)); e.append(...c); return e; };
  const heads = ['العميل', 'الحالة', 'المدينة', 'المبلغ', 'التاريخ', 'ملاحظة'].slice(0, cols);
  const data = [['أحمد', 'مكتمل', 'القاهرة', '120', '01/11/2026', 'أ'], ['إيمان', 'ملغي', 'الجيزة', '80', '02/11/2026', 'ب'], ['سارة', 'مكتمل', 'طنطا', '60', '03/11/2026', 'ج'],
    ['منى', 'جاري التنفيذ', 'القاهرة', '40', '04/11/2026', 'د'], ['هبة', 'مكتمل', 'المنصورة', '200', '05/11/2026', 'ه'], ['علي', 'ملغي', 'أسوان', '30', '06/11/2026', 'و']];
  const t = h('table', null, h('thead', null, h('tr', null, ...heads.map((x) => h('th', null, x)))), h('tbody', null, ...data.map((r) => h('tr', null, ...r.slice(0, cols).map((x) => h('td', null, x))))));
  const pageBtn = h('button', { type: 'button', class: 'btn', 'data-page-btn': '' }, 'تحديث');
  const acts = own ? [K.FilterMenu({ id: 'own-test', label: 'فلتر تجربة', groups: [{ key: 's', label: 'الحالة', options: [['مكتمل', 'مكتمل']] }], value: {}, onApply: () => {} }), pageBtn] : [pageBtn];
  const card = K.Section('عملاء تجربة', [t], acts, Object.assign({ sub: 'وصف الجدول: كل عميل بحالته', cls: own ? 'own-filter' : '' }, opts));
  card.id = 'th-card';
  const host = h('div', { id: 'th-host', style: 'position:fixed;top:80px;left:20px;width:1000px;z-index:50;background:#fff' });
  if (popup) host.classList.add('modal');
  host.append(card); document.body.append(host);
  K.sweepColumns(host);
}, { cols, opts, own, popup });
const card = (page) => page.locator('#th-card');
const sub = (page) => card(page).locator('.sec-h [data-th-sub]');
// the head's controls in order: page / search / filter / sort / cols
const order = (page) => card(page).locator('.sec-h .acts').evaluate((a) => [...a.children].map((x) => (x.matches('[data-tq-btn]') ? 'search' : x.querySelector('[data-fm-btn]') ? 'filter' : x.querySelector('[data-sm-btn]') ? 'sort' : x.matches('[data-cols]') ? 'cols' : x.matches('[data-page-btn]') ? 'page' : '?')));
const DAY = /^اليوم \d{1,2} (يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر) \d{4}/;

test('a big table (5 named columns): the count line under the title, «كل الـ…» under the head, the description under the table, the controls in order', async ({ page }) => {
  await mount(page);
  await expect(card(page)).toHaveAttribute('data-th', '');
  await expect(sub(page)).toHaveText(new RegExp(DAY.source + ' · 6 من 6 عميل$')); // the noun from the first column («العميل»)
  // the description the page wrote under the title moved under the table, word for word
  await expect(card(page).locator('.sec-h .sub:not([data-th-sub])')).toHaveCount(0);
  await expect(card(page).locator('[data-th-note]')).toHaveText('وصف الجدول: كل عميل بحالته');
  expect(await card(page).locator('[data-th-note]').evaluate((n) => !!(n.previousElementSibling && (n.previousElementSibling.matches('table') || n.previousElementSibling.querySelector('table'))))).toBe(true);
  // «كل العملاء · 6 عميل» right above the table
  await expect(card(page).locator('[data-th-all]')).toHaveText('كل العملاء · 6 عميل');
  // the page's button first, then «بحث» · «فلتر» · «ترتيب» · the columns icon
  await expect.poll(() => order(page)).toEqual(['page', 'search', 'filter', 'sort', 'cols']);
  await expect(card(page).locator('[data-sm-btn]')).toContainText('ترتيب');
});

test('the count follows the filter and the search; the chips replace «كل الـ…» while a filter is on', async ({ page }) => {
  await mount(page);
  await card(page).locator('[data-fm-btn]').click();
  await page.locator('[data-fm-menu] [data-fm-tab="الحالة"]').click();
  await page.locator('[data-fm-menu] [data-fm="الحالة:مكتمل"]').click();
  await page.locator('[data-fm-menu] [data-fm-apply]').click();
  await expect(sub(page)).toHaveText(new RegExp(DAY.source + ' · 3 من 6 عميل$'));
  await expect(card(page).locator('[data-th-all]')).toHaveCount(0); // the chips row says it
  await expect(card(page).locator('.af-row [data-af-chip]')).toHaveCount(1);
  // the search looks inside what the filter left
  await card(page).locator('[data-tq-btn]').click();
  await card(page).locator('[data-tq-row] input').fill('القاهره');
  await expect(sub(page)).toHaveText(new RegExp(DAY.source + ' · 1 من 6 عميل$'));
  // «مسح الكل» and «إغلاق»: every row back, «كل الـ…» back
  await card(page).locator('[data-af-clear]').click();
  await card(page).locator('[data-tq-close]').click();
  await expect(sub(page)).toHaveText(new RegExp(DAY.source + ' · 6 من 6 عميل$'));
  await expect(card(page).locator('[data-th-all]')).toHaveText('كل العملاء · 6 عميل');
});

test('the page\'s hints: the noun, the period, a total and its own counts', async ({ page }) => {
  await mount(page, { opts: { noun: ['صنف', 'الأصناف'], when: 'نوفمبر 2026', total: '18 قطعة في المخزن', count: [2, 18] } });
  await expect(sub(page)).toHaveText('نوفمبر 2026 · 2 من 18 صنف · 18 قطعة في المخزن');
  await expect(card(page).locator('[data-th-all]')).toHaveText('كل الأصناف · 18 صنف');
});

test('a table with a filter of its own and no sort gets the kit\'s «ترتيب» alone, after «بحث» and the page\'s filter', async ({ page }) => {
  await mount(page, { own: true });
  await expect.poll(() => order(page)).toEqual(['page', 'search', 'filter', 'sort', 'cols']);
  await expect(card(page).locator('[data-fm-btn^="auto"]')).toHaveCount(0); // the page's filter stays the only one
  await expect(card(page).locator('[data-sm-btn^="auto"]')).toHaveCount(1);
});

test('a smaller table (4 columns) and a table in a popup stay as they were', async ({ page }) => {
  await mount(page, { cols: 4 });
  await expect(card(page).locator('[data-cols]')).toHaveCount(1); // the kit ran
  await expect(card(page)).not.toHaveAttribute('data-th', '');
  await expect(card(page).locator('.sec-h .sub')).toHaveText('وصف الجدول: كل عميل بحالته');
  await expect(card(page).locator('[data-th-all], [data-th-note], [data-th-sub]')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('th-host').remove());
  await mount(page, { popup: true });
  await page.waitForTimeout(50);
  await expect(card(page)).not.toHaveAttribute('data-th', '');
  await expect(card(page).locator('[data-th-sub]')).toHaveCount(0);
});
