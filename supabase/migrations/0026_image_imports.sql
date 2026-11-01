-- 0026_image_imports — phase 5.4 decision 8 (docs/superpowers/plans/2026-10-31-phase-5-4-images.md): images made on the Magnific
-- site (the owner's Unlimited plan, which the API does not carry) reach the system through a queue:
-- * a Claude session reads the site's library through the Magnific MCP connector and inserts one row per set here (as postgres,
--   through the Supabase MCP — members never insert; the row names its owner in created_by, the images' https links in urls and
--   the site's creation identifiers in refs, so a set is never queued twice);
-- * the owner (or the admin) imports the row from the images tool: ai-images action 'import' fetches the links (allowed hosts
--   only), stores the files under the member in bucket ai-images, writes one ai_runs row (action 'image', source 'import',
--   0 credits) and marks the row ok / partial / error with the stored paths (aligned with urls; null where a link failed).
-- * rule 4: select for authenticated (own rows, the admin all), everything for service_role, nothing for anon. Re-runnable.

create table if not exists public.image_imports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles on delete cascade,
  source text not null default 'magnific' check (source in ('magnific')),
  folder text check (folder is null or length(folder) <= 120),
  label text check (label is null or length(label) <= 200),
  product_id bigint,
  urls jsonb not null check (jsonb_typeof(urls) = 'array' and jsonb_array_length(urls) between 1 and 50),
  refs jsonb check (refs is null or jsonb_typeof(refs) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'ok', 'partial', 'error')),
  paths jsonb check (paths is null or jsonb_typeof(paths) = 'array'),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  run_id bigint references public.ai_runs on delete set null,
  done_at timestamptz
);
create index if not exists image_imports_owner_idx on public.image_imports (created_by, status, created_at desc);
create index if not exists image_imports_refs_idx on public.image_imports using gin (refs);
alter table public.image_imports enable row level security;

drop policy if exists image_imports_select on public.image_imports;
create policy image_imports_select on public.image_imports for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

revoke all on public.image_imports from anon, authenticated;
grant select on public.image_imports to authenticated;
grant all on public.image_imports to service_role;
grant all on sequence public.image_imports_id_seq to service_role;

-- an imported set is an image run of its own source (0 credits — the month's credits do not count it)
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import'));
