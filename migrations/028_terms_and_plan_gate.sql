-- ============================================================
-- Migration 028: first-login flow — terms + email consent + plan ack
-- ------------------------------------------------------------
-- Why this exists
--   On first login the user must (1) accept the terms of service and
--   choose email-marketing consent (email only — never SMS), then
--   (2) pass the plans/pricing page (with the donation pledge), and
--   only then reach the home page / learning mode. These three
--   per-account flags drive the gate in App.tsx so the flow runs once
--   per account and survives reloads / new devices.
--
-- Access
--   The user updates their OWN row (same self-update path the
--   onboarding wizard already uses — completeOnboarding). No new RLS.
--
-- Safety
--   Idempotent + additive: nullable columns, no backfill. Existing
--   accounts get null → they pass through the one-time flow on their
--   next login (everyone accepts terms once).
-- ============================================================

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists plan_acked_at     timestamptz;
