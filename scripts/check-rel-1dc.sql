do $$
declare r record;
begin
  for r in select * from public.relationships where id = '1dc298cf-0ce5-492a-a315-42dd4954424b' loop
    raise notice 'rel 1dc298cf: type=%, a=%, b=%, status=%', r.type, r.member_a_id, r.member_b_id, r.status;
  end loop;
  raise notice '── all relationships from member 84d8d493 (יחזקאל top-level) ──';
  for r in
    select rel.id, rel.type, ma.first_name a, mb.first_name b
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where rel.member_a_id = '84d8d493-442a-4293-8f55-4819b864a137'
  loop
    raise notice 'rel: id=%, type=%, %->%', r.id, r.type, r.a, r.b;
  end loop;
end$$;
