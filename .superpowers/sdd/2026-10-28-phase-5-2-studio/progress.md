# المرحلة 5.2 — استوديو المنتجات (من غير AI) — الدفتر

الخطة: `docs/superpowers/plans/2026-10-28-phase-5-2-studio.md`.

- [x] T1 فحص `studio2` (قراءة بس) — commit d7746e9؛ الخطة f150f07.
- [x] T2 `0023_studio` + `rls_studio` — commit 3c4b5f4.
- [x] T3 الدومين (SKU، الألوان، الشيت) — commit 7ee2870.
- [x] T4 woo-sync `studio_upload` / `category_create` + `woo-studio.js` — commit d1e9d86.
- [x] T5–T6 `IBStudio` + صفحة الاستوديو + mock + e2e — commit d44119a.
- [x] المبتكر من غير snippet (صاحب المشروع: «دور كويس تاني») — commit a57f12d: من كود Dokan Lite
  (`DokanRESTController::update_post_author_if_needed`، من 3.10.3) — `PUT dokan/v1/products/{id} { post_author }` بباسورد التطبيق
  بيكتب الكاتب للأدمن لو المستخدم عنده `dokan_add_product`، وإلا بيكتب اللي بينادي → الرد بيتشيّك. للمنتج وترجمته؛
  «فشل» = «جرّب تاني» بيسأل تاني بس. `woo-api` من WordPress: `wp/v2/media` بس.
- [ ] T7 حي:
  - [x] `0023` من SQL Editor (صاحب المشروع، 28 أكتوبر).
  - [x] `rls_studio rls_products rls_products_report` حي ok — RLS live run 40772555442.
  - [x] `woo-sync` **v31** و`woo-webhook` **v18** (متطابقين مع الريبو ما عدا سطرين `normalizePhone` المعروفين؛ v30 اتنشرت
    دقايق بالملفات القديمة — `wp/v2/product` — وv31 بدلها).
  - [ ] main + نشر الموقع.
  - [ ] قبول: منتج Simple + منتج Variable مسودة من الاستوديو (بموافقة صاحب المشروع) — الصور، الترجمة العربي، المبتكر على Dokan، المرآة.
  - [ ] تقرير.

الاختبارات (a57f12d): unit 303، e2e 172 (اختبار سعر قرار 16 فشل مرة تحت الضغط وعدّى 5/5 لوحده)، Deno 123.
