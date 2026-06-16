-- ============================================================
-- Migration 026: feedback reports must always go through
-- ------------------------------------------------------------
-- Why this exists
--   The help "?" → "report a bug / ask a question" form was failing
--   for some users with a red "no edit access" toast. Root cause:
--   the 012 insert policy `fb_insert_self` required
--   `author_id = auth.uid()`. When the client's profile id did not
--   equal the auth uid (e.g. duplicate-account leftovers, or an
--   anonymous author_id), the INSERT was RLS-blocked and the client
--   surfaced it as a permission error.
--
--   `author_id` on feedback is denormalised DISPLAY data (who filed
--   it), not a security boundary — only admins can ever read the
--   table (fb_select_admin). So gating the insert on author_id buys
--   nothing and only breaks legitimate reports. The owner wants the
--   report form — especially "?" questions — open to everyone, always.
--
-- Change
--   Relax the insert check to "any authenticated user". SELECT/UPDATE/
--   DELETE stay admin-only (unchanged).
--
-- Safety
--   Idempotent: drop-then-create the single policy. Additive; no data
--   touched.
-- ============================================================

drop policy if exists "fb_insert_self" on public.feedback;

create policy "fb_insert_self" on public.feedback for insert
  with check (auth.role() = 'authenticated');
