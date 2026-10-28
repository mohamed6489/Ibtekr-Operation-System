# دفتر المرحلة 5 — المنتجات: السجل + التعديل

الخطة: `docs/superpowers/plans/2026-10-28-phase-5-products.md`. بالتوالي، في الجلسة نفسها، من غير وكلاء.
المصدر: artifact نسخة `1793131460` — الكتلة 17 (domain) والكتلة 18 (الصفحة).

## المهام
- [x] T1 فحص الموقع: `staging-probe.yml` `probe=products` (أشكال بس) — commit 2e0cf6c، run 40643619265؛ الخطة اتكتبت
- [x] T2 DB `0021_products` + `rls_products` (محلي ok) — commit 96bda5d، وبعد المراجعة الأمنية 97b37f2 (`image_count`، `woo_brands`، `woo_categories` بـ products.view)
- [x] T3 woo-sync: أعمدة المرآة + سحب ar / trash + سحب كامل + `product_get` / `product_save` / `products_batch` /
  `products_trash` / `products_restore` + tests — commit 4fb7edb؛ Deno 115. مراجعة أمنية تلقائية: الوصف كان blocklist regex
  (بيتعدّى بـ `<svg/onload=…>`) → قايمة تاجات مسموحة من غير attributes + `<a href="https://…">` واسم من غير `< >` (97b37f2)
- [x] T4 domain (الكتلة 17 زي ما هي) + `IBProducts` + mock + unit — commit 3851285؛ unit 286
- [x] T5 الصفحة (السجل، المهملات، التعديل، الجماعي) + `SOON` (الكتلة 28، lock) + `products.css` + e2e — unit 286، e2e 161
  (products 9). اتصلّح في الطريق: الأوردرات بقت تفضّل صف اللغة الافتراضية على الترجمة العربية (نفس الـ SKU — اللينك كان
  بيروح للصفحة العربي)، الصفحة بتترسم تاني بعد `ib:directory` (لينك مباشر قبل ما الدخول يخلص)، وأسماء أعمدة كارت الموبايل.
  الصفحة بتحتاج `products.view` (الـ `orders.view` لوحده للأوردرات بس).
- [x] T6 حي: 0021 → rls حي → woo-sync → سحب كامل → main → تقرير؛ قبول كتابة بعد موافقة صاحب المشروع (لسه)

## قرارات صاحب المشروع (28 أكتوبر، بعد الأسئلة)
- البراند والمبتكر منفصلين؛ «نقل لمبتكر تاني» بعد فحص Dokan (`probe_dokan { options: true }` بعد النشر).
- التكرار → الاستوديو. صلاحية `products.bulk` لوحدها (العمليات F). الجماعي 25 في الطلب بالتوالي + تقدم.
- سعر المبتكر = سعر البيع − عمولة Dokan. فحص `probe=commission` (run 40651233890): «Woven Floor Lamp – 5 Units» متجرها
  Magic gift shop (35%) → 17,500 × 35% = 6,125 زي العمود بالظبط؛ 5 من أحدث 100 منتج عليهم `_per_product_admin_commission`.
- commits 4b5b999 (DB/sync)، ccd14b8 (الواجهة)؛ unit 287، e2e 163، Deno 117، rls_products محلي ok.
- الحي: `apply_migration` اتقطع (سؤال تأكيد من الأداة ماتردش عليه) — مستني صاحب المشروع.

## عمولة المنتج من Dokan نفسه (صاحب المشروع، 28 أكتوبر: «فيه مكان ثابت على الموقع بيديك عمولتي وعمولة المبتكر»)
- `PROBE=earning` (staging-probe): `dokan/v1/commission` موجود (route index)، ومن غير دخول `rest_forbidden` 401. واتصلّح الفحص:
  مسارات `dokan/` من غير مفتاح WC (كان كل `dokan/` بيرجع 401 invalid_username). commits a8413ed و7ab610a، والإضافة 0642a30.
- woo-sync `probe_dokan { earning: { product_id, amount } }` (أدمن / سر المزامنة، GET، أرقام بس) — في الريبو بتست Deno، واتنشر
  **v25 = v24 المنشورة + الإضافة دي بس** (من غير شغل المرحلة 5 اللي محتاج `0021`)؛ الملفات المنشورة اتقارنت بالمحلية: متطابقة.
- النتيجة: «Woven Floor Lamp – 5 Units» (181905، والـ variation 181912) بسعر 17,500 → seller **11,375** / admin **6,125** —
  نفس حسبتنا بالظبط (35%). الـ cron بعد النشر ok.

## التسعير من سعر المبتكر (قرار 16) — commit a27c4ab
- `priceFromVendor`: البيع = (سعر المبتكر + الرسوم) ÷ (1 − النسبة) لفوق لأقرب 10، قبل الخصم = البيع + 15–30% عشوائي لفوق لأقرب 10؛
  في صفحة المنتج (خانة للحساب + «احسب السعرين»)، كل تركيبة، والجماعي. unit 290، e2e 166.

## الحي (28 أكتوبر)
- `0021` اتطبّقت من SQL Editor بإيد صاحب المشروع (أداة الـ MCP اتقطعت 3 مرات على سؤال التأكيد). الفحص: 20 عمود، `woo_brands` و
  `product_commissions` بـ RLS، 4 سياسات، الصلاحيات (admin FFFF، ops FFFN، الباقي FNNN)، grants زي الملف.
- `rls_products` حي: RLS live run 40675329321 → ok (rollback).
- `woo-webhook` **v17** و`woo-sync` **v26** (المحاولة الأولى لـ woo-sync «Bundle generation timed out»، التانية نجحت)؛ الملفات المنشورة
  اتقارنت بالمحلية: متطابقة (غير إن أداة النشر بتحوّل `\u0660` لحروفها — نفس المعنى).
- سحب كامل `{action:'products', full:true}` على 4 تشغيلات (مهلة 150 ثانية؛ الحالة بتتحفظ كل صفحة) 11:26–11:39Z: الأخيرة 200
  `done: true`، 0 فشل، 0 صف خطأ في `woo_sync_log`. **en 3991** (نفس الفحص بالظبط: publish 2786 / draft 844 / pending 361؛
  simple 3738 / variable 253؛ كلهم ليهم مبتكر)، **ar 4030**؛ 3918 إنجليزي ليهم ترجمة عربي؛ 112 عربي من غير إنجليزي → **السجل 4103**.
  `woo_brands` 41، `product_commissions` 8021 صف — **ولا منتج عليه عمولة خاصة بقيمة** (المفتاح ممكن يكون موجود فاضي)، فالعمولة
  كلها من المتجر/القسم على الـ staging.
- «نقل لمبتكر تاني» — `probe_dokan { options: true }` على `dokan/v1/products` و`dokan/v2/products`: GET/POST بس، ومافيش أي حقل
  للمتجر/المبتكر/الكاتب في الـ schema → **مايتعملش من REST**؛ محتاج قرار صاحب المشروع (لوحة WordPress لحد ما يتقرر).

## المرحلة 5.1 — تاب SEO وتاب التقارير (28 أكتوبر)
- SEO (قرار 19): `product_save` بيقبل `seo_title`/`seo_description` (الأساسي و`ar`) → `meta_data` `rank_math_title`/`rank_math_description` بس. مراجعة أمنية مرتين: متغيرات Rank Math (`%customfield(_wc_cog_cost)%` بتطبع التكلفة) → `SEO_VARS` بس، وأي `%` فاضل لازم بعده مسافة. commits: SEO tab، allow only safe variables، refuse any % not followed by a space.
- woo-sync v29 (v28 كانت مكسورة 24 دقيقة — `normalizePhone`؛ اتشيّك: 0 أوردرات اتزامنت في الفترة و0 تليفونات غلط).
- التقارير (قرار 20): `0022_products_report` (RPC، `products.view`، أرقام مجمّعة) اتطبّقت بـ MCP؛ rls live ok (run 40721683531). نفد المخزون من المرآة على مستوى المنتج. الكتلة 28: `IBReportBlocks`.
- الاختبارات: npm test 293، e2e 169، deno 119، db:test كله ok، CI أخضر.
