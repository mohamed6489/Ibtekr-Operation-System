### Task 4: Edge Functions — `woo-webhook` و`woo-sync` (Deno)

**Files:**
- Create: `supabase/functions/woo-webhook/index.ts`, `supabase/functions/woo-webhook/deno.json`, `supabase/functions/woo-webhook/index_test.ts`, `supabase/functions/woo-sync/index.ts`, `supabase/functions/woo-sync/deno.json`, `supabase/functions/woo-sync/index_test.ts`, `supabase/functions/_shared/db.js`
- Test: `deno check supabase/functions/**/index.ts` و`deno test --allow-env --allow-net=127.0.0.1 supabase/functions` (Deno 2.9 متسطّب محليًا؛ CI يسطّبه في Task 8).

**Interfaces:**
- Consumes: Task 3؛ env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (تلقائيين)، `WOO_URL`, `WOO_CK`, `WOO_CS`, `WOO_WEBHOOK_SECRET` (أسرار يدخلها صاحب المشروع)؛ جداول Task 2؛ Vault secret `sync_secret` (Task 7 بيولّده؛ هنا الدالة بتقراه من `vault.decrypted_secrets` عبر RPC `public.sync_secret_matches(text) → boolean` اللي Task 7 بيعرّفها — لحد ساعتها الاختبار بيحقنها).
- Produces:
  - `woo-webhook` (`verify_jwt: false`): `POST` فقط؛ يقرا الجسم الخام؛ `X-WC-Webhook-Signature` غلط/ناقص → `401 {error:'bad_signature'}` وسطر `woo_sync_log` (`kind 'webhook', result 'error'`)؛ `X-WC-Webhook-Delivery-ID` موجود قبل كده في `woo_webhook_events` → `200 {status:'duplicate'}`؛ topic `order.*`: لو `isSubOrder` → upsert `sub_orders` (`mapSubOrder`) ويتسجّل `ignored` (الحالات التشغيلية ماتتلمسش)؛ وإلا `mapOrder` → `skipped` يتسجّل `ignored`؛ غير كده upsert `orders` (مع `incomingStatus` على الحالة الحالية في DB) + `order_items` (upsert بالـ id؛ السطور اللي اختفت من Woo تتعلّم `raw.removed = true` مش تتمسح) ثم `GET {WOO_URL}/wp-json/wc/v3/orders?parent={id}` لجلب الفرعيين Dokan وupsert `sub_orders` وربط `order_items.sub_order_id` بالمبتكر؛ topic `product.*` → upsert `products` (`image_url` = `images[0].src`); أي `conflict` من `incomingStatus` يتسجّل في `woo_sync_log` بـ `result 'conflict'`؛ الرد دايمًا `200 {status:'ok'|'ignored', id}` بعد الكتابة؛ أي استثناء → `500` + سطر `error` (Woo بيعيد المحاولة).
  - `woo-sync` (`verify_jwt: false`، مصادقة داخلية): الهيدر `X-Sync-Secret` صحيح (RPC `sync_secret_matches`) → وضع النظام؛ وإلا `Authorization: Bearer <jwt مستخدم>` → عميل بالتوكن ده وفحص `rpc('has_perm', {key:'orders.status'})` = `'F'` (للدفع) أو `rpc('is_admin')` (للمزامنة والتسجيل)؛ غير كده `401`. الجسم `{ action, ...args }`:
    - `'orders'`: يسحب `wc/v3/orders?after=2026-10-01T00:00:00&modified_after={cursor}&per_page=100&page=n&orderby=modified&order=asc` لحد ما الصفحة تفضى؛ الأصليين عبر `mapOrder` والفرعيين عبر `mapSubOrder`؛ يحدّث `sync_state['orders'] = { cursor, last_run, count }`؛ سطر `woo_sync_log` بالنتيجة.
    - `'vendors'`: `dokan/v1/stores?per_page=100&page=n` → upsert `vendors` على `woo_vendor_id` (ما يلمسش `aliases`/`commission_pct` الموجودين).
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

