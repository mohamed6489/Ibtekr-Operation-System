-- 0155 — the meeting of 23 Nov [#41 #42] (docs/superpowers/plans/2026-11-23-meeting.md phase 7): the bonus by a weighted evaluation.
-- · The evaluation is items out of 5 with weights (Safwat 24 Nov — «لكل دور بنوده»): settings «hr».evalRules = { items, roles: { <role>:
--   items }, point, actions } — items [{ id, name, weight, auto? }] summing to 100 (the attendance «att» the only automatic one — its weight
--   0 = not counted); a role without its own list takes «items»; nothing set = the meeting's default: الحضور 25 · التواصل 25 · الأداء 50.
-- · The month's result = the weighted average of the scored items, not rounded (an item without a score — the attendance with no work
--   day, an old month without the new items — leaves the weights of the rest). The bonus % = the result × «point» (20% a point by
--   default, 1–20 so it never passes 100%) of the month's holdback; the months summed and paid with the quarter's third month (as before).
-- · Each evaluation keeps the rules it was made with (`rules`) — a change in the settings reaches the new evaluations only; an old one
--   (before this migration, rules null) is read with the current rules (Safwat 24 Nov — «بالقاعدة الجديدة») through its performance /
--   communication columns.
-- · After a save the result's band («actions»: the default — under 2.5 warning + meeting · 2.5 a note · 3.5 nothing · 4.5 a reward) rings
--   the member's direct manager (or the evaluator when he has none) with the suggested action; the alert opens the evaluation and its ⋮
--   prefilled — no money moves by itself (Safwat 24 Nov — «تنبيه للمدير بالإجراء جاهز»).
-- · «ملاحظة» joins hr_notes_log's kinds (the note on the member's profile — «ملفي › أدائي»).
-- Re-runnable.

alter table public.hr_evaluations alter column performance drop not null;
alter table public.hr_evaluations alter column communication drop not null;
alter table public.hr_evaluations add column if not exists scores jsonb check (scores is null or jsonb_typeof(scores) = 'object');
alter table public.hr_evaluations add column if not exists rules jsonb check (rules is null or jsonb_typeof(rules) = 'object');

-- ---------------------------------------------------------------- the rules

create or replace function public.hr_eval_rules_default() returns jsonb
language sql immutable set search_path = public as $$
  select '{"items":[{"id":"att","name":"الحضور","weight":25,"auto":true},{"id":"comm","name":"التواصل","weight":25},{"id":"perf","name":"الأداء","weight":50}],"point":20,"actions":[{"min":0,"kinds":["warning","meeting"]},{"min":2.5,"kinds":["note"]},{"min":3.5,"kinds":[]},{"min":4.5,"kinds":["reward"]}]}'::jsonb
$$;

-- a list of items: 1–12, ids [a-z][a-z0-9_]* unique, names 1–40 without <>, weights 0–100 summing to 100, «auto» only on «att»
create or replace function public.hr_eval_items_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare i jsonb; v_ids text[] := '{}'; v_sum numeric := 0; v_id text; v_name text; v_w numeric; v_manual int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 12 then return false; end if;
  for i in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(i) <> 'object' or jsonb_typeof(i -> 'weight') <> 'number' then return false; end if;
    v_id := i ->> 'id'; v_name := btrim(coalesce(i ->> 'name', '')); v_w := (i ->> 'weight')::numeric;
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,23}$' or v_id = any(v_ids) then return false; end if;
    if char_length(v_name) not between 1 and 40 or v_name ~ '[<>]' then return false; end if;
    if v_w < 0 or v_w > 100 then return false; end if;
    if coalesce(i ->> 'auto', 'false') = 'true' and v_id <> 'att' then return false; end if;
    if v_id = 'att' and coalesce(i ->> 'auto', 'false') <> 'true' then return false; end if;
    if v_id <> 'att' and v_w > 0 then v_manual := v_manual + 1; end if;
    v_ids := v_ids || v_id; v_sum := v_sum + v_w;
  end loop;
  return v_sum = 100 and v_manual >= 1;
end $$;

-- the bands: 1–8, the first from 0, the «min» rising (0–5), the kinds out of warning / meeting / note / reward
create or replace function public.hr_eval_actions_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare i jsonb; v_prev numeric := -1; v_n int := 0; v_min numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 8 then return false; end if;
  for i in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(i) <> 'object' or jsonb_typeof(i -> 'min') <> 'number' or jsonb_typeof(i -> 'kinds') <> 'array' then return false; end if;
    v_min := (i ->> 'min')::numeric;
    if (v_n = 0 and v_min <> 0) or v_min <= v_prev or v_min > 5 then return false; end if;
    if exists (select 1 from jsonb_array_elements_text(i -> 'kinds') k where k not in ('warning', 'meeting', 'note', 'reward')) then return false; end if;
    v_prev := v_min; v_n := v_n + 1;
  end loop;
  return true;
end $$;

-- the rules a member's evaluation is made with now: his primary role's items, else the team's, else the default; a shape the server
-- does not accept falls back to the default (the settings page checks it before saving)
create or replace function public.hr_eval_rules_of(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce((select s.data -> 'evalRules' from public.settings s where s.section = 'hr'), '{}'::jsonb);
  d jsonb := public.hr_eval_rules_default(); v_role text; v_items jsonb; v_point numeric := 20;
begin
  if jsonb_typeof(v) <> 'object' then v := '{}'::jsonb; end if;
  select p.role_id into v_role from public.profiles p where p.id = p_member;
  v_items := case when v_role is not null and public.hr_eval_items_ok(v -> 'roles' -> v_role) then v -> 'roles' -> v_role
                  when public.hr_eval_items_ok(v -> 'items') then v -> 'items' else d -> 'items' end;
  if jsonb_typeof(v -> 'point') = 'number' and (v ->> 'point')::numeric between 1 and 20 then v_point := (v ->> 'point')::numeric; end if;
  return jsonb_build_object('items', v_items, 'point', v_point,
    'actions', case when public.hr_eval_actions_ok(v -> 'actions') then v -> 'actions' else d -> 'actions' end);
end $$;
revoke execute on function public.hr_eval_rules_of(uuid) from public, anon;
grant execute on function public.hr_eval_rules_of(uuid) to authenticated, service_role;

-- the result out of 5: the weighted average of the items that have a score (the attendance from p_att), not rounded; null when no
-- item but the attendance has one (the month is not rated)
create or replace function public.hr_eval_score(p_scores jsonb, p_att numeric, p_rules jsonb) returns numeric
language sql immutable set search_path = public as $$
  select case when count(*) filter (where not x.auto) = 0 or sum(x.w) = 0 then null else round(sum(x.w * x.v) / sum(x.w), 4) end
  from (
    select (i ->> 'weight')::numeric w, coalesce(i ->> 'auto', 'false') = 'true' auto,
      case when coalesce(i ->> 'auto', 'false') = 'true' then p_att
           when jsonb_typeof(p_scores -> (i ->> 'id')) = 'number' then (p_scores ->> (i ->> 'id'))::numeric end v
    from jsonb_array_elements(coalesce(p_rules -> 'items', '[]'::jsonb)) i
  ) x
  where x.w > 0 and x.v is not null
$$;

-- the bonus % of the month's holdback: the result × the point, never past 100
create or replace function public.hr_eval_pct(p_total numeric, p_rules jsonb) returns numeric
language sql immutable set search_path = public as $$
  select case when p_total is null then null
    else least(100, round(p_total * coalesce(nullif(p_rules ->> 'point', '')::numeric, 20), 2)) end
$$;

-- the band's kinds of a result
create or replace function public.hr_eval_kinds(p_total numeric, p_rules jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce((select a -> 'kinds' from jsonb_array_elements(coalesce(p_rules -> 'actions', '[]'::jsonb)) with ordinality t(a, n)
                   where p_total is not null and (a ->> 'min')::numeric <= p_total order by t.n desc limit 1), '[]'::jsonb)
$$;

revoke execute on function public.hr_eval_rules_default(), public.hr_eval_items_ok(jsonb), public.hr_eval_actions_ok(jsonb),
  public.hr_eval_score(jsonb, numeric, jsonb), public.hr_eval_pct(numeric, jsonb), public.hr_eval_kinds(numeric, jsonb) from public, anon;
grant execute on function public.hr_eval_rules_default(), public.hr_eval_items_ok(jsonb), public.hr_eval_actions_ok(jsonb),
  public.hr_eval_score(jsonb, numeric, jsonb), public.hr_eval_pct(numeric, jsonb), public.hr_eval_kinds(numeric, jsonb) to authenticated, service_role;

-- an evaluation's scores: the new ones as they are, an old one's two columns
create or replace function public.hr_eval_scores_of(p_scores jsonb, p_perf smallint, p_comm smallint) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(p_scores, jsonb_strip_nulls(jsonb_build_object('perf', p_perf, 'comm', p_comm)))
$$;
revoke execute on function public.hr_eval_scores_of(jsonb, smallint, smallint) from public, anon;
grant execute on function public.hr_eval_scores_of(jsonb, smallint, smallint) to authenticated, service_role;

-- ---------------------------------------------------------------- the list (the new columns: scores, rules, the bonus %)

drop function if exists public.hr_evaluations_list(date, date);
create function public.hr_evaluations_list(p_from date, p_to date)
returns table (member_id uuid, month date, attendance numeric, performance smallint, communication smallint, total numeric, note text,
  rated_by uuid, rated_at timestamptz, scores jsonb, rules jsonb, pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_from)::date; v_to date := least(date_trunc('month', p_to)::date, date_trunc('month', public.hr_today())::date);
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_from is null or v_to is null or v_from > v_to or v_to - v_from > 740 then raise exception 'invalid: range' using errcode = '22023'; end if;
  return query
  select p.id, g.m::date, s.att, e.performance, e.communication, t.total, e.note, e.rated_by, e.rated_at,
         case when e.member_id is null then null else public.hr_eval_scores_of(e.scores, e.performance, e.communication) end,
         r.rules, public.hr_eval_pct(t.total, r.rules)
  from public.profiles p
  cross join lateral (select public.hr_eval_rules_of(p.id) as now_rules) cr
  cross join lateral generate_series(v_from, v_to, interval '1 month') g(m)
  cross join lateral (select public.hr_att_score(p.id, g.m::date) as att) s
  left join public.hr_evaluations e on e.member_id = p.id and e.month = g.m::date
  cross join lateral (select coalesce(e.rules, cr.now_rules) as rules) r
  cross join lateral (select case when e.member_id is null then null
    else public.hr_eval_score(public.hr_eval_scores_of(e.scores, e.performance, e.communication), s.att, r.rules) end as total) t
  where p.status = 'active' and public.hr_can_see(p.id)
  order by p.name, g.m;
end $$;
revoke execute on function public.hr_evaluations_list(date, date) from public, anon;
grant execute on function public.hr_evaluations_list(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------- the evaluation

-- the month rated by its items (who: the admin, hr.edit F or the direct manager; never one's own but the admin — 0083): every item
-- of the member's rules that counts (weight > 0, not the attendance) needs a whole score 1–5; the rules are kept with it; then the
-- band's alert to the direct manager (the evaluator when none; never the member himself). Returns { total, pct, kinds }.
create or replace function public.hr_evaluate(p_member uuid, p_month date, p_scores jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_rules jsonb; v_clean jsonb := '{}'::jsonb; i jsonb; v_id text; v_s jsonb; v_att numeric; v_total numeric; v_pct numeric; v_kinds jsonb;
  v_p public.profiles; v_to uuid; v_key text; v_words text;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_p from public.profiles where id = p_member;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (public.is_admin() or (p_member is distinct from auth.uid() and (public.hr_editor() or public.hr_is_manager_of(p_member)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_month is null or v_month > date_trunc('month', public.hr_today())::date then raise exception 'invalid: month' using errcode = '22023'; end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then raise exception 'invalid: scores' using errcode = '22023'; end if;
  if v_note is not null and (char_length(v_note) > 500 or v_note ~ '[<>]') then raise exception 'invalid: note' using errcode = '22023'; end if;
  v_rules := public.hr_eval_rules_of(p_member);
  -- a key that is not one of the rules' manual items is refused
  if exists (select 1 from jsonb_object_keys(p_scores) k
             where not exists (select 1 from jsonb_array_elements(v_rules -> 'items') x where x ->> 'id' = k and coalesce(x ->> 'auto', 'false') <> 'true')) then
    raise exception 'invalid: scores' using errcode = '22023';
  end if;
  for i in select * from jsonb_array_elements(v_rules -> 'items') loop
    if coalesce(i ->> 'auto', 'false') = 'true' then continue; end if;
    v_id := i ->> 'id'; v_s := p_scores -> v_id;
    if v_s is null or jsonb_typeof(v_s) = 'null' then
      if (i ->> 'weight')::numeric > 0 then raise exception 'invalid: %', v_id using errcode = '22023'; end if;
      continue;
    end if;
    if jsonb_typeof(v_s) <> 'number' or (v_s #>> '{}')::numeric not in (1, 2, 3, 4, 5) then raise exception 'invalid: %', v_id using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object(v_id, (v_s #>> '{}')::int);
  end loop;
  insert into public.hr_evaluations (member_id, month, performance, communication, scores, rules, note, rated_by, rated_at)
  values (p_member, v_month, (v_clean ->> 'perf')::smallint, (v_clean ->> 'comm')::smallint, v_clean, v_rules, v_note, auth.uid(), now())
  on conflict (member_id, month) do update set performance = excluded.performance, communication = excluded.communication,
    scores = excluded.scores, rules = excluded.rules, note = excluded.note, rated_by = auth.uid(), rated_at = now();
  v_att := public.hr_att_score(p_member, v_month);
  v_total := public.hr_eval_score(v_clean, v_att, v_rules);
  v_pct := public.hr_eval_pct(v_total, v_rules);
  v_kinds := public.hr_eval_kinds(v_total, v_rules);
  -- the alert: one per member and month (a new save replaces it), to his manager or the evaluator — never to the member himself
  v_key := 'eval:' || p_member || ':' || to_char(v_month, 'YYYY-MM');
  delete from public.alerts where kind = 'hr.eval.action' and entity_id = v_key;
  v_to := coalesce(v_p.manager_id, auth.uid());
  if jsonb_array_length(v_kinds) > 0 and v_to is distinct from p_member and v_p.member_code is not null then
    select string_agg(case k when 'warning' then 'إنذار' when 'meeting' then 'ميتنج فردي' when 'note' then 'ملاحظة' else 'مكافأة إضافية' end, ' + ' order by n)
      into v_words from jsonb_array_elements_text(v_kinds) with ordinality t(k, n);
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    values ('hr.eval.action', left('تقييم ' || coalesce(v_p.name, 'عضو') || ' — ' || to_char(v_month, 'MM/YYYY') || ': ' || trim(to_char(v_total, 'FM0.####')) || ' من 5', 200),
      'الإجراء المقترح: ' || v_words || ' — افتح التقييم وجهّزه', v_to,
      'hr-evals/' || lower(v_p.member_code) || '-' || to_char(v_month, 'YYYY-MM'), v_key);
  end if;
  perform public.log_activity('hr.evaluate', 'hr', p_member::text, null, to_jsonb(to_char(v_month, 'YYYY-MM'))); -- no score in the log
  return jsonb_build_object('total', v_total, 'pct', v_pct, 'kinds', v_kinds);
end $$;
revoke execute on function public.hr_evaluate(uuid, date, jsonb, text) from public, anon;
grant execute on function public.hr_evaluate(uuid, date, jsonb, text) to authenticated, service_role;

-- the old shape (performance + communication) goes through the new one — the default rules' two items
create or replace function public.hr_evaluate(p_member uuid, p_month date, p_perf int, p_comm int, p_note text default null) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  return (public.hr_evaluate(p_member, p_month, jsonb_build_object('perf', p_perf, 'comm', p_comm), p_note) ->> 'total')::numeric;
end $$;
revoke execute on function public.hr_evaluate(uuid, date, int, int, text) from public, anon;
grant execute on function public.hr_evaluate(uuid, date, int, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------- «ملاحظة» on the member's profile (the band's «note»)

alter table public.hr_notes_log drop constraint if exists hr_notes_log_kind_check;
alter table public.hr_notes_log add constraint hr_notes_log_kind_check check (kind in ('meeting', 'warning', 'plan', 'thanks', 'note'));

create or replace function public.hr_member_note_add(p_member uuid, p_kind text, p_period text, p_body text default null, p_due timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_p public.profiles; v_me public.profiles; v_body text := nullif(btrim(coalesce(p_body, '')), ''); v_id bigint; v_t bigint;
  v_cur text := to_char(public.hr_today(), 'YYYY-MM'); v_cur_q text; v_role text; v_name text; v_when text; v_title text; v_entity text;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_p from public.profiles where id = p_member;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_member = auth.uid() or not (public.is_admin() or public.hr_editor() or public.hr_is_manager_of(p_member)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_p.status <> 'active' then raise exception 'invalid: member' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('meeting', 'warning', 'plan', 'thanks', 'note') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  v_cur_q := to_char(public.hr_today(), 'YYYY') || '-Q' || to_char(public.hr_today(), 'Q');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2]|Q[1-4])$'
     or (p_period ~ 'Q' and p_period > v_cur_q) or (p_period !~ 'Q' and p_period > v_cur) then
    raise exception 'invalid: period' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 1000 then raise exception 'invalid: body' using errcode = '22023'; end if;
  if p_kind in ('warning', 'plan') and v_body is null then raise exception 'invalid: body' using errcode = '22023'; end if;
  if p_kind = 'meeting' and (p_due is null or p_due < now() - interval '10 minutes' or p_due > now() + interval '90 days') then
    raise exception 'invalid: due' using errcode = '22023';
  end if;
  if p_kind = 'plan' and p_due is not null and ((p_due at time zone 'Africa/Cairo')::date < public.hr_today() or p_due > now() + interval '366 days') then
    raise exception 'invalid: due' using errcode = '22023';
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  v_name := left(coalesce(nullif(btrim(v_p.name), ''), 'عضو'), 60);
  if p_kind = 'meeting' then
    v_when := to_char(p_due at time zone 'Africa/Cairo', 'DD/MM') || ' الساعة ' || to_char(p_due at time zone 'Africa/Cairo', 'HH24:MI');
    v_role := coalesce((public.ticket_role_labels(v_p.role_id))[1], 'مدير النظام');
    insert into public.tickets (type, title, description, priority, assignee_role, status, follow_up, created_by, created_by_name, created_by_role)
    values ('internal', left('ميتنج فردي — ' || v_name || ' · ' || v_when, 80),
      'ميتنج فردي بين ' || v_name || ' و' || left(coalesce(v_me.name, 'المدير'), 60) || ' يوم ' || v_when || '. التفاصيل عند الموارد البشرية.',
      'normal', v_role, 'open', (p_due at time zone 'Africa/Cairo')::date, auth.uid(), left(coalesce(v_me.name, 'عضو'), 120),
      left(coalesce((public.ticket_role_labels(v_me.role_id))[1], 'عضو'), 60))
    returning id into v_t;
    insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text, new_value)
    values (v_t, 'event', auth.uid(), left(coalesce(v_me.name, 'عضو'), 120), left(coalesce((public.ticket_role_labels(v_me.role_id))[1], 'عضو'), 60), 'فتح التذكرة', 'open');
  end if;
  insert into public.hr_notes_log (member_id, kind, period, body, due_at, ticket_id, by_id)
  values (p_member, p_kind, p_period, v_body, case when p_kind in ('meeting', 'plan') then p_due end, v_t, auth.uid())
  returning id into v_id;
  v_title := case p_kind
    when 'meeting' then 'عندك ميتنج فردي يوم ' || v_when
    when 'warning' then 'وصلك إنذار'
    when 'plan' then 'اتعملك خطة تحسين'
    when 'note' then 'اتكتبتلك ملاحظة على تقييمك'
    else 'وصلك شكر على شغلك' end;
  v_entity := case when v_t is not null then 'tickets/TKT-' || lpad(v_t::text, 4, '0') else 'profile-performance' end;
  insert into public.alerts (kind, title, body, user_id, entity, entity_id)
  values ('hr.note', v_title, 'من ' || left(coalesce(v_me.name, 'المدير'), 60) || ' — التفاصيل في «ملفي › أدائي»', p_member, v_entity, 'note:' || v_id);
  perform public.log_activity('hr.note.add', 'hr', p_member::text, null, to_jsonb(p_kind || ' ' || p_period)); -- no text in the log
  return jsonb_build_object('id', v_id, 'ticket', v_t);
end $$;
revoke execute on function public.hr_member_note_add(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.hr_member_note_add(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------- the payroll (0101's, the quarter's bonus by the % above)

create or replace function public.hr_payroll_calc(p_month date)
returns table (member_id uuid, name text, salary numeric, holdback numeric, paid numeric, ot_minutes int, ot_pay numeric, rest_days int,
  rest_pay numeric, unpaid_days numeric, unpaid_cut numeric, allowances numeric, deductions numeric, advance numeric, quarter_bonus numeric,
  net numeric, missing_scores int, leave_days_paid numeric, leave_pay numeric)
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
  q0 date := date_trunc('quarter', p_month)::date; q_end boolean := extract(month from p_month)::int % 3 = 0;
  q_ref text := to_char(date_trunc('quarter', p_month), 'YYYY') || '-Q' || extract(quarter from p_month)::int;
  v_dec boolean := extract(month from p_month)::int = 12 and public.hr_setting('leaveYearEnd', 'pay') = 'pay';
  v_year int := extract(year from p_month)::int;
  v_div numeric := public.hr_day_divisor(); -- 0087: the day rate = the salary ÷ it (24 by default)
begin
  -- the cron / service_role carry no member (anon has no execute)
  if not (public.hr_salaries() or auth.uid() is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with mem as (
    select p.id, p.name, pay.salary s, pay.holdback hb, pay.allowances al
    from public.profiles p join public.hr_pay pay on pay.member_id = p.id
    where p.status = 'active' and pay.salary > 0
  ), ot as (
    select o.member_id mid, sum(o.paid_minutes)::int mins from public.hr_overtime o
    where o.kind = 'hours' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), ota as (
    select a.member_id mid, sum(a.minutes)::int mins from public.hr_ot_adjust a where a.month = m0 group by a.member_id
  ), rest as (
    select o.member_id mid, count(*)::int n from public.hr_overtime o
    where o.kind = 'rest_day' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), unpaid as (
    select r.member_id mid, count(*)::numeric n
    from public.hr_requests r join public.hr_leave_types t on t.name = r.type and t.unpaid
    cross join lateral generate_series(greatest(r.from_day, m0), least(r.to_day, m1 - 1), interval '1 day') g(d)
    where r.status = 'موافق' and public.hr_member_workday(r.member_id, g.d::date) and g.d::date not in (select public.hr_holiday_days())
    group by r.member_id
  ), adj as (
    select j.member_id mid, sum(greatest(j.amount, 0)) plus, sum(greatest(-j.amount, 0)) minus
    from public.hr_adjustments j where j.month = m0 and j.voided_at is null group by j.member_id
  ), adv as (
    -- decision 4: an advance with its month (pay_from) comes off it whole; the old ones by installments from the month after the decision
    select r.member_id mid, sum(case when r.pay_from is not null then case when r.pay_from = m0 then r.amount else 0 end
      when m0 >= (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + interval '1 month')::date
       and m0 < (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + make_interval(months => 1 + r.months))::date then round(r.amount / r.months, 2) else 0 end) per
    from public.hr_requests r
    where r.type = 'سُلفة' and r.status = 'موافق' and r.decided_at is not null
    group by r.member_id
  ), ev as (
    -- 0155: the quarter's months, each evaluation's weighted result × the point = the % of that month's holdback (its own rules, or
    -- the member's current ones for an evaluation made before 0155)
    select m.id mid, count(e.member_id)::int n,
      sum(case when e.member_id is null then 0 else round(m.hb * coalesce(public.hr_eval_pct(
        public.hr_eval_score(public.hr_eval_scores_of(e.scores, e.performance, e.communication), public.hr_att_score(m.id, g.mm::date), coalesce(e.rules, cr.r)),
        coalesce(e.rules, cr.r)), 0) / 100, 2) end) earned
    from mem m cross join lateral (select public.hr_eval_rules_of(m.id) r) cr
    cross join lateral generate_series(q0, (q0 + interval '2 months')::date, interval '1 month') g(mm)
    left join public.hr_evaluations e on e.member_id = m.id and e.month = g.mm::date
    group by m.id
  ), ex as (
    select e.member_id mid, sum(e.amount) amt from public.hr_extras e where e.quarter = q_ref and e.status = 'معتمدة' group by e.member_id
  ), base as (
    select m.id, m.name, m.s, m.hb, round(m.s - m.hb, 2) as paid0,
      greatest(0, coalesce(ot.mins, 0) + coalesce(ota.mins, 0)) as otm,
      round(m.s / v_div / (public.hr_day_minutes(m.id) / 60.0) * greatest(0, coalesce(ot.mins, 0) + coalesce(ota.mins, 0)) / 60, 2) as otp,
      coalesce(rest.n, 0) as rd, round(m.s / v_div * 2 * coalesce(rest.n, 0), 2) as rp,
      coalesce(unpaid.n, 0) as ud, round(m.s / v_div * coalesce(unpaid.n, 0), 2) as uc,
      round(m.al + coalesce(adj.plus, 0), 2) as al2, round(coalesce(adj.minus, 0), 2) as ded, round(coalesce(adv.per, 0), 2) as adv2,
      case when q_end then round(coalesce(ev.earned, 0) + coalesce(ex.amt, 0), 2) else 0 end as qb,
      case when q_end then 3 - coalesce(ev.n, 0) else 0 end as miss,
      case when v_dec then public.hr_leave_left(m.id, v_year) else 0 end as ld
    from mem m
    left join ot on ot.mid = m.id left join ota on ota.mid = m.id left join rest on rest.mid = m.id left join unpaid on unpaid.mid = m.id
    left join adj on adj.mid = m.id left join adv on adv.mid = m.id left join ev on ev.mid = m.id left join ex on ex.mid = m.id
  )
  select b.id, b.name, b.s, b.hb, b.paid0, b.otm, b.otp, b.rd, b.rp, b.ud, b.uc, b.al2, b.ded, b.adv2, b.qb,
    round(b.paid0 + b.otp + b.rp + b.al2 - b.ded - b.adv2 - b.uc + b.qb + round(b.s / v_div * b.ld, 2), 2), b.miss, b.ld, round(b.s / v_div * b.ld, 2)
  from base b order by b.name;
end $$;

