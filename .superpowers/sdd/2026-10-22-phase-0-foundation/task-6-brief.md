### Task 6: سياق المستودع — CLAUDE.md وإعدادات الإضافات وCI

**Files:**
- Create: `CLAUDE.md`, `.claude/settings.json`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Produces: أي جلسة Claude Code (محلية/سحابية/على جهاز تاني) تقرا نفس القواعد وتحمّل نفس الإضافات.

- [ ] **Step 1: اكتب `CLAUDE.md`** (عربي، قصير): مرجع الوثيقة والخطط؛ القواعد العشر: (1) الواجهة JavaScript عادي بدون إطار عمل أو build؛ (2) الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة؛ (3) كل كتابة بيانات عبر adapter؛ (4) RLS على كل جدول، `has_perm` للصلاحيات؛ (5) مافيش أسرار في الكود؛ (6) عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب؛ (7) اختبار لكل قاعدة عمل؛ (8) قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية؛ (9) commit لكل مهمة؛ (10) ترتيب البناء = القائمة الجانبية. وأوامر التشغيل: `npm install`, `npm run split`, `npm run serve`, `npm test`, `npm run e2e`.

- [ ] **Step 2: اكتب `.claude/settings.json`** بـ `extraKnownMarketplaces` (`claude-plugins-official`, `trailofbits`) و`enabledPlugins` للإضافات اللي المشروع بيستخدمها: `superpowers, security-guidance, code-review, semgrep, context7, playwright, typescript-lsp, supabase, hostinger, commit-commands` و`differential-review, insecure-defaults, supply-chain-risk-auditor` من trailofbits.

- [ ] **Step 3: اكتب `.github/workflows/ci.yml`**: على push/PR → `npm ci` → `npm test` → `npx playwright install --with-deps chromium` → `npm run e2e` (متغيرات `E2E_*` من GitHub Secrets؛ لو مش موجودة يتخطى الـ e2e بـ `if`).

- [ ] **Step 4: اكتب `README.md`** (10 سطور: إيه المشروع، إزاي يتشغّل محليًا، فين الوثائق).

- [ ] **Step 5: شغّل `npm test` محليًا** → PASS. ادفع الفرع وتأكد إن الـ CI أخضر على GitHub.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md .claude README.md .github
git commit -m "chore: project context for any Claude session, plugin pins and CI"
```

---

