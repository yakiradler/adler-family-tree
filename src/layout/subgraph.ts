// ─────────────────────────────────────────────────────────────────────
// Focused-view subgraph extraction.
//
// The focused 3-generation view is NOT a separate layout engine — it is
// the same computeLayout fed a small input: the focus person, their
// ancestors/descendants up to a depth, siblings, and current spouses of
// everyone included.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship } from '../types'
import type { LayoutInput } from './types'

export interface FocusedSubgraphOptions {
  /** How many ancestor generations to include (default 2). */
  ancestorDepth?: number
  /** How many descendant generations to include (default 2). */
  descendantDepth?: number
}

export function extractFocusedInput(
  focusId: string,
  members: Member[],
  relationships: Relationship[],
  options: FocusedSubgraphOptions = {},
): LayoutInput {
  const ancestorDepth = options.ancestorDepth ?? 2
  const descendantDepth = options.descendantDepth ?? 2

  const memberById = new Map(members.map((m) => [m.id, m]))
  if (!memberById.has(focusId)) return { members: [], relationships: [] }

  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()
  for (const r of relationships) {
    if (!memberById.has(r.member_a_id) || !memberById.has(r.member_b_id)) continue
    if (r.type === 'parent-child') {
      parentsOf.set(r.member_b_id, [...(parentsOf.get(r.member_b_id) ?? []), r.member_a_id])
      childrenOf.set(r.member_a_id, [...(childrenOf.get(r.member_a_id) ?? []), r.member_b_id])
    } else if (r.type === 'spouse' && (r.status ?? 'current') === 'current') {
      spousesOf.set(r.member_a_id, [...(spousesOf.get(r.member_a_id) ?? []), r.member_b_id])
      spousesOf.set(r.member_b_id, [...(spousesOf.get(r.member_b_id) ?? []), r.member_a_id])
    }
  }

  const included = new Set<string>([focusId])

  // Ancestors (visited-guarded — safe on cyclic data).
  let frontier = [focusId]
  for (let depth = 0; depth < ancestorDepth; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const p of parentsOf.get(id) ?? []) {
        if (!included.has(p)) {
          included.add(p)
          next.push(p)
        }
      }
    }
    frontier = next
  }

  // Siblings: all children of the focus person's parents.
  for (const p of parentsOf.get(focusId) ?? []) {
    for (const c of childrenOf.get(p) ?? []) included.add(c)
  }

  // Descendants.
  frontier = [focusId]
  for (let depth = 0; depth < descendantDepth; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const c of childrenOf.get(id) ?? []) {
        if (!included.has(c)) {
          included.add(c)
          next.push(c)
        }
      }
    }
    frontier = next
  }

  // Current spouses of everyone in scope (so couples render whole).
  for (const id of [...included]) {
    for (const s of spousesOf.get(id) ?? []) included.add(s)
  }

  const subMembers = members.filter((m) => included.has(m.id))
  const subIds = new Set(subMembers.map((m) => m.id))
  const subRelationships = relationships.filter(
    (r) => subIds.has(r.member_a_id) && subIds.has(r.member_b_id),
  )
  return { members: subMembers, relationships: subRelationships }
}
