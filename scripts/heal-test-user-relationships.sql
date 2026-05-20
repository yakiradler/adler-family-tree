-- Heal the test user's seeded skeleton tree: the new RLS race blocked
-- the relationships INSERT during seedSkeletonFamily, so the 5 members
-- exist in DB but with no spouse / parent-child links between them.
-- This one-off restores the 1 spouse + 6 parent-child rows so the
-- tree renders as 2 generations instead of 5 in one row.

do $$
declare
  father uuid := '9414b640-a3c6-42ae-9117-e30da60fb259';
  mother uuid := '1b1c8367-a299-46ef-9455-14f4bb4a85c2';
  c1 uuid := 'dcc1facf-308d-4643-978a-1802f04fd976';
  c2 uuid := '00cc9c64-49e8-4f10-b686-17d5785f8e5d';
  c3 uuid := 'eff9ab9a-abb0-4159-b9fd-9fc028db4770';
  kid uuid;
begin
  -- Spouse: father ↔ mother
  insert into public.relationships (member_a_id, member_b_id, type)
  values (father, mother, 'spouse')
  on conflict do nothing;

  -- Father + mother → each child
  foreach kid in array array[c1, c2, c3] loop
    insert into public.relationships (member_a_id, member_b_id, type)
    values (father, kid, 'parent-child')
    on conflict do nothing;
    insert into public.relationships (member_a_id, member_b_id, type)
    values (mother, kid, 'parent-child')
    on conflict do nothing;
  end loop;

  raise notice 'inserted spouse + parent-child links for test user skeleton';
end$$;

select count(*) as new_rel_count from public.relationships
 where member_a_id in (
   '9414b640-a3c6-42ae-9117-e30da60fb259',
   '1b1c8367-a299-46ef-9455-14f4bb4a85c2'
 );
