-- 0122 — the campaign's publish step (the owner 17 Nov: «عايز الغي زرار النشر اللي في عمود الطريقة و عايز احط حاجة تخليني احدد
-- البوستات اللي عايز اجدولها او اوقف نشر»; his answers: a checkbox per row + a bar, «وقف نشر» keeps the post in the plan as «متوقف»
-- until «كمّل النشر», «تأكيد النشر» schedules the picked ones only).
-- * mkt_posts.status takes «متوقف»: the publisher never claims it (mkt_publish_claim takes «مجدول» / «فشل» only), it stays in the plan.
-- * mkt_post_act: 'pause' («مجدول» / «فشل», not being published → «متوقف») and 'resume' («متوقف» → «مجدول»; its time must still be
--   ahead); move / caption / delete take a paused row too (a move keeps it paused).
-- * mkt_schedule(p_campaign, p_items, p_keep): with p_keep the rows of pieces not in the items stay as they are (the page sends the
--   picked pieces only); a picked paused row is scheduled again with the new data.
-- Re-runnable; no data dropped.

alter table public.mkt_posts drop constraint if exists mkt_posts_status_check;
alter table public.mkt_posts add constraint mkt_posts_status_check check (status in ('مجدول', 'اتنشر', 'فشل', 'اتحذف', 'متوقف'));

drop function if exists public.mkt_schedule(uuid, jsonb);
create or replace function public.mkt_schedule(p_campaign uuid, p_items jsonb, p_keep boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  c public.mkt_campaigns; it jsonb; v_today date := public.hr_today(); v_now text := public.mkt_now();
  v_piece text; v_kind text; v_name text; v_caption text; v_tags text; v_images text[]; v_platform text; v_day date; v_time text; v_how text;
  v_keys text[] := '{}'; v_key text; v_row public.mkt_posts; v_n int;
begin
  if public.has_perm('marketing.publish') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.mkt_campaigns where id = p_campaign for update;
  if not found or c.archived_at is not null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid: items' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_piece := it ->> 'piece';
    if v_piece is null or v_piece !~ '^[A-Z][0-9]{1,2}$' then raise exception 'invalid: piece' using errcode = '22023'; end if;
    v_kind := it ->> 'kind';
    if v_kind is null or v_kind not in ('بوست', 'كاروسيل', 'ريل', 'ستوري') then raise exception 'invalid: kind' using errcode = '22023'; end if;
    v_name := left(public.mkt_clean(it ->> 'name'), 200);
    if v_name = '' then v_name := v_kind; end if;
    v_caption := public.mkt_clean(it ->> 'caption', true);
    if char_length(v_caption) > 2200 then raise exception 'invalid: caption' using errcode = '22023'; end if;
    v_tags := public.mkt_clean(it ->> 'tags');
    if char_length(v_tags) > 300 then raise exception 'invalid: tags' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(it -> 'images', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(it -> 'images', '[]'::jsonb)) > 11 then
      raise exception 'invalid: images' using errcode = '22023';
    end if;
    select coalesce(array_agg(x), '{}') into v_images from jsonb_array_elements_text(coalesce(it -> 'images', '[]'::jsonb)) as x;
    if exists (select 1 from unnest(v_images) p where p !~ ('^' || p_campaign::text || '/[A-Za-z0-9._-]{1,120}$')) then
      raise exception 'invalid: images' using errcode = '22023';
    end if;
    v_platform := it ->> 'platform';
    if v_platform is null or v_platform not in ('انستجرام', 'فيسبوك', 'تيك توك') then raise exception 'invalid: platform' using errcode = '22023'; end if;
    begin v_day := (it ->> 'day')::date; exception when others then v_day := null; end;
    if v_day is null or v_day < v_today or v_day > v_today + 365 then raise exception 'invalid: day' using errcode = '22023'; end if;
    v_time := it ->> 'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_day = v_today and v_time <= v_now) then
      raise exception 'invalid: time' using errcode = '22023';
    end if;
    v_how := coalesce(it ->> 'how', 'download');
    if v_how not in ('download', 'publish') then raise exception 'invalid: how' using errcode = '22023'; end if;
    if v_how = 'publish' then
      if v_platform not in ('انستجرام', 'فيسبوك') or v_kind not in ('بوست', 'كاروسيل', 'ستوري', 'ريل') then raise exception 'invalid: how' using errcode = '22023'; end if;
      if v_kind = 'ريل' then -- 9.5.5 (decision 63): the assembled MP4 first, its key frames may follow (the log's thumbnail)
        if cardinality(v_images) = 0 or v_images[1] !~* '\.mp4$' then raise exception 'invalid: images' using errcode = '22023'; end if;
      else
        if cardinality(v_images) = 0 or cardinality(v_images) > 10 or (v_kind = 'كاروسيل' and cardinality(v_images) < 2)
           or (v_kind <> 'كاروسيل' and cardinality(v_images) <> 1) then
          raise exception 'invalid: images' using errcode = '22023';
        end if;
        if v_platform = 'انستجرام' and exists (select 1 from unnest(v_images) p where p !~* '\.jpe?g$') then raise exception 'invalid: images' using errcode = '22023'; end if;
      end if;
      if v_platform = 'انستجرام' and v_kind <> 'ستوري' and char_length(v_caption) + (case when v_tags = '' then 0 else char_length(v_tags) + 2 end) > 2200 then
        raise exception 'invalid: caption' using errcode = '22023';
      end if;
    end if;
    v_key := v_piece || '|' || v_platform;
    if v_key = any (v_keys) then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_keys := v_keys || v_key;
    select * into v_row from public.mkt_posts p
      where p.campaign_id = p_campaign and p.piece = v_piece and p.platform = v_platform and p.status <> 'اتحذف' for update;
    if found then
      if v_row.status in ('مجدول', 'فشل', 'متوقف') and not public.mkt_busy(v_row) then
        update public.mkt_posts set kind = v_kind, name = v_name, caption = v_caption, caption_orig = v_caption, tags = v_tags, images = v_images,
            day = v_day, time = v_time, how = v_how, status = 'مجدول', error = null, work = null, updated_by = auth.uid(), updated_at = now()
          where id = v_row.id;
      end if; -- a published one, or one being published now, stays as it is
    else
      insert into public.mkt_posts (campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, created_by, updated_by)
      values (p_campaign, v_piece, v_kind, v_name, v_caption, v_caption, v_tags, v_images, v_platform, v_day, v_time, v_how, 'مجدول', auth.uid(), auth.uid());
    end if;
  end loop;
  if not coalesce(p_keep, false) then
    update public.mkt_posts p set status = 'اتحذف', deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
      where p.campaign_id = p_campaign and p.status in ('مجدول', 'فشل') and not public.mkt_busy(p) and not ((p.piece || '|' || p.platform) = any (v_keys));
  end if;
  update public.mkt_campaigns set scheduled_at = now(), step = 4 where id = p_campaign;
  select count(*) into v_n from public.mkt_posts where campaign_id = p_campaign and status in ('مجدول', 'فشل');
  return v_n;
end $$;

create or replace function public.mkt_post_act(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v public.mkt_posts; a jsonb := coalesce(p_args, '{}'::jsonb); v_today date := public.hr_today(); v_now text := public.mkt_now();
  v_day date; v_time text; v_text text; v_url text;
begin
  if jsonb_typeof(a) <> 'object' then raise exception 'invalid: args' using errcode = '22023'; end if;
  if public.has_perm('marketing.publish') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v from public.mkt_posts where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if public.mkt_busy(v) then raise exception 'invalid: busy' using errcode = '22023'; end if;
  if p_action = 'move' then
    if v.status not in ('مجدول', 'فشل', 'متوقف') then raise exception 'invalid: status' using errcode = '22023'; end if;
    begin v_day := (a ->> 'day')::date; exception when others then v_day := null; end;
    if v_day is null or v_day < v_today or v_day > v_today + 365 then raise exception 'invalid: day' using errcode = '22023'; end if;
    v_time := a ->> 'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_day = v_today and v_time <= v_now) then
      raise exception 'invalid: time' using errcode = '22023';
    end if;
    if v_day = v.day and v_time = v.time then raise exception 'invalid: same' using errcode = '22023'; end if;
    update public.mkt_posts set day = v_day, time = v_time, status = case when v.status = 'متوقف' then 'متوقف' else 'مجدول' end, error = null, work = null,
        updated_by = auth.uid(), updated_at = now() where id = p_id;
    return case when v.status = 'متوقف' then 'متوقف' else 'مجدول' end;
  elsif p_action = 'caption' then
    if v.status not in ('مجدول', 'فشل', 'متوقف') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_text := public.mkt_clean(a ->> 'text', true);
    if char_length(v_text) > 2200 then raise exception 'invalid: caption' using errcode = '22023'; end if;
    if v.how = 'publish' and v.platform = 'انستجرام' and v.kind <> 'ستوري'
       and char_length(v_text) + (case when v.tags = '' then 0 else char_length(v.tags) + 2 end) > 2200 then
      raise exception 'invalid: caption' using errcode = '22023';
    end if;
    update public.mkt_posts set caption = v_text, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return v.status;
  elsif p_action = 'published' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_url := nullif(btrim(coalesce(a ->> 'url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^\s<>"]+$' or char_length(v_url) > 500) then raise exception 'invalid: url' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'اتنشر', published_at = now(), published_by = auth.uid(), post_url = v_url, error = null, work = null,
        updated_by = auth.uid(), updated_at = now()
      where id = p_id;
    return 'اتنشر';
  elsif p_action = 'pause' then -- the owner 17 Nov: «وقف نشر» — stays in the plan, never published until «كمّل النشر»
    if v.src <> 'system' or v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'متوقف', work = null, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return 'متوقف';
  elsif p_action = 'resume' then -- «كمّل النشر»: back to «مجدول» at its time — a time already gone is refused (move it first)
    if v.status <> 'متوقف' then raise exception 'invalid: status' using errcode = '22023'; end if;
    if v.day < v_today or (v.day = v_today and v.time <= v_now) then raise exception 'invalid: time' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'مجدول', error = null, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return 'مجدول';
  elsif p_action = 'delete' then
    if v.status not in ('مجدول', 'فشل', 'اتنشر', 'متوقف') then raise exception 'invalid: status' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'اتحذف', was_live = (v.status = 'اتنشر'), deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
      where id = p_id;
    return 'اتحذف';
  end if;
  raise exception 'invalid: action' using errcode = '22023';
end $$;

revoke execute on function public.mkt_schedule(uuid, jsonb, boolean), public.mkt_post_act(bigint, text, jsonb) from public, anon;
grant execute on function public.mkt_schedule(uuid, jsonb, boolean), public.mkt_post_act(bigint, text, jsonb) to authenticated, service_role;
