import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Small hover/focus tooltip.
 *
 * Wraps any child element and surfaces an explanatory label when the
 * pointer hovers it or it receives keyboard focus. Designed for the
 * floating tree controls (density toggle, focused-centric, etc.) —
 * the icons there are intentionally minimal, and a one-line tooltip
 * tells first-time users what each does without crowding the
 * viewport with permanent labels.
 *
 * • Appears below the child by default. Pass `placement="top"` to
 *   flip it (e.g. for buttons docked near the bottom of the screen).
 * • Touch devices don't get hover, but the buttons we wrap already
 *   carry visible text + aria-labels, so the missing tooltip on
 *   tap-only devices isn't a regression.
 * • pointer-events-none on the popup so a tooltip lingering near a
 *   nearby clickable doesn't eat its first click.
 */

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  placement?: 'top' | 'bottom'
  align?: 'center' | 'start' | 'end'
}

export default function Tooltip({
  content,
  children,
  placement = 'bottom',
  align = 'center',
}: TooltipProps) {
  const [open, setOpen] = useState(false)

  const positionClasses = [
    placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
    align === 'center' && 'left-1/2 -translate-x-1/2',
    align === 'start' && 'start-0',
    align === 'end' && 'end-0',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            key="tip"
            initial={{ opacity: 0, y: placement === 'bottom' ? -4 : 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placement === 'bottom' ? -4 : 4, scale: 0.96 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-[#1C1C1E] text-white text-[11px] font-medium px-2 py-1 shadow-lg ${positionClasses}`}
            role="tooltip"
          >
            {content}
            {/* Caret — small triangle pointing back at the wrapped
                element. Color matches the bubble so it reads as one
                shape. */}
            <span
              aria-hidden
              className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1C1C1E] rotate-45 ${
                placement === 'bottom' ? '-top-1' : '-bottom-1'
              }`}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
