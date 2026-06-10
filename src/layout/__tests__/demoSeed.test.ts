import { describe, it, expect } from 'vitest'
import { computeLayout, validateLayout } from '../index'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS } from '../../data/adlerFamily'

/**
 * The demo seed doubles as the pilot dataset AND as a layout fixture:
 * 10 generations, sibling branches, a divorce with a shared child, and
 * an in-law (menorah) satellite. If the engine ever regresses on any of
 * those shapes, this is the first place it shows up — and it also
 * guards the seed itself against accidental edits that would break the
 * live demo tree (scripts/seed-demo-tree.ts pushes this exact data).
 */
describe('demo seed — 10-generation pilot dataset', () => {
  const result = computeLayout({
    members: ADLER_MEMBERS,
    relationships: ADLER_RELATIONSHIPS,
  })

  it('lays out with zero data issues and zero invariant violations', () => {
    expect(result.issues).toEqual([])
    expect(validateLayout(result).map((v) => `${v.rule}: ${v.message}`)).toEqual([])
  })

  it('spans 10 generation rows from the 1742 patriarch to the 2016 child', () => {
    const ids = new Set(result.nodes.map((n) => n.member.id))
    expect(ids.has('g0m')).toBe(true) // oldest ancestor placed
    expect(ids.has('g9c3')).toBe(true) // youngest descendant placed
    const distinctRows = new Set(result.nodes.map((n) => n.y)).size
    expect(distinctRows).toBeGreaterThanOrEqual(10)
  })

  it('contains the feature coverage the pilot needs', () => {
    // At least one divorce…
    expect(
      ADLER_RELATIONSHIPS.some((r) => r.type === 'spouse' && r.status === 'ex'),
    ).toBe(true)
    // …several deceased members…
    expect(ADLER_MEMBERS.filter((m) => m.death_date).length).toBeGreaterThanOrEqual(5)
    // …and illustrated avatars on most members.
    expect(
      ADLER_MEMBERS.filter((m) => m.photo_url?.startsWith('https://')).length,
    ).toBeGreaterThanOrEqual(20)
  })
})
