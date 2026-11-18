-- 0129 — each team's assistant (docs/superpowers/plans/2026-11-17-agents-brain.md decision 10 — the owner 17 Nov: «كل فريق قدامه مساعد
-- ذكاء اصطناعي متمرن عشان يساعده في تاسكاته و ينظمها»): the new team «المحتوى والتصوير» (0128) gets its own built-in assistant, «المحتوى
-- الذكي». The rest of the decision is in the functions: the chat of any assistant with a team reads the team's open requests with the
-- member's own client (ai-content), and the bell gets each team's daily summary and late alert (notify → ai_agent_note_add) — no table.
insert into public.ai_agents (id, name, icon, perm, sees, role, about, builtin, sort)
select 'content', 'المحتوى الذكي', 'image', 'products.view', '{tickets}', r.name,
       'طلبات التصوير والمحتوى وبيانات المنتجات — مين ماسك إيه واللي اتأخر، وقايمة اللقطات والأوصاف بصوت البراند', true, 85
  from public.roles r where r.id = 'content'
on conflict (id) do nothing;
