// ─────────────────────────────────────────────────────────────────────
// Types shared by the layout engine and its consumers.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship, SpouseStatus } from '../types'
import type { Point, AnchorKind } from './metrics'

/** Stable identifier for a layout unit: sorted member ids joined by '+'. */
export type UnitId = string

/**
 * Ex / deceased partner surfaced as a small badge beneath a card.
 * `status: 'current'` only appears in the malformed-data case of more
 * than one current spouse — the extra partners are demoted to badges
 * and a `multiple-current-spouses` issue is reported.
 */
export interface SecondaryPartner {
  member: Member
  status: SpouseStatus
}

/**
 * A placement unit — one card (single person) or two cards placed
 * atomically side by side (a current-spouse couple).
 */
export interface Unit {
  id: UnitId
  /** Visual order: [left] or [left, right] (father left, mother right). */
  members: Member[]
  /**
   * The bloodline anchor: the spouse whose parents this unit is placed
   * under. For singles, the member itself.
   */
  primary: Member
}

/**
 * Data problem discovered while building the layout. The engine never
 * throws and never hangs on bad data — it reports and carries on with
 * the edge/member excluded or demoted.
 */
export interface LayoutIssue {
  kind:
    | 'cycle'
    | 'multiple-current-spouses'
    | 'invalid-edge'
    | 'unroutable-edge'
    | 'unplaced'
  memberIds: string[]
  /** Human-readable English detail (UI translates by `kind`). */
  message: string
}

/** A positioned card. `x`/`y` are the card's top-left, canvas coords. */
export interface PlacedNode {
  member: Member
  x: number
  y: number
  generation: number
  unitId: UnitId
  section: 'tree' | 'orphans'
  secondaryPartners?: SecondaryPartner[]
}

interface EdgeEndpoint {
  memberId: string
  point: Point
  anchorKind: AnchorKind
}

/** Straight segment used for validation (corner arcs are approximated). */
export type Segment = readonly [Point, Point]

interface EdgeBase {
  /** Full SVG path. */
  d: string
  /** Card-touching endpoints (validated against `anchor()`). */
  endpoints: EdgeEndpoint[]
  /** Straight-line approximation of the path, for validation. */
  segments: Segment[]
}

/** Horizontal line between the two cards of a couple. */
export interface SpouseEdge extends EdgeBase {
  kind: 'spouse'
  aId: string
  bId: string
}

/** Trunk + rail + per-child drops for one sibling group. */
export interface FamilyEdge extends EdgeBase {
  kind: 'family'
  parentUnitId: UnitId
  childIds: string[]
}

/**
 * Dashed link from a non-placement parent (e.g. a divorced father whose
 * children are anchored under the mother) to one child.
 */
export interface SecondaryParentEdge extends EdgeBase {
  kind: 'secondary-parent'
  parentId: string
  childId: string
}

export type LayoutEdge = SpouseEdge | FamilyEdge | SecondaryParentEdge

export interface GenerationRow {
  generation: number
  /** Top y of the row's cards. */
  y: number
  /** Card band height (CARD.H, plus badge row when present). */
  height: number
}

export interface LayoutResult {
  nodes: PlacedNode[]
  edges: LayoutEdge[]
  /** Always finite; includes CANVAS_PAD on all sides. */
  bounds: { width: number; height: number }
  generationRows: GenerationRow[]
  issues: LayoutIssue[]
}

export interface LayoutInput {
  members: Member[]
  relationships: Relationship[]
}

export interface LayoutOptions {
  /** Surface ex/deceased partners as badges beneath their card. */
  showFormerSpouses?: boolean
}

// ─── Internal graph model (buildGraph → generations → placement) ─────

export interface FamilyGraph {
  memberById: Map<string, Member>
  units: Unit[]
  unitById: Map<UnitId, Unit>
  unitOfMember: Map<string, UnitId>
  /** Raw parent member ids per child member id (deduped, validated). */
  parentsOf: Map<string, string[]>
  /** Raw child member ids per parent member id. */
  childrenOf: Map<string, string[]>
  /** The single placement parent chosen for each child member. */
  placementParentOf: Map<string, string>
  /** Child units anchored under each parent unit, in sibling order. */
  childUnitsOf: Map<UnitId, UnitId[]>
  /** Placement parent unit of each child unit. */
  parentUnitOf: Map<UnitId, UnitId>
  /** Parent→child links that are real but don't drive placement. */
  secondaryParentEdges: Array<{ parentId: string; childId: string }>
  secondaryPartnersOf: Map<string, SecondaryPartner[]>
  /** Single-member units with no family edges at all. */
  orphanUnitIds: Set<UnitId>
  issues: LayoutIssue[]
}
