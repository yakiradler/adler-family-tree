-- ============================================================
-- Migration 003: Onboarding + RBAC scaffolding
-- - Extends profiles with onboarding metadata and 4-tier role.
-- - Adds access_requests table for the post-questionnaire admin
--   approval queue.
-- - Adds tree_invites table with shareable codes.
-- - Adds master_permissions JSON column on profiles for granular
--   per-feature toggles managed from the admin dashboard (Phase D).
-- Idempotent — safe to re-run.
-- ============================================================

-- ── PROFILES extensions ────────────────────────────────────────
alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- 4-tier role. The pre-existing `role` text column with
-- check (role in ('admin','user')) is too narrow — drop the constraint
-- (if any) and widen it. We keep the same column name so existing
-- queries like profiles.role === 'admin' continue working untouched.
do $$
begin
  -- Drop the old check constraint if it exists, regardless of name.
  execute (
    select string_agg(format('alter table public.profiles drop constraint %I', conname), '; ')
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  );
exception when others then
  -- ignore — no matching constraint
  null;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('guest', 'user', 'master', 'admin'));

-- requested_role: what the user asked for during onboarding (vs. the
-- role they actually have, which only an admin can grant).
alter table public.profiles
  add column if not exists requested_role text
  check (requested_role is null or requested_role in ('guest', 'user', 'master', 'admin'));

-- master_permissions: per-feature toggles managed by admin. Default
-- empty object; specific keys are documented in src/lib/permissions.ts.
alter table public.profiles
  add column if not exists master_permissions jsonb not null default '{}'::jsonb;

-- ── TREE INVITES ───────────────────────────────────────────────
-- For now this app is single-tree, but we still want shareable invite
-- codes so the onboarding flow can validate them. Future multi-tree
-- support can extend this with a tree_id FK without migration churn.
create table if not exists public.tree_invites (
  id           uuid primary key default uuid_generate_v4(),
  code         text not null unique,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  uses_left    integer,         -- null = unlimited
  note         text             -- admin-facing label
);

create index if not exists tree_invites_code_idx on public.tree_invites(code);

-- ── ACCESS REQUESTS ────────────────────────────────────────────
-- Records the post-onboarding questionnaire result. Admins approve or
-- reject; on approval, the granted_role is copied onto profiles.role.
create table if not exists public.access_requests (
  id              uuid primary key default uuid_generate_v4(),
  requester_id    uuid not null references auth.users(id) on delete cascade,
  requested_role  text not null check (requested_role in ('guest','user','master','admin')),
  answers         jsonb not null default '{}'::jsonb,
  invite_code     text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists access_requests_status_idx on public.access_requests(status);
create index if not exists access_requests_requester_idx on public.access_requests(requester_id);

-- ── RLS ────────────────────────────────────────────────────────
alter table public.access_requests enable row level security;

-- Avoid duplicate policy errors on re-run.
drop policy if exists "ar_select_own_or_admin" on public.access_requests;
create policy "ar_select_own_or_admin" on public.access_requests
  for select using (
    requester_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "ar_insert_own" on public.access_requests;
create policy "ar_insert_own" on public.access_requests
  for insert with check (requester_id = auth.uid());

drop policy if exists "ar_update_admin" on public.access_requests;
create policy "ar_update_admin" on public.access_requests
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

alter table public.tree_invites enable row level security;
drop policy if exists "ti_select_auth" on public.tree_invites;
create policy "ti_select_auth" on public.tree_invites
  for select using (auth.role() = 'authenticated');
drop policy if exists "ti_admin_write" on public.tree_invites;
create policy "ti_admin_write" on public.tree_invites
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  ) with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
