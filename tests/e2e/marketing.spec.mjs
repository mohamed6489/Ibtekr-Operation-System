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
async function openMarketing(page, email = ADMIN, open = true) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  if (open) await page.locator('#pg-marketing').getByRole('tab', { name: /إنشاء/ }).click(); // the page opens on «نظرة عامة» (the v6 prototype)
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const pg = (page) => page.locator('#pg-marketing');

test('«التسويق» is open on «نظرة عامة» (the v6 prototype), «إنشاء» second with «آخر الشغل» from the database with its status; every tab open', async ({ page }) => {
  await openMarketing(page, ADMIN, false);
  await expect(page.locator('.sidebar .nav-item[data-page="marketing"]')).not.toHaveAttribute('data-soon', '');
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('نظرة عامة');
  await expect(page).toHaveURL(/#marketing(-overview)?$/);
  await pg(page).getByRole('tab', { name: /إنشاء/ }).click();
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('إنشاء');
  await expect(pg(page).locator('[data-mk-start]')).toBeVisible();
  // ش36 (the owner 17 Nov): the card reads «إنشاء محتوى» and spans the page as wide as «آخر الشغل»
  await expect(pg(page).locator('[data-mk-start] .tc-t')).toHaveText('إنشاء محتوى');
  const [cw, tw] = await Promise.all([pg(page).locator('[data-mk-start]').evaluate((n) => n.getBoundingClientRect().width), pg(page).locator('.card', { hasText: 'آخر الشغل' }).first().evaluate((n) => n.getBoundingClientRect().width)]);
  expect(Math.abs(cw - tw)).toBeLessThanOrEqual(2);
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
  await expect(pg(page).locator('.subtab', { hasText: 'فيديو' })).not.toContainText('قريبًا'); // 9.5.5: the video is open
  // the idea is required
  await pg(page).locator('.cp-next').click();
  await expect(pg(page)).toContainText('اكتب الفكرة العامة');
  await pg(page).locator('#cw-idea').fill('كولكشن الربيع — شنط مكرمية مشغولة يدويًا');
  await expect(pg(page)).not.toContainText('ملفات إضافية'); // the owner 13 Nov: no extra files on a new campaign
  await pg(page).locator('[data-num="cw-n-post-"]').click(); // 2 → 1 post
  await pg(page).locator('.subtab', { hasText: 'كاروسيل' }).click();
  await pg(page).locator('[data-num="cw-n-carousel-"]').click(); // 1 → 0 carousels
  await expect(pg(page).locator('[data-cw-est]')).toHaveAttribute('data-cw-est', '75');
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect.poll(() => mock.mkt.campaigns.length).toBe(2);
  const made = mock.mkt.campaigns.find((c) => c.id !== C1);
  expect(made.name).toBe('كولكشن الربيع — شنط مكرمية مشغولة يدويًا');
  // comments decision 28 (the owner 15 Nov — «مجرد ما ادوس هنا عايز كل الكونتنت و الافكار تتكتب بال ai»): «متابعة للبناء» fills the
  // pieces' empty texts with the AI by itself (no credit) — no «املأ بالـ AI» press, no instructions popup
  const fills = () => mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.task === 'fill' && c.piece === 'P1');
  await expect(pg(page).locator('#b-P1-t')).toHaveValue('دفا الشتا');
  await expect(pg(page).locator('#b-P1-idea')).not.toHaveValue('');
  await expect(pg(page).locator('[data-cw-autofill]')).toHaveCount(0);
  expect(fills().length).toBe(1); expect(fills()[0].notes || '').toBe('');
  await expect(page.locator('[data-ai-go]')).toHaveCount(0);
  // «املأ بالـ AI» is still on the piece (the instructions popup first, the owner 15 Nov): what is written stays
  await pg(page).locator('#b-P1-t').fill('عنواني');
  await pg(page).locator('[data-cw-fill="P1"]').click(); await page.locator('[data-ai-go]').click();
  await expect.poll(() => fills().length).toBe(2);
  await expect(pg(page).locator('#b-P1-t')).toHaveValue('عنواني');
  await page.mouse.move(0, 0); // off the fields: the sparkle's look below is its resting one
  // «إعادة كتابة بالـ AI» on the subheadline, then «تراجع»
  await pg(page).locator('#b-P1-s').fill('قديم');
  // the owner 15 Nov: the sparkle has no background and is green; under the pointer a green round with a beige icon
  const rw = pg(page).locator('[data-ai-rw="b-P1-s"]');
  const look = () => rw.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
  expect(await look()).toEqual(['rgba(0, 0, 0, 0)', 'rgb(0, 86, 66)']);
  await rw.hover();
  await expect.poll(look).toEqual(['rgb(0, 86, 66)', 'rgb(255, 247, 239)']);
  await pg(page).locator('[data-ai-rw="b-P1-s"]').click(); await page.fill('#ai-ask-notes', 'أقصر'); await page.locator('[data-ai-go]').click();
  await expect(pg(page).locator('#b-P1-s')).toHaveValue('كولكشن الشتا وصل');
  expect(mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.task === 'rewrite').pop().notes).toBe('أقصر'); // the member's instructions reach the server
  await pg(page).locator('[data-ai-undo="b-P1-s"]').click();
  await expect(pg(page).locator('#b-P1-s')).toHaveValue('قديم');
  // the owner 16 Nov: «توليد» / «ارفع صورة» sit under the image box, and the box takes the chosen size's ratio (1080×1350 → 4:5)
  const piece = pg(page).locator('[data-cw-piece="P1"]');
  await expect(piece.locator('.cw-media [data-cw-media-acts] [data-cw-gen="P1"]')).toBeVisible();
  const box = await piece.locator('.cw-media .cw-pv').evaluate((el) => { const r = el.getBoundingClientRect(); return { ar: el.getAttribute('data-cw-ar'), ratio: r.width / r.height }; });
  expect(box.ar).toMatch(/^\d+ \/ \d+$/);
  const [aw, ah] = box.ar.split(' / ').map(Number); expect(Math.abs(box.ratio - aw / ah)).toBeLessThan(0.02);
  const btnTop = await piece.locator('[data-cw-gen="P1"]').evaluate((el) => el.getBoundingClientRect().top);
  const boxBottom = await piece.locator('.cw-media .cw-pv').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(btnTop).toBeGreaterThanOrEqual(boxBottom - 1);
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

// 15 Nov: the AI texts of a «فيديو» piece itself were refused on the server (400 «piece» — the writing asked for an image target, and a
// video piece with no scene has none): «فكرة الفيديو» rewritten, and «املأ بالـ AI» fills its idea and caption only
// comments decisions 62–64 (the owner 15 Nov — «غير كلمة تعديل لتعديل علي الصورة» · «حط margin ما بينهم» · «طبق كومنت تعديل زرار تعديل علي كل
// الصفحة دي»): the review's button on every picture — a post, a carousel's cover, each of its pictures — reads «تعديل على الصورة» and
// opens the pins popup under that name; a carousel's pictures are boxes with a gap between them (they stood on each other)
test('comments 62–64 — the review: «تعديل على الصورة» on every picture, and a carousel\'s pictures apart from each other', async ({ page }) => {
  const C2 = MKT_ID(2); const img = (n) => C2 + '/gen-' + n + '.png';
  const piece = (o) => Object.assign({ size: '1080x1350', model: 'seedream-5-pro', idea: 'المخدة', caption: 'كابشن', title: 'دفا', sub: '', badge: '', ref: [], use: [], gen: 1, approved: false }, o);
  const state = { w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', mediaTab: 'post', media: { video: { count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 1, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 1, slides: 3, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [piece({ id: 'P1', kind: 'بوست', n: 1, img: img('P1'), pins: [{ x: 40, y: 40, text: 'كبّر اللوجو' }] }),
      piece({ id: 'C1', kind: 'كاروسيل', n: 1, img: img('C1'), slides: [0, 1, 2].map((k) => ({ idea: 'تفصيلة ' + (k + 1), title: 'شريحة ' + (k + 1), sub: '', badge: '', ref: [], use: [], img: img('C1-' + k), approved: false })) })], sched: {}, rtab: 'post' };
  const now = new Date().toISOString();
  mock.mkt.campaigns.push({ id: C2, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 3, state, scheduled_at: null, created_by: null, created_at: now, updated_by: null, updated_at: now, archived_at: null, archived_by: null });
  ['P1', 'C1', 'C1-0', 'C1-1', 'C1-2'].forEach((n) => { mock.mkt.objects[img(n)] = { type: 'image/png' }; });
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C2 + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('المراجعة');
  // the post: the button's new name, and the note about its saved pins names it too
  const post = pg(page).locator('[data-cw-rev="P1"]');
  await expect(post.locator('[data-cw-edit]')).toHaveText('تعديل على الصورة');
  await expect(post).toContainText('«تعديل على الصورة» عشان تولّد بيهم');
  await post.locator('[data-cw-edit]').click();
  const m = modal(page, 'تعديل على الصورة — بوست 1');
  await expect(m).toBeVisible();
  await expect(m.locator('[data-cw-regen]')).toBeVisible();
  await m.getByRole('button', { name: 'إلغاء' }).click();
  // the carousel: the cover and its three pictures — the same name on each, no bare «تعديل» left on the page
  await pg(page).locator('.subtab', { hasText: 'الكاروسيلز' }).click();
  const car = pg(page).locator('section[data-cw-rev="C1"]');
  await expect(car.locator('[data-cw-edit]')).toHaveText(['تعديل على الصورة', 'تعديل على الصورة', 'تعديل على الصورة', 'تعديل على الصورة']);
  await expect(pg(page).getByRole('button', { name: 'تعديل', exact: true })).toHaveCount(0);
  // the pictures are apart: each one a box of its own, 12px or more between two of them, and between the cover and the first
  const boxes = await car.locator('.cw-slide').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), getComputedStyle(el).borderTopWidth]; }));
  expect(boxes.length).toBe(4);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i][0] - boxes[i - 1][1]).toBeGreaterThanOrEqual(12);
  expect(boxes.every((b) => b[2] === '1px')).toBe(true);
  // the build step's carousel uses the same boxes
  await pg(page).locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  const built = await pg(page).locator('[data-cw-piece="C1"] .cw-slide').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }));
  expect(built.length).toBe(3);
  for (let i = 1; i < built.length; i++) expect(built[i][0] - built[i - 1][1]).toBeGreaterThanOrEqual(12);
});

test('a video piece\'s own texts: «إعادة كتابة بالـ AI» on «فكرة الفيديو» (the instructions popup first, «تراجع»), and «املأ بالـ AI» fills its empty caption — the written idea stays, no headline or badge lands on the piece', async ({ page }) => {
  const C2 = MKT_ID(2);
  const state = { w: { goal: 'منتج جديد', idea: 'ريل لمخدة بوهيمي', mediaTab: 'video', media: { video: { count: 1, size: '9:16', dur: 10, model: 'seedance-2.5', notes: 'حركة هادية', use: [], ref: [] }, post: { count: 0, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', model: 'seedance-2.5', dur: 10, res: '1080p', sceneCount: 2, method: 'separate', idea: 'المخدة', caption: '', title: '', sub: '', badge: '', ref: [], use: [], img: null, gen: 0, approved: false, clips: 0, assembled: false, video: null,
      music: { src: 'none', type: '', file: '' }, voice: { mode: 'none', voice: 'm-eg-1', text: '', file: '' }, scenes: [] }], sched: {}, rtab: 'video' };
  const now = new Date().toISOString();
  mock.mkt.campaigns.push({ id: C2, name: 'ريل الشتا', goal: 'منتج جديد', step: 2, state, scheduled_at: null, created_by: null, created_at: now, updated_by: null, updated_at: now, archived_at: null, archived_by: null });
  const saved = () => mock.mkt.campaigns.find((c) => c.id === C2).state.pieces[0];
  const seen = []; mock.mkt.aiAnswer = (req, target) => { seen.push([req.task, target && target.label, target && target.kind]); return req.task === 'fill' ? { idea: 'ريل للمخدة في قعدة دافية', caption: 'الدفا وصل إبتكر ✨', title: 'دفا الشتا', sub: 'مشغولة يدويًا', badge: 'جديد' } : { text: 'ريل قصير للمخدة البوهيمي جنب الشباك' }; };
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C2 + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect(pg(page).locator('#b-V1-idea')).toHaveValue('المخدة');
  // «فكرة الفيديو»: the popup first, then the server's text in the field (it was «الـ AI ماردش» / a 400 before)
  await pg(page).locator('[data-ai-rw="b-V1-idea"]').click(); await page.fill('#ai-ask-notes', 'أقصر'); await page.locator('[data-ai-go]').click();
  await expect(pg(page).locator('#b-V1-idea')).toHaveValue('ريل قصير للمخدة البوهيمي جنب الشباك');
  const rw = mock.mkt.calls.filter((c) => c.fn === 'ai-content' && c.task === 'rewrite').pop();
  expect([rw.piece, rw.slide, rw.kind, rw.notes]).toEqual(['V1', null, 'idea', 'أقصر']);
  await expect.poll(() => saved().idea).toBe('ريل قصير للمخدة البوهيمي جنب الشباك');
  await pg(page).locator('[data-ai-undo="b-V1-idea"]').click();
  await expect(pg(page).locator('#b-V1-idea')).toHaveValue('المخدة');
  // «املأ بالـ AI»: the empty caption only — the idea is written already, and a video piece takes no headline / subheadline / badge
  await pg(page).locator('[data-cw-fill="V1"]').click(); await page.locator('[data-ai-go]').click();
  await expect(pg(page).locator('#b-V1-cap')).toHaveValue('الدفا وصل إبتكر ✨');
  await expect(pg(page).locator('#b-V1-idea')).toHaveValue('المخدة');
  expect(mock.mkt.calls.some((c) => c.fn === 'ai-content' && c.task === 'fill' && c.piece === 'V1')).toBe(true);
  await expect.poll(() => [saved().idea, saved().caption, saved().title, saved().sub, saved().badge]).toEqual(['المخدة', 'الدفا وصل إبتكر ✨', '', '', '']);
  expect(seen).toEqual([['rewrite', 'فيديو 1', 'فيديو'], ['fill', 'فيديو 1', 'فيديو']]); // the server's target: the video piece itself
  // its image is still no piece of the server's: the key frames are the scenes' (no generate button on the piece itself)
  await expect(pg(page).locator('[data-cw-gen="V1"]')).toHaveCount(0);
});

test('the owner 15 Nov — «السيستم مش قابل اي لينكات»: any https link in «فايلز أو لينكات» — a Pinterest pin becomes a picture of the campaign (the server fetches it); a page with no picture, an http link and an unknown SKU are refused with their reason; a site product link stays a product', async ({ page }) => {
  await openMarketing(page);
  await pg(page).locator('[data-mk-start]').click();
  await pg(page).locator('#cw-idea').fill('كولكشن المكرمية');
  const ref = pg(page).locator('[data-cw-files="cw-ref-post"]'); const box = pg(page).locator('#cw-ref-post-l');
  await expect(box).toHaveAttribute('placeholder', /Pinterest/);
  // a Pinterest short link → the campaign row made first, then the server's ref_link → a file chip with the link icon
  await box.fill('https://pin.it/4yUtHzQQl'); await ref.getByRole('button', { name: 'ضيف' }).click();
  await expect(ref.locator('.cw-f')).toContainText('لينك — pin.it');
  await expect(box).toHaveValue('');
  const call = mock.mkt.calls.find((c) => c.action === 'ref_link'); expect(call.url).toBe('https://pin.it/4yUtHzQQl');
  const made = mock.mkt.campaigns.find((c) => c.id !== C1); expect(made).toBeTruthy();
  await expect.poll(() => { const cur = mock.mkt.campaigns.find((c) => c.id === made.id); const r = cur && cur.state && cur.state.w ? cur.state.w.media.post.ref : []; return r.map((f) => [f.t, f.name, /\/ref-[a-z0-9]+\.jpg$/.test(f.path) && f.path.startsWith(made.id + '/')]); })
    .toEqual([['file', 'لينك — pin.it', true]]);
  // the refusals, each with its reason; nothing is added
  mock.mkt.refWeb = { 'https://cdn.example.com/page': 'none' };
  await box.fill('https://cdn.example.com/page'); await ref.getByRole('button', { name: 'ضيف' }).click();
  await expect(page.locator('.toast.show')).toContainText('مالقيناش صورة في اللينك ده');
  await box.fill('http://cdn.example.com/a.jpg'); await box.press('Enter');
  await expect(page.locator('.toast.show')).toContainText('https://');
  await box.fill('NOPE-SKU'); await ref.getByRole('button', { name: 'ضيف' }).click();
  await expect(page.locator('.toast.show')).toContainText('مالقيناش منتج بالـ SKU ده');
  await expect(ref.locator('.cw-f')).toHaveCount(1);
  expect(mock.mkt.calls.filter((c) => c.action === 'ref_link').length).toBe(2); // the http link and the SKU never reach the server
  // a product of the site by its SKU stays a product (the server reads its photo from the site, never through ref_link)
  await box.fill('IBTA4040PAHC000013'); await ref.getByRole('button', { name: 'ضيف' }).click();
  await expect(ref.locator('.cw-f')).toHaveCount(2);
  expect(mock.mkt.calls.filter((c) => c.action === 'ref_link').length).toBe(2);
  // the owner 15 Nov («بدلو لينك المنتج علي الموقع … مش قريه»): the live site's link (the mirror holds the staging site's) → the
  // product by its path, the English row — a product chip, not a fetched picture
  const use = pg(page).locator('[data-cw-files="cw-use-post"]');
  await pg(page).locator('#cw-use-post-l').fill('https://ibtekr.club/product/cushion/'); await use.getByRole('button', { name: 'ضيف' }).click();
  await expect(use.locator('.cw-f')).toHaveCount(1);
  await expect(use.locator('.cw-f')).toContainText('Cushion');
  expect(mock.mkt.calls.filter((c) => c.action === 'ref_link').length).toBe(2);
  await expect.poll(() => { const cur = mock.mkt.campaigns.find((c) => c.id === made.id); return ((cur && cur.state && cur.state.w ? cur.state.w.media.post.use : []) || []).map((f) => [f.t, f.id]); }).toEqual([['product', 9001]]);
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
  await f.locator('[data-tpl-ai]').click(); await page.locator('[data-ai-go]').click();
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
  // owner batch 14 Nov decision 15: no «التسويق» in the menu of a member without marketing.view, and its link lands on the dashboard
  await signIn(page, ACCOUNTS);
  await expect(page.locator('.sidebar .nav-item[data-page="marketing"]')).toBeHidden();
  await page.evaluate(() => { location.hash = 'marketing'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
  await expect(pg(page)).toBeHidden();
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => { window.IBAuth.signOut(); })]); // the SIGNED_OUT reloads the page first
  mock.mkt.cap = 100; mock.mkt.used = 60; // 40 left, an image is 75
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C1 + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  await pg(page).locator('.wstepper .stp-b', { hasText: 'البناء' }).click();
  await pg(page).locator('[data-cw-gen="P1"]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('مش كفاية');
  expect(mock.mkt.calls.some((c) => c.action === 'campaign')).toBe(false);
});

test('the owner 12 Nov: «إنشاء» has the campaign card only; the campaign\'s steps in one centered column with the footer\'s button at its own width; the count typed by hand (Arabic digits, Enter, the arrows) or + / −, centered in its box; the studio in its own column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openMarketing(page);
  await expect(pg(page).locator('[data-mk-video]')).toHaveCount(0);
  await expect(pg(page).locator('.tools-grid .tool-card')).toHaveCount(1);
  await pg(page).locator('[data-mk-start]').click();
  const col = pg(page).locator('[data-wiz-col="campaign"]');
  await expect(col).toBeVisible();
  expect((await col.boundingBox()).width).toBeLessThanOrEqual(880);
  const next = pg(page).locator('.wiz-foot .cp-next');
  expect((await next.boundingBox()).width).toBeLessThan(260);
  await expect(pg(page).locator('.wiz-foot .help')).toContainText('الخطوة 1 من 4');
  const n = pg(page).locator('#cw-n-post');
  expect(await n.evaluate((e) => getComputedStyle(e).textAlign)).toBe('center');
  await n.fill('٣'); await n.press('Enter');
  await expect(pg(page).locator('#cw-n-post')).toHaveValue('3');
  await pg(page).locator('#cw-n-post').press('ArrowUp');
  await expect(pg(page).locator('#cw-n-post')).toHaveValue('4');
  await pg(page).locator('[data-num="cw-n-post-"]').click();
  await expect(pg(page).locator('#cw-n-post')).toHaveValue('3');
  await pg(page).locator('#cw-n-post').fill('99'); await pg(page).locator('#cw-n-post').press('Tab'); // past the most → the most
  await expect(pg(page).locator('#cw-n-post')).not.toHaveValue('99');
  // the studio: its own centered column too
  await page.evaluate(() => { location.hash = 'products-studio-new-1'; });
  const sc = page.locator('[data-wiz-col="studio"]');
  await expect.poll(() => sc.evaluate((e) => e.getBoundingClientRect().width).catch(() => 0)).toBeGreaterThan(600); // redrawn as the studio loads
  expect(await sc.evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(1040);
});

// comments decision 52 (the owner 15 Nov on the campaign — «عايز اضيف upload للصور عشان لو معايا صور و كمان عايز ابعت الصور لmagnific او ابعت
// الprompt اللي يتعملي بيه صورة زي اللي كنت عامله في صفحة المنتجات … و كمان زرار استلم بيه الصور من magnific») and the campaign half of 49
test('comment 52 — the build step: «ارفع صورة» puts a ready image on a piece (no credit); the Magnific bar sends every image of the campaign as a generator, links the Space, and «هات النتائج» places the newest result of each on its piece — once', async ({ page }) => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await openMarketing(page);
  await pg(page).locator('[data-mk-start]').click();
  await pg(page).locator('#cw-idea').fill('كولكشن الشتا — مخدات مشغولة يدويًا');
  await pg(page).locator('[data-num="cw-n-post-"]').click(); // 2 → 1 post; the carousel stays (a cover + its slides)
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect.poll(() => mock.mkt.campaigns.length).toBe(2);
  const made = mock.mkt.campaigns.find((c) => c.id !== C1); const saved = () => mock.mkt.campaigns.find((c) => c.id === made.id).state;
  await expect(pg(page).locator('[data-cw-autofill]')).toHaveCount(0); // the texts are written
  const slides = saved().pieces.find((p) => p.id === 'C1').slides.length; const total = 1 + 1 + slides;
  const bar = pg(page).locator('[data-cw-magnific]');
  await expect(bar).toHaveAttribute('data-cw-magnific', 'new');
  await expect(bar.locator('[data-cw-mg-state]')).toContainText(total + ' صورة في الكامبين');
  await expect(bar.locator('[data-cw-mg-fetch]')).toHaveCount(0); await expect(bar.locator('[data-cw-mg-open]')).toHaveCount(0);
  // the account is not linked: the bar says so, and a send answers in words — nothing is sent
  await expect(bar.locator('[data-cw-mg-unlinked]')).toBeVisible();
  await bar.locator('[data-cw-mg-send]').click();
  await expect(page.locator('.toast.show')).toContainText('حساب Magnific مش مربوط');
  await expect(bar).toHaveAttribute('data-cw-magnific', 'new');
  // linked: every image of the campaign goes as a generator; the Space's link and «هات النتائج» show
  mock.magnific.linked = true;
  await bar.locator('[data-cw-mg-send]').click();
  await expect(bar).toHaveAttribute('data-cw-magnific', 'sent');
  await expect(bar.locator('[data-cw-mg-state]')).toHaveAttribute('data-cw-mg-state', String(total));
  await expect(bar.locator('[data-cw-mg-open]')).toHaveAttribute('href', /^https:\/\/www\.magnific\.com\/app\/spaces\//);
  await expect(bar.locator('[data-cw-mg-unlinked]')).toHaveCount(0);
  const sent = mock.mkt.calls.filter((c) => c.action === 'bridge_campaign').pop(); expect(sent.targets).toBe(total);
  await expect.poll(() => (saved().mg || {}).n).toBe(total); // the link is kept with the campaign
  // a ready image of mine on the post: no cost popup, no credit — the piece counts as made
  await pg(page).locator('#cw-up-P1').setInputFiles({ name: 'my-post.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.toast.show')).toContainText('اترفعت الصورة');
  await expect(pg(page).locator('[data-cw-built]')).toHaveAttribute('data-cw-built', '1/2');
  await expect.poll(() => saved().pieces.find((p) => p.id === 'P1').img || '').toMatch(new RegExp('^' + made.id + '/up-'));
  await expect(pg(page).locator('#cw-P1 .cw-pv img')).toHaveCount(1);
  await expect(pg(page).locator('label[for="cw-up-P1"]')).toContainText('ارفع صورة تانية');
  // and on a carousel's slide
  await pg(page).locator('#cw-up-C1-0').setInputFiles({ name: 'slide.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => saved().pieces.find((p) => p.id === 'C1').slides[0].img || '').toMatch(new RegExp('^' + made.id + '/up-'));
  // a file that is no image is refused in words
  await pg(page).locator('#cw-up-C1-cv').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect.poll(() => saved().pieces.find((p) => p.id === 'C1').img || null).toBe(null);
  // «هات النتائج»: the newest result of each generator on its piece (the upload is replaced by the newer result), all made
  await bar.locator('[data-cw-mg-fetch]').click();
  await expect(page.locator('.toast.show')).toContainText('اتحطت ' + total + ' صورة من Magnific');
  await expect(pg(page).locator('[data-cw-built]')).toHaveAttribute('data-cw-built', '2/2');
  const c1 = () => saved().pieces.find((p) => p.id === 'C1');
  await expect.poll(() => saved().pieces.find((p) => p.id === 'P1').img || '').toMatch(new RegExp('^' + made.id + '/gen-P1-mgmk'));
  expect(c1().img).toMatch(/\/gen-C1-cv-mgmk/); expect(c1().slides.every((x, k) => new RegExp('/gen-C1-s' + (k + 1) + '-mgmk').test(x.img))).toBe(true);
  // again: nothing new — the pieces stay
  const before = saved().pieces.find((p) => p.id === 'P1').img;
  await bar.locator('[data-cw-mg-fetch]').click();
  await expect(page.locator('.toast.show')).toContainText('مفيش نتايج جديدة على Magnific');
  expect(saved().pieces.find((p) => p.id === 'P1').img).toBe(before);
  // nothing of it touched the images' credits or asked for a paid generation
  expect(mock.mkt.calls.filter((c) => c.action === 'campaign').length).toBe(0);
  await expect(pg(page).locator('.cw-wallet')).toHaveAttribute('data-cw-balance', '5000');
  // the review opens with these images
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('المراجعة');
});
