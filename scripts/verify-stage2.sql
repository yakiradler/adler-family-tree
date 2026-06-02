-- Stage 2 verification query — run via run-migration.ts to confirm
-- the tree_id NOT NULL invariant + isolation guards landed cleanly.
do $$
declare
  null_count int;
  cross_tree int;
  member_count int;
  rel_count int;
  tree_count int;
  trigger_exists boolean;
begin
  select count(*) into null_count from public.members where tree_id is null;
  select count(*) into cross_tree
    from public.relationships r
    join public.members ma on ma.id = r.member_a_id
    join public.members mb on mb.id = r.member_b_id
   where ma.tree_id is distinct from mb.tree_id;
  select count(*) into member_count from public.members;
  select count(*) into rel_count from public.relationships;
  select count(*) into tree_count from public.family_trees;
  select exists (
    select 1 from pg_trigger
     where tgname = 'relationships_enforce_same_tree'
       and not tgisinternal
  ) into trigger_exists;

  raise notice '=== Stage 2 verification ===';
  raise notice 'members total: %', member_count;
  raise notice 'members with NULL tree_id: % (target: 0)', null_count;
  raise notice 'relationships total: %', rel_count;
  raise notice 'cross-tree relationships: % (target: 0 for new data; admin-owned legacy may persist)', cross_tree;
  raise notice 'family_trees total: %', tree_count;
  raise notice 'enforce-same-tree trigger present: %', trigger_exists;
end $$;
