import { useEffect, useRef } from 'react'
import { useFamilyStore } from '../../../store/useFamilyStore'

export interface ViewportState {
  tx: number
  ty: number
  scale: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 8

/**
 * Pure fit computation. NaN-proof BY CONTRACT: returns null instead of
 * ever emitting a non-finite transform (a NaN scale is what used to
 * freeze the old tree — scale(NaN) renders nothing and every further
 * zoom multiplied the NaN forever).
 */
export function fitToBounds(
  bounds: { width: number; height: number },
  viewportW: number,
  viewportH: number,
  nodeCount: number,
): ViewportState | null {
  if (
    !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
    bounds.width <= 0 || bounds.height <= 0 ||
    !Number.isFinite(viewportW) || !Number.isFinite(viewportH) ||
    viewportW <= 0 || viewportH <= 0
  ) {
    return null
  }
  const fitW = (viewportW - 48) / bounds.width
  const fitH = (viewportH - 160) / bounds.height
  let s = Math.max(0.28, Math.min(0.85, Math.min(fitW, fitH)))
  // Small populations read better filling the viewport (~70-78%).
  if (nodeCount <= 10) {
    s = Math.max(s, Math.min(Math.min(fitW, fitH), 0.78))
  }
  const out: ViewportState = {
    scale: s,
    tx: (viewportW - bounds.width * s) / 2,
    ty: 100,
  }
  if (![out.tx, out.ty, out.scale].every(Number.isFinite)) return null
  return out
}

/**
 * Pan/zoom controller.
 *
 * KEY PERFORMANCE DESIGN: during a gesture (drag / pinch / wheel) the
 * transform is applied straight to the canvas element's style — React
 * does not render at all. The store is only written when the gesture
 * ENDS (or after a short wheel idle), so the rest of the app never
 * re-renders per-mousemove. Store writes are atomic ({tx,ty,scale} in
 * one call) and the store itself drops epsilon-identical writes, so
 * feedback loops are structurally impossible.
 */
export function useViewport(opts: {
  wrapRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLDivElement | null>
  bounds: { width: number; height: number }
  nodeCount: number
  activeTreeId: string | null
}) {
  const { wrapRef, canvasRef, bounds, nodeCount, activeTreeId } = opts
  const treeViewport = useFamilyStore((s) => s.treeViewport)
  const setTreeViewport = useFamilyStore((s) => s.setTreeViewport)

  // The live (possibly uncommitted) transform.
  const live = useRef<ViewportState>({
    tx: treeViewport.tx,
    ty: treeViewport.ty,
    scale: treeViewport.scale,
  })
  // Keep live in sync when the store changes from elsewhere (minimap…).
  useEffect(() => {
    live.current = { tx: treeViewport.tx, ty: treeViewport.ty, scale: treeViewport.scale }
  }, [treeViewport.tx, treeViewport.ty, treeViewport.scale])

  const apply = (v: ViewportState) => {
    if (![v.tx, v.ty, v.scale].every(Number.isFinite)) return // refuse poison
    live.current = v
    const el = canvasRef.current
    if (el) el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`
  }
  const commit = () => {
    const v = live.current
    if (![v.tx, v.ty, v.scale].every(Number.isFinite)) return
    setTreeViewport({ tx: v.tx, ty: v.ty, scale: v.scale, initialised: true })
  }

  // ── Auto-fit: first content + every tree switch. NOT on data edits —
  // adding a member must never yank the camera (panToNode handles it).
  const lastFitTreeRef = useRef<string | null | undefined>(undefined)
  const hasContent = nodeCount > 0
  useEffect(() => {
    if (!hasContent || !wrapRef.current) return
    const treeChanged = lastFitTreeRef.current !== undefined && lastFitTreeRef.current !== activeTreeId
    const needsInit = !useFamilyStore.getState().treeViewport.initialised
    if (lastFitTreeRef.current === undefined) lastFitTreeRef.current = activeTreeId
    if (!needsInit && !treeChanged) return
    lastFitTreeRef.current = activeTreeId
    const fitted = fitToBounds(bounds, wrapRef.current.clientWidth, wrapRef.current.clientHeight, nodeCount)
    if (fitted) {
      apply(fitted)
      commit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContent, activeTreeId])

  // ── Gesture handlers ───────────────────────────────────────────────
  const dragState = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  type TouchMode =
    | { mode: 'pan'; startX: number; startY: number; tx0: number; ty0: number }
    | { mode: 'pinch'; initialDist: number; initialScale: number; cx: number; cy: number; tx0: number; ty0: number }
  const touchState = useRef<TouchMode | null>(null)
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const { tx, ty, scale } = live.current
    const delta = -e.deltaY * 0.0015
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * (1 + delta)))
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const nxWorld = (cx - tx) / scale
    const nyWorld = (cy - ty) / scale
    apply({ tx: cx - nxWorld * newScale, ty: cy - nyWorld * newScale, scale: newScale })
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current)
    wheelCommitTimer.current = setTimeout(commit, 140)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const { tx, ty } = live.current
    dragState.current = { startX: e.clientX, startY: e.clientY, tx0: tx, ty0: ty }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const st = dragState.current
    if (!st) return
    apply({
      tx: st.tx0 + (e.clientX - st.startX),
      ty: st.ty0 + (e.clientY - st.startY),
      scale: live.current.scale,
    })
  }
  const onMouseUp = () => {
    if (dragState.current) {
      dragState.current = null
      commit()
    }
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const { tx, ty, scale } = live.current
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
    } else if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      touchState.current = {
        mode: 'pinch',
        initialDist: dist,
        initialScale: scale,
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top,
        tx0: tx,
        ty0: ty,
      }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const st = touchState.current
    if (!st) return
    if (st.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]
      apply({
        tx: st.tx0 + (t.clientX - st.startX),
        ty: st.ty0 + (t.clientY - st.startY),
        scale: live.current.scale,
      })
    } else if (st.mode === 'pinch' && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.initialScale * (dist / st.initialDist)))
      const nxWorld = (st.cx - st.tx0) / st.initialScale
      const nyWorld = (st.cy - st.ty0) / st.initialScale
      apply({ tx: st.cx - nxWorld * newScale, ty: st.cy - nyWorld * newScale, scale: newScale })
    }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      if (touchState.current) {
        touchState.current = null
        commit()
      }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      const { tx, ty } = live.current
      touchState.current = { mode: 'pan', startX: t.clientX, startY: t.clientY, tx0: tx, ty0: ty }
    }
  }

  // ── Imperative controls ────────────────────────────────────────────
  const zoomBy = (factor: number) => {
    const { tx, ty, scale } = live.current
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor))
    const w = wrapRef.current?.clientWidth ?? 0
    const h = wrapRef.current?.clientHeight ?? 0
    const cx = w / 2
    const cy = h / 2
    const nxWorld = (cx - tx) / scale
    const nyWorld = (cy - ty) / scale
    apply({ tx: cx - nxWorld * newScale, ty: cy - nyWorld * newScale, scale: newScale })
    commit()
  }

  /** One-shot fit-to-screen. Pure, clamped, NaN-guarded — hammering
   *  this button can never loop or freeze. */
  const fit = () => {
    if (!wrapRef.current) return
    const fitted = fitToBounds(bounds, wrapRef.current.clientWidth, wrapRef.current.clientHeight, nodeCount)
    if (fitted) {
      apply(fitted)
      commit()
    }
  }

  /** Centre the viewport on a canvas-space point (e.g. a new member). */
  const panToPoint = (x: number, y: number) => {
    const w = wrapRef.current?.clientWidth ?? 0
    const h = wrapRef.current?.clientHeight ?? 0
    const { scale } = live.current
    apply({ tx: w / 2 - x * scale, ty: h / 2 - y * scale, scale })
    commit()
  }

  /** Set pan directly (minimap navigation). */
  const panTo = (tx: number, ty: number) => {
    apply({ tx, ty, scale: live.current.scale })
    commit()
  }

  /** Is the canvas-space point currently visible (with margin)? */
  const isPointVisible = (x: number, y: number, margin = 40): boolean => {
    const w = wrapRef.current?.clientWidth ?? 0
    const h = wrapRef.current?.clientHeight ?? 0
    const { tx, ty, scale } = live.current
    const sx = x * scale + tx
    const sy = y * scale + ty
    return sx >= margin && sx <= w - margin && sy >= margin && sy <= h - margin
  }

  return {
    tx: treeViewport.tx,
    ty: treeViewport.ty,
    scale: treeViewport.scale,
    handlers: { onWheel, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd },
    zoomBy,
    fit,
    panTo,
    panToPoint,
    isPointVisible,
  }
}
