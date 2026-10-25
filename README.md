# Ibtekr Operation System

نظام التشغيل الداخلي لابتكر: تطبيق ويب عربي RTL (JavaScript عادي من غير build) فوق Supabase (Postgres + Auth + RLS).

**اللوحة (المرحلة 1):** شغّالة على المستخدم الحقيقي — إطار الدور من البروفايل، والتخصيص محفوظ لكل مستخدم (`user_prefs`)، وتنبيهات السيرفر في الجرس بحالة قراءة لكل واحد (`alerts` + `alert_reads`)، وكارت النشاط من `activity_log`. المؤشرات وباقي الكروت لسه على بيانات البروتوتايب لحد ما صفحاتها تتربط (المراحل 2–9).

**التشغيل محليًا** (Node 22+): `npm install` ثم `npm run serve` وافتح http://localhost:4173.
**الاختبارات:** `npm test` و`npm run e2e` (Supabase متقلّد) و`npm run db:test` (محتاج Postgres على `DATABASE_URL`).

**الوثائق:** الوثيقة في `docs/superpowers/specs/`، الخطط في `docs/superpowers/plans/`، وقواعد الشغل في `CLAUDE.md`.

**الفروع:** `main` هو فرع الدمج، والجلسات السحابية بترفع على الفرع المحدد ليها وبعدين يتدمج.
