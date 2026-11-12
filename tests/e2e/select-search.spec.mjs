import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 12 Nov («خلي في كل الدروب داونز بتاعة المبتكرين إمكانية البحث بالاسم لما اكتب اول حرف يجيبلي المبتكرين اللي بالحرف ده»):
// the kit's Select (IBUI.Select — every maker picker in the system) opens with a search box once the list is long (9 options or more).
// The letters typed keep the names that start with them (a leading «@» ignored, أ / إ / آ = ا); from two letters the names that hold
// them follow; a letter typed on the closed select opens it with that letter; ↓ goes to the list, Enter picks the first shown.
// A short list stays as it was. Mock only.
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

const MAKERS = ['@Sugar-crafts', 'Akhmim', 'Alaa Anas', 'antekama', 'Antikiano', 'Art Craft', 'Bian eg', 'cralaa', 'Crochic', 'Decoro', 'Dokan Elbanna', 'أحمد للخزف'];
const mount = (page, names) => page.evaluate((list) => {
  window.__sel = [];
  const host = document.createElement('div'); host.id = 'sel-host'; host.style.cssText = 'position:fixed;top:80px;left:40px;width:360px;z-index:50;background:#fff;padding:8px';
  document.body.append(host);
  host.append(window.IBUI.Select({ id: 'sel-maker', label: 'المبتكر', required: true, placeholder: 'اختار المبتكر', options: list.map((n, i) => ({ value: 'v' + i, label: n })), value: '', onChange: (v) => window.__sel.push(v) }));
}, names);
const shown = (page) => page.locator('#sel-host [role=listbox] [role=option]:visible');

test('a long maker list: the first letter keeps the names that start with it, two letters add the ones that hold them, Enter picks the first', async ({ page }) => {
  await mount(page, MAKERS);
  await page.locator('#sel-maker').click();
  const box = page.locator('#sel-host [data-select-search]');
  await expect(box).toBeFocused();
  await expect(shown(page)).toHaveCount(MAKERS.length);
  await box.fill('a');
  await expect(shown(page)).toHaveText(['Akhmim', 'Alaa Anas', 'antekama', 'Antikiano', 'Art Craft']); // any case
  await box.fill('ا');
  await expect(shown(page)).toHaveText(['أحمد للخزف']); // أ / إ / آ = ا
  await box.fill('s');
  await expect(shown(page)).toHaveText(['@Sugar-crafts']); // the leading «@» ignored
  await box.fill('cr');
  await expect(shown(page)).toHaveText(['cralaa', 'Crochic', '@Sugar-crafts', 'Art Craft']); // the starts first, then the ones that hold «cr»
  await box.fill('zz');
  await expect(shown(page)).toHaveCount(0);
  await expect(page.locator('#sel-host .menu-empty')).toBeVisible();
  await box.fill('de');
  await box.press('Enter');
  expect(await page.evaluate(() => window.__sel)).toEqual(['v9']); // Decoro
});

test('a letter typed on the closed select opens it filtered; ↓ goes to the list; a short list has no search box', async ({ page }) => {
  await mount(page, MAKERS);
  await page.locator('#sel-maker').focus();
  await page.keyboard.press('b');
  await expect(page.locator('#sel-host [data-select-search]')).toHaveValue('b');
  await expect(shown(page)).toHaveText(['Bian eg']);
  await page.keyboard.press('ArrowDown');
  await expect(shown(page).first()).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__sel)).toEqual(['v6']);
  await page.evaluate(() => document.getElementById('sel-host').remove());
  await mount(page, MAKERS.slice(0, 3));
  await page.locator('#sel-maker').click();
  await expect(page.locator('#sel-host [data-select-search]')).toHaveCount(0);
  await expect(shown(page)).toHaveCount(3);
});
