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

test('the hub: 16 cards in 4 groups for the admin (B6: «المخزن» in «التشغيل»; the HR rebuild: «الموارد البشرية» in «الشركة والفريق»); a member without settings.view sees the notice; the page is out of «soon»', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page);
  // owner batch 2 decision 10: a tab shows its group only — 5 + 3 + 5 + 3 = 16 cards
  const perTab = {};
  for (const g of ['الشركة والفريق', 'الربط والأدوات', 'التشغيل', 'الأمان والبيانات']) { await page.locator('[data-set-jump-to="' + g + '"]').click(); await expect(page.locator('[data-set-group]')).toHaveCount(1); perTab[g] = await page.locator('[data-set-group="' + g + '"] [data-set-card]').count(); }
  expect(perTab).toEqual({ 'الشركة والفريق': 5, 'الربط والأدوات': 3, 'التشغيل': 5, 'الأمان والبيانات': 3 });
  await page.locator('[data-set-jump-to="الشركة والفريق"]').click();
  await expect(page.locator('[data-set-group="الشركة والفريق"] [data-set-card="hr"]')).toHaveCount(1);
  await expect(page.locator('.sidebar [data-page="settings"]')).not.toHaveAttribute('data-soon', '');
  await page.locator('[data-set-edit="general"]').click();
  await expect(page.locator('#pg-settings .set-page')).toBeVisible();
  await expect(page.locator('#g-co')).toHaveValue(/إبتكر/);
  // accounts: settings.view N → no «الإعدادات» in the menu, and its link lands on the dashboard (owner batch 14 Nov decision 15)
  await relogin(page);
  await page.fill('#lg-id', ACC); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('.sidebar .nav-item[data-page="settings"]')).toBeHidden();
  await page.evaluate(() => { location.hash = 'settings'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
  await expect(page.locator('[data-set-card]')).toHaveCount(0);
});

test('the team: the matrix from the roles\' real permissions; a cell toggles role_perms_set (an alert for the admins); the role select → member_role_set; suspend needs a reason → member_status through settings-admin', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'team');
  await page.getByRole('tab', { name: 'الأدوار والصلاحيات' }).click();
  // the ops column of «الأوردرات › عرض» is F (the seed), «الحسابات › عرض» for ops is P
  // ش32 (the owner 16 Nov): each permission = three choices (مسموح / عرض بس / لا), the current one checked and filled
  const cell = (perm, role) => page.locator(`.matrix .pm[aria-label^="${perm} — ${role}"][aria-checked="true"]`);
  await expect(cell('عرض', 'عمليات').first()).toHaveClass(/pm-full/);
  const opsAcc = page.locator('.mx-group', { hasText: 'الحسابات' });
  await expect(opsAcc.locator('.pm[aria-label^="عرض — عمليات"][aria-checked="true"]')).toHaveClass(/pm-part/);
  await opsAcc.locator('.pm.pm-none[aria-label^="عرض — عمليات"]').click(); // P → N
  await expect.poll(() => mock.st.writes.filter((w) => w.table === 'roles' && w.op === 'perms').length).toBe(1);
  expect(mock.st.writes.find((w) => w.op === 'perms')).toMatchObject({ id: 'ops', changed: ['accounts.view'] });
  expect(mock.roles.find((r) => r.id === 'ops').permissions['accounts.view']).toBe('N');
  expect(mock.alerts.some((a) => a.kind === 'settings.perm' && a.role_id === 'admin')).toBe(true);
  // members: the role select of سارة → member_role_set; the directory refreshes
  await page.getByRole('tab', { name: /^الأعضاء/ }).click();
  const row = page.locator('#pg-settings table tbody tr', { hasText: 'سارة أحمد' });
  // the permission change above reloads the settings and the directory after its write (setRolePerms: load + IBDirectory.refresh),
  // and each reload redraws the page — one landing while the select is open closes it, so open and pick again until it takes
  await expect(async () => {
    await row.locator('button.select[id^="role-"]').click();
    await page.getByRole('option', { name: 'خدمة العملاء' }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect.poll(() => mock.st.writes.filter((w) => w.op === 'role').length).toBe(1);
  expect(mock.st.writes.find((w) => w.op === 'role')).toMatchObject({ id: OPS_ID, from: 'ops', to: 'cs' });
  expect(mock.profiles.find((p) => p.id === OPS_ID).role_id).toBe('cs');
  await expect(row.locator('button.select[id^="role-"]')).toContainText('خدمة العملاء'); // the directory refreshed and the table re-rendered
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
  // phase 13 decision 15: «حذف العضو نهائي» from the same menu → team-admin member_delete; the row goes
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'حذف العضو نهائي' }).click();
  const del = page.getByRole('dialog'); await expect(del).toContainText('مافيش رجوع');
  await del.getByRole('button', { name: 'احذف نهائي' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتحذف سارة أحمد نهائي');
  await expect(page.locator('#pg-settings table tbody tr', { hasText: 'سارة أحمد' })).toHaveCount(0);
  expect(mock.profiles.some((p) => p.id === OPS_ID)).toBe(false);
  expect(mock.hr.calls.find((c) => c.action === 'member_delete')).toBeTruthy();
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
  // owner batch 2 decision 16 (0098): the table quick_actions — the admin's new action on the settings page is «كل الفريق» by default
  await expect.poll(() => (mock.st.quick || []).filter((x) => x.scope === 'all').map((x) => x.name)).toContain('أوردرات النهارده');
  // ops signs in: the brand color is applied from settings_public, the quick action is in the topbar menu
  await relogin(page);
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--color-brand-default').trim())).toBe('#114433');
  await page.locator('[data-quick]').click();
  await expect(page.getByRole('menuitem', { name: 'أوردرات النهارده' })).toBeVisible();
  // decision 49: the two general actions are green (the brand color of the moment), the saved ones are not
  const colorOf = (n) => page.getByRole('menuitem', { name: n }).evaluate((el) => getComputedStyle(el).color);
  const brand = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-brand-default)'; document.body.append(p); const v = getComputedStyle(p).color; p.remove(); return v; });
  expect(await colorOf('+ ضيف الصفحة دي')).toBe(brand); expect(await colorOf('إدارة الإجراءات السريعة')).toBe(brand);
  expect(await colorOf('أوردرات النهارده')).not.toBe(brand);
});

test('force 2FA (the row «security»): a member without 2FA is sent to «ملفي › بيانات الحساب» and cannot leave it; the admin with the row off is not', async ({ page }) => {
  mock.settings.push({ section: 'security', data: { force2fa: true, idle: true, idleDesktop: '4 ساعات' }, updated_at: new Date().toISOString(), updated_by: null });
  await signIn(page, ACC);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#profile-security');
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#profile-security');
  expect(await page.evaluate(() => window.IBShell.idleMinutes())).toBe(240);
});

// ---------------------------------------------------------------- phase 12 T3: the saved reason lists (decision 10)

test('lists (phase 12): the order statuses read status_map (owner batch 2 decision 22: «بتتحسب زي»); the cancel reasons are saved to the row «lists» (add / remove, «أخرى» pinned last) and the orders page\'s cancel popup offers them', async ({ page }) => {
  await signIn(page, ADMIN); await openSettings(page, 'lists');
  await expect(page.locator('#pg-settings [data-status-slug="جاري التنفيذ"]')).toHaveText('processing'); // status_map, read live
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
  // decision 55: the order by dragging the six-dot grip — no «تحريك لفوق»; «أخرى» has no grip
  await expect(page.locator('#pg-settings tr[data-reason-row="أخرى"] [data-grip]')).toHaveCount(0);
  const g = await page.locator('#pg-settings tr[data-reason-row="العميل عايز يعدل الأوردر"] [data-grip]').boundingBox();
  const t = await page.locator('#pg-settings tr[data-reason-row="العميل لغى الطلب"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, t.y + 4, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => (settingsRow('lists') || {}).data.cancel[0]).toBe('العميل عايز يعدل الأوردر');
  await page.locator('#pg-settings tr').filter({ has: page.locator('[data-reason="العميل لغى الطلب"]') }).locator('button[aria-haspopup=menu]').click();
  await expect(page.getByRole('menuitem', { name: 'تحريك لفوق' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'settings.lists.save').length).toBeGreaterThan(0);
  expect(JSON.stringify(mock.activity.filter((a) => a.action === 'settings.lists.save'))).not.toContain('العميل');
  // the orders page reads the saved list (the public slice after a fresh sign-in)
  const lists = await page.evaluate(() => window.IBSettings.lists());
  expect(lists.cancel.at(-1)).toBe('أخرى'); expect(lists.cancel).toContain('العميل عايز يعدل الأوردر'); expect(lists.cancel).not.toContain('أوردر مكرر');
});

// ---------------------------------------------------------------- phase 12 T4: the full export replaces the demo «حذف بيانات الشركة»

test('data (phase 12): no «حذف بيانات الشركة» any more; «تصدير نسخة كاملة» confirms, writes one workbook and logs the sheets with their counts only', async ({ page }) => {
  await signIn(page, ADMIN); await openSettings(page, 'data');
  await expect(page.locator('#pg-settings')).not.toContainText('حذف بيانات الشركة');
  // 2026-11-16-data-page.md decision 6: «منطقة الخطر» came back as its own tab (data_wipe, by section) — the full copy is in «النسخة الكاملة»
  await page.locator('[data-dtab="backup"]').click();
  const dl = page.waitForEvent('download');
  await page.locator('[data-full-export]').click();
  await expect(page.locator('.modal')).toContainText('من غير البيانات الحساسة');
  await page.locator('.modal').getByRole('button', { name: 'صدّر الملف' }).click();
  const file = await dl; expect(file.suggestedFilename()).toMatch(/^ibtekr-full-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'settings.export.full').length).toBe(1);
  const detail = mock.activity.find((a) => a.action === 'settings.export.full').new_value;
  expect(detail).toMatch(/orders:\d+/); expect(detail).not.toMatch(/01[0-9]{9}/);
});

// the owner 16 Nov: «اعمل ف الاعدادات مكان اعدل منه ال preloader و ال fav icon ف اعدادات الهوية البصرية» — the row brand { loader, favicon },
// applied for every member from settings_public (loader.js), and remembered in the browser for the first paint
test('the brand page: «شاشة التحميل» (speed, a picture of one\'s own, back to the original) and «أيقونة المتصفح» — saved in the row brand, applied for every member', async ({ page }) => {
  await signIn(page, ADMIN);
  await openSettings(page, 'brand');
  const pg = page.locator('#pg-settings');
  await expect(pg.locator('[data-ldr-pv] .ib-worm').first()).toBeVisible();
  // a colour of the palette first; the preloader's saves keep it (the row is saved whole)
  const hex = page.locator('#clr-color-brand-default');
  await hex.fill('#114433'); await hex.press('Enter'); await hex.dispatchEvent('change');
  await expect.poll(() => settingsRow('brand') && settingsRow('brand').data.colors && settingsRow('brand').data.colors['--color-brand-default']).toBe('#114433');
  // the owner 16 Nov: no «دودة اللوجو» button and no colours row — the worm keeps the logo's colours
  await expect(pg.locator('[data-ldr-kind], [data-ldr-color]')).toHaveCount(0);
  await pg.locator('#ldr-speed').click(); await page.getByRole('option', { name: 'سريعة' }).click();
  await expect.poll(() => settingsRow('brand').data.loader.speed).toBe(1.1);
  await expect.poll(() => settingsRow('brand').data.colors['--color-brand-default']).toBe('#114433'); // the colour saved first is kept by the preloader's saves
  // a picture of one's own in place of the worm
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await pg.locator('#ldr-up').setInputFiles({ name: 'loader.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => settingsRow('brand').data.loader.kind).toBe('image');
  await expect(pg.locator('[data-ldr-pv] img.ib-ldr-img').first()).toBeVisible();
  // the favicon: drawn 64 × 64 here, saved as a PNG, in the page's head
  await pg.locator('#fav-up').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => String(settingsRow('brand').data.favicon || '')).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('head link[data-ib-fav]')).toHaveCount(1);
  expect(mock.activityRows.map((r) => r.action).concat(mock.activity.map((a) => a.action))).toEqual(expect.arrayContaining(['settings.brand.loader', 'settings.brand.favicon']));
  await page.locator('[data-set-save]').click().catch(() => {});
  // another member signs in: the same preloader and icon
  await relogin(page);
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('head link[data-ib-fav]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.IBLoader.config().kind)).toBe('image');
  // back to the original (the admin)
  await relogin(page);
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  await openSettings(page, 'brand');
  await page.locator('#pg-settings [data-ldr-reset]').click();
  await expect.poll(() => settingsRow('brand').data.loader === undefined).toBe(true);
  await page.locator('#pg-settings [data-fav-reset]').click();
  await expect.poll(() => settingsRow('brand').data.favicon === undefined).toBe(true);
  await expect(page.locator('head link[data-ib-fav]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.IBLoader.config().kind)).toBe('worm');
  // the original icon = the logo itself
  await expect(page.locator('head link[data-ib-fav-logo]')).toHaveCount(1);
  expect(await page.locator('head link[data-ib-fav-logo]').getAttribute('href')).toMatch(/^data:image\/svg\+xml,/);
});
