-- ============================================================
-- Migration 034: track who joined via each invite code
-- ------------------------------------------------------------
-- Why this exists
--   tree_invites had no record of WHO redeemed a code — redeem_invite
--   granted tree_access but stored no link back to the invite. The owner
--   wants, per code: how many joined + who. Designed to stay cheap at
--   thousands of codes:
--     * invite_redemptions = the log (source of truth + the "who"), read
--       lazily per code when expanded.
--     * tree_invites.redeem_count = a denormalised counter so the count
--       shows with the code itself, zero aggregation on render.
--
-- Note: historical joins (before this migration) were never linked to a
--   code, so they can't be attributed retroactively — counts/lists start
--   from now.
--
-- Safety
--   Additive + idempotent. redeem_invite keeps its exact existing logic
--   (editor grant, expiry/uses guards) — only the logging is added, and
--   the counter increments only when a NEW redemption row is inserted.
--   Depends on: tree_invites (003), is_admin (005), is_tree_owner (020).
-- ============================================================

set check_function_bodies = off;

-- ─── 1. Redemption log + denormalised counter ────────────────
create table if not exists public.invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.tree_invites(id) on delete cascade,
  tree_id     uuid references public.family_trees(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_id, user_id)
);
create index if not exists invite_redemptions_invite_idx
  on public.invite_redemptions(invite_id, redeemed_at);

alter table public.tree_invites
  add column if not exists redeem_count int not null default 0;

-- ─── 2. Helper: who created an invite (security definer) ──────
create or replace function public.invite_creator(i_id uuid)
returns uuid language sql security definer stable as $$
  select created_by from public.tree_invites where id = i_id;
$$;

-- ─── 3. RLS: only the code's creator / tree owner / admin read ─
alter table public.invite_redemptions enable row level security;
drop policy if exists "ir_select" on public.invite_redemptions;
create policy "ir_select" on public.invite_redemptions for select
  using (
    public.is_admin(auth.uid())
    or public.invite_creator(invite_id) = auth.uid()
    or public.is_tree_owner(auth.uid(), tree_id)
  );
-- No INSERT/UPDATE/DELETE policies: rows are written only inside
-- redeem_invite (security definer → bypasses RLS).

-- ─── 4. redeem_invite: keep existing logic, ADD logging ──────
create or replace function public.redeem_invite(p_code text)
returns table (redeemed_tree_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.tree_invites%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'redeem_invite: not authenticated';
  end if;

  select * into v_invite
    from public.tree_invites
   where code = btrim(p_code)
   limit 1;

  if v_invite.id is null then return; end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then return; end if;
  if v_invite.uses_left is not null and v_invite.uses_left <= 0 then return; end if;

  if v_invite.uses_left is not null then
    update public.tree_invites
       set uses_left = greatest(0, v_invite.uses_left - 1)
     where id = v_invite.id;
  end if;

  if v_invite.tree_id is not null then
    insert into public.tree_access (user_id, tree_id, role, granted_by)
    values (v_uid, v_invite.tree_id, 'editor', v_invite.created_by)
    on conflict (user_id, tree_id) do nothing;

    -- Log the redemption (idempotent per user+code) and bump the counter
    -- only when a genuinely new row was recorded.
    insert into public.invite_redemptions (invite_id, tree_id, user_id)
    values (v_invite.id, v_invite.tree_id, v_uid)
    on conflict (invite_id, user_id) do nothing;
    if found then
      update public.tree_invites
         set redeem_count = redeem_count + 1
       where id = v_invite.id;
    end if;
  end if;

  redeemed_tree_id := v_invite.tree_id;
  return next;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;

do $$
begin
  raise notice '034 applied: invite_redemptions + redeem_count; redeem_invite now logs who joined.';
end$$;
