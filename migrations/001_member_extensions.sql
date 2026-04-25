-- ============================================================
-- Migration 001: Extend members with gender, birth_order, lineage
-- Idempotent — safe to re-run.
-- Run via Supabase SQL Editor or scripts/run-migration.ts.
-- ============================================================

-- gender: optional ('male' | 'female')
alter table public.members
  add column if not exists gender text
  check (gender is null or gender in ('male', 'female'));

-- birth_order: 1-based position among siblings (sorted ascending in the
-- tree layout when present). Optional.
alter table public.members
  add column if not exists birth_order integer
  check (birth_order is null or birth_order >= 1);

-- lineage: Jewish priestly lineage tag. NULL means "not set" (and the
-- Adler auto-rule may infer 'kohen' at render time without persisting).
alter table public.members
  add column if not exists lineage text
  check (lineage is null or lineage in ('kohen', 'levi', 'israel'));

-- Helpful indexes for sibling sorting.
create index if not exists members_birth_order_idx
  on public.members (birth_order);
