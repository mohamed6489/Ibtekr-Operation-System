import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { MKT_ID, mktToday, mktAddDays } from './mkt-mock.mjs';

// «التسويق» 9.5.2 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 29–39): the connection card and the master
// switch (the admin's), «انشر / داونلود» per piece with the JPEG copies made at «تأكيد النشر», the publishing log with the numbers and
// the platform's own posts, «انشر دلوقتي» / «احذف البوست» / a failure's reason in the post's popup, and the plan's source filter.
// Mock only (mkt-mock's mkt-publish).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const C1 = MKT_ID(1);
const TODAY = mktToday(); const Y1 = mktAddDays(TODAY, -1); const D2 = mktAddDays(TODAY, 2);
const PIECE = { id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', model: 'seedream-5-pro', idea: 'المخدة', caption: 'كابشن البوست', title: 'دفا', sub: '', badge: '', ref: [], use: [], img: C1 + '/gen-P1.png', gen: 1, approved: true };
const STATE = { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', mediaTab: 'post', media: { video: { count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 1, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
  pieces: [PIECE] };
const LIVE_POSTS = [
  { id: 1, campaign_id: C1, piece: 'P1', kind: 'بوست', name: 'دفا من السيستم', caption: 'كابشن', images: [C1 + '/gen-P1.png'], platform: 'فيسبوك', day: Y1, time: '19:00', how: 'publish', status: 'اتنشر',
    external_id: '111_91', post_url: 'https://www.facebook.com/111/posts/91', published_at: new Date(Date.now() - 86400000).toISOString(), views: 1200, reach: 900, likes: 40, comments: 5, shares: 3, eng: 48, stats_at: new Date().toISOString() },
  { id: 2, src: 'platform', kind: 'كاروسيل', name: 'بوست من الصفحة', caption: 'اتنشر من التطبيق', platform: 'انستجرام', day: Y1, time: '13:00', status: 'اتنشر', how: 'publish',
    external_id: '17890002', thumb: 'https://cdn.example.test/p.jpg', post_url: 'https://www.instagram.com/p/abc/', published_at: new Date(Date.now() - 86400000).toISOString(), views: 800, likes: 30, comments: 2, shares: 1, saves: 7, eng: 40, stats_at: new Date().toISOString() },
  { id: 3, campaign_id: C1, piece: 'P2', kind: 'بوست', name: 'بوست فشل', caption: 'كابشن', images: [C1 + '/pub-x.jpg'], platform: 'فيسبوك', day: Y1, time: '21:00', how: 'publish', status: 'فشل', error: 'token' },
  { id: 4, campaign_id: C1, piece: 'P3', kind: 'بوست', name: 'بوست مستني', caption: 'كابشن', images: [C1 + '/pub-y.jpg'], platform: 'فيسبوك', day: D2, time: '20:00', how: 'publish', status: 'مجدول' },
];
const seed = (extra = {}) => ({
  mktCampaigns: [{ id: C1, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 4, state: STATE }],
  mktObjects: { [C1 + '/gen-P1.png']: { type: 'image/png' }, [C1 + '/pub-x.jpg']: { type: 'image/jpeg' }, [C1 + '/pub-y.jpg']: { type: 'image/jpeg' } },
  ...extra,
});
let mock = null; let pageErrors = [];
async function start(page, opts) {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('https://cdn.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  mock = await installSupabaseMock(page, seed(opts));
}
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function openMarketing(page, email = ADMIN, hash = '') {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await page.locator('#pg-marketing [role=tab]', { hasText: hash || 'إنشاء' }).click(); // the page opens on «نظرة عامة» (the v6 prototype)
}
const pg = (page) => page.locator('#pg-marketing');
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });

test('9.5.2 the connection card: the platforms\' state, the switch the admin turns on (with a confirm), a member sees it only', async ({ page }) => {
  await start(page);
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C1 + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  await expect(pg(page).locator('[data-conn-pl="فيسبوك"]')).toContainText('مربوط للنشر · Ibtekr Club');
  await expect(pg(page).locator('[data-conn-pl="انستجرام"]')).toContainText('@ibtekr.club');
  await expect(pg(page).locator('[data-mk-auto]')).toHaveAttribute('data-mk-auto', 'off');
  await expect(pg(page).locator('[data-cw-pub="P1"]')).toHaveAttribute('aria-disabled', 'true');
  await pg(page).locator('[data-mk-auto-toggle]').click();
  await modal(page, 'تشغّل النشر التلقائي').getByRole('button', { name: 'شغّل النشر' }).click();
  await expect(pg(page).locator('[data-mk-auto]')).toHaveAttribute('data-mk-auto', 'on');
  expect(mock.mkt.conn.autopublish).toBe(true);
  expect(mock.mkt.calls.some((c) => c.fn === 'mkt-publish' && c.action === 'autopublish' && c.on === true)).toBe(true);
  // «انشر» can be picked now
  await expect(pg(page).locator('[data-cw-pub="P1"]')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(pg(page).locator('[data-cw-pub="P1"]')).toHaveAttribute('aria-pressed', 'true');
});

test('9.5.2 a link without the publishing permission: in «سجل النشر» with no campaign at all (decision 41) the card says it and the admin\'s «اربط تاني» opens Meta\'s dialog for the same page', async ({ page }) => {
  await start(page, { mktCampaigns: [], mktConn: { autopublish: false, facebook: { linked: true, name: 'Ibtekr Club', publish: false, insights: false } } });
  await page.route('https://www.facebook.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>meta</title>' }));
  await openMarketing(page, ADMIN, 'سجل النشر');
  await expect(pg(page).locator('[data-conn-pl="فيسبوك"]')).toContainText('مربوط — محتاج صلاحية النشر');
  await expect(pg(page).locator('[data-mk-auto-toggle]')).toContainText('شغّل النشر التلقائي'); // the switch here too
  await pg(page).locator('[data-mk-relink]').click();
  await page.waitForURL(/^https:\/\/www\.facebook\.com\/v21\.0\/dialog\/oauth\?/);
  expect(mock.metaCalls.map((c) => c.action)).toEqual(['connect_start']); // no «فصل» first: the same page linked again
});

test('9.5.2 «تأكيد النشر» with «انشر»: the JPEG copies uploaded first, Facebook and Instagram scheduled to publish, TikTok a download', async ({ page }) => {
  await start(page, { mktConn: { autopublish: true } });
  await openMarketing(page, OPS);
  await pg(page).locator('[data-mk-open="' + C1 + '"]').click();
  await expect(pg(page).locator('[data-cw-pub="P1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pg(page).locator('[data-cw-auto="P1"]')).toContainText('انستجرام · فيسبوك');
  await pg(page).locator('[data-cw-pl="P1"] .chip', { hasText: 'تيك توك' }).click();
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('سجل النشر');
  const up = mock.mkt.writes.filter((w) => w.table === 'storage:marketing' && w.op === 'upload').map((w) => w.path);
  expect(up.length).toBe(1); expect(up[0]).toMatch(new RegExp('^' + C1 + '/pub-[a-z0-9]+\\.jpg$'));
  expect(mock.mkt.objects.get(up[0]).type).toBe('image/jpeg');
  const sch = mock.mkt.calls.find((c) => c.rpc === 'mkt_schedule');
  const by = Object.fromEntries(sch.p_items.map((x) => [x.platform, x]));
  expect([by['فيسبوك'].how, by['انستجرام'].how, by['تيك توك'].how]).toEqual(['publish', 'publish', 'download']);
  expect(by['انستجرام'].images).toEqual([up[0]]); expect(by['فيسبوك'].images).toEqual([up[0]]);
  expect(by['تيك توك'].images).toEqual([C1 + '/gen-P1.png']); // a download keeps the original
  await expect(pg(page).locator('.pub-tbl tbody tr')).toHaveCount(3);
});

test('9.5.2 the log: the numbers and the platform\'s own post, the KPIs, a failure\'s reason, «انشر دلوقتي», «احذف البوست»', async ({ page }) => {
  await start(page, { mktPosts: LIVE_POSTS, mktConn: { autopublish: true } });
  await openMarketing(page, ADMIN, 'سجل النشر');
  const kpis = pg(page).locator('[data-publog-kpis]');
  await expect(kpis).toContainText('2,000'); // 1200 + 800 views
  await expect(kpis).toContainText('88'); // 48 + 40
  await expect(kpis).toContainText('4.4%');
  const plat = pg(page).locator('.pub-tbl tbody tr', { hasText: 'بوست من الصفحة' });
  await expect(plat).toContainText('من المنصة مباشرة'); await expect(plat).toContainText('800');
  await expect(plat.locator('img')).toHaveAttribute('src', 'https://cdn.example.test/p.jpg');
  // the platform's post: its numbers, «افتح على انستجرام», no download, no publishing
  await plat.locator('[data-post-row]').click();
  let m = modal(page, 'بوست من الصفحة');
  await expect(m.locator('[data-post-stats]')).toContainText('7'); // saves
  await expect(m.locator('[data-post-open]')).toHaveAttribute('href', 'https://www.instagram.com/p/abc/');
  await expect(m.locator('[data-post-dl]')).toHaveCount(0);
  await m.locator('.modal-f').getByRole('button', { name: 'إغلاق' }).click();
  // a failure: its reason in words, «انشر دلوقتي» publishes it now
  await pg(page).locator('.pub-tbl tbody tr', { hasText: 'بوست فشل' }).locator('[data-post-row]').click();
  m = modal(page, 'بوست فشل');
  await expect(m).toContainText('ربط الصفحة انتهى');
  await m.locator('[data-post-publish]').click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 3).status).toBe('اتنشر');
  await expect(pg(page).locator('.pub-tbl tbody tr', { hasText: 'بوست فشل' })).toContainText('اتنشر');
  expect(mock.mkt.calls.some((c) => c.fn === 'mkt-publish' && c.action === 'publish_now' && c.id === 3)).toBe(true);
  // a live post of the system: «احذف البوست» removes it from Facebook
  await pg(page).locator('.pub-tbl tbody tr', { hasText: 'دفا من السيستم' }).locator('[data-post-row]').click();
  m = modal(page, 'دفا من السيستم');
  await expect(m.locator('[data-post-del]')).toContainText('احذف البوست');
  await m.locator('[data-post-del]').click();
  await modal(page, 'تحذف البوست من فيسبوك').locator('[data-post-del-ok]').click();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 1).status).toBe('اتحذف');
  expect(mock.mkt.posts.find((x) => x.id === 1).was_live).toBe(true);
  // Meta refusing «انشر دلوقتي»: the row «فشل» with the reason, said in words
  mock.mkt.pubFail = 'permission';
  await pg(page).locator('.pub-tbl tbody tr', { hasText: 'بوست مستني' }).locator('[data-post-row]').click();
  await modal(page, 'بوست مستني').locator('[data-post-publish]').click();
  await expect(page.locator('.toast', { hasText: 'صلاحية النشر' })).toBeVisible();
  await expect.poll(() => mock.mkt.posts.find((x) => x.id === 4).status).toBe('فشل');
});

test('9.5.2 the plan: the platform\'s own posts with «من المنصة مباشرة», the source filter; only the system\'s waiting posts move', async ({ page }) => {
  await start(page, { mktPosts: LIVE_POSTS });
  await openMarketing(page, ADMIN, 'الخطة الإعلانية');
  await expect(pg(page).locator('[data-cal-src="platform"]')).toHaveCount(1);
  await expect(pg(page).locator('[data-cal-src="platform"][data-cal-move]')).toHaveCount(0);
  await expect(pg(page).locator('[data-cal-it="4"][data-cal-move]')).toHaveCount(1);
  await pg(page).locator('[data-cal-src-filter] [data-src="system"]').click();
  await expect(pg(page).locator('[data-cal-src="platform"]')).toHaveCount(0);
  await pg(page).locator('[data-cal-src-filter] [data-src="platform"]').click();
  await expect(pg(page).locator('[data-cal-src="system"]')).toHaveCount(0);
  await expect(pg(page).locator('[data-cal-src="platform"]')).toHaveCount(1);
});
