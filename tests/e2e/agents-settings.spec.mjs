import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// ش40 (the owner 17 Nov — «اعملي في السيتينج في قسم الذكاء الاصطناعي المساعدين و قسمها المصمم الاصطناعي و المبرمج الاصطناعي و الميديا باير
// الاصطناعي و حط لكل واحد فيهم قواعد و سكيلز … و خلي القواعد اقدر اعملها قسم و الاسكيلز نفس الكلام» · «ياريت الستسنج دي [التاجز] تيبقا
// موجودة في المصمم الاصطناعي») and ش41 (HR «الفريق»: «شيل الدور من الصفحة عشان موجود في الفلتر"). Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}

test('0120: «المساعدين» — the assistants table (+ مساعد جديد · ⋮ أرشف), then the rules and skills as one list each: an item says its assistants, a filter by assistant; the designer\'s trend tags', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  await page.locator('#pg-settings').getByRole('tab', { name: 'المساعدين' }).click();
  // the eight of the system, in their order
  await expect(page.locator('[data-ag-row] b')).toHaveText(['الميديا باير الذكي', 'الديزاينر الذكي', 'المبرمج الذكي', 'المخزن الذكي', 'خدمة العملاء الذكية', 'خدمة المبتكرين الذكية', 'المحاسب الذكي', 'الموارد البشرية الذكية']);
  // a new assistant: the name, the page that opens it, the data it reads — it opens on its own tab in «الذكاء الاصطناعي»
  await page.locator('[data-set-ag-add]').click();
  const md = page.locator('.modal[role=dialog]', { hasText: 'مساعد جديد' });
  await md.locator('input').first().fill('مساعد المنتجات');
  await md.locator('[data-ag-sees] .chip', { hasText: 'الأوردرات' }).click();
  await md.getByRole('button', { name: 'ضيف المساعد' }).click();
  await expect(page.locator('#pg-ai [role=tab][aria-selected=true]')).toContainText('مساعد المنتجات');
  const added = mock.mkt.aiAgents.find((a) => a.name === 'مساعد المنتجات');
  expect(added).toMatchObject({ perm: 'orders.view', sees: ['orders'], builtin: false });
  // back in the settings: a rule for two assistants, then one for all of them
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  await page.locator('#pg-settings').getByRole('tab', { name: 'المساعدين' }).click();
  await expect(page.locator('[data-ag-row] b')).toContainText(['مساعد المنتجات']);
  await page.locator('[data-kb-add="rules"]').click();
  let f = page.locator('.modal[role=dialog]', { hasText: 'قاعدة جديدة' });
  await f.locator('input').nth(0).fill('البراند'); await f.locator('input').nth(1).fill('الألوان'); await f.locator('textarea').fill('أخضر غامق ودهبي');
  await f.locator('[data-kb-agent="designer"]').click(); await f.locator('[data-kb-agent="buyer"]').click();
  await f.getByRole('button', { name: 'ضيف', exact: true }).click();
  await expect(page.locator('[data-kb="rules"] [data-kb-item]')).toContainText('الألوان');
  expect(mock.mkt.aiKb.filter((k) => k.kind === 'rules').map((k) => [k.section, k.title, k.agents])).toEqual([['البراند', 'الألوان', ['designer', 'buyer']]]);
  await expect(page.locator('[data-kb="rules"] [data-kb-to]')).toHaveText('الديزاينر الذكي · الميديا باير الذكي');
  await page.locator('[data-kb="rules"] [data-kb-add-item="rules:البراند"]').click();
  f = page.locator('.modal[role=dialog]', { hasText: 'قاعدة جديدة' });
  await f.locator('input').nth(1).fill('الكلام'); await f.getByRole('button', { name: 'ضيف', exact: true }).click();
  await expect.poll(() => mock.mkt.aiKb.filter((k) => k.kind === 'rules').map((k) => [k.title, k.agents])).toEqual([['الألوان', ['designer', 'buyer']], ['الكلام', []]]);
  // the filter: the accountant sees the one for all of them only, and a new rule under it is for him
  await page.locator('[data-kb-filter-id="accountant"]').click();
  await expect(page.locator('[data-kb="rules"] [data-kb-item]')).toHaveCount(1);
  await expect(page.locator('[data-kb="rules"] [data-kb-to]')).toHaveText('كل المساعدين');
  await expect(page.locator('[data-trend-chips]')).toHaveCount(0); // the tags are the designer's
  await page.locator('[data-kb-add="skills"]').click();
  f = page.locator('.modal[role=dialog]', { hasText: 'سكيل جديدة' });
  await expect(f.locator('[data-kb-agent="accountant"]')).toHaveAttribute('aria-pressed', 'true');
  await f.locator('input').nth(0).fill('التحليل'); await f.locator('input').nth(1).fill('المصروفات الكبيرة');
  await f.getByRole('button', { name: 'ضيف', exact: true }).click();
  await expect.poll(() => mock.mkt.aiKb.filter((k) => k.kind === 'skills').map((k) => [k.section, k.agents])).toEqual([['التحليل', ['accountant']]]);
  // ⋮ أرشف the new assistant — gone from «الذكاء الاصطناعي», «رجّعه» in the table
  await page.locator('[data-kb-filter-id="all"]').click();
  const row = page.locator('tr', { has: page.locator('[data-ag-row]', { hasText: 'مساعد المنتجات' }) });
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'أرشف' }).click();
  await page.locator('.modal').getByRole('button', { name: 'أرشف' }).click();
  await expect.poll(() => !!mock.mkt.aiAgents.find((a) => a.name === 'مساعد المنتجات').archived_at).toBe(true);
  await expect(row).toContainText('مؤرشف');
  // the designer's tags: several at once, the # dropped; two words become one tag with _; a mark that is no letter is refused in words
  await page.locator('[data-kb-filter-id="designer"]').click();
  await page.locator('[data-trend-add="tags"]').click();
  await page.locator('.modal input').first().fill('#Macrame، ديكور_منزلي');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect(page.locator('[data-trend-chips="tags"] .chip')).toHaveText(['#macrame ✕', '#ديكور_منزلي ✕']);
  expect(mock.mkt.trendCfg.tags).toEqual(['macrame', 'ديكور_منزلي']);
  await page.locator('[data-trend-add="tags"]').click();
  await page.locator('.modal input').first().fill('خصم!');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect(page.locator('body')).toContainText('التاج كلمة واحدة');
  expect(mock.mkt.trendCfg.tags).toEqual(['macrame', 'ديكور_منزلي']);
});

test('ش41: HR «الفريق» has no «الدور» dropdown of its own — the role is in the head\'s «فلتر»', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'hr-team'; });
  await expect(page.locator('#pg-hr')).toBeVisible();
  await expect(page.locator('#hr-role')).toHaveCount(0);
  await expect(page.locator('#pg-hr')).not.toContainText('الدور: الكل');
});

test('ش42: «تعليمات الذكاء الاصطناعي» in tabs — the providers first, one section at a time', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const st = page.locator('#pg-settings');
  await expect(st.getByRole('tab')).toContainText(['المزوّدين', 'الصور', 'الفيديو', 'المحتوى', 'المساعدين']);
  await expect(st.locator('[data-prov="text"]')).toBeVisible();
  await expect(st).not.toContainText('قواعد اللقطات');
  await st.getByRole('tab', { name: 'الصور', exact: true }).click();
  await expect(st).toContainText('قواعد اللقطات');
  await expect(st.locator('[data-prov]')).toHaveCount(0);
  await st.getByRole('tab', { name: 'المساعدين' }).click();
  await expect(st.locator('[data-kb-filter]')).toBeVisible();
  await expect(st).not.toContainText('قواعد اللقطات');
});

test('ش44: the media buyer\'s settings — the competitors (the same list) and the ad tags', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  const st = page.locator('#pg-settings');
  await st.getByRole('tab', { name: 'المساعدين' }).click();
  await page.locator('[data-kb-filter-id="buyer"]').click();
  await page.locator('[data-set-comp-add]').click();
  await page.locator('.modal #name').fill('Boho Corner');
  await page.getByRole('button', { name: 'ضيف المنافس' }).click();
  await expect(page.locator('[data-set-comp]')).toContainText(['Boho Corner']);
  expect(mock.mkt.competitors.map((c) => c.name)).toContain('Boho Corner');
  await page.locator('[data-ad-tag-add]').click();
  await page.locator('.modal input').first().fill('مكرمية، #ديكور   منزلي');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect(page.locator('[data-ad-tags] .chip')).toHaveText(['مكرمية ✕', 'ديكور منزلي ✕']);
  expect(mock.mkt.trendCfg.adTags).toEqual(['مكرمية', 'ديكور منزلي']);
});
