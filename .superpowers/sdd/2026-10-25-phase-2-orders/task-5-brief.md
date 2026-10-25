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

