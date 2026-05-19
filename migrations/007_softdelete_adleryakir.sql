-- One-off: soft-delete the adleryakir@gmail.com account.
--
-- Need to cover both cases:
--   • profile row exists (previous "remove" only nuked the profile,
--     trigger may have recreated it on next login) → update it
--   • profile row absent → insert a stub row with deleted_at set so
--     the trigger sees an existing conflict to preserve on next login

with target as (
  select id from auth.users where lower(email) = lower('adleryakir@gmail.com')
)
insert into public.profiles (id, full_name, role, deleted_at)
select t.id, 'adleryakir', 'user', now()
  from target t
  on conflict (id) do update set deleted_at = now();

do $$
declare
  cnt int;
begin
  select count(*) into cnt
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(u.email) = lower('adleryakir@gmail.com')
     and p.deleted_at is not null;
  raise notice 'adleryakir profiles marked deleted: %', cnt;
end$$;
