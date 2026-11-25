import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner 22 Nov («يبقوا اذكية كفاية من غير مخ خارجي … و يديوني معلومات حقيقة ١٠٠٪ و لو احتاجوا مخ خارجي يسالوني و كل واحد متخصص في
// الحتة بتاعتوا» · «المدير العام … يوجهة المستخدم للموظف الصح»): an assistant's chat answers from the system first — a number of its
// speciality as the server counted it, another assistant's handed over, a money entry as the system's popup — each kept in the
// chat and marked with the assistant's name (Safwat 25 Nov — «بدل من السيستم يبقا اسم المساعد»). What the system does not take waits for the member's choice of an outside company, which gets
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
  // the tab is drawn selected in the same render as its own box: the box of the tab before it is there already, and a message typed
  // into that one is the other assistant's draft (CI 1370 / 1372 on 23 Nov: the first message went nowhere)
  await pg(page).getByRole('tab', { name: new RegExp(tab) }).click(); await expect(pg(page).getByRole('tab', { name: new RegExp(tab), selected: true })).toBeVisible();
  await expect(pg(page).locator('#mk-ask')).toBeVisible();
}
const send = async (page, text) => { await pg(page).locator('#mk-ask').fill(text); await pg(page).locator('[data-mk-ask]').click(); };
const lastAns = (page) => pg(page).locator('.mk-msg.ai[data-mk-turn]').last();
const asks = () => mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.action === 'agent');

test('a number of its speciality is answered by the system — no model called, the answer kept in the chat and marked; a status ask lists what it watches', async ({ page }) => {
  await openAi(page, 'المبرمج');
  await send(page, 'إيه سرعة الموقع دلوقتي؟');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('المبرمج الذكي'); await expect(lastAns(page)).toContainText('درجة سرعة الموقع على الموبايل: 41 من 100.');
  await expect(lastAns(page)).toContainText('القاعدة متحققة: درجة سرعة الموقع على الموبايل — 50 من 100 أو أقل.'); await expect(lastAns(page)).toContainText('آخر تحديث:');
  expect(asks().length).toBe(0); expect(mock.mkt.agentMsgs.map((m) => [m.role, m.source])).toEqual([['user', 'system'], ['assistant', 'system']]);
  await send(page, 'إيه الأخبار؟'); await expect(lastAns(page)).toContainText('الأرقام اللي براقبها دلوقتي:'); await expect(lastAns(page)).toContainText('⚠ درجة سرعة الموقع على الموبايل: 41 من 100'); await expect(lastAns(page)).toContainText('• تحديثات ووردبريس مستنية: 0');
  expect(asks().length).toBe(0); expect(mock.mkt.agentChats.length).toBe(1);
  // opened again later: the turns come back from the server with their source
  await page.reload(); await expect(page.locator('#root')).toBeVisible(); await page.locator('.sidebar .nav-item[data-page="ai"]').click(); await pg(page).getByRole('tab', { name: /المبرمج/ }).click();
  await pg(page).locator('[data-mk-chat-item]').first().locator('.mk-agent-open').click(); await expect(pg(page).locator('.mk-msg.ai[data-mk-turn] [data-mk-src]')).toHaveText(['المبرمج الذكي', 'المبرمج الذكي']);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'mkt.agent.system').map((a) => a.new_value)).toEqual(['dev', 'dev']);
});

test('another assistant’s number is handed over: «روح لـ…» opens its chat, it greets the member by name and answers the request at once (Safwat 25 Nov); a money entry is the system’s popup filled', async ({ page }) => {
  await openAi(page, 'المبرمج');
  mock.acc.dokan_withdrawals.push({ id: 501, woo_vendor_id: 1, vendor_id: null, amount: 900, charge: 0, receivable: 900, status: 'pending', method: 'bank', requested_at: '2026-11-21 12:00:00', synced_at: new Date().toISOString() });
  await send(page, 'في طلبات سحب مستنية؟');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('المبرمج الذكي'); await expect(lastAns(page)).toContainText('ده تخصص «المحاسب الذكي»');
  expect(asks().length).toBe(0); await lastAns(page).locator('[data-mk-handoff-go]').click();
  // Safwat 25 Nov — «يكون بعتله الطلب و التاني يستقبلني اهلا يا "اسم المستخدم" عينيا حاضر و بيتدي يساعدني»: the accountant's chat greets
  // the member by name, the request is already sent, and the system answers it from its own number
  await expect(pg(page).locator('[data-mk-greet="accountant"]')).toHaveText(/^أهلا يا \S+، عينيا حاضر — «المبرمج الذكي» بعتلي طلبك وهبدأ فيه على طول\.$/);
  await expect(pg(page).locator('.mk-msg.user').last()).toHaveText('في طلبات سحب مستنية؟'); await expect(pg(page).locator('#mk-ask')).toHaveValue('');
  await expect(lastAns(page)).toContainText('طلبات سحب مستنية الموافقة: 1.'); await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('المحاسب الذكي');
  // an expense said whole → the accounts page's own popup, filled, behind a button — nothing written
  await send(page, 'سجل سحب مرتبات 5000');
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('المحاسب الذكي'); await expect(lastAns(page).locator('[data-mk-form="expense_add"]')).toBeVisible();
  expect(asks().length).toBe(0); expect(mock.acc.acc_expenses.length).toBe(0);
  await lastAns(page).locator('[data-mk-form="expense_add"]').click(); await expect(page.locator('.modal')).toContainText('سحب مصروفات'); await expect(page.locator('.modal')).toContainText('المرتبات');
  await expect.poll(() => page.locator('.modal input').evaluateAll((els) => els.map((e) => e.value))).toContain('5000'); expect(mock.acc.acc_expenses.length).toBe(0);
});

test('what the system does not take waits for the member: a button per linked company and «لا»; the company gets the message alone, the data kinds are asked about, and the answer says who it is from and what was sent', async ({ page }) => {
  mock.mkt.agentAnswer = (req) => (/كابشن/.test(req.question) ? { text: 'كابشن: معمولة بالإيد.' } : { text: 'التأخير سببه مبتكر واحد.', reads: ['orders', 'vendors'] });
  await openAi(page, 'التشغيل');
  await send(page, 'حلل ليه الأوردرات بتتأخر');
  const card = pg(page).locator('[data-mk-consent]'); await expect(card).toContainText('هحتاج مساعدة خارجية في ده. أستخدم أنهي واحد؟'); await expect(card.locator('[data-mk-brain]')).toHaveText(['Claude', 'ChatGPT', 'لا']);
  expect(asks().length).toBe(0); expect(mock.mkt.agentMsgs.length).toBe(0);
  // «لا»: nothing is called; the chat keeps the question and the system's line
  await card.locator('[data-mk-brain=""]').click(); await expect(lastAns(page)).toContainText('تمام، من غير مساعدة خارجية.'); expect(asks().length).toBe(0);
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
  await expect(lastAns(page).locator('[data-mk-src]')).toHaveText('المدير العام'); await expect(lastAns(page)).toContainText('الوضع دلوقتي عند كل مساعد:'); await expect(lastAns(page)).toContainText('⚠ المدير العام: طلبات عاجلة مفتوحة (1)'); await expect(lastAns(page)).toContainText('⚠ المبرمج الذكي: درجة سرعة الموقع على الموبايل (41 من 100)');
  await send(page, 'اقترح خطة للأسبوع الجاي'); await expect(lastAns(page)).toContainText('هحتاج مساعدة خارجية في ده، ومفيش مخ خارجي مربوط'); await expect(pg(page).locator('[data-mk-consent]')).toHaveCount(0);
  expect(asks().length).toBe(0);
});

// chat-flows phase 2 (Safwat 25 Nov — «في حالة طلب اي بيانات يقول بالرقم في الشات و يجيبلي لينك لبوب اب افتح فيه البيانات و اعملها
// مشاركة»): the number in the chat, «افتح التفاصيل» under it opens the rows behind it (read from the member's own pages), «مشاركة» and the page
test('a number from the system carries «افتح التفاصيل»: the rows behind it in a popup, «مشاركة» and its page; a status ask a link per number', async ({ page }) => {
  mock.mkt.aiAgents.unshift({ id: 'manager', name: 'المدير العام', icon: 'sliders', perm: 'tickets.view', sees: ['orders', 'tickets'], role: 'مدير النظام', builtin: true, about: '', intro: '', instructions: '', suggestions: [], sort: 5, archived_at: null });
  await openAi(page, 'المدير العام');
  await send(page, 'كام طلب عاجل مفتوح؟');
  await expect(lastAns(page)).toContainText('طلبات عاجلة مفتوحة: 1');
  const dets = pg(page).locator('[data-mk-dets]').last();
  await expect(dets.locator('[data-mk-det="tickets_urgent"]')).toHaveText('افتح التفاصيل'); await expect(dets.locator('[data-mk-det-go="tickets"]')).toBeVisible();
  await dets.locator('[data-mk-det="tickets_urgent"]').click();
  const pop = page.locator('.modal[data-ag-det="tickets_urgent"]'); await expect(pop).toBeVisible();
  await expect(pop.locator('.modal-h')).toContainText('الطلبات العاجلة المفتوحة');
  await expect(pop.locator('[data-ag-det-tbl] thead th')).toHaveText(['الرقم', 'العنوان', 'الأولوية', 'المسؤول', 'المتابعة']);
  await expect(pop.locator('[data-ag-det-tbl] tbody tr')).toHaveCount(1); await expect(pop.locator('[data-ag-det-tbl] tbody tr')).toContainText('عاجل');
  await pop.locator('[data-ag-det-share]').click(); await expect(page.locator('.modal', { hasText: 'Excel' }).last()).toBeVisible();
  expect(asks().length).toBe(0);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await expect(pop).toHaveCount(0);
  // a status ask: a link per number that holds
  await send(page, 'إيه الأخبار؟'); await expect(lastAns(page)).toContainText('الوضع دلوقتي عند كل مساعد:');
  await expect(pg(page).locator('[data-mk-dets]').last().locator('[data-mk-det="tickets_urgent"]')).toContainText('تفاصيل: طلبات عاجلة مفتوحة');
  expect(asks().length).toBe(0);
});

// chat-flows phase 3 (0171 — Safwat 25 Nov: «القايمتين حطهم بدل تقديم طلب يبقا فيه طلبات جاهزة و تقارير جاهزة»): the header's
// «تقديم طلب» is a menu — the old popup first; the admin adds a ready report (element › type › state rows, the ones with a list only)
// and a ready request; the report opens the member's own rows a chip per element with «مشاركة», the request the popup filled
test('«طلبات وتقارير»: the admin adds a ready report and a ready request; the report a table per element with «مشاركة», the request the popup filled', async ({ page }) => {
  mock.mkt.aiAgents.unshift({ id: 'manager', name: 'المدير العام', icon: 'sliders', perm: 'tickets.view', sees: ['orders', 'tickets'], role: 'مدير النظام', builtin: true, about: '', intro: '', instructions: '', suggestions: [], sort: 5, archived_at: null });
  mock.tickets[0].follow_up = '2026-11-01';
  await openAi(page, 'المدير العام');
  const btn = pg(page).locator('[data-ag-ready-btn="manager"]'); await btn.click();
  const menu = page.locator('[data-ag-ready-menu="manager"]'); await expect(menu).toBeVisible();
  await expect(menu.locator('[data-mk-req-add="manager"]')).toHaveText('تقديم طلب'); // the old popup stays first
  await menu.locator('[data-ag-ready-add="report"]').click();
  const f = page.locator('.modal:has([data-ag-ready-form="report"])'); await expect(f).toBeVisible();
  await f.locator('[data-ag-rd-save]').click(); await expect(f).toContainText('اكتب الاسم');
  await f.locator('#ag-rd-name').fill('المتأخر');
  await f.locator('#ag-rd-el-0').click(); await page.getByRole('option', { name: 'طلبات الفريق' }).click();
  await f.locator('#ag-rd-ty-0').click(); await expect(page.getByRole('option', { name: 'تحديث' })).toHaveCount(0); // an event has no list
  await page.getByRole('option', { name: 'نوع الطلب' }).click();
  await f.locator('#ag-rd-st-0').click(); await page.getByRole('option', { name: 'طلبات متأخرة' }).click();
  await f.locator('[data-ag-rd-more]').click();
  await f.locator('#ag-rd-el-1').click(); await page.getByRole('option', { name: 'الأوردرات الرئيسية' }).click();
  await f.locator('#ag-rd-ty-1').click(); await page.getByRole('option', { name: 'حالة التأخير' }).click();
  await f.locator('#ag-rd-st-1').click(); await page.getByRole('option', { name: 'متأخر', exact: true }).click();
  await f.locator('[data-ag-rd-save]').click(); await expect(f).toHaveCount(0);
  expect(mock.mkt.writes.filter((w) => w.table === 'ai_agent_ready').map((w) => [w.op, w.kind, w.name, w.parts])).toEqual([['add', 'report', 'المتأخر',
    [{ element: 'tickets', type: 'type', state: 'late' }, { element: 'orders', type: 'delay', state: 'late' }]]]);
  // a ready request: an event is fine
  await btn.click(); await menu.locator('[data-ag-ready-add="request"]').click();
  const f2 = page.locator('.modal:has([data-ag-ready-form="request"])'); await f2.locator('#ag-rd-name').fill('متابعة أوردر جديد');
  await f2.locator('#ag-rd-el-0').click(); await page.getByRole('option', { name: 'الأوردرات الرئيسية' }).click();
  await f2.locator('#ag-rd-ty-0').click(); await page.getByRole('option', { name: 'تحديث' }).click();
  await f2.locator('#ag-rd-st-0').click(); await page.getByRole('option', { name: 'أوردر جديد' }).click();
  await f2.locator('[data-ag-rd-save]').click(); await expect(f2).toHaveCount(0);
  // the report: a chip per element, the member's own rows, «مشاركة»
  await btn.click(); await expect(menu.locator('[data-ag-ready]')).toHaveText(['متابعة أوردر جديد', 'المتأخر']);
  await menu.locator('[data-ag-ready]', { hasText: 'المتأخر' }).click();
  const rep = page.locator('.modal[data-ag-ready-report]'); await expect(rep).toBeVisible();
  await expect(rep.locator('[data-ag-ready-part]')).toHaveCount(2);
  await expect(rep.locator('[data-ag-ready-tbl] tbody tr')).toHaveCount(1); await expect(rep.locator('[data-ag-ready-tbl]')).toContainText('عاجل');
  await rep.locator('[data-ag-ready-share]').click(); await expect(page.locator('.modal', { hasText: 'Excel' }).last()).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await expect(rep).toHaveCount(0);
  // the request: «طلب جديد» filled with its name and elements — the member sends it
  await btn.click(); await menu.locator('[data-ag-ready]', { hasText: 'متابعة أوردر جديد' }).click();
  const rq = page.locator('.modal[data-mk-req-form="manager"]'); await expect(rq).toBeVisible();
  await expect(rq.locator('#mk-rq-title')).toHaveValue('متابعة أوردر جديد'); await expect(rq.locator('#mk-rq-desc')).toHaveValue(/الأوردرات الرئيسية › تحديث › أوردر جديد/);
  expect(asks().length).toBe(0);
  await page.keyboard.press('Escape');
  // the admin deletes one
  page.once('dialog', (d) => d.accept()); await btn.click(); await menu.locator('[data-ag-ready-del]').first().click();
  await expect.poll(() => mock.mkt.writes.filter((w) => w.table === 'ai_agent_ready' && w.op === 'delete').length).toBe(1);
});
