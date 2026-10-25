# خطة التنفيذ — المرحلة 1: لوحة التحكم

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** لوحة التحكم تشتغل على المستخدم الحقيقي: إطار الدور من الملف الشخصي، تخصيص اللوحة محفوظ في Supabase لكل مستخدم، الجرس وكارت «محتاج منك دلوقتي» بيستقبلوا تنبيهات السيرفر من جدول `alerts` بحالة قراءة لكل مستخدم (`alert_reads`)، كارت «آخر نشاط» من `activity_log`، ومافيش بيانات بتفضل في الذاكرة بعد الخروج. المؤشرات وباقي الكروت تفضل على بيانات البروتوتايب لحد ما صفحاتها تتوصّل (الوثيقة §5: «هيكلها هنا وتكتمل في الآخر»).

**Architecture:** migration واحدة (`0006_dashboard.sql`): جدول `user_prefs` (تفضيلات لكل مستخدم ومفتاح)، جدول `alert_reads` (قراءة التنبيهات لكل مستخدم)، توسيع سياسة قراءة `activity_log` لصفوف المستخدم نفسه، وإضافة `alerts` لمنشور Realtime. على الواجهة: adapters جديدة `IBPrefs` و`IBAlerts` وامتداد `IBActivity`/`IBDirectory`، بتتحمّل بعد الدليل عند الدخول وبتتمسح عند الخروج. تعديلات محدودة ومسمّاة في الكتل 21 و25 و28 (القرار مكتوب في كل مهمة) وبعدها `npm run lock`. الاختبارات: SQL للـ RLS، `node:test` لقواعد الكتلة 24 وللـ adapters، وPlaywright على الـ mock.

**Tech Stack:** JavaScript عادي (ES2020، من غير build)، `@supabase/supabase-js` 2.118 (UMD محلي) بما فيه Realtime، Supabase (Postgres 17، RLS)، Node 22+ (`node --test`)، Playwright 1.64، GitHub Actions، النشر تلقائي من `main` (فرع `deploy` → Hostinger).

**Spec:** `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md` (§4.1 طبقة البيانات، §4.2 القواعد الثابتة، §4.6، §5 الصف 1) + دفتر المرحلة صفر `.superpowers/sdd/2026-10-22-phase-0-foundation/progress.md` (البنود المؤجلة للمرحلة 1: مسح الذاكرة عند الخروج، `alert_reads`، اللوحة على ME/الدور الحقيقي).

## Global Constraints

- الواجهة JavaScript عادي؛ **ممنوع** أي إطار عمل أو build step. (الوثيقة §2)
- **سلوك الصفحات مايتغيرش** إلا بقرار مكتوب هنا. الكتل المسموح تعديلها في المرحلة دي: `21-shell.js`، `25-page-dashboard.js`، `28-app.js` بالتعديلات المسمّاة في المهام 4 و5 فقط. بعد أي تعديل: `npm run lock` وتحديث قائمة `EDITED` في `tests/split.test.mjs`. (CLAUDE.md قاعدة 2)
- أي كتابة بيانات تعدّي على adapter تحت `app/js/adapter/`. (قاعدة 3)
- RLS على كل جدول جديد + `grant` صريح لـ `authenticated`/`service_role` (المشروع الحي مابيمنحش DML تلقائيًا) + `revoke truncate, references, trigger` زي `0004_grants.sql`. الصلاحيات بـ `has_perm`. (قاعدة 4، الوثيقة §4.2)
- مفتاح `anon`/publishable بس في الواجهة. مافيش أسرار في الكود. (§4.6)
- عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب. (قاعدة 6)
- Migrations بتتطبّق على المشروع الحي عبر Supabase MCP بعد المراجعة (المتحكم مش المنفّذ)، وتتكتب من غير `drop`/`delete` (الـ MCP بيحجز أي نص فيه الكلمتين للتأكيد): `alter policy` بدل drop/create، و`where … is not null` بدل delete عاري في الاختبارات. (دفتر المرحلة صفر)
- `IBActivity.LOGGED_PREFIXES` هي اللي بتحدد إيه اللي بيوصل للسيرفر من `K.logEvent`؛ المرحلة دي بتضيف `'dashboard.'` بس. (قرار المرحلة صفر)
- النشر تلقائي: أي push على `main` يلمس `app/` بيوصل للموقع خلال دقيقة. مافيش خطوة رفع يدوية.
- المشروع الحي `fsynculhaupcktzkfkdd` (eu-central-1). الفرع في الجلسات السحابية `main-gha10e` ثم fast-forward لـ `main` (إذن صاحب المشروع موجود).

## Review Focus

1. **عضو بدور مخصص (مش من الستة) يفتح اللوحة** → إطار «مشاهد» من غير كراش، والتخصيص بيتحفظ عادي. اختبار: Task 2 (`roleOf`/`layout` على دور مجهول).
2. **تخصيص محفوظ فيه كارت ماعادش متاح للدور (الدور اتغيّر) أو كارت جديد اتضاف للدور** → الكارت القديم يتجاهل، الجديد يظهر في آخر الترتيب، و«محتاج منك دلوقتي» مايتخفيش حتى لو محفوظ كمخفي. اختبار: Task 2 (`layout`).
3. **تنبيه سيرفر موجّه لدور تاني أو لمستخدم تاني** → مايظهرش، ومحاولة تعليمه كمقروء بتتدحرج من RLS. اختبار: Task 1 (SQL) وTask 5 (e2e: العمليات مايشوفش تنبيه الأدمن).
4. **Realtime مش متاح (ويب سوكت واقع أو معطّل)** → الجرس واللوحة يشتغلوا من آخر تحميل من غير أي خطأ في الصفحة. اختبار: Task 3 (`subscribe` بيرمي → `load` ناجح) وTask 5 (e2e بـ `realtime: false`، `pageErrors` فاضية).
5. **خروج (يدوي أو خمول)** → مافيش أعضاء حقيقيين في الذاكرة ولا طلبات للسيرفر بعد الخروج، وشاشة «الجلسة خلصت» تفضل ظاهرة بعد إعادة التحميل. اختبار: Task 4 (e2e) + اختبارات `auth.spec.mjs` الموجودة تفضل خضرا.

---

## File Structure

```
app/
  index.html                        ← + <script src="js/adapter/prefs.js"> + <script src="js/adapter/alerts.js"> بعد activity.js وقبل الكتل
  js/adapter/prefs.js               ← window.IBPrefs — user_prefs (قراءة عند الدخول، write-through)
  js/adapter/alerts.js              ← window.IBAlerts — alerts + alert_reads + Realtime + قسم الجرس
  js/adapter/activity.js            ← + 'dashboard.' في LOGGED_PREFIXES، + recent()/cached()/refresh()
  js/adapter/directory.js           ← load() يحمّل بعده prefs/alerts/activity؛ + clear()
  js/blocks/21-shell.js             ← signOut(): إعادة تحميل الصفحة بعد الخروج (Task 4)
  js/blocks/25-page-dashboard.js    ← customize → IBPrefs؛ كارت «آخر نشاط» → IBActivity.cached()؛ إعادة رسم على ib:notify (Task 4، 5)
  js/blocks/28-app.js               ← البوابة تقرا sessionStorage['ib.loginView']؛ viewSections تضيف IBAlerts.section() (Task 4، 5)
supabase/
  migrations/0006_dashboard.sql     ← user_prefs, alert_reads, activity_log_select, Realtime على alerts
  tests/rls_dashboard.sql           ← اختبارات RLS للجدولين والسياسة
tests/
  domain/dash-domain.test.mjs       ← قواعد الكتلة 24 (نقية)
  adapter/prefs.test.mjs, adapter/alerts.test.mjs, adapter/activity.test.mjs (امتداد)
  e2e/dashboard.spec.mjs            ← Playwright على الـ mock
  e2e/supabase-mock.mjs             ← + user_prefs, alerts, alert_reads, activity_log (GET)، realtime:false
  split.test.mjs                    ← EDITED تضيف 25-page-dashboard.js
tools/blocks.lock.json (npm run lock) · tools/deploy.md (§3: ترتيب الـ migrations) · CLAUDE.md (ملحوظة الكتل المعدّلة)
```

**مستخدمو الاختبار** (نفس UUIDs المرحلة صفر): `…0001` أدمن M01 نشط · `…0002` عمليات M02 نشط · `…0003` مشاهد موقوف (في SQL) / `twofa.dev` عمليات (في الـ mock) · `…0004` خدمة عملاء نشط (SQL) · `…0099` مشاهد موقوف M99 (mock). في الـ mock `settings.view`: أدمن F، عمليات P، مشاهد N.

---

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

### Task 2: اختبارات قواعد لوحة التحكم (الكتلة 24، نقية)

**Files:**
- Create: `tests/domain/dash-domain.test.mjs`
- Test: `npm test`

**Interfaces:**
- Consumes: `app/js/blocks/24-dash-domain.js` (UMD) عبر `loadUmd(new URL('../../app/js/blocks/24-dash-domain.js', import.meta.url))` من `tests/helpers/load-umd.mjs` → `{ packRows, nextMonthDay, ROLES, CARD, MONEY_KPIS, cardsFor, kpisFor, layout, topNeed, health, greeting, countDelta, countIn, quickActions, roleOf }`.
- الكتلة **ماتتعدلش**؛ لو اختبار كشف اختلاف عن المتوقع هنا، التوقع هو اللي يتعدّل ليطابق الكود ويتسجّل في الدفتر.

- [ ] **Step 1: اكتب الاختبارات** (`test(...)` لكل سطر):
  - `roleOf falls back to viewer for unknown and custom roles`: `roleOf('مراجعة جودة') === 'مشاهد'`، `roleOf(undefined) === 'مشاهد'`، `roleOf('أدمن') === 'أدمن'`.
  - `cardsFor marks need as locked`: `cardsFor('مشاهد')` بترجّع 4 كروت بالـ ids `['kpis','daily','need','activity']`، والكارت `need` بس `locked: true`.
  - `layout keeps the saved order, drops unknown ids, appends new cards, never hides need`: `layout('أدمن', { order: ['team', 'kpis', 'statements'], hidden: ['need', 'team'] })` → الـ ids تبدأ بـ `['team','kpis']` ثم باقي كروت الأدمن بترتيبها الافتراضي، `statements` مش موجود، `team.hidden === true`، `need.hidden === false`، الطول = 10.
  - `layout with no prefs = default order, nothing hidden`: `layout('حسابات', null).map(c => c.id)` = `['kpis','daily','need','expByType','money','statements','activity']` وكل `hidden === false`.
  - `kpisFor per role and MONEY_KPIS`: `kpisFor('عمليات')` = `['open','ready','consLate','returns','late']`؛ `kpisFor('مشاهد')` = `['myTasks','mentions','photo']`؛ `MONEY_KPIS` تحتوي `'sales'` و`'payroll'` ومش `'open'`.
  - `topNeed ranks error < orange < warning < other, skips muted, keeps source order inside a rank`: sections = `[{ label: 'النظام', tabs: [['all','الكل',[{ title:'w1', tone:'warning' }, { title:'e1', tone:'error' }, { title:'m', tone:'error', muted:true }]]] }, { label: 'عملاء', tabs: [['all','الكل',[{ title:'o1', tone:'orange' }, { title:'n1' }, { title:'e2', tone:'error' }]]] }]` → `topNeed(sections, 5).items.map(i => i.title)` = `['e1','e2','o1','w1','n1']`، `total === 5`، و`items[0].section === 'النظام'`؛ `topNeed(sections, 2).items.length === 2` و`total === 5`؛ `topNeed([], 5)` = `{ items: [], total: 0 }`.
  - `health counts open orders by state with shares`: rows = `[{status:'جاري التنفيذ'},{status:'قيد الشحن'},{status:'جاهز للشحن'},{status:'مكتمل'},{status:'معلّق', confirm:'غير مؤكد', delivery:'late'},{status:'ملغي'}]` → `open === 4`؛ `rows` بالترتيب `progress 1`، `shipping 2`، `unconf 1`، `risk 0`، `late 1`؛ `rows[1].pct === 0.5`؛ `health([]).open === 0` و`rows[0].pct === 0`.
  - `greeting switches at noon`: `greeting(11*60+59) === 'صباح الخير'`، `greeting(12*60) === 'مساء الخير'`.
  - `countDelta tone follows the good direction`: `countDelta(5, 3, 'up')` = `{ text: '+2', tone: 'positive' }`؛ `countDelta(3, 5, 'up').tone === 'negative'`؛ `countDelta(3, 5, 'down').tone === 'positive'` و`text === '-2'`؛ `countDelta(4, 4, 'up')` = `{ text: '0', tone: 'neutral' }`.
  - `countIn is inclusive on both ends`: orders بتواريخ `'2026-10-01','2026-10-05','2026-10-06'` و`r = { from: '2026-10-01', to: '2026-10-05' }` → 2.
  - `quickActions per role`: `quickActions('مشاهد').map(a => a.id)` = `['clock','leave','notifs']`؛ `quickActions('حسابات')` تحتوي `'expense'` و`'vendorMove'` ومش `'vendor'`؛ `quickActions('دور مجهول')` = نفس المشاهد.
  - `nextMonthDay: today counts, last day, rollover, clamp`: `nextMonthDay('2026-10-16', [16, 'last']) === '2026-10-16'`؛ `nextMonthDay('2026-10-17', [16, 'last']) === '2026-10-31'`؛ `nextMonthDay('2026-10-31', [16]) === '2026-11-16'`؛ `nextMonthDay('2026-02-10', [30]) === '2026-02-28'`؛ `nextMonthDay('2026-12-20', [5]) === '2027-01-05'`؛ `nextMonthDay('2026-10-01', []) === null`.
  - `packRows fills 12 columns and stretches the last card of each row`: `packRows(['daily','need','weeks','health'])` = `[['daily',4],['need',8],['weeks',7],['health',5]]`؛ `packRows(['weeks','team'])` = `[['weeks',7],['team',5]]` (team من 4 لـ 5)؛ `packRows(['money'])` = `[['money',12]]` (الافتراضي 6 → يتمدد)؛ `packRows([])` = `[]`.

- [ ] **Step 2: شغّل `npm test`** → كل الاختبارات الجديدة PASS (لو واحد فشل: راجع الكود في الكتلة 24 وعدّل التوقع، ماتعدلش الكتلة، واكتب الفرق في تقريرك).

- [ ] **Step 3: Commit**

```bash
git add tests/domain/dash-domain.test.mjs
git commit -m "test(dashboard): rules of the dashboard domain block (layout, ranking, health, packing)"
```

---

### Task 3: الـ adapters — `IBPrefs`، `IBAlerts`، امتداد `IBActivity` و`IBDirectory`

**Files:**
- Create: `app/js/adapter/prefs.js`, `app/js/adapter/alerts.js`, `tests/adapter/prefs.test.mjs`, `tests/adapter/alerts.test.mjs`
- Modify: `app/js/adapter/activity.js`, `app/js/adapter/directory.js`, `app/index.html` (سطر الـ adapters)، `tests/adapter/activity.test.mjs`
- Test: `npm test`

**Interfaces:**
- Consumes: `window.IBSupabase.client` (supabase-js: `from().select().eq().order().limit()`، `upsert(row, { onConflict })`، `insert`, `delete().match()`, `channel().on('postgres_changes', …).subscribe()`, `removeChannel`)، `window.IBAuth.session()` (`session.user.id`)، `window.IBKit` (`store.dashPrefs`, `ME`, `setMe`, `store.members`)، `window.IB_CONFIG.realtime` (اختياري؛ `false` = من غير اشتراك).
- Produces:
  - `window.IBPrefs = { load(): Promise<void>, get(key): object|null, set(key, data): Promise<{ok:boolean}>, remove(key): Promise<{ok:boolean}>, clear(): void }`. `load()` تقرا `user_prefs` (`select key, data` بـ `eq('user_id', uid)`)، تملا الكاش، وتضبط `K.store.dashPrefs[K.ME] = get('dashboard') || {}` (الكتلة 25 بتقرا من `K.store.dashPrefs`). `set` و`remove` بيحدّثوا الكاش و`K.store.dashPrefs[K.ME]` **قبل** الطلب (write-through)، `set` = `upsert({ user_id, key, data }, { onConflict: 'user_id,key' })`، `remove` = `delete().match({ user_id, key })`؛ خطأ شبكة → `{ ok:false }` من غير رمي.
  - `window.IBAlerts = { load(): Promise<void>, list(): Alert[], unread(): number, markRead(id): Promise<{ok}>, markAllRead(): Promise<{ok}>, subscribe(): void, unsubscribe(): void, clear(): void, section(): Section|null, toneOf(kind): 'error'|'warning'|'info', relTime(iso, nowMs): string }`.
    `Alert = { id, at, kind, title, body, entity, entityId, read }` الأحدث أولًا. `load()` = `alerts` (`select id, at, kind, title, body, entity, entity_id` + `order('at', { ascending:false })` + `limit(200)`) و`alert_reads` (`select alert_id` بـ `eq('user_id', uid)`). `markRead(id)`: الكاش أولًا، ثم `insert({ alert_id: id, user_id: uid })`؛ خطأ `23505` (مقروء من جهاز تاني) = نجاح؛ بعدها `document.dispatchEvent(new Event('ib:notify'))`. `subscribe()`: لو `IB_CONFIG.realtime === false` أو مافيش عميل → لا شيء؛ وإلا `channel('alerts').on('postgres_changes', { event:'insert', schema:'public', table:'alerts' }, (p) => …).subscribe()` بيضيف الصف للكاش ويبعت `ib:notify`؛ أي رمي من الاشتراك يتبلع. `toneOf(kind)`: `'error'` لو `/fail|error|down|late|overdue/i`، `'info'` لو `/\.(ok|done|success|info)$/i`، وإلا `'warning'`. `relTime(iso, now)`: `'دلوقتي'` (< دقيقة)، `'منذ N دقيقة'`، `'منذ N ساعة'`، `'أمس'`، `'منذ N أيام'`.
    `section()` → `null` لو `load()` ماتعملتش، وإلا قسم جرس بنفس شكل أقسام الكتلة 28: `{ id: 'server', label: 'النظام', icon: 'bell', unit: 'تنبيه', received: unread(), all: () => markAllRead(), allLabel: 'تعليم الكل كمقروء', empty: 'مفيش تنبيهات من السيستم.', tabs: [['all','الكل', items], ['unread','غير مقروء', items غير المقروءة], ['read','مقروء', items المقروءة]] }` حيث item = `{ key: 'sa:' + id, title, sub: body || '', meta: relTime(at, Date.now()), tone: toneOf(kind), icon: tone === 'error' ? 'alert' : tone === 'info' ? 'check' : 'bell', muted: read, run: () => { markRead(id); if (entity && /^[a-z][a-z0-9-]*(\/[\w-]+)?$/.test(entity)) location.hash = entity; } }`. (المقروء = `muted` عشان `topNeed` والعدّاد يتجاهلوه؛ شارة «للعلم» على المقروء مقبولة.)
    **قرار:** `alerts.entity` في المرحلة دي = hash الوجهة (مثلًا `settings-data`، `tickets/TK-0012`) والمنتجين في المراحل الجاية يكتبوه كده — ليه: أبسط ربط بدون جدول توجيه؛ تكلفة لو غلط: تعديل سطر الـ regex.
  - `window.IBActivity` يزيد: `LOGGED_PREFIXES = ['auth.', 'dashboard.']`؛ `recent(limit = 5): Promise<Row[]>` بـ `select('id, at, action, new_value, actor:profiles(name)')` + `order('at', { ascending:false })` + `limit(limit)` → `Row = { id, at, actor: string ('—' لو مافيش اسم), action, detail: string }` (`detail` = `new_value` لو نص، وإلا `JSON.stringify` أو `''`)؛ `cached(): Row[]|null`؛ `refresh(): Promise<void>` تملا الكاش وتبعت `document.dispatchEvent(new Event('ib:activity'))`؛ `log()` بعد نجاح RPC لحدث مُمرَّر → `refresh()`؛ `clear()`.
  - `window.IBDirectory.load()` في آخرها: `await Promise.allSettled([IBPrefs.load(), IBAlerts.load(), IBActivity.refresh()])` ثم `IBAlerts.subscribe()` (كل واحد لو موجود) — فشلهم مايفشّلش الدخول. `window.IBDirectory.clear()`: يفضّي `K.store.members` (نفس المصفوفة بـ `length = 0`)، `meRow = null`، وينادي `IBPrefs.clear()`, `IBAlerts.unsubscribe()`, `IBAlerts.clear()`, `IBActivity.clear()`. `IBAuth.signOut()` (في `auth.js`) تنادي `IBDirectory.clear()` قبل `auth.signOut` — **قرار:** تحميل بيانات الجلسة ومسحها في مكان واحد (الدليل) — ليه: مسارين بيحمّلوا الدليل (البوابة وتسجيل الدخول) ومسارين بيخرجوا — تكلفة لو غلط: اقتران بسيط بين adapters.
  - `app/index.html`: `<script src="js/adapter/prefs.js"></script><script src="js/adapter/alerts.js"></script>` بعد `activity.js` مباشرة.

- [ ] **Step 1: اكتب `tests/adapter/prefs.test.mjs` و`tests/adapter/alerts.test.mjs`** بنفس أسلوب `activity.test.mjs` (`runInNewContext(src, { window, document })` مع عميل stub بيسجّل النداءات وبيرجّع نتائج محددة؛ `document` = `{ dispatchEvent(e) { events.push(e.type); } }`؛ `window.IBKit = { ME: 'M02', store: { dashPrefs: {}, members: [] }, setMe(){} }`؛ `window.IBAuth = { session: () => ({ user: { id: 'u2' } }) }`). الـ stub: دالة `table(name)` بترجّع كائن chainable (`select/eq/order/limit/upsert/insert/delete/match` بترجّع نفسه، و`then` بترجّع `{ data, error }` حسب `responses[name]`)، و`channel()` بترجّع `{ on(){ return this; }, subscribe(){ return this; } }` أو بيرمي حسب الحالة. الحالات:
  - prefs: `load fills the cache and K.store.dashPrefs[ME]` (ردّ `[{ key:'dashboard', data:{ hidden:['team'] } }]` → `get('dashboard')` يساوي الكائن و`K.store.dashPrefs.M02.hidden` = `['team']`)؛ `set writes through before the request resolves` (`set('dashboard', {order:['kpis']})` → قبل الـ await: `get` بترجّع الجديد و`calls` فيها `upsert` بـ `{ user_id:'u2', key:'dashboard', data:{order:['kpis']} }` و`onConflict: 'user_id,key'`)؛ `remove deletes by user and key` (`delete` ثم `match({ user_id:'u2', key:'dashboard' })` و`get` → `null`)؛ `network error → { ok:false } and no throw` (ردّ `error: { message:'x' }`)؛ `clear empties the cache`.
  - alerts: `load merges reads` (`alerts` → صفين `{ id:2, at:'2026-10-25T09:00:00Z', kind:'woo.sync.failed', title:'فشل المزامنة', body:null, entity:'settings-integrations', entity_id:null }`, `{ id:1, …kind:'system.backup.off' }`؛ `alert_reads` → `[{ alert_id:1 }]` → `list()[0].id === 2`, `list()[1].read === true`, `unread() === 1`)؛ `markRead inserts and updates the cache first` (`calls` فيها `insert` بـ `{ alert_id:2, user_id:'u2' }`، `unread() === 0`، `events` تحتوي `'ib:notify'`)؛ `duplicate read (23505) is ok` (`error: { code:'23505' }` → `{ ok:true }`)؛ `section: unread counted, read muted, error ranks first` (`section().received === 1`، `tabs[0][2][1].muted === true`، `tabs[0][2][0].tone === 'error'`, `tabs[0][2][0].icon === 'alert'`)؛ `run marks read and navigates to the entity hash` (`window.location = { hash:'' }` → بعد `run()`: `location.hash === 'settings-integrations'`)؛ `toneOf` (`'woo.sync.failed'→'error'`, `'vendor.late'→'error'`, `'backup.ok'→'info'`, `'system.backup.off'→'warning'`)؛ `relTime` (`relTime(now-30s, now) === 'دلوقتي'`, `… 5 دقايق → 'منذ 5 دقيقة'`, `… 3 ساعات → 'منذ 3 ساعة'`, `… 30 ساعة → 'أمس'`, `… 4 أيام → 'منذ 4 أيام'`)؛ `subscribe swallows a throwing channel and load still works` (`channel` بيرمي → `subscribe()` مايرميش، `load()` بيكمّل)؛ `realtime:false → no channel call` (`window.IB_CONFIG = { realtime:false }` → `calls` مافيهاش `channel`)؛ `section() is null before load`.
  - activity (امتداد الملف الموجود): `dashboard.customize is sent` (`log('dashboard.customize', '7 كارت')` → نداء RPC)؛ `recent maps the embed and refresh dispatches ib:activity` (ردّ `[{ id:9, at:'…', action:'auth.signin', new_value:'محمد', actor:{ name:'محمد' } }, { id:8, …, actor:null }]` → `cached()[0].actor === 'محمد'`، `cached()[1].actor === '—'`، `events` تحتوي `'ib:activity'`)؛ الاختبارات القديمة تفضل PASS.

- [ ] **Step 2: شغّل `npm test`** → الاختبارات الجديدة FAIL (`IBPrefs is not defined` / ملف مش موجود).

- [ ] **Step 3: اكتب `prefs.js` و`alerts.js`، وعدّل `activity.js` و`directory.js` و`auth.js` (نداء `IBDirectory.clear()` في `signOut`) و`index.html`** بالتواقيع فوق. تعليق رأس كل ملف بالإنجليزي زي باقي الـ adapters.

- [ ] **Step 4: شغّل `npm test`** → PASS. شغّل `npm run e2e` → الاختبارات الموجودة لسه PASS (الـ mock بيرجّع 404 لجداول مش معمولة لها mock → `mock.unhandled` **هيفشل** `auth.spec.mjs`؛ لو حصل، ضيف في `supabase-mock.mjs` ردود فاضية `[]` لـ `GET /rest/v1/user_prefs`، `GET /rest/v1/alerts`، `GET /rest/v1/alert_reads`، `GET /rest/v1/activity_log` واحقن `realtime: false` في `IB_CONFIG` بتاع الـ mock — المحاكاة الكاملة في Task 4/5).

- [ ] **Step 5: Commit**

```bash
git add app/js/adapter app/index.html tests/adapter tests/e2e/supabase-mock.mjs
git commit -m "feat(adapters): user prefs, server alerts with per-user reads and realtime, recent activity; session data cleared on sign-out"
```

---

### Task 4: ربط اللوحة (أ) — التخصيص المحفوظ، كارت «آخر نشاط»، مسح الذاكرة عند الخروج + e2e

**Files:**
- Modify: `app/js/blocks/25-page-dashboard.js` (`customize`, `activity`, مستمع `ib:activity`)، `app/js/blocks/21-shell.js` (`signOut`)، `app/js/blocks/28-app.js` (بوابة الجلسة: `ib.loginView`)، `tests/split.test.mjs` (`EDITED`)، `tools/blocks.lock.json` (`npm run lock`)
- Create: `tests/e2e/dashboard.spec.mjs`
- Modify: `tests/e2e/supabase-mock.mjs` (`user_prefs`, `activity_log`)
- Test: `npm test`, `npm run e2e`

**Interfaces:**
- Consumes: `IBPrefs.set/remove`, `IBActivity.cached()`, `IBDirectory.clear()` (Task 3)؛ `K.store.dashPrefs`, `K.logEvent`, `K.member`, `K.ME`؛ `IBShell.showLogin(view)`.
- Produces: سلوك اللوحة على المستخدم الحقيقي:
  - **قرار (الكتلة 25 — التخصيص):** `customize()` → في `submit` بعد ما يكتب `K.store.dashPrefs[owner]`: `window.IBPrefs && IBPrefs.set('dashboard', K.store.dashPrefs[owner]).then((r) => { if (!r.ok) K.toast('اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر', 'error'); })`؛ في «رجوع للافتراضي» بعد `delete`: `IBPrefs.remove('dashboard')` بنفس المعاملة. «عرض كـ» عضو تاني بيعرض إطار دوره بالترتيب الافتراضي (تفضيلاته خاصة بيه: RLS) — ليه: الوثيقة والبروتوتايب «التخصيص بيتحفظ ليك انت بس» — تكلفة لو غلط: الأدمن مايشوفش ترتيب العضو الشخصي.
  - **قرار (الكتلة 25 — آخر نشاط):** `activity()` لو `window.IBActivity && IBActivity.cached()` مش `null` → القائمة = صفوف السيرفر بس (أول 5)، `who = r.actor`، `what = (ACT[r.action] || r.action) + (r.detail ? ' — ' + r.detail : '')`، `at = fmtAt(r.at)` حيث `fmtAt` دالة محلية: نفس اليوم → `'اليوم HH:MM'`، إمبارح → `'أمس HH:MM'`، وإلا `'DD/MM HH:MM'` (بالتوقيت المحلي). `ACT` تزيد: `'auth.signin': 'سجّل دخول'`, `'auth.signout': 'سجّل خروج'`, `'auth.2fa': 'تحقق بخطوتين'`, `'auth.password.set': 'غيّر كلمة المرور'`, `'auth.signoutAll': 'خروج من كل الأجهزة'`. العنوان الفرعي زي ما هو (الأدمن «آخر 5 حركات في السيستم»، غيره «آخر 5 حاجات عملتها» — RLS بتضمن ده). لو `cached()` = `null` (مافيش عميل) → السلوك القديم. مستمع: `document.addEventListener('ib:activity', render)`. ليه: الكارت كان بيعرض بيانات تجريبية وأحداث الجلسة بس — تكلفة لو غلط: أحداث الصفحات التجريبية (مهام) ماتظهرش في الكارت لحد ما صفحاتها تتوصّل.
  - **قرار (الكتلة 21 — الخروج):** `signOut(reason)` بعد `await window.IBAuth.signOut('local')`: `try { sessionStorage.setItem('ib.loginView', reason === 'idle' ? 'expired' : 'login'); } catch (e) {}` ثم `location.reload()`. إعادة التحميل هي الضمان الوحيد إن كل المخازن في الذاكرة (الدليل، المخازن التجريبية المعدّلة، المحادثات) بتتمسح. مسار إعادة تعيين كلمة المرور مايتغيرش (الدليل مابيتحملش في جلسة الاستعادة). ليه: بند المرحلة صفر «مسح المخازن عند الخروج» — تكلفة لو غلط: وميض إعادة تحميل بعد الخروج.
  - **قرار (الكتلة 28 — البوابة):** قبل حساب `view`: `const stored = (() => { try { const v = sessionStorage.getItem('ib.loginView'); sessionStorage.removeItem('ib.loginView'); return v; } catch (e) { return null; } })();` ولو `!A.session() && stored === 'expired'` → `view = 'expired'` (بدل `'login'`). كل باقي البوابة زي ما هي.
  - `tests/split.test.mjs`: `EDITED = ['14-kit.js', '21-shell.js', '25-page-dashboard.js', '28-app.js']` ونص الاختبار يقول «14, 21, 25 and 28».
  - الـ mock (`supabase-mock.mjs`): `mock.prefs = []`، `mock.activityRows` (كل نداء `log_activity` بيضيف `{ id, at: new Date().toISOString(), actor: u.id, action, new_value }` بجانب `mock.activity` الموجود). المسارات: `GET /rest/v1/user_prefs` → صفوف `mock.prefs` بتاعة `u.id` (RLS)؛ `POST /rest/v1/user_prefs` → لو `body.user_id !== u.id` أو `u.status !== 'active'` → `401 {code:'42501'}`، وإلا upsert على `(user_id,key)` → `201 []`؛ `DELETE /rest/v1/user_prefs?user_id=eq.…&key=eq.…` → يحذف صفوف `u.id` بالمفتاح → `204`؛ `GET /rest/v1/activity_log` → `mock.activityRows` (كلها لو `settings.view !== 'N'`، وإلا صفوف `actor === u.id`)، مرتبة تنازليًا بـ `at`، بحد `limit`، وكل صف فيه `actor: { name }` من `USERS`؛ `IB_CONFIG` بتاع الـ mock يزيد `realtime: false`. أي GET للجداول `alerts`/`alert_reads` → `[]` لحد Task 5.

- [ ] **Step 1: اكتب `tests/e2e/dashboard.spec.mjs`** (نفس `beforeEach`/`afterEach`/`signIn` بتوع `auth.spec.mjs`؛ الاختبارات اللي بتعتمد على بيانات الـ mock تتعلّم `mockOnly()`):
  - `dashboard greets the signed-in admin with the admin frame`: دخول الأدمن → `h1` = `'لوحة التحكم'`؛ `.dash-hi` تحتوي `'يا صفوت'`؛ `.dash-kpis .kpi` (أو العنصر اللي `U.KpiTile` بيرجّعه — اتأكد من الكلاس في `10-ui-kit.js`) عدده 5؛ `[data-card="money"]` موجود؛ `#dash-viewas` موجود.
  - `ops gets the ops frame: no money, no view-as`: دخول `ops.dev@ibtekr.local` → `[data-card="money"]` عدده 0؛ `#dash-viewas` عدده 0؛ نص المؤشرات يحتوي `'جاهز / قيد الشحن'`.
  - `customization is saved to the server and survives a reload` (`mockOnly`): الأدمن → زر `'تخصيص اللوحة'` → في الـ dialog: المفتاح `getByLabel('الفريق دلوقتي')` → اضغط → `'حفظ'` → `[data-card="team"]` عدده 0 → `expect.poll(() => mock.prefs)` يساوي `[{ user_id: ADMIN_ID, key: 'dashboard', data: { order: [...10 ids], hidden: ['team'] } }]` (قارن `hidden` و`order.length === 10`)؛ `page.reload()` → `#root` ظاهر و`[data-card="team"]` لسه 0؛ `'تخصيص اللوحة'` → `'رجوع للافتراضي'` → `[data-card="team"]` عدده 1 و`mock.prefs` = `[]`؛ `mock.activity.map(a => a.action)` تحتوي `'dashboard.customize'`.
  - `the activity card shows server rows with Arabic labels` (`mockOnly`): الأدمن → `[data-card="activity"]` يحتوي `'سجّل دخول'` و`'صفوت كمال'`.
  - `sign-out leaves no member data in memory and keeps the expired message` (`mockOnly`): `page.clock.install()` → دخول الأدمن → `page.evaluate(() => IBKit.store.members.some(m => /\.dev@ibtekr\.local$/.test(m.email)))` = `true` → خروج من قائمة الحساب → `#login` ظاهر → `expect.poll(() => page.evaluate(() => window.IBKit.store.members.some(m => /\.dev@ibtekr\.local$/.test(m.email))))` = `false` → `mock.afterLogout === 0` بعد `page.clock.runFor('00:30')`. اختبار تاني: دخول → `page.clock.fastForward('08:00:30')` → `#lg-title` = `'الجلسة خلصت'` ويفضل كده بعد `expect.poll` لمدة ثانية (إعادة التحميل حصلت والنص ثابت).

- [ ] **Step 2: شغّل `npm run e2e -- tests/e2e/dashboard.spec.mjs`** → FAIL (التخصيص مابيتحفظش، الكارت بيعرض بيانات تجريبية، الأعضاء لسه في الذاكرة).

- [ ] **Step 3: عدّل الكتل 25 و21 و28 بالقرارات فوق، ووسّع الـ mock، وحدّث `EDITED`، وشغّل `npm run lock`.**

- [ ] **Step 4: شغّل `npm test` و`npm run e2e`** → كله PASS، بما فيه `auth.spec.mjs` (الخروج، الخمول، التبويبين). لو اختبار قديم في `auth.spec.mjs` اتأثر بإعادة التحميل، عدّله بأقل تغيير يحافظ على نفس التأكيد (مثلًا `expect.poll` بدل `expect` الفوري) واكتب ده في تقريرك.

- [ ] **Step 5: Commit**

```bash
git add app tests tools/blocks.lock.json
git commit -m "feat(dashboard): customization saved per user, activity card from the server log, full wipe on sign-out"
```

---

### Task 5: ربط اللوحة (ب) — تنبيهات السيرفر في الجرس وكارت «محتاج منك دلوقتي» + e2e

**Files:**
- Modify: `app/js/blocks/28-app.js` (`viewSections`)، `app/js/blocks/25-page-dashboard.js` (مستمع `ib:notify`)، `tools/blocks.lock.json` (`npm run lock`)
- Modify: `tests/e2e/dashboard.spec.mjs`, `tests/e2e/supabase-mock.mjs` (`alerts`, `alert_reads`)
- Test: `npm run e2e`

**Interfaces:**
- Consumes: `IBAlerts.section()/markRead/unread` (Task 3)؛ `viewSections(noDigest)`, `ntfState.viewer`, `digestSection` في الكتلة 28؛ `DD.topNeed` في الكتلة 25 (بيقرا `S.sections = NR().viewSections(true)`).
- Produces:
  - **قرار (الكتلة 28):** في `viewSections(noDigest)` بعد فلترة الأدوار وقبل `digestSection`: `if (window.IBAlerts && (ntfState.viewer || window.IBKit.ME) === window.IBKit.ME) { const s = IBAlerts.section(); if (s) secs = [s].concat(secs); }`. القسم أول قسم في القائمة (تنبيهات السيرفر RLS فلترها خلاص؛ مصفوفة الأدوار المحلية مابتنطبقش عليها)؛ «عرض تنبيهات» عضو تاني مايشملش تنبيهات السيرفر (مش مقروءة بصلاحياته). ليه: وعد خطة المرحلة صفر «الجرس يتربط في خطة اللوحة» — تكلفة لو غلط: قسم زيادة في الجرس.
  - **قرار (الكتلة 25):** `document.addEventListener('ib:notify', () => render())` بجانب مستمع `ib:activity` (`render` بيرسم بس لو الصفحة الحالية هي اللوحة) — عشان تنبيه Realtime جديد يظهر في «محتاج منك دلوقتي» فورًا.
  - الـ mock: `mock.alerts = [...]` و`mock.alertReads = []`. مبدئيًا صفين: `{ id: 1, at: T0, kind: 'woo.sync.failed', title: 'فشل مزامنة WooCommerce', body: 'آخر محاولة 09:00', role_id: 'admin', user_id: null, entity: 'settings-integrations', entity_id: null }` و`{ id: 2, at: T0, kind: 'stock.cons.late', title: 'تجميع متأخر IB-1042', body: null, role_id: null, user_id: '…0002', entity: 'inventory-consolidate', entity_id: null }`. `GET /rest/v1/alerts` → صفوف `user_id === u.id || role_id === u.role_id` لو `u.status === 'active'`، وإلا `[]`؛ `GET /rest/v1/alert_reads` → صفوف `mock.alertReads` بتاعة `u.id` (`{ alert_id }`)؛ `POST /rest/v1/alert_reads` → `body.user_id !== u.id` أو التنبيه مش ظاهر ليه → `401 {code:'42501'}`؛ مكرر → `409 {code:'23505'}`؛ وإلا push → `201 []`.

- [ ] **Step 1: ضيف في `tests/e2e/dashboard.spec.mjs`** (`mockOnly` كلها):
  - `a role alert from the server reaches the bell and the need card`: الأدمن → `.notif-badge` نصها `'1'`؛ `[data-card="need"]` يحتوي `'فشل مزامنة WooCommerce'`؛ اضغط `.notif-btn` → في الـ dialog زر القسم `'النظام'` بعدّاد `1` → اضغط عليه → العنصر `'فشل مزامنة WooCommerce'` → اضغط → `expect.poll(() => mock.alertReads)` = `[{ alert_id: 1, user_id: ADMIN_ID }]`؛ `location.hash` بعدها `'#settings-integrations'`؛ `.notif-badge` مخفية؛ `page.goto('/#dashboard')` ← `[data-card="need"]` مايحتويش العنوان؛ `page.reload()` → `.notif-badge` لسه مخفية.
  - `ops sees only alerts addressed to them`: `ops.dev` → الجرس → قسم `'النظام'` عدّاده `1`؛ العنصر `'تجميع متأخر IB-1042'` موجود و`'فشل مزامنة WooCommerce'` مش موجود.
  - `mark all read from the section header`: الأدمن → الجرس → `'النظام'` → زر `'تعليم الكل كمقروء'` → `mock.alertReads.length === 1` و`.notif-badge` مخفية.
  - `no page errors with realtime disabled`: يتحقق ضمنيًا من `afterEach` (`pageErrors` و`mock.unhandled` فاضيين) في كل الاختبارات.

- [ ] **Step 2: شغّل `npm run e2e -- tests/e2e/dashboard.spec.mjs`** → الاختبارات الجديدة FAIL (القسم مش موجود في الجرس).

- [ ] **Step 3: عدّل الكتلتين 28 و25 بالقرارات فوق، ووسّع الـ mock، وشغّل `npm run lock`.**

- [ ] **Step 4: شغّل `npm test` و`npm run e2e`** → PASS كله.

- [ ] **Step 5: Commit**

```bash
git add app tests tools/blocks.lock.json
git commit -m "feat(dashboard): server alerts in the bell and the need card with per-user read state"
```

---

### Task 6: التوثيق + التطبيق الحي + التحقق من النشر

**Files:**
- Modify: `CLAUDE.md` (قاعدة 2: الكتل المعدّلة لحد دلوقتي 14، 21، 25، 28؛ قاعدة 4: مثال `0006`؛ سطر عن `LOGGED_PREFIXES`)، `tools/deploy.md` (§3 ترتيب الـ migrations يزيد `dashboard`؛ ملحوظة Realtime على `alerts`)، `README.md` (سطر: اللوحة على بيانات حقيقية جزئيًا)
- المتحكم (مش المنفّذ) بعد مراجعة المهام 1–5: تطبيق `0006_dashboard.sql` على المشروع الحي عبر Supabase MCP (`apply_migration` باسم `dashboard`)، تشغيل نسخة من `rls_dashboard.sql` بـ `execute_sql` (من غير `delete`)، `get_advisors` (security + performance)، ثم `git push origin main-gha10e && git push origin main-gha10e:main` → النشر التلقائي → التحقق من وصول `js/adapter/prefs.js` للسيرفر بـ `hosting_files_website-content`.

**Interfaces:**
- Consumes: كل اللي فوق.
- Produces: المستودع يوصف الحالة الجديدة؛ المشروع الحي عليه الـ migration؛ الموقع على آخر نسخة.

- [ ] **Step 1: عدّل `CLAUDE.md` و`tools/deploy.md` و`README.md`** بالنقاط فوق (عربي، قصير).

- [ ] **Step 2: شغّل `npm test && npm run e2e && npm run db:test`** → كله PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md tools/deploy.md README.md
git commit -m "docs: phase 1 dashboard — edited blocks, migration order, realtime note"
```

- [ ] **Step 4 (المتحكم): التطبيق الحي والنشر** زي ما هو موصوف في Files، وتسجيل النتيجة في الدفتر `.superpowers/sdd/2026-10-25-phase-1-dashboard/progress.md`.

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (§5 الصف 1 + بنود المرحلة صفر):** إطارات لكل دور على الدور الحقيقي ✔ (Task 2 اختبارات + Task 4 e2e)، المؤشرات = هيكل على بيانات البروتوتايب لحد صفحاتها (قرار الوثيقة «تكتمل في الآخر») ✔، تخصيص اللوحة محفوظ ✔ (Task 1، 3، 4)، الجرس على `alerts` + `alert_reads` ✔ (Task 1، 3، 5)، مسح المخازن عند الخروج ✔ (Task 3، 4)، `activity_log` للمستخدم نفسه ✔ (Task 1، 4)، Realtime ✔ (Task 1، 3). مزامنة Woo والصفحات التانية لخططها.
- **التواقيع متسقة:** `IBPrefs.load/get/set/remove/clear`، `IBAlerts.load/list/unread/markRead/markAllRead/subscribe/unsubscribe/clear/section/toneOf/relTime`، `IBActivity.recent/cached/refresh/clear/LOGGED_PREFIXES`، `IBDirectory.clear` مستخدمة بنفس الأسماء في 3/4/5؛ أسماء الجداول والأعمدة (`user_prefs.key/data`، `alert_reads.alert_id/user_id`) واحدة في 1/3/4/5 والـ mock.
- **Review Focus:** 1–2 في Task 2، 3 في Task 1 و5، 4 في Task 3 و5، 5 في Task 4.
- **النسبة:** الخطة أقصر من الكود اللي هتنتجه؛ الأجسام الوحيدة المكتوبة هي النصوص العربية الثابتة وتعبيرات السياسات.
