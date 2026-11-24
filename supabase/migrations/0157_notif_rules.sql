-- 0157 — the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md).
-- The admin builds the bell: main sections, the sub-sections under them, and under each sub-section its rules — an element › a type
-- › a state of the catalogue (app/js/pages/notif-catalog.js = supabase/functions/_shared/notif-catalog.js), the send time and its
-- repeat, the visibility (a fixed time · until the state changes · until read, each with its hours), the recipients (the system's
-- roles) and the message's template. The engine (notify, every 15 minutes) runs the rules that are due and writes `alerts` rows with
-- the rule and its sub-section; the bell draws the sections from here. The old structure (settings «notif»: the types, the roles'
-- matrix and its levels, the escalation, the quiet hours, the digests) is no longer read (Safwat 24 Nov — «تتشال ونبدأ من الأمثلة»).
-- The channels: the bell only for now (Safwat 24 Nov); a rule may name e-mail / WhatsApp, the engine does not send them yet.
-- Members read the sections and the rules (the bell's tabs); only the admin writes them, through the functions below. Re-runnable.

create table if not exists public.notif_sections (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.notif_sections on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40 and name !~ '[<>]'),
  icon text check (icon is null or icon ~ '^[a-z][A-Za-z0-9]{0,23}$'),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists notif_sections_parent on public.notif_sections (parent_id, sort);

create table if not exists public.notif_rules (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.notif_sections on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80 and name !~ '[<>]'),
  element text not null check (element ~ '^[a-z_]{2,24}$'),
  type text not null check (type ~ '^[a-z_]{2,24}$'),
  state text not null check (char_length(state) between 1 and 60 and state !~ '[<>]'),
  sub text check (sub is null or (char_length(sub) between 1 and 60 and sub !~ '[<>]')), -- a request's type under «طلبات الفريق»
  param numeric check (param is null or param between 0 and 100000),                      -- a state's number (the custody's floor …)
  at text not null default '09:00' check (at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  repeat text not null default '24h' check (repeat in ('once', '24h', '48h', 'weekly', 'monthly', 'days')),
  days int[] not null default '{}' check (days <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]),
  show text not null default 'until_state' check (show in ('fixed', 'until_state', 'until_read')),
  hours int not null default 0,
  roles text[] not null check (cardinality(roles) between 1 and 30),
  channels text[] not null default '{bell}' check (channels <@ array['bell', 'email', 'whatsapp'] and cardinality(channels) >= 1),
  template text check (template is null or (char_length(template) <= 500 and template !~ '[<>]')),
  active boolean not null default true,
  sort int not null default 0,
  last_run timestamptz,          -- the engine's
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notif_rules_hours check ((show = 'fixed' and hours in (12, 24, 48, 72, 168)) or (show = 'until_state' and hours in (0, 4, 6)) or (show = 'until_read' and hours in (2, 4, 6))),
  constraint notif_rules_days check (repeat <> 'days' or cardinality(days) >= 1)
);
create index if not exists notif_rules_section on public.notif_rules (section_id, sort);

-- a rule sits under a sub-section only
create or replace function public.notif_rules_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.notif_sections s where s.id = new.section_id and s.parent_id is not null) then
    raise exception 'invalid: section' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.roles) r where not exists (select 1 from public.roles x where x.id = r)) then
    raise exception 'invalid: roles' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists notif_rules_guard on public.notif_rules;
create trigger notif_rules_guard before insert or update of section_id, roles, name, element, type, state, sub, param, at, repeat, days, show, hours, channels, template, active
  on public.notif_rules for each row execute function public.notif_rules_guard();

alter table public.notif_sections enable row level security;
alter table public.notif_rules enable row level security;
drop policy if exists notif_sections_select on public.notif_sections;
create policy notif_sections_select on public.notif_sections for select to authenticated using ((select public.hr_active()));
drop policy if exists notif_rules_select on public.notif_rules;
create policy notif_rules_select on public.notif_rules for select to authenticated using ((select public.hr_active()));
revoke all on public.notif_sections, public.notif_rules from public, anon, authenticated;
grant select on public.notif_sections, public.notif_rules to authenticated;
grant all on public.notif_sections, public.notif_rules to service_role;

-- the alerts the rules write: their rule and sub-section, and when the engine hides them («تفاصيل الظهور»)
alter table public.alerts add column if not exists rule_id uuid references public.notif_rules on delete set null;
alter table public.alerts add column if not exists section_id uuid references public.notif_sections on delete set null;
alter table public.alerts add column if not exists hide_at timestamptz;
create index if not exists alerts_rule on public.alerts (rule_id, entity_id) where rule_id is not null;

-- ---------------------------------------------------------------- the admin's writes

create or replace function public.notif_section_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_parent uuid := nullif(p ->> 'parent_id', '')::uuid; v_name text := btrim(coalesce(p ->> 'name', ''));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 40 or v_name ~ '[<>]' then raise exception 'invalid: name' using errcode = '22023'; end if;
  if v_parent is not null and not exists (select 1 from public.notif_sections where id = v_parent and parent_id is null) then raise exception 'invalid: parent' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.notif_sections (parent_id, name, icon, sort)
    values (v_parent, v_name, nullif(p ->> 'icon', ''), coalesce((select max(sort) + 1 from public.notif_sections where parent_id is not distinct from v_parent), 0))
    returning id into v_id;
  else
    update public.notif_sections set name = v_name, icon = coalesce(nullif(p ->> 'icon', ''), icon) where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  perform public.log_activity('settings.notif.section', 'settings', v_id::text, null, null);
  return v_id;
end $$;

create or replace function public.notif_section_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.notif_sections where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform public.log_activity('settings.notif.section.delete', 'settings', p_id::text, null, null);
end $$;

-- the order of one level (the main sections, or one main section's sub-sections): the ids as shown
create or replace function public.notif_section_order(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(distinct coalesce(parent_id::text, '-')) from public.notif_sections where id = any(p_ids)) <> 1 then -- one level, one parent
    raise exception 'invalid: ids' using errcode = '22023';
  end if;
  update public.notif_sections s set sort = x.n from unnest(p_ids) with ordinality x(id, n) where s.id = x.id;
end $$;

create or replace function public.notif_rule_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_roles text[] := array(select jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)));
  v_channels text[] := array(select jsonb_array_elements_text(coalesce(p -> 'channels', '["bell"]'::jsonb)));
  v_days int[] := array(select (jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)))::int);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.notif_rules (section_id, name, element, type, state, sub, param, at, repeat, days, show, hours, roles, channels, template, active, sort)
    values ((p ->> 'section_id')::uuid, btrim(p ->> 'name'), p ->> 'element', p ->> 'type', p ->> 'state', nullif(p ->> 'sub', ''), (p ->> 'param')::numeric,
      coalesce(p ->> 'at', '09:00'), coalesce(p ->> 'repeat', '24h'), v_days, coalesce(p ->> 'show', 'until_state'), coalesce((p ->> 'hours')::int, 0), v_roles, v_channels,
      nullif(btrim(coalesce(p ->> 'template', '')), ''), coalesce((p ->> 'active')::boolean, true),
      coalesce((select max(sort) + 1 from public.notif_rules where section_id = (p ->> 'section_id')::uuid), 0))
    returning id into v_id;
  else
    update public.notif_rules set section_id = (p ->> 'section_id')::uuid, name = btrim(p ->> 'name'), element = p ->> 'element', type = p ->> 'type', state = p ->> 'state',
      sub = nullif(p ->> 'sub', ''), param = (p ->> 'param')::numeric, at = coalesce(p ->> 'at', at), repeat = coalesce(p ->> 'repeat', repeat), days = v_days,
      show = coalesce(p ->> 'show', show), hours = coalesce((p ->> 'hours')::int, hours), roles = v_roles, channels = v_channels,
      template = nullif(btrim(coalesce(p ->> 'template', '')), ''), active = coalesce((p ->> 'active')::boolean, active), last_run = null
    where id = v_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  perform public.log_activity('settings.notif.rule', 'settings', v_id::text, null, to_jsonb(p ->> 'element' || '.' || (p ->> 'type'))); -- no text
  return v_id;
exception when check_violation or invalid_text_representation or not_null_violation then raise exception 'invalid: rule' using errcode = '22023';
end $$;

create or replace function public.notif_rule_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.notif_rules where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform public.log_activity('settings.notif.rule.delete', 'settings', p_id::text, null, null);
end $$;

revoke execute on function public.notif_section_save(jsonb), public.notif_section_delete(uuid), public.notif_section_order(uuid[]),
  public.notif_rule_save(jsonb), public.notif_rule_delete(uuid) from public, anon;
grant execute on function public.notif_section_save(jsonb), public.notif_section_delete(uuid), public.notif_section_order(uuid[]),
  public.notif_rule_save(jsonb), public.notif_rule_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- the seed (once): Safwat's examples (24 Nov)

do $$
declare m uuid; s uuid;
  sec text; subs text[]; sub text;
  admin_ops text[] := array['admin', 'ops'];
begin
  if exists (select 1 from public.notif_sections) then return; end if;
  -- main sections (the bell's tabs) and their sub-sections (the filters)
  for sec, subs in select * from (values
      ('التقارير اليومية', array['ملخص اليوم']),
      ('مساعدين الذكاء الاصطناعي', array['الميديا باير', 'الديزاينر', 'المبرمج']),
      ('خدمة العملاء', array['متأخر', 'غير مؤكدة', 'في انتظار الرد']),
      ('متابعة المبتكرين', array['متأخر', 'قابلة للتأخير', 'مؤكد']),
      ('العمليات والشحن', array['جاهز للشحن للمخزن', 'جاهز للشحن للعميل', 'مرتجع يحتاج فحص', 'العهدة', 'استوك قرب يخلص']),
      ('الحسابات', array['المصروفات', 'طلبات السحب', 'حساب المبتكرين', 'المرتبات', 'الاشتراكات', 'العهدة', 'الحركة المالية']),
      ('الفريق', array['الحضور والانصراف', 'الطلبات', 'التقييم']),
      ('الرسائل', array['من العملاء', 'من المبتكرين', 'تعليقات'])) v(a, b)
  loop
    insert into public.notif_sections (name, sort) values (sec, coalesce((select max(sort) + 1 from public.notif_sections where parent_id is null), 0)) returning id into m;
    foreach sub in array subs loop
      insert into public.notif_sections (parent_id, name, sort) values (m, sub, coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m), 0));
    end loop;
  end loop;
end $$;

-- the seed's rules — one or more under each sub-section, by the sub-section's name under its main section's
create or replace function pg_temp.seed_rule(p_main text, p_sub text, p_name text, p_el text, p_type text, p_state text, p_roles text[],
  p_show text default 'until_state', p_hours int default 0, p_repeat text default '24h', p_at text default '09:00', p_param numeric default null, p_template text default null)
returns void language plpgsql as $$
declare v_sec uuid;
begin
  select s.id into v_sec from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = p_main and s.name = p_sub;
  if v_sec is null or exists (select 1 from public.notif_rules where section_id = v_sec and name = p_name) then return; end if;
  insert into public.notif_rules (section_id, name, element, type, state, param, at, repeat, show, hours, roles, template, sort, created_by)
  values (v_sec, p_name, p_el, p_type, p_state, p_param, p_at, p_repeat, p_show, p_hours,
    array(select r from unnest(p_roles) r where exists (select 1 from public.roles x where x.id = r)), p_template,
    coalesce((select max(sort) + 1 from public.notif_rules where section_id = v_sec), 0), null);
end $$;

do $$
begin
  if exists (select 1 from public.notif_rules) then return; end if;
  perform pg_temp.seed_rule('التقارير اليومية', 'ملخص اليوم', 'ملخص اليوم', 'daily', 'summary', 'day', array['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'hr', 'content', 'designer', 'media_buyer', 'developer'], 'fixed', 24, '24h', '09:00');
  perform pg_temp.seed_rule('مساعدين الذكاء الاصطناعي', 'الميديا باير', 'أداء الحملات', 'ai', 'buyer', 'campaigns', array['admin', 'media_buyer'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('مساعدين الذكاء الاصطناعي', 'الميديا باير', 'حالة البيكسل', 'ai', 'buyer', 'pixel', array['admin', 'media_buyer'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('مساعدين الذكاء الاصطناعي', 'الديزاينر', 'آخر التريندات', 'ai', 'designer', 'trends', array['admin', 'designer'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('مساعدين الذكاء الاصطناعي', 'المبرمج', 'تحديثات ووردبريس', 'ai', 'dev', 'wp', array['admin', 'developer'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('مساعدين الذكاء الاصطناعي', 'المبرمج', 'مشاكل API', 'ai', 'dev', 'api', array['admin', 'developer'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('خدمة العملاء', 'متأخر', 'أوردر متأخر', 'orders', 'delay', 'late', array['admin', 'cs'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('خدمة العملاء', 'غير مؤكدة', 'أوردر غير مؤكد', 'orders', 'confirm', 'غير مؤكد', array['admin', 'cs'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('خدمة العملاء', 'في انتظار الرد', 'عميل مستني ردنا', 'messages', 'customers', 'waiting', array['admin', 'cs'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('متابعة المبتكرين', 'متأخر', 'أوردر فرعي متأخر', 'subs', 'delay', 'late', array['admin', 'vendors_followup'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('متابعة المبتكرين', 'قابلة للتأخير', 'أوردر فرعي قابل للتأخير', 'subs', 'delay', 'risk', array['admin', 'vendors_followup'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('متابعة المبتكرين', 'مؤكد', 'أوردر مؤكد جديد للمبتكر', 'makers', 'making', 'confirmed', array['admin', 'vendors_followup'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('العمليات والشحن', 'جاهز للشحن للمخزن', 'جاهز للشحن للمخزن', 'subs', 'status', 'جاهز للشحن من المبتكر للمخزن', array['admin', 'ops'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('العمليات والشحن', 'جاهز للشحن للعميل', 'جاهز للشحن للعميل', 'subs', 'status', 'جاهز للشحن من المبتكر للعميل', array['admin', 'ops'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('العمليات والشحن', 'مرتجع يحتاج فحص', 'مرتجع يحتاج فحص', 'products', 'returns', 'wait', array['admin', 'ops'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('العمليات والشحن', 'العهدة', 'العهدة قربت تخلص', 'custody', 'balance', 'low', array['admin', 'ops'], 'until_state', 0, '24h', '09:00', 200, 'الحق الفلوس قربت تخلص — {التفاصيل}');
  perform pg_temp.seed_rule('العمليات والشحن', 'استوك قرب يخلص', 'باقي 3 في المخزون', 'products', 'stock', 'left3', array['admin', 'ops'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('الحسابات', 'المصروفات', 'مصروف جديد', 'accounts', 'expenses', 'withdraw', array['admin', 'accounts'], 'until_read', 4, '24h');
  perform pg_temp.seed_rule('الحسابات', 'طلبات السحب', 'طلب سحب من مبتكر', 'makers', 'accounts', 'withdraw', array['admin', 'accounts'], 'until_read', 6, '24h');
  perform pg_temp.seed_rule('الحسابات', 'حساب المبتكرين', 'قربنا على تقفيل حسابات المبتكرين', 'accounts', 'makers', 'close_due', array['admin', 'accounts'], 'fixed', 48, 'monthly', '09:00', 2);
  perform pg_temp.seed_rule('الحسابات', 'المرتبات', 'المرتبات بعد يومين', 'accounts', 'payroll', 'due', array['admin', 'accounts'], 'fixed', 48, 'monthly', '09:00', 2);
  perform pg_temp.seed_rule('الحسابات', 'الاشتراكات', 'اشتراك قرب يتجدد', 'accounts', 'subs', 'due', array['admin', 'accounts'], 'fixed', 72, '24h', '09:00', 3);
  perform pg_temp.seed_rule('الحسابات', 'العهدة', 'العهدة قربت تخلص', 'custody', 'balance', 'low', array['admin', 'accounts'], 'until_state', 0, '24h', '09:00', 200, 'الحق الفلوس قربت تخلص — {التفاصيل}');
  perform pg_temp.seed_rule('الحسابات', 'الحركة المالية', 'ملخص الحركة المالية', 'accounts', 'summary', 'day', array['admin', 'accounts'], 'fixed', 24, '24h', '21:00');
  perform pg_temp.seed_rule('الفريق', 'الحضور والانصراف', 'لم يسجل حضور', 'team', 'status', 'no_in', array['admin', 'hr'], 'until_state', 0, '24h', '10:00', 60, '{الاسم} متأخر — ماسجّلش حضور');
  perform pg_temp.seed_rule('الفريق', 'الحضور والانصراف', 'لم يسجل انصراف', 'team', 'status', 'no_out', array['admin', 'hr'], 'until_state', 0, '24h', '23:00');
  perform pg_temp.seed_rule('الفريق', 'الحضور والانصراف', 'بدء وقت إضافي', 'team', 'status', 'ot_start', array['admin', 'hr'], 'until_read', 4, '24h', '00:00');
  perform pg_temp.seed_rule('الفريق', 'الطلبات', 'طلبات جديدة', 'tickets', 'type', 'new', array['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'hr', 'content', 'designer', 'media_buyer', 'developer'], 'until_read', 6, '24h', '00:00');
  perform pg_temp.seed_rule('الفريق', 'الطلبات', 'طلبات حالتها ماتغيّرتش', 'tickets', 'type', 'late', array['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'hr', 'content', 'designer', 'media_buyer', 'developer'], 'until_state', 0, '24h');
  perform pg_temp.seed_rule('الفريق', 'التقييم', 'جه وقت التقييم', 'team', 'status', 'eval_due', array['admin', 'hr'], 'fixed', 48, 'monthly', '09:00', 2);
  perform pg_temp.seed_rule('الرسائل', 'من العملاء', 'رسايل عملاء جديدة', 'messages', 'customers', 'new', array['admin', 'cs'], 'until_read', 2, '24h', '00:00');
  perform pg_temp.seed_rule('الرسائل', 'من المبتكرين', 'رسايل مبتكرين جديدة', 'messages', 'vendors', 'new', array['admin', 'vendors_followup'], 'until_read', 2, '24h', '00:00');
  perform pg_temp.seed_rule('الرسائل', 'تعليقات', 'تعليقات جديدة', 'messages', 'comments', 'new', array['admin', 'cs'], 'until_read', 2, '24h', '00:00');
end $$;

-- the realtime signal: the bell redraws when the admin changes the structure (0104 — the «settings» group)
do $$
begin
  if to_regprocedure('public.live_changed()') is null then return; end if;
  drop trigger if exists notif_sections_live on public.notif_sections;
  create trigger notif_sections_live after insert or update or delete on public.notif_sections for each statement execute function public.live_changed('settings');
  drop trigger if exists notif_rules_live on public.notif_rules;
  create trigger notif_rules_live after insert or update or delete on public.notif_rules for each statement execute function public.live_changed('settings');
end $$;
