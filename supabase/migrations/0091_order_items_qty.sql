-- 0091_order_items_qty: a product's quantity the system changed on its maker's sub-order stays here although the site's parent order
-- keeps the old one (the owner, 14 Nov 2026 — «تعديل كمية في الصب اوردر الفرعي»; the plan docs/superpowers/plans/2026-11-14-suborder-menu.md,
-- decisions 4 and 5). Uses 0007 and 0079.
--
-- woo-sync line_qty changes the quantity (and the line's value: the piece's price × the new quantity) on the Dokan sub-order only — the
-- parent of an order with sub-orders is never written (Dokan recreates its sub-orders, getdokan/dokan PR #3454 — 0079). The sync upserts
-- the parent's lines with their old quantity and value, so the server stamps the new ones in qty_set / total_set and this trigger keeps
-- them whatever the sync writes. An order of one maker is written on the site itself and mirrored from its answer — no stamp.
--
-- Members never read nor write qty_set / total_set (no column grant; the 0007 guard refuses any non-status column). Re-runnable.

alter table public.order_items add column if not exists qty_set int check (qty_set is null or qty_set between 1 and 999);
alter table public.order_items add column if not exists total_set numeric(12,2) check (total_set is null or total_set >= 0);

create or replace function public.order_items_keep_qty() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.qty_set is not null then
    new.qty := new.qty_set;
    if new.total_set is not null then new.total := new.total_set; end if;
  end if;
  return new;
end $$;
revoke execute on function public.order_items_keep_qty() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'order_items_keep_qty' and tgrelid = 'public.order_items'::regclass) then
    create trigger order_items_keep_qty before insert or update on public.order_items for each row execute function public.order_items_keep_qty();
  end if;
end $$;
