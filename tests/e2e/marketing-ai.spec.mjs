import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { mktToday, mktAddDays } from './mkt-mock.mjs';

// «التسويق › مساعدين الذكاء الاصطناعي» 9.5.4 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 49–56): the media
// buyer's open suggestions (the server's rows) with the admin's decisions — reject, approve, edit — recorded only while the execution
// switch is off and carried out on Meta once the admin turns it on (through mkt-ads), the rules and limits, the buyer's chat (text
// only), the designer's and the developer's requests. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACC = 'accounts.dev@ibtekr.local';
const TODAY = mktToday(); const D = (n) => mktAddDays(TODAY, n);
const CA = '120252323303340228', CB = '120251977233530228';
const OBJECTS = [
  { kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE' },
  { kind: 'campaign', id: CA, parent_id: '1122334455', name: 'Macrame — Retargeting', status: 'ACTIVE', meta: { daily_budget: 300 } },
  { kind: 'campaign', id: CB, parent_id: '1122334455', name: 'Lamps — Broad', status: 'ACTIVE' },
  { kind: 'ad', id: '1207', parent_id: CB, name: 'Lamps video', status: 'ACTIVE', thumb: null },
];
const STATS = [{ level: 'campaign', object_id: CA, campaign_id: CA, day: D(-1), spend: 600, purchases: 3, purchase_value: 4000 }, { level: 'campaign', object_id: CB, campaign_id: CB, day: D(-1), spend: 800, purchases: 4, purchase_value: 2000 }];
const SUGG = [
  { kind: 'stop', campaign_id: CB, campaign_name: 'Lamps — Broad', title: 'وقّف «Lamps — Broad»', sub: 'صرفت 1,700 ج.م · 0 أوردر في ووكومرس من 5 أيام', why: 'ميتا بتحسب 10 مشتريات، بس مفيش ولا أوردر في ووكومرس جاي من الحملة دي.', impact: 'توفير ~340 ج.م/يوم', data: { spend5: 1700 } },
  { kind: 'budget_up', campaign_id: CA, campaign_name: 'Macrame — Retargeting', title: 'زوّد «Macrame — Retargeting» 20%', sub: 'العائد الحقيقي 5.00× · 5 أوردر مؤكد في ووكومرس', why: 'من أعلى عائد حقيقي.', impact: 'متوقع +1 أوردرات/أسبوع', pct: 20, data: { daily_budget: 300 } },
  { kind: 'creative', campaign_id: CB, campaign_name: 'Lamps — Broad', ad_id: '1207', title: 'إعلان «Lamps video» الناس زهقت منه', sub: 'التكرار 4.5 · اطلب نسخة من الديزاينر', why: 'التكرار 4.5.', impact: 'نسخة جديدة من الديزاينر' },
  { kind: 'tracking', campaign_id: CB, campaign_name: 'Lamps — Broad', title: 'فرق كبير في أرقام «Lamps — Broad»', sub: 'ميتا بتقول 10 مشتريات · ووكومرس 0 أوردر', why: 'ممكن البكسل بيعد مرتين.', impact: 'راجع التتبع' },
  { kind: 'budget_down', campaign_id: CA, campaign_name: 'Macrame — Retargeting', title: 'قلّل ميزانية «Macrame — Retargeting» 30%', sub: 'تكلفة الأوردر 600 ج.م', pct: -30, data: { daily_budget: 300 }, status: 'rejected', decided_at: D(-3) + 'T10:00:00Z', note: 'لسه جديدة' },
];
// 0082: the requests to the human designer / developer are team requests (tickets of a kind) — the page reads them from «طلبات الفريق»
const OPS_ID = '00000000-0000-4000-8000-000000000002';
const TICKETS = [
  { id: 1, type: 'internal', kind: 'design', project: 'الشتا', title: 'فيديو Macrame', description: '9:16 · 15 ثانية', priority: 'normal', assignee_role: 'ديزاينر', status: 'waiting', created_by: OPS_ID, created_by_name: 'سارة أحمد', created_by_role: 'اللوجستيك والشحن' },
  { id: 2, type: 'internal', kind: 'dev', project: 'موقع', title: 'صفحة هبوط رمضان', description: 'لعروض رمضان', priority: 'high', assignee_role: 'مبرمج', status: 'in_progress' },
  { id: 3, type: 'internal', kind: null, project: null, title: 'طلب خاص عادي', description: 'مش من التسويق', priority: 'normal', assignee_role: 'مدير النظام', status: 'open' },
];
let mock = null; let pageErrors = [];
async function start(page, extra = {}) {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { mktAdObjects: OBJECTS, mktAdStats: STATS, mktSuggestions: SUGG, tickets: TICKETS, ...extra });
}
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, email) {
  if (!(await page.locator('#login').isVisible().catch(() => false))) await page.goto('/').catch(() => {}); // after a sign-out the login is already there (its own reload may interrupt this goto — the login lands either way)
  await expect(page.locator('#login')).toBeVisible();
  await page.waitForLoadState('load').catch(() => {}); // the sign-out's own reload may still be landing on a slow runner
  for (let i = 0; i < 3; i++) { // a click swallowed by that reload is sent again
    await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
    if (await page.locator('#root').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) break;
  }
  await expect(page.locator('#root')).toBeVisible();
}
async function openAi(page, email, sub) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await pg(page).getByRole('tab', { name: /مساعدين الذكاء الاصطناعي/ }).click();
  if (sub) await pg(page).getByRole('tab', { name: new RegExp(sub) }).click();
}
const pg = (page) => page.locator('#pg-marketing');
async function signOut(page) { await page.locator('.user-btn').click(); await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click(); await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('#root')).toBeHidden(); await page.waitForLoadState('load').catch(() => {}); }
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const close = (m) => m.locator('button.btn-text', { hasText: 'إغلاق' }).click();
const toast = (page) => page.locator('.toast.show');
const suggModal = (page) => page.locator('.modal[data-mk-sugg]');
const decides = () => mock.mkt.writes.filter((w) => w.table === 'mkt_suggestions' && w.op === 'decide');

test('the buyer: the open suggestions, the switch off → an approval is recorded only; reject with a note; the member sees no buttons', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN);
  const P = pg(page);
  const pend = P.locator('[data-mk-pending="4"] [data-mk-sugg]');
  await expect(pend).toHaveCount(4);
  await expect(pend.nth(0)).toContainText('وقّف «Lamps — Broad»');
  await expect(P.locator('[data-mk-past="1"]')).toContainText('اترفض');
  await expect(P.locator('[data-mk-live="off"]')).toContainText('التنفيذ على ميتا متوقف');
  // approve the stop while the switch is off: recorded, nothing on Meta
  await pend.nth(0).click();
  const m = suggModal(page);
  await expect(m).toContainText('ميتا بتحسب 10 مشتريات');
  await expect(m).toContainText('مفتاح التنفيذ على ميتا مقفول');
  await m.locator('[data-mk-approve]').click();
  await expect(toast(page)).toContainText('مفتاح التنفيذ مقفول');
  expect(decides().at(-1)).toMatchObject({ id: 1, decision: 'approve', status: 'approved' });
  expect(mock.mkt.adObjects.find((o) => o.id === CB).status).toBe('ACTIVE');
  await expect(P.locator('[data-mk-pending="3"]')).toBeVisible();
  await expect(P.locator('[data-mk-past="2"]')).toContainText('اتوافق — من غير تنفيذ');
  // reject the tracking one with a note
  await P.locator('[data-mk-sugg="4"]').click();
  await suggModal(page).locator('[data-mk-reject]').click();
  const rj = modal(page, 'رفض:');
  await rj.locator('textarea').fill('هنراجع البكسل الأول');
  await rj.getByRole('button', { name: 'ارفض الاقتراح' }).click();
  await expect(toast(page)).toContainText('اترفض');
  expect(mock.mkt.suggestions.find((s) => s.id === 4)).toMatchObject({ status: 'rejected', note: 'هنراجع البكسل الأول' });
  // the log carries the decision and the status only
  await expect.poll(() => mock.activityRows.filter((l) => l.action === 'mkt.buyer.decide').map((l) => l.new_value)).toEqual(['approve · approved · live_off', 'reject · rejected']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('البكسل');
  // ops (marketing.view F, not the admin): reads, no decision buttons
  await signOut(page);
  await openAi(page, OPS);
  await pg(page).locator('[data-mk-sugg="2"]').click();
  const o = suggModal(page);
  await expect(o).toContainText('القرار للأدمن');
  await expect(o.locator('[data-mk-approve], [data-mk-reject], [data-mk-edit]')).toHaveCount(0);
  await close(o);
  await expect(pg(page).locator('[data-mk-live-toggle]')).toHaveCount(0);
});

test('the switch on (the admin, confirmed): a stop pauses the campaign on Meta; a budget edited to 10% → the new daily budget; the cap refuses; creative → a designer request', async ({ page }) => {
  await start(page, { mktRules: { dailyCap: 1300 }, mktAccountDaily: 1000 });
  await openAi(page, ADMIN);
  const P = pg(page);
  await P.locator('[data-mk-live-toggle]').click();
  const c = modal(page, 'تشغّل التنفيذ على ميتا؟');
  await expect(c).toContainText('مفيش حاجة بتتنفّذ من غير موافقتك');
  await c.getByRole('button', { name: 'شغّل التنفيذ' }).click();
  await expect(toast(page)).toContainText('التنفيذ على ميتا اشتغل');
  await expect(P.locator('[data-mk-live="on"]')).toBeVisible();
  expect(mock.mkt.writes.filter((w) => w.op === 'buyer_live').map((w) => w.on)).toEqual([true]);
  // the stop: a confirmation, then PAUSED on Meta
  await P.locator('[data-mk-sugg="1"]').click();
  const m = suggModal(page);
  await expect(m).toContainText('الموافقة بتوقف الحملة على ميتا فورًا');
  await m.locator('[data-mk-approve]').click();
  await modal(page, 'تنفّذ على ميتا؟').getByRole('button', { name: 'أيوه، نفّذ' }).click();
  await expect(toast(page)).toContainText('اتنفّذ على ميتا');
  expect(mock.mkt.adObjects.find((o) => o.id === CB).status).toBe('PAUSED');
  expect(mock.mkt.suggestions.find((s) => s.id === 1)).toMatchObject({ status: 'done', result: { status: 'PAUSED' } });
  // the raise edited to 10% (300 → 330): the rest of the account spends 1,000, the cap is 1,300 → 1,330 refused
  await P.locator('[data-mk-sugg="2"]').click();
  await suggModal(page).locator('[data-mk-edit]').click();
  const ed = modal(page, 'تعديل:');
  await ed.locator('input').first().fill('40');
  await ed.getByRole('button', { name: 'وافق بالتعديل ونفّذ' }).click();
  await expect(ed).toContainText('رقم صحيح من 1 لـ 30');
  await ed.locator('input').first().fill('10');
  await ed.getByRole('button', { name: 'وافق بالتعديل ونفّذ' }).click();
  await expect(toast(page)).toContainText('السقف اليومي');
  expect(mock.mkt.suggestions.find((s) => s.id === 2)).toMatchObject({ status: 'failed', error: 'cap', value: 10 });
  await expect(P.locator('[data-mk-past]')).toContainText('كان هيعدّي السقف اليومي');
  // raise the cap from the rules card, then the same raise on a fresh suggestion goes through
  await P.locator('[data-mk-rule="dailyCap"]').click();
  const r = modal(page, 'تعديل: حد الصرف اليومي');
  await r.locator('input').first().fill('5000');
  await r.getByRole('button', { name: 'احفظ القاعدة' }).click();
  await expect(toast(page)).toContainText('اتحفظت القاعدة');
  await expect(P.locator('[data-mk-rule="dailyCap"]')).toContainText('5,000 ج.م');
  expect(mock.mkt.rules.dailyCap).toBe(5000);
  mock.mkt.suggestions.push({ ...mock.mkt.suggestions[1], id: 9, status: 'pending', error: null, value: null, result: null, decided_at: null, decided_by: null });
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  await pg(page).getByRole('tab', { name: /مساعدين الذكاء الاصطناعي/ }).click();
  await pg(page).locator('[data-mk-sugg="9"]').click();
  await suggModal(page).locator('[data-mk-approve]').click();
  await modal(page, 'تنفّذ على ميتا؟').getByRole('button', { name: 'أيوه، نفّذ' }).click();
  await expect(toast(page)).toContainText('الميزانية بقت 360 ج.م/يوم');
  expect(mock.mkt.adObjects.find((o) => o.id === CA).meta.daily_budget).toBe(360);
  // creative → a designer request in its tab
  await pg(page).locator('[data-mk-sugg="3"]').click();
  await suggModal(page).locator('[data-mk-approve]').click();
  await expect(toast(page)).toContainText('اتبعت للديزاينر');
  await pg(page).getByRole('tab', { name: /الديزاينر/ }).click();
  await expect(pg(page).locator('[data-mk-reqs="designer"]')).toContainText('نسخة جديدة لإعلان «Lamps video»');
  // 0082: a design team request to «ديزاينر», as the deciding admin
  expect(mock.tickets.find((t) => t.title.includes('Lamps video'))).toMatchObject({ type: 'internal', kind: 'design', status: 'open', project: 'Lamps — Broad', assignee_role: 'ديزاينر' });
});

test('the v6 «+ قاعدة جديدة»: the admin writes a rule in words (kept on the server with the rules — guidance only), edits it, deletes it; a member sees them without buttons', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN);
  const P = pg(page);
  await P.locator('[data-mk-note-add]').click();
  const f = modal(page, 'قاعدة جديدة');
  await f.locator('input').first().fill('CTR قليل');
  await f.locator('textarea').first().fill('إعلان CTR أقل من 0.8% ← بلّغني');
  await f.getByRole('button', { name: 'احفظ القاعدة' }).click();
  await expect(toast(page)).toContainText('اتحفظت القاعدة');
  await expect(P.locator('[data-mk-note="0"]')).toContainText('CTR قليل');
  await expect(P.locator('[data-mk-note="0"]')).toContainText('قاعدة');
  expect(mock.mkt.rules.notes).toEqual([{ title: 'CTR قليل', details: 'إعلان CTR أقل من 0.8% ← بلّغني', kind: 'قاعدة' }]);
  expect(mock.mkt.rules.live).toBe(false); // a rule never touches the switch
  // edit, then delete
  await P.locator('[data-mk-note="0"]').click();
  const e = modal(page, 'تعديل: CTR قليل');
  await e.locator('input').first().fill('CTR واطي');
  await e.getByRole('button', { name: 'احفظ القاعدة' }).click();
  await expect(P.locator('[data-mk-note="0"]')).toContainText('CTR واطي');
  await P.locator('[data-mk-note="0"]').click();
  await modal(page, 'تعديل: CTR واطي').locator('[data-mk-note-del]').click();
  await expect(toast(page)).toContainText('اتمسحت القاعدة');
  await expect(P.locator('[data-mk-note]')).toHaveCount(0);
  expect(mock.mkt.rules.notes).toEqual([]);
  // a member reads the rules without buttons
  mock.mkt.rules.notes = [{ title: 'تقرير الجمعة', details: 'ملخص أسبوعي يوم الجمعة', kind: 'تقرير' }];
  await signOut(page);
  await openAi(page, OPS);
  await expect(pg(page).locator('[data-mk-note="0"]')).toContainText('تقرير الجمعة');
  await expect(pg(page).locator('div[data-mk-note="0"]')).toHaveCount(1); // not a button
  await expect(pg(page).locator('[data-mk-note-add]')).toHaveCount(0);
});

test('the chat (0084): the question and the answer in the thread (ai-content agent — the server keeps the chat), the quick chips; the refusal in words', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN);
  const P = pg(page);
  await expect(P.locator('[data-mk-pending]')).toBeVisible(); // the tab re-renders once the suggestions land — type after that
  await P.locator('#mk-ask').fill('أزوّد Macrame؟');
  await P.locator('[data-mk-ask]').click();
  await expect(P.locator('[data-mk-chat="2"] .mk-msg.ai[data-mk-turn]')).toContainText('سؤالك: أزوّد Macrame؟');
  await expect(P.locator('.mk-msg.user')).toContainText('أزوّد Macrame؟');
  await P.locator('.chip', { hasText: 'إيه أحسن حملة؟' }).click();
  await expect(P.locator('[data-mk-chat="4"]')).toBeVisible();
  const calls = mock.mkt.calls.filter((x) => x.fn === 'ai-content' && x.action === 'agent');
  expect(calls.map((x) => [x.agent, x.history, !!x.chat])).toEqual([['buyer', 0, false], ['buyer', 2, true]]); // the second message goes to the chat the first made
  await expect.poll(() => mock.activityRows.filter((l) => l.action === 'mkt.agent.chat').length).toBe(2);
  expect(JSON.stringify(mock.activityRows)).not.toContain('أزوّد');
  mock.mkt.agentFail = 'ai_cap';
  await P.locator('#mk-ask').fill('x'); await P.locator('#mk-ask').press('Enter');
  await expect(toast(page)).toContainText('سقف الـ AI الشهري');
  await expect(P.locator('[data-mk-chat="4"]')).toBeVisible(); // the failed question is taken back
  // accounts (marketing N) has no page
  await signOut(page);
  await signIn(page, ACC);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(pg(page)).toContainText('مفيش صلاحية');
});

test('0084 the chats like Claude\'s: the history on the side (the member\'s own, newest first), a new chat named by its first question, rename, delete; ⚙️ the admin\'s settings (the intro, the instructions, the chips); expand / shrink with the same button', async ({ page }) => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const CH = (n) => 'c1000000-0000-4000-8000-00000000000' + n;
  await start(page, {
    mktAgentChats: [{ id: CH(1), member_id: ADMIN_ID, agent: 'designer', title: 'بوست الشتا', updated_at: D(-2) + 'T10:00:00Z' }, { id: CH(2), member_id: OPS_ID, agent: 'designer', title: 'شات سارة', updated_at: D(-1) + 'T10:00:00Z' }],
    mktAgentMsgs: [{ chat_id: CH(1), role: 'user', text: 'فكرة بوست للشتا' }, { chat_id: CH(1), role: 'assistant', text: 'بوست بالماكرامية على خلفية بيج' }, { chat_id: CH(2), role: 'user', text: 'سر سارة' }],
  });
  await openAi(page, ADMIN, 'الديزاينر');
  const P = pg(page); const box = P.locator('[data-mk-agent="designer"]');
  await expect(box.locator('[data-mk-chats="1"]')).toBeVisible(); // ops's chat is not his
  await expect(box).not.toContainText('شات سارة');
  await box.locator('[data-mk-chat-item] .mk-agent-open', { hasText: 'بوست الشتا' }).click();
  await expect(box.locator('[data-mk-chat="2"]')).toContainText('بوست بالماكرامية على خلفية بيج');
  // a new chat: the first question names it and puts it on top
  await box.locator('[data-mk-chat-new]').click();
  await expect(box.locator('[data-mk-chat="0"]')).toBeVisible();
  await expect(box.locator('.mk-intro')).toContainText('أنا الديزاينر');
  await P.locator('#mk-ask').fill('ستوري لخصم الجمعة البيضا على الإضاءة');
  await P.locator('[data-mk-ask]').click();
  await expect(box.locator('[data-mk-chats="2"]')).toBeVisible();
  await expect(box.locator('[data-mk-chat-item]').first()).toContainText('ستوري لخصم الجمعة البيضا على الإضاءة');
  await expect(box.locator('[data-mk-chat-item].on')).toHaveCount(1);
  // rename (the title only) and delete (final)
  const first = box.locator('[data-mk-chat-item]').first();
  await first.getByRole('button', { name: 'خيارات الشات' }).click();
  await page.getByRole('menuitem', { name: 'تغيير الاسم' }).click();
  const f = page.locator('.modal[role=dialog]', { hasText: 'تغيير اسم الشات' }); await f.locator('input').fill('خصم الإضاءة'); await f.getByRole('button', { name: 'احفظ الاسم' }).click();
  await expect(first).toContainText('خصم الإضاءة');
  await expect.poll(() => mock.mkt.writes.filter((w) => w.table === 'mkt_agent_chats' && w.op === 'rename').length).toBe(1);
  await box.locator('[data-mk-chat-item]', { hasText: 'بوست الشتا' }).getByRole('button', { name: 'خيارات الشات' }).click();
  await page.getByRole('menuitem', { name: 'امسح الشات' }).click();
  await page.locator('.modal[role=dialog]', { hasText: 'تمسح الشات؟' }).getByRole('button', { name: 'امسح الشات' }).click();
  await expect(box.locator('[data-mk-chats="1"]')).toBeVisible();
  expect(mock.mkt.agentChats.find((c) => c.id === CH(1)).deleted_at).not.toBeNull();
  // ⚙️ the admin's settings: the intro, the instructions, the quick suggestions
  await box.locator('[data-mk-agent-cfg="designer"]').click();
  const cfg = page.locator('.modal[role=dialog]', { hasText: 'إعدادات الديزاينر' });
  await cfg.locator('textarea').nth(0).fill('أنا ديزاينر إبتكر — قولّي المنتج والمناسبة');
  await cfg.locator('textarea').nth(1).fill('الألوان بيج وأخضر');
  await cfg.locator('textarea').nth(2).fill('بوست عيد الأم\nريل لمنتج جديد');
  await cfg.getByRole('button', { name: 'احفظ الإعدادات' }).click();
  await expect(toast(page)).toContainText('اتحفظت إعدادات الديزاينر');
  expect(mock.mkt.agents.designer).toEqual({ intro: 'أنا ديزاينر إبتكر — قولّي المنتج والمناسبة', instructions: 'الألوان بيج وأخضر', suggestions: ['بوست عيد الأم', 'ريل لمنتج جديد'] });
  await box.locator('[data-mk-chat-new]').click();
  await expect(box.locator('.mk-intro')).toContainText('أنا ديزاينر إبتكر');
  await expect(box.locator('.mk-agent-chips .chip')).toHaveText(['بوست عيد الأم', 'ريل لمنتج جديد']);
  // expand / shrink with the same button
  await box.locator('[data-mk-agent-full]').click();
  await expect(P.locator('.mk-agent-full')).toBeVisible();
  await P.locator('[data-mk-agent-full="on"]').click();
  await expect(P.locator('.mk-agent-full')).toHaveCount(0);
  // ops (marketing F, not the admin): no ⚙️, their own chat only
  await signOut(page);
  await openAi(page, OPS, 'الديزاينر');
  await expect(pg(page).locator('[data-mk-agent-cfg]')).toHaveCount(0);
  await expect(pg(page).locator('[data-mk-chat-item]')).toHaveCount(1);
  await expect(pg(page).locator('[data-mk-chat-item]')).toContainText('شات سارة');
});

test('0084 decision 6: the designer\'s picture — its answer carries an image prompt, «ولّد الصورة» makes it on the image credits into the chat (the member\'s folder); the cap refuses in words', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN, 'الديزاينر');
  const P = pg(page); const box = P.locator('[data-mk-agent="designer"]');
  await P.locator('#mk-ask').fill('اعمل صورة لبوست ماكرامية');
  await P.locator('[data-mk-ask]').click();
  await expect(box.locator('[data-mk-gen]')).toBeVisible();
  await expect(box).toContainText('وصف الصورة: A cozy winter flat lay');
  await box.locator('[data-mk-gen]').click();
  await expect(toast(page)).toContainText('اتعملت الصورة');
  await expect(box.locator('.mk-agent-img img')).toHaveCount(1);
  await expect(box.locator('[data-mk-gen]')).toHaveCount(0);
  const img = mock.mkt.calls.filter((x) => x.fn === 'ai-images' && x.action === 'agent_image'); expect(img.length).toBe(1);
  const turn = mock.mkt.agentMsgs.find((m) => m.images.length); expect(turn.images[0]).toMatch(/^agents\/00000000-0000-4000-8000-000000000001\/c0000000-[0-9a-f-]+\/[0-9]+\.png$/);
  await expect.poll(() => mock.activityRows.filter((l) => l.action === 'mkt.agent.image').length).toBe(1);
  expect(JSON.stringify(mock.activityRows)).not.toContain('cozy');
  // the cap
  await P.locator('#mk-ask').fill('اعمل صورة تانية');
  await P.locator('[data-mk-ask]').click();
  mock.mkt.agentImgFail = 'ai_cap';
  await box.locator('[data-mk-gen]').click();
  await expect(toast(page)).toContainText('كريدت الصور');
  await expect(box.locator('[data-mk-gen]')).toBeVisible(); // still there to try again
});

test('0082 «تقديم طلب»: the requests are team requests — the list with who asked, a new request (ops) in the team-request popup to the kind\'s role, opened in «طلبات الفريق»; the overview\'s cards', async ({ page }) => {
  await start(page);
  await openAi(page, OPS, 'المبرمج');
  const P = pg(page);
  await expect(P.locator('[data-mk-reqs="dev"]')).toContainText('صفحة هبوط رمضان');
  await expect(P.locator('[data-mk-reqs="dev"] [data-mk-req]')).toHaveCount(1); // the plain team request is not the developer's
  await P.locator('[data-mk-req-add="dev"]').first().click();
  const f = page.locator('.modal[data-mk-req-form="dev"]');
  await expect(f).toContainText('تقديم طلب للمبرمج');
  await expect(f.locator('#mk-rq-role')).toContainText('مبرمج'); // the kind's role by default
  await f.locator('[data-mk-req-send]').click();
  await expect(f).toContainText('اكتب عنوان الطلب');
  await f.locator('#mk-rq-title').fill('تحسين سرعة صفحة المنتج');
  await f.locator('#mk-rq-desc').fill('الصور كبيرة');
  await f.locator('[data-mk-req-file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) });
  await expect(f.locator('[data-mk-req-chip]')).toHaveCount(1);
  await f.locator('[data-mk-req-send]').click();
  await expect(toast(page)).toContainText('لدور «مبرمج»');
  await expect.poll(() => mock.ticketWrites.filter((w) => w.fn === 'ticket_request_create').length).toBe(1);
  const w = mock.ticketWrites.find((x) => x.fn === 'ticket_request_create');
  expect([w.kind, w.project, w.type, w.title, w.assigneeRole, w.attachments.length]).toEqual(['dev', 'موقع', 'internal', 'تحسين سرعة صفحة المنتج', 'مبرمج', 1]);
  const made = mock.tickets.find((t) => t.title === 'تحسين سرعة صفحة المنتج');
  expect(made).toMatchObject({ kind: 'dev', project: 'موقع', status: 'open', created_by: OPS_ID, assignee_role: 'مبرمج' });
  await expect(P.locator('[data-mk-reqs="dev"] [data-mk-req]')).toHaveCount(2);
  await expect(P.locator('[data-mk-reqs="dev"]')).toContainText('طلبها');
  await expect.poll(() => mock.activityRows.filter((l) => l.action === 'mkt.request.add').map((l) => l.new_value)).toEqual(['dev']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('الصور كبيرة');
  expect(mock.mkt.writes.filter((x) => x.table === 'mkt_requests')).toEqual([]); // nothing writes the old table
  // the request opens «طلبات الفريق» on its ticket
  const tid = 'TKT-' + String(made.id).padStart(4, '0');
  await P.locator('[data-mk-req="' + tid + '"]').click();
  const d = page.locator('.modal[data-mk-req="' + tid + '"]');
  await expect(d).toContainText('طلبها');
  await d.locator('[data-mk-req-open]').click();
  await expect(page.locator('#tickets')).toBeVisible();
  await expect(page.locator('.drawer')).toContainText('تحسين سرعة صفحة المنتج');
  await page.keyboard.press('Escape');
  // the designer's tab and the buyer's: their own lists and «تقديم طلب»
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await pg(page).getByRole('tab', { name: /مساعدين الذكاء الاصطناعي/ }).click();
  await pg(page).getByRole('tab', { name: /الديزاينر/ }).click();
  await expect(pg(page).locator('[data-mk-reqs="designer"]')).toContainText('فيديو Macrame');
  await expect(pg(page).locator('[data-mk-reqs="designer"]')).toContainText('سارة أحمد');
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click();
  await expect(pg(page).locator('[data-mk-req-add="buyer"]').first()).toBeVisible();
  await signOut(page);
  await openAi(page, ADMIN, 'الديزاينر');
  // the overview's assistant cards
  await pg(page).getByRole('tab', { name: /نظرة عامة/ }).click();
  const cards = pg(page).locator('[data-ads-assistants="live"]');
  await expect(cards).toContainText('4 اقتراح مستني موافقتك');
  await expect(cards).toContainText('1 وقّف · 1 زوّد · 1 نسخة جديدة · 1 راجع التتبع');
  await expect(cards).toContainText('تحسين سرعة صفحة المنتج');
  await cards.getByRole('button', { name: 'افتح الميديا باير' }).click();
  await expect(pg(page).locator('[data-mk-chat]')).toBeVisible();
});
