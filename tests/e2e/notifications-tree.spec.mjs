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
  await bell.locator('#ntf-sort').click(); await page.getByRole('option', { name: 'الأقدم الأول' }).click();
  await expect(bell.locator('.ntf-item').first()).toContainText('IB-180651');
  // «الفريق»: the overtime alert written by the database (no rule) sits under «الحضور والانصراف» (its element = team)
  await bell.locator('.ntf-nav-item', { hasText: 'الفريق' }).click();
  await expect(bell.locator('.tab')).toHaveText([/الكل \(1\)/, /الحضور والانصراف \(1\)/, /غير مقروء \(1\)/, /مقروء \(0\)/]);
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
  await expect(page.locator('.menu.notif .tab')).toHaveText([/الكل \(0\)/, /العهدة \(0\)/, /غير مقروء \(0\)/, /مقروء \(0\)/]);
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
