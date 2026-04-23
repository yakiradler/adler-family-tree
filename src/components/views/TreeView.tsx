import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, type Translations } from '../../i18n/useT'
import MemberNode from '../MemberNode'
import type { Member, Relationship } from '../../types'

// ─── Layout constants (Instagram-story-card style) ─────────────────────────
const AVATAR = 64                // avatar diameter
const NODE_W = AVATAR + 72       // wider card so sibling names never collide
const NODE_H = AVATAR + 62       // photo + card height
const H_GAP = 28                 // generous breathing room between siblings
const V_GAP = 78                 // more vertical air between generations
const COUPLE_GAP = 14

interface LayoutNode {
  member: Member
  x: number
  y: number
  generation: number
}

function buildLayout(members: Member[], relationships: Relationship[]): LayoutNode[] {
  if (members.length === 0) return []

  const memberById = new Map(members.map(m => [m.id, m]))
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()

  for (const r of relationships) {
    if (r.type === 'parent-child') {
      if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
      parentsOf.get(r.member_b_id)!.push(r.member_a_id)
      if (!childrenOf.has(r.member_a_id)) childrenOf.set(r.member_a_id, [])
      const ch = childrenOf.get(r.member_a_id)!
      if (!ch.includes(r.member_b_id)) ch.push(r.member_b_id)
    }
    if (r.type === 'spouse') {
      const add = (a: string, b: string) => {
        if (!spousesOf.has(a)) spousesOf.set(a, [])
        if (!spousesOf.get(a)!.includes(b)) spousesOf.get(a)!.push(b)
      }
      add(r.member_a_id, r.member_b_id)
      add(r.member_b_id, r.member_a_id)
    }
  }

  // True roots: members with no parents
  const rootIds = new Set(members.filter(m => !parentsOf.has(m.id)).map(m => m.id))

  // Primary parent: prefer male so each child placed once
  const primaryParentOf = new Map<string, string>()
  for (const [childId, parents] of parentsOf) {
    const malePrimary = parents.find(p => memberById.get(p)?.gender === 'male')
    primaryParentOf.set(childId, malePrimary ?? parents[0])
  }

  const ownerChildrenOf = new Map<string, string[]>()
  for (const [childId, parentId] of primaryParentOf) {
    if (!ownerChildrenOf.has(parentId)) ownerChildrenOf.set(parentId, [])
    ownerChildrenOf.get(parentId)!.push(childId)
  }

  // Sort siblings by age / birth order — eldest first (RTL: appears on right).
  // Precedence: explicit birth_order → birth_date → first_name alpha.
  const siblingSort = (aId: string, bId: string) => {
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
  for (const [pid, kids] of ownerChildrenOf) {
    kids.sort(siblingSort)
    ownerChildrenOf.set(pid, kids)
  }

  // "Family unit" children: own children + spouse's own children (also sorted)
  const familyChildrenOf = new Map<string, string[]>()
  for (const m of members) {
    const owned = ownerChildrenOf.get(m.id) ?? []
    const fromSpouses = (spousesOf.get(m.id) ?? []).flatMap(sp => ownerChildrenOf.get(sp) ?? [])
    const all = [...new Set([...owned, ...fromSpouses])]
    all.sort(siblingSort)
    if (all.length > 0) familyChildrenOf.set(m.id, all)
  }

  // Generation via DAG max-depth — combined fixpoint that alternates two rules
  // until stable. This fixes stepchildren (e.g. Shir/Or) appearing on their
  // step-parent's row: a married-in spouse first inherits their partner's
  // generation, then their own children rise one level.
  const genMap = new Map<string, number>()
  members.forEach(m => genMap.set(m.id, 0))
  let changed = true
  let safety = 0
  while (changed && safety++ < 200) {
    changed = false
    // Rule 1: child = max(parents) + 1
    for (const m of members) {
      const parents = parentsOf.get(m.id) ?? []
      if (parents.length === 0) continue
      const newGen = Math.max(...parents.map(p => genMap.get(p) ?? 0)) + 1
      if (newGen > (genMap.get(m.id) ?? 0)) {
        genMap.set(m.id, newGen)
        changed = true
      }
    }
    // Rule 2: married-in spouse (no parents) inherits partner's generation
    for (const m of members) {
      if (parentsOf.has(m.id)) continue
      const currGen = genMap.get(m.id) ?? 0
      for (const sp of spousesOf.get(m.id) ?? []) {
        const spGen = genMap.get(sp) ?? 0
        if (spGen > currGen) {
          genMap.set(m.id, spGen)
          changed = true
        }
      }
    }
  }

  // Layout roots: true roots whose primary spouse isn't itself a root-with-descendants
  const processedAsSpouse = new Set<string>()
  const layoutRoots: string[] = []

  for (const id of rootIds) {
    if (processedAsSpouse.has(id)) continue
    const spouses = spousesOf.get(id) ?? []
    const primarySpouse = spouses[0]
    if (primarySpouse && !rootIds.has(primarySpouse)) {
      // Married in → placed via partner
      processedAsSpouse.add(id)
      continue
    }
    layoutRoots.push(id)
    for (const sp of spouses) if (rootIds.has(sp)) processedAsSpouse.add(sp)
    processedAsSpouse.add(id)
  }

  // Subtree width
  const swCache = new Map<string, number>()
  function subtreeWidth(id: string): number {
    if (swCache.has(id)) return swCache.get(id)!
    const children = familyChildrenOf.get(id) ?? []
    const spouses = spousesOf.get(id) ?? []
    const placedSpouses = spouses.filter(sp => !layoutRoots.includes(sp))
    const coupleWidth = NODE_W + placedSpouses.length * (NODE_W + COUPLE_GAP)

    let childrenWidth = 0
    if (children.length > 0) {
      childrenWidth = children.reduce((s, c) => s + subtreeWidth(c), 0) + H_GAP * (children.length - 1)
    }
    const w = Math.max(coupleWidth, childrenWidth)
    swCache.set(id, w)
    return w
  }
  layoutRoots.forEach(id => subtreeWidth(id))
  members.forEach(m => { if (!swCache.has(m.id)) subtreeWidth(m.id) })

  // Assign positions
  const xPos = new Map<string, number>()
  const placed = new Set<string>()

  function assign(id: string, leftX: number) {
    if (placed.has(id)) return
    placed.add(id)
    const children = familyChildrenOf.get(id) ?? []
    const spouses = spousesOf.get(id) ?? []
    const spousesToPlace = spouses.filter(sp => !layoutRoots.includes(sp) && !placed.has(sp))

    if (children.length === 0) {
      xPos.set(id, leftX)
      let nextX = leftX + NODE_W + COUPLE_GAP
      for (const sp of spousesToPlace) {
        xPos.set(sp, nextX); placed.add(sp); nextX += NODE_W + COUPLE_GAP
      }
    } else {
      let childLeft = leftX
      for (const c of children) {
        assign(c, childLeft)
        childLeft += subtreeWidth(c) + H_GAP
      }
      const firstCX = xPos.get(children[0])!
      const lastCX = xPos.get(children[children.length - 1])!
      const midX = (firstCX + lastCX + NODE_W) / 2

      if (spousesToPlace.length > 0) {
        const totalCoupleW = NODE_W + spousesToPlace.length * (NODE_W + COUPLE_GAP)
        const coupleLeft = midX - totalCoupleW / 2
        xPos.set(id, coupleLeft)
        let spX = coupleLeft + NODE_W + COUPLE_GAP
        for (const sp of spousesToPlace) {
          xPos.set(sp, spX); placed.add(sp); spX += NODE_W + COUPLE_GAP
        }
      } else {
        xPos.set(id, midX - NODE_W / 2)
      }
    }
  }

  let startX = 0
  for (const rootId of layoutRoots) {
    assign(rootId, startX)
    startX += subtreeWidth(rootId) + H_GAP * 2
  }
  members.forEach(m => {
    if (!placed.has(m.id)) { xPos.set(m.id, startX); startX += NODE_W + H_GAP }
  })

  return members.map(m => ({
    member: m,
    x: xPos.get(m.id) ?? 0,
    y: (genMap.get(m.id) ?? 0) * (NODE_H + V_GAP),
    generation: genMap.get(m.id) ?? 0,
  }))
}

// ─── Connectors ───────────────────────────────────────────────────────────────

function buildConnectors(nodes: LayoutNode[], relationships: Relationship[]) {
  const posMap = new Map(nodes.map(n => [n.member.id, n]))

  // Group children by parent
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

  // For each child, draw an ORTHOGONAL elbow line from the parents' midpoint
  // straight down, across at the mid-row, then straight down to land exactly
  // on the TOP EDGE of the child's name-card — directly above the name.
  // The card's top edge visually sits at: avatar + ring - overlap ≈ AVATAR - 10
  const CARD_TOP_OFFSET = AVATAR - 10
  for (const [childId, pars] of childToParents) {
    const child = posMap.get(childId)
    if (!child) continue
    const parents = pars.map(p => posMap.get(p)).filter(Boolean) as LayoutNode[]
    if (parents.length === 0) continue

    const childCX = Math.round(child.x + NODE_W / 2)        // exact center of card
    const childTopY = Math.round(child.y + CARD_TOP_OFFSET)  // top edge of name card

    // Parent exit: midpoint of couple (horizontal), bottom of card (vertical)
    const pxMin = Math.min(...parents.map(p => p.x + NODE_W / 2))
    const pxMax = Math.max(...parents.map(p => p.x + NODE_W / 2))
    const parentCX = Math.round((pxMin + pxMax) / 2)
    const parentBottomY = Math.round(parents[0].y + NODE_H + 2)

    // Orthogonal elbow: down → across at 60% of gap → down. Running the bar
    // slightly closer to the children makes each drop shorter and lined up
    // tightly above the name text.
    const gap = childTopY - parentBottomY
    const midY = Math.round(parentBottomY + gap * 0.6)
    const d = `M ${parentCX} ${parentBottomY} L ${parentCX} ${midY} L ${childCX} ${midY} L ${childCX} ${childTopY}`
    lines.push({ d })
  }

  // Spouse lines
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

export default function TreeView() {
  const { members, relationships, selectedMemberId, setSelectedMemberId } = useFamilyStore()
  const { t } = useLang()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const nodes = useMemo(() => buildLayout(members, relationships), [members, relationships])
  const { lines, spouseLines } = useMemo(() => buildConnectors(nodes, relationships), [nodes, relationships])

  // Pan + zoom
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const dragState = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  // Mobile touch state (single-finger pan + two-finger pinch)
  type TouchMode =
    | { mode: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initialDist: number; initialScale: number; cx: number; cy: number; tx0: number; ty0: number }
  const touchState = useRef<TouchMode | null>(null)

  // Canvas dims
  const pad = 48
  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x + NODE_W)) : 0
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y + NODE_H)) : 0
  const minX = nodes.length ? Math.min(...nodes.map(n => n.x), 0) : 0
  const offsetX = minX < 0 ? -minX + pad : pad
  const canvasW = maxX + offsetX + pad
  const canvasH = maxY + pad * 2

  // Initial view: fit the whole tree with a minimum readable scale.
  useEffect(() => {
    if (!wrapRef.current || nodes.length === 0) return
    const w = wrapRef.current.clientWidth
    const h = wrapRef.current.clientHeight
    const fitW = (w - 20) / canvasW
    const fitH = (h - 120) / canvasH
    // Prefer horizontal fit (tree is wider than tall); cap at 0.85 so nodes stay readable-ish.
    const s = Math.max(0.28, Math.min(0.85, Math.min(fitW, fitH)))
    setScale(s)
    setTx((w - canvasW * s) / 2)
    setTy(70)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY * 0.0015
    const newScale = Math.max(0.25, Math.min(2, scale * (1 + delta)))
    const rect = wrapRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    // Zoom toward mouse
    const nxWorld = (cx - tx) / scale
    const nyWorld = (cy - ty) / scale
    setTx(cx - nxWorld * newScale)
    setTy(cy - nyWorld * newScale)
    setScale(newScale)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    // Only if clicking empty canvas (not a button)
    if ((e.target as HTMLElement).closest('button')) return
    dragState.current = { startX: e.clientX, startY: e.clientY, tx0: tx, ty0: ty }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return
    setTx(dragState.current.tx0 + (e.clientX - dragState.current.startX))
    setTy(dragState.current.ty0 + (e.clientY - dragState.current.startY))
  }
  const onMouseUp = () => { dragState.current = null }

  // ─── Touch handlers (mobile) ─────────────────────────────────────────────
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
      const newScale = Math.max(0.25, Math.min(2.5, st.initialScale * factor))
      // Zoom anchored on the initial pinch center so the point under fingers stays put
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
      // Pinch → fall back to pan with the remaining finger
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
    const newScale = Math.max(0.25, Math.min(2, scale * factor))
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
          // Multi-radial aurora mesh gradient — modern, airy, no hard banding
          'radial-gradient(at 12% 8%, rgba(120,170,255,0.35) 0px, transparent 50%),' +
          'radial-gradient(at 92% 12%, rgba(255,140,200,0.28) 0px, transparent 55%),' +
          'radial-gradient(at 78% 92%, rgba(120,255,220,0.25) 0px, transparent 55%),' +
          'radial-gradient(at 8% 96%, rgba(180,130,255,0.30) 0px, transparent 55%),' +
          'linear-gradient(135deg, #F4F7FF 0%, #FBF7FF 55%, #FFF5FA 100%)',
      }}
    >
      {/* Subtle dotted grid — lower contrast, larger pitch for the new airier feel */}
      <div
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.55) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Canvas */}
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
              <stop offset="0%" stopColor="#2B6BFF" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#6C47FF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#19C6FF" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="sp-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#FF5EAE" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#6C47FF" stopOpacity="0.85" />
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

        {nodes.map(({ member, x, y }) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: Math.min(0.3, y / 2000) }}
            className="absolute"
            style={{ left: x + offsetX, top: y }}
          >
            <MemberNode
              member={member}
              size={AVATAR}
              highlighted={selectedMemberId === member.id}
              onClick={() => setSelectedMemberId(member.id)}
            />
          </motion.div>
        ))}
      </div>

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

      {/* Scale indicator */}
      <div className="absolute bottom-4 left-4 glass rounded-full px-3 py-1.5 text-[#636366] text-sf-caption2 font-semibold shadow-glass-sm z-10">
        {Math.round(scale * 100)}%
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
