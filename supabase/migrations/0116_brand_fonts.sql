-- 0116 — the brand's own fonts (ش34 in docs/superpowers/plans/2026-11-15-comments.md — the owner 16 Nov: «زود فونتات و زود اني ارفع فونت من عندي»)
-- The bucket «settings» (0056: the admin writes, every active member reads) now also takes the four font types; the size stays 2 MB.
-- The browser checks the file's first bytes and names the object brand/font-<key>.<ext>; the brand row keeps { fonts: { custom: [{ id, name, path }] } }
-- (admin only — settings_public already returns the whole brand row). Re-runnable; skipped where there is no storage schema (the local test db).
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('settings', 'settings', false, 2097152, '{image/png,image/svg+xml,image/webp,image/jpeg,font/woff2,font/woff,font/ttf,font/otf}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
  end if;
end
$storage$;
