import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// IBKit.MultiPick (the owner, 11 Nov — B2 «الفئة الأساسية», and the filter dropdowns of B3 / B5): a multi-select with search. The field
// form shows the picked names in the button and its error under it; the filter form shows «<label> (N)». More than six options (or
// search: true) brings a search box (Arabic letters folded: أ / إ / آ = ا, ة = ه, ى = ي); a sub-level shows its «-» / «--» / «---»;
// «مسح» clears, every tick calls onChange with the picks in the order picked; ArrowDown from the search goes to the first option. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'mounts a kit component on the mocked app');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

const mount = (page, props) => page.evaluate((p) => {
  window.__mp = [];
  const host = document.createElement('div'); host.id = 'mp-host'; host.style.cssText = 'position:fixed;top:80px;left:40px;width:360px;z-index:50;background:#fff;padding:8px';
  document.body.append(host);
  host.append(window.IBKit.MultiPick(Object.assign({ onChange: (v) => window.__mp.push(v) }, p)));
}, props);
const OPTS = [[1, 'ديكور'], [11, 'إضاءة', 1], [111, 'أباجورات', 2], [1111, 'أباجورة مكتب', 3], [2, 'هدايا'], [3, 'مطبخ'], [4, 'Kids'], [5, 'ملابس']];

test('the field form: the picks in the button in the order picked, the search folds the Arabic letters, the sub-levels carry «-», «مسح» clears', async ({ page }) => {
  await mount(page, { id: 'mp-cat', field: true, required: true, label: 'الأقسام', options: OPTS, value: [2], error: 'اختار قسم' });
  await expect(page.locator('#mp-host label')).toContainText('الأقسام');
  await expect(page.locator('#mp-cat .val')).toHaveText('هدايا');
  await expect(page.locator('#mp-cat-err')).toHaveText('اختار قسم');
  await page.locator('#mp-cat').click();
  const menu = page.locator('[data-mp-menu="mp-cat"]');
  await expect(menu.locator('[data-mp-q]')).toBeFocused(); // eight options: a search box, focused
  await expect(menu.locator('[role=menuitemcheckbox]')).toHaveText(['ديكور', '- إضاءة', '-- أباجورات', '--- أباجورة مكتب', 'هدايا', 'مطبخ', 'Kids', 'ملابس']);
  await menu.locator('[data-mp-q]').fill('اباجور'); // أ → ا
  await expect(menu.locator('[role=menuitemcheckbox]')).toHaveText(['-- أباجورات', '--- أباجورة مكتب']);
  await menu.locator('[data-mp-q]').fill('اباجوره'); // and ة → ه
  await expect(menu.locator('[role=menuitemcheckbox]')).toHaveText(['--- أباجورة مكتب']);
  await menu.locator('[data-mp-q]').press('ArrowDown');
  await expect(menu.locator('[data-mp-opt="1111"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.locator('[data-mp-opt="1111"]')).toHaveAttribute('aria-checked', 'true');
  await menu.locator('[data-mp-q]').fill('kid');
  await menu.locator('[data-mp-opt="4"]').click();
  await menu.locator('[data-mp-q]').fill('zzz');
  await expect(menu).toContainText('مفيش نتايج');
  expect(await page.evaluate(() => window.__mp)).toEqual([['2', '1111'], ['2', '1111', '4']]);
  await menu.locator('[data-mp-done]').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#mp-cat .val')).toHaveText('هدايا، أباجورة مكتب، Kids');
  await page.locator('#mp-cat').click();
  await page.locator('[data-mp-menu="mp-cat"] [data-mp-clear]').click();
  await expect(page.locator('#mp-cat .val')).toHaveText('اختار');
  expect(await page.evaluate(() => window.__mp.pop())).toEqual([]);
});

test('the filter form: «<label> (N)» on a small button, no search for six options or fewer, an unknown value is dropped', async ({ page }) => {
  await mount(page, { id: 'mp-f', label: 'البراند', options: [['a', 'Zaan'], ['b', 'Hands']], value: ['b', 'gone'] });
  await expect(page.locator('#mp-f')).toHaveClass(/\bsm\b/);
  await expect(page.locator('#mp-f .val')).toHaveText('البراند (1)');
  await expect(page.locator('#mp-f')).toHaveAttribute('aria-label', 'البراند — Hands');
  await page.locator('#mp-f').click();
  await expect(page.locator('[data-mp-menu="mp-f"] [data-mp-q]')).toHaveCount(0);
  await page.locator('[data-mp-menu="mp-f"] [data-mp-opt="a"]').click();
  await expect(page.locator('#mp-f .val')).toHaveText('البراند (2)');
  await expect(page.locator('#mp-f')).toHaveClass(/has-val/);
  expect(await page.evaluate(() => window.__mp)).toEqual([['b', 'a']]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-mp-menu="mp-f"]')).toHaveCount(0);
});

test('the filter mode (onApply): the ticks wait in the menu with «اعرض N <noun>» counting them; applying sets them, closing otherwise drops them', async ({ page }) => {
  await page.evaluate(() => {
    window.__applied = [];
    const host = document.createElement('div'); host.id = 'mp-host'; host.style.cssText = 'position:fixed;top:80px;left:40px;width:360px;z-index:50;background:#fff;padding:8px';
    document.body.append(host);
    host.append(window.IBKit.MultiPick({ id: 'mp-d', label: 'المبتكر', options: [['a', 'Zaan'], ['b', 'Hands'], ['c', 'Clay']], value: [], noun: 'منتج', count: (v) => v.length * 10, onApply: (v) => window.__applied.push(v) }));
  });
  await page.locator('#mp-d').click();
  const menu = page.locator('[data-mp-menu="mp-d"]');
  await expect(menu.locator('[data-mp-apply]')).toHaveText('اعرض 0 منتج');
  await menu.locator('[data-mp-opt="a"]').click(); await menu.locator('[data-mp-opt="c"]').click();
  await expect(menu.locator('[data-mp-apply]')).toHaveText('اعرض 20 منتج');
  await expect(page.locator('#mp-d .val')).toHaveText('المبتكر'); // nothing applied yet
  expect(await page.evaluate(() => window.__applied)).toEqual([]);
  await page.keyboard.press('Escape'); // closed without applying: dropped
  await page.locator('#mp-d').click();
  await expect(page.locator('[data-mp-menu="mp-d"] [aria-checked=true]')).toHaveCount(0);
  await page.locator('[data-mp-menu="mp-d"] [data-mp-opt="b"]').click();
  await page.locator('[data-mp-menu="mp-d"] [data-mp-apply]').click();
  await expect(page.locator('[data-mp-menu="mp-d"]')).toHaveCount(0);
  await expect(page.locator('#mp-d .val')).toHaveText('المبتكر (1)');
  expect(await page.evaluate(() => window.__applied)).toEqual([['b']]);
});

// the owner 12 Nov («دخل الفلتر اللي بره جوه زرار الفلتر وحطوا جمب الترتيب … في كل الجداول»): IBKit.FilterMenu is one «فلتر (N)»
// button; its panel holds every group with its ticks (a search box in a group past six values, «-» before a sub-level), «مسح» and
// «اعرض N»; the values come back in their own type (B5's row of dropdowns is gone)
test('FilterMenu = one «فلتر» button: the panel holds every group, a long group has a search box, «اعرض N» applies all, the values in their own type', async ({ page }) => {
  await page.evaluate(() => {
    window.__fm = [];
    const host = document.createElement('div'); host.id = 'mp-host'; host.style.cssText = 'position:fixed;top:80px;left:40px;width:600px;z-index:50;background:#fff;padding:8px';
    document.body.append(host);
    const rows = [{ s: 'active', c: 15 }, { s: 'active', c: 22 }, { s: 'inactive', c: 15 }];
    const pass = (d) => (r) => (!d.s.length || d.s.includes(r.s)) && (!d.c.length || d.c.includes(r.c));
    const many = ['أسوان', 'الأقصر', 'القاهرة', 'الجيزة', 'إسكندرية', 'طنطا', 'بنها'].map((x) => [x, x]);
    host.append(window.IBKit.FilterMenu({ id: 'demo', label: 'فلتر', noun: 'صف', value: { s: ['active'], c: [], p: [] },
      groups: [{ key: 's', label: 'الحالة', options: [['active', 'نشط'], ['inactive', 'موقوف']] }, { key: 'c', label: 'الفئة', options: [[15, 'ديكور'], [22, 'هدايا', 1]] }, { key: 'p', label: 'المحافظة', options: many }],
      count: (d) => rows.filter(pass(d)).length, onApply: (d) => window.__fm.push(d) }));
  });
  await expect(page.locator('#mp-host [data-fm-row]')).toHaveCount(0);
  const btn = page.locator('#mp-host [data-fm-btn="demo"]');
  await expect(btn.locator('.val')).toHaveText('فلتر (1)');
  await btn.click();
  const menu = page.locator('[data-fm-menu="demo"]');
  await expect(menu.locator('[data-fm-key] .opt-group')).toHaveText(['الحالة', 'الفئة', 'المحافظة']);
  await expect(menu.locator('[data-fm-key="c"] [role=menuitemcheckbox]')).toHaveText(['ديكور', '- هدايا']); // a sub-level with «-»
  await expect(menu.locator('[data-fm-q]')).toHaveCount(1); // the search only in the long group
  await menu.locator('[data-fm-q="p"]').fill('الاقصر'); // أ folded
  await expect(menu.locator('[data-fm-key="p"] [role=menuitemcheckbox]:visible')).toHaveText(['الأقصر']);
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 2 صف'); // «نشط» already on
  await menu.locator('[data-fm="c:15"]').click();
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 1 صف');
  await menu.locator('[data-fm-apply]').click();
  expect(await page.evaluate(() => window.__fm)).toEqual([{ s: ['active'], c: [15], p: [] }]); // the status kept, the category a number
});

test('a details table without its own filter gets «فلتر» next to the sort in its header (columns whose values repeat)', async ({ page }) => {
  await page.evaluate(() => {
    const K = window.IBKit; const h = (t, a, ...c) => { const e = document.createElement(t); Object.entries(a || {}).forEach(([k, v]) => e.setAttribute(k, v)); e.append(...c); return e; };
    const card = h('section', { class: 'card sec', id: 'af-card', style: 'position:fixed;top:80px;left:20px;width:900px;z-index:50;background:#fff' }, h('div', { class: 'sec-h' }, h('h2', null, 'حركات تجربة'), h('div', { class: 'acts' })));
    const data = [['أ', 'مكتمل', 'القاهرة', '100'], ['ب', 'ملغي', 'الجيزة', '50'], ['ج', 'مكتمل', 'القاهرة', '70'], ['د', 'مكتمل', 'الجيزة', '20'], ['ه', 'ملغي', 'القاهرة', '0'], ['و', 'مكتمل', 'الإسكندرية', '10']];
    const t = h('table', null, h('thead', null, h('tr', null, ...['الاسم', 'الحالة', 'المدينة', 'المبلغ'].map((x) => h('th', null, x)))), h('tbody', null, ...data.map((r) => h('tr', null, ...r.map((x) => h('td', null, x))))));
    card.append(h('div', { class: 'sec-b' }, t)); document.body.append(card);
    K.withColumns(card, 'af-demo', 'حركات تجربة');
  });
  const card = page.locator('#af-card');
  await expect(card.locator('[data-fm-row]')).toHaveCount(0);
  await expect(card.locator('.sec-h [data-fm-btn^="auto"]')).toHaveCount(1); // in the header
  await expect(card.locator('.sec-h [data-sm-btn^="auto"]')).toHaveCount(1); // next to the sort
  await card.locator('[data-fm-btn^="auto"]').click();
  const menu = page.locator('[data-fm-menu^="auto"]');
  await expect(menu.locator('[data-fm-key] .opt-group')).toContainText(['الحالة', 'المدينة']);
  await menu.locator('[data-fm="الحالة:ملغي"]').click();
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 2 صف');
  await menu.locator('[data-fm-apply]').click();
  await expect(card.locator('tbody tr:not(.af-hide)')).toHaveCount(2);
  await expect(card.locator('[data-af-chip]')).toHaveCount(1);
  await expect(card.locator('[data-fm-btn^="auto"] .val')).toHaveText('فلتر (1)'); // the button drawn again with the pick
});
