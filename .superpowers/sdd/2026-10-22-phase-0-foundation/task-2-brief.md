### Task 2: اختبارات قواعد الدخول والخمول + Playwright على الواجهة المقسّمة

**Files:**
- Create: `tests/domain/ops-domain.test.mjs`, `tests/playwright.config.mjs`, `tests/e2e/login.spec.mjs`

**Interfaces:**
- Consumes: `app/js/blocks/12-ops-domain.js` بيصدّر UMD → في Node: `const O = require(path)` بيرجّع `{ AUTH, loginInit, loginFail, isLocked, identifierKind, toLatin, validatePassword, idleState, … }` (الدوال موجودة فعلًا في البروتوتايب سطر 2846–2865).
- Produces: `npm run e2e` بيشغّل Playwright على `npm run serve`.

- [ ] **Step 1: اكتب `tests/domain/ops-domain.test.mjs`** (بـ `createRequire`):

```js
test('AUTH constants match the spec', () => assert.deepEqual(O.AUTH, { maxTries: 5, lockMinutes: 15, idleMinutes: 480, warnSeconds: 60, linkMinutes: 30, inviteDays: 7, rememberDays: 30 }));
test('5 failures lock for 15 minutes', () => { let a = O.loginInit(); for (let i = 0; i < 5; i++) a = O.loginFail(a, 0); assert.equal(O.isLocked(a, 14 * 60 * 1000), true); assert.equal(O.isLocked(a, 15 * 60 * 1000 + 1), false); });
test('identifierKind: email, 11-digit phone, arabic digits, junk', () => { assert.equal(O.identifierKind('a@b.co'), 'email'); assert.equal(O.identifierKind('01012345678'), 'phone'); assert.equal(O.identifierKind(O.toLatin('٠١٠١٢٣٤٥٦٧٨')), 'phone'); assert.equal(O.identifierKind('abc'), null); });
test('idleState thresholds', () => { assert.equal(O.idleState(0), 'active'); assert.equal(O.idleState(28800 - 30), 'warn'); assert.equal(O.idleState(28800), 'expired'); });
```
(القيم المرجعة لـ `identifierKind` تتاخد من الكود الفعلي في block 12 — لو بيرجّع قيم تانية غير `'email'`/`'phone'`/`null` عدّل التوقعات لتطابقه، مش العكس.)

- [ ] **Step 2: شغّل `npm test`** → PASS (لو فشل، ده بيكشف اختلاف في القواعد؛ ماتعدّلش block 12).

- [ ] **Step 3: اكتب `tests/playwright.config.mjs`** بـ `webServer: { command: 'npm run serve', url: 'http://localhost:4173', reuseExistingServer: true }`، `use: { baseURL, locale: 'ar-EG' }`، chromium بس.

- [ ] **Step 4: اكتب `tests/e2e/login.spec.mjs`**:

```js
test('login screen renders in Arabic RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('تسجيل الدخول — نظام إبتكر');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#root')).toBeHidden();
});
```

- [ ] **Step 5: `npx playwright install chromium` ثم `npm run e2e`** → PASS.

- [ ] **Step 6: Commit**

```bash
git add tests
git commit -m "test: domain rules for auth/idle and a Playwright login-screen smoke test"
```

---

