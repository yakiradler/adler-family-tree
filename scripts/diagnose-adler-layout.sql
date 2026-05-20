-- Comprehensive layout diagnostic for the Adler family tree.
-- Goal: figure out why infinitree.vercel.app/#/tree renders with abnormal
-- horizontal spread and isolated clusters far to the right.
--
-- We replicate the data shape the layout engine receives:
--   - members rows (id, first_name, last_name, gender, tree_id, connector_parent_id, birth_order)
--   - relationships rows (type, member_a_id, member_b_id, status)
-- and look for the conditions that make `buildLayout()` create multiple
-- disjoint "roots":
--   1. members with no parent-child row where they're the child
--   2. members whose declared parent doesn't exist (orphan FK)
--   3. duplicate parent-child rows
--   4. spouses across non-adjacent generations (forces same-row pull)
--   5. members with tree_id mismatch or null that filter into different views
--   6. connector_parent_id pointing nowhere

do $$
declare
  r record;
  total_members int;
  total_rels int;
  pc_count int;
  sp_count int;
  root_count int;
begin
  raise notice '════════ ADLER TREE LAYOUT DIAGNOSTIC ════════';

  select count(*) into total_members from public.members
    where created_by = (select id from auth.users where email = 'yakir00010@gmail.com');
  select count(*) into total_rels from public.relationships
    where member_a_id in (
      select id from public.members where created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
    );
  raise notice '── members (yakir-owned): % ──', total_members;
  raise notice '── relationships touching yakir-owned: % ──', total_rels;

  select count(*) into pc_count from public.relationships rel
    join public.members ma on ma.id = rel.member_a_id
   where rel.type = 'parent-child' and ma.created_by = (select id from auth.users where email = 'yakir00010@gmail.com');
  select count(*) into sp_count from public.relationships rel
    join public.members ma on ma.id = rel.member_a_id
   where rel.type = 'spouse' and ma.created_by = (select id from auth.users where email = 'yakir00010@gmail.com');
  raise notice '── parent-child rels: %  ─  spouse rels: % ──', pc_count, sp_count;

  -- ── 1. roots: members with no parent-child row where they're the child ──
  raise notice '';
  raise notice '═══ 1. TOP-LEVEL ROOTS (no parent record) ═══';
  select count(*) into root_count
    from public.members m
   where m.created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
     and not exists (
       select 1 from public.relationships rel
        where rel.type = 'parent-child' and rel.member_b_id = m.id
     );
  raise notice 'TOTAL ROOTS: %  (expected: ~1–2 for a well-formed family tree)', root_count;
  for r in
    select m.id, m.first_name, m.last_name, m.gender, m.tree_id, m.birth_order, m.created_at
      from public.members m
     where m.created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
       and not exists (
         select 1 from public.relationships rel
          where rel.type = 'parent-child' and rel.member_b_id = m.id
       )
     order by m.created_at
  loop
    raise notice 'root: % %  gender=%  tree_id=%  birth_order=%  id=%',
      r.first_name, coalesce(r.last_name,''), coalesce(r.gender,'?'), coalesce(r.tree_id::text,'NULL'), coalesce(r.birth_order,-1), r.id;
  end loop;

  -- ── 2. orphan parent-child FK (parent or child doesn't exist) ──
  raise notice '';
  raise notice '═══ 2. ORPHAN parent-child FK ═══';
  for r in
    select rel.id, rel.member_a_id, rel.member_b_id,
           (select first_name from public.members where id = rel.member_a_id) as a_name,
           (select first_name from public.members where id = rel.member_b_id) as b_name
      from public.relationships rel
     where rel.type = 'parent-child'
       and (
         not exists (select 1 from public.members where id = rel.member_a_id)
         or not exists (select 1 from public.members where id = rel.member_b_id)
       )
  loop
    raise notice 'ORPHAN rel id=%  a=% (name=%)  b=% (name=%)',
      r.id, r.member_a_id, coalesce(r.a_name,'⟨missing⟩'), r.member_b_id, coalesce(r.b_name,'⟨missing⟩');
  end loop;

  -- ── 3. duplicate parent-child (same a→b twice) ──
  raise notice '';
  raise notice '═══ 3. DUPLICATE parent-child rows ═══';
  for r in
    select member_a_id, member_b_id, count(*) as n
      from public.relationships
     where type = 'parent-child'
     group by member_a_id, member_b_id
    having count(*) > 1
  loop
    raise notice 'DUPLICATE: a=% b=% (×%)', r.member_a_id, r.member_b_id, r.n;
  end loop;

  -- ── 4. members with 3+ parents (only 2 are valid, more = data corruption) ──
  raise notice '';
  raise notice '═══ 4. MEMBERS WITH 3+ PARENTS ═══';
  for r in
    select rel.member_b_id, count(*) as n,
           (select first_name from public.members where id = rel.member_b_id) as child_name
      from public.relationships rel
     where rel.type = 'parent-child'
     group by rel.member_b_id
    having count(*) > 2
  loop
    raise notice 'MULTI-PARENT: child=% (%) has % parents', r.child_name, r.member_b_id, r.n;
  end loop;

  -- ── 5. tree_id distribution ──
  raise notice '';
  raise notice '═══ 5. tree_id DISTRIBUTION ═══';
  for r in
    select coalesce(tree_id::text, 'NULL') as tid, count(*) as n
      from public.members
     where created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
     group by tree_id
     order by n desc
  loop
    raise notice 'tree_id=%  →  % members', r.tid, r.n;
  end loop;

  -- ── 6. connector_parent_id sanity ──
  raise notice '';
  raise notice '═══ 6. connector_parent_id ANOMALIES ═══';
  for r in
    select m.id, m.first_name, m.connector_parent_id
      from public.members m
     where m.created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
       and m.connector_parent_id is not null
       and (
         not exists (select 1 from public.members where id = m.connector_parent_id)
         or not exists (
           select 1 from public.relationships rel
            where rel.type = 'parent-child'
              and rel.member_a_id = m.connector_parent_id
              and rel.member_b_id = m.id
         )
       )
  loop
    raise notice 'BAD connector: member=% (%) → connector_parent_id=% (FK orphan or not a real parent)',
      r.first_name, r.id, r.connector_parent_id;
  end loop;

  -- ── 7. spouse mismatch: spouses where the two members aren't in adjacent generations
  --      we can't compute generation purely in SQL without a recursive CTE; just show
  --      spouse rows whose two members have no common parent path
  raise notice '';
  raise notice '═══ 7. SPOUSE PAIRS (sanity sample) ═══';
  for r in
    select ma.first_name as a_name, mb.first_name as b_name, rel.status,
           ma.gender as a_gender, mb.gender as b_gender,
           ma.id as a_id, mb.id as b_id
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where rel.type = 'spouse'
       and ma.created_by = (select id from auth.users where email = 'yakir00010@gmail.com')
  loop
    raise notice 'spouse: % (%) ⇄ % (%)  status=%',
      r.a_name, coalesce(r.a_gender,'?'), r.b_name, coalesce(r.b_gender,'?'), coalesce(r.status,'-');
  end loop;

  raise notice '';
  raise notice '════════ END DIAGNOSTIC ════════';
end$$;
