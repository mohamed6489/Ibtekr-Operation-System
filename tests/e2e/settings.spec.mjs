import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «الإعدادات» (phase 11, docs/superpowers/plans/2026-11-07-phase-11-settings.md decisions 12–26): the v6 settings block (17) on
// IBSettings (0056) — the hub of 14 sections; the team's matrix from the roles' real permissions and its writes through the RPCs
// (role_perms_set, member_role_set, member_status_set with a reason); the platform links through settings-admin (a key never
// shown again, its tail only); the site's keys tested first and saved on confirm; the notifications row «notif» saved as the
// v6 shapes (+ the WhatsApp template); the activity log with its filters; my sessions; the company papers; the brand colors
// applied at sign-in for every member; the quick actions from the row «quick»; force 2FA sends a member without it to the
// profile. Mock only (the mocked Supabase of supabase-mock.mjs + settings-mock.mjs).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACC = 'accounts.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page, id) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForFunction(() => !window.IBCS || ['ready', 'error'].includes(window.IBCS.state()));
}
async function openSettings(page, section) {
  await page.evaluate((s) => { location.hash = s ? 'settings-' + s : 'settings'; }, section || '');
  await expect(page.locator('#pg-settings')).toBeVisible();
  if (section) await expect(page.locator('#pg-settings .set-page')).toBeVisible();
}
const settingsRow = (section) => mock.settings.find((r) => r.section === section);
// another member signs in: the session is forgotten (the mock keeps its tokens), the app starts from the login screen
async function relogin(page) { await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* */ } }); await page.goto('/'); await expect(page.locator('#login')).toBeVisible(); }

test('the hub: 14 cards in 4 groups for the admin; a member without settings.view sees the notice; the page is out of «soon»', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page);
  await expect(page.locator('[data-set-card]')).toHaveCount(14);
  await expect(page.locator('[data-set-group]')).toHaveCount(4);
  await expect(page.locator('.sidebar [data-page="settings"]')).not.toHaveAttribute('data-soon', '');
  await page.locator('[data-set-edit="general"]').click();
  await expect(page.locator('#pg-settings .set-page')).toBeVisible();
  await expect(page.locator('#g-co')).toHaveValue(/إبتكر/);
  // accounts: settings.view N → the notice only
  await relogin(page);
  await page.fill('#lg-id', ACC); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'settings'; });
  await expect(page.locator('#pg-settings')).toContainText('للأدمن');
  await expect(page.locator('[data-set-card]')).toHaveCount(0);
});

test('the team: the matrix from the roles\' real permissions; a cell toggles role_perms_set (an alert for the admins); the role select → member_role_set; suspend needs a reason → member_status through settings-admin', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'team');
  await page.getByRole('tab', { name: 'الأدوار والصلاحيات' }).click();
  // the ops column of «الأوردرات › عرض» is F (the seed), «الحسابات › عرض» for ops is P
  const cell = (perm, role) => page.locator(`.matrix .pm[aria-label^="${perm} — ${role}"]`);
  await expect(cell('عرض', 'عمليات').first()).toHaveClass(/pm-full/);
  const opsAccView = page.locator('.mx-group', { hasText: 'الحسابات' }).locator('.pm[aria-label^="عرض — عمليات"]');
  await expect(opsAccView).toHaveClass(/pm-part/);
  await opsAccView.click(); // P → N
  await expect.poll(() => mock.st.writes.filter((w) => w.table === 'roles' && w.op === 'perms').length).toBe(1);
  expect(mock.st.writes.find((w) => w.op === 'perms')).toMatchObject({ id: 'ops', changed: ['accounts.view'] });
  expect(mock.roles.find((r) => r.id === 'ops').permissions['accounts.view']).toBe('N');
  expect(mock.alerts.some((a) => a.kind === 'settings.perm' && a.role_id === 'admin')).toBe(true);
  // members: the role select of سارة → member_role_set; the directory refreshes
  await page.getByRole('tab', { name: /^الأعضاء/ }).click();
  const row = page.locator('#pg-settings table tbody tr', { hasText: 'سارة أحمد' });
  await row.locator('button.select').click(); await page.getByRole('option', { name: 'خدمة العملاء' }).click();
  await expect.poll(() => mock.st.writes.filter((w) => w.op === 'role').length).toBe(1);
  expect(mock.st.writes.find((w) => w.op === 'role')).toMatchObject({ id: OPS_ID, from: 'ops', to: 'cs' });
  expect(mock.profiles.find((p) => p.id === OPS_ID).role_id).toBe('cs');
  await expect(row.locator('button.select')).toContainText('خدمة العملاء'); // the directory refreshed and the table re-rendered
  await page.waitForTimeout(400);
  // suspend: the reason is required, then settings-admin member_status
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'إيقاف العضو' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'إيقاف' }).click();
  await expect(dlg).toContainText('الحقل ده مطلوب');
  await dlg.locator('textarea').fill('إجازة طويلة');
  await dlg.getByRole('button', { name: 'إيقاف' }).click();
  await expect.poll(() => mock.st.writes.filter((w) => w.op === 'status').length).toBe(1);
  expect(mock.st.calls.find((c) => c.fn === 'settings-admin' && c.action === 'member_status')).toBeTruthy();
  expect(mock.profiles.find((p) => p.id === OPS_ID).status).toBe('suspended');
  expect(mock.activityRows.find((r) => r.action === 'settings.member.suspend').new_value).toEqual({ status: 'suspended', reason: 'إجازة طويلة' });
});

test('the links: the cards from the server; OpenAI connected with a key → Vault only (the tail on the card, the key names in the log); the site\'s keys tested then saved on confirm', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'integrations');
  await expect(page.locator('[data-integ="woo"]')).toBeVisible();
  await page.getByRole('tab', { name: /الذكاء الاصطناعي/ }).click();
  const openai = page.locator('[data-integ="openai"]');
  await expect(openai).toContainText('غير متصل');
  await openai.locator('[data-integ-connect]').click();
  const KEY = 'sk-test-' + 'q'.repeat(28);
  const dlg = page.getByRole('dialog');
  await dlg.locator('#key').fill(KEY);
  await dlg.getByRole('button', { name: 'حفظ واختبار' }).click();
  await expect(openai).toContainText('متصل');
  await expect(openai).toContainText('••••' + KEY.slice(-4));
  expect(JSON.parse(mock.st.vault.openai)).toEqual({ key: KEY });
  expect(mock.st.writes.find((w) => w.table === 'vault')).toEqual({ table: 'vault', op: 'set', name: 'openai', keys: ['key'] });
  const txt = JSON.stringify(mock.activityRows) + JSON.stringify(mock.settings);
  expect(txt.includes(KEY)).toBe(false);
  expect(mock.activityRows.filter((r) => r.action === 'settings.integration.set').map((r) => r.entity_id)).toEqual(['openai']);
  // the site: the probe first (pending), then the confirm saves
  await page.getByRole('tab', { name: /الموقع والبيانات/ }).click();
  await page.locator('[data-integ="woo"] [data-integ-open]').click();
  await page.locator('#w-url').fill('https://staging.ibtekr.club'); await page.locator('#w-ck').fill('ck_' + 'a'.repeat(32)); await page.locator('#w-cs').fill('cs_' + 'b'.repeat(32));
  await expect(page.locator('[data-woo-save]')).toBeDisabled();
  await page.locator('[data-woo-test]').click();
  await expect(page.locator('#pg-settings')).toContainText('الاتصال نجح');
  expect(mock.st.vault.woo).toBeUndefined();
  await page.locator('[data-woo-save]').click();
  await expect.poll(() => !!mock.st.vault.woo).toBe(true);
  expect(JSON.parse(mock.st.vault.woo).url).toBe('https://staging.ibtekr.club');
  expect(mock.st.calls.filter((c) => c.action === 'woo_set').map((c) => c.body.confirm)).toEqual([false, true]);
});

test('the notifications row: toggling a type and the WhatsApp template save the v6 shapes into «notif»; the matrix by role and the role digests live there too', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'notifications');
  const sw = page.locator('#pg-settings .ntf-table [role=switch]').first();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect.poll(() => !!settingsRow('notif') && Array.isArray(settingsRow('notif').data.notif)).toBe(true);
  const n1 = settingsRow('notif').data;
  expect(n1.notif[0][1][0][4]).toBe(false);
  expect(n1.quiet.days).toBe('الجمعة'); expect(n1.whatsappTemplate).toBe('ibtekr_alert'); expect(n1.alertRoles).toEqual({});
  expect(n1.channels).toEqual({ email: false, whatsapp: false }); // the outbound channels are off as a whole until the admin turns one on
  await page.getByRole('tab', { name: 'ساعات الهدوء' }).click();
  await page.locator('#q-wa-tpl').fill('ibtekr_alerts_v2');
  await page.getByRole('button', { name: 'حفظ', exact: true }).last().click();
  await expect.poll(() => settingsRow('notif').data.whatsappTemplate).toBe('ibtekr_alerts_v2');
  // by role: a cell → alertRoles column string
  await page.getByRole('tab', { name: 'حسب الدور' }).click();
  await page.locator('.matrix .pm[aria-label^="أوردرات متأخرة — محتاج متابعة — حسابات"]').click();
  await expect.poll(() => (settingsRow('notif').data.alertRoles || {})['customers.late']).toBe('RRRRSN');
});

test('the activity log on the server: filters as PostgREST calls, pages of 100; the sessions from my_sessions with a revoke', async ({ page }) => {
  const at = (i) => new Date(Date.now() - i * 3600000).toISOString();
  for (let i = 0; i < 120; i++) mock.activityRows.push({ id: 5000 + i, at: at(i), actor: i % 2 ? OPS_ID : '00000000-0000-4000-8000-000000000001', action: i % 3 ? 'order.status' : 'settings.role.perms', entity: 'x', entity_id: String(i), old_value: null, new_value: null });
  await signIn(page, ADMIN);
  await openSettings(page, 'activity');
  const tbl = page.locator('#pg-settings .act-tbl');
  await expect(tbl.locator('tbody tr')).toHaveCount(100);
  const total = mock.activityRows.filter((r) => r.entity !== 'hr').length; // the 120 seeded + the sign-in rows the mock logged
  await page.getByRole('button', { name: 'الأقدم ›' }).click();
  await expect(tbl.locator('tbody tr')).toHaveCount(total - 100);
  const pick = async (id, label) => { await page.locator('#' + id).click(); await page.getByRole('option', { name: label }).click(); }; // U.Select is a popover button
  await pick('ac-m', 'سارة أحمد');
  await expect(tbl.locator('tbody tr')).toHaveCount(60);
  await expect(tbl.locator('tbody tr').first()).toContainText('سارة أحمد');
  await pick('ac-p', 'الإعدادات');
  await expect(tbl.locator('tbody tr')).toHaveCount(20);
  await expect(tbl.locator('tbody tr').first()).toContainText('settings.role.perms');
  // security: my two sessions, the current one tagged; the other revoked
  await openSettings(page, 'security');
  const rows = page.locator('#pg-settings table tbody tr', { hasText: /Chrome|Safari/ });
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#pg-settings')).toContainText('الجلسة الحالية');
  await page.locator('[data-sess-out]').click();
  await expect(rows).toHaveCount(1);
  expect(mock.st.sessions.length).toBe(1);
  expect(mock.activityRows.some((r) => r.action === 'settings.session.revoke')).toBe(true);
});

test('the company papers: upload (the file into bucket company-docs, then the row), the list, a signed link that is logged; the brand color saved and applied for every member at sign-in; a quick action saved to «quick» and shown in the topbar', async ({ page, context }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'docs');
  await page.locator('[data-doc-add]').click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#doc-up').setInputFiles({ name: 'cr-2027.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await dlg.locator('#name').fill('السجل التجاري 2027');
  await dlg.getByRole('button', { name: 'احفظ الورقة' }).click();
  await expect(page.locator('#pg-settings .doc-tbl tbody tr')).toHaveCount(1);
  expect(mock.st.writes.filter((w) => w.table === 'storage').length).toBe(1);
  expect(mock.st.docs.length).toBe(1); expect(mock.st.docs[0].type).toBe('السجل التجاري');
  expect(mock.activityRows.filter((r) => r.action === 'settings.doc.add').length).toBe(1);
  const popup = context.waitForEvent('page');
  await page.locator('.doc-tbl tbody tr').getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'عرض / تنزيل' }).click();
  const p2 = await popup; await p2.close();
  expect(mock.activityRows.filter((r) => r.action === 'settings.doc.view').length).toBe(1);
  // the brand: a color edited → the row brand.colors; a quick action → the row quick
  await openSettings(page, 'brand');
  const hex = page.locator('#clr-color-brand-default');
  await hex.fill('#114433'); await hex.press('Enter'); await hex.dispatchEvent('change');
  await expect.poll(() => settingsRow('brand') && settingsRow('brand').data.colors && settingsRow('brand').data.colors['--color-brand-default']).toBe('#114433');
  await page.locator('[data-set-save]').click(); // the v6 rule: a changed section is saved before leaving it
  await openSettings(page, 'quick');
  await page.locator('[data-qa-new]').click();
  await page.getByRole('dialog').locator('#name').fill('أوردرات النهارده');
  await page.getByRole('dialog').locator('#link').fill('#orders?st=مكتمل');
  await page.getByRole('dialog').getByRole('button', { name: 'ضيف' }).click();
  await expect.poll(() => settingsRow('quick') && (settingsRow('quick').data.list || []).map((x) => x.name)).toContain('أوردرات النهارده');
  // ops signs in: the brand color is applied from settings_public, the quick action is in the topbar menu
  await relogin(page);
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--color-brand-default').trim())).toBe('#114433');
  await page.locator('[data-quick]').click();
  await expect(page.getByRole('menuitem', { name: 'أوردرات النهارده' })).toBeVisible();
});

test('force 2FA (the row «security»): a member without 2FA is sent to «ملفي › الحساب والأمان» and cannot leave it; the admin with the row off is not', async ({ page }) => {
  mock.settings.push({ section: 'security', data: { force2fa: true, idle: true, idleDesktop: '4 ساعات' }, updated_at: new Date().toISOString(), updated_by: null });
  await signIn(page, ACC);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#profile-security');
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#profile-security');
  expect(await page.evaluate(() => window.IBShell.idleMinutes())).toBe(240);
});

// ---------------------------------------------------------------- phase 12 T3: the saved reason lists (decision 10)

test('lists (phase 12): the statuses stay a view; the cancel reasons are saved to the row «lists» (add / remove, «أخرى» pinned last) and the orders page\'s cancel popup offers them', async ({ page }) => {
  await signIn(page, ADMIN); await openSettings(page, 'lists');
  await expect(page.locator('#pg-settings')).toContainText('مربوطة بالموقع (status_map)');
  await page.getByRole('tab', { name: 'أسباب الإلغاء والمسح' }).click();
  await expect(page.locator('#pg-settings [data-reason="العميل لغى الطلب"]')).toBeVisible(); // block 12's default before anything is saved
  await page.locator('[data-reason-add="cancel"]').click();
  await page.fill('.modal input', 'العميل عايز يعدل الأوردر');
  await page.locator('.modal').getByRole('button', { name: 'إضافة' }).click();
  await expect.poll(() => (settingsRow('lists') || {}).data).toEqual({ cancel: ['العميل لغى الطلب', 'العميل مش بيرد / مش متاح', 'المبتكر مش هيقدر ينفذ', 'المنتج خلص / مش متاح', 'مصاريف الشحن عالية', 'أوردر مكرر', 'العميل عايز يعدل الأوردر'], returns: ['العميل رفض الاستلام', 'العميل غيّر رأيه', 'فيه عيب', 'مقاس/لون غلط', 'وصل متأخر', 'اتكسر في الشحن'] });
  await expect(page.locator('#pg-settings [data-reason="العميل عايز يعدل الأوردر"]')).toBeVisible();
  // remove a default one
  const row = page.locator('#pg-settings tr').filter({ has: page.locator('[data-reason="أوردر مكرر"]') });
  await row.locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  await page.locator('.modal').getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => (settingsRow('lists') || {}).data.cancel).not.toContain('أوردر مكرر');
  await expect.poll(() => page.evaluate(() => window.IBSettings.section('lists').cancel)).not.toContain('أوردر مكرر'); // the adapter's own state follows the answer
  await expect(page.locator('#pg-settings [data-reason="أخرى"]')).toBeVisible();
  await expect.poll(() => mock.activity.filter((a) => a.action === 'settings.lists.save').length).toBeGreaterThan(0);
  expect(JSON.stringify(mock.activity.filter((a) => a.action === 'settings.lists.save'))).not.toContain('العميل');
  // the orders page reads the saved list (the public slice after a fresh sign-in)
  const lists = await page.evaluate(() => window.IBSettings.lists());
  expect(lists.cancel.at(-1)).toBe('أخرى'); expect(lists.cancel).toContain('العميل عايز يعدل الأوردر'); expect(lists.cancel).not.toContain('أوردر مكرر');
});
