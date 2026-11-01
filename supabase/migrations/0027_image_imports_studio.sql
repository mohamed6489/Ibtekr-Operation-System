-- 0027_image_imports_studio — phase 5.4 decision 9: a queued Magnific set can become a studio batch («صور بس» through Magnific).
-- The bridge (a Claude session) names the target and the items it read from the creations' names (the owner names each image
-- on the site with the product's details); ai-images 'import' with target 'studio' creates the batch (brand / maker / type as
-- queued, the images as the items' photos in bucket studio, step 2) and keeps its id on the row. Additive, re-runnable; the
-- grants of 0026 stand (members select, the server writes).

alter table public.image_imports add column if not exists target text not null default 'tool' check (target in ('tool', 'studio'));
alter table public.image_imports add column if not exists items jsonb check (items is null or (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100 and octet_length(items::text) <= 400000));
alter table public.image_imports add column if not exists brand_id uuid references public.brands on delete set null;
alter table public.image_imports add column if not exists vendor_id uuid references public.vendors on delete set null;
alter table public.image_imports add column if not exists batch_type text not null default 'Simple' check (batch_type in ('Simple', 'Variable'));
alter table public.image_imports add column if not exists batch_id uuid references public.studio_batches on delete set null;
