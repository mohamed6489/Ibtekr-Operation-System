-- 0064_cs_media_link — phase 13 T3 (docs/superpowers/plans/2026-11-09-phase-13-leftovers.md, decisions 6 and 8): the attachments of the
-- customer-service composer and «ربط بعميل موجود».
-- * Storage bucket «cs-media» (private, 10 MB, images + PDF): a member with cs.reply = F uploads into their own folder (<uid>/…) and the
--   row of cs_messages carries meta.media { path, type, name, size }; the server sends it to Meta through a signed link (one hour) and
--   keeps a customer's incoming WhatsApp media under inbound/<message id> when a member asks to download it (media_url). Any member
--   with cs.view F reads; cs.view P reads their own folder and the media of conversations they see (cs_media_visible). Nothing public.
-- * cs_link_contact(p_conversation, p_customer): a channel conversation whose user is not a customer yet (or is the wrong one) is tied
--   to an existing customer — the conversation's customer_id, the contact row of (platform, external_id), an event line; the guard of
--   0034 keeps members from writing customer_id directly, so this definer function is the only way (cs.reply = F, and the member must
--   see the conversation). Nothing is deleted; the old link, if any, is written in the event.
-- Every function: security definer + set search_path + revoke from public / anon + explicit grants (rule 4). Re-runnable.

-- who may read an object of cs-media (the select policy below): cs.view F = everything; otherwise the member's own folder, a customer's
-- media the server kept (inbound/<message id>.<ext>) when that message's conversation is visible to them (cs_conv_visible), or another
-- member's attachment that sits on a message of a visible conversation. Security definer so the lookup in cs_messages is not itself
-- filtered; the visibility rule is cs_conv_visible's (0034).
create or replace function public.cs_media_visible(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_view text := public.has_perm('cs.view'); v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_view = 'N' or p_name is null or p_name = '' then return false; end if;
  if v_view = 'F' then return true; end if;
  if v_folder = (select auth.uid())::text then return true; end if;
  if v_folder = 'inbound' then
    return exists (select 1 from public.cs_messages m
                   where m.id::text = split_part(split_part(p_name, '/', 2), '.', 1) and public.cs_conv_visible(m.conversation_id));
  end if;
  -- another member's attachment: the path must sit in that member's own folder (a row cannot lend a foreign folder)
  return exists (select 1 from public.cs_messages m
                 where m.meta->'media'->>'path' = p_name and m.kind = 'out' and m.author is not null and v_folder = m.author::text
                   and public.cs_conv_visible(m.conversation_id));
end
$$;
revoke execute on function public.cs_media_visible(text) from public, anon;
grant execute on function public.cs_media_visible(text) to authenticated, service_role;
-- a member's attachment lives in their own folder only (<uid>/…, no «..»); media_path / media_id are the server's — a member's row
-- never carries them (security review: a meta pointing at another folder or at inbound/ is refused at the write)
create or replace function public.cs_messages_media_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_path text;
begin
  if current_user in ('anon', 'authenticated') then
    if new.meta is null or jsonb_typeof(new.meta) <> 'object' then return new; end if;
    new.meta := new.meta - 'media_path' - 'media_id';
    v_path := new.meta->'media'->>'path';
    if v_path is not null and (position('..' in v_path) > 0 or v_path not like (select auth.uid())::text || '/%') then
      raise exception 'an attachment must sit in your own folder' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cs_messages_media_guard on public.cs_messages;
create trigger cs_messages_media_guard before insert or update on public.cs_messages
  for each row execute function public.cs_messages_media_guard();
create index if not exists cs_messages_media_path_idx on public.cs_messages ((meta->'media'->>'path')) where meta->'media'->>'path' is not null;

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('cs-media', 'cs-media', false, 10485760, '{image/png,image/jpeg,image/webp,image/gif,application/pdf}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
    execute $s$drop policy if exists cs_media_select on storage.objects$s$;
    execute $s$create policy cs_media_select on storage.objects for select to authenticated
               using (bucket_id = 'cs-media' and public.cs_media_visible(name))$s$;
    execute $s$drop policy if exists cs_media_insert on storage.objects$s$;
    execute $s$create policy cs_media_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'cs-media' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.has_perm('cs.reply')) = 'F')$s$;
  end if;
end $storage$;

create or replace function public.cs_link_contact(p_conversation uuid, p_customer uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_conv public.cs_conversations%rowtype;
  v_cust public.cs_customers%rowtype;
  v_old text; v_me uuid := auth.uid();
begin
  if not (public.is_admin() or public.has_perm('cs.reply') = 'F') then
    raise exception 'cs.reply = F is required to link a conversation to a customer' using errcode = '42501';
  end if;
  select * into v_conv from public.cs_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if not public.cs_conv_visible(p_conversation) then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if v_conv.seg = 'vendors' then raise exception 'invalid: conversation' using errcode = '22023'; end if;
  select * into v_cust from public.cs_customers where id = p_customer and merged_into is null;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if v_conv.customer_id is not distinct from p_customer then return p_customer; end if;
  select name into v_old from public.cs_customers where id = v_conv.customer_id;
  update public.cs_conversations set customer_id = p_customer, updated_at = now() where id = p_conversation;
  if v_conv.external_id is not null and v_conv.seg = 'customers' and v_conv.platform in ('whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook') then
    insert into public.cs_contacts (customer_id, platform, external_id, handle)
    values (p_customer, v_conv.platform, v_conv.external_id, v_conv.handle)
    on conflict (platform, external_id) do update set customer_id = excluded.customer_id;
  end if;
  insert into public.cs_messages (conversation_id, kind, text, author, delivery, meta)
  values (p_conversation, 'event', 'المحادثة اتربطت بالعميل «' || v_cust.name || '»' || case when v_old is not null then ' (كانت على «' || v_old || '»)' else '' end, v_me, null, jsonb_build_object('link', p_customer));
  insert into public.activity_log (action, entity, entity_id, new_value) values ('cs.conv.link', 'cs_conversation', p_conversation::text, to_jsonb(p_customer::text));
  return p_customer;
end
$$;
revoke execute on function public.cs_link_contact(uuid, uuid) from public, anon;
grant execute on function public.cs_link_contact(uuid, uuid) to authenticated, service_role;
