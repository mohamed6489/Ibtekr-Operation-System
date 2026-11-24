import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday } from './hr-mock.mjs';

// The meeting of 23 Nov — phase 7 (docs/superpowers/plans/2026-11-23-meeting.md; 0155): the bonus by a weighted evaluation.
// [#42] «الإعدادات › الموارد البشرية › قواعد التقييم والبونص»: a role's own items (add / rename / weight — the weights sum to 100% or
// the save stops with the line), the point, the bands; [#41] the month rated by the member's role items, the result the weighted
// average and the bonus % of the holdback (and its money) beside it, in the payroll and in «ملفي › أدائي»; the band's alert to the
// manager opens the evaluation's actions one click each (a note on the profile). Mock only; the dates follow today.
const ADMIN = 'admin.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const OPS_ID = '00000000-0000-4000-8000-000000000002'; const ACC_ID = '00000000-0000-4000-8000-000000000004';
const T = hrToday(); const MK = T.slice(0, 7) + '-01';
const SEED = {
  hrMembers: [{ member_id: OPS_ID, hire_date: '2024-05-12' }, { member_id: ACC_ID }],
  hrPay: [{ member_id: OPS_ID, salary: 12000, holdback: 1500, allowances: 0 }, { member_id: ACC_ID, salary: 9600, holdback: 1000, allowances: 0 }],
  hrPayroll: [{ month: MK, status: 'مسودة' }],
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function signIn(page, hash) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const calls = (fn) => mock.hr.calls.filter((c) => c.fn === fn);
const hrRow = () => (mock.settings.find((x) => x.section === 'hr') || {}).data || {};

test('#42 — the rules in the settings: a role\'s own items, the weights must sum to 100% (the line, the save stops), the point and a band; «حفظ» writes evalRules', async ({ page }) => {
  await signIn(page, 'settings-hr');
  const S = page.locator('[data-hr-settings]');
  const sec = S.locator('section.card', { hasText: 'قواعد التقييم والبونص' });
  await expect(sec).toContainText('مجموع الأوزان 100% ✓');
  await expect(sec).toContainText('حضور 4 · تواصل 5 · أداء 3 = 3.75 = 75% من المحجوز'); // the meeting's example
  // the operations role gets its own list
  await sec.locator('#hs-ev-role').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'عمليات' }).first().click();
  await expect(sec.locator('[data-hs-ev-same]')).toBeVisible();
  await sec.locator('[data-hs-ev-own]').click();
  await sec.locator('[data-hs-ev-add]').click();
  await sec.locator('#hs-ev-n-3').fill('الجودة'); await sec.locator('#hs-ev-n-3').press('Tab');
  await sec.locator('#hs-ev-w-3').fill('20'); await sec.locator('#hs-ev-w-3').press('Tab');
  await expect(sec.locator('[data-hs-ev-sum]')).toContainText('مجموع الأوزان لازم يبقى 100% — دلوقتي 120%');
  await page.locator('[data-set-save]').first().click();
  await expect(page.locator('.toast.show').last()).toContainText('مجموع الأوزان لازم يبقى 100%');
  expect(hrRow().evalRules).toBeUndefined();
  await sec.locator('#hs-ev-w-2').fill('30'); await sec.locator('#hs-ev-w-2').press('Tab'); // الأداء 50 → 30
  await expect(sec.locator('[data-hs-ev-sum]')).toContainText('مجموع الأوزان 100% ✓');
  await sec.locator('#hs-ev-point').fill('15'); await sec.locator('#hs-ev-point').press('Tab');
  await sec.locator('[data-hs-ev-band]').click(); // + a band from 5 (the last one 4.5 + 0.5)
  await page.locator('[data-set-save]').first().click();
  await expect.poll(() => hrRow().evalRules && hrRow().evalRules.point).toBe(15);
  const r = hrRow().evalRules;
  expect(r.roles.ops.map((i) => [i.name, i.weight])).toEqual([['الحضور', 25], ['التواصل', 25], ['الأداء', 30], ['الجودة', 20]]);
  expect(r.items.map((i) => i.weight)).toEqual([25, 25, 50]); // the team's list as it was
  expect(r.actions.map((a) => a.min)).toEqual([0, 2.5, 3.5, 4.5, 5]);
});

test('#41 — the month rated by the member\'s role items: the stars per item with their weight, the weighted result and the bonus % (and money) beside it, in the payroll and the manager\'s alert opens its actions', async ({ page }) => {
  // the operations role rated on «الجودة» and «السرعة» only (the attendance at 0 = not counted)
  Object.assign(mock.settings.find((x) => x.section === 'hr') || (mock.settings.push({ section: 'hr', data: {} }), mock.settings[mock.settings.length - 1]), { data: Object.assign(hrRow(), { evalRules: { roles: { ops: [
    { id: 'att', name: 'الحضور', weight: 0, auto: true }, { id: 'quality', name: 'الجودة', weight: 60 }, { id: 'speed', name: 'السرعة', weight: 40 }] } } }) });
  await signIn(page, 'hr-evals');
  const P = page.locator('#pg-hr'); const t = P.locator('table.hr-evals');
  await t.locator('tbody tr', { hasText: 'سارة أحمد' }).locator('[data-hr-rate]').click();
  const f = page.locator('.modal.ev-modal[role=dialog]');
  await expect(f.locator('[data-hr-rate-items]')).toHaveAttribute('data-hr-rate-items', '2');
  const box = (id) => f.locator('.ev-box', { has: page.locator('#' + id) });
  await expect(box('ev-quality')).toContainText('الوزن 60%'); await expect(box('ev-speed')).toContainText('الوزن 40%');
  await expect(f.locator('#ev-perf')).toHaveCount(0);
  await expect(f.locator('.ev-att')).toContainText('مش محسوب في الدور ده');
  await f.locator('#ev-quality [data-star="2"]').click(); await f.locator('#ev-speed [data-star="2"]').click();
  const strip = f.locator('[data-hr-rate-total]');
  await expect(strip).toHaveAttribute('data-hr-rate-total', '2'); await expect(strip).toHaveAttribute('data-hr-rate-pct', '40');
  await expect(strip).toContainText('البونص 40% من المحجوز'); await expect(strip).toContainText('الإجراء المقترح: إنذار + ميتنج فردي');
  await f.getByRole('button', { name: 'حفظ التقييم' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_evaluate').map((c) => [c.p_member, c.p_scores])).toEqual([[OPS_ID, { quality: 2, speed: 2 }]]);
  const row = t.locator('tbody tr', { hasText: 'سارة أحمد' });
  await expect(row.locator('[data-hr-eval-items]')).toHaveText('الجودة 2 · السرعة 2');
  await expect(row.locator('[data-hr-eval-bonus]')).toContainText('40%'); await expect(row.locator('[data-hr-eval-bonus]')).toContainText('600'); // 40% of 1,500
  await expect(row).toContainText('إنذار + ميتنج فردي');
  // the alert to her manager (the admin here) — the bell's link opens the actions, a note in one click
  const al = mock.alerts.find((a) => a.kind === 'hr.eval.action' && a.user_id === ADMIN_ID);
  expect(al && al.entity).toBe('hr-evals/m02-' + MK.slice(0, 7));
  await page.evaluate((x) => { location.hash = x; }, al.entity);
  const a = modal(page, 'تقييم سارة أحمد');
  await expect(a.locator('[data-hr-eval-action]')).toContainText('الإجراء المقترح: إنذار + ميتنج فردي');
  await expect(a.locator('[data-hr-eval-do]')).toHaveCount(3); // the meeting, the warning, the improvement plan
  await a.locator('[data-hr-eval-do="warning"]').click();
  const w = modal(page, 'ابعت إنذار — سارة أحمد');
  await w.locator('#body').fill('التسليمات اتأخرت'); await w.getByRole('button', { name: 'ابعت الإنذار' }).click();
  await expect(w).toBeHidden();
  expect(calls('hr_member_note_add').map((c) => [c.p_member, c.p_kind])).toEqual([[OPS_ID, 'warning']]);
  // the payroll shows the month's bonus beside the salary (paid with the quarter's third month)
  await page.evaluate(() => { location.hash = 'hr-payroll'; });
  const pr = P.locator('tbody tr', { hasText: 'سارة أحمد' }).first();
  if (Number(MK.slice(5, 7)) % 3) await expect(pr.locator('[data-hr-month-bonus]')).toContainText('600');
  else await expect(pr).toContainText('600');
});

test('#42 — the band 2.5–3.5 offers «اكتب ملاحظة» (a note on the profile, «ملفي › أدائي»)', async ({ page }) => {
  // منى حسن: the default items — attendance (none since her hiring → 0) 25, communication 4, performance 4 → 3 → a note
  mock.hr.evaluations.push({ member_id: ACC_ID, month: MK, performance: 4, communication: 4, note: null, rated_by: null, rated_at: new Date().toISOString() });
  await signIn(page, 'hr-evals');
  const row = page.locator('#pg-hr table.hr-evals tbody tr', { hasText: 'منى حسن' });
  await expect(row).toContainText('ملاحظة');
  await row.getByRole('button', { name: 'إجراءات تقييم منى حسن' }).click();
  const m = page.locator('[role=menu]').last();
  await expect(m.getByRole('menuitem', { name: 'ابعت إنذار' })).toHaveCount(0);
  await m.getByRole('menuitem', { name: 'اكتب ملاحظة' }).click();
  const f = modal(page, 'اكتب ملاحظة — منى حسن');
  await f.getByRole('button', { name: 'احفظ الملاحظة' }).click();
  await expect(f).toContainText('اكتب الملاحظة');
  await f.locator('#body').fill('ركّزي على تقفيل اليومية في ميعادها'); await f.getByRole('button', { name: 'احفظ الملاحظة' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_member_note_add').map((c) => [c.p_member, c.p_kind, c.p_period])).toEqual([[ACC_ID, 'note', MK.slice(0, 7)]]);
});
