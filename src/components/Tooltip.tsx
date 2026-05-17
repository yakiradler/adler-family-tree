import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Apple-style glass tooltip.
 *
 * Surfaces a short explanation when the wrapped element is hovered
 * (desktop) or long-pressed (touch). Built to a few principles the
 * user named directly: visually match the rest of the system, be
 * gently transparent (glass + saturated backdrop blur), and welcoming
 * enough that "both a kid and a grown-up" can read what a button does
 * without prior training.
 *
 * Trigger behaviour:
 *   • Mouse-enter / focus-in   → open after 350 ms (avoids flicker
 *                                while hopping between controls).
 *   • Touch-press long enough  → opens immediately so a phone user
 *                                can still discover labels.
 *   • Mouse-leave / blur / tap → close.
 *
 * The popup ignores pointer events so it never eats a click on an
 * adjacent button.
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

export default function Tooltip({
  content,
  children,
  placement = 'bottom',
  align = 'center',
  openDelay = 350,
  maxWidth = 240,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<number | null>(null)

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

  useEffect(() => () => cancelTimer(), [])

  // Position classes per side. We use logical (start/end) where
  // possible so RTL flips automatically.
  const posClasses = (() => {
    if (placement === 'top') return 'bottom-full mb-2'
    if (placement === 'bottom') return 'top-full mt-2'
    if (placement === 'left') return 'end-full me-2'
    return 'start-full ms-2'
  })()
  const alignClasses = (() => {
    if (placement === 'top' || placement === 'bottom') {
      if (align === 'start') return 'start-0'
      if (align === 'end') return 'end-0'
      return 'left-1/2 -translate-x-1/2'
    }
    if (align === 'start') return 'top-0'
    if (align === 'end') return 'bottom-0'
    return 'top-1/2 -translate-y-1/2'
  })()
  const caretSide = (() => {
    if (placement === 'top') return 'bottom-[-4px] left-1/2 -translate-x-1/2'
    if (placement === 'bottom') return 'top-[-4px] left-1/2 -translate-x-1/2'
    if (placement === 'left') return 'right-[-4px] top-1/2 -translate-y-1/2'
    return 'left-[-4px] top-1/2 -translate-y-1/2'
  })()

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
      onTouchStart={scheduleOpen}
      onTouchEnd={() => window.setTimeout(close, 1400)}
      onTouchCancel={close}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            key="tip"
            initial={{ opacity: 0, y: placement === 'bottom' ? -6 : placement === 'top' ? 6 : 0, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placement === 'bottom' ? -6 : placement === 'top' ? 6 : 0, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            role="tooltip"
            className={`pointer-events-none absolute z-[80] rounded-2xl px-3 py-2 text-[12px] font-medium leading-snug ${posClasses} ${alignClasses}`}
            style={{
              maxWidth,
              // Apple-style glass: high backdrop blur + slight
              // saturate so colours behind the bubble pop through
              // gently. The bubble itself is mostly dark + slightly
              // see-through so it reads as floating chrome instead of
              // a solid label.
              background: 'rgba(28, 28, 30, 0.78)',
              color: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(18px) saturate(180%)',
              WebkitBackdropFilter: 'blur(18px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.18), 0 4px 10px rgba(0, 0, 0, 0.10)',
              whiteSpace: 'normal',
            }}
          >
            {content}
            {/* Caret — small rotated square poking out toward the
                wrapped element. Same fill + border as the bubble so
                it reads as one continuous shape. */}
            <span
              aria-hidden
              className={`absolute w-2 h-2 rotate-45 ${caretSide}`}
              style={{
                background: 'rgba(28, 28, 30, 0.78)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
                borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                backdropFilter: 'blur(18px) saturate(180%)',
                WebkitBackdropFilter: 'blur(18px) saturate(180%)',
              }}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
