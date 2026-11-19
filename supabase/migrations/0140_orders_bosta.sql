-- 0140 — the Bosta tracking number on the order (the owner 19 Nov: «رقم التتبع يبقي بعد شمال عنوان العميل»; plan
-- docs/superpowers/plans/2026-11-19-orders-batch.md decision 3). The site's Bosta plugin writes the order meta
-- bosta_tracking_number / bosta_status when an order is sent; the sync keeps the whole order in orders.raw (service_role
-- only), so a trigger — like orders_attribution (0052) — copies the two values into their own columns, which members read
-- (orders.view, through orders_v). Read-only: nothing here writes to the site.

alter table public.orders add column if not exists bosta_tracking text;
alter table public.orders add column if not exists bosta_state text;

-- the last value of a meta key in a Woo order (a plain string ≤ 60 characters, else null)
create or replace function public.order_meta_text(p_raw jsonb, p_key text)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(m->>'value'), 60), '')
    from jsonb_array_elements(case when jsonb_typeof(p_raw->'meta_data') = 'array' then p_raw->'meta_data' else '[]'::jsonb end)
         with ordinality as t(m, n)
   where m->>'key' = p_key and jsonb_typeof(m->'value') in ('string', 'number')
   order by n desc
   limit 1
$$;

create or replace function public.orders_bosta_set() returns trigger
language plpgsql set search_path = public as $$
begin
  new.bosta_tracking := public.order_meta_text(new.raw, 'bosta_tracking_number');
  new.bosta_state := public.order_meta_text(new.raw, 'bosta_status');
  return new;
end $$;
create or replace trigger orders_bosta before insert or update of raw on public.orders
  for each row execute function public.orders_bosta_set();

-- the orders synced before this migration
update public.orders o
   set bosta_tracking = public.order_meta_text(o.raw, 'bosta_tracking_number'),
       bosta_state = public.order_meta_text(o.raw, 'bosta_status')
 where o.raw ? 'meta_data'
   and (o.bosta_tracking, o.bosta_state) is distinct from
       (public.order_meta_text(o.raw, 'bosta_tracking_number'), public.order_meta_text(o.raw, 'bosta_status'));

revoke execute on function public.order_meta_text(jsonb, text), public.orders_bosta_set() from public, anon, authenticated;
grant execute on function public.order_meta_text(jsonb, text), public.orders_bosta_set() to service_role;

grant select (bosta_tracking, bosta_state) on public.orders to authenticated;
grant select (bosta_tracking, bosta_state), insert (bosta_tracking, bosta_state), update (bosta_tracking, bosta_state)
  on public.orders to service_role;

-- orders_v as 0033 left it + the two columns at the end
create or replace view public.orders_v with (security_invoker = true) as
select o.id, o.number, o.customer_name,
       public.order_customer_phone(o.id) as customer_phone,
       o.customer_city, o.customer_address, o.payment_method, o.payment_title, o.status, o.woo_status,
       o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.total, o.currency, o.note, o.customer_note,
       o.placed_at, o.woo_updated_at, o.cancel, o.ret, o.synced_at, o.created_at, o.updated_at,
       o.customer_state, o.bosta_tracking, o.bosta_state
from public.orders o
where o.deleted_at is null;

grant select on public.orders_v to authenticated, service_role;
