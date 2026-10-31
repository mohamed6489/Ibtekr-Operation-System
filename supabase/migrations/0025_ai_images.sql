-- 0025_ai_images: product images with the AI (phase 5.4). Uses ai_runs / ai_run_start (0024), has_perm (0008), the bucket
-- pattern of 0023. The plan: docs/superpowers/plans/2026-10-31-phase-5-4-images.md.
--
-- Decision 3: ai_runs takes action 'image' (a generated or edited image: a studio slot, the images tool) with source 'studio'
--   (a slot), 'tool' (the images tool) or 'edit' (an edit of an existing image), and a `credits` column: the provider (Magnific)
--   bills in credits, so the images' monthly cap counts credits (settings «ai».image_monthly_credits, read by the server); cost_usd
--   stays an estimate for the shared view.
-- Decision 3 (security review, 31 Oct): ai_image_run_start(row, cap_credits, credits, cost, throttle, window) — the images' own
--   reservation, in the same locked step as ai_run_start (the same advisory lock, so content and image reservations serialize
--   together): the member's throttle → 'busy' (no row); this Cairo month's image credits (ai_month_credits(): pending rows at
--   their planned credits) + p_credits over p_cap_credits → a 'cap' row at 0 → 'cap'; else a 'pending' row holding p_credits and
--   its USD estimate → 'ok' + its id, and the server writes the outcome on it after the call. Two parallel calls cannot both pass
--   the cap. service_role only. ai_month_credits() is readable by members too (their own rows under RLS, the admin's all).
-- Decision 2: bucket ai-images — private, 20 MB, WebP / PNG / JPEG — for the images tool's results: the server writes
--   (service_role), a member with products.add or products.edit = F reads and deletes their own folder (<uid>/…) only; the
--   studio's generated slot images live in bucket studio under the batch (its 0023 policies).
--
-- Notes for readers:
-- * Re-runnable: constraints dropped and added again, add column if not exists, policies dropped and created again, the
--   storage block guarded.
-- * rule 4: no new table; the grants of 0024 stand (members select only).

alter table public.ai_runs drop constraint if exists ai_runs_action_check;
alter table public.ai_runs add constraint ai_runs_action_check check (action in ('write', 'studio', 'image'));
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit'));
alter table public.ai_runs add column if not exists credits int not null default 0 check (credits >= 0);

-- ---------------------------------------------------------------- the images' month and reservation (decision 3)

-- this Cairo month's image credits of the rows the caller reads (RLS: a member's own, the admin's all, the server's every row)
create or replace function public.ai_month_credits()
returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(credits), 0)::bigint from public.ai_runs
  where action = 'image'
    and created_at >= (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')
$$;
revoke execute on function public.ai_month_credits() from public, anon;
grant execute on function public.ai_month_credits() to authenticated, service_role;

create or replace function public.ai_image_run_start(p_row jsonb, p_cap_credits int, p_credits int, p_cost numeric, p_throttle int, p_window_minutes int)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_by uuid := nullif(p_row ->> 'created_by', '')::uuid;
  v_id bigint;
begin
  -- the same lock as ai_run_start (0024): one reservation at a time, content or image
  perform pg_advisory_xact_lock(hashtext('public.ai_run_start'));
  if v_by is not null and p_throttle is not null and (
       select count(*) from public.ai_runs
       where created_by = v_by and created_at >= now() - make_interval(mins => coalesce(p_window_minutes, 10))
     ) >= p_throttle then
    return jsonb_build_object('result', 'busy');
  end if;
  if p_cap_credits is not null and public.ai_month_credits() + coalesce(p_credits, 0) > p_cap_credits then
    insert into public.ai_runs (created_by, action, source, label, product_id, batch_id, item_index, model, status, error, credits, cost_usd)
    values (v_by, 'image', p_row ->> 'source', p_row ->> 'label', (p_row ->> 'product_id')::bigint, (p_row ->> 'batch_id')::uuid,
            (p_row ->> 'item_index')::int, p_row ->> 'model', 'cap', 'ai_cap', 0, 0)
    returning id into v_id;
    return jsonb_build_object('result', 'cap', 'id', v_id);
  end if;
  insert into public.ai_runs (created_by, action, source, label, product_id, batch_id, item_index, model, status, credits, cost_usd)
  values (v_by, 'image', p_row ->> 'source', p_row ->> 'label', (p_row ->> 'product_id')::bigint, (p_row ->> 'batch_id')::uuid,
          (p_row ->> 'item_index')::int, p_row ->> 'model', 'pending', greatest(coalesce(p_credits, 0), 0), greatest(coalesce(p_cost, 0), 0))
  returning id into v_id;
  return jsonb_build_object('result', 'ok', 'id', v_id);
end $$;
revoke execute on function public.ai_image_run_start(jsonb, int, int, numeric, int, int) from public, anon, authenticated;
grant execute on function public.ai_image_run_start(jsonb, int, int, numeric, int, int) to service_role;

-- ---------------------------------------------------------------- Storage: bucket ai-images + policies (decision 2, guarded)

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('ai-images', 'ai-images', false, 20971520, '{image/webp,image/png,image/jpeg}')
               on conflict (id) do nothing$s$;
    execute $s$drop policy if exists ai_images_select on storage.objects$s$;
    execute $s$create policy ai_images_select on storage.objects for select to authenticated
               using (bucket_id = 'ai-images'
                      and ((select public.has_perm('products.add')) = 'F' or (select public.has_perm('products.edit')) = 'F')
                      and (storage.foldername(name))[1] = (select auth.uid())::text)$s$;
    execute $s$drop policy if exists ai_images_delete on storage.objects$s$;
    execute $s$create policy ai_images_delete on storage.objects for delete to authenticated
               using (bucket_id = 'ai-images'
                      and ((select public.has_perm('products.add')) = 'F' or (select public.has_perm('products.edit')) = 'F')
                      and (storage.foldername(name))[1] = (select auth.uid())::text)$s$;
    -- no insert / update for members: the server (service_role) writes the results
  end if;
end $storage$;
