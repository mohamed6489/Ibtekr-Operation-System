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
  // comments decision 30: «مشاركة» is the system's one share popup — the report's table as an Excel / a PDF by WhatsApp, e-mail or a download
  await r.getByRole('button', { name: 'مشاركة' }).click();
  const sh = page.locator('[data-share-modal]');
  await sh.locator('[data-sh-type="excel"]').click(); await sh.locator('[data-sh-via="whatsapp"]').click();
  page.on('popup', (p) => p.close().catch(() => {}));
  const [file] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  expect(await file.path()).toBeTruthy(); // the file itself is saved (this browser names an Arabic file «download» — the name asked for is below)
  const shared = await page.evaluate(() => window.__lastShare);
  expect(shared).toMatchObject({ type: 'excel', via: 'whatsapp' }); expect(shared.href.startsWith('https://wa.me/')).toBe(true);
  expect(shared.name).toMatch(/^تقرير فيه أوردرات متأخرة.*\.xlsx$/);
  expect(shared.title).toContain('فيه أوردرات متأخرة؟');
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
  // owner batch 14 Nov decision 12: no manual task — «إضافة مهمة» opens a team request («طلب جديد») with the title
  next = { text: 'فتحتلك المهمة.', actions: [{ name: 'open_form', input: { form: 'task_add', values: { title: 'مراجعة فواتير' } } }] };
  await ask(page, 'ضيفلي مهمة مراجعة فواتير');
  await openLink(page); // decision 41: the popup opens from the link under the answer
  await expect(page).toHaveURL(/#tickets/);
  const req = page.locator('.modal[role=dialog]').last();
  await expect(req.locator('input[value="مراجعة فواتير"]')).toHaveCount(1);
  expect(mock.hr.tasks.some((t) => t.title === 'مراجعة فواتير')).toBe(false);
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
  { kind: 'files', data: { total: 1, rows: [{ source: 'ticket', ref: FILE, name: 'صورة الكسر.jpg', label: 'مرفق طلب', owner: 'TKT-0007' }] } }];
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

// The owner 15 Nov (docs/superpowers/plans/2026-11-15-assistant-categories.md — «اعملي القسم كذا انجليزي و عربي و جواه قسم فرعي كذا و كذا …
// يبني levels الاقسام الفرعية علي حسب شرحي بس يوريني قبل ما يطبق عشان ممكن اعدل وراه و بعدين اعمل نشر»): plan_categories is a link under
// the answer; it opens «مراجعة الأقسام» on the categories tab — the tree edited, a row added and one taken out — and «نشر على الموقع»
// creates the rows in order through category_create, each child under the id the site gave its parent; a category already on the site
// is used as it is; a refusal stops there and «كمّل النشر» goes on without making anything twice.
test('plan_categories: the review popup edits the tree, then «نشر» creates the main category and what is under it in order', async ({ page }) => {
  const plan = { items: [{ level: 1, en: 'Home Decor', ar: 'ديكور المنزل' }, { level: 2, en: 'Vases', ar: 'فازات' }, { level: 3, en: 'Glass Vases', ar: 'فازات زجاج' }, { level: 2, en: 'Candles', ar: 'شموع' },
    { level: 1, en: 'هدايا', ar: 'هدايا' }, { level: 2, en: 'Gift Boxes', ar: 'علب هدايا' }] };
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'راجع الأقسام من هنا واضغط نشر.', actions: [{ name: 'plan_categories', input: plan }] } : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'اعملي قسم Home Decor ديكور المنزل وجواه Vases وتحتها Glass Vases، و Candles، وتحت هدايا Gift Boxes');
  const link = panel(page).locator('[data-ai-open="category_plan"]');
  await expect(link).toHaveText(/راجع الأقسام \(6\)/);
  expect(mock.categoriesCreated).toEqual([]); // nothing is made by the answer
  await link.click();
  await expect(page).toHaveURL(/#products-cats$/);
  const M = page.locator('.modal').filter({ hasText: 'مراجعة الأقسام' });
  await expect(M).toBeVisible();
  const rows = M.locator('[data-cp-row]');
  await expect(rows).toHaveCount(6);
  expect(await rows.evaluateAll((els) => els.map((el) => el.dataset.cpLevel))).toEqual(['1', '2', '3', '2', '1', '2']);
  await expect(M.locator('[data-cp="en:1"]')).toHaveValue('Home Decor'); await expect(M.locator('[data-cp="ar:3"]')).toHaveValue('فازات زجاج');
  // «هدايا» is already a main category of the site: used as it is, its Arabic name not asked
  await expect(M.locator('[data-cp-tag="5"]')).toHaveText('موجود على الموقع'); await expect(M.locator('[data-cp="ar:5"]')).toBeDisabled();
  await expect(M.locator('[data-cp-sum]')).toHaveText(/هيتعمل 5 أقسام على الموقع \(1 رئيسي · 4 فرعي\) · 1 موجود قبل كده/);
  // he edits behind the assistant: a name, a row out (with nothing under it), a sub-category added under the main one
  await M.locator('[data-cp="en:2"]').fill('Flower Vases');
  await M.locator('[data-cp-del="4"]').click();
  await expect(rows).toHaveCount(5);
  await M.locator('[data-cp-sub="1"]').click();
  await expect(rows).toHaveCount(6);
  expect(await rows.evaluateAll((els) => els.map((el) => el.dataset.cpLevel))).toEqual(['1', '2', '3', '2', '1', '2']); // the new row sits after the main one's subtree
  await expect(M.locator('[data-cp="en:4"]')).toBeFocused();
  // a new row needs both names: nothing is sent
  await M.getByRole('button', { name: 'نشر على الموقع', exact: true }).click();
  await expect(M.locator('[data-cp-err="en:4"]')).toHaveText('اكتب الاسم'); await expect(M.locator('[data-cp-err="ar:4"]')).toHaveText('اكتب الاسم');
  expect(mock.categoriesCreated).toEqual([]);
  await M.locator('[data-cp="en:4"]').fill('Mirrors'); await M.locator('[data-cp="ar:4"]').fill('مرايات');
  // the site refuses one: what was made stays, the rest waits
  mock.catCreateFail = (b) => b.name_en === 'Glass Vases';
  await M.getByRole('button', { name: 'نشر على الموقع', exact: true }).click();
  await expect(M.locator('[data-cp-tag="3"]')).not.toHaveText('');
  await expect(M.getByRole('button', { name: 'كمّل النشر', exact: true })).toBeVisible();
  expect(mock.categoriesCreated.map((c) => [c.name_en, c.name_ar, c.parent])).toEqual([['Home Decor', 'ديكور المنزل', 0], ['Flower Vases', 'فازات', 9504]]);
  await expect(M.locator('[data-cp-tag="1"]')).toHaveText('اتعمل'); await expect(M.locator('[data-cp="en:1"]')).toBeDisabled();
  await expect(page.locator('.busy-pill.err')).toContainText('وقفنا عند «Glass Vases»');
  // «كمّل النشر»: the rest, each under its parent's id — nothing twice; the site's «هدايا» (22) keeps its id for its new child
  mock.catCreateFail = null;
  await M.getByRole('button', { name: 'كمّل النشر', exact: true }).click();
  await expect(M).toBeHidden();
  expect(mock.categoriesCreated.map((c) => [c.name_en, c.name_ar, c.parent])).toEqual([['Home Decor', 'ديكور المنزل', 0], ['Flower Vases', 'فازات', 9504], ['Glass Vases', 'فازات زجاج', 9505], ['Mirrors', 'مرايات', 9504], ['Gift Boxes', 'علب هدايا', 22]]);
  await expect(page.locator('.busy-pill.ok')).toContainText('اتعمل 5 أقسام على الموقع');
  // the categories tab under the popup shows the new tree, opened
  await expect(page.locator('.cat-main[data-cat="9504"] .cat-main-h .cat-name')).toHaveText('Home Decor');
  await expect(page.locator('.cat-sub[data-cat="9506"]')).toContainText('Glass Vases');
  await expect(page.locator('.cat-sub[data-cat="9508"]')).toContainText('Gift Boxes');
  expect(mock.activityRows.filter((r) => r.action === 'product.category.create').length).toBe(5);
});

test('owner 16 Nov — «مراجعة الأقسام»: a square picture per category (pick or drop, × takes it off), sent with its category on «نشر»; a category the site has takes none', async ({ page }) => {
  const plan = { items: [{ level: 1, en: 'Home Decor', ar: 'ديكور المنزل' }, { level: 2, en: 'Vases', ar: 'فازات' }, { level: 1, en: 'هدايا', ar: 'هدايا' }] };
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'راجع الأقسام.', actions: [{ name: 'plan_categories', input: plan }] } : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'اعملي قسم Home Decor وتحته Vases');
  await panel(page).locator('[data-ai-open="category_plan"]').click();
  const M = page.locator('.modal').filter({ hasText: 'مراجعة الأقسام' });
  await expect(M.locator('.cp-head')).toContainText('الصورة');
  await expect(M.locator('[data-cp-img]')).toHaveCount(3);
  await expect(M.locator('[data-cp-img="3"]')).toBeDisabled(); // «هدايا» is on the site already
  const png = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#005642'; x.fillRect(0, 0, 60, 40);
    const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; });
  const file = { name: 'decor.png', mimeType: 'image/png', buffer: Buffer.from(png) };
  await M.locator('[data-cp-img-input="1"]').setInputFiles(file);
  await expect(M.locator('[data-cp-img="1"] img')).toBeVisible();
  await M.locator('[data-cp-img-input="2"]').setInputFiles(file);
  await expect(M.locator('[data-cp-sum]')).toContainText('2 بصورة');
  await M.locator('[data-cp-img-x="2"]').click(); // taken back off
  await expect(M.locator('[data-cp-img="2"] img')).toHaveCount(0);
  await expect(M.locator('[data-cp-sum]')).toContainText('1 بصورة');
  await M.getByRole('button', { name: 'نشر على الموقع', exact: true }).click();
  await expect(M).toBeHidden();
  expect(mock.categoriesCreated.map((c) => [c.name_en, !!c.image])).toEqual([['Home Decor', true], ['Vases', false]]);
});

test('plan_categories: the tree under a category of the site; a member without «إضافة منتجات» gets a note, no popup', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'راجع الأقسام من هنا واضغط نشر.', actions: [{ name: 'plan_categories', input: { under: 'ديكور', items: [{ level: 1, en: 'Wall Art', ar: 'لوحات' }, { level: 2, en: 'Canvas', ar: 'كانفاس' }] } }] } : null);
  await signIn(page, ADMIN);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'تحت قسم ديكور اعمل Wall Art لوحات وجواه Canvas كانفاس');
  await panel(page).locator('[data-ai-open="category_plan"]').click();
  const M = page.locator('.modal').filter({ hasText: 'مراجعة الأقسام' });
  await expect(M).toBeVisible();
  await expect(M.locator('#cp-under')).toContainText('تحت: ديكور');
  await expect(M.locator('[data-cp-sum]')).toHaveText(/هيتعمل 2 قسم على الموقع \(0 رئيسي · 2 فرعي\)/);
  await M.getByRole('button', { name: 'نشر على الموقع', exact: true }).click();
  await expect(M).toBeHidden();
  expect(mock.categoriesCreated.map((c) => [c.name_en, c.parent])).toEqual([['Wall Art', 15], ['Canvas', 9504]]);
  // accounts: no products.add — the link says so and nothing opens
  await page.evaluate(() => window.IBAuth.signOut());
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', 'accounts.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'اعمل قسم Wall Art');
  await panel(page).locator('[data-ai-open="category_plan"]').last().click();
  await expect(panel(page).locator('.ai-msg.ai').last()).toContainText('إضافة الأقسام لصلاحية «إضافة منتجات»');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(mock.categoriesCreated.length).toBe(2);
});

// ش45 decisions 3 and 4 (the owner 17 Nov — «الايه اي اللي في الهيدر ده المدير»): a programming question goes to the developer's chat
// (the marketing assistants open on it and the question is sent there); a content ask opens «كامبين جديدة» filled — nothing generated
test('ش45: the header\'s assistant hands a programming question to the developer — «الذكاء الاصطناعي» opens on «المبرمج الذكي» with the question in the box, sent by the member', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'حوّلت سؤالك للمبرمج.', actions: [{ name: 'ask_agent', input: { agent: 'dev', question: 'ليه الموقع بطيء على الموبايل؟' } }] } : null);
  await signIn(page, OPS);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'ليه الموقع بطيء على الموبايل؟');
  await expect(panel(page).locator('.ai-msg.ai').last()).toHaveText('حوّلت سؤالك للمبرمج.');
  await expect(page.locator('#pg-ai')).toBeVisible();
  await expect(page.locator('#pg-ai').getByRole('tab', { name: /المبرمج/ })).toHaveAttribute('aria-selected', 'true');
  // the question waits in the box (nothing sent until the member presses) — then one call on a new chat
  await expect(page.locator('#mk-ask')).toHaveValue('ليه الموقع بطيء على الموبايل؟');
  expect(mock.mkt.calls.filter((c) => c.action === 'agent')).toEqual([]);
  await page.locator('#mk-ask').press('Enter');
  await expect.poll(() => mock.mkt.calls.filter((c) => c.action === 'agent').map((c) => [c.agent, c.chat])).toEqual([['dev', null]]);
  await expect(page.locator('#pg-ai')).toContainText('سؤالك: ليه الموقع بطيء على الموبايل؟');
});

test('ش45: a content ask opens «كامبين جديدة» filled from the header (the goal, the idea, the counts) — nothing saved or generated', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'فتحتلك الكامبين متملّية — راجعها واضغط توليد.', actions: [{ name: 'open_campaign', input: { goal: 'عرض / خصم', idea: 'خصم 20% على المكرمية للشتا', post: 3, carousel: 1, slides: 5, video: 0 } }] } : null);
  await signIn(page, OPS);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'عايز محتوى لعرض المكرمية: 3 بوستات وكاروسيل');
  await expect(page.locator('#pg-marketing')).toBeVisible();
  const pg = page.locator('#pg-marketing');
  await expect(pg.locator('[data-cw-goal] [aria-checked="true"]')).toHaveText('عرض / خصم');
  await expect(pg.locator('textarea').first()).toHaveValue('خصم 20% على المكرمية للشتا');
  expect(mock.mkt.campaigns.length, 'nothing saved').toBe(0);
  expect(mock.mkt.calls.filter((c) => ['marketing', 'campaign', 'campaign_edit', 'video_clip'].includes(c.action)).length, 'nothing generated').toBe(0);
});

test('ش45: a member without marketing gets no developer assistant — the panel says so', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'حوّلت سؤالك للمبرمج.', actions: [{ name: 'ask_agent', input: { agent: 'dev', question: 'سؤال' } }] } : null);
  await signIn(page, 'accounts.dev@ibtekr.local');
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'سؤال برمجة');
  await expect(panel(page)).toContainText('ما قدرتش أفتح المساعد');
  await expect(page.locator('#pg-ai')).toBeHidden();
});

// the owner 17 Nov — «المدير يكون ذكي كفاية لما اديلو مجموعة تاسكات يوزعهم و يقسمهم صح علي الفريق و يبعت تنبيهة للدور»: plan_requests is a
// link under the answer; the review lists each request (the role, the member or the whole role, the priority) and each goes only on its «ابعت»
test('plan_requests: «راجع الطلبات» lists the split requests; one «ابعت» sends one team request, nothing before it', async ({ page }) => {
  const items = [{ title: 'صوّر الكراسي الجديدة', details: 'قبل الخميس', role: 'خدمة العملاء', member: '', priority: 'high' }, { title: 'رد على شكاوى الأسبوع', details: '', role: 'خدمة العملاء', member: '', priority: 'normal' }];
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'قسمتهملك — راجعهم.', actions: [{ name: 'plan_requests', input: { items } }] } : null);
  await signIn(page, ADMIN);
  const n0 = mock.tickets.length;
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'وزّع المهام دي على الفريق');
  const link = panel(page).locator('[data-ai-open="request_plan"]');
  await expect(link).toHaveText(/راجع الطلبات \(2\)/);
  expect(mock.tickets.length).toBe(n0); // nothing sent by the answer
  await link.click();
  const M = page.locator('.modal').filter({ hasText: 'توزيع المهام على الفريق' });
  await expect(M.locator('[data-req-plan="0"]')).toContainText('لـ خدمة العملاء · كل الدور · عالي');
  await M.locator('[data-req-send="0"]').click();
  await expect(M.locator('[data-req-plan="0"] [data-req-result="ok"]')).toContainText('اتبعت');
  expect(mock.tickets.length).toBe(n0 + 1);
  await expect(M.locator('[data-req-plan="1"] [data-req-result]')).toHaveCount(0);
});

// the owner 18 Nov («كل المساعدين يتعاملوا بنفس الطريقة … لو عايزني اختار حاجة يجيبها جوه الشات … لو محتاجين بيانات يديني بوباب»): the
// header's assistant asks with ask_choice — buttons under its answer (the pressed one is the next message) or a popup of fields
test('the owner 18 Nov — ask_choice: the manager\'s options are buttons in the chat, its fields a popup; each answer goes as the next message', async ({ page }) => {
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'إيداع ولا سحب؟', actions: [{ name: 'ask_choice', input: { question: 'نوع الحركة', options: ['إيداع', 'سحب'], fields: [] } }] } : null);
  await signIn(page, OPS);
  await page.getByRole('button', { name: 'مساعد AI' }).click();
  await ask(page, 'سجّل حركة');
  const card = panel(page).locator('[data-ib-ask]').last();
  await expect(card.locator('[data-ib-ask-opt]')).toHaveCount(2);
  mock.aiAnswer = (action) => (action === 'assistant' ? { text: 'محتاج التفاصيل', actions: [{ name: 'ask_choice', input: { question: 'التفاصيل', options: [], fields: [{ label: 'المبلغ', kind: 'number' }, { label: 'السبب', kind: 'long' }] } }] } : null);
  await card.locator('[data-ib-ask-opt="سحب"]').click();
  await expect.poll(() => mock.aiCalls.filter((c) => c.action === 'assistant').at(-1).turns.at(-1)).toEqual({ role: 'user', text: 'سحب' });
  await expect(panel(page).locator('[data-ib-ask-opt="إيداع"]')).toBeDisabled();
  mock.aiAnswer = () => ({ text: 'تمام.', actions: [] });
  await panel(page).locator('[data-ib-ask-form]').last().click();
  const md = page.locator('[data-ib-ask-popup]');
  await md.locator('#ib-ask-0').fill('500'); await md.locator('#ib-ask-1').fill('مواصلات');
  await md.locator('[data-ib-ask-send]').click();
  await expect.poll(() => mock.aiCalls.filter((c) => c.action === 'assistant').at(-1).turns.at(-1).text).toBe('المبلغ: 500\nالسبب: مواصلات');
});
