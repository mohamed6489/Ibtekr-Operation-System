// «نسخة التعليقات» — second half of shim.js: loads the tests' stand-in backend (tests/e2e/supabase-mock.mjs and what it imports,
// copied next to this file by build.mjs) with a page object that hands its route handlers to the shim, then signs in as the
// stand-in's admin through the sign-in screen itself (the same steps as the tests), so the app opens on the dashboard.
import { installSupabaseMock, USERS, DEV_PW } from './tests/e2e/supabase-mock.js';
import { demoSeed, demoAfter } from './seed.js';

const D = window.__ibDemo;
const page = {
  addInitScript: async (fn, arg) => { try { if (typeof fn === 'function') fn(arg); } catch (e) { /* a test-only preset */ } },
  route: async (pattern, handler) => { D.handlers.push({ pattern, handler }); },
  unroute: async () => {},
};
// seed.js: one made-up set for every section, so each page has something to show (the stand-in itself starts almost empty)
D.mock = await installSupabaseMock(page, demoSeed());
demoAfter(D.mock);
// the stand-in's Magnific account reads as linked here, so the studio's and the campaign's Magnific bars can be tried (demo data only)
if (D.mock.magnific) { D.mock.magnific.linked = true; D.mock.magnific.account = 'demo'; }
D.open();

const admin = USERS.find((u) => u.role_id === 'admin' && u.status === 'active');
const put = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
let sent = false; const t0 = Date.now();
const tick = setInterval(() => {
  const login = document.getElementById('login'); const root = document.getElementById('root');
  const inApp = root && !root.hidden && root.children.length && !(login && !login.hidden && login.offsetParent);
  if (sent && inApp) { clearInterval(tick); D.uncover(); return; }
  if (Date.now() - t0 > 14000) { clearInterval(tick); D.uncover(); return; }
  if (sent) return;
  const id = document.getElementById('lg-id'); const pw = document.getElementById('lg-pw');
  const go = login ? Array.from(login.querySelectorAll('button')).find((b) => b.textContent.trim() === 'دخول') : null;
  if (!id || !pw || !go) return;
  put(id, admin.email); put(pw, DEV_PW); go.click(); sent = true;
}, 120);
