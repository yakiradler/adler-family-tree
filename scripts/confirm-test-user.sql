-- One-off: confirm the yakir17ari@gmail.com test account so we can
-- log in without the email round-trip. Idempotent.
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email = 'yakir17ari@gmail.com';

do $$
declare
  uid uuid;
  ec timestamptz;
begin
  select id, email_confirmed_at into uid, ec
    from auth.users where email = 'yakir17ari@gmail.com';
  raise notice 'user id: %, email_confirmed_at: %', uid, ec;
end$$;
