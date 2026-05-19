-- Migration 006: soft-delete with 30-day restore window.
--
-- The previous "remove user" flow only deleted the profiles row.
-- Because the handle_new_user trigger re-creates a profile on
-- the next sign-in (which still succeeds — we never touched
-- auth.users), the user effectively walked right back in. To
-- properly suspend an account without needing the service-role
-- key on the client, we:
--
--   1. Add `deleted_at` to public.profiles.
--   2. Teach handle_new_user to PRESERVE a recent deleted_at on
--      conflict instead of stomping it. After 30 days the field
--      auto-clears, restoring the account; before then it stays
--      flagged so the app's auth gate can refuse the session.
--
-- The app-side check (useAuthState) signs the user out and
-- surfaces a "suspended" message whenever profile.deleted_at is
-- within the past 30 days.
--
-- HARD-deletion after 30 days requires a cron + service-role
-- function (Vercel Cron + auth.admin.deleteUser). That's a
-- separate follow-up — this migration only sets up the soft path.

-- 1) Column
alter table public.profiles
  add column if not exists deleted_at timestamptz;

-- Helpful index for the auth-gate lookup (profile fetched by id
-- on every session boot — keep it cheap).
create index if not exists profiles_deleted_at_idx
  on public.profiles (deleted_at)
  where deleted_at is not null;

-- 2) Trigger function — replace handle_new_user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'invited_role', 'user')
  )
  on conflict (id) do update
     set deleted_at = case
       when public.profiles.deleted_at is not null
        and public.profiles.deleted_at > now() - interval '30 days'
       then public.profiles.deleted_at  -- suspension still active
       else null                         -- 30-day window elapsed: restore
     end;
  return new;
end$$;

-- 3) Verification
do $$
declare
  has_col boolean;
begin
  select exists(
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'deleted_at'
  ) into has_col;
  raise notice 'profiles.deleted_at present: %', has_col;
end$$;
