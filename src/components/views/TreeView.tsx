import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import MemberNode from '../MemberNode'
import type { Relationship } from '../../types'
import {
  AVATAR, NODE_W, NODE_H,
  type LayoutMode, type LayoutNode,
  buildLayout,
} from './treeLayout'
import { buildParentMap, resolveLineage } from '../../lib/lineage'
import AdvancedFilter, { DEFAULT_FILTERS, type FilterState } from './AdvancedFilter'
import { applyTreeFilters } from './applyTreeFilters'
import FocusedCentricView from './FocusedCentricView'

export type { LayoutMode } from './treeLayout'

// ─── Per-layout colour theme ─────────────────────────────────────────────────
// Each layout mode gets a distinct connector palette so switching the
// view also shifts the visual atmosphere — the user explicitly asked
// for "a hue change between tree layout modes". Picked deliberately:
// classic = signature blue, grid = emerald (tabular calm), arc = amber
// (warm storytelling), staggered = violet (playful).
const LAYOUT_THEMES: Record<
  LayoutMode,
  { pcStops: [string, string, string]; spStops: [string, string]; bgTint: string }
> = {
  classic:   { pcStops: ['#2B6BFF', '#6C47FF', '#19C6FF'], spStops: ['#FF5EAE', '#6C47FF'], bgTint: 'rgba(43,107,255,0.04)' },
  grid:      { pcStops: ['#10B981', '#059669', '#22D3EE'], spStops: ['#F472B6', '#10B981'], bgTint: 'rgba(16,185,129,0.05)' },
  arc:       { pcStops: ['#F59E0B', '#FB923C', '#F43F5E'], spStops: ['#FB923C', '#F43F5E'], bgTint: 'rgba(245,158,11,0.05)' },
  staggered: { pcStops: ['#8B5CF6', '#D946EF', '#22D3EE'], spStops: ['#EC4899', '#8B5CF6'], bgTint: 'rgba(139,92,246,0.05)' },
}

// ─── Connectors ───────────────────────────────────────────────────────────────

function buildConnectors(nodes: LayoutNode[], relationships: Relationship[]) {
  const posMap = new Map(nodes.map(n => [n.member.id, n]))

  const parentGroups = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    if (!parentGroups.has(r.member_a_id)) parentGroups.set(r.member_a_id, [])
    const ch = parentGroups.get(r.member_a_id)!
    if (!ch.includes(r.member_b_id)) ch.push(r.member_b_id)
  }

  const childToParents = new Map<string, string[]>()
  for (const [p, kids] of parentGroups) {
    for (const k of kids) {
      if (!childToParents.has(k)) childToParents.set(k, [])
      childToParents.get(k)!.push(p)
    }
  }

  interface LineD { d: string }
  const lines: LineD[] = []

  // Orthogonal elbow drawn from the *anchor parent* (NOT the midpoint).
  // Anchor priority:
  //   1. explicit `child.member.connector_parent_id`  — manual override
  //   2. the child's mother (parent with gender 'female')
  //   3. the first parent we have a layout node for
  // This implements the user's request: "every child's connector should
  // come from the mother by default, with a way to change it per
  // member." Falling back to the father preserves single-parent trees.
  const CARD_TOP_OFFSET = AVATAR - 10
  for (const [childId, pars] of childToParents) {
    const child = posMap.get(childId)
    if (!child) continue
    const parents = pars.map(p => posMap.get(p)).filter(Boolean) as LayoutNode[]
    if (parents.length === 0) continue

    const explicit = child.member.connector_parent_id
    const anchor =
      (explicit && parents.find(p => p.member.id === explicit)) ||
      parents.find(p => p.member.gender === 'female') ||
      parents[0]

    const childCX = Math.round(child.x + NODE_W / 2)
    const childTopY = Math.round(child.y + CARD_TOP_OFFSET)

    const parentCX = Math.round(anchor.x + NODE_W / 2)
    const parentBottomY = Math.round(anchor.y + NODE_H + 2)

    const gap = childTopY - parentBottomY
    const midY = Math.round(parentBottomY + gap * 0.6)
    const d = `M ${parentCX} ${parentBottomY} L ${parentCX} ${midY} L ${childCX} ${midY} L ${childCX} ${childTopY}`
    lines.push({ d })
  }

  interface SpouseLine { x1: number; x2: number; y: number }
  const spouseLines: SpouseLine[] = []
  const seen = new Set<string>()
  for (const r of relationships) {
    if (r.type !== 'spouse') continue
    const key = [r.member_a_id, r.member_b_id].sort().join(':')
    if (seen.has(key)) continue
    seen.add(key)
    const a = posMap.get(r.member_a_id)
    const b = posMap.get(r.member_b_id)
    if (!a || !b || a.generation !== b.generation) continue
    const leftX = Math.min(a.x, b.x) + NODE_W
    const rightX = Math.max(a.x, b.x)
    if (rightX > leftX + 4) {
      spouseLines.push({ x1: leftX - 6, x2: rightX + 6, y: a.y + AVATAR / 2 + 4 })
    }
  }

  return { lines, spouseLines }
}

// ─── Main TreeView ─────────────────────────────────────────────────────────────

const LAYOUT_STORAGE_KEY = 'ft-tree-layout-mode'
const isLayoutMode = (v: unknown): v is LayoutMode =>
  v === 'classic' || v === 'grid' || v === 'arc' || v === 'staggered'

export default function TreeView() {
  const { members: allMembers, relationships, selectedMemberId, setSelectedMemberId, activeTreeId } = useFamilyStore()
  // Narrow the population to the currently active tree. `null` means
  // the default/main tree which is everyone without a tree_id; an
  // explicit id picks that named tree.
  const members = useMemo(
    () =>
      activeTreeId == null
        ? allMembers.filter((m) => !m.tree_id)
        : allMembers.filter((m) => m.tree_id === activeTreeId),
    [allMembers, activeTreeId],
  )
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'classic'
    const saved = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    return isLayoutMode(saved) ? saved : 'classic'
  })
  useEffect(() => {
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, layoutMode) } catch { /* ignore */ }
  }, [layoutMode])

  // Advanced filter (lineage / former spouses / deceased / search / focus).
  // Filters apply BEFORE buildLayout so the resulting tree only contains
  // matching members + their inter-relationships.
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  // Focused-Centric mode — replaces the full-tree canvas with a 3-generation
  // subgraph centred on a chosen person.
  const [isFocusedMode, setIsFocusedMode] = useState(false)
  const focusCentricId = selectedMemberId ?? members[0]?.id ?? null

  // Resolve full lineage map first — needed for the lineage filter to
  // honour the male-only Kohen/Levi rule.
  const fullLineageById = useMemo(() => {
    const parentMap = buildParentMap(members, relationships)
    const map = new Map<string, ReturnType<typeof resolveLineage>>()
    for (const m of members) map.set(m.id, resolveLineage(m, parentMap))
    return map
  }, [members, relationships])

  const filtered = useMemo(
    () => applyTreeFilters(members, relationships, filters, fullLineageById),
    [members, relationships, filters, fullLineageById],
  )

  const nodes = useMemo(
    () => buildLayout(filtered.members, filtered.relationships, layoutMode, {
      showFormerSpouses: filters.showFormerSpouses,
    }),
    [filtered, layoutMode, filters.showFormerSpouses],
  )
  const { lines, spouseLines } = useMemo(
    () => buildConnectors(nodes, filtered.relationships),
    [nodes, filtered.relationships],
  )
  // Reuse the full-population lineage map for per-card rendering — it
  // already covers everyone, including filtered-out parents whose Kohen
  // status feeds inheritance for visible descendants.
  const lineageById = fullLineageById

  // Pan + zoom — persisted in Zustand so closing the member panel,
  // navigating away and back, or any unrelated re-render keeps the
  // user exactly where they left off.
  const treeViewport = useFamilyStore((s) => s.treeViewport)
  const setTreeViewport = useFamilyStore((s) => s.setTreeViewport)
  const setScale = (v: number | ((prev: number) => number)) =>
    setTreeViewport({ scale: typeof v === 'function' ? v(treeViewport.scale) : v })
  const setTx = (v: number | ((prev: number) => number)) =>
    setTreeViewport({ tx: typeof v === 'function' ? v(treeViewport.tx) : v })
  const setTy = (v: number | ((prev: number) => number)) =>
    setTreeViewport({ ty: typeof v === 'function' ? v(treeViewport.ty) : v })
  const scale = treeViewport.scale
  const tx = treeViewport.tx
  const ty = treeViewport.ty
  const dragState = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  type TouchMode =
    | { mode: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initialDist: number; initialScale: number; cx: number; cy: number; tx0: number; ty0: number }
  const touchState = useRef<TouchMode | null>(null)

  const pad = 48
  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x + NODE_W)) : 0
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y + NODE_H)) : 0
  const minX = nodes.length ? Math.min(...nodes.map(n => n.x), 0) : 0
  const offsetX = minX < 0 ? -minX + pad : pad
  const canvasW = maxX + offsetX + pad
  const canvasH = maxY + pad * 2

  // Auto-fit only on:
  //   1. First mount (initialised flag is false)
  //   2. Layout-mode switch
  //   3. Filtered population *materially* changed shape (canvas resized)
  // Avoids the previous behaviour where closing the member panel
  // snapped the user back to the default view — the viewport now lives
  // in the store and survives re-renders.
  const lastShapeRef = useRef<string>('')
  useEffect(() => {
    if (!wrapRef.current || nodes.length === 0) return
    const shape = `${nodes.length}|${Math.round(canvasW)}|${Math.round(canvasH)}|${layoutMode}`
    const prev = lastShapeRef.current
    lastShapeRef.current = shape

    // Skip auto-fit if the shape is unchanged AND we've already
    // initialised — i.e. this re-render is not about the layout.
    if (treeViewport.initialised && prev === shape) return

    const w = wrapRef.current.clientWidth
    const h = wrapRef.current.clientHeight
    const fitW = (w - 20) / canvasW
    const fitH = (h - 120) / canvasH
    const s = Math.max(0.28, Math.min(0.85, Math.min(fitW, fitH)))
    setTreeViewport({ scale: s, tx: (w - canvasW * s) / 2, ty: 70, initialised: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, canvasW, canvasH, layoutMode])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY * 0.0015
    const newScale = Math.max(0.05, Math.min(8, scale * (1 + delta)))
    const rect = wrapRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const nxWorld = (cx - tx) / scale
    const nyWorld = (cy - ty) / scale
    setTx(cx - nxWorld * newScale)
    setTy(cy - nyWorld * newScale)
    setScale(newScale)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    dragState.current = { startX: e.clientX, startY: e.clientY, tx0: tx, ty0: ty }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return
    setTx(dragState.current.tx0 + (e.clientX - dragState.current.startX))
    setTy(dragState.current.ty0 + (e.clientY - dragState.current.startY))
  }
  const onMouseUp = () => { dragState.current = null }

  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = {
        mode: 'pan',
        startX: t.clientX, startY: t.clientY,
        tx0: tx, ty0: ty,
      }
    } else if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dx = b.clientX - a.clientX
      const dy = b.clientY - a.clientY
      const dist = Math.hypot(dx, dy) || 1
      const cx = (a.clientX + b.clientX) / 2 - rect.left
      const cy = (a.clientY + b.clientY) / 2 - rect.top
      touchState.current = {
        mode: 'pinch',
        initialDist: dist,
        initialScale: scale,
        cx, cy,
        tx0: tx, ty0: ty,
      }
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
      const newScale = Math.max(0.05, Math.min(8, st.initialScale * factor))
      const nxWorld = (st.cx - st.tx0) / st.initialScale
      const nyWorld = (st.cy - st.ty0) / st.initialScale
      setTx(st.cx - nxWorld * newScale)
      setTy(st.cy - nyWorld * newScale)
      setScale(newScale)
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touchState.current = null
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = {
        mode: 'pan',
        startX: t.clientX, startY: t.clientY,
        tx0: tx, ty0: ty,
      }
    }
  }

  const fitToView = () => {
    if (!wrapRef.current) return
    const w = wrapRef.current.clientWidth
    const h = wrapRef.current.clientHeight
    const fit = Math.min(w / canvasW, h / canvasH, 1)
    const s = Math.max(0.25, fit * 0.95)
    setScale(s)
    setTx((w - canvasW * s) / 2)
    setTy(20)
  }

  const zoomBy = (factor: number) => {
    const newScale = Math.max(0.05, Math.min(8, scale * factor))
    const w = wrapRef.current?.clientWidth ?? 0
    const h = wrapRef.current?.clientHeight ?? 0
    const cx = w / 2, cy = h / 2
    const nxWorld = (cx - tx) / scale
    const nyWorld = (cy - ty) / scale
    setTx(cx - nxWorld * newScale)
    setTy(cy - nyWorld * newScale)
    setScale(newScale)
  }

  if (members.length === 0) return <EmptyState t={t} />

  const theme = LAYOUT_THEMES[layoutMode]

  return (
    <div
      ref={wrapRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="w-full relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{
        height: 'calc(100vh - 80px)',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        background:
          'radial-gradient(at 12% 8%, rgba(120,170,255,0.35) 0px, transparent 50%),' +
          'radial-gradient(at 92% 12%, rgba(255,140,200,0.28) 0px, transparent 55%),' +
          'radial-gradient(at 78% 92%, rgba(120,255,220,0.25) 0px, transparent 55%),' +
          'radial-gradient(at 8% 96%, rgba(180,130,255,0.30) 0px, transparent 55%),' +
          `linear-gradient(135deg, #F4F7FF 0%, #FBF7FF 55%, #FFF5FA 100%), ${theme.bgTint}`,
      }}
    >
      <div
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.55) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <div
        ref={canvasRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: canvasW,
          height: canvasH,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          className="absolute pointer-events-none"
          style={{ left: 0, top: 0, overflow: 'visible' }}
          width={canvasW}
          height={canvasH}
        >
          <defs>
            <linearGradient id="pc-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={theme.pcStops[0]} stopOpacity="0.95" />
              <stop offset="55%" stopColor={theme.pcStops[1]} stopOpacity="0.85" />
              <stop offset="100%" stopColor={theme.pcStops[2]} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="sp-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={theme.spStops[0]} stopOpacity="0.85" />
              <stop offset="100%" stopColor={theme.spStops[1]} stopOpacity="0.85" />
            </linearGradient>
            <filter id="pc-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {lines.map((l, i) => (
            <path
              key={`pc-${i}`}
              d={l.d}
              stroke="url(#pc-grad)"
              strokeWidth="2.75"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#pc-glow)"
            />
          ))}
          {spouseLines.map((l, i) => (
            <line
              key={`sp-${i}`}
              x1={l.x1} y1={l.y} x2={l.x2} y2={l.y}
              stroke="url(#sp-grad)"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeDasharray="6 5"
            />
          ))}
        </svg>

        {nodes.map(({ member, x, y, secondaryPartners }) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{
              opacity: 1,
              scale: 1,
              left: x + offsetX,
              top: y,
            }}
            transition={{
              opacity: { duration: 0.25, delay: Math.min(0.3, y / 2000) },
              scale:   { duration: 0.25, delay: Math.min(0.3, y / 2000) },
              left: { type: 'spring', stiffness: 180, damping: 26 },
              top:  { type: 'spring', stiffness: 180, damping: 26 },
            }}
            className="absolute"
          >
            <MemberNode
              member={member}
              size={AVATAR}
              highlighted={selectedMemberId === member.id}
              onClick={() => setSelectedMemberId(member.id)}
              lineage={lineageById.get(member.id)}
              secondaryPartners={secondaryPartners}
              onSecondarySelect={(id) => setSelectedMemberId(id)}
            />
          </motion.div>
        ))}
      </div>

      {/* Floating bottom layout picker — single collapsed button expanding to 4 */}
      <LayoutPicker mode={layoutMode} onChange={setLayoutMode} t={t} />

      {/* Advanced filter (lineage / divorces / deceased / search / focus) */}
      <AdvancedFilter
        filters={filters}
        onChange={setFilters}
        members={members}
        relationships={relationships}
        matchedCount={filtered.members.length}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10">
        <button
          onClick={() => zoomBy(1.2)}
          className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
          aria-label="zoom in"
        >+</button>
        <button
          onClick={() => zoomBy(1 / 1.2)}
          className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
          aria-label="zoom out"
        >−</button>
        <button
          onClick={fitToView}
          className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center active:scale-95 transition"
          aria-label="fit"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" stroke="#007AFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="absolute bottom-4 left-4 glass rounded-full px-3 py-1.5 text-[#636366] text-sf-caption2 font-semibold shadow-glass-sm z-10">
        {Math.round(scale * 100)}%
      </div>

      {/* Focused-Centric mode toggle button — mirrors AdvancedFilter on the opposite side */}
      {focusCentricId && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsFocusedMode(m => !m)}
          title={t.focusedEnterBtn}
          className={`absolute top-[72px] z-20 flex items-center gap-1.5 rounded-full px-3.5 py-2 shadow-glass font-semibold text-[12.5px] border transition ${
            isFocusedMode
              ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white border-transparent'
              : 'bg-white/95 text-[#1C1C1E] border-white/70 hover:bg-white'
          }`}
          style={{ [rtl ? 'left' : 'right']: 12 } as React.CSSProperties}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" />
          </svg>
          <span>{t.focusedEnterBtn}</span>
        </motion.button>
      )}

      {/* Focused-Centric overlay — plain conditional render so React removes
          the element immediately on exit (no stuck invisible overlay). */}
      {isFocusedMode && focusCentricId && (
        <div className="absolute inset-0" style={{ zIndex: 25 }}>
          <FocusedCentricView
            allMembers={members}
            allRelationships={relationships}
            initialFocusId={focusCentricId}
            lineageById={lineageById}
            onSelectMember={(id) => setSelectedMemberId(id)}
            onExit={() => setIsFocusedMode(false)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Layout picker ────────────────────────────────────────────────────────
// Collapsed state: a single pill at the BOTTOM-center labelled "שינוי תצוגה"
// with the current mode's icon. Tap → expands upward into 4 options with a
// springy stagger. Tap outside (or a choice) → collapses again.

function LayoutIcon({ mode, className }: { mode: LayoutMode; className?: string }) {
  const stroke = 'currentColor'
  if (mode === 'classic')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
        <circle cx="3" cy="8" r="1.6" fill={stroke} />
        <circle cx="8" cy="8" r="1.6" fill={stroke} />
        <circle cx="13" cy="8" r="1.6" fill={stroke} />
      </svg>
    )
  if (mode === 'grid')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
        <circle cx="4" cy="5" r="1.4" fill={stroke} />
        <circle cx="8" cy="5" r="1.4" fill={stroke} />
        <circle cx="12" cy="5" r="1.4" fill={stroke} />
        <circle cx="4" cy="11" r="1.4" fill={stroke} />
        <circle cx="8" cy="11" r="1.4" fill={stroke} />
        <circle cx="12" cy="11" r="1.4" fill={stroke} />
      </svg>
    )
  if (mode === 'arc')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
        <path d="M2 6 Q 8 14 14 6" stroke={stroke} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <circle cx="2.4" cy="6" r="1.4" fill={stroke} />
        <circle cx="8" cy="10.8" r="1.4" fill={stroke} />
        <circle cx="13.6" cy="6" r="1.4" fill={stroke} />
      </svg>
    )
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="3" cy="5" r="1.4" fill={stroke} />
      <circle cx="8" cy="11" r="1.4" fill={stroke} />
      <circle cx="13" cy="5" r="1.4" fill={stroke} />
      <circle cx="5.5" cy="11" r="1.4" fill={stroke} />
      <circle cx="10.5" cy="11" r="1.4" fill={stroke} />
    </svg>
  )
}

function LayoutPicker({
  mode,
  onChange,
  t,
}: {
  mode: LayoutMode
  onChange: (m: LayoutMode) => void
  t: Translations
}) {
  const [open, setOpen] = useState(false)

  const items: { key: LayoutMode; label: string }[] = [
    { key: 'classic', label: t.layoutClassic },
    { key: 'grid', label: t.layoutGrid },
    { key: 'arc', label: t.layoutArc },
    { key: 'staggered', label: t.layoutStaggered },
  ]
  const currentLabel = items.find(i => i.key === mode)?.label ?? ''

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement
      if (!tgt.closest('[data-layout-picker]')) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      data-layout-picker
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
    >
      <div className="relative pointer-events-auto flex flex-col items-center gap-2">
        {/* Expanded option list — appears ABOVE the main button */}
        <AnimatePresence>
          {open && (
            <motion.div
              key="options"
              initial={{ opacity: 0, y: 12, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="glass-strong shadow-glass rounded-3xl p-2 border border-white/60 flex flex-col gap-1 min-w-[200px]"
              role="radiogroup"
              aria-label={t.layoutPicker}
            >
              {items.map((it, idx) => {
                const active = mode === it.key
                return (
                  <motion.button
                    key={it.key}
                    role="radio"
                    aria-checked={active}
                    onClick={() => { onChange(it.key); setOpen(false) }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    whileTap={{ scale: 0.97 }}
                    className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sf-subhead font-semibold transition-colors ${
                      active ? 'text-white' : 'text-[#1C1C1E] hover:bg-white/60'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="layout-option-active"
                        className="absolute inset-0 rounded-2xl"
                        style={{
                          background:
                            'linear-gradient(135deg, #2B6BFF 0%, #6C47FF 55%, #19C6FF 100%)',
                          boxShadow: '0 6px 16px rgba(108,71,255,0.35)',
                        }}
                        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2.5 w-full">
                      <LayoutIcon mode={it.key} />
                      <span className="flex-1 text-right">{it.label}</span>
                      {active && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2 7l3.5 3.5L12 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* The main toggle button — always visible */}
        <motion.button
          onClick={() => setOpen(v => !v)}
          whileTap={{ scale: 0.96 }}
          className="glass-strong shadow-glass rounded-full px-4 h-11 border border-white/60 flex items-center gap-2.5 text-[#1C1C1E] font-semibold"
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-white"
            style={{
              background:
                'linear-gradient(135deg, #2B6BFF 0%, #6C47FF 55%, #19C6FF 100%)',
              boxShadow: '0 4px 10px rgba(108,71,255,0.35)',
            }}
          >
            <LayoutIcon mode={mode} />
          </span>
          <span className="text-sf-subhead leading-none">
            <span className="block text-[10px] font-medium text-[#8E8E93]">{t.layoutPicker}</span>
            <span className="block">{currentLabel}</span>
          </span>
          <motion.svg
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
            className="opacity-60"
          >
            <path d="M3 9l4-4 4 4" stroke="#636366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        </motion.button>
      </div>
    </div>
  )
}

function EmptyState({ t }: { t: Translations }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-4 text-center px-8 pt-20">
      <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="10" r="5" fill="#007AFF" opacity="0.6" />
          <circle cx="10" cy="28" r="4" fill="#5856D6" opacity="0.5" />
          <circle cx="30" cy="28" r="4" fill="#5856D6" opacity="0.5" />
          <path d="M20 15v8M20 23L10 25M20 23L30 25" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-sf-title3 text-[#1C1C1E] mb-1">{t.treeEmptyTitle}</h3>
        <p className="text-sf-subhead text-[#8E8E93]">{t.treeEmptyDesc}</p>
      </div>
    </motion.div>
  )
}
