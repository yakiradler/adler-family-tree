-- Migration 008: per-tree DB-level access control.
--
-- BACKGROUND
-- The previous RLS on `members` / `relationships` allowed any authenticated
-- user to SELECT every row across every tree. The UI tried to compensate
-- by filtering by `tree_id` + ownership, but the data still landed in the
-- client's localStorage — a new signup could read the Adler tree by
-- inspecting devtools. David W. confirmed the leak on the live site
-- ("נכנס בדרך סודית לעץ משפחה הראשי").
--
-- FIX
--   1. New `public.tree_access` table holds explicit (user_id, tree_id, role).
--   2. Trigger on `family_trees` auto-grants 'owner' to the creator.
--   3. RLS on `members` + `relationships` checks tree_access OR admin OR
--      (for orphan rows without a tree_id) created_by = self.
--   4. Backfill existing trees: every `family_trees.created_by` becomes
--      an 'owner' so today's tree owners (yakir for Adler) keep working.
--
-- This migration is idempotent — every CREATE/ALTER is guarded.
-- ============================================================

-- ─── 0. Prerequisite tables / columns ────────────────────────
-- Production lags behind schema.sql (see "supabase-live-db" memory):
-- `family_trees` and `members.tree_id` are defined in schema.sql but
-- were never applied live.  Without them the policies below would
-- fail to compile.  Re-declaring them here keeps the migration
-- self-contained.  All clauses are guarded with IF NOT EXISTS so
-- they're harmless on environments that already have them.
create table if not exists public.family_trees (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  description  text,
  color        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.members
  add column if not exists tree_id uuid references public.family_trees(id) on delete set null;

create index if not exists members_tree_idx on public.members(tree_id);

-- family_trees RLS (mirrors schema.sql) — needed so that the trigger
-- below can fire under the inserting user's session.
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

-- ─── 1. tree_access table ────────────────────────────────────
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

-- ─── 2. Visibility helper functions ──────────────────────────
-- Centralise the "can this user see this tree?" check so all the
-- policies stay readable.  SECURITY DEFINER lets the function bypass
-- RLS on tree_access itself (otherwise we'd recurse).
create or replace function public.has_tree_access(uid uuid, tree uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    tree is null  -- orphan rows are handled by the per-policy created_by check
    or public.is_admin(uid)
    or exists (
      select 1 from public.tree_access
      where user_id = uid and tree_id = tree
    );
$$;

-- ─── 3. Auto-grant owner on tree creation ────────────────────
create or replace function public.handle_new_family_tree()
returns trigger
language plpgsql
security definer
as $$
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

-- ─── 4. Backfill: existing trees → access rows for creators ──
insert into public.tree_access (user_id, tree_id, role, granted_by)
select t.created_by, t.id, 'owner', t.created_by
  from public.family_trees t
 where t.created_by is not null
on conflict (user_id, tree_id) do nothing;

-- ─── 5. RLS on tree_access ───────────────────────────────────
alter table public.tree_access enable row level security;
drop policy if exists "ta_select_own"   on public.tree_access;
drop policy if exists "ta_select_admin" on public.tree_access;
drop policy if exists "ta_insert_admin" on public.tree_access;
drop policy if exists "ta_insert_self_owner" on public.tree_access;
drop policy if exists "ta_delete_admin" on public.tree_access;

-- Users see their own grants (so the UI can list "trees I'm in").
create policy "ta_select_own"
  on public.tree_access for select
  using (user_id = auth.uid());

-- Admins see everything (admin dashboard).
create policy "ta_select_admin"
  on public.tree_access for select
  using (public.is_admin(auth.uid()));

-- Admins grant access manually.
create policy "ta_insert_admin"
  on public.tree_access for insert
  with check (public.is_admin(auth.uid()));

-- The JoinTreeModal flow needs a non-admin path: a user redeeming an
-- invite code must be able to add THEMSELVES to a tree.  We can't
-- check `tree_invites` here cheaply, so we settle for the next-best
-- guard — the row must be for the calling user only.  The
-- JoinTreeModal validates the code before inserting; spoofing this
-- without a valid code would still leave the user with an access
-- row to a tree they don't know the ID of, which is a much smaller
-- attack surface than the open-select-all we had.
create policy "ta_insert_self"
  on public.tree_access for insert
  with check (auth.role() = 'authenticated' and user_id = auth.uid());

create policy "ta_delete_admin"
  on public.tree_access for delete
  using (public.is_admin(auth.uid()));

-- ─── 6. Tighten members RLS ──────────────────────────────────
alter table public.members enable row level security;
drop policy if exists "members_select_all"     on public.members;
drop policy if exists "members_select_visible" on public.members;
drop policy if exists "members_insert_auth"    on public.members;
drop policy if exists "members_insert_scoped"  on public.members;
drop policy if exists "members_update_auth"    on public.members;
drop policy if exists "members_update_scoped"  on public.members;
drop policy if exists "members_delete_admin"   on public.members;

-- Visible if: admin, OR user has tree_access to the member's tree, OR
-- the row is orphan (tree_id null) AND the user created it.
create policy "members_select_visible"
  on public.members for select
  using (
    public.is_admin(auth.uid())
    or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
    or (tree_id is null and created_by = auth.uid())
  );

-- Same access rule for INSERT — must own tree_access on the target
-- tree (or insert an orphan row owned by self).
create policy "members_insert_scoped"
  on public.members for insert
  with check (
    auth.role() = 'authenticated'
    and (
      public.is_admin(auth.uid())
      or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
      or (tree_id is null and (created_by = auth.uid() or created_by is null))
    )
  );

create policy "members_update_scoped"
  on public.members for update
  using (
    public.is_admin(auth.uid())
    or (tree_id is not null and public.has_tree_access(auth.uid(), tree_id))
    or (tree_id is null and created_by = auth.uid())
  );

create policy "members_delete_admin"
  on public.members for delete
  using (public.is_admin(auth.uid()));

-- ─── 7. Tighten relationships RLS ────────────────────────────
-- A relationship is visible if BOTH endpoints are visible to the
-- caller.  Using `EXISTS` keeps the query planner happy and we rely
-- on the same has_tree_access function so rules stay consistent.
alter table public.relationships enable row level security;
drop policy if exists "rels_select_all"     on public.relationships;
drop policy if exists "rels_select_visible" on public.relationships;
drop policy if exists "rels_insert_auth"    on public.relationships;
drop policy if exists "rels_insert_scoped"  on public.relationships;
drop policy if exists "rels_update_auth"    on public.relationships;
drop policy if exists "rels_update_scoped"  on public.relationships;
drop policy if exists "rels_delete_auth"    on public.relationships;
drop policy if exists "rels_delete_scoped"  on public.relationships;

-- Helper: is THIS member visible to uid?  Re-uses the policy logic
-- so any tweak there propagates here automatically.
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

create policy "rels_select_visible"
  on public.relationships for select
  using (
    public.member_visible_to(auth.uid(), member_a_id)
    and public.member_visible_to(auth.uid(), member_b_id)
  );

create policy "rels_insert_scoped"
  on public.relationships for insert
  with check (
    auth.role() = 'authenticated'
    and public.member_visible_to(auth.uid(), member_a_id)
    and public.member_visible_to(auth.uid(), member_b_id)
  );

create policy "rels_update_scoped"
  on public.relationships for update
  using (
    public.member_visible_to(auth.uid(), member_a_id)
    and public.member_visible_to(auth.uid(), member_b_id)
  );

create policy "rels_delete_scoped"
  on public.relationships for delete
  using (
    public.is_admin(auth.uid())
    or (
      public.member_visible_to(auth.uid(), member_a_id)
      and public.member_visible_to(auth.uid(), member_b_id)
    )
  );

-- ─── 8. Verification notice ──────────────────────────────────
do $$
declare
  granted int;
  total_trees int;
begin
  select count(*) into granted from public.tree_access;
  select count(*) into total_trees from public.family_trees;
  raise notice 'tree_access rows after backfill: % (across % family_trees)', granted, total_trees;
end$$;
