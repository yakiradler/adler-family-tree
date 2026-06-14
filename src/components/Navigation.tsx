import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import Tooltip from './Tooltip'
import type { ViewMode } from '../types'

const HIDDEN_KEY = 'ft-nav-hidden'

export default function Navigation() {
  const {
    viewMode, setViewMode, profile, editRequests,
  } = useFamilyStore()
  const { t } = useLang()
  const navigate = useNavigate()
  const pendingCount = editRequests.length

  // Persisted hide-state so the user's preference survives across
  // page loads. A returning visitor who tucked the bar away keeps
  // their cleaner viewport without having to hide it on every visit.
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(HIDDEN_KEY) === '1'
  })
  useEffect(() => {
    try { window.localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0') } catch { /* ignore */ }
  }, [hidden])

  const tabs: { id: ViewMode; label: string; tip: string; icon: React.ReactNode }[] = [
    {
      id: 'tree',
      label: t.navTree,
      tip: t.tipNavTree,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="4" r="2.5" fill="currentColor" />
          <circle cx="4" cy="15" r="2.5" fill="currentColor" opacity="0.7" />
          <circle cx="16" cy="15" r="2.5" fill="currentColor" opacity="0.7" />
          <path d="M10 6.5v4M10 10.5L4 13M10 10.5L16 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'schematic',
      label: t.navChart,
      tip: t.tipNavSchematic,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="4" rx="1.5" fill="currentColor" opacity="0.8" />
          <rect x="2" y="9" width="7" height="4" rx="1.5" fill="currentColor" opacity="0.7" />
          <rect x="11" y="9" width="7" height="4" rx="1.5" fill="currentColor" opacity="0.7" />
          <rect x="3" y="16" width="5" height="3" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="12" y="16" width="5" height="3" rx="1" fill="currentColor" opacity="0.5" />
          <path d="M10 6v3M5.5 13v3M14.5 13v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'timeline',
      label: t.navTimeline,
      tip: t.tipNavTimeline,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="5" r="2" fill="currentColor" />
          <rect x="12" y="3.5" width="5" height="3" rx="1" fill="currentColor" opacity="0.5" />
          <circle cx="10" cy="10" r="2" fill="currentColor" />
          <rect x="3" y="8.5" width="5" height="3" rx="1" fill="currentColor" opacity="0.5" />
          <circle cx="10" cy="15" r="2" fill="currentColor" />
          <rect x="12" y="13.5" width="5" height="3" rx="1" fill="currentColor" opacity="0.5" />
        </svg>
      ),
    },
  ]

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 no-select flex flex-col items-center gap-2">
      {/* Hide / show toggle. Sits just above the navigation island so
          it's reachable with the same thumb travel as the buttons
          themselves. Persists to localStorage (see HIDDEN_KEY above)
          so the user only has to make the choice once. */}
      <Tooltip content={hidden ? t.tipNavShow : t.tipNavHide} placement="top">
      <motion.button
        type="button"
        onClick={() => setHidden((h) => !h)}
        whileTap={{ scale: 0.9 }}
        className="island px-3 py-1 flex items-center gap-1 text-white/80 hover:text-white text-[10.5px] font-semibold transition-colors"
        aria-label={hidden ? t.navShow : t.navHide}
      >
        <motion.svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          animate={{ rotate: hidden ? 180 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
        <span>{hidden ? t.navShow : t.navHide}</span>
      </motion.button>
      </Tooltip>

      <AnimatePresence initial={false}>
        {!hidden && (
      <motion.div
        key="nav-island"
        data-tour="tree-nav"
        layout
        className="island flex items-center gap-1 px-2 py-2"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {tabs.map((tab) => {
          const isActive = viewMode === tab.id
          return (
            <Tooltip key={tab.id} content={tab.tip} placement="top">
              <motion.button
                onClick={() => setViewMode(tab.id)}
                aria-label={tab.tip}
                data-tour={`tree-nav-tab-${tab.id}`}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[48px] px-3.5 py-2 rounded-[1.4rem] transition-colors duration-200 ${
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`}
                whileTap={{ scale: 0.93 }}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-white/15 rounded-[1.4rem]"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{tab.icon}</span>
                <span className="relative z-10 text-[11.5px] font-semibold tracking-wide">
                  {tab.label}
                </span>
              </motion.button>
            </Tooltip>
          )
        })}

        <div className="w-px h-8 bg-white/15 mx-1" />

        {isAdmin(profile) && (
          <Tooltip content={t.tipNavAdmin} placement="top">
          <motion.button
            onClick={() => navigate('/admin')}
            aria-label={t.tipNavAdmin}
            className="relative flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[48px] px-3 py-2 rounded-[1.4rem] text-white/40 hover:text-white/70 transition-colors"
            whileTap={{ scale: 0.93 }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 17c0-3.866 3.134-7 7-7s7 3.134 7 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {pendingCount > 0 && (
              <motion.span
                key={pendingCount}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-[#FF3B30] rounded-full text-[9px] font-bold text-white flex items-center justify-center px-1"
              >
                {pendingCount}
              </motion.span>
            )}
            <span className="text-[11.5px] font-semibold tracking-wide">{t.navAdmin}</span>
          </motion.button>
          </Tooltip>
        )}
      </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// The per-mode layout picker (and its LayoutIcon glyphs) was removed
// together with the fake layout modes — the engine has ONE perfected
// layout, so there is nothing to pick.
