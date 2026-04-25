import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import type { ViewMode } from '../types'

export default function Navigation() {
  const { viewMode, setViewMode, profile, editRequests } = useFamilyStore()
  const { t } = useLang()
  const pendingCount = editRequests.length

  const tabs: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
    {
      id: 'tree',
      label: t.navTree,
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 no-select">
      <motion.div
        layout
        className="island flex items-center gap-1 px-2 py-2"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {tabs.map((tab) => {
          const isActive = viewMode === tab.id
          return (
            <motion.button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`relative flex flex-col items-center gap-0.5 px-4 py-2 rounded-[1.4rem] transition-colors duration-200 ${
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
              <span className="relative z-10 text-[10px] font-medium tracking-wide">
                {tab.label}
              </span>
            </motion.button>
          )
        })}

        <div className="w-px h-8 bg-white/15 mx-1" />

        {isAdmin(profile) && (
          <motion.button
            onClick={() => setViewMode('tree')}
            className="relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-[1.4rem] text-white/40 hover:text-white/70 transition-colors"
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
            <span className="text-[10px] font-medium tracking-wide">{t.navAdmin}</span>
          </motion.button>
        )}
      </motion.div>
    </div>
  )
}
