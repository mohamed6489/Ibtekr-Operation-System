import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The studio's AI (phase 5.3, docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md decision 6): «املا الناقص بالـ AI» in
// «البيانات و SKU» (the missing Arabic names, a sheet color not in the table) and in «الأقسام والأوصاف» (descriptions + categories),
// one ai-content studio call per item on the saved batch, «AI — راجع» on each filled field until edited by hand, the
// confirmation with the count and cost, the stops (the key not set), and the upload carrying what the AI wrote.
// Mock only: the cases assert what the mock recorded (aiCalls, studioUploads).
const OPS = 'ops.dev@ibtekr.local';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

const pick = async (page, label, files) => { const fc = page.waitForEvent('filechooser'); await page.getByRole('button', { name: label }).click(); (await fc).setFiles(files); };
const next = (page, label) => page.locator('.wiz-foot').getByRole('button', { name: label }).click();
const rowsOf = (page) => page.locator('#pg-products .st-table tbody tr');

async function batchAtData(page) {
  await page.goto('/');
  await page.fill('#lg-id', OPS); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click();
  await page.fill('#r', '30'); await page.fill('#f', '0'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  // no Arabic names, and «Sage» is not in the color table
  await pick(page, /اختار الشيت/, { name: 'lamps.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Color\nDesk Lamp,900,Beige\nFloor Lamp,1500,Sage\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }, { name: '2-1.png', mimeType: 'image/png', buffer: PNG }]);
  await next(page, 'التالي: البيانات و SKU');
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: السعر' })).toBeDisabled();
}

test('studio AI: the missing Arabic names and a color not in the table, then descriptions and categories — confirmed with the count and cost, tagged «AI — راجع», a hand edit takes the tag off, and the upload carries them', async ({ page }) => {
  await batchAtData(page);
  mock.aiAnswer = (action, req, item) => ({ nameAr: item.nameEn === 'Desk Lamp' ? 'أباجورة مكتب' : 'أباجورة أرضية', colors: ['BE'], sizes: [],
    shortDesc: item.nameEn + ' in warm bamboo.', shortDescAr: item.nameEn === 'Desk Lamp' ? 'أباجورة مكتب من البامبو.' : 'أباجورة أرضية من البامبو.', categories: [mock.wooCategories.at(-1).id] });
  await page.locator('[data-ai="املا الناقص بالـ AI"]').click();
  await expect(page.locator('.modal')).toContainText('2 منتج · التكلفة حوالي 0.10 دولار');
  await page.locator('.modal').getByRole('button', { name: 'ابدأ' }).click();
  await expect(rowsOf(page).nth(1)).toContainText('أباجورة أرضية');
  expect(mock.aiCalls.map((c) => [c.action, c.index, c.want])).toEqual([['studio', 0, ['nameAr']], ['studio', 1, ['nameAr', 'variations']]]);
  expect(mock.aiCalls[0].batch_id).toBe(mock.studioBatches[0].id);
  await expect(rowsOf(page).nth(1)).toContainText('Beige'); // «Sage» became the table's Beige
  await expect(rowsOf(page).nth(1)).toContainText('كامل');
  await expect(page.locator('.tot-bar')).toContainText('3 خانة · راجعها');
  await expect(rowsOf(page).nth(0).getByText('AI — راجع')).toHaveCount(1);
  // a hand edit of the Arabic name takes its tag off
  await rowsOf(page).nth(0).getByRole('button', { name: 'عدّل' }).click();
  await page.fill('#nameAr', 'أباجورة مكتب صغيرة');
  await page.locator('.modal').getByRole('button', { name: 'احفظ' }).click();
  await expect(rowsOf(page).nth(0).getByText('AI — راجع')).toHaveCount(0);
  await expect(page.locator('.tot-bar')).toContainText('2 خانة · راجعها');
  await next(page, 'التالي: السعر');
  await next(page, 'التالي: الصور');
  await next(page, 'التالي: الأقسام والأوصاف');
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: المراجعة والرفع' })).toBeDisabled(); // no category yet
  await page.locator('.tot-bar [data-ai="املا الناقص بالـ AI"]').click();
  await page.locator('.modal').getByRole('button', { name: 'ابدأ' }).click();
  await expect(rowsOf(page).nth(0)).toContainText('أباجورة مكتب من البامبو.');
  expect(mock.aiCalls.slice(2).map((c) => c.want)).toEqual([['desc', 'category'], ['desc', 'category']]);
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: المراجعة والرفع' })).toBeEnabled();
  await next(page, 'التالي: المراجعة والرفع');
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('2 من 2');
  expect(mock.studioUploads.map((x) => [x.ar.name, x.ar.short_description, x.product.short_description])).toEqual([
    ['أباجورة مكتب صغيرة', 'أباجورة مكتب من البامبو.', 'Desk Lamp in warm bamboo.'], ['أباجورة أرضية', 'أباجورة أرضية من البامبو.', 'Floor Lamp in warm bamboo.']]);
  expect(mock.studioUploads[1].sku).toMatch(/^IBTARBE\d{4}$/); // the AI's color is in the SKU
  await expect.poll(() => mock.activity.filter((a) => a.action === 'product.ai.studio').length).toBe(4);
});

test('studio AI: the key not set stops the run at the first item with the message, and nothing is filled or tagged', async ({ page }) => {
  await batchAtData(page);
  mock.aiFail = 'not_configured';
  await page.locator('[data-ai="املا الناقص بالـ AI"]').click();
  await page.locator('.modal').getByRole('button', { name: 'ابدأ' }).click();
  await expect(page.locator('.toast.show')).toContainText('الـ AI لسه مش متوصّل');
  expect(mock.aiCalls.length).toBe(1); // stopped at the first
  await expect(page.locator('#pg-products .st-table').getByText('AI — راجع', { exact: true })).toHaveCount(0);
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: السعر' })).toBeDisabled();
});
