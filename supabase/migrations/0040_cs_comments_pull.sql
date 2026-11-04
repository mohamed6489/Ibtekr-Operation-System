-- 0040_cs_comments_pull.sql — phase 6.2 decision 18: the Facebook / Instagram comments pulled every minute.
--
-- Why: Meta sends no comment webhook (Page `feed`, Instagram `comments`) to an app without Advanced Access — seen live on
-- 4 Nov: an app member's comment on both platforms, its author visible to Graph, the page subscribed to feed, the permissions
-- all granted, and no delivery. cs-channel action `comments_pull` reads the latest posts' comments with the page token and
-- feeds them through the webhook's own path (dedupe on the comment id), so the inbox gets them within a minute; after App
-- Review the webhooks arrive too and the pull stays as the safety net.
--
-- Notes for readers:
-- * The cron uses the sync secret of 0008 (Vault `sync_secret`, checked by sync_secret_matches) — no new secret. cs-channel
--   takes X-Sync-Secret for `comments_pull` only (never a member's action), and the admin can run it by hand with their JWT.
-- * Guarded like 0008: pg_cron + pg_net + Vault only where they exist (the local stub skips the schedule). A re-run
--   unschedules the job first, so there is always one.
-- * The body posts to the project's public functions URL (the project ref is public in app/config.js); only the secret is
--   secret, read from vault.decrypted_secrets at run time.

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0040: pg_cron / pg_net / Vault not here — the comments pull is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'cs-comments-pull') then
    perform cron.unschedule('cs-comments-pull');
  end if;
  perform cron.schedule('cs-comments-pull', '* * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-channel',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"comments_pull"}'::jsonb,
      timeout_milliseconds := 30000
    )
  $cron$);
end $$;
