import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Apple-style glass tooltip — hover/focus only.
 *
 * Rendered through React.createPortal into document.body so it
 * always sits ABOVE every other layer in the app (dropdowns, modals,
 * the navigation island, expanding chip columns). Position is
 * computed against the wrapped child's getBoundingClientRect, not via
 * absolute positioning relative to a styled parent — so transforms or
 * `overflow: hidden` containers can't clip the bubble.
 *
 * Trigger behaviour (deliberately strict):
 *   • Mouse-enter / keyboard-focus  → open after `openDelay` ms.
 *   • Mouse-leave / blur            → close.
 *   • Click / tap                   → does NOT trigger the tooltip,
 *                                     and an active click on the
 *                                     wrapped element closes it.
 *
 * The previous version popped on every tap, which the user
 * explicitly called out as "really not good" — tooltips are for
 * discovery, not for confirming actions.
 */

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  /** Side of the wrapped element to anchor on. Default 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** How the popup aligns along the chosen edge. Default 'center'. */
  align?: 'center' | 'start' | 'end'
  /** Delay before opening on hover, in ms. */
  openDelay?: number
  /** Hard-cap on width — long copy wraps onto multiple lines. */
  maxWidth?: number
}

interface Position {
  top: number
  left: number
  caretOffset: number  // px offset of the caret from the matching edge
}

const GAP = 10        // px between wrapped element and the bubble
const EDGE_PAD = 8    // min distance the bubble keeps from the viewport edge

export default function Tooltip({
  content,
  children,
  placement = 'bottom',
  align = 'center',
  openDelay = 350,
  maxWidth = 240,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  // When the user taps the wrapped element, the browser fires
  // pointerdown → click → focus on the underlying button. The
  // focus alone would otherwise schedule the tooltip to open ~350 ms
  // after the tap, which the user (correctly) called annoying:
  // "the bubble pops on every click". This ref short-circuits the
  // *next* focus event that arrives via a touch tap so only mouse
  // hover + keyboard focus actually trigger the tooltip.
  const ignoreNextFocus = useRef(false)

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const scheduleOpen = () => {
    cancelTimer()
    timerRef.current = window.setTimeout(() => setOpen(true), openDelay)
  }
  const close = () => {
    cancelTimer()
    setOpen(false)
  }
  const handleFocus = () => {
    if (ignoreNextFocus.current) {
      ignoreNextFocus.current = false
      return
    }
    scheduleOpen()
  }
  const handlePointerDown = () => {
    // Touch/click cancels any pending hover-open AND prevents the
    // synthetic focus that follows from reopening the tooltip.
    ignoreNextFocus.current = true
    close()
  }

  useEffect(() => () => cancelTimer(), [])

  // Recompute position whenever the tooltip opens (and on scroll /
  // resize while open). We measure the bubble itself so the geometry
  // accounts for the actual rendered width — which depends on the
  // copy + the maxWidth cap.
  useLayoutEffect(() => {
    if (!open) return
    const compute = () => {
      const anchor = wrapRef.current?.getBoundingClientRect()
      const bubble = bubbleRef.current?.getBoundingClientRect()
      if (!anchor || !bubble) return
      const vw = window.innerWidth
      const vh = window.innerHeight

      let top = 0
      let left = 0

      if (placement === 'bottom') {
        top = anchor.bottom + GAP
        left =
          align === 'start' ? anchor.left
          : align === 'end' ? anchor.right - bubble.width
          : anchor.left + anchor.width / 2 - bubble.width / 2
      } else if (placement === 'top') {
        top = anchor.top - bubble.height - GAP
        left =
          align === 'start' ? anchor.left
          : align === 'end' ? anchor.right - bubble.width
          : anchor.left + anchor.width / 2 - bubble.width / 2
      } else if (placement === 'left') {
        left = anchor.left - bubble.width - GAP
        top =
          align === 'start' ? anchor.top
          : align === 'end' ? anchor.bottom - bubble.height
          : anchor.top + anchor.height / 2 - bubble.height / 2
      } else {
        // right
        left = anchor.right + GAP
        top =
          align === 'start' ? anchor.top
          : align === 'end' ? anchor.bottom - bubble.height
          : anchor.top + anchor.height / 2 - bubble.height / 2
      }

      // Clamp to viewport with EDGE_PAD margin so the bubble never
      // gets cut off (the main bug the user reported with cropped
      // tooltips on the screen edges).
      const clampedLeft = Math.max(EDGE_PAD, Math.min(left, vw - bubble.width - EDGE_PAD))
      const clampedTop = Math.max(EDGE_PAD, Math.min(top, vh - bubble.height - EDGE_PAD))

      // Caret offset: keep the arrow visually pointing at the anchor
      // even after we clamped the bubble away from the edge.
      let caretOffset = bubble.width / 2  // default centre
      if (placement === 'top' || placement === 'bottom') {
        const anchorCx = anchor.left + anchor.width / 2
        caretOffset = Math.max(12, Math.min(bubble.width - 12, anchorCx - clampedLeft))
      } else {
        const anchorCy = anchor.top + anchor.height / 2
        caretOffset = Math.max(12, Math.min(bubble.height - 12, anchorCy - clampedTop))
      }

      setPos({ top: clampedTop, left: clampedLeft, caretOffset })
    }
    // First pass before paint, then a second pass on the next frame
    // so the bubble has its final size after the spring-in animation
    // settles enough to measure.
    compute()
    const raf = requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open, placement, align])

  // Portal target. SSR-safe.
  const portalEl = typeof document !== 'undefined' ? document.body : null

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={handleFocus}
      onBlur={close}
      // Tap on the wrapped child closes any pending / open tooltip
      // AND arms the ignore-next-focus latch so the synthetic focus
      // that fires immediately after a tap won't re-open the bubble.
      onPointerDown={handlePointerDown}
    >
      {children}
      {portalEl && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              key="tip"
              ref={bubbleRef}
              role="tooltip"
              initial={{ opacity: 0, y: placement === 'bottom' ? -6 : placement === 'top' ? 6 : 0, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: placement === 'bottom' ? -6 : placement === 'top' ? 6 : 0, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none fixed rounded-2xl px-3 py-2 text-[12px] font-medium leading-snug"
              style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                maxWidth,
                zIndex: 2147483646,
                textAlign: 'center',                // ← centred copy
                background: 'rgba(28, 28, 30, 0.82)',
                color: 'rgba(255, 255, 255, 0.96)',
                backdropFilter: 'blur(18px) saturate(180%)',
                WebkitBackdropFilter: 'blur(18px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.22), 0 4px 10px rgba(0, 0, 0, 0.12)',
                whiteSpace: 'normal',
                // Hide visually until we've computed a real position
                // so the first paint doesn't flash in the wrong spot.
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              {content}
              {/* Caret — small rotated square pointing back at the
                  wrapped element, positioned dynamically so it tracks
                  the anchor even after we clamped the bubble away from
                  a viewport edge. */}
              {pos && (placement === 'top' || placement === 'bottom') && (
                <span
                  aria-hidden
                  className="absolute w-2 h-2 rotate-45"
                  style={{
                    left: pos.caretOffset - 4,
                    [placement === 'bottom' ? 'top' : 'bottom']: -4,
                    background: 'rgba(28, 28, 30, 0.82)',
                    borderLeft: placement === 'bottom' ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    borderTop: placement === 'bottom' ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    borderRight: placement === 'top' ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    borderBottom: placement === 'top' ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    backdropFilter: 'blur(18px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(18px) saturate(180%)',
                  }}
                />
              )}
              {pos && (placement === 'left' || placement === 'right') && (
                <span
                  aria-hidden
                  className="absolute w-2 h-2 rotate-45"
                  style={{
                    top: pos.caretOffset - 4,
                    [placement === 'right' ? 'left' : 'right']: -4,
                    background: 'rgba(28, 28, 30, 0.82)',
                    backdropFilter: 'blur(18px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(18px) saturate(180%)',
                  }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        portalEl,
      )}
    </span>
  )
}
