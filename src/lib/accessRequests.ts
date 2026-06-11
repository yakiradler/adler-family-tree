import type { AccessRequest, FamilyTree } from '../types'

/**
 * Which tree is an access request actually asking for?
 *
 * Producers stash the target in different shapes:
 *   • TreeCardActionMenu ("request share code") → answers.target_tree_id
 *   • JumpToFamilyTreeButton ("tree-access")    → answers.target_tree_name only
 *   • OnboardingWizard (join with a code)       → request.invite_code
 *     (resolved separately — the code→tree mapping lives in the
 *     tree_invites table, so it needs a DB lookup, not this helper)
 *
 * Returns the tree id when it can be resolved from the request +
 * the caller's visible trees, else null. Name matching is trimmed
 * case-insensitive — names come from free-typed UI fields.
 */
export function resolveRequestTreeId(
  request: Pick<AccessRequest, 'answers'>,
  trees: Pick<FamilyTree, 'id' | 'name'>[],
): string | null {
  const a = (request.answers ?? {}) as Record<string, unknown>

  const directId = a.target_tree_id
  if (typeof directId === 'string' && directId) {
    // Trust an id only if it's actually one of the caller's trees —
    // a stale id (tree deleted since the request) must not produce a
    // dangling grant.
    if (trees.some((t) => t.id === directId)) return directId
  }

  const name = a.target_tree_name
  if (typeof name === 'string' && name.trim()) {
    const norm = (s: string) => s.trim().toLowerCase()
    const hit = trees.find((t) => norm(t.name ?? '') === norm(name))
    if (hit) return hit.id
  }

  return null
}
