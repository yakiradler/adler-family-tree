import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { LayoutNode } from './treeLayout'

/**
 * Bird's-eye overview of the tree, parked in the bottom corner.
 *
 * The minimap renders one dot per visible member and a rectangle
 * outlining what the main canvas currently shows. Clicking anywhere on
 * the minimap (or dragging the rectangle) re-centres the main view on
 * the picked point — invaluable on dense Adler-sized trees where the
 * default "fit" zoom is too far out to read names but panning around
 * blind is a chore.
 *
 * Design notes:
 *   • Pure SVG so the visual is crisp at any DPR and there's nothing
 *     to memoise per dot.
 *   • Aspect-ratio matches the actual canvas (canvasW × canvasH) so
 *     the viewport rectangle stays geometrically faithful.
 *   • Width is fixed at 180 px; height is derived. We cap height so a
 *     very tall tree doesn't push the minimap off-screen on mobile.
 *   • Anchored on the opposite corner from the +/−/fit controls so
 *     they never overlap.
 */

const MM_WIDTH = 180
const MM_MAX_HEIGHT = 130

export interface TreeMiniMapProps {
  nodes: LayoutNode[]
  canvasW: number
  canvasH: number
  /** Current pan offsets (px) of the main canvas. */
  tx: number
  ty: number
  /** Current zoom factor of the main canvas. */
  scale: number
  /** Viewport (the visible window in screen px) — used for the rect. */
  viewportW: number
  viewportH: number
  /** Called with NEW canvas-space pan offsets when the user picks a spot. */
  onNavigate: (tx: number, ty: number) => void
  /** Current scale % to surface in the header. The previous standalone
   *  zoom badge was retired so the minimap is the single source of
   *  "where am I and how zoomed in". */
  scalePercent: number
}

export default function TreeMiniMap({
  nodes, canvasW, canvasH, tx, ty, scale,
  viewportW, viewportH, onNavigate, scalePercent,
}: TreeMiniMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)
  // Collapsed state — lets the user dismiss the minimap without
  // affecting any other UI. Persisted in localStorage so refresh
  // honours the previous choice.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ft-minimap-collapsed') === '1'
  })
  useEffect(() => {
    try { window.localStorage.setItem('ft-minimap-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  // Map canvas coords → minimap coords. We use the LARGER of the two
  // ratios so the minimap rectangle matches whichever dimension is the
  // binding constraint (and we letterbox the other axis with empty
  // space on top of the gradient — cheap, hard to misread).
  const { mmW, mmH, mmScale } = useMemo(() => {
    if (canvasW <= 0 || canvasH <= 0) {
      return { mmW: MM_WIDTH, mmH: 90, mmScale: 1 }
    }
    const sW = MM_WIDTH / canvasW
    const sH = MM_MAX_HEIGHT / canvasH
    const s = Math.min(sW, sH)
    return {
      mmW: Math.max(60, Math.round(canvasW * s)),
      mmH: Math.max(40, Math.round(canvasH * s)),
      mmScale: s,
    }
  }, [canvasW, canvasH])

  // Viewport rectangle in minimap coords. (-tx/scale, -ty/scale) is the
  // top-left of the visible canvas window in canvas coords; size is
  // viewportW/scale × viewportH/scale.
  const viewportRect = useMemo(() => {
    if (scale <= 0) return { x: 0, y: 0, w: mmW, h: mmH }
    const x = (-tx / scale) * mmScale
    const y = (-ty / scale) * mmScale
    const w = (viewportW / scale) * mmScale
    const h = (viewportH / scale) * mmScale
    return { x, y, w, h }
  }, [tx, ty, scale, viewportW, viewportH, mmScale, mmW, mmH])

  // Translate a click at (mx, my) in MINIMAP coords into (tx, ty) for the
  // MAIN canvas such that the click point ends up at the CENTRE of the
  // visible viewport. Keeps "click here to look here" feeling natural.
  const navigateTo = (mx: number, my: number) => {
    if (mmScale <= 0) return
    const canvasCx = mx / mmScale
    const canvasCy = my / mmScale
    const newTx = viewportW / 2 - canvasCx * scale
    const newTy = viewportH / 2 - canvasCy * scale
    onNavigate(newTx, newTy)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    svgRef.current.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const rect = svgRef.current.getBoundingClientRect()
    navigateTo(e.clientX - rect.left, e.clientY - rect.top)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    navigateTo(e.clientX - rect.left, e.clientY - rect.top)
  }
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    try { svgRef.current.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    draggingRef.current = false
  }

  // Minimap is anchored to the PHYSICAL bottom-left (`left-4`) — the
  // zoom controls live at physical bottom-right and the two would
  // collide if we mirrored on RTL. `left-` in Tailwind is a physical
  // utility, so this stays consistent regardless of document direction.
  const sideClass = 'left-4'

  if (collapsed) {
    return (
      <motion.button
        type="button"
        onClick={() => setCollapsed(false)}
        whileTap={{ scale: 0.92 }}
        className={`absolute bottom-4 ${sideClass} z-10 w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center active:scale-95 transition`}
        aria-label="Show minimap"
        title="Show minimap"
      >
        {/* tiny tree-grid glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="#007AFF" strokeWidth="1.4" />
          <circle cx="5" cy="5" r="1" fill="#007AFF" />
          <circle cx="11" cy="5" r="1" fill="#007AFF" />
          <circle cx="5" cy="11" r="1" fill="#007AFF" />
          <circle cx="11" cy="11" r="1" fill="#007AFF" />
        </svg>
      </motion.button>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute bottom-4 ${sideClass} z-10 glass-strong shadow-glass rounded-2xl overflow-hidden`}
      style={{ width: mmW + 12, padding: 6 }}
    >
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-[10px] font-bold text-[#007AFF] tabular-nums">
          {/* Doubles as the zoom indicator — the previous standalone
              badge at bottom-left used to live here and is now folded
              into the minimap so the corner stays uncluttered. */}
          {Math.round(scalePercent)}%
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="w-5 h-5 rounded-full hover:bg-black/5 flex items-center justify-center text-[#8E8E93]"
          aria-label="Hide minimap"
          title="Hide minimap"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <svg
        ref={svgRef}
        width={mmW}
        height={mmH}
        viewBox={`0 0 ${mmW} ${mmH}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          touchAction: 'none',
          cursor: draggingRef.current ? 'grabbing' : 'crosshair',
          background:
            'linear-gradient(135deg, rgba(0,122,255,0.05), rgba(50,173,230,0.07))',
          borderRadius: 10,
          display: 'block',
        }}
      >
        {/* Dots — one per member. Centre-of-card position so the dot
            sits where the avatar actually renders. We approximate the
            avatar centre as NODE_W/2, AVATAR/2 from the layout origin —
            but the dots are tiny enough that ±a few px doesn't matter. */}
        {nodes.map((n) => (
          <circle
            key={n.member.id}
            cx={(n.x + 50) * mmScale}
            cy={(n.y + 50) * mmScale}
            r={1.6}
            fill={n.member.gender === 'female' ? '#FF7AA8' : '#3D8BFD'}
            opacity={0.85}
          />
        ))}
        {/* Viewport rectangle — clamp inside the SVG so when the user
            zooms way out the rect doesn't visually exceed the map. */}
        <rect
          x={Math.max(0, viewportRect.x)}
          y={Math.max(0, viewportRect.y)}
          width={Math.max(8, Math.min(mmW - Math.max(0, viewportRect.x), viewportRect.w))}
          height={Math.max(8, Math.min(mmH - Math.max(0, viewportRect.y), viewportRect.h))}
          fill="rgba(0,122,255,0.10)"
          stroke="#007AFF"
          strokeWidth="1.4"
          rx="3"
        />
      </svg>
    </motion.div>
  )
}
