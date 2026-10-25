### Task 9: التوثيق + التطبيق الحي + النشر + أول مزامنة

**Files:**
- Modify: `tools/deploy.md` (§2.1 الترتيب + `orders`, `mfa_cron`؛ §2.7 جديد: Edge Functions، الأسرار، الـ webhooks، أول مزامنة، تبديل staging → production)، `CLAUDE.md` (الكتل المعدّلة 10/11/17/18/29، `LOGGED_PREFIXES`، قاعدة «Dokan قراءة بس»)، `README.md`.
- المتحكم بعد المراجعات: (1) `apply_migration` لـ `0007_orders` ثم `0008_mfa_cron`؛ `rls_orders`/`rls_mfa` حي؛ `get_advisors`. (2) `deploy_edge_function` لـ `woo-webhook` و`woo-sync` (ملفات `index.ts` + `deno.json` + `_shared/*`). (3) `create_edge_function_secret` لكل من `WOO_URL`, `WOO_CK`, `WOO_CS`, `WOO_WEBHOOK_SECRET` — صاحب المشروع بيدخل القيم في لوحة Supabase (قيم الـ staging دلوقتي). (4) تسجيل الـ webhooks: نداء `woo-sync` بـ `register_webhooks` من قاعدة البيانات عبر `net.http_post` بسر Vault (execute_sql) أو من الواجهة بحساب الأدمن. (5) أول مزامنة `action:'all'` بنفس الطريقة، ثم التحقق: عدد `orders` ≈ عدد الـ probe، `vendors` = عدد المتاجر، `woo_sync_log` نظيف. (6) push → النشر التلقائي → صاحب المشروع يفتح الأوردرات ويفعّل التحقق بخطوتين من «ملفي». (7) الدفتر.

- [ ] **Step 1:** الوثائق. **Step 2:** `npm test && npm run e2e && npm run db:test && deno check/test`. **Step 3: Commit** `docs: phase 2 orders — migrations order, edge functions, secrets and webhooks runbook`. **Step 4 (المتحكم):** الخطوات الحية فوق، وتسجيل النتيجة في `.superpowers/sdd/2026-10-25-phase-2-orders/progress.md`.

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (§4.3 + §5 الصف 2):** webhooks بالتوقيع والـ idempotency ✔ (T3، T4)، مزامنة احتياطية بتكرار من الإعدادات ✔ (T7 cron 15 دقيقة؛ التغيير من الإعدادات في المرحلة 10)، النظام → Woo حسب `status_map` والاتجاه ✔ (T3، T4، T5)، Dokan قراءة بس والفرعيين عندنا ✔ (T2 القرار، T4 ignored، T6 بدون دفع)، التاريخ من 1 أكتوبر ✔ (T3)، المنتجات مرآة خفيفة بروابط صور ✔ (T2، T4، T6)، المفاتيح في أسرار Edge Functions ✔ (T9)، خريطة الحالات قابلة للتعديل (الإعدادات لاحقًا) ✔ (T2 بيانات)، الأعمدة الحساسة عبر view ✔ (T2)، كل كتابة بتسجّل حدث ✔ (T2 triggers + `activity_log` عبر البادئات)، المرتجعات ✔ (T2 `returns`)، ربط المخزن = المرحلة 5 (الكتلة 22 كما هي). البنود المحمولة: XSS ✔ (T6)، vendoring/CSP ✔ (T8)، TOTP + aal2 ✔ (T7)، semgrep CI ✔ (T8)، تحديث النشاط ✔ (T8)، `alerts.entity` كـ hash — مافيش منتج تنبيهات في المرحلة دي (المزامنة بتكتب `woo_sync_log`؛ تنبيه «فشل مزامنة» للأدمن في المرحلة 10 مع صفحة الإعدادات) — مسجّل.
- **التواقيع متسقة:** `IBOrders.*` في T5/T6؛ `OrdersApp.hydrate/applyOrder` في T5/T6؛ `woo-core` في T3/T4؛ `sync_secret_matches` في T4/T7؛ `mark_twofa_*` في T7؛ أسماء الجداول والأعمدة واحدة في T2/T4/T5 والـ mock.
- **Review Focus:** 1 في T3/T4/T2، 2 في T3، 3 في T2/T6، 4 في T6، 5 في T7.
- **النسبة:** الخطة قرارات وتواقيع واختبارات؛ الأجسام الوحيدة هي النصوص العربية الثابتة والتعريفات.
