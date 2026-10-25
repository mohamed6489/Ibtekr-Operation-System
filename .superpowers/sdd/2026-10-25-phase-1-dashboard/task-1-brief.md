### Task 1: قاعدة البيانات — `0006_dashboard.sql` + `rls_dashboard.sql`

**Files:**
- Create: `supabase/migrations/0006_dashboard.sql`, `supabase/tests/rls_dashboard.sql`
- Test: `npm run db:test` (Postgres محلي: `DATABASE_URL` الافتراضي `postgresql://postgres@127.0.0.1:54329/postgres`؛ لو السيرفر واقف: `runuser -u pguser -- /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/ibtekr-pgdata -o "-p 54329 -k /tmp" -l /tmp/ibtekr-pg.log start`)

**Interfaces:**
- Consumes: `profiles`, `roles`, `alerts`, `activity_log`, `has_perm(key)`, `log_activity(...)` من 0001/0002؛ أسلوب الاختبار والـ fixtures من `supabase/tests/rls_identity.sql`.
- Produces (SQL):
  - `public.user_prefs(user_id uuid not null references profiles on delete cascade, key text not null check (key ~ '^[a-z][a-z0-9_.-]{0,63}$'), data jsonb not null default '{}', updated_at timestamptz not null default now(), primary key (user_id, key))`. Trigger `user_prefs_stamp` (before insert or update: `new.updated_at := now()`)، تنفيذه ممنوع على `public, anon, authenticated`. RLS: سياسة واحدة `user_prefs_owner for all to authenticated` بـ `using`/`with check`: `user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')`. Grants: `select, insert, update, delete` لـ `authenticated, service_role`.
  - `public.alert_reads(alert_id bigint not null references alerts on delete cascade, user_id uuid not null references profiles on delete cascade, read_at timestamptz not null default now(), primary key (alert_id, user_id))` + index `alert_reads_user_id_idx (user_id)`. RLS: `alert_reads_select for select to authenticated using (user_id = (select auth.uid()))`؛ `alert_reads_insert for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.alerts a where a.id = alert_id))` — الـ `exists` بيتنفذ بسياسة `alerts_select` بتاعة المستخدم نفسه، فالتنبيه اللي مش من حقه يشوفه مايتعلّمش، والموقوف بيتدحرج من نفس السياسة. Grants: `select, insert` لـ `authenticated, service_role` (مافيش update/delete للـ API).
  - `alter policy activity_log_select on public.activity_log using ((actor = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')) or (select public.has_perm('settings.view')) <> 'N')`.
  - `revoke truncate, references, trigger on public.user_prefs, public.alert_reads from anon, authenticated, service_role` (قاعدة 4).
  - Realtime: `do $$ begin if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts') then execute 'alter publication supabase_realtime add table public.alerts'; end if; end $$;` (المنشور مش موجود في الـ stub المحلي فالحارس لازم).
- **قرار:** `alert_reads` هو مخزن حالة القراءة الوحيد لكل التنبيهات (الموجّهة لمستخدم أو لدور)؛ `alerts.read_at` بتفضل موجودة للوظائف الخلفية بس والواجهة ماتكتبش فيها — ليه: مسار واحد للقراءة بدل اتنين؛ تكلفة لو غلط: عمود مهمل.

- [ ] **Step 1: اكتب `supabase/tests/rls_dashboard.sql`** بنفس هيكل `rls_identity.sql` (transaction + `set local role` + `do $$ … raise exception 'case … failed' $$` + `rollback` + `raise notice 'rls_dashboard: ok'`). الـ fixtures: المستخدمين 1 (أدمن)، 2 (عمليات)، 3 (مشاهد موقوف)، 4 (خدمة عملاء) بنفس القيم والإيميلات بتاعة `rls_identity.sql`. بعد الإدراج (كـ postgres): `insert into public.alerts (kind, title, role_id) values ('stock.cons.late', 'تجميع متأخر', 'ops'), ('woo.sync.failed', 'فشل مزامنة WooCommerce', 'cs')` و`insert into public.alerts (kind, title, user_id) values ('system.backup.off', 'النسخ الاحتياطي مقفول', '…0001')`. احفظ الـ ids في متغيرات الجلسة بـ `select set_config('t.a_ops', id::text, true)` … أو استعلم بالعنوان جوّه كل case. الحالات:
  - `user_prefs`: العمليات يدرج `('…0002', 'dashboard', '{"hidden":["team"]}')` → `row_count = 1`؛ يقرا `count(*) from user_prefs` = 1 بعد ما postgres يدرج صف للأدمن (`('…0001','dashboard','{}')`)؛ يحدّث صفه → `row_count = 1` و`updated_at >= now()`؛ يحاول يدرج صف بـ `user_id = '…0001'` → خطأ `42501`؛ المشاهد الموقوف يدرج → `42501`؛ المشاهد الموقوف يقرا → 0 صف.
  - `alert_reads`: العمليات يقرا `alerts` → 1 (تنبيه `ops` بس)؛ يدرج `alert_reads` للتنبيه `ops` → `row_count = 1`؛ يدرج للتنبيه `cs` → `42501`؛ يدرج للتنبيه `ops` بـ `user_id = '…0001'` → `42501`؛ يقرا `alert_reads` → 1؛ الأدمن يقرا `alert_reads` → 0 (صفوف الغير مش ظاهرة)؛ الموقوف يدرج لأي تنبيه → `42501`.
  - `activity_log`: خدمة العملاء يعمل `select public.log_activity('dashboard.customize', null, null, null, '"7 كارت"')` مرتين، والعمليات مرة؛ خدمة العملاء يقرا → `count = 2` وكلها `actor = '…0004'`؛ العمليات (settings.view = P) يقرا → `count >= 3`؛ الأدمن → `count >= 3`؛ postgres يوقف خدمة العملاء (`update profiles set status = 'suspended' where id = '…0004'`) → خدمة العملاء يقرا → 0.

- [ ] **Step 2: شغّل `npm run db:test`** → يفشل عند `rls_dashboard.sql` بـ `relation "public.user_prefs" does not exist`.

- [ ] **Step 3: اكتب `supabase/migrations/0006_dashboard.sql`** بالتعريفات اللي في Interfaces بالترتيب: الجدولين + الفهرس + `enable row level security` + trigger + السياسات + الـ grants/revokes + `alter policy activity_log_select` + حارس Realtime. تعليق في أول الملف بالإنجليزي زي 0001/0002 يشرح الهدف وقرار `alert_reads`.

- [ ] **Step 4: شغّل `npm run db:test`** → `rls_identity: ok`، `rls_system: ok`، `rls_dashboard: ok`، `db-test: all passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): user_prefs, alert_reads, own rows in activity_log and realtime on alerts, with RLS tests"
```

---

