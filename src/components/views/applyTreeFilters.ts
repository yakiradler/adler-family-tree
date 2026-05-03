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

  // Manual hide: a member flagged `hidden` is removed from the tree no
  // matter what other filters do (the user explicitly hid them).
  const passesHidden = (m: Member): boolean => !m.hidden

  let allowed = new Set<string>(
    members
      .filter(m => passesHidden(m) && passesLineage(m) && passesDeceased(m) && passesSearch(m))
      .map(m => m.id),
  )

  // Cascade: if all of a member's parents AND spouses are hidden (not in
  // `allowed`), that member has no structural connection to the visible
  // tree and would show up as an isolated orphan on the side. Remove them
  // too, unless they have visible children (i.e. they're a root ancestor
  // of a visible subtree). This iterates to convergence because each
  // pass can orphan previously-connected members.
  const allHidden = new Set(members.filter(m => m.hidden).map(m => m.id))
  let removedAny = true
  while (removedAny) {
    removedAny = false
    for (const id of [...allowed]) {
      // Already explicitly hidden — covered above.
      if (allHidden.has(id)) continue
      // Keep members that have at least one visible parent.
      const visibleParents = relationships.filter(
        r => r.type === 'parent-child' && r.member_b_id === id && allowed.has(r.member_a_id),
      )
      if (visibleParents.length > 0) continue
      // Keep members that have at least one visible child.
      const visibleChildren = relationships.filter(
        r => r.type === 'parent-child' && r.member_a_id === id && allowed.has(r.member_b_id),
      )
      if (visibleChildren.length > 0) continue
      // Keep members that have at least one visible current spouse.
      const visibleSpouses = relationships.filter(
        r => r.type === 'spouse' && (r.status ?? 'current') === 'current' &&
          (r.member_a_id === id || r.member_b_id === id) &&
          allowed.has(r.member_a_id === id ? r.member_b_id : r.member_a_id),
      )
      if (visibleSpouses.length > 0) continue
      // No visible connections — this member is an orphan island introduced
      // by hiding one of their relatives. Remove them so they don't appear
      // floating alone at the edge of the canvas.
      // Exception: if NO filters are active (no hidden members at all),
      // keep every root so we don't accidentally drop unconnected founders.
      if (allHidden.size === 0) continue
      // Only cascade-hide if the member would genuinely be isolated
      // (not a founder with no parents who adds standalone history).
      const hasAnyParent = relationships.some(
        r => r.type === 'parent-child' && r.member_b_id === id,
      )
      if (!hasAnyParent) continue // founder — keep visible
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
