import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 12 Nov — the standard look of every table (his mockup «ده شكل مبدئي لكل الجداول في السيستم»): the card header holds «بحث»
// next to «فلتر» / «ترتيب» / the columns icon; «بحث» opens a full-width search row under the header with «إغلاق» next to it (the button
// green while it is open, like its neighbours while closed); the filter chips sit under the search, and the search looks only through the
// rows the filters left. The words hide the rows without them (Arabic letters folded) and outlive a redraw. A page's own search (it reads
// the whole list) moves into that row as it is — and stays there when the search leaves no rows. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
const GREEN = 'rgb(0, 86, 66)';
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

// a page-like card: 4 columns, so the kit adds the columns icon, «فلتر» and «ترتيب» next to «بحث»
const mount = (page) => page.evaluate(() => {
  const h = (t, a, ...c) => { const e = document.createElement(t); Object.entries(a || {}).forEach(([k, v]) => e.setAttribute(k, v)); e.append(...c); return e; };
  const host = h('div', { id: 'tq-host', style: 'position:fixed;top:80px;left:20px;width:900px;z-index:50;background:#fff' });
  const data = [['أحمد', 'مكتمل', 'القاهرة', '120'], ['إيمان', 'ملغي', 'الجيزة', '80'], ['سارة', 'مكتمل', 'طنطا', '60'], ['منى', 'جاري التنفيذ', 'القاهرة', '40']];
  const t = h('table', null, h('thead', null, h('tr', null, ...['الاسم', 'الحالة', 'المدينة', 'المبلغ'].map((x) => h('th', null, x)))), h('tbody', null, ...data.map((r) => h('tr', null, ...r.map((x) => h('td', null, x))))));
  host.append(h('section', { class: 'card sec', id: 'tq-card' }, h('div', { class: 'sec-h' }, h('div', null, h('h2', null, 'عملاء تجربة')), h('div', { class: 'acts' })), h('div', { class: 'sec-b' }, t)));
  document.body.append(host);
  window.IBKit.sweepColumns(host); window.IBKit.withColumns(host.querySelector('#tq-card'), '', '');
});

test('«بحث» opens a row under the header (green while open), hides the rows without the words, «إغلاق» / Esc close and clear; the words outlive a redraw', async ({ page }) => {
  await mount(page);
  const card = page.locator('#tq-card');
  const btn = card.locator('.sec-h [data-tq-btn]'); const row = card.locator('[data-tq-row]'); const box = row.locator('input');
  await expect(card.locator('.sec-h [data-cols]')).toHaveCount(1);
  // the header's controls: «بحث» · «فلتر» · «ترتيب» · the columns icon
  expect(await card.locator('.sec-h .acts').evaluate((a) => [...a.children].map((x) => x.matches('[data-tq-btn]') ? 'search' : x.querySelector('[data-fm-btn]') ? 'filter' : x.querySelector('[data-sm-btn]') ? 'sort' : x.matches('[data-cols]') ? 'cols' : '?'))).toEqual(['search', 'filter', 'sort', 'cols']);
  await expect(btn).toHaveText('بحث'); await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(btn).toHaveCSS('background-color', GREEN);
  await expect(row).toBeVisible(); await expect(box).toBeFocused();
  await expect(box).toHaveAttribute('placeholder', 'ابحث عن…');
  // the row sits right under the header
  expect(await card.locator('.sec-h').evaluate((x) => x.nextElementSibling && x.nextElementSibling.matches('[data-tq-row]'))).toBe(true);
  const shown = card.locator('tbody tr:not(.tq-hide):not(.af-hide):not(.tq-none)');
  await expect(shown).toHaveCount(4);
  await box.fill('القاهره'); // ة / ه folded
  await expect(shown).toHaveCount(2);
  await box.fill('ايمان'); // إ folded
  await expect(shown).toHaveText([/إيمان/]);
  await box.fill('لندن');
  await expect(card.locator('tr.tq-none')).toContainText('مفيش صفوف فيها «لندن»');
  // «إغلاق»: the row closes, the words go, every row back
  await row.getByRole('button', { name: 'إغلاق' }).click();
  await expect(row).toBeHidden(); await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(btn).not.toHaveCSS('background-color', GREEN);
  await expect(box).toHaveValue(''); await expect(shown).toHaveCount(4); await expect(card.locator('tr.tq-none')).toHaveCount(0);
  // Esc closes too
  await btn.click(); await box.fill('سارة'); await expect(shown).toHaveCount(1);
  await box.press('Escape');
  await expect(row).toBeHidden(); await expect(shown).toHaveCount(4); await expect(btn).toBeFocused();
  // a redraw of the same table keeps the row open with the words typed
  await btn.click(); await box.fill('مكتمل');
  await page.evaluate(() => { document.getElementById('tq-host').remove(); });
  await mount(page);
  await expect(page.locator('#tq-card [data-tq-btn]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#tq-card [data-tq-row] input')).toHaveValue('مكتمل');
  await expect(page.locator('#tq-card tbody tr:not(.tq-hide)')).toHaveCount(2);
});

test('the filter chips sit under the search, and the search looks only through the rows the filter left', async ({ page }) => {
  await mount(page);
  const card = page.locator('#tq-card');
  await card.locator('[data-fm-btn]').click();
  const fm = page.locator('[data-fm-menu^="auto:"]');
  await fm.locator('[data-fm-tab="الحالة"]').click();
  await fm.locator('[data-fm="الحالة:مكتمل"]').click();
  await fm.locator('[data-fm-apply]').click();
  const shown = card.locator('tbody tr:not(.tq-hide):not(.af-hide):not(.tq-none)');
  await expect(shown).toHaveCount(2);
  await card.locator('[data-tq-btn]').click();
  // the order down the card: header → search row → the chips → the table
  expect(await card.evaluate((c) => ['.sec-h', '[data-tq-row]', '.af-row', 'table'].map((q) => c.querySelector(q)).every((x, i, a) => x && (!i || (a[i - 1].compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING))))).toBe(true);
  await card.locator('[data-tq-row] input').fill('القاهرة'); // أحمد (مكتمل) + منى (جاري التنفيذ — out of the filter)
  await expect(shown).toHaveText([/أحمد/]);
  await card.locator('[data-tq-row] input').fill('منى');
  await expect(card.locator('tr.tq-none')).toContainText('مفيش صفوف فيها «منى»');
});

test('a page\'s own search moves into the row: the products search reads the whole list, stays put when nothing is left, and «إغلاق» clears it', async ({ page }) => {
  await page.evaluate(() => { location.hash = 'products-records'; });
  await page.waitForFunction(() => window.IBPages.all().products.api.ready());
  const P = page.locator('#pg-products');
  const btn = P.locator('[data-tq-btn]'); const row = P.locator('[data-tq-row]');
  await expect(btn).toHaveCount(1);
  await expect(P.locator('.pr-rec > .sec-h .search-field')).toHaveCount(0); // the old box left the header
  await expect(row).toBeHidden();
  await btn.click();
  const box = row.getByRole('searchbox', { name: 'بحث في المنتجات' });
  await expect(box).toBeFocused();
  await page.keyboard.type('macr');
  await expect(P.locator('tbody tr')).toHaveCount(2);
  await expect(box).toBeFocused(); await expect(box).toHaveValue('macr');
  // nothing left: the table goes, the search stays in its row with the focus and «بحث» stays on
  await page.keyboard.type('zzz');
  await expect(P.locator('table')).toHaveCount(0);
  await expect(row.getByRole('searchbox', { name: 'بحث في المنتجات' })).toBeFocused();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await row.getByRole('button', { name: 'إغلاق' }).click();
  await expect(P.locator('tbody tr')).toHaveCount(4);
  await expect(P.locator('[data-tq-row]')).toBeHidden();
  await expect(P.locator('[data-tq-btn]')).toHaveAttribute('aria-expanded', 'false');
});

test('a real page table: the expenses\' details card gets «بحث» in its header and the row searches it', async ({ page }) => {
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await page.getByRole('tab', { name: 'المصروفات' }).first().click();
  const details = page.locator('#main .table-card', { hasText: 'تفاصيل المصروفات' });
  await expect(details.locator('.table-title [data-tq-btn]')).toHaveCount(1);
  const before = await details.locator('tbody tr:not(.tq-hide)').count();
  await details.locator('[data-tq-btn]').click();
  await details.locator('[data-tq-row] input').fill('المرتبات');
  await expect(details.locator('tbody tr:not(.tq-hide):not(.tq-none)')).not.toHaveCount(before);
});
