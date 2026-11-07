# دفتر المرحلة 9.5 — التسويق

الخطة: `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`

- T0 ✓ (6 نوفمبر) الخطة + الدفتر. المصدر: صفحة التسويق في الـ v5 (artifact «نظام إبتكر»): الدومين `IbtekrCampWiz` + الصفحة (7 تابات، الكامبين 4 خطوات، سجل النشر، الخطة الإعلانية، القوالب). قرارات صاحب المشروع 1–3 (ميتا دلوقتي وتيك توك وجوجل قريب، الترتيب 9.5.1 → 9.5.2 → 9.5.3، الفيديو بعدين) وقرارات التنفيذ 4–20.
- T1 ✓ (6 نوفمبر) `app/js/pages/marketing-domain.js` = دومين الـ v5 (`IbtekrCampWiz`) + قواعدنا: `PRICE_DEMO = false` (كريدت الموديل الحقيقي)، `TEXT_FILL = 0` (الكتابة بالـ AI من سقف المحتوى)، `VIDEO_SOON` (العدد صفر والكود فاضل)، حالة الكامبين (`campaignStatus`)، بنود الجدول (`scheduleItems` — قطعة × منصة)، `moveCheck` بتوقيت القاهرة، خطة الـ ZIP، أسابيع الخطة الإعلانية (`planDefault` زي الـ v5)، و`linkKeys` (لينك منتج أو SKU). `tests/domain/marketing-domain.test.mjs` 14 ok.
- T2 ✓ (6 نوفمبر) `0049_marketing.sql` + `supabase/tests/rls_marketing.sql` (`db:test` كله ok — 42). الصلاحيات بقرار 6 (الأدمن و`ops` F/F/F، الباقي N)؛ `mkt_campaigns` (الكتابة بقايمة أعمدة: الاسم/الهدف/الخطوة/`state`/`archived_at`؛ تريجر بيختم الوقت والعضو من السيرفر، والمحذوفة مابتتغيرش)؛ `mkt_templates` (+ `mkt_template_used`)؛ `mkt_posts` من غير كتابة مباشرة: `mkt_schedule` (قطعة × منصة، اليوم من النهارده لحد سنة والساعة مش فايتة بالقاهرة، الصور من فولدر الكامبين بس، تأكيد تاني بيحدّث المستني وبيسيب المنشور وبيحذف المستني اللي اتشال) و`mkt_post_act` (`move` / `caption` / `published` بلينك https / `delete` بـ `was_live`)؛ `mkt_credits()` (السقف واللي اتصرف للفريق — `marketing.create` F بس)؛ `ai_runs` بقى بياخد `marketing` و`campaign`/`template`/`post`؛ broadcast `marketing`/`changed`؛ bucket `marketing` (القراية `view`، الرفع `create` في فولدر كامبين مفتوحة أو `templates/`).
- T3 ✓ (6 نوفمبر) `app/js/adapter/marketing.js` (`IBMarketing`): بيتحمّل لما الصفحة تتفتح (`ensure`) — الكامبينات بعواميد القايمة بس (الـ `state` كله لما تتفتح)، السجل، القوالب، والرصيد (`mkt_credits`)؛ الحفظ واحد ورا التاني (`save` / `saveSoon` + `flush` قبل أي نداء AI عشان السيرفر يقرا آخر خانات)، الملفات (فولدر الكامبين أو `templates/`، صور ≤ 15 ميجا، لينكات موقّعة، الـ bytes للـ ZIP)، لينك المنتج (`products` بالـ SKU أو الـ permalink)، الـ AI (`ai-images` `campaign` / `campaign_edit` و`ai-content` `marketing` + رسايل الرفض بالعربي)، الجدول والسجل (`mkt_schedule` / `mkt_post_act`)، القوالب، واللحظي (`marketing` / `changed` + فحص كل دقيقة). `activity_log` `mkt.*` أرقام وأنواع ومنصات بس (الاختبار بيدوّر على أي نص). اتحمّل في `index.html` واتمسح مع الخروج (`directory.js`). `tests/adapter/marketing.test.mjs` 14 ok. الـ mock: `tests/e2e/mkt-mock.mjs` (الجداول بالأعمدة المسموحة، الـ RPCs بقواعد 0049 وساعة القاهرة، الـ bucket) + صلاحيات `marketing.*` في أدوار الـ mock + `permalink` في فلاتر `products`. `npm test` 535.
- T4 ✓ (6 نوفمبر) السيرفر. `supabase/functions/_shared/marketing.js` (الجزء الصافي للدالتين والـ mock): فحص الطلبات، القطعة من `state` الكامبين المحفوظ (الصورة أو شريحة الكاروسيل أو غلافه — من غير الفيديو)، المرجعيات بالترتيب (صور المنتج: ملفات الكامبين ومنتجات الموقع، وبعدها الأمثلة والقوالب، 4 بالكتير)، برومبت الصورة (الهدف والفكرة والمشهد والكلام العربي اللي يتكتب جوه الصورة والتعليمات وشرح القوالب)، برومبت التعديل بالنقط (٪ من الشمال ومن فوق)، وطلب Claude لكل مهمة (`fill` / `rewrite` / `describe` — مصري، من غير هاشتاج، إيموجي في الكابشن بس) وتنضيف الرد. `ai-images` بقى فيه `campaign` و`campaign_edit` (`marketing.create` F؛ الصورة في bucket `marketing` تحت الكامبين بصيغتها PNG/JPEG؛ `ai_runs` `source = campaign`)؛ `ai-content` بقى فيه `marketing` (الكامبين من الداتابيز مش من الطلب؛ `action = marketing`، source campaign / post / template). اختبارات: node `tests/functions/marketing.test.mjs` 8، Deno ai-images +2 وai-content +2 (`deno:test` كله 221، `deno:check` ok)؛ الـ mock بقى بيرد على الـ AI بنفس دوال السيرفر. `npm test` 543.
- T5+T6 ✓ (6 نوفمبر، commit واحد بقرار 21) الصفحة `app/js/pages/marketing.js` + `app/css/marketing.css` (مش كتلة؛ بعد `products.js` وقبل الكتلة 28): «إنشاء» (كارت الكامبين + «آخر الشغل» بحالته من `campaignStatus`)، الكامبين 4 خطوات على `IBMarketing` (الحفظ التلقائي 1.2 ثانية و`flush` قبل أي نداء AI — قرار 24؛ «املا بالـ AI» بيملا الفاضي بس — قرار 22؛ تعديل العنوان/السطر/الشارة بيروح في تعليمات التعديل — قرار 23؛ الصورة بالكريدت والتكلفة قبلها، ومن غير رقم كريدت على الكتابة)، المراجعة بالنقط، النشر = ZIP (`IbtekrProducts.zip` — قرار 25) + `mkt_schedule`، «سجل النشر» (الكابشن والتأجيل و«علّمه اتنشر» واللينك والحذف؛ الكروت اتنشر/مجدول/اتحذف و«شيله من السجل» للمنشور — قرار 27)، «الخطة الإعلانية» بفترة `plan` والسحب لميعاد تاني (من غير فلتر المصدر — قرار 26)، «قوالب التصميم» (رفع + «اشرحها بالـ AI» + «اتستخدم»)؛ «نظرة عامة» و«مساعدين الذكاء الاصطناعي» و«التقارير» و«فيديو» «قريبًا». الكتلة 28 (قرار 20): `SOON = ['settings']`، `rangeOf('plan')` و`IBReportBlocks.rangeField` / `rangeOf` + `npm run lock`. `mkt.` في `LOGGED_PREFIXES` والمسح عند الخروج (قرار 28). الاختبارات: `npm test` 543، `marketing.spec.mjs` 6 (بعد آخر تعديلين: سياق الكامبين للكابشن لو لسه مفتوحة، والحفظ قبل التأكيد)، `auth.spec.mjs` 28، e2e كله 335 ✓. مراجعة أمنية: مافيش `innerHTML`، والـ logs أرقام وأنواع بس.
- T7 ✓ (6 نوفمبر) التوثيق: CLAUDE.md (المرجع + القاعدة 2 + البادئة + ملحوظة 9.5.1)، `tools/deploy.md` §2.7.24، قرارات 21–28 في الخطة.
  **على الحي:** `apply_migration` لـ `0049` وقف (سيرفر Supabase سأل سؤال تأكيد ومحدش ردّ في الوقت — مااتعادش) → صاحب المشروع لصقه في الـ SQL editor؛
  التحقق ✓ (الصلاحيات أدمن/`ops` F والباقي N، `mkt_posts` من غير insert/update للأعضاء، `scheduled_at` للسيرفر، الـ bucket مقفول 15 ميجا، 10 دوال
  و10 policies، `ai_runs_action_check` فيها `marketing`)؛ `rls_marketing` حي ✓ (run 42204752682)؛ `ai-images` ✓ (run 42204757362) و`ai-content` ✓
  (run 42204761270) من «Deploy functions»؛ `main` ← `445ab2b` (Deploy بيرفع الواجهة — «التسويق» مفتوحة).

## 9.5.2 — النشر التلقائي وأرقام البوستات

- T0 (9.5.2) ✓ (6 نوفمبر) الخطة: قرارات 29–39 + المهام T8–T13 في الخطة. مصادر Meta (الـ docs نفسها مش متاحة من الجلسة — من نتايج البحث): انستجرام
  JPEG بس و`image_url` عام (لينك موقّع من الـ bucket)، carousel ≤ 10، `STORIES`، الحذف `DELETE /<media>`؛ فيسبوك بوست متعدد الصور بـ
  `published=false` + `attached_media`؛ `post_impressions` اتلغت (15 نوفمبر 2025) → `post_media_view`؛ انستجرام `impressions` اتلغت → `views`.
- T8 ✓ (6 نوفمبر) الدومين: `scheduleItems(…, conn)` بـ `how` (انشر على القطعة + المنصة تقدر = publish)، `publishable` (المنصة، النوع، عدد الصور
  2–10 للكاروسيل وواحدة للبوست والستوري، 2200 حرف لانستجرام بالهاشتاجات، ثم الربط بالسبب)، `notReady`، `igFit` (4:5 … 1.91:1، هوامش بيضا لحد 10%،
  الستوري أي نسبة)، `jpegSize` (≤ 2160)، `pubText`، `PUB_ERRORS` / `pubError`، `seenSt` / `engOf` / `postTotals`، `SRC_LABEL`. الاختبارات 18 ✓.
- T9 ✓ (6 نوفمبر) `0051_marketing_publish.sql` + `rls_marketing_publish.sql` (`db:test` كله ✓): أعمدة `mkt_posts` (`src` / `external_id` (فريد مع المنصة) /
  `thumb` / الأرقام + `stats_at` / `error` / `attempts` / `claimed_at` / `work`)، صف المنصة من غير كامبين؛ `mkt_schedule` بـ `how` (النشر: فيسبوك /
  انستجرام، بوست وستوري صورة وكاروسيل 2–10، انستجرام JPEG والكلام بالهاشتاجات ≤ 2200) والصف اللي بيتنشر مابيتلمسش؛ `mkt_post_act` بيرفض
  `invalid: busy`؛ `mkt_publish_claim` (`for update skip locked`، الآخر خطوة اللي ماتت = «فشل» `uncertain`) و`mkt_stats_put` (statement واحد) و
  `mkt_autopublish` للسيرفر بس؛ المفتاح = صف `settings` «marketing» (مافيش صف = متوقف — زي باقي الأقسام، `rls_system` بيعد صفوف البذرة)؛ الـ cron
  `mkt-publish-due` كل دقيقة (لو فيه بوست جه ميعاده والمفتاح شغال بس) و`mkt-publish-stats` كل 30 دقيقة. ملاحظتين اتصلحوا: `case` جوه شرط `if` في
  PL/pgSQL لازم بين قوسين، و`least()` بيتجاهل الـ NULL (العدد الناقص كان بيبقى أكبر رقم).
- T10 ✓ (6 نوفمبر) السيرفر: `_shared/mkt-publish.js` (`planOf`، `ourCode`، الـ paths والـ bodies، `fbStatsOf` / `igStatsOf`، `platformRowOf` بتوقيت القاهرة
  وبوست أحدث من 15 دقيقة بيستنى، `connectionOf`) + `PUBLISH_SCOPES` في `_shared/cs-channel.js` (الـ dialog بيطلبها، و«الناقص» بتاع خدمة العملاء
  زي ما هو) + Edge Function **`mkt-publish`** (`due` / `stats` بسر المزامنة، `status` / `autopublish` / `publish_now` / `delete` بالـ JWT): فيسبوك
  بوست/كاروسيل (صور مخفية + feed)/ستوري (صورة مخفية + photo_stories)، انستجرام كونتينر → FINISHED → `media_publish` (كونتينر لسه بيتجهز
  بيتحفظ والدقيقة الجاية بتكمّل من غير رفع تاني)، `work.stage = publishing` قبل آخر نداء وتايم أوت فيه = `uncertain`، الصور بلينكات موقّعة
  15 دقيقة. `config.toml` + workflow النشر (`mkt-publish`) + `deno:check`. الاختبارات: Deno 11 (كله 232 ✓)، Node 7 + `cs-channel` 8، `npm test` 554 ✓.
- T11 ✓ (6 نوفمبر) `IBMarketing`: شكل البوست بالجديد (`src` / `thumb` https بس / `externalId` / الأرقام / `error` / `busy` = اتحجز آخر 5 دقايق)،
  `connection()` (حالة الربط والمفتاح من `mkt-publish status`، كاش دقيقة) / `connNow`، `setAutopublish` (الأدمن)، `publishNow` (و`pending` لانستجرام
  لسه بيتجهز) / `deleteLive` (رسايل الأكواد من `pubError` بالعربي)، و`preparePublish(cid, items)`: نسخ JPEG في المتصفح (0.92، ≤ 2160، هوامش بيضا
  لنسبة انستجرام — نسخة لكل صورة وهامش؛ JPEG مظبوط بيفضل زي ما هو) لصور البنود اللي هتتنشر بس. الـ mock: الأعمدة الجديدة، `mkt_schedule` بقواعد
  `how`، و`mkt-publish` (status / autopublish / publish_now / delete + `pubFail` / `delFail`). الاختبارات: adapter 17، `marketing.spec` 6 ✓، `npm test` ✓.
- T12 ✓ (6 نوفمبر) الصفحة: خطوة النشر (كارت «الربط بالمنصات» الحقيقي — حالة كل منصة، مفتاح النشر للأدمن بتأكيد، تنبيه صلاحية النشر و«اربط تاني»
  للأدمن من غير «فصل» — قرار 40؛ «انشر / داونلود» لكل قطعة والسبب لو مايتنشرش، «تلقائي: …»، «انشر المحدد»، و«تأكيد النشر» بيجهّز الـ JPEG
  قبل الجدولة)؛ «سجل النشر» زي الـ v5 (كروت اتنشر / المشاهدات / التفاعل / نسبة التفاعل، أعمدة المصدر والمشاهدات والتفاعل والنسبة، صورة بوست المنصة
  من المنصة)؛ بوب أب البوست (الأرقام وجدول لايك/كومنت/شير/سيف، سبب الفشل بالعربي، «انشر دلوقتي»، «احذف البوست» من المنصة، «افتح على …» ↗،
  «بيتنشر…» للصف المحجوز)؛ «الخطة الإعلانية» (فلتر المصدر، بوستات المنصة مابتتسحبش). CSS + موبايل (مافيش سكرول أفقي — اتشيّك 1280 و390).
  الاختبارات: `marketing-publish.spec.mjs` 5 + `marketing.spec.mjs` 6، `npm test` 557.
- T13 ✓ (6 نوفمبر) التوثيق: CLAUDE.md (ملحوظة 9.5.2 + المرجع)، `tools/deploy.md` §2.7.26، قرار 40 في الخطة.
  **على الحي:** `0051` بـ `apply_migration` من أول مرة (من غير سطور `drop constraint if exists` — الـ 7 قيود جداد ومش موجودين، اتأكد قبلها،
  فالسطور دي no-op والـ MCP ماسألش تأكيد)؛ التحقق ✓ (15 عمود + 7 قيود + فهرسين، `mkt_publish_claim` / `mkt_stats_put` / `mkt_autopublish`
  مقفولين على الأعضاء ومفتوحين لـ `service_role`، `mkt_schedule` لـ `authenticated` ومش `anon`، المفتاح false، الـ cron `mkt-publish-due` كل دقيقة
  و`mkt-publish-stats` كل 30 دقيقة بـ `postgres` — نفس صاحب الدوال فبيقدر ينادي `mkt_autopublish()`)؛ «RLS live» ✓ (run 42224669060:
  `rls_marketing_publish rls_marketing rls_security_advisor`)؛ «Deploy functions» `cs-channel` v21 ✓ (42224674104) و`mkt-publish` v1 ✓
  (42224684542)؛ CI ✓ (42224391038 — semgrep جوّاه؛ من الجلسة `semgrep.dev` مقفول بالبروكسي)؛ `main` ← `ac29cdd` (Deploy ✓ 42226733681).
  **أول تشغيلة أرقام (13:30):** `added 66, numbers 31, gone 0, errors []` — فيسبوك 16 بوست (آخر 30 يوم) وانستجرام 50؛ الـ `media` بتاع
  انستجرام بيرجّع آخر 50 من غير فلتر تاريخ فدخل 35 بوست أقدم من 30 يوم (من غير أرقام) → `platformRowOf` بقى بيسيب أي بوست أقدم من
  `STATS_DAYS` (commit 94a1082 + اختبار Node وDeno) و`mkt-publish` اتنشرت تاني، والـ 35 صف (اتعملوا في نفس التشغيلة، من غير أرقام ولا كامبين)
  اتشالوا. **فاضل على صاحب المشروع:** الصلاحيات الأربعة في تطبيق Meta (والـ configuration لو `META_LOGIN_CONFIG_ID`)، «اربط تاني»، تشغيل
  المفتاح، وأول بوست تجريبي بإيده (الصفحة الحقيقية).
- قرار 41 ✓ (6 نوفمبر) صاحب المشروع مالقاش «اربط تاني»: مافيش كامبينات على الحي والكارت كان جوه خطوة النشر بس → نفس الكارت (الحالة
  والمفتاح و«اربط تاني») في «سجل النشر» تحت الكروت. e2e: «اربط تاني» من «سجل النشر» من غير أي كامبين؛ `marketing*.spec` 11 ✓.

## 9.5.3 — أرقام الإعلانات (Meta Ads جنب أوردرات ووكومرس)

- T0 (9.5.3) ✓ (6 نوفمبر) الخطة: قرارات 42–48 + المهام T14–T19. الداتا: 102 من 105 أوردر عليهم Order Attribution، وإعلانات ميتا عليها
  `utm_source = fb | ig` / `utm_medium = paid` / `utm_campaign = رقم الحملة` (اتأكد بـ SQL على `orders.raw` — المصادر والأعداد بس).
- T14 ✓ (6 نوفمبر) `0052_marketing_ads.sql`: مصدر الأوردر من `raw.meta_data` (`attr_type` / `utm_*` / `ad_platform`) بتريجر `orders_attribution`
  + تعبئة re-runnable (CTE + LATERAL)؛ `mkt_ad_objects` / `mkt_ad_stats` (القراية `marketing.view`، الكتابة للسيرفر)؛ RPC `mkt_ads_orders`
  (`marketing.view`، لحد 400 يوم، حصة إبتكر للأدمن أو `accounts.view ≠ N` بس)؛ cron `mkt-ads-sync` الدقيقة 23 كل ساعة. `rls_marketing_ads` ✓ محلي.
- T15 ✓ (6 نوفمبر) `_shared/mkt-ads.js` (ردود Meta → الصفوف؛ الشرا = أول نوع موجود من غير جمع؛ صف الحساب بيحتفظ بآخر نجاح) + الدومين
  (`ADS_RULES`، `adTotals` / `adCampaignRows` / `merWeeks` / `adAlerts` / `adCreatives`) — اختبارات 6 + 5.
- T16 ✓ (6 نوفمبر) Edge Function `mkt-ads` (الـ cron بسر المزامنة؛ `status` بـ `marketing.view`؛ `sync` للأدمن 1–400 يوم و`mkt.ads.sync` أعداد بس؛
  التوكن في الهيدر بس) — Deno 5 ✓، وفي `deploy-functions.yml` و`config.toml` و`deno:check`.
- T17 ✓ (6 نوفمبر) `IBMarketing.adsStatus` / `adsSync` / `adsData` / `adsWhy` (القراية 1000 صف في المرة، 60 ثانية كاش) + الـ mock
  (`mkt_ad_objects` / `mkt_ad_stats`، `mkt_ads_orders` من غير حصة لغير الحسابات، `mkt-ads` status/sync). adapter 19 ✓، `npm test` ✓، `marketing*.spec` 11 ✓.
- T18 ✓ (6 نوفمبر) «نظرة عامة» (الكروت الخمسة — الربح بعد الإعلانات بـ `accounts.view` بس —، تنبيهات الميديا باير من غير تنفيذ، حالة الربط، العائد 5 أسابيع،
  الصرف حسب المنصة، «المنصة بتقول × ووكومرس»، المساعدين قريبًا) و«التقارير» (الحملات بأيامها وفلتر الحالة، والأعمال الفنية بصورتها و«الناس زهقت منه»
  ونصيحة `utm_content`) بفترة صفحة التقارير و«مزامنة دلوقتي» للأدمن؛ الكتلة 28: تاب «الحملات الإعلانية» بـ `marketing.view` على `reportBlocks`
  (قرار 47) وفترة التقارير بترسم التسويق + lock. الدومين: `adTotals(…, money)` و`tiredFreq`. e2e `marketing-ads.spec` 6 ✓ + تعديل `reports` /
  `hr-reports` / `marketing` (التاب مابقاش قريبًا)؛ `npm test` 570 ✓.
- T19 (الحي — جاري، 6 نوفمبر) `0052` اتطبّق على الحي من أول مرة (MCP، من غير سطور `drop … if exists` التلاتة بعد ما اتأكدت إن الأهداف مش موجودة):
  6 أعمدة على `orders`، 100 من 105 أوردر عليهم مصدر (`utm` 54 · `typein` 43 · `referral` 3)، **53 أوردر من إعلانات ميتا** (fb 33 · ig 20) على 6 حملات
  كلها برقم، ومافيش `order_events` من التعبئة؛ `order_attribution` مقفولة على `authenticated` و`mkt_ads_orders` مفتوحة له ومقفولة على anon؛
  cron `mkt-ads-sync` `23 * * * *` شغال. الوثائق: CLAUDE.md (ملحوظة 9.5.3 + سطر المراجع) و`tools/deploy.md` §2.7.27.
- T19 ✓ (6 نوفمبر) «RLS live» (`rls_marketing_ads rls_security_advisor`) ✓ · «Deploy functions» `mkt-ads` ✓ → v1 ACTIVE (`verify_jwt = false`) · CI على
  3635160 ✓ (e2e 346 محلي ✓) · الواجهة على `main`. **فاضل على صاحب المشروع:** مفتاح System User (`ads_read`، Never) + رقم حساب الإعلانات في أسرار
  Supabase (`META_ADS_TOKEN` / `META_AD_ACCOUNT_ID` — §2.7.27 ج)، وبعدها «مزامنة دلوقتي» (أول تشغيلة 90 يوم)؛ لحد كده الدالة بترد `not_configured`
  والصفحة بتقول «إعلانات ميتا لسه مش مربوطة» وأوردرات ووكومرس من الإعلانات (53) ظاهرة.
- الحي (7 نوفمبر): صاحب المشروع حط التوكن (System User، Never، `ads_read` + `ads_management` — توكن واحد للمرحلة الجاية) والحساب. أول تشغيلتين
  `graph_1` «reduce the amount of data» (90 يوم × كل الإعلانات في استعلام واحد) → الدالة بقت تحفظ كلام ميتا (`error_text`) وتقرا الـ insights
  أسبوع أسبوع بصفحات 100 (`windowChunks` / `CHUNK_DAYS`) والصفوف unique قبل الـ upsert (de20bc1، 966452b؛ `mkt-ads` v3). التشغيلة التالتة ✓:
  `90 · 191 · 1153 · 1013` — حساب Ibtekr.club EGP ACTIVE، 191 حملة (2 شغالة) و1153 إعلان (9 شغالة)، أرقام من 10 أغسطس، والحملات الست بتوع
  أوردراتنا كلها اتطابقت بالرقم.

## 9.5.4 — المساعدين (الميديا باير بالتنفيذ، الديزاينر، المبرمج)

- T0 (9.5.4) ✓ (7 نوفمبر) الخطة: قرارات 49–56 + المهام T20–T24 (صاحب المشروع: «كمل بقية التسويق» و«عايزه زي البروتوتايب»).
- T20 ✓ (7 نوفمبر) `0053_marketing_buyer.sql`: `mkt_suggestions` (صفوف السيرفر، اقتراح مفتوح واحد لكل نوع × حملة بـ unique partial index،
  القراية `marketing.view`)، `mkt_requests` (الإضافة `marketing.create`، الحالة للأدمن، صاحب الطلب يعدّل نصه وهو «جديد» — `mkt_requests_guard`)،
  `mkt_buyer_rules()` (الافتراضيات فوقها `settings.marketing.buyer`؛ `live` false)، cron `mkt-ads-report` :35 كل ساعة. `rls_marketing_buyer` ✓ محلي.
- T21 ✓ (7 نوفمبر) الجزء الصافي في `_shared/mkt-ads.js`: `buyerRules` / `rulesPatch` (الأرقام والأوضاع بس — `live` عمره ما يتكتب من هنا)،
  `suggestionsOf` (وقّف ≥ autoStop في 5 أيام من غير أوردر › قلّل −30% لما تكلفة الأوردر > maxCpa مع ≥ 3 أوردرات › زوّد +20% لما العائد الحقيقي ≥ 4× مع
  ≥ 5 أوردرات؛ راجع التتبع لما مشتريات ميتا ≥ 5 و≥ 2× الأوردرات؛ نسخة جديدة لإعلان تكراره ≥ 4 أو نقراته نزلت 40%)، `budgetPlan` (الخطوة ≤ 30%، سقف
  الحساب اليومي، ميزانية الحملة CBO وإلا مجموعات الإعلانات الشغالة)، `accountDaily`، `reportText`. `mkt-ads`: بعد كل مزامنة `suggest` (المفتوح
  يتحدّث، اللي راح expired، الجديد يتضاف؛ autoStop «auto» + live = إيقاف فوري + جرس)، `rules` / `rules_set` / `live` (الأدمن، `activity_log`
  `mkt.buyer.rules` بأسماء المفاتيح و`mkt.buyer.live` on/off)، `decide` (الأدمن: ارفض / وافق / عدّل بنسبة من نفس الإشارة؛ المفتاح مقفول = القرار بيتسجل
  من غير نداء؛ شغال = POST `status=PAUSED` على عقدة الحملة أو `daily_budget` بعد GET الحملة ومجموعاتها وكل الحساب؛ الخطوة/السقف = 409 و`failed`؛ رفض
  ميتا = 502 بكودنا؛ نسخة جديدة = صف `mkt_requests` للديزاينر؛ التتبع = done)، `report` (الـ cron بسر المزامنة، ساعة القاهرة = `reportHour`، مرة في اليوم
  بـ `alerts.entity_id = report:<يوم>` للأدمن و`ops`). `ai-content` action `buyer` (`marketing.view` F أو P): أسبوع الحملات من جداولنا + الاقتراحات المفتوحة
  + القواعد في `<ads_data>`، نص بس — من غير أي تنفيذ من الشات؛ `ai_runs` action marketing / source buyer (`0053`). اختبارات: Deno 244 (mkt-ads 11،
  ai-content 18)، node 575، `rls_marketing_buyer` + `rls_security_advisor` ✓ محلي. semgrep محليًا مش واصل (proxy) — CI.
- T21 (إصلاح من المراجعة الأمنية) ✓ «زوّد الميزانية» بيتحسب على الأوردرات المؤكدة أو المكتملة بس (`confirmed` في `adOrdersSince` / `suggestionsOf`) — أوردر غير مؤكد
  أي حد يعمله بـ UTM الحملة عمره ما يزوّد ميزانية؛ الإيقاف وتكلفة الأوردر زي ما هم.
- T22 ✓ (7 نوفمبر) `IBMarketing`: `suggestions` (المفتوح + آخر 30 يوم، كاش دقيقة) / `suggNow` / `decide` (الأدمن؛ ارفض / وافق / عدّل بنسبة وملاحظة؛ المفتاح مقفول = «اتسجلت
  الموافقة…»؛ step / cap / no_daily_budget / decided / value بالعربي) / `rules` (RPC `mkt_buyer_rules`) / `rulesSet` (الأرقام والأوضاع، `live` عمره ما يتبعت) / `setLive` /
  `requests` + `addRequest` + `editRequest` + `setRequestStatus` (الديزاينر والمبرمج؛ `by` من `IBDirectory.members`) / `buyerChat` (`ai-content` `buyer`، آخر 6 أدوار).
  `activity_log` `mkt.buyer.decide` (القرار والحالة بس) / `mkt.request.*` (النوع والحالة) / `mkt.buyer.chat` (فاضي). الـ mock: `mkt_suggestions` (قراية بس) و`mkt_requests`
  (الحارس زي 0053) و`or=` و`mkt_buyer_rules` وactions `rules` / `rules_set` / `live` / `decide` (بـ `budgetPlan` نفسها، `mktAccountDaily`، `decideFail`) و`ai-content` `buyer`
  (`buyerFail` / `buyerAnswer`). اختبارات الـ adapter 24 (5 جديدة)، npm test كله أخضر.
- T23 ✓ (7 نوفمبر) الصفحة زي الـ prototype: تاب «مساعدين الذكاء الاصطناعي» اتفتح (`ai` من غير soon): **الميديا باير** = شات (`buyerChat`، ذاكرة الجلسة، آخر 6 أدوار،
  الشيبس السريعة) + «مستني موافقتك» (اقتراحات السيرفر؛ بوب أب الاقتراح: الأرقام · السبب · الأثر، «ارفض» بسبب / «عدّل» بنسبة من نفس الاتجاه لحد 30% / «وافق»
  — «وافق ونفّذ» بتأكيد لما المفتاح شغّال؛ غير الأدمن بيقرا بس) + «آخر القرارات» + «القواعد والحدود» (الأدمن يعدّل قاعدة بالضغط عليها، ومفتاح «التنفيذ على
  ميتا» بتأكيد زي النشر التلقائي)؛ **الديزاينر** و**المبرمج** = الطلبات بحالتها (الحالة للأدمن من بوب أب الطلب، صاحب الطلب يعدّله وهو «جديد») + «+ طلب».
  «نظرة عامة»: كارت «اقتراحات الميديا باير» (بدل تنبيهات الفترة — اتشالت) وكروت المساعدين التلاتة حقيقية؛ «التقارير»: عمود «القرار المقترح» من الاقتراحات
  المفتوحة. CSS الشات من الـ v5. e2e: `marketing-ai.spec.mjs` (4) + تعديل `marketing.spec` و`marketing-ads.spec`؛ الكل 350 أخضر، npm test أخضر.
- T24 ✓ (7 نوفمبر) الوثائق (CLAUDE.md ملحوظة 9.5.4، `tools/deploy.md` §2.7.28، الخطة) + الحي: `0053` اتطبّقت بالـ MCP (الجداول والسياسات والـ cron
  `mkt-ads-report` 35 * * * * و`ai_runs.source` «buyer» اتأكدوا)، «RLS live» `rls_marketing_buyer rls_security_advisor` ✓، «Deploy functions» `mkt-ads` (v5) ✓
  و`ai-content` ✓. المفتاح «التنفيذ على ميتا» متوقف على الحي لحد ما صاحب المشروع يشغّله.

## 9.5.5 — الفيديو بالـ AI

- T25 ✓ (7 نوفمبر) الخطة: قرارات 57–66 (المصدر جسر Magnific المربوط — الـ API مافيهوش فيديو؛ مهام غير متزامنة `mkt_video_jobs` + `video_poll`؛ المشاهد بـ Claude وصورها
  بـ `campaign`؛ `separate` clip لكل مشهد بصورته / `chained` = Seedance multi_prompt؛ الفويس بأصوات ElevenLabs المصرية والموسيقى Lyria؛ التجميع concatenate + mix؛
  أداة «فيديو» = كامبين بفيديو واحد؛ الريلز بتتنشر فعلًا على فيسبوك وانستجرام) والمهام T25–T30. الكتالوج اتقرا حي 7 نوفمبر (Seedance 2.5 `bytedance-seedance-pro-2.5`،
  Kling 2.5 `kling-25`، MiniMax H3 Max `minimax-video-3_0-max`؛ أصوات مصرية Bilal Khalil 1171 / Karim Zaidan 1334 / Yusuf Al-Mansour 227).
- T26 ✓ (7 نوفمبر) `0054_marketing_video.sql`: `mkt_video_jobs` (صفوف السيرفر؛ القراية `marketing.view` بقايمة أعمدة من غير `url`؛ المشهد < 8؛ القطعة `V<n>`)، bucket
  `marketing` بيقبل MP4 والصوت لحد 200 ميجا، `ai_runs.source` «video». `rls_marketing_video` ✓ محلي (+ `rls_marketing` و`rls_security_advisor`). الـ fakes فيها الجدول.
- T27 ✓ (7 نوفمبر) `_shared/mkt-video.js` (الموديلات بالـ slugs والحدود، `splitScenes` / `fitScenes`، `scenePrompt` / `clipArgs` / `chainedArgs`، الأصوات و`ttsArgs`، `musicArgs`،
  `mixPlan`، `videoPath`، `parseVideo`، `jobView`، `scenesRequest` / `cleanScenes`) + 8 اختبارات node؛ `campaignTarget` / `campaignPrompt` بيقبلوا قطعة «فيديو» بـ `slide` =
  المشهد (الكادر الأول من غير نص)؛ `ai-content` `marketing` task `scenes` (`marketing.create`؛ المدد من الموديل) + Deno.
- T28 ✓ (7 نوفمبر) `ai-images` actions `video_clip` (كادر المشهد بيترفع على Magnific برابط موقّع ثم `video_generate` بـ slug الموديل والمقاس والثواني وصوت بيئة؛ `chained` = multi_prompt
  بمرجع أول كادر) / `video_voice` (`audio_tts` ElevenLabs v3) / `video_music` (Lyria 3) / `video_upload` (ملف العضو: request_upload → PUT → finalize) / `video_assemble`
  (`mixPlan`: concat ثم الفويس ثم الموسيقى واحدة بعد التانية) / `video_poll` (`creations_wait` على المفتوح، التنزيل لـ bucket `marketing` من host مسموح لحد 120 ميجا، الفاشل
  يتعلّم، وسلسلة المزج بتكمّل لوحدها؛ الرابط مابيوصلش الصفحة) — كلها `marketing.create` + الجسر مربوط، صف `ai_runs` source «video» بـ 0 كريدت، 6 مهام مفتوحة للقطعة.
  `queuedIds` / `waitOf` / `nextMix` في الجزء الصافي. Deno 248 (3 جديدة) / check ✓ / node 589.
- T29 ✓ (7 نوفمبر) `VIDEO_SOON = false`: قطعة الفيديو في `blank` (المقاس 9:16/1:1/4:5/16:9، الموديل، الثواني، `sceneCount` 3، `method` منفصل/متسلسل، الموسيقى والفويس)
  و`estimateVideo`؛ `IBMarketing.videoScenes` / `videoClip` / `videoVoice` / `videoMusic` / `videoUpload` (MP3/M4A/WAV ≤ 50 ميجا لفولدر الكامبين ثم `video_upload`) /
  `videoAssemble` / `videoPoll` (اللوج `video.<kind>` بالقطعة والمشهد بس)؛ الصفحة: أداة «فيديو» في الهَب، إعدادات الفيديو في التفاصيل، «توليد المشاهد» بـ Claude
  وكادر لكل مشهد من المحفظة في البناء، والمراجعة بتايملاين الـ v6 + الموسيقى والفويس (AI / رفع / من غير) + طريقة التوليد + المهام + «حدّث» (poll كل 15 ث وهي مفتوحة)
  + التجميع + المشغّل + الموافقة، والريل داونلود في الجدولة لحد T30؛ الـ mock (`mktBridge` / `mktVideoDelay` / `mktVideoFail`، مهمة بتخلص مع كل poll) + CSS الـ v6.
  e2e `marketing-video.spec.mjs` (2) + تعديل `marketing.spec.mjs`. node 591 / e2e 352 ✓ (node اتذبذب مرة 590/1 وعدّى 4 مرات بعدها).
