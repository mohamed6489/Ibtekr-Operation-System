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
- [x] T4 Edge Function `ai-content` (`index.ts` + `deno.json`) + `index_test.ts` (12): JWT العضو بس (`write` = أدمن أو
  `products.add`/`products.edit` F، `studio` = أدمن أو `products.add` F)؛ مافيش مفتاح = 503 `not_configured` من غير نداء؛
  السقف (`ai_month_cost` ≥ `AI_MONTHLY_LIMIT_USD` = 402 `ai_cap`؛ مش مقروء = مافيش نداء)؛ 60 نداء للعضو في 10 دقايق = 429
  `busy`؛ 429/5xx = محاولة واحدة بعد 2 ثانية؛ 401/403 من Anthropic = `not_configured`؛ صورة منتج مش متاحة (400) بتتشال مرة؛
  رفض بعد الـ fallback = 200 `refused`؛ المنتج من المرآة (الصف الإنجليزي، اسمه العربي، مسار الأقسام، البراند، الصورة https)؛
  الاستوديو بيقرا الدفعة والبراند والصورة (من الدفعة دي بس) والأقسام والألوان. كل نداء صف `ai_runs` (من غير المفتاح ولا
  الطلب). اتجرّب بـ 4 تعديلات غلط (السقف، الـ throttle، الصلاحية، مسار الصورة) والاختبارات مسكتهم. `deno:check` الـ 3 دوال، و
  `deno:test` 141. semgrep: semgrep.dev مقفول من الـ proxy هنا — بيتشيّك في CI.
- [x] مراجعة الأمان على T4 (الـ throttle كان بيعدّي لو الداتا بيز وقعت، والسقف والحد بيتشيّكوا قبل النداء ويتسجلوا بعده —
  نداءات في نفس الوقت كانت تعدّي سوا): RPC `ai_run_start` في `0024` (لسه ماتطبقتش حي) بيحجز النداء في خطوة واحدة مقفولة
  (`pg_advisory_xact_lock`): 60 في 10 دقايق للعضو = `busy`، السقف + الحجز = صف `cap`، غير كده صف `pending` بـ $0.50 والنتيجة
  بتتكتب عليه؛ مافيش حجز = مافيش نداء؛ نتيجة مش معروفة بتفضل بالحجز. `rls_ai` (الحجز والحد لكل عضو والسقف والصلاحية)، و
  Deno 13 (الصف `pending` وقت النداء، تحديث ضايع بيسيب الحجز). `db:test` و`deno:test` 142 و`npm test` 326.
- [x] T5 `IBAI` (`app/js/adapter/ai.js` + 6 unit) + `products-content.js` (أداة المحتوى من الـ prototype: من بيانات / صورة
  تتصغّر في المتصفح / منتج بالـ SKU، اللي يطلع واللغة والأسلوب، الناتج لكل لغة بيتعدل مكانه، «اكتب تاني»، «نسخ»، «احفظ على
  المنتج» بتأكيد عبر `product_save`، «سجل المحتوى» من `ai_runs`) + كارت «المحتوى» شغال في «إضافة» و«اكتب بالذكاء الاصطناعي» في
  تاب الأوصاف + `aiDisplay` / `paraHtml` / `aiSaveChange` في `products-domain.js` (+3 unit) + الـ mock (`ai-content` بنفس
  `parseWrite`/`cleanWrite` بتوع السيرفر، و`ai_runs`) + `content.spec` (5). `npm test` 335، الـ e2e كله على الـ mock 182 أخضر.
- [x] T6 الاستوديو: `aiFill` (منتج منتج على الدفعة المحفوظة، تأكيد بالعدد والتكلفة لأكتر من منتج، بيقف على المفتاح / السقف /
  مشغول / الصلاحية) + «AI — راجع» و«اتملت بالـ AI» + التعديل بالإيد بيشيل العلامة؛ «البيانات و SKU»: الأسامي الناقصة + اللون اللي
  مش في الجدول؛ «المتغيرات»: «اقترح المتغيرات»؛ «الأقسام والأوصاف»: الناقص (وصف + قسم)، «اكتب بالـ AI» في الصف والـ popup، وللمحدد؛
  `aiApply` في `products-domain.js` (+1 unit)؛ `studio-ai.spec` (2). `npm test` 336، الـ e2e كله 184 أخضر.
- [ ] T7 حي (المفتاح في الآخر) — الخطوات والفحوص في `tools/deploy.md` §2.7.12، و`[functions.ai-content] verify_jwt = false` في
  `supabase/config.toml`. 29 أكتوبر: `list_migrations` على الحي آخرها `0022_products_report` (`0023` اتطبّقت من SQL Editor)؛
  `list_edge_functions` و`apply_migration` و`deploy_edge_function` محتاجين موافقة صاحب المشروع — مستنيين.
  - [x] رقم `woo-sync` الحي = v36 و`woo-webhook` v18 (آخر رقم في §2.6) ومافيش `ai-content` قبل كده (29 أكتوبر).
  - [x] `0024_ai` — `apply_migration` (3 مرات) و`execute_sql` (مرة) وقفوا على سؤال تأكيد Supabase (الملف فيه `drop policy` /
    `revoke`) من غير رد في 60 ثانية، فصاحب المشروع طبّقه من SQL Editor (30 أكتوبر، زي `0021`/`0023` — مش في
    `list_migrations`). فحوص ما بعد التطبيق مطابقة: RLS شغّال؛ `ai_month_cost` و`ai_run_start` `security invoker`؛
    `ai_run_start` لـ `service_role` بس (لا `authenticated` ولا `anon`)؛ `anon` مايقدرش ينفّذ `ai_month_cost`؛ `authenticated`
    `select` بس (لا insert ولا update)، و`anon` ولا حاجة؛ `service_role` insert/update؛ سياسة واحدة `ai_runs_select`؛ 18 عمود؛
    0 صف.
  - [x] `rls_ai` عبر «RLS live» — run 41089994191 (30 أكتوبر): `rls-live: rls_ai ok` (rollback).
  - [x] نشر `ai-content` **v1** (29 أكتوبر، `verify_jwt: false`، id `a8f8ae82-6949-44b9-a6dc-95664e18a730`) قبل `0024` بالقصد —
    من غير `ai_run_start` الحجز بيفشل فمافيش أي نداء لـ Claude (502 `ai_error`)، والواجهة لسه مش على `main`. `get_edge_function`:
    الملفات الأربعة **مطابقة للريبو حرف بحرف** (مقارنة بـ node). الـ sandbox مابيوصلش `supabase.co`، فالفحص من الداتا بيز
    (`net.http_post` من غير توكن) → 401 `{"error":"unauthorized"}` من الدالة نفسها.
  - [ ] `main` (الواجهة) + `origin/deploy^{tree}` = `origin/main:app`.
  - [ ] صاحب المشروع يحط `ANTHROPIC_API_KEY` ← القبول (أداة المحتوى + منتج في الاستوديو) ← `ai_runs` ← التقرير.
