// ─────────────────────────────────────────────────────────────────────
// Multi-tree composition seam (foundation for the future "combined
// trees" view).
//
// Each tree keeps its own fully independent LayoutResult — total
// isolation of data and layout. Composition only decides a horizontal
// offset per tree; the renderer draws each layout inside its own
// `<g transform="translate(offsetX 0)">`.
//
// When cross-tree marriages ("bridges") are introduced later, they will
// be passed here and rendered as extra edges between the offset
// layouts — no engine changes required.
// ─────────────────────────────────────────────────────────────────────

import { GAPS } from './metrics'
import type { LayoutResult } from './types'

export interface ComposedTree {
  treeId: string | null
  layout: LayoutResult
  /** Horizontal offset the renderer applies to this tree's layer. */
  offsetX: number
}

export interface CompositeLayout {
  trees: ComposedTree[]
  bounds: { width: number; height: number }
}

export function composeLayouts(
  layouts: Array<{ treeId: string | null; layout: LayoutResult }>,
  opts: { gap?: number } = {},
): CompositeLayout {
  const gap = opts.gap ?? GAPS.SUBTREE * 2
  const trees: ComposedTree[] = []
  let cursor = 0
  let height = 0
  for (const { treeId, layout } of layouts) {
    trees.push({ treeId, layout, offsetX: cursor })
    cursor += layout.bounds.width + gap
    height = Math.max(height, layout.bounds.height)
  }
  return {
    trees,
    bounds: { width: Math.max(0, cursor - gap), height },
  }
}
