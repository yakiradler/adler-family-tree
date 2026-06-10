import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'

/**
 * Built-in FAQ — short canned answers reachable from the help "?"
 * menu. Content lives entirely in translations.ts (the faqQ / faqA
 * key pairs) so both languages stay in lockstep; this component is
 * just an accordion shell.
 */
const FAQ_KEYS: { q: keyof Translations; a: keyof Translations }[] = [
  { q: 'faqQ1', a: 'faqA1' },
  { q: 'faqQ2', a: 'faqA2' },
  { q: 'faqQ3', a: 'faqA3' },
  { q: 'faqQ4', a: 'faqA4' },
  { q: 'faqQ5', a: 'faqA5' },
  { q: 'faqQ6', a: 'faqA6' },
  { q: 'faqQ7', a: 'faqA7' },
  { q: 'faqQ8', a: 'faqA8' },
]

export default function FaqModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  // Phone back button closes the FAQ instead of leaving the page.
  useCloseOnBack(open, onClose)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm max-h-[min(620px,calc(100vh-48px))] flex flex-col rounded-3xl bg-white shadow-glass-lg overflow-hidden"
          >
            <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/5">
              <h2 className="text-sf-headline font-bold text-[#1C1C1E]">{t.faqTitle}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.faqClose}
                className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] active:scale-95 transition"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {FAQ_KEYS.map(({ q, a }, i) => {
                const expanded = openIdx === i
                return (
                  <div key={q} className="rounded-2xl bg-[#F2F2F7] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenIdx(expanded ? null : i)}
                      aria-expanded={expanded}
                      className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-start"
                    >
                      <span className="text-[13px] font-semibold text-[#1C1C1E] leading-snug">{t[q]}</span>
                      <motion.svg
                        width="12" height="12" viewBox="0 0 12 12" fill="none"
                        animate={{ rotate: expanded ? 180 : 0 }}
                        transition={{ duration: 0.16 }}
                        className="flex-shrink-0"
                        aria-hidden
                      >
                        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="#8E8E93" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </motion.svg>
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <p className="px-3.5 pb-3 text-[12px] text-[#3C3C43] leading-relaxed whitespace-pre-line">
                            {t[a]}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
