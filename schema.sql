-- ============================================================
-- Adler Family Tree — Complete Supabase Schema
-- ============================================================
--
-- HOW TO RUN
-- 1.  Open https://supabase.com/dashboard → your project
-- 2.  Left sidebar → SQL Editor → New query
-- 3.  Paste the whole file → click "Run"
-- 4.  Re-running is safe — every CREATE / ALTER is guarded with
--     IF NOT EXISTS so it doubles as a migration script.
--
-- This file is the SINGLE source of truth for the backend. Whenever
-- the application code adds a new column, table, or RLS rule, it
-- gets recorded here too. Older deployments only need to re-run the
-- script; nothing is dropped or rewritten.
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── helpers ─────────────────────────────────────────────────
-- Reusable "is admin" check. Centralises the role lookup so RLS
-- policies stay readable.
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

-- ============================================================
-- PROFILES — one row per auth.users user
-- ============================================================
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default '',
  avatar_url          text,
  role                text not null default 'user',
  bio                 text,
  onboarded_at        timestamptz,
  requested_role      text,
  master_permissions  jsonb not null default '{}'::jsonb,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Bring older deployments up to schema. Each column is added only
-- if it doesn't already exist, so this block is safe to re-run.
alter table public.profiles
  add column if not exists bio                text,
  add column if not exists onboarded_at       timestamptz,
  add column if not exists requested_role     text,
  add column if not exists master_permissions jsonb not null default '{}'::jsonb,
  add column if not exists active             boolean not null default true;

-- 4-tier role: guest / user / master / admin
do $$
begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('guest', 'user', 'master', 'admin'));
exception when others then null;
end$$;

-- Auto-create a profile row whenever a user signs up. Honours the
-- `full_name` + `invited_role` that the AdminDashboard invite flow
-- passes through user_metadata so an invited user lands with the
-- right name + permission tier on first login.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  invited_role text := coalesce(new.raw_user_meta_data->>'invited_role', 'user');
begin
  insert into public.profiles (id, full_name, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.email,
      ''
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when invited_role in ('guest','user','master','admin') then invited_role else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- FAMILY TREES — named groupings of members
-- ============================================================
create table if not exists public.family_trees (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  description  text,
  color        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- MEMBERS
-- ============================================================
create table if not exists public.members (
  id                    uuid primary key default uuid_generate_v4(),
  first_name            text not null,
  last_name             text not null,
  maiden_name           text,
  nickname              text,
  birth_date            date,
  death_date            date,
  hebrew_birth_date     text,
  hebrew_death_date     text,
  bio                   text,
  photo_url             text,
  photos                jsonb,
  gender                text check (gender in ('male', 'female')),
  birth_order           int,
  lineage               text check (lineage in ('kohen', 'levi', 'israel')),
  hidden                boolean not null default false,
  connector_parent_id   uuid,
  tree_id               uuid references public.family_trees(id) on delete set null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Migrate older `members` rows that pre-date the extra columns.
alter table public.members
  add column if not exists maiden_name         text,
  add column if not exists nickname            text,
  add column if not exists hebrew_birth_date   text,
  add column if not exists hebrew_death_date   text,
  add column if not exists photos              jsonb,
  add column if not exists gender              text,
  add column if not exists birth_order         int,
  add column if not exists lineage             text,
  add column if not exists hidden              boolean not null default false,
  add column if not exists connector_parent_id uuid,
  add column if not exists tree_id             uuid references public.family_trees(id) on delete set null;

-- ============================================================
-- RELATIONSHIPS
-- ============================================================
create table if not exists public.relationships (
  id           uuid primary key default uuid_generate_v4(),
  member_a_id  uuid not null references public.members(id) on delete cascade,
  member_b_id  uuid not null references public.members(id) on delete cascade,
  type         text not null check (type in ('parent-child', 'spouse', 'sibling')),
  status       text check (status in ('current', 'ex', 'deceased')),
  parent_type  text check (parent_type in ('bio', 'step', 'adoptive')),
  created_at   timestamptz not null default now(),
  unique (member_a_id, member_b_id, type)
);

alter table public.relationships
  add column if not exists status      text,
  add column if not exists parent_type text;

-- ============================================================
-- EDIT REQUESTS
-- ============================================================
create table if not exists public.edit_requests (
  id                uuid primary key default uuid_generate_v4(),
  requester_id      uuid not null references auth.users(id) on delete cascade,
  target_member_id  uuid not null references public.members(id) on delete cascade,
  change_data       jsonb not null default '{}'::jsonb,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- ACCESS REQUESTS — onboarding wizard submissions
-- ============================================================
create table if not exists public.access_requests (
  id              uuid primary key default uuid_generate_v4(),
  requester_id    uuid not null references auth.users(id) on delete cascade,
  requested_role  text not null check (requested_role in ('guest','user','master','admin')),
  answers         jsonb not null default '{}'::jsonb,
  invite_code     text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- TREE INVITES — short-codes admins hand out to new family members
-- ============================================================
create table if not exists public.tree_invites (
  id          uuid primary key default uuid_generate_v4(),
  code        text not null unique,
  tree_id     uuid references public.family_trees(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz,
  uses_left   int,
  note        text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- MEMBER NOTES — comments + memories left on each profile
-- ============================================================
create table if not exists public.member_notes (
  id            uuid primary key default uuid_generate_v4(),
  member_id     uuid not null references public.members(id) on delete cascade,
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text not null default '',
  body          text not null default '',
  kind          text not null default 'memory' check (kind in ('comment', 'memory')),
  image_url     text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

-- ─── PROFILES ─────────────────────────────────────────────
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_all"  on public.profiles;
drop policy if exists "profiles_update_own"  on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_select_all"   on public.profiles for select using (true);
create policy "profiles_update_own"   on public.profiles for update using (auth.uid() = id);
create policy "profiles_update_admin" on public.profiles for update using (public.is_admin(auth.uid()));
-- Admin can delete profiles. This was MISSING in the previous schema
-- — admin-side `DELETE FROM profiles` was silently RLS-blocked, which
-- is why "delete user" appeared not to persist on the live site.
create policy "profiles_delete_admin" on public.profiles for delete using (public.is_admin(auth.uid()));

-- ─── FAMILY_TREES ─────────────────────────────────────────
alter table public.family_trees enable row level security;
drop policy if exists "trees_select_all"   on public.family_trees;
drop policy if exists "trees_insert_auth"  on public.family_trees;
drop policy if exists "trees_update_owner" on public.family_trees;
drop policy if exists "trees_delete_owner" on public.family_trees;
create policy "trees_select_all"   on public.family_trees for select using (true);
create policy "trees_insert_auth"  on public.family_trees for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());
create policy "trees_update_owner" on public.family_trees for update
  using (created_by = auth.uid() or public.is_admin(auth.uid()));
create policy "trees_delete_owner" on public.family_trees for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- ─── MEMBERS ─────────────────────────────────────────────
alter table public.members enable row level security;
drop policy if exists "members_select_all"   on public.members;
drop policy if exists "members_insert_auth"  on public.members;
drop policy if exists "members_update_auth"  on public.members;
drop policy if exists "members_delete_admin" on public.members;
create policy "members_select_all"   on public.members for select using (auth.role() = 'authenticated');
create policy "members_insert_auth"  on public.members for insert with check (auth.role() = 'authenticated');
create policy "members_update_auth"  on public.members for update using (auth.role() = 'authenticated');
create policy "members_delete_admin" on public.members for delete using (public.is_admin(auth.uid()));

-- ─── RELATIONSHIPS ────────────────────────────────────────
alter table public.relationships enable row level security;
drop policy if exists "rels_select_all"  on public.relationships;
drop policy if exists "rels_insert_auth" on public.relationships;
drop policy if exists "rels_update_auth" on public.relationships;
drop policy if exists "rels_delete_auth" on public.relationships;
create policy "rels_select_all"   on public.relationships for select using (auth.role() = 'authenticated');
create policy "rels_insert_auth"  on public.relationships for insert with check (auth.role() = 'authenticated');
create policy "rels_update_auth"  on public.relationships for update using (auth.role() = 'authenticated');
create policy "rels_delete_auth"  on public.relationships for delete using (auth.role() = 'authenticated');

-- ─── EDIT REQUESTS ────────────────────────────────────────
alter table public.edit_requests enable row level security;
drop policy if exists "er_select_own"   on public.edit_requests;
drop policy if exists "er_select_admin" on public.edit_requests;
drop policy if exists "er_insert_auth"  on public.edit_requests;
drop policy if exists "er_update_admin" on public.edit_requests;
create policy "er_select_own"   on public.edit_requests for select using (requester_id = auth.uid());
create policy "er_select_admin" on public.edit_requests for select using (public.is_admin(auth.uid()));
create policy "er_insert_auth"  on public.edit_requests for insert
  with check (auth.role() = 'authenticated' and requester_id = auth.uid());
create policy "er_update_admin" on public.edit_requests for update using (public.is_admin(auth.uid()));

-- ─── ACCESS REQUESTS ──────────────────────────────────────
alter table public.access_requests enable row level security;
drop policy if exists "ar_select_admin" on public.access_requests;
drop policy if exists "ar_select_own"   on public.access_requests;
drop policy if exists "ar_insert_self"  on public.access_requests;
drop policy if exists "ar_update_admin" on public.access_requests;
create policy "ar_select_admin" on public.access_requests for select using (public.is_admin(auth.uid()));
create policy "ar_select_own"   on public.access_requests for select using (requester_id = auth.uid());
-- The wizard fires this for the user themselves, so the insert check
-- gates strictly on `requester_id = auth.uid()` — no spoofing.
create policy "ar_insert_self"  on public.access_requests for insert
  with check (auth.role() = 'authenticated' and requester_id = auth.uid());
create policy "ar_update_admin" on public.access_requests for update using (public.is_admin(auth.uid()));

-- ─── TREE INVITES ─────────────────────────────────────────
alter table public.tree_invites enable row level security;
drop policy if exists "inv_select_auth"  on public.tree_invites;
drop policy if exists "inv_insert_admin" on public.tree_invites;
drop policy if exists "inv_update_admin" on public.tree_invites;
drop policy if exists "inv_delete_admin" on public.tree_invites;
-- Any signed-in user can look up a code (so the onboarding wizard
-- can validate the code they typed). Only admins can mint/delete.
create policy "inv_select_auth"  on public.tree_invites for select using (auth.role() = 'authenticated');
create policy "inv_insert_admin" on public.tree_invites for insert with check (public.is_admin(auth.uid()));
create policy "inv_update_admin" on public.tree_invites for update using (public.is_admin(auth.uid()));
create policy "inv_delete_admin" on public.tree_invites for delete using (public.is_admin(auth.uid()));

-- ─── MEMBER NOTES ─────────────────────────────────────────
alter table public.member_notes enable row level security;
drop policy if exists "notes_select_auth" on public.member_notes;
drop policy if exists "notes_insert_self" on public.member_notes;
drop policy if exists "notes_update_self" on public.member_notes;
drop policy if exists "notes_delete_self" on public.member_notes;
drop policy if exists "notes_delete_admin" on public.member_notes;
create policy "notes_select_auth"  on public.member_notes for select using (auth.role() = 'authenticated');
create policy "notes_insert_self"  on public.member_notes for insert
  with check (auth.role() = 'authenticated' and author_id = auth.uid());
create policy "notes_update_self"  on public.member_notes for update using (author_id = auth.uid());
-- Author can delete their own; admin can delete anyone's.
create policy "notes_delete_self"  on public.member_notes for delete using (author_id = auth.uid());
create policy "notes_delete_admin" on public.member_notes for delete using (public.is_admin(auth.uid()));

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists members_tree_idx        on public.members(tree_id);
create index if not exists members_created_by_idx  on public.members(created_by);
create index if not exists rels_member_a_idx       on public.relationships(member_a_id);
create index if not exists rels_member_b_idx       on public.relationships(member_b_id);
create index if not exists notes_member_idx        on public.member_notes(member_id);
create index if not exists er_status_idx           on public.edit_requests(status);
create index if not exists ar_status_idx           on public.access_requests(status);
create index if not exists inv_code_idx            on public.tree_invites(code);

-- ============================================================
-- DONE
-- After running this:
--   1. Make ONE of the existing user rows an admin so the admin
--      panel unlocks. Find your auth user id in
--      Auth → Users, then run:
--
--      update public.profiles set role = 'admin' where id = '<your-uuid>';
--
--   2. (optional) Disable email confirmation in
--      Authentication → Providers → Email
--      so invited users get logged in by the magic link directly.
-- ============================================================
