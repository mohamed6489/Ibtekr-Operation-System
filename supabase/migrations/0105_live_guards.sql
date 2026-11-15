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
