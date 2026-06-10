// ─────────────────────────────────────────────────────────────────────
// Graph normalization: raw members + relationships → validated
// FamilyGraph of placement units (couples / singles).
//
// All ambiguity in the family data is resolved HERE, deterministically:
//   • couple pairing (and demotion of impossible extra "current" spouses)
//   • which spouse anchors the couple to a bloodline (the "primary")
//   • which parent each child is placed under (connector_parent_id →
//     mother → first parent)
//   • which parent links are real but don't drive placement (drawn as
//     dashed secondary edges)
// Bad data NEVER throws or hangs — it is demoted/skipped and reported
// through `issues`.
// ─────────────────────────────────────────────────────────────────────

import type { Member } from '../types'
import type {
  FamilyGraph,
  LayoutInput,
  LayoutIssue,
  LayoutOptions,
  SecondaryPartner,
  Unit,
  UnitId,
} from './types'

export function unitIdOf(memberIds: string[]): UnitId {
  return [...memberIds].sort().join('+')
}

/** Sibling ordering: birth_order → birth_date → first name → id. */
export function compareSiblings(a: Member, b: Member): number {
  const ao = a.birth_order
  const bo = b.birth_order
  if (ao != null && bo != null && ao !== bo) return ao - bo
  if (ao != null && bo == null) return -1
  if (ao == null && bo != null) return 1
  const ad = a.birth_date ? new Date(a.birth_date).getTime() : null
  const bd = b.birth_date ? new Date(b.birth_date).getTime() : null
  if (ad != null && bd != null && ad !== bd) return ad - bd
  if (ad != null && bd == null) return -1
  if (ad == null && bd != null) return 1
  const byName = (a.first_name || '').localeCompare(b.first_name || '', 'he')
  if (byName !== 0) return byName
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function fullName(m: Member | undefined): string {
  return m ? `${m.first_name} ${m.last_name}`.trim() : '?'
}

export function buildFamilyGraph(input: LayoutInput, options: LayoutOptions = {}): FamilyGraph {
  const issues: LayoutIssue[] = []
  const showFormerSpouses = options.showFormerSpouses ?? false

  // Deterministic processing order regardless of fetch order.
  const members = [...input.members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const relationships = [...input.relationships].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const memberById = new Map(members.map((m) => [m.id, m]))

  // ── Raw adjacency (only edges with both endpoints in the input) ───
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const parentChildPairs = new Set<string>()
  const currentSpouseEdges: Array<{ a: string; b: string }> = []
  const formerSpouseEdges: Array<{ a: string; b: string; status: 'ex' | 'deceased' }> = []

  for (const r of relationships) {
    // Members outside the input (filtered out) are normal, not an error.
    if (!memberById.has(r.member_a_id) || !memberById.has(r.member_b_id)) continue
    if (r.member_a_id === r.member_b_id) {
      issues.push({
        kind: 'invalid-edge',
        memberIds: [r.member_a_id],
        message: `Self-referencing ${r.type} relationship on ${fullName(memberById.get(r.member_a_id))}`,
      })
      continue
    }

    if (r.type === 'parent-child') {
      const key = `${r.member_a_id}>${r.member_b_id}`
      if (parentChildPairs.has(key)) continue // exact duplicate row
      parentChildPairs.add(key)
      const ps = parentsOf.get(r.member_b_id) ?? []
      ps.push(r.member_a_id)
      parentsOf.set(r.member_b_id, ps)
      const cs = childrenOf.get(r.member_a_id) ?? []
      cs.push(r.member_b_id)
      childrenOf.set(r.member_a_id, cs)
      continue
    }

    if (r.type === 'spouse') {
      const status = r.status ?? 'current'
      if (status === 'current') currentSpouseEdges.push({ a: r.member_a_id, b: r.member_b_id })
      else formerSpouseEdges.push({ a: r.member_a_id, b: r.member_b_id, status })
    }
    // 'sibling' rows are legacy/no-op: siblings are derived from shared parents.
  }

  // ── Couple pairing ────────────────────────────────────────────────
  // Each member can be in at most one couple. Extra "current" spouse
  // edges (data error) are demoted to badges and reported. A spouse
  // edge that contradicts a parent-child edge between the same two
  // people is refused outright.
  const spouseOf = new Map<string, string>()
  const secondaryPartnersOf = new Map<string, SecondaryPartner[]>()

  const addSecondary = (ownerId: string, partnerId: string, status: SecondaryPartner['status']) => {
    const partner = memberById.get(partnerId)
    if (!partner) return
    const list = secondaryPartnersOf.get(ownerId) ?? []
    if (!list.some((p) => p.member.id === partnerId)) {
      list.push({ member: partner, status })
      secondaryPartnersOf.set(ownerId, list)
    }
  }

  for (const { a, b } of currentSpouseEdges) {
    if (parentChildPairs.has(`${a}>${b}`) || parentChildPairs.has(`${b}>${a}`)) {
      issues.push({
        kind: 'invalid-edge',
        memberIds: [a, b],
        message: `${fullName(memberById.get(a))} and ${fullName(memberById.get(b))} are recorded as both spouses and parent-child; the spouse link was ignored`,
      })
      continue
    }
    if (spouseOf.has(a) || spouseOf.has(b)) {
      // Demote to badges on whichever side is already married.
      addSecondary(a, b, 'current')
      addSecondary(b, a, 'current')
      issues.push({
        kind: 'multiple-current-spouses',
        memberIds: [a, b],
        message: `${fullName(memberById.get(a))} / ${fullName(memberById.get(b))}: more than one current spouse — extra partner shown as a badge`,
      })
      continue
    }
    spouseOf.set(a, b)
    spouseOf.set(b, a)
  }

  if (showFormerSpouses) {
    for (const { a, b, status } of formerSpouseEdges) {
      addSecondary(a, b, status)
      addSecondary(b, a, status)
    }
  }

  // ── Ancestor counting (for primary selection) ─────────────────────
  // Visited-set walk: terminates on any input, including cyclic data.
  const ancestorCountCache = new Map<string, number>()
  function ancestorCount(id: string): number {
    const cached = ancestorCountCache.get(id)
    if (cached != null) return cached
    const seen = new Set<string>()
    const stack = [...(parentsOf.get(id) ?? [])]
    while (stack.length > 0) {
      const p = stack.pop()!
      if (seen.has(p) || p === id) continue
      seen.add(p)
      for (const gp of parentsOf.get(p) ?? []) stack.push(gp)
    }
    ancestorCountCache.set(id, seen.size)
    return seen.size
  }

  // ── Units ─────────────────────────────────────────────────────────
  const units: Unit[] = []
  const unitById = new Map<UnitId, Unit>()
  const unitOfMember = new Map<string, UnitId>()

  const pushUnit = (unit: Unit) => {
    units.push(unit)
    unitById.set(unit.id, unit)
    for (const m of unit.members) unitOfMember.set(m.id, unit.id)
  }

  // Badge-only members: someone's ex/deceased partner whose ONLY tie
  // to the tree is that former marriage. They render as the small
  // badge under the former partner — never as their own floating card.
  // Asymmetry guard: the badge needs an ANCHORED host (a partner with
  // real ties of their own); a divorced pair where BOTH sides have
  // nothing else keeps two normal cards instead of vanishing.
  const anchored = (id: string): boolean =>
    spouseOf.has(id) ||
    (parentsOf.get(id) ?? []).length > 0 ||
    (childrenOf.get(id) ?? []).length > 0
  const badgeOnlyMemberIds = new Set<string>()
  for (const [ownerId, list] of secondaryPartnersOf) {
    if (!anchored(ownerId)) continue
    for (const p of list) {
      if (!anchored(p.member.id)) badgeOnlyMemberIds.add(p.member.id)
    }
  }

  const seen = new Set<string>()
  for (const m of members) {
    if (seen.has(m.id)) continue
    if (badgeOnlyMemberIds.has(m.id)) {
      seen.add(m.id)
      continue // represented as a badge, not a unit
    }
    const spouseId = spouseOf.get(m.id)
    if (!spouseId) {
      seen.add(m.id)
      pushUnit({ id: unitIdOf([m.id]), members: [m], primary: m })
      continue
    }
    const spouse = memberById.get(spouseId)!
    seen.add(m.id)
    seen.add(spouseId)

    // Bloodline anchor: the spouse with more in-tree ancestors wins;
    // ties break to the smaller id. Deterministic and stable.
    const ca = ancestorCount(m.id)
    const cb = ancestorCount(spouseId)
    const primary = ca > cb ? m : cb > ca ? spouse : m.id < spouseId ? m : spouse

    // Visual order: father (male) left, mother (female) right.
    // Same/unknown genders: primary left.
    const left =
      m.gender === 'male' ? m
      : spouse.gender === 'male' ? spouse
      : primary
    const right = left.id === m.id ? spouse : m

    pushUnit({ id: unitIdOf([m.id, spouseId]), members: [left, right], primary })
  }

  // ── Placement parent per child ────────────────────────────────────
  // connector_parent_id (when it names a real parent) → mother → first
  // parent by id. Exactly one parent drives each child's placement.
  const placementParentOf = new Map<string, string>()
  for (const [childId, ps] of parentsOf) {
    const sorted = [...ps].sort()
    const override = memberById.get(childId)?.connector_parent_id
    let chosen: string | undefined
    if (override && sorted.includes(override)) chosen = override
    if (!chosen) chosen = sorted.find((p) => memberById.get(p)?.gender === 'female')
    if (!chosen) chosen = sorted[0]
    if (chosen) placementParentOf.set(childId, chosen)
  }

  // ── Unit-level placement tree + secondary edges ───────────────────
  const parentUnitOf = new Map<UnitId, UnitId>()
  const childUnitsOf = new Map<UnitId, UnitId[]>()
  const secondaryParentEdges: Array<{ parentId: string; childId: string }> = []
  const secondaryDedup = new Set<string>()

  for (const unit of units) {
    const placement = placementParentOf.get(unit.primary.id)
    if (!placement) continue
    const parentUnit = unitOfMember.get(placement)
    if (!parentUnit || parentUnit === unit.id) continue
    parentUnitOf.set(unit.id, parentUnit)
    const list = childUnitsOf.get(parentUnit) ?? []
    list.push(unit.id)
    childUnitsOf.set(parentUnit, list)
  }

  // ── In-law satellites ("menorah" placement) ───────────────────────
  // A parent unit that is itself a ROOT (no parents above it) and whose
  // tie to the tree is a married-in child gets promoted to a satellite:
  // it will be placed directly ABOVE that child's card and connected
  // with a normal solid family rail, instead of floating as a distant
  // root with a dashed link. One anchor child per unit (first by
  // sibling order, deterministic); additional married-in children of
  // the same unit keep dashed links.
  const satellites: FamilyGraph['satellites'] = []
  const satelliteAnchorKey = new Set<string>() // `${parentUnit}>${childId}` pairs covered by a rail
  for (const unit of units) {
    if (parentUnitOf.has(unit.id)) continue // has its own parents — placed normally
    const marriedInChildren: Member[] = []
    for (const pm of unit.members) {
      for (const c of childrenOf.get(pm.id) ?? []) {
        if (placementParentOf.get(c) !== pm.id && !unit.members.some((m) => m.id === placementParentOf.get(c))) continue
        const childUnit = unitById.get(unitOfMember.get(c)!)!
        if (childUnit.primary.id === c) continue // blood-anchored child — normal rail
        if (!marriedInChildren.some((m) => m.id === c)) {
          const cm = memberById.get(c)
          if (cm) marriedInChildren.push(cm)
        }
      }
    }
    if (marriedInChildren.length === 0) continue
    marriedInChildren.sort(compareSiblings)
    const anchor = marriedInChildren[0]
    satellites.push({
      unitId: unit.id,
      hostUnitId: unitOfMember.get(anchor.id)!,
      anchorMemberId: anchor.id,
    })
    satelliteAnchorKey.add(`${unit.id}>${anchor.id}`)
  }

  // Every raw parent link that the placement tree does NOT cover
  // becomes a dashed secondary edge (deduped to one per parent-unit).
  // Satellite anchors are excluded — they get a real family rail.
  for (const [childId, ps] of parentsOf) {
    const childUnit = unitById.get(unitOfMember.get(childId)!)!
    const childIsPrimary = childUnit.primary.id === childId
    const placementUnit = childIsPrimary ? parentUnitOf.get(childUnit.id) : undefined
    for (const p of [...ps].sort()) {
      const pUnit = unitOfMember.get(p)!
      if (childIsPrimary && pUnit === placementUnit) continue // covered by the family rail
      if (satelliteAnchorKey.has(`${pUnit}>${childId}`)) continue // covered by a satellite rail
      const key = `${pUnit}>${childId}`
      if (secondaryDedup.has(key)) continue
      secondaryDedup.add(key)
      // Representative parent inside that unit: prefer the child's own
      // placement parent if it lives there, else the unit's left member.
      const placement = placementParentOf.get(childId)
      const rep =
        placement && unitOfMember.get(placement) === pUnit
          ? placement
          : unitById.get(pUnit)!.members[0].id
      secondaryParentEdges.push({ parentId: rep, childId })
    }
  }

  // ── Sibling order within each parent unit ─────────────────────────
  for (const [parentUnit, kids] of childUnitsOf) {
    kids.sort((ua, ub) => compareSiblings(unitById.get(ua)!.primary, unitById.get(ub)!.primary))
    childUnitsOf.set(parentUnit, kids)
  }

  // ── Orphans: no family edges at all ───────────────────────────────
  const orphanUnitIds = new Set<UnitId>()
  for (const unit of units) {
    if (unit.members.length > 1) continue
    const id = unit.primary.id
    const noParents = (parentsOf.get(id) ?? []).length === 0
    const noKids = (childrenOf.get(id) ?? []).length === 0
    if (noParents && noKids) orphanUnitIds.add(unit.id)
  }

  return {
    memberById,
    units,
    unitById,
    unitOfMember,
    parentsOf,
    childrenOf,
    placementParentOf,
    childUnitsOf,
    parentUnitOf,
    secondaryParentEdges,
    secondaryPartnersOf,
    satellites,
    orphanUnitIds,
    badgeOnlyMemberIds,
    issues,
  }
}
