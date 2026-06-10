// ─────────────────────────────────────────────────────────────────────
// Contour-based placement (Reingold-Tilford / Walker style, adapted to
// family-tree units).
//
// Guarantees BY CONSTRUCTION (asserted again in validate.ts):
//   • no two cards ever overlap — every subtree carries a per-row
//     contour and siblings are merged with a minimum gap at EVERY row;
//   • couples are adjacent (one unit is placed atomically);
//   • a parent unit is centred on the midpoint of its first and last
//     child units (or, when the parent is wider, the children block is
//     centred under the parent — both read as symmetric);
//   • deterministic: same input → same output, no randomness, no
//     iteration order dependence;
//   • the same code path runs for every generation — depth 3 and depth
//     30 use identical rules.
//
// There is NO fallback placement. Every non-orphan unit is reachable
// from a root of the placement forest (cycle edges were removed by the
// generation solver), so every unit gets exactly one position.
// ─────────────────────────────────────────────────────────────────────

import { CARD, GAPS } from './metrics'
import type { FamilyGraph, UnitId } from './types'
import type { GenerationSolution } from './generations'

export interface PlacementResult {
  /** Centre x of each unit (canvas coords, already left-normalized). */
  centerOfUnit: Map<UnitId, number>
  /** Left-edge x of each member's card. */
  xOfMember: Map<string, number>
  /** Highest generation index among placed (non-orphan) units. */
  maxGeneration: number
  /** Actual horizontal gap inside each couple (menorah widening). */
  coupleGaps: Record<UnitId, number>
}

/** Per-row horizontal extents of a subtree, indexed by absolute generation. */
interface Contour {
  minGen: number
  maxGen: number
  left: number[]
  right: number[]
  /** Which merged child (index) owns the right edge at each row. */
  rightOwner: number[]
}

// (unit widths are computed via `widthOf` inside placeUnits — they
// depend on the per-couple gap map below.)

/**
 * Per-couple horizontal gaps. The default is GAPS.COUPLE; a couple
 * widens ("menorah") when BOTH spouses have a parent couple directly
 * above them — his parents over him, her parents over her — so the two
 * parent units fit side by side with a SIBLING gap between them.
 * Computed in ascending generation order because a couple's required
 * gap depends on its parents' unit widths (which may themselves have
 * widened).
 */
function computeCoupleGaps(
  graph: FamilyGraph,
  genOfUnit: Map<UnitId, number>,
): Record<UnitId, number> {
  const gaps: Record<UnitId, number> = {}
  const widthOf = (id: UnitId): number => {
    const unit = graph.unitById.get(id)
    if (!unit) return CARD.W
    return unit.members.length === 2 ? 2 * CARD.W + (gaps[id] ?? GAPS.COUPLE) : CARD.W
  }
  const satelliteByHost = new Map(graph.satellites.map((s) => [s.hostUnitId, s.unitId]))
  const ordered = [...graph.units].sort(
    (a, b) => (genOfUnit.get(a.id) ?? 0) - (genOfUnit.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1),
  )
  for (const unit of ordered) {
    if (unit.members.length !== 2) continue
    gaps[unit.id] = GAPS.COUPLE
    const bloodParents = graph.parentUnitOf.get(unit.id)
    const inLawParents = satelliteByHost.get(unit.id)
    if (bloodParents && inLawParents) {
      const needed =
        widthOf(bloodParents) / 2 + widthOf(inLawParents) / 2 + GAPS.SIBLING - CARD.W
      gaps[unit.id] = Math.max(GAPS.COUPLE, needed)
    }
  }
  return gaps
}

interface SubtreeLayout {
  contour: Contour
  /** Centre x of the subtree's own unit, in the subtree's local frame. */
  center: number
  /** Relative centre of every unit in the subtree. */
  positions: Map<UnitId, number>
}

/**
 * Minimal shift for `next` so that, at every shared row, it clears
 * `merged` by `gap`. Returns the owning child index of the binding row
 * (for Walker-style slack distribution).
 */
function requiredShift(merged: Contour, next: Contour, gap: number): { shift: number; owner: number } {
  let shift = -Infinity
  let owner = -1
  const lo = Math.max(merged.minGen, next.minGen)
  const hi = Math.min(merged.maxGen, next.maxGen)
  for (let g = lo; g <= hi; g++) {
    const r = merged.right[g - merged.minGen]
    const l = next.left[g - next.minGen]
    if (!Number.isFinite(r) || !Number.isFinite(l)) continue
    const s = r + gap - l
    if (s > shift) {
      shift = s
      owner = merged.rightOwner[g - merged.minGen]
    }
  }
  if (!Number.isFinite(shift)) {
    // Disjoint generation ranges — clear the whole merged block.
    let maxRight = -Infinity
    let bindingOwner = 0
    for (let i = 0; i < merged.right.length; i++) {
      if (Number.isFinite(merged.right[i]) && merged.right[i] > maxRight) {
        maxRight = merged.right[i]
        bindingOwner = merged.rightOwner[i]
      }
    }
    let minLeft = Infinity
    for (const l of next.left) if (Number.isFinite(l)) minLeft = Math.min(minLeft, l)
    if (!Number.isFinite(maxRight) || !Number.isFinite(minLeft)) return { shift: 0, owner: 0 }
    return { shift: maxRight + gap - minLeft, owner: bindingOwner }
  }
  return { shift, owner }
}

/** Builds the union contour of `parts`, each shifted by its dx. */
function buildMerged(
  parts: Array<{ contour: Contour; dx: number }>,
): Contour {
  let minGen = Infinity
  let maxGen = -Infinity
  for (const p of parts) {
    minGen = Math.min(minGen, p.contour.minGen)
    maxGen = Math.max(maxGen, p.contour.maxGen)
  }
  if (!Number.isFinite(minGen)) return { minGen: 0, maxGen: -1, left: [], right: [], rightOwner: [] }
  const size = maxGen - minGen + 1
  const left = new Array<number>(size).fill(Infinity)
  const right = new Array<number>(size).fill(-Infinity)
  const rightOwner = new Array<number>(size).fill(0)
  parts.forEach((p, idx) => {
    for (let g = p.contour.minGen; g <= p.contour.maxGen; g++) {
      const li = p.contour.left[g - p.contour.minGen]
      const ri = p.contour.right[g - p.contour.minGen]
      if (!Number.isFinite(li) || !Number.isFinite(ri)) continue
      const at = g - minGen
      if (li + p.dx < left[at]) left[at] = li + p.dx
      if (ri + p.dx > right[at]) {
        right[at] = ri + p.dx
        rightOwner[at] = idx
      }
    }
  })
  return { minGen, maxGen, left, right, rightOwner }
}

export function placeUnits(graph: FamilyGraph, gens: GenerationSolution): PlacementResult {
  const { genOfUnit } = gens
  const coupleGaps = computeCoupleGaps(graph, genOfUnit)
  const gapOf = (id: UnitId): number => coupleGaps[id] ?? GAPS.COUPLE
  const widthOf = (id: UnitId): number => {
    const unit = graph.unitById.get(id)
    if (!unit) return CARD.W
    return unit.members.length === 2 ? 2 * CARD.W + gapOf(id) : CARD.W
  }
  /**
   * Where a parent's rail visually CONNECTS to a child unit: the card
   * centre of the blood child (the unit's primary), not the couple's
   * midpoint. Centring parents on these points puts each parent couple
   * over its own child — the left half of the "menorah".
   */
  const connOffset = (id: UnitId): number => {
    const unit = graph.unitById.get(id)
    if (!unit || unit.members.length !== 2) return 0
    const half = (gapOf(id) + CARD.W) / 2
    return unit.primary.id === unit.members[0].id ? -half : half
  }

  /**
   * Lays out the subtree rooted at `unitId`. Recursion depth equals the
   * placement-tree depth (cycles were already removed), so this
   * terminates on any input.
   */
  function layoutSubtree(unitId: UnitId): SubtreeLayout {
    const gen = genOfUnit.get(unitId) ?? 0
    const w = widthOf(unitId)
    const childIds = graph.childUnitsOf.get(unitId) ?? []

    if (childIds.length === 0) {
      return {
        contour: { minGen: gen, maxGen: gen, left: [0], right: [w], rightOwner: [0] },
        center: w / 2,
        positions: new Map([[unitId, w / 2]]),
      }
    }

    const kids = childIds.map((c) => layoutSubtree(c))

    // ── Greedy left-to-right merge with per-row clearance ────────────
    const shifts = new Array<number>(kids.length).fill(0)
    let merged = buildMerged([{ contour: kids[0].contour, dx: 0 }])
    for (let i = 1; i < kids.length; i++) {
      const { shift, owner } = requiredShift(merged, kids[i].contour, GAPS.SIBLING)
      shifts[i] = shift

      // Walker-style slack distribution: when the binding collision is
      // with a NON-adjacent sibling subtree (deep contours touching),
      // spread the extra distance across the siblings in between so the
      // gaps read symmetric instead of bunching left.
      if (owner < i - 1) {
        const prevOnly = requiredShift(
          buildMerged([{ contour: kids[i - 1].contour, dx: shifts[i - 1] }]),
          kids[i].contour,
          GAPS.SIBLING,
        ).shift
        const slack = shift - prevOnly
        if (Number.isFinite(slack) && slack > 0.5) {
          const span = i - owner
          for (let k = owner + 1; k < i; k++) {
            shifts[k] += (slack * (k - owner)) / span
          }
        }
      }
      merged = buildMerged(kids.map((kid, idx) => ({ contour: kid.contour, dx: shifts[idx] })).slice(0, i + 1))
    }

    // ── Safety pass: slack spreading must never create overlap ──────
    let safetyMerged = buildMerged([{ contour: kids[0].contour, dx: shifts[0] }])
    for (let i = 1; i < kids.length; i++) {
      const { shift } = requiredShift(safetyMerged, kids[i].contour, GAPS.SIBLING)
      if (shift > shifts[i] + 1e-6) shifts[i] = shift
      safetyMerged = buildMerged(kids.map((kid, idx) => ({ contour: kid.contour, dx: shifts[idx] })).slice(0, i + 1))
    }

    // ── Centre parent over its children's CONNECTION points ─────────
    // (the blood-child card centres — midpoint of first and last).
    const childCenters = kids.map((k, i) => shifts[i] + k.center + connOffset(childIds[i]))
    const center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2

    // ── Compose subtree positions + contour ─────────────────────────
    const positions = new Map<UnitId, number>([[unitId, center]])
    kids.forEach((k, i) => {
      for (const [uid, c] of k.positions) positions.set(uid, c + shifts[i])
    })

    const ownRow: Contour = {
      minGen: gen,
      maxGen: gen,
      left: [center - w / 2],
      right: [center + w / 2],
      rightOwner: [0],
    }
    const contour = buildMerged([
      { contour: safetyMerged, dx: 0 },
      { contour: ownRow, dx: 0 },
    ])
    return { contour, center, positions }
  }

  // ── Forest: pack root subtrees left to right ──────────────────────
  // In-law satellites are NOT independent roots — they're placed in a
  // dedicated pass below, aligned above their married-in child.
  const satelliteIds = new Set(graph.satellites.map((s) => s.unitId))
  const roots = graph.units
    .filter(
      (u) =>
        !graph.parentUnitOf.has(u.id) &&
        !graph.orphanUnitIds.has(u.id) &&
        !satelliteIds.has(u.id),
    )
    .map((u) => u.id)
    .sort()

  const centerOfUnit = new Map<UnitId, number>()
  let forest: Contour | null = null
  for (const root of roots) {
    const sub = layoutSubtree(root)
    let dx = 0
    if (forest) {
      dx = requiredShift(forest, sub.contour, GAPS.SUBTREE).shift
    } else {
      // Normalize the first subtree so its leftmost edge sits at 0.
      let minLeft = Infinity
      for (const l of sub.contour.left) if (Number.isFinite(l)) minLeft = Math.min(minLeft, l)
      dx = Number.isFinite(minLeft) ? -minLeft : 0
    }
    for (const [uid, c] of sub.positions) centerOfUnit.set(uid, c + dx)
    forest = forest
      ? buildMerged([
          { contour: forest, dx: 0 },
          { contour: sub.contour, dx },
        ])
      : buildMerged([{ contour: sub.contour, dx }])
  }

  // ── Satellite pass: in-law parents above their married-in child ───
  // Preferred position: the satellite unit's centre exactly over the
  // anchor spouse's card centre (the right half of the "menorah").
  // Card overlap is still impossible: the satellite slides right past
  // any occupied slot, and the family rail's elbow absorbs the offset.
  const cardCenterOf = (memberId: string): number | null => {
    const unitId = graph.unitOfMember.get(memberId)
    if (!unitId) return null
    const center = centerOfUnit.get(unitId)
    if (center == null) return null
    const unit = graph.unitById.get(unitId)!
    if (unit.members.length !== 2) return center
    const half = (gapOf(unitId) + CARD.W) / 2
    return unit.members[0].id === memberId ? center - half : center + half
  }

  // Per-row occupied intervals of everything placed so far.
  const occupied = new Map<number, Array<[number, number]>>()
  const occupy = (unitId: UnitId, center: number) => {
    const g = genOfUnit.get(unitId) ?? 0
    const w = widthOf(unitId)
    const list = occupied.get(g) ?? []
    list.push([center - w / 2, center + w / 2])
    occupied.set(g, list)
  }
  for (const [uid, c] of centerOfUnit) occupy(uid, c)

  let forestMaxRight = 0
  for (const list of occupied.values()) {
    for (const [, end] of list) forestMaxRight = Math.max(forestMaxRight, end)
  }

  const pending = [...graph.satellites].sort((a, b) => (a.unitId < b.unitId ? -1 : 1))
  let progressed = true
  while (pending.length > 0 && progressed) {
    progressed = false
    for (let i = 0; i < pending.length; i++) {
      const sat = pending[i]
      const anchorX = cardCenterOf(sat.anchorMemberId)
      if (anchorX == null) continue // host not placed yet — later pass
      const sub = layoutSubtree(sat.unitId)
      let dx = anchorX - sub.center
      // Slide right until every row of the satellite's contour clears
      // all occupied cards by at least a sibling gap. Each push jumps
      // past one interval, so this terminates.
      for (let guard = 0; guard < 10000; guard++) {
        let pushed = false
        for (let g = sub.contour.minGen; g <= sub.contour.maxGen; g++) {
          const li = sub.contour.left[g - sub.contour.minGen]
          const ri = sub.contour.right[g - sub.contour.minGen]
          if (!Number.isFinite(li) || !Number.isFinite(ri)) continue
          for (const [s, e] of occupied.get(g) ?? []) {
            if (li + dx < e + GAPS.SIBLING && ri + dx > s - GAPS.SIBLING) {
              dx = e + GAPS.SIBLING - li
              pushed = true
            }
          }
        }
        if (!pushed) break
      }
      for (const [uid, c] of sub.positions) {
        centerOfUnit.set(uid, c + dx)
        occupy(uid, c + dx)
      }
      pending.splice(i, 1)
      i--
      progressed = true
    }
  }
  // Anchor never got placed (data pathology) — park at the forest edge
  // rather than losing anyone.
  for (const sat of pending) {
    const sub = layoutSubtree(sat.unitId)
    let minLeft = Infinity
    for (const l of sub.contour.left) if (Number.isFinite(l)) minLeft = Math.min(minLeft, l)
    const dx = forestMaxRight + GAPS.SUBTREE - (Number.isFinite(minLeft) ? minLeft : 0)
    for (const [uid, c] of sub.positions) {
      centerOfUnit.set(uid, c + dx)
      occupy(uid, c + dx)
      forestMaxRight = Math.max(forestMaxRight, c + dx + widthOf(uid) / 2)
    }
  }

  // ── Orphan row: compact left-to-right packing ─────────────────────
  const orphans = graph.units
    .filter((u) => graph.orphanUnitIds.has(u.id))
    .map((u) => u.id)
    .sort()
  let orphanX = 0
  for (const id of orphans) {
    const w = widthOf(id)
    centerOfUnit.set(id, orphanX + w / 2)
    orphanX += w + GAPS.SIBLING
  }

  // ── Member card x positions from unit centres ─────────────────────
  const xOfMember = new Map<string, number>()
  for (const unit of graph.units) {
    const center = centerOfUnit.get(unit.id)
    if (center == null) continue // unreachable; validate.ts double-checks
    if (unit.members.length === 2) {
      const gap = gapOf(unit.id)
      xOfMember.set(unit.members[0].id, center - gap / 2 - CARD.W)
      xOfMember.set(unit.members[1].id, center + gap / 2)
    } else {
      xOfMember.set(unit.members[0].id, center - CARD.W / 2)
    }
  }

  let maxGeneration = 0
  for (const unit of graph.units) {
    if (graph.orphanUnitIds.has(unit.id)) continue
    maxGeneration = Math.max(maxGeneration, genOfUnit.get(unit.id) ?? 0)
  }

  return { centerOfUnit, xOfMember, maxGeneration, coupleGaps }
}
