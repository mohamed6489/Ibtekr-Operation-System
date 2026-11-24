import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { MKT_ID, mktToday, mktAddDays } from './mkt-mock.mjs';

// The meeting of 23 Nov — phase 8 [#43] (docs/superpowers/plans/2026-11-23-meeting.md; 0156): the pictures in «سجل النشر» ·
// «الخطة الإعلانية» · «تفاصيل الأعمال الفنية» · «الكامبين الجديدة» · «قوالب التصميم» actually load (naturalWidth > 0). The cause on the
// live data: the platform's posts and the ads kept Meta's CDN link, signed for a few days (dead on 23 Nov) — the server now keeps a copy
// in the bucket (thumb_path) and the page shows it; a picture that still does not load is the empty frame, never a broken image.
const ADMIN = 'admin.dev@ibtekr.local';
const C1 = MKT_ID(1); const T1 = MKT_ID(51);
const TODAY = mktToday(); const Y1 = mktAddDays(TODAY, -1); const D = (n) => mktAddDays(TODAY, n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DEAD = 'https://scontent-fra5-1.cdninstagram.com/v/dead.jpg?oe=6923A000'; // Meta's link after its `oe`
const PIECE = { id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', model: 'seedream-5-pro', idea: 'المخدة', caption: 'كابشن البوست', title: 'دفا', sub: '', badge: '', ref: [], use: [], img: C1 + '/gen-P1.png', gen: 1, approved: true };
const STATE = { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', mediaTab: 'post', media: { video: { count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 1, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } } }, pieces: [PIECE] };
const now = new Date().toISOString();
const POSTS = [
  { id: 1, campaign_id: C1, piece: 'P1', kind: 'بوست', name: 'دفا من السيستم', caption: 'كابشن', images: [C1 + '/gen-P1.png'], platform: 'فيسبوك', day: Y1, time: '19:00', how: 'publish', status: 'اتنشر', external_id: '111_91', published_at: now },
  // the platform's post: Meta's link is dead, the server's copy is in the bucket
  { id: 2, src: 'platform', kind: 'بوست', name: 'بوست من الصفحة', caption: '', platform: 'انستجرام', day: Y1, time: '13:00', status: 'اتنشر', how: 'publish', external_id: '17890002', thumb: DEAD, thumb_path: 'platform/ig/17890002.jpg', published_at: now },
  // an older one the server could not keep yet: the empty frame, not a broken picture
  { id: 3, src: 'platform', kind: 'بوست', name: 'بوست قديم', caption: '', platform: 'فيسبوك', day: D(-3), time: '10:00', status: 'اتنشر', how: 'publish', external_id: '111_77', thumb: DEAD, published_at: now },
];
const CA = '120252323303340228';
const OBJECTS = [
  { kind: 'account', id: '1122334455', name: 'Ibtekr Club', status: 'ACTIVE' },
  { kind: 'campaign', id: CA, parent_id: '1122334455', name: 'Macrame', status: 'ACTIVE' },
  { kind: 'ad', id: '1206', parent_id: CA, name: 'Macrame carousel', status: 'ACTIVE', thumb: DEAD, thumb_path: 'ads/meta/1206.jpg' },
  { kind: 'ad', id: '1207', parent_id: CA, name: 'Macrame video', status: 'ACTIVE', thumb: DEAD },
];
const st = (level, id, day, spend) => ({ level, object_id: id, campaign_id: CA, day, spend, impressions: 1000, clicks: 30, link_clicks: 20, frequency: 1.5, purchases: 1, purchase_value: 900 });
const STATS = [st('campaign', CA, D(-1), 500), st('ad', '1206', D(-1), 300), st('ad', '1207', D(-1), 200)];
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('https://scontent-fra5-1.cdninstagram.com/**', (r) => r.fulfill({ status: 403, contentType: 'text/plain', body: 'URL signature expired' }));
  mock = await installSupabaseMock(page, {
    mktCampaigns: [{ id: C1, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 2, state: STATE }], mktPosts: POSTS,
    mktTemplates: [{ id: T1, name: 'منتج على كريمي', kind: 'post', image: 'templates/t1.png', descr: 'المنتج في النص', used: 2 }],
    mktObjects: { [C1 + '/gen-P1.png']: { type: 'image/png' }, 'platform/ig/17890002.jpg': { type: 'image/jpeg' }, 'ads/meta/1206.jpg': { type: 'image/jpeg' }, 'templates/t1.png': { type: 'image/png' } },
    mktAdObjects: OBJECTS, mktAdStats: STATS,
  });
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function openTab(page, label) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await page.locator('#pg-marketing [role=tab]', { hasText: label }).click();
}
// every picture in the scope loaded (naturalWidth > 0) — none left broken or loading
async function allLoaded(scope, min) {
  await scope.locator('img').evaluateAll((l) => l.forEach((i) => i.scrollIntoView())); // the pictures load lazily — bring each into view
  await expect.poll(async () => scope.locator('img').evaluateAll((l) => l.filter((i) => i.complete && i.naturalWidth > 0).length), { timeout: 8000 }).toBeGreaterThanOrEqual(min);
  const bad = await scope.locator('img').evaluateAll((l) => { l.forEach((i) => i.scrollIntoView()); return l.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src') || i.dataset.mkPath || '?'); });
  await expect.poll(async () => scope.locator('img').evaluateAll((l) => l.filter((i) => !(i.complete && i.naturalWidth > 0)).length), { timeout: 8000, message: 'broken: ' + bad.join(', ') }).toBe(0);
}

test('#43 «سجل النشر»: the system post from the bucket, the platform\'s post from the server\'s copy (Meta\'s link dead), the older one the empty frame — every picture loaded', async ({ page }) => {
  await openTab(page, 'سجل النشر');
  const pg = page.locator('#pg-marketing');
  await expect(pg.locator('[data-post-row="2"] img')).toHaveAttribute('data-mk-path', 'platform/ig/17890002.jpg');
  await expect(pg.locator('[data-post-row="3"] [data-mk-noimg]')).toBeVisible(); // the dead link → the frame
  await allLoaded(pg, 2);
  expect(mock.requests.filter((r) => /sign\/marketing/.test(r)).length).toBeGreaterThan(0);
});

test('#43 «الخطة الإعلانية»: the week\'s posts with their pictures loaded', async ({ page }) => {
  await openTab(page, 'الخطة الإعلانية');
  const pg = page.locator('#pg-marketing');
  await expect(pg).toContainText('بوست من الصفحة');
  await allLoaded(pg, 0);
});

test('#43 «تفاصيل الأعمال الفنية»: the ad\'s picture from the server\'s copy, the one without a copy the empty frame', async ({ page }) => {
  await openTab(page, 'التقارير');
  const card = page.locator('#pg-marketing section.card', { hasText: 'تفاصيل الأعمال الفنية' });
  await expect(card).toContainText('Macrame carousel');
  await expect(card.locator('img[data-mk-path="ads/meta/1206.jpg"]')).toHaveCount(1);
  await expect(card.locator('[data-mk-noimg]')).toHaveCount(1);
  await allLoaded(card, 1);
});

test('#43 «الكامبين الجديدة»: the generated picture loaded', async ({ page }) => {
  await openTab(page, 'إنشاء');
  const pg = page.locator('#pg-marketing');
  await pg.locator('[data-mk-open="' + C1 + '"]').click();
  await expect(pg.locator('img[data-mk-path="' + C1 + '/gen-P1.png"]').first()).toBeVisible();
  await allLoaded(pg, 1);
});

test('#43 «قوالب التصميم»: the template\'s picture loaded', async ({ page }) => {
  await openTab(page, 'قوالب التصميم');
  const box = page.locator('#pg-marketing [data-tpl="' + T1 + '"]');
  await expect(box.locator('img')).toHaveCount(1);
  await allLoaded(box, 1);
});

test('#43 a signed link that expired while the page stayed open asks for a fresh one once, then loads', async ({ page }) => {
  let failed = 0;
  await page.route('**/storage/v1/object/sign/marketing/templates/t1.png?token=*', async (r) => { if (failed === 0) { failed += 1; return r.fulfill({ status: 400, body: 'expired' }); } return r.fallback(); });
  await openTab(page, 'قوالب التصميم');
  const box = page.locator('#pg-marketing [data-tpl="' + T1 + '"]');
  await allLoaded(box, 1);
  expect(failed).toBe(1);
});
