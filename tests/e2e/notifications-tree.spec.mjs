import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md, 0157): «الإعدادات › التنبيهات»
// is the tree the bell shows — the admin adds a main section, a sub-section under it and an alert (element › type › state, time, repeat,
// visibility, roles, message), and the bell shows the same groups and filters with the alerts the rules wrote: the new one with the
// green dot, «غير مقروء» / «مقروء», the sort. Mock only.
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
}

test('the bell = the settings\' tree: its groups and filters, a rule-less alert under its element\'s sub-section, the hidden one gone, the green dot, «غير مقروء» / «مقروء», the sort', async ({ page }) => {
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const bell = page.locator('.menu.notif');
  await expect(bell.locator('.ntf-nav-item')).toHaveText([/خدمة العملاء/, /الفريق/]);
  await expect(bell.locator('.ntf-nav-item').first().locator('.cnt')).toHaveText('1'); // 501 unread; 502 read; 504 hidden
  await expect(bell.locator('.tab')).toHaveText([/الكل \(2\)/, /غير مؤكدة \(2\)/, /غير مقروء \(1\)/, /مقروء \(1\)/]);
  await expect(bell.locator('.ntf-item')).toHaveCount(2);
  await expect(bell.locator('.ntf-item').first()).toContainText('IB-180656'); await expect(bell.locator('.ntf-item').first().locator('.ntf-dot')).toBeVisible();
  await expect(bell.locator('.ntf-item').nth(1).locator('.ntf-dot')).toHaveCount(0);
  await expect(bell).not.toContainText('اتخفى');
  // the sort: the oldest first
  await bell.locator('#ntf-sort').click(); await expect(bell.locator('#ntf-sort')).toHaveAttribute('data-sort', 'old'); // the bell's redesign: one small button (newest ⇄ oldest)
  await expect(bell.locator('.ntf-item').first()).toContainText('IB-180651');
  // «الفريق»: the overtime alert written by the database (no rule) sits under «الحضور والانصراف» (its element = team)
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.tab')).toHaveText([/الكل \(1\)/, /الحضور والانصراف \(1\)/, /غير مقروء \(1\)/]); // the bell's redesign: an empty filter is not shown
  await expect(bell.locator('.ntf-item')).toContainText('وقت إضافي محتاج قرارك');
  // «تعليم القسم كمقروء» → the dot goes, written as reads
  await bell.locator('.ntf-foot').getByRole('button', { name: 'تعليم القسم كمقروء' }).click();
  await expect.poll(() => mock.alertReads.some((r) => r.alert_id === 503)).toBe(true);
});

test('«الإعدادات › التنبيهات»: a main section, a sub-section and an alert by Safwat\'s form → the bell shows the new group and filter at once', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  await expect(page.locator('[data-set-save]')).toHaveCount(0); // each change saves at once
  const tree = page.locator('[data-nr-tree]');
  await expect(tree.locator('[data-nr-main]')).toHaveCount(2);
  await expect(tree.locator('[data-nr-rule]')).toHaveCount(2);
  // a new main section
  await page.locator('[data-nr-add-main]').click();
  await page.locator('#ns-name').fill('الحسابات'); await page.locator('.modal[role=dialog]').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(tree.locator('[data-nr-main]')).toHaveCount(3);
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
  await form.locator('#nr-el').click(); await page.getByRole('option', { name: 'عهدة التشغيل' }).click();
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
  await expect(page.locator('.menu.notif .tab')).toHaveText([/الكل \(0\)/]); // the bell's redesign: «الكل» only while the group is empty
});

test('an alert switched off and deleted from the settings; a sub-section renamed', async ({ page }) => {
  await signIn(page, 'settings-notifications');
  const rule = page.locator('[data-nr-rule="r2"]');
  await rule.getByRole('switch').click();
  await expect.poll(() => mock.notif.rules.find((r) => r.id === 'r2').active).toBe(false);
  await rule.getByRole('button', { name: 'إجراءات' }).click(); await page.getByRole('menuitem', { name: 'حذف' }).click();
  await page.getByRole('button', { name: 'احذف' }).click();
  await expect.poll(() => mock.notif.rules.some((r) => r.id === 'r2')).toBe(false);
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

// the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): a maker's delay alerts are one card with
// his counts that opens his late orders (with «مشاركة»); the critical first with its tag; a member's alert carries his first letter
test('the bell\'s redesign: a maker\'s card opens his late orders, the critical first, the owner instead of the bell', async ({ page }) => {
  const vm = (st, pcs) => ({ lv: st === 'late' ? 'critical' : 'important', g: 'vendor', gid: 'v-art', gname: 'Art Craft', n: 1, pcs, st });
  mock.alerts = [
    { id: 601, at: iso(10), kind: 'rule:subs.delay', title: 'أوردر فرعي متأخر — IB-1', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/1', entity_id: 's:1', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: vm('late', 4) },
    { id: 602, at: iso(20), kind: 'rule:subs.delay', title: 'أوردر فرعي متأخر — IB-2', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/2', entity_id: 's:2', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: vm('late', 1) },
    { id: 603, at: iso(30), kind: 'rule:subs.delay', title: 'أوردر فرعي قابل للتأخير — IB-3', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/3', entity_id: 's:3', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: vm('risk', 2) },
    { id: 604, at: iso(1), kind: 'rule:orders.update', title: 'أوردر جديد — IB-9', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'orders/9', entity_id: 'onew:9', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'info' } },
    { id: 605, at: iso(5), kind: 'rule:team.status', title: 'لم يسجل انصراف', body: 'x', role_id: null, user_id: ADMIN_ID, entity: 'hr-team', entity_id: 'noout:1', read_at: null, rule_id: 'r2', section_id: S2, hide_at: null, meta: { lv: 'important', g: 'member', gid: 'm1', gname: 'سارة أحمد' } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  const bell = page.locator('.menu.notif');
  await expect(bell.locator('.ntf-head.tree')).toContainText('4 محتاج تتصرف'); await expect(bell.locator('.ntf-head.tree')).toContainText('2 حرج');
  await expect(bell.locator('.ntf-nav-item').first().locator('.cnt.hot')).toBeVisible();
  const items = bell.locator('.ntf-item');
  await expect(items).toHaveCount(2); // the maker's three alerts = one card; the new order after it (info)
  await expect(items.first()).toHaveClass(/lv-critical/); await expect(items.first()).toContainText('Art Craft');
  await expect(items.first().locator('.ntf-chip')).toHaveText(['2 متأخر', '1 قابل للتأخير', '7 قطعة']);
  await expect(items.first().locator('.ntf-lv')).toHaveText('حرج');
  await expect(items.first().locator('.av.letter, .av.img')).toHaveCount(1);
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.ntf-item').first().locator('.av.letter')).toHaveText('س');
  await bell.locator('.ntf-nav-item', { hasText: 'خدمة العملاء' }).click();
  await bell.locator('.ntf-item').first().click();
  const pop = page.locator('.modal[data-vlate="all"]'); await expect(pop).toBeVisible(); await expect(pop).toContainText('Art Craft');
  await expect(pop.locator('[data-share]')).toHaveCount(1);
  await expect.poll(() => [601, 602, 603].every((id) => mock.alertReads.some((r) => r.alert_id === id))).toBe(true);
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
