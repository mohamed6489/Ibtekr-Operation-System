import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// IBImages (phase 5.4 T6) against the mocked ai-images function and bucket, driven from the page itself (the studio step and the
// images tool of T7 / T8 build on these calls): the tool's images under the member, the signed URL and the download, the history
// and the month's credits, the credit cap, a refusal, the member's own deletes only, the permissions, the admin's probe, and the
// activity row without a prompt or a path. Mock only.
const OPS = 'ops.dev@ibtekr.local'; const OPS_ID = '00000000-0000-4000-8000-000000000002'; const ADMIN = 'admin.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page, email) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window.IBDirectory && window.IBDirectory.me && window.IBDirectory.me()))).toBe(true);
}

test('the images tool through IBImages: N images in bucket ai-images under the member, a signed URL, a download, the history and the month, the cap, a refusal, own deletes only, the activity row', async ({ page }) => {
  await signIn(page, OPS);
  const r = await page.evaluate(() => window.IBImages.create({ source: 'text', prompt: 'a macrame bag', shape: 'home', size: '1080x1350', count: 2 }));
  expect([r.ok, r.result, r.bucket, r.paths.length, r.credits, r.model]).toEqual([true, 'ok', 'ai-images', 2, 150, 'seedream-5-pro']);
  expect(r.paths.every((p) => p.startsWith(OPS_ID + '/') && p.endsWith('.webp'))).toBe(true);
  expect(mock.imgCalls).toEqual([{ action: 'create', by: OPS, source: 'text', prompt: 'a macrame bag', shape: 'home', size: '1080x1350', count: 2 }]);
  expect(mock.aiRuns.map((x) => [x.action, x.source, x.status, x.credits, x.cost_usd, x.output.bucket, x.output.paths.length])).toEqual([['image', 'tool', 'ok', 150, 0.3, 'ai-images', 2]]);
  // the signed URL lands after the first read (ib:images), the bytes come down, the history and the month see the run
  const url = await page.evaluate(async (p) => { const I = window.IBImages; const first = I.imageUrl('ai-images', p); await new Promise((res) => document.addEventListener('ib:images', res, { once: true })); return [first, I.imageUrl('ai-images', p)]; }, r.paths[0]);
  expect(url[0]).toBeNull(); expect(url[1]).toMatch(/\/storage\/v1\/object\/sign\/ai-images\/.*token=ai-/);
  const dl = await page.evaluate(async (p) => { const d = await window.IBImages.download('ai-images', p); return [d.ok, d.blob ? d.blob.size : null]; }, r.paths[1]);
  expect(dl[0]).toBe(true); expect(dl[1]).toBeGreaterThan(0);
  const h = await page.evaluate(() => window.IBImages.history());
  expect(h.rows.map((x) => [x.source, x.label, x.credits, x.bucket, x.paths.length])).toEqual([['tool', 'a macrame bag', 150, 'ai-images', 2]]);
  expect(await page.evaluate(() => window.IBImages.monthCredits())).toEqual({ ok: true, total: 150, usd: 0.3, runs: 1, studio: { runs: 0, credits: 0 }, tool: { runs: 1, credits: 150 }, edit: { runs: 0, credits: 0 } });
  // the cap: 150 spent + 75 planned over 200 → ai_cap and a cap row, no image
  mock.settings.push({ section: 'ai', data: { image_monthly_credits: 200 } });
  const cap = await page.evaluate(() => window.IBImages.create({ source: 'text', prompt: 'a mug', shape: 'studio' }));
  expect([cap.ok, cap.reason]).toEqual([false, 'ai_cap']);
  expect(mock.aiRuns.at(-1).status).toBe('cap'); expect(mock.imgObjects.size).toBe(2);
  mock.settings.length = 0;
  // the provider refusing the content → result 'refused', nothing stored
  mock.imgFail = 'refused';
  const ref = await page.evaluate(() => window.IBImages.create({ source: 'text', prompt: 'a mug', shape: 'studio' }));
  expect([ref.ok, ref.result, ref.paths]).toEqual([true, 'refused', []]);
  expect(mock.aiRuns.at(-1).status).toBe('refused'); expect(mock.imgObjects.size).toBe(2);
  mock.imgFail = null;
  // the member deletes their own results only
  const rm = await page.evaluate((p) => window.IBImages.remove([p, 'other/x.webp']), r.paths[0]);
  expect(rm).toEqual({ ok: true });
  expect([...mock.imgObjects.keys()]).toEqual([r.paths[1]]);
  expect(await page.evaluate(() => window.IBImages.remove(['other/x.webp']))).toEqual({ ok: false, reason: 'forbidden' });
  // the activity: the source, the shape, the count, the model and the credits — no prompt, no path
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.ai.image').map((x) => x.new_value)).toEqual(['tool · text · home · 2 images · seedream-5-pro · 150 credits', 'tool · text · studio · 0 images · seedream-5-pro · refused']);
  expect(JSON.stringify(mock.activityRows)).not.toContain('macrame');
  expect(JSON.stringify(mock.activityRows)).not.toContain(OPS_ID + '/');
});

test('permissions: a member without products.add / products.edit is refused by the server; the admin\'s probe answers the provider\'s shape; the key missing → not_configured', async ({ page }) => {
  await signIn(page, ACCOUNTS);
  expect(await page.evaluate(() => window.IBImages.can())).toEqual({ studio: false, edit: false, tool: false, settings: false });
  const r = await page.evaluate(() => window.IBImages.create({ source: 'text', prompt: 'a mug', shape: 'studio' }));
  expect([r.ok, r.reason]).toEqual([false, 'forbidden']);
  expect(mock.imgCalls).toEqual([]); expect(mock.aiRuns).toEqual([]);
  expect(await page.evaluate(() => window.IBImages.probe().then((x) => x.reason))).toBe('forbidden');
  await page.evaluate(() => window.IBAuth && window.IBAuth.signOut ? window.IBAuth.signOut() : null).catch(() => {});
  await signIn(page, ADMIN);
  expect(await page.evaluate(() => window.IBImages.probe())).toEqual({ ok: true, provider: 'magnific', shape: { credits: 'number', plan: { name: 'string' } }, models: ['seedream-5-pro', 'imagen-nano-banana-2-1', 'imagen-nano-banana-2-lite', 'gpt-2'] });
  mock.imgFail = 'not_configured';
  expect(await page.evaluate(() => window.IBImages.probe().then((x) => x.reason))).toBe('not_configured');
  expect(await page.evaluate(() => window.IBImages.create({ source: 'text', prompt: 'a mug', shape: 'studio' }).then((x) => x.reason))).toBe('not_configured');
  expect(mock.aiRuns.map((x) => [x.status, x.error, x.credits])).toEqual([['error', 'not_configured', 0]]);
});
