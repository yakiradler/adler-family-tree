-- ============================================================
-- Migration 027: bilingual member names (Hebrew + English)
-- ------------------------------------------------------------
-- Why this exists
--   Families with relatives abroad want each person's name in both
--   Hebrew and English. The UI shows the name matching the active
--   language (falling back to whichever exists). This adds the two
--   optional English-name columns; the existing first_name/last_name
--   remain the primary (Hebrew) name.
--
-- Access
--   No RLS change — the columns live on `members` and are covered by
--   the existing member read/write policies (has_tree_write etc.).
--
-- Safety
--   Idempotent + additive: `add column if not exists`, nullable, no
--   backfill, no data touched.
-- ============================================================

alter table public.members
  add column if not exists first_name_en text,
  add column if not exists last_name_en  text;
