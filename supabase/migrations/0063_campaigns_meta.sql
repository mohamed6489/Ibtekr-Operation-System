-- 0063_campaigns_meta — phase 13 T1 (docs/superpowers/plans/2026-11-09-phase-13-leftovers.md, decisions 1–4): the campaigns on
-- WhatsApp 1 go out through Meta's Cloud API with an approved marketing template (never free text), sent by cs-whatsapp's
-- campaign_tick on a one-minute cron; the bridge path (cs-wa, the QR numbers) is unchanged.
-- * cs_campaigns.template_id → cs_templates (the template whose wa_template is the approved Meta name; its wa_vars are filled from
--   the customer's first name and the campaign's discount code). A member sets it on a draft / scheduled campaign like the body; a
--   running or finished campaign's template is not edited (the guard, re-created).
-- * cron cs-campaign-tick: every minute → cs-whatsapp { action: 'campaign_tick' } with the sync secret of 0008 (nothing is sent
--   while settings «cs».live.campaigns is off — decision 24 of phase 6, now toggled by the admin from the channels tab).
-- Re-runnable; no drop / delete of data.

alter table public.cs_campaigns add column if not exists template_id uuid references public.cs_templates on delete set null;
create index if not exists cs_campaigns_template_idx on public.cs_campaigns (template_id) where template_id is not null;
grant select (template_id) on public.cs_campaigns to authenticated; -- insert / update are table-wide grants (0034)

create or replace function public.cs_campaigns_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.status not in ('مسودة', 'مجدولة') then raise exception 'a member saves a draft or a schedule' using errcode = '42501'; end if;
      new.created_by := auth.uid(); new.created_at := now(); new.stats := '{}';
    else
      if old.status in ('شغالة', 'خلصت') and (old.status is distinct from new.status or old.body is distinct from new.body or old.segment_id is distinct from new.segment_id or old.template_id is distinct from new.template_id) then
        raise exception 'a running or finished campaign is not edited' using errcode = '42501';
      end if;
      if new.status not in ('مسودة', 'مجدولة', 'متوقفة') then raise exception 'a member sets draft, scheduled or paused' using errcode = '42501'; end if;
      new.stats := old.stats;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

-- ---------------------------------------------------------------- cs-campaign-tick: every minute → cs-whatsapp, with the sync secret of 0008
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0063: pg_cron / pg_net / Vault not here — cs-campaign-tick is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'cs-campaign-tick') then perform cron.unschedule('cs-campaign-tick'); end if;
  perform cron.schedule('cs-campaign-tick', '* * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/cs-whatsapp',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"campaign_tick"}'::jsonb,
      timeout_milliseconds := 60000
    )
  $cron$);
end $$;
