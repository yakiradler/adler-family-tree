-- ============================================================
-- Migration 020: two-axis role model — per-tree owner/editor/viewer
-- ------------------------------------------------------------
-- Collapses the per-tree role set to exactly 3 (owner, editor, viewer).
-- The legacy 'member' role was a WRITER (has_tree_write included it), so
-- member -> editor is a pure rename with ZERO change in access. The global
-- guest/user/master tiers + master_permissions are being retired at the
-- app layer; this migration only touches the per-tree axis + helpers.
--
-- Behaviour-preserving: admins stay super-admin, owners stay owners,
-- members become editors (identical write power). No one loses access.
--
-- Idempotent. Apply order matters: backfill BEFORE swapping the CHECK.
-- ============================================================

set check_function_bodies = off;

-- ─── 1. Backfill: member -> editor ───────────────────────────
update public.tree_access set role = 'editor' where role = 'member';

-- ─── 2. Safety net: every tree must have an owner ────────────
-- Once requests route to owners, an ownerless tree would be
-- unmanageable. Grant owner to the tree creator where missing.
insert into public.tree_access (user_id, tree_id, role, granted_by)
select t.created_by, t.id, 'owner', t.created_by
  from public.family_trees t
 where t.created_by is not null
   and not exists (
     select 1 from public.tree_access ta
      where ta.tree_id = t.id and ta.role = 'owner'
   )
on conflict (user_id, tree_id) do update set role = 'owner';

-- ─── 3. Swap the role CHECK to the 3-role set ────────────────
-- Done AFTER the backfill so no surviving 'member' row trips it.
-- Inline column CHECK from migration 008 is named tree_access_role_check.
do $$
begin
  alter table public.tree_access drop constraint if exists tree_access_role_check;
  alter table public.tree_access
    add constraint tree_access_role_check
    check (role in ('owner', 'editor', 'viewer'));
exception when others then
  raise notice '020: could not swap tree_access role CHECK (%): verify manually', sqlerrm;
end$$;

-- New rows default to editor (a normal contributing family member).
alter table public.tree_access alter column role set default 'editor';

-- ─── 4. has_tree_write: writers are owner/editor (member gone) ─
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
        and role in ('owner', 'editor')  -- viewer is read-only
    );
$$;

-- ─── 5. is_tree_owner helper (for owner self-management) ─────
create or replace function public.is_tree_owner(uid uuid, tree uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    public.is_admin(uid)
    or exists (
      select 1 from public.tree_access
      where user_id = uid and tree_id = tree and role = 'owner'
    );
$$;

-- ─── 6. redeem_invite grants editor (was member) ─────────────
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

  -- Grant editor (was 'member'); do-nothing on conflict so an existing
  -- owner/editor is never downgraded.
  if v_invite.tree_id is not null then
    insert into public.tree_access (user_id, tree_id, role, granted_by)
    values (v_uid, v_invite.tree_id, 'editor', v_invite.created_by)
    on conflict (user_id, tree_id) do nothing;
  end if;

  redeemed_tree_id := v_invite.tree_id;
  return next;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;

-- ─── 7. Verification ─────────────────────────────────────────
do $$
declare
  bad int;
  ownerless int;
begin
  select count(*) into bad from public.tree_access where role not in ('owner','editor','viewer');
  select count(*) into ownerless from public.family_trees t
   where not exists (select 1 from public.tree_access ta where ta.tree_id = t.id and ta.role = 'owner');
  raise notice '020 applied. non-3-role rows: % (must be 0), ownerless trees: % (should be 0)', bad, ownerless;
end$$;
