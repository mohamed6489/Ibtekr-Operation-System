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
const REQS = [{ kind: 'designer', title: 'فيديو Macrame', details: '9:16 · 15 ثانية', project: 'الشتا', status: 'جاهز للمراجعة', created_by: '00000000-0000-4000-8000-000000000002' }, { kind: 'dev', title: 'صفحة هبوط رمضان', project: 'موقع', status: 'بيتعمل', created_by: '00000000-0000-4000-8000-000000000001' }];
let mock = null; let pageErrors = [];
async function start(page, extra = {}) {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { mktAdObjects: OBJECTS, mktAdStats: STATS, mktSuggestions: SUGG, mktRequests: REQS, ...extra });
}
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, email) {
  // after a sign-out the app reloads itself: let that reload land, then start from a fresh page (a goto cut by the reload is retried)
  await page.waitForLoadState('load').catch(() => {});
  await page.goto('/').catch(() => page.goto('/'));
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible({ timeout: 15000 });
}
async function openAi(page, email, sub) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await pg(page).getByRole('tab', { name: /مساعدين الذكاء الاصطناعي/ }).click();
  if (sub) await pg(page).getByRole('tab', { name: new RegExp(sub) }).click();
}
const pg = (page) => page.locator('#pg-marketing');
async function signOut(page) { await page.locator('.user-btn').click(); await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click(); await expect(page.locator('#login')).toBeVisible(); }
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
  expect(mock.mkt.requests.find((q) => q.title.includes('Lamps video'))).toMatchObject({ kind: 'designer', status: 'جديد', project: 'Lamps — Broad' });
});

test('the chat: the question and the answer in the thread (ai-content buyer with the history), the quick chips; the refusal in words', async ({ page }) => {
  await start(page);
  await openAi(page, ADMIN);
  const P = pg(page);
  await P.locator('#mk-ask').fill('أزوّد Macrame؟');
  await P.locator('[data-mk-ask]').click();
  await expect(P.locator('[data-mk-chat="2"] .mk-msg.ai')).toContainText('سؤالك: أزوّد Macrame؟');
  await expect(P.locator('.mk-msg.user')).toContainText('أزوّد Macrame؟');
  await P.locator('.chip', { hasText: 'إيه أحسن حملة؟' }).click();
  await expect(P.locator('[data-mk-chat="4"]')).toBeVisible();
  const calls = mock.mkt.calls.filter((x) => x.fn === 'ai-content' && x.action === 'buyer');
  expect(calls.length).toBe(2);
  await expect.poll(() => mock.activityRows.filter((l) => l.action === 'mkt.buyer.chat').length).toBe(2);
  expect(JSON.stringify(mock.activityRows)).not.toContain('أزوّد');
  mock.mkt.buyerFail = 'ai_cap';
  await P.locator('#mk-ask').fill('x'); await P.locator('#mk-ask').press('Enter');
  await expect(toast(page)).toContainText('سقف الـ AI الشهري');
  await expect(P.locator('[data-mk-chat="4"]')).toBeVisible(); // the failed question is taken back
  // accounts (marketing N) has no page
  await signOut(page);
  await signIn(page, ACC);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(pg(page)).toContainText('مفيش صلاحية');
});

test('the designer and the developer: the requests with their state, a new request (ops), the author edits a new one, the admin moves the status; the overview\'s cards', async ({ page }) => {
  await start(page);
  await openAi(page, OPS, 'المبرمج');
  const P = pg(page);
  await expect(P.locator('[data-mk-reqs="dev"]')).toContainText('صفحة هبوط رمضان');
  await P.locator('[data-mk-req-add="dev"]').click();
  const f = modal(page, 'طلب للمبرمج');
  await f.getByRole('button', { name: 'ابعت الطلب' }).click();
  await expect(f).toContainText('الحقل ده مطلوب');
  await f.locator('input').first().fill('تحسين سرعة صفحة المنتج');
  await f.locator('textarea').fill('الصور كبيرة');
  await f.getByRole('button', { name: 'ابعت الطلب' }).click();
  await expect(toast(page)).toContainText('الطلب اتبعت للمبرمج');
  await expect(P.locator('[data-mk-reqs="dev"] [data-mk-req]')).toHaveCount(2);
  const made = mock.mkt.requests.find((q) => q.title === 'تحسين سرعة صفحة المنتج');
  expect(made).toMatchObject({ kind: 'dev', project: 'موقع', status: 'جديد', created_by: '00000000-0000-4000-8000-000000000002' });
  // the author edits while new; the status is the admin's
  await P.locator('[data-mk-req="' + made.id + '"]').click();
  const d = page.locator('.modal[data-mk-req="' + made.id + '"]');
  await expect(d.locator('#mk-req-st')).toHaveCount(0);
  await d.locator('[data-mk-req-edit]').click();
  const e = modal(page, 'تعديل:');
  await e.locator('input').first().fill('تحسين سرعة صفحة المنتج (الصور)');
  await e.getByRole('button', { name: 'احفظ' }).click();
  await expect(toast(page)).toContainText('اتحفظ');
  await expect(P.locator('[data-mk-reqs="dev"]')).toContainText('(الصور)');
  await expect.poll(() => mock.activityRows.filter((l) => String(l.action).startsWith('mkt.request.')).map((l) => l.new_value)).toEqual(['dev', 'dev']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('الصور كبيرة');
  // the admin: the status select on the request
  await signOut(page);
  await openAi(page, ADMIN, 'الديزاينر');
  await pg(page).locator('[data-mk-req="1"]').click();
  const a = page.locator('.modal[data-mk-req="1"]');
  await a.locator('#mk-req-st').click(); await page.getByRole('option', { name: 'الحالة: خلص' }).click();
  await expect(toast(page)).toContainText('اتغيّرت الحالة');
  expect(mock.mkt.requests.find((q) => q.id === 1)).toMatchObject({ status: 'خلص' });
  await expect(pg(page).locator('.mk-done summary')).toContainText('اللي خلص (1)');
  // the overview's assistant cards
  await pg(page).getByRole('tab', { name: /نظرة عامة/ }).click();
  const cards = pg(page).locator('[data-ads-assistants="live"]');
  await expect(cards).toContainText('4 اقتراح مستني موافقتك');
  await expect(cards).toContainText('1 وقّف · 1 زوّد · 1 نسخة جديدة · 1 راجع التتبع');
  await expect(cards).toContainText('تحسين سرعة صفحة المنتج (الصور)');
  await cards.getByRole('button', { name: 'افتح الميديا باير' }).click();
  await expect(pg(page).locator('[data-mk-chat]')).toBeVisible();
});
