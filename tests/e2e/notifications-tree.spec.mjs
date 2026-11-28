import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, ART_LOGO, IMG } from './supabase-mock.mjs';

// The notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md, 0157): «الإعدادات › التنبيهات»
// is the tree the bell shows — the admin adds a main section, a sub-section under it and an alert (element › type › state, time, repeat,
// visibility, roles, message), and the bell shows the same groups and filters with the alerts the rules wrote: the new one with the
// green dot, the read below the unread, the read filter and the sort. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const M1 = '00000000-0000-4000-8000-0000000005a1'; const S1 = '00000000-0000-4000-8000-0000000005a2'; const M2 = '00000000-0000-4000-8000-0000000005b1'; const S2 = '00000000-0000-4000-8000-0000000005b2';
const now = Date.now(); const iso = (min) => new Date(now - min * 60000).toISOString();
const TREE = {
  sections: [{ id: M1, parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: S1, parent_id: M1, name: 'غير مؤكدة', sort: 0 },
    { id: M2, parent_id: null, name: 'الفريق', sort: 1 }, { id: S2, parent_id: M2, name: 'الحضور والانصراف', sort: 0 }],
  rules: [{ id: 'r1', section_id: S1, name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد', at: '09:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin', 'cs'] },
    { id: 'r2', section_id: S2, name: 'لم يسجل انصراف', element: 'team', type: 'status', state: 'no_out', at: '23:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin'] }],
};
const ALERTS = [
  { id: 501, at: iso(5), kind: 'rule:orders.confirm', title: 'أوردر غير مؤكد — IB-180656', body: 'غير مؤكد · عمره 2 يوم', role_id: null, user_id: ADMIN_ID, entity: 'orders/180656', entity_id: 'o:1', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null },
  { id: 502, at: iso(90), kind: 'rule:orders.confirm', title: 'أوردر غير مؤكد — IB-180651', body: 'غير مؤكد', role_id: null, user_id: ADMIN_ID, entity: 'orders/180651', entity_id: 'o:2', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null },
  { id: 503, at: iso(30), kind: 'hr.overtime', title: 'وقت إضافي محتاج قرارك', body: null, role_id: null, user_id: ADMIN_ID, entity: 'hr', entity_id: null, read_at: null, rule_id: null, section_id: null, hide_at: null },
  { id: 504, at: iso(400), kind: 'rule:orders.confirm', title: 'اتخفى', body: '', role_id: null, user_id: ADMIN_ID, entity: 'orders', entity_id: 'o:3', read_at: null, rule_id: 'r1', section_id: S1, hide_at: iso(60) },
];
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { notifTree: { ...JSON.parse(JSON.stringify(TREE)) } });
  mock.alerts = JSON.parse(JSON.stringify(ALERTS)); mock.alertReads = [{ alert_id: 502, user_id: ADMIN_ID }];
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, hash) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  if (hash) await page.evaluate((x) => { location.hash = x; }, hash);
  // the settings page draws again once its data lands (block 17 on ib:settings) and a redraw closes the header's popovers — the bell
  // opened before that closed under the test (the 0164 flake on CI): wait for the data and the redraw after it
  if (hash && /^settings/.test(hash)) {
    await page.waitForFunction(() => window.IBSettings && window.IBSettings.data && window.IBSettings.data.loaded);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

test('the bell = the settings\' tree: its groups and filters, nothing more (a rule-less alert is nowhere — Safwat 25 Nov), the hidden one gone, the green dot, the read below the unread, the read filter, the sort', async ({ page }) => {
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const bell = page.locator('.menu.notif');
  await expect(bell.locator('.ntf-nav-item')).toHaveText([/خدمة العملاء/, /الفريق/]);
  await expect(bell.locator('.ntf-nav-item').first().locator('.cnt')).toHaveText('1'); // 501 unread; 502 read; 504 hidden
  await expect(bell.locator('.tab')).toHaveText([/الكل \(2\)/, /غير مؤكدة \(2\)/]); // Safwat 24 Nov: no «غير مقروء» / «مقروء» tabs
  await expect(bell.locator('.ntf-item')).toHaveCount(2);
  await expect(bell.locator('.ntf-item').first()).toContainText('IB-180656'); await expect(bell.locator('.ntf-item').first().locator('.ntf-dot')).toBeVisible();
  await expect(bell.locator('.ntf-item').nth(1).locator('.ntf-dot')).toHaveCount(0);
  await expect(bell).not.toContainText('اتخفى');
  // the sort: the oldest first
  await bell.locator('#ntf-sort').click(); await expect(bell.locator('#ntf-sort')).toHaveAttribute('data-sort', 'old'); // the bell's redesign: one small button (newest ⇄ oldest)
  // … the unread one stays first all the same (Safwat 24 Nov — «المقروء … بينزل دايما تحت غير المقروء»)
  await expect(bell.locator('.ntf-item').first()).toContainText('IB-180656'); await expect(bell.locator('.ntf-item').nth(1)).toContainText('IB-180651');
  // the read filter beside the sort: الكل → غير مقروء → مقروء → الكل
  // a dropdown since 25 Nov («خلي الكل يبقا فيها دروب داون»): the button opens the three, the picked one ticked
  await bell.locator('#ntf-read').click(); await expect(bell.locator('#ntf-readmenu .opt')).toHaveText(['الكل', 'غير مقروء', 'مقروء']);
  await expect(bell.locator('#ntf-readmenu [aria-checked=true]')).toHaveText('الكل');
  await bell.locator('[data-read-opt=unread]').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'unread'); await expect(bell.locator('#ntf-readmenu')).toBeHidden();
  await expect(bell.locator('.ntf-item')).toHaveCount(1); await expect(bell.locator('.ntf-item')).toContainText('IB-180656');
  await bell.locator('#ntf-read').click(); await bell.locator('[data-read-opt=read]').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'read');
  await expect(bell.locator('.ntf-item')).toHaveCount(1); await expect(bell.locator('.ntf-item')).toContainText('IB-180651');
  await bell.locator('#ntf-read').click(); await bell.locator('[data-read-opt=all]').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'all'); await expect(bell.locator('.ntf-item')).toHaveCount(2);
  // «الفريق»: the overtime alert written by the database (no rule) is not in the bell — only what the settings hold (Safwat 25 Nov — «لا أزيد
  // ولا أقل»); the group and its tab are there all the same, at zero
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.tab')).toHaveText([/الكل \(0\)/, /الحضور والانصراف \(0\)/]); // 0163 (the bell by role): every tab there, even at zero
  await expect(bell.locator('.ntf-item')).toHaveCount(0);
  await expect(bell).not.toContainText('وقت إضافي محتاج قرارك');
});

test('«الإعدادات › التنبيهات»: a main section, a sub-section and an alert by Safwat\'s form → the bell shows the new group and filter at once', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await expect(page.locator('[data-set-save]')).toHaveCount(0); // each change saves at once
  const tree = page.locator('[data-nr-tree]');
  // the main sections as tabs (Safwat 24 Nov — «في تابس اسهل من تحت بعضها»): one shown at a time, each tab with its alerts' count
  await expect(tree.locator('[data-nr-tab]')).toHaveCount(2);
  await expect(tree.locator('[data-nr-main]')).toHaveCount(1);
  await expect(tree.locator('[data-nr-tab]').first()).toHaveAttribute('aria-selected', 'true');
  await expect(tree.locator('[data-nr-rule]')).toHaveCount(1);
  await tree.locator('[data-nr-tab]').nth(1).click();
  await expect(tree.locator('[data-nr-tab]').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tree.locator('[data-nr-rule]')).toHaveCount(1);
  // a new main section
  await page.locator('[data-nr-add-main]').click();
  await page.locator('#ns-name').fill('الحسابات'); await page.locator('.modal[role=dialog]').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(tree.locator('[data-nr-tab]')).toHaveCount(3);
  await expect(tree.locator('[data-nr-tab]', { hasText: 'الحسابات' })).toHaveAttribute('aria-selected', 'true'); // the new one opens
  const acc = tree.locator('[data-nr-main]', { hasText: 'الحسابات' });
  // a sub-section under it
  await acc.locator('[data-nr-add-sub]').click();
  await page.locator('#ns-name').fill('العهدة'); await page.locator('.modal[role=dialog]').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(acc.locator('[data-nr-sub]')).toHaveCount(1);
  // an alert: the form refuses without a name / the element, then saves
  await acc.locator('[data-nr-add]').click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'إضافة تنبيه' });
  await form.locator('[data-nr-save]').click();
  await expect(form.locator('.ferr')).toHaveText('اكتب اسم التنبيه');
  await form.locator('#nr-name').fill('العهدة قربت تخلص');
  await form.locator('#nr-el').click();
  await expect(page.getByRole('option', { name: 'الذكاء الاصطناعي' })).toHaveCount(0); // the assistants' element lives in their section only (Safwat 25 Nov)
  await page.getByRole('option', { name: 'عهدة التشغيل' }).click();
  await form.locator('#nr-type').click(); await page.getByRole('option', { name: 'الرصيد' }).click();
  await form.locator('#nr-state').click(); await page.getByRole('option', { name: 'العهدة قربت تخلص' }).click();
  await expect(form.locator('#nr-param')).toHaveValue('200'); // the state's number (the floor) with its default
  // e-mail and WhatsApp pickable (Safwat 24 Nov); their switches above the tree are off here, and the label says so
  await expect(form.locator('[data-nr-channels] [role=checkbox]', { hasText: 'إيميل' })).toContainText('مقفول من فوق');
  await expect(form.locator('[data-nr-channels] [role=checkbox]', { hasText: 'واتساب' })).toContainText('واقف لحد تشغيل الـ API');
  await form.locator('[data-nr-channels] [role=checkbox]', { hasText: 'إيميل' }).click();
  await form.locator('[data-nr-roles] [role=checkbox]', { hasText: 'حسابات' }).click();
  await form.locator('#nr-tpl').fill('الحق الفلوس قربت تخلص — {التفاصيل}');
  await form.locator('[data-nr-save]').click();
  await expect(form).toHaveCount(0);
  const saved = mock.notif.rules.find((r) => r.name === 'العهدة قربت تخلص');
  expect([saved.element, saved.type, saved.state, saved.param, saved.roles, saved.channels, saved.show]).toEqual(['custody', 'balance', 'low', 200, ['accounts'], ['bell', 'email'], 'until_state']);
  await expect(acc.locator('[data-nr-rule]')).toContainText('عهدة التشغيل › الرصيد › العهدة قربت تخلص');
  // the bell: the new group with its filter, as it is in the settings
  await page.evaluate(() => window.IBAlerts.load());
  await page.locator('.notif-btn').click();
  await expect(page.locator('.menu.notif .ntf-nav-item')).toHaveText([/خدمة العملاء/, /الفريق/, /الحسابات/]);
  await page.locator('.menu.notif .ntf-nav-item', { hasText: 'الحسابات' }).click();
  await expect(page.locator('.menu.notif .tab')).toHaveText([/الكل \(0\)/, /العهدة \(0\)/]); // 0163 (the bell by role): the sub-section ready at zero
});

test('Safwat 28 Nov — «+ تنبيه» outlined under the filled «+ قسم فرعي»; «الأعطال › وجود عطل» and «مساحة التخزين › التخزين امتلأ» (80% by default) in the form', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  const tree = page.locator('[data-nr-tree]');
  const add = tree.locator('[data-nr-add]').first(); const sub = tree.locator('[data-nr-add-sub]').first();
  await expect(add).toBeVisible();
  const bg = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(add)).toBe('rgba(0, 0, 0, 0)');
  expect(await bg(sub)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await add.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('solid');
  await add.click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'إضافة تنبيه' });
  await form.locator('#nr-el').click(); await page.getByRole('option', { name: 'الأعطال' }).click();
  await form.locator('#nr-type').click(); await page.getByRole('option', { name: 'الأعطال' }).click();
  await form.locator('#nr-state').click(); await expect(page.getByRole('option', { name: 'وجود عطل' })).toHaveCount(1); await page.getByRole('option', { name: 'وجود عطل' }).click();
  await form.locator('#nr-el').click(); await page.getByRole('option', { name: 'مساحة التخزين' }).click();
  await form.locator('#nr-type').click(); await page.getByRole('option', { name: 'المساحة' }).click();
  await form.locator('#nr-state').click(); await page.getByRole('option', { name: 'التخزين امتلأ' }).click();
  await expect(form.locator('#nr-param')).toHaveValue('80');
});

test('an alert switched off and deleted from the settings; a sub-section renamed', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await page.locator('[data-nr-tab]').nth(1).click(); // r2 is under the second main section's tab
  const rule = page.locator('[data-nr-rule="r2"]');
  await rule.getByRole('switch').click();
  await expect.poll(() => mock.notif.rules.find((r) => r.id === 'r2').active).toBe(false);
  await rule.getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'حذف' }).click();
  await page.getByRole('button', { name: 'احذف' }).click();
  await expect.poll(() => mock.notif.rules.some((r) => r.id === 'r2')).toBe(false);
  await page.locator('[data-nr-tab="' + M1 + '"]').click();
  const sub = page.locator('[data-nr-sub="' + S1 + '"]');
  await sub.locator('.nr-sub-h').getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click();
  await page.locator('#ns-name').fill('مستني تأكيد'); await page.locator('.modal[role=dialog]').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(sub).toContainText('مستني تأكيد');
});

test('«إرسال برّه الجرس»: the admin\'s e-mail / WhatsApp switches above the tree save settings «notif».channels at once (Safwat 24 Nov — WhatsApp waits for its API)', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  const box = page.locator('[data-nr-out]');
  await expect(box).toContainText('واقف لحد تشغيل الـ API');
  await box.locator('#nr-out-email').click();
  await expect.poll(() => page.evaluate(() => window.IBSettings.section('notif').channels)).toEqual({ email: true, whatsapp: false });
});

// the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): a maker's delay alerts are one card that
// opens his late orders (with «مشاركة»); the critical first with its tag; a member's alert carries his first letter. The maker's card
// (Safwat 25 Nov — decision 19, «الكارت ثابت و الحالات بس اللي تتغير»): his logo, his name and phone (copy / WhatsApp — read on the page,
// never in the alert), the states with their counts, his sub-orders and pieces, and every sub-order number to copy, «نسخ الكل» too
test('the bell\'s redesign: a maker\'s card — logo, phone, states, numbers to copy — opens his late orders; the critical first, the owner instead of the bell', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // his logo is the site's picture: answered here (never the real host — a host that does not resolve fails the image at once in CI
  // and the card falls back to his first letter, which made this check pass or fail on timing)
  await page.route(ART_LOGO, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(IMG.curtain.split(',')[1], 'base64') }));
  const ART = 'a0000000-0000-4000-8000-000000000001';
  const vm = (st, pcs, nums) => ({ lv: st === 'late' ? 'critical' : 'important', g: 'vendor', gid: ART, gname: 'Art Craft', n: nums.length, pcs, st, sk: st, nums, v: { n: 'Art Craft', s: st === 'late' ? 'متأخر' : 'قابل للتأخير' } });
  mock.alerts = [
    { id: 601, at: iso(10), kind: 'rule:makers.making', title: 'أوردر فرعي متأخر', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'makers', entity_id: 'mk:late:a', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: vm('late', 5, ['9101', '9102']) },
    { id: 603, at: iso(30), kind: 'rule:makers.making', title: 'أوردر فرعي متأخر', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'makers', entity_id: 'x1|mk:risk:a', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: vm('risk', 2, ['9201']) },
    { id: 604, at: iso(1), kind: 'rule:orders.update', title: 'أوردر جديد — IB-9', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/9', entity_id: 'onew:9', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'info' } },
    { id: 605, at: iso(5), kind: 'rule:team.status', title: 'لم يسجل انصراف', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'hr-team', entity_id: 'noout:1', read_at: null, rule_id: 'r2', section_id: S2, hide_at: null, meta: { lv: 'important', g: 'member', gid: 'm1', gname: 'سارة أحمد' } },
    // a confirmed order of his: the same card, its own state
    { id: 606, at: iso(40), kind: 'rule:makers.making', title: 'أوردر مؤكد جديد للمبتكر — IB-180656', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/180656', entity_id: 'mk:confirmed:1', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null,
      meta: { lv: 'info', g: 'vendor', gid: ART, gname: 'Art Craft', n: 1, pcs: 2, sk: 'confirmed', nums: ['180656'], v: { n: 'Art Craft', s: 'أوردر مؤكد' } } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const bell = page.locator('.menu.notif');
  await expect(bell.locator('.ntf-head.tree')).toContainText('4 محتاج تتصرف'); await expect(bell.locator('.ntf-head.tree')).toContainText('1 حرج');
  await expect(bell.locator('.ntf-nav-item').first().locator('.cnt.hot')).toBeVisible();
  const items = bell.locator('.ntf-item');
  await expect(items).toHaveCount(3); // the maker's late and about-to-be alerts = one card; the confirmed one its own card; the new order (info)
  const card = items.first();
  await expect(card).toHaveClass(/lv-critical/); await expect(card.locator('[data-ntf-name]')).toHaveText('Art Craft');
  await expect(card.locator('.ntf-lv')).toHaveText('حرج');
  await expect(card.locator('.av.img')).toHaveCount(1); // his logo
  await expect(card.locator('[data-ntf-state]')).toHaveText(['2 متأخر', '1 قابل للتأخير']);
  await expect(card.locator('[data-ntf-subs]')).toHaveText('3 أوردر فرعي'); await expect(card.locator('[data-ntf-chip]')).toContainText(['7 قطع']);
  await expect(card.locator('[data-ntf-phone]')).toHaveText('01000000003'); await expect(card.locator('[data-ntf-wa]')).toHaveAttribute('href', 'https://wa.me/201000000003');
  await expect(card.locator('[data-ntf-num]')).toHaveText(['#9101', '#9102', '#9201']);
  await expect(card.locator('[data-ntf-num="9201"]')).toHaveClass(/risk/);
  await card.locator('[data-ntf-num-copy="9102"]').click(); // its copy mark copies it — the card stays (Safwat 28 Nov)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('9102');
  await card.locator('[data-ntf-nums-all]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('9101\n9102\n9201');
  await expect(bell).toBeVisible();
  // the confirmed order: the same card — his name, phone and number — its state green
  const conf = items.filter({ has: page.locator('[data-ntf-state="ok"]') });
  await expect(conf.locator('[data-ntf-state]')).toHaveText('أوردر مؤكد'); await expect(conf.locator('[data-ntf-num]')).toHaveText(['#180656']); await expect(conf.locator('[data-ntf-phone]')).toHaveText('01000000003');
  for (const a of mock.alerts) expect(JSON.stringify(a.meta || {})).not.toContain('01000000003'); // the phone is never in the alert
  // bell-redesign decision 20 (Safwat 28 Nov): a number not on the orders page says so; one that is opens its order over the page
  await card.locator('[data-ntf-num-open="9101"]').click(); await expect(page.getByRole('status').filter({ hasText: 'مش ظاهر في صفحة الأوردرات' })).toHaveCount(1);
  await conf.locator('[data-ntf-num-open="180656"]').click();
  await expect(page.locator('#orders #cdlg').first()).toBeVisible(); await expect(bell).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.locator('.notif-btn').click(); const bell2 = page.locator('.menu.notif'); await expect(bell2).toBeVisible();
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.ntf-item').first().locator('.av.letter')).toHaveText('س');
  await bell.locator('.ntf-nav-item', { hasText: 'خدمة العملاء' }).click();
  await bell.locator('.ntf-item').first().locator('.txt>b').click();
  // Safwat 28 Nov (alert-popup decision 1): the card opens the one alert popup — his mark and card, his late orders and «مشاركة مع المبتكر» inside
  const pop = page.locator('.modal[data-alert-popup]'); await expect(pop).toBeVisible(); await expect(pop).toContainText('Art Craft');
  await expect(pop.locator('.ap-head .av')).toHaveCount(1); await expect(pop.locator('.ap-lv')).toHaveText('حرج');
  await expect(pop.locator('[data-ap-act="share"]')).toHaveCount(1); await expect(page).toHaveURL(/#dashboard/);
  // a number on his card inside the popup: one not on the orders page says so, and the popup stays on the alert
  await pop.locator('[data-ntf-num-open="9101"]').click(); await expect(page.getByRole('status').filter({ hasText: 'مش ظاهر في صفحة الأوردرات' }).first()).toBeVisible();
  await expect(pop.locator('[data-ap-view="main"]')).toBeVisible();
  await expect.poll(() => [601, 603].every((id) => mock.alertReads.some((r) => r.alert_id === id))).toBe(true);
});

test('the rule\'s roles: green labels with ×, and «+» adds one — saved at once', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  const rule = page.locator('[data-nr-rule="r1"]'); const roles = rule.locator('[data-nr-roles-of="r1"]');
  await expect(roles.locator('.nr-role')).toHaveCount(2);
  await roles.locator('.nr-role', { hasText: 'خدمة العملاء' }).locator('.x').click();
  await expect.poll(() => (mock.notif.rules.find((r) => r.id === 'r1') || {}).roles).toEqual(['admin']);
  await expect(page.locator('[data-nr-roles-of="r1"] .nr-role')).toHaveCount(1);
  await expect(page.locator('[data-nr-roles-of="r1"] .nr-role .x')).toBeDisabled(); // the last role stays
  await page.locator('[data-nr-roles-of="r1"] .nr-role-add').click();
  await page.getByRole('menuitem', { name: 'خدمة العملاء' }).click();
  await expect.poll(() => (mock.notif.rules.find((r) => r.id === 'r1') || {}).roles).toEqual(['admin', 'cs']);
});

test('0162 several elements in one alert: «+ عنصر تاني» with its own lists and ×, «طريقة التنبيه» فردي / تقرير — saved as conds + mode; the card says them', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await page.locator('[data-nr-rule="r1"] > .pop-anchor [aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'تعديل التنبيه' });
  await form.locator('[data-nr-cond-add]').click();
  await expect(form.locator('[data-nr-cond]')).toHaveCount(1);
  await form.locator('[data-nr-save]').click();
  await expect(form.locator('.ferr')).toHaveText('اختار العنصر (العنصر 2)');
  await form.locator('#nr-el-2').click(); await page.getByRole('option', { name: 'الأوردرات الرئيسية' }).click();
  await form.locator('#nr-type-2').click(); await page.getByRole('option', { name: 'حالة التأخير' }).click();
  await form.locator('#nr-state-2').click(); await page.getByRole('option', { name: 'متأخر', exact: true }).click();
  await expect(form.locator('[data-nr-level]')).toHaveAttribute('data-nr-level', 'critical'); // the highest of its elements
  // a third one, then × takes it off
  await form.locator('[data-nr-cond-add]').click(); await expect(form.locator('[data-nr-cond]')).toHaveCount(2);
  await form.locator('[data-nr-cond-x="1"]').click(); await expect(form.locator('[data-nr-cond]')).toHaveCount(1);
  await expect(form.locator('[data-nr-mode-pick="single"]')).toHaveAttribute('aria-checked', 'true');
  await form.locator('[data-nr-mode-pick="report"]').click(); await expect(form.locator('[data-nr-mode-pick="report"]')).toHaveAttribute('aria-checked', 'true');
  await form.locator('[data-nr-save]').click();
  await expect(form).toHaveCount(0);
  const r1 = mock.notif.rules.find((r) => r.id === 'r1');
  expect([r1.mode, r1.conds]).toEqual(['report', [{ element: 'orders', type: 'delay', state: 'late', sub: null, param: null }]]);
  const card = page.locator('[data-nr-rule="r1"]');
  await expect(card).toContainText('الأوردرات الرئيسية › حالة التأكيد › غير مؤكد + الأوردرات الرئيسية › حالة التأخير › متأخر');
  await expect(card.locator('[data-nr-mode="report"]')).toHaveText('تقرير');
  await expect(card).toHaveClass(/lv-critical/); // the highest level of its elements on the card's edge
  await expect(page.locator('[data-nr-stats]')).toContainText('حرج');
});

test('Safwat 28 Nov — any alert opens one popup in the middle: an order\'s details editable inside it (the order page\'s own confirm), «رجوع للتنبيه»; a page only by «روح للصفحة»', async ({ page }) => {
  mock.alerts = [
    { id: 801, at: iso(2), kind: 'rule:orders.confirm', title: 'أوردر في انتظار الرد — IB-180656', body: 'في انتظار الرد · عمره 10 يوم', role_id: null, user_id: ADMIN_ID, entity: 'orders/180656', entity_id: 'o:180656', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'important' } },
    { id: 802, at: iso(4), kind: 'rule:team.status', title: 'لم يسجل انصراف', body: 'سارة مسجّلتش انصراف', role_id: null, user_id: ADMIN_ID, entity: 'hr-team', entity_id: 'noout:9', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'important' } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  await page.locator('.menu.notif .ntf-item', { hasText: 'IB-180656' }).click();
  const ap = page.locator('.modal[data-alert-popup]'); await expect(ap).toBeVisible();
  await expect(page.locator('.menu.notif')).toHaveCount(0); await expect(page).toHaveURL(/#dashboard/);
  await expect.poll(() => mock.alertReads.some((r) => r.alert_id === 801)).toBe(true); // read as it opens
  await expect(ap.locator('[data-ap-view="main"]')).toContainText('عمره 10 يوم');
  await ap.locator('[data-ap-act="order"]').click();
  await expect(ap.locator('[data-ap-view="order"]')).toContainText('IB-180656');
  await expect(ap.locator('[data-ap-view="order"]')).toContainText('<img src=x'); // the customer's name is text
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // editable: the confirm status — the order page's own confirmation, then its write
  await ap.locator('#ap-cf').selectOption('غير مؤكد');
  const ok = page.locator('.modal[role=dialog]', { hasText: 'تحديث الأوردر IB-180656' }); await expect(ok).toBeVisible();
  await ok.getByRole('button', { name: 'أكّد وسجّل' }).click();
  await expect.poll(() => mock.orders.find((o) => o.id === 180656).confirm).toBe('غير مؤكد');
  await ap.locator('[data-ap-back]').click(); await expect(ap.locator('[data-ap-view="main"]')).toBeVisible();
  await ap.getByRole('button', { name: 'إغلاق', exact: true }).last().click(); await expect(ap).toHaveCount(0);
  // another alert: a page — its name in the action, a view inside the popup, and the page only by «روح للصفحة»
  await page.locator('.notif-btn').click();
  await page.locator('.menu.notif .ntf-item', { hasText: 'لم يسجل انصراف' }).click();
  await ap.locator('[data-ap-act="page"]').click();
  await expect(ap.locator('[data-ap-page="hr-team"]')).toBeVisible(); await expect(page).toHaveURL(/#dashboard/);
  await ap.locator('[data-ap-goto]').click(); await expect(ap).toHaveCount(0); await expect(page).toHaveURL(/#hr-team/);
});

test('0162 a «تقرير» alert in the bell opens one table with every thing of its elements — a chip per element filters it, a row opens its order, «مشاركة»', async ({ page }) => {
  const items = [{ p: 'الأوردرات الرئيسية › غير مؤكد', t: 'أوردر غير مؤكد — IB-180656', b: 'غير مؤكد · عمره 2 يوم', e: 'orders/180656', g: null },
    { p: 'الأوردرات الرئيسية › غير مؤكد', t: 'أوردر غير مؤكد — IB-180651', b: 'غير مؤكد', e: 'orders/180651', g: null },
    { p: 'المبتكرين › أوردرات متأخرة', t: 'أوردر فرعي متأخر — IB-7', b: 'Art Craft · 2 منتج', e: 'orders/7', g: 'Art Craft' }];
  mock.alerts = [{ id: 701, at: iso(3), kind: 'rule:report', title: 'الشغل المتأخر — 3', body: '2 الأوردرات الرئيسية › غير مؤكد · 1 المبتكرين › أوردرات متأخرة', role_id: null, user_id: ADMIN_ID, entity: null, entity_id: 'report', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'critical', report: true, n: 3, items } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  await page.locator('.menu.notif .ntf-item').first().click();
  const pop = page.locator('.modal[data-alert-popup]', { has: page.locator('[data-alert-report]') });
  await expect(pop).toContainText('الشغل المتأخر');
  await expect(pop.locator('[data-ar-row]')).toHaveCount(3);
  await expect(pop.locator('thead th')).toHaveText(['العنصر', 'التنبيه', 'التفاصيل', 'صاحبه']);
  await pop.locator('[data-ar-part="المبتكرين › أوردرات متأخرة"]').click();
  await expect(pop.locator('[data-ar-row]')).toHaveCount(1); await expect(pop.locator('[data-ar-row]')).toContainText('Art Craft');
  await pop.locator('[data-ar-part=""]').click(); await expect(pop.locator('[data-ar-row]')).toHaveCount(3);
  await expect(pop.locator('[data-ap-act="share"]')).toBeEnabled();
  // Safwat 28 Nov: a row opens its order inside the same popup, «رجوع للتنبيه» brings the table back
  await pop.locator('[data-ar-row]').first().click();
  const ap = page.locator('.modal[data-alert-popup]'); // the same popup (the table is not in this view)
  await expect(ap.locator('[data-ap-view="order"]')).toBeVisible(); await expect(page).toHaveURL(/#dashboard/);
  await ap.locator('[data-ap-back]').click(); await expect(ap.locator('[data-ar-row]')).toHaveCount(3);
});

test('0163 the bell by role: a member sees only the main sections whose rules go to his roles, with all their sub-sections even at zero', async ({ page }) => {
  const M3 = '00000000-0000-4000-8000-0000000005c1'; const S3 = '00000000-0000-4000-8000-0000000005c2'; const S4 = '00000000-0000-4000-8000-0000000005c3';
  mock.notif.sections.push({ id: M3, parent_id: null, name: 'العمليات والشحن', icon: 'truck', sort: 2 }, { id: S3, parent_id: M3, name: 'جاهز للشحن للمخزن', icon: null, sort: 0 }, { id: S4, parent_id: M3, name: 'التجميع', icon: null, sort: 1 });
  mock.notif.rules.push({ id: 'r3', section_id: S3, name: 'جاهز للشحن للمخزن', element: 'subs', type: 'status', state: 'ready_hub', at: '09:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin', 'ops'], channels: ['bell'], active: true, sub: null, param: null, days: [], template: null, sort: 0 },
    { id: 'r4', section_id: S4, name: 'تجميع أوردر عدّى مدته', element: 'inventory', type: 'consolidation', state: 'late', at: '09:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin', 'ops'], channels: ['bell'], active: true, sub: null, param: null, days: [], template: null, sort: 0 });
  mock.alerts = [{ id: 801, at: iso(5), kind: 'rule:subs.status', title: 'جاهز للشحن للمخزن — IB-5', body: 'x', role_id: null, user_id: '00000000-0000-4000-8000-000000000002', entity: 'orders/5', entity_id: 'x:5', read_at: null, rule_id: 'r3', section_id: S3, hide_at: null, meta: { lv: 'important' } }];
  mock.alertReads = [];
  await page.goto('/');
  await page.fill('#lg-id', 'ops.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await page.locator('.notif-btn').click();
  const bell = page.locator('.menu.notif');
  await expect(bell.locator('.ntf-nav-item')).toHaveText([/العمليات والشحن/]); // not «خدمة العملاء» (cs) nor «الفريق» (admin)
  await expect(bell.locator('.tab')).toHaveText([/الكل \(1\)/, /جاهز للشحن للمخزن \(1\)/, /التجميع \(0\)/]); // «التجميع» there at zero
});

// 0164 (Safwat 24 Nov — «اي تعديلات اعملها في اعدادات التبيهات تسمع في البوب اب بتاع التنبيهات بمجرد الحفظ»): the rule's element changed in
// its form → its old alerts leave the bell at once, without a reload
test('0164 a rule\'s element changed in the settings: its old alerts leave the bell the moment it is saved', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await page.locator('.notif-btn').click();
  await expect(page.locator('.menu.notif .ntf-item', { hasText: 'IB-180656' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('[data-nr-rule="r1"]').getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'تعديل التنبيه' });
  await form.locator('#nr-el').click(); await page.getByRole('option', { name: 'عهدة التشغيل' }).click();
  await form.locator('#nr-type').click(); await page.getByRole('option', { name: 'الرصيد' }).click();
  await form.locator('#nr-state').click(); await page.getByRole('option', { name: 'العهدة قربت تخلص' }).click();
  await form.locator('[data-nr-save]').click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => mock.alerts.find((a) => a.id === 501).hide_at).not.toBeNull();
  await page.locator('.notif-btn').click();
  await expect(page.locator('.menu.notif .ntf-item', { hasText: 'IB-180656' })).toHaveCount(0);
});

// Safwat 24 Nov — «لما ادوس علي التابس اللي جوه التنبيهات تبطل تتنقل لاول الكاروسيل لوحدها»: a chip far along the strip pressed → the
// strip stays where it was (the picked chip in view), it never jumps back to its start
test('the bell\'s sub-section chips: pressing one far along the strip keeps the strip where it was', async ({ page }) => {
  const subs = Array.from({ length: 9 }, (_, i) => ({ id: '00000000-0000-4000-8000-0000000005c' + i, parent_id: M1, name: 'قسم فرعي طويل شوية رقم ' + (i + 1), sort: i + 1 }));
  mock.notif.sections.push(...subs);
  mock.notif.rules.push(...subs.map((x, i) => ({ id: 'rx' + i, section_id: x.id, name: 'x' + i, element: 'orders', type: 'confirm', state: 'غير مؤكد', at: '09:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin'], sub: null, param: null, days: [], channels: ['bell'], template: null, active: true, sort: 0 })));
  await page.setViewportSize({ width: 1100, height: 800 });
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const strip = page.locator('.menu.notif .ntf-chiptabs');
  await expect(strip.locator('.tab')).toHaveCount(11);
  const far = strip.locator('.tab').nth(8);
  await far.scrollIntoViewIfNeeded();
  const before = await strip.evaluate((x) => x.scrollLeft);
  expect(Math.abs(before)).toBeGreaterThan(50); // the strip did move
  await far.click();
  await expect(strip.locator('.tab').nth(8)).toHaveAttribute('aria-selected', 'true');
  const after = await page.locator('.menu.notif .ntf-chiptabs').evaluate((x) => x.scrollLeft);
  expect(Math.abs(after - before)).toBeLessThan(40);
  await expect(page.locator('.menu.notif .ntf-chiptabs .tab').nth(8)).toBeInViewport();
});

// 0165 (Safwat 24 Nov — «خلي المستخدم يقدر يختار اهمية التنبية … حرج … مهم … عادي … للمعرفة»): four levels in the alert's form, the
// state's own picked till the admin picks; saved with the rule, on its card, and the bell's alerts follow it
test('0165 the alert\'s level: four to pick in its form — saved with the rule, on its card and in the bell', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await page.locator('[data-nr-rule="r1"]').getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'تعديل التنبيه' });
  const pick = form.locator('[data-nr-level-pick]');
  await expect(pick).toHaveText([/حرج/, /مهم/, /عادي/, /للمعرفة/]);
  await expect(form.locator('[data-nr-level-pick="important"]')).toHaveAttribute('aria-checked', 'true'); // the state's own
  await expect(form.locator('[data-nr-level]')).toContainText('تلقائي من الوضع');
  await form.locator('[data-nr-level-pick="normal"]').click();
  await expect(form.locator('[data-nr-level-pick="normal"]')).toHaveAttribute('aria-checked', 'true');
  await expect(form.locator('[data-nr-level]')).toContainText('اخترتها إنت');
  await form.locator('[data-nr-save]').click(); await expect(form).toHaveCount(0);
  expect(mock.notif.rules.find((r) => r.id === 'r1').level).toBe('normal');
  await expect(page.locator('[data-nr-rule="r1"] .nr-lv')).toHaveText('عادي');
  // the bell: an alert of that level carries «عادي», below the important ones
  mock.alerts.find((a) => a.id === 501).meta = { lv: 'normal' };
  await page.evaluate(() => window.IBAlerts.load());
  await page.locator('.notif-btn').click();
  await expect(page.locator('.menu.notif .ntf-item', { hasText: 'IB-180656' }).locator('.ntf-lv')).toHaveText('عادي');
});

// Safwat 25 Nov — «كل تنبيهات المساعدين بتيجي جوه المساعدين بس»: in the assistants' main section a new alert's element is «الذكاء الاصطناعي»
// and nothing else
test('0167 the assistants\' section: a new alert there offers the assistants\' element only', async ({ page }) => {
  const M9 = '00000000-0000-4000-8000-0000000005d1'; const S9 = '00000000-0000-4000-8000-0000000005d2';
  mock.notif.sections.push({ id: M9, parent_id: null, name: 'مساعدين الذكاء الاصطناعي', icon: null, sort: 9 }, { id: S9, parent_id: M9, name: 'التصميم', icon: null, sort: 0 });
  await signIn(page, 'settings-notifications');
  const tree = page.locator('[data-nr-tree]');
  await tree.locator('[data-nr-tab]', { hasText: 'مساعدين الذكاء الاصطناعي' }).click();
  await tree.locator('[data-nr-add="' + S9 + '"]').click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'إضافة تنبيه' });
  await form.locator('#nr-el').click();
  await expect(page.getByRole('option')).toHaveText(['الذكاء الاصطناعي']);
});

// Safwat 25 Nov — «في تنبيهات خدمة العملاء عايز … اول حرف من اسم العميل و رقم تليفونه و اقدر اخدوا كوبي او اروح علي الواتساب و تحتيها
// حالة الاوردر و لو متاخر او قابل للتاخير يبقا محتاج للمتابعة و عدد الاوردرات الفرعية و المورد المتأخر»: the order alert's card
test('customer service\'s order alert: the customer\'s first letter, the phone (copy / WhatsApp), the status, «محتاج متابعة», the sub-orders and the late maker', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  mock.alerts = [{ id: 601, at: iso(3), kind: 'rule:orders.confirm', title: 'أوردر غير مؤكد — IB-180686', body: 'غير مؤكد · عمره 8 يوم', role_id: null, user_id: ADMIN_ID, entity: 'orders/180686', entity_id: 'o:180686', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null,
    meta: { lv: 'important', g: 'customer', gid: '180686', gname: 'هدير عميل', ost: 'جاري التنفيذ', dl: 'late', subs: 2, lm: ['Art Craft'], rm: ['Antikiano'],
      mk: [{ n: 'Art Craft', p: 3, s: 'جاري التنفيذ', d: 'late' }, { n: 'Antikiano', p: 1, s: 'جاهز للشحن من المبتكر للمخزن', d: 'risk' }] } }];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const card = page.locator('.menu.notif .ntf-item.cust');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.av.letter')).toHaveText('ه');
  await expect(card.locator('[data-ntf-phone]')).toHaveText('01000007030');
  await expect(card.locator('[data-ntf-wa]')).toHaveAttribute('href', 'https://wa.me/201000007030');
  // Safwat 25 Nov — «انا عايز اسم العميل و شيل حالة الاوردر الرئيسي بس عدد الاوردرات الفرعية و كل فيندور قداموا عدد القطع و حالة التسليم»
  await expect(card.locator('[data-ntf-name]')).toHaveText('هدير عميل');
  await expect(card.locator('[data-ntf-chip]')).toHaveText(['2 أوردر فرعي']);
  await expect(card).not.toContainText('جاري التنفيذ · محتاج');
  await expect(card.locator('[data-ntf-follow]')).toHaveText('محتاج متابعة');
  const rows = card.locator('[data-ntf-maker]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-ntf-maker', 'late');
  await expect(rows.nth(0)).toContainText('Art Craft'); await expect(rows.nth(0).locator('[data-ntf-pcs]')).toHaveText('3 قطع'); await expect(rows.nth(0)).toContainText('متأخر · جاري التنفيذ');
  await expect(rows.nth(1)).toHaveAttribute('data-ntf-maker', 'risk'); await expect(rows.nth(1).locator('[data-ntf-pcs]')).toHaveText('قطعة'); await expect(rows.nth(1)).toContainText('قابل للتأخير');
  // «نسخ» copies the number and leaves the bell open (the card's own click is the order)
  await card.locator('[data-ntf-copy]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('01000007030');
  await expect(page.locator('.menu.notif')).toBeVisible();
});

// the template is the card (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي ظاهر عشان المستخدم لو عايز يعدل يقدر يعدل»): the
// order rule's form shows the card under its template as it is typed, and «حط القالب الأساسي» fills the default
test('the order rule\'s template: the card under it as it is typed; the default one button away', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await page.locator('[data-nr-rule="r1"]').getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const form = page.locator('.modal[role=dialog]', { hasText: 'تعديل التنبيه' });
  await form.locator('[data-nr-tpl-default]').click();
  await expect(form.locator('#nr-tpl')).toHaveValue(/\{التليفون\}/);
  const prev = form.locator('[data-nr-card-prev]');
  await expect(prev.locator('[data-ntf-phone]')).toHaveText('01012345678');
  await expect(prev.locator('[data-ntf-follow]')).toHaveText('محتاج متابعة');
  await expect(prev.locator('[data-ntf-maker]')).toHaveCount(2);
  await form.locator('#nr-tpl').fill('{العميل} · {حالة_الأوردر}');
  await expect(form.locator('[data-nr-card-prev] [data-ntf-chip]')).toHaveText(['جاري التنفيذ']);
  await expect(form.locator('[data-nr-card-prev] [data-ntf-phone]')).toHaveCount(0);
  await expect(form.locator('[data-nr-card-prev] [data-ntf-maker]')).toHaveCount(0);
  await expect(form.locator('[data-nr-vars]')).toContainText('{المبتكرين}');
  await expect(form.locator('[data-nr-vars]')).toContainText('{المبتكر_القابل_للتأخير}');
});

// bell-redesign decision 20 (Safwat 28 Nov — «في فيندورز اللوجو بتاعهم م ظاهر»): a maker with his photo in the system and no store logo on
// the site shows that photo (its signed link), not his letter
test('decision 20 — a maker\'s photo in the system is his mark in the bell', async ({ page }) => {
  const v = mock.vendors.find((x) => x.name === 'Art Craft'); v.logo_url = null; v.photo_path = v.id + '/photo.png'; mock.vendorPhotos.set(v.photo_path, { type: 'image/png', bytes: Buffer.alloc(0) });
  mock.alerts = [{ id: 701, at: iso(5), kind: 'rule:makers.making', title: 'أوردر فرعي متأخر', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'makers', entity_id: 'mk:late:p', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null,
    meta: { lv: 'critical', g: 'vendor', gid: v.id, gname: 'Art Craft', n: 1, pcs: 1, st: 'late', sk: 'late', nums: ['9101'], v: { n: 'Art Craft', s: 'متأخر' } } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const item = page.locator('.menu.notif .ntf-item').first();
  await expect(item.locator('.av.img img')).toHaveAttribute('src', /vendor-photos/);
});

// the trends from free sources (0175 — Safwat 28 Nov: «في الجرس تنبيهات الترندات بتيجي في المساعدين»): «آخر التريندات» opens its batch in
// the same popup — each trend a link to its post — with the assistant's chat and its page from there
test('0175 — a «آخر التريندات» alert opens its batch in the popup: each trend a link, «كمّل مع المساعد» and «كل التريندات»', async ({ page }) => {
  const B = 'b0000000-0000-4000-8000-00000000a175'; const now = new Date().toISOString();
  mock.mkt.trends = [
    { id: 91, batch: B, title: 'فيديو مكرمية الأكتر مشاهدة', summary: null, source: 'YouTube', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1', kind: 'video', platform: 'youtube', tag: 'مكرمية', thumb: null, author: 'قناة الهاند ميد', views: 52000, likes: null, comments: null, posted_at: now, external_id: 'AAAAAAAAAA1', found_at: now },
    { id: 92, batch: B, title: 'مكرمية حائط', summary: 'طالع +250% في بحث جوجل في مصر', source: 'Google Trends', url: 'https://trends.google.com/trends/explore?geo=EG&q=x', kind: 'search', platform: 'google', tag: 'مكرمية', thumb: null, author: null, views: null, likes: null, comments: null, posted_at: null, external_id: 'gt-2026-11-28-0a1b2c3d', found_at: now },
    { id: 93, batch: 'b0000000-0000-4000-8000-00000000a170', title: 'دفعة تانية', summary: null, source: 'Later', url: 'https://later.com/x', kind: 'image', platform: 'web', tag: null, thumb: null, author: null, views: null, likes: null, comments: null, posted_at: null, external_id: null, found_at: now }];
  mock.alerts = [{ id: 811, at: iso(2), kind: 'rule:ai.designer', title: 'آخر التريندات', body: '2 تريند جديد (يوتيوب 1 · بحث جوجل 1) — فيديو مكرمية الأكتر مشاهدة', role_id: null, user_id: ADMIN_ID, entity: 'ai-designer', entity_id: 'tr:' + B, read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'normal' } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  await page.locator('.menu.notif .ntf-item', { hasText: 'آخر التريندات' }).click();
  const ap = page.locator('.modal[data-alert-popup]'); await expect(ap).toBeVisible();
  const list = ap.locator('[data-ap-trends] .ap-trends-l li');
  await expect(list).toHaveCount(2); // the batch's own, not the other one
  await expect(ap.locator('[data-ap-trend="youtube"]')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=AAAAAAAAAA1');
  await expect(list.nth(0)).toContainText('52,000 مشاهدة');
  await expect(list.nth(1)).toContainText('طالع +250%');
  await expect(ap.locator('[data-ap-act="chat"]')).toBeVisible();
  await ap.locator('[data-ap-act="page"]').click();
  await expect(ap.locator('[data-ap-view="page"]')).toBeVisible(); await expect(page).toHaveURL(/#dashboard/); // the page only by its own button
});
