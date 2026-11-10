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

// phase 13 decision 23 (owner 10 Nov): the chat keeps a short summary; «تفاصيل» opens the data the assistant read as a report popup with
// «مشاركة» on WhatsApp / email; the panel is dragged by its header and resized from its corner, and every open from the AI button puts it
// back to the medium size right under the button.
test('decision 23: «تفاصيل» opens the read data as a report (chips + tables) shared on WhatsApp or email; the panel drags, resizes and reopens at the medium size under the button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const report = [{ kind: 'orders', data: { period: { from: '2026-11-01', to: '2026-11-10' }, total: 2, totalEgp: 1450, byStatus: { 'جاري التنفيذ': 1, 'قيد الشحن': 1 },
    rows: [{ id: 'x1', number: 180672, customer: 'ريهام صفوت', status: 'جاري التنفيذ', total: 757, delivery: 'late' }, { id: 'x2', number: 181668, customer: 'سلوى زيتوني', status: 'قيد الشحن', total: 693, delivery: 'ok' }] } }];
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'عندك أوردرين في الفترة، واحد منهم متأخر.', actions: [], tools: ['orders'], report } : null);
  await signIn(page, OPS);
  const btn = page.getByRole('button', { name: 'مساعد AI' });
  await btn.click();
  const P = panel(page);
  // opened under the AI button at the medium size, resizable from the corner
  const b0 = await btn.boundingBox(); let p0 = await P.boundingBox();
  expect(Math.abs(p0.y - (b0.y + b0.height + 8))).toBeLessThanOrEqual(2); expect(p0.width).toBeGreaterThan(380); expect(p0.width).toBeLessThanOrEqual(421);
  expect(await P.evaluate((el) => getComputedStyle(el).resize)).toBe('both');
  await ask(page, 'فيه أوردرات متأخرة؟');
  await expect(P.locator('.ai-msg.ai').last()).toContainText('عندك أوردرين في الفترة');
  await P.locator('[data-ai-details]').last().click();
  const r = page.locator('.modal[data-ai-report]');
  await expect(r).toBeVisible();
  await expect(r.locator('.modal-h')).toContainText('تقرير: فيه أوردرات متأخرة؟');
  await expect(r).toContainText('الفترة: 01/11/2026 – 10/11/2026');
  await expect(r.locator('.dt-chip', { hasText: 'العدد' })).toContainText('2');
  await expect(r.locator('th', { hasText: 'رقم الأوردر' })).toBeVisible();
  await expect(r.locator('td', { hasText: 'ريهام صفوت' })).toBeVisible();
  await expect(r.locator('td', { hasText: 'متأخر' })).toBeVisible(); // late → متأخر
  await expect(r.locator('td', { hasText: '180672' })).toBeVisible(); // an order number has no thousands comma
  await expect(r.locator('th', { hasText: 'القيمة (ج.م)' })).toBeVisible(); // a row's total is its amount
  await expect(r.locator('th', { hasText: /^id$/ })).toHaveCount(0);
  await r.getByRole('button', { name: 'مشاركة' }).click();
  await page.locator('[data-via="whatsapp"]').click();
  const shared = await page.evaluate(() => window.__lastShare);
  expect(shared.via).toBe('whatsapp'); expect(shared.href.startsWith('https://wa.me/')).toBe(true);
  expect(shared.text).toContain('فيه أوردرات متأخرة؟'); expect(shared.text).toContain('ريهام صفوت');
  await r.locator('.modal-f').getByRole('button', { name: 'إغلاق' }).click(); await expect(r).toBeHidden();
  // drag by the header: the panel moves with the pointer
  const head = P.locator('.ai-head'); const hb = await head.boundingBox();
  await page.mouse.move(hb.x + 120, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x - 200, hb.y + 200, { steps: 6 }); await page.mouse.up();
  const p1 = await P.boundingBox(); expect(Math.round(p1.y - p0.y)).toBeGreaterThan(150); expect(Math.round(p0.x - p1.x)).toBeGreaterThan(250);
  // a resize (as the corner handle would) then close and reopen from the button → back to the medium size under the button
  await P.evaluate((el) => { el.style.width = '640px'; el.style.height = '700px'; });
  await P.locator('.ai-head').getByRole('button', { name: 'إغلاق' }).click(); await expect(P).toBeHidden();
  await btn.click(); await expect(P).toBeVisible();
  p0 = await P.boundingBox(); expect(p0.width).toBeLessThanOrEqual(421); expect(Math.abs(p0.y - (b0.y + b0.height + 8))).toBeLessThanOrEqual(2);
  expect(JSON.stringify(mock.aiRuns.map((x) => x.output))).not.toContain('ريهام'); // the report never lands in ai_runs
});
