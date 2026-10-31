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
- [ ] T7 خطوة الصور في الاستوديو + e2e.
- [ ] T8 أداة الصور + `product_images_add` + e2e.
- [ ] T9 حي.
