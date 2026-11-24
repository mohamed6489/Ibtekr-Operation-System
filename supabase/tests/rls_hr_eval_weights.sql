-- Tests for 0155 (the meeting of 23 Nov [#41 #42] — the bonus by a weighted evaluation): the result = the weighted average of the items
-- (not rounded; an item without a score leaves the others' weights), the bonus % = the result × the point (never past 100), the items
-- per role from the settings (a role without its own list takes the team's, a bad shape the default), each evaluation keeps the rules
-- it was made with (a change reaches the new ones only; an old one is read with the current rules), every counted item needs a whole
-- score 1–5, the band's alert goes to the member's direct manager (the evaluator when none) and a new save replaces it, «ملاحظة» joins
-- the notes. Depends on 0001 … 0155. One transaction, rolled back; NOTICE 'rls_hr_eval_weights: ok' only if every case passed.
-- Live-safe: made-up members, rows and settings — all rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000155a01', 'hrw-adm.dev@ibtekr.local', '0100155a01'),
  ('00000000-0000-4000-8000-000000155a02', 'hrw-mgr.dev@ibtekr.local', '0100155a02'),
  ('00000000-0000-4000-8000-000000155a03', 'hrw-rep.dev@ibtekr.local', '0100155a03'),
  ('00000000-0000-4000-8000-000000155a04', 'hrw-ops.dev@ibtekr.local', '0100155a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'hrw-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id, manager_fixed, member_code) values
  ('00000000-0000-4000-8000-000000155a01', 'أدمن الأوزان', 'hrw-adm.dev@ibtekr.local', '0100155a01', 'admin', 'active', null, true, 'W155A'),
  ('00000000-0000-4000-8000-000000155a02', 'مدير الأوزان', 'hrw-mgr.dev@ibtekr.local', '0100155a02', 'ops', 'active', null, true, 'W155M'),
  ('00000000-0000-4000-8000-000000155a03', 'عضو الأوزان', 'hrw-rep.dev@ibtekr.local', '0100155a03', 'cs', 'active', '00000000-0000-4000-8000-000000155a02', true, 'W155R'),
  ('00000000-0000-4000-8000-000000155a04', 'عضو العمليات', 'hrw-ops.dev@ibtekr.local', '0100155a04', 'ops', 'active', null, true, 'W155O');
insert into public.hr_members (member_id, leave_days, hire_date) values
  ('00000000-0000-4000-8000-000000155a03', 21, '2025-01-01'), ('00000000-0000-4000-8000-000000155a04', 21, '2025-01-01');
insert into public.settings (section, data) values ('hr', '{}') on conflict (section) do nothing;
-- the «ops» role has its own items (the attendance at 0 = not counted); the rest of the team the default
update public.settings set data = (data - 'evalRules') || '{"evalRules": {"roles": {"ops": [{"id":"att","name":"الحضور","weight":0,"auto":true},{"id":"quality","name":"الجودة","weight":60},{"id":"speed","name":"السرعة","weight":40}]}}}' where section = 'hr';

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ the pure rules
do $$
declare d jsonb := public.hr_eval_rules_default();
begin
  -- the meeting's example: attendance 4, communication 5, performance 3 → 3.75 → 75%
  if public.hr_eval_score('{"comm":5,"perf":3}', 4, d) <> 3.75 or public.hr_eval_pct(3.75, d) <> 75 then raise exception 'case the meeting''s example 3.75 → 75%% failed'; end if;
  -- no work day: the attendance leaves its weight to the others ((5×25 + 3×50) / 75)
  if round(public.hr_eval_score('{"comm":5,"perf":3}', null, d), 4) <> 3.6667 then raise exception 'case an item without a score leaves its weight failed'; end if;
  if public.hr_eval_score('{}', 4, d) is not null then raise exception 'case the attendance alone is no evaluation failed'; end if;
  if public.hr_eval_pct(5, '{"point": 20}') <> 100 or public.hr_eval_pct(5, '{"point": 30}') <> 100 then raise exception 'case the bonus never passes 100%% failed'; end if;
  if public.hr_eval_kinds(2.49, d) <> '["warning","meeting"]' or public.hr_eval_kinds(2.5, d) <> '["note"]' or public.hr_eval_kinds(3.5, d) <> '[]'
     or public.hr_eval_kinds(4.5, d) <> '["reward"]' then raise exception 'case the bands failed'; end if;
  if public.hr_eval_items_ok('[{"id":"att","name":"الحضور","weight":30,"auto":true},{"id":"perf","name":"الأداء","weight":60}]') then raise exception 'case the weights sum to 100 failed'; end if;
  if public.hr_eval_items_ok('[{"id":"perf","name":"الأداء","weight":100,"auto":true}]') then raise exception 'case only the attendance is automatic failed'; end if;
  if public.hr_eval_items_ok('[{"id":"att","name":"الحضور","weight":100,"auto":true}]') then raise exception 'case one counted item at least failed'; end if;
  if public.hr_eval_actions_ok('[{"min":1,"kinds":[]}]') or public.hr_eval_actions_ok('[{"min":0,"kinds":["pay"]}]') then raise exception 'case the bands'' shape failed'; end if;
end $$;

-- ================================================================ the manager rates his report (default items); the alert to him
select pg_temp.as_member('00000000-0000-4000-8000-000000155a02');
do $$
declare r jsonb;
begin
  -- no attendance since hiring → 0: (0×25 + 5×25 + 3×50) / 100 = 2.75 → a note
  r := public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5,"perf":3}'::jsonb, 'تمام');
  if (r ->> 'total')::numeric <> 2.75 or (r ->> 'pct')::numeric <> 55 or r -> 'kinds' <> '["note"]' then raise exception 'case the weighted result failed (%)', r; end if;
  if (select scores from public.hr_evaluations where member_id = '00000000-0000-4000-8000-000000155a03' and month = '2026-01-01') <> '{"comm":5,"perf":3}'
     or (select rules -> 'items' -> 2 ->> 'id' from public.hr_evaluations where member_id = '00000000-0000-4000-8000-000000155a03' and month = '2026-01-01') <> 'perf' then
    raise exception 'case the evaluation keeps its scores and rules failed';
  end if;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5}'::jsonb); raise exception 'case every counted item is scored failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5,"perf":3,"x":2}'::jsonb); raise exception 'case an unknown item failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5,"perf":3.5}'::jsonb); raise exception 'case a whole score 1–5 failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5,"perf":3,"att":5}'::jsonb); raise exception 'case the attendance is never typed failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a04', '2026-01-01', '{"quality":5,"speed":5}'::jsonb); raise exception 'case a manager rates his team only failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a02', '2026-01-01', '{"comm":5,"perf":5}'::jsonb); raise exception 'case nobody rates himself failed';
  exception when insufficient_privilege then null; end;
  -- «ملاحظة» joins the notes
  perform public.hr_member_note_add('00000000-0000-4000-8000-000000155a03', 'note', '2026-01', 'ركّز على المتابعة');
  if not exists (select 1 from public.hr_notes_log where member_id = '00000000-0000-4000-8000-000000155a03' and kind = 'note') then raise exception 'case the note kind failed'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.alerts where kind = 'hr.eval.action' and user_id = '00000000-0000-4000-8000-000000155a02'
        and entity = 'hr-evals/w155r-2026-01' and body like '%ملاحظة%') <> 1 then raise exception 'case the band rings the manager failed'; end if;
  if exists (select 1 from public.alerts where kind = 'hr.eval.action' and user_id = '00000000-0000-4000-8000-000000155a03') then raise exception 'case the member never gets it failed'; end if;
end $$;

-- the admin re-rates it higher (3.75 → no action): the alert goes; then low (0.75 → warning + meeting): one alert to the manager, not the admin
select pg_temp.as_member('00000000-0000-4000-8000-000000155a01');
do $$ begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":5,"perf":5}'::jsonb); end $$;
reset role;
do $$ begin
  if exists (select 1 from public.alerts where kind = 'hr.eval.action' and entity_id like 'eval:00000000-0000-4000-8000-000000155a03:%') then raise exception 'case a new save replaces the alert failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-000000155a01');
do $$ begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a03', '2026-01-01', '{"comm":1,"perf":1}'::jsonb); end $$;
reset role;
do $$ begin
  if (select count(*) from public.alerts where kind = 'hr.eval.action' and entity_id like 'eval:00000000-0000-4000-8000-000000155a03:%') <> 1
     or (select user_id from public.alerts where kind = 'hr.eval.action' and entity_id like 'eval:00000000-0000-4000-8000-000000155a03:%') <> '00000000-0000-4000-8000-000000155a02'
     or not exists (select 1 from public.alerts where kind = 'hr.eval.action' and body like '%إنذار + ميتنج فردي%') then
    raise exception 'case the low band rings the direct manager failed';
  end if;
end $$;

-- ================================================================ the role's own items: the attendance at 0 not counted; the admin rates (no manager → the alert to him)
select pg_temp.as_member('00000000-0000-4000-8000-000000155a01');
do $$
declare r jsonb;
begin
  -- (5×60 + 2×40) / 100 = 3.8 → 76%
  r := public.hr_evaluate('00000000-0000-4000-8000-000000155a04', '2026-01-01', '{"quality":5,"speed":2}'::jsonb);
  if (r ->> 'total')::numeric <> 3.8 or (r ->> 'pct')::numeric <> 76 then raise exception 'case the role''s items failed (%)', r; end if;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-000000155a04', '2026-02-01', '{"comm":5,"perf":5}'::jsonb); raise exception 'case the role''s items are the ones asked failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ================================================================ a rules change reaches the new evaluations only; an old one (before 0155) is read with the current rules
update public.settings set data = jsonb_set(data, '{evalRules,point}', '10') where section = 'hr';
insert into public.hr_evaluations (member_id, month, performance, communication) values ('00000000-0000-4000-8000-000000155a03', '2025-12-01', 4, 4);
select pg_temp.as_member('00000000-0000-4000-8000-000000155a01');
do $$
declare v record;
begin
  select * into v from public.hr_evaluations_list('2026-01-01', '2026-01-01') l where l.member_id = '00000000-0000-4000-8000-000000155a04';
  if v.total <> 3.8 or v.pct <> 76 then raise exception 'case an evaluation keeps the rules it was made with failed (%)', row_to_json(v); end if;
  -- the old one: (0×25 + 4×25 + 4×50) / 100 = 3 → the current 10% a point = 30
  select * into v from public.hr_evaluations_list('2025-12-01', '2025-12-01') l where l.member_id = '00000000-0000-4000-8000-000000155a03';
  if v.total <> 3 or v.pct <> 30 or v.scores <> '{"comm":4,"perf":4}' then raise exception 'case an old evaluation is read with the current rules failed (%)', row_to_json(v); end if;
  -- a new one takes the new point: 3.8 × 10
  if (public.hr_evaluate('00000000-0000-4000-8000-000000155a04', '2026-02-01', '{"quality":5,"speed":2}'::jsonb) ->> 'pct')::numeric <> 38 then raise exception 'case a new evaluation takes the new rules failed'; end if;
  -- a bad shape in the settings → the default (the role's list kept)
end $$;
reset role;
update public.settings set data = jsonb_set(data, '{evalRules,items}', '[{"id":"perf","name":"الأداء","weight":70}]') where section = 'hr';
do $$ begin
  if public.hr_eval_rules_of('00000000-0000-4000-8000-000000155a03') -> 'items' <> public.hr_eval_rules_default() -> 'items' then raise exception 'case a bad shape falls back to the default failed'; end if;
  if public.hr_eval_rules_of('00000000-0000-4000-8000-000000155a04') -> 'items' -> 1 ->> 'id' <> 'quality' then raise exception 'case the role''s list stays failed'; end if;
end $$;

do $$ begin raise notice 'rls_hr_eval_weights: ok'; end $$;
rollback;
