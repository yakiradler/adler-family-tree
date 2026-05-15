-- ============================================================
-- Migration 004: Full member + relationship schema parity
-- Adds all columns used by the frontend that are missing from
-- the base schema + migrations 001-003.
-- Idempotent — safe to re-run.
-- ============================================================

-- ── MEMBERS: missing columns ───────────────────────────────────

alter table public.members
  add column if not exists maiden_name text;

alter table public.members
  add column if not exists nickname text;

alter table public.members
  add column if not exists hebrew_birth_date text;

alter table public.members
  add column if not exists hebrew_death_date text;

-- photos: array of data-URLs or storage URLs
alter table public.members
  add column if not exists photos text[] not null default '{}';

-- hidden: when true the member is excluded from the tree render
alter table public.members
  add column if not exists hidden boolean not null default false;

-- connector_parent_id: which parent the child's tree-line descends from
alter table public.members
  add column if not exists connector_parent_id uuid references public.members(id) on delete set null;

-- tree_id: optional grouping for multi-tree households
alter table public.members
  add column if not exists tree_id uuid;  -- FK added after family_trees table below

-- ── RELATIONSHIPS: parent_type ────────────────────────────────

alter table public.relationships
  add column if not exists parent_type text
  check (parent_type is null or parent_type in ('bio', 'step', 'adoptive'));

-- ── FAMILY TREES ─────────────────────────────────────────────
-- Groups members for households that track several lineages.

create table if not exists public.family_trees (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  description text,
  color       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Wire FK now that the table exists
do $$
begin
  alter table public.members
    add constraint members_tree_id_fk
    foreign key (tree_id) references public.family_trees(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ── RLS: family_trees ─────────────────────────────────────────
alter table public.family_trees enable row level security;

drop policy if exists "ft_select_auth" on public.family_trees;
create policy "ft_select_auth" on public.family_trees
  for select using (auth.role() = 'authenticated');

drop policy if exists "ft_insert_auth" on public.family_trees;
create policy "ft_insert_auth" on public.family_trees
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "ft_update_auth" on public.family_trees;
create policy "ft_update_auth" on public.family_trees
  for update using (auth.role() = 'authenticated');

drop policy if exists "ft_delete_admin" on public.family_trees;
create policy "ft_delete_admin" on public.family_trees
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ── MEMBERS RLS: extend delete to allow master with permission ─
-- The base policy only allows admins to delete. We extend it to
-- also allow masters who have canDeleteMembers toggled on.
drop policy if exists "members_delete_admin" on public.members;
create policy "members_delete_admin" on public.members
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (
          role = 'admin'
          or (role = 'master' and (master_permissions->>'canDeleteMembers')::boolean = true)
        )
    )
  );

-- ── INDEX ─────────────────────────────────────────────────────
create index if not exists members_tree_id_idx on public.members (tree_id);
create index if not exists members_hidden_idx  on public.members (hidden) where hidden = true;
