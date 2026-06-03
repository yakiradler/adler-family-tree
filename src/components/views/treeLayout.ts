// ─────────────────────────────────────────────────────────────────────
// Tree layout engine — clean rewrite for the base rebuild.
// ─────────────────────────────────────────────────────────────────────
//
// Design principles (priority order):
//
//   1. SYMMETRY. A couple is always drawn side-by-side at the same Y.
//      Children are centred under their parents. The whole subtree
//      reads as a mirror image around its own centre.
//
//   2. DETERMINISTIC PLACEMENT. Every member has exactly one (x, y)
//      derived from its generation and its position inside its sibling
//      group. Same input always produces the same output.
//
//   3. NO OVERLAP. Two cards never share the same bounding box. Width
//      calculations bubble up so every parent slot is at least as
//      wide as its children block. A defensive same-generation sweep
//      enforces the invariant even on malformed input.
//
//   4. CONNECTORS FROM MOTHER. Parent-child links anchor at the
//      mother's card (with explicit `connector_parent_id` override
//      respected). Spouse links are a horizontal line between the
//      pair. No line ever ends in empty space — the renderer
//      derives all geometry from this engine's output.
//
//   5. EXCLUSIONS ARE ABSOLUTE. `hidden=true` members are stripped by
//      applyTreeFilters before the engine sees them. The engine has
//      no special-case for hidden members.
//
// Coordinates: x grows right, y grows down. The canvas is pixel-LTR;
// the page chrome may be RTL but the tree itself uses LTR coordinates
// and the gender placement keeps the visual order consistent.
// ─────────────────────────────────────────────────────────────────────

import type { Member, Relationship, SpouseStatus } from '../../types'

// ─── Dimensions ──────────────────────────────────────────────────────
export const AVATAR = 64
export const NODE_W = AVATAR + 72     // 136
export const NODE_H = AVATAR + 62     // 126
export const H_GAP = 28               // between siblings
export const V_GAP = 110              // between generations
export const COUPLE_GAP = 32          // inside a couple
export const MIN_SIDE_GAP = 16        // anti-collision floor

// LayoutMode is kept in the public API for back-compat. Only 'classic'
// has an effect — the alternate cluster shapes are kept as stubs.
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
  /** Ex / deceased partners shown as small badges below the card.
   *  Populated only when `options.showFormerSpouses` is true. */
  secondaryPartners?: SecondaryPartner[]
}

// Visual constants consumed by the renderer.
export const SECONDARY_PARTNER_SIZE = 36
export const SECONDARY_PARTNER_TOP_OFFSET = NODE_H + 6

// Cluster helpers kept as classic-only stubs (existing imports won't
// break, but the new layout doesn't fan-out via clusters any more).
interface Placement { dx: number; dy: number }
interface ClusterResult { placements: Placement[]; width: number; height: number }

export function clusterClassic(n: number): ClusterResult {
  const width = n * NODE_W + Math.max(0, n - 1) * H_GAP
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) placements.push({ dx: i * (NODE_W + H_GAP), dy: 0 })
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
  /** When true, ex/deceased partners surface as small badges beneath
   *  their card. When false (default) they are excluded entirely. */
  showFormerSpouses?: boolean
}

export function buildLayout(
  members: Member[],
  relationships: Relationship[],
  _mode: LayoutMode = 'classic',
  options: LayoutOptions = {},
): LayoutNode[] {
  if (members.length === 0) return []
  const showFormerSpouses = options.showFormerSpouses ?? false

  // ─── Step 1: adjacency maps ────────────────────────────────────────
  const memberById = new Map(members.map((m) => [m.id, m]))
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const currentSpouseOf = new Map<string, string>()
  const secondaryPartnersOf = new Map<string, SecondaryPartner[]>()

  for (const r of relationships) {
    if (!memberById.has(r.member_a_id) || !memberById.has(r.member_b_id)) continue

    if (r.type === 'parent-child') {
      const list = parentsOf.get(r.member_b_id) ?? []
      if (!list.includes(r.member_a_id)) list.push(r.member_a_id)
      parentsOf.set(r.member_b_id, list)

      const kids = childrenOf.get(r.member_a_id) ?? []
      if (!kids.includes(r.member_b_id)) kids.push(r.member_b_id)
      childrenOf.set(r.member_a_id, kids)
      continue
    }

    if (r.type === 'spouse') {
      const status = (r.status ?? 'current') as SpouseStatus
      if (status === 'current') {
        // One-to-one pairing — first 'current' tie wins for each member.
        if (!currentSpouseOf.has(r.member_a_id)) currentSpouseOf.set(r.member_a_id, r.member_b_id)
        if (!currentSpouseOf.has(r.member_b_id)) currentSpouseOf.set(r.member_b_id, r.member_a_id)
      } else if (showFormerSpouses) {
        const push = (owner: string, partner: string) => {
          const partnerMember = memberById.get(partner)
          if (!partnerMember) return
          const list = secondaryPartnersOf.get(owner) ?? []
          if (!list.some((p) => p.member.id === partner)) {
            list.push({ member: partnerMember, status })
            secondaryPartnersOf.set(owner, list)
          }
        }
        push(r.member_a_id, r.member_b_id)
        push(r.member_b_id, r.member_a_id)
      }
    }
  }

  // ─── Step 2: couples ───────────────────────────────────────────────
  // For every current couple, pick ONE partner as the "primary" used
  // for tree traversal. The one with descendants wins; tie-broken by
  // member id for stable ordering across re-renders.
  const primaryOf = new Map<string, string>()
  const partnerOfPrimary = new Map<string, string>()
  const handled = new Set<string>()
  for (const m of members) {
    if (handled.has(m.id)) continue
    const spouseId = currentSpouseOf.get(m.id)
    if (!spouseId || handled.has(spouseId)) {
      primaryOf.set(m.id, m.id)
      handled.add(m.id)
      continue
    }
    const aKids = (childrenOf.get(m.id) ?? []).length
    const bKids = (childrenOf.get(spouseId) ?? []).length
    const primary = aKids > bKids ? m.id : bKids > aKids ? spouseId : (m.id < spouseId ? m.id : spouseId)
    const partner = primary === m.id ? spouseId : m.id
    primaryOf.set(m.id, primary)
    primaryOf.set(spouseId, primary)
    partnerOfPrimary.set(primary, partner)
    handled.add(m.id)
    handled.add(spouseId)
  }

  // ─── Step 3: combined children per primary ────────────────────────
  const siblingSort = (aId: string, bId: string): number => {
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

  const kidsOfPrimary = new Map<string, string[]>()
  for (const m of members) {
    if (primaryOf.get(m.id) !== m.id) continue
    const partner = partnerOfPrimary.get(m.id)
    const mine = childrenOf.get(m.id) ?? []
    const theirs = partner ? (childrenOf.get(partner) ?? []) : []
    const merged = Array.from(new Set([...mine, ...theirs]))
      .filter((id) => memberById.has(id))
      .sort(siblingSort)
    kidsOfPrimary.set(m.id, merged)
  }

  // ─── Step 4: generations (iterative fixpoint) ──────────────────────
  const genOf = new Map<string, number>()
  for (const m of members) genOf.set(m.id, 0)
  const safetyCap = members.length * 2 + 10
  let pass = 0, mutated = true
  while (mutated && pass++ < safetyCap) {
    mutated = false
    for (const m of members) {
      const ps = parentsOf.get(m.id) ?? []
      if (ps.length === 0) continue
      const parentMax = Math.max(...ps.map((p) => genOf.get(p) ?? 0))
      const want = parentMax + 1
      if ((genOf.get(m.id) ?? 0) < want) {
        genOf.set(m.id, want)
        mutated = true
      }
    }
    for (const [a, b] of currentSpouseOf) {
      const ga = genOf.get(a) ?? 0
      const gb = genOf.get(b) ?? 0
      if (ga !== gb) {
        const max = Math.max(ga, gb)
        if (ga < max) { genOf.set(a, max); mutated = true }
        if (gb < max) { genOf.set(b, max); mutated = true }
      }
    }
  }

  // ─── Step 5: layout roots ──────────────────────────────────────────
  const layoutRoots: string[] = []
  for (const m of members) {
    if (primaryOf.get(m.id) !== m.id) continue
    const partner = partnerOfPrimary.get(m.id)
    const aHasParent = (parentsOf.get(m.id) ?? []).length > 0
    const bHasParent = partner ? (parentsOf.get(partner) ?? []).length > 0 : false
    if (!aHasParent && !bHasParent) layoutRoots.push(m.id)
  }
  layoutRoots.sort()

  // ─── Step 6: subtree widths ────────────────────────────────────────
  const swCache = new Map<string, number>()
  function subtreeWidth(primaryId: string): number {
    const cached = swCache.get(primaryId)
    if (cached != null) return cached
    const hasPartner = partnerOfPrimary.has(primaryId)
    const coupleW = hasPartner ? (2 * NODE_W + COUPLE_GAP) : NODE_W
    const kids = kidsOfPrimary.get(primaryId) ?? []
    let kidsW = 0
    if (kids.length > 0) {
      const kidWidths = kids.map((k) => subtreeWidth(primaryOf.get(k) ?? k))
      kidsW = kidWidths.reduce((s, x) => s + x, 0) + Math.max(0, kids.length - 1) * H_GAP
    }
    const w = Math.max(coupleW, kidsW)
    swCache.set(primaryId, w)
    return w
  }
  for (const root of layoutRoots) subtreeWidth(root)

  // ─── Step 7: placement (top-down DFS) ──────────────────────────────
  const xPos = new Map<string, number>()
  const placed = new Set<string>()

  function place(primaryId: string, leftX: number): void {
    if (placed.has(primaryId)) return
    placed.add(primaryId)
    const partner = partnerOfPrimary.get(primaryId)
    if (partner) placed.add(partner)

    const totalW = subtreeWidth(primaryId)
    const hasPartner = partner != null
    const kids = kidsOfPrimary.get(primaryId) ?? []

    // Place children first, then centre the couple over their visual
    // middle. Guarantees parents always sit directly above their kids.
    let coupleCentre: number
    if (kids.length > 0) {
      const kidPrimaries = kids.map((k) => primaryOf.get(k) ?? k)
      const kidWidths = kidPrimaries.map((p) => subtreeWidth(p))
      const kidsBlockW = kidWidths.reduce((s, x) => s + x, 0) + Math.max(0, kids.length - 1) * H_GAP
      let cursorX = leftX + (totalW - kidsBlockW) / 2
      for (let i = 0; i < kids.length; i++) {
        place(kidPrimaries[i], cursorX)
        cursorX += kidWidths[i] + H_GAP
      }
      const childCentres = kids
        .map((k) => xPos.get(k))
        .filter((x): x is number => x != null)
        .map((x) => x + NODE_W / 2)
      coupleCentre = childCentres.length > 0
        ? (Math.min(...childCentres) + Math.max(...childCentres)) / 2
        : leftX + totalW / 2
    } else {
      coupleCentre = leftX + totalW / 2
    }

    // Position the couple. Father (male) → LEFT, mother (female) →
    // RIGHT. For same-gender pairs the primary takes the left slot.
    // This keeps the spouse line direction and the mother-anchor
    // visually consistent across every couple in the tree.
    if (!hasPartner) {
      xPos.set(primaryId, coupleCentre - NODE_W / 2)
      return
    }
    const primaryMember = memberById.get(primaryId)!
    const partnerMember = memberById.get(partner!)!
    const primaryIsLeft =
      primaryMember.gender === 'male' ? true :
      partnerMember.gender === 'male' ? false :
      true
    const leftSlot = coupleCentre - COUPLE_GAP / 2 - NODE_W
    const rightSlot = coupleCentre + COUPLE_GAP / 2
    if (primaryIsLeft) {
      xPos.set(primaryId, leftSlot)
      xPos.set(partner!, rightSlot)
    } else {
      xPos.set(partner!, leftSlot)
      xPos.set(primaryId, rightSlot)
    }
  }

  let cursorX = 0
  for (const root of layoutRoots) {
    place(root, cursorX)
    cursorX += subtreeWidth(root) + H_GAP * 2
  }
  for (const m of members) {
    if (xPos.has(m.id)) continue
    xPos.set(m.id, cursorX)
    cursorX += NODE_W + H_GAP
  }

  // ─── Step 8: anti-collision sweep per generation ──────────────────
  const byGen = new Map<number, string[]>()
  for (const m of members) {
    const g = genOf.get(m.id) ?? 0
    const list = byGen.get(g) ?? []
    list.push(m.id)
    byGen.set(g, list)
  }
  for (const [, ids] of byGen) {
    ids.sort((a, b) => (xPos.get(a) ?? 0) - (xPos.get(b) ?? 0))
    for (let i = 1; i < ids.length; i++) {
      const prevRight = (xPos.get(ids[i - 1]) ?? 0) + NODE_W
      const curLeft = xPos.get(ids[i]) ?? 0
      if (curLeft < prevRight + MIN_SIDE_GAP) {
        xPos.set(ids[i], prevRight + MIN_SIDE_GAP)
      }
    }
  }

  // ─── Step 9: Y per generation ──────────────────────────────────────
  const maxGen = Math.max(0, ...Array.from(genOf.values()))
  const yOfGen = new Map<number, number>()
  for (let g = 0; g <= maxGen; g++) yOfGen.set(g, g * (NODE_H + V_GAP))

  // ─── Step 10: emit LayoutNode list ────────────────────────────────
  const out: LayoutNode[] = []
  for (const m of members) {
    const x = xPos.get(m.id)
    if (x == null) continue
    const g = genOf.get(m.id) ?? 0
    const y = yOfGen.get(g) ?? 0
    const partners = secondaryPartnersOf.get(m.id)
    out.push({
      member: m,
      x,
      y,
      generation: g,
      secondaryPartners: partners && partners.length > 0 ? partners : undefined,
    })
  }
  return out
}
