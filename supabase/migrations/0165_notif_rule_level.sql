-- 0165 — the alert's level picked by the admin (Safwat 24 Nov — «خلي المستخدم يقدر يختار اهمية التنبية و قسمها حرج و تحتيها مهم و تحتيها عادي و
-- تحتيها للمعرفة زي ما انت عاملها بس الفرق ان المستخدم يقدر يختار»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 14):
--   * notif_rules.level — critical | important | normal | info, null = the state's own (the catalogue: levelOf). The engine writes it
--     into alerts.meta.lv for each new alert (metaOf → levelOf, which takes the rule's level first);
--   * notif_rule_save keeps it (a key left out keeps the saved one);
--   * the alerts already in the bell follow a changed level at once (meta.lv) — never deleted, their read marks stay.
-- Re-runnable.

alter table public.notif_rules add column if not exists level text;
do $$ begin
  alter table public.notif_rules add constraint notif_rules_level check (level is null or level in ('critical', 'important', 'normal', 'info'));
exception when duplicate_object then null; end $$;

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
    insert into public.notif_rules (section_id, name, element, type, state, sub, param, at, repeat, days, show, hours, roles, channels, template, active, mode, conds, level, sort)
    values ((p ->> 'section_id')::uuid, btrim(p ->> 'name'), p ->> 'element', p ->> 'type', p ->> 'state', nullif(p ->> 'sub', ''), (p ->> 'param')::numeric,
      coalesce(p ->> 'at', '09:00'), coalesce(p ->> 'repeat', '24h'), v_days, coalesce(p ->> 'show', 'until_state'), coalesce((p ->> 'hours')::int, 0), v_roles, v_channels,
      nullif(btrim(coalesce(p ->> 'template', '')), ''), coalesce((p ->> 'active')::boolean, true), coalesce(p ->> 'mode', 'single'), v_conds, nullif(p ->> 'level', ''),
      coalesce((select max(sort) + 1 from public.notif_rules where section_id = (p ->> 'section_id')::uuid), 0))
    returning id into v_id;
  else
    update public.notif_rules set section_id = (p ->> 'section_id')::uuid, name = btrim(p ->> 'name'), element = p ->> 'element', type = p ->> 'type', state = p ->> 'state',
      sub = nullif(p ->> 'sub', ''), param = (p ->> 'param')::numeric, at = coalesce(p ->> 'at', at), repeat = coalesce(p ->> 'repeat', repeat), days = v_days,
      show = coalesce(p ->> 'show', show), hours = coalesce((p ->> 'hours')::int, hours), roles = v_roles, channels = v_channels,
      template = nullif(btrim(coalesce(p ->> 'template', '')), ''), active = coalesce((p ->> 'active')::boolean, active),
      mode = coalesce(p ->> 'mode', mode), conds = case when p ? 'conds' then v_conds else conds end,
      level = case when p ? 'level' then nullif(p ->> 'level', '') else level end, last_run = null
    where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  perform public.log_activity('settings.notif.rule', 'settings', v_id::text, null, to_jsonb(p ->> 'element' || '.' || (p ->> 'type'))); -- no text
  return v_id;
exception when check_violation or invalid_text_representation or not_null_violation then raise exception 'invalid: rule' using errcode = '22023';
end $$;
revoke execute on function public.notif_rule_save(jsonb) from public, anon;
grant execute on function public.notif_rule_save(jsonb) to authenticated, service_role;

-- a changed level reaches the alerts already showing (a «تقرير» one too); back to «تلقائي» (null) they keep theirs till the next write
create or replace function public.notif_rule_level_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level is not null then
    update public.alerts set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lv', new.level)
    where rule_id = new.id and (hide_at is null or hide_at > now());
  end if;
  return new;
end $$;
revoke execute on function public.notif_rule_level_alerts() from public, anon;
drop trigger if exists notif_rules_level on public.notif_rules;
create trigger notif_rules_level after update of level on public.notif_rules
  for each row when (old.level is distinct from new.level) execute function public.notif_rule_level_alerts();
