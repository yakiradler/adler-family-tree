import { useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import type { Member, Relationship } from '../types'

// Experimental tree-editor playground.
// Lives at /lab — completely isolated from the main app's Zustand
// store so the user can break things freely without touching the
// real family data.
//
// What's different from the production TreeView (src/components/views/TreeView.tsx):
//   1. Connectors are smooth bezier curves, not orthogonal elbows.
//   2. Every connector exposes a drag-handle at the child end. Pointer-
//      down → drag → release picks a new target child. If released
//      within SNAP_RADIUS of a member's top-anchor, the edge re-binds
//      to that member. Released over empty space leaves the edge
//      "dangling" (no target, green-coloured).
//   3. Member positions are manually placed in this proof of concept
//      — no auto-layout engine yet. That's deliberate: the production
//      layout couples connector shape to placement, which is the
//      thing being prototyped here.

// ── Constants ──────────────────────────────────────────────────────
const SNAP_RADIUS = 60        // px — pull-into-node distance during drag
const NODE_W = 110            // card width
const NODE_H = 56             // card height
const ANCHOR_OFFSET = 28      // distance from card center to the line attachment point

// ── Seed: small family for the user to play with ──────────────────
function makeMember(id: string, first: string, gender: 'male' | 'female', last = 'ניסוי'): Member {
  return { id, first_name: first, last_name: last, gender, created_by: 'lab' }
}

const SEED_MEMBERS: Member[] = [
  makeMember('mom', 'אמא', 'female'),
  makeMember('dad', 'אבא', 'male'),
  makeMember('c1', 'ילד 1', 'male'),
  makeMember('c2', 'ילדה 2', 'female'),
  makeMember('c3', 'ילד 3', 'male'),
]

const SEED_POSITIONS: Record<string, { x: number; y: number }> = {
  mom:  { x: 360, y: 140 },
  dad:  { x: 560, y: 140 },
  c1:   { x: 240, y: 380 },
  c2:   { x: 460, y: 380 },
  c3:   { x: 680, y: 380 },
}

// Two seed edges: one fully connected, one dangling (the green case
// in the spec). The dangling edge's `member_b_id` is empty string —
// our local convention for "no target" since the Relationship type
// requires a string.
const SEED_RELS: LabRel[] = [
  { id: 'e1', type: 'parent-child', member_a_id: 'mom', member_b_id: 'c1' },
  { id: 'e2', type: 'parent-child', member_a_id: 'mom', member_b_id: '' },
]

interface LabRel extends Omit<Relationship, 'member_b_id'> {
  /** Empty string means the edge's child end is dangling (no target). */
  member_b_id: string
}

// ── Bezier path helper ─────────────────────────────────────────────
// Smooth S-curve with control points at the vertical midpoint so the
// line eases out of the parent and into the child without sharp
// elbows. The deltaY * 0.5 factor balances "feels organic" against
// "doesn't bulge across other lines". From the user's PoC.
function bezierPath(sx: number, sy: number, ex: number, ey: number): string {
  const dy = Math.abs(ey - sy)
  const cy1 = sy + dy * 0.5
  const cy2 = ey - dy * 0.5
  return `M ${sx} ${sy} C ${sx} ${cy1}, ${ex} ${cy2}, ${ex} ${ey}`
}

// ── Anchor helpers ─────────────────────────────────────────────────
// Edges attach at the BOTTOM of the source card and the TOP of the
// target card. We compute the points off the center (x,y is the
// card's center, NODE_H/2 is half its height).
function bottomAnchor(p: { x: number; y: number }) {
  return { x: p.x, y: p.y + NODE_H / 2 }
}
function topAnchor(p: { x: number; y: number }) {
  return { x: p.x, y: p.y - NODE_H / 2 }
}

// ── Main component ────────────────────────────────────────────────
export default function Lab() {
  const navigate = useNavigate()
  const { lang } = useLang()
  const rtl = isRTL(lang)

  const [members] = useState<Member[]>(SEED_MEMBERS)
  const [positions] = useState<Record<string, { x: number; y: number }>>(SEED_POSITIONS)
  const [rels, setRels] = useState<LabRel[]>(SEED_RELS)

  // Drag state: which edge is being dragged + current pointer pos in
  // canvas coordinates. Null when nothing is being dragged.
  const [draggingEdge, setDraggingEdge] = useState<string | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Member id under the cursor right now, if any — used to render the
  // snap-preview ring on the candidate target while dragging.
  const [hoverTarget, setHoverTarget] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  )

  // ── Event handlers ───────────────────────────────────────────────
  const onHandleDown = useCallback((edgeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDraggingEdge(edgeId)
    // Detach the edge's target on grab so the line follows the cursor
    // immediately and visually turns green. Restored on drop.
    setRels((prev) =>
      prev.map((r) => (r.id === edgeId ? { ...r, member_b_id: '' } : r)),
    )
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingEdge || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    setPointer({ x: px, y: py })
    // Resolve the snap candidate live so the user gets visual
    // feedback before releasing. We snap to the TOP anchor of each
    // member (the natural child-end attachment point).
    let best: string | null = null
    let bestDist = SNAP_RADIUS
    for (const m of members) {
      const pos = positions[m.id]
      if (!pos) continue
      const a = topAnchor(pos)
      const d = Math.hypot(px - a.x, py - a.y)
      if (d < bestDist) {
        bestDist = d
        best = m.id
      }
    }
    setHoverTarget(best)
  }, [draggingEdge, members, positions])

  const onPointerUp = useCallback(() => {
    if (!draggingEdge) return
    const target = hoverTarget
    setRels((prev) =>
      prev.map((r) => {
        if (r.id !== draggingEdge) return r
        if (target) {
          // eslint-disable-next-line no-console
          console.log(`[lab] edge ${r.id}: ${r.member_a_id} → ${target}`)
          return { ...r, member_b_id: target }
        }
        // eslint-disable-next-line no-console
        console.log(`[lab] edge ${r.id} released over empty space (dangling)`)
        return r
      }),
    )
    setDraggingEdge(null)
    setHoverTarget(null)
  }, [draggingEdge, hoverTarget])

  // ── Convenience: add a new dangling edge from a member ───────────
  // The PoC has fixed seed edges. To let the user actually build a
  // structure, double-tapping a member spawns a fresh dangling edge
  // from that member. The user then drags its handle to a target.
  const onMemberDoubleClick = useCallback((sourceId: string) => {
    const newId = `e-${Date.now().toString(36)}`
    setRels((prev) => [
      ...prev,
      { id: newId, type: 'parent-child', member_a_id: sourceId, member_b_id: '' },
    ])
  }, [])

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      ref={canvasRef}
      dir={rtl ? 'rtl' : 'ltr'}
      className="relative w-full h-screen overflow-hidden select-none"
      style={{
        background:
          'radial-gradient(circle at 30% 20%, rgba(43,107,255,0.06), transparent 50%), ' +
          'radial-gradient(circle at 70% 80%, rgba(255,94,174,0.05), transparent 50%), ' +
          '#F5F6FA',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* Header strip */}
      <div className="absolute top-0 inset-x-0 z-10 px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate('/home')}
          className="glass rounded-full px-3 py-1.5 text-sf-footnote font-semibold text-[#1C1C1E] hover:bg-white/80 transition"
        >
          {rtl ? 'חזרה' : 'Back'}
        </button>
        <div className="text-sf-subhead font-bold text-[#1C1C1E]">
          {rtl ? '🧪 מעבדת קווים' : 'Lab — Tree edges'}
        </div>
        <div className="text-sf-footnote text-[#8E8E93] hidden md:block">
          {rtl
            ? 'גרור את העיגול בקצה הקו לאדם אחר • לחיצה כפולה על אדם יוצרת קו חדש'
            : 'Drag the circle at the line tip to another person • double-click a member to spawn a new edge'}
        </div>
      </div>

      {/* SVG layer: connectors */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <linearGradient id="lab-edge-connected" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2B6BFF" />
            <stop offset="100%" stopColor="#6C47FF" />
          </linearGradient>
        </defs>
        {rels.map((r) => {
          const source = positions[r.member_a_id]
          if (!source) return null
          const isDragging = draggingEdge === r.id
          // Origin: parent's bottom edge.
          const start = bottomAnchor(source)

          // Endpoint: depends on state.
          //   • Dragging this edge → follow pointer, but if hovering a
          //     valid snap target, lock the visual end onto its top-
          //     anchor so the user sees the line "click into place".
          //   • Connected → target's top anchor.
          //   • Dangling → short stub hanging below the source.
          let end: { x: number; y: number }
          let snapPreview: { x: number; y: number } | null = null
          if (isDragging) {
            end = pointer
            if (hoverTarget) {
              const tpos = positions[hoverTarget]
              if (tpos) snapPreview = topAnchor(tpos)
            }
          } else if (r.member_b_id) {
            const tpos = positions[r.member_b_id]
            end = tpos ? topAnchor(tpos) : { x: start.x, y: start.y + 80 }
          } else {
            end = { x: start.x, y: start.y + 80 }
          }

          const dangling = !r.member_b_id && !isDragging
          const dGreen = isDragging && !hoverTarget
          const stroke =
            dangling || dGreen ? '#34C759' : 'url(#lab-edge-connected)'
          const handleFill =
            dangling || dGreen ? '#34C759' : '#2B6BFF'

          return (
            <g key={r.id} className="pointer-events-auto">
              {/* The line itself */}
              <path
                d={bezierPath(start.x, start.y, end.x, end.y)}
                fill="none"
                stroke={stroke}
                strokeWidth={2.5}
                strokeLinecap="round"
                style={{ transition: isDragging ? 'none' : 'stroke 200ms' }}
              />
              {/* Snap-into-place preview line: faint dashed segment
                  from the cursor's nearest snap point to the actual
                  cursor position, hinting the lock-on. */}
              {isDragging && snapPreview && (
                <line
                  x1={snapPreview.x}
                  y1={snapPreview.y}
                  x2={pointer.x}
                  y2={pointer.y}
                  stroke="#34C759"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  opacity={0.5}
                />
              )}
              {/* Drag handle at the child end. Always grabbable. */}
              <circle
                cx={end.x}
                cy={end.y}
                r={isDragging ? 14 : 10}
                fill={handleFill}
                stroke="#FFFFFF"
                strokeWidth={2}
                className="cursor-grab active:cursor-grabbing"
                style={{
                  filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.12))',
                  transition: isDragging ? 'none' : 'r 150ms, fill 200ms',
                }}
                onPointerDown={(e) => onHandleDown(r.id, e)}
              />
            </g>
          )
        })}
      </svg>

      {/* Member cards layer */}
      {members.map((m) => {
        const pos = positions[m.id]
        if (!pos) return null
        const isSnapTarget = hoverTarget === m.id
        const ring =
          m.gender === 'female'
            ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)'
            : m.gender === 'male'
            ? 'linear-gradient(135deg,#2B6BFF,#6C47FF)'
            : 'linear-gradient(135deg,#34C759,#06D6A0)'
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onDoubleClick={() => onMemberDoubleClick(m.id)}
            className="absolute flex flex-col items-center"
            style={{
              left: pos.x,
              top: pos.y,
              width: NODE_W,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="rounded-full p-[3px] mb-1"
              style={{
                background: ring,
                boxShadow: isSnapTarget
                  ? '0 0 0 4px rgba(52,199,89,0.35), 0 6px 18px rgba(17,34,64,0.12)'
                  : '0 6px 18px rgba(17,34,64,0.12)',
                transition: 'box-shadow 180ms',
              }}
            >
              <div
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center"
                style={{ width: ANCHOR_OFFSET * 2, height: ANCHOR_OFFSET * 2 }}
              >
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <circle cx={12} cy={8} r={4} fill="#8E8E93" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="#8E8E93" />
                </svg>
              </div>
            </div>
            <div className="bg-white/95 backdrop-blur rounded-2xl px-3 py-1 shadow-sm border border-white/60">
              <div className="text-[12px] font-semibold text-[#1C1C1E] text-center whitespace-nowrap">
                {m.first_name}
              </div>
            </div>
          </motion.div>
        )
      })}

      {/* Debug strip: live edge list at the bottom so the user can see
          that drags actually mutate the underlying relationship array. */}
      <div className="absolute bottom-3 inset-x-3 max-h-32 overflow-auto glass rounded-2xl px-3 py-2 text-[11px] font-mono text-[#1C1C1E]">
        <div className="font-bold mb-1">
          {rtl ? 'מצב הקשרים (חי)' : 'Edges (live)'}:
        </div>
        {rels.map((r) => {
          const a = memberById.get(r.member_a_id)?.first_name ?? '?'
          const b = r.member_b_id
            ? memberById.get(r.member_b_id)?.first_name ?? '?'
            : (rtl ? '— תלוש' : '— dangling')
          return (
            <div key={r.id} className="leading-tight">
              <span className="text-[#8E8E93]">{r.id}:</span> {a} → {b}
            </div>
          )
        })}
      </div>
    </div>
  )
}
