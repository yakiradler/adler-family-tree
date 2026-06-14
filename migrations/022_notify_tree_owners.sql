-- ============================================================
-- Migration 022: route request notifications to TREE OWNERS
-- ------------------------------------------------------------
-- Join / edit / share-code requests for a tree now notify that tree's
-- OWNER(s) instead of every platform admin — so owners self-manage. Falls
-- back to notifying admins when the tree is unknown or has no owner
-- (never zero-notify). Re-defines the trigger FUNCTIONS only; existing
-- triggers stay bound by name. Feedback stays admin-routed (platform).
--
-- Depends on request_tree_id()/member_tree() (021). Idempotent.
-- ============================================================

set check_function_bodies = off;

-- Fan a notification to a tree's owners; fall back to admins if none.
create or replace function public.notify_tree_owners(p_tree uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_tree is null then
    perform public.notify_admins(p_type, p_data);
    return;
  end if;
  insert into public.notifications (user_id, type, data)
  select ta.user_id, p_type, coalesce(p_data, '{}'::jsonb)
  from public.tree_access ta
  join public.profiles p on p.id = ta.user_id
  where ta.tree_id = p_tree
    and ta.role = 'owner'
    and coalesce(p.active, true) = true
    and p.deleted_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform public.notify_admins(p_type, p_data);
  end if;
end;
$$;

-- Access/share-code requests → the target tree's owners (else admins).
create or replace function public.handle_access_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_type text;
  v_tree uuid;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  v_type := case
    when new.answers->>'intent' = 'request_share_code' then 'share_code_request'
    else 'access_request'
  end;
  v_tree := public.request_tree_id(new.answers);
  perform public.notify_tree_owners(v_tree, v_type, jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'tree_id', new.answers->>'target_tree_id',
    'tree_name', new.answers->>'target_tree_name',
    'requested_role', new.requested_role
  ));
  return new;
end;
$$;

-- Edit requests → owners of the target member's tree (else admins).
create or replace function public.handle_edit_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_tree uuid;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  v_tree := public.member_tree(new.target_member_id);
  perform public.notify_tree_owners(v_tree, 'edit_request', jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'target_member_id', new.target_member_id
  ));
  return new;
end;
$$;

do $$
begin
  raise notice '022 applied: access + edit request notifications now route to tree owners (admin fallback).';
end$$;
