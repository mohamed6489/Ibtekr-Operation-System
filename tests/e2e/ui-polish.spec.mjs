import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner, 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md decisions 1–2): no two controls touch anywhere — a row of buttons
// has its gap — and a hover is one middle beige between the page and the selected beige; a text button on a green header keeps its
// beige text readable under the pointer. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

const PAGES = ['dashboard', 'orders', 'makers', 'expenses', 'inventory', 'products', 'cs', 'autoreply', 'tickets', 'reports', 'marketing', 'hr', 'profile', 'settings', 'settings-team', 'settings-hr', 'settings-lists', 'settings-quick', 'settings-data'];
// side by side controls of one parent on one row, less than 4px apart
const touching = (page, where) => page.evaluate((where) => {
  const out = [];
  const els = Array.from(document.querySelectorAll('button:not([role=tab]):not(.tab):not(.opt):not([role=option]):not(.cb):not(.sw), .select, a.btn, .input'))
    .filter((e) => e.offsetParent && !e.closest('.sidebar, .topbar, .menu, [role=listbox], .cal, .dp, .steps, .stepper, .chips, .seg, .pager') && e.getBoundingClientRect().width > 8);
  const groups = new Map(); els.forEach((e) => { const x = e.closest('.pop-anchor') || e; const p = x.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(x); });
  groups.forEach((list) => { const rs = list.map((e) => ({ e, r: e.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left);
    for (let i = 1; i < rs.length; i++) { const a = rs[i - 1].r, b = rs[i].r; const gap = b.left - a.right;
      if (Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6 && gap < 4 && gap > -2) out.push(where + ' :: ' + (rs[i - 1].e.textContent || '').trim().slice(0, 20) + ' | ' + (rs[i].e.textContent || '').trim().slice(0, 20)); } });
  return out; }, where);

test('no two controls touch on any page or tab (a row of buttons keeps its gap)', async ({ page }) => {
  test.setTimeout(240000);
  const bad = [];
  for (const pg of PAGES) {
    await page.evaluate((h) => { location.hash = h; }, pg); await page.waitForTimeout(600);
    const tabs = await page.evaluate(() => { const l = Array.from(document.querySelectorAll('.content > .tabs')).find((x) => x.offsetParent !== null); return l ? Array.from(l.querySelectorAll('[role=tab]')).map((t) => t.textContent.trim()) : []; });
    for (const t of tabs.length ? tabs : ['']) {
      if (t) { await page.evaluate((t) => { const l = Array.from(document.querySelectorAll('.content > .tabs')).find((x) => x.offsetParent !== null); const b = l && Array.from(l.querySelectorAll('[role=tab]')).find((x) => x.textContent.trim() === t); if (b) b.click(); }, t); await page.waitForTimeout(300); }
      bad.push(...await touching(page, pg + ' › ' + t));
    }
  }
  expect(bad).toEqual([]);
});

test('a hover is the middle beige, the selected keeps the dark beige; a text button on a green header stays readable under the pointer', async ({ page }) => {
  const rgb = (page, sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const HOVER = 'rgb(239, 226, 201)', SELECTED = 'rgb(232, 213, 179)';
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  const b = page.getByRole('button', { name: 'افتح الميديا باير' }).first();
  await b.hover();
  const st = await b.evaluate((e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.color]; });
  expect(st[0]).not.toBe(SELECTED); // it was the dark beige behind beige text
  expect(st[1]).toBe('rgb(255, 247, 239)');
  // a menu option: hover = the middle beige, the selected one = the dark beige
  await page.locator('.sidebar .nav-item[data-page="settings"]').click();
  await page.evaluate(() => { location.hash = 'settings-team'; }); await page.waitForTimeout(600);
  const sel = page.locator('.select[aria-haspopup=listbox]:visible').first(); await sel.click();
  const opts = page.locator('[role=listbox] [role=option]');
  await expect(opts.first()).toBeVisible();
  const other = page.locator('[role=listbox] [role=option]:not([aria-selected=true])').first();
  await other.hover();
  expect(await other.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(HOVER);
  const chosen = page.locator('[role=listbox] [role=option][aria-selected=true]');
  if (await chosen.count()) expect(await rgb(page, '[role=listbox] [role=option][aria-selected=true]')).toBe(SELECTED);
});
