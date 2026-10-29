# المرحلة 5.3 — المحتوى بالـ AI (Claude) — الدفتر

الخطة: `docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md`.

صاحب المشروع (29 أكتوبر): «هنعمل ده بعد ما نخلص ال ai» (قبول الاستوديو بعد الـ AI)؛ المحتوى الأول (Claude)، وعنده مفتاح Claude
ومفتاح Magnific، والمساعد بعدين؛ «ابني الاول و بعدين سيب اني اديك api keys في الاخر» — المفتاح بيتحط في أسرار Supabase بإيده.

- [x] T1 الخطة + الدفتر — commit 70e15eb.
- [x] T2 `0024_ai` + `rls_ai`: `ai_runs` (صف لكل نداء: العضو، النوع، المصدر، المنتج / الدفعة، الموديل، التوكنز، التكلفة،
  الحالة، كود الغلط بس، والناتج) — العضو بيقرا صفوفه بس والأدمن كله، والكتابة للسيرفر بس؛ `ai_month_cost()` (شهر القاهرة،
  security invoker). `npm run db:test` كله ok محلي (Postgres 16)، والاختبار بيمسك شهر UTC وسياسة مفتوحة.
- [x] T3 `_shared/ai-content.js` + `tests/functions/ai-content.test.mjs` (15): شيك الطلبين (`parseWrite` / `parseStudio` — مافيش
  سعر ولا SKU بيتقري)، الطلب لـ Claude (`writeRequest` / `studioRequest`: Opus 5.5 + effort + `fallbacks: "default"`، التعليمات
  كاش، البيانات جوه `<product_data>` من غير `<>`، كتالوج الأقسام بـ « › » والألوان كاش في الاستوديو، صورة base64 أو لينك https من
  المرآة)، `readAnswer` (رفض / مقطوع / JSON آخر نص)، التنضيف (`cleanWrite` / `cleanStudio`: الحدود واللغة و`SEO_VARS`، الأقسام
  والألوان من الموقع بس)، والتكلفة (`costOf` بالموديل اللي رد) و`aiConfig`. الـ SDK 1.3.0 اتشيّك (`fallbacks` /
  `output_config.format` / `betas` في الأنواع). `npm test` 326.
- [ ] T4 Edge Function `ai-content` + Deno tests.
- [ ] T5 `IBAI` + mock + أداة المحتوى + زرار صفحة المنتج + e2e.
- [ ] T6 الاستوديو + e2e.
- [ ] T7 حي (المفتاح في الآخر).
