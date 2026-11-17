import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// 0124 (docs/superpowers/plans/2026-11-17-agents-brain.md decision 1 — the owner 17 Nov: «يقولي ان في مشكلة في التنبيهات و لما ادوس
// عليها توديني عندوا نحلها سوا … لغة حوارنا دايما من خلال التنبيهات»): the assistants' notes in the bell's «المساعدين», for who sees
// the assistant; the click opens the assistant's chat with the note as its first message; the admin turns an assistant's notes off in
// «الإعدادات › التنبيهات › المساعدين». Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const ACC = 'accounts.dev@ibtekr.local';
const NOTES = [
  { agent: 'dev', kind: 'problem', title: 'مشكلة في مزامنة الأوردرات', body: 'آخر 3 تشغيلات للمزامنة فشلت بـ 401 — مفتاح ووكومرس محتاج يتراجع.', link: 'settings-integrations' },
  { agent: 'accountant', kind: 'report', title: 'فيه 3 مبتكرين مستحقين تحويل', body: 'الصافي فوق حد التحويل.' },
];
let mock = null; let pageErrors = [];
async function start(page, extra = {}) {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { agentNotes: NOTES, ...extra });
}
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, email) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const bell = (page) => page.getByRole('dialog', { name: 'الإشعارات' });
const agentsNav = (page) => bell(page).locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: /^المساعدين$/ }) });

test('0124 — the bell\'s «المساعدين»: the admin sees both notes; the click opens the developer\'s chat with the note as its first message, once', async ({ page }) => {
  await start(page); await signIn(page, ADMIN);
  await page.locator('.notif-btn').click();
  await expect(agentsNav(page)).toBeVisible();
  await agentsNav(page).click();
  await expect(bell(page).locator('.ntf-item')).toHaveCount(2);
  await bell(page).locator('.ntf-item', { hasText: 'مشكلة في مزامنة الأوردرات' }).click();
  await expect(page.locator('#pg-ai')).toBeVisible();
  await expect(page.locator('#pg-ai')).toContainText('آخر 3 تشغيلات للمزامنة فشلت');
  expect(mock.mkt.writes.filter((w) => w.table === 'ai_agent_notes' && w.op === 'open')).toHaveLength(1);
  expect(mock.mkt.agentChats.filter((c) => c.agent === 'dev')).toHaveLength(1);
  // read now: the section counts one unread
  await page.locator('.notif-btn').click(); await agentsNav(page).click();
  await expect(bell(page).locator('.ntf-item.muted, .ntf-item[data-muted]')).toHaveCount(1);
});

test('0124 — accounts sees the accountant\'s note only (the developer is marketing.view)', async ({ page }) => {
  await start(page); await signIn(page, ACC);
  await page.locator('.notif-btn').click(); await agentsNav(page).click();
  await expect(bell(page).locator('.ntf-item')).toHaveCount(1);
  await expect(bell(page).locator('.ntf-item')).toContainText('مستحقين تحويل');
});

test('0124 — no notes, no «المساعدين»; before 0124 the bell is as it was', async ({ page }) => {
  await start(page, { agentNotes: [], noAgentNotes: true }); await signIn(page, ADMIN);
  await page.locator('.notif-btn').click();
  await expect(bell(page)).toBeVisible();
  await expect(agentsNav(page)).toHaveCount(0);
});

test('0124 — «الإعدادات › التنبيهات › المساعدين»: the admin switches an assistant\'s notes off and it is saved in the row «notif»', async ({ page }) => {
  await start(page); await signIn(page, ADMIN);
  await page.goto('/#settings-notifications');
  await page.getByRole('tab', { name: 'المساعدين' }).click();
  const sw = page.locator('[data-agent-note="dev"]');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => { const r = (mock.settings || []).find((x) => x.section === 'notif'); return r && r.data && r.data.agents && r.data.agents.dev && r.data.agents.dev.on; }).toBe(false);
});
