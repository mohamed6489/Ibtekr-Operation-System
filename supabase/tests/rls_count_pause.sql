-- RLS / rule tests for 0107_count_pause (a count paused and resumed — comments decision 32). Depends on 0001_identity … 0107.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_count_pause: ok' only if every case passed. Live-safe: its rows
-- (two made-up members, a lot with one move, a count) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000001b1', 'cnt-ops.dev@ibtekr.local', '01000001b01'),
  ('00000000-0000-4000-8000-0000000001b2', 'cnt-ops2.dev@ibtekr.local', '01000001b02'),
  ('00000000-0000-4000-8000-0000000001b3', 'cnt-adm.dev@ibtekr.local', '01000001b03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001b2', '00000000-0000-4000-8000-0000000001b3');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000001b1', 'جرد عمليات', 'cnt-ops.dev@ibtekr.local', '01000001b01', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000001b2', 'جرد عمليات 2', 'cnt-ops2.dev@ibtekr.local', '01000001b02', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000001b3', 'جرد أدمن', 'cnt-adm.dev@ibtekr.local', '01000001b03', 'admin', 'active', '{}');

create temp table cnt_ids (k text primary key, v text) on commit drop;
grant all on cnt_ids to authenticated;

-- ================================================================ ops (inventory.edit F): starts, counts, pauses

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b1","role":"authenticated"}', true);

do $$
declare l uuid; n bigint;
begin
  insert into public.inv_lots (reason, status, sku, name, loc, cost) values ('متاح للبيع', 'متاح', 'IBT-PAUSE-01', 'قطعة جرد', 'T', 100) returning id into l;
  insert into public.inv_moves (lot_id, type, qty, label, reason) values (l, 'in', 2, 'دخول — للبيع', 'متاح للبيع');
  insert into cnt_ids values ('lot', l::text);
  -- a new count is never born paused, whatever the member sends
  insert into public.inv_counts (zone, paused_at, paused_by) values ('كل المخزن', '2020-01-01', '00000000-0000-4000-8000-0000000001b3') returning id into n;
  insert into cnt_ids values ('count', n::text);
  if (select paused_at from public.inv_counts where id = n) is not null or (select paused_by from public.inv_counts where id = n) is not null then raise exception 'case a new count is not paused failed'; end if;
  insert into public.inv_count_lines (count_id, lot_id, system, counted) values (n, l, 0, 1);
  -- pause: the server's time and the member himself — not the figures he sent
  update public.inv_counts set paused_at = '2020-01-01', paused_by = '00000000-0000-4000-8000-0000000001b3' where id = n;
  if (select paused_at from public.inv_counts where id = n) < now() - interval '1 minute' then raise exception 'case the pause is stamped with the server''s time failed'; end if;
  if (select paused_by from public.inv_counts where id = n) <> '00000000-0000-4000-8000-0000000001b1' then raise exception 'case the pause is stamped with the member failed'; end if;
  -- while it is paused nothing is counted
  begin
    update public.inv_count_lines set counted = 2 where count_id = n;
    raise exception 'case a paused count takes no counting failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inv_lots (reason, status, sku, name) values ('متاح للبيع', 'متاح', 'IBT-PAUSE-02', 'قطعة تانية') returning id into l;
    insert into public.inv_count_lines (count_id, lot_id, system) values (n, l, 0);
    raise exception 'case a paused count takes no new line failed';
  exception when insufficient_privilege then null;
  end;
  if (select counted from public.inv_count_lines where count_id = n) <> 1 then raise exception 'case the counting done before the pause is kept failed'; end if;
end $$;

-- ================================================================ another member: the stamp stays; he resumes it

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b2","role":"authenticated"}', true);
do $$
declare n bigint := (select v::bigint from cnt_ids where k = 'count');
begin
  -- a write that keeps it paused does not move the stamp to him
  update public.inv_counts set note = 'ملاحظة', paused_at = now() + interval '1 day', paused_by = '00000000-0000-4000-8000-0000000001b2' where id = n;
  if (select paused_by from public.inv_counts where id = n) <> '00000000-0000-4000-8000-0000000001b1' then raise exception 'case the pause keeps who paused it failed'; end if;
  if (select paused_at from public.inv_counts where id = n) > now() then raise exception 'case the pause keeps its time failed'; end if;
end $$;

-- ================================================================ admin: a paused count is not approved; resumed, it is

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b3","role":"authenticated"}', true);
do $$
declare n bigint := (select v::bigint from cnt_ids where k = 'count'); l uuid := (select v::uuid from cnt_ids where k = 'lot'); a int;
begin
  begin
    perform public.inv_count_approve(n);
    raise exception 'case a paused count is not approved failed';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.inv_counts where id = n) <> 'open' then raise exception 'case the paused count stays open failed'; end if;
  -- «كمّل الجرد»: the pause and who paused go
  update public.inv_counts set paused_at = null where id = n;
  if (select paused_at from public.inv_counts where id = n) is not null or (select paused_by from public.inv_counts where id = n) is not null then raise exception 'case resuming clears the pause failed'; end if;
  update public.inv_count_lines set counted = 1 where count_id = n and lot_id = l;
  -- paused again, then cancelled: a closed count is not paused
  update public.inv_counts set paused_at = now() where id = n;
  if (select paused_by from public.inv_counts where id = n) <> '00000000-0000-4000-8000-0000000001b3' then raise exception 'case a second pause is the new member''s failed'; end if;
  update public.inv_counts set paused_at = null where id = n;
  a := public.inv_count_approve(n);
  if a <> 1 then raise exception 'case the resumed count is approved failed (%)', a; end if;
  if (select paused_at from public.inv_counts where id = n) is not null then raise exception 'case an approved count is not paused failed'; end if;
  if public.inv_lot_on_hand(l) <> 1 then raise exception 'case on hand after the approval failed'; end if;
  begin
    update public.inv_counts set paused_at = now() where id = n;
    raise exception 'case a closed count cannot be paused failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_count_pause: ok'; end $$;
rollback;
