import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Safwat 24 Nov — the media buyer's brain (docs/superpowers/plans/2026-11-24-buyer-brain.md): its chat answers «أحسن كامبين» /
// «أحسن كريتيف» / «أوقف إيه» from the page's own Meta numbers with no model; «حلّل المنافس» writes the competitor's brief with its
// sources; the admin's «أرقام الإعلانات بتتبعت من غير ما يسألني» in the buyer's settings tab. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
const cairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  const today = cairo(); const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addD(today, -i));
  const stats = [];
  days.forEach((day) => {
    stats.push({ level: 'campaign', object_id: '9001', campaign_id: '9001', day, spend: 300, impressions: 15000, clicks: 300, link_clicks: 300, frequency: 1.5, purchases: 3, purchase_value: 2000 });
    stats.push({ level: 'campaign', object_id: '9002', campaign_id: '9002', day, spend: 200, impressions: 9000, clicks: 60, link_clicks: 60, frequency: 2.2, purchases: 0, purchase_value: 0 });
    stats.push({ level: 'ad', object_id: '7001', campaign_id: '9001', day, spend: 200, impressions: 9000, clicks: 240, link_clicks: 240, frequency: 1.4, purchases: 3, purchase_value: 2000 });
    stats.push({ level: 'ad', object_id: '7002', campaign_id: '9002', day, spend: 200, impressions: 9000, clicks: 60, link_clicks: 60, frequency: 2.2, purchases: 0, purchase_value: 0 });
  });
  mock = await installSupabaseMock(page, {
    mktAdObjects: [{ kind: 'campaign', id: '9001', name: 'كولكشن الشتا', status: 'ACTIVE' }, { kind: 'campaign', id: '9002', name: 'الأباجورات', status: 'ACTIVE' },
      { kind: 'ad', id: '7001', parent_id: '9001', name: 'ريل الإيد وهي بتشتغل', status: 'ACTIVE' }, { kind: 'ad', id: '7002', parent_id: '9002', name: 'صورة الأباجورة', status: 'ACTIVE' }],
    mktAdStats: stats,
    mktAdOrders: [{ day: days[1], platform: 'meta', source: 'facebook', campaign: '9001', grp: 'completed', orders: 10, sales: 8000, share: 1600 }, { day: days[1], platform: 'meta', source: 'facebook', campaign: '9001', grp: 'cancelled', orders: 5, sales: 99999, share: 0 }],
    mktCompetitors: [{ name: 'ورشة المنافس', keyword: 'مكرمية', note: 'ريل الهدايا شغال من شهرين' }],
  });
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-' + 'a'.repeat(40) }); // a linked outside AI: the system asks before using it
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const pg = (page) => page.locator('#pg-ai');
async function openBuyer(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="ai"]').click(); await expect(pg(page)).toBeVisible();
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click(); await expect(pg(page).getByRole('tab', { name: /الميديا باير/, selected: true })).toBeVisible();
  await expect(pg(page).locator('#mk-ask')).toBeVisible();
}
const send = async (page, text) => { await pg(page).locator('#mk-ask').fill(text); await pg(page).locator('[data-mk-ask]').click(); };
const lastAns = (page) => pg(page).locator('.mk-msg.ai[data-mk-turn]').last();
const asks = () => mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.action === 'agent');

test('the buyer\'s chat: the best campaign, the best creatives, what to stop — from the system, with the real return, no model called', async ({ page }) => {
  await openBuyer(page);
  await send(page, 'إيه أحسن كامبين شغالة؟');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('الميديا باير الذكي');
  await expect(lastAns(page)).toContainText('أحسن حملة شغّالة'); await expect(lastAns(page)).toContainText('كولكشن الشتا');
  await expect(lastAns(page)).toContainText('العائد الحقيقي 3.81×'); // 8,000 ÷ 2,100 — the cancelled orders out
  await expect(lastAns(page)).toContainText('كسبان');
  await send(page, 'أحسن كريتيف عندي إيه؟');
  await expect(lastAns(page)).toContainText('أحسن كريتيفز'); await expect(lastAns(page)).toContainText('ريل الإيد وهي بتشتغل'); await expect(lastAns(page)).toContainText('utm_content');
  await send(page, 'أوقف أنهي حملة؟');
  await expect(lastAns(page)).toContainText('الأباجورات'); await expect(lastAns(page)).toContainText('بيخسر'); await expect(lastAns(page)).toContainText('بموافقتك');
  expect(asks().length).toBe(0); // no outside model
  // a why is a model's: the system asks before any outside company
  await send(page, 'ليه الإعلان ده باع أكتر؟');
  await expect(pg(page).locator('[data-mk-consent]')).toBeVisible();
});

test('«حلّل المنافس»: the brief and its sources on the competitor\'s card', async ({ page }) => {
  await openBuyer(page);
  const card = pg(page).locator('[data-mk-comp]').first(); await card.scrollIntoViewIfNeeded();
  await card.locator('[data-mk-comp-brief]').click();
  await expect(card.locator('[data-mk-brief]')).toBeVisible();
  await expect(card.locator('[data-mk-brief]')).toContainText('من 300 لـ 900 ج.م');
  await expect(card.locator('.mk-cc-src a')).toHaveAttribute('href', 'https://rival.example/shop');
  await expect(card.locator('[data-mk-comp-brief]')).toHaveText('حدّث التحليل');
  expect(mock.mkt.calls.filter((c) => c.action === 'competitor_brief').length).toBe(1);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'mkt.competitor.brief').length).toBe(1);
});

test('the admin\'s switch «أرقام الإعلانات بتتبعت من غير ما يسألني» in the buyer\'s settings tab (agents.buyer.adsAlways)', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  await page.locator('#pg-settings').getByRole('tab', { name: 'المساعدين' }).click();
  await page.locator('[data-ag-tab="buyer"]').click();
  const sw = page.locator('#ag-ads-always');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect.poll(() => { const r = (mock.settings || []).find((x) => x.section === 'ai'); return r && r.data && r.data.agents && r.data.agents.buyer && r.data.agents.buyer.adsAlways; }).toBe(true);
  await expect(page.locator('#ag-ads-always')).toHaveAttribute('aria-checked', 'true');
  // another assistant has no such switch
  await page.locator('[data-ag-tab="designer"]').click(); await expect(page.locator('#ag-ads-always')).toHaveCount(0);
});
