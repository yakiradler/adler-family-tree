import type { PlanId, UserPlan } from '../types'

/**
 * Subscription plans + the "עלים" (leaves) token bank — Phase A.
 *
 * No payment processing yet (owner decision): prices are DISPLAYED,
 * the 14-day family trial is self-service, and paid upgrades are
 * applied manually by the admin from the users tab. A real payment
 * provider plugs in later without changing this model.
 *
 * Leaves are spent on actions that cost us money or exceed the free
 * tier (owner decision): AI actions, and — on the free plan — each
 * member beyond the cap. Plan limits and leaf costs live HERE and in
 * the get_my_plan()/spend_leaves() SQL functions (migration 013);
 * keep both in sync when tuning.
 */
export interface PlanDef {
  id: PlanId
  priceMonthlyILS: number
  /** null = unlimited */
  maxTrees: number | null
  /** Total members across the user's trees. null = unlimited. */
  maxMembers: number | null
  /** Leaves granted every 30 days. */
  monthlyLeaves: number
}

export const PLANS: Record<PlanId, PlanDef> = {
  free:    { id: 'free',    priceMonthlyILS: 0,     maxTrees: 1,    maxMembers: 30,   monthlyLeaves: 0 },
  family:  { id: 'family',  priceMonthlyILS: 19.90, maxTrees: null, maxMembers: 250,  monthlyLeaves: 100 },
  premium: { id: 'premium', priceMonthlyILS: 39.90, maxTrees: null, maxMembers: null, monthlyLeaves: 300 },
}

/** One-time gift credited when the plan row is first created. */
export const SIGNUP_GIFT_LEAVES = 20
export const TRIAL_DAYS = 14

export const LEAF_COSTS = {
  /** Free plan only: each member beyond the cap. */
  extraMember: 1,
  aiScan: 5,
  aiTreeFromText: 10,
} as const

/** The plan that's actually in force — an expired trial behaves as free. */
export function effectivePlan(plan: UserPlan | null): PlanDef {
  if (!plan) return PLANS.free
  if (
    plan.trial_ends_at &&
    plan.plan === 'family' &&
    new Date(plan.trial_ends_at).getTime() < Date.now()
  ) {
    return PLANS.free
  }
  return PLANS[plan.plan] ?? PLANS.free
}

export type MemberGate =
  | { allowed: true; leafCost: 0 }
  | { allowed: true; leafCost: number }
  | { allowed: false; reason: 'no-leaves' }

/**
 * May this account add one more member? Pure so it's unit-testable.
 * Over-cap on the free plan costs a leaf per member; paid plans hard-cap
 * (the cap is generous enough that hitting it means upgrading anyway).
 */
export function gateAddMember(plan: UserPlan | null, currentMembers: number): MemberGate {
  const def = effectivePlan(plan)
  if (def.maxMembers == null || currentMembers < def.maxMembers) {
    return { allowed: true, leafCost: 0 }
  }
  if (def.id === 'free' && (plan?.leaves ?? 0) >= LEAF_COSTS.extraMember) {
    return { allowed: true, leafCost: LEAF_COSTS.extraMember }
  }
  return { allowed: false, reason: 'no-leaves' }
}

/** May this account create one more tree? */
export function gateAddTree(plan: UserPlan | null, currentTrees: number): boolean {
  const def = effectivePlan(plan)
  return def.maxTrees == null || currentTrees < def.maxTrees
}

/** Days left in an active trial, or null when no active trial. */
export function trialDaysLeft(plan: UserPlan | null): number | null {
  if (!plan?.trial_ends_at || plan.plan !== 'family') return null
  const ms = new Date(plan.trial_ends_at).getTime() - Date.now()
  if (ms <= 0) return null
  return Math.ceil(ms / 86_400_000)
}
