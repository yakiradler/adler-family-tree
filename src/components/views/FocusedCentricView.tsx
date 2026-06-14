import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Member } from '../../types'
import type { LineageInfo } from '../../lib/lineage'
import { useLang } from '../../i18n/useT'
import { buildFocusedSubgraph, type FocusedMember } from './buildFocusedSubgraph'
import { CARD, CARD_BODY_H, computeLayout } from '../../layout'
import ConnectorsLayer from './tree/ConnectorsLayer'
import { PersonAvatarIcon } from '../MemberNode'
import { getFallbackGradient, getRingGradient, getRingShadow } from '../memberVisuals'


// ─── Main component ───────────────────────────────────────────────────────────
//
// The focused view is NOT a separate layout engine any more. It feeds a
// 3-generation subgraph (selected by buildFocusedSubgraph, which also
// tags roles + paternal/maternal sides for the UI tints) into the SAME
// computeLayout that renders the main tree — same card slots, same
// anchors, same connector geometry, same invariants. What you see here
// can never drift from the main tree again.

export interface FocusedCentricViewProps {
  allMembers: Member[]
  allRelationships: import('../../types').Relationship[]
  initialFocusId: string
  lineageById: Map<string, LineageInfo>
  onSelectMember: (id: string) => void
  onExit: () => void
}

export default function FocusedCentricView({
  allMembers,
  allRelationships,
  initialFocusId,
  lineageById,
  onSelectMember,
  onExit,
}: FocusedCentricViewProps) {
  const { t } = useLang()
  const wrapRef = useRef<HTMLDivElement>(null)

  const [focusId, setFocusId] = useState(initialFocusId)
  const [navStack, setNavStack] = useState<string[]>([initialFocusId])
  const [scale, setScale] = useState(0.85)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(60)
  const dragRef = useRef<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null)
  const isDragging = useRef(false)
  // Render-facing mirror of dragRef — refs must not be read during
  // render, and state (unlike the ref) actually re-renders the cursor.
  const [dragCursor, setDragCursor] = useState(false)

  const focusedMembers = useMemo(
    () => buildFocusedSubgraph(focusId, allMembers, allRelationships),
    [focusId, allMembers, allRelationships],
  )

  // Shared engine on the subgraph: members from the role-tagger, edges
  // restricted to the included population.
  // (roles/sides from buildFocusedSubgraph are no longer used for
  // rendering — kept available via `focusedMembers` if needed later.)
  const { result } = useMemo(() => {
    const subMembers = focusedMembers.map((fm) => fm.member)
    const ids = new Set(subMembers.map((m) => m.id))
    const subRelationships = allRelationships.filter(
      (r) => ids.has(r.member_a_id) && ids.has(r.member_b_id),
    )
    const roleOf = new Map<string, FocusedMember>(focusedMembers.map((fm) => [fm.member.id, fm]))
    return {
      result: computeLayout({ members: subMembers, relationships: subRelationships }),
      roleOf,
    }
  }, [focusedMembers, allRelationships])

  const canvasW = Math.max(result.bounds.width, 700)
  const canvasH = Math.max(result.bounds.height, 400)

  // Centre the focus node whenever it changes.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const focusNode = result.nodes.find((n) => n.member.id === focusId)
    if (!focusNode) return
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    setTx(w / 2 - (focusNode.x + CARD.W / 2) * scale)
    setTy(h / 2 - (focusNode.y + CARD.H / 2) * scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, result])

  // Re-root the view when the caller hands us a new focus member —
  // adjusted during render (state already starts from initialFocusId,
  // so mount needs no extra pass).
  const [prevInitialFocusId, setPrevInitialFocusId] = useState(initialFocusId)
  if (initialFocusId !== prevInitialFocusId) {
    setPrevInitialFocusId(initialFocusId)
    setFocusId(initialFocusId)
    setNavStack([initialFocusId])
  }

  const navigateTo = (id: string) => {
    if (id === focusId) {
      onSelectMember(id)
      return
    }
    setNavStack(s => [...s, id])
    setFocusId(id)
  }

  const navigateBack = (toIdx: number) => {
    const newStack = navStack.slice(0, toIdx + 1)
    setNavStack(newStack)
    setFocusId(newStack[newStack.length - 1])
  }

  // ── Pan / zoom ──────────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,input,select')) return
    isDragging.current = false
    dragRef.current = { sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty }
    setDragCursor(true)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return
    isDragging.current = true
    setTx(dragRef.current.tx0 + (e.clientX - dragRef.current.sx))
    setTy(dragRef.current.ty0 + (e.clientY - dragRef.current.sy))
  }
  const onMouseUp = () => {
    dragRef.current = null
    setDragCursor(false)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const newScale = Math.max(0.2, Math.min(4, scale * (1 + -e.deltaY * 0.0015)))
    const rect = wrapRef.current!.getBoundingClientRect()
    const wx = (e.clientX - rect.left - tx) / scale
    const wy = (e.clientY - rect.top - ty) / scale
    setTx(e.clientX - rect.left - wx * newScale)
    setTy(e.clientY - rect.top - wy * newScale)
    setScale(newScale)
  }

  // ── Touch pan + pinch zoom ──────────────────────────────────────
  const touchState = useRef<
    | { mode: 'pan'; sx: number; sy: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initDist: number; initScale: number; cx: number; cy: number; tx0: number; ty0: number }
    | null
  >(null)
  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button,input,select')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    if (e.touches.length === 1) {
      const t0 = e.touches[0]
      touchState.current = { mode: 'pan', sx: t0.clientX, sy: t0.clientY, tx0: tx, ty0: ty }
    } else if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      const cx = (a.clientX + b.clientX) / 2 - rect.left
      const cy = (a.clientY + b.clientY) / 2 - rect.top
      touchState.current = {
        mode: 'pinch', initDist: dist, initScale: scale, cx, cy, tx0: tx, ty0: ty,
      }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const st = touchState.current
    if (!st) return
    if (st.mode === 'pan' && e.touches.length === 1) {
      const t0 = e.touches[0]
      setTx(st.tx0 + (t0.clientX - st.sx))
      setTy(st.ty0 + (t0.clientY - st.sy))
    } else if (st.mode === 'pinch' && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      const factor = dist / st.initDist
      const newScale = Math.max(0.2, Math.min(4, st.initScale * factor))
      const wx = (st.cx - st.tx0) / st.initScale
      const wy = (st.cy - st.ty0) / st.initScale
      setTx(st.cx - wx * newScale)
      setTy(st.cy - wy * newScale)
      setScale(newScale)
    }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) touchState.current = null
    else if (e.touches.length === 1) {
      const t0 = e.touches[0]
      touchState.current = { mode: 'pan', sx: t0.clientX, sy: t0.clientY, tx0: tx, ty0: ty }
    }
  }

  // Generation labels relative to the focus person's engine row.
  const focusGen = result.nodes.find((n) => n.member.id === focusId)?.generation ?? 0
  const labelForOffset = (offset: number): string | null => {
    switch (offset) {
      case 2: return t.genGrandparents
      case 1: return t.genParents
      case -1: return t.genChildren
      case -2: return t.genGrandchildren
      default: return null
    }
  }

  return (
    <div
      className="w-full relative flex flex-col select-none"
      style={{
        // dvh tracks the visible viewport as the mobile browser chrome
        // collapses/expands and respects the notch (see TreeView).
        height: 'calc(100dvh - 80px)',
        background:
          'radial-gradient(at 15% 10%, rgba(120,170,255,0.2) 0px, transparent 50%),' +
          'radial-gradient(at 85% 85%, rgba(255,140,200,0.16) 0px, transparent 55%),' +
          'linear-gradient(135deg, #F4F7FF 0%, #FFF5FA 100%)',
      }}
    >
      {/* Dot grid — behind everything */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.5) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* ── Header bar — completely isolated from canvas events ─────────────── */}
      <div className="relative z-10 shrink-0 flex items-center gap-3 px-4 h-11 bg-white/85 backdrop-blur-md border-b border-black/[0.06] shadow-sm">
        {/* Exit */}
        <button
          type="button"
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={onExit}
          className="flex items-center gap-1.5 text-[#007AFF] text-[12.5px] font-semibold hover:opacity-70 active:scale-95 transition shrink-0"
        >
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M6 1L1 6l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t.focusedExitBtn}
        </button>

        <div className="w-px h-4 bg-black/10 shrink-0" />

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
          {navStack.map((id, idx) => {
            const m = allMembers.find(m => m.id === id)
            if (!m) return null
            const isLast = idx === navStack.length - 1
            return (
              <span key={`${id}-${idx}`} className="flex items-center gap-1 shrink-0">
                {idx > 0 && <span className="text-black/20 text-[10px] font-bold mx-0.5">›</span>}
                <button
                  type="button"
                  onMouseDown={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => navigateBack(idx)}
                  disabled={isLast}
                  className={`text-[12px] font-semibold transition shrink-0 ${
                    isLast
                      ? 'text-[#1C1C1E] cursor-default'
                      : 'text-[#8E8E93] hover:text-[#1C1C1E]'
                  }`}
                >
                  {m.first_name} {m.last_name}
                </button>
              </span>
            )
          })}
        </div>

        {/* Scale */}
        <div className="shrink-0 text-[11px] font-semibold text-[#8E8E93]">
          {Math.round(scale * 100)}%
        </div>
      </div>

      {/* ── Canvas area — handles all pan / zoom events ───────────────────── */}
      <div
        ref={wrapRef}
        className="relative flex-1 overflow-hidden"
        style={{ touchAction: 'none', cursor: dragCursor ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* ── Canvas ─────────────────────────────────────────────────────────── */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: canvasW,
            height: canvasH,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* (The old paternal/maternal side-tint rectangles were removed —
              their hard edges read as a broken/clipped background, which
              the owner reported as a bug.) */}

          {/* Generation labels — engine rows, relative to the focus row */}
          {result.generationRows.map((row) => {
            const label = labelForOffset(focusGen - row.generation)
            if (!label) return null
            return (
              <div
                key={row.generation}
                className="absolute text-[9px] font-bold uppercase tracking-widest text-[#8E8E93] pointer-events-none"
                style={{ left: 8, top: row.y + CARD.H / 2 - 6 }}
              >
                {label}
              </div>
            )
          })}

          {/* Connectors — same renderer as the main tree, keyed by focus
              so they crossfade with the nodes */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`edges-${focusId}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <ConnectorsLayer edges={result.edges} width={canvasW} height={canvasH} />
            </motion.div>
          </AnimatePresence>

          {/* ── Nodes — crossfade the whole layer on focus change ────────────── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={focusId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              {result.nodes.map(node => (
                <FocusedCard
                  key={node.member.id}
                  member={node.member}
                  x={node.x}
                  y={node.y}
                  isFocus={node.member.id === focusId}
                  lineage={lineageById.get(node.member.id)}
                  onClick={() => {
                    if (!isDragging.current) navigateTo(node.member.id)
                  }}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>{/* ── /canvas area ── */}
    </div>
  )
}

// ─── Focused card ─────────────────────────────────────────────────────────────
// Uses the EXACT shared card geometry (CARD.W × CARD.H slots, avatar 64)
// so the engine's connector anchors are true here just like on the main
// tree. The focus member is highlighted by ring glow + label + tinted
// card, not by a different geometry.

function FocusedCard({
  member, x, y, isFocus, onClick,
}: {
  member: Member
  x: number
  y: number
  isFocus: boolean
  lineage?: LineageInfo
  onClick: () => void
}) {
  const { t } = useLang()
  const deceased = !!member.death_date
  const birthYear = member.birth_date ? new Date(member.birth_date).getFullYear() : null
  const deathYear = member.death_date ? new Date(member.death_date).getFullYear() : null
  const labelDate = birthYear ? (deathYear ? `${birthYear}–${deathYear}` : `${birthYear}`) : null

  const sz = CARD.AVATAR
  const overlap = CARD.OVERLAP

  return (
    <div className="absolute" style={{ left: x, top: y, width: CARD.W, height: CARD.H }}>
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={{ y: -3, scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        className="relative flex flex-col items-center w-full"
      >
        {/* Focus label */}
        {isFocus && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#007AFF] text-white text-[8.5px] font-bold px-2.5 py-0.5 rounded-full shadow-sm whitespace-nowrap z-10 pointer-events-none">
            {t.focusedLabel}
          </div>
        )}

        {/* Avatar ring */}
        <div
          className="relative rounded-full z-10"
          style={{
            padding: CARD.RING,
            background: getRingGradient(member),
            boxShadow: isFocus
              ? '0 14px 34px rgba(0,122,255,0.35), 0 2px 8px rgba(0,0,0,0.1)'
              : getRingShadow(member),
            opacity: deceased ? 0.78 : 1,
          }}
        >
          <div className="rounded-full bg-white" style={{ padding: CARD.INNER_PAD }}>
            <div className="rounded-full overflow-hidden relative" style={{ width: sz, height: sz }}>
              {member.photo_url ? (
                <img
                  src={member.photo_url}
                  alt=""
                  className={`w-full h-full object-cover ${deceased ? 'grayscale opacity-80' : ''}`}
                />
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                  <PersonAvatarIcon gender={member.gender} size={sz} />
                </div>
              )}
              {deceased && (
                <div className="absolute bottom-0 inset-x-0 flex justify-center pb-0.5">
                  <span className="text-[7.5px] bg-black/60 text-white px-1 py-[1px] rounded-full font-bold">{t.deceasedBadge}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Name card — fixed CARD_BODY_H height, same as the main tree */}
        <div
          className="relative rounded-[15px] border border-white/70 px-2 pb-2"
          style={{
            marginTop: -overlap,
            paddingTop: overlap + 8,
            width: CARD.W,
            height: CARD_BODY_H,
            background: isFocus
              ? 'linear-gradient(180deg, #EEF4FF 0%, #FAFBFF 100%)'
              : 'linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%)',
            boxShadow: isFocus
              ? '0 2px 4px rgba(0,0,0,0.04), 0 12px 28px rgba(0,122,255,0.13), 0 3px 8px rgba(17,34,64,0.06)'
              : '0 1px 2px rgba(0,0,0,0.04), 0 6px 16px rgba(17,34,64,0.07)',
          }}
        >
          <p className="font-bold text-[#1C1C1E] leading-tight text-center truncate" style={{ fontSize: 13 }}>
            {member.first_name}
          </p>
          <p className="text-[#636366] leading-tight text-center truncate" style={{ fontSize: 10.5 }}>
            {member.last_name}
          </p>
          {labelDate && (
            <p
              className="leading-tight text-center mt-0.5 font-semibold"
              style={{
                fontSize: 10,
                background:
                  member.gender === 'female'
                    ? 'linear-gradient(90deg,#FF5EAE,#B46BFF)'
                    : 'linear-gradient(90deg,#2B6BFF,#19C6FF)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {labelDate}
            </p>
          )}
        </div>
      </motion.button>
    </div>
  )
}
