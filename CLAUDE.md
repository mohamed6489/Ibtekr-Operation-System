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
2. الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة، وبعد التعديل شغّل `npm run lock`. المتعدّل لحد دلوقتي: 10 و11 و14 و17 و18 و21 و25 و28 و29 (المرحلة صفر: 14/21/28؛ المرحلة 1: 25 وإضافات صغيرة في 21 و28؛ المرحلة 2: 10/11/17/18/29 وإضافات صغيرة في 25 و28)، كل واحدة بقرار مكتوب في خطتها. `EDITED` في `tests/split.test.mjs` مع `tools/blocks.lock.json` بيمسكوا أي تعديل برّه القايمة دي.
3. أي كتابة بيانات لازم تعدّي على adapter (`app/js/adapter/`).
4. RLS على كل جدول، والصلاحيات بتتشيك بـ `has_perm`. وكل جدول جديد لازم له `grant` صريح لـ `authenticated`/`service_role` في الـ migration (المشروع الحي مابيمنح DML تلقائيًا؛ شوف `0004_grants.sql`، و`0006_dashboard.sql` — `alert_reads` واخد `select, insert` بس بالقصد — وآخر مثال `0007_orders.sql` بـ grants بقايمة أعمدة).
5. مافيش أسرار في الكود (لا service key ولا باسوردات) — الأسرار في `.env` أو GitHub Secrets.
6. عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب.
7. كل قاعدة عمل ليها اختبار.
8. قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية.
9. commit لكل مهمة.
10. ترتيب البناء = ترتيب القائمة الجانبية.

ملحوظة: لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس.

ملحوظة: `IBActivity.LOGGED_PREFIXES` في `app/js/adapter/activity.js` هي اللي بتحدد أنهي أحداث `K.logEvent` توصل `activity_log` (بادئات: `auth.` و`dashboard.` و`profile.2fa.`؛ وأحداث الأوردرات بالاسم بالظبط في `LOGGED_ACTIONS`: `order.status`, `order.confirm`, `order.patch`, `suborder.status`, `suborder.waybill`, `suborder.pulled` — عشان أحداث الكتلة 22 التجريبية ماتوصلش)؛ كل مرحلة بتربط صفحة ببيانات حقيقية بتضيف البادئة بتاعتها هناك.

**Dokan قراءة بس:** النظام عمره ما يكتب في WooCommerce حالة أوردر فرعي ولا بيانات متجر. اللي بيتكتب هناك: حالة الأوردر الأصلي بس (حسب `status_map` واتجاهها، عبر `woo-sync` `push_status`)، والـ webhooks بتاعتنا (`ibtekr-ops:*`) — وأي webhook تاني على الموقع (n8n) مايتلمسش.

ملحوظة: أعمدة `raw` في `orders`/`order_items`/`sub_orders` لـ `service_role` بس، و`customer_phone` بيتقرا مطموس عبر `orders_v` بس؛ الواجهة بتطلب أعمدتها بالاسم (`select=*` على الجداول دي بيترفض). المزامنة (Edge Functions) بتكتب الجداول مباشرة بـ service_role.

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
