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
  await expect(P.locator('.cs-list .cv')).toHaveCount(1);
  await expect(P.locator('.cs-list .cv .nm')).toHaveText('سلوى زيتوني');
  await expect(P.locator('.cs-list .cv')).toContainText('سارة أحمد');
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
  await P.locator('.cs-list .cv [data-status-pick]').click();
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

test('campaigns: the wizard saves a draft, then a scheduled campaign with a segment made from the picked customers', async ({ page }) => {
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
  // a draft from the header action
  await P.getByRole('button', { name: 'حملة جديدة' }).click();
  await P.locator('#wz-name').fill('مسودة تجريبية');
  await P.locator('[data-wz-draft]').click();
  await expect(P.locator('.stepper')).toHaveCount(0);
  await expect(P.locator('.who-cell', { hasText: 'مسودة تجريبية' })).toBeVisible();
  expect(mock.cs.campaigns.find((x) => x.name === 'مسودة تجريبية').status).toBe('مسودة');
});

test('channels (all disconnected, connect waits for the next stages), performance from the loaded conversations, reports tab, the bell group «رسايل»', async ({ page }) => {
  await signIn(page, ADMIN, '#cs-channels');
  const P = pg(page);
  await expect(P.locator('[data-channel]')).toHaveCount(5);
  await expect(P.locator('[data-channel="wa1"]')).toContainText('غير متصلة');
  await P.locator('[data-chan-connect="messenger"]').click();
  await expect(page.locator('.toast.show')).toContainText('المرحلة الجاية');
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
