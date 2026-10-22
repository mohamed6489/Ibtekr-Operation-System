### Task 1: تقسيم البروتوتايب بشكل حتمي وقابل للتحقق

**Files:**
- Create: `package.json`, `tools/blocks.json`, `tools/split-prototype.mjs`, `tools/join-prototype.mjs`, `tests/split.test.mjs`
- Create (generated): `app/index.html`, `app/css/base.css`, `app/css/app.css`, `app/js/blocks/*.js`

**Interfaces:**
- Consumes: `Prototype file/نظام إبتكر.html` (السطر 1: `<!doctype html>…<style>…</style></head><body>`؛ السطر 5–1152: `<style>…</style>`؛ السطر 1153: `<div id="root" dir="rtl" lang="ar"></div>`؛ بعدها 29 كتلة `<script>…</script>`؛ آخر سطر `</body></html>`).
- Produces: `split(sourceText) → { head: string, baseCss: string, appCss: string, rootDiv: string, blocks: [{n, file, code}], tail: string }` و `join(parts) → string` في الملفين تحت `tools/`، و`npm test` بيشغّل `node --test tests/`.

- [ ] **Step 1: اكتب `package.json`** بـ `"type": "module"`, `"private": true`, scripts: `"test": "node --test tests/"`, `"split": "node tools/split-prototype.mjs"`, `"serve": "npx http-server app -p 4173 -c-1"`, `"e2e": "npx playwright test -c tests/playwright.config.mjs"`. devDependencies: `http-server`, `@playwright/test` (أحدث نسخة وقت التنفيذ، مثبّتة بالرقم).

- [ ] **Step 2: اكتب `tools/blocks.json`** بالـ 29 اسم من "أسماء الكتل" فوق: `[{"n":1,"file":"01-dataio.js"}, …]`.

- [ ] **Step 3: اكتب الاختبار الفاشل `tests/split.test.mjs`**

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { split } from '../tools/split-prototype.mjs'; import { join } from '../tools/join-prototype.mjs';
const SRC = 'Prototype file/نظام إبتكر.html';
test('split yields 29 blocks in order', () => {
  const p = split(readFileSync(SRC, 'utf8'));
  assert.equal(p.blocks.length, 29);
  assert.equal(p.blocks[0].file, '01-dataio.js');
  assert.equal(p.blocks[28].file, '29-orders-app.js');
  assert.match(p.blocks[20].code, /window\.IBShell = /);
});
test('join(split(x)) === x byte for byte', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.equal(join(split(src)), src);
});
```

- [ ] **Step 4: شغّل `npm test` وتأكد إنه بيفشل** بـ "Cannot find module … split-prototype.mjs".

- [ ] **Step 5: اكتب `tools/split-prototype.mjs`** بـ `export function split(src)` بالقواعد: الكتل = كل `<script>` … `</script>` بالترتيب (الكود = اللي بينهم من غير الوسوم، بنفس الأسطر الفاصلة)؛ `appCss` = اللي بين `<style>` في السطر 5 و`</style>` في 1152؛ `baseCss` = اللي بين `<style>` و`</style>` في السطر 1؛ `head`/`rootDiv`/`tail` = الباقي حرفيًا عشان `join` تقدر ترجّعه. ولما يتشغّل كأمر (`npm run split`) يكتب: `app/css/base.css`, `app/css/app.css`, `app/js/blocks/<file>`, و`app/index.html` من القالب ده (الترتيب إلزامي):

```html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>نظام إبتكر</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;900&display=swap">
<link rel="stylesheet" href="css/base.css"><link rel="stylesheet" href="css/app.css">
</head><body>
<div id="root" dir="rtl" lang="ar"></div>
<script src="config.js"></script><script src="js/vendor/supabase.js"></script>
<script src="js/adapter/supabase-client.js"></script><script src="js/adapter/auth.js"></script><script src="js/adapter/directory.js"></script><script src="js/adapter/activity.js"></script>
<!-- blocks, in prototype order -->
<script src="js/blocks/01-dataio.js"></script> … <script src="js/blocks/29-orders-app.js"></script>
</body></html>
```
(في Task 1 ملفات `config.js` والـ adapters لسه مش موجودة؛ المتصفح هيتجاهل 404 ويكمّل، وTask 5 بيعملهم.)

- [ ] **Step 6: اكتب `tools/join-prototype.mjs`** بـ `export function join(parts)` اللي بترجّع النص الأصلي حرفيًا (الوسوم `<script>`/`</script>` و`<style>` بنفس مكانها).

- [ ] **Step 7: شغّل `npm test`** → الاختبارين PASS. شغّل `npm run split` وتأكد إن `app/js/blocks/` فيه 29 ملف.

- [ ] **Step 8: افتح التطبيق المقسّم في المتصفح** (`npm run serve` ثم http://localhost:4173) وتأكد يدويًا: شاشة الدخول ظاهرة بالعربي وبدون أخطاء في الـ console غير 404 لملفات الـ adapters.

- [ ] **Step 9: Commit**

```bash
git add package.json tools tests app
git commit -m "feat: split the prototype into app/ with a byte-exact round-trip test"
```

---

