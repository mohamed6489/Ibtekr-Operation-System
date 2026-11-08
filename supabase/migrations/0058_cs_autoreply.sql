-- 0058_cs_autoreply — phase 6.5: the auto-reply page (templates · quick replies · auto rules) and the engine's run log
-- (docs/superpowers/plans/2026-11-08-phase-6-5-autoreply.md, decisions 6 and 11–12).
-- * cs_templates — the message templates (customers' library on WhatsApp 1 / the channels, makers' library on WhatsApp 2 only — the
--   engine enforces the channel): the body with {variables}, how it fires (auto / manual from the chat / campaigns only) with the
--   prototype's trigger options, an optional «/key» for the composer, and the approved Meta WhatsApp template name + the order of its
--   variables for a send outside the 24-hour window (owner's decision 1). `used` is the server's.
-- * cs_quick_replies — the composer's «/» answers (key · label · text).
-- * cs_auto_rules — «لما (الحدث) · لو (الشروط) · اعمل (الإجراء)» as the prototype's editor shapes them: event status | sub | first |
--   afterhours | cart | transfer, the status it fires on, the conditions as [[field, op, value]], the action send | ticket | assign | tag
--   with its template / role / tag, the delay in minutes, once-per-entity, «open a ticket when the customer stays silent 24 hours»,
--   enabled. `runs` / `last_run_at` are the server's.
-- * cs_auto_runs — the engine's log, one row a (rule × entity): sent | held | skipped | failed | ticket | assigned | tagged + a code; the
--   members read it, only the server writes it; a non-failed row a (rule × entity) is unique = «مرة واحدة» and «مردّش في 24 ساعة».
-- * cs_auto_settings() — the sending settings as the members read them (cs.view): the defaults over settings «cs».auto; `live` (the
--   master switch) is false until the admin turns it on from the page — the settings row itself stays the admin's (0002).
-- Permissions (phase 6): read cs.view <> N; write templates / quick replies / rules with cs.manage = F.
-- Every table: RLS + explicit grants (rule 4). Re-runnable; no drop / delete / truncate of data.

-- ---------------------------------------------------------------- templates

create table if not exists public.cs_templates (
  id uuid primary key default gen_random_uuid(),
  lib text not null default 'customers' check (lib in ('customers', 'vendors')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  cat text not null default 'متابعة' check (char_length(cat) between 1 and 40),
  tone text not null default 'brand' check (tone in ('brand', 'orange', 'error', 'gold', 'success', 'info', 'neutral')),
  body text not null check (char_length(btrim(body)) between 1 and 1024),
  trig_kind text not null default 'manual' check (trig_kind in ('auto', 'manual', 'campaign')),
  trig_on text[] not null default '{}' check (cardinality(trig_on) <= 10),
  trig_when text not null default 'فورًا' check (char_length(trig_when) between 1 and 20),
  channels text not null default 'كل القنوات' check (char_length(channels) between 1 and 40),
  quick_key text check (quick_key is null or (quick_key ~ '^/\S{1,39}$')),
  wa_template text check (wa_template is null or wa_template ~ '^[a-z0-9_]{1,120}$'),
  wa_vars text[] not null default '{}' check (cardinality(wa_vars) <= 10),
  used int not null default 0 check (used >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now()
);
create unique index if not exists cs_templates_quick_key_idx on public.cs_templates (quick_key) where quick_key is not null;
create index if not exists cs_templates_lib_idx on public.cs_templates (lib, active, created_at desc);

-- ---------------------------------------------------------------- quick replies

create table if not exists public.cs_quick_replies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^/\S{1,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  text text not null check (char_length(btrim(text)) between 1 and 1024),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- rules

-- the conditions: an array of up to 20 [field, op, value] string triples (a check constraint cannot hold a subquery itself)
create or replace function public.cs_conds_ok(c jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(c) = 'array' and jsonb_array_length(c) <= 20 and octet_length(c::text) <= 4000
     and not exists (select 1 from jsonb_array_elements(c) e
                     where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 3
                        or jsonb_typeof(e -> 0) <> 'string' or jsonb_typeof(e -> 1) <> 'string' or jsonb_typeof(e -> 2) <> 'string')
$$;
revoke execute on function public.cs_conds_ok(jsonb) from public, anon;
grant execute on function public.cs_conds_ok(jsonb) to authenticated, service_role;

create table if not exists public.cs_auto_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  grp text check (grp is null or char_length(grp) <= 80),
  event text not null check (event in ('status', 'sub', 'first', 'afterhours', 'cart', 'transfer')),
  event_to text check (event_to is null or char_length(event_to) <= 40),
  conds jsonb not null default '[]'::jsonb check (public.cs_conds_ok(conds)),
  action text not null default 'send' check (action in ('send', 'ticket', 'assign', 'tag')),
  template_id uuid references public.cs_templates,
  role_id text references public.roles,
  tag text check (tag is null or char_length(btrim(tag)) between 1 and 40),
  delay_min int not null default 0 check (delay_min between 0 and 10080),
  once boolean not null default true,
  ticket_if_silent boolean not null default false,
  enabled boolean not null default false,
  runs int not null default 0 check (runs >= 0),
  last_run_at timestamptz,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now(),
  constraint cs_auto_rules_status_to check (event <> 'status' or event_to is not null),
  constraint cs_auto_rules_action_target check (
    (action = 'send' and template_id is not null) or (action = 'ticket') or (action = 'assign' and role_id is not null) or (action = 'tag' and tag is not null))
);
create index if not exists cs_auto_rules_event_idx on public.cs_auto_rules (event, enabled);

-- ---------------------------------------------------------------- the guard: the server's columns, the stamps

-- used / runs / last_run_at are the server's (the member's write of them is refused loudly); created_* / updated_* are stamped.
create or replace function public.cs_autoreply_guard() returns trigger
language plpgsql set search_path = public as $$
declare n jsonb := to_jsonb(new); o jsonb; -- the three tables share the trigger; a field the table lacks is read through jsonb
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(n ->> 'used', '0') <> '0' then raise exception 'used is the server''s' using errcode = '42501'; end if;
    if coalesce(n ->> 'runs', '0') <> '0' or n ->> 'last_run_at' is not null then raise exception 'runs is the server''s' using errcode = '42501'; end if;
    new.created_by := auth.uid(); new.created_at := now(); new.updated_by := auth.uid(); new.updated_at := now();
    return new;
  end if;
  o := to_jsonb(old);
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'the author cannot change' using errcode = '42501';
  end if;
  if n ->> 'used' is distinct from o ->> 'used' then raise exception 'used is the server''s' using errcode = '42501'; end if;
  if n ->> 'runs' is distinct from o ->> 'runs' or n ->> 'last_run_at' is distinct from o ->> 'last_run_at' then
    raise exception 'runs is the server''s' using errcode = '42501';
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
revoke execute on function public.cs_autoreply_guard() from public, anon, authenticated;
drop trigger if exists cs_templates_guard on public.cs_templates;
create trigger cs_templates_guard before insert or update on public.cs_templates for each row execute function public.cs_autoreply_guard();
drop trigger if exists cs_quick_replies_guard on public.cs_quick_replies;
create trigger cs_quick_replies_guard before insert or update on public.cs_quick_replies for each row execute function public.cs_autoreply_guard();
drop trigger if exists cs_auto_rules_guard on public.cs_auto_rules;
create trigger cs_auto_rules_guard before insert or update on public.cs_auto_rules for each row execute function public.cs_autoreply_guard();

-- ---------------------------------------------------------------- the run log (the server's)

create table if not exists public.cs_auto_runs (
  id bigserial primary key,
  rule_id uuid not null references public.cs_auto_rules on delete cascade,
  entity text not null check (entity ~ '^(order|sub|conv|transfer|cart):[A-Za-z0-9_-]{1,64}$'),
  customer_id uuid references public.cs_customers on delete set null,
  conversation_id uuid references public.cs_conversations on delete set null,
  message_id uuid references public.cs_messages on delete set null,
  result text not null check (result in ('sent', 'held', 'skipped', 'failed', 'ticket', 'assigned', 'tagged')),
  code text check (code is null or code ~ '^[a-z0-9_:-]{1,40}$'),
  due_at timestamptz,
  at timestamptz not null default now()
);
-- one live row a (rule × entity): «مرة واحدة»; a failed attempt may be retried
create unique index if not exists cs_auto_runs_once_idx on public.cs_auto_runs (rule_id, entity) where result <> 'failed';
create index if not exists cs_auto_runs_rule_idx on public.cs_auto_runs (rule_id, at desc);
create index if not exists cs_auto_runs_held_idx on public.cs_auto_runs (due_at) where result = 'held';
create index if not exists cs_auto_runs_customer_idx on public.cs_auto_runs (customer_id, at desc);

-- ---------------------------------------------------------------- RLS + grants

alter table public.cs_templates enable row level security;
alter table public.cs_quick_replies enable row level security;
alter table public.cs_auto_rules enable row level security;
alter table public.cs_auto_runs enable row level security;

drop policy if exists cs_templates_select on public.cs_templates;
create policy cs_templates_select on public.cs_templates for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
drop policy if exists cs_templates_write on public.cs_templates;
create policy cs_templates_write on public.cs_templates for all to authenticated
  using ((select public.has_perm('cs.manage')) = 'F') with check ((select public.has_perm('cs.manage')) = 'F');

drop policy if exists cs_quick_replies_select on public.cs_quick_replies;
create policy cs_quick_replies_select on public.cs_quick_replies for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
drop policy if exists cs_quick_replies_write on public.cs_quick_replies;
create policy cs_quick_replies_write on public.cs_quick_replies for all to authenticated
  using ((select public.has_perm('cs.manage')) = 'F') with check ((select public.has_perm('cs.manage')) = 'F');

drop policy if exists cs_auto_rules_select on public.cs_auto_rules;
create policy cs_auto_rules_select on public.cs_auto_rules for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
drop policy if exists cs_auto_rules_write on public.cs_auto_rules;
create policy cs_auto_rules_write on public.cs_auto_rules for all to authenticated
  using ((select public.has_perm('cs.manage')) = 'F') with check ((select public.has_perm('cs.manage')) = 'F');

drop policy if exists cs_auto_runs_select on public.cs_auto_runs;
create policy cs_auto_runs_select on public.cs_auto_runs for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');

revoke all on public.cs_templates, public.cs_quick_replies, public.cs_auto_rules, public.cs_auto_runs from anon, authenticated;
grant select on public.cs_templates, public.cs_quick_replies, public.cs_auto_rules, public.cs_auto_runs to authenticated;
grant insert (id, lib, name, cat, tone, body, trig_kind, trig_on, trig_when, channels, quick_key, wa_template, wa_vars, active) on public.cs_templates to authenticated;
grant update (lib, name, cat, tone, body, trig_kind, trig_on, trig_when, channels, quick_key, wa_template, wa_vars, active) on public.cs_templates to authenticated;
grant delete on public.cs_templates to authenticated;
grant insert (id, key, label, text) on public.cs_quick_replies to authenticated;
grant update (key, label, text) on public.cs_quick_replies to authenticated;
grant delete on public.cs_quick_replies to authenticated;
grant insert (id, name, grp, event, event_to, conds, action, template_id, role_id, tag, delay_min, once, ticket_if_silent, enabled) on public.cs_auto_rules to authenticated;
grant update (name, grp, event, event_to, conds, action, template_id, role_id, tag, delay_min, once, ticket_if_silent, enabled) on public.cs_auto_rules to authenticated;
grant delete on public.cs_auto_rules to authenticated;
grant all on public.cs_templates, public.cs_quick_replies, public.cs_auto_rules, public.cs_auto_runs to service_role;
grant usage on sequence public.cs_auto_runs_id_seq to service_role;

-- ---------------------------------------------------------------- the sending settings as the members read them

-- settings «cs».auto over the defaults (decision 6): live false, Cairo hours 9–22, a random 20–60 s gap, the daily caps (Meta's
-- business-initiated tier for an unverified number is 250 / 24 h — owner's decision 5), the after-hours text, the abandoned-cart
-- delay (decision 12). The members read it with cs.view; the admin writes the row itself (0002 — every other section is the admin's).
create or replace function public.cs_auto_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.has_perm('cs.view'), 'N') = 'N' then
    raise exception 'cs.view is needed' using errcode = '42501';
  end if;
  return jsonb_build_object('live', false, 'hours', jsonb_build_object('from', 9, 'to', 22), 'delayMin', 20, 'delayMax', 60,
                            'daily', jsonb_build_object('wa1', 250, 'wa2', 150), 'afterHoursText', 'شكرًا لرسالتك 🙏 مواعيد الرد من 9 ص لـ 10 م — هنرد عليك أول ما نفتح.',
                            'cart', jsonb_build_object('afterMin', 60))
         || coalesce((select case when jsonb_typeof(s.data -> 'auto') = 'object' then s.data -> 'auto' else '{}'::jsonb end
                        from public.settings s where s.section = 'cs'), '{}'::jsonb);
end $$;
revoke execute on function public.cs_auto_settings() from public, anon;
grant execute on function public.cs_auto_settings() to authenticated, service_role;
