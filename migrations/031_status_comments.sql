-- ============================================================
-- Migration 031: comments on family-feed statuses
-- ------------------------------------------------------------
-- Why this exists
--   The family feed (family_statuses, migration 029/030) had no way to
--   reply. This adds flat comments per status — the social layer the
--   owner asked for ("be able to comment on posts, photos and statuses").
--
-- Model
--   One row per comment, scoped to a status (and therefore to that
--   status's tree). author_name is denormalised (same rationale as
--   member_notes / family_statuses) so the thread stays readable after a
--   rename. Flat, not threaded — mirrors member_notes.
--
-- Access (mirrors family_statuses 029 + member_notes 023)
--   * SELECT: anyone with access to the parent status's tree.
--   * INSERT: an authenticated tree member commenting as themselves.
--   * DELETE: the comment author, the tree owner (moderation), or admin.
--
-- Safety
--   Idempotent: if-not-exists table + helper + drop-then-create policies.
--   Depends on has_tree_access (008), is_tree_owner (020), is_admin (005).
-- ============================================================

set check_function_bodies = off;

-- Resolve a status's tree (analogous to public.member_tree in 021). Used
-- by the comment policies so they don't have to re-join family_statuses
-- inline everywhere.
create or replace function public.status_tree(s_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select tree_id from public.family_statuses where id = s_id;
$$;

create table if not exists public.family_status_comments (
  id          uuid primary key default gen_random_uuid(),
  status_id   uuid not null references public.family_statuses(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.family_status_comments enable row level security;

drop policy if exists "fsc_select_scoped" on public.family_status_comments;
drop policy if exists "fsc_insert_self"   on public.family_status_comments;
drop policy if exists "fsc_delete_owner"  on public.family_status_comments;

create policy "fsc_select_scoped" on public.family_status_comments for select
  using (public.has_tree_access(auth.uid(), public.status_tree(status_id)));

create policy "fsc_insert_self" on public.family_status_comments for insert
  with check (
    auth.role() = 'authenticated'
    and author_id = auth.uid()
    and public.has_tree_access(auth.uid(), public.status_tree(status_id))
  );

create policy "fsc_delete_owner" on public.family_status_comments for delete
  using (
    author_id = auth.uid()
    or public.is_tree_owner(auth.uid(), public.status_tree(status_id))
    or public.is_admin(auth.uid())
  );

create index if not exists family_status_comments_status_idx
  on public.family_status_comments(status_id, created_at);

do $$
begin
  raise notice '031 applied: family_status_comments ready (tree-scoped via status_tree).';
end$$;
