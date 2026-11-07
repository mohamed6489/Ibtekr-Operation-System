import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { MKT_ID } from './mkt-mock.mjs';

// «التسويق» 9.5.5 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 57–66): a video piece in a campaign — the
// details (ratio, model, length), the scenes by Claude and a key frame a scene (images from the wallet), the review (the clips, the
// voice-over, the music, the cut and the mixes on the Magnific bridge as jobs the page polls, the final video, the approval), the
// publish step (a download), the «فيديو» tool; the bridge not linked. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
async function start(page, extra = {}) {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { mktCampaigns: [], mktTemplates: [], ...extra });
}
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function openMarketing(page, email = ADMIN) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="marketing"]').click();
  await expect(page.locator('#pg-marketing')).toBeVisible();
  await page.locator('#pg-marketing').getByRole('tab', { name: /إنشاء/ }).click();
}
const pg = (page) => page.locator('#pg-marketing');
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const toast = (page) => page.locator('.toast.show');
const made = () => mock.mkt.campaigns.at(-1);
const piece = () => (made().state.pieces || []).find((p) => p.id === 'V1');
// the mock finishes a job a poll («حدّث» while jobs are open; the page also polls on its own after each action)
async function waitStep(page, step, max = 8) {
  for (let i = 0; i < max; i++) {
    if ((await pg(page).locator('[data-cw-vstep]').getAttribute('data-cw-vstep')) === step) return;
    const btn = pg(page).locator('[data-cw-vpoll="V1"]');
    if (await btn.count()) await btn.click({ timeout: 1500 }).catch(() => {}); else await page.waitForTimeout(250);
  }
  await expect(pg(page).locator('[data-cw-vstep]')).toHaveAttribute('data-cw-vstep', step);
}

test('the «فيديو» tool: a campaign with one video; the details (9:16, Seedance, 15 s) → the scenes by Claude → a key frame a scene → the review: clips, voice, music, the cut and the mixes polled to the final video → approval → a download in the schedule', async ({ page }) => {
  await start(page);
  await openMarketing(page);
  await pg(page).locator('[data-mk-video]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('تفاصيل الكامبين');
  await expect(pg(page).locator('[data-cw-media="video"]')).toBeVisible();
  await pg(page).locator('#cw-idea').fill('ريل لمخدة بوهيمي من Art craft');
  await expect(pg(page).locator('[data-cw-est]')).toHaveAttribute('data-cw-est', '225'); // 3 scene images × 75
  await expect(pg(page)).toContainText('والفيديو ≈ 75 كريديت على حساب Magnific');
  await pg(page).locator('#cw-dur').click(); await page.getByRole('option', { name: '10 ثانية' }).click();
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('البناء');
  await expect.poll(() => mock.mkt.campaigns.length).toBe(1);
  expect(piece()).toMatchObject({ kind: 'فيديو', size: '9:16', model: 'seedance-2.5', dur: 10, sceneCount: 3, scenes: [] });
  // the scenes by Claude (no credit), with the durations of the length
  await pg(page).locator('[data-cw-plan="V1"]').click();
  await expect(pg(page).locator('[data-cw-scene]')).toHaveCount(3);
  await expect(pg(page).locator('#b-V1-sc0')).toHaveValue('لقطة قريبة على نقشة المنتج');
  await expect(pg(page).locator('#b-V1-tx0')).toHaveValue('دفا الشتا');
  expect(piece().scenes.map((s) => s.d)).toEqual([4, 4, 4]); // Seedance: 4 s at least a clip (fitScenes)
  expect(mock.mkt.calls.some((c) => c.fn === 'ai-content' && c.task === 'scenes' && c.piece === 'V1')).toBe(true);
  // a key frame a scene: the image model at the ratio's size, from the wallet
  await pg(page).locator('[data-cw-scene-gen="V1-0"]').click();
  await modal(page, 'توليد صورة المشهد').getByRole('button', { name: /ولّد/ }).click();
  await expect(pg(page).locator('[data-cw-scene="V1-0"] img')).toBeVisible();
  const gen = mock.mkt.calls.find((c) => c.action === 'campaign'); expect([gen.piece, gen.slide, gen.model]).toEqual(['V1', 0, 'seedream-5-pro']);
  await pg(page).locator('[data-cw-scenes-all="V1"]').click();
  await modal(page, 'ولّد صور كل المشاهد').getByRole('button', { name: /ولّد/ }).click();
  await expect(pg(page).locator('[data-cw-built]')).toHaveAttribute('data-cw-built', '1/1');
  await expect.poll(() => piece().scenes.every((s) => s.img)).toBe(true);
  // the review: the timeline, the voice-over by AI, the music by type, the clips, the assembly chain polled to the final
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('المراجعة');
  await expect(pg(page).locator('[data-cw-tl]')).toHaveCount(3);
  await expect(pg(page).locator('[data-cw-vstep]')).toHaveAttribute('data-cw-vstep', '1');
  await pg(page).locator('#vo-V1').fill('الدفا الحقيقي من إيد صانعة مصرية');
  await pg(page).locator('[data-cw-voice-gen="V1"]').click();
  await expect(toast(page)).toContainText('الصوت بيتعمل');
  await pg(page).locator('[data-cw-music-gen="V1"]').click();
  await expect(pg(page).locator('[data-cw-job="music:running"], [data-cw-job="music:done"]')).toHaveCount(1);
  await pg(page).locator('[data-cw-clips="V1"]').click();
  await expect(toast(page)).toContainText('المشاهد بتتعمل');
  expect(mock.mkt.calls.filter((c) => c.action === 'video_clip').map((c) => c.scene)).toEqual([0, 1, 2]);
  await waitStep(page, '2');
  await expect(pg(page).locator('[data-cw-clip="V1-2:done"]')).toHaveCount(1);
  await pg(page).locator('[data-cw-assemble="V1"]').click();
  await expect(toast(page)).toContainText('بيتجمّع');
  await waitStep(page, '3'); // the cut, then the voice mix, then the music mix
  const kinds = mock.mkt.videoJobs.map((j) => [j.kind, j.status, j.data.role || null]);
  expect(kinds).toEqual([['voice', 'done', null], ['music', 'done', null], ['clip', 'done', null], ['clip', 'done', null], ['clip', 'done', null], ['assemble', 'done', null], ['mix', 'done', 'voice'], ['mix', 'done', 'music']]);
  await expect.poll(() => piece().video || '').toMatch(new RegExp('^' + made().id + '/vid-V1-mix-'));
  expect(mock.mkt.videoJobs.every((j) => j.url == null || !JSON.stringify(mock.mkt.calls).includes(j.url))).toBe(true);
  // the player and the approval
  await pg(page).locator('[data-cw-watch="V1"]').click();
  await expect(page.locator('[data-cw-player="V1"] video')).toBeVisible();
  await page.locator('[data-vp-ok]').click();
  await expect(pg(page).locator('[data-cw-approved]')).toHaveAttribute('data-cw-approved', '1/1');
  // the schedule: a reel is a download (9.5.2 rule, until T30), the zip carries the video
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  await expect(pg(page).locator('[data-cw-pub="V1"]')).toHaveAttribute('aria-disabled', 'true');
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('سجل النشر');
  const sch = mock.mkt.calls.find((c) => c.rpc === 'mkt_schedule');
  expect(sch.p_items.map((x) => [x.kind, x.how])).toEqual([['ريل', 'download'], ['ريل', 'download']]);
  expect(sch.p_items[0].images.length).toBe(4); expect(sch.p_items[0].images[0]).toMatch(/\.mp4$/); // the MP4 first, then the three key frames (decision 63)
  // the log: kinds and pieces, never the voice text or a link
  const logs = JSON.stringify(mock.activityRows.filter((r) => String(r.action).startsWith('mkt.video')));
  expect(logs).toContain('mkt.video.clip'); expect(logs).toContain('mkt.video.assemble');
  for (const secret of ['الدفا', 'pikaso', 'مخدة']) expect(logs).not.toContain(secret);
});

test('the bridge not linked: the clips are refused with the way to link; a failed job is shown; a member\'s own audio file goes up as a done upload job', async ({ page }) => {
  const C = 'c0000000-0000-4000-8000-00000000000a';
  const state = { w: { goal: 'منتج جديد', idea: 'ريل', mediaTab: 'video', media: { video: { count: 1, size: '9:16', dur: 10, model: 'kling-2.5', notes: '', use: [], ref: [] }, post: { count: 0, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', model: 'kling-2.5', dur: 10, res: '1080p', sceneCount: 2, method: 'separate', idea: 'المخدة', caption: '', ref: [], use: [], gen: 0, approved: false, assembled: false, video: null, music: { src: 'none', type: '', file: '' }, voice: { mode: 'upload', voice: 'm-eg-1', text: '', file: '' },
      scenes: [{ n: 1, d: 5, idea: 'لقطة', text: '', cam: 'ثابتة', img: C + '/gen-V1-s1-a.png', ref: [], use: [] }, { n: 2, d: 5, idea: 'القعدة', text: '', cam: 'ثابتة', img: C + '/gen-V1-s2-a.png', ref: [], use: [] }] }], sched: {}, rtab: 'video' };
  await start(page, { mktCampaigns: [{ id: C, name: 'ريل', goal: 'منتج جديد', step: 3, state }], mktObjects: { [C + '/gen-V1-s1-a.png']: { type: 'image/png' }, [C + '/gen-V1-s2-a.png']: { type: 'image/png' } }, mktBridge: false, mktVideoFail: 'clip' });
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('المراجعة');
  await expect(pg(page).locator('[data-cw-method="V1"] [data-method="chained"]')).toBeDisabled(); // Kling: separate only
  await pg(page).locator('[data-cw-clips="V1"]').click();
  await expect(toast(page)).toContainText('اربط حساب Magnific الأول');
  mock.mkt.bridge = true;
  // the member's own voice file: into the campaign's folder, then onto Magnific
  await pg(page).locator('#cw-au-voice-V1').setInputFiles({ name: 'my-voice.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3 fake') });
  await expect(toast(page)).toContainText('اترفع الملف');
  await expect(pg(page).locator('[data-cw-job="upload:done"]')).toHaveCount(1);
  const up = mock.mkt.calls.find((c) => c.action === 'video_upload'); expect(up).toBeTruthy();
  expect([...mock.mkt.objects.keys()].some((k) => new RegExp('^' + C + '/vid-V1-up[0-9]{2}-').test(k))).toBe(true);
  // the clips: the first one fails on Magnific (the knob), the page shows it; the rest go on (the mock finishes both on the first poll)
  await pg(page).locator('[data-cw-clips="V1"]').click();
  await expect(pg(page).locator('[data-cw-job="clip:failed"]')).toHaveCount(1);
  await expect(pg(page).locator('[data-cw-job="clip:done"]')).toHaveCount(1);
  await expect(pg(page).locator('[data-cw-vstep]')).toHaveAttribute('data-cw-vstep', '1');
});

test('9.5.5 decision 63: an assembled reel with the page linked and the switch on → «انشر» opens on Facebook / Instagram; the schedule sends its MP4 first (no JPEG copies), TikTok stays a download', async ({ page }) => {
  const C = 'c0000000-0000-4000-8000-00000000000b'; const V = C + '/vid-V1-mix-9.mp4';
  const state = { w: { goal: 'منتج جديد', idea: 'ريل المخدة', mediaTab: 'video', media: { video: { count: 1, size: '9:16', dur: 10, model: 'seedance-2.5', notes: '', use: [], ref: [] }, post: { count: 0, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] }, carousel: { count: 0, slides: 4, size: '1080x1350', model: 'seedream-5-pro', notes: '', use: [], ref: [] } }, extra: { count: 0, model: 'seedream-5-pro', notes: '', use: [], ref: [] } },
    pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', model: 'seedance-2.5', dur: 10, res: '1080p', sceneCount: 2, method: 'separate', idea: 'المخدة', caption: 'كابشن الريل', ref: [], use: [], gen: 2, approved: true, assembled: true, video: V, music: { src: 'none', type: '', file: '' }, voice: { mode: 'none', voice: 'm-eg-1', text: '', file: '' },
      scenes: [{ n: 1, d: 5, idea: 'لقطة', text: '', cam: 'ثابتة', img: C + '/gen-V1-s1-a.png', ref: [], use: [] }, { n: 2, d: 5, idea: 'القعدة', text: '', cam: 'ثابتة', img: C + '/gen-V1-s2-a.png', ref: [], use: [] }] }], sched: {}, rtab: 'video' };
  await start(page, { mktCampaigns: [{ id: C, name: 'ريل المخدة', goal: 'منتج جديد', step: 4, state }], mktObjects: { [V]: { type: 'video/mp4', size: 4096 }, [C + '/gen-V1-s1-a.png']: { type: 'image/png' }, [C + '/gen-V1-s2-a.png']: { type: 'image/png' } }, mktConn: { autopublish: true } });
  await openMarketing(page);
  await pg(page).locator('[data-mk-open="' + C + '"]').click();
  await expect(pg(page).locator('.wstepper .stp-cur')).toContainText('النشر والتحميل');
  const pub = pg(page).locator('[data-cw-pub="V1"]');
  await expect(pub).not.toHaveAttribute('aria-disabled', 'true');
  await expect(pub).toHaveAttribute('aria-pressed', 'true'); // «انشر» is the default where the platform can take it
  await pg(page).locator('[data-cw-pl="V1"] .chip', { hasText: 'تيك توك' }).click();
  await pg(page).locator('.cp-next').click();
  await expect(pg(page).locator('[role=tab][aria-selected=true]')).toContainText('سجل النشر');
  const sch = mock.mkt.calls.find((c) => c.rpc === 'mkt_schedule');
  expect(sch.p_items.map((x) => [x.platform, x.kind, x.how, x.images[0]]).sort()).toEqual([['انستجرام', 'ريل', 'publish', V], ['تيك توك', 'ريل', 'download', V], ['فيسبوك', 'ريل', 'publish', V]].sort());
  expect(sch.p_items.every((x) => x.images.length === 3)).toBe(true); // the MP4 then the two key frames
  expect([...mock.mkt.objects.keys()].some((k) => /\/pub-/.test(k))).toBe(false); // no JPEG copies for a reel
  await expect(pg(page).locator('.pub-tbl tbody tr')).toHaveCount(3);
});
