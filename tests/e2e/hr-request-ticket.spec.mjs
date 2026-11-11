import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// Phase 13 decision 33 (0071 — owner 10 Nov: «تحويل طلباتي إلى تذاكر الفريق»; in the reply: the «طلباتي» tab goes, leave / advance /
// remote-work requests are filed as a team ticket and decided from there, like the overtime): «طلب موارد بشرية» on the tickets page files
// the request with the HR page's forms, the server opens its ticket for the direct manager's role with the family only in the title
// (no leave sub-type, dates, note or amount), the member can cancel from the ticket's card, the manager / admin decides there and the
// decision closes the ticket. Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002';
let mock = null; let pageErrors = [];
test.beforeEach(() => { test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)'); });
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, email) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const modal = (page, title) => page.locator('.modal[role=dialog]', { hasText: title }).last();
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// the next Sunday at least a week ahead (a working day)
const nextSunday = () => { let d = addDays(hrToday(), 7); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 0) d = addDays(d, 1); return d; };
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); // the date fields take dd/mm/yyyy
// a date field commits on blur and the form redraws between the two: one at a time, each checked
async function setDates(f, day, ids = ['#from', '#to']) { for (const id of ids) { await f.locator(id).fill(dmy(day)); await f.locator(id).press('Tab'); await expect(f.locator(id)).toHaveValue(dmy(day)); } }
const seen = (page, id) => expect.poll(() => page.evaluate((k) => !!window.IBTickets.get(k), 'TKT-' + String(id).padStart(4, '0'))).toBe(true);

test('decision 33: a leave filed from «تذاكر الفريق» opens its ticket with no HR detail; the admin approves it in the ticket and it closes', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await signIn(page, OPS);
  // the owner 11 Nov: «طلباتي» is back in «ملفي» — the team requests I opened
  await page.evaluate(() => { location.hash = 'profile'; });
  await expect(page.locator('#pg-profile .prof-head')).toBeVisible();
  await expect(page.locator('#pg-profile').getByRole('tab', { name: 'طلباتي' })).toHaveCount(1);
  await page.evaluate(() => { location.hash = 'tickets'; });
  // decision 66: one «طلب جديد» popup — the type picks the fields
  await page.locator('[data-req-new]').click();
  const f = modal(page, 'طلب جديد');
  const day = nextSunday();
  await f.locator('#t-type').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveText(['مشكلة عميل', 'مشكلة مبتكر', 'طلب إجازة', 'طلب سلفة', 'طلب فترة راحة', 'طلب خاص']);
  await page.locator('[role=listbox] [role=option]', { hasText: 'طلب إجازة' }).first().click();
  await expect(f.locator('#t-title')).toHaveCount(0); await expect(f.locator('#t-role')).toHaveCount(0); // no title / role / priority for an HR request
  await f.locator('#t-lkind').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'إجازة عارضة' }).first().click();
  await setDates(f, day, ['#t-from', '#t-to']);
  await f.locator('#t-note').fill('فرح أختي');
  await f.locator('[data-req-submit]').click();
  await expect(f).toHaveCount(0); // filed: the popup closed
  await expect.poll(() => (mock.hr.requests.find((r) => r.member_id === OPS_ID && r.type === 'إجازة عارضة') || {}).ticket_id).toBeTruthy();
  const req = mock.hr.requests.find((r) => r.member_id === OPS_ID && r.type === 'إجازة عارضة');
  expect(req.ticket_id).toBeTruthy();
  const tk = mock.tickets.find((t) => t.id === req.ticket_id);
  expect(tk).toMatchObject({ type: 'internal', status: 'open', assignee_role: 'مدير النظام', created_by: OPS_ID }); // her manager is the admin
  expect(tk.title.startsWith('طلب إجازة — سارة أحمد')).toBe(true);
  for (const bit of ['عارضة', 'فرح', day]) expect(tk.title + tk.description).not.toContain(bit); // the family only — no HR detail
  expect(mock.alerts.some((a) => a.kind === 'hr.request' && a.role_id === 'admin' && a.entity === 'tickets/TKT-' + String(tk.id).padStart(4, '0'))).toBe(true);
  await seen(page, tk.id);
  // the member sees the card in her ticket, waiting, with «إلغاء الطلب» and no decision buttons
  await page.evaluate((id) => { location.hash = 'tickets/TKT-' + String(id).padStart(4, '0'); }, tk.id);
  const card = page.locator('[data-hr-request]');
  await expect(card).toContainText('إجازة عارضة'); await expect(card).toContainText('مستني قرار مديرك المباشر');
  await expect(card.locator('[data-rq-cancel]')).toBeVisible(); await expect(card.locator('[data-rq-approve]')).toHaveCount(0);
  // the admin approves it from the ticket
  await page.evaluate(() => window.IBAuth.signOut('local'));
  await signIn(page, 'admin.dev@ibtekr.local');
  await page.evaluate((id) => { location.hash = 'tickets/TKT-' + String(id).padStart(4, '0'); }, tk.id);
  await page.locator('[data-hr-request] [data-rq-approve]').click();
  await expect.poll(() => mock.hr.requests.find((r) => r.id === req.id).status).toBe('موافق');
  await expect.poll(() => mock.tickets.find((t) => t.id === tk.id).status).toBe('closed');
  expect(mock.tickets.find((t) => t.id === tk.id).resolution_outcome).toBe('اتحلت المشكلة');
});

test('decision 66: «طلب فترة راحة» from «طلب جديد» (the day, from / to times → the hours), then cancelled from its ticket card — the ticket closes', async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
  await signIn(page, OPS);
  await page.evaluate(() => { location.hash = 'tickets'; });
  await page.locator('[data-req-new]').click();
  const f = modal(page, 'طلب جديد'); const day = nextSunday();
  await f.locator('#t-type').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'طلب فترة راحة' }).first().click();
  await setDates(f, day, ['#t-from']);
  await f.locator('#t-start').fill('13:00'); await f.locator('#t-end').fill('12:00');
  await f.locator('[data-req-submit]').click();
  await expect(f).toContainText('النهاية لازم بعد البداية'); // refused on the page
  await f.locator('#t-end').fill('14:30');
  await expect(f.locator('[data-rest-hours]')).toHaveAttribute('data-rest-hours', '1.5');
  await f.locator('[data-req-submit]').click();
  await expect.poll(() => (mock.hr.requests.find((r) => r.member_id === OPS_ID && r.type === 'فترة راحة') || {}).ticket_id).toBeTruthy();
  const req = mock.hr.requests.find((r) => r.member_id === OPS_ID && r.type === 'فترة راحة');
  expect(mock.tickets.find((t) => t.id === req.ticket_id).title.startsWith('طلب فترة راحة — ')).toBe(true);
  expect([req.from_day, req.at_time, req.hours]).toEqual([day, '13:00', 1.5]);
  await seen(page, req.ticket_id);
  await page.evaluate((id) => { location.hash = 'tickets/TKT-' + String(id).padStart(4, '0'); }, req.ticket_id);
  await page.locator('[data-hr-request] [data-rq-cancel]').click();
  await modal(page, 'إلغاء الطلب').getByRole('button', { name: 'إلغاء الطلب' }).click();
  await expect.poll(() => mock.hr.requests.find((r) => r.id === req.id).status).toBe('اتلغى');
  await expect.poll(() => mock.tickets.find((t) => t.id === req.ticket_id).status).toBe('closed');
});
