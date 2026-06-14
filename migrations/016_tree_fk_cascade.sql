-- ============================================================
-- Migration 016: resolve the members.tree_id FK contradiction
-- ------------------------------------------------------------
-- Why this exists
--   Migration 011 made `members.tree_id` NOT NULL ("every member
--   belongs to a tree"). But the foreign key stayed ON DELETE SET
--   NULL (inherited from 004/008). Those two rules contradict each
--   other: deleting a tree makes Postgres try to set its members'
--   tree_id to NULL, which the NOT NULL column rejects — so the
--   whole DELETE aborts. That is the root cause of the "deleting a
--   tree with members fails silently" bug. The app currently works
--   around it by deleting members first, but the schema itself is a
--   landmine for any other delete path.
--
-- What this does
--   Aligns the FK with the NOT NULL intent: deleting a tree CASCADES
--   to its members in one atomic transaction. Tree deletion is
--   already (a) owner/admin-only via RLS and (b) confirmed in the UI,
--   so cascade is the correct, non-surprising semantic — and it
--   removes the partial-failure window the members-first workaround
--   has (members deleted on the server, then the tree delete fails).
--
-- Safety
--   * Idempotent: only swaps the constraint when it isn't already
--     CASCADE; re-running is a no-op.
--   * Reads nothing destructive on its own — it just changes the rule
--     that applies WHEN a tree is explicitly deleted.
-- ============================================================

do $$
begin
  if exists (
    select 1
      from information_schema.referential_constraints rc
      join information_schema.table_constraints tc
        on tc.constraint_name = rc.constraint_name
       and tc.constraint_schema = rc.constraint_schema
     where tc.table_schema = 'public'
       and tc.table_name = 'members'
       and tc.constraint_name = 'members_tree_id_fkey'
       and rc.delete_rule <> 'CASCADE'
  ) then
    alter table public.members drop constraint members_tree_id_fkey;
    alter table public.members
      add constraint members_tree_id_fkey
      foreign key (tree_id) references public.family_trees(id) on delete cascade;
    raise notice '016: members_tree_id_fkey changed to ON DELETE CASCADE';
  else
    raise notice '016: members_tree_id_fkey already CASCADE (or absent) — no change';
  end if;
end $$;

-- Verification block (surfaces in the run log).
do $$
declare v_rule text;
begin
  select rc.delete_rule into v_rule
    from information_schema.referential_constraints rc
   where rc.constraint_name = 'members_tree_id_fkey';
  raise notice '016 VERIFY: members_tree_id_fkey delete_rule = %', coalesce(v_rule, 'MISSING');
end $$;
