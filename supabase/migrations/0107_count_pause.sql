-- 0107 — a count can be paused and resumed (docs/superpowers/plans/2026-11-15-comments.md decision 32).
-- The owner 15 Nov: «ف جرد جديد ممكن اوقف الجرد مؤقتاً و اكمله بعدين عايز زر بكده».
-- An open count carries who paused it and when (inv_counts.paused_at / paused_by — stamped by the server, never the member's
-- figures). While it is paused nothing is counted: its lines take no write and it cannot be approved — «كمّل الجرد» clears the
-- pause first. A count that is closed (approved / cancelled) is not paused any more. The table's grants (0044: select, insert,
-- update to authenticated) and its RLS (inventory.view / inventory.edit) cover the two columns. Re-runnable.

alter table public.inv_counts add column if not exists paused_at timestamptz;
alter table public.inv_counts add column if not exists paused_by uuid references public.profiles on delete set null;

-- runs after inv_guard (the triggers of a table fire in name order): the pause is the server's stamp
create or replace function public.inv_count_pause_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'inv_counts' then
    if tg_op = 'INSERT' then
      new.paused_at := null; new.paused_by := null;
    else
      if current_user in ('anon', 'authenticated') then
        if new.paused_at is not null and old.paused_at is null then new.paused_at := now(); new.paused_by := auth.uid();  -- paused now, by me
        elsif new.paused_at is null then new.paused_by := null;                                                           -- resumed
        else new.paused_at := old.paused_at; new.paused_by := old.paused_by;                                               -- still paused: the stamp stays
        end if;
      end if;
      if new.status <> 'open' then new.paused_at := null; new.paused_by := null; end if;
    end if;
  elsif current_user in ('anon', 'authenticated')
        and exists (select 1 from public.inv_counts c where c.id = new.count_id and c.paused_at is not null) then
    raise exception 'the count is paused' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists inv_counts_pause on public.inv_counts;
create trigger inv_counts_pause before insert or update on public.inv_counts for each row execute function public.inv_count_pause_guard();
drop trigger if exists inv_count_lines_pause on public.inv_count_lines;
create trigger inv_count_lines_pause before insert or update on public.inv_count_lines for each row execute function public.inv_count_pause_guard();

-- the approval (0044) with one more refusal: a paused count is resumed before it is approved
create or replace function public.inv_count_approve(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record; n int := 0; l record;
begin
  if public.has_perm('inventory.approve') <> 'F' then raise exception 'inventory.approve needed' using errcode = '42501'; end if;
  select * into c from public.inv_counts where id = p_id for update;
  if not found then raise exception 'count not found' using errcode = 'P0002'; end if;
  if c.status <> 'open' then raise exception 'the count is not open' using errcode = '22023'; end if;
  if c.paused_at is not null then raise exception 'the count is paused' using errcode = '22023'; end if;
  for l in select cl.*, public.inv_lot_on_hand(cl.lot_id) as now_on_hand from public.inv_count_lines cl where cl.count_id = p_id and cl.counted is not null loop
    if l.counted <> l.now_on_hand then
      insert into public.inv_moves (lot_id, type, qty, label, reason, ref, note, by)
      values (l.lot_id, 'adjust', l.counted - l.now_on_hand, 'تسوية جرد', 'جرد', 'CNT-' || p_id, l.note, auth.uid());
      n := n + 1;
    end if;
  end loop;
  update public.inv_counts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  return n;
end $$;
revoke execute on function public.inv_count_approve(bigint) from public, anon;
grant execute on function public.inv_count_approve(bigint) to authenticated, service_role;
