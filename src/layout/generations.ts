// ─────────────────────────────────────────────────────────────────────
// Generation solver.
//
// Works on the unit DAG (placement edges + secondary parent edges, so a
// child always sits below ALL of its recorded parents). Couples are one
// unit, so spouse generation equality is free — no fixpoint loops, no
// iteration caps. Termination is guaranteed structurally:
//
//   1. Explicit cycle detection (iterative DFS). Each edge that closes
//      a cycle is REMOVED from the solver and reported as an issue —
//      and when it is a placement edge it is also removed from the
//      placement tree so the placement pass cannot recurse forever.
//   2. Longest-path layering over a topological order of the remaining
//      acyclic graph: gen(child) = max(gen(parents)) + 1.
// ─────────────────────────────────────────────────────────────────────

import type { FamilyGraph, LayoutIssue, UnitId } from './types'

export interface GenerationSolution {
  /** Generation per unit, normalized so the minimum is 0. */
  genOfUnit: Map<UnitId, number>
  issues: LayoutIssue[]
}

interface ConstraintEdge {
  parentUnit: UnitId
  childUnit: UnitId
  /** Placement edges shape the tree; secondary edges only constrain rows. */
  placement: boolean
}

/**
 * Solves generations AND sanitizes `graph` in place: any placement edge
 * that closes a cycle is removed from `parentUnitOf`/`childUnitsOf`.
 */
export function solveGenerations(graph: FamilyGraph): GenerationSolution {
  const issues: LayoutIssue[] = []

  // ── Collect constraint edges ──────────────────────────────────────
  const edges: ConstraintEdge[] = []
  const edgeKeys = new Set<string>()
  const pushEdge = (parentUnit: UnitId, childUnit: UnitId, placement: boolean) => {
    if (parentUnit === childUnit) return
    const key = `${parentUnit}>${childUnit}`
    if (edgeKeys.has(key)) {
      // A secondary edge duplicating a placement edge adds nothing.
      if (placement) for (const e of edges) if (`${e.parentUnit}>${e.childUnit}` === key) e.placement = true
      return
    }
    edgeKeys.add(key)
    edges.push({ parentUnit, childUnit, placement })
  }

  for (const [childUnit, parentUnit] of graph.parentUnitOf) pushEdge(parentUnit, childUnit, true)
  for (const { parentId, childId } of graph.secondaryParentEdges) {
    const pu = graph.unitOfMember.get(parentId)
    const cu = graph.unitOfMember.get(childId)
    if (pu && cu) pushEdge(pu, cu, false)
  }

  // ── Cycle detection (iterative DFS, deterministic order) ──────────
  const childrenByUnit = new Map<UnitId, ConstraintEdge[]>()
  for (const e of edges) {
    const list = childrenByUnit.get(e.parentUnit) ?? []
    list.push(e)
    childrenByUnit.set(e.parentUnit, list)
  }
  for (const list of childrenByUnit.values()) {
    list.sort((a, b) => (a.childUnit < b.childUnit ? -1 : a.childUnit > b.childUnit ? 1 : 0))
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<UnitId, number>()
  const removedEdges = new Set<ConstraintEdge>()
  const unitIds = graph.units.map((u) => u.id)

  for (const start of unitIds) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue
    // Explicit stack of (unit, next child index) — no recursion, no
    // depth limits, works on 1000+ generation chains.
    const stack: Array<{ unit: UnitId; idx: number }> = [{ unit: start, idx: 0 }]
    color.set(start, GRAY)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const kids = childrenByUnit.get(frame.unit) ?? []
      if (frame.idx >= kids.length) {
        color.set(frame.unit, BLACK)
        stack.pop()
        continue
      }
      const edge = kids[frame.idx++]
      if (removedEdges.has(edge)) continue
      const next = edge.childUnit
      const c = color.get(next) ?? WHITE
      if (c === GRAY) {
        // Back edge — closes a cycle. Remove it from the solver (and
        // from the placement tree when applicable) and report.
        removedEdges.add(edge)
        const parentMembers = graph.unitById.get(edge.parentUnit)?.members ?? []
        const childMembers = graph.unitById.get(edge.childUnit)?.members ?? []
        const names = [...parentMembers, ...childMembers]
          .map((m) => `${m.first_name} ${m.last_name}`.trim())
          .join(', ')
        issues.push({
          kind: 'cycle',
          memberIds: [...parentMembers, ...childMembers].map((m) => m.id),
          message: `Circular parent-child chain detected involving ${names}; one link was ignored for layout`,
        })
        if (edge.placement) {
          graph.parentUnitOf.delete(edge.childUnit)
          const siblings = graph.childUnitsOf.get(edge.parentUnit)
          if (siblings) {
            const idx = siblings.indexOf(edge.childUnit)
            if (idx >= 0) siblings.splice(idx, 1)
            if (siblings.length === 0) graph.childUnitsOf.delete(edge.parentUnit)
          }
        }
        continue
      }
      if (c === WHITE) {
        color.set(next, GRAY)
        stack.push({ unit: next, idx: 0 })
      }
    }
  }

  // ── Longest-path layering over the (now acyclic) graph ────────────
  const live = edges.filter((e) => !removedEdges.has(e))
  const indegree = new Map<UnitId, number>()
  const childrenLive = new Map<UnitId, ConstraintEdge[]>()
  for (const id of unitIds) indegree.set(id, 0)
  for (const e of live) {
    indegree.set(e.childUnit, (indegree.get(e.childUnit) ?? 0) + 1)
    const list = childrenLive.get(e.parentUnit) ?? []
    list.push(e)
    childrenLive.set(e.parentUnit, list)
  }

  const genOfUnit = new Map<UnitId, number>()
  const queue: UnitId[] = unitIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort()
  for (const id of queue) genOfUnit.set(id, 0)
  let head = 0
  while (head < queue.length) {
    const u = queue[head++]
    const gu = genOfUnit.get(u) ?? 0
    for (const e of childrenLive.get(u) ?? []) {
      const want = gu + 1
      if ((genOfUnit.get(e.childUnit) ?? 0) < want) genOfUnit.set(e.childUnit, want)
      const d = (indegree.get(e.childUnit) ?? 1) - 1
      indegree.set(e.childUnit, d)
      if (d === 0) queue.push(e.childUnit)
    }
  }
  // Safety net: anything not reached (shouldn't happen post-cycle-removal)
  // gets generation 0 rather than being lost.
  for (const id of unitIds) if (!genOfUnit.has(id)) genOfUnit.set(id, 0)

  // ── Pull sources down toward their children ───────────────────────
  // Longest-path layering puts every source at row 0, but a unit whose
  // only tie to the tree is being someone's (secondary) parent should
  // sit one row ABOVE its shallowest child, not at the very top.
  // gen = min(childGen) - 1 keeps every parent-above-child constraint.
  for (const id of unitIds) {
    const out = childrenLive.get(id) ?? []
    if (out.length === 0) continue
    const hasIncoming = live.some((e) => e.childUnit === id)
    if (hasIncoming) continue
    let minChild = Infinity
    for (const e of out) minChild = Math.min(minChild, genOfUnit.get(e.childUnit) ?? 0)
    if (Number.isFinite(minChild)) genOfUnit.set(id, Math.max(0, minChild - 1))
  }

  return { genOfUnit, issues }
}
