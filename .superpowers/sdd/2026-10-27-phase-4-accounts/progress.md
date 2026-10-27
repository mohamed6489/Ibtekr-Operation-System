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

## مراجعة أمنية (تلقائية، بعد 672d34c) — اتصلّح في 3d1f8ce
1. `accounts_sales` كان بيقرا `vendor_rates` (الاتفاق) لسطر من غير نسبة الموقع لأي حد عنده `accounts.view` → دلوقتي للأدمن أو
   `sensitive.commission = F` بس؛ غير كده السطر من غير حصة (نفس قاعدة صفحة المبتكرين). `rls_accounts` بيغطي الحالتين.
2. `activity_log` بيتقري بـ `settings.view` (العمليات P) وده أوسع من `accounts.view = F` → «المرتبات» بتتسجل من غير المبلغ.

## الحي (27 أكتوبر)
- `0019` اتطبق (migration `accounts`) + إصلاح المراجعة (migration `accounts_sales_rate_gate` = نفس دالة `0019` في الريبو).
  cron: `woo-sync-backup */15` و`woo-sync-accounts 7 * * * *`؛ RLS true على الخمس جداول.
- `rls_accounts` حي: run 12 success.
- woo-sync v22 (accounts + statement + probe_dokan).
- أول تشغيلة `accounts` (سر المزامنة): 193 طلب سحب (approved 142، cancelled 45، pending 6؛ كلهم مربوطين بمبتكر)، 50 رصيد من 55
  متجر (الباقي في تشغيلة الساعة الجاية — offset 50)، مافيش أخطاء.
- فحص المبيعات (أكتوبر 1–27، نفس منطق `accounts_sales`): مكتمل 26 أوردر / 79,103؛ تحت التنفيذ 55 / 236,711؛ مرتجع وملغي 22 /
  218,696؛ كل السطور عليها نسبة الموقع (مافيش اعتماد على `vendor_rates`).
- [x] حي — باقي: `main` والتقرير.
