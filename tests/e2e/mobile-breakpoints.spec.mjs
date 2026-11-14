import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner 13 Nov («راجع ال ui بتاع الموبايل و صلح الاخطاء … و اتاكد من ال breakpoints كلها سليمة في كل حاجة حتي ال popups»):
// docs/superpowers/plans/2026-11-13-mobile-review.md. Every page and its tabs at a phone, a tablet and the tablet-landscape edge (1024) — no
// page scrolls sideways; the pinned tabs are one row on a phone with the selected tab in view; a table card's head keeps «فلتر» whole and
// its controls inside the card; a wide popup and the order details popup stay inside the screen. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page, size) {
  await page.setViewportSize(size);
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// the visible pinned tab strip of the page that is open
const tabLabels = (page) => page.evaluate(() => { const l = Array.from(document.querySelectorAll('.content > .tabs')).find((x) => x.offsetParent !== null); return l ? Array.from(l.querySelectorAll('[role=tab]')).map((t) => t.textContent.trim()) : []; });
const clickTab = (page, label) => page.evaluate((t) => { const l = Array.from(document.querySelectorAll('.content > .tabs')).find((x) => x.offsetParent !== null); const b = l && Array.from(l.querySelectorAll('[role=tab]')).find((x) => x.textContent.trim() === t); if (b) b.click(); }, label);
const PAGES = ['dashboard', 'orders', 'makers', 'expenses', 'inventory', 'products', 'cs', 'autoreply', 'tickets', 'reports', 'marketing', 'hr', 'profile', 'settings-team', 'settings-data', 'settings-quick'];

for (const [label, size] of [['phone 360', { width: 360, height: 740 }], ['tablet 768', { width: 768, height: 1024 }], ['tablet landscape 1024', { width: 1024, height: 768 }]]) {
  test('no page scrolls sideways — every page and tab (' + label + ')', async ({ page }) => {
    test.setTimeout(180000);
    await signIn(page, size);
    const bad = [];
    for (const pg of PAGES) {
      await go(page, pg);
      const tabs = await tabLabels(page);
      for (const t of tabs.length ? tabs : ['']) {
        if (t) { await clickTab(page, t); await page.waitForTimeout(250); }
        const s = await sideways(page); if (s > 1) bad.push(pg + ' › ' + t + ' +' + s + 'px');
      }
    }
    expect(bad).toEqual([]);
  });
}

test('phone: the pinned tabs are one row and the selected tab is in view; a table head keeps «فلتر» whole inside the card', async ({ page }) => {
  await signIn(page, { width: 360, height: 740 });
  await go(page, 'hr');
  const tabs = await tabLabels(page); expect(tabs.length).toBeGreaterThan(4);
  await clickTab(page, tabs[tabs.length - 1]); await page.waitForTimeout(300);
  const strip = await page.evaluate(() => { const l = Array.from(document.querySelectorAll('.content > .tabs')).find((x) => x.offsetParent !== null); const a = l.querySelector('[aria-selected="true"]'); const lr = l.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { h: lr.height, inView: ar.left >= lr.left - 1 && ar.right <= lr.right + 1, pinned: getComputedStyle(l).position }; });
  expect(strip.h).toBeLessThan(64); // one row (it wrapped into two or three before)
  expect(strip.inView).toBe(true);
  expect(strip.pinned).toBe('sticky');
  // a table card's head: search · filter · sort · columns («سجل المخزون»; the settings tables have no tools since the owner 14 Nov)
  await go(page, 'inventory'); await clickTab(page, 'سجل المخزون'); await page.waitForTimeout(300);
  const head = await page.evaluate(() => { const acts = Array.from(document.querySelectorAll('.sec-h .acts:has(.select)')).find((x) => x.offsetParent); const card = acts.closest('.card'); const cr = card.getBoundingClientRect(); const fm = acts.querySelector('[data-fm-btn]');
    return { fmWhole: fm.scrollWidth <= fm.clientWidth + 1, inside: Array.from(acts.children).every((c) => { const r = c.getBoundingClientRect(); return r.left >= cr.left - 1 && r.right <= cr.right + 1; }) }; });
  expect(head).toEqual({ fmWhole: true, inside: true });
});

test('a wide popup stays inside a tablet screen; the order details popup on a phone shows its tabs and its fields don\'t overlap', async ({ page }) => {
  await signIn(page, { width: 768, height: 1024 });
  // the kit's widest popup (.modal.xl, 960px) on a 768px screen
  await page.evaluate(() => { const U = window.IBUI; const m = U.Modal({ title: 'بوب أب عريض', body: [U.h('p', null, 'نص')], footer: [U.Button({ label: 'إغلاق' })] }); const d = document.querySelector('.modal[role=dialog]:last-of-type'); if (d) d.classList.add('xl'); return !!m; });
  const box = await page.locator('.modal.xl[role=dialog]').last().boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(768);
  await page.keyboard.press('Escape');
  // the order details popup (the orders' own, in its shadow root) at 360
  await page.setViewportSize({ width: 360, height: 740 });
  await go(page, 'orders');
  await page.waitForFunction(() => window.OrdersApp && window.OrdersApp.query({}, 1).rows.length > 0);
  await page.evaluate(() => { const A = window.OrdersApp; const o = A.query({}, 50).rows.find((r) => (r.subs || []).length > 1) || A.query({}, 1).rows[0]; A.details(o.id, 'subs'); });
  await expect(page.locator('#orders #cdlg')).toBeVisible();
  const d = await page.evaluate(() => { const root = document.querySelector('#orders').shadowRoot; const dl = root.querySelector('#cdlg'); const tabs = dl.querySelector('.dtabs');
    const fields = Array.from(dl.querySelectorAll('.srow')).slice(0, 1).flatMap((r) => Array.from(r.querySelectorAll(':scope > .fld')).map((f) => f.getBoundingClientRect()));
    const overlap = fields.some((a, i) => fields.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    return { tabsH: tabs.getBoundingClientRect().height, overlap }; });
  expect(d.tabsH).toBeGreaterThanOrEqual(40); // the tab bar used to shrink to a sliver under the body
  expect(d.overlap).toBe(false);
});
