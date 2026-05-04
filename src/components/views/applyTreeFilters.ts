/**
 * Pure pre-layout filter pipeline.
 *
 * Strips members and dangling relationships according to the user's
 * advanced-filter selections, BEFORE handing the result to buildLayout.
 * Keeping this in its own module makes it trivial to unit-test the
 * filter rules in isolation from the rendering pipeline.
 */
import type { Member, Relationship } from '../../types'
import type { LineageInfo } from '../../lib/lineage'
import type { FilterState } from './AdvancedFilter'

export interface FilteredData {
  members: Member[]
  relationships: Relationship[]
}

/**
 * @param lineageById  Pre-resolved lineage map (gender-aware, see
 *                     `lib/lineage.ts`). The "Kohanim only" filter
 *                     respects the male-line rule — daughters of a
 *                     Kohen aren't included.
 */
export function applyTreeFilters(
  members: Member[],
  relationships: Relationship[],
  filters: FilterState,
  lineageById: Map<string, LineageInfo>,
): FilteredData {
  const search = filters.search.trim().toLowerCase()

  const passesLineage = (m: Member): boolean => {
    if (filters.lineage === 'all') return true
    const info = lineageById.get(m.id)
    if (!info) return false
    // showBadge = male WITH that exact lineage. Daughters don't pass —
    // they aren't Kohanot/Levi'ot per the halachic gate.
    return info.showBadge && info.lineage === filters.lineage
  }

  const passesDeceased = (m: Member): boolean =>
    !filters.hideDeceased || !m.death_date

  const passesSearch = (m: Member): boolean => {
    if (!search) return true
    const hay = `${m.first_name} ${m.last_name} ${m.nickname ?? ''}`.toLowerCase()
    return hay.includes(search)
  }

  // Manual hide: a `hidden` member is filtered out of the tree unless
  // the user has explicitly asked to see hidden members via
  // `filters.showHidden` — which surfaces them with a "restore"
  // affordance on each card (Instagram/WhatsApp blocked-list style).
  // Hidden never deletes data; the member remains in the store and on
  // every other screen (member panel, admin lists, etc.).
  const passesHidden = (m: Member): boolean => filters.showHidden || !m.hidden

  let allowed = new Set<string>(
    members
      .filter(m => passesHidden(m) && passesLineage(m) && passesDeceased(m) && passesSearch(m))
      .map(m => m.id),
  )

  // Cascade rules:
  //
  //   (a) Pure orphan — a member whose only links were to people the
  //       user hid. Without removing them they'd appear as a free-
  //       floating circle at the edge of the canvas. Only triggers
  //       when at least one member is manually hidden, so we don't
  //       prune standalone founders on a no-filter view.
  //
  //   (b) Redundant ex / widowed spouse — a member who joined the tree
  //       only through a now-divorced or deceased marriage, has no
  //       blood relatives in-tree (no parents), and whose remaining
  //       tie is shared children that already have a fully-visible
  //       primary parent on the other side. Without this rule the ex
  //       floats as an orphan node beside the subtree (the children
  //       re-anchor cleanly under the other parent). Skipped when the
  //       user opts in to "Show divorces" — that flag is the explicit
  //       request to render those people, even if they'd otherwise be
  //       redundant.
  //
  // Iterates to convergence — each pass can orphan members that the
  // previous one disconnected.
  const allHidden = new Set(members.filter(m => m.hidden).map(m => m.id))
  let removedAny = true
  while (removedAny) {
    removedAny = false
    for (const id of [...allowed]) {
      if (allHidden.has(id)) continue
      const visibleParents = relationships.filter(
        r => r.type === 'parent-child' && r.member_b_id === id && allowed.has(r.member_a_id),
      )
      if (visibleParents.length > 0) continue
      const visibleCurrentSpouses = relationships.filter(
        r => r.type === 'spouse' && (r.status ?? 'current') === 'current' &&
          (r.member_a_id === id || r.member_b_id === id) &&
          allowed.has(r.member_a_id === id ? r.member_b_id : r.member_a_id),
      )
      if (visibleCurrentSpouses.length > 0) continue

      const childRels = relationships.filter(
        r => r.type === 'parent-child' && r.member_a_id === id && allowed.has(r.member_b_id),
      )

      if (childRels.length > 0) {
        // Honor "Show divorces" — keep ex / widowed spouses with shared
        // children when the user explicitly asked to see them.
        if (filters.showFormerSpouses) continue
        const someChildNeedsMe = childRels.some(rel => {
          const childId = rel.member_b_id
          const otherVisibleParents = relationships.filter(
            r => r.type === 'parent-child' &&
                 r.member_b_id === childId &&
                 r.member_a_id !== id &&
                 allowed.has(r.member_a_id),
          )
          return otherVisibleParents.length === 0
        })
        if (someChildNeedsMe) continue
        allowed.delete(id)
        removedAny = true
        continue
      }

      // No anchors at all (case (a)). Preserve standalone founders
      // unless the user is actively narrowing the tree with hides.
      if (allHidden.size === 0) continue
      const hasAnyParent = relationships.some(
        r => r.type === 'parent-child' && r.member_b_id === id,
      )
      if (!hasAnyParent) continue
      allowed.delete(id)
      removedAny = true
    }
  }

  // Focus mode — restrict to ancestors + descendants + spouses of the
  // focused member. Intersected with the other filters.
  if (filters.focusMemberId) {
    const focusId = filters.focusMemberId
    const ancestors = walkRelations(focusId, relationships, 'parent-child', 'b->a')
    const descendants = walkRelations(focusId, relationships, 'parent-child', 'a->b')
    const spouseIds = relationships
      .filter(r => r.type === 'spouse' && (r.member_a_id === focusId || r.member_b_id === focusId))
      .map(r => (r.member_a_id === focusId ? r.member_b_id : r.member_a_id))
    const focusSet = new Set<string>([focusId, ...ancestors, ...descendants, ...spouseIds])
    allowed = new Set([...allowed].filter(id => focusSet.has(id)))
    // Always include the focused person even if other filters would have
    // dropped them — focus is the primary signal.
    allowed.add(focusId)
  }

  const filteredMembers = members.filter(m => allowed.has(m.id))
  const filteredRels = relationships.filter(
    r => allowed.has(r.member_a_id) && allowed.has(r.member_b_id),
  )
  return { members: filteredMembers, relationships: filteredRels }
}

/**
 * Walk parent-child relationships outward from a starting member.
 *  - direction 'b->a' walks UP   (find ancestors of `startId`)
 *  - direction 'a->b' walks DOWN (find descendants of `startId`)
 * Returns the visited set excluding `startId` itself.
 */
function walkRelations(
  startId: string,
  relationships: Relationship[],
  type: 'parent-child' | 'spouse',
  direction: 'a->b' | 'b->a',
): Set<string> {
  // Build adjacency once.
  const adj = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type !== type) continue
    const from = direction === 'a->b' ? r.member_a_id : r.member_b_id
    const to   = direction === 'a->b' ? r.member_b_id : r.member_a_id
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(to)
  }
  const seen = new Set<string>()
  const stack = [startId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const nxt of adj.get(cur) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt)
        stack.push(nxt)
      }
    }
  }
  return seen
}
