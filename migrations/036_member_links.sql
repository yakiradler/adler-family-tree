-- ============================================================
-- Migration 036: member_links — the same person across trees
-- ------------------------------------------------------------
-- Why this exists
--   A person often exists in more than one family tree (e.g. Noa is
--   "wife" in the Adler tree and "daughter" in the Saadon tree). Each
--   tree keeps its own member row; this table records "these two rows
--   are the same human", powering a jump button between the profiles.
--   No data is synced between linked rows (v1 is link + jump only).
--
-- Model
--   Pair rows with a canonical order (member_a_id < member_b_id) and a
--   uniqueness constraint, so the same pair can't be linked twice and
--   lookups don't need to check both orders. Groups of 3+ trees emerge
--   as multiple pair rows; the client resolves what it can see.
--
-- Access (reuses SECURITY DEFINER helpers member_tree /
--   has_tree_access / has_tree_write from migrations 008/020/021;
--   is_admin is honored inside those helpers):
--     SELECT — anyone with access to EITHER side's tree. The link row
--       leaks only an opaque member id; the other member's data stays
--       protected by the members policies. This deliberately lets a
--       viewer who lost access to the other tree still see "linked to
--       a person in another tree" instead of silently re-duplicating.
--     INSERT — must be able to SEE both trees and WRITE at least one,
--       and must stamp themselves as created_by.
--     DELETE — write access on either side's tree.
--     UPDATE — nobody (links are created and deleted, never edited).
--
-- Safety
--   Idempotent + additive: create table/index if not exists, policies
--   dropped+recreated. on delete cascade — deleting a member removes
--   its links. No existing data touched.
-- ============================================================

create table if not exists public.member_links (
  id          uuid primary key default gen_random_uuid(),
  member_a_id uuid not null references public.members(id) on delete cascade,
  member_b_id uuid not null references public.members(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint member_links_ordered  check (member_a_id < member_b_id),
  constraint member_links_distinct check (member_a_id <> member_b_id),
  constraint member_links_unique   unique (member_a_id, member_b_id)
);

create index if not exists idx_member_links_a on public.member_links(member_a_id);
create index if not exists idx_member_links_b on public.member_links(member_b_id);

alter table public.member_links enable row level security;

drop policy if exists ml_select on public.member_links;
create policy ml_select on public.member_links for select using (
  public.has_tree_access(auth.uid(), public.member_tree(member_a_id))
  or public.has_tree_access(auth.uid(), public.member_tree(member_b_id))
);

drop policy if exists ml_insert on public.member_links;
create policy ml_insert on public.member_links for insert with check (
  created_by = auth.uid()
  and public.has_tree_access(auth.uid(), public.member_tree(member_a_id))
  and public.has_tree_access(auth.uid(), public.member_tree(member_b_id))
  and (
    public.has_tree_write(auth.uid(), public.member_tree(member_a_id))
    or public.has_tree_write(auth.uid(), public.member_tree(member_b_id))
  )
);

drop policy if exists ml_delete on public.member_links;
create policy ml_delete on public.member_links for delete using (
  public.has_tree_write(auth.uid(), public.member_tree(member_a_id))
  or public.has_tree_write(auth.uid(), public.member_tree(member_b_id))
);
