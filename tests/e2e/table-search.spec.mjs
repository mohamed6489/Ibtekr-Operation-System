import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 12 Nov («خانة بحث صغيرة جمب تايتل الجدول بحيث تساعد المستخدم يدور بشكل اسرع على المعلومة جوة الجدول»): every table card
// (3 columns or more, outside popups) gets a small search right next to its title; it hides the rows without the words (Arabic letters
// folded), says so when nothing is left, and keeps the words when the table redraws. A table whose page already has its own search keeps
// that one only. Mock only.
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

const mount = (page, withOwnSearch) => page.evaluate((own) => {
  const h = (t, a, ...c) => { const e = document.createElement(t); Object.entries(a || {}).forEach(([k, v]) => e.setAttribute(k, v)); e.append(...c); return e; };
  const host = h('div', { id: 'tq-host', style: 'position:fixed;top:80px;left:20px;width:900px;z-index:50;background:#fff' });
  if (own) host.append(h('input', { type: 'search', 'aria-label': 'بحث الصفحة' }));
  const data = [['أحمد', 'مكتمل', 'القاهرة'], ['إيمان', 'ملغي', 'الجيزة'], ['سارة', 'مكتمل', 'طنطا'], ['منى', 'جاري التنفيذ', 'القاهرة']];
  const t = h('table', null, h('thead', null, h('tr', null, ...['الاسم', 'الحالة', 'المدينة'].map((x) => h('th', null, x)))), h('tbody', null, ...data.map((r) => h('tr', null, ...r.map((x) => h('td', null, x))))));
  host.append(h('section', { class: 'card sec', id: 'tq-card' }, h('div', { class: 'sec-h' }, h('div', null, h('h2', null, 'عملاء تجربة')), h('div', { class: 'acts' })), h('div', { class: 'sec-b' }, t)));
  document.body.append(host);
  window.IBKit.sweepColumns(host);
}, withOwnSearch);

test('a small search next to the title hides the rows without the words, says when none is left, and keeps the words on a redraw', async ({ page }) => {
  await mount(page, false);
  const card = page.locator('#tq-card');
  const box = card.locator('.sec-h .tq-line [data-tq] input');
  await expect(card.locator('.tq-line h2')).toHaveText('عملاء تجربة'); // the search sits on the title's line
  await expect(box).toHaveAttribute('placeholder', 'دوّر في الجدول…');
  const shown = card.locator('tbody tr:not(.tq-hide)');
  await expect(shown).toHaveCount(4);
  await box.fill('القاهره'); // ة / ه folded
  await expect(shown).toHaveCount(2);
  await box.fill('ايمان'); // إ folded
  await expect(shown).toHaveText([/إيمان/]);
  await box.fill('لندن');
  await expect(card.locator('tr.tq-none')).toContainText('مفيش صفوف فيها «لندن»');
  await box.fill('');
  await expect(shown).toHaveCount(4);
  await expect(card.locator('tr.tq-none')).toHaveCount(0);
  // a redraw of the same table keeps the words typed
  await box.fill('مكتمل');
  await page.evaluate(() => { document.getElementById('tq-host').remove(); });
  await mount(page, false);
  await expect(page.locator('#tq-card [data-tq] input')).toHaveValue('مكتمل');
  await expect(page.locator('#tq-card tbody tr:not(.tq-hide)')).toHaveCount(2);
});

test('a table whose page has its own search keeps that one only; a real page table gets the box next to its title', async ({ page }) => {
  await mount(page, true);
  await expect(page.locator('#tq-card [data-tq]')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('tq-host').remove());
  // the accounts page: the expenses' details card
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await page.getByRole('tab', { name: 'المصروفات' }).first().click();
  const details = page.locator('#main .table-card', { hasText: 'تفاصيل المصروفات' });
  await expect(details.locator('.table-title .tq-line [data-tq]')).toHaveCount(1);
  const before = await details.locator('tbody tr:not(.tq-hide)').count();
  await details.locator('[data-tq] input').fill('المرتبات');
  await expect(details.locator('tbody tr:not(.tq-hide):not(.tq-none)')).not.toHaveCount(before);
});
