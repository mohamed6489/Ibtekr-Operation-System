### Task 3: منطق المزامنة النقي — `_shared/woo-core.js` + اختبارات Node

**Files:**
- Create: `supabase/functions/_shared/woo-core.js`, `tests/functions/woo-core.test.mjs`
- Test: `npm test`

**Interfaces:**
- Produces (ESM، بدون import من Deno أو Node، WebCrypto فقط):
  - `async verifySignature(rawBody: string, signatureHeader: string, secret: string) → boolean`: HMAC-SHA256 على الجسم الخام، Base64، مقارنة ثابتة الزمن؛ `false` لو أي قيمة فاضية.
  - `isSubOrder(wooOrder) → boolean` (`parent_id > 0`).
  - `mapOrder(wooOrder, { statusMap, vendorsByWooId, now }) → { order, items, unknownVendorIds, skipped?: reason }` (`unknownVendorIds` = أرقام مبتكرين Dokan ظهرت في الأوردر/سطوره ومش موجودة في `vendorsByWooId`، بدون تكرار — قرار «المبتكرين بيزيدوا»): `order` = صف `orders` (`id` = `wooOrder.id`، `number` = `wooOrder.number`، `customer_name` = `billing.first_name + ' ' + billing.last_name` مع trim، `customer_phone` = `billing.phone` بعد `normalizePhone` (أرقام فقط، `+20` → `0`)، `customer_city` = `shipping.city || billing.city`، `customer_address` = `address_1 + ' ' + address_2` trim، `payment_method/title`، `status` = `incomingStatus(...)`، `woo_status`, `total`, `currency`, `customer_note`, `placed_at` = `date_created_gmt + 'Z'`, `woo_updated_at`, `raw` = الـ payload من غير `billing`/`shipping` (بيتحفظوا مطموسين: `redactPII`) ومع `meta_data` **مقصوصة على قايمة مسموحة** (`META_KEEP`: أي مفتاح يبدأ بـ `_dokan_`، و`bosta_delivery_id`, `bosta_tracking_number`, `bosta_status`, `bosta_sync_status`, `wpml_language`, `_wc_order_attribution_source_type`, `_wc_order_attribution_utm_source`, `_wc_order_attribution_utm_medium`, `_wc_order_attribution_utm_campaign`؛ الباقي بيتشال مش بيتطمس — الـ staging فيه `bosta_customer_phone` و`facebook_user_identifiers_*` و`_wc_order_attribution_user_agent` في الـ meta)؛ `items` = `line_items` → صفوف `order_items` (`id` = `line_item.id`، `product_id`, `sku`, `name`, `qty` = `quantity`, `total`، `vendor_id` من `vendorsByWooId[meta السطر _dokan_vendor_id]` وإلا من `vendorsByWooId[meta الأصلي _dokan_vendor_id]` (الأصلي لمبتكر واحد شايل الـ meta بنفسه ومالوش فرعيين) لو موجود؛ `raw` السطر = السطر من غير `meta_data` إلا مفاتيح `_dokan_*`). `skipped: 'before_start'` لو `date_created < 2026-10-01`، `'draft'` لو `status in ('checkout-draft','trash')`.
  - `mapSubOrder(wooSubOrder, { vendorsByWooId }) → { sub, unknownVendorIds }` (`sub` = صف `sub_orders`؛ `unknownVendorIds` زي `mapOrder`) (`woo_order_id` = id، `order_id` = parent_id، `vendor_id` من meta `_dokan_vendor_id`، `woo_status`, `total`, `dokan_earning` من meta `_dokan_vendor_earning`/حقل `earning` لو جاي من dokan/v1 **وإلا `null`**، `commission` = `{ rate: _dokan_commission_rate, type: _dokan_commission_type, admin_fee: _dokan_admin_fee, additional_fee: _dokan_additional_fee }` مع تحويل الأرقام **وإلا `null` لو ولا مفتاح منهم موجود** — على الـ staging الفرعي شايل `_dokan_vendor_id` بس؛ `raw` بنفس قصّ الـ meta بتاع `mapOrder`).
  - `mapStore(dokanStore) → vendors row` (`woo_vendor_id` = id، `name` = `store_name`، `phone`, `email` (لو `show_email`), `status` = `enabled ? 'active' : 'inactive'`, `raw` بدون `address`/`email`).
  - `incomingStatus(wooStatus, currentSystemStatus, statusMap) → { status, result: 'ok'|'conflict'|'unchanged' }`: صف الخريطة اللي `woo_status = wooStatus` واتجاهه `both` أو `from_woo` → حالته؛ `failed` → «ملغي» (قاعدة ثابتة `WOO_FALLBACK`)؛ مش موجود → `currentSystemStatus ?? 'قيد الانتظار'` و`result: 'conflict'`.
  - `outgoingWooStatus(systemStatus, statusMap) → string|null`: `woo_status` لو الاتجاه `both` أو `from_system` و`woo_status` مش null، وإلا `null` (= مايتبعتش).
  - `nextCursor(previousIso, orders) → iso`: أكبر `date_modified_gmt` − 60 ثانية (تحسّبًا للتأخير) أو السابق.
  - `redactPII(obj) → obj` (نفس قاعدة Task 1).
  - `normalizePhone(s) → string`.
  - ثوابت: `START_DATE = '2026-10-01'`, `OPEN_WOO = ['processing','pending','on-hold']`, `WOO_FALLBACK = { failed: 'ملغي' }`.

- [ ] **Step 1: اكتب `tests/functions/woo-core.test.mjs`** بحالات: توقيع صحيح لجسم عربي (يتحسب في الاختبار بـ WebCrypto) → `true`؛ توقيع متغيّر حرف → `false`؛ سر فاضي → `false`. `isSubOrder` لـ `parent_id 0` و`181700`. `mapOrder` على payload مصغّر (من شكل Woo v3: `id 181668, number '181668', status 'processing', date_created_gmt '2026-10-19T09:12:00', billing {first_name:'سلوى', last_name:'زيتوني', phone:'+201200007052', city:'القاهرة'}, line_items [{id: 9001, product_id: 501, sku:'SC-12', name:'…', quantity:2, total:'1002.00', meta_data:[{key:'_dokan_vendor_id', value:'77'}]}]`) → `order.customer_name === 'سلوى زيتوني'`, `customer_phone === '01200007052'`, `status === 'جاري التنفيذ'`, `placed_at === '2026-10-19T09:12:00Z'`, `raw.billing` مطموس، `items[0].vendor_id === vendorsByWooId[77]`; أوردر `date_created_gmt '2026-09-30T23:59:00'` → `skipped === 'before_start'`; `status 'checkout-draft'` → `skipped === 'draft'`. `incomingStatus('on-hold', 'جاري التنفيذ', map)` → `معلّق/ok`; `('failed', null)` → `ملغي/ok`; `('weird', 'قيد الشحن')` → `قيد الشحن/conflict`; `('weird', null)` → `قيد الانتظار/conflict`; اتجاه `from_system` لحالة واردة → `unchanged`. `outgoingWooStatus('تم RTC')` → `null`; `('مكتمل')` → `'completed'`. `mapSubOrder` يطلّع `commission.rate === 40` من `'40'` و`dokan_earning` رقم، ولفرعي meta فيه `_dokan_vendor_id` بس → `dokan_earning === null` و`commission === null` و`vendor_id` صح. `mapOrder` لأصلي meta فيه `_dokan_vendor_id: '2376'` وسطوره من غير meta → `items[*].vendor_id === vendorsByWooId[2376]`؛ و`raw.meta_data` بعد القصّ فيها `bosta_tracking_number` ومافيهاش `bosta_customer_phone` ولا `facebook_user_identifiers_1374412550868003` ولا `_wc_order_attribution_user_agent`؛ `items[0].raw.meta_data` فيها مفاتيح `_dokan_*` بس. `mapStore` بـ `enabled:false` → `'inactive'`. `mapOrder` لأوردر مبتكره `2376` و`vendorsByWooId` فاضي → `unknownVendorIds` يساوي `[2376]` و`items[*].vendor_id === null`؛ ولمبتكر موجود → `[]`. `nextCursor`. `normalizePhone('+20 120-000-7052') === '01200007052'`.
- [ ] **Step 2: `npm test`** → الملف الجديد FAIL (`Cannot find module`).
- [ ] **Step 3: اكتب `woo-core.js`** (تعليق رأس بالإنجليزي يقول إنه بيتستورد من Deno وNode؛ ممنوع أي API خاص ببيئة).
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/woo-core.js tests/functions
git commit -m "feat(woo): pure sync core — webhook signature, Woo→DB mapping, status map rules, cursor"
```

---

