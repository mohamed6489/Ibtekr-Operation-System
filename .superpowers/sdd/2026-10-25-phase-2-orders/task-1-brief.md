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

---

