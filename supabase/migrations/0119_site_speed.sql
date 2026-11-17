-- 0119 — «أداء الموقع» for the developer (docs/superpowers/plans/2026-11-17-agents-team.md decision 1 — the owner 17 Nov: «خلي المبرمج
-- يقدر يعرف البيرفورمانس بتاع الموقع عندي»). site_checks (0109) takes a second kind, 'pagespeed': the last Google PageSpeed run of the
-- linked site (woo-sync `site_speed` — numbers and English titles only), read with marketing.view like 'wp_updates', written by the
-- server only. pg_cron 'woo-sync-speed' runs it once a day by the sync secret (guarded like 0019). No new grant; re-runnable.

alter table public.site_checks drop constraint if exists site_checks_kind_check;
alter table public.site_checks add constraint site_checks_kind_check check (kind in ('wp_updates', 'pagespeed'));

do $$
begin
  if not (exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net')
          and exists (select 1 from pg_extension where extname = 'supabase_vault')) then
    raise notice '0119_site_speed: pg_cron / pg_net / supabase_vault not installed — the speed job skipped';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'woo-sync-speed') then
    perform cron.unschedule('woo-sync-speed');
  end if;
  perform cron.schedule('woo-sync-speed', '41 5 * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"site_speed"}'::jsonb,
      timeout_milliseconds := 150000
    )
  $cron$);
end $$;
