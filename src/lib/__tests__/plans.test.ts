import { describe, it, expect } from 'vitest'
import { PLANS, effectivePlan, gateAddMember, gateAddTree, trialDaysLeft } from '../plans'
import type { UserPlan } from '../../types'

// Pure-rule tests for the subscription Phase A gates. The SQL side
// (migration 013) re-implements the same numbers; these tests pin the
// client behaviour the UI depends on.

function plan(over: Partial<UserPlan> = {}): UserPlan {
  return { user_id: 'u1', plan: 'free', leaves: 0, trial_ends_at: null, ...over }
}

const DAY = 86_400_000

describe('effectivePlan', () => {
  it('null plan behaves as free', () => {
    expect(effectivePlan(null).id).toBe('free')
  })

  it('active family trial counts as family', () => {
    const p = plan({ plan: 'family', trial_ends_at: new Date(Date.now() + 3 * DAY).toISOString() })
    expect(effectivePlan(p).id).toBe('family')
  })

  it('expired family trial falls back to free', () => {
    const p = plan({ plan: 'family', trial_ends_at: new Date(Date.now() - DAY).toISOString() })
    expect(effectivePlan(p).id).toBe('free')
  })

  it('paid family (no trial deadline) stays family', () => {
    expect(effectivePlan(plan({ plan: 'family' })).id).toBe('family')
  })
})

describe('gateAddMember', () => {
  it('free under the cap → allowed at no cost', () => {
    const g = gateAddMember(plan(), PLANS.free.maxMembers! - 1)
    expect(g).toEqual({ allowed: true, leafCost: 0 })
  })

  it('free at the cap with leaves → allowed for one leaf', () => {
    const g = gateAddMember(plan({ leaves: 5 }), PLANS.free.maxMembers!)
    expect(g).toEqual({ allowed: true, leafCost: 1 })
  })

  it('free at the cap without leaves → blocked', () => {
    const g = gateAddMember(plan({ leaves: 0 }), PLANS.free.maxMembers!)
    expect(g.allowed).toBe(false)
  })

  it('premium is unlimited', () => {
    const g = gateAddMember(plan({ plan: 'premium' }), 10_000)
    expect(g.allowed).toBe(true)
  })

  it('family hard-caps at its limit without leaf override', () => {
    const g = gateAddMember(plan({ plan: 'family', leaves: 999 }), PLANS.family.maxMembers!)
    expect(g.allowed).toBe(false)
  })
})

describe('gateAddTree', () => {
  it('free allows the first tree only', () => {
    expect(gateAddTree(plan(), 0)).toBe(true)
    expect(gateAddTree(plan(), 1)).toBe(false)
  })

  it('family/premium are unlimited', () => {
    expect(gateAddTree(plan({ plan: 'family' }), 50)).toBe(true)
  })
})

describe('trialDaysLeft', () => {
  it('null without an active trial', () => {
    expect(trialDaysLeft(null)).toBeNull()
    expect(trialDaysLeft(plan())).toBeNull()
    expect(trialDaysLeft(plan({ plan: 'family' }))).toBeNull()
  })

  it('counts remaining days, rounding up', () => {
    const p = plan({ plan: 'family', trial_ends_at: new Date(Date.now() + 2.5 * DAY).toISOString() })
    expect(trialDaysLeft(p)).toBe(3)
  })

  it('expired trial → null', () => {
    const p = plan({ plan: 'family', trial_ends_at: new Date(Date.now() - DAY).toISOString() })
    expect(trialDaysLeft(p)).toBeNull()
  })
})
