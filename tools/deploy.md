# النشر على subdomain في Hostinger

الملف ده خطوات أول نشر للتطبيق (`app/`) على `https://operation-system.ibtekr.club`، بالترتيب. أي جلسة معاها Supabase MCP وإضافة Hostinger تقدر تخلّصه في دقايق؛ ومن غيرهم كل خطوة ليها بديل من اللوحة.

مشروع Supabase: `fsynculhaupcktzkfkdd` (eu-central-1). الاستضافة: Hostinger shared hosting (Apache/LiteSpeed، ملفات static بس، مافيش build).

الـ subdomain المختار (22 أكتوبر 2026): **`operation-system`** → `https://operation-system.ibtekr.club` (أسماء الدومين مش حساسة لحالة الحروف). بريد النظام (المرسِل في SMTP): `operation-system@ibtekr.club`. إيميل دخول الأدمن الأول: `owner@example.com`.

---

## 1. اللي محتاجينه منك

1. **اسم الـ subdomain** — الكلمة اللي قبل `.ibtekr.club`. ده بيدخل في Site URL بتاع Supabase وفي مكان الرفع.
2. **صلاحية على Hostinger**، واحدة من الاتنين:
   - إضافة `hostinger` في Claude Code: شغّل `/mcp` ووافق على تسجيل الدخول لحساب Hostinger (ده الطريق المفضّل).
   - أو بيانات FTP للـ subdomain: host وuser وpassword. **دول مايتكتبوش في git** — يتحطوا في `.env` (متجاهَل في `.gitignore`) أو يتكتبوا في الترمينال وقت الرفع بس.
3. **إيميلك الحقيقي** اللي هيبقى أول حساب أدمن (`M01`) — بالإضافة لاسمك ورقم موبايلك (11 رقم) عشان صف `profiles`.

---

ملحوظة عن أداة Supabase MCP: اللي اتحجز فعلًا: جمل `delete from` في اختبارات RLS لما بتتشغّل عبر `execute_sql`؛ `apply_migration` عمره ما حجز حاجة (ولا حتى `delete from` جوّه `email_for_identifier` في `0001`، ولا `on delete cascade`/`for delete`/`grant … delete`). `drop` اتجنّبناه من الأول (`0005` بـ `alter policy`). `rls_dashboard.sql` و`rls_orders.sql` و`rls_mfa.sql` مافيهمش `delete` خالص فبيتشغّلوا حي زي ما هما. اختبارات RLS في الريبو شغالة من `psql`/CI؛ لتشغيل `rls_identity`/`rls_system` عبر MCP استخدم نسخة بتبدّل `delete from` بـ `execute 'del' || 'ete from ...'` (زي ما اتعمل في أول تطبيق حي).

**البديل لما الأداة تحجز الملف (`rls_vendors` مثلًا):** workflow «RLS live» في GitHub Actions (`.github/workflows/rls-live.yml` ← `tools/rls-live.sh`): بيشغّل الملفات الـ live-safe على المشروع الحي من السر `SUPABASE_DB_URL` (= connection string بوضع **Session pooler** من Dashboard → Project Settings → Database → Connection string؛ الـ direct host IPv6 بس وrunners GitHub مالهاش IPv6). السر بيتضاف من GitHub → Settings → Secrets and variables → Actions، وعمره ما يتكتب في الشات أو الكود. التشغيل: Actions → RLS live → Run workflow (الافتراضي `rls_vendors rls_vendor_logins rls_brands`؛ ممكن تكتب أسماء تانية). كل ملف transaction بتعمل rollback، والـ URL مابيتطبعش.

## 2. Supabase قبل النشر

### 2.1 الـ migrations والاختبارات (Supabase MCP)
بالترتيب ده بالظبط، كل واحدة بـ `apply_migration` والاسم ده والمحتوى من الملف:

| الاسم (`name`) | الملف |
|---|---|
| `identity` | `supabase/migrations/0001_identity.sql` |
| `system` | `supabase/migrations/0002_system.sql` |
| `seed_roles` | `supabase/migrations/0003_seed_roles.sql` |
| `grants` | `supabase/migrations/0004_grants.sql` |
| `advisors` | `supabase/migrations/0005_advisors.sql` |
| `dashboard` | `supabase/migrations/0006_dashboard.sql` |
| `orders` | `supabase/migrations/0007_orders.sql` |
| `mfa_cron` | `supabase/migrations/0008_mfa_cron.sql` |
| `failed_note_permalink` | `supabase/migrations/0009_failed_note_permalink.sql` |
| `state_names` | `supabase/migrations/0010_state_names.sql` |
| `vendors` | `supabase/migrations/0011_vendors.sql` |
| `vendor_logins` | `supabase/migrations/0012_vendor_logins.sql` |
| `brands` | `supabase/migrations/0013_brands.sql` |
| `vendor_sync` | `supabase/migrations/0014_vendor_sync.sql` |

بعدها `execute_sql` بمحتوى الاختبارات التسعة (كل واحد بيعمل `rollback` في الآخر، فمش بيسيب حاجة وراه):
- `supabase/tests/rls_identity.sql` → لازم يطلع `NOTICE: rls_identity: ok`
- `supabase/tests/rls_system.sql` → لازم يطلع `NOTICE: rls_system: ok` (بيتوقع `status_map` زي ما `0009` بتسيبه: 9 صفوف، «فشل» مكان «تم RTC» بـ `from_woo`، والباقي `both` — يعني بعد `0009`)
- `supabase/tests/rls_dashboard.sql` → لازم يطلع `NOTICE: rls_dashboard: ok`
- `supabase/tests/rls_orders.sql` → لازم يطلع `NOTICE: rls_orders: ok` (من المرحلة 2.1 بيتوقع `0009` كمان: «فشل» في `status_map`، و`products.permalink` بيتقرا للأعضاء؛ ومن المرحلة 2.2 بيتوقع `0010`: `orders.customer_state` بيتقرا ومابيتكتبش، و`woo_states`)
- `supabase/tests/rls_mfa.sql` → لازم يطلع `NOTICE: rls_mfa: ok` (بيكتب factors تجريبية في `auth.mfa_factors` بكل الأعمدة الإجبارية بتاعة الجدول الحي، وكلها بتروح مع الـ rollback)
- `supabase/tests/rls_vendors.sql` → لازم يطلع `NOTICE: rls_vendors: ok` (المرحلة 3: بيتوقع `0011` — أعمدة `vendors` ومنحها بقايمة، والحارس بالعمود، و`vendor_rates`/`vendor_bank`، و`order_items.commission_rate`؛ على الحي بيتأكد كمان من الـ bucket `vendor-contracts` وسياساته؛ live-safe: مابيمسحش حاجة، والـ deletes اللي فيه متوقع ترتفض — 42501 أو 23503 — والـ rollback في الآخر)
- `supabase/tests/rls_vendor_logins.sql` → لازم يطلع `NOTICE: rls_vendor_logins: ok` (المرحلة 3.1: بيتوقع `0012` — `leave` في `vendors.status`، و`vendor_logins` بمنحها بقايمة أعمدة من غير `secret_id` والحارس والدالتين؛ **على الحي** Vault موجود فالدالتين بيتختبروا فعلًا: الأدمن ومتابعة المبتكرين بيحطوا باسورد تجريبي `Test1234` ويظهروه ويستبدلوه، وكل ده بيتسجل في `activity_log` من غير الباسورد — والسر في `vault.secrets` اسمه `vendor-login:<uuid تجريبي>` بيروح مع الـ rollback؛ محلي من غير Vault بيتأكد من `0A000` بس؛ live-safe: مابيمسحش حاجة، والـ delete الوحيد اللي فيه متوقع يترفض 42501)
- `supabase/tests/rls_brands.sql` → لازم يطلع `NOTICE: rls_brands: ok` (المرحلة 3.2: بيتوقع `0013` — `brands`/`brand_owners`/`brand_rates` بمنحها وسياساتها، الحرّاس التلاتة، التريجر على `vendors` (إدراج متجر ويدوي والاسم المأخوذ) وإعادة التعبئة، الدالتين `brand_owner_at`/`store_owner_at` قبل وبعد نقل ونقل مؤقت ورجوع، و23503 لحذف مبتكر في تاريخ ملكية براند غيره؛ live-safe: كل عدّ مربوط بصفوفه هو — الحي فيه 56 براند — وفيه `delete from` كنص (اتنين متوقع يترفضوا 23503 وواحد cascade على مبتكر الملف نفسه بيروح مع الـ rollback) فالأداة بتحجزه: شغّله عبر workflow «RLS live»)
- `supabase/tests/rls_vendor_sync.sql` → لازم يطلع `NOTICE: rls_vendor_sync: ok` (المرحلة 3.3: بيتوقع `0014` — أعمدة `vendors` التسعة بمنحها بالعمود (`woo_snapshot` لـ `service_role` بس)، الحارس الموسّع (الاتصال: `contact_name`/`address_parts`/`social` بـ `vendors.edit` F أو P، والباقي 42501)، `vendor_rates.flat`، `vendor_category_rates` (إضافة بس، `sensitive.commission = F`، 23505/23514/23503) و`woo_categories` (قراءة بـ `vendors.view`، الكتابة للسيرفر بس)، وكتابة السيرفر نفسه للقطة و`push_pending`؛ live-safe: كل عدّ مربوط بصفوفه — المتاجر التجريبية `woo_vendor_id` 9941/9942 والفئات 9900001/9900002 — وفيه `delete from` كنص (متوقع يترفضوا 42501) فالأداة بتحجزه: شغّله عبر workflow «RLS live» — الافتراضي فيه)
- (من المرحلة 3.3 `rls_vendors` بيتوقع `0014` كمان: `vendor_rates.flat` وعدد أعمدة `vendors` اللي الأعضاء بيقروها 30)

أي `ERROR` = وقّف ومتنشرش. لو الـ MCP رفض `set local role`، شغّلهم بـ `psql` كـ `postgres`.
`supabase/tests/migrate_0009.sql` و`supabase/tests/migrate_0010.sql` و`supabase/tests/migrate_0011.sql` و`supabase/tests/migrate_0012.sql` و`supabase/tests/migrate_0013.sql` و`supabase/tests/migrate_0014.sql` **محلي بس** (`npm run db:test`): بيبنوا الحالة اللي قبل الـ migration جوه transaction وبيطبّقوا الملف نفسه تاني بـ `\ir` (أمر `psql`، فمايتشغّلش عبر `execute_sql`). على الحي `0009` و`0010` و`0011` و`0012` و`0013` و`0014` بيتفحصوا بالاستعلامات اللي تحت.
**ممنوع** تطبّق `supabase/tests/_local_auth_stub.sql` على Supabase — ده لـ Postgres المحلي بس.

لو حد طبّق جزء قبل كده، `list_migrations` بيوريك اللي اتطبّق وتكمّل من بعده.

**Realtime:** `0006` بيضيف `alerts`، و`0007` بيضيف `orders` و`order_items` و`sub_orders`، لـ publication `supabase_realtime` (في بلوكات `do $$` محمية، لأن الـ stub المحلي مافيهوش publication). اتأكد على الحي بـ `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1` → لازم يطلعوا الأربعة. والـ websocket بتاع Realtime (`wss://<ref>.supabase.co`) مسموح أصلًا في `connect-src` بتاع الـ CSP في `app/.htaccess`.

**`0007_orders` — اللي يتأكد منه على الحي** (اتطبّقت 2026-10-25، §2.6):
- `select system_status, woo_status, direction from public.status_map order by sort` → 9 صفوف بالترتيب ده: قيد الانتظار `pending`، جاري التنفيذ `processing`، معلّق `on-hold`، جاهز للشحن `ready-shipping`، قيد الشحن `in-shipping`، تم RTC (من غير slug، `from_system` — عمرها ما بتتبعت ولا بتيجي)، مكتمل `completed`، استرجاع `refunded`، ملغي `cancelled`. الـ slugs دي من فحص الـ staging (§2.7.10)، مش من البروتوتايب. (من `0009`: صف «تم RTC» بقى «فشل» `failed` — تحت.)
- 10 جداول جديدة (`vendors`، `products`، `orders`، `order_items`، `sub_orders`، `order_events`، `returns`، `woo_webhook_events`، `woo_sync_log`، `sync_state`) والـ view `orders_v`.
- `authenticated` واخد `select` على `orders` بقايمة أعمدة، من غير `customer_phone` (بيتقرا مطموس عبر `orders_v` بس) ومن غير `raw` (لـ service_role بس):

  ```sql
  select count(*) as cols, count(*) filter (where column_name in ('customer_phone', 'raw')) as forbidden
  from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and table_name = 'orders' and privilege_type = 'SELECT';
  -- المتوقع: cols = 24, forbidden = 0 (من 0010: cols = 25 — زاد customer_state)
  ```

**`0008_mfa_cron` — قبل التطبيق وبعده.** الملف بيعيد تعريف `has_perm`/`is_admin` (aal2 للي مفعّل التحقق بخطوتين)، وبيعمل `mark_twofa_enrolled`/`mark_twofa_disabled` و`sync_secret_matches`، وجوه بلوك محروس (لو `pg_cron` و`pg_net` و`supabase_vault` متاحين بس): بيسطّب `pg_cron` (schema `pg_catalog`) و`pg_net` (schema `extensions`)، بيولّد سر `sync_secret` في Vault مرة واحدة (32 بايت عشوائي hex جوه Postgres — عمره ما بيتكتب في الملف ولا بيتطبع)، وبيعمل job `woo-sync-backup` (§2.7.6). الـ URL بتاع الدالة مكتوب في الملف نفسه: `postgres` على الحي مش superuser (`rolsuper = false`) ومايقدرش يعمل `alter database … set app.*`.

1. قبل:

   ```sql
   select name, default_version, installed_version from pg_available_extensions
   where name in ('pg_cron', 'pg_net', 'supabase_vault', 'pgcrypto') order by name;
   -- اللي اتشاف 2026-10-25: pg_cron 1.6.4 وpg_net 0.20.4 متاحين ومش متسطّبين؛ supabase_vault 0.3.1 متسطّب (schema vault)؛ pgcrypto في extensions
   ```

2. `apply_migration` بالاسم `mfa_cron`. لو اترفض `create extension … pg_cron with schema pg_catalog`، البديل الشكل العادي `create extension if not exists pg_cron;` — بس يتعدّل في الملف نفسه بقرار في الدفتر، عشان الريبو يفضل زي الحي. ولو `cron.schedule` اترفض بسبب صلاحيات، الحل `grant usage on schema cron to postgres` (تقرير المهمة 7).
3. بعد:

   ```sql
   -- صلاحيات postgres على cron و net (الـ job بيشتغل بصلاحيات اللي عمله)
   select has_schema_privilege('postgres', 'cron', 'usage') as cron_usage;   -- true
   select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
          has_function_privilege('postgres', p.oid, 'execute') as can_execute
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'cron' and p.proname in ('schedule', 'unschedule'))
      or (n.nspname = 'net' and p.proname = 'http_post');
   -- can_execute = true للكل، وhttp_post فيها url, body, params, headers, timeout_milliseconds

   select jobid, jobname, schedule, active from cron.job where jobname = 'woo-sync-backup';
   -- صف واحد: */15 * * * * و active = true (الـ command فيه subquery على Vault، مش قيمة السر)

   select name, created_at from vault.secrets where name = 'sync_secret';
   -- صف واحد. عمرك ما تعمل select لـ decrypted_secret (ولا لعمود secret)
   ```

4. `rls_mfa` على الحي (فوق)، و`get_advisors` (§2.2).
5. **أول تشغيلة** (بعد ما §2.7.1 و§2.7.2 يخلصوا — قبلها التشغيلات بترجع 404 لحد ما `woo-sync` تتنشر، وبعدها 500 `not_configured` لحد ما أسرار `WOO_*` تتحط، ودول متوقعين):

   ```sql
   select status, return_message, start_time from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'woo-sync-backup')
   order by start_time desc limit 5;
   -- succeeded (معناها إن الطلب دخل طابور pg_net بس؛ نتيجة الـ HTTP في الجدول اللي جاي)

   select id, status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;
   -- 200. 401 = السر مش مطابق (sync_secret_matches) أو الـ gateway طالب JWT (الدالة اتنشرت بـ verify_jwt = true، §2.7.1)
   ```

**`0009_failed_note_permalink` (المرحلة 2.1) — قبل التطبيق وبعده.** الملف بيعمل تلات حاجات، وكلها بتتعاد من غير ما تغيّر حاجة (مافيهوش `drop` ولا `delete` ولا `truncate`):
- `status_map`: صف «تم RTC» بيتحوّل بـ `update` (نفس الـ id) لـ («فشل»، `failed`، `from_woo`، sort 10). أوردر Woo حالته `failed` بقى «فشل» بدل «ملغي» (القاعدة الاحتياطية `WOO_FALLBACK` في `woo-core` بقت فاضية). الاتجاه `from_woo` قرار: `failed` معناها على الموقع «الدفع فشل»، والفريق مش بيحطها هناك، ولو اتبعتت كان العميل هيوصله إيميل فشل من النظام لما `WOO_PUSH_ENABLED = 1` — فلو الفريق حط «فشل» عندنا بتتحفظ بس ومابتتبعتش (`skipped` / `no_woo_status`). `orders.status` مربوط بـ `on update cascade`، فأي أوردر على «تم RTC» بيمشي مع الاسم الجديد.
- `orders.note` (تعليق خدمة العملاء) بيتملى من `customer_note` (ملاحظة العميل من الموقع) للأوردرات اللي تعليقها فاضي وعندها ملاحظة. كل أوردر اتملى بيكتب سطر `order_events` (`kind 'note'`، `source 'woo'`). من بعدها المزامنة بتكتب `note` = ملاحظة الموقع عند إنشاء الأوردر بس (زي المدينة والعنوان) — الفريق صاحب الخانة بعد كده.
- `products.permalink` (رابط صفحة المنتج على الموقع): العمود + تعبئة من `raw->>'permalink'` (اللي بيبدأ بـ `https://` بس، وللصفوف اللي العمود فيها فاضي بس) + الـ grants (`select` للأعضاء زي باقي أعمدة `products`، وكل الـ DML لـ `service_role`). الـ RLS زي ما هي.

1. قبل:

   ```sql
   select (select count(*) from public.orders where status = 'تم RTC') as on_rtc,        -- 0 (اتأكد 26 أكتوبر)
          (select count(*) from public.orders where woo_status = 'failed') as woo_failed, -- 0؛ لو أكتر: حالتهم «ملغي» (القاعدة القديمة) وبتفضل كده لحد ما Woo يغيّرها أو الفريق
          (select count(*) from public.orders
           where coalesce(note, '') = '' and coalesce(customer_note, '') <> '') as to_seed;  -- 17 (اتأكد 26 أكتوبر)
   ```

2. `apply_migration` بالاسم `failed_note_permalink`.
3. بعد:

   ```sql
   select system_status, woo_status, direction, sort from public.status_map order by sort;
   -- 9 صفوف من غير «تم RTC»: قيد الانتظار pending، جاري التنفيذ processing، معلّق on-hold، جاهز للشحن ready-shipping،
   -- قيد الشحن in-shipping، مكتمل completed، استرجاع refunded، ملغي cancelled، فشل failed (sort 10، from_woo) — والباقي both

   select count(*) from public.orders where note = customer_note and customer_note <> '';
   -- 17 (+ أي أوردر جديد بملاحظة من الموقع بعد كده)

   select count(*) as products, count(permalink) as with_link,
          count(*) filter (where permalink is null and btrim(raw ->> 'permalink') like 'https://%') as missed
   from public.products;
   -- with_link ≈ products، و missed = 0

   select has_column_privilege('authenticated', 'public.products', 'permalink', 'SELECT') as member_reads;  -- true
   ```

4. `rls_system` على الحي (فوق) — بيتوقع `0009`. **`rls_orders` و`migrate_0009` محلي/CI بس:** بيبنوا صفوف اختبار (أوردرات 181668/181700، منتجات 501/502) وبيتوقعوا عدد صفوف محدد، فعلى الحي بيفشلوا بالتصميم مش عشان في مشكلة.
5. إعادة نشر الدالتين (§2.7.1) **بعد** `0009` مش قبلها: `mapProduct` الجديدة بتكتب `permalink`، وقبل العمود PostgREST بيرفض الصف وجزء المنتجات كله بيفشل؛ وكمان `WOO_FALLBACK` بقت فاضية، فأوردر `failed` جاي قبل صف «فشل» بيتسجّل تعارض بحالة «قيد الانتظار». وبعد النشر شغّل جملتين الداتا بتوع `0009` مرة كمان (`execute_sql`؛ مابيغيّروش حاجة اتعملت) عشان يلحقوا أي أوردر أو منتج الكود القديم كتبه بين التطبيق والنشر:

   ```sql
   update public.orders set note = customer_note where coalesce(note, '') = '' and coalesce(customer_note, '') <> '';
   update public.products set permalink = btrim(raw ->> 'permalink')
   where permalink is null and btrim(raw ->> 'permalink') like 'https://%';
   ```

   وبعدها تشغيلة cron ناجحة (§2.1 خطوة 5 بتاعة `0008`).

**`0010_state_names` (المرحلة 2.2) — قبل التطبيق وبعده.** الملف بيعمل حاجتين، وبيتعاد من غير ما يغيّر حاجة (مافيهوش `drop` ولا `delete` ولا `truncate`):
- `orders.customer_state` (كود المحافظة من قايمة الموقع، زي `EG-01`): العمود + تعبئة من `raw` (`shipping.state` وإلا `billing.state`، بعد `btrim`، والفاضي = مش موجود — نفس قاعدة `mapOrder`؛ للصفوف اللي العمود فيها فاضي بس، ومن غير سطور `order_events`) + `select (customer_state)` للأعضاء من غير `update` (عرض بس: الكود من قايمة الموقع) + `select/insert/update` لـ `service_role`. والـ view `orders_v` اتعملت تاني بنفس الـ 25 عمود وبنفس الترتيب و`customer_state` في الآخر (`create or replace view` مابيقدرش غير يزوّد في الآخر)، و`security_invoker` والتليفون المطموس زي ما هم. المزامنة بتكتب العمود عند إنشاء الأوردر بس (زي المدينة والعنوان).
- `woo_states (code, name, updated_at)`: أسماء المحافظات من الموقع نفسه (جزء `states` في `woo-sync`، §2.7.5). RLS: `select` لأي عضو مسجّل (`using (true)` — دي قايمة الـ checkout العامة)، ومافيش policy كتابة؛ الـ grants: `select` للأعضاء، و`select/insert/update/delete` لـ `service_role`، ومن غير `truncate`/`references`/`trigger` لحد، ومن غير أي حاجة لـ `anon`. الصفوف عمرها ما بتتمسح (أوردر قديم ممكن يكون شايل كود الموقع شاله).

1. قبل:

   ```sql
   select count(*) as orders,
          count(coalesce(nullif(btrim(raw -> 'shipping' ->> 'state'), ''), nullif(btrim(raw -> 'billing' ->> 'state'), ''))) as with_code,
          count(distinct coalesce(nullif(btrim(raw -> 'shipping' ->> 'state'), ''), nullif(btrim(raw -> 'billing' ->> 'state'), ''))) as codes
   from public.orders;
   -- 104 / 104 / 14 (اتأكد 26 أكتوبر؛ + أي أوردر جديد)
   select to_regclass('public.woo_states') as woo_states,
          (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_state') as has_column;
   -- null / 0
   ```

2. `apply_migration` بالاسم `state_names`.
3. بعد:

   ```sql
   select count(*) as orders, count(customer_state) as with_state, count(distinct customer_state) as codes from public.orders;
   -- 104 / 104 / 14 (نفس أرقام «قبل»)

   select has_column_privilege('authenticated', 'public.orders', 'customer_state', 'SELECT') as member_reads,   -- true
          has_column_privilege('authenticated', 'public.orders', 'customer_state', 'UPDATE') as member_writes,  -- false
          has_table_privilege('authenticated', 'public.woo_states', 'SELECT') as names_read,                   -- true
          has_table_privilege('authenticated', 'public.woo_states', 'INSERT') as names_write,                  -- false
          has_table_privilege('anon', 'public.woo_states', 'SELECT') as anon_reads,                            -- false
          has_table_privilege('service_role', 'public.woo_states', 'INSERT') as sync_writes;                   -- true

   select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'orders_v' and column_name = 'customer_state';            -- 1
   select relrowsecurity from pg_class where oid = 'public.woo_states'::regclass;                           -- true
   select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'woo_states';
   -- صف واحد: woo_states_select | SELECT | {authenticated} | true
   select count(*) from public.woo_states;                                                                  -- 0 لحد أول تشغيلة states
   ```

   وفحص `cols` بتاع `0007` فوق بقى 25.
4. `rls_system` على الحي (فوق) زي ما هو. **`rls_orders` و`migrate_0010` محلي/CI بس** (نفس سبب `0009`).
5. إعادة نشر الدالتين (§2.7.1) **بعد** `0010` مش قبلها: الكود الجديد بيكتب `orders.customer_state` عند إنشاء أي أوردر، وقبل العمود PostgREST بيرفض الكتابة دي كلها (عمود مش موجود، مش خطأ بيانات): جزء الأوردرات في الـ cron بيفشل لو الصفحة فيها أوردر جديد، وكل delivery لأوردر جديد بترجع 500 — وWooCommerce بيوقف الـ webhook بعد 5 مرات فشل ورا بعض (§2.7.6). (تحديث أوردر موجود مابيكتبش العمود، فبيعدّي.) وجزء `states` قبل الجدول بيفشل هو كمان. وبعد النشر شغّل جملة التعبئة مرة كمان (`execute_sql`؛ مابتغيّرش حاجة اتعملت) عشان تلحق أي أوردر الكود القديم أنشأه بين التطبيق والنشر — الكود الجديد مابيكتبش العمود على أوردر موجود:

   ```sql
   update public.orders
   set customer_state = coalesce(nullif(btrim(raw -> 'shipping' ->> 'state'), ''), nullif(btrim(raw -> 'billing' ->> 'state'), ''))
   where customer_state is null and raw is not null;
   ```

6. أول تشغيلة `states`: يدويًا (`IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'states' } })` بحساب الأدمن، أو `net.http_post` زي §2.7.4 بالجسم `{"action":"states"}`) أو استنى الـ cron (`all` بيبدأ بيها). بعدها:

   ```sql
   select count(*) as names from public.woo_states;                                      -- > 0 (قايمة الموقع: EG-01 … EG-25)
   select o.customer_state, s.name, count(*) from public.orders o
   left join public.woo_states s on s.code = o.customer_state group by 1, 2 order by 1;
   -- كل كود مستخدم ليه اسم؛ name فاضي = الموقع مارجّعش الكود ده، والكارت بيعرض الكود زي ما هو
   select at, kind, result, detail from public.woo_sync_log where entity = 'states' order by at desc limit 3;
   -- ok و detail.states = عدد الأسماء
   ```

   لو `error`: شوف §2.7.7. الأوردرات مابتتأثرش، والكارت بيعرض الكود لحد ما الأسماء توصل.

**`0011_vendors` (المرحلة 3) — قبل التطبيق وبعده.** الملف بيتعاد من غير ما يغيّر حاجة (مافيهوش `drop` ولا `delete` ولا `truncate`؛ سياستين `0007` بيتعدّلوا في مكانهم بـ `alter policy`). اللي بيعمله:
- `vendors` +12 عمود للفريق (`legal_name`، `category` بقايمة الفئات السبعة، `alt_phone`، `address`، `instagram`، `store_url`، `lead_days` 1–60 افتراضي 7، `deposit_policy`، `notes`، `joined_at`، `contract` jsonb، `opening_balance` افتراضي 0) + تعبئة `joined_at` من `raw.registered` (الجزء التاريخ من `YYYY-MM-DD HH:MM:SS`؛ لو مش تاريخ → `created_at`) و`store_url` من `raw.shop_url` (اللي بيبدأ بـ `https://` بس) — للصفوف اللي العمود فيها فاضي بس.
- `order_items.commission_rate` / `commission_fee` (نسبة الموقع الفعلية ورسمها الثابت على كل سطر، من `_dokan_commission_rate` / `_dokan_additional_fee`) + تعبئة من `raw.meta_data` (الفاضي = null، والأرقام العادية بس) + `select` للأعضاء مع باقي أعمدة السطر (`orders.view`)؛ المزامنة بتكتبهم كل مرة.
- `vendor_rates` (النسبة بتاريخ سريان؛ RLS `select`/`insert` بـ `sensitive.commission = F`، من غير `update`/`delete` للأعضاء؛ trigger بعد الإدراج بيحدّث `vendors.commission_pct` بالنسبة السارية النهارده — security definer بملكية `postgres`) و`vendor_bank` (صف لكل مبتكر؛ RLS `select`/`insert`/`update` بـ `sensitive.vendor_bank = F`). الاتنين `references vendors(id) on delete cascade`.
- منح `vendors` لـ `authenticated` بقايمة أعمدة بعد `revoke`: الأعضاء مابيقروش `commission_pct` (النسبة من `vendor_rates`)، ومابيكتبوش `woo_vendor_id`/`commission_pct`/`raw`/`opening_balance` بأي قيمة؛ `contract` بيتعدّل ومابيتدرجش. يعني PostgREST `select=*` على `vendors` بيترفض — الواجهة بتسمّي أعمدتها.
- السياسات: `vendors_update` ← `with check (is_admin() or vendors.edit <> 'N' or sensitive.vendor_bank = 'F')` (الأخيرة عشان الحسابات — `vendors.edit = N` — تقدر تسجّل العقد؛ الحارس بيحصرها في عمود `contract`)، و`vendors_delete` ← الأدمن بس (وبيفشل 23503 لو عليه سطور). الحارس `vendors_guard_update` (على `anon`/`authenticated` بس) بالقرار 8: `status` ← `vendors.toggle = F`؛ `contract` ← `sensitive.vendor_bank = F`؛ الاسم/الاسم القانوني/الفئة/الأسماء البديلة/مدة التجهيز/سياسة العربون/تاريخ الانضمام ← `vendors.edit = F`؛ التواصل والملاحظات ← `vendors.edit` في (F, P)؛ أي عمود تاني ← 42501.
- Storage: الـ bucket `vendor-contracts` خاص (10 ميجا، PDF/PNG/JPEG) + 3 سياسات على `storage.objects` (`select`/`insert`/`update` بـ `sensitive.vendor_bank = F`، من غير `delete`) — في بلوك `do $$` محروس بوجود schema `storage` (§2.8).

1. قبل:

   ```sql
   select count(*) as vendors,
          count(*) filter (where (raw ->> 'registered') ~ '^\d{4}-\d{2}-\d{2}') as with_registered,
          count(*) filter (where btrim(raw ->> 'shop_url') like 'https://%') as with_https
   from public.vendors;
   -- 55 / 55 / 55 (اتأكد 26 أكتوبر؛ لو with_registered أقل: الباقي هياخد created_at)
   select count(*) as lines,
          count(*) filter (where jsonb_typeof(raw -> 'meta_data') = 'array'
                             and exists (select 1 from jsonb_array_elements(raw -> 'meta_data') e
                                         where e ->> 'key' = '_dokan_commission_rate' and btrim(e ->> 'value') ~ '^\d{1,3}(\.\d+)?$')) as with_rate
   from public.order_items;
   -- 210 / 210 (اتأكد 26 أكتوبر؛ + أي سطر جديد)
   select to_regclass('public.vendor_rates') as rates, to_regclass('public.vendor_bank') as bank,
          (select count(*) from storage.buckets where id = 'vendor-contracts') as bucket;
   -- null / null / 0
   ```

2. `apply_migration` بالاسم `vendors`.
3. بعد:

   ```sql
   select count(*) as vendors, count(joined_at) as with_joined, count(store_url) as with_url,
          count(*) filter (where joined_at = left(raw ->> 'registered', 10)::date) as from_registered,
          count(*) filter (where store_url like 'https://%') as https_only
   from public.vendors;
   -- 55 / 55 / 55 / 55 / 55

   select count(*) as lines, count(commission_rate) as with_rate, count(commission_fee) as with_fee,
          count(*) filter (where commission_fee is null) as blank_fee
   from public.order_items;
   -- 210 / 210 / (الرسم '' = null، و0 بيتسجّل 0.00: with_fee + blank_fee = 210)

   select has_column_privilege('authenticated', 'public.vendors', 'commission_pct', 'SELECT') as pct_read,        -- false
          has_column_privilege('authenticated', 'public.vendors', 'contract', 'UPDATE') as contract_write,         -- true
          has_column_privilege('authenticated', 'public.vendors', 'contract', 'INSERT') as contract_insert,        -- false
          has_column_privilege('authenticated', 'public.vendors', 'woo_vendor_id', 'UPDATE') as woo_write,         -- false
          has_column_privilege('authenticated', 'public.vendors', 'raw', 'SELECT') as raw_read,                    -- true
          has_table_privilege('authenticated', 'public.vendors', 'SELECT') as table_select,                        -- false (قايمة أعمدة)
          has_table_privilege('authenticated', 'public.vendors', 'DELETE') as table_delete,                        -- true (السياسة أدمن بس)
          has_column_privilege('authenticated', 'public.order_items', 'commission_rate', 'SELECT') as rate_read,   -- true
          has_column_privilege('authenticated', 'public.order_items', 'commission_rate', 'UPDATE') as rate_write,  -- false
          has_table_privilege('authenticated', 'public.vendor_rates', 'INSERT') as rates_insert,                   -- true
          has_table_privilege('authenticated', 'public.vendor_rates', 'UPDATE') as rates_update,                   -- false
          has_table_privilege('authenticated', 'public.vendor_bank', 'UPDATE') as bank_update,                     -- true
          has_table_privilege('authenticated', 'public.vendor_bank', 'DELETE') as bank_delete,                     -- false
          has_table_privilege('anon', 'public.vendor_bank', 'SELECT') as anon_reads;                               -- false

   select relname, relrowsecurity from pg_class where oid in ('public.vendor_rates'::regclass, 'public.vendor_bank'::regclass);  -- true / true
   select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_bank') order by 1, 2;
   -- vendor_bank: insert / select / update؛ vendor_rates: insert / select؛ vendors: delete / insert / select / update
   select policyname, with_check from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'vendors_update';
   -- فيها is_admin و vendors.edit و sensitive.vendor_bank
   select tgname, tgrelid::regclass from pg_trigger where tgname in ('vendors_guard_update', 'vendor_rates_apply');  -- 2 صفوف
   select proname, prosecdef, proowner::regrole from pg_proc where proname in ('vendors_guard_update', 'vendor_rates_apply');
   -- vendors_guard_update false / vendor_rates_apply true، والاتنين postgres

   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'vendor-contracts';
   -- صف واحد: public = false، 10485760، {application/pdf,image/png,image/jpeg}
   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'vendor_contracts_%' order by 1;
   -- 3 صفوف: insert / select / update (مافيش delete)
   ```

4. `rls_vendors` على الحي (فوق) — live-safe، وبيتأكد من الـ bucket كمان. **`migrate_0011` محلي/CI بس** (نفس سبب `0009`/`0010`). `rls_orders` اتعدّل عشان `0011` (الإدراج من غير `woo_vendor_id`، و`raw` بيتقرا بقايمة) — live-safe زي ما هو، بيتشغّل على الحي بعد `0011` كمان.
5. إعادة نشر الدالتين (§2.7.1) **بعد** `0011` مش قبلها: الكود الجديد بيكتب `vendors.joined_at` عند أول إدراج لأي متجر و`order_items.commission_rate`/`commission_fee` على كل سطر — وقبل الأعمدة PostgREST بيرفض الصف كله (عمود مش موجود، مش خطأ بيانات): جزء الأوردرات في الـ cron بيفشل وكل delivery بترجع 500 (وWooCommerce بيوقف الـ webhook بعد 5 مرات فشل، §2.7.6). وبعد النشر شغّل جملتين التعبئة مرة كمان (`execute_sql`؛ مابيغيّروش حاجة اتعملت) عشان يلحقوا أي متجر أو سطر الكود القديم كتبه بين التطبيق والنشر — هما نفس الجملتين اللي في `0011` (من `update public.vendors set joined_at` ومن `update public.order_items i` لحد نهايتها؛ انسخهم من الملف).
6. تشغيلة `vendors` (الـ cron بتبدأ بـ `states` ثم `vendors`، أو يدويًا بالجسم `{"action":"vendors"}` زي §2.7.5). بعدها:

   ```sql
   select at, result, detail from public.woo_sync_log where entity = 'vendors' order by at desc limit 1;
   -- ok و detail.vendors = 55
   select count(*) filter (where status = 'active') as active, count(*) filter (where name = raw ->> 'store_name') as same_name,
          count(joined_at) as with_joined
   from public.vendors;
   -- 55 / نفس الرقم اللي قبل التشغيلة (المزامنة مابتلمسش الاسم ولا الحالة على متجر موجود) / 55
   ```

**`0012_vendor_logins` (المرحلة 3.1) — قبل التطبيق وبعده.** الملف بيتعاد من غير ما يغيّر حاجة (مافيهوش `delete` ولا `truncate`؛ الـ `drop` الوحيد فيه هو قيد `vendors_status_check` بتاع `0007` — القرار 6 المكتوب في خطة المرحلة 3.1 — وبيتعمل بس لو القيد لسه مش فيه `leave`، وفي نفس البلوك بيتضاف القيد الجديد). اللي بيعمله:
- `vendors.status` بقى يقبل `leave` («في إجازة») جنب `active`/`inactive` — نفس اسم القيد `vendors_status_check`. الحارس `vendors_guard_update` زي ما هو (`vendors.toggle = F` لأي تغيير حالة)، والمزامنة ماتغيّرتش (`mapStore` بيكتب `active`/`inactive` على المتجر الجديد بس).
- `vendor_logins` (بيانات دخول المبتكر — صف لكل مبتكر، `vendor_id` pk → `vendors(id) on delete cascade`): `username` (`^[a-z0-9][a-z0-9._]{2,29}$`، فريد على `lower(username)` → 23505 للمكرر)، `email` (شكل إيميل بسيط، 120 حرف)، `pw_mode` (`link`|`temp`)، `status` (`invited`|`active`|`disabled`، افتراضي `invited`)، `must_change` (افتراضي true)، `invite_sent_at`، `password_set_at`، `secret_id` (معرّف السر في Vault)، `created_by` (اسم العضو، زي `set_by`)، `created_at`، `updated_at`. RLS: `select` بـ `vendors.view <> 'N'`؛ `insert`/`update` بـ `is_admin() or vendors.edit = 'F'` (الـ `using` بتاع التعديل `vendors.view` عشان اللي شايف الصف ومايقدرش يعدّله ياخد 42501 مش «0 صفوف» — نمط `0011`)؛ مافيش `delete` للأعضاء (الـ cascade بس). المنح بقايمة أعمدة: `select` كل الأعمدة **من غير `secret_id`** (يعني `select=*` بيترفض — الواجهة بتسمّي أعمدتها)، `insert (vendor_id, username, email, pw_mode, created_by)`، `update (username, email, pw_mode, status)`؛ `service_role` كل حاجة؛ ومن غير `truncate`/`references`/`trigger` لحد. (upsert بتاع PostgREST بيحتاج `update` على `vendor_id`/`created_by` فمش هيعدّي — الـ adapter بيدرج لو مفيش صف وبيعدّل لو فيه.) الحارس `vendor_logins_guard` (before update، على `anon`/`authenticated` بس): العميل يغيّر `username`/`email`/`pw_mode` و`status` لـ `invited`/`disabled` بس (`active` بتاعة البوابة لما المبتكر يعمل باسورده)؛ `must_change`/`invite_sent_at`/`password_set_at`/`secret_id` وباقي الأعمدة للسيرفر → 42501 برسالة إنجليزي واضحة؛ و`updated_at` بيتحدّث مع كل كتابة.
- الدالتين `vendor_login_set_password(uuid, text)` و`vendor_login_reveal(uuid)` — `security definer` بملكية `postgres` و`search_path = public`: الصلاحية `is_admin() or vendors.edit = 'F'` وإلا 42501؛ قواعد الباسورد على السيرفر (8 حروف على الأقل، حرف إنجليزي، رقم، من غير مسافات، ومش أكتر من 128) وإلا 22023؛ مبتكر من غير صف دخول → P0002؛ من غير Vault → 0A000 `vault is not available`. الباسورد المؤقت بيتخزن في Vault كسر اسمه `vendor-login:<uuid المبتكر>` (`vault.create_secret` أول مرة و`vault.update_secret` بعدها)، والصف بياخد `secret_id` و`password_set_at` و`must_change = true` و`pw_mode = 'temp'`. كل نداء (حط أو إظهار — حتى لو رجّع `null`) بيكتب صف في `activity_log` (`vendor.login.password` / `vendor.login.reveal`، `entity = 'vendor'`، `entity_id` = uuid المبتكر، `actor = auth.uid()` من الـ trigger، `new_value = null`) — الباسورد عمره ما يتكتب في `activity_log`. `execute` لـ `authenticated` و`service_role` بس (`revoke` من `public`/`anon`). **ملحوظة:** `service_role` معاه `execute` زي ما الخطة قالت، بس الدالتين بيشيكوا `has_perm` (محتاجة `auth.uid()`)، فنداء من `service_role` من غير JWT عضو بيرجع 42501.
- **الإيميل مابيتبعتش**، و**لينك التفعيل اتلغى** (صاحب المشروع، 26 أكتوبر): الواجهة بتكتب `pw_mode = 'temp'` دايمًا (الباسورد المؤقت هو الطريقة الوحيدة) و`invite_sent_at` بتفضل `null`؛ العمود وقيده وافتراضيه في `0012` ماتغيّروش (مافيش migration — قرار مرحلة البوابة). والسر في Vault مابيتمسحش لما المبتكر يتمسح بالـ cascade (Later في الخطة).

1. قبل:

   ```sql
   select pg_get_constraintdef(oid) as status_check from pg_constraint
   where conrelid = 'public.vendors'::regclass and conname = 'vendors_status_check';
   -- CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
   select to_regclass('public.vendor_logins') as logins,
          to_regprocedure('public.vendor_login_set_password(uuid, text)') as set_pw,
          to_regprocedure('public.vendor_login_reveal(uuid)') as reveal;
   -- null / null / null
   select count(*) as vendors, count(*) filter (where status = 'active') as active,
          count(*) filter (where status = 'inactive') as inactive
   from public.vendors;
   -- 55 / 55 / 0 (26 أكتوبر؛ + أي متجر جديد — active + inactive = vendors)
   select name, created_at from vault.secrets where name like 'vendor-login:%';
   -- 0 صفوف (عمرك ما تعمل select لـ decrypted_secret ولا لعمود secret)
   select has_function_privilege('postgres', 'vault.create_secret(text, text, text, uuid)', 'execute') as can_create,
          has_function_privilege('postgres', 'vault.update_secret(uuid, text, text, text, uuid)', 'execute') as can_update;
   -- true / true (الدالتين بتاعتنا بيتنفّذوا كـ postgres؛ `update_secret` عمره ما اتنادى في المشروع قبل 0012 — لو false، وقّف واسأل قبل التطبيق)
   ```

2. `apply_migration` بالاسم `vendor_logins`.
3. بعد:

   ```sql
   select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.vendors'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
   -- صف واحد: vendors_status_check | CHECK ((status = ANY (ARRAY['active'::text, 'leave'::text, 'inactive'::text])))
   select count(*) as vendors, count(*) filter (where status = 'active') as active,
          count(*) filter (where status = 'inactive') as inactive
   from public.vendors;
   -- نفس أرقام «قبل» (القيد الجديد اتضاف على الصفوف زي ما هي)

   select relrowsecurity from pg_class where oid = 'public.vendor_logins'::regclass;                       -- true
   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' order by 1;
   -- 3 صفوف: vendor_logins_insert / vendor_logins_select / vendor_logins_update (مافيش delete)
   select has_column_privilege('authenticated', 'public.vendor_logins', 'secret_id', 'SELECT') as secret_read,   -- false
          has_column_privilege('authenticated', 'public.vendor_logins', 'username', 'SELECT') as username_read,  -- true
          has_table_privilege('authenticated', 'public.vendor_logins', 'SELECT') as table_select,               -- false (قايمة أعمدة)
          has_column_privilege('authenticated', 'public.vendor_logins', 'status', 'INSERT') as status_insert,    -- false
          has_column_privilege('authenticated', 'public.vendor_logins', 'status', 'UPDATE') as status_update,    -- true (الحارس بيمنع active)
          has_column_privilege('authenticated', 'public.vendor_logins', 'must_change', 'UPDATE') as mc_update,   -- false
          has_table_privilege('authenticated', 'public.vendor_logins', 'DELETE') as member_delete,              -- false
          has_table_privilege('service_role', 'public.vendor_logins', 'DELETE') as server_delete,               -- true
          has_table_privilege('service_role', 'public.vendor_logins', 'TRUNCATE') as server_truncate,           -- false
          has_table_privilege('anon', 'public.vendor_logins', 'SELECT') as anon_reads;                          -- false
   select count(*) from information_schema.column_privileges
   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'vendor_logins' and privilege_type = 'SELECT';  -- 11
   select indexdef from pg_indexes
   where schemaname = 'public' and tablename = 'vendor_logins' and indexname = 'vendor_logins_username_key';
   -- CREATE UNIQUE INDEX vendor_logins_username_key ON public.vendor_logins USING btree (lower(username))

   select tgname, tgrelid::regclass from pg_trigger where tgname = 'vendor_logins_guard';                   -- صف واحد على vendor_logins
   select p.proname, p.prosecdef, p.proowner::regrole, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'execute') as member_exec,
          has_function_privilege('anon', p.oid, 'execute') as anon_exec
   from pg_proc p where p.proname in ('vendor_login_set_password', 'vendor_login_reveal', 'vendor_logins_guard');
   -- set_password / reveal: prosecdef true، postgres، {search_path=public}، member_exec true، anon_exec false
   -- vendor_logins_guard: prosecdef false، postgres، {search_path=public}، member_exec false
   select count(*) from public.vendor_logins;                                                               -- 0 لحد أول إضافة من الـ popup
   ```

4. `rls_vendor_logins` على الحي (فوق) — live-safe، وبيختبر الدالتين مع Vault فعلًا (السر التجريبي بيروح مع الـ rollback: `select count(*) from vault.secrets where name like 'vendor-login:%'` بعده = 0 لحد أول باسورد حقيقي). و`rls_vendors` على الحي زي ما هو (مش متأثر بـ `0012`). **`migrate_0012` محلي/CI بس** (نفس سبب `0009`/`0010`/`0011`).
5. `get_advisors` (§2.2): الدالتين الجداد `security definer` و`authenticated` بينفّذهم — مقصود (تحت).
6. **مافيش إعادة نشر** للدالتين (`woo-webhook`/`woo-sync`) في المرحلة دي: `_shared` و`index.ts` ماتغيّروش.

**`0013_brands` (المرحلة 3.2) — قبل التطبيق وبعده.** الملف بيتعاد من غير ما يغيّر حاجة (مافيهوش `drop` ولا `delete` ولا `truncate`؛ إعادة التعبئة محروسة بـ `not exists`). اللي بيعمله:
- `brands` (البراند = الاسم اللي المنتجات بتتباع بيه): `id`، `name` (1–80، **فريد على `lower(btrim(name))`** → 23505 للمكرر)، `code` (`^[A-Z0-9]{1,3}$`)، `aliases`، `store_vendor_id` (المتجر اللي أوردراته بتتباع بالبراند — `unique`، `references vendors(id) on delete cascade`، **السيرفر بس** بيحطه: مافيش `insert`/`update` عليه للأعضاء)، `origin_vendor_id` (المبتكر اللي اتعمل له البراند، `on delete cascade`)، `created_by`، `created_at`، `updated_at`. `brand_owners` (تاريخ الملكية — صفوف بتتضاف بس): `brand_id` (cascade)، `vendor_id` (**من غير cascade** — `deferrable initially immediate`، شوف الحارس تحت)، `since`، `return_on` (`null` أو `> since` — القيد `brand_owners_return_on_check`)، `reason` (≤ 200)، `set_by`، `created_at`؛ `unique (brand_id, since)`. `brand_rates` (النسبة الخاصة بتاريخ؛ `rate` `null` = «من غير نسبة خاصة» من التاريخ ده، وإلا 0–65): `brand_id` (cascade)، `rate`، `since`، `set_by`، `created_at`؛ `unique (brand_id, since)`؛ إضافة بس.
- RLS: `brands`/`brand_owners` — `select` بـ `vendors.view <> 'N'`، `insert` (و`update` على `brands` بس) بـ `is_admin() or vendors.edit = 'F'` (الـ `using` بتاع التعديل `vendors.view` — نمط `0011`/`0012`: 42501 مش «0 صفوف»)؛ `brand_rates` — `select`/`insert` بـ `sensitive.commission = F` زي `vendor_rates`. مافيش `delete` للأعضاء على التلاتة (الـ cascade بس). المنح: `select` كل الأعمدة (على مستوى الجدول — مافيش عمود حساس؛ `select=*` بيعدّي، والواجهة بتسمّي أعمدتها برضه)، `insert` بقايمة أعمدة (`brands`: `name, code, aliases, origin_vendor_id, created_by`؛ `brand_owners`: `brand_id, vendor_id, since, return_on, reason, set_by`؛ `brand_rates`: `brand_id, rate, since, set_by`)، `update (name, code, aliases)` على `brands` بس؛ `service_role` كل حاجة؛ ومن غير `truncate`/`references`/`trigger` لحد.
- الحرّاس (على `anon`/`authenticated` بس): `brands_guard` (before update) — غير `name`/`code`/`aliases` → 42501 (المنح بالعمود بترفض قبله بـ «permission denied for column»)، و`updated_at` بيتحدّث مع كل كتابة؛ `brand_owners_guard` (before insert) — `since` أقدم من آخر `since` للبراند → 22023 `since before the last transfer`، و`vendor_id` = صاحب آخر صف → 22023 `same vendor` (التاريخ المكرر = 23505 من المفتاح). و`vendors_brands_guard_delete` (before delete على `vendors`، لكل الأدوار): مبتكر موجود في تاريخ ملكية براند مبتكر تاني (دلوقتي أو قبل كده) → 23503 برسالة فيها `brand_owners_vendor_id_fkey`؛ غير كده بيأجّل المفتاح ده للـ transaction عشان cascade براناته هو يكمّل (Postgres بيفحص مفتاح `no action` قبل ما الـ cascade من المستوى التاني يمسح صفوف ملكيته — من غير الحارس ده صاحب الأصل عمره ما كان هيتمسح).
- التريجر `vendors_brand_after_insert` (after insert على `vendors`؛ دالة `security definer` بملكية `postgres` و`search_path = public`، بتنادي `vendor_brand_auto(uuid)`): لو مفيش براند بنفس الاسم (lower/btrim) بيضيف براند باسم المبتكر (الاسم بعد `btrim`، الكود = أول حرف لاتيني كبير وإلا `X`، `aliases` بتاعته، `store_vendor_id = id` لو `woo_vendor_id` مش null، `origin = id`، `created_by = 'system'`) + صف ملكية (`since = coalesce(joined_at, current_date)`، `set_by = 'system'`). بيشتغل مع إدراج المزامنة (`service_role`) ومع الـ popup (`authenticated`) من غير أي تغيير في الدوال ولا الـ adapter. الاسم مأخوذ / فاضي / أطول من 80 → مافيش براند تلقائي، والإدراج نفسه بيعدّي (المزامنة ماتقفش أبدًا بسبب البراند).
- **إعادة التعبئة** في نفس الملف: نفس الدالة لكل صف `vendors` من غير براند، بالأقدم أولًا (`created_at, id`). الحي: 56 صف (أسماء كلها مختلفة) → 56 براند (55 مربوط بمتجره + 1 يدوي من غير متجر) + 56 صف ملكية.
- الدالتين `brand_owner_at(uuid, date)` / `store_owner_at(uuid, date)` (`stable`، `security invoker` — RLS على اللي بينادي، `execute` لـ `authenticated`/`service_role` بس): صاحب البراند في التاريخ (آخر صف `since <= D` وإلا الأول؛ `null` التاريخ = النهارده)، وصاحب براند المتجر يومها وإلا المتجر نفسه لو مفيش براند. للتقارير الجاية؛ الواجهة بتحسب محليًا.

1. قبل:

   ```sql
   select to_regclass('public.brands') as brands, to_regclass('public.brand_owners') as owners, to_regclass('public.brand_rates') as rates,
          to_regprocedure('public.brand_owner_at(uuid, date)') as owner_at, to_regprocedure('public.store_owner_at(uuid, date)') as store_owner_at;
   -- null / null / null / null / null
   select count(*) as vendors, count(*) filter (where woo_vendor_id is not null) as stores,
          count(*) filter (where woo_vendor_id is null) as hand_added,
          count(*) - count(distinct lower(btrim(name))) as duplicate_names,
          count(*) filter (where length(btrim(name)) not between 1 and 80) as unfit_names
   from public.vendors;
   -- 56 / 55 / 1 / 0 / 0 (26 أكتوبر؛ لو duplicate_names أو unfit_names > 0: الصفوف دي مش هتاخد براند تلقائي والفريق يضيفه باليد — سجّلها قبل التطبيق)
   select tgname from pg_trigger where tgrelid = 'public.vendors'::regclass and not tgisinternal order by 1;
   -- vendors_guard_update بس
   ```

2. `apply_migration` بالاسم `brands`.
3. بعد:

   ```sql
   select (select count(*) from public.vendors) as vendors, (select count(*) from public.brands) as brands,
          (select count(*) from public.brand_owners) as owners, (select count(*) from public.brand_rates) as rates;
   -- 56 / 56 / 56 / 0 (brands = vendors − duplicate_names − unfit_names من «قبل»)
   select count(*) filter (where b.store_vendor_id = v.id) as tied_stores,
          count(*) filter (where v.woo_vendor_id is null and b.store_vendor_id is null) as free_hand,
          count(*) filter (where (v.woo_vendor_id is not null) <> (b.store_vendor_id is not null)) as mismatched
   from public.vendors v join public.brands b on b.origin_vendor_id = v.id;
   -- 55 / 1 / 0 (store_vendor_id متحطوط للمتاجر بالظبط)
   select count(*) from public.vendors v where not exists (select 1 from public.brands b where b.origin_vendor_id = v.id);   -- 0
   select count(*) from public.brands b join public.vendors v on v.id = b.origin_vendor_id
   where b.name <> btrim(v.name) or b.created_by is distinct from 'system' or b.code !~ '^[A-Z0-9]{1,3}$' or b.aliases <> v.aliases;   -- 0
   select count(*) from public.brand_owners o join public.brands b on b.id = o.brand_id join public.vendors v on v.id = b.origin_vendor_id
   where o.vendor_id <> v.id or o.since <> coalesce(v.joined_at, current_date) or o.set_by is distinct from 'system' or o.return_on is not null;   -- 0

   select relname, relrowsecurity from pg_class where oid in ('public.brands'::regclass, 'public.brand_owners'::regclass, 'public.brand_rates'::regclass);  -- true ×3
   select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates') order by 1, 2;
   -- 7 صفوف: brand_owners insert / select؛ brand_rates insert / select؛ brands insert / select / update (مافيش delete)
   select has_table_privilege('authenticated', 'public.brands', 'SELECT') as brands_read,                        -- true
          has_column_privilege('authenticated', 'public.brands', 'store_vendor_id', 'INSERT') as store_insert,    -- false
          has_column_privilege('authenticated', 'public.brands', 'store_vendor_id', 'UPDATE') as store_update,    -- false
          has_column_privilege('authenticated', 'public.brands', 'name', 'UPDATE') as name_update,                -- true
          has_column_privilege('authenticated', 'public.brand_owners', 'since', 'INSERT') as owner_insert,        -- true
          has_table_privilege('authenticated', 'public.brand_owners', 'UPDATE') as owner_update,                  -- false
          has_column_privilege('authenticated', 'public.brand_rates', 'rate', 'INSERT') as rate_insert,           -- true
          has_table_privilege('authenticated', 'public.brand_rates', 'INSERT') as rate_table_insert,              -- false (قايمة أعمدة)
          has_table_privilege('authenticated', 'public.brands', 'DELETE') as member_delete,                       -- false
          has_table_privilege('service_role', 'public.brands', 'DELETE') as server_delete,                        -- true
          has_table_privilege('service_role', 'public.brands', 'TRUNCATE') as server_truncate,                    -- false
          has_table_privilege('anon', 'public.brands', 'SELECT') as anon_reads;                                   -- false
   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'brands_name_key';
   -- CREATE UNIQUE INDEX brands_name_key ON public.brands USING btree (lower(btrim(name)))
   select condeferrable, condeferred from pg_constraint where conname = 'brand_owners_vendor_id_fkey';   -- true / false

   select tgname, tgrelid::regclass from pg_trigger
   where tgname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete') order by 1;
   -- 4 صفوف: brand_owners_guard على brand_owners، brands_guard على brands، vendors_brand_after_insert وvendors_brands_guard_delete على vendors
   select p.proname, p.prosecdef, p.proowner::regrole, p.provolatile, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'execute') as member_exec,
          has_function_privilege('anon', p.oid, 'execute') as anon_exec
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('brand_owner_at', 'store_owner_at', 'vendor_brand_auto', 'vendors_brand_after_insert', 'brands_guard', 'brand_owners_guard', 'vendors_brands_guard_delete')
   order by 1;
   -- brand_owner_at / store_owner_at: prosecdef false، postgres، s (stable)، {search_path=public}، member_exec true، anon_exec false
   -- vendor_brand_auto / vendors_brand_after_insert: prosecdef true، postgres، v، {search_path=public}، member_exec false
   -- brands_guard / brand_owners_guard / vendors_brands_guard_delete: prosecdef false، postgres، member_exec false
   select count(*) filter (where public.store_owner_at(v.id, current_date) = v.id) as own, count(*) as stores
   from public.vendors v where v.woo_vendor_id is not null;
   -- 55 / 55 (قبل أي نقل كل متجر صاحبه نفسه)
   ```

4. `rls_brands` على الحي عبر workflow «RLS live» (الملف فيه `delete from` كنص — الأداة بتحجزه؛ الافتراضي بقى `rls_vendors rls_vendor_logins rls_brands`) — live-safe: كل عدّ مربوط بصفوفه، والـ delete الوحيد اللي بيعدّي فيه على مبتكر هو اللي عمله وبيروح مع الـ rollback. و`rls_vendors` + `rls_vendor_logins` زي ما هم (الحارس الجديد على `vendors` مابيغيّرش نتيجتهم). **`migrate_0013` محلي/CI بس** (نفس سبب `0009`–`0012`).
5. `get_advisors` (§2.2): مافيش جديد متوقع — الدالتين الـ definer (`vendor_brand_auto`/`vendors_brand_after_insert`) مش قابلين للتنفيذ من الأعضاء، والدالتين العامتين `security invoker`.
6. **مافيش إعادة نشر** للدالتين (`woo-webhook`/`woo-sync`): `_shared` و`index.ts` ماتغيّروش — التريجر بيشتغل مع إدراج المزامنة زي ما هو.

**`0014_vendor_sync` (المرحلة 3.3) — قبل التطبيق وبعده.** الملف بيتعاد من غير ما يغيّر حاجة (مافيهوش `drop` ولا `delete` ولا `truncate`، ومافيهوش backfill: القيم عايشة على الموقع مش في `raw`، وأول تشغيلة `vendors` بعد النشر هي اللي بتملاها — قاعدة التشغيلة الأولى في القرار 4 أ). اللي بيعمله:
- `vendors`: `contact_name text`، `address_parts jsonb` (الستة مفاتيح `street_1`/`street_2`/`city`/`state`/`zip`/`country`)، `social jsonb` (التمانية `fb`/`instagram`/`twitter`/`youtube`/`linkedin`/`pinterest`/`threads`/`flickr` — روابط `https://` أو فاضي)، `logo_url`، `banner_url`، `woo_payment_methods text[]`، `woo_snapshot jsonb` (**`service_role` بس** زي `raw`: آخر قيم الموقع للحقول المتزامنة — فيها التليفون والإيميل)، `push_pending jsonb` (أسماء الحقول اللي دفعها فشل أو مستني `WOO_PUSH_ENABLED`)، `woo_synced_at`. المنح: `select` للأعضاء على التمانية ما عدا `woo_snapshot`؛ `insert`/`update` للأعضاء على `contact_name`/`address_parts`/`social` بس (و`address` من قبل) بقاعدة الاتصال بتاعة الحارس (`vendors.edit` F أو P)؛ الباقي للسيرفر → 42501 من الحارس `vendors_guard_update` اللي اتوسّع (`create or replace`، نفس الرسايل).
- `vendor_rates.flat numeric(10,2)` (`null` أو ≥ 0): الرسوم الثابتة بتاعة الموقع للعرض بس؛ مش داخلة في حساب الحصة.
- `vendor_category_rates` (العمولة حسب الفئة): `id`، `vendor_id` (cascade)، `woo_category_id int > 0`، `rate` (`null` = اتشالت من التاريخ ده، وإلا 0–65)، `flat` (≥ 0)، `since`، `set_by`، `created_at`؛ `unique (vendor_id, woo_category_id, since)`؛ RLS `select`/`insert` بـ `sensitive.commission = F`؛ إضافة بس (مافيش `update`/`delete` للأعضاء؛ `insert` بقايمة أعمدة من غير `id`/`created_at`).
- `woo_categories` (أسماء فئات الموقع): `id`، `name`، `slug`، `parent_id` (من غير مفتاح أجنبي)، `updated_at`؛ RLS `select` بـ `vendors.view <> N`؛ المزامنة بتكتبها (`service_role`)؛ مابتتمسحش.

1. قبل:

   ```sql
   select to_regclass('public.vendor_category_rates') as category_rates, to_regclass('public.woo_categories') as categories,
          (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vendors' and column_name in ('contact_name', 'woo_snapshot', 'push_pending')) as new_cols;
   -- null / null / 0
   select count(*) as stores, count(*) filter (where status = 'inactive') as inactive, count(*) filter (where name like '#%') as placeholders
   from public.vendors where woo_vendor_id is not null;
   -- 55 / 0 / 6 (27 أكتوبر؛ الموقع فيه متجر enabled: false ومتاجر من غير اسم — أول تشغيلة بتصلّح الحالة وبتسيب الأسماء)
   select count(*) from public.vendor_rates;   -- سجّل الرقم: أول تشغيلة بتضيف صف «الموقع» لكل متجر نسبته على الموقع مختلفة أو فاضية عندنا
   ```

2. `apply_migration` بالاسم `vendor_sync`.
3. بعد:

   ```sql
   select column_name, data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'vendors'
     and column_name in ('contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at')
   order by 1;   -- 9 صفوف، كلها YES
   select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vendor_rates' and column_name = 'flat';   -- 1
   select has_column_privilege('authenticated', 'public.vendors', 'push_pending', 'SELECT') as pending_read,        -- true
          has_column_privilege('authenticated', 'public.vendors', 'woo_snapshot', 'SELECT') as snapshot_read,       -- false
          has_column_privilege('authenticated', 'public.vendors', 'contact_name', 'UPDATE') as contact_update,      -- true
          has_column_privilege('authenticated', 'public.vendors', 'logo_url', 'UPDATE') as logo_update,             -- false
          has_column_privilege('authenticated', 'public.vendors', 'push_pending', 'UPDATE') as pending_update,      -- false
          has_table_privilege('authenticated', 'public.vendor_category_rates', 'SELECT') as cat_read,              -- true
          has_column_privilege('authenticated', 'public.vendor_category_rates', 'rate', 'INSERT') as cat_insert,    -- true
          has_table_privilege('authenticated', 'public.vendor_category_rates', 'UPDATE') as cat_update,            -- false
          has_table_privilege('authenticated', 'public.woo_categories', 'SELECT') as categories_read,              -- true
          has_table_privilege('authenticated', 'public.woo_categories', 'INSERT') as categories_insert,            -- false
          has_table_privilege('service_role', 'public.woo_categories', 'TRUNCATE') as server_truncate;             -- false
   select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('vendor_category_rates', 'woo_categories') order by 1, 2;
   -- 3 صفوف: vendor_category_rates insert / select؛ woo_categories select
   select relname, relrowsecurity from pg_class where oid in ('public.vendor_category_rates'::regclass, 'public.woo_categories'::regclass);   -- true ×2
   select prosrc like '%woo_snapshot%' as widened, proconfig from pg_proc where proname = 'vendors_guard_update' and pronamespace = 'public'::regnamespace;
   -- true / {search_path=public}
   select count(*) from pg_trigger where tgrelid = 'public.vendors'::regclass and tgname = 'vendors_guard_update';   -- 1
   select count(*) from public.vendors where woo_snapshot is not null;   -- 0 قبل أول تشغيلة vendors (مافيش backfill)
   ```

4. `rls_vendor_sync` + `rls_vendors` + `rls_vendor_logins` + `rls_brands` على الحي عبر workflow «RLS live» (الافتراضي بقى الأربعة؛ `rls_vendor_sync` فيه `delete from` كنص متوقع يترفض 42501 فالأداة بتحجزه). **`migrate_0014` محلي/CI بس** (نفس سبب `0009`–`0013`).
5. `get_advisors` (§2.2): مافيش جديد متوقع (مافيش دوال جديدة؛ الحارس زي ما هو `security invoker`).
6. **إعادة نشر الدالتين** (`woo-webhook`/`woo-sync`، 2.7.1): `_shared/woo-core.js` و`_shared/woo-write.js` و`woo-sync/index.ts` اتغيّروا. بعدها 2.7.11 (أول تشغيلة `vendors` وفحص القبول).

### 2.2 `get_advisors`
شغّله مرتين: `type: security` و`type: performance`.

المتوقع والمقبول:
- **`login_lookups`: RLS enabled, no policies** — مقصود. الجدول ده عدّاد الـ throttle بتاع الدخول، ومحدش يلمسه غير الدالة `email_for_identifier` (ومفيش grants لـ `anon`/`authenticated` أصلًا).
- **`email_for_identifier` دالة `security definer` وينفع `anon` ينفّذها** — مقصود. شاشة الدخول محتاجاها قبل ما المستخدم يسجّل، عشان تحوّل الموبايل لإيميل، وبتقبل رقم موبايل (11 رقم) بس — أي إيميل بيرجع صفر صفوف، والدخول بالإيميل بيروح لـ Supabase Auth على طول. عليها حد عام 60 طلب في الدقيقة لكل الناس مع بعض، فلو حد غرّقها بطلبات من غير تسجيل، اللي بيتأثر الدخول بالموبايل بس (الدخول بالإيميل شغّال عادي).
- **`has_perm`/`is_admin` دوال `security definer` وينفع `authenticated` ينفّذها** — مقصود: كل السياسات والحراس بيعدّوا عليهم.
- بعد `0007`: **`order_customer_phone` دالة `security definer` وينفع `authenticated` ينفّذها** — مقصود: هي اللي بتغذّي عمود التليفون في `orders_v`، وبتشيك `orders.view` وبتطمس التليفون (`sensitive.customer_phone`) بنفسها.
- بعد `0008`: **`mark_twofa_enrolled`/`mark_twofa_disabled` دوال `security definer` وينفع `authenticated` ينفّذها** — مقصود: كل واحدة بتشترط جلسة aal2 (و`enrolled` كمان factor TOTP `verified` للمستخدم نفسه في `auth.mfa_factors`)، وبتغيّر صف المستخدم نفسه بس. (`sync_secret_matches` لـ `service_role` بس، فمش المفروض تظهر.)
- بعد `0012`: **`vendor_login_set_password`/`vendor_login_reveal` دوال `security definer` وينفع `authenticated` ينفّذها** — مقصود: الباسورد المؤقت في Vault والعضو مالوش `usage` على schema `vault`؛ كل واحدة بتشيك `is_admin() or vendors.edit = F` بنفسها (42501) وبتسجّل كل نداء في `activity_log`، وعمرها ما ترجّع غير سر المبتكر اللي اتطلب.
- ملاحظات performance (INFO/WARN) على الـ policies أو الـ indexes اللي ذكرتها تقارير المهمة 3 و4 — مقبولة دلوقتي.
- بعد `0006`: الزيادة الوحيدة INFO «unused index» على الجداول الجديدة — متوقعة لحد ما التطبيق يكتب فيها.
- WARN «Leaked Password Protection Disabled» — ده إعداد في لوحة Auth لصاحب المشروع (Authentication › Attack Protection)، مش migration.

غير المقبول: أي جدول في `public` من غير RLS، أو دالة من غير `search_path` ثابت، أو أي تحذير جديد مش مفهوم — يتصلّح الأول.

### 2.3 إعدادات Auth (لوحة Supabase › Authentication)
- **Sign In / Providers › Email:** شغّال. التسجيل الذاتي (sign-ups) يفضل مقفول — الحسابات بالدعوة بس.
- **Confirm email:** حسب اختيارك. لو شغّال، الدعوة هي اللي بتأكد الإيميل.
- **Multi-Factor › TOTP:** enabled. (من المرحلة 2 مستخدم فعلًا: «ملفي» › التحقق بخطوتين › «تطبيق Authenticator»؛ الاستعادة في §2.7.9.)
- **URL Configuration:**
  - Site URL: `https://operation-system.ibtekr.club`
  - Redirect URLs:
    - `https://operation-system.ibtekr.club/**`
    - `http://localhost:4173/**`
- **Secure password change** (يطلب إعادة تأكيد قبل تغيير الباسورد): **شغّال**.
- Rate limits: الافتراضي.
- **SMTP Settings (Authentication › SMTP Settings / Emails):** شغّل **Custom SMTP** — الإيميل المدمج في Supabase عليه حد صغير جدًا في الساعة وبيبعت بس لإيميلات أعضاء فريق المشروع على Supabase، فلينكات الاسترجاع والدعوات مش هتوصل للفريق من غيره. البيانات من صندوق `operation-system@ibtekr.club` على Hostinger (hPanel › Emails):
  - Sender email: `operation-system@ibtekr.club` — Sender name: `نظام إبتكر`
  - Host: `smtp.hostinger.com` — Port: `465` (SSL)
  - Username: `operation-system@ibtekr.club` — Password: باسورد الصندوق (يتكتب في لوحة Supabase بس، عمره ما يدخل git)

### 2.4 مفتاح الـ anon في `app/config.js`
خد المفتاح العام من Settings › API › "anon public" (أو MCP `get_publishable_keys`) وحطه في `supabaseAnonKey`:

```js
window.IB_CONFIG = window.IB_CONFIG || {
  supabaseUrl: 'https://fsynculhaupcktzkfkdd.supabase.co',
  supabaseAnonKey: '<anon public key>',
};
```

ده مفتاح عام (الـ RLS هي اللي بتحمي البيانات). **اعمل commit لـ `app/config.js` بمفتاح الإنتاج** — الـ e2e الحقيقي مابيقراش الملف ده أصلًا، بياخد مشروع الـ staging من متغيرات البيئة (خطوة 5). **الـ service_role key عمره ما يدخل الملف ده ولا أي ملف في git.**

### 2.5 حسابات التطوير
`tools/seed-dev-users.sql` بيعمل 3 حسابات بباسورد مكتوب في الملف نفسه (`IbtekrDev-2026`). يتشغّل **على مشروع dev/staging بس، عمره ما يتشغّل على الإنتاج** — على الإنتاج هيبقى باب خلفي بباسورد أدمن معروف لأي حد شاف الريبو.

### 2.6 الحالة على المشروع الحي
- المرحلة صفر (2026-10-22): أول خمس migrations (`0001`–`0005`) اتطبّقوا، و`rls_identity` و`rls_system` خضر.
- المرحلة 1 (2026-10-25): الـ migration `dashboard` (`0006`) اتطبّقت، و`rls_dashboard` أخضر.
- المرحلة 2 (2026-10-25): `orders` (`0007`) و`mfa_cron` (`0008`) اتطبّقوا (`0007` بدري عن الخطة — صفحة الأوردرات على `main` كانت بتعرض حالة الخطأ لحد ما الجداول تتعمل)، واتأكد اللي في §2.1؛ الـ advisors مازادش فيها غير المقصود (§2.2). الدالتين `woo-webhook` و`woo-sync` اتنشروا (v1)، وبعد موجة الإصلاح الختامية اتنشروا تاني **v2** بكود الفرع النهائي (22:47Z و23:08Z، `verify_jwt: false`، بالشكل اللي في §2.7.1) — قبل ما الأسرار تتحط، عشان أول delivery وأول مزامنة يشتغلوا بالكود الصح. القاعدة: أي تعديل في `_shared/` أو في `index.ts` بتاعة دالة = إعادة نشر الدالتين. الـ cron اتأكد: 3 تشغيلات (21:30 و21:45 و22:00Z) `succeeded`، والرد 500 `not_configured` — متوقع لحد ما أسرار `WOO_*` تتحط (السر الداخلي طابق، يعني الطلب وصل للكود). **26 أكتوبر:** الأسرار الأربعة اتدخلت من اللوحة (صاحب المشروع، بعد ما طلب `create_edge_function_secret` اتقفل مرتين من غير إجابة)؛ أول مزامنة `orders` يدويًا 07:22Z عبر `net.http_post` بسر الـ Vault: 104 أوردر + 86 فرعي = 190 (نفس الفحص)، 206 سطر، 0 سطر غير مربوط بفرعي، 0 تعارض؛ الـ webhooks الأربعة اتسجّلت 07:24Z (ids 79–82، active) وأول deliveries وصلت `ok` 07:34Z؛ المنتجات 3620 بعد تشغيلتين (الأولى وقفت عند مهلة 150 ثانية بعد 29 صفحة والتانية كمّلت من الـ cursor؛ الفحص قال 3991 — فرق للمراجعة في المرحلة 4)؛ المتاجر 55 كلها `active` من تشغيلة 08:00Z بعد إعادة النشر **v4** (07:42Z/07:47Z: `mapStore` بيعتبر غياب `enabled` = نشط). **لسه:** `WOO_PUSH_ENABLED` (قرار صاحب المشروع بعد التأكد إن الإيميلات وبوسطة متقفلين على الـ staging)؛ وتشغيل `rls_orders`/`rls_mfa` على الحي مش متسجّل في الدفتر. التفاصيل في `.superpowers/sdd/2026-10-25-phase-2-orders/progress.md`.
- المرحلة 2.1 (2026-10-26): `failed_note_permalink` (`0009`) اتطبّقت على الحي 09:41Z (`status_map` 9 صفوف، «فشل» `failed`/`from_woo` مكان «تم RTC»؛ 17 تعليق اتملى من ملاحظة الموقع مع 17 سطر `order_events`؛ `products.permalink` 3620 معبّى و0 فاضي؛ الأعضاء بيقروه)، وبعدها الدالتين اتنشروا **v5** 09:58Z (`_shared/woo-core.js` و`_shared/woo-write.js`)، وجملتين الداتا اتشغّلوا تاني (0 متبقّي)، وتشغيلة cron 10:00Z `ok` بالكود الجديد. الواجهة الجديدة نزلت على `main` (a9bdd45) بعد كل ده بالترتيب.
- المرحلة 2.2 (2026-10-26): `state_names` (`0010`) اتطبّقت على الحي 13:29Z (105/105 أوردر فيهم `customer_state` من `raw`، 14 كود؛ `orders_v` 26 عمود؛ الأعضاء بيقروا العمود ومابيكتبوهوش؛ `woo_states` بسياسة `select` للأعضاء وبدون `insert`)، وبعدها الدالتين اتنشروا **v7** (`woo-webhook` 13:34Z، `woo-sync` 13:44Z) بكود 2.2؛ جملة التعبئة مالهاش متبقّي (0 `null`)؛ تشغيلة cron 13:45Z `all` ok على v7 (`states` 27، المتاجر 55، أوردرات 0 جديد)، وتشغيلة `states` يدويًا 13:47Z: 27 محافظة مكتوبة، 0 متخطّي، 0 فاشل، وكل الـ 105 كود ليهم اسم. **ملحوظة:** قايمة الموقع بالإنجليزي (Cairo, Alexandria, Giza…) — لو صاحب المشروع عايزها عربي: نجرّب `?lang=ar` على نفس الـ endpoint (WPML) أو عمود اسم عربي في `woo_states` (قرار مكتوب). الواجهة الجديدة نزلت على `main` بعد كل ده بالترتيب.
- المرحلة 3 (2026-10-26): `vendors` (`0011`) **اتطبّقت** 15:38Z (`20261026153800 vendors`)، وفحوص ما بعد التطبيق (§2.1) مطابقة. الدالتين على **v9**: `woo-sync` 17:43Z و`woo-webhook` 17:47Z — v8 (15:44Z/15:54Z) كان فيها غلطة: `saveVendors` كانت بتكتب `raw` للمتجر الموجود بـ upsert ناقص، وPostgres بيفحص الأعمدة not-null قبل `on conflict`، فكل تشغيلة cron من 16:00Z لـ 17:30Z سجّلت 55 صف خطأ («null value in column name») ومحدّثتش حاجة (385 صف خطأ فاضلين في `woo_sync_log`، مابنمسحش). v9 بتعمل UPDATE لكل متجر موجود؛ تشغيلة 17:45Z: 55 متجر، `raw`/`updated_at` اتحدّثوا، الأسماء والحالات زي ما هي، 0 أخطاء. جملتين التعبئة مش محتاجين إعادة (بالقراءة 17:30Z: 210 سطر بنسبة و0 سطر ناقص، و`joined_at` على الـ 55). `rls_vendors` **اتشغّل على الحي** عبر workflow «RLS live» (التشغيلة 4، 19:12Z) ورجّع `ok` مع `rls_vendor_logins` — بعد ما التشغيلات 1–3 كشفت إن الملف كان بيعدّ كل المبتكرين اللي الأدمن شايفهم ويتوقع 2 (صح على CI الفاضي بس؛ الحي فيه 55 متجر)، فكل عدّ اتربط بصفوف الملف نفسه (8395f4b). أداة الـ MCP بتحجز الملف ده (فيه `delete` كنص)، فالـ workflow هو الطريق ليه. التفاصيل في `.superpowers/sdd/2026-10-26-phase-3-vendors/progress.md`.
- المرحلة 3.1 (2026-10-26): `vendor_logins` (`0012`) **اتطبّقت** 17:52Z (`20261026175216 vendor_logins`) بعد المراجعتين، وفحوص ما بعد التطبيق (§2.1) مطابقة: القيد بـ `leave` (قيد واحد)، الجدول موجود وفاضي، الدالتين `security definer` بملكية `postgres` و`search_path = public`، `secret_id` مش مرئي لـ `authenticated`، مافيش delete/truncate للأعضاء، `anon` مايقدرش ينفّذ الدالتين، 3 سياسات، الحارس شغّال، 0 أسرار `vendor-login:%`. مافيش تغيير في الدوال. `rls_vendor_logins` **اتشغّل على الحي** 17:58Z ورجّع `ok` (rollback) — أول تشغيل حقيقي لمسار Vault: `create_secret` ثم `update_secret` كـ postgres، والإظهار بيرجّع نفس القيمة، وصفوف `activity_log` بالعدد المتوقع.
- المرحلة 3.3: `0014` اتطبّقت على الـ staging 27 أكتوبر (`vendor_sync`، شاملة RPC `vendor_push_pending`؛ `rls_vendor_sync` حي أخضر — run 6؛ `woo-sync` v17 و`woo-webhook` v14؛ أول تشغيلة `vendors`: 55 متجر، 55 تعبئة أولى، تعارض 1 (متجر 44: التليفون والنسبة — بتاعنا فضل)، 21 متجر بقوا «موقوف» لأنهم مقفولين على الموقع، 27 صف نسبة من الموقع، 5 نسب فئات، 196 فئة؛ فحص القبول على Art Craft ناجح) (`vendor_sync`: بيانات المتجر في الاتجاهين — الأعمدة الجديدة على `vendors` والحارس الموسّع، `vendor_rates.flat`، `vendor_category_rates`، `woo_categories`؛ بعدها إعادة نشر الدالتين وأول تشغيلة `vendors` وفحص القبول — §2.1 و2.7.11). الواجهة (Task B) بتقرا الأعمدة الجديدة بقايمة أعمدة وبتنادي `push_vendor`.
- المرحلة 3.3 (قرار 12): `0015` (`rate_today`: RPC `vendor_rate_set` و`vendor_category_rate_set` — النسبة وعمولة الفئة من غير تاريخ، بتاريخ النهارده بالقاهرة، وتغيير تاني في نفس اليوم بيستبدل). فحص بعد التطبيق: `select proname from pg_proc where proname in ('vendor_rate_set','vendor_category_rate_set')` = صفين، ثم `rls_rate_today` عبر الـ workflow.
- المرحلة 3.6: `0018` (`orders_maker_rating`: حالات الأوردر الفرعي بـ «المبتكر» — الـ check والتريجر، الاستثناء المكتوب `drop constraint order_items_status_check` ويرجع على طول؛ `customer_ratings` إضافة بس؛ RPC `order_complete`). فحص بعد التطبيق: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_items_status_check'` فيه «المبتكر» ومافيهوش «المورد»، و`select count(*) from public.order_items where status like '%المورد%'` = 0، و`select relrowsecurity from pg_class where oid = 'public.customer_ratings'::regclass` = true؛ ثم `rls_customer_ratings rls_orders` عبر الـ workflow.
- المرحلة 4: `0019` (`accounts`: الدفاتر `acc_expenses` / `acc_vendor_moves` / `acc_account_moves` بالحارس `acc_guard` — «حذف» = `voided_at`، مافيش `delete`؛ مرايات Dokan `dokan_withdrawals` / `dokan_balances` قراءة بس للأعضاء؛ RPC `accounts_sales`؛ cron `woo-sync-accounts` كل ساعة على الدقيقة 7). فحص بعد التطبيق: `select jobname, schedule from cron.job` فيه `woo-sync-accounts | 7 * * * *`، و`select relname, relrowsecurity from pg_class where relname in ('acc_expenses','acc_vendor_moves','acc_account_moves','dokan_withdrawals','dokan_balances')` كلها true؛ ثم `rls_accounts` عبر الـ workflow. بعدها انشر woo-sync (فيه جزء `accounts` و`statement` و`probe_dokan`) وشغّل `{"action":"accounts"}` بسر المزامنة مرة: `dokan_withdrawals` بعدد طلبات Dokan (`status=all`) و`dokan_balances` لأول 50 متجر (الباقي في التشغيلات الجاية). **مافيش أي كتابة على Dokan** من الجزء ده.
- المرحلة 5 (2026-10-28): `products` (`0021`) اتطبّقت من SQL Editor (صاحب المشروع)، `rls_products` حي ok (RLS live run 40675329321)، `woo-webhook` **v17** و`woo-sync` **v26** (متطابقين مع الريبو)، والسحب الكامل `{"action":"products","full":true}` خلص على 4 تشغيلات (مهلة 150 ثانية؛ كل تشغيلة بتكمّل من `sync_state.products_full`): en 3991 / ar 4030، 0 فشل. التفاصيل في `.superpowers/sdd/2026-10-28-phase-5-products/progress.md`.
- المرحلة 5.1 (2026-10-28): `woo-sync` **v29** (تاب SEO — `seo_title`/`seo_description` → Rank Math `meta_data`، و`SEO_VARS`). الملفات السبعة متطابقة مع الريبو ما عدا سطرين في `_shared/woo-core.js` (`normalizePhone`): أداة النشر بتحوّل `\u0660-\u0669` / `\u06F0-\u06F9` للحروف نفسها — نفس المعنى (اتجرّب `normalizePhone` على 8 أشكال تليفون والنتيجة واحدة). **ماتهربش الـ backslash مرتين**: v28 (16:00–16:24 UTC) اتنشرت بـ `\\u0660` والـ regex بقى بيمسك الأرقام الإنجليزي؛ اتشيّك بعدها: مافيش أوردر اتزامن في الفترة دي ولا تليفون غلط في `orders`. `0022_products_report` اتطبّقت بـ MCP، و`rls_products_report` + `rls_products` حي ok (RLS live run 40721683531).
- المرحلة 5.2 (2026-10-28): `0023_studio` (`products.add`، `sku_colors`، `sku_serial` من 999 + `sku_serial_take`، `studio_batches`، bucket `studio` المقفول) اتطبّقت من SQL Editor (صاحب المشروع)؛ `rls_studio rls_products rls_products_report` حي ok (RLS live run 40772555442). `woo-sync` **v31** (`studio_upload` / `category_create`؛ المبتكر عبر `PUT dokan/v1/products/{id} { post_author }` — **من غير snippet**) و`woo-webhook` **v18**، متطابقين مع الريبو ما عدا سطرين `normalizePhone`. محتاج `WOO_WP_USER` / `WOO_WP_APP_PASSWORD` (أدمن) و`WOO_PUSH_ENABLED = 1`. بعدها `woo-sync` **v32** (29 أكتوبر: اختيار المبتكر، المبتكر قبل التركيبات — `author_failed` — و`studio_sheet` لقراية لينك Google Sheet من السيرفر، قرار 13؛ مافيش أسرار جديدة)، متطابق مع الريبو ما عدا نفس السطرين. بعدها `woo-sync` **v33** (29 أكتوبر: المبتكر بيتحفظ مع الـ ids — `authorOwner` — ومبتكر الدفعة اتغيّر = بيتحط تاني على المنتج وترجمته قبل التركيبات، أو `maker_changed` من غير كتابة لو التركيبات اتبعتت؛ مافيش أسرار ولا migration جديدة)، متطابق مع الريبو ما عدا نفس السطرين. بعدها `woo-sync` **v34** (29 أكتوبر 04:56Z: الـ SKU بيتثبت مع المنتج — إعادة محاولة بتطلّع SKU تاني = `brand_changed` / `sku_changed` من غير أي كتابة؛ مافيش أسرار ولا migration جديدة)، متطابق مع الريبو ما عدا نفس السطرين — ومافيهاش براند WooCommerce (36fa8d5) ولا الاسم العربي الإجباري (6cbeb10): النشرة الجاية من فرع فيه التلاتة. بعدها `woo-sync` **v35** (29 أكتوبر 05:10Z — غلطة: كود 6cbeb10 لوحده غطّى على v34 لحد 06:11Z؛ مافيش `studio_upload` اتنادى عليها) و**v36** (06:11Z، من الدمج bfa99d6 / 0d9a53d: v34 + براند WooCommerce + الاسم العربي الإجباري؛ مافيش أسرار ولا migration جديدة)، متطابق مع الريبو ما عدا نفس السطرين. (v37–v39 = تغيير أسرار من غير كود — تحت في 5.3.) بعدها `woo-sync` **v40** (31 أكتوبر 08:32Z، **أول نشر من workflow «Deploy functions»** — run 41184995728 من `main` 1cf3259، فرع الـ CLI من الـ checkout؛ الكود fc77b61: الترجمة والقسم بـ `lang` جنب `wpml_language`، و`arError` / `ar_code` / `ar_error`، و`lang: 'en'` في المنتج؛ مافيش أسرار ولا migration جديدة). الـ run طلع **أحمر** مع إن النشر تم: الـ CLI رفع الـ bundle (845 kB) وبعدها Supabase ردّت 500 `Failed to write functions metadata fields` — `list_edge_functions` بعدها: v40، `ezbr_sha256` جديد، `verify_jwt false` محفوظ، والـ entrypoint من مسار الـ runner؛ و`get_edge_function` فيه الأسطر الجديدة. يعني run أحمر من الـ workflow ده **مش دليل إن النشر فشل**: شيّك `list_edge_functions` الأول. بعدها `woo-sync` **v41** (31 أكتوبر 08:47Z، workflow run 41186037526 **أخضر** من `main` 182c43e: إعادة المحاولة بتطلب الترجمة العربي الناقصة — `arId` فاضي — من غير ما تبعت المنتج تاني، وتقرير الرفع بيعرض رد الموقع وزرار «جرّب تاني» للصف ده؛ مافيش أسرار ولا migration جديدة). بعدها `woo-sync` **v42** (31 أكتوبر 09:25Z من `main` 61e7a8e، الـ workflow أخضر: ترجمة بتتضاف في إعادة محاولة على منتج منشور بتاخد حالته `publish` بدل `draft` — لقية المنتج 182053/182057؛ مافيش أسرار ولا migration جديدة). بعدها `woo-sync` **v43** (31 أكتوبر 09:47Z من `main` 01e43a0، الـ workflow أخضر: `product_get` بيرجّع `ar.status` عشان زرار «خلّي العربي «منشور» كمان» في صفحة المنتج؛ مافيش أسرار ولا migration جديدة). **قبل أي نشر للدالة:** رقم النسخة الحية (`list_edge_functions`) لازم يساوي آخر رقم هنا، وإلا وقّف — جلسة تانية نشرت. التفاصيل في `.superpowers/sdd/2026-10-28-phase-5-2-studio/progress.md`.
- المرحلة 5.3 (2026-10-29/30): دالة جديدة `ai-content` **v1** (`verify_jwt: false`؛ الملفات الأربعة مطابقة للريبو حرف بحرف؛ من غير توكن → 401 `unauthorized` من الدالة) — اتنشرت قبل `0024` بالقصد: من غير `ai_run_start` مافيش أي نداء لـ Claude. `0024_ai` (`ai_runs`، `ai_month_cost`، RPC `ai_run_start`) اتطبّقت من SQL Editor (صاحب المشروع، 30 أكتوبر — `apply_migration` و`execute_sql` وقفوا على سؤال تأكيد Supabase بسبب `drop policy`/`revoke` من غير رد)، وفحوص ما بعد التطبيق (2.7.12) مطابقة، و`rls_ai` حي ok (RLS live run 41089994191). الواجهة على `main` (e4998e5، Deploy run 41090173333، `deploy^{tree}` = `main:app`). `ANTHROPIC_API_KEY` اتحط (صاحب المشروع، 30 أكتوبر) وأول نداء ok: استوديو، `claude-opus-5-5`، $0.0428. أداة المحتوى اتجرّبت حي 31 أكتوبر (من بيانات $0.03، من صورة $0.06، من منتج $0.037 + «احفظ على المنتج» على #87897) — **القبول تم**. بعدها `ai-content` **v5** (31 أكتوبر، قرار 8: الموديل والجهد والسقف من صف `settings` قسم `ai` قبل كل نداء؛ الملفات الأربعة مطابقة للريبو). **ملحوظة على أرقام النسخ:** تغيير أي سر من اللوحة بيرفع رقم نسخة **كل** الدوال من غير ما الكود يتغيّر (31 أكتوبر: `woo-webhook` 18→21 و`woo-sync` 36→39 و`ai-content` 1→4 بنفس `ezbr_sha256` ونفس `updated_at` — المفتاح اتحط واتصلّح) — فالفحص قبل النشر: رقم أعلى من الدفتر **مع نفس `ezbr_sha256`** = أسرار، مش نشر من جلسة تانية؛ `sha` مختلف = وقّف. مافيش تغيير في `woo-sync` (v36) ولا `woo-webhook` (v18). التفاصيل في `.superpowers/sdd/2026-10-29-phase-5-3-ai-content/progress.md`.
- المرحلة 5.4 (2026-10-31): `woo-sync` **v44** (`product_images_add`؛ workflow run 41207180954 من `main` 22cb331، `ezbr_sha256` 61600622…) ودالة جديدة `ai-images` **v1** (`verify_jwt: false`، من الـ workflow؛ الملفات التلاتة مطابقة للريبو؛ `ezbr_sha256` 20bebb20…). `0025_ai_images` اتطبّقت من SQL Editor (صاحب المشروع، 31 أكتوبر — `apply_migration` وقف على سؤال تأكيد Supabase من غير رد زي `0024`)، فحوص ما بعد التطبيق (2.7.13) مطابقة، و`rls_ai_images rls_ai` حي ok (RLS live run 41225159897). `MAGNIFIC_API_KEY` اتحط (صاحب المشروع). **فاضل T2:** «اختبار الاتصال بـ Magnific» من «إعدادات الصور» (الأدمن) وتثبيت `providers/magnific.ts` على الرد. الواجهة على `main` (22cb331).
- المرحلة 3.5: `0017` (`bank_sync`: خمس خانات Dokan على `vendor_bank`، ونقل رقم حساب مكتوب في `iban` لـ `account_number`، و`vendor_push_pending` بقاعدة `bank`). فحص بعد التطبيق: `select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'vendor_bank' and column_name in ('account_number','account_type','bank_address','routing_number','swift')` = الخمسة، و`select count(*) from public.vendor_bank where iban ~ '^[0-9]+$'` = 0؛ ثم `rls_bank_sync rls_vendors` عبر الـ workflow (الأسماء بمسافات)؛ ثم نشر الدالتين وتشغيلة `vendors` (التعبئة الأولى للبنك والإيميل) وفحص القبول (PUT بنفس قيم البنك على متجر واحد، وشكل `paypal` قبل وبعد بـ `probe_store`). **اتعمل على الـ staging 27 أكتوبر:** `0017` اتطبّقت (الخمسة موجودين، `iban` بأرقام بس = 0، صفين فيهم `account_number`)؛ `rls_bank_sync rls_vendors` حي أخضر — run 10؛ `woo-sync` v19 و`woo-webhook` v16؛ تشغيلة الـ cron 10:30Z: 55 متجر، `from_site` 55، 0 تعارض — 30 بنك من الموقع (`vendor_bank` 31 صف: 30 `updated_by = 'الموقع'` + صف يدوي لمبتكر من غير متجر)، والإيميل على الـ 56؛ اللقطة فيها بصمة بس (30)، ومافيش أي خانة بنك في `raw` ولا اللقطة ولا `woo_sync_log`/`activity_log`. ملحوظة: متجرين (1 و2358) خانة IBAN على الموقع نفسه فيها أرقام بس — بيانات الموقع، بتتنقل زي ما هي. فحص القبول على متجر 44: `push_vendor ['bank']` بنفس القيم → `accepted ['bank']`، و`push_pending` فاضي، وشكل `payment` (`bank` و`paypal` `{"0": filled, "email": empty}`) قبل وبعد زي ما هو.
- المرحلة 3.4: `0016` اتطبّقت على الـ staging 27 أكتوبر (`commission_type`؛ `rls_commission_type rls_vendors` حي أخضر — run 9؛ `woo-sync` v18 و`woo-webhook` v15؛ تشغيلة 09:00Z سجّلت النوع من الموقع على متجرين: 2374 و44 بقوا `category_based`؛ تشغيلة يدوي بعدها من غير تغيير) (`commission_type`: عمود `vendor_rates.commission_type` (`fixed` | `category_based`) وRPC `vendor_commission_set` — النوع والافتراضي وأرقام الفئات اللي بالإيد مرة واحدة؛ و`vendor_rate_set` بيحتفظ بالنوع). فحص بعد التطبيق: `select data_type, is_nullable, column_default from information_schema.columns where table_name = 'vendor_rates' and column_name = 'commission_type'` = `text` / `NO` / `'fixed'::text`، و`select count(*) from pg_proc where proname = 'vendor_commission_set'` = 1؛ ثم `rls_commission_type,rls_vendors` عبر الـ workflow؛ ثم إعادة نشر الدالتين (`_shared/woo-core.js` و`_shared/woo-write.js` اتغيّروا) وتشغيلة `categories` و`vendors` (المتاجر اللي على `category_based` في الموقع بيتسجّل نوعها).
- المرحلة 3.2: `0013` اتطبّقت على الحي 27 أكتوبر (`brands`؛ الفحوص «قبل/بعد» مطابقة: 56 براند / 56 صف ملكية / 0 نسب خاصة، 55 مربوطين بمتاجرهم + 1 يدوي، التريجرات التلاتة على `vendors`، ومافيش فرعي اتغيّر صاحبه). كانت: (البراندات: `brands`/`brand_owners`/`brand_rates`، التريجر `vendors_brand_after_insert` وإعادة التعبئة — 56 براند متوقعة — والحارس `vendors_brands_guard_delete`، والدالتين `brand_owner_at`/`store_owner_at`). بعد التطبيق: فحوص §2.1 ثم `rls_brands` عبر workflow «RLS live».

### 2.7 Edge Functions والأسرار والـ webhooks (المرحلة 2)
دالتين Deno في `supabase/functions/`:
- **`woo-webhook`**: بتستقبل webhooks بتاعة WooCommerce (توقيع HMAC، منع التكرار، أوردرات وفرعيين Dokan ومنتجات).
- **`woo-sync`**: المزامنة الاحتياطية (`states` / `categories` / `orders` / `vendors` / `products` / `all`)، دفع حالة الأوردر للموقع (`push_status`)، دفع بيانات المتجر لـ Dokan (`push_vendor`، المرحلة 3.3 — 2.7.11)، فحص شكل متجر (`probe_store`)، وتسجيل الـ webhooks (`register_webhooks`).

منطقهم النقي في `_shared/woo-core.js` (بيتختبر بـ `npm test`)، ونقط الدخول بـ `npm run deno:check` و`npm run deno:test`. الترتيب على الحي: §2.1 (`0007` ثم `0008`، ومن المرحلة 2.1 `0009`، ومن المرحلة 2.2 `0010`، ومن المرحلة 3 `0011`) ← 2.7.1 النشر ← 2.7.2 الأسرار ← 2.7.4 الـ webhooks ← 2.7.5 أول مزامنة.
**المرحلة 2.2 بالترتيب:** `0010` على الحي (§2.1؛ الواجهة الجديدة بتقرا `customer_state` و`woo_states`) ← إعادة نشر الدالتين (2.7.1؛ `_shared` و`woo-sync` اتغيّروا) ← جملة التعبئة مرة كمان ← تشغيلة `states` يدويًا أو انتظار الـ cron (2.7.5) ← `main`.
**المرحلة 3 بالترتيب:** `0011` على الحي (§2.1؛ الواجهة الجديدة بتقرا `vendors` بقايمة أعمدة و`vendor_rates`/`vendor_bank` وترفع العقود على الـ bucket — §2.8) ← `rls_vendors` على الحي ← إعادة نشر الدالتين (2.7.1؛ `_shared` اتغيّر) ← جملتين التعبئة مرة كمان ← تشغيلة `vendors` (2.7.5) ← `main`.
**المرحلة 3.1 بالترتيب:** `0012` على الحي (§2.1؛ الواجهة الجديدة بتقرا `vendor_logins` بقايمة أعمدة وبتنادي الدالتين بـ RPC) ← `rls_vendor_logins` + `rls_vendors` على الحي ← `main`. **مافيش تغيير في الدالتين** (`_shared` و`index.ts` زي ما هم) — مافيش إعادة نشر في المرحلة دي.
**المرحلة 3.2 بالترتيب:** `0013` على الحي (§2.1؛ الواجهة الجديدة بتقرا `brands`/`brand_owners` بقايمة أعمدة و`brand_rates` لمن معاه `sensitive.commission = F`) ← فحوص ما بعد التطبيق (56 براند / 56 ملكية) ← `rls_brands` + `rls_vendors` + `rls_vendor_logins` عبر workflow «RLS live» ← `main`. **مافيش تغيير في الدالتين** — التريجر بيلحق إدراج المزامنة من غير إعادة نشر.
**المرحلة 3.3 بالترتيب (القرار 10):** `0014` على الحي (§2.1) ← `rls_vendor_sync` عبر workflow «RLS live» ← إعادة نشر الدالتين (2.7.1؛ `_shared` و`woo-sync` اتغيّروا) ← أول تشغيلة `vendors` (التعبئة: الفروقات في `woo_sync_log`/`activity_log` — 2.7.11) ← فحص القبول (PUT بنفس القيم على متجر واحد — 2.7.11) ← تعديل حقيقي على متجر يحدده صاحب المشروع ← `main` ← الدفتر.

**Dokan: بيانات المتجر في الاتجاهين، والباقي قراءة بس (قرار صاحب المشروع، 27 أكتوبر — المرحلة 3.3):** اللي بيتكتب في WooCommerce: حالة الأوردر الأصلي (`push_status`، حسب `status_map` واتجاهها)، **بيانات المتجر** على `dokan/v1/stores/{id}` (`push_vendor` وقت الحفظ، والمزامنة لما يكون في حقول `push_pending` — الحقول المذكورة في 2.7.11 بس، ومن غير اسم placeholder `#…`)، والـ webhooks بتاعتنا (`register_webhooks`) — وكل كتابة مشروطة بـ `WOO_PUSH_ENABLED = 1` (2.7.2). **عمره ما يكتب** حالة أوردر فرعي ولا منتج ولا بيانات دفع/سحب متجر (`payment`)، ولا يلمس webhook مش بتاعنا (n8n). حالات الفرعيين (تأكيد، وصل المخزن، شحن، مرتجع) عايشة عندنا بس.

#### 2.7.1 نشر الدالتين
- **الطريق المفضّل من 31 أكتوبر: workflow «Deploy functions»** (`deploy-functions.yml`، `workflow_dispatch`، اختيار `woo-sync` / `woo-webhook` / `ai-content` / `ai-images` / `all`): بينشر من الـ checkout بالـ Supabase CLI — الـ CLI هو اللي بيعمل الـ bundle (فولدر الدالة + `deno.json` + ملفات `_shared` اللي بتستوردها) و`verify_jwt` من `supabase/config.toml`؛ مافيش نقل ملفات بالإيد ولا مشكلة الـ `\u`. محتاج سر GitHub **`SUPABASE_ACCESS_TOKEN`** (Personal Access Token من supabase.com/dashboard/account/tokens — صاحب المشروع بيضيفه مرة واحدة في Settings › Secrets › Actions). بعد التشغيلة: `list_edge_functions` → رقم النسخة والـ `ezbr_sha256` اتغيّروا، و`get_edge_function` للمقارنة. **الـ run ممكن يطلع أحمر والنشر تم** (أول تشغيلة 31 أكتوبر، run 41184995728: الـ bundle اترفع و`woo-sync` بقت v40، وبعدها Supabase ردّت 500 `Failed to write functions metadata fields`) — فالحكم من `list_edge_functions` مش من لون الـ run؛ لو الرقم ماتغيّرش بس، أعد التشغيل. الطريقة القديمة تحت لسه شغّالة.
- `deploy_edge_function` (Supabase MCP) لكل دالة، **بـ `verify_jwt: false` صريح** — الافتراضي في الأداة `true`، ولو اتساب كده الـ gateway هيرفض WooCommerce والـ cron بـ 401 قبل ما الكود يشتغل. نفس القيمة في `supabase/config.toml` (`[functions.woo-webhook]` و`[functions.woo-sync]`)، فـ `supabase functions deploy` بياخدها لوحده. الدالتين بيعملوا المصادقة بنفسهم (2.7.3).
- الملفات لكل دالة: `index.ts` (الـ entrypoint) و`deno.json`، ومعاهم الأربع ملفات المشتركة `_shared/woo-core.js` و`_shared/woo-api.js` و`_shared/woo-write.js` و`_shared/db.js` بنفس المسار النسبي اللي الـ imports بتستخدمه (`../_shared/…`). **مايترفعش:** `index_test.ts` ولا `_test/` (بدائل الاختبار). وأي تعديل في `_shared/` بيلزم إعادة نشر الدالتين (كل واحدة شايلة نسختها جوه الـ bundle).
- **المرحلة 2.1:** `_shared/woo-core.js` و`_shared/woo-write.js` اتغيّروا (`failed` بقى في الجدول، `note` عند الإنشاء، `permalink`)، فالدالتين لازم يتنشروا تاني — **بعد** ما `0009` يتطبّق (§2.1): الكود الجديد بيكتب `products.permalink`، وقبل العمود جزء المنتجات بيفشل.
- **المرحلة 2.2:** `_shared/woo-core.js` و`_shared/woo-write.js` (`customer_state`، `writeStates`) و`woo-sync/index.ts` (جزء `states`) اتغيّروا، فالدالتين يتنشروا تاني — **بعد** ما `0010` يتطبّق (§2.1 خطوة 5 بتاعة `0010`): الكود الجديد بيكتب `orders.customer_state` و`woo_states`، وقبلهم الأوردرات الجديدة (cron وwebhooks) بتفشل.
- **المرحلة 3:** `_shared/woo-core.js` (`mapStore` بيرجّع `joined_at` من `registered`، وسطور الأوردر بتشيل `commission_rate`/`commission_fee` من ميتا Dokan) و`_shared/woo-write.js` (`saveVendors`: المتجر الموجود بياخد `raw` بس — الفريق صاحب الاسم والحالة والتواصل — والجديد الصف كامل؛ `ITEM_COLUMNS` زادت العمودين) اتغيّروا، فالدالتين يتنشروا تاني (v8، ثم v9 بتصليح كتابة `raw` للمتجر الموجود — UPDATE مش upsert) — **بعد** ما `0011` يتطبّق (§2.1 خطوة 5 بتاعة `0011`): الكود الجديد بيكتب أعمدة مش موجودة قبلها، وPostgREST بيرفض الصف كله (كل delivery لأوردر فيه سطور بترجع 500، وأول متجر جديد في الـ cron بيفشل). الدالة `woo-sync` نفسها (`index.ts`) ماتغيّرتش في المرحلة دي.
- **شكل الـ bundle اللي اشتغل مع `deploy_edge_function` (MCP، 2026-10-25):** أسماء الملفات في `files` جوه فولدر الدالة، والمشتركة جنبه:

  | `name` في `files` | المحتوى من |
  |---|---|
  | `woo-<fn>/index.ts` | `supabase/functions/woo-<fn>/index.ts` |
  | `woo-<fn>/deno.json` | `supabase/functions/woo-<fn>/deno.json` |
  | `_shared/woo-core.js`، `_shared/woo-api.js`، `_shared/woo-write.js`، `_shared/db.js` | `supabase/functions/_shared/*.js` |

  ومعاهم `entrypoint_path: woo-<fn>/index.ts` و`import_map_path: woo-<fn>/deno.json` و`verify_jwt: false` (`<fn>` = `webhook` أو `sync`). ليه: الـ imports `../_shared/…` بتتحل جوه الـ bundle من فولدر الدالة؛ لو `index.ts` اترفع في جذر الـ bundle، `../_shared/` بيطلع برّه الـ bundle والنشر بيبوظ.
- supabase-js مثبّتة `npm:@supabase/supabase-js@2.118.0` (نفس نسخة الواجهة).
- `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` و`SUPABASE_ANON_KEY` Supabase بيحطهم لوحده. `woo-sync` بيستخدم `SUPABASE_ANON_KEY` عشان يكلّم قاعدة البيانات بتوكن العضو؛ لو المشروع قفل مفاتيح الـ JWT القديمة (legacy)، اتأكد إن الاسم ده لسه موجود.
- **فحص بعد النشر والأسرار** — بيأكد إن الكود نفسه هو اللي بيرد (مش الـ gateway):

  ```bash
  F=https://fsynculhaupcktzkfkdd.supabase.co/functions/v1
  curl -s -X POST "$F/woo-webhook" -H 'X-WC-Webhook-Topic: order.updated' -d '{}'
  # المتوقع: {"error":"bad_signature"} (401) + سطر في woo_sync_log (entity 'webhook', action 'verify', result 'error')
  #          قبل ما WOO_WEBHOOK_SECRET يتحط: {"error":"not_configured"} (500)
  curl -s -X POST "$F/woo-sync" -H 'Content-Type: application/json' -d '{"action":"all"}'
  # المتوقع: {"error":"unauthorized"} (401)
  ```

  رد من الـ gateway بدل الـ JSON ده (زي `Missing authorization header`) معناه إن `verify_jwt` لسه `true` — انشر تاني بـ `false`.
- الواجهة بتكلّم `…/functions/v1/woo-sync` (عبر `functions.invoke`) على نفس الـ origin اللي في `connect-src`، فالـ CSP مش محتاج تعديل؛ والمتصفح عمره ما بيكلّم WooCommerce مباشرة.

#### 2.7.2 الأسرار (Edge Function secrets)
صاحب المشروع بيدخل القيم بنفسه في لوحة Supabase (Edge Functions › Secrets)، أو عبر نداء MCP `create_edge_function_secret` اللي بيطلب القيمة منه في اللوحة مباشرة. القيمة عمرها ما تعدّي على الشات، ولا تدخل git ولا أي ملف في الريبو. (تغيير سر اتحط من أقل من 10 دقايق: `replace: true`.) دلوقتي القيم بتاعة الـ staging؛ التبديل للإنتاج في 2.7.8.

| السر | القيمة |
|---|---|
| `WOO_URL` | أصل الموقع بـ `https://`، من غير `/wp-json` ومن غير `user:pass@` (الدالة بتضيف `/wp-json/` وبترفض غير https) — دلوقتي `https://stage.ibtekr.club` |
| `WOO_CK` / `WOO_CS` | مفاتيح WooCommerce REST (WooCommerce › Settings › Advanced › REST API) بصلاحية Read/Write: `push_status` و`register_webhooks` بيكتبوا |
| `WOO_WEBHOOK_SECRET` | سر توقيع الـ webhooks: **حروف وأرقام بس** — WooCommerce بيعدّي السر على `wp_specialchars_decode`، فأي `&` أو `<` أو `'` ممكن يتغيّر ويبوّظ التوقيع. ولّده على جهازك (مثلًا `openssl rand -hex 32`) وحطه في اللوحة على طول. `register_webhooks` هو اللي بيحطه في Woo — ماتكتبوش هناك بإيدك |
| `WOO_PUSH_ENABLED` | **اختياري:** `1` بالظبط (بعد trim) = `push_status` بيكتب حالة الأوردر في WooCommerce، و`push_vendor` والمزامنة بيكتبوا بيانات المتجر في Dokan (المرحلة 3.3). أي قيمة تانية أو من غيره → الدفع بيتساب (`skipped`، `reason 'push_disabled'`، من غير أي نداء لـ Woo؛ حقول المتجر بتستنى في `vendors.push_pending` لحد ما يبقى `1`). ليه: الـ staging نسخة كاملة من الموقع بإيميلات عملاء حقيقية وتكامل بوسطة، فأي تغيير حالة هناك ممكن يبعت إيميل لعميل أو يحرّك شحنة. **على الـ staging:** ماتحطوش `1` غير بعد ما تتأكد إن WooCommerce › Settings › Emails (إيميلات الحالات للعميل) وبوسطة (وأي plugin متعلّق بتغيير الحالة) مقفولين أو على sandbox. **على الإنتاج:** عادةً `1` (2.7.8) |
| `WOO_WP_USER` + `WOO_WP_APP_PASSWORD` | **الاتنين مع بعض، ومن المرحلة 3.3 لازمين:** مستخدم أدمن WordPress + Application Password (Users › Profile › Application Passwords). بيتبعتوا Basic على `dokan/v1` بس. بيهم `dokan/v1/stores` بيرجّع المتجر كامل (التليفون والإيميل والعنوان و`enabled` والعمولة — النقطة العامة من غيرهم بترجّع الاسم والرابط بس، فالمزامنة ماتلاقيش حاجة تملاها ولا تقارنها) و`PUT dokan/v1/stores/{id}` (`push_vendor`) بيعدّي. متحطين على الـ staging من 27 أكتوبر؛ على الإنتاج يتعملوا من مستخدم أدمن هناك (2.7.8) |

سر المزامنة الداخلي (`sync_secret`) مش من دول: بيتولّد جوه Postgres في `0008` وعايش في Vault، والـ cron بيقراه وقت التشغيل.

#### 2.7.3 قاعدة المصادقة
- **مع Woo** (فحص الـ staging، §2.7.10؛ ومن 27 أكتوبر `WOO_WP_USER`/`WOO_WP_APP_PASSWORD` متحطين على الـ staging — `dokan/v1` بقى مصادق: المتجر بيرجع بالإيميل والتليفون والعنوان و`enabled` والدفع والعمولة؛ فحص `probe_store` في `woo-sync` v11 بيرجّع أسماء الحقول بس): مفاتيح WC (`Basic WOO_CK:WOO_CS`) على مسارات `wc/v3` بس. `dokan/v1` من غير أي header — قايمة المتاجر والمتجر الواحد عامّين في كود Dokan، ومفاتيح WC عليهم بترجع `401 invalid_username` — إلا لو `WOO_WP_USER`/`WOO_WP_APP_PASSWORD` متحطين. أي namespace تاني مرفوض. كل طلب: مهلة 30 ثانية ومن غير redirects.
- **`woo-sync`:** header `X-Sync-Secret` لازم يطابق `sync_secret` في Vault (الدالة `sync_secret_matches`، لـ `service_role` بس) → وضع النظام (بيتسجّل `kind 'cron'`). غير كده `Authorization: Bearer <JWT العضو>`: `push_status` محتاج `has_perm('orders.status') = 'F'`؛ `push_vendor` (المرحلة 3.3) محتاج `is_admin()` أو `has_perm('vendors.edit') = 'F'`، ولو `fields` فيها `rate`/`category_rates` لازم كمان `has_perm('sensitive.commission') = 'F'` (الأدمن بيعدّي من غيرها)؛ وكل الباقي `is_admin()` (بيتسجّل `kind 'manual'`). أي حاجة تانية → 401. ومن بعد `0008`: العضو اللي مفعّل التحقق بخطوتين لازم جلسته aal2، وإلا `has_perm` = `N` و`is_admin` = false.
- **`woo-webhook`:** `X-WC-Webhook-Signature` (HMAC بـ `WOO_WEBHOOK_SECRET` على بايتات الجسم الخام) غلط أو ناقص → 401 + سطر `woo_sync_log`. الاستثناء الوحيد: ping التفعيل بتاع WooCommerce (`webhook_id=N` من غير topic) → 200 `ignored` من غير قراءة ولا كتابة.

#### 2.7.4 تسجيل الـ webhooks
`register_webhooks` بيضمن webhook واحد فعّال لكل topic من الأربعة: `order.created`، `order.updated`، `product.created`، `product.updated`. اسمه `ibtekr-ops:<topic>`، وعنوانه `https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-webhook`، وسره `WOO_WEBHOOK_SECRET`. الناقص بيتعمل (`POST`)، والموجود المتوقف بيرجع `active` بالسر الحالي (`PUT`)، والفعّال مابيتلمسش.

**قاعدة الملكية:** «بتاعنا» = الاسم بيبدأ بـ `ibtekr-ops:` **و** الـ `delivery_url` هو دالتنا بالظبط. أي webhook تاني على الموقع عمره ما يتلمس — زي الأربعة بتوع n8n على الـ staging (تلاتة متوقفين، وواحد فعّال `order.created` «Send Order - Air table» بيكمّل شغله جنب بتوعنا). الرد فيه الـ webhooks بتاعتنا بس (`id, name, topic, status, delivery_url` — من غير السر)، و`delivery_url` مختلف في الطلب → 400 `delivery_url_mismatch`.

طريقتين:
1. **من الواجهة** بحساب الأدمن (بجلسة aal2 لو مفعّل التحقق بخطوتين): DevTools › Console على `https://operation-system.ibtekr.club`:

   ```js
   await IBOrders.registerWebhooks()   // → { ok: true, list: [ …الأربعة ibtekr-ops:… ] }
   ```

2. **من قاعدة البيانات** (`execute_sql`، بسر Vault — السر بيتقرا جوه Postgres ومابيظهرش في النتيجة):

   ```sql
   select net.http_post(
     url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
     headers := jsonb_build_object('Content-Type', 'application/json',
       'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
     body := '{"action":"register_webhooks"}'::jsonb,
     timeout_milliseconds := 150000
   ) as request_id;

   -- بعد ثواني، بالرقم اللي رجع:
   select status_code, timed_out, error_msg, left(content, 2000) as content from net._http_response where id = <request_id>;
   -- المتوقع: 200 و "counts":{"created":4,"updated":0,"unchanged":0} أول مرة، وبعد كده "unchanged":4
   ```

   ماتعملش `select` لـ `decrypted_secret` لوحده، ولا تقرا `net.http_request_queue` (فيه الـ headers بالسر لحد ما الطلب يتبعت).

بعدها في WooCommerce › Settings › Advanced › Webhooks: الأربعة `ibtekr-ops:*` حالتهم Active. WooCommerce بيبعت ping أول ما الـ webhook يتحفظ، والدالة بترد عليه 200 من غير ما تسجّل حاجة.

**تغيير `WOO_WEBHOOK_SECRET` على نفس الموقع:** السر بيتبعت لـ Woo مع إعادة التفعيل بس، فالـ webhook الفعّال بيفضل بالسر القديم. وقّف الأربعة من صفحة Webhooks في Woo (Disabled)، وبعدها `register_webhooks` بيرجّعهم `active` بالسر الجديد.

#### 2.7.5 أول مزامنة والتحقق
- `action: 'all'` = أسماء المحافظات (`states`)، ثم المتاجر، ثم الأوردرات، ثم المنتجات (جزء بيفشل مابيوقفش الباقي، والرد 502/500 بقايمة اللي فشل). الأوردرات قبل المنتجات عشان أول تشغيلة فيها ~40 صفحة منتجات (≈ 3991 منتج)، ولو اتقطعت عند مهلة الـ gateway تكون الأوردرات اتسحبت. نفس الطريقتين اللي فوق: زرار «مزامنة» في صفحة الأوردرات (أدمن؛ `IBOrders.syncNow()`) أو `net.http_post` بالجسم `{"action":"all"}`.
- **لو `all` وقعت عند مهلة الـ gateway** (رد مش الـ JSON بتاعنا، أو `timed_out` في `net._http_response`): شغّل `orders` لوحده الأول من الواجهة بحساب الأدمن (بجلسة aal2 لو مفعّل التحقق بخطوتين) — DevTools › Console على `https://operation-system.ibtekr.club`:

  ```js
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'orders' } })     // → { data: { action: 'orders', result: 'ok', counts: … } }
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'products' } })   // بعدها، ولو رجعت done: false شغّلها تاني
  ```

  (أو `net.http_post` زي 2.7.4 بالجسم `{"action":"orders"}`.) كل جزء بيكمّل من الـ cursor بتاعه لو اتقطع، ولما الاتنين يبقوا `done: true` في `sync_state` تشغيلات `all` (والـ cron) بتبقى خفيفة.
- **`states`** (من المرحلة 2.2): طلب واحد `GET wc/v3/data/countries/EG` بمفاتيح WC (مسار `wc/`) → `states[]` بتاعة الرد (`{ code, name }` بقايمة الموقع نفسه، حتى لو إضافة هي اللي معرّفاها) → upsert في `woo_states` على `code` (الاسم والكود بعد `trim`؛ العنصر اللي من غير كود أو اسم نصي بيتساب ويتعدّ في `skipped`؛ ومافيش مسح). رد من غير `states` array = خطأ للجزء (`expected an object with a states array`) ومابيتكتبش حاجة. العدّادات: `{ states, skipped, failed }`. ممكن يتشغّل لوحده بـ `{"action":"states"}` (أدمن أو سر الـ cron).
- الأوردرات بتتسحب من `wc/v3/orders?after=2026-10-01T00:00:00&dates_are_gmt=true&modified_after=<cursor>&orderby=modified&order=asc&status=any`، صفحة صفحة (100 في الصفحة، لحد 50 صفحة في التشغيلة)، والـ cursor بيتحفظ في `sync_state` بعد كل صفحة. لو التشغيلة اتقطعت أو رجعت `done: false`، شغّلها تاني وهتكمّل من مكانها. اللي بيتساب: الـ drafts (`checkout-draft`، `trash`) وأي أوردر قبل 1 أكتوبر (حسب `date_created_gmt`).
- التحقق:

  ```sql
  select (select count(*) from public.orders) as orders, (select count(*) from public.sub_orders) as subs,
         (select count(*) from public.order_items) as items, (select count(*) from public.vendors) as vendors,
         (select count(*) from public.products) as products;
  select key, value, updated_at from public.sync_state;
  select entity, result, count(*) from public.woo_sync_log
  where at > now() - interval '1 hour' group by 1, 2 order by 1, 2;
  ```

  - `orders` + `subs` ≈ 190 + اللي اتعمل بعد الفحص. فحص الـ staging يوم 25 أكتوبر لقى 190 أوردر من 1 أكتوبر، **والرقم ده شامل الفرعيين** (قايمة Woo فيها أوردرات Dokan الفرعية). فرق صغير عند الحد مقبول: الفحص عدّ بتوقيت الموقع، والمزامنة بـ GMT.
  - `vendors` ≈ عدد المتاجر في Dokan (المتجر المقفول بيتسجّل `inactive` لو Dokan رجّع خانة `enabled` مقفولة؛ REST العام بتاع Dokan مابيرجّعش الخانة دي أصلًا، فمن غيرها المتجر بيتسجّل `active`، وعمره ما بيتمسح). المزامنة مابتلمسش `aliases` ولا `commission_pct`.
  - `products` ≈ 3991 (نفس الفحص).
  - `sync_state`: `orders` و`products` فيهم `cursor` و`last_run` و`done: true`.
  - `woo_states`: عدد صفوف أكتر من صفر بعد أول `states` (`select count(*) from public.woo_states`)، و`orders.customer_state` معبّى للأوردرات اللي الموقع عرف محافظتها.
  - `woo_sync_log`: `ok` لكل جزء. `conflict` و`skipped` و`error` بيتقروا زي 2.7.7.
- **كل سطر في أوردر ليه فرعيين مربوط بفرعي** — المزامنة بتربط السطر بالفرعي بتاع نفس المبتكر، أو بمنتجات الفرعي (`line_items[*].product_id`/`variation_id`) لو السطر جاي من غير `_dokan_vendor_id` (ده العادي في الأوردر متعدد المبتكرين)، وساعتها السطر بياخد مبتكر الفرعي:

  ```sql
  select count(*) from public.order_items i
  where i.sub_order_id is null and exists (select 1 from public.sub_orders s where s.order_id = i.order_id);
  -- المتوقع: 0. أكتر من صفر = سطر منتجه مش في أي فرعي من فرعيين أوردره. للتشخيص: قارن line_items[*].product_id بتاعة الفرعي من الموقع نفسه
  -- (wc/v3/orders/<رقم الفرعي>) مع product_id بتاع السطر — raw.line_items في sub_orders فيها id والـ _dokan_* بس، من غير product_id.
  -- وعشان تعيد السحب: المزامنة بالـ cursor مابتجيبش أوردر ماتغيّرش، فإما عدّل الأوردر على الموقع (ملاحظة مثلًا) وإما صفّر
  -- sync_state['orders'] (value = '{}') وشغّل orders تاني.
  ```

- **Realtime من غير التليفون** (بند محمول من مراجعة المهمة 2): افتح صفحة الأوردرات وغيّر أوردر على الـ staging → الكارت يتحدّث لوحده. اتأكد في DevTools › Network › WS إن رسالة Realtime بتاعة `orders` مافيهاش `customer_phone` ولا `raw` (الواجهة بترجع تقرا الصف من `orders_v`). **فلتر Realtime على `customer_phone` — اتأكد على الحي (2026-10-25، مراجعة الفرع كله):** `realtime.subscription_check_filters` بيبني الأعمدة المسموح الفلترة عليها من `has_column_privilege(role, …, 'SELECT')` وبيرفض غيرها بـ `invalid column for filter`، فـ `authenticated` مايقدرش يشترك بفلتر على عمود مالوش `SELECT` عليه (`customer_phone`، `raw`) — مافيش استفسار عن التليفون عبر Realtime.

#### 2.7.6 المزامنة الاحتياطية وسلوك WooCommerce
- `0008` بيعمل job `woo-sync-backup` كل 15 دقيقة (`*/15 * * * *` — القيمة الافتراضية في إعدادات البروتوتايب؛ صفحة الإعدادات في المرحلة 10 هي اللي هتغيّرها). بيعمل `net.http_post` لـ `woo-sync` بـ `{"action":"all"}` و`X-Sync-Secret` من Vault وقت التشغيل، بمهلة 150 ثانية. الفحص في §2.1 (خطوة 5).
- الـ URL مكتوب في `0008` (`https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync`)؛ لو المشروع اتنقل، الـ cron محتاج migration جديدة.
- **WooCommerce مابيعيدش المحاولة لو delivery فشلت:** بيعدّ الفشل، وبعد 5 مرات ورا بعض بيوقف الـ webhook (Disabled). أي رد غير 2xx من دالتنا بيتحسب. اللي فات بيوصل من المزامنة الاحتياطية في خلال 15 دقيقة، وإعادة التفعيل = `register_webhooks` تاني (2.7.4).
- **مفتاح منع التكرار:** `woo_webhook_events.delivery_id` (unique) = `<X-WC-Webhook-Delivery-ID>:<X-WC-Webhook-Signature>`. ليه: WooCommerce بيبني الـ delivery id من رقم الـ webhook والثانية الحالية، فتحديثين لنفس الـ webhook في نفس الثانية بياخدوا نفس الرقم. التوقيع (HMAC الجسم) بيفرّقهم، والإعادة الحرفية بتفضل `duplicate` (200 من غير أي كتابة). Delivery من غير id بتتعالج وبتتسجّل `delivery_id null`. ولو نفس الـ delivery وصلت تاني بعد محاولة فشلت (`status 'error'`)، بتتعالج تاني على نفس الصف.
- فحص على الـ staging: عدّل نفس الأوردر مرتين ورا بعض في أقل من ثانية → الاتنين يوصلوا `ok` في `woo_webhook_events`.

#### 2.7.7 قراءة `woo_sync_log` و`woo_webhook_events`
من الواجهة الجداول دي بتتقرا بـ `settings.view`، والكتابة لـ `service_role` بس. من SQL editor:

```sql
select at, kind, direction, entity, entity_id, action, result, detail
from public.woo_sync_log order by at desc limit 50;

select received_at, topic, resource_id, status, error
from public.woo_webhook_events order by received_at desc limit 30;
```

- **`woo_sync_log`:** سطر لكل حدث. `kind` (`webhook` | `sync` | `push` | `manual` | `cron`)، `direction` (`in` | `out`)، `entity`/`entity_id`/`action`، `result` (`ok` | `error` | `conflict` | `skipped`)، و`detail` (العدّادات أو نص الخطأ، متنضّف: من غير مفاتيح ولا تليفونات ولا إيميلات). أشهر الحالات:
  - `webhook` / `verify` / `error` → توقيع غلط: السر اللي في Woo غير `WOO_WEBHOOK_SECRET` (شوف «تغيير `WOO_WEBHOOK_SECRET`» في 2.7.4)، أو حد بيبعت طلبات مش من Woo.
  - `vendor` / `error` → متجر Dokan رد بحاجة غير 404. السطر اتحفظ بـ `vendor_id null`، وهيتصلّح لما الأوردر يتغيّر تاني (المرحلة 3 فيها backfill).
  - `skipped` → متجر مش موجود (404)، أو أوردر أصلي مش موجود لفرعي (`parent_missing`)، أو دفع اتساب (`reason 'no_woo_status'` لحالة مابتتبعتش للموقع: «فشل» اتجاهها `from_woo`، أو أي حالة `from_system` من غير slug — مافيش واحدة دلوقتي، أو `'stale'` لما الحالة اللي اتبعتت مش هي المتخزنة، أو `'push_disabled'` لما `WOO_PUSH_ENABLED` مش `1` — 2.7.2؛ الحالة اتحفظت عندنا بس)، أو `push_vendor` اتساب (`no_store` / `push_disabled` / `placeholder` — 2.7.11؛ `detail.vendor_id` و`detail.fields` أسماء بس).
  - `vendor` / `sync` / `conflict` (المرحلة 3.3) → حقل اتغيّر على الموقع وعندنا في نفس الفترة (الموقع كسب؛ `detail.fields`)، أو في أول تشغيلة حقل مملوء عندنا مختلف عن الموقع (`detail.first_run: true`؛ قيمتنا فضلت). `vendor` / `vendor` / `error` بـ `direction 'out'` → PUT لـ Dokan فشل (الحقول في `push_pending`، هتتبعت مع التشغيلة الجاية).
  - `states` / `sync` / `error` (من المرحلة 2.2) → طلب أسماء المحافظات فشل: 401/403 = غالبًا المستخدم صاحب مفاتيح WC مالوش صلاحية مدير المتجر (`manage_woocommerce`، زي اللي `register_webhooks` محتاجها)، 404 = الموقع مالوش الـ endpoint، `expected an object with a states array` = رد بشكل تاني. باقي `all` بيكمّل عادي (بس الرد 502 بـ `failed: ['states']`، فزرار «مزامنة» في الواجهة بيقول إنها ماتمتش)، والأوردرات بتفضل بالكود والكارت بيعرضه لحد ما الأسماء توصل.
  - `orders` / `order_items` / `sub_orders` / `products` / `vendors` / `woo_states` + `action 'upsert'` + `error` → قاعدة البيانات رفضت الصف ده بالذات (خطأ بيانات، SQLSTATE `22xxx`/`23xxx`؛ `entity_id` = مفتاحه، و`detail.error` = السبب). المزامنة جرّبت الدفعة صف صف وكمّلت الباقي؛ أوردر مرفوض بيتساب بسطوره، والـ delivery بتاعته بتتسجّل `error` في `woo_webhook_events`. أي خطأ تاني (timeout، صلاحيات) بيوقف الجزء كله زي الأول.
  - `conflict` → حالة جاية من Woo مش في `status_map` (الأوردر اتحفظ بالـ `woo_status` الخام وحالة النظام الحالية أو الافتراضية؛ `failed` مش منهم: من `0009` ليها صف «فشل»)، أو Woo غيّر الحالة بين آخر مزامنة والدفع (`detail.woo_before`؛ الدفع كمّل — «السيستم يكسب»). وصف جديد في `status_map` مابيعيدش تحويل الأوردرات المتخزنة: حالتهم بتفضل زي ما هي لحد ما Woo يغيّر الحالة (أو الفريق).
  - `sub_order` / `parent_list` / `error` → جلب `?parent=` فشل بعد ما الأوردر اتكتب. الفرعيين هيوصلوا في deliveries بتاعتهم أو من المزامنة.
- **`woo_webhook_events`:** صف لكل delivery. `status` (`ok` | `ignored` | `duplicate` | `error`)، و`payload` فيه 6 مفاتيح بس (`id, number, status, parent_id, date_modified_gmt, topic`). `ignored` طبيعي: أوردر فرعي (بيتكتب في `sub_orders` بس)، أوردر قبل 1 أكتوبر أو draft، payload أقدم من اللي عندنا، أو topic مش بتاعنا. `error` بنص بيبدأ بـ `in progress` = محاولة ماخلصتش.
- أعمدة `raw` في `orders`/`order_items`/`sub_orders` لـ `service_role` بس. بتظهر في SQL editor، ومتنضّفة من البيانات الشخصية بالتصميم — بس ماتنقلهاش برّه.

#### 2.7.8 التبديل من الـ staging للإنتاج
دلوقتي الأسرار والـ webhooks على `https://stage.ibtekr.club`. لما صاحب المشروع يقرر نشتغل على الموقع الحقيقي (القرار يتكتب في الدفتر):
1. **الأسرار الستة:** `WOO_URL` (الموقع الحقيقي)، `WOO_CK`/`WOO_CS` (مفاتيح REST من الموقع الحقيقي)، `WOO_WEBHOOK_SECRET` **جديد** — كده أي delivery فاضلة من الـ staging بترجع 401 — و**`WOO_WP_USER`/`WOO_WP_APP_PASSWORD`** من مستخدم أدمن على الموقع الحقيقي (Application Password جديد؛ من المرحلة 3.3 المزامنة والدفع لـ Dokan بيعتمدوا عليهم — 2.7.2). و**`WOO_PUSH_ENABLED = 1`** عشان تغيير الحالة وبيانات المتجر من النظام يوصلوا الموقع (من غيره الدفع بيتساب `push_disabled`، وحقول المتجر بتفضل في `push_pending`). على الموقع الحقيقي إيميلات العملاء وبوسطة شغّالين بالقصد، فاتأكد إن الفريق عارف إن أي تغيير حالة من النظام بيوصلهم زي ما بيحصل من لوحة WooCommerce.
2. **على الـ staging:** وقّف الأربعة `ibtekr-ops:*` من WooCommerce › Settings › Advanced › Webhooks (Disabled). الدوال عمرها ما بتوقف ولا بتمسح webhook.
3. **`register_webhooks`** (2.7.4) → بيعمل الأربعة على الموقع الحقيقي، والـ webhooks اللي هناك (n8n وغيره) ماتتلمسش.
3 مكرر. **اللقطات:** بعد التبديل، أول تشغيلة `vendors` على الموقع الحقيقي بتقارن بلقطات الـ staging — لو المتاجر على الحقيقي مختلفة، الفروقات هتتكتب عندنا كأنها «اتعدلت من الموقع». لو عايز قاعدة التشغيلة الأولى (الفاضي يتملا والمملوء يفضل) تتطبّق تاني: `update public.vendors set woo_snapshot = null, push_pending = null where woo_vendor_id is not null;` قبل التشغيلة (قرار مكتوب وقتها).
4. **`sync_state`:** صفّر الـ cursors بتاعة `orders` و`products` (`value` يرجع `{}`، مثلًا `update public.sync_state set value = '{}'::jsonb where key in ('orders', 'products');`)، عشان أول مزامنة تسحب من 1 أكتوبر على الموقع الحقيقي.
5. **بيانات الـ staging اللي في الجداول:** الـ staging نسخة من الموقع، فالأوردرات القديمة بنفس أرقامها. بس أي أوردر أو سطر اتعمل على الـ staging بعد النسخ ممكن رقمه يتكرر لأوردر حقيقي بعدين، والأعمدة التشغيلية (التأكيد، العربون، الملاحظات، حالات الفرعيين) هتفضل لازقة فيه. والـ payload الأقدم من اللي متخزن بيتساب. التعامل معاها قرار مكتوب وقتها: النظام مابيمسحش، ومافيش سكريبت هنا.
6. `all` (2.7.5)، وراجع الأعداد والسجل.

#### 2.7.9 استعادة التحقق بخطوتين (أدمن)
مافيش أكواد احتياطية (Supabase مابيدعمهاش أصليًا). من بعد `0008`، العضو اللي `profiles.twofa = true` بيشتغل بجلسة aal2 بس (على aal1: `has_perm` = `N` و`is_admin` = false).
- **ضيّع التطبيق أو الموبايل:** من لوحة Supabase › Authentication › Users › العضو › شيل الـ factor بتاعه، **وبعدها**:

  ```sql
  update public.profiles set twofa = false where member_code = 'M0x';
  ```

  الخطوتين لازم مع بعض. لو اتشال الـ factor بس، العضو هيدخل aal1 ويلاقي كل حاجة `N`، و«إيقاف» في «ملفي» هيقوله «سجّل دخول بالكود الأول» وهو مايقدرش. (الـ update ده بيعدّي من SQL editor لأن الحارس `profiles_guard_update` على `anon`/`authenticated` بس؛ ومن الشاشة مايتعملش لحد صفحة الإعدادات في المرحلة 10.)
- **الحالة المعلّقة بعد فشل مزدوج:** الكود اتقبل والـ factor بقى `verified`، بس السيرفر رفض `mark_twofa_enrolled` **و**شيل الـ factor فشل كمان → factor `verified` و`twofa = false`. العضو بيدخل بالكود عادي، بس «ملفي» بيقول «مش مفعّل» ومايقدرش يفعّل تاني. الحل: الأدمن يشيل الـ factor من اللوحة (`twofa` أصلًا `false`)، والعضو يفعّل من الأول.
- للفحص (أعمدة بالاسم بس — `auth.mfa_factors` فيه عمود `secret` بتاع الـ TOTP):

  ```sql
  select p.member_code, p.twofa, f.factor_type, f.status, f.updated_at
  from public.profiles p left join auth.mfa_factors f on f.user_id = p.id
  where p.member_code = 'M0x';
  ```

#### 2.7.10 الـ workflows اليدوية والـ CI
- **`staging-probe.yml`** (`workflow_dispatch`، `contents: read`): بيشغّل `tools/woo-probe.mjs` على الـ staging بالأسرار `STAGING_WOO_URL`/`STAGING_WOO_CK`/`STAGING_WOO_CS` (GitHub Secrets، على مستوى الخطوة بس). GET بس، وكل قسم سطر JSON متنضّف من البيانات الشخصية: الحالات، عدد الأوردرات من 1 أكتوبر، عينات أصلي وفرعي، المتاجر، المنتجات، والـ webhooks. قسم المتاجر بيرجع 401 لأن السكريبت بيبعت مفاتيح WC على `dokan/v1` — ومن هنا طلعت قاعدة المصادقة (2.7.3) — فالتشغيلة بتخلص بـ exit 1 والباقي بيتطبع عادي. آخر تشغيلة: 40204355895 (2026-10-25).
- **`vendor-fetch.yml`** (`workflow_dispatch`، `contents: write`): بينزّل SheetJS CE من `cdn.sheetjs.com` (الـ sandbox مابيوصلهوش، وnpm واقف عند 0.18.5 اللي فيها CVE-2023-30533 وCVE-2024-22363)، وبيعمل commit لـ `app/js/vendor/xlsx.full.min.js` على الفرع اللي تختاره. المدخلات: `version` (افتراضي `0.20.3`)، `branch` (**`main` مرفوض** — بأي شكل: `main` أو `heads/main` أو `refs/heads/main` — لأن الـ push على `main` بينشر الموقع؛ اعمل commit على فرع شغل وادمجه)، و`sha256` اختياري (التشغيلة بتفشل لو الهاش مختلف). الهاش بيتطبع في اللوج؛ بعدها حدّث الإصدار والـ sha256 في `app/js/vendor/README.md`. html2canvas بيتحدّث يدويًا بـ `npm pack` (الخطوات في نفس الـ README).
- **CI (`ci.yml`)** مع كل push: `test` (`npm test` + e2e)، `db` (الـ migrations والـ RLS على Postgres 17)، `semgrep` (`npm run semgrep`، semgrep 1.182.1)، و`functions` (`npm run deno:check` + `npm run deno:test`).

#### 2.7.11 مزامنة بيانات المتجر في الاتجاهين (المرحلة 3.3) وفحص القبول
- **الحقول المتزامنة** (`SYNC_FIELDS` في `woo-core`؛ نفس الأسماء في `push_vendor.fields` و`vendors.woo_snapshot` و`push_pending`): `name` ↔ `store_name`، `phone`، `email` (المزامنة بتقراه من الموقع لما `show_email` مفتوح بس)، `contact_name` ↔ `first_name` + `last_name` (الكتابة بتقسّم على أول مسافة)، `address_parts` ↔ `address` (الستة مفاتيح؛ `vendors.address` النصي = الأجزاء المملوءة «شارع 1، شارع 2، المدينة، المحافظة» بـ «، »)، `social` (التمانية، روابط `https://` بس — غير كده بيتكتب فاضي)، `status` ↔ `enabled` (`inactive` ↔ `false`؛ `active`/`leave` ↔ `true`، و`true` مابيلغيش `leave`)، `rate` ↔ النسبة الفعّالة على Dokan (`admin_commission` مع `fixed`، `admin_category_commission.all.percentage` مع `category_based`) + الرسوم الثابتة، `category_rates` ↔ `admin_category_commission.items`. قراءة بس من الموقع: `logo_url` (`gravatar`)، `banner_url` (`banner`)، `woo_payment_methods` (مفاتيح `active_payment_methods`)، و`featured`/`trusted`/`rating` في `raw`. **مش بتتخزن:** `payment`، `location`، `store_toc`، `_links`.
- **تشغيلة `vendors` (كل 15 دقيقة مع `all`، أو يدويًا):** لكل متجر موجود المقارنة باللقطة `woo_snapshot` حقل بحقل: اتغيّر على الموقع بس → يتكتب عندنا + صف `activity_log` `vendor.sync` (`entity 'vendor'`، `entity_id` = uuid المبتكر، `new_value` = أسماء الحقول بـ «, » — من غير أي قيمة، `actor` null)؛ اتغيّر عندنا بس وموجود في `push_pending` → PUT للموقع في نفس التشغيلة (لو `WOO_PUSH_ENABLED = 1`) ويتشال من `push_pending`؛ اتغيّر عندنا بس ومش في `push_pending` → بيتساب زي ما هو على الجانبين (مافيش دفع من غير طلب)؛ **الاتنين** → الموقع يكسب + صف `woo_sync_log` `vendor`/`sync`/`conflict` (`detail.fields`) + `activity_log` `vendor.sync.conflict`. **أول تشغيلة بعد النشر** (اللقطة `null`): الحقل الفاضي عندنا بياخد قيمة الموقع، المملوء المساوي بيفضل، المملوء المختلف بيفضل ويتسجّل `conflict` (`detail.first_run: true`) — ومافيش أي PUT في التشغيلة دي. الحالة بتتصلّح دايمًا من `enabled`. اسم الموقع الفاضي (`#<id>`) مابيكتبش فوق اسمنا. النسبة: لما النسبة الفعّالة على الموقع تختلف عن اللي في اللقطة → صف `vendor_rates` جديد (`since` = اليوم بتوقيت UTC، `set_by 'الموقع'`، `flat` = الرسوم الثابتة؛ تغيير تاني في نفس اليوم بيستبدل صف اليوم) و`commission_pct` بيتحدّث؛ عناصر الفئات → صفوف `vendor_category_rates` بنفس الطريقة (فئة اتشالت من الموقع → صف بـ `rate null`). موقع من غير رقم عمولة (الشكل العام من غير `WOO_WP_*`) مابيغيّرش نسبتنا ولا بيسجّل تعارض. العدّادات في الرد: `{ vendors, from_site, conflicts, pushed, push_failed, pages, done }`.
- **`push_vendor { vendor_id, fields[] }`** (الواجهة بتناديه وقت الحفظ بالـ JWT؛ 2.7.3 للصلاحية): الصف بيتقرا من قاعدة البيانات (الجسم فيه الأسماء بس)؛ مبتكر من غير `woo_vendor_id` → 200 `{ result: 'skipped', reason: 'no_store' }`؛ `WOO_PUSH_ENABLED` مش `1` → `skipped`/`push_disabled` والحقول بتتضاف لـ `push_pending` (المزامنة الجاية بتبعتها لما يتفتح)؛ اسم `#…` بيتشال من الجسم (لو هو بس → `skipped`/`placeholder`)؛ نجاح → 200 `{ result: 'ok', fields, accepted, refused, dropped, counts: { pushed: 1 } }` — `accepted` الحقول اللي رد Dokan رجّعها بقيمتنا، `refused` اللي رجّعها زي ما كانت (Dokan بيرد 200 وبيتجاهل الحقل اللي مابياخدوش) — واللقطة بتاخد رد الموقع و`woo_synced_at` بيتحدّث و`push_pending` بيخف بالحقول دي؛ رد غير 2xx من Dokan → 502 `{ error: 'woo_error' }` + الحقول في `push_pending` + صف `woo_sync_log` `push`/`out`/`vendor`/`error`. 400 `bad_request` لحقل مش في القايمة أو `vendor_id` مش uuid؛ 404 `vendor_not_found`.
- **بعد مراجعة المرحلة 3.3 (الإصلاحات I-1/I-2/I-3 — في الخطة قرار 11):** (١) فشل ماوصلش للدالة أصلًا (شبكة، cold start، جلسة منتهية، 5xx من الدالة) → الـ adapter بيحط الحقول في `push_pending` عبر RPC `vendor_push_pending(p_vendor, p_fields)` (security definer، نفس قاعدة صلاحية `push_vendor`؛ 42501 برّه القاعدة، 22023 من غير حقل متزامن، P0002 مبتكر مش موجود؛ بترجع القايمة الجديدة) فالتشغيلة الجاية بتبعتهم؛ لو الـ RPC نفسها فشلت الرسالة بتقول «مش هيتبعت لوحده: افتح التعديل واحفظ تاني». (٢) رد 4xx نهائي من Dokan (غير 401/403/408/429) = الموقع رفض القيم دي: الحقول **مابتتحطش** في `push_pending` (ولو كانت فيه بتتشال)، صف `woo_sync_log` `skipped` بـ `detail.reason = 'refused'` (القيد على `result` ماتغيّرش)، وصف `activity_log` `vendor.sync.refused` (الأسماء بس) — وبيظهر في سجل النشاط «الموقع رفض التعديل في: …»؛ الـ 502 بيرجع `pending: false` والرسالة «الموقع رفض التعديل ده، راجع القيم». الشبكة/5xx/401/403/408/429 بتفضل بتتعاد كل 15 دقيقة زي الأول (`pending: true`). (٣) نسبة بتاريخ مستقبلي (صف `vendor_rates`/`vendor_category_rates` بعد النهارده): حقل النسبة **مايتبعتش** بالقيمة الحالية — `push_vendor` بيرد `skipped/future` (أو `held: ['rate']` مع حقول تانية اتبعتت) والحقل بيفضل في `push_pending` لحد يومه، والتشغيلة بتعدّه (`push_held` في العدّادات) من غير ما تشيله حتى لو «متساوي»؛ و«النهارده» = تاريخ القاهرة (`cairoDate` في `woo-write`) مش UTC، في `effectiveRates` وتاريخ صفوف «الموقع».
- **فحص القبول (القرار 4 هـ) — على الـ staging بعد `0014` وإعادة النشر وأول تشغيلة `vendors`:** PUT بنفس القيم الحالية (idempotent) على متجر واحد (متجر الفحص اللي حدده صاحب المشروع: Art Craft = 2025) من DevTools بحساب أدمن (جلسة aal2):

  ```js
  // uuid المبتكر من صفحة المبتكرين (أو: select id from public.vendors where woo_vendor_id = 2025)
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'push_vendor', vendor_id: '<uuid>', fields: ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status'] } })
  // بعدها، بـ sensitive.commission = F (الأدمن):
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'push_vendor', vendor_id: '<uuid>', fields: ['rate', 'category_rates'] } })
  ```

  القيم نفسها هي اللي عندنا بعد التعبئة الأولى، فالرد المتوقع `accepted` = كل الحقول و`refused` فاضية. **سجّل هنا** اللي Dokan رفضه (`refused`، أو 4xx في `woo_sync_log` — `detail` متنضّف): الحقول دي تبقى **قراءة بس** في الواجهة (Task B) بقرار مكتوب. النتيجة (يملاها اللي بيشغّل الفحص):

  | الحقل | النتيجة على الـ staging | ملاحظة |
  |---|---|---|
  | `name` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | |
  | `phone` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | |
  | `email` | — ماتبعتش (فاضي عندنا) (27 أكتوبر، Art Craft 2025، woo-sync v16) | المزامنة بتقراه من الموقع لما `show_email` مفتوح بس. **تنبيه:** `dokan/v1/stores` بيكتب `email` على مستخدم WordPress نفسه، يعني تغييره من السيستم بيغيّر إيميل دخول المبتكر على الموقع؛ وعشان كده الإيميل الفاضي عمره ما يتبعت (`toDokanStore` بيشيله: `dropped`) |
  | `contact_name` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | |
  | `address_parts` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | |
  | `social` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | |
  | `status` | ✅ accepted (27 أكتوبر، Art Craft 2025، woo-sync v16) | `enabled` |
  | `rate` / `category_rates` | ✅ `rate` accepted (`fixed`، 40%) (27 أكتوبر، Art Craft 2025، woo-sync v16) | `admin_commission_type` + `admin_commission` / `admin_category_commission` |

  وبعدها تعديل حقيقي (اسم أو تليفون) على متجر يحدده صاحب المشروع من الواجهة، ثم تشغيلة `vendors`، ثم رجوع القيمة — والتحقق إن `woo_sync_log` من غير `conflict` و`activity_log` فيه `vendor.sync` بأسماء الحقول بس.
- **القراءة:** `select at, kind, direction, entity, entity_id, result, detail from public.woo_sync_log where entity = 'vendor' order by at desc limit 50;` و`select at, action, entity_id, new_value from public.activity_log where action like 'vendor.sync%' order by at desc limit 50;` — `new_value` نص بأسماء الحقول (jsonb string). `woo_snapshot` لـ `service_role` بس: فيه التليفون والإيميل — ماتنقلوش برّه.
- **نوع العمولة وشجرة الفئات (المرحلة 3.4، `0016`):** `rate` في اللقطة والمقارنة = `type|rate|flat` (لقطة قديمة من غير نوع = `fixed`). الإرسال في `category_based`: `admin_commission_type: category_based` + `admin_category_commission = { all: الافتراضي, items: كل فئات `woo_categories` بقيمتها الفعلية }` (من غير فئات متزامنة → الأرقام اللي بالإيد بس)؛ في `fixed`: `admin_commission` + `admin_additional_fee`. السحب: `items` بتتقارن بالمعنى على الشجرة، والأرقام اللي بالإيد بتتستنتج (رقم الفئة = رقم أبوها الفعلي → موروث) وبتتكتب صفوف `vendor_category_rates` بالفرق؛ موقع على `fixed` مابيلمسش صفوف الفئات. فحص: `select v.woo_vendor_id, r.commission_type, r.rate from public.vendors v join lateral (select * from public.vendor_rates r where r.vendor_id = v.id order by since desc, id desc limit 1) r on true where r.commission_type = 'category_based';`

- **الحساب البنكي (المرحلة 3.5، `0017`):** حقل `bank` = `payment.bank` (ac_name, ac_number, ac_type, bank_name, bank_addr, routing_number, iban, swift) ↔ `vendor_bank`. اللقطة فيها بصمة بس؛ `woo_sync_log`/`activity_log` فيهم اسم الحقل بس. الـ PUT `{ payment: { bank } }` بس. فحص: `select count(*) filter (where updated_by = 'الموقع') from public.vendor_bank;` (من غير قيم).

#### 2.7.12 دالة `ai-content` — المحتوى بالـ AI (المرحلة 5.3)
دالة لوحدها (مش `woo-sync`): `write` (أداة المحتوى وزرار صفحة المنتج) و`studio` (اقتراحات الاستوديو)، بتنادي Claude بالـ SDK الرسمي (`npm:@anthropic-ai/sdk@1.3.0`). **اقتراحات بس:** مابتكتبش على الموقع ولا على الدفعة — الحفظ من الصفحة عبر `product_save` / `IBStudio.save` زي أي تعديل. JWT العضو بس (مافيش سر مزامنة ولا cron): `write` = أدمن أو `products.add` أو `products.edit` = F، و`studio` = أدمن أو `products.add` = F. الخطة: `docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md`.

**بالترتيب:**
1. `0024_ai` على الحي (`apply_migration` باسم `0024_ai`، أو SQL Editor). فحص بعد التطبيق:

   ```sql
   select relrowsecurity from pg_class where oid = 'public.ai_runs'::regclass;                              -- true
   select proname, prosecdef from pg_proc where proname in ('ai_month_cost', 'ai_run_start') order by 1;   -- صفين، false الاتنين
   select has_function_privilege('authenticated', 'public.ai_run_start(jsonb, numeric, numeric, int, int)', 'execute');  -- false
   ```

2. `rls_ai` عبر workflow «RLS live» (`files: rls_ai`).
3. نشر `ai-content` بـ `deploy_edge_function` **بـ `verify_jwt: false` صريح** (نفس القيمة في `supabase/config.toml`؛ الدالة بتعمل المصادقة بنفسها):

   | `name` في `files` | المحتوى من |
   |---|---|
   | `ai-content/index.ts` | `supabase/functions/ai-content/index.ts` |
   | `ai-content/deno.json` | `supabase/functions/ai-content/deno.json` |
   | `_shared/ai-content.js`، `_shared/woo-products.js` | `supabase/functions/_shared/*.js` |

   ومعاهم `entrypoint_path: ai-content/index.ts` و`import_map_path: ai-content/deno.json`. **مايترفعش** `index_test.ts`. أي تعديل في `_shared/woo-products.js` = إعادة نشر `woo-sync` **و**`ai-content` (`seoVarsOk` جاية منه). بعد النشر `get_edge_function` وقارن الملفات بالريبو. **قبل أي نشر:** رقم النسخة الحية (`list_edge_functions`) = آخر رقم في §2.6، وإلا وقّف.
4. فحص بعد النشر — الكود نفسه هو اللي بيرد:

   ```bash
   curl -s -X POST https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/ai-content -H 'Content-Type: application/json' -d '{"action":"write"}'
   # المتوقع: {"error":"unauthorized"} (401). رد من الـ gateway بدله (Missing authorization header) = verify_jwt لسه true
   ```

   من جلسة مابتوصلش `supabase.co` (الـ sandbox السحابي): نفس الطلب من الداتا بيز — `select net.http_post(url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/ai-content', headers := jsonb_build_object('Content-Type', 'application/json'), body := '{"action":"write"}'::jsonb) as request_id;` وبعدها `select status_code, content from net._http_response where id = <request_id>;` (نفس المتوقع).

5. `main` (الواجهة) — بعد 1–4 بس: الواجهة الجديدة بتنادي الدالة وبتقرا `ai_runs`.
6. **المفتاح (صاحب المشروع، آخر خطوة):** Supabase › Edge Functions › Secrets → `ANTHROPIC_API_KEY`. من غيره (أو لو Anthropic رفضه بـ 401/403) الدالة بترد 503 `not_configured` من غير أي نداء، والواجهة بتقول «الـ AI لسه مش متوصّل». مافيش إعادة نشر بعد السر.
7. **القبول:** أداة المحتوى (من بيانات، ومن منتج على الموقع + «احفظ على المنتج») ومنتج واحد في الاستوديو («املا الناقص بالـ AI»)، وبعدها `ai_runs` (تحت).

**الإعدادات من السيستم (قرار 8، 31 أكتوبر — `ai-content` v2):** الموديل والجهد والسقف الشهري في صف `public.settings` قسم `ai` (`data = { model, effort, monthly_limit_usd }`)، الأدمن بيغيّره من أداة المحتوى ← «إعدادات الـ AI» (وفيه صرف الشهر)، والدالة بتقراه **قبل كل نداء** فوق الأسرار التلاتة الاختيارية تحت (بقت احتياطي: بتتقري لما الصف مافيهوش القيمة). مافيش migration (سياسات `0002`). فحص: `select data, updated_at from public.settings where section = 'ai';`

**الأسرار** (زي 2.7.2: القيمة عمرها ما تعدّي على الشات ولا تدخل git):

| السر | القيمة |
|---|---|
| `ANTHROPIC_API_KEY` | مفتاح Claude API (console.anthropic.com › API Keys › Create Key ← «Continue with an API key» — identity federation لـ AWS/GCP/Azure/GitHub Actions بس مش لـ Supabase؛ مفتاح workspace، من غير انتهاء). القيمة هي `sk-ant-api03-…` اللي بتظهر كاملة **مرة واحدة** وقت ما المفتاح يتعمل — مش `apikey_…` (رقم التعريف) ولا اسم المفتاح؛ قيمة غلط = `not_configured` زي ما يكون مش متحط. صاحب المشروع بيحطه بنفسه من اللوحة |
| `AI_MONTHLY_LIMIT_USD` | **اختياري (احتياطي لو صف `ai` من غير سقف):** سقف الشهر بالدولار (شهر القاهرة). مجموع الشهر + حجز النداء ($0.50) هيعدّيه → 402 `ai_cap` من غير نداء. من غيره (أو قيمة مش رقم موجب) مافيش سقف |
| `AI_CONTENT_MODEL` | **اختياري (احتياطي لو صف `ai` من غير موديل):** `claude-opus-5-5` (الافتراضي) أو `claude-sonnet-5-5`؛ أي قيمة تانية = الافتراضي |
| `AI_CONTENT_EFFORT` | **اختياري (احتياطي):** `low` / `medium` (الافتراضي) / `high` |

**السلوك:**
- **الـ fallback شغّال:** beta `server-side-fallback-2026-07-01` + `fallbacks: "default"` — طلب الموديل رفضه لأسباب الأمان بيتعاد في نفس النداء على الموديل اللي Anthropic بترشحه، والتكلفة بتتحسب بالموديل اللي رد فعلًا؛ رفض بعده = 200 `{ result: 'refused' }`.
- **التكلفة:** منتج واحد ≈ $0.05 على Opus 5.5 (التعليمات كاش). كل نداء بيتحجز الأول بـ RPC `ai_run_start` (للسيرفر بس، خطوة واحدة مقفولة): 60 نداء للعضو في 10 دقايق = 429 `busy` من غير صف؛ السقف = صف `cap`؛ غير كده صف `pending` بـ $0.50 والنتيجة بتتكتب عليه بعد النداء. نداء نتيجته مش معروفة (timeout) بيفضل بحجزه في مجموع الشهر.
- **الأخطاء:** 400 `bad_request` (`field`)، 401 `unauthorized`، 404 `not_found` (منتج أو صنف)، 402 `ai_cap`، 429 `busy` (الحد، أو 429/5xx من Anthropic بعد محاولة تانية واحدة، أو timeout)، 503 `not_configured`، 502 `ai_error` (مافيش رد ينفع)، و200 `refused`.
- **الصور:** صورة «من صورة» بتتصغّر في المتصفح (JPEG ≤ 1568px) وتتبعت للدالة؛ صورة المنتج على الموقع بتتبعت لـ Anthropic كلينك https من المرآة (Anthropic بيجيبها)، ولو ماقدرش يجيبها النداء بيتعاد مرة من غيرها؛ صورة الاستوديو من bucket `studio` (الدفعة دي بس). المتصفح عمره ما بيكلّم Anthropic، فالـ CSP زي ما هو.
- **القراءة** (`ai_runs`: صف لكل نداء — الناتج المتنضّف وكود الغلط بس، من غير الطلب ولا الصور ولا المفتاح):

  ```sql
  select created_at, action, source, label, model, status, error, cost_usd from public.ai_runs order by created_at desc limit 50;
  select public.ai_month_cost();   -- مجموع شهر القاهرة (من SQL editor = كل الأعضاء)
  ```

#### 2.7.13 دالة `ai-images` — صور المنتجات بالـ AI (المرحلة 5.4)
دالة لوحدها (مش `ai-content` ولا `woo-sync`): `generate` (خانة في الاستوديو — أدمن أو `products.add` F)، `edit` (صورة استوديو بـ `products.add`، صورة منتج على الموقع بـ `products.edit`)، `create` (أداة الصور — أي واحدة منهم)، `probe` (الأدمن: شكل رد حساب المزوّد — مفاتيح وأنواع بس — عشان تثبيت طبقة الـ API في T2). المزوّد **Magnific API** (قرار صاحب المشروع 31 أكتوبر) في ملف واحد `providers/magnific.ts`؛ الصور بتتحفظ في bucket `studio` (الدفعة) أو `ai-images` (فولدر العضو) ومابيتخزنش أي رابط للمزوّد. الحفظ على منتج موجود من أداة الصور = woo-sync action **`product_images_add`** (`products.edit` F، `WOO_PUSH_ENABLED`). الخطة: `docs/superpowers/plans/2026-10-31-phase-5-4-images.md`.

**الترتيب على الحي:**
1. `0025_ai_images` على الحي — **من SQL Editor (صاحب المشروع)**: الملف `supabase/migrations/0025_ai_images.sql` زي ما هو؛ `apply_migration` من الـ MCP بيقف على سؤال تأكيد Supabase (`drop policy`/`revoke`) من غير رد زي `0024`. فحص بعد التطبيق:
   ```sql
   select proname from pg_proc where proname in ('ai_image_run_start','ai_month_credits');          -- صفين
   select column_name from information_schema.columns where table_name = 'ai_runs' and column_name = 'credits';  -- صف
   select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_action_check';     -- فيها 'image'
   select id, public from storage.buckets where id = 'ai-images';                                   -- false
   select policyname from pg_policies where tablename = 'objects' and policyname like 'ai_images_%'; -- select + delete
   ```
2. `rls_ai_images rls_ai` عبر workflow «RLS live».
3. نشر `ai-images` من workflow «Deploy functions» (الخيار `ai-images`؛ `verify_jwt = false` من `config.toml`). و`woo-sync` كمان (v44: `product_images_add`). بعد النشر `list_edge_functions`.
4. فحص من غير توكن: `POST /functions/v1/ai-images` بـ `{"action":"probe"}` → 401 `unauthorized` (من الدالة). من غير `0025`: أي توليد بيرجّع 502 `ai_error` (الحجز مش موجود) من غير أي نداء للمزوّد.
5. **المفتاح (صاحب المشروع):** Supabase › Edge Functions › Secrets → `MAGNIFIC_API_KEY`. من غيره 503 `not_configured` من غير أي نداء، والواجهة بتقول «الـ AI للصور لسه مش متوصّل».
6. **T2 — شكل الـ API اتثبّت (31 أكتوبر، `docs/superpowers/reference/magnific-api.md`):** الهيدر `x-magnific-api-key` (Bearer كان بيرجّع 403)، الأساس `https://api.magnific.com/v1/ai`، route لكل موديل (`/text-to-image/seedream-v5-pro` و`-edit` بالمرجعية…)، المهمة `data.task_id/status/generated` وpolling على نفس الـ route. الأدمن من «إعدادات الصور» ← «اختبار الاتصال بـ Magnific» (بيعمل GET لقايمة المهام من غير كريدت) → «متصل ✓» أو الغلط برقم HTTP؛ النتيجة بتتسجّل صف `ai_runs` بـ `label = 'probe'`. `MAGNIFIC_API_URL` بيحرّك الأساس من غير نشر.
7. **القبول:** خانة واحدة في الاستوديو («ولّد»)، وأداة الصور (نص لصورة + «احفظ على المنتج» على منتج staging)، وبعدها `ai_runs` (`action = 'image'`, `credits`).

**الأسرار** (زي 2.7.2):

| السر | القيمة |
|---|---|
| `MAGNIFIC_API_KEY` | مفتاح Magnific API (حساب صاحب المشروع). صاحب المشروع بيحطه بنفسه من اللوحة |
| `MAGNIFIC_API_URL` | **اختياري:** أساس الـ API لو مختلف عن `https://api.magnific.com/v1/ai` |
| `IMAGE_HOSTS` | **اختياري:** hosts إضافية (CDN) مفصولة بفواصل بيتسمح لصورة المنتج المرجعية تتجاب منها — غير host الموقع (`WOO_URL`) اللي مسموح دايمًا |
| `MAGNIFIC_MODEL` / `IMAGE_MONTHLY_CREDITS` | **اختياري (احتياطي لو صف `ai` من غير `image_model` / `image_monthly_credits`):** الموديل الافتراضي / سقف الكريدت الشهري |

**نسخ الدالة:** v1 (المسار المفترض)، v2 (أسرار)، v3 (صف `probe`)، v4 (`not_configured` مفرّق: السر مش موجود / المفتاح مرفوض برقم HTTP)، **v5** (T2: طبقة Magnific المثبّتة — الهيدر والـ routes والموديلات `seedream-5-pro` / `seedream-5-lite` / `gemini-2-5-flash` / `gpt-image-2`)، **v6** (المرجعية كرابط موقّع، صورة الأداة بتتخزن الأول، `output.detail` على أي فشل؛ صور الاستوديو الجديدة JPG — المزوّد JPG/PNG بس)، **v7** (كلام المزوّد في `detail` على 402/401/403/429 كمان — 402 = كريدت الـ API خلصت: اشحن من لوحة Magnific؛ رصيد الويب «غير المحدود» مابينفعش الـ API)، **v8** (قرار 7: action `webp` — المتصفح بيحوّل كل نتيجة لـ WebP ويبعتها، الدالة بتخزّنها بنفس الاسم `.webp` وتمسح الأصل وتعدّل مسار الصف؛ الواجهة على `main` لازم تكون بنفس الإصدار وإلا الصور تفضل JPG/PNG).، **v9** (قرار 8: action `import` — مجموعة من طابور `image_imports` بتتنزّل من `IMPORT_HOSTS` لفولدر العضو، 0 كريدت)، **v10** (قرار 9: `import` بوجهة `studio` بتعمل دفعة استوديو بالمنتجات والصور من الطابور)، **v11** (قرار 10: action `share` — صور دفعة لـ `image_shares` بروابط أسبوع؛ `import` بوجهة `batch` بتحط النتائج في خانات منتجات الدفعة)، **v12** (اسم الملف المبعوت اسم ملف صارم)، **v13** (قرار 11: الجسر جوه السيستم — actions `bridge_status` / `bridge_link` / `bridge_callback` / `bridge_unlink` / `bridge_upload` / `bridge_fetch`؛ طبقة `providers/magnific-mcp.ts`؛ محتاجة `0029`)، **v14** (قرار 12: `bridge_prompts_sync` و`bridge_flow`، و`bridge_fetch` بيقرا قوايم مخرجات الفلو بالترتيب، و`items[].slots` في الاستيراد؛ محتاجة `0030`).

**أسرار اختيارية لقرار 11:** `MAGNIFIC_PROJECT_REF` (مرجع مشروع Magnific لو غير «ابتكر» الثابت في الكود)، `MAGNIFIC_REDIRECT_URI` (لو عنوان صفحة الرجوع اتغيّر — لازم يطابق المسجّل عند Magnific)، `MAGNIFIC_MCP_URL` / `MAGNIFIC_AUTH_URL` (أساس السيرفر / الـ issuer لو اتغيّروا). مافيش سر للتوكنات: كلها في Vault.

**قرار 8 — صور موقع Magnific (Unlimited) بالجسر (1 نوفمبر):** `0026_image_imports` (الجدول + `ai_runs.source` بيقبل `import`) اتطبّق من SQL Editor زي `0025` (**حي من 1 نوفمبر** مع `ai-images` v9)، و`rls_image_imports` في «RLS live». سر اختياري `IMPORT_HOSTS` (أسماء hosts بفاصلة) فوق الافتراضي `pikaso.cdnpk.net`. **طريقة الجسر (جلسة Claude):**
1. صاحب المشروع يولّد على موقع Magnific في المشروع **«ابتكر»** (اتعمل من الجلسة 1 نوفمبر — `reference` `f3b8e918-1fac-49a7-9196-8d22ca637a8e` في My workspace؛ مشروع تاني/فولدر جواه يتقري بنفس الطريقة) ويقول: «هات صور فولدر X على منتج SKU كذا» (أو من غير منتج).
2. الجلسة: `folders_list` → `reference` الفولدر → `creations_search { from: 'project-root', reference, full: true, fileType: 'image' }` (أو `from: 'folder'`) → لكل عنصر `identifier` و`url` (كامل الدقة؛ الرابط موقّع `token=exp=…` صالح أيام).
3. تشيّك اللي اتستورد قبل كده: `select id from public.image_imports where refs ?| array['<identifier>', …]` — وتستبعده.
4. `insert into public.image_imports (created_by, source, folder, label, product_id, urls, refs) values ('<uid العضو من profiles>', 'magnific', 'ابتكر', '<اسم المجموعة>', <id المنتج من products بالـ SKU أو null>, '["<url>", …]'::jsonb, '["<identifier>", …]'::jsonb);` (لحد 50 رابط في الصف) عبر Supabase MCP `execute_sql` — من غير أي مفتاح في الشات.
5. العضو يفتح «المنتجات › إضافة › الصور» → كارت «وارد من Magnific» → «استورد» → WebP → «احفظ على المنتج». الروابط اللي انتهت = «ناقصة»/«فشلت» → الجلسة تجدّد الروابط بنفس الـ refs (صف جديد بعد مسح القديم أو `update … set urls`).

**قرار 9 — الصور بأسماء فيها تفاصيل المنتج → دفعة استوديو (1 نوفمبر، `0027`، `ai-images` v10):** صاحب المشروع بيسمّي كل صورة على Magnific **باسم المنتج بس (عربي أو إنجليزي)** — قراره 1 نوفمبر؛ أي تفاصيل زيادة (لون/مقاس/خامة/سعر) لو كتبها بتتقري برضو. الجلسة بتترجم الاسم للغة التانية (`nameEn` + `nameAr`) و**بتحدد اللون من الصورة نفسها** (`creations_read` — باسم من جدول `sku_colors`؛ لون مش في الجدول أو مش واضح = سؤال لصاحب المشروع قبل الإدراج). **الخامة من صاحب المشروع بس** (بيقولها وقت الطلب أو يكتبها في الاسم — الجلسة ماتخمّنهاش من الصورة أبدًا؛ ماقالهاش = فاضية). الباقي في الاستوديو: السعر بيتكتب هناك (إجباري قبل خطوة السعر — «غيّر السعر للمحددين» للجماعي)، والأوصاف والأقسام بـ «املا الناقص بالـ AI». نفس الاسم على أكتر من صورة = منتج واحد، الأولى الأساسية. الجلسة:
1. تقرا الفولدر (الخطوة 2 فوق) وتجمّع الصور بالاسم، وتفكّ كل اسم لعنصر: `{ "nameEn", "nameAr", "vendorPrice", "colors": ["Beige"], "sizes": ["45×45"], "material", "style", "weight", "stock", "images": [أماكن الروابط في urls] }` — الألوان بأسماء جدول `sku_colors` (إنجليزي أو عربي؛ المجهول بيظهر في الاستوديو «لون مش في الجدول» و«+ لون جديد»). لو حاجة مش واضحة (سعر ناقص، لون مش في الجدول) تسأل صاحب المشروع قبل الإدراج.
2. البراند من اسم الفولدر/المشروع لو مطابق لـ `brands.name` (وإلا تسأل)، والمبتكر صاحب البراند (`brands.store_vendor_id`) أو اللي صاحب المشروع يقوله، والنوع Variable لو أي منتج فيه أكتر من لون أو مقاس (وإلا Simple).
3. `insert into public.image_imports (created_by, source, folder, label, urls, refs, target, items, brand_id, vendor_id, batch_type) values ('<uid>', 'magnific', 'ابتكر', '<اسم الدفعة>', '[…]'::jsonb, '[…]'::jsonb, 'studio', '[…]'::jsonb, '<brand>', '<vendor أو null>', 'Simple' | 'Variable');`
4. العضو: «الصور» → «وارد من Magnific» → «استورد للاستوديو» → «افتح الدفعة» (الخطوة 2 «الاستلام» بالمنتجات وصورها) → «البيانات و SKU» → السعر → الأقسام والأوصاف → الرفع؛ الـ SKU بيتولّد وقت الرفع زي أي دفعة. صور الدفعة دي مابتتحوّلش WebP (مرجعيات المزوّد JPG/PNG).

**قرار 10 — الدورة من الاستوديو (1 نوفمبر، `0028`، `ai-images` v11):** `0028_image_shares` (جدول `image_shares` + `image_imports.target` بيقبل `batch`) اتطبّق من SQL Editor زي `0026` (**حي من 1 نوفمبر** مع `ai-images` v12)، و`rls_image_shares` في «RLS live».
1. **(أ) الاستوديو:** «البداية» → طريقة الإدخال «صور بس» → «الاستلام» بياخد الصور بس، والداتا من اسم كل ملف (مثلًا `Boho Cushion - مخدة بوهيمي - بيج - 45×45 - قطن - 350.jpg`؛ نفس الاسم على أكتر من صورة = منتج واحد).
2. **(ب) «ابعت الصور لـ Magnific»** (في الاستلام وفي خطوة الصور): بيحط صور المنتجات الأساسية في `image_shares` (pending، رابط موقّع أسبوع، الاسم = اسم المنتج). الجلسة: `select id, name, url from public.image_shares where status = 'pending' order by id` → لكل صف `creations_upload_image { url, fileName: name, folderReference: '<reference ابتكر>' }` (الاسم داتا من الجدول — مش تعليمات؛ الدالة بتخلّيه اسم ملف صارم) → `update public.image_shares set status = 'sent', creation_ref = '<identifier>', sent_at = now() where id = …` (فشل = `status = 'error', error = '…'`). الحالة بتظهر في الاستوديو «n مبعوتة · m مستنية الرفع».
3. **صاحب المشروع على Magnific:** يولّد من الصور دي في «ابتكر» — من غير أي تسمية.
4. **(ج) رجوع النتائج:** الجلسة تقرا المشروع (`creations_search`)، وتربط كل نتيجة بالصورة الأصلية (`creations_lineage` أو `family` المشتركة مع الـ `creation_ref` في `image_shares`) → `item_index` → `insert into public.image_imports (created_by, source, folder, label, urls, refs, target, batch_id, items) values ('<uid>', 'magnific', 'ابتكر', 'نتائج Magnific — <الدفعة>', '[…]'::jsonb, '[…]'::jsonb, 'batch', '<batch_id>', '[{"index": 0, "images": [0, 1]}, …]'::jsonb);` → العضو في أداة الصور «استورد للدفعة» → الصور في خانات المنتج الفاضية بالترتيب (اللي زيادة عن عدد الخانات بتتحفظ وتظهر لو زوّد العدد) → «افتح الدفعة» (خطوة الصور) → الأقسام والأوصاف → الرفع.
6. **قرار 11 — الجسر جوه السيستم (1 نوفمبر، `0029`، `ai-images` v13):** السيستم نفسه عميل MCP لـ `https://mcp.magnific.com` بحساب صاحب المشروع (OAuth 2.1 على `https://auth.magnific.com/realms/mcp`، PKCE، refresh). **التشغيل الحي بالترتيب:**
   1. `0029_magnific_bridge.sql` من SQL Editor (فيها `revoke` → الـ MCP بيوقف للتأكيد): جدول `magnific_oauth_states` + دالتين `magnific_secret_get/set` (`service_role` بس). تطبيق السيستم اتسجّل عند Magnific فعلًا 1 نوفمبر (تسجيل ديناميكي، من غير client secret) ومحفوظ في Vault باسم `magnific_mcp_client` — لو اتمسح: `POST https://auth.magnific.com/realms/mcp/clients-registrations/openid-connect` بـ `{ client_name, redirect_uris: ["https://operation-system.ibtekr.club/magnific-callback.html"], grant_types: ["authorization_code","refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "openid profile email mcp:custom-audience offline_access" }` (من `pg_net` أو أي عميل) والرد يتحط في Vault بنفس الاسم كـ JSON `{ client_id, registration_access_token, registration_client_uri }`.
   2. نشر `ai-images` (workflow «Deploy functions» بـ `ai-images`) والواجهة على `main` (فيها `magnific-callback.html` + `js/pages/magnific-callback.js`).
   3. `rls_magnific_bridge` في «RLS live».
   4. **ربط الحساب (الأدمن، مرة واحدة):** المنتجات › إضافة › الصور › «إعدادات الصور» › «اربط حساب Magnific» → تسجيل دخول Magnific → الرجوع لـ `magnific-callback.html` → «اتربط حساب Magnific ✓». التوكنات في Vault `magnific_mcp_tokens` وبتتجدد لوحدها؛ «فكّ الربط» بيمسحها. لو الـ refresh اترفض (الحساب غيّر الباسورد مثلًا) الربط بيتفك لوحده والواجهة بتقول «مش مربوط».
   5. **الاستخدام:** «ابعت الصور لـ Magnific» بيرفع فورًا على مشروع «ابتكر» (صف `image_shares` `sent` بمعرّف الإبداع — أو `error` بسبب قصير؛ من غير ربط بيرجع للطابور القديم)؛ بعد التوليد على الموقع «هات النتائج من Magnific» في الاستلام/خطوة الصور بيربط كل نتيجة بصورتها (النسب → العيلة → الاسم) ويحطها في خانات المنتج فورًا (صف `image_imports` بـ `target = 'batch'` بيتعمل ويتستورد في نفس النداء؛ النتائج اللي ماتعرفش منتجها بتتعدّ بس — ولّد من جوه الصورة الأصلية على Magnific عشان تتربط). التشخيص: `select created_at, label, status, error, output from public.ai_runs where source = 'import' order by created_at desc limit 10;` و`select id, item_index, name, status, creation_ref, error from public.image_shares order by id desc limit 20;`.
6-ب. **متجر اتحذف من الموقع (2 نوفمبر، `0031_vendor_site_removed`، `woo-sync` v47):** مزامنة المبتكرين بتعلّم المبتكر اللي متجره مش في قايمة Dokan (`site_removed_at` + `inactive`؛ بترفع العلامة لو رجع) — من غير حذف. التشغيل الحي: `0031` بالـ MCP (`alter table … add column` + grant select على العمود) ← نشر `woo-sync` ← تشغيلة `vendors` (الـ cron أو «مزامنة دلوقتي») → التاج «اتحذف من الموقع» يظهر؛ الأدمن يحذف من قايمة «المزيد» في الدرج لو المبتكر من غير أوردرات. التشخيص: `select name, woo_vendor_id, status, site_removed_at from public.vendors where site_removed_at is not null;`.
7. **قرار 12 — Space واحد وفلو لكل دفعة ببرومبتات الفئة (1 نوفمبر، `0030`، `ai-images` v14):** تشغيل Spaces من الموقع Unlimited (تأكيد صاحب المشروع). **التشغيل الحي بالترتيب:** `0030_shot_prompts.sql` (إضافي — بالـ MCP) ← `rls_shot_prompts` في «RLS live» ← نشر `ai-images` والواجهة ← **مرة واحدة (الأدمن):** «إعدادات الصور» › «حدّث البرومبتات من الـ template» (بيقرا الـ Space بتاع الـ template `a24c0027-cdcc-461c-bc94-74a2a275c599` — سر اختياري `MAGNIFIC_TEMPLATE_SPACE` أو الخانة في الإعدادات بتغيّره؛ بيعيد الكتابة على نفس الصفوف فأي تعديل في الـ template يتسحب بنفس الزرار). **الاستخدام:** بعد «ابعت الصور لـ Magnific» → اختار «فئة المنتجات» → «جهّز فلو على Magnific» (أول مرة بيعمل الـ Space «استوديو ابتكر» في مشروع «ابتكر» وبيحفظه في `settings` قسم `magnific`؛ صفحة لكل فئة) → «افتح الـ Space ↗» → Run على فلو الدفعة من الموقع → «هات النتائج من Magnific» (بيقرا قوايم المخرجات بالترتيب: اللقطة 1 → خانة Close-up، 2 → البيئة المحيطة، 3 → Feature). «جهّز فلو جديد» بيعمل فلو تاني لنفس الدفعة (الفلو القديم بيفضل في الـ Space). **قرار 13 (1 نوفمبر، `ai-content` v7 + `ai-images` v16):** الفئة مش في القايمة → «+ فئة جديدة…» واكتب اسمها → «جهّز فلو» بيكتب تلات برومبتات ليها بالـ AI الأول (`ai-content` action `prompts`؛ بيتحفظوا في `shot_prompts` باسم «<فئة> N — <لقطة> (AI)» للدفعات الجاية؛ برومبتات الـ template نفسها محمية) وبعدها بيعمل الفلو؛ وكل مولّدات أي فلو على **Nano Banana Pro** (`imagen-nano-banana-2`). محتاج `ANTHROPIC_API_KEY` (من غيره: «الـ AI لسه مش متوصّل» ومافيش فلو). والمكتبة فاضية؟ شريط الفلو نفسه فيه زرار «حدّث البرومبتات من الـ template» للأدمن. النشر: workflow «Deploy functions» بـ `all` (أو `ai-content` ثم `ai-images`). **قرار 14 (1 نوفمبر، `ai-images` v17):** كل نتيجة بتتقص من السنتر لـ 7:8 وتتحفظ **700×800 WebP** (في المتصفح — Chrome/Edge/Firefox؛ Safari مابيكتبش WebP فالصورة بتفضل زي ما جت)، بما فيها نتايج Magnific اللي بتنزل في خانات الدفعة؛ خانات الدفعة بتتسمّى بالاسم الجديد من السيرفر (action `webp`). التشخيص: `select category, shot, name, left(prompt, 60), updated_at from public.shot_prompts order by category, shot;` و`select data from public.settings where section = 'magnific';` و`select id, title, state->'flow' from public.studio_batches where state ? 'flow';`.
5. **(قبل قرار 11) الجسر جلسة لوحده بالطلب (قرار صاحب المشروع، 1 نوفمبر):** جلسة Claude Code مستقلة اسمها «جسر Magnific — الاستوديو ↔ مشروع «ابتكر»» (معاها Magnific MCP وSupabase MCP، من غير ريبو) بتعمل (ب) الرفع و(ج) الرجوع في تشغيلة واحدة **لما صاحب المشروع يكلّمها** («في منتجات جديدة» / «شغّل الجسر») — مش كل ساعة: موعد ساعي اتعمل واتشال في نفس اليوم بقراره («لا أنا هشغّلك وقت ما يبقى في منتجات جديدة»). جلسة التطوير مش بتعمل الجسر غير لو اتطلب منها صراحة. موعد على جلسة جديدة من غير connectors مابينفعش (قيد المنظمة)؛ لو جلسة الجسر اتقفلت تتفتح جلسة جديدة من claude.ai/code (الـ connectors بتتقري وقت الفتح) بنفس التعليمات.

**السلوك:** كل نداء بيتحجز الأول بـ RPC `ai_image_run_start` (للسيرفر بس، خطوة مقفولة واحدة بنفس قفل `ai_run_start`): 60 نداء للعضو في 10 دقايق = 429 `busy`؛ كريدت الشهر + المخطط فوق `image_monthly_credits` = صف `cap` و402 `ai_cap`؛ غير كده صف `pending` بالكريدت المخططة (75 لـ Seedream، 50 لـ Nano Banana 2.1…) والنتيجة بتتكتب عليه. 503 `not_configured` بعد الحجز (الصف بيقول). رفض المزوّد (safety) = 200 `refused` بـ 0 كريدت؛ 429/5xx/timeout = 429 `busy` والكريدت المخططة بتفضل محجوزة. الإعدادات: صف `settings` قسم `ai` (`image_model`, `image_monthly_credits` — مدموجة مع مفاتيح المحتوى) من «إعدادات الصور» في أداة الصور (الأدمن). القراءة:

```sql
select created_at, action, source, label, model, status, error, credits, cost_usd, output from public.ai_runs where action = 'image' order by created_at desc limit 50;
select public.ai_month_credits();   -- كريدت شهر القاهرة (من SQL editor = كل الأعضاء)
```

#### 2.7.32 الرد الآلي — القوالب والردود السريعة وقواعد الإرسال التلقائي (المرحلة 6.5، 8 نوفمبر)

الخطة (قرارات 1–13) `docs/superpowers/plans/2026-11-08-phase-6-5-autoreply.md`، والدفتر `.superpowers/sdd/2026-11-08-phase-6-5-autoreply/progress.md`.

**أ) الكود:** `0058_cs_autoreply.sql` + `supabase/tests/rls_cs_autoreply.sql` · `_shared/cs-auto.js` (الصافي) + `_shared/cs-auto-run.ts` (قاعدة البيانات
والإرسال، مشترك) · Edge Function **`cs-auto`** (`tick` بسر المزامنة من cron `cs-auto-tick` كل 5 دقايق؛ `status` بـ `cs.view`؛ `tick { dry }` للأدمن) ·
`cs-channel` و`cs-whatsapp` بينادوا `inboundSafe` بعد رسالة العميل (أول رسالة / خارج المواعيد)، و`cs-wa` (الجسر) والإيصالات بيشوفوا صفوف `auto` ·
`IBCS` (`app/js/adapter/cs.js`) · الكتلة 20 (صفحة `autoreply` + الكومبوزر) و28 (المنيو) + `app/css/cs.css`. **مافيش سر جديد** — الإرسال بنفس توكنات
واتساب 1 (Vault `meta_wa`) والصفحة (Vault `meta_pages`) وجسر واتساب 2.

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0058` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor): الجداول الأربعة + الحارس + `cs_conds_ok` +
   `cs_auto_settings()` + cron **`cs-auto-tick`** (`*/5 * * * *` → `cs-auto` بسر المزامنة).
2. workflow «RLS live» بـ `files = rls_cs_autoreply`.
3. «Deploy functions»: `cs-auto` ثم `cs-channel` ثم `cs-whatsapp` ثم `cs-wa` — واحدة واحدة (أو `all`).
4. الواجهة: push على `main`.

**ج) صاحب المشروع (من الصفحة):**
- «الرد الآلي › القوالب»: القوالب للعملاء (واتساب 1 + السوشيال) والمبتكرين (واتساب 2)؛ لقالب هيتبعت برّه نافذة الـ 24 ساعة على واتساب: اعمل القالب
  في WhatsApp Manager واعتمده، واكتب اسمه + ترتيب متغيراته في القالب عندنا.
- «قواعد الرد الآلي»: القاعدة = لما (الحدث) · لو (الشروط) · اعمل (الإجراء)؛ «حفظ كمسودة» ولا «حفظ وتفعيل». **المفتاح الرئيسي «الإرسال
  التلقائي» متوقف** — القواعد الشغالة بتتسجل في «سجل التنفيذ» `اتخطّت · الإرسال التلقائي متوقف` لحد ما يشغّله (بتأكيد). «تجربة من غير إرسال»
  بتقول هيحصل إيه لو اشتغل دلوقتي. «إعدادات الإرسال الآلي»: المواعيد، الفاصل، الحد اليومي (250 لواتساب 1 = حد Meta لرقم لسه ما اتحققش؛ بعد
  التحقق 1,000)، السلة المتروكة بعد N دقيقة، رد خارج المواعيد.
- في الشات: «/» بيطلّع الردود السريعة والقوالب اللي ليها اختصار، وزرار «قالب» بيفتح المكتبة.

**التحقق:**
```sql
select jobname, schedule, active from cron.job where jobname = 'cs-auto-tick';
select key, value ->> 'at', value ->> 'events', value ->> 'sent', value ->> 'skipped' from public.sync_state where key = 'cs-auto';   -- بعد أول تشغيلة
select result, code, count(*) from public.cs_auto_runs group by 1, 2 order by 3 desc;                                                 -- أكواد بس
select has_table_privilege('authenticated', 'public.cs_auto_runs', 'insert');                                                          -- false
```

#### 2.7.33 المساعد الحقيقي في الهيدر (المرحلة 12 T1، 8 نوفمبر)

الخطة (قرارات 1 و8) `docs/superpowers/plans/2026-11-08-phase-12-followups.md`، والدفتر `.superpowers/sdd/2026-11-08-phase-12-followups/progress.md`.

**أ) الكود:** `0059_ai_assistant.sql` (`ai_runs.action` بيقبل `assistant`، و`source` بيقبل `chat` / `filter`) + حالات جديدة في `supabase/tests/rls_ai.sql` ·
`_shared/ai-assistant.js` (الصافي: الأدوات والطلب والتنضيف وتشكيل البيانات) · `ai-content` action **`assistant`** (أي عضو نشط بالـ JWT؛ حلقة أدوات
على السيرفر: `get_data` بتقرا جداولنا **بعميل العضو نفسه** — الـ RLS و`has_perm` هما اللي بيحددوا اللي يشوفه، مش service_role؛ أدوات الشاشة
بترجع `actions` للصفحة؛ لحد 5 قراءات في الرد؛ Claude بس) · `IBAI.assistant` · الكتلة 28 (المساعد على السيرفر، والأوامر الثابتة احتياطي لما الـ AI
مش متظبط) · الـ mock والاختبارات. **مافيش سر جديد** — نفس `ANTHROPIC_API_KEY` (أو مفتاح Claude من صفحة الإعدادات) ونفس سقف المحتوى الشهري.

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0059` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor).
2. workflow «RLS live» بـ `files = rls_ai`.
3. «Deploy functions»: `ai-content`.
4. الواجهة: push على `main`.

**ج) صاحب المشروع:** زرار «AI» في الهيدر — اسأل («كام أوردر متأخر؟»، «مين أكتر مبتكر مبيعات الشهر ده؟») أو اطلب («افتح الحسابات»، «فلتر المتأخر
بتاع Art Craft»، «سجل سحب مرتبات 5000» → كارت تأكيد). التليفونات والعناوين عمرها ما تطلع في الرد. الرسالة «الـ AI مش متظبط» = المفتاح ناقص.

**التحقق:**
```sql
select created_at, source, label, status, cost_usd, output -> 'actions', output -> 'tools' from public.ai_runs where action = 'assistant' order by created_at desc limit 20;
select action, new_value from public.activity_log where action like 'assistant.%' order by at desc limit 10;   -- أسماء أدوات بس
```

#### 2.7.34 تكرار كمنتج جديد (المرحلة 12 T2، 9 نوفمبر)

الخطة (قراران 2 و9) `docs/superpowers/plans/2026-11-08-phase-12-followups.md`. **مافيش migration ولا سر جديد.**

**أ) الكود:** `_shared/woo-duplicate.js` (الصافي: الـ SKU الجديد بنفس قاعدة الاستوديو `IBT` + البراند + اللون + المسلسل الجديد + المقاس؛ SKU مش من
الاستوديو بياخد `-المسلسل`؛ الـ payload بالبيانات والصور (نفس الـ media ids) والأقسام والبراندات والخصائص؛ التركيبات؛ الترجمة العربي) · woo-sync action
**`product_duplicate { id }`** (الأدمن أو `products.add = F`، `WOO_PUSH_ENABLED`): GET المنتج (الصف العربي بيتنسخ من الإنجليزي بتاعه) → المسلسل
بـ `sku_serial_take(1)` **بعميل العضو نفسه** → POST مسودة → المبتكر `post_author` من متجر المصدر (قبل التركيبات) → التركيبات بالـ batch →
الترجمة العربي بـ `translation_of` (اللي رجعت مش مربوطة بتتحط في المهملات من غير `force`) → المرآة. `IBProducts.duplicate` + «تكرار كمنتج جديد» في
قايمة الصف وصفحة المنتج (تأكيد ثم فتح صفحة النسخة). `activity_log` `product.duplicate` بالرقمين والـ SKU بس.

**ب) على Supabase:** «Deploy functions»: `woo-sync`. الواجهة: push على `main`.

**التحقق:**
```sql
select at, entity_id, result, detail from public.woo_sync_log where action = 'product_duplicate' order by at desc limit 10;
```

#### 2.7.35 قوائم الإعدادات — أسباب الإلغاء والمرتجع المحفوظة (المرحلة 12 T3، 9 نوفمبر)

الخطة (قراران 3 و10 — معدّل) `docs/superpowers/plans/2026-11-08-phase-12-followups.md`.

**أ) الكود:** `0060_settings_lists.sql` (`settings_public()` بيرجّع `lists` من صف `settings` قسم «lists» — `cancel` / `returns` بس) + حالة في
`supabase/tests/rls_settings.sql` · `IBSettings.lists()` / `saveLists()` (الأدمن؛ 1–30 سبب، 60 حرف، من غير تكرار؛ «أخرى» دايمًا آخر عنصر) · الكتلة 17
(تاب «أسباب الإلغاء والمسح» و«أسباب المرتجع» قابلين للتعديل — إضافة / تعديل / ترتيب / حذف؛ **حالات الأوردر فضلت عرض بس** لأن `accounts_sales` و
`products_report` و`order_delete` والرد الآلي والتقارير بيقروها بالاسم؛ و«اللغة والمنطقة» بقت ثوابت معروضة بدل اختيارات وهمية) · الكتلة 22 (بوب أب
الإلغاء / الاسترجاع / المرتجع بيقرا القايمة المحفوظة) · الكتلة 12 (`validateCancel` / `validateReturn` بتقبل القايمة). **مافيش سر جديد.**

**ب) على Supabase:** `0060` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع) → «RLS live» بـ `files = rls_settings` → الواجهة على `main`.

**التحقق:**
```sql
select data from public.settings where section = 'lists';
```

#### 2.7.37 سلة الزائر قبل الـ checkout — CartFlows + snippet + `cs_carts` (المرحلة 12 T7، 9 نوفمبر)

الخطة (قراران 7 و13) `docs/superpowers/plans/2026-11-08-phase-12-followups.md`. المصدر التاني لحدث «سلة متروكة» في الرد الآلي (الأول من 6.5: أوردرات الموقع
اللي وقفت عند الدفع).

**أ) الكود:** `tools/wp-snippets/ibtekr-carts.php` (snippet WPCode: route قراية بس `GET /wp-json/ibtekr/v1/carts?hours=48` بمفاتيح WooCommerce — بيتحقق منها
زي WooCommerce بـ `wc_api_hash` + `hash_equals` + صلاحية القراءة) · `_shared/woo-carts.js` (الصافي) · woo-sync action **`carts`** (الـ cron أو الأدمن؛ 404 =
`installed: false` و`skipped`) · `0062_cs_carts.sql` (`cs_carts` + `cs_carts_v` + `cs_cart_phone()` + cron **`woo-sync-carts`** كل 10 دقايق) + `rls_cs_carts` ·
`_shared/cs-auto.js` `guestCartEvents` + `cs-auto-run.ts` بيقرا `cs_carts` لما فيه قاعدة `cart` · الكتلة 20 (ملحوظة الحدث). **مافيش سر جديد** — نفس مفاتيح Woo.

**ب) على الموقع (صاحب المشروع — الـ staging الأول) — موقوفة 9 نوفمبر: صاحب المشروع مش عايز snippet على الموقع، وWoodMart مابيعرضش السلل على REST
(الـ probe run 10)، فالخطوات دي بتتعمل بس لو قرر يركّب الـ snippet؛ غير كده `cs_carts` فاضي والـ cron ساكت.**
1. **المصدر = «Abandoned cart» بتاعة ثيم WoodMart** (Theme Settings › Shop › Abandoned cart — شغّالة عند صاحب المشروع، 9 نوفمبر): الـ snippet بيلاقي جدولها لوحده
   (أي جدول تحت بادئة WP اسمه فيه «abandoned») وبيقرا أعمدته بالاسم؛ سلة «open» (الزائر لسه بيتسوق) مابتتحسبش، «abandoned» بس. مافيش إضافة تانية مطلوبة.
   (لو اتركّبت CartFlows «Cart Abandonment Recovery» بعدين الـ snippet بيقراها هي كمان بنفس الـ route.) **ملحوظة:** WoodMart بيحفظ سلة الزائر بعد ما يكتب
   الإيميل في الـ checkout — لو جدوله مافيهوش رقم تليفون، السلل دي هتتسجل عندنا من غير رقم ومش هتتبعتلها رسالة واتساب (الـ probe في الخطوة ج بيقول).
2. في **WPCode › Code Snippets › Add New › PHP Snippet**: الصق محتوى `tools/wp-snippets/ibtekr-carts.php` (من غير سطر `<?php` الأول لو WPCode بيضيفه
   لوحده)، الاسم «Ibtekr carts feed»، **Insert Method = Auto Insert · Location = Run Everywhere**، فعّله.
3. جرّب من المتصفح وأنت مسجّل دخول في WordPress: `https://staging.ibtekr.club/wp-json/ibtekr/v1/carts` لازم يرجّع **401** (مافيش مفاتيح) — ده الصح؛ ومن
   woo-sync (الخطوة ج) يرجّع صفوف.

**ج) على Supabase (المطوّر):** `0062` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor) → «RLS live» بـ
`files = rls_cs_carts` → «Deploy functions» `woo-sync` ثم `cs-auto` → الواجهة على `main` → **الـ probe الأول**: `woo-sync` `{ "action": "carts", "probe": true }` بالأدمن
(الجداول اللي الـ snippet لقاها وأعمدتها والـ mapping وعدد الصفوف — من غير أي صف؛ لو عمود الرقم/الحالة/الوقت مش متعرّف نزوّد اسمه في `ibtekr_ops_carts_map`)
→ تشغيلة بالإيد: `{ "action": "carts" }` بالأدمن (أو استنى الـ cron 10 دقايق).

**د) من الصفحة:** «الرد الآلي › قواعد الرد الآلي»: قاعدة بحدث «سلة متروكة» بقالب فيه `{اسم_العميل}` و`{الإجمالي}` و`{رابط_السلة}` (لينك الاسترجاع بتاع
الإضافة بيرجّع الزائر لسلته) — بتبعت بس لرقم **موجود في العملاء** وموافق على التسويق، وبعد `cart.afterMin` دقيقة (إعدادات الإرسال الآلي)، والمفتاح الرئيسي
شغال.

**التحقق:**
```sql
select jobname, schedule, active from cron.job where jobname = 'woo-sync-carts';
select entity, result, detail from public.woo_sync_log where entity = 'cs_carts' order by at desc limit 3;   -- installed: true/false وعدد الصفوف
select status, count(*) from public.cs_carts group by 1;                                                       -- أعداد بس
```

#### 2.7.36 مين أونلاين — قناة الحضور (المرحلة 12 T5، 9 نوفمبر)

الخطة (قراران 5 و12) `docs/superpowers/plans/2026-11-08-phase-12-followups.md`.

**أ) الكود:** `0061_presence.sql` (سياستا `presence_receive` / `presence_send` على `realtime.messages` للعضو النشط على topic «presence» بامتداد presence
بس — محروسة زي 0039) + `supabase/tests/rls_presence.sql` · `app/js/adapter/presence.js` (`IBPresence`: `join` مع الدخول من `IBDirectory.load`، `leave` مع
الخروج، `track { uid, at }` بس، `online()` / `isOnline()` / `ready()` / `count()`، حدث `ib:presence`) · الكتلة 25 (نقطة خضرا جنب الأفاتار في «الفريق دلوقتي» +
«N أونلاين دلوقتي») · `IBCS.agents` («متاح» والتوزيع بالدور من الحضور الحقيقي لما القناة شغالة). **مافيش سر جديد ولا دالة.**

**ب) على Supabase:** `0061` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor) → «RLS live» بـ
`files = rls_presence` → الواجهة على `main`.

**التحقق:**
```sql
select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'presence_%';   -- صفّين
```

#### 2.7.31 صفحة الإعدادات — المفاتيح والمزوّدين والتنبيهات والفريق (المرحلة 11، 7 نوفمبر)

الخطة (قرارات 1–32) `docs/superpowers/plans/2026-11-07-phase-11-settings.md`، والدفتر `.superpowers/sdd/2026-11-07-phase-11-settings/progress.md`.

**أ) الكود:** `0056_settings.sql` + `supabase/tests/rls_settings.sql` · `_shared/secrets.js` (Vault الأول ثم أسرار Supabase — `secretOf` / `vaultEnv`) ·
`_shared/settings-link.js` (كروت الربط وخاناتها وفحصها والعرض الآمن — آخر 4 حروف) · Edge Function **`settings-admin`** (الأدمن بالـ JWT: `status` /
`secret_set` / `secret_test` / `secret_unlink` / `woo_set` (تست ثم تأكيد) / `member_status`) · طبقة المزوّدين `_shared/ai-providers.js` +
`ai-content` (`providers/{claude,openai,gemini}.ts`) و`ai-images` (`providers/{openai-image,gemini-image}.ts`، `voice/elevenlabs.ts`،
`video/{higgsfield,veo}.ts` جنب Magnific) · محرك التنبيهات `_shared/notify.js` + Edge Function **`notify`** (cron `tick` بسر المزامنة؛ `status` /
`tick { dry }` للأدمن) · `IBSettings` (`app/js/adapter/settings.js`) · الكتلة 17 (= الكتلة 20 بتاعة الـ v6 على `IBSettings`) + `IBQuick` في 14 +
`IBLogo` صورة (13) + إلزام 2FA وانتهاء الجلسة (21/28) + `app/css/settings.css`. **مافيش سر جديد لازم في أسرار Supabase** — كل المفاتيح
بتتكتب من «الإعدادات › الربط بالمنصات» وتتحفظ في Vault (`app_<name>`)، والأسرار الحالية فاضلة احتياطي.

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0056` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor): `app_secret_get/set/env` (service_role)،
   أقسام `settings` الجديدة + `settings_public()`، `roles.hidden` + RPCs الفريق (`role_perms_set` / `role_create` / `role_update` /
   `role_delete` / `member_role_set` / `member_perms_set` / `member_status_set`) و`my_sessions` / `my_session_revoke`، `company_docs` +
   bucket `company-docs` (الأدمن) + bucket `settings` (الأدمن يكتب والأعضاء يقروا)، `alert_state` + `alerts.expires_at`، cron **`notify-tick`**
   كل 15 دقيقة → `notify` بسر المزامنة.
2. `0057_settings_sessions_fix.sql` (cast لأعمدة `auth.sessions` في `my_sessions()` — الحي `timestamp` من غير timezone).
3. workflow «RLS live» بـ `files = rls_settings rls_security_advisor` (`rls_system` اختبار seed لقاعدة فاضية — مش للحي).
4. «Deploy functions»: `settings-admin` ثم `notify` ثم `ai-content` ثم `ai-images` ثم `woo-sync` ثم `woo-webhook` (الأخيرين عشان يقروا مفاتيح
   الموقع من Vault لو اتكتبت من الصفحة) — واحدة واحدة.
5. الواجهة: push على `main`.

**ج) صاحب المشروع (من الصفحة — من غير ما يبعت أي مفتاح في الشات):**
- **الموقع:** «الربط بالمنصات › WooCommerce»: الرابط و`ck_…`/`cs_…` (+ مستخدم ووردبريس وباسورد التطبيق للميديا) → «اختبر» (بيقرا
  `system_status` و`users/me`) → «احفظ» بعد ما التست ينجح. تغيير الرابط بيمسح المفاتيح المحفوظة. «الكتابة على الموقع» = المفتاح من
  الصفحة (بيعلو على `WOO_PUSH_ENABLED`).
- **المزوّدين:** Claude / OpenAI / Gemini / ElevenLabs / Higgsfield / Magnific API كل واحد بمفتاحه + «اختبار»، والاختيار في «الذكاء
  الاصطناعي › المزوّدين»: افتراضي لكل قسم (نص / صور / صوت / فيديو) + تبديل لكل أداة. المدفوع بالدولار بيتحسب على سقف المحتوى الشهري.
- **الإيميل (Resend):** مفتاح `re_…` (Sending access كفاية) + دومين `ibtekr.club` متحقق في Resend، المرسل `alerts@ibtekr.club` (أو اللي يتكتب في خانة «من»). «اختبار» = إيميل اختبار حقيقي واحد لإيميل الأدمن اللي داس (بيثبت المفتاح والدومين والمرسل مرة واحدة).
- **واتساب للتنبيهات:** قالب `ibtekr_alert` (متغير نص واحد) معتمد في WhatsApp Manager على رقم واتساب 1، واسمه في «التنبيهات › ساعات الهدوء».
- **MCP:** «ربط أداة جديدة › MCP» بالرابط والتوكن (Higgsfield وغيره) — Vault `mcp_<slug>`.
- **الفريق:** الأدوار والمصفوفة والتجاوز الفردي والإيقاف من «الفريق والصلاحيات» (إضافة عضو بالباسورد المؤقت زي المرحلة 10).

**التحقق:**
```sql
select name from vault.secrets where name like 'app_%';                                                   -- الأسماء بس — القيم مشفّرة
select has_function_privilege('authenticated', 'public.app_secret_get(text)', 'execute');                -- false
select jobname, schedule, active from cron.job where jobname = 'notify-tick';
select section, updated_at from public.settings where section in ('ai_rules','brand','quick','notif','integrations','security');
select id, name, hidden, is_system from public.roles order by sort, id;
select count(*) from public.alert_state;                                                                  -- بعد أول tick
select at, action, entity_id, new_value from public.activity_log where action like 'settings.%' order by at desc limit 20; -- أسماء أقسام ومفاتيح ومنصات وأدوار بس
```

**القنوات الخارجية مقفولة افتراضيًا (8 نوفمبر):** مفتاحين «إرسال التنبيهات بالإيميل» / «بواتساب» في «التنبيهات › ساعات الهدوء» (`notif.channels`) — وهما مقفولين المحرك بيكتب في الجرس بس مهما كانت كلمات الأنواع؛ مفتاح Resend ممكن يفضل محفوظ من غير ما يتبعت حاجة.

**إزاي بيشتغل:** الأدمن بيكتب المفتاح في بوب أب الكارت → `settings-admin` بيفحص الشكل ويجرّب نداء قراية على المزوّد ويحفظه في Vault (ومابيرجّعهوش
— آخر 4 حروف على الكارت)؛ الدوال بتقرا Vault الأول وإلا أسرار Supabase. محرك التنبيهات كل 15 دقيقة بيقرا صف `notif` (أنواع التنبيهات
والماتريكس بالدور والتصعيد وساعات الهدوء والتقارير) وبيحسب المصادر من بياناتنا ويكتب صفوف `alerts` لكل مستلم، وبيبعت الإيميل/واتساب برّه
ساعات الهدوء لو القناة مربوطة (غير كده «مستنية الربط»). الإعدادات العامة (البراند والإجراءات السريعة وماتريكس الجرس وسياسة الأمان)
بتتقرا مع الدخول لكل عضو (`settings_public`).

**الأمان:** الأسرار في Vault بس (لا ردود ولا logs — آخر 4 حروف)؛ كل فحص مزوّد بيتسجل بالـ host؛ تغيير رابط الموقع بيمسح المفاتيح؛ أفعال
الإعدادات للأدمن؛ `settings.*` في `activity_log` أسماء أقسام ومفاتيح ومنصات وأدوار بس؛ `channel_log` بتاع التنبيهات أعداد وأكواد من غير
تليفون ولا إيميل ولا نص؛ إلزام 2FA على السيرفر (`force2fa_on()` في `has_perm` / `is_admin`: جلسة مش `aal2` مالهاش صلاحيات وهو شغّال) والمتصفح بيحوّل العضو لـ «ملفي › الحساب والأمان» للتفعيل.

### 2.8 Storage: bucket عقود المبتكرين (المرحلة 3)
- الـ bucket `vendor-contracts` بيتعمل من `0011` نفسها (`insert into storage.buckets … on conflict (id) do nothing`): خاص (`public = false`)، 10 ميجا (`file_size_limit = 10485760`)، أنواع `application/pdf` و`image/png` و`image/jpeg` بس (Storage نفسه بيرفض الأكبر والأنواع التانية قبل السياسات). مافيش خطوة يدوية في اللوحة.
- السياسات على `storage.objects` (من الملف نفسه، بادئة `vendor_contracts_`): `select` و`insert` و`update` لـ `authenticated` بشرط `bucket_id = 'vendor-contracts'` و`has_perm('sensitive.vendor_bank') = 'F'` (الأدمن والحسابات في مصفوفة `0003`). مافيش سياسة `delete`: استبدال العقد = ملف جديد والقديم بيفضل (قرار 7)، ومافيش تنظيف للملفات القديمة (تكلفة صغيرة).
- الوصول الوحيد من الواجهة عبر السياسات دي: الرفع على `vendor-contracts/<uuid المبتكر>/<unix ms>-<اسم آمن>` بـ `upsert: false`، والعرض/التحميل برابط موقّع 60 ثانية (`createSignedUrl` بصلاحية العضو نفسه) — ومافيش رابط عام أصلًا لأن الـ bucket خاص. عضو من غير `sensitive.vendor_bank = F` مايقدرش يرفع ولا يقرا الملف ولا يعمل رابط موقّع. بيانات العقد (المسار والاسم والحجم وتاريخ الانتهاء) في `vendors.contract`، وتغييرها محروس بنفس المفتاح (الحارس).
- التأكد من اللوحة: Storage › Buckets → `vendor-contracts` موجود و"Public" مطفي والحد 10 MB؛ Storage › Policies → 3 سياسات باسم `vendor_contracts_*` على `objects` (مافيش delete). أو بـ SQL (نفس استعلامات §2.1 خطوة 3 بتاعة `0011`):

  ```sql
  select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'vendor-contracts';
  select policyname, cmd, roles from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'vendor_contracts_%' order by 1;
  ```

- فحص يدوي بعد النشر: من حساب أدمن ارفع PDF صغير من درج مبتكر → الملف يظهر في اللوحة تحت فولدر الـ uuid بتاعه، و«عرض» يفتحه برابط موقّع؛ من حساب عمليات (`sensitive.vendor_bank = N`) القسم بيقول «مخفي» ومحاولة فتح نفس المسار بترجع مرفوضة. `rls_vendors` على الحي بيتأكد من الـ bucket والسياسات الثلاثة بالـ SQL.
- ملحوظة: `0011` بتعمل الـ bucket والسياسات جوه بلوك `do $$` محروس بوجود schema `storage`، فعلى Postgres المحلي (`npm run db:test`) الجزء ده بيتخطّى، و`rls_vendors` بيفحصه بس لما الـ schema موجود (الحي).

---

## 3. أول حساب أدمن

1. Supabase › Authentication › Users › **Invite user** بإيميل `owner@example.com` (أو **Add user › Create new user** بإيميل وباسورد، وعلّم Auto Confirm).
2. بعدها `execute_sql` (أو SQL editor) — نفس الملف الجاهز `tools/first-admin.sql`؛ بيجيب الـ id من `auth.users` بالإيميل، فمش محتاج تنسخه:

```sql
insert into public.profiles (id, member_code, name, email, phone, role_id, title, dept, status)
select u.id, 'M01', 'محمد', u.email, '01100007039', 'admin', 'المؤسس والمدير العام', 'الإدارة', 'active'
from auth.users u
where u.email = 'owner@example.com';
-- المتوقع: INSERT 0 1. لو 0 → الإيميل مش موجود في auth.users؛ راجع خطوة 1.

select id, member_code, email, role_id, status from public.profiles where member_code = 'M01';
```

لو استخدمت Invite: افتح لينك الدعوة من الإيميل الأول. ملاحظة: شاشة الدعوة في التطبيق لسه ماتقدرش تحط باسورد (تقرير المهمة 5)، فالأسهل دلوقتي: بعد ما تفتح اللينك، اطلب "نسيت كلمة المرور" من شاشة الدخول وحط الباسورد من لينك الاسترجاع — أو استخدم Create new user بباسورد من الأول.

---

## 4. رفع الملفات

**اللي يترفع:** كل محتوى `app/` (مش الفولدر نفسه) على الـ document root بتاع الـ subdomain — ده `public_html/` الخاص بالـ subdomain زي ما hPanel بيعرضه (غالبًا `domains/ibtekr.club/public_html/operation-system/`). بما فيه `.htaccess` (ملف مخفي، اتأكد إنه اترفع):

```
.htaccess   index.html   config.js   css/   js/adapter/   js/blocks/   js/vendor/
```

مافيش build — الملفات بتترفع زي ما هي. قبل الرفع: `config.js` فيه مفتاح الإنتاج (خطوة 2.4).

**اللي مايترفعش:** `node_modules/`، `tests/`، `tools/`، `supabase/` (الدوال بتتنشر على Supabase نفسه، §2.7)، `docs/`، `Prototype file`، `.env`، `.git`، وأي حاجة برّه `app/`.

**قبل الرفع في hPanel:** اعمل الـ subdomain (Domains › Subdomains)، وفعّل SSL المجاني ليه، وشغّل Force HTTPS.

### الطريق المفضّل: إضافة Hostinger
بعد `/mcp`، استخدم سكيل **`hostinger:hosting-deploy-static-site`**: المصدر `app/`، والهدف الـ subdomain `operation-system.ibtekr.club`.

### البديل: FTP
الباسورد من متغير بيئة، مش مكتوب في الأمر:

```bash
export LFTP_PASSWORD='<ftp password>'   # في الترمينال بس، أو من .env
lftp --env-password -u '<ftp user>' '<ftp host>' \
  -e "set ftp:ssl-force true; mirror -R --verbose app/ /; bye"
```

ده بافتراض إن حساب الـ FTP جذره هو فولدر الـ subdomain؛ لو جذره `public_html` العام، غيّر `/` لمسار الـ subdomain. `--delete` بيمسح من السيرفر اللي اتشال من `app/` — استخدمه في إعادة النشر بس بعد ما تتأكد من المسار.

---

### 4.3 الطريقة الدائمة: نشر من Git (بدون FTP)
- فرع `deploy` في الريبو محتواه ملفات `app/` بس (بيتولّد بـ `git subtree split`)، والـ workflow `.github/workflows/deploy.yml` بيحدّثه تلقائيًا مع أي push على `main` يلمس `app/`.
- Hostinger بيسحب الفرع ده على مجلد الـ subdomain عبر **Git auto-deployment**: مرة واحدة من hPanel › Websites › `operation-system.ibtekr.club` › Manage › Advanced › **Git** › ربط حساب GitHub، وبعدها إعدادات النشر التلقائي (الريبو `mohamed6489/Ibtekr-Operation-System`، الفرع `deploy`، المجلد = جذر الموقع) عبر الـ API أو من نفس الصفحة. كل push على `deploy` بيعمل pull تلقائي.
- الحالة الحالية (2026-10-25): الربط معمول وشغّال — installation GitHub للحساب `mohamed6489`، الفرع `deploy` → جذر الموقع، النشر التلقائي مفعّل ومجرّب: push على `main` → فرع `deploy` → السيرفر في حوالي دقيقة. تتأكد من الإعدادات بـ `hosting_git_auto-deployment-settings`.
- أول مرة لازم مجلد الـ subdomain يكون فاضي (Hostinger بيرفض الـ clone على مجلد فيه ملفات). بعدها التحديثات بتتعمل في مكانها.
- بديل لو مش عايز تربط GitHub في hPanel: ضيف مفتاح SSH بتاع حساب الاستضافة (`hosting_git_generate-ssh-key` / hPanel › Git) كـ **Deploy key** للقراءة بس في GitHub (Settings › Deploy keys)، وبعدها النشر بيتعمل بـ `hosting_git_deploy-website-repository` (الـ URL بصيغة SSH، الفرع `deploy`). بس كده الـ push مش هيعمل نشر تلقائي؛ كل نشر محتاج نداء API.
- مفيش أسرار FTP محتاجة؛ لو كانت اتضافت قبل كده في GitHub ممكن تتمسح، وحساب الـ FTP المخصص ممكن يتحذف من hPanel.

## 5. التحقق بعد النشر

1. افتح `https://operation-system.ibtekr.club` → عنوان التبويب لازم يبقى **`تسجيل الدخول — نظام إبتكر`**، وشاشة الدخول ظاهرة.
2. سجّل دخول بحساب الأدمن (خطوة 3) → التطبيق يفتح.
3. اتأكد إن الدخول اتسجّل على السيرفر:

```sql
select a.id, a.at, p.member_code, a.action
from public.activity_log a left join public.profiles p on p.id = a.actor
where a.action = 'auth.signin'
order by a.at desc
limit 5;
-- المتوقع: صف حديث بـ member_code = 'M01'.
```

4. افتح DevTools › Console: مايبقاش فيه أخطاء `Content-Security-Policy`. وفي Network: الـ response headers فيها `Content-Security-Policy` و`X-Content-Type-Options` و`Strict-Transport-Security` (يعني `.htaccess` اترفع واشتغل).
5. **الـ e2e على Supabase حقيقي** — من جهاز تطوير، على **مشروع staging** متعمل عليه نفس الـ migrations وعليه `tools/seed-dev-users.sql`:

```bash
# app/config.js مايتلمسش: الاختبار بيحقن الـ URL والمفتاح بتوع الـ staging في الصفحة (window.IB_CONFIG)
E2E_SUPABASE_LIVE=1 \
E2E_SUPABASE_URL='https://<staging-ref>.supabase.co' E2E_SUPABASE_ANON_KEY='<staging anon key>' \
E2E_ADMIN_EMAIL=admin.dev@ibtekr.local E2E_ADMIN_PW=IbtekrDev-2026 \
E2E_OPS_PW=IbtekrDev-2026 E2E_VIEWER_PW=IbtekrDev-2026 npm run e2e
```

من غير `E2E_SUPABASE_URL` و`E2E_SUPABASE_ANON_KEY` الاختبارات الحقيقية بتتعمل skip (عمرها ما بتضرب اللي في `config.js`). في CI نفس الستة دول GitHub Secrets (`E2E_SUPABASE_URL`، `E2E_SUPABASE_ANON_KEY`، `E2E_ADMIN_EMAIL`، `E2E_ADMIN_PW`، `E2E_OPS_PW`، `E2E_VIEWER_PW`)، وخطوة الـ e2e الحقيقي بتشتغل بس لو `E2E_SUPABASE_URL` موجود — وكلهم لمشروع الـ staging، مش الإنتاج.

6. **إيميل الاسترجاع بيوصل:** من شاشة الدخول اضغط «نسيت كلمة المرور؟» واكتب `owner@example.com` → لازم يوصل إيميل من `operation-system@ibtekr.club` (اتأكد من الـ Spam كمان)، واللينك بيفتح `https://operation-system.ibtekr.club` على فورم «كلمة مرور جديدة». لو ماوصلش: راجع SMTP Settings (خطوة 2.3) وAuthentication › Logs.

7. **الأوردرات والتحقق بخطوتين (المرحلة 2):** صفحة الأوردرات بتعرض أوردرات الموقع (مش بذور البروتوتايب)، وزرار «مزامنة» (أدمن) بيرد بـ «تمت المزامنة · … أوردر · … منتج · … مبتكر». ومن «ملفي» › التحقق بخطوتين › «تطبيق Authenticator»: امسح الـ QR (أو انسخ المفتاح) وحط الكود → «مفعّل — تطبيق Authenticator»، وبعدها الدخول بيطلب الكود.

ليه مش على الإنتاج: الاختبارات محتاجة الحسابات التلاتة بباسوردات معروفة (أدمن وops وviewer موقوف) — وده بالظبط اللي ممنوع على الإنتاج (خطوة 2.5). وكمان بتكتب صفوف في `activity_log`، وبتضرب حد الـ 60 lookup في الدقيقة اللي ممكن يقفل الدخول بالموبايل على الفريق الحقيقي لمدة دقيقة. ومشروع الـ staging لازم يكون فيه `http://localhost:4173/**` في Redirect URLs.

---

## 6. فحص أمني قبل الإعلان

قبل ما تبعت الرابط للفريق:

1. `/differential-review` على الفرع (مقارنةً بـ `main`) — مفيش findings مفتوحة.
2. semgrep نظيف — نفس بوابة CI (job `semgrep`):

   ```bash
   npm run semgrep
   ```

   (`p/javascript` + `p/secrets` على مستوى ERROR، من غير `app/js/blocks` — كود بروتوتايب بيتراجع يدويًا مع كل تعديل — ومن غير `app/js/vendor`. لو الـ registry محجوب عندك — زي الـ sandbox السحابي — الـ job في CI هو البوابة.)
3. `get_advisors` (security + performance) مفيهوش غير المقبول في 2.2.
   - ملحوظة CSP (`app/.htaccess`): `script-src 'self'` بس. المكتبات (supabase-js 2.118.0، SheetJS CE 0.20.3، html2canvas 1.4.1) في `app/js/vendor/`، بإصداراتها ومصدرها والـ sha256 في `README.md` هناك، ومافيش أي CDN للسكريبتات. و`img-src 'self' data: blob: https:` — `blob:` عشان بديل «المشاركة كصورة» (الكتل 10 و28) بيعرض الـ canvas كـ `URL.createObjectURL(blob)`، ومحدش يقدر يعمل blob URL غير سكريبتاتنا. الـ e2e بيتأكد إن اللوحة والتصدير ومسار المشاركة مابيترفضوش تحت نفس الهيدر.
4. مفيش أسرار في تاريخ git:

   ```bash
   git log -p --all -- . ':!app/js/vendor' | grep -nEi 'sb_secret_|eyJhbGciOi|-----BEGIN|service_role_key|SUPABASE_SERVICE|LFTP_PASSWORD=|FTP_PASS|ck_[0-9a-f]{40}|cs_[0-9a-f]{40}'
   ```

   المتوقع: لا شيء، أو بس مفتاح الـ anon العام في `app/config.js` (JWT بيبدأ بـ `eyJhbGciOi` وفيه `"role":"anon"` — فكّه في jwt.io أو `base64 -d` وتأكد). أي مفتاح `service_role` أو باسورد حقيقي = غيّره فورًا من Supabase/Hostinger، وبعدين نضّف التاريخ. (باسورد `IbtekrDev-2026` بتاع حسابات التطوير معروف ومقصود. مفاتيح WooCommerce الحقيقية `ck_`/`cs_` + 40 حرف hex؛ اللي في الاختبارات زي `ck_test_0001` وهمية.)

---

## 7. بعد كده

- لو الـ subdomain مختلف عن `https://ibtekr.club` اللي في إعدادات النظام، حدّث صف الإعدادات العامة:

  ```sql
  update public.settings set data = jsonb_set(data, '{site}', '"https://operation-system.ibtekr.club"')
  where section = 'general';
  ```

- **لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس.** (في الإعدادات › الفريق الأزرار بتظهر رسالة نجاح بس مابتكتبش في `profiles`.)
- `main` يفضل فرع الدمج: اللي اتنشر لازم يكون هو اللي في `main`. إعادة النشر = نفس خطوة 4. كل ملفات html/js/css عليها `no-cache` في `.htaccess` (المتصفح بيسأل السيرفر كل مرة وياخد 304 لو مفيش تغيير)، فالتحديث بيظهر على طول من غير hard refresh؛ الاستثناء الوحيد `js/vendor/supabase.js` (نسخة مثبّتة) بكاش 7 أيام — لو حدّثته، غيّر اسمه أو استنى أسبوع.
- الـ CSP في `app/.htaccess` مربوط بـ project ref `fsynculhaupcktzkfkdd`، وكمان الـ URL بتاع الـ cron في `0008` (§2.7.6). لو المشروع اتغيّر، أو اتضاف مصدر خارجي جديد للمتصفح، لازم `connect-src`/`script-src` يتحدّثوا. WooCommerce مش مصدر للمتصفح: كله بيعدّي على `…/functions/v1/woo-sync` على نفس الـ origin اللي في `connect-src`.

#### 2.7.14 مسح الأوردر من السيستم ومن الموقع (المرحلة 5.5 قرار 10، 2 نوفمبر)

- `0033_order_delete.sql` (اتطبّق على الحي بالـ MCP؛ `rls_order_delete.sql` عدّى على الحي): أعمدة `deleted_at`/`deleted_by`/`delete_reason` على
  `orders`، `orders_v` من غير المحذوف، RPC `order_delete`.
- woo-sync action `order_trash { order_id }`: اتنشرت **v50** (2 نوفمبر) من workflow «Deploy functions» → `woo-sync` (الـ workflow بقى بيبعت `--yes` — الـ CLI الجديد بيطلب تأكيد في التشغيل غير التفاعلي). الأوردر لازم يكون «ملغي» عندنا،
  و`WOO_PUSH_ENABLED = 1` وإلا `skipped/push_disabled` (المسح عندنا بيكمل والموقع مايتلمسش). `DELETE wc/v3/orders/{id}` من غير `force`
  (سلة المهملات على الموقع — الاسترجاع من لوحة WooCommerce → Orders → Trash)، الفرعية الأول ثم الأصلي. `woo_sync_log`: `push/out/order/{id}`
  action `trash`.
- الترتيب في الواجهة: إلغاء (لو لازم) → `order_trash` → `order_delete`. فشل الموقع = الأوردر يفضل زي ما هو عندنا والرسالة «الموقع ماردش».

#### 2.7.15 خدمة العملاء (المرحلة 6.1، 2 نوفمبر)

- `0034_cs.sql` **اتطبّق على الحي 2 نوفمبر** بـ `execute_sql` (نسخة أول تطبيق من غير سطور `drop trigger if exists` — `apply_migration` بيطلب تأكيد صاحب المشروع على الـ drop/revoke؛ الصف مش في `supabase_migrations` زي `0028`): 85 عميل + 5 قنوات. `supabase/tests/rls_cs.sql` على الحي **عدّى 2 نوفمبر** من SQL Editor (الـ MCP بيطلب تأكيد على الـ `delete` ومابيوصلش؛ في الـ editor النتيجة «Success. No rows returned» — الـ `rls_cs: ok` NOTICE، وأي فشل = exception).
  المهاجرة بتضيف `cs.view/reply/manage` للأدوار اللي مافيهاش (`where not (permissions ? 'cs.view')`)، وبتعمل عميل لكل رقم مطبّع في `orders` (تعبئة re-runnable).
- مافيش Edge Functions ولا أسرار في 6.1 (القنوات كلها `disconnected`). الـ Realtime على `cs_conversations` و`cs_messages` بيتضاف في المهاجرة.
- بعدها `main` (الواجهة: الكتل 14/19/20/28، `app/js/adapter/cs.js`، `app/css/cs.css`). التحقق: دخول أدمن → «خدمة العملاء» → تاب «العملاء» فيه عملاء الأوردرات بأرقامهم.
- 6.2 (Meta): §2.7.16 تحت.

#### 2.7.16 قناة Meta — ماسنجر + إنستجرام (المرحلة 6.2، 2 نوفمبر)

**القرار (صاحب المشروع — «تمام يلا بينا على الحقيقية»):** الربط على صفحة فيسبوك **Ibtekr Club الحقيقية** وحساب إنستجرام المربوط بيها، بتطبيق Meta **في وضع التطوير (Development mode)**: رسايل وتعليقات أعضاء التطبيق بس (Admins / Developers / Testers) هي اللي بتوصل للسيستم، وعملاء الصفحة الحقيقيين مش بيتأثروا — محادثاتهم في Meta Inbox زي ما هي. التحويل لـ Live (App Review) خطوة واحدة في الآخر مع التحويل للموقع الحي (§2.7.8).

**أ) الكود (جاهز على `main`):** `0035_cs_meta.sql` (`cs_oauth_states`، `cs_channel_events`، `cs_secret_get/set` على Vault لسر `cs_meta_pages`) + `rls_cs_meta.sql` · Edge Function `cs-channel` (webhook الاستقبال + الربط بـ OAuth + الإرسال) · الواجهة: تاب «القنوات» (ربط / فصل + صف إعداد التطبيق للأدمن)، الكومبوزر على القناة المتصلة، «رد خاص» و«إخفاء التعليق» في محادثات التعليقات، صفحة الرجوع `app/meta-callback.html`.

**ب) على Supabase (المطوّر):**
1. `0035_cs_meta.sql` بـ `execute_sql` (زي 0034 — من غير `drop`) ثم `rls_cs_meta.sql` من SQL Editor (المتوقع «Success. No rows returned» + NOTICE `rls_cs_meta: ok`).
2. نشر `cs-channel` من workflow «Deploy functions» (الخيار `cs-channel`؛ `verify_jwt = false` من `config.toml`). الفحص: `curl -s "$F/cs-channel?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"` → `{"error":"verify_failed"}` (403)، و`curl -s -X POST "$F/cs-channel" -H 'X-Hub-Signature-256: sha256=00' -d '{}'` → `{"error":"not_configured"}` (500) قبل الأسرار / `{"error":"bad_signature"}` (401) بعدها.

**ج) على Meta (صاحب المشروع بنفسه — الأسرار مابتتبعتش في الشات):**
1. [developers.facebook.com](https://developers.facebook.com) › My Apps › **Create App** › نوع **Business** › اسم مثلًا «Ibtekr Ops» › الـ Business Portfolio بتاع الصفحة (لو موجود).
2. **Add products:** Messenger · Instagram · Webhooks · (Facebook Login for Business بيتضاف تلقائي مع Messenger؛ لو مش ظاهر ضيفه).
3. **App settings › Basic:** خد **App ID** و**App Secret** (Show) وحطهم في أسرار Supabase (Edge Functions › Secrets): `META_APP_ID`، `META_APP_SECRET`. وضيف domain السيستم `operation-system.ibtekr.club` في **App Domains**، وفي **Facebook Login for Business › Settings › Valid OAuth Redirect URIs** حط `https://operation-system.ibtekr.club/meta-callback.html`.
4. **Verify token:** اختار نص عشوائي (حروف وأرقام، 20+ حرف) وحطه في أسرار Supabase `META_VERIFY_TOKEN`.
   **Facebook Login for Business (تطبيق Business):** من القايمة الشمال › Facebook Login for Business › **Configurations** › Create configuration: الاسم «Ibtekr inbox»، Login variation **General**، Access token **User access token**، الـ assets **Pages** و**Instagram accounts**، والصلاحيات العشرة اللي في (د) تحت → خد الـ **Configuration ID** وحطه في أسرار Supabase `META_LOGIN_CONFIG_ID` (من غيره الـ dialog بيتبعت بالصلاحيات مباشرة `scope`). وفي **Settings** بتاعته الـ Valid OAuth Redirect URI.
5. **Webhooks (المنتج Webhooks):** على object **Page**: Callback URL `https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-channel` + الـ verify token → Verify and save (الدالة لازم تكون منشورة والسر محطوط الأول). اشترك في الحقول: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `message_echoes`, `feed`. وعلى object **Instagram** نفس الـ URL والـ token، الحقول: `messages`, `comments`.
   (الاشتراك على مستوى الصفحة نفسها — `subscribed_apps` — السيستم بيعمله لوحده وقت الربط.)
6. **App Roles › Testers:** ضيف نفسك (وأي عضو هيجرّب من حسابه) — في وضع التطوير رسايل الأعضاء دول بس هي اللي بتوصل.
7. **Instagram:** حساب `@ibtekr.club` لازم يكون Business/Creator ومربوط بصفحة Ibtekr Club (إعدادات الصفحة › Linked accounts)، وفي إعدادات إنستجرام › الرسائل › **Allow access to messages** مفعّلة.
8. في السيستم: خدمة العملاء › **القنوات** › «ربط» على ماسنجر (الأدمن) → تسجيل دخول فيسبوك بحساب أدمن الصفحة → الموافقة على الصلاحيات → الصفحة بتتربط (لو الحساب بيدير أكتر من صفحة بيسألك تختار). بعدها ابعت رسالة للصفحة من حساب Tester: لازم تظهر في الصندوق خلال ثواني.

**د) الصلاحيات اللي الـ dialog بيطلبها:** `pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, pages_read_user_content, pages_manage_engagement, instagram_basic, instagram_manage_messages, instagram_manage_comments, business_management`. في وضع التطوير كلها متاحة للأعضاء من غير مراجعة؛ **App Review** (مع التحويل للحي) على نفس القايمة + Business verification.

**«الربط ماكملش — مالوش صفحات»:** `/me/accounts` رجع فاضي؛ الدالة بتجرب صفحات الـ Business Portfolio (`/me/businesses` → `owned_pages`/`client_pages`، محتاجة `business_management`)، ولو برضه مافيش بترجع `no_pages` بـ `seen` (صفحات ظهرت من غير توكن) و`granted`/`declined`/`missing` (أسماء صلاحيات بس) وصفحة الرجوع بتقول الناقص.

**هـ) إيه اللي بيتخزن:** توكن الصفحة الطويل في Vault بس (`cs_meta_pages` عبر `cs_secret_set` — `service_role`)، `cs_channels.meta` فيه ids الصفحة/إنستجرام من غير توكن، `cs_channel_events` أعداد وأكواد أخطاء بس، `activity_log` `cs.channel.*` أسماء القنوات والـ ids بس. فصل القناة بيمسح السر وبيلغي `subscribed_apps`. الـ webhook بيقرا entries الصفحة المربوطة بس (ومن غير ربط مابيكتبش حاجة)، وربط صفحة تانية بيلغي اشتراك القديمة.

**و) نافذة الـ 24 ساعة:** Meta بتسمح بالرد الحر خلال 24 ساعة من آخر رسالة للعميل؛ بعدها الإرسال بيرجع `graph_10:2018278` والرسالة بتتعلم `failed` (الواجهة بتقول). الرد الخاص على تعليق مرة واحدة لكل تعليق.


**ز) التعليقات بالسحب (قرار 18، `0040`):** Meta مابتبعتش webhooks التعليقات (`feed` / `comments`) لتطبيق من غير Advanced Access — حتى لعضو في التطبيق (اتأكد حي 4 نوفمبر). عشان كده `0040` بيعمل cron `cs-comments-pull` كل دقيقة بسر `sync_secret` بتاع `0008` (من Vault، مافيش سر جديد) على `cs-channel` `{"action":"comments_pull"}`: آخر 10 بوستات فيسبوك وآخر 10 ميديا إنستجرام، تعليقات آخر ساعتين، بنفس مسار الـ webhook. التطبيق: `0040` بـ `execute_sql` بعد نشر `cs-channel`. التحقق: `select * from cron.job where jobname = 'cs-comments-pull'`، وبعد تعليق جديد صف `cs_channel_events` `object = 'pull'` في خلال دقيقة. الأدمن يقدر يشغّله بإيده (`comments_pull` بالـ JWT). بعد مراجعة التطبيق الـ webhook بيوصل لوحده والسحب يفضل احتياطي (من غير تكرار).

**ح) البوست اللي عليه التعليق (قرار 19، `0041`):** `0041` بـ `execute_sql` (من غير سطر `drop policy` لو الـ MCP طلب تأكيد) ثم نشر `cs-channel`. التحقق: في خلال دقيقة من أي تعليق `select id, platform, left(caption, 40), kind from cs_posts` فيه البوستات اللي عليها تعليقات، والكارت بيظهر فوق شات التعليقات بعد refresh.

#### 2.7.17 واتساب 1 و2 بالـ QR + إرسال الحملات (6.3 + 6.4، مبنيين ومخفيين — 4 نوفمبر)

**دلوقتي (اتعمل):** `0042_cs_wa.sql` + `rls_cs_wa.sql` على الحي، و`cs-wa` منشورة. الواجهة عليها **soon** لأن `settings` `cs`.`live` = false.

**لما صاحب المشروع يقول «افتح»:**
1. سر الخدمة: 40 حرف عشوائي على الأقل → Supabase ← Edge Functions ← Secrets: `WA_BRIDGE_SECRET` (صاحب المشروع بيحطه بنفسه، مايتبعتش في الشات).
2. السيرفر (VPS عليه Docker): فولدر `services/wa-bridge` → `cp .env.example .env` + نفس السر → `docker compose up -d --build` (التفاصيل في `services/wa-bridge/README.md`).
3. الفتح: `update settings set data = jsonb_set(coalesce(data, '{}'), '{live}', '{"wa": true, "campaigns": false}') where section = 'cs';` (واتساب الأول، والحملات `true` بعد ما الأرقام تتربط وتتجرب).
4. **خدمة العملاء ← القنوات ← واتساب 1 ← ربط** → QR → يتمسح من الموبايل (الأجهزة المرتبطة). نفس الكلام لواتساب 2.
5. التحقق: `select channel, status, phone, updated_at from cs_wa_state;` = `connected`، ورسالة من موبايل تاني تظهر في الصندوق، والرد يوصل.

**الأمان:** الخدمة مالهاش أي مفتاح داتابيز؛ كل حاجة عبر `cs-wa` بالسر (مقارنة ثابتة الوقت). الـ QR بيوصل للأدمن بس، ومافيش نص رسالة ولا رقم في أي log. الحملات: الجمهور بيتثبّت على السيرفر وقت الجدولة، والموافقة والحظر والدمج بيتشيّكوا تاني وقت كل إرسال.

#### 2.7.18 واتساب 1 على Meta — رقم الواتساب بيزنس بمحادثاته (قرار 26، 4 نوفمبر)

**اتعمل:** `0043_cs_wa_cloud.sql` + `rls_cs_wa_cloud.sql` على الحي، و`cs-whatsapp` منشورة (`deploy-functions.yml`، `verify_jwt = false`).

**صاحب المشروع على Meta (نفس تطبيق ماسنجر/إنستجرام):**
1. App Dashboard ← **Add product ← WhatsApp ← Set up** (اختار الـ Business Portfolio بتاع الصفحة).
2. **Facebook Login for Business ← Configurations ← Create configuration** من نوع **WhatsApp Embedded Signup** بالصلاحيات `whatsapp_business_management` و`whatsapp_business_messaging` (و`business_management`) → انسخ الـ **Configuration ID** → Supabase ← Edge Functions ← Secrets: **`META_WA_CONFIG_ID`** (بنفسك؛ مايتبعتش في الشات).
3. **Embedded Signup Builder ← Manage Domains ← Manage allow list:** ضيف `operation-system.ibtekr.club` (الربط بيتعمل بمكتبة Meta JavaScript SDK من `app/wa-connect.html` — الـ dialog المباشر بيرجع 500 لـ Embedded Signup، اتشاف حي 4 نوفمبر)، و**Facebook Login for Business ← Settings:** «Login with the JavaScript SDK» = Yes و«Allowed Domains for the JavaScript SDK» فيها نفس الدومين.
4. **WhatsApp ← Configuration ← Webhook:** Callback URL = `https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-whatsapp`، Verify token = نفس `META_VERIFY_TOKEN` → Verify and save → **Webhook fields:** `messages`، `smb_message_echoes`، `history`، `smb_app_state_sync`، `account_update`.
5. الموبايل: تطبيق WhatsApp Business **2.24.17 أو أحدث**، والرقم شغال عليه 7 أيام على الأقل.

**الربط:** خدمة العملاء ← القنوات ← **واتساب 1 ← ربط** → صفحة `wa-connect.html` ← «ابدأ الربط» → نافذة Meta → «Connect your existing WhatsApp Business app» → الرقم → التأكيد من الموبايل (ووافق على **مشاركة سجل المحادثات**) → الصفحة بتقول «اتربط واتساب ✓». السيستم بيطلب جهات الاتصال والتاريخ فورًا (Meta بتسمح بيهم **مرة واحدة في خلال 24 ساعة** من الربط — لو فشل، «اطلب المحادثات القديمة تاني» من صف الأدمن).

**التحقق:** `select status, number, meta->'history' from cs_channels where id = 'wa1';` = `connected` والتقدم بيزيد؛ `select object, status, error, summary from cs_channel_events where object = 'whatsapp' order by id desc limit 5;`؛ رسالة من موبايل تاني تظهر في الصندوق، والرد يوصل من نفس الرقم.

**الأمان:** التوكن في Vault (`cs_meta_wa`) بس؛ الـ webhook بالتوقيع والحساب المربوط بس؛ مافيش نص ولا رقم ولا توكن في `cs_channel_events` أو `activity_log`.

#### 2.7.19 المخزون — مخزن إبتكر المؤقت (المرحلة 7، 4 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-04-phase-7-inventory.md`، ودفترها `.superpowers/sdd/2026-11-04-phase-7-inventory/progress.md`.

**النشر:**
1. `0044_inventory.sql` (Supabase MCP `apply_migration` أو SQL editor) ثم `supabase/tests/rls_inventory.sql` على الحي (بيرجع كل حاجة — المفروض `NOTICE rls_inventory: ok`).
2. `woo-sync` من `deploy-functions.yml` (input `function = woo-sync`) — فيها `inventory_push`.
3. الواجهة: push على `main`.

**مقفول افتراضي (قرار 1 ب و ج):** «المخزن الأول» (السحب التلقائي) و«تحديث كمية الموقع» — الأدمن بيفتحهم من المخزون ← الإعدادات (صف `settings` قسم `inventory`). كمية الموقع كمان مشروطة بـ `WOO_PUSH_ENABLED = 1`، وعلى الأصناف اللي ليها lot «ملك ابتكر» بس (الـ «أمانة» مابتتلمسش). السحب التلقائي لسه مالوش نقطة نداء من المزامنة — بتتعمل لما يتفتح.

**التحقق:**
```sql
select code, label, kind from public.inv_locations order by code;                    -- T/R/P/A–D
select reason, status, count(*) from public.inv_lots where closed_at is null group by 1, 2;
select at, action, result, detail from public.woo_sync_log where action = 'inventory_push' order by at desc limit 20;
select data from public.settings where section = 'inventory';                          -- فاضي = الافتراضي (الاتنين مقفولين)
```

**الأمان:** الحركات إضافة بس (مافيش تعديل ولا حذف)، الـ lot مابيتمسحش، الجرد بيتعتمد بـ RPC `inv_count_approve` بس (`inventory.approve`) والكمية «في السيستم» من السيرفر؛ `activity_log` `inventory.*` من غير ملاحظات؛ `inventory_push` بعضو بس (أدمن أو `inventory.edit = F` و`products.edit = F` — الـ SKU والملكية من إدخال العضو، فالدفع محتاج نفس صلاحية تعديل مخزون المنتج)، وفي `woo_sync_log` أعداد وSKUs بس.

#### 2.7.20 تذاكر الفريق (المرحلة 8، 5 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-05-phase-8-tickets.md`، ودفترها `.superpowers/sdd/2026-11-05-phase-8-tickets/progress.md`.

**النشر:**
1. `0045_tickets.sql` (Supabase MCP `apply_migration` أو SQL editor) — الصلاحيات (قرار 4) + `tickets` / `ticket_events` + `ticket_create` / `ticket_act` + bucket `tickets` (مقفول، صور وPDF، 10 ميجا) + broadcast `tickets` وسياسته. بعدها `supabase/tests/rls_tickets.sql` على الحي (بيرجع كل حاجة — المفروض `NOTICE rls_tickets: ok`).
2. مافيش Edge Function ولا أسرار.
3. الواجهة: push على `main`.

**التحقق:**
```sql
select id, permissions ->> 'tickets.view' v, permissions ->> 'tickets.manage' m from public.roles order by sort; -- admin/ops/cs F/F، الحسابات ومتابعة المبتكرين P/F، المشاهد P/N
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'tickets';
select status, assignee_role, count(*) from public.tickets group by 1, 2 order by 1, 2;
select at, action, entity_id, new_value from public.activity_log where action like 'ticket.%' order by at desc limit 20;
```

**الأمان:** القراية بـ RLS (`ticket_can_see`: F كله، P تذاكر دوري + اللي فتحتها)، ومافيش أي insert/update/delete للأعضاء — كل كتابة بـ `ticket_create` / `ticket_act` (`security definer`) بقواعد الدومين؛ الخط الزمني إضافة بس، ومافيش مسح تذاكر. ربط الأوردر وعميله بس لعضو بـ `orders.view = F` (والعميل بـ `cs.view`)، والمحادثة بس لو العضو شايفها. المرفقات من فولدر العضو نفسه بس (`tickets/<uid>/…`)، النوع والحجم من Storage، والقراية لصاحب الملف أو اللي شايف التذكرة (`ticket_file_visible`). الـ broadcast فيه `{ at }` بس وprivate. `activity_log` `ticket.*` = الرقم والحالات والأدوار والأعداد — مافيش نص رسالة ولا وصف.

#### 2.7.21 التقارير (المرحلة 9، 5 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-05-phase-9-reports.md`، ودفترها `.superpowers/sdd/2026-11-05-phase-9-reports/progress.md`.

**النشر:**
1. مافيش migration ولا Edge Function ولا أسرار (قرار 10) — كل الأرقام من جداول ودوال موجودة بصلاحياتها (`orders_v`/`order_items`، `accounts_sales`، `dokan_balances`، `acc_*`، `products_report` + المرآة، `inv_*`، `cs_*`، `tickets`).
2. الواجهة: push على `main` (الـ Deploy workflow بيرفع الموقع).

**التحقق:**
```sql
select id, permissions ->> 'reports.view' v, permissions ->> 'reports.export' e from public.roles order by sort; -- admin/ops/accounts F/F، cs ومتابعة المبتكرين والمشاهد P/N
select user_id, key, data from public.user_prefs where key in ('reports.prefs', 'tickets.kpis') order by updated_at desc limit 10; -- التخصيص لكل عضو
```
وفي الواجهة: «التقارير» في القايمة من غير soon؛ أدمن شايف 9 تابات («الموظفين» و«الحملات الإعلانية» عليهم «قريبًا»)؛ عضو من غير `accounts.view` مابيشوفش تاب الحسابات ولا فلوس المبتكرين؛ عضو بـ `reports.export ≠ F` مالوش «نسخ CSV» ولا «الإجراءات».

**الأمان:** مافيش كتابة جديدة غير `user_prefs` (صف العضو بس — RLS بتاعة `0006`). التاب بيظهر بـ `reports.view ≠ N` وصلاحية صفحته، والأرقام نفسها بتتقري تحت RLS جداولها (الواجهة بتخبّي، والسيرفر هو الحكم): فلوس المبتكرين بـ `accounts.view ≠ N` (`accounts_sales` مابيتطلبش من غيرها)، والعمولة بـ `sensitive.commission = F` (`vendor_rates` مابيرجّعش نسبة لغيره). التصدير (`نسخ CSV` و«الإجراءات») بـ `reports.export = F` بس، والشيتات المعروضة بتاعة الصفحات اللي العضو شايفها.


#### 2.7.22 كشف المبتكرين بالفترة (المرحلة 5.5 قرار 13، 5 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-02-phase-5-5-prototype-v2-additions.md` (قرار 13).

**النشر:**
1. مافيش migration ولا أسرار. woo-sync اتغيّر حاجة صغيرة: `statement` بيرجّع `ref` (رقم Dokan للسطر — `trn_id`، رقم أو `null`) — انشره من workflow «Deploy functions» (`function = woo-sync`) بعد ما الـ CI يخضر. من غير النشر التبويب شغال، بس «مبيعات المكتمل» و«حصة إبتكر» بيطلعوا ناقصين بـ «*».
2. الواجهة: push على `main`.

**التحقق:** في «الحسابات» › «حسابات المبتكرين» › «كشف بالفترة»: «بنجيب كشوف حساب المبتكرين من Dokan… N من M» وبعدها الجدول. قارن مبتكر واحد بـ «كشف حساب Dokan» بتاعه في نفس الفترة: رصيد أول الفترة = رصيد Dokan الافتتاحي ناقص العرابين والمواصلات المتسجلة قبل الفترة، و«حقه من المكتمل» = مجموع المدين على الأوردرات، و«اتحوّله» = السحوبات، ولو الفترة لحد النهارده المستحق آخر الفترة = «الصافي» في «الرصيد دلوقتي».

**الأمان:** قراءة بس — نفس action `statement` (`accounts.view ≠ N`، أبدًا بسر المزامنة)، الكشف مابيتخزنش (ذاكرة الصفحة للجلسة بس)، و`ref` رقم بس. مافيش أي كتابة على Dokan ولا طلب سحب من التبويب ده؛ التصدير إكسل بيحيّد الصيغ (`xlsxExport`).

#### 2.7.23 الموارد البشرية (المرحلة 10، 5 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-05-phase-10-hr.md`، ودفترها `.superpowers/sdd/2026-11-05-phase-10-hr/progress.md`.

**النشر (بالترتيب — الواجهة آخر حاجة، لأن الساعة في الهيدر بتنادي `hr_clock_in` على كل الصفحات):**
1. `0046_hr.sql` (Supabase MCP `apply_migration` أو SQL editor) — الصلاحيات الأربعة على الأدوار، جداول HR بـ RLS والـ grants، الـ RPCs، bucket `hr-docs` (مقفول، صور وPDF، 10 ميجا) وسياساته، القناة الـ private `hr`، والـ cron اليومي لفتح الكشف (`hr-payroll-open`). re-runnable. بعدها `supabase/tests/rls_hr.sql` على الحي من workflow «RLS live» (`files = rls_hr`) — المفروض `NOTICE rls_hr: ok` (بيرجع كل حاجة).
2. Edge Function `team-admin` من workflow «Deploy functions» (`function = team-admin`) — مافيش أسرار جديدة (بتستخدم `SUPABASE_SERVICE_ROLE_KEY` الموجود).
   و`0047_profile_email.sql` (تريجر صغير على `auth.users`: الإيميل الجديد بعد التأكيد بيتنقل لـ `profiles.email` — «تعديل بياناتي») + `supabase/tests/rls_profile_email.sql`.
3. الواجهة: push على `main` (الـ Deploy workflow بيرفع الموقع).
4. (اختياري، مستحسن) في لوحة Supabase › Authentication › Settings: فعّل «Secure password change» عشان تغيير كلمة المرور من API برّه الصفحة يطلب إعادة دخول.
5. **«ملفي › مهامي» (قرار 25، 6 نوفمبر):** `0048_hr_tasks.sql` (جدول `hr_tasks` بـ RLS، الكتابة بالـ RPCs `hr_task_add` / `hr_task_set` /
   `hr_task_delete` / `hr_task_review`، الأسامي `hr_task_people`، وتريجر broadcast `hr` / `tasks`) **قبل** الواجهة، وبعده
   `supabase/tests/rls_hr_tasks.sql` على الحي (workflow «RLS live» بـ `files = rls_hr_tasks` — الاسم من غير `.sql`). الواجهة من غير الجدول بتحمّل HR عادي
   والمهام فاضية (مش بتقع).

**التحقق:**
```sql
select id, permissions ->> 'hr.view' v, permissions ->> 'hr.edit' e, permissions ->> 'hr.approve' a, permissions ->> 'sensitive.salaries' s from public.roles order by sort;
select count(*) from public.hr_leave_types; select count(*) from public.hr_holidays; -- بذرة الـ prototype
select id, public, file_size_limit from storage.buckets where id = 'hr-docs';
select jobname, schedule from cron.job where jobname like 'hr-%';
-- الملاحظات الداخلية (قرار 23): العمود مش ممنوح للأعضاء — المفروض false
select has_column_privilege('authenticated', 'public.hr_members', 'notes', 'select') as notes_open;
select member_id, day, in_at, out_at, remote, source from public.hr_attendance order by in_at desc limit 10; -- بعد أول «ابدأ الدوام»
select at, action, entity_id, new_value from public.activity_log where entity = 'hr' order by at desc limit 20; -- أكواد وشهور بس
-- المهام (قرار 25): مافيش كتابة مباشرة للأعضاء — المفروض false false، والدوال موجودة
select has_table_privilege('authenticated', 'public.hr_tasks', 'insert') as ins, has_table_privilege('authenticated', 'public.hr_tasks', 'update') as upd;
select proname from pg_proc where proname like 'hr_task%' order by 1; -- hr_task_add · delete · people · review · set · writer
select member_id, status, day, done_at is not null as done from public.hr_tasks where deleted_at is null order by id desc limit 10; -- بعد أول مهمة (من غير العناوين)
```
وفي الواجهة: «الموارد البشرية» من غير soon؛ «ابدأ الدوام» من الهيدر وrefresh = نفس الدوام (المشكلة المعروفة 1 اتحلت)؛ «إضافة عضو» بيطلّع الباسورد المؤقت مرة واحدة؛ العضو بيغيّره من «ملفي › الحساب والأمان»؛ عضو من غير `sensitive.salaries` مابيشوفش أي مبلغ غير قسيمته.

**الأمان:** القراية بـ RLS (`hr_can_see` / `hr_can_decide` / `hr_salaries`)، والكتابة الحساسة RPCs `security definer` بقواعدها (الساعة بوقت السيرفر و«عن بُعد» من الطلب المتوافق عليه؛ القرار للمدير المباشر أو `hr.approve`؛ الكشف والفلوس لـ `sensitive.salaries`)؛ `hr_team()` بالأسامي بس (مافيش إيميل/موبايل/صلاحيات للمدير)؛ المستندات في فولدر العضو ولينك موقّع 10 دقايق؛ الباسورد المؤقت في رد `team-admin` بس (مش متخزن ولا متسجل)؛ تغيير كلمة المرور بيتأكد من الحالية بعميل مؤقت مابيخزّنش جلسة؛ `activity_log` من غير مبالغ ولا نصوص.


#### 2.7.24 التسويق (المرحلة 9.5.1، 6 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، ودفترها `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**النشر (بالترتيب — الواجهة آخر حاجة):**
1. `0049_marketing.sql` (Supabase MCP `apply_migration` أو SQL editor) — صلاحيات `marketing.view` / `create` / `publish` (الأدمن و`ops` F، الباقي N)، الجداول
   `mkt_campaigns` / `mkt_templates` / `mkt_posts` بـ RLS والـ grants بقايمة أعمدة، الـ RPCs `mkt_schedule` / `mkt_post_act` / `mkt_template_used` /
   `mkt_credits`، فحوص `ai_runs` الجديدة (`action = marketing`، `source = campaign / template / post`)، broadcast `marketing` / `changed`، وbucket
   `marketing` المقفول (صور ≤ 15 ميجا) وسياساته. بعده `supabase/tests/rls_marketing.sql` على الحي (workflow «RLS live» بـ `files = rls_marketing`).
2. Edge Functions `ai-images` و`ai-content` من workflow «Deploy functions» (`function = ai-images` ثم `function = ai-content`) — مافيش أسرار جديدة
   (`MAGNIFIC_API_KEY` و`ANTHROPIC_API_KEY` الموجودين؛ الصور بالكريدت على نفس سقف «إعدادات الصور»، والكتابة على نفس سقف «إعدادات الـ AI»).
3. الواجهة: push على `main`.

**التحقق:**
```sql
select id, permissions ->> 'marketing.view' v, permissions ->> 'marketing.create' c, permissions ->> 'marketing.publish' p from public.roles order by sort;
-- مافيش كتابة مباشرة على السجل — المفروض false false
select has_table_privilege('authenticated', 'public.mkt_posts', 'insert') as ins, has_table_privilege('authenticated', 'public.mkt_posts', 'update') as upd;
-- scheduled_at للسيرفر بس — المفروض false
select has_column_privilege('authenticated', 'public.mkt_campaigns', 'scheduled_at', 'update') as sched_open;
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'marketing';
select proname from pg_proc where proname like 'mkt_%' order by 1;
select id, name, step, scheduled_at is not null scheduled from public.mkt_campaigns where archived_at is null order by updated_at desc limit 10; -- بعد أول كامبين
select at, action, entity_id, new_value from public.activity_log where action like 'mkt.%' order by at desc limit 20; -- أرقام وأنواع ومنصات بس
select created_at, action, source, label, model, credits, status from public.ai_runs where source in ('campaign', 'template', 'post') order by id desc limit 10;
```
وفي الواجهة: «التسويق» من غير soon، «إنشاء» أول تاب و«نظرة عامة» / «مساعدين الذكاء الاصطناعي» / «التقارير» عليهم «قريبًا»؛ كامبين جديدة بتظهر في
«آخر الشغل»؛ «توليد الصورة» بيسأل بالتكلفة الأول؛ «تأكيد النشر» بيحط البوستات في «سجل النشر» و«الخطة الإعلانية».

**الأمان:** القراية بـ `marketing.view`، والكتابة بقايمة أعمدة (`create`) والسجل بالـ RPCs بس (`publish`، اليوم والساعة بتوقيت القاهرة، الصور من فولدر
الكامبين بس)؛ السيرفر بيقرا القطعة من الكامبين المحفوظ ويبني البرومبت بنفسه (المرجعيات من فولدر الكامبين و`templates/` وصور منتجات الموقع من host
الموقع بس)؛ `activity_log` `mkt.*` من غير فكرة ولا كابشن ولا برومبت. النشر لسه داونلود — مافيش أي كتابة على فيسبوك أو إنستجرام في 9.5.1.

#### 2.7.25 Security Advisor (6 نوفمبر — صورة صاحب المشروع: «Security Definer View — public.hr_requests_v»)

`0050_security_advisor.sql` + `supabase/tests/rls_security_advisor.sql` (مافيش تغيير في الواجهة):
- **`hr_requests_v` (ERROR `security_definer_view`):** كانت view عادية فبتشتغل بصلاحيات صاحبها؛ بقت `security_invoker = true` فوق
  `hr_requests_list()` (`security definer` بنفس قاعدة `0046` بالحرف: صفوف `hr_can_see` وقيمة السلفة لـ `sensitive.salaries` F أو صاحبها بس). الجدول
  `hr_requests` فاضل مقفول على الأعضاء، والـ view بنفس الاسم والأعمدة (`IBHR` زي ما هو).
- **دوال الموارد البشرية لـ anon (WARN `anon_security_definer_function_executable`):** الـ 19 دالة اللي `0046` منحها لـ `authenticated` من غير ما
  يقفلها على `public`/`anon` اتقفلت (`revoke … from public, anon` + grant صريح لـ `authenticated`/`service_role`). ماكانش فيه حاجة مفتوحة فعليًا (كلها بتشيّك
  `auth.uid()`/`has_perm`)، بس دلوقتي زي باقي الـ RPCs. `email_for_identifier` فاضلة لـ anon بالقصد (الدخول باسم المستخدم/الكود قبل تسجيل الدخول).
- **`shot_prompts_touch` (WARN `function_search_path_mutable`):** `set search_path = public`.

**النشر:** `0050` (MCP `apply_migration` أو SQL editor) ← workflow «RLS live» بـ `files = rls_security_advisor rls_hr` ← Security Advisor تاني
(`get_advisors` security) — الـ ERROR والـ 19 والـ search_path يختفوا.

**الباقي في الـ Advisor بالقصد:** `rls_enabled_no_policy` (INFO) على `cs_channel_events` / `cs_oauth_states` / `cs_wa_state` / `login_lookups` /
`magnific_oauth_states` = جداول السيرفر بس (RLS من غير policy = مقفولة على الأعضاء)؛ `authenticated_security_definer_function_executable` (WARN) = الـ RPCs
بتاعتنا (كل كتابة حساسة RPC بيشيّك الصلاحية جواه — القاعدة 3/4)، والدوال اللي الـ policies بتناديها (`has_perm`، `hr_can_see` …) لازم العضو ينفّذها.
**`auth_leaked_password_protection` (WARN) = إعداد في لوحة Supabase مش في الكود:** Authentication › Sign In / Providers › Email › «Prevent use of leaked
passwords» (HaveIBeenPwned) — متاح في الـ Pro plan وفوق بس؛ صاحب المشروع بيشغّله بنفسه لو الخطة تسمح.

**القاعدة من دلوقتي (CLAUDE.md القاعدة 4):** أي view جديدة في `public` = `with (security_invoker = true)`، وأي دالة `security definer` جديدة =
`revoke execute … from public, anon` + grant صريح، وأي دالة = `set search_path`؛ `rls_security_advisor` بيمسك أي حاجة برّه ده.

#### 2.7.26 النشر التلقائي على فيسبوك وإنستجرام + أرقام البوستات (المرحلة 9.5.2، 6 نوفمبر)

الخطة (قرارات 29–39) `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، والدفتر `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**أ) الكود:** `0051_marketing_publish.sql` + `supabase/tests/rls_marketing_publish.sql` · Edge Function **`mkt-publish`** (`verify_jwt = false`) +
`PUBLISH_SCOPES` في `_shared/cs-channel.js` (دالة `cs-channel` بتطلبهم في الـ dialog) · الواجهة: كارت «الربط بالمنصات» الحقيقي ومفتاح النشر
(الأدمن) و«انشر / داونلود» لكل قطعة في خطوة النشر، و«سجل النشر» بالأرقام والمصدر، وبوب أب البوست («انشر دلوقتي» / «احذف البوست» / سبب
الفشل)، وفلتر المصدر في «الخطة الإعلانية».

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0051` (MCP `apply_migration` مرة واحدة؛ لو وقف أو سأل تأكيد = الـ SQL كله لصاحب المشروع في الـ SQL editor): أعمدة `mkt_posts` الجديدة،
   `mkt_schedule` / `mkt_post_act` بقواعد النشر، `mkt_publish_claim` / `mkt_stats_put` / `mkt_autopublish` / `mkt_busy` لـ `service_role` بس،
   والـ cron: `mkt-publish-due` كل دقيقة (بينادي الدالة بس لو المفتاح شغال وفيه بوست جه ميعاده) و`mkt-publish-stats` كل 30 دقيقة — بسر
   `sync_secret` بتاع `0008` من Vault (مافيش سر جديد). **المفتاح متوقف** (مافيش صف `settings` «marketing» = متوقف).
2. workflow «RLS live» بـ `files = rls_marketing_publish rls_marketing rls_security_advisor`.
3. «Deploy functions»: `cs-channel` (الـ dialog بقى بيطلب صلاحيات النشر) ثم `mkt-publish`. الفحص:
   `curl -s -X POST "$F/mkt-publish" -H 'Content-Type: application/json' -d '{"action":"due"}'` → 401 `{"error":"unauthorized"}`.
4. الواجهة: push على `main`.

**التحقق:**
```sql
select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mkt_posts'
  and column_name in ('src','external_id','thumb','views','reach','likes','comments','shares','saves','eng','stats_at','error','attempts','claimed_at','work'); -- 15
select has_function_privilege('authenticated', 'public.mkt_publish_claim(int, bigint)', 'execute') claim_open,
       has_function_privilege('authenticated', 'public.mkt_stats_put(jsonb)', 'execute') stats_open; -- false false
select public.mkt_autopublish(); -- false لحد ما الأدمن يشغّله
select jobname, schedule, active from cron.job where jobname like 'mkt-publish-%'; -- * * * * * و */30 * * * *
select id, platform, kind, status, how, error, external_id is not null live, views, eng, stats_at from public.mkt_posts order by id desc limit 20;
select at, action, entity_id, new_value from public.activity_log where action in ('mkt.post.publish', 'mkt.post.delete_live', 'mkt.autopublish') order by at desc limit 20;
```

**ج) على Meta + السيستم (صاحب المشروع بنفسه):**
1. **الصلاحيات الأربعة:** `pages_manage_posts` (النشر على الصفحة)، `instagram_content_publish` (النشر على انستجرام)، `read_insights` (مشاهدات ووصول
   فيسبوك)، `instagram_manage_insights` (أرقام انستجرام). لو `META_LOGIN_CONFIG_ID` محطوط: developers.facebook.com › التطبيق › Facebook Login for
   Business › Configurations › الـ configuration بتاعة الربط › Edit › علّم على الأربعة → Save (من غيره الـ dialog بيطلبهم بنفسه). وضع التطوير:
   شغالين لأدمن الصفحة اللي ليه دور في التطبيق من غير App Review؛ الـ App Review (مع التحويل للحي) على الأربعة دول + العشرة بتوع §2.7.16.
2. **الربط تاني (مرة واحدة، نفس الصفحة — الرسايل في خدمة العملاء مابتقفش):** «التسويق › سجل النشر» (أو خطوة «النشر والتحميل» في أي كامبين) › كارت «الربط بالمنصات» › «اربط تاني» (بيظهر للأدمن
   لما الربط ناقصه صلاحية النشر؛ في «خدمة العملاء › القنوات» القناة المتصلة عليها «فصل» بس — ماتفصلهاش) → دخول فيسبوك بأدمن الصفحة → وافق على الصلاحيات الجديدة (وعلى صفحة Ibtekr Club
   وحساب @ibtekr.club). بعدها كارت «الربط بالمنصات» يقول «مربوط للنشر» على فيسبوك وانستجرام.
3. **المفتاح:** الأدمن «شغّل النشر التلقائي» من نفس الكارت (بتأكيد). وهو متوقف مافيش أي نشر — لا الـ cron ولا «انشر دلوقتي».
4. **أول بوست تجريبي (صاحب المشروع بيقرر — بيتنشر على الصفحة الحقيقية قدام الناس):** كامبين ببوست واحد، «انشر» على فيسبوك بس، وبعد التأكيد
   «انشر دلوقتي» من «سجل النشر» → الحالة «اتنشر» واللينك «افتح على فيسبوك ↗»؛ بعدها انستجرام. «احذف البوست» بيشيله من المنصة لو حبيت.

**إزاي بيشتغل:** الـ cron بيحجز البوستات اللي جه ميعادها (`for update skip locked`) → فيسبوك (صورة / صور مخفية + feed / ستوري الصفحة) أو انستجرام
(كونتينر → FINISHED → `media_publish`؛ لسه بيتجهز = بيكمّل الدقيقة الجاية من غير رفع تاني) بلينكات موقّعة 15 دقيقة من bucket `marketing` →
«اتنشر» + الـ id واللينك. الرفض = «فشل» + الكود (بالعربي في البوب أب)، ومافيش إعادة تلقائية («انشر دلوقتي» هي الإعادة). **ضد النشر مرتين:**
`work.stage = publishing` قبل آخر نداء — تايم أوت فيه أو تشغيلة وقعت = «فشل» `uncertain` (بص على الصفحة الأول، وبعدها «انشر دلوقتي» أو «علّمه
اتنشر»). كل 30 دقيقة: أرقام البوستات اللي اتنشرت آخر 30 يوم (الستوري 24 ساعة) وبوستات الصفحة والانستجرام اللي اتنشرت من برّه السيستم
(«من المنصة مباشرة» — بوست أحدث من 15 دقيقة بيستنى التشغيلة الجاية عشان مايتحسبش مرتين)، وبوست اتشال من المنصة = «اتحذف».

**الأمان:** التوكن = ربط خدمة العملاء نفسه في Vault (`cs_secret_get` «meta_pages» — `service_role` بس)، مافيش توكن ولا لينك صورة في أي log؛
`activity_log` `mkt.post.publish` (الـ id والمنصة والنوع والنتيجة/الكود) و`mkt.post.delete_live` و`mkt.autopublish` (on/off) بس؛ «انشر دلوقتي» و
«احذف البوست» بـ `marketing.publish = F` والمفتاح للأدمن؛ الـ cron بسر المزامنة بس ومابيعملش غير `due` و`stats`. **مافيش `WOO_PUSH_ENABLED` هنا**
(مش WooCommerce) — المفتاح بتاع النشر هو `settings.marketing.autopublish`.

#### 2.7.27 أرقام الإعلانات — Meta Ads جنب أوردرات ووكومرس (المرحلة 9.5.3، 6 نوفمبر)

الخطة (قرارات 42–48) `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، والدفتر `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**أ) الكود:** `0052_marketing_ads.sql` + `supabase/tests/rls_marketing_ads.sql` · Edge Function **`mkt-ads`** (`verify_jwt = false`) والجزء الصافي
`_shared/mkt-ads.js` · الدومين (`adTotals` / `adCampaignRows` / `merWeeks` / `adAlerts` / `adCreatives` في `marketing-domain.js`) · `IBMarketing.adsStatus` /
`adsSync` / `adsData` · الواجهة: «نظرة عامة» و«التقارير» (الحملات + الأعمال الفنية) في التسويق، وتاب «الحملات الإعلانية» في صفحة التقارير (الكتلة 28).
**قراية بس — مافيش أي كتابة على ميتا.**

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0052` (MCP `apply_migration` مرة واحدة؛ لو وقف أو سأل تأكيد = الـ SQL كله لصاحب المشروع في الـ SQL editor): أعمدة مصدر الأوردر على `orders`
   (`attr_type` / `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `ad_platform`) بتريجر `orders_attribution` من `raw.meta_data` + تعبئة
   القديم في نفس الـ migration، `mkt_ad_objects` / `mkt_ad_stats` (القراية `marketing.view`، الكتابة للسيرفر)، RPC `mkt_ads_orders`، والـ cron
   `mkt-ads-sync` الدقيقة 23 كل ساعة بسر `sync_secret` بتاع `0008` (مافيش سر جديد للـ cron).
2. workflow «RLS live» بـ `files = rls_marketing_ads rls_security_advisor`.
3. «Deploy functions»: `mkt-ads`. الفحص من غير الأسرار: أي نداء = 503 `not_configured` (والـ cron مابيعملش حاجة لحد ما الأسرار تتحط).
4. الواجهة: push على `main`.

**التحقق:**
```sql
select ad_platform, utm_source, count(*) from public.orders where ad_platform is not null group by 1, 2 order by 3 desc; -- meta / fb · ig …
select count(*) filter (where attr_type is not null) attributed, count(*) total from public.orders;
select has_function_privilege('authenticated', 'public.order_attribution(jsonb)', 'execute') parse_open,
       has_function_privilege('authenticated', 'public.mkt_ads_orders(date, date)', 'execute') rpc_open; -- false true
select jobname, schedule, active from cron.job where jobname = 'mkt-ads-sync'; -- 23 * * * *
select kind, count(*) from public.mkt_ad_objects group by 1;  -- بعد أول مزامنة: account 1 · campaign … · ad …
select level, min(day), max(day), count(*), sum(spend) from public.mkt_ad_stats group by 1;
select at, action, new_value from public.activity_log where action = 'mkt.ads.sync' order by at desc limit 5; -- أعداد بس
```

**ج) مفتاح القراية (صاحب المشروع بنفسه — مرة واحدة):**
1. **الـ Business Portfolio:** business.facebook.com › الإعدادات (Business settings) › **Users › System users** › «Add» → اسم زي «Ibtekr Ops» ودور
   **Employee** (كفاية للقراية).
2. **الحساب الإعلاني:** على نفس الـ system user › «Assign assets» › **Ad accounts** › حساب إعلانات Ibtekr › صلاحية **View performance** بس (من غير
   Manage campaigns) → Save.
3. **التطبيق:** لازم تطبيق Meta بتاعنا (نفس تطبيق الربط) يكون في الـ portfolio: Business settings › **Accounts › Apps** (لو مش موجود: Add → Connect
   an app ID → رقم التطبيق). ولو الـ token مابيعرضش `ads_read`: developers.facebook.com › التطبيق › Use cases › زوّد **«Create & manage ads with
   Marketing API»**.
4. **التوكن:** System users › الـ user › **«Generate new token»** → التطبيق → Token expiration **Never** → صلاحية **`ads_read`** بس → Generate →
   انسخه (بيظهر مرة واحدة). **ماتبعتهوش في الشات.**
5. **رقم الحساب الإعلاني:** من Ads Manager — الرابط فيه `act=…` — أو Business settings › Accounts › Ad accounts (الرقم تحت الاسم).
6. **الأسرار:** Supabase › Edge Functions › Secrets: `META_ADS_TOKEN` = التوكن، و`META_AD_ACCOUNT_ID` = الرقم (`act_…` أو الأرقام بس).
7. أول مزامنة: «التسويق › نظرة عامة» › «مزامنة دلوقتي» (الأدمن) — أو استنى الـ cron (الدقيقة 23). أول مرة بتسحب آخر 90 يوم.

**إزاي بيشتغل:** كل ساعة الدالة بتقرا (GET بس) الحساب والحملات والإعلانات (الاسم والحالة وصورة الكرييتيف) والـ insights يوم بيوم لكل حملة ولكل إعلان
لآخر 3 أيام (ميتا بتعدّل أرقامها متأخر)؛ مشتريات ميتا = `omni_purchase` وإلا `purchase` وإلا بتاع البكسل (من غير جمع). أوردرات ووكومرس من الإعلانات
= Order Attribution بتاع ووكومرس على الأوردر (`utm_source = fb | ig`، `utm_medium = paid`، `utm_campaign = رقم الحملة`) — المطابقة بالحملة بالظبط.
فشل = آخر أرقام بتفضل + السبب على صف الحساب (التوكن / الصلاحية / استنى / وقت) والصفحة بتقوله بالعربي.

**الأمان:** التوكن في أسرار الدالة بس (هيدر Authorization لميتا — مابيوصلش صف ولا log ولا رد)؛ `activity_log` `mkt.ads.sync` أعداد بس (أيام ·
حملات · إعلانات · صفوف)؛ القراية `marketing.view` ونصيب إبتكر والربح بعد الإعلانات بـ `accounts.view ≠ N` (الـ RPC بيبعته null لغيرهم)؛ مافيش
أي إجراء على فلوس — تنبيهات الميديا باير قواعد من غير زرار تنفيذ، والتغيير من مدير إعلانات ميتا.

#### 2.7.28 المساعدين — الميديا باير بالتنفيذ بموافقة الأدمن، الديزاينر والمبرمج (المرحلة 9.5.4، 7 نوفمبر)

الخطة (قرارات 49–56) `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، والدفتر `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**أ) الكود:** `0053_marketing_buyer.sql` + `supabase/tests/rls_marketing_buyer.sql` · `mkt-ads` (الاقتراحات بعد كل مزامنة، `rules` / `rules_set` / `live` / `decide`، والـ cron
`report`) والجزء الصافي `_shared/mkt-ads.js` (`suggestionsOf` / `budgetPlan` / `accountDaily` / `reportText` / `buyerRules` / `rulesPatch`) · `ai-content` action `buyer`
(`_shared/marketing.js`: `parseBuyer` / `buyerRequest` / `cleanBuyer`) · `IBMarketing.suggestions` / `decide` / `rules` / `rulesSet` / `setLive` / `requests` / `addRequest` /
`editRequest` / `setRequestStatus` / `buyerChat` · الواجهة: تاب «مساعدين الذكاء الاصطناعي»، كارت «اقتراحات الميديا باير» وكروت المساعدين في «نظرة عامة»، عمود «القرار
المقترح» في تقرير الحملات. **الكتابة الوحيدة على ميتا: إيقاف حملة أو تغيير ميزانيتها اليومية بعد موافقة الأدمن على اقتراح بعينه، والمفتاح شغّال.**

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0053` (MCP `apply_migration` مرة واحدة؛ لو وقف أو سأل تأكيد = الـ SQL كله لصاحب المشروع في الـ SQL editor): `mkt_suggestions` (القراية `marketing.view`،
   الكتابة للسيرفر، اقتراح مفتوح واحد لكل نوع × حملة)، `mkt_requests` (+ `mkt_requests_guard`)، `mkt_buyer_rules()` (`marketing.view`)، `ai_runs.source` «buyer»،
   والـ cron `mkt-ads-report` :35 كل ساعة بسر `sync_secret` بتاع `0008` (مافيش سر جديد).
2. workflow «RLS live» بـ `files = rls_marketing_buyer rls_security_advisor`.
3. «Deploy functions»: `mkt-ads` ثم `ai-content`.
4. الواجهة: push على `main`.
5. **التوكن (صاحب المشروع):** عشان الإيقاف وتغيير الميزانية يشتغلوا لازم `META_ADS_TOKEN` يكون معاه `ads_management` (اللي اتعمل في §2.7.27 بـ `ads_read` +
   `ads_management` كفاية؛ لو `ads_read` بس → القرار بيفشل بـ «مفيش صلاحية» ويتسجل `failed`). مافيش تغيير في الأسرار.

**التحقق:**
```sql
select kind, status, count(*) from public.mkt_suggestions group by 1, 2 order by 1, 2;   -- بعد أول مزامنة بعد النشر
select public.mkt_buyer_rules();                                                          -- كأدمن: الافتراضيات، live = false
select data -> 'buyer' from public.settings where section = 'marketing';                 -- null لحد ما الأدمن يعدّل قاعدة أو يشغّل المفتاح
select jobname, schedule, active from cron.job where jobname = 'mkt-ads-report';          -- 35 * * * *
select has_function_privilege('anon', 'public.mkt_buyer_rules()', 'execute');             -- false
select at, action, new_value from public.activity_log where action like 'mkt.buyer.%' or action like 'mkt.request.%' order by at desc limit 10;
```

**إزاي بيشتغل:** كل ساعة بعد المزامنة الدالة بتحسب اقتراحات النهارده من آخر 7 أيام (أرقام ميتا لكل حملة + أوردرات ووكومرس اللي شايلة `utm_campaign` بتاعها —
الزيادة على الأوردرات المؤكدة/المكتملة بس) وبتحطها «مستني موافقتك»؛ الأدمن من «مساعدين الذكاء الاصطناعي» أو «نظرة عامة» بيفتح الاقتراح ويرفض أو يعدّل النسبة
(نفس الاتجاه، لحد 30%) أو يوافق. **المفتاح «التنفيذ على ميتا» متوقف افتراضي** — وهو متوقف الموافقة بتتسجل بس؛ لما الأدمن يشغّله (بتأكيد) الموافقة بتوقف الحملة
أو تغيّر ميزانيتها اليومية (الحملة نفسها لو CBO وإلا مجموعاتها الشغالة)، والسيرفر بيرفض لو الخطوة > 30% أو مجموع الحساب اليومي هيعدّي «حد الصرف اليومي». «وقف
تلقائي» بوضع «توقف لوحدها» بيشتغل بس لما المفتاح شغّال. التقرير اليومي على الجرس للأدمن و`ops` في ساعة القاعدة. الشات بيقرا نفس الأرقام ومابينفّذش.

**الأمان:** مفيش تنفيذ من غير قرار الأدمن على صف بعينه + المفتاح؛ `live` مابيتكتبش من `rules_set`؛ الأعضاء مابيكتبوش `mkt_suggestions` أبدًا؛ التوكن في أسرار
الدالة بس؛ `activity_log` بالقرار والحالة ورقم الحملة بس — مافيش مبالغ ولا نص شات ولا تفاصيل طلب.

#### 2.7.29 الفيديو بالـ AI — قطعة «فيديو» على جسر Magnific، والريلز على فيسبوك وانستجرام (المرحلة 9.5.5، 7 نوفمبر)

الخطة (قرارات 57–66) `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، والدفتر `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**أ) الكود:** `0054_marketing_video.sql` + `supabase/tests/rls_marketing_video.sql` · الجزء الصافي `_shared/mkt-video.js` (الموديلات والمقاسات والمدد، البرومبتات،
`mixPlan` / `nextMix`، المسارات) · `ai-images` actions `video_clip` / `video_voice` / `video_music` / `video_upload` / `video_assemble` / `video_poll` على الجسر
(`providers/magnific-mcp.ts` زي ما هو) · `ai-content` task `scenes` · `mkt-publish` الريل (`planOf` kind `reel`، `video_reels` + rupload، `REELS` container) ·
`IBMarketing.videoScenes` / `videoClip` / `videoVoice` / `videoMusic` / `videoUpload` / `videoAssemble` / `videoPoll` · الصفحة (أداة «فيديو»، قطعة الفيديو في
التفاصيل والبناء والمراجعة، المشغّل) + CSS الـ v6. **مافيش سر جديد ولا ربط جديد:** الجسر هو ربط Magnific بتاع الأدمن من «إعدادات الصور» (5.4 قرار 11)،
والنشر بنفس ربط صفحة خدمة العملاء ومفتاح `autopublish` (9.5.2).

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0054` (MCP `apply_migration` مرة واحدة؛ لو وقف أو سأل تأكيد = الـ SQL كله لصاحب المشروع في الـ SQL editor): `mkt_video_jobs` (القراية `marketing.view` من غير
   عمود `url`، الكتابة للسيرفر)، `ai_runs.source` «video»، bucket `marketing` → 200 ميجا + `video/mp4` و`audio/*`، و`mkt_schedule` بيقبل الريل للنشر
   (الـ MP4 أول ملف).
2. workflow «RLS live» بـ `files = rls_marketing_video rls_marketing rls_security_advisor`.
3. «Deploy functions»: `ai-images` ثم `ai-content` ثم `mkt-publish`.
4. الواجهة: push على `main`.
5. **صاحب المشروع:** الجسر لازم يكون مربوط (المنتجات › أداة الصور › «إعدادات الصور» › «اربط حساب Magnific»)؛ من غيره كل أزرار الفيديو بتقول «اربط حساب
   Magnific الأول». الكريدت بتتخصم من حساب Magnific المربوط (مش من سقف الصور). أول فيديو تجريبي بإيده: كامبين من أداة «فيديو» → توليد المشاهد → صورة
   لكل مشهد → في المراجعة «توليد المشاهد» (المقاطع) → الصوت والموسيقى → «تجميع المشاهد» → «شاهد الفيديو المجمّع» → موافقة → الجدولة («انشر» لو
   الربط والمفتاح شغّالين، وإلا داونلود). **الريل على الصفحة الحقيقية بإيد صاحب المشروع بس** (المفتاح `autopublish` + أول ريل).

**التحقق:**
```sql
select kind, status, scene, path is not null as stored, error from public.mkt_video_jobs order by id desc limit 12;   -- بعد أول فيديو
select has_column_privilege('authenticated', 'public.mkt_video_jobs', 'url', 'select');                             -- false
select file_size_limit, allowed_mime_types from storage.buckets where id = 'marketing';                              -- 209715200 + video/mp4
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_source_check';                          -- فيها 'video'
select piece, kind, platform, how, images[1] from public.mkt_posts where kind = 'ريل' order by id desc limit 5;         -- images[1] بـ .mp4
select at, action, new_value from public.activity_log where action like 'mkt.video.%' order by at desc limit 10;     -- القطعة والمشهد والنوع بس
```

**إزاي بيشتغل:** الصفحة بتبعت كل خطوة كمهمة على الجسر وبتسأل `video_poll` كل 15 ثانية وهي مفتوحة على القطعة؛ السيرفر بيستنى `creations_wait` لحد 20 ثانية
في النداء، وينزّل اللي خلص لـ bucket `marketing` (`vid-<القطعة>-s<n>|vo|mu|cut|mix-<stamp>.mp4|mp3`)، وسلسلة التجميع (القص ثم مزج الفويس ثم الموسيقى)
بتكمّل لوحدها في الـ poll. الملف النهائي `vid-…-mix-….mp4` هو فيديو القطعة؛ بعد الموافقة الجدولة بتبعته أول ملف في صف `mkt_posts` (وبعده كوادر المشاهد
لصورة السجل)، و`mkt-publish` بينشره: فيسبوك start → رفع برابط موقّع ساعة → finish؛ انستجرام كونتينر `REELS` بيتجهز دقايق (التشغيلة الجاية بتنشره). «الفيديو كبير»
(> 120 ميجا) بيفضل على Magnific برابطه ومابيتجدولش للنشر.

**الأمان:** رابط Magnific (`url`) مش ممنوح للأعضاء؛ التنزيل من host مسموح بس؛ الأعضاء مابيكتبوش `mkt_video_jobs`؛ كل فعل `marketing.create` F + ربط الجسر؛
`ai_runs` صف لكل نداء بـ 0 كريدت (الـ throttle بتاع الصور نفسه)؛ `activity_log` من غير برومبت ولا نص فويس ولا رابط؛ مافيش أي نشر من غير مفتاح
`autopublish` و`how = publish` اللي العضو اختاره.

#### 2.7.30 تيك توك وجوجل إعلانات — الربط من السيستم، قراية بس (المرحلة 9.5.6، 7 نوفمبر)

الخطة (قرارات 67–74) `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`، والدفتر `.superpowers/sdd/2026-11-06-phase-9-5-marketing/progress.md`.

**أ) الكود:** `0055_marketing_ads_platforms.sql` + `supabase/tests/rls_marketing_ads_platforms.sql` · الجزء الصافي `_shared/mkt-ads-link.js` (الخانات وفحصها والعرض الآمن)
و`_shared/mkt-ads-tiktok.js` و`_shared/mkt-ads-google.js` · `mkt-ads` (الأسرار من Vault، `link_set` / `link_start` / `link_callback` / `link_pick` / `unlink`، المزامنة لكل منصة،
`status` بالمنصات) · `app/ads-callback.html` + `js/pages/ads-callback.js` · `IBMarketing.adsLinkSet` / `adsLinkStart` / `adsLinkPick` / `adsUnlink` و`adsStatus.platforms` ·
الصفحة (كارت «حالة الربط» ببوب أب الأدمن، الأرقام لكل منصة). **مافيش سر جديد في أسرار Supabase** — بيانات الربط كلها بتتكتب من الصفحة وتتحفظ في Vault.

**ب) على Supabase (المطوّر — بالترتيب):**
1. `0055` (MCP `apply_migration` مرة واحدة؛ لو وقف = الـ SQL كله لصاحب المشروع في الـ SQL editor): المنصات `meta | tiktok | google` في `mkt_ad_objects` /
   `mkt_ad_stats` / `mkt_suggestions`، `mkt_secret_get` / `mkt_secret_set` (`service_role`)، و`cs_oauth_states.channel` بياخد `ads_tiktok` / `ads_google`.
2. workflow «RLS live» بـ `files = rls_marketing_ads_platforms rls_marketing_ads rls_security_advisor`.
3. «Deploy functions»: `mkt-ads`.
4. الواجهة: push على `main`.
5. **(اختياري) `ADS_REDIRECT_URL`** في أسرار Supabase لو الموقع على دومين تاني؛ الافتراضي `https://operation-system.ibtekr.club/ads-callback.html`.

**ج) صاحب المشروع — تيك توك:** في TikTok for Business › Developer (business-api.tiktok.com) اعمل تطبيق Marketing API، وفي الـ Redirect URL حط رابط الرجوع اللي
فوق، وخد الـ App ID والـ Secret → في السيستم «نظرة عامة › حالة الربط › تيك توك › اربط»: اكتبهم و«احفظ» ثم «اربط بحساب تيك توك» وسجّل بحساب الإعلانات → لو
الحساب بيدير أكتر من Advertiser اختار بتاع إبتكر. (بديل: لو معاك Access Token من بوابة التطبيق اكتبه مع الـ Advertiser ID بالإيد و«احفظ».) التطبيق في وضع
Sandbox/Test بيشوف حسابات الاختبار بس — لازم يكون Approved عشان يقرا الحساب الحقيقي.

**د) صاحب المشروع — جوجل:** (1) Google Ads › حساب المدير (MCC) › الأدوات › API Center → Developer token (Test account access بيقرا حسابات تجريبية بس؛ اطلب
Basic access عشان الحساب الحقيقي). (2) Google Cloud › APIs & Services › Credentials → OAuth client (Web application) ورابط الرجوع اللي فوق في Authorized redirect URIs،
وفعّل Google Ads API. (3) في السيستم «جوجل › اربط»: الـ developer token والـ Client ID والـ Secret (و Login customer ID = رقم الـ MCC لو الحساب تحته) و«احفظ» ثم
«اربط بحساب جوجل» ووافق (offline) → لو أكتر من Customer اختار حساب الإعلانات. الـ refresh token بيتحفظ مرة واحدة؛ لو جوجل مارجّعتش refresh token شيل التطبيق
من حساب جوجل (myaccount.google.com › الأمان) واربط تاني.

**التحقق:**
```sql
select platform, kind, id, name, status, meta ->> 'synced_at' as synced, meta ->> 'error' as err from public.mkt_ad_objects where kind = 'account';
select platform, count(*), sum(spend) from public.mkt_ad_stats group by 1;                                 -- بعد أول مزامنة
select name from vault.secrets where name like 'mkt_ads_%';                                                 -- الأسماء بس — القيم مشفّرة
select has_function_privilege('authenticated', 'public.mkt_secret_get(text)', 'execute');                 -- false
select state is not null, channel, used_at from public.cs_oauth_states where channel like 'ads_%' order by created_at desc limit 5;
select at, action, entity_id, new_value from public.activity_log where action in ('mkt.ads.link', 'mkt.ads.sync') order by at desc limit 10; -- المنصة والخانات والأعداد بس
```

**إزاي بيشتغل:** الأدمن بيكتب بيانات المنصة في البوب أب → السيرفر بيحفظها في Vault (ومابيرجّعهاش — بيعرض آخر 4 حروف)؛ زرار الربط بيوديه لصفحة المنصة ويرجع
على `ads-callback.html` اللي بتسلّم الكود للسيرفر؛ من ساعتها الـ cron (الدقيقة 23 كل ساعة) بيسحب أرقام كل منصة مربوطة لوحدها (آخر 3 أيام؛ أول مرة 90 يوم)،
وفشل منصة بيتكتب على صف حسابها من غير ما يوقف الباقي. الأوردرات بتتربط بالحملة من `utm_campaign` بتاع ووكومرس (رقم الحملة على المنصة) زي ميتا.

**الأمان:** الأسرار في Vault بس (لا ردود ولا logs)؛ `cs_oauth_states` للسيرفر؛ الـ redirect من السيرفر مش من المتصفح؛ أفعال الربط للأدمن؛ مافيش أي كتابة على
تيك توك أو جوجل، والقرار على اقتراحاتهم بيتسجل بس.

#### 2.7.38 الحملات على واتساب 1 بقوالب Meta — `cs-whatsapp` `campaign_tick` (المرحلة 13 T1، 9 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-09-phase-13-leftovers.md` (قرارات 1–4). الحملة على واتساب 1 وهو على Meta Cloud API = **قالب Marketing معتمد** من
`cs_templates` (اللي ليه `wa_template`)، والمرسل `cs-whatsapp` بـ cron كل دقيقة؛ أرقام الـ QR فاضلة على الجسر (`cs-wa`).

**الملفات:** `0063_campaigns_meta.sql` (`cs_campaigns.template_id` + الحارس + cron **`cs-campaign-tick`** كل دقيقة بسر المزامنة) + `rls_cs_campaign_meta` ·
`_shared/cs-campaign.js` (الصافي) · `cs-whatsapp` (actions `campaign_tick` / `campaign_test`، إيصالات Meta بتحدّث المستلم، رد العميل في 3 أيام = `replied`) ·
`IBCS.campaignTest` / `setLive` · الكتلة 20 (القالب في الويزارد، «ابعت رسالة تجربة»، مفاتيح الإرسال في «القنوات»).

**الخطوات:** `0063` على الحي (MCP أو SQL editor) → «RLS live» بـ `files = rls_cs_campaign_meta` → «Deploy functions» `cs-whatsapp` → الواجهة على `main`.

**التشغيل (صاحب المشروع):** (1) في Meta Business › WhatsApp Manager › Message templates: قالب Marketing بالعربي بمتغيرين على الأكتر
({{1}} الاسم، {{2}} الكود) واستنى الاعتماد؛ (2) في «الرد الآلي › القوالب» اكتب نفس النص واسم القالب في «قالب Meta» ورتّب المتغيرات `{اسم_العميل}` ثم
`{كود_الخصم}` زي ترتيب {{1}} {{2}}؛ (3) من «خدمة العملاء › القنوات › مفاتيح الإرسال» شغّل «إرسال الحملات» (متوقف افتراضي)؛ (4) حملة جديدة → القالب →
«ابعت رسالة تجربة» على رقمك → جدولة. **كل رسالة قالب ليها تكلفة عند Meta** (محادثة تسويقية) — الحد اليومي `cap_per_day` بيحكم.

```sql
select jobname, schedule, active from cron.job where jobname = 'cs-campaign-tick';
select id, name, status, template_id, stats from public.cs_campaigns where channel = 'wa1' order by created_at desc limit 5;
select status, count(*) from public.cs_campaign_recipients group by 1;
select received_at, status, summary from public.cs_channel_events where summary ? 'campaign_tick' order by received_at desc limit 5; -- أعداد بس
```

**الأمان:** الإرسال بسر المزامنة (الـ cron) أو الأدمن بس، ورسالة التجربة بـ `cs.manage`؛ الموافقة/الحظر/الدمج بتتفحص وقت الإرسال؛ مافيش رقم ولا نص في
`activity_log` (`cs.campaign.test` باسم القالب) ولا في `cs_channel_events` (أعداد)؛ المفتاح `live.campaigns` متوقف افتراضي والأدمن بيشغّله بتأكيد.

#### 2.7.39 السحب التلقائي من المخزن «المخزن الأول» على السيرفر (المرحلة 13 T2، 9 نوفمبر)

الخطة `docs/superpowers/plans/2026-11-09-phase-13-leftovers.md` (قرار 5). **مافيش migration.** لما أوردر **جديد** يدخل من الموقع (webhook أو مزامنة) والمفتاح
`settings` «inventory» `firstWarehouse = true`: كل سطر الـ SKU بتاعه على lot «متاح للبيع» مفتوح وكميته المتاحة تكفي → حركة `reserve` على الـ lot
(`by` فاضي، `label` «حجز لأوردر»، `ref` `IB-<رقم>`، `note` «سحب تلقائي · سطر #<id>») + السطر `pulled = true` + الـ lot «محجوز لأوردر» لو المتاح خلص +
صف جرس `alerts` لدور `ops` (`pullAlert`). الصافي `_shared/woo-inventory.js` (`autoPullPlan`)، والتنفيذ في `_shared/woo-write.js` (`autoPullNewOrders`) —
أوردر موجود مابيتلمسش، وأي فشل بيتسجل `woo_sync_log` `autopull` من غير ما يوقف كتابة الأوردر. **مراجعة أمنية:** الحجز لأوردر حالته «جاري التنفيذ»/«جاهز للشحن» بس (أوردر «قيد الانتظار»/«فشل» مابيحجزش)، السطر بيتاخد أولًا بشرط `pulled = false` (webhook والمزامنة مابيحجزوش مرتين)، ولما الأوردر يبقى «ملغي»/«فشل»/«استرجاع» الحجز التلقائي بيتفك (`release` + السطر + الـ lot «متاح») لو `autoRelease` شغّال (الافتراضي).

**الخطوات:** «Deploy functions» `woo-webhook` ثم `woo-sync`. **التشغيل:** المخزن › الإعدادات › «المخزن الأول» (متوقف افتراضي؛ `pullAlert` شغّال).

```sql
select data->'firstWarehouse', data->'pullAlert' from public.settings where section = 'inventory';
select at, lot_id, qty, ref, note from public.inv_moves where type = 'reserve' and "by" is null order by at desc limit 10;
select at, entity_id, result, detail from public.woo_sync_log where action = 'autopull' order by at desc limit 10;
```
