// ─────────────────────────────────────────────────────────────────────
// Single source of truth for card geometry and connector anchor points.
//
// EVERY consumer of node geometry — MemberNode (the card), the SVG
// connector layer, the minimap, the export renderer and the layout
// engine itself — must import from this file and nowhere else. Lines
// "float in air" exactly when two renderers disagree about where a
// card's edge is; centralising the numbers makes that disagreement
// impossible.
//
// The card is rendered by MemberNode.tsx as:
//   • a story-ring avatar: AVATAR px photo + INNER_PAD white + RING
//     gradient padding  → ring outer diameter = AVATAR + 2*(RING+INNER_PAD)
//   • a white card below it, overlapped by the avatar.
// The node wrapper is given an exact CARD.W × CARD.H box (enforced in
// the tree renderer) so the anchors below are true by construction.
// ─────────────────────────────────────────────────────────────────────

export const CARD = {
  /** Card/slot width in px. */
  W: 136,
  /**
   * Card/slot height in px (avatar ring top → card bottom edge).
   * 134 = ring outer (74) − avatar/card overlap (24) + fixed white-card
   * body height (84). MemberNode enforces the same numbers, so the
   * `bottom` anchor is exact for every card regardless of content.
   */
  H: 134,
  /** Avatar photo diameter. */
  AVATAR: 64,
  /** Gradient ring thickness around the avatar. */
  RING: 3,
  /** White padding between ring and photo. */
  INNER_PAD: 2,
  /** How much the avatar ring overlaps the white card below it. */
  OVERLAP: 24,
} as const

/** Fixed pixel height of the white card body under the avatar ring. */
export const CARD_BODY_H =
  CARD.H - (CARD.AVATAR + 2 * (CARD.RING + CARD.INNER_PAD) - CARD.OVERLAP) // 84

export const GAPS = {
  /** Horizontal gap between sibling subtrees. */
  SIBLING: 28,
  /** Horizontal gap between the two cards of a couple. */
  COUPLE: 32,
  /** Horizontal gap between independent root subtrees. */
  SUBTREE: 64,
  /** Base vertical band between two generation rows. */
  GUTTER_MIN: 110,
  /** Vertical distance between stacked sibling-rails sharing a gutter. */
  RAIL_LANE_STEP: 14,
  /** First rail's offset below the top of its gutter. */
  RAIL_TOP_PAD: 44,
  /** Extra row height when a card shows ex/deceased partner badges. */
  BADGE_ROW_H: 44,
  /** Canvas padding on all sides of the layout bounds. */
  CANVAS_PAD: 32,
  /** X offset of a secondary-parent drop next to the primary drop. */
  SECONDARY_DROP_OFFSET: 8,
  /** Rounded-corner radius for connector elbows. */
  CORNER: 10,
} as const

/** Vertical centre of the avatar, measured from the card's top edge. */
export const AVATAR_CENTER_Y = CARD.RING + CARD.INNER_PAD + CARD.AVATAR / 2 // 37

/** Half the outer diameter of the avatar ring. */
export const RING_OUTER_HALF = CARD.AVATAR / 2 + CARD.RING + CARD.INNER_PAD // 37

export interface Point {
  x: number
  y: number
}

/**
 * Connector anchor kinds:
 *  - 'top'           top-centre of the avatar ring  (parent-child drop target)
 *  - 'top-secondary' same, offset by SECONDARY_DROP_OFFSET (second-parent drop)
 *  - 'bottom'        bottom-centre of the card      (parent-child trunk source)
 *  - 'spouse-left'   left  edge of the avatar ring  (spouse line endpoint)
 *  - 'spouse-right'  right edge of the avatar ring  (spouse line endpoint)
 */
export type AnchorKind = 'top' | 'top-secondary' | 'bottom' | 'spouse-left' | 'spouse-right'

/**
 * Exact pixel anchor on a card whose top-left corner is `pos`.
 * This is THE definition of where connectors are allowed to touch a card.
 */
export function anchor(pos: Point, kind: AnchorKind): Point {
  switch (kind) {
    case 'top':
      return { x: pos.x + CARD.W / 2, y: pos.y }
    case 'top-secondary':
      return { x: pos.x + CARD.W / 2 + GAPS.SECONDARY_DROP_OFFSET, y: pos.y }
    case 'bottom':
      return { x: pos.x + CARD.W / 2, y: pos.y + CARD.H }
    case 'spouse-left':
      return { x: pos.x + CARD.W / 2 - RING_OUTER_HALF, y: pos.y + AVATAR_CENTER_Y }
    case 'spouse-right':
      return { x: pos.x + CARD.W / 2 + RING_OUTER_HALF, y: pos.y + AVATAR_CENTER_Y }
  }
}
