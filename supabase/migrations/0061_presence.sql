-- 0061 — phase 12 T5 (docs/superpowers/plans/2026-11-08-phase-12-followups.md, decisions 5 and 12): who is online.
-- One private Realtime channel «presence»: every active member joins it with the sign-in and tracks { uid, at } (nothing else — no
-- page, no text), and reads who else is there. The dashboard's «الفريق دلوقتي», the inbox's agent list and its round-robin read it.
-- Like 0039: the policies live on realtime.messages and are guarded so the file runs where the realtime schema is absent (the
-- local test cluster). Receive and send are both for the active member, on this topic and the presence extension only.

do $$ begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists presence_receive on realtime.messages';
    execute $p$create policy presence_receive on realtime.messages for select to authenticated
      using (realtime.topic() = 'presence' and extension = 'presence'
             and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'))$p$;
    execute 'drop policy if exists presence_send on realtime.messages';
    execute $p$create policy presence_send on realtime.messages for insert to authenticated
      with check (realtime.topic() = 'presence' and extension = 'presence'
                  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'))$p$;
  end if;
end $$;
