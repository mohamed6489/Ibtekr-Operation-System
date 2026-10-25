### Task 8: الأمان والبنية — مكتبات محلية، CSP، semgrep وDeno في CI، تحديث النشاط الدوري

**Files:**
- Create: `app/js/vendor/xlsx.full.min.js`, `app/js/vendor/html2canvas.min.js`, `app/js/vendor/README.md` (امتداد بالإصدارات والمصدر والـ sha256)
- Modify: `app/js/blocks/10-ui-kit.js`, `17-page-settings.js`, `28-app.js` (سلاسل الروابط فقط → `js/vendor/…`)، `app/js/blocks/25-page-dashboard.js` (المؤقّت ينادي `window.IBActivity && IBActivity.refresh()` قبل `render()`)، `app/.htaccess` (`script-src 'self'`)، `.github/workflows/ci.yml`, `tests/split.test.mjs` (`EDITED` + 10، 17)، `tools/blocks.lock.json`, `package.json` (`"deno:check"`, `"deno:test"`, `"semgrep"` scripts)
- Test: `npm test`, `npm run e2e`, `deno check/test`, وsemgrep محليًا

**Interfaces:**
- xlsx: SheetJS أحدث إصدار من `https://cdn.sheetjs.com/xlsx-<ver>/package/dist/xlsx.full.min.js` (0.20.x؛ النسخة 0.18.5 اللي كانت من cdnjs فيها CVE-2023-30533/CVE-2024-22363)؛ html2canvas 1.4.1 من حزمة npm `html2canvas` (`dist/html2canvas.min.js`). لو تنزيل SheetJS محجوب من الـ sandbox، يتسجّل في التقرير وينزّل عبر CI (خطوة مؤقتة) أو المتحكم يقرر.
- الكتل: التغيير الوحيد في 10/17/28 هو استبدال `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` بـ `js/vendor/xlsx.full.min.js` و`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` بـ `js/vendor/html2canvas.min.js` (grep يثبت إن مافيش cdnjs باقي).
- CSP: `script-src 'self'`؛ باقي الهيدر كما هو.
- CI: job `semgrep` (`pip install semgrep`، `semgrep scan --config p/javascript --config p/secrets --severity ERROR --error --exclude app/js/blocks --exclude app/js/vendor .`) — الكتل مستثناة من البوابة لأنها كود بروتوتايب تمت مراجعته يدويًا وملاحظاته مسجّلة في الدفاتر؛ job `functions` (`denoland/setup-deno@v2` ثم `deno check` + `deno test`). job `test` يشغّل `tests/functions` ضمن `npm test` تلقائيًا.
- **قرار:** استثناء `app/js/blocks` من بوابة semgrep — ليه: `insecure-innerhtml` بيعلّم أي إسناد لـ innerHTML حتى بعد التهريب، والكتلة 29 فيها 20 — التكلفة لو غلط: ثغرة في كتلة ماتتراجعتش يدويًا (كل تعديل كتلة بيمر على مراجع).

- [ ] **Step 1:** نزّل المكتبتين، اكتب الـ README بالـ sha256، عدّل الكتل الثلاث + `.htaccess` + الكتلة 25 + `EDITED`، `npm run lock`.
- [ ] **Step 2:** ci.yml + scripts؛ شغّل semgrep محليًا (`/root/.local/bin/semgrep` موجود) بنفس أمر CI → 0 ERROR.
- [ ] **Step 3:** `npm test`, `npm run e2e` (تصدير Excel من اللوحة لو فيه اختبار؛ على الأقل الصفحة بتحمّل بدون أخطاء CSP: افحص `console` في e2e للـ `Refused to load`), `deno check`, `deno test` → PASS.
- [ ] **Step 4: Commit**

```bash
git add app .github package.json tests tools/blocks.lock.json
git commit -m "chore(security): vendored xlsx/html2canvas with script-src 'self'; semgrep and deno jobs in CI; activity card refreshes from the server"
```

---

