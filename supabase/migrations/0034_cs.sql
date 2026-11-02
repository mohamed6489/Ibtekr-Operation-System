-- 0034_cs: customer service on real data (phase 6.1). Plan docs/superpowers/plans/2026-11-02-phase-6-customer-service.md,
-- decisions 2–3. Uses has_perm / is_admin (0001), the roles (0003), profiles, orders / order_items / returns (0007),
-- customer_ratings (0018), vendors (0011), settings (0002), mask_phone (0007).
--
-- Decision 2: three new permission keys in roles.permissions — cs.view (F everything / P my assigned conversations + the
--   customers / N), cs.reply (reply, note, status, assign, close, tags, mood, merge, block) and cs.manage (segments,
--   campaigns, customer edits, imports). The customer's phone follows sensitive.customer_phone (mask_phone otherwise).
-- Decision 3: cs_customers come from the orders (trigger + a re-runnable backfill, by the normalised phone) and from the
--   team (manual / import; the channels add contacts in 6.2). The purchase figures are computed on demand by
--   cs_customers_list() (security definer behind cs.view) — never stored. Conversations / messages / segments /
--   campaigns / channels are the page's own tables; the channels start «disconnected» (6.2 connects Meta, 6.4 WhatsApp).
--   Members write notes, events and outgoing messages (kind out, delivery queued — the server sends them from 6.2);
--   incoming (in) and automatic (auto) messages are the server's.
--
-- Notes for readers:
-- * Re-runnable: create … if not exists, create or replace, policies created only when missing. No drop / delete of data.
-- * rule 4: explicit grants (members: select everywhere; insert / update where the policies allow; delete on segments and
--   draft campaigns only); nothing for anon; no truncate / references / trigger for any API role.
-- * Guards keep the identity columns of a conversation (seg, platform, channel, who, external_id) and of a customer
--   (phone, created_from) out of a member's reach, and let cs.reply alone change only mood / tags on a customer.

-- ---------------------------------------------------------------- permissions (decision 2)

update public.roles r set permissions = d.perms || r.permissions
from (values
  ('admin',            '{"cs.view":"F","cs.reply":"F","cs.manage":"F"}'::jsonb),
  ('cs',               '{"cs.view":"F","cs.reply":"F","cs.manage":"F"}'::jsonb),
  ('ops',              '{"cs.view":"F","cs.reply":"F","cs.manage":"N"}'::jsonb),
  ('vendors_followup', '{"cs.view":"F","cs.reply":"F","cs.manage":"N"}'::jsonb),
  ('accounts',         '{"cs.view":"N","cs.reply":"N","cs.manage":"N"}'::jsonb),
  ('viewer',           '{"cs.view":"P","cs.reply":"N","cs.manage":"N"}'::jsonb)
) as d(id, perms)
where r.id = d.id and not (r.permissions ? 'cs.view');

-- ---------------------------------------------------------------- norm_phone

-- The customer's phone as one key: Arabic-Indic digits → ASCII, digits only, 0020… / 20… (12 digits) → local, a 10-digit
-- number starting with 1 gets its leading 0. '' when nothing is left. Same as normPhone in block 19 (IbtekrCS).
create or replace function public.norm_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when l = '' then ''
    when char_length(l) = 10 and left(l, 1) = '1' then '0' || l
    else l
  end
  from (
    select case
      when d like '0020%' then substr(d, 5)
      when d like '20%' and char_length(d) = 12 then substr(d, 3)
      else d
    end as l
    from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g') as d) s
  ) t
$$;

create index if not exists orders_norm_phone_idx on public.orders (public.norm_phone(customer_phone));

-- ---------------------------------------------------------------- customers

create table if not exists public.cs_customers (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone is null or (phone ~ '^\d{6,15}$')),
  name text not null check (char_length(name) between 1 and 120),
  ig text check (ig is null or char_length(ig) <= 80),
  city text check (city is null or char_length(city) <= 120),
  province text check (province is null or char_length(province) <= 40),
  address text check (address is null or char_length(address) <= 300),
  address2 text check (address2 is null or char_length(address2) <= 300),
  mood text check (mood is null or mood in ('سعيد', 'متوسط', 'متضايق')),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  consent boolean not null default true,
  auto_consent boolean not null default true,
  source text check (source is null or char_length(source) <= 200),
  created_from text not null default 'manual' check (created_from in ('orders', 'manual', 'import', 'channel')),
  blocked_at timestamptz,
  blocked_by uuid references public.profiles,
  merged_into uuid references public.cs_customers,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists cs_customers_name_idx on public.cs_customers (lower(name));

create table if not exists public.cs_contacts (
  id bigserial primary key,
  customer_id uuid not null references public.cs_customers on delete cascade,
  platform text not null check (platform in ('whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook')),
  external_id text not null check (char_length(external_id) <= 120),
  handle text check (handle is null or char_length(handle) <= 120),
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);

create table if not exists public.cs_customer_notes (
  id bigserial primary key,
  customer_id uuid not null references public.cs_customers on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  author uuid references public.profiles default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists cs_customer_notes_customer_idx on public.cs_customer_notes (customer_id);

create table if not exists public.cs_rating_overrides (
  id bigserial primary key,
  customer_id uuid not null references public.cs_customers on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  reason text not null check (char_length(reason) between 1 and 300),
  by_user uuid references public.profiles default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists cs_rating_overrides_customer_idx on public.cs_rating_overrides (customer_id, at desc);

-- A member with cs.reply alone may change mood / tags only; cs.manage edits the rest; phone / created_from / created_by /
-- created_at are never a member's to change (the phone is the key to the orders); updated_at is stamped here.
create or replace function public.cs_customers_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  n jsonb; o jsonb;
  light constant text[] := array['mood', 'tags', 'updated_at'];
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.created_from not in ('manual', 'import') then
        raise exception 'a member adds a customer as manual or import' using errcode = '42501';
      end if;
      new.created_by := auth.uid(); new.created_at := now(); new.merged_into := null; new.blocked_at := null; new.blocked_by := null;
    else
      n := to_jsonb(new); o := to_jsonb(old);
      if (n -> 'phone') is distinct from (o -> 'phone') or (n -> 'created_from') is distinct from (o -> 'created_from')
         or (n -> 'created_by') is distinct from (o -> 'created_by') or (n -> 'created_at') is distinct from (o -> 'created_at') then
        raise exception 'the phone and the created_* columns of a customer are fixed' using errcode = '42501';
      end if;
      if (n - light) is distinct from (o - light) and (select public.has_perm('cs.manage')) <> 'F' then
        raise exception 'cs.manage = F is required to edit a customer (cs.reply changes mood and tags only)' using errcode = '42501';
      end if;
      if new.blocked_at is distinct from old.blocked_at then new.blocked_by := case when new.blocked_at is null then null else auth.uid() end; end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists cs_customers_guard on public.cs_customers;
create trigger cs_customers_guard before insert or update on public.cs_customers
  for each row execute function public.cs_customers_guard();

-- The customers from the orders: on a new order (or a changed name / phone) the normalised phone gets a row; an existing row
-- keeps the team's name / city / address (the first order fills what is empty). Definer: the sync (service_role) and a
-- member's status change both fire it; the member may not insert customers from orders.
create or replace function public.cs_customer_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text := public.norm_phone(new.customer_phone);
begin
  if p = '' then return new; end if;
  insert into public.cs_customers (phone, name, city, address, province, created_from, created_by)
  values (p, coalesce(nullif(btrim(new.customer_name), ''), 'عميل'), nullif(btrim(new.customer_city), ''), nullif(btrim(new.customer_address), ''), nullif(btrim(new.customer_state), ''), 'orders', null)
  on conflict (phone) do update set
    city = coalesce(public.cs_customers.city, excluded.city),
    address = coalesce(public.cs_customers.address, excluded.address),
    province = coalesce(public.cs_customers.province, excluded.province);
  return new;
end $$;
revoke execute on function public.cs_customer_from_order() from public, anon, authenticated;

drop trigger if exists orders_cs_customer on public.orders;
create trigger orders_cs_customer after insert or update of customer_phone, customer_name on public.orders
  for each row execute function public.cs_customer_from_order();

-- Backfill (re-runnable): one customer per normalised phone, named from the first order; existing rows untouched.
insert into public.cs_customers (phone, name, city, address, province, created_from, created_by)
select distinct on (public.norm_phone(o.customer_phone)) public.norm_phone(o.customer_phone),
       coalesce(nullif(btrim(o.customer_name), ''), 'عميل'), nullif(btrim(o.customer_city), ''), nullif(btrim(o.customer_address), ''), nullif(btrim(o.customer_state), ''), 'orders', null
from public.orders o
where public.norm_phone(o.customer_phone) <> ''
order by public.norm_phone(o.customer_phone), o.placed_at asc
on conflict (phone) do nothing;

-- ---------------------------------------------------------------- conversations and messages

create table if not exists public.cs_conversations (
  id uuid primary key default gen_random_uuid(),
  seg text not null check (seg in ('customers', 'vendors', 'comments')),
  platform text not null check (platform in ('whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook')),
  channel text not null check (channel in ('wa1', 'wa2', 'messenger', 'instagram', 'tiktok', 'facebook')),
  customer_id uuid references public.cs_customers on delete set null,
  vendor_id uuid references public.vendors on delete set null,
  handle text check (handle is null or char_length(handle) <= 120),
  external_id text check (external_id is null or char_length(external_id) <= 160),
  status text not null default 'جديدة' check (status in ('جديدة', 'مستنية ردنا', 'مستنية العميل', 'مؤجلة', 'اتحلت')),
  assignee uuid references public.profiles,
  outcome text check (outcome is null or char_length(outcome) <= 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  last_in_at timestamptz,
  last_out_at timestamptz,
  waiting_since timestamptz,
  unread int not null default 0 check (unread >= 0),
  snoozed_until timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint cs_conversations_party check (
    (seg = 'customers' and vendor_id is null) or (seg = 'vendors' and vendor_id is not null and customer_id is null) or (seg = 'comments' and vendor_id is null))
);
create index if not exists cs_conversations_customer_idx on public.cs_conversations (customer_id);
create index if not exists cs_conversations_vendor_idx on public.cs_conversations (vendor_id);
create index if not exists cs_conversations_status_idx on public.cs_conversations (status, updated_at desc);
create unique index if not exists cs_conversations_external_idx on public.cs_conversations (channel, external_id) where external_id is not null;

create table if not exists public.cs_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.cs_conversations on delete cascade,
  kind text not null check (kind in ('in', 'out', 'note', 'auto', 'event')),
  text text not null check (char_length(text) between 1 and 4000),
  author uuid references public.profiles,
  external_id text check (external_id is null or char_length(external_id) <= 160),
  delivery text check (delivery is null or delivery in ('queued', 'sent', 'delivered', 'read', 'failed')),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists cs_messages_conversation_idx on public.cs_messages (conversation_id, created_at);
create unique index if not exists cs_messages_external_idx on public.cs_messages (external_id) where external_id is not null;

-- A member may open a conversation by hand (seg customers / vendors, no external_id: nothing is on a channel yet), change its
-- status / assignee / tags / outcome / snooze / close / unread; never its identity, its timestamps of the channel, nor the
-- server's columns. Stamps updated_at, closed_* on «اتحلت».
create or replace function public.cs_conversations_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  n jsonb; o jsonb;
  member_cols constant text[] := array['status', 'assignee', 'tags', 'outcome', 'snoozed_until', 'unread', 'closed_at', 'closed_by', 'updated_at'];
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.external_id is not null or new.seg = 'comments' or new.last_in_at is not null then
        raise exception 'a member opens a plain conversation: no channel thread, no comment' using errcode = '42501';
      end if;
      new.created_by := auth.uid(); new.created_at := now(); new.unread := 0;
    else
      n := to_jsonb(new); o := to_jsonb(old);
      if (n - member_cols) is distinct from (o - member_cols) then
        raise exception 'only the status, assignee, tags, outcome, snooze and read state of a conversation can be changed here' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'اتحلت' and old.status <> 'اتحلت' then new.closed_at := now(); new.closed_by := coalesce(auth.uid(), new.closed_by); end if;
    if new.status <> 'اتحلت' then new.closed_at := null; new.closed_by := null; end if;
  end if;
  return new;
end $$;

drop trigger if exists cs_conversations_guard on public.cs_conversations;
create trigger cs_conversations_guard before insert or update on public.cs_conversations
  for each row execute function public.cs_conversations_guard();

-- Members write notes, events and outgoing messages (queued for the server) as themselves; in / auto are the server's. A
-- member's message touches its conversation (updated_at, last_out_at for `out`).
create or replace function public.cs_messages_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.kind not in ('note', 'event', 'out') then
      raise exception 'incoming and automatic messages are written by the server' using errcode = '42501';
    end if;
    new.author := auth.uid(); new.created_at := now(); new.external_id := null;
    if new.kind = 'out' then new.delivery := 'queued'; else new.delivery := null; end if;
  end if;
  return new;
end $$;

drop trigger if exists cs_messages_guard on public.cs_messages;
create trigger cs_messages_guard before insert on public.cs_messages
  for each row execute function public.cs_messages_guard();

create or replace function public.cs_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.cs_conversations
     set updated_at = now(),
         last_out_at = case when new.kind = 'out' then now() else last_out_at end,
         last_in_at = case when new.kind = 'in' then now() else last_in_at end,
         unread = case when new.kind = 'in' then unread + 1 else unread end,
         waiting_since = case when new.kind = 'in' and waiting_since is null then now() when new.kind = 'out' then null else waiting_since end
   where id = new.conversation_id;
  return new;
end $$;
revoke execute on function public.cs_messages_after() from public, anon, authenticated;

drop trigger if exists cs_messages_after on public.cs_messages;
create trigger cs_messages_after after insert on public.cs_messages
  for each row execute function public.cs_messages_after();

-- ---------------------------------------------------------------- segments, campaigns, channels

create table if not exists public.cs_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  min_total numeric(12,2) check (min_total is null or min_total >= 0),
  min_orders int check (min_orders is null or min_orders >= 0),
  moods text[] not null default '{}' check (moods <@ array['سعيد', 'متوسط', 'متضايق']::text[]),
  last_kind text check (last_kind is null or last_kind in ('in7', 'in30', 'in90', 'gt30', 'gt60', 'gt90', 'range')),
  last_from date,
  last_to date,
  ranges jsonb not null default '{}',
  include_unrated boolean not null default false,
  add_ids uuid[] not null default '{}',
  remove_ids uuid[] not null default '{}',
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index if not exists cs_segments_name_idx on public.cs_segments (lower(btrim(name)));

create table if not exists public.cs_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  segment_id uuid references public.cs_segments on delete set null,
  channel text not null default 'wa1' check (channel in ('wa1', 'wa2', 'messenger', 'instagram')),
  body text check (body is null or char_length(body) <= 2000),
  image_path text check (image_path is null or char_length(image_path) <= 300),
  discount_code text check (discount_code is null or char_length(discount_code) <= 40),
  scheduled_at timestamptz,
  cap_per_day int not null default 300 check (cap_per_day between 1 and 5000),
  min_delay_s int not null default 20 check (min_delay_s between 1 and 3600),
  test_phone text check (test_phone is null or test_phone ~ '^\d{6,15}$'),
  status text not null default 'مسودة' check (status in ('مسودة', 'مجدولة', 'شغالة', 'متوقفة', 'خلصت')),
  size int not null default 0 check (size >= 0),
  stats jsonb not null default '{}',
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.cs_campaign_recipients (
  id bigserial primary key,
  campaign_id uuid not null references public.cs_campaigns on delete cascade,
  customer_id uuid references public.cs_customers on delete set null,
  phone text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'replied', 'ordered', 'failed', 'opted_out')),
  at timestamptz,
  reply text check (reply is null or char_length(reply) <= 500),
  unique (campaign_id, customer_id)
);

create table if not exists public.cs_channels (
  id text primary key check (id in ('wa1', 'wa2', 'messenger', 'instagram', 'tiktok')),
  name text not null,
  audience text not null check (audience in ('customers', 'vendors', 'both')),
  kind text not null check (kind in ('qr', 'meta', 'none')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  number text,
  cap_per_day int not null default 300,
  since timestamptz,
  last_message_at timestamptz,
  meta jsonb not null default '{}',
  updated_at timestamptz
);

insert into public.cs_channels (id, name, audience, kind, cap_per_day) values
  ('wa1', 'واتساب 1 · العملاء', 'customers', 'qr', 300),
  ('wa2', 'واتساب 2 · المبتكرين', 'vendors', 'qr', 150),
  ('messenger', 'ماسنجر', 'customers', 'meta', 1000),
  ('instagram', 'إنستجرام', 'customers', 'meta', 1000),
  ('tiktok', 'تيك توك', 'customers', 'none', 0)
on conflict (id) do nothing;

-- Campaign guard: a member writes drafts / schedules; the running columns are the server's (6.3).
create or replace function public.cs_campaigns_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.status not in ('مسودة', 'مجدولة') then raise exception 'a member saves a draft or a schedule' using errcode = '42501'; end if;
      new.created_by := auth.uid(); new.created_at := now(); new.stats := '{}';
    else
      if old.status in ('شغالة', 'خلصت') and (old.status is distinct from new.status or old.body is distinct from new.body or old.segment_id is distinct from new.segment_id) then
        raise exception 'a running or finished campaign is not edited' using errcode = '42501';
      end if;
      if new.status not in ('مسودة', 'مجدولة', 'متوقفة') then raise exception 'a member sets draft, scheduled or paused' using errcode = '42501'; end if;
      new.stats := old.stats;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists cs_campaigns_guard on public.cs_campaigns;
create trigger cs_campaigns_guard before insert or update on public.cs_campaigns
  for each row execute function public.cs_campaigns_guard();

create or replace function public.cs_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cs_segments_touch on public.cs_segments;
create trigger cs_segments_touch before update on public.cs_segments for each row execute function public.cs_touch();

-- ---------------------------------------------------------------- the customers' figures (decision 3)

-- Every customer with the figures the page shows, computed from the orders of the same normalised phone (deleted orders
-- left out): orders / total (not cancelled, failed or returned) / last order / refused (فشل) / returned (استرجاع) / open
-- complaints (open conversations tagged «شكوى») / late open orders (open for 11+ days) / conversations / the team's rating
-- average over the orders' customer_ratings / the latest manual override / the last five orders. The phone follows
-- sensitive.customer_phone. cs.view = N → 42501.
create or replace function public.cs_customers_list()
returns table (
  id uuid, phone text, name text, ig text, city text, province text, address text, address2 text, mood text, tags text[],
  consent boolean, auto_consent boolean, source text, created_from text, blocked_at timestamptz, merged_into uuid, created_at timestamptz,
  orders bigint, total numeric, last_order_at timestamptz, refused bigint, returned bigint, open_complaints bigint, late_open bigint,
  conversations bigint, rating_avg numeric, rating_count bigint, override_stars smallint, override_reason text, order_list jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_full boolean := public.is_admin() or coalesce(public.has_perm('sensitive.customer_phone'), 'N') = 'F';
begin
  if coalesce(public.has_perm('cs.view'), 'N') = 'N' then
    raise exception 'cs.view is needed' using errcode = '42501';
  end if;
  return query
  select c.id,
         case when c.phone is null then null when v_full then c.phone else public.mask_phone(c.phone) end,
         c.name, c.ig, c.city, c.province, c.address, c.address2, c.mood, c.tags, c.consent, c.auto_consent, c.source, c.created_from,
         c.blocked_at, c.merged_into, c.created_at,
         coalesce(o.orders, 0), coalesce(o.total, 0), o.last_order_at, coalesce(o.refused, 0), coalesce(o.returned, 0),
         coalesce(cv.complaints, 0), coalesce(o.late_open, 0), coalesce(cv.conversations, 0),
         r.rating_avg, coalesce(r.rating_count, 0), ov.stars, ov.reason, coalesce(o.order_list, '[]'::jsonb)
  from public.cs_customers c
  left join lateral (
    select count(*) filter (where x.status not in ('ملغي', 'فشل', 'استرجاع')) as orders,
           coalesce(sum(x.total) filter (where x.status not in ('ملغي', 'فشل', 'استرجاع')), 0) as total,
           max(x.placed_at) as last_order_at,
           count(*) filter (where x.status = 'فشل') as refused,
           count(*) filter (where x.status = 'استرجاع') as returned,
           count(*) filter (where x.status in ('جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن') and x.placed_at < now() - interval '11 days') as late_open,
           (select jsonb_agg(jsonb_build_object('id', y.id, 'status', y.status, 'total', y.total, 'placed_at', y.placed_at) order by y.placed_at desc)
              from (select z.id, z.status, z.total, z.placed_at from public.orders z
                     where c.phone is not null and public.norm_phone(z.customer_phone) = c.phone and z.deleted_at is null
                     order by z.placed_at desc limit 5) y) as order_list
    from public.orders x
    where c.phone is not null and public.norm_phone(x.customer_phone) = c.phone and x.deleted_at is null
  ) o on true
  left join lateral (
    select count(*) as conversations,
           count(*) filter (where v.status <> 'اتحلت' and 'شكوى' = any(v.tags)) as complaints
    from public.cs_conversations v where v.customer_id = c.id
  ) cv on true
  left join lateral (
    select round(avg((cr.sat + cr.manners) / 2.0), 1) as rating_avg, count(*) as rating_count
    from public.customer_ratings cr join public.orders x2 on x2.id = cr.order_id
    where c.phone is not null and public.norm_phone(x2.customer_phone) = c.phone
  ) r on true
  left join lateral (
    select ro.stars, ro.reason from public.cs_rating_overrides ro where ro.customer_id = c.id order by ro.at desc limit 1
  ) ov on true
  where c.merged_into is null;
end $$;
revoke execute on function public.cs_customers_list() from public, anon;
grant execute on function public.cs_customers_list() to authenticated, service_role;

-- ---------------------------------------------------------------- RLS

alter table public.cs_customers enable row level security;
alter table public.cs_contacts enable row level security;
alter table public.cs_customer_notes enable row level security;
alter table public.cs_rating_overrides enable row level security;
alter table public.cs_conversations enable row level security;
alter table public.cs_messages enable row level security;
alter table public.cs_segments enable row level security;
alter table public.cs_campaigns enable row level security;
alter table public.cs_campaign_recipients enable row level security;
alter table public.cs_channels enable row level security;

-- A conversation the caller may see: cs.view = F → all; P → the ones assigned to them.
create or replace function public.cs_conv_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(public.has_perm('cs.view'), 'N')
    when 'F' then true
    when 'P' then exists (select 1 from public.cs_conversations v where v.id = p_id and v.assignee = auth.uid())
    else false end
$$;
revoke execute on function public.cs_conv_visible(uuid) from public, anon;
grant execute on function public.cs_conv_visible(uuid) to authenticated, service_role;

do $$ begin
  -- customers: read with cs.view; add (manual / import) with cs.manage; update with cs.reply (the guard narrows it to mood / tags) or cs.manage
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_customers' and policyname = 'cs_customers_select') then
    create policy cs_customers_select on public.cs_customers for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
    create policy cs_customers_insert on public.cs_customers for insert to authenticated with check ((select public.has_perm('cs.manage')) = 'F');
    create policy cs_customers_update on public.cs_customers for update to authenticated
      using ((select public.has_perm('cs.view')) <> 'N' and ((select public.has_perm('cs.reply')) = 'F' or (select public.has_perm('cs.manage')) = 'F'))
      with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_contacts' and policyname = 'cs_contacts_select') then
    create policy cs_contacts_select on public.cs_contacts for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_customer_notes' and policyname = 'cs_customer_notes_select') then
    create policy cs_customer_notes_select on public.cs_customer_notes for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
    create policy cs_customer_notes_insert on public.cs_customer_notes for insert to authenticated
      with check ((select public.has_perm('cs.reply')) = 'F' and author = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_rating_overrides' and policyname = 'cs_rating_overrides_select') then
    create policy cs_rating_overrides_select on public.cs_rating_overrides for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
    create policy cs_rating_overrides_insert on public.cs_rating_overrides for insert to authenticated
      with check ((select public.has_perm('cs.reply')) = 'F' and by_user = (select auth.uid()));
  end if;
  -- conversations: F sees all, P the assigned ones; reply opens / changes
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_conversations' and policyname = 'cs_conversations_select') then
    create policy cs_conversations_select on public.cs_conversations for select to authenticated
      using ((select public.has_perm('cs.view')) = 'F' or ((select public.has_perm('cs.view')) = 'P' and assignee = (select auth.uid())));
    create policy cs_conversations_insert on public.cs_conversations for insert to authenticated with check ((select public.has_perm('cs.reply')) = 'F');
    create policy cs_conversations_update on public.cs_conversations for update to authenticated
      using ((select public.has_perm('cs.reply')) = 'F' and public.cs_conv_visible(id)) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_messages' and policyname = 'cs_messages_select') then
    create policy cs_messages_select on public.cs_messages for select to authenticated using (public.cs_conv_visible(conversation_id));
    create policy cs_messages_insert on public.cs_messages for insert to authenticated
      with check ((select public.has_perm('cs.reply')) = 'F' and public.cs_conv_visible(conversation_id));
  end if;
  -- segments and campaigns: read with cs.view; everything else cs.manage
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_segments' and policyname = 'cs_segments_select') then
    create policy cs_segments_select on public.cs_segments for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
    create policy cs_segments_insert on public.cs_segments for insert to authenticated with check ((select public.has_perm('cs.manage')) = 'F');
    create policy cs_segments_update on public.cs_segments for update to authenticated using ((select public.has_perm('cs.manage')) = 'F') with check (true);
    create policy cs_segments_delete on public.cs_segments for delete to authenticated using ((select public.has_perm('cs.manage')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_campaigns' and policyname = 'cs_campaigns_select') then
    create policy cs_campaigns_select on public.cs_campaigns for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
    create policy cs_campaigns_insert on public.cs_campaigns for insert to authenticated with check ((select public.has_perm('cs.manage')) = 'F');
    create policy cs_campaigns_update on public.cs_campaigns for update to authenticated using ((select public.has_perm('cs.manage')) = 'F') with check (true);
    create policy cs_campaigns_delete on public.cs_campaigns for delete to authenticated using ((select public.has_perm('cs.manage')) = 'F' and status = 'مسودة');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_campaign_recipients' and policyname = 'cs_campaign_recipients_select') then
    create policy cs_campaign_recipients_select on public.cs_campaign_recipients for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cs_channels' and policyname = 'cs_channels_select') then
    create policy cs_channels_select on public.cs_channels for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
  end if;
end $$;

-- ---------------------------------------------------------------- grants (rule 4)

grant select, insert, update on public.cs_customers to authenticated;
grant select on public.cs_contacts to authenticated;
grant select, insert on public.cs_customer_notes, public.cs_rating_overrides to authenticated;
grant select, insert, update on public.cs_conversations to authenticated;
grant select, insert on public.cs_messages to authenticated;
grant select, insert, update, delete on public.cs_segments, public.cs_campaigns to authenticated;
grant select on public.cs_campaign_recipients, public.cs_channels to authenticated;
grant usage, select on sequence public.cs_contacts_id_seq, public.cs_customer_notes_id_seq, public.cs_rating_overrides_id_seq, public.cs_campaign_recipients_id_seq to authenticated, service_role;
grant select, insert, update, delete on public.cs_customers, public.cs_contacts, public.cs_customer_notes, public.cs_rating_overrides, public.cs_conversations,
  public.cs_messages, public.cs_segments, public.cs_campaigns, public.cs_campaign_recipients, public.cs_channels to service_role;
revoke truncate, references, trigger on public.cs_customers, public.cs_contacts, public.cs_customer_notes, public.cs_rating_overrides, public.cs_conversations,
  public.cs_messages, public.cs_segments, public.cs_campaigns, public.cs_campaign_recipients, public.cs_channels from anon, authenticated, service_role;
revoke all on public.cs_customers, public.cs_contacts, public.cs_customer_notes, public.cs_rating_overrides, public.cs_conversations,
  public.cs_messages, public.cs_segments, public.cs_campaigns, public.cs_campaign_recipients, public.cs_channels from anon;
revoke execute on function public.cs_customers_guard(), public.cs_conversations_guard(), public.cs_messages_guard(), public.cs_campaigns_guard(), public.cs_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------- Realtime (guarded)

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cs_conversations', 'cs_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
