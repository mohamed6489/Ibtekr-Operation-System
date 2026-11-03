# المرحلة 6 — خدمة العملاء (2 نوفمبر)

طلب صاحب المشروع (2 نوفمبر): «خدمة العملاء خدها كلها من الجديد بس هنأجل تاب الردود الآلية والقوالب». وإجاباته على الأسئلة:
1. ربط الواتساب (QR أو API) **آخر حاجة** — نبني كل حاجة الأول.
2. n8n مش هنحتاجه.
3. نبدأ بقنوات Meta (ماسنجر + إنستجرام: رسايل وتعليقات). تيك توك مالوش API رسايل عام → يفضل «غير متصل».
4. العملاء من الأوردرات تلقائي + إضافة يدوية (leads: استفسار/مهتم) + استيراد شيت.
5. الحملات جوه خدمة العملاء زي الـ v2.

القاعدة (CLAUDE.md، 27 أكتوبر): الصفحة لسه مابدأناش فيها → **نسخة الـ prototype الجديدة (v2، artifact «نظام إبتكر» 2 نوفمبر) هي الأساس**،
تعديل ومسح عادي. التنفيذ في الجلسة نفسها، بالتوالي، من غير وكلاء، commit لكل مهمة.

## المصدر
الـ v2: الكتلة 22 (قواعد `IbtekrCS`، 18 ألف حرف) والكتلة 23 (الصفحة، 276 ألف حرف، 1329 سطر) + CSS `.cs-*` في `style-1.css`.
في الـ v2: التابات `inbox` الرسايل · `customers` العملاء · `segments` شرايح العملاء · `campaigns` الحملات · `performance` الأداء ·
`reports` التقارير (`K.reportTab('cs')`). **القوالب / الردود السريعة / الردود الآلية صفحة لوحدها** في الـ v2 (`autoreply`، منيو «الرد الآلي»)
و**القنوات** (ربط QR / Meta) جوه صفحة الإعدادات (`settings-integrations`). عندنا الكتلتين 19 (قواعد — اتعدلت في 3.6 لـ `RATE_KEYS`) و20
(الصفحة القديمة، مقفولة بـ soon) بنفس الدور → بنستبدل محتواهم بالـ v2 (تعديل مكتوب هنا) بدل ملفات `pages/` جديدة.

## القرارات المكتوبة
1. **المراحل:** **6.1** كل الصفحة على بياناتنا من غير قناة رسايل (الجداول، القواعد، الـ adapter، الصفحة، الجرس، شيل `cs` من `SOON`)؛
   **6.2** قناة Meta (ماسنجر + إنستجرام رسايل وتعليقات) — Edge Function `cs-channel` (webhook الاستقبال + الإرسال + ربط الصفحة بـ OAuth)،
   وكارت القنوات في الصفحة لحد ما الإعدادات تتبني؛ **6.3** الحملات على القناة (السقف اليومي، الفاصل، مواعيد الإرسال)؛
   **6.4 (الآخر)** واتساب 1 و2. **مؤجّل بقرار صاحب المشروع:** صفحة «الرد الآلي» (القوالب + الردود السريعة + الردود الآلية) تفضل
   `SOON`؛ أي زرار في الصفحة بيفتحها (مثل «قالب» في الكومبوزر، «تذكير بميعاد التسليم» في لوحة المبتكر) بيتشال أو بيقول «قريبًا».
2. **الصلاحيات (`0034`):** مفاتيح جديدة في `roles.permissions`: `cs.view` (F الكل / P محادثاتي المعيّنة لي + العملاء / N)، `cs.reply`
   (F: رد، ملاحظة، حالة، تعيين، إنهاء، تاجات، دمج، حظر)، `cs.manage` (F: الشرايح، الحملات، تعديل بيانات العميل، الاستيراد، إعدادات
   التوزيع). الأدمن F كله؛ `cs` F/F/F؛ `ops` F/F/N؛ `vendors_followup` F/F/N (محادثات المبتكرين)؛ `accounts` N؛ `viewer` P/N/N.
   التليفون في الـ CRM بقاعدة `sensitive.customer_phone` الموجودة (F كامل، غير كده `mask_phone`).
3. **الجداول (`0034_cs.sql`، كلها RLS + grants صريحة + `has_perm`):**
   - `cs_customers` (uuid; `phone` مطبّع فريد nullable، `name`, `ig`, `city`, `province`, `address`, `address2`, `mood`, `tags text[]`,
     `consent`, `auto_consent`, `source`, `created_from` orders|manual|import|channel, `blocked_at`, `merged_into`) + `cs_contacts`
     (customer_id, platform, external_id فريد — PSID/IGSID وقت 6.2) + `cs_customer_notes` (إضافة بس) + `cs_rating_overrides`
     (التقييم اليدوي؛ المحسوب من `customer_ratings` بتاعة الأوردرات).
   - **العملاء من الأوردرات:** تريجر `orders_cs_customer` على إدراج/تحديث `orders` (service_role) بيعمل upsert في `cs_customers` بالرقم
     المطبّع (`norm_phone` SQL = أرقام بس، الصفر الأول، تحويل الأرقام العربية) مع الاسم والمدينة/العنوان من أول أوردر؛ تعبئة
     re-runnable في الـ migration لكل الأوردرات الموجودة. أرقام الشراء (`orders`, `total`, `last_order_at`, `refused`, `returned`,
     `open_complaints`, `late_open`, `order_list`) **بتتحسب وقت الطلب** في RPC `cs_customers_list()` (`security definer`، `cs.view`)
     من `orders`/`order_items`/`customer_ratings` — مافيش أعمدة مجمّعة بتبوظ.
   - `cs_conversations` (uuid; `seg` customers|vendors|comments, `platform`, `channel` wa1|wa2|messenger|instagram|tiktok|facebook,
     `customer_id` / `vendor_id` / `handle`, `external_id`, `status` جديدة|مستنية ردنا|مستنية العميل|مؤجلة|اتحلت (check + `nextStatus`
     في القواعد)، `assignee` (profiles), `outcome`, `tags`, `last_in_at`, `last_out_at`, `waiting_since`, `unread`, `snoozed_until`,
     `closed_at`, `closed_by`) + `cs_messages` (uuid; `kind` in|out|note|auto|event, `text`, `author`, `external_id`, `delivery`
     queued|sent|delivered|read|failed, `meta jsonb`, `created_at`). Realtime على الاتنين. ملاحظة (`note`) وحدث (`event`) بيتكتبوا
     من الأعضاء؛ `in`/`auto` للسيرفر بس (6.2)؛ `out` من العضو بـ `delivery = 'queued'` والسيرفر بيبعتها (6.2) — **في 6.1 القنوات
     كلها «غير متصلة»** فالإرسال للعميل بيتحظر في الواجهة برسالة «القناة مش متصلة» زي الـ v2، والملاحظات الداخلية ورسالة جديدة
     (محادثة يدوية من غير إرسال) شغالين.
   - `cs_segments` (uuid; `name` فريد، القواعد زي `custSegments`: `min_total`, `min_orders`, `moods`, `last`, `last_from/to`,
     `ranges jsonb`, `include_unrated`, `add uuid[]`, `remove uuid[]`) — المطابقة في الواجهة بـ `segmentMatch` على نتيجة
     `cs_customers_list`.
   - `cs_campaigns` (uuid; `name`, `segment_id`, `channel`, `body`, `image_path`, `discount_code`, `scheduled_at`, `cap_per_day`,
     `min_delay_s`, `status` مسودة|مجدولة|شغالة|متوقفة|خلصت, `stats jsonb`) + `cs_campaign_recipients` (campaign_id, customer_id,
     `status`, `at`, `reply`) — في 6.1 مسودة/مجدولة بس (الإرسال في 6.3).
   - `cs_channels` (id text pk, `name`, `audience`, `kind` qr|meta, `status` disconnected|connected|error, `cap_per_day`, `meta`
     للسيرفر) — صفوف البداية الخمسة بحالة `disconnected`.
   - `cs_settings` في صف `settings` قسم `cs` (التوزيع بالدور، SLA 10/15، مواعيد العمل، القفل التلقائي) — الأدمن بيكتب.
   - `activity_log` بادئة `cs.` في `LOGGED_PREFIXES` (`cs.send`, `cs.note`, `cs.status`, `cs.assign`, `cs.close`, `cs.merge`, `cs.block`,
     `cs.customer.*`, `cs.segment.*`, `cs.campaign.*`) — الأرقام والأسماء بس، مافيش نص رسالة.
4. **القواعد (الكتلة 19 ← v2 22):** `IbtekrCS` بالكامل من الـ v2 (`RATE_KEYS`/`validateTeamRating` موجودين فيه — تقييم الأوردرات
   بيفضل شغال)؛ `tests/domain/cs-domain.test.mjs` بيتوسّع للقواعد المستخدمة (الحالات، SLA، نافذة 24 ساعة، المرحلة والتقييم، الشرايح،
   التوزيع، الدمج، `normPhone`/`matchSheet`).
5. **الـ adapter `IBCS` (`app/js/adapter/cs.js`):** تحميل العملاء (`cs_customers_list`)، المحادثات بآخر رسايلها (صفحات، آخر 90 يوم
   افتراضيًا)، الشرايح، الحملات، القنوات، الإعدادات؛ الكتابات كلها عبره (ملاحظة، حالة، تعيين، إنهاء بنتيجة + تقييم → `customer_ratings`
   لو فيه أوردر وإلا `cs_rating_overrides`، تاجات، دمج = `merged_into` + نقل المحادثات، حظر، عميل يدوي/تعديل، استيراد شيت،
   شريحة، حملة مسودة). Realtime على `cs_conversations`/`cs_messages` → `ib:cs`. الـ mock في `tests/e2e/supabase-mock.mjs` بنفس القواعد.
6. **الصفحة (الكتلة 20 ← v2 23):** زي الـ v2 بالحرف إلا: الداتا من `IBCS` بدل `S` التجريبية؛ الوكلاء (`AGENTS`) = أعضاء `IBDirectory`
   بدور خدمة العملاء/العمليات/متابعة المبتكرين وحالة أونلاين من `last_seen`؛ لوحة المبتكر من `IBVendors` + الأوردرات الفرعية المفتوحة من
   `IBOrders`؛ لوحة العميل أوردراته من `IBOrders`؛ «تحويل لتذكرة» → «قريبًا» (التذاكر soon)؛ أزرار القوالب والردود السريعة →
   «قريبًا» (مؤجل)؛ تاب القنوات/`settings-integrations` → كارت القنوات جوه الصفحة (6.2)؛ تاب التقارير بـ `reportTab` (يتنقل من v2 14
   للكتلة 14) على `IBReportBlocks` بتاب `cs` (أرقام من `cs_conversations`). الـ CSS: `.cs-*` وما يخصها من `style-1.css` في
   `app/css/cs.css`. الصفحة بتتشال من `SOON`؛ `autoreply` تفضل برّه (المنيو زي ما هو).
7. **الجرس واللوحة:** `notifSection` بتاعة الصفحة بيتربط في الكتلة 28 (مجموعة «رسايل»: محادثات SLA + قنوات فاصلة)؛ و«الإجراءات»
   (استيراد/تصدير العملاء) على `IBCS` بدل `csData().customers`، واستيراد القوالب يتشال.
8. **الاختبارات:** RLS (`rls_cs.sql`)، domain، adapter، e2e لكل تاب (الصندوق: فلترة/تعيين/ملاحظة/إنهاء بنتيجة؛ العملاء: القايمة من
   الأوردرات + يدوي + الملف؛ الشرايح؛ الحملات مسودة؛ الأداء؛ الجرس). `npm run lock` بعد 14/19/20/28.
9. **الترتيب الحي:** `0034` بالـ MCP ← `rls_cs` حي ← main. مافيش Edge Functions في 6.1.

## المرحلة 6.2 — قناة Meta (ماسنجر + إنستجرام) — قرارات مكتوبة (2 نوفمبر)
10. **الصفحة الحقيقية في وضع التطوير (قرار صاحب المشروع — «تمام يلا بينا على الحقيقية»):** الربط على صفحة فيسبوك «Ibtekr Club» الحقيقية
    وحساب إنستجرام المربوط بيها، بتطبيق Meta واحد (نوع Business) **في Dev mode**: رسايل وتعليقات أعضاء التطبيق بس (Admins / Developers /
    Testers) هي اللي بتوصل للـ webhook، وعملاء الصفحة الحقيقيين مش بيتأثروا ومحادثاتهم في Meta Inbox زي ما هي. التحويل لـ Live (App Review على
    الصلاحيات) **خطوة واحدة في الآخر** مع التحويل للموقع الحي (`tools/deploy.md` §2.7.8). صاحب المشروع بيعمل التطبيق وبيحط
    `META_APP_ID` / `META_APP_SECRET` / `META_VERIFY_TOKEN` في أسرار Supabase بنفسه (مايتبعتوش في الشات ولا يتكتبوا في الكود)، ويضيف نفسه
    Tester. من غير الأسرار الدالة بترد `not_configured`.
11. **التخزين (`0035_cs_meta.sql`):** `cs_oauth_states` (زي `magnific_oauth_states`: state + verifier، 10 دقايق، بتتصرف مرة؛ `service_role` بس) ·
    `cs_secret_get(p_name)` / `cs_secret_set(p_name, p_value)` على Vault لاسم واحد `meta_pages` (JSON: الصفحة المختارة بتوكنها الطويل + حساب
    إنستجرام + مرشّحين لحد الاختيار؛ `service_role` بس زي 0029 — التوكن عمره ما يطلع من Vault غير لذاكرة الدالة) · `cs_channel_events`
    (استلامات الـ webhook: `received_at`, `object`, `entry_id`, `status` ok|ignored|error, `error`, `summary` أعداد بس — من غير نص رسالة ولا
    أسماء؛ `service_role` بس) · `cs_channels.meta` للسيرفر: `{ page_id, page_name, ig_id, ig_username, fields }` **من غير توكن**، و`number` =
    اسم الصفحة / `@username`، و`since` وقت الربط. **تعبئة:** `cs_customers.created_from = 'channel'` للعميل اللي جه من القناة من غير رقم
    (الاسم من بروفايل Meta لو اتقري، وإلا «عميل ماسنجر» / «عميل إنستجرام»)، والربط في `cs_contacts` (platform + PSID / IGSID + handle).
12. **Edge Function `cs-channel`** (`verify_jwt = false`؛ الباقي زي `ai-images`: JWT العضو أو webhook موقّع — مافيش سر مزامنة):
    - **`GET`** = تحقق Meta (`hub.mode=subscribe` + `hub.verify_token` = `META_VERIFY_TOKEN` → `hub.challenge` نص 200، غير كده 403).
    - **`POST` من Meta** (من غير Authorization، بهيدر `X-Hub-Signature-256`): HMAC-SHA256 على البايتات نفسها بـ `META_APP_SECRET` ومقارنة ثابتة
      الزمن؛ توقيع غلط = 401 وصف `cs_channel_events` error. بعد التحقق الرد 200 دايمًا (Meta بتعيد الإرسال على غير 200) إلا لو الداتا بيز وقعت = 500.
      التكرار محمي بالـ unique على `cs_messages.external_id` (mid / comment id).
    - **الاستقبال → بياناتنا:** `object: page` → `entry[].messaging[]`: `message` (مش echo) → contact ماسنجر بالـ PSID → العميل (موجود في
      `cs_contacts` وإلا عميل جديد `channel` باسم البروفايل `GET /{psid}?fields=first_name,last_name` بتوكن الصفحة — best effort) → المحادثة
      (`seg customers`, `platform messenger`, `channel messenger`, `external_id` = PSID؛ المقفولة/المستنية العميل/المؤجلة بترجع «مستنية ردنا»
      بقاعدة `nextStatus(…, 'in')`) → رسالة `in` (`external_id` = mid؛ النص أو «[صورة]» / «[ملف]» / «[ستيكر]» + `meta.attachments` نوع ورابط)؛
      `message.is_echo` = رد من Meta Inbox (مش بتاعنا — mid مش عندنا) → `out` بـ `author null`, `delivery sent`, `meta.echo = true`؛
      `delivery.watermark` → `out` قبلها `sent` → `delivered`؛ `read.watermark` → `read`. `object: instagram` نفس الشكل بالـ IGSID (`channel
      instagram`؛ الاسم `GET /{igsid}?fields=name,username`). **التعليقات:** `changes[] field feed` (`item comment`, `verb add`) على فيسبوك و`field
      comments` على إنستجرام → محادثة `seg comments` لكل (بوست/ميديا × معلّق): `external_id` = `<post>:<from.id>`, `handle` اسم المعلّق أو
      `@username`, `platform facebook` بقناة `messenger` / `platform instagram` بقناة `instagram`؛ الرسالة `in` بـ `external_id` = comment id
      و`meta { post_id, comment_id, parent_id }`؛ تعليق من الصفحة نفسها = `out` echo. أي حاجة تانية (postbacks, reactions, …) = ignored.
    - **أفعال العضو (JWT):** `status` (`cs.view ≠ N`: القنوات + للأدمن `configured`/`redirect`/`webhook_url`) · `connect_start { channel }`
      (الأدمن: state + رابط `facebook.com/v21.0/dialog/oauth` بالصلاحيات `pages_show_list, pages_messaging, pages_manage_metadata,
      pages_read_engagement, pages_read_user_content, pages_manage_engagement, instagram_basic, instagram_manage_messages, instagram_manage_comments`، الرجوع على
      `app/meta-callback.html`) · `connect_callback { code, state }` (الأدمن: الكود → توكن مستخدم قصير → طويل (`fb_exchange_token`) →
      `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`؛ صفحة واحدة = بتتربط فورًا، أكتر = المرشّحين في Vault
      والرد `choose` بقايمة من غير توكنات ← `connect_pick { page_id }`؛ الربط = `POST /{page}/subscribed_apps` بـ `subscribed_fields =
      messages, messaging_postbacks, message_deliveries, message_reads, message_echoes, feed` + الصفحة في Vault + `cs_channels` ماسنجر
      `connected` (وإنستجرام `connected` لو فيه حساب مربوط بالصفحة، وإلا بتفضل `disconnected` والرد بيقول) + `activity_log` `cs.channel.connect`) ·
      `disconnect` (الأدمن: `DELETE /{page}/subscribed_apps` best effort، مسح السر، القناتين `disconnected`) · `send { message_id }` (`cs.reply`:
      صف `out` `queued` بتاع المحادثة — DM: `POST /me/messages { recipient: { id }, messaging_type: RESPONSE, message: { text } }` بتوكن الصفحة؛
      محادثة تعليقات: رد عام على آخر تعليق وارد `POST /{comment}/comments` (فيسبوك) / `POST /{comment}/replies` (إنستجرام)؛ النجاح →
      `delivery sent` + `external_id` من Meta؛ الفشل → `delivery failed` + `meta.error` كود بس) · `comment_private { message_id }` (`cs.reply`:
      رد خاص على آخر تعليق وارد `POST /{page}/messages { recipient: { comment_id } }` — بيفتح DM والرد بيوصلنا echo) · `comment_hide
      { conversation_id }` (`cs.reply`: إخفاء آخر تعليق وارد `is_hidden` / `hide` + رسالة `event`). كل الكتابة على Meta مشروطة بالربط
      (503 `not_linked`) — ومن غير `WOO_PUSH_ENABLED` (مش موقع WooCommerce). الـ logs: `cs_channel_events` أعداد، `activity_log` `cs.channel.*`
      ids وأسماء قنوات بس — مافيش نص ولا توكن.
13. **الـ adapter والصفحة:** `IBCS.send` بيحط الصف `queued` زي ما هو ثم لو القناة `meta` ومتصلة بينادي `cs-channel send` وبيحدّث `delivery`
    محليًا (فشل = `failed` والرسالة بتقول)؛ `IBCS.channelStatus()` / `connectStart(id)` / `connectPick(pageId)` / `disconnect()` /
    `commentPrivate(convId, text)` / `commentHide(convId)`. الكتلة 20: زرار «ربط» لماسنجر/إنستجرام بيفتح رابط Meta في نفس التبويب (الأدمن)،
    «فصل» للمتصلة، الكومبوزر شغال على المحادثة اللي قناتها متصلة (`connected(c)` زي ما هو)، وفي محادثة التعليقات زرارين «رد خاص» و«إخفاء
    التعليق». صفحة الرجوع `app/meta-callback.html` + `app/js/pages/meta-callback.js` (نفس نمط Magnific: الأدمن المسجّل بينادي
    `connect_callback`، ولو `choose` بيعرض الصفحات للاختيار). الـ CSP زي ما هو (الدالة على supabase).
14. **الاختبارات:** `rls_cs_meta.sql` (الأعضاء مايقدروش يقروا `cs_oauth_states` / `cs_channel_events` ولا ينادوا `cs_secret_*`)، node لـ
    `_shared/cs-channel.js` (تطبيع الـ payloads، ملخص المرفقات، روابط Graph)، Deno لـ `cs-channel` (التحقق، التوقيع، الاستقبال بأنواعه، التكرار،
    الربط بصفحة/صفحتين، الإرسال ونتايجه)، adapter (send بينادي الدالة)، e2e (ربط من المحاكي، الإرسال على قناة متصلة، التعليقات).
15. **النشر:** `cs-channel` في `deploy-functions.yml` و`config.toml` و`deno:check`؛ `tools/deploy.md` §2.7.16 خطوات التطبيق على Meta (المنتجات
    Messenger + Instagram + Webhooks، رابط الـ callback `https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-channel`، الـ verify token،
    حقول الاشتراك، الـ redirect URI، الأسرار، Tester، وApp Review في الآخر).
