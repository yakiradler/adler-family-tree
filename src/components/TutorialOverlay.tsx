import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'

/**
 * Interactive guided-tour overlay.
 *
 * On first login (and again on demand from the Dashboard's "Tutorial"
 * tile) we walk the user through the app's main controls. The pattern
 * is the classic "spotlight + caption":
 *
 *   • Everything outside the active step is darkened by a backdrop.
 *   • The active step's target element gets a glowing cut-out + ring.
 *   • A speech-bubble next to the cut-out explains what the control
 *     does in plain language.
 *
 * Targets are looked up by `data-tour` attribute so the tour doesn't
 * have to know component internals. If a step's target isn't on the
 * page yet (e.g. the user is on the wrong route), we skip it.
 */

export interface TourStep {
  /** value of the data-tour attribute on the target element. */
  selector: string
  title: string
  body: string
  /** Optional preferred side of the target to anchor the caption. */
  side?: 'top' | 'bottom' | 'left' | 'right'
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

export default function TutorialOverlay({ open, steps, onClose }: Props) {
  const { lang, t } = useLang()
  const rtl = isRTL(lang)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<TargetRect | null>(null)

  // Reset to step 0 every time we open
  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  // Resolve the current step's target rect. Re-measures on resize +
  // when the step changes. Falls back to "advance past missing target"
  // if no element matches, so a tour that includes a route-specific
  // selector still finishes on the wrong route.
  useLayoutEffect(() => {
    if (!open) return
    const step = steps[stepIndex]
    if (!step) return

    const find = (): HTMLElement | null =>
      document.querySelector(`[data-tour="${step.selector}"]`)

    const measure = () => {
      const el = find()
      if (!el) {
        // Try once more on the next frame in case the target is just
        // about to render (animations, route transitions).
        requestAnimationFrame(() => {
          const el2 = find()
          if (!el2) {
            setRect(null)
            return
          }
          const r = el2.getBoundingClientRect()
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
          el2.scrollIntoView({ block: 'center', behavior: 'smooth' })
        })
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const t = window.setInterval(measure, 600) // catch async target appearance
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(t)
    }
  }, [open, stepIndex, steps])

  if (!open) return null
  const step = steps[stepIndex]
  if (!step) return null

  const next = () => {
    if (stepIndex >= steps.length - 1) onClose()
    else setStepIndex((i) => i + 1)
  }
  const prev = () => setStepIndex((i) => Math.max(0, i - 1))
  const skip = () => onClose()

  // Caption position — placed on a sensible side of the target. We try
  // the requested side first then fall back if it would overflow.
  const captionPos = (() => {
    if (!rect) {
      // No target → centre of screen
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' as const, side: 'center' as const }
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const captionW = Math.min(320, vw - 32)
    const captionH = 200 // rough estimate; final height varies but this is enough for placement

    const candidates: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; left: number; top: number }> = []
    candidates.push({
      side: 'bottom',
      left: Math.max(16, Math.min(vw - captionW - 16, rect.left + rect.width / 2 - captionW / 2)),
      top: rect.top + rect.height + CAPTION_GAP,
    })
    candidates.push({
      side: 'top',
      left: Math.max(16, Math.min(vw - captionW - 16, rect.left + rect.width / 2 - captionW / 2)),
      top: rect.top - captionH - CAPTION_GAP,
    })
    candidates.push({
      side: 'right',
      left: rect.left + rect.width + CAPTION_GAP,
      top: Math.max(16, Math.min(vh - captionH - 16, rect.top + rect.height / 2 - captionH / 2)),
    })
    candidates.push({
      side: 'left',
      left: rect.left - captionW - CAPTION_GAP,
      top: Math.max(16, Math.min(vh - captionH - 16, rect.top + rect.height / 2 - captionH / 2)),
    })
    // Prefer the requested side if it fits.
    const preferred = step.side ?? 'bottom'
    const order = [preferred, ...(['bottom', 'top', 'right', 'left'] as const).filter((s) => s !== preferred)]
    for (const o of order) {
      const c = candidates.find((cc) => cc.side === o)
      if (!c) continue
      const fits = c.top >= 16 && c.top + captionH <= vh - 16 && c.left >= 16 && c.left + captionW <= vw - 16
      if (fits) return { left: c.left, top: c.top, side: c.side }
    }
    // None fits perfectly — default to bottom (clamped) anyway
    const fallback = candidates[0]!
    return { left: fallback.left, top: Math.max(16, Math.min(vh - captionH - 16, fallback.top)), side: 'bottom' as const }
  })()

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
      {/* Dark backdrop with a "hole" cut out around the target. Built
          with an SVG so the cutout can be a rounded rect that exactly
          matches the highlighted control. */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        onClick={(e) => {
          // Tapping the backdrop dismisses the tour. Easier to bail
          // out of than a hard "next" path.
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

      {/* Caption bubble. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'absolute',
            top: captionPos.top,
            left: captionPos.left,
            transform: 'transform' in captionPos && captionPos.transform ? captionPos.transform : undefined,
            width: 'min(320px, calc(100vw - 32px))',
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
      {/* unused t reference kept for future keys */}
      <span hidden>{t.appName}</span>
    </div>,
    portalEl,
  )
}
