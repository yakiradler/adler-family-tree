// ─────────────────────────────────────────────────────────────────────
// Seeded random family generator for layout-engine tests.
//
// Same seed → same family, always (mulberry32 PRNG). Generates realistic
// AND hostile data: deep generation chains, marry-ins, remarriages
// (ex/deceased spouses), cousin marriages (both-bloodline couples — the
// diamond shape that killed a previous engine), missing genders,
// connector_parent_id overrides, and standalone orphans.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship } from '../../types'

export interface FamilySpec {
  generations: number
  /** Couples in generation 0. */
  rootCouples?: number
  maxChildrenPerCouple?: number
  marryRate?: number
  /** Chance a married member also has an ex/deceased former spouse. */
  formerSpouseRate?: number
  /** Chance a new spouse is drawn from in-tree members (cousin marriage). */
  cousinMarriageRate?: number
  missingGenderRate?: number
  connectorOverrideRate?: number
  orphanCount?: number
}

export interface GeneratedFamily {
  members: Member[]
  relationships: Relationship[]
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateFamily(seed: number, spec: FamilySpec): GeneratedFamily {
  const rnd = mulberry32(seed)
  const {
    generations,
    rootCouples = 1,
    maxChildrenPerCouple = 4,
    marryRate = 0.7,
    formerSpouseRate = 0.1,
    cousinMarriageRate = 0.05,
    missingGenderRate = 0.04,
    connectorOverrideRate = 0.05,
    orphanCount = 2,
  } = spec

  const members: Member[] = []
  const relationships: Relationship[] = []
  let memberSeq = 0
  let relSeq = 0

  const newMember = (gender: Member['gender'], gen: number): Member => {
    memberSeq++
    const id = `m${String(memberSeq).padStart(5, '0')}`
    const m: Member = {
      id,
      first_name: `P${memberSeq}`,
      last_name: `Gen${gen}`,
      gender: rnd() < missingGenderRate ? undefined : gender,
      birth_date: `${1900 + gen * 25 + Math.floor(rnd() * 20)}-01-0${1 + Math.floor(rnd() * 8)}`,
      created_by: 'gen',
    }
    members.push(m)
    return m
  }
  const rel = (r: Omit<Relationship, 'id'>): Relationship => {
    relSeq++
    const full = { id: `r${String(relSeq).padStart(5, '0')}`, ...r }
    relationships.push(full)
    return full
  }
  const marry = (a: Member, b: Member) =>
    rel({ member_a_id: a.id, member_b_id: b.id, type: 'spouse', status: 'current' })
  const exMarry = (a: Member, b: Member, status: 'ex' | 'deceased') =>
    rel({ member_a_id: a.id, member_b_id: b.id, type: 'spouse', status })
  const parent = (p: Member, c: Member) =>
    rel({ member_a_id: p.id, member_b_id: c.id, type: 'parent-child' })

  /** Members eligible to be a cousin-spouse: unmarried, in a given gen. */
  const unmarriedByGen = new Map<number, Member[]>()
  const married = new Set<string>()
  const trackUnmarried = (m: Member, gen: number) => {
    const list = unmarriedByGen.get(gen) ?? []
    list.push(m)
    unmarriedByGen.set(gen, list)
  }

  // Generation 0 — root couples.
  let currentCouples: Array<[Member, Member]> = []
  for (let i = 0; i < rootCouples; i++) {
    const dad = newMember('male', 0)
    const mom = newMember('female', 0)
    marry(dad, mom)
    married.add(dad.id).add(mom.id)
    currentCouples.push([dad, mom])
  }

  for (let gen = 1; gen < generations; gen++) {
    const nextCouples: Array<[Member, Member]> = []
    for (const [dad, mom] of currentCouples) {
      // Guarantee the chain continues: at least 1 child for the first
      // couple of each generation so requested depth is always reached.
      const guaranteed = nextCouples.length === 0 && currentCouples[0][0].id === dad.id ? 1 : 0
      const nChildren = Math.max(guaranteed, Math.floor(rnd() * (maxChildrenPerCouple + 1)))
      for (let k = 0; k < nChildren; k++) {
        const childGender = rnd() < 0.5 ? 'male' : 'female'
        const child = newMember(childGender, gen)
        child.birth_order = k + 1
        parent(dad, child)
        parent(mom, child)
        if (rnd() < connectorOverrideRate) child.connector_parent_id = dad.id

        const shouldMarry = rnd() < marryRate || (guaranteed === 1 && k === 0)
        if (!shouldMarry) {
          trackUnmarried(child, gen)
          continue
        }

        // Spouse: usually married-in, sometimes an in-tree cousin
        // (both-bloodline couple — the diamond case).
        let spouse: Member | null = null
        if (rnd() < cousinMarriageRate) {
          const pool = (unmarriedByGen.get(gen) ?? []).filter(
            (m) => !married.has(m.id) && m.id !== child.id,
          )
          if (pool.length > 0) spouse = pool[Math.floor(rnd() * pool.length)]
        }
        if (!spouse) {
          spouse = newMember(childGender === 'male' ? 'female' : 'male', gen)
        }
        marry(child, spouse)
        married.add(child.id).add(spouse.id)

        if (rnd() < formerSpouseRate) {
          const former = newMember(rnd() < 0.5 ? 'male' : 'female', gen)
          exMarry(child, former, rnd() < 0.5 ? 'ex' : 'deceased')
        }
        nextCouples.push(childGender === 'male' ? [child, spouse] : [spouse, child])
      }
    }
    if (nextCouples.length === 0 && gen < generations - 1) {
      // Population died out early — restart the chain from a fresh couple
      // descending from the first remaining couple.
      const [dad, mom] = currentCouples[0]
      const child = newMember('male', gen)
      parent(dad, child)
      parent(mom, child)
      const spouse = newMember('female', gen)
      marry(child, spouse)
      nextCouples.push([child, spouse])
    }
    currentCouples = nextCouples
  }

  for (let i = 0; i < orphanCount; i++) {
    newMember(rnd() < 0.5 ? 'male' : 'female', generations)
  }

  return { members, relationships }
}

/** Fisher-Yates shuffle with the same PRNG — for determinism tests. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const rnd = mulberry32(seed)
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
