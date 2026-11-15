-- 0105_live_guards — no overwriting each other (docs/superpowers/plans/2026-11-15-live-sync.md decisions 3 and 4).
-- The owner 15 Nov: «غيرت حالة اوردر و عضو تاني غير حالة نفس الاوردر … عايز امنع الكتابة علي بعض».
-- Part 1 — orders: the page's own writes name the value the member was looking at (update … where id = … and status = <seen>;
-- the adapter, no migration needed). «مكتمل» with the customer's rating goes through order_complete, which sets the status
-- whatever it was — two members completing the same order together left two ratings. It now takes the status the member was
-- looking at (p_from): the order is locked, and when somebody moved it first the call is refused (IBSTL) and nothing is written.
-- Without p_from (an older page) it behaves as before. Re-runnable.

-- ---------------------------------------------------------------- order_complete(p_from)
drop function if exists public.order_complete(bigint, int, int, text);
create or replace function public.order_complete(p_order bigint, p_sat int, p_manners int, p_note text default null, p_from text default null)
returns bigint language plpgsql volatile security invoker set search_path = public as $$
declare
  v_id bigint;
  v_was text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_sat is null or p_sat not between 1 and 5 or p_manners is null or p_manners not between 1 and 5 then
    raise exception 'the rating figures are 1 to 5' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the rating note is 500 characters at most' using errcode = '22023';
  end if;
  if p_from is not null then
    -- the row is held until this transaction ends: a second caller waits here, then sees «مكتمل»
    select o.status into v_was from public.orders o where o.id = p_order for update;
    if not found then
      raise exception 'order not found' using errcode = 'P0002';
    end if;
    if v_was is distinct from p_from then
      raise exception 'stale: the order is no longer on the status the member was looking at' using errcode = 'IBSTL';
    end if;
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
revoke execute on function public.order_complete(bigint, int, int, text, text) from public, anon;
grant execute on function public.order_complete(bigint, int, int, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- part 2 — the same money entry twice (decision 4)
-- The owner: «انا عملت ايداع لفيندور و ف نفس الوقت عضو تاني عمل ايداع تاني … ده ب 10 و ده ب 10 ف بالغلط اتسجل للفيندور ده 20».
-- A member's own insert into one of the three ledgers is refused (IBDUP) when the same entry — the same maker and kind / the same
-- expense type and beneficiary / the same account, with the same direction and amount — was recorded in the last 10 minutes and
-- is not voided, by anybody. The detail says who recorded it and how long ago; the page asks «دي حركة تانية؟» and sends the
-- entry again with dup_ok = true. A lock on the entry's key makes two saves in the same second wait for each other, so the
-- second one sees the first. The server's own entries (the payroll, an advance, a settlement — functions that run as their
-- owner) are not asked.
alter table public.acc_expenses      add column if not exists dup_ok boolean not null default false;
alter table public.acc_vendor_moves  add column if not exists dup_ok boolean not null default false;
alter table public.acc_account_moves add column if not exists dup_ok boolean not null default false;

-- who recorded the same entry in the last 10 minutes (null: nobody). volatile on purpose: it must see a row committed while
-- the caller waited for the lock (a stable function would read with the caller's older snapshot).
-- It reads past the row policies (the entry may be a teammate's), so it answers only what the caller could both record and
-- read himself — the ledgers' own insert and select rules (0019): accounts.add = F and accounts.view <> N, and a «المرتبات»
-- expense only with accounts.view = F. Anybody else gets null (security review: no way to probe a salary by guessing it).
create or replace function public.acc_dup_find(p_table text, p_who text, p_direction text, p_amount numeric) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_at timestamptz; v_by uuid;
begin
  if coalesce(public.has_perm('accounts.add'), 'N') <> 'F' or coalesce(public.has_perm('accounts.view'), 'N') = 'N' then return null; end if;
  if p_table = 'acc_expenses' and split_part(coalesce(p_who, ''), '|', 1) = 'المرتبات' and coalesce(public.has_perm('accounts.view'), 'N') <> 'F' then return null; end if;
  if p_table = 'acc_vendor_moves' then
    select m.created_at, m.created_by into v_at, v_by from public.acc_vendor_moves m
     where m.voided_at is null and m.created_at > now() - interval '10 minutes' and m.direction = p_direction and m.amount = p_amount
       and (m.vendor_id::text || '|' || m.kind) = p_who
     order by m.created_at desc limit 1;
  elsif p_table = 'acc_expenses' then
    select m.created_at, m.created_by into v_at, v_by from public.acc_expenses m
     where m.voided_at is null and m.created_at > now() - interval '10 minutes' and m.direction = p_direction and m.amount = p_amount
       and (m.category || '|' || coalesce(btrim(m.beneficiary), '')) = p_who
     order by m.created_at desc limit 1;
  elsif p_table = 'acc_account_moves' then
    select m.created_at, m.created_by into v_at, v_by from public.acc_account_moves m
     where m.voided_at is null and m.created_at > now() - interval '10 minutes' and m.direction = p_direction and m.amount = p_amount
       and m.account = p_who
     order by m.created_at desc limit 1;
  end if;
  if v_at is null then return null; end if;
  return jsonb_build_object('by', coalesce((select p.name from public.profiles p where p.id = v_by), ''),
                            'minutes', greatest(0, floor(extract(epoch from clock_timestamp() - v_at) / 60))::int);
end $$;
revoke execute on function public.acc_dup_find(text, text, text, numeric) from public, anon;
grant execute on function public.acc_dup_find(text, text, text, numeric) to authenticated, service_role;

-- security invoker: current_user tells a member's own insert (authenticated) from a server function's (its owner)
create or replace function public.acc_dup_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare j jsonb; v_who text; v_hit jsonb;
begin
  if current_user <> 'authenticated' then return new; end if;
  j := to_jsonb(new);
  v_who := case tg_table_name
    when 'acc_vendor_moves' then (j ->> 'vendor_id') || '|' || (j ->> 'kind')
    when 'acc_expenses' then (j ->> 'category') || '|' || coalesce(btrim(j ->> 'beneficiary'), '')
    else j ->> 'account' end;
  -- one at a time per entry: the second of two saves made together waits here until the first is committed
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || '|' || v_who || '|' || new.direction || '|' || new.amount::text, 0));
  if new.dup_ok then return new; end if;
  v_hit := public.acc_dup_find(tg_table_name::text, v_who, new.direction, new.amount);
  if v_hit is not null then
    raise exception 'duplicate: the same entry was recorded a moment ago' using errcode = 'IBDUP', detail = v_hit::text;
  end if;
  return new;
end $$;
revoke execute on function public.acc_dup_guard() from public, anon, authenticated;

drop trigger if exists acc_expenses_dup_guard on public.acc_expenses;
create trigger acc_expenses_dup_guard before insert on public.acc_expenses for each row execute function public.acc_dup_guard();
drop trigger if exists acc_vendor_moves_dup_guard on public.acc_vendor_moves;
create trigger acc_vendor_moves_dup_guard before insert on public.acc_vendor_moves for each row execute function public.acc_dup_guard();
drop trigger if exists acc_account_moves_dup_guard on public.acc_account_moves;
create trigger acc_account_moves_dup_guard before insert on public.acc_account_moves for each row execute function public.acc_dup_guard();
