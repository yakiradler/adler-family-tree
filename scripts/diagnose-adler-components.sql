-- Phase 2 diagnostic: trace the disjoint subtrees.
--
-- For every member, recursively walk up parent links until we hit a member
-- with no parent (a "root").  Group members by that root → each group is
-- one connected component (one subtree in the layout).  Then for each
-- root, also list its spouses (if any) so we can spot roots that should
-- be merged-as-spouse instead of treated as separate trees.
--
-- Also: dig into יקיר's 3 parents (multi-parent corruption) so we know
-- which link to delete.

do $$
declare
  r record;
  yakir_uid uuid;
begin
  select id into yakir_uid from auth.users where email = 'yakir00010@gmail.com';

  raise notice '════════ DISJOINT-COMPONENT TRACE ════════';

  -- Build a temp table of (member_id, root_id, distance) using recursive CTE,
  -- then group.

  drop table if exists tmp_components;
  create temp table tmp_components as
  with recursive walk as (
    -- base case: every member starts at themselves
    select m.id as member_id, m.id as cur_id, 0 as depth, m.first_name as cur_name
      from public.members m
     where m.created_by = yakir_uid
    union all
    -- step: replace cur with the FIRST parent of cur (deterministic via order by parent id)
    select w.member_id,
           (select rel.member_a_id from public.relationships rel
             where rel.type = 'parent-child' and rel.member_b_id = w.cur_id
             order by rel.member_a_id limit 1) as cur_id,
           w.depth + 1,
           (select first_name from public.members where id =
             (select rel.member_a_id from public.relationships rel
               where rel.type = 'parent-child' and rel.member_b_id = w.cur_id
               order by rel.member_a_id limit 1)) as cur_name
      from walk w
     where exists (select 1 from public.relationships rel
                    where rel.type = 'parent-child' and rel.member_b_id = w.cur_id)
       and w.depth < 20  -- safety cap against cycles
  )
  select distinct on (member_id)
         member_id,
         cur_id as root_id,
         cur_name as root_name,
         depth
    from walk
   where not exists (select 1 from public.relationships rel
                      where rel.type = 'parent-child' and rel.member_b_id = walk.cur_id)
   order by member_id, depth desc;

  raise notice '── component sizes (sorted desc) ──';
  for r in
    select root_id,
           (select first_name from public.members where id = root_id) as root_name,
           count(*) as member_count
      from tmp_components
     group by root_id
     order by count(*) desc
  loop
    raise notice 'component root="%" (%) → % members',
      coalesce(r.root_name,'⟨?⟩'), r.root_id, r.member_count;
  end loop;

  -- Show roots that ALSO have a spouse - these might be misplaced spouses
  -- that the layout SHOULD show as a partner of someone, not as a root.
  raise notice '';
  raise notice '── roots that have a spouse (potential auto-merge candidates) ──';
  for r in
    select m.id, m.first_name, m.last_name,
           ms.first_name as spouse_name, ms.last_name as spouse_last,
           rel.status as marriage_status,
           (select count(*) from tmp_components tc where tc.root_id = ms.id) as spouse_component_size,
           (select count(*) from public.relationships rel2
             where rel2.type = 'parent-child' and rel2.member_b_id = ms.id) as spouse_has_parents
      from public.members m
      join public.relationships rel on (rel.type='spouse' and (rel.member_a_id=m.id or rel.member_b_id=m.id))
      join public.members ms on ms.id = case when rel.member_a_id=m.id then rel.member_b_id else rel.member_a_id end
     where m.created_by = yakir_uid
       and not exists (
         select 1 from public.relationships rel2
          where rel2.type='parent-child' and rel2.member_b_id=m.id
       )
  loop
    raise notice 'root-with-spouse: % %  ⇄ spouse % %  (status=%, spouse-has-parents=%)',
      r.first_name, coalesce(r.last_name,''), r.spouse_name, coalesce(r.spouse_last,''),
      coalesce(r.marriage_status,'-'), case when r.spouse_has_parents>0 then 'YES' else 'no' end;
  end loop;

  -- Roots that are completely solo (no spouse, no children)
  raise notice '';
  raise notice '── roots that are ALONE (no children, no spouse) ──';
  for r in
    select m.id, m.first_name, m.last_name
      from public.members m
     where m.created_by = yakir_uid
       and not exists (select 1 from public.relationships rel where rel.member_b_id=m.id and rel.type='parent-child')
       and not exists (select 1 from public.relationships rel where (rel.member_a_id=m.id or rel.member_b_id=m.id) and rel.type='spouse')
       and not exists (select 1 from public.relationships rel where rel.member_a_id=m.id and rel.type='parent-child')
  loop
    raise notice 'lone root: % %  (id=%)', r.first_name, coalesce(r.last_name,''), r.id;
  end loop;

  -- Yakir's 3 parents
  raise notice '';
  raise notice '── יקיר''s 3 PARENT rows ──';
  for r in
    select rel.id as rel_id, ma.id as parent_id, ma.first_name, ma.last_name, ma.gender, ma.created_at
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where rel.type='parent-child'
       and mb.first_name='יקיר'
  loop
    raise notice 'parent: % %  (gender=%, id=%, rel_id=%, parent_created=%)',
      r.first_name, coalesce(r.last_name,''), coalesce(r.gender,'?'), r.parent_id, r.rel_id, r.created_at;
  end loop;

  raise notice '';
  raise notice '════════ END ════════';
end$$;
