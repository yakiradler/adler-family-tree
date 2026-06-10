// ─────────────────────────────────────────────────────────────────────
// computeLayout — the ONE entry point of the family-tree layout engine.
//
//   filtered members + relationships
//        │
//        ▼
//   buildFamilyGraph   couples/singles as units, placement parents,
//        │             secondary edges, demoted bad data → issues
//        ▼
//   solveGenerations   cycle-proof row assignment per unit
//        │
//        ▼
//   placeUnits         contour placement — symmetric, overlap-free
//        │
//        ▼
//   buildConnectors    anchor-exact lines, gutter rails, row Y solve
//        │
//        ▼
//   LayoutResult       nodes + edges + bounds + generationRows + issues
//
// Pure computation: no store access, no DB access, no side effects.
// The same function serves the full tree, the focused subgraph view,
// filtered views, and (via compose.ts) the future combined-trees view.
// ─────────────────────────────────────────────────────────────────────

import { CARD, GAPS } from './metrics'
import { buildFamilyGraph } from './buildGraph'
import { solveGenerations } from './generations'
import { placeUnits } from './placement'
import { buildConnectors } from './connectors'
import type { LayoutInput, LayoutOptions, LayoutResult, PlacedNode } from './types'

export function computeLayout(input: LayoutInput, options: LayoutOptions = {}): LayoutResult {
  if (input.members.length === 0) {
    return {
      nodes: [],
      edges: [],
      bounds: { width: 0, height: 0 },
      generationRows: [],
      issues: [],
      satelliteUnitIds: [],
      badgeOnlyMembers: [],
      coupleGaps: {},
    }
  }

  const graph = buildFamilyGraph(input, options)
  const gens = solveGenerations(graph)
  const placement = placeUnits(graph, gens)

  // Normalize x so the leftmost card sits at CANVAS_PAD.
  let minX = Infinity
  for (const x of placement.xOfMember.values()) minX = Math.min(minX, x)
  const dx = Number.isFinite(minX) ? GAPS.CANVAS_PAD - minX : 0
  if (dx !== 0) {
    for (const [id, x] of placement.xOfMember) placement.xOfMember.set(id, x + dx)
    for (const [id, c] of placement.centerOfUnit) placement.centerOfUnit.set(id, c + dx)
  }

  const connectors = buildConnectors(graph, gens, placement)

  const nodes: PlacedNode[] = []
  for (const unit of graph.units) {
    const isOrphan = graph.orphanUnitIds.has(unit.id)
    const generation = gens.genOfUnit.get(unit.id) ?? 0
    for (const m of unit.members) {
      const x = placement.xOfMember.get(m.id)
      const y = connectors.yOfMember.get(m.id)
      if (x == null || y == null) continue // impossible; surfaced via issues below
      const partners = graph.secondaryPartnersOf.get(m.id)
      nodes.push({
        member: m,
        x,
        y,
        generation,
        unitId: unit.id,
        section: isOrphan ? 'orphans' : 'tree',
        secondaryPartners: partners && partners.length > 0 ? partners : undefined,
      })
    }
  }

  const issues = [...graph.issues, ...gens.issues, ...connectors.issues]
  // "Placed correctly or explicitly reported" — never silently dropped.
  // (Badge-only ex-partners are intentionally card-less: they render as
  // the small badge beneath their former partner.)
  const placedIds = new Set(nodes.map((n) => n.member.id))
  const missing = input.members.filter(
    (m) => !placedIds.has(m.id) && !graph.badgeOnlyMemberIds.has(m.id),
  )
  if (missing.length > 0) {
    issues.push({
      kind: 'unplaced',
      memberIds: missing.map((m) => m.id),
      message: `${missing.length} member(s) could not be placed`,
    })
  }

  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + CARD.W)
    const extraH = n.secondaryPartners ? GAPS.BADGE_ROW_H : 0
    maxY = Math.max(maxY, n.y + CARD.H + extraH)
  }

  return {
    nodes,
    edges: connectors.edges,
    bounds: {
      width: nodes.length > 0 ? maxX + GAPS.CANVAS_PAD : 0,
      height: nodes.length > 0 ? maxY + GAPS.CANVAS_PAD : 0,
    },
    generationRows: connectors.generationRows,
    issues,
    satelliteUnitIds: graph.satellites.map((s) => s.unitId).sort(),
    badgeOnlyMembers: [...graph.badgeOnlyMemberIds].sort(),
    coupleGaps: placement.coupleGaps,
  }
}

// Re-exports: everything a consumer needs comes from 'src/layout'.
export { CARD, CARD_BODY_H, GAPS, AVATAR_CENTER_Y, RING_OUTER_HALF, anchor } from './metrics'
export type { AnchorKind, Point } from './metrics'
export type {
  FamilyEdge,
  FamilyGraph,
  GenerationRow,
  LayoutEdge,
  LayoutInput,
  LayoutIssue,
  LayoutOptions,
  LayoutResult,
  PlacedNode,
  SecondaryParentEdge,
  SecondaryPartner,
  SpouseEdge,
  Unit,
  UnitId,
} from './types'
export { buildFamilyGraph, compareSiblings, unitIdOf } from './buildGraph'
export { solveGenerations } from './generations'
export type { GenerationSolution } from './generations'
export { placeUnits } from './placement'
export { buildConnectors } from './connectors'
export { validateLayout } from './validate'
export type { LayoutViolation } from './validate'
export { selectTreeGraph } from './selectTreeGraph'
export { extractFocusedInput } from './subgraph'
export type { FocusedSubgraphOptions } from './subgraph'
export { composeLayouts } from './compose'
export type { CompositeLayout, ComposedTree } from './compose'
