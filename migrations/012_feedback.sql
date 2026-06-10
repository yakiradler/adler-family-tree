-- ============================================================
-- Migration 012: feedback table (help "?" → report to admin)
-- ------------------------------------------------------------
-- Why this exists
--   The tree page's help menu gained a "report a bug / ask the
--   admin" form. Reports need to land somewhere the admin can
--   actually see them — the new "reports" tab in the admin
--   dashboard reads from this table.
--
-- Model
--   One row per submission. `author_name` is denormalised (same
--   rationale as member_notes) so a report stays readable after
--   the author's profile is renamed or deleted. `context` stores
--   the route hash the report was sent from, to help reproduce.
--
-- Access
--   * Any authenticated user can INSERT their own report.
--   * Only admins can SELECT / UPDATE / DELETE (regular users
--     never read other people's reports; their own submission is
--     kept optimistically client-side).
--
-- Safety
--   Idempotent: `if not exists` + drop-then-create policies.
-- ============================================================

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  category    text not null check (category in ('bug', 'question')),
  body        text not null,
  context     text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists "fb_insert_self"  on public.feedback;
drop policy if exists "fb_select_admin" on public.feedback;
drop policy if exists "fb_update_admin" on public.feedback;
drop policy if exists "fb_delete_admin" on public.feedback;

create policy "fb_insert_self" on public.feedback for insert
  with check (auth.role() = 'authenticated' and author_id = auth.uid());
create policy "fb_select_admin" on public.feedback for select using (public.is_admin(auth.uid()));
create policy "fb_update_admin" on public.feedback for update using (public.is_admin(auth.uid()));
create policy "fb_delete_admin" on public.feedback for delete using (public.is_admin(auth.uid()));

create index if not exists feedback_status_idx on public.feedback(status);
