-- 0047_profile_email — «ملفي › تعديل بياناتي» (phase 10, the owner 5 Nov: «دلوقتي»). A member changes their own email through
-- Supabase Auth (updateUser + the confirmation link — IBAuth.changeEmail); once Auth confirms it, auth.users.email changes and the
-- profile follows here: the sign-in by phone reads profiles.email (email_for_identifier, 0001) and the directory shows it. The
-- phone stays the member's own update on profiles (RLS + profiles_guard_update allow name / phone on one's own row).
-- Re-runnable; no data dropped.
create or replace function public.profile_email_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id and email is distinct from lower(new.email);
  end if;
  return new;
end $$;
revoke execute on function public.profile_email_follow() from public, anon, authenticated;
drop trigger if exists profile_email_follow on auth.users;
create trigger profile_email_follow after update of email on auth.users for each row execute function public.profile_email_follow();
