# Ibtekr Operation System

نظام التشغيل الداخلي لابتكر: تطبيق ويب عربي RTL (JavaScript عادي من غير build) فوق Supabase (Postgres + Auth + RLS).

**اللوحة (المرحلة 1):** شغّالة على المستخدم الحقيقي — إطار الدور من البروفايل، والتخصيص محفوظ لكل مستخدم (`user_prefs`)، وتنبيهات السيرفر في الجرس وفي «محتاج منك دلوقتي» بحالة قراءة لكل واحد (`alerts` + `alert_reads`)، وكارت النشاط من `activity_log`. المؤشرات وباقي الكروت لسه على بيانات البروتوتايب لحد ما صفحاتها تتربط (المراحل 2–9).

**الأوردرات (المرحلة 2):** صفحة الأوردرات شغّالة على بيانات حقيقية من WooCommerce من 1 أكتوبر 2026 (من الـ staging لحد التبديل للإنتاج)، بأوردراتها الفرعية (Dokan) ومنتجاتها ومبتكرينها. المزامنة بـ webhooks موقّعة ومن غير تكرار (Edge Function `woo-webhook`)، ومعاها مزامنة احتياطية كل 15 دقيقة (pg_cron → `woo-sync`). حالة الأوردر الأصلي بتتبعت للموقع حسب خريطة الحالات، وDokan قراءة بس. ومعاها: التحقق بخطوتين بتطبيق Authenticator، والسيرفر بيلزم اللي مفعّله بجلسة aal2؛ ومكتبات التصدير محلية تحت `app/js/vendor/` مع CSP `script-src 'self'`؛ وsemgrep واختبارات Deno في CI. خطوات النشر والأسرار والـ webhooks في `tools/deploy.md` §2.7.

**التشغيل محليًا** (Node 22+): `npm install` ثم `npm run serve` وافتح http://localhost:4173.
**الاختبارات:** `npm test` و`npm run e2e` (Supabase متقلّد) و`npm run db:test` (محتاج Postgres على `DATABASE_URL`)، وEdge Functions بـ `npm run deno:check` و`npm run deno:test` (Deno 2)، و`npm run semgrep` (نفس بوابة CI).

**الوثائق:** الوثيقة في `docs/superpowers/specs/`، الخطط في `docs/superpowers/plans/`، وقواعد الشغل في `CLAUDE.md`.

**الفروع:** `main` هو فرع الدمج، والجلسات السحابية بترفع على الفرع المحدد ليها وبعدين يتدمج.
