import { readFileSync } from 'node:fs'; import { runInThisContext } from 'node:vm'; import { fileURLToPath } from 'node:url';
// The root package.json is "type": "module", so require() would load a UMD block as ESM (no `module`)
// and hand back an empty namespace. Run it with a CommonJS `module` so its module.exports branch is taken.
export function loadUmd(url) {
  const filename = fileURLToPath(url); const module = { exports: {} };
  runInThisContext(`(function (module) {${readFileSync(filename, 'utf8')}\n})`, { filename })(module);
  return module.exports;
}
