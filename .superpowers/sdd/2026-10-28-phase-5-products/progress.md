# دفتر المرحلة 5 — المنتجات: السجل + التعديل

الخطة: `docs/superpowers/plans/2026-10-28-phase-5-products.md`. بالتوالي، في الجلسة نفسها، من غير وكلاء.
المصدر: artifact نسخة `1793131460` — الكتلة 17 (domain) والكتلة 18 (الصفحة).

## المهام
- [x] T1 فحص الموقع: `staging-probe.yml` `probe=products` (أشكال بس) — commit 2e0cf6c، run 40643619265؛ الخطة اتكتبت
- [ ] T2 DB `0021_products` + `rls_products`
- [ ] T3 woo-sync: أعمدة المرآة + سحب ar / trash + `product_get` / `product_save` / `products_batch` / `products_trash` /
  `products_restore` + tests
- [ ] T4 domain + `IBProducts` + mock + unit
- [ ] T5 الصفحة (السجل، المهملات، التعديل، الجماعي) + `SOON` + e2e
- [ ] T6 حي: 0021 → rls حي → woo-sync → سحب كامل → main → تقرير؛ قبول كتابة بعد موافقة صاحب المشروع
