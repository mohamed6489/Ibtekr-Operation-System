-- 0162 — several elements in one alert and «فردي / تقرير» (Safwat 24 Nov — «ممكن تخلي التنبيهات فيها امكانية لإضافة اكتر من عنصر في
-- التنبيه الواحد … نحط درب داون بحيث المستخدم يختار ما تبنيه فردي او تقرير … جدول واحد بكل الحاجات»; docs/superpowers/plans/
-- 2026-11-24-bell-redesign.md decision 8). A rule keeps its first element › type › state in its own columns and takes up to 5 more in
-- `conds` ([{ element, type, state, sub, param }]); `mode`: 'single' = an alert per thing as before (each element's own), 'report' =
-- one alert per member and run that holds them all (alerts.meta.items — the bell opens them as one table). Re-runnable.

alter table public.notif_rules add column if not exists mode text not null default 'single';
alter table public.notif_rules add column if not exists conds jsonb not null default '[]'::jsonb;

-- the shape of the extra elements: the same checks as the rule's own columns
create or replace function public.notif_conds_ok(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5 and not exists (
    select 1 from jsonb_array_elements(p) c
    where jsonb_typeof(c) <> 'object'
      or coalesce(c ->> 'element', '') !~ '^[a-z_]{2,24}$'
      or coalesce(c ->> 'type', '') !~ '^[a-z_]{2,24}$'
      or char_length(coalesce(c ->> 'state', '')) not between 1 and 60 or (c ->> 'state') ~ '[<>]'
      or (c ? 'sub' and jsonb_typeof(c -> 'sub') <> 'null' and (char_length(c ->> 'sub') not between 1 and 60 or (c ->> 'sub') ~ '[<>]'))
      or (c ? 'param' and jsonb_typeof(c -> 'param') <> 'null' and (jsonb_typeof(c -> 'param') <> 'number' or (c ->> 'param')::numeric not between 0 and 100000)))
$$;
revoke execute on function public.notif_conds_ok(jsonb) from public, anon;
grant execute on function public.notif_conds_ok(jsonb) to authenticated, service_role;

do $$ begin
  alter table public.notif_rules add constraint notif_rules_mode check (mode in ('single', 'report'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.notif_rules add constraint notif_rules_conds check (public.notif_conds_ok(conds));
exception when duplicate_object then null; end $$;

drop trigger if exists notif_rules_guard on public.notif_rules;
create trigger notif_rules_guard before insert or update of section_id, roles, name, element, type, state, sub, param, at, repeat, days, show, hours, channels, template, active, mode, conds
  on public.notif_rules for each row execute function public.notif_rules_guard();

create or replace function public.notif_rule_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_roles text[] := array(select jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)));
  v_channels text[] := array(select jsonb_array_elements_text(coalesce(p -> 'channels', '["bell"]'::jsonb)));
  v_days int[] := array(select (jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)))::int);
  v_conds jsonb := case when jsonb_typeof(p -> 'conds') = 'array' then p -> 'conds' else '[]'::jsonb end;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.notif_rules (section_id, name, element, type, state, sub, param, at, repeat, days, show, hours, roles, channels, template, active, mode, conds, sort)
    values ((p ->> 'section_id')::uuid, btrim(p ->> 'name'), p ->> 'element', p ->> 'type', p ->> 'state', nullif(p ->> 'sub', ''), (p ->> 'param')::numeric,
      coalesce(p ->> 'at', '09:00'), coalesce(p ->> 'repeat', '24h'), v_days, coalesce(p ->> 'show', 'until_state'), coalesce((p ->> 'hours')::int, 0), v_roles, v_channels,
      nullif(btrim(coalesce(p ->> 'template', '')), ''), coalesce((p ->> 'active')::boolean, true), coalesce(p ->> 'mode', 'single'), v_conds,
      coalesce((select max(sort) + 1 from public.notif_rules where section_id = (p ->> 'section_id')::uuid), 0))
    returning id into v_id;
  else
    update public.notif_rules set section_id = (p ->> 'section_id')::uuid, name = btrim(p ->> 'name'), element = p ->> 'element', type = p ->> 'type', state = p ->> 'state',
      sub = nullif(p ->> 'sub', ''), param = (p ->> 'param')::numeric, at = coalesce(p ->> 'at', at), repeat = coalesce(p ->> 'repeat', repeat), days = v_days,
      show = coalesce(p ->> 'show', show), hours = coalesce((p ->> 'hours')::int, hours), roles = v_roles, channels = v_channels,
      template = nullif(btrim(coalesce(p ->> 'template', '')), ''), active = coalesce((p ->> 'active')::boolean, active),
      mode = coalesce(p ->> 'mode', mode), conds = case when p ? 'conds' then v_conds else conds end, last_run = null
    where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  perform public.log_activity('settings.notif.rule', 'settings', v_id::text, null, to_jsonb(p ->> 'element' || '.' || (p ->> 'type'))); -- no text
  return v_id;
exception when check_violation or invalid_text_representation or not_null_violation then raise exception 'invalid: rule' using errcode = '22023';
end $$;
revoke execute on function public.notif_rule_save(jsonb) from public, anon;
grant execute on function public.notif_rule_save(jsonb) to authenticated, service_role;
