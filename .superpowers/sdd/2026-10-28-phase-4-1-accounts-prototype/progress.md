# دفتر المرحلة 4.1 — تعديلات الحسابات من الـ prototype

الخطة: `docs/superpowers/plans/2026-10-28-phase-4-1-accounts-prototype.md`. بالتوالي، في الجلسة نفسها، من غير وكلاء.
المصدر: artifact نسخة `1793131460` (اتغيرت 02، 14، 31=28، CSS) مقارنة بـ `1793110897`.

## المهام
- [ ] DB `0020_accounts_fields` + `rls_accounts_lists`
- [ ] sync: `withdraw_approve` + tests
- [ ] الواجهة: 02، 14 (الأعمدة)، 28، 29، CSS، adapter، mock، tests، e2e، lock
- [ ] حي: 0020 → rls حي → woo-sync → main → تقرير

## التنفيذ (28 أكتوبر)
- [x] DB: `0020_accounts_fields` + `rls_accounts_lists` (محلي ok) — commit bb6fce7
- [x] sync: `withdraw_approve` (أدمن / `accounts.approve = F`، مش بسر المزامنة؛ GET ثم PUT؛ stale / not_pending /
  push_disabled؛ المرآة والرصيد) — commit 38d1b06؛ Deno 107 ناجح، deno:check ok
- [x] الواجهة: 02 (من الـ prototype + `liveSeed`، من غير `PAYOUT_TYPE` في `VENDOR_TYPES`)، 14 (`sweepColumns`/`withColumns`،
  `user_prefs` `table.cols`)، 28 (كل تعديلات الـ prototype + الموافقة على Dokan من التقرير المختصر)، CSS، adapter، mock،
  unit 272 ناجح، e2e 150 ناجح (accounts 12)، lock — commit acedc8e. صور التابلت والموبايل اتراجعت.
  اختلافات مقصودة عن الـ prototype: مافيش «تسجيل التحويل» (قرار 1)؛ الاشتراك بيظهر مرة واحدة (آخر تجديد)؛ مفتاح
  أعمدة الكارت من غير الفترة؛ عمود «الصافي» بياخد ترتيب «الرصيد الحالي» في كارت الموبايل.
- [x] حي: `0020` اتطبق (migration `accounts_fields`)؛ `rls_accounts rls_accounts_lists` حي run 13 success؛
  woo-sync v23 (طلب من غير صلاحية → 401).
- [ ] قبول الموافقة على طلب حقيقي على الـ staging — مستني صاحب المشروع (الطلب بيتوافق عليه فعلًا).
