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
