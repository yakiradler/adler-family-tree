do $$
declare r record;
begin
  raise notice '── all spouse-type relationships involving top-level יחזקאל id=84d8d493 ──';
  for r in
    select rel.type, ma.first_name as a, ma.id as a_id, mb.first_name as b, mb.id as b_id
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where (rel.member_a_id = '84d8d493-442a-4293-8f55-4819b864a137'
         or rel.member_b_id = '84d8d493-442a-4293-8f55-4819b864a137')
  loop
    raise notice 'rel: % | %(%) → %(%)', r.type, r.a, r.a_id, r.b, r.b_id;
  end loop;
end$$;
