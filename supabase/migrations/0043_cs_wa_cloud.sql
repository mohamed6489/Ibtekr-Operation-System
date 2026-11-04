-- 0043_cs_wa_cloud — phase 6, decision 26 (the owner, 4 Nov: «عايز أحط الواتساب بتاع الصفحة في السيستم»): WhatsApp 1 (the
-- customers) on Meta's WhatsApp Cloud API by coexistence — the owner's WhatsApp Business app number keeps working on the phone, and
-- the Edge Function cs-whatsapp receives its messages, the replies sent from the phone (smb_message_echoes), the last six months of
-- history and the contacts, and sends the members' replies from the same number. WhatsApp 2 (the makers) stays on the QR bridge.
-- * cs_channels wa1: kind 'meta' (the QR bridge's cs-wa ignores wa1 from now on).
-- * cs_oauth_states.channel takes 'wa1' (the Embedded Signup sign-in the admin starts from the channels tab).
-- * cs_secret_get / cs_secret_set take a second name, 'meta_wa' (the business token of the onboarded WhatsApp account, its WABA
--   and phone number ids) — still service_role only, still Vault.
-- Re-runnable.

update public.cs_channels set kind = 'meta' where id = 'wa1' and kind <> 'meta';

alter table public.cs_oauth_states drop constraint if exists cs_oauth_states_channel_check;
alter table public.cs_oauth_states add constraint cs_oauth_states_channel_check check (channel in ('messenger', 'instagram', 'wa1'));

create or replace function public.cs_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('meta_pages', 'meta_wa') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = 'cs_' || p_name;
  return v_value;
end
$$;

-- p_value null = the secret is removed (disconnect)
create or replace function public.cs_secret_set(p_name text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('meta_pages', 'meta_wa') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.id into v_id from vault.secrets s where s.name = 'cs_' || p_name;
  if p_value is null then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, 'cs_' || p_name, 'customer service Meta channel (0035_cs_meta / 0043_cs_wa_cloud)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$$;

-- The history (the last six months the phone shares once): its messages carry meta.history = true and their original time. The
-- touch of 0034 would count each one as unread and «waiting since now»; a history message only moves the conversation's times
-- forward to its own (never to now), and leaves unread / waiting alone. The guard keeps that server-given updated_at for the one
-- statement (the transaction-local flag cs.keep_updated_at, set by the touch itself) — every other update still stamps now().
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
    if current_user in ('anon', 'authenticated') or coalesce(current_setting('cs.keep_updated_at', true), '') <> 'on' then new.updated_at := now(); end if;
    if new.status = 'اتحلت' and old.status <> 'اتحلت' then new.closed_at := now(); new.closed_by := coalesce(auth.uid(), new.closed_by); end if;
    if new.status <> 'اتحلت' then new.closed_at := null; new.closed_by := null; end if;
  end if;
  return new;
end $$;

create or replace function public.cs_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.meta ->> 'history', '') = 'true' then
    perform set_config('cs.keep_updated_at', 'on', true);
    update public.cs_conversations
       set updated_at = greatest(updated_at, new.created_at),
           last_out_at = case when new.kind = 'out' then greatest(coalesce(last_out_at, new.created_at), new.created_at) else last_out_at end,
           last_in_at = case when new.kind = 'in' then greatest(coalesce(last_in_at, new.created_at), new.created_at) else last_in_at end
     where id = new.conversation_id;
    perform set_config('cs.keep_updated_at', '', true);
    return new;
  end if;
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

revoke execute on function public.cs_secret_get(text) from public, anon, authenticated;
revoke execute on function public.cs_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.cs_secret_get(text) to service_role;
grant execute on function public.cs_secret_set(text, text) to service_role;
