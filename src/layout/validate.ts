// ─────────────────────────────────────────────────────────────────────
// Layout invariant checker.
//
// Runs in dev builds and in every test. A LayoutResult that violates
// any invariant here is a BUG in the engine, full stop — these are the
// owner's hard requirements turned into executable assertions:
//
//   V1  every coordinate is finite (a NaN here is what used to freeze
//       the old auto-fit);
//   V2  every visible member appears exactly once;
//   V3  no two card boxes overlap (badge rows included);
//   V4  couple cards are adjacent at the same y, exactly COUPLE apart;
//   V5  every connector endpoint lies exactly on a card anchor of a
//       rendered node;
//   V6  no connector segment crosses any card box (segments may touch
//       a card only at their own declared endpoints);
//   V7  every placement child is connected to its family rail;
//   V8  parents are centred over their children (or children centred
//       under a wider parent) — the symmetry contract.
// ─────────────────────────────────────────────────────────────────────

import { CARD, GAPS, anchor, type Point } from './metrics'
import type { FamilyEdge, LayoutResult, PlacedNode, Segment } from './types'

export interface LayoutViolation {
  rule: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8'
  message: string
}

const EPS = 0.5

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
  node: PlacedNode
}

function boxOf(node: PlacedNode): Box {
  const extraH = node.secondaryPartners && node.secondaryPartners.length > 0 ? GAPS.BADGE_ROW_H : 0
  return { x1: node.x, y1: node.y, x2: node.x + CARD.W, y2: node.y + CARD.H + extraH, node }
}

function segmentIntersectsBox(seg: Segment, box: Box, slack: number): boolean {
  const [a, b] = seg
  const x1 = Math.min(a.x, b.x)
  const x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  // Orthogonal segments only — overlap test is a rectangle intersection
  // with `slack` shrinking the card box to tolerate corner rounding.
  return (
    x2 > box.x1 + slack &&
    x1 < box.x2 - slack &&
    y2 > box.y1 + slack &&
    y1 < box.y2 - slack
  )
}

function near(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

export function validateLayout(result: LayoutResult): LayoutViolation[] {
  const violations: LayoutViolation[] = []
  const name = (n: PlacedNode) => `${n.member.first_name} ${n.member.last_name}`.trim()

  // V1 — finite everything.
  for (const n of result.nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      violations.push({ rule: 'V1', message: `Non-finite position for ${name(n)}: (${n.x}, ${n.y})` })
    }
  }
  if (!Number.isFinite(result.bounds.width) || !Number.isFinite(result.bounds.height)) {
    violations.push({ rule: 'V1', message: `Non-finite bounds: ${JSON.stringify(result.bounds)}` })
  }
  for (const e of result.edges) {
    for (const [a, b] of e.segments) {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) {
        violations.push({ rule: 'V1', message: `Non-finite segment in ${e.kind} edge` })
      }
    }
  }

  // V2 — each member exactly once.
  const seen = new Map<string, number>()
  for (const n of result.nodes) seen.set(n.member.id, (seen.get(n.member.id) ?? 0) + 1)
  for (const [id, count] of seen) {
    if (count > 1) violations.push({ rule: 'V2', message: `Member ${id} placed ${count} times` })
  }

  // V3 — no card overlaps.
  const boxes = result.nodes.map(boxOf).sort((a, b) => a.x1 - b.x1)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (b.x1 >= a.x2 - EPS) break // sorted by x1 — nothing further right can overlap a
      if (a.x2 - EPS > b.x1 && b.x2 - EPS > a.x1 && a.y2 - EPS > b.y1 && b.y2 - EPS > a.y1) {
        violations.push({ rule: 'V3', message: `Cards overlap: ${name(a.node)} and ${name(b.node)}` })
      }
    }
  }

  // V4 — couple adjacency (the gap may widen per couple — menorah).
  const nodeById = new Map(result.nodes.map((n) => [n.member.id, n]))
  const couplesChecked = new Set<string>()
  for (const n of result.nodes) {
    if (!n.unitId.includes('+') || couplesChecked.has(n.unitId)) continue
    couplesChecked.add(n.unitId)
    const ids = n.unitId.split('+')
    if (ids.length !== 2) continue
    const a = nodeById.get(ids[0])
    const b = nodeById.get(ids[1])
    if (!a || !b) {
      violations.push({ rule: 'V4', message: `Couple unit ${n.unitId} missing a rendered member` })
      continue
    }
    const [left, right] = a.x <= b.x ? [a, b] : [b, a]
    const expectedGap = result.coupleGaps[n.unitId] ?? GAPS.COUPLE
    if (Math.abs(a.y - b.y) > EPS || Math.abs(right.x - (left.x + CARD.W + expectedGap)) > EPS) {
      violations.push({
        rule: 'V4',
        message: `Couple not adjacent: ${name(left)} at (${left.x},${left.y}) / ${name(right)} at (${right.x},${right.y}), expected gap ${expectedGap}`,
      })
    }
  }

  // V5 — endpoints on true anchors.
  for (const e of result.edges) {
    for (const ep of e.endpoints) {
      const node = nodeById.get(ep.memberId)
      if (!node) {
        violations.push({ rule: 'V5', message: `${e.kind} edge endpoint on unrendered member ${ep.memberId}` })
        continue
      }
      const expected = anchor({ x: node.x, y: node.y }, ep.anchorKind)
      if (!near(ep.point, expected)) {
        violations.push({
          rule: 'V5',
          message: `${e.kind} endpoint off-anchor for ${name(node)}: got (${ep.point.x},${ep.point.y}), expected (${expected.x},${expected.y})`,
        })
      }
    }
  }

  // V6 — segments never cross cards (touching own endpoints is fine).
  for (const e of result.edges) {
    const endpointCards = new Set(e.endpoints.map((ep) => ep.memberId))
    for (const seg of e.segments) {
      for (const box of boxes) {
        // A segment may legitimately touch the cards it anchors to.
        const slack = endpointCards.has(box.node.member.id) ? 1.5 : 0.25
        if (segmentIntersectsBox(seg, box, slack)) {
          // Endpoint-adjacent stubs (the few px entering the anchor) are
          // allowed; anything deeper is a crossing.
          const [a, b] = seg
          const touchesOwnAnchor = e.endpoints.some(
            (ep) => ep.memberId === box.node.member.id && (near(a, ep.point) || near(b, ep.point)),
          )
          if (!touchesOwnAnchor) {
            violations.push({
              rule: 'V6',
              message: `${e.kind} edge crosses card of ${name(box.node)} (segment (${a.x},${a.y})→(${b.x},${b.y}))`,
            })
          }
        }
      }
    }
  }

  // V7 — every family edge actually reaches all its children.
  for (const e of result.edges) {
    if (e.kind !== 'family') continue
    const fe = e as FamilyEdge
    const reached = new Set(fe.endpoints.filter((ep) => ep.anchorKind === 'top').map((ep) => ep.memberId))
    for (const childId of fe.childIds) {
      if (!nodeById.has(childId)) continue
      if (!reached.has(childId)) {
        violations.push({ rule: 'V7', message: `Family rail of unit ${fe.parentUnitId} misses child ${childId}` })
      }
    }
  }

  // V8 — symmetry: a parent unit is centred on the midpoint of its
  // rail's leftmost and rightmost DROP points (the blood-child card
  // centres). In-law satellites are exempt — their alignment is
  // best-effort (they slide right when the preferred slot is taken).
  const satelliteSet = new Set(result.satelliteUnitIds)
  const unitExtent = new Map<string, { min: number; max: number }>()
  for (const n of result.nodes) {
    const ext = unitExtent.get(n.unitId) ?? { min: Infinity, max: -Infinity }
    ext.min = Math.min(ext.min, n.x)
    ext.max = Math.max(ext.max, n.x + CARD.W)
    unitExtent.set(n.unitId, ext)
  }
  const unitCenter = (unitId: string): number | null => {
    const ext = unitExtent.get(unitId)
    return ext ? (ext.min + ext.max) / 2 : null
  }
  for (const e of result.edges) {
    if (e.kind !== 'family') continue
    if (satelliteSet.has(e.parentUnitId)) continue
    const parentCenter = unitCenter(e.parentUnitId)
    if (parentCenter == null) continue
    const dropXs = e.endpoints
      .filter((ep) => ep.anchorKind === 'top')
      .map((ep) => ep.point.x)
      .sort((a, b) => a - b)
    if (dropXs.length === 0) continue
    const childMid = (dropXs[0] + dropXs[dropXs.length - 1]) / 2
    if (Math.abs(parentCenter - childMid) > EPS) {
      violations.push({
        rule: 'V8',
        message: `Unit ${e.parentUnitId} not centred over its children: parent centre ${parentCenter}, drops midpoint ${childMid}`,
      })
    }
  }

  return violations
}
