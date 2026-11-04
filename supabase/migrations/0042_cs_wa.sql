-- 0042_cs_wa.sql — phase 6.3 + 6.4 (decisions 21–24): WhatsApp 1 / 2 by QR through the wa-bridge service, and the campaigns' sending.
--
-- * cs_wa_state: one row per WhatsApp channel — the bridge's state (qr / connecting / connected / logged_out / offline), the QR as an
--   SVG the bridge draws, the linked number, and a command the admin leaves for the bridge (logout). service_role only: the admin reads
--   it through cs-wa (wa_status), never directly.
-- * cs_messages.claimed_at: an outgoing WhatsApp message handed to the bridge (outbox) is claimed for two minutes, so a bridge restart
--   never sends it twice. Not granted to members.
-- * cs_campaign_recipients: wa_id / error / claimed_at for the sending (server only; members read the old columns as before).
-- * cs_campaign_schedule(p_id, p_customers, p_at): the audience frozen when the campaign is scheduled — the queued recipients are
--   replaced by the picked customers who agreed, are not blocked or merged and have a phone (read here, never from the page); the
--   campaign becomes «مجدولة» at p_at with its size. cs.manage = F. Returns the size.
--
-- Notes for readers:
-- * The bridge never holds a service key: cs-wa (service_role) is the only writer of these columns.
-- * Hidden until the owner opens it (decision 24): settings «cs».live = { wa, campaigns } — no column here.

create table if not exists public.cs_wa_state (
  channel text primary key check (channel in ('wa1', 'wa2')),
  status text not null default 'offline' check (status in ('offline', 'qr', 'connecting', 'connected', 'logged_out')),
  qr_svg text check (qr_svg is null or char_length(qr_svg) <= 60000),
  phone text check (phone is null or phone ~ '^\d{6,15}$'),
  command text check (command is null or command in ('logout')),
  updated_at timestamptz not null default now()
);
insert into public.cs_wa_state (channel) values ('wa1'), ('wa2') on conflict (channel) do nothing;
alter table public.cs_wa_state enable row level security;
revoke all on public.cs_wa_state from anon, authenticated;
grant select, insert, update on public.cs_wa_state to service_role;

alter table public.cs_messages add column if not exists claimed_at timestamptz;
alter table public.cs_campaign_recipients add column if not exists wa_id text check (wa_id is null or char_length(wa_id) <= 200);
alter table public.cs_campaign_recipients add column if not exists error text check (error is null or char_length(error) <= 120);
alter table public.cs_campaign_recipients add column if not exists claimed_at timestamptz;
create index if not exists cs_campaign_recipients_queue_idx on public.cs_campaign_recipients (campaign_id, status);

create or replace function public.cs_campaign_schedule(p_id uuid, p_customers uuid[], p_at timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare st text; n int;
begin
  if coalesce(public.has_perm('cs.manage'), 'N') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  select status into st from public.cs_campaigns where id = p_id for update;
  if st is null then raise exception 'no campaign' using errcode = 'P0002'; end if;
  if st not in ('مسودة', 'متوقفة') then raise exception 'campaign is %', st using errcode = '22023'; end if;
  if p_customers is null or cardinality(p_customers) = 0 or cardinality(p_customers) > 50000 then raise exception 'bad audience' using errcode = '22023'; end if;
  delete from public.cs_campaign_recipients where campaign_id = p_id and status = 'queued';
  insert into public.cs_campaign_recipients (campaign_id, customer_id, phone, status)
  select p_id, c.id, c.phone, 'queued' from public.cs_customers c
  where c.id = any(p_customers) and c.phone is not null and c.consent and c.blocked_at is null and c.merged_into is null
  on conflict (campaign_id, customer_id) do nothing;
  select count(*) into n from public.cs_campaign_recipients where campaign_id = p_id and status = 'queued';
  if n = 0 then raise exception 'empty audience' using errcode = '22023'; end if;
  update public.cs_campaigns set status = 'مجدولة', scheduled_at = coalesce(p_at, now()), size = n, updated_at = now() where id = p_id;
  return n;
end $$;
revoke execute on function public.cs_campaign_schedule(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.cs_campaign_schedule(uuid, uuid[], timestamptz) to authenticated, service_role;
