### Task 6: التوثيق + التطبيق الحي + التحقق من النشر

**Files:**
- Modify: `CLAUDE.md` (قاعدة 2: الكتل المعدّلة لحد دلوقتي 14، 21، 25، 28؛ قاعدة 4: مثال `0006`؛ سطر عن `LOGGED_PREFIXES`)، `tools/deploy.md` (§3 ترتيب الـ migrations يزيد `dashboard`؛ ملحوظة Realtime على `alerts`)، `README.md` (سطر: اللوحة على بيانات حقيقية جزئيًا)
- المتحكم (مش المنفّذ) بعد مراجعة المهام 1–5: تطبيق `0006_dashboard.sql` على المشروع الحي عبر Supabase MCP (`apply_migration` باسم `dashboard`)، تشغيل نسخة من `rls_dashboard.sql` بـ `execute_sql` (من غير `delete`)، `get_advisors` (security + performance)، ثم `git push origin main-gha10e && git push origin main-gha10e:main` → النشر التلقائي → التحقق من وصول `js/adapter/prefs.js` للسيرفر بـ `hosting_files_website-content`.

**Interfaces:**
- Consumes: كل اللي فوق.
- Produces: المستودع يوصف الحالة الجديدة؛ المشروع الحي عليه الـ migration؛ الموقع على آخر نسخة.

- [ ] **Step 1: عدّل `CLAUDE.md` و`tools/deploy.md` و`README.md`** بالنقاط فوق (عربي، قصير).

- [ ] **Step 2: شغّل `npm test && npm run e2e && npm run db:test`** → كله PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md tools/deploy.md README.md
git commit -m "docs: phase 1 dashboard — edited blocks, migration order, realtime note"
```

- [ ] **Step 4 (المتحكم): التطبيق الحي والنشر** زي ما هو موصوف في Files، وتسجيل النتيجة في الدفتر `.superpowers/sdd/2026-10-25-phase-1-dashboard/progress.md`.

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (§5 الصف 1 + بنود المرحلة صفر):** إطارات لكل دور على الدور الحقيقي ✔ (Task 2 اختبارات + Task 4 e2e)، المؤشرات = هيكل على بيانات البروتوتايب لحد صفحاتها (قرار الوثيقة «تكتمل في الآخر») ✔، تخصيص اللوحة محفوظ ✔ (Task 1، 3، 4)، الجرس على `alerts` + `alert_reads` ✔ (Task 1، 3، 5)، مسح المخازن عند الخروج ✔ (Task 3، 4)، `activity_log` للمستخدم نفسه ✔ (Task 1، 4)، Realtime ✔ (Task 1، 3). مزامنة Woo والصفحات التانية لخططها.
- **التواقيع متسقة:** `IBPrefs.load/get/set/remove/clear`، `IBAlerts.load/list/unread/markRead/markAllRead/subscribe/unsubscribe/clear/section/toneOf/relTime`، `IBActivity.recent/cached/refresh/clear/LOGGED_PREFIXES`، `IBDirectory.clear` مستخدمة بنفس الأسماء في 3/4/5؛ أسماء الجداول والأعمدة (`user_prefs.key/data`، `alert_reads.alert_id/user_id`) واحدة في 1/3/4/5 والـ mock.
- **Review Focus:** 1–2 في Task 2، 3 في Task 1 و5، 4 في Task 3 و5، 5 في Task 4.
- **النسبة:** الخطة أقصر من الكود اللي هتنتجه؛ الأجسام الوحيدة المكتوبة هي النصوص العربية الثابتة وتعبيرات السياسات.
