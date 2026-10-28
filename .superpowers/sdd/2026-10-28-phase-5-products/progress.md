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
- [ ] T6 حي: 0021 → rls حي → woo-sync → سحب كامل → main → تقرير؛ قبول كتابة بعد موافقة صاحب المشروع

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
