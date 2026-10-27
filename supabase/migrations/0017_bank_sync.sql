-- 0017_bank_sync: the maker's bank account two-way with Dokan's payment.bank (phase 3.5). Uses has_perm / is_admin (0001),
-- vendors / vendor_bank (0011), vendors.push_pending and vendor_push_pending (0014). The plan:
-- docs/superpowers/plans/2026-10-27-phase-3-5-bank-sync.md.
--
-- Decision (plan 3.5, decision 1): vendor_bank gains the five Dokan fields it lacked — account_number (ac_number),
--   account_type (ac_type), bank_address (bank_addr), routing_number, swift; holder = ac_name, bank_name, iban as before.
--   method and wallet stay ours (not synced). A row whose iban holds digits only (an account number typed in the IBAN box,
--   the "wrong data" the owner saw) moves it to account_number — an update, nothing deleted.
-- Decision (decision 5): pushing the field `bank` (and queueing it in push_pending) needs the admin or
--   sensitive.vendor_bank = F — the rule that writes vendor_bank — whatever vendors.edit says; the other fields keep the
--   rule of 0014 (vendors.edit = F, or P for the contact fields; a rate field adds sensitive.commission = F).
--
-- Notes for readers:
-- * vendor_bank's table-level grants (0011: select / insert / update to authenticated) cover the new columns; RLS stays
--   sensitive.vendor_bank = F. The bank values never go to vendors.woo_snapshot (a digest only, decision 2) nor to a log.
-- * Re-runnable (add column if not exists, an idempotent update, create or replace). No drop / delete / truncate.

alter table public.vendor_bank add column if not exists account_number text;
alter table public.vendor_bank add column if not exists account_type text;
alter table public.vendor_bank add column if not exists bank_address text;
alter table public.vendor_bank add column if not exists routing_number text;
alter table public.vendor_bank add column if not exists swift text;

-- an account number typed in the IBAN box → account_number (only when account_number is still empty)
update public.vendor_bank
set account_number = iban, iban = null
where iban ~ '^[0-9]+$' and account_number is null;

-- 0014's vendor_push_pending with the field `bank` (decision 5)
create or replace function public.vendor_push_pending(p_vendor uuid, p_fields text[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  synced constant text[] := array['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates', 'bank'];
  contact constant text[] := array['phone', 'email', 'contact_name', 'address_parts', 'social'];
  rate_fields constant text[] := array['rate', 'category_rates'];
  v_fields text[];
  v_store text[];
  v_all text[];
  v_edit text;
  v_current jsonb;
begin
  select coalesce(array_agg(distinct f), '{}') into v_fields from unnest(coalesce(p_fields, '{}'::text[])) f where f = any(synced);
  if p_vendor is null or coalesce(array_length(v_fields, 1), 0) = 0 then
    raise exception 'a vendor and at least one synced field are required' using errcode = '22023';
  end if;
  v_store := array(select f from unnest(v_fields) f where f <> 'bank');
  if coalesce(array_length(v_store, 1), 0) > 0 then
    v_edit := public.has_perm('vendors.edit');
    if not (public.is_admin() or v_edit = 'F' or (v_edit = 'P' and v_store <@ contact)) then
      raise exception 'vendors.edit = F (or P for the contact fields) is required to queue a push to the site' using errcode = '42501';
    end if;
  end if;
  if v_fields && rate_fields and not (public.is_admin() or public.has_perm('sensitive.commission') = 'F') then
    raise exception 'sensitive.commission = F is required to queue a commission push to the site' using errcode = '42501';
  end if;
  if 'bank' = any(v_fields) and not (public.is_admin() or public.has_perm('sensitive.vendor_bank') = 'F') then
    raise exception 'sensitive.vendor_bank = F is required to queue a bank push to the site' using errcode = '42501';
  end if;
  select v.push_pending into v_current from public.vendors v where v.id = p_vendor;
  if not found then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct f order by f), '{}') into v_all
  from (select jsonb_array_elements_text(case when jsonb_typeof(v_current) = 'array' then v_current else '[]'::jsonb end) as f
        union all select unnest(v_fields)) t
  where f = any(synced);
  update public.vendors set push_pending = to_jsonb(v_all) where id = p_vendor;
  return to_jsonb(v_all);
end $$;
revoke execute on function public.vendor_push_pending(uuid, text[]) from public, anon;
grant execute on function public.vendor_push_pending(uuid, text[]) to authenticated, service_role;
