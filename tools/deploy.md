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

بعدها `execute_sql` بمحتوى الاختبارات الخمسة (كل واحد بيعمل `rollback` في الآخر، فمش بيسيب حاجة وراه):
- `supabase/tests/rls_identity.sql` → لازم يطلع `NOTICE: rls_identity: ok`
- `supabase/tests/rls_system.sql` → لازم يطلع `NOTICE: rls_system: ok` (بيتوقع `status_map` زي ما `0009` بتسيبه: 9 صفوف، «فشل» مكان «تم RTC» بـ `from_woo`، والباقي `both` — يعني بعد `0009`)
- `supabase/tests/rls_dashboard.sql` → لازم يطلع `NOTICE: rls_dashboard: ok`
- `supabase/tests/rls_orders.sql` → لازم يطلع `NOTICE: rls_orders: ok` (من المرحلة 2.1 بيتوقع `0009` كمان: «فشل» في `status_map`، و`products.permalink` بيتقرا للأعضاء)
- `supabase/tests/rls_mfa.sql` → لازم يطلع `NOTICE: rls_mfa: ok` (بيكتب factors تجريبية في `auth.mfa_factors` بكل الأعمدة الإجبارية بتاعة الجدول الحي، وكلها بتروح مع الـ rollback)

أي `ERROR` = وقّف ومتنشرش. لو الـ MCP رفض `set local role`، شغّلهم بـ `psql` كـ `postgres`.
`supabase/tests/migrate_0009.sql` **محلي بس** (`npm run db:test`): بيرجّع الحالة اللي قبل `0009` جوه transaction وبيطبّق الملف نفسه تاني بـ `\ir` (أمر `psql`، فمايتشغّلش عبر `execute_sql`). على الحي `0009` بيتفحص بالاستعلامات اللي تحت.
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
  -- المتوقع: cols = 24, forbidden = 0
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

4. `rls_system` و`rls_orders` على الحي (فوق) — الاتنين بيتوقعوا `0009`.
5. إعادة نشر الدالتين (§2.7.1) **بعد** `0009` مش قبلها: `mapProduct` الجديدة بتكتب `permalink`، وقبل العمود PostgREST بيرفض الصف وجزء المنتجات كله بيفشل. وبعد النشر شغّل جملتين الداتا بتوع `0009` مرة كمان (`execute_sql`؛ مابيغيّروش حاجة اتعملت) عشان يلحقوا أي أوردر أو منتج الكود القديم كتبه بين التطبيق والنشر:

   ```sql
   update public.orders set note = customer_note where coalesce(note, '') = '' and coalesce(customer_note, '') <> '';
   update public.products set permalink = btrim(raw ->> 'permalink')
   where permalink is null and btrim(raw ->> 'permalink') like 'https://%';
   ```

   وبعدها تشغيلة cron ناجحة (§2.1 خطوة 5 بتاعة `0008`).

### 2.2 `get_advisors`
شغّله مرتين: `type: security` و`type: performance`.

المتوقع والمقبول:
- **`login_lookups`: RLS enabled, no policies** — مقصود. الجدول ده عدّاد الـ throttle بتاع الدخول، ومحدش يلمسه غير الدالة `email_for_identifier` (ومفيش grants لـ `anon`/`authenticated` أصلًا).
- **`email_for_identifier` دالة `security definer` وينفع `anon` ينفّذها** — مقصود. شاشة الدخول محتاجاها قبل ما المستخدم يسجّل، عشان تحوّل الموبايل لإيميل، وبتقبل رقم موبايل (11 رقم) بس — أي إيميل بيرجع صفر صفوف، والدخول بالإيميل بيروح لـ Supabase Auth على طول. عليها حد عام 60 طلب في الدقيقة لكل الناس مع بعض، فلو حد غرّقها بطلبات من غير تسجيل، اللي بيتأثر الدخول بالموبايل بس (الدخول بالإيميل شغّال عادي).
- **`has_perm`/`is_admin` دوال `security definer` وينفع `authenticated` ينفّذها** — مقصود: كل السياسات والحراس بيعدّوا عليهم.
- بعد `0007`: **`order_customer_phone` دالة `security definer` وينفع `authenticated` ينفّذها** — مقصود: هي اللي بتغذّي عمود التليفون في `orders_v`، وبتشيك `orders.view` وبتطمس التليفون (`sensitive.customer_phone`) بنفسها.
- بعد `0008`: **`mark_twofa_enrolled`/`mark_twofa_disabled` دوال `security definer` وينفع `authenticated` ينفّذها** — مقصود: كل واحدة بتشترط جلسة aal2 (و`enrolled` كمان factor TOTP `verified` للمستخدم نفسه في `auth.mfa_factors`)، وبتغيّر صف المستخدم نفسه بس. (`sync_secret_matches` لـ `service_role` بس، فمش المفروض تظهر.)
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
- المرحلة 2.1 (2026-10-26): `failed_note_permalink` (`0009`) لسه ماتطبّقتش على الحي (الكنترولر)، وبعدها إعادة نشر الدالتين (§2.1، خطوات `0009`).

### 2.7 Edge Functions والأسرار والـ webhooks (المرحلة 2)
دالتين Deno في `supabase/functions/`:
- **`woo-webhook`**: بتستقبل webhooks بتاعة WooCommerce (توقيع HMAC، منع التكرار، أوردرات وفرعيين Dokan ومنتجات).
- **`woo-sync`**: المزامنة الاحتياطية (`orders` / `vendors` / `products` / `all`)، دفع حالة الأوردر للموقع (`push_status`)، وتسجيل الـ webhooks (`register_webhooks`).

منطقهم النقي في `_shared/woo-core.js` (بيتختبر بـ `npm test`)، ونقط الدخول بـ `npm run deno:check` و`npm run deno:test`. الترتيب على الحي: §2.1 (`0007` ثم `0008`، ومن المرحلة 2.1 `0009`) ← 2.7.1 النشر ← 2.7.2 الأسرار ← 2.7.4 الـ webhooks ← 2.7.5 أول مزامنة.

**Dokan قراءة بس (قرار صاحب المشروع):** النظام عمره ما يكتب في حالة أوردر فرعي على Woo ولا في بيانات متجر. اللي بيتكتب في WooCommerce حاجتين بس: حالة الأوردر الأصلي (`push_status`، حسب `status_map` واتجاهها، ولما `WOO_PUSH_ENABLED = 1` بس — 2.7.2)، والـ webhooks بتاعتنا (`register_webhooks`). حالات الفرعيين (تأكيد، وصل المخزن، شحن، مرتجع) عايشة عندنا بس.

#### 2.7.1 نشر الدالتين
- `deploy_edge_function` (Supabase MCP) لكل دالة، **بـ `verify_jwt: false` صريح** — الافتراضي في الأداة `true`، ولو اتساب كده الـ gateway هيرفض WooCommerce والـ cron بـ 401 قبل ما الكود يشتغل. نفس القيمة في `supabase/config.toml` (`[functions.woo-webhook]` و`[functions.woo-sync]`)، فـ `supabase functions deploy` بياخدها لوحده. الدالتين بيعملوا المصادقة بنفسهم (2.7.3).
- الملفات لكل دالة: `index.ts` (الـ entrypoint) و`deno.json`، ومعاهم الأربع ملفات المشتركة `_shared/woo-core.js` و`_shared/woo-api.js` و`_shared/woo-write.js` و`_shared/db.js` بنفس المسار النسبي اللي الـ imports بتستخدمه (`../_shared/…`). **مايترفعش:** `index_test.ts` ولا `_test/` (بدائل الاختبار). وأي تعديل في `_shared/` بيلزم إعادة نشر الدالتين (كل واحدة شايلة نسختها جوه الـ bundle).
- **المرحلة 2.1:** `_shared/woo-core.js` و`_shared/woo-write.js` اتغيّروا (`failed` بقى في الجدول، `note` عند الإنشاء، `permalink`)، فالدالتين لازم يتنشروا تاني — **بعد** ما `0009` يتطبّق (§2.1): الكود الجديد بيكتب `products.permalink`، وقبل العمود جزء المنتجات بيفشل.
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
| `WOO_PUSH_ENABLED` | **اختياري:** `1` بالظبط (بعد trim) = `push_status` بيكتب حالة الأوردر في WooCommerce. أي قيمة تانية أو من غيره → الدفع بيتساب (`skipped`، `reason 'push_disabled'`، من غير أي نداء لـ Woo). ليه: الـ staging نسخة كاملة من الموقع بإيميلات عملاء حقيقية وتكامل بوسطة، فأي تغيير حالة هناك ممكن يبعت إيميل لعميل أو يحرّك شحنة. **على الـ staging:** ماتحطوش `1` غير بعد ما تتأكد إن WooCommerce › Settings › Emails (إيميلات الحالات للعميل) وبوسطة (وأي plugin متعلّق بتغيير الحالة) مقفولين أو على sandbox. **على الإنتاج:** عادةً `1` (2.7.8) |
| `WOO_WP_USER` + `WOO_WP_APP_PASSWORD` | **اختياريين، الاتنين مع بعض:** مستخدم أدمن WordPress + Application Password (Users › Profile › Application Passwords). بيتبعتوا Basic على `dokan/v1` بس. لازمين بس لو عايز أرباح Dokan من `dokan/v1/orders`؛ من غيرهم المتاجر بتتقرا من النقطة العامة، و`sub_orders.dokan_earning`/`commission` بيفضلوا `null` (المرحلة 3 بتحسب الربح من `vendors.commission_pct`). الدوال الحالية بتقرا `dokan/v1/stores` بس |

سر المزامنة الداخلي (`sync_secret`) مش من دول: بيتولّد جوه Postgres في `0008` وعايش في Vault، والـ cron بيقراه وقت التشغيل.

#### 2.7.3 قاعدة المصادقة
- **مع Woo** (فحص الـ staging، §2.7.10): مفاتيح WC (`Basic WOO_CK:WOO_CS`) على مسارات `wc/v3` بس. `dokan/v1` من غير أي header — قايمة المتاجر والمتجر الواحد عامّين في كود Dokan، ومفاتيح WC عليهم بترجع `401 invalid_username` — إلا لو `WOO_WP_USER`/`WOO_WP_APP_PASSWORD` متحطين. أي namespace تاني مرفوض. كل طلب: مهلة 30 ثانية ومن غير redirects.
- **`woo-sync`:** header `X-Sync-Secret` لازم يطابق `sync_secret` في Vault (الدالة `sync_secret_matches`، لـ `service_role` بس) → وضع النظام (بيتسجّل `kind 'cron'`). غير كده `Authorization: Bearer <JWT العضو>`: `push_status` محتاج `has_perm('orders.status') = 'F'`، وكل الباقي `is_admin()` (بيتسجّل `kind 'manual'`). أي حاجة تانية → 401. ومن بعد `0008`: العضو اللي مفعّل التحقق بخطوتين لازم جلسته aal2، وإلا `has_perm` = `N` و`is_admin` = false.
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
- `action: 'all'` = المتاجر، ثم الأوردرات، ثم المنتجات (جزء بيفشل مابيوقفش الباقي، والرد 502/500 بقايمة اللي فشل). الأوردرات قبل المنتجات عشان أول تشغيلة فيها ~40 صفحة منتجات (≈ 3991 منتج)، ولو اتقطعت عند مهلة الـ gateway تكون الأوردرات اتسحبت. نفس الطريقتين اللي فوق: زرار «مزامنة» في صفحة الأوردرات (أدمن؛ `IBOrders.syncNow()`) أو `net.http_post` بالجسم `{"action":"all"}`.
- **لو `all` وقعت عند مهلة الـ gateway** (رد مش الـ JSON بتاعنا، أو `timed_out` في `net._http_response`): شغّل `orders` لوحده الأول من الواجهة بحساب الأدمن (بجلسة aal2 لو مفعّل التحقق بخطوتين) — DevTools › Console على `https://operation-system.ibtekr.club`:

  ```js
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'orders' } })     // → { data: { action: 'orders', result: 'ok', counts: … } }
  await IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'products' } })   // بعدها، ولو رجعت done: false شغّلها تاني
  ```

  (أو `net.http_post` زي 2.7.4 بالجسم `{"action":"orders"}`.) كل جزء بيكمّل من الـ cursor بتاعه لو اتقطع، ولما الاتنين يبقوا `done: true` في `sync_state` تشغيلات `all` (والـ cron) بتبقى خفيفة.
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
  - `skipped` → متجر مش موجود (404)، أو أوردر أصلي مش موجود لفرعي (`parent_missing`)، أو دفع اتساب (`reason 'no_woo_status'` لحالة اتجاهها `from_system` من غير slug — مافيش ولا واحدة دلوقتي، أو `'stale'` لما الحالة اللي اتبعتت مش هي المتخزنة، أو `'push_disabled'` لما `WOO_PUSH_ENABLED` مش `1` — 2.7.2؛ الحالة اتحفظت عندنا بس).
  - `orders` / `order_items` / `sub_orders` / `products` / `vendors` + `action 'upsert'` + `error` → قاعدة البيانات رفضت الصف ده بالذات (خطأ بيانات، SQLSTATE `22xxx`/`23xxx`؛ `entity_id` = مفتاحه، و`detail.error` = السبب). المزامنة جرّبت الدفعة صف صف وكمّلت الباقي؛ أوردر مرفوض بيتساب بسطوره، والـ delivery بتاعته بتتسجّل `error` في `woo_webhook_events`. أي خطأ تاني (timeout، صلاحيات) بيوقف الجزء كله زي الأول.
  - `conflict` → حالة جاية من Woo مش في `status_map` (الأوردر اتحفظ بالـ `woo_status` الخام وحالة النظام الحالية أو الافتراضية؛ `failed` مش منهم: من `0009` ليها صف «فشل»)، أو Woo غيّر الحالة بين آخر مزامنة والدفع (`detail.woo_before`؛ الدفع كمّل — «السيستم يكسب»). وصف جديد في `status_map` مابيعيدش تحويل الأوردرات المتخزنة: حالتهم بتفضل زي ما هي لحد ما Woo يغيّر الحالة (أو الفريق).
  - `sub_order` / `parent_list` / `error` → جلب `?parent=` فشل بعد ما الأوردر اتكتب. الفرعيين هيوصلوا في deliveries بتاعتهم أو من المزامنة.
- **`woo_webhook_events`:** صف لكل delivery. `status` (`ok` | `ignored` | `duplicate` | `error`)، و`payload` فيه 6 مفاتيح بس (`id, number, status, parent_id, date_modified_gmt, topic`). `ignored` طبيعي: أوردر فرعي (بيتكتب في `sub_orders` بس)، أوردر قبل 1 أكتوبر أو draft، payload أقدم من اللي عندنا، أو topic مش بتاعنا. `error` بنص بيبدأ بـ `in progress` = محاولة ماخلصتش.
- أعمدة `raw` في `orders`/`order_items`/`sub_orders` لـ `service_role` بس. بتظهر في SQL editor، ومتنضّفة من البيانات الشخصية بالتصميم — بس ماتنقلهاش برّه.

#### 2.7.8 التبديل من الـ staging للإنتاج
دلوقتي الأسرار والـ webhooks على `https://stage.ibtekr.club`. لما صاحب المشروع يقرر نشتغل على الموقع الحقيقي (القرار يتكتب في الدفتر):
1. **الأسرار الأربعة:** `WOO_URL` (الموقع الحقيقي)، `WOO_CK`/`WOO_CS` (مفاتيح REST من الموقع الحقيقي)، و`WOO_WEBHOOK_SECRET` **جديد** — كده أي delivery فاضلة من الـ staging بترجع 401. (و`WOO_WP_*` لو مستخدمينهم.) و**`WOO_PUSH_ENABLED = 1`** عشان تغيير الحالة من النظام يوصل الموقع (من غيره الدفع بيتساب `push_disabled`). على الموقع الحقيقي إيميلات العملاء وبوسطة شغّالين بالقصد، فاتأكد إن الفريق عارف إن أي تغيير حالة من النظام بيوصلهم زي ما بيحصل من لوحة WooCommerce.
2. **على الـ staging:** وقّف الأربعة `ibtekr-ops:*` من WooCommerce › Settings › Advanced › Webhooks (Disabled). الدوال عمرها ما بتوقف ولا بتمسح webhook.
3. **`register_webhooks`** (2.7.4) → بيعمل الأربعة على الموقع الحقيقي، والـ webhooks اللي هناك (n8n وغيره) ماتتلمسش.
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
