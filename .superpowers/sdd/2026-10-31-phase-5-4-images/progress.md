# دفتر المرحلة 5.4 — صور المنتجات بالـ AI

الخطة: `docs/superpowers/plans/2026-10-31-phase-5-4-images.md`. الفرع `main-gha10e` (main = النشر).

- [x] T1 (31 أكتوبر): الخطة والدفتر. اللي اتعرف: كتالوج Magnific الحقيقي من الـ MCP (الأسماء مطابقة للـ prototype، التكلفة
  بكريدت Magnific 50–75 للصورة مش 2–3)، حساب صاحب المشروع Premium+ شخصي (مش API)، و`docs.freepik.com` محجوب في الـ sandbox.
  صاحب المشروع (31 أكتوبر): «ابني كل حاجة وخليها واقفة على الـ API — معايا Magnific API» → المزوّد Magnific API، المفتاح
  `MAGNIFIC_API_KEY` في الآخر، الكريدت هي العملة؛ شكل الـ API يتأكد في T2 لما الدومين يتسمح (`magnific.com` محجوب هنا كمان).
- [ ] T2 مرجع الـ API (مستني السماح بالدومين أو صفحة reference من صاحب المشروع؛ الباقي مش مستنيه).
- [x] T3 `0025_ai_images` (31 أكتوبر): `ai_runs.action` + `image`، `source` + `tool`/`edit`، عمود `credits`؛ bucket `ai-images` خاص
  (القراءة والحذف لفولدر العضو بـ `products.add`/`products.edit` F، الكتابة للسيرفر بس)؛ `rls_ai_images.sql`. مافيش Postgres محلي
  في الـ sandbox — بيتأكد في CI (`db:test`) وعلى الحي بـ RLS live بعد التطبيق.
- [x] T4 `_shared/ai-images.js` (31 أكتوبر): `IMG_MODELS` (4 موديلات بالكريدت: Seedream 5 Pro 75 افتراضي، Nano Banana 2.1 50 —
  الاتنين من تقدير Magnific نفسه — وLite 20 وGPT 2 60 تقديريين)، `sizeOf`، `parseGenerate`/`parseEdit`/`parseCreate`، `slotPrompt`/
  `shapePrompt`/`editPrompt`، المسارات، `imageSettings` (`image_model`/`image_monthly_credits` فوق `MAGNIFIC_MODEL`/`IMAGE_MONTHLY_CREDITS`).
  اختبارات node 9.
- [ ] T5 Edge Function `ai-images` + Deno tests.
- [ ] T6 `IBImages` + mock.
- [ ] T7 خطوة الصور في الاستوديو + e2e.
- [ ] T8 أداة الصور + `product_images_add` + e2e.
- [ ] T9 حي.
