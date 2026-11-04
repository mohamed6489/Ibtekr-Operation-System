# دفتر المرحلة 7 — المخزون

الخطة: `docs/superpowers/plans/2026-11-04-phase-7-inventory.md`

- T0 ✓ (4 نوفمبر) الخطة + الدفتر. صاحب المشروع وافق على الـ 3 اقتراحات («تمام كمل علي المخزن»): الربط بالأوردرات دلوقتي، السحب التلقائي مقفول، كمية الموقع مقفولة وعلى «ملك ابتكر» بس.
  - المصدر: الـ artifact المحفوظ (صفحة المخزن 357 سطر، الدومين، البذرة). الكتلة 16 الحالية من الـ prototype القديم — 99 سطر مختلفين.
- T1 ✓ `0044_inventory.sql` (صلاحيات inventory.view/edit/approve، inv_locations بأماكن T/R/P/A–D، inv_lots، inv_moves إضافة بس، inv_consolidations + items، inv_counts + lines، الحارس inv_guard، RPC inv_count_approve) + `rls_inventory.sql`؛ `db:test` كله عدّى. الإعدادات = صف settings «inventory» من الصفحة (مش seed — rls_system بيعدّ الأقسام)، والافتراضي في الـ adapter: السحب التلقائي وكمية الموقع مقفولين.
- T1 (مراجعة أمنية آلية، 3 ملاحظات اتصلحت): `system` في سطر الجرد بقى من السيرفر (`inv_lot_on_hand` وقت الإدراج، وثابت بعدها)؛ الاعتماد بيحسب الفرق على الرصيد الحالي مش الرقم المحفوظ؛ سطر الجرد مابيغيرش الجرد ولا الـ lot؛ سطر التجميع لازم من نفس الأوردر والتجميع مفتوح؛ التجميع المقفول مابيتغيرش (الحالة ولا closed_*). الاختبارات اتضافت.
- T2 ✓ الكتلة 12 = `IbtekrOps` بتاع الـ v2 بالحرف (الفرق: «المبتكر» بدل «المورد» في NOTIF_TEAMS / VENDOR_RECIPIENT / SHIP_READY / ROUTES / PARTY — **ده كان باج**: من 0018 حالات «جاهز للشحن» بالمبتكر فـ `isShipReady` كان بيرجع false وبوالص الشحن ماكانتش بتتعمل). `tests/domain/inventory-domain.test.mjs` (8)؛ EDITED + lock؛ `npm test` 441، e2e 243.
