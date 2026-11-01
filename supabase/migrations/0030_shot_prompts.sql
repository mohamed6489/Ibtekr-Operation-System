-- 0030_shot_prompts — phase 5.4 decision 12 (docs/superpowers/plans/2026-10-31-phase-5-4-images.md): the owner generates on the
-- Magnific site with the Unlimited plan inside ONE Space («استوديو ابتكر»), a flow a batch (the batch's photos as a list → three
-- image generators with the category's unified prompts → three output lists). The prompts live here, one row a category and a shot
-- (1 the product in focus, 2 the product in its place, 3 the close-up of the details), read from the owner's own template Space by
-- ai-images action bridge_prompts_sync (the admin) and editable from the system; a batch's flow takes its category's three rows.
-- rule 4: select for every member who sees products (products.view <> N), insert / update for the admin, everything for
-- service_role, nothing for anon; no delete for members. Re-runnable.

create table if not exists public.shot_prompts (
  id bigserial primary key,
  category text not null check (length(btrim(category)) between 1 and 80),
  shot int not null check (shot between 1 and 3),
  name text not null default '' check (length(name) <= 160),
  prompt text not null check (length(prompt) between 1 and 6000),
  negative text check (negative is null or length(negative) <= 1000),
  model text check (model is null or model ~ '^[a-z0-9-]{1,60}$'),
  aspect text check (aspect is null or aspect ~ '^(auto|\d{1,2}:\d{1,2}|\d(\.\d+)?:\d)$'),
  resolution text check (resolution is null or resolution in ('1k', '2k', '4k')),
  source_node text check (source_node is null or source_node ~ '^[0-9a-f-]{36}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null,
  unique (category, shot)
);
alter table public.shot_prompts enable row level security;

drop policy if exists shot_prompts_select on public.shot_prompts;
create policy shot_prompts_select on public.shot_prompts for select to authenticated
  using (public.has_perm('products.view') <> 'N');
drop policy if exists shot_prompts_insert on public.shot_prompts;
create policy shot_prompts_insert on public.shot_prompts for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists shot_prompts_update on public.shot_prompts;
create policy shot_prompts_update on public.shot_prompts for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.shot_prompts from anon, authenticated;
grant select, insert, update on public.shot_prompts to authenticated;
grant all on public.shot_prompts to service_role;
grant usage, select on sequence public.shot_prompts_id_seq to authenticated, service_role;

create or replace function public.shot_prompts_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.updated_by is null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists shot_prompts_touch on public.shot_prompts;
create trigger shot_prompts_touch before insert or update on public.shot_prompts for each row execute function public.shot_prompts_touch();
