-- 024: self-edit own card + contact-suggestion approval by subject/editors
--
-- Owner request: any signed-in user can
--   • edit THEIR OWN member card (the one profiles.linked_member_id points
--     at) with NO approval; and
--   • SUGGEST contact details for ANYONE (already possible via the
--     existing edit_requests er_insert_auth policy);
-- and a pending suggestion may be approved by EITHER the subject (the
-- person it is about — their linked user) OR anyone with write access to
-- that member's tree (editor / owner), in addition to admins.
--
-- All statements are idempotent + additive. Existing rows/behaviour are
-- preserved (these policies only GRANT extra rights; they never revoke).

-- ── Helper: is p_member the caller's own linked member card? ──
create or replace function public.is_my_member(p_uid uuid, p_member uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and linked_member_id = p_member
  );
$$;

-- ── members: a user may edit their OWN card directly (no approval) ──
drop policy if exists "members_update_self" on public.members;
create policy "members_update_self" on public.members for update
  using (public.is_my_member(auth.uid(), id))
  with check (public.is_my_member(auth.uid(), id));

-- ── edit_requests: the subject (person it is about) can see + decide ──
drop policy if exists "er_select_subject" on public.edit_requests;
drop policy if exists "er_update_subject" on public.edit_requests;
create policy "er_select_subject" on public.edit_requests for select
  using (public.is_my_member(auth.uid(), target_member_id));
create policy "er_update_subject" on public.edit_requests for update
  using (public.is_my_member(auth.uid(), target_member_id))
  with check (public.is_my_member(auth.uid(), target_member_id));

-- ── edit_requests: anyone with WRITE access to the member's tree
--    (editor / owner) can see + decide — not only owners/admins ──
drop policy if exists "er_select_writer" on public.edit_requests;
drop policy if exists "er_update_writer" on public.edit_requests;
create policy "er_select_writer" on public.edit_requests for select
  using (public.has_tree_write(auth.uid(), public.member_tree(target_member_id)));
create policy "er_update_writer" on public.edit_requests for update
  using (public.has_tree_write(auth.uid(), public.member_tree(target_member_id)))
  with check (public.has_tree_write(auth.uid(), public.member_tree(target_member_id)));

-- ── Also notify the subject's own account when a suggestion is filed
--    about them (in addition to the existing tree-owner notification) ──
create or replace function public.handle_edit_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_tree uuid;
  v_data jsonb;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  v_tree := public.member_tree(new.target_member_id);
  v_data := jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'target_member_id', new.target_member_id
  );
  perform public.notify_tree_owners(v_tree, 'edit_request', v_data);
  -- Ping the subject's linked account (if any, and not the requester).
  insert into public.notifications (user_id, type, data)
  select p.id, 'edit_request', v_data
  from public.profiles p
  where p.linked_member_id = new.target_member_id
    and p.id <> new.requester_id
    and coalesce(p.active, true) = true
    and p.deleted_at is null;
  return new;
end;
$$;

do $$ begin
  raise notice '024 applied: self-edit own card + subject/editor edit_request approval + subject notification';
end $$;
