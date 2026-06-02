import { describe, it, expect } from 'vitest'
import { buildParentMap, resolveLineage, displayLastName } from '../lib/lineage'
import type { Member, Relationship } from '../types'

// Halacha rules baked into resolveLineage (per src/lib/lineage.ts):
//
//   • Kohen / Levi propagates through the MALE line ONLY.
//   • A daughter of a Kohen → daughterOf='kohen' but no badge.
//   • Explicit `member.lineage` for males wins over auto-rules.
//   • The Adler-surname auto-rule fires only when the FATHER is also
//     an Adler (we don't auto-tag "ben bat-kohen" as Kohen).
//
// These tests pin those rules — if anyone changes the resolver and
// accidentally breaks one of them, CI fails before the breakage
// reaches the family in production.

function m(id: string, props: Partial<Member> = {}): Member {
  return {
    id,
    first_name: id,
    last_name: 'Test',
    gender: 'male',
    created_by: 'test',
    ...props,
  }
}

function parentRel(parentId: string, childId: string): Relationship {
  return {
    id: `${parentId}-${childId}`,
    type: 'parent-child',
    member_a_id: parentId,
    member_b_id: childId,
  }
}

describe('buildParentMap', () => {
  it('groups parents under each child', () => {
    const dad = m('dad', { gender: 'male' })
    const mom = m('mom', { gender: 'female' })
    const kid = m('kid')
    const map = buildParentMap(
      [dad, mom, kid],
      [parentRel('dad', 'kid'), parentRel('mom', 'kid')],
    )
    expect(map.get('kid')).toEqual([dad, mom])
  })

  it('ignores non parent-child relationships', () => {
    const a = m('a'), b = m('b')
    const map = buildParentMap(
      [a, b],
      [{ id: 'sp', type: 'spouse', member_a_id: 'a', member_b_id: 'b' }],
    )
    expect(map.size).toBe(0)
  })
})

describe('resolveLineage — males', () => {
  it('inherits Kohen from the father', () => {
    const dad = m('dad', { gender: 'male', lineage: 'kohen' })
    const son = m('son', { gender: 'male' })
    const map = buildParentMap([dad, son], [parentRel('dad', 'son')])
    const info = resolveLineage(son, map)
    expect(info.lineage).toBe('kohen')
    expect(info.showBadge).toBe(true)
  })

  it('does NOT inherit Kohen from the mother (male-line only)', () => {
    const mom = m('mom', { gender: 'female', lineage: 'kohen' })
    const son = m('son', { gender: 'male' })
    const map = buildParentMap([mom, son], [parentRel('mom', 'son')])
    const info = resolveLineage(son, map)
    expect(info.lineage).toBeNull()
    expect(info.showBadge).toBe(false)
  })

  it('explicit lineage wins over inheritance', () => {
    const dad = m('dad', { gender: 'male', lineage: 'kohen' })
    const son = m('son', { gender: 'male', lineage: 'israel' })
    const map = buildParentMap([dad, son], [parentRel('dad', 'son')])
    const info = resolveLineage(son, map)
    expect(info.lineage).toBe('israel')
    expect(info.showBadge).toBe(false)
  })
})

describe('resolveLineage — females', () => {
  it('daughter of Kohen → daughterOf, no badge', () => {
    const dad = m('dad', { gender: 'male', lineage: 'kohen' })
    const daughter = m('daughter', { gender: 'female' })
    const map = buildParentMap([dad, daughter], [parentRel('dad', 'daughter')])
    const info = resolveLineage(daughter, map)
    expect(info.lineage).toBeNull()
    expect(info.daughterOf).toBe('kohen')
    expect(info.showBadge).toBe(false)
  })

  it('female with explicit Kohen → treated as daughterOf', () => {
    const f = m('f', { gender: 'female', lineage: 'kohen' })
    const map = new Map()
    const info = resolveLineage(f, map)
    expect(info.lineage).toBeNull()
    expect(info.daughterOf).toBe('kohen')
    expect(info.showBadge).toBe(false)
  })
})

describe('resolveLineage — Adler surname auto-rule', () => {
  it('auto-tags Adler son of Adler father as Kohen', () => {
    const dad = m('dad', { gender: 'male', last_name: 'אדלר' })
    const son = m('son', { gender: 'male', last_name: 'אדלר' })
    const map = buildParentMap([dad, son], [parentRel('dad', 'son')])
    const info = resolveLineage(son, map)
    expect(info.lineage).toBe('kohen')
    expect(info.byAdlerRule).toBe(true)
  })

  it('does NOT auto-tag Adler-named son of non-Adler father', () => {
    const dad = m('dad', { gender: 'male', last_name: 'כהן' })
    const son = m('son', { gender: 'male', last_name: 'אדלר' })
    const map = buildParentMap([dad, son], [parentRel('dad', 'son')])
    const info = resolveLineage(son, map)
    // The son doesn't carry his father's lineage (no kohen on dad)
    // AND doesn't auto-Adler since dad isn't Adler.
    expect(info.byAdlerRule).toBe(false)
    expect(info.lineage).toBeNull()
  })

  it('handles English "adler" spelling case-insensitively', () => {
    const dad = m('dad', { gender: 'male', last_name: 'Adler' })
    const son = m('son', { gender: 'male', last_name: 'ADLER' })
    const map = buildParentMap([dad, son], [parentRel('dad', 'son')])
    const info = resolveLineage(son, map)
    expect(info.byAdlerRule).toBe(true)
  })
})

describe('displayLastName', () => {
  it('appends Kahane suffix for Adler-rule Kohens', () => {
    const member = m('x', { last_name: 'אדלר', gender: 'male' })
    const info = { lineage: 'kohen', byAdlerRule: true, showBadge: true, daughterOf: null } as const
    expect(displayLastName(member, info, 'he')).toContain('כהנא')
    expect(displayLastName(member, info, 'en')).toContain('Kahane')
  })

  it('returns the bare last_name for non-Adler-rule members', () => {
    const member = m('x', { last_name: 'לוי', gender: 'male' })
    const info = { lineage: null, byAdlerRule: false, showBadge: false, daughterOf: null }
    expect(displayLastName(member, info, 'he')).toBe('לוי')
  })
})
