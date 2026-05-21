import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import MemberNode from '../components/MemberNode'
import type { Member } from '../types'

// Experimental tree-editor playground at /lab.
//
// Interaction model (the third revision — the user is iterating on
// the UX in tight cycles):
//
//   Profile card
//     • Single tap            → open the member's profile modal.
//     • Long-press (500ms)    → spawn a new dangling edge from
//                                that person. A green dot + green
//                                bezier stub appears below them.
//
//   Line (connector)
//     • Single tap            → nothing (lines look clean).
//     • Long-press (500ms)    → enter EDIT mode for that edge:
//                                handles appear at BOTH endpoints
//                                (source + target), a delete X
//                                floats by the midpoint, and the
//                                stroke gets a subtle highlight.
//
//   Handle (visible blue/green dot)
//     • Drag                  → re-target that endpoint. Within
//                                SNAP_RADIUS of a member's anchor
//                                it locks onto them; released over
//                                empty space → edge dangles green.
//
//   Empty canvas
//     • Drag                  → pan the camera (mouse + touch).
//     • Wheel / pinch         → zoom (cursor-anchored).
//     • Tap                   → exit any active EDIT mode.
//
// All long-press timers cancel if the pointer moves more than
// MOVE_TOLERANCE pixels — keeps pan gestures from accidentally
// triggering edits.

// ── Constants ──────────────────────────────────────────────────────
const SNAP_RADIUS     = 90    // world-units; pull-into-anchor distance
const NODE_W          = 144   // MemberNode card width @ default size
const NODE_H          = 138
const AVATAR          = 72
// Anchor offsets sit a few px OUTSIDE the card so handles and the
// line endpoints remain visible — the previous values placed the
// source handle inside the card body where it was masked by the
// MemberNode chrome.
const TOP_ANCHOR_OFFSET    = -4         // just above the card (above avatar)
const BOTTOM_ANCHOR_OFFSET = NODE_H + 4 // just below the card
const LONG_PRESS_MS   = 500
const MOVE_TOLERANCE  = 10    // px in CLIENT coords — same threshold
                              // for cancelling profile + line long-press

// ── Seed family ────────────────────────────────────────────────────
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

const SEED_POSITIONS: Record<string, { x: number; y: number }> = {
  mom: { x: 180, y:   0 },
  dad: { x: 360, y:   0 },
  c1:  { x:  60, y: 240 },
  c2:  { x: 270, y: 240 },
  c3:  { x: 480, y: 240 },
}

interface LabEdge {
  id: string
  /** Parent member id (source). */
  source: string
  /** Child member id, or null when the edge is dangling. */
  target: string | null
}

const SEED_EDGES: LabEdge[] = [
  { id: 'e1', source: 'mom', target: 'c1' },
  { id: 'e2', source: 'mom', target: null }, // demonstrates dangling/green state
]

// Which endpoint of an edge is being dragged.
type DragWhich = 'source' | 'target'

function bezierPath(sx: number, sy: number, ex: number, ey: number): string {
  const dy = Math.abs(ey - sy)
  const cy1 = sy + dy * 0.5
  const cy2 = ey - dy * 0.5
  return `M ${sx} ${sy} C ${sx} ${cy1}, ${ex} ${cy2}, ${ex} ${ey}`
}

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

  // ── UI state ─────────────────────────────────────────────────────
  /** Which edge is in EDIT mode (handles + delete visible). */
  const [editingEdge, setEditingEdge] = useState<string | null>(null)
  /** Which member's profile modal is open (null = closed). */
  const [profileMember, setProfileMember] = useState<Member | null>(null)
  /** Active handle drag — { edgeId, which: 'source' | 'target' }. */
  const [dragging, setDragging] = useState<{ edgeId: string; which: DragWhich } | null>(null)
  const [hoverTarget, setHoverTarget] = useState<string | null>(null)
  const [worldPointer, setWorldPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // ── Viewport (pan + zoom) ────────────────────────────────────────
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [initialised, setInitialised] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panState = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  type TouchMode =
    | { mode: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initialDist: number; initialScale: number; cx: number; cy: number; tx0: number; ty0: number }
  const touchState = useRef<TouchMode | null>(null)

  // Tracks whether the current pan gesture has actually moved beyond
  // a few pixels. If it hasn't, an empty-canvas tap is a "tap to
  // exit edit mode" gesture, not a pan.
  const panMoved = useRef(false)

  // ── Long-press timers ────────────────────────────────────────────
  // One for profiles ("spawn new edge"), one for lines ("enter edit
  // mode"). Each stores { startX, startY, timerId, fired }. fired
  // flips to true when the timeout actually runs, so the matching
  // pointerup can suppress its short-tap action.
  const profilePress = useRef<{
    memberId: string; startX: number; startY: number; timerId: number; fired: boolean
  } | null>(null)
  const linePress = useRef<{
    edgeId: string; startX: number; startY: number; timerId: number; fired: boolean
  } | null>(null)

  // ── Canvas dimensions / auto-fit ─────────────────────────────────
  const PAD = 80
  const maxX = Math.max(...Object.values(positions).map((p) => p.x + NODE_W)) + PAD
  const maxY = Math.max(...Object.values(positions).map((p) => p.y + NODE_H)) + PAD
  const minX = Math.min(...Object.values(positions).map((p) => p.x), 0) - PAD
  const canvasW = maxX - minX
  const canvasH = maxY + PAD
  const offsetX = -minX

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

  // ── Coordinate helper ────────────────────────────────────────────
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    // Subtract offsetX so positions match the seed coord system
    // (positions are stored pre-offset).
    return {
      x: (clientX - rect.left - tx) / scale - offsetX,
      y: (clientY - rect.top - ty) / scale,
    }
  }, [tx, ty, scale, offsetX])

  // ── Snap target detection ────────────────────────────────────────
  // The snap anchor depends on WHICH endpoint is being dragged:
  //   • Dragging the source (parent end) → snap to a member's BOTTOM
  //     anchor (where the parent line originates).
  //   • Dragging the target (child end)  → snap to a member's TOP
  //     anchor (where the child line lands).
  const findSnapTarget = useCallback((wx: number, wy: number, which: DragWhich): string | null => {
    let best: string | null = null
    let bestDist = SNAP_RADIUS
    for (const m of members) {
      const pos = positions[m.id]
      if (!pos) continue
      const a = which === 'source' ? bottomAnchor(pos) : topAnchor(pos)
      const d = Math.hypot(wx - a.x, wy - a.y)
      if (d < bestDist) {
        bestDist = d
        best = m.id
      }
    }
    return best
  }, [members, positions])

  // ── Pan / zoom handlers (outer wrapper) ──────────────────────────
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

  const onMouseDown = (e: React.MouseEvent) => {
    // Skip if the target is interactive (profile, line, handle).
    if ((e.target as HTMLElement).closest('[data-lab-interactive]')) return
    panState.current = { startX: e.clientX, startY: e.clientY, tx0: tx, ty0: ty }
    panMoved.current = false
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!panState.current) return
    const dx = e.clientX - panState.current.startX
    const dy = e.clientY - panState.current.startY
    if (Math.hypot(dx, dy) > 3) panMoved.current = true
    setTx(panState.current.tx0 + dx)
    setTy(panState.current.ty0 + dy)
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (panState.current && !panMoved.current) {
      // Empty-canvas tap → exit edit mode if any.
      if (!(e.target as HTMLElement).closest('[data-lab-interactive]')) {
        setEditingEdge(null)
      }
    }
    panState.current = null
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-lab-interactive]')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
      panMoved.current = false
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
      const dx = t.clientX - st.startX
      const dy = t.clientY - st.startY
      if (Math.hypot(dx, dy) > 3) panMoved.current = true
      setTx(st.tx0 + dx)
      setTy(st.ty0 + dy)
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
    const wasTap =
      touchState.current?.mode === 'pan' &&
      !panMoved.current &&
      e.touches.length === 0
    if (wasTap) {
      if (!(e.target as HTMLElement).closest('[data-lab-interactive]')) {
        setEditingEdge(null)
      }
    }
    if (e.touches.length === 0) {
      touchState.current = null
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
    }
  }

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

  // ── Profile long-press / tap ─────────────────────────────────────
  const onProfilePointerDown = (memberId: string, e: React.PointerEvent) => {
    // Don't preventDefault — we want a normal touch-flow. The wrapper
    // div carries data-lab-interactive so the outer pan handler
    // bails out.
    const startX = e.clientX
    const startY = e.clientY
    const timerId = window.setTimeout(() => {
      // Long-press fired: spawn a new dangling edge from this person.
      profilePress.current && (profilePress.current.fired = true)
      const newId = `e-${Date.now().toString(36)}`
      setEdges((prev) => [...prev, { id: newId, source: memberId, target: null }])
      // Optional haptic on supporting browsers.
      try { (navigator as { vibrate?: (n: number) => void }).vibrate?.(15) } catch { /* ignore */ }
    }, LONG_PRESS_MS)
    profilePress.current = { memberId, startX, startY, timerId, fired: false }
  }
  const onProfilePointerMove = (e: React.PointerEvent) => {
    const lp = profilePress.current
    if (!lp) return
    if (Math.hypot(e.clientX - lp.startX, e.clientY - lp.startY) > MOVE_TOLERANCE) {
      clearTimeout(lp.timerId)
      profilePress.current = null
    }
  }
  const onProfilePointerUp = (memberId: string) => {
    const lp = profilePress.current
    if (!lp) return
    clearTimeout(lp.timerId)
    if (!lp.fired) {
      // Short tap → open the profile.
      const m = memberById.get(memberId)
      if (m) setProfileMember(m)
    }
    profilePress.current = null
  }

  // ── Line long-press → enter edit mode ────────────────────────────
  const onLinePointerDown = (edgeId: string, e: React.PointerEvent<SVGPathElement>) => {
    // Capture so move/up events still route here even if the user
    // drags off the (thin) line.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const startX = e.clientX
    const startY = e.clientY
    const timerId = window.setTimeout(() => {
      linePress.current && (linePress.current.fired = true)
      setEditingEdge(edgeId)
      try { (navigator as { vibrate?: (n: number) => void }).vibrate?.(15) } catch { /* ignore */ }
    }, LONG_PRESS_MS)
    linePress.current = { edgeId, startX, startY, timerId, fired: false }
  }
  const onLinePointerMove = (e: React.PointerEvent<SVGPathElement>) => {
    const lp = linePress.current
    if (!lp) return
    if (Math.hypot(e.clientX - lp.startX, e.clientY - lp.startY) > MOVE_TOLERANCE) {
      clearTimeout(lp.timerId)
      linePress.current = null
    }
  }
  const onLinePointerUp = (e: React.PointerEvent<SVGPathElement>) => {
    const lp = linePress.current
    if (!lp) return
    clearTimeout(lp.timerId)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    linePress.current = null
  }

  // ── Handle drag (the actual edit gesture) ────────────────────────
  const onHandlePointerDown = useCallback((edgeId: string, which: DragWhich, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    setDragging({ edgeId, which })
    // Detach the dragged endpoint so the line follows the cursor.
    setEdges((prev) => prev.map((edge) => {
      if (edge.id !== edgeId) return edge
      if (which === 'target') return { ...edge, target: null }
      // For source drag, we DON'T null it — visual continuity
      // requires the line to keep starting somewhere. We just track
      // the drag and snap to a new source on release.
      return edge
    }))
    const w = clientToWorld(e.clientX, e.clientY)
    setWorldPointer(w)
    setHoverTarget(findSnapTarget(w.x, w.y, which))
  }, [clientToWorld, findSnapTarget])

  const onHandlePointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!dragging) return
    const w = clientToWorld(e.clientX, e.clientY)
    setWorldPointer(w)
    setHoverTarget(findSnapTarget(w.x, w.y, dragging.which))
  }, [dragging, clientToWorld, findSnapTarget])

  const onHandlePointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!dragging) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    const target = hoverTarget
    setEdges((prev) => prev.map((edge) => {
      if (edge.id !== dragging.edgeId) return edge
      if (dragging.which === 'target') {
        if (target) {
          // eslint-disable-next-line no-console
          console.log(`[lab] edge ${edge.id} target: ${edge.source} → ${target}`)
          return { ...edge, target }
        }
        return edge // stays dangling
      }
      // Source-end drag: only commit if it landed on a real member,
      // otherwise revert to the original parent.
      if (target) {
        // eslint-disable-next-line no-console
        console.log(`[lab] edge ${edge.id} source: ${target} → ${edge.target ?? 'dangling'}`)
        return { ...edge, source: target }
      }
      return edge
    }))
    setDragging(null)
    setHoverTarget(null)
  }, [dragging, hoverTarget])

  const deleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId))
    setEditingEdge(null)
  }

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
      <div
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.55) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Header (above the transform — fixed-size HUD). */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 py-3 flex items-center gap-2 pointer-events-none">
        <button
          data-lab-interactive
          onClick={() => navigate('/home')}
          className="pointer-events-auto bg-white/95 backdrop-blur rounded-full px-3 py-1.5 text-[13px] font-semibold text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
        >
          {rtl ? '← חזרה' : 'Back →'}
        </button>
        <div className="flex-1 text-center text-[14px] font-bold text-[#1C1C1E]">
          {rtl ? '🧪 מעבדת קווים' : 'Lab — Tree edges'}
        </div>
        <div className="pointer-events-auto flex gap-1" data-lab-interactive>
          <button
            onClick={() => zoomBy(0.8)}
            className="bg-white/95 backdrop-blur rounded-full w-8 h-8 font-semibold text-[18px] text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
          >−</button>
          <button
            onClick={() => zoomBy(1.25)}
            className="bg-white/95 backdrop-blur rounded-full w-8 h-8 font-semibold text-[18px] text-[#1C1C1E] shadow-sm border border-white/60 hover:bg-white transition"
          >+</button>
        </div>
      </div>

      <div className="absolute top-14 inset-x-0 z-10 text-center text-[11px] text-[#8E8E93] pointer-events-none hidden md:block px-4">
        {rtl
          ? 'גרירה: הזזה • גלגלת/צביטה: זום • הקשה על פרופיל: פתיחה • לחיצה ארוכה על פרופיל: יצירת קו • לחיצה ארוכה על קו: עריכה'
          : 'Drag: pan • Wheel/pinch: zoom • Tap profile: open • Hold profile: new edge • Hold line: edit'}
      </div>

      {/* World — transformed wrapper for pan/zoom. */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: canvasW,
          height: canvasH,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          className="absolute"
          style={{ left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
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
            const inEdit = editingEdge === edge.id
            const isDraggingTarget = dragging?.edgeId === edge.id && dragging?.which === 'target'
            const isDraggingSource = dragging?.edgeId === edge.id && dragging?.which === 'source'

            // Compute the two endpoints in canvas coords.
            let start: { x: number; y: number }
            if (isDraggingSource) {
              // Source end follows the cursor; lock to a snap-target's
              // bottom anchor if hovering one.
              if (hoverTarget && positions[hoverTarget]) {
                start = bottomAnchor({ x: positions[hoverTarget].x + offsetX, y: positions[hoverTarget].y })
              } else {
                start = { x: worldPointer.x + offsetX, y: worldPointer.y }
              }
            } else {
              start = bottomAnchor({ x: sourcePos.x + offsetX, y: sourcePos.y })
            }

            let end: { x: number; y: number }
            if (isDraggingTarget) {
              if (hoverTarget && positions[hoverTarget]) {
                end = topAnchor({ x: positions[hoverTarget].x + offsetX, y: positions[hoverTarget].y })
              } else {
                end = { x: worldPointer.x + offsetX, y: worldPointer.y }
              }
            } else if (edge.target) {
              const tpos = positions[edge.target]
              end = tpos ? topAnchor({ x: tpos.x + offsetX, y: tpos.y })
                         : { x: start.x, y: start.y + 90 }
            } else {
              end = { x: start.x, y: start.y + 90 }
            }

            const dangling = !edge.target && !isDraggingTarget && !isDraggingSource
            const greenStroke =
              dangling ||
              (isDraggingTarget && !hoverTarget) ||
              (isDraggingSource && !hoverTarget)
            const stroke = greenStroke ? '#34C759' : 'url(#lab-connected)'
            const handleFill = greenStroke ? '#34C759' : '#2B6BFF'

            const path = bezierPath(start.x, start.y, end.x, end.y)

            // Show handles when:
            //   • edge is in edit mode (both ends)
            //   • edge is dangling (target end only — the green dot)
            //   • edge is being dragged (the active end)
            const showTargetHandle = inEdit || dangling || isDraggingTarget
            const showSourceHandle = inEdit || isDraggingSource

            return (
              <g key={edge.id}>
                {/* Invisible wide hit area for long-press to enter
                    edit mode. PointerEvents="stroke" means clicks
                    only register on (or near) the visible stroke. */}
                <path
                  data-lab-interactive
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={28}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onPointerDown={(e) => onLinePointerDown(edge.id, e)}
                  onPointerMove={onLinePointerMove}
                  onPointerUp={onLinePointerUp}
                  onPointerCancel={onLinePointerUp}
                />
                {/* Visible stroke */}
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={inEdit ? 4 : 3}
                  strokeLinecap="round"
                  filter="url(#lab-glow)"
                  style={{
                    pointerEvents: 'none',
                    transition: dragging ? 'none' : 'stroke 200ms, stroke-width 200ms',
                  }}
                />
                {/* Snap preview line — green dashed segment from the
                    snap anchor to the cursor while hovering a valid
                    target. */}
                {dragging?.edgeId === edge.id && hoverTarget && (
                  <line
                    x1={dragging.which === 'target' ? topAnchor({ x: positions[hoverTarget].x + offsetX, y: positions[hoverTarget].y }).x : worldPointer.x + offsetX}
                    y1={dragging.which === 'target' ? topAnchor({ x: positions[hoverTarget].x + offsetX, y: positions[hoverTarget].y }).y : worldPointer.y}
                    x2={worldPointer.x + offsetX}
                    y2={worldPointer.y}
                    stroke="#34C759"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    opacity={0.55}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Target-end handle (child) — visible if dangling or
                    in edit. The dot itself; transparent hit area on
                    top so touches don't miss. */}
                {showTargetHandle && (
                  <>
                    <circle
                      data-lab-interactive
                      cx={end.x}
                      cy={end.y}
                      r={28 / Math.max(0.8, scale)}
                      fill="transparent"
                      style={{ touchAction: 'none', cursor: 'grab' }}
                      onPointerDown={(e) => onHandlePointerDown(edge.id, 'target', e)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={onHandlePointerUp}
                    />
                    <circle
                      cx={end.x}
                      cy={end.y}
                      r={isDraggingTarget ? 13 : 10}
                      fill={handleFill}
                      stroke="#FFFFFF"
                      strokeWidth={2.5}
                      style={{
                        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.22))',
                        transition: isDraggingTarget ? 'none' : 'r 150ms, fill 200ms',
                        pointerEvents: 'none',
                      }}
                    />
                  </>
                )}

                {/* Source-end handle (parent) — only in edit mode.
                    Same shape as target handle. */}
                {showSourceHandle && (
                  <>
                    <circle
                      data-lab-interactive
                      cx={start.x}
                      cy={start.y}
                      r={28 / Math.max(0.8, scale)}
                      fill="transparent"
                      style={{ touchAction: 'none', cursor: 'grab' }}
                      onPointerDown={(e) => onHandlePointerDown(edge.id, 'source', e)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={onHandlePointerUp}
                    />
                    <circle
                      cx={start.x}
                      cy={start.y}
                      r={isDraggingSource ? 13 : 10}
                      fill={handleFill}
                      stroke="#FFFFFF"
                      strokeWidth={2.5}
                      style={{
                        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.22))',
                        transition: isDraggingSource ? 'none' : 'r 150ms, fill 200ms',
                        pointerEvents: 'none',
                      }}
                    />
                  </>
                )}

                {/* Delete X — only in edit mode. Floats at the
                    midpoint of the line. */}
                {inEdit && (() => {
                  const mx = (start.x + end.x) / 2
                  const my = (start.y + end.y) / 2
                  return (
                    <g
                      data-lab-interactive
                      style={{ cursor: 'pointer', pointerEvents: 'all' }}
                      onClick={() => deleteEdge(edge.id)}
                    >
                      <circle cx={mx} cy={my} r={16} fill="#FF3B30" stroke="#fff" strokeWidth={2.5}
                        style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))' }} />
                      <path
                        d={`M ${mx - 6} ${my - 6} L ${mx + 6} ${my + 6} M ${mx + 6} ${my - 6} L ${mx - 6} ${my + 6}`}
                        stroke="#fff"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                      />
                    </g>
                  )
                })()}
              </g>
            )
          })}
        </svg>

        {/* Member cards — real MemberNode. Wrapped in a div carrying
            data-lab-interactive + pointer handlers for tap vs.
            long-press detection. */}
        {members.map((m) => {
          const pos = positions[m.id]
          if (!pos) return null
          const isSnapTarget = hoverTarget === m.id
          return (
            <motion.div
              key={m.id}
              data-lab-interactive
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
                filter: isSnapTarget ? 'drop-shadow(0 0 18px rgba(52,199,89,0.7))' : undefined,
                zIndex: isSnapTarget ? 5 : 1,
                touchAction: 'none',
              }}
              onPointerDown={(e) => onProfilePointerDown(m.id, e)}
              onPointerMove={onProfilePointerMove}
              onPointerUp={() => onProfilePointerUp(m.id)}
              onPointerCancel={() => { profilePress.current && clearTimeout(profilePress.current.timerId); profilePress.current = null }}
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

      {/* Bottom-left live edges read-out — proves drags mutate data. */}
      <div className="absolute bottom-3 left-3 right-3 md:right-auto md:max-w-md z-20 bg-white/85 backdrop-blur rounded-2xl px-3 py-2 text-[11px] font-mono text-[#1C1C1E] shadow-sm border border-white/60 max-h-32 overflow-auto pointer-events-auto">
        <div className="font-bold mb-1 text-[#8E8E93]">
          {rtl ? 'מצב הקשרים (חי)' : 'Edges (live)'} · zoom {Math.round(scale * 100)}%
          {editingEdge && (
            <span className="ms-2 text-[#FF9F0A]">
              {rtl ? `• עריכת ${editingEdge}` : `• editing ${editingEdge}`}
            </span>
          )}
        </div>
        {edges.map((edge) => {
          const a = memberById.get(edge.source)?.first_name ?? '?'
          const b = edge.target
            ? memberById.get(edge.target)?.first_name ?? '?'
            : (rtl ? '— תלוש' : '— dangling')
          return (
            <div key={edge.id} className="leading-tight">
              <span className="text-[#8E8E93]">{edge.id}:</span> {a} → {b}
              {editingEdge === edge.id && ' ✎'}
            </div>
          )
        })}
      </div>

      {/* Profile modal — opens on short tap. Minimal: avatar + name +
          gender + close button. Reusing MemberNode for the avatar
          keeps the visual language consistent. */}
      <AnimatePresence>
        {profileMember && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setProfileMember(null)}
            data-lab-interactive
          >
            <motion.div
              initial={{ scale: 0.85, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-xl p-6 max-w-xs w-[88%] flex flex-col items-center gap-3"
            >
              <MemberNode member={profileMember} size={110} dataMemberId={`modal-${profileMember.id}`} />
              <div className="text-center text-[12px] text-[#8E8E93] mt-1">
                {rtl
                  ? `מין: ${profileMember.gender === 'female' ? 'נקבה' : 'זכר'}`
                  : `Gender: ${profileMember.gender}`}
              </div>
              <button
                onClick={() => setProfileMember(null)}
                className="mt-2 bg-[#007AFF] hover:bg-[#0066DD] text-white rounded-full px-5 py-2 text-[13px] font-semibold transition"
              >
                {rtl ? 'סגור' : 'Close'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
