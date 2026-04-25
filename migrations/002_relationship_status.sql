-- ============================================================
-- Migration 002: Spouse status (current / ex / deceased)
-- Adds an optional `status` column to relationships, primarily
-- meaningful for `type='spouse'`. Existing rows default to 'current'.
-- Idempotent.
-- ============================================================

alter table public.relationships
  add column if not exists status text
  check (status is null or status in ('current', 'ex', 'deceased'));

-- Backfill existing spouse rows to 'current' so the layout treats them
-- exactly as before (NULL would also work, but explicit is clearer).
update public.relationships
   set status = 'current'
 where type = 'spouse' and status is null;

create index if not exists relationships_status_idx
  on public.relationships (status);
