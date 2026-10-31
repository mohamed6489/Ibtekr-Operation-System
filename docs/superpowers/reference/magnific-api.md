# مرجع Magnific API — اللي السيستم بيستخدمه (المرحلة 5.4، T2)

اتثبّت 31 أكتوبر 2026 من صفحات `docs.magnific.com` (عبر البحث على الويب — الدومين نفسه محجوب في شبكة الجلسة، فالتفاصيل اللي
مش في الجدول ده تتأكد من الصفحة لما تتفتح). الطبقة الوحيدة اللي بتكلّم الـ API: `supabase/functions/ai-images/providers/magnific.ts`.

## الأساس والمصادقة
- الأساس: `https://api.magnific.com/v1/ai` (السر `MAGNIFIC_API_URL` بيحرّكه).
- الهيدر: **`x-magnific-api-key: <المفتاح>`** + `Content-Type: application/json`. (Bearer بيرجّع 403 — ده اللي كان حاصل قبل T2.)
- الأخطاء: 401/403 → عندنا `not_configured` (المفتاح مرفوض)، 429 و5xx → `busy`، 402 → `ai_error` (كريدت المزوّد خلصت)، 422 → `refused`.

## شكل المهمة (كل التوليد غير متزامن)
- الطلب `POST <route>` بيرجّع `{ "data": { "task_id", "status": "CREATED", "generated": [] } }`.
- المتابعة `GET <route>/{task_id}` لحد `status: "COMPLETED"` (الحالات: `CREATED` / `IN_PROGRESS` / `COMPLETED` / `FAILED`)؛ الصور في
  `data.generated` (روابط https). فيه `webhook_url` اختياري — مش مستخدم (بنعمل polling كل 2.5 ثانية لحد 150 ثانية).
- الرد مافيهوش عدد كريدت → السيستم بيسجّل التقدير اللي في `IMG_MODELS`.

## الموديلات (id بتاعنا → route)
| id عندنا | نص → صورة | بمرجعية (`reference_images` base64 خام) | ملاحظات |
|---|---|---|---|
| `seedream-5-pro` (الافتراضي) | `POST /text-to-image/seedream-v5-pro` | `POST /text-to-image/seedream-v5-pro-edit` (1–10 صورة) | `aspect_ratio`: `square_1_1` / `widescreen_16_9` / `social_story_9_16` / `portrait_2_3`؛ `resolution`: `1.5k` / `2k`؛ `prompt` ≤ 4096 |
| `seedream-5-lite` | `POST /text-to-image/seedream-v5-lite` | `POST /text-to-image/seedream-v5-lite-edit` | نفس الحقول |
| `gemini-2-5-flash` | `POST /gemini-2-5-flash-image-preview` | نفس الـ route (`reference_images` اختياري) | من غير `aspect_ratio` |
| `gpt-image-2` | `POST /text-to-image/gpt-image-2` | `POST /text-to-image/gpt-image-2-edit` (لحد 16 صورة) | من غير `aspect_ratio` عندنا لحد ما يتأكد |

مستنيين تأكيد قبل ما يتضافوا: **Nano Banana Pro** (`/text-to-image/nano-banana-pro`، `aspect_ratio` بصيغة `4:5`، `resolution` `1K/2K/4K`،
و`reference_images` عناصر فيها `mime_type` — شكل حقل الصورة نفسه مش مؤكد)، وMystic (`POST /mystic`)، وMagnific One.

كل route بيعمل **صورة واحدة** للمهمة؛ «العدد» في الأداة = مهام متوازية بنفس البرومبت.

## التعديلات
| العملية عندنا | الـ route | الطلب | الرد |
|---|---|---|---|
| `instruction` (نص حر) | route الـ `-edit` بتاع الموديل | `{ prompt, reference_images: [base64] }` | مهمة |
| `upscale` | `POST /image-upscaler` (Upscaler Creative) | `{ image: base64, scale_factor: "2x" \| "4x" }` (+ `optimized_for`، `creativity` اختياريين) | مهمة، `GET /image-upscaler/{task_id}` |
| `relight` | `POST /image-relight` | `{ image: base64, prompt }` (+ `change_background`، صورة إضاءة مرجعية اختياريين) | مهمة |
| `remove_bg` | `POST /beta/remove-background` | `{ image_url }` — **رابط** (JPG/PNG ≤ 20 ميجا)؛ السيستم بيوقّع رابط من الـ bucket لـ 10 دقايق | **متزامن**: `{ original, preview, url, high_resolution }` روابط صالحة 5 دقايق — بننزّل `high_resolution` فورًا |

ملحوظة: الـ cutout بيرجّع PNG شفاف بس؛ خيار «خلفية بيضا/كريمي» في الأداة لسه بيرجّع الشفاف (تلوين الخلفية = خطوة لاحقة).

## الفحص (probe)
`GET /text-to-image/seedream-v5-pro` (قايمة مهامنا — من غير كريدت): 200 = المفتاح شغّال، والدالة بترجّع شكل الرد (مفاتيح وأنواع بس).

## المصادر (31 أكتوبر 2026)
- https://docs.magnific.com/api-reference/text-to-image/post-seedream-v5-pro و`post-seedream-v5-pro-edit` و`get-seedream-v5-pro-task`
- https://docs.magnific.com/api-reference/text-to-image/post-gemini-2-5-flash-image-preview
- https://docs.magnific.com/changelog/2026 (gpt-image-2 / gpt-image-2-edit، seedream-v5-pro-edit/{task-id})
- https://docs.magnific.com/api-reference/image-upscaler-creative/post-image-upscaler
- https://docs.magnific.com/api-reference/remove-background/post-beta-remove-background
- https://docs.magnific.com/api-reference/image-relight/post-image-relight
- https://docs.magnific.com/api-reference/text-to-image/post-nano-banana-pro و`nano-banana-pro-flash/generate`
- الفهرس: https://docs.magnific.com/llms.txt
