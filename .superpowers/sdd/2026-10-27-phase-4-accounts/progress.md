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
- [ ] DB `0019_accounts` + `rls_accounts`
- [ ] sync: `accounts` + `statement`
- [ ] الواجهة: 02/06/28 + adapter + mock + e2e + lock
- [ ] حي: 0019 → rls حي → woo-sync → تشغيلة accounts → main → تقرير
