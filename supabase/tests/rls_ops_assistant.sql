-- 0131 (agents-brain decision 21 — the owner 18 Nov): the team «المحتوى والتصوير» is «المحتوى» with its assistant, and the built-in «stock»
-- is «التشغيل الذكي» — the team «العمليات والشحن»'s assistant that reads the orders, the makers, the requests and the warehouse; an old
-- request label still lands on the renamed team. One transaction rolled back; prints NOTICE 'rls_ops_assistant: ok'. Live-safe.
begin;
do $$
declare a public.ai_agents;
begin
  if (select name from public.roles where id = 'content') <> 'المحتوى' then raise exception 'case the content team is «المحتوى» failed'; end if;
  if (select role from public.ai_agents where id = 'content') <> 'المحتوى' then raise exception 'case its assistant follows the name failed'; end if;
  if public.ticket_label_canon('المحتوى والتصوير') <> 'المحتوى' then raise exception 'case the old label lands on the team failed'; end if;
  select * into a from public.ai_agents where id = 'stock';
  if a.name <> 'التشغيل الذكي' or a.icon <> 'truck' then raise exception 'case the operations assistant''s name and icon failed'; end if;
  if not (a.sees @> array['orders', 'vendors', 'tickets', 'inventory']::text[]) then raise exception 'case it reads the operation failed: %', a.sees; end if;
  if a.role <> (select name from public.roles where id = 'ops') then raise exception 'case it is the operations team''s assistant failed'; end if;
  if a.perm <> 'inventory.view' then raise exception 'case who sees it stays failed'; end if;
end $$;
do $$ begin raise notice 'rls_ops_assistant: ok'; end $$;
rollback;
