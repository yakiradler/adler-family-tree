import type { Member, Relationship } from '../../types'

export type MemberRole =
  | 'focus' | 'spouse' | 'sibling' | 'sibling-spouse'
  | 'parent' | 'parent-spouse' | 'grandparent'
  | 'child' | 'grandchild'

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

  const focusChildIds = new Set<string>()
  for (const cid of getChildren(focusId)) focusChildIds.add(cid)
  for (const spouseId of getSpouses(focusId)) {
    for (const cid of getChildren(spouseId)) {
      if (getParents(cid).includes(focusId)) focusChildIds.add(cid)
    }
  }
  for (const cid of focusChildIds) add(cid, -1, 'child')

  for (const cid of focusChildIds) {
    for (const gcid of getChildren(cid)) add(gcid, -2, 'grandchild')
  }

  return result
}
