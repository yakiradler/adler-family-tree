-- ============================================================
-- Migration 017: enforce per-tree ROLES on writes (+ re-assert
--                the invite-code read hardening from 015)
-- ------------------------------------------------------------
-- Why this exists (red-team round 2, Wave 1 item 3)
--   1. ROLE WAS DECORATIVE. `tree_access.role` (owner/editor/member/
--      viewer) is defined since migration 008, but every write policy
--      on `members` / `relationships` resolves through
--      `has_tree_access()`, which checks only that a tree_access ROW
--      EXISTS — not its role. Result: a user invited as `viewer`
--      (read-only) can INSERT/UPDATE/DELETE members and relationships
--      exactly like an owner. There is no read-only tier at the DB.
--
--   2. INVITE-READ LEAK STILL LIVE. A read-only probe of production
--      found `inv_select_auth` (qual: auth.role() = 'authenticated')
--      still present on `tree_invites` — i.e. migration 015's SELECT
--      hardening was never applied live. Any signed-in user can read
--      every family's invite codes. We re-assert the scoped policy
--      here so applying 017 closes the leak regardless of 015's state.
--
-- What this does
--   A. New `has_tree_write(uid, tree)` — true for admin OR a
--      tree_access row whose role is a WRITER role (owner/editor/
--      member). `viewer` is excluded → read-only. SELECT keeps using
--      `has_tree_access` (any role, incl. viewer), so viewers can see
--      but not change.
--   B. Repoint members + relationships INSERT/UPDATE/DELETE to the new
--      writer check. SELECT policies are left untouched.
--   C. Re-assert `inv_select_scoped` (drop `inv_select_auth`).
--
-- Behaviour change today: NONE. Production currently has only `owner`
-- and `member` grants (both writers), so no existing user loses access.
-- This migration only ESTABLISHES the read-only `viewer` tier so that
-- future view-only invites are actually enforced.
--
-- Safety: fully idempotent (every policy/function is drop-or-replace).
-- Apply to the dev Supabase first (PR → develop), verify joining +
-- editing still work, then promote to main. Do NOT hand-apply to prod.
-- ============================================================

set check_function_bodies = off;

-- ─── A. Writer-role helper ───────────────────────────────────
-- SECURITY DEFINER so it can read tree_access without recursing
-- through that table's own RLS (same pattern as has_tree_access).
create or replace function public.has_tree_write(uid uuid, tree uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    public.is_admin(uid)
    or exists (
      select 1 from public.tree_access
      where user_id = uid
        and tree_id = tree
        and role in ('owner', 'editor', 'member')  -- writers; 'viewer' excluded
    );
$$;

-- Helper mirroring member_visible_to but for WRITES — is this member
-- in a tree the caller may write to? Re-uses has_tree_write so any
-- future change to the writer set propagates to relationships too.
create or replace function public.member_writable_by(uid uuid, m_id uuid)
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
         or (m.tree_id is not null and public.has_tree_write(uid, m.tree_id))
         or (m.tree_id is null and m.created_by = uid)
       )
  );
$$;

-- ─── B1. Members: writes require a writer role ───────────────
drop policy if exists "members_insert_scoped" on public.members;
drop policy if exists "members_update_scoped" on public.members;

create policy "members_insert_scoped"
  on public.members for insert
  with check (
    auth.role() = 'authenticated'
    and (
      public.is_admin(auth.uid())
      or (tree_id is not null and public.has_tree_write(auth.uid(), tree_id))
      or (tree_id is null and (created_by = auth.uid() or created_by is null))
    )
  );

create policy "members_update_scoped"
  on public.members for update
  using (
    public.is_admin(auth.uid())
    or (tree_id is not null and public.has_tree_write(auth.uid(), tree_id))
    or (tree_id is null and created_by = auth.uid())
  );

-- members_delete_admin (admin-only) is unchanged — left as-is from 008.
-- members_select_visible (any tree_access incl. viewer) is unchanged.

-- ─── B2. Relationships: writes require writer role on both ends ─
drop policy if exists "rels_insert_scoped" on public.relationships;
drop policy if exists "rels_update_scoped" on public.relationships;
drop policy if exists "rels_delete_scoped" on public.relationships;

create policy "rels_insert_scoped"
  on public.relationships for insert
  with check (
    auth.role() = 'authenticated'
    and public.member_writable_by(auth.uid(), member_a_id)
    and public.member_writable_by(auth.uid(), member_b_id)
  );

create policy "rels_update_scoped"
  on public.relationships for update
  using (
    public.member_writable_by(auth.uid(), member_a_id)
    and public.member_writable_by(auth.uid(), member_b_id)
  );

create policy "rels_delete_scoped"
  on public.relationships for delete
  using (
    public.is_admin(auth.uid())
    or (
      public.member_writable_by(auth.uid(), member_a_id)
      and public.member_writable_by(auth.uid(), member_b_id)
    )
  );

-- rels_select_visible (member_visible_to, any role) is unchanged.

-- ─── C. Re-assert invite-read hardening (idempotent w/ 015) ───
-- Closes the live `inv_select_auth` leak even if migration 015 was
-- never applied. NOTE: redemption needs the redeem_invite() RPC from
-- migration 015 — make sure 015 is applied too, otherwise joining by
-- code is broken independent of this policy.
drop policy if exists "inv_select_auth"   on public.tree_invites;
drop policy if exists "inv_select_scoped" on public.tree_invites;
create policy "inv_select_scoped" on public.tree_invites for select using (
  public.is_admin(auth.uid())
  or created_for = auth.uid()
  or created_by = auth.uid()
);

-- ─── D. Verification notice ──────────────────────────────────
do $$
declare
  writers int;
  viewers int;
begin
  select count(*) into writers from public.tree_access where role in ('owner','editor','member');
  select count(*) into viewers from public.tree_access where role = 'viewer';
  raise notice '017 applied. writer grants: %, view-only grants: %', writers, viewers;
end$$;
