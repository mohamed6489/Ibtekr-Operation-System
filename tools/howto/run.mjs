// Takes the «إزاي…» guides' screenshots from the demo copy (tools/demo — made-up data): node tools/howto/run.mjs <demo dir> <out dir> [guide…]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { RECIPES, NAV, TAB } from './recipes.mjs';
const [root, out, ...only] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const srv = createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/full.html'; const f = join(root, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f)); }).listen(4391);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const HL = 'outline:3px solid #e0a13a !important;outline-offset:2px !important;box-shadow:0 0 0 6px rgba(224,161,58,.28) !important;';
async function fresh() {
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
  pg.on('pageerror', (e) => console.log('  pageerror', e.message)); pg.setDefaultTimeout(5000);
  await pg.goto('http://localhost:4391/'); await pg.waitForFunction(() => document.querySelector('#root') && !document.querySelector('#root').hidden && window.IBPages);
  await pg.addStyleTag({ content: '#demo-mark,[data-to-top],.busy,.toast,.toasts{display:none!important} [data-howto-hl]{' + HL + '}' });
  await pg.waitForTimeout(1500); return pg;
}
const go = async (pg, hash) => { await pg.evaluate((x) => { location.hash = x; }, hash); await pg.waitForTimeout(1400); };
for (const [id, steps] of Object.entries(RECIPES)) {
  if (only.length && !only.includes(id)) continue;
  const pg = await fresh(); console.log(id);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    try {
      if (s.go) await go(pg, s.go);
      if (s.nav) await NAV(pg, s.nav);
      if (s.tab) await TAB(pg, s.tab);
      if (s.act) { await s.act(pg); await pg.waitForTimeout(700); }
      await pg.evaluate(() => { const walk = (r) => { r.querySelectorAll('[data-howto-hl]').forEach((x) => { x.removeAttribute('data-howto-hl'); x.style.cssText = x.dataset.howtoWas || ''; }); r.querySelectorAll('*').forEach((e) => e.shadowRoot && walk(e.shadowRoot)); }; walk(document); });
      if (s.hl) { const l = typeof s.hl === 'function' ? s.hl(pg) : pg.locator(s.hl).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); await l.evaluate((x, hl) => { x.dataset.howtoWas = x.style.cssText; x.setAttribute('data-howto-hl', ''); x.style.cssText += ';' + hl; }, HL); s.box = await l.boundingBox(); }
      await pg.waitForTimeout(250);
      const f = join(out, `${id}-${i + 1}.png`);
      if (s.clip) { const l = typeof s.clip === 'function' ? s.clip(pg) : pg.locator(s.clip).first(); await l.screenshot({ path: f }); }
      else if (s.hl && !s.full) { // the part of the window around the thing to press, big enough to see where it is
        const bb = s.box; const W = s.w || 820; const H = s.h || 460;
        const x = Math.max(0, Math.min(1280 - W, bb.x + bb.width / 2 - W / 2)); const y = Math.max(0, Math.min(800 - H, bb.y + bb.height / 2 - H / 2));
        await pg.screenshot({ path: f, clip: { x, y, width: W, height: H } }); }
      else await pg.screenshot({ path: f, clip: s.area || { x: 0, y: 0, width: 1072, height: 800 } });
      console.log('  ok', i + 1);
    } catch (e) { console.log('  FAIL', i + 1, String(e.message).split('\n')[0]); await pg.screenshot({ path: join(out, `${id}-${i + 1}-fail.png`) }); }
  }
  await pg.close();
}
// every shot → WebP, no wider than 760px (the chat shows it at its width; a click opens it full)
const conv = await b.newPage();
for (const f of readdirSync(out).filter((n) => /\.png$/.test(n) && !/-fail\.png$/.test(n))) {
  const b64 = readFileSync(join(out, f)).toString('base64');
  const webp = await conv.evaluate(async (src) => { const im = new Image(); im.src = src; await im.decode(); const k = Math.min(1, 760 / im.width);
    const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.82).split(',')[1]; }, 'data:image/png;base64,' + b64);
  writeFileSync(join(out, f.replace(/\.png$/, '.webp')), Buffer.from(webp, 'base64')); unlinkSync(join(out, f));
}
await b.close(); srv.close();
