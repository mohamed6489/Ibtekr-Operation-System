# Ibtekr Operation System — سياق أي جلسة Claude

نظام التشغيل الداخلي لابتكر: واجهة عربي RTL (JavaScript عادي تحت `app/`) وباك إند Supabase.

## المراجع
- الوثيقة: `docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md`
- الخطط: `docs/superpowers/plans/` (المرحلة صفر: `2026-10-22-phase-0-foundation.md`)
- سجل التنفيذ: `.superpowers/sdd/<plan>/progress.md` — لو هتكمّل خطة، اقراه الأول قبل أي حاجة.
- مشروع Supabase: `fsynculhaupcktzkfkdd` (eu-central-1). `app/config.js` فيه مفتاح الـ anon العام بس.

## القواعد العشر
1. الواجهة JavaScript عادي، من غير إطار عمل ومن غير build.
2. الكتل تحت `app/js/blocks/` ماتتعدلش غير بقرار مكتوب في الخطة، وبعد التعديل شغّل `npm run lock`.
3. أي كتابة بيانات لازم تعدّي على adapter (`app/js/adapter/`).
4. RLS على كل جدول، والصلاحيات بتتشيك بـ `has_perm`.
5. مافيش أسرار في الكود (لا service key ولا باسوردات) — الأسرار في `.env` أو GitHub Secrets.
6. عربي RTL ولهجة مصرية في نصوص الواجهة زي البروتوتايب.
7. كل قاعدة عمل ليها اختبار.
8. قبل الرفع: `npm test` + `npm run e2e` + semgrep + مراجعة أمنية.
9. commit لكل مهمة.
10. ترتيب البناء = ترتيب القائمة الجانبية.

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
