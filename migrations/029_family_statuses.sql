-- ============================================================
-- Migration 029: family statuses (the "family network" feed)
-- ------------------------------------------------------------
-- Why this exists
--   The new bottom-nav "family network" tab shows a feed of family
--   updates. Members can post a short status to their tree; everyone
--   with access to that tree sees it. (Auto activity — new members,
--   upcoming birthdays — is derived client-side and needs no table.)
--
-- Model
--   One row per status, scoped to a tree. author_name is denormalised
--   (same rationale as member_notes/feedback) so the feed stays
--   readable after a rename.
--
-- Access (mirrors member_notes / reactions tree-scoping)
--   * SELECT: anyone with access to the tree.
--   * INSERT: an authenticated tree member posting as themselves.
--   * DELETE: the author, the tree owner (moderation), or an admin.
--
-- Safety
--   Idempotent: if-not-exists table + drop-then-create policies.
-- ============================================================

create table if not exists public.family_statuses (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.family_trees(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.family_statuses enable row level security;

drop policy if exists "fs_select_scoped" on public.family_statuses;
drop policy if exists "fs_insert_self"   on public.family_statuses;
drop policy if exists "fs_delete_owner"  on public.family_statuses;

create policy "fs_select_scoped" on public.family_statuses for select
  using (public.has_tree_access(auth.uid(), tree_id));

create policy "fs_insert_self" on public.family_statuses for insert
  with check (
    auth.role() = 'authenticated'
    and author_id = auth.uid()
    and public.has_tree_access(auth.uid(), tree_id)
  );

create policy "fs_delete_owner" on public.family_statuses for delete
  using (
    author_id = auth.uid()
    or public.is_tree_owner(auth.uid(), tree_id)
    or public.is_admin(auth.uid())
  );

create index if not exists family_statuses_tree_idx
  on public.family_statuses(tree_id, created_at desc);
