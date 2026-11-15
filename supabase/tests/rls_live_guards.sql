-- Tests for 0105_live_guards (docs/superpowers/plans/2026-11-15-live-sync.md decisions 3 and 4 — the owner 15 Nov: «عايز امنع الكتابة
-- علي بعض»). Depends on 0001 … 0105. One transaction, rolled back; NOTICE 'rls_live_guards: ok' only if every case passed.
-- Live-safe: made-up rows; every count is scoped to them.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000105a1', 'lg-one.dev@ibtekr.local', '01000001051'),
  ('00000000-0000-4000-8000-0000000105a2', 'lg-two.dev@ibtekr.local', '01000001052');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000105a1', 'عضو أول',  'lg-one.dev@ibtekr.local', '01000001051', 'ops', 'active', '{"orders.view":"F","orders.status":"F","orders.edit":"F","accounts.view":"F","accounts.add":"F"}'),
  ('00000000-0000-4000-8000-0000000105a2', 'عضو تاني', 'lg-two.dev@ibtekr.local', '01000001052', 'ops', 'active', '{"orders.view":"F","orders.status":"F","orders.edit":"F","accounts.view":"F","accounts.add":"F"}');
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-0000000105f1', 'مبتكر الحراسة');
insert into public.orders (id, number, customer_name, status, placed_at) values
  (990105001, 'G1', 'عميل حراسة', 'جاري التنفيذ', now()), (990105002, 'G2', 'عميل حراسة', 'جاري التنفيذ', now()), (990105003, 'G3', 'عميل حراسة', 'جاري التنفيذ', now());

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- ================================================================ part 1 — orders
do $$
declare n int; rid bigint;
begin
  -- the page's own write: «update … where id and status = what I was looking at» — the first member's goes, the second's (still
  -- looking at the old status) writes no row
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  update public.orders set status = 'جاهز للشحن' where id = 990105001 and status = 'جاري التنفيذ';
  get diagnostics n = row_count; if n <> 1 then raise exception 'the first member''s change was not written'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  update public.orders set status = 'قيد الشحن' where id = 990105001 and status = 'جاري التنفيذ';
  get diagnostics n = row_count; if n <> 0 then raise exception 'a stale change was written over the first one'; end if;
  if (select status from public.orders where id = 990105001) <> 'جاهز للشحن' then raise exception 'the first member''s status is gone'; end if;
  -- the same for a note (null on the screen) and the confirmation
  update public.orders set note = 'ملاحظة العضو التاني' where id = 990105001 and note is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'a note on an untouched order was refused'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  update public.orders set note = 'ملاحظة العضو الأول' where id = 990105001 and note is null;
  get diagnostics n = row_count; if n <> 0 then raise exception 'a note was written over a teammate''s'; end if;

  -- «مكتمل» with the rating: the member who still sees «جاري التنفيذ» after a teammate completed it is refused — one rating
  rid := public.order_complete(990105002, 5, 5, null, 'جاري التنفيذ');
  if rid is null or (select status from public.orders where id = 990105002) <> 'مكتمل' then raise exception 'order_complete with p_from did not complete'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  begin
    perform public.order_complete(990105002, 4, 4, null, 'جاري التنفيذ');
    raise exception 'a second completion of the same order went through';
  exception when sqlstate 'IBSTL' then null;
  end;
  if (select count(*) from public.customer_ratings where order_id = 990105002) <> 1 then raise exception 'two ratings for one order'; end if;
  -- an unknown order with p_from; and an older page (no p_from) as before
  begin
    perform public.order_complete(990105999, 4, 4, null, 'جاري التنفيذ');
    raise exception 'an unknown order was completed';
  exception when sqlstate 'P0002' then null;
  end;
  rid := public.order_complete(990105003, 3, 3, null);
  if (select status from public.orders where id = 990105003) <> 'مكتمل' then raise exception 'order_complete without p_from changed'; end if;
  reset role;
  -- one function only (an old 4-argument one beside it would make the API unable to choose), not for anon
  if (select count(*) from pg_proc where proname = 'order_complete' and pronamespace = 'public'::regnamespace) <> 1 then raise exception 'two order_complete functions'; end if;
  if has_function_privilege('anon', 'public.order_complete(bigint, int, int, text, text)', 'execute') or not has_function_privilege('authenticated', 'public.order_complete(bigint, int, int, text, text)', 'execute') then
    raise exception 'order_complete grants';
  end if;
end $$;

do $$ begin raise notice 'rls_live_guards: ok'; end $$;
rollback;
