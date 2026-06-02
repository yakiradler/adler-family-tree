-- ============================================================
-- Migration 010: profiles.linked_member_id
-- ------------------------------------------------------------
-- Links an authenticated profile to "their own card" in the
-- members table — the Member row that represents the user
-- themselves on the family tree. Created during onboarding when
-- the wizard seeds the "me" node.
--
-- Why this matters:
--   * RBAC: users can edit/manage their OWN member card without
--     needing admin rights. Until this column existed there was
--     no way to identify which member row was "self", so the
--     permission helper fell back to nuclear-family-only.
--   * UI: lets pages like /home jump straight to the user's card.
--
-- The column is nullable: existing accounts (created before this
-- migration) will have linked_member_id IS NULL until they walk
-- back through the onboarding wizard or an admin links them
-- manually from the dashboard. ON DELETE SET NULL so deleting a
-- member doesn't orphan the profile.
--
-- Idempotent — safe to re-run.
-- ============================================================

alter table public.profiles
  add column if not exists linked_member_id uuid
    references public.members(id) on delete set null;

create index if not exists idx_profiles_linked_member_id
  on public.profiles (linked_member_id)
  where linked_member_id is not null;

-- RLS policies: the profile owner needs to be able to UPDATE
-- their own linked_member_id during onboarding. Admin already
-- has full access via existing policies; no new policy needed
-- for admin.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and policyname = 'profiles_self_update_linked_member'
  ) then
    create policy profiles_self_update_linked_member
      on public.profiles
      for update
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
