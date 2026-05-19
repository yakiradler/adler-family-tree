-- Migration 005: fix "delete user does not persist" on live site.
--
-- The live database was never brought up to schema.sql — its
-- `public.profiles` is missing columns the app expects, and the
-- `profiles_delete_admin` RLS policy is absent. Both together caused
-- every admin mutation (update role, toggle active, delete user) to
-- either error or silently RLS-block, surfacing as "הפעולה לא נשמרה".
--
-- Scope of this migration is intentionally narrow: it touches ONLY
-- `public.profiles` (columns + one policy) and one row's role. It
-- does not modify other tables.

-- ─── 1) Add columns the app needs (idempotent — no-op if present) ──
alter table public.profiles
  add column if not exists bio                text,
  add column if not exists onboarded_at       timestamptz,
  add column if not exists requested_role     text,
  add column if not exists master_permissions jsonb not null default '{}'::jsonb,
  add column if not exists active             boolean not null default true;

-- ─── 2) 4-tier role constraint (idempotent) ────────────────────────
do $$
begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('guest', 'user', 'master', 'admin'));
exception when others then null;
end$$;

-- ─── 3) Promote owner to admin via join on auth.users.email ───────
update public.profiles p
   set role = 'admin', active = true
  from auth.users u
 where p.id = u.id
   and lower(u.email) = lower('yakir00010@gmail.com');

-- ─── 4) Ensure the is_admin() helper exists ───────────────────────
-- Live DB was missing this entirely. Copied verbatim from schema.sql.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role = 'admin'
      and coalesce(active, true) = true
  );
$$;

-- ─── 5) Ensure RLS is enabled + all profile policies exist ────────
-- The live DB was missing the delete policy and may also be missing
-- update_admin / update_own / select_all. Re-creating them all is
-- idempotent and ensures the AdminDashboard mutations actually
-- persist for admin users.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all"   on public.profiles;
drop policy if exists "profiles_update_own"   on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_delete_admin" on public.profiles;

create policy "profiles_select_all"
  on public.profiles for select using (true);

create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id);

create policy "profiles_update_admin"
  on public.profiles for update using (public.is_admin(auth.uid()));

create policy "profiles_delete_admin"
  on public.profiles for delete using (public.is_admin(auth.uid()));

-- ─── 6) Verification notice (visible in script output) ────────────
do $$
declare
  admin_count int;
  target_role text;
begin
  select count(*) into admin_count from public.profiles where role = 'admin';
  select p.role into target_role
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(u.email) = lower('yakir00010@gmail.com');
  raise notice 'admin profiles total: %', admin_count;
  raise notice 'yakir00010 role: %', coalesce(target_role, '<no profile row>');
end$$;
