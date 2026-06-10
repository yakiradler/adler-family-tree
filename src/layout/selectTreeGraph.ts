// ─────────────────────────────────────────────────────────────────────
// Tree scoping — THE single place where per-tree isolation happens.
//
// Members of other trees and any relationship touching them simply do
// not exist as far as the engine (or any view) is concerned. The future
// "combined trees" view plugs in HERE: call with two tree ids and feed
// the result to the same computeLayout — no engine changes needed.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship } from '../types'
import type { LayoutInput } from './types'

export function selectTreeGraph(
  allMembers: Member[],
  allRelationships: Relationship[],
  treeIds: readonly (string | null)[],
): LayoutInput {
  const wanted = new Set(treeIds)
  const members = allMembers.filter((m) => wanted.has(m.tree_id ?? null))
  const ids = new Set(members.map((m) => m.id))
  const relationships = allRelationships.filter(
    (r) => ids.has(r.member_a_id) && ids.has(r.member_b_id),
  )
  return { members, relationships }
}
