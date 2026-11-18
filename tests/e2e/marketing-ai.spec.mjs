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
  await page.locator('.sidebar .nav-item[data-page="ai"]').click(); // 0120: «الذكاء الاصطناعي» is its own page
  await expect(page.locator('#pg-ai')).toBeVisible();
  if (sub) {
    await pg(page).getByRole('tab', { name: new RegExp(sub) }).click();
    // the tab goes through the hash: type only once the box is that assistant's (a slow machine redraws after the click)
    await expect(pg(page).locator('#mk-ask')).toHaveAttribute('placeholder', new RegExp(sub.replace(/^ال/, ''))); // «للمخزن الذكي» / «اسأل الميديا باير»
  }
}
const pg = (page) => page.locator('main.content.mod:not([hidden])'); // 0120: «التسويق» or «الذكاء الاصطناعي», whichever is open
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
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
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
  // accounts (marketing N): no «التسويق» in the menu (owner batch 14 Nov decision 15), and its link lands on the dashboard
  await signOut(page);
  await signIn(page, ACC);
  await expect(page.locator('.sidebar .nav-item[data-page="marketing"]')).toBeHidden();
  await page.evaluate(() => { location.hash = 'marketing-overview'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
  // 0120: «الذكاء الاصطناعي» opens for them — their own assistants only (by each one's page), never the three of marketing
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
  await expect(page.locator('#pg-ai [role=tab]', { hasText: 'المحاسب الذكي' })).toBeVisible();
  await expect(page.locator('#pg-ai [role=tab]', { hasText: 'الميديا باير' })).toHaveCount(0);
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
  expect((({ intro, instructions, suggestions }) => ({ intro, instructions, suggestions }))(mock.mkt.aiAgents.find((a) => a.id === 'designer'))).toEqual({ intro: 'أنا ديزاينر إبتكر — قولّي المنتج والمناسبة', instructions: 'الألوان بيج وأخضر', suggestions: ['بوست عيد الأم', 'ريل لمنتج جديد'] });
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
  // CI 14 Nov (three times): the text went into the previous agent's box while the «الديزاينر» tab was still drawing (its draft is
  // per agent), so «ابعت» sent nothing — wait for the designer's own input first
  await expect(box).toBeVisible(); await expect(P.locator('#mk-ask')).toHaveAttribute('placeholder', /للديزاينر الذكي/);
  // CI 989 (14 Nov): fill = focus, then the text in a second step — the designer's chats landing in between re-drew the box and the
  // focus came back a frame later, so the text went nowhere; a render between the focus and the typing keeps the box focused now
  await page.evaluate(() => { document.getElementById('mk-ask').focus(); window.IBPages.render('marketing'); });
  await page.keyboard.insertText('س');
  await expect(P.locator('#mk-ask')).toHaveValue('س');
  await P.locator('#mk-ask').fill('اعمل صورة لبوست ماكرامية');
  await expect(P.locator('#mk-ask')).toHaveValue('اعمل صورة لبوست ماكرامية');
  await P.locator('[data-mk-ask]').click();
  // failed twice on CI (14 Nov, 08:18 and 08:29 UTC) and never here — name what the page shows when the button is missing
  await expect(box.locator('[data-mk-gen]')).toBeVisible().catch(async (e) => {
    const seen = await page.evaluate(() => ({ box: (document.querySelector('[data-mk-agent="designer"] .mk-chat') || {}).innerText, scrims: document.querySelectorAll('.scrim').length, modals: Array.from(document.querySelectorAll('.modal[role=dialog]')).map((x) => x.innerText.slice(0, 80)),
      ask: (document.getElementById('mk-ask') || {}).value, page: window.IBPages && window.IBPages.current }));
    const calls = mock.mkt.calls.filter((x) => x.fn === 'ai-content').map((x) => x.action + ':' + (x.agent || '') + ':' + (x.chat || ''));
    throw new Error(e.message + '\nSEEN ' + JSON.stringify(seen) + '\nCALLS ' + JSON.stringify(calls) + '\nERRORS ' + JSON.stringify(pageErrors));
  });
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
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
  await pg(page).getByRole('tab', { name: /الديزاينر/ }).click();
  await expect(pg(page).locator('[data-mk-reqs="designer"]')).toContainText('فيديو Macrame');
  await expect(pg(page).locator('[data-mk-reqs="designer"]')).toContainText('سارة أحمد');
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click();
  await expect(pg(page).locator('[data-mk-req-add="buyer"]').first()).toBeVisible();
  await signOut(page);
  await openAi(page, ADMIN, 'الديزاينر');
  // the marketing overview's assistant cards (they open «الذكاء الاصطناعي» on the assistant)
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await pg(page).getByRole('tab', { name: /نظرة عامة/ }).click();
  const cards = pg(page).locator('[data-ads-assistants="live"]');
  await expect(cards).toContainText('4 اقتراح مستني موافقتك');
  await expect(cards).toContainText('1 وقّف · 1 زوّد · 1 نسخة جديدة · 1 راجع التتبع');
  await expect(cards).toContainText('تحسين سرعة صفحة المنتج');
  await cards.getByRole('button', { name: 'افتح الميديا باير' }).click();
  await expect(pg(page).locator('[data-mk-chat]')).toBeVisible();
});

test('owner batch 14 Nov decision 14: the chat stays on its last message (opening a long chat, after a send), and a job for a person comes back as «قدّم الطلب ده» — «تقديم طلب» opens filled with it', async ({ page }) => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const CH1 = 'c1400000-0000-4000-8000-000000000001';
  const msgs = []; for (let i = 1; i <= 24; i += 1) msgs.push({ chat_id: CH1, role: i % 2 ? 'user' : 'assistant', text: 'رسالة رقم ' + i + ' — ' + 'كلام طويل شوية عشان الشات يطول. '.repeat(3) });
  await start(page, { mktAgentChats: [{ id: CH1, member_id: ADMIN_ID, agent: 'dev', title: 'شات طويل', updated_at: D(-1) + 'T10:00:00Z' }], mktAgentMsgs: msgs });
  await openAi(page, ADMIN, 'المبرمج');
  const P = pg(page); const box = P.locator('[data-mk-agent="dev"]'); const chat = box.locator('.mk-chat');
  await expect(box).toBeVisible(); await expect(P.locator('#mk-ask')).toHaveAttribute('placeholder', /للمبرمج الذكي/);
  const atEnd = () => chat.evaluate((el) => el.scrollHeight > el.clientHeight + 50 && el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  await box.locator('[data-mk-chat-item] .mk-agent-open', { hasText: 'شات طويل' }).click();
  await expect(chat).toContainText('رسالة رقم 24');
  await expect.poll(atEnd).toBe(true);
  // a redraw that brings nothing new keeps where the member scrolled
  await chat.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await box.locator('[data-mk-agent-full]').click(); await P.locator('[data-mk-agent-full="on"]').click();
  await expect.poll(() => chat.evaluate((el) => el.scrollTop)).toBe(0);
  // a send goes back to the bottom, and the answer with a request offers it
  await P.locator('#mk-ask').fill('عايز صفحة هبوط لعروض الشتا'); await expect(P.locator('#mk-ask')).toHaveValue('عايز صفحة هبوط لعروض الشتا');
  await P.locator('[data-mk-ask]').click();
  const btn = box.locator('[data-mk-req-from]');
  await expect(btn).toBeVisible();
  await expect.poll(atEnd).toBe(true);
  await expect(box.locator('.mk-msg-req')).toContainText('طلب جاهز: صفحة هبوط لعروض الشتا');
  await btn.click();
  const f = page.locator('.modal[data-mk-req-form="dev"]');
  await expect(f).toBeVisible();
  await expect(f.locator('#mk-rq-title')).toHaveValue('صفحة هبوط لعروض الشتا');
  await expect(f.locator('#mk-rq-desc')).toHaveValue(/بانر العروض و12 منتج/);
  // a plain answer offers nothing
  await f.getByRole('button', { name: 'إلغاء' }).click(); await expect(f).toBeHidden();
  await P.locator('#mk-ask').fill('سؤال عادي'); await P.locator('[data-mk-ask]').click();
  await expect(box.locator('[data-mk-turn]').last()).toContainText('سؤالك: سؤال عادي');
  await expect(box.locator('[data-mk-req-from]')).toHaveCount(1);
});

// comments decision 69 (the owner 15 Nov — «حطلي قسم … اخر التريندات و يجمعلي اخر التريندات من مواقع بتنزل التريندات تبقي في جدول منظم و
// يبقي في عمود للموقع ال source و خانة للنوع ده صورة ولا فيديو»): the designer's section «آخر التريندات» — the server's rows
// (ai-content `trends`: Claude's web search), a table with the trend, its kind, the source's site as a link and the day;
// «حدّث التريندات» asks what the team cares about first; the buyer's and the developer's tabs do not have it
test('comment 69 / ش39 — «آخر التريندات» in the designer\'s tab: a grid like Instagram\'s (فيديوهات / بوستات), each tile the post\'s picture opening the post; «حدّث التريندات» asks first, brings a batch and its pictures; a failed search in words; the other assistants have no such section', async ({ page }) => {
  const NOW = new Date().toISOString();
  await start(page, { mktTrends: [{ title: 'كاروسيل «قبل وبعد»', summary: 'صورتين للمنتج قبل وبعد.', source: 'Later', url: 'https://later.com/blog/instagram-trends/', kind: 'image', found_at: NOW }] });
  await openAi(page, ADMIN, 'الديزاينر');
  const card = pg(page).locator('.mk-trends');
  await expect(card.locator('h2, .sec-h b').first()).toContainText('آخر التريندات');
  await expect(card.locator('table')).toHaveCount(0); // ش39: no table any more
  // the tabs: videos first (none yet), the post under «بوستات»
  const tabs = card.locator('[data-mk-trend-tabs]');
  await expect(tabs.getByRole('tab')).toHaveText([/فيديوهات\s*0/, /بوستات\s*1/]);
  await tabs.getByRole('tab', { name: /بوستات/ }).click();
  const tile = card.locator('[data-mk-reels] a.mk-tile').first();
  await expect(tile).toContainText('كاروسيل «قبل وبعد»');
  await expect(tile).toHaveAttribute('data-mk-trend-kind', 'image');
  expect(await tile.evaluate((a) => [a.getAttribute('href'), a.target, a.rel])).toEqual(['https://later.com/blog/instagram-trends/', '_blank', 'noopener noreferrer']);
  // a refresh: the instructions popup first, the focus sent, the new batch with its kinds, then the pictures (ai-images trend_thumbs)
  await card.locator('[data-mk-trends-go]').click();
  await page.fill('#ai-ask-notes', 'هدايا الشتا');
  await page.locator('[data-ai-go]').click();
  await expect(page.locator('body')).toContainText('اتحدّثت التريندات — 6 جديد');
  const call = mock.mkt.calls.filter((c) => c.action === 'trends').pop();
  expect([call.fn, call.focus]).toEqual(['ai-content', 'هدايا الشتا']);
  expect(mock.mkt.calls.some((c) => c.action === 'trend_thumbs')).toBe(true);
  expect(mock.mkt.calls.some((c) => c.action === 'trends_ig')).toBe(false); // no tags yet → no hashtag search
  await expect(tabs.getByRole('tab')).toHaveText([/فيديوهات\s*3/, /بوستات\s*4/]);
  await tabs.getByRole('tab', { name: /فيديوهات/ }).click();
  await expect(card.locator('[data-mk-reels="video"] a.mk-tile')).toHaveCount(3);
  await expect(card.locator('[data-mk-reels="video"] a.mk-tile img').first()).toHaveAttribute('src', /\/object\/sign\/marketing\/trends\//);
  await expect.poll(() => mock.activityRows.filter((a) => a.action === 'mkt.trends.refresh').map((a) => a.new_value)).toEqual(['6']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('هدايا الشتا'); // the focus is not logged
  // the search answered nothing: its reason in words, the grid as it was
  mock.mkt.trendsFail = 'no_search';
  await card.locator('[data-mk-trends-go]').click(); await page.locator('[data-ai-go]').click();
  await expect(page.locator('body')).toContainText('Claude ماعرفش يبحث على الويب دلوقتي');
  await expect(card.locator('[data-mk-reels] a.mk-tile')).toHaveCount(3);
  // the other assistants' tabs do not have the section
  await pg(page).getByRole('tab', { name: /المبرمج/ }).click();
  await expect(pg(page).locator('.mk-trends')).toHaveCount(0);
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click();
  await expect(pg(page).locator('.mk-trends')).toHaveCount(0);
});

// ش39 (the owner 17 Nov — «عايز اجيب الفيديوهات التيرندس و يبقا ليها علاقة بالمجال بتاعي و اقدر اضيف تاجز … من تريندات التيكتوك و الانستجرام
// و الفيسبوك»): with the admin's tags the refresh brings the posts themselves (TikTok / Facebook from the search, Instagram from its hashtag
// search), a chip per tag narrows the grid; Instagram's search not granted yet is said in words
test('ش39 — by the tags: TikTok, Facebook and Instagram posts, the tags in «فلتر», Instagram waiting for Meta said in words', async ({ page }) => {
  await start(page, { mktTrendTags: ['macrame', 'ديكور_منزلي'] });
  await openAi(page, ADMIN, 'الديزاينر');
  const card = pg(page).locator('.mk-trends');
  await card.locator('[data-mk-trends-go]').click(); await page.locator('[data-ai-go]').click();
  await expect(page.locator('body')).toContainText('اتحدّثت التريندات');
  expect(mock.mkt.calls.filter((c) => c.action === 'trends_ig').length).toBe(1);
  await expect(card.locator('[data-mk-reels="video"] a.mk-tile')).toHaveCount(5); // TikTok, Facebook, a web roundup's reel, two Instagram reels
  const pfs = (await card.locator('[data-mk-reels="video"] .mk-tile-pf').allTextContents()).map((t) => t.trim());
  for (const p2 of ['TikTok', 'Facebook', 'Instagram']) expect(pfs).toContain(p2);
  // the tags (and the platform) in the kit's «فلتر» next to the tabs (the owner 17 Nov)
  await card.locator('[data-fm-btn="mk-trends"]').click();
  await expect(page.locator('[data-fm-tab]')).toHaveText(['التاج', 'المنصة']);
  await expect(page.locator('[data-fm^="tag:"]')).toHaveText(['#macrame', '#ديكور_منزلي']);
  await page.locator('[data-fm="tag:ديكور_منزلي"]').click();
  await page.getByRole('button', { name: /^اعرض/ }).click();
  await expect(card.locator('[data-mk-reels] a.mk-tile')).not.toHaveCount(0);
  for (const t of await card.locator('[data-mk-reels] .mk-tile-tag').allTextContents()) expect(t).toBe('#ديكور_منزلي');
  // the posts are kept once: a second refresh adds none of them again
  const before = mock.mkt.trends.length;
  mock.mkt.igOff = 'permission';
  await card.locator('[data-mk-trends-go]').click(); await page.locator('[data-ai-go]').click();
  await expect(page.locator('body')).toContainText('إنستجرام الرسمي مستني موافقة ميتا');
  expect(mock.mkt.trends.length).toBe(before + 2); // the two web articles only — the posts already there are skipped
});

test('comment 69 — before the migration the section says it waits (no button, no call)', async ({ page }) => {
  await start(page, { mktNoSections: true });
  await openAi(page, ADMIN, 'الديزاينر');
  const card = pg(page).locator('.mk-trends');
  await expect(card).toContainText('القسم ده مستني تحديث قاعدة البيانات');
  await expect(card.locator('[data-mk-trends-go]')).toHaveCount(0);
  expect(mock.mkt.calls.filter((c) => c.action === 'trends')).toEqual([]);
});

// comments decision 70 (the owner 15 Nov — «اعملي قسم تاني يبقي فيه اعلانات اللي المنافسين في الميديا باير و يجيبها من [مكتبة إعلانات
// ميتا]»): the media buyer's section «إعلانات المنافسين» — the competitors the team keeps, each opened in Meta's Ad Library on its
// running ads in Egypt (the page's own list by its number, else a search by the word or the name), and a search of the library
// by any word; nothing is pulled from Meta. Added / edited / removed with marketing.create
test('comment 70 — «إعلانات المنافسين» in the media buyer\'s tab: a competitor added (the page\'s number read from its link), its ads open in the Ad Library on that page; one without a number opens a search; the library search by a word; edit and remove', async ({ page }) => {
  await start(page, { mktCompetitors: [{ name: 'Boho Corner', keyword: 'بوهو ديكور' }] });
  await openAi(page, ADMIN);
  const card = pg(page).locator('.mk-comp');
  await expect(card).toContainText('إعلانات المنافسين');
  await expect(card.locator('table')).toHaveCount(0); // ش44: cards like the Ad Library, no table
  const params = async (loc) => Object.fromEntries(new URL(await loc.getAttribute('href')).searchParams);
  // the seeded one has no page number: a search by its word
  const boho = card.locator('[data-mk-comp]', { hasText: 'Boho Corner' });
  await expect(boho).toContainText('بحث بـ «بوهو ديكور»');
  expect(await params(boho.locator('[data-mk-comp-ads]'))).toEqual({ active_status: 'active', ad_type: 'all', country: 'EG', media_type: 'all', q: 'بوهو ديكور', search_type: 'keyword_unordered' });
  expect(await boho.locator('[data-mk-comp-ads]').evaluate((a) => [a.origin + a.pathname, a.target, a.rel])).toEqual(['https://www.facebook.com/ads/library/', '_blank', 'noopener noreferrer']);
  // a new one: the name is required, the page must be a Facebook / Instagram link or a number
  await card.locator('[data-mk-comp-add]').click();
  const m = modal(page, 'منافس جديد');
  await m.getByRole('button', { name: 'ضيف المنافس' }).click();
  await expect(m).toContainText('اكتب اسم المنافس');
  await m.locator('#name').fill('Macrame House');
  await m.locator('#page').fill('https://example.com/macrame');
  await m.getByRole('button', { name: 'ضيف المنافس' }).click();
  await expect(m).toContainText('لينك صفحة فيسبوك أو إنستجرام، أو رقم الصفحة');
  await m.locator('#page').fill('facebook.com/profile.php?id=100064812345678');
  await m.locator('#note').fill('مكرمية وديكور حيطان');
  await m.getByRole('button', { name: 'ضيف المنافس' }).click();
  await expect(m).toHaveCount(0);
  const w = mock.mkt.writes.filter((x) => x.table === 'mkt_competitors').pop();
  expect([w.op, w.name, w.page_id, w.page_url, w.keyword, w.note]).toEqual(['insert', 'Macrame House', '100064812345678', 'https://facebook.com/profile.php?id=100064812345678', null, 'مكرمية وديكور حيطان']);
  const mac = card.locator('[data-mk-comp]', { hasText: 'Macrame House' });
  await expect(mac).toContainText('إعلانات الصفحة نفسها');
  expect(await params(mac.locator('[data-mk-comp-ads]'))).toEqual({ active_status: 'active', ad_type: 'all', country: 'EG', media_type: 'all', view_all_page_id: '100064812345678' });
  // ش44: the card shows the page's picture (by its number) and «افتح كل إعلاناته على ميتا»
  await expect(mac.locator('.mk-cc-av img')).toHaveAttribute('src', 'https://graph.facebook.com/100064812345678/picture?type=large');
  await expect(mac.locator('[data-mk-comp-ads]')).toContainText('افتح كل إعلاناته على ميتا');
  // ش44 — the filter bar: one competitor, the ads' kind (the library's own media filter), the search narrows the cards
  await card.locator('#mk-cf-type').click(); await page.getByRole('option', { name: 'فيديو' }).click();
  expect((await params(card.locator('[data-mk-comp]', { hasText: 'Macrame House' }).locator('[data-mk-comp-ads]'))).media_type).toBe('video');
  await card.locator('#mk-cf-who').click(); await page.getByRole('option', { name: 'Boho Corner' }).click();
  await expect(card.locator('[data-mk-comp]')).toHaveCount(1);
  await card.locator('#mk-cf-who').click(); await page.getByRole('option', { name: 'المنافس: الكل' }).click();
  await card.locator('#mk-cf-type').click(); await page.getByRole('option', { name: 'النوع: الكل' }).click();
  await expect(card.locator('[data-mk-comp]')).toHaveCount(2);
  // the library's own search: off until a word is typed
  const go = card.locator('[data-mk-lib-go]');
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await card.locator('#mk-lib-q').fill('مكرمية');
  await expect(card.locator('[data-mk-lib-go]')).toHaveAttribute('aria-disabled', 'false');
  expect((await params(card.locator('[data-mk-lib-go]'))).q).toBe('مكرمية');
  await expect(card.locator('[data-mk-comp]')).toHaveCount(1); // the search narrows the cards too (the note «مكرمية وديكور حيطان»)
  await card.locator('#mk-lib-q').fill('');
  await expect(card.locator('[data-mk-comp]')).toHaveCount(2);
  // edit: a word for the one without a number; remove: it leaves the list (archived, not deleted)
  await boho.getByRole('button', { name: 'خيارات Boho Corner' }).click();
  await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const e = modal(page, 'تعديل «Boho Corner»');
  await e.locator('#keyword').fill('ديكور بوهيمي');
  await e.getByRole('button', { name: 'احفظ' }).click();
  await expect(card.locator('[data-mk-comp]', { hasText: 'Boho Corner' })).toContainText('بحث بـ «ديكور بوهيمي»');
  await card.locator('[data-mk-comp]', { hasText: 'Boho Corner' }).getByRole('button', { name: 'خيارات Boho Corner' }).click();
  await page.getByRole('menuitem', { name: 'شيله من القايمة' }).click();
  await page.locator('.modal[role=dialog]').getByRole('button', { name: 'شيله' }).click();
  await expect(card.locator('[data-mk-comp]')).toHaveCount(1);
  expect(mock.mkt.competitors.find((c) => c.name === 'Boho Corner').archived_at).not.toBeNull();
  // the log: the row's id only
  const logs = mock.activityRows.filter((a) => String(a.action).startsWith('mkt.competitor.'));
  expect(logs.map((a) => a.action)).toEqual(['mkt.competitor.add', 'mkt.competitor.edit', 'mkt.competitor.remove']);
  expect(JSON.stringify(logs)).not.toContain('Macrame');
  // the designer's tab does not have the section
  await pg(page).getByRole('tab', { name: /الديزاينر/ }).click();
  await expect(pg(page).locator('.mk-comp')).toHaveCount(0);
});

// ش44 — «أقوى الإعلانات بالتاجز»: the media buyer's ad tags (set in the settings) as chips opening the library on each word; the tag filter keeps one
test('ش44 — the ad tags open the library on each word; the tag filter keeps one; the admin sets them in the settings', async ({ page }) => {
  await start(page, { mktAdTags: ['مكرمية', 'ديكور منزلي'] });
  await openAi(page, ADMIN);
  const card = pg(page).locator('.mk-comp');
  const chips = card.locator('[data-mk-strong-tag]');
  await expect(chips).toHaveText(['مكرمية', 'ديكور منزلي']);
  expect(Object.fromEntries(new URL(await chips.nth(1).getAttribute('href')).searchParams).q).toBe('ديكور منزلي');
  await card.locator('#mk-cf-tag').click(); await page.getByRole('option', { name: 'مكرمية', exact: true }).click();
  await expect(chips).toHaveText(['مكرمية']);
});

// comments decision 71 (the owner 15 Nov — «زودلي قسم المبرمج يجيبله ابديتس للوردر بريس و الاشتراكات بتاعت ورد بريس و الكريديتس»): the
// developer's tab gets three cards — the site's updates (woo-sync wp_updates: names and versions, kept as one row), the
// subscriptions of the accounts page with what is left of each (for whoever sees the accounts), and the month's AI credits
const DAY = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // the page counts days in Cairo (UTC broke around Cairo's midnight)
const SUBS = [
  { id: 1, on_date: '2026-01-10', direction: 'withdraw', category: 'الاشتراكات', amount: 1800, sub_name: 'Canva', sub_ends: DAY(90), sub_alerts: ['week'], voided_at: null },
  { id: 2, on_date: '2026-01-10', direction: 'withdraw', category: 'الاشتراكات', amount: 4200, sub_name: 'استضافة الموقع (Hostinger)', sub_ends: DAY(12), sub_alerts: ['month'], voided_at: null },
  { id: 3, on_date: '2025-01-10', direction: 'withdraw', category: 'الاشتراكات', amount: 3900, sub_name: 'استضافة الموقع (Hostinger)', sub_ends: DAY(-300), sub_alerts: ['month'], voided_at: null },
  { id: 4, on_date: '2026-03-01', direction: 'withdraw', category: 'المصروفات', amount: 500, sub_name: null, sub_ends: null, voided_at: null }];
test('comment 71 — the developer\'s tab: «افحص دلوقتي» lists WordPress, the theme and the plugins with what waits an update (kept for the next visit); the site\'s subscriptions first with the days left; the month\'s credits; a refusal in words', async ({ page }) => {
  await start(page);
  mock.acc.acc_expenses.push(...SUBS);
  await openAi(page, ADMIN, 'المبرمج');
  const up = pg(page).locator('.mk-dv');
  await expect(up).toContainText('تحديثات ووردبريس');
  await expect(up).toContainText('لسه مفيش فحص');
  // the check: one call, the versions as chips, a row per part, what waits first
  await up.locator('[data-dv-check]').click();
  await expect(up.locator('[data-dv-updates]')).toHaveAttribute('data-dv-updates', '4');
  expect(mock.wpChecks).toEqual([{ by: ADMIN }]);
  await expect(up.locator('.mk-dv-sum')).toContainText('6.7.2');
  await expect(up.locator('thead th')).toHaveText(['الاسم', 'النوع', 'النسخة على الموقع', 'آخر نسخة', 'الحالة']);
  const rows = await up.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('[data-dv-item]').textContent, tr.children[1].textContent, tr.children[2].textContent, tr.children[3].textContent, tr.querySelector('[data-dv-st]').getAttribute('data-dv-st')]));
  expect(rows.slice(0, 4)).toEqual([['WordPress', 'ووردبريس', '6.7.2', '6.8.3', 'update'], ['Woodmart', 'الثيم', '8.0.4', '8.1.0', 'update'], ['Dokan Pro', 'إضافة', '4.0.2', '4.0.5', 'update'], ['WPML Multilingual CMS', 'إضافة', '4.7.1', '4.7.3', 'update']]);
  expect(rows.slice(-2)).toEqual([['WP All Import Pro', 'إضافة', '4.9.9', '—', 'ok'], ['Hello Dolly', 'إضافة', '1.7.2', '—', 'off']]);
  await expect(page.locator('body')).toContainText('4 تحديث مستني');
  await expect.poll(() => mock.activityRows.filter((a) => a.action === 'mkt.site.check').map((a) => a.new_value)).toEqual(['4']);
  expect(mock.mkt.siteChecks.map((r) => [r.kind, r.data.updates])).toEqual([['wp_updates', 4]]);
  // the subscriptions: the latest payment of each name, the site's own first, the days left; the ordinary expense is not one
  const subs = pg(page).locator('.mk-dv-subs');
  await expect(subs.locator('[data-dv-sub]')).toHaveCount(2);
  expect(await subs.locator('[data-dv-sub]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dv-sub')))).toEqual(['استضافة الموقع (Hostinger)', 'Canva']);
  await expect(subs.locator('[data-dv-sub]').first()).toContainText('باقي 12 يوم');
  await expect(subs.locator('[data-dv-sub]').first()).toContainText('4,200');
  await expect(subs).toContainText('1 محتاج تجديد');
  // the credits: the image credits against the cap, the AI spend for the admin
  const cr = pg(page).locator('.mk-dv-credits');
  await expect(cr.locator('[data-dv-credit="images"]')).toContainText('5,000');
  await expect(cr.locator('[data-dv-credit="ai"]')).toContainText('$');
  // the site refuses the report: the reason in words, the last list stays
  mock.wpFail = 'woocommerce_rest_cannot_view';
  await up.locator('[data-dv-check]').click();
  await expect(page.locator('body')).toContainText('مفتاح ووكومرس مالوش صلاحية يقرا تقرير حالة الموقع');
  await expect(up.locator('tbody tr')).toHaveCount(8);
  // the next visit reads the kept row
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
  await pg(page).getByRole('tab', { name: /المبرمج/ }).click();
  await expect(pg(page).locator('.mk-dv tbody tr')).toHaveCount(8);
  // the designer's tab has none of the three
  await pg(page).getByRole('tab', { name: /الديزاينر/ }).click();
  await expect(pg(page).locator('.mk-dv, .mk-dv-subs, .mk-dv-credits')).toHaveCount(0);
});

// ش45 decision 1 — «أداء الموقع»: Google PageSpeed per page and device (woo-sync site_speed, kept as one row), the biggest fixes, the
// real users' numbers; a refusal in words
test('ش45 — the developer\'s «أداء الموقع»: «افحص دلوقتي» shows each page on mobile and desktop with its score and numbers, the fixes, kept for the next visit; Google\'s limit in words', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN, 'المبرمج');
  const sp = pg(page).locator('.mk-sp');
  await expect(sp).toContainText('أداء الموقع');
  await expect(sp).toContainText('لسه مفيش فحص');
  await sp.locator('[data-sp-check]').click();
  await expect(sp.locator('[data-sp-page]')).toHaveCount(6);
  expect(mock.speedChecks).toEqual([{ by: ADMIN }]);
  await expect(sp.locator('thead th')).toHaveText(['الصفحة', 'الجهاز', 'الدرجة', 'أكبر عنصر (LCP)', 'وقت التعليق (TBT)', 'الاهتزاز (CLS)', 'حجم الصفحة']);
  expect(await sp.locator('[data-sp-score]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sp-score')))).toEqual(['41', '78', '55', '86', '47', '91']);
  await expect(sp.locator('[data-sp-page="home:mobile"]').locator('xpath=ancestor::tr')).toContainText('6.2 ث');
  await expect(sp.locator('[data-sp-fixes]')).toHaveAttribute('data-sp-fixes', '3');
  await expect(sp.locator('[data-sp-fixes]')).toContainText('Eliminate render-blocking resources');
  await expect(sp.locator('[data-sp-real]')).toContainText('INP 290');
  await expect(page.locator('body')).toContainText('أقل درجة على الموبايل 41/100');
  await expect.poll(() => mock.activityRows.filter((a) => a.action === 'mkt.site.speed').map((a) => a.new_value)).toEqual(['41']);
  expect(mock.mkt.siteChecks.map((r) => r.kind)).toEqual(['pagespeed']);
  // Google's limit: in words, the last numbers stay
  mock.speedFail = 'http_429';
  await sp.locator('[data-sp-check]').click();
  await expect(page.locator('body')).toContainText('جوجل وقف الفحص شوية');
  await expect(sp.locator('[data-sp-page]')).toHaveCount(6);
  // the next visit reads the kept row
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
  await pg(page).getByRole('tab', { name: /المبرمج/ }).click();
  await expect(pg(page).locator('.mk-sp [data-sp-page]')).toHaveCount(6);
});

test('comment 71 — a member who does not see the accounts gets no subscriptions (a note instead) and no dollar spend', async ({ page }) => {
  await start(page);
  mock.acc.acc_expenses.push(...SUBS);
  mock.profiles.find((p) => p.id === OPS_ID).role_id = 'developer'; // 0081: the viewer's permissions + marketing — no accounts
  await openAi(page, OPS, 'المبرمج');
  await expect(pg(page).locator('.mk-dv-subs')).toContainText('محتاجة صلاحية الحسابات');
  await expect(pg(page).locator('.mk-dv-subs [data-dv-sub]')).toHaveCount(0);
  await expect(pg(page).locator('.mk-dv-credits [data-dv-credit="images"]')).toBeVisible();
  await expect(pg(page).locator('.mk-dv-credits [data-dv-credit="ai"]')).toHaveCount(0);
});

// comments decisions 72 and 73 (the owner 15 Nov — «ظبط صفحة مساعدين الذكاء الاصطناعي — الui بتاع الشاتات بالذات و كل حاجة بشكل احترافي
// و منظم» · «غير الايقون دي لايقونة التكبير و لما اجي اصغر تبقي ايقونة التصغير»): the chat's frame — the history by day, a welcome with the
// suggestions as cards on a new chat, the turns as rows (the assistant's mark, who and when under the bubble), a box that takes
// lines, and the expand / shrink marks on the one button
test('comments 72 and 73 — the assistants\' chat: the history by day, a welcome on a new chat, rows with the assistant\'s mark and the name under the bubble, Shift + Enter = a new line and Enter sends, «كبّر» with the expand mark and «صغّر» with the shrink one', async ({ page }) => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const CH = (n) => 'c7200000-0000-4000-8000-00000000000' + n;
  await start(page, { mktAgentChats: [{ id: CH(1), member_id: ADMIN_ID, agent: 'designer', title: 'شات النهارده', updated_at: new Date().toISOString() },
    { id: CH(2), member_id: ADMIN_ID, agent: 'designer', title: 'شات الأسبوع', updated_at: D(-3) + 'T10:00:00Z' }, { id: CH(3), member_id: ADMIN_ID, agent: 'designer', title: 'شات قديم', updated_at: D(-20) + 'T10:00:00Z' }] });
  await openAi(page, ADMIN, 'الديزاينر');
  const P = pg(page); const box = P.locator('[data-mk-agent="designer"]');
  // the history: its count, the days as labels, the newest first
  await expect(box.locator('[data-mk-chats="3"]')).toBeVisible();
  await expect(box.locator('.mk-agent-n')).toHaveText('3');
  await expect(box.locator('.mk-agent-day')).toHaveText(['النهارده', 'آخر 7 أيام', 'أقدم']);
  await expect(box.locator('[data-mk-chat-item] b')).toHaveText(['شات النهارده', 'شات الأسبوع', 'شات قديم']);
  // a new chat: the welcome — the assistant's mark, its name, the intro and the four suggestions as cards inside it
  const hello = box.locator('.mk-chat.fresh .mk-welcome');
  await expect(hello.locator('.mk-av.xl svg')).toBeVisible();
  await expect(hello.locator('.mk-welcome-t')).toHaveText('الديزاينر الذكي');
  await expect(hello.locator('.mk-intro')).toContainText('أنا الديزاينر');
  await expect(hello.locator('.mk-agent-chips .chip')).toHaveCount(4);
  await expect(box.locator('.mk-agent-head .mk-av.lg')).toBeVisible();
  // the box takes lines: Shift + Enter adds one and sends nothing, Enter sends the lot
  await expect(P.locator('#mk-ask')).toHaveAttribute('placeholder', /للديزاينر الذكي/);
  expect(await P.locator('#mk-ask').evaluate((el) => el.tagName)).toBe('TEXTAREA');
  await P.locator('#mk-ask').fill('بوست لمخدات الشتا');
  await P.locator('#mk-ask').press('Shift+Enter');
  await page.keyboard.insertText('وبالألوان البيج');
  await expect(P.locator('#mk-ask')).toHaveValue('بوست لمخدات الشتا\nوبالألوان البيج');
  expect(mock.mkt.calls.filter((x) => x.action === 'agent').length).toBe(0);
  await P.locator('#mk-ask').press('Enter');
  await expect(box.locator('[data-mk-chat="2"]')).toBeVisible();
  await expect(P.locator('#mk-ask')).toHaveValue('');
  // the turns: my words at one side with my name under them, the assistant's with its mark beside the bubble and its name under it
  await expect(box.locator('.mk-welcome')).toHaveCount(0);
  await expect(box.locator('.mk-row.user .mk-msg.user')).toContainText('بوست لمخدات الشتا\nوبالألوان البيج');
  await expect(box.locator('.mk-row.user .mk-av')).toHaveCount(0);
  await expect(box.locator('.mk-row.user .mk-meta')).toContainText('صفوت كمال');
  await expect(box.locator('.mk-row.ai .mk-av')).toHaveCount(1);
  await expect(box.locator('.mk-row.ai .mk-meta')).toContainText('الديزاينر');
  await expect(box.locator('.mk-msg .mk-meta')).toHaveCount(0); // who and when are under the bubble, not in it
  const sides = await box.evaluate((el) => { const r = (q) => el.querySelector(q).getBoundingClientRect(); const c = r('.mk-chat'); return { mine: c.right - r('.mk-row.user').right, its: r('.mk-row.ai').left - c.left }; });
  expect(sides.mine).toBeLessThan(40); expect(sides.its).toBeLessThan(40); // the owner 16 Nov: my words on the right, the assistant on the left
  expect(await box.locator('.mk-msg.user').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 86, 66)');
  // the suggestions are one strip over the box now, and the new chat is the first of today's
  await expect(box.locator('.mk-agent-main > .mk-agent-chips .chip')).toHaveCount(4);
  await expect(box.locator('[data-mk-chat-item] b').first()).toHaveText('بوست لمخدات الشتا وبالألوان البيج');
  // decision 73: one button — the expand mark while small, the shrink mark (and «صغّر») while it fills the page
  const full = box.locator('[data-mk-agent-full]');
  await expect(full).toHaveText('كبّر');
  await expect(full.locator('svg path')).toHaveAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
  await full.click();
  await expect(P.locator('.mk-agent-full')).toBeVisible();
  await expect(full).toHaveText('صغّر');
  await expect(full.locator('svg path')).toHaveAttribute('d', 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7');
  const fills = await P.locator('.mk-agent-full').evaluate((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(innerWidth - r.right), Math.round(innerHeight - r.bottom)]; });
  expect(fills).toEqual([12, 12, 12, 12]);
  await full.click();
  await expect(P.locator('.mk-agent-full')).toHaveCount(0);
  await expect(full.locator('svg path')).toHaveAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
});

test('comment 72 — on a phone the history is a drawer: «الشاتات» in the chat\'s head opens it over the chat, a pick (or the veil) closes it, and nothing scrolls sideways', async ({ page }) => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const CH1 = 'c7210000-0000-4000-8000-000000000001';
  await page.setViewportSize({ width: 390, height: 800 });
  await start(page, { mktAgentChats: [{ id: CH1, member_id: ADMIN_ID, agent: 'dev', title: 'صفحة العروض', updated_at: D(-1) + 'T10:00:00Z' }], mktAgentMsgs: [{ chat_id: CH1, role: 'user', text: 'عايز صفحة عروض' }, { chat_id: CH1, role: 'assistant', text: 'تمام — صفحة هبوط بسيطة' }] });
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'marketing-ai'; });
  const P = pg(page);
  await P.getByRole('tab', { name: /المبرمج/ }).click();
  const box = P.locator('[data-mk-agent="dev"]');
  const toggle = box.locator('[data-mk-chats-toggle]');
  await expect(toggle).toBeVisible(); await expect(toggle).toHaveText('الشاتات (1)');
  await expect(box.locator('.mk-agent-side')).toBeHidden();
  await toggle.click();
  await expect(box.locator('.mk-agent-side.open')).toBeVisible();
  await expect(box.locator('.mk-agent-veil')).toBeVisible();
  await box.locator('[data-mk-chat-item] .mk-agent-open', { hasText: 'صفحة العروض' }).click();
  await expect(box.locator('.mk-agent-side')).toBeHidden();
  await expect(box.locator('[data-mk-chat="2"]')).toContainText('صفحة هبوط بسيطة');
  await toggle.click(); await box.locator('.mk-agent-veil').click({ position: { x: 8, y: 200 } });
  await expect(box.locator('.mk-agent-side')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

// ش45 decision 4 — the designer trusted with content: its answer carries a filled campaign → «كامبين جديدة» opens by itself on the
// details (the goal, the idea, the counts); nothing saved or generated; «افتح الكامبين» under the answer opens it again
test('ش45 — the designer\'s content task: after its questions it fills the campaign and the page opens «كامبين جديدة» with it, nothing generated', async ({ page }) => {
  await start(page);
  mock.mkt.agentAnswer = (req) => (/عرض/.test(req.question)
    ? { text: 'تمام — جهزتلك الكامبين: 2 بوست وريل 15 ثانية لعرض المكرمية. هتفتح متملّية في التسويق، راجعها واضغط توليد.', image_prompt: '', request: { title: '', details: '' },
      campaign: { goal: 'عرض / خصم', idea: 'عرض الشتا على المكرمية — خصم 20% لحد آخر الشهر', post: 2, carousel: 0, slides: 0, video: 1, dur: 15 } }
    : { text: 'عن إيه المحتوى؟ والهدف إيه؟ وعايز كام بوست / ريل؟', image_prompt: '', request: { title: '', details: '' }, campaign: { goal: '', idea: '', post: 0, carousel: 0, slides: 0, video: 0, dur: 0 } });
  await openAi(page, ADMIN, 'الديزاينر');
  const input = pg(page).locator('#mk-ask');
  await input.fill('عايز اعمل محتوى'); await input.press('Enter');
  await expect(pg(page)).toContainText('عن إيه المحتوى؟');
  await expect(pg(page).locator('[data-mk-draft-from]')).toHaveCount(0);
  await input.fill('عرض الشتا على المكرمية 2 بوست وريل'); await input.press('Enter');
  await expect(pg(page).locator('[data-cw-goal] [aria-checked="true"]')).toHaveText('عرض / خصم');
  await expect(pg(page).locator('textarea').first()).toHaveValue('عرض الشتا على المكرمية — خصم 20% لحد آخر الشهر');
  await expect(page.locator('body')).toContainText('فتحتلك الكامبين متملّية');
  expect(mock.mkt.campaigns.length, 'nothing saved').toBe(0);
  expect(mock.mkt.calls.filter((c) => ['marketing', 'campaign', 'campaign_edit', 'video_clip'].includes(c.action)).length, 'nothing generated').toBe(0);
});

// ش45 decision 5 — the media buyer opens / closes a campaign: its answer carries the proposal, a confirm card under it; «أيوه» runs it
// on Meta (mkt-ads campaign_set) only with the execution switch on; «لأ» drops it; nothing runs from the chat itself
test('ش45 — the media buyer\'s «اقفل الحملة»: a confirm card under the answer; the switch off says so; on, «أيوه» pauses it on Meta; «لأ» drops it', async ({ page }) => {
  await start(page);
  mock.mkt.agentAnswer = (req) => (/اقفل/.test(req.question)
    ? { text: 'تمام — هقفل «Macrame — Retargeting». أكّد من الكارت تحت.', request: { title: '', details: '' }, campaign_action: { campaign_id: CA, action: 'pause' } }
    : { text: 'افتحها؟ أكّد من تحت.', request: { title: '', details: '' }, campaign_action: { campaign_id: CB, action: 'resume' } });
  await openAi(page, ADMIN, 'الميديا باير');
  const input = pg(page).locator('#mk-ask');
  await input.fill('اقفل حملة المكرمية'); await input.press('Enter');
  const card = pg(page).locator('[data-mk-camp-act="pause:' + CA + '"]');
  await expect(card).toContainText('اقفل الحملة «');
  expect(mock.mkt.campaignSets || [], 'nothing ran from the chat').toEqual([]);
  // the switch off: the server refuses in words, nothing changed
  mock.mkt.rules.live = false;
  await card.locator('[data-mk-camp-yes]').click();
  await expect(page.locator('body')).toContainText('مفتاح التنفيذ على ميتا مقفول');
  expect(mock.mkt.adObjects.find((o) => o.id === CA).status).toBe('ACTIVE');
  // the switch on: paused on Meta, the card says it, logged with the id only
  mock.mkt.rules.live = true;
  await card.locator('[data-mk-camp-yes]').click();
  await expect(pg(page).locator('[data-mk-camp-done="ok"]')).toContainText('اتقفلت الحملة على ميتا');
  expect(mock.mkt.adObjects.find((o) => o.id === CA).status).toBe('PAUSED');
  expect(mock.mkt.campaignSets.map((x) => [x.id, x.status])).toEqual([[CA, 'PAUSED']]);
  await expect.poll(() => mock.activityRows.filter((a) => a.action === 'mkt.buyer.campaign').map((a) => [a.entity_id, a.new_value])).toEqual([[CA, 'pause · live_off'], [CA, 'pause · ok']]);
  // «لأ» drops the next one
  await input.fill('افتح حملة اللمبات'); await input.press('Enter');
  await pg(page).locator('[data-mk-camp-act="resume:' + CB + '"] [data-mk-camp-no]').click();
  await expect(pg(page).locator('[data-mk-camp-done="no"]')).toContainText('اترفض');
  expect(mock.mkt.campaignSets.length).toBe(1);
});


// the owner 17 Nov («فاتح الميديا باير و قولتله اعملي فيديو يقولي ده مش اختصاصي هبعتك للمصمم و يبعتني ليه بالبرومت و ادوس علي ارسال»):
// an ask outside the assistant's area comes back as a handoff to one of the member's team — «روح للـ…» opens that assistant on a new chat
// with the question in its box; nothing is sent until the member presses «ابعت»; an id outside the team never gets a button
test('handoff — the media buyer asked for a video sends the member to the designer with the question written in', async ({ page }) => {
  await start(page);
  mock.mkt.agentAnswer = (req) => (/فيديو/.test(req.question)
    ? { text: 'ده مش اختصاصي — هبعتك للديزاينر الذكي، والطلب مكتوب عنده، دوس إرسال.', request: { title: '', details: '' }, handoff: { agent: 'designer', question: 'اعملي فيديو ريل 15 ثانية لفازة المكرمية الجديدة' } }
    : { text: 'مش عارف.', request: { title: '', details: '' }, handoff: { agent: 'nope', question: 'سؤال' } });
  await openAi(page, ADMIN, 'الميديا باير');
  const P = pg(page); const input = P.locator('#mk-ask');
  await input.fill('اعملي فيديو للفازة'); await input.press('Enter');
  await expect(P.locator('.mk-msg.ai').last()).toContainText('ده مش اختصاصي');
  const call = mock.mkt.calls.filter((c) => c.action === 'agent').pop();
  expect(call.team, 'the team = the others the member sees').toContain('designer');
  expect(call.team).not.toContain('buyer');
  const card = P.locator('[data-mk-handoff="designer"]');
  await expect(card).toContainText('اعملي فيديو ريل 15 ثانية');
  const before = mock.mkt.calls.filter((c) => c.action === 'agent').length;
  await card.locator('[data-mk-handoff-go]').click();
  await expect(P.locator('#mk-ask')).toHaveAttribute('placeholder', /للديزاينر/);
  await expect(P.locator('#mk-ask')).toHaveValue('اعملي فيديو ريل 15 ثانية لفازة المكرمية الجديدة');
  expect(mock.mkt.calls.filter((c) => c.action === 'agent').length, 'nothing sent until «ابعت»').toBe(before);
  await P.locator('#mk-ask').press('Enter');
  await expect.poll(() => mock.mkt.calls.filter((c) => c.action === 'agent').pop().agent).toBe('designer');
  // an assistant outside the team: no button
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click();
  await expect(pg(page).locator('#mk-ask')).toHaveAttribute('placeholder', /الميديا باير/);
  await pg(page).locator('[data-mk-chat-new="buyer"]').click();
  await pg(page).locator('#mk-ask').fill('سؤال تاني'); await pg(page).locator('#mk-ask').press('Enter');
  await expect(pg(page).locator('.mk-msg.ai').last()).toContainText('مش عارف');
  await expect(pg(page).locator('[data-mk-handoff]')).toHaveCount(0);
});

// 0120 (the owner 17 Nov): the new assistants — the warehouse one for whoever sees the warehouse, its chat on the same server action with
// its own id
test('0120 — «التشغيل الذكي» (was «المخزن الذكي»): a tab of its own, its chat asks the server as «stock»', async ({ page }) => {
  await start(page);
  await openAi(page, OPS, 'التشغيل الذكي');
  const P = pg(page); const box = P.locator('[data-mk-agent="stock"]');
  await expect(box).toBeVisible();
  await expect(P.locator('#mk-ask')).toHaveAttribute('placeholder', /للتشغيل الذكي/);
  await P.locator('#mk-ask').fill('إيه أقدم قطعة في المخزن؟'); await P.locator('#mk-ask').press('Enter');
  await expect.poll(() => mock.mkt.calls.filter((c) => c.action === 'agent').map((c) => c.agent)).toEqual(['stock']);
  await expect(box.locator('.mk-chat')).toContainText('سؤالك: إيه أقدم قطعة في المخزن؟');
  await expect(box.locator('[data-mk-chat-item]')).toHaveCount(1);
});


// the owner 17 Nov — «اعمل زيه»: on a trend tile and on a competitor's card → «كامبين جديدة» filled from it (a reel for a video, a post
// for a picture), its link in the notes and its picture under «أمثلة للمطابقة» (ref_link); nothing generated
test('«اعمل زيه» — a trend video opens «كامبين جديدة» filled with it as the reference; a competitor\'s card too', async ({ page }) => {
  await start(page, { mktTrendTags: ['macrame'], mktCompetitors: [{ name: 'Boho Corner', keyword: 'بوهو ديكور', page_url: 'https://www.facebook.com/bohocorner' }] });
  await openAi(page, ADMIN, 'الديزاينر');
  const card = pg(page).locator('.mk-trends');
  await card.locator('[data-mk-trends-go]').click(); await page.locator('[data-ai-go]').click();
  await expect(card.locator('[data-mk-reels="video"] a.mk-tile').first()).toBeVisible();
  // the owner 17 Nov: a TikTok video plays on hover (its own muted player over the picture) and stops when the pointer leaves
  await page.route(/^https:\/\/www\.(tiktok|instagram|facebook)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  const tt = card.locator('[data-mk-reels="video"] a.mk-tile[data-mk-embed][href*="tiktok.com"]').first();
  await tt.hover();
  await expect(tt.locator('iframe.mk-tile-play')).toHaveAttribute('src', /^https:\/\/www\.tiktok\.com\/player\/v1\/\d+\?autoplay=1&muted=1/);
  await page.mouse.move(0, 0);
  await expect(tt.locator('iframe.mk-tile-play')).toHaveCount(0);
  // «اعمل زيه» on every tile, without a hover
  await expect(card.locator('[data-mk-reels="video"] [data-mk-copy-trend]').first()).toBeVisible();
  const tile = card.locator('[data-mk-reels="video"] .mk-tile-box').first();
  const title = await tile.locator('.mk-tile-cap b').textContent();
  await tile.locator('[data-mk-copy-trend]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  const mk = page.locator('#pg-marketing');
  await expect(mk.locator('textarea').first()).toHaveValue(new RegExp('زي «' + title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect.poll(() => mock.mkt.calls.filter((c) => c.action === 'ref_link').length).toBe(1);
  await expect(mk.locator('[data-cw-files^="cw-ref-video"] .cw-f')).toHaveCount(1);
  expect(mock.mkt.calls.filter((c) => ['marketing', 'campaign', 'video_clip'].includes(c.action)).length, 'nothing generated').toBe(0);
  // the competitor's card (the media buyer's tab)
  await page.locator('.sidebar .nav-item[data-page="ai"]').click();
  await pg(page).getByRole('tab', { name: /الميديا باير/ }).click();
  const comp = pg(page).locator('[data-mk-comp]').first();
  await comp.locator('[data-mk-copy-comp]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await expect(page.locator('#pg-marketing textarea').first()).toHaveValue(/بنفس روح إعلانات/);
});

test('the owner 17 Nov — «البيكسل» under the media buyer: «افحص البيكسل» (mkt-ads pixel) → the events and each issue with its fix; «ساعدني أصلحها» writes the question in the chat box, nothing sent', async ({ page }) => {
  await start(page);
  mock.mkt.pixelReport = { pixel: { id: '1234567890', name: 'Ibtekr', lastFired: null }, events: [{ name: 'PageView', count: 50 }, { name: 'Purchase', count: 0 }], purchases: 0, orders: 12,
    issues: [{ key: 'event_Purchase', level: 'bad', title: 'حدث Purchase مش واصل', detail: 'مفيش ولا Purchase في آخر 7 أيام.', fix: 'فعّل أحداث ووكومرس' }], ok: false };
  await openAi(page, ADMIN);
  const P = pg(page);
  const card = P.locator('.mk-px');
  await expect(card).toContainText('لسه مفيش فحص');
  await card.locator('[data-px-check]').click();
  await expect(card.locator('[data-px-issue="event_Purchase"]')).toContainText('الحل: فعّل أحداث ووكومرس');
  await expect(card.locator('[data-px-event="Purchase"]')).toContainText('0');
  expect(mock.mkt.calls.filter((x) => x.fn === 'mkt-ads' && x.action === 'pixel')).toHaveLength(1);
  const asks = mock.mkt.calls.filter((x) => x.fn === 'ai-content').length;
  await card.locator('[data-px-help]').click();
  await expect(P.locator('#mk-ask')).toHaveValue(/البيكسل.*Purchase/);
  expect(mock.mkt.calls.filter((x) => x.fn === 'ai-content').length).toBe(asks);
});

test('the owner 17 Nov — the chat bar like Claude\'s: «+» files (an image read in the browser, a chip with ×), a message sent while the answer is coming waits in the queue and goes after it, in order; the mic button is there', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN);
  const P = pg(page);
  await expect(P.locator('[data-mk-pending]')).toBeVisible();
  await expect(P.locator('.mk-ask [data-mk-mic]')).toBeVisible();
  await expect(P.locator('.mk-ask [data-mk-attach]')).toBeVisible();
  // a file: a 1px PNG through «+»
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser'); await P.locator('[data-mk-attach]').click();
  await (await chooser).setFiles({ name: 'post.png', mimeType: 'image/png', buffer: png });
  await expect(P.locator('[data-mk-file="post.png"] img')).toBeVisible();
  // the answer is held: the second message waits in the queue
  let release; mock.mkt.agentHold = new Promise((r) => { release = r; });
  await P.locator('#mk-ask').fill('بص على البوست ده'); await P.locator('#mk-ask').press('Enter');
  await expect(P.locator('[data-mk-files]')).toHaveCount(0); // the files went with the message
  await P.locator('#mk-ask').fill('وكمان قولّي أحسن وقت للنشر'); await P.locator('#mk-ask').press('Enter');
  await expect(P.locator('[data-mk-queue="1"]')).toContainText('أحسن وقت للنشر');
  release();
  await expect(P.locator('[data-mk-queue]')).toHaveCount(0);
  await expect.poll(() => mock.mkt.calls.filter((x) => x.fn === 'ai-content' && x.action === 'agent').length).toBe(2);
  const calls = mock.mkt.calls.filter((x) => x.fn === 'ai-content' && x.action === 'agent');
  expect(calls.map((x) => [x.question, x.files])).toEqual([['بص على البوست ده', ['image:post.png']], ['وكمان قولّي أحسن وقت للنشر', []]]);
  await expect(P.locator('.mk-msg.user').first()).toContainText('📎 post.png');
  await expect(P.locator('[data-mk-turn-files="1"] [data-mk-file-dl="post.png"]')).toBeVisible(); // the file stays under the message with «تنزيل»
});

test('the owner 17 Nov — the warehouse assistant\'s plan: «راجع الخطة» lists each step with its count and examples; a step runs only on its own «نفّذ» (a new category on the site)', async ({ page }) => {
  await start(page);
  mock.mkt.planData = { vendors: [{ id: 'v-wood', name: 'Woodish' }], products: [{ id: 501, name: 'Wooden Chair', nameAr: 'كرسي خشب', sku: 'X', vendorId: 'v-wood', categoryIds: [], status: 'publish' }], categories: [] };
  mock.mkt.agentAnswer = () => ({ text: 'دي الخطة — راجعها', plan: [
    { op: 'category_create', maker: '', query: [], category: '', to_maker: '', brand: '', status: '', new_en: 'Living Room', new_ar: 'الليفنج', parent: '', note: '' },
    { op: 'category_add', maker: 'وودش', query: ['chair', 'كرسي'], category: 'Living Room', to_maker: '', brand: '', status: '', new_en: '', new_ar: '', parent: '', note: '' }], request: { title: '', details: '' } });
  await openAi(page, ADMIN, 'التشغيل الذكي');
  const P = pg(page);
  await P.locator('#mk-ask').fill('هات كراسي وودش وحطها في قسم Living Room جديد'); await P.locator('#mk-ask').press('Enter');
  await expect(P.locator('[data-mk-plan="2"]')).toBeVisible();
  const before = mock.wooCalls ? mock.wooCalls.length : 0;
  await P.locator('[data-mk-plan-open]').click();
  const md = page.locator('.modal[role=dialog]', { hasText: 'خطة المساعد' });
  await expect(md.locator('[data-plan-step="0"]')).toContainText('قسم جديد «Living Room / الليفنج» رئيسي');
  await expect(md.locator('[data-plan-step="1"]')).toContainText('ضيف 1 منتج من Woodish لـ «Living Room»');
  await expect(md.locator('[data-plan-step="1"]')).toContainText('كرسي خشب');
  await md.locator('[data-plan-run="0"]').click();
  await expect(md.locator('[data-plan-step="0"] [data-plan-result="ok"]')).toContainText('اتعمل القسم');
  await expect(md.locator('[data-plan-step="1"] [data-plan-result]')).toHaveCount(0); // the next step waits for its own button
});

// the owner 18 Nov («عايز المساعدين … يجيبولي الاختيارات جوا الشات يعني اوافق او ارفض»): the buyer's answer carries the open suggestions to
// decide — a card each under the answer with «موافق» / «رفض» (mkt-ads decide); the switch off says so on the card; no trip to another page
test('the owner 18 Nov — the media buyer\'s suggestions decided in the chat: «موافق» approves #1, «رفض» rejects #4; the switch off is said on the card', async ({ page }) => {
  await start(page);
  mock.mkt.rules.live = false;
  mock.mkt.agentAnswer = () => ({ text: 'أنصح نوقف «Lamps — Broad» ونرفض اقتراح التتبع — الكروت تحت.', request: { title: '', details: '' }, campaign_action: { campaign_id: '', action: '' },
    decisions: [{ id: '1', decision: 'approve' }, { id: '#4', decision: 'reject' }, { id: '999', decision: 'approve' }] });
  await openAi(page, ADMIN, 'الميديا باير');
  const input = pg(page).locator('#mk-ask');
  await input.fill('إيه رأيك في الاقتراحات؟'); await input.press('Enter');
  const c1 = pg(page).locator('[data-mk-dec="1"]'); const c4 = pg(page).locator('[data-mk-dec="4"]');
  await expect(c1).toContainText('وقّف «Lamps — Broad»'); await expect(c1).toContainText('توافق عليه');
  await expect(c4).toContainText('ترفضه');
  await expect(pg(page).locator('[data-mk-dec-gone="999"]')).toContainText('مابقاش مستني');
  await expect(c1.locator('[data-mk-live-off]')).toContainText('مفتاح التنفيذ مقفول');
  expect(mock.mkt.suggestions.filter((s) => [1, 4].includes(s.id) && s.status !== 'pending').length, 'nothing decided from the chat by itself').toBe(0);
  await c1.locator('[data-mk-dec-yes]').click();
  await expect(pg(page).locator('[data-mk-dec-done="approve"]')).toBeVisible();
  expect(mock.mkt.suggestions.find((s) => s.id === 1).status).not.toBe('pending');
  await c4.locator('[data-mk-dec-no]').click();
  await expect(pg(page).locator('[data-mk-dec-done="reject"]')).toContainText('اترفض');
  expect(mock.mkt.suggestions.find((s) => s.id === 4).status).toBe('rejected');
});

// agents-brain decision 20 (the owner 18 Nov — «عايز ارفع منتج يقولي حدد النوع … و بعدين يبتدي يشتغل … يطلع المعلومات جوه بوباب زي اللي بيحصل في
// السيستم قبل الرفع … و بعديها يسالني علي الرفع او التحميل» و«يسالني و ما يولدش الا لما اوافق»): the upload as fixed questions in the stock
// assistant's chat — the case, the type, the maker, the files — then the studio's own steps on a new batch, the studio's own screens in a
// popup to edit, and the chat asks: to the site (and first whether to generate the AI pictures), the sheet down, or shared
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png1 = (name) => ({ name, mimeType: 'image/png', buffer: PNG1 });
const pickIn = async (page, sel, files) => { const fc = page.waitForEvent('filechooser'); await pg(page).locator(sel).click(); await (await fc).setFiles(files); };
test('decision 20 — «ارفع منتجات»: «شيت جاهز» asked in the chat → the review popup (data + prices) → «ارفع على الموقع» → «ارفع بالصور اللي معاك»: drafts, nothing generated', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN, 'التشغيل الذكي');
  const P = pg(page);
  await P.locator('.mk-agent-chips .chip', { hasText: 'ارفع منتجات' }).click();
  const card = P.locator('[data-mk-wiz] .sc-card');
  await expect(card).toHaveAttribute('data-sc', 'kase'); expect(mock.mkt.calls.filter((x) => x.action === 'agent')).toHaveLength(0); // the questions are the chat's own — no AI call
  await card.locator('[data-sc-opt="sheet"]').click();
  await expect(card).toHaveAttribute('data-sc', 'type'); await card.locator('[data-sc-opt="Simple"]').click();
  await expect(card).toHaveAttribute('data-sc', 'maker');
  await card.locator('#sc-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await expect(card).toHaveAttribute('data-sc', 'files');
  await expect(card.locator('[data-sc-start]')).toBeDisabled(); // the sheet first
  await pickIn(page, '[data-sc-pick="sheet"]', { name: 'art craft.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n2,,Stripe Pillow,مخدة مخططة,Purple,بنفسجي,,800,ديكور\n') });
  await pickIn(page, '[data-sc-pick="photos"]', [png1('1.png'), png1('2.png')]);
  await expect(card.locator('[data-sc-file="photos"]')).toContainText('2 صورة');
  await card.locator('[data-sc-start]').click();
  // the studio's own screens in the popup: the data (the SKU made, the AI filled), then the prices from the maker's rate
  const rev = page.locator('.modal [data-fl-review]');
  await expect(rev).toHaveAttribute('data-fl-review', 'data');
  await expect(rev.locator('[data-fl="sku"]').first()).toHaveValue('IBTART0999-BE');
  await expect(page).toHaveURL(/#ai/); // still the chat — the studio page never opened
  await page.locator('.modal [data-fl-rev-tab="prices"]').click();
  await expect(page.locator('.modal [data-fl-review="prices"] [data-fl="sale"]').first()).toHaveValue('1430');
  await page.locator('.modal [data-fl-rev-save]').click();
  await expect(card).toHaveAttribute('data-sc', 'next');
  await card.locator('[data-sc-opt="site"]').click();
  await expect(card).toContainText('أولّد صور المنتجات بالذكاء الاصطناعي الأول؟');
  expect(mock.studioUploads).toEqual([]); // nothing went to the site yet
  await card.locator('[data-sc-opt="own"]').click();
  await expect(card).toContainText('اترفعت 2 منتج مسودة على الموقع');
  expect(mock.imgCalls.filter((c) => c.action === 'generate')).toHaveLength(0); // no picture generated without the member's yes
  expect(mock.studioUploads.map((x) => [x.sku, x.product.status])).toEqual([['IBTART0999-BE', 'draft'], ['IBTART1000-PU', 'draft']]);
  expect(mock.studioMedia.map((x) => x.name).some((n) => /^Boho-Cushion-IBTART0999-BE-01\./.test(n))).toBe(true); // the maker's photo as the first picture
});

test('decision 20 — the assistant hands over: «ضيف منتجات» → its studio step = the chat\'s questions (no plan card); «صور وعايز شيت» → the sheet popup → «تحميل الشيت»', async ({ page }) => {
  await start(page);
  mock.mkt.planData = { vendors: [{ id: 'v-wood', name: 'Woodish' }], products: [], categories: [] };
  mock.mkt.agentAnswer = () => ({ text: 'هسألك كام سؤال هنا', request: { title: '', details: '' }, plan: [{ op: 'studio', maker: '', query: [], category: '', to_maker: '', brand: '', status: '', new_en: '', new_ar: '', parent: '', note: '', kase: '', type: '', screens: [] }] });
  await openAi(page, ADMIN, 'التشغيل الذكي');
  const P = pg(page);
  await P.locator('#mk-ask').fill('ضيف منتجات'); await P.locator('#mk-ask').press('Enter');
  const card = P.locator('[data-mk-wiz] .sc-card');
  await expect(card).toHaveAttribute('data-sc', 'kase');
  await expect(P.locator('[data-mk-plan-open]')).toHaveCount(0);
  await card.locator('[data-sc-opt="photos"]').click(); await card.locator('[data-sc-opt="Simple"]').click();
  await card.locator('#sc-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await pickIn(page, '[data-sc-pick="photos"]', [png1('1.png'), png1('2.png')]);
  await card.locator('[data-sc-start]').click();
  const rev = page.locator('.modal [data-fl-review="sheet"]');
  await expect(rev.locator('[data-flow-sheet] tbody tr')).toHaveCount(2);
  await page.locator('.modal [data-fl-rev-save]').click();
  await expect(card.locator('[data-sc-opt]')).toHaveCount(3); // photos only: no «ارفع على الموقع» — the sheet goes to the maker first
  await expect(card.locator('[data-sc-opt="site"]')).toHaveCount(0);
  await card.locator('[data-sc-opt="dl"]').click();
  await expect(page.locator('[data-fl-download]')).toBeVisible();
});

