-- 025: make the access-request decision trigger robust to a non-UUID
--      target_tree_id.
--
-- Bug: a stale access_request can carry a LOCAL tree id (e.g.
-- 'tree-1779191334390-uk1lp') in answers.target_tree_id. The decision
-- trigger cast it directly with (answers->>'target_tree_id')::uuid, which
-- raised "invalid input syntax for type uuid" and aborted the whole
-- approve/reject UPDATE (surfaced to the admin as
-- "decideAccessRequest:request ... invalid input syntax for type uuid").
--
-- Fix: use the null-safe public.request_tree_id() helper (migration 021)
-- instead of the raw cast. Idempotent (create or replace); the trigger
-- itself is unchanged.

create or replace function public.handle_access_request_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_tree_id uuid;
  v_tree_name text;
  v_target uuid;
begin
  v_target := public.request_tree_id(new.answers);  -- null-safe cast
  if new.status = 'approved' then
    select i.code, i.tree_id into v_code, v_tree_id
    from public.tree_invites i
    where i.created_for = new.requester_id
      and (i.expires_at is null or i.expires_at > now())
      and (i.uses_left is null or i.uses_left > 0)
      and (v_target is null or i.tree_id = v_target)
    order by i.created_at desc
    limit 1;
    if v_tree_id is not null then
      select t.name into v_tree_name from public.family_trees t where t.id = v_tree_id;
    end if;
    insert into public.notifications (user_id, type, data)
    values (new.requester_id, 'request_approved', jsonb_build_object(
      'request_id', new.id,
      'code', v_code,
      'tree_id', coalesce(v_tree_id::text, new.answers->>'target_tree_id'),
      'tree_name', coalesce(v_tree_name, new.answers->>'target_tree_name')
    ));
  else
    insert into public.notifications (user_id, type, data)
    values (new.requester_id, 'request_rejected', jsonb_build_object(
      'request_id', new.id,
      'tree_name', new.answers->>'target_tree_name'
    ));
  end if;
  return new;
end;
$$;

do $$ begin
  raise notice '025 applied: handle_access_request_decided now uses null-safe request_tree_id()';
end $$;
