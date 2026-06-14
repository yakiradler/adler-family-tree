-- ============================================================
-- Migration 021: per-tree OWNER self-management (RLS)
-- ------------------------------------------------------------
-- Lets a tree's OWNER manage their own tree without being a platform
-- admin: grant/change/revoke member roles, approve join + edit + share
-- requests for their tree, mint codes, rename/recolor/delete the tree.
--
-- All policies are ADDITIVE (RLS is permissive/OR) and named, so they
-- layer on top of the existing admin policies — admins keep full access,
-- owners gain access to THEIR tree only. Idempotent (drop-if-exists).
-- Depends on is_tree_owner() from migration 020.
-- ============================================================

set check_function_bodies = off;

-- ─── Safe helpers ────────────────────────────────────────────
-- access_requests store the target tree in answers->>'target_tree_id'.
-- A bad/missing value must NOT throw inside an RLS predicate, so cast
-- defensively and return null on failure.
create or replace function public.request_tree_id(answers jsonb)
returns uuid
language plpgsql
immutable
as $$
begin
  return (answers->>'target_tree_id')::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.member_tree(m_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select tree_id from public.members where id = m_id;
$$;

-- ─── tree_access: owners manage their tree's grants ──────────
drop policy if exists "ta_select_owner" on public.tree_access;
drop policy if exists "ta_insert_owner" on public.tree_access;
drop policy if exists "ta_update_owner" on public.tree_access;
drop policy if exists "ta_delete_owner" on public.tree_access;

create policy "ta_select_owner" on public.tree_access for select
  using (public.is_tree_owner(auth.uid(), tree_id));
create policy "ta_insert_owner" on public.tree_access for insert
  with check (public.is_tree_owner(auth.uid(), tree_id));
create policy "ta_update_owner" on public.tree_access for update
  using (public.is_tree_owner(auth.uid(), tree_id))
  with check (public.is_tree_owner(auth.uid(), tree_id));
create policy "ta_delete_owner" on public.tree_access for delete
  using (public.is_tree_owner(auth.uid(), tree_id));

-- ─── access_requests: owners decide requests for their tree ──
drop policy if exists "ar_select_owner" on public.access_requests;
drop policy if exists "ar_update_owner" on public.access_requests;

create policy "ar_select_owner" on public.access_requests for select
  using (public.is_tree_owner(auth.uid(), public.request_tree_id(answers)));
create policy "ar_update_owner" on public.access_requests for update
  using (public.is_tree_owner(auth.uid(), public.request_tree_id(answers)))
  with check (public.is_tree_owner(auth.uid(), public.request_tree_id(answers)));

-- ─── edit_requests: owners decide edits on their tree's members ─
drop policy if exists "er_select_owner" on public.edit_requests;
drop policy if exists "er_update_owner" on public.edit_requests;

create policy "er_select_owner" on public.edit_requests for select
  using (public.is_tree_owner(auth.uid(), public.member_tree(target_member_id)));
create policy "er_update_owner" on public.edit_requests for update
  using (public.is_tree_owner(auth.uid(), public.member_tree(target_member_id)))
  with check (public.is_tree_owner(auth.uid(), public.member_tree(target_member_id)));

-- ─── tree_invites: any owner (not just creator) mints/reads ──
drop policy if exists "inv_insert_owner" on public.tree_invites;
drop policy if exists "inv_select_owner" on public.tree_invites;

create policy "inv_insert_owner" on public.tree_invites for insert
  with check (public.is_tree_owner(auth.uid(), tree_id));
create policy "inv_select_owner" on public.tree_invites for select
  using (public.is_tree_owner(auth.uid(), tree_id));

-- ─── family_trees: owners rename/recolor/delete their tree ───
drop policy if exists "trees_update_owner_role" on public.family_trees;
drop policy if exists "trees_delete_owner_role" on public.family_trees;

create policy "trees_update_owner_role" on public.family_trees for update
  using (public.is_tree_owner(auth.uid(), id))
  with check (public.is_tree_owner(auth.uid(), id));
create policy "trees_delete_owner_role" on public.family_trees for delete
  using (public.is_tree_owner(auth.uid(), id));

do $$
begin
  raise notice '021 applied: owner self-management policies added (additive to admin).';
end$$;
