import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner 22 Nov («يبقوا اذكية كفاية من غير مخ خارجي … و يديوني معلومات حقيقة ١٠٠٪ و لو احتاجوا مخ خارجي يسالوني و كل واحد متخصص في
// الحتة بتاعتوا» · «المدير العام … يوجهة المستخدم للموظف الصح»): an assistant's chat answers from the system first — a number of its
// speciality as the server counted it, another assistant's handed over, a money entry as the system's popup — each kept in the
// chat and marked «من السيستم». What the system does not take waits for the member's choice of an outside company, which gets
// the message alone; the data kinds it wants are asked about. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { agentRules: true, tickets: [{ id: 1, type: 'internal', title: 'عاجل', description: '', priority: 'urgent', assignee_role: 'مدير النظام', status: 'open' }] });
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-' + 'a'.repeat(40) }); mock.st.vault.openai = JSON.stringify({ key: 'sk-' + 'o'.repeat(40) });
  mock.mkt.siteChecks = [{ kind: 'pagespeed', checked_at: new Date().toISOString(), data: { score: 41 } }, { kind: 'wp_updates', checked_at: new Date().toISOString(), data: { updates: 0 } }];
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const pg = (page) => page.locator('#pg-ai');
async function openAi(page, tab) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="ai"]').click(); await expect(pg(page)).toBeVisible();
  await pg(page).getByRole('tab', { name: new RegExp(tab) }).click(); await expect(pg(page).locator('#mk-ask')).toBeVisible();
}
const send = async (page, text) => { await pg(page).locator('#mk-ask').fill(text); await pg(page).locator('[data-mk-ask]').click(); };
const lastAns = (page) => pg(page).locator('.mk-msg.ai[data-mk-turn]').last();
const asks = () => mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.action === 'agent');

test('a number of its speciality is answered by the system — no model called, the answer kept in the chat and marked; a status ask lists what it watches', async ({ page }) => {
  await openAi(page, 'المبرمج');
  await send(page, 'إيه سرعة الموقع دلوقتي؟');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('من السيستم'); await expect(lastAns(page)).toContainText('درجة سرعة الموقع على الموبايل: 41 من 100.');
  await expect(lastAns(page)).toContainText('القاعدة متحققة: درجة سرعة الموقع على الموبايل — 50 من 100 أو أقل.'); await expect(lastAns(page)).toContainText('آخر تحديث:');
  expect(asks().length).toBe(0); expect(mock.mkt.agentMsgs.map((m) => [m.role, m.source])).toEqual([['user', 'system'], ['assistant', 'system']]);
  await send(page, 'إيه الأخبار؟'); await expect(lastAns(page)).toContainText('الأرقام اللي براقبها دلوقتي:'); await expect(lastAns(page)).toContainText('⚠ درجة سرعة الموقع على الموبايل: 41 من 100'); await expect(lastAns(page)).toContainText('• تحديثات ووردبريس مستنية: 0');
  expect(asks().length).toBe(0); expect(mock.mkt.agentChats.length).toBe(1);
  // opened again later: the turns come back from the server with their source
  await page.reload(); await expect(page.locator('#root')).toBeVisible(); await page.locator('.sidebar .nav-item[data-page="ai"]').click(); await pg(page).getByRole('tab', { name: /المبرمج/ }).click();
  await pg(page).locator('[data-mk-chat-item]').first().locator('.mk-agent-open').click(); await expect(pg(page).locator('.mk-msg.ai[data-mk-turn] [data-mk-src]')).toHaveText(['من السيستم', 'من السيستم']);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'mkt.agent.system').map((a) => a.new_value)).toEqual(['dev', 'dev']);
});

test('another assistant’s number is handed over: «روح لـ…» opens its chat with the question in the box; a money entry is the system’s popup filled', async ({ page }) => {
  await openAi(page, 'المبرمج');
  mock.acc.dokan_withdrawals.push({ id: 501, woo_vendor_id: 1, vendor_id: null, amount: 900, charge: 0, receivable: 900, status: 'pending', method: 'bank', requested_at: '2026-11-21 12:00:00', synced_at: new Date().toISOString() });
  await send(page, 'في طلبات سحب مستنية؟');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('من السيستم'); await expect(lastAns(page)).toContainText('ده تخصص «المحاسب الذكي»');
  expect(asks().length).toBe(0); await lastAns(page).locator('[data-mk-handoff-go]').click();
  // the accountant's chat with the question in its box — sent by the member, answered by the system from its own number
  await expect(pg(page).locator('#mk-ask')).toHaveValue('في طلبات سحب مستنية؟'); await pg(page).locator('[data-mk-ask]').click();
  await expect(lastAns(page)).toContainText('طلبات سحب مستنية الموافقة: 1.'); await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('من السيستم');
  // an expense said whole → the accounts page's own popup, filled, behind a button — nothing written
  await send(page, 'سجل سحب مرتبات 5000');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('من السيستم'); await expect(lastAns(page).locator('[data-mk-form="expense_add"]')).toBeVisible();
  expect(asks().length).toBe(0); expect(mock.acc.acc_expenses.length).toBe(0);
  await lastAns(page).locator('[data-mk-form="expense_add"]').click(); await expect(page.locator('.modal')).toContainText('سحب مصروفات'); await expect(page.locator('.modal')).toContainText('المرتبات');
  await expect.poll(() => page.locator('.modal input').evaluateAll((els) => els.map((e) => e.value))).toContain('5000'); expect(mock.acc.acc_expenses.length).toBe(0);
});

test('what the system does not take waits for the member: a button per linked company and «لا»; the company gets the message alone, the data kinds are asked about, and the answer says who it is from and what was sent', async ({ page }) => {
  mock.mkt.agentAnswer = (req) => (/كابشن/.test(req.question) ? { text: 'كابشن: معمولة بالإيد.' } : { text: 'التأخير سببه مبتكر واحد.', reads: ['orders', 'vendors'] });
  await openAi(page, 'التشغيل');
  await send(page, 'حلل ليه الأوردرات بتتأخر');
  const card = pg(page).locator('[data-mk-consent]'); await expect(card).toContainText('مش فاهم الطلب ده من السيستم. أستخدم مخ خارجي؟ اختار أنهي واحد:'); await expect(card.locator('[data-mk-brain]')).toHaveText(['Claude', 'ChatGPT', 'لا']);
  expect(asks().length).toBe(0); expect(mock.mkt.agentMsgs.length).toBe(0);
  // «لا»: nothing is called; the chat keeps the question and the system's line
  await card.locator('[data-mk-brain=""]').click(); await expect(lastAns(page)).toContainText('تمام، ما استخدمتش مخ خارجي.'); expect(asks().length).toBe(0);
  // ChatGPT: the message alone first — it wants the orders and the makers
  await send(page, 'حلل ليه الأوردرات بتتأخر'); await pg(page).locator('[data-mk-consent] [data-mk-brain="openai"]').click();
  const need = pg(page).locator('[data-mk-need]'); await expect(need).toHaveAttribute('data-mk-need', 'orders vendors'); await expect(need).toContainText('عشان يكمّل، ChatGPT محتاج يشوف البيانات دي من السيستم. أوافق؟');
  await expect(need.locator('[data-mk-need-kind="vendors"]')).toContainText('من غير الحسابات البنكية ونسب العمولة');
  expect(asks().length).toBe(1); expect(asks()[0].provider).toBe('openai'); expect(asks()[0].share).toEqual([]); expect(mock.mkt.agentMsgs.filter((m) => m.source === 'openai').length).toBe(0);
  // refused: nothing more is sent
  await need.locator('[data-mk-share-no]').click(); await expect(lastAns(page)).toContainText('تمام، مااتبعتش أي بيانات لـ ChatGPT.'); expect(asks().length).toBe(1);
  // approved: the same message with the kinds; the answer names its company and what was sent
  await send(page, 'حلل ليه الأوردرات بتتأخر'); await pg(page).locator('[data-mk-consent] [data-mk-brain="openai"]').click(); await pg(page).locator('[data-mk-share-ok]').click();
  await expect(lastAns(page)).toContainText('التأخير سببه مبتكر واحد.'); await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('الرد من ChatGPT');
  await expect(lastAns(page).locator('[data-mk-shared]')).toHaveText('اتبعتله: رسالتك + الأوردرات · المبتكرين'); expect(asks().at(-1).share).toEqual(['orders', 'vendors']);
  expect(asks().at(-1).history, 'the system’s own lines in this chat are not passed on').toBe(0);
  // words alone: no data card
  await send(page, 'اكتبلي كابشن لمنتج جديد'); await pg(page).locator('[data-mk-consent] [data-mk-brain="claude"]').click();
  await expect(lastAns(page)).toContainText('كابشن: معمولة بالإيد.'); await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('الرد من Claude'); expect(asks().at(-1).history, 'nor another company’s answer').toBe(0); await expect(lastAns(page).locator('[data-mk-shared]')).toHaveText('اتبعتله: رسالتك بس — من غير بيانات من السيستم');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'mkt.agent.share').map((a) => a.new_value)).toEqual(['stock · openai · orders, vendors']);
});

test('the general manager: where every assistant stands, from the system; no company linked → the chat says so and calls nothing', async ({ page }) => {
  mock.mkt.aiAgents.unshift({ id: 'manager', name: 'المدير العام', icon: 'sliders', perm: 'tickets.view', sees: ['orders', 'tickets'], role: 'مدير النظام', builtin: true, about: '', intro: '', instructions: '', suggestions: [], sort: 5, archived_at: null });
  delete mock.st.vault.anthropic; delete mock.st.vault.openai;
  await openAi(page, 'المدير العام');
  await send(page, 'ملخص الوضع النهارده');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('من السيستم'); await expect(lastAns(page)).toContainText('الوضع دلوقتي عند كل مساعد:'); await expect(lastAns(page)).toContainText('⚠ المدير العام: طلبات عاجلة مفتوحة (1)'); await expect(lastAns(page)).toContainText('⚠ المبرمج الذكي: درجة سرعة الموقع على الموبايل (41 من 100)');
  await send(page, 'اقترح خطة للأسبوع الجاي'); await expect(lastAns(page)).toContainText('مش فاهم الطلب ده من السيستم، ومفيش مخ خارجي مربوط أسأله'); await expect(pg(page).locator('[data-mk-consent]')).toHaveCount(0);
  expect(asks().length).toBe(0);
});
