import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { MKT_ID, MKT_TPL, mktToday, mktAddDays } from './mkt-mock.mjs';

// «التسويق» on our data (phase 9.5.1, docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md): the v5's page on IBMarketing (0049)
// — «إنشاء» first, the soon tabs, «آخر الشغل» from the database; the campaign in four steps (the AI writing, an image with its cost
// first, the review, the schedule); the publishing log (mark published, move, delete, the caption); the plan calendar; the
// templates; the permissions and the month's cap; and no idea / caption text in activity_log. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const C1 = MKT_ID(1); const T1 = MKT_TPL(1);
const TODAY = mktToday(); const D2 = mktAddDays(TODAY, 2); const D3 = mktAddDays(TODAY, 3);
const STATE = { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا القديم', mediaTab: 'post', media: { video: { count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 1, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
  pieces: [{ id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', model: 'seedream-5-pro', idea: 'المخدة', caption: 'كابشن قديم', title: 'دفا', sub: '', badge: '', ref: [], use: [], img: C1 + '/gen-P1-old.png', gen: 1, approved: true }] };
const SEED = {
  mktCampaigns: [{ id: C1, name: 'كولكشن الشتا القديم', goal: 'منتج جديد', step: 4, state: STATE, scheduled_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString() }],
  mktPosts: [
    { id: 1, campaign_id: C1, piece: 'P1', kind: 'بوست', name: 'دفا', caption: 'كابشن قديم', caption_orig: 'كابشن قديم', tags: '#إبتكر', images: [C1 + '/gen-P1-old.png'], platform: 'فيسبوك', day: D2, time: '19:00', status: 'مجدول' },
    { id: 2, campaign_id: C1, piece: 'P1', kind: 'بوست', name: 'دفا', caption: 'كابشن قديم', caption_orig: 'كابشن قديم', tags: '#إبتكر', images: [C1 + '/gen-P1-old.png'], platform: 'انستجرام', day: D2, time: '20:00', status: 'مجدول' }],
  mktTemplates: [{ id: T1, name: 'منتج على كريمي', kind: 'post', image: 'templates/t1.png', descr: 'المنتج في النص على خلفية كريمي', used: 2 }],
  mktObjects: { ['templates/t1.png']: { type: 'image/png' }, [C1 + '/gen-P1-old.png']: { type: 'image/png' } },
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
async function signIn(page, email) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function openMarketing(page, email = ADMIN) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const pg = (page) => page.locator('#pg-marketing');

test('«التسويق» is open: «إنشاء» first, the assistants\' soon tab (overview and reports opened in 9.5.3 — marketing-ads.spec), «آخر الشغل» from the database with its status', async ({ page }) => {
  await openMarketing(page);
  await expect(page.locator('.sidebar .nav-item[data-page="marketing"]')).not.toHaveAttribute('data-soon', '');
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('إنشاء');
  await expect(pg(page).locator('[data-mk-start]')).toBeVisible();
  const row = pg(page).locator('tr', { hasText: 'كولكشن الشتا القديم' });
  await expect(row).toContainText('اتجدولت');
  await expect(pg(page).locator('[role=tab] [data-soon]')).toHaveCount(0); // 9.5.4: every tab is open
  await pg(page).getByRole('tab', { name: /مساعدين الذكاء الاصطناعي/ }).click();
  await expect(pg(page).locator('[data-mk-chat]')).toBeVisible();
});

test('a new campaign: the details (the row created) → the AI fills the piece → its image with the cost first → the review → the schedule → the log', async ({ page }) => {
  await openMarketing(page);
  await pg(page).locator('[data-mk-start]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('تفاصيل الكامبين');
  await expect(pg(page).locator('[data-cw-media] ~ *, .subtab', { hasText: 'فيديو' }).first()).toContainText('قريبًا');
  // the idea is required
  await pg(page).locator('.cp-next').click();
  await expect(pg(page)).toContainText('اكتب الفكرة العامة');
  await pg(page).locator('#cw-idea').fill('كولكشن الربيع — شنط مكرمية مشغولة يدويًا');
  await pg(page).locator('[data-num="cw-n-post-"]').click(); // 2 → 1 post
  await pg(page).locator('.subtab', { hasText: 'كاروسيل' }).click();
  await pg(page).locator('[data-num="cw-n-carousel-"]').click(); // 1 → 0 carousels
  await expect(pg(page).locator('[data-cw-est]')).toHaveAttribute('data-cw-est', '75');
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect.poll(() => mock.mkt.campaigns.length).toBe(2);
  const made = mock.mkt.campaigns.find((c) => c.id !== C1);
  expect(made.name).toBe('كولكشن الربيع — شنط مكرمية مشغولة يدويًا');
  // «املأ بالـ AI» fills the empty fields (no credit)
  await pg(page).locator('[data-cw-fill="P1"]').click();
  await expect(pg(page).locator('#b-P1-t')).toHaveValue('دفا الشتا');
  expect(mock.mkt.calls.some((c) => c.fn === 'ai-content' && c.task === 'fill' && c.piece === 'P1')).toBe(true);
  // «إعادة كتابة بالـ AI» on the subheadline, then «تراجع»
  await pg(page).locator('#b-P1-s').fill('قديم');
  await pg(page).locator('[data-ai-rw="b-P1-s"]').click();
  await expect(pg(page).locator('#b-P1-s')).toHaveValue('كولكشن الشتا وصل');
  await pg(page).locator('[data-ai-undo="b-P1-s"]').click();
  await expect(pg(page).locator('#b-P1-s')).toHaveValue('قديم');
  // the image: the cost first, then the path in the piece
  await pg(page).locator('[data-cw-gen="P1"]').click();
  const cost = modal(page, 'توليد الصورة');
  await expect(cost.locator('[data-cw-cost]')).toHaveAttribute('data-cw-cost', '75');
  await expect(cost).toContainText('5,000 كريديت');
  await cost.getByRole('button', { name: /ولّد/ }).click();
  await expect(pg(page).locator('[data-cw-built]')).toHaveAttribute('data-cw-built', '1/1');
  const gen = mock.mkt.calls.find((c) => c.action === 'campaign');
  expect([gen.piece, gen.model]).toEqual(['P1', 'seedream-5-pro']);
  await expect.poll(() => (mock.mkt.campaigns.find((c) => c.id === made.id).state.pieces || [{}])[0].img || '').toMatch(new RegExp('^' + made.id + '/gen-P1-'));
  await expect(pg(page).locator('.cw-wallet')).toHaveAttribute('data-cw-balance', '4925');
  // the review
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('المراجعة');
  await pg(page).locator('[data-cw-ok="بوست 1"]').click();
  await expect(pg(page).locator('[data-cw-approved]')).toHaveAttribute('data-cw-approved', '1/1');
  await pg(page).locator('.cp-next').click();
  // the schedule (9.5.2: the page is linked, the switch is off → «انشر» can't be picked, every row a download), the platforms, the confirm
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  await expect(pg(page).locator('[data-conn-pl="تيك توك"]')).toContainText('مش مربوط — داونلود بس');
  await expect(pg(page).locator('[data-conn-pl="فيسبوك"]')).toContainText('مربوط للنشر');
  await expect(pg(page).locator('[data-mk-auto]')).toHaveAttribute('data-mk-auto', 'off');
  await expect(pg(page).locator('[data-cw-pub="P1"]')).toHaveAttribute('aria-disabled', 'true');
  await pg(page).locator('[data-cw-pl="P1"] .chip', { hasText: 'تيك توك' }).click();
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('سجل النشر');
  const sch = mock.mkt.calls.find((c) => c.rpc === 'mkt_schedule');
  expect(sch.p_items.map((x) => x.platform).sort()).toEqual(['انستجرام', 'تيك توك', 'فيسبوك'].sort());
  expect(sch.p_items.every((x) => x.how === 'download')).toBe(true);
  expect(sch.p_items[0].images[0]).toMatch(new RegExp('^' + made.id + '/gen-P1-'));
  await expect(pg(page).locator('.pub-tbl tbody tr')).toHaveCount(5);
  // nothing of the member's words reached activity_log
  const logs = JSON.stringify(mock.activityRows.filter((r) => String(r.action).startsWith('mkt.')));
  expect(logs).toContain('mkt.campaign.schedule');
  for (const secret of ['الربيع', 'مكرمية', 'كولكشن', 'قديم']) expect(logs).not.toContain(secret);
});

test('the log: the caption saved as it is typed, «أجّل» to a new hour, «علّمه اتنشر» with a link, «احذف» a waiting one', async ({ page }) => {
  await openMarketing(page);
  await pg(page).getByRole('tab', { name: 'سجل النشر' }).click();
  await expect(pg(page).locator('[data-publog-kpis]')).toContainText('مجدول');
  await pg(page).locator('[data-post-row="1"]').click();
  const pop = modal(page, 'دفا — فيسبوك');
  await pop.locator('#pp-cap').fill('كابشن جديد للبوست');
  await expect(pop.locator('[data-cap-state]')).toContainText('اتحفظ');
  expect(mock.mkt.posts.find((x) => x.id === 1).caption).toBe('كابشن جديد للبوست');
  await pop.locator('[data-post-move]').click();
  const mv = modal(page, 'دفا — فيسبوك');
  await mv.locator('#pp-time').click(); await page.locator('[role=listbox] [role=option]', { hasText: '21:00' }).first().click();
  await mv.locator('[data-post-move-save]').click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 1).time).toBe('21:00');
  const again = modal(page, 'دفا — فيسبوك');
  await again.locator('[data-post-published]').click();
  const mark = modal(page, 'اتنشر على فيسبوك');
  await mark.locator('#url').fill('javascript:alert(1)');
  await mark.getByRole('button', { name: 'علّمه اتنشر' }).click();
  await expect(mark).toContainText('اللينك لازم يبدأ بـ https://');
  await mark.locator('#url').fill('https://facebook.com/ibtekr/posts/1');
  await mark.getByRole('button', { name: 'علّمه اتنشر' }).click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 1).status).toBe('اتنشر');
  expect(mock.mkt.posts.find((x) => x.id === 1).post_url).toBe('https://facebook.com/ibtekr/posts/1');
  // delete the waiting Instagram one
  await pg(page).locator('[data-post-row="2"]').click();
  await modal(page, 'دفا — انستجرام').locator('[data-post-del]').click();
  await modal(page, 'تحذف البوست المجدول').locator('[data-post-del-ok]').click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 2).status).toBe('اتحذف');
  const logs = JSON.stringify(mock.activityRows.filter((r) => String(r.action).startsWith('mkt.post.')));
  expect(logs).toContain('mkt.post.published'); expect(logs).not.toContain('كابشن جديد');
});

test('the plan calendar: the waiting posts in their week; dragging one to another day asks «أجّل لـ …» and moves it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 }); // the post and the day it goes to on the screen together (the mouse works in the viewport)
  await openMarketing(page);
  await pg(page).getByRole('tab', { name: 'الخطة الإعلانية' }).click();
  const it = pg(page).locator('[data-cal-it="1"]');
  await expect(it).toBeVisible();
  await expect(pg(page).locator('[data-cal-day="' + D2 + '"]')).toContainText('دفا');
  const target = pg(page).locator('[data-cal-day="' + D3 + '"]');
  test.skip(!(await target.count()), 'the day after is out of the default period');
  await it.scrollIntoViewIfNeeded();
  const a = await it.boundingBox(); const b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 30, { steps: 8 }); await page.mouse.up();
  const ask = page.locator('.modal[role=dialog][data-move="1"]');
  await expect(ask).toBeVisible();
  await ask.locator('[data-move-ok]').click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 1).day).toBe(D3);
});

test('the templates: a new one with an upload and «اشرحها بالـ AI»; picked in a campaign\'s examples it counts', async ({ page }) => {
  await openMarketing(page);
  await pg(page).getByRole('tab', { name: 'قوالب التصميم' }).click();
  await expect(pg(page).locator('[data-tpl="' + T1 + '"]')).toContainText('منتج على كريمي');
  await pg(page).locator('[data-tpl-add]').click();
  const f = modal(page, 'قالب تصميم جديد');
  await f.locator('#tpl-up').setInputFiles({ name: 'carousel-boho.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await f.locator('[data-kind="carousel"]').click();
  await f.locator('[data-tpl-ai]').click();
  await expect(f.locator('#desc')).toHaveValue(/المنتج في النص/);
  await f.getByRole('button', { name: 'احفظ القالب' }).click();
  await expect.poll(() => mock.mkt.templates.length).toBe(2);
  const t = mock.mkt.templates.find((x) => x.id !== T1);
  expect([t.kind, /^templates\//.test(t.image)]).toEqual(['carousel', true]);
  expect(mock.mkt.calls.some((c) => c.fn === 'ai-content' && c.task === 'describe')).toBe(true);
  // a campaign picks the post template from «أمثلة للمطابقة»
  await pg(page).getByRole('tab', { name: 'إنشاء' }).click();
  await pg(page).locator('[data-mk-start]').click();
  await pg(page).locator('[data-tpl-from="cw-ref-post"]').click();
  await modal(page, 'اختار قالب تصميم').locator('[data-tpl-pick="' + T1 + '"]').click();
  await expect(pg(page).locator('[data-cw-files="cw-ref-post"]')).toContainText('قالب: منتج على كريمي');
  await expect.poll(() => mock.mkt.templates.find((x) => x.id === T1).used).toBe(3);
});

test('permissions and the cap: a member without marketing.view gets no page; over the month\'s cap the image is refused before any call', async ({ page }) => {
  await openMarketing(page, ACCOUNTS);
  await expect(pg(page)).toContainText('مفيش صلاحية');
  await page.evaluate(() => window.IBAuth && window.IBAuth.signOut && window.IBAuth.signOut());
  mock.mkt.cap = 100; mock.mkt.used = 60; // 40 left, an image is 75
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C1 + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  await pg(page).locator('.wstepper .stp-b', { hasText: 'البناء' }).click();
  await pg(page).locator('[data-cw-gen="P1"]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('مش كفاية');
  expect(mock.mkt.calls.some((c) => c.action === 'campaign')).toBe(false);
});
