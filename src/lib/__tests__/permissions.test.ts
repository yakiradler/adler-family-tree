import { describe, it, expect } from 'vitest'
import { canEditMember, computeNuclearFamilyIds } from '../permissions'
import type { Profile, Relationship } from '../../types'

// Pins the pilot fix: the nuclear-family set must be anchored to the
// LOGGED-IN user's card, and a plain user must be able to edit
// self + spouse + children (+ parents) directly — nobody else.

function profile(over: Partial<Profile> = {}): Profile {
  return { id: 'u1', full_name: 'Test User', role: 'user', ...over }
}

const rel = (
  id: string,
  type: Relationship['type'],
  a: string,
  b: string,
): Relationship => ({ id, type, member_a_id: a, member_b_id: b })

// me=m1; spouse=m2; child=m3; father=m4; sibling=m5 (via father);
// unrelated=m9.
const RELS: Relationship[] = [
  rel('r1', 'spouse', 'm1', 'm2'),
  rel('r2', 'parent-child', 'm1', 'm3'), // me → my child
  rel('r3', 'parent-child', 'm4', 'm1'), // my father → me
  rel('r4', 'parent-child', 'm4', 'm5'), // my father → my sibling
]

describe('computeNuclearFamilyIds', () => {
  it('collects spouse, children and parents of MY card', () => {
    const ids = computeNuclearFamilyIds('m1', RELS)
    expect(ids).toEqual(new Set(['m2', 'm3', 'm4']))
  })

  it('excludes siblings and unrelated members', () => {
    const ids = computeNuclearFamilyIds('m1', RELS)
    expect(ids.has('m5')).toBe(false)
    expect(ids.has('m9')).toBe(false)
  })

  it('empty without a linked member card', () => {
    expect(computeNuclearFamilyIds(null, RELS).size).toBe(0)
    expect(computeNuclearFamilyIds(undefined, RELS).size).toBe(0)
  })
})

describe('canEditMember for a plain user (pilot contract)', () => {
  const me = profile()
  const nuclear = computeNuclearFamilyIds('m1', RELS)
  const ctx = (target: string) => ({
    targetMemberId: target,
    nuclearFamilyIds: nuclear,
    ownMemberId: 'm1',
  })

  it('edits own card', () => {
    expect(canEditMember(me, ctx('m1'))).toBe(true)
  })

  it('edits spouse and children directly — no approval needed', () => {
    expect(canEditMember(me, ctx('m2'))).toBe(true)
    expect(canEditMember(me, ctx('m3'))).toBe(true)
  })

  it('cannot edit unrelated members (falls back to suggest-mode)', () => {
    expect(canEditMember(me, ctx('m9'))).toBe(false)
  })

  it('the old bug stays dead: target-anchored sets never allowed anything', () => {
    // Building the set from the TARGET's relations (the pre-fix code)
    // can never contain the target itself, so the gate was always
    // false. Guard the regression by asserting the fixed behaviour
    // differs for a spouse edit.
    const targetAnchored = computeNuclearFamilyIds('m2', RELS) // spouse's relatives
    expect(targetAnchored.has('m2')).toBe(false)
    expect(
      canEditMember(me, { targetMemberId: 'm2', nuclearFamilyIds: targetAnchored, ownMemberId: 'm1' }),
    ).toBe(false)
    expect(canEditMember(me, ctx('m2'))).toBe(true)
  })

  it('admin edits anyone; guest edits nobody', () => {
    expect(canEditMember(profile({ role: 'admin' }), ctx('m9'))).toBe(true)
    expect(canEditMember(profile({ role: 'guest' }), ctx('m1'))).toBe(false)
  })
})
