import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

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
}

test('the bell = the settings\' tree: its groups and filters, a rule-less alert under its element\'s sub-section, the hidden one gone, the green dot, the read below the unread, the read filter, the sort', async ({ page }) => {
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
  await bell.locator('#ntf-read').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'unread');
  await expect(bell.locator('.ntf-item')).toHaveCount(1); await expect(bell.locator('.ntf-item')).toContainText('IB-180656');
  await bell.locator('#ntf-read').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'read');
  await expect(bell.locator('.ntf-item')).toHaveCount(1); await expect(bell.locator('.ntf-item')).toContainText('IB-180651');
  await bell.locator('#ntf-read').click(); await expect(bell.locator('#ntf-read')).toHaveAttribute('data-read', 'all'); await expect(bell.locator('.ntf-item')).toHaveCount(2);
  // «الفريق»: the overtime alert written by the database (no rule) sits under «الحضور والانصراف» (its element = team)
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.tab')).toHaveText([/الكل \(1\)/, /الحضور والانصراف \(1\)/]); // 0163 (the bell by role): every tab there, even at zero
  await expect(bell.locator('.ntf-item')).toContainText('وقت إضافي محتاج قرارك');
  // «تعليم القسم كمقروء» → the dot goes, written as reads
  await bell.locator('.ntf-foot').getByRole('button', { name: 'تعليم القسم كمقروء' }).click();
  await expect.poll(() => mock.alertReads.some((r) => r.alert_id === 503)).toBe(true);
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
  await expect(page.locator('.menu.notif .tab')).toHaveText([/الكل \(0\)/, /العهدة \(0\)/]); // 0163 (the bell by role): the sub-section ready at zero
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

test('0162 a «تقرير» alert in the bell opens one table with every thing of its elements — a chip per element filters it, a row opens its order, «مشاركة»', async ({ page }) => {
  const items = [{ p: 'الأوردرات الرئيسية › غير مؤكد', t: 'أوردر غير مؤكد — IB-180656', b: 'غير مؤكد · عمره 2 يوم', e: 'orders/180656', g: null },
    { p: 'الأوردرات الرئيسية › غير مؤكد', t: 'أوردر غير مؤكد — IB-180651', b: 'غير مؤكد', e: 'orders/180651', g: null },
    { p: 'المبتكرين › أوردرات متأخرة', t: 'أوردر فرعي متأخر — IB-7', b: 'Art Craft · 2 منتج', e: 'orders/7', g: 'Art Craft' }];
  mock.alerts = [{ id: 701, at: iso(3), kind: 'rule:report', title: 'الشغل المتأخر — 3', body: '2 الأوردرات الرئيسية › غير مؤكد · 1 المبتكرين › أوردرات متأخرة', role_id: null, user_id: ADMIN_ID, entity: null, entity_id: 'report', read_at: null, rule_id: 'r1', section_id: S1, hide_at: null, meta: { lv: 'critical', report: true, n: 3, items } }];
  mock.alertReads = [];
  await signIn(page, 'dashboard');
  await page.locator('.notif-btn').click();
  await page.locator('.menu.notif .ntf-item').first().click();
  const pop = page.locator('.modal[role=dialog]', { has: page.locator('[data-alert-report]') });
  await expect(pop).toContainText('الشغل المتأخر (3)');
  await expect(pop.locator('[data-ar-row]')).toHaveCount(3);
  await expect(pop.locator('thead th')).toHaveText(['العنصر', 'التنبيه', 'التفاصيل', 'صاحبه']);
  await pop.locator('[data-ar-part="المبتكرين › أوردرات متأخرة"]').click();
  await expect(pop.locator('[data-ar-row]')).toHaveCount(1); await expect(pop.locator('[data-ar-row]')).toContainText('Art Craft');
  await pop.locator('[data-ar-part=""]').click(); await expect(pop.locator('[data-ar-row]')).toHaveCount(3);
  await expect(pop.locator('[data-share]')).toBeEnabled();
  await pop.locator('[data-ar-row]').first().click();
  await expect(pop).toHaveCount(0); // the row opened its order (the bell's opener)
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
