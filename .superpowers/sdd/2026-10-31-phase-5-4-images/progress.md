# دفتر المرحلة 5.4 — صور المنتجات بالـ AI

الخطة: `docs/superpowers/plans/2026-10-31-phase-5-4-images.md`. الفرع `main-gha10e` (main = النشر).

- [x] T1 (31 أكتوبر): الخطة والدفتر. اللي اتعرف: كتالوج Magnific الحقيقي من الـ MCP (الأسماء مطابقة للـ prototype، التكلفة
  بكريدت Magnific 50–75 للصورة مش 2–3)، حساب صاحب المشروع Premium+ شخصي (مش API)، و`docs.freepik.com` محجوب في الـ sandbox.
  صاحب المشروع (31 أكتوبر): «ابني كل حاجة وخليها واقفة على الـ API — معايا Magnific API» → المزوّد Magnific API، المفتاح
  `MAGNIFIC_API_KEY` في الآخر، الكريدت هي العملة؛ شكل الـ API يتأكد في T2 لما الدومين يتسمح (`magnific.com` محجوب هنا كمان).
- [x] T2 مرجع الـ API (31 أكتوبر، بعد ما الاختبار الحي رجّع 403): الدومينات لسه محجوبة في الجلسة، بس البحث على الويب جاب صفحات
  `docs.magnific.com` → `docs/superpowers/reference/magnific-api.md`. اللي اتغيّر في `providers/magnific.ts`: الهيدر `x-magnific-api-key`
  بدل Bearer، الأساس `/v1/ai`، route لكل موديل (`/text-to-image/seedream-v5-pro`، و`-edit` بالمرجعية base64 خام، `aspect_ratio` +
  `resolution`)، المهمة `data.task_id/status/generated` وpolling على نفس الـ route، الـ cutout متزامن على `image_url` (رابط موقّع من
  الـ bucket)، الـ upscaler `/image-upscaler`، relight `/image-relight`، الـ probe = GET قايمة المهام. الموديلات اتسمّت على الحقيقي:
  `seedream-5-pro` / `seedream-5-lite` / `gemini-2-5-flash` / `gpt-image-2` (Nano Banana Pro مستني تأكيد شكل حقل المرجعية). `ai-images` v5.
  **1 نوفمبر:** أول «ولّد» حي على v5 رجّع `ai_error` من المزوّد (الصف 73، `configured: true`، من غير رقم HTTP = المهمة فشلت بعد ما
  اتقبلت). المراجعة التانية للمستندات: المرجعية JPG/PNG بس (صورنا كانت WebP) والرابط أحسن من base64 → v6: المرجعية رابط موقّع من الـ
  bucket (10 دقايق) وbase64 احتياطي، صورة الأداة بتتخزن في `<uid>/src-…` وتتبعت كرابط، صور الاستوديو الجديدة JPG (`toWebp` بقت بتطلّع
  JPEG — الاسم فضل لمستخدميه)، وأي فشل بيتسجّل `output.detail` (شكل الرد ونص الخطأ، base64 مطموس) عشان التشخيص من الداتا بيز.
  **1 نوفمبر (بعد v6):** الاستوديو اشتغل حي — صف 75 Seedream 5 Pro (`gen-0-1-….jpg`، 75 كريدت)، 76–78 Gemini 2.5 Flash (20 لكل
  واحدة)، 79 GPT Image 2 (60) = المفتاح والـ routes والمرجعية كلهم صح. بعدها أداة «نص لصورة» (الصفوف 80–84، التلات موديلات) رجّعت
  **HTTP 402** من Magnific؛ رصيد الحساب (MCP `account_balance`): 37 كريدت من 630,000 — الرصيد خلص (الـ «غير محدود» بتاع الويب
  مابيشتغلش على الـ API). `call()` كان بيرمي على 402 قبل ما يقرا الرد (`detail: null`) → v7: أي رد غير 2xx بيتقري الأول وكلام
  المزوّد بيوصل `output.detail` (401/403/429 كمان). T9 مستني شحن الرصيد وبعدها القبول (نص لصورة، صورة لصورة، التعديلات، «احفظ على المنتج»).
  **1 نوفمبر — قرار 7 (WebP):** صاحب المشروع سأل «الصور اللي بتطلع jpg ولا webp» (Seedream JPG، Gemini/GPT PNG) وطلب التحويل لـ WebP
  بعد الـ generate. اتقاس ImageMagick wasm في Deno: 2048² → WebP ≈ 3 ثواني CPU (الدالة ليها 2 ثانية) → التحويل في المتصفح
  (`IBImages.toWebp` canvas 0.85 بعد كل generate/edit/create، `webpAll`) + action `webp` في الدالة (نفس الاسم `.webp`، upsert، مسح
  الأصل، تعديل `output.paths` في الصف؛ RIFF/WEBP بس؛ صلاحية صاحب الصورة). `ai-images` v8. الاختبارات: Deno (14)، node (12 — متصفح
  وهمي بكانفس بيكتب webp أو png زي Safari)، e2e (الأداة والاستوديو بيتأكدوا إن الأصل PNG اتبدل بـ `.webp` وصف السجل اتعدّل؛ الـ mock
  بقى بيرجّع PNG زي المزوّد وبيقبل download من bucket studio لأصحاب products.add).
  **1 نوفمبر — قرار 8 (صور موقع Magnific بالـ Unlimited):** صاحب المشروع سأل عن الـ unlimited؛ الـ MCP بيقول `unlimitedAppliesHere: false`
  (الـ API والـ MCP بيخصموا كريدت) والـ API مابيشوفش مكتبة الموقع، لكن الـ MCP بيقراها (`creations_search full=true` → `url` على
  `pikaso.cdnpk.net` موقّع ~5 أيام). القرار: مسار تاني جنب الـ API من غير مسح أي حاجة — جسر جلسة Claude → `image_imports` (`0026`،
  `rls_image_imports`) → action `import` في `ai-images` (v9، 0 كريدت، `source = 'import'`، partial بيتكمّل) → كارت «وارد من Magnific»
  في الأداة → WebP → «احفظ على المنتج». الاختبارات: Deno (15)، node (13)، e2e (`images.spec` حالة كاملة بالـ mock). الطريقة في
  `tools/deploy.md` §2.7.13. **لسه:** `0026` على الحي (SQL Editor — `revoke` بيوقف `apply_migration`)، `rls_image_imports` live، نشر v9.
- [x] T3 `0025_ai_images` (31 أكتوبر): `ai_runs.action` + `image`، `source` + `tool`/`edit`، عمود `credits`؛ bucket `ai-images` خاص
  (القراءة والحذف لفولدر العضو بـ `products.add`/`products.edit` F، الكتابة للسيرفر بس)؛ `rls_ai_images.sql`. مافيش Postgres محلي
  في الـ sandbox — بيتأكد في CI (`db:test`) وعلى الحي بـ RLS live بعد التطبيق.
- [x] T4 `_shared/ai-images.js` (31 أكتوبر): `IMG_MODELS` (4 موديلات بالكريدت: Seedream 5 Pro 75 افتراضي، Nano Banana 2.1 50 —
  الاتنين من تقدير Magnific نفسه — وLite 20 وGPT 2 60 تقديريين)، `sizeOf`، `parseGenerate`/`parseEdit`/`parseCreate`، `slotPrompt`/
  `shapePrompt`/`editPrompt`، المسارات، `imageSettings` (`image_model`/`image_monthly_credits` فوق `MAGNIFIC_MODEL`/`IMAGE_MONTHLY_CREDITS`).
  اختبارات node 9.
- [x] T5 Edge Function `ai-images` (31 أكتوبر): `index.ts` (actions `generate`/`edit`/`create`/`probe`؛ JWT العضو بس —
  `generate`/`edit` على دفعة = `products.add` F، على منتج = `products.edit` F، `create` = أي واحدة، `probe` أدمن؛ الحجز عبر
  `ai_run_start` بسقف الكريدت الشهري من `image_monthly_credits` قبل النداء، الصف في `ai_runs` بـ `credits`؛ الناتج في bucket
  `studio` (الدفعة) أو `ai-images` (`uid/run-n.ext`)؛ السجل = صف `ai_runs`، و`activity_log` `product.ai.image` من الـ adapter في T6
  زي `ai-content`) + `providers/magnific.ts`
  (الطبقة الوحيدة اللي عارفة شكل HTTP بتاع المزوّد: POST task → poll `/tasks/{id}` → تنزيل الصور؛ `MAGNIFIC_API_URL` بيحرّك
  الأساس؛ 401/403 → `not_configured`، 429/5xx → `busy`، task فشلت بسبب safety → `refused`، غيرها `ai_error`؛ `probe` بيرجّع
  شكل رد الحساب — مفاتيح وأنواع بس — عشان T2) + `index_test.ts` 13 اختبار. `config.toml` `[functions.ai-images] verify_jwt=false`،
  `deno:check` و`deploy-functions.yml` فيهم `ai-images`، `_test/fakes.ts` فيه `storage.upload` و`credits`.
  **بعد المراجعة الأمنية التلقائية (31 أكتوبر):** الحجز والسقف بقوا في RPC واحد مقفول `ai_image_run_start` (اتضاف لـ `0025` مع
  `ai_month_credits()` واختباراتهم في `rls_ai_images`) بدل فحص في الدالة وحجز بعده؛ وصورة المنتج المرجعية من host الموقع بس (`WOO_URL`
  + `IMAGE_HOSTS`)، https، `redirect: 'error'`، حد حجم ومهلة 20 ثانية.
- [x] T6 `IBImages` (31 أكتوبر): `app/js/adapter/images.js` (بيتحمّل مع الـ adapters في `index.html`): `can` (`studio`/`edit`/`tool`/
  `settings`)، `generate(batchId, index, slot, {model,size})` / `edit({batchId,index,path} | {productId}, op, {prompt,model,options})` /
  `create({source,prompt,shape,size,count,model,image|productId})` / `probe()` على `ai-images` بنفس خريطة الأسباب بتاعة `IBAI`؛
  `imageUrl(bucket, path)` (signed URL ساعة، كاش 50 دقيقة، حدث `ib:images`)، `download`، `remove` (فولدر العضو في `ai-images` بس)؛
  `history` (صفوف `image` الناجحة بأعمدة بالاسم)؛ `settings`/`saveSettings` (`image_model`/`image_monthly_credits` **مدموجة** في صف
  `ai` — و`IBAI.saveSettings` بقى بيدمج هو كمان عشان مايمسحش مفاتيح الصور)؛ `monthCredits` (RPC `ai_month_credits` + الصفوف
  بالمصدر)؛ `photoOf` (JPEG ≤ 1600px وفي حدود 2 ميجا base64)؛ قوايم `MODELS`/`SIZES`/`SHAPES`/`EDIT_OPS`. اللوج `product.ai.image`
  (المصدر والخانة/العملية والموديل والكريدت والـ ids — من غير برومبت ولا مسار). الـ stub بتاع اختبارات الـ adapters اتزوّد بـ
  `storage.from(bucket)`؛ اختبارات وحدة 10 (`tests/adapter/images.test.mjs`). الـ mock: handler `/functions/v1/ai-images` بنفس قواعد
  السيرفر (الصلاحيات، parse*، 404/400، سقف الكريدت من صف `ai`، `mock.imgFail`، الصور في `studioObjects`/`imgObjects`، صف `ai_runs`
  بالكريدت)، bucket `ai-images` (sign/download/delete لفولدر العضو، مافيش كتابة)، RPC `ai_month_credits`، وعمود `credits`؛ e2e
  `tests/e2e/images-adapter.spec.mjs` (2) بتشغّل الـ adapter من جوه الصفحة.
- [x] T7 خطوة «الصور» في الاستوديو (31 أكتوبر، `products-studio.js` + `studio.css` — مش كتلة): زرار «ولّد» على كل خانة فاضية (وصورة
  اللون في الـ Variable) → `IBImages.generate` بموديل الدفعة (`S.state.imgModel`، select «موديل الصور»، وإلا افتراضي الأدمن)؛ الصورة
  بتتحط في الخانة بعلامة «AI» (`it.imgAI`) والقديمة في النسخ (`it.imgHist`، آخر 6)؛ «ولّد كل الصور الناقصة» و«ولّد الناقص للمحدد»
  (checkbox لكل صف) بتأكيد بعدد الصور والكريدت والدولار التقديري؛ حالة الخانة «بيتولد…» / «فشل — ولّد تاني» (`S.imgBusy` بسبب
  الفشل)؛ منتج من غير مرجعية مابيتولدش له (ملاحظة في الصف وفي الـ note)؛ السحب بين خانات نفس المنتج بيبدّل الصورتين (والعلامات
  والنسخ)؛ بوب أب الصورة: المرجعيات + «عدّل بالـ AI» بنص حر و4 تعديلات سريعة (`IBImages.edit` instruction على مسار الخانة) + «اعمل
  تاني» + النسخ (ضغطة ترجع) + «حطها في خانة»؛ «التالي» بيستنى التوليد يخلص. e2e في `studio.spec.mjs` («studio images»).
- [x] T8 أداة «الصور» (31 أكتوبر): `app/js/pages/products-images.js` (مش كتلة؛ `IBImagesView`، الراوت `#products-tool-images[-<id>]`
  في `products.js`، والكارت في تاب إضافة اتفتح — `products.add` أو `products.edit` F — وزرار «ولّد صور بالذكاء الاصطناعي» في تاب
  الصور بصفحة المنتج): تابات صورة لصورة (صورة من الجهاز `IBImages.photoOf` أو منتج بالـ SKU — السيرفر بيجيب صورته) / نص لصورة /
  تعديل الصورة (شيل الخلفية بخلفية شفافة-بيضا-كريمي، حسّن وكبّر 2×/4× — على صورة منتج على الموقع) / صورة المقاس soon؛ الشكل
  (استوديو/في البيت/تفاصيل/إيد الصانع/مخصص)، العدد 1–4، المقاس من `SIZES` أو مخصص، الموديل، والتكلفة بالكريدت والدولار قبل
  النداء. الناتج: معاينة (signed URL) + تحميل + تحديد + «احفظ على المنتج» (تأكيد + «خليها في الأول») → **woo-sync action جديد
  `product_images_add { id, paths, first? }`** (`products.edit` F؛ مسارات فولدر العضو في `ai-images` بس — الأدمن أي مسار؛ بينزّل الكل
  الأول (ناقص → 404 من غير أي كتابة)، كل صورة على `wp/v2/media`، وبعدين PUT واحد بالصور الحالية + الجديدة؛ `WOO_PUSH_ENABLED`؛
  اللوج أعداد بس؛ `Deps.userId` اتضاف لـ woo-sync) عبر `IBProducts.addImages` (لوج `product.images.add`)؛ «سجل الصور»؛ «إعدادات
  الصور» للأدمن (كريدت الشهر، الموديل الافتراضي، السقف بالكريدت). Deno test للـ action، الـ mock بيحاكيه، e2e `tests/e2e/images.spec.mjs` (3).
- [~] T9 حي (31 أكتوبر): `woo-sync` **v44** (`product_images_add`؛ workflow run 41207180954 من `main` 22cb331) و`ai-images` **v1**
  (`verify_jwt false`، من الـ workflow كمان) اتنشروا؛ من غير توكن → 401. `0025_ai_images` **اتطبّقت من SQL Editor (صاحب المشروع)** —
  `apply_migration` وقف على سؤال تأكيد Supabase من غير رد زي `0024`؛ فحوص ما بعد التطبيق (§2.7.13) مطابقة (الدالتين، `credits`،
  الـ check بـ `image`، الـ bucket وسياستيه، والعضو مايقدرش ينفّذ الحجز). `rls_ai_images rls_ai` حي **ok** (RLS live run 41225159897).
  `MAGNIFIC_API_KEY` اتحط (صاحب المشروع). **فاضل:** T2 — «اختبار الاتصال بـ Magnific» من «إعدادات الصور» (الأدمن) بيرجّع شكل رد
  الحساب أو الغلط برقم HTTP؛ على النتيجة بتتظبط `providers/magnific.ts` (الدومينات لسه محجوبة في الـ sandbox) — ثم القبول.
