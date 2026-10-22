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

