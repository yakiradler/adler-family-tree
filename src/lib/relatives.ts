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
 *   parent  → the new member is a parent of the anchor. If the anchor
 *             already has exactly ONE other parent and that parent has
 *             no current spouse, the two parents are also married
 *             automatically — adding "אבא" then "אמא" should produce a
 *             couple, not two disconnected single parents. (Edge cases
 *             like a second parent after divorce keep manual control:
 *             with two or more existing parents nothing is auto-married.)
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
    // Auto-marry the two parents of the anchor (common case: the user
    // adds father, then mother — they expect a couple).
    const otherParents = relationships
      .filter((r) => r.type === 'parent-child' && r.member_b_id === anchor.id && r.member_a_id !== created.id)
      .map((r) => r.member_a_id)
    const uniqueOthers = [...new Set(otherParents)]
    if (uniqueOthers.length === 1) {
      const other = uniqueOthers[0]
      const otherHasCurrentSpouse = relationships.some(
        (r) =>
          r.type === 'spouse' &&
          (r.status ?? 'current') === 'current' &&
          (r.member_a_id === other || r.member_b_id === other),
      )
      if (!otherHasCurrentSpouse) {
        await addRelationship({
          type: 'spouse',
          member_a_id: other,
          member_b_id: created.id,
          status: 'current',
        })
      }
    }
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
