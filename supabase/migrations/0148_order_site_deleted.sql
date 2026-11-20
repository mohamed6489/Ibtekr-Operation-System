-- 0148 — an order deleted on the site goes from the system too (the owner 20 Nov: «خلي الأوردر اللي يتمسح من الموقع يتمسح من السيستم
-- كمان»). woo-webhook order.deleted marks it like «مسح» (deleted_at, delete_reason «اتمسح من الموقع», deleted_by null — the server). The
-- system's own «مسح» trashes the order on the site before it calls order_delete, so the site's delivery may hide the row first: order_delete
-- now also takes a row the site hid (and writes the member's reason over it) instead of answering «order not found».
create or replace function public.order_delete(p_order bigint, p_reason text)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.has_perm('orders.view') = 'N' then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if public.has_perm('orders.status') <> 'F' then
    raise exception 'orders.status = F is required to delete a cancelled order' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 120 then
    raise exception 'a delete reason of 1 to 120 characters is required' using errcode = '22023';
  end if;
  select o.status into v_status from public.orders o
   where o.id = p_order and (o.deleted_at is null or (o.deleted_by is null and o.delete_reason = 'اتمسح من الموقع'));
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'ملغي' then
    raise exception 'only a cancelled order can be deleted' using errcode = '22023';
  end if;
  update public.orders set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(), delete_reason = v_reason where id = p_order;
  return p_order;
end $$;
revoke execute on function public.order_delete(bigint, text) from public, anon;
grant execute on function public.order_delete(bigint, text) to authenticated, service_role;
