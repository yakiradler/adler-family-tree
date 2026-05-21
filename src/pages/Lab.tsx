import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import MemberNode from '../components/MemberNode'
import type { Member } from '../types'

// Experimental tree-editor playground.
// Lives at /lab — completely isolated from the main app's Zustand
// store so the user can break things freely without touching the
// real family data.
//
// Architecture (mirrors the production /tree page so the playground
// FEELS like the real app, not a placeholder):
//   • Pan + pinch-zoom inherited verbatim from TreeView — same
//     transform-on-wrapper approach, same wheel / mouse / touch math.
//     Local viewport state, not the store's, so /lab doesn't fight
//     /tree over the camera.
//   • Member cards are the real MemberNode component (gender ring,
//     proper avatar, name, RIP/Kohen badges). Identical look-and-feel
//     to /tree.
//   • Connectors are the NEW behaviour being prototyped: smooth
//     Bezier curves with grabbable handles at the child end. Drag
//     within SNAP_RADIUS of a member to re-bind; release in empty
//     space to leave the edge dangling (rendered green).
//
// Pointer-capture is used for handle drags so the pan handler on the
// outer wrapper doesn't fight the handle-drag — the handle "owns"
// the pointer once it's grabbed.

// ── Constants ──────────────────────────────────────────────────────
const SNAP_RADIUS = 90        // world-units (pre-zoom) for snap detection
const NODE_W = 144            // matches MemberNode card width @ default size
const NODE_H = 138            // matches MemberNode card height @ default size
const AVATAR = 72             // MemberNode default avatar diameter
const TOP_ANCHOR_OFFSET = 12  // distance from card top down to where parent connector lands
const BOTTOM_ANCHOR_OFFSET = NODE_H - 20

// ── Seed: small family to play with ──────────────────────────────
function makeMember(id: string, first: string, gender: 'male' | 'female'): Member {
  return { id, first_name: first, last_name: 'ניסוי', gender, created_by: 'lab' }
}

const SEED_MEMBERS: Member[] = [
  makeMember('mom', 'אמא', 'female'),
  makeMember('dad', 'אבא', 'male'),
  makeMember('c1', 'ילד 1', 'male'),
  makeMember('c2', 'ילדה 2', 'female'),
  makeMember('c3', 'ילד 3', 'male'),
]

// World-coordinate positions (pre-zoom). The auto-fit effect picks
// a scale that makes the whole family visible on mount, so these
// stay in a fixed "design canvas" regardless of viewport size.
const SEED_POSITIONS: Record<string, { x: number; y: number }> = {
  mom: { x: 180, y:   0 },
  dad: { x: 360, y:   0 },
  c1:  { x:  60, y: 240 },
  c2:  { x: 270, y: 240 },
  c3:  { x: 480, y: 240 },
}

interface LabEdge {
  id: string
  /** Parent member id — the "source" end of the connector. Fixed. */
  source: string
  /** Child member id, or null when the edge is dangling. */
  target: string | null
}

const SEED_EDGES: LabEdge[] = [
  { id: 'e1', source: 'mom', target: 'c1' },
  { id: 'e2', source: 'mom', target: null }, // demonstrates the dangling/green state
]

// Bezier path with control points at the vertical midpoint. From the
// user's PoC — eases the line out of the parent and into the child
// without sharp elbows.
function bezierPath(sx: number, sy: number, ex: number, ey: number): string {
  const dy = Math.abs(ey - sy)
  const cy1 = sy + dy * 0.5
  const cy2 = ey - dy * 0.5
  return `M ${sx} ${sy} C ${sx} ${cy1}, ${ex} ${cy2}, ${ex} ${ey}`
}

// Card anchors. Cards are positioned with their top-left at (x,y), so
// the bottom-centre / top-centre attachments are simple offsets.
function bottomAnchor(p: { x: number; y: number }) {
  return { x: p.x + NODE_W / 2, y: p.y + BOTTOM_ANCHOR_OFFSET }
}
function topAnchor(p: { x: number; y: number }) {
  return { x: p.x + NODE_W / 2, y: p.y + TOP_ANCHOR_OFFSET }
}

export default function Lab() {
  const navigate = useNavigate()
  const { lang } = useLang()
  const rtl = isRTL(lang)

  // ── Data state ───────────────────────────────────────────────────
  const [members] = useState<Member[]>(SEED_MEMBERS)
  const [positions] = useState<Record<string, { x: number; y: number }>>(SEED_POSITIONS)
  const [edges, setEdges] = useState<LabEdge[]>(SEED_EDGES)
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  // ── Viewport (pan + zoom) ────────────────────────────────────────
  // Same model as TreeView: a single transform on the canvas inner
  // wrapper. Local state so /lab is independent from /tree.
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [initialised, setInitialised] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  type TouchMode =
    | { mode: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initialDist: number; initialScale: number; cx: number; cy: number; tx0: number; ty0: number }
  const touchState = useRef<TouchMode | null>(null)

  // Canvas world-bounds — computed from the seed positions, padded.
  const PAD = 80
  const maxX = Math.max(...Object.values(positions).map((p) => p.x + NODE_W)) + PAD
  const maxY = Math.max(...Object.values(positions).map((p) => p.y + NODE_H)) + PAD
  const minX = Math.min(...Object.values(positions).map((p) => p.x), 0) - PAD
  const canvasW = maxX - minX
  const canvasH = maxY + PAD
  const offsetX = -minX

  // Auto-fit on mount — scale so the whole design canvas is visible,
  // then centre it. After this fires once, the user owns the camera.
  useEffect(() => {
    if (initialised) return
    const el = wrapRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const fitW = (w - 48) / canvasW
    const fitH = (h - 160) / canvasH
    const s = Math.max(0.3, Math.min(1.2, Math.min(fitW, fitH)))
    setScale(s)
    setTx((w - canvasW * s) / 2)
    setTy(80)
    setInitialised(true)
  }, [initialised, canvasW, canvasH])

  // Wheel zoom — anchored on the cursor so zooming in keeps the
  // pointed-at point stationary on screen.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY * 0.0015
    const newScale = Math.max(0.1, Math.min(6, scale * (1 + delta)))
    const rect = wrapRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const wx = (cx - tx) / scale
    const wy = (cy - ty) / scale
    setTx(cx - wx * newScale)
    setTy(cy - wy * newScale)
    setScale(newScale)
  }

  // Mouse pan — only kicks in when the user clicks empty canvas;
  // handle-drag stops propagation so this never fires for handles.
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-lab-handle]')) return
    dragState.current = { startX: e.clientX, startY: e.clientY, tx0: tx, ty0: ty }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return
    setTx(dragState.current.tx0 + (e.clientX - dragState.current.startX))
    setTy(dragState.current.ty0 + (e.clientY - dragState.current.startY))
  }
  const onMouseUp = () => { dragState.current = null }

  // Touch pan + pinch-zoom — same math as TreeView. The handle's
  // pointer-capture takes precedence (handle uses pointer events,
  // these are touch events).
  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-lab-handle]')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
    } else if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      const cx = (a.clientX + b.clientX) / 2 - rect.left
      const cy = (a.clientY + b.clientY) / 2 - rect.top
      touchState.current = { mode: 'pinch', initialDist: dist, initialScale: scale, cx, cy, tx0: tx, ty0: ty }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const st = touchState.current
    if (!st) return
    if (st.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]
      setTx(st.tx0 + (t.clientX - st.startX))
      setTy(st.ty0 + (t.clientY - st.startY))
    } else if (st.mode === 'pinch' && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      const factor = dist / st.initialDist
      const newScale = Math.max(0.1, Math.min(6, st.initialScale * factor))
      const wx = (st.cx - st.tx0) / st.initialScale
      const wy = (st.cy - st.ty0) / st.initialScale
      setTx(st.cx - wx * newScale)
      setTy(st.cy - wy * newScale)
      setScale(newScale)
    }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touchState.current = null
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
    }
  }

  // Buttons that the user can tap to zoom in/out (handy on phones
  // where pinch is annoying when the gesture starts close to the
  // edge).
  const zoomBy = (factor: number) => {
    const newScale = Math.max(0.1, Math.min(6, scale * factor))
    const w = wrapRef.current?.clientWidth ?? 0
    const h = wrapRef.current?.clientHeight ?? 0
    const cx = w / 2, cy = h / 2
    const wx = (cx - tx) / scale
    const wy = (cy - ty) / scale
    setTx(cx - wx * newScale)
    setTy(cy - wy * newScale)
    setScale(newScale)
  }

  // ── Handle-drag (the "edit edge" interaction) ────────────────────
  // The handle uses Pointer Events with setPointerCapture so all
  // subsequent move/up events route to the handle even when the
  // pointer leaves its hit area. The pan handlers above check for
  // [data-lab-handle] and bail out, so the two systems don't fight.
  const [draggingEdge, setDraggingEdge] = useState<string | null>(null)
  const [hoverTarget, setHoverTarget] = useState<string | null>(null)
  // Pointer position in WORLD coords during a handle drag.
  const [worldPointer, setWorldPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale }
  }, [tx, ty, scale])

  const findSnapTarget = useCallback((wx: number, wy: number): string | null => {
    let best: string | null = null
    let bestDist = SNAP_RADIUS
    for (const m of members) {
      const pos = positions[m.id]
      if (!pos) continue
      const a = topAnchor(pos)
      const d = Math.hypot(wx - a.x, wy - a.y)
      if (d < bestDist) {
        bestDist = d
        best = m.id
      }
    }
    return best
  }, [members, positions])

  const onHandlePointerDown = useCallback((edgeId: string, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingEdge(edgeId)
    // Detach immediately so the line follows the cursor and turns green.
    setEdges((prev) => prev.map((edge) => (edge.id === edgeId ? { ...edge, target: null } : edge)))
    const w = clientToWorld(e.clientX, e.clientY)
    setWorldPointer(w)
    setHoverTarget(findSnapTarget(w.x, w.y))
  }, [clientToWorld, findSnapTarget])

  const onHandlePointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!draggingEdge) return
    const w = clientToWorld(e.clientX, e.clientY)
    setWorldPointer(w)
    setHoverTarget(findSnapTarget(w.x, w.y))
  }, [draggingEdge, clientToWorld, findSnapTarget])

  const onHandlePointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!draggingEdge) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    const target = hoverTarget
    setEdges((prev) =>
      prev.map((edge) => {
        if (edge.id !== draggingEdge) return edge
        if (target) {
          // eslint-disable-next-line no-console
          console.log(`[lab] edge ${edge.id}: ${edge.source} → ${target}`)
          return { ...edge, target }
        }
        // eslint-disable-next-line no-console
        console.log(`[lab] edge ${edge.id} released over empty space (dangling)`)
        return edge
      }),
    )
    setDraggingEdge(null)
    setHoverTarget(null)
  }, [draggingEdge, hoverTarget])

  // Double-click a card to spawn a fresh dangling edge from it. Lets
  // the user actually grow the structure beyond the seed.
  const spawnDanglingEdge = useCallback((sourceId: string) => {
    const newId = `e-${Date.now().toString(36)}`
    setEdges((prev) => [...prev, { id: newId, source: sourceId, target: null }])
  }, [])

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      dir={rtl ? 'rtl' : 'ltr'}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="w-full h-screen relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        background:
          'radial-gradient(at 12% 8%, rgba(120,170,255,0.35) 0px, transparent 50%),' +
          'radial-gradient(at 92% 12%, rgba(255,140,200,0.28) 0px, transparent 55%),' +
          'radial-gradient(at 78% 92%, rgba(120,255,220,0.25) 0px, transparent 55%),' +
          'radial-gradient(at 8% 96%, rgba(180,130,255,0.30) 0px, transparent 55%),' +
          'linear-gradient(135deg, #F4F7FF 0%, #FBF7FF 55%, #FFF5FA 100%)',
      }}
    >
      {/* Subtle dot grid behind the canvas — matches TreeView's
          background pattern so /lab feels native to the app. */}
      <div
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.55) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Header strip — sits ABOVE the transformed canvas so it stays
          fixed during pan/zoom. */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 py-3 flex items-center gap-2 pointer-events-none">
        <button
          onClick={() => navigate('/home')}
          className="pointer-events-auto bg-white/95 backdrop-blur rounded-full px-3 py-1.5 text-[13px] font-semibold text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
        >
          {rtl ? '← חזרה' : 'Back →'}
        </button>
        <div className="pointer-events-none flex-1 text-center text-[14px] font-bold text-[#1C1C1E]">
          {rtl ? '🧪 מעבדת קווים' : 'Lab — Tree edges'}
        </div>
        <div className="pointer-events-auto flex gap-1">
          <button
            onClick={() => zoomBy(0.8)}
            className="bg-white/95 backdrop-blur rounded-full w-8 h-8 font-semibold text-[18px] text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
            aria-label="zoom out"
          >−</button>
          <button
            onClick={() => zoomBy(1.25)}
            className="bg-white/95 backdrop-blur rounded-full w-8 h-8 font-semibold text-[18px] text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
            aria-label="zoom in"
          >+</button>
        </div>
      </div>

      {/* Hint strip — only on desktop where we have room. */}
      <div className="absolute top-14 inset-x-0 z-10 text-center text-[11px] text-[#8E8E93] pointer-events-none hidden md:block">
        {rtl
          ? 'גרירה: הזזת תצוגה • גלגלת/צביטה: זום • גרור עיגול בקצה הקו: שינוי יעד • הקשה כפולה על אדם: יצירת קו חדש'
          : 'Drag: pan • Wheel/pinch: zoom • Drag the line tip: re-target • Double-tap a member: new edge'}
      </div>

      {/* The transformed world — single source of truth for pan/zoom. */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: canvasW,
          height: canvasH,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {/* SVG layer for the connectors. Sized to the canvas world so
            the lines align pixel-perfect with the cards. */}
        <svg
          className="absolute pointer-events-none"
          style={{ left: 0, top: 0, overflow: 'visible' }}
          width={canvasW}
          height={canvasH}
        >
          <defs>
            <linearGradient id="lab-connected" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2B6BFF" />
              <stop offset="100%" stopColor="#6C47FF" />
            </linearGradient>
            <filter id="lab-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((edge) => {
            const sourcePos = positions[edge.source]
            if (!sourcePos) return null
            const isDragging = draggingEdge === edge.id
            // Translate to canvas-internal coords (offsetX shifts so
            // negative seed-x values don't render off-canvas).
            const start = bottomAnchor({ x: sourcePos.x + offsetX, y: sourcePos.y })

            let end: { x: number; y: number }
            let snapPreview: { x: number; y: number } | null = null
            if (isDragging) {
              end = { x: worldPointer.x + offsetX, y: worldPointer.y }
              if (hoverTarget) {
                const tpos = positions[hoverTarget]
                if (tpos) snapPreview = topAnchor({ x: tpos.x + offsetX, y: tpos.y })
              }
            } else if (edge.target) {
              const tpos = positions[edge.target]
              end = tpos ? topAnchor({ x: tpos.x + offsetX, y: tpos.y })
                         : { x: start.x, y: start.y + 90 }
            } else {
              end = { x: start.x, y: start.y + 90 }
            }

            const dangling = !edge.target && !isDragging
            const isGreen = dangling || (isDragging && !hoverTarget)
            const stroke = isGreen ? '#34C759' : 'url(#lab-connected)'
            const handleFill = isGreen ? '#34C759' : '#2B6BFF'

            return (
              <g key={edge.id} className="pointer-events-auto">
                <path
                  d={bezierPath(start.x, start.y, end.x, end.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={3}
                  strokeLinecap="round"
                  filter="url(#lab-glow)"
                  style={{ transition: isDragging ? 'none' : 'stroke 200ms' }}
                />
                {/* Snap-locking dashed preview when the user is hovering
                    a valid target — visually confirms the lock-on
                    before they release. */}
                {isDragging && snapPreview && (
                  <line
                    x1={snapPreview.x}
                    y1={snapPreview.y}
                    x2={end.x}
                    y2={end.y}
                    stroke="#34C759"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    opacity={0.6}
                  />
                )}
                {/* Big transparent touch target on top of a smaller
                    visible dot. Pointer-capture means once you start
                    a drag, the dot keeps receiving move/up events
                    until release — no need to keep the pointer
                    inside the visible circle. */}
                <circle
                  data-lab-handle
                  cx={end.x}
                  cy={end.y}
                  r={28 / Math.max(1, scale)}
                  fill="transparent"
                  className="cursor-grab active:cursor-grabbing"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => onHandlePointerDown(edge.id, e)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                />
                <circle
                  cx={end.x}
                  cy={end.y}
                  r={isDragging ? 14 : 10}
                  fill={handleFill}
                  stroke="#FFFFFF"
                  strokeWidth={2.5}
                  style={{
                    filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))',
                    transition: isDragging ? 'none' : 'r 150ms, fill 200ms',
                    pointerEvents: 'none',
                  }}
                />
              </g>
            )
          })}
        </svg>

        {/* Member cards — the SAME MemberNode used in the production
            tree, so the lab matches /tree visually pixel-for-pixel. */}
        {members.map((m) => {
          const pos = positions[m.id]
          if (!pos) return null
          const isSnapTarget = hoverTarget === m.id
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{
                opacity: 1,
                scale: isSnapTarget ? 1.06 : 1,
                left: pos.x + offsetX,
                top: pos.y,
              }}
              transition={{
                opacity: { duration: 0.25 },
                scale: { duration: 0.2 },
                left: { type: 'spring', stiffness: 180, damping: 26 },
                top: { type: 'spring', stiffness: 180, damping: 26 },
              }}
              className="absolute"
              style={{
                // Lift the snap-target card visually above its
                // siblings + give it a green halo so the user can
                // confirm the lock-on before releasing.
                filter: isSnapTarget ? 'drop-shadow(0 0 18px rgba(52,199,89,0.7))' : undefined,
                zIndex: isSnapTarget ? 5 : 1,
              }}
              onDoubleClick={() => spawnDanglingEdge(m.id)}
            >
              <MemberNode
                member={m}
                size={AVATAR}
                highlighted={isSnapTarget}
                dataMemberId={m.id}
              />
            </motion.div>
          )
        })}
      </div>

      {/* Bottom-left readout — shows live edge state so the user can
          confirm drags actually mutate data. Kept outside the
          transform so it stays a fixed-size HUD. */}
      <div className="absolute bottom-3 left-3 right-3 md:right-auto md:max-w-md z-20 bg-white/85 backdrop-blur rounded-2xl px-3 py-2 text-[11px] font-mono text-[#1C1C1E] shadow-sm border border-white/60 max-h-32 overflow-auto pointer-events-auto">
        <div className="font-bold mb-1 text-[#8E8E93]">
          {rtl ? 'מצב הקשרים (חי)' : 'Edges (live)'} · zoom {Math.round(scale * 100)}%
        </div>
        {edges.map((edge) => {
          const a = memberById.get(edge.source)?.first_name ?? '?'
          const b = edge.target
            ? memberById.get(edge.target)?.first_name ?? '?'
            : (rtl ? '— תלוש' : '— dangling')
          return (
            <div key={edge.id} className="leading-tight">
              <span className="text-[#8E8E93]">{edge.id}:</span> {a} → {b}
            </div>
          )
        })}
      </div>
    </div>
  )
}
