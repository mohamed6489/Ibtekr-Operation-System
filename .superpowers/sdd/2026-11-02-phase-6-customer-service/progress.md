# دفتر المرحلة 6 — خدمة العملاء

الخطة: `docs/superpowers/plans/2026-11-02-phase-6-customer-service.md`. الفرع `main-gha10e` (main = النشر).

- [x] T0 (2 نوفمبر): الخطة والدفتر بعد إجابات صاحب المشروع (واتساب آخر حاجة، Meta الأول، العملاء من الأوردرات + يدوي، الحملات جوه الصفحة،
  الرد الآلي والقوالب مؤجلين).
- [x] T1 (2 نوفمبر): `0034_cs.sql` (الصلاحيات `cs.view/reply/manage`، `norm_phone` + index على الأوردرات، `cs_customers` + contacts/notes/rating_overrides، تريجر
  `orders_cs_customer` + التعبئة، `cs_conversations`/`cs_messages` بحراسها، `cs_segments`/`cs_campaigns`/recipients/`cs_channels` (5 صفوف غير متصلة)،
  `cs_customers_list()`، Realtime) + `rls_cs.sql`؛ `npm run db:test` محليًا على Postgres 16 بتاع الـ sandbox: 32 اختبار ✓.
- [x] T2 (2 نوفمبر): الكتلة 19 = v2 22 بالحرف (`IbtekrCS`؛ `RATE_KEYS`/`validateTeamRating` فيه)، domain tests ✓.
- [x] T3 (2 نوفمبر): `app/js/adapter/cs.js` (`IBCS`: العملاء من `cs_customers_list` بس، المحادثات المفتوحة + آخر 90 يوم برسايلها، الشرايح/الحملات/القنوات/
  صف `settings` «cs»؛ الكتابات كلها بـ `{ ok, reason }` ومسجّلة `cs.*` من غير نص ولا تليفون؛ Realtime `cs` → `ib:cs`) مربوط في `IBDirectory.load/clear`
  و`index.html`؛ `cs.` في `LOGGED_PREFIXES`؛ الـ mock (`cs_*` + `cs_customers_list` + `cs_merge_customers` + صلاحيات `cs.*` للأدوار + `mock.csWrites`)؛
  `tests/adapter/cs.test.mjs` (14) و`tests/e2e/cs-adapter.spec.mjs` (4). مراجعة أمنية على `0034`: تقييمات الأوردرات محجوبة من غير `orders.view`، وrevoke قبل grants الأعمدة.
- [ ] T4: الكتلة 20 ← v2 23 على `IBCS` (الرسايل، العملاء، الشرايح) + `cs.css` + شيل `cs` من `SOON`.
- [ ] T5: الحملات (مسودة/مجدولة) + الأداء + التقارير (`reportTab` + `IBReportBlocks` تاب `cs`).
- [ ] T6: الكتلة 28 (الجرس «رسايل»، الإجراءات على `IBCS`) + e2e + lock + CLAUDE.md + الحي (`0034`، rls حي، main).
