-- 0088 — owner batch 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md, decision 9): a category's image in the mirror.
-- The categories tab shows a small image before each name: the sync (writeTerms in _shared/woo-write.js, the part «categories» and
-- category_create / category_update) writes the site's image URL — https only — beside the name and the slug. Read like the rest of
-- woo_categories (the table-wide select of 0014 / the policy of 0021). Re-runnable.
alter table public.woo_categories add column if not exists image_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'woo_categories_image_url_https') then
    alter table public.woo_categories add constraint woo_categories_image_url_https check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 600));
  end if;
end $$;
