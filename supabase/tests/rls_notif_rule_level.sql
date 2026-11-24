-- Tests for 0165 (the alert's level picked by the admin — Safwat 24 Nov): saved and read back; a key left out keeps it; an unknown level is
-- refused; a changed level reaches the alerts already in the bell (meta.lv); back to null they keep theirs; a non-admin saves nothing.
-- Depends on 0001 … 0165. One transaction, rolled back; NOTICE 'rls_notif_rule_level: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000165a01', 'nl-adm.dev@ibtekr.local', '0100165a01'),
  ('00000000-0000-4000-8000-000000165a02', 'nl-ops.dev@ibtekr.local', '0100165a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000165a01', 'أدمن الأهمية', 'nl-adm.dev@ibtekr.local', '0100165a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000165a02', 'عمليات الأهمية', 'nl-ops.dev@ibtekr.local', '0100165a02', 'ops', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000165a02","role":"authenticated"}';
do $$ begin
  begin perform public.notif_rule_save('{"name":"x","level":"critical"}'::jsonb); raise exception 'case a non-admin saves nothing failed'; exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000165a01","role":"authenticated"}';
do $$
declare m uuid; s uuid; r uuid; base jsonb; adm uuid := '00000000-0000-4000-8000-000000165a01';
begin
  m := public.notif_section_save('{"name":"قسم الأهمية"}'::jsonb);
  s := public.notif_section_save(jsonb_build_object('name', 'فرعي', 'parent_id', m));
  base := jsonb_build_object('section_id', s, 'name', 'أوردر غير مؤكد', 'element', 'orders', 'type', 'confirm', 'state', 'غير مؤكد', 'roles', '["admin"]'::jsonb);
  r := public.notif_rule_save(base || '{"level":"normal"}'::jsonb);
  if (select level from public.notif_rules where id = r) <> 'normal' then raise exception 'case the level saved failed'; end if;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'name', 'أوردر غير مؤكد 2'));
  if (select level from public.notif_rules where id = r) <> 'normal' then raise exception 'case a key left out keeps it failed'; end if;
  begin perform public.notif_rule_save(base || jsonb_build_object('id', r, 'level', 'urgent')); raise exception 'case an unknown level failed'; exception when invalid_parameter_value then null; end;
  reset role;
  insert into public.alerts (at, kind, title, user_id, entity_id, rule_id, section_id, meta) values (now(), 'rule:orders.confirm', 'IB-1', adm, 'o:1', r, s, '{"lv":"normal","n":1}'::jsonb);
  set local role authenticated;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'level', 'critical'));
  reset role;
  if (select meta ->> 'lv' from public.alerts where rule_id = r) <> 'critical' then raise exception 'case the alerts follow the level failed'; end if;
  if (select (meta ->> 'n')::int from public.alerts where rule_id = r) <> 1 then raise exception 'case the rest of meta kept failed'; end if;
  set local role authenticated;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'level', ''));
  reset role;
  if (select level from public.notif_rules where id = r) is not null then raise exception 'case back to the state''s own failed'; end if;
  if (select meta ->> 'lv' from public.alerts where rule_id = r) <> 'critical' then raise exception 'case back to null keeps the alerts failed'; end if;
  raise notice 'rls_notif_rule_level: ok';
end $$;

rollback;
