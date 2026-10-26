-- Tests for the data statements of 0009_failed_note_permalink on rows that predate it. The state before 0009 is
-- rebuilt (the «فشل» row back to «تم RTC», orders and products as the old sync wrote them), the migration file itself
-- is applied again with \ir, then once more to prove that a re-run changes nothing.
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0009 is checked with the queries in tools/deploy.md §2.1. The schema side of 0009 (status_map rows,
-- products.permalink grants and member read) is in rls_orders.sql / rls_system.sql.
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0009: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted sync and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "column … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- the state before 0009

-- The «فشل» row back to «تم RTC» (the same row: 0009 must keep its id).
update public.status_map set system_status = 'تم RTC', woo_status = null, direction = 'from_system', sort = 6
where system_status = 'فشل';
do $$ begin
  perform set_config('migrate_0009.rtc_id', (select id::text from public.status_map where system_status = 'تم RTC'), true);
end $$;

-- Orders: a website note with no comment (null / ''), a team comment over a website note, no website note (null /
-- ''), and one order on «تم RTC».
insert into public.orders (id, number, customer_name, status, placed_at, note, customer_note) values
  (990001, '990001', 'عميلة تجربة 1', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,           'اتصلي قبل التوصيل'),
  (990002, '990002', 'عميلة تجربة 2', 'جاري التنفيذ', '2026-10-20T10:00:00Z', '',             'رن مرتين'),
  (990003, '990003', 'عميلة تجربة 3', 'جاري التنفيذ', '2026-10-20T10:00:00Z', 'تعليق الفريق', 'ملاحظة الموقع'),
  (990004, '990004', 'عميلة تجربة 4', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,           null),
  (990005, '990005', 'عميلة تجربة 5', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,           ''),
  (990006, '990006', 'عميلة تجربة 6', 'تم RTC',       '2026-10-20T10:00:00Z', null,           null);

-- Products as the old sync wrote them (permalink only in raw), plus one the new sync already filled.
insert into public.products (id, name, raw, permalink) values
  (990101, 'منتج 1', '{"permalink":"https://stage.example.test/product/one/"}', null),
  (990102, 'منتج 2', '{"permalink":"http://stage.example.test/product/two/"}', null),
  (990103, 'منتج 3', '{"permalink":"javascript:alert(1)"}', null),
  (990104, 'منتج 4', null, null),
  (990105, 'منتج 5', '{"permalink":"https://stage.example.test/product/old/"}', 'https://stage.example.test/product/new/'),
  (990106, 'منتج 6', '{"permalink":" https://stage.example.test/product/six/ "}', null),
  (990107, 'منتج 7', '{"name":"no permalink"}', null);

-- ---------------------------------------------------------------- 0009 on that state

\ir ../migrations/0009_failed_note_permalink.sql

do $$ begin
  if not ((select count(*) from public.status_map) = 9) then raise exception 'case status_map keeps nine rows failed'; end if;
  if exists (select 1 from public.status_map where system_status = 'تم RTC') then
    raise exception 'case «تم RTC» is gone failed';
  end if;
  if not exists (select 1 from public.status_map
                 where id = current_setting('migrate_0009.rtc_id')::int
                   and system_status = 'فشل' and woo_status = 'failed' and direction = 'from_woo' and sort = 10) then
    raise exception 'case «تم RTC» became (فشل, failed, from_woo, 10) on the same row (id kept) failed';
  end if;
  if not ((select status from public.orders where id = 990006) = 'فشل') then
    raise exception 'case an order on «تم RTC» follows the rename to «فشل» (on update cascade) failed';
  end if;

  if not ((select string_agg(id || '=' || coalesce(note, '∅'), ',' order by id) from public.orders where id between 990001 and 990006)
          = '990001=اتصلي قبل التوصيل,990002=رن مرتين,990003=تعليق الفريق,990004=∅,990005=∅,990006=∅') then
    raise exception 'case note = customer_note only where the comment was empty and a website note exists failed';
  end if;
  if not ((select string_agg(order_id || ':' || coalesce(old_value, '∅') || '→' || new_value || '/' || source, ',' order by order_id)
           from public.order_events where kind = 'note' and order_id between 990001 and 990006)
          = '990001:∅→اتصلي قبل التوصيل/woo,990002:→رن مرتين/woo') then
    raise exception 'case the note seed writes one order_events row (kind note, source woo) per seeded order failed';
  end if;

  if not ((select string_agg(id || '=' || coalesce(permalink, '∅'), ',' order by id) from public.products where id between 990101 and 990107)
          = '990101=https://stage.example.test/product/one/,990102=∅,990103=∅,990104=∅,'
            || '990105=https://stage.example.test/product/new/,990106=https://stage.example.test/product/six/,990107=∅') then
    raise exception 'case permalink backfilled from raw (https only, trimmed, an existing value kept) failed';
  end if;
end $$;

-- ---------------------------------------------------------------- a re-run changes nothing

do $$ begin
  perform set_config('migrate_0009.before', concat_ws('|',
    (select string_agg(id || system_status || coalesce(woo_status, '') || direction || sort, ',' order by id) from public.status_map),
    (select string_agg(id || coalesce(note, '∅') || status, ',' order by id) from public.orders),
    (select string_agg(id || coalesce(permalink, '∅'), ',' order by id) from public.products),
    (select count(*) from public.order_events)), true);
end $$;

\ir ../migrations/0009_failed_note_permalink.sql

do $$ begin
  if not (current_setting('migrate_0009.before')
          = concat_ws('|',
              (select string_agg(id || system_status || coalesce(woo_status, '') || direction || sort, ',' order by id) from public.status_map),
              (select string_agg(id || coalesce(note, '∅') || status, ',' order by id) from public.orders),
              (select string_agg(id || coalesce(permalink, '∅'), ',' order by id) from public.products),
              (select count(*) from public.order_events))) then
    raise exception 'case 0009 applied a second time changes nothing (status_map, notes, permalinks, order_events) failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0009: ok'; end $$;
