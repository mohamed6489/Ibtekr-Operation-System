-- 0085 — the visitor's abandoned carts: the cron off (the owner, 14 Nov — «تمام» to stopping it)
-- woo-sync's part «carts» (phase 12 T7, 0062) needs the WPCode snippet tools/wp-snippets/ibtekr-carts.php on the site, and the owner
-- keeps it off (9 Nov — «مش هحط snippet»). Without it every run since 9 Nov failed (the site answers the unknown route with
-- 401 invalid_username), 569+ error rows. The abandoned-cart messages that work come from the orders stuck at payment (6.5 decision 12),
-- not from this table. Re-runnable; to bring it back with the snippet, run 0062's cron block again.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0085_carts_cron_off: pg_cron not installed — nothing to stop';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'woo-sync-carts') then
    perform cron.unschedule('woo-sync-carts');
  end if;
end $$;
