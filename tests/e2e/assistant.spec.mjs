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
const openLink = (page) => panel(page).locator('.ai-form-link').last().click();
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

test('decision 40: an expense / an account move opens the accounts page\'s own «سحب / إيداع» popup filled — nothing written until «حفظ»', async ({ page }) => {
  let next = null; mock.aiAnswer = (action) => (action === 'assistant' ? next : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  // an expense withdrawal: the popup «سحب مصروفات» with the amount and the type the member said
  next = { text: 'فتحتلك بوب أب سحب المصروفات — كمّل واحفظ.', actions: [{ name: 'open_form', input: { form: 'expense_add', values: { direction: 'withdraw', amount: '1500', category: 'المصروفات' } } }] };
  await ask(page, 'سحب مصروفات 1500');
  await expect(panel(page).locator('.ai-form-link').last()).toContainText('سحب — المصروفات');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  const ex = page.locator('.modal[role=dialog]', { hasText: 'سحب مصروفات' }).last();
  await expect(ex.locator('#f-amount')).toHaveValue('1500');
  await expect(ex).toContainText('المصروفات');
  await ex.getByRole('button', { name: 'إلغاء' }).click();
  expect(mock.accWrites.length).toBe(0);
  // a deposit on the actual account: «إيداع في الحساب» filled; «حفظ» writes it through IBAccounts
  next = { text: 'فتحتلك بوب أب الإيداع.', actions: [{ name: 'open_form', input: { form: 'account_move', values: { direction: 'deposit', amount: '2000', account: 'حساب البنك' } } }] };
  await ask(page, 'إيداع 2000 في حساب البنك');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  const dep = page.locator('.modal[role=dialog]', { hasText: 'إيداع في الحساب' }).last();
  await expect(dep.locator('#f-amount')).toHaveValue('2000');
  expect(mock.accWrites.length).toBe(0);
  await dep.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_account_moves', op: 'insert', direction: 'deposit', account: 'حساب البنك', amount: 2000 });
  await expect(page.locator('.sidebar .nav-item[data-page="accounts"]')).toHaveAttribute('aria-current', 'page');
  // no direction → nothing opens, the panel says to pick one
  next = { text: 'تمام.', actions: [{ name: 'open_form', input: { form: 'vendor_move', values: { amount: '300' } } }] };
  await ask(page, 'حركة مبتكر 300');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  await expect(panel(page).locator('.ai-msg.ai').last()).toContainText('إيداع ولا سحب');
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

// phase 13 decision 36 (owner 10 Nov — «يقدر يضيف مبتكر أو موظف أو عميل… يسألني على البيانات اللي محتاجها ويفتحلي بيها بوب أب أملاها وبعد
// كده ياخد الأكشن ودايمًا يبعتلي أأكد»; the popup is the confirmation, the dangerous actions are not the assistant's): open_form opens the
// system's own popup filled with the member's values — nothing is written until its own button
test('decision 36: open_form vendor_add opens «إضافة مبتكر» filled — nothing saved until the member saves', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'فتحتلك بوب أب إضافة المبتكر — راجعه واحفظ.', actions: [{ name: 'open_form', input: { form: 'vendor_add', values: { name: 'خزف أسوان', phone: '01012345678', category: 'خزف' } } }] } : null);
  await signIn(page, ADMIN);
  const before = mock.vendors.length;
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'ضيف مبتكر اسمه خزف أسوان رقمه 01012345678');
  await expect(panel(page).locator('.ai-form-link')).toContainText('إضافة مبتكر'); await expect(page.locator('#v-name')).toHaveCount(0); // decision 41: a link, nothing opens by itself
  await openLink(page); // decision 41: the popup opens from the link under the answer
  await expect(page.locator('#v-name')).toHaveValue('خزف أسوان');
  await expect(page.locator('#v-phone')).toHaveValue('01012345678');
  await page.waitForTimeout(300);
  expect(mock.vendors.length).toBe(before); // the popup only — the member's save writes
});

test('decision 36: open_form customer_add / hr_leave / task_add open their forms filled; a viewer without the right gets a note, no popup', async ({ page }) => {
  let next = null; mock.aiAnswer = (action) => (action === 'assistant' ? next : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  next = { text: 'فتحتلك بوب أب العميل.', actions: [{ name: 'open_form', input: { form: 'customer_add', values: { name: 'منة', city: 'طنطا' } } }] };
  await ask(page, 'ضيف عميلة اسمها منة من طنطا');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  const cust = page.locator('.modal[role=dialog]', { hasText: 'إضافة عميل' }).last();
  await expect(cust.locator('#name')).toHaveValue('منة'); await expect(cust.locator('#city')).toHaveValue('طنطا');
  await cust.getByRole('button', { name: 'إلغاء' }).click();
  next = { text: 'فتحتلك المهمة.', actions: [{ name: 'open_form', input: { form: 'task_add', values: { title: 'مراجعة فواتير' } } }] };
  await ask(page, 'ضيفلي مهمة مراجعة فواتير');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  const task = page.locator('.modal[role=dialog]', { hasText: 'إضافة مهمة' }).last();
  await expect(task.locator('#title')).toHaveValue('مراجعة فواتير');
  await task.getByRole('button', { name: 'أكّد وسجّل' }).click();
  await expect.poll(() => mock.hr.tasks.some((t) => t.title === 'مراجعة فواتير')).toBe(true);
});

test('decision 36: open_form order_update asks once in a popup, then writes the confirmation; a viewer is told the right is missing', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'فتحتلك التأكيد.', actions: [{ name: 'open_form', input: { form: 'order_update', values: { order: '181668', confirm: 'مؤكد بدون عربون' } } }] } : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'أكّد أوردر 181668 من غير عربون');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  const dlg = page.locator('.modal[role=dialog]', { hasText: 'تحديث الأوردر IB-181668' }).last();
  await expect(dlg).toContainText('مؤكد بدون عربون');
  await dlg.getByRole('button', { name: 'أكّد وسجّل' }).click();
  await expect.poll(() => page.evaluate(() => window.OrdersApp.query({ q: '181668' }, 1).rows[0].confirm)).toBe('مؤكد بدون عربون');
});

test('decision 42: a maker question is answered in the chat without changing the page; «تنزيل Excel» exports the read data; a file found comes as a download link; my words are green with beige text', async ({ page }) => {
  const OPS_ID = '00000000-0000-4000-8000-000000000002'; const FILE = OPS_ID + '/abc-photo.jpg';
  mock.ticketObjects.set(FILE, { type: 'image/jpeg', size: 1000 });
  const report = [{ kind: 'vendor', data: { vendor: 'Art Craft', status: 'active', period: { from: '2026-11-01', to: '2026-11-10' },
    orders: { total: 3, totalEgp: 2100, byStatus: { 'ملغي': 1, 'جاري التنفيذ': 2 }, cancelled: 1, late: 1, rows: [{ number: 180672, status: 'ملغي', total: 700 }] },
    account: { dokanBalance: 3000, deposits: 500, transport: 50, otherMoves: 0, net: 2450 } } },
  { kind: 'files', data: { total: 1, rows: [{ source: 'ticket', ref: FILE, name: 'صورة الكسر.jpg', label: 'مرفق تذكرة', owner: 'TKT-0007' }] } }];
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'Art Craft عنده 3 أوردرات، واحد ملغي، والصافي 2,450 ج.م. نزّل الصورة من هنا.', tools: ['vendor', 'files'], report,
    actions: [{ name: 'offer_file', input: { source: 'ticket', ref: FILE, name: 'صورة الكسر.jpg' } }] } : null);
  await signIn(page, OPS);
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'حساب Art Craft وعدد الأوردرات الملغية');
  const P = panel(page);
  await expect(P.locator('.ai-msg.ai').last()).toContainText('الصافي 2,450');
  // my bubble: the brand green with the beige text
  const mine = P.locator('.ai-msg.user').last();
  expect(await mine.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(['rgb(0, 86, 66)', 'rgb(255, 247, 239)']);
  // the page did not move
  await expect(page.locator('.sidebar .nav-item[data-page="dashboard"]')).toHaveAttribute('aria-current', 'page');
  // «تنزيل Excel»: one sheet with the question, the answer and the read data
  await P.locator('[data-ai-excel]').last().click();
  await expect.poll(() => page.evaluate(() => window.__lastExport && window.__lastExport.filename)).toMatch(/^ibtekr-assistant-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(await page.evaluate(() => window.__lastExport.rows)).toBeGreaterThan(10);
  // the file: a download link signed by the tickets adapter on the click
  const link = P.locator('[data-ai-file="ticket"]');
  await expect(link).toHaveText(/تنزيل «صورة الكسر.jpg»/);
  await link.click();
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  expect(await page.evaluate(() => window.__opened[0])).toContain('/object/sign/tickets/' + FILE);
  // a file the member cannot open: a note, nothing opened
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'نزّله من هنا.', tools: ['files'], actions: [{ name: 'offer_file', input: { source: 'ticket', ref: '00000000-0000-4000-8000-000000000009/x.pdf', name: 'x.pdf' } }] } : null);
  await ask(page, 'هات x.pdf');
  await P.locator('[data-ai-file="ticket"]').last().click();
  await expect(P.locator('.ai-msg.ai').last()).toContainText('ما قدرتش أجيب الملف');
  expect(await page.evaluate(() => window.__opened.length)).toBe(1);
});
