# Ibtekr Operation System

نظام التشغيل الداخلي لابتكر: تطبيق ويب عربي RTL (JavaScript عادي من غير build) فوق Supabase (Postgres + Auth + RLS).

**التشغيل محليًا** (Node 22+): `npm install` ثم `npm run serve` وافتح http://localhost:4173.
**الاختبارات:** `npm test` و`npm run e2e` (Supabase متقلّد) و`npm run db:test` (محتاج Postgres على `DATABASE_URL`).

**الوثائق:** الوثيقة في `docs/superpowers/specs/`، الخطط في `docs/superpowers/plans/`، وقواعد الشغل في `CLAUDE.md`.

**الفروع:** `main` هو فرع الدمج، والجلسات السحابية بترفع على الفرع المحدد ليها وبعدين يتدمج.
