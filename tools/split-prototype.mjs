// Splits the one-file prototype into app/: two stylesheets, one file per <script> block, and index.html.
// split() keeps every byte it does not hand to a file, so join() in join-prototype.mjs rebuilds the
// source exactly; tests/split.test.mjs proves join(split(src)) === src.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BLOCKS = JSON.parse(readFileSync(new URL('./blocks.json', import.meta.url), 'utf8'));

// The next `open`…`close` element at or after `from`: the text before it, its body, and the offset after it.
function nextElement(src, from, open, close) {
  const start = src.indexOf(open, from);
  if (start < 0) return null;
  const end = src.indexOf(close, start + open.length);
  if (end < 0) throw new Error(`${open} at offset ${start} has no ${close}`);
  return { before: src.slice(from, start), body: src.slice(start + open.length, end), after: end + close.length };
}

function requireElement(src, from, open, close) {
  const element = nextElement(src, from, open, close);
  if (!element) throw new Error(`expected ${open} after offset ${from}`);
  return element;
}

/**
 * Returns the parts in source order; joining them with their tags gives back `src`:
 *   head      text before the base <style> (doctype, <head>, meta tags)
 *   baseCss   body of the first <style> (line 1)
 *   headRest  text between that </style> and the app <style> (</head><body>, <title>, Cairo font link)
 *   appCss    body of the second <style> (lines 5–1152)
 *   rootDiv   text between the app </style> and the first <script>
 *   blocks    [{ n, file, code }] — one per <script>, named from tools/blocks.json
 *   gaps      gaps[i] is the text between blocks[i]'s </script> and blocks[i + 1]'s <script>
 *   tail      text after the last </script>
 */
export function split(src) {
  const base = requireElement(src, 0, '<style>', '</style>');
  const app = requireElement(src, base.after, '<style>', '</style>');
  const scripts = [];
  let pos = app.after;
  for (let script; (script = nextElement(src, pos, '<script>', '</script>')); pos = script.after) scripts.push(script);
  if (scripts.length !== BLOCKS.length) {
    throw new Error(`expected ${BLOCKS.length} <script> blocks (tools/blocks.json), found ${scripts.length}`);
  }
  return {
    head: base.before,
    baseCss: base.body,
    headRest: app.before,
    appCss: app.body,
    rootDiv: scripts[0].before,
    blocks: scripts.map((script, i) => ({ n: BLOCKS[i].n, file: BLOCKS[i].file, code: script.body })),
    gaps: scripts.slice(1).map((script) => script.before),
    tail: src.slice(pos),
  };
}

// Load order is fixed: styles, root div, config + Supabase adapters (added in Task 5), then the blocks in prototype order.
function indexHtml(blocks) {
  return [
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<title>نظام إبتكر</title>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;900&display=swap">',
    '<link rel="stylesheet" href="css/base.css"><link rel="stylesheet" href="css/app.css">',
    '</head><body>',
    '<div id="root" dir="rtl" lang="ar"></div>',
    '<script src="config.js"></script><script src="js/vendor/supabase.js"></script>',
    '<script src="js/adapter/supabase-client.js"></script><script src="js/adapter/auth.js"></script><script src="js/adapter/directory.js"></script><script src="js/adapter/activity.js"></script>',
    '<!-- blocks, in prototype order -->',
    ...blocks.map((block) => `<script src="js/blocks/${block.file}"></script>`),
    '</body></html>',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const parts = split(readFileSync(resolve(root, 'Prototype file', 'نظام إبتكر.html'), 'utf8'));
  const write = (file, text) => {
    const path = resolve(root, 'app', file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write('css/base.css', parts.baseCss);
  write('css/app.css', parts.appCss);
  for (const block of parts.blocks) write(`js/blocks/${block.file}`, block.code);
  write('index.html', indexHtml(parts.blocks));
  console.log(`app/: css/base.css, css/app.css, ${parts.blocks.length} files in js/blocks/, index.html`);
}
