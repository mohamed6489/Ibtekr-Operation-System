# دفتر المرحلة 9.5 — التسويق

الخطة: `docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md`

- T0 ✓ (6 نوفمبر) الخطة + الدفتر. المصدر: صفحة التسويق في الـ v5 (artifact «نظام إبتكر»): الدومين `IbtekrCampWiz` + الصفحة (7 تابات، الكامبين 4 خطوات، سجل النشر، الخطة الإعلانية، القوالب). قرارات صاحب المشروع 1–3 (ميتا دلوقتي وتيك توك وجوجل قريب، الترتيب 9.5.1 → 9.5.2 → 9.5.3، الفيديو بعدين) وقرارات التنفيذ 4–20.
- T1 ✓ (6 نوفمبر) `app/js/pages/marketing-domain.js` = دومين الـ v5 (`IbtekrCampWiz`) + قواعدنا: `PRICE_DEMO = false` (كريدت الموديل الحقيقي)، `TEXT_FILL = 0` (الكتابة بالـ AI من سقف المحتوى)، `VIDEO_SOON` (العدد صفر والكود فاضل)، حالة الكامبين (`campaignStatus`)، بنود الجدول (`scheduleItems` — قطعة × منصة)، `moveCheck` بتوقيت القاهرة، خطة الـ ZIP، أسابيع الخطة الإعلانية (`planDefault` زي الـ v5)، و`linkKeys` (لينك منتج أو SKU). `tests/domain/marketing-domain.test.mjs` 14 ok.
