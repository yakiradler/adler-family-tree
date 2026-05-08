import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Member, Relationship } from '../../types'
import type { LineageInfo } from '../../lib/lineage'
import { useLang } from '../../i18n/useT'
import { buildFocusedSubgraph, type FocusedMember } from './buildFocusedSubgraph'
import {
  getFallbackGradient, getRingGradient, getRingShadow, PersonAvatarIcon,
} from '../MemberNode'

// ─── Layout constants ────────────────────────────────────────────────────────
const CARD_W = 136
const CARD_H = 120
const AVATAR_SZ = 56
const H_STEP = CARD_W + 44
const V_STEP = CARD_H + 88
const PAD = 72

// ─── Layout engine ───────────────────────────────────────────────────────────

interface LayoutNode {
  member: Member
  role: string
  side?: string
  x: number
  y: number
}

function computeLayout(
  focusedMembers: FocusedMember[],
): { nodes: LayoutNode[]; canvasW: number; canvasH: number } {
  if (focusedMembers.length === 0) return { nodes: [], canvasW: 700, canvasH: 400 }

  const byGen = new Map<number, FocusedMember[]>()
  for (const fm of focusedMembers) {
    if (!byGen.has(fm.generation)) byGen.set(fm.generation, [])
    byGen.get(fm.generation)!.push(fm)
  }

  // gen 0 ordering: siblings (sorted by birth_order) → sibling-spouses → focus → focus's spouses
  const gen0 = byGen.get(0) ?? []
  const siblings = gen0
    .filter(fm => fm.role === 'sibling')
    .sort((a, b) => (a.member.birth_order ?? 99) - (b.member.birth_order ?? 99))
  const sibSpouses = gen0.filter(fm => fm.role === 'sibling-spouse')
  const focusMem = gen0.find(fm => fm.role === 'focus')
  const spouses = gen0.filter(fm => fm.role === 'spouse')
  const gen0Ordered: FocusedMember[] = [
    ...siblings, ...sibSpouses, ...(focusMem ? [focusMem] : []), ...spouses,
  ]
  const focusIdxInRow = Math.max(0, gen0Ordered.findIndex(fm => fm.role === 'focus'))

  const rowLengths = [
    byGen.get(2)?.length ?? 0,
    byGen.get(1)?.length ?? 0,
    gen0Ordered.length,
    byGen.get(-1)?.length ?? 0,
    byGen.get(-2)?.length ?? 0,
  ]
  const maxRowLen = Math.max(...rowLengths, 1)
  const canvasW = Math.max(maxRowLen * H_STEP + PAD * 2, 700)
  const centerX = canvasW / 2

  const usedGens = Array.from(byGen.keys()).sort((a, b) => b - a)
  const maxGen = usedGens[0]
  const getY = (gen: number) => (maxGen - gen) * V_STEP + PAD

  const nodes: LayoutNode[] = []

  // gen 0 — focus pinned to center
  const focusCardX = centerX - CARD_W / 2
  gen0Ordered.forEach((fm, idx) => {
    nodes.push({
      member: fm.member,
      role: fm.role,
      side: fm.side,
      x: focusCardX + (idx - focusIdxInRow) * H_STEP,
      y: getY(0),
    })
  })

  // other generations — centered, paternal side first
  for (const gen of [2, 1, -1, -2]) {
    const row = byGen.get(gen) ?? []
    if (row.length === 0) continue
    const sorted = [...row].sort((a, b) => {
      const sa = a.side === 'paternal' ? 0 : a.side === 'maternal' ? 1 : 2
      const sb = b.side === 'paternal' ? 0 : b.side === 'maternal' ? 1 : 2
      return sa - sb
    })
    const rowW = sorted.length * H_STEP - (H_STEP - CARD_W)
    const startX = centerX - rowW / 2
    sorted.forEach((fm, idx) => {
      nodes.push({ member: fm.member, role: fm.role, side: fm.side, x: startX + idx * H_STEP, y: getY(gen) })
    })
  }

  // shift right if any node overflows left
  const minX = Math.min(...nodes.map(n => n.x))
  const xShift = minX < PAD ? PAD - minX : 0
  nodes.forEach(n => { n.x += xShift })

  const canvasH = Math.max(...nodes.map(n => n.y)) + CARD_H + PAD
  return { nodes, canvasW: canvasW + xShift, canvasH }
}

// ─── Connectors ───────────────────────────────────────────────────────────────

function buildConnectors(nodes: LayoutNode[], relationships: Relationship[]) {
  const posMap = new Map(nodes.map(n => [n.member.id, n]))
  const CARD_TOP_OFFSET = AVATAR_SZ - 10

  const pcLines: string[] = []
  const seenParent = new Set<string>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    const key = `${r.member_a_id}→${r.member_b_id}`
    if (seenParent.has(key)) continue
    seenParent.add(key)
    const parent = posMap.get(r.member_a_id)
    const child = posMap.get(r.member_b_id)
    if (!parent || !child) continue
    const px = Math.round(parent.x + CARD_W / 2)
    const py = Math.round(parent.y + CARD_H + 2)
    const cx = Math.round(child.x + CARD_W / 2)
    const cy = Math.round(child.y + CARD_TOP_OFFSET)
    const mid = Math.round(py + (cy - py) * 0.5)
    pcLines.push(`M ${px} ${py} L ${px} ${mid} L ${cx} ${mid} L ${cx} ${cy}`)
  }

  const spLines: Array<{ x1: number; x2: number; y: number }> = []
  const seenSpouse = new Set<string>()
  for (const r of relationships) {
    if (r.type !== 'spouse') continue
    const key = [r.member_a_id, r.member_b_id].sort().join(':')
    if (seenSpouse.has(key)) continue
    seenSpouse.add(key)
    const a = posMap.get(r.member_a_id)
    const b = posMap.get(r.member_b_id)
    if (!a || !b) continue
    const leftX = Math.min(a.x, b.x) + CARD_W
    const rightX = Math.max(a.x, b.x)
    if (rightX > leftX + 4) {
      spLines.push({ x1: leftX - 6, x2: rightX + 6, y: Math.min(a.y, b.y) + AVATAR_SZ / 2 + 4 })
    }
  }
  return { pcLines, spLines }
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface FocusedCentricViewProps {
  allMembers: Member[]
  allRelationships: Relationship[]
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

  const focusedMembers = useMemo(
    () => buildFocusedSubgraph(focusId, allMembers, allRelationships),
    [focusId, allMembers, allRelationships],
  )

  const { nodes, canvasW, canvasH } = useMemo(
    () => computeLayout(focusedMembers),
    [focusedMembers],
  )

  const { pcLines, spLines } = useMemo(
    () => buildConnectors(nodes, allRelationships),
    [nodes, allRelationships],
  )

  // Center the focus node whenever it changes
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const focusNode = nodes.find(n => n.member.id === focusId)
    if (!focusNode) return
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    setTx(w / 2 - (focusNode.x + CARD_W / 2) * scale)
    setTy(h / 2 - (focusNode.y + CARD_H / 2) * scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, nodes])

  useEffect(() => {
    setFocusId(initialFocusId)
    setNavStack([initialFocusId])
  }, [initialFocusId])

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
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return
    isDragging.current = true
    setTx(dragRef.current.tx0 + (e.clientX - dragRef.current.sx))
    setTy(dragRef.current.ty0 + (e.clientY - dragRef.current.sy))
  }
  const onMouseUp = () => { dragRef.current = null }

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

  const usedGens = new Set(focusedMembers.map(fm => fm.generation))

  return (
    <div
      className="w-full relative flex flex-col select-none"
      style={{
        height: 'calc(100vh - 80px)',
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
        style={{ touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
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
        {/* Side tints */}
        {nodes.some(n => n.side === 'paternal') && (
          <div
            className="absolute pointer-events-none rounded-2xl"
            style={{
              left: 0, top: PAD, width: canvasW / 2 - 20, height: canvasH - PAD * 2,
              background: 'linear-gradient(to right, rgba(0,122,255,0.03), transparent)',
            }}
          />
        )}
        {nodes.some(n => n.side === 'maternal') && (
          <div
            className="absolute pointer-events-none rounded-2xl"
            style={{
              right: 0, top: PAD, width: canvasW / 2 - 20, height: canvasH - PAD * 2,
              background: 'linear-gradient(to left, rgba(52,199,89,0.03), transparent)',
            }}
          />
        )}

        {/* Generation labels */}
        {([
          { gen: 2,  label: t.genGrandparents },
          { gen: 1,  label: t.genParents },
          { gen: -1, label: t.genChildren },
          { gen: -2, label: t.genGrandchildren },
        ] as const).map(({ gen, label }) => {
          if (!usedGens.has(gen)) return null
          const sample = nodes.find(n => focusedMembers.find(fm => fm.member.id === n.member.id && fm.generation === gen))
          if (!sample) return null
          return (
            <div
              key={gen}
              className="absolute text-[9px] font-bold uppercase tracking-widest text-[#8E8E93] pointer-events-none"
              style={{ left: 8, top: sample.y + CARD_H / 2 - 6 }}
            >
              {label}
            </div>
          )
        })}

        {/* Connectors — keyed by focusId so they crossfade with the nodes */}
        <AnimatePresence mode="wait">
          <motion.svg
            key={`svg-${focusId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, overflow: 'visible' }}
            width={canvasW}
            height={canvasH}
          >
            <defs>
              <linearGradient id="fc-pc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2B6BFF" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#6C47FF" stopOpacity="0.7" />
              </linearGradient>
              <linearGradient id="fc-sp" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#FF5EAE" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#6C47FF" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            {pcLines.map((d, i) => (
              <path key={i} d={d} stroke="url(#fc-pc)" strokeWidth="2.25" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {spLines.map((sl, i) => (
              <line key={i} x1={sl.x1} y1={sl.y} x2={sl.x2} y2={sl.y} stroke="url(#fc-sp)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
            ))}
          </motion.svg>
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
            {nodes.map(node => (
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
// Cards are positioned via CSS left/top — NO position animation.
// Only opacity + scale animate on enter/exit so the view never looks
// like a card explosion.

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
  const [hovered, setHovered] = useState(false)
  const deceased = !!member.death_date
  const birthYear = member.birth_date ? new Date(member.birth_date).getFullYear() : null
  const deathYear = member.death_date ? new Date(member.death_date).getFullYear() : null
  const labelDate = birthYear ? (deathYear ? `${birthYear}–${deathYear}` : `${birthYear}`) : null

  const sz = isFocus ? 68 : 50
  const overlap = Math.round(sz * 0.38)
  const cardW = isFocus ? sz + 68 : sz + 46

  return (
    // Outer div: positioned absolutely via CSS. No Framer Motion position animation.
    <div
      className="absolute"
      style={{ left: x, top: y, width: cardW }}
    >
      <motion.button
        type="button"
        onClick={onClick}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileHover={{ y: -3, scale: isFocus ? 1.02 : 1.05 }}
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
            padding: isFocus ? 3 : 2,
            background: getRingGradient(member),
            boxShadow: isFocus
              ? '0 14px 34px rgba(0,122,255,0.35), 0 2px 8px rgba(0,0,0,0.1)'
              : getRingShadow(member),
            opacity: deceased ? 0.78 : 1,
          }}
        >
          <div className="rounded-full bg-white" style={{ padding: 1.5 }}>
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
                  <span className="text-[7.5px] bg-black/60 text-white px-1 py-[1px] rounded-full font-bold">ז״ל</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Name card */}
        <div
          className="relative rounded-[15px] border border-white/70 px-2 pb-2"
          style={{
            marginTop: -overlap,
            paddingTop: overlap + 6,
            width: cardW,
            background: isFocus
              ? 'linear-gradient(180deg, #EEF4FF 0%, #FAFBFF 100%)'
              : 'linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%)',
            boxShadow: isFocus
              ? '0 2px 4px rgba(0,0,0,0.04), 0 12px 28px rgba(0,122,255,0.13), 0 3px 8px rgba(17,34,64,0.06)'
              : '0 1px 2px rgba(0,0,0,0.04), 0 6px 16px rgba(17,34,64,0.07)',
          }}
        >
          <p
            className="font-bold text-[#1C1C1E] leading-tight text-center truncate"
            style={{ fontSize: isFocus ? 13 : 11 }}
          >
            {member.first_name}
          </p>
          <p
            className="text-[#636366] leading-tight text-center truncate"
            style={{ fontSize: isFocus ? 10.5 : 9.5 }}
          >
            {member.last_name}
          </p>

          {/* Progressive disclosure — dates appear on hover or always for focus */}
          <AnimatePresence>
            {(hovered || isFocus) && labelDate && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.14 }}
                className="leading-tight text-center font-semibold overflow-hidden"
                style={{
                  fontSize: 9,
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
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </div>
  )
}

// ─── Mini-map ─────────────────────────────────────────────────────────────────
