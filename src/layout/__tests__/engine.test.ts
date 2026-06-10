import { describe, it, expect } from 'vitest'
import { computeLayout, validateLayout, CARD, GAPS } from '../index'
import type { LayoutResult } from '../types'
import type { Member, Relationship } from '../../types'
import { generateFamily, shuffled } from './randomFamily'

function m(id: string, props: Partial<Member> = {}): Member {
  return { id, first_name: id, last_name: 'T', gender: 'male', created_by: 't', ...props }
}
function pc(id: string, parent: string, child: string): Relationship {
  return { id, member_a_id: parent, member_b_id: child, type: 'parent-child' }
}
function sp(id: string, a: string, b: string, status: Relationship['status'] = 'current'): Relationship {
  return { id, member_a_id: a, member_b_id: b, type: 'spouse', status }
}

function expectValid(result: LayoutResult) {
  const violations = validateLayout(result)
  expect(violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([])
}

describe('computeLayout — fundamentals', () => {
  it('returns empty result for no members', () => {
    const r = computeLayout({ members: [], relationships: [] })
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([])
    expect(r.issues).toEqual([])
  })

  it('places a single member', () => {
    const r = computeLayout({ members: [m('a')], relationships: [] })
    expect(r.nodes).toHaveLength(1)
    expectValid(r)
  })

  it('places a couple adjacent, father left', () => {
    const r = computeLayout({
      members: [m('dad', { gender: 'male' }), m('mom', { gender: 'female' })],
      relationships: [sp('r1', 'dad', 'mom')],
    })
    const dad = r.nodes.find((n) => n.member.id === 'dad')!
    const mom = r.nodes.find((n) => n.member.id === 'mom')!
    expect(dad.x).toBeLessThan(mom.x)
    expect(mom.x - dad.x).toBe(CARD.W + GAPS.COUPLE)
    expect(r.edges.filter((e) => e.kind === 'spouse')).toHaveLength(1)
    expectValid(r)
  })

  it('centres parents over children and children get one family rail', () => {
    const r = computeLayout({
      members: [
        m('dad', { gender: 'male' }),
        m('mom', { gender: 'female' }),
        m('c1', { birth_order: 1 }),
        m('c2', { birth_order: 2 }),
        m('c3', { birth_order: 3 }),
      ],
      relationships: [
        sp('r1', 'dad', 'mom'),
        pc('r2', 'dad', 'c1'),
        pc('r3', 'mom', 'c1'),
        pc('r4', 'dad', 'c2'),
        pc('r5', 'mom', 'c2'),
        pc('r6', 'dad', 'c3'),
        pc('r7', 'mom', 'c3'),
      ],
    })
    expectValid(r)
    const fam = r.edges.filter((e) => e.kind === 'family')
    expect(fam).toHaveLength(1)
    // Children sorted by birth_order, left to right.
    const xs = ['c1', 'c2', 'c3'].map((id) => r.nodes.find((n) => n.member.id === id)!.x)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
  })

  it('respects connector_parent_id for placement under a divorced parent', () => {
    // Mother and father are NOT a couple; child must anchor under father
    // because connector_parent_id says so (mother is the default).
    const r = computeLayout({
      members: [
        m('dad', { gender: 'male' }),
        m('mom', { gender: 'female' }),
        m('kid', { connector_parent_id: 'dad' }),
      ],
      relationships: [pc('r1', 'dad', 'kid'), pc('r2', 'mom', 'kid')],
    })
    expectValid(r)
    const fam = r.edges.find((e) => e.kind === 'family')!
    expect(fam.kind === 'family' && fam.parentUnitId).toBe('dad')
    // The mother link still exists — as a dashed secondary edge.
    expect(r.edges.some((e) => e.kind === 'secondary-parent' && e.parentId === 'mom')).toBe(true)
  })

  it('puts loose members in the orphans section, never far right', () => {
    const fam = generateFamily(7, { generations: 3, orphanCount: 3 })
    const r = computeLayout(fam)
    expectValid(r)
    const orphans = r.nodes.filter((n) => n.section === 'orphans')
    expect(orphans.length).toBeGreaterThanOrEqual(3)
    const treeMaxY = Math.max(...r.nodes.filter((n) => n.section === 'tree').map((n) => n.y))
    for (const o of orphans) expect(o.y).toBeGreaterThan(treeMaxY)
  })
})

describe('computeLayout — malformed data never hangs or hides members', () => {
  it('reports parent-child cycles and still renders everyone', { timeout: 2000 }, () => {
    const r = computeLayout({
      members: [m('a'), m('b'), m('c')],
      relationships: [pc('r1', 'a', 'b'), pc('r2', 'b', 'c'), pc('r3', 'c', 'a')],
    })
    expect(r.nodes).toHaveLength(3)
    expect(r.issues.some((i) => i.kind === 'cycle')).toBe(true)
    // Cycle break must not leave non-finite or overlapping geometry.
    const violations = validateLayout(r).filter((v) => v.rule !== 'V8')
    expect(violations).toEqual([])
  })

  it('self-parenting is ignored and reported', { timeout: 2000 }, () => {
    const r = computeLayout({
      members: [m('a')],
      relationships: [pc('r1', 'a', 'a')],
    })
    expect(r.nodes).toHaveLength(1)
    expect(r.issues.some((i) => i.kind === 'invalid-edge')).toBe(true)
  })

  it('more than one current spouse demotes the extras to badges', () => {
    const r = computeLayout(
      {
        members: [m('h'), m('w1', { gender: 'female' }), m('w2', { gender: 'female' })],
        relationships: [sp('r1', 'h', 'w1'), sp('r2', 'h', 'w2')],
      },
      { showFormerSpouses: true },
    )
    expect(r.issues.some((i) => i.kind === 'multiple-current-spouses')).toBe(true)
    // w2 still renders (as her own node) and as a badge under h.
    expect(r.nodes).toHaveLength(3)
    const h = r.nodes.find((n) => n.member.id === 'h')!
    expect(h.secondaryPartners?.some((p) => p.member.id === 'w2')).toBe(true)
    expectValid(r)
  })

  it('spouse edge contradicting parent-child is refused', () => {
    const r = computeLayout({
      members: [m('p'), m('c')],
      relationships: [pc('r1', 'p', 'c'), sp('r2', 'p', 'c')],
    })
    expect(r.issues.some((i) => i.kind === 'invalid-edge')).toBe(true)
    expect(r.edges.filter((e) => e.kind === 'spouse')).toHaveLength(0)
    expectValid(r)
  })

  it('relationships pointing at filtered-out members are silently fine', () => {
    const r = computeLayout({
      members: [m('a')],
      relationships: [pc('r1', 'ghost', 'a'), sp('r2', 'a', 'ghost2')],
    })
    expect(r.nodes).toHaveLength(1)
    expect(r.issues).toEqual([])
  })
})

describe('computeLayout — invariants hold across random families', () => {
  const depths = [3, 8, 12, 20]
  for (const generations of depths) {
    it(`zero violations at ${generations} generations (10 seeds)`, { timeout: 30000 }, () => {
      for (let seed = 1; seed <= 10; seed++) {
        const fam = generateFamily(seed * 100 + generations, {
          generations,
          maxChildrenPerCouple: generations >= 12 ? 2 : 3,
          cousinMarriageRate: 0.08,
        })
        const r = computeLayout(fam, { showFormerSpouses: true })
        const violations = validateLayout(r)
        expect(
          violations.map((v) => `${v.rule}: ${v.message}`),
          `seed ${seed * 100 + generations}, ${fam.members.length} members`,
        ).toEqual([])
        // Everyone is either placed or explicitly reported — never lost.
        expect(r.nodes.length).toBe(fam.members.length)
      }
    })
  }

  it('generation rows are uniform: every node sits exactly on its row', () => {
    const fam = generateFamily(42, { generations: 6 })
    const r = computeLayout(fam)
    const rowY = new Map(r.generationRows.map((g) => [g.generation, g.y]))
    for (const n of r.nodes) {
      if (n.section === 'orphans') continue
      expect(n.y).toBe(rowY.get(n.generation))
    }
  })
})

describe('computeLayout — determinism', () => {
  it('shuffled input order produces the identical layout', () => {
    const fam = generateFamily(1234, { generations: 8, cousinMarriageRate: 0.1 })
    const a = computeLayout(fam, { showFormerSpouses: true })
    const b = computeLayout(
      {
        members: shuffled(fam.members, 999),
        relationships: shuffled(fam.relationships, 555),
      },
      { showFormerSpouses: true },
    )
    const key = (r: LayoutResult) =>
      r.nodes
        .map((n) => `${n.member.id}:${n.x.toFixed(2)},${n.y.toFixed(2)},${n.generation}`)
        .sort()
        .join('|')
    expect(key(b)).toBe(key(a))
    const edgeKey = (r: LayoutResult) =>
      r.edges.map((e) => e.d).sort().join('|')
    expect(edgeKey(b)).toBe(edgeKey(a))
  })

  it('same input twice → deep-equal results', () => {
    const fam = generateFamily(77, { generations: 10 })
    const a = computeLayout(fam)
    const b = computeLayout(fam)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('computeLayout — menorah (in-law parents above the spouse)', () => {
  const menorahInput = () => ({
    members: [
      m('gpaL', { gender: 'male' }),
      m('gmaL', { gender: 'female' }),
      m('gpaR', { gender: 'male' }),
      m('gmaR', { gender: 'female' }),
      m('dad', { gender: 'male' }),
      m('mom', { gender: 'female' }),
      m('kid'),
    ],
    relationships: [
      sp('r1', 'gpaL', 'gmaL'),
      sp('r2', 'gpaR', 'gmaR'),
      sp('r3', 'dad', 'mom'),
      pc('r4', 'gpaL', 'dad'),
      pc('r5', 'gmaL', 'dad'),
      pc('r6', 'gpaR', 'mom'),
      pc('r7', 'gmaR', 'mom'),
      pc('r8', 'dad', 'kid'),
      pc('r9', 'mom', 'kid'),
    ],
  })

  it("places the spouse's parents ABOVE the spouse with a solid rail, not a dashed link", () => {
    const r = computeLayout(menorahInput())
    expectValid(r)
    // No dashed secondary edges at all — both parent couples get rails.
    expect(r.edges.filter((e) => e.kind === 'secondary-parent')).toHaveLength(0)
    const familyParents = r.edges.filter((e) => e.kind === 'family').map((e) => e.kind === 'family' && e.parentUnitId)
    expect(familyParents).toHaveLength(3) // gpaL couple, gpaR couple, dad+mom couple
    // The in-law couple is a satellite, centred over mom's card.
    expect(r.satelliteUnitIds).toHaveLength(1)
    const mom = r.nodes.find((n) => n.member.id === 'mom')!
    const gpaR = r.nodes.find((n) => n.member.id === 'gpaR')!
    const gmaR = r.nodes.find((n) => n.member.id === 'gmaR')!
    const satCenter = (Math.min(gpaR.x, gmaR.x) + Math.max(gpaR.x, gmaR.x) + CARD.W) / 2
    expect(Math.abs(satCenter - (mom.x + CARD.W / 2))).toBeLessThan(1)
    // Same row as the blood grandparents.
    const gpaL = r.nodes.find((n) => n.member.id === 'gpaL')!
    expect(gpaR.generation).toBe(gpaL.generation)
  })

  it('mirror symmetry: his parents over him, her parents over her, widened couple gap', () => {
    const r = computeLayout(menorahInput())
    const dad = r.nodes.find((n) => n.member.id === 'dad')!
    const mom = r.nodes.find((n) => n.member.id === 'mom')!
    const gpaL = r.nodes.find((n) => n.member.id === 'gpaL')!
    const gmaL = r.nodes.find((n) => n.member.id === 'gmaL')!
    // Blood parents centred over dad's card.
    const leftCenter = (Math.min(gpaL.x, gmaL.x) + Math.max(gpaL.x, gmaL.x) + CARD.W) / 2
    expect(Math.abs(leftCenter - (dad.x + CARD.W / 2))).toBeLessThan(1)
    // The couple gap widened beyond the default so both parent couples fit.
    expect(mom.x - (dad.x + CARD.W)).toBeGreaterThan(GAPS.COUPLE)
  })

  it('in-law parents bring their other children along beside the couple', () => {
    const input = menorahInput()
    input.members.push(m('momSister', { gender: 'female' }))
    input.relationships.push(pc('r10', 'gpaR', 'momSister'), pc('r11', 'gmaR', 'momSister'))
    const r = computeLayout(input)
    expectValid(r)
    const sister = r.nodes.find((n) => n.member.id === 'momSister')!
    const mom = r.nodes.find((n) => n.member.id === 'mom')!
    expect(sister.generation).toBe(mom.generation)
  })

  it('random families with in-law parents keep every invariant at depth', { timeout: 30000 }, () => {
    for (let seed = 1; seed <= 10; seed++) {
      const fam = generateFamily(9000 + seed, {
        generations: 8,
        maxChildrenPerCouple: 3,
        inLawParentsRate: 0.35,
        cousinMarriageRate: 0.05,
      })
      const r = computeLayout(fam, { showFormerSpouses: true })
      expect(
        validateLayout(r).map((v) => `${v.rule}: ${v.message}`),
        `seed ${9000 + seed}, ${fam.members.length} members`,
      ).toEqual([])
      expect(r.nodes.length).toBe(fam.members.length)
    }
  })
})

describe('computeLayout — couples and bloodlines', () => {
  it('cousin marriage (diamond) renders without hanging and with one placement', { timeout: 2000 }, () => {
    // Two brothers' children marry each other.
    const members = [
      m('gpa', { gender: 'male' }),
      m('gma', { gender: 'female' }),
      m('s1', { gender: 'male', birth_order: 1 }),
      m('s2', { gender: 'male', birth_order: 2 }),
      m('w1', { gender: 'female' }),
      m('w2', { gender: 'female' }),
      m('cousinA', { gender: 'male' }),
      m('cousinB', { gender: 'female' }),
    ]
    const relationships = [
      sp('r1', 'gpa', 'gma'),
      pc('r2', 'gpa', 's1'),
      pc('r3', 'gma', 's1'),
      pc('r4', 'gpa', 's2'),
      pc('r5', 'gma', 's2'),
      sp('r6', 's1', 'w1'),
      sp('r7', 's2', 'w2'),
      pc('r8', 's1', 'cousinA'),
      pc('r9', 'w1', 'cousinA'),
      pc('r10', 's2', 'cousinB'),
      pc('r11', 'w2', 'cousinB'),
      sp('r12', 'cousinA', 'cousinB'),
    ]
    const r = computeLayout({ members, relationships })
    expect(r.nodes).toHaveLength(8)
    // The couple is one unit placed once; the other side's parent link
    // surfaces as a secondary edge or a reported issue — never a crash.
    expectValid(r)
    const a = r.nodes.find((n) => n.member.id === 'cousinA')!
    const b = r.nodes.find((n) => n.member.id === 'cousinB')!
    expect(a.unitId).toBe(b.unitId)
  })

  it('former spouses appear as badges only when enabled', () => {
    const members = [m('a'), m('ex', { gender: 'female' })]
    const relationships = [sp('r1', 'a', 'ex', 'ex')]
    const off = computeLayout({ members, relationships })
    expect(off.nodes.find((n) => n.member.id === 'a')!.secondaryPartners).toBeUndefined()
    const on = computeLayout({ members, relationships }, { showFormerSpouses: true })
    expect(on.nodes.find((n) => n.member.id === 'a')!.secondaryPartners?.[0]?.member.id).toBe('ex')
  })
})
