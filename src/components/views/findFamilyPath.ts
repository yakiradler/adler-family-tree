import type { Relationship } from '../../types'

/**
 * Shortest family-relation path between two members.
 *
 * Treats the family as an undirected graph: every parent-child and
 * every spouse relationship (regardless of status — current, ex, or
 * deceased — because they're all real ties for "how are X and Y
 * related?") becomes a bidirectional edge. BFS guarantees the result
 * is the shortest path in edge count, which is also the most
 * intuitive "X is Y's mother-in-law's brother" style chain.
 *
 * Returns the ordered list of member ids on the path AND the
 * relationship rows that connect each consecutive pair, so the caller
 * can pass both to the layout / connector renderer without re-walking
 * the graph.
 */
export interface FamilyPath {
  memberIds: string[]
  relationshipIds: string[]
}

export function findFamilyPath(
  relationships: Relationship[],
  fromId: string,
  toId: string,
): FamilyPath | null {
  if (!fromId || !toId) return null
  if (fromId === toId) return { memberIds: [fromId], relationshipIds: [] }

  // Adjacency list: id -> [(neighborId, relationshipId)]. Built once,
  // both directions for every edge so BFS doesn't have to inspect
  // direction.
  const adj = new Map<string, Array<{ to: string; relId: string }>>()
  const link = (a: string, b: string, relId: string) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push({ to: b, relId })
  }
  for (const r of relationships) {
    link(r.member_a_id, r.member_b_id, r.id)
    link(r.member_b_id, r.member_a_id, r.id)
  }

  // Standard BFS with parent-pointer reconstruction.
  const cameFrom = new Map<string, { from: string; relId: string }>()
  const visited = new Set<string>([fromId])
  const queue: string[] = [fromId]
  let found = false
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === toId) { found = true; break }
    for (const edge of adj.get(cur) ?? []) {
      if (visited.has(edge.to)) continue
      visited.add(edge.to)
      cameFrom.set(edge.to, { from: cur, relId: edge.relId })
      queue.push(edge.to)
    }
  }
  if (!found) return null

  // Reconstruct in reverse, then flip.
  const memberIds: string[] = []
  const relationshipIds: string[] = []
  let cursor: string | undefined = toId
  while (cursor && cursor !== fromId) {
    memberIds.push(cursor)
    const step = cameFrom.get(cursor)
    if (!step) break
    relationshipIds.push(step.relId)
    cursor = step.from
  }
  memberIds.push(fromId)
  memberIds.reverse()
  relationshipIds.reverse()
  return { memberIds, relationshipIds }
}
