-- Remove the bogus 3rd parent on יקיר.
--
-- Discovery diagnostic showed יקיר (b9897f4e-c1e3-44e6-8eb5-01e0bf7e98f6)
-- has THREE parent-child rows where he is the child:
--   1. לאה צירל אדלר (mother)        rel=de760873-bec9-4572-9d4e-453b7dd3ec52
--   2. נתנאל             (father)     rel=2bb631e0-ae2e-45e5-8e1b-4dac92718001
--   3. אחות              (??)         rel=f0d69d94-9630-4cb5-9667-b1c7f9f7bd83
--      created 2026-05-20 09:22 — in the bad Claude session today
--      "אחות" means "sister" — she was wrongly inserted as a parent.
--
-- Children can have at most 2 parents.  The 3rd row is the source of
-- weird generation arithmetic in buildLayout() (Math.max over 3 parents'
-- gens).  We delete row #3 only; rows #1 and #2 stay.

do $$
declare
  deleted_count int;
  r record;
begin
  raise notice '── Before delete, יקיר parent rows: ──';
  for r in
    select rel.id, ma.first_name, ma.gender, ma.id as parent_id, ma.created_at
      from public.relationships rel
      join public.members mb on mb.id = rel.member_b_id
      join public.members ma on ma.id = rel.member_a_id
     where rel.type = 'parent-child'
       and mb.id = 'b9897f4e-c1e3-44e6-8eb5-01e0bf7e98f6'  -- יקיר
     order by ma.created_at
  loop
    raise notice 'parent: % (gender=%, parent_id=%, rel=%)',
      r.first_name, coalesce(r.gender,'?'), r.parent_id, r.id;
  end loop;

  -- Delete only the specific bogus row.  Targeting by rel id (not by name)
  -- so this is idempotent and won't accidentally delete a legitimate
  -- future parent named "אחות".
  delete from public.relationships
   where id = 'f0d69d94-9630-4cb5-9667-b1c7f9f7bd83'
     and type = 'parent-child'
     and member_b_id = 'b9897f4e-c1e3-44e6-8eb5-01e0bf7e98f6'
     and member_a_id = 'eff9ab9a-abb0-4159-b9fd-9fc028db4770';  -- אחות

  get diagnostics deleted_count = row_count;
  raise notice '── Deleted % bogus parent row(s) ──', deleted_count;

  raise notice '── After delete, יקיר parent rows: ──';
  for r in
    select rel.id, ma.first_name, ma.gender, ma.id as parent_id
      from public.relationships rel
      join public.members mb on mb.id = rel.member_b_id
      join public.members ma on ma.id = rel.member_a_id
     where rel.type = 'parent-child'
       and mb.id = 'b9897f4e-c1e3-44e6-8eb5-01e0bf7e98f6'
  loop
    raise notice 'parent: % (gender=%, parent_id=%, rel=%)',
      r.first_name, coalesce(r.gender,'?'), r.parent_id, r.id;
  end loop;
end$$;
