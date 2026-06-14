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

-- ============================================================
-- PROFILES — one row per auth.users user
-- ============================================================
-- Defined first so the helpers below can reference it. PostgreSQL
-- validates `language sql` function bodies at CREATE TIME (unlike
-- plpgsql), so any helper that queries `public.profiles` would fail
-- to install on a fresh database if the table didn't already exist.
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
-- PROFILES — triggers
-- ============================================================

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
  icon_url     text,            -- custom icon image (tree-icons bucket), migration 014
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.family_trees add column if not exists icon_url text;

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
  -- Minted FOR a specific user (share-code approval flow, migration
  -- 014). UI pointer only — codes stay bearer tokens.
  created_for uuid references auth.users(id) on delete set null,
  expires_at  timestamptz,
  uses_left   int,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.tree_invites add column if not exists created_for uuid references auth.users(id) on delete set null;
create index if not exists inv_created_for_idx on public.tree_invites(created_for, tree_id);

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
-- FEEDBACK — bug reports / questions sent from the help "?" menu
-- ============================================================
-- `author_name` denormalised like member_notes; `context` stores the
-- route hash the report was sent from. Admin-only reads (see RLS).
create table if not exists public.feedback (
  id          uuid primary key default uuid_generate_v4(),
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  category    text not null check (category in ('bug', 'question')),
  body        text not null,
  context     text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
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

-- ─── TREE_ACCESS (per-tree membership) ────────────────────
-- Explicit ACL for "which users can see which trees". Without this
-- table the old members_select_all policy let any authenticated user
-- read every member row in the DB, which leaked the Adler tree to
-- anyone who signed up. See migration 008 for the full reasoning.
create table if not exists public.tree_access (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tree_id    uuid not null references public.family_trees(id) on delete cascade,
  role       text not null default 'member'
              check (role in ('owner', 'editor', 'member', 'viewer')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, tree_id)
);
create index if not exists tree_access_tree_idx on public.tree_access(tree_id);
create index if not exists tree_access_user_idx on public.tree_access(user_id);

create or replace function public.has_tree_access(uid uuid, tree uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    tree is null
    or public.is_admin(uid)
    or exists (
      select 1 from public.tree_access
      where user_id = uid and tree_id = tree
    );
$$;

create or replace function public.member_visible_to(uid uuid, m_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.members m
     where m.id = m_id
       and (
         public.is_admin(uid)
         or (m.tree_id is not null and public.has_tree_access(uid, m.tree_id))
         or (m.tree_id is null and m.created_by = uid)
       )
  );
$$;

create or replace function public.handle_new_family_tree()
returns trigger language plpgsql security definer as $$
begin
  if new.created_by is not null then
    insert into public.tree_access (user_id, tree_id, role, granted_by)
    values (new.created_by, new.id, 'owner', new.created_by)
    on conflict (user_id, tree_id) do nothing;
  end if;
  return new;
end$$;

drop trigger if exists on_family_tree_created on public.family_trees;
create trigger on_family_tree_created
  after insert on public.family_trees
  for each row execute procedure public.handle_new_family_tree();

alter table public.tree_access enable row level security;
drop policy if exists "ta_select_own"   on public.tree_access;
drop policy if exists "ta_select_admin" on public.tree_access;
drop policy if exists "ta_insert_admin" on public.tree_access;
drop policy if exists "ta_insert_self"  on public.tree_access;
drop policy if exists "ta_delete_admin" on public.tree_access;
create policy "ta_select_own"   on public.tree_access for select using (user_id = auth.uid());
create policy "ta_select_admin" on public.tree_access for select using (public.is_admin(auth.uid()));
create policy "ta_insert_admin" on public.tree_access for insert with check (public.is_admin(auth.uid()));
create policy "ta_insert_self"  on public.tree_access for insert
  with check (auth.role() = 'authenticated' and user_id = auth.uid());
create policy "ta_delete_admin" on public.tree_access for delete using (public.is_admin(auth.uid()));

-- ─── MEMBERS ─────────────────────────────────────────────
alter table public.members enable row level security;
drop policy if exists "members_select_all"     on public.members;
drop policy if exists "members_select_visible" on public.members;
drop policy if exists "members_insert_auth"    on public.members;
drop policy if exists "members_insert_scoped"  on public.members;
drop policy if exists "members_update_auth"    on public.members;
drop policy if exists "members_update_scoped"  on public.members;
drop policy if exists "members_delete_admin"   on public.members;
create policy "members_select_visible" on public.members for select using (
  public.is_admin(auth.uid())
  or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
  or (tree_id is null and created_by = auth.uid())
);
create policy "members_insert_scoped" on public.members for insert with check (
  auth.role() = 'authenticated' and (
    public.is_admin(auth.uid())
    or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
    or (tree_id is null and (created_by = auth.uid() or created_by is null))
  )
);
create policy "members_update_scoped" on public.members for update using (
  public.is_admin(auth.uid())
  or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
  or (tree_id is null and created_by = auth.uid())
);
create policy "members_delete_admin" on public.members for delete using (public.is_admin(auth.uid()));

-- ─── RELATIONSHIPS ────────────────────────────────────────
alter table public.relationships enable row level security;
drop policy if exists "rels_select_all"     on public.relationships;
drop policy if exists "rels_select_visible" on public.relationships;
drop policy if exists "rels_insert_auth"    on public.relationships;
drop policy if exists "rels_insert_scoped"  on public.relationships;
drop policy if exists "rels_update_auth"    on public.relationships;
drop policy if exists "rels_update_scoped"  on public.relationships;
drop policy if exists "rels_delete_auth"    on public.relationships;
drop policy if exists "rels_delete_scoped"  on public.relationships;
create policy "rels_select_visible" on public.relationships for select using (
  public.member_visible_to(auth.uid(), member_a_id)
  and public.member_visible_to(auth.uid(), member_b_id)
);
create policy "rels_insert_scoped" on public.relationships for insert with check (
  auth.role() = 'authenticated'
  and public.member_visible_to(auth.uid(), member_a_id)
  and public.member_visible_to(auth.uid(), member_b_id)
);
create policy "rels_update_scoped" on public.relationships for update using (
  public.member_visible_to(auth.uid(), member_a_id)
  and public.member_visible_to(auth.uid(), member_b_id)
);
create policy "rels_delete_scoped" on public.relationships for delete using (
  public.is_admin(auth.uid())
  or (
    public.member_visible_to(auth.uid(), member_a_id)
    and public.member_visible_to(auth.uid(), member_b_id)
  )
);

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
drop policy if exists "inv_select_auth"   on public.tree_invites;
drop policy if exists "inv_select_scoped" on public.tree_invites;
drop policy if exists "inv_insert_admin" on public.tree_invites;
drop policy if exists "inv_update_admin" on public.tree_invites;
drop policy if exists "inv_delete_admin" on public.tree_invites;
-- A user reads only codes minted FOR them or BY them; admins read all
-- (migration 015). Redeeming a typed code goes through the
-- redeem_invite() RPC below, which needs no table-wide SELECT.
create policy "inv_select_scoped" on public.tree_invites for select using (
  public.is_admin(auth.uid())
  or created_for = auth.uid()
  or created_by = auth.uid()
);
-- Admins mint codes for any tree; tree OWNERS mint codes for their
-- own trees (migration 014 — owner long-press "create share code").
create policy "inv_insert_admin" on public.tree_invites for insert with check (
  public.is_admin(auth.uid())
  or (
    tree_id is not null
    and created_by = auth.uid()
    and exists (
      select 1 from public.family_trees ft
      where ft.id = tree_invites.tree_id
        and ft.created_by = auth.uid()
    )
  )
);
create policy "inv_update_admin" on public.tree_invites for update using (public.is_admin(auth.uid()));
create policy "inv_delete_admin" on public.tree_invites for delete using (public.is_admin(auth.uid()));

-- Server-side redeem (migration 015): validate + burn a use + grant
-- tree_access, so a redeemer needs no SELECT/UPDATE on tree_invites.
-- Returns one row (redeemed_tree_id) on success, zero rows when the
-- code is missing / expired / exhausted.
create or replace function public.redeem_invite(p_code text)
returns table (redeemed_tree_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tree_invites%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'redeem_invite: not authenticated';
  end if;

  select * into v_invite
    from public.tree_invites
   where code = btrim(p_code)
   limit 1;

  if v_invite.id is null then
    return;
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return;
  end if;
  if v_invite.uses_left is not null and v_invite.uses_left <= 0 then
    return;
  end if;

  if v_invite.uses_left is not null then
    update public.tree_invites
       set uses_left = greatest(0, v_invite.uses_left - 1)
     where id = v_invite.id;
  end if;

  if v_invite.tree_id is not null then
    insert into public.tree_access (user_id, tree_id, role, granted_by)
    values (v_uid, v_invite.tree_id, 'member', v_invite.created_by)
    on conflict (user_id, tree_id) do nothing;
  end if;

  redeemed_tree_id := v_invite.tree_id;
  return next;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;

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

-- ─── FEEDBACK ─────────────────────────────────────────────
-- Users write their own reports; only admins read / triage them.
alter table public.feedback enable row level security;
drop policy if exists "fb_insert_self"  on public.feedback;
drop policy if exists "fb_select_admin" on public.feedback;
drop policy if exists "fb_update_admin" on public.feedback;
drop policy if exists "fb_delete_admin" on public.feedback;
create policy "fb_insert_self" on public.feedback for insert
  with check (auth.role() = 'authenticated' and author_id = auth.uid());
create policy "fb_select_admin" on public.feedback for select using (public.is_admin(auth.uid()));
create policy "fb_update_admin" on public.feedback for update using (public.is_admin(auth.uid()));
create policy "fb_delete_admin" on public.feedback for delete using (public.is_admin(auth.uid()));

-- ============================================================
-- PLANS + LEAVES (subscription Phase A) — see migrations/013 for
-- the full commentary. Self-service mutations go ONLY through the
-- SECURITY DEFINER functions below; users can never update their
-- own row directly (they could self-grant premium/leaves).
-- Plan limits are duplicated in src/lib/plans.ts — keep in sync.
-- ============================================================
create table if not exists public.user_plans (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  plan              text not null default 'free' check (plan in ('free', 'family', 'premium')),
  trial_ends_at     timestamptz,
  trial_used        boolean not null default false,
  leaves            integer not null default 0 check (leaves >= 0),
  leaves_renewed_at timestamptz,
  updated_at        timestamptz not null default now()
);

create table if not exists public.leaf_transactions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  created_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;
alter table public.leaf_transactions enable row level security;
drop policy if exists "up_select_own"   on public.user_plans;
drop policy if exists "up_select_admin" on public.user_plans;
drop policy if exists "up_update_admin" on public.user_plans;
drop policy if exists "up_insert_admin" on public.user_plans;
create policy "up_select_own"   on public.user_plans for select using (user_id = auth.uid());
create policy "up_select_admin" on public.user_plans for select using (public.is_admin(auth.uid()));
create policy "up_update_admin" on public.user_plans for update using (public.is_admin(auth.uid()));
create policy "up_insert_admin" on public.user_plans for insert with check (public.is_admin(auth.uid()));
drop policy if exists "lt_select_own"   on public.leaf_transactions;
drop policy if exists "lt_select_admin" on public.leaf_transactions;
drop policy if exists "lt_insert_admin" on public.leaf_transactions;
create policy "lt_select_own"   on public.leaf_transactions for select using (user_id = auth.uid());
create policy "lt_select_admin" on public.leaf_transactions for select using (public.is_admin(auth.uid()));
create policy "lt_insert_admin" on public.leaf_transactions for insert with check (public.is_admin(auth.uid()));

create or replace function public.get_my_plan()
returns public.user_plans
language plpgsql security definer set search_path = public as $$
declare
  row_ public.user_plans;
  monthly int;
begin
  insert into public.user_plans (user_id, plan, leaves)
  values (auth.uid(), 'free', 20)
  on conflict (user_id) do nothing;
  if found then
    insert into public.leaf_transactions (user_id, amount, reason)
    values (auth.uid(), 20, 'signup-gift');
  end if;
  select * into row_ from public.user_plans where user_id = auth.uid();
  if row_.plan = 'family' and row_.trial_ends_at is not null
     and row_.trial_ends_at < now() then
    update public.user_plans
       set plan = 'free', trial_ends_at = null, updated_at = now()
     where user_id = auth.uid() returning * into row_;
  end if;
  monthly := case row_.plan when 'family' then 100 when 'premium' then 300 else 0 end;
  if monthly > 0 and (row_.leaves_renewed_at is null
                      or row_.leaves_renewed_at < now() - interval '30 days') then
    update public.user_plans
       set leaves = leaves + monthly, leaves_renewed_at = now(), updated_at = now()
     where user_id = auth.uid() returning * into row_;
    insert into public.leaf_transactions (user_id, amount, reason)
    values (auth.uid(), monthly, 'monthly-renewal');
  end if;
  return row_;
end;
$$;

create or replace function public.spend_leaves(cost int, why text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  new_balance int;
begin
  if cost <= 0 then
    raise exception 'cost must be positive';
  end if;
  update public.user_plans
     set leaves = leaves - cost, updated_at = now()
   where user_id = auth.uid() and leaves >= cost
   returning leaves into new_balance;
  if new_balance is null then
    return -1;
  end if;
  insert into public.leaf_transactions (user_id, amount, reason)
  values (auth.uid(), -cost, why);
  return new_balance;
end;
$$;

create or replace function public.start_family_trial()
returns public.user_plans
language plpgsql security definer set search_path = public as $$
declare
  row_ public.user_plans;
begin
  update public.user_plans
     set plan = 'family',
         trial_ends_at = now() + interval '14 days',
         trial_used = true,
         updated_at = now()
   where user_id = auth.uid() and plan = 'free' and trial_used = false
   returning * into row_;
  if row_ is null then
    raise exception 'trial-unavailable';
  end if;
  return row_;
end;
$$;

grant execute on function public.get_my_plan() to authenticated;
grant execute on function public.spend_leaves(int, text) to authenticated;
grant execute on function public.start_family_trial() to authenticated;

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
create index if not exists feedback_status_idx     on public.feedback(status);

-- ============================================================
-- NOTIFICATIONS — persistent per-user inbox (migration 014)
-- ============================================================
-- Rows are written ONLY by the SECURITY DEFINER triggers below (no
-- client INSERT policy): new requests fan out to admins; decisions
-- notify the requester (approval embeds the minted share code). Text
-- is rendered client-side from type+data so it localizes he/en.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in (
    'access_request', 'share_code_request', 'edit_request',
    'feedback', 'request_approved', 'request_rejected'
  )),
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists ntf_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists ntf_user_unread_idx
  on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "ntf_select_own" on public.notifications;
drop policy if exists "ntf_update_own" on public.notifications;
drop policy if exists "ntf_delete_own" on public.notifications;
create policy "ntf_select_own" on public.notifications for select
  using (user_id = auth.uid());
create policy "ntf_update_own" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ntf_delete_own" on public.notifications for delete
  using (user_id = auth.uid());
-- NO insert policy on purpose — and do NOT add FORCE ROW LEVEL
-- SECURITY (the trigger functions rely on owner bypass).

create or replace function public.notify_admins(p_type text, p_data jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, data)
  select p.id, p_type, coalesce(p_data, '{}'::jsonb)
  from public.profiles p
  where p.role = 'admin'
    and coalesce(p.active, true) = true
    and p.deleted_at is null;
$$;

create or replace function public.handle_access_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_type text;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  v_type := case
    when new.answers->>'intent' = 'request_share_code' then 'share_code_request'
    else 'access_request'
  end;
  perform public.notify_admins(v_type, jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'tree_id', new.answers->>'target_tree_id',
    'tree_name', new.answers->>'target_tree_name',
    'requested_role', new.requested_role
  ));
  return new;
end;
$$;

drop trigger if exists on_access_request_created on public.access_requests;
create trigger on_access_request_created
  after insert on public.access_requests
  for each row execute procedure public.handle_access_request_created();

create or replace function public.handle_edit_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  perform public.notify_admins('edit_request', jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'target_member_id', new.target_member_id
  ));
  return new;
end;
$$;

drop trigger if exists on_edit_request_created on public.edit_requests;
create trigger on_edit_request_created
  after insert on public.edit_requests
  for each row execute procedure public.handle_edit_request_created();

create or replace function public.handle_feedback_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins('feedback', jsonb_build_object(
    'feedback_id', new.id,
    'category', new.category,
    'author_name', new.author_name
  ));
  return new;
end;
$$;

drop trigger if exists on_feedback_created on public.feedback;
create trigger on_feedback_created
  after insert on public.feedback
  for each row execute procedure public.handle_feedback_created();

create or replace function public.handle_access_request_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_tree_id uuid;
  v_tree_name text;
begin
  if new.status = 'approved' then
    select i.code, i.tree_id into v_code, v_tree_id
    from public.tree_invites i
    where i.created_for = new.requester_id
      and (i.expires_at is null or i.expires_at > now())
      and (i.uses_left is null or i.uses_left > 0)
      and (
        new.answers->>'target_tree_id' is null
        or i.tree_id = (new.answers->>'target_tree_id')::uuid
      )
    order by i.created_at desc
    limit 1;
    if v_tree_id is not null then
      select t.name into v_tree_name from public.family_trees t where t.id = v_tree_id;
    end if;
    insert into public.notifications (user_id, type, data)
    values (new.requester_id, 'request_approved', jsonb_build_object(
      'request_id', new.id,
      'code', v_code,
      'tree_id', coalesce(v_tree_id::text, new.answers->>'target_tree_id'),
      'tree_name', coalesce(v_tree_name, new.answers->>'target_tree_name')
    ));
  else
    insert into public.notifications (user_id, type, data)
    values (new.requester_id, 'request_rejected', jsonb_build_object(
      'request_id', new.id,
      'tree_name', new.answers->>'target_tree_name'
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists on_access_request_decided on public.access_requests;
create trigger on_access_request_decided
  after update of status on public.access_requests
  for each row
  when (old.status = 'pending' and new.status in ('approved', 'rejected'))
  execute procedure public.handle_access_request_decided();

-- ─── tree-icons storage bucket ──────────────────────────────
-- Public-read icon images; writes restricted to the tree's owner or
-- an admin (path convention: <tree_id>/icon-<ts>.<ext>). See
-- migrations/014 for the Dashboard fallback when this role can't
-- create policies on storage.objects.
insert into storage.buckets (id, name, public)
values ('tree-icons', 'tree-icons', true)
on conflict (id) do nothing;

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
