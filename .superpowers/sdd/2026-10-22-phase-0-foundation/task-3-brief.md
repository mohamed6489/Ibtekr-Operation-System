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

