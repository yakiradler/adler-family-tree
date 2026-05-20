do $$
declare r record;
begin
  raise notice '── שיינדל 9fae6ce9 ──';
  for r in select * from public.members where id = '9fae6ce9-0fef-4415-90df-1660fbb4228e' loop
    raise notice 'name=% %, gender=%, tree=%, parents_lookup_needed', r.first_name, r.last_name, r.gender, r.tree_id;
  end loop;

  raise notice '── her relationships ──';
  for r in
    select rel.type, ma.first_name a, ma.id a_id, mb.first_name b, mb.id b_id
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where rel.member_a_id = '9fae6ce9-0fef-4415-90df-1660fbb4228e'
        or rel.member_b_id = '9fae6ce9-0fef-4415-90df-1660fbb4228e'
  loop
    raise notice 'rel: % | %(%) → %(%)', r.type, r.a, r.a_id, r.b, r.b_id;
  end loop;
end$$;
