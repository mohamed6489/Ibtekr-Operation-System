### Task 5: ربط الواجهة — عميل Supabase، تسجيل الدخول الحقيقي، الدليل، سجل النشاط

**Files:**
- Create: `app/config.js`, `app/js/vendor/supabase.js`, `app/js/adapter/supabase-client.js`, `app/js/adapter/auth.js`, `app/js/adapter/directory.js`, `app/js/adapter/activity.js`, `tools/seed-dev-users.sql`, `tests/e2e/auth.spec.mjs`
- Modify: `app/js/blocks/21-shell.js` (دوال `findMember`, `doLogin`, `do2fa`, `doForgot`, `doReset`, `logout`, `enterApp`, وثابت `DEMO_PW`)، `app/js/blocks/14-kit.js` (`ME` سطر 2913 من البروتوتايب و`logEvent` سطر 3021)، `app/js/blocks/28-app.js` (استدعاء `boot()` يستنى `IBDirectory.load()`)
- Modify: `tools/split-prototype.mjs` — **التقسيم بيتولّد مرة واحدة**؛ بعد التعديلات دي الاختبار `join(split) === src` بيتحوّل لاختبار على snapshot: خزّن نسخة الكتل الأصلية في `tools/blocks.lock.json` (hash لكل كتلة) وخلّي الاختبار يؤكد إن **الكتل غير المعدّلة** (كل الكتل ما عدا 14، 21، 28) مطابقة للبروتوتايب بالبايت، وإن الكتل المعدّلة ليها hash مسجّل في اللوك.

**Interfaces:**
- Consumes: `window.IB_CONFIG`, `supabase.createClient` (UMD global `supabase`)، RPCs `email_for_identifier`, `log_activity`، جداول `profiles`, `roles`.
- Produces:
  - `window.IBSupabase = { client }`.
  - `window.IBAuth = { signIn(identifier, password) → Promise<{ ok:true, profile } | { ok:false, reason:'bad'|'suspended'|'locked'|'network' }>, verifyTotp(code) → Promise<{ok}>, needsTotp() → boolean, signOut() → Promise<void>, session() → Session|null, onChange(cb), resetPassword(identifier) → Promise<{ok}>, updatePassword(p1) → Promise<{ok}> }`. `signIn` بتنادي `email_for_identifier` الأول (الهوية بعد `O.toLatin`)، ترجّع `suspended` من غير محاولة دخول لو الحالة كده، وتستخدم `signInWithPassword`.
  - `window.IBDirectory = { load() → Promise<void>, me() → profile, members() → member[] }` — بتحمّل `profiles` + `roles` وتملا `IBKit.store.members` بنفس شكل أعضاء البروتوتايب (`id` = `member_code`، `name, role (الاسم العربي), title, dept, manager (member_code), phone, email, status, twofa`، والحقول الرقمية `salary, holdback, allow, leave, used` = 0 و`shift` = `['09:00','17:00']` لحد مرحلة HR)، وبتضبط `K.ME` = `member_code` بتاع المستخدم الحالي.
  - `window.IBActivity = { log(action, detail) }` → `rpc('log_activity', {...})` fire-and-forget؛ `K.logEvent` بينادي `IBActivity.log` **بالإضافة** لسلوكه الحالي (unshift في `store.activity`).
- مستخدمو dev (في `tools/seed-dev-users.sql`، يتشغّل بـ `execute_sql` مرة واحدة على المشروع، ومايتشغّلش على الإنتاج): أدمن `M01` و عمليات `M02` ومشاهد موقوف `M99`، بإيميلات `*.dev@ibtekr.local` وكلمة سر تجريبية مكتوبة في الملف نفسه (مش في الشات).

- [ ] **Step 1: اكتب `tests/e2e/auth.spec.mjs`** (بيستخدم بيانات `tools/seed-dev-users.sql` عبر متغيرات بيئة `E2E_ADMIN_EMAIL/E2E_ADMIN_PW` …):
  - `signs in and lands on dashboard`: يكتب إيميل الأدمن وكلمة السر → `#root` ظاهر، `nav.sidebar` فيه 10 `.nav-item`، العنوان مش "تسجيل الدخول".
  - `arabic-digit phone identifier works`: يكتب `٠١٠٠٠٠٠٠٠٠٢` + كلمة سر العمليات → يدخل.
  - `suspended account is refused`: المشاهد الموقوف → العنوان "الحساب موقوف"، `#root` مخفي.
  - `wrong password shows remaining attempts`: نص الخطأ يحتوي "فاضل 4 محاولات".
  - `logout returns to login`: من قائمة الحساب → "خروج" → `#login` ظاهر.

- [ ] **Step 2: شغّل `npm run e2e`** → الاختبارات الجديدة FAIL (لسه `DEMO_PW`).

- [ ] **Step 3: ضيف `app/js/vendor/supabase.js`** (نسخة UMD من حزمة `@supabase/supabase-js`، نفس رقم الإصدار يتكتب في `package.json` تحت `dependencies`)، و`app/config.js` بـ URL المشروع ومفتاح `anon` (من MCP `get_project_url` و`get_publishable_keys`).

- [ ] **Step 4: اكتب `supabase-client.js`, `auth.js`, `directory.js`, `activity.js`** بالتواقيع فوق.

- [ ] **Step 5: عدّل `21-shell.js`**: احذف `DEMO_PW`؛ `doLogin` تبقى async وتنادي `IBAuth.signIn` وتحوّل النتيجة لنفس فروع الشاشة الحالية (`suspended` → `ls.view='suspended'`؛ `bad` → `O.loginFail` + نفس رسالة "فاضل N محاولات"؛ `ok` → لو `IBAuth.needsTotp()` → `ls.view='2fa'` وإلا `enterApp()`)؛ `do2fa` → `IBAuth.verifyTotp`؛ `doForgot` → `IBAuth.resetPassword`؛ `doReset` → `IBAuth.updatePassword`؛ `logout` → `IBAuth.signOut()` ثم سلوكه الحالي. المنطق المحلي للقفل (`auth`/`O.isLocked`) **يفضل** زي ما هو.

- [ ] **Step 6: عدّل `14-kit.js`**: `ME` تبقى متغيّر بيتضبط من `IBDirectory` (`K.setMe(code)`)، و`logEvent` تنادي `window.IBActivity && IBActivity.log(action, detail)`.

- [ ] **Step 7: عدّل `28-app.js`**: قبل `boot()`: `await IBDirectory.load()` لو فيه جلسة (`IBAuth.session()`)، وبعد `boot()`: لو مافيش جلسة → `IBShell.showLogin('login')`. وفي `IBAuth.onChange`: عند `SIGNED_OUT` → `IBShell.showLogin('login')`.

- [ ] **Step 8: شغّل `tools/seed-dev-users.sql`** على المشروع (مرة واحدة)، ثم `npm run e2e` → PASS. `npm test` → PASS (اختبار الـ snapshot الجديد).

- [ ] **Step 9: Commit**

```bash
git add app tools tests package.json
git commit -m "feat(auth): real sign-in via Supabase, member directory and activity log behind the existing login screen"
```

---

