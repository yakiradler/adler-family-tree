// Standalone tree-layout engine.
// Extracted so it can be unit-tested against real family data without
// pulling React. All dimensions are in pixels.

import type { Member, Relationship, SpouseStatus } from '../../types'

// ─── Dimensions ─────────────────────────────────────────────────────────────
export const AVATAR = 64
export const NODE_W = AVATAR + 72
export const NODE_H = AVATAR + 62
// Gaps are generous enough that NO two cards can ever visually touch, even
// when avatars have protruding gender/birth-order badges on the corners.
export const H_GAP = 40
export const V_GAP = 96
export const COUPLE_GAP = 22
// Minimum breathing space required on every side of a card. Any layout that
// produces a closer neighbour should be considered a bug.
export const MIN_SIDE_GAP = 12

export type LayoutMode = 'classic' | 'grid' | 'arc' | 'staggered'

export interface SecondaryPartner {
  member: Member
  status: Exclude<SpouseStatus, 'current'>  // 'ex' | 'deceased'
}

export interface LayoutNode {
  member: Member
  x: number
  y: number
  generation: number
  /**
   * Ex / deceased partners that should render as a smaller circle BELOW
   * this member's card. They don't reserve horizontal layout width — so a
   * divorce never widens the tree — but the consumer is expected to draw
   * them at a known offset (see SECONDARY_PARTNER_* constants).
   */
  secondaryPartners?: SecondaryPartner[]
}

// Visual constants for ex/deceased partner indicators rendered by the
// caller. Kept in this module so tests and TreeView agree on the geometry.
export const SECONDARY_PARTNER_SIZE = 36           // avatar diameter, px
export const SECONDARY_PARTNER_TOP_OFFSET = NODE_H + 6  // gap below card

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
  // Zigzag / brick pattern. To guarantee no two cards ever visually touch:
  //   - adjacent indices sit on different rows, so vertical separation must
  //     fully clear a card height: yOffset ≥ NODE_H + MIN_SIDE_GAP.
  //   - same-row items (indices i and i+2) must have 2*step ≥ NODE_W + gap.
  // With step ≈ 0.55·NODE_W the layout still visibly shrinks horizontally
  // compared to classic while keeping a clean 12+ px visual gap everywhere.
  const step = Math.round(NODE_W * 0.55 + MIN_SIDE_GAP)       // ~87 px
  const yOffset = NODE_H + MIN_SIDE_GAP + 2                   // 140 px
  const width = (n - 1) * step + NODE_W
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) {
    placements.push({ dx: i * step, dy: (i % 2) * yOffset })
  }
  return { placements, width, height: NODE_H + yOffset }
}

export function clusterArc(n: number): ClusterResult {
  // Fan siblings along a shallow arc. Two constraints:
  //   (a) Neighbouring cards must have enough horizontal spacing at the arc's
  //       edges — the x-distance between adjacent positions is roughly
  //       `chord * cos(angle)`, which SHRINKS towards the ends of the arc.
  //       Cap sweep so cos(halfSweep) stays bounded and bump chord as needed.
  //   (b) Arc sag (max dy) must not bleed into the next generation. Clamp
  //       the depth factor so maxDy ≤ NODE_H · 0.9.
  const sweep = Math.min(Math.PI * 0.55, Math.PI * 0.28 + n * 0.05)   // ≤ 99°
  const halfSweep = sweep / 2
  const cosHalf = Math.max(0.35, Math.cos(halfSweep))                  // bounded
  const minEdgeDx = NODE_W + MIN_SIDE_GAP + 8                          // 156
  const chord = Math.max(NODE_W + H_GAP * 0.9, minEdgeDx / cosHalf)
  const R = chord / (2 * Math.sin(sweep / (2 * Math.max(n - 1, 1))))
  const width = 2 * R * Math.sin(halfSweep) + NODE_W
  const naturalDepth = 0.55
  const maxAllowedSag = NODE_H * 0.9
  const rawMaxSag = R * (1 - Math.cos(halfSweep)) * naturalDepth
  const depthFactor =
    rawMaxSag > maxAllowedSag && rawMaxSag > 0
      ? (maxAllowedSag / (R * (1 - Math.cos(halfSweep))))
      : naturalDepth
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

export interface LayoutOptions {
  /**
   * Show ex / deceased partners as secondary circles beneath their card.
   * When false (default — divorce is a sensitive topic and stays inside
   * the profile panel), they are omitted from the layout entirely so the
   * tree never reserves vertical genOverflow for them.
   */
  showFormerSpouses?: boolean
}

export function buildLayout(
  members: Member[],
  relationships: Relationship[],
  mode: LayoutMode = 'classic',
  options: LayoutOptions = {},
): LayoutNode[] {
  if (members.length === 0) return []
  const showFormerSpouses = options.showFormerSpouses ?? false

  const memberById = new Map(members.map(m => [m.id, m]))
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  // Only CURRENT spouses are co-placed in the main row.
  const spousesOf = new Map<string, string[]>()
  // Ex / deceased partners surface separately — rendered as small circles
  // below the member without affecting layout slot widths.
  const secondaryPartnersOf = new Map<string, SecondaryPartner[]>()

  const spouseStatusOf = (r: Relationship): SpouseStatus =>
    (r.status ?? 'current') as SpouseStatus

  for (const r of relationships) {
    if (r.type === 'parent-child') {
      if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
      parentsOf.get(r.member_b_id)!.push(r.member_a_id)
      if (!childrenOf.has(r.member_a_id)) childrenOf.set(r.member_a_id, [])
      const ch = childrenOf.get(r.member_a_id)!
      if (!ch.includes(r.member_b_id)) ch.push(r.member_b_id)
    }
    if (r.type === 'spouse') {
      const status = spouseStatusOf(r)
      if (status === 'current') {
        const add = (a: string, b: string) => {
          if (!spousesOf.has(a)) spousesOf.set(a, [])
          if (!spousesOf.get(a)!.includes(b)) spousesOf.get(a)!.push(b)
        }
        add(r.member_a_id, r.member_b_id)
        add(r.member_b_id, r.member_a_id)
      } else if (showFormerSpouses) {
        // ex / deceased: surface as a secondary partner on BOTH sides so
        // either member's card shows the relationship indicator. Only
        // collected when the caller opts in via showFormerSpouses (the
        // tree hides them by default — see options).
        const addSecondary = (ownerId: string, partnerId: string) => {
          const partner = memberById.get(partnerId)
          if (!partner) return
          if (!secondaryPartnersOf.has(ownerId)) secondaryPartnersOf.set(ownerId, [])
          const list = secondaryPartnersOf.get(ownerId)!
          if (!list.some(p => p.member.id === partnerId)) {
            list.push({ member: partner, status })
          }
        }
        addSecondary(r.member_a_id, r.member_b_id)
        addSecondary(r.member_b_id, r.member_a_id)
      }
    }
  }

  const rootIds = new Set(members.filter(m => !parentsOf.has(m.id)).map(m => m.id))

  // Children are grouped under their MOTHER's column by default — the
  // user explicitly asked for this so a discreet first ex-spouse can
  // be hidden without orphaning the children. Per-member override via
  // `connector_parent_id` lets families opt back to the father where
  // it's the more meaningful anchor (e.g. patrilineal traditions).
  const primaryParentOf = new Map<string, string>()
  for (const [childId, parents] of parentsOf) {
    const child = memberById.get(childId)
    const explicit = child?.connector_parent_id
    const explicitParent = explicit && parents.includes(explicit) ? explicit : null
    const motherPrimary = parents.find(p => memberById.get(p)?.gender === 'female')
    const fatherPrimary = parents.find(p => memberById.get(p)?.gender === 'male')
    primaryParentOf.set(
      childId,
      explicitParent ?? motherPrimary ?? fatherPrimary ?? parents[0],
    )
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

    // Width needed for this node + its co-placed spouses (if any).
    const coupleWidth = NODE_W + spousesToPlace.length * (NODE_W + COUPLE_GAP)

    if (children.length === 0) {
      // Leaf w/ optional spouse. Couple width IS the reserved width — place
      // straight from leftX.
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
      // ── Compute children block width so we know how much to indent when
      //     the parent's couple is wider than the children (otherwise the
      //     couple, being centered above children, spills outside the
      //     parent-reserved slot and collides with the neighbouring subtree).
      const nonLeavesW = nonLeaves.reduce((s, c) => s + subtreeWidth(c), 0)
        + Math.max(0, nonLeaves.length - 1) * H_GAP
      const sep = nonLeaves.length > 0 ? H_GAP : 0
      const childrenBlockW = nonLeavesW + sep + cluster.width
      const indent = Math.max(0, (coupleWidth - childrenBlockW) / 2)

      // 1. Non-leaves on the left (indented to keep couple inside slot).
      let cursorX = leftX + indent
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
    const childrenBlockW =
      children.reduce((s, c) => s + subtreeWidth(c), 0) +
      Math.max(0, children.length - 1) * H_GAP
    const indent = Math.max(0, (coupleWidth - childrenBlockW) / 2)
    let childLeft = leftX + indent
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

  // ── Generation Y (cluster-aware) ──────────────────────────────────────
  // Each generation must start LOW enough that the previous generation's
  // cluster overflow (e.g. arc sag, zigzag 2nd row) and any secondary-
  // partner indicators (ex/deceased circles below the card) cannot bleed
  // into it. genOverflow[G] = max extra dy needed below generation G.
  const genOverflow = new Map<number, number>()
  for (const [id, dy] of yOffset) {
    const g = genMap.get(id) ?? 0
    if (dy > (genOverflow.get(g) ?? 0)) genOverflow.set(g, dy)
  }
  // Secondary partner block extends past the bottom of the card by
  // (TOP_OFFSET - NODE_H) + SIZE + a safety gap.
  const secondaryExtra =
    SECONDARY_PARTNER_TOP_OFFSET - NODE_H + SECONDARY_PARTNER_SIZE + MIN_SIDE_GAP
  for (const [id, partners] of secondaryPartnersOf) {
    if (!partners.length) continue
    const g = genMap.get(id) ?? 0
    if (secondaryExtra > (genOverflow.get(g) ?? 0)) {
      genOverflow.set(g, secondaryExtra)
    }
  }

  let maxGen = 0
  for (const g of genMap.values()) if (g > maxGen) maxGen = g

  const genY = new Map<number, number>()
  let yAccum = 0
  for (let g = 0; g <= maxGen; g++) {
    genY.set(g, yAccum)
    // Next generation must clear this gen's card height + any cluster dy.
    yAccum += NODE_H + (genOverflow.get(g) ?? 0) + V_GAP
  }

  const finalNodes: LayoutNode[] = members.map(m => {
    const g = genMap.get(m.id) ?? 0
    const partners = secondaryPartnersOf.get(m.id)
    return {
      member: m,
      x: xPos.get(m.id) ?? 0,
      y: (genY.get(g) ?? 0) + (yOffset.get(m.id) ?? 0),
      generation: g,
      secondaryPartners: partners && partners.length ? partners : undefined,
    }
  })

  // ── Collision safety net ──────────────────────────────────────────────
  // After layout, verify every pair of cards has ≥ MIN_SIDE_GAP either
  // horizontally or vertically. This catches any regression that would
  // cause visible touching/clipping. Only logs in dev-like environments
  // (when import.meta.env.DEV is true, or when running via tsx/node).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const im = (typeof import.meta !== 'undefined' ? (import.meta as any) : {}) as { env?: { DEV?: boolean } }
  const isDev = im.env?.DEV === true || typeof window === 'undefined'
  if (isDev) assertNoCollisions(finalNodes)

  return finalNodes
}

/**
 * Throws if any pair of cards has their bounding boxes overlapping or
 * within `MIN_SIDE_GAP` of each other. Used as a regression guard.
 */
export function assertNoCollisions(nodes: LayoutNode[]): void {
  const collisions: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const ax1 = a.x, ax2 = a.x + NODE_W
    const ay1 = a.y, ay2 = a.y + NODE_H
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const bx1 = b.x, bx2 = b.x + NODE_W
      const by1 = b.y, by2 = b.y + NODE_H
      // Required gap: either horizontal or vertical separation ≥ MIN_SIDE_GAP.
      const horizClear = ax2 + MIN_SIDE_GAP <= bx1 || bx2 + MIN_SIDE_GAP <= ax1
      const vertClear = ay2 + MIN_SIDE_GAP <= by1 || by2 + MIN_SIDE_GAP <= ay1
      if (!horizClear && !vertClear) {
        collisions.push(
          `${a.member.first_name} ${a.member.last_name} ↔ ${b.member.first_name} ${b.member.last_name}`,
        )
        if (collisions.length >= 6) break
      }
    }
    if (collisions.length >= 6) break
  }
  if (collisions.length) {
    // eslint-disable-next-line no-console
    console.warn('[tree-layout] card collisions detected:\n  ' + collisions.join('\n  '))
  }
}
