import type { Member, Relationship } from '../types'

export type RelativeDirection = 'parent' | 'sibling' | 'spouse' | 'child'

interface LinkRelativeArgs {
  created: Member
  anchor: Member
  direction: RelativeDirection
  addRelationship: (rel: Omit<Relationship, 'id'>) => Promise<void>
  relationships: Relationship[]
}

/**
 * Wire a freshly-created member to an existing anchor according to the
 * chosen direction. Shared by QuickAddRelativeModal (the per-card "+"
 * buttons) and AddMemberModal (the main "+") so both create identical
 * relationships and never leave the new member disconnected.
 *
 *   parent  → the new member is a parent of the anchor
 *   child   → the new member is a child of the anchor
 *   spouse  → the new member is the anchor's current spouse
 *   sibling → the new member inherits all of the anchor's in-tree parents
 *             so it lands in the right generation. If the anchor has no
 *             parents the sibling is left parent-less — callers should
 *             steer users to a different relation in that case.
 */
export async function linkRelative({
  created,
  anchor,
  direction,
  addRelationship,
  relationships,
}: LinkRelativeArgs): Promise<void> {
  if (direction === 'parent') {
    await addRelationship({ type: 'parent-child', member_a_id: created.id, member_b_id: anchor.id })
  } else if (direction === 'child') {
    await addRelationship({ type: 'parent-child', member_a_id: anchor.id, member_b_id: created.id })
  } else if (direction === 'spouse') {
    await addRelationship({ type: 'spouse', member_a_id: anchor.id, member_b_id: created.id, status: 'current' })
  } else if (direction === 'sibling') {
    const parents = relationships
      .filter((r) => r.type === 'parent-child' && r.member_b_id === anchor.id)
      .map((r) => r.member_a_id)
    for (const pid of parents) {
      await addRelationship({ type: 'parent-child', member_a_id: pid, member_b_id: created.id })
    }
  }
}
