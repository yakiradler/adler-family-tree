-- ============================================================
-- Migration 032: per-status visibility — approved trees + hide-from
-- ------------------------------------------------------------
-- Why this exists
--   Until now every member of a tree saw every post in that tree, full
--   stop. The owner wants per-post control: "who can view" (which other
--   connected trees are approved to see it) and "hide from" (specific
--   people). Set at upload time, editable after — by the uploader, the
--   tree owner, or an admin only.
--
-- Model (two side tables, additive — family_statuses is untouched except
-- for the rewritten SELECT policy + a new UPDATE policy)
--   * family_status_shares(status_id, tree_id): extra trees allowed to
--     see the post. A post shared to tree B shows up in B's feed too.
--   * family_status_hidden(status_id, member_id): people the post is
--     hidden from. Keyed by member (the person you pick in the UI);
--     resolved to the viewing user via profiles.linked_member_id.
--
-- Visibility rule (rewritten fs_select_scoped)
--   author / tree owner / admin always see (for editing + moderation).
--   Everyone else sees a post iff
--     ( they have access to its own tree  OR  it's shared to a tree they
--       can access )  AND  it isn't hidden from them.
--
-- Safety
--   * All visibility checks go through SECURITY DEFINER helpers so the
--     policy's subqueries don't re-trigger RLS on the side tables /
--     profiles (the has_tree_access pattern from migration 008).
--   * Idempotent: if-not-exists tables + create-or-replace fns +
--     drop-then-create policies.
--   Depends on: has_tree_access (008), is_tree_owner (020), is_admin
--   (005), status_tree (031), profiles.linked_member_id (010).
-- ============================================================

set check_function_bodies = off;

-- ─── 1. Side tables ──────────────────────────────────────────
create table if not exists public.family_status_shares (
  status_id uuid not null references public.family_statuses(id) on delete cascade,
  tree_id   uuid not null references public.family_trees(id) on delete cascade,
  primary key (status_id, tree_id)
);
-- Drives the "shared INTO this tree" feed query.
create index if not exists family_status_shares_tree_idx
  on public.family_status_shares(tree_id, status_id);

create table if not exists public.family_status_hidden (
  status_id uuid not null references public.family_statuses(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (status_id, member_id)
);

alter table public.family_status_shares enable row level security;
alter table public.family_status_hidden enable row level security;

-- ─── 2. Helpers (security definer → bypass RLS internally) ────
create or replace function public.status_author(s_id uuid)
returns uuid language sql security definer stable as $$
  select author_id from public.family_statuses where id = s_id;
$$;

-- Can `uid` manage this status's visibility? (uploader / owner / admin)
create or replace function public.status_can_manage(s_id uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select
    public.status_author(s_id) = uid
    or public.is_tree_owner(uid, public.status_tree(s_id))
    or public.is_admin(uid);
$$;

-- Is the status shared to any tree `uid` can access?
create or replace function public.status_shared_to_me(s_id uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.family_status_shares sh
    where sh.status_id = s_id
      and public.has_tree_access(uid, sh.tree_id)
  );
$$;

-- Is the status explicitly hidden from `uid` (via their linked member)?
create or replace function public.status_hidden_from(s_id uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
      from public.family_status_hidden h
      join public.profiles p on p.linked_member_id = h.member_id
     where h.status_id = s_id and p.id = uid
  );
$$;

-- ─── 3. Rewrite family_statuses SELECT + add UPDATE ──────────
drop policy if exists "fs_select_scoped" on public.family_statuses;
create policy "fs_select_scoped" on public.family_statuses for select
  using (
    author_id = auth.uid()
    or public.is_tree_owner(auth.uid(), tree_id)
    or public.is_admin(auth.uid())
    or (
      ( public.has_tree_access(auth.uid(), tree_id)
        or public.status_shared_to_me(id, auth.uid()) )
      and not public.status_hidden_from(id, auth.uid())
    )
  );

-- Editing the post body / audience (was impossible — no UPDATE policy).
drop policy if exists "fs_update_owner" on public.family_statuses;
create policy "fs_update_owner" on public.family_statuses for update
  using (
    author_id = auth.uid()
    or public.is_tree_owner(auth.uid(), tree_id)
    or public.is_admin(auth.uid())
  )
  with check (
    author_id = auth.uid()
    or public.is_tree_owner(auth.uid(), tree_id)
    or public.is_admin(auth.uid())
  );

-- ─── 4. RLS for the side tables ──────────────────────────────
-- shares: visible to anyone who can see the post (own tree or the shared
-- tree, so the feed merge can read them); writable only by manager.
drop policy if exists "fss_select" on public.family_status_shares;
drop policy if exists "fss_insert" on public.family_status_shares;
drop policy if exists "fss_delete" on public.family_status_shares;

create policy "fss_select" on public.family_status_shares for select
  using (
    public.has_tree_access(auth.uid(), public.status_tree(status_id))
    or public.has_tree_access(auth.uid(), tree_id)
    or public.is_admin(auth.uid())
  );
create policy "fss_insert" on public.family_status_shares for insert
  with check (public.status_can_manage(status_id, auth.uid()));
create policy "fss_delete" on public.family_status_shares for delete
  using (public.status_can_manage(status_id, auth.uid()));

-- hidden: the block-list is private to the manager (uploader/owner/admin).
drop policy if exists "fsh_select" on public.family_status_hidden;
drop policy if exists "fsh_insert" on public.family_status_hidden;
drop policy if exists "fsh_delete" on public.family_status_hidden;

create policy "fsh_select" on public.family_status_hidden for select
  using (public.status_can_manage(status_id, auth.uid()));
create policy "fsh_insert" on public.family_status_hidden for insert
  with check (public.status_can_manage(status_id, auth.uid()));
create policy "fsh_delete" on public.family_status_hidden for delete
  using (public.status_can_manage(status_id, auth.uid()));

do $$
begin
  raise notice '032 applied: status shares + hidden tables, rewritten SELECT, new UPDATE policy.';
end$$;
