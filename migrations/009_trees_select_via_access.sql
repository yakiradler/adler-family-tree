-- Migration 009: scope family_trees SELECT to actual access.
--
-- Migration 008 added tree_access and locked down members/relationships
-- per-tree, but `family_trees.trees_select_all` stayed `using (true)`.
-- That's mostly fine — names + colours aren't very sensitive — but it
-- also meant the Dashboard rail couldn't trust the server to filter to
-- the user's trees: the UI had to do `created_by === profile.id`, which
-- broke the invite-code flow (a user who joined a tree never created
-- it, so they got hidden from their own rail).
--
-- Replace with a scoped policy and rely on it client-side.  Admins
-- still see everything; owners always see their own; everyone else
-- only sees trees they have a tree_access row for.
-- ============================================================

alter table public.family_trees enable row level security;
drop policy if exists "trees_select_all"     on public.family_trees;
drop policy if exists "trees_select_visible" on public.family_trees;
create policy "trees_select_visible"
  on public.family_trees for select
  using (
    public.is_admin(auth.uid())
    or created_by = auth.uid()
    or exists (
      select 1 from public.tree_access
       where tree_access.tree_id = family_trees.id
         and tree_access.user_id = auth.uid()
    )
  );

-- Verification
do $$
declare total int;
begin
  select count(*) into total from pg_policies
    where schemaname = 'public' and tablename = 'family_trees' and policyname = 'trees_select_visible';
  raise notice 'trees_select_visible policies: %', total;
end$$;
