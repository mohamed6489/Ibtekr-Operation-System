-- 0131 — two of the owner's 18 Nov asks (docs/superpowers/plans/2026-11-17-agents-brain.md decision 21):
-- 1) «خلي المحتوي و التصوير يبقي اسمها المحتوى بس»: the team «المحتوى والتصوير» (0128) is «المحتوى» — the same move role_update makes
--    (its open requests and its assistant follow the name); the old fixed label still lands on it (ticket_label_canon by id). Only while
--    the name is still the shipped one (an admin's own rename stays).
-- 2) «المخزن الذكي ده هنخلي اسمه التشغيل الذكي … بيعمل حاجات التشغيل و العمليات و ادارة المخزون»: the built-in assistant «stock» is
--    «التشغيل الذكي» — the truck icon, it reads the orders (and their sub-orders' delay), the makers, the team's open requests and the
--    warehouse, and it is the team «العمليات والشحن»'s assistant (0129: the team's requests in its chat, its daily summary in the bell).
--    Its id stays «stock» (its chats, rules and notes keep pointing at it); its page permission stays inventory.view. Only the fields an
--    admin has not changed from the shipped ones are moved.
-- Re-runnable.

do $$
declare v_old text;
begin
  select name into v_old from public.roles where id = 'content';
  if v_old = 'المحتوى والتصوير' and not exists (select 1 from public.roles where id <> 'content' and lower(btrim(name)) = 'المحتوى') then
    update public.roles set name = 'المحتوى' where id = 'content';
    update public.tickets set assignee_role = 'المحتوى' where assignee_role = v_old;
    update public.ai_agents set role = 'المحتوى' where role = v_old;
  end if;
end $$;

update public.ai_agents set name = 'التشغيل الذكي' where id = 'stock' and name = 'المخزن الذكي';
update public.ai_agents set icon = 'truck' where id = 'stock' and icon = 'tag';
update public.ai_agents set about = 'الأوردرات والشحن والمتأخر والمخزن والتجميع والمرتجعات وشغل فريق العمليات — ورفع المنتجات'
 where id = 'stock' and about = 'القطع اللي في المخزن والتجميع والمرتجعات والأوردرات اللي مستنية';
update public.ai_agents set sees = array['orders', 'vendors', 'tickets', 'inventory']::text[]
 where id = 'stock' and sees = array['inventory', 'orders']::text[];
update public.ai_agents set role = (select name from public.roles where id = 'ops')
 where id = 'stock' and (role is null or role in ('اللوجستيك والشحن'));
