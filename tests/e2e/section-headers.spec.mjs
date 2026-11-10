import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 decision 46 (owner 10 Nov — «كل الأقسام اللي شكلها تايتل وتحتيه معلومات يبقى الهيدر أخضر والكتابة بيج»): the header band of the
// section cards (K.Section), the dashboard cards, the report / chart cards and the settings cards is green with beige text, flush with
// the card's edges at every width; a button on it is the beige default button. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(() => { test.skip(LIVE, 'asserts on the mocked Supabase'); });
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const CASES = [['dashboard', '.dash-card:not(.tbl-v2)', ':scope>.dash-h'], ['reports', '.chart-card', ':scope>.chart-head'], ['settings', '.set-card', ':scope>.set-card-h'], ['profile-security', '.card.sec:not(.tbl-v2)', ':scope>.sec-h']];
for (const width of [1280, 1100, 900, 390]) {
  test(`decision 46: the section headers are green with beige text, flush with the card (${width}px)`, async ({ page }) => {
    pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    mock = await installSupabaseMock(page, {});
    await page.goto('/'); await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
    await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
    for (const [hash, card, head] of CASES) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await expect.poll(() => page.evaluate(([c]) => [...document.querySelectorAll(c)].filter((x) => x.offsetParent).length, [card])).toBeGreaterThan(0);
      const bad = await page.evaluate(([c, hd]) => [...document.querySelectorAll(c)].filter((x) => x.offsetParent && !x.closest('.modal,.drawer')).map((x) => {
        const h = x.querySelector(hd); if (!h || h.classList.contains('cols-only')) return null;
        const a = x.getBoundingClientRect(); const b = h.getBoundingClientRect(); const t = h.querySelector('h2,h3'); const cs = getComputedStyle(h);
        const beige = (() => { const p = document.createElement('i'); p.style.background = 'var(--color-bg-container)'; document.body.append(p); const v = getComputedStyle(p).backgroundColor; p.remove(); return v; })();
        const btns = [...h.querySelectorAll('.btn:not(.btn-text)')].filter((q) => q.offsetParent);
        if (btns.some((q) => getComputedStyle(q).backgroundColor !== beige)) return [(t && t.textContent.trim()) || '?', 'button not beige'];
        const ok = cs.backgroundColor === 'rgb(0, 86, 66)' && (!t || getComputedStyle(t).color === 'rgb(255, 247, 239)') && Math.abs(b.left - a.left) <= 1.5 && Math.abs(b.right - a.right) <= 1.5 && Math.abs(b.top - a.top) <= 1.5;
        return ok ? null : [(t && t.textContent.trim()) || '?', cs.backgroundColor, Math.round(b.left - a.left), Math.round(a.right - b.right), Math.round(b.top - a.top)];
      }).filter(Boolean), [card, head]);
      expect(bad, hash).toEqual([]);
    }
  });
}
