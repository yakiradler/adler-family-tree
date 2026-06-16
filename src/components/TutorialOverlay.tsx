import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'

/**
 * Interactive guided-tour overlay.
 *
 * On first login (and again on demand from the Dashboard's "Tutorial"
 * tile + the tree-page "?" button) we walk the user through the
 * app's main controls. The pattern is the classic "spotlight +
 * caption":
 *
 *   • Everything outside the active step is darkened by a backdrop.
 *   • The active step's target element gets a glowing cut-out + ring.
 *   • A speech-bubble next to the cut-out explains what the control
 *     does in plain language.
 *
 * Targets are looked up by `data-tour` attribute so the tour doesn't
 * have to know component internals. If a step's target isn't on the
 * page yet (e.g. the user is on the wrong route), the spotlight is
 * suppressed and the caption is centred in the viewport.
 *
 * v2 improvements (driven by a user-reported "caption clipped on
 * step 7" bug):
 *   • Caption position is computed AFTER measuring the bubble's
 *     real rendered size (useLayoutEffect + ref), not estimated.
 *   • Each candidate side is checked against the actual bubble box
 *     and the winner is the first to fully fit inside the viewport.
 *   • If no side fits cleanly, the caption falls back to a fixed
 *     bottom-of-viewport docked position (always visible) instead of
 *     spilling off-screen.
 *   • Steps can carry an `onEnter` callback so the tour can
 *     imperatively prepare the UI (e.g. expand the hamburger so the
 *     filter / focus / density chips become visible).
 */

export interface TourStep {
  /** value of the data-tour attribute on the target element. */
  selector: string
  title: string
  body: string
  /** Optional preferred side of the target to anchor the caption. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Fired when this step becomes active. Use it to open menus /
   *  expand chrome so the target is visible. Idempotent. */
  onEnter?: () => void
}

interface Props {
  open: boolean
  steps: TourStep[]
  onClose: () => void
}

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

const HOLE_PAD = 8 // visual breathing room around the highlighted element
const CAPTION_GAP = 14
const EDGE_PAD = 16

export default function TutorialOverlay({ open, steps, onClose }: Props) {
  const { lang } = useLang()
  const rtl = isRTL(lang)
  // Phone back button exits the tour instead of leaving the page.
  useCloseOnBack(open, onClose)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<TargetRect | null>(null)
  const [captionPos, setCaptionPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  // Which step we've already auto-scrolled into view. Scrolling on EVERY
  // re-measure (the interval + capturing scroll listener) created a
  // smooth-scroll⇄scroll-event feedback loop that made the tour jitter
  // on iPhone — we now scroll exactly once per step.
  const scrolledForStep = useRef<number>(-1)

  // Reset to step 0 on each OPEN transition. Keyed on the `open` BOOLEAN
  // only — the original compared the steps ARRAY REFERENCE, so any parent
  // re-render that produced a fresh steps array snapped stepIndex back to 0
  // ("Next" appeared to do nothing). Render-phase state-from-props is the
  // React-sanctioned pattern and avoids the effect-setState lint rule.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStepIndex(0)
  }

  // Fire the active step's onEnter — covers step 0 on open and every change.
  useEffect(() => {
    if (open) steps[stepIndex]?.onEnter?.()
  }, [stepIndex, open, steps])

  // Resolve the current step's target rect.
  useLayoutEffect(() => {
    if (!open) return
    const step = steps[stepIndex]
    if (!step) return

    const find = (): HTMLElement | null =>
      document.querySelector(`[data-tour="${step.selector}"]`)

    const measure = () => {
      const el = find()
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      // Bail on zero-size targets (display: none, etc.)
      if (r.width === 0 && r.height === 0) {
        setRect(null)
        return
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      // Scroll the target into view ONCE per step. Re-scrolling on every
      // measure fed the scroll listener back into itself (jitter on iOS).
      if (scrolledForStep.current !== stepIndex) {
        scrolledForStep.current = stepIndex
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    // A few one-shot re-measures catch a target that appears/animates in
    // late (route just changed, layout settling). The previous forever
    // setInterval(500) re-rendered the overlay twice a second for the whole
    // tour — needless work that janked the step transitions on iPhone.
    const timers = [120, 350, 700, 1200].map((d) => window.setTimeout(measure, d))
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      timers.forEach((tm) => window.clearTimeout(tm))
    }
  }, [open, stepIndex, steps])

  // Position the caption AFTER it has rendered so the geometry uses
  // the bubble's true height. We try a sequence of sides + clamp to
  // the viewport. If nothing fits we dock the caption to the bottom
  // of the viewport — always visible, never clipped.
  useLayoutEffect(() => {
    if (!open) return
    const compute = () => {
      const bubble = captionRef.current
      if (!bubble) return
      const bw = bubble.offsetWidth
      const bh = bubble.offsetHeight
      // Use the VISUAL viewport (excludes the iOS Safari toolbars) so the
      // caption + its Next button never land behind the bottom toolbar —
      // the bug where Next was only tappable after rotating to landscape.
      const vv = window.visualViewport
      // `||` (not `??`) so a transient 0 from visualViewport falls back to
      // a real dimension instead of collapsing the layout.
      const vw = vv?.width || window.innerWidth || document.documentElement.clientWidth
      const vh = vv?.height || window.innerHeight || document.documentElement.clientHeight
      // Keep clear of the home-indicator / bottom toolbar zone.
      const BOTTOM_SAFE = EDGE_PAD + 28

      const step = steps[stepIndex]
      const preferred = step?.side ?? 'bottom'

      const clampLeft = (raw: number) =>
        Math.max(EDGE_PAD, Math.min(vw - bw - EDGE_PAD, raw))
      const clampTop = (raw: number) =>
        Math.max(EDGE_PAD, Math.min(vh - bh - BOTTOM_SAFE, raw))
      const fits = (top: number, left: number) =>
        top >= EDGE_PAD && top + bh <= vh - BOTTOM_SAFE
        && left >= EDGE_PAD && left + bw <= vw - EDGE_PAD

      // No target → centred on viewport.
      if (!rect) {
        setCaptionPos({
          top: clampTop(vh / 2 - bh / 2),
          left: clampLeft(vw / 2 - bw / 2),
          width: bw,
        })
        return
      }

      const candidates: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; top: number; left: number }> = [
        { side: 'bottom', top: rect.top + rect.height + CAPTION_GAP, left: rect.left + rect.width / 2 - bw / 2 },
        { side: 'top',    top: rect.top - bh - CAPTION_GAP,         left: rect.left + rect.width / 2 - bw / 2 },
        { side: 'right',  top: rect.top + rect.height / 2 - bh / 2,  left: rect.left + rect.width + CAPTION_GAP },
        { side: 'left',   top: rect.top + rect.height / 2 - bh / 2,  left: rect.left - bw - CAPTION_GAP },
      ]

      const order = [preferred, ...(['bottom', 'top', 'right', 'left'] as const).filter((s) => s !== preferred)]
      for (const side of order) {
        const c = candidates.find((cc) => cc.side === side)
        if (!c) continue
        if (fits(c.top, c.left)) {
          setCaptionPos({ top: c.top, left: c.left, width: bw })
          return
        }
      }
      // Nothing fits — dock to whichever side has the most room.
      // Usually this means the caption ends up centred horizontally
      // and pinned to the top OR bottom of the viewport. Either way
      // it's fully visible.
      const dockedTop = rect.top > vh / 2
        ? clampTop(EDGE_PAD)                        // target near bottom → caption at top
        : clampTop(vh - bh - BOTTOM_SAFE)           // target near top → caption at bottom
      setCaptionPos({
        top: dockedTop,
        left: clampLeft(vw / 2 - bw / 2),
        width: bw,
      })
    }
    compute()
    // Re-measure after framer-motion settles, the caption can grow
    // ~20px between initial and final paint.
    const raf = requestAnimationFrame(compute)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(compute))
    window.addEventListener('resize', compute)
    // iOS: the visual viewport changes as the Safari toolbar shows/hides;
    // reposition so the caption tracks the real visible area.
    window.visualViewport?.addEventListener('resize', compute)
    window.visualViewport?.addEventListener('scroll', compute)
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
      window.removeEventListener('resize', compute)
      window.visualViewport?.removeEventListener('resize', compute)
      window.visualViewport?.removeEventListener('scroll', compute)
    }
  }, [open, stepIndex, rect, steps])

  if (!open) return null
  const step = steps[stepIndex]
  if (!step) return null

  const next = () => {
    if (stepIndex >= steps.length - 1) onClose()
    else setStepIndex((i) => i + 1)
  }
  const prev = () => setStepIndex((i) => Math.max(0, i - 1))
  const skip = () => onClose()

  const tourLabel = lang === 'he' ? 'מצב למידה' : 'Tutorial'
  const stepOf = lang === 'he' ? `שלב ${stepIndex + 1} מתוך ${steps.length}` : `Step ${stepIndex + 1} of ${steps.length}`
  const labelPrev = lang === 'he' ? 'הקודם' : 'Back'
  const labelNext = lang === 'he' ? (stepIndex >= steps.length - 1 ? 'סיום' : 'הבא') : (stepIndex >= steps.length - 1 ? 'Done' : 'Next')
  const labelSkip = lang === 'he' ? 'דלג' : 'Skip'

  const portalEl = typeof document !== 'undefined' ? document.body : null
  if (!portalEl) return null

  return createPortal(
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483640, pointerEvents: 'auto' }}
      aria-modal="true"
      role="dialog"
      aria-label={tourLabel}
    >
      {/* Dark backdrop with a "hole" cut out around the target. */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) skip()
        }}
      >
        <defs>
          <mask id="tour-cutout">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - HOLE_PAD}
                y={rect.top - HOLE_PAD}
                width={rect.width + HOLE_PAD * 2}
                height={rect.height + HOLE_PAD * 2}
                rx={Math.min(20, (rect.height + HOLE_PAD * 2) / 2)}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(12, 14, 22, 0.72)" mask="url(#tour-cutout)" />
        {rect && (
          <motion.rect
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.24 }}
            x={rect.left - HOLE_PAD}
            y={rect.top - HOLE_PAD}
            width={rect.width + HOLE_PAD * 2}
            height={rect.height + HOLE_PAD * 2}
            rx={Math.min(20, (rect.height + HOLE_PAD * 2) / 2)}
            fill="none"
            stroke="rgba(0, 122, 255, 0.85)"
            strokeWidth={3}
            style={{ filter: 'drop-shadow(0 0 14px rgba(0, 122, 255, 0.55))' }}
          />
        )}
      </svg>

      {/* Caption bubble. position: fixed so it's anchored to the
          viewport and the computed top/left match what we measured.
          NOTE: deliberately NO mode="wait" — the caption re-renders as it
          repositions, and mode="wait" would interrupt its own exit cycle
          so the next step never mounted (tour stuck, couldn't advance).
          A plain crossfade is smoother and always advances. */}
      <AnimatePresence>
        <motion.div
          key={stepIndex}
          ref={captionRef}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            // Hide until we have a measured position so the first
            // paint doesn't flash in the wrong spot.
            top: captionPos?.top ?? -9999,
            left: captionPos?.left ?? -9999,
            visibility: captionPos ? 'visible' : 'hidden',
            width: 'min(320px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            zIndex: 2,
          }}
        >
          <div
            className="rounded-3xl p-4 shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(255,255,255,0.7)',
              boxShadow: '0 24px 60px rgba(0, 122, 255, 0.25), 0 8px 20px rgba(0, 0, 0, 0.18)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: 'linear-gradient(135deg, #007AFF, #5E5CE6)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                ✨ {tourLabel}
              </span>
              <span className="text-[10px] text-[#8E8E93] font-semibold">{stepOf}</span>
            </div>

            <h3 className="text-sf-headline font-bold text-[#1C1C1E] mb-1.5">{step.title}</h3>
            <p className="text-sf-footnote text-[#3A3A3C] leading-relaxed">{step.body}</p>

            {/* Progress dots */}
            <div className="flex items-center gap-1 mt-3">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === stepIndex ? 18 : 6,
                    background: i === stepIndex
                      ? 'linear-gradient(90deg, #007AFF, #5E5CE6)'
                      : 'rgba(0,0,0,0.12)',
                  }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between mt-4 gap-2">
              <button
                type="button"
                onClick={skip}
                className="text-[12px] text-[#8E8E93] font-semibold hover:text-[#1C1C1E] transition"
              >
                {labelSkip}
              </button>
              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={prev}
                    className="px-3 py-1.5 rounded-xl bg-[#F2F2F7] text-[#1C1C1E] text-[12px] font-semibold active:scale-95 transition"
                  >
                    {labelPrev}
                  </button>
                )}
                <button
                  type="button"
                  data-tour-next
                  onClick={next}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-[12px] font-bold active:scale-95 transition shadow-md"
                >
                  {labelNext}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    portalEl,
  )
}
