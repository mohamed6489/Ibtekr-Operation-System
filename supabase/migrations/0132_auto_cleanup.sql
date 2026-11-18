-- 0132 — the automatic clean-up every 48 hours (the owner 18 Nov: «عايز يتعمل تنظيف اتوماتيك للdatabase كل 48 ساعة للحاجة اللي ملهاش
-- لازمة» — and his answers to what each item touches, «ابدأ في التنضيف التلقائي»). The notify tick runs it once every 48 hours
-- (_shared/cleanup.js): the files go through the Storage API first (Supabase refuses a delete on storage.objects from SQL), then the rows.
-- What goes (and only this — orders, accounts, makers, products, customers, HR, requests, campaigns, the activity log and the AI spend
-- log are never touched):
--   * the site sync log (woo_sync_log) and the site's webhook deliveries (woo_webhook_events) older than 30 days
--   * the scheduled jobs' own log (cron.job_run_details) older than 7 days
--   * the expired link and sign-in rows: OAuth states (Meta / the ads / Magnific) older than a day, the portal's reset links a day after
--     they ended or were used, a sign-in counter idle a day and not locked
--   * the channels' event log (cs_channel_events) older than 30 days
--   * the bell's alerts older than 60 days that were read (by their member, or by anyone of a role's)
--   * the assistants' notes older than 30 days (a problem still there is written again by its next check)
--   * the chats a member deleted (a day after) with their messages and the designer's images under agents/<member>/<chat>/
--   * the studio batches archived 30 days ago with their files (studio/<batch>/…)
--   * the images tool's files (bucket ai-images) older than 30 days — saved on a product, the site keeps its own copy
--   * the finished video jobs (done / failed) older than 30 days and their files — never a file a campaign or a post still names
-- cleanup_plan(p_limit) lists the file-bearing rows and their files (read only); data_cleanup(p_studio, p_jobs, p_chats) deletes the logs
-- and the rows named — each one checked again against its rule — and returns the counts. Both service_role only. Re-runnable.

create or replace function public.cleanup_plan(p_limit int default 500)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lim int := greatest(1, least(coalesce(p_limit, 500), 2000));
        v_studio jsonb; v_images jsonb; v_jobs jsonb; v_chats jsonb;
begin
  -- the studio batches archived 30 days ago, and their files
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'files', coalesce((select jsonb_agg(o.name) from storage.objects o
           where o.bucket_id = 'studio' and o.name like b.id::text || '/%'), '[]'::jsonb))), '[]'::jsonb)
    into v_studio
    from (select id from public.studio_batches where archived_at is not null and archived_at < now() - interval '30 days' order by archived_at limit v_lim) b;
  -- the images tool's files older than 30 days
  select coalesce(jsonb_agg(o.name), '[]'::jsonb) into v_images
    from (select name from storage.objects where bucket_id = 'ai-images' and created_at < now() - interval '30 days' order by created_at limit v_lim) o;
  -- the finished video jobs; a file only when no campaign and no post names it (the final video stays)
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'file',
           case when j.path is null or j.path = '' then null
                when exists (select 1 from public.mkt_campaigns c where position(j.path in c.state::text) > 0) then null
                when exists (select 1 from public.mkt_posts p where position(j.path in p.images::text) > 0) then null
                else j.path end)), '[]'::jsonb)
    into v_jobs
    from (select id, path from public.mkt_video_jobs where status in ('done', 'failed') and updated_at < now() - interval '30 days' order by updated_at limit v_lim) j;
  -- the chats their member deleted a day ago, and the designer's images under agents/<member>/<chat>/
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'files', coalesce((select jsonb_agg(o.name) from storage.objects o
           where o.bucket_id = 'marketing' and o.name like 'agents/' || c.member_id::text || '/' || c.id::text || '/%'), '[]'::jsonb))), '[]'::jsonb)
    into v_chats
    from (select id, member_id from public.mkt_agent_chats where deleted_at is not null and deleted_at < now() - interval '1 day' order by deleted_at limit v_lim) c;
  return jsonb_build_object('studio', v_studio, 'images', v_images, 'jobs', v_jobs, 'chats', v_chats);
end
$$;
revoke execute on function public.cleanup_plan(int) from public, anon, authenticated;
grant execute on function public.cleanup_plan(int) to service_role;

create or replace function public.data_cleanup(p_studio uuid[] default '{}', p_jobs bigint[] default '{}', p_chats uuid[] default '{}')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n jsonb := '{}'::jsonb; c int;
begin
  delete from public.woo_sync_log where at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('sync_log', c);
  delete from public.woo_webhook_events where received_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('webhook_events', c);
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''7 days''';
    get diagnostics c = row_count; n := n || jsonb_build_object('cron_log', c);
  end if;
  delete from public.cs_oauth_states where created_at < now() - interval '1 day';
  get diagnostics c = row_count; n := n || jsonb_build_object('oauth_states', c);
  if to_regclass('public.magnific_oauth_states') is not null then
    delete from public.magnific_oauth_states where created_at < now() - interval '1 day';
    get diagnostics c = row_count; n := n || jsonb_build_object('oauth_states', (n->>'oauth_states')::int + c);
  end if;
  delete from public.vendor_login_resets where expires_at < now() - interval '1 day' or (used_at is not null and used_at < now() - interval '1 day');
  get diagnostics c = row_count; n := n || jsonb_build_object('reset_links', c);
  delete from public.login_failures where last_at < now() - interval '1 day' and (locked_until is null or locked_until < now());
  get diagnostics c = row_count; n := n || jsonb_build_object('login_counters', c);
  delete from public.cs_channel_events where received_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('channel_events', c);
  delete from public.alerts a where a.at < now() - interval '60 days'
    and (a.read_at is not null or exists (select 1 from public.alert_reads r where r.alert_id = a.id));
  get diagnostics c = row_count; n := n || jsonb_build_object('alerts', c);
  delete from public.ai_agent_notes where created_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('agent_notes', c);
  -- the rows whose files went first — each checked again against its rule
  delete from public.mkt_agent_chats where id = any (coalesce(p_chats, '{}')) and deleted_at is not null and deleted_at < now() - interval '1 day';
  get diagnostics c = row_count; n := n || jsonb_build_object('chats', c);
  delete from public.studio_batches where id = any (coalesce(p_studio, '{}')) and archived_at is not null and archived_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('studio_batches', c);
  delete from public.mkt_video_jobs where id = any (coalesce(p_jobs, '{}')) and status in ('done', 'failed') and updated_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n || jsonb_build_object('video_jobs', c);
  return n;
end
$$;
revoke execute on function public.data_cleanup(uuid[], bigint[], uuid[]) from public, anon, authenticated;
grant execute on function public.data_cleanup(uuid[], bigint[], uuid[]) to service_role;
