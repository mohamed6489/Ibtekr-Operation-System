import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Live sync (the owner 15 Nov — docs/superpowers/plans/2026-11-15-live-sync.md decision 2): what a teammate saved shows on every open
// screen without a reload. The database's signal (0104) is played by hand here — the stand-in has no socket — after the stand-in's
// data was changed the way another member's save would change it: the page must show it, with no «loading» flash, and must wait
// while the member has a popup open.
const ADMIN = 'admin.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001';
const cairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let mock = null; let pageErrors = [];
const CAMP = 'f0000000-0000-4000-8000-000000000001';
const LOT1 = 'b7000000-0000-4000-8000-000000000001';
const lot1 = () => ({ id: LOT1, reason: 'متاح للبيع', status: 'متاح', sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V1, product_id: null, order_id: null, item_id: null, ref: null, loc: 'T', mode: 'أمانة', cost: 650, condition: null, condition_note: null, note: null, since: cairo(), closed_at: null, created_by: null, created_at: new Date().toISOString() });
test.beforeEach(async ({ page }, info) => {
  test.skip(LIVE, 'plays the change signal by hand on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, /hub/.test(info.title) ? { invLots: [lot1()] } : /campaign/.test(info.title) ? { mktCampaigns: [{ id: CAMP, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 2, state: { w: { idea: 'كولكشن الشتا' } } }] } : {});
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const main = (page) => page.locator('#main');
const modal = (page) => page.locator('.modal[role=dialog]');
const signal = (page, payload) => page.evaluate((p) => window.IBLive.signal({ payload: p }), payload);
// a teammate's expense, as the database would hold it after their «حفظ»
const expense = (id, details, amount) => ({ id, on_date: cairo(), direction: 'withdraw', category: 'المصروفات', beneficiary: 'مطبعة النيل', beneficiary_other: true, amount, note: null, details, reason: null, staff_kind: null,
  sub_name: null, sub_ends: null, sub_alerts: [], created_by: 'a0000000-0000-4000-8000-0000000000aa', created_at: new Date().toISOString(), updated_by: null, updated_at: null, voided_by: null, voided_at: null });

test('accounts: a teammate\'s expense shows without a reload — quietly, and only after my open popup is closed', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await main(page).locator('[role=tab]', { hasText: 'المصروفات' }).first().click();
  await expect(main(page).locator('.empty')).toContainText('لسه مفيش مصروفات');
  // the page is watched for any «loading» state from here on
  await page.evaluate(() => { window.__states = []; document.addEventListener('ib:accounts', () => window.__states.push(window.IBAccounts.state())); });

  mock.acc.acc_expenses.push(expense(9001, 'ورق تغليف من زميل', 730));
  await signal(page, { t: 'accounts', at: new Date().toISOString() });
  await expect(main(page).locator('table').filter({ hasText: 'ورق تغليف من زميل' })).toBeVisible();
  expect(await page.evaluate(() => window.__states)).not.toContain('loading');

  // a popup is open: what is on the screen stays what is in memory until it closes
  await main(page).getByRole('button', { name: 'إضافة مصروفات', exact: true }).click();
  await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'سحب' }).first().click();
  await expect(modal(page)).toBeVisible();
  mock.acc.acc_expenses.push(expense(9002, 'كراتين شحن من زميل', 410));
  await signal(page, { t: 'accounts' });
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => window.IBAccounts.rows('expenses').length)).toBe(1); // still waiting
  expect(await page.evaluate(() => window.IBLive.held())).toBe(true);
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await expect(modal(page)).toBeHidden();
  await expect(main(page).locator('table').filter({ hasText: 'كراتين شحن من زميل' })).toBeVisible();
});

test('orders: the status a teammate set shows on the card without a reload; a move for a maker reaches the makers\' accounts', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  const before = await st.inputValue();
  const next = before === 'جاهز للشحن' ? 'قيد الشحن' : 'جاهز للشحن';
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: next });
  await signal(page, { t: 'orders', ids: [181668] });
  await expect(st).toHaveValue(next);
  expect(await page.evaluate(() => window.IBOrders.state())).toBe('ready');

  // a teammate's «عربون» for a maker: the accounts hold it at once (the page is not even open)
  mock.acc.acc_vendor_moves.push({ id: 9101, vendor_id: V1, on_date: cairo(), direction: 'withdraw', kind: 'عربون', kind_name: null, amount: 10, note: null, created_by: 'a0000000-0000-4000-8000-0000000000aa',
    created_at: new Date().toISOString(), updated_by: null, updated_at: null, voided_by: null, voided_at: null, settled_by: null, settled_at: null });
  await signal(page, { t: 'accounts' });
  await expect.poll(() => page.evaluate(() => window.IBAccounts.rows('vendorMoves').length)).toBe(1);
});

test('a signal for a group nobody loaded, or of an unknown group, asks the server for nothing', async ({ page }) => {
  await signIn(page);
  const seen = []; page.on('request', (r) => { if (/\/rest\/v1\//.test(r.url())) seen.push(r.url()); });
  await signal(page, { t: 'products' }); await signal(page, { t: 'studio' }); await signal(page, { t: 'something_else' });
  await page.waitForTimeout(1500);
  expect(seen.filter((u) => /\/(products|studio_batches|woo_categories)\b/.test(u))).toEqual([]);
});

// decision 3: «لسه زي ما أنا شايفه» — the owner: «غيرت حالة اوردر و عضو تاني غير حالة نفس الاوردر»
test('orders: a status changed on a card a teammate already moved is refused — nothing is written, the card shows theirs and says so; then my change goes', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  await expect(st).toHaveValue('جاري التنفيذ');
  // a teammate set «معلّق» a moment ago; my screen has not heard yet
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: 'معلّق' });
  const before = mock.patches.length;
  await st.selectOption('جاهز للشحن');
  await expect(page.locator('#orders #toast')).toContainText('حد تاني غيّر ده من شوية');
  await expect(st).toHaveValue('معلّق'); // theirs, read again
  expect(mock.orders.find((o) => o.id === 181668).status).toBe('معلّق');
  expect(mock.patches.slice(before).filter((p) => p.table === 'orders')).toEqual([]);
  expect(mock.activity.map((a) => a.action)).not.toContain('order.status');
  // now I am looking at theirs: the same change is mine to make
  await st.selectOption('جاهز للشحن');
  await expect.poll(() => mock.orders.find((o) => o.id === 181668).status).toBe('جاهز للشحن');
  await expect(st).toHaveValue('جاهز للشحن');
});

test('orders: «مكتمل» with the rating on an order a teammate completed first leaves one rating', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: 'مكتمل' }); mock.ratings.push({ order_id: 181668, sat: 5, manners: 5, note: null, by_user: 'a0000000-0000-4000-8000-0000000000aa' });
  await st.selectOption('مكتمل');
  const rate = page.getByRole('dialog', { name: /قيّم العميل — IB-181668/ });
  await rate.locator('#rt-sat [data-star="4"]').click(); await rate.locator('#rt-manners [data-star="4"]').click();
  await rate.getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect(page.locator('#orders #toast')).toContainText('حد تاني غيّر ده من شوية');
  expect(mock.ratings.filter((r) => r.order_id === 181668)).toHaveLength(1);
});

// decision 4: the same money entry twice — the owner: «انا عملت ايداع لفيندور و ف نفس الوقت عضو تاني عمل ايداع تاني … اتسجل للفيندور ده 20»
test('accounts: an expense a teammate recorded a moment ago is not recorded again without asking — «دي حركة تانية؟»: «إلغاء» records nothing, «سجّلها برضه» records it', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await main(page).locator('[role=tab]', { hasText: 'المصروفات' }).first().click();
  // «منى حسن» recorded it two minutes ago; my screen has not heard of it
  const theirs = expense(9201, 'ورق طباعة', 1250); Object.assign(theirs, { created_by: '00000000-0000-4000-8000-000000000004', created_at: new Date(Date.now() - 125000).toISOString() });
  mock.acc.acc_expenses.push(theirs);
  const save = async () => {
    await main(page).getByRole('button', { name: 'إضافة مصروفات', exact: true }).click();
    await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'سحب' }).first().click();
    await modal(page).locator('#f-amount').fill('1250');
    await modal(page).locator('#f-cat').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'المصروفات' }).first().click();
    await modal(page).locator('#f-ben').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'آخر' }).first().click();
    await modal(page).locator('#f-other').fill('مطبعة النيل'); await modal(page).locator('#f-details').fill('ورق طباعة تاني');
    await modal(page).locator('#f-macc').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'حساب البنك' }).first().click(); // 0143
    await modal(page).getByRole('button', { name: 'حفظ' }).click();
    await modal(page).getByRole('button', { name: 'احفظ برضه' }).click(); // the bank is at zero: saved with a warning
  };
  await save();
  const ask = page.locator('.modal[role=dialog]').filter({ hasText: 'دي حركة تانية؟' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('«منى حسن» سجّل نفس المصروف'); await expect(ask).toContainText('من دقيقتين');
  expect(mock.accWrites).toEqual([]); // nothing was written
  await ask.getByRole('button', { name: 'إلغاء — هي نفسها' }).click();
  await expect(ask).toBeHidden();
  expect(mock.acc.acc_expenses).toHaveLength(1); expect(mock.accWrites).toEqual([]);
  await expect(main(page).locator('table').filter({ hasText: 'ورق طباعة تاني' })).toHaveCount(0); // my copy is not left on the screen
  // it really is a second expense (the teammate's is five minutes old by now)
  theirs.created_at = new Date(Date.now() - 305000).toISOString();
  await save();
  await expect(ask).toBeVisible(); await expect(ask).toContainText('من 5 دقايق');
  await ask.getByRole('button', { name: 'سجّلها برضه' }).click();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_expenses', op: 'insert', amount: 1250, dup_ok: true });
  await expect(main(page).locator('table').filter({ hasText: 'ورق طباعة تاني' })).toBeVisible();
  expect(mock.acc.acc_expenses).toHaveLength(2);
});

// live-sync plan decision 6 (the second stage of «لسه زي ما أنا شايفه»): a maker's data, the hub's pieces, a settings section and a
// campaign are written only while they still hold what the member is looking at.
const vendorEvents = (page) => page.evaluate(() => { window.__vev = []; document.addEventListener('ib:vendors', (e) => window.__vev.push(e.detail || {})); });
test('makers: a field a teammate changed a moment ago is not overwritten — the refusal says so and shows theirs; another field still saves', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'makers'; });
  await expect.poll(() => page.evaluate(() => window.IBVendors.state())).toBe('ready');
  await vendorEvents(page);
  // a teammate saved a new phone a moment ago; my screen has not heard yet
  mock.vendors.find((v) => v.id === V1).phone = '01011111111';
  const before = mock.vendorWrites.length;
  await page.evaluate((id) => window.IBVendors.store.update(id, { phone: '01022222222' }), V1);
  await expect.poll(() => page.evaluate(() => window.__vev.some((d) => d.reason === 'stale'))).toBe(true);
  expect(mock.vendors.find((v) => v.id === V1).phone).toBe('01011111111');
  expect(mock.vendorWrites.slice(before).filter((w) => w.table === 'vendors')).toEqual([]);
  await expect.poll(() => page.evaluate((id) => window.IBVendors.store.get(id).phone, V1)).toBe('01011111111'); // theirs, read again
  expect(await page.evaluate(() => window.IBVendors.MESSAGES.stale)).toContain('حد تاني غيّر');
  // now I am looking at theirs: the change is mine to make
  await page.evaluate((id) => window.IBVendors.store.update(id, { phone: '01022222222' }), V1);
  await expect.poll(() => mock.vendors.find((v) => v.id === V1).phone).toBe('01022222222');
  // a teammate changed the phone again — my note is another field, so it still saves
  mock.vendors.find((v) => v.id === V1).phone = '01033333333';
  await page.evaluate((id) => window.IBVendors.store.update(id, { notes: 'ملاحظة جديدة' }), V1);
  await expect.poll(() => mock.vendors.find((v) => v.id === V1).notes).toBe('ملاحظة جديدة');
  expect(mock.vendors.find((v) => v.id === V1).phone).toBe('01033333333');
});

test('hub: a piece a teammate moved a moment ago is not moved over — «حد تاني غيّر القطعة دي», theirs read again; then my change goes', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'inventory'; });
  await expect.poll(() => page.evaluate(() => window.IBInventory.state())).toBe('ready');
  const lot = () => mock.inv.inv_lots.find((l) => l.id === LOT1);
  lot().loc = 'P'; // a teammate put it in «تصوير» a moment ago
  const r = await page.evaluate((k) => window.IBInventory.updateLot(k, { loc: 'R' }), LOT1);
  expect(r.ok).toBe(false); expect(r.reason).toBe('stale'); expect(r.message).toContain('حد تاني غيّر القطعة دي');
  expect(lot().loc).toBe('P');
  // read again: now I am looking at theirs, and the move is mine to make
  await expect.poll(async () => (await page.evaluate((k) => window.IBInventory.updateLot(k, { loc: 'R' }), LOT1)).ok).toBe(true);
  expect(lot().loc).toBe('R');
});

test('settings: a section a teammate saved a moment ago is not saved over — «اتغيّرت من شوية», read again; then my save goes', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings'; });
  await expect.poll(() => page.evaluate(() => window.IBSettings && window.IBSettings.data && window.IBSettings.data.loaded)).toBe(true);
  const row = () => mock.settings.find((r) => r.section === 'general');
  if (!row()) { await page.evaluate(() => window.IBSettings.save('general', { week: 'sat' })); await page.evaluate(() => window.IBSettings.load()); }
  // a teammate saved the section a moment ago (a new stamp); my screen has not heard yet
  Object.assign(row(), { data: { ...row().data, week: 'sun' }, updated_at: new Date(Date.now() + 5000).toISOString() });
  const r = await page.evaluate(() => window.IBSettings.save('general', { week: 'mon' }));
  expect(r.ok).toBe(false); expect(r.reason).toBe('stale'); expect(r.message).toContain('اتغيّرت من شوية');
  expect(row().data.week).toBe('sun');
  await expect.poll(() => page.evaluate(() => (window.IBSettings.section('general') || {}).week)).toBe('sun'); // theirs, read again
  const again = await page.evaluate(() => window.IBSettings.save('general', { week: 'mon' }));
  expect(again.ok).toBe(true); expect(row().data.week).toBe('mon');
  // two quick saves of one section: the second goes with the stamp the first left
  const two = await page.evaluate(() => Promise.all([window.IBSettings.save('general', { week: 'sat' }), window.IBSettings.save('general', { week: 'sun' })]));
  expect(two.map((x) => x.ok)).toEqual([true, true]); expect(row().data.week).toBe('sun');
});

test('campaign: an autosave after a teammate saved the campaign writes nothing and asks — «افتح نسخته» / «احفظ نسختي فوقها»; a stamp the server moved is mine', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'marketing'; });
  await expect.poll(() => page.evaluate(() => !!window.IBMarketing)).toBe(true);
  const row = () => mock.mkt.campaigns.find((c) => c.id === CAMP);
  expect((await page.evaluate((id) => window.IBMarketing.open(id), CAMP)).ok).toBe(true);
  await page.evaluate(() => { window.__mev = []; document.addEventListener('ib:marketing', (e) => { if (e.detail) window.__mev.push(e.detail); }); });
  // the server placed Magnific results on the saved campaign (the stamp moved, the saver is still me): my save goes
  Object.assign(row(), { updated_at: new Date(Date.now() + 1000).toISOString() });
  expect((await page.evaluate((id) => window.IBMarketing.save(id, { name: 'كولكشن الشتا ١' }), CAMP)).ok).toBe(true);
  expect(row().name).toBe('كولكشن الشتا ١');
  // a teammate saved it a moment ago: nothing is written, the page is told who
  const TEAM = '00000000-0000-4000-8000-000000000002';
  Object.assign(row(), { name: 'نسخة سارة', updated_by: TEAM, updated_at: new Date(Date.now() + 5000).toISOString() });
  const r = await page.evaluate((id) => window.IBMarketing.save(id, { name: 'نسختي' }), CAMP);
  expect(r.ok).toBe(false); expect(r.reason).toBe('stale');
  expect(row().name).toBe('نسخة سارة');
  expect(await page.evaluate(() => window.__mev.filter((d) => d.stale).map((d) => d.by))).toContain(TEAM);
  // the autosave keeps writing nothing until the member chooses
  expect((await page.evaluate((id) => window.IBMarketing.save(id, { name: 'نسختي ٢' }), CAMP)).ok).toBe(false);
  expect(row().name).toBe('نسخة سارة');
  // «احفظ نسختي فوقها»
  expect((await page.evaluate((id) => window.IBMarketing.save(id, { name: 'نسختي' }, { force: true }), CAMP)).ok).toBe(true);
  expect(row().name).toBe('نسختي');
});
