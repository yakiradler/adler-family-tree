-- ============================================================
-- Migration 015: invite-code hardening
-- ------------------------------------------------------------
-- Why this exists
--   `inv_select_auth` let ANY signed-in user `select *` from
--   tree_invites — leaking every code's metadata (which user is
--   being onboarded into which tree, expiry, uses_left). The
--   onboarding wizard only ever needs to redeem the ONE code the
--   user typed, so table-wide read access was never necessary.
--
--   It also exposed a latent bug: redeeming a capped code burns a
--   use via UPDATE, but `inv_update_admin` only lets admins UPDATE,
--   so `uses_left` never actually decremented for a regular joiner.
--
-- What this does
--   1. Replace the blanket SELECT policy with a scoped one: a user
--      may read only codes minted FOR them or BY them; admins read
--      all (InviteCodeManager + decideAccessRequest rely on that).
--      Tree OWNERS still read their own generic codes via
--      `created_by = auth.uid()` (mintShareCode reuse query).
--   2. Add `redeem_invite(p_code)` — a SECURITY DEFINER RPC that
--      validates code + expiry + uses_left, burns one use on capped
--      codes, and grants tree_access(member) — all server-side, so
--      the redeemer needs no SELECT/UPDATE rights on the table and
--      the use-burn finally works.
--
-- Safety
--   * Idempotent: drops + recreates the policy and replaces the fn.
--   * `on conflict do nothing` on the access grant so re-joining
--     never downgrades an existing owner/editor back to member.
-- ============================================================

set check_function_bodies = off;

-- ─── 1. Scope SELECT ───────────────────────────────────────────
drop policy if exists "inv_select_auth"   on public.tree_invites;
drop policy if exists "inv_select_scoped" on public.tree_invites;
create policy "inv_select_scoped" on public.tree_invites for select using (
  public.is_admin(auth.uid())
  or created_for = auth.uid()
  or created_by = auth.uid()
);

-- ─── 2. Server-side redeem ─────────────────────────────────────
-- Returns one row (redeemed_tree_id) on success, zero rows when the
-- code is missing / expired / exhausted. The caller treats an empty
-- result as "invalid code".
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

  -- Missing / expired / exhausted → return nothing.
  if v_invite.id is null then
    return;
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return;
  end if;
  if v_invite.uses_left is not null and v_invite.uses_left <= 0 then
    return;
  end if;

  -- Burn one use on capped codes (null = unlimited).
  if v_invite.uses_left is not null then
    update public.tree_invites
       set uses_left = greatest(0, v_invite.uses_left - 1)
     where id = v_invite.id;
  end if;

  -- Idempotent access grant. Skip when a row already exists so an
  -- existing owner/editor isn't silently downgraded to 'member'.
  if v_invite.tree_id is not null then
    insert into public.tree_access (user_id, tree_id, role, granted_by)
    values (v_uid, v_invite.tree_id, 'member', v_invite.created_by)
    on conflict (user_id, tree_id) do nothing;
  end if;

  redeemed_tree_id := v_invite.tree_id;
  return next;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;
