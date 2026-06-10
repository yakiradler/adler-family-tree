// ─────────────────────────────────────────────────────────────────────
// Connector geometry + vertical row solver.
//
// Produces every line the renderer draws, with the GUARANTEE that each
// endpoint lies exactly on a card anchor (metrics.anchor) and that no
// segment crosses a card:
//
//   • spouse lines exist ONLY between the two adjacent cards of a
//     couple unit — a viewport-spanning spouse line is impossible;
//   • family rails (trunk + horizontal rail + per-child drops) live
//     strictly inside the inter-generation gutter band. Rails whose
//     x-spans overlap in the same gutter get separate vertical lanes,
//     and the gutter is GROWN to fit its lanes — lines never graze
//     cards or each other;
//   • secondary-parent links (the non-placement parent) are routed in
//     gutters and, when they span multiple generations, through a
//     vertical corridor that is verified free of cards in every row it
//     crosses. If no clean route exists the edge is NOT drawn and an
//     `unroutable-edge` issue is reported — never a line through a card.
//
// Row Y positions are solved here too, because gutter heights depend on
// how many connector lanes each gutter needs.
// ─────────────────────────────────────────────────────────────────────

import { AVATAR_CENTER_Y, CARD, GAPS, anchor, type Point } from './metrics'
import type {
  FamilyEdge,
  FamilyGraph,
  GenerationRow,
  LayoutEdge,
  LayoutIssue,
  Segment,
  SpouseEdge,
  UnitId,
} from './types'
import type { GenerationSolution } from './generations'
import type { PlacementResult } from './placement'

export interface ConnectorResult {
  edges: LayoutEdge[]
  generationRows: GenerationRow[]
  /** Top y of the orphan row (below the deepest generation). */
  orphanRowY: number
  yOfMember: Map<string, number>
  issues: LayoutIssue[]
}

/** Horizontal run that needs a vertical lane inside a gutter. */
interface LaneRequest {
  /** Sort/tie-break key, stable across runs. */
  key: string
  x1: number
  x2: number
  lane: number
}

const CORRIDOR_MIN_WIDTH = 12
const CARD_CLEARANCE = 6

export function buildConnectors(
  graph: FamilyGraph,
  gens: GenerationSolution,
  placement: PlacementResult,
): ConnectorResult {
  const issues: LayoutIssue[] = []
  const { genOfUnit } = gens
  const { xOfMember, centerOfUnit, maxGeneration } = placement

  const genOfMember = (id: string): number => {
    const u = graph.unitOfMember.get(id)
    return u != null ? genOfUnit.get(u) ?? 0 : 0
  }
  const isOrphanMember = (id: string): boolean => {
    const u = graph.unitOfMember.get(id)
    return u != null && graph.orphanUnitIds.has(u)
  }

  // ── Row card-band heights (badges extend the band) ────────────────
  const rowHasBadges = new Array<boolean>(maxGeneration + 1).fill(false)
  for (const unit of graph.units) {
    if (graph.orphanUnitIds.has(unit.id)) continue
    const g = genOfUnit.get(unit.id) ?? 0
    if (unit.members.some((m) => (graph.secondaryPartnersOf.get(m.id)?.length ?? 0) > 0)) {
      rowHasBadges[g] = true
    }
  }
  const rowHeight = (g: number): number =>
    CARD.H + (rowHasBadges[g] ? GAPS.BADGE_ROW_H : 0)

  // ── Occupied x-intervals per row (for corridor routing) ───────────
  const occupiedByRow = new Map<number, Array<[number, number]>>()
  for (const unit of graph.units) {
    if (graph.orphanUnitIds.has(unit.id)) continue
    const g = genOfUnit.get(unit.id) ?? 0
    const list = occupiedByRow.get(g) ?? []
    for (const m of unit.members) {
      const x = xOfMember.get(m.id)
      if (x == null) continue
      list.push([x - CARD_CLEARANCE, x + CARD.W + CARD_CLEARANCE])
    }
    occupiedByRow.set(g, list)
  }
  for (const list of occupiedByRow.values()) list.sort((a, b) => a[0] - b[0])

  /**
   * Finds an x that is card-free in every row of [genFrom..genTo],
   * as close as possible to `desiredX`. Returns null when no corridor
   * of CORRIDOR_MIN_WIDTH exists.
   */
  function findCorridor(genFrom: number, genTo: number, desiredX: number): number | null {
    // Free intervals = complement of the union of occupied intervals
    // across all crossed rows (conservative but always card-free).
    const all: Array<[number, number]> = []
    for (let g = genFrom; g <= genTo; g++) {
      for (const iv of occupiedByRow.get(g) ?? []) all.push(iv)
    }
    all.sort((a, b) => a[0] - b[0])
    const mergedOcc: Array<[number, number]> = []
    for (const iv of all) {
      const last = mergedOcc[mergedOcc.length - 1]
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
      else mergedOcc.push([iv[0], iv[1]])
    }
    // Candidate corridors: gaps between merged occupied blocks (+ the
    // open space on both outer sides).
    const candidates: Array<[number, number]> = []
    let cursor = -Infinity
    for (const [s, e] of mergedOcc) {
      if (s - cursor >= CORRIDOR_MIN_WIDTH) candidates.push([cursor, s])
      cursor = Math.max(cursor, e)
    }
    candidates.push([cursor, Infinity])
    let best: number | null = null
    let bestDist = Infinity
    for (const [s, e] of candidates) {
      if (e - s < CORRIDOR_MIN_WIDTH) continue
      const lo = s === -Infinity ? e - 1e6 : s + CORRIDOR_MIN_WIDTH / 2
      const hi = e === Infinity ? s + 1e6 : e - CORRIDOR_MIN_WIDTH / 2
      const x = Math.min(Math.max(desiredX, lo), hi)
      const dist = Math.abs(x - desiredX)
      if (dist < bestDist) {
        bestDist = dist
        best = x
      }
    }
    return best
  }

  // ── Plan all horizontal gutter runs (lanes assigned per gutter) ───
  // Gutter g = vertical band between row g and row g+1.
  interface FamilyPlan {
    parentUnitId: UnitId
    trunkX: number
    trunkFromCoupleMidline: boolean
    parentGen: number
    railGutter: number
    childIds: string[]
    laneReq: LaneRequest
    /** Extra corridor hops for trunk/children crossing multiple rows. */
    trunkCorridorX: number | null
    deepChildren: Array<{ childId: string; corridorX: number; laneReqs: LaneRequest[] }>
  }
  interface SecondaryPlan {
    parentId: string
    childId: string
    corridorX: number | null
    laneReqs: LaneRequest[] // one (adjacent) or two (deep) horizontal runs
  }

  const laneRequestsByGutter = new Map<number, LaneRequest[]>()
  const addLaneRequest = (gutter: number, key: string, x1: number, x2: number): LaneRequest => {
    const req: LaneRequest = { key, x1: Math.min(x1, x2), x2: Math.max(x1, x2), lane: 0 }
    const list = laneRequestsByGutter.get(gutter) ?? []
    list.push(req)
    laneRequestsByGutter.set(gutter, list)
    return req
  }

  const familyPlans: FamilyPlan[] = []
  for (const [parentUnitId, childUnits] of [...graph.childUnitsOf.entries()].sort()) {
    const parentUnit = graph.unitById.get(parentUnitId)
    if (!parentUnit || childUnits.length === 0) continue
    const parentGen = genOfUnit.get(parentUnitId) ?? 0
    const trunkX = centerOfUnit.get(parentUnitId) ?? 0
    const trunkFromCoupleMidline = parentUnit.members.length === 2

    // The rail sits in the gutter just above the SHALLOWEST child.
    const childInfos = childUnits
      .map((cu) => graph.unitById.get(cu)!)
      .map((u) => ({ id: u.primary.id, gen: genOfUnit.get(u.id) ?? 0 }))
    const railGutter = Math.min(...childInfos.map((c) => c.gen)) - 1

    const dropXs = childInfos.map((c) => {
      const x = xOfMember.get(c.id)
      return x != null ? x + CARD.W / 2 : trunkX
    })
    const laneReq = addLaneRequest(
      railGutter,
      `fam:${parentUnitId}`,
      Math.min(trunkX, ...dropXs),
      Math.max(trunkX, ...dropXs),
    )

    // Trunk crossing intermediate rows (parent more than one row above
    // the rail) needs a verified-free corridor.
    let trunkCorridorX: number | null = null
    if (parentGen < railGutter) {
      trunkCorridorX = findCorridor(parentGen + 1, railGutter, trunkX)
      if (trunkCorridorX == null) {
        issues.push({
          kind: 'unroutable-edge',
          memberIds: [parentUnit.primary.id],
          message: `No free corridor for the family line of ${parentUnit.primary.first_name} ${parentUnit.primary.last_name}`,
        })
      } else {
        addLaneRequest(parentGen, `famtrunk:${parentUnitId}`, trunkX, trunkCorridorX)
        if (trunkCorridorX !== trunkX) {
          // Horizontal hop from corridor onto the rail happens at rail
          // level inside the rail's own lane request span.
          laneReq.x1 = Math.min(laneReq.x1, trunkCorridorX)
          laneReq.x2 = Math.max(laneReq.x2, trunkCorridorX)
        }
      }
    }

    // Children deeper than the rail's row need their own corridor.
    const deepChildren: FamilyPlan['deepChildren'] = []
    childInfos.forEach((c, i) => {
      if (c.gen === railGutter + 1) return
      const corridorX = findCorridor(railGutter + 1, c.gen - 1, dropXs[i])
      if (corridorX == null) {
        issues.push({
          kind: 'unroutable-edge',
          memberIds: [c.id],
          message: `No free corridor for the line down to ${graph.memberById.get(c.id)?.first_name ?? '?'}`,
        })
        return
      }
      const reqs: LaneRequest[] = [
        addLaneRequest(c.gen - 1, `famdeep:${parentUnitId}:${c.id}`, corridorX, dropXs[i]),
      ]
      laneReq.x1 = Math.min(laneReq.x1, corridorX)
      laneReq.x2 = Math.max(laneReq.x2, corridorX)
      deepChildren.push({ childId: c.id, corridorX, laneReqs: reqs })
    })

    familyPlans.push({
      parentUnitId,
      trunkX,
      trunkFromCoupleMidline,
      parentGen,
      railGutter,
      childIds: childInfos.map((c) => c.id),
      laneReq,
      trunkCorridorX,
      deepChildren,
    })
  }

  const secondaryPlans: SecondaryPlan[] = []
  for (const { parentId, childId } of [...graph.secondaryParentEdges].sort((a, b) =>
    `${a.parentId}>${a.childId}` < `${b.parentId}>${b.childId}` ? -1 : 1,
  )) {
    if (isOrphanMember(parentId) || isOrphanMember(childId)) continue
    const gp = genOfMember(parentId)
    const gc = genOfMember(childId)
    const px = xOfMember.get(parentId)
    const cx = xOfMember.get(childId)
    if (px == null || cx == null) continue
    if (gc <= gp) {
      issues.push({
        kind: 'unroutable-edge',
        memberIds: [parentId, childId],
        message: `Parent ${graph.memberById.get(parentId)?.first_name ?? '?'} is not above child ${graph.memberById.get(childId)?.first_name ?? '?'} — link not drawn`,
      })
      continue
    }
    const srcX = px + CARD.W / 2
    const dstX = cx + CARD.W / 2 + GAPS.SECONDARY_DROP_OFFSET
    if (gc === gp + 1) {
      secondaryPlans.push({
        parentId,
        childId,
        corridorX: null,
        laneReqs: [addLaneRequest(gp, `sec:${parentId}:${childId}`, srcX, dstX)],
      })
      continue
    }
    const corridorX = findCorridor(gp + 1, gc - 1, (srcX + dstX) / 2)
    if (corridorX == null) {
      issues.push({
        kind: 'unroutable-edge',
        memberIds: [parentId, childId],
        message: `No free corridor between ${graph.memberById.get(parentId)?.first_name ?? '?'} and ${graph.memberById.get(childId)?.first_name ?? '?'}`,
      })
      continue
    }
    secondaryPlans.push({
      parentId,
      childId,
      corridorX,
      laneReqs: [
        addLaneRequest(gp, `sec1:${parentId}:${childId}`, srcX, corridorX),
        addLaneRequest(gc - 1, `sec2:${parentId}:${childId}`, corridorX, dstX),
      ],
    })
  }

  // ── Lane assignment: greedy interval coloring per gutter ──────────
  const lanesPerGutter = new Map<number, number>()
  for (const [gutter, reqs] of laneRequestsByGutter) {
    reqs.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2 || (a.key < b.key ? -1 : 1))
    const laneEnds: number[] = [] // rightmost x occupied per lane
    for (const req of reqs) {
      let lane = laneEnds.findIndex((end) => req.x1 > end + GAPS.SIBLING / 2)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(-Infinity)
      }
      req.lane = lane
      laneEnds[lane] = Math.max(laneEnds[lane], req.x2)
    }
    lanesPerGutter.set(gutter, laneEnds.length)
  }
  const gutterHeight = (g: number): number => {
    const lanes = lanesPerGutter.get(g) ?? 0
    return Math.max(
      GAPS.GUTTER_MIN,
      GAPS.RAIL_TOP_PAD + Math.max(0, lanes - 1) * GAPS.RAIL_LANE_STEP + GAPS.RAIL_TOP_PAD,
    )
  }

  // ── Solve row Y positions ──────────────────────────────────────────
  const rowY = new Array<number>(maxGeneration + 1).fill(GAPS.CANVAS_PAD)
  for (let g = 1; g <= maxGeneration; g++) {
    rowY[g] = rowY[g - 1] + rowHeight(g - 1) + gutterHeight(g - 1)
  }
  const orphanRowY =
    rowY[maxGeneration] + rowHeight(maxGeneration) + Math.max(GAPS.GUTTER_MIN, gutterHeight(maxGeneration))

  const generationRows: GenerationRow[] = []
  for (let g = 0; g <= maxGeneration; g++) {
    generationRows.push({ generation: g, y: rowY[g], height: rowHeight(g) })
  }

  const yOfMember = new Map<string, number>()
  for (const unit of graph.units) {
    const y = graph.orphanUnitIds.has(unit.id) ? orphanRowY : rowY[genOfUnit.get(unit.id) ?? 0]
    for (const m of unit.members) yOfMember.set(m.id, y)
  }

  const laneY = (gutter: number, lane: number): number =>
    rowY[gutter] + rowHeight(gutter) + GAPS.RAIL_TOP_PAD + lane * GAPS.RAIL_LANE_STEP

  // ── Path emission helpers ──────────────────────────────────────────
  const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()

  /**
   * Orthogonal polyline → SVG path with rounded elbows + straight
   * segments for validation. Points must alternate V/H direction.
   */
  function orthoPath(points: Point[]): { d: string; segments: Segment[] } {
    const segments: Segment[] = []
    for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]])
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const next = points[i + 1]
      if (!next) {
        d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`
        break
      }
      // Rounded elbow at `cur` between prev→cur and cur→next.
      const inDx = Math.sign(cur.x - prev.x)
      const inDy = Math.sign(cur.y - prev.y)
      const outDx = Math.sign(next.x - cur.x)
      const outDy = Math.sign(next.y - cur.y)
      const inLen = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)
      const outLen = Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y)
      const r = Math.min(GAPS.CORNER, inLen / 2, outLen / 2)
      if (r < 0.5 || (inDx === outDx && inDy === outDy)) {
        d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`
        continue
      }
      const beforeX = cur.x - inDx * r
      const beforeY = cur.y - inDy * r
      const afterX = cur.x + outDx * r
      const afterY = cur.y + outDy * r
      d += ` L ${fmt(beforeX)} ${fmt(beforeY)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(afterX)} ${fmt(afterY)}`
    }
    return { d, segments }
  }

  // ── Emit edges ─────────────────────────────────────────────────────
  const edges: LayoutEdge[] = []

  // Spouse lines — only between the two cards of a couple unit.
  for (const unit of graph.units) {
    if (unit.members.length !== 2) continue
    const [left, right] = unit.members
    const lx = xOfMember.get(left.id)
    const rx = xOfMember.get(right.id)
    const y = yOfMember.get(left.id)
    if (lx == null || rx == null || y == null) continue
    const from = anchor({ x: lx, y }, 'spouse-right')
    const to = anchor({ x: rx, y }, 'spouse-left')
    const edge: SpouseEdge = {
      kind: 'spouse',
      aId: left.id,
      bId: right.id,
      d: `M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(to.x)} ${fmt(to.y)}`,
      endpoints: [
        { memberId: left.id, point: from, anchorKind: 'spouse-right' },
        { memberId: right.id, point: to, anchorKind: 'spouse-left' },
      ],
      segments: [[from, to]],
    }
    edges.push(edge)
  }

  // Family rails.
  for (const plan of familyPlans) {
    const parentUnit = graph.unitById.get(plan.parentUnitId)!
    const parentY = rowY[plan.parentGen]
    const railY = laneY(plan.railGutter, plan.laneReq.lane)

    // Trunk source: couple → midpoint of the spouse line (drops through
    // the couple gap, card-free by construction); single → bottom anchor.
    const src: Point = plan.trunkFromCoupleMidline
      ? { x: plan.trunkX, y: parentY + AVATAR_CENTER_Y }
      : { x: plan.trunkX, y: parentY + CARD.H }
    const srcEndpoints = plan.trunkFromCoupleMidline
      ? []
      : [
          {
            memberId: parentUnit.members[0].id,
            point: src,
            anchorKind: 'bottom' as const,
          },
        ]

    // Trunk route down to rail level (possibly via corridor).
    const trunkPoints: Point[] = [src]
    let railEntryX = plan.trunkX
    if (plan.parentGen < plan.railGutter && plan.trunkCorridorX != null) {
      const hopY = laneY(plan.parentGen, plan.laneReq.lane) // own lane reserved via famtrunk request
      // Use the famtrunk request's actual lane:
      const trunkReq = (laneRequestsByGutter.get(plan.parentGen) ?? []).find(
        (r) => r.key === `famtrunk:${plan.parentUnitId}`,
      )
      const realHopY = trunkReq ? laneY(plan.parentGen, trunkReq.lane) : hopY
      trunkPoints.push({ x: src.x, y: realHopY })
      trunkPoints.push({ x: plan.trunkCorridorX, y: realHopY })
      railEntryX = plan.trunkCorridorX
    }
    trunkPoints.push({ x: railEntryX, y: railY })

    const allD: string[] = []
    const allSegments: Segment[] = []
    const endpoints: FamilyEdge['endpoints'] = [...srcEndpoints]

    for (let i = 0; i < plan.childIds.length; i++) {
      const childId = plan.childIds[i]
      const cx = xOfMember.get(childId)
      const cyTop = yOfMember.get(childId)
      if (cx == null || cyTop == null) continue
      const childGen = genOfMember(childId)
      const dropX = cx + CARD.W / 2
      const target = anchor({ x: cx, y: cyTop }, 'top')

      let points: Point[]
      const deep = plan.deepChildren.find((dc) => dc.childId === childId)
      if (childGen === plan.railGutter + 1) {
        points = [...trunkPoints, { x: dropX, y: railY }, target]
      } else if (deep) {
        const lowReq = deep.laneReqs[0]
        const lowY = laneY(childGen - 1, lowReq.lane)
        points = [
          ...trunkPoints,
          { x: deep.corridorX, y: railY },
          { x: deep.corridorX, y: lowY },
          { x: dropX, y: lowY },
          target,
        ]
      } else {
        continue // deep child without corridor — reported as unroutable
      }
      // Collapse consecutive duplicate points (straight-through joints).
      const cleaned = points.filter(
        (p, idx) => idx === 0 || Math.abs(p.x - points[idx - 1].x) > 0.01 || Math.abs(p.y - points[idx - 1].y) > 0.01,
      )
      const { d, segments } = orthoPath(cleaned)
      allD.push(d)
      allSegments.push(...segments)
      endpoints.push({ memberId: childId, point: target, anchorKind: 'top' })
    }

    if (allD.length === 0) continue
    const edge: FamilyEdge = {
      kind: 'family',
      parentUnitId: plan.parentUnitId,
      childIds: plan.childIds,
      d: allD.join(' '),
      endpoints,
      segments: allSegments,
    }
    edges.push(edge)
  }

  // Secondary parent links (dashed in the renderer).
  for (const plan of secondaryPlans) {
    const px = xOfMember.get(plan.parentId)
    const py = yOfMember.get(plan.parentId)
    const cx = xOfMember.get(plan.childId)
    const cy = yOfMember.get(plan.childId)
    if (px == null || py == null || cx == null || cy == null) continue
    const src = anchor({ x: px, y: py }, 'bottom')
    const dst = anchor({ x: cx, y: cy }, 'top-secondary')

    let points: Point[]
    if (plan.corridorX == null) {
      const y = laneY(genOfMember(plan.parentId), plan.laneReqs[0].lane)
      points = [src, { x: src.x, y }, { x: dst.x, y }, dst]
    } else {
      const highY = laneY(genOfMember(plan.parentId), plan.laneReqs[0].lane)
      const lowY = laneY(genOfMember(plan.childId) - 1, plan.laneReqs[1].lane)
      points = [
        src,
        { x: src.x, y: highY },
        { x: plan.corridorX, y: highY },
        { x: plan.corridorX, y: lowY },
        { x: dst.x, y: lowY },
        dst,
      ]
    }
    const cleaned = points.filter(
      (p, idx) => idx === 0 || Math.abs(p.x - points[idx - 1].x) > 0.01 || Math.abs(p.y - points[idx - 1].y) > 0.01,
    )
    const { d, segments } = orthoPath(cleaned)
    edges.push({
      kind: 'secondary-parent',
      parentId: plan.parentId,
      childId: plan.childId,
      d,
      endpoints: [
        { memberId: plan.parentId, point: src, anchorKind: 'bottom' },
        { memberId: plan.childId, point: dst, anchorKind: 'top-secondary' },
      ],
      segments,
    })
  }

  return { edges, generationRows, orphanRowY, yOfMember, issues }
}
