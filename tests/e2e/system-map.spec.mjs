import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «العقل الذكي» (Safwat 24 Nov — the pinned mockup made real; the admin only; a button next to «مساعد جديد» on «الذكاء الاصطناعي», not the menu, with «رجوع»): the groups around the
// brain with their state from the system's own reads, today's events, a group's sheet (its parts, «إيقاف مؤقت» → the settings row
// «integrations».paused, «كمّل»), the full list of the software and plugins with the site's versions. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { vault: { resend: JSON.stringify({ key: 're_test_key_123456' }) } });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, who) {
  await page.goto('/');
  await page.fill('#lg-id', who || 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}

test('«العقل الذكي»: the admin\'s button on «الذكاء الاصطناعي» opens it (not in the menu), «رجوع» goes back — the groups around the brain with their state, a group\'s sheet with its parts, «إيقاف مؤقت» saves the pause, «كمّل» takes it off; the plugins list', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('.sidebar .nav-item[data-page="brain"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = 'ai'; });
  await page.locator('#pg-ai [data-ai-brain]').click();
  const pg = page.locator('#pg-brain [data-sysmap]');
  await expect(pg.locator('h1')).toHaveText('العقل الذكي');
  await expect(page.locator('.sidebar .nav-item[data-page="ai"]')).toHaveAttribute('aria-current', 'page');
  await expect(pg.locator('[data-sm-node]')).toHaveCount(11);
  await expect(pg.locator('[data-sm-node="core"]')).toHaveAttribute('data-state', 'on');
  await expect(pg.locator('[data-sm-k="on"]')).toContainText('من 11');
  // the full list: every group's parts, the site's known plugins first
  await expect(pg.locator('[data-sm-rows] tr', { hasText: 'Dokan' })).toHaveCount(1);
  // Safwat 24 Nov («نفس شكل بقيت جداول السيستم»): the kit's standard table card — «بحث» / «فلتر» / «ترتيب» in its head, the green header
  const card = pg.locator('section.card.tbl-v2', { hasText: 'كل السوفتوير والبلاجنز' });
  await expect(card.locator('[data-tq-btn]')).toBeVisible(); await expect(card.locator('[data-fm-btn]')).toBeVisible();
  await expect(card.locator('[data-sm-check]')).toBeVisible(); // the admin's site check beside them
  await card.locator('[data-tq-btn]').click();
  await card.locator('[data-tq-row] input').fill('Bosta');
  await expect(card.locator('[data-sm-rows] tr:visible')).toHaveCount(2); // the plugin on the site and the API
  await card.locator('[data-tq-row] input').fill('');
  // the e-mail's sheet: pause it a day → settings «integrations».paused.resend, then «كمّل»
  await pg.locator('[data-sm-node="mail"]').click();
  const sh = page.locator('[data-sm-sheet="mail"]');
  await expect(sh).toContainText('Resend');
  await expect(page.locator('[data-sm-node="mail"]')).toHaveAttribute('data-state', 'on');
  await sh.locator('[data-act="ask-pause"]').click();
  await sh.locator('[data-act="pause"][data-for="يوم"]').click();
  await expect(page.locator('[data-sm-node="mail"]')).toHaveAttribute('data-state', 'paused');
  const until = await page.evaluate(() => window.IBSettings.section('integrations').paused.resend);
  expect(Date.parse(until) - Date.now()).toBeGreaterThan(23 * 3600000); // a day from now, the same key «الربط بالمنصات» pauses
  await page.locator('[data-sm-sheet="mail"] [data-act="resume"]').click();
  await expect(page.locator('[data-sm-node="mail"]')).toHaveAttribute('data-state', 'on');
  expect(await page.evaluate(() => (window.IBSettings.section('integrations').paused || {}).resend)).toBeUndefined();
  await page.keyboard.press('Escape'); await expect(page.locator('.sm-scrim')).toHaveCount(0);
  // «رجوع» → the AI page
  await pg.locator('[data-sm-back]').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#ai');
  await expect(page.locator('#pg-ai [data-ai-brain]')).toBeVisible();
});

test('«العقل الذكي» for the whole team (Safwat 24 Nov — «يظهر لكل الفريق بس الادمن بس اللي يقدر يعدل الباقي مشاهدة»): a member sees the same map from the one read (settings-admin «map»), a group\'s sheet without «إيقاف مؤقت» / the links / the swap, no «افحص بلاجنز الموقع»', async ({ page }) => {
  await signIn(page, 'ops.dev@ibtekr.local');
  await page.evaluate(() => { location.hash = 'brain'; });
  const pg = page.locator('#pg-brain [data-sysmap]');
  await expect(pg.locator('h1')).toHaveText('العقل الذكي');
  await expect(pg.locator('[data-sm-node]')).toHaveCount(11);
  await expect(pg.locator('[data-sm-node="mail"]')).toHaveAttribute('data-state', 'on'); // the e-mail's key read as linked through «map»
  await expect(pg.locator('[data-sm-check]')).toHaveCount(0);
  await pg.locator('[data-sm-node="mail"]').click();
  const sh = page.locator('[data-sm-sheet="mail"]');
  await expect(sh.locator('[data-sm-view]')).toContainText('للأدمن');
  await expect(sh.locator('[data-act="ask-pause"], [data-act="link"], [data-act="swap"], [data-act="resume"]')).toHaveCount(0);
  expect(mock.st.calls.filter((c) => c.fn === 'settings-admin').map((c) => c.action)).toEqual(expect.arrayContaining(['map']));
  expect(mock.st.calls.some((c) => c.fn === 'settings-admin' && c.action === 'status')).toBe(false);
});
