do $$
declare
  uid uuid;
  r record;
  rel record;
begin
  select id into uid from auth.users where email = 'yakir17ari@gmail.com';
  raise notice 'test user id: %', uid;

  raise notice '── trees owned by this user ──';
  for r in
    select id, name, created_at from public.family_trees where created_by = uid
  loop
    raise notice 'tree: id=%, name=%, created=%', r.id, r.name, r.created_at;
  end loop;

  raise notice '── members in test user trees ──';
  for r in
    select m.id, m.first_name, m.tree_id, m.created_by
      from public.members m
      join public.family_trees t on t.id = m.tree_id
     where t.created_by = uid
     order by m.created_at
  loop
    raise notice 'member: id=%, first_name=%, tree=%, by=%', r.id, r.first_name, r.tree_id, r.created_by;
  end loop;

  raise notice '── relationships involving those members ──';
  for rel in
    select r.id, r.type, r.member_a_id, r.member_b_id,
           ma.first_name as a_name, mb.first_name as b_name
      from public.relationships r
      join public.members ma on ma.id = r.member_a_id
      join public.members mb on mb.id = r.member_b_id
      join public.family_trees t on t.id = ma.tree_id
     where t.created_by = uid
  loop
    raise notice 'rel: type=%, % → %', rel.type, rel.a_name, rel.b_name;
  end loop;
end$$;
