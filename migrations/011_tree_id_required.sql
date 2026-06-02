-- ============================================================
-- Migration 011: tree_id required on every member
-- ------------------------------------------------------------
-- Why this exists
--   The "implicit main tree" (members with tree_id IS NULL) has
--   leaked from day one — a person added to tree #1 silently
--   appears in tree #2's owner's main view, because both the
--   client filter (TreePage.tsx) and RLS treat `tree_id IS NULL`
--   as "shared / orphan / main tree". The product decision is
--   that every member MUST belong to exactly one named tree, and
--   merging trees is an explicit admin action (future).
--
-- What this does
--   1. Backfill: every member with tree_id IS NULL gets attached
--      to a per-owner default tree ("עץ של <full_name>"). Created
--      fresh if needed; reused if the owner already has one.
--   2. ALTER COLUMN: members.tree_id becomes NOT NULL so the
--      mistake can never happen again at the DB layer.
--   3. Constraint trigger: a parent-child OR spouse relationship
--      whose two members belong to different trees is rejected,
--      because cross-tree linkage requires the merge flow (not
--      yet built) — silent acceptance here would re-introduce the
--      same leak via the relationship table.
--
-- Safety
--   * Idempotent: re-running is a no-op once backfill is done and
--     the column is already NOT NULL.
--   * The backfill scopes per-owner ("עץ של <name>") so two
--     different users' orphan members never end up in the same
--     tree.
--   * The cross-tree relationship trigger is OFF for admins
--     (they can knit trees together manually as part of the
--     future merge UI).
-- ============================================================

set check_function_bodies = off;

-- ─── 1. Per-owner default trees for orphan members ─────────────
-- For every distinct `created_by` that has at least one member
-- with tree_id IS NULL, ensure a default tree exists and capture
-- its id.
do $$
declare
  rec record;
  default_tree_id uuid;
  default_name text;
  full_name text;
begin
  for rec in
    select distinct created_by
      from public.members
     where tree_id is null
       and created_by is not null
  loop
    -- Resolve a human-readable name for the default tree. Falls
    -- back to "עץ ראשי" when the profile is missing a full_name.
    select coalesce(nullif(p.full_name, ''), 'משתמש')
      into full_name
      from public.profiles p
     where p.id = rec.created_by;

    default_name := coalesce('עץ של ' || full_name, 'עץ ראשי');

    -- Reuse an existing default tree owned by this user if one
    -- already exists with that exact name; otherwise create one.
    select id into default_tree_id
      from public.family_trees
     where created_by = rec.created_by
       and name = default_name
     limit 1;

    if default_tree_id is null then
      insert into public.family_trees (name, description, color, created_by)
      values (
        default_name,
        'עץ ברירת מחדל שנוצר אוטומטית במעבר 011',
        '#007AFF',
        rec.created_by
      )
      returning id into default_tree_id;

      raise notice 'Created default tree % for owner %', default_tree_id, rec.created_by;
    end if;

    -- Backfill orphan members for this owner.
    update public.members
       set tree_id = default_tree_id
     where created_by = rec.created_by
       and tree_id is null;

    raise notice 'Backfilled members for owner % into tree %', rec.created_by, default_tree_id;
  end loop;
end $$;

-- ─── 1b. Catch members with NULL created_by ────────────────────
-- The per-owner loop skipped them; create a single "unowned legacy
-- tree" so they get attached and the ALTER succeeds. These rows
-- are surfaced as a NOTICE so an admin can re-home them later.
do $$
declare
  unowned_count int;
  unowned_tree_id uuid;
begin
  select count(*) into unowned_count
    from public.members
   where tree_id is null;
  if unowned_count = 0 then
    return;
  end if;

  raise notice '% member(s) have tree_id IS NULL and no created_by — moving to "Legacy unowned" tree', unowned_count;

  select id into unowned_tree_id
    from public.family_trees
   where name = 'Legacy unowned'
   limit 1;

  if unowned_tree_id is null then
    -- created_by stays NULL on the bucket tree itself — only an
    -- admin can clean it up via the future merge UI.
    insert into public.family_trees (name, description, color, created_by)
    values (
      'Legacy unowned',
      'Bucket created by migration 011 for orphan members without created_by',
      '#8E8E93',
      null
    )
    returning id into unowned_tree_id;
  end if;

  update public.members
     set tree_id = unowned_tree_id
   where tree_id is null;
end $$;

-- Final sanity check: everything must have a tree_id at this point.
do $$
declare
  remaining int;
begin
  select count(*) into remaining
    from public.members
   where tree_id is null;
  if remaining > 0 then
    raise exception 'Migration 011 aborted: % member(s) still NULL after backfill + legacy bucket — manual fix required', remaining;
  end if;
end $$;

-- ─── 2. Lock the column ────────────────────────────────────────
alter table public.members
  alter column tree_id set not null;

-- ─── 3. Cross-tree relationship guard ──────────────────────────
-- A trigger function that rejects any parent-child or spouse
-- relationship whose two members belong to different trees.
-- Admins are exempt so the future "merge two trees" admin flow
-- can issue cross-tree edges as part of its setup.
create or replace function public.enforce_relationship_same_tree()
returns trigger
language plpgsql
security definer
as $$
declare
  tree_a uuid;
  tree_b uuid;
begin
  -- Skip when either side is somehow missing — the FK constraints
  -- on member_a_id / member_b_id will reject that on their own.
  select tree_id into tree_a from public.members where id = new.member_a_id;
  select tree_id into tree_b from public.members where id = new.member_b_id;
  if tree_a is null or tree_b is null then
    return new;
  end if;

  if tree_a is distinct from tree_b then
    -- Allow admins through (future cross-tree merge tooling).
    if public.is_admin(auth.uid()) then
      return new;
    end if;
    raise exception
      'Cross-tree relationship blocked: member % belongs to tree %, member % belongs to tree %',
      new.member_a_id, tree_a, new.member_b_id, tree_b;
  end if;

  return new;
end;
$$;

drop trigger if exists relationships_enforce_same_tree on public.relationships;
create trigger relationships_enforce_same_tree
  before insert or update on public.relationships
  for each row execute function public.enforce_relationship_same_tree();

-- ─── 4. Verification ───────────────────────────────────────────
do $$
declare
  null_count int;
  cross_tree_count int;
begin
  select count(*) into null_count
    from public.members
   where tree_id is null;
  if null_count > 0 then
    raise warning 'Verification: % members still have tree_id IS NULL', null_count;
  else
    raise notice 'Verification: zero members with tree_id IS NULL ✓';
  end if;

  select count(*) into cross_tree_count
    from public.relationships r
    join public.members ma on ma.id = r.member_a_id
    join public.members mb on mb.id = r.member_b_id
   where ma.tree_id is distinct from mb.tree_id;
  if cross_tree_count > 0 then
    raise warning 'Verification: % cross-tree relationship(s) still exist — likely admin-owned and untouched', cross_tree_count;
  else
    raise notice 'Verification: zero cross-tree relationships ✓';
  end if;
end $$;
