-- 0038_cs_live — phase 6.2 (4 Nov, the owner: «عايز الرسايل تبقى لحظية كأنه شات»): the inbox's postgres_changes subscription never
-- fires on the live project, so every write on cs_messages / cs_conversations now also sends one Realtime broadcast from the
-- database itself — topic «cs-inbox», event «changed», payload { at } only (no id, no text, no name: a public channel carries
-- nothing but «something changed»). The open pages subscribe to it and fetch through their own RLS. One per statement; a broadcast
-- that fails never blocks the write; no realtime schema (a plain local Postgres) = nothing sent. Re-runnable.
create or replace function public.cs_notify_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    begin
      execute 'select realtime.send($1, $2, $3, $4)' using jsonb_build_object('at', now()), 'changed', 'cs-inbox', false;
    exception when others then null; -- the write goes on; the pages' 10-second check picks it up
    end;
  end if;
  return null;
end $$;
revoke execute on function public.cs_notify_inbox() from public, anon, authenticated;

drop trigger if exists cs_messages_notify on public.cs_messages;
create trigger cs_messages_notify after insert or update on public.cs_messages
  for each statement execute function public.cs_notify_inbox();
drop trigger if exists cs_conversations_notify on public.cs_conversations;
create trigger cs_conversations_notify after insert or update on public.cs_conversations
  for each statement execute function public.cs_notify_inbox();
