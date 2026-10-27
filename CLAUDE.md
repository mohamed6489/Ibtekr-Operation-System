# Ibtekr Operation System — سياق أي جلسة Claude

نظام التشغيل الداخلي لابتكر: واجهة عربي RTL (JavaScript عادي تحت `app/`) وباك إند Supabase.

## المراجع
- الوثيقة: `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md`
- الخطط: `docs/superpowers/plans/` (المرحلة صفر: `2026-10-22-phase-0-foundation.md`)
- المرحلة 1 (اللوحة): الخطة `docs/superpowers/plans/2026-10-25-phase-1-dashboard.md`، ودفترها `.superpowers/sdd/2026-10-25-phase-1-dashboard/progress.md`.
- المرحلة 2 (الأوردرات + مزامنة WooCommerce/Dokan + التحقق بخطوتين): الخطة `docs/superpowers/plans/2026-10-25-phase-2-orders.md`، ودفترها `.superpowers/sdd/2026-10-25-phase-2-orders/progress.md`. النشر الحي (الـ migrations، Edge Functions، الأسرار، الـ webhooks، الـ cron): `tools/deploy.md` §2.1 و§2.7.
- سجل التنفيذ: `.superpowers/sdd/<plan>/progress.md` — لو هتكمّل خطة، اقراه الأول قبل أي حاجة.
- مشروع Supabase: `fsynculhaupcktzkfkdd` (eu-central-1). `app/config.js` فيه مفتاح الـ anon العام بس.

## القواعد العشر
1. الواجهة JavaScript عادي، من غير إطار عمل ومن غير build.
2. الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة، وبعد التعديل شغّل `npm run lock`. المتعدّل لحد دلوقتي: 10 و11 و14 و17 و18 و21 و24 و25 و28 و29 (المرحلة صفر: 14/21/28؛ المرحلة 1: 25 وإضافات صغيرة في 21 و28؛ المرحلة 2: 10/11/17/18/29 وإضافات صغيرة في 25 و28؛ المرحلة 2.1: 24 وإضافات صغيرة في 25 و28 و29؛ المرحلة 2.2: إضافات صغيرة في 29؛ المرحلة 3: 28؛ المرحلة 3.2: 06 و28 — البراندات)، كل واحدة بقرار مكتوب في خطتها. `EDITED` في `tests/split.test.mjs` مع `tools/blocks.lock.json` بيمسكوا أي تعديل برّه القايمة دي.
3. أي كتابة بيانات لازم تعدّي على adapter (`app/js/adapter/`).
4. RLS على كل جدول، والصلاحيات بتتشيك بـ `has_perm`. وكل جدول جديد لازم له `grant` صريح لـ `authenticated`/`service_role` في الـ migration (المشروع الحي مابيمنح DML تلقائيًا؛ شوف `0004_grants.sql`، و`0006_dashboard.sql` — `alert_reads` واخد `select, insert` بس بالقصد — وآخر مثال `0007_orders.sql` بـ grants بقايمة أعمدة).
5. مافيش أسرار في الكود (لا service key ولا باسوردات) — الأسرار في `.env` أو GitHub Secrets.
6. عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب.
7. كل قاعدة عمل ليها اختبار.
8. قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية.
9. commit لكل مهمة.
10. ترتيب البناء = ترتيب القائمة الجانبية.

ملحوظة (صاحب المشروع، 26 أكتوبر): المهام تتنفذ **بالتوالي** — مهمة تخلص وبعدها اللي بعدها — ومن غير وكلاء متوازيين، والاقتصاد في استخدام Fable (التعديلات الصغيرة تتعمل في الجلسة نفسها من غير وكلاء منفّذين ولا مراجعين).

ملحوظة (صاحب المشروع، 27 أكتوبر): **النظام كله بيتبني ويتجرّب على موقع الـ staging الأول** (أسرار Woo الحالية بتاعة الـ staging)، والتحويل للموقع الحي خطوة واحدة في الآخر بعد ما صاحب المشروع يتأكد (`tools/deploy.md` §2.7.8). وطلبه (27 أكتوبر): بيانات المبتكر تتزامن في الاتجاهين مع Dokan (مرحلة 3.3 — بتلغي «Dokan قراءة بس» لبيانات المتجر بقرار مكتوب في خطتها؛ الأوردرات الفرعية لسه قراءة بس).

ملحوظة: لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس.

ملحوظة: `IBActivity.LOGGED_PREFIXES` في `app/js/adapter/activity.js` هي اللي بتحدد أنهي أحداث `K.logEvent` توصل `activity_log` (بادئات: `auth.` و`dashboard.` و`profile.2fa.`؛ وأحداث الأوردرات بالاسم بالظبط في `LOGGED_ACTIONS`: `order.status`, `order.confirm`, `order.patch`, `suborder.status`, `suborder.waybill`, `suborder.pulled` — عشان أحداث الكتلة 22 التجريبية ماتوصلش)؛ كل مرحلة بتربط صفحة ببيانات حقيقية بتضيف البادئة بتاعتها هناك.

**Dokan قراءة بس:** النظام عمره ما يكتب في WooCommerce حالة أوردر فرعي ولا بيانات متجر. اللي بيتكتب هناك: حالة الأوردر الأصلي بس (حسب `status_map` واتجاهها، عبر `woo-sync` `push_status`)، والـ webhooks بتاعتنا (`ibtekr-ops:*`) — وأي webhook تاني على الموقع (n8n) مايتلمسش.

ملحوظة: أعمدة `raw` في `orders`/`order_items`/`sub_orders` لـ `service_role` بس، و`customer_phone` بيتقرا مطموس عبر `orders_v` بس؛ الواجهة بتطلب أعمدتها بالاسم (`select=*` على الجداول دي بيترفض). المزامنة (Edge Functions) بتكتب الجداول مباشرة بـ service_role.

ملحوظة (المرحلة 3): `vendors` بيتقرا بقايمة أعمدة هو كمان (`select=*` بيترفض — `commission_pct` لـ `service_role` بس)، والنسبة في `vendor_rates` (بتاريخ سريان، `sensitive.commission = F`) والحساب البنكي في `vendor_bank` (`sensitive.vendor_bank = F`) كل واحد في جدوله مش في `vendors`؛ والمزامنة على متجر موجود بتحدّث `raw` بس — الفريق صاحب الاسم والحالة والتواصل بعد أول إدراج (`saveVendors` في `_shared/woo-write.js`).

ملحوظة (المرحلة 3.1): بيانات دخول المبتكر في `vendor_logins` (مش في `vendors`؛ بتتقرا بقايمة أعمدة — `select=*` بيترفض، و`secret_id` لـ `service_role` بس)، والباسورد المؤقت — **الطريقة الوحيدة** (مافيش لينك تفعيل: صاحب المشروع 26 أكتوبر؛ `pw_mode` بيتكتب `temp` دايمًا والعمود في `0012` زي ما هو) — في Vault عبر RPC بس (`vendor_login_set_password` / `vendor_login_reveal`: أدمن أو `vendors.edit = F`؛ كل نداء بيتسجل في `activity_log` من غير الباسورد؛ من غير Vault → 0A000)؛ و`vendors.status` بيقبل `leave` («في إجازة») من `0012`.

ملحوظة (المرحلة 3.2): البراندات في `brands` (براند تلقائي لكل صف `vendors` باسمه — التريجر `vendors_brand_after_insert` عند الإدراج من المزامنة أو الـ popup، وإعادة تعبئة re-runnable في `0013`؛ الاسم المأخوذ/الفاضي/الأطول من 80 = من غير براند تلقائي والإدراج بيعدّي؛ المتجر بيتربط بـ `store_vendor_id` — **السيرفر بس** بيحطه، والاسم فريد على `lower(btrim(name))` → 23505) و`brand_owners` (تاريخ الملكية — صفوف بتتضاف بس، مافيش `update`/`delete` للأعضاء؛ الصاحب في تاريخ D = آخر صف `since <= D` وإلا الأول؛ الحارس `brand_owners_guard`: 22023 `since before the last transfer` / `same vendor`، والتاريخ المكرر 23505، و`return_on <= since` 23514) و`brand_rates` (النسبة الخاصة بتاريخ، `null` = من غير خاصة من التاريخ ده؛ `sensitive.commission = F` زي `vendor_rates`). القراءة `vendors.view <> N`، الكتابة أدمن أو `vendors.edit = F` (`brands_guard`: `name`/`code`/`aliases` بس)، ومافيش `delete` للأعضاء على التلاتة. الدالتين `brand_owner_at(uuid, date)` / `store_owner_at(uuid, date)` (`security invoker`؛ المتجر نفسه لو مفيش براند). حذف مبتكر موجود في تاريخ ملكية براند مبتكر تاني (دلوقتي أو قبل كده) → 23503 من `vendors_brands_guard_delete` (الرسالة فيها `brand_owners_vendor_id_fkey`)، وحذف صاحب الأصل بيمسح براناته وصفوف ملكيتها ونسبها بالـ cascade.

## أوامر التشغيل
```bash
npm install        # مرة واحدة
npm run serve      # الواجهة على http://localhost:4173
npm test           # اختبارات node:test
npm run e2e        # Playwright على Supabase متقلّد (mock)؛ E2E_SUPABASE_LIVE=1 + E2E_* للمشروع الحقيقي
npm run db:test    # الـ migrations والـ RLS tests على Postgres محلي (DATABASE_URL)
npm run lock       # بعد أي تعديل معتمد في الكتل
npm run deno:check # type check لـ Edge Functions (Deno 2؛ في الـ sandbox السحابي: DENO_CERT=/root/.ccr/ca-bundle.crt)
npm run deno:test  # اختبارات woo-webhook / woo-sync (Woo وSupabase وهميين)
npm run semgrep    # نفس بوابة CI (p/javascript + p/secrets، ERROR)
```
`npm run split -- --force` بس لو قاصد تعيد توليد الكتل من البروتوتايب (بيمسح تعديلات `app/js/blocks/`).

## الفروع
`main` هو فرع الدمج؛ الجلسات السحابية بترفع على الفرع المحدد ليها.
