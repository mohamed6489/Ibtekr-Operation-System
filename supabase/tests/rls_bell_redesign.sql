-- Tests for 0161 (the bell's redesign — docs/superpowers/plans/2026-11-24-bell-redesign.md): a member reads `meta` on his own alerts
-- and no one else's; the rules' «تفاصيل الظهور» follow their level; the new alerts and the assistants' sub-sections are there with
-- their roles. Depends on 0001 … 0161 (and 0172 — the sub-orders' rules out). One transaction, rolled back; NOTICE 'rls_bell_redesign: ok' only if every case passed.
-- Live-safe: made-up members and alerts.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000161a01', 'bell-a.dev@ibtekr.local', '0100161a01'),
  ('00000000-0000-4000-8000-000000161a02', 'bell-b.dev@ibtekr.local', '0100161a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000161a01', 'جرس أ', 'bell-a.dev@ibtekr.local', '0100161a01', 'ops', 'active'),
  ('00000000-0000-4000-8000-000000161a02', 'جرس ب', 'bell-b.dev@ibtekr.local', '0100161a02', 'ops', 'active');
insert into public.alerts (kind, title, user_id, entity_id, meta) values
  ('rule:subs.delay', 'أوردر فرعي متأخر', '00000000-0000-4000-8000-000000161a01', 's:1:2', '{"lv":"critical","g":"vendor","gid":"v1","gname":"مبتكر","n":1,"pcs":3,"st":"late"}'),
  ('rule:subs.delay', 'أوردر فرعي متأخر', '00000000-0000-4000-8000-000000161a02', 's:1:2', '{"lv":"critical"}');

do $$ begin
  -- 0172: the sub-orders' rules are out (the element stays in the catalogue); a maker's waiting withdrawal is the state that stays
  if (select show from public.notif_rules where element = 'makers' and type = 'accounts' and state = 'withdraw_wait' limit 1) is distinct from 'until_state' then raise exception 'case a state stays till it changes failed'; end if;
  if exists (select 1 from public.notif_rules where element = 'subs') then raise exception 'case 0172 the sub-orders rules are out failed'; end if;
  if exists (select 1 from public.notif_rules where element = 'daily' and type = 'summary' and (show, hours) is distinct from ('until_read', 2)) then raise exception 'case the daily summary is info failed'; end if;
  if exists (select 1 from public.notif_rules where element = 'makers' and type = 'making' and state = 'confirmed' and (show, hours) is distinct from ('until_read', 2)) then raise exception 'case an info event goes 2 hours after read failed'; end if;
  if exists (select 1 from public.notif_rules where element = 'makers' and type = 'accounts' and state = 'withdraw' and (show, hours) is distinct from ('until_read', 6)) then raise exception 'case an important event stays till read + 6 failed'; end if;
  if (select count(*) from public.notif_rules where element = 'orders' and type = 'shipping') < 3 then raise exception 'case the shipping alerts failed'; end if;
  if not exists (select 1 from public.notif_rules where element = 'system' and type = 'links' and roles = array['admin']) then raise exception 'case the links alert is the admin''s failed'; end if;
  if not exists (select 1 from public.notif_rules where element = 'ai' and type = 'stock' and state = 'late' and roles @> array['admin', 'ops']) then raise exception 'case the operations assistant''s alerts reach its team failed'; end if;
  if (select count(distinct type) from public.notif_rules where element = 'ai' and type in ('manager', 'stock', 'cs', 'makers', 'accountant', 'hr', 'content')) <> 7 then raise exception 'case a sub-section per assistant failed'; end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000161a01","role":"authenticated"}';

do $$ begin
  if (select meta ->> 'gname' from public.alerts where entity_id = 's:1:2') is distinct from 'مبتكر' then raise exception 'case a member reads his alert''s meta failed'; end if;
  if (select count(*) from public.alerts where entity_id = 's:1:2') <> 1 then raise exception 'case a member reads no one else''s alert failed'; end if;
  begin
    update public.alerts set meta = '{}' where entity_id = 's:1:2';
    if (select meta ->> 'gname' from public.alerts where entity_id = 's:1:2') is null then raise exception 'case only the server writes meta failed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin raise notice 'rls_bell_redesign: ok'; end $$;
rollback;
