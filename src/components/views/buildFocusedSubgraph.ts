import type { Member, Relationship } from '../../types'

export type MemberRole =
  | 'focus' | 'spouse' | 'sibling' | 'sibling-spouse'
  | 'parent' | 'parent-spouse' | 'grandparent'
  | 'child' | 'step-child' | 'grandchild'

export type ParentalSide = 'paternal' | 'maternal'

export interface FocusedMember {
  member: Member
  generation: number  // 2=grandparents, 1=parents, 0=self row, -1=children, -2=grandchildren
  role: MemberRole
  side?: ParentalSide
}

/**
 * Computes the 3-generation subgraph around a focus person.
 * Returns members tagged with their generation level and role so the
 * layout engine can position them without re-walking the graph.
 */
export function buildFocusedSubgraph(
  focusId: string,
  members: Member[],
  relationships: Relationship[],
): FocusedMember[] {
  const memberById = new Map(members.map(m => [m.id, m]))

  const getParents = (id: string): string[] =>
    relationships
      .filter(r => r.type === 'parent-child' && r.member_b_id === id && memberById.has(r.member_a_id))
      .map(r => r.member_a_id)

  const getChildren = (id: string): string[] =>
    relationships
      .filter(r => r.type === 'parent-child' && r.member_a_id === id && memberById.has(r.member_b_id))
      .map(r => r.member_b_id)

  const getSpouses = (id: string): string[] =>
    relationships
      .filter(r => r.type === 'spouse' && (r.member_a_id === id || r.member_b_id === id))
      .map(r => (r.member_a_id === id ? r.member_b_id : r.member_a_id))
      .filter(sid => memberById.has(sid))

  const result: FocusedMember[] = []
  const included = new Set<string>()

  function add(id: string, gen: number, role: MemberRole, side?: ParentalSide) {
    if (included.has(id)) return
    const member = memberById.get(id)
    if (!member) return
    included.add(id)
    result.push({ member, generation: gen, role, side })
  }

  add(focusId, 0, 'focus')

  for (const sid of getSpouses(focusId)) add(sid, 0, 'spouse')

  const parents = getParents(focusId)
  const fatherIds = parents.filter(pid => memberById.get(pid)?.gender === 'male')
  const motherIds = parents.filter(pid => memberById.get(pid)?.gender === 'female')
  const otherParentIds = parents.filter(pid => !fatherIds.includes(pid) && !motherIds.includes(pid))

  for (const pid of fatherIds) add(pid, 1, 'parent', 'paternal')
  for (const pid of motherIds) add(pid, 1, 'parent', 'maternal')
  for (const pid of otherParentIds) add(pid, 1, 'parent', 'paternal')

  for (const pid of parents) {
    const pSide: ParentalSide = fatherIds.includes(pid) ? 'paternal' : 'maternal'
    for (const spid of getSpouses(pid)) {
      if (!parents.includes(spid)) add(spid, 1, 'parent-spouse', pSide)
    }
  }

  for (const fid of fatherIds) for (const gpid of getParents(fid)) add(gpid, 2, 'grandparent', 'paternal')
  for (const mid of motherIds) for (const gpid of getParents(mid)) add(gpid, 2, 'grandparent', 'maternal')

  const siblingIds: string[] = []
  for (const pid of parents) {
    for (const sibId of getChildren(pid)) {
      if (sibId !== focusId && !included.has(sibId)) {
        siblingIds.push(sibId)
        add(sibId, 0, 'sibling')
      }
    }
  }
  for (const sibId of siblingIds) {
    for (const sspId of getSpouses(sibId)) add(sspId, 0, 'sibling-spouse')
  }

  // Biological children of the focus person.
  const bioChildIds = new Set<string>(getChildren(focusId))
  // Step-children = children of the focus's spouse where the focus is
  // NOT also a parent. Previously these were dropped from the focused
  // view entirely, which is misleading for blended families — a parent
  // who's been raising their stepchildren for years would see them
  // disappear when they focus on themselves. We keep the role distinct
  // ('step-child' vs 'child') so the layout/UI can render them slightly
  // differently if it wants.
  const stepChildIds = new Set<string>()
  for (const spouseId of getSpouses(focusId)) {
    for (const cid of getChildren(spouseId)) {
      if (bioChildIds.has(cid)) continue
      if (getParents(cid).includes(focusId)) continue // bio, already counted
      stepChildIds.add(cid)
    }
  }
  for (const cid of bioChildIds) add(cid, -1, 'child')
  for (const cid of stepChildIds) add(cid, -1, 'step-child')

  // Grandchildren are walked through BOTH bio and step children — the
  // focus person is socially the grandparent regardless of biology.
  for (const cid of bioChildIds) {
    for (const gcid of getChildren(cid)) add(gcid, -2, 'grandchild')
  }
  for (const cid of stepChildIds) {
    for (const gcid of getChildren(cid)) add(gcid, -2, 'grandchild')
  }

  return result
}
