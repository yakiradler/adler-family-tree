do $$
declare
  r record;
begin
  raise notice '── top-level members (no parents) named יחזקאל / יעקב / שיינדל / חיה שרה ──';
  for r in
    select m.id, m.first_name, m.last_name, m.gender, m.created_at
      from public.members m
     where m.first_name in ('יחזקאל', 'יעקב אהרן', 'יעקב אהרון', 'שיינדל', 'חיה שרה')
       and not exists (
         select 1 from public.relationships rel
          where rel.type = 'parent-child' and rel.member_b_id = m.id
       )
     order by m.created_at
  loop
    raise notice 'member: %, last_name=%, gender=%, id=%', r.first_name, r.last_name, r.gender, r.id;
  end loop;

  raise notice '── all relationships involving these top-level members ──';
  for r in
    select rel.type, rel.status,
           ma.first_name as a_name, mb.first_name as b_name,
           ma.id as a_id, mb.id as b_id
      from public.relationships rel
      join public.members ma on ma.id = rel.member_a_id
      join public.members mb on mb.id = rel.member_b_id
     where (ma.first_name in ('יחזקאל', 'יעקב אהרן', 'יעקב אהרון', 'שיינדל', 'חיה שרה')
        or mb.first_name in ('יחזקאל', 'יעקב אהרן', 'יעקב אהרון', 'שיינדל', 'חיה שרה'))
  loop
    raise notice 'rel: %  | % → %  (status=%, a=%, b=%)',
      r.type, r.a_name, r.b_name, r.status, r.a_id, r.b_id;
  end loop;
end$$;
