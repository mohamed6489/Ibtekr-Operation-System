# النشر على subdomain في Hostinger

الملف ده خطوات أول نشر للتطبيق (`app/`) على `https://<subdomain>.ibtekr.club`، بالترتيب. أي جلسة معاها Supabase MCP وإضافة Hostinger تقدر تخلّصه في دقايق؛ ومن غيرهم كل خطوة ليها بديل من اللوحة.

مشروع Supabase: `fsynculhaupcktzkfkdd` (eu-central-1). الاستضافة: Hostinger shared hosting (Apache/LiteSpeed، ملفات static بس، مافيش build).

في كل الملف: `<subdomain>` = اسم الـ subdomain اللي هيختاره صاحب المشروع (مثلًا `ops` → `https://ops.ibtekr.club`).

---

## 1. اللي محتاجينه منك

1. **اسم الـ subdomain** — الكلمة اللي قبل `.ibtekr.club`. ده بيدخل في Site URL بتاع Supabase وفي مكان الرفع.
2. **صلاحية على Hostinger**، واحدة من الاتنين:
   - إضافة `hostinger` في Claude Code: شغّل `/mcp` ووافق على تسجيل الدخول لحساب Hostinger (ده الطريق المفضّل).
   - أو بيانات FTP للـ subdomain: host وuser وpassword. **دول مايتكتبوش في git** — يتحطوا في `.env` (متجاهَل في `.gitignore`) أو يتكتبوا في الترمينال وقت الرفع بس.
3. **إيميلك الحقيقي** اللي هيبقى أول حساب أدمن (`M01`) — بالإضافة لاسمك ورقم موبايلك (11 رقم) عشان صف `profiles`.

---

## 2. Supabase قبل النشر

### 2.1 الـ migrations والاختبارات (Supabase MCP)
بالترتيب ده بالظبط، كل واحدة بـ `apply_migration` والاسم ده والمحتوى من الملف:

| الاسم (`name`) | الملف |
|---|---|
| `identity` | `supabase/migrations/0001_identity.sql` |
| `system` | `supabase/migrations/0002_system.sql` |
| `seed_roles` | `supabase/migrations/0003_seed_roles.sql` |

بعدها `execute_sql` بمحتوى الاختبارين (كل واحد بيعمل `rollback` في الآخر، فمش بيسيب حاجة وراه):
- `supabase/tests/rls_identity.sql` → لازم يطلع `NOTICE: rls_identity: ok`
- `supabase/tests/rls_system.sql` → لازم يطلع `NOTICE: rls_system: ok`

أي `ERROR` = وقّف ومتنشرش. لو الـ MCP رفض `set local role`، شغّلهم بـ `psql` كـ `postgres`.
**ممنوع** تطبّق `supabase/tests/_local_auth_stub.sql` على Supabase — ده لـ Postgres المحلي بس.

لو حد طبّق جزء قبل كده، `list_migrations` بيوريك اللي اتطبّق وتكمّل من بعده.

### 2.2 `get_advisors`
شغّله مرتين: `type: security` و`type: performance`.

المتوقع والمقبول:
- **`login_lookups`: RLS enabled, no policies** — مقصود. الجدول ده عدّاد الـ throttle بتاع الدخول، ومحدش يلمسه غير الدالة `email_for_identifier` (ومفيش grants لـ `anon`/`authenticated` أصلًا).
- **`email_for_identifier` دالة `security definer` وينفع `anon` ينفّذها** — مقصود. شاشة الدخول محتاجاها قبل ما المستخدم يسجّل، عشان تحوّل الموبايل لإيميل، وعليها حد 60 طلب في الدقيقة.
- ملاحظات performance (INFO/WARN) على الـ policies أو الـ indexes اللي ذكرتها تقارير المهمة 3 و4 — مقبولة دلوقتي.

غير المقبول: أي جدول في `public` من غير RLS، أو دالة من غير `search_path` ثابت، أو أي تحذير جديد مش مفهوم — يتصلّح الأول.

### 2.3 إعدادات Auth (لوحة Supabase › Authentication)
- **Sign In / Providers › Email:** شغّال. التسجيل الذاتي (sign-ups) يفضل مقفول — الحسابات بالدعوة بس.
- **Confirm email:** حسب اختيارك. لو شغّال، الدعوة هي اللي بتأكد الإيميل.
- **Multi-Factor › TOTP:** enabled.
- **URL Configuration:**
  - Site URL: `https://<subdomain>.ibtekr.club`
  - Redirect URLs:
    - `https://<subdomain>.ibtekr.club/**`
    - `http://localhost:4173/**`
- **Secure password change** (يطلب إعادة تأكيد قبل تغيير الباسورد): يُفضّل يبقى شغّال.
- Rate limits: الافتراضي.

### 2.4 مفتاح الـ anon في `app/config.js`
خد المفتاح العام من Settings › API › "anon public" (أو MCP `get_publishable_keys`) وحطه في `supabaseAnonKey`:

```js
window.IB_CONFIG = window.IB_CONFIG || {
  supabaseUrl: 'https://fsynculhaupcktzkfkdd.supabase.co',
  supabaseAnonKey: '<anon public key>',
};
```

ده مفتاح عام (الـ RLS هي اللي بتحمي البيانات) وعادي يتعمله commit. **الـ service_role key عمره ما يدخل الملف ده ولا أي ملف في git.**

### 2.5 حسابات التطوير
`tools/seed-dev-users.sql` بيعمل 3 حسابات بباسورد مكتوب في الملف نفسه (`IbtekrDev-2026`). يتشغّل **على مشروع dev/staging بس، عمره ما يتشغّل على الإنتاج** — على الإنتاج هيبقى باب خلفي بباسورد أدمن معروف لأي حد شاف الريبو.

---

## 3. أول حساب أدمن

1. Supabase › Authentication › Users › **Invite user** بإيميلك (أو **Add user › Create new user** بإيميل وباسورد، وعلّم Auto Confirm).
2. بعدها `execute_sql` (أو SQL editor) — بيجيب الـ id من `auth.users` بالإيميل، فمش محتاج تنسخه:

```sql
insert into public.profiles (id, member_code, name, email, phone, role_id, title, dept, status)
select u.id, 'M01', '<الاسم>', u.email, '<01xxxxxxxxx>', 'admin', 'المؤسس والمدير العام', 'الإدارة', 'active'
from auth.users u
where u.email = lower('<owner-email>');
-- المتوقع: INSERT 0 1. لو 0 → الإيميل مش موجود في auth.users؛ راجع خطوة 1.

select id, member_code, email, role_id, status from public.profiles where member_code = 'M01';
```

لو استخدمت Invite: افتح لينك الدعوة من الإيميل الأول. ملاحظة: شاشة الدعوة في التطبيق لسه ماتقدرش تحط باسورد (تقرير المهمة 5)، فالأسهل دلوقتي: بعد ما تفتح اللينك، اطلب "نسيت كلمة المرور" من شاشة الدخول وحط الباسورد من لينك الاسترجاع — أو استخدم Create new user بباسورد من الأول.

---

## 4. رفع الملفات

**اللي يترفع:** كل محتوى `app/` (مش الفولدر نفسه) على الـ document root بتاع الـ subdomain — ده `public_html/` الخاص بالـ subdomain زي ما hPanel بيعرضه (غالبًا `domains/ibtekr.club/public_html/<subdomain>/`). بما فيه `.htaccess` (ملف مخفي، اتأكد إنه اترفع):

```
.htaccess   index.html   config.js   css/   js/adapter/   js/blocks/   js/vendor/
```

مافيش build — الملفات بتترفع زي ما هي. قبل الرفع: `config.js` فيه مفتاح الإنتاج (خطوة 2.4).

**اللي مايترفعش:** `node_modules/`، `tests/`، `tools/`، `supabase/`، `docs/`، `Prototype file`، `.env`، `.git`، وأي حاجة برّه `app/`.

**قبل الرفع في hPanel:** اعمل الـ subdomain (Domains › Subdomains)، وفعّل SSL المجاني ليه، وشغّل Force HTTPS.

### الطريق المفضّل: إضافة Hostinger
بعد `/mcp`، استخدم سكيل **`hostinger:hosting-deploy-static-site`**: المصدر `app/`، والهدف الـ subdomain `<subdomain>.ibtekr.club`.

### البديل: FTP
الباسورد من متغير بيئة، مش مكتوب في الأمر:

```bash
export LFTP_PASSWORD='<ftp password>'   # في الترمينال بس، أو من .env
lftp --env-password -u '<ftp user>' '<ftp host>' \
  -e "set ftp:ssl-allow true; mirror -R --verbose app/ /; bye"
```

ده بافتراض إن حساب الـ FTP جذره هو فولدر الـ subdomain؛ لو جذره `public_html` العام، غيّر `/` لمسار الـ subdomain. `--delete` بيمسح من السيرفر اللي اتشال من `app/` — استخدمه في إعادة النشر بس بعد ما تتأكد من المسار.

---

## 5. التحقق بعد النشر

1. افتح `https://<subdomain>.ibtekr.club` → عنوان التبويب لازم يبقى **`تسجيل الدخول — نظام إبتكر`**، وشاشة الدخول ظاهرة.
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

4. افتح DevTools › Console: مايبقاش فيه أخطاء `Content-Security-Policy`. وفي Network: الـ response headers فيها `Content-Security-Policy` و`X-Content-Type-Options` (يعني `.htaccess` اترفع واشتغل).
5. **الـ e2e على Supabase حقيقي** — من جهاز تطوير، على **مشروع staging** متعمل عليه نفس الـ migrations وعليه `tools/seed-dev-users.sql`:

```bash
# مؤقتًا: supabaseUrl/supabaseAnonKey في app/config.js بتوع الـ staging (ماتعملهمش commit)
E2E_SUPABASE_LIVE=1 E2E_ADMIN_EMAIL=admin.dev@ibtekr.local E2E_ADMIN_PW=IbtekrDev-2026 \
E2E_OPS_PW=IbtekrDev-2026 E2E_VIEWER_PW=IbtekrDev-2026 npm run e2e
git checkout app/config.js   # رجّع مفتاح الإنتاج
```

ليه مش على الإنتاج: الاختبارات محتاجة الحسابات التلاتة بباسوردات معروفة (أدمن وops وviewer موقوف) — وده بالظبط اللي ممنوع على الإنتاج (خطوة 2.5). وكمان بتكتب صفوف في `activity_log`، وبتضرب حد الـ 60 lookup في الدقيقة اللي ممكن يقفل الدخول على الفريق الحقيقي لمدة دقيقة. ومشروع الـ staging لازم يكون فيه `http://localhost:4173/**` في Redirect URLs.

---

## 6. فحص أمني قبل الإعلان

قبل ما تبعت الرابط للفريق:

1. `/differential-review` على الفرع (مقارنةً بـ `main`) — مفيش findings مفتوحة.
2. semgrep نظيف:

   ```bash
   semgrep --config p/javascript --config p/sql app/ supabase/
   ```

   (أو إضافة semgrep لو متاحة. لو `p/sql` مش موجود في الـ registry، استخدم `--config p/secrets` مكانه.)
3. `get_advisors` (security + performance) مفيهوش غير المقبول في 2.2.
4. مفيش أسرار في تاريخ git:

   ```bash
   git log -p --all -- . ':!app/js/vendor' | grep -nEi 'sb_secret_|eyJhbGciOi|-----BEGIN|service_role_key|SUPABASE_SERVICE|LFTP_PASSWORD=|FTP_PASS'
   ```

   المتوقع: لا شيء، أو بس مفتاح الـ anon العام في `app/config.js` (JWT بيبدأ بـ `eyJhbGciOi` وفيه `"role":"anon"` — فكّه في jwt.io أو `base64 -d` وتأكد). أي مفتاح `service_role` أو باسورد حقيقي = غيّره فورًا من Supabase/Hostinger، وبعدين نضّف التاريخ. (باسورد `IbtekrDev-2026` بتاع حسابات التطوير معروف ومقصود.)

---

## 7. بعد كده

- لو الـ subdomain مختلف عن `https://ibtekr.club` اللي في إعدادات النظام، حدّث صف الإعدادات العامة:

  ```sql
  update public.settings set data = jsonb_set(data, '{site}', '"https://<subdomain>.ibtekr.club"')
  where section = 'general';
  ```

- `main` يفضل فرع الدمج: اللي اتنشر لازم يكون هو اللي في `main`. إعادة النشر = نفس خطوة 4 (و`config.js` و`index.html` عليهم `no-cache` في `.htaccess`، فالتحديث بيظهر على طول؛ الـ css/js ممكن تفضل في كاش المتصفح لحد 7 أيام، فـ hard refresh لو التغيير مستعجل).
- الـ CSP في `app/.htaccess` مربوط بـ project ref `fsynculhaupcktzkfkdd`. لو المشروع اتغيّر، أو اتضاف مصدر خارجي جديد (مثلًا API بتاع WooCommerce من المتصفح)، لازم `connect-src`/`script-src` يتحدّثوا.
