-- ============================================================
-- Migration 019: per-member contact + social links
-- ------------------------------------------------------------
-- Adds a single jsonb `contact` column to members holding the optional
-- "Contact" section shown on each profile: { phone, email, facebook,
-- instagram }. jsonb (not separate columns) so new networks can be added
-- later without another migration. No RLS change — members RLS already
-- governs who can read/write the row (migration 008/017).
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.members
  add column if not exists contact jsonb;
