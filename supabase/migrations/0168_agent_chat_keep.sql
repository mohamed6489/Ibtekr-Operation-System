-- 0168 — an assistant's chats go by themselves after the time the admin picks (Safwat 25 Nov — «الشات يتمسح بعد … تلقائي و حط في
-- الاعدادات بتاعة كل مساعد مدة تخزين المحادثات و خليه اختيار من اول ٢٤ ساعة او ٤٨ ساعة او ٧٢ ساعة او اسبوع او شهر او ٣ شهور … و خلي
-- الديفولت ٤٨ ساعة»; docs/superpowers/plans/2026-11-25-agent-chat-flows.md phase 1):
--   * settings «ai».agents.<id>.keep = the hours (24 · 48 · 72 · 168 · 720 · 2160) — anything else, or nothing, = 48;
--   * every hour a chat whose last message (updated_at) is older than its assistant's time is deleted the same way as the member's own
--     «مسح» (deleted_at = now — out of his list at once); the 48-hour clean-up (0132) takes it with its messages and the designer's images
--     a day later.
-- Re-runnable.

create or replace function public.ai_chat_keep_hours(p_agent text) returns int
language sql stable security definer set search_path = public as $$
  select case when h in (24, 48, 72, 168, 720, 2160) then h else 48 end
  from (select case when (s.data -> 'agents' -> p_agent ->> 'keep') ~ '^\d{1,4}$' then (s.data -> 'agents' -> p_agent ->> 'keep')::int else 48 end as h
        from (select coalesce((select data from public.settings where section = 'ai'), '{}'::jsonb) as data) s) x
$$;
revoke execute on function public.ai_chat_keep_hours(text) from public, anon;
grant execute on function public.ai_chat_keep_hours(text) to authenticated, service_role;

create or replace function public.ai_chats_expire() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.mkt_agent_chats c set deleted_at = now()
  where c.deleted_at is null and c.updated_at < now() - make_interval(hours => public.ai_chat_keep_hours(c.agent));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.ai_chats_expire() from public, anon, authenticated;
grant execute on function public.ai_chats_expire() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0168_agent_chat_keep: pg_cron not installed — the hourly job skipped';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'ai-chats-expire') then perform cron.unschedule('ai-chats-expire'); end if;
  perform cron.schedule('ai-chats-expire', '17 * * * *', $cron$ select public.ai_chats_expire() $cron$);
end $$;
