import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import Tooltip from '../Tooltip'
import FaqModal from './FaqModal'
import FeedbackModal from './FeedbackModal'

/**
 * The "?" chip at the bottom of the tree-page floating-controls stack.
 * Used to replay the tutorial directly; the owner asked for a proper
 * help hub instead, so it now opens a 3-option popover:
 *   1. guided tour (the existing TutorialOverlay, restarted on demand)
 *   2. FAQ — short built-in answers
 *   3. report a bug / ask the admin a question (lands in the admin
 *      dashboard's "reports" tab)
 *
 * Rendered ABSOLUTE inside the same container as the filter chip so the
 * stack spacing is uniform: filter 144 → focus 196 → help 248. The old
 * `fixed top:300px` version measured against the viewport instead of
 * the canvas and floated visibly detached from the chips above it.
 */
export default function HelpMenu({ onStartTour }: { onStartTour: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [open, setOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Phone back button closes the popover instead of leaving the page.
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

  const items: { key: string; label: string; desc: string; icon: React.ReactNode; onClick: () => void }[] = [
    {
      key: 'tour',
      label: t.helpTour,
      desc: t.helpTourDesc,
      icon: (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="7.5" cy="7.5" r="5.8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.5 4.6v3l2 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      onClick: () => { setOpen(false); onStartTour() },
    },
    {
      key: 'faq',
      label: t.helpFaq,
      desc: t.helpFaqDesc,
      icon: (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M5.2 5.4a2.3 2.3 0 1 1 3.2 2.1c-.7.3-.9.7-.9 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="7.5" cy="11.2" r="0.9" fill="currentColor" />
        </svg>
      ),
      onClick: () => { setOpen(false); setFaqOpen(true) },
    },
    {
      key: 'report',
      label: t.helpReport,
      desc: t.helpReportDesc,
      icon: (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M2.2 3.5h10.6v7H8l-3 2.5v-2.5H2.2v-7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      onClick: () => { setOpen(false); setFeedbackOpen(true) },
    },
  ]

  return (
    <div
      ref={rootRef}
      // z jumps above the bottom navigation island (z-50) while ANY of
      // the help surfaces is open. The container's z-index creates the
      // stacking context for the popover AND the fixed modals inside,
      // so at the resting z-20 they would all paint UNDER the nav on
      // short phone viewports.
      className={`absolute top-[248px] no-print ${open || faqOpen || feedbackOpen ? 'z-[60]' : 'z-20'}`}
      style={{ [rtl ? 'left' : 'right']: 12 } as React.CSSProperties}
      data-tour="tree-help"
    >
      <div className="relative flex justify-end">
        <Tooltip content={t.helpMenuTooltip} placement="bottom" align="end">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen((v) => !v)}
            aria-label={t.helpMenuTooltip}
            aria-haspopup="menu"
            aria-expanded={open}
            className={`w-9 h-9 rounded-full shadow-glass flex items-center justify-center border transition ${
              open
                ? 'bg-[#007AFF] text-white border-transparent'
                : 'bg-white/95 text-[#007AFF] border-white/70 hover:bg-white'
            }`}
          >
            <span className="text-base font-bold" aria-hidden>?</span>
          </motion.button>
        </Tooltip>

        <AnimatePresence>
          {open && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute top-full mt-2 w-[230px] rounded-2xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-glass-lg p-1.5"
              style={{ [rtl ? 'left' : 'right']: 0 } as React.CSSProperties}
            >
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#8E8E93]">
                {t.helpMenuTitle}
              </p>
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={item.onClick}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-start hover:bg-[#F2F2F7] transition"
                >
                  <span className="mt-0.5 w-7 h-7 rounded-xl bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                    {item.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-semibold text-[#1C1C1E]">{item.label}</span>
                    <span className="block text-[10.5px] text-[#8E8E93] mt-0.5 leading-snug">{item.desc}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <FaqModal open={faqOpen} onClose={() => setFaqOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  )
}
