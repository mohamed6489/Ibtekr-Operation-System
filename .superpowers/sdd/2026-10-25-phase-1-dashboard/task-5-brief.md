### Task 5: ربط اللوحة (ب) — تنبيهات السيرفر في الجرس وكارت «محتاج منك دلوقتي» + e2e

**Files:**
- Modify: `app/js/blocks/28-app.js` (`viewSections`)، `app/js/blocks/25-page-dashboard.js` (مستمع `ib:notify`)، `tools/blocks.lock.json` (`npm run lock`)
- Modify: `tests/e2e/dashboard.spec.mjs`, `tests/e2e/supabase-mock.mjs` (`alerts`, `alert_reads`)
- Test: `npm run e2e`

**Interfaces:**
- Consumes: `IBAlerts.section()/markRead/unread` (Task 3)؛ `viewSections(noDigest)`, `ntfState.viewer`, `digestSection` في الكتلة 28؛ `DD.topNeed` في الكتلة 25 (بيقرا `S.sections = NR().viewSections(true)`).
- Produces:
  - **قرار (الكتلة 28):** في `viewSections(noDigest)` بعد فلترة الأدوار وقبل `digestSection`: `if (window.IBAlerts && (ntfState.viewer || window.IBKit.ME) === window.IBKit.ME) { const s = IBAlerts.section(); if (s) secs = [s].concat(secs); }`. القسم أول قسم في القائمة (تنبيهات السيرفر RLS فلترها خلاص؛ مصفوفة الأدوار المحلية مابتنطبقش عليها)؛ «عرض تنبيهات» عضو تاني مايشملش تنبيهات السيرفر (مش مقروءة بصلاحياته). ليه: وعد خطة المرحلة صفر «الجرس يتربط في خطة اللوحة» — تكلفة لو غلط: قسم زيادة في الجرس.
  - **قرار (الكتلة 25):** `document.addEventListener('ib:notify', () => render())` بجانب مستمع `ib:activity` (`render` بيرسم بس لو الصفحة الحالية هي اللوحة) — عشان تنبيه Realtime جديد يظهر في «محتاج منك دلوقتي» فورًا.
  - الـ mock: `mock.alerts = [...]` و`mock.alertReads = []`. مبدئيًا صفين: `{ id: 1, at: T0, kind: 'woo.sync.failed', title: 'فشل مزامنة WooCommerce', body: 'آخر محاولة 09:00', role_id: 'admin', user_id: null, entity: 'settings-integrations', entity_id: null }` و`{ id: 2, at: T0, kind: 'stock.cons.late', title: 'تجميع متأخر IB-1042', body: null, role_id: null, user_id: '…0002', entity: 'inventory-consolidate', entity_id: null }`. `GET /rest/v1/alerts` → صفوف `user_id === u.id || role_id === u.role_id` لو `u.status === 'active'`، وإلا `[]`؛ `GET /rest/v1/alert_reads` → صفوف `mock.alertReads` بتاعة `u.id` (`{ alert_id }`)؛ `POST /rest/v1/alert_reads` → `body.user_id !== u.id` أو التنبيه مش ظاهر ليه → `401 {code:'42501'}`؛ مكرر → `409 {code:'23505'}`؛ وإلا push → `201 []`.

- [ ] **Step 1: ضيف في `tests/e2e/dashboard.spec.mjs`** (`mockOnly` كلها):
  - `a role alert from the server reaches the bell and the need card`: الأدمن → `.notif-badge` نصها `'1'`؛ `[data-card="need"]` يحتوي `'فشل مزامنة WooCommerce'`؛ اضغط `.notif-btn` → في الـ dialog زر القسم `'النظام'` بعدّاد `1` → اضغط عليه → العنصر `'فشل مزامنة WooCommerce'` → اضغط → `expect.poll(() => mock.alertReads)` = `[{ alert_id: 1, user_id: ADMIN_ID }]`؛ `location.hash` بعدها `'#settings-integrations'`؛ `.notif-badge` مخفية؛ `page.goto('/#dashboard')` ← `[data-card="need"]` مايحتويش العنوان؛ `page.reload()` → `.notif-badge` لسه مخفية.
  - `ops sees only alerts addressed to them`: `ops.dev` → الجرس → قسم `'النظام'` عدّاده `1`؛ العنصر `'تجميع متأخر IB-1042'` موجود و`'فشل مزامنة WooCommerce'` مش موجود.
  - `mark all read from the section header`: الأدمن → الجرس → `'النظام'` → زر `'تعليم الكل كمقروء'` → `mock.alertReads.length === 1` و`.notif-badge` مخفية.
  - `no page errors with realtime disabled`: يتحقق ضمنيًا من `afterEach` (`pageErrors` و`mock.unhandled` فاضيين) في كل الاختبارات.

- [ ] **Step 2: شغّل `npm run e2e -- tests/e2e/dashboard.spec.mjs`** → الاختبارات الجديدة FAIL (القسم مش موجود في الجرس).

- [ ] **Step 3: عدّل الكتلتين 28 و25 بالقرارات فوق، ووسّع الـ mock، وشغّل `npm run lock`.**

- [ ] **Step 4: شغّل `npm test` و`npm run e2e`** → PASS كله.

- [ ] **Step 5: Commit**

```bash
git add app tests tools/blocks.lock.json
git commit -m "feat(dashboard): server alerts in the bell and the need card with per-user read state"
```

---

