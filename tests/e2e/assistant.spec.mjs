import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The header's AI assistant (phase 12 T1, decision 8 in docs/superpowers/plans/2026-11-08-phase-12-followups.md): one ai-content
// `assistant` call a turn with the last turns and the screen context; the answer's text in the panel and its actions run through
// the page (a navigate / filter, a money entry as a confirm card that writes through IBAccounts only after the click); the AI not
// configured → the fixed commands; the monthly cap message; the activity row carries action names only. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, id) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForFunction(() => window.OrdersApp && typeof window.OrdersApp.apply === 'function');
}
const panel = (page) => page.locator('.ai-panel');
async function ask(page, text) { await page.fill('.ai-input', text); await page.locator('.ai-form').press('Enter'); }

test('a question: one assistant call with the turns and the screen; the answer shown, its navigate + filter actions run on the orders page; logged without the text', async ({ page }) => {
  mock.aiAnswer = (action, req) => (action === 'assistant' ? { text: 'فيه أوردر واحد متأخر. فتحتلك الأوردرات عليه.', actions: [{ name: 'filter_orders', input: { clear: true, deliv: 'late' } }], tools: ['summary', 'orders'] } : null);
  await signIn(page, OPS);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.ai-msg.ai').first()).toContainText('أهلاً يا سارة');
  await expect(panel(page).locator('.ai-note')).toContainText('محادثة مع Claude');
  await ask(page, 'كام أوردر متأخر؟');
  await expect(panel(page).locator('.ai-msg.ai').last()).toHaveText('فيه أوردر واحد متأخر. فتحتلك الأوردرات عليه.');
  const call = mock.aiCalls.find((c) => c.action === 'assistant');
  expect(call.mode).toBe('chat'); expect(call.turns).toEqual([{ role: 'user', text: 'كام أوردر متأخر؟' }]); expect(call.context.page).toBe('dashboard');
  await expect(page.locator('#orders')).toBeVisible();
  await expect(page.locator('.sidebar .nav-item[data-page="orders"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#orders .afc-chip').filter({ hasText: 'متأخر' }).first()).toBeVisible();
  // the second turn carries the history
  mock.aiAnswer = () => ({ text: 'تمام.', actions: [] });
  await ask(page, 'وشكرًا');
  await expect(panel(page).locator('.ai-msg.ai').last()).toHaveText('تمام.');
  expect(mock.aiCalls.filter((c) => c.action === 'assistant').at(-1).turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
  expect(mock.aiRuns.map((r) => [r.action, r.source, r.status])).toEqual([['assistant', 'chat', 'ok'], ['assistant', 'chat', 'ok']]);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'assistant.chat').map((a) => a.new_value)).toEqual(['filter_orders · data: summary, orders', 'no action · no data']);
  expect(JSON.stringify(mock.activity)).not.toContain('متأخر');
});

test('propose_entry: the confirm card from the server\'s action; nothing is written until «تأكيد التسجيل», then IBAccounts writes the expense', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'عرضتلك كارت التأكيد لسحب 5,000 ج.م مرتبات — أكّد عشان تتسجل.', actions: [{ name: 'propose_entry', input: { kind: 'expense', direction: 'withdraw', amount: 5000, category: 'المرتبات' } }], tools: [] } : null);
  await signIn(page, ADMIN); // accounts.add = F: the confirmed entry reaches acc_expenses through IBAccounts
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'سجل سحب مرتبات 5000');
  await expect(panel(page).locator('.ai-msg.ai .kv').last()).toContainText('المرتبات');
  expect(mock.accWrites.length).toBe(0);
  await panel(page).getByRole('button', { name: 'تأكيد التسجيل' }).click();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_expenses', op: 'insert', direction: 'withdraw', category: 'المرتبات', amount: 5000 });
  await expect(panel(page).locator('.ai-msg.ai').last()).toContainText('اتسجّلت');
  await expect(page.locator('.sidebar .nav-item[data-page="accounts"]')).toHaveAttribute('aria-current', 'page');
});

test('the AI not configured → the fixed commands take over (the note says so) and still open pages; the monthly cap is said', async ({ page }) => {
  mock.aiFail = 'not_configured';
  await signIn(page, OPS);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'افتح الأوردرات');
  await expect(panel(page).locator('.ai-note')).toContainText('مش متظبط');
  await expect(panel(page).locator('.ai-msg.ai').last()).toHaveText('فتحت الأوردرات.');
  await expect(page.locator('.sidebar .nav-item[data-page="orders"]')).toHaveAttribute('aria-current', 'page');
  expect(mock.aiCalls.filter((c) => c.action === 'assistant').length).toBe(1);
  await ask(page, 'افتح الحسابات');
  await expect(page.locator('.sidebar .nav-item[data-page="accounts"]')).toHaveAttribute('aria-current', 'page');
  expect(mock.aiCalls.filter((c) => c.action === 'assistant').length, 'no second call once the AI is known to be off').toBe(1);
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  mock.aiFail = 'ai_cap';
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'كام أوردر؟');
  await expect(panel(page).locator('.ai-msg.ai').last()).toContainText('سقف الـ AI الشهري خلص');
});
