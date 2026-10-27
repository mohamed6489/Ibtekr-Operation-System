-- 0018_orders_maker_rating: «المورد» → «المبتكر» in the sub-order statuses, and the customer rating when an order is
-- completed (phase 3.6). Uses has_perm (0001), orders / order_items / returns and order_items_log_events (0007).
-- The plan: docs/superpowers/plans/2026-10-27-phase-3-6-orders-prototype.md.
--
-- Decision 1: 'جاهز للشحن من المورد للعميل' / 'جاهز للشحن من المورد للمخزن' / 'مرتجع للمورد' become
--   'جاهز للشحن من المبتكر للعميل' / 'جاهز للشحن من المبتكر للمخزن' / 'مرتجع للمبتكر' in order_items.status (the check)
--   and in order_items_log_events (the returns row of a line sent back to its maker, kind item_to_vendor). Rows still
--   holding an old name are renamed between dropping and re-adding the check; order_events keeps its history as written.
-- Decision 3: customer_ratings — one row per rating (add-only for members): read with orders.view <> N, insert with
--   orders.status = F as oneself; order_complete(p_order, p_sat, p_manners, p_note) writes the rating and sets the order
--   «مكتمل» in one transaction (security invoker: the orders guard and the RLS decide, as for any status change).
--
-- Notes for readers:
-- * The one written drop of this migration is the check constraint order_items_status_check (a constraint, not data;
--   re-added right below — the 0012 pattern). Nothing is deleted or truncated.
-- * Re-runnable: the check is swapped only while it still names the old statuses; create table / index if not exists;
--   create or replace function; policies are created only when missing.

-- ---------------------------------------------------------------- decision 1: the sub-order statuses
do $$
declare def text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.order_items'::regclass and c.conname = 'order_items_status_check' and c.contype = 'c';
  if def is not null and def like '%المورد%' then
    -- decision 1: the one written drop of this phase (a constraint, not data; re-added right below)
    alter table public.order_items drop constraint order_items_status_check;
    def := null;
  end if;
  update public.order_items set status = case status
      when 'جاهز للشحن من المورد للعميل' then 'جاهز للشحن من المبتكر للعميل'
      when 'جاهز للشحن من المورد للمخزن' then 'جاهز للشحن من المبتكر للمخزن'
      when 'مرتجع للمورد' then 'مرتجع للمبتكر'
    end
  where status in ('جاهز للشحن من المورد للعميل', 'جاهز للشحن من المورد للمخزن', 'مرتجع للمورد');
  if def is null then
    alter table public.order_items add constraint order_items_status_check
      check (status in ('', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المبتكر للعميل',
                        'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن', 'تم الشحن للمخزن',
                        'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر'));
  end if;
end $$;

-- 0007's order_items_log_events with the new name of the line sent back to its maker
create or replace function public.order_items_log_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  src text := case when uid is null then 'woo' else 'user' end;
  d date;
begin
  insert into public.order_events (order_id, item_id, actor, source, kind, old_value, new_value)
  select new.order_id, new.id, uid, src, e.kind, e.old_value, e.new_value
  from (values
          ('item_status',      old.status,                             new.status),
          ('item_expected_at', to_char(old.expected_at, 'YYYY-MM-DD'), to_char(new.expected_at, 'YYYY-MM-DD')),
          ('item_waybill',     old.waybill::text,                      new.waybill::text),
          ('item_pulled',      old.pulled::text,                       new.pulled::text)
       ) as e (kind, old_value, new_value)
  where e.old_value is distinct from e.new_value;

  if new.status in ('مرتجع للمخزن', 'مرتجع للمبتكر') and coalesce(btrim(new.ret ->> 'reason'), '') <> ''
     and (old.status is distinct from new.status or coalesce(btrim(old.ret ->> 'reason'), '') = '') then
    begin
      d := (new.ret ->> 'date')::date;
    exception when others then
      d := null;
    end;
    insert into public.returns (order_id, item_id, kind, reason, note, on_date, by_user)
    values (new.order_id, new.id,
            case new.status when 'مرتجع للمخزن' then 'item_to_stock' else 'item_to_vendor' end,
            new.ret ->> 'reason', new.ret ->> 'note', d, uid);
  end if;
  return null;
end
$$;
revoke execute on function public.order_items_log_events() from public, anon, authenticated;

-- ---------------------------------------------------------------- decision 3: the customer rating
create table if not exists public.customer_ratings (
  id bigserial primary key,
  order_id bigint not null references public.orders on delete cascade,
  sat smallint not null check (sat between 1 and 5),
  manners smallint not null check (manners between 1 and 5),
  note text check (note is null or char_length(note) <= 500),
  by_user uuid references public.profiles default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists customer_ratings_order_idx on public.customer_ratings (order_id);

alter table public.customer_ratings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_ratings' and policyname = 'customer_ratings_select') then
    create policy customer_ratings_select on public.customer_ratings for select to authenticated
      using ((select public.has_perm('orders.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_ratings' and policyname = 'customer_ratings_insert') then
    create policy customer_ratings_insert on public.customer_ratings for insert to authenticated
      with check ((select public.has_perm('orders.status')) = 'F' and by_user = (select auth.uid()));
  end if;
end $$;

-- rule 4: explicit grants — members read and add (no update / delete); the server everything
grant select, insert on public.customer_ratings to authenticated;
grant select, insert, update, delete on public.customer_ratings to service_role;
revoke truncate, references, trigger on public.customer_ratings from anon, authenticated, service_role;
grant usage, select on sequence public.customer_ratings_id_seq to authenticated, service_role;

-- The rating and «مكتمل» together (decision 3). Invoker: the insert policy and the orders guard decide (orders.status = F).
-- 22023 for a figure outside 1–5 or a note over 500 characters; P0002 when the order is not visible / not there.
create or replace function public.order_complete(p_order bigint, p_sat int, p_manners int, p_note text default null)
returns bigint language plpgsql volatile security invoker set search_path = public as $$
declare
  v_id bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_sat is null or p_sat not between 1 and 5 or p_manners is null or p_manners not between 1 and 5 then
    raise exception 'the rating figures are 1 to 5' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the rating note is 500 characters at most' using errcode = '22023';
  end if;
  update public.orders set status = 'مكتمل' where id = p_order;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  insert into public.customer_ratings (order_id, sat, manners, note, by_user)
  values (p_order, p_sat, p_manners, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.order_complete(bigint, int, int, text) from public, anon;
grant execute on function public.order_complete(bigint, int, int, text) to authenticated, service_role;
