do $$
declare r record;
begin
  for r in
    select u.id, u.email, p.role, p.full_name
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.email in ('yakir@davidvatine.co.il', 'yakir00010@gmail.com', 'yakir17ari@gmail.com')
  loop
    raise notice 'user: id=%, email=%, role=%, name=%', r.id, r.email, r.role, r.full_name;
  end loop;
end$$;
