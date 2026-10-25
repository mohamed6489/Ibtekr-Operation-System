### Task 4: ربط اللوحة (أ) — التخصيص المحفوظ، كارت «آخر نشاط»، مسح الذاكرة عند الخروج + e2e

**Files:**
- Modify: `app/js/blocks/25-page-dashboard.js` (`customize`, `activity`, مستمع `ib:activity`)، `app/js/blocks/21-shell.js` (`signOut`)، `app/js/blocks/28-app.js` (بوابة الجلسة: `ib.loginView`)، `tests/split.test.mjs` (`EDITED`)، `tools/blocks.lock.json` (`npm run lock`)
- Create: `tests/e2e/dashboard.spec.mjs`
- Modify: `tests/e2e/supabase-mock.mjs` (`user_prefs`, `activity_log`)
- Test: `npm test`, `npm run e2e`

**Interfaces:**
- Consumes: `IBPrefs.set/remove`, `IBActivity.cached()`, `IBDirectory.clear()` (Task 3)؛ `K.store.dashPrefs`, `K.logEvent`, `K.member`, `K.ME`؛ `IBShell.showLogin(view)`.
- Produces: سلوك اللوحة على المستخدم الحقيقي:
  - **قرار (الكتلة 25 — التخصيص):** `customize()` → في `submit` بعد ما يكتب `K.store.dashPrefs[owner]`: `window.IBPrefs && IBPrefs.set('dashboard', K.store.dashPrefs[owner]).then((r) => { if (!r.ok) K.toast('اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر', 'error'); })`؛ في «رجوع للافتراضي» بعد `delete`: `IBPrefs.remove('dashboard')` بنفس المعاملة. «عرض كـ» عضو تاني بيعرض إطار دوره بالترتيب الافتراضي (تفضيلاته خاصة بيه: RLS) — ليه: الوثيقة والبروتوتايب «التخصيص بيتحفظ ليك انت بس» — تكلفة لو غلط: الأدمن مايشوفش ترتيب العضو الشخصي.
  - **قرار (الكتلة 25 — آخر نشاط):** `activity()` لو `window.IBActivity && IBActivity.cached()` مش `null` → القائمة = صفوف السيرفر بس (أول 5)، `who = r.actor`، `what = (ACT[r.action] || r.action) + (r.detail ? ' — ' + r.detail : '')`، `at = fmtAt(r.at)` حيث `fmtAt` دالة محلية: نفس اليوم → `'اليوم HH:MM'`، إمبارح → `'أمس HH:MM'`، وإلا `'DD/MM HH:MM'` (بالتوقيت المحلي). `ACT` تزيد: `'auth.signin': 'سجّل دخول'`, `'auth.signout': 'سجّل خروج'`, `'auth.2fa': 'تحقق بخطوتين'`, `'auth.password.set': 'غيّر كلمة المرور'`, `'auth.signoutAll': 'خروج من كل الأجهزة'`. العنوان الفرعي زي ما هو (الأدمن «آخر 5 حركات في السيستم»، غيره «آخر 5 حاجات عملتها» — RLS بتضمن ده). لو `cached()` = `null` (مافيش عميل) → السلوك القديم. مستمع: `document.addEventListener('ib:activity', render)`. ليه: الكارت كان بيعرض بيانات تجريبية وأحداث الجلسة بس — تكلفة لو غلط: أحداث الصفحات التجريبية (مهام) ماتظهرش في الكارت لحد ما صفحاتها تتوصّل.
  - **قرار (الكتلة 21 — الخروج):** `signOut(reason)` بعد `await window.IBAuth.signOut('local')`: `try { sessionStorage.setItem('ib.loginView', reason === 'idle' ? 'expired' : 'login'); } catch (e) {}` ثم `location.reload()`. إعادة التحميل هي الضمان الوحيد إن كل المخازن في الذاكرة (الدليل، المخازن التجريبية المعدّلة، المحادثات) بتتمسح. مسار إعادة تعيين كلمة المرور مايتغيرش (الدليل مابيتحملش في جلسة الاستعادة). ليه: بند المرحلة صفر «مسح المخازن عند الخروج» — تكلفة لو غلط: وميض إعادة تحميل بعد الخروج.
  - **قرار (الكتلة 28 — البوابة):** قبل حساب `view`: `const stored = (() => { try { const v = sessionStorage.getItem('ib.loginView'); sessionStorage.removeItem('ib.loginView'); return v; } catch (e) { return null; } })();` ولو `!A.session() && stored === 'expired'` → `view = 'expired'` (بدل `'login'`). كل باقي البوابة زي ما هي.
  - `tests/split.test.mjs`: `EDITED = ['14-kit.js', '21-shell.js', '25-page-dashboard.js', '28-app.js']` ونص الاختبار يقول «14, 21, 25 and 28».
  - الـ mock (`supabase-mock.mjs`): `mock.prefs = []`، `mock.activityRows` (كل نداء `log_activity` بيضيف `{ id, at: new Date().toISOString(), actor: u.id, action, new_value }` بجانب `mock.activity` الموجود). المسارات: `GET /rest/v1/user_prefs` → صفوف `mock.prefs` بتاعة `u.id` (RLS)؛ `POST /rest/v1/user_prefs` → لو `body.user_id !== u.id` أو `u.status !== 'active'` → `401 {code:'42501'}`، وإلا upsert على `(user_id,key)` → `201 []`؛ `DELETE /rest/v1/user_prefs?user_id=eq.…&key=eq.…` → يحذف صفوف `u.id` بالمفتاح → `204`؛ `GET /rest/v1/activity_log` → `mock.activityRows` (كلها لو `settings.view !== 'N'`، وإلا صفوف `actor === u.id`)، مرتبة تنازليًا بـ `at`، بحد `limit`، وكل صف فيه `actor: { name }` من `USERS`؛ `IB_CONFIG` بتاع الـ mock يزيد `realtime: false`. أي GET للجداول `alerts`/`alert_reads` → `[]` لحد Task 5.

- [ ] **Step 1: اكتب `tests/e2e/dashboard.spec.mjs`** (نفس `beforeEach`/`afterEach`/`signIn` بتوع `auth.spec.mjs`؛ الاختبارات اللي بتعتمد على بيانات الـ mock تتعلّم `mockOnly()`):
  - `dashboard greets the signed-in admin with the admin frame`: دخول الأدمن → `h1` = `'لوحة التحكم'`؛ `.dash-hi` تحتوي `'يا صفوت'`؛ `.dash-kpis .kpi` (أو العنصر اللي `U.KpiTile` بيرجّعه — اتأكد من الكلاس في `10-ui-kit.js`) عدده 5؛ `[data-card="money"]` موجود؛ `#dash-viewas` موجود.
  - `ops gets the ops frame: no money, no view-as`: دخول `ops.dev@ibtekr.local` → `[data-card="money"]` عدده 0؛ `#dash-viewas` عدده 0؛ نص المؤشرات يحتوي `'جاهز / قيد الشحن'`.
  - `customization is saved to the server and survives a reload` (`mockOnly`): الأدمن → زر `'تخصيص اللوحة'` → في الـ dialog: المفتاح `getByLabel('الفريق دلوقتي')` → اضغط → `'حفظ'` → `[data-card="team"]` عدده 0 → `expect.poll(() => mock.prefs)` يساوي `[{ user_id: ADMIN_ID, key: 'dashboard', data: { order: [...10 ids], hidden: ['team'] } }]` (قارن `hidden` و`order.length === 10`)؛ `page.reload()` → `#root` ظاهر و`[data-card="team"]` لسه 0؛ `'تخصيص اللوحة'` → `'رجوع للافتراضي'` → `[data-card="team"]` عدده 1 و`mock.prefs` = `[]`؛ `mock.activity.map(a => a.action)` تحتوي `'dashboard.customize'`.
  - `the activity card shows server rows with Arabic labels` (`mockOnly`): الأدمن → `[data-card="activity"]` يحتوي `'سجّل دخول'` و`'صفوت كمال'`.
  - `sign-out leaves no member data in memory and keeps the expired message` (`mockOnly`): `page.clock.install()` → دخول الأدمن → `page.evaluate(() => IBKit.store.members.some(m => /\.dev@ibtekr\.local$/.test(m.email)))` = `true` → خروج من قائمة الحساب → `#login` ظاهر → `expect.poll(() => page.evaluate(() => window.IBKit.store.members.some(m => /\.dev@ibtekr\.local$/.test(m.email))))` = `false` → `mock.afterLogout === 0` بعد `page.clock.runFor('00:30')`. اختبار تاني: دخول → `page.clock.fastForward('08:00:30')` → `#lg-title` = `'الجلسة خلصت'` ويفضل كده بعد `expect.poll` لمدة ثانية (إعادة التحميل حصلت والنص ثابت).

- [ ] **Step 2: شغّل `npm run e2e -- tests/e2e/dashboard.spec.mjs`** → FAIL (التخصيص مابيتحفظش، الكارت بيعرض بيانات تجريبية، الأعضاء لسه في الذاكرة).

- [ ] **Step 3: عدّل الكتل 25 و21 و28 بالقرارات فوق، ووسّع الـ mock، وحدّث `EDITED`، وشغّل `npm run lock`.**

- [ ] **Step 4: شغّل `npm test` و`npm run e2e`** → كله PASS، بما فيه `auth.spec.mjs` (الخروج، الخمول، التبويبين). لو اختبار قديم في `auth.spec.mjs` اتأثر بإعادة التحميل، عدّله بأقل تغيير يحافظ على نفس التأكيد (مثلًا `expect.poll` بدل `expect` الفوري) واكتب ده في تقريرك.

- [ ] **Step 5: Commit**

```bash
git add app tests tools/blocks.lock.json
git commit -m "feat(dashboard): customization saved per user, activity card from the server log, full wipe on sign-out"
```

---

