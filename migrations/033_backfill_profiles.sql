-- ============================================================
-- Migration 033: backfill missing profiles + harden signup trigger
-- ------------------------------------------------------------
-- Why this exists
--   Live probe found 8 of 11 auth.users had NO public.profiles row.
--   A profile holds the display name, role, minor flag, etc. — so those
--   accounts showed up as "—" in TreeManagePanel and were invisible in
--   the admin users tab entirely (the admin lists profiles, not auth
--   users). The on_auth_user_created trigger exists + is enabled, so
--   these are legacy accounts created before it (or whose profile was
--   removed by an old reseed); future signups are already covered.
--
-- What this does
--   1. Re-asserts a HARDENED handle_new_user(): adds a metadata 'name'
--      fallback and an exception guard so a profile-insert hiccup can
--      never abort a signup (it logs a warning instead).
--   2. Backfills a profile for every existing auth user that lacks one.
--      full_name mirrors the trigger: metadata name -> email -> ''.
--
-- Safety
--   Additive + idempotent (create-or-replace fn, on conflict do nothing,
--   re-runnable backfill). No existing profile is modified. Depends only
--   on public.profiles (schema.sql).
-- ============================================================

set check_function_bodies = off;

-- 1. Hardened auto-create-profile trigger (re-assert; mirrors schema.sql).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text := coalesce(new.raw_user_meta_data->>'invited_role', 'user');
begin
  insert into public.profiles (id, full_name, avatar_url, role)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      new.email,
      ''
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when invited_role in ('guest','user','master','admin') then invited_role else 'user' end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- A profile hiccup must never block authentication.
  raise warning 'handle_new_user: profile create failed for % (%)', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Backfill profiles for existing accounts that have none.
insert into public.profiles (id, full_name, role)
select au.id,
       coalesce(
         nullif(au.raw_user_meta_data->>'full_name', ''),
         nullif(au.raw_user_meta_data->>'name', ''),
         au.email,
         ''
       ),
       'user'
  from auth.users au
 where not exists (select 1 from public.profiles p where p.id = au.id)
on conflict (id) do nothing;

-- 3. Verify nothing is left behind.
do $$
declare missing int;
begin
  select count(*) into missing
    from auth.users au
   where not exists (select 1 from public.profiles p where p.id = au.id);
  raise notice '033 applied: profiles backfilled; auth users still without a profile = % (must be 0)', missing;
end$$;
