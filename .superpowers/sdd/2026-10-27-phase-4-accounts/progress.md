# دفتر المرحلة 4 — الحسابات

الخطة: `docs/superpowers/plans/2026-10-27-phase-4-accounts.md`. بالتوالي، في الجلسة نفسها، من غير وكلاء.

## التحضير (27 أكتوبر)
- woo-sync v20 ثم v21: action `probe_dokan` (أدمن/سر المزامنة، GET على `dokan/` بس، أشكال من غير قيم، `query` مسموح
  `vendor_id`/`start_date`/`end_date`/`status`). commits abe88c5، e50f66b.
- الفحص: route index لـ `dokan/v1` و`dokan/v2`؛ `withdraw` (191–193 طلب)، `withdraw/balance` (بتاع المستخدم نفسه)،
  `stores/{id}/stats`، `vendor/reports/statement(+summary)` بـ `vendor_id`، `reports/summary`، `reverse-withdrawal/*`.
- الـ prototype: نسخة `1793110897` — تغيّرت 02، 04، 06، 10، 14، 15، 16، 17، 18، 19، 23، 31.
- ردود صاحب المشروع: السحب قراءة بس من Dokan؛ الرصيد Dokan + اللي عندنا؛ تاب التقارير مع صفحة التقارير.

## المهام
- [x] DB `0019_accounts` + `rls_accounts` (محلي: ok) — commit 2402c4d (+ `is_total` في `accounts_sales`)
- [x] sync: `accounts` + `statement` — commit e64fbd5؛ Deno 102 ناجح (3 جداد)، deno:check ok
- [x] الواجهة: 02 (من الـ prototype + `liveSeed`/`SALES_GROUPS`)، 06 (`WD_STATUS`/`wdLabel`/`accountBrief`/`openRequest`)، 28 (منطقة الحسابات من الـ prototype الجديد؛ الكتابة عبر `IBAccounts`؛ الأرقام حية؛ طلبات Dokan قراءة + كشف الحساب؛ عمود «رصيد Dokan» و«الصافي»؛ «الحسابات» برّه `SOON`)، `app/js/adapter/accounts.js`، الـ mock، `accounts.spec` (8)، unit 269 ناجح، e2e 146 ناجح، lock
- [ ] حي: 0019 → rls حي → woo-sync → تشغيلة accounts → main → تقرير
