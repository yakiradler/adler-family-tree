do $$
declare
  cnt int;
  r record;
begin
  -- Count relationships for test user
  select count(*) into cnt
    from public.relationships rel
    join public.members m on m.id = rel.member_a_id
    join public.family_trees t on t.id = m.tree_id
   where t.created_by = (select id from auth.users where email = 'yakir17ari@gmail.com');
  raise notice 'relationships count for test user trees: %', cnt;

  -- List them
  for r in
    select rel.id, rel.type, rel.member_a_id, rel.member_b_id, ma.first_name as a, mb.first_name as b
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
      join public.family_trees t on t.id = ma.tree_id
     where t.created_by = (select id from auth.users where email = 'yakir17ari@gmail.com')
  loop
    raise notice 'rel: % | % → %', r.type, r.a, r.b;
  end loop;
end$$;
