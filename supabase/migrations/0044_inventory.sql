-- 0044_inventory — phase 7 («المخزون» = Ibtekr's temporary hub «المخزن», docs/superpowers/plans/2026-11-04-phase-7-inventory.md).
-- Every piece in the hub is a lot with a reason (تجميع أوردر / مرتجع / تصوير / متاح للبيع), a status, a place and an owner mode
-- (أمانة / ملك ابتكر); its quantities come from the append-only moves (in / out / adjust / reserve / release / ship / move) —
-- nothing types a quantity by hand. Consolidations gather an order's lines (order_items) in the hub; counts compare the shelves
-- with the system and their approval writes the adjustments (inv_count_approve, inventory.approve).
-- * Permissions (decision 5): inventory.view (read), inventory.edit (receive, moves, consolidations, inspection, the photo decision,
--   a count's lines), inventory.approve (approving a count, a manual adjustment). Admin F; ops F/F/N; cs, vendors_followup, accounts,
--   viewer F/N/N.
-- * The members write lots / moves / consolidations / counts as themselves (created_by / by stamped); moves are never changed or
--   deleted; a lot is never deleted (closed_at); the settings are the settings row «inventory» (admin, the policies of 0002).
-- Re-runnable.

update public.roles r set permissions = d.perms || r.permissions
from (values
  ('admin',            '{"inventory.view":"F","inventory.edit":"F","inventory.approve":"F"}'::jsonb),
  ('ops',              '{"inventory.view":"F","inventory.edit":"F","inventory.approve":"N"}'::jsonb),
  ('cs',               '{"inventory.view":"F","inventory.edit":"N","inventory.approve":"N"}'::jsonb),
  ('vendors_followup', '{"inventory.view":"F","inventory.edit":"N","inventory.approve":"N"}'::jsonb),
  ('accounts',         '{"inventory.view":"F","inventory.edit":"N","inventory.approve":"N"}'::jsonb),
  ('viewer',           '{"inventory.view":"F","inventory.edit":"N","inventory.approve":"N"}'::jsonb)
) as d(id, perms)
where r.id = d.id and not (r.permissions ? 'inventory.view');

-- ---------------------------------------------------------------- places

create table if not exists public.inv_locations (
  code text primary key check (code ~ '^[A-Za-z0-9-]{1,12}$'),
  label text not null check (char_length(label) between 1 and 80),
  kind text not null default 'rack' check (kind in ('zone', 'rack')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
insert into public.inv_locations (code, label, kind) values
  ('T', 'منطقة التجميع', 'zone'), ('R', 'المرتجعات', 'zone'), ('P', 'التصوير', 'zone'),
  ('A', 'رف A', 'rack'), ('B', 'رف B', 'rack'), ('C', 'رف C', 'rack'), ('D', 'رف D', 'rack')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- lots

create table if not exists public.inv_lots (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (reason in ('تجميع أوردر', 'مرتجع', 'تصوير', 'متاح للبيع')),
  status text not null check (status in ('وصل المخزن', 'جاهز يطلع كامل', 'بانتظار الفحص', 'مستني تصوير', 'اتصور', 'متاح', 'محجوز لأوردر', 'راجع للمبتكر', 'تالف')),
  sku text check (sku is null or char_length(sku) <= 80),
  product_id bigint references public.products on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  vendor_id uuid references public.vendors on delete set null,
  order_id bigint references public.orders on delete set null,
  item_id bigint references public.order_items on delete set null,
  ref text check (ref is null or char_length(ref) <= 80),
  loc text references public.inv_locations (code) on update cascade,
  mode text not null default 'أمانة' check (mode in ('أمانة', 'ملك ابتكر')),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  condition text check (condition is null or condition in ('سليم', 'تغليف متضرر', 'عيب بسيط', 'ناقص', 'تالف')),
  condition_note text check (condition_note is null or char_length(condition_note) <= 500),
  note text check (note is null or char_length(note) <= 500),
  since date not null default ((now() at time zone 'Africa/Cairo')::date),
  closed_at timestamptz,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists inv_lots_sku_idx on public.inv_lots (sku) where closed_at is null;
create index if not exists inv_lots_order_idx on public.inv_lots (order_id);

-- ---------------------------------------------------------------- moves (append-only)

create table if not exists public.inv_moves (
  id bigserial primary key,
  lot_id uuid not null references public.inv_lots on delete cascade,
  type text not null check (type in ('in', 'out', 'adjust', 'reserve', 'release', 'ship', 'move')),
  qty int not null,
  label text check (label is null or char_length(label) <= 80),
  reason text check (reason is null or char_length(reason) <= 80),
  ref text check (ref is null or char_length(ref) <= 80),
  note text check (note is null or char_length(note) <= 500),
  by uuid references public.profiles default auth.uid(),
  at timestamptz not null default now(),
  check ((type = 'move' and qty = 0) or (type = 'adjust' and qty <> 0) or (type not in ('move', 'adjust') and qty > 0))
);
create index if not exists inv_moves_lot_idx on public.inv_moves (lot_id, at);

-- ---------------------------------------------------------------- consolidations

create table if not exists public.inv_consolidations (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null references public.orders on delete cascade,
  zone text references public.inv_locations (code) on update cascade,
  status text not null default 'open' check (status in ('open', 'shipped', 'partial', 'cancelled')),
  carrier text check (carrier is null or char_length(carrier) <= 60),
  since date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles
);
create unique index if not exists inv_consolidations_open_idx on public.inv_consolidations (order_id) where status = 'open';
create table if not exists public.inv_consolidation_items (
  consolidation_id uuid not null references public.inv_consolidations on delete cascade,
  item_id bigint not null references public.order_items on delete cascade,
  primary key (consolidation_id, item_id)
);

-- ---------------------------------------------------------------- counts

create table if not exists public.inv_counts (
  id bigserial primary key,
  zone text not null check (char_length(zone) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'approved', 'cancelled')),
  note text check (note is null or char_length(note) <= 500),
  started_by uuid references public.profiles default auth.uid(),
  started_at timestamptz not null default now(),
  approved_by uuid references public.profiles,
  approved_at timestamptz
);
create table if not exists public.inv_count_lines (
  count_id bigint not null references public.inv_counts on delete cascade,
  lot_id uuid not null references public.inv_lots on delete cascade,
  system int not null,
  counted int check (counted is null or counted >= 0),
  note text check (note is null or char_length(note) <= 300),
  primary key (count_id, lot_id)
);

-- the pieces on hand of a lot, from its moves only (in + adjust − out − ship; the v2's stockFromLedger)
create or replace function public.inv_lot_on_hand(p_lot uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(case type when 'in' then qty when 'adjust' then qty when 'out' then -qty when 'ship' then -qty else 0 end), 0)::int
    from public.inv_moves where lot_id = p_lot
$$;
grant execute on function public.inv_lot_on_hand(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- guards

-- a member writes as themselves; created_* / by / at are stamped; a lot's identity (reason is changeable — the photo decision
-- turns «تصوير» into «متاح للبيع»; sku / product / order / item are not)
create or replace function public.inv_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_table_name = 'inv_lots' then
      if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); new.closed_at := null;
      else
        if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.sku is distinct from old.sku
           or new.product_id is distinct from old.product_id or new.order_id is distinct from old.order_id or new.item_id is distinct from old.item_id then
          raise exception 'the identity of a lot cannot be changed' using errcode = '42501';
        end if;
        new.updated_at := now();
      end if;
    elsif tg_table_name = 'inv_moves' then
      new.by := auth.uid(); new.at := now();
      if new.type = 'adjust' and public.has_perm('inventory.approve') <> 'F' then
        raise exception 'a manual adjustment needs inventory.approve' using errcode = '42501';
      end if;
    elsif tg_table_name = 'inv_consolidations' then
      if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); new.status := 'open'; new.closed_at := null; new.closed_by := null;
      else
        if new.order_id is distinct from old.order_id or new.created_by is distinct from old.created_by then
          raise exception 'the order of a consolidation cannot be changed' using errcode = '42501';
        end if;
        if old.status <> 'open' and (new.status is distinct from old.status or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by) then
          raise exception 'a closed consolidation stays closed' using errcode = '42501';
        end if;
        if new.status <> 'open' and old.status = 'open' then new.closed_at := now(); new.closed_by := auth.uid(); end if;
      end if;
    elsif tg_table_name = 'inv_counts' then
      if tg_op = 'INSERT' then new.started_by := auth.uid(); new.started_at := now(); new.status := 'open'; new.approved_by := null; new.approved_at := null;
      elsif new.status is distinct from old.status and new.status <> 'cancelled' then
        raise exception 'a count is approved through inv_count_approve' using errcode = '42501';
      elsif old.status <> 'open' then
        raise exception 'a closed count stays closed' using errcode = '42501';
      end if;
    elsif tg_table_name = 'inv_count_lines' then
      if tg_op = 'UPDATE' and (new.count_id is distinct from old.count_id or new.lot_id is distinct from old.lot_id) then
        raise exception 'a count line keeps its count and lot' using errcode = '42501';
      end if;
      if (select status from public.inv_counts where id = new.count_id) <> 'open' then
        raise exception 'the lines of a closed count are frozen' using errcode = '42501';
      end if;
      -- the system quantity is the server's: from the moves when the line is made, never from the member
      if tg_op = 'INSERT' then new.system := public.inv_lot_on_hand(new.lot_id); else new.system := old.system; end if;
    elsif tg_table_name = 'inv_consolidation_items' then
      if not exists (select 1 from public.inv_consolidations c join public.order_items i on i.order_id = c.order_id
                      where c.id = new.consolidation_id and c.status = 'open' and i.id = new.item_id) then
        raise exception 'a line joins an open consolidation of its own order' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inv_lots_guard on public.inv_lots;
create trigger inv_lots_guard before insert or update on public.inv_lots for each row execute function public.inv_guard();
drop trigger if exists inv_moves_guard on public.inv_moves;
create trigger inv_moves_guard before insert on public.inv_moves for each row execute function public.inv_guard();
drop trigger if exists inv_consolidations_guard on public.inv_consolidations;
create trigger inv_consolidations_guard before insert or update on public.inv_consolidations for each row execute function public.inv_guard();
drop trigger if exists inv_counts_guard on public.inv_counts;
create trigger inv_counts_guard before insert or update on public.inv_counts for each row execute function public.inv_guard();
drop trigger if exists inv_consolidation_items_guard on public.inv_consolidation_items;
create trigger inv_consolidation_items_guard before insert on public.inv_consolidation_items for each row execute function public.inv_guard();
drop trigger if exists inv_count_lines_guard on public.inv_count_lines;
create trigger inv_count_lines_guard before insert or update on public.inv_count_lines for each row execute function public.inv_guard();

-- ---------------------------------------------------------------- approving a count (one transaction)

-- inventory.approve: every counted line becomes an adjust move on its lot by the difference between the count and the lot's pieces
-- on hand NOW (inv_lot_on_hand — the moves since the line was made included, never a figure a member typed), then the count is
-- approved. Returns the number of adjusted lines. A line not counted (null) is left as it is.
create or replace function public.inv_count_approve(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record; n int := 0; l record;
begin
  if public.has_perm('inventory.approve') <> 'F' then raise exception 'inventory.approve needed' using errcode = '42501'; end if;
  select * into c from public.inv_counts where id = p_id for update;
  if not found then raise exception 'count not found' using errcode = 'P0002'; end if;
  if c.status <> 'open' then raise exception 'the count is not open' using errcode = '22023'; end if;
  for l in select cl.*, public.inv_lot_on_hand(cl.lot_id) as now_on_hand from public.inv_count_lines cl where cl.count_id = p_id and cl.counted is not null loop
    if l.counted <> l.now_on_hand then
      insert into public.inv_moves (lot_id, type, qty, label, reason, ref, note, by)
      values (l.lot_id, 'adjust', l.counted - l.now_on_hand, 'تسوية جرد', 'جرد', 'CNT-' || p_id, l.note, auth.uid());
      n := n + 1;
    end if;
  end loop;
  update public.inv_counts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  return n;
end $$;
revoke execute on function public.inv_count_approve(bigint) from public, anon;
grant execute on function public.inv_count_approve(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- RLS + grants

alter table public.inv_locations enable row level security;
alter table public.inv_lots enable row level security;
alter table public.inv_moves enable row level security;
alter table public.inv_consolidations enable row level security;
alter table public.inv_consolidation_items enable row level security;
alter table public.inv_counts enable row level security;
alter table public.inv_count_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inv_locations', 'inv_lots', 'inv_moves', 'inv_consolidations', 'inv_consolidation_items', 'inv_counts', 'inv_count_lines'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_perm(''inventory.view'') <> ''N'')', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(''inventory.edit'') = ''F'')', t || '_insert', t);
    if t not in ('inv_moves', 'inv_consolidation_items') then
      execute format('drop policy if exists %I on public.%I', t || '_update', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(''inventory.edit'') = ''F'') with check (public.has_perm(''inventory.edit'') = ''F'')', t || '_update', t);
    end if;
  end loop;
  drop policy if exists inv_consolidation_items_delete on public.inv_consolidation_items;
  create policy inv_consolidation_items_delete on public.inv_consolidation_items for delete to authenticated using (
    public.has_perm('inventory.edit') = 'F' and exists (select 1 from public.inv_consolidations c where c.id = consolidation_id and c.status = 'open'));
end $$;

revoke all on public.inv_locations, public.inv_lots, public.inv_moves, public.inv_consolidations, public.inv_consolidation_items, public.inv_counts, public.inv_count_lines from anon;
grant select, insert, update on public.inv_locations, public.inv_lots, public.inv_consolidations, public.inv_counts, public.inv_count_lines to authenticated;
grant select, insert on public.inv_moves to authenticated;
grant select, insert, delete on public.inv_consolidation_items to authenticated;
grant usage, select on sequence public.inv_moves_id_seq, public.inv_counts_id_seq to authenticated;
grant select, insert, update, delete on public.inv_locations, public.inv_lots, public.inv_moves, public.inv_consolidations, public.inv_consolidation_items, public.inv_counts, public.inv_count_lines to service_role;
grant usage, select on sequence public.inv_moves_id_seq, public.inv_counts_id_seq to service_role;

-- the settings: the settings row «inventory» (admin, policies of 0002) is written from the page; with no row the adapter's defaults
-- apply — auto-pull (firstWarehouse) and the site quantity (wooSync) off until the owner opens them (decision 1 b / c).
