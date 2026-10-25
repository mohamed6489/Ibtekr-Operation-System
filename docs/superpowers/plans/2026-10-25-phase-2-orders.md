# خطة التنفيذ — المرحلة 2: الأوردرات (مزامنة WooCommerce + Dokan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** الأوردرات تنزل من WooCommerce لوحدها (webhooks + مزامنة احتياطية) من 1 أكتوبر 2026، بأوردراتها الفرعية (Dokan) ومنتجاتها ومبتكرينها، وصفحة الأوردرات الموجودة تشتغل عليها بنفس شكلها: حالات الأوردر بتتبعت للموقع حسب خريطة الحالات، وحالات الفرعيين (تأكيد، وصل المخزن، شحن، مرتجع) تعيش عندنا بس. معاها الأمان اللي لازم يسبق بيانات العملاء الحقيقية: تهريب النصوص في صفحة الأوردرات، تفعيل التحقق بخطوتين بتطبيق Authenticator مع إلزامه على مستوى قاعدة البيانات، مكتبات التصدير محليًا بدل CDN، وsemgrep في CI.

**Architecture:** Postgres هو المرجع: جداول `vendors` (مرآة متاجر Dokan، الحد الأدنى)، `products`، `orders`، `order_items` (السطر = «الفرعي» اللي الشاشة بتتعامل معاه، بحالته التشغيلية)، `sub_orders` (أوردر Dokan الفرعي لكل مبتكر: المالية ومرآة Woo)، `order_events`، `returns`، `woo_webhook_events`، `woo_sync_log`، `sync_state`. Edge Functions بـ Deno: `woo-webhook` (استقبال + تحقق التوقيع + idempotency) و`woo-sync` (سحب احتياطي، سحب المتاجر والمنتجات، دفع حالة للموقع، تسجيل الـ webhooks)، ومنطقهما النقي في `supabase/functions/_shared/woo-core.js` (JavaScript عادي يتختبر بـ `node:test`). pg_cron + pg_net بينادوا `woo-sync` كل 15 دقيقة بسر محفوظ في Vault. على الواجهة adapter `IBOrders` بيحمّل آخر 12 شهر ويحقن `OrdersApp` (الكتلة 29) بنفس شكل بياناته ويستقبل Realtime، وكل تعديل من الشاشة بيكتب في Postgres (RLS + triggers حارسة) ثم يدفع الحالة للموقع لو الاتجاه بيسمح. الكتلة 29 بتتعدّل بقرار مكتوب: مصدر البيانات، نقاط الكتابة، وتهريب النصوص؛ البذور بتتشال.

**Tech Stack:** JavaScript عادي (بدون build)، supabase-js 2.118 (UMD) + Realtime + `functions.invoke`، Supabase (Postgres 17: RLS، pg_cron، pg_net، Vault؛ Auth MFA TOTP؛ Edge Functions على Deno 2)، WooCommerce REST v3 + Dokan REST v1 (Dokan Lite 5.1.2 / Pro 5.0.9، كودهم اتقرا)، Node 22 (`node --test`)، Playwright 1.64، GitHub Actions، النشر تلقائي.

**Spec:** `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md` (§4.1، §4.2 الجداول والقواعد الثابتة، §4.3 المزامنة، §4.6، §4.7، §5 الصف 2) + البنود المحمولة من دفتري المرحلة صفر والمرحلة 1 (`.superpowers/sdd/*/progress.md`): تهريب innerHTML في الكتلة 29، vendoring لـ xlsx/html2canvas والرجوع لـ `script-src 'self'`، تفعيل TOTP قبل بيانات الأوردرات الحقيقية مع تطبيق aal2 على السيرفر، semgrep في CI، تحديث كارت النشاط من السيرفر كل 5 دقايق، المنتجون يكتبوا `alerts.entity` كـ hash.

## Global Constraints

- الواجهة JavaScript عادي؛ ممنوع إطار عمل أو build. (§2)
- الكتل المسموح تعديلها في المرحلة دي، بالقرارات المسمّاة في مهامها فقط: `29-orders-app.js` (مصدر البيانات، نقاط الكتابة، التهريب، إزالة البذور)، `11-seed-product-images.js` (يفضى)، `18-page-profile.js` (التحقق بخطوتين)، `10-ui-kit.js` و`17-page-settings.js` و`28-app.js` (روابط المكتبات فقط)، `25-page-dashboard.js` (تحديث النشاط من السيرفر في المؤقّت). بعد أي تعديل: `npm run lock` وتحديث `EDITED` في `tests/split.test.mjs`. (قاعدة 2)
- أي كتابة بيانات من الواجهة تعدّي على adapter تحت `app/js/adapter/`. (قاعدة 3)
- RLS على كل جدول جديد + `grant` صريح لـ `authenticated`/`service_role` + `revoke truncate, references, trigger`؛ الصلاحيات بـ `has_perm` بالمفاتيح `orders.view`، `orders.status`، `orders.edit`، `orders.export`، `vendors.view`، `vendors.edit`، `sensitive.customer_phone`. (قاعدة 4، §4.2)
- مافيش أسرار في الكود ولا في الشات: مفاتيح WooCommerce وسر الـ webhook بيدخلها صاحب المشروع في لوحة Supabase (Edge Function secrets) عبر نداء `create_edge_function_secret` اللي بيطلبها منه مباشرة؛ سر المزامنة الداخلي بيتولّد جوه Postgres ويتحفظ في Vault ولا بيخرج منه. الواجهة فيها مفتاح publishable بس. (§4.6)
- عربي RTL ولهجة مصرية في نصوص الواجهة. (قاعدة 6)
- كل قاعدة عمل ليها اختبار؛ Edge Functions: المنطق النقي بـ `node:test`، ونقاط الدخول Deno بـ `deno check` + `deno test`. (قاعدة 7، §4.7)
- Migrations من غير `drop`/`delete` statements (اختبارات SQL بـ `where … is not null`)؛ التطبيق الحي عبر Supabase MCP بعد المراجعة (المتحكم). (دفتر المرحلة صفر)
- `IBActivity.LOGGED_PREFIXES` تزيد `order.` و`suborder.` و`profile.2fa.` (وبس).
- Dokan **قراءة بس**: النظام لا يكتب أبدًا في حالة أوردر فرعي على Woo، ولا في بيانات متجر. اللي بيتكتب في Woo حاجة واحدة: حالة الأوردر الأصلي حسب `status_map` واتجاهها. (§4.3، قرار صاحب المشروع)
- التاريخ: الأوردرات اللي `date_created >= 2026-10-01` فقط. (§4.3)
- النشر تلقائي من `main`؛ الفرع `main-gha10e` ثم fast-forward لـ `main`.
- المشروع الحي `fsynculhaupcktzkfkdd`؛ الـ staging `https://stage.ibtekr.club` (نسخة من الموقع الحقيقي؛ إضافة الواتساب متقفلة عليه بتأكيد صاحب المشروع).

## Review Focus

1. **Webhook من Woo بتوقيع غلط أو بدون توقيع، أو نفس الـ delivery مرتين** → يترفض بـ 401 / يتسجّل كمكرر بـ 200 ولا يكتب حاجة. اختبار: Task 3 (`verifySignature`)، Task 4 (`deno test` للـ handler)، Task 2 (unique على `delivery_id`).
2. **أوردر Woo بحالة مش في الخريطة (مثلًا `failed` أو حالة مخصصة جديدة)** → الأوردر يتسجّل بـ `woo_status` الخام وحالة النظام الافتراضية/الحالية من غير كراش، ويتسجّل `conflict` في `woo_sync_log`. اختبار: Task 3 (`applyIncomingStatus`).
3. **عضو بـ `orders.status = 'N'` يحاول يغيّر حالة من الشاشة** → السيرفر يرفض بـ 42501، الشاشة ترجّع الحالة القديمة وتعرض «مش من صلاحياتك»، ومافيش دفع للموقع. اختبار: Task 2 (SQL)، Task 6 (e2e).
4. **اسم عميل أو ملاحظة فيها HTML/سكريبت جاية من الموقع** → تظهر كنص حرفي في كارت الأوردر والتفاصيل والبحث، ومافيش تنفيذ. اختبار: Task 6 (e2e بقيمة `<img src=x onerror=…>`).
5. **عضو عنده `twofa = true` يدخل بجلسة aal1 (مثلًا بتوكن قديم أو مسار الاستعادة)** → `has_perm` ترجع `N` لكل حاجة لحد ما يعمل التحقق. اختبار: Task 7 (SQL بـ claims فيها `aal`).

---

## File Structure

```
.github/workflows/
  staging-probe.yml                 ← يدوي: يطبع شكل بيانات الـ staging (PII مطموس) من الأسرار STAGING_WOO_*
  ci.yml                            ← + job semgrep، + deno check/test للـ functions
tools/woo-probe.mjs                 ← سكريبت الفحص (Node، fetch، بدون مكتبات)
supabase/
  migrations/0007_orders.sql        ← vendors, products, orders, order_items, sub_orders, order_events, returns, woo_webhook_events, woo_sync_log, sync_state؛ orders_v؛ triggers؛ RLS؛ grants؛ status_map 9 صفوف؛ Realtime
  migrations/0008_mfa_cron.sql      ← has_perm تشترط aal2 لمن twofa؛ RPC mark_twofa_enrolled/disabled؛ pg_cron + pg_net + Vault secret + الوظيفة الدورية (محروسة)
  tests/rls_orders.sql, tests/rls_mfa.sql
  functions/_shared/woo-core.js     ← نقي: signature, mapping, status rules, cursor (ESM يتستورد من Deno وNode)
  functions/_shared/db.js           ← upsert helpers فوق supabase-js (Deno) — رقيقة
  functions/woo-webhook/index.ts, deno.json
  functions/woo-sync/index.ts, deno.json
  functions/woo-webhook/index_test.ts, functions/woo-sync/index_test.ts
tests/functions/woo-core.test.mjs   ← node:test للمنطق النقي
app/
  js/adapter/orders.js              ← window.IBOrders
  js/adapter/auth.js                ← + enrollTotp / verifyEnroll / unenrollTotp
  js/adapter/activity.js            ← LOGGED_PREFIXES + 'order.', 'suborder.', 'profile.2fa.'
  js/vendor/xlsx.full.min.js, js/vendor/html2canvas.min.js (+ README يثبّت الإصدارات)
  js/blocks/29-orders-app.js        ← hydrate + hooks + esc + بدون بذور (Task 6)
  js/blocks/11-seed-product-images.js ← `window.IB_PRODUCT_IMG = {};` (Task 6)
  js/blocks/18-page-profile.js      ← التحقق بخطوتين الحقيقي (Task 7)
  js/blocks/10-ui-kit.js, 17-page-settings.js, 28-app.js ← روابط المكتبات المحلية (Task 8)
  js/blocks/25-page-dashboard.js    ← المؤقّت ينادي IBActivity.refresh() (Task 8)
  .htaccess                         ← script-src 'self' (Task 8)
  index.html                        ← + orders.js
tests/adapter/orders.test.mjs, tests/adapter/auth.test.mjs (امتداد)
tests/e2e/orders.spec.mjs, tests/e2e/twofa.spec.mjs, tests/e2e/supabase-mock.mjs (امتداد: جداول الأوردرات، functions.invoke، MFA enroll)
tools/deploy.md (§2.1 الترتيب + §2.7 Edge Functions والأسرار والـ webhooks)، CLAUDE.md، README.md
```

**شكل بيانات الشاشة (الكتلة 29) اللي الـ adapter لازم يطلّعه بالظبط:**
- أوردر: `{ id (نص = رقم Woo), name, phone, pay (اسم طريقة الدفع), date 'YYYY-MM-DD', st (حالة النظام), cf (حالة التأكيد), dep, tot, age (أيام من date لـ K.TODAY), note, cdate, confAt, city, addr, cancel|null, ret|null, subs: [...] }`.
- فرعي (= سطر منتج): `{ n, sid (نص: woo_order_id للفرعي Dokan لو موجود وإلا رقم السطر), oid, prod, qty, tot, raw (حالة Woo للفرعي Dokan أو للأصلي لو مبتكر واحد), vendor (اسم المتجر), cm, ss, exp 'YYYY-MM-DD'|'' , sku, readyAt, waybill|null, pulled, ret|null, store|null }`.
- `OPEN = {processing:1, pending:1, 'on-hold':1}` على `raw`؛ `late(o)`: `age > 11` وفيه فرعي مفتوح؛ `risk(o)`: `9 ≤ age ≤ 11`. (موجودين في الكتلة، مايتغيروش.)

---

### Task 1: فحص الـ staging (شكل البيانات الحقيقي قبل أي قرار)

**Files:**
- Create: `tools/woo-probe.mjs`, `.github/workflows/staging-probe.yml`
- Test: تشغيل الـ workflow يدويًا (المتحكم) وقراءة اللوج.

**Interfaces:**
- Consumes: GitHub Secrets `STAGING_WOO_URL`, `STAGING_WOO_CK`, `STAGING_WOO_CS` (موجودة).
- Produces: لوج فيه، كل قسم بسطر JSON واحد وبدون أي بيانات شخصية: `statuses` (من `GET /wp-json/wc/v3/reports/orders/totals`)، `orders_since` (عدد الأوردرات `after=2026-10-01T00:00:00` بـ `per_page=1` وقراءة `X-WP-Total`)، `parents_sample` (3 أوردرات أصلية: `id, number, status, created_via, date_created, parent_id, payment_method, payment_method_title, total, line_items.length, meta_data keys, shipping/billing keys only`)، `subs_sample` (3 أوردرات بـ `parent_id>0`: نفس الحقول + قيم `_dokan_*` من `meta_data`)، `stores` (`GET /wp-json/dokan/v1/stores?per_page=100`: `id, store_name, enabled, registered`)، `products_total`، `webhooks` (`GET wc/v3/webhooks`: `id, name, topic, status, delivery_url`). الطمس: أي حقل اسمه `first_name|last_name|email|phone|address_1|address_2|company|customer_note|note` يتبدّل بـ `"<redacted>"` قبل الطباعة.
- التوقيع: Basic auth بـ `ck:cs` على HTTPS (WooCommerce بيقبلها). `fetch` من Node 22 بدون مكتبات.

- [ ] **Step 1: اكتب `tools/woo-probe.mjs`** (ESM، يقرا البيئة `WOO_URL/WOO_CK/WOO_CS`، يطبع الأقسام فوق، يطلع بكود 1 لو أي طلب فشل مع الحالة والنص الأول 200 حرف من الرد).
- [ ] **Step 2: اكتب `.github/workflows/staging-probe.yml`**: `workflow_dispatch` فقط، `permissions: contents: read`، `setup-node@v4` (22)، خطوة واحدة `node tools/woo-probe.mjs` بـ `env` من الأسرار `STAGING_WOO_*` (على مستوى الخطوة).
- [ ] **Step 3: اختبار محلي بدون شبكة:** `node --test tests/tools/woo-probe.test.mjs` لدالة الطمس `redact(obj)` (تصدير من السكريبت): كائن فيه `billing.phone` و`line_items[0].name` → التليفون `<redacted>` والمنتج كما هو.
- [ ] **Step 4: Commit**

```bash
git add tools/woo-probe.mjs tests/tools .github/workflows/staging-probe.yml
git commit -m "chore(woo): staging probe workflow (redacted shape of orders, sub-orders, stores, statuses)"
```

- [ ] **Step 5 (المتحكم):** شغّل الـ workflow من MCP، اقرا اللوج، وسجّل في الدفتر: الحالات الموجودة فعلًا (وأنهي slug لـ «جاهز للشحن» و«قيد الشحن» و«تم RTC»)، عدد الأوردرات من 1 أكتوبر، شكل meta الفرعيين، والـ webhooks الحالية. القرار اللي بيطلع منه بيدخل في Task 2 (seed خريطة الحالات) وTask 3 (المفاتيح).
- **النتيجة (run 40204355895 على `main`، 25 أكتوبر):** 10 حالات: `pending 0, processing 155, on-hold 14, completed 1938, cancelled 774, refunded 6, failed 0, checkout-draft 0, ready-shipping («Ready For Shipping») 0, in-shipping («In shipping») 27`. 190 أوردر من 1 أكتوبر (القايمة بتشمل الفرعيين: 12 من أحدث 20 أوردر `created_via 'dokan'` بـ `parent_id`). الأصلي لمبتكر واحد `created_via 'checkout'` وشايل `_dokan_vendor_id` بنفسه من غير فرعيين (Dokan بيعمل فرعيين للسلة متعددة المبتكرين بس). الفرعي meta الـ Dokan الوحيدة فيه `_dokan_vendor_id` — **مافيش** `_dokan_commission_*`/earning. meta الأصلي فيها بيانات شخصية برّه billing (`bosta_customer_phone`, `facebook_user_identifiers_*`, `_wc_order_attribution_user_agent`, `pmw_*`) وبيانات بوسطة مفيدة (`bosta_delivery_id`, `bosta_tracking_number`, `bosta_status`, `bosta_sync_status`). `dokan/v1/stores` بمفاتيح WC → `401 invalid_username` (مفاتيح WC بتشتغل على `wc/` بس؛ WP بيحاول Application Password ويفشل) — القايمة والمتجر الواحد `permission_callback __return_true` في مصدر Dokan، يعني من غير header بيرجّعوا. 3991 منتج. 4 webhooks موجودة كلها لـ n8n (3 معطّلة، 1 فعّالة `order.created` «Send Order - Air table») — ماتتلمسش. العملة EGP والدفع `cod`.
- **القرارات اللي دخلت Tasks 2–4 و9:** (1) خريطة الحالات بالـ slugs الحقيقية. (2) `mapOrder`: `raw.meta_data` قايمة مسموحة بس (`_dokan_*`, `bosta_delivery_id`, `bosta_tracking_number`, `bosta_status`, `bosta_sync_status`, `wpml_language`, `_wc_order_attribution_source_type`, `_wc_order_attribution_utm_source|medium|campaign`) والباقي يتشال؛ `line_items[].meta_data` يفضل منها `_dokan_*` بس؛ vendor السطر: meta السطر → meta الأصلي `_dokan_vendor_id` (مبتكر واحد). (3) `mapSubOrder`: `dokan_earning`/`commission` = `null` لما الـ meta مش موجودة (الربح بيتحسب في المرحلة 3 من `vendors.commission_pct`). (4) الدوال: نداءات `dokan/v1/*` **من غير** header مفاتيح WC؛ اختياريًا `WOO_WP_USER` + `WOO_WP_APP_PASSWORD` (Application Password لأدمن WP) لو اتضبطوا يتبعتوا Basic على `dokan/v1` بس. (5) `register_webhooks` بيعمل/بيحدّث الـ webhooks بتاعتنا بس (الاسم يبدأ بـ `ibtekr-ops:` والـ delivery_url على دوالنا)؛ الموجودة ماتتلمسش. (6) جلب `?parent=` يفضل كاحتياط؛ الفرعيين بيوصلوا بنفسهم في القايمة والـ webhooks. **(قاعدة الملكية من probe Task 1: الـ staging عليه 4 webhooks لـ n8n — 3 معطّلة وواحدة فعّالة `order.created`؛ الدالة بتعمل/بتحدّث الـ webhooks اللي اسمها يبدأ بـ `ibtekr-ops:` و`delivery_url` على `{SUPABASE_URL}/functions/v1/woo-webhook` بس، وماتلمسش غيرها أبدًا.)**

---

### Task 2: قاعدة البيانات — `0007_orders.sql` + `rls_orders.sql`

**Files:**
- Create: `supabase/migrations/0007_orders.sql`, `supabase/tests/rls_orders.sql`
- Test: `npm run db:test`

**Interfaces:**
- Consumes: `profiles`, `roles`, `has_perm`, `is_admin`, `status_map`, `alerts`, `log_activity` (المرحلة صفر)، قرار Task 1 لصفوف الخريطة.
- Produces (SQL):
  - `vendors(id uuid pk default gen_random_uuid(), woo_vendor_id int unique, name text not null, aliases text[] not null default '{}', phone text, email text, status text not null default 'active' check (status in ('active','inactive')), commission_pct numeric(5,2), raw jsonb, created_at timestamptz default now(), updated_at timestamptz default now())`. RLS: select `has_perm('vendors.view') <> 'N'`; insert/update/delete `is_admin() or has_perm('vendors.edit') = 'F'`. (المرحلة 3 بتضيف العقود والنسب بتاريخ سريان.)
  - `products(id bigint pk, sku text, name text not null, image_url text, vendor_id uuid references vendors, price numeric(12,2), status text, raw jsonb, updated_at timestamptz default now())`. RLS: select `has_perm('orders.view') <> 'N'`; writes admin (المزامنة بـ service_role).
  - `orders(id bigint pk, number text not null, customer_name text not null, customer_phone text, customer_city text, customer_address text, payment_method text, payment_title text, status text not null references status_map(system_status), woo_status text, confirm text not null default 'غير مؤكد' check (confirm in ('مؤكد بعربون','مؤكد بدون عربون','غير مؤكد','في انتظار الرد')), confirm_at date, confirm_note text, deposit numeric(12,2) not null default 0, total numeric(12,2) not null default 0, currency text default 'EGP', note text, customer_note text, placed_at timestamptz not null, woo_updated_at timestamptz, cancel jsonb, ret jsonb, raw jsonb, synced_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now())` + index على `placed_at desc`, `status`, `woo_updated_at`.
  - `sub_orders(id bigserial pk, order_id bigint not null references orders on delete cascade, vendor_id uuid references vendors, woo_order_id bigint unique, woo_status text, total numeric(12,2), dokan_earning numeric(12,2), commission jsonb, raw jsonb, updated_at timestamptz default now(), unique (order_id, vendor_id))`.
  - `order_items(id bigint pk, order_id bigint not null references orders on delete cascade, sub_order_id bigint references sub_orders, product_id bigint, sku text, name text not null, qty int not null default 1, total numeric(12,2) not null default 0, vendor_id uuid references vendors, status text not null default '' , expected_at date, comment text, ready_at timestamptz, waybill jsonb, pulled boolean not null default false, ret jsonb, store jsonb, raw jsonb, updated_at timestamptz default now())` — `status` في قائمة الـ 11 حالة الفرعية بتاعة البروتوتايب أو `''` (check).
  - `order_events(id bigserial pk, at timestamptz default now(), order_id bigint references orders on delete cascade, item_id bigint references order_items on delete cascade, actor uuid references profiles, source text not null check (source in ('user','woo','sync','system')), kind text not null, old_value text, new_value text, detail jsonb)`. تتملي من triggers على `orders` (status, confirm, deposit, note, cancel, ret، **من غير** customer_phone: التغيير بيتسجّل كـ `kind='phone'` بدون قيم) و`order_items` (status, expected_at, waybill, pulled). `source` = `'user'` لو `auth.uid()` موجود وإلا `'woo'`.
  - `returns(id bigserial pk, at timestamptz default now(), order_id bigint not null references orders on delete cascade, item_id bigint references order_items on delete cascade, kind text not null check (kind in ('order_refund','order_cancel','item_to_stock','item_to_vendor')), reason text not null, note text, on_date date, by_user uuid references profiles)`. تتملي من نفس الـ triggers لما الحالة تبقى «استرجاع»/«ملغي» (أوردر) أو «مرتجع للمخزن»/«مرتجع للمورد» (سطر) ومعاها `cancel`/`ret`/`item.ret` فيها `reason`.
  - `woo_webhook_events(id bigserial pk, received_at timestamptz default now(), delivery_id text unique, webhook_id text, topic text not null, resource_id bigint, status text not null check (status in ('ok','ignored','duplicate','error')), error text, payload jsonb)`.
  - `woo_sync_log(id bigserial pk, at timestamptz default now(), kind text not null check (kind in ('webhook','sync','push','manual','cron')), direction text check (direction in ('in','out')), entity text, entity_id text, action text, result text not null check (result in ('ok','error','conflict','skipped')), detail jsonb)`.
  - `sync_state(key text pk, value jsonb not null default '{}', updated_at timestamptz default now())`.
  - view `orders_v` (`with (security_invoker = true)`): كل أعمدة `orders` إلا `customer_phone` اللي بيتبدّل بـ `case when (select public.has_perm('sensitive.customer_phone')) = 'F' then customer_phone else public.mask_phone(customer_phone) end as customer_phone`؛ `mask_phone('01100007039') = '011••••7039'` (دالة `immutable`). الـ adapter بيقرا من `orders_v` بس.
  - trigger `orders_guard_update` (للأدوار API): تغيير `status`/`confirm`/`confirm_at`/`confirm_note`/`cancel`/`ret` يحتاج `has_perm('orders.status') = 'F'`؛ تغيير `note`/`customer_city`/`customer_address`/`deposit` يحتاج `has_perm('orders.edit') <> 'N'`؛ أي عمود تاني (أعمدة Woo: `customer_name`, `customer_phone`, `total`, `woo_status`, `placed_at`, `raw`, …) ممنوع من API → 42501. `order_items_guard_update`: `status`/`expected_at`/`ready_at`/`waybill`/`pulled`/`ret`/`store`/`comment` يحتاج `has_perm('orders.status') = 'F'`؛ غير كده 42501.
  - RLS: `orders`, `order_items`, `sub_orders`, `order_events`, `returns`: select `has_perm('orders.view') <> 'N'`; update (orders, order_items) `has_perm('orders.status') = 'F' or has_perm('orders.edit') <> 'N'` (والـ trigger بيحدد الأعمدة)؛ insert/delete أدمن فقط (المزامنة بـ service_role). `woo_webhook_events`, `woo_sync_log`, `sync_state`: select `has_perm('settings.view') <> 'N'`; كتابة service_role فقط (مافيش سياسة كتابة لـ authenticated).
  - Grants: `select, update` على `orders`, `order_items` لـ authenticated؛ `select` على `sub_orders`, `order_events`, `returns`, `products`, `vendors`, `orders_v`, `woo_webhook_events`, `woo_sync_log`, `sync_state`؛ `insert, update, delete` على `vendors` لـ authenticated (RLS بتحكم)؛ كل شيء لـ `service_role`؛ `revoke truncate, references, trigger` من الكل. `grant execute on function mask_phone to authenticated, service_role`.
  - `status_map`: صفوف النظام التسعة بالترتيب `قيد الانتظار(pending)، جاري التنفيذ(processing)، معلّق(on-hold)، جاهز للشحن(ready-shipping)، قيد الشحن(in-shipping)، تم RTC(null → direction 'from_system')، مكتمل(completed)، استرجاع(refunded)، ملغي(cancelled)` — الـ slugs من probe الـ staging (Task 1، run 40204355895): `ready-shipping` = «Ready For Shipping» و`in-shipping` = «In shipping»، ومافيش حالة RTC في Woo؛ تنفيذ بـ `update` للصفوف الموجودة (`مرتجع` → `استرجاع`، `shipped` → `in-shipping`) و`insert … on conflict (system_status) do nothing` للجديدة، ومن غير delete.
  - Realtime: `orders`, `order_items`, `sub_orders` تتضاف لمنشور `supabase_realtime` (نفس حارس 0006).
- **قرار:** الفرعي في الشاشة = سطر منتج (`order_items`) بحالته التشغيلية، و`sub_orders` = أوردر Dokan لكل مبتكر (المالية ومرآة Woo). ليه: الوثيقة سمّت `sub_orders` لكل مبتكر، والشاشة بتدير كل منتج لوحده (وصل المخزن، شحن، مرتجع) — الاتنين لازمين. التكلفة لو غلط: جدول زيادة.
- **قرار:** `order_events` بتتملي من triggers (مش من الواجهة) عشان أي تغيير — من الشاشة أو من المزامنة — يتسجّل بنفس الطريقة. التكلفة لو غلط: تعقيد في الـ triggers.

- [ ] **Step 1: اكتب `supabase/tests/rls_orders.sql`** (fixtures المرحلة صفر: أدمن، عمليات `orders.status F / orders.edit P`، خدمة عملاء `orders.status F / orders.edit N / sensitive.customer_phone F`، حسابات `orders.status N / orders.edit N / sensitive.customer_phone N`، مشاهد موقوف؛ مبتكر Dokan واحد؛ أوردر 181668 بسطرين ومنتجين وsub_order واحد). الحالات: الحسابات يقرا `orders_v` ويشوف التليفون مطموس `011••••7039`، خدمة العملاء يشوفه كامل؛ الحسابات يغيّر `status` → 42501؛ العمليات يغيّر `status` من «قيد الانتظار» لـ «جاري التنفيذ» → صف في `order_events` بـ `kind='status'`, `source='user'`, `actor` = هو؛ العمليات يغيّر `note` → ينجح (`orders.edit P`)؛ خدمة العملاء يغيّر `note` → 42501؛ العمليات يغيّر `customer_name` → 42501 (عمود Woo)؛ العمليات يحط `status='ملغي'` مع `cancel = {"reason":"العميل لا يرد","date":"2026-10-25"}` → صف في `returns` بـ `kind='order_cancel'`؛ العمليات يحط حالة سطر «مرتجع للمخزن» مع `ret` → `returns.kind='item_to_stock'` + `order_events.kind='item_status'`؛ المشاهد الموقوف يقرا `orders_v` → 0؛ postgres (service) يحدّث `woo_status` → `order_events.source='woo'` و`actor` null؛ `woo_webhook_events` insert مكرر لنفس `delivery_id` → 23505؛ الحسابات يقرا `woo_sync_log` → 0 صف (settings.view N)، العمليات → يقرا. آخر السطر `raise notice 'rls_orders: ok'`.
- [ ] **Step 2: `npm run db:test`** → يفشل بـ `relation "public.vendors" does not exist`.
- [ ] **Step 3: اكتب `0007_orders.sql`** بالتعريفات فوق بالترتيب: الجداول والفهارس → `enable row level security` → الدوال (`mask_phone`, triggers) → الـ view → السياسات → grants/revokes → خريطة الحالات → Realtime. رأس الملف بالإنجليزي بالقرارين.
- [ ] **Step 4: `npm run db:test`** → الأربع اختبارات ok.
- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): orders domain — vendors, products, orders, items, Dokan sub-orders, events, returns, sync tables, masked phone view, status map; RLS tests"
```

---

### Task 3: منطق المزامنة النقي — `_shared/woo-core.js` + اختبارات Node

**Files:**
- Create: `supabase/functions/_shared/woo-core.js`, `tests/functions/woo-core.test.mjs`
- Test: `npm test`

**Interfaces:**
- Produces (ESM، بدون import من Deno أو Node، WebCrypto فقط):
  - `async verifySignature(rawBody: string, signatureHeader: string, secret: string) → boolean`: HMAC-SHA256 على الجسم الخام، Base64، مقارنة ثابتة الزمن؛ `false` لو أي قيمة فاضية.
  - `isSubOrder(wooOrder) → boolean` (`parent_id > 0`).
  - `mapOrder(wooOrder, { statusMap, vendorsByWooId, now }) → { order, items, skipped?: reason }`: `order` = صف `orders` (`id` = `wooOrder.id`، `number` = `wooOrder.number`، `customer_name` = `billing.first_name + ' ' + billing.last_name` مع trim، `customer_phone` = `billing.phone` بعد `normalizePhone` (أرقام فقط، `+20` → `0`)، `customer_city` = `shipping.city || billing.city`، `customer_address` = `address_1 + ' ' + address_2` trim، `payment_method/title`، `status` = `incomingStatus(...)`، `woo_status`, `total`, `currency`, `customer_note`, `placed_at` = `date_created_gmt + 'Z'`, `woo_updated_at`, `raw` = الـ payload من غير `billing`/`shipping` (بيتحفظوا مطموسين: `redactPII`) ومع `meta_data` **مقصوصة على قايمة مسموحة** (`META_KEEP`: أي مفتاح يبدأ بـ `_dokan_`، و`bosta_delivery_id`, `bosta_tracking_number`, `bosta_status`, `bosta_sync_status`, `wpml_language`, `_wc_order_attribution_source_type`, `_wc_order_attribution_utm_source`, `_wc_order_attribution_utm_medium`, `_wc_order_attribution_utm_campaign`؛ الباقي بيتشال مش بيتطمس — الـ staging فيه `bosta_customer_phone` و`facebook_user_identifiers_*` و`_wc_order_attribution_user_agent` في الـ meta)؛ `items` = `line_items` → صفوف `order_items` (`id` = `line_item.id`، `product_id`, `sku`, `name`, `qty` = `quantity`, `total`، `vendor_id` من `vendorsByWooId[meta السطر _dokan_vendor_id]` وإلا من `vendorsByWooId[meta الأصلي _dokan_vendor_id]` (الأصلي لمبتكر واحد شايل الـ meta بنفسه ومالوش فرعيين) لو موجود؛ `raw` السطر = السطر من غير `meta_data` إلا مفاتيح `_dokan_*`). `skipped: 'before_start'` لو `date_created < 2026-10-01`، `'draft'` لو `status in ('checkout-draft','trash')`.
  - `mapSubOrder(wooSubOrder, { vendorsByWooId }) → sub_orders row` (`woo_order_id` = id، `order_id` = parent_id، `vendor_id` من meta `_dokan_vendor_id`، `woo_status`, `total`, `dokan_earning` من meta `_dokan_vendor_earning`/حقل `earning` لو جاي من dokan/v1 **وإلا `null`**، `commission` = `{ rate: _dokan_commission_rate, type: _dokan_commission_type, admin_fee: _dokan_admin_fee, additional_fee: _dokan_additional_fee }` مع تحويل الأرقام **وإلا `null` لو ولا مفتاح منهم موجود** — على الـ staging الفرعي شايل `_dokan_vendor_id` بس؛ `raw` بنفس قصّ الـ meta بتاع `mapOrder`).
  - `mapStore(dokanStore) → vendors row` (`woo_vendor_id` = id، `name` = `store_name`، `phone`, `email` (لو `show_email`), `status` = `enabled ? 'active' : 'inactive'`, `raw` بدون `address`/`email`).
  - `incomingStatus(wooStatus, currentSystemStatus, statusMap) → { status, result: 'ok'|'conflict'|'unchanged' }`: صف الخريطة اللي `woo_status = wooStatus` واتجاهه `both` أو `from_woo` → حالته؛ `failed` → «ملغي» (قاعدة ثابتة `WOO_FALLBACK`)؛ مش موجود → `currentSystemStatus ?? 'قيد الانتظار'` و`result: 'conflict'`.
  - `outgoingWooStatus(systemStatus, statusMap) → string|null`: `woo_status` لو الاتجاه `both` أو `from_system` و`woo_status` مش null، وإلا `null` (= مايتبعتش).
  - `nextCursor(previousIso, orders) → iso`: أكبر `date_modified_gmt` − 60 ثانية (تحسّبًا للتأخير) أو السابق.
  - `redactPII(obj) → obj` (نفس قاعدة Task 1).
  - `normalizePhone(s) → string`.
  - ثوابت: `START_DATE = '2026-10-01'`, `OPEN_WOO = ['processing','pending','on-hold']`, `WOO_FALLBACK = { failed: 'ملغي' }`.

- [ ] **Step 1: اكتب `tests/functions/woo-core.test.mjs`** بحالات: توقيع صحيح لجسم عربي (يتحسب في الاختبار بـ WebCrypto) → `true`؛ توقيع متغيّر حرف → `false`؛ سر فاضي → `false`. `isSubOrder` لـ `parent_id 0` و`181700`. `mapOrder` على payload مصغّر (من شكل Woo v3: `id 181668, number '181668', status 'processing', date_created_gmt '2026-10-19T09:12:00', billing {first_name:'سلوى', last_name:'زيتوني', phone:'+201200007052', city:'القاهرة'}, line_items [{id: 9001, product_id: 501, sku:'SC-12', name:'…', quantity:2, total:'1002.00', meta_data:[{key:'_dokan_vendor_id', value:'77'}]}]`) → `order.customer_name === 'سلوى زيتوني'`, `customer_phone === '01200007052'`, `status === 'جاري التنفيذ'`, `placed_at === '2026-10-19T09:12:00Z'`, `raw.billing` مطموس، `items[0].vendor_id === vendorsByWooId[77]`; أوردر `date_created_gmt '2026-09-30T23:59:00'` → `skipped === 'before_start'`; `status 'checkout-draft'` → `skipped === 'draft'`. `incomingStatus('on-hold', 'جاري التنفيذ', map)` → `معلّق/ok`; `('failed', null)` → `ملغي/ok`; `('weird', 'قيد الشحن')` → `قيد الشحن/conflict`; `('weird', null)` → `قيد الانتظار/conflict`; اتجاه `from_system` لحالة واردة → `unchanged`. `outgoingWooStatus('تم RTC')` → `null`; `('مكتمل')` → `'completed'`. `mapSubOrder` يطلّع `commission.rate === 40` من `'40'` و`dokan_earning` رقم، ولفرعي meta فيه `_dokan_vendor_id` بس → `dokan_earning === null` و`commission === null` و`vendor_id` صح. `mapOrder` لأصلي meta فيه `_dokan_vendor_id: '2376'` وسطوره من غير meta → `items[*].vendor_id === vendorsByWooId[2376]`؛ و`raw.meta_data` بعد القصّ فيها `bosta_tracking_number` ومافيهاش `bosta_customer_phone` ولا `facebook_user_identifiers_1374412550868003` ولا `_wc_order_attribution_user_agent`؛ `items[0].raw.meta_data` فيها مفاتيح `_dokan_*` بس. `mapStore` بـ `enabled:false` → `'inactive'`. `nextCursor`. `normalizePhone('+20 120-000-7052') === '01200007052'`.
- [ ] **Step 2: `npm test`** → الملف الجديد FAIL (`Cannot find module`).
- [ ] **Step 3: اكتب `woo-core.js`** (تعليق رأس بالإنجليزي يقول إنه بيتستورد من Deno وNode؛ ممنوع أي API خاص ببيئة).
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/woo-core.js tests/functions
git commit -m "feat(woo): pure sync core — webhook signature, Woo→DB mapping, status map rules, cursor"
```

---

### Task 4: Edge Functions — `woo-webhook` و`woo-sync` (Deno)

**Files:**
- Create: `supabase/functions/woo-webhook/index.ts`, `supabase/functions/woo-webhook/deno.json`, `supabase/functions/woo-webhook/index_test.ts`, `supabase/functions/woo-sync/index.ts`, `supabase/functions/woo-sync/deno.json`, `supabase/functions/woo-sync/index_test.ts`, `supabase/functions/_shared/db.js`
- Test: `deno check supabase/functions/**/index.ts` و`deno test --allow-env --allow-net=127.0.0.1 supabase/functions` (Deno 2.9 متسطّب محليًا؛ CI يسطّبه في Task 8).

**Interfaces:**
- Consumes: Task 3؛ env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (تلقائيين)، `WOO_URL`, `WOO_CK`, `WOO_CS`, `WOO_WEBHOOK_SECRET` (أسرار يدخلها صاحب المشروع)، واختياريًا `WOO_WP_USER` + `WOO_WP_APP_PASSWORD` (Application Password لأدمن WordPress — لـ `dokan/v1` بس)؛ **قاعدة المصادقة (من probe Task 1):** مفاتيح WC بتشتغل على `wc/v3` بس؛ نداء `dokan/v1/*` بالـ header بتاعهم بيرجّع `401 invalid_username`. فـ `wooFetch(path)`: مسار `wc/` → `Authorization: Basic base64(ck:cs)`؛ مسار `dokan/` → من غير Authorization خالص (قايمة المتاجر والمتجر الواحد عامّين)، إلا لو `WOO_WP_USER`/`WOO_WP_APP_PASSWORD` موجودين فيتبعتوا Basic؛ جداول Task 2؛ Vault secret `sync_secret` (Task 7 بيولّده؛ هنا الدالة بتقراه من `vault.decrypted_secrets` عبر RPC `public.sync_secret_matches(text) → boolean` اللي Task 7 بيعرّفها — لحد ساعتها الاختبار بيحقنها).
- Produces:
  - `woo-webhook` (`verify_jwt: false`): `POST` فقط؛ يقرا الجسم الخام؛ `X-WC-Webhook-Signature` غلط/ناقص → `401 {error:'bad_signature'}` وسطر `woo_sync_log` (`kind 'webhook', result 'error'`)؛ `X-WC-Webhook-Delivery-ID` موجود قبل كده في `woo_webhook_events` → `200 {status:'duplicate'}`؛ topic `order.*`: لو `isSubOrder` → upsert `sub_orders` (`mapSubOrder`) ويتسجّل `ignored` (الحالات التشغيلية ماتتلمسش)؛ وإلا `mapOrder` → `skipped` يتسجّل `ignored`؛ غير كده upsert `orders` (مع `incomingStatus` على الحالة الحالية في DB) + `order_items` (upsert بالـ id؛ السطور اللي اختفت من Woo تتعلّم `raw.removed = true` مش تتمسح) ثم `GET {WOO_URL}/wp-json/wc/v3/orders?parent={id}` لجلب الفرعيين Dokan وupsert `sub_orders` وربط `order_items.sub_order_id` بالمبتكر؛ topic `product.*` → upsert `products` (`image_url` = `images[0].src`); أي `conflict` من `incomingStatus` يتسجّل في `woo_sync_log` بـ `result 'conflict'`؛ الرد دايمًا `200 {status:'ok'|'ignored', id}` بعد الكتابة؛ أي استثناء → `500` + سطر `error` (Woo بيعيد المحاولة).
  - `woo-sync` (`verify_jwt: false`، مصادقة داخلية): الهيدر `X-Sync-Secret` صحيح (RPC `sync_secret_matches`) → وضع النظام؛ وإلا `Authorization: Bearer <jwt مستخدم>` → عميل بالتوكن ده وفحص `rpc('has_perm', {key:'orders.status'})` = `'F'` (للدفع) أو `rpc('is_admin')` (للمزامنة والتسجيل)؛ غير كده `401`. الجسم `{ action, ...args }`:
    - `'orders'`: يسحب `wc/v3/orders?after=2026-10-01T00:00:00&modified_after={cursor}&per_page=100&page=n&orderby=modified&order=asc` لحد ما الصفحة تفضى؛ الأصليين عبر `mapOrder` والفرعيين عبر `mapSubOrder`؛ يحدّث `sync_state['orders'] = { cursor, last_run, count }`؛ سطر `woo_sync_log` بالنتيجة.
    - `'vendors'`: `dokan/v1/stores?per_page=100&page=n` (بقاعدة المصادقة فوق) → upsert `vendors` على `woo_vendor_id` (ما يلمسش `aliases`/`commission_pct` الموجودين).
    - `'products'`: `wc/v3/products?per_page=100&page=n&modified_after={cursor}` → upsert.
    - `'all'`: vendors ثم products ثم orders.
    - `'push_status'` `{ order_id, status }`: `outgoingWooStatus` → `null` → `{result:'skipped'}`؛ وإلا `PUT wc/v3/orders/{id} {status}`؛ لو رد Woo فيه `date_modified_gmt` أحدث من `orders.woo_updated_at` وحالته مختلفة عن اللي بنبعته → يكمل الدفع (قاعدة «السيستم يكسب») ويسجّل `conflict`؛ نجاح → تحديث `orders.woo_status`/`woo_updated_at` و`woo_sync_log` (`kind 'push', direction 'out'`).
    - `'register_webhooks'` `{ delivery_url }` (أدمن): يقرا `wc/v3/webhooks`، ينشئ الناقص من `order.created`, `order.updated`, `product.updated`, `product.created` بـ `secret = WOO_WEBHOOK_SECRET`, `status 'active'`, ويرجّع القائمة.
    - الرد `200 { action, result, counts }` أو `4xx/5xx { error }`.
  - `_shared/db.js`: `upsertRows(client, table, rows, onConflict)` بدفعات 200، `logSync(client, row)`, `getState/setState`.
  - الاختبارات (Deno): `index_test.ts` بيحقن `fetch` وهمي للـ Woo وعميل Supabase وهمي (كائن بنفس دوال supabase-js المستخدمة) عبر دالة `handler(req, deps)` مُصدَّرة من كل `index.ts` (الـ `Deno.serve` بيلفها بالاعتماديات الحقيقية). الحالات: webhook توقيع غلط → 401؛ delivery مكرر → 200 duplicate ولا كتابة؛ أوردر أصلي → upsert orders + items + جلب الفرعيين؛ أوردر فرعي → sub_orders بس؛ sync `push_status` لحالة `woo_status null` → skipped؛ `push_status` بمستخدم `orders.status = 'P'` → 401؛ secret صحيح → وضع النظام.

- [ ] **Step 1: اكتب الاختبارين** (Deno `std/assert` عبر `jsr:@std/assert`؛ `deno.json` بـ `imports` لـ `@supabase/supabase-js` من `npm:` و`jsr:@std/assert`).
- [ ] **Step 2: `deno test …`** → FAIL (الملفات مش موجودة).
- [ ] **Step 3: اكتب الدالتين و`db.js`** بالتعاقد فوق؛ `handler` منفصلة عن `Deno.serve`.
- [ ] **Step 4: `deno check` + `deno test`** → PASS؛ `npm test` لسه PASS.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat(woo): woo-webhook and woo-sync edge functions (signature, idempotency, sub-orders, backup sync, status push, webhook registration)"
```

---

### Task 5: الـ adapter `IBOrders` + الـ mock

**Files:**
- Create: `app/js/adapter/orders.js`, `tests/adapter/orders.test.mjs`
- Modify: `app/js/adapter/activity.js` (`LOGGED_PREFIXES`)، `app/js/adapter/directory.js` (تحميل `IBOrders.load()` ضمن `allSettled` + `clear`)، `app/index.html`, `tests/e2e/supabase-mock.mjs`
- Test: `npm test`, `npm run e2e` (الاختبارات الموجودة تفضل خضرا)

**Interfaces:**
- Consumes: جداول Task 2 عبر PostgREST (`orders_v`, `order_items`, `sub_orders`, `vendors`, `products`, `status_map`)، `client.functions.invoke('woo-sync', { body })`، Realtime على `orders`/`order_items`/`sub_orders`؛ `window.OrdersApp.hydrate(data)` و`window.IBOrdersStore` (Task 6).
- Produces: `window.IBOrders = { load(): Promise<void>, data(): { orders, vendors, images } | null, setOrderStatus(id, status, extra) → Promise<{ok, reason?}>, setConfirm(id, cf, { confAt, note }) → Promise<{ok}>, patchOrder(id, { note?, city?, addr?, dep? }) → Promise<{ok}>, setItemStatus(itemId, ss, extra: { exp?, cm?, ret?, store?, readyAt? }) → Promise<{ok}>, setWaybill(itemId, w) → Promise<{ok}>, setPulled(itemId, bool), syncNow() → Promise<{ok, counts?}>, registerWebhooks() → Promise<{ok, list?}>, subscribe(), unsubscribe(), clear(), toScreen(rows, items, subs, vendors) (نقية، مُصدَّرة للاختبار) }`.
  - `load()`: `orders_v` (`placed_at >= now() - 12 months`, order `placed_at desc`, limit 5000 بصفحات 1000) + `order_items` بـ `in('order_id', ids)` بصفحات + `sub_orders` + `vendors` + `products(id, sku, image_url)` + `status_map`؛ `toScreen` تبني شكل الشاشة (قسم «شكل بيانات الشاشة» فوق): `age` = أيام من `placed_at` لـ `K.TODAY`؛ `raw` للسطر = `sub_orders.woo_status` بتاع مبتكره أو `orders.woo_status`؛ `vendor` = اسم المتجر؛ `images[sku] = image_url`؛ ثم `OrdersApp.hydrate({ orders, vendors, images, statuses })`.
  - الكتابات: write-through: `OrdersApp` بيعدّل محليًا الأول (الكتلة 29) ثم ينادي الـ hook؛ الـ adapter يعمل `update` على الجدول؛ خطأ `42501` → `{ ok:false, reason:'forbidden' }`؛ غيره `{ ok:false, reason:'network' }`. `setOrderStatus` بعد نجاح الكتابة ينادي `functions.invoke('woo-sync', { body: { action:'push_status', order_id, status } })` ويرجّع نتيجته في `push` (`'ok'|'skipped'|'error'`) من غير ما يفشّل العملية. كل كتابة ناجحة → `K.logEvent('order.status' | 'order.confirm' | 'order.patch' | 'suborder.status' | 'suborder.waybill', detail)`.
  - Realtime: INSERT/UPDATE على الجداول التلاتة → إعادة بناء الأوردر المتأثر (قراءة صفه + سطوره) و`OrdersApp.applyOrder(screenOrder)` (Task 6) ثم `ib:notify`.
  - `syncNow()`: `functions.invoke('woo-sync', { body: { action:'all' } })` (أدمن)؛ `registerWebhooks()`: `{ action:'register_webhooks', delivery_url: IB_CONFIG.supabaseUrl + '/functions/v1/woo-webhook' }`.
  - `IBDirectory.load()` يضيف `IBOrders.load()` للـ `allSettled` ثم `IBOrders.subscribe()`؛ `clear()` ينادي `IBOrders.clear()`.
  - الـ mock: جداول `orders_v`, `order_items`, `sub_orders`, `vendors`, `products`, `status_map` من بيانات seed صغيرة (3 أوردرات: واحد متعدد المبتكرين بفرعيين Dokan، واحد مبتكر واحد، واحد اسم عميله `<img src=x onerror="window.__xss=1">`)، RLS بالدور (`orders.view` N للمشاهد الموقوف؛ `sensitive.customer_phone` حسب الدور: الأدمن F، العمليات F، المشاهد N → طمس)، `PATCH` على `orders`/`order_items` مع trigger وهمي (الحسابات → 42501 على `status`)، `POST /functions/v1/woo-sync` يسجّل `mock.pushes` ويرجّع `{result:'ok'}` (أو `skipped` لـ «تم RTC»)، `realtime:false`.

- [ ] **Step 1: اكتب `tests/adapter/orders.test.mjs`** (stub المشترك): `load` يبني شكل الشاشة صح (أوردر بسطرين من مبتكرين، `sid` = `woo_order_id` الفرعي، `raw` من الفرعي، `age` من `placed_at` و`K.TODAY = '2026-10-25'`، `images`)؛ `setOrderStatus` يكتب `update` على `orders` بـ `{status}` ثم `functions.invoke` بـ `push_status`؛ `42501` → `forbidden` ومافيش invoke؛ `setItemStatus('مرتجع للمخزن', { ret })` يكتب `status` و`ret`؛ `toScreen` لمبتكر واحد بدون sub_orders → `sid` = رقم السطر و`raw` = `orders.woo_status`؛ `clear()`.
- [ ] **Step 2: `npm test`** → FAIL. **Step 3:** اكتب الـ adapter + التعديلات + الـ mock. **Step 4:** `npm test` و`npm run e2e` PASS (الـ mock يرد على طلبات `load()` الجديدة عشان `auth.spec`/`dashboard.spec` مايتكسروش).
- [ ] **Step 5: Commit**

```bash
git add app/js/adapter app/index.html tests/adapter tests/e2e/supabase-mock.mjs
git commit -m "feat(orders): IBOrders adapter — load last 12 months into the orders screen shape, write-through with status push, realtime"
```

---

### Task 6: صفحة الأوردرات على البيانات الحقيقية (الكتلة 29) + التهريب + إزالة البذور + e2e

**Files:**
- Modify: `app/js/blocks/29-orders-app.js`, `app/js/blocks/11-seed-product-images.js`, `tests/split.test.mjs` (`EDITED` + 11، 29)، `tools/blocks.lock.json`
- Create: `tests/e2e/orders.spec.mjs`
- Test: `npm test`, `npm run e2e`

**Interfaces:**
- Consumes: `IBOrders` (Task 5)؛ الهيكل الحالي للكتلة: `RAW`/`RS` → `O`/`OM`/`V`، `draw()`, `card()`, `orderStatus()`, `subStatus()`, حوارات التعديل، `esc()` الموجودة.
- Produces (قرارات الكتلة 29):
  1. **مصدر البيانات:** تتشال `RAW` و`RS` والسطور اللي بتبنيهم؛ تتضاف `function hydrate(d)` بتعيد بناء `O`, `OM`, `V` (من `d.vendors` مرتبة)، `IMG = d.images || {}`، وتستدعي `draw()` لو الصفحة مرسومة؛ `window.OrdersApp.hydrate = hydrate` و`window.OrdersApp.applyOrder(o)` (تبديل/إضافة أوردر واحد في مكانه + `draw(1)`). `thumb(sku)` يقرا من `IMG` ثم `window.IB_PRODUCT_IMG`. قبل أول `hydrate` الصفحة بتعرض حالة فاضية «بيحمّل الأوردرات…» بدل الكراش.
  2. **نقاط الكتابة:** في `orderStatus`, `subStatus`, حفظ التأكيد/العربون/الملاحظة/العنوان، `waybill`, `patch`, حفظ تعليق الفرعي (`data-cs`), «سحب من المتاح» — بعد التعديل المحلي: `window.IBOrdersStore && IBOrdersStore.<method>(…)` ولو رجّع `{ok:false}` → استرجاع القيمة القديمة + `toast(reason === 'forbidden' ? 'مش من صلاحياتك' : 'معرفناش نحفظ — جرّب تاني')`. `window.IBOrdersStore` = `IBOrders` (الـ adapter بيعرّفه). زر «مزامنة» ينادي `IBOrdersStore.syncNow()` ويعرض `toast` بالعدد أو بالخطأ (كان بيطلّع رسالة تجريبية).
  3. **التهريب:** كل إدراج لنص من المستخدم/الموقع في قوالب innerHTML بيمر على `esc()`: `o.name, o.phone, o.note, o.city, o.addr, o.pay, s.prod, s.vendor, s.sku, s.cm, s.exp, reason/note` في `cancel`/`ret`، أسماء المبتكرين في الفلاتر (`opts(V, …)`)، نص البحث لما يتعاد رسمه. القيم اللي بتتحط في `value=` attributes كمان بـ `esc()` (بيهرّب `"`).
  4. **إزالة البذور:** الكتلة 11 تبقى `window.IB_PRODUCT_IMG = {};` بس (الصور من `products.image_url`)؛ الرسالة «نفس بيانات Airtable» في الهيدر تتشال؛ كل `toast` فيه «تجريبي — لسه مش بيكتب على Airtable» يتشال.
  5. **ما يتغيرش:** الفلاتر، الفرز، البطاقات، الحوارات، قواعد `late/risk`، الـ shadow DOM، ومنطق `IBOrdersOps` (الكتلة 22) — المخزن لسه تجريبي لحد المرحلة 5.
- **قرار:** الـ e2e اللي بيعتمد على بيانات حقيقية بيجري على الـ mock (`mockOnly`)؛ الـ LIVE mode بيتخطّاه.

- [ ] **Step 1: اكتب `tests/e2e/orders.spec.mjs`** (mockOnly): `the orders page lists real orders and no seed` (دخول الأدمن → `#orders` host → في الـ shadow root `.card` عددها 3، النص يحتوي «سلوى زيتوني»، ما يحتويش «Customer 48»، عدّاد `#cn` = 3)؛ `an html customer name renders inert` (الكارت يعرض النص `<img src=x onerror=…>` حرفيًا و`page.evaluate(() => window.__xss)` = `undefined`)؛ `status change writes and pushes` (غيّر حالة الأوردر الأول لـ «جاري التنفيذ» من القائمة → `mock.patches` فيها `{ table:'orders', id, status:'جاري التنفيذ' }` و`mock.pushes` فيها `{ action:'push_status', order_id, status }`)؛ `a status with no Woo slug is not pushed` («تم RTC» → `push` نتيجته `skipped`؛ `mock.pushes` آخر عنصر `result 'skipped'`)؛ `forbidden status change reverts` (دخول مستخدم الحسابات بـ `orders.status N` في الـ mock → تغيير الحالة → الكارت يرجع للحالة القديمة والـ toast «مش من صلاحياتك»، `mock.pushes` فاضية)؛ `masked phone for a role without sensitive.customer_phone` (المشاهد/الحسابات يشوف `011••••7052`)؛ `sub-order status is local only` (تغيير حالة فرعي «مؤكد» → `mock.patches` على `order_items` ومافيش `pushes`)؛ `product image comes from products` (الصورة `src` = `image_url` من الـ mock).
- [ ] **Step 2: شغّل الـ spec** → FAIL (الصفحة لسه على البذور).
- [ ] **Step 3: عدّل الكتلتين 29 و11 بالقرارات؛ `EDITED` += `'11-seed-product-images.js', '29-orders-app.js'`؛ `npm run lock`.**
- [ ] **Step 4: `npm test` و`npm run e2e`** → PASS كله (بما فيه اختبارات اللوحة اللي بتقرا `OrdersApp.query` — الآن على بيانات الـ mock).
- [ ] **Step 5: Commit**

```bash
git add app tests tools/blocks.lock.json
git commit -m "feat(orders): the orders page runs on real data — hydrate from IBOrders, write-through hooks, escaped rendering, seeds removed"
```

---

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

### Task 8: الأمان والبنية — مكتبات محلية، CSP، semgrep وDeno في CI، تحديث النشاط الدوري

**Files:**
- Create: `app/js/vendor/xlsx.full.min.js`, `app/js/vendor/html2canvas.min.js`, `app/js/vendor/README.md` (امتداد بالإصدارات والمصدر والـ sha256)
- Modify: `app/js/blocks/10-ui-kit.js`, `17-page-settings.js`, `28-app.js` (سلاسل الروابط فقط → `js/vendor/…`)، `app/js/blocks/25-page-dashboard.js` (المؤقّت ينادي `window.IBActivity && IBActivity.refresh()` قبل `render()`)، `app/.htaccess` (`script-src 'self'`)، `.github/workflows/ci.yml`, `tests/split.test.mjs` (`EDITED` + 10، 17)، `tools/blocks.lock.json`, `package.json` (`"deno:check"`, `"deno:test"`, `"semgrep"` scripts)
- Test: `npm test`, `npm run e2e`, `deno check/test`, وsemgrep محليًا

**Interfaces:**
- xlsx: SheetJS أحدث إصدار من `https://cdn.sheetjs.com/xlsx-<ver>/package/dist/xlsx.full.min.js` (0.20.x؛ النسخة 0.18.5 اللي كانت من cdnjs فيها CVE-2023-30533/CVE-2024-22363)؛ html2canvas 1.4.1 من حزمة npm `html2canvas` (`dist/html2canvas.min.js`). لو تنزيل SheetJS محجوب من الـ sandbox، يتسجّل في التقرير وينزّل عبر CI (خطوة مؤقتة) أو المتحكم يقرر.
- الكتل: التغيير الوحيد في 10/17/28 هو استبدال `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` بـ `js/vendor/xlsx.full.min.js` و`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` بـ `js/vendor/html2canvas.min.js` (grep يثبت إن مافيش cdnjs باقي).
- CSP: `script-src 'self'`؛ باقي الهيدر كما هو.
- CI: job `semgrep` (`pip install semgrep`، `semgrep scan --config p/javascript --config p/secrets --severity ERROR --error --exclude app/js/blocks --exclude app/js/vendor .`) — الكتل مستثناة من البوابة لأنها كود بروتوتايب تمت مراجعته يدويًا وملاحظاته مسجّلة في الدفاتر؛ job `functions` (`denoland/setup-deno@v2` ثم `deno check` + `deno test`). job `test` يشغّل `tests/functions` ضمن `npm test` تلقائيًا.
- **قرار:** استثناء `app/js/blocks` من بوابة semgrep — ليه: `insecure-innerhtml` بيعلّم أي إسناد لـ innerHTML حتى بعد التهريب، والكتلة 29 فيها 20 — التكلفة لو غلط: ثغرة في كتلة ماتتراجعتش يدويًا (كل تعديل كتلة بيمر على مراجع).

- [ ] **Step 1:** نزّل المكتبتين، اكتب الـ README بالـ sha256، عدّل الكتل الثلاث + `.htaccess` + الكتلة 25 + `EDITED`، `npm run lock`.
- [ ] **Step 2:** ci.yml + scripts؛ شغّل semgrep محليًا (`/root/.local/bin/semgrep` موجود) بنفس أمر CI → 0 ERROR.
- [ ] **Step 3:** `npm test`, `npm run e2e` (تصدير Excel من اللوحة لو فيه اختبار؛ على الأقل الصفحة بتحمّل بدون أخطاء CSP: افحص `console` في e2e للـ `Refused to load`), `deno check`, `deno test` → PASS.
- [ ] **Step 4: Commit**

```bash
git add app .github package.json tests tools/blocks.lock.json
git commit -m "chore(security): vendored xlsx/html2canvas with script-src 'self'; semgrep and deno jobs in CI; activity card refreshes from the server"
```

---

### Task 9: التوثيق + التطبيق الحي + النشر + أول مزامنة

**Files:**
- Modify: `tools/deploy.md` (§2.1 الترتيب + `orders`, `mfa_cron`؛ §2.7 جديد: Edge Functions، الأسرار، الـ webhooks، أول مزامنة، تبديل staging → production)، `CLAUDE.md` (الكتل المعدّلة 10/11/17/18/29، `LOGGED_PREFIXES`، قاعدة «Dokan قراءة بس»)، `README.md`.
- المتحكم بعد المراجعات: (1) `apply_migration` لـ `0007_orders` ثم `0008_mfa_cron`؛ `rls_orders`/`rls_mfa` حي؛ `get_advisors`. (2) `deploy_edge_function` لـ `woo-webhook` و`woo-sync` (ملفات `index.ts` + `deno.json` + `_shared/*`). (3) `create_edge_function_secret` لكل من `WOO_URL`, `WOO_CK`, `WOO_CS`, `WOO_WEBHOOK_SECRET` — صاحب المشروع بيدخل القيم في لوحة Supabase (قيم الـ staging دلوقتي)؛ و`WOO_WP_USER`/`WOO_WP_APP_PASSWORD` اختياريين (بس لو عايز أرباح Dokan من `dokan/v1/orders`؛ من غيرهم المتاجر بتتقرا من النقطة العامّة والأرباح بتفضل `null`). (4) تسجيل الـ webhooks: نداء `woo-sync` بـ `register_webhooks` من قاعدة البيانات عبر `net.http_post` بسر Vault (execute_sql) أو من الواجهة بحساب الأدمن. (5) أول مزامنة `action:'all'` بنفس الطريقة، ثم التحقق: عدد `orders` ≈ عدد الـ probe، `vendors` = عدد المتاجر، `woo_sync_log` نظيف. (6) push → النشر التلقائي → صاحب المشروع يفتح الأوردرات ويفعّل التحقق بخطوتين من «ملفي». (7) الدفتر.

- [ ] **Step 1:** الوثائق. **Step 2:** `npm test && npm run e2e && npm run db:test && deno check/test`. **Step 3: Commit** `docs: phase 2 orders — migrations order, edge functions, secrets and webhooks runbook`. **Step 4 (المتحكم):** الخطوات الحية فوق، وتسجيل النتيجة في `.superpowers/sdd/2026-10-25-phase-2-orders/progress.md`.

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (§4.3 + §5 الصف 2):** webhooks بالتوقيع والـ idempotency ✔ (T3، T4)، مزامنة احتياطية بتكرار من الإعدادات ✔ (T7 cron 15 دقيقة؛ التغيير من الإعدادات في المرحلة 10)، النظام → Woo حسب `status_map` والاتجاه ✔ (T3، T4، T5)، Dokan قراءة بس والفرعيين عندنا ✔ (T2 القرار، T4 ignored، T6 بدون دفع)، التاريخ من 1 أكتوبر ✔ (T3)، المنتجات مرآة خفيفة بروابط صور ✔ (T2، T4، T6)، المفاتيح في أسرار Edge Functions ✔ (T9)، خريطة الحالات قابلة للتعديل (الإعدادات لاحقًا) ✔ (T2 بيانات)، الأعمدة الحساسة عبر view ✔ (T2)، كل كتابة بتسجّل حدث ✔ (T2 triggers + `activity_log` عبر البادئات)، المرتجعات ✔ (T2 `returns`)، ربط المخزن = المرحلة 5 (الكتلة 22 كما هي). البنود المحمولة: XSS ✔ (T6)، vendoring/CSP ✔ (T8)، TOTP + aal2 ✔ (T7)، semgrep CI ✔ (T8)، تحديث النشاط ✔ (T8)، `alerts.entity` كـ hash — مافيش منتج تنبيهات في المرحلة دي (المزامنة بتكتب `woo_sync_log`؛ تنبيه «فشل مزامنة» للأدمن في المرحلة 10 مع صفحة الإعدادات) — مسجّل.
- **التواقيع متسقة:** `IBOrders.*` في T5/T6؛ `OrdersApp.hydrate/applyOrder` في T5/T6؛ `woo-core` في T3/T4؛ `sync_secret_matches` في T4/T7؛ `mark_twofa_*` في T7؛ أسماء الجداول والأعمدة واحدة في T2/T4/T5 والـ mock.
- **Review Focus:** 1 في T3/T4/T2، 2 في T3، 3 في T2/T6، 4 في T6، 5 في T7.
- **النسبة:** الخطة قرارات وتواقيع واختبارات؛ الأجسام الوحيدة هي النصوص العربية الثابتة والتعريفات.
