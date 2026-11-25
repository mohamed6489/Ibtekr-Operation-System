-- Tests for 0169 (customer service's order alerts carry the new message — Safwat 25 Nov): the order rules with no template take the one
-- of the order's facts. Depends on 0001 … 0169. One transaction, rolled back; NOTICE 'rls_cs_order_template: ok' only if every case passed.
begin;
do $$
begin
  if not exists (select 1 from public.notif_rules where element = 'orders' and type in ('confirm', 'delay')) then raise notice 'rls_cs_order_template: ok'; return; end if;
  if exists (select 1 from public.notif_rules where element = 'orders' and type in ('confirm', 'delay') and coalesce(template, '') is distinct from E'{التليفون}\n{حالة_الأوردر} · {المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\nالمتأخر: {المبتكر_المتأخر} · قابل للتأخير: {المبتكر_القابل_للتأخير}') then
    raise exception 'case the order rules carry the new template failed'; end if;
  raise notice 'rls_cs_order_template: ok';
end $$;
rollback;
