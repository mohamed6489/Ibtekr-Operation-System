-- Tests for 0162 (several elements in one alert, «فردي / تقرير» — Safwat 24 Nov): the admin saves a rule with extra elements and the
-- report mode and reads them back; a bad element, more than 5, an unknown mode are refused; an edit without `conds` keeps them; a
-- non-admin saves nothing. Depends on 0001 … 0162. One transaction, rolled back; NOTICE 'rls_notif_conds: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000162a01', 'nc-adm.dev@ibtekr.local', '0100162a01'),
  ('00000000-0000-4000-8000-000000162a02', 'nc-ops.dev@ibtekr.local', '0100162a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000162a01', 'أدمن العناصر', 'nc-adm.dev@ibtekr.local', '0100162a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000162a02', 'عمليات العناصر', 'nc-ops.dev@ibtekr.local', '0100162a02', 'ops', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000162a02","role":"authenticated"}';
do $$ begin
  begin perform public.notif_rule_save('{"name":"x"}'::jsonb); raise exception 'case a non-admin saves no rule failed'; exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000162a01","role":"authenticated"}';
do $$
declare m uuid; s uuid; r uuid; base jsonb;
begin
  m := public.notif_section_save('{"name":"قسم العناصر"}'::jsonb);
  s := public.notif_section_save(jsonb_build_object('name', 'فرعي', 'parent_id', m));
  base := jsonb_build_object('section_id', s, 'name', 'الشغل المتأخر', 'element', 'subs', 'type', 'delay', 'state', 'late', 'roles', '["admin"]'::jsonb);
  r := public.notif_rule_save(base || jsonb_build_object('mode', 'report', 'conds', '[{"element":"orders","type":"delay","state":"late"},{"element":"inventory","type":"consolidation","state":"late","param":3}]'::jsonb));
  if (select mode from public.notif_rules where id = r) <> 'report' then raise exception 'case the mode saved failed'; end if;
  if (select jsonb_array_length(conds) from public.notif_rules where id = r) <> 2 then raise exception 'case the extra elements saved failed'; end if;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'name', 'الشغل المتأخر 2'));
  if (select jsonb_array_length(conds) from public.notif_rules where id = r) <> 2 or (select mode from public.notif_rules where id = r) <> 'report' then raise exception 'case an edit without them keeps them failed'; end if;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'mode', 'single', 'conds', '[]'::jsonb));
  if (select jsonb_array_length(conds) from public.notif_rules where id = r) <> 0 or (select mode from public.notif_rules where id = r) <> 'single' then raise exception 'case an edit empties them failed'; end if;
  begin perform public.notif_rule_save(base || jsonb_build_object('mode', 'both')); raise exception 'case an unknown mode failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(base || jsonb_build_object('conds', '[{"element":"Orders!","type":"delay","state":"late"}]'::jsonb)); raise exception 'case a bad element failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(base || jsonb_build_object('conds', '[{"element":"orders","type":"delay","state":"<b>"}]'::jsonb)); raise exception 'case a state without <> failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(base || jsonb_build_object('conds', '[{"element":"orders","type":"delay","state":"late","param":"x"}]'::jsonb)); raise exception 'case a number param failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(base || jsonb_build_object('conds', (select jsonb_agg('{"element":"orders","type":"delay","state":"late"}'::jsonb) from generate_series(1, 6)))); raise exception 'case 5 at most failed'; exception when invalid_parameter_value then null; end;
  raise notice 'rls_notif_conds: ok';
end $$;
rollback;
