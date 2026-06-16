-- ============================================================
-- Migration 030: media (photos + videos) on family statuses
-- ------------------------------------------------------------
-- Why this exists
--   The family-network feed should look like an Instagram feed —
--   statuses can carry photos and short videos. We store an array of
--   { url, type } objects; the files live in the existing public
--   `member-photos` Storage bucket (tree-id-anchored path), so no new
--   bucket / Storage RLS is needed.
--
-- Safety
--   Idempotent + additive: nullable jsonb with a '[]' default.
-- ============================================================

alter table public.family_statuses
  add column if not exists media jsonb not null default '[]'::jsonb;
