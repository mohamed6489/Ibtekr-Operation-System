-- 0121 — the Arabic translation of each site category (the owner 17 Nov, on the bulk «نسبة إبتكر»: «لو موجود انجليزي بس او عربي بس
-- يتغير عادي لاني هبقي غيرت نسبة القسم بتاعه»). The mirror keeps the English terms only (Dokan's commission tree); a product that is
-- on the site in Arabic only carries the Arabic term ids, so the page maps them to their English category through this id.
-- Written by the sync alone (woo-sync categories: WPML's translations.ar on the English term); members read it with the table.
alter table public.woo_categories add column if not exists ar_id bigint;
comment on column public.woo_categories.ar_id is 'WPML: the id of this category''s Arabic translation on the site (woo-sync writes it; null = none)';
create index if not exists woo_categories_ar_id on public.woo_categories (ar_id) where ar_id is not null;
