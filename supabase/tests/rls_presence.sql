-- 0061 (phase 12 T5): the presence channel's two policies on realtime.messages — receive and send for an active member on the
-- topic «presence» with the presence extension only. Guarded like the migration: where the realtime schema is absent (the local
-- test cluster) the file only says so. Live-safe (reads pg_policies). Prints NOTICE 'rls_presence: ok'.
begin;
do $$
declare n int;
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'rls_presence: no realtime schema here — the policies are checked on the live project';
    return;
  end if;
  select count(*) into n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname in ('presence_receive', 'presence_send');
  if n <> 2 then raise exception 'case the presence policies exist failed (% of 2)', n; end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'presence_receive' and cmd = 'SELECT' and qual like '%presence%' and qual like '%status = ''active''%') then
    raise exception 'case presence_receive is a select for active members on the presence topic failed';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'presence_send' and cmd = 'INSERT' and with_check like '%presence%' and with_check like '%status = ''active''%') then
    raise exception 'case presence_send is an insert for active members on the presence topic failed';
  end if;
end $$;
do $$ begin raise notice 'rls_presence: ok'; end $$;
rollback;
