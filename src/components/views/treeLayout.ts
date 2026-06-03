// ─────────────────────────────────────────────────────────────────────
// Family-tree layout engine — clean implementation built on the
// Reingold–Tilford "tidier trees" pattern adapted for family graphs.
// ─────────────────────────────────────────────────────────────────────
//
// Algorithmic backbone (per Reingold–Tilford 1981, Buchheim et al.
// 2002, and standard family-tree practice in D3 / GenoPro / yFiles):
//
//   1. Convert the (members, relationships) graph into a "family
//      forest" — a directed forest of `Family` nodes, where each
//      Family represents either:
//         • a couple (two partners + their joint children), or
//         • a single person (one partner + their children, if any).
//      Children belong to the FAMILY, never to one parent. This is
//      the union-node pattern that makes the rest of the algorithm
//      a standard tidy-tree.
//
//   2. Bottom-up width pass. For each Family compute:
//         coupleW       = card width for one partner, or 2·card+gap
//                         for a couple
//         childrenBlockW = sum of children's subtree widths + gaps
//         subtreeW       = max(coupleW, childrenBlockW)
//      This is O(N) and guarantees no children block ever overflows
//      its slot.
//
//   3. Top-down placement. Each family is given a `leftX` slot and a
//      generation row Y. Inside the slot:
//         blockCentreX        = leftX + subtreeW / 2
//         couple is placed centred on blockCentreX
//         children are placed centred on blockCentreX
//      Because both couple and children are centred on the SAME x,
//      the layout is mathematically symmetric by construction —
//      union.centreX === mean(child.centreX). No sweep needed.
//
//   4. Output two flat lists:
//         nodes[]       — { member, x, y, generation } per person
//         connectors    — derived by the renderer from family
//                         midpoints (see buildLayout's return)
//
// Connector rendering rule (executed by the renderer, not here):
//   • Spouse link  = horizontal segment between avatar edges
//   • Drop stem    = vertical from union.centreX, parentY+cardH
//                    down to railY = midway between rows
//   • Horizontal rail = railY between leftmost-childCx and
//                       rightmost-childCx
//   • Child stems  = vertical from rail down to each child top
//
// The renderer reads `Layout.connectorPlan` (a structured per-family
// description, see below) so it can draw without re-walking the
// graph.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship, SpouseStatus } from '../../types'

// ─── Dimensions ──────────────────────────────────────────────────────
// NODE_W matches MemberNode's `cardWidth = avatarSize + 72` so the
// layout's x-coordinates line up exactly with the rendered cards.
// Mismatch caused the spouse line and the children rail to land in
// empty space instead of on card edges.
export const AVATAR        = 64                    // photo ring diameter
export const NODE_W        = 136                   // card outer width — matches MemberNode
export const NODE_H        = 132                   // card outer height
export const SPOUSE_GAP    = 24                    // gap inside a couple
export const SIBLING_GAP   = 40                    // gap between sibling subtrees
export const GENERATION_GAP = 110                  // gap between rows
export const AVATAR_PAD    = (NODE_W - AVATAR) / 2 // = 36, distance from card edge to avatar edge
export const RAIL_OFFSET   = GENERATION_GAP / 2

// Public LayoutMode kept for API back-compat. Only 'classic' has an
// effect — alternate modes are stubbed.
export type LayoutMode = 'classic' | 'grid' | 'arc' | 'staggered'

export interface SecondaryPartner {
  member: Member
  status: Exclude<SpouseStatus, 'current'>
}

export interface LayoutNode {
  member: Member
  x: number               // left edge of the card
  y: number               // top edge of the card
  generation: number
  secondaryPartners?: SecondaryPartner[]
}

export const SECONDARY_PARTNER_SIZE = 36
export const SECONDARY_PARTNER_TOP_OFFSET = NODE_H + 6

// ─── ConnectorPlan ──────────────────────────────────────────────────
// Structured connector description emitted by the layout engine and
// consumed by the renderer. Each plan entry corresponds to one Family
// and carries everything the renderer needs to draw its spouse line
// (if any) and parent-child rail.
export interface ConnectorPlan {
  // Spouse link — present when the family has two partners.
  spouse?: {
    x1: number; y: number; x2: number  // edge-of-avatar A → edge-of-avatar B
  }
  // Parent-child rail — present when the family has children.
  rail?: {
    dropTopY: number; dropBottomY: number; dropX: number  // union centre stem
    railLeftX: number; railRightX: number; railY: number   // horizontal bar
    childStems: Array<{ x: number; topY: number }>          // verticals to children
  }
}

// ─── Cluster helpers (kept as classic-only stubs for back-compat) ───
interface Placement { dx: number; dy: number }
interface ClusterResult { placements: Placement[]; width: number; height: number }

export function clusterClassic(n: number): ClusterResult {
  const width = n * NODE_W + Math.max(0, n - 1) * SIBLING_GAP
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) placements.push({ dx: i * (NODE_W + SIBLING_GAP), dy: 0 })
  return { placements, width, height: NODE_H }
}
export const clusterGrid = clusterClassic
export const clusterStaggered = clusterClassic
export const clusterArc = clusterClassic
export function clusterFor(_mode: LayoutMode, n: number): ClusterResult {
  return clusterClassic(n)
}

// ─── Public API ──────────────────────────────────────────────────────

export interface LayoutOptions {
  showFormerSpouses?: boolean
}

export interface LayoutResult {
  nodes: LayoutNode[]
  /** One ConnectorPlan per family. The renderer draws all of them. */
  connectorPlans: ConnectorPlan[]
}

// Internal Family representation built by Step 1 of the pipeline.
interface Family {
  id: string
  /** Father (male) on the LEFT if available, otherwise the lone parent. */
  partnerA: Member
  /** Mother (female) on the RIGHT, or null for a single-parent family. */
  partnerB: Member | null
  children: Family[]
  generation: number
  // Filled in by passes 2 and 3.
  coupleW: number
  childrenBlockW: number
  subtreeW: number
  /** x of the visual midpoint of the couple after placement. */
  unionCentreX: number
  /** y of the row the couple sits on. */
  rowY: number
}

// Backward-compat shim. The OLD signature returned LayoutNode[].
// We keep it working: callers that don't care about connector plans
// just see the nodes; callers that need both call buildLayoutFull.
export function buildLayout(
  members: Member[],
  relationships: Relationship[],
  _mode: LayoutMode = 'classic',
  options: LayoutOptions = {},
): LayoutNode[] {
  return buildLayoutFull(members, relationships, _mode, options).nodes
}

export function buildLayoutFull(
  members: Member[],
  relationships: Relationship[],
  _mode: LayoutMode = 'classic',
  options: LayoutOptions = {},
): LayoutResult {
  if (members.length === 0) return { nodes: [], connectorPlans: [] }
  const showFormerSpouses = options.showFormerSpouses ?? false

  // ─── Step 1: build adjacency maps ─────────────────────────────────
  const memberById = new Map(members.map((m) => [m.id, m]))
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const currentSpouseOf = new Map<string, string>()
  const secondaryPartnersOf = new Map<string, SecondaryPartner[]>()

  for (const r of relationships) {
    if (!memberById.has(r.member_a_id) || !memberById.has(r.member_b_id)) continue

    if (r.type === 'parent-child') {
      const ps = parentsOf.get(r.member_b_id) ?? []
      if (!ps.includes(r.member_a_id)) ps.push(r.member_a_id)
      parentsOf.set(r.member_b_id, ps)
      const cs = childrenOf.get(r.member_a_id) ?? []
      if (!cs.includes(r.member_b_id)) cs.push(r.member_b_id)
      childrenOf.set(r.member_a_id, cs)
      continue
    }

    if (r.type === 'spouse') {
      const status = (r.status ?? 'current') as SpouseStatus
      if (status === 'current') {
        if (!currentSpouseOf.has(r.member_a_id)) currentSpouseOf.set(r.member_a_id, r.member_b_id)
        if (!currentSpouseOf.has(r.member_b_id)) currentSpouseOf.set(r.member_b_id, r.member_a_id)
      } else if (showFormerSpouses) {
        const push = (owner: string, partnerId: string) => {
          const partner = memberById.get(partnerId); if (!partner) return
          const list = secondaryPartnersOf.get(owner) ?? []
          if (!list.some((p) => p.member.id === partnerId)) {
            list.push({ member: partner, status })
            secondaryPartnersOf.set(owner, list)
          }
        }
        push(r.member_a_id, r.member_b_id)
        push(r.member_b_id, r.member_a_id)
      }
    }
  }

  // ─── Step 2: build Family forest ──────────────────────────────────
  // Pair people into couples (one Family per couple); wrap singles
  // as solo Families. Order partners deterministically: father (male)
  // first, mother (female) second. Same-gender / unknown couples use
  // member.id sort as tiebreaker.
  const familyById = new Map<string, Family>()
  const familyOfPerson = new Map<string, string>()  // person id → family id
  const seen = new Set<string>()
  for (const m of members) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    const spouseId = currentSpouseOf.get(m.id)
    if (spouseId && memberById.has(spouseId) && !seen.has(spouseId)) {
      seen.add(spouseId)
      const a = memberById.get(m.id)!
      const b = memberById.get(spouseId)!
      // father (male) → partnerA, mother (female) → partnerB
      let partnerA = a, partnerB: Member = b
      if (a.gender === 'female' && b.gender === 'male') {
        partnerA = b; partnerB = a
      } else if (a.gender === b.gender || (!a.gender && !b.gender)) {
        // deterministic: lower id goes left
        if (a.id > b.id) { partnerA = b; partnerB = a }
      }
      const id = `f:${[partnerA.id, partnerB.id].join('+')}`
      const fam: Family = {
        id, partnerA, partnerB, children: [], generation: 0,
        coupleW: 0, childrenBlockW: 0, subtreeW: 0,
        unionCentreX: 0, rowY: 0,
      }
      familyById.set(id, fam)
      familyOfPerson.set(partnerA.id, id)
      familyOfPerson.set(partnerB.id, id)
    } else {
      const id = `f:${m.id}`
      const fam: Family = {
        id, partnerA: m, partnerB: null, children: [], generation: 0,
        coupleW: 0, childrenBlockW: 0, subtreeW: 0,
        unionCentreX: 0, rowY: 0,
      }
      familyById.set(id, fam)
      familyOfPerson.set(m.id, id)
    }
  }

  // ─── Step 3: link children to their birth family ───────────────────
  // A child belongs to the family of their PRIMARY PARENT — mother by
  // default, with explicit override via member.connector_parent_id.
  // (The "primary parent" choice doesn't affect line routing; the
  // rail still drops from the union midpoint. It only decides which
  // FAMILY the child sits under when the two parents are in
  // different families — which only happens with messy data.)
  const isChildFamily = new Set<string>()
  for (const m of members) {
    const ps = parentsOf.get(m.id) ?? []
    if (ps.length === 0) continue
    const explicit = m.connector_parent_id
    let primaryParentId: string | undefined
    if (explicit && ps.includes(explicit)) primaryParentId = explicit
    else primaryParentId =
      ps.find((p) => memberById.get(p)?.gender === 'female') ??
      ps.find((p) => memberById.get(p)?.gender === 'male') ??
      ps[0]
    if (!primaryParentId) continue
    const parentFamId = familyOfPerson.get(primaryParentId)
    const childFamId = familyOfPerson.get(m.id)
    if (!parentFamId || !childFamId || parentFamId === childFamId) continue
    const parentFam = familyById.get(parentFamId)!
    const childFam = familyById.get(childFamId)!
    if (parentFam.children.some((c) => c.id === childFam.id)) continue
    parentFam.children.push(childFam)
    isChildFamily.add(childFam.id)
  }

  // ─── Step 4: sort children by birth_order / birth_date / name ─────
  const childKey = (fam: Family): readonly [number, number, string] => {
    // The order anchor is the SENIOR partner of the child-family
    // (the one with a parent in the population). Use partnerA as a
    // stable default.
    const m = fam.partnerA
    const order = m.birth_order ?? Number.POSITIVE_INFINITY
    const date = m.birth_date ? new Date(m.birth_date).getTime() : Number.POSITIVE_INFINITY
    const name = m.first_name || ''
    return [order, date, name]
  }
  for (const fam of familyById.values()) {
    fam.children.sort((a, b) => {
      const [ao, ad, an] = childKey(a)
      const [bo, bd, bn] = childKey(b)
      if (ao !== bo) return ao - bo
      if (ad !== bd) return ad - bd
      return an.localeCompare(bn, 'he')
    })
  }

  // ─── Step 5: find roots and assign generations ────────────────────
  const roots: Family[] = []
  for (const fam of familyById.values()) {
    if (!isChildFamily.has(fam.id)) roots.push(fam)
  }
  roots.sort((a, b) => a.id.localeCompare(b.id))
  // BFS to assign generation numbers
  for (const root of roots) {
    const queue: Array<{ fam: Family; gen: number }> = [{ fam: root, gen: 0 }]
    while (queue.length) {
      const { fam, gen } = queue.shift()!
      fam.generation = Math.max(fam.generation, gen)
      for (const c of fam.children) queue.push({ fam: c, gen: gen + 1 })
    }
  }

  // ─── Step 6: bottom-up width pass ─────────────────────────────────
  function computeWidth(fam: Family): number {
    fam.coupleW = fam.partnerB ? (2 * NODE_W + SPOUSE_GAP) : NODE_W
    if (fam.children.length === 0) {
      fam.childrenBlockW = 0
      fam.subtreeW = fam.coupleW
      return fam.subtreeW
    }
    let block = 0
    for (let i = 0; i < fam.children.length; i++) {
      block += computeWidth(fam.children[i])
      if (i < fam.children.length - 1) block += SIBLING_GAP
    }
    fam.childrenBlockW = block
    fam.subtreeW = Math.max(fam.coupleW, block)
    return fam.subtreeW
  }
  for (const r of roots) computeWidth(r)

  // ─── Step 7: top-down placement ────────────────────────────────────
  const xPosOfMember = new Map<string, number>()
  const yPosOfMember = new Map<string, number>()

  function place(fam: Family, leftX: number, rowY: number): void {
    fam.rowY = rowY
    const blockCentreX = leftX + fam.subtreeW / 2
    fam.unionCentreX = blockCentreX

    // Place couple centred on blockCentreX
    const coupleLeftX = blockCentreX - fam.coupleW / 2
    xPosOfMember.set(fam.partnerA.id, coupleLeftX)
    yPosOfMember.set(fam.partnerA.id, rowY)
    if (fam.partnerB) {
      xPosOfMember.set(fam.partnerB.id, coupleLeftX + NODE_W + SPOUSE_GAP)
      yPosOfMember.set(fam.partnerB.id, rowY)
    }

    // Place children block centred on blockCentreX
    if (fam.children.length > 0) {
      const childrenLeftX = blockCentreX - fam.childrenBlockW / 2
      const childRowY = rowY + NODE_H + GENERATION_GAP
      let cursorX = childrenLeftX
      for (const c of fam.children) {
        place(c, cursorX, childRowY)
        cursorX += c.subtreeW + SIBLING_GAP
      }
    }
  }

  let rootCursorX = 0
  for (const root of roots) {
    place(root, rootCursorX, 0)
    rootCursorX += root.subtreeW + SIBLING_GAP * 2
  }

  // ─── Step 8: build LayoutNode list ────────────────────────────────
  // Generation is taken from the family the member is a partner of.
  // (Conceptually each generation is one family-row deep, so partners
  // share the row of their family.)
  const genOfMember = new Map<string, number>()
  const rowYOfMember = new Map<string, number>()
  for (const fam of familyById.values()) {
    genOfMember.set(fam.partnerA.id, fam.generation)
    rowYOfMember.set(fam.partnerA.id, fam.rowY)
    if (fam.partnerB) {
      genOfMember.set(fam.partnerB.id, fam.generation)
      rowYOfMember.set(fam.partnerB.id, fam.rowY)
    }
  }

  const nodes: LayoutNode[] = []
  for (const m of members) {
    const x = xPosOfMember.get(m.id)
    if (x == null) continue
    const y = rowYOfMember.get(m.id) ?? 0
    nodes.push({
      member: m,
      x, y,
      generation: genOfMember.get(m.id) ?? 0,
      secondaryPartners: secondaryPartnersOf.get(m.id),
    })
  }

  // ─── Step 9: build connector plans ────────────────────────────────
  const connectorPlans: ConnectorPlan[] = []
  for (const fam of familyById.values()) {
    const plan: ConnectorPlan = {}

    if (fam.partnerB) {
      const ax = xPosOfMember.get(fam.partnerA.id)!
      const bx = xPosOfMember.get(fam.partnerB.id)!
      const ay = fam.rowY
      // Spouse line — edge-of-avatar A to edge-of-avatar B, at avatar centre Y.
      plan.spouse = {
        x1: ax + NODE_W - AVATAR_PAD,
        x2: bx + AVATAR_PAD,
        y: ay + AVATAR_PAD + AVATAR / 2,
      }
    }

    if (fam.children.length > 0) {
      const parentBottomY = fam.rowY + NODE_H
      const firstChild = fam.children[0]
      const childRowY = firstChild.rowY
      const railY = (parentBottomY + childRowY) / 2

      // Per-child stem endpoint Y. For a child whose family is a
      // COUPLE, the stem must end at the SPOUSE LINE Y (the bar that
      // joins the two cards), because there's no card at the union
      // centre X — only the gap between partners. For a single-child
      // family the stem ends at the top of the lone card.
      const railLeftX = Math.min(...fam.children.map((c) => c.unionCentreX))
      const railRightX = Math.max(...fam.children.map((c) => c.unionCentreX))

      plan.rail = {
        dropTopY: parentBottomY,
        dropBottomY: railY,
        dropX: fam.unionCentreX,
        railLeftX,
        railRightX,
        railY,
        childStems: fam.children.map((c) => {
          const x = c.unionCentreX
          const isCouple = c.partnerB != null
          // spouseLineY = top of card + AVATAR_PAD + AVATAR/2 (avatar centre)
          const stemBottomY = isCouple
            ? childRowY + AVATAR_PAD + AVATAR / 2
            : childRowY
          return { x, topY: stemBottomY }
        }),
      }
    }

    if (plan.spouse || plan.rail) connectorPlans.push(plan)
  }

  return { nodes, connectorPlans }
}
