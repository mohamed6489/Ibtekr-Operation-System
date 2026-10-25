# Ibtekr Operation System — سياق أي جلسة Claude

نظام التشغيل الداخلي لابتكر: واجهة عربي RTL (JavaScript عادي تحت `app/`) وباك إند Supabase.

## المراجع
- الوثيقة: `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md`
- الخطط: `docs/superpowers/plans/` (المرحلة صفر: `2026-10-22-phase-0-foundation.md`)
- المرحلة 1 (اللوحة): الخطة `docs/superpowers/plans/2026-10-25-phase-1-dashboard.md`، ودفترها `.superpowers/sdd/2026-10-25-phase-1-dashboard/progress.md`.
- سجل التنفيذ: `.superpowers/sdd/<plan>/progress.md` — لو هتكمّل خطة، اقراه الأول قبل أي حاجة.
- مشروع Supabase: `fsynculhaupcktzkfkdd` (eu-central-1). `app/config.js` فيه مفتاح الـ anon العام بس.

## القواعد العشر
1. الواجهة JavaScript عادي، من غير إطار عمل ومن غير build.
2. الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة، وبعد التعديل شغّل `npm run lock`. المتعدّل لحد دلوقتي: 14 و21 و25 و28 (المرحلة صفر: 14/21/28؛ المرحلة 1: 25 وإضافات صغيرة في 21 و28)، كل واحدة بقرار مكتوب في خطتها. `EDITED` في `tests/split.test.mjs` مع `tools/blocks.lock.json` بيمسكوا أي تعديل برّه القايمة دي.
3. أي كتابة بيانات لازم تعدّي على adapter (`app/js/adapter/`).
4. RLS على كل جدول، والصلاحيات بتتشيك بـ `has_perm`. وكل جدول جديد لازم له `grant` صريح لـ `authenticated`/`service_role` في الـ migration (المشروع الحي مابيمنح DML تلقائيًا؛ شوف `0004_grants.sql`، وآخر مثال `0006_dashboard.sql` — و`alert_reads` واخد `select, insert` بس بالقصد).
5. مافيش أسرار في الكود (لا service key ولا باسوردات) — الأسرار في `.env` أو GitHub Secrets.
6. عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب.
7. كل قاعدة عمل ليها اختبار.
8. قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية.
9. commit لكل مهمة.
10. ترتيب البناء = ترتيب القائمة الجانبية.

ملحوظة: لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس.

ملحوظة: `IBActivity.LOGGED_PREFIXES` في `app/js/adapter/activity.js` هي اللي بتحدد أنهي أحداث `K.logEvent` توصل `activity_log` (دلوقتي `auth.` و`dashboard.`)؛ كل مرحلة بتربط صفحة ببيانات حقيقية بتضيف البادئة بتاعتها هناك.

## أوامر التشغيل
```bash
npm install        # مرة واحدة
npm run serve      # الواجهة على http://localhost:4173
npm test           # اختبارات node:test
npm run e2e        # Playwright على Supabase متقلّد (mock)؛ E2E_SUPABASE_LIVE=1 + E2E_* للمشروع الحقيقي
npm run db:test    # الـ migrations والـ RLS tests على Postgres محلي (DATABASE_URL)
npm run lock       # بعد أي تعديل معتمد في الكتل
```
`npm run split -- --force` بس لو قاصد تعيد توليد الكتل من البروتوتايب (بيمسح تعديلات `app/js/blocks/`).

## الفروع
`main` هو فرع الدمج؛ الجلسات السحابية بترفع على الفرع المحدد ليها.
