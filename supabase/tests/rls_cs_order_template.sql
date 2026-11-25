-- Tests for 0169 / 0170 (customer service's order alerts carry the card as their template — Safwat 25 Nov): after 0170 the order
-- rules that had 0169's template (or none) carry the card with the customer's name and a row per maker; an admin's own edit stays
-- (0170 run again over it). Depends on 0001 … 0170. One transaction, rolled back; NOTICE 'rls_cs_order_template: ok' only if every
-- case passed.
begin;
do $$
declare r uuid;
begin
  if exists (select 1 from public.notif_rules where element = 'orders' and type in ('confirm', 'delay', 'status')
             and coalesce(template, '') is distinct from E'{العميل} · {التليفون}\n{المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\n{المبتكرين}') then
    raise exception 'case the order rules carry the card failed'; end if;
  -- an admin's own template is not overwritten when 0170 runs again
  select id into r from public.notif_rules where element = 'orders' and type in ('confirm', 'delay', 'status') limit 1;
  if r is not null then
    update public.notif_rules set template = '{العميل} · {المبتكرين}' where id = r;
    update public.notif_rules
    set template = E'{العميل} · {التليفون}\n{المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\n{المبتكرين}'
    where element = 'orders' and type in ('confirm', 'delay', 'status')
      and (template is null or btrim(template) = ''
           or template = E'{التليفون}\n{حالة_الأوردر} · {المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\nالمتأخر: {المبتكر_المتأخر} · قابل للتأخير: {المبتكر_القابل_للتأخير}');
    if (select template from public.notif_rules where id = r) <> '{العميل} · {المبتكرين}' then raise exception 'case an admin''s edit stays failed'; end if;
  end if;
  raise notice 'rls_cs_order_template: ok';
end $$;
rollback;
