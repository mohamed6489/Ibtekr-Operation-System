# خطة التنفيذ — المرحلة 0: الأساس

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تحويل البروتوتايب أحادي الملف لتطبيق ثابت منظم في `app/` بنفس السلوك بالضبط، متوصّل بـ Supabase لتسجيل الدخول والأدوار والصلاحيات والإعدادات وسجل النشاط، ومنشور على subdomain Hostinger.

**Architecture:** سكريبت تقسيم حتمي يفكّ البروتوتايب لملفات (CSS + 29 ملف JS بنفس ترتيب التحميل) مع اختبار يثبت إن إعادة تجميعهم بتطلّع الملف الأصلي بالبايت. بعدها طبقات adapter جديدة (`IBSupabase`, `IBAuth`, `IBDirectory`, `IBActivity`) تتحقن قبل الشِل، وشاشة اللوجين الموجودة تتحوّل من `DEMO_PW` لـ Supabase Auth من غير تغيير في شكلها. قاعدة البيانات في المرحلة دي: الهوية + الصلاحيات (بيانات مش كود) + جداول النظام، كلها بـ RLS.

**Tech Stack:** JavaScript عادي (ES2020، من غير build)، `@supabase/supabase-js` 2.x (نسخة UMD محلية)، Supabase (Postgres 17، Auth، RLS)، Node 24 (`node --test`)، Playwright للـ e2e، GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md`

## Global Constraints

- الواجهة تفضل JavaScript عادي؛ **ممنوع** React أو أي إطار عمل، وممنوع build step. (القسم 2، أهداف مضادة)
- **سلوك الصفحات مايتغيرش**: أي كتلة من البروتوتايب تتنقل لملف كما هي؛ التعديل الوحيد المسموح في المرحلة دي في كتلة الشِل (block 21) ودوال `K.logEvent`/`K.ME` اللي الخطة بتسمّيها. (القسم 4.1)
- ترتيب تحميل السكريبتات = ترتيب الكتل في البروتوتايب (الـ globals بتعتمد على بعضها). (القسم 4.1)
- مفتاح `anon` بس في الواجهة. مفاتيح الخدمة لا في الكود ولا في Git. `.env` مستثنى. (القسم 4.6)
- RLS مفعّل على كل جدول جديد (المشروع متعمول بـ automatic RLS). (القسم 4.2)
- الصلاحيات بيانات: `roles.permissions` JSON + `profiles.custom_perms` + دالة `has_perm(key)`؛ الأدمن دايمًا `F`. (القسم 4.2)
- ثوابت المصادقة من `AUTH` في البروتوتايب: `maxTries 5`، `lockMinutes 15`، `idleMinutes 480`، `warnSeconds 60`، `linkMinutes 30`، `inviteDays 7`، `rememberDays 30`. (القسم 4.1)
- عربي RTL، خط Cairo من Google Fonts (موجود في الـ CSS). (القسم 3)
- مشروع Supabase: `ibtekr-ops`، ref `fsynculhaupcktzkfkdd`، eu-central-1. (القسم 3)
- المستودع: `mohamed6489/Ibtekr-Operation-System`، الفرع `main`. كل مهمة بتنتهي بـ commit. `Design file/` مش بيترفع.

## Review Focus

1. **رقم موبايل بأرقام عربية (٠١٠…) في خانة الدخول** → يتقبل ويتحوّل لأرقام لاتينية قبل البحث (`O.toLatin` موجود). اختبار في Task 5 (`identifier arabic digits`).
2. **حساب موقوف (`status = 'suspended'`) بكلمة سر صحيحة** → يرفض ويعرض شاشة "الحساب موقوف"، ومايرجّعش جلسة. اختبار في Task 3 (RPC بترجع `suspended`) وTask 5 (e2e).
3. **5 محاولات غلط ثم محاولة صح** → يرفض لحد ما تعدي 15 دقيقة (القفل محلي + Supabase نفسه بيحدّ). اختبار في Task 2 (`loginFail` × 5 → `isLocked`).
4. **خمول 8 ساعات** → خروج تلقائي وعرض شاشة "الجلسة خلصت"، ومايكملش بأي طلب للسيرفر. اختبار في Task 2 (`idleState(28800) === 'expired'`) وTask 5 (الـ signOut بيتنادى).
5. **عضو بدور مخصص أو تجاوز شخصي** → `has_perm` بترجع التجاوز قبل الدور، والأدمن دايمًا `F`. اختبار في Task 3 (SQL).

---

## File Structure

```
app/
  index.html                     ← يحمّل css + config + vendor + adapters + الكتل بالترتيب، وفيه <div id="root" dir="rtl" lang="ar">
  config.js                      ← window.IB_CONFIG = { supabaseUrl, supabaseAnonKey }  (مفتاح عام؛ بيتعمله commit)
  css/base.css                   ← الـ <style> اللي في السطر 1 من البروتوتايب
  css/app.css                    ← الـ <style> من السطر 5 لـ 1152
  js/vendor/supabase.js          ← نسخة UMD من @supabase/supabase-js (مثبّتة الإصدار)
  js/adapter/supabase-client.js  ← window.IBSupabase
  js/adapter/auth.js             ← window.IBAuth
  js/adapter/directory.js        ← window.IBDirectory (profiles/roles → IBKit.store.members)
  js/adapter/activity.js         ← window.IBActivity (K.logEvent → activity_log)
  js/blocks/NN-<name>.js         ← 29 ملف، واحد لكل كتلة <script> (أسماء ثابتة في tools/blocks.json)
tools/
  blocks.json                    ← [{n:1, file:"01-dataio.js"}, …] الترتيب والأسماء
  split-prototype.mjs            ← يقرا البروتوتايب ويكتب app/css/*.css + app/js/blocks/*.js + app/index.html
  join-prototype.mjs             ← يعيد تجميع الملفات لنص واحد عشان المقارنة
  seed-dev-users.sql             ← مستخدمين تجريبيين (dev فقط)
tests/
  split.test.mjs                 ← join(split(prototype)) === prototype
  domain/ops-domain.test.mjs     ← قواعد الدخول والخمول من block 12
  e2e/login.spec.mjs             ← Playwright
  playwright.config.mjs
supabase/
  migrations/0001_identity.sql   ← roles, profiles, invites, has_perm, email_for_identifier, RLS
  migrations/0002_system.sql     ← settings, status_map, activity_log, alerts, notification_prefs, RLS
  migrations/0003_seed_roles.sql ← الأدوار الستة + مصفوفة الصلاحيات
  tests/rls_identity.sql         ← اختبارات SQL بتفشل بـ RAISE EXCEPTION
  tests/rls_system.sql
CLAUDE.md · .claude/settings.json · package.json · .github/workflows/ci.yml
```

**أسماء الكتل (tools/blocks.json)، بترتيب البروتوتايب:**
`01-dataio` `02-accounts-domain` `03-seed-accounts` `04-reports-domain` `05-tickets-domain` `06-vendors-domain` `07-seed-transport` `08-transport-domain` `09-details-domain` `10-ui-kit` `11-seed-product-images` `12-ops-domain` `13-logo` `14-kit` `15-page-hr` `16-page-inventory` `17-page-settings` `18-page-profile` `19-cs-domain` `20-page-cs` `21-shell` `22-orders-ops` `23-notif-roles-domain` `24-dash-domain` `25-page-dashboard` `26-data-actions` `27-commands-domain` `28-app` `29-orders-app`.

---

### Task 1: تقسيم البروتوتايب بشكل حتمي وقابل للتحقق

**Files:**
- Create: `package.json`, `tools/blocks.json`, `tools/split-prototype.mjs`, `tools/join-prototype.mjs`, `tests/split.test.mjs`
- Create (generated): `app/index.html`, `app/css/base.css`, `app/css/app.css`, `app/js/blocks/*.js`

**Interfaces:**
- Consumes: `Prototype file/نظام إبتكر.html` (السطر 1: `<!doctype html>…<style>…</style></head><body>`؛ السطر 5–1152: `<style>…</style>`؛ السطر 1153: `<div id="root" dir="rtl" lang="ar"></div>`؛ بعدها 29 كتلة `<script>…</script>`؛ آخر سطر `</body></html>`).
- Produces: `split(sourceText) → { head: string, baseCss: string, appCss: string, rootDiv: string, blocks: [{n, file, code}], tail: string }` و `join(parts) → string` في الملفين تحت `tools/`، و`npm test` بيشغّل `node --test tests/`.

- [ ] **Step 1: اكتب `package.json`** بـ `"type": "module"`, `"private": true`, scripts: `"test": "node --test tests/"`, `"split": "node tools/split-prototype.mjs"`, `"serve": "npx http-server app -p 4173 -c-1"`, `"e2e": "npx playwright test -c tests/playwright.config.mjs"`. devDependencies: `http-server`, `@playwright/test` (أحدث نسخة وقت التنفيذ، مثبّتة بالرقم).

- [ ] **Step 2: اكتب `tools/blocks.json`** بالـ 29 اسم من "أسماء الكتل" فوق: `[{"n":1,"file":"01-dataio.js"}, …]`.

- [ ] **Step 3: اكتب الاختبار الفاشل `tests/split.test.mjs`**

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { split } from '../tools/split-prototype.mjs'; import { join } from '../tools/join-prototype.mjs';
const SRC = 'Prototype file/نظام إبتكر.html';
test('split yields 29 blocks in order', () => {
  const p = split(readFileSync(SRC, 'utf8'));
  assert.equal(p.blocks.length, 29);
  assert.equal(p.blocks[0].file, '01-dataio.js');
  assert.equal(p.blocks[28].file, '29-orders-app.js');
  assert.match(p.blocks[20].code, /window\.IBShell = /);
});
test('join(split(x)) === x byte for byte', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.equal(join(split(src)), src);
});
```

- [ ] **Step 4: شغّل `npm test` وتأكد إنه بيفشل** بـ "Cannot find module … split-prototype.mjs".

- [ ] **Step 5: اكتب `tools/split-prototype.mjs`** بـ `export function split(src)` بالقواعد: الكتل = كل `<script>` … `</script>` بالترتيب (الكود = اللي بينهم من غير الوسوم، بنفس الأسطر الفاصلة)؛ `appCss` = اللي بين `<style>` في السطر 5 و`</style>` في 1152؛ `baseCss` = اللي بين `<style>` و`</style>` في السطر 1؛ `head`/`rootDiv`/`tail` = الباقي حرفيًا عشان `join` تقدر ترجّعه. ولما يتشغّل كأمر (`npm run split`) يكتب: `app/css/base.css`, `app/css/app.css`, `app/js/blocks/<file>`, و`app/index.html` من القالب ده (الترتيب إلزامي):

```html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>نظام إبتكر</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;900&display=swap">
<link rel="stylesheet" href="css/base.css"><link rel="stylesheet" href="css/app.css">
</head><body>
<div id="root" dir="rtl" lang="ar"></div>
<script src="config.js"></script><script src="js/vendor/supabase.js"></script>
<script src="js/adapter/supabase-client.js"></script><script src="js/adapter/auth.js"></script><script src="js/adapter/directory.js"></script><script src="js/adapter/activity.js"></script>
<!-- blocks, in prototype order -->
<script src="js/blocks/01-dataio.js"></script> … <script src="js/blocks/29-orders-app.js"></script>
</body></html>
```
(في Task 1 ملفات `config.js` والـ adapters لسه مش موجودة؛ المتصفح هيتجاهل 404 ويكمّل، وTask 5 بيعملهم.)

- [ ] **Step 6: اكتب `tools/join-prototype.mjs`** بـ `export function join(parts)` اللي بترجّع النص الأصلي حرفيًا (الوسوم `<script>`/`</script>` و`<style>` بنفس مكانها).

- [ ] **Step 7: شغّل `npm test`** → الاختبارين PASS. شغّل `npm run split` وتأكد إن `app/js/blocks/` فيه 29 ملف.

- [ ] **Step 8: افتح التطبيق المقسّم في المتصفح** (`npm run serve` ثم http://localhost:4173) وتأكد يدويًا: شاشة الدخول ظاهرة بالعربي وبدون أخطاء في الـ console غير 404 لملفات الـ adapters.

- [ ] **Step 9: Commit**

```bash
git add package.json tools tests app
git commit -m "feat: split the prototype into app/ with a byte-exact round-trip test"
```

---

### Task 2: اختبارات قواعد الدخول والخمول + Playwright على الواجهة المقسّمة

**Files:**
- Create: `tests/domain/ops-domain.test.mjs`, `tests/playwright.config.mjs`, `tests/e2e/login.spec.mjs`

**Interfaces:**
- Consumes: `app/js/blocks/12-ops-domain.js` بيصدّر UMD → في Node: `const O = require(path)` بيرجّع `{ AUTH, loginInit, loginFail, isLocked, identifierKind, toLatin, validatePassword, idleState, … }` (الدوال موجودة فعلًا في البروتوتايب سطر 2846–2865).
- Produces: `npm run e2e` بيشغّل Playwright على `npm run serve`.

- [ ] **Step 1: اكتب `tests/domain/ops-domain.test.mjs`** (بـ `createRequire`):

```js
test('AUTH constants match the spec', () => assert.deepEqual(O.AUTH, { maxTries: 5, lockMinutes: 15, idleMinutes: 480, warnSeconds: 60, linkMinutes: 30, inviteDays: 7, rememberDays: 30 }));
test('5 failures lock for 15 minutes', () => { let a = O.loginInit(); for (let i = 0; i < 5; i++) a = O.loginFail(a, 0); assert.equal(O.isLocked(a, 14 * 60 * 1000), true); assert.equal(O.isLocked(a, 15 * 60 * 1000 + 1), false); });
test('identifierKind: email, 11-digit phone, arabic digits, junk', () => { assert.equal(O.identifierKind('a@b.co'), 'email'); assert.equal(O.identifierKind('01012345678'), 'phone'); assert.equal(O.identifierKind(O.toLatin('٠١٠١٢٣٤٥٦٧٨')), 'phone'); assert.equal(O.identifierKind('abc'), null); });
test('idleState thresholds', () => { assert.equal(O.idleState(0), 'active'); assert.equal(O.idleState(28800 - 30), 'warn'); assert.equal(O.idleState(28800), 'expired'); });
```
(القيم المرجعة لـ `identifierKind` تتاخد من الكود الفعلي في block 12 — لو بيرجّع قيم تانية غير `'email'`/`'phone'`/`null` عدّل التوقعات لتطابقه، مش العكس.)

- [ ] **Step 2: شغّل `npm test`** → PASS (لو فشل، ده بيكشف اختلاف في القواعد؛ ماتعدّلش block 12).

- [ ] **Step 3: اكتب `tests/playwright.config.mjs`** بـ `webServer: { command: 'npm run serve', url: 'http://localhost:4173', reuseExistingServer: true }`، `use: { baseURL, locale: 'ar-EG' }`، chromium بس.

- [ ] **Step 4: اكتب `tests/e2e/login.spec.mjs`**:

```js
test('login screen renders in Arabic RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('تسجيل الدخول — نظام إبتكر');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#root')).toBeHidden();
});
```

- [ ] **Step 5: `npx playwright install chromium` ثم `npm run e2e`** → PASS.

- [ ] **Step 6: Commit**

```bash
git add tests
git commit -m "test: domain rules for auth/idle and a Playwright login-screen smoke test"
```

---

### Task 3: Supabase — الهوية والصلاحيات (migration 0001 + seed 0003)

**Files:**
- Create: `supabase/config.toml` (project ref فقط)، `supabase/migrations/0001_identity.sql`, `supabase/migrations/0003_seed_roles.sql`, `supabase/tests/rls_identity.sql`

**Interfaces:**
- Produces (SQL):
  - `public.roles(id text pk, name text unique not null, description text, is_system boolean default false, permissions jsonb not null default '{}', sort int)`
  - `public.profiles(id uuid pk references auth.users on delete cascade, member_code text unique, name text not null, email text unique not null, phone text unique, role_id text references roles, title text, dept text, manager_id uuid references profiles, status text not null check (status in ('active','suspended','invited')) default 'active', twofa boolean default false, custom_perms jsonb default '{}', created_at timestamptz default now())`
  - `public.invites(id uuid pk default gen_random_uuid(), email text, role_id text references roles, token text unique, expires_at timestamptz, accepted_at timestamptz, created_by uuid)` — `expires_at` افتراضي `now() + interval '7 days'`.
  - `public.is_admin() returns boolean` (role_id = 'admin' للمستخدم الحالي).
  - `public.has_perm(key text) returns text` — ترجع `'F'|'P'|'N'`: أدمن → `'F'`؛ وإلا `profiles.custom_perms->>key` لو موجود؛ وإلا `roles.permissions->>key`؛ وإلا `'N'`. `security definer stable`.
  - `public.email_for_identifier(ident text) returns table(email text, status text)` — تقبل إيميل أو رقم 11 رقم، ترجّع إيميل الحساب وحالته لو موجود؛ `security definer`؛ ممنوحة لـ `anon` و`authenticated`.
  - RLS: `profiles`: select للكل المسجلين لو `has_perm('settings.view') <> 'N'` أو الصف بتاعه؛ update لصفه (name, phone, twofa فقط عبر trigger بيمنع تغيير role_id/status/custom_perms غير للأدمن)؛ insert/delete أدمن. `roles`: select للمسجلين، كتابة أدمن. `invites`: أدمن فقط.
- مفاتيح الصلاحيات (مأخوذة من البروتوتايب سطر 3958، الأعمدة بترتيب الأدوار `أدمن, عمليات, خدمة العملاء, حسابات, متابعة الموردين, مشاهد`؛ اتأكد من الترتيب بـ `grep -n "const ROLES" ` في block 17):

| key | أدمن | عمليات | خدمة العملاء | حسابات | متابعة الموردين | مشاهد |
|---|---|---|---|---|---|---|
| orders.view | F|F|F|F|F|P |
| orders.status | F|F|F|N|F|N |
| orders.edit | F|P|N|N|N|N |
| orders.export | F|F|N|F|N|N |
| vendors.view | F|F|P|F|F|P |
| vendors.edit | F|P|N|N|F|N |
| vendors.toggle | F|N|N|N|N|N |
| accounts.view | F|P|N|F|N|N |
| accounts.add | F|N|N|F|N|N |
| accounts.approve | F|N|N|P|N|N |
| tickets.view | F|F|F|N|P|P |
| tickets.manage | F|F|F|N|N|N |
| reports.view | F|F|P|F|P|P |
| reports.export | F|F|N|F|N|N |
| settings.view | F|P|N|N|N|N |
| settings.team | F|N|N|N|N|N |
| sensitive.customer_phone | F|F|F|N|N|N |
| sensitive.vendor_bank | F|N|N|F|N|N |
| sensitive.commission | F|N|N|N|N|N |

  role ids: `admin, ops, cs, accounts, vendors_followup, viewer`؛ الأسماء العربية ووصفها من `ROLE_DESC` (block 17).

- [ ] **Step 1: اكتب `supabase/tests/rls_identity.sql`** كسكريبت بيعمل transaction، بينشئ مستخدمين تجريبيين في `auth.users`/`auth.identities` (أدمن، عمليات بتجاوز `custom_perms = {"orders.edit":"F"}`، مشاهد موقوف)، وبعدها لكل حالة `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'` ويؤكد بـ `DO $$ … IF NOT (…) THEN RAISE EXCEPTION 'case X failed'; END IF; $$`:
  - `has_perm('orders.edit')` = `F` للأدمن، `F` للعمليات (التجاوز)، `N` للمشاهد.
  - `has_perm('sensitive.commission')` = `N` للعمليات.
  - `email_for_identifier('01000000002')` (موبايل العمليات) ترجّع إيميله وحالته `active`؛ للمشاهد الموقوف ترجّع `suspended`؛ لرقم مش موجود ترجّع صفر صفوف.
  - المشاهد يقدر يقرا `profiles` صفه بس (count = 1)؛ العمليات لا يقدر يعمل update لـ `role_id` بتاعه (يرمي خطأ).
  - ينتهي بـ `ROLLBACK` و`RAISE NOTICE 'rls_identity: ok'`.

- [ ] **Step 2: طبّق `0001_identity.sql` على المشروع** عبر Supabase MCP `apply_migration` (name: `identity`)، ثم شغّل الاختبار بـ `execute_sql` بمحتوى `rls_identity.sql` → متوقع الفشل الأول لأن seed الأدوار مش موجود (`roles` فاضية).

- [ ] **Step 3: اكتب `0003_seed_roles.sql`** (insert … on conflict do update) بالجدول فوق، وطبّقه بـ `apply_migration` (name: `seed_roles`).

- [ ] **Step 4: شغّل `rls_identity.sql` تاني** → NOTICE `rls_identity: ok`. شغّل كمان MCP `get_advisors` (security) → صفر تحذيرات عن RLS أو دوال `security definer` من غير `search_path` (لو ظهرت، صلّح الدالة بـ `set search_path = public`).

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): identity, data-driven permissions (has_perm) and role seed with RLS tests"
```

---

### Task 4: Supabase — جداول النظام (migration 0002)

**Files:**
- Create: `supabase/migrations/0002_system.sql`, `supabase/tests/rls_system.sql`

**Interfaces:**
- Produces (SQL):
  - `settings(section text pk, data jsonb not null default '{}', updated_at timestamptz, updated_by uuid)` — الأقسام العشرة: `general, team, integrations, makers, notifications, lists, payments, activity, security, data`. قراءة: `has_perm('settings.view') <> 'N'`؛ كتابة: `has_perm('settings.team') = 'F'` للـ `team`/`integrations`/`security`، والأدمن للباقي.
  - `status_map(id serial pk, system_status text not null, woo_status text, direction text check (direction in ('both','from_woo','from_system')) default 'both', sort int)` — seed بالحالات الست من البروتوتايب (`STATUS_ORDER`: `جاري التنفيذ, مكتمل, قيد الشحن, معلّق, ملغي, مرتجع`) و`woo_status` = `processing, completed, shipped, on-hold, cancelled, refunded`.
  - `activity_log(id bigserial pk, at timestamptz default now(), actor uuid references profiles, action text not null, entity text, entity_id text, old_value jsonb, new_value jsonb)` — insert لأي مسجّل (actor = auth.uid() عبر trigger)؛ select لو `has_perm('settings.view') <> 'N'`؛ لا update/delete.
  - `alerts(id bigserial pk, at timestamptz default now(), kind text not null, title text not null, body text, role_id text references roles, user_id uuid references profiles, entity text, entity_id text, read_at timestamptz)` — select للصف اللي `user_id = auth.uid()` أو `role_id` = دور المستخدم؛ update لـ `read_at` بس لنفس الشرط.
  - `notification_prefs(user_id uuid pk references profiles, data jsonb default '{}')` — صاحبها فقط.
  - دالة `public.log_activity(action text, entity text, entity_id text, old_value jsonb, new_value jsonb) returns void` `security invoker` بتعمل insert (الواجهة بتناديها بـ RPC).
- seed `settings.general` من كائن `C.general` في block 17 (company, legal, email, site, address, phone, tz, lang, dateFmt, currency …) كما هو.

- [ ] **Step 1: اكتب `rls_system.sql`** (نفس أسلوب Task 3): المشاهد يقدر يقرا `settings` (`settings.view` = … تحقق من الجدول: المشاهد `N` → صفر صفوف)؛ العمليات يقرا `general` (`P`) ولا يقدر يكتب؛ الأدمن يكتب؛ `log_activity('test', 'x', '1', null, '{"a":1}')` من العمليات بتعمل صف `actor` = هو؛ المشاهد يقدر يشوف تنبيه لدوره ومايشوفش تنبيه لدور تاني.

- [ ] **Step 2: طبّق `0002_system.sql`** بـ `apply_migration` (name: `system`)، شغّل `rls_system.sql` بـ `execute_sql` → NOTICE `rls_system: ok`. `get_advisors` → نظيف.

- [ ] **Step 3: Commit**

```bash
git add supabase
git commit -m "feat(db): settings, status map, activity log and alerts with RLS tests"
```

---

### Task 5: ربط الواجهة — عميل Supabase، تسجيل الدخول الحقيقي، الدليل، سجل النشاط

**Files:**
- Create: `app/config.js`, `app/js/vendor/supabase.js`, `app/js/adapter/supabase-client.js`, `app/js/adapter/auth.js`, `app/js/adapter/directory.js`, `app/js/adapter/activity.js`, `tools/seed-dev-users.sql`, `tests/e2e/auth.spec.mjs`
- Modify: `app/js/blocks/21-shell.js` (دوال `findMember`, `doLogin`, `do2fa`, `doForgot`, `doReset`, `logout`, `enterApp`, وثابت `DEMO_PW`)، `app/js/blocks/14-kit.js` (`ME` سطر 2913 من البروتوتايب و`logEvent` سطر 3021)، `app/js/blocks/28-app.js` (استدعاء `boot()` يستنى `IBDirectory.load()`)
- Modify: `tools/split-prototype.mjs` — **التقسيم بيتولّد مرة واحدة**؛ بعد التعديلات دي الاختبار `join(split) === src` بيتحوّل لاختبار على snapshot: خزّن نسخة الكتل الأصلية في `tools/blocks.lock.json` (hash لكل كتلة) وخلّي الاختبار يؤكد إن **الكتل غير المعدّلة** (كل الكتل ما عدا 14، 21، 28) مطابقة للبروتوتايب بالبايت، وإن الكتل المعدّلة ليها hash مسجّل في اللوك.

**Interfaces:**
- Consumes: `window.IB_CONFIG`, `supabase.createClient` (UMD global `supabase`)، RPCs `email_for_identifier`, `log_activity`، جداول `profiles`, `roles`.
- Produces:
  - `window.IBSupabase = { client }`.
  - `window.IBAuth = { signIn(identifier, password) → Promise<{ ok:true, profile } | { ok:false, reason:'bad'|'suspended'|'locked'|'network' }>, verifyTotp(code) → Promise<{ok}>, needsTotp() → boolean, signOut() → Promise<void>, session() → Session|null, onChange(cb), resetPassword(identifier) → Promise<{ok}>, updatePassword(p1) → Promise<{ok}> }`. `signIn` بتنادي `email_for_identifier` الأول (الهوية بعد `O.toLatin`)، ترجّع `suspended` من غير محاولة دخول لو الحالة كده، وتستخدم `signInWithPassword`.
  - `window.IBDirectory = { load() → Promise<void>, me() → profile, members() → member[] }` — بتحمّل `profiles` + `roles` وتملا `IBKit.store.members` بنفس شكل أعضاء البروتوتايب (`id` = `member_code`، `name, role (الاسم العربي), title, dept, manager (member_code), phone, email, status, twofa`، والحقول الرقمية `salary, holdback, allow, leave, used` = 0 و`shift` = `['09:00','17:00']` لحد مرحلة HR)، وبتضبط `K.ME` = `member_code` بتاع المستخدم الحالي.
  - `window.IBActivity = { log(action, detail) }` → `rpc('log_activity', {...})` fire-and-forget؛ `K.logEvent` بينادي `IBActivity.log` **بالإضافة** لسلوكه الحالي (unshift في `store.activity`).
- مستخدمو dev (في `tools/seed-dev-users.sql`، يتشغّل بـ `execute_sql` مرة واحدة على المشروع، ومايتشغّلش على الإنتاج): أدمن `M01` و عمليات `M02` ومشاهد موقوف `M99`، بإيميلات `*.dev@ibtekr.local` وكلمة سر تجريبية مكتوبة في الملف نفسه (مش في الشات).

- [ ] **Step 1: اكتب `tests/e2e/auth.spec.mjs`** (بيستخدم بيانات `tools/seed-dev-users.sql` عبر متغيرات بيئة `E2E_ADMIN_EMAIL/E2E_ADMIN_PW` …):
  - `signs in and lands on dashboard`: يكتب إيميل الأدمن وكلمة السر → `#root` ظاهر، `nav.sidebar` فيه 10 `.nav-item`، العنوان مش "تسجيل الدخول".
  - `arabic-digit phone identifier works`: يكتب `٠١٠٠٠٠٠٠٠٠٢` + كلمة سر العمليات → يدخل.
  - `suspended account is refused`: المشاهد الموقوف → العنوان "الحساب موقوف"، `#root` مخفي.
  - `wrong password shows remaining attempts`: نص الخطأ يحتوي "فاضل 4 محاولات".
  - `logout returns to login`: من قائمة الحساب → "خروج" → `#login` ظاهر.

- [ ] **Step 2: شغّل `npm run e2e`** → الاختبارات الجديدة FAIL (لسه `DEMO_PW`).

- [ ] **Step 3: ضيف `app/js/vendor/supabase.js`** (نسخة UMD من حزمة `@supabase/supabase-js`، نفس رقم الإصدار يتكتب في `package.json` تحت `dependencies`)، و`app/config.js` بـ URL المشروع ومفتاح `anon` (من MCP `get_project_url` و`get_publishable_keys`).

- [ ] **Step 4: اكتب `supabase-client.js`, `auth.js`, `directory.js`, `activity.js`** بالتواقيع فوق.

- [ ] **Step 5: عدّل `21-shell.js`**: احذف `DEMO_PW`؛ `doLogin` تبقى async وتنادي `IBAuth.signIn` وتحوّل النتيجة لنفس فروع الشاشة الحالية (`suspended` → `ls.view='suspended'`؛ `bad` → `O.loginFail` + نفس رسالة "فاضل N محاولات"؛ `ok` → لو `IBAuth.needsTotp()` → `ls.view='2fa'` وإلا `enterApp()`)؛ `do2fa` → `IBAuth.verifyTotp`؛ `doForgot` → `IBAuth.resetPassword`؛ `doReset` → `IBAuth.updatePassword`؛ `logout` → `IBAuth.signOut()` ثم سلوكه الحالي. المنطق المحلي للقفل (`auth`/`O.isLocked`) **يفضل** زي ما هو.

- [ ] **Step 6: عدّل `14-kit.js`**: `ME` تبقى متغيّر بيتضبط من `IBDirectory` (`K.setMe(code)`)، و`logEvent` تنادي `window.IBActivity && IBActivity.log(action, detail)`.

- [ ] **Step 7: عدّل `28-app.js`**: قبل `boot()`: `await IBDirectory.load()` لو فيه جلسة (`IBAuth.session()`)، وبعد `boot()`: لو مافيش جلسة → `IBShell.showLogin('login')`. وفي `IBAuth.onChange`: عند `SIGNED_OUT` → `IBShell.showLogin('login')`.

- [ ] **Step 8: شغّل `tools/seed-dev-users.sql`** على المشروع (مرة واحدة)، ثم `npm run e2e` → PASS. `npm test` → PASS (اختبار الـ snapshot الجديد).

- [ ] **Step 9: Commit**

```bash
git add app tools tests package.json
git commit -m "feat(auth): real sign-in via Supabase, member directory and activity log behind the existing login screen"
```

---

### Task 6: سياق المستودع — CLAUDE.md وإعدادات الإضافات وCI

**Files:**
- Create: `CLAUDE.md`, `.claude/settings.json`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Produces: أي جلسة Claude Code (محلية/سحابية/على جهاز تاني) تقرا نفس القواعد وتحمّل نفس الإضافات.

- [ ] **Step 1: اكتب `CLAUDE.md`** (عربي، قصير): مرجع الوثيقة والخطط؛ القواعد العشر: (1) الواجهة JavaScript عادي بدون إطار عمل أو build؛ (2) الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة؛ (3) كل كتابة بيانات عبر adapter؛ (4) RLS على كل جدول، `has_perm` للصلاحيات؛ (5) مافيش أسرار في الكود؛ (6) عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب؛ (7) اختبار لكل قاعدة عمل؛ (8) قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية؛ (9) commit لكل مهمة؛ (10) ترتيب البناء = القائمة الجانبية. وأوامر التشغيل: `npm install`, `npm run split`, `npm run serve`, `npm test`, `npm run e2e`.

- [ ] **Step 2: اكتب `.claude/settings.json`** بـ `extraKnownMarketplaces` (`claude-plugins-official`, `trailofbits`) و`enabledPlugins` للإضافات اللي المشروع بيستخدمها: `superpowers, security-guidance, code-review, semgrep, context7, playwright, typescript-lsp, supabase, hostinger, commit-commands` و`differential-review, insecure-defaults, supply-chain-risk-auditor` من trailofbits.

- [ ] **Step 3: اكتب `.github/workflows/ci.yml`**: على push/PR → `npm ci` → `npm test` → `npx playwright install --with-deps chromium` → `npm run e2e` (متغيرات `E2E_*` من GitHub Secrets؛ لو مش موجودة يتخطى الـ e2e بـ `if`).

- [ ] **Step 4: اكتب `README.md`** (10 سطور: إيه المشروع، إزاي يتشغّل محليًا، فين الوثائق).

- [ ] **Step 5: شغّل `npm test` محليًا** → PASS. ادفع الفرع وتأكد إن الـ CI أخضر على GitHub.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md .claude README.md .github
git commit -m "chore: project context for any Claude session, plugin pins and CI"
```

---

### Task 7: أول نشر على subdomain Hostinger

**Files:**
- Create: `tools/deploy.md` (خطوات النشر وما يلزم)، `app/.htaccess` (لو احتاج: `Options -Indexes` + cache headers للـ css/js)

**Interfaces:**
- Consumes: اسم الـ subdomain من صاحب المشروع (بند مفتوح 6 في الوثيقة)، تفويض إضافة Hostinger عبر `/mcp` أو بيانات FTP.
- Produces: التطبيق شغال على `https://<subdomain>.ibtekr.club` بشاشة دخول حقيقية.

- [ ] **Step 1: جهّز إعدادات Auth في Supabase**: Site URL = `https://<subdomain>.ibtekr.club`، وRedirect URLs تشمله وتشمل `http://localhost:4173` (من لوحة Supabase › Authentication › URL Configuration، أو MCP لو متاح).

- [ ] **Step 2: انشر `app/`** بسكيل `hostinger:hosting-deploy-static-site` (أو FTP لو الإضافة مش مفوّضة)، مع `config.js` بمفتاح `anon` بتاع الإنتاج.

- [ ] **Step 3: تحقق**: افتح الرابط → `toHaveTitle('تسجيل الدخول — نظام إبتكر')`؛ سجّل دخول بحساب الأدمن الحقيقي (يتعمل بـ Supabase Auth › Users › Invite لإيميل صاحب المشروع، وصف `profiles` ليه بـ `role_id='admin'`، `member_code='M01'`)؛ `activity_log` فيه صف `auth.signin`.

- [ ] **Step 4: فحص أمني قبل الإعلان**: `/differential-review` على الفرع + semgrep نظيف + `get_advisors` نظيف.

- [ ] **Step 5: Commit وادفع**

```bash
git add tools/deploy.md app/.htaccess
git commit -m "chore: first deploy to the Hostinger subdomain"
git push
```

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (المرحلة 0 بس):** تقسيم الملف ✔ (T1)، Auth والأدوار ✔ (T3, T5)، الصلاحيات بيانات ✔ (T3)، settings/status_map/activity/alerts ✔ (T4)، الجرس: الجدول موجود (T4) والربط بالواجهة في خطة صفحة "لوحة التحكم" (مكتوب في الوثيقة إن اللوحة تكتمل في الآخر)، سياق المستودع ✔ (T6)، أول نشر ✔ (T7). مزامنة Woo والجسر وبقية الصفحات لخطط لاحقة بترتيب القائمة.
- **التواقيع متسقة:** `IBAuth.signIn/verifyTotp/needsTotp/signOut/session/onChange/resetPassword/updatePassword`، `IBDirectory.load/me/members`، `IBActivity.log`، `has_perm`, `email_for_identifier`, `log_activity` مستخدمة بنفس الأسماء في T3/T4/T5.
- **Review Focus:** كل سطر ليه اختبار في المهمة المالكة (T2 للقواعد، T3 للـ SQL، T5 للـ e2e).
