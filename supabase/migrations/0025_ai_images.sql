-- 0025_ai_images: product images with the AI (phase 5.4). Uses ai_runs / ai_run_start (0024), has_perm (0008), the bucket
-- pattern of 0023. The plan: docs/superpowers/plans/2026-10-31-phase-5-4-images.md.
--
-- Decision 3: ai_runs takes action 'image' (a generated or edited image: a studio slot, the images tool) with source 'studio'
--   (a slot), 'tool' (the images tool) or 'edit' (an edit of an existing image), and a `credits` column: the provider (Magnific)
--   bills in credits, so the images' monthly cap counts credits (settings «ai».image_monthly_credits, read by the server); cost_usd
--   stays an estimate for the shared view. The reservation and the member's throttle still go through ai_run_start (its row
--   copies action / source / label / batch / item / model; the server writes credits and the outcome after the call).
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
