import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The content tool (phase 5.3, docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md): the «المحتوى» card and the edit page's
// «اكتب بالذكاء الاصطناعي» open it; from data / a photo / a product on the site; one ai-content call; the answer per language,
// edited in place; «احفظ على المنتج» through product_save after a confirmation; «سجل المحتوى»; the failures; the permissions.
// Mock only: the cases assert what the mock recorded (aiCalls, aiRuns, productWrites).
const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function openProducts(page, email = OPS) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
}
const openTool = async (page) => { await page.getByRole('tab', { name: 'إضافة' }).click(); await page.locator('[data-tool="content"]').click(); await expect(page).toHaveURL(/#products-tool-content$/); };
const box = (page, key) => page.locator(`[data-out="${key}"] [contenteditable]`);
const pickBrand = async (page, name) => { await page.locator('#c-b').click(); await page.getByRole('option', { name }).click(); };

test('from data: the card opens the tool; outputs, languages and tone → one ai-content call; the answer per language, edited in place; no save without a product; logged', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('#pg-products')).toContainText('لسه مفيش محتوى');
  await page.locator('[data-cwrite]').click();
  await expect(page.locator('[data-cprob]')).toHaveText('اكتب اسم المنتج'); // nothing sent without a name
  await page.fill('#c-n', 'Bamboo Mirror');
  await pickBrand(page, 'Art Craft');
  await page.fill('#c-m', 'بامبو'); await page.fill('#c-x', 'المقاس 30×50 سم');
  await page.locator('[data-cout="seo"]').click(); await page.locator('[data-ctone="luxury"]').click();
  await page.locator('[data-cwrite]').click();
  await expect(box(page, 'ar.name')).toHaveText('مراية بامبو بوهيمي');
  expect(mock.aiCalls).toEqual([{ action: 'write', by: OPS, source: 'data', outputs: ['name', 'short', 'keywords', 'seo'], langs: ['ar', 'en'], tone: 'luxury',
    data: { name: 'Bamboo Mirror', brand: 'Art Craft', material: 'بامبو', details: 'المقاس 30×50 سم' } }]);
  await expect(box(page, 'ar.keywords')).toHaveText('مرايا بامبو · ديكور بوهيمي · مرايا حائط');
  await expect(page.locator('[data-out="ar.long"]')).toHaveCount(0); // not asked
  await page.locator('[data-cshow="en"]').click();
  await expect(box(page, 'en.seo_title')).toHaveText('Boho Bamboo Mirror | Alaa Anas — Ibtekr Club');
  await expect(page.locator('[data-csave]')).toHaveCount(0); // from data: copy only
  await box(page, 'en.name').fill('Boho Mirror');
  await page.locator('[data-cshow="ar"]').click(); await page.locator('[data-cshow="en"]').click();
  await expect(box(page, 'en.name')).toHaveText('Boho Mirror'); // the edit is kept
  await expect.poll(() => mock.activity.filter((a) => a.action === 'product.ai.write').map((a) => a.new_value)).toEqual(['data · name, short, keywords, seo · ar, en']);
  expect(mock.aiRuns.map((r) => [r.created_by, r.action, r.source, r.label, r.status])).toEqual([[mock.profiles.find((x) => x.email === OPS).id, 'write', 'data', 'Bamboo Mirror', 'ok']]);
  // «سجل المحتوى»: the run, and «افتح» brings its text back
  await page.locator('[data-chistory]').click();
  await expect(page.locator('.modal')).toContainText('Bamboo Mirror');
  await page.locator('.modal [data-hopen="1"]').click();
  await expect(box(page, 'en.name')).toHaveText('Boho Bamboo Mirror');
});

test('from a product: the edit page\'s button opens the tool on it; its current texts go along; «احفظ على المنتج» after a confirmation → product_save (EN + AR), keywords never', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await page.getByRole('tab', { name: 'الأوصاف' }).click();
  await page.locator('[data-pai]').click();
  await expect(page).toHaveURL(/#products-tool-content-9001$/);
  await expect(page.locator('#c-sku')).toHaveValue('IBTA4040PAHC000013');
  await expect(page.locator('#pg-products')).toContainText('Cushion');
  await page.locator('[data-cout="long"]').click(); await page.locator('[data-cout="seo"]').click();
  await page.locator('[data-cwrite]').click();
  await expect(box(page, 'ar.name')).toHaveText('مراية بامبو بوهيمي');
  const call = mock.aiCalls.at(-1);
  expect([call.source, call.product_id, call.outputs]).toEqual(['product', 9001, ['name', 'short', 'long', 'keywords', 'seo']]);
  expect(call.current).toEqual({ nameEn: 'Cushion', nameAr: 'كيس مخدة', shortEn: 'وصف قصير', longEn: '<p>وصف</p>' });
  await page.locator('[data-cshow="en"]').click();
  await box(page, 'en.name').fill('Boho Mirror');
  await page.locator('[data-csave]').click();
  await expect(page.locator('.modal')).toContainText('الاسم (EN)');
  await expect(page.locator('.modal')).toContainText('الوصف (AR)');
  await page.getByRole('button', { name: 'أيوه، احفظ على المنتج' }).click();
  await expect.poll(() => (mock.productWrites || []).length).toBe(1);
  expect(mock.productWrites[0]).toEqual({ action: 'product_save', by: OPS, id: 9001,
    fields: { name: 'Boho Mirror', short_description: '<p>A natural bamboo mirror that brings a warm bohemian note to the wall.</p>', description: '<p>Handmade from natural bamboo.</p><p>Made for an entrance or a dressing corner.</p>',
      seo_title: 'Boho Bamboo Mirror | Alaa Anas — Ibtekr Club', seo_description: 'A handmade natural bamboo mirror in a bohemian style by Alaa Anas — warmth for any wall.' },
    ar: { name: 'مراية بامبو بوهيمي', short_description: '<p>مراية من البامبو الطبيعي تضيف للحيطة روح بوهيمية دافية.</p>', description: '<p>مصنوعة يدويًا من البامبو الطبيعي.</p><p>تنفع للمدخل أو ركن التجهيز.</p>',
      seo_title: 'مرايا بامبو بوهيمي | Alaa Anas — إبتكر كلوب', seo_description: 'مراية بامبو طبيعي بستايل بوهيمي، شغل إيد من Alaa Anas — تضيف دفا لأي حيطة.' } });
  await expect(page.locator('.toast.show')).toContainText('اتحفظ على المنتج');
  // «اخرج» goes back to the product's descriptions
  await page.getByRole('button', { name: 'اخرج' }).click();
  await expect(page).toHaveURL(/#products-edit-9001-desc$/);
});

test('from a photo: shrunk in the browser and sent as a JPEG; a SKU that is no product is caught before any call', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await page.getByRole('tab', { name: 'من صورة' }).click();
  await page.setInputFiles('#ct-photo', { name: 'mirror.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.ct-photo img')).toBeVisible();
  await page.locator('[data-cwrite]').click();
  await expect(box(page, 'ar.short')).toBeVisible();
  const call = mock.aiCalls.at(-1);
  expect([call.source, call.image.media_type, call.image.data.length > 50, 'preview' in call.image]).toEqual(['image', 'image/jpeg', true, false]);
  await page.getByRole('tab', { name: 'من منتج على الموقع' }).click();
  await page.fill('#c-sku', 'NO-SUCH-SKU');
  await expect(page.locator('#pg-products')).toContainText('مفيش منتج بالـ SKU ده');
  await page.locator('[data-cwrite]').click();
  expect(mock.aiCalls.length).toBe(1);
});

test('the failures: the key not set, the monthly cap, busy and a refusal — a message, no text; then it works', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await page.fill('#c-n', 'Desk Lamp'); await pickBrand(page, 'Antikiano');
  for (const [fail, text] of [['not_configured', 'الـ AI لسه مش متوصّل'], ['ai_cap', 'وصلنا لحد الـ AI الشهري'], ['busy', 'الـ AI مشغول دلوقتي'], ['refused', 'Claude رفض يكتب']]) {
    mock.aiFail = fail;
    await page.locator('[data-cwrite]').click();
    await expect(page.locator('#pg-products .card').filter({ hasText: 'الناتج' })).toContainText(text);
    await expect(page.locator('[data-out]')).toHaveCount(0);
  }
  mock.aiFail = null;
  await page.getByRole('button', { name: 'جرّب تاني' }).click();
  await expect(box(page, 'ar.name')).toHaveText('مراية بامبو بوهيمي');
  expect(mock.aiRuns.map((r) => r.status)).toEqual(['error', 'cap', 'error', 'refused', 'ok']);
});

test('decision 8 — «إعدادات الـ AI» (the admin): the month\'s spend, the model / effort / cap saved to the settings row «ai»; the next call runs on them; the cap stops the tool; ops has no button', async ({ page }) => {
  await openProducts(page, 'admin.dev@ibtekr.local');
  await openTool(page);
  await page.locator('[data-cai-settings]').click();
  await expect(page.locator('.modal [data-ai-spend]')).toContainText('$0.00');
  await expect(page.locator('.modal [data-ai-spend]')).toContainText('0 نداء');
  await page.locator('#ai-model').click(); await page.getByRole('option', { name: 'Claude Sonnet 5.5 — أرخص بالنص' }).click();
  await expect(page.locator('.modal')).toContainText('تقريبًا $0.025 للمنتج');
  await page.locator('#ai-effort').click(); await page.getByRole('option', { name: 'سريع — تفكير أقل' }).click();
  await page.fill('#ai-cap', '20');
  await page.locator('[data-ai-save]').click();
  await expect(page.locator('.toast.show')).toContainText('اتحفظت إعدادات الـ AI');
  expect(mock.settings).toEqual([expect.objectContaining({ section: 'ai', data: { model: 'claude-sonnet-5-5', effort: 'low', monthly_limit_usd: 20 } })]);
  // the next call runs on the row (the mock reads it like the server)
  await page.fill('#c-n', 'Desk Lamp'); await pickBrand(page, 'Antikiano');
  await page.locator('[data-cwrite]').click();
  await expect(box(page, 'ar.name')).toHaveText('مراية بامبو بوهيمي');
  await expect(page.locator('#pg-products')).toContainText('claude-sonnet-5-5');
  expect(mock.aiRuns.map((r) => [r.model, r.cost_usd])).toEqual([['claude-sonnet-5-5', 0.026]]);
  await expect.poll(() => mock.activity.filter((a) => a.action === 'product.ai.settings').map((a) => a.new_value)).toEqual(['claude-sonnet-5-5 · low · $20']);
  // the spend shows the run; a cap the month's cost + the reserve would pass stops the next call
  await page.locator('[data-cai-settings]').click();
  await expect(page.locator('.modal [data-ai-spend]')).toContainText('$0.03 من أصل $20.00 · 1 نداء');
  await expect(page.locator('.modal [data-ai-spend]')).toContainText('أداة المحتوى 1 ($0.03) · الاستوديو 0 ($0.00)');
  await page.fill('#ai-cap', '0.5');
  await page.locator('[data-ai-save]').click();
  await expect(page.locator('.toast.show')).toContainText('اتحفظت إعدادات الـ AI');
  await page.locator('[data-cwrite]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'وصلنا لحد الـ AI الشهري' })).toBeVisible();
  expect(mock.aiRuns.at(-1).status).toBe('cap');
  await expect(box(page, 'ar.name')).toHaveText('مراية بامبو بوهيمي'); // the earlier text stays on the page
  // a bad cap is refused before any write
  await page.locator('[data-cai-settings]').click();
  await page.fill('#ai-cap', '-3');
  await page.locator('[data-ai-save]').click();
  await expect(page.locator('.toast.show')).toContainText('السقف لازم يكون رقم أكبر من صفر');
  expect(mock.settings[0].data.monthly_limit_usd).toBe(0.5);
});

test('decision 8 — ops (not the admin): no «إعدادات الـ AI» button, and saving the settings is refused by the adapter and the policies', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('[data-chistory]')).toBeVisible();
  await expect(page.locator('[data-cai-settings]')).toHaveCount(0);
  const r = await page.evaluate(() => window.IBAI.saveSettings({ model: 'claude-sonnet-5-5', effort: 'low', cap: null }));
  expect(r).toEqual({ ok: false, reason: 'forbidden' });
  // straight at the table (what the adapter refuses): the 0002 policy answers 42501
  const raw = await page.evaluate(async () => { const { error } = await window.IBSupabase.client.from('settings').upsert({ section: 'ai', data: { model: 'claude-sonnet-5-5' } }, { onConflict: 'section' }); return error ? error.code : null; });
  expect(raw).toBe('42501');
  expect(mock.settings).toEqual([]);
});

test('permissions: accounts (no products.add / edit) — the card needs a permission, the tool refuses, no AI button on the edit page', async ({ page }) => {
  await openProducts(page, ACCOUNTS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await expect(page.locator('[data-tool="content"]')).toContainText('محتاج صلاحية');
  await page.evaluate(() => { location.hash = 'products-tool-content'; });
  await expect(page.locator('#pg-products')).toContainText('مش مسموحلك تستخدم أداة المحتوى');
  await page.evaluate(() => { location.hash = 'products-edit-9001-desc'; });
  await expect(page.locator('#e-short')).toBeVisible();
  await expect(page.locator('[data-pai]')).toHaveCount(0);
  expect(mock.aiCalls).toEqual([]);
});
