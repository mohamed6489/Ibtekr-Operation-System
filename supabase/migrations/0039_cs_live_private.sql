-- 0039_cs_live_private — 0038's live line, made private (4 Nov, after the security review): on a public topic anyone holding the
-- site's anon key could watch the inbox's activity and send fake «changed» pings that make every open page reload. Now:
-- * the trigger sends with private = true;
-- * realtime.messages lets a signed-in member with cs.view ≠ N receive on «cs-inbox», and nobody send on it (no insert policy —
--   only the database's own realtime.send writes there);
-- * the page subscribes with { config: { private: true } } (app/js/adapter/cs.js).
-- No realtime schema (a plain local Postgres) = the policy part is skipped. Re-runnable.
create or replace function public.cs_notify_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    begin
      execute 'select realtime.send($1, $2, $3, $4)' using jsonb_build_object('at', now()), 'changed', 'cs-inbox', true;
    exception when others then null; -- the write goes on; the pages' 10-second check picks it up
    end;
  end if;
  return null;
end $$;
revoke execute on function public.cs_notify_inbox() from public, anon, authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists cs_inbox_receive on realtime.messages';
    execute $p$create policy cs_inbox_receive on realtime.messages for select to authenticated
      using (realtime.topic() = 'cs-inbox' and extension = 'broadcast' and (select public.has_perm('cs.view')) <> 'N')$p$;
  end if;
end $$;
