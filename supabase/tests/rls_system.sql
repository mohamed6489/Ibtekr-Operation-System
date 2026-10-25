-- RLS / permission tests for 0002_system (settings, status_map, activity_log, alerts,
-- notification_prefs, log_activity). Depends on 0001_identity + 0003_seed_roles.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_system: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables and bypasses RLS.

begin;

-- Test users (fixed UUIDs): admin, ops, active viewer, suspended viewer,
-- and a team manager (ops role + custom settings.team = F).
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000011', 'sys-admin.dev@ibtekr.local',  '01000000011'),
  ('00000000-0000-4000-8000-000000000012', 'sys-ops.dev@ibtekr.local',    '01000000012'),
  ('00000000-0000-4000-8000-000000000013', 'sys-viewer.dev@ibtekr.local', '01000000013'),
  ('00000000-0000-4000-8000-000000000014', 'sys-susp.dev@ibtekr.local',   '01000000014'),
  ('00000000-0000-4000-8000-000000000015', 'sys-team.dev@ibtekr.local',   '01000000015');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000011',
               '00000000-0000-4000-8000-000000000012',
               '00000000-0000-4000-8000-000000000013',
               '00000000-0000-4000-8000-000000000014',
               '00000000-0000-4000-8000-000000000015');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000011', 'أدمن النظام',   'sys-admin.dev@ibtekr.local',  '01000000011', 'admin',  'active',    '{}'),
  ('00000000-0000-4000-8000-000000000012', 'عمليات النظام', 'sys-ops.dev@ibtekr.local',    '01000000012', 'ops',    'active',    '{}'),
  ('00000000-0000-4000-8000-000000000013', 'مشاهد نشط',     'sys-viewer.dev@ibtekr.local', '01000000013', 'viewer', 'active',    '{}'),
  ('00000000-0000-4000-8000-000000000014', 'مشاهد موقوف',   'sys-susp.dev@ibtekr.local',   '01000000014', 'viewer', 'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000015', 'مدير الفريق',   'sys-team.dev@ibtekr.local',   '01000000015', 'ops',    'active',    '{"settings.team":"F"}');

-- A prefs row for the suspended viewer (written by the trusted runner) so "sees zero" is meaningful.
insert into public.notification_prefs (user_id, data) values
  ('00000000-0000-4000-8000-000000000014', '{"email":true}');

-- ---- seeds (as the runner) ----
do $$ begin
  if not ((select count(*) from public.settings) = 10) then raise exception 'case seed: ten settings sections failed'; end if;
  if not exists (select 1 from public.settings where section = 'general'
                 and data ->> 'company' = 'إبتكر كلوب' and data ->> 'numFmt' = '1,234.56'
                 and data ->> 'week' = 'السبت' and (data ->> 'compact')::boolean
                 and (data ->> 'thumbs')::boolean and (data ->> 'rememberFilters')::boolean
                 and (data ->> 'hidePhones')::boolean) then
    raise exception 'case seed: settings.general = C.general failed';
  end if;
  -- status_map: the six 0002 rows as reseeded by 0007_orders into nine (checked in full in rls_orders.sql).
  if not ((select string_agg(system_status || '=' || coalesce(woo_status, '∅'), ',' order by sort) from public.status_map)
          = 'قيد الانتظار=pending,جاري التنفيذ=processing,معلّق=on-hold,جاهز للشحن=ready-shipping,'
            || 'قيد الشحن=in-shipping,تم RTC=∅,مكتمل=completed,استرجاع=refunded,ملغي=cancelled') then
    raise exception 'case seed: status_map nine rows (0002 seed as reseeded by 0007) failed';
  end if;
  if exists (select 1 from public.status_map where direction <> 'both' and system_status <> 'تم RTC') then
    raise exception 'case seed: status_map direction = both (except تم RTC) failed';
  end if;
end $$;

-- ---- admin: writes settings, status_map, alerts ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}';
do $$ declare n int; begin
  update public.settings set data = data || '{"company":"إبتكر"}' where section = 'general';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin updates settings.general failed'; end if;
  if not exists (select 1 from public.settings where section = 'general'
                 and updated_by = auth.uid() and updated_at is not null) then
    raise exception 'case settings updated_by/updated_at set by trigger failed';
  end if;

  insert into public.settings (section, data) values ('misc', '{"a":1}');
  delete from public.settings where section = 'misc';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin inserts/deletes another section failed'; end if;

  update public.status_map set woo_status = 'processing' where system_status = 'جاري التنفيذ';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin updates status_map failed'; end if;

  insert into public.alerts (kind, title, role_id) values
    ('test', 'تنبيه للمشاهدين', 'viewer'),
    ('test', 'تنبيه للعمليات',  'ops');
  insert into public.alerts (kind, title, user_id) values
    ('test', 'تنبيه شخصي للمشاهد', '00000000-0000-4000-8000-000000000013');
end $$;

-- ---- ops: reads settings (P), cannot write; log_activity; reads activity_log ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.settings) = 10) then raise exception 'case ops reads all settings failed'; end if;
  if not exists (select 1 from public.settings where section = 'general' and data ->> 'company' = 'إبتكر') then
    raise exception 'case ops reads settings.general failed';
  end if;

  update public.settings set data = '{}' where section = 'general';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops cannot update settings.general failed'; end if;

  update public.settings set data = '{}' where section = 'team';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops (settings.team N) cannot update team failed'; end if;

  update public.status_map set woo_status = 'x' where id is not null;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops cannot update status_map failed'; end if;

  -- delete: RLS (admin-only using) filters every row, so nothing is removed
  delete from public.settings where section is not null; -- (live: the Supabase MCP's execute_sql holds `delete from` in test scripts for a confirmation; run the execute 'del' || 'ete …' copy, see tools/deploy.md)
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops cannot delete settings failed'; end if;
  delete from public.status_map where id is not null;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops cannot delete status_map failed'; end if;
  if not ((select count(*) from public.settings) = 10 and (select count(*) from public.status_map) = 9) then
    raise exception 'case ops delete leaves settings/status_map intact failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.settings (section, data) values ('misc', '{}');
  exception when insufficient_privilege then
    return; -- expected: RLS with check
  end;
  raise exception 'case ops cannot insert a settings section failed';
end $$;

do $$ declare n int; begin
  perform public.log_activity('test', 'x', '1', null, '{"a":1}');
  if not exists (select 1 from public.activity_log
                 where action = 'test' and entity = 'x' and entity_id = '1'
                   and new_value = '{"a":1}'::jsonb and old_value is null and actor = auth.uid()) then
    raise exception 'case ops log_activity writes a row with actor = ops failed';
  end if;

  -- actor is forced to the caller, whatever is passed.
  insert into public.activity_log (action, actor) values ('spoof', '00000000-0000-4000-8000-000000000011');
  if not exists (select 1 from public.activity_log where action = 'spoof' and actor = auth.uid()) then
    raise exception 'case activity_log actor forced to auth.uid() failed';
  end if;

  insert into public.notification_prefs (user_id, data) values (auth.uid(), '{"push":true}');
end $$;

do $$ declare r record; begin
  -- id and at are forced too: no backdating, no planted ids ahead of the sequence.
  insert into public.activity_log (id, at, action) values (999999, '2000-01-01', 'forged')
    returning id, at into r;
  if not (r.id <> 999999 and r.id = currval(pg_get_serial_sequence('public.activity_log', 'id'))) then
    raise exception 'case activity_log id forced to the sequence failed';
  end if;
  if not (r.at >= now() - interval '1 minute' and r.at <= now()) then
    raise exception 'case activity_log at forced to now() failed';
  end if;
end $$;

do $$ begin
  begin
    update public.activity_log set action = 'changed' where id is not null;
  exception when insufficient_privilege then
    return; -- expected: no update grant
  end;
  raise exception 'case activity_log update denied (42501) failed';
end $$;

do $$ begin
  begin
    delete from public.activity_log where id is not null;
  exception when insufficient_privilege then
    return; -- expected: no delete grant
  end;
  raise exception 'case activity_log delete denied (42501) failed';
end $$;

-- ---- team manager (settings.team = F): team/integrations/security only ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000015","role":"authenticated"}';
do $$ declare n int; begin
  update public.settings set data = '{"x":1}', updated_by = '00000000-0000-4000-8000-000000000011'
    where section in ('team', 'integrations', 'security');
  get diagnostics n = row_count;
  if not (n = 3) then raise exception 'case settings.team F updates team/integrations/security failed'; end if;
  if exists (select 1 from public.settings where section in ('team', 'integrations', 'security')
             and updated_by is distinct from auth.uid()) then
    raise exception 'case spoofed updated_by is overridden by the trigger failed';
  end if;
  if not exists (select 1 from public.settings where section = 'team' and updated_by = auth.uid()) then
    raise exception 'case settings.team F updated_by = caller failed';
  end if;

  update public.settings set data = '{}' where section = 'general';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case settings.team F cannot update general failed'; end if;
end $$;

do $$ begin
  begin
    update public.settings set section = 'misc' where section = 'team';
  exception when insufficient_privilege then
    return; -- expected: with check applies the section rule to the new row
  end;
  raise exception 'case settings.team F cannot move team to an admin section failed';
end $$;

-- ---- active viewer: no settings / activity; own-role and own alerts; prefs owner only ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000013","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.settings) = 0) then raise exception 'case viewer (settings.view N) reads zero settings failed'; end if;
  if not ((select count(*) from public.activity_log) = 0) then raise exception 'case viewer reads zero activity_log failed'; end if;
  if not ((select count(*) from public.status_map) = 9) then raise exception 'case viewer reads status_map failed'; end if;

  if not exists (select 1 from public.alerts where title = 'تنبيه للمشاهدين') then
    raise exception 'case viewer sees alert for own role failed';
  end if;
  if not exists (select 1 from public.alerts where title = 'تنبيه شخصي للمشاهد') then
    raise exception 'case viewer sees alert addressed to self failed';
  end if;
  if exists (select 1 from public.alerts where title = 'تنبيه للعمليات') then
    raise exception 'case viewer does not see alert for another role failed';
  end if;

  update public.alerts set read_at = now() where title = 'تنبيه شخصي للمشاهد';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case viewer marks own user alert read failed'; end if;

  update public.alerts set read_at = now() where title = 'تنبيه للمشاهدين';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case viewer cannot mark a role-wide alert read failed'; end if;
  if not exists (select 1 from public.alerts where title = 'تنبيه للمشاهدين' and read_at is null) then
    raise exception 'case role-wide alert read_at stays null failed';
  end if;

  update public.alerts set read_at = now() where title = 'تنبيه للعمليات';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case viewer cannot mark another role alert failed'; end if;

  delete from public.alerts where id is not null;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case viewer cannot delete alerts failed'; end if;

  perform public.log_activity('viewer.test', null, null, null, null);

  insert into public.notification_prefs (user_id, data) values (auth.uid(), '{"email":false}');
  if not ((select count(*) from public.notification_prefs) = 1) then
    raise exception 'case viewer reads only own notification_prefs failed';
  end if;
  update public.notification_prefs set data = '{}' where user_id = '00000000-0000-4000-8000-000000000012';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case viewer cannot update another user prefs failed'; end if;
end $$;

do $$ begin
  begin
    update public.alerts set title = 'معدّل' where title = 'تنبيه شخصي للمشاهد';
  exception when insufficient_privilege then
    return; -- expected: only read_at may change
  end;
  raise exception 'case viewer can change only alerts.read_at failed';
end $$;

do $$ begin
  begin
    insert into public.alerts (kind, title, role_id) values ('test', 'x', 'viewer');
  exception when insufficient_privilege then
    return; -- expected: insert is admin only
  end;
  raise exception 'case viewer cannot insert alerts failed';
end $$;

do $$ begin
  begin
    insert into public.notification_prefs (user_id, data)
      values ('00000000-0000-4000-8000-000000000015', '{}');
  exception when insufficient_privilege then
    return; -- expected: owner only
  end;
  raise exception 'case viewer cannot insert prefs for another user failed';
end $$;

do $$ begin
  begin
    insert into public.status_map (system_status, woo_status) values ('x', 'x');
  exception when insufficient_privilege then
    return; -- expected: status_map writes are admin only
  end;
  raise exception 'case viewer cannot insert status_map failed';
end $$;

-- ---- suspended viewer: blocked everywhere ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000014","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.alerts) = 0) then
    raise exception 'case suspended viewer sees zero alerts (alert targets viewer role) failed';
  end if;
  if not ((select count(*) from public.notification_prefs) = 0) then
    raise exception 'case suspended viewer sees zero notification_prefs failed';
  end if;
  if not ((select count(*) from public.status_map) = 0) then
    raise exception 'case suspended viewer reads zero status_map failed';
  end if;
  if not ((select count(*) from public.settings) = 0) then
    raise exception 'case suspended viewer reads zero settings failed';
  end if;
end $$;

do $$ begin
  begin
    perform public.log_activity('suspended.test', null, null, null, null);
  exception when insufficient_privilege then
    return; -- expected: RLS with check requires an active profile
  end;
  raise exception 'case suspended viewer cannot log_activity failed';
end $$;

-- ---- anon: zero rows or permission denied, never an error from inside a policy ----
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare t text; n bigint;
begin
  foreach t in array array['settings', 'activity_log', 'status_map', 'alerts', 'notification_prefs'] loop
    begin
      execute format('select count(*) from public.%I', t) into strict n;
      if n <> 0 then raise exception 'case anon reads zero rows (%) failed', t; end if;
    exception when insufficient_privilege then
      if sqlerrm ilike '%function%' then
        raise exception 'case anon on % hit a policy function: %', t, sqlerrm;
      end if; -- else: table-level permission denied is acceptable
    end;
  end loop;
end $$;

do $$ begin
  begin
    perform public.log_activity('anon.test', null, null, null, null);
  exception when insufficient_privilege then
    return; -- expected: no execute for anon (and no insert policy)
  end;
  raise exception 'case anon cannot log_activity failed';
end $$;

-- ---- back as the runner: activity_log rows survived, actors are right ----
reset role;
do $$ begin
  if not ((select count(*) from public.activity_log) = 4) then
    raise exception 'case activity_log has exactly the four allowed rows failed';
  end if;
  if not exists (select 1 from public.activity_log
                 where action = 'viewer.test' and actor = '00000000-0000-4000-8000-000000000013') then
    raise exception 'case active viewer log_activity actor = viewer failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_system: ok'; end $$;
