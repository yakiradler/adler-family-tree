import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from '../i18n/useT'
import { useAuthState } from '../hooks/useAuthState'

/**
 * Quick-access dropdown surfaced in highly visible places (Landing header,
 * Dashboard top-bar). Three entries: personal area, signup, admin login.
 *
 * Each entry is a route nav with an icon + short hint, so even a
 * first-time visitor knows where to click. The menu auto-closes on:
 *   - selecting an entry
 *   - clicking outside the popover
 *   - pressing Escape
 *
 * RTL-aware (uses `insetInlineEnd`) so it docks naturally regardless of
 * language. The trigger button is styled to be visually obvious — the
 * user explicitly asked for an "accessible button in a visible spot".
 */
export default function QuickAccessMenu({
  variant = 'glass',
}: {
  /** 'glass' (light translucent, used on Landing) or 'solid' (used in app shell). */
  variant?: 'glass' | 'solid'
}) {
  const { t } = useLang()
  const navigate = useNavigate()
  const { isAuth, target } = useAuthState()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Click-outside + Escape close.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const items: Array<{
    key: string
    icon: string
    label: string
    hint: string
    path: string
    accent: string
  }> = [
    {
      key: 'personal',
      icon: '👤',
      label: t.quickAccessPersonal,
      hint: t.quickAccessPersonalHint,
      // When already signed in, the personal area is the dashboard (or
      // the onboarding wizard if the profile isn't yet finalised).
      path: isAuth ? target : '/login',
      accent: 'from-[#007AFF] to-[#32ADE6]',
    },
    {
      key: 'signup',
      icon: '🌱',
      label: t.quickAccessSignup,
      hint: t.quickAccessSignupHint,
      path: '/login?signup=1',
      accent: 'from-[#34C759] to-[#30D158]',
    },
    {
      key: 'admin',
      icon: '🛠️',
      label: t.quickAccessAdmin,
      hint: t.quickAccessAdminHint,
      // Admins log in through the same Auth screen; if already signed in
      // we send them to /admin directly (the route guards do the rest).
      path: isAuth ? '/admin' : '/login',
      accent: 'from-[#5E5CE6] to-[#BF5AF2]',
    },
  ]

  const triggerCls =
    variant === 'solid'
      ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white shadow-md hover:shadow-lg'
      : 'glass-strong text-[#1C1C1E] hover:bg-white/95'

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold transition ${triggerCls}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>{t.quickAccessMenu}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-30 mt-2 w-[260px] rounded-2xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-glass-lg p-1.5"
            // Always anchor the dropdown to the right edge of the trigger,
            // because both Landing and Dashboard place this menu in the
            // top-right corner regardless of language direction.
            style={{ right: 0 } as React.CSSProperties}
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => go(it.path)}
                className="w-full flex items-start gap-3 px-2.5 py-2 rounded-xl text-start hover:bg-[#F2F2F7] active:bg-[#E5E5EA] transition"
                role="menuitem"
              >
                <div
                  className={`w-9 h-9 rounded-xl bg-gradient-to-br ${it.accent} flex items-center justify-center text-white text-base shadow-sm flex-shrink-0`}
                  aria-hidden
                >
                  {it.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#1C1C1E] leading-tight">{it.label}</p>
                  <p className="text-[10px] text-[#8E8E93] mt-0.5 leading-snug">{it.hint}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
