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

test('ش40: «المساعدين» — a tab per assistant; rules and skills in named sections, each change saved at once (mkt_agent_kb_set); the designer\'s trend tags and sites', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-ai'; });
  await page.locator('#pg-settings').getByRole('tab', { name: 'المساعدين' }).click();
  const tabs = page.locator('[data-agent-tabs]');
  await expect(tabs.getByRole('tab')).toHaveText(['المصمم الاصطناعي', 'المبرمج الاصطناعي', 'الميديا باير الاصطناعي']);
  // a rules section, then a rule in it
  await page.locator('[data-kb-add-group="rules"]').click();
  await page.locator('.modal input').first().fill('البراند');
  await page.getByRole('button', { name: 'ضيف القسم' }).click();
  await expect(page.locator('[data-kb="rules"] .kb-group')).toHaveCount(1);
  await page.locator('[data-kb="rules"] [data-kb-add-item]').click();
  await page.locator('.modal input').first().fill('الألوان');
  await page.locator('.modal textarea').fill('أخضر غامق ودهبي — من غير ألوان نيون');
  await page.getByRole('button', { name: 'ضيف', exact: true }).click();
  await expect(page.locator('[data-kb="rules"] [data-kb-item]')).toContainText('الألوان');
  expect(mock.mkt.agents.designer.rules).toEqual([{ id: expect.any(String), name: 'البراند', items: [{ id: expect.any(String), title: 'الألوان', text: 'أخضر غامق ودهبي — من غير ألوان نيون' }] }]);
  // a skill for the media buyer — its own tab, its own list
  await tabs.getByRole('tab', { name: 'الميديا باير الاصطناعي' }).click();
  await expect(page.locator('[data-kb="rules"]')).toHaveCount(0);
  await page.locator('[data-kb-add-group="skills"]').click();
  await page.locator('.modal input').first().fill('التحليل');
  await page.getByRole('button', { name: 'ضيف القسم' }).click();
  await expect.poll(() => (mock.mkt.agents.buyer && mock.mkt.agents.buyer.skills || []).map((g) => g.name)).toEqual(['التحليل']);
  await expect(page.locator('[data-trend-chips]')).toHaveCount(0); // the tags are the designer's
  // the designer's tags: several at once, the # dropped; two words become one tag with _; a mark that is no letter is refused in words
  await tabs.getByRole('tab', { name: 'المصمم الاصطناعي' }).click();
  await page.locator('[data-trend-add="tags"]').click();
  await page.locator('.modal input').first().fill('#Macrame، ديكور_منزلي');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect(page.locator('[data-trend-chips="tags"] .chip')).toHaveText(['#macrame ✕', '#ديكور_منزلي ✕']);
  expect(mock.mkt.trendCfg.tags).toEqual(['macrame', 'ديكور_منزلي']);
  await page.locator('[data-trend-add="tags"]').click();
  await page.locator('.modal input').first().fill('هدايا الشتا');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect.poll(() => mock.mkt.trendCfg.tags).toEqual(['macrame', 'ديكور_منزلي', 'هدايا_الشتا']);
  await page.locator('[data-trend-add="tags"]').click();
  await page.locator('.modal input').first().fill('خصم!');
  await page.locator('.modal').getByRole('button', { name: /حفظ|ضيف|تم/ }).last().click();
  await expect(page.locator('body')).toContainText('التاج كلمة واحدة');
  expect(mock.mkt.trendCfg.tags).toEqual(['macrame', 'ديكور_منزلي', 'هدايا_الشتا']);
});

test('ش41: HR «الفريق» has no «الدور» dropdown of its own — the role is in the head\'s «فلتر»', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'hr-team'; });
  await expect(page.locator('#pg-hr')).toBeVisible();
  await expect(page.locator('#hr-role')).toHaveCount(0);
  await expect(page.locator('#pg-hr')).not.toContainText('الدور: الكل');
});
