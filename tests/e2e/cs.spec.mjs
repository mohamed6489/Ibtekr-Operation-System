import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The customer-service page (phase 6, block 20 from the v2 prototype on IBCS / 0034): the inbox (list, chat, note, status, close with
// an outcome), the customers (from the orders + a lead; the profile), the segments (two-step creation), the campaigns (a draft), the
// channels (all disconnected), the performance, the reports tab and the bell group «رسايل». Mock only: the cases assert the mock's
// seed and the writes it recorded (mock.csWrites).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, id, hash = '#cs-inbox') {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForFunction(() => window.IBCS && window.IBCS.state() === 'ready');
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page.locator('#pg-cs')).toBeVisible();
}
const pg = (page) => page.locator('#pg-cs');
const go = async (page, tab) => { await page.evaluate((t) => { location.hash = 'cs-' + t; }, tab); await expect(pg(page).locator('.cs-tab-' + tab)).toBeVisible(); };

test('inbox: the seeded conversation (customer, assignee, status tag, messages), a note, a status change, close with an outcome + mood + rating', async ({ page }) => {
  await signIn(page, ADMIN);
  const P = pg(page);
  await expect(P.locator('.cs-list .cv')).toHaveCount(2); // the WhatsApp one (waiting, first) and the Messenger one (6.2, waiting for the customer)
  await expect(P.locator('.cs-list .cv .nm').first()).toHaveText('سلوى زيتوني');
  await expect(P.locator('.cs-list .cv').first()).toContainText('سارة أحمد');
  await expect(P.locator('.cs-ch .who b')).toHaveText('سلوى زيتوني');
  await expect(P.locator('.cs-msgs .bub')).toHaveCount(2);
  await expect(P.locator('.cs-msgs .bub.b-in')).toContainText('181668');
  await expect(P.locator('.cs-msgs .bub.b-note')).toContainText('ملاحظة داخلية');
  await expect(P.locator('.cs-chat > .cs-bar')).toContainText('مستنية ردنا من'); // the SLA bar (18 minutes waiting)
  await expect(P.locator('.cs-panel')).toContainText('01200007052'); // the admin reads the phone
  await expect(P.locator('.cs-panel .ord')).toContainText('181668');
  await expect(P.locator('[data-chan-off]')).toBeVisible(); // no channel is connected: the reply is blocked, the note works
  await expect(P.locator('[data-cmp-send]')).toBeDisabled();
  await P.locator('.cmp-tab.note').click();
  await P.locator('#cs-ta').fill('اتصلت بالمبتكر');
  await P.locator('[data-cmp-send]').click();
  await expect(P.locator('.cs-msgs .bub.b-note')).toHaveCount(2);
  expect(mock.csWrites.filter((w) => w.table === 'cs_messages').map((w) => w.kind)).toEqual(['note']);
  // the conversation's status tag (a tag on the customer) from the card
  await P.locator('.cs-list .cv [data-status-pick]').first().click();
  await page.getByRole('option', { name: 'مستعجل' }).click();
  await expect(P.locator('.cs-ch [data-head-status]')).toContainText('مستعجل');
  expect(mock.cs.customers.find((c) => c.name === 'سلوى زيتوني').tags).toEqual(['مستعجل']);
  // close: outcome required, the mood and a rating ride along
  await P.locator('[data-close-chat]').click();
  const dlg = page.locator('.modal');
  await dlg.getByRole('button', { name: 'إنهاء المحادثة' }).click();
  await expect(dlg).toContainText('اختار نتيجة المحادثة');
  await dlg.getByRole('radio', { name: 'تم حل المشكلة' }).click();
  await dlg.locator('[data-cc-mood-v="سعيد"]').click();
  await dlg.locator('#cc-sat [data-star="5"]').click();
  await dlg.locator('#cc-manners [data-star="4"]').click();
  await dlg.getByRole('button', { name: 'إنهاء المحادثة' }).click();
  await expect(P.locator('.cs-ch')).toContainText('إعادة فتح');
  await expect(P.locator('.cs-msgs .evt').last()).toContainText('النتيجة: «تم حل المشكلة»');
  const conv = mock.cs.conversations[0]; expect(conv.status).toBe('اتحلت'); expect(conv.outcome).toBe('تم حل المشكلة');
  expect(mock.cs.customers.find((c) => c.name === 'سلوى زيتوني').mood).toBe('سعيد');
  expect(mock.cs.teamRatings.map((r) => [r.sat, r.manners])).toEqual([[5, 4]]);
  await expect(P.locator('.cs-panel')).toContainText('سعيد');
});

test('customers: the list from the orders + the manual lead, KPIs, a new lead, the profile drawer with notes', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-customers');
  const P = pg(page);
  await expect(P.locator('.cs-cust tbody tr')).toHaveCount(5); // 4 phones in the seeded orders + the lead
  await expect(P.locator('.cs-cust')).toContainText('سلوى زيتوني');
  await expect(P.locator('.cs-cust')).toContainText('يوسف حامد');
  await expect(P.locator('.cards').first()).toContainText('5');
  // a lead by hand
  await P.getByRole('button', { name: 'إضافة عميل' }).click();
  const f = page.locator('.modal');
  await f.locator('#name').fill('رحاب محمود'); await f.locator('#phone').fill('0101 112 2233'); await f.locator('#city').fill('القاهرة');
  await f.getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(P.locator('.cs-cust tbody tr')).toHaveCount(6);
  expect(mock.csWrites.find((w) => w.table === 'cs_customers' && w.op === 'insert')).toMatchObject({ name: 'رحاب محمود', city: 'القاهرة', created_from: 'manual' });
  expect(JSON.stringify(mock.csWrites)).not.toContain('01011122233');
  // search then the profile
  await P.locator('#cust-q').fill('سلوى');
  await expect(P.locator('.cs-cust tbody tr')).toHaveCount(1);
  await P.locator('.cs-cust .who-cell').first().click();
  const d = page.locator('.drawer');
  await expect(d).toContainText('سلوى زيتوني');
  await expect(d).toContainText('بتحب التغليف كهدية'); // the seeded note
  await d.getByRole('button', { name: '+ ملاحظة' }).click();
  await page.locator('.modal #t').fill('عميلة مهمة');
  await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(d).toContainText('عميلة مهمة');
  expect(mock.cs.notes.length).toBe(2);
  await d.getByRole('tab', { name: /الأوردرات/ }).click();
  await expect(d).toContainText('181668');
});

test('segments: a two-step segment (rules → matching customers) is saved; its customers table; delete', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-segments');
  const P = pg(page);
  await expect(P).toContainText('VIP راضيين');
  await P.locator('[data-seg-new]').click();
  const f = page.locator('.modal');
  await f.locator('#name').fill('اشتروا مرة');
  await f.locator('#minOrders').fill('1');
  await expect(f.locator('#sg-count')).toContainText('هيطلع');
  await f.getByRole('button', { name: 'التالي — العملاء' }).click();
  await expect(f.locator('[data-seg-step2]')).toBeVisible();
  const picked = await f.locator('[data-sg-picked]').getAttribute('data-sg-picked');
  expect(Number(picked)).toBeGreaterThan(0);
  await f.getByRole('button', { name: /أنشئ الشريحة/ }).click();
  await expect(P).toContainText('اشتروا مرة');
  const seg = mock.cs.segments.find((g) => g.name === 'اشتروا مرة');
  expect(seg).toMatchObject({ min_orders: 1, remove_ids: [] });
  await expect(P.locator('[data-seg-back]')).toBeVisible(); // opened on the new segment
  await expect(P.locator('table tbody tr').first()).toBeVisible();
  await P.locator('[data-seg-back]').click();
  await expect(P.locator('table tbody tr')).toHaveCount(2);
});

test('6.3 hidden (decision 24): without settings «cs».live the last wizard step\'s «جدولة الحملة» and WhatsApp\'s «ربط» carry soon and stay disabled', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-campaigns');
  const P = pg(page);
  await P.getByRole('button', { name: 'حملة جديدة' }).click();
  await P.locator('#wz-name').fill('حملة مخفية');
  await page.evaluate(() => { const S = window.IBPages.all().cs.api.state; S.wiz.src = 'filters'; S.wiz.picked = window.IBCS.data.customers.filter((c) => c.name === 'هدير عميل').map((c) => c.id); S.wiz.pickDesc = 'اختيار يدوي'; window.IBPages.render('cs'); });
  await P.locator('[data-wz-next]').click(); await P.locator('#wz-text').fill('x'); await P.locator('[data-wz-next]').click(); await P.locator('[data-wz-next]').click();
  await expect(P.locator('[data-wz-next][data-soon]')).toBeDisabled();
  await expect(P.locator('[data-wz-next] .soon')).toHaveText('soon');
  await P.getByRole('tab', { name: 'القنوات' }).click();
  await expect(P.locator('[data-chan-connect="wa2"][data-soon]')).toBeDisabled();
  await expect(P.locator('[data-chan-connect="wa1"]')).not.toHaveAttribute('data-soon', ''); // decision 26: WhatsApp 1 is on Meta, not the hidden QR
  await expect(P.locator('[data-chan-connect="messenger"]')).not.toHaveAttribute('data-soon', '');
});

test('6.4 (decisions 21–22, live): «ربط» واتساب 2 shows the bridge\'s QR to the admin, closes once the number is linked', async ({ page }) => {
  mock.settings.push({ section: 'cs', data: { live: { wa: true, campaigns: true } } });
  let polls = 0;
  mock.wa = { states: { wa1: { status: 'offline' }, wa2: { status: 'qr', qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h1v1H0z"/></svg>' } }, calls: [], script: (W) => { polls += 1; if (polls >= 3) { W.states.wa2 = { status: 'connected', phone: '01000000002' }; mock.cs.channels.find((c) => c.id === 'wa2').status = 'connected'; } } };
  await signIn(page, ADMIN, '#cs-channels');
  const P = pg(page);
  await P.locator('[data-chan-connect="wa2"]').click();
  await expect(page.locator('.modal [data-wa-qr="wa2"] img.wa-qr-img')).toBeVisible();
  await expect(page.locator('.modal [data-wa-qr="wa2"]')).toContainText('الأجهزة المرتبطة');
  await expect(page.locator('.modal')).toHaveCount(0, { timeout: 15000 }); // linked → the window closes by itself
  expect(mock.wa.calls.filter((x) => x === 'wa_status').length).toBeGreaterThanOrEqual(3);
});

test('campaigns: the wizard saves a draft, then a scheduled campaign with a segment made from the picked customers', async ({ page }) => {
  mock.settings.push({ section: 'cs', data: { live: { wa: false, campaigns: true } } }); // decision 24: the sending is open in this test
  await signIn(page, ADMIN, '#cs-campaigns');
  const P = pg(page);
  await expect(P).toContainText('عرض العملاء المتكررين — أكتوبر');
  await P.getByRole('button', { name: 'حملة جديدة' }).click();
  await P.locator('#wz-name').fill('الجمعة البيضاء');
  // the picked customers (two without an open complaint or a late order) — the wizard keeps them as a segment of its own
  await page.evaluate(() => { const S = window.IBPages.all().cs.api.state; S.wiz.src = 'filters'; S.wiz.picked = window.IBCS.data.customers.filter((c) => ['هدير عميل', 'أوردر قديم'].includes(c.name)).map((c) => c.id); S.wiz.pickDesc = 'اختيار يدوي'; window.IBPages.render('cs'); });
  await P.locator('[data-wz-next]').click();
  await expect(P.locator('#wz-text')).toBeVisible();
  await P.locator('#wz-text').fill('خصم 10% على كل حاجة');
  await P.locator('[data-wz-next]').click();
  await P.locator('[data-wz-next]').click(); // schedule step with defaults (3 days ahead, 7 pm)
  await P.getByRole('checkbox', { name: /راجعت النص/ }).click();
  await P.locator('[data-wz-next]').click();
  await page.locator('.modal').getByRole('button', { name: 'تأكيد وجدولة' }).click();
  await expect(P.locator('.stepper')).toHaveCount(0); // back to the list once saved
  await expect(P.locator('.who-cell', { hasText: 'الجمعة البيضاء' })).toBeVisible();
  const k = mock.cs.campaigns.find((x) => x.name === 'الجمعة البيضاء');
  expect(k).toMatchObject({ status: 'مجدولة', channel: 'wa1', body: 'خصم 10% على كل حاجة' });
  expect(k.scheduled_at).toMatch(/^\d{4}-/);
  const made = mock.cs.segments.find((g) => g.name === 'الجمعة البيضاء'); expect(made).toBeTruthy(); expect(made.add_ids.length).toBe(2); expect(k.segment_id).toBe(made.id); expect(k.size).toBe(2);
  // decision 23: the audience frozen on the server (cs_campaign_schedule) — one queued recipient per picked customer
  expect(mock.csWrites.some((w) => w.op === 'schedule' && w.id === k.id && w.size === 2)).toBe(true);
  expect(mock.cs.recipients.filter((r) => r.campaign_id === k.id && r.status === 'queued').length).toBe(2);
  // a draft from the header action
  await P.getByRole('button', { name: 'حملة جديدة' }).click();
  await P.locator('#wz-name').fill('مسودة تجريبية');
  await P.locator('[data-wz-draft]').click();
  await expect(P.locator('.stepper')).toHaveCount(0);
  await expect(P.locator('.who-cell', { hasText: 'مسودة تجريبية' })).toBeVisible();
  expect(mock.cs.campaigns.find((x) => x.name === 'مسودة تجريبية').status).toBe('مسودة');
});

test('channels (all disconnected; WhatsApp waits for the last stage; the admin sees the Meta setup rows), performance from the loaded conversations, reports tab, the bell group «رسايل»', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-channels');
  const P = pg(page);
  await expect(P.locator('[data-channel]')).toHaveCount(5);
  await expect(P.locator('[data-channel="wa1"]')).toContainText('غير متصلة');
  await expect(P.locator('[data-chan-connect="wa2"]')).toContainText('soon'); // decision 24: WhatsApp 2 (QR) hidden until the owner opens it
  await expect(P.locator('[data-chan-connect="wa1"]')).not.toContainText('soon'); // decision 26: WhatsApp 1 links through Meta
  await expect(P.locator('[data-wa-setup]')).toContainText('META_WA_CONFIG_ID موجود ✓');
  await expect(P.locator('[data-wa-setup]')).toContainText('https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-whatsapp');
  await expect(P.locator('[data-meta-setup]')).toContainText('الأسرار موجودة ✓');
  await expect(P.locator('[data-meta-setup]')).toContainText('https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-channel');
  expect(mock.metaCalls.map((c) => c.action)).toEqual(['status']);
  await P.locator('[data-cs-settings]').click();
  await page.locator('.modal #slaWarn').fill('8'); await page.locator('.modal #slaLate').fill('12');
  await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(P).toContainText('12 دقيقة');
  expect(mock.settings.find((s) => s.section === 'cs').data).toMatchObject({ sla_warn: 8, sla_late: 12 });
  await go(page, 'performance');
  await expect(P).toContainText('أداء الفريق');
  await expect(P.locator('.cs-tab-performance table')).toContainText('سارة أحمد');
  await go(page, 'reports');
  await expect(P.locator('.cs-tab-reports')).toContainText('فترة التقارير');
  // the bell: the waiting conversation under «رسايل»
  await page.getByRole('button', { name: 'الإشعارات' }).first().click();
  const bell = page.getByRole('dialog', { name: 'الإشعارات' });
  await bell.locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: /^رسايل$/ }) }).click();
  await expect(bell.locator('.ntf-item', { hasText: 'سلوى زيتوني' }).first()).toBeVisible();
  await expect(bell).toContainText('مستنية ردنا من');
  await expect(bell.getByRole('tab', { name: /متأخرة عن الرد/ })).toBeVisible(); // 18 minutes waiting: under «متأخرة» (the tabs do not overlap)
});

test('ops (reply without manage) sees the page without add / segment / campaign buttons; accounts (cs.view N) is told so', async ({ page }) => {
  await signIn(page, OPS, '#cs-customers');
  const P = pg(page);
  await expect(P.locator('.cs-cust tbody tr')).toHaveCount(5);
  await expect(P.getByRole('button', { name: 'إضافة عميل' })).toHaveCount(0);
  await go(page, 'segments');
  await expect(P.locator('[data-seg-new]')).toHaveCount(0);
  await go(page, 'campaigns');
  await expect(P.getByRole('button', { name: 'حملة جديدة' })).toHaveCount(0);
  await go(page, 'inbox');
  await expect(P.locator('[data-close-chat]')).toBeEnabled();
});

test('accounts: cs.view = N — the page says the permission is missing', async ({ page }) => {
  await signIn(page, ACCOUNTS, '#cs-inbox');
  await expect(pg(page)).toContainText('صفحة خدمة العملاء محتاجة صلاحية');
});

test('6.2 — the admin links the Facebook page from «القنوات» (the dialog leaves the app, Meta comes back to meta-callback.html): Messenger + Instagram connected; a Messenger reply goes through the channel, a refused one is marked failed; comments: public reply, private reply, hide; disconnect; a spent state', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-channels');
  const P = pg(page);
  // Facebook's dialog (mocked) sends the browser straight back with a code
  await page.route('https://www.facebook.com/**', (route) => { const u = new URL(route.request().url()); route.fulfill({ status: 302, headers: { location: 'http://localhost:4173/meta-callback.html?code=AQD-code-mock-1234&state=' + u.searchParams.get('state') } }); });
  await P.locator('[data-chan-connect="messenger"]').click();
  await expect(page).toHaveURL(/meta-callback\.html$/);
  await expect(page.locator('#cb-title')).toHaveText('اتربطت صفحة Ibtekr Club ✓');
  await expect(page.locator('#cb-text')).toContainText('@ibtekr.club');
  expect(mock.oauthStates.map((s) => [s.kind, s.used])).toEqual([['meta', true]]);
  expect(mock.meta.linked).toBe(true);
  expect(mock.cs.channels.find((c) => c.id === 'messenger')).toMatchObject({ status: 'connected', number: 'Ibtekr Club', meta: { page_id: '111', ig_username: 'ibtekr.club' } });
  expect(mock.cs.channels.find((c) => c.id === 'instagram')).toMatchObject({ status: 'connected', number: '@ibtekr.club' });
  expect(mock.metaCalls.map((c) => c.action)).toEqual(['status', 'connect_start', 'connect_callback']);
  await page.locator('#cb-back').click();
  await expect(page).toHaveURL(/#cs-channels$/);
  await expect(P.locator('[data-channel="messenger"]')).toContainText('متصلة');
  await expect(P.locator('[data-channel="messenger"]')).toContainText('Ibtekr Club');
  await expect(P.locator('[data-channel="instagram"]')).toContainText('@ibtekr.club');
  await expect(P.locator('[data-meta-setup]')).toContainText('Ibtekr Club · @ibtekr.club');
  await expect(P.locator('[data-chan-disconnect="messenger"]')).toBeVisible();
  // the Messenger thread (second in the list: waiting for the customer): the composer is live, the reply goes through the channel
  await go(page, 'inbox');
  await P.locator('.cs-list .cv').nth(1).click();
  await expect(P.locator('.cs-ch .sub-t')).toContainText('ماسنجر');
  await expect(P.locator('[data-chan-off]')).toHaveCount(0);
  await expect(P.locator('[data-cmp-send]')).toBeEnabled();
  await P.locator('#cs-ta').fill('المقاس 60×90 متاح وبيتشحن خلال 5 أيام');
  await P.locator('[data-cmp-send]').click();
  await expect(P.locator('.cs-msgs .bub.b-out').last()).toContainText('✓ اتبعتت');
  expect(mock.cs.messages.at(-1)).toMatchObject({ kind: 'out', delivery: 'sent', external_id: /^m_mock_/ });
  expect(mock.metaCalls.at(-1)).toMatchObject({ action: 'send', body: { message_id: mock.cs.messages.at(-1).id } });
  // a refusal (outside the 24-hour window on Meta's side): the row stays, marked failed, and the member is told
  await P.locator('#cs-ta').fill('ارفض الرسالة دي');
  await P.locator('[data-cmp-send]').click();
  await expect(page.locator('.toast.show')).toContainText('Meta رفضتها');
  await expect(P.locator('.cs-msgs .bub.b-out').last()).toContainText('فشل الإرسال');
  expect(mock.cs.messages.at(-1)).toMatchObject({ kind: 'out', delivery: 'failed', meta: { error: 'graph_10:2018278' } });
  // the comments segment: a public reply through the composer, a private reply, hiding the comment
  await P.getByRole('tab', { name: /^التعليقات/ }).click(); // «التعليقات 1» (the count rides along)
  await expect(P.locator('.cs-ch .who b')).toHaveText('Noha H');
  await expect(P.locator('.cs-msgs .bub.b-in')).toContainText('السعر كام؟');
  // decision 19: the post the comment is on — a card over the chat (caption + «افتح البوست ↗» to the post) and a line in the list
  await expect(P.locator('.cs-post')).toContainText('مراية خشب دهبي');
  await expect(P.locator('.cs-post')).toContainText('بوست صور · فيسبوك');
  await expect(P.locator('[data-post-link]')).toHaveAttribute('href', 'https://www.facebook.com/ibtekr/posts/1');
  await expect(P.locator('[data-post-link]')).toHaveAttribute('target', '_blank');
  await expect(P.locator('.cv [data-post-line]').first()).toContainText('على: مراية خشب دهبي');
  // decision 20: the «البوست» filter — the posts with their open count; one post = its conversations only; back to all
  await expect(P.locator('.cs-items .cv')).toHaveCount(2);
  await P.locator('[data-post-filter]').click();
  await expect(page.locator('.post-menu [data-post-opt]')).toHaveCount(2);
  await page.locator('.post-menu [data-post-opt="111_p2"]').click();
  await expect(P.locator('.cs-items .cv')).toHaveCount(1);
  await expect(P.locator('.cs-items .cv .nm')).toHaveText('Ali S');
  await expect(P.locator('[data-post-filter]')).toContainText('البوست: ترابيزة قهوة رخام');
  await P.locator('[data-post-filter]').click();
  await page.locator('.post-menu .opt').first().click();
  await expect(P.locator('.cs-items .cv')).toHaveCount(2);
  await P.locator('.cs-items .cv', { hasText: 'Noha H' }).click();
  await P.locator('#cs-ta').fill('950 جنيه والشحن مجاني');
  await P.locator('[data-cmp-send]').click();
  await expect(P.locator('.cs-msgs .bub.b-out').last()).toContainText('✓ اتبعتت');
  expect(mock.metaCalls.at(-1).action).toBe('send');
  await P.locator('[data-comment-private]').click();
  await page.locator('.modal #cs-private-ta').fill('بعتنالك الكتالوج كامل هنا');
  await page.locator('.modal [data-private-send]').click();
  await expect(page.locator('.toast.show')).toContainText('اتبعت الرد الخاص');
  expect(mock.cs.messages.at(-1)).toMatchObject({ kind: 'out', delivery: 'sent', meta: { private: true } });
  expect(mock.metaCalls.at(-1).action).toBe('comment_private');
  await P.locator('[data-comment-hide]').click();
  await page.getByRole('button', { name: 'إخفاء', exact: true }).last().click();
  await expect(P.locator('.cs-msgs .evt').last()).toContainText('اتخفى');
  expect(mock.cs.messages.at(-1)).toMatchObject({ kind: 'event', meta: { hidden: '111_c1' } });
  await expect.poll(() => mock.activityRows.filter((x) => x.action.startsWith('cs.channel.')).map((x) => x.action)).toEqual(['cs.channel.link', 'cs.channel.connect', 'cs.channel.send', 'cs.channel.failed', 'cs.channel.send', 'cs.channel.private', 'cs.channel.hide', 'cs.channel.hide']); // the member's link start, the server's connect, then the sends / hide (server + adapter)
  expect(JSON.stringify(mock.activityRows)).not.toContain('950 جنيه');
  // disconnect: both channels back, the secret gone on the server
  await go(page, 'channels');
  await P.locator('[data-chan-disconnect="messenger"]').click();
  await page.getByRole('button', { name: 'فصل', exact: true }).last().click();
  await expect(P.locator('[data-channel="messenger"]')).toContainText('غير متصلة');
  await expect(P.locator('[data-channel="instagram"]')).toContainText('غير متصلة');
  expect(mock.meta.linked).toBe(false);
  // a spent state on the callback page says so
  await page.goto('/meta-callback.html?code=AQD-code-mock-1234&state=' + mock.oauthStates[0].state);
  await expect(page.locator('#cb-text')).toContainText('انتهت صلاحية الربط');
});

test('6.2 — several pages on the account: the callback page lists them and the pick links the chosen one', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-channels');
  mock.meta.pages.push({ id: '222', name: 'Side page', ig: null });
  await page.route('https://www.facebook.com/**', (route) => { const u = new URL(route.request().url()); route.fulfill({ status: 302, headers: { location: 'http://localhost:4173/meta-callback.html?code=AQD-code-mock-1234&state=' + u.searchParams.get('state') } }); });
  await pg(page).locator('[data-chan-connect="instagram"]').click();
  await expect(page.locator('#cb-title')).toHaveText('اختار الصفحة');
  await expect(page.locator('[data-pick-page]')).toHaveCount(2);
  await page.locator('[data-pick-page="111"]').click();
  await expect(page.locator('#cb-title')).toHaveText('اتربطت صفحة Ibtekr Club ✓');
  expect(mock.meta.page.id).toBe('111');
  expect(mock.metaCalls.map((c) => c.action)).toEqual(['status', 'connect_start', 'connect_callback', 'connect_pick']);
});

test('decision 26: WhatsApp 1 on Meta — «ربط» opens the Embedded Signup dialog; the callback links the number and asks for the history; a reply on wa1 goes through cs-whatsapp', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-channels');
  const P = pg(page);
  await page.route('https://www.facebook.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>facebook</body></html>' }));
  const [req] = await Promise.all([page.waitForRequest((r) => r.url().startsWith('https://www.facebook.com/v25.0/dialog/oauth')), P.locator('[data-chan-connect="wa1"]').click()]);
  const state = new URL(req.url()).searchParams.get('state');
  expect(state).toMatch(/^wa_/);
  expect(new URL(req.url()).searchParams.get('config_id')).toBe('5550001112');
  await page.goto('/meta-callback.html?code=code-123456&state=' + state);
  await expect(page.locator('#cb-title')).toContainText('اتربط واتساب');
  await expect(page.locator('#cb-text')).toContainText('آخر 6 شهور');
  expect(mock.waCloud.calls).toContain('connect_callback');
  await page.goto('/index.html#cs-channels');
  const P2 = pg(page);
  await expect(P2.locator('[data-channel="wa1"]')).toContainText('متصلة');
  await expect(P2.locator('[data-wa-setup]')).toContainText('+20 100 000 0001');
  await expect(P2.locator('[data-wa-setup]')).toContainText('اتطلبت');
  // a reply on a wa1 conversation: queued, then sent by cs-whatsapp
  const conv = mock.cs.conversations.find((c) => c.channel === 'wa1'); conv.external_id = '01000000011'; conv.last_in_at = new Date().toISOString();
  const r = await page.evaluate(async (id) => { await window.IBCS.load(); return window.IBCS.send(id, 'أهلا من السيستم'); }, conv.id);
  expect(r.ok).toBe(true);
  const m = mock.cs.messages.find((x) => x.text === 'أهلا من السيستم');
  expect([m.delivery, /^wamid\./.test(m.external_id)]).toEqual(['sent', true]);
  expect(mock.waCloud.calls).toContain('send');
});
