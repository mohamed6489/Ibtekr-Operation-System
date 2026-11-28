// «نسخة التعليقات» (the owner 15 Nov): builds a copy of the app that runs inside a claude.ai Artifact, where he writes his
// comments on the pages instead of sending screenshots. An Artifact may not reach any host, so the copy runs on the tests'
// stand-in backend inside the page (tools/demo/shim.js + boot.js): made-up data, no real address, no real key, nothing written
// anywhere. Usage: `npm run demo` (→ dist/demo) or `node tools/demo/build.mjs <out dir>`; then publish <out>/index.html with the
// files in <out>/files.json (the Artifact tool's `files`, `root` = <out>).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_HOST = 'demo.ibtekr.invalid'; // RFC 2606: never resolves — a request the shim missed goes nowhere
export const DEMO_TITLE = 'نظام إبتكر التجريبي';
const MOCK = 'tests/e2e/supabase-mock.mjs';
const IMPORT = /^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
/** What must never be in the copy: the project's address, its publishable key, the dev users' password. */
export const FORBIDDEN = [/fsynculhaupcktzkfkdd/, /sb_publishable_[A-Za-z0-9_-]{16,}/, /eyJhbGciOi[A-Za-z0-9_-]{20,}/, /IbtekrDev-/];

function walk(dir, base = dir, out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, base, out); else out.push(relative(base, p).split('\\').join('/')); }
  return out;
}
/** The stand-in and every file it imports (all relative), as repository paths. */
export function mockFiles() {
  const seen = new Set();
  const visit = (f) => {
    f = normalize(f).split('\\').join('/'); if (seen.has(f)) return; seen.add(f);
    const src = readFileSync(join(ROOT, f), 'utf8'); let m; IMPORT.lastIndex = 0;
    while ((m = IMPORT.exec(src))) { const sp = m[1] || m[2]; if (!sp.startsWith('.')) throw new Error(`demo: ${f} imports «${sp}» — only relative imports run in the page`); visit(join(dirname(f), sp)); }
  };
  visit(MOCK); return [...seen];
}
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/g; // + U+FFFD: bytes of the vendored xlsx that are not UTF-8 (a browser reads them as U+FFFD too)
const demoText = (s) => s.replace(/fsynculhaupcktzkfkdd\.supabase\.co/g, DEMO_HOST).replace(/IbtekrDev-2026/g, 'demo-pass').replace(/(from\s*['"][^'"]+)\.mjs(['"])/g, '$1.js$2');

export function build(out) {
  out = resolve(out); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  // 1) the app as it is: its styles and scripts (not the server's .htaccess, the other pages, or the real config)
  for (const d of ['css', 'js', 'img']) cpSync(join(ROOT, 'app', d), join(out, d), { recursive: true, filter: (p) => !/\.md$/.test(p) });
  writeFileSync(join(out, 'config.js'), `// the demo copy: the stand-in's address (never resolves) and its made-up key\nwindow.IB_CONFIG = { supabaseUrl: 'https://${DEMO_HOST}', supabaseAnonKey: 'mock-anon-key', realtime: false };\n`);
  // 2) the stand-in backend, as browser modules next to the shim
  for (const f of mockFiles()) { const to = join(out, 'demo', f.replace(/\.mjs$/, '.js')); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, demoText(readFileSync(join(ROOT, f), 'utf8'))); }
  for (const f of ['shim.js', 'boot.js', 'seed.js']) cpSync(join(ROOT, 'tools', 'demo', f), join(out, 'demo', f));
  // 3) the page: the Artifact wraps it in its own <html><head><body>, so only the head's links and the body's content go in
  const html = readFileSync(join(ROOT, 'app', 'index.html'), 'utf8');
  const links = (html.match(/<link\b[^>]*>/g) || []).join('');
  const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];
  const at = body.indexOf('<script src="config.js">'); if (at < 0) throw new Error('demo: app/index.html no longer loads config.js first');
  const page = `<title>${DEMO_TITLE}</title>\n${links}\n${body.slice(0, at)}<script src="demo/shim.js"></script><script type="module" src="demo/boot.js"></script>\n${body.slice(at)}`;
  writeFileSync(join(out, 'index.html'), page.trim() + '\n');
  // 4) nothing real in the copy, and no raw control character or U+FFFD (an Artifact refuses a file that carries one — the vendored
  // xlsx and supabase-js hold a few inside their string literals; the same character written as its escape is the same string)
  const files = walk(out).filter((f) => f !== 'index.html' && f !== 'files.json').sort();
  for (const f of ['index.html', ...files].filter((x) => !/\.(webp|png|jpe?g|gif)$/i.test(x))) { // pictures (the «إزاي…» screens) are bytes, not text
    let s = readFileSync(join(out, f), 'utf8'); const hit = FORBIDDEN.find((re) => re.test(s)); if (hit) throw new Error(`demo: ${f} still holds ${hit}`);
    if (!CONTROL.test(s)) continue; CONTROL.lastIndex = 0;
    if (!/\.js$/.test(f)) throw new Error(`demo: ${f} holds a raw control character`);
    s = s.replace(CONTROL, (c, at) => { let n = 0; while (s[at - 1 - n] === '\\') n++; if (n % 2) throw new Error(`demo: ${f} escapes a raw control character at ${at}`); const k = c.charCodeAt(0); return k < 256 ? '\\x' + k.toString(16).padStart(2, '0') : '\\u' + k.toString(16).padStart(4, '0'); });
    writeFileSync(join(out, f), s);
  }
  writeFileSync(join(out, 'files.json'), JSON.stringify(files.map((path) => ({ path }))));
  return { out, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, files } = build(process.argv[2] || join(ROOT, 'dist', 'demo'));
  console.log(`demo copy: ${out} — index.html + ${files.length} files${existsSync(join(out, 'files.json')) ? ' (files.json lists them)' : ''}`);
}
