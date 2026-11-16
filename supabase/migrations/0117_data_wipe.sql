-- 0117 — «منطقة الخطر»: wipe chosen sections of the business data (docs/superpowers/plans/2026-11-16-data-page.md decision 6 — the owner
-- 16 Nov: «اعملي زرار منطقة خطر لمسح كل بيانات السيستم عشان يتنقل من ال stage للويبسايت الحقيقي او اي موقع تاني», by section).
-- data_wipe(p_sections, p_confirm, p_dry): the admin only, an aal2 session when 2FA is on (caller_aal_ok); the sections and their tables are
-- the fixed map below (a table that does not exist is skipped). The rows are DELETEd (never a truncate … cascade, which would empty every
-- table that merely points at them — the team requests or the HR log of a wiped order): a table outside the choice that points at it keeps
-- its rows and follows its own key — «on delete set null» unlinks («unlink»), «on delete cascade» loses the rows that point («cascade»),
-- and a restricting key with rows refuses the whole call («blocked»), as does a cascade into a table that belongs to no section (the team,
-- roles, settings, lists, …). The dry run returns all of that with the row counts; the real run needs p_confirm = 'امسح البيانات' and
-- writes one activity_log row (the section names and the row count only).
create or replace function public.data_wipe_map() returns table (section text, tbl text)
language sql immutable set search_path = public as $$
  select * from (values
    ('orders', 'orders'), ('orders', 'sub_orders'), ('orders', 'order_items'), ('orders', 'order_events'), ('orders', 'customer_ratings'), ('orders', 'returns'), ('orders', 'woo_webhook_events'), ('orders', 'sync_state'),
    ('vendors', 'vendors'), ('vendors', 'vendor_rates'), ('vendors', 'vendor_category_rates'), ('vendors', 'vendor_bank'), ('vendors', 'vendor_logins'), ('vendors', 'vendor_login_resets'), ('vendors', 'brands'), ('vendors', 'brand_owners'), ('vendors', 'brand_rates'),
    ('products', 'products'), ('products', 'woo_categories'), ('products', 'woo_brands'), ('products', 'product_commissions'), ('products', 'product_lead_days'), ('products', 'studio_batches'), ('products', 'image_imports'), ('products', 'image_shares'),
    ('accounts', 'acc_expenses'), ('accounts', 'acc_vendor_moves'), ('accounts', 'acc_account_moves'), ('accounts', 'acc_vendor_settlements'), ('accounts', 'dokan_withdrawals'), ('accounts', 'dokan_balances'),
    ('inventory', 'inv_lots'), ('inventory', 'inv_moves'), ('inventory', 'inv_consolidations'), ('inventory', 'inv_consolidation_items'), ('inventory', 'inv_counts'), ('inventory', 'inv_count_lines'),
    ('cs', 'cs_customers'), ('cs', 'cs_contacts'), ('cs', 'cs_customer_notes'), ('cs', 'cs_rating_overrides'), ('cs', 'cs_team_ratings'), ('cs', 'cs_conversations'), ('cs', 'cs_messages'), ('cs', 'cs_segments'), ('cs', 'cs_campaigns'), ('cs', 'cs_campaign_recipients'), ('cs', 'cs_posts'), ('cs', 'cs_carts'), ('cs', 'cs_auto_runs'),
    ('tickets', 'tickets'), ('tickets', 'ticket_events'),
    ('marketing', 'mkt_campaigns'), ('marketing', 'mkt_posts'), ('marketing', 'mkt_ad_objects'), ('marketing', 'mkt_ad_stats'), ('marketing', 'mkt_suggestions'), ('marketing', 'mkt_requests'), ('marketing', 'mkt_video_jobs'), ('marketing', 'mkt_agent_chats'), ('marketing', 'mkt_agent_messages'), ('marketing', 'mkt_trends'), ('marketing', 'mkt_competitors'), ('marketing', 'site_checks'),
    ('hr', 'hr_attendance'), ('hr', 'hr_overtime'), ('hr', 'hr_requests'), ('hr', 'hr_payroll'), ('hr', 'hr_payroll_lines'), ('hr', 'hr_payroll_paid'), ('hr', 'hr_adjustments'), ('hr', 'hr_evaluations'), ('hr', 'hr_scores'), ('hr', 'hr_extras'), ('hr', 'hr_meetings'), ('hr', 'hr_notes_log'), ('hr', 'hr_ot_adjust'), ('hr', 'hr_tasks'),
    ('logs', 'activity_log'), ('logs', 'alerts'), ('logs', 'alert_reads'), ('logs', 'alert_state'), ('logs', 'ai_runs'), ('logs', 'woo_sync_log'), ('logs', 'cs_channel_events'), ('logs', 'login_failures')
  ) v(section, tbl)
$$;
revoke execute on function public.data_wipe_map() from public, anon;
grant execute on function public.data_wipe_map() to authenticated, service_role;

create or replace function public.data_wipe(p_sections text[], p_confirm text default null, p_dry boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_known text[] := array(select distinct m.section from public.data_wipe_map() m);
  v_s text; v_n bigint; v_total bigint := 0; v_out jsonb := '[]'::jsonb; v_blocked text[] := '{}';
  v_chosen oid[]; v_left oid[]; v_rel oid; v_done boolean; v_owner text; r record;
begin
  if auth.uid() is null or not public.is_admin() or not public.caller_aal_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_sections is null or cardinality(p_sections) = 0 then raise exception 'invalid: sections' using errcode = '22023'; end if;
  foreach v_s in array p_sections loop if not v_s = any (v_known) then raise exception 'invalid: section %', v_s using errcode = '22023'; end if; end loop;
  select coalesce(array_agg(to_regclass('public.' || m.tbl)::oid), '{}') into v_chosen from public.data_wipe_map() m where m.section = any (p_sections) and to_regclass('public.' || m.tbl) is not null;
  -- the chosen tables and their rows
  for r in select m.section, m.tbl, to_regclass('public.' || m.tbl) rel from public.data_wipe_map() m where m.section = any (p_sections) and to_regclass('public.' || m.tbl) is not null loop
    execute format('select count(*) from %s', r.rel) into v_n; v_total := v_total + v_n;
    v_out := v_out || jsonb_build_object('section', r.section, 'table', r.tbl, 'rows', v_n, 'kind', 'wipe');
  end loop;
  -- the tables outside the choice that point at it, by their key's rule (the first column of the key)
  for r in select c.conrelid::regclass rel, (select cl.relname from pg_class cl where cl.oid = c.conrelid) tname, c.confdeltype,
                  (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) col
             from pg_constraint c where c.contype = 'f' and c.confrelid = any (v_chosen) and not c.conrelid = any (v_chosen) loop
    execute format('select count(*) from %s where %I is not null', r.rel, r.col) into v_n;
    continue when v_n = 0;
    select m.section into v_owner from public.data_wipe_map() m where m.tbl = r.tname limit 1;
    if r.confdeltype in ('a', 'r') or (r.confdeltype = 'c' and v_owner is null) then v_blocked := v_blocked || r.tname; end if;
    v_out := v_out || jsonb_build_object('section', coalesce(v_owner, ''), 'table', r.tname, 'rows', v_n,
      'kind', case when r.confdeltype in ('a', 'r') or (r.confdeltype = 'c' and v_owner is null) then 'blocked' when r.confdeltype = 'c' then 'cascade' else 'unlink' end);
  end loop;
  if p_dry then return jsonb_build_object('dry', true, 'tables', v_out, 'rows', v_total, 'blocked', to_jsonb(v_blocked)); end if;
  if cardinality(v_blocked) > 0 then raise exception 'blocked: %', array_to_string(v_blocked, ', ') using errcode = '22023'; end if;
  if coalesce(btrim(p_confirm), '') <> 'امسح البيانات' then raise exception 'invalid: confirm' using errcode = '22023'; end if;
  -- delete table by table; a table still pointed at by a chosen one that is not empty yet waits for the next pass
  v_left := v_chosen;
  loop
    exit when cardinality(v_left) = 0; v_done := false;
    foreach v_rel in array v_left loop
      begin execute format('delete from %s', v_rel::regclass); v_left := array_remove(v_left, v_rel); v_done := true;
      exception when foreign_key_violation then null; end;
    end loop;
    if not v_done then raise exception 'blocked: %', (select string_agg(x::regclass::text, ', ') from unnest(v_left) x) using errcode = '22023'; end if;
  end loop;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), 'settings.data.wipe', 'settings', null, jsonb_build_object('sections', to_jsonb(p_sections), 'rows', v_total));
  return jsonb_build_object('dry', false, 'tables', v_out, 'rows', v_total, 'blocked', '[]'::jsonb);
end
$$;
revoke execute on function public.data_wipe(text[], text, boolean) from public, anon;
grant execute on function public.data_wipe(text[], text, boolean) to authenticated, service_role;
