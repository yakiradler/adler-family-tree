import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import MemberNode from '../MemberNode'
import QuickAddRelativeModal, { type RelativeDirection } from '../QuickAddRelativeModal'
import type { Member, Relationship } from '../../types'
import {
  AVATAR, NODE_W, NODE_H,
  type LayoutMode, type LayoutNode,
  buildLayout,
} from './treeLayout'
import { getParentMap, resolveLineage } from '../../lib/lineage'
import type { FilterState } from './AdvancedFilter'
import { applyTreeFilters } from './applyTreeFilters'
import FocusedCentricView from './FocusedCentricView'
import TreeMiniMap from './TreeMiniMap'
import Tooltip from '../Tooltip'
import { exportTreeAsPNG, printTree } from '../../lib/treeExport'

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

// ─── Connectors ──────────────────────────────────────────────────────
//
// Clean rewrite paired with the new layout engine. Two kinds of lines:
//
//   1. Spouse line — horizontal segment between the two cards of a
//      `current` couple, drawn at avatar-midline Y. The cards are
//      always at the same generation (the engine enforces this), so
//      the line is purely horizontal and never crosses a row.
//
//   2. Parent-child rail — a single SVG path per couple group:
//        • short vertical from MOTHER's bottom-centre down to the rail
//        • horizontal rail spanning all of her children's centres
//          (extended toward the mother if needed so the elbow is
//          continuous — no "floating" segments)
//        • short vertical from the rail down to each child's top
//      The mother is the anchor (with `connector_parent_id` override
//      respected). Every segment terminates at a card edge — there
//      are no orphan endpoints in mid-canvas.
//
// Both helpers consume LayoutNode positions verbatim and don't try
// to second-guess the engine.

function buildConnectors(nodes: LayoutNode[], relationships: Relationship[]) {
  const byId = new Map(nodes.map((n) => [n.member.id, n]))

  // ── Spouse lines ───────────────────────────────────────────────────
  interface SpouseLine { x1: number; x2: number; y: number }
  const spouseLines: SpouseLine[] = []
  const seenSpouse = new Set<string>()
  for (const r of relationships) {
    if (r.type !== 'spouse') continue
    if ((r.status ?? 'current') !== 'current') continue
    const key = [r.member_a_id, r.member_b_id].sort().join(':')
    if (seenSpouse.has(key)) continue
    seenSpouse.add(key)
    const a = byId.get(r.member_a_id)
    const b = byId.get(r.member_b_id)
    if (!a || !b || a.generation !== b.generation) continue
    const leftX = Math.min(a.x, b.x) + NODE_W   // right edge of the left card
    const rightX = Math.max(a.x, b.x)            // left edge of the right card
    if (rightX <= leftX) continue
    spouseLines.push({
      x1: leftX,
      x2: rightX,
      y: a.y + AVATAR / 2 + 4,
    })
  }

  // ── Parent-child rails ─────────────────────────────────────────────
  // Anchor priority for each child:
  //   1. explicit `member.connector_parent_id` override
  //   2. mother (parent with gender 'female')
  //   3. father (parent with gender 'male')
  //   4. first parent we have a node for
  const childToParents = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    if (!byId.has(r.member_a_id) || !byId.has(r.member_b_id)) continue
    const list = childToParents.get(r.member_b_id) ?? []
    if (!list.includes(r.member_a_id)) list.push(r.member_a_id)
    childToParents.set(r.member_b_id, list)
  }

  const anchorOf = new Map<string, string>()  // childId → anchorId
  for (const [childId, parents] of childToParents) {
    const child = byId.get(childId)!
    const explicit = child.member.connector_parent_id
    if (explicit && parents.includes(explicit) && byId.has(explicit)) {
      anchorOf.set(childId, explicit)
      continue
    }
    const mother = parents.find((p) => byId.get(p)?.member.gender === 'female')
    if (mother) { anchorOf.set(childId, mother); continue }
    const father = parents.find((p) => byId.get(p)?.member.gender === 'male')
    if (father) { anchorOf.set(childId, father); continue }
    anchorOf.set(childId, parents[0])
  }

  // Group children by their anchor so one rail covers a whole sibling
  // set rather than one stair-stepped path per child.
  const childrenByAnchor = new Map<string, string[]>()
  for (const [childId, anchorId] of anchorOf) {
    const list = childrenByAnchor.get(anchorId) ?? []
    list.push(childId)
    childrenByAnchor.set(anchorId, list)
  }

  interface PathLine { d: string }
  const lines: PathLine[] = []

  for (const [anchorId, childIds] of childrenByAnchor) {
    const anchor = byId.get(anchorId)
    if (!anchor) continue
    const children = childIds
      .map((id) => byId.get(id))
      .filter((n): n is LayoutNode => n != null)
    if (children.length === 0) continue

    // Y coordinates: rail sits half-way between mother's bottom and the
    // children's top. Children are guaranteed by the engine to share
    // the same Y, but we take the minimum to be safe.
    const anchorBottomY = Math.round(anchor.y + NODE_H)
    const childTopY = Math.round(Math.min(...children.map((c) => c.y)))
    if (childTopY <= anchorBottomY + 2) continue
    const railY = Math.round((anchorBottomY + childTopY) / 2)

    const anchorCx = Math.round(anchor.x + NODE_W / 2)
    const childCxs = children.map((c) => Math.round(c.x + NODE_W / 2))

    // 1. Short vertical from anchor's bottom to the rail.
    lines.push({ d: `M ${anchorCx} ${anchorBottomY} L ${anchorCx} ${railY}` })

    // 2. Horizontal rail. It must reach from the leftmost endpoint
    //    (either the leftmost child or the anchor if she's further left)
    //    to the rightmost endpoint, so the elbow under the anchor is
    //    continuous with the rail above the children.
    const railLeft = Math.min(anchorCx, ...childCxs)
    const railRight = Math.max(anchorCx, ...childCxs)
    if (railRight > railLeft) {
      lines.push({ d: `M ${railLeft} ${railY} L ${railRight} ${railY}` })
    }

    // 3. Short vertical from the rail down to each child's top.
    for (const cx of childCxs) {
      lines.push({ d: `M ${cx} ${railY} L ${cx} ${childTopY}` })
    }
  }

  return { lines, spouseLines }
}

// ─── Main TreeView ─────────────────────────────────────────────────────────────

export default function TreeView({
  filters,
  onMatchedCount,
}: {
  filters: FilterState
  onMatchedCount?: (n: number) => void
}) {
  const {
    members: allMembers, relationships,
    selectedMemberId, setSelectedMemberId,
    activeTreeId, trees,
    layoutMode,
    treeControlsExpanded,
    treeFullscreen, setTreeFullscreen,
    openTreePopover, setOpenTreePopover,
    isFocusedMode, setIsFocusedMode,
    isEditMode,
  } = useFamilyStore()
  // Quick-add popover state. Lives at the TreeView level rather than
  // per-card so opening one closes any other (the modal is a singleton)
  // and the wrapping AnimatePresence transitions cleanly.
  const [quickAdd, setQuickAdd] = useState<{
    anchor: Member
    direction: RelativeDirection
  } | null>(null)
  const activeTree = activeTreeId == null ? null : trees.find((tr) => tr.id === activeTreeId) ?? null
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

  // layoutMode now lives in the Zustand store so the bottom-nav
  // "פריסה" picker (rendered by Navigation) can read + change the
  // same value — see useFamilyStore for the persistence hook.

  // Focused-Centric mode — replaces the full-tree canvas with a
  // 3-generation subgraph centred on a chosen person. `isFocusedMode`
  // lives in the store now so TreePage can hide its own chrome while
  // focused mode is overlaid (otherwise the hamburger keeps floating
  // over the focused view and people mistake it for the "exit" button).
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null)
  // showFocusPicker derived from the centralised popover state so
  // opening this picker auto-closes the advanced-filter popover and
  // vice versa — the two used to overlap and obscure each other.
  const showFocusPicker = openTreePopover === 'focusPicker'
  const setShowFocusPicker = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(showFocusPicker) : next
    setOpenTreePopover(value ? 'focusPicker' : null)
  }
  const [pickerQuery, setPickerQuery] = useState('')

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    const pool = q
      ? members.filter(m => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
      : members
    return pool.slice(0, 10)
  }, [members, pickerQuery])

  const enterFocusMode = (id: string) => {
    setActiveFocusId(id)
    setIsFocusedMode(true)
    setShowFocusPicker(false)
    setPickerQuery('')
  }

  // Resolve full lineage map first — needed for the lineage filter to
  // honour the male-only Kohen/Levi rule. Uses the shared cache so
  // MemberPanel doesn't rebuild the same parent map a second time.
  const fullLineageById = useMemo(() => {
    const parentMap = getParentMap(members, relationships)
    const map = new Map<string, ReturnType<typeof resolveLineage>>()
    for (const m of members) map.set(m.id, resolveLineage(m, parentMap))
    return map
  }, [members, relationships])

  const filtered = useMemo(
    () => applyTreeFilters(members, relationships, filters, fullLineageById),
    [members, relationships, filters, fullLineageById],
  )

  const filteredCount = filtered.members.length
  useEffect(() => { onMatchedCount?.(filteredCount) }, [filteredCount, onMatchedCount])

  const fullNodes = useMemo(
    () => buildLayout(filtered.members, filtered.relationships, layoutMode, {
      showFormerSpouses: filters.showFormerSpouses,
    }),
    [filtered, layoutMode, filters.showFormerSpouses],
  )

  // ── Compact / Wide density ──────────────────────────────────────────
  // "Compact" trims the rendered population to a small window of
  // generations around the user's anchor (their selected member, or
  // the median generation if no one's selected). The point is to
  // tame wide trees — researchers consistently land on ~3 visible
  // generations as the sweet spot before the eye starts losing
  // branches. The user can expand that window one generation at a
  // time in either direction via the ▲ / ▼ controls below. "Wide"
  // (the legacy behaviour) shows everything at once.
  const [density, setDensity] = useState<'compact' | 'wide'>(() => {
    if (typeof window === 'undefined') return 'wide'
    const v = window.localStorage.getItem('ft-tree-density')
    return v === 'compact' ? 'compact' : 'wide'
  })
  useEffect(() => {
    try { window.localStorage.setItem('ft-tree-density', density) } catch { /* ignore */ }
  }, [density])

  // Extra generations beyond the 1-up / 1-down baseline ("3-window"):
  //   visible = [center - 1 - extraUp .. center + 1 + extraDown]
  // Tap ▲ → extraUp++, tap ▼ → extraDown++. Stays 0 until the user
  // explicitly asks for more.
  const [extraUp, setExtraUp] = useState(0)
  const [extraDown, setExtraDown] = useState(0)
  // Reset the expansion whenever the user switches between compact
  // and wide so they start from the 3-generation baseline next time.
  useEffect(() => {
    if (density === 'wide') {
      setExtraUp(0)
      setExtraDown(0)
    }
  }, [density])

  const genRange = useMemo(() => {
    if (fullNodes.length === 0) return { min: 0, max: 0 }
    const gens = fullNodes.map((n) => n.generation)
    return { min: Math.min(...gens), max: Math.max(...gens) }
  }, [fullNodes])

  // Anchor generation: the user's selected member, or the centre of
  // the tree as a sensible default so a fresh visit lands on a
  // visually-balanced 3-generation slice.
  const centerGen = useMemo(() => {
    if (selectedMemberId) {
      const sel = fullNodes.find((n) => n.member.id === selectedMemberId)
      if (sel) return sel.generation
    }
    return Math.floor((genRange.min + genRange.max) / 2)
  }, [fullNodes, selectedMemberId, genRange.min, genRange.max])

  const windowMin = density === 'compact'
    ? Math.max(genRange.min, centerGen - 1 - extraUp)
    : genRange.min
  const windowMax = density === 'compact'
    ? Math.min(genRange.max, centerGen + 1 + extraDown)
    : genRange.max
  // ▲ / ▼ visibility — hide once we've revealed everything in that
  // direction. The user shouldn't get a button that does nothing.
  const canExpandUp = density === 'compact' && windowMin > genRange.min
  const canExpandDown = density === 'compact' && windowMax < genRange.max

  // Shift the visible nodes so the topmost one sits at y = pad — keeps
  // the auto-fit logic + the canvas height calc happy when generations
  // above are hidden (which would otherwise leave a tall empty band
  // at the top of the canvas).
  const nodes = useMemo(() => {
    if (density === 'wide') return fullNodes
    let visible = fullNodes.filter(
      (n) => n.generation >= windowMin && n.generation <= windowMax,
    )
    if (visible.length === 0 && fullNodes.length > 0) {
      // The active filter wiped out every generation inside the compact
      // window. Rather than silently falling back to wide (which defeats
      // compact mode), re-center on the populated generation closest to
      // the user's anchor and re-slice from there. The user's window
      // size (±1 + extraUp/Down) is preserved.
      const populatedGens = Array.from(new Set(fullNodes.map((n) => n.generation)))
      const nearest = populatedGens.reduce((best, g) =>
        Math.abs(g - centerGen) < Math.abs(best - centerGen) ? g : best,
        populatedGens[0],
      )
      const lo = nearest - 1 - extraUp
      const hi = nearest + 1 + extraDown
      visible = fullNodes.filter(
        (n) => n.generation >= lo && n.generation <= hi,
      )
    }
    if (visible.length === 0) return fullNodes // last-ditch safety net
    const minVisibleY = Math.min(...visible.map((n) => n.y))
    const yShift = -minVisibleY
    return visible.map((n) => ({ ...n, y: n.y + yShift }))
  }, [fullNodes, density, windowMin, windowMax, centerGen, extraUp, extraDown])

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
    // Tree id is part of the shape signature — switching between two
    // trees that happen to have the same member count (or any other
    // dimension that previously fed the signature) used to leave the
    // viewport snapped to the previous tree's centre, so half of the
    // new tree rendered off-screen until the user manually panned.
    // Including activeTreeId guarantees auto-fit fires on every tree
    // switch.
    const shape = `${activeTreeId ?? 'null'}|${nodes.length}|${Math.round(canvasW)}|${Math.round(canvasH)}|${layoutMode}`
    const prev = lastShapeRef.current
    lastShapeRef.current = shape

    // Skip auto-fit if the shape is unchanged AND we've already
    // initialised — i.e. this re-render is not about the layout.
    if (treeViewport.initialised && prev === shape) return

    const w = wrapRef.current.clientWidth
    const h = wrapRef.current.clientHeight
    // Side margins were 20/120; the user said the canvas was clipping
    // off the side of the viewport on mobile so a parent disappeared
    // off-screen. Bumped to 48/160 to leave a clear, visible margin
    // around the population so auto-fit can't ever crop a card.
    const fitW = (w - 48) / canvasW
    const fitH = (h - 160) / canvasH
    let s = Math.max(0.28, Math.min(0.85, Math.min(fitW, fitH)))
    // Small trees previously fit at ~40% because Math.min picks the
    // narrow dimension and the 0.85 cap leaves cards tiny on the
    // canvas. For small populations (≤10 nodes) bias toward filling
    // the viewport — never beyond fitW/fitH so cards still fit, but
    // at least ~70% so they look readable instead of floating in a
    // sea of empty space. The 0.78 cap keeps clear margin on either
    // side so the canvas can't visually collide with the chrome.
    if (nodes.length <= 10) {
      const small = Math.min(fitW, fitH)
      s = Math.max(s, Math.min(small, 0.78))
    }
    // ty=100 (was 70) leaves room under the fixed top-chrome bar on
    // mobile — at 70 the topmost generation tucked under the back
    // button on phones with a status-bar safe-area inset.
    setTreeViewport({ scale: s, tx: (w - canvasW * s) / 2, ty: 100, initialised: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, canvasW, canvasH, layoutMode, activeTreeId])

  // Track the wrapper's pixel size in state so the minimap can read
  // it without poking at the ref during render (a react-hooks/refs
  // violation). The ResizeObserver fires on layout changes and
  // viewport resizes so the minimap's viewport rectangle stays
  // accurate as the user resizes the window.
  const [viewportSize, setViewportSize] = useState({ w: 1024, h: 720 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // Fit-to-view used to have its own button; the user retired it
  // ("unnecessary") and we replaced its slot with the fullscreen
  // toggle. The function itself is gone too — auto-fit on layout
  // change still happens via the lastShapeRef effect above.

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

  if (members.length === 0) return <EmptyState t={t} treeName={activeTree?.name ?? null} />

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
          {/* Parent-child rails — solid stroke (the old gradient was
              defined on objectBoundingBox, which collapses to a
              single point on pure-vertical paths and renders nothing).
              theme.pcStops[1] is the layout-mode accent middle tone. */}
          {lines.map((l, i) => (
            <path
              key={`pc-${i}`}
              d={l.d}
              stroke={theme.pcStops[1]}
              strokeOpacity="0.85"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {/* Spouse line — solid stroke, dashed, mid pink-violet. */}
          {spouseLines.map((l, i) => (
            <line
              key={`sp-${i}`}
              x1={l.x1} y1={l.y} x2={l.x2} y2={l.y}
              stroke={theme.spStops[0]}
              strokeOpacity="0.85"
              strokeWidth="2.5"
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
              dataMemberId={member.id}
            />
            {/* Edit-mode quick-add buttons. Four "+" buttons appear
                around each card pointing at the four relations
                (parent above, sibling at start, spouse at end,
                child below). Sit OUTSIDE the MemberNode <button>
                because nesting <button> tags is invalid HTML; we
                stopPropagation on each so a "+" tap doesn't also
                fire the card's select. */}
            {isEditMode && (
              <QuickAddButtons
                onAdd={(direction) => setQuickAdd({ anchor: member, direction })}
              />
            )}
          </motion.div>
        ))}
      </div>
      <QuickAddRelativeModal
        open={quickAdd !== null}
        onClose={() => setQuickAdd(null)}
        anchor={quickAdd?.anchor ?? null}
        direction={quickAdd?.direction ?? 'parent'}
      />

      {/* Layout picker used to render here as its own floating pill;
          it now lives INSIDE the black navigation island at the
          bottom of the page (see Navigation.tsx) so the mobile
          viewport isn't carrying two separate bottom controls. */}

      {/* Export menu — sits ABOVE the zoom controls on the same
          right-anchor stack. The button is unobtrusive (icon-only)
          until tapped, then a small popover surfaces both routes
          (browser print → PDF, or canvas-rendered PNG). */}
      {!treeFullscreen && (
      <ExportMenu
        t={t}
        nodes={nodes}
        lines={lines}
        spouseLines={spouseLines}
        canvasW={canvasW}
        canvasH={canvasH}
        offsetX={offsetX}
      />
      )}

      {/* Zoom + fullscreen stack — bottom-right. The standalone
          "fit-to-view" button was retired (the user called it
          "unnecessary") and its slot is now occupied by the
          fullscreen toggle. The remaining zoom +/− controls hide
          themselves in fullscreen; the fullscreen button itself
          stays so the user can always get back to the chrome. */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-30 no-print" data-tour="tree-zoom">
        {!treeFullscreen && (
          <>
            <Tooltip content={t.tipZoomIn} placement="left">
              <button
                onClick={() => zoomBy(1.2)}
                className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
                aria-label={t.tipZoomIn}
              >+</button>
            </Tooltip>
            <Tooltip content={t.tipZoomOut} placement="left">
              <button
                onClick={() => zoomBy(1 / 1.2)}
                className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
                aria-label={t.tipZoomOut}
              >−</button>
            </Tooltip>
          </>
        )}
        <Tooltip content={treeFullscreen ? t.tipFullscreenExit : t.tipFullscreenEnter} placement="left">
          <motion.button
            type="button"
            onClick={() => setTreeFullscreen(!treeFullscreen)}
            whileTap={{ scale: 0.93 }}
            aria-label={treeFullscreen ? t.tipFullscreenExit : t.tipFullscreenEnter}
            className={`w-10 h-10 rounded-full shadow-glass flex items-center justify-center transition ${
              treeFullscreen
                ? 'bg-[#1C1C1E] text-white'
                : 'glass-strong text-[#007AFF]'
            }`}
          >
            {treeFullscreen ? (
              // Exit fullscreen — arrows pointing inward
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2v3H3M10 2v3h3M6 14v-3H3M10 14v-3h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              // Enter fullscreen — arrows pointing outward
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </motion.button>
        </Tooltip>
      </div>

      {/* Bird's-eye minimap — sits in the bottom-left and surfaces the
          zoom % in its header, replacing the previous standalone badge.
          Hides itself on very small trees (under 4 nodes) where it
          adds visual noise without buying any navigation benefit.
          Wrapped in `.no-print` so it doesn't paint over the tree on
          paper. */}
      {nodes.length >= 4 && !treeFullscreen && (
        <div className="no-print">
          <TreeMiniMap
            nodes={nodes}
            canvasW={canvasW}
            canvasH={canvasH}
            tx={tx}
            ty={ty}
            scale={scale}
            viewportW={viewportSize.w}
            viewportH={viewportSize.h}
            scalePercent={scale * 100}
            onNavigate={(newTx, newTy) => {
              setTx(newTx)
              setTy(newTy)
            }}
          />
        </div>
      )}

      {/* Compact / Wide density toggle — moved to the THIRD slot
          (top: 228) per a direct user request. New stack order from
          the hamburger downward is now: Filter (124) → Focused (176)
          → Density (228). */}
      {members.length > 0 && treeControlsExpanded && (
        <div
          className="absolute z-20 no-print"
          style={{ top: 228, [rtl ? 'left' : 'right']: 12 } as React.CSSProperties}
          data-tour="tree-chip-density"
        >
          <Tooltip
            content={
              <span style={{ display: 'inline-block', maxWidth: 240, whiteSpace: 'normal' }}>
                {density === 'compact' ? t.treeDensityCompactTip : t.treeDensityWideTip}
              </span>
            }
            placement="bottom"
          >
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => setDensity((d) => (d === 'compact' ? 'wide' : 'compact'))}
              aria-label={density === 'compact' ? t.treeDensityCompact : t.treeDensityWide}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 shadow-glass font-semibold text-[12.5px] border transition ${
                density === 'compact'
                  ? 'bg-gradient-to-r from-[#34C759] to-[#30B454] text-white border-transparent'
                  : 'bg-white/95 text-[#1C1C1E] border-white/70 hover:bg-white'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="2" width="11" height="2.5" rx="0.6" fill="currentColor" opacity="0.85" />
                <rect x="1.5" y="5.75" width="11" height="2.5" rx="0.6" fill="currentColor" />
                <rect x="1.5" y="9.5" width="11" height="2.5" rx="0.6" fill="currentColor" opacity="0.85" />
              </svg>
              <span>{density === 'compact' ? t.treeDensityCompact : t.treeDensityWide}</span>
            </motion.button>
          </Tooltip>
        </div>
      )}

      {/* ── ▲ / ▼ generation-expand controls ── */}
      {/* Top: "show another ancestor generation" — appears when the
          compact window doesn't yet reach the oldest generation. */}
      <AnimatePresence>
        {canExpandUp && (
          <motion.div
            key="expand-up-wrap"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            // `inset-x-0 mx-auto w-fit` is a more reliable centring
            // recipe than `left-1/2 -translate-x-1/2` for absolutely-
            // positioned elements inside an RTL container — the latter
            // was rendering off-centre on the user's mobile screenshot.
            // `flex justify-center` on the wrapper makes the inner
            // button stay glued to the centre regardless of its own
            // width.
            className="absolute z-20 no-print inset-x-0 top-[120px] flex justify-center pointer-events-none"
          ><div className="pointer-events-auto">
            <Tooltip content={t.tipExpandUp} placement="bottom">
              <button
                onClick={() => setExtraUp((e) => e + 1)}
                type="button"
                aria-label={t.treeShowMoreAncestors}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 bg-white/95 text-[#007AFF] text-[11px] font-bold shadow-glass border border-white/70 hover:bg-white active:scale-95 transition"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 7l3.5-3.5L9.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{t.treeShowMoreAncestors}</span>
              </button>
            </Tooltip>
          </div></motion.div>
        )}
      </AnimatePresence>

      {/* Bottom: "show another descendant generation" — appears when
          the compact window doesn't yet reach the youngest generation.
          Sits ABOVE the layout picker (which itself now sits above
          the bottom navigation island) so all three controls
          stack cleanly without overlap. */}
      <AnimatePresence>
        {canExpandDown && (
          <motion.div
            key="expand-down-wrap"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            // Same centring recipe as the expand-up button above —
            // `inset-x-0 + flex justify-center` is the reliable
            // mobile-RTL form.
            className="absolute z-20 no-print inset-x-0 bottom-[124px] flex justify-center pointer-events-none"
          ><div className="pointer-events-auto">
            <Tooltip content={t.tipExpandDown} placement="top">
              <button
                onClick={() => setExtraDown((e) => e + 1)}
                type="button"
                aria-label={t.treeShowMoreDescendants}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 bg-white/95 text-[#007AFF] text-[11px] font-bold shadow-glass border border-white/70 hover:bg-white active:scale-95 transition"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 5l3.5 3.5L9.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{t.treeShowMoreDescendants}</span>
              </button>
            </Tooltip>
          </div></motion.div>
        )}
      </AnimatePresence>

      {/* Focused-Centric mode button — second slot in the stack. */}
      {members.length > 0 && treeControlsExpanded && (
        <div
          className="absolute z-20 no-print"
          style={{ top: 176, [rtl ? 'left' : 'right']: 12 } as React.CSSProperties}
          data-tour="tree-chip-focus"
        >
          <Tooltip content={t.tipFocusedCentric} placement="bottom">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (isFocusedMode) {
                  setIsFocusedMode(false)
                } else if (selectedMemberId) {
                  enterFocusMode(selectedMemberId)
                } else {
                  setShowFocusPicker(s => !s)
                }
              }}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 shadow-glass font-semibold text-[12.5px] border transition ${
                isFocusedMode
                  ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white border-transparent'
                  : 'bg-white/95 text-[#1C1C1E] border-white/70 hover:bg-white'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" />
              </svg>
              <span>{t.focusedEnterBtn}</span>
            </motion.button>
          </Tooltip>

          {/* Person picker — appears when no member is selected */}
          <AnimatePresence>
            {showFocusPicker && !isFocusedMode && (
              <motion.div
                key="focus-picker"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14 }}
                className="absolute mt-2 w-64 bg-white rounded-2xl shadow-lg border border-black/8 overflow-hidden"
                style={{ [rtl ? 'left' : 'right']: 0 } as React.CSSProperties}
              >
                <div className="px-3 pt-3 pb-2">
                  <input
                    autoFocus
                    type="text"
                    value={pickerQuery}
                    onChange={e => setPickerQuery(e.target.value)}
                    placeholder={lang === 'he' ? 'חפש בן/בת משפחה…' : 'Search member…'}
                    className="w-full text-[13px] px-3 py-2 bg-[#F2F2F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                    dir="auto"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-[#F2F2F7]">
                  {pickerResults.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => enterFocusMode(m.id)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#F2F2F7] transition text-right"
                    >
                      <div
                        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ background: m.gender === 'female' ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)' : 'linear-gradient(135deg,#2B6BFF,#19C6FF)' }}
                      >
                        {m.first_name.charAt(0)}
                      </div>
                      <span className="font-semibold text-[13px] text-[#1C1C1E] truncate">
                        {m.first_name} {m.last_name}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Focused-Centric overlay */}
      {isFocusedMode && activeFocusId && (
        <div className="absolute inset-0" style={{ zIndex: 25 }}>
          <FocusedCentricView
            allMembers={members}
            allRelationships={relationships}
            initialFocusId={activeFocusId}
            lineageById={lineageById}
            onSelectMember={(id) => setSelectedMemberId(id)}
            onExit={() => setIsFocusedMode(false)}
          />
        </div>
      )}
    </div>
  )
}

// LayoutPicker + LayoutIcon used to live here as standalone components
// (the floating "פריסה" pill at the bottom-centre of the canvas). They
// were consolidated into the bottom navigation island in
// Navigation.tsx so mobile users don't carry two competing controls in
// the same vertical band.

function EmptyState({ t, treeName }: { t: Translations; treeName: string | null }) {
  // When the user lands on an empty tree we name it in the heading so
  // they know which container they're filling.  Falls back to the
  // generic copy when no active tree is selected (main pool).
  const title = treeName
    ? t.treeEmptyTitleWithName.replace('{name}', treeName)
    : t.treeEmptyTitle
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
        <h3 className="text-sf-title3 text-[#1C1C1E] mb-1">{title}</h3>
        <p className="text-sf-subhead text-[#8E8E93]">{t.treeEmptyDesc}</p>
      </div>
    </motion.div>
  )
}

/**
 * Floating "Export" button + popover.
 *
 * Anchored to the bottom-right above the zoom controls. Tapping the
 * pill opens a tiny menu with two routes: browser print (which the
 * user can also "Save as PDF" from), and a canvas-rendered PNG
 * download. The button hides itself during print so it doesn't show
 * up on paper.
 */
function ExportMenu({
  t, nodes, lines, spouseLines, canvasW, canvasH, offsetX,
}: {
  t: Translations
  nodes: LayoutNode[]
  lines: { d: string }[]
  spouseLines: { x1: number; x2: number; y: number }[]
  canvasW: number
  canvasH: number
  offsetX: number
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const doPNG = async () => {
    if (busy) return
    setBusy(true)
    setOpen(false)
    try {
      await exportTreeAsPNG({
        nodes, lines, spouseLines, canvasW, canvasH, offsetX,
        title: 'InfiniTree',
      })
    } finally {
      setBusy(false)
    }
  }

  const doPrint = () => {
    setOpen(false)
    // Defer one tick so the popover's close animation doesn't end up
    // in the printed snapshot — and so the no-print CSS has settled.
    setTimeout(() => printTree(), 50)
  }

  return (
    <div className="absolute bottom-4 right-4 z-20 no-print" style={{ transform: 'translateY(-148px)' }}>
      <div className="relative">
        <AnimatePresence>
          {open && (
            <motion.div
              key="export-popover"
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-12 right-0 w-52 glass-strong shadow-glass-lg rounded-2xl p-1.5 flex flex-col gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={doPrint}
                disabled={busy}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-[#007AFF]/10 transition disabled:opacity-50"
              >
                <span className="w-7 h-7 rounded-lg bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="3" y="2" width="10" height="5" stroke="#007AFF" strokeWidth="1.4" />
                    <rect x="2" y="7" width="12" height="5" rx="1" stroke="#007AFF" strokeWidth="1.4" />
                    <rect x="4" y="10" width="8" height="4" stroke="#007AFF" strokeWidth="1.4" />
                  </svg>
                </span>
                <span className="text-[12px] font-semibold text-[#1C1C1E]">{t.exportPrint}</span>
              </button>
              <button
                type="button"
                onClick={doPNG}
                disabled={busy}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-[#34C759]/10 transition disabled:opacity-50"
              >
                <span className="w-7 h-7 rounded-lg bg-[#34C759]/12 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#34C759" strokeWidth="1.4" />
                    <circle cx="6" cy="7" r="1.2" fill="#34C759" />
                    <path d="M2 11l3.5-3 3 2.5L11 7l3 3v3H2v-2z" fill="#34C759" fillOpacity="0.35" />
                  </svg>
                </span>
                <span className="text-[12px] font-semibold text-[#1C1C1E]">{t.exportPNG}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <Tooltip content={t.tipExport} placement="left">
          <motion.button
            type="button"
            whileTap={{ scale: 0.93 }}
            onClick={() => setOpen((o) => !o)}
            aria-label={t.exportBtn}
            className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center active:scale-95 transition relative"
          >
            {busy ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#007AFF" strokeOpacity="0.3" strokeWidth="3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#007AFF" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 7l3 3 3-3" stroke="#007AFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="#007AFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </motion.button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Four "+" buttons that surround a member card in edit mode. Each
 * targets a different relation (parent above, child below, spouse at
 * the end, sibling at the start — RTL-aware via logical positioning).
 *
 * Buttons live OUTSIDE the MemberNode <button> (it's invalid to nest
 * <button>s) and stopPropagation on click so a "+" tap doesn't also
 * select the underlying card. Absolutely positioned relative to the
 * member's wrapper <motion.div>, so they follow the card's spring
 * animation when the layout updates.
 */
function QuickAddButtons({
  onAdd,
}: {
  onAdd: (direction: RelativeDirection) => void
}) {
  const { t } = useLang()
  // Compact, semi-transparent buttons that read as "part of the card"
  // rather than chunky bright stickers. Soft white background with a
  // blue glyph (matches the card's Apple-blue accent), subtle ring,
  // small shadow. Full opacity only when the user hovers / taps,
  // otherwise 78% so the cards stay the visual focus.
  const cls =
    'absolute w-6 h-6 rounded-full bg-white/95 text-[#007AFF] shadow-sm ring-1 ring-[#007AFF]/25 flex items-center justify-center text-[15px] leading-none font-bold opacity-80 hover:opacity-100 hover:scale-110 active:scale-95 transition-all duration-150 z-20 pointer-events-auto'
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden={false}
    >
      <button
        type="button"
        title={t.addParent}
        aria-label={t.addParent}
        onClick={(e) => { e.stopPropagation(); onAdd('parent') }}
        className={cls}
        style={{ top: -12, left: '50%', transform: 'translateX(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addChild}
        aria-label={t.addChild}
        onClick={(e) => { e.stopPropagation(); onAdd('child') }}
        className={cls}
        style={{ bottom: -12, left: '50%', transform: 'translateX(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addSibling}
        aria-label={t.addSibling}
        onClick={(e) => { e.stopPropagation(); onAdd('sibling') }}
        className={cls}
        style={{ insetInlineStart: -12, top: '50%', transform: 'translateY(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addSpouse}
        aria-label={t.addSpouse}
        onClick={(e) => { e.stopPropagation(); onAdd('spouse') }}
        className={cls}
        style={{ insetInlineEnd: -12, top: '50%', transform: 'translateY(-50%)' }}
      >+</button>
    </div>
  )
}
