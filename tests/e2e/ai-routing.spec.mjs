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
// the companies linked for a test (the fake Vault of settings-mock.mjs — a key never comes back, its tail only)
const KEYS = { anthropic: 'sk-ant-' + 'a'.repeat(40), openai: 'sk-' + 'o'.repeat(40), gemini: 'g'.repeat(32) };
const link = (...names) => { for (const n of names) mock.st.vault[n] = JSON.stringify({ key: KEYS[n] }); };
const aiRow = () => ((mock.settings.find((x) => x.section === 'ai') || {}).data || {});
const pick = async (page, id, label) => { await page.locator('#' + id).click(); await page.getByRole('option', { name: label }).click(); };

test('the routing card: three levels with their prices, every command on its level by itself; a command moved is saved and marked; «رجّع الترشيح»; the switch off locks it on one model', async ({ page }) => {
  link('anthropic');
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const card = page.locator('[data-ai-routing]');
  await expect(card).toHaveAttribute('data-ai-routing', 'auto'); // by itself: nothing saved yet
  expect(aiRow().routing).toBeUndefined();
  await expect(card.locator('[data-air-tiers] [data-air-tier] b')).toHaveText(['ضعيف', 'متوسط', 'قوي']);
  await expect(card).toContainText('أنهي موديل لأنهي أمر (Claude)');
  await expect(card.locator('[data-air-tiers]')).toContainText('Claude Haiku 5.5'); await expect(card.locator('[data-air-tiers]')).toContainText('$0.10 دخل · $0.50 خرج');
  await expect(card.locator('[data-air-tiers]')).toContainText('$2 دخل · $10 خرج'); await expect(card.locator('[data-air-tiers]')).toContainText('$4 دخل · $20 خرج');
  await expect(card.locator('[data-air-cmd]')).toHaveCount(14);
  const tiers = await card.locator('[data-air-cmd]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-air-cmd'), e.getAttribute('data-air-tier')])));
  expect(tiers).toEqual({ filter: 'light', rewrite: 'light', translate: 'light', kb: 'light', write: 'mid', studio: 'mid', prompts: 'mid', marketing: 'mid', scenes: 'mid', agent: 'mid', assistant: 'heavy', extract: 'heavy', buyer: 'heavy', research: 'heavy' });
  // the free chats are sized by the message: no level of their own until the admin gives one
  await expect(card.locator('[data-air-sized="true"]')).toHaveCount(2);
  await expect(card.locator('[data-air-cmd="assistant"]')).toContainText('حسب حجم الرسالة'); await expect(card.locator('[data-air-cmd="agent"]')).toContainText('الموديل الضعيف بيقرا الرسالة الأول');
  await expect(card).toContainText('المبرمج الذكي'); // a new model or price reaches the bell through the developer
  await expect(card.getByRole('button', { name: 'رجّع الترشيح' })).toHaveCount(0);
  // the web search is not offered on the light model
  await page.locator('#air-research').click();
  await expect(page.getByRole('option')).toHaveCount(2); await page.keyboard.press('Escape');
  // move «وصف المنتج» up: saved at once as the one difference from the recommendation, the row marked
  await pick(page, 'air-write', /قوي/);
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
  // a chat pinned to its own fallback level is kept («always the strong model»), and «حسب حجم الرسالة» takes it back
  await pick(page, 'air-assistant', /قوي/);
  await expect.poll(() => (aiRow().routing || {}).tiers).toEqual({ assistant: 'heavy' });
  await expect(card.locator('[data-air-cmd="assistant"]')).toHaveClass(/moved/); await expect(card.locator('[data-air-sized="true"]')).toHaveCount(1);
  await pick(page, 'air-assistant', /حسب حجم الرسالة/);
  await expect.poll(() => aiRow().routing).toBeUndefined();
  // the switch in the providers card off: the commands are locked, the model is picked under the company — the light one too
  const pk = page.locator('[data-prov="text"] [data-air-pick]');
  await expect(pk).toHaveAttribute('data-air-pick', 'auto'); await expect(page.locator('#air-one')).toHaveCount(0);
  await expect(pk.locator('[data-air-level]')).toHaveText(['ضعيف Claude Haiku 5.5', 'متوسط Claude Sonnet 5.5', 'قوي Claude Opus 5.5']);
  await page.locator('#air-auto').click();
  await expect.poll(() => (aiRow().routing || {}).mode).toBe('single');
  await expect(card).toHaveAttribute('data-ai-routing', 'single'); await expect(card).toContainText('البسيط بيتحاسب زي التقيل');
  await expect(pk).toHaveAttribute('data-air-pick', 'single'); await expect(pk.locator('[data-air-level]')).toHaveCount(0);
  await expect(page.locator('#air-one')).toBeVisible(); await expect(page.locator('#air-write')).toBeDisabled();
  await page.locator('#air-one').click(); await expect(page.getByRole('option')).toHaveCount(3); await page.keyboard.press('Escape');
  await pick(page, 'air-one', /Haiku/);
  await expect.poll(() => aiRow().model).toBe('claude-haiku-5-5');
  await expect(card).toContainText('كل الأوامر شغّالة على Claude Haiku 5.5');
  await page.locator('#air-auto').click();
  await expect.poll(() => aiRow().routing).toBeUndefined();
  await expect(page.locator('#air-write')).toBeEnabled();
  // (the log row of a save is written after it — the last one is waited for)
  await expect.poll(() => mock.activity.filter((r) => r.action === 'settings.ai.routing').map((r) => r.new_value))
    .toEqual(expect.arrayContaining(['write=heavy', 'recommended', 'assistant=heavy', 'assistant=size', 'one model', 'model=claude-haiku-5-5', 'auto']));
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

// The owner 22 Nov (decisions 8–12 — «متظهرش في اختيار المزودين الشركات لو مش مربوطة … تجيب بس الشغال»، «لو تلقائي بختار الشركة بس …
// لو مقفول بختار الشركة و بعديها تظهرلي خانة اختار منها الموديل»)
test('the providers: only the linked, working companies are offered (the chosen one stays, marked); another company brings its own levels and models; an unlinked section says so', async ({ page }) => {
  link('anthropic');
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const text = page.locator('[data-prov="text"]');
  await expect(text).toHaveAttribute('data-prov-live', 'claude');
  await page.locator('#prov-text').click();
  await expect(page.getByRole('option')).toHaveText(['Claude (Anthropic)']); await page.keyboard.press('Escape');
  await page.locator('#prov-text-products').click();
  await expect(page.getByRole('option')).toHaveText(['الافتراضي للقسم', 'Claude (Anthropic)']); await page.keyboard.press('Escape');
  // nothing of the images is linked in this test: the chosen one alone, marked, with the way out
  await page.locator('#prov-image').click();
  await expect(page.getByRole('option')).toHaveText(['Magnific (كريدت) — مش مربوط']); await page.keyboard.press('Escape');
  await expect(page.locator('[data-prov="image"]')).toContainText('المزوّد ده مش مربوط');
  await expect(text).not.toContainText('المزوّد ده مش مربوط');
  // ChatGPT linked from «الربط بالمنصات»: it joins the lists; chosen, the levels and the card are its own
  link('openai');
  await page.reload(); await expect(page.locator('#root')).toBeVisible(); await page.evaluate(() => { location.hash = 'settings-ai'; });
  await expect(text).toHaveAttribute('data-prov-live', 'claude openai');
  await pick(page, 'prov-text', 'ChatGPT (OpenAI)');
  await expect.poll(() => ((aiRow().providers || {}).text || {}).default).toBe('openai');
  const pk = text.locator('[data-air-pick]');
  await expect(pk).toHaveAttribute('data-air-provider', 'openai');
  await expect(pk.locator('[data-air-level]')).toHaveText(['ضعيف GPT-5.2 mini', 'متوسط GPT-5.2', 'قوي GPT-5.2']);
  const card = page.locator('[data-ai-routing]');
  await expect(card).toContainText('أنهي موديل لأنهي أمر (ChatGPT)'); await expect(card.locator('[data-air-tiers]')).toContainText('$0.25 دخل · $2 خرج');
  await expect(card).toContainText('بيشتغلوا على Claude دايمًا'); await expect(card.locator('[data-air-cmd="assistant"]')).toContainText('بيشتغل على Claude دايمًا');
  // off: ChatGPT's two models under it; the choice is the company's own entry, Claude's model untouched
  await page.locator('#air-auto').click();
  await expect.poll(() => (aiRow().routing || {}).mode).toBe('single');
  await expect(text.locator('[data-air-pick]')).toHaveAttribute('data-air-pick', 'single');
  // (the page draws once more after the save — the list is opened until it stays)
  await expect(async () => { await page.keyboard.press('Escape'); await page.locator('#air-one').click(); await expect(page.getByRole('option')).toHaveText(['GPT-5.2 — متوسط وقوي', 'GPT-5.2 mini — ضعيف'], { timeout: 1000 }); await page.getByRole('option', { name: /mini/ }).click({ timeout: 1500 }); }).toPass();
  await expect.poll(() => (((aiRow().providers || {}).text || {}).models || {}).openai).toBe('gpt-5.2-mini');
  expect(aiRow().model).toBeUndefined();
  expect(JSON.stringify(mock.activity)).not.toContain(KEYS.openai);
});
