import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'

export interface ActionItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

/**
 * A small three-dot (⋯) actions menu. The codebase had no dropdown
 * primitive, so this is the shared one: a trigger button plus an anchored
 * popover with click-outside + Escape + phone-back dismissal (the same
 * pattern TreeSwitcher uses). Items are passed in; each closes the menu
 * after firing. Keep the trigger inside a positioned ancestor — the
 * popover anchors to the menu's own relative wrapper.
 */
export default function ActionsMenu({
  items,
  ariaLabel,
  align = 'end',
}: {
  items: ActionItem[]
  ariaLabel: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useCloseOnBack(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="w-7 h-7 -me-1 rounded-full flex items-center justify-center text-[#8E8E93] hover:bg-black/5 active:scale-90 transition"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
          <circle cx="9" cy="3.5" r="1.5" />
          <circle cx="9" cy="9" r="1.5" />
          <circle cx="9" cy="14.5" r="1.5" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-8 ${align === 'end' ? 'end-0' : 'start-0'} z-50 min-w-[180px] rounded-2xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-glass-lg p-1.5`}
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); it.onSelect() }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-start text-[13px] font-semibold transition ${
                  it.danger
                    ? 'text-[#FF3B30] hover:bg-[#FF3B30]/8'
                    : 'text-[#1C1C1E] hover:bg-[#F2F2F7]'
                }`}
              >
                {it.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0" aria-hidden>{it.icon}</span>}
                <span className="flex-1 min-w-0">{it.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
