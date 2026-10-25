### Task 7: التحقق بخطوتين الحقيقي + إلزام aal2 على السيرفر + Vault/pg_cron (`0008_mfa_cron.sql`)

**Files:**
- Create: `supabase/migrations/0008_mfa_cron.sql`, `supabase/tests/rls_mfa.sql`, `tests/e2e/twofa.spec.mjs`
- Modify: `app/js/adapter/auth.js`, `tests/adapter/auth.test.mjs`, `app/js/blocks/18-page-profile.js`, `tests/split.test.mjs` (`EDITED` + 18), `tools/blocks.lock.json`, `tests/e2e/supabase-mock.mjs` (MFA enroll/challenge/verify/unenroll + factors)
- Test: `npm run db:test`, `npm test`, `npm run e2e`

**Interfaces:**
- Produces (SQL):
  - `has_perm(key)`: يرجّع `'N'` كمان لما `p.twofa = true` و`coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'`؛ `is_admin()` نفس الشرط. (الملف يعيد تعريف الدالتين بـ `create or replace`.)
  - `public.mark_twofa_enrolled() returns void` (`security definer`, `set search_path = public`): يشترط `auth.jwt()->>'aal' = 'aal2'` ووجود factor `verified` في `auth.mfa_factors` للمستخدم، وإلا `raise exception 'aal2_required' using errcode='42501'`؛ يحدّث `profiles.twofa = true` للمستخدم الحالي. `public.mark_twofa_disabled()`: يشترط aal2 ويحدّث `twofa = false`. execute لـ `authenticated` فقط.
  - Vault + cron (محروس بـ `if exists (select 1 from pg_available_extensions where name = 'pg_cron')`): `create extension if not exists pg_cron; create extension if not exists pg_net;` سر `sync_secret` يتولّد لو مش موجود: `select vault.create_secret(encode(gen_random_bytes(32),'hex'), 'sync_secret')`; دالة `public.sync_secret_matches(candidate text) returns boolean` (`security definer`; execute لـ `service_role` فقط) تقارن بثبات الزمن مع `vault.decrypted_secrets`; وظيفة `cron.schedule('woo-sync-backup', '*/15 * * * *', $$ select net.http_post(url := current_setting('app.functions_url') || '/woo-sync', headers := jsonb_build_object('Content-Type','application/json','X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')), body := '{"action":"all"}'::jsonb) $$)` — و`app.functions_url` تتضبط بـ `alter database postgres set app.functions_url = 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1'` (في الملف، محروس). (التكرار 15 دقيقة = القيمة الافتراضية في إعدادات البروتوتايب؛ صفحة الإعدادات في المرحلة 10 بتغيّرها.)
- Produces (JS): `IBAuth.enrollTotp() → Promise<{ ok, factorId, qr (svg data uri), secret, uri }>` (`mfa.enroll({ factorType:'totp', friendlyName:'Authenticator' })`)، `IBAuth.verifyEnroll(factorId, code) → Promise<{ok}>` (`challengeAndVerify` ثم `rpc('mark_twofa_enrolled')`؛ فشل الـ RPC → `unenroll` ورجوع `{ok:false, reason:'server'}`)، `IBAuth.unenrollTotp() → Promise<{ok}>` (يشترط جلسة aal2: `mfa.getAuthenticatorAssuranceLevel`، ثم `rpc('mark_twofa_disabled')` ثم `mfa.unenroll`); بعد النجاح تحديث `IBDirectory` (`twofa`) و`K.logEvent('profile.2fa.enable'|'profile.2fa.disable')`.
- Produces (الكتلة 18، قرار): في قسم «التحقق بخطوتين»: الخيارات «واتساب» و«إيميل» بتتعرض معطّلة مع ملاحظة «بعد تشغيل جسر واتساب» (الوثيقة §4.1)؛ «تطبيق Authenticator» هو المسار الوحيد الشغال: الخطوة 2 بتعرض الـ QR (صورة من `qr`) والـ secret كنص قابل للنسخ، الخطوة 3 كود 6 أرقام → `verifyEnroll`؛ نص «10 أكواد احتياطية» يتبدّل بـ «لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية»؛ «إيقاف» ينادي `unenrollTotp` ولو الجلسة aal1 يعرض «سجّل دخول بالكود الأول». `m.twofa` بيتحدّث من الدليل مش محليًا.
- **قرار:** إلزام aal2 بيتعمل جوه `has_perm`/`is_admin` (نقطة واحدة) بدل تعديل كل سياسة — ليه: كل السياسات بتمر عليهم — التكلفة لو غلط: استدعاء `auth.jwt()` زيادة في كل تقييم.
- **قرار:** الأكواد الاحتياطية خارج النطاق (Supabase مابيدعمهاش أصليًا)؛ الاستعادة = الأدمن من لوحة Supabase (Authentication › Users › factors) — مكتوبة في الشاشة والرنبوك.

- [ ] **Step 1: اكتب `rls_mfa.sql`**: مستخدم العمليات بـ `twofa = true`: claims بـ `"aal":"aal1"` → `has_perm('orders.view') = 'N'` و`is_admin()` false للأدمن بنفس الشرط؛ claims `"aal":"aal2"` → `F`؛ مستخدم `twofa = false` بـ aal1 → طبيعي؛ `mark_twofa_enrolled()` بـ aal1 → 42501؛ بـ aal2 ومن غير factor → 42501؛ بـ aal2 وfactor `verified` مُدرج في `auth.mfa_factors` (الـ stub المحلي يضيف الجدول: `id uuid, user_id uuid, status text, factor_type text`) → `profiles.twofa = true`; `sync_secret_matches` من `authenticated` → 42501 (مافيش execute).
- [ ] **Step 2: `npm run db:test`** → يفشل. **Step 3:** اكتب 0008 (محروس: الـ stub المحلي مافيهوش vault/pg_cron → الجزء ده يتخطّى بـ `if exists`؛ `sync_secret_matches` تتعرّف دايمًا وترجّع `false` لو مافيش vault). **Step 4:** `npm run db:test` → ok.
- [ ] **Step 5: اكتب `tests/e2e/twofa.spec.mjs`** (mockOnly) + امتداد الـ mock (`POST /auth/v1/factors` → factor + QR وهمي، `challenge`/`verify` بالكود `123456` → جلسة aal2، `DELETE /auth/v1/factors/{id}`، `POST /rest/v1/rpc/mark_twofa_enrolled` يشترط aal2 في التوكن): `enrol with the authenticator app`: ملفي → «تفعيل» → «تطبيق Authenticator» → QR ظاهر → كود `123456` → «اتفعّل» و`mock.profiles[ops].twofa === true`، ثم خروج ودخول → شاشة الكود → `123456` → اللوحة؛ `whatsapp/email options are disabled`; `wrong code keeps the dialog`; `disable needs aal2`.
- [ ] **Step 6:** الـ adapter + اختباراته، الكتلة 18، `EDITED` + 18، `npm run lock`؛ `npm test` و`npm run e2e` PASS.
- [ ] **Step 7: Commit**

```bash
git add supabase app tests tools/blocks.lock.json
git commit -m "feat(auth): real TOTP enrolment from the profile page; has_perm requires aal2 for enrolled members; vault secret and pg_cron backup sync"
```

---

