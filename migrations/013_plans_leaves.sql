-- ============================================================
-- Migration 013: subscription plans + "leaves" token bank (Phase A)
-- ------------------------------------------------------------
-- Why this exists
--   The owner is preparing a subscription funnel: free / family /
--   premium tiers with an action-token bank ("leaves" — עלים).
--   Phase A ships WITHOUT payment processing: prices are shown in
--   the app, the 14-day family trial is self-service, paid upgrades
--   are applied manually by the admin.
--
-- Model
--   * user_plans        — one row per user: tier, trial deadline,
--                         leaf balance, last monthly renewal.
--   * leaf_transactions — append-only audit of every grant/spend.
--
-- Access design
--   Users must NOT be able to update their own row directly (they
--   could self-grant premium or leaves). All self-service mutations
--   go through SECURITY DEFINER functions with the rules inlined:
--     get_my_plan()       — upsert default row (20-leaf gift),
--                           lazy trial-expiry downgrade, lazy
--                           monthly leaf renewal. Returns the row.
--     spend_leaves(n, why)— atomic decrement, refuses overdraft.
--     start_family_trial()— once per account, free → family for 14d.
--   Admins read/update everything directly (RLS).
--
--   NOTE: plan limits + leaf amounts are duplicated in
--   src/lib/plans.ts — keep in sync when tuning.
-- ============================================================

create table if not exists public.user_plans (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  plan              text not null default 'free' check (plan in ('free', 'family', 'premium')),
  trial_ends_at     timestamptz,
  trial_used        boolean not null default false,
  leaves            integer not null default 0 check (leaves >= 0),
  leaves_renewed_at timestamptz,
  updated_at        timestamptz not null default now()
);

create table if not exists public.leaf_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  created_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;
alter table public.leaf_transactions enable row level security;

drop policy if exists "up_select_own"   on public.user_plans;
drop policy if exists "up_select_admin" on public.user_plans;
drop policy if exists "up_update_admin" on public.user_plans;
drop policy if exists "up_insert_admin" on public.user_plans;
create policy "up_select_own"   on public.user_plans for select using (user_id = auth.uid());
create policy "up_select_admin" on public.user_plans for select using (public.is_admin(auth.uid()));
create policy "up_update_admin" on public.user_plans for update using (public.is_admin(auth.uid()));
create policy "up_insert_admin" on public.user_plans for insert with check (public.is_admin(auth.uid()));

drop policy if exists "lt_select_own"   on public.leaf_transactions;
drop policy if exists "lt_select_admin" on public.leaf_transactions;
drop policy if exists "lt_insert_admin" on public.leaf_transactions;
create policy "lt_select_own"   on public.leaf_transactions for select using (user_id = auth.uid());
create policy "lt_select_admin" on public.leaf_transactions for select using (public.is_admin(auth.uid()));
create policy "lt_insert_admin" on public.leaf_transactions for insert with check (public.is_admin(auth.uid()));

-- ─── Self-service functions (SECURITY DEFINER) ─────────────────

-- Ensure + normalise + return the caller's plan row.
create or replace function public.get_my_plan()
returns public.user_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  row_ public.user_plans;
  monthly int;
begin
  -- First touch: create the row with the 20-leaf signup gift.
  insert into public.user_plans (user_id, plan, leaves)
  values (auth.uid(), 'free', 20)
  on conflict (user_id) do nothing;
  if found then
    insert into public.leaf_transactions (user_id, amount, reason)
    values (auth.uid(), 20, 'signup-gift');
  end if;

  select * into row_ from public.user_plans where user_id = auth.uid();

  -- Lazy trial expiry: family-by-trial falls back to free.
  if row_.plan = 'family' and row_.trial_ends_at is not null
     and row_.trial_ends_at < now() then
    update public.user_plans
       set plan = 'free', trial_ends_at = null, updated_at = now()
     where user_id = auth.uid()
     returning * into row_;
  end if;

  -- Lazy monthly leaf renewal for paid tiers (every 30 days).
  monthly := case row_.plan when 'family' then 100 when 'premium' then 300 else 0 end;
  if monthly > 0 and (row_.leaves_renewed_at is null
                      or row_.leaves_renewed_at < now() - interval '30 days') then
    update public.user_plans
       set leaves = leaves + monthly, leaves_renewed_at = now(), updated_at = now()
     where user_id = auth.uid()
     returning * into row_;
    insert into public.leaf_transactions (user_id, amount, reason)
    values (auth.uid(), monthly, 'monthly-renewal');
  end if;

  return row_;
end;
$$;

-- Atomic spend; returns the new balance, or -1 when insufficient.
create or replace function public.spend_leaves(cost int, why text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if cost <= 0 then
    raise exception 'cost must be positive';
  end if;
  update public.user_plans
     set leaves = leaves - cost, updated_at = now()
   where user_id = auth.uid() and leaves >= cost
   returning leaves into new_balance;
  if new_balance is null then
    return -1;
  end if;
  insert into public.leaf_transactions (user_id, amount, reason)
  values (auth.uid(), -cost, why);
  return new_balance;
end;
$$;

-- One free 14-day family trial per account, no card required.
create or replace function public.start_family_trial()
returns public.user_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  row_ public.user_plans;
begin
  update public.user_plans
     set plan = 'family',
         trial_ends_at = now() + interval '14 days',
         trial_used = true,
         updated_at = now()
   where user_id = auth.uid() and plan = 'free' and trial_used = false
   returning * into row_;
  if row_ is null then
    raise exception 'trial-unavailable';
  end if;
  return row_;
end;
$$;

grant execute on function public.get_my_plan() to authenticated;
grant execute on function public.spend_leaves(int, text) to authenticated;
grant execute on function public.start_family_trial() to authenticated;

create index if not exists lt_user_idx on public.leaf_transactions(user_id);
