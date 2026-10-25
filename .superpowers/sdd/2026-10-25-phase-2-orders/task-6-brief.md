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

