do $$
declare r record;
begin
  raise notice '── all members named שיינדל ──';
  for r in
    select id, first_name, last_name, gender, created_at from public.members
     where first_name like '%שיינדל%' or last_name like '%שיינדל%'
     order by created_at desc
  loop
    raise notice 'member: id=%, name=% %, gender=%', r.id, r.first_name, r.last_name, r.gender;
  end loop;

  raise notice '── relationships for שיינדל-named members ──';
  for r in
    select rel.type, rel.member_a_id, rel.member_b_id, ma.first_name as a, mb.first_name as b
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where ma.first_name like '%שיינדל%' or mb.first_name like '%שיינדל%'
  loop
    raise notice 'rel: % | % → %', r.type, r.a, r.b;
  end loop;
end$$;
