import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner's settings batch of 16 Nov (docs/superpowers/plans/2026-11-15-comments.md ش30–ش34): the unsaved-changes bar green and as
// wide as the page's content; «البيانات الرسمية» in «بيانات الشركة» (السجل التجاري، البطاقة الضريبية، …) saved in the row «general»;
// more Google fonts and a font of one's own (bucket settings — 0116, the type from the file's first bytes). Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => { test.skip(LIVE, 'the mocked Supabase only'); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = await installSupabaseMock(page); });
test.afterEach(() => { expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/'); await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW); await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function openSettings(page, section) {
  await page.evaluate((s) => { location.hash = 'settings-' + s; }, section);
  await expect(page.locator('#pg-settings .set-page')).toBeVisible();
}
const settingsRow = (section) => mock.settings.find((r) => r.section === section);

test('ش30 + ش33: the company\'s official numbers are fields in «بيانات الشركة»; typing shows the save bar — green, no wider than the page\'s content — and «حفظ» writes them to the row «general»', async ({ page }) => {
  await signIn(page);
  await openSettings(page, 'general');
  await expect(page.locator('[data-set-legal]')).toHaveText('البيانات الرسمية');
  for (const id of ['#g-cr', '#g-cro', '#g-tax', '#g-taxo', '#g-vat', '#g-einv']) await expect(page.locator(id)).toBeVisible();
  await page.locator('#g-cr').fill('123456'); await page.locator('#g-tax').fill('987-654-321'); await page.locator('#g-taxo').fill('مأمورية مدينة نصر');
  const bar = page.locator('#pg-settings .save-bar');
  await expect(bar).toBeVisible();
  const look = await bar.evaluate((b) => { const cs = getComputedStyle(b); const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-default').trim(); const probe = document.createElement('i'); probe.style.color = brand; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); const wrap = document.querySelector('[data-set-wrap]').getBoundingClientRect(); return { bg: cs.backgroundColor, want, w: b.getBoundingClientRect().width, wrap: wrap.width }; });
  expect(look.bg).toBe(look.want);
  expect(look.w).toBeLessThanOrEqual(look.wrap + 1);
  await page.locator('[data-set-save]').click();
  await expect.poll(() => settingsRow('general') && settingsRow('general').data.crNo).toBe('123456');
  expect(settingsRow('general').data).toMatchObject({ taxNo: '987-654-321', taxOffice: 'مأمورية مدينة نصر' });
});

test('ش34: more fonts in the lists; «ارفع خط من عندك» takes a WOFF2 (by its bytes) into bucket settings and the row brand, offers it in both lists, and «مسح» takes it out; a picture renamed .ttf is refused', async ({ page }) => {
  await signIn(page);
  await openSettings(page, 'brand');
  await page.locator('#f-body').click();
  await expect(page.getByRole('option', { name: 'المسيري' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'ألكسندريا' })).toBeVisible();
  await page.keyboard.press('Escape');
  // not a font: refused before any upload
  await page.locator('#font-up').setInputFiles({ name: 'fake.ttf', mimeType: 'font/ttf', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  await expect(page.getByText('ارفع ملف خط WOFF2 أو WOFF أو TTF أو OTF')).toBeVisible();
  expect(mock.st.writes.filter((w) => w.table === 'storage')).toEqual([]);
  // a WOFF2
  await page.locator('#font-up').setInputFiles({ name: 'Ibtekr_Sans.woff2', mimeType: 'font/woff2', buffer: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]) });
  await expect(page.locator('[data-own-font]')).toHaveCount(1);
  await expect(page.locator('[data-own-font]')).toContainText('Ibtekr Sans');
  await expect.poll(() => { const r = settingsRow('brand'); return r && r.data.fonts && (r.data.fonts.custom || []).length; }).toBe(1);
  const f = settingsRow('brand').data.fonts.custom[0];
  expect(f.id).toMatch(/^ibf-[a-z0-9]{4,16}$/); expect(f.path).toMatch(/^brand\/font-[a-z0-9]+\.woff2$/); expect(f.name).toBe('Ibtekr Sans');
  expect(mock.st.writes.filter((w) => w.table === 'storage').map((w) => w.key)).toEqual(['settings/' + f.path]);
  // the save redraws the page once or twice right after the upload — open and pick again until it takes
  await expect(async () => {
    await page.locator('#f-head').click();
    await page.getByRole('option', { name: 'Ibtekr Sans — مرفوع' }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-head'))).toContain(f.id);
  await expect.poll(() => settingsRow('brand').data.fonts.head).toBe(f.id);
  await page.getByRole('button', { name: 'مسح الخط Ibtekr Sans' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'امسح' }).click();
  await expect(page.locator('[data-own-font]')).toHaveCount(0);
  await expect.poll(() => (settingsRow('brand').data.fonts.custom || []).length).toBe(0);
  await expect.poll(() => settingsRow('brand').data.fonts.head).toBe('Cairo');
});
