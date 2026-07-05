-- ============================================================
-- Migration 035: member origin flags (birth country + heritage)
-- ------------------------------------------------------------
-- Why this exists
--   Each member card can carry two optional "origin" markers, shown
--   as flags in the member profile panel (owner decision: panel only,
--   not on the tree cards):
--     birth_country_code — ISO-3166-1 alpha-2 of the birth country,
--                          uppercase ('IL', 'US', 'FR', ...).
--     heritage_code      — EITHER a second ISO country code
--                          (nationality/heritage, e.g. an Israeli
--                          living abroad) OR a symbol token from a
--                          small client-side map ('jewish' → Star of
--                          David). Free text by design so new tokens
--                          don't need a migration; the client
--                          validates and unknown values render
--                          nothing.
--
-- Access
--   No RLS change — the columns live on `members` and are covered by
--   the existing member read/write policies (has_tree_write etc.).
--
-- Safety
--   Idempotent + additive: `add column if not exists`, nullable, no
--   backfill, no data touched. No CHECK constraint on purpose (see
--   heritage_code note above).
-- ============================================================

alter table public.members
  add column if not exists birth_country_code text,
  add column if not exists heritage_code      text;
