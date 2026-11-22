import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner 22 Nov (docs/superpowers/plans/2026-11-22-model-routing.md — «يبقا مكتوب في التعليمات احسن طريقة تخليني استخدم الكريديت صح
// يعني امتا يستخدم كل موديل و في اي امر»): the card «أنهي موديل لأنهي أمر» under «الإعدادات › الذكاء الاصطناعي › المزوّدين» — the three
// levels with their model and price, every command on its recommended level by itself, a command moved by the admin, one model
// for everything, and this month's spend by model and by kind of work. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const aiRow = () => ((mock.settings.find((x) => x.section === 'ai') || {}).data || {});
const pick = async (page, id, label) => { await page.locator('#' + id).click(); await page.getByRole('option', { name: label }).click(); };

test('the routing card: three levels with their prices, every command on its level by itself; a command moved is saved and marked; «رجّع الترشيح»; one model for everything', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const card = page.locator('[data-ai-routing]');
  await expect(card).toHaveAttribute('data-ai-routing', 'auto'); // by itself: nothing saved yet
  expect(aiRow().routing).toBeUndefined();
  await expect(card.locator('[data-air-tier] b')).toHaveText(['خفيف', 'متوسط', 'تقيل']);
  await expect(card.locator('[data-air-tiers]')).toContainText('Claude Haiku 5.5'); await expect(card.locator('[data-air-tiers]')).toContainText('$0.10 دخل · $0.50 خرج');
  await expect(card.locator('[data-air-tiers]')).toContainText('$2 دخل · $10 خرج'); await expect(card.locator('[data-air-tiers]')).toContainText('$4 دخل · $20 خرج');
  await expect(card.locator('[data-air-cmd]')).toHaveCount(14);
  const tiers = await card.locator('[data-air-cmd]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-air-cmd'), e.getAttribute('data-air-tier')])));
  expect(tiers).toEqual({ filter: 'light', rewrite: 'light', translate: 'light', kb: 'light', write: 'mid', studio: 'mid', prompts: 'mid', marketing: 'mid', scenes: 'mid', agent: 'mid', assistant: 'heavy', extract: 'heavy', buyer: 'heavy', research: 'heavy' });
  await expect(card).toContainText('المبرمج الذكي'); // a new model or price reaches the bell through the developer
  await expect(card.getByRole('button', { name: 'رجّع الترشيح' })).toHaveCount(0);
  // the web search is not offered on the light model
  await page.locator('#air-research').click();
  await expect(page.getByRole('option')).toHaveCount(2); await page.keyboard.press('Escape');
  // move «وصف المنتج» up: saved at once as the one difference from the recommendation, the row marked
  await pick(page, 'air-write', /تقيل/);
  await expect.poll(() => aiRow().routing).toEqual({ mode: 'auto', tiers: { write: 'heavy' } });
  await expect(card.locator('[data-air-cmd="write"]')).toHaveAttribute('data-air-tier', 'heavy');
  await expect(card.locator('[data-air-cmd="write"]')).toHaveClass(/moved/); await expect(card.locator('[data-air-cmd="write"]')).toContainText('الترشيح: متوسط');
  // back to its recommendation by hand = nothing kept in the row
  await pick(page, 'air-write', /متوسط/);
  await expect.poll(() => aiRow().routing).toBeUndefined();
  // two moved, then «رجّع الترشيح»
  await pick(page, 'air-filter', /متوسط/); await expect.poll(() => (aiRow().routing || {}).tiers).toEqual({ filter: 'mid' });
  await pick(page, 'air-buyer', /متوسط/); await expect.poll(() => (aiRow().routing || {}).tiers).toEqual({ filter: 'mid', buyer: 'mid' });
  await card.getByRole('button', { name: 'رجّع الترشيح' }).click();
  await page.locator('.modal[role=dialog]').getByRole('button', { name: 'رجّع', exact: true }).click();
  await expect.poll(() => aiRow().routing).toBeUndefined();
  await expect(card.locator('[data-air-cmd].moved')).toHaveCount(0);
  // one model for everything: the commands are locked, the one model is picked
  await card.getByRole('radio', { name: 'موديل واحد للكل' }).click();
  await expect.poll(() => (aiRow().routing || {}).mode).toBe('single');
  await expect(card).toHaveAttribute('data-ai-routing', 'single'); await expect(card).toContainText('البسيط بيتحاسب زي التقيل');
  await expect(page.locator('#air-one')).toBeVisible(); await expect(page.locator('#air-write')).toBeDisabled();
  await pick(page, 'air-one', /Sonnet/);
  await expect.poll(() => aiRow().model).toBe('claude-sonnet-5-5');
  await card.getByRole('radio', { name: /تلقائي/ }).click();
  await expect.poll(() => aiRow().routing).toBeUndefined();
  await expect(page.locator('#air-write')).toBeEnabled();
  const logged = mock.activity.filter((r) => r.action === 'settings.ai.routing').map((r) => r.new_value);
  expect(logged).toEqual(expect.arrayContaining(['write=heavy', 'recommended', 'one model', 'auto']));
});

test('this month\'s spend: by model and by kind of work, the images left out; a member who is not the admin has no spend card', async ({ page }) => {
  const now = new Date().toISOString(); const run = (o) => ({ id: mock.aiRuns.length + 1, created_at: now, created_by: 'x', status: 'ok', credits: 0, ...o });
  mock.aiRuns.push(run({ action: 'assistant', source: 'chat', model: 'claude-opus-5-5', cost_usd: 0.6 }), run({ action: 'assistant', source: 'filter', model: 'claude-haiku-5-5', cost_usd: 0.001 }),
    run({ action: 'write', source: 'data', model: 'claude-sonnet-5-5', cost_usd: 0.2 }), run({ action: 'write', source: 'product', model: 'claude-sonnet-5-5', cost_usd: 0.1 }),
    run({ action: 'marketing', source: 'agent', model: 'claude-sonnet-5-5', cost_usd: 0.099 }), run({ action: 'image', source: 'tool', model: 'seedream', cost_usd: 0, credits: 50 }),
    run({ action: 'write', source: 'data', model: 'claude-sonnet-5-5', cost_usd: 0.5, status: 'cap' }));
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const spend = page.locator('[data-air-spend]');
  await expect(spend).toBeVisible();
  const tables = spend.locator('table');
  await expect(tables.nth(0).locator('tbody tr')).toHaveCount(3);
  await expect(tables.nth(0).locator('tbody tr').nth(0)).toContainText(['Claude Opus 5.5', '1', '$0.60', '60%'].join(''));
  await expect(tables.nth(0).locator('tbody tr').nth(1)).toContainText('Claude Sonnet 5.5'); await expect(tables.nth(0).locator('tbody tr').nth(1)).toContainText('$0.399');
  await expect(tables.nth(0).locator('tbody tr').nth(2)).toContainText('Claude Haiku 5.5');
  await expect(tables.nth(1).locator('tbody tr td:first-child')).toHaveText(['المدير (الهيدر)', 'وصف المنتج', 'شات المساعدين', 'فلتر الأوردرات']);
  await expect(page.locator('#pg-settings')).toContainText('الإجمالي $1.00 في 5 نداء');
});
