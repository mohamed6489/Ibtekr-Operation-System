import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// A table's own helpers run a tick after it is drawn (the columns button and the member's column order — phase 4.1; the automatic
// filter and sort — 5.5). They used to re-append every cell and row even with nothing to reorder, and moving a node blurs it: a field
// focused in that tick lost its focus and the text typed into it (the variations' maker price on CI, 6 Nov — phase 10 decision 24).
// Now the cells and rows move only when their order really changes, and the field gets its focus and caret back. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

// draws a four-column table card with a text field in each row, hands it to the kit, focuses row 2's field before the kit's tick
const probe = (page, key, saved) => page.evaluate(async ([key, saved]) => {
  const K = window.IBKit;
  if (saved) K.store.colPrefs = Object.assign({}, K.store.colPrefs, { [K.ME]: Object.assign({}, (K.store.colPrefs || {})[K.ME], { [key]: saved }) });
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((x) => e.append(typeof x === 'string' ? document.createTextNode(x) : x)); return e; };
  const row = (n) => el('tr', null, el('td', null, 'صف ' + n), el('td', null, String(n * 10)), el('td', null, el('input', { id: key + '-in-' + n, type: 'text' })), el('td', null, n % 2 ? 'أ' : 'ب'));
  const table = el('table', null, el('thead', null, el('tr', null, el('th', null, 'الاسم'), el('th', null, 'رقم'), el('th', null, 'السعر'), el('th', null, 'حالة'))), el('tbody', null, row(1), row(2), row(3)));
  const card = el('section', { class: 'card table-card', 'data-probe': key }, el('div', { class: 'table-title' }, el('h2', null, 'جدول تجربة')), table);
  document.body.prepend(card); // a visible place (a hidden page cannot hold the focus)
  K.withColumns(card, key, 'جدول تجربة');
  const input = document.getElementById(key + '-in-2'); input.focus(); input.value = '60'; input.setSelectionRange(2, 2);
  await new Promise((res) => setTimeout(res, 60)); // the kit's tick has run
  return { focused: document.activeElement === input, caret: input.selectionStart, heads: [...table.tHead.rows[0].cells].map((c) => c.textContent), cols: !!card.querySelector('[data-cols]') };
}, [key, saved]);

test('nothing to reorder: the columns and the filter leave the cells and rows in place — the field keeps its focus and the next key lands in it', async ({ page }) => {
  const r = await probe(page, 'tbl:focus-probe', null);
  expect(r).toEqual({ focused: true, caret: 2, heads: ['الاسم', 'رقم', 'السعر', 'حالة'], cols: true });
  await page.keyboard.type('5');
  await expect(page.locator('#tbl\\:focus-probe-in-2')).toHaveValue('605');
});

test('a saved column order moves the cells, and the field gets its focus and caret back', async ({ page }) => {
  const r = await probe(page, 'tbl:focus-probe-2', { order: ['حالة', 'السعر', 'رقم'], hidden: [] });
  expect(r).toEqual({ focused: true, caret: 2, heads: ['الاسم', 'حالة', 'السعر', 'رقم'], cols: true });
  await page.keyboard.type('5');
  await expect(page.locator('#tbl\\:focus-probe-2-in-2')).toHaveValue('605');
});
