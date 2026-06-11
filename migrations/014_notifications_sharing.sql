-- ============================================================
-- 014 — Notification center + sharing upgrades (pilot round 2)
--
-- 1. family_trees.icon_url          — custom tree icon (PR2 UI)
-- 2. tree_invites.created_for       — "this code was minted FOR user X"
--    + tree owners may mint codes for their own trees (not only admins)
-- 3. notifications table            — persistent per-user inbox.
--    Rows are written ONLY by SECURITY DEFINER triggers (no client
--    INSERT policy): new requests notify admins; decisions notify the
--    requester (approval embeds the minted share code).
-- 4. tree-icons storage bucket      — public-read icon images.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── 1. family_trees.icon_url ───────────────────────────────
alter table public.family_trees
  add column if not exists icon_url text;

-- ─── 2. tree_invites.created_for + owner minting ───────────
alter table public.tree_invites
  add column if not exists created_for uuid references auth.users(id) on delete set null;

create index if not exists inv_created_for_idx
  on public.tree_invites(created_for, tree_id);

-- Owners of a tree can mint codes for THAT tree; admins for any.
drop policy if exists "inv_insert_admin" on public.tree_invites;
create policy "inv_insert_admin" on public.tree_invites for insert
  with check (
    public.is_admin(auth.uid())
    or (
      tree_id is not null
      and created_by = auth.uid()
      and exists (
        select 1 from public.family_trees ft
        where ft.id = tree_invites.tree_id
          and ft.created_by = auth.uid()
      )
    )
  );

-- ─── 3. notifications ───────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Text is rendered client-side from type+data so it localizes;
  -- the table stores no display strings.
  type        text not null check (type in (
    'access_request',      -- someone asked to join / get tree access
    'share_code_request',  -- someone asked for a share code
    'edit_request',        -- someone proposed a member edit
    'feedback',            -- someone filed a bug/question report
    'request_approved',    -- your access request was approved
    'request_rejected'     -- your access request was declined
  )),
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists ntf_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists ntf_user_unread_idx
  on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "ntf_select_own" on public.notifications;
drop policy if exists "ntf_update_own" on public.notifications;
drop policy if exists "ntf_delete_own" on public.notifications;
create policy "ntf_select_own" on public.notifications for select
  using (user_id = auth.uid());
create policy "ntf_update_own" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ntf_delete_own" on public.notifications for delete
  using (user_id = auth.uid());
-- NO insert policy on purpose: only the SECURITY DEFINER trigger
-- functions below (running as the table owner, which bypasses RLS)
-- may create notifications. Do NOT add FORCE ROW LEVEL SECURITY.

-- Fan a notification out to every active admin.
create or replace function public.notify_admins(p_type text, p_data jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, data)
  select p.id, p_type, coalesce(p_data, '{}'::jsonb)
  from public.profiles p
  where p.role = 'admin'
    and coalesce(p.active, true) = true
    and p.deleted_at is null;
$$;

-- New access request → notify admins. Share-code asks get their own
-- type so the admin inbox can count them separately.
create or replace function public.handle_access_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_type text;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  v_type := case
    when new.answers->>'intent' = 'request_share_code' then 'share_code_request'
    else 'access_request'
  end;
  perform public.notify_admins(v_type, jsonb_build_object(
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

drop trigger if exists on_access_request_created on public.access_requests;
create trigger on_access_request_created
  after insert on public.access_requests
  for each row execute procedure public.handle_access_request_created();

-- New edit request → notify admins.
create or replace function public.handle_edit_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = new.requester_id;
  perform public.notify_admins('edit_request', jsonb_build_object(
    'request_id', new.id,
    'requester_id', new.requester_id,
    'requester_name', coalesce(v_name, ''),
    'target_member_id', new.target_member_id
  ));
  return new;
end;
$$;

drop trigger if exists on_edit_request_created on public.edit_requests;
create trigger on_edit_request_created
  after insert on public.edit_requests
  for each row execute procedure public.handle_edit_request_created();

-- New feedback/report → notify admins.
create or replace function public.handle_feedback_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins('feedback', jsonb_build_object(
    'feedback_id', new.id,
    'category', new.category,
    'author_name', new.author_name
  ));
  return new;
end;
$$;

drop trigger if exists on_feedback_created on public.feedback;
create trigger on_feedback_created
  after insert on public.feedback
  for each row execute procedure public.handle_feedback_created();

-- Decision on an access request → notify the requester. On approval,
-- embed the newest still-active share code minted FOR them (the client
-- mints the invite BEFORE flipping status, so it's committed by now).
-- The WHEN guard on the trigger keeps re-runs / unrelated updates from
-- duplicating notifications.
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
begin
  if new.status = 'approved' then
    select i.code, i.tree_id into v_code, v_tree_id
    from public.tree_invites i
    where i.created_for = new.requester_id
      and (i.expires_at is null or i.expires_at > now())
      and (i.uses_left is null or i.uses_left > 0)
      and (
        new.answers->>'target_tree_id' is null
        or i.tree_id = (new.answers->>'target_tree_id')::uuid
      )
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

drop trigger if exists on_access_request_decided on public.access_requests;
create trigger on_access_request_decided
  after update of status on public.access_requests
  for each row
  when (old.status = 'pending' and new.status in ('approved', 'rejected'))
  execute procedure public.handle_access_request_decided();

-- ─── 4. tree-icons storage bucket ───────────────────────────
insert into storage.buckets (id, name, public)
values ('tree-icons', 'tree-icons', true)
on conflict (id) do nothing;

-- Policies on storage.objects sometimes require elevated rights; if
-- this role can't create them, degrade to a NOTICE — the same four
-- policies can be added from Dashboard → Storage → Policies.
do $$
begin
  drop policy if exists "tree_icons_public_read"  on storage.objects;
  drop policy if exists "tree_icons_owner_insert" on storage.objects;
  drop policy if exists "tree_icons_owner_update" on storage.objects;
  drop policy if exists "tree_icons_owner_delete" on storage.objects;
  create policy "tree_icons_public_read" on storage.objects for select
    using (bucket_id = 'tree-icons');
  create policy "tree_icons_owner_insert" on storage.objects for insert
    with check (
      bucket_id = 'tree-icons' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.family_trees ft
          where ft.id::text = split_part(storage.objects.name, '/', 1)
            and ft.created_by = auth.uid()
        )
      )
    );
  create policy "tree_icons_owner_update" on storage.objects for update
    using (
      bucket_id = 'tree-icons' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.family_trees ft
          where ft.id::text = split_part(storage.objects.name, '/', 1)
            and ft.created_by = auth.uid()
        )
      )
    );
  create policy "tree_icons_owner_delete" on storage.objects for delete
    using (
      bucket_id = 'tree-icons' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.family_trees ft
          where ft.id::text = split_part(storage.objects.name, '/', 1)
            and ft.created_by = auth.uid()
        )
      )
    );
exception when insufficient_privilege then
  raise notice 'storage.objects policies skipped (insufficient privilege) — create them in Dashboard > Storage > Policies';
end$$;

-- ─── verification ───────────────────────────────────────────
do $$
declare
  n_pol int;
  n_trg int;
begin
  select count(*) into n_pol from pg_policies
    where schemaname = 'public' and tablename = 'notifications';
  select count(*) into n_trg from pg_trigger
    where tgname in (
      'on_access_request_created', 'on_edit_request_created',
      'on_feedback_created', 'on_access_request_decided'
    ) and not tgisinternal;
  raise notice 'notifications policies: % (expect 3), triggers: % (expect 4)', n_pol, n_trg;
end$$;
