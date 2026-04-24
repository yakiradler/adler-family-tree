// Standalone tree-layout engine.
// Extracted so it can be unit-tested against real family data without
// pulling React. All dimensions are in pixels.

import type { Member, Relationship } from '../../types'

// ─── Dimensions ─────────────────────────────────────────────────────────────
export const AVATAR = 64
export const NODE_W = AVATAR + 72
export const NODE_H = AVATAR + 62
export const H_GAP = 28
export const V_GAP = 78
export const COUPLE_GAP = 14

export type LayoutMode = 'classic' | 'grid' | 'arc' | 'staggered'

export interface LayoutNode {
  member: Member
  x: number
  y: number
  generation: number
}

interface Placement { dx: number; dy: number }
interface ClusterResult { placements: Placement[]; width: number; height: number }

// ─── Sibling cluster shapes ────────────────────────────────────────────────
// Each returns per-child (dx, dy) and the total bounding width/height.
// These operate ONLY on leaf siblings (no descendants of their own) so the
// dy shifts never collide with deeper subtrees.

export function clusterClassic(n: number): ClusterResult {
  const width = n * NODE_W + (n - 1) * H_GAP
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) placements.push({ dx: i * (NODE_W + H_GAP), dy: 0 })
  return { placements, width, height: NODE_H }
}

export function clusterGrid(n: number): ClusterResult {
  const perRow = n > 8 ? 5 : 4
  const cols = Math.min(perRow, n)
  const rowStep = NODE_H + V_GAP * 0.38
  const width = cols * NODE_W + (cols - 1) * H_GAP
  const placements: Placement[] = []
  const rows = Math.ceil(n / perRow)
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow)
    const col = i % perRow
    const thisRowCount = Math.min(perRow, n - r * perRow)
    const thisRowW = thisRowCount * NODE_W + (thisRowCount - 1) * H_GAP
    const dx = (width - thisRowW) / 2 + col * (NODE_W + H_GAP)
    const dy = r * rowStep
    placements.push({ dx, dy })
  }
  return { placements, width, height: NODE_H + (rows - 1) * rowStep }
}

export function clusterStaggered(n: number): ClusterResult {
  // Zigzag: adjacent sibs in different rows, so horizontal step can shrink.
  const step = NODE_W * 0.62 + 6
  const yOffset = Math.round(NODE_H * 0.5 + 10)
  const width = (n - 1) * step + NODE_W
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) {
    placements.push({ dx: i * step, dy: (i % 2) * yOffset })
  }
  return { placements, width, height: NODE_H + yOffset }
}

export function clusterArc(n: number): ClusterResult {
  const sweep = Math.min(Math.PI * 0.9, Math.PI * 0.4 + n * 0.09)
  const halfSweep = sweep / 2
  const chord = NODE_W + H_GAP * 0.9
  const R = chord / (2 * Math.sin(sweep / (2 * Math.max(n - 1, 1))))
  const width = 2 * R * Math.sin(halfSweep) + NODE_W
  const depthFactor = 0.55
  const centerX = width / 2
  const placements: Placement[] = []
  let maxDy = 0
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1)
    const angle = -halfSweep + t * sweep
    const dx = centerX + R * Math.sin(angle) - NODE_W / 2
    const dy = R * (1 - Math.cos(angle)) * depthFactor
    if (dy > maxDy) maxDy = dy
    placements.push({ dx, dy })
  }
  return { placements, width, height: NODE_H + maxDy }
}

// Threshold: apply cluster shape when there are ≥2 leaves. Below that we
// fall back to classic (2 side-by-side feels fine in every mode).
export function clusterFor(mode: LayoutMode, n: number): ClusterResult {
  if (n < 2) return clusterClassic(n)
  if (mode === 'grid') return clusterGrid(n)
  if (mode === 'staggered') return clusterStaggered(n)
  if (mode === 'arc') return clusterArc(n)
  return clusterClassic(n)
}

// ─── Main layout engine ────────────────────────────────────────────────────

export function buildLayout(
  members: Member[],
  relationships: Relationship[],
  mode: LayoutMode = 'classic',
): LayoutNode[] {
  if (members.length === 0) return []

  const memberById = new Map(members.map(m => [m.id, m]))
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()

  for (const r of relationships) {
    if (r.type === 'parent-child') {
      if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
      parentsOf.get(r.member_b_id)!.push(r.member_a_id)
      if (!childrenOf.has(r.member_a_id)) childrenOf.set(r.member_a_id, [])
      const ch = childrenOf.get(r.member_a_id)!
      if (!ch.includes(r.member_b_id)) ch.push(r.member_b_id)
    }
    if (r.type === 'spouse') {
      const add = (a: string, b: string) => {
        if (!spousesOf.has(a)) spousesOf.set(a, [])
        if (!spousesOf.get(a)!.includes(b)) spousesOf.get(a)!.push(b)
      }
      add(r.member_a_id, r.member_b_id)
      add(r.member_b_id, r.member_a_id)
    }
  }

  const rootIds = new Set(members.filter(m => !parentsOf.has(m.id)).map(m => m.id))

  const primaryParentOf = new Map<string, string>()
  for (const [childId, parents] of parentsOf) {
    const malePrimary = parents.find(p => memberById.get(p)?.gender === 'male')
    primaryParentOf.set(childId, malePrimary ?? parents[0])
  }

  const ownerChildrenOf = new Map<string, string[]>()
  for (const [childId, parentId] of primaryParentOf) {
    if (!ownerChildrenOf.has(parentId)) ownerChildrenOf.set(parentId, [])
    ownerChildrenOf.get(parentId)!.push(childId)
  }

  const siblingSort = (aId: string, bId: string) => {
    const a = memberById.get(aId), b = memberById.get(bId)
    if (!a || !b) return 0
    const ao = a.birth_order, bo = b.birth_order
    if (ao != null && bo != null && ao !== bo) return ao - bo
    if (ao != null && bo == null) return -1
    if (ao == null && bo != null) return 1
    const ad = a.birth_date ? new Date(a.birth_date).getTime() : null
    const bd = b.birth_date ? new Date(b.birth_date).getTime() : null
    if (ad != null && bd != null && ad !== bd) return ad - bd
    if (ad != null && bd == null) return -1
    if (ad == null && bd != null) return 1
    return (a.first_name || '').localeCompare(b.first_name || '', 'he')
  }
  for (const [pid, kids] of ownerChildrenOf) {
    kids.sort(siblingSort)
    ownerChildrenOf.set(pid, kids)
  }

  const familyChildrenOf = new Map<string, string[]>()
  for (const m of members) {
    const owned = ownerChildrenOf.get(m.id) ?? []
    const fromSpouses = (spousesOf.get(m.id) ?? []).flatMap(sp => ownerChildrenOf.get(sp) ?? [])
    const all = [...new Set([...owned, ...fromSpouses])]
    all.sort(siblingSort)
    if (all.length > 0) familyChildrenOf.set(m.id, all)
  }

  // Generation via fixpoint
  const genMap = new Map<string, number>()
  members.forEach(m => genMap.set(m.id, 0))
  let changed = true
  let safety = 0
  while (changed && safety++ < 200) {
    changed = false
    for (const m of members) {
      const parents = parentsOf.get(m.id) ?? []
      if (parents.length === 0) continue
      const newGen = Math.max(...parents.map(p => genMap.get(p) ?? 0)) + 1
      if (newGen > (genMap.get(m.id) ?? 0)) {
        genMap.set(m.id, newGen)
        changed = true
      }
    }
    for (const m of members) {
      if (parentsOf.has(m.id)) continue
      const currGen = genMap.get(m.id) ?? 0
      for (const sp of spousesOf.get(m.id) ?? []) {
        const spGen = genMap.get(sp) ?? 0
        if (spGen > currGen) {
          genMap.set(m.id, spGen)
          changed = true
        }
      }
    }
  }

  // Layout roots
  const processedAsSpouse = new Set<string>()
  const layoutRoots: string[] = []
  for (const id of rootIds) {
    if (processedAsSpouse.has(id)) continue
    const spouses = spousesOf.get(id) ?? []
    const primarySpouse = spouses[0]
    if (primarySpouse && !rootIds.has(primarySpouse)) {
      processedAsSpouse.add(id)
      continue
    }
    layoutRoots.push(id)
    for (const sp of spouses) if (rootIds.has(sp)) processedAsSpouse.add(sp)
    processedAsSpouse.add(id)
  }

  // A child is a "leaf" iff it has no familyChildrenOf entry (no descendants
  // through itself or any spouse).
  const isLeaf = (id: string) => !(familyChildrenOf.get(id)?.length)

  // Split children into non-leaves (need horizontal subtree slots) and
  // leaves (can be clustered). This lets the alternate modes actually trigger
  // on MIXED groups — the common case in real family trees, where some
  // children have their own descendants and some don't.
  function splitChildren(ids: string[]): { nonLeaves: string[]; leaves: string[] } {
    const nonLeaves: string[] = []
    const leaves: string[] = []
    for (const c of ids) (isLeaf(c) ? leaves : nonLeaves).push(c)
    return { nonLeaves, leaves }
  }

  // When to apply an alternate cluster shape to the leaves subset.
  // Requires: non-classic mode AND ≥2 leaves. Works whether or not non-leaves
  // are present — they stay in classic horizontal slots on the left.
  const shouldCluster = (leafCount: number) =>
    mode !== 'classic' && leafCount >= 2

  // ── Subtree width (mode-aware) ────────────────────────────────────────
  const swCache = new Map<string, number>()
  const leafClusterCache = new Map<string, ClusterResult>() // parent id → cluster

  function subtreeWidth(id: string): number {
    if (swCache.has(id)) return swCache.get(id)!
    const children = familyChildrenOf.get(id) ?? []
    const spouses = spousesOf.get(id) ?? []
    const placedSpouses = spouses.filter(sp => !layoutRoots.includes(sp))
    const coupleWidth = NODE_W + placedSpouses.length * (NODE_W + COUPLE_GAP)

    let childrenWidth = 0
    if (children.length > 0) {
      const { nonLeaves, leaves } = splitChildren(children)
      if (shouldCluster(leaves.length)) {
        const cluster = clusterFor(mode, leaves.length)
        leafClusterCache.set(id, cluster)
        const nonLeavesW = nonLeaves.reduce((s, c) => s + subtreeWidth(c), 0)
          + Math.max(0, nonLeaves.length - 1) * H_GAP
        const sep = nonLeaves.length > 0 ? H_GAP : 0
        childrenWidth = nonLeavesW + sep + cluster.width
      } else {
        childrenWidth =
          children.reduce((s, c) => s + subtreeWidth(c), 0) +
          H_GAP * (children.length - 1)
      }
    }
    const w = Math.max(coupleWidth, childrenWidth)
    swCache.set(id, w)
    return w
  }
  layoutRoots.forEach(id => subtreeWidth(id))
  members.forEach(m => { if (!swCache.has(m.id)) subtreeWidth(m.id) })

  // ── Position assignment ───────────────────────────────────────────────
  const xPos = new Map<string, number>()
  const yOffset = new Map<string, number>()
  const placed = new Set<string>()

  function placeSpousesAround(id: string, midX: number, spousesToPlace: string[]) {
    if (spousesToPlace.length > 0) {
      const totalCoupleW = NODE_W + spousesToPlace.length * (NODE_W + COUPLE_GAP)
      const coupleLeft = midX - totalCoupleW / 2
      xPos.set(id, coupleLeft)
      let spX = coupleLeft + NODE_W + COUPLE_GAP
      for (const sp of spousesToPlace) {
        xPos.set(sp, spX); placed.add(sp); spX += NODE_W + COUPLE_GAP
      }
    } else {
      xPos.set(id, midX - NODE_W / 2)
    }
  }

  function assign(id: string, leftX: number) {
    if (placed.has(id)) return
    placed.add(id)
    const children = familyChildrenOf.get(id) ?? []
    const spouses = spousesOf.get(id) ?? []
    const spousesToPlace = spouses.filter(sp => !layoutRoots.includes(sp) && !placed.has(sp))

    if (children.length === 0) {
      xPos.set(id, leftX)
      let nextX = leftX + NODE_W + COUPLE_GAP
      for (const sp of spousesToPlace) {
        xPos.set(sp, nextX); placed.add(sp); nextX += NODE_W + COUPLE_GAP
      }
      return
    }

    const cluster = leafClusterCache.get(id)
    if (cluster) {
      const { nonLeaves, leaves } = splitChildren(children)
      // 1. Non-leaves on the left, each getting its full subtree width.
      let cursorX = leftX
      for (const c of nonLeaves) {
        assign(c, cursorX)
        cursorX += subtreeWidth(c) + H_GAP
      }
      // 2. Leaves clustered to the right of the non-leaves.
      const leavesBase = cursorX
      for (let i = 0; i < leaves.length; i++) {
        const p = cluster.placements[i]
        xPos.set(leaves[i], leavesBase + p.dx)
        if (p.dy) yOffset.set(leaves[i], p.dy)
        placed.add(leaves[i])
      }
      // 3. Parent centered above EVERYTHING (non-leaves + leaf cluster).
      const allLeftEdges: number[] = []
      const allRightEdges: number[] = []
      for (const c of nonLeaves) {
        const cx = xPos.get(c)!
        allLeftEdges.push(cx)
        allRightEdges.push(cx + NODE_W)
      }
      for (let i = 0; i < leaves.length; i++) {
        const cx = xPos.get(leaves[i])!
        allLeftEdges.push(cx)
        allRightEdges.push(cx + NODE_W)
      }
      const firstCX = Math.min(...allLeftEdges)
      const lastCX = Math.max(...allRightEdges)
      const midX = (firstCX + lastCX) / 2
      placeSpousesAround(id, midX, spousesToPlace)
      return
    }

    // Classic horizontal layout (fallback).
    let childLeft = leftX
    for (const c of children) {
      assign(c, childLeft)
      childLeft += subtreeWidth(c) + H_GAP
    }
    const firstCX = xPos.get(children[0])!
    const lastCX = xPos.get(children[children.length - 1])!
    const midX = (firstCX + lastCX + NODE_W) / 2
    placeSpousesAround(id, midX, spousesToPlace)
  }

  let startX = 0
  for (const rootId of layoutRoots) {
    assign(rootId, startX)
    startX += subtreeWidth(rootId) + H_GAP * 2
  }
  members.forEach(m => {
    if (!placed.has(m.id)) { xPos.set(m.id, startX); startX += NODE_W + H_GAP }
  })

  return members.map(m => ({
    member: m,
    x: xPos.get(m.id) ?? 0,
    y: (genMap.get(m.id) ?? 0) * (NODE_H + V_GAP) + (yOffset.get(m.id) ?? 0),
    generation: genMap.get(m.id) ?? 0,
  }))
}
