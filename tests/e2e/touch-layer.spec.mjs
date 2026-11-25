import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The owner 21–22 Nov (docs/superpowers/plans/2026-11-22-touch-layer.md): the same pages laid out for a thumb on a phone and a
// tablet — css/mobile.css and js/pages/mobile.js, loaded last, no block touched — plus the header assistant's microphone
// (js/pages/ai-mic.js) and the account menu redrawn on a desktop. A mouse on a desktop keeps the pages as they were.
// What is checked here is what broke on a real iPhone and cannot be seen in a desktop run: popups cut inside sliding rows,
// taps eaten by the scroll guard, the calendar redrawing under a finger, the floating action drawn under the cards.
let mock = null; let pageErrors = [];
async function open(browser, baseURL, size, touch) {
  const ctx = await browser.newContext({ baseURL, locale: 'ar-EG', viewport: size, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage(); pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.goto('/'); await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click(); await expect(page.locator('#root')).toBeVisible();
  return { ctx, page };
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };
const done = async (ctx) => { await ctx.close(); expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); };
const header = (page) => page.evaluate(() => { const tb = document.querySelector('.topbar'); const t = tb.getBoundingClientRect(); const s = tb.querySelector('.search').getBoundingClientRect();
  const box = (q) => { const e = tb.querySelector(q); const r = e.getBoundingClientRect(); return { right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), seen: Math.round(r.width - 2 * parseFloat(getComputedStyle(e).borderLeftWidth)) }; };
  return { over: Math.round(s.top - t.top), under: Math.round(t.bottom - parseFloat(getComputedStyle(tb).borderBottomWidth) - s.bottom), search: Math.round(s.right), bell: box('.notif-btn'), ai: box('.ai-btn'), me: box('.user-btn'), pic: Math.round(tb.querySelector('.user-btn .avatar').getBoundingClientRect().width),
    quick: Math.round(tb.querySelector('.qa-anchor > .btn').getBoundingClientRect().width), clock: tb.querySelector('.clock-widget') ? Math.round((tb.querySelector('.clock-widget .btn, .clock-widget .clock') || tb).getBoundingClientRect().width) : 0 }; });

test.beforeEach(() => { test.skip(LIVE, 'the mocked Supabase only'); });

test('a phone: the header, the account sheet, the floating action, the period picker, lists inside popups, the page held still behind a popup, the assistant as a page with its microphone', async ({ browser, baseURL }) => {
  const { ctx, page } = await open(browser, baseURL, { width: 390, height: 844 }, true);
  // the header: the search, then the bell, the assistant, the account — circles of one size, the same room over and under the search
  const hd = await header(page);
  expect(hd.search).toBeGreaterThan(hd.bell.right); expect(hd.bell.right).toBeGreaterThan(hd.ai.right); expect(hd.ai.right).toBeGreaterThan(hd.me.right);
  for (const c of [hd.bell, hd.ai, hd.me]) { expect(c.w).toBe(44); expect(c.h).toBe(44); } expect(hd.bell.seen).toBe(36); expect(hd.ai.seen).toBe(36); expect(hd.pic).toBe(36);
  expect(hd.over).toBe(8); expect(hd.under).toBe(8); expect(hd.quick).toBeLessThanOrEqual(1);
  // «إجراءات سريعة» and the work clock are rows of the account's sheet; the member's picture heads it
  await page.tap('.topbar .user-btn'); const acct = page.locator('.menu.acct'); await expect(acct).toBeVisible();
  await expect(acct.locator('.acct-h .m-av')).toBeVisible(); await expect(acct.locator('[data-m-quick]')).toBeVisible(); await expect(acct.locator('[data-m-clock]')).toBeVisible();
  const sheet = await acct.boundingBox(); expect(sheet.x).toBe(0); expect(sheet.width).toBe(390); await page.keyboard.press('Escape'); await expect(acct).toHaveCount(0);
  // the page's main action floats from <body> (inside the head's sliding row Safari draws it under the table's cards)
  await go(page, 'inventory'); const fab = page.locator('[data-m-fab]'); await expect(fab).toBeVisible(); await expect(fab).toHaveText('استلام في المخزن');
  expect(await fab.evaluate((f) => f.parentElement === document.body)).toBe(true); await expect(page.locator('#pg-inventory .page-head .actions > .btn.btn-brand')).toBeHidden();
  await fab.tap(); await expect(page.locator('.scrim')).toBeVisible(); await expect(fab).toBeHidden(); await page.keyboard.press('Escape'); await expect(page.locator('.scrim')).toHaveCount(0); await expect(fab).toBeVisible();
  // the period picker: lifted out of the row it opens from, a sheet with the ready periods on one line, one month, both arrows
  await go(page, 'dashboard'); await expect(fab).toBeHidden(); await page.locator('.dash-period button').first().tap(); await page.waitForTimeout(500);
  const rp = await page.evaluate(() => { const d = document.querySelector('.dp.range'); const b = d.getBoundingClientRect(); let traps = 0; for (let a = d.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX + getComputedStyle(a).overflowY)) traps++;
    const chips = [...d.querySelectorAll('.presets .radio')].map((c) => Math.round(c.getBoundingClientRect().top)); const on = d.querySelector('.presets .radio[aria-checked="true"]').getBoundingClientRect();
    return { traps, lifted: !!d.closest('[data-m-portal]'), bottom: Math.round(b.bottom), left: Math.round(b.left), w: Math.round(b.width), chips: chips.length, chipLines: new Set(chips).size, onSeen: on.left >= 0 && on.right <= 390, months: [...d.querySelectorAll('.cal-grid')].filter((g) => g.getClientRects().length).length,
      arrows: [...d.querySelectorAll('.cal-h .icon-btn')].filter((a) => a.getClientRects().length).map((a) => a.getAttribute('aria-label')), day: Math.round(d.querySelector('.day').getBoundingClientRect().height), foot: Math.round(d.querySelector('.dp-foot .btn').getBoundingClientRect().bottom) }; });
  expect(rp.traps).toBe(0); expect(rp.lifted).toBe(true); expect(rp.left).toBe(0); expect(rp.w).toBe(390); expect(rp.bottom).toBe(844); expect(rp.foot).toBeLessThanOrEqual(844);
  expect(rp.chips).toBeGreaterThanOrEqual(10); expect(rp.chipLines).toBe(1); expect(rp.onSeen).toBe(true); expect(rp.months).toBe(1); expect(rp.arrows).toEqual(['الشهر السابق', 'الشهر التالي']); expect(rp.day).toBeGreaterThanOrEqual(40);
  // a period by its two days, one tap each: a finger's tap reaches a day as «the mouse came over it» first — the calendar is not
  // drawn again on that (Safari would keep the click back), and the day just tapped keeps the picked day's fill
  const days = page.locator('.dp.range .cal-grid .day:not(.outside)'); await days.nth(9).tap(); await expect(page.locator('.dp.range .presets .radio[aria-checked="true"]')).toHaveText('مخصص');
  expect(await page.evaluate(() => { const d = [...document.querySelectorAll('.dp.range .cal-grid .day:not(.outside)')][11]; const t = new Touch({ identifier: 3, target: d, clientX: 5, clientY: 5 });
    d.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, composed: true, touches: [t], targetTouches: [t], changedTouches: [t] })); d.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, composed: true, touches: [], targetTouches: [], changedTouches: [t] }));
    d.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); d.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); return d.isConnected; })).toBe(true);
  await page.locator('.dp.range .cal-grid .day.sel').first().hover(); const fill = await page.locator('.dp.range .cal-grid .day.sel').first().evaluate((d) => { const probe = document.createElement('i'); probe.style.color = 'var(--color-brand-default)'; d.appendChild(probe); const want = getComputedStyle(probe).color; probe.remove(); return [getComputedStyle(d).backgroundColor, want]; });
  expect(fill[0]).toBe(fill[1]);
  await days.nth(11).tap(); expect(await page.evaluate(() => [...document.querySelectorAll('.dp.range .range-row>.input input')].filter((i) => i.getClientRects().length).map((i) => i.value.slice(0, 2)))).toEqual(['10', '12']);
  await page.locator('.dp.range .dp-foot .btn-primary').tap(); await expect(page.locator('.dp.range')).toHaveCount(0); await expect(page.locator('[data-m-portal]')).toHaveCount(0);
  // a list inside a popup's scrolling body is lifted out of it too, and still sets its field
  await go(page, 'tickets'); await page.tap('[data-m-fab]'); await expect(page.locator('.scrim')).toBeVisible(); const kind = page.locator('.scrim [aria-haspopup="listbox"]').first(); await kind.tap();
  const list = page.locator('.scrim > [data-m-portal] > .menu'); await expect(list).toBeVisible(); const opt = list.locator('[role=option]').nth(2); const picked = (await opt.textContent()).trim(); await opt.tap();
  await expect(kind).toContainText(picked); await expect(page.locator('[data-m-portal]')).toHaveCount(0); await page.keyboard.press('Escape'); await expect(page.locator('.scrim')).toHaveCount(0);
  // nothing moves behind an open popup — and a tap inside it keeps its click (a move of a few pixels is not called off)
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x, y, dy) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 6 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(400); };
  await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(300); const at = await page.evaluate(() => Math.round(window.scrollY)); expect(at).toBeGreaterThan(100);
  await page.tap('.topbar .notif-btn'); await expect(page.locator('.menu.notif')).toBeVisible(); await page.waitForTimeout(400);
  await swipe(195, 90, -60); await swipe(195, 90, 60); expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(at);
  const held = await page.evaluate(() => { const el = document.querySelector('.menu.notif'); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + 20;
    const fire = (type, dy) => { const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y + dy, pageX: x, pageY: y + dy }); const e = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }); el.dispatchEvent(e); return e.defaultPrevented; };
    fire('touchstart', 0); const small = fire('touchmove', 3); fire('touchend', 3); return small; });
  expect(held).toBe(false);
  await page.touchscreen.tap(195, 30); await expect(page.locator('.menu.notif')).toHaveCount(0); expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
  await page.evaluate(() => window.scrollTo(0, 0));
  // the assistant: a page of its own with «إغلاق», the keyboard not thrown up by itself, the examples on one line, a microphone
  await page.tap('.ai-btn'); await page.waitForTimeout(400);
  const ai = await page.evaluate(() => { const r = document.querySelector('.ai-panel').getBoundingClientRect(); const ch = [...document.querySelectorAll('.ai-chips .btn')].map((c) => Math.round(c.getBoundingClientRect().top)); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), focus: document.activeElement.classList.contains('ai-input'), lines: new Set(ch).size, font: parseFloat(getComputedStyle(document.querySelector('.ai-input')).fontSize) }; });
  expect(ai.top).toBe(0); expect(ai.bottom).toBe(844); expect(ai.w).toBe(390); expect(ai.focus).toBe(false); expect(ai.lines).toBe(1); expect(ai.font).toBeGreaterThanOrEqual(16);
  await page.evaluate(() => { window.SpeechRecognition = class { start() { window.__sr = this; } stop() {} }; });
  const mic = page.locator('.ai-panel .ai-form [data-ai-mic]'); await expect(mic).toHaveAttribute('data-ai-mic', 'off'); await mic.tap(); await expect(mic).toHaveAttribute('data-ai-mic', 'on');
  await page.evaluate(() => { window.__sr.onresult({ results: [Object.assign([{ transcript: 'اعرض الأوردرات المتأخرة' }], { isFinal: true })] }); });
  await expect(page.locator('.ai-panel .ai-input')).toHaveValue('اعرض الأوردرات المتأخرة'); expect(await page.locator('.ai-panel .ai-msg.user').count()).toBe(0); // nothing is sent by voice alone
  await mic.tap(); await expect(mic).toHaveAttribute('data-ai-mic', 'off'); await page.locator('.ai-panel .ai-input').fill('');
  // set the keyboard and read in one step — the viewport handler can clear m-kb between two calls
  expect(await page.evaluate(() => { document.documentElement.style.setProperty('--m-vv-h', '420px'); document.documentElement.classList.add('m-kb'); return [Math.round(document.querySelector('.ai-panel').getBoundingClientRect().height), getComputedStyle(document.querySelector('.bottom-nav')).display]; })).toEqual([420, 'none']);
  await page.evaluate(() => { document.documentElement.classList.remove('m-kb'); window.dispatchEvent(new Event('resize')); });
  await page.tap('.ai-panel .ai-head .icon-btn'); await expect(page.locator('.ai-panel')).toBeHidden();
  // no page scrolls sideways with all of this on
  for (const pg of ['dashboard', 'orders', 'makers', 'accounts', 'inventory', 'products', 'cs', 'tickets', 'reports', 'hr', 'settings', 'profile']) { await go(page, pg);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, document.body.scrollWidth - document.body.clientWidth)), pg).toBeLessThanOrEqual(0); }
  await done(ctx);
});

test('a tablet: the same header; the number cards fill their rows; the assistant stays the desktop\'s box', async ({ browser, baseURL }) => {
  const { ctx, page } = await open(browser, baseURL, { width: 820, height: 1180 }, true);
  const hd = await header(page);
  expect(hd.search).toBeGreaterThan(hd.bell.right); expect(hd.bell.right).toBeGreaterThan(hd.ai.right); expect(hd.ai.right).toBeGreaterThan(hd.me.right);
  for (const c of [hd.bell, hd.ai, hd.me]) { expect(c.w).toBe(44); expect(c.h).toBe(44); } expect(hd.over).toBe(8); expect(hd.under).toBe(8);
  for (const pg of ['dashboard', 'hr', 'inventory', 'tickets']) { await go(page, pg);
    const gaps = await page.evaluate(() => { const main = [...document.querySelectorAll('main')].find((m) => m.getBoundingClientRect().height > 0); return [...main.querySelectorAll('*')].filter((g) => g.querySelector(':scope > .card.kpi') && g.getBoundingClientRect().width > 0).map((g) => { const k = g.getBoundingClientRect(); const c = [...g.querySelectorAll(':scope > .card.kpi')].map((e) => e.getBoundingClientRect()); const last = Math.max(...c.map((r) => Math.round(r.top))); const row = c.filter((r) => Math.round(r.top) === last); return Math.round(k.width - (Math.max(...row.map((r) => r.right)) - Math.min(...row.map((r) => r.left)))); }); });
    for (const gap of gaps) expect(gap, pg + ': a last line of cards that does not reach the end').toBeLessThanOrEqual(2); }
  await go(page, 'dashboard'); await page.tap('.ai-btn'); await page.waitForTimeout(400);
  const box = await page.locator('.ai-panel').boundingBox(); expect(box.width).toBeLessThanOrEqual(420); expect(box.y + box.height).toBeLessThan(1180); await expect(page.locator('.ai-panel [data-ai-mic]')).toBeVisible();
  await page.tap('.ai-panel .ai-head .icon-btn'); await expect(page.locator('[data-m-fab]')).toBeHidden();
  await done(ctx);
});

test('a desktop with a mouse: the account menu redrawn, the assistant\'s microphone, no sort list over the makers\' accounts — and none of the phone\'s layer', async ({ browser, baseURL }) => {
  const { ctx, page } = await open(browser, baseURL, { width: 1280, height: 800 }, false);
  expect(await page.evaluate(() => [document.documentElement.classList.contains('m-fab-on'), document.querySelectorAll('[data-m-portal]').length])).toEqual([false, 0]);
  const hd = await header(page); expect(hd.quick).toBeGreaterThan(40); // «إجراءات سريعة» is in the bar here, as it was
  // the account menu: the picture beside the name and the e-mail, every row in sight, each icon on a tile, the way out apart
  await page.locator('.topbar .user-btn').click(); const menu = page.locator('.menu.acct'); await expect(menu).toBeVisible();
  const m = await menu.evaluate((el) => { const r = el.getBoundingClientRect(); const av = el.querySelector('.acct-h .m-av').getBoundingClientRect(); const nm = el.querySelector('.acct-h b').getBoundingClientRect(); const opts = [...el.querySelectorAll('.opt')]; const last = opts[opts.length - 1]; const tile = getComputedStyle(opts[0].querySelector('svg'));
    return { w: Math.round(r.width), scrolls: el.scrollHeight > el.clientHeight + 1, av: Math.round(av.width), beside: av.left >= nm.right - 1, moved: el.querySelectorAll('.m-moved').length, lastDanger: last.classList.contains('danger'), gap: Math.round(last.getBoundingClientRect().top - opts[opts.length - 2].getBoundingClientRect().bottom), tile: tile.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(tile.width) >= 30 }; });
  expect(m.w).toBeGreaterThanOrEqual(280); expect(m.scrolls).toBe(false); expect(m.av).toBe(44); expect(m.beside).toBe(true); expect(m.moved).toBe(0); expect(m.lastDanger).toBe(true); expect(m.gap).toBeGreaterThanOrEqual(10); expect(m.tile).toBe(true);
  await menu.locator('.opt', { hasText: 'ملفي' }).click(); await expect(page.locator('#pg-profile')).toBeVisible(); await expect(menu).toHaveCount(0);
  // the assistant: the box under its button, with a microphone that writes what is said into the box
  await page.locator('.ai-btn').click(); const mic = page.locator('.ai-panel [data-ai-mic]'); await expect(mic).toBeVisible(); expect((await page.locator('.ai-panel').boundingBox()).width).toBeLessThanOrEqual(420);
  await page.evaluate(() => { window.SpeechRecognition = class { start() { window.__sr = this; } stop() {} }; }); await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.__sr.onresult({ results: [Object.assign([{ transcript: 'افتح الأوردرات' }], { isFinal: true })] }); }); await expect(page.locator('.ai-panel .ai-input')).toHaveValue('افتح الأوردرات');
  await page.locator('.ai-panel .ai-head .icon-btn').click(); await expect(mic).toHaveAttribute('data-ai-mic', 'off'); // closing the panel stops the listening
  // «حسابات المبتكرين»: no «ترتيب» list in the bar over the table (the table has its own); the other two controls are there
  await go(page, 'makers'); await page.locator('main:not([hidden]) .tab', { hasText: 'حسابات المبتكرين' }).click(); await page.waitForTimeout(600);
  const bar = await page.evaluate(() => [...document.querySelectorAll('#vpanel > .toolbar .sort-btn, #vpanel > .toolbar .btn')].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()));
  expect(bar.some((t) => /^الرصيد:/.test(t))).toBe(false); expect(bar.some((t) => /طلبات السحب/.test(t))).toBe(true); expect(bar.some((t) => /إضافة مبلغ/.test(t))).toBe(true);
  await done(ctx);
});

// The owner 22 Nov («خلي التصميم يشتغل علي الموبايل بكل احترافي»): the providers card on a phone and a tablet — one column of boxes,
// and the company-and-model list comes up from the bottom as the filter does, with its title, its tabs and its rows a thumb wide
test('the AI providers card: a phone — one column, the company-and-model list a sheet from the bottom; a tablet — the tools three across under their section', async ({ browser, baseURL }) => {
  const { ctx, page } = await open(browser, baseURL, { width: 390, height: 844 }, true);
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-' + 'a'.repeat(40) }); mock.st.vault.openai = JSON.stringify({ key: 'sk-' + 'o'.repeat(40) });
  await go(page, 'settings-ai');
  await expect(page.locator('[data-prov="text"]')).toHaveAttribute('data-prov-live', 'claude openai');
  await page.locator('#prov-auto').tap(); await expect(page.locator('[data-prov-auto]')).toHaveAttribute('data-prov-auto', 'off');
  const lay = await page.evaluate(() => { const b = [...document.querySelectorAll('.prov-grid [data-prov]')].map((e) => e.getBoundingClientRect()); const f = [...document.querySelectorAll('[data-prov="text"] .select')].map((e) => e.getBoundingClientRect());
    return { over: document.documentElement.scrollWidth - innerWidth, oneColumn: b.every((r) => Math.abs(r.left - b[0].left) < 1 && Math.abs(r.width - b[0].width) < 1), fields: f.length, stacked: f.every((r, i) => !i || r.top > f[i - 1].bottom), tall: Math.min(...f.map((r) => r.height)) }; });
  expect(lay.over).toBeLessThanOrEqual(0); expect(lay.oneColumn).toBe(true); expect(lay.fields).toBe(4); expect(lay.stacked).toBe(true); expect(lay.tall).toBeGreaterThanOrEqual(44);
  await expect(async () => { await page.keyboard.press('Escape'); await page.locator('#prov-text-marketing').tap({ timeout: 1500 }); await expect(page.locator('.cm-menu [data-cm-tab]')).toHaveCount(2, { timeout: 1000 }); await page.waitForTimeout(600); await expect(page.locator('.cm-menu')).toBeVisible({ timeout: 500 }); }).toPass();
  const sheet = await page.evaluate(() => { const m = document.querySelector('.cm-menu'); const r = m.getBoundingClientRect(); const t = m.querySelector('.cm-title'); const hit = document.elementFromPoint(innerWidth / 2, r.top + 30);
    return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), vh: innerHeight, title: t.textContent, titleSeen: t.getBoundingClientRect().height > 0, onTop: !!hit && m.contains(hit),
      tabs: Math.min(...[...m.querySelectorAll('[data-cm-tab]')].map((e) => e.getBoundingClientRect().height)), rows: Math.min(...[...m.querySelectorAll('[role=option]')].filter((e) => e.getBoundingClientRect().height).map((e) => e.getBoundingClientRect().height)) }; });
  expect(sheet.left).toBe(0); expect(sheet.right).toBe(390); expect(sheet.bottom).toBe(sheet.vh); expect(sheet.titleSeen).toBe(true); expect(sheet.title).toBe('المحتوى (النصوص) › التسويق');
  expect(sheet.onTop).toBe(true); expect(sheet.tabs).toBeGreaterThanOrEqual(44); expect(sheet.rows).toBeGreaterThanOrEqual(48);
  await page.locator('.cm-menu [data-cm-tab="openai"]').tap(); await page.locator('.cm-menu [data-cm="openai:gpt-5.2"]').tap();
  await expect(page.locator('.cm-menu')).toHaveCount(0); await expect(page.locator('#prov-text-marketing')).toHaveText('ChatGPT — GPT-5.2');
  await done(ctx);
  // a tablet, upright: the section's own field across, its three tools on one line under it; the list stays under its field
  const t = await open(browser, baseURL, { width: 820, height: 1180 }, true);
  mock.st.vault.anthropic = JSON.stringify({ key: 'sk-ant-' + 'a'.repeat(40) });
  await go(t.page, 'settings-ai');
  await expect(t.page.locator('[data-prov="text"]')).toHaveAttribute('data-prov-live', 'claude');
  const tl = await t.page.evaluate(() => { const main = document.querySelector('[data-prov="text"] .prov-main .select').getBoundingClientRect(); const tools = [...document.querySelectorAll('[data-prov="text"] .prov-tools .select')].map((e) => e.getBoundingClientRect());
    const v = document.querySelector('[data-prov="voice"]').getBoundingClientRect(); const d = document.querySelector('[data-prov="video"]').getBoundingClientRect();
    return { over: document.documentElement.scrollWidth - innerWidth, under: tools.every((r) => r.top > main.bottom), line: tools.every((r) => Math.abs(r.top - tools[0].top) < 1), halves: Math.abs(v.top - d.top) < 1 && v.width < main.width }; });
  expect(tl.over).toBeLessThanOrEqual(0); expect(tl.under).toBe(true); expect(tl.line).toBe(true); expect(tl.halves).toBe(true);
  await done(t.ctx);
});
